import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateCommitMessage } from "../../src/tools/validate-commit-message.js";
import { defaultConfig } from "../../src/config/schema.js";

describe("validateCommitMessage", () => {
  const testConfig = {
    ...defaultConfig,
    commit: {
      ...defaultConfig.commit,
      format: "conventional" as const,
      scopes: ["auth", "ui", "api"],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("valid messages", () => {
    it("should validate a correct conventional commit", () => {
      const result = validateCommitMessage({
        message: "feat(auth): Add login functionality",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.parsed.isConventional).toBe(true);
      expect(result.parsed.type).toBe("feat");
      expect(result.parsed.scope).toBe("auth");
    });

    it("should validate conventional commit without scope", () => {
      const result = validateCommitMessage({
        message: "fix: Resolve memory leak",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.parsed.type).toBe("fix");
      expect(result.parsed.scope).toBe(null);
    });

    it("should validate breaking change marker", () => {
      const result = validateCommitMessage({
        message: "feat(api)!: Change response format",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.parsed.isConventional).toBe(true);
    });
  });

  describe("invalid messages", () => {
    it("should reject empty message", () => {
      const result = validateCommitMessage({ message: "" }, testConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Commit message cannot be empty");
    });

    it("should warn about message exceeding max length (soft limit)", () => {
      const longMessage = "feat: " + "A".repeat(150);
      const result = validateCommitMessage({ message: longMessage }, testConfig);

      // Length is a soft warning, not a hard error
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("characters"))).toBe(true);
    });

    it("should require scope when configured", () => {
      const scopeRequiredConfig = {
        ...testConfig,
        commit: { ...testConfig.commit, requireScope: true },
      };

      const result = validateCommitMessage({
        message: "feat: Add feature without scope",
      }, scopeRequiredConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Scope is required but not provided");
    });

    it("should require body when configured", () => {
      const bodyRequiredConfig = {
        ...testConfig,
        commit: { ...testConfig.commit, requireBody: true },
      };

      const result = validateCommitMessage({
        message: "feat(auth): Add login",
      }, bodyRequiredConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Commit body is required but not provided");
    });
  });

  describe("warnings", () => {
    it("should warn about non-conventional format", () => {
      const result = validateCommitMessage({
        message: "Add new feature",
      }, testConfig);

      expect(result.warnings).toContain(
        "Message does not follow conventional commit format: type(scope): message"
      );
    });

    it("should warn about scope not in allowed list", () => {
      const result = validateCommitMessage({
        message: "feat(unknown): Add feature",
      }, testConfig);

      expect(result.warnings.some((w) => w.includes("not in allowed scopes"))).toBe(true);
    });

    it("should warn about non-imperative mood", () => {
      const result = validateCommitMessage({
        message: "feat(auth): Added login functionality",
      }, testConfig);

      expect(result.warnings.some((w) => w.includes("imperative"))).toBe(true);
    });

    it("should warn about trailing period", () => {
      const result = validateCommitMessage({
        message: "feat(auth): Add login functionality.",
      }, testConfig);

      expect(result.warnings).toContain("Title should not end with a period");
    });

    it("should warn about uncapitalized title", () => {
      const result = validateCommitMessage({
        message: "feat(auth): add login functionality",
      }, testConfig);

      expect(result.warnings).toContain("Title should start with a capital letter");
    });
  });

  describe("message parsing", () => {
    it("should parse message with body", () => {
      const result = validateCommitMessage({
        message: "feat(auth): Add login\n\nThis adds login functionality",
      }, testConfig);

      expect(result.parsed.title).toBe("feat(auth): Add login");
      expect(result.parsed.body).toBe("This adds login functionality");
    });

    it("should handle multi-line body", () => {
      const result = validateCommitMessage({
        message: "feat(auth): Add login\n\nLine 1\nLine 2\nLine 3",
      }, testConfig);

      expect(result.parsed.body).toContain("Line 1");
      expect(result.parsed.body).toContain("Line 3");
    });
  });
});
