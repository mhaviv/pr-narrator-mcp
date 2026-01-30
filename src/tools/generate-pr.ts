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

  // Extract purpose context for AI to enhance
  let purposeContext: GeneratePrResult["purposeContext"] = null;
  if (commits.length > 0) {
    const firstCommit = commits[0];
    const lines = firstCommit.message.split("\n");
    const commitTitle = lines[0]
      .replace(/^(feat|fix|chore|docs|test|refactor|style|ci|build|perf)(\([^)]*\))?:\s*/i, "")
      .replace(/^[A-Z]+-\d+:\s*/i, "")
      .replace(/^(Task|Bug|BugFix|Feature|Hotfix):\s*/i, "")
      .trim();
    
    const body = lines.slice(1).join("\n").trim();
    const commitBullets = body
      .split("\n")
      .filter(line => /^[-*]\s+/.test(line.trim()))
      .map(line => line.trim().replace(/^[-*]\s+/, "").trim())
      .filter(line => line.length > 0);
    
    const hasTests = files.some(f => /test|spec|__tests__/i.test(f.path));
    
    purposeContext = {
      commitTitle,
      commitBullets,
      hasTests,
      filesChanged,
    };
  }

  const purposeGuidelines = `You MUST rewrite the Purpose section as complete prose that covers all key changes.

The 'description' field has a placeholder Purpose (just the commit title). You must REPLACE it 
with a full prose description synthesized from commitBullets. Never show bullets to the user.

HOW TO WRITE:
1. Read ALL commitBullets to understand the full scope
2. Group related changes conceptually (e.g., "extracts author" + "maps to Slack ID" = "GitHub-to-Slack user mapping")
3. Write 2-4 sentences that tell the complete story of what this PR does
4. Use present tense: "Enables...", "Adds...", "Extracts...", "Maps..."
5. Include key technical details but as prose, not implementation steps
6. If tests included, mention what's tested

EXAMPLE - Given these bullets:
- Extract PR author from GitHub PR metadata
- Encode author in tag suffix for Azure pipelines  
- Add threaded failure notification in slack_aggregator.py
- Look up Slack user ID from env variables
- Track pinged_author_ts to prevent duplicate pings
- Add unit tests for notification functionality

WRITE THIS Purpose:
"Enables automatic Slack notifications to PR authors when builds fail. Extracts the PR author from GitHub metadata and maps GitHub usernames to Slack user IDs for proper @mentions in threaded replies. Includes duplicate notification prevention and unit tests for the notification functionality."

NOT THIS:
- Just "Ping PR author when builds fail" (too short, missing detail)
- Showing bullets separately as "implementation details" (wrong format)
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

IMPORTANT: The returned 'description' has a PLACEHOLDER Purpose (just the commit title).
You MUST rewrite it as complete prose BEFORE showing to the user.

Use 'purposeContext.commitBullets' and 'purposeGuidelines' to write a FULL Purpose section
that covers all the key changes in 2-4 sentences of prose. Then show ONLY the final
title + rewritten description. Never show bullets, never mention "MCP provided", never
show purposeContext to the user.

Example - if bullets mention "extract author", "map to Slack ID", "threaded notification", "prevent duplicates":
Write: "Enables automatic Slack notifications to PR authors when builds fail. Extracts the 
PR author from GitHub metadata and maps to Slack user IDs for @mentions. Includes duplicate 
notification prevention."

WRONG: Showing short Purpose + bullets separately
RIGHT: One complete prose Purpose block with all key details synthesized`,
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
