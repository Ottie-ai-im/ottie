/**
 * CI parity gate for the ActionRegistry (Plan 02a Task 3).
 *
 * Enforces the NAT-01 acceptance criteria so future PRs can't silently break
 * cross-modality coverage:
 *
 *   - Every NAT-01 reference action is registered (registration-on-load).
 *   - Every NAT-01 reference action covers >= 2 modalities (so voice and
 *     keyboard / cmdk can't drift apart).
 *   - Every registered action ships with both EN + ZH locale entries
 *     (per CLAUDE.md "every user-visible string change must update both
 *     en.json and zh.json").
 *   - >= 80% of all registered actions have modalities.length >= 2.
 *
 * This test is the wall against PITFALLS #6 (parity rot). Plan 02c (chat-row
 * + add-menu) and Plan 02d (settings deep-link actions) will register more
 * ids; the 80% gate is generous enough to absorb future single-modality
 * actions while still flagging widespread regression.
 */
import { describe, it, expect } from "vitest";
import enLocale from "@/i18n/locales/en.json" with { type: "json" };
import zhLocale from "@/i18n/locales/zh.json" with { type: "json" };
import { actionRegistry } from "@/actions/registry";
import { registerBuiltInActions } from "@/actions/built-in-actions";
import { registerChatRowActions } from "@/actions/chat-row-actions";
import { registerSettingsActions } from "@/actions/settings-actions";

// Side-effect: register the 6 NAT-01 reference actions + the 13 chat-row
// + add-menu actions (Plan 02c) + the 6 settings deep-link actions (Plan 02d)
// before assertions run. Importing the registration modules directly (not
// voice-commands.ts) keeps the parity test independent of the voice runtime
// stack.
registerBuiltInActions();
registerChatRowActions();
registerSettingsActions();

const NAT_01_REFERENCE_IDS = [
  "agent.create",
  "workspace.switch",
  "session.jump.recent",
  "permission.decide",
  "settings.open",
  "theme.cycle",
] as const;

/**
 * Convert "agent.create" → "actions.agentCreate" so we can locate the locale
 * entry by traversing the nested `actions` namespace in en.json / zh.json.
 *
 * The locale files use the conventional nested-keys form (`{ actions: {
 * agentCreate: "..." } }`) so i18next's `t("actions.agentCreate")` resolves
 * naturally — same shape as every other section in the file.
 */
function actionIdToLocaleKey(id: string): string {
  const parts = id.split(".");
  const camel = parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
  return `actions.${camel}`;
}

function pickKey(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

describe("ActionRegistry parity (NAT-01)", () => {
  it("every NAT-01 reference action is registered", () => {
    const ids = new Set(actionRegistry.list().map((a) => a.id));
    for (const id of NAT_01_REFERENCE_IDS) {
      expect(ids.has(id), `Missing registration for ${id}`).toBe(true);
    }
  });

  it("every NAT-01 reference action covers >= 2 modalities (CONTEXT Q6)", () => {
    for (const id of NAT_01_REFERENCE_IDS) {
      const action = actionRegistry.getActionById(id);
      expect(action, `Missing ${id}`).toBeDefined();
      expect(
        action!.modalities.length,
        `${id} only reachable from ${action!.modalities.join(",")}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("every registered action has en + zh locale entries", () => {
    for (const action of actionRegistry.list()) {
      const localeKey = actionIdToLocaleKey(action.id);
      const en = pickKey(enLocale as Record<string, unknown>, localeKey);
      const zh = pickKey(zhLocale as Record<string, unknown>, localeKey);
      expect(
        typeof en === "string" && (en as string).length > 0,
        `EN missing for ${action.id} → ${localeKey}`,
      ).toBe(true);
      expect(
        typeof zh === "string" && (zh as string).length > 0,
        `ZH missing for ${action.id} → ${localeKey}`,
      ).toBe(true);
    }
  });

  it(">= 80% of registered actions have modalities.length >= 2", () => {
    const actions = actionRegistry.list();
    expect(actions.length).toBeGreaterThan(0);
    const multi = actions.filter((a) => a.modalities.length >= 2).length;
    const ratio = multi / actions.length;
    expect(
      ratio,
      `Only ${multi}/${actions.length} actions are multi-modality`,
    ).toBeGreaterThanOrEqual(0.8);
  });
});
