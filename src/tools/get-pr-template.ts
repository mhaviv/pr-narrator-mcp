import { z } from "zod";
import type { Config, SectionCondition } from "../config/schema.js";
import {
  getCurrentBranch,
  getBranchChanges,
  detectBaseBranch,
  extractTicketFromBranch,
  extractTicketsFromCommits,
} from "../utils/git.js";
import { resolveTemplate, evaluateCondition, VALID_PRESETS } from "../utils/template.js";

export const getPrTemplateSchema = z.object({
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git repository."),
  preset: z
    .string()
    .optional()
    .describe("Force a specific preset instead of auto-detecting."),
});

export type GetPrTemplateInput = z.infer<typeof getPrTemplateSchema>;

export interface GetPrTemplateResult {
  source: "repo" | "preset" | "auto-detected" | "default";
  repoTemplatePath: string | null;
  detectedDomain: string | null;
  preset: string | null;
  sections: Array<{
    name: string;
    required: boolean;
    autoPopulate: string | undefined;
    condition: SectionCondition | undefined;
    willAppear: boolean;
    placeholder: string | null;
    format: string;
  }>;
  rawTemplate: string | null;
}

export async function getPrTemplate(
  input: GetPrTemplateInput,
  config: Config
): Promise<GetPrTemplateResult> {
  const repoPath = input.repoPath || config.defaultRepoPath || process.cwd();

  // If a preset is explicitly requested and valid, override config
  let effectiveConfig = config;
  if (input.preset && (VALID_PRESETS as readonly string[]).includes(input.preset)) {
    effectiveConfig = {
      ...config,
      pr: {
        ...config.pr,
        template: {
          ...config.pr.template,
          preset: input.preset as Config["pr"]["template"]["preset"],
          detectRepoTemplate: false,
        },
      },
    };
  }

  const resolved = await resolveTemplate(repoPath, effectiveConfig);

  // Get branch changes and tickets to evaluate conditions accurately
  const baseBranchResult = await detectBaseBranch(repoPath, config.baseBranch);
  const branchChanges = await getBranchChanges(repoPath, baseBranchResult.branch);
  const filePaths = (branchChanges?.files ?? []).map((f) => f.path);
  const commits = branchChanges?.commits ?? [];

  const branchName = await getCurrentBranch(repoPath);
  const tickets: string[] = [];
  const seenTickets = new Set<string>();

  if (branchName && config.ticketPattern) {
    const branchTicket = extractTicketFromBranch(branchName, config.ticketPattern);
    if (branchTicket) {
      const normalized = branchTicket.toUpperCase();
      seenTickets.add(normalized);
      tickets.push(normalized);
    }
  }

  if (config.ticketPattern) {
    const commitTickets = await extractTicketsFromCommits(
      repoPath,
      baseBranchResult.branch,
      config.ticketPattern
    );
    for (const t of commitTickets) {
      const normalized = t.toUpperCase();
      if (!seenTickets.has(normalized)) {
        seenTickets.add(normalized);
        tickets.push(normalized);
      }
    }
  }

  const sections = resolved.sections.map((s) => ({
    name: s.name,
    required: s.required,
    autoPopulate: s.autoPopulate,
    condition: s.condition,
    willAppear: evaluateCondition(s.condition, filePaths, tickets, commits.length),
    placeholder: s.placeholder ?? null,
    format: s.format,
  }));

  return {
    source: resolved.source,
    repoTemplatePath: resolved.repoTemplatePath,
    detectedDomain: resolved.detectedDomain,
    preset: input.preset ?? config.pr.template.preset ?? null,
    sections,
    rawTemplate: resolved.rawTemplate,
  };
}

export const getPrTemplateTool = {
  name: "get_pr_template",
  description:
    "Returns the resolved PR template for a repository, showing which sections will appear " +
    "based on repo template detection, domain auto-detection, or explicit preset. " +
    "Useful for previewing the template structure before generating a PR.",
  inputSchema: {
    type: "object" as const,
    properties: {
      repoPath: {
        type: "string",
        description: "Path to the git repository. IMPORTANT: Always pass the user's current project/workspace directory.",
      },
      preset: {
        type: "string",
        description:
          "Force a specific preset (default, minimal, detailed, mobile, frontend, backend, devops, security, ml).",
      },
    },
  },
  handler: getPrTemplate,
};
