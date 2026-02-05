import { z } from "zod";
import type { Config } from "../config/schema.js";

export const getConfigSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository. Always pass the user's current project/workspace directory."),
});

export type GetConfigInput = z.infer<typeof getConfigSchema>;

export interface GetConfigResult {
  config: Config;
  source: "mcp-env" | "defaults";
}

/**
 * Get the current configuration
 */
export async function getConfig(
  _input: GetConfigInput,
  config: Config
): Promise<GetConfigResult> {
  // Check if any env vars were set
  const hasEnvConfig = !!(
    process.env.BASE_BRANCH ||
    process.env.TICKET_PATTERN ||
    process.env.TICKET_LINK ||
    process.env.PREFIX_STYLE ||
    process.env.DEFAULT_REPO_PATH
  );

  return {
    config,
    source: hasEnvConfig ? "mcp-env" : "defaults",
  };
}

export const getConfigTool = {
  name: "get_config",
  description: `Get the current pr-narrator configuration.
Returns settings from MCP env vars or defaults.

Set in MCP JSON:
- BASE_BRANCH: Base branch for PRs (e.g., "develop")
- TICKET_PATTERN: Ticket regex (e.g., "[A-Z]+-\\d+")
- TICKET_LINK: Ticket URL template
- PREFIX_STYLE: "capitalized" or "bracketed"
- DEFAULT_REPO_PATH: Fallback repo path for single-repo workflows`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
    },
  },
  handler: getConfig,
};
