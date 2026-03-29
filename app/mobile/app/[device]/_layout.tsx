import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { useStore } from "../../lib/store";

export default function DeviceLayout() {
  const { device } = useLocalSearchParams<{ device: string }>();
  const router = useRouter();
  const devices = useStore((s) => s.devices);
  const current = devices.find((d) => d.id === device);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0f" },
        headerTintColor: "#fff",
        contentStyle: { backgroundColor: "#0a0a0f" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: current?.name ?? "Sessions",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ marginLeft: -8 }}>
              <Text style={{ color: "#fff", fontSize: 17 }}>{"‹ Devices"}</Text>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="terminal"
        options={{
          title: "Terminal",
          headerBackVisible: false,
          animation: "default",
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
