import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "../../src/config/loader.js";
import { defaultConfig } from "../../src/config/schema.js";

describe("getConfig", () => {
  beforeEach(() => {
    // Clear env vars
    delete process.env.BASE_BRANCH;
    delete process.env.TICKET_PATTERN;
    delete process.env.TICKET_LINK;
    delete process.env.PREFIX_STYLE;
    delete process.env.DEFAULT_REPO_PATH;
  });

  afterEach(() => {
    delete process.env.BASE_BRANCH;
    delete process.env.TICKET_PATTERN;
    delete process.env.TICKET_LINK;
    delete process.env.PREFIX_STYLE;
    delete process.env.DEFAULT_REPO_PATH;
  });

  it("should return defaults when no env vars set", () => {
    const config = getConfig();
    expect(config.baseBranch).toBeUndefined();
    expect(config.commit.maxTitleLength).toBe(defaultConfig.commit.maxTitleLength);
  });

  it("should parse BASE_BRANCH", () => {
    process.env.BASE_BRANCH = "develop";
    const config = getConfig();
    expect(config.baseBranch).toBe("develop");
  });

  it("should parse TICKET_PATTERN", () => {
    process.env.TICKET_PATTERN = "[A-Z]+-\\d+";
    const config = getConfig();
    expect(config.ticketPattern).toBe("[A-Z]+-\\d+");
  });

  it("should parse TICKET_LINK", () => {
    process.env.TICKET_LINK = "https://jira.example.com/browse/{ticket}";
    const config = getConfig();
    expect(config.ticketLinkFormat).toBe("https://jira.example.com/browse/{ticket}");
  });

  it("should parse PREFIX_STYLE", () => {
    process.env.PREFIX_STYLE = "bracketed";
    const config = getConfig();
    expect(config.commit.prefix.style).toBe("bracketed");
  });

  it("should parse DEFAULT_REPO_PATH", () => {
    process.env.DEFAULT_REPO_PATH = "/Users/me/my-project";
    const config = getConfig();
    expect(config.defaultRepoPath).toBe("/Users/me/my-project");
  });

  it("should combine multiple env vars", () => {
    process.env.BASE_BRANCH = "develop";
    process.env.TICKET_PATTERN = "JIRA-\\d+";
    process.env.PREFIX_STYLE = "bracketed";
    
    const config = getConfig();
    
    expect(config.baseBranch).toBe("develop");
    expect(config.ticketPattern).toBe("JIRA-\\d+");
    expect(config.commit.prefix.style).toBe("bracketed");
  });

  it("should preserve defaults for unset values", () => {
    process.env.BASE_BRANCH = "develop";
    
    const config = getConfig();
    
    expect(config.baseBranch).toBe("develop");
    expect(config.commit.maxTitleLength).toBe(defaultConfig.commit.maxTitleLength);
    expect(config.commit.rules.imperativeMood).toBe(defaultConfig.commit.rules.imperativeMood);
  });

  describe("TICKET_PATTERN regex safety", () => {
    it("should accept a safe ticket pattern", () => {
      process.env.TICKET_PATTERN = "[A-Z]+-\\d+";
      const config = getConfig();
      expect(config.ticketPattern).toBe("[A-Z]+-\\d+");
    });

    it("should reject a ReDoS-vulnerable pattern (nested quantifiers)", () => {
      process.env.TICKET_PATTERN = "(a+)+";
      const config = getConfig();
      expect(config.ticketPattern).toBeUndefined();
    });

    it("should reject an overly long pattern", () => {
      process.env.TICKET_PATTERN = "A".repeat(201);
      const config = getConfig();
      expect(config.ticketPattern).toBeUndefined();
    });

    it("should reject an invalid regex pattern", () => {
      process.env.TICKET_PATTERN = "[invalid";
      const config = getConfig();
      expect(config.ticketPattern).toBeUndefined();
    });

    it("should still load other env vars when pattern is rejected", () => {
      process.env.TICKET_PATTERN = "(a+)+";
      process.env.BASE_BRANCH = "develop";
      const config = getConfig();
      expect(config.ticketPattern).toBeUndefined();
      expect(config.baseBranch).toBe("develop");
    });
  });
});
