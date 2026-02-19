import { describe, it, expect } from "vitest";
import {
  formatPrefix,
  checkImperativeMood,
  capitalize,
  isCapitalized,
  removeTrailingPeriod,
  truncate,
  truncateAtWordBoundary,
  formatTicketLink,
  inferCommitType,
  inferScope,
  formatConventionalCommit,
  summarizeFileChanges,
  generatePurposeSummary,
  detectUncoveredFiles,
  generateBestEffortTitle,
  categorizeChanges,
  generateStructuredBody,
  mapCommitTypeToChangelogSection,
  formatChangelogEntry,
} from "../../src/utils/formatters.js";

describe("formatters", () => {
  describe("formatPrefix", () => {
    const defaultPrefixConfig = {
      enabled: true,
      style: "capitalized" as const,
      branchFallback: true,
    };

    it("should return empty string when disabled", () => {
      const config = { ...defaultPrefixConfig, enabled: false };
      expect(formatPrefix(config, "JIRA-123", "Task")).toBe("");
    });

    it("should use ticket when available", () => {
      expect(formatPrefix(defaultPrefixConfig, "JIRA-123", null)).toBe("JIRA-123: ");
    });

    it("should use branch prefix as fallback and capitalize it", () => {
      expect(formatPrefix(defaultPrefixConfig, null, "task")).toBe("Task: ");
    });

    it("should return empty when no ticket and no branch prefix", () => {
      expect(formatPrefix(defaultPrefixConfig, null, null)).toBe("");
    });

    it("should not use branch fallback when disabled", () => {
      const config = { ...defaultPrefixConfig, branchFallback: false };
      expect(formatPrefix(config, null, "task")).toBe("");
    });

    it("should use bracketed style when configured", () => {
      const config = { ...defaultPrefixConfig, style: "bracketed" as const };
      expect(formatPrefix(config, "JIRA-123", null)).toBe("[JIRA-123] ");
    });

    it("should use bracketed style for branch prefix", () => {
      const config = { ...defaultPrefixConfig, style: "bracketed" as const };
      expect(formatPrefix(config, null, "task")).toBe("[Task] ");
    });
  });

  describe("checkImperativeMood", () => {
    it("should detect past tense verbs", () => {
      expect(checkImperativeMood("Added new feature")).toEqual({
        isImperative: false,
        suggestion: "Add",
      });
      expect(checkImperativeMood("Fixed bug")).toEqual({
        isImperative: false,
        suggestion: "Fix",
      });
      expect(checkImperativeMood("Updated tests")).toEqual({
        isImperative: false,
        suggestion: "Update",
      });
    });

    it("should detect gerund verbs", () => {
      expect(checkImperativeMood("Adding new feature")).toEqual({
        isImperative: false,
        suggestion: "Add",
      });
      expect(checkImperativeMood("Fixing bug")).toEqual({
        isImperative: false,
        suggestion: "Fix",
      });
    });

    it("should accept imperative verbs", () => {
      expect(checkImperativeMood("Add new feature")).toEqual({
        isImperative: true,
        suggestion: null,
      });
      expect(checkImperativeMood("Fix bug")).toEqual({
        isImperative: true,
        suggestion: null,
      });
      expect(checkImperativeMood("Update tests")).toEqual({
        isImperative: true,
        suggestion: null,
      });
    });
  });

  describe("capitalize", () => {
    it("should capitalize first letter", () => {
      expect(capitalize("hello")).toBe("Hello");
      expect(capitalize("world")).toBe("World");
    });

    it("should handle empty string", () => {
      expect(capitalize("")).toBe("");
    });

    it("should handle already capitalized", () => {
      expect(capitalize("Hello")).toBe("Hello");
    });
  });

  describe("isCapitalized", () => {
    it("should return true for capitalized strings", () => {
      expect(isCapitalized("Hello")).toBe(true);
      expect(isCapitalized("World")).toBe(true);
    });

    it("should return false for lowercase strings", () => {
      expect(isCapitalized("hello")).toBe(false);
      expect(isCapitalized("world")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isCapitalized("")).toBe(false);
    });
  });

  describe("removeTrailingPeriod", () => {
    it("should remove trailing period", () => {
      expect(removeTrailingPeriod("Hello.")).toBe("Hello");
      expect(removeTrailingPeriod("Hello...")).toBe("Hello");
    });

    it("should not modify string without trailing period", () => {
      expect(removeTrailingPeriod("Hello")).toBe("Hello");
    });
  });

  describe("truncate", () => {
    it("should truncate long strings", () => {
      expect(truncate("This is a very long string", 15)).toBe("This is a ve...");
    });

    it("should not modify short strings", () => {
      expect(truncate("Short", 15)).toBe("Short");
    });

    it("should handle exact length", () => {
      expect(truncate("Exact", 5)).toBe("Exact");
    });
  });

  describe("truncateAtWordBoundary", () => {
    it("should not truncate strings within limit", () => {
      expect(truncateAtWordBoundary("Short title", 50)).toBe("Short title");
    });

    it("should truncate at the last space before maxLength", () => {
      const result = truncateAtWordBoundary(
        "Add user authentication and authorization flow with tests",
        40
      );
      expect(result.length).toBeLessThanOrEqual(40);
      expect(result).not.toContain("...");
      expect(result).toBe("Add user authentication and");
    });

    it("should fall back to ellipsis when no good word boundary exists", () => {
      const result = truncateAtWordBoundary("Abcdefghijklmnopqrstuvwxyz", 15);
      expect(result).toContain("...");
      expect(result.length).toBeLessThanOrEqual(15);
    });

    it("should handle exact length", () => {
      expect(truncateAtWordBoundary("Exact", 5)).toBe("Exact");
    });
  });

  describe("formatTicketLink", () => {
    it("should format ticket as markdown link", () => {
      expect(
        formatTicketLink("JIRA-123", "https://jira.example.com/browse/{ticket}")
      ).toBe("[JIRA-123](https://jira.example.com/browse/JIRA-123)");
    });

    it("should return plain ticket when no link format", () => {
      expect(formatTicketLink("JIRA-123", undefined)).toBe("JIRA-123");
    });
  });

  describe("inferCommitType", () => {
    it("should infer test type for test files", () => {
      expect(inferCommitType(["src/utils/helper.test.ts"])).toBe("test");
      expect(inferCommitType(["__tests__/app.ts"])).toBe("test");
    });

    it("should infer docs type for documentation files", () => {
      expect(inferCommitType(["README.md"])).toBe("docs");
      expect(inferCommitType(["docs/guide.md"])).toBe("docs");
    });

    it("should infer build type for package files", () => {
      expect(inferCommitType(["package.json"])).toBe("build");
      expect(inferCommitType(["requirements.txt"])).toBe("build");
      expect(inferCommitType(["package-lock.json"])).toBe("build");
    });

    it("should infer chore type for config files", () => {
      expect(inferCommitType(["tsconfig.json"])).toBe("chore");
      expect(inferCommitType([".env.example"])).toBe("chore");
    });

    it("should infer ci type for CI files", () => {
      expect(inferCommitType([".github/workflows/deploy.yml"])).toBe("ci");
      expect(inferCommitType(["Dockerfile"])).toBe("ci");
      expect(inferCommitType(["Jenkinsfile"])).toBe("ci");
    });

    it("should infer style type for style files", () => {
      expect(inferCommitType(["src/styles/main.css"])).toBe("style");
      expect(inferCommitType(["app.scss"])).toBe("style");
    });

    it("should default to feat for other files", () => {
      expect(inferCommitType(["src/components/Button.tsx"])).toBe("feat");
      expect(inferCommitType(["lib/utils.ts"])).toBe("feat");
    });

    it("should return feat when code files are the majority despite a README", () => {
      const files = [
        "src/Models/User.swift",
        "src/Models/Post.swift",
        "src/Views/UserView.swift",
        "src/Views/PostView.swift",
        "src/Protocols/Routable.swift",
        "src/Routing/Router.swift",
        "src/Routing/AppRouter.swift",
        "src/Config/AppConfig.swift",
        "src/Config/Environment.swift",
        "src/Services/APIService.swift",
        "src/Services/AuthService.swift",
        "src/Services/NetworkService.swift",
        "src/Coordinators/AppCoordinator.swift",
        "src/Coordinators/AuthCoordinator.swift",
        "src/Extensions/String+Utils.swift",
        "project.pbxproj",
        "README.md",
      ];
      expect(inferCommitType(files)).toBe("feat");
    });

    it("should return docs when docs files are the majority", () => {
      expect(
        inferCommitType(["README.md", "docs/guide.md", "docs/api.md"])
      ).toBe("docs");
    });

    it("should return feat for mixed files with no majority", () => {
      expect(
        inferCommitType(["README.md", "src/app.ts", "test/app.test.ts"])
      ).toBe("feat");
    });

    it("should handle empty array", () => {
      expect(inferCommitType([])).toBe("feat");
    });
  });

  describe("inferScope", () => {
    it("should infer scope from directory", () => {
      expect(inferScope(["src/auth/login.ts", "src/auth/logout.ts"])).toBe("auth");
    });

    it("should return most common directory", () => {
      expect(
        inferScope([
          "src/auth/login.ts",
          "src/auth/logout.ts",
          "src/utils/helper.ts",
        ])
      ).toBe("auth");
    });

    it("should skip common root directories", () => {
      expect(inferScope(["src/components/Button.tsx"])).toBe("components");
    });

    it("should filter by allowed scopes", () => {
      // Exact match
      expect(
        inferScope(["src/auth/login.ts"], ["auth", "ui"])
      ).toBe("auth");
      
      // Partial match - "auth" is substring of "authentication"
      expect(
        inferScope(["src/auth/login.ts"], ["authentication", "ui"])
      ).toBe("authentication");
      
      // No match when scope doesn't match any allowed
      expect(
        inferScope(["src/payments/checkout.ts"], ["auth", "ui"])
      ).toBe(null);
    });

    it("should return null for empty array", () => {
      expect(inferScope([])).toBe(null);
    });
  });

  describe("formatConventionalCommit", () => {
    it("should format without scope", () => {
      expect(formatConventionalCommit("feat", null, "Add login")).toBe(
        "feat: Add login"
      );
    });

    it("should format with scope", () => {
      expect(formatConventionalCommit("feat", "auth", "Add login")).toBe(
        "feat(auth): Add login"
      );
    });

    it("should format breaking change", () => {
      expect(formatConventionalCommit("feat", "api", "Change endpoint", true)).toBe(
        "feat(api)!: Change endpoint"
      );
    });
  });

  describe("summarizeFileChanges", () => {
    it("should summarize file changes", () => {
      const files = [
        { path: "src/index.ts", additions: 10, deletions: 5 },
        { path: "src/utils.ts", additions: 20, deletions: 0 },
      ];
      const summary = summarizeFileChanges(files);
      expect(summary).toContain("2 file(s) changed");
      expect(summary).toContain("+30 -5 lines");
    });

    it("should handle empty files array", () => {
      expect(summarizeFileChanges([])).toBe("No files changed");
    });
  });

  describe("generatePurposeSummary", () => {
    it("should generate summary from single commit", () => {
      const commits = [{ hash: "abc1234", message: "Add user authentication" }];
      const files = [
        { path: "src/auth/login.ts", additions: 50, deletions: 0 },
      ];
      const summary = generatePurposeSummary(commits, files, "feature/add-user-authentication");
      expect(summary).toContain("Adds user authentication");
    });

    it("should extract summary from oldest commit and clean conventional commit prefix", () => {
      const commits = [
        { hash: "def5678", message: "Add tests" },
        { hash: "abc1234", message: "feat(auth): Add login functionality" },
      ];
      const files = [
        { path: "src/auth/login.ts", additions: 50, deletions: 10 },
      ];
      const summary = generatePurposeSummary(commits, files, null);
      // Should use oldest commit (last in array) and convert "Add" to "Adds"
      expect(summary).toContain("Adds login functionality");
    });

    it("should use oldest commit title for multiple commits", () => {
      const commits = [
        { hash: "abc1234", message: "Update SDK version" },
        { hash: "def5678", message: "Fix config loading" },
        { hash: "ghi9012", message: "Add new API endpoint" },
      ];
      const files = [
        { path: "src/index.ts", additions: 100, deletions: 50 },
        { path: "src/utils.ts", additions: 20, deletions: 5 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/update-sdk");
      // Uses oldest commit (last in array) as the main intent
      expect(summary).toContain("Adds new API endpoint");
    });

    it("should handle empty commits and files", () => {
      const summary = generatePurposeSummary([], [], null);
      expect(summary).toBe("_No changes detected_");
    });

    it("should return commit title (AI handles test mentions via purposeContext)", () => {
      const commits = [{ hash: "abc1234", message: "Add feature" }];
      const files = [
        { path: "src/auth/feature.ts", additions: 50, deletions: 0 },
        { path: "src/auth/__tests__/feature.test.ts", additions: 100, deletions: 0 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/add-feature");
      // Just returns commit title - AI uses purposeContext.hasTests to add test mentions
      expect(summary).toContain("Adds feature");
    });

    it("should handle CI-only changes", () => {
      const commits = [{ hash: "abc1234", message: "Update CI pipeline" }];
      const files = [
        { path: ".github/workflows/ci.yml", additions: 20, deletions: 5 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/update-ci");
      expect(summary).toContain("Updates CI pipeline");
    });

    it("should remove ticket patterns from branch name", () => {
      const commits = [{ hash: "abc1234", message: "Fix login issue" }];
      const files = [{ path: "src/fix.ts", additions: 10, deletions: 5 }];
      const summary = generatePurposeSummary(commits, files, "bug/JIRA-123-fix-login-issue");
      expect(summary).not.toContain("JIRA-123");
      expect(summary).toContain("Fixes");
    });

    it("should convert past tense to present tense", () => {
      const commits = [{ hash: "abc1234", message: "Added new feature" }];
      const files = [{ path: "src/feature.ts", additions: 10, deletions: 5 }];
      const summary = generatePurposeSummary(commits, files, null);
      expect(summary).toContain("Adds new feature");
    });

    it("should stay within 500 character limit", () => {
      const commits = Array(50).fill(null).map((_, i) => ({
        hash: `hash${i}`,
        message: `Very long commit message number ${i} with lots of detail`,
      }));
      const files = Array(100).fill(null).map((_, i) => ({
        path: `src/components/very/deeply/nested/component${i}.ts`,
        additions: 100,
        deletions: 50,
      }));
      const summary = generatePurposeSummary(commits, files, "feature/very-long-branch-name-with-lots-of-detail");
      expect(summary.length).toBeLessThanOrEqual(500);
    });

    it("should return commit title (AI uses purposeContext.commitBullets to enhance)", () => {
      const commits = [{
        hash: "abc1234",
        message: `Add new feature

- Update the API endpoint
- Fix the validation logic
- Add error handling`,
      }];
      const files = [
        { path: "src/api.ts", additions: 50, deletions: 10 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/add-feature");
      
      // Just returns commit title - AI uses purposeContext.commitBullets to enhance
      expect(summary).toContain("Adds new feature");
      // No bullets in output - that's for AI to handle
      expect(summary).not.toContain("- ");
    });

    it("should return commit title for complex commits (AI enhances via purposeContext)", () => {
      const commits = [{
        hash: "abc1234",
        message: `Ping PR author in thread when Slack build notifications fail

- Extract PR author from GitHub PR metadata
- Encode author in tag suffix for Azure pipelines
- Add threaded failure notification in slack_aggregator.py
- Look up Slack user ID from SLACK_USER_{username} env variables`,
      }];
      const files = [
        { path: "Buildscripts/Scripts/slack_aggregator.py", additions: 190, deletions: 10 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/slack-build-notification-ping-pr-author-on-failure");
      
      // Should include the main commit title
      expect(summary).toContain("Ping PR author in thread when Slack build notifications fail");
      // No bullets copied - AI uses purposeContext to write prose
      expect(summary).not.toContain("- Extract");
      expect(summary).not.toContain("- Encode");
    });

    it("should return commit title (AI uses purposeContext.hasTests for test mentions)", () => {
      const commits = [{ hash: "abc1234", message: "Add failure notifications" }];
      const files = [
        { path: "Buildscripts/Scripts/slack_aggregator.py", additions: 190, deletions: 10 },
        { path: "Buildscripts/Tests/test_failure_notifications.py", additions: 262, deletions: 0 },
      ];
      const summary = generatePurposeSummary(commits, files, "task/add-notifications");
      // Just returns commit title - AI uses purposeContext.hasTests to mention tests
      expect(summary).toContain("Adds failure notifications");
    });
  });

  describe("detectUncoveredFiles", () => {
    it("should return empty for single file", () => {
      expect(detectUncoveredFiles("Update login", ["src/auth/login.ts"])).toEqual([]);
    });

    it("should detect uncovered files based on filename keywords", () => {
      const uncovered = detectUncoveredFiles(
        "Add video player SDK integration",
        [
          "src/VideoPlayerSDK.swift",
          "src/BootstrapCoordinator.swift",
          "src/LaunchArguments.swift",
        ]
      );
      expect(uncovered).toContain("src/BootstrapCoordinator.swift");
      expect(uncovered).toContain("src/LaunchArguments.swift");
      // VideoPlayerSDK is covered because "video", "player", "sdk" appear in summary
      expect(uncovered).not.toContain("src/VideoPlayerSDK.swift");
    });

    it("should not flag files whose names appear in the summary", () => {
      const uncovered = detectUncoveredFiles(
        "Update player SDK and bootstrap coordinator",
        [
          "src/PlayerSDK.swift",
          "src/BootstrapCoordinator.swift",
        ]
      );
      expect(uncovered).toEqual([]);
    });

    it("should handle camelCase splitting", () => {
      const uncovered = detectUncoveredFiles(
        "Fix authentication flow",
        [
          "src/AuthenticationFlow.swift",
          "src/UserProfile.swift",
        ]
      );
      // "authentication" and "flow" are in the summary
      expect(uncovered).not.toContain("src/AuthenticationFlow.swift");
      expect(uncovered).toContain("src/UserProfile.swift");
    });
  });

  describe("generateBestEffortTitle", () => {
    it("should handle single file", () => {
      const title = generateBestEffortTitle([
        { path: "src/auth/login.ts", additions: 10, deletions: 5 },
      ]);
      expect(title).toBe("Update login.ts");
    });

    it("should detect all-new files", () => {
      const title = generateBestEffortTitle([
        { path: "src/utils/helper.ts", additions: 50, deletions: 0 },
        { path: "src/utils/format.ts", additions: 30, deletions: 0 },
      ]);
      expect(title).toContain("Add");
      expect(title).not.toMatch(/\d+ files/);
    });

    it("should detect all-deleted files", () => {
      const title = generateBestEffortTitle([
        { path: "src/old/legacy.ts", additions: 0, deletions: 50 },
        { path: "src/old/deprecated.ts", additions: 0, deletions: 30 },
      ]);
      expect(title).toContain("Remove");
      expect(title).not.toMatch(/\d+ files/);
    });

    it("should use common directory when files share a path", () => {
      const title = generateBestEffortTitle([
        { path: "src/auth/login.ts", additions: 10, deletions: 5 },
        { path: "src/auth/logout.ts", additions: 10, deletions: 5 },
        { path: "src/auth/register.ts", additions: 10, deletions: 5 },
      ]);
      expect(title).toContain("auth");
      expect(title).not.toMatch(/\d+ files/);
    });

    it("should mention dominant file type without common dir", () => {
      const title = generateBestEffortTitle([
        { path: "User.swift", additions: 10, deletions: 5 },
        { path: "Post.swift", additions: 10, deletions: 5 },
      ]);
      expect(title).toContain("Swift source");
      expect(title).not.toMatch(/\d+/);
    });

    it("should prefer common directory over file type", () => {
      const title = generateBestEffortTitle([
        { path: "Models/User.swift", additions: 10, deletions: 5 },
        { path: "Models/Post.swift", additions: 10, deletions: 5 },
      ]);
      expect(title).toContain("Models");
      expect(title).not.toMatch(/\d+/);
    });

    it("should never include file counts in the title", () => {
      const title = generateBestEffortTitle([
        { path: "a.ts", additions: 10, deletions: 5 },
        { path: "b.ts", additions: 10, deletions: 5 },
        { path: "c.ts", additions: 10, deletions: 5 },
        { path: "d.ts", additions: 10, deletions: 5 },
      ]);
      expect(title).not.toMatch(/\d+ files/);
      expect(title).not.toMatch(/\d+ \.ts/);
    });

    it("should handle empty array", () => {
      const title = generateBestEffortTitle([]);
      expect(title).toBe("Update project");
    });
  });

  describe("summarizeFileChanges (categorized)", () => {
    it("should include categorized breakdown for >3 files", () => {
      const files = [
        { path: "src/App.swift", additions: 10, deletions: 5 },
        { path: "src/View.swift", additions: 20, deletions: 0 },
        { path: "project.pbxproj", additions: 50, deletions: 10 },
        { path: "config.xcconfig", additions: 5, deletions: 2 },
      ];
      const summary = summarizeFileChanges(files);
      expect(summary).toContain("4 file(s) changed");
      expect(summary).toContain("Swift source");
      expect(summary).toContain("Xcode project config");
      expect(summary).toContain("Xcode build settings");
    });

    it("should not include breakdown for <=3 files", () => {
      const files = [
        { path: "src/index.ts", additions: 10, deletions: 5 },
        { path: "src/utils.ts", additions: 20, deletions: 0 },
      ];
      const summary = summarizeFileChanges(files);
      expect(summary).not.toContain("TypeScript");
    });

    it("should omit stats when includeStats is false", () => {
      const files = [
        { path: "src/App.swift", additions: 10, deletions: 5 },
        { path: "src/View.swift", additions: 20, deletions: 0 },
        { path: "project.pbxproj", additions: 50, deletions: 10 },
        { path: "config.xcconfig", additions: 5, deletions: 2 },
      ];
      const summary = summarizeFileChanges(files, { includeStats: false });
      expect(summary).not.toContain("file(s) changed");
      expect(summary).not.toContain("+");
      expect(summary).not.toContain("lines");
      // Still shows categorized breakdown
      expect(summary).toContain("Swift source");
    });

    it("should include stats by default", () => {
      const files = [
        { path: "src/index.ts", additions: 10, deletions: 5 },
        { path: "src/utils.ts", additions: 20, deletions: 0 },
      ];
      const summary = summarizeFileChanges(files);
      expect(summary).toContain("2 file(s) changed");
      expect(summary).toContain("+30 -5 lines");
    });
  });

  describe("categorizeChanges", () => {
    it("should group files by category", () => {
      const groups = categorizeChanges([
        "src/Player.swift",
        "src/Config.swift",
        "project.pbxproj",
        "settings.xcconfig",
        "assets.json",
      ]);
      expect(groups.length).toBeGreaterThan(1);

      const swiftGroup = groups.find(g => g.category === "Swift source");
      expect(swiftGroup).toBeDefined();
      expect(swiftGroup!.files).toHaveLength(2);

      const pbxGroup = groups.find(g => g.category === "Xcode project config");
      expect(pbxGroup).toBeDefined();
      expect(pbxGroup!.files).toHaveLength(1);
    });

    it("should sort groups by file count descending", () => {
      const groups = categorizeChanges([
        "a.swift", "b.swift", "c.swift",
        "d.json",
        "e.pbxproj",
      ]);
      expect(groups[0].category).toBe("Swift source");
      expect(groups[0].files).toHaveLength(3);
    });

    it("should return empty for no files", () => {
      expect(categorizeChanges([])).toEqual([]);
    });
  });

  describe("generateStructuredBody", () => {
    it("should return empty string for empty input", () => {
      expect(generateStructuredBody([])).toBe("");
    });

    it("should list single files by name", () => {
      const groups = [{ category: "Markdown/docs", files: ["README.md"] }];
      const body = generateStructuredBody(groups);
      expect(body).toBe("- Markdown/docs: README.md");
    });

    it("should list filenames for small groups (<=3)", () => {
      const groups = [
        {
          category: "Swift source",
          files: ["src/User.swift", "src/Post.swift"],
        },
      ];
      const body = generateStructuredBody(groups);
      expect(body).toBe("- Swift source: User.swift, Post.swift");
    });

    it("should show count for large groups (>3)", () => {
      const groups = [
        {
          category: "Swift source",
          files: [
            "src/A.swift",
            "src/B.swift",
            "src/C.swift",
            "src/D.swift",
          ],
        },
      ];
      const body = generateStructuredBody(groups);
      expect(body).toBe("- Swift source: 4 files");
    });

    it("should produce multi-line output for multiple categories", () => {
      const groups = [
        {
          category: "Swift source",
          files: [
            "src/A.swift",
            "src/B.swift",
            "src/C.swift",
            "src/D.swift",
          ],
        },
        { category: "Xcode project config", files: ["project.pbxproj"] },
        { category: "Markdown/docs", files: ["README.md"] },
      ];
      const body = generateStructuredBody(groups);
      const lines = body.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("Swift source: 4 files");
      expect(lines[1]).toContain("Xcode project config: project.pbxproj");
      expect(lines[2]).toContain("Markdown/docs: README.md");
    });
  });

  describe("mapCommitTypeToChangelogSection", () => {
    it("should map feat to Added", () => {
      expect(mapCommitTypeToChangelogSection("feat")).toBe("Added");
    });

    it("should map fix to Fixed", () => {
      expect(mapCommitTypeToChangelogSection("fix")).toBe("Fixed");
    });

    it("should map docs to Documentation", () => {
      expect(mapCommitTypeToChangelogSection("docs")).toBe("Documentation");
    });

    it("should map revert to Reverted", () => {
      expect(mapCommitTypeToChangelogSection("revert")).toBe("Reverted");
    });

    it("should map style, refactor, perf, test, build, ci, chore to Changed", () => {
      for (const type of ["style", "refactor", "perf", "test", "build", "ci", "chore"]) {
        expect(mapCommitTypeToChangelogSection(type)).toBe("Changed");
      }
    });

    it("should map other to Other", () => {
      expect(mapCommitTypeToChangelogSection("other")).toBe("Other");
    });

    it("should map unknown types to Other", () => {
      expect(mapCommitTypeToChangelogSection("random")).toBe("Other");
      expect(mapCommitTypeToChangelogSection("")).toBe("Other");
    });

    it("should be case-insensitive", () => {
      expect(mapCommitTypeToChangelogSection("FEAT")).toBe("Added");
      expect(mapCommitTypeToChangelogSection("Fix")).toBe("Fixed");
    });
  });

  describe("formatChangelogEntry", () => {
    const baseEntry = {
      title: "Add user authentication",
      hash: "abc1234",
      author: "alice",
      scope: null,
    };

    it("should format keepachangelog without scope", () => {
      const result = formatChangelogEntry(baseEntry, "keepachangelog", false);
      expect(result).toBe("- Add user authentication (abc1234)");
    });

    it("should format keepachangelog with scope", () => {
      const entry = { ...baseEntry, scope: "api" };
      const result = formatChangelogEntry(entry, "keepachangelog", false);
      expect(result).toBe("- **api**: Add user authentication (abc1234)");
    });

    it("should format github-release with author", () => {
      const result = formatChangelogEntry(baseEntry, "github-release", true);
      expect(result).toBe("- Add user authentication by **alice** in abc1234");
    });

    it("should format github-release without author", () => {
      const result = formatChangelogEntry(baseEntry, "github-release", false);
      expect(result).toBe("- Add user authentication in abc1234");
    });

    it("should format github-release with scope and author", () => {
      const entry = { ...baseEntry, scope: "auth" };
      const result = formatChangelogEntry(entry, "github-release", true);
      expect(result).toBe("- **auth**: Add user authentication by **alice** in abc1234");
    });

    it("should format plain without scope", () => {
      const result = formatChangelogEntry(baseEntry, "plain", false);
      expect(result).toBe("- Add user authentication");
    });

    it("should format plain with scope", () => {
      const entry = { ...baseEntry, scope: "auth" };
      const result = formatChangelogEntry(entry, "plain", false);
      expect(result).toBe("- [auth] Add user authentication");
    });
  });
});
