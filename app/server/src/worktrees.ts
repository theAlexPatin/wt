import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface WtConfig {
  tabColor?: string;
  paneColor?: string;
  tabTitle?: string;
}

const WORKTREES_DIR = join(homedir(), ".worktrees");

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
