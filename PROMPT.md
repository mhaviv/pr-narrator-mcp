# Master Implementation Prompt: `assess_pr_risk` — PR Risk & Complexity Analysis

> Give this entire prompt to a coding agent. It contains all context, architecture decisions, file-level implementation specs, scoring models, and validation criteria needed to implement the feature end-to-end.

---

## Context

**pr-narrator-mcp** is an MCP server (Node.js, TypeScript, ESM) that generates commit messages, PR titles, PR descriptions, changelogs, and related content from git repo state. It currently has 10 tools. You are adding a **PR risk and complexity analysis tool** that gives reviewers deterministic, heuristic-based signal about where to focus — no LLM required.

Read `AGENTS.md` in the repo root first. It contains project conventions, file patterns, naming rules, test patterns, and common pitfalls. Follow it exactly.

### Research Backing

This tool is grounded in 2025–2026 code review research:

- **DRS-OSS** (arXiv 2511.21964): Shows that gating only the riskiest 30% of commits can prevent up to 86.4% of defect-inducing changes. Our tool provides the "risk signal" half of this equation — pure heuristics, deterministic, runs in milliseconds.
- **Change Impact Analysis** (Springer s10664-024-10600-2): Combining file metrics with structural analysis scored 3.66/5.0 for enhancing code review experience in user validation. Our approach mirrors this with file-pattern-based signal detection.
- **PR Size Studies** (Graphite, Propel, CodePulseHQ 2025): PRs under 200 lines get 87% defect detection; 1000+ line PRs drop to 28%. These thresholds directly inform our size categories and risk weights.

---

## What You Are Building

A single new MCP tool `assess_pr_risk` that analyzes the current branch's changes against the base branch and produces:

1. **Overall risk level** (`low` / `medium` / `high` / `critical`) with a 0–100 numeric score
2. **PR size categorization** (`XS` / `S` / `M` / `L` / `XL`) with research-backed thresholds
3. **Individual risk signals** — each with severity, description, weight, and triggering files
4. **File hotspots** — files ranked by review priority with reasons
5. **Test coverage assessment** — ratio of test files to code files in the changeset
6. **Breaking change indicators** — detected from file patterns and commit messages
7. **Suggested review order** — files sequenced by review priority (highest-impact first)
8. **Human-readable summary** — a narrative suitable for pasting into a PR description or Slack message

The tool is **fully deterministic** — same inputs always produce same outputs. No LLM calls, no external APIs. Fits the project's read-only security model.

### Optional Enhancement: File Churn History

When the `includeHistory` input flag is `true`, the tool additionally queries git log for each changed file to detect recently volatile files (high churn). This adds ~100ms latency per file but produces richer risk signals. Default is `false`.

---

## Implementation Tasks (in order)

### Task 1: Add Shared Helpers to `src/utils/formatters.ts`

Add one reusable helper that will be used by `assess_pr_risk` and future tools (`validate_pr`, `generate_review_guide`).

#### `categorizePrSize(files, additions, deletions): PrSizeCategory`

```typescript
export interface PrSizeCategory {
  category: "XS" | "S" | "M" | "L" | "XL";
  files: number;
  additions: number;
  deletions: number;
  totalLines: number;
}

export function categorizePrSize(
  fileCount: number,
  additions: number,
  deletions: number
): PrSizeCategory {
  const totalLines = additions + deletions;
  let category: PrSizeCategory["category"];

  if (totalLines <= 10 && fileCount <= 3) {
    category = "XS";
  } else if (totalLines <= 100 && fileCount <= 8) {
    category = "S";
  } else if (totalLines <= 400 && fileCount <= 15) {
    category = "M";
  } else if (totalLines <= 1000 && fileCount <= 30) {
    category = "L";
  } else {
    category = "XL";
  }

  return { category, files: fileCount, additions, deletions, totalLines };
}
```

These thresholds are research-backed:
- **XS** (1–10 lines, ≤3 files): Trivial changes — typos, single-line config fixes
- **S** (11–100 lines, ≤8 files): Sweet spot for bug fixes (87% defect detection rate)
- **M** (101–400 lines, ≤15 files): Optimal for features (75%+ detection rate)
- **L** (401–1000 lines, ≤30 files): Risk zone — defect detection drops to 65%
- **XL** (1000+ lines or 30+ files): Critical — only 28% defect detection in studies

**Note**: The category is determined by whichever dimension (lines or files) would place the PR in the larger category. For example, 50 lines across 20 files = `M` (because 20 files exceeds the S threshold of 8).

Update the logic to use the maximum of the two dimensions:

```typescript
// Determine by the more alarming dimension
const lineCategory = totalLines <= 10 ? "XS" : totalLines <= 100 ? "S" : totalLines <= 400 ? "M" : totalLines <= 1000 ? "L" : "XL";
const fileCategory = fileCount <= 3 ? "XS" : fileCount <= 8 ? "S" : fileCount <= 15 ? "M" : fileCount <= 30 ? "L" : "XL";
const sizeOrder = ["XS", "S", "M", "L", "XL"];
category = sizeOrder[Math.max(sizeOrder.indexOf(lineCategory), sizeOrder.indexOf(fileCategory))] as PrSizeCategory["category"];
```

---

### Task 2: Create `src/utils/risk.ts`

This is the core risk engine. Create this new file with the following exports. This mirrors the `src/utils/template.ts` pattern — a domain-specific utility module.

#### Interfaces

```typescript
export interface RiskSignal {
  id: string;
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  weight: number;
  files: string[];
}

export interface FileRisk {
  path: string;
  riskScore: number;
  reasons: string[];
  reviewPriority: number;
  category: "migration" | "api" | "security" | "core" | "test" | "config" | "docs" | "generated" | "other";
}

export interface TestCoverageInfo {
  hasTests: boolean;
  testFileCount: number;
  codeFileCount: number;
  ratio: number;
  warning: string | null;
}

export interface FileChurnInfo {
  path: string;
  recentCommitCount: number;
  isHotspot: boolean;
}
```

#### `detectRiskSignals(files, commits, options): RiskSignal[]`

This is the main signal detection function. It scans the changeset and returns all detected risk signals.

```typescript
export interface RiskDetectionOptions {
  fileChanges: Array<{ path: string; additions: number; deletions: number; binary: boolean }>;
  commits: Array<{ hash: string; message: string }>;
  totalAdditions: number;
  totalDeletions: number;
  churnData?: FileChurnInfo[];
}

export function detectRiskSignals(options: RiskDetectionOptions): RiskSignal[]
```

**Signal Definitions** — detect each signal independently, return all that match:

| # | ID | Name | Severity | Base Weight | Detection Logic |
|---|---|---|---|---|---|
| 1 | `large_pr` | Large PR | high | 15 | `totalLines > 500`. Scale: +5 for >1000, +5 more for >2000 (max 25) |
| 2 | `many_files` | Many Files Changed | medium | 10 | `fileCount > 15`. Scale: +5 for >30 (max 15) |
| 3 | `database_migrations` | Database Migrations | high | 20 | File path matches `migrations?/`, `schema`, `*.sql`, `alembic`, `prisma`, `knex`, `typeorm`, `sequelize` |
| 4 | `cicd_changes` | CI/CD Configuration Changes | medium | 10 | File path matches `.github/`, `Dockerfile`, `Jenkinsfile`, `docker-compose`, `.gitlab-ci`, `Makefile`, `*.tf` |
| 5 | `public_api_changes` | Public API Surface Changes | high | 15 | File path matches `api/`, `routes?/`, `controllers?/`, `handlers?/`, `endpoints?/`, `resolvers?/`, `swagger`, `openapi`, `*.graphql` |
| 6 | `no_tests` | No Test Changes | high | 20 | Code files changed but zero test/spec files in changeset. Only fire when ≥1 non-test, non-config source file changed |
| 7 | `dependency_changes` | Dependency Changes | medium | 10 | Lock files or manifest files changed: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile`, `Gemfile.lock`, `requirements.txt`, `poetry.lock`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `pom.xml`, `build.gradle` |
| 8 | `security_sensitive` | Security-Sensitive Files | high | 20 | File path matches `auth`, `crypto`, `security`, `token`, `session`, `password`, `permission`, `rbac`, `oauth`, `saml`, `cert`, `ssl`, `tls`, `secret`, `.env`, `credentials` (case-insensitive). Exclude test files from triggering this. |
| 9 | `config_env_changes` | Config/Environment Changes | medium | 8 | File path matches `*.env*`, `config/`, `*.yml`, `*.yaml`, `*.toml`, `*.ini` (but NOT in test dirs, NOT lock files, NOT CI files already caught by #4) |
| 10 | `cross_cutting` | Cross-Cutting Changes | medium | 10 | Changed files span >3 **top-level directories** (first path segment). Measures breadth of impact. |
| 11 | `binary_files` | Binary Files | low | 5 | Any file with `binary: true` in the change set |
| 12 | `generated_vendored` | Generated/Vendored Files | low | 3 | File path matches `vendor/`, `generated/`, `*.min.js`, `*.min.css`, `dist/`, `build/` |
| 13 | `breaking_change_commits` | Breaking Change Indicators in Commits | high | 15 | Commit messages contain `BREAKING CHANGE`, `BREAKING:`, or conventional `!:` marker. Collect all matching commit messages. |
| 14 | `high_churn_files` | High-Churn Files (optional) | medium | 12 | Only when `churnData` is provided. Files with ≥5 commits in the last 30 days that are also in the current changeset. |

**Implementation notes:**

- Each signal's `files` array should contain the file paths that triggered it (for `large_pr` and `many_files`, include all files; for pattern-based signals, include only matching files).
- Use case-insensitive regex matching for file patterns.
- For signal #6 (`no_tests`), classify files as "test" using the pattern `/test|spec|__tests__|\.test\.|\.spec\./i`. Classify files as "code" using `/\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|cpp|cs|m|mm|php)$/i`. The signal fires when `codeFileCount > 0 && testFileCount === 0`.
- For signal #8, exclude files that also match the test pattern to avoid flagging `test/auth.test.ts`.
- For signal #9, exclude files already caught by signal #4 (CI/CD) to avoid double-counting.
- Wrap all regex in try/catch and fail-open.

#### `computeRiskScore(signals): { score: number; level: "low" | "medium" | "high" | "critical" }`

Sum all signal weights. Apply diminishing returns above 80 to prevent runaway scores:

```typescript
export function computeRiskScore(
  signals: RiskSignal[]
): { score: number; level: "low" | "medium" | "high" | "critical" } {
  const rawSum = signals.reduce((sum, s) => sum + s.weight, 0);
  
  // Diminishing returns: full credit up to 60, half credit 60-80, quarter credit above 80
  let score: number;
  if (rawSum <= 60) {
    score = rawSum;
  } else if (rawSum <= 100) {
    score = 60 + (rawSum - 60) * 0.5;
  } else {
    score = 80 + (rawSum - 100) * 0.25;
  }
  score = Math.min(100, Math.round(score));

  let level: "low" | "medium" | "high" | "critical";
  if (score <= 25) level = "low";
  else if (score <= 50) level = "medium";
  else if (score <= 75) level = "high";
  else level = "critical";

  return { score, level };
}
```

These thresholds map to reviewer expectations:
- **0–25 (low)**: Quick review, low risk. Rubber-stamp if tests pass.
- **26–50 (medium)**: Normal review. Check the flagged signals, verify tests.
- **51–75 (high)**: Careful review required. Multiple risk factors. Consider requesting a second reviewer.
- **76–100 (critical)**: Block and discuss. Major architectural or security implications. May need split into smaller PRs.

#### `assessTestCoverage(files): TestCoverageInfo`

```typescript
export function assessTestCoverage(
  files: Array<{ path: string }>
): TestCoverageInfo
```

- Classify each file as "test" or "code" using the patterns from signal #6 above.
- `ratio` = `testFileCount / codeFileCount` (or `1.0` if `codeFileCount === 0`).
- `warning`: If ratio is 0 and code files > 0: `"No test files included in this PR. Consider adding tests for the changed code."`. If ratio < 0.5 and code files > 3: `"Low test-to-code ratio ({ratio}). Consider adding more tests."`. Otherwise `null`.

#### `rankFilesByReviewPriority(files): FileRisk[]`

Rank each file for suggested review order. Each file gets a category and a risk score.

```typescript
export function rankFilesByReviewPriority(
  files: Array<{ path: string; additions: number; deletions: number; binary: boolean }>,
  signals: RiskSignal[]
): FileRisk[]
```

**File categorization patterns** (checked in order — first match wins):

| Priority | Category | File Pattern |
|---|---|---|
| 1 | `migration` | `migrations?/`, `schema`, `*.sql`, `alembic`, `prisma/schema` |
| 2 | `api` | `api/`, `routes?/`, `controllers?/`, `handlers?/`, `endpoints?/`, `resolvers?/`, `swagger`, `openapi`, `*.graphql` |
| 3 | `security` | `auth`, `crypto`, `security`, `token`, `session`, `password`, `permission`, `rbac`, `oauth`, `secret`, `credentials` (excluding test files) |
| 4 | `core` | Source code files (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.rb`, `.c`, `.cpp`, `.cs`, `.m`, `.mm`, `.php`) not matching other categories |
| 5 | `test` | `test`, `spec`, `__tests__`, `.test.`, `.spec.` |
| 6 | `config` | `.yml`, `.yaml`, `.json`, `.toml`, `.ini`, `.env`, `.github/`, `Dockerfile`, `Makefile`, `*.config.*` |
| 7 | `docs` | `.md`, `README`, `docs/`, `LICENSE`, `CHANGELOG` |
| 8 | `generated` | `vendor/`, `generated/`, `*.min.*`, `dist/`, `build/`, `*.lock` |
| 9 | `other` | Everything else |

**Per-file risk score** (0–100):

```
fileRisk = basePriorityScore + sizeScore + signalBonus
```

- `basePriorityScore`: migration=40, api=35, security=35, core=20, test=10, config=15, docs=5, generated=2, other=10
- `sizeScore`: `min(30, (additions + deletions) / 20)` — larger changes are riskier
- `signalBonus`: +10 for each risk signal that includes this file in its `files` array

Cap per-file score at 100. Sort descending by `riskScore`. The `reviewPriority` field is the 1-based rank in the sorted output.

**Reasons**: Each file should include human-readable reasons, e.g.:
- `"Database migration file — review for reversibility"`
- `"Public API surface — verify backward compatibility"`
- `"Security-sensitive path — audit for vulnerabilities"`
- `"108 lines changed — large change in single file"`
- `"No corresponding test file"`

#### `detectBreakingChanges(files, commits): string[]`

Return an array of human-readable breaking change indicators:

```typescript
export function detectBreakingChanges(
  files: Array<{ path: string }>,
  commits: Array<{ hash: string; message: string }>
): string[]
```

Detection sources:

1. **Commit messages**: Scan for `BREAKING CHANGE:`, `BREAKING:`, or conventional commit `!:` marker (e.g., `feat!: remove old API`). Return the commit message.
2. **File patterns**: If any file matches API/route/controller/schema/migration patterns, return `"Changes to [category] files may affect downstream consumers"`.
3. **Dependency manifests**: If `package.json`, `Cargo.toml`, `go.mod`, `pom.xml`, or `build.gradle` changed, return `"Dependency changes detected — verify compatibility"`.
4. **Deletion-heavy API files**: If any API-pattern file has `deletions > additions * 2`, return `"[path]: More code removed than added — possible API surface reduction"`.

Return deduplicated results. If none found, return empty array.

#### `generateRiskSummary(level, score, size, signals, testCoverage, breakingChanges): string`

Generate a human-readable narrative. The format depends on severity:

```typescript
export function generateRiskSummary(
  level: "low" | "medium" | "high" | "critical",
  score: number,
  size: PrSizeCategory,
  signals: RiskSignal[],
  testCoverage: TestCoverageInfo,
  breakingChanges: string[]
): string
```

**Format by risk level:**

- **Low**: `"Low risk (score: {score}/100). This is a {size.category} PR ({size.totalLines} lines across {size.files} files). No significant risk factors detected."`

- **Medium**: `"Medium risk (score: {score}/100). This is a {size.category} PR with {signals.length} risk signal(s): {signal names}. {test coverage note if applicable}."`

- **High/Critical**: Multi-line format:
  ```
  {Level} risk (score: {score}/100). This {size.category} PR requires careful review.

  Key concerns:
  - {signal 1 description}
  - {signal 2 description}
  ...

  {test coverage warning if applicable}
  {breaking change warning if applicable}

  Consider requesting an additional reviewer for this PR.
  ```

For critical PRs, append: `"This PR may benefit from being split into smaller, focused changes."`

---

### Task 3: Create `src/tools/assess-pr-risk.ts`

Follow the tool module pattern from AGENTS.md (5 exports: schema, type, result interface, handler, tool definition).

#### Schema

```typescript
export const assessPrRiskSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe(
      "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory."
    ),
  baseBranch: z
    .string()
    .optional()
    .describe("Base branch to compare against. Auto-detects if not specified."),
  includeHistory: z
    .boolean()
    .optional()
    .describe(
      "When true, queries git history for file churn data to detect volatile files. " +
      "Adds latency but produces richer risk signals. Default: false."
    ),
});
```

#### Input Type

```typescript
export type AssessPrRiskInput = z.infer<typeof assessPrRiskSchema>;
```

#### Result Interface

```typescript
export interface AssessPrRiskResult {
  riskLevel: "low" | "medium" | "high" | "critical";
  riskScore: number;
  size: {
    category: "XS" | "S" | "M" | "L" | "XL";
    files: number;
    additions: number;
    deletions: number;
    totalLines: number;
  };
  signals: Array<{
    id: string;
    name: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    weight: number;
    files: string[];
  }>;
  hotspots: Array<{
    path: string;
    riskScore: number;
    reasons: string[];
    reviewPriority: number;
    category: string;
  }>;
  testCoverage: {
    hasTests: boolean;
    testFileCount: number;
    codeFileCount: number;
    ratio: number;
    warning: string | null;
  };
  breakingChangeIndicators: string[];
  suggestedReviewOrder: string[];
  summary: string;
  errors: string[];
}
```

#### Handler

```typescript
export async function assessPrRisk(
  input: AssessPrRiskInput,
  config: Config
): Promise<AssessPrRiskResult>
```

**Handler Logic:**

1. **Resolve repo path**: `input.repoPath || config.defaultRepoPath || process.cwd()`
2. **Validate repo path**: Call `validateRepoPath(repoPath)`
3. **Detect base branch**: Call `getDefaultBranch(repoPath, input.baseBranch || config.baseBranch)`
4. **Get branch changes**: Call `getBranchChanges(repoPath, baseBranch)`
   - If `null`, return an error result with `"No branch changes found. Ensure you are on a feature branch with commits ahead of the base branch."`
5. **Categorize PR size**: Call `categorizePrSize(files.length, totalAdditions, totalDeletions)`
6. **Optional churn data**: If `input.includeHistory` is `true`, call `getFileChurnData(repoPath, files)` (see Task 4)
7. **Detect risk signals**: Call `detectRiskSignals({ fileChanges, commits, totalAdditions, totalDeletions, churnData })`
8. **Compute risk score**: Call `computeRiskScore(signals)`
9. **Assess test coverage**: Call `assessTestCoverage(files)`
10. **Rank file hotspots**: Call `rankFilesByReviewPriority(files, signals)`
11. **Detect breaking changes**: Call `detectBreakingChanges(files, commits)`
12. **Generate summary**: Call `generateRiskSummary(level, score, size, signals, testCoverage, breakingChanges)`
13. **Build suggested review order**: Take the top N files from hotspots (sorted by priority) and return their paths. Include all files, not just the top N.
14. **Return result** with all fields populated

**Error Handling:**
- Never throw. Return `{ ...emptyResult, errors: [errorMessage] }` on failure.
- If `getBranchChanges` returns null, still return a valid result shape with empty arrays and an error message.
- If optional churn data fails, log a warning to `errors` but continue without churn signals.

#### Tool Definition

```typescript
export const assessPrRiskTool = {
  name: "assess_pr_risk",
  description: `Analyze the risk and complexity of the current PR branch changes.

Provides a deterministic risk assessment based on file patterns, change size, test coverage,
and structural signals. No LLM needed — fully heuristic-based.

Returns:
- Overall risk level (low/medium/high/critical) with 0-100 score
- PR size category (XS/S/M/L/XL) with research-backed thresholds
- Individual risk signals with severity and triggering files
- File hotspots ranked by review priority
- Test coverage assessment
- Breaking change indicators
- Suggested file review order (highest-impact first)
- Human-readable risk summary

Use this before opening a PR to understand risk, or as a reviewer to know where to focus.
Optionally set includeHistory=true for git-churn-based volatile file detection (adds latency).`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description:
          "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      baseBranch: {
        type: "string",
        description: "Base branch to compare against. Auto-detects if not specified.",
      },
      includeHistory: {
        type: "boolean",
        description:
          "When true, queries git history for file churn data. Default: false.",
      },
    },
  },
  handler: assessPrRisk,
};
```

---

### Task 4: Add Git Utility for File Churn (Optional Feature)

**File: `src/utils/git.ts`**

Add a function for querying file commit frequency in recent history:

#### `getFileChurnData(repoPath, files, dayWindow?): Promise<FileChurnInfo[]>`

```typescript
export interface FileChurnInfo {
  path: string;
  recentCommitCount: number;
  isHotspot: boolean;
}

export async function getFileChurnData(
  repoPath: string,
  files: Array<{ path: string }>,
  dayWindow: number = 30
): Promise<FileChurnInfo[]>
```

**Implementation:**

1. Validate the repo path.
2. Create a git instance.
3. For each file in `files`, run: `git log --oneline --since="{dayWindow} days ago" -- {file.path}` and count the lines.
4. Mark as `isHotspot` if `recentCommitCount >= 5`.
5. Return the array sorted by `recentCommitCount` descending.

**Performance guard**: If `files.length > 50`, only query the top 50 files by `additions + deletions` to cap latency. Add a warning to the tool result if files were skipped.

**Error handling**: If any individual file query fails, set `recentCommitCount: 0` and `isHotspot: false` for that file. Never let a single file failure crash the whole query.

---

### Task 5: Register the New Tool in `index.ts`

1. Add import:
   ```typescript
   import {
     assessPrRiskTool,
     assessPrRisk,
     assessPrRiskSchema,
   } from "./tools/assess-pr-risk.js";
   ```

2. Add to `tools` array:
   ```typescript
   {
     name: assessPrRiskTool.name,
     description: assessPrRiskTool.description,
     inputSchema: assessPrRiskTool.inputSchema,
     annotations: readOnlyAnnotations,
   },
   ```

3. Add case in `CallToolRequestSchema` handler:
   ```typescript
   case "assess_pr_risk": {
     const input = assessPrRiskSchema.parse(args || {});
     const result = await assessPrRisk(input, config);
     return {
       content: [
         {
           type: "text",
           text: JSON.stringify(result, null, 2),
         },
       ],
     };
   }
   ```

4. Update the tool count comment in `AGENTS.md` from 10 to 11 tools.

---

### Task 6: Write Tests

#### `test/utils/risk.test.ts` (NEW)

Test all functions from `src/utils/risk.ts`.

**Mock setup:**
```typescript
// No mocks needed for pure functions in risk.ts
// (detectRiskSignals, computeRiskScore, assessTestCoverage, etc. are all pure)
```

**Test: `detectRiskSignals`**

- Test: empty file list returns empty signals
- Test: 600-line PR triggers `large_pr` signal with weight 15
- Test: 1200-line PR triggers `large_pr` signal with weight 20 (scaled)
- Test: 2500-line PR triggers `large_pr` signal with weight 25 (max)
- Test: 20 files trigger `many_files` signal
- Test: migration file triggers `database_migrations` signal
- Test: `.github/workflows/ci.yml` triggers `cicd_changes` signal
- Test: `src/api/routes/users.ts` triggers `public_api_changes` signal
- Test: code files without test files triggers `no_tests` signal
- Test: test-only changes do NOT trigger `no_tests` signal
- Test: `package-lock.json` change triggers `dependency_changes` signal
- Test: `src/auth/session.ts` triggers `security_sensitive` signal (NOT `src/test/auth.test.ts`)
- Test: `.env.production` change triggers `config_env_changes` signal
- Test: files in 4+ directories trigger `cross_cutting` signal
- Test: binary file triggers `binary_files` signal
- Test: `vendor/lib.js` triggers `generated_vendored` signal
- Test: commit with `BREAKING CHANGE:` triggers `breaking_change_commits` signal
- Test: commit with `feat!:` triggers `breaking_change_commits` signal
- Test: multiple signals detected simultaneously
- Test: churn data triggers `high_churn_files` when provided

**Test: `computeRiskScore`**

- Test: no signals → score 0, level "low"
- Test: single low signal → score < 25, level "low"
- Test: medium signals totaling 35 → level "medium"
- Test: high signals totaling 60 → diminishing returns applied, level "high"
- Test: extreme signals totaling 150 → score capped near 100, level "critical"
- Test: score boundaries: 25 → "low", 26 → "medium", 50 → "medium", 51 → "high", 75 → "high", 76 → "critical"

**Test: `assessTestCoverage`**

- Test: no files → ratio 1.0, no warning
- Test: only test files → ratio 1.0 (Infinity guard: set to 1.0), no warning
- Test: 5 code files + 0 test files → warning about missing tests
- Test: 10 code files + 2 test files → ratio 0.2, low ratio warning
- Test: 3 code files + 3 test files → ratio 1.0, no warning
- Test: mixed file types (config, docs) excluded from code count

**Test: `rankFilesByReviewPriority`**

- Test: migration file ranked first
- Test: API file ranked before core logic
- Test: test files ranked after core logic
- Test: docs files ranked last
- Test: files with more lines changed get higher risk scores
- Test: files involved in risk signals get bonus points
- Test: `reviewPriority` is 1-based sequential

**Test: `detectBreakingChanges`**

- Test: no breaking patterns → empty array
- Test: commit with "BREAKING CHANGE: removed endpoint" → includes message
- Test: API route file changed → includes "may affect downstream consumers"
- Test: package.json changed → includes dependency warning
- Test: API file with more deletions than additions → includes surface reduction warning
- Test: results are deduplicated

**Test: `generateRiskSummary`**

- Test: low risk generates single-line summary
- Test: medium risk includes signal names
- Test: high risk generates multi-line format with key concerns
- Test: critical risk includes split suggestion
- Test: test coverage warning included when applicable
- Test: breaking change warning included when applicable

#### `test/tools/assess-pr-risk.test.ts` (NEW)

Test the tool handler. Mock git utilities.

**Mock setup:**
```typescript
vi.mock("../../src/utils/git.js", () => ({
  validateRepoPath: vi.fn((path: string) => path || process.cwd()),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
  getBranchChanges: vi.fn(),
  getFileChurnData: vi.fn(),
}));
```

**Tests:**

- Test: returns valid result shape with all fields
- Test: low-risk PR (small change, tests included, no sensitive files) → riskLevel "low"
- Test: high-risk PR (many files, no tests, migrations, API changes) → riskLevel "high" or "critical"
- Test: no branch changes → returns error in errors array
- Test: respects `baseBranch` input
- Test: `includeHistory: true` calls `getFileChurnData`
- Test: `includeHistory: false` (default) does not call `getFileChurnData`
- Test: uses `config.defaultRepoPath` as fallback
- Test: suggested review order matches hotspot ranking
- Test: size category matches line/file counts
- Test: handles getBranchChanges returning null gracefully

#### `test/utils/formatters.test.ts` (UPDATE)

Add tests for the new `categorizePrSize` function:

- Test: 5 lines, 2 files → "XS"
- Test: 50 lines, 5 files → "S"
- Test: 200 lines, 10 files → "M"
- Test: 800 lines, 20 files → "L"
- Test: 1500 lines, 5 files → "XL" (lines push it up despite few files)
- Test: 50 lines, 20 files → "M" (files push it up despite few lines)
- Test: 0 lines, 0 files → "XS"

#### `test/utils/git.test.ts` (UPDATE)

Add tests for `getFileChurnData`:

- Test: returns churn data for each file
- Test: marks files with ≥5 commits as hotspots
- Test: handles git errors gracefully (returns 0 count)
- Test: respects `dayWindow` parameter
- Test: caps at 50 files when input exceeds limit

---

### Task 7: Validate

Run the full validation suite in this order:

```bash
npm run typecheck
npm run test:run
npm run build
npm run lint
```

Fix any issues. Common problems:

- Missing `.js` extensions on imports from `risk.ts`
- Type mismatches between `FileChange` (from `git.ts`) and the risk function parameters
- Mock setup order (`vi.mock` must come before imports)
- The `FileChurnInfo` type needs to be exported from both `git.ts` (where the function lives) and `risk.ts` (where it's used in interfaces). Consider defining it in `git.ts` and re-exporting from `risk.ts`, or define it once and import.
- The `categorizePrSize` function in `formatters.ts` needs to be imported with `.js` extension

---

## Critical Constraints

1. **All imports must use `.js` extensions** — this is ESM. `import { foo } from "./utils/risk.js"` not `"./utils/risk"`.
2. **Tool handlers never throw** — return `{ ...emptyResult, errors: [errorMessage] }` or handle errors gracefully.
3. **Config is passed as parameter** — never import `getConfig()` in tool files.
4. **Mock all git operations in tests** — never run real git commands or touch the real filesystem.
5. **The security model is read-only** — use only `simple-git` read operations. Never write, modify, or execute shell commands.
6. **File churn queries must be capped** — max 50 files queried, to prevent O(n) git log calls on XL PRs.
7. **All regex in file pattern matching must use try/catch** — fail-open on invalid patterns.
8. **Risk scoring must be deterministic** — same inputs always produce same output. No randomness, no LLM calls, no external APIs.
9. **Signal weights are additive with diminishing returns** — prevents extreme outlier scores from a single anomalous PR.
10. **`FileChurnInfo` type** — define it in `git.ts` (where `getFileChurnData` lives) and import it in `risk.ts`. Do NOT duplicate type definitions.

---

## Summary of New/Modified Files

| File | Action |
|---|---|
| `src/utils/formatters.ts` | Modify — add `categorizePrSize` function and `PrSizeCategory` interface |
| `src/utils/risk.ts` | **Create** — core risk engine: signal detection, scoring, file ranking, coverage, breaking changes, summary |
| `src/utils/git.ts` | Modify — add `getFileChurnData` function and `FileChurnInfo` interface |
| `src/tools/assess-pr-risk.ts` | **Create** — new MCP tool with schema, handler, and tool definition |
| `src/index.ts` | Modify — register `assess_pr_risk` tool (import, tools array, switch case) |
| `AGENTS.md` | Modify — update tool count from 10 to 11 |
| `test/utils/risk.test.ts` | **Create** — tests for all `risk.ts` functions |
| `test/tools/assess-pr-risk.test.ts` | **Create** — tests for the tool handler |
| `test/utils/formatters.test.ts` | Modify — add `categorizePrSize` tests |
| `test/utils/git.test.ts` | Modify — add `getFileChurnData` tests |
