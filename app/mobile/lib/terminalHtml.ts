export const TERMINAL_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: var(--bg, #0a0a0f); }
      #terminal { width: 100%; height: 100%; }
      .xterm { padding: 4px; background-color: var(--bg, #0a0a0f) !important; }
      .xterm-viewport { background-color: var(--bg, #0a0a0f) !important; }
      #loader {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        display: none; align-items: center; justify-content: center;
        flex-direction: column; gap: 14px; z-index: 10;
      }
      #loader.visible { display: flex; }
      .spinner {
        width: 20px; height: 20px;
        border: 2px solid rgba(255,255,255,0.08);
        border-top-color: #D4900A;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .progress-track {
        width: 140px; height: 3px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px; overflow: hidden;
      }
      .progress-fill {
        height: 100%; width: 0%;
        background: #D4900A;
        border-radius: 2px;
        transition: width 0.15s ease-out;
      }
      .loader-text { color: rgba(255,255,255,0.3); font-size: 12px; font-family: "SF Mono", Menlo, monospace; }
    </style>
  </head>
  <body>
    <div id="loader"><div id="spinner-wrap"><div class="spinner"></div></div><div id="progress-wrap" style="display:none"><div class="progress-track"><div class="progress-fill" id="progress"></div></div></div><div class="loader-text" id="loader-text">loading session</div></div>
    <div id="terminal"></div>
    <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
    <script>
      var term = null;
      var fitAddon = null;
      var ws = null;

      function init(config) {
        var bgColor = config.paneColor || "#0a0a0f";
        document.documentElement.style.setProperty("--bg", bgColor);
        document.body.style.background = bgColor;

        fitAddon = new FitAddon.FitAddon();
        term = new Terminal({
          cursorBlink: true,
          cursorStyle: "bar",
          fontSize: 11,
          fontFamily: '"SF Mono", Menlo, "DejaVu Sans Mono", monospace',
          theme: {
            background: bgColor,
            foreground: "#e4e4e8",
            cursor: "#e4e4e8",
            selectionBackground: "rgba(255,255,255,0.2)",
          },
          allowProposedApi: true,
        });

        term.loadAddon(fitAddon);
        term.open(document.getElementById("terminal"));
        setTimeout(function() { fitAddon.fit(); }, 100);

        term.onData(function(data) {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
        });

        connect(config.wsUrl);

        new ResizeObserver(function() {
          if (fitAddon) { fitAddon.fit(); sendResize(); }
        }).observe(document.getElementById("terminal"));

        term.onResize(function() { sendResize(); });
      }

      function connect(url) {
        ws = new WebSocket(url);
        var scrollTimer = null;
        var initialLoad = true;
        var showingProgress = false;
        var gotMeta = false;
        var progressStart = 0;
        var termEl = document.getElementById("terminal");
        var loaderEl = document.getElementById("loader");
        var spinnerWrap = document.getElementById("spinner-wrap");
        var progressWrap = document.getElementById("progress-wrap");
        var progressEl = document.getElementById("progress");
        if (termEl) termEl.style.visibility = "hidden";
        if (loaderEl) loaderEl.classList.add("visible");
        if (spinnerWrap) spinnerWrap.style.display = "";
        if (progressWrap) progressWrap.style.display = "none";
        if (progressEl) { progressEl.style.width = "0%"; progressEl.style.transition = "none"; }

        // Time-based progress: asymptotically approaches 90%
        function tickProgress() {
          if (!showingProgress) return;
          var elapsed = Date.now() - progressStart;
          var pct = 90 * (1 - Math.exp(-elapsed / 4000));
          if (progressEl) progressEl.style.width = pct + "%";
          requestAnimationFrame(tickProgress);
        }

        // After 1s, switch from spinner to progress bar if still loading
        var upgradeTimer = setTimeout(function() {
          if (!initialLoad) return;
          showingProgress = true;
          if (spinnerWrap) spinnerWrap.style.display = "none";
          if (progressWrap) progressWrap.style.display = "";
          progressStart = Date.now();
          tickProgress();
        }, 1000);

        var totalBytes = 0;
        var lastCheckBytes = 0;
        var lowCount = 0;
        var rateStarted = false;
        var lastBaseY = -1;
        var baseYStableMs = 0;

        function reveal() {
          if (!initialLoad) return;
          clearTimeout(upgradeTimer);
          initialLoad = false;
          showingProgress = false;
          if (progressEl) {
            progressEl.style.transition = "width 0.15s ease-out";
            progressEl.style.width = "100%";
          }
          setTimeout(function() {
            if (term) term.scrollToBottom();
            setTimeout(function() {
              if (term) term.scrollToBottom();
              if (loaderEl) loaderEl.classList.remove("visible");
              if (termEl) termEl.style.visibility = "visible";
            }, 50);
          }, 50);
        }

        function checkReady() {
          if (!initialLoad) return;
          var recent = totalBytes - lastCheckBytes;
          lastCheckBytes = totalBytes;

          // Signal 1: throughput dropped — data stream finished
          if (recent < 300) {
            if (++lowCount >= 2) { reveal(); return; }
          } else {
            lowCount = 0;
          }

          // Signal 2: scrollback stable for 2s while data still flowing
          // = live animated terminal (Amp etc), not history replay
          if (term) {
            var curBaseY = term.buffer.active.baseY;
            if (lastBaseY >= 0 && curBaseY === lastBaseY) {
              baseYStableMs += 300;
              if (baseYStableMs >= 2000) { reveal(); return; }
            } else {
              lastBaseY = curBaseY;
              baseYStableMs = 0;
            }
          }

          setTimeout(checkReady, 300);
        }

        ws.onopen = function() { sendResize(); notifyRN({ type: "connected" }); };
        ws.onmessage = function(e) {
          var data = e.data;
          // First message from server is history metadata — swallow it
          if (initialLoad && !gotMeta) {
            try {
              var meta = JSON.parse(data);
              if (meta.type === "history") { gotMeta = true; return; }
            } catch(ex) {}
          }
          if (term) {
            term.write(data);
            if (initialLoad) {
              totalBytes += data.length;
              if (!rateStarted) {
                rateStarted = true;
                setTimeout(checkReady, 300);
              }
            }
          }
        };
        ws.onclose = function() { notifyRN({ type: "disconnected" }); };
        ws.onerror = function() { notifyRN({ type: "error" }); };
      }

      function disconnect() { if (ws) { ws.close(); ws = null; } }

      function sendResize() {
        if (term && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }

      function sendInput(text) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
      }

      function notifyRN(msg) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }

      function handleMsg(data) {
        try {
          var msg = JSON.parse(data);
          if (msg.type === "init") init(msg);
          else if (msg.type === "input") sendInput(msg.data);
          else if (msg.type === "reconnect") {
            disconnect();
            var bgColor = msg.paneColor || "#0a0a0f";
            document.documentElement.style.setProperty("--bg", bgColor);
            document.body.style.background = bgColor;
            if (term) {
              term.options.theme = Object.assign({}, term.options.theme, { background: bgColor });
              term.clear();
            }
            connect(msg.wsUrl);
          }
          else if (msg.type === "disconnect") disconnect();
          else if (msg.type === "scroll") {
            // Forward to server — handled via tmux copy-mode for smooth scrolling
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "scroll", lines: msg.lines }));
            }
          }
        } catch(e) {}
      }

      window.addEventListener("message", function(e) { handleMsg(e.data); });
      document.addEventListener("message", function(e) { handleMsg(e.data); });

      // Signal to RN that we're ready
      notifyRN({ type: "ready" });
    </script>
  </body>
</html>`;
