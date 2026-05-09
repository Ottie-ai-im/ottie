import { useCallback, useMemo, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { ChevronRight } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isNative } from "@/constants/platform";

// Tap target on hover lifts subtly + chevron slides 2px right. Hover is a
// no-op on native (RN Pressable's onHoverIn does not fire on iOS), so on
// native we render the resting state always.

interface CtaCardProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  subtitle: string;
  emphasis?: "primary" | "secondary";
  testID?: string;
  onPress: () => void;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  rootHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  iconBlock: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  iconBlockPrimary: {
    backgroundColor: theme.colors.foreground,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.2,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  chevron: {
    marginLeft: theme.spacing[2],
  },
}));

export function CtaCard({
  icon: Icon,
  title,
  subtitle,
  emphasis = "secondary",
  testID,
  onPress,
}: CtaCardProps) {
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const liftY = useSharedValue(0);
  const chevronX = useSharedValue(0);

  const handleHoverIn = useCallback(() => {
    setHovered(true);
    liftY.value = withSpring(-1, { damping: 22, stiffness: 280 });
    chevronX.value = withSpring(2, { damping: 22, stiffness: 280 });
  }, [chevronX, liftY]);

  const handleHoverOut = useCallback(() => {
    setHovered(false);
    liftY.value = withSpring(0, { damping: 22, stiffness: 280 });
    chevronX.value = withSpring(0, { damping: 22, stiffness: 280 });
  }, [chevronX, liftY]);

  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: liftY.value }],
  }));

  const chevronTransformStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: chevronX.value }],
  }));

  const isPrimary = emphasis === "primary";
  const showHover = hovered && !isNative;

  const containerStyle = useMemo(
    () => [styles.root, showHover ? styles.rootHovered : null],
    [showHover],
  );
  const iconStyle = useMemo(
    () => [styles.iconBlock, isPrimary ? styles.iconBlockPrimary : null],
    [isPrimary],
  );
  const chevronWrapStyle = useMemo(
    () => [styles.chevron, chevronTransformStyle],
    [chevronTransformStyle],
  );
  const iconColor = isPrimary ? theme.colors.accentForeground : theme.colors.foreground;
  const chevronColor = showHover ? theme.colors.foreground : theme.colors.foregroundMuted;

  return (
    <Animated.View style={liftStyle}>
      <Pressable
        accessibilityRole="button"
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        onPress={onPress}
        style={containerStyle}
        testID={testID}
      >
        <View style={iconStyle}>
          <Icon size={20} color={iconColor} />
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Animated.View style={chevronWrapStyle}>
          <ChevronRight size={18} color={chevronColor} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
