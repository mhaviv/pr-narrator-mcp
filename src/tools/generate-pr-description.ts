import { z } from "zod";
import type { Config, PrSection } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractTicketsFromCommits,
  getDefaultBranch,
} from "../utils/git.js";
import { formatTicketLink, generatePurposeSummary } from "../utils/formatters.js";

export const generatePrDescriptionSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository. Always pass the user's current project/workspace directory."),
  summary: z
    .string()
    .optional()
    .describe("Summary text for the PR (used in Summary section)"),
  testPlan: z
    .string()
    .optional()
    .describe("Test plan text (used in Test Plan section)"),
  additionalSections: z
    .record(z.string())
    .optional()
    .describe("Additional section content keyed by section name"),
});

export type GeneratePrDescriptionInput = z.infer<typeof generatePrDescriptionSchema>;

export interface GeneratedSection {
  name: string;
  content: string;
  autoPopulated: boolean;
  required: boolean;
}

export interface GeneratePrDescriptionResult {
  description: string;
  sections: GeneratedSection[];
  context: {
    branchName: string | null;
    baseBranch: string;
    commitCount: number;
    tickets: string[];
  };
}

async function generateSectionContent(
  section: PrSection,
  context: {
    commits: Array<{ hash: string; message: string }>;
    files: Array<{ path: string; additions: number; deletions: number }>;
    tickets: string[];
    ticketLinkFormat: string | undefined;
    providedContent: Record<string, string | undefined>;
    branchName: string | null;
  }
): Promise<string> {
  const sectionNameLower = section.name.toLowerCase();

  if (context.providedContent[section.name]) {
    return context.providedContent[section.name]!;
  }
  if (context.providedContent[sectionNameLower]) {
    return context.providedContent[sectionNameLower]!;
  }

  if (section.autoPopulate === "commits") {
    if (context.commits.length === 0) {
      return "_No commits found_";
    }
    return context.commits
      .map((c) => `- ${c.message} (${c.hash})`)
      .join("\n");
  }

  if (section.autoPopulate === "extracted") {
    if (context.tickets.length === 0) {
      return "_No tickets found_";
    }
    return context.tickets
      .map((t) => `- ${formatTicketLink(t, context.ticketLinkFormat)}`)
      .join("\n");
  }

  if (section.autoPopulate === "purpose") {
    return generatePurposeSummary(context.commits, context.files, context.branchName);
  }

  if (section.required) {
    return `_[Add ${section.name.toLowerCase()} here]_`;
  }

  return "";
}

/**
 * Generate a PR description based on branch changes
 */
export async function generatePrDescription(
  input: GeneratePrDescriptionInput,
  config: Config
): Promise<GeneratePrDescriptionResult> {
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();
  const prConfig = config.pr;

  // Auto-detect base branch from repo, fall back to config value
  const baseBranch = await getDefaultBranch(repoPath, config.baseBranch);

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const branchChanges = await getBranchChanges(repoPath, baseBranch);

  // Get tickets
  const tickets: string[] = [];
  const seenTickets = new Set<string>();

  if (branchName && config.ticketPattern) {
    const branchTicket = extractTicketFromBranch(branchName, config.ticketPattern);
    if (branchTicket) {
      const normalized = branchTicket.toUpperCase();
      if (!seenTickets.has(normalized)) {
        seenTickets.add(normalized);
        tickets.push(normalized);
      }
    }
  }

  if (config.ticketPattern) {
    const commitTickets = await extractTicketsFromCommits(
      repoPath,
      baseBranch,
      config.ticketPattern
    );
    for (const ticket of commitTickets) {
      const normalized = ticket.toUpperCase();
      if (!seenTickets.has(normalized)) {
        seenTickets.add(normalized);
        tickets.push(normalized);
      }
    }
  }

  const providedContent: Record<string, string | undefined> = {
    summary: input.summary,
    Summary: input.summary,
    "test plan": input.testPlan,
    "Test Plan": input.testPlan,
    ...input.additionalSections,
  };

  const commits = branchChanges?.commits ?? [];
  const files = branchChanges?.files ?? [];
  const sections: GeneratedSection[] = [];

  for (const sectionConfig of prConfig.sections) {
    const content = await generateSectionContent(sectionConfig, {
      commits,
      files,
      tickets,
      ticketLinkFormat: config.ticketLinkFormat,
      providedContent,
      branchName,
    });

    if (!content && !sectionConfig.required) {
      continue;
    }

    sections.push({
      name: sectionConfig.name,
      content,
      autoPopulated: !!sectionConfig.autoPopulate,
      required: sectionConfig.required ?? false,
    });
  }

  const descriptionParts: string[] = [];
  for (const section of sections) {
    if (section.content) {
      descriptionParts.push(`## ${section.name}\n\n${section.content}`);
    }
  }

  const description = descriptionParts.join("\n\n");

  return {
    description,
    sections,
    context: {
      branchName,
      baseBranch,
      commitCount: commits.length,
      tickets,
    },
  };
}

export const generatePrDescriptionTool = {
  name: "generate_pr_description",
  description: `Generate a PR description with sections.

Auto-populates:
- "purpose": Summary from commits, files, and branch name
- "commits": Lists all commits since base branch
- "extracted": Lists all tickets found`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      summary: {
        type: "string",
        description: "Summary text for the PR",
      },
      testPlan: {
        type: "string",
        description: "Test plan text",
      },
      additionalSections: {
        type: "object",
        description: "Additional section content keyed by section name",
        additionalProperties: { type: "string" },
      },
    },
  },
  handler: generatePrDescription,
};
