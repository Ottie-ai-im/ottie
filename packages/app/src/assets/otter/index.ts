import { OttieLogo } from "@/components/icons/ottie-logo";

/**
 * Centralized Otter brand assets (THM-04).
 *
 * Every sanctioned Otter brand surface (Splash, Welcome, Empty, Delight)
 * must import from here to ensure consistency and grep-ability.
 */
export const otterAssets = {
  /** The primary brand logo (SVG component). */
  logo: OttieLogo,

  /** Illustration for the Welcome screen. */
  welcome: OttieLogo,

  /** Illustration for the first-time empty states (Workspace / Chats). */
  emptyState: OttieLogo,

  /** One-shot delight stickers (used in fireDelightToast). */
  delight: {
    firstAgent: OttieLogo,
    firstPermission: OttieLogo,
    firstVoice: OttieLogo,
  },
} as const;
