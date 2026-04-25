import Svg, { Circle } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

interface OttieLogoProps {
  size?: number;
  color?: string;
}

export function OttieLogo({ size = 64, color }: OttieLogoProps) {
  const { theme } = useUnistyles();
  const fill = color ?? theme.colors.foreground;
  const strokeWidth = 7;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Circle cx={50} cy={50} r={42} stroke={fill} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={32} cy={50} r={7.5} fill={fill} />
      <Circle cx={50} cy={50} r={7.5} fill={fill} />
      <Circle cx={68} cy={50} r={7.5} fill={fill} />
    </Svg>
  );
}
