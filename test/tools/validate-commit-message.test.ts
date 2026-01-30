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
    it("should validate a correct conventional commit", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Add login functionality",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.parsed.isConventional).toBe(true);
      expect(result.parsed.type).toBe("feat");
      expect(result.parsed.scope).toBe("auth");
    });

    it("should validate conventional commit without scope", async () => {
      const result = await validateCommitMessage({
        message: "fix: Resolve memory leak",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.parsed.type).toBe("fix");
      expect(result.parsed.scope).toBe(null);
    });

    it("should validate breaking change marker", async () => {
      const result = await validateCommitMessage({
        message: "feat(api)!: Change response format",
      }, testConfig);

      expect(result.valid).toBe(true);
      expect(result.parsed.isConventional).toBe(true);
    });
  });

  describe("invalid messages", () => {
    it("should reject empty message", async () => {
      const result = await validateCommitMessage({ message: "" }, testConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Commit message cannot be empty");
    });

    it("should reject message exceeding max length", async () => {
      const longMessage = "feat: " + "A".repeat(100);
      const result = await validateCommitMessage({ message: longMessage }, testConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("exceeds"))).toBe(true);
    });

    it("should require scope when configured", async () => {
      const scopeRequiredConfig = {
        ...testConfig,
        commit: { ...testConfig.commit, requireScope: true },
      };

      const result = await validateCommitMessage({
        message: "feat: Add feature without scope",
      }, scopeRequiredConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Scope is required but not provided");
    });

    it("should require body when configured", async () => {
      const bodyRequiredConfig = {
        ...testConfig,
        commit: { ...testConfig.commit, requireBody: true },
      };

      const result = await validateCommitMessage({
        message: "feat(auth): Add login",
      }, bodyRequiredConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Commit body is required but not provided");
    });
  });

  describe("warnings", () => {
    it("should warn about non-conventional format", async () => {
      const result = await validateCommitMessage({
        message: "Add new feature",
      }, testConfig);

      expect(result.warnings).toContain(
        "Message does not follow conventional commit format: type(scope): message"
      );
    });

    it("should warn about scope not in allowed list", async () => {
      const result = await validateCommitMessage({
        message: "feat(unknown): Add feature",
      }, testConfig);

      expect(result.warnings.some((w) => w.includes("not in allowed scopes"))).toBe(true);
    });

    it("should warn about non-imperative mood", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Added login functionality",
      }, testConfig);

      expect(result.warnings.some((w) => w.includes("imperative"))).toBe(true);
    });

    it("should warn about trailing period", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Add login functionality.",
      }, testConfig);

      expect(result.warnings).toContain("Title should not end with a period");
    });

    it("should warn about uncapitalized title", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): add login functionality",
      }, testConfig);

      expect(result.warnings).toContain("Title should start with a capital letter");
    });
  });

  describe("message parsing", () => {
    it("should parse message with body", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Add login\n\nThis adds login functionality",
      }, testConfig);

      expect(result.parsed.title).toBe("feat(auth): Add login");
      expect(result.parsed.body).toBe("This adds login functionality");
    });

    it("should handle multi-line body", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Add login\n\nLine 1\nLine 2\nLine 3",
      }, testConfig);

      expect(result.parsed.body).toContain("Line 1");
      expect(result.parsed.body).toContain("Line 3");
    });
  });
});
