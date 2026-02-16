# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in pr-narrator-mcp, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@mhaviv.dev** (or open a [private security advisory](https://github.com/mhaviv/pr-narrator-mcp/security/advisories/new) on GitHub).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect:
- Acknowledgment within 48 hours
- A fix or mitigation plan within 7 days for critical issues
- Credit in the changelog (unless you prefer to remain anonymous)

## Security Model

### What this MCP server does
- **Read-only**: All tools only read git repository state (branches, commits, diffs, status). No tools write to the filesystem, execute git commands that modify state, or make network requests.
- **Local-only**: Uses stdio transport exclusively. No HTTP server, no network listeners, no remote connections.
- **No secrets handling**: Does not store, process, or transmit authentication tokens, API keys, or credentials. Configuration is limited to formatting preferences via environment variables.

### Known security considerations

1. **Diff content may contain sensitive data**: Staged changes and branch diffs are passed to the AI model for analysis. If your commits contain API keys, passwords, or other secrets, these will be visible to the AI. Use tools like `git-secrets` or `gitleaks` to prevent committing secrets.

2. **Indirect prompt injection**: Git commit messages and branch names are user-generated content that is returned to the AI model. Malicious commit messages could theoretically attempt to influence AI behavior. The read-only nature of this MCP limits the blast radius.

3. **Regex patterns (TICKET_PATTERN)**: User-provided regex patterns are validated for safety before use, including checks for catastrophic backtracking patterns (ReDoS). Patterns exceeding 200 characters or containing nested quantifiers are rejected.

4. **Repository path access**: The `repoPath` parameter allows reading git data from any directory the process has access to. Path traversal protections are in place (null byte injection prevention, path normalization).

### Protections in place
- Zod schema validation on all tool inputs
- Path validation and normalization
- Diff size truncation (500KB limit) to prevent memory exhaustion
- ReDoS-safe regex validation for user-provided patterns
- Graceful shutdown handlers (SIGINT, SIGTERM)
- Uncaught exception handling
- MCP safety annotations (readOnlyHint, idempotentHint) on all tools
