import { z } from "zod";

export const UsageProviderSummarySchema = z.object({
  provider: z.enum(["claude-code", "codex"]),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  estimatedCostUsd: z.number().nullable(),
  sessionsCount: z.number(),
  messagesCount: z.number(),
  firstMessageAt: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  currentBlockStartedAt: z.string().nullable(),
  currentBlockResetsAt: z.string().nullable(),
  currentBlockTokens: z.number(),
  weekTokens: z.number(),
  weekCostUsd: z.number().nullable(),
  // Live provider-reported quota windows. All optional so a 6-month-old
  // client still parses a new daemon's payload (CLAUDE.md schema rule).
  quotaFiveHourUsedPercent: z.number().nullable().optional(),
  quotaFiveHourResetsAt: z.string().nullable().optional(),
  quotaWeeklyUsedPercent: z.number().nullable().optional(),
  quotaWeeklyResetsAt: z.string().nullable().optional(),
  planTier: z.string().nullable().optional(),
  quotaError: z.string().nullable().optional(),
});

export const UsageSummarySchema = z.object({
  generatedAt: z.string(),
  providers: z.array(UsageProviderSummarySchema),
});

export const UsageListRequestSchema = z.object({
  type: z.literal("usage/list"),
  requestId: z.string(),
});

export type UsageProviderSummary = z.infer<typeof UsageProviderSummarySchema>;
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const UsageListResponseSchema = z.object({
  type: z.literal("usage/list/response"),
  payload: z.object({
    requestId: z.string(),
    summary: UsageSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});
