import { z } from "zod";
import type { Config } from "../config/schema.js";
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
  input: GeneratePrTitleInput,
  config: Config
): Promise<GeneratePrTitleResult> {
  const repoPath = input.repoPath || process.cwd();
  const providedSummary = input.summary || "";
  const prTitleConfig = config.pr.title;

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const ticket = branchName
    ? extractTicketFromBranch(branchName, config.ticketPattern)
    : null;
  const branchPrefix = branchName ? extractBranchPrefix(branchName) : null;

  // Resolve prefix style - "inherit" means use the commit prefix style
  const resolvedPrefixConfig = {
    ...prTitleConfig.prefix,
    style: prTitleConfig.prefix.style === "inherit"
      ? config.commit.prefix.style
      : prTitleConfig.prefix.style,
  };

  // Generate prefix
  const prefix = formatPrefix(resolvedPrefixConfig, ticket, branchPrefix);

  // Build summary - use provided or placeholder
  let summary = providedSummary;
  if (!summary && branchName) {
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

    // Convert kebab-case/snake_case to sentence case
    summary = branchSummary
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Capitalize only the first letter
    if (summary.length > 0) {
      summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    }
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
  description: `Generate a PR title based on branch info.

Prefix behavior:
- If ticket found in branch name, uses ticket as prefix
- If no ticket but branch has prefix (task/, bug/, etc.), uses that

If no summary is provided, extracts one from the branch name.`,
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
