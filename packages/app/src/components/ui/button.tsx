import {
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { Pressable, Text, View } from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

type LeftIcon =
  | ReactElement
  | ComponentType<{ color: string; size: number }>
  | ((color: string) => ReactElement)
  | null;

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 20 };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create((theme) => ({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.button,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "transparent",
  },
  md: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    minHeight: 32,
  },
  sm: {
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.button - 2,
    minHeight: 26,
  },
  lg: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    borderRadius: theme.borderRadius.button + 2,
    minHeight: 40,
  },
  default: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  defaultHovered: {
    backgroundColor: theme.colors.accentBright,
    borderColor: theme.colors.accentBright,
  },
  secondary: {
    backgroundColor: theme.colors.surfaceGlass,
    borderColor: theme.colors.borderGlass,
  },
  secondaryHovered: {
    backgroundColor: theme.colors.surfaceGlassHover,
    borderColor: theme.colors.borderGlass,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: theme.colors.borderAccent,
  },
  outlineHovered: {
    backgroundColor: theme.colors.surfaceGlass,
    borderColor: theme.colors.borderGlass,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  ghostHovered: {
    backgroundColor: theme.colors.surfaceGlass,
    borderColor: "transparent",
  },
  destructive: {
    backgroundColor: theme.colors.destructive,
    borderColor: theme.colors.destructive,
  },
  destructiveHovered: {
    backgroundColor: theme.colors.destructive,
    borderColor: theme.colors.destructive,
    opacity: 0.92,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  text: {
    fontFamily: theme.fontFamily.system,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: -0.1,
  },
  textDefault: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.semibold,
  },
  textDestructive: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.semibold,
  },
  textGhost: {
    color: theme.colors.foregroundMuted,
  },
  textGhostHovered: {
    color: theme.colors.foreground,
  },
}));

export function Button({
  children,
  variant = "secondary",
  size = "md",
  leftIcon,
  style,
  textStyle,
  disabled,
  accessibilityRole,
  ...props
}: PropsWithChildren<
  Omit<PressableProps, "style"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: LeftIcon;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
  }
>) {
  const [hovered, setHovered] = useState(false);
  const { theme } = useUnistyles();
  const pressScale = useSharedValue(1);

  let variantStyle: ViewStyle;
  let variantHoverStyle: ViewStyle;
  if (variant === "default") {
    variantStyle = styles.default;
    variantHoverStyle = styles.defaultHovered;
  } else if (variant === "secondary") {
    variantStyle = styles.secondary;
    variantHoverStyle = styles.secondaryHovered;
  } else if (variant === "outline") {
    variantStyle = styles.outline;
    variantHoverStyle = styles.outlineHovered;
  } else if (variant === "ghost") {
    variantStyle = styles.ghost;
    variantHoverStyle = styles.ghostHovered;
  } else {
    variantStyle = styles.destructive;
    variantHoverStyle = styles.destructiveHovered;
  }

  let sizeStyle: ViewStyle;
  if (size === "sm") {
    sizeStyle = styles.sm;
  } else if (size === "lg") {
    sizeStyle = styles.lg;
  } else {
    sizeStyle = styles.md;
  }
  const isGhostHovered = hovered && variant === "ghost";

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const handlePressIn = useCallback(() => {
    pressScale.value = withSpring(0.96, theme.motion.spring.snappy);
  }, [pressScale, theme.motion.spring.snappy]);
  const handlePressOut = useCallback(() => {
    pressScale.value = withSpring(1, theme.motion.spring.snappy);
  }, [pressScale, theme.motion.spring.snappy]);

  const animatedPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const pressableStyle = useCallback(
    (_state: PressableStateCallbackType): StyleProp<ViewStyle> => [
      styles.base,
      sizeStyle,
      variantStyle,
      hovered ? variantHoverStyle : null,
      disabled ? styles.disabled : null,
      style,
    ],
    [sizeStyle, variantStyle, variantHoverStyle, hovered, disabled, style],
  );

  const resolvedTextStyle = useMemo(
    () => [
      styles.text,
      variant === "default" ? styles.textDefault : null,
      variant === "destructive" ? styles.textDestructive : null,
      variant === "ghost" ? styles.textGhost : null,
      textStyle,
      isGhostHovered ? styles.textGhostHovered : null,
    ],
    [variant, textStyle, isGhostHovered],
  );

  function renderIcon() {
    if (!leftIcon) return null;

    if (typeof leftIcon === "object" && "type" in leftIcon) {
      return <View>{leftIcon}</View>;
    }

    let color: string;
    if (variant === "default") {
      color = theme.colors.accentForeground;
    } else if (variant === "ghost") {
      color = isGhostHovered ? theme.colors.foreground : theme.colors.foregroundMuted;
    } else {
      color = theme.colors.foreground;
    }
    const iconSize = ICON_SIZE[size];

    if (
      typeof leftIcon === "function" &&
      !leftIcon.prototype?.isReactComponent &&
      leftIcon.length > 0
    ) {
      return <View>{(leftIcon as (color: string) => ReactElement)(color)}</View>;
    }

    const Icon = leftIcon as ComponentType<{ color: string; size: number }>;
    return (
      <View>
        <Icon color={color} size={iconSize} />
      </View>
    );
  }

  return (
    <AnimatedPressable
      {...props}
      accessibilityRole={accessibilityRole ?? "button"}
      disabled={disabled}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[pressableStyle, animatedPressStyle]}
    >
      {renderIcon()}
      {children != null ? <Text style={resolvedTextStyle}>{children}</Text> : null}
    </AnimatedPressable>
  );
}
