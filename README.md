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

### Commit Tools

#### `generate_commit_message`

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
//   fullMessage: "WTHRAPP-1234: feat(auth): Add user authentication flow",
//   context: { ticket: "WTHRAPP-1234", type: "feat", scope: "auth" },
//   validation: { valid: true, warnings: [] }
// }
```

#### `validate_commit_message`

Validate a commit message against configured rules.

```typescript
const result = await validate_commit_message({
  message: "added new feature"
});

// Returns:
// {
//   valid: false,
//   errors: [],
//   warnings: ["Use imperative mood: \"Add\" instead of \"added\""],
//   parsed: { type: null, scope: null, isConventional: false }
// }
```

### PR Tools

#### `generate_pr`

Generate a complete PR with title and description (main tool for PR creation).

```typescript
const result = await generate_pr({
  repoPath: "/path/to/repo",
  summary: "Implements new authentication flow with OAuth support"
});

// Returns:
// {
//   title: "[WTHRAPP-1234] Add User Authentication",
//   description: "## Summary\n\nImplements new authentication...\n\n## Changes\n\n- feat(auth): Add OAuth...",
//   context: { ticket: "WTHRAPP-1234", commitCount: 3, tickets: ["WTHRAPP-1234"] },
//   suggestedActions: [{ action: "create_pr", mcpServer: "user-github", ... }]
// }
```

#### `generate_pr_title`

Generate just the PR title.

```typescript
const result = await generate_pr_title({
  summary: "Add user authentication"
});
// Returns: { title: "[WTHRAPP-1234] Add user authentication", ... }
```

#### `generate_pr_description`

Generate just the PR description with configured sections.

```typescript
const result = await generate_pr_description({
  summary: "Implements OAuth authentication",
  testPlan: "1. Login with Google\n2. Verify token refresh"
});
```

### Utility Tools

#### `get_config`

Get the current pr-narrator configuration for the repository.

```typescript
const config = await get_config({ repoPath: "/path/to/repo" });
```

#### `analyze_git_changes`

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

#### `extract_tickets`

Extract ticket numbers from branch name and commits.

```typescript
const result = await extract_tickets({
  includeCommits: true
});

// Returns:
// {
//   tickets: [{ ticket: "WTHRAPP-1234", source: "branch" }],
//   markdownList: "- [WTHRAPP-1234](https://jira.example.com/browse/WTHRAPP-1234)"
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
