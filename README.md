# pr-narrator-mcp

[![npm version](https://img.shields.io/npm/v/pr-narrator-mcp.svg)](https://www.npmjs.com/package/pr-narrator-mcp)
[![CI](https://github.com/mhaviv/pr-narrator-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mhaviv/pr-narrator-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Generate consistent commit messages and PR content automatically.

An MCP server that generates commit messages and PR descriptions based on your git changes.

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

If `BASE_BRANCH` is not set, it auto-detects from the repo (main, master, develop).

**Note on `repoPath`:** All tools accept a `repoPath` parameter. The AI calling the tool should pass the user's current workspace directory. `DEFAULT_REPO_PATH` is only a fallback for single-repo workflows.

## Tools

### generate_pr
Generate PR title and description with context for AI enhancement.

Returns:
- `title` - PR title (placeholder derived from branch/commits - AI should rewrite)
- `description` - PR description with placeholder Purpose
- `purposeContext` - ALL commit titles, ALL commit bullets, test info, file count
- `purposeGuidelines` - Instructions for AI to rewrite title and Purpose from ALL data

**Important:** Both the title and Purpose are placeholders. The AI must read ALL `purposeContext.commitTitles` and `purposeContext.commitBullets` to synthesize a title and description that reflects the full scope of changes.

PR description includes:
- **Ticket** - Link extracted from branch name (omitted if none found)
- **Purpose** - Base summary for AI to enhance

### generate_commit_message
Prepare commit message context from staged changes.

Two modes:
- **With `summary` param (recommended):** Returns a ready-to-use commit message with proper prefix/formatting
- **Without `summary`:** Returns placeholder title + diff + guidelines for AI to compose the message

### analyze_git_changes
Analyze staged changes and branch info.

### extract_tickets
Find tickets in branch name and commits.

### validate_commit_message
Check commit message against rules.

### get_config
See current settings.

## Prefix Examples

| Branch | Commit/PR Prefix |
|--------|------------------|
| `feature/PROJ-123-add-login` | `PROJ-123: ` |
| `task/update-readme` | `Task: ` |
| `bug/fix-crash` | `Bug: ` |
| `main` | (no prefix) |

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
