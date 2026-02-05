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
import { formatPrefix, formatTicketLink, generatePurposeSummary } from "../utils/formatters.js";

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
    /** Main commit title - use as the primary summary */
    commitTitle: string;
    /** Bullet points from commit body - use to understand scope, don't copy directly */
    commitBullets: string[];
    /** Whether tests were included */
    hasTests: boolean;
    /** Files changed count */
    filesChanged: number;
  } | null;
  /** Guidelines for AI on how to write the Purpose section */
  purposeGuidelines: string;
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

  // Extract purpose context for AI to enhance (from ALL commits, not just first)
  let purposeContext: GeneratePrResult["purposeContext"] = null;
  if (commits.length > 0) {
    // Use first commit title as the primary summary
    const firstLines = commits[0].message.split("\n");
    const commitTitle = firstLines[0]
      .replace(/^(feat|fix|chore|docs|test|refactor|style|ci|build|perf)(\([^)]*\))?:\s*/i, "")
      .replace(/^[A-Z]+-\d+:\s*/i, "")
      .replace(/^(Task|Bug|BugFix|Feature|Hotfix):\s*/i, "")
      .trim();
    
    // Collect bullets from ALL commits
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

    // If no bullets found in bodies, use commit titles (excluding first) as bullets
    const commitBullets = allBullets.length > 0
      ? allBullets
      : commits.slice(1).map(c => {
          return c.message.split("\n")[0]
            .replace(/^(feat|fix|chore|docs|test|refactor|style|ci|build|perf)(\([^)]*\))?:\s*/i, "")
            .replace(/^[A-Z]+-\d+:\s*/i, "")
            .replace(/^(Task|Bug|BugFix|Feature|Hotfix):\s*/i, "")
            .trim();
        }).filter(t => t.length > 0);
    
    const hasTests = files.some(f => /test|spec|__tests__/i.test(f.path));
    
    purposeContext = {
      commitTitle,
      commitBullets,
      hasTests,
      filesChanged,
    };
  }

  const purposeGuidelines = `You MUST rewrite the Purpose section. The 'description' field has a placeholder.

FORMAT RULES:
- 1-2 changes: Write as prose sentence(s)
- 3+ changes: Write intro sentence, then bullet points for each change

HOW TO WRITE:
1. Read ALL commitBullets to understand the full scope
2. Write an intro sentence describing the main feature/goal
3. If 3+ distinct changes, add bullets (reworded to be concise and high-level)
4. Use present tense: "Enables...", "Adds...", "Extracts..."
5. If tests included, add as final bullet: "Includes unit tests for X"

EXAMPLE (3+ changes) - Given these bullets:
- Extract PR author from GitHub PR metadata
- Encode author in tag suffix for Azure pipelines  
- Add threaded failure notification in slack_aggregator.py
- Look up Slack user ID from env variables
- Track pinged_author_ts to prevent duplicate pings
- Add unit tests for notification functionality

WRITE THIS Purpose:
"Enables automatic Slack notifications to PR authors when builds fail.

- Extracts PR author from GitHub PR metadata
- Maps GitHub usernames to Slack user IDs for @mentions
- Posts threaded failure notifications
- Prevents duplicate notification pings
- Includes unit tests for notification functionality"

EXAMPLE (1-2 changes):
"Updates CI pipeline to Xcode 16.1."

NOT THIS:
- Just "Ping PR author when builds fail" (too short, missing detail)
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
purposeContext.commitBullets and purposeGuidelines BEFORE showing to the user.

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
