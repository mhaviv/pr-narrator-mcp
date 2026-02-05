import { z } from "zod";
import type { Config } from "../config/schema.js";
import {
  getCurrentBranch,
  extractTicketFromBranch,
  extractTicketsFromCommits,
  getDefaultBranch,
} from "../utils/git.js";
import { formatTicketLink } from "../utils/formatters.js";

export const extractTicketsSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository. Always pass the user's current project/workspace directory."),
  includeCommits: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to search commit messages for tickets"),
  additionalText: z
    .string()
    .optional()
    .describe("Additional text to search for tickets (e.g., PR title)"),
});

export type ExtractTicketsInput = z.infer<typeof extractTicketsSchema>;

export interface TicketInfo {
  ticket: string;
  source: "branch" | "commit" | "text";
  link: string | null;
}

export interface ExtractTicketsResult {
  tickets: TicketInfo[];
  uniqueTickets: string[];
  formattedLinks: string[];
  markdownList: string;
  branchName: string | null;
  ticketPattern: string | null;
  hasTickets: boolean;
}

/**
 * Extract ticket numbers from branch name, commits, and additional text
 */
export async function extractTickets(
  input: ExtractTicketsInput,
  config: Config
): Promise<ExtractTicketsResult> {
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();
  const includeCommits = input.includeCommits ?? true;

  const ticketPattern = config.ticketPattern;
  const ticketLinkFormat = config.ticketLinkFormat;

  // Auto-detect base branch from repo, fall back to config value
  const baseBranch = await getDefaultBranch(repoPath, config.baseBranch);

  const tickets: TicketInfo[] = [];
  const seen = new Set<string>();

  // Get current branch
  const branchName = await getCurrentBranch(repoPath);

  // Extract from branch name
  if (branchName && ticketPattern) {
    const branchTicket = extractTicketFromBranch(branchName, ticketPattern);
    if (branchTicket) {
      const normalized = branchTicket.toUpperCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        tickets.push({
          ticket: normalized,
          source: "branch",
          link: ticketLinkFormat
            ? ticketLinkFormat.replace("{ticket}", normalized)
            : null,
        });
      }
    }
  }

  // Extract from commits
  if (includeCommits && ticketPattern) {
    const commitTickets = await extractTicketsFromCommits(
      repoPath,
      baseBranch,
      ticketPattern
    );

    for (const ticket of commitTickets) {
      const normalized = ticket.toUpperCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        tickets.push({
          ticket: normalized,
          source: "commit",
          link: ticketLinkFormat
            ? ticketLinkFormat.replace("{ticket}", normalized)
            : null,
        });
      }
    }
  }

  // Extract from additional text
  if (input.additionalText && ticketPattern) {
    try {
      const regex = new RegExp(ticketPattern, "gi");
      const matches = input.additionalText.match(regex);
      if (matches) {
        for (const match of matches) {
          const normalized = match.toUpperCase();
          if (!seen.has(normalized)) {
            seen.add(normalized);
            tickets.push({
              ticket: normalized,
              source: "text",
              link: ticketLinkFormat
                ? ticketLinkFormat.replace("{ticket}", normalized)
                : null,
            });
          }
        }
      }
    } catch {
      // Invalid regex, skip
    }
  }

  const uniqueTickets = tickets.map((t) => t.ticket);
  const formattedLinks = tickets.map((t) =>
    formatTicketLink(t.ticket, ticketLinkFormat)
  );
  const markdownList =
    tickets.length > 0
      ? tickets
          .map((t) => `- ${formatTicketLink(t.ticket, ticketLinkFormat)}`)
          .join("\n")
      : "No tickets found";

  return {
    tickets,
    uniqueTickets,
    formattedLinks,
    markdownList,
    branchName,
    ticketPattern: ticketPattern ?? null,
    hasTickets: tickets.length > 0,
  };
}

export const extractTicketsTool = {
  name: "extract_tickets",
  description: `Extract ticket numbers from the current branch, commits, and optional additional text.

Uses TICKET_PATTERN env var to find tickets in:
1. Branch name (e.g., "feature/PROJ-1234-add-login")
2. Commit messages since base branch
3. Additional text provided`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      includeCommits: {
        type: "boolean",
        description: "Whether to search commit messages for tickets",
        default: true,
      },
      additionalText: {
        type: "string",
        description: "Additional text to search for tickets (e.g., PR title)",
      },
    },
  },
  handler: extractTickets,
};
