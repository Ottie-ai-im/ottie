import type { ReactElement, ReactNode } from "react";

export interface DragEndEvent {
  active: { id: string | number; data: { current?: Record<string, unknown> } };
  over: { id: string | number; data: { current?: Record<string, unknown> } } | null;
}

export const PointerSensor: unknown = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSensor(_sensor: unknown, _options?: unknown): any {
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSensors(..._sensors: unknown[]): any {
  return [];
}

export function AgentListDndContext({ children }: { children: ReactNode }) {
  return children as ReactElement | null;
}
