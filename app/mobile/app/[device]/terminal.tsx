import { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useStore } from "../../lib/store";
import { fetchSessions, terminalWsUrl } from "../../lib/api";
import type { Session } from "../../lib/types";

const TERMINAL_HTML = require("../../assets/terminal.html");

export default function TerminalScreen() {
  const { device: deviceId, sessionIndex: initialIndex } =
    useLocalSearchParams<{ device: string; sessionId: string; sessionIndex: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const devices = useStore((s) => s.devices);
  const device = devices.find((d) => d.id === deviceId);

  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [inputText, setInputText] = useState("");
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionIdx, setSessionIdx] = useState(parseInt(initialIndex ?? "0", 10));
  const [paneIdx, setPaneIdx] = useState(0);

  const currentSession = sessions[sessionIdx];
  const translateX = useSharedValue(0);

  // Load sessions
  useEffect(() => {
    if (!device) return;
    fetchSessions(device).then(setSessions).catch(() => {});
  }, [device]);

  // Connect to terminal when session or pane changes
  useEffect(() => {
    if (!device || !currentSession) return;
    const wsUrl = terminalWsUrl(device, currentSession.id, paneIdx, 80, 24);
    const msg = JSON.stringify({
      type: sessionIdx === parseInt(initialIndex ?? "0", 10) && paneIdx === 0 ? "init" : "reconnect",
      wsUrl,
      paneColor: currentSession.paneColor,
    });
    webViewRef.current?.postMessage(msg);
  }, [device, currentSession, paneIdx]);

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "connected") setConnected(true);
      if (msg.type === "disconnected") setConnected(false);
    } catch {}
  }, []);

  const sendCommand = () => {
    if (!inputText.trim()) return;
    const msg = JSON.stringify({ type: "input", data: inputText + "\n" });
    webViewRef.current?.postMessage(msg);
    setInputText("");
  };

  // Gesture: swipe left/right for sessions
  const switchSession = useCallback(
    (direction: number) => {
      const nextIdx = sessionIdx + direction;
      if (nextIdx < 0 || nextIdx >= sessions.length) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPaneIdx(0);
      setSessionIdx(nextIdx);
    },
    [sessionIdx, sessions.length]
  );

  // Gesture: swipe up/down for panes
  const switchPane = useCallback(
    (direction: number) => {
      if (!currentSession) return;
      const nextPane = paneIdx + direction;
      if (nextPane < 0 || nextPane >= currentSession.panes.length) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPaneIdx(nextPane);
    },
    [paneIdx, currentSession]
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .activeOffsetY([-30, 30])
    .onUpdate((e) => {
      translateX.value = e.translationX * 0.3;
    })
    .onEnd((e) => {
      translateX.value = withTiming(0, { duration: 200 });
      const { translationX, translationY, velocityX, velocityY } = e;

      // Determine dominant axis
      if (Math.abs(translationX) > Math.abs(translationY)) {
        // Horizontal swipe — switch session
        if (translationX < -60 || velocityX < -500) {
          runOnJS(switchSession)(1);
        } else if (translationX > 60 || velocityX > 500) {
          runOnJS(switchSession)(-1);
        }
      } else {
        // Vertical swipe — switch pane
        if (translationY < -60 || velocityY < -500) {
          runOnJS(switchPane)(1);
        } else if (translationY > 60 || velocityY > 500) {
          runOnJS(switchPane)(-1);
        }
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  const tabColor = currentSession?.tabColor ?? "#555";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Session indicator bar */}
      <View style={[styles.indicator, { paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>{"‹"}</Text>
        </Pressable>
        <View style={styles.indicatorCenter}>
          <View style={[styles.indicatorDot, { backgroundColor: tabColor }]} />
          <Text style={styles.indicatorTitle} numberOfLines={1}>
            {currentSession?.tabTitle ?? "..."}
          </Text>
          {currentSession && currentSession.panes.length > 1 && (
            <Text style={styles.paneLabel}>
              pane {paneIdx + 1}/{currentSession.panes.length}
            </Text>
          )}
        </View>
        <View style={styles.sessionDots}>
          {sessions.map((s, i) => (
            <View
              key={s.id}
              style={[
                styles.sessionDot,
                {
                  backgroundColor: s.tabColor ?? "#555",
                  opacity: i === sessionIdx ? 1 : 0.3,
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Terminal WebView */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.terminalWrap, animatedStyle]}>
          <WebView
            ref={webViewRef}
            source={TERMINAL_HTML}
            style={[
              styles.webview,
              { backgroundColor: currentSession?.paneColor ?? "#0a0a0f" },
            ]}
            onMessage={handleWebViewMessage}
            javaScriptEnabled
            originWhitelist={["*"]}
            scrollEnabled={false}
            bounces={false}
            keyboardDisplayRequiresUserAction={false}
          />
        </Animated.View>
      </GestureDetector>

      {/* Glass-style command input */}
      <View style={[styles.inputWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <BlurView intensity={40} tint="dark" style={styles.inputBlur}>
          <View style={[styles.inputBorder, { borderColor: tabColor + "40" }]}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="$ command"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="send"
              onSubmitEditing={sendCommand}
              blurOnSubmit={false}
            />
            <Pressable
              style={[styles.sendBtn, { backgroundColor: tabColor }]}
              onPress={sendCommand}
            >
              <Text style={styles.sendText}>{"↵"}</Text>
            </Pressable>
          </View>
        </BlurView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#ef4444", fontSize: 16 },

  // Indicator bar
  indicator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: "rgba(10,10,15,0.9)",
  },
  backBtn: { padding: 8, marginRight: 4 },
  backText: { color: "#fff", fontSize: 28, fontWeight: "300" },
  indicatorCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  indicatorDot: { width: 8, height: 8, borderRadius: 4 },
  indicatorTitle: { color: "#fff", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  paneLabel: { color: "#888", fontSize: 11 },
  sessionDots: { flexDirection: "row", gap: 4 },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },

  // Terminal
  terminalWrap: { flex: 1 },
  webview: { flex: 1 },

  // Input
  inputWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
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
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    color: "#e4e4e8",
    fontSize: 15,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    paddingVertical: 10,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
