import { z } from "zod";
import type { Config } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
  getDefaultBranch,
} from "../utils/git.js";
import { resolveTemplate, evaluateCondition, generateSectionContent, VALID_PRESETS } from "../utils/template.js";

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
  templatePreset: z
    .string()
    .optional()
    .describe("Force a specific template preset (e.g., mobile, frontend, backend, devops, security, ml)."),
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
    templateSource: string | null;
    detectedDomain: string | null;
  };
}

/**
 * Generate a PR description based on branch changes
 */
export async function generatePrDescription(
  input: GeneratePrDescriptionInput,
  config: Config
): Promise<GeneratePrDescriptionResult> {
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();

  // Build effective config, potentially overriding template preset
  let effectiveConfig = config;
  if (input.templatePreset && (VALID_PRESETS as readonly string[]).includes(input.templatePreset)) {
    effectiveConfig = {
      ...config,
      pr: {
        ...config.pr,
        template: {
          ...config.pr.template,
          preset: input.templatePreset as Config["pr"]["template"]["preset"],
          detectRepoTemplate: false,
        },
      },
    };
  }

  // Auto-detect base branch from repo, fall back to config value
  const baseBranch = await getDefaultBranch(repoPath, config.baseBranch);

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const branchPrefix = branchName ? extractBranchPrefix(branchName, config.branchPrefixes) : null;
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
    purpose: input.summary,
    Purpose: input.summary,
    "test plan": input.testPlan,
    "Test Plan": input.testPlan,
    ...input.additionalSections,
  };

  const commits = branchChanges?.commits ?? [];
  const files = branchChanges?.files ?? [];
  const sections: GeneratedSection[] = [];

  // Resolve the template (repo template > preset > auto-detect > default)
  const resolved = await resolveTemplate(repoPath, effectiveConfig);
  const templateSections = resolved.sections;
  const filePaths = files.map((f) => f.path);

  for (const sectionConfig of templateSections) {
    if (!evaluateCondition(sectionConfig.condition, filePaths, tickets, commits.length)) {
      continue;
    }

    const content = generateSectionContent(sectionConfig, {
      commits,
      files,
      tickets,
      ticketLinkFormat: config.ticketLinkFormat,
      providedContent,
      branchName,
      branchPrefix,
      domain: resolved.detectedDomain,
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
      templateSource: resolved.source,
      detectedDomain: resolved.detectedDomain,
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
      templatePreset: {
        type: "string",
        description: "Force a specific template preset (default, minimal, detailed, mobile, frontend, backend, devops, security, ml).",
      },
    },
  },
  handler: generatePrDescription,
};
