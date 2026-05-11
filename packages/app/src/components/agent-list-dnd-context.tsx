import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { ReactNode } from "react";

export type { DragEndEvent };
export { PointerSensor, useSensor, useSensors };

export function AgentListDndContext({
  sensors,
  onDragEnd,
  children,
}: {
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}
