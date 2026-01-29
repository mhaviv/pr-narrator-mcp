import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import type { PrSection } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractTicketsFromCommits,
} from "../utils/git.js";
import { formatTicketLink } from "../utils/formatters.js";

export const generatePrDescriptionSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
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
  suggestedActions: Array<{
    action: string;
    mcpServer: string | null;
    tool: string;
    params: Record<string, unknown>;
  }>;
}

/**
 * Generate content for a PR section
 */
async function generateSectionContent(
  section: PrSection,
  context: {
    commits: Array<{ hash: string; message: string }>;
    tickets: string[];
    ticketLinkFormat: string | undefined;
    providedContent: Record<string, string | undefined>;
  }
): Promise<string> {
  const sectionNameLower = section.name.toLowerCase();

  // Check if content was provided
  if (context.providedContent[section.name]) {
    return context.providedContent[section.name]!;
  }
  if (context.providedContent[sectionNameLower]) {
    return context.providedContent[sectionNameLower]!;
  }

  // Auto-populate if configured
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

  // Return placeholder for required sections, empty for optional
  if (section.required) {
    return `_[Add ${section.name.toLowerCase()} here]_`;
  }

  return "";
}

/**
 * Generate a PR description based on branch changes and config
 */
export async function generatePrDescription(
  input: GeneratePrDescriptionInput
): Promise<GeneratePrDescriptionResult> {
  const repoPath = input.repoPath || process.cwd();

  // Load config
  const { config } = await loadConfig(repoPath);
  const prConfig = config.pr;
  const baseBranch = config.baseBranch;

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const branchChanges = await getBranchChanges(repoPath, baseBranch);

  // Get tickets
  const tickets: string[] = [];
  const seenTickets = new Set<string>();

  // From branch
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

  // From commits
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

  // Build provided content map
  const providedContent: Record<string, string | undefined> = {
    summary: input.summary,
    Summary: input.summary,
    "test plan": input.testPlan,
    "Test Plan": input.testPlan,
    ...input.additionalSections,
  };

  // Generate sections
  const commits = branchChanges?.commits ?? [];
  const sections: GeneratedSection[] = [];

  for (const sectionConfig of prConfig.sections) {
    const content = await generateSectionContent(sectionConfig, {
      commits,
      tickets,
      ticketLinkFormat: config.ticketLinkFormat,
      providedContent,
    });

    // Skip empty optional sections
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

  // Build markdown description
  const descriptionParts: string[] = [];

  for (const section of sections) {
    if (section.content) {
      descriptionParts.push(`## ${section.name}\n\n${section.content}`);
    }
  }

  const description = descriptionParts.join("\n\n");

  // Build suggested actions if VCS integration is configured
  const suggestedActions: Array<{
    action: string;
    mcpServer: string | null;
    tool: string;
    params: Record<string, unknown>;
  }> = [];

  if (config.integrations?.vcs) {
    suggestedActions.push({
      action: "create_pr",
      mcpServer: config.integrations.vcs.mcpServer,
      tool: "create_pull_request",
      params: {
        body: description,
        base: baseBranch,
      },
    });
  }

  return {
    description,
    sections,
    context: {
      branchName,
      baseBranch,
      commitCount: commits.length,
      tickets,
    },
    suggestedActions,
  };
}

export const generatePrDescriptionTool = {
  name: "generate_pr_description",
  description: `Generate a PR description with configured sections.

Sections are defined in the config and can include:
- Summary (required/optional)
- Changes (auto-populated from commits)
- Tickets (auto-populated from branch/commits)
- Test Plan
- Screenshots
- Any custom sections

Auto-population:
- "commits": Lists all commits since base branch
- "extracted": Lists all tickets found in branch name and commits

Returns:
- description: Complete markdown description
- sections: Array of generated sections with content
- context: Branch name, base branch, commit count, tickets
- suggestedActions: Actions for VCS integration (if configured)`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
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
