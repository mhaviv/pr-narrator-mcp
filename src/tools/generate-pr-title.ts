import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import {
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../utils/git.js";
import { formatPrefix, truncate } from "../utils/formatters.js";

export const generatePrTitleSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
  summary: z
    .string()
    .optional()
    .describe("Summary for the PR title (if not provided, will need to be filled in)"),
});

export type GeneratePrTitleInput = z.infer<typeof generatePrTitleSchema>;

export interface GeneratePrTitleResult {
  title: string;
  prefix: string;
  summary: string;
  context: {
    ticket: string | null;
    branchPrefix: string | null;
    branchName: string | null;
  };
  validation: {
    withinMaxLength: boolean;
    maxLength: number;
    currentLength: number;
  };
}

/**
 * Generate a PR title based on branch info and config
 */
export async function generatePrTitle(
  input: GeneratePrTitleInput
): Promise<GeneratePrTitleResult> {
  const repoPath = input.repoPath || process.cwd();
  const providedSummary = input.summary || "";

  // Load config
  const { config } = await loadConfig(repoPath);
  const prTitleConfig = config.pr.title;

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const ticket = branchName
    ? extractTicketFromBranch(branchName, config.ticketPattern)
    : null;
  const branchPrefix = branchName ? extractBranchPrefix(branchName) : null;

  // Generate prefix
  const prefix = formatPrefix(prTitleConfig.prefix, ticket, branchPrefix);

  // Build summary - use provided or placeholder
  let summary = providedSummary;
  if (!summary && branchName) {
    // Try to extract summary from branch name
    // Remove ticket and prefix, convert kebab-case to Title Case
    let branchSummary = branchName;

    // Remove common prefixes
    branchSummary = branchSummary.replace(
      /^(feature|task|bug|hotfix|fix|chore|refactor)\//i,
      ""
    );

    // Remove ticket number
    if (config.ticketPattern) {
      try {
        const ticketRegex = new RegExp(config.ticketPattern + "[-_]?", "gi");
        branchSummary = branchSummary.replace(ticketRegex, "");
      } catch {
        // Invalid regex, skip
      }
    }

    // Convert kebab-case/snake_case to Title Case
    summary = branchSummary
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  if (!summary) {
    summary = "[Describe your changes]";
  }

  // Build title
  let title = prefix + summary;

  // Check length
  const maxLength = prTitleConfig.maxLength;
  const withinMaxLength = title.length <= maxLength;

  if (!withinMaxLength) {
    title = truncate(title, maxLength);
  }

  return {
    title,
    prefix,
    summary,
    context: {
      ticket,
      branchPrefix,
      branchName,
    },
    validation: {
      withinMaxLength,
      maxLength,
      currentLength: title.length,
    },
  };
}

export const generatePrTitleTool = {
  name: "generate_pr_title",
  description: `Generate a PR title based on branch info and user configuration.

Prefix behavior:
- If a ticket is found in the branch name, uses ticket as prefix
- If no ticket but branch has prefix (task/, bug/, etc.), uses that
- Prefix format is configurable (e.g., "[{ticket}] " or "{ticket}: ")

If no summary is provided, attempts to extract one from the branch name
by converting kebab-case to Title Case.

Returns:
- title: The complete PR title
- prefix: The prefix portion
- summary: The summary portion
- context: Ticket, branch prefix, and branch name used
- validation: Whether title is within max length`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
      summary: {
        type: "string",
        description: "Summary for the PR title (if not provided, will extract from branch)",
      },
    },
  },
  handler: generatePrTitle,
};
