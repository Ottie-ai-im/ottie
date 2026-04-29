import { Bot } from "lucide-react-native";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { PiIcon } from "@/components/icons/pi-icon";

const PROVIDER_ICONS: Record<string, typeof Bot> = {
  claude: ClaudeIcon as unknown as typeof Bot,
  codex: CodexIcon as unknown as typeof Bot,
  copilot: CopilotIcon as unknown as typeof Bot,
  opencode: OpenCodeIcon as unknown as typeof Bot,
  pi: PiIcon as unknown as typeof Bot,
};

export function getProviderIcon(provider: string): typeof Bot {
  return PROVIDER_ICONS[provider] ?? Bot;
}

/**
 * Per-provider accent colors for avatar circles in conversation lists.
 *
 * Design constraints:
 * - No purple/violet/indigo (user preference).
 * - White foreground icon for crisp contrast at 40px (saturated, not pastel).
 * - Distinct enough at small sizes that two providers don't blur together.
 * - Doesn't reuse the messenger-green Ottie brand accent (kept reserved for
 *   "self / online / unread" signals).
 *
 * Apply this only in avatar contexts (rounded circle wrapping the icon).
 * For inline icons in status bars, tabs, dropdowns — leave the icon
 * untinted so a chat full of provider avatars doesn't get a second wave
 * of provider tinting in the chrome.
 */
export interface ProviderAccent {
  background: string;
  foreground: string;
}

const PROVIDER_ACCENTS: Record<string, ProviderAccent> = {
  claude: { background: "#d97757", foreground: "#ffffff" }, // terra-cotta
  codex: { background: "#0f766e", foreground: "#ffffff" }, // teal-700
  copilot: { background: "#2563eb", foreground: "#ffffff" }, // blue-600
  opencode: { background: "#b45309", foreground: "#ffffff" }, // amber-700
  pi: { background: "#475569", foreground: "#ffffff" }, // slate-600
};

const DEFAULT_PROVIDER_ACCENT: ProviderAccent = {
  background: "#52525b", // zinc-600 — neutral fallback for unknown providers
  foreground: "#ffffff",
};

export function getProviderAccent(provider: string): ProviderAccent {
  return PROVIDER_ACCENTS[provider] ?? DEFAULT_PROVIDER_ACCENT;
}
