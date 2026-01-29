import { z } from "zod";
import {
  getStagedChanges,
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../utils/git.js";
import { loadConfig } from "../config/loader.js";
import {
  formatPrefix,
  checkImperativeMood,
  capitalize,
  isCapitalized,
  removeTrailingPeriod,
  truncate,
  inferCommitType,
  inferScope,
  formatConventionalCommit,
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

  // Generated message parts
  title: string;
  body: string | null;
  fullMessage: string;

  // Context used
  context: {
    ticket: string | null;
    branchPrefix: string | null;
    type: string;
    scope: string | null;
    prefix: string;
  };

  // Change summary
  changes: {
    fileCount: number;
    files: string[];
    summary: string;
  };

  // Validation
  validation: {
    valid: boolean;
    warnings: string[];
  };

  // Errors
  errors: string[];
}

/**
 * Generate a commit message based on staged changes and config
 */
export async function generateCommitMessage(
  input: GenerateCommitMessageInput
): Promise<GenerateCommitMessageResult> {
  const repoPath = input.repoPath || process.cwd();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Load config
  const { config } = await loadConfig(repoPath);
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
      },
      validation: {
        valid: false,
        warnings: [],
      },
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

  // Generate prefix based on config
  const prefix = formatPrefix(commitConfig.prefix, ticket, branchPrefix);

  // Build the commit message
  let summary = input.summary || "";

  // If no summary provided, create a generic one from file changes
  if (!summary) {
    const fileCount = stagedChanges.files.length;
    if (fileCount === 1) {
      summary = `Update ${stagedChanges.files[0].path}`;
    } else {
      summary = `Update ${fileCount} files`;
    }
    warnings.push(
      "No summary provided - using generic message. Consider providing a summary for better commit messages."
    );
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

  if (commitConfig.format === "conventional") {
    // Conventional commit: type(scope): message
    const conventionalPart = formatConventionalCommit(type, scope, summary);
    title = prefix + conventionalPart;
  } else if (commitConfig.format === "simple") {
    // Simple: just prefix + message
    title = prefix + summary;
  } else {
    // Default to conventional
    const conventionalPart = formatConventionalCommit(type, scope, summary);
    title = prefix + conventionalPart;
  }

  // Truncate if needed
  if (title.length > commitConfig.maxTitleLength) {
    warnings.push(
      `Title exceeds ${commitConfig.maxTitleLength} characters (${title.length}). Consider shortening.`
    );
    title = truncate(title, commitConfig.maxTitleLength);
  }

  // Generate body if requested
  let body: string | null = null;
  if (input.includeBody || commitConfig.requireBody) {
    const bodyLines: string[] = [];
    bodyLines.push("");
    bodyLines.push(summarizeFileChanges(stagedChanges.files));

    if (ticket) {
      bodyLines.push("");
      bodyLines.push(`Ticket: ${ticket}`);
    }

    body = bodyLines.join("\n");
  }

  // Full message
  const fullMessage = body ? `${title}\n${body}` : title;

  // Validate
  const valid = errors.length === 0;

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
      summary: summarizeFileChanges(stagedChanges.files),
    },
    validation: {
      valid,
      warnings,
    },
    errors,
  };
}

export const generateCommitMessageTool = {
  name: "generate_commit_message",
  description: `Generate a commit message based on staged changes and user configuration.

The message follows the user's configured format (conventional commits, simple, etc.)
and applies their rules (imperative mood, capitalization, etc.).

Prefix behavior:
- If a ticket is found in the branch name, uses ticket as prefix
- If no ticket but branch has prefix (task/, bug/, etc.), uses that
- Prefix can be disabled in config

Parameters:
- repoPath: Path to the git repository
- summary: Optional summary (if you've already analyzed the diff)
- type: Optional type override (feat, fix, refactor, etc.)
- scope: Optional scope override
- includeBody: Whether to include a commit body

Returns:
- title: The commit message title
- body: Optional commit body
- fullMessage: Complete commit message
- context: Ticket, branch prefix, type, scope used
- changes: Summary of staged changes
- validation: Whether message passes all rules, with warnings`,
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
