import app from "./routes";
import { createTerminalSession, handleMessage, type TerminalSession } from "./pty";

const PORT = parseInt(process.env.WT_SERVER_PORT || "7890", 10);

interface WsData {
  tmuxSession: string;
  paneIndex: number;
  cols: number;
  rows: number;
}

// Track active terminal sessions by WebSocket
const terminals = new Map<object, TerminalSession>();

const server = Bun.serve<WsData>({
  port: PORT,
  fetch: async (req, server) => {
    const url = new URL(req.url);

    // Handle WebSocket upgrade for terminal connections
    const match = url.pathname.match(/^\/terminal\/(.+?)\/(\d+)$/);
    if (match && req.headers.get("upgrade") === "websocket") {
      const session = match[1] ?? "";
      const pane = match[2] ?? "0";
      const cols = parseInt(url.searchParams.get("cols") || "80", 10);
      const rows = parseInt(url.searchParams.get("rows") || "24", 10);

      const upgraded = server.upgrade(req, {
        data: {
          tmuxSession: decodeURIComponent(session),
          paneIndex: parseInt(pane, 10),
          cols,
          rows,
        },
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // Delegate to Hono for REST routes
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      const { tmuxSession, paneIndex, cols, rows } = ws.data;

      const session = createTerminalSession(
        ws,
        tmuxSession,
        paneIndex,
        cols,
        rows
      );
      terminals.set(ws, session);
    },
    message(ws, message) {
      const session = terminals.get(ws);
      if (session) {
        handleMessage(session, message as string | Buffer);
      }
    },
    close(ws) {
      const session = terminals.get(ws);
      if (session) {
        session.dispose();
        terminals.delete(ws);
      }
    },
  },
});

console.log(`wt-server listening on http://localhost:${server.port}`);
