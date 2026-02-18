---
applyTo: "src/config/**/*.ts,src/tools/**/*.ts"
---

# Zod Schema Review Rules

## Field Descriptors

- Every schema field must have `.describe()` with a clear, user-facing description
- Descriptions should explain purpose, not just repeat the field name

```typescript
// Avoid: no description or useless description
z.string().optional()
z.string().optional().describe("repoPath")

// Prefer: meaningful description
z.string().optional().describe("Path to the git repository. Uses cwd if not provided.")
```

## Defaults and Optionality

- Use `.default()` for all fields that have sensible defaults
- Use `.optional()` for truly optional fields where no default makes sense
- Every field in `configSchema` that affects behavior must have a default

```typescript
// Config field with a sensible default
includeStats: z.boolean().default(true).describe("Whether to include file/line stats in summaries"),

// Truly optional — no sensible default
ticketPattern: z.string().optional().describe("Regex pattern to extract ticket numbers from branch names"),
```

## Schema Structure

- Nested schemas must be extracted as named constants for reuse and readability
- Use descriptive names with `Schema` suffix for standalone schemas

```typescript
// Prefer: extracted named schemas
const prefixSchema = z.object({
  enabled: z.boolean().default(true).describe("Whether to add prefix to messages"),
  style: z.enum(["capitalized", "bracketed"]).default("capitalized").describe("Prefix format style"),
  branchFallback: z.boolean().default(true).describe("Use branch prefix when no ticket found"),
}).default({});

const commitSchema = z.object({
  prefix: prefixSchema,
  maxTitleLength: z.number().default(100).describe("Maximum commit title length"),
  // ...
}).default({});

// Avoid: deeply nested inline schemas
const configSchema = z.object({
  commit: z.object({
    prefix: z.object({
      enabled: z.boolean().default(true),
      // ...
    }).default({}),
  }).default({}),
});
```

## Type Derivation

- Derive TypeScript types from Zod schemas using `z.infer<typeof schema>`
- Never manually duplicate a Zod schema as a TypeScript interface

```typescript
export const mySchema = z.object({
  repoPath: z.string().optional().describe("Path to repo"),
});
export type MyInput = z.infer<typeof mySchema>;
```

## Enum and Array Patterns

- Use `z.enum()` for string unions, not `z.string()` with manual validation
- Use `z.array(z.string())` not `z.string().array()`

```typescript
// Prefer
style: z.enum(["capitalized", "bracketed"]).default("capitalized"),
scopes: z.array(z.string()).optional(),

// Avoid
style: z.string().default("capitalized"),  // no validation of allowed values
scopes: z.string().array().optional(),      // less readable
```

## Config Loader (loader.ts) Patterns

### Env Var Guard Pattern

New env vars in `loader.ts` must not overwrite previously set nested properties. Always guard with existence checks:

```typescript
// Correct: guard before setting nested properties
if (process.env.INCLUDE_STATS !== undefined) {
  const val = process.env.INCLUDE_STATS.toLowerCase();
  if (!envConfig.commit) envConfig.commit = {};
  (envConfig.commit as Record<string, unknown>).includeStats = val !== "false" && val !== "0";
}

if (process.env.PREFIX_STYLE) {
  const style = process.env.PREFIX_STYLE;
  if (style === "capitalized" || style === "bracketed") {
    if (!envConfig.commit) envConfig.commit = {};
    (envConfig.commit as Record<string, unknown>).prefix = { style };
  }
}

// Wrong: overwrites commit.includeStats if set earlier
if (process.env.PREFIX_STYLE) {
  envConfig.commit = { prefix: { style: process.env.PREFIX_STYLE } };
}
```

### Regex Validation

- User-supplied regex patterns (e.g., `TICKET_PATTERN`) must be validated with `validateRegexPattern()` before use
- Invalid patterns fall back to defaults, never crash

```typescript
if (process.env.TICKET_PATTERN) {
  const { safe, error } = validateRegexPattern(process.env.TICKET_PATTERN);
  if (safe) {
    envConfig.ticketPattern = process.env.TICKET_PATTERN;
  } else {
    console.warn(`Invalid TICKET_PATTERN: ${error}`);
  }
}
```

## Parse Methods

- Use `.safeParse()` in the config loader — gracefully falls back to defaults on failure
- Use `.parse()` in tool handlers (inside `index.ts`) — schema validation errors are caught by the outer try/catch

```typescript
// Config loader — graceful fallback
const parsed = configSchema.safeParse(merged);
if (!parsed.success) {
  console.warn("Config validation failed, using defaults");
  return defaultConfig;
}
return parsed.data;

// Tool handler in index.ts — let errors propagate to catch block
const input = generateCommitMessageSchema.parse(args || {});
const result = await generateCommitMessage(input, config);
```

## Tool Input Schemas

- Tool `inputSchema` in the tool definition is a plain JSON Schema object for MCP, not the Zod schema directly
- The Zod schema is used for runtime validation in `index.ts`
- Both must stay in sync — changes to one must be reflected in the other

```typescript
export const myToolSchema = z.object({
  repoPath: z.string().optional().describe("Path to the git repository"),
});

export const myToolTool = {
  name: "my_tool",
  description: "Does something useful",
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository",
      },
    },
  },
};
```

## Defaults Testing

- `configSchema.parse({})` must produce a valid `defaultConfig` — verify this in tests
- New schema fields with `.default()` must be tested to ensure the default value is correct
- Env var parsing tests must verify that setting one env var does not corrupt other config values
