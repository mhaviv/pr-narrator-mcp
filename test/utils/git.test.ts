import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractTicketFromBranch,
  extractBranchPrefix,
} from "../../src/utils/git.js";

// Create mock functions
const mockRaw = vi.fn();
const mockBranchLocal = vi.fn();

// Mock simple-git module
vi.mock("simple-git", () => ({
  default: vi.fn(() => ({
    raw: mockRaw,
    branchLocal: mockBranchLocal,
    revparse: vi.fn().mockResolvedValue("/fake/.git"),
  })),
}));

// Import after mock setup
import { getDefaultBranch } from "../../src/utils/git.js";

describe("git utilities", () => {
  describe("extractTicketFromBranch", () => {
    const jiraPattern = "PROJ-\\d+";
    const genericPattern = "[A-Z]+-\\d+";

    it("should extract ticket from feature branch", () => {
      expect(
        extractTicketFromBranch("feature/PROJ-1234-add-login", jiraPattern)
      ).toBe("PROJ-1234");
    });

    it("should extract ticket from branch with ticket at start", () => {
      expect(
        extractTicketFromBranch("PROJ-5678-fix-bug", jiraPattern)
      ).toBe("PROJ-5678");
    });

    it("should extract ticket case-insensitively", () => {
      expect(
        extractTicketFromBranch("feature/proj-1234-add-login", jiraPattern)
      ).toBe("proj-1234");
    });

    it("should return null when no ticket found", () => {
      expect(
        extractTicketFromBranch("feature/add-login", jiraPattern)
      ).toBe(null);
    });

    it("should return null when no pattern provided", () => {
      expect(
        extractTicketFromBranch("feature/PROJ-1234", undefined)
      ).toBe(null);
    });

    it("should return null for empty branch name", () => {
      expect(extractTicketFromBranch("", jiraPattern)).toBe(null);
    });

    it("should work with generic ticket pattern", () => {
      expect(
        extractTicketFromBranch("feature/ABC-123-something", genericPattern)
      ).toBe("ABC-123");
      expect(
        extractTicketFromBranch("feature/XYZ-999-something", genericPattern)
      ).toBe("XYZ-999");
    });

    it("should handle invalid regex gracefully", () => {
      expect(
        extractTicketFromBranch("feature/test", "[invalid")
      ).toBe(null);
    });
  });

  describe("extractBranchPrefix", () => {
    it("should extract task prefix", () => {
      expect(extractBranchPrefix("task/update-readme")).toBe("Task");
    });

    it("should extract bug prefix", () => {
      expect(extractBranchPrefix("bug/fix-crash")).toBe("Bug");
    });

    it("should extract feature prefix", () => {
      expect(extractBranchPrefix("feature/add-login")).toBe("Feature");
    });

    it("should extract hotfix prefix", () => {
      expect(extractBranchPrefix("hotfix/urgent-fix")).toBe("Hotfix");
    });

    it("should extract chore prefix", () => {
      expect(extractBranchPrefix("chore/cleanup")).toBe("Chore");
    });

    it("should extract refactor prefix", () => {
      expect(extractBranchPrefix("refactor/auth-flow")).toBe("Refactor");
    });

    it("should extract fix prefix", () => {
      expect(extractBranchPrefix("fix/typo")).toBe("Fix");
    });

    it("should extract docs prefix", () => {
      expect(extractBranchPrefix("docs/readme")).toBe("Docs");
    });

    it("should extract test prefix", () => {
      expect(extractBranchPrefix("test/add-tests")).toBe("Test");
    });

    it("should extract ci prefix", () => {
      expect(extractBranchPrefix("ci/update-workflow")).toBe("Ci");
    });

    it("should extract build prefix", () => {
      expect(extractBranchPrefix("build/update-deps")).toBe("Build");
    });

    it("should extract perf prefix", () => {
      expect(extractBranchPrefix("perf/optimize-query")).toBe("Perf");
    });

    it("should extract style prefix", () => {
      expect(extractBranchPrefix("style/format-code")).toBe("Style");
    });

    it("should be case insensitive", () => {
      expect(extractBranchPrefix("TASK/update-readme")).toBe("Task");
      expect(extractBranchPrefix("Task/update-readme")).toBe("Task");
    });

    it("should return null for main/master", () => {
      expect(extractBranchPrefix("main")).toBe(null);
      expect(extractBranchPrefix("master")).toBe(null);
    });

    it("should return null for branches without recognized prefix", () => {
      expect(extractBranchPrefix("random-branch-name")).toBe(null);
      expect(extractBranchPrefix("JIRA-123-something")).toBe(null);
    });

    it("should return null for empty branch name", () => {
      expect(extractBranchPrefix("")).toBe(null);
    });
  });

  describe("getDefaultBranch", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should detect 'main' from origin HEAD reference", async () => {
      mockRaw.mockResolvedValue("refs/remotes/origin/main\n");

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });

    it("should detect 'develop' from origin HEAD reference", async () => {
      mockRaw.mockResolvedValue("refs/remotes/origin/develop\n");

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("develop");
    });

    it("should detect 'master' from origin HEAD reference", async () => {
      mockRaw.mockResolvedValue("refs/remotes/origin/master\n");

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("master");
    });

    it("should fall back to local 'main' branch when origin HEAD fails", async () => {
      mockRaw.mockRejectedValue(new Error("not found"));
      mockBranchLocal.mockResolvedValue({ all: ["main", "feature/test"] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });

    it("should fall back to local 'master' branch when no 'main'", async () => {
      mockRaw.mockRejectedValue(new Error("not found"));
      mockBranchLocal.mockResolvedValue({ all: ["master", "feature/test"] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("master");
    });

    it("should fall back to local 'develop' branch when no main/master", async () => {
      mockRaw.mockRejectedValue(new Error("not found"));
      mockBranchLocal.mockResolvedValue({ all: ["develop", "feature/test"] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("develop");
    });

    it("should fall back to local 'development' branch", async () => {
      mockRaw.mockRejectedValue(new Error("not found"));
      mockBranchLocal.mockResolvedValue({ all: ["development", "feature/test"] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("development");
    });

    it("should use configured branch when explicitly set (not main)", async () => {
      // Even if origin HEAD says main, configured branch wins
      mockRaw.mockResolvedValue("refs/remotes/origin/main\n");
      mockBranchLocal.mockResolvedValue({ all: ["main", "develop"] });

      const result = await getDefaultBranch("/fake/path", "develop");
      expect(result).toBe("develop");
    });

    it("should auto-detect when configured branch is 'main' (default)", async () => {
      // When config is "main" (default), still try auto-detection
      mockRaw.mockResolvedValue("refs/remotes/origin/develop\n");

      const result = await getDefaultBranch("/fake/path", "main");
      expect(result).toBe("develop");
    });

    it("should default to 'main' when all detection fails", async () => {
      mockRaw.mockRejectedValue(new Error("not found"));
      mockBranchLocal.mockResolvedValue({ all: [] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });

    it("should prioritize origin HEAD over local branches when no config", async () => {
      // Origin says develop, main exists locally - origin wins
      mockRaw.mockResolvedValue("refs/remotes/origin/develop\n");
      mockBranchLocal.mockResolvedValue({ all: ["main", "develop"] });

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("develop");
    });
  });
});
