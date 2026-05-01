import { z } from "zod";
import type { ActionId } from "@/actions/ids";
import type { Modality } from "@/actions/modalities";

export type { ActionId } from "@/actions/ids";
export { ALL_ACTION_IDS } from "@/actions/ids";
export type { Modality } from "@/actions/modalities";
export { ALL_MODALITIES } from "@/actions/modalities";

/**
 * Shape of a single registered action.
 *
 * Mirrors `VoiceCommand` in `packages/app/src/voice-control/voice-commands.ts`
 * so callers can mechanically lift voice-command handlers into ActionRegistry.
 *
 * Type parameter is invariant — `schema` produces `TParams` and `handler`
 * consumes `TParams`. Callers MUST go through `dispatch()` (which `safeParse`s
 * the payload before calling the handler) instead of invoking handlers
 * directly.
 */
export interface Action<TParams = unknown> {
  id: ActionId;
  description: string;
  modalities: ReadonlyArray<Modality>;
  schema: z.ZodType<TParams>;
  handler: (params: TParams) => Promise<void> | void;
}

/**
 * Helper: build a typed Action without losing inference.
 *
 * Mirrors `defineCommand` in voice-commands.ts. Each consumer site stays
 * strongly typed (`schema: z.object({foo: z.string()})` flows through to
 * `handler: ({foo}) => ...`); the registry stores actions as `Action<unknown>`
 * after registration so iteration uses a uniform shape.
 */
export function defineAction<TSchema extends z.ZodType>(
  id: ActionId,
  config: {
    description: string;
    modalities: ReadonlyArray<Modality>;
    schema: TSchema;
    handler: (params: z.infer<TSchema>) => Promise<void> | void;
  },
): Action<z.infer<TSchema>> {
  return { id, ...config };
}

export interface ActionRegistry {
  /**
   * Register an action. Returns an `unregister` function for tests / dynamic
   * surfaces that need to clean up. In production code most actions are
   * registered at module load and never unregistered.
   *
   * Re-registering the same id replaces the existing entry — last-writer-wins
   * is intentional so a feature flag can override a default action.
   */
  register<T>(action: Action<T>): () => void;

  /** Lookup by id. Undefined when nothing is registered for that id. */
  getActionById(id: ActionId): Action | undefined;

  /**
   * Lightweight client-side filter for cmdk / palette UIs. Matches against
   * id and description (case-insensitive substring).
   */
  searchActions(query: string): Action[];

  /**
   * Validate `params` against the action's Zod schema and invoke the handler.
   * Returns `false` if no action is registered for the id, or if the payload
   * fails schema validation. Returns `true` after the handler resolves.
   */
  dispatch<T>(id: ActionId, params: T): Promise<boolean>;

  /** Snapshot of every registered action — used by the parity test. */
  list(): Action[];
}

/**
 * Create a fresh registry. Tests use this to get isolation; production code
 * imports the singleton `actionRegistry` below.
 */
export function createActionRegistry(): ActionRegistry {
  const map = new Map<ActionId, Action>();
  return {
    register(action) {
      map.set(action.id, action as unknown as Action);
      return () => {
        map.delete(action.id);
      };
    },

    getActionById(id) {
      return map.get(id);
    },

    searchActions(query) {
      const needle = query.trim().toLowerCase();
      if (!needle) return Array.from(map.values());
      return Array.from(map.values()).filter((action) => {
        if (action.id.toLowerCase().includes(needle)) return true;
        if (action.description.toLowerCase().includes(needle)) return true;
        return false;
      });
    },

    async dispatch(id, params) {
      const action = map.get(id);
      if (!action) return false;
      const parsed = action.schema.safeParse(params);
      if (!parsed.success) return false;
      await action.handler(parsed.data);
      return true;
    },

    list() {
      return Array.from(map.values());
    },
  };
}

/**
 * Process-wide singleton registry. Voice / keyboard / cmdk / menu surfaces
 * all dispatch through this one instance so the CI parity test can assert
 * cross-modality coverage.
 */
export const actionRegistry: ActionRegistry = createActionRegistry();

/**
 * Convenience: re-export `getActionById` and `searchActions` bound to the
 * singleton so consumers can do
 *   `import { getActionById } from "@/actions/registry"`
 * without writing `actionRegistry.getActionById`.
 */
export function getActionById(id: ActionId): Action | undefined {
  return actionRegistry.getActionById(id);
}

export function searchActions(query: string): Action[] {
  return actionRegistry.searchActions(query);
}

/**
 * Public alias for the (currently empty until plan tasks register them)
 * canonical action set.
 *
 * Reserved for future ergonomic helpers — exists so the symbol is stable in
 * the public surface enumerated by Plan 02a's must-haves block.
 */
export const ACTIONS = {} as const;
