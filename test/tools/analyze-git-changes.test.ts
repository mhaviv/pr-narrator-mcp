import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeGitChanges } from "../../src/tools/analyze-git-changes.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getGitInfo: vi.fn(),
  getStagedChanges: vi.fn(),
  getBranchChanges: vi.fn(),
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
  validateRepoPath: vi.fn((path) => path || process.cwd()),
}));

// Mock the config loader
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

import {
  getGitInfo,
  getStagedChanges,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";
import { loadConfig } from "../../src/config/loader.js";

describe("analyzeGitChanges", () => {
  const defaultConfig = {
    config: {
      commit: {
        format: "conventional",
        maxTitleLength: 72,
        maxBodyLineLength: 100,
        requireScope: false,
        requireBody: false,
        scopes: ["auth", "api", "ui"],
        prefix: {
          enabled: true,
          ticketFormat: "{ticket}: ",
          branchFallback: true,
        },
        rules: {
          imperativeMood: true,
          capitalizeTitle: true,
          noTrailingPeriod: true,
        },
      },
      pr: { title: { prefix: { enabled: true } }, sections: [] },
      baseBranch: "main",
      ticketPattern: "PROJ-\\d+",
    },
    configPath: null,
    errors: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(defaultConfig);
  });

  describe("when not a git repository", () => {
    it("should return isRepo: false for non-git directory", async () => {
      vi.mocked(getGitInfo).mockResolvedValue({
        isRepo: false,
        currentBranch: null,
        baseBranch: "main",
        hasStagedChanges: false,
        hasUnstagedChanges: false,
        remoteUrl: null,
      });

      const result = await analyzeGitChanges({});

      expect(result.isRepo).toBe(false);
      expect(result.currentBranch).toBeNull();
      expect(result.errors).toContain("Not a git repository");
    });
  });

  describe("when in a git repository", () => {
    beforeEach(() => {
      vi.mocked(getGitInfo).mockResolvedValue({
        isRepo: true,
        currentBranch: "feature/PROJ-1234-add-login",
        baseBranch: "main",
        hasStagedChanges: true,
        hasUnstagedChanges: false,
        remoteUrl: "https://github.com/user/repo.git",
      });
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-1234", "PROJ-5678"]);
    });

    it("should return repository info", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await analyzeGitChanges({});

      expect(result.isRepo).toBe(true);
      expect(result.currentBranch).toBe("feature/PROJ-1234-add-login");
      expect(result.baseBranch).toBe("main");
    });

    it("should extract ticket from branch name", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);
      vi.mocked(getBranchChanges).mockResolvedValue(null);

      const result = await analyzeGitChanges({});

      expect(result.ticket).toBe("PROJ-1234");
    });

    it("should extract branch prefix", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);
      vi.mocked(getBranchChanges).mockResolvedValue(null);

      const result = await analyzeGitChanges({});

      expect(result.branchPrefix).toBe("Feature");
    });

    it("should collect all tickets from commits", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);
      vi.mocked(getBranchChanges).mockResolvedValue(null);

      const result = await analyzeGitChanges({});

      expect(result.allTickets).toContain("PROJ-1234");
      expect(result.allTickets).toContain("PROJ-5678");
    });

    describe("staged changes", () => {
      it("should analyze staged changes", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [
            { path: "src/auth/login.ts", additions: 50, deletions: 10, binary: false },
            { path: "src/auth/logout.ts", additions: 20, deletions: 5, binary: false },
          ],
          totalAdditions: 70,
          totalDeletions: 15,
          diff: "diff content",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.hasChanges).toBe(true);
        expect(result.staged.fileCount).toBe(2);
        expect(result.staged.files).toHaveLength(2);
        expect(result.staged.suggestedType).toBe("feat");
        expect(result.staged.suggestedScope).toBe("auth");
      });

      it("should handle no staged changes", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue(null);
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.hasChanges).toBe(false);
        expect(result.staged.fileCount).toBe(0);
      });

      it("should include diff when requested", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "src/index.ts", additions: 10, deletions: 0, binary: false }],
          totalAdditions: 10,
          totalDeletions: 0,
          diff: "full diff content here",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({ includeFullDiff: true });

        expect(result.staged.diff).toBe("full diff content here");
      });

      it("should not include diff by default", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "src/index.ts", additions: 10, deletions: 0, binary: false }],
          totalAdditions: 10,
          totalDeletions: 0,
          diff: "full diff content here",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({ includeFullDiff: false });

        expect(result.staged.diff).toBeUndefined();
      });
    });

    describe("branch changes", () => {
      it("should analyze branch changes for PR context", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue(null);
        vi.mocked(getBranchChanges).mockResolvedValue({
          commits: [
            { hash: "abc1234", message: "feat: Add login", author: "dev", date: "2024-01-01" },
            { hash: "def5678", message: "fix: Fix typo", author: "dev", date: "2024-01-02" },
          ],
          files: [
            { path: "src/auth/login.ts", additions: 100, deletions: 20, binary: false },
          ],
          totalAdditions: 100,
          totalDeletions: 20,
          diff: "branch diff",
        });

        const result = await analyzeGitChanges({});

        expect(result.branch.commitCount).toBe(2);
        expect(result.branch.commits).toHaveLength(2);
        expect(result.branch.commits[0].hash).toBe("abc1234");
        expect(result.branch.commits[0].message).toBe("feat: Add login");
        expect(result.branch.fileCount).toBe(1);
      });

      it("should handle no branch changes", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue(null);
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.branch.commitCount).toBe(0);
        expect(result.branch.commits).toHaveLength(0);
      });
    });

    describe("commit type inference", () => {
      it("should suggest test type for test files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "test/auth.test.ts", additions: 50, deletions: 0, binary: false }],
          totalAdditions: 50,
          totalDeletions: 0,
          diff: "",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.suggestedType).toBe("test");
      });

      it("should suggest docs type for markdown files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [{ path: "README.md", additions: 10, deletions: 5, binary: false }],
          totalAdditions: 10,
          totalDeletions: 5,
          diff: "",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.suggestedType).toBe("docs");
      });

      it("should suggest ci type for workflow files", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [
            { path: ".github/workflows/ci.yml", additions: 20, deletions: 0, binary: false },
          ],
          totalAdditions: 20,
          totalDeletions: 0,
          diff: "",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.suggestedType).toBe("ci");
      });
    });

    describe("scope inference", () => {
      it("should infer scope from file paths", async () => {
        vi.mocked(getStagedChanges).mockResolvedValue({
          files: [
            { path: "src/auth/login.ts", additions: 10, deletions: 0, binary: false },
            { path: "src/auth/logout.ts", additions: 10, deletions: 0, binary: false },
          ],
          totalAdditions: 20,
          totalDeletions: 0,
          diff: "",
        });
        vi.mocked(getBranchChanges).mockResolvedValue(null);

        const result = await analyzeGitChanges({});

        expect(result.staged.suggestedScope).toBe("auth");
      });
    });
  });
});
