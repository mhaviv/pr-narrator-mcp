import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCommitMessage } from "../../src/tools/generate-commit-message.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getStagedChanges: vi.fn(),
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  validateRepoPath: vi.fn((path) => path || process.cwd()),
}));

// Mock the config loader
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

import {
  getStagedChanges,
  getCurrentBranch,
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../../src/utils/git.js";
import { loadConfig } from "../../src/config/loader.js";

describe("generateCommitMessage", () => {
  const defaultConfig = {
    config: {
      commit: {
        format: "conventional",
        maxTitleLength: 72,
        maxBodyLineLength: 100,
        requireScope: false,
        requireBody: false,
        scopes: [],
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

  describe("when no staged changes", () => {
    it("should return error when no staged changes", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue(null);

      const result = await generateCommitMessage({});

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "No staged changes found. Stage changes with 'git add' first."
      );
    });

    it("should return error when staged changes array is empty", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generateCommitMessage({});

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("with staged changes", () => {
    const mockStagedChanges = {
      files: [
        { path: "src/auth/login.ts", additions: 50, deletions: 10, binary: false },
        { path: "src/auth/logout.ts", additions: 20, deletions: 5, binary: false },
      ],
      totalAdditions: 70,
      totalDeletions: 15,
      diff: "diff content",
    };

    beforeEach(() => {
      vi.mocked(getStagedChanges).mockResolvedValue(mockStagedChanges);
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-auth");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
    });

    it("should generate commit with ticket prefix and capitalized type", async () => {
      const result = await generateCommitMessage({
        summary: "Add user authentication",
        type: "feat",
        scope: "auth",
      });

      expect(result.success).toBe(true);
      // Default: capitalized type format, no scope (includeScope: false by default)
      expect(result.title).toBe("PROJ-1234: Feat: Add user authentication");
      expect(result.context.ticket).toBe("PROJ-1234");
      expect(result.context.type).toBe("feat");
      expect(result.context.scope).toBe("auth");
    });

    it("should use branch prefix as fallback when no ticket", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");

      const result = await generateCommitMessage({
        summary: "Add login page",
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.title).toContain("Feature: ");
      expect(result.context.branchPrefix).toBe("Feature");
    });

    it("should infer commit type from file paths", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "test/auth.test.ts", additions: 10, deletions: 0, binary: false }],
        totalAdditions: 10,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generateCommitMessage({
        summary: "Add auth tests",
      });

      expect(result.success).toBe(true);
      expect(result.context.type).toBe("test");
    });

    it("should capitalize summary when rule enabled", async () => {
      const result = await generateCommitMessage({
        summary: "add login feature",
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.title).toContain("Add login feature");
    });

    it("should remove trailing period when rule enabled", async () => {
      const result = await generateCommitMessage({
        summary: "Add login feature.",
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.title).not.toMatch(/\.$/);
    });

    it("should warn about imperative mood violations", async () => {
      const result = await generateCommitMessage({
        summary: "Added login feature",
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.validation.warnings.some((w) => w.includes("imperative"))).toBe(true);
    });

    it("should warn when title exceeds max length", async () => {
      const longSummary = "A".repeat(100);
      const result = await generateCommitMessage({
        summary: longSummary,
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.validation.warnings.some((w) => w.includes("exceeds"))).toBe(true);
      expect(result.title.length).toBeLessThanOrEqual(72);
    });

    it("should include body when requested", async () => {
      const result = await generateCommitMessage({
        summary: "Add login feature",
        type: "feat",
        includeBody: true,
      });

      expect(result.success).toBe(true);
      expect(result.body).not.toBeNull();
      expect(result.body).toContain("file(s) changed");
      expect(result.fullMessage).toContain("\n");
    });

    it("should include ticket in body when available", async () => {
      const result = await generateCommitMessage({
        summary: "Add login feature",
        type: "feat",
        includeBody: true,
      });

      expect(result.body).toContain("PROJ-1234");
    });

    it("should generate generic summary when none provided", async () => {
      const result = await generateCommitMessage({
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.title).toContain("Update");
      expect(result.validation.warnings.some((w) => w.includes("No summary provided"))).toBe(
        true
      );
    });
  });

  describe("simple format", () => {
    it("should generate simple format without type/scope", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...defaultConfig,
        config: {
          ...defaultConfig.config,
          commit: {
            ...defaultConfig.config.commit,
            format: "simple",
          },
        },
      });

      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "README.md", additions: 5, deletions: 2, binary: false }],
        totalAdditions: 5,
        totalDeletions: 2,
        diff: "",
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue(null);

      const result = await generateCommitMessage({
        summary: "Update documentation",
      });

      expect(result.success).toBe(true);
      expect(result.title).toBe("Update documentation");
      expect(result.title).not.toContain("feat");
      expect(result.title).not.toContain(":");
    });
  });

  describe("prefix disabled", () => {
    it("should not add prefix when disabled", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...defaultConfig,
        config: {
          ...defaultConfig.config,
          commit: {
            ...defaultConfig.config.commit,
            prefix: {
              enabled: false,
              ticketFormat: "{ticket}: ",
              branchFallback: true,
            },
          },
        },
      });

      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "src/index.ts", additions: 10, deletions: 0, binary: false }],
        totalAdditions: 10,
        totalDeletions: 0,
        diff: "",
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-test");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");

      const result = await generateCommitMessage({
        summary: "Add feature",
        type: "feat",
      });

      expect(result.success).toBe(true);
      expect(result.title).not.toContain("PROJ-123");
      // Capitalized type format by default
      expect(result.title).toBe("Feat: Add feature");
    });
  });
});
