# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Safety annotations for all MCP tools (readOnlyHint, destructiveHint, idempotentHint)
- Process lifecycle handlers for graceful shutdown (SIGINT, SIGTERM)
- Uncaught exception and unhandled rejection handlers
- Dynamic version reading from package.json (prevents version drift)
- Diff size limits to prevent memory issues with large repositories
- Path validation utility for security
- CI/CD pipeline with GitHub Actions
- ESLint and Prettier configuration for code quality
- This CHANGELOG file

### Changed
- Improved error handling throughout the codebase

### Security
- Added input path validation to prevent path traversal
- Added diff truncation to prevent memory exhaustion attacks

## [0.1.0] - 2024-01-15

### Added
- Initial release of pr-narrator-mcp
- MCP server implementation with stdio transport
- **Tools:**
  - `get_config` - Get current pr-narrator configuration
  - `analyze_git_changes` - Analyze staged changes and branch history
  - `generate_commit_message` - Generate commit messages following configured format
  - `validate_commit_message` - Validate messages against configured rules
  - `extract_tickets` - Extract ticket numbers from branch/commits
  - `generate_pr_title` - Generate PR title with ticket prefix
  - `generate_pr_description` - Generate PR description with sections
  - `generate_pr` - Generate complete PR (title + description)
- Configuration system with Zod schema validation
- Support for multiple config file names (pr-narrator.config.json, .pr-narrator.json, .prnarratorrc.json)
- Conventional commits format support
- Ticket extraction from branch names and commit messages
- Branch prefix fallback (task/, bug/, feature/, etc.)
- Integration hooks for GitHub, GitLab, Jira, Linear MCPs
- Comprehensive README with installation and usage instructions
- Example configuration file
- Unit tests for utilities and tools

[Unreleased]: https://github.com/mhaviv/pr-narrator-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mhaviv/pr-narrator-mcp/releases/tag/v0.1.0
