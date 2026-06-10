import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import app from "./routes";
import { createPaneSession, handleMessage, cleanupStaleSessions, type TerminalSession } from "./pty";
import { activeTerminals } from "./state";

const PORT = parseInt(process.env.WT_SERVER_PORT || "7890", 10);

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// WebSocket terminal route: /terminal/:session/:windowIndex/:paneIndex
app.get(
  "/terminal/:session/:window/:pane",
  upgradeWebSocket((c) => {
    const tmuxSession = decodeURIComponent(c.req.param("session"));
    const windowIndex = parseInt(c.req.param("window"), 10);
    const paneIndex = parseInt(c.req.param("pane"), 10);
    const cols = parseInt(c.req.query("cols") || "80", 10);
    const rows = parseInt(c.req.query("rows") || "24", 10);

    let terminal: TerminalSession | null = null;

    return {
      onOpen(_event, ws) {
        log(`WS open: ${tmuxSession}:${windowIndex}.${paneIndex} (${cols}x${rows})`);
        // Dispose previous connection to this tmux session first
        // so its unzoom completes before we zoom the new pane
        const prev = activeTerminals.get(tmuxSession);
        if (prev) {
          log(`WS open: disposing previous terminal for ${tmuxSession}`);
          prev.dispose();
          activeTerminals.delete(tmuxSession);
        }

        terminal = createPaneSession(
          {
            send: (data: string) => ws.send(data),
            close: (code?: number, reason?: string) => ws.close(code, reason),
          },
          tmuxSession,
          windowIndex,
          paneIndex,
          cols,
          rows
        );
        activeTerminals.set(tmuxSession, terminal);
      },
      onMessage(event) {
        if (terminal) {
          const data = typeof event.data === "string"
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString("utf-8");
          handleMessage(terminal, data);
        }
      },
      onClose() {
        log(`WS close: ${tmuxSession}:${windowIndex}.${paneIndex}`);
        if (terminal) {
          // Only dispose if we're still the active terminal for this session
          if (activeTerminals.get(tmuxSession) === terminal) {
            activeTerminals.delete(tmuxSession);
          }
          terminal.dispose();
          terminal = null;
        }
      },
    };
  })
);

cleanupStaleSessions();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`wt-server listening on http://localhost:${info.port}`);
});

injectWebSocket(server);
