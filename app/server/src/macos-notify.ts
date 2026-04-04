import { execFile, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const HOME = process.env.HOME ?? "";
const TMUX = "/opt/homebrew/bin/tmux";
const AFPLAY = "/usr/bin/afplay";
const WIT_APP = resolve(HOME, "Applications/Wit.app");
const NOTIFY_SOUND = resolve(HOME, ".config/wt/ringtone.mp3");

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
 * Send a macOS notification with the Wit icon.
 * Only sends if the session has a desktop tmux client (i.e. a Ghostty tab).
 * When clicked, focuses the matching Ghostty tab via AppleScript.
 * Plays the user's selected ringtone sound.
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

  // Play the notification sound
  execFile(AFPLAY, [NOTIFY_SOUND], (err) => {
    if (err) console.error("Notification sound failed:", err.message);
  });

  // Write AppleScript that selects the matching tab, then activates Ghostty.
  // select tab before activate so the correct tab is visible when the window appears.
  const escapedSession = session.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const slug = session.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const scriptPath = join(tmpdir(), `wt-focus-${slug}.applescript`);
  writeFileSync(scriptPath, `tell application "Ghostty"
    repeat with w in windows
        repeat with t in tabs of w
            if name of t is "${escapedSession}" then
                select tab t
            end if
        end repeat
    end repeat
    activate
end tell
`);

  // Launch via `open` so macOS registers the app properly for notification clicks
  const args = [
    WIT_APP, "--args",
    "-title", title,
    "-message", body,
    "-group", `wt-${session}`,
    "-execute", `/usr/bin/osascript '${scriptPath}'`,
  ];

  execFile("open", args, (err) => {
    if (err) {
      console.error("Mac notification failed:", err.message);
    }
  });
}
