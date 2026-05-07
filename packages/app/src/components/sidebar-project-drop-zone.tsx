import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { Plus } from "lucide-react-native";
import { isWeb } from "@/constants/platform";

export function SidebarProjectDropZone({
  projectKey,
  serverId,
  workspaceId,
  projectRootPath,
  projectName,
}: {
  projectKey: string;
  serverId: string;
  workspaceId: string | undefined;
  projectRootPath: string;
  projectName: string;
}) {
  const { theme } = useUnistyles();

  const { active } = useDndContext();
  const isDraggingProvider = active?.data.current?.type === "provider";

  const { setNodeRef, isOver } = useDroppable({
    id: `project-new-task-${projectKey}`,
    data: {
      type: "project-new-task",
      projectKey,
      serverId,
      workspaceId,
      projectRootPath,
      projectName,
    },
  });

  const style = useMemo(() => [styles.container, isOver && styles.containerOver], [isOver]);

  if (!isDraggingProvider || !isWeb) return null;

  return (
    // dnd-kit setNodeRef vs RN View ref shape mismatch (same as
    // sidebar-workspace-list.tsx).
    // eslint-disable-next-line typescript-eslint/no-explicit-any
    <View ref={setNodeRef as any} style={style}>
      <Plus
        size={16}
        color={isOver ? theme.colors.palette.blue[500] : theme.colors.foregroundMuted}
      />
      <Text style={[styles.text, isOver && styles.textOver]}>
        Drop AI here to create a new task
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: 40,
    marginHorizontal: theme.spacing[2],
    marginVertical: theme.spacing[1],
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.surface3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    backgroundColor: "transparent",
  },
  containerOver: {
    borderColor: theme.colors.palette.blue[500],
    backgroundColor: theme.colors.palette.blue[500] + "1A", // 10% opacity
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  textOver: {
    color: theme.colors.palette.blue[500],
  },
}));
