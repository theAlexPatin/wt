import { useEffect, useRef } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Image, Text, StyleSheet, AppState } from "react-native";
import { useStore } from "../lib/store";
import { registerPushToken } from "../lib/api";

const BG = "#0a0a0f";
const EAS_PROJECT_ID = "b6d031cb-f40d-48cf-8bad-dc2645b6bfbb";

let Notifications: typeof import("expo-notifications") | null = null;
try {
  Notifications = require("expo-notifications");
} catch {}

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function getPushToken(): Promise<string | null> {
  if (!Notifications) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: EAS_PROJECT_ID,
  });
  return token.data;
}

async function registerWithAllDevices(token: string) {
  const devices = useStore.getState().devices;
  await Promise.allSettled(
    devices.map((device) => registerPushToken(device, token, device.id))
  );
}

function handleNotificationResponse(response: any) {
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
}

export default function RootLayout() {
  const setPushToken = useStore((s) => s.setPushToken);
  const responseListener = useRef<any>(null);

  useEffect(() => {
    if (!Notifications) return;

    getPushToken().then((token) => {
      if (token) {
        setPushToken(token);
        registerWithAllDevices(token);
      }
    });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse
      );

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        const token = useStore.getState().pushToken;
        if (token) registerWithAllDevices(token);
      }
    });

    return () => {
      responseListener.current?.remove();
      subscription.remove();
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
  headerTitleText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
