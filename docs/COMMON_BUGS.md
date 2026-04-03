# Common Bugs

Recurring issues that keep appearing across feature branches. Check this before shipping.

---

## 1. `setSessions()` in polls triggers reconnect loops

**Symptom**: Terminal stuck on "loading session" spinner, WebSocket connects and immediately reconnects in a loop.

**Root cause**: `reconnect` depends on `currentSession` (derived from `sessions[sessionIdx]`). Calling `setSessions(newData)` from a poll or callback creates a new array/object reference → new `currentSession` → new `reconnect` callback → `useEffect(() => reconnect(), [reconnect])` fires → WebSocket reconnects → loading loop.

**Rule**: Never call `setSessions()` from a periodic poll or from a WebSocket event handler. If you need to update a single derived value (like `isClaudeCode`), update that specific piece of state directly instead of replacing the entire sessions array.

**Fix pattern**:
```typescript
// BAD — triggers reconnect cascade
setInterval(() => {
  fetchSessions(device).then((data) => setSessions(data));
}, 5000);

// GOOD — surgical update, no reconnect
setInterval(() => {
  fetchSessions(device).then((data) => {
    const pane = data.find(...)?.panes[paneIdx];
    if (pane) setLiveIsClaudeCode(!!pane.isClaudeCode);
  });
}, 5000);
```
