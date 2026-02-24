import simpleGit, { SimpleGit } from "simple-git";
import { resolve, normalize } from "path";

/**
 * Maximum diff size in bytes to prevent memory issues with large diffs
 * Set to 500KB - diffs larger than this will be truncated
 */
export const MAX_DIFF_SIZE = 500_000;

/**
 * Maximum allowed length for user-provided regex patterns (e.g., TICKET_PATTERN)
 * Prevents overly complex patterns that could cause ReDoS
 */
const MAX_REGEX_LENGTH = 200;

/**
 * Validate a user-provided regex pattern for safety
 * - Checks that it compiles without error
 * - Rejects patterns that are too long
 * - Detects common catastrophic backtracking patterns
 * 
 * Returns the compiled RegExp if safe, or null if unsafe
 */
export function validateRegexPattern(pattern: string): { safe: boolean; error?: string } {
  if (!pattern) {
    return { safe: false, error: "Pattern is empty" };
  }

  if (pattern.length > MAX_REGEX_LENGTH) {
    return { safe: false, error: `Pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters` };
  }

  // Detect common ReDoS patterns: nested quantifiers like (a+)+, (a*)*,  (a+|b+)+
  const nestedQuantifiers = /(\([^)]*[+*][^)]*\))[+*]|\(\?:[^)]*[+*][^)]*\)[+*]/;
  if (nestedQuantifiers.test(pattern)) {
    return { safe: false, error: "Pattern contains nested quantifiers which may cause catastrophic backtracking" };
  }

  try {
    new RegExp(pattern);
    return { safe: true };
  } catch (e) {
    return { safe: false, error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Safely create a RegExp from a user-provided pattern
 * Returns null if the pattern is invalid or unsafe
 */
export function safeRegex(pattern: string, flags?: string): RegExp | null {
  const validation = validateRegexPattern(pattern);
  if (!validation.safe) {
    return null;
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

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

export interface WorkingTreeStatus {
  modified: string[];
  untracked: string[];
  deleted: string[];
  modifiedCount: number;
  untrackedCount: number;
  deletedCount: number;
  totalUncommitted: number;
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
 * Get unstaged changes in the working tree (modified tracked files, not yet staged)
 */
export async function getUnstagedChanges(
  repoPath: string
): Promise<StagedChanges | null> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const status = await git.status();

    const modifiedFiles = [
      ...status.modified,
      ...status.renamed.map((r) => r.to),
      ...status.deleted,
    ];

    if (modifiedFiles.length === 0) {
      return null;
    }

    const rawDiff = await git.diff();
    const diffStat = await git.diff(["--numstat"]);

    const { diff, truncated } = truncateDiff(rawDiff);

    const files = parseNumstat(diffStat, modifiedFiles);
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      totalAdditions,
      totalDeletions,
      diff,
      diffTruncated: truncated,
    };
  } catch {
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
 * Get working tree status (unstaged + untracked files)
 */
export async function getWorkingTreeStatus(
  repoPath: string
): Promise<WorkingTreeStatus> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const status = await git.status();

    const modified = [...status.modified, ...status.renamed.map(r => r.to)];
    const untracked = status.not_added;
    const deleted = status.deleted;

    return {
      modified,
      untracked,
      deleted,
      modifiedCount: modified.length,
      untrackedCount: untracked.length,
      deletedCount: deleted.length,
      totalUncommitted: modified.length + untracked.length + deleted.length,
    };
  } catch {
    return {
      modified: [],
      untracked: [],
      deleted: [],
      modifiedCount: 0,
      untrackedCount: 0,
      deletedCount: 0,
      totalUncommitted: 0,
    };
  }
}

export interface TagInfo {
  name: string;
  hash: string;
  date: string | null;
}

/**
 * Get list of tags sorted by creator date (most recent first).
 * Uses a single `git for-each-ref` call to avoid N+1 per-tag lookups.
 * Returns empty array if no tags exist or on error.
 */
export async function getTagList(repoPath: string): Promise<TagInfo[]> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);

    const raw = await git.raw([
      "for-each-ref",
      "refs/tags",
      "--sort=-creatordate",
      "--format=%(refname:short)%09%(objectname)%09%(creatordate:iso-strict)",
    ]);

    if (!raw || !raw.trim()) {
      return [];
    }

    const tags: TagInfo[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split("\t");
      const name = parts[0] ?? "";
      const hash = parts[1] ?? "";
      const date = parts[2] && parts[2].length > 0 ? parts[2] : null;

      if (!name) continue;

      tags.push({ name, hash, date });
    }

    return tags;
  } catch {
    return [];
  }
}

export interface RangeCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  body: string;
  author: string;
  date: string;
}

/**
 * Get all commits between two refs (exclusive of 'from', inclusive of 'to').
 * Uses git log from..to format.
 */
export async function getCommitRange(
  repoPath: string,
  from: string,
  to: string
): Promise<RangeCommitInfo[]> {
  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const logResult = await git.log([`${from}..${to}`]);

    return logResult.all.map((commit) => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      body: commit.body || "",
      author: commit.author_name,
      date: commit.date,
    }));
  } catch {
    return [];
  }
}

/**
 * Extract co-authors from commit body trailers.
 * Looks for "Co-authored-by: Name <email>" lines.
 * Returns array of author names (without email).
 */
export function extractCoAuthors(commitBody: string): string[] {
  if (!commitBody) return [];
  const regex = /Co-authored-by:\s*(.+?)\s*<[^>]+>/gi;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(commitBody)) !== null) {
    const name = match[1].trim();
    if (name) {
      names.push(name);
    }
  }
  return names;
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

  const regex = safeRegex(ticketPattern, "i");
  if (!regex) {
    return null;
  }

  const match = branchName.match(regex);
  return match ? match[0] : null;
}

const DEFAULT_BRANCH_PREFIXES = [
  "task", "bug", "feature", "hotfix", "chore", "refactor", "fix",
  "docs", "test", "ci", "build", "perf", "style",
  "rnd", "release", "experiment", "spike", "improvement", "infra",
];

/**
 * Extract branch prefix (task, bug, feature, rnd, etc.)
 * Accepts optional custom prefixes that extend the default list.
 */
export function extractBranchPrefix(
  branchName: string,
  customPrefixes?: string[]
): string | null {
  if (!branchName) {
    return null;
  }

  const allPrefixes = customPrefixes
    ? [...new Set([...DEFAULT_BRANCH_PREFIXES, ...customPrefixes.map(p => p.toLowerCase())])]
    : DEFAULT_BRANCH_PREFIXES;

  const escaped = allPrefixes.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^(${escaped.join("|")})\\/`, "i");
  const match = branchName.match(pattern);

  if (match) {
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

  const regex = safeRegex(ticketPattern, "gi");
  if (!regex) {
    return [];
  }

  try {
    const validatedPath = validateRepoPath(repoPath);
    const git = createGit(validatedPath);
    const logResult = await git.log([`${baseBranch}..HEAD`]);

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
