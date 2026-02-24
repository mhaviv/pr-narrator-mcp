import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCommitMessage } from "../../src/tools/generate-commit-message.js";
import { defaultConfig } from "../../src/config/schema.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getStagedChanges: vi.fn(),
  getUnstagedChanges: vi.fn(),
  getWorkingTreeStatus: vi.fn(),
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  validateRepoPath: vi.fn((path: string) => path || process.cwd()),
}));

import {
  getStagedChanges,
  getUnstagedChanges,
  getWorkingTreeStatus,
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../../src/utils/git.js";

describe("generateCommitMessage", () => {
  const testConfig = {
    ...defaultConfig,
    ticketPattern: "PROJ-\\d+",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no unstaged changes (most tests use staged)
    vi.mocked(getUnstagedChanges).mockResolvedValue(null);
    vi.mocked(getWorkingTreeStatus).mockResolvedValue({
      modified: [],
      untracked: [],
      deleted: [],
      modifiedCount: 0,
      untrackedCount: 0,
      deletedCount: 0,
      totalUncommitted: 0,
    });
  });

  describe("when no changes at all", () => {
    it("should return error when no staged or unstaged changes", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);

      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("No staged or modified changes found");
    });

    it("should mention untracked files when only untracked exist", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);
      vi.mocked(getWorkingTreeStatus).mockResolvedValue({
        modified: [],
        untracked: ["new-file.ts"],
        deleted: [],
        modifiedCount: 0,
        untrackedCount: 1,
        deletedCount: 0,
        totalUncommitted: 1,
      });

      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("1 untracked file(s)");
      expect(result.errors[0]).toContain("git add");
    });
  });

  describe("when only unstaged changes exist", () => {
    beforeEach(() => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);
      vi.mocked(getUnstagedChanges).mockResolvedValue({
        files: [
          { path: "src/app.ts", additions: 15, deletions: 3, binary: false },
          { path: "src/utils.ts", additions: 5, deletions: 2, binary: false },
        ],
        totalAdditions: 20,
        totalDeletions: 5,
        diff: "diff --git a/src/app.ts b/src/app.ts\n-old\n+new",
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-42-add-search");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-42");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
    });

    it("should succeed with unstaged changes and set source to unstaged", async () => {
      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(true);
      expect(result.source).toBe("unstaged");
      expect(result.changes.fileCount).toBe(2);
    });

    it("should provide a hint with staging instructions", async () => {
      const result = await generateCommitMessage({}, testConfig);

      expect(result.hint).not.toBeNull();
      expect(result.hint).toContain("No staged changes found");
      expect(result.hint).toContain("git add");
      expect(result.hint).toContain("src/app.ts");
    });

    it("should use 'git add .' for many unstaged files", async () => {
      vi.mocked(getUnstagedChanges).mockResolvedValue({
        files: Array.from({ length: 8 }, (_, i) => ({
          path: `src/file${i}.ts`,
          additions: 5,
          deletions: 1,
          binary: false,
        })),
        totalAdditions: 40,
        totalDeletions: 8,
        diff: "mock diff",
      });

      const result = await generateCommitMessage({}, testConfig);

      expect(result.hint).toContain("git add .");
    });

    it("should include unstaged warning in validation", async () => {
      const result = await generateCommitMessage({}, testConfig);

      expect(result.validation.warnings.some((w) => w.includes("unstaged"))).toBe(true);
    });

    it("should still apply ticket prefix from branch", async () => {
      const result = await generateCommitMessage({ summary: "Add search feature" }, testConfig);

      expect(result.title).toContain("PROJ-42");
    });
  });

  describe("when staged changes exist", () => {
    beforeEach(() => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "src/index.ts", additions: 10, deletions: 5, binary: false }],
        totalAdditions: 10,
        totalDeletions: 5,
        diff: "mock diff",
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
      vi.mocked(extractBranchPrefix).mockReturnValue("feature");
    });

    it("should generate commit message with ticket prefix", async () => {
      const result = await generateCommitMessage({ summary: "Add login form" }, testConfig);

      expect(result.success).toBe(true);
      expect(result.source).toBe("staged");
      expect(result.hint).toBeNull();
      expect(result.title).toContain("PROJ-123");
    });

    it("should not call getUnstagedChanges when staged changes exist", async () => {
      await generateCommitMessage({ summary: "Add login form" }, testConfig);

      expect(getUnstagedChanges).not.toHaveBeenCalled();
    });

    it("should use branch prefix as fallback when no ticket", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue("task");

      const result = await generateCommitMessage({ summary: "Update readme" }, testConfig);

      expect(result.title).toContain("Task:");
    });

    it("should generate descriptive placeholder and guidelines when no summary provided", async () => {
      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(true);
      expect(result.title).toContain("Update");
      expect(result.title).not.toMatch(/\d+ files/);
      expect(result.commitGuidelines).not.toBeNull();
      expect(result.commitGuidelines).toContain("changeSummary");
      expect(result.changes.diff).not.toBeNull();
      expect(result.changeSummary.length).toBeGreaterThan(0);
    });

    it("should capitalize first letter", async () => {
      const result = await generateCommitMessage({ summary: "add login form" }, testConfig);

      expect(result.title).toMatch(/Add/);
    });

    it("should remove trailing period", async () => {
      const result = await generateCommitMessage({ summary: "Add login form." }, testConfig);

      expect(result.title).not.toMatch(/\.$/);
    });

    it("should warn about non-imperative mood", async () => {
      const result = await generateCommitMessage({ summary: "Added login form" }, testConfig);

      expect(result.validation.warnings.some((w) => w.includes("imperative"))).toBe(true);
    });

    it("should auto-truncate long titles and report available character budget", async () => {
      const longSummary = "A".repeat(150);
      const result = await generateCommitMessage({ summary: longSummary }, testConfig);

      expect(result.title.length).toBeLessThanOrEqual(testConfig.commit.maxTitleLength);
      expect(result.validation.warnings.some((w) => w.includes("Auto-truncated"))).toBe(true);
      expect(result.validation.warnings.some((w) => w.includes("leaving"))).toBe(true);
      expect(result.validation.truncatedSuggestion).not.toBeNull();
      expect(result.validation.truncatedSuggestion!.length).toBeLessThanOrEqual(
        testConfig.commit.maxTitleLength
      );
      expect(result.validation.truncatedSuggestion).toContain("...");
      expect(result.body).not.toBeNull();
      expect(result.body).toContain(longSummary);
      expect(result.fullMessage).toContain(result.title);
      expect(result.fullMessage).toContain(longSummary);
    });

    it("should provide diff and guidelines (not a pre-generated body) when includeBody is true", async () => {
      const result = await generateCommitMessage(
        { summary: "Add login", includeBody: true },
        testConfig
      );

      expect(result.body).toBeNull();
      expect(result.changes.diff).not.toBeNull();
      expect(result.commitGuidelines).not.toBeNull();
      expect(result.commitGuidelines).toContain("analyzing the actual diff");
      expect(result.commitGuidelines).toContain("DO NOT generate this");
    });

    it("should not pre-generate file-category body for multi-file commits", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [
          { path: "src/Models/User.swift", additions: 50, deletions: 0, binary: false },
          { path: "src/Models/Post.swift", additions: 30, deletions: 0, binary: false },
          { path: "src/Views/UserView.swift", additions: 40, deletions: 0, binary: false },
          { path: "src/Views/PostView.swift", additions: 35, deletions: 0, binary: false },
          { path: "project.pbxproj", additions: 20, deletions: 5, binary: false },
          { path: "README.md", additions: 10, deletions: 2, binary: false },
        ],
        totalAdditions: 185,
        totalDeletions: 7,
        diff: "mock diff content",
      });

      const result = await generateCommitMessage(
        { summary: "Add user and post models with views", includeBody: true },
        testConfig
      );

      expect(result.body).toBeNull();
      expect(result.changes.diff).toBe("mock diff content");
      expect(result.commitGuidelines).not.toBeNull();
      expect(result.changeSummary.find((g) => g.category === "Swift source")).toBeDefined();
      expect(result.changeSummary.find((g) => g.category === "Xcode project config")).toBeDefined();
    });

    it("should not include diff when summary provided without includeBody", async () => {
      const result = await generateCommitMessage(
        { summary: "Add login", includeBody: false },
        testConfig
      );

      expect(result.changes.diff).toBeNull();
      expect(result.commitGuidelines).toBeNull();
    });

    it("should not generate body when includeBody is false and title fits", async () => {
      const result = await generateCommitMessage(
        { summary: "Add login", includeBody: false },
        testConfig
      );

      expect(result.body).toBeNull();
    });

    it("should warn about files not covered by summary", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [
          { path: "src/VideoPlayerSDK.swift", additions: 50, deletions: 0, binary: false },
          { path: "src/BootstrapCoordinator.swift", additions: 20, deletions: 5, binary: false },
          { path: "src/LaunchArguments.swift", additions: 10, deletions: 2, binary: false },
        ],
        totalAdditions: 80,
        totalDeletions: 7,
        diff: "mock diff",
      });

      const result = await generateCommitMessage(
        { summary: "Add video player SDK integration" },
        testConfig
      );

      expect(result.coverageWarnings).not.toBeNull();
      expect(result.coverageWarnings).toContain("src/BootstrapCoordinator.swift");
      expect(result.coverageWarnings).toContain("src/LaunchArguments.swift");
    });

    it("should not warn when summary covers all files", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "src/auth/login.ts", additions: 10, deletions: 5, binary: false }],
        totalAdditions: 10,
        totalDeletions: 5,
        diff: "mock diff",
      });

      const result = await generateCommitMessage(
        { summary: "Fix login authentication" },
        testConfig
      );

      expect(result.coverageWarnings).toBeNull();
    });

    it("should always include changeSummary with categorized file breakdown", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [
          { path: "src/Player.swift", additions: 50, deletions: 0, binary: false },
          { path: "src/Config.swift", additions: 20, deletions: 5, binary: false },
          { path: "project.pbxproj", additions: 10, deletions: 2, binary: false },
        ],
        totalAdditions: 80,
        totalDeletions: 7,
        diff: "mock diff",
      });

      const result = await generateCommitMessage(
        { summary: "Add player integration" },
        testConfig
      );

      expect(result.changeSummary).toBeDefined();
      expect(result.changeSummary.length).toBeGreaterThan(0);

      const swiftGroup = result.changeSummary.find((g) => g.category === "Swift source");
      expect(swiftGroup).toBeDefined();
      expect(swiftGroup!.files).toHaveLength(2);
    });

    it("should expose availableSummaryLength accounting for prefix overhead", async () => {
      const result = await generateCommitMessage({ summary: "Add login form" }, testConfig);

      expect(result.context.availableSummaryLength).toBeDefined();
      const prefixLen = result.context.prefix.length;
      expect(result.context.availableSummaryLength).toBe(
        testConfig.commit.maxTitleLength - prefixLen
      );
    });

    it("should skip prefix on main branch", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("main");

      const result = await generateCommitMessage({ summary: "Update readme" }, testConfig);

      expect(result.title).not.toContain("PROJ-123");
      expect(result.title).not.toContain("Main:");
    });

    describe("with conventional format", () => {
      const conventionalConfig = {
        ...testConfig,
        commit: {
          ...testConfig.commit,
          format: "conventional" as const,
        },
      };

      it("should include commit type", async () => {
        const result = await generateCommitMessage(
          { summary: "Add login", type: "feat" },
          conventionalConfig
        );

        expect(result.title).toContain("Feat:");
      });

      it("should include scope when provided", async () => {
        const scopeConfig = {
          ...conventionalConfig,
          commit: {
            ...conventionalConfig.commit,
            includeScope: true,
          },
        };

        const result = await generateCommitMessage(
          { summary: "Add login", type: "feat", scope: "auth" },
          scopeConfig
        );

        expect(result.title).toContain("(auth)");
      });
    });
  });
});
