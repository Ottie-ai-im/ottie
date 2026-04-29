/**
 * Push-to-talk hotkey serialization.
 *
 * Format: lowercase modifier tokens joined with '+', followed by the key.
 *   "meta+shift+space"      // ⌘ + ⇧ + Space
 *   "control+alt+v"         // ⌃ + ⌥ + V
 *   "f1"                    // bare function key
 *
 * Modifier order is canonical (control, alt, shift, meta) so the same combo
 * always serializes the same way regardless of which modifier the user pressed
 * first. Stored in {@link AppSettings.betaFeatures.voiceControl.pushToTalkHotkey}.
 */

const MODIFIER_ORDER = ["control", "alt", "shift", "meta"] as const;
type ModifierName = (typeof MODIFIER_ORDER)[number];

function lowerKeyName(key: string): string {
  if (key === " ") return "space";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

/**
 * Build a canonical hotkey string from a DOM KeyboardEvent. Returns null if
 * the event doesn't represent a usable combo (e.g. modifier-only key, no key
 * at all). Caller should skip these.
 */
export function serializeHotkeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key) return null;
  // Refuse modifier-only keys — caller should keep listening.
  if (key === "Meta" || key === "Shift" || key === "Control" || key === "Alt") {
    return null;
  }
  const mods: ModifierName[] = [];
  if (event.ctrlKey) mods.push("control");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("meta");
  // Sort by canonical order (already in order above, but be defensive).
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  const main = lowerKeyName(key);
  return [...mods, main].join("+");
}

/**
 * Convert a serialized hotkey to a human-readable label using platform-aware
 * symbols. macOS gets ⌘ ⌥ ⌃ ⇧; everything else gets Ctrl/Alt/Shift/Win.
 */
export function formatHotkeyLabel(serialized: string, platform?: "mac" | "other"): string {
  const isMac =
    platform === "mac" ||
    (typeof navigator !== "undefined" &&
      typeof navigator.userAgent === "string" &&
      /Mac|iPhone|iPad/.test(navigator.userAgent));

  return serialized
    .split("+")
    .map((part) => {
      if (isMac) {
        if (part === "meta") return "⌘";
        if (part === "alt") return "⌥";
        if (part === "control") return "⌃";
        if (part === "shift") return "⇧";
      } else {
        if (part === "meta") return "Win";
        if (part === "alt") return "Alt";
        if (part === "control") return "Ctrl";
        if (part === "shift") return "Shift";
      }
      if (part === "space") return "Space";
      if (part.length === 1) return part.toUpperCase();
      // Function keys like "f1" → "F1"
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(isMac ? "" : "+");
}

/**
 * Test whether a {@link KeyboardEvent} matches a serialized hotkey. Used by
 * the PTT runtime to detect press/release without re-serializing every key.
 */
export function keyboardEventMatchesHotkey(
  event: KeyboardEvent,
  serialized: string | null,
): boolean {
  if (!serialized) return false;
  const fromEvent = serializeHotkeyFromKeyboardEvent(event);
  return fromEvent === serialized;
}
