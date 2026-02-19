import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../src/utils/git.js", () => ({
  validateRepoPath: vi.fn((p: string) => p),
}));

import { readdir, readFile } from "fs/promises";
import type { Dirent } from "fs";
import {
  findRepoTemplate,
  parseTemplateToSections,
  evaluateCondition,
  detectRepoDomain,
  getPresetSections,
  resolveTemplate,
  generateChecklist,
  inferChangeType,
  generateSectionContent,
} from "../../src/utils/template.js";
import { defaultConfig } from "../../src/config/schema.js";

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: "",
    path: "",
  } as Dirent;
}

describe("findRepoTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should find .github/pull_request_template.md", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve([".github"] as unknown as Dirent[]);
      if (d.endsWith(".github")) return Promise.resolve(["pull_request_template.md"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Summary\nTemplate content");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nTemplate content");
    expect(result!.filePath).toBe("/repo/.github/pull_request_template.md");
  });

  it("should find PULL_REQUEST_TEMPLATE.md in root (case insensitive)", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve(["PULL_REQUEST_TEMPLATE.md"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Test Plan\nSteps");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Test Plan\nSteps");
    expect(result!.filePath).toBe("/repo/PULL_REQUEST_TEMPLATE.md");
  });

  it("should find template in .github/PULL_REQUEST_TEMPLATE/ subdirectory", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve([".github"] as unknown as Dirent[]);
      if (d.endsWith(".github")) return Promise.resolve(["PULL_REQUEST_TEMPLATE"] as unknown as Dirent[]);
      if (d.includes("PULL_REQUEST_TEMPLATE")) return Promise.resolve(["default.md"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.endsWith("default.md")) return Promise.resolve("## PR Template\nContent");
      return Promise.reject(new Error("EISDIR: illegal operation on a directory"));
    });

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## PR Template\nContent");
    expect(result!.filePath).toContain("PULL_REQUEST_TEMPLATE");
    expect(result!.filePath).toContain("default.md");
  });

  it("should find .txt template variant", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve([".github"] as unknown as Dirent[]);
      if (d.endsWith(".github")) return Promise.resolve(["PULL_REQUEST_TEMPLATE.txt"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Summary\nText variant");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nText variant");
    expect(result!.filePath).toContain("PULL_REQUEST_TEMPLATE.txt");
  });

  it("should find extensionless template variant", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve(["PULL_REQUEST_TEMPLATE"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Summary\nNo extension");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nNo extension");
    expect(result!.filePath).toBe("/repo/PULL_REQUEST_TEMPLATE");
  });

  it("should find template in docs/pull_request_template.md", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve(["docs"] as unknown as Dirent[]);
      if (d.endsWith("docs")) return Promise.resolve(["pull_request_template.md"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Summary\nDocs template");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nDocs template");
    expect(result!.filePath).toBe("/repo/docs/pull_request_template.md");
  });

  it("should find template in root PULL_REQUEST_TEMPLATE/ directory", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve(["PULL_REQUEST_TEMPLATE"] as unknown as Dirent[]);
      if (d.includes("PULL_REQUEST_TEMPLATE")) return Promise.resolve(["template.md"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.endsWith("template.md")) return Promise.resolve("## Summary\nRoot dir template");
      return Promise.reject(new Error("EISDIR: illegal operation on a directory"));
    });

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nRoot dir template");
    expect(result!.filePath).toContain("PULL_REQUEST_TEMPLATE");
    expect(result!.filePath).toContain("template.md");
  });

  it("should find .txt file inside template directory", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve([".github"] as unknown as Dirent[]);
      if (d.endsWith(".github")) return Promise.resolve(["PULL_REQUEST_TEMPLATE"] as unknown as Dirent[]);
      if (d.includes("PULL_REQUEST_TEMPLATE")) return Promise.resolve(["default.txt"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.endsWith("default.txt")) return Promise.resolve("## Summary\nTxt in dir");
      return Promise.reject(new Error("EISDIR: illegal operation on a directory"));
    });

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("## Summary\nTxt in dir");
    expect(result!.filePath).toContain("default.txt");
  });

  it("should prefer .md over .txt candidates (checks .md first)", async () => {
    vi.mocked(readdir).mockImplementation((dir) => {
      const d = String(dir);
      if (d === "/repo") return Promise.resolve([".github"] as unknown as Dirent[]);
      if (d.endsWith(".github")) return Promise.resolve(["pull_request_template.md", "pull_request_template.txt"] as unknown as Dirent[]);
      return Promise.resolve([] as unknown as Dirent[]);
    });
    vi.mocked(readFile).mockResolvedValue("## Summary\nMD wins");

    const result = await findRepoTemplate("/repo");
    expect(result).not.toBeNull();
    expect(result!.filePath).toContain(".md");
  });

  it("should return null when no template exists", async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Dirent[]);

    const result = await findRepoTemplate("/repo");
    expect(result).toBeNull();
  });

  it("should return null on fs error", async () => {
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));

    const result = await findRepoTemplate("/repo");
    expect(result).toBeNull();
  });
});

describe("parseTemplateToSections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse markdown sections", () => {
    const md = "## Summary\nDescribe your changes\n## Test Plan\nHow to test";
    const sections = parseTemplateToSections(md);

    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe("Summary");
    expect(sections[1].name).toBe("Test Plan");
  });

  it('should map "Summary" to autoPopulate "purpose"', () => {
    const sections = parseTemplateToSections("## Summary\ncontent");
    expect(sections[0].autoPopulate).toBe("purpose");
  });

  it('should map "Related Issues" to autoPopulate "extracted"', () => {
    const sections = parseTemplateToSections("## Related Issues\ncontent");
    expect(sections[0].autoPopulate).toBe("extracted");
  });

  it('should map unknown sections to autoPopulate "none" with placeholder', () => {
    const sections = parseTemplateToSections("## Custom Section\nPlease fill this in");
    expect(sections[0].autoPopulate).toBe("none");
    expect(sections[0].placeholder).toBe("Please fill this in");
  });

  it("should handle template with no ## headers", () => {
    const sections = parseTemplateToSections("Just plain text without headers");
    expect(sections).toHaveLength(0);
  });

  it("should set all conditions to always for repo templates", () => {
    const sections = parseTemplateToSections("## A\ncontent\n## B\ncontent");
    for (const s of sections) {
      expect(s.condition).toEqual({ type: "always" });
    }
  });
});

describe("evaluateCondition", () => {
  it("should return true for undefined condition", () => {
    expect(evaluateCondition(undefined, [], [], 0)).toBe(true);
  });

  it('should return true for "always"', () => {
    expect(evaluateCondition({ type: "always" }, [], [], 0)).toBe(true);
  });

  it('should return false for "never"', () => {
    expect(evaluateCondition({ type: "never" }, [], [], 0)).toBe(false);
  });

  it('should return true for "has_tickets" when tickets present', () => {
    expect(evaluateCondition({ type: "has_tickets" }, [], ["PROJ-1"], 0)).toBe(true);
  });

  it('should return false for "has_tickets" when no tickets', () => {
    expect(evaluateCondition({ type: "has_tickets" }, [], [], 0)).toBe(false);
  });

  it('should evaluate "commit_count_gt" with threshold', () => {
    expect(evaluateCondition({ type: "commit_count_gt", threshold: 3 }, [], [], 4)).toBe(true);
    expect(evaluateCondition({ type: "commit_count_gt", threshold: 3 }, [], [], 2)).toBe(false);
    expect(evaluateCondition({ type: "commit_count_gt", threshold: 3 }, [], [], 3)).toBe(false);
  });

  it('should match "file_pattern" against changed files', () => {
    const cond = { type: "file_pattern" as const, pattern: "\\.css$" };
    expect(evaluateCondition(cond, ["src/app.css"], [], 0)).toBe(true);
    expect(evaluateCondition(cond, ["src/app.ts"], [], 0)).toBe(false);
  });

  it('should fail-open for "file_pattern" with invalid regex', () => {
    const cond = { type: "file_pattern" as const, pattern: "[invalid" };
    expect(evaluateCondition(cond, ["any.file"], [], 0)).toBe(true);
  });

  it('should return true for "file_pattern" with no pattern', () => {
    expect(evaluateCondition({ type: "file_pattern" }, [], [], 0)).toBe(true);
  });
});

describe("detectRepoDomain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect mobile from Swift + xcodeproj files", async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("App.swift", false),
          makeDirent("MyApp.xcodeproj", true),
          makeDirent("Podfile", false),
          makeDirent("Info.plist", false),
        ] as unknown as Dirent[]);
      }
      if (d.includes("xcodeproj")) {
        return Promise.resolve([makeDirent("project.pbxproj", false)] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("mobile");
  });

  it("should detect frontend from tsx + next.config", async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("App.tsx", false),
          makeDirent("next.config.js", false),
          makeDirent("src", true),
        ] as unknown as Dirent[]);
      }
      if (d.endsWith("/src")) {
        return Promise.resolve([
          makeDirent("page.tsx", false),
          makeDirent("layout.tsx", false),
        ] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("frontend");
  });

  it("should detect backend from go.mod + migrations/", async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("go.mod", false),
          makeDirent("main.go", false),
          makeDirent("migrations", true),
        ] as unknown as Dirent[]);
      }
      if (d.endsWith("migrations")) {
        return Promise.resolve([makeDirent("001_init.sql", false)] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("backend");
  });

  it("should detect devops from .tf + helm/", async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("main.tf", false),
          makeDirent("helm", true),
        ] as unknown as Dirent[]);
      }
      if (d.endsWith("helm")) {
        return Promise.resolve([makeDirent("Chart.yaml", false)] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("devops");
  });

  it("should detect ml from .ipynb + model/", async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("train.ipynb", false),
          makeDirent("model", true),
          makeDirent("training", true),
        ] as unknown as Dirent[]);
      }
      if (d.endsWith("model")) {
        return Promise.resolve([makeDirent("weights.h5", false)] as unknown as Dirent[]);
      }
      if (d.endsWith("training")) {
        return Promise.resolve([makeDirent("train.py", false)] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("ml");
  });

  it('should return "default" for mixed/generic files', async () => {
    vi.mocked(readdir).mockImplementation(() => {
      return Promise.resolve([
        makeDirent("README.md", false),
        makeDirent("package.json", false),
      ] as unknown as Dirent[]);
    });

    const domain = await detectRepoDomain("/repo");
    expect(domain).toBe("default");
  });
});

describe("getPresetSections", () => {
  it("should return 6 sections for default preset", () => {
    const sections = getPresetSections("default");
    expect(sections).toHaveLength(6);
  });

  it("should return 2 sections for minimal preset", () => {
    const sections = getPresetSections("minimal");
    expect(sections).toHaveLength(2);
  });

  it("should return 10 sections for detailed preset", () => {
    const sections = getPresetSections("detailed");
    expect(sections).toHaveLength(10);
  });

  it("should return 8 sections for mobile preset", () => {
    expect(getPresetSections("mobile")).toHaveLength(8);
  });

  it("should return 8 sections for frontend preset", () => {
    expect(getPresetSections("frontend")).toHaveLength(8);
  });

  it("should return 8 sections for backend preset", () => {
    expect(getPresetSections("backend")).toHaveLength(8);
  });

  it("should return 8 sections for devops preset", () => {
    expect(getPresetSections("devops")).toHaveLength(8);
  });

  it("should return 7 sections for security preset", () => {
    expect(getPresetSections("security")).toHaveLength(7);
  });

  it("should return 8 sections for ml preset", () => {
    expect(getPresetSections("ml")).toHaveLength(8);
  });

  it("should return default sections for unknown preset", () => {
    const sections = getPresetSections("nonexistent");
    expect(sections).toHaveLength(6);
  });
});

describe("resolveTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return source "repo" when repo template found', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([".github"] as unknown as Dirent[])
      .mockResolvedValueOnce(["pull_request_template.md"] as unknown as Dirent[]);
    vi.mocked(readFile).mockResolvedValue("## Summary\ncontent\n## Test Plan\nsteps");

    const result = await resolveTemplate("/repo", defaultConfig);
    expect(result.source).toBe("repo");
    expect(result.sections).toHaveLength(2);
    expect(result.rawTemplate).toBeTruthy();
    expect(result.repoTemplatePath).toBe("/repo/.github/pull_request_template.md");
  });

  it('should return source "preset" when preset configured', async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Dirent[]);

    const config = {
      ...defaultConfig,
      pr: {
        ...defaultConfig.pr,
        template: { ...defaultConfig.pr.template, preset: "mobile" as const, detectRepoTemplate: false },
      },
    };

    const result = await resolveTemplate("/repo", config);
    expect(result.source).toBe("preset");
    expect(result.detectedDomain).toBe("mobile");
  });

  it('should return source "auto-detected" for mobile repo', async () => {
    vi.mocked(readdir).mockImplementation((_dir, _opts?) => {
      const d = String(_dir);
      if (d.endsWith("/repo")) {
        return Promise.resolve([
          makeDirent("App.swift", false),
          makeDirent("MyApp.xcodeproj", true),
          makeDirent("Podfile", false),
        ] as unknown as Dirent[]);
      }
      if (d.includes("xcodeproj")) {
        return Promise.resolve([makeDirent("project.pbxproj", false)] as unknown as Dirent[]);
      }
      return Promise.resolve([] as unknown as Dirent[]);
    });

    const config = {
      ...defaultConfig,
      pr: {
        ...defaultConfig.pr,
        template: { ...defaultConfig.pr.template, detectRepoTemplate: false },
      },
    };

    const result = await resolveTemplate("/repo", config);
    expect(result.source).toBe("auto-detected");
    expect(result.detectedDomain).toBe("mobile");
  });

  it('should return source "default" when no signals', async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Dirent[]);

    const config = {
      ...defaultConfig,
      pr: {
        ...defaultConfig.pr,
        template: { ...defaultConfig.pr.template, detectRepoTemplate: false },
      },
    };

    const result = await resolveTemplate("/repo", config);
    expect(result.source).toBe("default");
  });
});

describe("generateChecklist", () => {
  it("should include universal items", () => {
    const result = generateChecklist([], []);
    expect(result).toContain("Code has been self-reviewed");
    expect(result).toContain("Changes have been tested locally");
  });

  it("should add documentation item when docs changed", () => {
    const result = generateChecklist([{ path: "README.md" }], []);
    expect(result).toContain("Documentation is accurate and complete");
  });

  it("should add API item when route files changed", () => {
    const result = generateChecklist([{ path: "src/routes/users.ts" }], []);
    expect(result).toContain("API changes are backward compatible");
  });

  it("should add mobile-specific items", () => {
    const result = generateChecklist([], [], "mobile");
    expect(result).toContain("localization ready");
    expect(result).toContain("Dynamic Type");
  });

  it("should add security-specific items", () => {
    const result = generateChecklist([], [], "security");
    expect(result).toContain("OWASP");
  });
});

describe("inferChangeType", () => {
  it("should detect bug fix from branch prefix", () => {
    const result = inferChangeType("fix", []);
    expect(result).toContain("[x] Bug fix");
  });

  it("should detect new feature from branch prefix", () => {
    const result = inferChangeType("feature", []);
    expect(result).toContain("[x] New feature");
  });

  it("should detect test from branch prefix", () => {
    const result = inferChangeType("test", []);
    expect(result).toContain("[x] Test");
  });

  it("should detect chore from branch prefix", () => {
    const result = inferChangeType("chore", []);
    expect(result).toContain("[x] Chore / maintenance");
  });

  it("should detect performance improvement from branch prefix", () => {
    const result = inferChangeType("perf", []);
    expect(result).toContain("[x] Performance improvement");
  });

  it("should detect code style from branch prefix", () => {
    const result = inferChangeType("style", []);
    expect(result).toContain("[x] Code style");
  });

  it("should infer test from files when no branch prefix", () => {
    const result = inferChangeType(null, [{ path: "src/auth/login.test.ts" }]);
    expect(result).toContain("[x] Test");
  });

  it("should produce unchecked items when no prefix matches", () => {
    const result = inferChangeType(null, [{ path: "random.txt" }]);
    const lines = result.split("\n");
    const checked = lines.filter((l) => l.includes("[x]"));
    expect(checked.length).toBeLessThanOrEqual(1);
  });
});

describe("generateSectionContent", () => {
  const baseContext = {
    commits: [{ hash: "abc1234", message: "Add feature" }],
    files: [{ path: "src/app.ts", additions: 10, deletions: 5 }],
    tickets: ["PROJ-123"],
    ticketLinkFormat: undefined,
    providedContent: {} as Record<string, string | undefined>,
    branchName: "feature/test",
    branchPrefix: "feature",
    domain: null,
  };

  it("should return provided content by name", () => {
    const result = generateSectionContent(
      { name: "Purpose", required: true, format: "markdown" },
      { ...baseContext, providedContent: { Purpose: "Custom purpose" } }
    );
    expect(result).toBe("Custom purpose");
  });

  it('should auto-populate commits for "commits" type', () => {
    const result = generateSectionContent(
      { name: "Changes", required: false, autoPopulate: "commits", format: "markdown" },
      baseContext
    );
    expect(result).toContain("Add feature");
    expect(result).toContain("abc1234");
  });

  it('should auto-populate tickets for "extracted" type', () => {
    const result = generateSectionContent(
      { name: "Ticket", required: false, autoPopulate: "extracted", format: "markdown" },
      baseContext
    );
    expect(result).toBe("PROJ-123");
  });

  it('should return placeholder when autoPopulate is "none"', () => {
    const result = generateSectionContent(
      { name: "Test Plan", required: false, autoPopulate: "none", placeholder: "_[Fill in]_", format: "markdown" },
      baseContext
    );
    expect(result).toBe("_[Fill in]_");
  });

  it("should generate checklist content", () => {
    const result = generateSectionContent(
      { name: "Checklist", required: false, autoPopulate: "checklist", format: "checklist" },
      baseContext
    );
    expect(result).toContain("self-reviewed");
  });

  it("should generate change type content", () => {
    const result = generateSectionContent(
      { name: "Type of Change", required: false, autoPopulate: "change_type", format: "markdown" },
      baseContext
    );
    expect(result).toContain("New feature");
  });
});
