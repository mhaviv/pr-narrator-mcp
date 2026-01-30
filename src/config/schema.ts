import { z } from "zod";

/**
 * Prefix configuration for commits and PR titles
 * - Uses ticket if found (e.g., PROJ-123)
 * - Falls back to branch prefix capitalized (task/ -> Task, bug/ -> Bug)
 * - No prefix on main/master/develop branches
 */
const prefixSchema = z
  .object({
    enabled: z.boolean().default(true),
    // Format style for prefix: "capitalized" = "PROJ-123:" or "Task:", "bracketed" = "[PROJ-123]" or "[Task]"
    style: z.enum(["capitalized", "bracketed"]).default("capitalized"),
    branchFallback: z.boolean().default(true),
  })
  .default({});

/**
 * Commit message configuration
 */
const commitSchema = z
  .object({
    // Format: "simple" = prefix + message, "conventional" = prefix + type(scope): message
    format: z
      .enum(["conventional", "gitmoji", "angular", "simple"])
      .default("simple"),
    // Type format for conventional commits (only used when format != "simple")
    // - "capitalized": "Fix: message"
    // - "bracketed": "[Fix] message"
    typeFormat: z
      .enum(["capitalized", "bracketed"])
      .default("capitalized"),
    // Whether to include scope in conventional commits (e.g., "Fix(auth): message")
    includeScope: z.boolean().default(false),
    maxTitleLength: z.number().min(20).max(200).default(72),
    maxBodyLineLength: z.number().min(50).max(200).default(100),
    requireScope: z.boolean().default(false),
    requireBody: z.boolean().default(false),
    scopes: z.array(z.string()).optional(),
    prefix: prefixSchema,
    rules: z
      .object({
        imperativeMood: z.boolean().default(true),
        capitalizeTitle: z.boolean().default(true),
        noTrailingPeriod: z.boolean().default(true),
      })
      .default({}),
  })
  .default({});

/**
 * PR title configuration
 */
const prTitleSchema = z
  .object({
    prefix: z
      .object({
        enabled: z.boolean().default(true),
        // Format style for PR title prefix: same as commit prefix
        style: z.enum(["capitalized", "bracketed"]).default("capitalized"),
        branchFallback: z.boolean().default(true),
      })
      .default({}),
    maxLength: z.number().min(20).max(200).default(100),
  })
  .default({});

/**
 * PR section configuration
 */
const prSectionSchema = z.object({
  name: z.string(),
  required: z.boolean().default(false),
  autoPopulate: z.enum(["commits", "extracted", "none"]).optional(),
});

/**
 * PR configuration
 */
const prSchema = z
  .object({
    title: prTitleSchema,
    sections: z
      .array(prSectionSchema)
      .default([
        { name: "Summary", required: true },
        { name: "Changes", required: true, autoPopulate: "commits" },
        { name: "Tickets", required: false, autoPopulate: "extracted" },
        { name: "Test Plan", required: false },
      ]),
  })
  .default({});

/**
 * VCS integration configuration (GitHub, GitLab, etc.)
 */
const vcsIntegrationSchema = z.object({
  provider: z.enum(["github", "gitlab", "bitbucket", "azure-devops"]),
  mcpServer: z.string(),
  defaultOwner: z.string().optional(),
  defaultRepo: z.string().optional(),
});

/**
 * Ticketing integration configuration (Jira, Linear, etc.)
 */
const ticketingIntegrationSchema = z.object({
  provider: z.enum(["jira", "linear", "github-issues", "azure-devops"]),
  mcpServer: z.string(),
  fetchTicketDetails: z.boolean().default(true),
  includeInPr: z
    .object({
      ticketTitle: z.boolean().default(true),
      description: z.boolean().default(false),
      acceptanceCriteria: z.boolean().default(false),
    })
    .default({}),
});

/**
 * Integrations configuration (all optional)
 */
const integrationsSchema = z
  .object({
    vcs: vcsIntegrationSchema.optional(),
    ticketing: ticketingIntegrationSchema.optional(),
  })
  .optional();

/**
 * Main configuration schema
 */
export const configSchema = z.object({
  commit: commitSchema,
  pr: prSchema,
  ticketPattern: z.string().optional(),
  ticketLinkFormat: z.string().optional(),
  baseBranch: z.string().default("main"),
  integrations: integrationsSchema,
});

/**
 * Type definitions derived from schema
 */
export type Config = z.infer<typeof configSchema>;
export type CommitConfig = z.infer<typeof commitSchema>;
export type PrConfig = z.infer<typeof prSchema>;
export type PrefixConfig = z.infer<typeof prefixSchema>;
export type PrSection = z.infer<typeof prSectionSchema>;
export type VcsIntegration = z.infer<typeof vcsIntegrationSchema>;
export type TicketingIntegration = z.infer<typeof ticketingIntegrationSchema>;

/**
 * Default configuration (used when no config file is found)
 */
export const defaultConfig: Config = configSchema.parse({});
