import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { splitPane, killPane, capturePane, fetchSessions } from "./api";
import type { Device, Session, SessionPane } from "./types";

interface PaneGridProps {
  visible: boolean;
  session: Session | undefined;
  activePaneIdx: number;
  device: Device;
  tabColor: string;
  onSelectPane: (paneIndex: number) => void;
  onClose: () => void;
  onSessionKilled: () => void;
  onSessionsUpdate: (sessions: Session[]) => void;
}

export function PaneGrid({
  visible,
  session,
  activePaneIdx,
  device,
  tabColor,
  onSelectPane,
  onClose,
  onSessionKilled,
  onSessionsUpdate,
}: PaneGridProps) {
  const insets = useSafeAreaInsets();
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  // Fetch text previews when grid opens
  useEffect(() => {
    if (!visible || !session) {
      setPreviews(new Map());
      return;
    }
    setLoading(true);
    const promises = session.panes.map(async (pane) => {
      const key = `${pane.windowIndex}.${pane.index}`;
      try {
        const { text } = await capturePane(device, session.id, pane.windowIndex, pane.index, 8);
        return [key, text] as const;
      } catch {
        return [key, ""] as const;
      }
    });
    Promise.all(promises).then((results) => {
      setPreviews(new Map(results));
      setLoading(false);
    });
  }, [visible, session?.id, session?.panes.length]);

  const refreshSession = useCallback(async () => {
    try {
      const sessions = await fetchSessions(device);
      onSessionsUpdate(sessions);
    } catch {}
  }, [device, onSessionsUpdate]);

  const handleSplit = useCallback(async () => {
    if (!session) return;
    const activePane = session.panes[activePaneIdx];
    if (!activePane) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await splitPane(device, session.id, activePane.windowIndex, activePane.index);
      await refreshSession();
      // Select the newly created pane (inserted right after the split source)
      onSelectPane(activePaneIdx + 1);
    } catch {
      Alert.alert("Error", "Failed to split pane");
    }
  }, [session, activePaneIdx, device, refreshSession, onSelectPane]);

  const handleKill = useCallback(async (pane: SessionPane, idx: number) => {
    if (!session) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await killPane(device, session.id, pane.windowIndex, pane.index);
      if (result.sessionKilled) {
        onSessionKilled();
        return;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await refreshSession();
      // If we killed the active pane, select a neighbor
      if (idx === activePaneIdx) {
        onSelectPane(Math.max(0, activePaneIdx - 1));
      } else if (idx < activePaneIdx) {
        onSelectPane(activePaneIdx - 1);
      }
    } catch {
      Alert.alert("Error", "Failed to kill pane");
    }
  }, [session, activePaneIdx, device, refreshSession, onSelectPane, onSessionKilled]);

  if (!session) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {session.panes.length} Pane{session.panes.length !== 1 ? "s" : ""}
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.doneText, { color: tabColor }]}>Done</Text>
          </Pressable>
        </View>

        {/* Grid */}
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
        >
          {session.panes.map((pane, idx) => {
            const isActive = idx === activePaneIdx;
            const previewKey = `${pane.windowIndex}.${pane.index}`;
            const preview = previews.get(previewKey) ?? "";
            // Trim and take last 5 non-empty lines for display
            const lines = preview.split("\n").filter((l) => l.trim()).slice(-5);

            return (
              <Pressable
                key={previewKey}
                style={({ pressed }) => [
                  styles.card,
                  isActive && { borderColor: tabColor, shadowColor: tabColor, shadowOpacity: 0.3 },
                  pressed && styles.cardPressed,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSelectPane(idx);
                  onClose();
                }}
              >
                {/* Card header */}
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleRow}>
                    {isActive && (
                      <View style={[styles.activeDot, { backgroundColor: tabColor }]} />
                    )}
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {pane.windowName || `window ${pane.windowIndex}`}
                    </Text>
                  </View>
                  <Text style={styles.cardBadge}>
                    {pane.windowIndex}:{pane.index}
                  </Text>
                </View>

                {/* Preview */}
                <View style={[styles.previewWrap, { backgroundColor: session.paneColor ?? "#0a0a0f" }]}>
                  {lines.length > 0 ? (
                    lines.map((line, i) => (
                      <Text key={i} style={styles.previewLine} numberOfLines={1}>
                        {line}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.previewEmpty}>
                      {loading ? "..." : "---"}
                    </Text>
                  )}
                </View>

                {/* Close button */}
                <Pressable
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && styles.closeBtnPressed,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleKill(pane, idx);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* FAB */}
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: tabColor },
            pressed && styles.fabPressed,
          ]}
          onPress={handleSplit}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#0a0a0f",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    color: "#e4e4e8",
    fontSize: 20,
    fontWeight: "700",
  },
  doneText: {
    fontSize: 17,
    fontWeight: "600",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: "#141420",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#1e1e2e",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.97 }],
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardTitle: {
    color: "#ccc",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  cardBadge: {
    color: "#555",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    marginRight: 28,
  },
  previewWrap: {
    marginHorizontal: 6,
    marginBottom: 6,
    borderRadius: 8,
    padding: 8,
    minHeight: 80,
    justifyContent: "flex-end",
  },
  previewLine: {
    color: "rgba(228,228,232,0.6)",
    fontSize: 8,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    lineHeight: 12,
  },
  previewEmpty: {
    color: "#333",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnPressed: {
    backgroundColor: "rgba(239,68,68,0.3)",
  },
  closeBtnText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "600",
  },
  fab: {
    position: "absolute",
    bottom: 40,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.93 }],
  },
  fabText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
  },
});
