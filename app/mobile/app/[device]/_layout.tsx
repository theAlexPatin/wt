import { Stack, useLocalSearchParams } from "expo-router";
import { useStore } from "../../lib/store";

export default function DeviceLayout() {
  const { device } = useLocalSearchParams<{ device: string }>();
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
        options={{ title: current?.name ?? "Sessions" }}
      />
      <Stack.Screen
        name="terminal"
        options={{
          headerShown: false,
          animation: "slide_from_bottom",
        }}
      />
    </Stack>
  );
}
