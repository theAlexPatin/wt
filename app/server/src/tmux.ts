const SEP = "|||";

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

/** List all tmux sessions with their @wt_config_path option */
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    const fmt = `#{session_name}${SEP}#{session_windows}${SEP}#{session_attached}${SEP}#{session_created}`;
    const proc = Bun.spawnSync(["tmux", "list-sessions", "-F", fmt]);
    const result = proc.stdout.toString();

    const sessions: TmuxSession[] = [];

    for (const line of result.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split(SEP);
      const name = parts[0] ?? "";
      const windows = parts[1] ?? "0";
      const attached = parts[2] ?? "0";
      const created = parts[3] ?? "0";

      // Read the @wt_config_path option for this session
      let configPath: string | undefined;
      try {
        const optProc = Bun.spawnSync(["tmux", "show-options", "-t", name, "-v", "@wt_config_path"]);
        const optVal = optProc.stdout.toString().trim();
        configPath = optVal || undefined;
      } catch {
        // Session doesn't have this option set — not a wt session
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
    // tmux not running or no sessions
    return [];
  }
}

/** List all panes in a session */
export async function listPanes(sessionName: string): Promise<TmuxPane[]> {
  try {
    const fmt = `#{pane_index}${SEP}#{window_index}${SEP}#{window_name}${SEP}#{pane_active}${SEP}#{pane_width}${SEP}#{pane_height}${SEP}#{pane_title}`;
    const proc = Bun.spawnSync(["tmux", "list-panes", "-t", sessionName, "-s", "-F", fmt]);
    const result = proc.stdout.toString();

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

/** Check if tmux server is running */
export async function isTmuxRunning(): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["tmux", "has-session"]);
    if (proc.exitCode !== 0) return false;
    return true;
  } catch {
    return false;
  }
}
