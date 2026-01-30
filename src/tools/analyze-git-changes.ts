import { z } from "zod";
import {
  getGitInfo,
  getStagedChanges,
  getBranchChanges,
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
  getDefaultBranch,
} from "../utils/git.js";
import { loadConfig } from "../config/loader.js";
import {
  inferCommitType,
  inferScope,
  summarizeFileChanges,
} from "../utils/formatters.js";

export const analyzeGitChangesSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
  includeFullDiff: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include the full diff content (can be large)"),
});

export type AnalyzeGitChangesInput = z.infer<typeof analyzeGitChangesSchema>;

export interface AnalyzeGitChangesResult {
  isRepo: boolean;
  currentBranch: string | null;
  baseBranch: string;

  // Ticket/prefix info
  ticket: string | null;
  branchPrefix: string | null;
  allTickets: string[];

  // Staged changes (for commits)
  staged: {
    hasChanges: boolean;
    fileCount: number;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
    }>;
    summary: string;
    suggestedType: string;
    suggestedScope: string | null;
    diff?: string;
  };

  // Branch changes (for PRs)
  branch: {
    commitCount: number;
    commits: Array<{
      hash: string;
      message: string;
    }>;
    fileCount: number;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
    }>;
    summary: string;
    diff?: string;
  };

  // Errors
  errors: string[];
}

/**
 * Analyze git changes in the repository
 * Provides context for generating commit messages and PR content
 */
export async function analyzeGitChanges(
  input: AnalyzeGitChangesInput
): Promise<AnalyzeGitChangesResult> {
  const repoPath = input.repoPath || process.cwd();
  const includeFullDiff = input.includeFullDiff ?? false;
  const errors: string[] = [];

  // Load config to get ticket pattern and base branch
  const { config } = await loadConfig(repoPath);
  
  // Auto-detect base branch from repo, fall back to config value
  const baseBranch = await getDefaultBranch(repoPath, config.baseBranch);

  // Get git info
  const gitInfo = await getGitInfo(repoPath, baseBranch);

  if (!gitInfo.isRepo) {
    return {
      isRepo: false,
      currentBranch: null,
      baseBranch,
      ticket: null,
      branchPrefix: null,
      allTickets: [],
      staged: {
        hasChanges: false,
        fileCount: 0,
        files: [],
        summary: "Not a git repository",
        suggestedType: "feat",
        suggestedScope: null,
      },
      branch: {
        commitCount: 0,
        commits: [],
        fileCount: 0,
        files: [],
        summary: "Not a git repository",
      },
      errors: ["Not a git repository"],
    };
  }

  const currentBranch = gitInfo.currentBranch;

  // Extract ticket and branch prefix
  const ticket = currentBranch
    ? extractTicketFromBranch(currentBranch, config.ticketPattern)
    : null;
  const branchPrefix = currentBranch
    ? extractBranchPrefix(currentBranch)
    : null;

  // Get all tickets from commits
  const allTickets = await extractTicketsFromCommits(
    repoPath,
    baseBranch,
    config.ticketPattern
  );

  // Add ticket from branch if not in commits
  if (ticket && !allTickets.includes(ticket.toUpperCase())) {
    allTickets.unshift(ticket.toUpperCase());
  }

  // Get staged changes
  const stagedChanges = await getStagedChanges(repoPath);
  const stagedFiles = stagedChanges?.files ?? [];
  const stagedFilePaths = stagedFiles.map((f) => f.path);

  const staged = {
    hasChanges: stagedFiles.length > 0,
    fileCount: stagedFiles.length,
    files: stagedFiles.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    summary: summarizeFileChanges(stagedFiles),
    suggestedType: inferCommitType(stagedFilePaths),
    suggestedScope: inferScope(stagedFilePaths, config.commit.scopes),
    ...(includeFullDiff && stagedChanges ? { diff: stagedChanges.diff } : {}),
  };

  // Get branch changes
  const branchChanges = await getBranchChanges(repoPath, baseBranch);
  const branchFiles = branchChanges?.files ?? [];

  const branch = {
    commitCount: branchChanges?.commits.length ?? 0,
    commits: (branchChanges?.commits ?? []).map((c) => ({
      hash: c.hash,
      message: c.message,
    })),
    fileCount: branchFiles.length,
    files: branchFiles.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    summary: summarizeFileChanges(branchFiles),
    ...(includeFullDiff && branchChanges ? { diff: branchChanges.diff } : {}),
  };

  return {
    isRepo: true,
    currentBranch,
    baseBranch,
    ticket,
    branchPrefix,
    allTickets,
    staged,
    branch,
    errors,
  };
}

export const analyzeGitChangesTool = {
  name: "analyze_git_changes",
  description: `Analyze the current git repository state and changes.
Provides context for generating commit messages and PR content.

Returns:
- Repository info (branch, base branch)
- Ticket extracted from branch name
- Branch prefix (task/, bug/, feature/, etc.)
- Staged changes with file list and suggested commit type/scope
- Branch changes since base branch with commit history
- All tickets found in branch name and commits

Use this before generating commits or PRs to understand the changes.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
      includeFullDiff: {
        type: "boolean",
        description: "Include the full diff content (can be large)",
        default: false,
      },
    },
  },
  handler: analyzeGitChanges,
};
