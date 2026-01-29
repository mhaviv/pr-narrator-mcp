import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { configSchema, defaultConfig, type Config } from "./schema.js";

const CONFIG_FILE_NAMES = [
  "pr-narrator.config.json",
  ".pr-narrator.json",
  ".prnarratorrc.json",
];

/**
 * Find the config file in the given directory or its parents
 */
async function findConfigFile(startDir: string): Promise<string | null> {
  // Resolve to absolute path to handle relative paths like "." or "./project"
  let currentDir = resolve(startDir);
  let previousDir = "";

  // Cross-platform root detection: when dirname(dir) === dir, we've hit root
  // This works on both Unix (/) and Windows (C:\)
  while (currentDir !== previousDir) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = join(currentDir, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
    previousDir = currentDir;
    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Load and parse the configuration from a file
 */
export async function loadConfig(repoPath: string): Promise<{
  config: Config;
  configPath: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let configPath: string | null = null;

  try {
    configPath = await findConfigFile(repoPath);

    if (!configPath) {
      return {
        config: defaultConfig,
        configPath: null,
        errors: [],
      };
    }

    const fileContents = await readFile(configPath, "utf-8");
    const rawConfig = JSON.parse(fileContents);
    const result = configSchema.safeParse(rawConfig);

    if (!result.success) {
      const zodErrors = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      errors.push(...zodErrors);

      return {
        config: defaultConfig,
        configPath,
        errors,
      };
    }

    return {
      config: result.data,
      configPath,
      errors: [],
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      errors.push(`Invalid JSON in config file: ${error.message}`);
    } else if (error instanceof Error) {
      errors.push(`Error loading config: ${error.message}`);
    }

    return {
      config: defaultConfig,
      configPath,
      errors,
    };
  }
}

/**
 * Validate a configuration object
 */
export function validateConfig(config: unknown): {
  valid: boolean;
  config: Config | null;
  errors: string[];
} {
  const result = configSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    return {
      valid: false,
      config: null,
      errors,
    };
  }

  return {
    valid: true,
    config: result.data,
    errors: [],
  };
}
