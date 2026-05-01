import { Command } from "cmdk";
import { Modal, Pressable, Text, View } from "react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";
import { useCommandCenter, type CommandCenterItem } from "@/hooks/use-command-center";
import { isWeb } from "@/constants/platform";

/**
 * Web (and Tauri) command-center palette — backed by `cmdk`.
 *
 * Replaces the prior hand-rolled keyboard/filter implementation in
 * `command-center.tsx` with cmdk's primitives so the palette behaves like
 * every other developer-tool palette (VS Code, Linear, Raycast). Wrapped in
 * `<GlassSurface radius="sheet">` per Phase 02 PATTERNS so the macOS 26
 * vibrancy treatment is consistent with the bottom-sheet variant on native.
 *
 * Native variant: see `command-center.native.tsx` (bottom sheet).
 */
export function CommandCenter() {
  const { theme } = useUnistyles();
  const { open, query, setQuery, items, handleClose, handleSelectItem } = useCommandCenter();

  // Focus cmdk's internal input when the modal mounts. cmdk has its own
  // focus handling once visible, but we defer one tick to let the Modal
  // mount in the React tree first.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const inputContainerStyle = useMemo(
    () => [styles.inputContainer, { borderBottomColor: theme.colors.borderGlass }],
    [theme.colors.borderGlass],
  );
  const sectionLabelStyle = useMemo(
    () => [styles.sectionLabel, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const inputStyle = useMemo<React.CSSProperties>(
    () => ({
      width: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      color: theme.colors.foreground as string,
      fontSize: 16,
      padding: "12px 0",
    }),
    [theme.colors.foreground],
  );
  const listStyle = useMemo<React.CSSProperties>(
    () => ({
      maxHeight: 360,
      overflowY: "auto",
      padding: 8,
    }),
    [],
  );
  const itemBaseStyle = useMemo<React.CSSProperties>(
    () => ({
      padding: "8px 12px",
      borderRadius: 8,
      cursor: "pointer",
      color: theme.colors.foreground as string,
    }),
    [theme.colors.foreground],
  );

  // Belt-and-braces: native should never resolve this file via Metro, but
  // if it does (vitest in node mode aliases react-native → react-native-web),
  // we still no-op outside web rather than try to mount cmdk on native.
  // This conditional return stays AFTER all hook calls so the hook order is
  // stable per `eslint-plugin-react-hooks`.
  if (!isWeb || !open) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} accessibilityLabel="Close" />
        <GlassSurface radius="sheet" strong testID="command-center-panel" style={styles.panel}>
          <Command label="Command Center" shouldFilter={false}>
            <View style={inputContainerStyle}>
              {/*
                cmdk renders a real <input>, so we drop into the DOM here.
                react-native-web's TextInput would re-implement what cmdk
                already does for focus / keyboard navigation, breaking
                cmdk's keymap.
              */}
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder="Type a command or search agents…"
                data-testid="command-center-input"
                style={inputStyle}
              />
            </View>

            <Command.List style={listStyle}>
              {items.length === 0 ? (
                <Command.Empty>
                  <Text style={sectionLabelStyle}>No matches</Text>
                </Command.Empty>
              ) : (
                items.map((item) => (
                  <CommandCenterItemRow
                    key={itemKey(item)}
                    item={item}
                    onSelect={handleSelectItem}
                    rowStyle={itemBaseStyle}
                  />
                ))
              )}
            </Command.List>
          </Command>
        </GlassSurface>
      </View>
    </Modal>
  );
}

function itemKey(item: CommandCenterItem): string {
  return item.kind === "action"
    ? `action:${item.action.id}`
    : `agent:${item.agent.serverId}:${item.agent.id}`;
}

function CommandCenterItemRow({
  item,
  onSelect,
  rowStyle,
}: {
  item: CommandCenterItem;
  onSelect: (item: CommandCenterItem) => void;
  rowStyle: React.CSSProperties;
}) {
  const label = item.kind === "action" ? item.action.title : item.agent.title || "New agent";
  const handleSelect = useCallback(() => onSelect(item), [item, onSelect]);
  return (
    <Command.Item value={`${item.kind}:${label}`} onSelect={handleSelect} style={rowStyle}>
      {label}
    </Command.Item>
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
    overflow: "hidden",
  } as object,
  inputContainer: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
  },
  sectionLabel: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
}));
