import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Check, ChevronDown, Folder, Monitor } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { shortenPath } from "@/utils/shorten-path";
import { useRecommendedProjectPaths } from "@/stores/session-store-hooks";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useOpenProject } from "@/hooks/use-open-project";
import { buildWorkingDirectorySuggestions } from "@/utils/working-directory-suggestions";
import { isNative } from "@/constants/platform";
import { useActiveServerId } from "@/hooks/use-active-server-id";
import type { HostProfile } from "@/types/host-connection";

interface PathRowProps {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
}

function PathRow({ path, active, onSelect }: PathRowProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    void onSelect(path);
  }, [onSelect, path]);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (Boolean(hovered) || pressed || active) && {
        backgroundColor: theme.colors.surface1,
      },
    ],
    [active, theme.colors.surface1],
  );
  const rowTextStyle = useMemo(
    () => [styles.rowText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  return (
    <Pressable style={pressableStyle} onPress={handlePress}>
      <View style={styles.rowContent}>
        <View style={styles.iconSlot}>
          <Folder size={16} strokeWidth={2.2} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={rowTextStyle} numberOfLines={1}>
          {shortenPath(path)}
        </Text>
      </View>
    </Pressable>
  );
}

interface DeviceRowProps {
  host: HostProfile;
  selected: boolean;
  onSelect: (serverId: string) => void;
}

function DeviceRow({ host, selected, onSelect }: DeviceRowProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(host.serverId);
  }, [host.serverId, onSelect]);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (Boolean(hovered) || pressed) && { backgroundColor: theme.colors.surface1 },
    ],
    [theme.colors.surface1],
  );
  const rowTextStyle = useMemo(
    () => [styles.rowText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  return (
    <Pressable style={pressableStyle} onPress={handlePress}>
      <View style={styles.rowContent}>
        <View style={styles.iconSlot}>
          <Monitor size={16} strokeWidth={2.2} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={rowTextStyle} numberOfLines={1}>
          {host.label}
        </Text>
        {selected ? (
          <View style={styles.checkSlot}>
            <Check size={16} strokeWidth={2.2} color={theme.colors.foreground} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ProjectPickerModal() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const activeServerId = useActiveServerId();
  const hosts = useHosts();

  const open = useKeyboardShortcutsStore((s) => s.projectPickerOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setProjectPickerOpen);

  // Local override so the user can switch the target device from inside
  // the modal without leaving the current route. Resets to the active host
  // each time the modal opens.
  const [overrideServerId, setOverrideServerId] = useState<string | null>(null);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const serverId = overrideServerId ?? activeServerId;

  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const recommendedPaths = useRecommendedProjectPaths(serverId);

  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const openProject = useOpenProject(serverId);

  const directorySuggestionsQuery = useQuery({
    queryKey: ["project-picker-directory-suggestions", serverId, query],
    queryFn: async () => {
      if (!client) return [];
      const result = await client.getDirectorySuggestions({
        query,
        includeDirectories: true,
        includeFiles: false,
        limit: 30,
      });
      return (
        result.entries?.flatMap((entry) => (entry.kind === "directory" ? [entry.path] : [])) ?? []
      );
    },
    enabled: Boolean(client) && isConnected && open && !showDevicePicker,
    staleTime: 15_000,
    retry: false,
  });

  const options = useMemo(
    () =>
      buildWorkingDirectorySuggestions({
        recommendedPaths,
        serverPaths: directorySuggestionsQuery.data ?? [],
        query,
      }),
    [query, directorySuggestionsQuery.data, recommendedPaths],
  );

  const activeHost = useMemo(
    () => hosts.find((host) => host.serverId === serverId) ?? null,
    [hosts, serverId],
  );
  const hasMultipleHosts = hosts.length > 1;

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleSelectPath = useCallback(
    async (path: string) => {
      const trimmed = path.trim();
      if (!trimmed || !client || !serverId) return;

      setIsSubmitting(true);
      try {
        const didOpenProject = await openProject(trimmed);
        if (didOpenProject) {
          setOpen(false);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [client, openProject, serverId, setOpen],
  );

  const handleSubmitCustom = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    void handleSelectPath(trimmed);
  }, [handleSelectPath, query]);

  const handleChangeQuery = useCallback((text: string) => {
    setQuery(text);
    setActiveIndex(0);
  }, []);

  const handleToggleDevicePicker = useCallback(() => {
    if (!hasMultipleHosts) return;
    setShowDevicePicker((prev) => !prev);
  }, [hasMultipleHosts]);

  const handleSelectDevice = useCallback((nextServerId: string) => {
    setOverrideServerId(nextServerId);
    setShowDevicePicker(false);
    setQuery("");
    setActiveIndex(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setOverrideServerId(null);
      setShowDevicePicker(false);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Clamp active index
  useEffect(() => {
    if (!open) return;
    if (activeIndex >= options.length) {
      setActiveIndex(options.length > 0 ? options.length - 1 : 0);
    }
  }, [activeIndex, options.length, open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open || isNative) return;

    function handler(event: KeyboardEvent) {
      const key = event.key;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter" && key !== "Escape") return;

      if (key === "Escape") {
        event.preventDefault();
        if (showDevicePicker) {
          setShowDevicePicker(false);
          return;
        }
        setOpen(false);
        return;
      }

      if (showDevicePicker) return;

      if (key === "Enter") {
        event.preventDefault();
        if (options.length > 0 && activeIndex < options.length) {
          void handleSelectPath(options[activeIndex]!);
        } else if (query.trim()) {
          handleSubmitCustom();
        }
        return;
      }

      if (key === "ArrowDown" || key === "ArrowUp") {
        if (options.length === 0) return;
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = key === "ArrowDown" ? 1 : -1;
          const next = current + delta;
          if (next < 0) return options.length - 1;
          if (next >= options.length) return 0;
          return next;
        });
      }
    }

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeIndex,
    handleSelectPath,
    handleSubmitCustom,
    open,
    options,
    query,
    setOpen,
    showDevicePicker,
  ]);

  const panelStyle = useMemo(
    () => [
      styles.panel,
      {
        backgroundColor: theme.colors.surface0,
        borderColor: theme.colors.border,
      },
    ],
    [theme.colors.border, theme.colors.surface0],
  );
  const headerStyle = useMemo(
    () => [styles.header, { borderBottomColor: theme.colors.border }],
    [theme.colors.border],
  );
  const inputStyle = useMemo(
    () => [styles.input, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const emptyTextStyle = useMemo(
    () => [styles.emptyText, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const deviceBarTextStyle = useMemo(
    () => [styles.deviceBarText, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const deviceBarLabelStyle = useMemo(
    () => [styles.deviceBarLabel, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const deviceBarStyle = useMemo(
    () => [styles.deviceBar, { borderBottomColor: theme.colors.border }],
    [theme.colors.border],
  );

  if (!serverId) return null;

  const deviceLabel = activeHost?.label ?? serverId;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={panelStyle}>
          <Pressable
            onPress={handleToggleDevicePicker}
            disabled={!hasMultipleHosts}
            style={deviceBarStyle}
          >
            <View style={styles.iconSlot}>
              <Monitor size={14} strokeWidth={2.2} color={theme.colors.foregroundMuted} />
            </View>
            <Text style={deviceBarTextStyle} numberOfLines={1}>
              {t("projectPicker.addingOn")} <Text style={deviceBarLabelStyle}>{deviceLabel}</Text>
            </Text>
            {hasMultipleHosts ? (
              <View style={styles.deviceBarTrailing}>
                <Text style={deviceBarTextStyle}>{t("projectPicker.switchDevice")}</Text>
                <ChevronDown size={14} strokeWidth={2.2} color={theme.colors.foregroundMuted} />
              </View>
            ) : null}
          </Pressable>

          {showDevicePicker ? (
            <ScrollView
              style={styles.results}
              contentContainerStyle={styles.resultsContent}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              {hosts.map((host) => (
                <DeviceRow
                  key={host.serverId}
                  host={host}
                  selected={host.serverId === serverId}
                  onSelect={handleSelectDevice}
                />
              ))}
            </ScrollView>
          ) : (
            <>
              <View style={headerStyle}>
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={handleChangeQuery}
                  placeholder="Type a directory path..."
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={inputStyle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  editable={!isSubmitting}
                />
              </View>

              <ScrollView
                style={styles.results}
                contentContainerStyle={styles.resultsContent}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
              >
                {isSubmitting ? <Text style={emptyTextStyle}>Opening project...</Text> : null}
                {!isSubmitting && options.length === 0 && !query.trim() ? (
                  <Text style={emptyTextStyle}>Start typing a path</Text>
                ) : null}
                {!isSubmitting && !(options.length === 0 && !query.trim()) ? (
                  <>
                    {options.map((path, index) => (
                      <PathRow
                        key={path}
                        path={path}
                        active={index === activeIndex}
                        onSelect={handleSelectPath}
                      />
                    ))}
                  </>
                ) : null}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  panel: {
    width: 640,
    maxWidth: "92%",
    maxHeight: "80%",
    borderWidth: 1,
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    overflow: "hidden",
    ...theme.shadow.glassDeep,
  } as object,
  deviceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
  },
  deviceBarText: {
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  deviceBarLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  deviceBarTrailing: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
  },
  input: {
    fontSize: theme.fontSize.lg,
    paddingVertical: theme.spacing[1],
    outlineStyle: "none",
  } as object,
  results: {
    flexGrow: 0,
  },
  resultsContent: {
    paddingVertical: theme.spacing[2],
  },
  row: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  iconSlot: {
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  checkSlot: {
    marginLeft: "auto",
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    lineHeight: 20,
    flexShrink: 1,
  },
  emptyText: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    fontSize: theme.fontSize.base,
  },
}));
