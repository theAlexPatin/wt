import * as pty from "node-pty";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

export interface TerminalSession {
  ptyProcess: pty.IPty;
  paneTarget: string;
  /** Pane target on the original session (not the temp grouped session) */
  originalPaneTarget: string;
  tmuxPath: string;
  ws: WsSink;
  /** Current terminal dimensions — used to aim synthesized mouse-wheel events */
  cols: number;
  rows: number;
  /** Cached #{mouse_any_flag} for the pane, and when it was last read */
  mouseAppActive?: boolean;
  mouseCheckedAt?: number;
  dispose: () => void;
  /** Timer for exiting copy-mode after scroll idle (copy-mode fallback only) */
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
  const originalPaneTarget = `${tmuxSession}:${windowIndex}.${paneIndex}`;

  // Create a grouped session (shares windows with original, own view state)
  tmux(tmuxPath, ["new-session", "-d", "-s", tempName, "-t", tmuxSession]);

  // Hide the status bar — mobile has its own chrome
  tmux(tmuxPath, ["set-option", "-t", tempName, "status", "off"]);

  // Ensure tmux sends exact 24-bit RGB colors instead of approximating to 256-color
  // palette (e.g. #0c2d22 → palette 16 → #000000). Window-level bg= styles are shared
  // across the grouped session and can't be removed without affecting the original.
  try {
    const overrides = tmux(tmuxPath, ["show-options", "-s", "terminal-overrides"]);
    if (!overrides.includes("Tc")) {
      tmux(tmuxPath, ["set-option", "-sa", "terminal-overrides", ",xterm-256color:Tc"]);
    }
  } catch {
    try { tmux(tmuxPath, ["set-option", "-sa", "terminal-overrides", ",xterm-256color:Tc"]); } catch {}
  }
  // tmux 3.2+ uses terminal-features instead of terminal-overrides
  try {
    tmux(tmuxPath, ["set-option", "-as", "terminal-features", "xterm-256color:RGB"]);
  } catch {}

  // Re-apply window-style with the paneColor hex after enabling true color.
  // tmux may have parsed the original bg= value using 256-color approximation;
  // re-setting it now forces re-evaluation with Tc/RGB enabled.
  try {
    let paneColor: string | undefined;
    const configPath = tmux(tmuxPath, ["show-options", "-t", tmuxSession, "-v", "@wt_config_path"]);
    if (configPath) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      paneColor = config.paneColor;
    }
    if (paneColor) {
      tmux(tmuxPath, ["set-option", "-w", "-t", `${tempName}:${windowIndex}`, "window-style", `bg=${paneColor}`]);
      tmux(tmuxPath, ["set-option", "-w", "-t", `${tempName}:${windowIndex}`, "window-active-style", `bg=${paneColor}`]);
    }
  } catch {}

  // Select the correct window and pane, then zoom
  try {
    tmux(tmuxPath, ["select-window", "-t", `${tempName}:${windowIndex}`]);
    tmux(tmuxPath, ["select-pane", "-t", paneTarget]);
    tmux(tmuxPath, ["resize-pane", "-Z", "-t", paneTarget]);
  } catch {
    // Pane may not exist — still attach
  }

  // Send pane metadata so client knows what's running
  try {
    const currentCommand = tmux(tmuxPath, [
      "display-message", "-t", paneTarget, "-p", "#{pane_current_command}",
    ]);
    const paneTitle = tmux(tmuxPath, [
      "display-message", "-t", paneTarget, "-p", "#{pane_title}",
    ]);
    const isClaudeCode = paneTitle.includes("Claude Code") || /^\d+\.\d+\.\d+/.test(currentCommand);
    ws.send(JSON.stringify({ type: "paneInfo", isClaudeCode }));
  } catch {}

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
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
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
    originalPaneTarget,
    tmuxPath,
    ws,
    cols,
    rows,
    dispose() {
      onData.dispose();
      onExit.dispose();
      try { ptyProcess.kill(); } catch {}

      // Clear any pending scroll-exit timer so it doesn't fire after
      // the temp session is dead (which would leave copy-mode stuck)
      if (this.scrollExitTimer) {
        clearTimeout(this.scrollExitTimer);
        this.scrollExitTimer = undefined;
      }

      // Cancel copy-mode on the original session's pane — the temp session
      // is about to be killed, so targeting it would silently fail
      try {
        tmux(tmuxPath, ["send-keys", "-t", originalPaneTarget, "-X", "cancel"]);
      } catch {}

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
        session.cols = parsed.cols;
        session.rows = parsed.rows;
        return;
      }
      if (parsed.type === "scroll" && parsed.lines) {
        handleScroll(session, parsed.lines);
        return;
      }
      if (parsed.type === "ping") {
        // Client uses pong to detect half-open sockets after iOS suspension
        try { session.ws.send(JSON.stringify({ type: "pong" })); } catch {}
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

/**
 * Scroll the pane, choosing the mechanism per the app running in it.
 *
 * Panes whose app has enabled mouse reporting (Claude Code, vim, less, …)
 * render on the alternate screen and keep their own scrollback — tmux copy-mode
 * has no history to scroll there, so a copy-mode scroll is a silent no-op. For
 * those we synthesize SGR mouse-wheel events and write them straight to the PTY,
 * exactly as a desktop terminal would; tmux forwards them and the app scrolls
 * its own view.
 *
 * Plain panes (a shell at a prompt) don't want mouse events, so we drive tmux
 * copy-mode directly — precise 1-line-per-step scrolling through the pane's real
 * scrollback, with a debounced exit back to the live view.
 *
 * #{mouse_any_flag} flips when an app is launched or exits, so we re-read it, but
 * cache for 250ms so a fast drag doesn't spawn a tmux process per scroll batch.
 */
function handleScroll(session: TerminalSession, lines: number) {
  const { tmuxPath, paneTarget } = session;
  const count = Math.abs(lines);
  if (count === 0) return;

  const now = Date.now();
  if (session.mouseCheckedAt === undefined || now - session.mouseCheckedAt > 250) {
    try {
      session.mouseAppActive =
        tmux(tmuxPath, ["display-message", "-p", "-t", paneTarget, "#{mouse_any_flag}"]) === "1";
    } catch {}
    session.mouseCheckedAt = now;
  }

  if (session.mouseAppActive) {
    // SGR mouse encoding: button 64 = wheel up, 65 = wheel down. Coordinates are
    // 1-based; aim at the middle of the (zoomed, full-screen) pane so the event
    // always lands inside it. One event per line keeps parity with the copy-mode
    // path; tune on-device if a wheel notch scrolls the app more than one line.
    const button = lines > 0 ? 64 : 65;
    const col = Math.max(1, Math.floor(session.cols / 2));
    const row = Math.max(1, Math.floor(session.rows / 2));
    const event = `\x1b[<${button};${col};${row}M`;
    try { session.ptyProcess.write(event.repeat(count)); } catch {}
    return;
  }

  // Copy-mode fallback for plain panes: positive = up (older), negative = down.
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
