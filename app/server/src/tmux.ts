import { execFileSync } from "child_process";
import { homedir } from "os";
import type { WtConfig } from "./worktrees";

const SEP = "|||";

/** Resolve tmux binary path once — Launch Agent PATH may not include /opt/homebrew/bin */
const TMUX = (() => {
  try {
    return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim() || "tmux";
  } catch {
    return "tmux";
  }
})();

export interface TmuxSession {
  name: string;
  windowCount: number;
  attached: boolean;
  created: Date;
  configPath?: string;
}

export interface TmuxPane {
  index: number;
  windowIndex: number;
  windowName: string;
  active: boolean;
  width: number;
  height: number;
  title: string;
  currentCommand: string;
  isClaudeCode: boolean;
}

function tmuxRun(args: string[]): string {
  return execFileSync(TMUX, args, { encoding: "utf-8" });
}

/** List all tmux sessions with their @wt_config_path option */
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    const fmt = `#{session_name}${SEP}#{session_windows}${SEP}#{session_attached}${SEP}#{session_created}`;
    const result = tmuxRun(["list-sessions", "-F", fmt]);

    const sessions: TmuxSession[] = [];

    for (const line of result.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split(SEP);
      const name = parts[0] ?? "";
      if (name.startsWith("wt-mobile-")) continue;
      const windows = parts[1] ?? "0";
      const attached = parts[2] ?? "0";
      const created = parts[3] ?? "0";

      let configPath: string | undefined;
      try {
        const optVal = execFileSync(TMUX, ["show-options", "-t", name, "-v", "@wt_config_path"], {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        configPath = optVal || undefined;
      } catch {
        // Session doesn't have this option set
      }

      sessions.push({
        name,
        windowCount: parseInt(windows, 10),
        attached: attached === "1",
        created: new Date(parseInt(created, 10) * 1000),
        configPath,
      });
    }

    return sessions;
  } catch {
    return [];
  }
}

/** Read a tmux session user option (e.g. @wt_tab_color) */
export function getSessionOption(sessionName: string, option: string): string | undefined {
  try {
    return execFileSync(TMUX, ["show-options", "-t", sessionName, "-v", option], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** List all panes in a session */
export async function listPanes(sessionName: string): Promise<TmuxPane[]> {
  try {
    const fmt = `#{pane_index}${SEP}#{window_index}${SEP}#{window_name}${SEP}#{pane_active}${SEP}#{pane_width}${SEP}#{pane_height}${SEP}#{pane_title}${SEP}#{pane_current_command}`;
    const result = tmuxRun(["list-panes", "-t", sessionName, "-s", "-F", fmt]);

    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(SEP);
        const title = parts[6] ?? "";
        const currentCommand = parts[7] ?? "";
        // Claude Code sets pane_title to "Claude Code" (with optional status prefix)
        // and pane_current_command to its semver version (e.g. "2.1.91")
        const isClaudeCode = title.includes("Claude Code") || /^\d+\.\d+\.\d+/.test(currentCommand);
        return {
          index: parseInt(parts[0] ?? "0", 10),
          windowIndex: parseInt(parts[1] ?? "0", 10),
          windowName: parts[2] ?? "",
          active: parts[3] === "1",
          width: parseInt(parts[4] ?? "0", 10),
          height: parseInt(parts[5] ?? "0", 10),
          title,
          currentCommand,
          isClaudeCode,
        };
      });
  } catch {
    return [];
  }
}

/** Create a new detached tmux session in $HOME, return its name */
export function createSession(): string {
  return tmuxRun(["new-session", "-d", "-P", "-F", "#{session_name}", "-c", homedir()]).trim();
}

/** Kill a tmux session by name */
export function killSession(name: string): void {
  tmuxRun(["kill-session", "-t", name]);
}

/** Rename a tmux session */
export function renameSession(oldName: string, newName: string): void {
  tmuxRun(["rename-session", "-t", oldName, newName]);
}

/** Split a pane, creating a new one adjacent to it */
export function splitPane(
  sessionName: string,
  windowIndex: number,
  paneIndex: number,
  direction: "horizontal" | "vertical" = "vertical"
): void {
  const target = `${sessionName}:${windowIndex}.${paneIndex}`;
  tmuxRun(["split-window", "-t", target, direction === "horizontal" ? "-h" : "-v"]);
}

/** Kill a specific pane. Returns true if the session was killed (last pane). */
export function killPane(
  sessionName: string,
  windowIndex: number,
  paneIndex: number
): boolean {
  const target = `${sessionName}:${windowIndex}.${paneIndex}`;
  tmuxRun(["kill-pane", "-t", target]);
  // Check if session still exists
  try {
    tmuxRun(["has-session", "-t", sessionName]);
    return false;
  } catch {
    return true; // session was killed
  }
}

/** Capture the last N lines of a pane's visible content */
export function capturePane(
  sessionName: string,
  windowIndex: number,
  paneIndex: number,
  lines: number = 10
): string {
  const target = `${sessionName}:${windowIndex}.${paneIndex}`;
  return tmuxRun(["capture-pane", "-t", target, "-p", "-J", "-S", String(-lines)]);
}

/** Check if a specific tmux session exists */
export function sessionExists(name: string): boolean {
  try {
    tmuxRun(["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a fully-configured tmux session for a worktree.
 * Replicates what `wt cd` / `__wt_enter_tmux` does, but server-side.
 * Returns the session name.
 */
export function createSessionInWorktree(
  wtPath: string,
  config: WtConfig,
): string {
  // Compute session name from config title, falling back to directory name
  let sessionName = config.tabTitle || wtPath.split("/").pop() || "session";
  // Slashes aren't valid in tmux session names
  sessionName = sessionName.replace(/\//g, "-");

  // If session already exists, return it (idempotent)
  if (sessionExists(sessionName)) {
    return sessionName;
  }

  // Create detached session with correct working directory
  tmuxRun(["new-session", "-d", "-s", sessionName, "-c", wtPath]);

  // Set @wt_config_path so the session list can find config
  const configPath = `${wtPath}/.wt.local.json`;
  tmuxRun(["set-option", "-t", sessionName, "@wt_config_path", configPath]);

  // Set session-renamed hook for persistence
  const hookCmd = `run-shell '${homedir()}/.scripts/wt/_on_session_rename.sh'`;
  tmuxRun(["set-hook", "-t", sessionName, "session-renamed", hookCmd]);

  // Apply pane background color
  if (config.paneColor) {
    tmuxRun(["set-option", "-t", sessionName, "-w", "window-style", `bg=${config.paneColor}`]);
    tmuxRun(["set-option", "-t", sessionName, "-w", "window-active-style", `bg=${config.paneColor}`]);
  }

  return sessionName;
}

/** Check if tmux server is running */
export async function isTmuxRunning(): Promise<boolean> {
  try {
    execFileSync(TMUX, ["has-session"]);
    return true;
  } catch {
    return false;
  }
}
