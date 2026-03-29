import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import app from "./routes";
import { createPaneSession, handleMessage, cleanupStaleSessions, type TerminalSession } from "./pty";

const PORT = parseInt(process.env.WT_SERVER_PORT || "7890", 10);

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
        if (terminal) {
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
