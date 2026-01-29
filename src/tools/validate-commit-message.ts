import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import {
  checkImperativeMood,
  isCapitalized,
} from "../utils/formatters.js";

export const validateCommitMessageSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
  message: z
    .string()
    .describe("The commit message to validate"),
});

export type ValidateCommitMessageInput = z.infer<typeof validateCommitMessageSchema>;

export interface ValidationIssue {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidateCommitMessageResult {
  valid: boolean;
  message: string;
  issues: ValidationIssue[];
  errors: string[];
  warnings: string[];
  suggestions: string[];
  parsed: {
    title: string;
    body: string | null;
    type: string | null;
    scope: string | null;
    isConventional: boolean;
  };
}

// Conventional commit regex: type(scope)?: message
const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/**
 * Parse a commit message into its components
 */
function parseCommitMessage(message: string): {
  title: string;
  body: string | null;
  type: string | null;
  scope: string | null;
  isConventional: boolean;
  isBreaking: boolean;
} {
  const lines = message.split("\n");
  const title = lines[0] || "";
  const body = lines.slice(2).join("\n").trim() || null;

  const match = title.match(CONVENTIONAL_COMMIT_REGEX);

  if (match) {
    return {
      title,
      body,
      type: match[1],
      scope: match[2] || null,
      isConventional: true,
      isBreaking: match[3] === "!",
    };
  }

  return {
    title,
    body,
    type: null,
    scope: null,
    isConventional: false,
    isBreaking: false,
  };
}

/**
 * Validate a commit message against configuration rules
 */
export async function validateCommitMessage(
  input: ValidateCommitMessageInput
): Promise<ValidateCommitMessageResult> {
  const repoPath = input.repoPath || process.cwd();
  const message = input.message.trim();

  const issues: ValidationIssue[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Load config
  const { config } = await loadConfig(repoPath);
  const commitConfig = config.commit;
  const rules = commitConfig.rules;

  // Parse the message
  const parsed = parseCommitMessage(message);

  // Check if message is empty
  if (!message) {
    issues.push({
      rule: "non-empty",
      message: "Commit message cannot be empty",
      severity: "error",
    });
    errors.push("Commit message cannot be empty");
  }

  // Check title length
  if (parsed.title.length > commitConfig.maxTitleLength) {
    issues.push({
      rule: "max-title-length",
      message: `Title exceeds ${commitConfig.maxTitleLength} characters (${parsed.title.length})`,
      severity: "error",
    });
    errors.push(
      `Title exceeds ${commitConfig.maxTitleLength} characters (${parsed.title.length})`
    );
  }

  // Check conventional commit format if required
  if (commitConfig.format === "conventional" && !parsed.isConventional) {
    issues.push({
      rule: "conventional-format",
      message: "Message does not follow conventional commit format: type(scope): message",
      severity: "warning",
    });
    warnings.push(
      "Message does not follow conventional commit format: type(scope): message"
    );
    suggestions.push(
      'Consider using format: "type(scope): message" e.g., "feat(auth): Add login"'
    );
  }

  // Check scope requirement
  if (commitConfig.requireScope && parsed.isConventional && !parsed.scope) {
    issues.push({
      rule: "require-scope",
      message: "Scope is required but not provided",
      severity: "error",
    });
    errors.push("Scope is required but not provided");
  }

  // Check if scope is in allowed list
  if (
    parsed.scope &&
    commitConfig.scopes &&
    commitConfig.scopes.length > 0 &&
    !commitConfig.scopes.includes(parsed.scope)
  ) {
    issues.push({
      rule: "allowed-scopes",
      message: `Scope "${parsed.scope}" is not in allowed scopes: ${commitConfig.scopes.join(", ")}`,
      severity: "warning",
    });
    warnings.push(
      `Scope "${parsed.scope}" is not in allowed scopes: ${commitConfig.scopes.join(", ")}`
    );
  }

  // Check body requirement
  if (commitConfig.requireBody && !parsed.body) {
    issues.push({
      rule: "require-body",
      message: "Commit body is required but not provided",
      severity: "error",
    });
    errors.push("Commit body is required but not provided");
  }

  // Extract the actual message part for rule checks
  const messageContent = parsed.isConventional
    ? parsed.title.replace(CONVENTIONAL_COMMIT_REGEX, "$4")
    : parsed.title;

  // Check imperative mood
  if (rules.imperativeMood && messageContent) {
    const moodCheck = checkImperativeMood(messageContent);
    if (!moodCheck.isImperative && moodCheck.suggestion) {
      issues.push({
        rule: "imperative-mood",
        message: `Use imperative mood: "${moodCheck.suggestion}" instead of "${messageContent.split(/\s+/)[0]}"`,
        severity: "warning",
      });
      warnings.push(
        `Use imperative mood: "${moodCheck.suggestion}" instead of "${messageContent.split(/\s+/)[0]}"`
      );
    }
  }

  // Check capitalization
  if (rules.capitalizeTitle && messageContent && !isCapitalized(messageContent)) {
    issues.push({
      rule: "capitalize-title",
      message: "Title should start with a capital letter",
      severity: "warning",
    });
    warnings.push("Title should start with a capital letter");
  }

  // Check trailing period
  if (rules.noTrailingPeriod && parsed.title.endsWith(".")) {
    issues.push({
      rule: "no-trailing-period",
      message: "Title should not end with a period",
      severity: "warning",
    });
    warnings.push("Title should not end with a period");
  }

  // Determine overall validity (only errors make it invalid)
  const valid = errors.length === 0;

  return {
    valid,
    message,
    issues,
    errors,
    warnings,
    suggestions,
    parsed: {
      title: parsed.title,
      body: parsed.body,
      type: parsed.type,
      scope: parsed.scope,
      isConventional: parsed.isConventional,
    },
  };
}

export const validateCommitMessageTool = {
  name: "validate_commit_message",
  description: `Validate a commit message against the user's configured rules.

Checks:
- Title length (max characters)
- Conventional commit format (if configured)
- Required scope (if configured)
- Allowed scopes (if configured)
- Required body (if configured)
- Imperative mood (e.g., "Add" not "Added")
- Title capitalization
- No trailing period

Returns:
- valid: Whether the message passes all error-level rules
- issues: Detailed list of all issues found
- errors: List of error messages (make the commit invalid)
- warnings: List of warning messages (advisory)
- suggestions: Helpful suggestions for improvement
- parsed: Parsed components (title, body, type, scope)`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
      message: {
        type: "string",
        description: "The commit message to validate",
      },
    },
    required: ["message"],
  },
  handler: validateCommitMessage,
};
