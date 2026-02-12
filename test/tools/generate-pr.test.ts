import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePr } from "../../src/tools/generate-pr.js";
import { defaultConfig } from "../../src/config/schema.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  getBranchChanges: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
  detectBaseBranch: vi.fn().mockResolvedValue({
    branch: "main",
    isConfigured: false,
    alternatives: [],
    isAmbiguous: false,
  }),
  validateRepoPath: vi.fn((path) => path || process.cwd()),
}));

import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";

describe("generatePr", () => {
  const testConfig = {
    ...defaultConfig,
    baseBranch: "main",
    ticketPattern: "PROJ-\\d+",
    ticketLinkFormat: "https://jira.example.com/browse/{ticket}",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
    vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
    vi.mocked(extractBranchPrefix).mockReturnValue("feature");
    vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
    vi.mocked(getBranchChanges).mockResolvedValue({
      commits: [
        { hash: "abc1234", message: "feat: Add login form" },
        { hash: "def5678", message: "fix: Handle validation errors" },
      ],
      files: [
        { path: "src/auth/login.ts", additions: 100, deletions: 20 },
        { path: "src/auth/login.test.ts", additions: 50, deletions: 0 },
      ],
      diff: "mock diff",
    });
  });

  describe("title generation", () => {
    it("should generate title with ticket prefix", async () => {
      const result = await generatePr({}, testConfig);

      expect(result.title).toContain("PROJ-123");
    });

    it("should use branch prefix as fallback when no ticket", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue("task");

      const result = await generatePr({}, testConfig);

      expect(result.title).toContain("Task:");
    });

    it("should derive title from oldest commit (main feature intent)", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "def5678", message: "fix: Handle edge case in login" },
          { hash: "abc1234", message: "feat: Add login form with validation" },
        ],
        files: [{ path: "src/auth/login.ts", additions: 100, deletions: 20 }],
        diff: "mock diff",
      });

      const result = await generatePr({}, testConfig);

      // Should use oldest commit (last in array), not newest or branch name
      expect(result.title).toContain("Add login form with validation");
    });

    it("should fall back to branch name when no commits", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        diff: "",
      });

      const result = await generatePr({}, testConfig);

      expect(result.title).toContain("Add login");
    });

    it("should preserve full title even when long", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "abc1234", message: "feat: This is a very long commit message that describes a complex feature with many details and should not be truncated by the tool" },
        ],
        files: [{ path: "src/index.ts", additions: 10, deletions: 5 }],
        diff: "mock diff",
      });

      const result = await generatePr({}, testConfig);

      // Full title preserved, not truncated
      expect(result.title).toContain("This is a very long commit message");
    });

    it("should use placeholder when no summary can be extracted", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue(null);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        diff: "",
      });

      const result = await generatePr({}, testConfig);

      expect(result.title).toContain("[Describe your changes]");
    });
  });

  describe("description generation", () => {
    it("should generate description with Ticket and Purpose sections", async () => {
      const result = await generatePr({}, testConfig);

      expect(result.description).toContain("## Ticket");
      expect(result.description).toContain("## Purpose");
    });

    it("should auto-populate ticket as plain URL", async () => {
      const result = await generatePr({}, testConfig);

      // Should contain plain URL, not markdown link
      expect(result.description).toContain("https://jira.example.com/browse/PROJ-123");
      expect(result.description).not.toContain("[PROJ-123]");
    });

    it("should auto-populate Purpose section with purpose", async () => {
      const result = await generatePr({}, testConfig);

      expect(result.description).toContain("## Purpose");
      expect(result.description).not.toContain("_[Add purpose here]_");
    });

    it("should omit Ticket section when no tickets found", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);

      const result = await generatePr({}, testConfig);

      // Ticket section should be omitted entirely, not show "_No tickets found_"
      expect(result.description).not.toContain("## Ticket");
    });
  });

  describe("context", () => {
    it("should include all context information", async () => {
      const result = await generatePr({}, testConfig);

      expect(result.context.ticket).toBe("PROJ-123");
      expect(result.context.branchPrefix).toBe("feature");
      expect(result.context.branchName).toBe("feature/PROJ-123-add-login");
      expect(result.context.commitCount).toBe(2);
      expect(result.context.filesChanged).toBe(2);
    });

    it("should collect all tickets from branch and commits", async () => {
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-456", "PROJ-789"]);

      const result = await generatePr({}, testConfig);

      expect(result.context.tickets).toContain("PROJ-123");
      expect(result.context.tickets).toContain("PROJ-456");
      expect(result.context.tickets).toContain("PROJ-789");
    });

    it("should include purposeContext for AI enhancement", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [{
          hash: "abc1234",
          message: `Add login feature

- Add login form component
- Add validation logic
- Add unit tests`,
        }],
        files: [
          { path: "src/auth/login.ts", additions: 100, deletions: 20 },
          { path: "src/auth/login.test.ts", additions: 50, deletions: 0 },
        ],
        diff: "mock diff",
      });

      const result = await generatePr({}, testConfig);

      // Should include purposeContext for AI to use
      expect(result.purposeContext).not.toBeNull();
      expect(result.purposeContext?.commitTitles).toContain("Add login feature");
      expect(result.purposeContext?.commitBullets).toHaveLength(3);
      expect(result.purposeContext?.commitBullets).toContain("Add login form component");
      expect(result.purposeContext?.hasTests).toBe(true);
      expect(result.purposeContext?.commitCount).toBe(1);
    });

    it("should collect bullets from all commits, not just the first", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          {
            hash: "def5678",
            message: `Fix auth edge cases

- Handle expired tokens gracefully
- Add retry logic for failed auth`,
          },
          {
            hash: "abc1234",
            message: `Add login feature

- Add login form component
- Add validation logic`,
          },
        ],
        files: [
          { path: "src/auth/login.ts", additions: 100, deletions: 20 },
        ],
        diff: "mock diff",
      });

      const result = await generatePr({}, testConfig);

      expect(result.purposeContext).not.toBeNull();
      // All commit titles available for AI to synthesize
      expect(result.purposeContext?.commitTitles).toContain("Add login feature");
      expect(result.purposeContext?.commitTitles).toContain("Fix auth edge cases");
      // Should have bullets from BOTH commits
      expect(result.purposeContext?.commitBullets).toHaveLength(4);
      expect(result.purposeContext?.commitBullets).toContain("Add login form component");
      expect(result.purposeContext?.commitBullets).toContain("Handle expired tokens gracefully");
    });

    it("should use all commit titles as bullets when no bullet bodies exist", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "abc1234", message: "Add login feature" },
          { hash: "def5678", message: "Fix auth edge cases" },
          { hash: "ghi9012", message: "Add unit tests for auth" },
        ],
        files: [
          { path: "src/auth/login.ts", additions: 100, deletions: 20 },
        ],
        diff: "mock diff",
      });

      const result = await generatePr({}, testConfig);

      expect(result.purposeContext).not.toBeNull();
      // All commit titles available for AI to synthesize
      expect(result.purposeContext?.commitTitles).toHaveLength(3);
      expect(result.purposeContext?.commitTitles).toContain("Add login feature");
      expect(result.purposeContext?.commitTitles).toContain("Fix auth edge cases");
      expect(result.purposeContext?.commitTitles).toContain("Add unit tests for auth");
      // When no body bullets, commit titles serve as bullets
      expect(result.purposeContext?.commitBullets).toHaveLength(3);
      expect(result.purposeContext?.commitCount).toBe(3);
    });

    it("should include purposeGuidelines for AI", async () => {
      const result = await generatePr({}, testConfig);

      expect(result.purposeGuidelines).toBeDefined();
      expect(result.purposeGuidelines).toContain("prose");
      expect(result.purposeGuidelines).toContain("present tense");
    });
  });

  describe("custom content", () => {
    it("should use provided title summary", async () => {
      const result = await generatePr({ titleSummary: "Custom title" }, testConfig);

      expect(result.title).toContain("Custom title");
    });

    it("should use provided description summary", async () => {
      const result = await generatePr({ summary: "This is my custom summary" }, testConfig);

      expect(result.description).toContain("This is my custom summary");
    });

    it("should use provided test plan", async () => {
      const configWithTestPlan = {
        ...testConfig,
        pr: {
          ...testConfig.pr,
          sections: [
            ...testConfig.pr.sections,
            { name: "Test Plan", required: false },
          ],
        },
      };

      const result = await generatePr({ testPlan: "Manual testing completed" }, configWithTestPlan);

      expect(result.description).toContain("Manual testing completed");
    });
  });
});
