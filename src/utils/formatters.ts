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
 * Truncate a string at a word boundary to fit within maxLength.
 * Preferred for commit titles where mid-word cuts look bad.
 * Falls back to hard truncation with ellipsis if no good boundary found.
 */
export function truncateAtWordBoundary(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;

  const truncated = str.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.6) {
    return truncated.slice(0, lastSpace);
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
 * Determine commit type from file paths using majority-based weighting.
 * Each file is classified by the first matching pattern (priority order),
 * then the type with the most files wins. "feat" wins ties so that a
 * single README doesn't override 15 code files.
 */
export function inferCommitType(filePaths: string[]): string {
  if (filePaths.length === 0) return "feat";

  const patterns: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /test|spec|__tests__/i, type: "test" },
    { pattern: /\.md$|readme|docs?\//i, type: "docs" },
    { pattern: /ci|\.github|jenkinsfile|dockerfile/i, type: "ci" },
    { pattern: /package\.json|package-lock\.json|requirements\.txt|gemfile|poetry\.lock|yarn\.lock|pnpm-lock\.yaml/i, type: "build" },
    { pattern: /\.ya?ml$|\.json$|config|\.env/i, type: "chore" },
    { pattern: /\.css$|\.scss$|\.less$|style/i, type: "style" },
  ];

  const typeCounts = new Map<string, number>();

  for (const filePath of filePaths) {
    let fileType = "feat";
    for (const { pattern, type } of patterns) {
      if (pattern.test(filePath)) {
        fileType = type;
        break;
      }
    }
    typeCounts.set(fileType, (typeCounts.get(fileType) || 0) + 1);
  }

  let bestType = "feat";
  let bestCount = typeCounts.get("feat") || 0;

  for (const [type, count] of typeCounts) {
    if (type === "feat") continue;
    if (count > bestCount) {
      bestCount = count;
      bestType = type;
    }
  }

  return bestType;
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
 * Map conventional commit types to Keep a Changelog section headers.
 */
export function mapCommitTypeToChangelogSection(type: string): string {
  const map: Record<string, string> = {
    feat: "Added",
    fix: "Fixed",
    docs: "Documentation",
    style: "Changed",
    refactor: "Changed",
    perf: "Changed",
    test: "Changed",
    build: "Changed",
    ci: "Changed",
    chore: "Changed",
    revert: "Reverted",
    other: "Other",
  };
  return map[type.toLowerCase()] || "Other";
}

/**
 * Format a single changelog entry as a bullet line.
 */
export function formatChangelogEntry(
  entry: { title: string; hash: string; author: string; scope: string | null },
  format: "keepachangelog" | "github-release" | "plain",
  includeAuthors: boolean
): string {
  const scopePrefix = entry.scope
    ? format === "plain"
      ? `[${entry.scope}] `
      : `**${entry.scope}**: `
    : "";

  switch (format) {
    case "keepachangelog":
      return `- ${scopePrefix}${entry.title} (${entry.hash})`;
    case "github-release":
      if (includeAuthors) {
        return `- ${scopePrefix}${entry.title} by **${entry.author}** in ${entry.hash}`;
      }
      return `- ${scopePrefix}${entry.title} in ${entry.hash}`;
    case "plain":
      return `- ${scopePrefix}${entry.title}`;
    default:
      return `- ${scopePrefix}${entry.title}`;
  }
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

export interface SummarizeOptions {
  /** Whether to include file counts and +/- line stats. Defaults to true. */
  includeStats?: boolean;
}

/**
 * Summarize file changes for context, with categorized breakdown
 */
export function summarizeFileChanges(
  files: Array<{ path: string; additions: number; deletions: number }>,
  options?: SummarizeOptions
): string {
  if (files.length === 0) {
    return "No files changed";
  }

  const includeStats = options?.includeStats ?? true;
  const summary: string[] = [];

  // Group by extension with category labels
  const byExtension = new Map<string, { count: number; category: string }>();
  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase() || "other";
    const existing = byExtension.get(ext);
    if (existing) {
      existing.count++;
    } else {
      byExtension.set(ext, { count: 1, category: getFileCategory(file.path) });
    }
  }

  // Sorted by count descending
  const sorted = Array.from(byExtension.entries())
    .sort((a, b) => b[1].count - a[1].count);

  if (includeStats) {
    const brief = sorted
      .slice(0, 3)
      .map(([ext, { count }]) => `${count} .${ext}`)
      .join(", ");
    summary.push(`${files.length} file(s) changed (${brief})`);
  }

  // Categorized breakdown (always shown for >3 files)
  if (files.length > 3) {
    const breakdown = sorted
      .map(([ext, { count, category }]) => `  ${count} .${ext} (${category})`)
      .join("\n");
    summary.push(breakdown);
  }

  if (includeStats) {
    const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);
    summary.push(`+${totalAdd} -${totalDel} lines`);
  }

  return summary.join("\n");
}

/**
 * Generate a best-effort commit title from file paths and change stats
 * when no summary is provided. Produces a descriptive scope-based title
 * without file counts — those belong in metadata, not the title.
 */
export function generateBestEffortTitle(
  files: Array<{ path: string; additions: number; deletions: number }>
): string {
  if (files.length === 0) return "Update project";
  if (files.length === 1) {
    return `Update ${files[0].path.split("/").pop()}`;
  }

  // Determine the dominant action from add/delete ratios
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const allNew = files.every(f => f.deletions === 0 && f.additions > 0);
  const allDeleted = files.every(f => f.additions === 0 && f.deletions > 0);

  let verb = "Update";
  if (allNew) verb = "Add";
  else if (allDeleted) verb = "Remove";
  else if (totalDel > totalAdd * 2) verb = "Refactor";

  // Find common directory (skip generic root dirs)
  const dirs = files.map(f => {
    const parts = f.path.split("/");
    parts.pop();
    return parts;
  });
  const commonParts: string[] = [];
  if (dirs.length > 0) {
    for (let i = 0; i < dirs[0].length; i++) {
      const segment = dirs[0][i];
      if (dirs.every(d => d[i] === segment)) {
        commonParts.push(segment);
      } else {
        break;
      }
    }
  }
  const scope = commonParts.filter(p => !["src", "lib", "app"].includes(p)).join("/");

  // Determine dominant file type
  const extCounts = new Map<string, number>();
  for (const f of files) {
    const ext = f.path.split(".").pop()?.toLowerCase() || "";
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
  }
  const sortedExts = Array.from(extCounts.entries()).sort((a, b) => b[1] - a[1]);
  const dominantExt = sortedExts[0]?.[0] || "";
  const dominantCategory = FILE_CATEGORIES[dominantExt] || dominantExt;

  if (scope) {
    return `${verb} ${scope}`;
  }

  if (dominantCategory && sortedExts[0]?.[1] === files.length) {
    return `${verb} ${dominantCategory}`;
  }

  if (dominantCategory) {
    return `${verb} ${dominantCategory} and related files`;
  }

  return `${verb} project files`;
}

/**
 * File extension to human-readable category mapping
 */
const FILE_CATEGORIES: Record<string, string> = {
  swift: "Swift source",
  kt: "Kotlin source",
  java: "Java source",
  ts: "TypeScript",
  tsx: "TypeScript/React",
  js: "JavaScript",
  jsx: "JavaScript/React",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C/C++ header",
  m: "Objective-C",
  mm: "Objective-C++",
  pbxproj: "Xcode project config",
  xcconfig: "Xcode build settings",
  xcscheme: "Xcode scheme",
  xcworkspacedata: "Xcode workspace",
  storyboard: "Interface Builder",
  xib: "Interface Builder",
  plist: "property list",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  sql: "SQL",
  md: "Markdown/docs",
  txt: "text",
  sh: "shell script",
  dockerfile: "Docker",
  lock: "lock file",
  toml: "TOML config",
  ini: "INI config",
  cfg: "config",
  env: "environment config",
  gradle: "Gradle build",
  podspec: "CocoaPods spec",
  png: "image",
  jpg: "image",
  jpeg: "image",
  svg: "SVG image",
  gif: "image",
  webp: "image",
  xcassets: "asset catalog",
};

function getFileCategory(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return FILE_CATEGORIES[ext] || ext;
}

export interface ChangeSummaryGroup {
  category: string;
  files: string[];
}

/**
 * Categorize all changed files into meaningful groups by type.
 * Gives the AI a structured view of everything that changed so it can
 * account for all files when writing commit messages.
 */
export function categorizeChanges(
  filePaths: string[]
): ChangeSummaryGroup[] {
  if (filePaths.length === 0) return [];

  const groups = new Map<string, string[]>();

  for (const filePath of filePaths) {
    const category = getFileCategory(filePath);
    const existing = groups.get(category);
    if (existing) {
      existing.push(filePath);
    } else {
      groups.set(category, [filePath]);
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([category, files]) => ({ category, files }));
}

/**
 * Generate a structured commit body from categorized file changes.
 * Groups files by category and produces a bulleted list.
 * For small groups (<=3 files) lists filenames; for larger groups shows count.
 */
export function generateStructuredBody(changeSummary: ChangeSummaryGroup[]): string {
  if (changeSummary.length === 0) return "";

  const lines: string[] = [];

  for (const group of changeSummary) {
    if (group.files.length === 1) {
      const fileName = group.files[0].split("/").pop();
      lines.push(`- ${group.category}: ${fileName}`);
    } else if (group.files.length <= 3) {
      const fileNames = group.files.map((f) => f.split("/").pop());
      lines.push(`- ${group.category}: ${fileNames.join(", ")}`);
    } else {
      lines.push(`- ${group.category}: ${group.files.length} files`);
    }
  }

  return lines.join("\n");
}

/**
 * Detect files that a commit summary likely doesn't cover.
 * Extracts "significant" filenames from the changed files and checks
 * if any keywords from those files appear in the summary.
 */
export function detectUncoveredFiles(
  summary: string,
  filePaths: string[]
): string[] {
  if (filePaths.length <= 1) return [];

  const summaryLower = summary.toLowerCase();
  const uncovered: string[] = [];

  for (const filePath of filePaths) {
    const fileName = filePath.split("/").pop() || "";
    const baseName = fileName.replace(/\.[^.]+$/, "");

    // Split camelCase/PascalCase and kebab-case into words
    const words = baseName
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .map(w => w.toLowerCase());

    // Check if any meaningful word from the filename appears in the summary
    const isMentioned = words.some(word => summaryLower.includes(word));

    if (!isMentioned) {
      uncovered.push(filePath);
    }
  }

  return uncovered;
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
      .replace(/^(feature|task|bug|hotfix|fix|chore|refactor|docs|test|ci|build|perf|style|ticket|release|rnd|experiment|spike|improvement|infra)\//i, "")
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
