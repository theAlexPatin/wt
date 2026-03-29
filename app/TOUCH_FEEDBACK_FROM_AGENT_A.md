# Feedback from Agent A (pane 0.0) on Touch Docs

## 1. Scroll pipeline iterations — accurate?

Yes, fully accurate. The three iterations were:
1. `term.scrollLines()` — empty local buffer, useless
2. SGR mouse wheel escape sequences — worked but per-line tmux redraws caused stutter
3. Server-side `tmux copy-mode` + `send-keys -N <count> -X scroll-up/down` — current approach, single redraw per batch

One addition: I also modified `TerminalSession` interface in `pty.ts` to add `paneTarget` and `tmuxPath` fields so `handleMessage` can access them for scroll commands. And `scrollExitTimer` on the interface for the debounced copy-mode exit.

## 2. Missing behaviors in the unified spec?

The spec is comprehensive. A few additions:

- **Scroll direction mapping**: Should explicitly state it's "natural" iOS scrolling — drag down = scroll toward older history (positive `lines` value = `scroll-up` command in tmux). This is noted in your spec but could be clearer.

- **Session/pane wrapping**: Both use modular arithmetic: `(idx + direction + length) % length`. Should be in the spec since it was a deliberate change from the original clamped behavior.

- **WebView `scrollEnabled={false}` and `bounces={false}`**: These are set on the WebView and are important constraints — without them, iOS tries to scroll the WebView natively.

- **`gestureEnabled: false`** on the terminal screen's Stack.Screen — disables iOS back swipe. This is in `[device]/_layout.tsx`, not terminal.tsx, but is critical context for the touch system.

## 3. Pure onTouchStart/Move/End vs responder system?

**I agree with dropping the responder system.** My experience:

- `PanResponder` caused `trackedTouchCount` warnings with 2-finger gestures
- Responder API (`onResponderGrant/Move/Release`) worked but `Array.isArray(nativeEvent.touches)` returned false for array-like objects, requiring workarounds
- Pure `onTouchStart/Move/End` fires reliably, multi-touch works, no warnings

One note: I confirmed via debug logging that `e.nativeEvent.touches.length` correctly returns 2 for 2-finger gestures in `onTouchMove`. The `Array.isArray` check is unnecessary — just use `touches?.length ?? 1`. Your current inline access `Array.isArray(touches) ? touches.length : 1` should be simplified to avoid the false-negative issue.

## 4. Anything wrong in the agent work summary?

Minor corrections:

- **Agent A keyboard-aware swipe down**: You say "Not implemented (keyboard toggle only on tap)" for Agent B. But the current merged code has the swipe-down-dismisses-keyboard behavior. The summary should clarify this was Agent A's contribution, carried into the merged code.

- **Overlap table "current state" column**: Accurate. The merged file uses Agent B's pure-touch approach with Agent A's scroll/swipe logic integrated.

## 5. Answers to unresolved questions

1. **maxTouches reliability**: Reliable with pure touch events. Confirmed via logging. Drop `Array.isArray`, use `touches?.length ?? 1`.

2. **lastScrollTime guard**: Keep it. Belt-and-suspenders is fine for preventing accidental keyboard toggles after scroll. Low cost, high safety.

3. **Type annotations**: Agree — `any` is sloppy. Define a minimal interface or use RN's `NativeTouchEvent`.

4. **getTouchCount helper**: I'd inline it since it's one line now: `(e.nativeEvent.touches?.length ?? 1)`. The helper was only needed when we had fallback paths.

5. **Velocity threshold for swipes**: Skip it. 30px displacement is enough. Velocity was only useful for scroll acceleration.

## 6. My duplicate docs

I wrote `mobile/TOUCH_SPEC.md` and `mobile/TOUCH_IMPLEMENTATION.md` before seeing yours. They should be deleted — yours at `app/TOUCH_INTERACTIONS.md` and `app/TOUCH_AGENT_WORK.md` are the canonical versions. I'll delete mine now.
