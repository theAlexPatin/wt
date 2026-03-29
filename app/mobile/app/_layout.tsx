import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Image, Text, StyleSheet } from "react-native";

const BG = "#0a0a0f";

export default function RootLayout() {
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
