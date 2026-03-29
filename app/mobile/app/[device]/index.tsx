import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useStore } from "../../lib/store";
import { fetchSessions } from "../../lib/api";
import type { Session } from "../../lib/types";
import { GestureHelpButton } from "../../lib/GestureHelp";

export default function SessionListScreen() {
  const { device: deviceId } = useLocalSearchParams<{ device: string }>();
  const router = useRouter();
  const devices = useStore((s) => s.devices);
  const device = devices.find((d) => d.id === deviceId);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!device) return;
    try {
      setError(null);
      const data = await fetchSessions(device);
      setSessions(data);
    } catch (e) {
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

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  const renderSession = ({ item, index }: { item: Session; index: number }) => {
    const isWorktree = !!item.tabColor;
    const accent = item.tabColor ?? "#888";
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          isWorktree && {
            borderLeftColor: accent,
            borderLeftWidth: 3,
            backgroundColor: accent + "0a",
            borderColor: accent + "18",
          },
          pressed && styles.cardPressed,
        ]}
        onPress={() =>
          router.push({
            pathname: "/[device]/terminal",
            params: {
              device: deviceId,
              sessionId: item.id,
              sessionIndex: index.toString(),
            },
          })
        }
      >
        <View style={styles.cardBody}>
          <View style={styles.cardContent}>
            <View style={styles.cardTop}>
              <View style={styles.cardTitleRow}>
                {isWorktree && (
                  <View style={[styles.colorDot, { backgroundColor: accent }]} />
                )}
                <Text
                  style={[styles.sessionName, isWorktree && { color: accent }]}
                  numberOfLines={1}
                >
                  {item.tabTitle}
                </Text>
              </View>
              {!item.attached && (
                <View style={styles.detachedBadge}>
                  <Text style={styles.detachedText}>detached</Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              {item.repo ? (
                <Text style={styles.repo} numberOfLines={1}>
                  {item.repo}{item.worktree ? ` / ${item.worktree}` : ""}
                </Text>
              ) : null}
              <Text style={styles.paneCount}>
                {item.panes.length} pane{item.panes.length !== 1 ? "s" : ""}
                {item.windowCount > 1 ? ` · ${item.windowCount} windows` : ""}
              </Text>
            </View>
          </View>
          <Text style={[styles.chevron, isWorktree && { color: accent + "60" }]}>{"›"}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={renderSession}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#888"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              {error ?? "No active tmux sessions"}
            </Text>
          </View>
        }
      />
      <GestureHelpButton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16 },
  card: {
    backgroundColor: "#141420",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e1e2e",
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
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
  chevron: {
    color: "#333",
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 120 },
  emptyText: { color: "#666", fontSize: 16 },
  errorText: { color: "#ef4444", fontSize: 16 },
});
