# pr-narrator-mcp

[![npm version](https://img.shields.io/npm/v/pr-narrator-mcp.svg)](https://www.npmjs.com/package/pr-narrator-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Generate consistent commit messages and PR content automatically.

An MCP server that generates commit messages and PR descriptions based on your git changes.

## Quick Start

Add to your MCP settings (`~/.cursor/mcp.json`):

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

That's it! No config files needed.

## Settings

All settings are optional env vars in MCP JSON:

| Env Var | What it does | Example |
|---------|--------------|---------|
| `BASE_BRANCH` | Base branch for PRs | `develop` |
| `TICKET_PATTERN` | Ticket regex | `[A-Z]+-\\d+` |
| `TICKET_LINK` | Ticket URL template | `https://jira.example.com/browse/{ticket}` |
| `PREFIX_STYLE` | Prefix format | `capitalized` or `bracketed` |

If `BASE_BRANCH` is not set, it auto-detects from the repo (main, master, develop).

## Tools

### generate_pr
Generate PR title and description with context for AI enhancement.

Returns:
- `title` - Ready-to-use PR title
- `description` - PR description with basic Purpose (commit title)
- `purposeContext` - Commit data (title, bullets, hasTests) for AI to enhance
- `purposeGuidelines` - Instructions on how to write Purpose in prose style

**Important:** The Purpose section in `description` is just the commit title. Use `purposeContext` and `purposeGuidelines` to rewrite it in prose style before creating the PR.

PR description includes:
- **Ticket** - Link extracted from branch name (omitted if none found)
- **Purpose** - Base summary for AI to enhance

### generate_commit_message
Generate commit message from staged changes.

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
