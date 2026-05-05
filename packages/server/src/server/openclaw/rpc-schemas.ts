import { z } from "zod";

export const OpenclawAgentSchema = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string().nullable(),
});

export type OpenclawAgent = z.infer<typeof OpenclawAgentSchema>;

export const OpenclawListAgentsRequestSchema = z.object({
  type: z.literal("openclaw/agents/list"),
  requestId: z.string(),
});

export const OpenclawListAgentsResponseSchema = z.object({
  type: z.literal("openclaw/agents/list/response"),
  payload: z.object({
    requestId: z.string(),
    agents: z.array(OpenclawAgentSchema),
    error: z.string().nullable(),
  }),
});

export const OpenclawSendMessageRequestSchema = z.object({
  type: z.literal("openclaw/chat/send"),
  requestId: z.string(),
  text: z.string().min(1),
  agentId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

export const OpenclawSendMessageResponseSchema = z.object({
  type: z.literal("openclaw/chat/send/response"),
  payload: z.object({
    requestId: z.string(),
    reply: z.string(),
    error: z.string().nullable(),
  }),
});
