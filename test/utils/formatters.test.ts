import { describe, it, expect } from "vitest";
import {
  formatPrefix,
  checkImperativeMood,
  capitalize,
  isCapitalized,
  removeTrailingPeriod,
  truncate,
  formatTicketLink,
  inferCommitType,
  inferScope,
  formatConventionalCommit,
  summarizeFileChanges,
  generatePurposeSummary,
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

    it("should extract summary from first commit and clean conventional commit prefix", () => {
      const commits = [
        { hash: "abc1234", message: "feat(auth): Add login functionality" },
        { hash: "def5678", message: "Add tests" },
      ];
      const files = [
        { path: "src/auth/login.ts", additions: 50, deletions: 10 },
      ];
      const summary = generatePurposeSummary(commits, files, null);
      // Should convert "Add" to "Adds" (third person present tense)
      expect(summary).toContain("Adds login functionality");
    });

    it("should use first commit title for multiple commits", () => {
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
      // Now just returns commit title - AI enhances using purposeContext
      expect(summary).toContain("Updates SDK version");
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
});
