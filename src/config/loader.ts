import { configSchema, defaultConfig, type Config } from "./schema.js";

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
    envConfig.ticketPattern = process.env.TICKET_PATTERN;
  }

  if (process.env.TICKET_LINK) {
    envConfig.ticketLinkFormat = process.env.TICKET_LINK;
  }

  if (process.env.PREFIX_STYLE) {
    const style = process.env.PREFIX_STYLE;
    if (style === "capitalized" || style === "bracketed") {
      envConfig.commit = { prefix: { style } };
    }
  }

  if (Object.keys(envConfig).length === 0) {
    return defaultConfig;
  }

  // Merge env config with defaults
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
    pr: defaultConfig.pr,
  };

  const result = configSchema.safeParse(merged);
  return result.success ? result.data : defaultConfig;
}
