import type { PrefixConfig } from "../config/schema.js";

/**
 * Format the prefix for commits or PR titles
 * Priority: ticket > branch prefix (if branchFallback enabled)
 * 
 * Examples with style="capitalized":
 * - Ticket found: "PROJ-123: "
 * - Branch prefix "task": "Task: "
 * 
 * Examples with style="bracketed":
 * - Ticket found: "[PROJ-123] "
 * - Branch prefix "task": "[Task] "
 */
export function formatPrefix(
  prefixConfig: PrefixConfig,
  ticket: string | null,
  branchPrefix: string | null
): string {
  if (!prefixConfig.enabled) {
    return "";
  }

  const style = prefixConfig.style || "capitalized";
  let prefixValue: string | null = null;

  // Use ticket if found
  if (ticket) {
    prefixValue = ticket;
  } else if (prefixConfig.branchFallback && branchPrefix) {
    // Capitalize branch prefix (task -> Task, bug -> Bug)
    prefixValue = branchPrefix.charAt(0).toUpperCase() + branchPrefix.slice(1).toLowerCase();
  }

  if (!prefixValue) {
    return "";
  }

  // Format based on style
  if (style === "bracketed") {
    return `[${prefixValue}] `;
  }
  
  // Default: capitalized style with colon
  return `${prefixValue}: `;
}

/**
 * Enforce imperative mood by checking first word
 * Returns suggestion if not imperative
 */
export function checkImperativeMood(message: string): {
  isImperative: boolean;
  suggestion: string | null;
} {
  const firstWord = message.split(/\s+/)[0]?.toLowerCase();

  // Common past tense verbs that should be imperative
  const pastToImperative: Record<string, string> = {
    added: "Add",
    fixed: "Fix",
    updated: "Update",
    removed: "Remove",
    deleted: "Delete",
    changed: "Change",
    created: "Create",
    implemented: "Implement",
    refactored: "Refactor",
    improved: "Improve",
    resolved: "Resolve",
    corrected: "Correct",
    modified: "Modify",
    moved: "Move",
    renamed: "Rename",
    upgraded: "Upgrade",
    downgraded: "Downgrade",
    enabled: "Enable",
    disabled: "Disable",
    configured: "Configure",
    initialized: "Initialize",
    merged: "Merge",
    reverted: "Revert",
  };

  // Common gerunds (-ing) that should be imperative
  const gerundToImperative: Record<string, string> = {
    adding: "Add",
    fixing: "Fix",
    updating: "Update",
    removing: "Remove",
    deleting: "Delete",
    changing: "Change",
    creating: "Create",
    implementing: "Implement",
    refactoring: "Refactor",
    improving: "Improve",
    resolving: "Resolve",
    correcting: "Correct",
    modifying: "Modify",
    moving: "Move",
    renaming: "Rename",
  };

  if (pastToImperative[firstWord]) {
    return {
      isImperative: false,
      suggestion: pastToImperative[firstWord],
    };
  }

  if (gerundToImperative[firstWord]) {
    return {
      isImperative: false,
      suggestion: gerundToImperative[firstWord],
    };
  }

  return {
    isImperative: true,
    suggestion: null,
  };
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Check if first letter is capitalized
 */
export function isCapitalized(str: string): boolean {
  if (!str) return false;
  const firstChar = str.charAt(0);
  return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
}

/**
 * Remove trailing period from a string
 */
export function removeTrailingPeriod(str: string): string {
  return str.replace(/\.+$/, "");
}

/**
 * Truncate a string to max length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Format a ticket link
 */
export function formatTicketLink(
  ticket: string,
  linkFormat: string | undefined
): string {
  if (!linkFormat) {
    return ticket;
  }
  return `[${ticket}](${linkFormat.replace("{ticket}", ticket)})`;
}

/**
 * Format multiple tickets as a list
 */
export function formatTicketLinks(
  tickets: string[],
  linkFormat: string | undefined
): string {
  if (tickets.length === 0) {
    return "No tickets found";
  }

  return tickets
    .map((ticket) => `- ${formatTicketLink(ticket, linkFormat)}`)
    .join("\n");
}

/**
 * Determine commit type from file paths
 */
export function inferCommitType(filePaths: string[]): string {
  // Order matters: more specific patterns must come before general ones
  const patterns: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /test|spec|__tests__/i, type: "test" },
    { pattern: /\.md$|readme|docs?\//i, type: "docs" },
    { pattern: /ci|\.github|jenkinsfile|dockerfile/i, type: "ci" },
    // "build" must come before "chore" since package.json matches both \.json$ and package\.json
    { pattern: /package\.json|package-lock\.json|requirements\.txt|gemfile|poetry\.lock|yarn\.lock|pnpm-lock\.yaml/i, type: "build" },
    { pattern: /\.ya?ml$|\.json$|config|\.env/i, type: "chore" },
    { pattern: /\.css$|\.scss$|\.less$|style/i, type: "style" },
  ];

  for (const { pattern, type } of patterns) {
    if (filePaths.some((path) => pattern.test(path))) {
      return type;
    }
  }

  // Default based on common patterns in file content would require reading files
  // For now, return "feat" as a sensible default
  return "feat";
}

/**
 * Infer scope from file paths
 */
export function inferScope(
  filePaths: string[],
  allowedScopes?: string[]
): string | null {
  if (filePaths.length === 0) {
    return null;
  }

  // Try to find a common directory
  const directories = filePaths.map((path) => {
    const parts = path.split("/");
    // Return first significant directory (skip src, lib, app, etc.)
    const skipDirs = ["src", "lib", "app", "packages", "modules"];
    for (const part of parts) {
      if (!skipDirs.includes(part.toLowerCase()) && !part.includes(".")) {
        return part.toLowerCase();
      }
    }
    return null;
  });

  // Find most common directory
  const counts = new Map<string, number>();
  for (const dir of directories) {
    if (dir) {
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
  }

  if (counts.size === 0) {
    return null;
  }

  // Get the most common one
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const inferredScope = sorted[0][0];

  // If we have allowed scopes, check if inferred is in the list
  if (allowedScopes && allowedScopes.length > 0) {
    if (allowedScopes.includes(inferredScope)) {
      return inferredScope;
    }
    // Try to find a matching allowed scope
    for (const scope of allowedScopes) {
      if (inferredScope.includes(scope) || scope.includes(inferredScope)) {
        return scope;
      }
    }
    return null;
  }

  return inferredScope;
}

/**
 * Format a conventional commit message (legacy format with lowercase type)
 * @deprecated Use formatCommitTitle for more flexible formatting
 */
export function formatConventionalCommit(
  type: string,
  scope: string | null,
  message: string,
  breaking: boolean = false
): string {
  const scopePart = scope ? `(${scope})` : "";
  const breakingMark = breaking ? "!" : "";
  return `${type}${scopePart}${breakingMark}: ${message}`;
}

/**
 * Format the commit type with the specified format
 * - "capitalized": "Fix: message" or "Fix(scope): message"
 * - "bracketed": "[Fix] message" or "[Fix](scope) message"
 */
export function formatCommitType(
  type: string,
  typeFormat: "capitalized" | "bracketed",
  scope: string | null,
  includeScope: boolean
): string {
  // Capitalize the type (e.g., "feat" -> "Feat", "fix" -> "Fix")
  const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
  
  const scopePart = includeScope && scope ? `(${scope})` : "";
  
  if (typeFormat === "bracketed") {
    return `[${capitalizedType}]${scopePart} `;
  }
  
  // Default: capitalized format
  return `${capitalizedType}${scopePart}: `;
}

/**
 * Check if a branch is a main/default branch (should not have prefix)
 */
export function isMainBranch(branchName: string | null): boolean {
  if (!branchName) return true;
  const mainBranches = ["main", "master", "develop", "development"];
  return mainBranches.includes(branchName.toLowerCase());
}

/**
 * Summarize file changes for context
 */
export function summarizeFileChanges(
  files: Array<{ path: string; additions: number; deletions: number }>
): string {
  if (files.length === 0) {
    return "No files changed";
  }

  const summary: string[] = [];

  // Group by extension
  const byExtension = new Map<string, number>();
  for (const file of files) {
    const ext = file.path.split(".").pop() || "other";
    byExtension.set(ext, (byExtension.get(ext) || 0) + 1);
  }

  // Top extensions
  const topExtensions = Array.from(byExtension.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ext, count]) => `${count} .${ext}`)
    .join(", ");

  summary.push(`${files.length} file(s) changed (${topExtensions})`);

  // Add/delete summary
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);
  summary.push(`+${totalAdd} -${totalDel} lines`);

  return summary.join("\n");
}

/**
 * Strip conventional commit prefixes, ticket prefixes, and branch-style prefixes
 * from a commit title to get the clean summary text.
 */
export function cleanCommitTitle(title: string): string {
  return title
    .replace(/^(feat|fix|chore|docs|test|refactor|style|ci|build|perf)(\([^)]*\))?:\s*/i, "")
    .replace(/^[A-Z]+-\d+:\s*/i, "")
    .replace(/^\[?[A-Z]+-\d+\]?\s*/i, "")
    .replace(/^(Task|Bug|BugFix|Feature|Hotfix|Ticket|Release):\s*/i, "")
    .trim();
}

/**
 * Extract a PR title summary from commits.
 * Uses the oldest commit (last in git-log array) as the main feature description,
 * since the first commit on a feature branch typically describes the main intent.
 * Falls back to the most recent commit if the oldest one is generic.
 */
export function extractTitleFromCommits(
  commits: Array<{ hash: string; message: string }>
): string | null {
  if (commits.length === 0) return null;

  // Try oldest commit first (last in array - typically the main feature commit)
  const oldestTitle = cleanCommitTitle(commits[commits.length - 1].message.split("\n")[0]);
  if (oldestTitle && oldestTitle.length > 5) {
    return oldestTitle.charAt(0).toUpperCase() + oldestTitle.slice(1);
  }

  // Fall back to newest commit
  const newestTitle = cleanCommitTitle(commits[0].message.split("\n")[0]);
  if (newestTitle && newestTitle.length > 5) {
    return newestTitle.charAt(0).toUpperCase() + newestTitle.slice(1);
  }

  return null;
}

/**
 * Generate a basic purpose/summary from commits
 * Analyzes ALL commits to build a comprehensive placeholder.
 * The AI calling this tool will enhance it using purposeContext and purposeGuidelines.
 */
export function generatePurposeSummary(
  commits: Array<{ hash: string; message: string }>,
  files: Array<{ path: string; additions: number; deletions: number }>,
  branchName: string | null
): string {
  if (commits.length === 0 && files.length === 0) {
    return "_No changes detected_";
  }

  if (commits.length > 0) {
    // Use extractTitleFromCommits for the main summary line
    const mainTitle = extractTitleFromCommits(commits);
    if (mainTitle) {
      return convertToPresentTense(mainTitle);
    }
  }

  // Fallback to branch name
  if (branchName) {
    const branchIntent = branchName
      .replace(/^(feature|task|bug|hotfix|fix|chore|refactor|docs|test|ci|build|perf|style|ticket|release)\//i, "")
      .replace(/[A-Z]+-\d+[-_]?/gi, "")
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    if (branchIntent) {
      const capitalized = branchIntent.charAt(0).toUpperCase() + branchIntent.slice(1);
      return convertToPresentTense(capitalized);
    }
  }

  return "_Add purpose description_";
}

/**
 * Convert a commit message to present tense action verb style
 * "Added feature" -> "Adds feature"
 * "Fixed bug" -> "Fixes bug"
 * "Add feature" -> "Adds feature"
 * "Fix bug" -> "Fixes bug"
 */
function convertToPresentTense(message: string): string {
  // Past tense -> Present tense
  const pastToPresent: Record<string, string> = {
    added: "Adds",
    fixed: "Fixes",
    updated: "Updates",
    removed: "Removes",
    deleted: "Deletes",
    changed: "Changes",
    created: "Creates",
    implemented: "Implements",
    refactored: "Refactors",
    improved: "Improves",
    resolved: "Resolves",
    corrected: "Corrects",
    modified: "Modifies",
    moved: "Moves",
    renamed: "Renames",
    upgraded: "Upgrades",
    downgraded: "Downgrades",
    enabled: "Enables",
    disabled: "Disables",
    configured: "Configures",
    initialized: "Initializes",
    merged: "Merges",
    reverted: "Reverts",
    migrated: "Migrates",
    decoupled: "Decouples",
    restored: "Restores",
  };

  // Imperative -> Third person present tense
  const imperativeToPresent: Record<string, string> = {
    add: "Adds",
    fix: "Fixes",
    update: "Updates",
    remove: "Removes",
    delete: "Deletes",
    change: "Changes",
    create: "Creates",
    implement: "Implements",
    refactor: "Refactors",
    improve: "Improves",
    resolve: "Resolves",
    correct: "Corrects",
    modify: "Modifies",
    move: "Moves",
    rename: "Renames",
    upgrade: "Upgrades",
    downgrade: "Downgrades",
    enable: "Enables",
    disable: "Disables",
    configure: "Configures",
    initialize: "Initializes",
    merge: "Merges",
    revert: "Reverts",
    migrate: "Migrates",
    decouple: "Decouples",
    restore: "Restores",
    bump: "Bumps",
  };

  const words = message.split(/\s+/);
  if (words.length === 0) return message;

  const firstWord = words[0].toLowerCase();
  
  // Check past tense first
  if (pastToPresent[firstWord]) {
    words[0] = pastToPresent[firstWord];
    return words.join(" ");
  }
  
  // Then check imperative mood
  if (imperativeToPresent[firstWord]) {
    words[0] = imperativeToPresent[firstWord];
    return words.join(" ");
  }

  // If already in correct form or unknown, just capitalize first letter
  if (words[0] && words[0][0]) {
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  }
  
  return words.join(" ");
}
