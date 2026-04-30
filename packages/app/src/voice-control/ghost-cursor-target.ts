import { isWeb } from "@/constants/platform";
import { useGhostCursorStore, type GhostCursorPoint } from "@/voice-control/ghost-cursor-store";

/**
 * DOM-anchored ghost-cursor targeting.
 *
 * Pattern from openai/realtime-voice-component: command-relevant UI elements
 * carry `data-voice-target="<command-name>"` attributes. When a command runs,
 * the controller looks up the element and animates the ghost cursor to its
 * center. Falls back to bottom-right (where the PTT pill lives) if the
 * element isn't on screen.
 *
 * Why DOM lookup instead of imperative refs?
 *   - Buttons appear / disappear with route changes; refs would need plumbing
 *     through context. data-* attributes are stable and queryable on demand.
 *   - Native gets a noop here — there's no equivalent of querySelector for
 *     React Native's view hierarchy without a heavy native bridge.
 */

const FALLBACK_INSET = 96;

function getFallbackPoint(): GhostCursorPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.max(0, window.innerWidth - FALLBACK_INSET),
    y: Math.max(0, window.innerHeight - FALLBACK_INSET),
  };
}

function getElementCenter(element: HTMLElement): GhostCursorPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * Resolve the screen point for a voice-targeted command. Returns null on
 * native and on web platforms without a DOM (Tauri webview is fine).
 *
 * Selector uses `~=` so a single button can declare multiple matching
 * commands via a space-separated list (e.g. `dataSet={{ voiceTarget:
 * "open_file_explorer close_file_explorer" }}` for the toggle).
 */
export function resolveTargetPoint(commandName: string): GhostCursorPoint | null {
  if (!isWeb) return null;
  if (typeof document === "undefined") return null;
  const selector = `[data-voice-target~="${CSS.escape(commandName)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (element) {
    return getElementCenter(element);
  }
  return getFallbackPoint();
}

/**
 * Drive the cursor through approach → pulse → leave for a single command.
 * Idempotent on calls after `leave()` — overlay just stays hidden.
 */
export function flyGhostCursorForCommand(commandName: string): void {
  if (!isWeb) return;
  const point = resolveTargetPoint(commandName);
  if (!point) return;
  const store = useGhostCursorStore.getState();
  store.flyTo(point);
  // Pulse after travel completes; leave after the action message has been
  // shown to the user. Numbers picked to fit inside the 900ms post-execute
  // window the controller's scheduleFadeToIdle uses.
  setTimeout(() => useGhostCursorStore.getState().pulse(), 280);
  setTimeout(() => useGhostCursorStore.getState().leave(), 700);
  setTimeout(() => useGhostCursorStore.getState().hide(), 1100);
}
