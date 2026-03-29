import * as pty from "node-pty";
import { execFileSync } from "child_process";

export interface TerminalSession {
  ptyProcess: pty.IPty;
  paneTarget: string;
  tmuxPath: string;
  dispose: () => void;
  /** Timer for exiting copy-mode after scroll idle */
  scrollExitTimer?: ReturnType<typeof setTimeout>;
}

interface WsSink {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

let sessionCounter = Date.now();

function tmux(tmuxPath: string, args: string[]): string {
  return execFileSync(tmuxPath, args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Kill any leftover wt-mobile-* sessions from previous server runs */
export function cleanupStaleSessions(): void {
  try {
    const tmuxPath = execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim() || "tmux";
    const sessions = execFileSync(tmuxPath, ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    for (const name of sessions.split("\n")) {
      if (name.startsWith("wt-mobile-")) {
        try { tmux(tmuxPath, ["kill-session", "-t", name]); } catch {}
      }
    }
  } catch {}
}

/**
 * Create an interactive terminal session for a specific tmux pane.
 *
 * Uses a grouped tmux session with the target pane zoomed.
 * The grouped session shares windows with the original but has its own
 * current-window pointer — zoom is per-window so it affects both,
 * but we carefully unzoom on cleanup.
 *
 * @param windowIndex - the tmux window index containing the target pane
 * @param paneIndex - the pane index within that window
 */
export function createPaneSession(
  ws: WsSink,
  tmuxSession: string,
  windowIndex: number,
  paneIndex: number,
  cols: number = 80,
  rows: number = 24
): TerminalSession {
  const tmuxPath = execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim() || "tmux";
  const tempName = `wt-mobile-${++sessionCounter}`;
  const paneTarget = `${tempName}:${windowIndex}.${paneIndex}`;

  // Create a grouped session (shares windows with original, own view state)
  tmux(tmuxPath, ["new-session", "-d", "-s", tempName, "-t", tmuxSession]);

  // Select the correct window and pane, then zoom
  try {
    tmux(tmuxPath, ["select-window", "-t", `${tempName}:${windowIndex}`]);
    tmux(tmuxPath, ["select-pane", "-t", paneTarget]);
    tmux(tmuxPath, ["resize-pane", "-Z", "-t", paneTarget]);
  } catch {
    // Pane may not exist — still attach
  }

  // Send scrollback size so client can show progress
  try {
    const historySize = parseInt(
      tmux(tmuxPath, ["display-message", "-t", paneTarget, "-p", "#{history_size}"]),
      10
    ) || 0;
    ws.send(JSON.stringify({ type: "history", lines: historySize }));
  } catch {}

  // Attach to the temp session
  const ptyProcess = pty.spawn(tmuxPath, ["attach", "-t", tempName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || "/",
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });

  const onData = ptyProcess.onData((data: string) => {
    try { ws.send(data); } catch {}
  });

  const onExit = ptyProcess.onExit(() => {
    try { ws.close(1000, "PTY exited"); } catch {}
  });

  return {
    ptyProcess,
    paneTarget,
    tmuxPath,
    dispose() {
      onData.dispose();
      onExit.dispose();
      try { ptyProcess.kill(); } catch {}

      // Unzoom the pane before killing — zoom is per-window (shared),
      // so we must restore it or the original session's layout breaks
      try {
        const zoomed = tmux(tmuxPath, [
          "display-message", "-t", paneTarget, "-p", "#{window_zoomed_flag}",
        ]);
        if (zoomed === "1") {
          tmux(tmuxPath, ["resize-pane", "-Z", "-t", paneTarget]);
        }
      } catch {}

      // Kill the temp session (windows remain owned by original)
      try {
        tmux(tmuxPath, ["kill-session", "-t", tempName]);
      } catch {}
    },
  };
}

/** Handle resize and scroll messages; all other input goes through ptyProcess.write */
export function handleMessage(
  session: TerminalSession,
  message: string | Buffer
) {
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        session.ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
      if (parsed.type === "scroll" && parsed.lines) {
        handleScroll(session, parsed.lines);
        return;
      }
    } catch {
      // Not JSON — terminal input
    }
    session.ptyProcess.write(message);
  } else {
    session.ptyProcess.write(message.toString("utf-8"));
  }
}

/** Scroll tmux pane via copy-mode (single redraw per batch) */
function handleScroll(session: TerminalSession, lines: number) {
  const { tmuxPath, paneTarget } = session;
  const count = Math.abs(lines);
  if (count === 0) return;

  // positive = scroll up (older), negative = scroll down (newer)
  const cmd = lines > 0 ? "scroll-up" : "scroll-down";

  try {
    // Enter copy-mode (no-op if already in it)
    tmux(tmuxPath, ["copy-mode", "-t", paneTarget]);
    // Scroll N lines in one shot — single redraw
    tmux(tmuxPath, ["send-keys", "-t", paneTarget, "-N", String(count), "-X", cmd]);
  } catch {}

  // Debounced exit: leave copy-mode after 1.5s of no scrolling
  if (session.scrollExitTimer) clearTimeout(session.scrollExitTimer);
  session.scrollExitTimer = setTimeout(() => {
    try {
      tmux(tmuxPath, ["send-keys", "-t", paneTarget, "-X", "cancel"]);
    } catch {}
  }, 1500);
}
