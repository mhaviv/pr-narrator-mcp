import simpleGit, { SimpleGit, DiffResult } from "simple-git";

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
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
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
    const git = createGit(repoPath);
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
  const git = createGit(repoPath);

  try {
    const isRepo = await isGitRepo(repoPath);
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
    const git = createGit(repoPath);
    const result = await git.branch();
    return result.current || null;
  } catch {
    return null;
  }
}

/**
 * Get staged changes (for commit message generation)
 */
export async function getStagedChanges(
  repoPath: string
): Promise<StagedChanges | null> {
  try {
    const git = createGit(repoPath);
    const status = await git.status();

    if (status.staged.length === 0) {
      return null;
    }

    // Get diff of staged changes
    const diff = await git.diff(["--cached"]);
    const diffStat = await git.diff(["--cached", "--numstat"]);

    const files = parseNumstat(diffStat, status.staged);
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      totalAdditions,
      totalDeletions,
      diff,
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
    const git = createGit(repoPath);

    // Get commits since base branch
    const logResult = await git.log([`${baseBranch}..HEAD`]);
    const commits: CommitInfo[] = logResult.all.map((commit) => ({
      hash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    // Get diff since base branch
    const diff = await git.diff([`${baseBranch}...HEAD`]);
    const diffStat = await git.diff([`${baseBranch}...HEAD`, "--numstat"]);

    const files = parseNumstat(diffStat);
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      commits,
      files,
      totalAdditions,
      totalDeletions,
      diff,
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
    const git = createGit(repoPath);
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
