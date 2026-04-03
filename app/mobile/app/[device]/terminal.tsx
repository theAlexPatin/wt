import { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  Dimensions,
  Animated,
  AppState,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
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

const HOTKEYS_ROW_1 = [
  { label: "ESC", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "^U", data: "\x15" },
  { label: "⌫", data: "\x7f", repeat: true },
];

const HOTKEYS_ROW_2 = [
  { label: "^C", data: "\x03" },
  { label: "^Z", data: "\x1a" },
  { label: "^D", data: "\x04" },
  { label: "⏎", data: "\r" },
];

const COMMANDS = [
  { cmd: "cc",    type: "image" as const, source: require("../../assets/commands/claude.png"), bg: "#E07B39", iconSize: 26, tintColor: "#fff" as string | undefined, toPage: 1 },
  { cmd: "wt",    type: "image" as const, source: require("../../assets/commands/wt.png"), bg: undefined, iconSize: 44, tintColor: undefined, toPage: 2 },
  { cmd: "codex", type: "image" as const, source: require("../../assets/commands/codex.png"), bg: "#2D6BE4", iconSize: 28, tintColor: undefined, toPage: 1 },
  { cmd: "amp",   type: "image" as const, source: require("../../assets/commands/amp.png"), bg: undefined, iconSize: 28, tintColor: undefined, toPage: 1 },
  { cmd: "owner", type: "image" as const, source: require("../../assets/commands/owner.png"), bg: "#0CB230", iconSize: 40, tintColor: undefined, toPage: 2 },
  { cmd: "df",    label: ".df", type: "text" as const,  bg: "rgba(255,255,255,0.15)", color: "#ccc", iconSize: undefined, source: undefined, toPage: 2 },
];

const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 80;

function ActionKey({ label, data, repeat, arrow, tabColor, sendRaw }: {
  label: string; data: string; repeat?: boolean; arrow?: boolean; tabColor: string;
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
        arrow && styles.actionKeyArrow,
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
  const [activePage, setActivePage] = useState(1); // logical: 0=commands, 1=input, 2=keystrokes
  const [barWidth, setBarWidth] = useState(SCREEN_WIDTH - 16);
  const [paneGridVisible, setPaneGridVisible] = useState(false);
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollRef = useRef(false);
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeOpacity = swipeX.interpolate({
    inputRange: [-SCREEN_WIDTH, -SCREEN_WIDTH * 0.5, 0, SCREEN_WIDTH * 0.5, SCREEN_WIDTH],
    outputRange: [0, 0.9, 1, 0.9, 0],
    extrapolate: 'clamp',
  });

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
      if (activePage === 2) goToPage(1);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, [activePage, goToPage]);

  // Connect to terminal when session/pane changes AND webview is ready
  const reconnect = useCallback(() => {
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
  }, [device, currentSession, paneIdx, webViewReady, initialized]);

  useEffect(() => { reconnect(); }, [reconnect]);

  // Auto-reconnect when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && initialized) reconnect();
    });
    return () => sub.remove();
  }, [initialized, reconnect]);

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") setWebViewReady(true);
      if (msg.type === "connected") setConnected(true);
      if (msg.type === "disconnected") {
        setConnected(false);
        if (msg.unexpected) {
          // Auto-reconnect after unexpected disconnect (app backgrounded, network blip)
          setTimeout(() => reconnect(), 500);
        }
      }
      if (msg.type === "selectionReady") {
        if (msg.text) setSelectionText(msg.text);
      }
      if (msg.type === "swipe") {
        if (msg.direction === "left") switchPane(1);
        else if (msg.direction === "right") switchPane(-1);
      }
    } catch {}
  }, [switchPane]);

  const sendRaw = useCallback((data: string) => {
    webViewRef.current?.postMessage(JSON.stringify({ type: "input", data }));
  }, []);

  const handleCopy = useCallback(() => {
    if (selectionText) {
      Clipboard.setStringAsync(selectionText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectionText(null);
      webViewRef.current?.postMessage(JSON.stringify({ type: "clearSelection" }));
    }
  }, [selectionText]);

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      sendRaw(text);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectionText(null);
    webViewRef.current?.postMessage(JSON.stringify({ type: "clearSelection" }));
  }, [sendRaw]);

  const dismissSelection = useCallback(() => {
    setSelectionText(null);
    webViewRef.current?.postMessage(JSON.stringify({ type: "clearSelection" }));
  }, []);

  const sendCommand = () => {
    sendRaw(inputText + "\r");
    setInputText("");
  };

  // Infinite scroll: 5 physical pages [Keystrokes, CmdPalette, TextInput, Keystrokes, CmdPalette]
  // Physical→Logical: 0→2, 1→0, 2→1, 3→2, 4→0
  const physToLogical = [2, 0, 1, 2, 0];

  const onPageChange = useCallback((e: any) => {
    const width = barWidth || SCREEN_WIDTH - 16;
    const phys = Math.round(e.nativeEvent.contentOffset.x / width);
    const logical = physToLogical[phys] ?? 1;
    setActivePage(logical);

    // Wrap around: jump silently to the canonical copy
    if (phys === 0) {
      setTimeout(() => pageScrollRef.current?.scrollTo({ x: 3 * width, animated: false }), 50);
    } else if (phys === 4) {
      setTimeout(() => pageScrollRef.current?.scrollTo({ x: 1 * width, animated: false }), 50);
    }
  }, [barWidth]);

  // Logical→Physical: 0(commands)→1, 1(input)→2, 2(keystrokes)→3
  const goToPage = useCallback((logical: number) => {
    const width = barWidth || SCREEN_WIDTH - 16;
    const phys = [1, 2, 3][logical] ?? 2;
    pageScrollRef.current?.scrollTo({ x: phys * width, animated: true });
    setActivePage(logical);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [barWidth]);

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
  // - 1-finger vertical drag → scroll terminal history
  // - 1-finger horizontal swipe → switch pane
  // - long press (500ms) → text selection
  const touchRef = useRef({
    x: 0, y: 0, maxTouches: 0, triggered: false,
    scrollAccum: 0, time: 0, lastScrollTime: 0,
    lastMoveTime: 0, lastMoveY: 0, velocity: 0,
    scrollPending: 0, scrollRaf: 0,
    selecting: false,
    axis: null as "h" | "v" | null, // directional lock: null until past dead zone
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
    swipeX.stopAnimation();
    swipeX.setValue(0);
    const touches = e.nativeEvent.touches;
    const count = Array.isArray(touches) ? touches.length : 1;
    const now = Date.now();
    touchRef.current = {
      x: e.nativeEvent.pageX, y: e.nativeEvent.pageY,
      maxTouches: count, triggered: false,
      scrollAccum: 0, time: now, lastScrollTime: touchRef.current.lastScrollTime,
      lastMoveTime: now, lastMoveY: e.nativeEvent.pageY, velocity: 0,
      scrollPending: 0, scrollRaf: 0,
      selecting: false,
      axis: null,
    };
    // Dismiss selection popup if visible
    if (selectionText) {
      dismissSelection();
    }
    const locX = e.nativeEvent.locationX;
    const locY = e.nativeEvent.locationY;
    // Long press detection: 500ms hold → start text selection
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      const t = touchRef.current;
      if (!t.triggered && t.maxTouches < 2) {
        t.triggered = true;
        t.selecting = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        webViewRef.current?.postMessage(JSON.stringify({ type: "selectStart", x: locX, y: locY }));
      }
    }, 500);
  }, [keyboardVisible, selectionText, dismissSelection]);

  const onOverlayTouchMove = useCallback((e: any) => {
    const t = touchRef.current;
    const touches = e.nativeEvent.touches;
    const count = Array.isArray(touches) ? touches.length : 1;
    if (count > t.maxTouches) t.maxTouches = count;

    // Cancel long press if moved too far (before selection starts)
    if (longPressTimer.current) {
      const dx = Math.abs(e.nativeEvent.pageX - t.x);
      const dy = Math.abs(e.nativeEvent.pageY - t.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }

    // Forward drag coordinates during text selection
    if (t.selecting) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: "selectMove",
        x: e.nativeEvent.locationX,
        y: e.nativeEvent.locationY,
      }));
      return;
    }

    const totalDx = Math.abs(e.nativeEvent.pageX - t.x);
    const totalDy = Math.abs(e.nativeEvent.pageY - t.y);

    // Determine directional lock once past dead zone (15px)
    if (!t.axis && (totalDx > 15 || totalDy > 15)) {
      t.axis = totalDy >= totalDx ? "v" : "h";
      t.triggered = true; // commit to gesture — prevents tap
    }

    // Vertical axis locked → scroll terminal
    if (t.axis === "v") {
      const now = Date.now();
      const dy = e.nativeEvent.pageY - t.lastMoveY;
      const dt = now - t.lastMoveTime;

      if (dt > 0) {
        const instantV = Math.abs(dy) / dt;
        t.velocity = t.velocity * 0.6 + instantV * 0.4;
      }

      const multiplier = 1 + Math.min(t.velocity * 4, 4);
      t.scrollAccum += dy * multiplier;
      t.lastMoveTime = now;
      t.lastMoveY = e.nativeEvent.pageY;

      const lines = Math.trunc(t.scrollAccum / 12);
      if (lines !== 0) {
        t.scrollAccum -= lines * 12;
        t.lastScrollTime = now;
        webViewRef.current?.postMessage(
          JSON.stringify({ type: "scroll", lines })
        );
      }
    }

    // Horizontal axis: track finger for swipe animation
    if (t.axis === "h") {
      const dx = e.nativeEvent.pageX - t.x;
      swipeX.setValue(dx);
    }
  }, [flushScroll]);

  const onOverlayTouchEnd = useCallback((e: any) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const t = touchRef.current;
    // Finalize text selection
    if (t.selecting) {
      t.selecting = false;
      webViewRef.current?.postMessage(JSON.stringify({ type: "selectEnd" }));
      return;
    }
    // Horizontal swipe → animated pane switch
    if (t.axis === "h" && t.maxTouches < 2) {
      const dx = e.nativeEvent.pageX - t.x;
      if (Math.abs(dx) > 30 && currentSession && currentSession.panes.length > 1) {
        const direction = dx < 0 ? 1 : -1;
        // Slide old content off-screen, then switch pane while hidden
        Animated.timing(swipeX, {
          toValue: dx < 0 ? -SCREEN_WIDTH : SCREEN_WIDTH,
          duration: 150,
          useNativeDriver: false,
        }).start(() => {
          switchPane(direction);
          swipeX.setValue(dx < 0 ? SCREEN_WIDTH : -SCREEN_WIDTH);
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: false,
            tension: 80,
            friction: 12,
          }).start();
        });
      } else {
        // Snap back
        Animated.spring(swipeX, {
          toValue: 0,
          useNativeDriver: false,
          tension: 120,
          friction: 10,
        }).start();
      }
      return;
    }

    if (t.triggered) return;

    const dx = e.nativeEvent.pageX - t.x;
    const dy = e.nativeEvent.pageY - t.y;
    const elapsed = Date.now() - t.time;

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
  }, [switchPane, keyboardVisible, currentSession]);

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
        <Pressable style={styles.headerRight} onPress={() => router.dismissTo(`/${deviceId}`)} hitSlop={12}>
          <Text style={styles.headerSessionsLabel}>Sessions</Text>
        </Pressable>
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
      <Animated.View style={[styles.terminalWrap, {
        transform: [{ translateX: swipeX }],
        opacity: swipeOpacity,
      }]}>
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
        {selectionText && (
          <View style={[styles.selectPopup, { backgroundColor: bgColor + "f0" }]}>
            <Pressable
              style={[styles.selectBtn, { borderColor: tabColor + "40" }]}
              onPress={handleCopy}
            >
              <Text style={styles.selectBtnText}>Copy</Text>
            </Pressable>
            <Pressable
              style={[styles.selectBtn, { borderColor: tabColor + "40" }]}
              onPress={handlePaste}
            >
              <Text style={styles.selectBtnText}>Paste</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>

      {/* Swipeable input bar: commands <-> text input <-> keystrokes (infinite cycle) */}
      <View style={[styles.inputContainer, { paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 8) }]}>
        <View style={styles.pageDots}>
          {[0, 1, 2].map((p) => (
            <Pressable key={p} onPress={() => goToPage(p)} hitSlop={8}>
              <View style={[styles.pageDot, activePage === p && { backgroundColor: tabColor, transform: [{ scale: 1.4 }] }]} />
            </Pressable>
          ))}
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
          contentOffset={{ x: 2 * (SCREEN_WIDTH - 16), y: 0 }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setBarWidth(w);
            if (!initialScrollRef.current) {
              initialScrollRef.current = true;
              pageScrollRef.current?.scrollTo({ x: 2 * w, animated: false });
            }
          }}
          style={styles.pageScroll}
        >
          {/* Physical 0: Keystrokes (clone for infinite wrap) */}
          <View style={[styles.actionsPage, { width: barWidth }]}>
            <Pressable
              style={styles.actionBubble}
              onPress={() => { goToPage(1); inputRef.current?.focus(); }}
            >
              <Text style={styles.actionBubbleIcon}>{"⌨"}</Text>
            </Pressable>
            <View style={styles.actionsGrid}>
              <View style={styles.actionsLeft}>
                <View style={styles.actionsRow}>
                  {HOTKEYS_ROW_1.map((a) => (
                    <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                  ))}
                </View>
                <View style={styles.actionsRow}>
                  {HOTKEYS_ROW_2.map((a) => (
                    <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                  ))}
                </View>
              </View>
              <View style={styles.arrowCluster}>
                <ActionKey label="↑" data={"\x1b[A"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                <View style={styles.arrowBottomRow}>
                  <ActionKey label="←" data={"\x1b[D"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                  <ActionKey label="↓" data={"\x1b[B"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                  <ActionKey label="→" data={"\x1b[C"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                </View>
              </View>
            </View>
          </View>

          {/* Physical 1: Command Palette */}
          <View style={[styles.commandPage, { width: barWidth }]}>
            {COMMANDS.map((c) => (
              <Pressable
                key={c.cmd}
                style={styles.commandItem}
                onPress={() => {
                  sendRaw(c.cmd + "\r");
                  goToPage(c.toPage);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.commandBubble, c.bg ? { backgroundColor: c.bg } : undefined]}>
                  {c.type === "image" ? (
                    <Image source={c.source!} style={[styles.commandIcon, c.iconSize ? { width: c.iconSize, height: c.iconSize } : undefined, c.tintColor ? { tintColor: c.tintColor } : undefined]} resizeMode="contain" />
                  ) : (
                    <Text style={[styles.commandText, c.color ? { color: c.color } : undefined]}>{c.label}</Text>
                  )}
                </View>
                <Text style={styles.commandName}>{c.cmd}</Text>
              </Pressable>
            ))}
          </View>

          {/* Physical 2: Text Input (default) */}
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
                    pointerEvents={keyboardVisible ? "auto" : "none"}
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

          {/* Physical 3: Keystrokes */}
          <View style={[styles.actionsPage, { width: barWidth }]}>
            <Pressable
              style={styles.actionBubble}
              onPress={() => { goToPage(1); inputRef.current?.focus(); }}
            >
              <Text style={styles.actionBubbleIcon}>{"⌨"}</Text>
            </Pressable>
            <View style={styles.actionsGrid}>
              <View style={styles.actionsLeft}>
                <View style={styles.actionsRow}>
                  {HOTKEYS_ROW_1.map((a) => (
                    <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                  ))}
                </View>
                <View style={styles.actionsRow}>
                  {HOTKEYS_ROW_2.map((a) => (
                    <ActionKey key={a.label} {...a} tabColor={tabColor} sendRaw={sendRaw} />
                  ))}
                </View>
              </View>
              <View style={styles.arrowCluster}>
                <ActionKey label="↑" data={"\x1b[A"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                <View style={styles.arrowBottomRow}>
                  <ActionKey label="←" data={"\x1b[D"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                  <ActionKey label="↓" data={"\x1b[B"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                  <ActionKey label="→" data={"\x1b[C"} repeat arrow tabColor={tabColor} sendRaw={sendRaw} />
                </View>
              </View>
            </View>
          </View>

          {/* Physical 4: Command Palette (clone for infinite wrap) */}
          <View style={[styles.commandPage, { width: barWidth }]}>
            {COMMANDS.map((c) => (
              <Pressable
                key={c.cmd}
                style={styles.commandItem}
                onPress={() => {
                  sendRaw(c.cmd + "\r");
                  goToPage(c.toPage);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.commandBubble, c.bg ? { backgroundColor: c.bg } : undefined]}>
                  {c.type === "image" ? (
                    <Image source={c.source!} style={[styles.commandIcon, c.iconSize ? { width: c.iconSize, height: c.iconSize } : undefined, c.tintColor ? { tintColor: c.tintColor } : undefined]} resizeMode="contain" />
                  ) : (
                    <Text style={[styles.commandText, c.color ? { color: c.color } : undefined]}>{c.label}</Text>
                  )}
                </View>
                <Text style={styles.commandName}>{c.cmd}</Text>
              </Pressable>
            ))}
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
  headerSessionsLabel: {
    color: "#888",
    fontSize: 15,
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
  // Selection popup
  selectPopup: {
    position: "absolute",
    bottom: 8,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    padding: 6,
    borderRadius: 10,
    zIndex: 20,
  },
  selectBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectBtnText: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "600",
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
    flexDirection: "row",
    gap: 8,
  },
  actionsLeft: {
    flex: 1,
    gap: 5,
  },
  arrowCluster: {
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowBottomRow: {
    flexDirection: "row",
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
  actionKeyArrow: {
    flex: 0,
    width: 42,
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

  // Command palette
  commandPage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 4,
  },
  commandItem: {
    alignItems: "center",
    gap: 4,
  },
  commandBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  commandIcon: {
    width: 28,
    height: 28,
  },
  commandText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    color: "#ccc",
  },
  commandName: {
    color: "#666",
    fontSize: 10,
    fontWeight: "500",
  },
});
