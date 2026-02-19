# Master Implementation Prompt: PR Template System for pr-narrator-mcp

> Give this entire prompt to a coding agent. It contains all context, architecture decisions, file-level implementation specs, domain presets, and validation criteria needed to implement the feature end-to-end.

---

## Context

**pr-narrator-mcp** is an MCP server (Node.js, TypeScript, ESM) that generates commit messages, PR titles, and PR descriptions from git repo state. It currently has 8 tools. You are adding a PR template system that makes it narrate **all parts** of a PR's story.

Read `AGENTS.md` in the repo root first. It contains project conventions, file patterns, naming rules, test patterns, and common pitfalls. Follow it exactly.

---

## What You Are Building

A PR template system with four capabilities:

1. **Repo template detection** -- find and parse `PULL_REQUEST_TEMPLATE.md` from the repo
2. **Automatic domain inference** -- detect whether a repo is mobile, frontend, backend, devops, security, or ML from its file tree, and apply the right preset with zero config
3. **Conditional sections** -- sections that appear only when relevant (e.g., "Screenshots" only when UI files changed, "Database/Migration" only when SQL files changed)
4. **A new `get_pr_template` tool** -- shows the resolved template for a repo so the AI/user knows what sections will appear

### Template Resolution Pipeline (runs per-call, not at startup)

Priority order when `generate_pr` or `generate_pr_description` is called:

1. **Repo `PULL_REQUEST_TEMPLATE.md`** -- if found in repo, parse its markdown into sections
2. **`PR_TEMPLATE_PRESET` env var** -- if user explicitly set a preset server-wide
3. **Auto-detect domain** -- scan repo file tree, score against domain signals, pick best match
4. **Enhanced default** -- universal 6-section template

This means switching between repos (iOS app, Express API, Terraform infra) automatically uses the right template. No per-repo config files.

---

## Implementation Tasks (in order)

### Task 1: Enhance the Config Schema

**File: `src/config/schema.ts`**

Add `condition`, `placeholder`, and `format` to `prSectionSchema`:

```typescript
const sectionConditionSchema = z
  .object({
    type: z.enum(["always", "has_tickets", "file_pattern", "commit_count_gt", "never"]),
    pattern: z.string().optional(), // regex for file_pattern
    threshold: z.number().optional(), // for commit_count_gt
  })
  .optional();

const prSectionSchema = z.object({
  name: z.string(),
  required: z.boolean().default(false),
  autoPopulate: z
    .enum(["commits", "extracted", "purpose", "none", "checklist", "change_type"])
    .optional(),
  condition: sectionConditionSchema,
  placeholder: z.string().optional(),
  format: z.enum(["markdown", "checklist"]).default("markdown"),
});
```

Add `template` config to `prSchema`:

```typescript
const prTemplateConfigSchema = z
  .object({
    preset: z
      .enum([
        "default", "minimal", "detailed",
        "mobile", "frontend", "backend",
        "devops", "security", "ml",
      ])
      .optional(),
    detectRepoTemplate: z.boolean().default(true),
  })
  .default({});
```

Update `prSchema` to include the template config:

```typescript
const prSchema = z
  .object({
    title: prTitleSchema,
    template: prTemplateConfigSchema,
    sections: z.array(prSectionSchema).default([
      { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
      { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
      { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
      { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "commit_count_gt", threshold: 1 } },
      { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" } },
      { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
    ]),
  })
  .default({});
```

Export the new types: `PrTemplateConfig`, `SectionCondition`.

**IMPORTANT**: The default sections change from the old 2-section array (Ticket + Purpose) to the new 6-section array. This is intentional and non-breaking since the old defaults were minimal placeholders anyway. Make sure `defaultConfig` still works via `configSchema.parse({})`.

---

### Task 2: Create `src/utils/template.ts`

This is the core of the feature. Create this new file with these exports:

#### `findRepoTemplate(repoPath: string): Promise<string | null>`

Search for PR template files in standard locations. Use `fs.readdir` + case-insensitive filtering (NOT `child_process`). Check these paths in order:
- `.github/pull_request_template.md` (any case)
- `.github/PULL_REQUEST_TEMPLATE/` directory (use first `.md` file found)
- `pull_request_template.md` (root, any case)
- `docs/pull_request_template.md` (any case)

Return the file contents as a string, or `null` if not found. Use `fs.readFile` with utf-8 encoding. Wrap in try/catch -- return `null` on any fs error.

#### `parseTemplateToSections(markdown: string): PrSection[]`

Split markdown content by `## ` headers. For each section:
- Extract the header name
- Extract the body content (everything until next `## ` or end)
- Map the section name to a known `autoPopulate` strategy using keyword matching:

| Section name keywords | autoPopulate | Notes |
|---|---|---|
| summary, description, purpose, what, overview, about, context | "purpose" | |
| ticket, issue, related, jira, linear, reference | "extracted" | |
| test, testing, qa, verification, how to test | "none" | Keep template content as placeholder |
| checklist, review checklist, pr checklist | "checklist" | |
| type of change, change type, category | "change_type" | |
| commits, changelog, changes, what changed | "commits" | |
| Everything else | "none" | Keep original template content as placeholder |

Use case-insensitive `.includes()` matching on the lowercased section name. The template body content becomes the `placeholder` field so the AI knows what the repo expects in that section.

All parsed sections get `condition: { type: "always" }` since they came from the repo template (the repo chose to include them).

#### `evaluateCondition(condition, changedFiles, tickets, commitCount): boolean`

```typescript
export function evaluateCondition(
  condition: SectionCondition | undefined,
  changedFiles: string[],
  tickets: string[],
  commitCount: number
): boolean
```

- `undefined` or `{ type: "always" }` → `true`
- `{ type: "never" }` → `false`
- `{ type: "has_tickets" }` → `tickets.length > 0`
- `{ type: "commit_count_gt", threshold }` → `commitCount > (threshold ?? 0)`
- `{ type: "file_pattern", pattern }` → test each changed file path against `new RegExp(pattern, "i")`. Return `true` if any match. Wrap the RegExp constructor in try/catch -- if the pattern is invalid, return `true` (fail-open so the section still appears).

#### `detectRepoDomain(repoPath: string): Promise<string>`

This is the key function for zero-config repo switching. Scan the repo file tree (top 2-3 directory levels only, for performance) and score against domain signal patterns.

Use `fs.readdir` recursively with `{ recursive: true }` (Node 18.17+) or manually scan 2 levels. Collect file paths relative to repoPath.

**Scoring system** -- each domain has signal patterns. For each file that matches a signal, add points. The domain with the highest score wins. Return `"default"` if no domain reaches a minimum threshold (e.g., 3 points).

```typescript
const DOMAIN_SIGNALS: Record<string, Array<{ pattern: RegExp; weight: number }>> = {
  mobile: [
    { pattern: /\.swift$/i, weight: 3 },
    { pattern: /\.kt$/i, weight: 3 },
    { pattern: /\.xcodeproj/i, weight: 5 },
    { pattern: /\.xcworkspace/i, weight: 5 },
    { pattern: /Podfile$/i, weight: 4 },
    { pattern: /Fastfile$/i, weight: 3 },
    { pattern: /AndroidManifest\.xml$/i, weight: 5 },
    { pattern: /\.storyboard$/i, weight: 3 },
    { pattern: /\.xib$/i, weight: 3 },
    { pattern: /build\.gradle(\.kts)?$/i, weight: 2 },
    { pattern: /\.pbxproj$/i, weight: 4 },
    { pattern: /Info\.plist$/i, weight: 2 },
  ],
  frontend: [
    { pattern: /\.(tsx|jsx)$/i, weight: 3 },
    { pattern: /\.(vue|svelte)$/i, weight: 4 },
    { pattern: /\.(css|scss|less)$/i, weight: 1 },
    { pattern: /next\.config\./i, weight: 4 },
    { pattern: /vite\.config\./i, weight: 4 },
    { pattern: /webpack\.config\./i, weight: 4 },
    { pattern: /nuxt\.config\./i, weight: 4 },
    { pattern: /tailwind\.config\./i, weight: 2 },
    { pattern: /postcss\.config/i, weight: 2 },
    { pattern: /\.html$/i, weight: 1 },
  ],
  backend: [
    { pattern: /\.(go|rs)$/i, weight: 3 },
    { pattern: /\.java$/i, weight: 2 },
    { pattern: /\.py$/i, weight: 1 },
    { pattern: /migrations?\//i, weight: 4 },
    { pattern: /controllers?\//i, weight: 3 },
    { pattern: /routes?\//i, weight: 3 },
    { pattern: /prisma\/schema/i, weight: 5 },
    { pattern: /alembic/i, weight: 4 },
    { pattern: /sequelize/i, weight: 4 },
    { pattern: /manage\.py$/i, weight: 4 },
    { pattern: /Cargo\.toml$/i, weight: 3 },
    { pattern: /go\.mod$/i, weight: 4 },
    { pattern: /pom\.xml$/i, weight: 3 },
  ],
  devops: [
    { pattern: /\.tf$/i, weight: 5 },
    { pattern: /Dockerfile$/i, weight: 3 },
    { pattern: /docker-compose/i, weight: 4 },
    { pattern: /helm\//i, weight: 5 },
    { pattern: /k8s\//i, weight: 5 },
    { pattern: /kubernetes\//i, weight: 5 },
    { pattern: /Jenkinsfile$/i, weight: 4 },
    { pattern: /ansible\//i, weight: 5 },
    { pattern: /pulumi\//i, weight: 5 },
    { pattern: /\.github\/workflows\//i, weight: 2 },
    { pattern: /terragrunt/i, weight: 5 },
  ],
  ml: [
    { pattern: /\.ipynb$/i, weight: 5 },
    { pattern: /model\//i, weight: 3 },
    { pattern: /training\//i, weight: 4 },
    { pattern: /datasets?\//i, weight: 4 },
    { pattern: /dvc\.yaml$/i, weight: 5 },
    { pattern: /MLproject$/i, weight: 5 },
    { pattern: /\.pkl$/i, weight: 3 },
    { pattern: /\.h5$/i, weight: 3 },
    { pattern: /\.onnx$/i, weight: 4 },
    { pattern: /notebooks?\//i, weight: 3 },
  ],
  security: [
    { pattern: /SECURITY\.md$/i, weight: 2 },
    { pattern: /\.snyk$/i, weight: 5 },
    { pattern: /tfsec/i, weight: 5 },
    { pattern: /trivy/i, weight: 4 },
    { pattern: /security-policy/i, weight: 4 },
  ],
};
```

**Disambiguation rules**: Some signals overlap (e.g., `.py` files exist in both backend and ML repos). To handle this:
- Backend `.py` gets weight 1 (low), while ML-specific patterns (`.ipynb`, `training/`, `dvc.yaml`) get weight 4-5
- Frontend `.css` gets weight 1 (low) since backend repos can have CSS too
- DevOps `Dockerfile` gets weight 3 (medium) since many repos have Dockerfiles
- Only return a domain if it scores at least 3 points AND scores at least 2x more than the second-highest

For efficiency: limit file scanning. Use `fs.readdir(repoPath, { withFileTypes: true })` for the top level, then recurse into at most the first 2 levels of non-`node_modules`, non-`.git`, non-`vendor`, non-`venv` directories. Cap total files examined at ~500.

#### `getPresetSections(preset: string): PrSection[]`

Return the section definitions for a named preset. Define all presets as constants. Here are the full definitions:

**"default"** (6 sections):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "commit_count_gt", threshold: 1 } },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"minimal"** (2 sections):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
]
```

**"detailed"** (10 sections):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "always" } },
  { name: "Screenshots", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less|tsx|jsx|vue|svelte|html|storyboard|xib)$" }, placeholder: "_[Add screenshots if applicable]_" },
  { name: "Breaking Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "api/|routes?/|controller|schema|migration|swagger|openapi" }, placeholder: "_[Describe any breaking changes and migration path]_" },
  { name: "Performance Impact", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe any performance implications]_" },
  { name: "Deployment Notes", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Any special deployment steps or considerations]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"mobile"** (8 sections -- iOS/Android):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Screenshots", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(swift|kt|storyboard|xib|xml)$|view|screen|ui|component|activity|fragment|composable" }, placeholder: "_[Add before/after screenshots for UI changes]_" },
  { name: "Device Testing", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "Tested on:\n- [ ] iPhone (model)\n- [ ] iPad (model)\n- [ ] Android phone (model)\n- [ ] Android tablet (model)\n- [ ] Simulator/Emulator" },
  { name: "Accessibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "view|screen|ui|component|controller|activity|fragment|composable|accessibility" }, placeholder: "_[Describe accessibility impact of UI changes]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"frontend"** (8 sections -- Web):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Screenshots / Visual Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less|tsx|jsx|vue|svelte|html)$|component|page|layout|style" }, placeholder: "_[Add before/after screenshots for visual changes]_" },
  { name: "Browser Compatibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less)$|polyfill|compat|browserslist" }, placeholder: "Tested in:\n- [ ] Chrome\n- [ ] Firefox\n- [ ] Safari\n- [ ] Edge\n- [ ] Mobile browsers" },
  { name: "Accessibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(tsx|jsx|vue|svelte|html)$|a11y|accessibility|aria|component" }, placeholder: "_[Describe accessibility considerations]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"backend"** (8 sections -- APIs/services):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "API Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "routes?/|controllers?/|handlers?/|endpoints?/|resolvers?/|api/|swagger|openapi|\\.graphql$" }, placeholder: "_[Describe API endpoint changes, new/modified/removed endpoints]_" },
  { name: "Database / Migration", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "migrations?/|schema|\\.(sql)$|prisma|knex|typeorm|alembic|sequelize" }, placeholder: "_[Describe schema changes, migration steps, rollback plan]_" },
  { name: "Breaking Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "api/|routes?/|controllers?/|schema|migration|swagger|openapi" }, placeholder: "_[Describe impact on existing clients and migration path]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"devops"** (8 sections -- Infrastructure):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Infrastructure Impact", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe what infrastructure is affected and how]_" },
  { name: "Affected Environments", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "- [ ] Development\n- [ ] Staging\n- [ ] Production" },
  { name: "Rollback Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how to safely rollback these changes]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you validated these infrastructure changes]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"security"** (7 sections -- InfoSec):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Security Impact", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe the security implications of this change]_" },
  { name: "Threat Model Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "auth|security|crypto|token|session|password|permission|rbac|oauth|saml|cert|ssl|tls" }, placeholder: "_[Describe changes to attack surface, trust boundaries, or authentication/authorization]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe security testing performed]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

**"ml"** (8 sections -- AI/ML):
```typescript
[
  { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" } },
  { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" } },
  { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" } },
  { name: "Model Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "model|train|weights|checkpoint|\\.(h5|pkl|onnx|pt|pth|safetensors)$" }, placeholder: "_[Describe architecture, hyperparameter, or training changes]_" },
  { name: "Dataset Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "dataset|data/|pipeline|preprocess|feature|etl" }, placeholder: "_[Describe changes to data sources, preprocessing, or feature engineering]_" },
  { name: "Metrics / Evaluation", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Before/after metrics comparison. Include evaluation methodology.]_" },
  { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe validation and testing approach]_" },
  { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
]
```

#### `resolveTemplate(repoPath, config): Promise<ResolvedTemplate>`

The main resolution function. Returns:
```typescript
export interface ResolvedTemplate {
  sections: PrSection[];
  source: "repo" | "preset" | "auto-detected" | "default";
  detectedDomain: string | null;
  repoTemplatePath: string | null;
  rawTemplate: string | null;
}
```

Logic:
1. If `config.pr.template.detectRepoTemplate` is true, call `findRepoTemplate(repoPath)`. If found, parse it and return with `source: "repo"`.
2. If `config.pr.template.preset` is set, return `getPresetSections(preset)` with `source: "preset"`.
3. Call `detectRepoDomain(repoPath)`. If it returns something other than `"default"`, return that preset's sections with `source: "auto-detected"`.
4. Return the default sections with `source: "default"`.

---

### Task 3: Implement New autoPopulate Helpers

These can go in `src/utils/template.ts` or `src/utils/formatters.ts` (your choice, but template.ts is recommended since they're template-specific).

#### `generateChecklist(files, commits, domain?): string`

Generate a contextual markdown checklist. Always include universal items, then add domain-specific items based on what files changed.

**Universal items (always present):**
```
- [ ] Code has been self-reviewed
- [ ] Changes have been tested locally
- [ ] Tests have been added or updated
- [ ] No new warnings or errors introduced
```

**Conditional items (based on file patterns in changed files):**
- If docs/README files changed: `- [ ] Documentation is accurate and complete`
- If API/route files changed: `- [ ] API changes are backward compatible`
- If migration/schema files changed: `- [ ] Database migration is reversible`
- If UI files changed: `- [ ] UI changes match design specs`
- If config/env files changed: `- [ ] Environment variables documented`
- If dependency files changed (package.json, Gemfile, etc.): `- [ ] Dependencies reviewed for security`

**Domain-specific items (when domain is known from preset):**
- mobile: `- [ ] No hardcoded strings (localization ready)`, `- [ ] Supports Dynamic Type / font scaling`, `- [ ] Works in both portrait and landscape`
- frontend: `- [ ] Responsive across breakpoints`, `- [ ] Keyboard navigable`, `- [ ] No console errors in browser`
- backend: `- [ ] No N+1 queries introduced`, `- [ ] Error handling covers edge cases`, `- [ ] API is backward compatible`
- devops: `- [ ] Terraform plan output reviewed`, `- [ ] No secrets or credentials in code`, `- [ ] Monitoring and alerts configured`
- security: `- [ ] Input validation on all user inputs`, `- [ ] No hardcoded secrets or credentials`, `- [ ] Principle of least privilege followed`, `- [ ] OWASP Top 10 risks considered`
- ml: `- [ ] Model outputs validated against expected ranges`, `- [ ] No data leakage between train/test sets`, `- [ ] Results are reproducible with fixed seed`

#### `inferChangeType(branchPrefix, files): string`

Generate a checkbox list showing the inferred type of change. Use branch prefix and file patterns to determine which box to check.

Mapping from branch prefix to type:
- `bug`, `fix`, `hotfix` → "Bug fix"
- `feature`, `feat` → "New feature"
- `refactor` → "Refactoring"
- `docs` → "Documentation"
- `test` → "Test"
- `chore`, `build`, `ci` → "Chore / maintenance"
- `perf` → "Performance improvement"
- `style` → "Code style"

If no branch prefix, infer from files using `inferCommitType` from `formatters.ts`.

Output format:
```markdown
- [x] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Refactoring (no functional changes)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Configuration change
```

Check the one that matches. If uncertain, check none and let the user fill it in.

---

### Task 4: Create `src/tools/get-pr-template.ts`

Follow the tool module pattern from AGENTS.md (5 exports: schema, type, result interface, handler, tool definition).

**Schema:**
```typescript
export const getPrTemplateSchema = z.object({
  repoPath: z.string().optional().describe("Path to the git repository."),
  preset: z.string().optional().describe("Force a specific preset instead of auto-detecting."),
});
```

**Result:**
```typescript
export interface GetPrTemplateResult {
  source: "repo" | "preset" | "auto-detected" | "default";
  repoTemplatePath: string | null;
  detectedDomain: string | null;
  preset: string | null;
  sections: Array<{
    name: string;
    required: boolean;
    autoPopulate: string | undefined;
    condition: SectionCondition | undefined;
    willAppear: boolean;
    placeholder: string | null;
    format: string;
  }>;
  rawTemplate: string | null;
}
```

**Handler logic:**
1. Resolve repoPath (input > config > cwd)
2. If `input.preset` is provided, override config preset
3. Call `resolveTemplate(repoPath, config)`
4. Get branch changes to evaluate conditions (call `getBranchChanges`)
5. For each section, evaluate its condition against the changed files to populate `willAppear`
6. Return the result

**Tool definition:**
- name: `"get_pr_template"`
- description: Explain that it returns the resolved template for a repo, showing which sections will appear, and is useful for previewing before generating

---

### Task 5: Enhance `generate-pr.ts` and `generate-pr-description.ts`

**Changes to both files:**

1. **Add `templatePreset` to the input schema** -- optional string field

2. **Replace `config.pr.sections` with resolved template sections:**

   Instead of:
   ```typescript
   for (const sectionConfig of prConfig.sections) {
   ```
   
   Do:
   ```typescript
   const resolved = await resolveTemplate(repoPath, effectiveConfig);
   const templateSections = resolved.sections;
   
   for (const sectionConfig of templateSections) {
     // Evaluate condition
     const filePaths = (branchChanges?.files ?? []).map(f => f.path);
     if (!evaluateCondition(sectionConfig.condition, filePaths, tickets, commits.length)) {
       continue;
     }
     // ... existing generateSectionContent logic
   }
   ```

   If `input.templatePreset` is provided, create an `effectiveConfig` that overrides `config.pr.template.preset` with the input value.

3. **Enhance `generateSectionContent`** to handle new autoPopulate types:

   Add these cases:
   ```typescript
   if (section.autoPopulate === "checklist") {
     return generateChecklist(context.files, context.commits);
   }
   if (section.autoPopulate === "change_type") {
     return inferChangeType(context.branchPrefix, context.files);
   }
   ```

   Also add placeholder fallback: if no content was generated and `section.placeholder` exists, return the placeholder.

4. **Add template context to results:**

   Add to the result's `context` object:
   ```typescript
   templateSource: resolved.source,
   detectedDomain: resolved.detectedDomain,
   ```

5. **Update the `generateSectionContent` function signature** to accept `branchPrefix` in its context (needed for `inferChangeType`).

**IMPORTANT**: The `generateSectionContent` function is currently duplicated between `generate-pr.ts` and `generate-pr-description.ts`. Consider extracting it to `template.ts` to avoid further duplication. If you do, update both files to import from there.

---

### Task 6: Update Config Loader

**File: `src/config/loader.ts`**

Add handling for two new env vars:

```typescript
if (process.env.PR_TEMPLATE_PRESET) {
  const preset = process.env.PR_TEMPLATE_PRESET;
  const validPresets = ["default", "minimal", "detailed", "mobile", "frontend", "backend", "devops", "security", "ml"];
  if (validPresets.includes(preset)) {
    if (!envConfig.pr) envConfig.pr = {};
    if (!(envConfig.pr as Record<string, unknown>).template) {
      (envConfig.pr as Record<string, unknown>).template = {};
    }
    ((envConfig.pr as Record<string, unknown>).template as Record<string, unknown>).preset = preset;
  }
}

if (process.env.PR_DETECT_REPO_TEMPLATE !== undefined) {
  const val = process.env.PR_DETECT_REPO_TEMPLATE.toLowerCase();
  if (!envConfig.pr) envConfig.pr = {};
  if (!(envConfig.pr as Record<string, unknown>).template) {
    (envConfig.pr as Record<string, unknown>).template = {};
  }
  ((envConfig.pr as Record<string, unknown>).template as Record<string, unknown>).detectRepoTemplate = val !== "false" && val !== "0";
}
```

Also update the merge logic to properly merge the `pr` config instead of always overwriting with defaults. Currently `loader.ts` has `pr: defaultConfig.pr` which would clobber any PR config from env vars.

---

### Task 7: Register the New Tool in `index.ts`

1. Add import:
   ```typescript
   import { getPrTemplateSchema, getPrTemplate, getPrTemplateTool } from "./tools/get-pr-template.js";
   ```

2. Add to `tools` array:
   ```typescript
   {
     name: getPrTemplateTool.name,
     description: getPrTemplateTool.description,
     inputSchema: getPrTemplateTool.inputSchema,
     annotations: readOnlyAnnotations,
   },
   ```

3. Add case in `CallToolRequestSchema` handler:
   ```typescript
   case "get_pr_template": {
     const input = getPrTemplateSchema.parse(args);
     const result = await getPrTemplate(input, config);
     return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
   }
   ```

---

### Task 8: Write Tests

#### `test/utils/template.test.ts`

Test these functions:

**findRepoTemplate:**
- Mock `fs.readdir` and `fs.readFile` (use `vi.mock("fs/promises")`)
- Test: finds `.github/pull_request_template.md`
- Test: finds `PULL_REQUEST_TEMPLATE.md` in root
- Test: finds template in `.github/PULL_REQUEST_TEMPLATE/` subdirectory
- Test: returns null when no template exists
- Test: returns null on fs error

**parseTemplateToSections:**
- Test: parses `## Summary\ncontent\n## Test Plan\nsteps` into 2 sections
- Test: maps "Summary" to autoPopulate "purpose"
- Test: maps "Related Issues" to autoPopulate "extracted"
- Test: maps unknown sections to autoPopulate "none" with placeholder
- Test: handles template with no ## headers (returns empty array or single section)

**evaluateCondition:**
- Test: undefined condition returns true
- Test: "always" returns true
- Test: "never" returns false
- Test: "has_tickets" with tickets returns true, without returns false
- Test: "commit_count_gt" with threshold
- Test: "file_pattern" matches changed file
- Test: "file_pattern" with invalid regex fails open (returns true)

**detectRepoDomain:**
- Mock `fs.readdir` to return different file lists
- Test: Swift + xcodeproj files → "mobile"
- Test: tsx + next.config files → "frontend"
- Test: go.mod + migrations/ → "backend"
- Test: .tf + helm/ → "devops"
- Test: .ipynb + model/ → "ml"
- Test: mixed/generic files → "default"

**getPresetSections:**
- Test: each preset name returns the expected number of sections
- Test: unknown preset returns default sections

**resolveTemplate:**
- Mock `findRepoTemplate` and `detectRepoDomain`
- Test: repo template found → source is "repo"
- Test: preset configured → source is "preset"
- Test: auto-detected mobile → source is "auto-detected"
- Test: no signals → source is "default"

#### `test/tools/get-pr-template.test.ts`

- Mock `template.ts` functions and `git.ts` functions
- Test: returns resolved template with sections
- Test: evaluates conditions and sets willAppear correctly
- Test: handles missing repoPath gracefully

#### Updates to `test/tools/generate-pr.test.ts`

- Add test: uses resolved template sections instead of config.pr.sections
- Add test: conditional sections are filtered by evaluateCondition
- Add test: templatePreset input overrides config
- Add test: result includes templateSource and detectedDomain
- Add test: checklist autoPopulate generates checklist content
- Add test: change_type autoPopulate generates checkbox list

#### Updates to `test/tools/generate-pr-description.test.ts`

- Same tests as generate-pr but for the description-only tool

**Mock patterns** -- for `template.ts` functions:
```typescript
vi.mock("../../src/utils/template.js", () => ({
  resolveTemplate: vi.fn(),
  evaluateCondition: vi.fn(),
  generateChecklist: vi.fn(),
  inferChangeType: vi.fn(),
}));
```

For `fs/promises` in template.test.ts:
```typescript
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));
```

---

### Task 9: Validate

Run the full validation suite in this order:
```bash
npm run typecheck
npm run test:run
npm run build
npm run lint
```

Fix any issues. Common problems:
- Missing `.js` extensions on imports from `template.ts`
- Type mismatches with the new `condition` field (it's optional)
- The `pr` config merge in `loader.ts` overwriting env var changes
- Mock setup order (vi.mock must come before imports)

---

## Critical Constraints

1. **All imports must use `.js` extensions** -- this is ESM. `import { foo } from "./utils/template.js"` not `"./utils/template"`
2. **Tool handlers never throw** -- return `{ success: false, errors: [...] }` or handle errors gracefully
3. **Config is passed as parameter** -- never import `getConfig()` in tool files
4. **Mock all git/fs operations in tests** -- never run real git commands or touch the real filesystem
5. **The `generateSectionContent` function is duplicated** in `generate-pr.ts` and `generate-pr-description.ts`. Extract it to a shared location (recommendation: `template.ts`) to avoid maintaining the same logic in three places
6. **Domain auto-detection must be fast** -- scan at most 2-3 directory levels, skip node_modules/.git/vendor, cap at ~500 files
7. **File pattern conditions use regex** -- wrap `new RegExp()` in try/catch and fail-open on invalid patterns
8. **The security model is read-only** -- you are ONLY reading files from the repo, never writing. Use `fs.readFile` and `fs.readdir` only.
9. **`fs.readdir` with `{ recursive: true }` requires Node 18.17+** -- since the project targets Node 18, either use recursive readdir with a fallback, or manually recurse 2 levels. The safer approach is manual recursion.

---

## Summary of New/Modified Files

| File | Action |
|---|---|
| `src/config/schema.ts` | Modify -- add condition, placeholder, format, template config, new defaults |
| `src/config/loader.ts` | Modify -- add PR_TEMPLATE_PRESET, PR_DETECT_REPO_TEMPLATE, fix pr merge |
| `src/utils/template.ts` | **Create** -- findRepoTemplate, parseTemplateToSections, evaluateCondition, detectRepoDomain, getPresetSections, resolveTemplate, generateChecklist, inferChangeType |
| `src/tools/get-pr-template.ts` | **Create** -- new MCP tool |
| `src/tools/generate-pr.ts` | Modify -- use resolveTemplate, evaluate conditions, new autoPopulate types |
| `src/tools/generate-pr-description.ts` | Modify -- same as generate-pr |
| `src/index.ts` | Modify -- register get_pr_template tool |
| `test/utils/template.test.ts` | **Create** -- tests for all template.ts functions |
| `test/tools/get-pr-template.test.ts` | **Create** -- tests for the new tool |
| `test/tools/generate-pr.test.ts` | Modify -- add tests for template resolution, conditions, presets |
| `test/tools/generate-pr-description.test.ts` | Modify -- same |
