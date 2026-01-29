# pr-narrator-mcp

[![npm version](https://img.shields.io/npm/v/pr-narrator-mcp.svg)](https://www.npmjs.com/package/pr-narrator-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

> 🎯 Generate consistent commit messages and PR content based on your custom criteria — automatically.

An MCP (Model Context Protocol) server that eliminates the hassle of vetting AI-generated commit messages and PR descriptions. Define your rules once, get perfectly formatted git documentation every time.

## ✨ Features

- 📝 **Commit Message Generation** - Creates messages following your configured format (Conventional Commits, simple, etc.)
- 🎫 **Automatic Ticket Extraction** - Extracts ticket numbers from branch names (e.g., `feature/WTHRAPP-1234-add-login`)
- 🏷️ **Smart Prefix Fallback** - Uses branch prefix (`task/`, `bug/`, `feature/`) when no ticket is found
- ✅ **Configurable Rules** - Enforce imperative mood, capitalization, no trailing periods, max length
- 📊 **Git Analysis** - Provides context about staged changes and branch history
- 🔌 **Optional Integrations** - Connect with GitHub, Jira, and other MCPs for enhanced functionality

## 🚀 Quick Start

### Installation

```bash
npm install -g pr-narrator-mcp
```

Or run directly with npx:

```bash
npx pr-narrator-mcp
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"]
    }
  }
}
```

### Cursor Configuration

Add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["-y", "pr-narrator-mcp"]
    }
  }
}
```

### VS Code Configuration

Add to your VS Code settings or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "pr-narrator": {
        "command": "npx",
        "args": ["-y", "pr-narrator-mcp"]
      }
    }
  }
}
```

## 🛠️ Available Tools

### Commit Tools

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `generate_commit_message` | Generate commit message from staged changes | `summary`, `type`, `scope` |
| `validate_commit_message` | Validate message against configured rules | `message` |

### PR Tools

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `generate_pr` | Generate complete PR (title + description) | `summary`, `testPlan` |
| `generate_pr_title` | Generate just the PR title | `summary` |
| `generate_pr_description` | Generate PR description with sections | `summary`, `testPlan` |

### Utility Tools

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `get_config` | Get current pr-narrator configuration | `repoPath` |
| `analyze_git_changes` | Analyze staged changes and branch info | `repoPath`, `includeFullDiff` |
| `extract_tickets` | Find tickets in branch/commits | `includeCommits`, `additionalText` |

### Example: Generate Commit Message

```typescript
const result = await generate_commit_message({
  summary: "Add user authentication flow",
  type: "feat",
  scope: "auth"
});

// Output:
// {
//   title: "WTHRAPP-1234: feat(auth): Add user authentication flow",
//   context: { ticket: "WTHRAPP-1234", type: "feat", scope: "auth" },
//   validation: { valid: true, warnings: [] }
// }
```

### Example: Generate PR

```typescript
const result = await generate_pr({
  summary: "Implements OAuth authentication with token refresh"
});

// Output:
// {
//   title: "[WTHRAPP-1234] Add User Authentication",
//   description: "## Summary\n\nImplements OAuth...\n\n## Changes\n\n- feat(auth): Add OAuth...",
//   context: { ticket: "WTHRAPP-1234", commitCount: 3 }
// }
```

## ⚙️ Configuration

Create a `pr-narrator.config.json` in your project root (optional — sensible defaults are used if not present):

```json
{
  "commit": {
    "format": "conventional",
    "maxTitleLength": 72,
    "prefix": {
      "enabled": true,
      "ticketFormat": "{ticket}: ",
      "branchFallback": true
    },
    "rules": {
      "imperativeMood": true,
      "capitalizeTitle": true,
      "noTrailingPeriod": true
    }
  },
  "pr": {
    "title": {
      "prefix": {
        "enabled": true,
        "ticketFormat": "[{ticket}] ",
        "branchFallback": true
      }
    },
    "sections": [
      { "name": "Summary", "required": true },
      { "name": "Changes", "required": true, "autoPopulate": "commits" },
      { "name": "Tickets", "required": false, "autoPopulate": "extracted" },
      { "name": "Test Plan", "required": false }
    ]
  },
  "ticketPattern": "WTHRAPP-\\d+",
  "ticketLinkFormat": "https://jira.example.com/browse/{ticket}",
  "baseBranch": "develop"
}
```

### Configuration Reference

#### Commit Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | string | `"conventional"` | Format: `conventional`, `simple`, `gitmoji`, `angular` |
| `maxTitleLength` | number | `72` | Maximum title length |
| `requireScope` | boolean | `false` | Require scope in conventional commits |
| `scopes` | string[] | `[]` | Allowed scopes (empty = any) |
| `prefix.enabled` | boolean | `true` | Enable/disable prefix |
| `prefix.ticketFormat` | string | `"{ticket}: "` | Format when ticket found |
| `prefix.branchFallback` | boolean | `true` | Use branch prefix as fallback |

#### PR Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title.prefix.enabled` | boolean | `true` | Enable prefix in PR title |
| `title.prefix.ticketFormat` | string | `"[{ticket}] "` | PR title prefix format |
| `sections` | array | See above | PR description sections |

#### Global Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ticketPattern` | string | — | Regex to match ticket numbers |
| `ticketLinkFormat` | string | — | URL template for ticket links |
| `baseBranch` | string | `"main"` | Base branch for PR comparisons |

## 🏷️ Prefix Examples

| Branch | Result |
|--------|--------|
| `feature/WTHRAPP-1234-add-login` | `WTHRAPP-1234: ` (commit) / `[WTHRAPP-1234] ` (PR) |
| `task/update-readme` | `Task: ` (from branch prefix) |
| `bug/fix-crash` | `Bug: ` (from branch prefix) |
| `main` | (no prefix) |

## 🔌 Optional Integrations

pr-narrator-mcp can orchestrate with other MCPs you have configured:

```json
{
  "integrations": {
    "vcs": {
      "provider": "github",
      "mcpServer": "user-github"
    },
    "ticketing": {
      "provider": "jira",
      "mcpServer": "user-jira"
    }
  }
}
```

When configured, tools return `suggestedActions` that the AI can execute using your other MCPs to:
- Create PRs directly via GitHub MCP
- Fetch ticket details from Jira MCP
- Auto-populate PR descriptions with ticket context

## 🔧 Troubleshooting

### Server not starting

**Problem**: The MCP server doesn't appear in your IDE's tool list.

**Solutions**:
1. Ensure Node.js 18+ is installed: `node --version`
2. Try running directly to see errors: `npx pr-narrator-mcp`
3. Check your MCP configuration file path is correct
4. Restart your IDE after configuration changes

### "Not a git repository" error

**Problem**: Tools return "Not a git repository" error.

**Solutions**:
1. Ensure you're in a git repository: `git status`
2. Check the `repoPath` parameter points to a valid git repo
3. Initialize git if needed: `git init`

### No staged changes found

**Problem**: `generate_commit_message` says no staged changes.

**Solutions**:
1. Stage your changes first: `git add <files>` or `git add .`
2. Verify staged files: `git status`

### Ticket not extracted from branch

**Problem**: Ticket prefix isn't being added to commits/PRs.

**Solutions**:
1. Check your `ticketPattern` regex in config matches your ticket format
2. Ensure branch name contains the ticket: `git branch --show-current`
3. Test your regex: `echo "feature/PROJ-123-test" | grep -oE "PROJ-\d+"`

### Configuration not loading

**Problem**: Custom config settings aren't being applied.

**Solutions**:
1. Verify config file name is one of: `pr-narrator.config.json`, `.pr-narrator.json`, `.prnarratorrc.json`
2. Check JSON syntax: `cat pr-narrator.config.json | jq .`
3. Use `get_config` tool to see what config is loaded
4. Config is searched from repo path upward to filesystem root

### Diff too large / truncated

**Problem**: Large diffs are being truncated.

**Explanation**: Diffs over 500KB are automatically truncated to prevent memory issues. This is by design.

**Solutions**:
1. For full diff, use `git diff` directly in terminal
2. Break large changes into smaller commits
3. The truncation message indicates the original size

### Base branch not found

**Problem**: PR generation fails with branch comparison errors.

**Solutions**:
1. Check `baseBranch` in config matches your actual base branch (e.g., `main`, `develop`, `master`)
2. Ensure the base branch exists locally: `git branch -a`
3. Fetch remote branches: `git fetch origin`

### Common Configuration Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Empty prefix | `prefix.enabled: false` or no ticket/branch prefix | Set `prefix.enabled: true` |
| Wrong commit format | `format` not matching team standard | Use `conventional`, `simple`, `gitmoji`, or `angular` |
| Scope validation failing | Scope not in `scopes` array | Add scope to allowed list or remove `scopes` restriction |
| PR sections missing | Custom `sections` array overrides defaults | Include all desired sections in config |

### Getting Help

If you're still having issues:
1. Run `get_config` tool to verify your configuration
2. Run `analyze_git_changes` to see what the server detects
3. Check the [GitHub Issues](https://github.com/mhaviv/pr-narrator-mcp/issues) for similar problems
4. Open a new issue with your config and error messages

## 🧪 Development

```bash
# Clone the repository
git clone https://github.com/mhaviv/pr-narrator-mcp.git
cd pr-narrator-mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using pr-narrator-mcp 😉
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**[Report Bug](https://github.com/mhaviv/pr-narrator-mcp/issues)** · **[Request Feature](https://github.com/mhaviv/pr-narrator-mcp/issues)**

</div>
