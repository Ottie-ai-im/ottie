import { useCallback, useMemo } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { BottomSheetScrollView, BottomSheetView } from "@gorhom/bottom-sheet";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { useCommandCenter, type CommandCenterItem } from "@/hooks/use-command-center";

/**
 * Native command-center — bottom sheet variant.
 *
 * Triggered by long-press on the active mobile-tab-bar tab (Plan 02a Task 2
 * Step 5). Mirrors the same `useCommandCenter()` items shape as the web
 * cmdk variant, so dispatching an action from either modality reaches the
 * same handler.
 *
 * Web variant: see `command-center.web.tsx` (cmdk palette).
 */
export function CommandCenter() {
  const { theme } = useUnistyles();
  const { open, query, setQuery, items, handleClose, handleSelectItem } = useCommandCenter();

  const onClose = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const { sheetRef, handleSheetChange } = useIsolatedBottomSheetVisibility({
    visible: open,
    onClose,
  });

  const snapPoints = useMemo(() => ["72%"], []);

  const inputStyle = useMemo(
    () => [styles.input, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const sectionLabelStyle = useMemo(
    () => [styles.sectionLabel, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const handleStyle = useMemo(
    () => ({ backgroundColor: theme.colors.surfaceGlassStrong }),
    [theme.colors.surfaceGlassStrong],
  );
  const indicatorStyle = useMemo(
    () => ({ backgroundColor: theme.colors.borderGlass }),
    [theme.colors.borderGlass],
  );

  return (
    <IsolatedBottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      handleStyle={handleStyle}
      handleIndicatorStyle={indicatorStyle}
      backgroundStyle={handleStyle}
    >
      <BottomSheetView style={styles.container} testID="command-center-panel">
        <View style={styles.inputRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Type a command or search agents…"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
            testID="command-center-input"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>
        <BottomSheetScrollView
          style={styles.results}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {items.length === 0 ? (
            <Text style={sectionLabelStyle}>No matches</Text>
          ) : (
            items.map((item) => (
              <CommandCenterItemRow key={itemKey(item)} item={item} onSelect={handleSelectItem} />
            ))
          )}
        </BottomSheetScrollView>
      </BottomSheetView>
    </IsolatedBottomSheetModal>
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
}: {
  item: CommandCenterItem;
  onSelect: (item: CommandCenterItem) => void;
}) {
  const { theme } = useUnistyles();
  const label = item.kind === "action" ? item.action.title : item.agent.title || "New agent";
  const handlePress = useCallback(() => onSelect(item), [item, onSelect]);
  const titleStyle = useMemo(
    () => [styles.itemLabel, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  return (
    <Pressable onPress={handlePress} style={styles.itemRow}>
      <Text style={titleStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  inputRow: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderGlass,
  },
  input: {
    fontSize: theme.fontSize.lg,
    paddingVertical: theme.spacing[2],
  },
  results: {
    flex: 1,
    paddingTop: theme.spacing[2],
  },
  sectionLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  itemRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
  },
  itemLabel: {
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
}));
