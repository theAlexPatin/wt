# Touch System — Agent Work Summary

Two agents independently modified the terminal screen's touch system. This doc explains what each built so an architect can consolidate.

---

## Agent A: "wt-companion-app-plan" (pane 0.0)

**Focus:** Scroll system, swipe navigation foundation

### Work done (chronological):

1. **PanResponder overlay** — initial implementation for 1-finger swipe (session/pane switching) and 2-finger scroll detection. Abandoned due to `trackedTouchCount` multi-touch warnings.

2. **Raw touch handlers (attempt 1)** — replaced PanResponder with `onTouchStart`/`onTouchMove`/`onTouchEnd` + responder props (`onStartShouldSetResponder`, etc.) on the same View. Fixed multi-touch detection but responder props caused the same `trackedTouchCount` warnings.

3. **Scroll pipeline (3 iterations)**:
   - v1: `term.scrollLines()` — scrolled xterm.js local buffer. Didn't work because tmux owns all scrollback.
   - v2: SGR mouse wheel escape sequences (`\x1b[<64;1;1M`) — worked but each sequence triggered a separate tmux redraw, causing stutter.
   - v3 (current): Server-side `handleScroll()` — enters tmux `copy-mode`, sends `send-keys -N <count> -X scroll-up/down` for single-redraw batch scrolling. Auto-exits copy-mode after 1.5s idle.

4. **Velocity-based scroll acceleration** — smoothed velocity tracking (exponential moving average), multiplier from 1x-5x based on finger speed. Batched at 60fps via `requestAnimationFrame`.

5. **WebView scroll message handler** — `terminalHtml.ts` forwards `{ type: "scroll", lines }` messages from RN through the WebSocket to the server.

6. **Keyboard-aware swipe down** — swipe down while keyboard is open dismisses keyboard instead of switching panes.

### Files modified:
- `app/[device]/terminal.tsx` — touch handlers, scroll accumulation, velocity tracking
- `lib/terminalHtml.ts` — scroll message forwarding to WebSocket
- `server/src/pty.ts` — `handleScroll()`, `TerminalSession` interface (`paneTarget`, `tmuxPath`, `scrollExitTimer` fields), copy-mode management

---

## Agent B: "Add glass-style text input" (pane 0.3)

**Focus:** Input UX, keyboard management, action buttons

### Work done (chronological):

1. **KeyboardAvoidingView fix** — added `keyboardVerticalOffset={headerHeight}` using `useHeaderHeight()` from `@react-navigation/elements`. Without this, the input bar was hidden behind the keyboard.

2. **Multiline TextInput** — changed from single-line to `multiline` with `maxHeight: 80px` (~4 lines). First attempt used `onContentSizeChange` + dynamic height state, which caused a jitter feedback loop. Simplified to just `maxHeight` on the style.

3. **`\n` → `\r` fix** — changed Enter key from linefeed to carriage return. Bash's tty driver handles both, but raw-mode TUI apps (Claude, Amp) only recognize `\r` as Enter.

4. **Tap-to-toggle keyboard** — tapping the terminal area opens keyboard (focuses TextInput) or dismisses it if already open. Went through several iterations:
   - Attempt 1: responder `onResponderRelease` — never fired for taps (`trackedTouchCount` warnings)
   - Attempt 2: deferred `focus()` via `setTimeout(…, 0)` inside responder — still didn't fire
   - Attempt 3 (current): direct `onTouchEnd` handler, completely independent of responder system

5. **Scroll guard for keyboard toggle** — `lastScrollTime` ref prevents keyboard toggle within 300ms of 2-finger scroll activity.

6. **Dropped responder system entirely** — replaced all `onStartShouldSetResponder`/`onMoveShouldSetResponder`/`onResponderGrant`/`onResponderMove`/`onResponderRelease` with pure `onTouchStart`/`onTouchMove`/`onTouchEnd`. Eliminates `trackedTouchCount` warnings.

7. **Action bubbles** — Esc (✕, sends `\x1b`) and Ctrl+C (■, sends `\x03`) as circular buttons to the left of the input pill. Uses `sendRaw()` helper.

### Files modified:
- `app/[device]/terminal.tsx` — input bar, keyboard toggle, touch handler rewrite, action buttons

---

## Overlap & Conflicts

### Same code, different changes
Both agents modified the touch handler section of `terminal.tsx`. The final file has Agent B's pure-touch-event approach, but incorporates Agent A's scroll logic (velocity, batching, `flushScroll`).

### Specific conflicts:

| Area | Agent A | Agent B | Current state |
|------|---------|---------|---------------|
| Touch system | responder + touch events | pure touch events | Agent B's approach (no responder) |
| `touchRef` shape | Added `velocity`, `scrollPending`, `scrollRaf`, `lastMoveTime` | Added `lastScrollTime`, `time` | Merged — has all fields |
| `maxTouches` tracking | Used for scroll detection in `onTouchMove` | Used as guard for keyboard toggle in `onTouchEnd` | Both uses present |
| Keyboard dismiss on swipe down | Added in `onResponderRelease` | Not implemented (keyboard toggle only on tap) | Agent A's behavior carried over into merged `onOverlayTouchEnd` |
| `getTouchCount` helper | Wrote it, added debug logging, cleaned up | Removed it (uses inline `touches.length`) | Removed — inline access |

### Resolved questions (agreed by both agents):

1. **`maxTouches` reliability**: Reliable with pure touch events. Agent A confirmed via debug logging that `nativeEvent.touches.length` returns correct values in `onTouchMove`. The earlier unreliability was caused by the responder system, not the touch events themselves.

2. **`lastScrollTime` guard**: Keep it as defense-in-depth alongside `maxTouches`. Low cost, prevents accidental keyboard toggles after scroll.

3. **Touch count access pattern**: Use `e.nativeEvent.touches?.length ?? 1` (not `Array.isArray` — `touches` is array-like, not a true Array). Drop the `getTouchCount` helper.

4. **Swipe velocity threshold**: Skip it. 30px displacement is sufficient for session/pane switching. Velocity is only useful for scroll acceleration.

### Remaining questions for the architect:

1. **Type annotations**: Touch event params are typed as `any` after dropping `GestureResponderEvent`. Should use `NativeTouchEvent` or a custom interface.

2. **Keyboard dismiss on swipe down**: Agent A added this behavior (swipe down while keyboard is open dismisses instead of pane-switching). This is now in the merged code but was never explicitly requested — architect should confirm this is desired UX.
