import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { listSessions, listPanes, isTmuxRunning } from "./tmux";
import { readWtConfig, parseConfigPath } from "./worktrees";

const UPLOAD_DIR = "/tmp/wt-uploads";

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

export default app;
