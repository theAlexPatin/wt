import { useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  View,
  Text,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";

const ACTION_WIDTH = 72;

export interface SwipeableRowRef {
  close: () => void;
}

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  onRename: () => void;
  enabled?: boolean;
}

export const SwipeableRow = forwardRef<SwipeableRowRef, Props>(
  function SwipeableRow({ children, onDelete, onRename, enabled = true }, ref) {
    const translateX = useRef(new Animated.Value(0)).current;
    const isOpenRef = useRef(false);
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const close = useCallback(() => {
      isOpenRef.current = false;
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 0,
      }).start();
    }, [translateX]);

    useImperativeHandle(ref, () => ({ close }), [close]);

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gs) => {
          if (!enabledRef.current) return false;
          return Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gs) => {
          const base = isOpenRef.current ? -(ACTION_WIDTH * 2) : 0;
          const x = Math.min(0, Math.max(-(ACTION_WIDTH * 2), base + gs.dx));
          translateX.setValue(x);
        },
        onPanResponderRelease: (_, gs) => {
          const shouldOpen = gs.dx < 0 ? true : gs.dx > 0 ? false : isOpenRef.current;
          const target = shouldOpen ? -(ACTION_WIDTH * 2) : 0;
          isOpenRef.current = shouldOpen;
          if (shouldOpen) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          Animated.spring(translateX, {
            toValue: target,
            useNativeDriver: true,
            speed: 20,
            bounciness: 0,
          }).start();
        },
        onPanResponderTerminate: () => {
          const target = isOpenRef.current ? -(ACTION_WIDTH * 2) : 0;
          Animated.spring(translateX, {
            toValue: target,
            useNativeDriver: true,
            speed: 20,
            bounciness: 0,
          }).start();
        },
      })
    ).current;

    return (
      <View style={styles.container}>
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.renameAction}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              close();
              onRename();
            }}
          >
            <Text style={styles.actionIcon}>{"✎"}</Text>
            <Text style={styles.actionLabel}>Rename</Text>
          </Pressable>
          <Pressable
            style={styles.deleteAction}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              close();
              onDelete();
            }}
          >
            <Text style={styles.actionIcon}>{"✕"}</Text>
            <Text style={styles.actionLabel}>Kill</Text>
          </Pressable>
        </View>
        <Animated.View
          style={[styles.content, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          {children}
        </Animated.View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 10,
  },
  actionsRow: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH * 2,
    flexDirection: "row",
  },
  renameAction: {
    flex: 1,
    backgroundColor: "#444",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  deleteAction: {
    flex: 1,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  actionIcon: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  actionLabel: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "500",
  },
  content: {
    backgroundColor: "#0a0a0f",
  },
});
