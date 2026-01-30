import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePr } from "../../src/tools/generate-pr.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  getBranchChanges: vi.fn(),
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
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";
import { loadConfig } from "../../src/config/loader.js";

describe("generatePr", () => {
  const defaultConfig = {
    config: {
      commit: {
        format: "simple",
        maxTitleLength: 72,
        maxBodyLineLength: 100,
        requireScope: false,
        requireBody: false,
        scopes: [],
        prefix: {
          enabled: true,
          style: "capitalized",
          branchFallback: true,
        },
        rules: {
          imperativeMood: true,
          capitalizeTitle: true,
          noTrailingPeriod: true,
        },
      },
      pr: {
        title: {
          prefix: {
            enabled: true,
            style: "capitalized",
            branchFallback: true,
          },
          maxLength: 100,
        },
        sections: [
          { name: "Summary", required: true },
          { name: "Changes", required: true, autoPopulate: "commits" },
          { name: "Tickets", required: false, autoPopulate: "extracted" },
          { name: "Test Plan", required: false },
        ],
      },
      baseBranch: "main",
      ticketPattern: "PROJ-\\d+",
      ticketLinkFormat: "https://jira.example.com/browse/{ticket}",
    },
    configPath: null,
    errors: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(defaultConfig);
  });

  describe("title generation", () => {
    beforeEach(() => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });
    });

    it("should generate title with ticket prefix", async () => {
      const result = await generatePr({
        titleSummary: "Add user authentication",
      });

      expect(result.title).toBe("PROJ-1234: Add user authentication");
    });

    it("should use branch prefix as fallback when no ticket", async () => {
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);

      const result = await generatePr({
        titleSummary: "Add login page",
      });

      expect(result.title).toBe("Feature: Add login page");
    });

    it("should extract summary from branch name when not provided", async () => {
      const result = await generatePr({});

      expect(result.title).toContain("PROJ-1234:");
      expect(result.title).toContain("Add Login");
    });

    it("should truncate long titles", async () => {
      const longSummary = "A".repeat(150);
      const result = await generatePr({
        titleSummary: longSummary,
      });

      expect(result.title.length).toBeLessThanOrEqual(100);
      expect(result.title).toContain("...");
    });

    it("should use placeholder when no summary can be extracted", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue(null);
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue(null);

      const result = await generatePr({});

      // When there's no branch at all, the title should use a placeholder
      expect(result.title).toContain("[Describe your changes]");
    });
  });

  describe("description generation", () => {
    beforeEach(() => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-5678"]);
    });

    it("should generate description with all sections", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "abc1234", message: "feat: Add login form", author: "dev", date: "2024-01-01" },
          { hash: "def5678", message: "fix: Fix validation", author: "dev", date: "2024-01-02" },
        ],
        files: [{ path: "src/auth/login.ts", additions: 100, deletions: 0, binary: false }],
        totalAdditions: 100,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({
        summary: "This PR adds user authentication",
        testPlan: "1. Test login flow\n2. Test logout flow",
      });

      expect(result.description).toContain("## Summary");
      expect(result.description).toContain("This PR adds user authentication");
      expect(result.description).toContain("## Changes");
      expect(result.description).toContain("feat: Add login form");
      expect(result.description).toContain("## Tickets");
      expect(result.description).toContain("PROJ-1234");
      expect(result.description).toContain("## Test Plan");
      expect(result.description).toContain("Test login flow");
    });

    it("should auto-populate commits in Changes section", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "abc1234", message: "feat: Add feature A", author: "dev", date: "2024-01-01" },
          { hash: "def5678", message: "feat: Add feature B", author: "dev", date: "2024-01-02" },
        ],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.description).toContain("feat: Add feature A (abc1234)");
      expect(result.description).toContain("feat: Add feature B (def5678)");
    });

    it("should auto-populate tickets in Tickets section", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.description).toContain("## Tickets");
      expect(result.description).toContain("PROJ-1234");
      expect(result.description).toContain("PROJ-5678");
      expect(result.description).toContain("https://jira.example.com/browse/PROJ-1234");
    });

    it("should show placeholder for required sections without content", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.description).toContain("_[Add summary here]_");
    });

    it("should handle no commits gracefully", async () => {
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.description).toContain("_No commits found_");
    });
  });

  describe("context", () => {
    it("should include all context information", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-5678"]);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [
          { hash: "abc1234", message: "feat: Add login", author: "dev", date: "2024-01-01" },
        ],
        files: [
          { path: "src/auth/login.ts", additions: 50, deletions: 10, binary: false },
          { path: "src/auth/logout.ts", additions: 20, deletions: 5, binary: false },
        ],
        totalAdditions: 70,
        totalDeletions: 15,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.context.ticket).toBe("PROJ-1234");
      expect(result.context.branchPrefix).toBe("Feature");
      expect(result.context.branchName).toBe("feature/PROJ-1234-add-login");
      expect(result.context.baseBranch).toBe("main");
      expect(result.context.commitCount).toBe(1);
      expect(result.context.tickets).toContain("PROJ-1234");
      expect(result.context.tickets).toContain("PROJ-5678");
      expect(result.context.filesChanged).toBe(2);
    });
  });

  describe("suggested actions", () => {
    it("should include VCS suggested action when configured", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        ...defaultConfig,
        config: {
          ...defaultConfig.config,
          integrations: {
            vcs: {
              provider: "github",
              mcpServer: "user-github",
              defaultOwner: "myorg",
              defaultRepo: "myrepo",
            },
          },
        },
      });

      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-test");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({
        titleSummary: "Test PR",
      });

      expect(result.suggestedActions).toHaveLength(1);
      expect(result.suggestedActions[0].action).toBe("create_pr");
      expect(result.suggestedActions[0].mcpServer).toBe("user-github");
      expect(result.suggestedActions[0].tool).toBe("create_pull_request");
      expect(result.suggestedActions[0].params.title).toBe("PROJ-1234: Test PR");
      expect(result.suggestedActions[0].params.base).toBe("main");
    });

    it("should not include suggested actions when VCS not configured", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractBranchPrefix).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      const result = await generatePr({});

      expect(result.suggestedActions).toHaveLength(0);
    });
  });

  describe("additional sections", () => {
    it("should include custom additional sections", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-test");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractBranchPrefix).mockReturnValue("Feature");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
      vi.mocked(getBranchChanges).mockResolvedValue({
        commits: [],
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        diff: "",
      });

      // Add custom sections to config
      vi.mocked(loadConfig).mockResolvedValue({
        ...defaultConfig,
        config: {
          ...defaultConfig.config,
          pr: {
            ...defaultConfig.config.pr,
            sections: [
              { name: "Summary", required: true },
              { name: "Screenshots", required: false },
            ],
          },
        },
      });

      const result = await generatePr({
        summary: "Test summary",
        additionalSections: {
          Screenshots: "![screenshot](url)",
        },
      });

      expect(result.description).toContain("## Summary");
      expect(result.description).toContain("Test summary");
      expect(result.description).toContain("## Screenshots");
      expect(result.description).toContain("![screenshot](url)");
    });
  });
});
