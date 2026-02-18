# AGENTS.md — Coding Agent Instructions for pr-narrator-mcp

## Project Summary

**pr-narrator-mcp** is an MCP (Model Context Protocol) server that generates commit messages, PR titles, PR descriptions, and related content from git repository state. It is published to npm as `pr-narrator-mcp` and runs as a CLI tool via `npx pr-narrator-mcp`.

- **Runtime**: Node.js >=18, TypeScript 5.3+, ESM (`"type": "module"`)
- **Dependencies**: `@modelcontextprotocol/sdk` ^1.26.0, `simple-git` ^3.22.0, `zod` ^3.22.4
- **Build**: tsup (ESM output, single entry `src/index.ts`, target node18)
- **Test**: Vitest with globals, v8 coverage, Node environment
- **Lint**: ESLint with `@typescript-eslint/recommended-requiring-type-checking` + Prettier
- **CI**: GitHub Actions on Node 18/20/22 matrix

---

## Build & Test Commands

```bash
npm install            # Install dependencies
npm run typecheck      # tsc --noEmit (run FIRST — must pass before test/build)
npm run test:run       # vitest run (single pass)
npm test               # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage
npm run build          # tsup → dist/
npm run lint           # eslint src/ test/
npm run lint:fix       # eslint --fix
npm run format         # prettier --write
npm run format:check   # prettier --check
```

**Validation order**: `npm run typecheck` → `npm run test:run` → `npm run build` → `npm run lint`

CI runs this matrix on Node 18, 20, and 22. Always verify your changes pass on Node 18 (the minimum).

---

## Project Layout

```
src/
├── index.ts                        # MCP server entry, tool registration, stdio transport
├── config/
│   ├── schema.ts                   # Zod config schemas, defaults, type exports
│   └── loader.ts                   # Config loading from MCP env vars
├── tools/                          # One file per MCP tool (8 tools total)
│   ├── get-config.ts
│   ├── analyze-git-changes.ts
│   ├── generate-commit-message.ts
│   ├── validate-commit-message.ts
│   ├── extract-tickets.ts
│   ├── generate-pr-title.ts
│   ├── generate-pr-description.ts
│   └── generate-pr.ts
└── utils/
    ├── git.ts                      # Git operations via simple-git, path validation, branch detection
    └── formatters.ts               # String formatting, prefix handling, file categorization

test/                               # Mirrors src/ structure
├── config/
│   └── loader.test.ts
├── tools/
│   └── *.test.ts                   # One test file per tool
└── utils/
    ├── formatters.test.ts
    └── git.test.ts
```

---

## Architecture

### Tool Module Pattern

Every file in `src/tools/` exports exactly five things:

1. **Zod schema**: `export const toolNameSchema = z.object({...})`
2. **Input type**: `export type ToolNameInput = z.infer<typeof toolNameSchema>`
3. **Result interface**: `export interface ToolNameResult { success: boolean; errors: string[]; ... }`
4. **Async handler**: `export async function toolName(input: ToolNameInput, config: Config): Promise<ToolNameResult>`
5. **Tool definition**: `export const toolNameTool = { name: "tool_name", description: "...", inputSchema: {...}, handler: toolName }`

New tools MUST follow this pattern exactly. The handler in `src/index.ts` imports the schema, handler, and tool definition from each tool file.

### Config Pattern

- `src/config/schema.ts` defines all config via Zod schemas with `.default()` values
- `src/config/loader.ts` reads MCP env vars, merges with defaults, validates via `configSchema.safeParse()`
- Config is always passed as the **second argument** to tool handlers — never imported directly in tool files
- `defaultConfig` is exported from `schema.ts` as `configSchema.parse({})`

### Error Handling Pattern

- Tool handlers **never throw**. They return result objects with `errors: string[]` and `success: boolean`
- The MCP server handler in `index.ts` wraps each call in try/catch and returns `{ content: [...], isError: true }` on failure
- Git failures return `null` or empty defaults, never crash the server
- Zod parse errors are caught and reported as tool errors

### Registration in index.ts

- `index.ts` creates a `Server` from `@modelcontextprotocol/sdk`
- All tools are declared in a `tools` array with `name`, `description`, `inputSchema`, and `annotations`
- `ListToolsRequestSchema` handler returns the tools array
- `CallToolRequestSchema` handler switches on tool name, parses input with the tool's Zod schema, calls the handler, and JSON-stringifies the result

---

## Testing

- **Framework**: Vitest with globals (`describe`, `it`, `expect`, `vi` available without import)
- **Run tests**: `npm run test:run` for single pass, `npm test` for watch mode
- **Coverage**: `npm run test:coverage` — excludes `src/index.ts`
- **Structure**: Test files mirror `src/` layout under `test/`

### Writing Tests

- `vi.mock()` calls MUST appear before any imports from the mocked module
- Use `vi.mocked(fn)` for type-safe mock access
- Every `beforeEach` must call `vi.clearAllMocks()`
- Mock ALL `git.ts` functions used by the tool under test — never run real git operations
- Env var tests must clean up in both `beforeEach` and `afterEach`
- Import paths: `../../src/<module>.js` (with `.js` extension)

```typescript
// Correct mock setup
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  getStagedChanges: vi.fn(),
  // ... all functions used by the tool
}));

import { myTool } from "../../src/tools/my-tool.js";
import { getCurrentBranch } from "../../src/utils/git.js";
```

---

## Code Style

### Naming Conventions

| Element              | Convention         | Example                         |
|----------------------|--------------------|---------------------------------|
| Files                | kebab-case         | `generate-commit-message.ts`    |
| MCP tool names       | snake_case         | `generate_commit_message`       |
| Functions            | camelCase          | `generateCommitMessage`         |
| Types/Interfaces     | PascalCase         | `GenerateCommitMessageResult`   |
| Constants            | UPPER_SNAKE_CASE   | `MAX_DIFF_SIZE`                 |
| Zod schemas          | camelCase + Schema | `generateCommitMessageSchema`   |

### Formatting (Prettier)

- Semicolons: yes
- Quotes: double
- Tab width: 2
- Trailing commas: es5
- Print width: 100
- Arrow parens: always
- End of line: lf

### ESLint

- `@typescript-eslint/no-explicit-any`: warn — use `unknown` or specific types
- `@typescript-eslint/no-unused-vars`: warn — prefix unused args with `_`
- `no-console`: warn — only `console.error` and `console.warn` allowed
- `prefer-const`: error
- `no-var`: error

### ESM Imports

All local imports MUST use `.js` extensions:

```typescript
import { getConfig } from "./config/loader.js";
import { validateRepoPath } from "../utils/git.js";
```

Forgetting `.js` extensions causes runtime ESM resolution errors.

---

## CI/CD

### CI (`.github/workflows/ci.yml`)

- Triggers on push/PR to `main` and `develop`
- Matrix: Node 18, 20, 22
- Steps: `npm ci` → `typecheck` → `test:run` → `build`
- Separate lint job on Node 20

### Publish (`.github/workflows/publish.yml`)

- Triggers on GitHub release publish
- Steps: `npm ci` → `typecheck` → `test:run` → `build` → `npm publish --provenance`
- Uses `NPM_TOKEN` secret

---

## Security Model

This tool is **read-only** and **local-only**:

- **Path validation**: All repo paths go through `validateRepoPath()` which rejects null bytes and normalizes paths. Called before any `simple-git` operation.
- **ReDoS protection**: User-supplied regex patterns (e.g., `TICKET_PATTERN`) are validated via `validateRegexPattern()` before use.
- **Diff size limits**: Diffs are truncated at `MAX_DIFF_SIZE` (500,000 chars) to prevent memory issues.
- **No shell exec**: All git operations use `simple-git` — never `child_process` or `exec`.
- **No secrets**: Never store, log, or transmit API keys, tokens, or credentials.
- **Read-only git**: Tools only read from git repositories — they never modify commits, branches, or working trees.

---

## MCP Protocol Compliance

- Tool definitions must include `name` (snake_case), `description`, and `inputSchema` (plain JSON Schema object, not Zod directly)
- All tools declare `readOnlyAnnotations` in `index.ts`
- Handlers receive parsed input (via Zod `.parse()`) and config
- Handlers must not throw — return structured error results
- Results are serialized as `{ type: "text", text: JSON.stringify(result, null, 2) }`

---

## Common Pitfalls

1. **Missing `.js` extensions in imports** — Causes runtime ESM errors. Always use `.js` even for `.ts` source files.
2. **Using `any` instead of proper types** — Triggers lint warnings. Use `unknown` and narrow with type guards.
3. **Not mocking `git.ts` in tool tests** — Causes real git operations against the developer's repo.
4. **Importing config directly in tools** — Config must be passed as a parameter. Tools should never call `getConfig()`.
5. **Overwriting nested env config** — New env vars in `loader.ts` must guard nested objects:
   ```typescript
   if (!envConfig.commit) envConfig.commit = {};
   (envConfig.commit as Record<string, unknown>).includeStats = value;
   ```
6. **Forgetting to register new tools in `index.ts`** — Add to imports, `tools` array, and the `CallToolRequestSchema` switch.
7. **Throwing in tool handlers** — Always return `{ success: false, errors: [...] }` instead.
8. **Skipping `beforeEach(() => vi.clearAllMocks())`** — Causes test pollution from previous test's mock state.
