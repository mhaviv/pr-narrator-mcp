import { describe, it, expect } from "vitest";
import { configSchema, defaultConfig } from "../../src/config/schema.js";

describe("configSchema", () => {
  describe("default config", () => {
    it("should have sensible defaults", () => {
      expect(defaultConfig.commit.format).toBe("simple");
      expect(defaultConfig.commit.maxTitleLength).toBe(72);
      expect(defaultConfig.commit.prefix.enabled).toBe(true);
      expect(defaultConfig.commit.prefix.style).toBe("capitalized");
      expect(defaultConfig.commit.prefix.branchFallback).toBe(true);
      expect(defaultConfig.commit.rules.imperativeMood).toBe(true);
      expect(defaultConfig.commit.rules.capitalizeTitle).toBe(true);
      expect(defaultConfig.commit.rules.noTrailingPeriod).toBe(true);
      // baseBranch is undefined by default - auto-detected from repo at runtime
      expect(defaultConfig.baseBranch).toBeUndefined();
    });

    it("should have default PR sections", () => {
      expect(defaultConfig.pr.sections).toHaveLength(2);
      expect(defaultConfig.pr.sections[0].name).toBe("Ticket");
      expect(defaultConfig.pr.sections[0].autoPopulate).toBe("extracted");
      expect(defaultConfig.pr.sections[1].name).toBe("Purpose");
      expect(defaultConfig.pr.sections[1].autoPopulate).toBe("purpose");
    });
  });

  describe("parsing valid configs", () => {
    it("should parse minimal config", () => {
      const result = configSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should parse config with ticket pattern", () => {
      const result = configSchema.safeParse({
        ticketPattern: "JIRA-\\d+",
        baseBranch: "develop",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticketPattern).toBe("JIRA-\\d+");
        expect(result.data.baseBranch).toBe("develop");
      }
    });

    it("should parse config with custom commit format", () => {
      const result = configSchema.safeParse({
        commit: {
          format: "simple",
          maxTitleLength: 100,
          requireScope: true,
          scopes: ["auth", "ui", "api"],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.commit.format).toBe("simple");
        expect(result.data.commit.maxTitleLength).toBe(100);
        expect(result.data.commit.requireScope).toBe(true);
        expect(result.data.commit.scopes).toEqual(["auth", "ui", "api"]);
      }
    });

    it("should parse config with prefix disabled", () => {
      const result = configSchema.safeParse({
        commit: {
          prefix: {
            enabled: false,
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.commit.prefix.enabled).toBe(false);
      }
    });

    it("should parse config with custom PR sections", () => {
      const result = configSchema.safeParse({
        pr: {
          sections: [
            { name: "Summary", required: true },
            { name: "Screenshots", required: false },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pr.sections).toHaveLength(2);
        expect(result.data.pr.sections[0].name).toBe("Summary");
        expect(result.data.pr.sections[1].name).toBe("Screenshots");
      }
    });

    it("should parse config with VCS integration", () => {
      const result = configSchema.safeParse({
        integrations: {
          vcs: {
            provider: "github",
            mcpServer: "user-github",
            defaultOwner: "myorg",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.integrations?.vcs?.provider).toBe("github");
        expect(result.data.integrations?.vcs?.mcpServer).toBe("user-github");
      }
    });

    it("should parse config with ticketing integration", () => {
      const result = configSchema.safeParse({
        integrations: {
          ticketing: {
            provider: "jira",
            mcpServer: "user-jira",
            fetchTicketDetails: true,
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.integrations?.ticketing?.provider).toBe("jira");
      }
    });
  });

  describe("parsing invalid configs", () => {
    it("should reject invalid commit format", () => {
      const result = configSchema.safeParse({
        commit: {
          format: "invalid-format",
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject maxTitleLength below minimum", () => {
      const result = configSchema.safeParse({
        commit: {
          maxTitleLength: 10,
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject maxTitleLength above maximum", () => {
      const result = configSchema.safeParse({
        commit: {
          maxTitleLength: 500,
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid VCS provider", () => {
      const result = configSchema.safeParse({
        integrations: {
          vcs: {
            provider: "invalid-provider",
            mcpServer: "test",
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid ticketing provider", () => {
      const result = configSchema.safeParse({
        integrations: {
          ticketing: {
            provider: "invalid-provider",
            mcpServer: "test",
          },
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
