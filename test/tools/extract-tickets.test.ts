import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractTickets } from "../../src/tools/extract-tickets.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
}));

// Mock the config loader
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

import { getCurrentBranch, extractTicketFromBranch, extractTicketsFromCommits } from "../../src/utils/git.js";
import { loadConfig } from "../../src/config/loader.js";

describe("extractTickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        ticketPattern: "WTHRAPP-\\d+",
        ticketLinkFormat: "https://jira.example.com/browse/{ticket}",
        baseBranch: "develop",
        commit: {
          format: "conventional",
          maxTitleLength: 72,
          maxBodyLineLength: 100,
          requireScope: false,
          requireBody: false,
          prefix: { enabled: true, ticketFormat: "{ticket}: ", branchFallback: true },
          rules: { imperativeMood: true, capitalizeTitle: true, noTrailingPeriod: true },
        },
        pr: { title: { prefix: { enabled: true }, maxLength: 100 }, sections: [] },
      },
      configPath: null,
      errors: [],
    });
  });

  describe("extracting from branch", () => {
    it("should extract ticket from branch name", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/WTHRAPP-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("WTHRAPP-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false });

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("WTHRAPP-1234");
      expect(result.tickets[0].source).toBe("branch");
    });

    it("should format ticket links correctly", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/WTHRAPP-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("WTHRAPP-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false });

      expect(result.tickets[0].link).toBe("https://jira.example.com/browse/WTHRAPP-1234");
      expect(result.markdownList).toContain("[WTHRAPP-1234]");
      expect(result.markdownList).toContain("https://jira.example.com/browse/WTHRAPP-1234");
    });
  });

  describe("extracting from commits", () => {
    it("should extract tickets from commit messages", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["WTHRAPP-5678", "WTHRAPP-9012"]);

      const result = await extractTickets({ includeCommits: true });

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("WTHRAPP-5678");
      expect(result.uniqueTickets).toContain("WTHRAPP-9012");
      expect(result.tickets.filter(t => t.source === "commit")).toHaveLength(2);
    });

    it("should skip commit extraction when includeCommits is false", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["WTHRAPP-5678"]);

      const result = await extractTickets({ includeCommits: false });

      expect(extractTicketsFromCommits).not.toHaveBeenCalled();
      expect(result.hasTickets).toBe(false);
    });
  });

  describe("extracting from additional text", () => {
    it("should extract tickets from additional text", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({
        includeCommits: false,
        additionalText: "This PR fixes WTHRAPP-1111 and WTHRAPP-2222",
      });

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("WTHRAPP-1111");
      expect(result.uniqueTickets).toContain("WTHRAPP-2222");
      expect(result.tickets.filter(t => t.source === "text")).toHaveLength(2);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate tickets from multiple sources", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/WTHRAPP-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("WTHRAPP-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["WTHRAPP-1234", "WTHRAPP-5678"]);

      const result = await extractTickets({
        includeCommits: true,
        additionalText: "Related to WTHRAPP-1234",
      });

      // Should have WTHRAPP-1234 only once (from branch) and WTHRAPP-5678 (from commits)
      expect(result.uniqueTickets).toHaveLength(2);
      expect(result.uniqueTickets.filter(t => t === "WTHRAPP-1234")).toHaveLength(1);
    });

    it("should normalize ticket case", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/wthrapp-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("wthrapp-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false });

      // Should be normalized to uppercase
      expect(result.uniqueTickets).toContain("WTHRAPP-1234");
    });
  });

  describe("no tickets found", () => {
    it("should handle no tickets gracefully", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({});

      expect(result.hasTickets).toBe(false);
      expect(result.uniqueTickets).toHaveLength(0);
      expect(result.markdownList).toBe("No tickets found");
    });
  });

  describe("no ticket pattern configured", () => {
    it("should handle missing ticket pattern", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          ticketPattern: undefined,
          baseBranch: "main",
          commit: {
            format: "conventional",
            maxTitleLength: 72,
            maxBodyLineLength: 100,
            requireScope: false,
            requireBody: false,
            prefix: { enabled: true, ticketFormat: "{ticket}: ", branchFallback: true },
            rules: { imperativeMood: true, capitalizeTitle: true, noTrailingPeriod: true },
          },
          pr: { title: { prefix: { enabled: true }, maxLength: 100 }, sections: [] },
        },
        configPath: null,
        errors: [],
      });
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/WTHRAPP-1234");

      const result = await extractTickets({});

      expect(result.hasTickets).toBe(false);
      expect(result.ticketPattern).toBe(null);
    });
  });
});
