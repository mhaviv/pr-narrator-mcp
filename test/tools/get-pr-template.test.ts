import { describe, it, expect, vi, beforeEach } from "vitest";

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
  validateRepoPath: vi.fn((path: string) => path || process.cwd()),
  safeRegex: vi.fn(),
  validateRegexPattern: vi.fn(),
}));

vi.mock("../../src/utils/template.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/template.js")>();
  return {
    ...actual,
    resolveTemplate: vi.fn(),
    evaluateCondition: vi.fn(),
  };
});

import { getPrTemplate } from "../../src/tools/get-pr-template.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";
import { resolveTemplate, evaluateCondition } from "../../src/utils/template.js";
import { defaultConfig } from "../../src/config/schema.js";

describe("getPrTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
    vi.mocked(extractTicketFromBranch).mockReturnValue(null);
    vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);

    vi.mocked(getBranchChanges).mockResolvedValue({
      commits: [{ hash: "abc1234", message: "Add feature", author: "test", date: "2024-01-01" }],
      files: [{ path: "src/app.ts", additions: 10, deletions: 5, binary: false }],
      totalAdditions: 10,
      totalDeletions: 5,
      diff: "mock diff",
    });

    vi.mocked(resolveTemplate).mockResolvedValue({
      sections: [
        { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
        { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
      ],
      source: "default",
      detectedDomain: null,
      repoTemplatePath: null,
      rawTemplate: null,
    });

    vi.mocked(evaluateCondition).mockReturnValue(true);
  });

  it("should return resolved template with sections", async () => {
    const result = await getPrTemplate({ repoPath: "/repo" }, defaultConfig);

    expect(result.source).toBe("default");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].name).toBe("Purpose");
  });

  it("should evaluate conditions and set willAppear", async () => {
    vi.mocked(evaluateCondition)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await getPrTemplate({ repoPath: "/repo" }, defaultConfig);

    expect(result.sections[0].willAppear).toBe(true);
    expect(result.sections[1].willAppear).toBe(false);
  });

  it("should handle missing repoPath gracefully", async () => {
    const result = await getPrTemplate({}, defaultConfig);

    expect(result).toBeDefined();
    expect(result.sections).toBeDefined();
  });

  it("should pass extracted tickets to evaluateCondition", async () => {
    vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
    vi.mocked(extractTicketsFromCommits).mockResolvedValue(["PROJ-456"]);

    const configWithTickets = {
      ...defaultConfig,
      ticketPattern: "PROJ-\\d+",
    };

    await getPrTemplate({ repoPath: "/repo" }, configWithTickets);

    // evaluateCondition should have been called with the extracted tickets
    const calls = vi.mocked(evaluateCondition).mock.calls;
    expect(calls.length).toBe(2);
    // Both calls should receive the tickets array containing both tickets
    for (const call of calls) {
      const ticketsArg = call[2];
      expect(ticketsArg).toContain("PROJ-123");
      expect(ticketsArg).toContain("PROJ-456");
    }
  });

  it("should pass preset override to resolveTemplate", async () => {
    await getPrTemplate({ repoPath: "/repo", preset: "mobile" }, defaultConfig);

    const calls = vi.mocked(resolveTemplate).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const configArg = calls[0][1];
    expect(configArg.pr.template.preset).toBe("mobile");
    expect(configArg.pr.template.detectRepoTemplate).toBe(false);
  });
});
