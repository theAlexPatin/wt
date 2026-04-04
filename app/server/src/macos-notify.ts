import { execFile, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Custom terminal-notifier bundle with Wit icon baked in
const WIT_NOTIFIER = resolve(dirname(fileURLToPath(import.meta.url)), "../notifier/Wit.app/Contents/MacOS/terminal-notifier");
const TMUX = "/opt/homebrew/bin/tmux";

/**
 * Check whether the given tmux session has a desktop client attached.
 * A desktop client means there's a Ghostty tab showing this session.
 */
function hasDesktopClient(session: string): boolean {
  try {
    const output = execFileSync(TMUX, [
      "list-clients", "-t", session, "-F", "#{client_tty}",
    ], { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Send a macOS notification via terminal-notifier.
 * Only sends if the session has a desktop tmux client (i.e. a Ghostty tab).
 * When clicked, focuses the matching Ghostty tab via AppleScript.
 */
export function sendMacNotification(opts: {
  title: string;
  body: string;
  session?: string;
  windowIndex?: number;
  paneIndex?: number;
}): void {
  const { title, body, session } = opts;

  // No session or no desktop client → no Ghostty tab to focus → skip
  if (!session || !hasDesktopClient(session)) {
    return;
  }

  // Write an AppleScript file that finds and selects the matching Ghostty tab.
  // Using a file avoids shell quoting issues with session names.
  const escapedSession = session.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const slug = session.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const scriptPath = join(tmpdir(), `wt-focus-${slug}.applescript`);
  writeFileSync(scriptPath, `tell application "Ghostty"
    activate
    repeat with w in windows
        repeat with t in tabs of w
            if name of t is "${escapedSession}" then
                select tab t
                activate window w
                return
            end if
        end repeat
    end repeat
end tell
`);

  const args: string[] = [
    "-title", title,
    "-message", body,
    "-sound", "default",
    "-group", `wt-${session}`,
    "-execute", `/usr/bin/osascript '${scriptPath}'`,
  ];

  execFile(WIT_NOTIFIER, args, (err) => {
    if (err) {
      console.error("Mac notification failed:", err.message);
    }
  });
}
