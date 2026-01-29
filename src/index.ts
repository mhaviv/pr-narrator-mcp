#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "module";

// Read version from package.json to avoid version drift
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

// Import all tools
import { getConfigTool, getConfig, getConfigSchema } from "./tools/get-config.js";
import {
  analyzeGitChangesTool,
  analyzeGitChanges,
  analyzeGitChangesSchema,
} from "./tools/analyze-git-changes.js";
import {
  generateCommitMessageTool,
  generateCommitMessage,
  generateCommitMessageSchema,
} from "./tools/generate-commit-message.js";
import {
  validateCommitMessageTool,
  validateCommitMessage,
  validateCommitMessageSchema,
} from "./tools/validate-commit-message.js";
import {
  extractTicketsTool,
  extractTickets,
  extractTicketsSchema,
} from "./tools/extract-tickets.js";
import {
  generatePrTitleTool,
  generatePrTitle,
  generatePrTitleSchema,
} from "./tools/generate-pr-title.js";
import {
  generatePrDescriptionTool,
  generatePrDescription,
  generatePrDescriptionSchema,
} from "./tools/generate-pr-description.js";
import {
  generatePrTool,
  generatePr,
  generatePrSchema,
} from "./tools/generate-pr.js";

// Safety annotations for all tools (Anthropic MCP requirement)
// All tools in this server are read-only operations
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// Tool definitions for the MCP server
const tools = [
  {
    name: getConfigTool.name,
    description: getConfigTool.description,
    inputSchema: getConfigTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: analyzeGitChangesTool.name,
    description: analyzeGitChangesTool.description,
    inputSchema: analyzeGitChangesTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: generateCommitMessageTool.name,
    description: generateCommitMessageTool.description,
    inputSchema: generateCommitMessageTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: validateCommitMessageTool.name,
    description: validateCommitMessageTool.description,
    inputSchema: validateCommitMessageTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: extractTicketsTool.name,
    description: extractTicketsTool.description,
    inputSchema: extractTicketsTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: generatePrTitleTool.name,
    description: generatePrTitleTool.description,
    inputSchema: generatePrTitleTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: generatePrDescriptionTool.name,
    description: generatePrDescriptionTool.description,
    inputSchema: generatePrDescriptionTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: generatePrTool.name,
    description: generatePrTool.description,
    inputSchema: generatePrTool.inputSchema,
    annotations: readOnlyAnnotations,
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "pr-narrator-mcp",
    version, // Dynamically read from package.json
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_config": {
        const input = getConfigSchema.parse(args || {});
        const result = await getConfig(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "analyze_git_changes": {
        const input = analyzeGitChangesSchema.parse(args || {});
        const result = await analyzeGitChanges(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "generate_commit_message": {
        const input = generateCommitMessageSchema.parse(args || {});
        const result = await generateCommitMessage(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "validate_commit_message": {
        const input = validateCommitMessageSchema.parse(args || {});
        const result = await validateCommitMessage(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "extract_tickets": {
        const input = extractTicketsSchema.parse(args || {});
        const result = await extractTickets(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "generate_pr_title": {
        const input = generatePrTitleSchema.parse(args || {});
        const result = await generatePrTitle(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "generate_pr_description": {
        const input = generatePrDescriptionSchema.parse(args || {});
        const result = await generatePrDescription(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "generate_pr": {
        const input = generatePrSchema.parse(args || {});
        const result = await generatePr(input);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.error(`\nReceived ${signal}, shutting down PR Narrator MCP server...`);
  try {
    await server.close();
    console.error("Server closed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Start the server
async function main() {
  // Register signal handlers for graceful shutdown
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error.message);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PR Narrator MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
