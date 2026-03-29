import { execFileSync } from "child_process";
import { homedir } from "os";

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

/** List all panes in a session */
export async function listPanes(sessionName: string): Promise<TmuxPane[]> {
  try {
    const fmt = `#{pane_index}${SEP}#{window_index}${SEP}#{window_name}${SEP}#{pane_active}${SEP}#{pane_width}${SEP}#{pane_height}${SEP}#{pane_title}`;
    const result = tmuxRun(["list-panes", "-t", sessionName, "-s", "-F", fmt]);

    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(SEP);
        return {
          index: parseInt(parts[0] ?? "0", 10),
          windowIndex: parseInt(parts[1] ?? "0", 10),
          windowName: parts[2] ?? "",
          active: parts[3] === "1",
          width: parseInt(parts[4] ?? "0", 10),
          height: parseInt(parts[5] ?? "0", 10),
          title: parts[6] ?? "",
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

/** Check if tmux server is running */
export async function isTmuxRunning(): Promise<boolean> {
  try {
    execFileSync(TMUX, ["has-session"]);
    return true;
  } catch {
    return false;
  }
}
