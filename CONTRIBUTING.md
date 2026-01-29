# Contributing to pr-narrator-mcp

First off, thank you for considering contributing to pr-narrator-mcp! It's people like you that make this tool better for everyone.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (config files, branch names, etc.)
- **Describe the behavior you observed and what you expected**
- **Include your environment** (Node.js version, OS, etc.)

### Suggesting Enhancements

Enhancement suggestions are welcome! Please include:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested enhancement**
- **Explain why this enhancement would be useful**
- **List any alternatives you've considered**

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes**
4. **Add tests** for any new functionality
5. **Ensure tests pass**: `npm test`
6. **Ensure the build works**: `npm run build`
7. **Commit your changes** (use pr-narrator-mcp if you have it installed!)
8. **Push to your fork** and submit a pull request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/pr-narrator-mcp.git
cd pr-narrator-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in watch mode during development
npm run dev
```

## Project Structure

```
pr-narrator-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config/
│   │   ├── schema.ts         # Zod config schema
│   │   └── loader.ts         # Config file loading
│   ├── tools/
│   │   ├── get-config.ts
│   │   ├── analyze-git-changes.ts
│   │   ├── generate-commit-message.ts
│   │   ├── validate-commit-message.ts
│   │   ├── extract-tickets.ts
│   │   ├── generate-pr-title.ts
│   │   ├── generate-pr-description.ts
│   │   └── generate-pr.ts
│   └── utils/
│       ├── git.ts            # Git operations
│       └── formatters.ts     # Message formatting
├── test/                     # Test files
├── package.json
└── tsconfig.json
```

## Code Style

- Use TypeScript for all new code
- Follow existing code patterns and naming conventions
- Add JSDoc comments for public functions
- Keep functions focused and small
- Write tests for new functionality

## Commit Messages

We use conventional commits. If you're using this tool, it should help! 😄

Format: `type(scope): description`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `chore`: Maintenance tasks

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing! 🎉
