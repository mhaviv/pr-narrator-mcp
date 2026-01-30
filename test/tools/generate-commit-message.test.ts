import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCommitMessage } from "../../src/tools/generate-commit-message.js";
import { defaultConfig } from "../../src/config/schema.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getStagedChanges: vi.fn(),
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  validateRepoPath: vi.fn((path) => path || process.cwd()),
}));

import {
  getStagedChanges,
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
  });

  describe("when no staged changes", () => {
    it("should return error when no staged changes", async () => {
      vi.mocked(getStagedChanges).mockResolvedValue({ files: [], diff: "" });

      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("No staged changes found. Stage changes with 'git add' first.");
    });
  });

  describe("when staged changes exist", () => {
    beforeEach(() => {
      vi.mocked(getStagedChanges).mockResolvedValue({
        files: [{ path: "src/index.ts", additions: 10, deletions: 5 }],
        diff: "mock diff",
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
      vi.mocked(extractBranchPrefix).mockReturnValue("feature");
    });

    it("should generate commit message with ticket prefix", async () => {
      const result = await generateCommitMessage({ summary: "Add login form" }, testConfig);

      expect(result.success).toBe(true);
      expect(result.title).toContain("PROJ-123");
    });

    it("should use branch prefix as fallback when no ticket", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue("task");

      const result = await generateCommitMessage({ summary: "Update readme" }, testConfig);

      expect(result.title).toContain("Task:");
    });

    it("should generate generic message when no summary provided", async () => {
      const result = await generateCommitMessage({}, testConfig);

      expect(result.success).toBe(true);
      expect(result.title).toContain("Update");
      expect(result.validation.warnings.length).toBeGreaterThan(0);
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

      expect(result.validation.warnings.some(w => w.includes("imperative"))).toBe(true);
    });

    it("should truncate long titles", async () => {
      const longSummary = "A".repeat(100);
      const result = await generateCommitMessage({ summary: longSummary }, testConfig);

      expect(result.title.length).toBeLessThanOrEqual(testConfig.commit.maxTitleLength);
    });

    it("should include commit body when requested", async () => {
      const result = await generateCommitMessage({ summary: "Add login", includeBody: true }, testConfig);

      expect(result.body).not.toBeNull();
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
        const result = await generateCommitMessage({ summary: "Add login", type: "feat" }, conventionalConfig);

        // Type is capitalized by default
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

        const result = await generateCommitMessage({ summary: "Add login", type: "feat", scope: "auth" }, scopeConfig);

        expect(result.title).toContain("(auth)");
      });
    });
  });
});
