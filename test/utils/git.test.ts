import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractTicketFromBranch,
  extractBranchPrefix,
  validateRegexPattern,
  safeRegex,
} from "../../src/utils/git.js";

// Create mock functions
const mockRaw = vi.fn();
const mockBranchLocal = vi.fn();
const mockTags = vi.fn();
const mockLog = vi.fn();

// Mock simple-git module
vi.mock("simple-git", () => ({
  default: vi.fn(() => ({
    raw: mockRaw,
    branchLocal: mockBranchLocal,
    tags: mockTags,
    log: mockLog,
    revparse: vi.fn().mockResolvedValue("/fake/.git"),
  })),
}));

// Import after mock setup
import {
  getDefaultBranch,
  getTagList,
  getCommitRange,
  extractCoAuthors,
} from "../../src/utils/git.js";

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

    it("should extract rnd prefix", () => {
      expect(extractBranchPrefix("rnd/PROJ-123-experiment")).toBe("Rnd");
    });

    it("should extract release prefix", () => {
      expect(extractBranchPrefix("release/v1.0.0")).toBe("Release");
    });

    it("should extract experiment prefix", () => {
      expect(extractBranchPrefix("experiment/new-feature")).toBe("Experiment");
    });

    it("should extract spike prefix", () => {
      expect(extractBranchPrefix("spike/prototype")).toBe("Spike");
    });

    it("should extract improvement prefix", () => {
      expect(extractBranchPrefix("improvement/perf-boost")).toBe("Improvement");
    });

    it("should extract infra prefix", () => {
      expect(extractBranchPrefix("infra/docker-setup")).toBe("Infra");
    });

    it("should support custom prefixes", () => {
      expect(extractBranchPrefix("deploy/staging", ["deploy"])).toBe("Deploy");
      expect(extractBranchPrefix("research/ml-model", ["research"])).toBe("Research");
    });

    it("should handle custom prefixes with regex metacharacters", () => {
      expect(extractBranchPrefix("c++/memory-fix", ["c++"])).toBe("C++");
      // Brackets are escaped, so "wip[v2]" only matches the literal string
      expect(extractBranchPrefix("wip[v2]/thing", ["wip[v2]"])).toBe("Wip[v2]");
      expect(() => extractBranchPrefix("something/foo", ["(bad"])).not.toThrow();
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

    it("should use configured branch when explicitly set", async () => {
      mockBranchLocal.mockResolvedValue({ all: ["main", "develop"], current: "feature/test" });
      
      const result = await getDefaultBranch("/fake/path", "develop");
      expect(result).toBe("develop");
    });

    it("should pick first candidate when multiple exist", async () => {
      // main comes before develop/master in the candidates list
      mockBranchLocal.mockResolvedValue({ all: ["main", "develop", "feature/test"], current: "feature/test" });
      mockRaw.mockRejectedValue(new Error("not found"));

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });

    it("should try origin HEAD when no common branches", async () => {
      mockBranchLocal.mockResolvedValue({ all: ["feature/test"], current: "feature/test" });
      mockRaw.mockResolvedValue("refs/remotes/origin/main\n");

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });

    it("should default to 'main' when no branches found", async () => {
      mockBranchLocal.mockResolvedValue({ all: [], current: "" });
      mockRaw.mockRejectedValue(new Error("not found"));

      const result = await getDefaultBranch("/fake/path");
      expect(result).toBe("main");
    });
  });

  describe("validateRegexPattern", () => {
    it("should accept a valid simple pattern", () => {
      const result = validateRegexPattern("[A-Z]+-\\d+");
      expect(result.safe).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept a valid Jira-style pattern", () => {
      const result = validateRegexPattern("PROJ-\\d+");
      expect(result.safe).toBe(true);
    });

    it("should accept a pattern with alternation", () => {
      const result = validateRegexPattern("PROJ-\\d+|TEAM-\\d+");
      expect(result.safe).toBe(true);
    });

    it("should reject an empty pattern", () => {
      const result = validateRegexPattern("");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject a pattern exceeding max length", () => {
      const longPattern = "A".repeat(201);
      const result = validateRegexPattern(longPattern);
      expect(result.safe).toBe(false);
      expect(result.error).toContain("maximum length");
    });

    it("should accept a pattern at exactly max length", () => {
      const pattern = "A".repeat(200);
      const result = validateRegexPattern(pattern);
      expect(result.safe).toBe(true);
    });

    it("should reject nested quantifiers (ReDoS risk: (a+)+)", () => {
      const result = validateRegexPattern("(a+)+");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("nested quantifiers");
    });

    it("should reject nested quantifiers (ReDoS risk: (a*)*)", () => {
      const result = validateRegexPattern("(a*)*");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("nested quantifiers");
    });

    it("should reject nested quantifiers (ReDoS risk: (a+|b+)+)", () => {
      const result = validateRegexPattern("(a+|b+)+");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("nested quantifiers");
    });

    it("should reject an invalid regex syntax", () => {
      const result = validateRegexPattern("[invalid");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("Invalid regex");
    });

    it("should reject unclosed groups", () => {
      const result = validateRegexPattern("(abc");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("Invalid regex");
    });
  });

  describe("safeRegex", () => {
    it("should return a RegExp for a valid pattern", () => {
      const result = safeRegex("[A-Z]+-\\d+", "gi");
      expect(result).toBeInstanceOf(RegExp);
      expect(result?.flags).toContain("g");
      expect(result?.flags).toContain("i");
    });

    it("should return null for an invalid pattern", () => {
      const result = safeRegex("[invalid");
      expect(result).toBeNull();
    });

    it("should return null for a ReDoS-vulnerable pattern", () => {
      const result = safeRegex("(a+)+", "i");
      expect(result).toBeNull();
    });

    it("should return null for an empty pattern", () => {
      const result = safeRegex("");
      expect(result).toBeNull();
    });

    it("should return null for an overly long pattern", () => {
      const result = safeRegex("A".repeat(201));
      expect(result).toBeNull();
    });

    it("should work correctly when used for matching", () => {
      const regex = safeRegex("PROJ-\\d+", "i");
      expect(regex).not.toBeNull();
      const match = "feature/PROJ-1234-add-login".match(regex!);
      expect(match?.[0]).toBe("PROJ-1234");
    });
  });

  describe("extractTicketFromBranch with safeRegex", () => {
    it("should return null for ReDoS-vulnerable ticket pattern", () => {
      const result = extractTicketFromBranch("feature/test", "(a+)+");
      expect(result).toBe(null);
    });

    it("should return null for overly long ticket pattern", () => {
      const result = extractTicketFromBranch("feature/test", "A".repeat(201));
      expect(result).toBe(null);
    });
  });

  describe("getTagList", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return tags sorted by date descending", async () => {
      mockTags.mockResolvedValue({ all: ["v1.0.0", "v1.1.0"] });
      mockRaw
        .mockResolvedValueOnce("aaa1111 2024-01-01T00:00:00+00:00")
        .mockResolvedValueOnce("bbb2222 2024-06-01T00:00:00+00:00");

      const result = await getTagList("/fake/path");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("v1.1.0");
      expect(result[0].hash).toBe("bbb2222");
      expect(result[1].name).toBe("v1.0.0");
    });

    it("should return empty array when no tags exist", async () => {
      mockTags.mockResolvedValue({ all: [] });
      const result = await getTagList("/fake/path");
      expect(result).toEqual([]);
    });

    it("should handle errors gracefully", async () => {
      mockTags.mockRejectedValue(new Error("git error"));
      const result = await getTagList("/fake/path");
      expect(result).toEqual([]);
    });

    it("should handle tag info retrieval failure", async () => {
      mockTags.mockResolvedValue({ all: ["v1.0.0"] });
      mockRaw.mockRejectedValue(new Error("not found"));

      const result = await getTagList("/fake/path");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("v1.0.0");
      expect(result[0].hash).toBe("");
      expect(result[0].date).toBeNull();
    });
  });

  describe("getCommitRange", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return commits between two refs", async () => {
      mockLog.mockResolvedValue({
        all: [
          {
            hash: "abc1234567890",
            message: "feat: Add feature",
            body: "Some details",
            author_name: "Alice",
            date: "2024-01-15",
          },
          {
            hash: "def5678901234",
            message: "fix: Fix bug",
            body: "",
            author_name: "Bob",
            date: "2024-01-14",
          },
        ],
      });

      const result = await getCommitRange("/fake/path", "v1.0.0", "HEAD");
      expect(result).toHaveLength(2);
      expect(result[0].hash).toBe("abc1234567890");
      expect(result[0].shortHash).toBe("abc1234");
      expect(result[0].message).toBe("feat: Add feature");
      expect(result[0].body).toBe("Some details");
      expect(result[0].author).toBe("Alice");
      expect(result[1].author).toBe("Bob");
    });

    it("should return empty array on error", async () => {
      mockLog.mockRejectedValue(new Error("git error"));
      const result = await getCommitRange("/fake/path", "v1.0.0", "HEAD");
      expect(result).toEqual([]);
    });

    it("should handle commits with no body", async () => {
      mockLog.mockResolvedValue({
        all: [
          {
            hash: "abc1234567890",
            message: "Quick fix",
            body: undefined,
            author_name: "Charlie",
            date: "2024-02-01",
          },
        ],
      });

      const result = await getCommitRange("/fake/path", "v1.0.0", "HEAD");
      expect(result[0].body).toBe("");
    });
  });

  describe("extractCoAuthors", () => {
    it("should extract co-authors from trailer lines", () => {
      const body = `Some commit details

Co-authored-by: Alice Smith <alice@example.com>
Co-authored-by: Bob Jones <bob@example.com>`;
      const result = extractCoAuthors(body);
      expect(result).toEqual(["Alice Smith", "Bob Jones"]);
    });

    it("should return empty array for empty body", () => {
      expect(extractCoAuthors("")).toEqual([]);
    });

    it("should return empty array when no co-authors", () => {
      expect(extractCoAuthors("Just a normal commit body")).toEqual([]);
    });

    it("should handle various spacing formats", () => {
      const body = `Co-authored-by:  Jane Doe  <jane@example.com>
Co-authored-by: John  <john@example.com>`;
      const result = extractCoAuthors(body);
      expect(result).toEqual(["Jane Doe", "John"]);
    });

    it("should be case-insensitive", () => {
      const body = "co-authored-by: Alice <alice@example.com>";
      const result = extractCoAuthors(body);
      expect(result).toEqual(["Alice"]);
    });
  });
});
