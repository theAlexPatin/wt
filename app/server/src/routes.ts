import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { listSessions, listPanes, isTmuxRunning, createSession, killSession, renameSession, splitPane, killPane, capturePane, getSessionOption } from "./tmux";
import { readWtConfig, parseConfigPath } from "./worktrees";
import { activeTerminals } from "./state";

const UPLOAD_DIR = "/tmp/wt-uploads";

const expo = new Expo();
const pushTokens = new Map<string, string>(); // deviceId → ExpoPushToken

const app = new Hono();

app.use("*", cors());

app.get("/health", async (c) => {
  const tmuxUp = await isTmuxRunning();
  return c.json({ ok: true, tmux: tmuxUp });
});

app.get("/sessions", async (c) => {
  const sessions = await listSessions();

  const enriched = await Promise.all(
    sessions.map(async (session) => {
      const panes = await listPanes(session.name);

      let config: {
        tabColor?: string;
        paneColor?: string;
        tabTitle?: string;
      } = {};
      let repo: string | undefined;
      let worktree: string | undefined;

      if (session.configPath) {
        config = await readWtConfig(session.configPath);
        const parsed = parseConfigPath(session.configPath);
        if (parsed) {
          repo = parsed.repo;
          worktree = parsed.worktree;
        }
      }

      // Fall back to direct tmux session options (set by `theme` command)
      if (!config.tabColor) {
        config.tabColor = getSessionOption(session.name, "@wt_tab_color");
      }
      if (!config.paneColor) {
        config.paneColor = getSessionOption(session.name, "@wt_pane_color");
      }

      return {
        id: session.name,
        name: session.name,
        tabTitle: config.tabTitle || session.name,
        tabColor: config.tabColor,
        paneColor: config.paneColor,
        windowCount: session.windowCount,
        panes: panes.map((p) => ({
          index: p.index,
          windowIndex: p.windowIndex,
          windowName: p.windowName,
          active: p.active,
          size: `${p.width}x${p.height}`,
        })),
        repo,
        worktree,
        attached: session.attached,
        created: session.created.toISOString(),
      };
    })
  );

  return c.json(enriched);
});

app.post("/sessions", async (c) => {
  try {
    const name = createSession();
    return c.json({ name });
  } catch {
    return c.json({ error: "Failed to create session" }, 500);
  }
});

app.delete("/sessions/:name", async (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  try {
    killSession(name);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Failed to kill session" }, 500);
  }
});

app.post("/sessions/:name/rename", async (c) => {
  const oldName = decodeURIComponent(c.req.param("name"));
  try {
    const { name: newName } = await c.req.json();
    renameSession(oldName, newName);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Failed to rename session" }, 500);
  }
});

// --- Pane operations ---

app.post("/sessions/:name/panes/split", async (c) => {
  const sessionName = decodeURIComponent(c.req.param("name"));
  try {
    const { windowIndex, paneIndex, direction } = await c.req.json();
    splitPane(sessionName, windowIndex, paneIndex, direction);
    const panes = await listPanes(sessionName);
    return c.json({ panes: panes.map((p) => ({
      index: p.index,
      windowIndex: p.windowIndex,
      windowName: p.windowName,
      active: p.active,
      size: `${p.width}x${p.height}`,
    })) });
  } catch {
    return c.json({ error: "Failed to split pane" }, 500);
  }
});

app.delete("/sessions/:name/panes/:windowIndex/:paneIndex", async (c) => {
  const sessionName = decodeURIComponent(c.req.param("name"));
  const windowIndex = parseInt(c.req.param("windowIndex"), 10);
  const paneIndex = parseInt(c.req.param("paneIndex"), 10);
  try {
    const sessionKilled = killPane(sessionName, windowIndex, paneIndex);
    if (sessionKilled) {
      return c.json({ panes: [], sessionKilled: true });
    }
    const panes = await listPanes(sessionName);
    return c.json({ panes: panes.map((p) => ({
      index: p.index,
      windowIndex: p.windowIndex,
      windowName: p.windowName,
      active: p.active,
      size: `${p.width}x${p.height}`,
    })), sessionKilled: false });
  } catch {
    return c.json({ error: "Failed to kill pane" }, 500);
  }
});

app.get("/sessions/:name/panes/:windowIndex/:paneIndex/capture", async (c) => {
  const sessionName = decodeURIComponent(c.req.param("name"));
  const windowIndex = parseInt(c.req.param("windowIndex"), 10);
  const paneIndex = parseInt(c.req.param("paneIndex"), 10);
  const lines = parseInt(c.req.query("lines") ?? "10", 10);
  try {
    const text = capturePane(sessionName, windowIndex, paneIndex, lines);
    return c.json({ text });
  } catch {
    return c.json({ error: "Failed to capture pane" }, 500);
  }
});

app.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
  const filename = `${Date.now()}${ext}`;
  const filePath = join(UPLOAD_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filePath, buffer);

  return c.json({ path: filePath });
});

// Push notification token registration
app.post("/push-token", async (c) => {
  const { token, deviceId } = await c.req.json();
  if (!token || !deviceId) {
    return c.json({ error: "token and deviceId required" }, 400);
  }
  if (!Expo.isExpoPushToken(token)) {
    return c.json({ error: "Invalid Expo push token" }, 400);
  }
  pushTokens.set(deviceId, token);
  console.log(`Push token registered for device ${deviceId}`);
  return c.json({ ok: true });
});

app.delete("/push-token/:deviceId", async (c) => {
  const deviceId = decodeURIComponent(c.req.param("deviceId"));
  pushTokens.delete(deviceId);
  return c.json({ ok: true });
});

// Send push notification to all registered devices
// Suppressed if the user is actively viewing the session on mobile
app.post("/notify", async (c) => {
  const { title, body, session, windowIndex, paneIndex } = await c.req.json();

  if (!body) {
    return c.json({ error: "body is required" }, 400);
  }

  // If someone is actively viewing this session via a WebSocket terminal
  // connection, skip the notification — they're already looking at it
  if (session && activeTerminals.has(session)) {
    return c.json({ ok: true, sent: 0, suppressed: true });
  }

  if (pushTokens.size === 0) {
    return c.json({ ok: true, sent: 0 });
  }

  const messages: ExpoPushMessage[] = [];
  for (const [deviceId, token] of pushTokens) {
    messages.push({
      to: token,
      sound: "default",
      title: title || "Wit",
      body,
      data: { deviceId, sessionId: session, windowIndex, paneIndex },
    });
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tokensToRemove: string[] = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket: ExpoPushTicket, i: number) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const msg = chunk[i];
          const deviceId = [...pushTokens.entries()].find(([, t]) => t === msg.to)?.[0];
          if (deviceId) tokensToRemove.push(deviceId);
        }
      });
    } catch (err) {
      console.error("Failed to send push notifications:", err);
    }
  }

  for (const id of tokensToRemove) {
    pushTokens.delete(id);
    console.log(`Removed invalid token for device ${id}`);
  }

  return c.json({ ok: true, sent: messages.length });
});

export default app;
