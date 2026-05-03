import { useMemo, useCallback } from "react";
import { View, Text, StyleSheet as RNStyleSheet, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useDraggable } from "@dnd-kit/core";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { getProviderIcon } from "@/components/provider-icons";
import { isWeb } from "@/constants/platform";

export interface SidebarProvidersPanelProps {
  serverId: string;
}

export function SidebarProvidersPanel({ serverId }: SidebarProvidersPanelProps) {
  const { entries } = useProvidersSnapshot(serverId);
  const providerDefinitions = buildProviderDefinitions(entries);

  // Filter only ready providers
  const availableProviders = useMemo(() => {
    return providerDefinitions.filter((def) => {
      const entry = entries?.find((e) => e.provider === def.id);
      return entry?.status === "ready";
    });
  }, [providerDefinitions, entries]);

  const { theme } = useUnistyles();

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>AI</Text>
      <View style={styles.list}>
        {availableProviders.map((def) => (
          <DraggableProviderIcon key={def.id} providerId={def.id} label={def.label} />
        ))}
      </View>
    </View>
  );
}

function DraggableProviderIcon({ providerId, label }: { providerId: string; label: string }) {
  const { theme } = useUnistyles();
  const ProviderIcon = getProviderIcon(providerId);

  // We use dnd-kit's useDraggable for web. On native, this is a no-op currently.
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `provider-${providerId}`,
    data: {
      type: "provider",
      providerId,
    },
  });

  const style = useMemo(
    () => [
      styles.iconWrapper,
      isDragging && styles.iconWrapperDragging,
      transform && isWeb
        ? {
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          }
        : undefined,
    ],
    [isDragging, transform],
  );

  const wrapperProps = isWeb
    ? {
        ref: setNodeRef,
        ...listeners,
        ...attributes,
      }
    : {};

  return (
    <View {...wrapperProps} style={style}>
      <ProviderIcon size={20} color={theme.colors.foreground} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 60,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    paddingTop: theme.spacing[4],
  },
  headerTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[4],
  },
  list: {
    gap: theme.spacing[3],
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    cursor: "grab",
  },
  iconWrapperDragging: {
    opacity: 0.8,
    cursor: "grabbing",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    backgroundColor: theme.colors.surface2,
  },
}));
