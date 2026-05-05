import { useUnistyles } from "react-native-unistyles";
import { useSessionStore } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { getProviderIcon, getProviderAccent } from "./provider-icons";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

export function SidebarWorkspaceAiProviderLogo({
  serverId,
  workspaceDirectory,
  hasRunningService,
}: {
  serverId: string;
  workspaceDirectory: string | undefined;
  hasRunningService: boolean;
}) {
  const { theme } = useUnistyles();
  const provider = useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session || !workspaceDirectory) return null;
    const normalizedDir = normalizeWorkspacePath(workspaceDirectory);
    for (const agent of session.agents?.values() ?? []) {
      if (normalizeWorkspacePath(agent.cwd) === normalizedDir) {
        return agent.provider;
      }
    }
    return null;
  });

  const ProviderIcon = provider ? getProviderIcon(provider) : null;
  const brandColor = provider
    ? getProviderAccent(provider).background
    : theme.colors.foregroundMuted;

  const spinStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          rotate: hasRunningService
            ? withRepeat(withTiming("360deg", { duration: 2000, easing: Easing.linear }), -1, false)
            : "0deg",
        },
      ],
    };
  }, [hasRunningService]);

  if (!ProviderIcon) {
    return null;
  }

  return (
    <Animated.View style={spinStyle}>
      <ProviderIcon
        width={12}
        height={12}
        color={hasRunningService ? brandColor : theme.colors.foregroundMuted}
      />
    </Animated.View>
  );
}
