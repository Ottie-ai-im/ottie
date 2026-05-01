import { useMemo, type ReactNode } from "react";
import { Platform, View } from "react-native";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import { BlurView, type BlurTint } from "expo-blur";
import { useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

type GlassRadius = "none" | "card" | "sheet" | "pill" | "button";

export interface GlassSurfaceProps extends Omit<ViewProps, "style"> {
  children?: ReactNode;
  intensity?: number;
  tint?: BlurTint;
  radius?: GlassRadius;
  bordered?: boolean;
  strong?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Liquid-glass surface. iOS uses NSVisualEffectView; Android uses native
 * blur on 12+ via expo-blur's `dimezisBlurView`; web uses CSS
 * `backdrop-filter`. Falls back to a translucent fill on devices without
 * GPU blur so the look stays consistent.
 */
export function GlassSurface({
  children,
  intensity = 50,
  tint,
  radius = "card",
  bordered = true,
  strong = false,
  style,
  ...rest
}: GlassSurfaceProps) {
  const { theme } = useUnistyles();
  const isDark = theme.colorScheme === "dark";

  const radiusValue = useMemo(() => {
    if (radius === "none") return undefined;
    if (radius === "pill") return theme.components.glassPill.radius;
    if (radius === "sheet") return theme.components.glassSheet.radius;
    if (radius === "button") return theme.components.button.radius;
    return theme.components.glassCard.radius;
  }, [radius, theme.components]);

  const baseStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: strong ? theme.surface.glass.tintStrong : theme.surface.glass.tint,
      borderRadius: radiusValue,
      borderCurve: "continuous",
      borderWidth: bordered ? 1 : 0,
      borderColor: bordered ? theme.surface.glass.border : "transparent",
      overflow: "hidden",
    }),
    [strong, theme.surface.glass, bordered, radiusValue],
  );

  const webStyle = useMemo<ViewStyle | null>(() => {
    if (!isWeb) return null;
    const webBlur = strong ? "blur(40px) saturate(180%)" : "blur(28px) saturate(160%)";
    return [
      baseStyle,
      { backdropFilter: webBlur, WebkitBackdropFilter: webBlur } as unknown as ViewStyle,
      style,
    ] as unknown as ViewStyle;
  }, [baseStyle, strong, style]);

  const nativeStyle = useMemo<ViewStyle | null>(() => {
    if (isWeb) return null;
    return [baseStyle, style] as unknown as ViewStyle;
  }, [baseStyle, style]);

  if (isWeb) {
    return (
      <View {...rest} style={webStyle}>
        {children}
      </View>
    );
  }

  let resolvedTint: BlurTint;
  if (tint) {
    resolvedTint = tint;
  } else if (strong) {
    resolvedTint = isDark ? "systemThickMaterialDark" : "systemThickMaterialLight";
  } else {
    resolvedTint = isDark ? "systemMaterialDark" : "systemMaterialLight";
  }

  const experimentalBlurMethod = Platform.OS === "android" ? "dimezisBlurView" : undefined;

  return (
    <BlurView
      {...rest}
      tint={resolvedTint}
      intensity={intensity}
      experimentalBlurMethod={experimentalBlurMethod}
      style={nativeStyle}
    >
      {children}
    </BlurView>
  );
}
