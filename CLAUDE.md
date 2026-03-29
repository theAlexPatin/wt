# wt — Worktree Companion

Mobile companion app for the `wt` CLI (`~/.scripts/wt/`). Lets you view and interact with tmux sessions from your phone.

## Architecture

```
phone (Expo Go)  ◄── REST + WS ──►  wt-server (target machine)
```

Two packages:
- **`app/server/`** — Node + Hono server. Reads `~/.worktrees/` and tmux state, exposes REST API + WebSocket terminal bridge.
- **`app/mobile/`** — Expo SDK 54 + Expo Router app (iOS). Connects to wt-server instances on your devices.

## Running

```bash
# Server (Node 22 required — see Gotchas)
cd app/server && npx tsx src/index.ts

# Mobile (Expo Go on iOS)
cd app/mobile && npx expo start
```

Server runs on port 7890 by default (`WT_SERVER_PORT` env to override).

### Launch Agent (temporary)

A macOS Launch Agent auto-starts wt-server on login. This is a stopgap — plan is to replace it with a better long-term solution.

- **Plist**: `~/Library/LaunchAgents/com.wt.server.plist`
- **Logs**: `/tmp/wt-server.stdout.log`, `/tmp/wt-server.stderr.log`
- **Node**: Pinned to `~/.nvm/versions/node/v22.12.0/bin` (Node 22 required)

**Dev testing**: The launch agent runs the server in the background. After making changes to server code, you must restart it to pick up changes:
```bash
launchctl unload ~/Library/LaunchAgents/com.wt.server.plist && launchctl load ~/Library/LaunchAgents/com.wt.server.plist
```

To remove:
```bash
launchctl unload ~/Library/LaunchAgents/com.wt.server.plist
rm ~/Library/LaunchAgents/com.wt.server.plist
```

## Server API

### `GET /health`
Returns `{ ok: true, tmux: boolean }`.

### `GET /sessions`
Returns all tmux sessions enriched with wt metadata from `.wt.local.json`:
- `tabColor`, `paneColor`, `tabTitle` — from `@wt_config_path` tmux option
- `repo`, `worktree` — parsed from the config path under `~/.worktrees/`
- `panes[]` — all panes across all windows in the session (each pane has `index`, `windowIndex`, `windowName`)

### `WS /terminal/:session/:window/:pane`
Three path params: tmux session name (URL-encoded), window index, pane index. Query params: `cols`, `rows`.

Interactive terminal connection to a specific pane:
1. Creates a **grouped tmux session** (`tmux new-session -d -s <temp> -t <original>`) — shares windows with the original but has its own view state
2. Selects the target window and pane, then zooms it (`resize-pane -Z`) so only that pane is visible
3. Attaches to the temp session via node-pty, bridges PTY I/O to WebSocket
4. On disconnect: **unzooms the pane first** (zoom is per-window, shared across the group), then kills the temp session

Accepts JSON resize messages: `{ "type": "resize", "cols": N, "rows": N }`.
All other messages are treated as raw terminal input (written directly to PTY).

Temp sessions are named `wt-mobile-<counter>` where counter starts at `Date.now()`. Stale sessions from previous server runs are cleaned up on startup via `cleanupStaleSessions()`.

## Mobile App Screens

### 1. Device List (`app/index.tsx`)
- Saved devices with name, host, port
- Green/red health indicator dot (pings `/health`)
- "Add Device" bottom sheet modal (KeyboardAvoidingView + TouchableWithoutFeedback dismiss)
- Long-press to delete
- Devices persist via Zustand + AsyncStorage

### 2. Session List (`app/[device]/index.tsx`)
- Fetches `GET /sessions` from device's wt-server
- Cards styled with `tabColor` as left border accent
- Shows: `tabTitle`, repo/worktree, pane count, window count, attached badge
- Pull-to-refresh, auto-fetches on screen focus
- Tap passes `sessionIndex` to terminal view

### 3. Terminal (`app/[device]/terminal.tsx`)
- Full-screen xterm.js in a WebView (inline HTML string from `lib/terminalHtml.ts`)
- WebSocket connection to `WS /terminal/:session/:window/:pane`
- **Header**: back chevron (no text), session name with color dot, vertical "▲ N/M ▼" session counter (carets dim at boundaries)
- **Pane bar** (only when >1 pane): horizontal pane dots + "◂ Pane N / M ▸" label (carets dim at boundaries)
- **Full-screen swipe overlay**: transparent touch overlay — vertical swipes switch sessions, horizontal swipes switch panes
- **Swipeable input bar** at bottom: horizontal `ScrollView` with `pagingEnabled`, two pages:
  - **Page 1 (command input)**: ESC (`✕`) + Ctrl+C (`■`) bubbles, glass `BlurView` pill with monospace `TextInput` + colored send button
  - **Page 2 (quick actions)**: `⌨` back button + two-row grid of glass key caps (← ↑ ↓ → Tab ^D ^Z / ^A ^E ^K ^U ^W ^L ^R)
- Page indicator dots (tappable) between terminal and input bar, active dot tinted with `tabColor`
- Haptic feedback on session/pane switch and action key taps
- iOS back gesture disabled (`gestureEnabled: false` in layout)

## Key Implementation Details

### WebView ↔ React Native Communication

The WebView sends messages to RN:
- `{ type: "ready" }` — scripts loaded, safe to send init
- `{ type: "connected" }` — WebSocket to server opened
- `{ type: "disconnected" }` — WebSocket closed
- `{ type: "swipe", direction: "left"|"right"|"up"|"down" }` — touch swipe detected (unreliable, PanResponder overlay is primary)

RN sends messages to WebView via `postMessage`:
- `{ type: "init", wsUrl, paneColor }` — first connection: creates xterm.js Terminal, connects WebSocket
- `{ type: "reconnect", wsUrl, paneColor }` — subsequent connections: closes existing WS, clears terminal, reconnects
- `{ type: "input", data }` — terminal input from the Glass input bar
- `{ type: "disconnect" }` — close WebSocket

The `initialized` state flag tracks whether "init" has been sent. The `webViewReady` flag gates sending any messages until the WebView signals "ready". This prevents race conditions where `postMessage` fires before xterm.js is loaded.

### Swipe Navigation

WebView consumes all touch events (xterm.js + tmux mouse mode), so swipe detection inside the WebView doesn't work. The solution is a **full-screen transparent touch overlay** using raw `onTouchStart/Move/End` events (not PanResponder — avoids `trackedTouchCount` warnings):

- Taps pass through to toggle keyboard focus
- 1-finger vertical swipe → switch session (swipe up = next, down = previous; down dismisses keyboard if visible)
- 1-finger horizontal swipe → switch pane (swipe left = next, right = previous)
- 2-finger vertical → scroll terminal history (velocity-accelerated)

### Swipeable Input Bar

The bottom input bar is a horizontal `ScrollView` with `pagingEnabled` containing two pages. Swipe left for quick action keys, swipe right (or tap `⌨`) for the command input.

**Keyboard independence**: Swiping between pages must NOT open or close the keyboard. This is achieved by:
- `TextInput` has `pointerEvents="none"` — prevents accidental focus during swipe gestures
- `inputWrap` is a `Pressable` that programmatically focuses the `TextInput` on tap (only fires on completed taps, not swipes)
- `keyboardShouldPersistTaps="always"` on the ScrollView — prevents keyboard dismissal when tapping action buttons or the `⌨` back button
- No `Keyboard.dismiss()` calls in page change handlers

The keyboard is controlled exclusively by tapping the terminal overlay (focus/blur toggle) and the `inputWrap` Pressable (focus). Page switching is fully independent.

### Pane Isolation (Desktop Safety)

Viewing a pane on mobile must NOT affect the tmux layout on the desktop. The grouped session approach (`tmux new-session -d -s temp -t original`) creates a temporary session that shares windows with the original. However, **zoom is per-window and shared across the group**, so:
- On connect: zoom the target pane in the temp session
- On disconnect: **unzoom before killing** the temp session, otherwise the original session's layout breaks
- The `dispose()` function checks `#{window_zoomed_flag}` and unzooms if needed

### Session/Pane Navigation
- Switching sessions resets pane index to 0
- Switching panes within a session keeps the session index
- Navigation wraps around (modular arithmetic) — last session wraps to first and vice versa

### tmux Data Layer
- `tmux list-sessions` with `|||` separator (not `\t`) to avoid shell interpolation issues
- `@wt_config_path` read via `tmux show-options -t <session> -v` with `stdio: ["pipe", "pipe", "pipe"]` to suppress stderr for sessions without the option
- `tmux list-panes -t <session> -s` with `-s` flag to list panes across all windows

## Dependencies & Gotchas

### Server
- **Node 22 required** — node-pty v1.0.0 needs it. Does NOT work with Bun (node-pty FFI incompatible) or Node 24 (metro `ERR_PACKAGE_PATH_NOT_EXPORTED`).
- **node-pty v1.0.0** — v1.1.0 has a `posix_spawnp failed` bug on macOS. Pin to 1.0.0.
- **hono** + **@hono/node-server** + **@hono/node-ws** — HTTP + WebSocket server
- **tsx** — TypeScript execution (replaces Bun runtime)
- `execFileSync` from `child_process` for all tmux commands (not Bun shell)

### Mobile
- **Expo SDK 54** — must match Expo Go version on phone. `create-expo-app@latest` installs canary/55; manually pin to `~54.0.0`.
- **expo-router** v6 — file-based routing. Entry point is `"main": "expo-router/entry"` in package.json.
- **react-native-reanimated ~3.16.1** — NOT v4. v4 requires `react-native-worklets/plugin` which isn't available.
- **babel-preset-expo ~54.0.10** — NOT canary. Canary versions pull in incompatible reanimated babel plugin.
- **react-native-gesture-handler** — installed but its `Gesture` API crashes in Expo Go (`Exception in HostFunction: <unknown>`). Do NOT import from `react-native-gesture-handler` directly. Use RN's built-in `PanResponder` instead.
- **react-native-webview** — xterm.js rendering. Use `source={{ html: TERMINAL_HTML }}` with inline HTML string. `require("./asset.html")` returns an asset ID, not loadable HTML.
- **No GestureHandlerRootView** in root layout — crashes Expo Go. Use plain `View`.
- xterm.js + fit addon loaded from CDN in the inline HTML (`cdn.jsdelivr.net`).

## Repo Structure

```
wt/
├── CLAUDE.md
├── app/
│   ├── server/          # wt-server (Node + Hono)
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts     # Entry, Hono server + WS upgrade + cleanup
│   │       ├── routes.ts    # REST routes (/health, /sessions)
│   │       ├── tmux.ts      # tmux CLI wrappers (list-sessions, list-panes)
│   │       ├── pty.ts       # PTY spawn, grouped session, zoom/unzoom
│   │       └── worktrees.ts # ~/.worktrees/ + .wt.local.json reader
│   └── mobile/          # Expo app
│       ├── package.json
│       ├── babel.config.js  # Just babel-preset-expo, no reanimated plugin
│       ├── app/             # Expo Router screens
│       │   ├── _layout.tsx      # Root layout (plain View, no GestureHandlerRootView)
│       │   ├── index.tsx        # Device list + add modal
│       │   └── [device]/
│       │       ├── _layout.tsx  # gestureEnabled: false on terminal
│       │       ├── index.tsx    # Session list
│       │       └── terminal.tsx # Terminal view + swipe overlay
│       └── lib/
│           ├── api.ts           # REST client + terminalWsUrl builder
│           ├── store.ts         # Zustand + AsyncStorage (devices)
│           ├── types.ts         # Device, Session, SessionPane interfaces
│           └── terminalHtml.ts  # Inline xterm.js HTML string
└── cli/                 # (planned) wt CLI source
```
