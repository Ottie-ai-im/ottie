import { create } from "zustand";

/**
 * Ghost cursor state — visual feedback for "AI is clicking somewhere".
 *
 * Pattern adapted from openai/realtime-voice-component's `useGhostCursor`
 * (~500 LoC) into a much smaller version: a single cursor at a single
 * position, with phase transitions for fade-in / move / pulse / fade-out.
 *
 * Live state updates flow:
 *   controller.runCommand() → resolveTarget() → store.flyTo(point) → overlay
 *   moves to the point, pulses on arrival, then fades after the action
 *   message is shown.
 *
 * Web-only — the overlay self-gates on isWeb.
 */

export type GhostCursorPhase = "hidden" | "approaching" | "pulsing" | "leaving";

export interface GhostCursorPoint {
  x: number;
  y: number;
}

interface GhostCursorState {
  phase: GhostCursorPhase;
  position: GhostCursorPoint;
  /** Generation counter — increments on every flyTo so animations can key off
   * it for forced restarts (otherwise back-to-back identical points are
   * indistinguishable to React). */
  generation: number;

  flyTo: (point: GhostCursorPoint) => void;
  pulse: () => void;
  leave: () => void;
  hide: () => void;
}

export const useGhostCursorStore = create<GhostCursorState>((set) => ({
  phase: "hidden",
  position: { x: 0, y: 0 },
  generation: 0,

  flyTo: (point) =>
    set((state) => ({
      phase: "approaching",
      position: point,
      generation: state.generation + 1,
    })),

  pulse: () => set({ phase: "pulsing" }),

  leave: () => set({ phase: "leaving" }),

  hide: () => set({ phase: "hidden" }),
}));

export const selectGhostCursorPhase = (s: GhostCursorState) => s.phase;
export const selectGhostCursorPosition = (s: GhostCursorState) => s.position;
export const selectGhostCursorGeneration = (s: GhostCursorState) => s.generation;
