import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore } from "../lib/store";
import { checkHealth } from "../lib/api";
import type { Device } from "../lib/types";

export default function DeviceListScreen() {
  const router = useRouter();
  const { devices, addDevice, removeDevice } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("7890");
  const [healthMap, setHealthMap] = useState<Record<string, boolean>>({});

  const refreshHealth = useCallback(async () => {
    const results: Record<string, boolean> = {};
    await Promise.all(
      devices.map(async (d) => {
        try {
          const h = await checkHealth(d);
          results[d.id] = h.ok && h.tmux;
        } catch {
          results[d.id] = false;
        }
      })
    );
    setHealthMap(results);
  }, [devices]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const handleAdd = () => {
    if (!name.trim() || !host.trim()) return;
    addDevice({ name: name.trim(), host: host.trim(), port: parseInt(port, 10) || 7890 });
    setName("");
    setHost("");
    setPort("7890");
    setShowAdd(false);
  };

  const handleDelete = (device: Device) => {
    Alert.alert("Remove Device", `Remove "${device.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeDevice(device.id) },
    ]);
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const online = healthMap[item.id];
    return (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/${item.id}`)}
        onLongPress={() => handleDelete(item)}
      >
        <View style={styles.cardHeader}>
          <View
            style={[styles.dot, { backgroundColor: online ? "#34d399" : "#ef4444" }]}
          />
          <Text style={styles.cardTitle}>{item.name}</Text>
        </View>
        <Text style={styles.cardSub}>
          {item.host}:{item.port}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={devices}
        keyExtractor={(d) => d.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No devices yet</Text>
            <Text style={styles.emptyHint}>
              Add a device running wt-server
            </Text>
          </View>
        }
      />

      <Pressable style={styles.addButton} onPress={() => setShowAdd(true)}>
        <Text style={styles.addButtonText}>+ Add Device</Text>
      </Pressable>

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Device</Text>

            <TextInput
              style={styles.input}
              placeholder="Name (e.g. My Mac)"
              placeholderTextColor="#666"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Host (e.g. 192.168.1.10)"
              placeholderTextColor="#666"
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              style={styles.input}
              placeholder="Port (default: 7890)"
              placeholderTextColor="#666"
              value={port}
              onChangeText={setPort}
              keyboardType="number-pad"
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setShowAdd(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveBtn} onPress={handleAdd}>
                <Text style={styles.saveText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 80 },
  card: {
    backgroundColor: "#141420",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e1e2e",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  cardSub: { color: "#888", fontSize: 13, marginTop: 4, marginLeft: 18 },
  empty: { alignItems: "center", marginTop: 120 },
  emptyText: { color: "#555", fontSize: 18, fontWeight: "600" },
  emptyHint: { color: "#444", fontSize: 14, marginTop: 8 },
  addButton: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "#2563eb",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#141420",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#1e1e2e",
    borderRadius: 10,
    padding: 14,
    color: "#fff",
    fontSize: 16,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#1e1e2e",
    alignItems: "center",
  },
  cancelText: { color: "#888", fontSize: 16, fontWeight: "600" },
  saveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#2563eb",
    alignItems: "center",
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
