import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractTickets } from "../../src/tools/extract-tickets.js";
import { defaultConfig } from "../../src/config/schema.js";

// Mock the git utilities
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

import { getCurrentBranch, extractTicketFromBranch, extractTicketsFromCommits } from "../../src/utils/git.js";

describe("extractTickets", () => {
  const testConfig = {
    ...defaultConfig,
    ticketPattern: "PROJ-\\d+",
    ticketLinkFormat: "https://your-ticketing-system.com/browse/{ticket}",
    baseBranch: "develop",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extracting from branch", () => {
    it("should extract ticket from branch name", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false }, testConfig);

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("PROJ-1234");
      expect(result.tickets[0].source).toBe("branch");
    });

    it("should format ticket links correctly", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false }, testConfig);

      expect(result.tickets[0].link).toBe("https://your-ticketing-system.com/browse/PROJ-1234");
      expect(result.markdownList).toContain("[PROJ-1234]");
      expect(result.markdownList).toContain("https://your-ticketing-system.com/browse/PROJ-1234");
    });
  });

  describe("extracting from commits", () => {
    it("should extract tickets from commit messages", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-5678", "PROJ-9012"]);

      const result = await extractTickets({ includeCommits: true }, testConfig);

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("PROJ-5678");
      expect(result.uniqueTickets).toContain("PROJ-9012");
      expect(result.tickets.filter(t => t.source === "commit")).toHaveLength(2);
    });

    it("should skip commit extraction when includeCommits is false", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-5678"]);

      const result = await extractTickets({ includeCommits: false }, testConfig);

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
        additionalText: "This PR fixes PROJ-1111 and PROJ-2222",
      }, testConfig);

      expect(result.hasTickets).toBe(true);
      expect(result.uniqueTickets).toContain("PROJ-1111");
      expect(result.uniqueTickets).toContain("PROJ-2222");
      expect(result.tickets.filter(t => t.source === "text")).toHaveLength(2);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate tickets from multiple sources", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-1234", "PROJ-5678"]);

      const result = await extractTickets({
        includeCommits: true,
        additionalText: "Related to PROJ-1234",
      }, testConfig);

      expect(result.uniqueTickets).toHaveLength(2);
      expect(result.uniqueTickets.filter(t => t === "PROJ-1234")).toHaveLength(1);
    });

    it("should normalize ticket case", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/proj-1234-add-login");
      vi.mocked(extractTicketFromBranch).mockReturnValue("proj-1234");
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({ includeCommits: false }, testConfig);

      expect(result.uniqueTickets).toContain("PROJ-1234");
    });
  });

  describe("no tickets found", () => {
    it("should handle no tickets gracefully", async () => {
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(extractTicketFromBranch).mockReturnValue(null);
      vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

      const result = await extractTickets({}, testConfig);

      expect(result.hasTickets).toBe(false);
      expect(result.uniqueTickets).toHaveLength(0);
      expect(result.markdownList).toBe("No tickets found");
    });
  });

  describe("no ticket pattern configured", () => {
    it("should handle missing ticket pattern", async () => {
      const configWithoutPattern = { ...defaultConfig, ticketPattern: undefined };
      vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-1234");

      const result = await extractTickets({}, configWithoutPattern);

      expect(result.hasTickets).toBe(false);
      expect(result.ticketPattern).toBe(null);
    });
  });
});
