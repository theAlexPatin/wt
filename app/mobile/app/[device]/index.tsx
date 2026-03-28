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
    const color = item.tabColor ?? "#555";
    return (
      <Pressable
        style={[styles.card, { borderLeftColor: color, borderLeftWidth: 3 }]}
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
        <View style={styles.cardTop}>
          <Text style={[styles.sessionName, { color }]}>
            {item.tabTitle}
          </Text>
          {item.attached && (
            <View style={styles.attachedBadge}>
              <Text style={styles.attachedText}>attached</Text>
            </View>
          )}
        </View>
        {item.repo && (
          <Text style={styles.repo}>
            {item.repo}
            {item.worktree ? ` / ${item.worktree}` : ""}
          </Text>
        )}
        <Text style={styles.paneCount}>
          {item.panes.length} pane{item.panes.length !== 1 ? "s" : ""} ·{" "}
          {item.windowCount} window{item.windowCount !== 1 ? "s" : ""}
        </Text>
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
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e1e2e",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionName: { fontSize: 17, fontWeight: "600" },
  attachedBadge: {
    backgroundColor: "rgba(52,211,153,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  attachedText: { color: "#34d399", fontSize: 11, fontWeight: "600" },
  repo: { color: "#888", fontSize: 13, marginTop: 6 },
  paneCount: { color: "#555", fontSize: 12, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 120 },
  emptyText: { color: "#555", fontSize: 16 },
  errorText: { color: "#ef4444", fontSize: 16 },
});
