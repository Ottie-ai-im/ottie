import { useState } from "react";
import { Text, View, ScrollView, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Blocks, Download, CheckCircle2 } from "lucide-react-native";

import { MobileTabHeader } from "@/components/headers/mobile-tab-header";

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  author: string;
}

const MOCK_PLUGINS: PluginInfo[] = [
  {
    id: "codeisland",
    name: "CodeIsland Notch Integration",
    description:
      "A real-time macOS Dynamic Island panel for your AI coding agents. See tool calls and stream status without switching windows.",
    author: "wxtsky",
  },
  {
    id: "github-sync",
    name: "GitHub PR Sync",
    description:
      "Automatically opens pull requests and syncs agent task summaries to GitHub issues.",
    author: "ottie-core",
  },
];

export function CommunityScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  // Mock installation state
  const [installed, setInstalled] = useState<Record<string, boolean>>({
    codeisland: true, // Pre-installed via our seed script
  });

  const toggleInstall = (id: string) => {
    setInstalled((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <View style={styles.container}>
      <MobileTabHeader title="Extensions" testID="community-header" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Blocks size={32} color={theme.colors.foreground} />
          <Text style={styles.title}>Plugin Store</Text>
          <Text style={styles.body}>
            Discover and install community extensions to power up your daemon.
          </Text>
        </View>

        <View style={styles.list}>
          {MOCK_PLUGINS.map((plugin) => {
            const isInstalled = installed[plugin.id];
            return (
              <View key={plugin.id} style={styles.pluginCard}>
                <View style={styles.pluginHeader}>
                  <View style={styles.pluginInfo}>
                    <Text style={styles.pluginName}>{plugin.name}</Text>
                    <Text style={styles.pluginAuthor}>by {plugin.author}</Text>
                  </View>
                  <Pressable
                    style={[styles.installButton, isInstalled && styles.installedButton]}
                    onPress={() => toggleInstall(plugin.id)}
                  >
                    {isInstalled ? (
                      <>
                        <CheckCircle2 size={14} color={theme.colors.palette.green[500]} />
                        <Text style={styles.installedText}>Installed</Text>
                      </>
                    ) : (
                      <>
                        <Download size={14} color={theme.colors.foreground} />
                        <Text style={styles.installText}>Install</Text>
                      </>
                    )}
                  </Pressable>
                </View>
                <Text style={styles.pluginDesc}>{plugin.description}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[12],
  },
  header: {
    alignItems: "center",
    marginBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  title: {
    fontFamily: theme.fontFamily.rounded,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.4,
  },
  body: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  list: {
    gap: theme.spacing[4],
  },
  pluginCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pluginHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing[3],
  },
  pluginInfo: {
    flex: 1,
    marginRight: theme.spacing[4],
  },
  pluginName: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: 2,
  },
  pluginAuthor: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  pluginDesc: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  installButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.md,
  },
  installedButton: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.borderGlass,
  },
  installText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  installedText: {
    fontFamily: theme.fontFamily.system,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.palette.green[500],
  },
}));
