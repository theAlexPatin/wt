import { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const HINTS = [
  { icon: "↕", label: "Swipe up/down", desc: "Switch sessions" },
  { icon: "↔", label: "Swipe left/right", desc: "Switch panes" },
  { icon: "⇅", label: "Two-finger drag", desc: "Scroll history" },
  { icon: "◉", label: "Tap terminal", desc: "Toggle keyboard" },
];

export function GestureHelpButton({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 16 + bottomOffset }]}
        onPress={() => setVisible(true)}
        hitSlop={8}
      >
        <Text style={styles.fabText}>?</Text>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Terminal Gestures</Text>
            {HINTS.map((h) => (
              <View key={h.icon} style={styles.row}>
                <Text style={styles.icon}>{h.icon}</Text>
                <View style={styles.rowText}>
                  <Text style={styles.label}>{h.label}</Text>
                  <Text style={styles.desc}>{h.desc}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.dismiss}>Tap anywhere to dismiss</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#1a1a2a",
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 24,
    gap: 18,
    borderWidth: 1,
    borderColor: "#2a2a3a",
    width: "85%",
    maxWidth: 340,
  },
  cardTitle: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  icon: {
    color: "#888",
    fontSize: 22,
    width: 32,
    textAlign: "center",
  },
  rowText: {
    flex: 1,
  },
  label: {
    color: "#ddd",
    fontSize: 15,
    fontWeight: "500",
  },
  desc: {
    color: "#777",
    fontSize: 13,
    marginTop: 1,
  },
  dismiss: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
  },
});
