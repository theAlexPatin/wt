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
    <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
    <script>
      var term = null;
      var fitAddon = null;
      var ws = null;
      var lastWsUrl = null;
      var autoReconnectTimer = null;
      var keepAliveTimer = null;

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
          scrollback: 10000,
          theme: {
            background: bgColor,
            foreground: "#e4e4e8",
            cursor: "#e4e4e8",
            selectionBackground: "rgba(255,255,255,0.2)",
          },
          allowProposedApi: true,
        });

        var webLinksAddon = new WebLinksAddon.WebLinksAddon(function(e, url) {
          e.preventDefault();
          notifyRN({ type: "linkTap", url: url });
        });
        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
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
        if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        lastWsUrl = url;
        intentionalDisconnect = false;
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

        // Fallback: reveal after 8s even if no data arrived (empty session, PTY error, etc.)
        var fallbackTimer = setTimeout(function() { reveal(); }, 8000);

        var totalBytes = 0;
        var lastCheckBytes = 0;
        var lowCount = 0;
        var rateStarted = false;
        var lastBaseY = -1;
        var baseYStableMs = 0;

        function reveal() {
          if (!initialLoad) return;
          clearTimeout(upgradeTimer);
          clearTimeout(fallbackTimer);
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

        ws.onopen = function() {
          sendResize();
          notifyRN({ type: "connected" });
          keepAliveTimer = setInterval(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 30000);
        };
        ws.onmessage = function(e) {
          var data = e.data;
          // First messages from server are metadata — swallow and forward to RN
          if (initialLoad && !gotMeta) {
            try {
              var meta = JSON.parse(data);
              if (meta.type === "paneInfo") { notifyRN(meta); return; }
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
        ws.onclose = function() {
          if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
          reveal();
          var wasUnexpected = !intentionalDisconnect;
          notifyRN({ type: "disconnected", unexpected: wasUnexpected });
          intentionalDisconnect = false;
          if (wasUnexpected && lastWsUrl) {
            autoReconnectTimer = setTimeout(function() {
              autoReconnectTimer = null;
              if (!ws || ws.readyState !== WebSocket.OPEN) {
                if (term) term.clear();
                connect(lastWsUrl);
              }
            }, 2000);
          }
        };
        ws.onerror = function() { reveal(); notifyRN({ type: "error" }); };
      }

      var selectAnchor = null;

      function coordsToCell(x, y) {
        var termEl = document.getElementById("terminal");
        if (!termEl || !term) return { col: 0, row: 0 };
        var rect = termEl.getBoundingClientRect();
        var dims = term._core._renderService.dimensions;
        var cellW = dims.css.cell.width;
        var cellH = dims.css.cell.height;
        var col = Math.floor((x - rect.left) / cellW);
        var row = Math.floor((y - rect.top) / cellH);
        col = Math.max(0, Math.min(col, term.cols - 1));
        row = Math.max(0, Math.min(row, term.rows - 1));
        return { col: col, row: row };
      }

      function findLinkAtTap(x, y) {
        if (!term) return null;
        var cell = coordsToCell(x, y);
        var bufRow = cell.row + term.buffer.active.viewportY;
        // Read a window of lines around the tap to handle wrapped URLs
        var startRow = Math.max(0, bufRow - 2);
        var endRow = Math.min(term.buffer.active.length - 1, bufRow + 2);
        var lines = [];
        var rowOffsets = []; // character offset where each row starts in the joined string
        var offset = 0;
        for (var r = startRow; r <= endRow; r++) {
          var line = term.buffer.active.getLine(r);
          if (!line) continue;
          var text = line.translateToString();
          rowOffsets.push({ row: r, start: offset, len: text.length });
          lines.push(text);
          offset += text.length;
        }
        var joined = lines.join("");
        // Find the character position of the tap in the joined string
        var tapOffset = 0;
        for (var i = 0; i < rowOffsets.length; i++) {
          if (rowOffsets[i].row === bufRow) {
            tapOffset = rowOffsets[i].start + cell.col;
            break;
          }
        }
        // Find all URLs in the joined text and check if tap falls within one
        var urlRe = new RegExp("https?://[^" + "\\\\s)\\\\]>'" + '"]+', "g");
        var match;
        while ((match = urlRe.exec(joined)) !== null) {
          var urlStart = match.index;
          var urlEnd = urlStart + match[0].length;
          if (tapOffset >= urlStart && tapOffset < urlEnd) {
            return match[0];
          }
        }
        return null;
      }

      var intentionalDisconnect = false;
      function disconnect() {
        intentionalDisconnect = true;
        if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        if (ws) { ws.close(); ws = null; }
      }

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
          else if (msg.type === "checkAndReconnect") {
            if (ws && ws.readyState === WebSocket.OPEN) {
              notifyRN({ type: "connected" });
            } else if (lastWsUrl) {
              if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
              if (term) term.clear();
              connect(lastWsUrl);
            }
          }
          else if (msg.type === "findLink") {
            var url = findLinkAtTap(msg.x, msg.y);
            if (url) notifyRN({ type: "linkTap", url: url });
            else notifyRN({ type: "linkTap", url: null });
          }
          else if (msg.type === "selectStart") {
            var cell = coordsToCell(msg.x, msg.y);
            selectAnchor = cell;
            if (term) term.select(cell.col, cell.row + term.buffer.active.viewportY, 1);
          }
          else if (msg.type === "selectMove") {
            if (!selectAnchor || !term) return;
            var end = coordsToCell(msg.x, msg.y);
            var sCol = selectAnchor.col, sRow = selectAnchor.row;
            var eCol = end.col, eRow = end.row;
            if (eRow < sRow || (eRow === sRow && eCol < sCol)) {
              var len = (sRow - eRow) * term.cols + (sCol - eCol) + 1;
              term.select(eCol, eRow + term.buffer.active.viewportY, len);
            } else {
              var len = (eRow - sRow) * term.cols + (eCol - sCol) + 1;
              term.select(sCol, sRow + term.buffer.active.viewportY, len);
            }
          }
          else if (msg.type === "selectEnd") {
            selectAnchor = null;
            if (term) {
              var text = term.getSelection();
              if (text) notifyRN({ type: "selectionReady", text: text });
            }
          }
          else if (msg.type === "clearSelection") {
            if (term) term.clearSelection();
          }
          else if (msg.type === "scroll") {
            // Send scroll to server — tmux copy-mode has the full scrollback
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
