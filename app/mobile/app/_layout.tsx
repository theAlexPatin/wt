import { useEffect, useRef, useState } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Image, Text, StyleSheet, AppState } from "react-native";
import { useStore } from "../lib/store";
import { registerPushToken } from "../lib/api";

const BG = "#0a0a0f";
const EAS_PROJECT_ID = "a671143b-7d4c-4f99-ab53-b24634e0c7e1";

async function setupNotifications() {
  try {
    const Notifications = await import("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const { status: existing } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
    return { Notifications, token: tokenResult.data };
  } catch {
    return null;
  }
}

function handleNotificationResponse(response: any) {
  try {
    const data = response.notification.request.content.data;
    if (data?.sessionId && data?.deviceId) {
      router.push({
        pathname: "/[device]/terminal",
        params: {
          device: data.deviceId as string,
          sessionId: data.sessionId as string,
          sessionIndex: "0",
          paneIndex: String(data.paneIndex ?? 0),
        },
      });
    }
  } catch {}
}

async function registerWithAllDevices(token: string) {
  try {
    const devices = useStore.getState().devices;
    await Promise.allSettled(
      devices.map((device) => registerPushToken(device, token, device.id))
    );
  } catch {}
}

export default function RootLayout() {
  const setPushToken = useStore((s) => s.setPushToken);

  useEffect(() => {
    let responseListener: any = null;
    let appStateSubscription: any = null;

    setupNotifications().then((result) => {
      if (!result) return;
      const { Notifications, token } = result;

      setPushToken(token);
      registerWithAllDevices(token);

      responseListener =
        Notifications.addNotificationResponseReceivedListener(
          handleNotificationResponse
        );

      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) handleNotificationResponse(response);
      });

      appStateSubscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          const savedToken = useStore.getState().pushToken;
          if (savedToken) registerWithAllDevices(savedToken);
        }
      });
    });

    return () => {
      responseListener?.remove();
      appStateSubscription?.remove();
    };
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: BG },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: BG },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerTitle: () => (
              <View style={styles.headerTitleRow}>
                <Image
                  source={require("../assets/icon.png")}
                  style={styles.headerIcon}
                />
                <Text style={styles.headerTitleText}>Wit</Text>
              </View>
            ),
          }}
        />
        <Stack.Screen name="[device]" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIcon: { width: 24, height: 24 },
  headerTitleText: { color: "#D4900A", fontSize: 17, fontWeight: "600" },
});
