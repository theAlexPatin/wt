import { readdir, readFile, writeFile, copyFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, userInfo } from "os";
import { execFileSync } from "child_process";

export interface WtConfig {
  tabColor?: string;
  paneColor?: string;
  tabTitle?: string;
}

export interface WorktreeInfo {
  name: string;
  tabTitle: string;
  tabColor?: string;
  paneColor?: string;
  path: string;
}

export interface WorktreeResult {
  worktree: string;
  path: string;
  tabTitle: string;
  tabColor: string;
  paneColor: string;
  setupRunning: boolean;
}

const WORKTREES_DIR = join(homedir(), ".worktrees");

// Color palette — same as wt CLI new.sh
const BRIGHTS = [
  "#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd",
  "#be5046", "#d19a66", "#7ec699", "#5bc0de", "#4ea1f3", "#a777e3",
  "#f472b6", "#fb923c", "#a3e635", "#2dd4bf", "#818cf8", "#f87171",
  "#facc15", "#34d399",
];
const DARKS = [
  "#2d1519", "#2d2215", "#182d15", "#15232d", "#151e2d", "#21152d",
  "#2d1410", "#2d2012", "#152d1e", "#15242d", "#151d2d", "#1d152d",
  "#2d151f", "#2d1b0c", "#1e2d0c", "#0c2d22", "#16162d", "#2d1515",
  "#2d230a", "#0c2d1c",
];

/** Read a .wt.local.json config file */
export async function readWtConfig(configPath: string): Promise<WtConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as WtConfig;
  } catch {
    return {};
  }
}

/** Parse repo and worktree name from a config path like ~/.worktrees/Owner/fixing-auth-bug/.wt.local.json */
export function parseConfigPath(configPath: string): {
  repo: string;
  worktree: string;
} | null {
  const rel = configPath.replace(WORKTREES_DIR + "/", "");
  const parts = rel.split("/");
  const repo = parts[0];
  const worktree = parts[1];
  if (parts.length >= 2 && repo && worktree) {
    return { repo, worktree };
  }
  return null;
}

/** List all tracked repos under ~/.worktrees/ */
export async function listRepos(): Promise<string[]> {
  try {
    const entries = await readdir(WORKTREES_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** List all worktrees for a given repo */
export async function listWorktrees(repo: string): Promise<string[]> {
  try {
    const repoDir = join(WORKTREES_DIR, repo);
    const entries = await readdir(repoDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** List worktrees for a repo, enriched with config data */
export async function listWorktreesWithConfig(repo: string): Promise<WorktreeInfo[]> {
  const names = await listWorktrees(repo);
  return Promise.all(
    names.map(async (name) => {
      const wtPath = join(WORKTREES_DIR, repo, name);
      const config = await readWtConfig(join(wtPath, ".wt.local.json"));
      return {
        name,
        tabTitle: config.tabTitle || name,
        tabColor: config.tabColor,
        paneColor: config.paneColor,
        path: wtPath,
      };
    })
  );
}

/** Read the source repo root path from ~/.worktrees/<repo>/.repo */
export async function getRepoRoot(repo: string): Promise<string | null> {
  try {
    const repoFile = join(WORKTREES_DIR, repo, ".repo");
    const content = await readFile(repoFile, "utf-8");
    const root = content.trim();
    return existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

/** Slugify a name: lowercase, non-alphanumeric → hyphens, collapse, trim */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/** Create a new worktree with git, assign colors, write config */
export async function createWorktree(repo: string, name: string): Promise<WorktreeResult> {
  const repoRoot = await getRepoRoot(repo);
  if (!repoRoot) throw new Error(`Could not resolve source repo for ${repo}`);

  const branchPrefix = userInfo().username || "user";
  const baseSlug = slugify(name);
  const repoWtDir = join(WORKTREES_DIR, repo);

  // Auto-increment on collision
  let slug = baseSlug;
  let branchName = `${branchPrefix}/${baseSlug}`;
  let counter = 1;
  while (true) {
    const wtPath = join(repoWtDir, slug);
    if (!existsSync(wtPath)) {
      try {
        const branches = execFileSync("git", ["-C", repoRoot, "branch", "--list", branchName], {
          encoding: "utf-8",
        }).trim();
        if (!branches) break;
      } catch {
        break;
      }
    }
    counter++;
    slug = `${baseSlug}-${counter}`;
    branchName = `${branchPrefix}/${baseSlug}-${counter}`;
  }

  const wtPath = join(repoWtDir, slug);
  mkdirSync(repoWtDir, { recursive: true });

  // Create git worktree
  execFileSync("git", ["-C", repoRoot, "worktree", "add", wtPath, "-b", branchName], {
    encoding: "utf-8",
  });

  // Assign random color pair
  const idx = Math.floor(Math.random() * BRIGHTS.length);
  const tabColor = BRIGHTS[idx]!;
  const paneColor = DARKS[idx]!;

  // Write .wt.local.json
  const config = { tabColor, paneColor, tabTitle: name };
  await writeFile(join(wtPath, ".wt.local.json"), JSON.stringify(config, null, 2));

  // Copy .worktree-setup if present, run in background tmux session
  let setupRunning = false;
  const setupScript = join(repoRoot, ".worktree-setup");
  if (existsSync(setupScript)) {
    await copyFile(setupScript, join(wtPath, ".worktree-setup"));
    const setupSession = `wt-setup-${repo}-${slug}`.replace(/[.:]/g, "-");

    const tmuxPath = (() => {
      try { return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim(); } catch { return "tmux"; }
    })();

    try {
      execFileSync(tmuxPath, [
        "new-session", "-d", "-s", setupSession, "-c", wtPath,
        `bash -c 'trap "rm -f .wt.setup.running" EXIT; source .worktree-setup 2>&1 | tee .wt.setup.log'`,
      ], { encoding: "utf-8" });
      await writeFile(join(wtPath, ".wt.setup.running"), setupSession);
      setupRunning = true;
    } catch {
      // Setup failed to start, non-fatal
    }
  }

  return { worktree: slug, path: wtPath, tabTitle: name, tabColor, paneColor, setupRunning };
}
