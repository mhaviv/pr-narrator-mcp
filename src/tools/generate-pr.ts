import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
  detectBaseBranch,
} from "../utils/git.js";
import { formatPrefix, truncate, formatTicketLink } from "../utils/formatters.js";
import type { PrSection } from "../config/schema.js";

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
  suggestedActions: Array<{
    action: string;
    mcpServer: string | null;
    tool: string;
    params: Record<string, unknown>;
  }>;
  warnings: string[];
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
 * Generate a complete PR with title and description
 */
export async function generatePr(
  input: GeneratePrInput
): Promise<GeneratePrResult> {
  const repoPath = input.repoPath || process.cwd();
  const warnings: string[] = [];

  // Load config
  const { config } = await loadConfig(repoPath);
  const prConfig = config.pr;
  const prTitleConfig = prConfig.title;
  
  // Detect base branch - prefer input parameter, then config, then auto-detect
  const baseBranchResult = await detectBaseBranch(
    repoPath, 
    input.baseBranch || config.baseBranch
  );
  const baseBranch = baseBranchResult.branch;
  
  // Warn if multiple base branches detected and user hasn't specified one
  if (baseBranchResult.isAmbiguous) {
    warnings.push(
      `Multiple base branches found: ${baseBranch}, ${baseBranchResult.alternatives.join(", ")}. ` +
      `Using '${baseBranch}'. To use a different branch, set baseBranch in pr-narrator.config.json ` +
      `or pass baseBranch parameter.`
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
  const titlePrefix = formatPrefix(prTitleConfig.prefix, ticket, branchPrefix);

  let titleSummary = input.titleSummary || "";
  if (!titleSummary && branchName) {
    // Extract summary from branch name
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
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
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
    summary: input.summary,
    Summary: input.summary,
    "test plan": input.testPlan,
    "Test Plan": input.testPlan,
    ...input.additionalSections,
  };

  const descriptionParts: string[] = [];

  for (const sectionConfig of prConfig.sections) {
    const content = await generateSectionContent(sectionConfig, {
      commits,
      tickets,
      ticketLinkFormat: config.ticketLinkFormat,
      providedContent,
    });

    if (!content && !sectionConfig.required) {
      continue;
    }

    if (content) {
      descriptionParts.push(`## ${sectionConfig.name}\n\n${content}`);
    }
  }

  const description = descriptionParts.join("\n\n");

  // === Build Suggested Actions ===
  const suggestedActions: Array<{
    action: string;
    mcpServer: string | null;
    tool: string;
    params: Record<string, unknown>;
  }> = [];

  if (config.integrations?.vcs) {
    const vcs = config.integrations.vcs;
    suggestedActions.push({
      action: "create_pr",
      mcpServer: vcs.mcpServer,
      tool: "create_pull_request",
      params: {
        owner: vcs.defaultOwner || undefined,
        repo: vcs.defaultRepo || undefined,
        title,
        body: description,
        base: baseBranch,
        head: branchName,
      },
    });
  }

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
    suggestedActions,
    warnings,
  };
}

export const generatePrTool = {
  name: "generate_pr",
  description: `Generate a complete PR with title and description.

This is the main tool for PR creation - it combines generate_pr_title and 
generate_pr_description into a single call.

Base Branch:
- Auto-detects from repo (checks for main, master, develop)
- If multiple branches exist (e.g., main AND develop), returns warning
- Use baseBranch parameter to specify explicitly

Title:
- Automatically extracts ticket from branch name
- Falls back to branch prefix (task/, bug/, feature/)
- Can derive summary from branch name if not provided

Description:
- Generates all configured sections
- Auto-populates Changes from commits
- Auto-populates Tickets from branch/commits
- Supports custom sections

Returns:
- title: Complete PR title with prefix
- description: Full markdown description
- context: All extracted context including baseBranch alternatives
- warnings: Any ambiguity warnings (e.g., multiple base branches found)
- suggestedActions: Ready-to-execute VCS MCP calls (if configured)`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
      baseBranch: {
        type: "string",
        description: "Base branch to compare against (e.g., 'main', 'develop'). Auto-detects if not specified.",
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
