import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeGitChanges } from "../../src/tools/analyze-git-changes.js";
import { defaultConfig } from "../../src/config/schema.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getGitInfo: vi.fn(),
  getStagedChanges: vi.fn(),
  getBranchChanges: vi.fn(),
  getWorkingTreeStatus: vi.fn(),
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
  validateRepoPath: vi.fn((path: string) => path || process.cwd()),
}));

import {
  getGitInfo,
  getStagedChanges,
  getBranchChanges,
  getWorkingTreeStatus,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";

describe("analyzeGitChanges", () => {
  const testConfig = {
    ...defaultConfig,
    ticketPattern: "PROJ-\\d+",
    baseBranch: "main",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when not a git repository", () => {
    it("should return isRepo: false for non-git directory", async () => {
      vi.mocked(getGitInfo).mockResolvedValue({
        isRepo: false,
        currentBranch: null,
        baseBranch: "main",
        hasStagedChanges: false,
        hasUnstagedChanges: false,
      });

      const result = await analyzeGitChanges({}, testConfig);

      expect(result.isRepo).toBe(false);
      expect(result.errors).toContain("Not a git repository");
      expect(result.workingTree.hasChanges).toBe(false);
    });
  });

  describe("when in a git repository", () => {
    beforeEach(() => {
      vi.mocked(getGitInfo).mockResolvedValue({
        isRepo: true,
        currentBranch: "feature/PROJ-123-add-login",
        baseBranch: "main",
        hasStagedChanges: true,
        hasUnstagedChanges: false,
      });
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [],
        diff: "",
      });
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        diff: "",
      });
      vi.mocked(getWorkingTreeStatus).mockResolvedValue({
        modified: [],
        untracked: [],
        deleted: [],
        modifiedCount: 0,
        untrackedCount: 0,
        deletedCount: 0,
        totalUncommitted: 0,
      });
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
      vi.mocked(extractBranchPrefix).mockReturnValue("feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
    });

    it("should return repository info", async () => {
      const result = await analyzeGitChanges({}, testConfig);

      expect(result.isRepo).toBe(true);
      expect(result.currentBranch).toBe("feature/PROJ-123-add-login");
      expect(result.baseBranch).toBe("main");
    });

    it("should extract ticket from branch name", async () => {
      const result = await analyzeGitChanges({}, testConfig);

      expect(result.ticket).toBe("PROJ-123");
    });

    it("should extract branch prefix", async () => {
      const result = await analyzeGitChanges({}, testConfig);

      expect(result.branchPrefix).toBe("feature");
    });

    it("should collect all tickets from commits", async () => {
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-456", "PROJ-789"]);

      const result = await analyzeGitChanges({}, testConfig);

      expect(result.allTickets).toContain("PROJ-123");
      expect(result.allTickets).toContain("PROJ-456");
      expect(result.allTickets).toContain("PROJ-789");
    });

    describe("staged changes", () => {
      it("should analyze staged changes", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [
            { path: "src/auth/login.ts", additions: 50, deletions: 10 },
            { path: "src/auth/logout.ts", additions: 30, deletions: 5 },
          ],
          diff: "mock diff content",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.hasChanges).toBe(true);
        expect(result.staged.fileCount).toBe(2);
        expect(result.staged.files).toHaveLength(2);
      });

      it("should handle no staged changes", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.hasChanges).toBe(false);
        expect(result.staged.fileCount).toBe(0);
      });

      it("should include diff when requested", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "src/index.ts", additions: 10, deletions: 5 }],
          diff: "mock diff content",
        });

        const result = await analyzeGitChanges({ includeFullDiff: true }, testConfig);

        expect(result.staged.diff).toBe("mock diff content");
      });

      it("should not include diff by default", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "src/index.ts", additions: 10, deletions: 5 }],
          diff: "mock diff content",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.diff).toBeUndefined();
      });
    });

    describe("branch changes", () => {
      it("should analyze branch changes for PR context", async () => {
        vi.mocked(getBranchChanges).mockResolvedValue({
          commits: [
            { hash: "abc1234", message: "feat: Add login" },
            { hash: "def5678", message: "fix: Handle errors" },
          ],
          files: [
            { path: "src/auth/login.ts", additions: 100, deletions: 20 },
          ],
          diff: "branch diff",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.branch.commitCount).toBe(2);
        expect(result.branch.commits).toHaveLength(2);
        expect(result.branch.fileCount).toBe(1);
      });

      it("should handle no branch changes", async () => {
        vi.mocked(getBranchChanges).mockResolvedValue({
          commits: [],
          files: [],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.branch.commitCount).toBe(0);
        expect(result.branch.fileCount).toBe(0);
      });
    });

    describe("commit type inference", () => {
      it("should suggest test type for test files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "test/auth.test.ts", additions: 50, deletions: 0 }],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.suggestedType).toBe("test");
      });

      it("should suggest docs type for markdown files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "README.md", additions: 20, deletions: 5 }],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.suggestedType).toBe("docs");
      });

      it("should suggest ci type for workflow files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: ".github/workflows/ci.yml", additions: 30, deletions: 0 }],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.suggestedType).toBe("ci");
      });
    });

    describe("scope inference", () => {
      it("should infer scope from file paths", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [
            { path: "src/auth/login.ts", additions: 50, deletions: 10 },
            { path: "src/auth/logout.ts", additions: 30, deletions: 5 },
          ],
          diff: "",
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.staged.suggestedScope).toBe("auth");
      });
    });

    describe("working tree", () => {
      it("should report unstaged modified files", async () => {
        vi.mocked(getWorkingTreeStatus).mockResolvedValue({
          modified: ["src/utils.ts", "README.md"],
          untracked: [],
          deleted: [],
          modifiedCount: 2,
          untrackedCount: 0,
          deletedCount: 0,
          totalUncommitted: 2,
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.workingTree.hasChanges).toBe(true);
        expect(result.workingTree.modifiedCount).toBe(2);
        expect(result.workingTree.modified).toEqual(["src/utils.ts", "README.md"]);
      });

      it("should report untracked files", async () => {
        vi.mocked(getWorkingTreeStatus).mockResolvedValue({
          modified: [],
          untracked: ["new-file.ts"],
          deleted: [],
          modifiedCount: 0,
          untrackedCount: 1,
          deletedCount: 0,
          totalUncommitted: 1,
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.workingTree.hasChanges).toBe(true);
        expect(result.workingTree.untrackedCount).toBe(1);
        expect(result.workingTree.untracked).toEqual(["new-file.ts"]);
      });

      it("should report deleted files", async () => {
        vi.mocked(getWorkingTreeStatus).mockResolvedValue({
          modified: [],
          untracked: [],
          deleted: ["old-file.ts"],
          modifiedCount: 0,
          untrackedCount: 0,
          deletedCount: 1,
          totalUncommitted: 1,
        });

        const result = await analyzeGitChanges({}, testConfig);

        expect(result.workingTree.hasChanges).toBe(true);
        expect(result.workingTree.deletedCount).toBe(1);
      });

      it("should report no changes when working tree is clean", async () => {
        const result = await analyzeGitChanges({}, testConfig);

        expect(result.workingTree.hasChanges).toBe(false);
        expect(result.workingTree.totalCount).toBe(0);
      });
    });
  });
});
