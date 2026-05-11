import { z } from "zod";

export const HermesSetupStateSchema = z.object({
  installed: z.boolean(),
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
});

export type HermesSetupState = z.infer<typeof HermesSetupStateSchema>;

export const HermesSetupCheckRequestSchema = z.object({
  type: z.literal("hermes/setup/check"),
  requestId: z.string(),
});

export const HermesSetupCheckResponseSchema = z.object({
  type: z.literal("hermes/setup/check/response"),
  payload: z.object({
    requestId: z.string(),
    state: HermesSetupStateSchema,
    error: z.string().nullable(),
  }),
});

export const HermesSetupConfigureRequestSchema = z.object({
  type: z.literal("hermes/setup/configure"),
  requestId: z.string(),
  provider: z.string(),
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
});

export const HermesSetupConfigureResponseSchema = z.object({
  type: z.literal("hermes/setup/configure/response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

export const HermesModelSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export type HermesModel = z.infer<typeof HermesModelSchema>;

export const HermesListModelsRequestSchema = z.object({
  type: z.literal("hermes/models/list"),
  requestId: z.string(),
});

export const HermesListModelsResponseSchema = z.object({
  type: z.literal("hermes/models/list/response"),
  payload: z.object({
    requestId: z.string(),
    models: z.array(HermesModelSchema),
    error: z.string().nullable(),
  }),
});

export const HermesSendMessageRequestSchema = z.object({
  type: z.literal("hermes/chat/send"),
  requestId: z.string(),
  text: z.string().min(1),
  modelId: z.string().nullable().optional(),
});

export const HermesSendMessageResponseSchema = z.object({
  type: z.literal("hermes/chat/send/response"),
  payload: z.object({
    requestId: z.string(),
    reply: z.string(),
    error: z.string().nullable(),
  }),
});
