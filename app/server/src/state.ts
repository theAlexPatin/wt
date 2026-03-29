import type { TerminalSession } from "./pty";

// Active WebSocket terminal connections, keyed by tmux session name.
// Shared between index.ts (writes) and routes.ts (reads for notification suppression).
export const activeTerminals = new Map<string, TerminalSession>();
