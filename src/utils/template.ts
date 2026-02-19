import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import type { Config, PrSection, SectionCondition } from "../config/schema.js";
import { inferCommitType, generatePurposeSummary } from "./formatters.js";

export interface ResolvedTemplate {
  sections: PrSection[];
  source: "repo" | "preset" | "auto-detected" | "default";
  detectedDomain: string | null;
  repoTemplatePath: string | null;
  rawTemplate: string | null;
}

// ---------------------------------------------------------------------------
// Repo template detection
// ---------------------------------------------------------------------------

const TEMPLATE_CANDIDATES = [
  ".github/pull_request_template.md",
  ".github/pull_request_template.txt",
  ".github/pull_request_template",
  "pull_request_template.md",
  "pull_request_template.txt",
  "pull_request_template",
  "docs/pull_request_template.md",
  "docs/pull_request_template.txt",
  "docs/pull_request_template",
];

const TEMPLATE_DIR_PARENTS = [".github", "", "docs"];

function isTemplateFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".txt");
}

async function findFileInsensitive(dir: string, target: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    const match = entries.find((e) => e.toLowerCase() === target.toLowerCase());
    return match ? join(dir, match) : null;
  } catch {
    return null;
  }
}

export interface FoundTemplate {
  content: string;
  filePath: string;
}

export async function findRepoTemplate(repoPath: string): Promise<FoundTemplate | null> {
  // 1. Check individual file candidates (.md, .txt, extensionless)
  for (const candidate of TEMPLATE_CANDIDATES) {
    const parts = candidate.split("/");
    let dir = repoPath;
    let resolved = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const found = await findFileInsensitive(dir, parts[i]);
      if (!found) {
        resolved = false;
        break;
      }
      dir = found;
    }
    if (!resolved) continue;
    const filePath = await findFileInsensitive(dir, parts[parts.length - 1]);
    if (filePath) {
      try {
        const content = await readFile(filePath, "utf-8");
        return { content, filePath };
      } catch {
        continue;
      }
    }
  }

  // 2. Check PULL_REQUEST_TEMPLATE/ directories under .github/, root, and docs/
  for (const parent of TEMPLATE_DIR_PARENTS) {
    try {
      const parentDir = parent
        ? await findFileInsensitive(repoPath, parent)
        : repoPath;
      if (!parentDir) continue;

      const tmplDir = await findFileInsensitive(parentDir, "PULL_REQUEST_TEMPLATE");
      if (!tmplDir) continue;

      const entries = await readdir(tmplDir);
      const templateFile = entries.find((e) => isTemplateFile(e));
      if (templateFile) {
        const filePath = join(tmplDir, templateFile);
        const content = await readFile(filePath, "utf-8");
        return { content, filePath };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Template parsing
// ---------------------------------------------------------------------------

const AUTO_POPULATE_KEYWORDS: Array<{ keywords: string[]; value: NonNullable<PrSection["autoPopulate"]> }> = [
  { keywords: ["summary", "description", "purpose", "what", "overview", "about", "context"], value: "purpose" },
  { keywords: ["ticket", "issue", "related", "jira", "linear", "reference"], value: "extracted" },
  { keywords: ["checklist", "review checklist", "pr checklist"], value: "checklist" },
  { keywords: ["type of change", "change type", "category"], value: "change_type" },
  { keywords: ["commits", "changelog", "changes", "what changed"], value: "commits" },
  { keywords: ["test", "testing", "qa", "verification", "how to test"], value: "none" },
];

function mapSectionName(name: string): NonNullable<PrSection["autoPopulate"]> {
  const lower = name.toLowerCase();
  for (const { keywords, value } of AUTO_POPULATE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return value;
    }
  }
  return "none";
}

export function parseTemplateToSections(markdown: string): PrSection[] {
  const lines = markdown.split("\n");
  const sections: PrSection[] = [];
  let currentName: string | null = null;
  let bodyLines: string[] = [];

  function flush() {
    if (currentName) {
      const body = bodyLines.join("\n").trim();
      const autoPopulate = mapSectionName(currentName);
      sections.push({
        name: currentName,
        required: false,
        autoPopulate,
        condition: { type: "always" },
        placeholder: body || undefined,
        format: autoPopulate === "checklist" ? "checklist" : "markdown",
      });
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      flush();
      currentName = headerMatch[1].trim();
      bodyLines = [];
    } else if (currentName) {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

export function evaluateCondition(
  condition: SectionCondition | undefined,
  changedFiles: string[],
  tickets: string[],
  commitCount: number
): boolean {
  if (!condition || condition.type === "always") return true;
  if (condition.type === "never") return false;
  if (condition.type === "has_tickets") return tickets.length > 0;
  if (condition.type === "commit_count_gt") return commitCount > (condition.threshold ?? 0);
  if (condition.type === "file_pattern") {
    if (!condition.pattern) return true;
    try {
      const re = new RegExp(condition.pattern, "i");
      return changedFiles.some((f) => re.test(f));
    } catch {
      return true; // fail-open
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Domain detection
// ---------------------------------------------------------------------------

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

const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "venv", ".venv", "__pycache__", "dist", "build"]);
const MAX_FILES = 500;

async function collectFiles(basePath: string, maxDepth: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= MAX_FILES) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        const rel = relative(basePath, full);
        results.push(rel);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        }
      }
    } catch {
      // Permission denied or similar — skip
    }
  }

  await walk(basePath, 0);
  return results;
}

export async function detectRepoDomain(repoPath: string): Promise<string> {
  const files = await collectFiles(repoPath, 2);
  const scores: Record<string, number> = {};

  for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
    let score = 0;
    for (const file of files) {
      for (const { pattern, weight } of signals) {
        if (pattern.test(file)) {
          score += weight;
        }
      }
    }
    scores[domain] = score;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return "default";

  const [topDomain, topScore] = sorted[0];
  const secondScore = sorted.length > 1 ? sorted[1][1] : 0;

  if (topScore >= 3 && topScore >= secondScore * 2) {
    return topDomain;
  }

  return "default";
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const PRESETS: Record<string, PrSection[]> = {
  default: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "commit_count_gt", threshold: 1 }, format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  minimal: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
  ],
  detailed: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Changes", required: false, autoPopulate: "commits", condition: { type: "always" }, format: "markdown" },
    { name: "Screenshots", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less|tsx|jsx|vue|svelte|html|storyboard|xib)$" }, placeholder: "_[Add screenshots if applicable]_", format: "markdown" },
    { name: "Breaking Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "api/|routes?/|controller|schema|migration|swagger|openapi" }, placeholder: "_[Describe any breaking changes and migration path]_", format: "markdown" },
    { name: "Performance Impact", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe any performance implications]_", format: "markdown" },
    { name: "Deployment Notes", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Any special deployment steps or considerations]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  mobile: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Screenshots", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(swift|kt|storyboard|xib|xml)$|view|screen|ui|component|activity|fragment|composable" }, placeholder: "_[Add before/after screenshots for UI changes]_", format: "markdown" },
    { name: "Device Testing", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "Tested on:\n- [ ] iPhone (model)\n- [ ] iPad (model)\n- [ ] Android phone (model)\n- [ ] Android tablet (model)\n- [ ] Simulator/Emulator", format: "markdown" },
    { name: "Accessibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "view|screen|ui|component|controller|activity|fragment|composable|accessibility" }, placeholder: "_[Describe accessibility impact of UI changes]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  frontend: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Screenshots / Visual Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less|tsx|jsx|vue|svelte|html)$|component|page|layout|style" }, placeholder: "_[Add before/after screenshots for visual changes]_", format: "markdown" },
    { name: "Browser Compatibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(css|scss|less)$|polyfill|compat|browserslist" }, placeholder: "Tested in:\n- [ ] Chrome\n- [ ] Firefox\n- [ ] Safari\n- [ ] Edge\n- [ ] Mobile browsers", format: "markdown" },
    { name: "Accessibility", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "\\.(tsx|jsx|vue|svelte|html)$|a11y|accessibility|aria|component" }, placeholder: "_[Describe accessibility considerations]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  backend: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "API Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "routes?/|controllers?/|handlers?/|endpoints?/|resolvers?/|api/|swagger|openapi|\\.graphql$" }, placeholder: "_[Describe API endpoint changes, new/modified/removed endpoints]_", format: "markdown" },
    { name: "Database / Migration", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "migrations?/|schema|\\.(sql)$|prisma|knex|typeorm|alembic|sequelize" }, placeholder: "_[Describe schema changes, migration steps, rollback plan]_", format: "markdown" },
    { name: "Breaking Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "api/|routes?/|controllers?/|schema|migration|swagger|openapi" }, placeholder: "_[Describe impact on existing clients and migration path]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you tested these changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  devops: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Infrastructure Impact", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe what infrastructure is affected and how]_", format: "markdown" },
    { name: "Affected Environments", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "- [ ] Development\n- [ ] Staging\n- [ ] Production", format: "markdown" },
    { name: "Rollback Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how to safely rollback these changes]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe how you validated these infrastructure changes]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  security: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Security Impact", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe the security implications of this change]_", format: "markdown" },
    { name: "Threat Model Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "auth|security|crypto|token|session|password|permission|rbac|oauth|saml|cert|ssl|tls" }, placeholder: "_[Describe changes to attack surface, trust boundaries, or authentication/authorization]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe security testing performed]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
  ml: [
    { name: "Purpose", required: true, autoPopulate: "purpose", condition: { type: "always" }, format: "markdown" },
    { name: "Ticket", required: false, autoPopulate: "extracted", condition: { type: "has_tickets" }, format: "markdown" },
    { name: "Type of Change", required: false, autoPopulate: "change_type", condition: { type: "always" }, format: "markdown" },
    { name: "Model Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "model|train|weights|checkpoint|\\.(h5|pkl|onnx|pt|pth|safetensors)$" }, placeholder: "_[Describe architecture, hyperparameter, or training changes]_", format: "markdown" },
    { name: "Dataset Changes", required: false, autoPopulate: "none", condition: { type: "file_pattern", pattern: "dataset|data/|pipeline|preprocess|feature|etl" }, placeholder: "_[Describe changes to data sources, preprocessing, or feature engineering]_", format: "markdown" },
    { name: "Metrics / Evaluation", required: false, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Before/after metrics comparison. Include evaluation methodology.]_", format: "markdown" },
    { name: "Test Plan", required: true, autoPopulate: "none", condition: { type: "always" }, placeholder: "_[Describe validation and testing approach]_", format: "markdown" },
    { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist", condition: { type: "always" } },
  ],
};

export function getPresetSections(preset: string): PrSection[] {
  return PRESETS[preset] ?? PRESETS["default"];
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export async function resolveTemplate(
  repoPath: string,
  config: Config
): Promise<ResolvedTemplate> {
  const tmplConfig = config.pr.template;

  // 1. Repo template
  if (tmplConfig.detectRepoTemplate) {
    const found = await findRepoTemplate(repoPath);
    if (found) {
      return {
        sections: parseTemplateToSections(found.content),
        source: "repo",
        detectedDomain: null,
        repoTemplatePath: found.filePath,
        rawTemplate: found.content,
      };
    }
  }

  // 2. Explicit preset
  if (tmplConfig.preset) {
    return {
      sections: getPresetSections(tmplConfig.preset),
      source: "preset",
      detectedDomain: tmplConfig.preset,
      repoTemplatePath: null,
      rawTemplate: null,
    };
  }

  // 3. Auto-detect domain
  const domain = await detectRepoDomain(repoPath);
  if (domain !== "default") {
    return {
      sections: getPresetSections(domain),
      source: "auto-detected",
      detectedDomain: domain,
      repoTemplatePath: null,
      rawTemplate: null,
    };
  }

  // 4. Default
  return {
    sections: getPresetSections("default"),
    source: "default",
    detectedDomain: null,
    repoTemplatePath: null,
    rawTemplate: null,
  };
}

// ---------------------------------------------------------------------------
// autoPopulate helpers
// ---------------------------------------------------------------------------

export function generateChecklist(
  files: Array<{ path: string }>,
  _commits: Array<{ hash: string; message: string }>,
  domain?: string
): string {
  const lines: string[] = [
    "- [ ] Code has been self-reviewed",
    "- [ ] Changes have been tested locally",
    "- [ ] Tests have been added or updated",
    "- [ ] No new warnings or errors introduced",
  ];

  const paths = files.map((f) => f.path);

  if (paths.some((p) => /\.md$|readme/i.test(p))) {
    lines.push("- [ ] Documentation is accurate and complete");
  }
  if (paths.some((p) => /api\/|routes?\/|controllers?\//i.test(p))) {
    lines.push("- [ ] API changes are backward compatible");
  }
  if (paths.some((p) => /migrations?\/|schema/i.test(p))) {
    lines.push("- [ ] Database migration is reversible");
  }
  if (paths.some((p) => /\.(tsx|jsx|vue|svelte|css|scss|html|storyboard|xib)$/i.test(p))) {
    lines.push("- [ ] UI changes match design specs");
  }
  if (paths.some((p) => /config|\.env/i.test(p))) {
    lines.push("- [ ] Environment variables documented");
  }
  if (paths.some((p) => /package\.json|Gemfile|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle/i.test(p))) {
    lines.push("- [ ] Dependencies reviewed for security");
  }

  // Domain-specific items
  if (domain === "mobile") {
    lines.push(
      "- [ ] No hardcoded strings (localization ready)",
      "- [ ] Supports Dynamic Type / font scaling",
      "- [ ] Works in both portrait and landscape",
    );
  } else if (domain === "frontend") {
    lines.push(
      "- [ ] Responsive across breakpoints",
      "- [ ] Keyboard navigable",
      "- [ ] No console errors in browser",
    );
  } else if (domain === "backend") {
    lines.push(
      "- [ ] No N+1 queries introduced",
      "- [ ] Error handling covers edge cases",
      "- [ ] API is backward compatible",
    );
  } else if (domain === "devops") {
    lines.push(
      "- [ ] Terraform plan output reviewed",
      "- [ ] No secrets or credentials in code",
      "- [ ] Monitoring and alerts configured",
    );
  } else if (domain === "security") {
    lines.push(
      "- [ ] Input validation on all user inputs",
      "- [ ] No hardcoded secrets or credentials",
      "- [ ] Principle of least privilege followed",
      "- [ ] OWASP Top 10 risks considered",
    );
  } else if (domain === "ml") {
    lines.push(
      "- [ ] Model outputs validated against expected ranges",
      "- [ ] No data leakage between train/test sets",
      "- [ ] Results are reproducible with fixed seed",
    );
  }

  return lines.join("\n");
}

const BRANCH_PREFIX_TO_CHANGE_TYPE: Record<string, string> = {
  bug: "Bug fix",
  fix: "Bug fix",
  hotfix: "Bug fix",
  feature: "New feature",
  feat: "New feature",
  refactor: "Refactoring",
  docs: "Documentation update",
  test: "Test",
  chore: "Chore / maintenance",
  build: "Chore / maintenance",
  ci: "Chore / maintenance",
  perf: "Performance improvement",
  style: "Code style",
};

const COMMIT_TYPE_TO_CHANGE_TYPE: Record<string, string> = {
  fix: "Bug fix",
  feat: "New feature",
  test: "Test",
  docs: "Documentation update",
  ci: "Configuration change",
  build: "Configuration change",
  chore: "Chore / maintenance",
  style: "Code style",
};

const CHANGE_TYPE_OPTIONS = [
  { label: "Bug fix (non-breaking change that fixes an issue)", key: "Bug fix" },
  { label: "New feature (non-breaking change that adds functionality)", key: "New feature" },
  { label: "Refactoring (no functional changes)", key: "Refactoring" },
  { label: "Breaking change (fix or feature that would cause existing functionality to change)", key: "Breaking change" },
  { label: "Documentation update", key: "Documentation update" },
  { label: "Configuration change", key: "Configuration change" },
  { label: "Test (adding or updating tests)", key: "Test" },
  { label: "Chore / maintenance (dependency updates, cleanup)", key: "Chore / maintenance" },
  { label: "Performance improvement", key: "Performance improvement" },
  { label: "Code style (formatting, whitespace, naming)", key: "Code style" },
];

export function inferChangeType(
  branchPrefix: string | null,
  files: Array<{ path: string }>
): string {
  let matched: string | null = null;

  if (branchPrefix) {
    matched = BRANCH_PREFIX_TO_CHANGE_TYPE[branchPrefix.toLowerCase()] ?? null;
  }

  if (!matched) {
    const commitType = inferCommitType(files.map((f) => f.path));
    matched = COMMIT_TYPE_TO_CHANGE_TYPE[commitType] ?? null;
  }

  return CHANGE_TYPE_OPTIONS.map((opt) => {
    const checked = opt.key === matched ? "x" : " ";
    return `- [${checked}] ${opt.label}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Shared section content generation (extracted from generate-pr / generate-pr-description)
// ---------------------------------------------------------------------------

export interface SectionContentContext {
  commits: Array<{ hash: string; message: string }>;
  files: Array<{ path: string; additions: number; deletions: number }>;
  tickets: string[];
  ticketLinkFormat: string | undefined;
  providedContent: Record<string, string | undefined>;
  branchName: string | null;
  branchPrefix: string | null;
  domain: string | null;
}

export function generateSectionContent(
  section: PrSection,
  context: SectionContentContext
): string {
  const sectionNameLower = section.name.toLowerCase();

  const byName = context.providedContent[section.name];
  if (byName) return byName;
  const byLower = context.providedContent[sectionNameLower];
  if (byLower) return byLower;

  if (section.autoPopulate === "commits") {
    if (context.commits.length === 0) return "_No commits found_";
    return context.commits.map((c) => `- ${c.message} (${c.hash})`).join("\n");
  }

  if (section.autoPopulate === "extracted") {
    if (context.tickets.length === 0) return "";
    return context.tickets
      .map((t) => (context.ticketLinkFormat ? context.ticketLinkFormat.replace("{ticket}", t) : t))
      .join("\n");
  }

  if (section.autoPopulate === "purpose") {
    return generatePurposeSummary(context.commits, context.files, context.branchName);
  }

  if (section.autoPopulate === "checklist") {
    return generateChecklist(context.files, context.commits, context.domain ?? undefined);
  }

  if (section.autoPopulate === "change_type") {
    return inferChangeType(context.branchPrefix, context.files);
  }

  // Placeholder fallback
  if (section.placeholder) return section.placeholder;

  if (section.required) {
    return `_[Add ${section.name.toLowerCase()} here]_`;
  }

  return "";
}
