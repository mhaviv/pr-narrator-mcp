import { z } from "zod";
import type { Config } from "../config/schema.js";
import {
  getTagList,
  getCommitRange,
  extractCoAuthors,
  validateRepoPath,
  createGit,
  safeRegex,
} from "../utils/git.js";
import {
  mapCommitTypeToChangelogSection,
  formatChangelogEntry,
  formatTicketLink,
} from "../utils/formatters.js";

export const generateChangelogSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe(
      "Path to the git repository. Always pass the user's current project/workspace directory."
    ),
  from: z
    .string()
    .optional()
    .describe(
      "Start ref — tag, SHA, or branch. Defaults to the latest tag. If no tags exist, uses the initial commit."
    ),
  to: z
    .string()
    .optional()
    .describe("End ref. Defaults to HEAD."),
  groupBy: z
    .enum(["type", "scope", "ticket"])
    .optional()
    .describe("How to group changelog entries. Default: 'type'."),
  includeAuthors: z
    .boolean()
    .optional()
    .describe("Include contributor attribution. Default: true."),
  format: z
    .enum(["keepachangelog", "github-release", "plain"])
    .optional()
    .describe("Output format. Default: 'keepachangelog'."),
});

export type GenerateChangelogInput = z.infer<typeof generateChangelogSchema>;

interface ChangelogEntry {
  type: string;
  scope: string | null;
  title: string;
  hash: string;
  author: string;
  coAuthors: string[];
  tickets: string[];
  date: string;
}

export interface GenerateChangelogResult {
  success: boolean;
  errors: string[];
  changelog: string;
  entries: ChangelogEntry[];
  summary: string;
  stats: {
    commitCount: number;
    contributorCount: number;
    ticketCount: number;
  };
  range: {
    from: string;
    to: string;
    fromDate: string | null;
    toDate: string | null;
  };
  warnings: string[];
}

const MAX_COMMITS = 10_000;

const CONVENTIONAL_REGEX =
  /^(feat|fix|docs|style|refactor|test|chore|ci|build|perf|revert)(\(([^)]+)\))?(!)?\s*:\s*(.+)/;

const KEYWORD_MAP: Array<{ keywords: string[]; type: string }> = [
  { keywords: ["fix", "fixed", "fixes"], type: "fix" },
  { keywords: ["add", "added", "adds"], type: "feat" },
  { keywords: ["update", "updated", "updates"], type: "feat" },
  { keywords: ["remove", "removed", "removes"], type: "refactor" },
  { keywords: ["refactor", "refactored", "refactors"], type: "refactor" },
  { keywords: ["test", "tests", "testing"], type: "test" },
  { keywords: ["doc", "docs", "readme", "document"], type: "docs" },
];

function inferTypeFromMessage(message: string): string {
  const firstWord = message.split(/\s+/)[0]?.toLowerCase() || "";
  for (const { keywords, type } of KEYWORD_MAP) {
    if (keywords.includes(firstWord)) {
      return type;
    }
  }
  return "other";
}

function stripTypePrefix(message: string): string {
  const match = message.match(CONVENTIONAL_REGEX);
  if (match) {
    return match[5].trim();
  }
  return message.trim();
}

function parseCommitType(message: string): { type: string; scope: string | null } {
  const match = message.match(CONVENTIONAL_REGEX);
  if (match) {
    return { type: match[1], scope: match[3] || null };
  }
  return { type: inferTypeFromMessage(message), scope: null };
}

function extractTicketsFromMessage(message: string, ticketPattern: string | undefined): string[] {
  if (!ticketPattern) return [];
  const regex = safeRegex(ticketPattern, "gi");
  if (!regex) return [];
  const matches = message.match(regex);
  return matches ? [...new Set(matches.map((m) => m.toUpperCase()))] : [];
}

function generateSummaryLine(entries: ChangelogEntry[]): string {
  const typeCounts = new Map<string, number>();
  for (const entry of entries) {
    const section = mapCommitTypeToChangelogSection(entry.type);
    typeCounts.set(section, (typeCounts.get(section) || 0) + 1);
  }

  const parts: string[] = [];
  const sectionOrder = ["Added", "Fixed", "Changed", "Documentation", "Reverted", "Other"];
  const sectionLabels: Record<string, [string, string]> = {
    Added: ["feature", "features"],
    Fixed: ["fix", "fixes"],
    Changed: ["change", "changes"],
    Documentation: ["doc update", "doc updates"],
    Reverted: ["revert", "reverts"],
    Other: ["other change", "other changes"],
  };

  for (const section of sectionOrder) {
    const count = typeCounts.get(section);
    if (count && count > 0) {
      const [singular, plural] = sectionLabels[section] || ["change", "changes"];
      parts.push(`${count} ${count === 1 ? singular : plural}`);
    }
  }

  if (parts.length === 0) return "No changes";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export async function generateChangelog(
  input: GenerateChangelogInput,
  config: Config
): Promise<GenerateChangelogResult> {
  const warnings: string[] = [];
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();
  const groupBy = input.groupBy || "type";
  const includeAuthors = input.includeAuthors ?? true;
  const format = input.format || "keepachangelog";

  const emptyResult: GenerateChangelogResult = {
    success: true,
    errors: [],
    changelog: "",
    entries: [],
    summary: "No changes",
    stats: { commitCount: 0, contributorCount: 0, ticketCount: 0 },
    range: { from: "", to: "", fromDate: null, toDate: null },
    warnings,
  };

  // Step 1: Resolve refs
  let fromRef = input.from || "";
  const toRef = input.to || "HEAD";
  let fromDate: string | null = null;
  let toDate: string | null = null;
  let isFromTag = false;
  let isToTag = false;
  let toTagName: string | null = null;

  let validatedPath: string;
  let git: ReturnType<typeof createGit>;
  try {
    validatedPath = validateRepoPath(repoPath);
    git = createGit(validatedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...emptyResult,
      success: false,
      errors: [`Failed to initialize git repository: ${message}`],
    };
  }

  if (!fromRef) {
    const tags = await getTagList(repoPath);
    if (tags.length > 0) {
      fromRef = tags[0].name;
      fromDate = tags[0].date;
      isFromTag = true;
    } else {
      try {
        const initial = await git.raw(["rev-list", "--max-parents=0", "HEAD"]);
        fromRef = initial.trim().split("\n")[0];
        if (!fromRef) {
          warnings.push("Could not determine initial commit.");
          return emptyResult;
        }
        warnings.push("No tags found. Using initial commit as start ref.");
      } catch {
        warnings.push("Could not determine initial commit.");
        return emptyResult;
      }
    }
  }

  // Resolve dates for the refs
  try {
    if (!fromDate) {
      const fromInfo = await git.raw(["log", "-1", "--format=%aI", fromRef]);
      fromDate = fromInfo.trim() || null;
    }
    const toInfo = await git.raw(["log", "-1", "--format=%aI", toRef]);
    toDate = toInfo.trim() || null;
  } catch {
    warnings.push("Could not resolve ref dates.");
  }

  // Check if refs are tags (for header formatting)
  const tagListForLookup =
    (!isFromTag && input.from) || (toRef !== "HEAD") ? await getTagList(repoPath) : [];

  if (!isFromTag && input.from) {
    const fromInput = input.from;
    const matchingTag = tagListForLookup.find(
      (t) => t.name === fromInput || t.hash.startsWith(fromInput)
    );
    if (matchingTag) {
      isFromTag = true;
    }
  }

  if (toRef !== "HEAD") {
    const matchingToTag = tagListForLookup.find(
      (t) => t.name === toRef || t.hash.startsWith(toRef)
    );
    if (matchingToTag) {
      isToTag = true;
      toTagName = matchingToTag.name;
    }
  }

  // Step 2: Collect commits
  let commits = await getCommitRange(repoPath, fromRef, toRef);

  if (commits.length === 0) {
    warnings.push(`No commits found between ${fromRef} and ${toRef}.`);
    return {
      ...emptyResult,
      success: true,
      errors: [],
      range: { from: fromRef, to: toRef, fromDate, toDate },
    };
  }

  if (commits.length > MAX_COMMITS) {
    warnings.push(
      `Commit range contains ${commits.length} commits. Truncated to the most recent ${MAX_COMMITS}.`
    );
    commits = commits.slice(0, MAX_COMMITS);
  }

  // Parse entries
  const entries: ChangelogEntry[] = commits.map((commit) => {
    const { type, scope } = parseCommitType(commit.message);
    const title = stripTypePrefix(commit.message);
    const coAuthors = extractCoAuthors(commit.body);
    const fullMessage = commit.body ? `${commit.message}\n${commit.body}` : commit.message;
    const tickets = extractTicketsFromMessage(fullMessage, config.ticketPattern);

    return {
      type,
      scope,
      title,
      hash: commit.shortHash,
      author: commit.author,
      coAuthors,
      tickets,
      date: commit.date,
    };
  });

  // Step 3: Deduplicate squash-merge artifacts
  const seen = new Map<string, ChangelogEntry>();
  for (const entry of entries) {
    const key = entry.title.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  }
  const dedupedEntries = Array.from(seen.values());

  // Step 4: Group entries
  const groups = new Map<string, ChangelogEntry[]>();
  for (const entry of dedupedEntries) {
    let key: string;
    switch (groupBy) {
      case "scope":
        key = entry.scope || "Unscoped";
        break;
      case "ticket":
        key = entry.tickets.length > 0 ? entry.tickets[0] : "No Ticket";
        break;
      case "type":
      default:
        key = mapCommitTypeToChangelogSection(entry.type);
        break;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  // Step 5: Format output
  const allTickets = new Set<string>();
  for (const entry of dedupedEntries) {
    for (const ticket of entry.tickets) {
      allTickets.add(ticket);
    }
  }

  const allAuthors = new Map<string, number>();
  for (const entry of dedupedEntries) {
    allAuthors.set(entry.author, (allAuthors.get(entry.author) || 0) + 1);
    for (const co of entry.coAuthors) {
      allAuthors.set(co, (allAuthors.get(co) || 0) + 1);
    }
  }

  const changelog = formatChangelog({
    groups,
    format,
    includeAuthors,
    allTickets: Array.from(allTickets),
    allAuthors,
    ticketLinkFormat: config.ticketLinkFormat,
    toDate,
    isToTag,
    toTagName,
    groupBy,
  });

  // Step 6: Summary
  const summary = generateSummaryLine(dedupedEntries);

  return {
    success: true,
    errors: [],
    changelog,
    entries: dedupedEntries,
    summary,
    stats: {
      commitCount: dedupedEntries.length,
      contributorCount: allAuthors.size,
      ticketCount: allTickets.size,
    },
    range: { from: fromRef, to: toRef, fromDate, toDate },
    warnings,
  };
}

interface FormatOptions {
  groups: Map<string, ChangelogEntry[]>;
  format: "keepachangelog" | "github-release" | "plain";
  includeAuthors: boolean;
  allTickets: string[];
  allAuthors: Map<string, number>;
  ticketLinkFormat: string | undefined;
  toDate: string | null;
  isToTag: boolean;
  toTagName: string | null;
  groupBy: string;
}

function formatChangelog(opts: FormatOptions): string {
  const {
    groups,
    format,
    includeAuthors,
    allTickets,
    allAuthors,
    ticketLinkFormat,
    toDate,
    isToTag,
    toTagName,
    groupBy,
  } = opts;

  const dateStr = toDate ? toDate.split("T")[0] : new Date().toISOString().split("T")[0];
  const parts: string[] = [];

  switch (format) {
    case "keepachangelog": {
      const versionLabel = isToTag && toTagName ? toTagName : "Unreleased";
      parts.push(`## [${versionLabel}] — ${dateStr}`);

      const sectionOrder = ["Added", "Fixed", "Changed", "Documentation", "Reverted", "Other"];
      if (groupBy === "type") {
        for (const section of sectionOrder) {
          const entries = groups.get(section);
          if (!entries || entries.length === 0) continue;
          parts.push("");
          parts.push(`### ${section}`);
          parts.push("");
          for (const entry of entries) {
            parts.push(formatChangelogEntry(entry, format, includeAuthors));
          }
        }
      } else {
        for (const [groupName, entries] of groups) {
          parts.push("");
          parts.push(`### ${groupName}`);
          parts.push("");
          for (const entry of entries) {
            parts.push(formatChangelogEntry(entry, format, includeAuthors));
          }
        }
      }

      if (allTickets.length > 0) {
        parts.push("");
        parts.push("### Related Tickets");
        parts.push("");
        for (const ticket of allTickets) {
          parts.push(`- ${formatTicketLink(ticket, ticketLinkFormat)}`);
        }
      }
      break;
    }

    case "github-release": {
      parts.push("## What's Changed");
      parts.push("");
      for (const [, entries] of groups) {
        for (const entry of entries) {
          parts.push(formatChangelogEntry(entry, format, includeAuthors));
        }
      }

      if (includeAuthors && allAuthors.size > 0) {
        parts.push("");
        parts.push("## Contributors");
        parts.push("");
        const sorted = Array.from(allAuthors.entries()).sort((a, b) => b[1] - a[1]);
        for (const [author, count] of sorted) {
          parts.push(`- **${author}** (${count} ${count === 1 ? "commit" : "commits"})`);
        }
      }

      if (allTickets.length > 0) {
        parts.push("");
        parts.push("## Related Tickets");
        parts.push("");
        for (const ticket of allTickets) {
          parts.push(`- ${formatTicketLink(ticket, ticketLinkFormat)}`);
        }
      }
      break;
    }

    case "plain": {
      for (const [, entries] of groups) {
        for (const entry of entries) {
          parts.push(formatChangelogEntry(entry, format, includeAuthors));
        }
      }
      break;
    }
  }

  return parts.join("\n");
}

export const generateChangelogTool = {
  name: "generate_changelog",
  description: `Generate release notes / changelog from git commit history between two refs.

Analyzes commits between two refs (tags, SHAs, or branches) and produces a formatted
changelog. Supports three output formats: Keep a Changelog (keepachangelog), GitHub Release
(github-release), and plain text.

Auto-detects:
- Latest tag as the start ref if not provided
- Conventional commit types and scopes
- Non-conventional commit types via keyword inference
- Co-authors from commit trailers
- Ticket references from commit messages

Use this when a user wants to generate release notes, changelogs, or understand what
changed between two versions.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description:
          "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      from: {
        type: "string",
        description:
          "Start ref — tag, SHA, or branch. Defaults to the latest tag. If no tags exist, uses the initial commit.",
      },
      to: {
        type: "string",
        description: "End ref. Defaults to HEAD.",
      },
      groupBy: {
        type: "string",
        enum: ["type", "scope", "ticket"],
        description: "How to group changelog entries. Default: 'type'.",
      },
      includeAuthors: {
        type: "boolean",
        description: "Include contributor attribution. Default: true.",
      },
      format: {
        type: "string",
        enum: ["keepachangelog", "github-release", "plain"],
        description: "Output format. Default: 'keepachangelog'.",
      },
    },
  },
  handler: generateChangelog,
};
