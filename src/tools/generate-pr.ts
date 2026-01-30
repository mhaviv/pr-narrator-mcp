import { z } from "zod";
import type { Config, PrSection } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
  detectBaseBranch,
} from "../utils/git.js";
import { formatPrefix, truncate, formatTicketLink, generatePurposeSummary } from "../utils/formatters.js";

export const generatePrSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
  baseBranch: z
    .string()
    .optional()
    .describe("Base branch to compare against (e.g., 'main', 'develop'). If not specified, auto-detects."),
  titleSummary: z
    .string()
    .optional()
    .describe("Summary for the PR title"),
  summary: z
    .string()
    .optional()
    .describe("Summary text for the PR description"),
  testPlan: z
    .string()
    .optional()
    .describe("Test plan text"),
  additionalSections: z
    .record(z.string())
    .optional()
    .describe("Additional section content keyed by section name"),
});

export type GeneratePrInput = z.infer<typeof generatePrSchema>;

export interface GeneratePrResult {
  title: string;
  description: string;
  context: {
    ticket: string | null;
    branchPrefix: string | null;
    branchName: string | null;
    baseBranch: string;
    baseBranchAlternatives: string[];
    baseBranchIsAmbiguous: boolean;
    commitCount: number;
    tickets: string[];
    filesChanged: number;
  };
  warnings: string[];
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
      return ""; // No tickets = omit section entirely
    }
    // Plain URLs, one per line (no markdown formatting)
    return context.tickets
      .map((t) => context.ticketLinkFormat 
        ? context.ticketLinkFormat.replace("{ticket}", t)
        : t)
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
 * Generate a complete PR with title and description
 */
export async function generatePr(
  input: GeneratePrInput,
  config: Config
): Promise<GeneratePrResult> {
  const repoPath = input.repoPath || process.cwd();
  const warnings: string[] = [];
  const prConfig = config.pr;
  const prTitleConfig = prConfig.title;

  // Detect base branch - prefer input parameter, then config, then auto-detect
  const baseBranchResult = await detectBaseBranch(
    repoPath,
    input.baseBranch || config.baseBranch
  );
  const baseBranch = baseBranchResult.branch;

  if (baseBranchResult.isAmbiguous) {
    warnings.push(
      `Multiple base branches found: ${baseBranch}, ${baseBranchResult.alternatives.join(", ")}. ` +
      `Using '${baseBranch}'. Set BASE_BRANCH env var to specify.`
    );
  }

  // Get branch info
  const branchName = await getCurrentBranch(repoPath);
  const ticket = branchName
    ? extractTicketFromBranch(branchName, config.ticketPattern)
    : null;
  const branchPrefix = branchName ? extractBranchPrefix(branchName) : null;

  // Get branch changes
  const branchChanges = await getBranchChanges(repoPath, baseBranch);
  const commits = branchChanges?.commits ?? [];
  const filesChanged = branchChanges?.files.length ?? 0;

  // Collect all tickets
  const tickets: string[] = [];
  const seenTickets = new Set<string>();

  if (ticket) {
    const normalized = ticket.toUpperCase();
    seenTickets.add(normalized);
    tickets.push(normalized);
  }

  if (config.ticketPattern) {
    const commitTickets = await extractTicketsFromCommits(
      repoPath,
      baseBranch,
      config.ticketPattern
    );
    for (const t of commitTickets) {
      const normalized = t.toUpperCase();
      if (!seenTickets.has(normalized)) {
        seenTickets.add(normalized);
        tickets.push(normalized);
      }
    }
  }

  // === Generate Title ===
  const resolvedPrefixConfig = {
    ...prTitleConfig.prefix,
    style: prTitleConfig.prefix.style === "inherit"
      ? config.commit.prefix.style
      : prTitleConfig.prefix.style,
  };
  const titlePrefix = formatPrefix(resolvedPrefixConfig, ticket, branchPrefix);

  let titleSummary = input.titleSummary || "";
  if (!titleSummary && branchName) {
    let branchSummary = branchName;
    branchSummary = branchSummary.replace(
      /^(feature|task|bug|hotfix|fix|chore|refactor)\//i,
      ""
    );
    if (config.ticketPattern) {
      try {
        const ticketRegex = new RegExp(config.ticketPattern + "[-_]?", "gi");
        branchSummary = branchSummary.replace(ticketRegex, "");
      } catch {
        // Invalid regex
      }
    }
    titleSummary = branchSummary
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (titleSummary.length > 0) {
      titleSummary = titleSummary.charAt(0).toUpperCase() + titleSummary.slice(1);
    }
  }
  if (!titleSummary) {
    titleSummary = "[Describe your changes]";
  }

  let title = titlePrefix + titleSummary;
  if (title.length > prTitleConfig.maxLength) {
    title = truncate(title, prTitleConfig.maxLength);
  }

  // === Generate Description ===
  const providedContent: Record<string, string | undefined> = {
    // Map both "summary" and "purpose" inputs to Purpose section
    summary: input.summary,
    Summary: input.summary,
    purpose: input.summary,
    Purpose: input.summary,
    "test plan": input.testPlan,
    "Test Plan": input.testPlan,
    ...input.additionalSections,
  };

  const descriptionParts: string[] = [];
  const files = branchChanges?.files ?? [];

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

    if (content) {
      descriptionParts.push(`## ${sectionConfig.name}\n\n${content}`);
    }
  }

  const description = descriptionParts.join("\n\n");

  return {
    title,
    description,
    context: {
      ticket,
      branchPrefix,
      branchName,
      baseBranch,
      baseBranchAlternatives: baseBranchResult.alternatives,
      baseBranchIsAmbiguous: baseBranchResult.isAmbiguous,
      commitCount: commits.length,
      tickets,
      filesChanged,
    },
    warnings,
  };
}

export const generatePrTool = {
  name: "generate_pr",
  description: `Generate a complete PR with title and description.

Base Branch:
- Auto-detects from repo (checks for main, master, develop)
- Set BASE_BRANCH env var to specify

Title:
- Extracts ticket from branch name
- Falls back to branch prefix (task/, bug/, feature/)

Description:
- Auto-populates Purpose from commits and file changes
- Auto-populates Changes from commits
- Auto-populates Tickets from branch/commits`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
      baseBranch: {
        type: "string",
        description: "Base branch to compare against. Auto-detects if not specified.",
      },
      titleSummary: {
        type: "string",
        description: "Summary for the PR title (extracted from branch if not provided)",
      },
      summary: {
        type: "string",
        description: "Summary text for the PR description",
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
  handler: generatePr,
};
