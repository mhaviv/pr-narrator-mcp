# Repository-Wide Code Review Instructions

## Security (Highest Priority)

- Verify `validateRepoPath()` is called before any `simple-git` operation on user-supplied paths
- Check for path traversal vulnerabilities in any function accepting file or repo paths
- Verify all user-supplied regex patterns are validated via `validateRegexPattern()` before use
- Ensure no hardcoded secrets, API keys, or credentials anywhere in the codebase
- Check that diff and output sizes are bounded — look for `MAX_DIFF_SIZE` usage or equivalent limits
- Flag any use of `child_process`, `exec`, `execSync`, or `spawn` — this project uses `simple-git` exclusively
- Reject any code that writes to the git repository — all operations must be read-only
- Verify that null byte injection is prevented in path handling

## Git Operation Safety

- All git operations must go through `simple-git` with a validated path from `validateRepoPath()`
- Never execute arbitrary git commands via shell
- Always handle git operation failures gracefully with try/catch — return `null` or empty defaults
- Verify that new git operations do not modify the repository (no commits, checkouts, or resets)
- Ensure `createGit(validatedPath)` is used, not raw `simpleGit()` calls

## MCP Protocol Compliance

- Tool handlers must never throw exceptions — return `{ success: false, errors: [...] }`
- Tool definitions must have `name` (snake_case), `description`, and `inputSchema` (JSON Schema object)
- Input schemas use Zod with `.optional()` and `.describe()` for all parameters
- Config is always the second parameter to handlers, never imported directly in tool files
- Tool results are serialized as `{ type: "text", text: JSON.stringify(result, null, 2) }`
- New tools must be registered in `src/index.ts`: imports, `tools` array, and `CallToolRequestSchema` switch

## Error Handling

- Functions must not throw — return result objects with `errors: string[]` and `success: boolean`
- Use `error instanceof Error ? error.message : String(error)` for safe error extraction in catch blocks
- Git failures return `null` or empty defaults, never crash the server
- Zod parse errors are caught and reported as tool errors, not re-thrown
- The `index.ts` handler wraps all calls in try/catch as a safety net — tools should still handle their own errors

## Code Quality

- No `any` types — use `unknown` or specific types. Flag `as any` casts
- Prefer `const` over `let`; never use `var`
- Use `import type` for type-only imports
- No barrel/index re-export files — direct imports only
- All local imports must use `.js` extensions (ESM requirement)
- Functions should be focused and under 50 lines where practical
- Remove dead code and unused imports
- No `console.log` — only `console.error` and `console.warn` are allowed
- No default exports — named exports only

## Performance

- Avoid redundant git operations — do not call `git.status()` or `git.log()` multiple times for the same data
- Bound all string operations on diffs and file lists (check for `MAX_DIFF_SIZE` or equivalent)
- Use early returns to avoid unnecessary computation
- Prefer `Map` and `Set` over array linear searches for lookups
- Avoid creating unnecessary intermediate arrays or objects in hot paths

## Naming Conventions (Enforce Strictly)

- **Files**: kebab-case (`generate-commit-message.ts`)
- **Functions**: camelCase (`generateCommitMessage`)
- **Types/Interfaces**: PascalCase with `Input`/`Result` suffixes for tool types (`GenerateCommitMessageResult`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_DIFF_SIZE`, `DEFAULT_BRANCH_PREFIXES`)
- **MCP tool names**: snake_case (`generate_commit_message`)
- **Zod schemas**: camelCase with `Schema` suffix (`generateCommitMessageSchema`)
- **Unused parameters**: prefix with `_` (`_unusedParam`)

## Formatting

- Semicolons: required
- Quotes: double
- Indentation: 2 spaces
- Trailing commas: es5
- Print width: 100
- Arrow parens: always
- End of line: lf

## Test Review

- Verify `vi.mock()` calls appear before imports from the mocked module
- Verify `beforeEach(() => vi.clearAllMocks())` is present in every `describe` block with mocks
- Verify no real git operations occur in tests — all `git.ts` functions must be mocked
- Check that env var tests clean up in both `beforeEach` and `afterEach`
- Verify mock return values match the actual interface (no missing required fields)
