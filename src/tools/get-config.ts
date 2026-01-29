import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import type { Config } from "../config/schema.js";

export const getConfigSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository (defaults to current directory)"),
});

export type GetConfigInput = z.infer<typeof getConfigSchema>;

export interface GetConfigResult {
  config: Config;
  configPath: string | null;
  hasCustomConfig: boolean;
  errors: string[];
  integrations: {
    vcs: {
      configured: boolean;
      provider: string | null;
      mcpServer: string | null;
    };
    ticketing: {
      configured: boolean;
      provider: string | null;
      mcpServer: string | null;
    };
  };
}

/**
 * Get the current configuration
 * This tool allows the AI to understand the user's commit/PR preferences
 */
export async function getConfig(input: GetConfigInput): Promise<GetConfigResult> {
  const repoPath = input.repoPath || process.cwd();

  const { config, configPath, errors } = await loadConfig(repoPath);

  return {
    config,
    configPath,
    hasCustomConfig: configPath !== null,
    errors,
    integrations: {
      vcs: {
        configured: !!config.integrations?.vcs,
        provider: config.integrations?.vcs?.provider ?? null,
        mcpServer: config.integrations?.vcs?.mcpServer ?? null,
      },
      ticketing: {
        configured: !!config.integrations?.ticketing,
        provider: config.integrations?.ticketing?.provider ?? null,
        mcpServer: config.integrations?.ticketing?.mcpServer ?? null,
      },
    },
  };
}

export const getConfigTool = {
  name: "get_config",
  description: `Get the current pr-narrator configuration for the repository.
Returns the configuration settings that define how commit messages and PR content should be formatted.
Use this to understand the user's preferences before generating commits or PRs.

Returns:
- config: The full configuration object
- configPath: Path to the config file (null if using defaults)
- hasCustomConfig: Whether a custom config file was found
- errors: Any configuration errors
- integrations: Summary of configured integrations (VCS and ticketing)`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository (defaults to current directory)",
      },
    },
  },
  handler: getConfig,
};
