# Keyboard Bug: Terminal Disappears on App Switch

## Problem

When switching away from Wit and back (especially via Wispr Flow's "Start Flow" which opens a separate app to activate the microphone), the terminal goes blank. The user has to navigate back to the pane selector and re-select the pane. The same issue occurs after the app has been inactive for a long period.

## Root Cause (identified but not fully fixed)

The terminal screen wraps everything in a `KeyboardAvoidingView` with `behavior="padding"`. When the Wispr Flow keyboard is active (with its tall "Listening" UI), iOS reports a very large keyboard height. The `KeyboardAvoidingView` adds that much bottom padding, which compresses the `flex: 1` terminal WebView to near-zero height — making it invisible.

**Key evidence**: The user reported that when tapping the pane grid button, the terminal content briefly flashes visible before the pane selector appears. This is because `Keyboard.dismiss()` fires first (removing the keyboard padding), momentarily restoring the terminal to full size, before the modal opens. This confirms the WebView is alive and rendering — it's just being hidden by the layout.

## What Was Changed

### Layout fix (partially addresses the root cause)
- **Removed `KeyboardAvoidingView`** — replaced with plain `View` so the terminal never shrinks when any keyboard (including tall third-party ones) is active
- **Input bar positioning** — uses `transform: [{ translateY: -keyboardHeight }]` on the input container to slide it above the keyboard. `keyboardHeight` is tracked via `keyboardDidShow`/`keyboardDidHide` listeners

### WebView recovery mechanisms (attempted, may not be needed if layout fix works)
Several approaches were tried to detect and recover from iOS killing the WebView's web content process while backgrounded. None conclusively fixed the issue because the root cause turned out to be layout, not WebView death:

1. **AppState "background" detection** — tracked `wasBackgrounded` ref, only reconnected on `background` → `active` transitions. Didn't work because Wispr Flow's app switch might not reliably trigger `background` state, or the timing was off.

2. **Timing-based detection** — tracked when app left `active`, reconnected if elapsed time > 1s (to distinguish from keyboard switches which take <500ms). Also didn't work.

3. **Heartbeat ping** (current) — every 500ms, injects JS into the WebView that sends a `pong` message back. If no response within 250ms, remounts the WebView via `key` prop change. This is the current approach and should handle genuine WebView process termination.

4. **`onContentProcessDidTerminate`** — added as a handler on the WebView. Should fire when iOS kills the web content process, but may not fire reliably in all scenarios.

5. **WebView `key` prop remounting** — instead of calling `webViewRef.current?.reload()` (which doesn't work for inline HTML sources), bumping a `webViewKey` state variable forces React to unmount and remount the WebView entirely.

### Other changes in this PR
- **Video attachments** — `ImagePicker.launchImageLibraryAsync` now accepts `["images", "videos"]` instead of just `["images"]`
- **Fast skill** — added `↯ fast` to the skill palette (config category, first position) to toggle Claude fast mode
- **pr-review needsArgs** — changed to `true` so it pre-fills the input bar instead of sending immediately
- **Link tapping** — added `findLinkAtTap()` function in `terminalHtml.ts` that reads a 5-line window around tap coordinates, joins them, and finds URLs that span the tapped position (handles wrapped URLs). Uses `postMessage` round-trip (`findLink` → `linkTap`) instead of the old `injectJavaScript` synthetic click approach which didn't trigger xterm.js WebLinksAddon on touch devices
- **EAS config** — added `"channel": "preview"` to the preview build profile in `eas.json` so OTA updates work
- **Deploy docs** — added "Deploying the Mobile App" section to `CLAUDE.md`

## What Still Needs to Be Done

1. **Verify the layout fix** — the `KeyboardAvoidingView` → `View` swap + `translateY` approach needs testing. The `translateY` transform doesn't affect flex layout, so the input bar will still occupy its original space at the bottom while being visually translated up. This might cause the input bar to overlap the terminal or leave a gap. May need absolute positioning or a different approach.

2. **Test with Wispr Flow** — the core scenario: open terminal, activate Wispr Flow keyboard, tap "Start Flow", dictate, return to Wit. Terminal should remain visible.

3. **Test normal keyboard behavior** — ensure the standard iOS keyboard still works properly: input bar appears above keyboard, terminal resizes or stays visible, page swiping works, keyboard dismiss/focus toggle works.

4. **Consider alternative layout approaches**:
   - Absolute-position the input bar at the bottom with `bottom: keyboardHeight`
   - Use `KeyboardAvoidingView` only around the input container, not the terminal
   - Keep `KeyboardAvoidingView` but set `minHeight` on the terminal to prevent collapse
   - Use `useAnimatedKeyboard` from react-native-reanimated for smoother keyboard tracking

5. **Clean up heartbeat if not needed** — if the layout fix resolves the blank screen, the 500ms heartbeat ping may be unnecessary overhead. Consider removing it or increasing the interval significantly.
