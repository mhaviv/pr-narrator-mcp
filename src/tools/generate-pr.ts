import { z } from "zod";
import type { Config, PrSection } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
  detectBaseBranch,
  safeRegex,
} from "../utils/git.js";
import { formatPrefix, generatePurposeSummary, extractTitleFromCommits, cleanCommitTitle } from "../utils/formatters.js";

export const generatePrSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository. Always pass the user's current project/workspace directory."),
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
  /** Context for AI to enhance the Purpose section */
  purposeContext: {
    /** All commit titles (cleaned) - use to understand the full scope of changes */
    commitTitles: string[];
    /** Bullet points from commit bodies - detailed breakdown of changes */
    commitBullets: string[];
    /** Whether tests were included */
    hasTests: boolean;
    /** Files changed count */
    filesChanged: number;
    /** Total commit count */
    commitCount: number;
  } | null;
  /** Guidelines for AI on how to write the Purpose section */
  purposeGuidelines: string;
  warnings: string[];
}

function generateSectionContent(
  section: PrSection,
  context: {
    commits: Array<{ hash: string; message: string }>;
    files: Array<{ path: string; additions: number; deletions: number }>;
    tickets: string[];
    ticketLinkFormat: string | undefined;
    providedContent: Record<string, string | undefined>;
    branchName: string | null;
  }
): string {
  const sectionNameLower = section.name.toLowerCase();

  const byName = context.providedContent[section.name];
  if (byName) {
    return byName;
  }
  const byLower = context.providedContent[sectionNameLower];
  if (byLower) {
    return byLower;
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
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();
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
  if (!titleSummary) {
    // Prefer commit-derived title (analyzes oldest commit for main intent)
    const commitTitle = extractTitleFromCommits(commits);
    if (commitTitle) {
      titleSummary = commitTitle;
    }
  }
  if (!titleSummary && branchName) {
    // Fall back to branch name
    let branchSummary = branchName;
    branchSummary = branchSummary.replace(
      /^(feature|task|bug|hotfix|fix|chore|refactor|docs|test|ci|build|perf|style|ticket|release)\//i,
      ""
    );
    if (config.ticketPattern) {
      const ticketRegex = safeRegex(config.ticketPattern + "[-_]?", "gi");
      if (ticketRegex) {
        branchSummary = branchSummary.replace(ticketRegex, "");
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

  const title = titlePrefix + titleSummary;

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
    const content = generateSectionContent(sectionConfig, {
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

  // Extract purpose context for AI to enhance (from ALL commits)
  let purposeContext: GeneratePrResult["purposeContext"] = null;
  if (commits.length > 0) {
    // Clean ALL commit titles so AI can see the full scope
    const commitTitles = commits
      .map(c => cleanCommitTitle(c.message.split("\n")[0]))
      .filter(t => t.length > 0);
    
    // Collect bullet points from ALL commit bodies
    const allBullets: string[] = [];
    for (const commit of commits) {
      const lines = commit.message.split("\n");
      const body = lines.slice(1).join("\n").trim();
      const bullets = body
        .split("\n")
        .filter(line => /^[-*]\s+/.test(line.trim()))
        .map(line => line.trim().replace(/^[-*]\s+/, "").trim())
        .filter(line => line.length > 0);
      allBullets.push(...bullets);
    }

    // Use body bullets if available, otherwise commit titles serve as the breakdown
    const commitBullets = allBullets.length > 0 ? allBullets : commitTitles;
    
    const hasTests = files.some(f => /test|spec|__tests__/i.test(f.path));
    
    purposeContext = {
      commitTitles,
      commitBullets,
      hasTests,
      filesChanged,
      commitCount: commits.length,
    };
  }

  const purposeGuidelines = `You MUST rewrite BOTH the title and Purpose section using ALL the data in purposeContext.

CRITICAL: Read ALL commitTitles AND ALL commitBullets to understand the FULL scope.
Do NOT base the title or description on just one commit - synthesize everything.

TITLE:
- Rewrite the title to reflect the overall theme of ALL changes
- Keep the existing prefix (ticket or branch type)
- Be specific but high-level: "Add News UI tests and align with Home test patterns"

PURPOSE FORMAT:
- 1-2 changes: Write as prose sentence(s)
- 3+ changes: Write intro sentence summarizing the overall goal, then bullet points

HOW TO WRITE:
1. Read ALL commitTitles to understand the breadth of work
2. Read ALL commitBullets for detailed breakdown
3. Synthesize into a high-level intro sentence describing the main goal
4. Add bullets for each distinct area of change (group related commits)
5. Use present tense: "Adds...", "Updates...", "Fixes..."
6. If tests included, mention as final bullet: "Includes unit tests for X"

EXAMPLE (3+ changes) - Given commitTitles:
["Add Slack notification for failed builds", "Extract PR author from metadata", "Add unit tests"]
and commitBullets:
["Extract PR author from GitHub PR metadata", "Look up Slack user ID", "Post threaded notification", "Add unit tests"]

WRITE:
Title: "PROJ-123: Add Slack notifications to PR authors on build failure"
Purpose:
"Enables automatic Slack notifications to PR authors when builds fail.

- Extracts PR author from GitHub PR metadata
- Maps GitHub usernames to Slack user IDs for @mentions
- Posts threaded failure notifications
- Includes unit tests for notification functionality"

NOT THIS:
- Title or purpose based on only the last commit
- Raw commit bullets without intro sentence
- "The MCP provided these points..." (never reference the MCP)`;

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
    purposeContext,
    purposeGuidelines,
    warnings,
  };
}

export const generatePrTool = {
  name: "generate_pr",
  description: `Generate a PR title and description.

IMPORTANT: The returned 'description' has a PLACEHOLDER Purpose. You MUST rewrite it using
purposeContext.commitTitles, purposeContext.commitBullets, and purposeGuidelines BEFORE showing to the user.

You MUST also rewrite the title to reflect ALL changes, not just the branch name.
Read ALL commitTitles and commitBullets to understand the full scope before writing.

FORMAT:
- 1-2 changes: prose sentence(s)
- 3+ changes: intro sentence + bullet points

Example (3+ changes):
"Enables automatic Slack notifications to PR authors when builds fail.

- Extracts PR author from GitHub PR metadata
- Maps GitHub usernames to Slack user IDs for @mentions
- Posts threaded failure notifications
- Includes unit tests for notification functionality"

Show ONLY the final title + rewritten description. Never mention "MCP provided" or show raw purposeContext.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
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
