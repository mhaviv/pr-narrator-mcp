import simpleGit, { SimpleGit, DiffResult } from "simple-git";
import { resolve, normalize } from "path";

/**
 * Maximum diff size in bytes to prevent memory issues with large diffs
 * Set to 500KB - diffs larger than this will be truncated
 */
export const MAX_DIFF_SIZE = 500_000;

export interface GitInfo {
  isRepo: boolean;
  currentBranch: string | null;
  baseBranch: string;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  remoteUrl: string | null;
}

export interface StagedChanges {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  diff: string;
  diffTruncated?: boolean;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface BranchChanges {
  commits: CommitInfo[];
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  diff: string;
  diffTruncated?: boolean;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Validate and normalize the repository path
 * Prevents path traversal and ensures consistent path handling
 */
export function validateRepoPath(inputPath: string | undefined): string {
  const repoPath = inputPath || process.cwd();
  const normalized = normalize(resolve(repoPath));

  // Check for suspicious path patterns (basic path traversal prevention)
  if (normalized.includes("\0")) {
    throw new Error("Invalid path: contains null bytes");
  }

  return normalized;
}

/**
 * Truncate diff if it exceeds MAX_DIFF_SIZE to prevent memory issues
 * Returns the truncated diff and a flag indicating if truncation occurred
 */
export function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_SIZE) {
    return { diff, truncated: false };
  }

  const truncatedDiff = diff.slice(0, MAX_DIFF_SIZE);
  const lastNewline = truncatedDiff.lastIndexOf("\n");
  const cleanTruncation = lastNewline > 0 ? truncatedDiff.slice(0, lastNewline) : truncatedDiff;

  return {
    diff: cleanTruncation + `\n\n[Diff truncated: exceeded ${MAX_DIFF_SIZE} bytes. Use git diff directly for full content.]`,
    truncated: true,
  };
}

/**
 * Create a git instance for the given repository path
 */
export function createGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    await git.revparse(["--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get basic git repository info
 */
export async function getGitInfo(
  repoPath: string,
  baseBranch: string = "main"
): Promise<GitInfo> {
  const validatedPath = validateRepoPath(repoPath);
  const git = createGit(validatedPath);

  try {
    const isRepo = await isGitRepo(validatedPath);
    if (!isRepo) {
      return {
        isRepo: false,
        currentBranch: null,
        baseBranch,
        hasStagedChanges: false,
        hasUnstagedChanges: false,
        remoteUrl: null,
      };
    }

    const [branchResult, status, remotes] = await Promise.all([
      git.branch(),
      git.status(),
      git.getRemotes(true),
    ]);

    const remoteUrl =
      remotes.find((r) => r.name === "origin")?.refs.fetch || null;

    return {
      isRepo: true,
      currentBranch: branchResult.current,
      baseBranch,
      hasStagedChanges: status.staged.length > 0,
      hasUnstagedChanges:
        status.modified.length > 0 || status.not_added.length > 0,
      remoteUrl,
    };
  } catch (error) {
    return {
      isRepo: false,
      currentBranch: null,
      baseBranch,
      hasStagedChanges: false,
      hasUnstagedChanges: false,
      remoteUrl: null,
    };
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const result = await git.branch();
    return result.current || null;
  } catch {
    return null;
  }
}

export interface BaseBranchResult {
  branch: string;
  isConfigured: boolean;
  alternatives: string[];
  isAmbiguous: boolean;
}

/**
 * Detect the base branch for PRs in this repository
 * 
 * Priority:
 * 1. If configuredBranch is set (from user's config), use it
 * 2. Auto-detect from repo, but flag if ambiguous (multiple candidates)
 * 
 * Returns branch name plus metadata about alternatives for the AI to 
 * ask the user if needed.
 */
export async function getDefaultBranch(
  repoPath: string,
  configuredBranch?: string
): Promise<string> {
  const result = await detectBaseBranch(repoPath, configuredBranch);
  return result.branch;
}

/**
 * Detect base branch with full metadata about alternatives
 */
export async function detectBaseBranch(
  repoPath: string,
  configuredBranch?: string
): Promise<BaseBranchResult> {
  // If user explicitly configured a branch, use it - no ambiguity
  if (configuredBranch) {
    return {
      branch: configuredBranch,
      isConfigured: true,
      alternatives: [],
      isAmbiguous: false,
    };
  }

  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const branchInfo = await git.branch();
    const branches = branchInfo.all;
    
    // Find all candidate base branches
    const candidates: string[] = [];
    const commonBranches = ["main", "master", "develop", "development"];
    
    for (const branch of commonBranches) {
      if (branches.includes(branch)) {
        candidates.push(branch);
      }
    }

    // If no candidates found, try origin HEAD
    if (candidates.length === 0) {
      try {
        const remoteHead = await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
        if (remoteHead) {
          const match = remoteHead.trim().match(/refs\/remotes\/origin\/(.+)/);
          if (match && match[1]) {
            return {
              branch: match[1],
              isConfigured: false,
              alternatives: [],
              isAmbiguous: false,
            };
          }
        }
      } catch {
        // Continue to fallback
      }
      
      return {
        branch: "main",
        isConfigured: false,
        alternatives: [],
        isAmbiguous: false,
      };
    }

    // Single candidate - no ambiguity
    if (candidates.length === 1) {
      return {
        branch: candidates[0],
        isConfigured: false,
        alternatives: [],
        isAmbiguous: false,
      };
    }

    // Multiple candidates - ambiguous!
    // Pick first one but flag as ambiguous with alternatives
    const selected = candidates[0];
    const alternatives = candidates.slice(1);
    
    return {
      branch: selected,
      isConfigured: false,
      alternatives,
      isAmbiguous: true,
    };
  } catch {
    return {
      branch: configuredBranch || "main",
      isConfigured: !!configuredBranch,
      alternatives: [],
      isAmbiguous: false,
    };
  }
}

/**
 * Get staged changes (for commit message generation)
 */
export async function getStagedChanges(
  repoPath: string
): Promise<StagedChanges | null> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const status = await git.status();

    if (status.staged.length === 0) {
      return null;
    }

    // Get diff of staged changes
    const rawDiff = await git.diff(["--cached"]);
    const diffStat = await git.diff(["--cached", "--numstat"]);

    // Truncate large diffs to prevent memory issues
    const { diff, truncated } = truncateDiff(rawDiff);

    const files = parseNumstat(diffStat, status.staged);
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      totalAdditions,
      totalDeletions,
      diff,
      diffTruncated: truncated,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Get all changes since base branch (for PR generation)
 */
export async function getBranchChanges(
  repoPath: string,
  baseBranch: string = "main"
): Promise<BranchChanges | null> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);

    // Get commits since base branch
    const logResult = await git.log([`${baseBranch}..HEAD`]);
    const commits: CommitInfo[] = logResult.all.map((commit) => ({
      hash: commit.hash.substring(0, 7),
      // Include body if present (simple-git splits subject and body)
      message: commit.body 
        ? `${commit.message}\n\n${commit.body}` 
        : commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    // Get diff since base branch
    const rawDiff = await git.diff([`${baseBranch}...HEAD`]);
    const diffStat = await git.diff([`${baseBranch}...HEAD`, "--numstat"]);

    // Truncate large diffs to prevent memory issues
    const { diff, truncated } = truncateDiff(rawDiff);

    const files = parseNumstat(diffStat);
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      commits,
      files,
      totalAdditions,
      totalDeletions,
      diff,
      diffTruncated: truncated,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Parse git numstat output into file changes
 */
function parseNumstat(
  numstat: string,
  stagedFiles?: string[]
): FileChange[] {
  const lines = numstat.trim().split("\n").filter(Boolean);
  const files: FileChange[] = [];

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 3) {
      const [addStr, delStr, path] = parts;
      const binary = addStr === "-" || delStr === "-";
      files.push({
        path,
        additions: binary ? 0 : parseInt(addStr, 10),
        deletions: binary ? 0 : parseInt(delStr, 10),
        binary,
      });
    }
  }

  // If we have a list of staged files, filter to only those
  if (stagedFiles && stagedFiles.length > 0) {
    return files.filter((f) => stagedFiles.includes(f.path));
  }

  return files;
}

/**
 * Extract ticket number from branch name using pattern
 */
export function extractTicketFromBranch(
  branchName: string,
  ticketPattern: string | undefined
): string | null {
  if (!ticketPattern || !branchName) {
    return null;
  }

  try {
    const regex = new RegExp(ticketPattern, "i");
    const match = branchName.match(regex);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Extract branch prefix (task, bug, feature, etc.)
 */
export function extractBranchPrefix(branchName: string): string | null {
  if (!branchName) {
    return null;
  }

  const match = branchName.match(
    /^(task|bug|feature|hotfix|chore|refactor|fix|docs|test|ci|build|perf|style)\//i
  );

  if (match) {
    // Capitalize first letter
    const prefix = match[1].toLowerCase();
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }

  return null;
}

/**
 * Extract all tickets from commits
 */
export async function extractTicketsFromCommits(
  repoPath: string,
  baseBranch: string,
  ticketPattern: string | undefined
): Promise<string[]> {
  if (!ticketPattern) {
    return [];
  }

  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const logResult = await git.log([`${baseBranch}..HEAD`]);

    const regex = new RegExp(ticketPattern, "gi");
    const tickets = new Set<string>();

    for (const commit of logResult.all) {
      const matches = commit.message.match(regex);
      if (matches) {
        matches.forEach((m) => tickets.add(m.toUpperCase()));
      }
    }

    return Array.from(tickets);
  } catch {
    return [];
  }
}
