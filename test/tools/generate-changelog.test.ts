import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/git.js")>();
  return {
    getTagList: vi.fn(),
    getCommitRange: vi.fn(),
    extractCoAuthors: actual.extractCoAuthors,
    extractTicketFromBranch: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    validateRepoPath: vi.fn((path: string) => path || process.cwd()),
    createGit: vi.fn(() => ({
      raw: vi.fn().mockResolvedValue("2024-06-01T00:00:00+00:00"),
    })),
    safeRegex: actual.safeRegex,
    validateRegexPattern: actual.validateRegexPattern,
  };
});

import { generateChangelog } from "../../src/tools/generate-changelog.js";
import { defaultConfig } from "../../src/config/schema.js";
import type { Config } from "../../src/config/schema.js";
import { getTagList, getCommitRange, createGit } from "../../src/utils/git.js";
import type { RangeCommitInfo } from "../../src/utils/git.js";

function makeCommit(overrides: Partial<RangeCommitInfo> = {}): RangeCommitInfo {
  return {
    hash: "abc1234567890",
    shortHash: "abc1234",
    message: "feat: Add feature",
    body: "",
    author: "Alice",
    date: "2024-06-01",
    ...overrides,
  };
}

describe("generateChangelog", () => {
  const testConfig: Config = {
    ...defaultConfig,
    ticketPattern: "PROJ-\\d+",
    ticketLinkFormat: "https://jira.example.com/browse/{ticket}",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getTagList).mockResolvedValue([
      { name: "v1.0.0", hash: "aaa1111", date: "2024-01-01T00:00:00+00:00" },
    ]);

    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ hash: "abc1234567890", shortHash: "abc1234", message: "feat: Add user auth", author: "Alice", date: "2024-06-01" }),
      makeCommit({ hash: "def5678901234", shortHash: "def5678", message: "fix: Handle validation", author: "Bob", date: "2024-05-30" }),
      makeCommit({ hash: "ghi9012345678", shortHash: "ghi9012", message: "refactor: Clean up database", author: "Alice", date: "2024-05-29" }),
    ]);

    const mockGitRaw = vi.fn().mockResolvedValue("2024-06-01T00:00:00+00:00");
    vi.mocked(createGit).mockReturnValue({ raw: mockGitRaw } as unknown as ReturnType<typeof createGit>);
  });

  it("should generate basic changelog in keepachangelog format", async () => {
    const result = await generateChangelog({}, testConfig);

    expect(result.changelog).toContain("## [Unreleased]");
    expect(result.changelog).toContain("### Added");
    expect(result.changelog).toContain("Add user auth");
    expect(result.changelog).toContain("### Fixed");
    expect(result.changelog).toContain("Handle validation");
    expect(result.changelog).toContain("### Changed");
    expect(result.changelog).toContain("Clean up database");
    expect(result.entries).toHaveLength(3);
  });

  it("should fall back to initial commit when no tags exist", async () => {
    vi.mocked(getTagList).mockResolvedValue([]);
    const mockGitRaw = vi.fn()
      .mockResolvedValueOnce("initial-sha\n")
      .mockResolvedValueOnce("2024-01-01T00:00:00+00:00")
      .mockResolvedValueOnce("2024-06-01T00:00:00+00:00");
    vi.mocked(createGit).mockReturnValue({ raw: mockGitRaw } as unknown as ReturnType<typeof createGit>);

    const result = await generateChangelog({}, testConfig);

    expect(result.warnings).toContain("No tags found. Using initial commit as start ref.");
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("should use explicit from/to refs", async () => {
    await generateChangelog({ from: "v0.9.0", to: "v1.0.0" }, testConfig);

    expect(vi.mocked(getCommitRange)).toHaveBeenCalledWith(
      expect.any(String),
      "v0.9.0",
      "v1.0.0"
    );
  });

  it("should use to-tag name in keepachangelog header when to ref is a tag", async () => {
    vi.mocked(getTagList).mockResolvedValue([
      { name: "v2.0.0", hash: "bbb2222", date: "2024-06-01T00:00:00+00:00" },
      { name: "v1.0.0", hash: "aaa1111", date: "2024-01-01T00:00:00+00:00" },
    ]);

    const result = await generateChangelog({ from: "v1.0.0", to: "v2.0.0" }, testConfig);

    expect(result.changelog).toContain("## [v2.0.0]");
    expect(result.changelog).not.toContain("[v1.0.0]");
    expect(result.changelog).not.toContain("[Unreleased]");
  });

  it("should generate github-release format", async () => {
    const result = await generateChangelog({ format: "github-release" }, testConfig);

    expect(result.changelog).toContain("## What's Changed");
    expect(result.changelog).toContain("by **Alice**");
    expect(result.changelog).toContain("by **Bob**");
    expect(result.changelog).toContain("## Contributors");
    expect(result.changelog).toContain("**Alice** (2 commits)");
    expect(result.changelog).toContain("**Bob** (1 commit)");
  });

  it("should generate plain format", async () => {
    const result = await generateChangelog({ format: "plain" }, testConfig);

    expect(result.changelog).not.toContain("##");
    expect(result.changelog).toContain("- Add user auth");
    expect(result.changelog).toContain("- Handle validation");
    expect(result.changelog).toContain("- Clean up database");
  });

  it("should group by scope", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "feat(api): Add endpoint", shortHash: "aaa1111" }),
      makeCommit({ message: "fix(api): Fix endpoint", shortHash: "bbb2222" }),
      makeCommit({ message: "feat: Global feature", shortHash: "ccc3333" }),
    ]);

    const result = await generateChangelog({ groupBy: "scope" }, testConfig);

    expect(result.changelog).toContain("### api");
    expect(result.changelog).toContain("### Unscoped");
  });

  it("should group by ticket", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "feat: Add feature PROJ-123", shortHash: "aaa1111" }),
      makeCommit({ message: "fix: Fix bug PROJ-456", shortHash: "bbb2222" }),
      makeCommit({ message: "chore: Cleanup", shortHash: "ccc3333" }),
    ]);

    const result = await generateChangelog({ groupBy: "ticket" }, testConfig);

    expect(result.changelog).toContain("### PROJ-123");
    expect(result.changelog).toContain("### PROJ-456");
    expect(result.changelog).toContain("### No Ticket");
  });

  it("should infer types from non-conventional commits", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "Fix login issue", shortHash: "aaa1111" }),
      makeCommit({ message: "Add new dashboard", shortHash: "bbb2222" }),
      makeCommit({ message: "Random change", shortHash: "ccc3333" }),
    ]);

    const result = await generateChangelog({}, testConfig);

    const fixEntry = result.entries.find((e) => e.title === "Fix login issue");
    expect(fixEntry?.type).toBe("fix");

    const featEntry = result.entries.find((e) => e.title === "Add new dashboard");
    expect(featEntry?.type).toBe("feat");

    const otherEntry = result.entries.find((e) => e.title === "Random change");
    expect(otherEntry?.type).toBe("other");
  });

  it("should deduplicate squash-merge artifacts", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ hash: "newer111", shortHash: "newer11", message: "feat: Add login", date: "2024-06-01" }),
      makeCommit({ hash: "older222", shortHash: "older22", message: "feat: Add login", date: "2024-05-01" }),
    ]);

    const result = await generateChangelog({}, testConfig);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hash).toBe("newer11");
  });

  it("should extract co-authors from commit body", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({
        message: "feat: Pair programming feature",
        body: "Co-authored-by: Bob <bob@example.com>\nCo-authored-by: Charlie <charlie@example.com>",
        shortHash: "aaa1111",
      }),
    ]);

    const result = await generateChangelog({}, testConfig);

    expect(result.entries[0].coAuthors).toEqual(["Bob", "Charlie"]);
    expect(result.stats.contributorCount).toBe(3);
  });

  it("should extract tickets and format with links", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "feat: Add feature PROJ-123", shortHash: "aaa1111" }),
      makeCommit({ message: "fix: Fix bug PROJ-456", shortHash: "bbb2222" }),
    ]);

    const result = await generateChangelog({}, testConfig);

    expect(result.stats.ticketCount).toBe(2);
    expect(result.changelog).toContain("Related Tickets");
    expect(result.changelog).toContain("[PROJ-123](https://jira.example.com/browse/PROJ-123)");
    expect(result.changelog).toContain("[PROJ-456](https://jira.example.com/browse/PROJ-456)");
  });

  it("should omit authors when includeAuthors is false", async () => {
    const result = await generateChangelog(
      { format: "github-release", includeAuthors: false },
      testConfig
    );

    expect(result.changelog).not.toContain("by **Alice**");
    expect(result.changelog).not.toContain("## Contributors");
  });

  it("should handle empty commit range gracefully", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([]);

    const result = await generateChangelog({}, testConfig);

    expect(result.entries).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.summary).toBe("No changes");
  });

  it("should generate accurate summary line", async () => {
    const result = await generateChangelog({}, testConfig);

    expect(result.summary).toBe("1 feature, 1 fix, and 1 change");
  });

  it("should compute correct stats", async () => {
    const result = await generateChangelog({}, testConfig);

    expect(result.stats.commitCount).toBe(3);
    expect(result.stats.contributorCount).toBe(2);
  });

  it("should handle tickets in github-release format without links", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "feat: Add feature PROJ-123", shortHash: "aaa1111" }),
    ]);

    const configNoLinks: Config = { ...defaultConfig, ticketPattern: "PROJ-\\d+" };
    const result = await generateChangelog({ format: "github-release" }, configNoLinks);

    expect(result.changelog).toContain("## Related Tickets");
    expect(result.changelog).toContain("- PROJ-123");
  });

  it("should render ticket links in github-release format when ticketLinkFormat is set", async () => {
    vi.mocked(getCommitRange).mockResolvedValue([
      makeCommit({ message: "feat: Add feature PROJ-789", shortHash: "aaa1111" }),
    ]);

    const result = await generateChangelog({ format: "github-release" }, testConfig);

    expect(result.changelog).toContain("## Related Tickets");
    expect(result.changelog).toContain(
      "[PROJ-789](https://jira.example.com/browse/PROJ-789)"
    );
  });

  it("should warn when commit range is very large", async () => {
    const manyCommits = Array.from({ length: 10001 }, (_, i) =>
      makeCommit({ hash: `hash${i}`.padEnd(12, "0"), shortHash: `hash${i}`.substring(0, 7), message: `feat: Commit ${i}` })
    );
    vi.mocked(getCommitRange).mockResolvedValue(manyCommits);

    const result = await generateChangelog({}, testConfig);

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Truncated to the most recent 10000")])
    );
  });

  it("should populate range information", async () => {
    const result = await generateChangelog({}, testConfig);

    expect(result.range.from).toBe("v1.0.0");
    expect(result.range.to).toBe("HEAD");
    expect(result.range.fromDate).toBeTruthy();
  });
});
