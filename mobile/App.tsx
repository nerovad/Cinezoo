import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setStorageAdapter,
  setApiBaseUrl,
} from "@cinezoo/shared";
import type { ChatMessage, User } from "@cinezoo/shared";

// Configure shared package for mobile platform
setStorageAdapter({
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
});

// Point API client at the backend (adjust for your dev machine IP)
setApiBaseUrl("http://localhost:4000");

// Verify shared types compile
const _typeCheck: ChatMessage = { user: "test", content: "hello" };
const _userCheck: User = { id: 1, username: "test", email: "test@test.com" };
void _typeCheck;
void _userCheck;

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cinezoo Mobile</Text>
      <Text style={styles.subtitle}>Shared package connected</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#e0e0e0",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
  },
});
