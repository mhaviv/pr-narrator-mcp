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
