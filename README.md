# pr-narrator-mcp

An MCP (Model Context Protocol) server that generates consistent commit messages and PR content based on your custom criteria.

## Features

- **Commit Message Generation**: Creates commit messages following your configured format (Conventional Commits, simple, etc.)
- **Automatic Ticket Extraction**: Extracts ticket numbers from branch names (e.g., `feature/WTHRAPP-1234-add-login`)
- **Smart Prefix Fallback**: Uses branch prefix (task/, bug/, feature/) when no ticket is found
- **Configurable Rules**: Enforce imperative mood, capitalization, no trailing periods, max length
- **Git Analysis**: Provides context about staged changes and branch history
- **Optional Integrations**: Connect with GitHub, Jira, and other MCPs for enhanced functionality

## Installation

```bash
npm install pr-narrator-mcp
```

Or run directly with npx:

```bash
npx pr-narrator-mcp
```

## Setup in Cursor

Add to your Cursor MCP configuration (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pr-narrator": {
      "command": "npx",
      "args": ["pr-narrator-mcp"]
    }
  }
}
```

## Configuration

Create a `pr-narrator.config.json` in your project root (optional - sensible defaults are used if not present):

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
      { "name": "Tickets", "required": false, "autoPopulate": "extracted" }
    ]
  },
  "ticketPattern": "WTHRAPP-\\d+",
  "baseBranch": "develop"
}
```

### Configuration Options

#### Commit Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | string | `"conventional"` | Commit format: `conventional`, `simple`, `gitmoji`, `angular` |
| `maxTitleLength` | number | `72` | Maximum title length |
| `requireScope` | boolean | `false` | Require a scope in conventional commits |
| `scopes` | string[] | `[]` | Allowed scopes (empty = any) |
| `prefix.enabled` | boolean | `true` | Enable/disable prefix |
| `prefix.ticketFormat` | string | `"{ticket}: "` | Format when ticket found |
| `prefix.branchFallback` | boolean | `true` | Use branch prefix as fallback |

#### PR Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title.prefix.enabled` | boolean | `true` | Enable prefix in PR title |
| `title.prefix.ticketFormat` | string | `"[{ticket}] "` | PR title prefix format |
| `sections` | array | See below | PR description sections |

#### Global Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ticketPattern` | string | - | Regex to match ticket numbers |
| `ticketLinkFormat` | string | - | URL template for ticket links |
| `baseBranch` | string | `"main"` | Base branch for PR comparisons |

## Available Tools

### `get_config`

Get the current pr-narrator configuration for the repository.

```typescript
// Example usage by AI
const config = await get_config({ repoPath: "/path/to/repo" });
```

### `analyze_git_changes`

Analyze the current git repository state and changes.

```typescript
const analysis = await analyze_git_changes({ 
  repoPath: "/path/to/repo",
  includeFullDiff: false 
});

// Returns:
// - Current branch, base branch
// - Ticket extracted from branch name
// - Branch prefix (task/, bug/, etc.)
// - Staged changes with suggested type/scope
// - Branch changes since base branch
```

### `generate_commit_message`

Generate a commit message based on staged changes and config.

```typescript
const result = await generate_commit_message({
  repoPath: "/path/to/repo",
  summary: "Add user authentication flow",
  type: "feat",
  scope: "auth"
});

// Returns:
// {
//   title: "WTHRAPP-1234: feat(auth): Add user authentication flow",
//   body: null,
//   fullMessage: "WTHRAPP-1234: feat(auth): Add user authentication flow",
//   context: { ticket: "WTHRAPP-1234", type: "feat", scope: "auth" },
//   validation: { valid: true, warnings: [] }
// }
```

## Prefix Examples

| Branch | Config | Result |
|--------|--------|--------|
| `feature/WTHRAPP-1234-add-login` | ticket + branchFallback | `WTHRAPP-1234: ` |
| `task/update-readme` | ticket + branchFallback | `Task: ` |
| `bug/fix-crash` | ticket + branchFallback | `Bug: ` |
| `main` | ticket + branchFallback | (no prefix) |
| Any | prefix disabled | (no prefix) |

## Optional Integrations

pr-narrator-mcp can work with other MCPs you have configured:

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

When configured, the tools will return `suggestedActions` that the AI can execute using your other MCPs.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```

## License

MIT
