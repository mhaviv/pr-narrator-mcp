# pr-narrator-mcp

<p align="center">
  <img src="https://raw.githubusercontent.com/mhaviv/pr-narrator-mcp/main/assets/social-preview.png" alt="PR Narrator — AI-powered commit messages & PR descriptions" width="100%" />
</p>

[![npm version](https://img.shields.io/npm/v/pr-narrator-mcp.svg)](https://www.npmjs.com/package/pr-narrator-mcp)
[![CI](https://github.com/mhaviv/pr-narrator-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mhaviv/pr-narrator-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Generate consistent commit messages and PR content automatically.

An MCP server that generates commit messages and PR descriptions based on your git changes. It auto-detects your repo's domain (mobile, frontend, backend, devops, security, ML) and applies the right PR template — no config needed.

## Install

```bash
npx pr-narrator-mcp
```

## Quick Start

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"],
      "env": {
        "BASE_BRANCH": "develop",
        "TICKET_PATTERN": "[A-Z]+-\\d+"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"],
      "env": {
        "BASE_BRANCH": "develop",
        "TICKET_PATTERN": "[A-Z]+-\\d+"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"],
      "env": {
        "BASE_BRANCH": "develop",
        "TICKET_PATTERN": "[A-Z]+-\\d+"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"],
      "env": {
        "BASE_BRANCH": "develop",
        "TICKET_PATTERN": "[A-Z]+-\\d+"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP client that supports stdio transport can use this server. The command is:

```bash
npx -y pr-narrator-mcp
```

That's it! No config files needed. All env vars are optional.

## Settings

All settings are optional env vars in MCP JSON:

| Env Var | What it does | Example |
|---------|--------------|---------|
| `BASE_BRANCH` | Base branch for PRs | `develop` |
| `TICKET_PATTERN` | Ticket regex | `[A-Z]+-\\d+` |
| `TICKET_LINK` | Ticket URL template | `https://jira.example.com/browse/{ticket}` |
| `PREFIX_STYLE` | Prefix format | `capitalized` or `bracketed` |
| `DEFAULT_REPO_PATH` | Fallback repo path (single-repo workflows) | `/Users/me/my-project` |
| `PR_TEMPLATE_PRESET` | Force a PR template preset | `mobile`, `backend`, `devops` |
| `PR_DETECT_REPO_TEMPLATE` | Enable/disable repo template detection | `true` (default) or `false` |

If `BASE_BRANCH` is not set, it auto-detects from the repo (main, master, develop).

**Note on `repoPath`:** All tools accept a `repoPath` parameter. The AI calling the tool should pass the user's current workspace directory. `DEFAULT_REPO_PATH` is only a fallback for single-repo workflows.

## Tools

### PR Generation

#### generate_pr
Generate a complete PR with title, description, and context for AI enhancement. Automatically resolves the best template for the repo (see [PR Templates](#pr-templates)).

Returns:
- `title` — PR title (placeholder derived from branch/commits — AI should rewrite)
- `description` — PR description with sections from the resolved template
- `purposeContext` — ALL commit titles, ALL commit bullets, test info, file count
- `purposeGuidelines` — Instructions for AI to rewrite title and Purpose from ALL data

**Important:** Both the title and Purpose are placeholders. The AI must read ALL `purposeContext.commitTitles` and `purposeContext.commitBullets` to synthesize a title and description that reflects the full scope of changes.

Optional `templatePreset` parameter to force a specific template (e.g., `mobile`, `backend`).

#### generate_pr_title
Generate a PR title based on branch info and commits.

#### generate_pr_description
Generate a PR description with auto-populated sections. Same template resolution as `generate_pr` but returns only the description. Accepts optional `templatePreset` and `summary` parameters.

#### get_pr_template
Preview the resolved PR template for a repo before generating. Shows which sections will appear based on the repo's template file, domain auto-detection, or configured preset. Useful for understanding what a PR will look like before calling `generate_pr`.

Returns the template source (`repo`, `preset`, `auto-detected`, or `default`), detected domain, and each section's visibility based on current branch changes.

### Commit Messages

#### generate_commit_message
Prepare commit message context from staged or unstaged changes.

If nothing is staged, the tool automatically falls back to unstaged working tree changes and provides staging instructions — no need to run `git add` first just to analyze your changes. The response includes a `source` field (`"staged"` or `"unstaged"`) and a `hint` with the exact `git add` command to run.

When `includeBody` is true, the actual diff is provided so the AI can write a meaningful body that describes *what changed* functionally — not just file type counts.

Two modes:
- **With `summary` param (recommended):** Returns a ready-to-use commit message with proper prefix/formatting. Add `includeBody: true` to get diff-based body generation.
- **Without `summary`:** Returns placeholder title + diff + guidelines for AI to compose the message and body

#### validate_commit_message
Check a commit message against configured rules (length, format, capitalization, imperative mood).

### Repository Analysis

#### analyze_git_changes
Analyze the current repository state: staged changes, branch info, working tree status, and file categorization.

#### extract_tickets
Find ticket numbers in the branch name and commit messages using the configured `TICKET_PATTERN`.

#### get_config
See current settings and their resolved values.

## Prefix Examples

| Branch | Commit/PR Prefix |
|--------|------------------|
| `feature/PROJ-123-add-login` | `PROJ-123: ` |
| `task/update-readme` | `Task: ` |
| `bug/fix-crash` | `Bug: ` |
| `main` | (no prefix) |

## PR Templates

PR Narrator automatically selects the best template for each repository through a resolution pipeline:

1. **Repo template** — if a `PULL_REQUEST_TEMPLATE.md` exists in the repo (`.github/`, root, or `docs/`), it's parsed into sections
2. **Explicit preset** — if `PR_TEMPLATE_PRESET` is set or `templatePreset` is passed to a tool
3. **Auto-detected domain** — the repo's file tree is scanned and scored to detect its domain
4. **Default** — a universal 6-section template

This means switching between repos (iOS app, Express API, Terraform infra) automatically uses the right template with zero configuration.

### Domain Auto-Detection

PR Narrator scans the top 3 levels of the repo file tree and scores files against domain signal patterns. The domain with the highest score wins, as long as it reaches a minimum threshold.

| Domain | Key Signals | Sections Added |
|--------|-------------|----------------|
| **mobile** | `.swift`, `.kt`, `.xcodeproj`, `AndroidManifest.xml` | Screenshots, Device Testing, Accessibility |
| **frontend** | `.tsx`, `.vue`, `next.config`, `vite.config` | Screenshots / Visual Changes, Browser Compatibility, Accessibility |
| **backend** | `.go`, `.rs`, `migrations/`, `prisma/schema` | API Changes, Database / Migration, Breaking Changes |
| **devops** | `.tf`, `helm/`, `k8s/`, `Dockerfile` | Infrastructure Impact, Affected Environments, Rollback Plan |
| **security** | `.snyk`, `tfsec`, `trivy` | Security Impact, Threat Model Changes |
| **ml** | `.ipynb`, `model/`, `training/`, `dvc.yaml` | Model Changes, Dataset Changes, Metrics / Evaluation |

### Available Presets

| Preset | Sections | Best For |
|--------|----------|----------|
| `default` | 6 | General-purpose repos |
| `minimal` | 2 | Quick PRs (Purpose + Test Plan) |
| `detailed` | 10 | Thorough reviews with screenshots, breaking changes, deployment notes |
| `mobile` | 8 | iOS and Android apps |
| `frontend` | 8 | Web apps (React, Vue, Svelte, etc.) |
| `backend` | 8 | APIs and services |
| `devops` | 8 | Infrastructure and CI/CD |
| `security` | 7 | Security-focused changes |
| `ml` | 8 | Machine learning and data science |

### Conditional Sections

Sections can appear or hide based on context:

- **`has_tickets`** — Ticket section only appears when tickets are found in the branch name or commits
- **`file_pattern`** — Screenshots section only appears when UI files are changed; Database section only when migration files are changed
- **`commit_count_gt`** — Changes (commit list) section only appears when there's more than 1 commit

### Repo Template Detection

If your repo has a `PULL_REQUEST_TEMPLATE.md`, PR Narrator will find and parse it automatically. Supported locations:

- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE/` (picks `default.md` first)
- `pull_request_template.md` (repo root)
- `docs/pull_request_template.md`

File names are matched case-insensitively. Both `.md` and `.txt` extensions are supported.

Set `PR_DETECT_REPO_TEMPLATE=false` to skip repo template detection and use presets or auto-detection instead.

## Security

This MCP server is **read-only** and **local-only** (stdio transport). It never modifies your git repository, makes network requests, or handles authentication tokens.

**Things to be aware of:**

- **Diffs may contain secrets.** Staged changes and branch diffs are sent to the AI for analysis. If your commits contain API keys or passwords, these will be visible to the model. Use [git-secrets](https://github.com/awslabs/git-secrets) or [gitleaks](https://github.com/gitleaks/gitleaks) to prevent committing sensitive data.
- **Commit messages are untrusted input.** Git commit messages from collaborators are passed to the AI. Adversarial commit messages could theoretically attempt prompt injection. The read-only nature of this MCP limits impact.
- **Regex patterns are validated.** The `TICKET_PATTERN` env var is checked for ReDoS safety (catastrophic backtracking, length limits) before use.

For full details, see [SECURITY.md](SECURITY.md).

## Development

```bash
git clone https://github.com/mhaviv/pr-narrator-mcp.git
cd pr-narrator-mcp
npm install
npm run build
npm test
```

## License

MIT
