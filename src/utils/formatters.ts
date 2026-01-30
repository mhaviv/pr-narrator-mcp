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
 * Generate a purpose/summary from commits and file changes
 * Creates a concise, informative summary suitable for PR descriptions
 * 
 * Style guidelines (based on real PR analysis):
 * - Present tense verbs: "Updates", "Fixes", "Adds" (not "Updated")
 * - Write in PROSE style, not bullet points
 * - Main summary sentence, optionally followed by "The PR also..." prose
 * - Tests mentioned specifically: "includes unit tests for X"
 * - Target: ~50-300 characters for simple PRs, up to 500 for complex
 */
export function generatePurposeSummary(
  commits: Array<{ hash: string; message: string }>,
  files: Array<{ path: string; additions: number; deletions: number }>,
  branchName: string | null
): string {
  if (commits.length === 0 && files.length === 0) {
    return "_No changes detected_";
  }

  // Extract commit title and body separately
  const commitData = commits.map(c => {
    const lines = c.message.split("\n");
    const firstLine = lines[0];
    const body = lines.slice(1).join("\n").trim();
    
    // Clean up conventional commit prefixes and ticket prefixes from title
    const cleanedTitle = firstLine
      .replace(/^(feat|fix|chore|docs|test|refactor|style|ci|build|perf)(\([^)]*\))?:\s*/i, "")
      .replace(/^[A-Z]+-\d+:\s*/i, "") // Remove ticket prefix like PROJ-123:
      .replace(/^(Task|Bug|BugFix|Feature|Hotfix):\s*/i, "") // Remove branch-type prefixes
      .trim();
    
    // Extract bullet points from body if present (for understanding context, not copying)
    const bulletPoints = body
      .split("\n")
      .filter(line => /^[-*]\s+/.test(line.trim()))
      .map(line => line.trim().replace(/^[-*]\s+/, "").trim())
      .filter(line => line.length > 0);
    
    return { title: cleanedTitle, body, bulletPoints };
  }).filter(c => c.title.length > 0);

  const commitMessages = commitData.map(c => c.title);

  // Extract the main intent from the branch name
  let branchIntent = "";
  if (branchName) {
    branchIntent = branchName
      .replace(/^(feature|task|bug|hotfix|fix|chore|refactor|docs|test|ci|build|perf|style)\//i, "")
      .replace(/[A-Z]+-\d+[-_]?/gi, "") // Remove ticket patterns like PROJ-123
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Determine the type of PR from files and commits
  const isBugFix = branchName?.toLowerCase().includes("bug") || 
                   branchName?.toLowerCase().includes("fix") ||
                   commitMessages.some(m => /^fix/i.test(m));
  const isRefactor = branchName?.toLowerCase().includes("refactor") ||
                     commitMessages.some(m => /refactor/i.test(m));
  const isUpdate = commitMessages.some(m => /^update/i.test(m));

  // Categorize file changes with more detail
  const testFiles = files.filter(f => /test|spec|__tests__/i.test(f.path));
  const hasTests = testFiles.length > 0;
  const hasDocs = files.some(f => /\.md$|readme|docs?\//i.test(f.path));
  const hasCI = files.some(f => /ci|\.github|jenkinsfile|dockerfile|azure.*\.yml$|\.yaml$/i.test(f.path));

  // Extract component/module names from file paths for context
  const moduleContext = extractModuleContext(files);

  // Build the summary - always in PROSE style
  let summary = "";
  
  // Single commit - use the title, synthesize body into prose if available
  if (commitData.length === 1) {
    const { title, bulletPoints } = commitData[0];
    summary = convertToPresentTense(title);
    
    // Add file context if the message is short and we have module info
    if (summary.length < 60 && moduleContext && !summary.toLowerCase().includes(moduleContext.toLowerCase())) {
      const contextWords = moduleContext.toLowerCase().split(/\s+/);
      const summaryWords = summary.toLowerCase().split(/\s+/);
      const hasOverlap = contextWords.some(w => summaryWords.includes(w));
      if (!hasOverlap) {
        summary += ` in ${moduleContext}`;
      }
    }
    
    // If commit has bullet points, synthesize them (prose for ≤4, bullets for 5+)
    if (bulletPoints.length > 0) {
      // Filter out test-related bullets if we'll mention tests separately
      const relevantBullets = bulletPoints
        .filter(b => !hasTests || !/^add (unit )?tests?/i.test(b))
        .slice(0, 6); // Max 6 items
      
      if (relevantBullets.length > 0) {
        const additionalContent = synthesizeAdditionalChanges(relevantBullets);
        if (additionalContent) {
          summary += "\n\n" + additionalContent;
        }
      }
    }
  }
  // Multiple commits - synthesize from branch name and commits
  else if (commitData.length > 1) {
    // Lead with the main intent from branch name if available
    if (branchIntent) {
      const action = isBugFix ? "Fixes" : isRefactor ? "Refactors" : isUpdate ? "Updates" : "Implements";
      summary = `${action} ${branchIntent.toLowerCase()}`;
      
      // Add module context if available and not redundant
      if (moduleContext && !summary.toLowerCase().includes(moduleContext.toLowerCase())) {
        summary += ` in ${moduleContext}`;
      }
    } else {
      // Use first commit as the main description
      summary = convertToPresentTense(commitMessages[0]);
    }
    
    // Synthesize additional commits (prose for ≤4, bullets for 5+)
    const additionalChanges = commitMessages.slice(1)
      .filter(m => {
        const lower = m.toLowerCase();
        // Skip if too similar to main summary or if it's just "add tests" etc
        return !summary.toLowerCase().includes(lower.slice(0, 20)) && 
               !/^(add|adds|added)\s+(test|tests|unit test)s?$/i.test(m);
      })
      .slice(0, 6); // Max 6 items
    
    if (additionalChanges.length > 0) {
      const additionalContent = synthesizeAdditionalChanges(additionalChanges);
      if (additionalContent) {
        summary += "\n\n" + additionalContent;
      }
    }
  }
  // No commits but have files - use branch name
  else if (branchIntent) {
    const action = isBugFix ? "Fixes" : isRefactor ? "Refactors" : isUpdate ? "Updates" : "Implements";
    summary = `${action} ${branchIntent.toLowerCase()}`;
    if (moduleContext) {
      summary += ` in ${moduleContext}`;
    }
  }

  // Add change type context for CI/docs-only PRs
  if (!summary && hasCI) {
    summary = "Updates CI/CD pipeline configuration";
  } else if (!summary && hasDocs) {
    summary = "Updates documentation";
  }

  // Ensure first letter is capitalized
  if (summary) {
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  }

  // Add test mention if tests were added/modified and not already mentioned
  if (hasTests && !summary.toLowerCase().includes("test")) {
    // Try to extract what the tests are for
    const testContext = extractTestContext(testFiles, moduleContext);
    
    if (summary.length < 400) {
      if (summary.includes("\nThe PR also addresses the following:")) {
        // Already has bullet section
        summary += `\n- Includes ${testContext}`;
      } else if (summary.includes("\n")) {
        // Has newlines but no bullet section
        summary += `\n\nThe PR also includes ${testContext}.`;
      } else {
        // Single paragraph
        summary += `\n\nThe PR also includes ${testContext}.`;
      }
    }
  }

  // Truncate if too long
  if (summary.length > 500) {
    const truncateAt = summary.lastIndexOf(" ", 497);
    summary = summary.slice(0, truncateAt > 400 ? truncateAt : 497) + "...";
  }

  return summary || "_Add purpose description_";
}

/**
 * Extract meaningful module/component context from file paths
 */
function extractModuleContext(files: Array<{ path: string }>): string | null {
  if (files.length === 0) return null;
  
  // Common directories to skip
  const skipDirs = new Set(["src", "lib", "app", "packages", "modules", "components", "utils", "common", "shared", "core", "internal"]);
  
  // Extract meaningful directory names
  const directories: string[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i].toLowerCase();
      if (!skipDirs.has(part) && part.length > 2 && !part.startsWith(".")) {
        directories.push(parts[i]);
        break;
      }
    }
  }
  
  if (directories.length === 0) return null;
  
  // Find the most common directory
  const counts = new Map<string, number>();
  for (const dir of directories) {
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  
  // Return the most common, or combine top 2 if close
  if (sorted.length > 1 && sorted[0][1] - sorted[1][1] <= 1) {
    return `${sorted[0][0]} and ${sorted[1][0]}`;
  }
  
  return sorted[0][0];
}

/**
 * Extract context about what tests cover
 */
function extractTestContext(testFiles: Array<{ path: string }>, moduleContext: string | null): string {
  if (testFiles.length === 0) return "test coverage";
  
  // Try to extract what the tests are for from file names
  const testSubjects: string[] = [];
  for (const file of testFiles) {
    const fileName = file.path.split("/").pop() || "";
    let subject: string | null = null;
    
    // JS/TS pattern: "auth.test.ts", "feature.spec.js"
    const jsMatch = fileName.match(/^(.+?)[._]?(test|spec)\.[jt]sx?$/i);
    if (jsMatch && jsMatch[1]) {
      subject = jsMatch[1];
    }
    
    // Python pattern: "test_failure_notifications.py"
    const pyMatch = fileName.match(/^test[_-](.+)\.py$/i);
    if (pyMatch && pyMatch[1]) {
      subject = pyMatch[1];
    }
    
    if (subject) {
      const cleaned = subject.replace(/[-_]/g, " ").toLowerCase();
      if (cleaned.length > 2 && cleaned !== "index") {
        testSubjects.push(cleaned);
      }
    }
  }
  
  if (testSubjects.length === 1) {
    return `unit tests for ${testSubjects[0]}`;
  } else if (testSubjects.length > 1) {
    return `unit tests for ${testSubjects.slice(0, 2).join(" and ")}`;
  } else if (moduleContext) {
    return `unit tests for ${moduleContext}`;
  }
  
  return "test coverage";
}

/**
 * Synthesize additional changes into output
 * 
 * Based on PR analysis:
 * - 1-3 items: prose style ("The PR also X and Y")
 * - 4+ items: bullet points ("The PR also addresses the following:")
 */
function synthesizeAdditionalChanges(items: string[]): string {
  if (items.length === 0) return "";
  
  // Convert all items to present tense
  const converted = items.map(b => convertToPresentTense(b));
  
  // 4+ items: use bullets (avoids comma-heavy run-on sentences)
  if (converted.length >= 4) {
    return "The PR also addresses the following:\n" + converted.map(c => `- ${c}`).join("\n");
  }
  
  // 1-3 items: use prose
  const proseItems = converted.map((item, i) => {
    if (i === 0) return item;
    return item.charAt(0).toLowerCase() + item.slice(1);
  });
  
  if (proseItems.length === 1) {
    return `The PR also ${proseItems[0].charAt(0).toLowerCase() + proseItems[0].slice(1)}.`;
  }
  
  if (proseItems.length === 2) {
    return `The PR also ${proseItems[0].charAt(0).toLowerCase() + proseItems[0].slice(1)} and ${proseItems[1]}.`;
  }
  
  // 3 items: "X, Y, and Z"
  return `The PR also ${proseItems[0].charAt(0).toLowerCase() + proseItems[0].slice(1)}, ${proseItems[1]}, and ${proseItems[2]}.`;
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
