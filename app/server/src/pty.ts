import * as pty from "node-pty";

export interface TerminalSession {
  ptyProcess: pty.IPty;
  dispose: () => void;
}

interface WsSink {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Spawn a PTY attached to a tmux session and pane, bridged to a WebSocket */
export function createTerminalSession(
  ws: WsSink,
  tmuxSession: string,
  paneIndex: number,
  cols: number = 80,
  rows: number = 24
): TerminalSession {
  // Use tmux attach in control mode isn't what we want —
  // we want a real PTY that runs tmux attach so the user gets a full terminal.
  // We select the right pane first, then attach.
  const shell = process.env.SHELL || "/bin/zsh";

  const ptyProcess = pty.spawn(shell, ["-c", `tmux attach -t '${tmuxSession}'`], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });

  // Select the correct pane after attaching
  if (paneIndex > 0) {
    setTimeout(() => {
      ptyProcess.write(`\x1b`); // ensure we're not in any mode
      // Use tmux command-prompt to select the pane
      const selectCmd = `tmux select-pane -t ${paneIndex}\r`;
      // Send as tmux prefix + command - but actually, since we're attached,
      // we should use the tmux command mode. Simpler: just send the keys via tmux CLI.
      const child = Bun.spawn([
        "tmux",
        "select-pane",
        "-t",
        `${tmuxSession}:.${paneIndex}`,
      ]);
      child.unref();
    }, 200);
  }

  // PTY → WebSocket
  const onData = ptyProcess.onData((data: string) => {
    try {
      ws.send(data);
    } catch {
      // WebSocket closed
    }
  });

  const onExit = ptyProcess.onExit(() => {
    try {
      ws.close(1000, "PTY exited");
    } catch {
      // Already closed
    }
  });

  return {
    ptyProcess,
    dispose() {
      onData.dispose();
      onExit.dispose();
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
    },
  };
}

/** Handle an incoming WebSocket message (could be text input or a resize command) */
export function handleMessage(
  session: TerminalSession,
  message: string | Buffer
) {
  if (typeof message === "string") {
    // Try to parse as JSON for resize commands
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        session.ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — treat as terminal input
    }
    session.ptyProcess.write(message);
  } else {
    session.ptyProcess.write(message.toString("utf-8"));
  }
}
