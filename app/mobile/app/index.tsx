import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter, useFocusEffect } from "expo-router";
import { useStore } from "../lib/store";
import { checkHealth } from "../lib/api";
import type { Device } from "../lib/types";

const ACTION_WIDTH = 72;

function SwipeableCard({
  device,
  online,
  onPress,
  onDelete,
}: {
  device: Device;
  online: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -ACTION_WIDTH : 0;
        const next = Math.min(0, Math.max(-ACTION_WIDTH, base + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = isOpen.current ? -ACTION_WIDTH : 0;
        const final = base + g.dx;
        const shouldOpen = final < -ACTION_WIDTH / 2 || g.vx < -0.3;
        const target = shouldOpen ? -ACTION_WIDTH : 0;
        isOpen.current = shouldOpen;
        Animated.spring(translateX, {
          toValue: target,
          useNativeDriver: true,
          bounciness: 0,
          speed: 20,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.actionsRow}>
        <Pressable
          style={styles.deleteAction}
          onPress={() => {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              speed: 20,
              bounciness: 0,
            }).start();
            isOpen.current = false;
            onDelete();
          }}
        >
          <Text style={styles.deleteActionText}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[styles.card, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable onPress={onPress}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.dot,
                online ? styles.dotOnline : styles.dotOffline,
              ]}
            />
            <Text
              style={[styles.cardTitle, !online && styles.cardTitleOffline]}
            >
              {device.name}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function DeviceListScreen() {
  const router = useRouter();
  const { devices, addDevice, removeDevice } = useStore();
  const [healthMap, setHealthMap] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const refreshHealth = useCallback(async () => {
    const results: Record<string, boolean> = {};
    await Promise.all(
      devices.map(async (d) => {
        try {
          const h = await checkHealth(d);
          results[d.id] = h.ok;
        } catch {
          results[d.id] = false;
        }
      })
    );
    setHealthMap(results);
  }, [devices]);

  useFocusEffect(
    useCallback(() => {
      refreshHealth();
    }, [refreshHealth])
  );

  const handleScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setScanning(true);
  };

  const handleBarcode = ({ data }: { data: string }) => {
    setScanning(false);
    try {
      const parsed = JSON.parse(data);
      if (parsed.host) {
        addDevice({
          name: parsed.name || parsed.host,
          host: parsed.host,
          port: parsed.port || 7890,
        });
      }
    } catch {
      // Not valid JSON, ignore
    }
  };

  if (scanning) {
    return (
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleBarcode}
        />
        <Pressable
          style={styles.cancelScan}
          onPress={() => setScanning(false)}
        >
          <Text style={styles.cancelScanText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const renderDevice = ({ item }: { item: Device }) => (
    <SwipeableCard
      device={item}
      online={healthMap[item.id]}
      onPress={() => router.push(`/${item.id}`)}
      onDelete={() => removeDevice(item.id)}
    />
  );

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
              Run <Text style={styles.code}>wt connect</Text> on a machine
              and scan the QR code
            </Text>
          </View>
        }
      />
      <Pressable style={styles.addButton} onPress={handleScan}>
        <Text style={styles.addButtonText}>Scan QR Code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 80 },

  // Swipeable
  swipeContainer: {
    marginBottom: 12,
    borderRadius: 14,
    overflow: "hidden",
  },
  actionsRow: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteAction: {
    flex: 1,
    height: "100%",
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
  },
  deleteActionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // Card
  card: {
    backgroundColor: "#141420",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e1e2e",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOnline: { backgroundColor: "#34d399" },
  dotOffline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#555",
  },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  cardTitleOffline: { color: "#666" },

  // Empty
  empty: { alignItems: "center", marginTop: 120 },
  emptyText: { color: "#555", fontSize: 18, fontWeight: "600" },
  emptyHint: {
    color: "#444",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  code: { color: "#888", fontFamily: "monospace" },

  // Add button
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

  // Camera
  camera: { flex: 1 },
  cancelScan: {
    position: "absolute",
    bottom: 60,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  cancelScanText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
