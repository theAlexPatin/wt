# wt Mobile — Touch Interaction Spec

Unified specification for all touch interactions on the terminal screen (`app/[device]/terminal.tsx`).

## Gesture Surface

A transparent overlay (`swipeOverlay`) sits absolutely positioned over the full WebView. It intercepts all touches — the WebView never receives direct touch events. All gesture detection runs in React Native via `onTouchStart`/`onTouchMove`/`onTouchEnd`.

**Why an overlay?** xterm.js in tmux mouse mode consumes all touch events, making in-WebView gesture detection impossible. The PanResponder API was also tried and abandoned due to multi-touch tracking bugs (`trackedTouchCount` warnings).

---

## Gesture Map

### Single Tap (< 10px movement, < 400ms duration)
- **Keyboard closed** → focus the TextInput, keyboard opens
- **Keyboard open** → dismiss keyboard
- Guard: suppressed for 300ms after any 2-finger scroll activity
- Implementation note: `focus()` must be deferred via `setTimeout(…, 0)` — iOS suppresses programmatic focus inside touch event handlers

### Single-Finger Horizontal Swipe (> 30px dx)
- **Left** → next session (`switchSession(1)`)
- **Right** → previous session (`switchSession(-1)`)
- Haptic: `ImpactFeedbackStyle.Medium`
- Resets pane index to 0
- Wraps around: uses modular arithmetic `(idx + dir + len) % len`

### Single-Finger Vertical Swipe (> 30px dy)
- **Up** → next pane (`switchPane(1)`)
- **Down + keyboard open** → dismiss keyboard (instead of switching pane)
- **Down + keyboard closed** → previous pane (`switchPane(-1)`)
- Haptic: `ImpactFeedbackStyle.Light`
- Wraps around: same modular arithmetic as session switching

### Two-Finger Vertical Drag (scroll)
- Scrolls tmux history via server-side copy-mode commands
- **Natural scrolling**: drag down = scroll toward older history (positive `lines` → tmux `scroll-up`), drag up = toward bottom (negative `lines` → tmux `scroll-down`)
- **Velocity-based acceleration**: smoothed velocity tracking (px/ms), multiplier ranges from 1x (slow drag, fine control) to 5x (fast flick)
- **Batched at 60fps**: lines accumulate and flush via `requestAnimationFrame`
- Resolution: 1 line per 12px of movement (after velocity multiplier)
- Pipeline: RN → postMessage → WebView → WebSocket → server `handleScroll()` → `tmux copy-mode` + `send-keys -N <count> -X scroll-up/down`
- Server debounces copy-mode exit: auto-cancels 1.5s after last scroll

### Long Press (> 400ms)
- Currently: no action (reserved for future text selection)

---

## Input Bar

Row of controls at the bottom, above keyboard when active:

```
[ Esc bubble ] [ ^C bubble ] [ ───── text input pill ──── [↵] ]
```

### Action Bubbles (left side)
- **Esc** (✕ icon): sends `\x1b` — cancels agent thoughts in Claude/Amp
- **Ctrl+C** (■ icon): sends `\x03` — interrupts running process

### Text Input Pill (BlurView glass style)
- Multiline, monospace, grows from 1 to 4 lines (`maxHeight: 80px`)
- Scrollable when content exceeds 4 lines
- Border color tinted with session's `tabColor`
- Submit sends `text + "\r"` (carriage return, not `\n` — required for raw-mode TUI apps like Claude/Amp)
- Send button (↵) inside the pill, colored with `tabColor`

### Keyboard Avoidance
- `KeyboardAvoidingView` with `keyboardVerticalOffset={headerHeight}` (from `useHeaderHeight()`)
- Indicator bar tap also dismisses keyboard

---

## Device List Interactions (`app/index.tsx`)

### Swipe-to-Delete (device cards)
- Swipe left on a device card → reveals red Delete button
- Uses `Animated` + `PanResponder` (not gesture-handler — crashes Expo Go)
- Tap Delete to confirm, swipe right to dismiss

---

## Touch Event Flow (terminal screen)

```
User touches screen
  │
  ├─ onTouchStart: record (x, y, time), init maxTouches
  │
  ├─ onTouchMove: update maxTouches from touches.length
  │   ├─ maxTouches >= 2: velocity-tracked scroll accumulation
  │   └─ maxTouches < 2: (no action during move)
  │
  └─ onTouchEnd:
      ├─ triggered? → bail
      ├─ maxTouches < 2:
      │   ├─ |dx| > 30 → session swipe
      │   ├─ |dy| > 30 → pane swipe (or dismiss keyboard)
      │   └─ |dx| < 10 && |dy| < 10 && elapsed < 400ms → tap (toggle keyboard)
      └─ maxTouches >= 2 → (scroll already handled in move, no action on end)
```

---

## Important Layout Constraints

- **`gestureEnabled: false`** on the terminal Stack.Screen (`[device]/_layout.tsx`) — disables iOS back swipe so horizontal gestures are fully available for session switching
- **`scrollEnabled={false}` and `bounces={false}`** on the WebView — prevents iOS from trying to natively scroll the WebView content
- **Touch count detection**: use `e.nativeEvent.touches?.length ?? 1` (not `Array.isArray` — `touches` is array-like, not a true Array)

---

## Known Issues / Constraints

1. **WebView touch passthrough**: The overlay blocks ALL touches from reaching xterm.js. There is no way to interact with tmux mouse features (text selection, click-to-position cursor) from the phone.
2. **`nativeEvent.touches` at end**: May be empty in `onTouchEnd`. The `maxTouches` high-water mark pattern (set during `onTouchMove`) handles this.
3. **Scroll smoothness**: Each tmux copy-mode scroll triggers a full pane redraw. Velocity acceleration + server-side batching helps, but fast scrolling through long history can still stutter.
4. **Expo Go limitations**: `react-native-gesture-handler` Gesture API crashes. Must use RN built-in touch events or `PanResponder` (for non-terminal screens).
