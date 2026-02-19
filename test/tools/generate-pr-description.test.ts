import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/git.js")>();
  return {
    getCurrentBranch: vi.fn(),
    getBranchChanges: vi.fn(),
    extractTicketFromBranch: vi.fn(),
    extractBranchPrefix: vi.fn(),
    extractTicketsFromCommits: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    validateRepoPath: vi.fn((path: string) => path || process.cwd()),
    safeRegex: actual.safeRegex,
    validateRegexPattern: actual.validateRegexPattern,
  };
});

vi.mock("../../src/utils/template.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/template.js")>();
  return {
    ...actual,
    resolveTemplate: vi.fn().mockResolvedValue({
      sections: [
        { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
        { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
        { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
        { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "commit_count_gt", threshold: 1 }, format: "markdown" },
        { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, format: "markdown" },
        { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
      ],
      source: "default",
      detectedDomain: null,
      repoTemplatePath: null,
      rawTemplate: null,
    }),
    evaluateCondition: actual.evaluateCondition,
    generateSectionContent: actual.generateSectionContent,
  };
});

import { generatePrDescription } from "../../src/tools/generate-pr-description.js";
import { defaultConfig } from "../../src/config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  extractTicketFromBranch,
  extractBranchPrefix,
  extractTicketsFromCommits,
} from "../../src/utils/git.js";
import { resolveTemplate } from "../../src/utils/template.js";

describe("generatePrDescription", () => {
  const testConfig = {
    ...defaultConfig,
    baseBranch: "main",
    ticketPattern: "PROJ-\\d+",
    ticketLinkFormat: "https://jira.example.com/browse/{ticket}",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");
    vi.mocked(extractTicketFromBranch).mockReturnValue("PROJ-123");
    vi.mocked(extractBranchPrefix).mockReturnValue("feature");
    vi.mocked(extractTicketsFromCommits).mockResolvedValue([]);
    vi.mocked(getBranchChanges).mockResolvedValue({
      commits: [
        { hash: "abc1234", message: "feat: Add login form", author: "test", date: "2024-01-01" },
        { hash: "def5678", message: "fix: Handle validation errors", author: "test", date: "2024-01-02" },
      ],
      files: [
        { path: "src/auth/login.ts", additions: 100, deletions: 20, binary: false },
        { path: "src/auth/login.test.ts", additions: 50, deletions: 0, binary: false },
      ],
      totalAdditions: 150,
      totalDeletions: 20,
      diff: "mock diff",
    });
  });

  it("should generate description with Purpose section", async () => {
    const result = await generatePrDescription({}, testConfig);
    expect(result.description).toContain("## Purpose");
  });

  it("should include ticket section when tickets found", async () => {
    const result = await generatePrDescription({}, testConfig);
    expect(result.description).toContain("## Ticket");
    expect(result.description).toContain("https://jira.example.com/browse/PROJ-123");
  });

  it("should omit ticket section when no tickets found", async () => {
    vi.mocked(extractTicketFromBranch).mockReturnValue(null);
    const result = await generatePrDescription({}, testConfig);
    expect(result.description).not.toContain("## Ticket");
  });

  it("should include templateSource and detectedDomain in context", async () => {
    const result = await generatePrDescription({}, testConfig);
    expect(result.context.templateSource).toBe("default");
    expect(result.context.detectedDomain).toBeNull();
  });

  it("should pass templatePreset to resolveTemplate", async () => {
    await generatePrDescription({ templatePreset: "backend" }, testConfig);

    const calls = vi.mocked(resolveTemplate).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const configArg = calls[0][1];
    expect(configArg.pr.template.preset).toBe("backend");
  });

  it("should generate checklist content", async () => {
    const result = await generatePrDescription({}, testConfig);
    expect(result.description).toContain("## Checklist");
    expect(result.description).toContain("self-reviewed");
  });

  it("should generate change type content", async () => {
    const result = await generatePrDescription({}, testConfig);
    expect(result.description).toContain("## Type of Change");
    expect(result.description).toContain("New feature");
  });

  it("should use provided summary for Purpose section", async () => {
    const result = await generatePrDescription(
      { summary: "Custom summary text" },
      testConfig
    );
    expect(result.description).toContain("Custom summary text");
  });

  it("should filter conditional sections based on changed files and commit count", async () => {
    // Only 1 commit -> Changes section should be filtered out (threshold: 1 means > 1)
    vi.mocked(getBranchChanges).mockResolvedValue({
      commits: [{ hash: "abc1234", message: "Single commit", author: "test", date: "2024-01-01" }],
      files: [{ path: "src/app.ts", additions: 10, deletions: 5, binary: false }],
      totalAdditions: 10,
      totalDeletions: 5,
      diff: "mock",
    });

    const result = await generatePrDescription({}, testConfig);
    expect(result.description).not.toContain("## Changes");
  });
});
