import { z } from "zod";

export const LocalServiceStatusSchema = z.object({
  id: z.enum(["open-webui", "openclaw", "hermes"]),
  label: z.string(),
  running: z.boolean(),
  port: z.number().nullable(),
  url: z.string().nullable(),
  responseTimeMs: z.number().nullable(),
});

export type LocalServiceStatusPayload = z.infer<typeof LocalServiceStatusSchema>;

export const LocalServicesListRequestSchema = z.object({
  type: z.literal("local-services/list"),
  requestId: z.string(),
});

export const LocalServicesListResponseSchema = z.object({
  type: z.literal("local-services/list/response"),
  payload: z.object({
    requestId: z.string(),
    services: z.array(LocalServiceStatusSchema),
    error: z.string().nullable(),
  }),
});
