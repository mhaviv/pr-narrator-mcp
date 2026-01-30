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
  };
  validation: {
    valid: boolean;
    warnings: string[];
  };
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

  // Generate prefix based on config (skip for main/master branches)
  const prefix = isMainBranch(currentBranch)
    ? ""
    : formatPrefix(commitConfig.prefix, ticket, branchPrefix);

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

  const fullMessage = body ? `${title}\n${body}` : title;
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
  description: `Generate a commit message based on staged changes.

Prefix behavior:
- No prefix on main/master/develop branches
- If ticket found in branch (e.g., feature/PROJ-123-foo): "PROJ-123: message"
- If no ticket but branch type (e.g., task/do-something): "Task: message"

Examples:
- Branch "feature/PROJ-123-add-auth" → "PROJ-123: Add user authentication"
- Branch "task/update-readme" → "Task: Update readme"
- Branch "main" → "Update readme" (no prefix)`,
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
