import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useStore } from "../../lib/store";
import {
  fetchSessions,
  createSession,
  deleteSession,
  renameSession,
} from "../../lib/api";
import type { Session } from "../../lib/types";
import { SwipeableRow, type SwipeableRowRef } from "../../lib/SwipeableRow";

const BG = "#0a0a0f";
const ITEM_SPACING = 10;

/** Sort: wt sessions first, then attached non-wt, then unattached */
function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const aGroup = a.tabColor ? 0 : a.attached ? 1 : 2;
    const bGroup = b.tabColor ? 0 : b.attached ? 1 : 2;
    if (aGroup !== bGroup) return aGroup - bGroup;
    return 0; // preserve original order within groups
  });
}

export default function SessionListScreen() {
  const { device: deviceId } = useLocalSearchParams<{ device: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const devices = useStore((s) => s.devices);
  const device = devices.find((d) => d.id === deviceId);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const itemHeights = useRef<Map<string, number>>(new Map());
  const scrollViewScreenY = useRef(0);
  const scrollOffset = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const lastReorderTime = useRef(0);

  // Swipe refs
  const swipeRefs = useRef<Map<string, SwipeableRowRef>>(new Map());

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameText, setRenameText] = useState("");

  const loadSessions = useCallback(async () => {
    if (!device) return;
    try {
      setError(null);
      const data = await fetchSessions(device);
      setSessions(sortSessions(data));
    } catch {
      setError("Could not connect to wt-server");
      setSessions([]);
    }
  }, [device]);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  // --- Actions ---

  const handleCreate = async () => {
    if (!device || creating) return;
    setCreating(true);
    try {
      const { name } = await createSession(device);
      const data = await fetchSessions(device);
      const sorted = sortSessions(data);
      setSessions(sorted);
      const idx = sorted.findIndex((s) => s.id === name);
      if (idx >= 0) {
        router.push({
          pathname: "/[device]/terminal",
          params: {
            device: deviceId,
            sessionId: name,
            sessionIndex: idx.toString(),
          },
        });
      }
    } catch {
      Alert.alert("Error", "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (session: Session) => {
    Alert.alert(
      "Kill Session",
      `Kill "${session.tabTitle}"? This will terminate all processes in this session.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill",
          style: "destructive",
          onPress: async () => {
            if (!device) return;
            try {
              await deleteSession(device, session.id);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setSessions((prev) => prev.filter((s) => s.id !== session.id));
            } catch {
              Alert.alert("Error", "Failed to kill session");
            }
          },
        },
      ]
    );
  };

  const handleRenameStart = (session: Session) => {
    setRenameTarget(session);
    setRenameText(session.name);
  };

  const handleRenameSubmit = async () => {
    if (!device || !renameTarget || !renameText.trim()) return;
    const newName = renameText.trim();
    if (newName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    try {
      await renameSession(device, renameTarget.name, newName);
      setRenameTarget(null);
      await loadSessions();
    } catch {
      Alert.alert("Error", "Failed to rename session");
    }
  };

  // --- Drag and drop ---

  const closeAllSwipes = () => {
    swipeRefs.current.forEach((ref) => ref.close());
  };

  const startDrag = useCallback(
    (index: number) => {
      closeAllSwipes();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Measure scroll view position on screen
      (scrollRef.current as any)?.measureInWindow?.(
        (_x: number, y: number) => {
          scrollViewScreenY.current = y;
        }
      );
      setDragIndex(index);
    },
    []
  );

  const handleTouchMove = useCallback(
    (e: any) => {
      if (dragIndex === null) return;
      const now = Date.now();
      if (now - lastReorderTime.current < 200) return;

      const touchY: number = e.nativeEvent.pageY;
      const listY =
        touchY - scrollViewScreenY.current + scrollOffset.current - 16; // 16 = list padding

      // Calculate target index from cumulative heights
      let cumY = 0;
      let targetIndex = sessions.length - 1;
      for (let i = 0; i < sessions.length; i++) {
        const h = (itemHeights.current.get(sessions[i]!.id) ?? 72) + ITEM_SPACING;
        if (listY < cumY + h / 2) {
          targetIndex = i;
          break;
        }
        cumY += h;
      }
      targetIndex = Math.max(0, Math.min(sessions.length - 1, targetIndex));

      if (targetIndex !== dragIndex) {
        lastReorderTime.current = now;
        LayoutAnimation.configureNext({
          duration: 200,
          update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.scaleY },
        });
        const next = [...sessions];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(targetIndex, 0, moved!);
        setSessions(next);
        setDragIndex(targetIndex);
        Haptics.selectionAsync();
      }
    },
    [dragIndex, sessions]
  );

  const handleTouchEnd = useCallback(() => {
    if (dragIndex !== null) {
      setDragIndex(null);
    }
  }, [dragIndex]);

  // --- Render ---

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={dragIndex === null}
        contentContainerStyle={styles.list}
        onScroll={(e) => {
          scrollOffset.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#888"
          />
        }
      >
        {sessions.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              {error ?? "No active tmux sessions"}
            </Text>
          </View>
        ) : (
          sessions.map((session, index) => {
            const isWorktree = !!session.tabColor;
            const isDetached = !session.attached;
            const accent = session.tabColor ?? "#888";
            const isDragging = dragIndex === index;

            return (
              <View
                key={session.id}
                onLayout={(e) => {
                  itemHeights.current.set(
                    session.id,
                    e.nativeEvent.layout.height
                  );
                }}
              >
                <SwipeableRow
                  ref={(r) => {
                    if (r) swipeRefs.current.set(session.id, r);
                    else swipeRefs.current.delete(session.id);
                  }}
                  onDelete={() => handleDelete(session)}
                  onRename={() => handleRenameStart(session)}
                  enabled={dragIndex === null}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.card,
                      isWorktree && {
                        borderLeftColor: accent,
                        borderLeftWidth: 3,
                        backgroundColor: accent + "0a",
                        borderColor: accent + "18",
                      },
                      isDetached && styles.cardDetached,
                      pressed && !isDragging && styles.cardPressed,
                      isDragging && styles.cardDragging,
                    ]}
                    onPress={() => {
                      closeAllSwipes();
                      router.push({
                        pathname: "/[device]/terminal",
                        params: {
                          device: deviceId,
                          sessionId: session.id,
                          sessionIndex: index.toString(),
                        },
                      });
                    }}
                    onLongPress={() => startDrag(index)}
                    delayLongPress={300}
                  >
                    <View style={styles.cardBody}>
                      <View style={styles.cardContent}>
                        <View style={styles.cardTop}>
                          <View style={styles.cardTitleRow}>
                            {isWorktree && (
                              <View
                                style={[
                                  styles.colorDot,
                                  {
                                    backgroundColor: accent,
                                    opacity: isDetached ? 0.4 : 1,
                                  },
                                ]}
                              />
                            )}
                            <Text
                              style={[
                                styles.sessionName,
                                isWorktree && { color: accent },
                                isDetached && styles.textDetached,
                              ]}
                              numberOfLines={1}
                            >
                              {session.tabTitle}
                            </Text>
                          </View>
                          {isDetached && (
                            <View style={styles.detachedBadge}>
                              <Text style={styles.detachedText}>
                                detached
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.metaRow}>
                          {session.repo ? (
                            <Text
                              style={[
                                styles.repo,
                                isDetached && styles.metaDetached,
                              ]}
                              numberOfLines={1}
                            >
                              {session.repo}
                              {session.worktree
                                ? ` / ${session.worktree}`
                                : ""}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.paneCount,
                              isDetached && styles.metaDetached,
                            ]}
                          >
                            {session.panes.length} pane
                            {session.panes.length !== 1 ? "s" : ""}
                            {session.windowCount > 1
                              ? ` · ${session.windowCount} windows`
                              : ""}
                          </Text>
                        </View>
                      </View>
                      {isDragging ? (
                        <Text style={styles.dragHandle}>{"≡"}</Text>
                      ) : (
                        <Text
                          style={[
                            styles.chevron,
                            isWorktree && { color: accent + "60" },
                            isDetached && { color: "#222" },
                          ]}
                        >
                          {"›"}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </SwipeableRow>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Floating + button */}
      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={handleCreate}
        disabled={creating}
      >
        <Text style={[styles.fabIcon, creating && { opacity: 0.4 }]}>
          {"+"}
        </Text>
      </Pressable>

      {/* Rename modal */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setRenameTarget(null)}
          >
            <Pressable
              style={styles.modalCard}
              onPress={() => {}}
            >
              <Text style={styles.modalTitle}>Rename Session</Text>
              <TextInput
                style={styles.modalInput}
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                selectionColor="#D4900A"
                placeholderTextColor="#555"
                placeholder="Session name"
                onSubmitEditing={handleRenameSubmit}
              />
              <View style={styles.modalButtons}>
                <Pressable
                  style={styles.modalCancel}
                  onPress={() => setRenameTarget(null)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalSave,
                    !renameText.trim() && { opacity: 0.3 },
                  ]}
                  onPress={handleRenameSubmit}
                  disabled={!renameText.trim()}
                >
                  <Text style={styles.modalSaveText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 100 },

  // Card
  card: {
    backgroundColor: "#141420",
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e1e2e",
  },
  cardDetached: {
    opacity: 0.45,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  cardDragging: {
    transform: [{ scale: 1.03 }],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
    borderColor: "#333",
  },
  cardBody: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  colorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sessionName: {
    color: "#e4e4e8",
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  textDetached: {
    color: "#e4e4e8",
  },
  chevron: {
    color: "#333",
    fontSize: 22,
    marginLeft: 12,
  },
  dragHandle: {
    color: "#555",
    fontSize: 22,
    marginLeft: 12,
  },
  detachedBadge: {
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
  },
  detachedText: { color: "#555", fontSize: 11, fontWeight: "600" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
    gap: 8,
  },
  repo: {
    color: "#888",
    fontSize: 12,
    flexShrink: 1,
  },
  paneCount: { color: "#555", fontSize: 12 },
  metaDetached: { color: "#444" },

  // Empty / error
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 120,
  },
  emptyText: { color: "#666", fontSize: 16 },
  errorText: { color: "#ef4444", fontSize: 16 },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D4900A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#D4900A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabIcon: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "300",
    marginTop: -1,
  },

  // Rename modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#1a1a2a",
    borderRadius: 16,
    padding: 24,
    width: "95%",
    borderWidth: 1,
    borderColor: "#2a2a3a",
    gap: 16,
  },
  modalTitle: {
    color: "#e4e4e8",
    fontSize: 17,
    fontWeight: "600",
  },
  modalInput: {
    backgroundColor: "#111118",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a3a",
    padding: 14,
    color: "#e4e4e8",
    fontSize: 16,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  modalCancelText: { color: "#888", fontSize: 15, fontWeight: "600" },
  modalSave: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#D4900A",
    alignItems: "center",
  },
  modalSaveText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
