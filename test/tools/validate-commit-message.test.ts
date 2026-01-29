import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateCommitMessage } from "../../src/tools/validate-commit-message.js";

// Mock the config loader
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      commit: {
        format: "conventional",
        maxTitleLength: 72,
        maxBodyLineLength: 100,
        requireScope: false,
        requireBody: false,
        scopes: ["auth", "ui", "api"],
        prefix: {
          enabled: true,
          ticketFormat: "{ticket}: ",
          branchFallback: true,
        },
        rules: {
          imperativeMood: true,
          capitalizeTitle: true,
          noTrailingPeriod: true,
        },
      },
      pr: { title: { prefix: { enabled: true } }, sections: [] },
      baseBranch: "main",
    },
    configPath: null,
    errors: [],
  }),
}));

describe("validateCommitMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("valid messages", () => {
    it("should validate a correct conventional commit", async () => {
      const result = await validateCommitMessage({
        message: "feat(auth): Add login functionality",
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.parsed.isConventional).toBe(true);
      expect(result.parsed.type).toBe("feat");
      expect(result.parsed.scope).toBe("auth");
    });

    it("should validate conventional commit without scope", async () => {
      const result = await validateCommitMessage({
        message: "fix: Resolve memory leak",
      });
      
      expect(result.valid).toBe(true);
      expect(result.parsed.type).toBe("fix");
      expect(result.parsed.scope).toBe(null);
    });

    it("should validate simple message", async () => {
      const result = await validateCommitMessage({
        message: "Add new feature",
      });
      
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid messages", () => {
    it("should reject empty message", async () => {
      const result = await validateCommitMessage({
        message: "",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Commit message cannot be empty");
    });

    it("should reject message exceeding max length", async () => {
      const longMessage = "feat: " + "a".repeat(100);
      const result = await validateCommitMessage({
        message: longMessage,
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("exceeds"))).toBe(true);
    });
  });

  describe("warnings", () => {
    it("should warn about past tense verbs", async () => {
      const result = await validateCommitMessage({
        message: "feat: Added new feature",
      });
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("imperative"))).toBe(true);
    });

    it("should warn about non-capitalized title", async () => {
      const result = await validateCommitMessage({
        message: "feat: add new feature",
      });
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("capital"))).toBe(true);
    });

    it("should warn about trailing period", async () => {
      const result = await validateCommitMessage({
        message: "feat: Add new feature.",
      });
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("period"))).toBe(true);
    });

    it("should warn about non-conventional format", async () => {
      const result = await validateCommitMessage({
        message: "Add new feature",
      });
      
      expect(result.warnings.some(w => w.includes("conventional"))).toBe(true);
    });

    it("should warn about scope not in allowed list", async () => {
      const result = await validateCommitMessage({
        message: "feat(unknown): Add feature",
      });
      
      expect(result.warnings.some(w => w.includes("allowed scopes"))).toBe(true);
    });
  });

  describe("parsing", () => {
    it("should parse conventional commit with breaking change", async () => {
      const result = await validateCommitMessage({
        message: "feat(api)!: Change endpoint structure",
      });
      
      expect(result.parsed.type).toBe("feat");
      expect(result.parsed.scope).toBe("api");
      expect(result.parsed.isConventional).toBe(true);
    });

    it("should parse message with body", async () => {
      const result = await validateCommitMessage({
        message: "feat: Add login\n\nThis adds the login functionality\nwith OAuth support.",
      });
      
      expect(result.parsed.title).toBe("feat: Add login");
      expect(result.parsed.body).toContain("login functionality");
    });

    it("should parse non-conventional message", async () => {
      const result = await validateCommitMessage({
        message: "Update README with new instructions",
      });
      
      expect(result.parsed.isConventional).toBe(false);
      expect(result.parsed.type).toBe(null);
      expect(result.parsed.scope).toBe(null);
    });
  });

  describe("issues array", () => {
    it("should include detailed issue information", async () => {
      const result = await validateCommitMessage({
        message: "feat: added feature.",
      });
      
      expect(result.issues.length).toBeGreaterThan(0);
      
      const imperativeIssue = result.issues.find(i => i.rule === "imperative-mood");
      expect(imperativeIssue).toBeDefined();
      expect(imperativeIssue?.severity).toBe("warning");
      
      const periodIssue = result.issues.find(i => i.rule === "no-trailing-period");
      expect(periodIssue).toBeDefined();
    });
  });
});
