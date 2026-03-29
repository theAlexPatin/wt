# Plans

## Amp/Codex Push Notifications

**Status:** Blocked — neither tool supports hooks yet

**Context:** `wt notify` is a generalized CLI command that sends push notifications to Wit via the wt-server. It's already integrated with Claude Code's Stop hook. Amp and Codex should use the same mechanism once they support hooks/callbacks.

**What's already done:**
- `wt notify [-t title] [message]` — auto-detects tmux session/window/pane, POSTs to wt-server, fails silently
- wt-server `POST /notify` — sends Expo push notifications to all registered mobile devices
- Wit handles notification taps and navigates to the correct terminal session/pane
- Claude Code Stop hook calls `zsh ~/.scripts/wt/notify.sh "Claude finished"` when pane is unfocused

**When Amp adds hooks:**
1. Find Amp's hook config (likely `~/.amp/settings.json` or similar)
2. Add a stop/completion hook: `zsh ~/.scripts/wt/notify.sh "Amp finished"`
3. Match the same pattern as Claude Code — only notify when the pane is unfocused:
   ```sh
   if [ -n "$TMUX" ] && ! tmux display-message -p '#{client_flags}' | grep -q focused; then
     zsh ~/.scripts/wt/notify.sh "Amp finished"
   fi
   ```

**When Codex adds hooks:**
1. Find Codex's hook config (likely `~/.codex/config.toml` or similar)
2. Same pattern as above with `"Codex finished"`

**Workaround (no hooks):**
If either tool never adds hooks, wrap them in shell functions:
```sh
amp() { command amp "$@"; zsh ~/.scripts/wt/notify.sh "Amp finished"; }
codex() { command codex "$@"; zsh ~/.scripts/wt/notify.sh "Codex finished"; }
```
This only works for synchronous invocations (not long-running interactive sessions).
