import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Device, WorktreeInfo } from "./types";
import {
  fetchRepos,
  fetchWorktrees,
  createSessionInWorktree,
  createNewWorktree,
} from "./api";

type FlowStep =
  | { type: "pickRepo"; mode: "new" | "existing" }
  | { type: "pickWorktree"; mode: "existing"; repo: string }
  | { type: "enterName"; mode: "new"; repo: string }
  | { type: "creating" }
  | { type: "error"; message: string };

interface Props {
  device: Device;
  mode: "new" | "existing" | null;
  onDismiss: () => void;
  onCreated: (sessionName: string) => void;
}

export function CreateSessionFlow({ device, mode, onDismiss, onCreated }: Props) {
  const [step, setStep] = useState<FlowStep | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [nameText, setNameText] = useState("");
  const inputRef = useRef<TextInput>(null);

  // Initialize flow when mode changes
  useEffect(() => {
    if (mode) {
      setStep({ type: "pickRepo", mode });
      setLoading(true);
      fetchRepos(device)
        .then(setRepos)
        .catch(() => setRepos([]))
        .finally(() => setLoading(false));
    } else {
      setStep(null);
      setRepos([]);
      setWorktrees([]);
      setNameText("");
    }
  }, [mode, device]);

  const handlePickRepo = async (repo: string) => {
    Haptics.selectionAsync();
    if (step?.type !== "pickRepo") return;

    if (step.mode === "existing") {
      setStep({ type: "pickWorktree", mode: "existing", repo });
      setLoading(true);
      try {
        const wts = await fetchWorktrees(device, repo);
        setWorktrees(wts);
      } catch {
        setWorktrees([]);
      } finally {
        setLoading(false);
      }
    } else {
      setStep({ type: "enterName", mode: "new", repo });
      setNameText("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handlePickWorktree = async (wt: WorktreeInfo) => {
    Haptics.selectionAsync();
    if (step?.type !== "pickWorktree") return;
    setStep({ type: "creating" });
    try {
      const result = await createSessionInWorktree(device, step.repo, wt.name);
      onCreated(result.name);
    } catch (err: any) {
      setStep({ type: "error", message: err.message || "Failed to create session" });
    }
  };

  const handleCreateWorktree = async () => {
    if (step?.type !== "enterName" || !nameText.trim()) return;
    setStep({ type: "creating" });
    try {
      const result = await createNewWorktree(device, step.repo, nameText.trim());
      onCreated(result.name);
    } catch (err: any) {
      setStep({ type: "error", message: err.message || "Failed to create worktree" });
    }
  };

  const handleBack = () => {
    if (!step) return;
    if (step.type === "pickWorktree" || step.type === "enterName") {
      setStep({ type: "pickRepo", mode: step.mode });
    } else {
      onDismiss();
    }
  };

  if (!step) return null;

  const title =
    step.type === "pickRepo"
      ? "Select project"
      : step.type === "pickWorktree"
        ? `${(step as any).repo} worktrees`
        : step.type === "enterName"
          ? `New worktree in ${(step as any).repo}`
          : step.type === "creating"
            ? "Creating..."
            : "Error";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.overlay} onPress={onDismiss}>
          <Pressable style={styles.card} onPress={() => {}}>
            {/* Header */}
            <View style={styles.header}>
              {step.type !== "creating" && (
                <Pressable onPress={handleBack} hitSlop={12}>
                  <Text style={styles.backBtn}>
                    {step.type === "pickRepo" ? "Cancel" : "Back"}
                  </Text>
                </Pressable>
              )}
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <View style={{ width: 50 }} />
            </View>

            {/* Content */}
            {step.type === "creating" ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#D4900A" size="small" />
                <Text style={styles.loadingText}>Setting up...</Text>
              </View>
            ) : step.type === "error" ? (
              <View style={styles.errorWrap}>
                <Text style={styles.errorText}>{step.message}</Text>
                <Pressable style={styles.retryBtn} onPress={onDismiss}>
                  <Text style={styles.retryText}>Dismiss</Text>
                </Pressable>
              </View>
            ) : step.type === "pickRepo" ? (
              <ScrollView style={styles.listScroll} keyboardShouldPersistTaps="handled">
                {loading ? (
                  <ActivityIndicator color="#888" style={{ marginTop: 24 }} />
                ) : repos.length === 0 ? (
                  <Text style={styles.emptyText}>No projects found</Text>
                ) : (
                  repos.map((repo) => (
                    <Pressable
                      key={repo}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => handlePickRepo(repo)}
                    >
                      <Text style={styles.rowText}>{repo}</Text>
                      <Text style={styles.rowChevron}>{">"}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : step.type === "pickWorktree" ? (
              <ScrollView style={styles.listScroll} keyboardShouldPersistTaps="handled">
                {loading ? (
                  <ActivityIndicator color="#888" style={{ marginTop: 24 }} />
                ) : worktrees.length === 0 ? (
                  <Text style={styles.emptyText}>No worktrees found</Text>
                ) : (
                  worktrees.map((wt) => (
                    <Pressable
                      key={wt.name}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => handlePickWorktree(wt)}
                    >
                      <View style={styles.wtRow}>
                        {wt.tabColor && (
                          <View style={[styles.dot, { backgroundColor: wt.tabColor }]} />
                        )}
                        <Text style={[styles.rowText, wt.tabColor && { color: wt.tabColor }]}>
                          {wt.tabTitle}
                        </Text>
                      </View>
                      <Text style={styles.rowChevron}>{">"}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : step.type === "enterName" ? (
              <View style={styles.nameWrap}>
                <TextInput
                  ref={inputRef}
                  style={styles.nameInput}
                  value={nameText}
                  onChangeText={setNameText}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  selectionColor="#D4900A"
                  placeholderTextColor="#555"
                  placeholder="e.g. Fixing Auth Bug"
                  onSubmitEditing={handleCreateWorktree}
                />
                <Pressable
                  style={[styles.createBtn, !nameText.trim() && { opacity: 0.3 }]}
                  onPress={handleCreateWorktree}
                  disabled={!nameText.trim()}
                >
                  <Text style={styles.createBtnText}>Create</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  card: {
    backgroundColor: "#1a1a2a",
    borderRadius: 16,
    width: "100%",
    maxHeight: "70%",
    borderWidth: 1,
    borderColor: "#2a2a3a",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3a",
  },
  backBtn: {
    color: "#D4900A",
    fontSize: 15,
    fontWeight: "500",
    width: 50,
  },
  title: {
    color: "#e4e4e8",
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  listScroll: {
    maxHeight: 400,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e2e",
  },
  rowPressed: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rowText: {
    color: "#e4e4e8",
    fontSize: 16,
  },
  rowChevron: {
    color: "#444",
    fontSize: 16,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
  },
  wtRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  emptyText: {
    color: "#666",
    fontSize: 15,
    textAlign: "center",
    padding: 32,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  loadingText: {
    color: "#888",
    fontSize: 14,
  },
  errorWrap: {
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 14,
    textAlign: "center",
  },
  retryBtn: {
    padding: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  retryText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
  },
  nameWrap: {
    padding: 16,
    gap: 12,
  },
  nameInput: {
    backgroundColor: "#111118",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a3a",
    padding: 14,
    color: "#e4e4e8",
    fontSize: 16,
    fontFamily: Platform.OS === "ios" ? "SF Mono" : "monospace",
  },
  createBtn: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#D4900A",
    alignItems: "center",
  },
  createBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
