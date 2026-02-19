import { configSchema, defaultConfig, type Config } from "./schema.js";
import { validateRegexPattern } from "../utils/git.js";

/**
 * Get config from MCP env vars
 * Simple env vars set in MCP JSON - no config files needed
 */
export function getConfig(): Config {
  const envConfig: Record<string, unknown> = {};

  if (process.env.BASE_BRANCH) {
    envConfig.baseBranch = process.env.BASE_BRANCH;
  }

  if (process.env.TICKET_PATTERN) {
    const validation = validateRegexPattern(process.env.TICKET_PATTERN);
    if (validation.safe) {
      envConfig.ticketPattern = process.env.TICKET_PATTERN;
    } else {
      console.error(`[pr-narrator] Warning: TICKET_PATTERN is invalid and will be ignored: ${validation.error}`);
    }
  }

  if (process.env.TICKET_LINK) {
    envConfig.ticketLinkFormat = process.env.TICKET_LINK;
  }

  if (process.env.DEFAULT_REPO_PATH) {
    envConfig.defaultRepoPath = process.env.DEFAULT_REPO_PATH;
  }

  if (process.env.INCLUDE_STATS !== undefined) {
    const val = process.env.INCLUDE_STATS.toLowerCase();
    if (!envConfig.commit) envConfig.commit = {};
    (envConfig.commit as Record<string, unknown>).includeStats = val !== "false" && val !== "0";
  }

  if (process.env.BRANCH_PREFIXES) {
    envConfig.branchPrefixes = process.env.BRANCH_PREFIXES
      .split(",")
      .map(p => p.trim())
      .filter(Boolean);
  }

  if (process.env.PREFIX_STYLE) {
    const style = process.env.PREFIX_STYLE;
    if (style === "capitalized" || style === "bracketed") {
      if (!envConfig.commit) envConfig.commit = {};
      (envConfig.commit as Record<string, unknown>).prefix = { style };
    }
  }

  if (process.env.PR_TEMPLATE_PRESET) {
    const preset = process.env.PR_TEMPLATE_PRESET;
    const validPresets = [
      "default", "minimal", "detailed",
      "mobile", "frontend", "backend",
      "devops", "security", "ml",
    ];
    if (validPresets.includes(preset)) {
      if (!envConfig.pr) envConfig.pr = {};
      if (!(envConfig.pr as Record<string, unknown>).template) {
        (envConfig.pr as Record<string, unknown>).template = {};
      }
      ((envConfig.pr as Record<string, unknown>).template as Record<string, unknown>).preset = preset;
    }
  }

  if (process.env.PR_DETECT_REPO_TEMPLATE !== undefined) {
    const val = process.env.PR_DETECT_REPO_TEMPLATE.toLowerCase();
    if (!envConfig.pr) envConfig.pr = {};
    if (!(envConfig.pr as Record<string, unknown>).template) {
      (envConfig.pr as Record<string, unknown>).template = {};
    }
    ((envConfig.pr as Record<string, unknown>).template as Record<string, unknown>).detectRepoTemplate =
      val !== "false" && val !== "0";
  }

  if (Object.keys(envConfig).length === 0) {
    return defaultConfig;
  }

  // Merge env config with defaults, preserving pr config from env vars
  const envPr = envConfig.pr as Record<string, unknown> | undefined;
  const envPrTemplate = envPr?.template as Record<string, unknown> | undefined;

  const merged = {
    ...defaultConfig,
    ...envConfig,
    commit: {
      ...defaultConfig.commit,
      ...(envConfig.commit as Record<string, unknown> || {}),
      prefix: {
        ...defaultConfig.commit.prefix,
        ...((envConfig.commit as Record<string, unknown>)?.prefix as Record<string, unknown> || {}),
      },
      rules: defaultConfig.commit.rules,
    },
    pr: {
      ...defaultConfig.pr,
      ...(envPr || {}),
      template: {
        ...defaultConfig.pr.template,
        ...(envPrTemplate || {}),
      },
    },
  };

  const result = configSchema.safeParse(merged);
  return result.success ? result.data : defaultConfig;
}
