import { z } from "zod";
import {
  getStagedChanges,
  getUnstagedChanges,
  getWorkingTreeStatus,
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../utils/git.js";
import type { Config } from "../config/schema.js";
import {
  formatPrefix,
  checkImperativeMood,
  capitalize,
  isCapitalized,
  removeTrailingPeriod,
  truncate,
  inferCommitType,
  inferScope,
  formatCommitType,
  isMainBranch,
  summarizeFileChanges,
  detectUncoveredFiles,
  generateBestEffortTitle,
  categorizeChanges,
  type ChangeSummaryGroup,
} from "../utils/formatters.js";

export const generateCommitMessageSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository. Always pass the user's current project/workspace directory."),
  summary: z
    .string()
    .optional()
    .describe("Optional summary of changes (if AI already analyzed the diff)"),
  type: z
    .string()
    .optional()
    .describe("Optional commit type override (feat, fix, etc.)"),
  scope: z
    .string()
    .optional()
    .describe("Optional scope override"),
  includeBody: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include a commit body"),
});

export type GenerateCommitMessageInput = z.infer<typeof generateCommitMessageSchema>;

export interface GenerateCommitMessageResult {
  success: boolean;
  title: string;
  body: string | null;
  fullMessage: string;
  /** Whether changes come from staged files or unstaged working tree */
  source: "staged" | "unstaged";
  /** Actionable hint when using unstaged changes or other recoverable situations */
  hint: string | null;
  context: {
    ticket: string | null;
    branchPrefix: string | null;
    type: string;
    scope: string | null;
    prefix: string;
  };
  changes: {
    fileCount: number;
    files: string[];
    summary: string;
    /** The actual diff content for AI to analyze */
    diff: string | null;
  };
  validation: {
    valid: boolean;
    warnings: string[];
    /** Suggested truncated title if original exceeds maxTitleLength */
    truncatedSuggestion: string | null;
  };
  /** Structured breakdown of ALL changed files by category */
  changeSummary: ChangeSummaryGroup[];
  /** Files that the summary may not cover — hint to review */
  coverageWarnings: string[] | null;
  /** Guidelines for AI when summary wasn't provided */
  commitGuidelines: string | null;
  errors: string[];
}

/**
 * Generate a commit message based on staged changes and config.
 * Falls back to unstaged working tree changes when nothing is staged.
 */
export async function generateCommitMessage(
  input: GenerateCommitMessageInput,
  config: Config
): Promise<GenerateCommitMessageResult> {
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();
  const errors: string[] = [];
  const warnings: string[] = [];
  const commitConfig = config.commit;

  // Get staged changes first, fall back to unstaged
  const stagedChanges = await getStagedChanges(repoPath);
  const hasStaged = stagedChanges && stagedChanges.files.length > 0;

  let changes = stagedChanges;
  let source: "staged" | "unstaged" = "staged";
  let hint: string | null = null;

  if (!hasStaged) {
    const unstagedChanges = await getUnstagedChanges(repoPath);
    const hasUnstaged = unstagedChanges && unstagedChanges.files.length > 0;

    if (!hasUnstaged) {
      // Check for untracked files as a last resort to give a helpful message
      const workingTree = await getWorkingTreeStatus(repoPath);
      const errorMsg =
        workingTree.untrackedCount > 0
          ? `No staged or modified changes found. There are ${workingTree.untrackedCount} untracked file(s) — run 'git add <file>' to start tracking them.`
          : "No staged or modified changes found. Make some changes first, then run this tool.";

      return {
        success: false,
        title: "",
        body: null,
        fullMessage: "",
        source: "staged",
        hint: null,
        context: {
          ticket: null,
          branchPrefix: null,
          type: "feat",
          scope: null,
          prefix: "",
        },
        changes: {
          fileCount: 0,
          files: [],
          summary: "No changes found",
          diff: null,
        },
        validation: {
          valid: false,
          warnings: [],
          truncatedSuggestion: null,
        },
        changeSummary: [],
        coverageWarnings: null,
        commitGuidelines: null,
        errors: [errorMsg],
      };
    }

    changes = unstagedChanges;
    source = "unstaged";
    const unstagedPaths = unstagedChanges.files.map((f) => f.path);
    hint =
      `No staged changes found — analyzing ${unstagedChanges.files.length} unstaged modified file(s) instead. ` +
      `To commit these changes, stage them first:\n` +
      `  git add ${unstagedPaths.length <= 5 ? unstagedPaths.join(" ") : "."}\n` +
      `Then commit with the message generated below.`;
    warnings.push("Changes are unstaged. Run 'git add' before committing.");
  }

  // Get branch info
  const currentBranch = await getCurrentBranch(repoPath);
  const ticket = currentBranch
    ? extractTicketFromBranch(currentBranch, config.ticketPattern)
    : null;
  const branchPrefix = currentBranch
    ? extractBranchPrefix(currentBranch, config.branchPrefixes)
    : null;

  // Determine commit type and scope
  const filePaths = changes!.files.map((f) => f.path);
  const type = input.type || inferCommitType(filePaths);
  const scope = input.scope || inferScope(filePaths, commitConfig.scopes);

  // Generate prefix based on config (skip for main/master branches)
  const prefix = isMainBranch(currentBranch)
    ? ""
    : formatPrefix(commitConfig.prefix, ticket, branchPrefix);

  // Build the commit message
  let summary = input.summary || "";
  let needsAiRewrite = false;

  // If no summary provided, generate a best-effort title and flag for AI rewrite
  if (!summary) {
    summary = generateBestEffortTitle(changes!.files);
    needsAiRewrite = true;
  }

  // Apply rules
  const rules = commitConfig.rules;

  // Check imperative mood
  if (rules.imperativeMood) {
    const moodCheck = checkImperativeMood(summary);
    if (!moodCheck.isImperative && moodCheck.suggestion) {
      warnings.push(
        `Consider using imperative mood: "${moodCheck.suggestion}" instead of "${summary.split(/\s+/)[0]}"`
      );
    }
  }

  // Capitalize first letter
  if (rules.capitalizeTitle && !isCapitalized(summary)) {
    summary = capitalize(summary);
  }

  // Remove trailing period
  if (rules.noTrailingPeriod) {
    summary = removeTrailingPeriod(summary);
  }

  // Build title based on format
  let title: string;

  if (commitConfig.format === "simple") {
    title = prefix + summary;
  } else if (commitConfig.format === "conventional" || commitConfig.format === "angular") {
    const typeFormat = commitConfig.typeFormat || "capitalized";
    const includeScope = commitConfig.includeScope ?? false;
    const typePart = formatCommitType(type, typeFormat, scope, includeScope);
    title = prefix + typePart + summary;
  } else {
    title = prefix + summary;
  }

  // Check length and provide info if it exceeds the soft limit (but keep full title)
  let truncatedSuggestion: string | null = null;
  if (title.length > commitConfig.maxTitleLength) {
    warnings.push(
      `Title is ${title.length} characters (target: ~${commitConfig.maxTitleLength}). Long titles may be truncated in some git views.`
    );
    truncatedSuggestion = truncate(title, commitConfig.maxTitleLength);
  }

  // Body is always generated by the AI from the diff — we provide guidelines
  const body: string | null = null;
  const fullMessage = title;
  const valid = errors.length === 0;

  // Categorize ALL changed files so the AI can account for everything
  const changeSummary = categorizeChanges(filePaths);

  // When summary is provided, check if it covers the significant changed files
  let coverageWarnings: string[] | null = null;
  if (input.summary && filePaths.length > 1) {
    const uncovered = detectUncoveredFiles(input.summary, filePaths);
    if (uncovered.length > 0) {
      coverageWarnings = uncovered;
      warnings.push(
        `Your summary may not cover changes in: ${uncovered.join(", ")}. Review these files to ensure your commit message is complete.`
      );
    }
  }

  // Provide diff for AI body generation when summary is provided + body requested
  const needsBodyFromDiff = !needsAiRewrite && (input.includeBody || commitConfig.requireBody);

  // If AI needs to rewrite, provide diff and guidelines
  const commitGuidelines = needsAiRewrite
    ? `The title "${title}" is a PLACEHOLDER. You MUST rewrite it based on the diff.

Analyze the diff in changes.diff and the changeSummary to write a commit message that
accounts for ALL changed files and categories. The changeSummary groups every file by type —
make sure your message reflects the full scope of changes, not just part of them.

TITLE FORMAT:
- Keep prefix "${prefix}" at the start
- Aim for ~${commitConfig.maxTitleLength} characters or less (soft limit for readability)
- Describe WHAT changed functionally (not which file)
- Use imperative verbs: Add, Update, Fix, Remove, Migrate, Refactor
- Be specific: "Fix suffix removal for usernames containing -by-" not "Update file"
- Do NOT include file counts or line numbers in the title

BODY FORMAT (for complex changes with multiple distinct changes):
- Analyze the actual diff to understand what each change does
- Use "- " bullets for each distinct change
- Account for all file categories shown in changeSummary
- Describe what each change does functionally, not just which files changed
- Keep bullets concise but meaningful
- NEVER add file counts like "X files changed (+Y -Z lines)" - this is metadata, not part of commit
- NEVER add "Ticket:" lines - ticket is already in the prefix

EXAMPLES:
Title only:
- "${prefix}Fix suffix removal for usernames containing -by- substring"
- "${prefix}Update Xcode version from 16.0.1 to 16.1.1 in pipeline"
- "${prefix}Add API documentation for weather endpoints"

With body:
"${prefix}Fix location sync on significant location change

- Add delegate calls to trigger /device endpoint when location changes
- Migrate device insights from Promise to async/await
- Add debouncer delay to consolidate startup API calls"

Show ONLY the final rewritten commit message to the user.`
    : needsBodyFromDiff
      ? `Write a meaningful commit body based on the diff in changes.diff. Do NOT just list file types or counts.

BODY FORMAT:
- Summarize what the changes actually do based on the diff content
- Use "- " bullets for each distinct change
- Describe functional impact: what was added, fixed, changed, or removed
- Reference specific functions, classes, or config values when relevant
- Keep bullets concise but meaningful
- NEVER add file counts like "X files changed (+Y -Z lines)"
- NEVER add "Ticket:" lines - ticket is already in the prefix

Return ONLY the title + body as the commit message.`
      : null;

  // Provide diff when AI needs to analyze content (for rewrite or body generation)
  const includeDiff = needsAiRewrite || needsBodyFromDiff;

  return {
    success: true,
    title,
    body,
    fullMessage,
    source,
    hint,
    context: {
      ticket,
      branchPrefix,
      type,
      scope,
      prefix,
    },
    changes: {
      fileCount: changes!.files.length,
      files: filePaths,
      summary: needsAiRewrite
        ? ""
        : summarizeFileChanges(changes!.files, { includeStats: commitConfig.includeStats }),
      diff: includeDiff ? changes!.diff : null,
    },
    validation: {
      valid,
      warnings,
      truncatedSuggestion,
    },
    changeSummary,
    coverageWarnings,
    commitGuidelines,
    errors,
  };
}

export const generateCommitMessageTool = {
  name: "generate_commit_message",
  description: `Prepare commit message context from staged changes.
Falls back to unstaged working tree changes when nothing is staged, so you can
analyze changes before running 'git add'. Check 'source' in the response to see
whether staged or unstaged changes were used, and 'hint' for staging instructions.

TWO MODES:

1. WITH summary parameter (recommended): Returns a ready-to-use commit message.
   Pass a brief description of what the changes do, and the tool formats it with
   the proper prefix, capitalization, and validation. When includeBody is true,
   the diff is provided so you can write a meaningful body.

2. WITHOUT summary: Returns context for YOU to compose the message.
   - 'title' is a best-effort PLACEHOLDER based on file patterns
   - 'changes.diff' contains the actual diff
   - 'changeSummary' groups ALL files by category (Swift source, config, etc.)
   - 'commitGuidelines' explains how to write the message
   - YOU must analyze the diff and compose a meaningful title and body

For best results: First analyze the staged changes yourself, then call this tool
WITH the summary parameter to get a properly formatted commit message.

Prefix behavior:
- No prefix on main/master/develop branches
- If ticket found: "PROJ-123: message"
- If branch type: "Task: message", "Bug: message"

Examples:
- "Task: Fix suffix removal for usernames containing -by- substring"
- "Bug: Fix HolaSpark loading race condition with ReachabilityState enum"
- "WTHRAPP-3104: Update winter weather icons and illustration mappings"`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      summary: {
        type: "string",
        description: "Summary of changes - RECOMMENDED for best results. Tool formats it with proper prefix.",
      },
      type: {
        type: "string",
        description: "Optional commit type override (feat, fix, etc.)",
      },
      scope: {
        type: "string",
        description: "Optional scope override",
      },
      includeBody: {
        type: "boolean",
        description: "Whether to include a commit body",
        default: false,
      },
    },
  },
  handler: generateCommitMessage,
};
