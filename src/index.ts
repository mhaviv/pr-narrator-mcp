#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

// Tool definitions for the MCP server
const tools = [
  {
    name: getConfigTool.name,
    description: getConfigTool.description,
    inputSchema: getConfigTool.inputSchema,
  },
  {
    name: analyzeGitChangesTool.name,
    description: analyzeGitChangesTool.description,
    inputSchema: analyzeGitChangesTool.inputSchema,
  },
  {
    name: generateCommitMessageTool.name,
    description: generateCommitMessageTool.description,
    inputSchema: generateCommitMessageTool.inputSchema,
  },
  {
    name: validateCommitMessageTool.name,
    description: validateCommitMessageTool.description,
    inputSchema: validateCommitMessageTool.inputSchema,
  },
  {
    name: extractTicketsTool.name,
    description: extractTicketsTool.description,
    inputSchema: extractTicketsTool.inputSchema,
  },
  {
    name: generatePrTitleTool.name,
    description: generatePrTitleTool.description,
    inputSchema: generatePrTitleTool.inputSchema,
  },
  {
    name: generatePrDescriptionTool.name,
    description: generatePrDescriptionTool.description,
    inputSchema: generatePrDescriptionTool.inputSchema,
  },
  {
    name: generatePrTool.name,
    description: generatePrTool.description,
    inputSchema: generatePrTool.inputSchema,
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "pr-narrator-mcp",
    version: "0.1.0",
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PR Narrator MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
