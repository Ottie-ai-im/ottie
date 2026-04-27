import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentUsage, AgentProvider } from "@server/server/agent/agent-sdk-types";

// One running snapshot per agent. Claude and Codex emit cumulative session
// totals on turn_completed (totals grow monotonically within a session). We
// keep the latest as `current`; if a field drops we treat that as a new
// run/reset for the agent and fold the previous totals into `archived`. The
// displayed value for an agent is `archived + current`.
export interface AgentUsageRecord {
  serverId: string;
  agentId: string;
  provider: AgentProvider;
  current: UsageNumbers;
  archived: UsageNumbers;
  lastUpdatedAt: number;
}

export interface UsageNumbers {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  turnCount: number;
}

export interface UsageTotals extends UsageNumbers {}

export interface ProviderTotals {
  provider: AgentProvider;
  totals: UsageTotals;
  agentCount: number;
}

interface UsageStoreState {
  records: Record<string, AgentUsageRecord>;
  firstRecordedAt: number | null;
  lastRecordedAt: number | null;
  recordTurn: (args: {
    serverId: string;
    agentId: string;
    provider: AgentProvider;
    usage: AgentUsage;
  }) => void;
  reset: () => void;
}

function emptyNumbers(): UsageNumbers {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    turnCount: 0,
  };
}

function recordKey(serverId: string, agentId: string): string {
  return `${serverId}::${agentId}`;
}

function addNumbers(a: UsageNumbers, b: UsageNumbers): UsageNumbers {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalCostUsd: a.totalCostUsd + b.totalCostUsd,
    turnCount: a.turnCount + b.turnCount,
  };
}

export function totalForRecord(record: AgentUsageRecord): UsageNumbers {
  return addNumbers(record.archived, record.current);
}

function pickNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

// A drop in any monotonic field means the provider restarted its cumulative
// counter (e.g. agent re-launched, daemon restarted). Fold the prior totals
// into archived and start fresh.
function detectReset(prev: UsageNumbers, next: { input: number; output: number; cost: number }) {
  return (
    next.input < prev.inputTokens ||
    next.output < prev.outputTokens ||
    next.cost < prev.totalCostUsd
  );
}

export const useUsageStore = create<UsageStoreState>()(
  persist(
    (set) => ({
      records: {},
      firstRecordedAt: null,
      lastRecordedAt: null,
      recordTurn: ({ serverId, agentId, provider, usage }) => {
        const inputTokens = pickNumber(usage.inputTokens);
        const cachedInputTokens = pickNumber(usage.cachedInputTokens);
        const outputTokens = pickNumber(usage.outputTokens);
        const totalCostUsd = pickNumber(usage.totalCostUsd);
        if (
          inputTokens === 0 &&
          cachedInputTokens === 0 &&
          outputTokens === 0 &&
          totalCostUsd === 0
        ) {
          return;
        }
        const now = Date.now();
        const key = recordKey(serverId, agentId);
        set((state) => {
          const existing = state.records[key];
          if (!existing) {
            const record: AgentUsageRecord = {
              serverId,
              agentId,
              provider,
              current: {
                inputTokens,
                cachedInputTokens,
                outputTokens,
                totalCostUsd,
                turnCount: 1,
              },
              archived: emptyNumbers(),
              lastUpdatedAt: now,
            };
            return {
              records: { ...state.records, [key]: record },
              firstRecordedAt: state.firstRecordedAt ?? now,
              lastRecordedAt: now,
            };
          }
          const reset = detectReset(existing.current, {
            input: inputTokens,
            output: outputTokens,
            cost: totalCostUsd,
          });
          if (reset) {
            const archived = addNumbers(existing.archived, existing.current);
            const record: AgentUsageRecord = {
              ...existing,
              provider,
              archived,
              current: {
                inputTokens,
                cachedInputTokens,
                outputTokens,
                totalCostUsd,
                turnCount: 1,
              },
              lastUpdatedAt: now,
            };
            return {
              records: { ...state.records, [key]: record },
              firstRecordedAt: state.firstRecordedAt ?? now,
              lastRecordedAt: now,
            };
          }
          const record: AgentUsageRecord = {
            ...existing,
            provider,
            current: {
              inputTokens,
              cachedInputTokens,
              outputTokens,
              totalCostUsd,
              turnCount: existing.current.turnCount + 1,
            },
            lastUpdatedAt: now,
          };
          return {
            records: { ...state.records, [key]: record },
            firstRecordedAt: state.firstRecordedAt ?? now,
            lastRecordedAt: now,
          };
        });
      },
      reset: () =>
        set({
          records: {},
          firstRecordedAt: null,
          lastRecordedAt: null,
        }),
    }),
    {
      name: "ottie-usage-totals",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        records: state.records,
        firstRecordedAt: state.firstRecordedAt,
        lastRecordedAt: state.lastRecordedAt,
      }),
    },
  ),
);

export function computeGrandTotal(records: Record<string, AgentUsageRecord>): UsageTotals {
  let total = emptyNumbers();
  for (const record of Object.values(records)) {
    total = addNumbers(total, totalForRecord(record));
  }
  return total;
}

export function computeProviderBreakdown(
  records: Record<string, AgentUsageRecord>,
): ProviderTotals[] {
  const byProvider = new Map<AgentProvider, ProviderTotals>();
  for (const record of Object.values(records)) {
    const summary = totalForRecord(record);
    const existing = byProvider.get(record.provider);
    if (existing) {
      existing.totals = addNumbers(existing.totals, summary);
      existing.agentCount += 1;
    } else {
      byProvider.set(record.provider, {
        provider: record.provider,
        totals: summary,
        agentCount: 1,
      });
    }
  }
  return Array.from(byProvider.values()).sort((a, b) => {
    const totalA = a.totals.inputTokens + a.totals.outputTokens;
    const totalB = b.totals.inputTokens + b.totals.outputTokens;
    return totalB - totalA;
  });
}
