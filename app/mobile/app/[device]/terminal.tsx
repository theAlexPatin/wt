import { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  Dimensions,
  Animated,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useStore } from "../../lib/store";
import { fetchSessions, terminalWsUrl, uploadFile } from "../../lib/api";
import { TERMINAL_HTML } from "../../lib/terminalHtml";
import { PaneGrid } from "../../lib/PaneGrid";
import type { Session } from "../../lib/types";

// ~4 lines of monospace text at fontSize 15
const LINE_HEIGHT = 20;
const MAX_INPUT_LINES = 4;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_INPUT_LINES;
const SCREEN_WIDTH = Dimensions.get("window").width;

const ACTION_ROW_1 = [
  { label: "Tab", data: "\t" },
  { label: "^D", data: "\x04" },
  { label: "^Z", data: "\x1a" },
  { label: "^U", data: "\x15" },
  { label: "^W", data: "\x17" },
  { label: "↑", data: "\x1b[A", repeat: true },
  { label: "⌫", data: "\x7f", repeat: true },
];

const ACTION_ROW_2 = [
  { label: "■", data: "\x03" },
  { label: "^E", data: "\x05" },
  { label: "^K", data: "\x0b" },
  { label: "^R", data: "\x12" },
  { label: "←", data: "\x1b[D", repeat: true },
  { label: "↓", data: "\x1b[B", repeat: true },
  { label: "→", data: "\x1b[C", repeat: true },
];

const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 80;

function ActionKey({ label, data, repeat, tabColor, sendRaw }: {
  label: string; data: string; repeat?: boolean; tabColor: string;
  sendRaw: (data: string) => void;
}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const onPressIn = useCallback(() => {
    if (!repeat) return;
    sendRaw(data);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => sendRaw(data), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  }, [data, repeat, sendRaw]);

  const onPressOut = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionKey,
        { borderColor: tabColor + "30" },
        pressed && { backgroundColor: tabColor + "25" },
      ]}
      onPress={repeat ? undefined : () => {
        sendRaw(data);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPressIn={repeat ? onPressIn : undefined}
      onPressOut={repeat ? onPressOut : undefined}
    >
      <Text style={styles.actionKeyLabel}>{label}</Text>
    </Pressable>
  );
}

export default function TerminalScreen() {
  const { device: deviceId, sessionId: targetSessionId, sessionIndex: initialIndex, paneIndex: initialPaneIndex } =
    useLocalSearchParams<{ device: string; sessionId: string; sessionIndex: string; paneIndex?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const devices = useStore((s) => s.devices);
  const device = devices.find((d) => d.id === deviceId);

  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [inputText, setInputText] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [connected, setConnected] = useState(false);
  const dotPulse = useRef(new Animated.Value(1)).current;
  const [webViewReady, setWebViewReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionIdx, setSessionIdx] = useState(parseInt(initialIndex ?? "0", 10));
  const [paneIdx, setPaneIdx] = useState(parseInt(initialPaneIndex ?? "0", 10));
  const pageScrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState(0);
  const [barWidth, setBarWidth] = useState(SCREEN_WIDTH - 16);
  const [paneGridVisible, setPaneGridVisible] = useState(false);

  const currentSession = sessions[sessionIdx];
  const tabColor = currentSession?.tabColor ?? "#555";
  const bgColor = currentSession?.paneColor ?? "#0a0a0f";

  useEffect(() => {
    if (!device) return;
    fetchSessions(device).then((data) => {
      setSessions(data);
      if (targetSessionId) {
        const idx = data.findIndex((s) => s.id === targetSessionId);
        if (idx >= 0) setSessionIdx(idx);
      }
    }).catch(() => {});
  }, [device, targetSessionId]);

  // Hide native header — we render our own
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Pulse header dot when disconnected
  useEffect(() => {
    if (!connected && initialized) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(dotPulse, { toValue: 0.2, duration: 800, useNativeDriver: true }),
          Animated.timing(dotPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      dotPulse.setValue(1);
    }
  }, [connected, initialized, dotPulse]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
      if (activePage === 1) goToPage(0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, [activePage, goToPage]);

  // Connect to terminal when session/pane changes AND webview is ready
  useEffect(() => {
    if (!device || !currentSession || !webViewReady) return;
    const pane = currentSession.panes[paneIdx];
    if (!pane) return;
    const wsUrl = terminalWsUrl(device, currentSession.id, pane.windowIndex, pane.index, 80, 24);
    const msg = JSON.stringify({
      type: initialized ? "reconnect" : "init",
      wsUrl,
      paneColor: currentSession.paneColor,
    });
    webViewRef.current?.postMessage(msg);
    if (!initialized) setInitialized(true);
  }, [device, currentSession, paneIdx, webViewReady]);

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") setWebViewReady(true);
      if (msg.type === "connected") setConnected(true);
      if (msg.type === "disconnected") setConnected(false);
      if (msg.type === "swipe") {
        if (msg.direction === "up") switchSession(1);
        else if (msg.direction === "down") switchSession(-1);
        else if (msg.direction === "left") switchPane(1);
        else if (msg.direction === "right") switchPane(-1);
      }
    } catch {}
  }, [switchSession, switchPane]);

  const sendRaw = useCallback((data: string) => {
    webViewRef.current?.postMessage(JSON.stringify({ type: "input", data }));
  }, []);

  const sendCommand = () => {
    sendRaw(inputText + "\r");
    setInputText("");
  };

  const onPageChange = useCallback((e: any) => {
    const width = barWidth || SCREEN_WIDTH - 16;
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    setActivePage(page);
  }, [barWidth]);

  const goToPage = useCallback((page: number) => {
    const width = barWidth || SCREEN_WIDTH - 16;
    pageScrollRef.current?.scrollTo({ x: page * width, animated: true });
    setActivePage(page);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [barWidth]);

  const switchSession = useCallback(
    (direction: number) => {
      if (sessions.length === 0) return;
      const nextIdx = (sessionIdx + direction + sessions.length) % sessions.length;
      if (nextIdx === sessionIdx) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPaneIdx(0);
      setSessionIdx(nextIdx);
      if (device) {
        fetchSessions(device).then(setSessions).catch(() => {});
      }
    },
    [sessionIdx, sessions.length, device]
  );

  const switchPane = useCallback(
    (direction: number) => {
      if (!currentSession || currentSession.panes.length === 0) return;
      const nextPane = (paneIdx + direction + currentSession.panes.length) % currentSession.panes.length;
      if (nextPane === paneIdx) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPaneIdx(nextPane);
    },
    [paneIdx, currentSession]
  );

  // Touch-based gesture detection (no responder system — avoids trackedTouchCount warnings):
  // - tap → toggle keyboard
  // - 1-finger vertical swipe → switch session (or dismiss keyboard)
  // - 1-finger horizontal swipe → switch pane
  // - 2-finger vertical → scroll terminal history
  const touchRef = useRef({
    x: 0, y: 0, maxTouches: 0, triggered: false,
    scrollAccum: 0, time: 0, lastScrollTime: 0,
    lastMoveTime: 0, lastMoveY: 0, velocity: 0,
    scrollPending: 0, scrollRaf: 0,
  });

  const flushScroll = useCallback(() => {
    const t = touchRef.current;
    t.scrollRaf = 0;
    if (t.scrollPending !== 0) {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: "scroll", lines: t.scrollPending })
      );
      t.scrollPending = 0;
    }
  }, []);

  const onOverlayTouchStart = useCallback((e: any) => {
    const touches = e.nativeEvent.touches;
    const count = Array.isArray(touches) ? touches.length : 1;
    const now = Date.now();
    touchRef.current = {
      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY,
      maxTouches: count, triggered: false,
      scrollAccum: 0, time: now, lastScrollTime: touchRef.current.lastScrollTime,
      lastMoveTime: now, lastMoveY: e.nativeEvent.pageY, velocity: 0,
      scrollPending: 0, scrollRaf: 0,
    };
  }, []);

  const onOverlayTouchMove = useCallback((e: any) => {
    const t = touchRef.current;
    const touches = e.nativeEvent.touches;
    const count = Array.isArray(touches) ? touches.length : 1;
    if (count > t.maxTouches) t.maxTouches = count;

    if (t.maxTouches >= 2) {
      const now = Date.now();
      const dy = e.nativeEvent.pageY - t.y;
      const dt = now - t.lastMoveTime;

      if (dt > 0) {
        const instantV = Math.abs(dy) / dt;
        t.velocity = t.velocity * 0.6 + instantV * 0.4;
      }

      const multiplier = 1 + Math.min(t.velocity * 4, 4);
      t.scrollAccum += dy * multiplier;
      t.y = e.nativeEvent.pageY;
      t.lastMoveTime = now;
      t.lastMoveY = e.nativeEvent.pageY;
      t.lastScrollTime = now;

      const lines = Math.trunc(t.scrollAccum / 12);
      if (lines !== 0) {
        t.scrollAccum -= lines * 12;
        t.scrollPending += lines;
        if (!t.scrollRaf) {
          t.scrollRaf = requestAnimationFrame(flushScroll) as unknown as number;
        }
      }
    }
  }, [flushScroll]);

  const onOverlayTouchEnd = useCallback((e: any) => {
    const t = touchRef.current;
    if (t.triggered) return;

    const dx = e.nativeEvent.pageX - t.x;
    const dy = e.nativeEvent.pageY - t.y;
    const elapsed = Date.now() - t.time;

    // Swipe detection (single-finger only)
    // Vertical = switch session, Horizontal = switch pane
    if (t.maxTouches < 2) {
      if (Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > 30) {
          t.triggered = true;
          if (dy > 0 && keyboardVisible) {
            Keyboard.dismiss();
          } else {
            dy < 0 ? switchSession(1) : switchSession(-1);
          }
          return;
        }
      } else {
        if (Math.abs(dx) > 30) {
          t.triggered = true;
          dx < 0 ? switchPane(1) : switchPane(-1);
          return;
        }
      }
    }

    // Tap detection: small movement, short duration, not after scroll
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && elapsed < 400 && Date.now() - t.lastScrollTime > 300) {
      setTimeout(() => {
        if (keyboardVisible) {
          Keyboard.dismiss();
        } else {
          inputRef.current?.focus();
        }
      }, 0);
    }
  }, [switchSession, switchPane, keyboardVisible]);

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bgColor }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Custom header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: bgColor }]}>
        <Pressable onPress={() => router.dismissTo(`/${deviceId}`)} hitSlop={12} style={styles.headerBack}>
          <Text style={styles.headerBackChevron}>{"‹"}</Text>
          <Text style={styles.headerBackLabel} numberOfLines={1}>{device?.name ?? ""}</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Animated.View style={[styles.headerDot, { backgroundColor: tabColor, opacity: dotPulse }]} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentSession?.tabTitle ?? "Terminal"}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {sessions.length > 1 && (
            <View style={styles.headerCounter}>
              <Text style={[styles.headerCaret, sessionIdx === 0 && styles.headerCaretDim]}>{"▲"}</Text>
              <Text style={styles.headerCountText}>{sessionIdx + 1}/{sessions.length}</Text>
              <Text style={[styles.headerCaret, sessionIdx === sessions.length - 1 && styles.headerCaretDim]}>{"▼"}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Indicator bar: pane dots + pane count, centered — always visible, tappable to open grid */}
      {currentSession && (
        <Pressable
          onPress={() => {
            if (keyboardVisible) {
              Keyboard.dismiss();
              setTimeout(() => setPaneGridVisible(true), 200);
            } else {
              setPaneGridVisible(true);
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={[styles.indicatorBar, { backgroundColor: bgColor + "f2" }]}
        >
          <View style={styles.indicatorCenter}>
            {currentSession.panes.length > 1 && (
              <View style={styles.paneDots}>
                {currentSession.panes.map((_p, i) => (
                  <View
                    key={i}
                    style={[
                      styles.paneDot,
                      {
                        backgroundColor: currentSession.tabColor ?? "#555",
                        opacity: i === paneIdx ? 1 : 0.3,
                      },
                    ]}
                  />
                ))}
              </View>
            )}
            <View style={styles.paneWrap}>
              {currentSession.panes.length > 1 && (
                <Text style={[styles.paneChevron, paneIdx === 0 && styles.paneChevronDim]}>{"◂"}</Text>
              )}
              <Text style={styles.paneLabel}>
                Pane {paneIdx + 1} / {currentSession.panes.length}
              </Text>
              {currentSession.panes.length > 1 && (
                <Text style={[styles.paneChevron, paneIdx === currentSession.panes.length - 1 && styles.paneChevronDim]}>{"▸"}</Text>
              )}
            </View>
            <View style={styles.paneGridIcon}>
              <View style={[styles.gridSquare, styles.gridSquareFilled]} />
              <View style={[styles.gridSquare, styles.gridSquareOutline]} />
              <View style={[styles.gridSquare, styles.gridSquareFilled]} />
              <View style={[styles.gridSquare, styles.gridSquareFilled]} />
            </View>
          </View>
        </Pressable>
      )}

      {/* Terminal WebView with full-screen swipe overlay */}
      <View style={styles.terminalWrap}>
        <WebView
          ref={webViewRef}
          source={{ html: TERMINAL_HTML }}
          style={[
            styles.webview,
            { backgroundColor: bgColor },
          ]}
          onMessage={handleWebViewMessage}
          javaScriptEnabled
          originWhitelist={["*"]}
          scrollEnabled={false}
          bounces={false}
          keyboardDisplayRequiresUserAction={false}
          mixedContentMode="always"
          allowsInlineMediaPlayback
        />
        <View
          style={styles.swipeOverlay}
          onTouchStart={onOverlayTouchStart}
          onTouchMove={onOverlayTouchMove}
          onTouchEnd={onOverlayTouchEnd}
        />
      </View>

      {/* Swipeable input bar: page 1 = command input, page 2 = action keys */}
      <View style={[styles.inputContainer, { paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 8) }]}>
        <View style={styles.pageDots}>
          <Pressable onPress={() => goToPage(0)} hitSlop={8}>
            <View style={[styles.pageDot, activePage === 0 && { backgroundColor: tabColor, transform: [{ scale: 1.4 }] }]} />
          </Pressable>
          <Pressable onPress={() => goToPage(1)} hitSlop={8}>
            <View style={[styles.pageDot, activePage === 1 && { backgroundColor: tabColor, transform: [{ scale: 1.4 }] }]} />
          </Pressable>
        </View>
        <ScrollView
          ref={pageScrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          scrollEventThrottle={16}
          onMomentumScrollEnd={onPageChange}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          style={styles.pageScroll}
        >
          {/* Page 1: Command input */}
          <View style={[styles.inputPage, { width: barWidth }]}>
            <Pressable
              style={styles.actionBubble}
              onPress={() => { sendRaw("\x1b"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text style={styles.actionBubbleIcon}>{"✕"}</Text>
            </Pressable>
            <Pressable
              style={styles.actionBubble}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ["images"],
                  quality: 1,
                });
                if (result.canceled || !result.assets[0]) return;
                const asset = result.assets[0];
                const filename = asset.fileName ?? `photo.${asset.mimeType?.split("/")[1] ?? "png"}`;
                const mimeType = asset.mimeType ?? "image/png";
                try {
                  const remotePath = await uploadFile(device!, asset.uri, filename, mimeType);
                  sendRaw(remotePath);
                } catch {}
              }}
            >
              <Text style={styles.actionBubbleIcon}>{"📎"}</Text>
            </Pressable>
            <Pressable style={styles.inputWrap} onPress={() => inputRef.current?.focus()}>
              <BlurView intensity={40} tint="dark" style={styles.inputBlur}>
                <View style={[styles.inputBorder, { borderColor: tabColor + "40" }]}>
                  <Text style={styles.inputPrompt}>$</Text>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    pointerEvents="none"
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="command"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    multiline
                    blurOnSubmit={false}
                  />
                  <Pressable
                    style={[styles.sendBtn, { backgroundColor: tabColor }]}
                    onPress={() => { sendCommand(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={styles.sendText}>{"↵"}</Text>
                  </Pressable>
                </View>
              </BlurView>
            </Pressable>
          </View>

          {/* Page 2: Quick action keys */}
          <View style={[styles.actionsPage, { width: barWidth }]}>
            <Pressable
              style={styles.actionBubble}
              onPress={() => { goToPage(0); inputRef.current?.focus(); }}
            >
              <Text style={styles.actionBubbleIcon}>{"⌨"}</Text>
            </Pressable>
            <View style={styles.actionsGrid}>
              <View style={styles.actionsRow}>
                {ACTION_ROW_1.map((a) => (
                  <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                ))}
              </View>
              <View style={styles.actionsRow}>
                {ACTION_ROW_2.map((a) => (
                  <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Pane grid overlay */}
      {currentSession && (
        <PaneGrid
          visible={paneGridVisible}
          session={currentSession}
          activePaneIdx={paneIdx}
          device={device}
          tabColor={tabColor}
          onSelectPane={(idx) => {
            setPaneIdx(idx);
          }}
          onClose={() => setPaneGridVisible(false)}
          onSessionKilled={() => {
            setPaneGridVisible(false);
            router.back();
          }}
          onSessionsUpdate={(updated) => setSessions(updated)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#ef4444", fontSize: 16 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "#0a0a0f",
  },
  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 32,
    maxWidth: 120,
  },
  headerBackChevron: {
    color: "#888",
    fontSize: 22,
    lineHeight: 22,
  },
  headerBackLabel: {
    color: "#888",
    fontSize: 15,
    flexShrink: 1,
  },
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 32,
    justifyContent: "flex-end",
  },
  headerCounter: {
    flexDirection: "column",
    alignItems: "center",
  },
  headerCaret: {
    color: "#555",
    fontSize: 8,
    lineHeight: 10,
  },
  headerCaretDim: {
    opacity: 0.25,
  },
  headerCountText: {
    color: "#888",
    fontSize: 13,
    lineHeight: 16,
  },

  // Indicator bar (pane navigation)
  indicatorBar: {
    paddingVertical: 6,
    backgroundColor: "rgba(10,10,15,0.95)",
  },
  indicatorCenter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  paneDots: { flexDirection: "row", gap: 4 },
  paneDot: { width: 6, height: 6, borderRadius: 3 },

  paneWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  paneLabel: { color: "#888", fontSize: 12 },
  paneChevron: { color: "#555", fontSize: 8 },
  paneChevronDim: { opacity: 0.25 },
  paneGridIcon: {
    marginLeft: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    width: 14,
    height: 14,
    gap: 2,
  },
  gridSquare: {
    width: 6,
    height: 6,
    borderRadius: 1.5,
  },
  gridSquareFilled: {
    backgroundColor: "#555",
  },
  gridSquareOutline: {
    borderWidth: 1.5,
    borderColor: "#555",
  },

  // Terminal
  terminalWrap: { flex: 1, position: "relative" },
  webview: { flex: 1 },
  swipeOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  // Input
  inputContainer: {
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  pageDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 6,
  },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pageScroll: {
    flexGrow: 0,
  },
  inputPage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionsPage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionsGrid: {
    flex: 1,
    gap: 5,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 5,
  },
  actionKey: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionKeyLabel: {
    color: "#ccc",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    fontWeight: "500",
  },
  actionBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionBubbleIcon: {
    color: "#aaa",
    fontSize: 18,
  },
  inputWrap: {
    flex: 1,
  },
  inputBlur: {
    borderRadius: 22,
    overflow: "hidden",
  },
  inputBorder: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  inputPrompt: {
    color: "#888",
    fontSize: 15,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: "#e4e4e8",
    fontSize: 15,
    lineHeight: LINE_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    paddingVertical: 8,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "600", lineHeight: 18, marginTop: -1 },
});
