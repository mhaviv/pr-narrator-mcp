import { z } from "zod";
import {
  getStagedChanges,
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
} from "../utils/formatters.js";

export const generateCommitMessageSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
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
  };
  /** Guidelines for AI when summary wasn't provided */
  commitGuidelines: string | null;
  errors: string[];
}

/**
 * Generate a commit message based on staged changes and config
 */
export async function generateCommitMessage(
  input: GenerateCommitMessageInput,
  config: Config
): Promise<GenerateCommitMessageResult> {
  const repoPath = input.repoPath || process.cwd();
  const errors: string[] = [];
  const warnings: string[] = [];
  const commitConfig = config.commit;

  // Get staged changes
  const stagedChanges = await getStagedChanges(repoPath);

  if (!stagedChanges || stagedChanges.files.length === 0) {
    return {
      success: false,
      title: "",
      body: null,
      fullMessage: "",
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
        summary: "No staged changes",
        diff: null,
      },
      validation: {
        valid: false,
        warnings: [],
      },
      commitGuidelines: null,
      errors: ["No staged changes found. Stage changes with 'git add' first."],
    };
  }

  // Get branch info
  const currentBranch = await getCurrentBranch(repoPath);
  const ticket = currentBranch
    ? extractTicketFromBranch(currentBranch, config.ticketPattern)
    : null;
  const branchPrefix = currentBranch
    ? extractBranchPrefix(currentBranch)
    : null;

  // Determine commit type and scope
  const filePaths = stagedChanges.files.map((f) => f.path);
  const type = input.type || inferCommitType(filePaths);
  const scope = input.scope || inferScope(filePaths, commitConfig.scopes);

  // Generate prefix based on config (skip for main/master branches)
  const prefix = isMainBranch(currentBranch)
    ? ""
    : formatPrefix(commitConfig.prefix, ticket, branchPrefix);

  // Build the commit message
  let summary = input.summary || "";
  let needsAiRewrite = false;

  // If no summary provided, create a placeholder and flag for AI rewrite
  if (!summary) {
    const fileCount = stagedChanges.files.length;
    if (fileCount === 1) {
      summary = `Update ${stagedChanges.files[0].path}`;
    } else {
      summary = `Update ${fileCount} files`;
    }
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

  // Truncate if needed
  if (title.length > commitConfig.maxTitleLength) {
    warnings.push(
      `Title exceeds ${commitConfig.maxTitleLength} characters (${title.length}). Consider shortening.`
    );
    title = truncate(title, commitConfig.maxTitleLength);
  }

  // Body is generated by AI when commitGuidelines is present
  // If summary was provided (no AI rewrite), we can include a simple body
  let body: string | null = null;
  if (!needsAiRewrite && (input.includeBody || commitConfig.requireBody)) {
    body = `\n${summarizeFileChanges(stagedChanges.files)}`;
  }
  // When AI rewrites, it generates the body from the diff - no auto-appending

  const fullMessage = body ? `${title}\n${body}` : title;
  const valid = errors.length === 0;

  // If AI needs to rewrite, provide diff and guidelines
  const commitGuidelines = needsAiRewrite
    ? `The title "${title}" is a PLACEHOLDER. You MUST rewrite it based on the diff.

Analyze the diff in changes.diff and write a commit message following this style:

TITLE FORMAT:
- Keep prefix "${prefix}" at the start
- Describe WHAT changed functionally (not which file)
- Use imperative verbs: Add, Update, Fix, Remove, Migrate, Refactor
- Be specific: "Fix suffix removal for usernames containing -by-" not "Update file"

BODY FORMAT (for complex changes with multiple distinct changes):
- Use "- " bullets for each distinct change
- Describe what each change does, not implementation details
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
    : null;

  return {
    success: true,
    title,
    body,
    fullMessage,
    context: {
      ticket,
      branchPrefix,
      type,
      scope,
      prefix,
    },
    changes: {
      fileCount: stagedChanges.files.length,
      files: filePaths,
      // Only include summary when not rewriting (AI shouldn't copy file stats)
      summary: needsAiRewrite ? "" : summarizeFileChanges(stagedChanges.files),
      diff: needsAiRewrite ? stagedChanges.diff : null,
    },
    validation: {
      valid,
      warnings,
    },
    commitGuidelines,
    errors,
  };
}

export const generateCommitMessageTool = {
  name: "generate_commit_message",
  description: `Generate a commit message based on staged changes.

IMPORTANT: If no 'summary' provided, the returned 'title' is a PLACEHOLDER.
You MUST analyze 'changes.diff' and rewrite it following commitGuidelines.

When commitGuidelines is present:
1. Read the diff in changes.diff
2. Understand WHAT changed functionally
3. Write a specific title: "Fix X", "Add Y", "Update Z to version"
4. If complex change, add body with "- " bullets for each change
5. Keep the prefix from context.prefix
6. Show ONLY the final message to the user

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
        description: "Path to the git repository (defaults to current directory)",
      },
      summary: {
        type: "string",
        description: "Optional summary of changes (if AI already analyzed the diff)",
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
