---
applyTo: "test/**/*.test.ts"
---

# Test File Review Rules

## Mock Setup (Critical Ordering)

- `vi.mock()` calls MUST appear before any imports from the mocked module
- This is a Vitest hoisting requirement — violations cause tests to use real implementations

```typescript
// Correct: vi.mock BEFORE imports
vi.mock("../../src/utils/git.js", () => ({
  getCurrentBranch: vi.fn(),
  getStagedChanges: vi.fn(),
  getGitInfo: vi.fn(),
  getBranchChanges: vi.fn(),
  getWorkingTreeStatus: vi.fn(),
  extractTicketFromBranch: vi.fn(),
  extractBranchPrefix: vi.fn(),
  extractTicketsFromCommits: vi.fn(),
}));

// THEN import the module under test and mocked modules
import { analyzeGitChanges } from "../../src/tools/analyze-git-changes.js";
import {
  getCurrentBranch,
  getStagedChanges,
  getWorkingTreeStatus,
} from "../../src/utils/git.js";

// Wrong: import before mock — mock is ignored
import { getCurrentBranch } from "../../src/utils/git.js";
vi.mock("../../src/utils/git.js", () => ({ ... }));  // Too late!
```

## Mock Completeness

- Each tool test file must mock ALL `git.ts` functions used by that tool
- Missing mocks cause real git operations against the developer's repo
- Use `vi.mocked(fn)` for type-safe mock access — never use `as jest.Mock` or similar casts

```typescript
// Correct
vi.mocked(getCurrentBranch).mockResolvedValue("feature/PROJ-123-add-login");

// Avoid
(getCurrentBranch as any).mockResolvedValue("feature/PROJ-123-add-login");
```

## Mock Return Values

- Mock return values must match the actual interface exactly
- Do not skip required fields — this hides integration bugs
- For complex interfaces, define reusable fixtures

```typescript
// Good: all required fields present
vi.mocked(getWorkingTreeStatus).mockResolvedValue({
  modified: [],
  untracked: [],
  deleted: [],
  modifiedCount: 0,
  untrackedCount: 0,
  deletedCount: 0,
  totalUncommitted: 0,
});

// Bad: missing required fields
vi.mocked(getWorkingTreeStatus).mockResolvedValue({
  modified: [],
});
```

## Test Lifecycle

- Every `describe` block with mocks must include `beforeEach(() => vi.clearAllMocks())`
- Env var tests must clean up in both `beforeEach` AND `afterEach` to prevent leaks

```typescript
describe("getConfig", () => {
  const envKeys = [
    "BASE_BRANCH", "TICKET_PATTERN", "TICKET_LINK",
    "PREFIX_STYLE", "DEFAULT_REPO_PATH", "INCLUDE_STATS", "BRANCH_PREFIXES",
  ];

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });
});
```

## Test Naming

- Use `it("should <expected behavior> when <condition>")` format
- Use nested `describe` blocks to group related scenarios

```typescript
describe("analyzeGitChanges", () => {
  describe("when not a git repo", () => {
    it("should return isRepo false", async () => { ... });
    it("should include error message", async () => { ... });
  });

  describe("when staged changes exist", () => {
    it("should return file list with stats", async () => { ... });
    it("should suggest commit type from file paths", async () => { ... });
  });
});
```

## Assertions

- Use `toEqual` for deep object/array comparisons
- Use `toBe` for primitives and reference equality
- Use `toContain` for checking array membership or substring presence
- Use `not.toBeNull()` over `toBeDefined()` when checking for null specifically

```typescript
expect(result.errors).toEqual([]);              // array comparison
expect(result.success).toBe(true);              // primitive
expect(result.title).toContain("Task:");        // substring
expect(result.coverageWarnings).not.toBeNull(); // null check
```

## Import Paths

- Import paths from test files use `../../src/<module>.js` format
- Always include the `.js` extension — ESM resolution requires it

```typescript
import { generateCommitMessage } from "../../src/tools/generate-commit-message.js";
import { summarizeFileChanges } from "../../src/utils/formatters.js";
```

## Edge Cases to Test

- Empty inputs (no staged changes, empty strings)
- Null/undefined branch names
- Missing or default config values
- Git operation failures (mock returning `null`)
- Single file vs multiple files
- Boundary conditions (max title length, large file counts)
- Env vars with edge values (`"false"`, `"0"`, empty string)

## What Not to Test

- Do not write unit tests for `src/index.ts` — coverage configuration excludes it
- Do not test third-party library internals (simple-git, zod)
- Do not perform real filesystem or git operations
