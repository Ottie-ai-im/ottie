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

export const InstallerAvailabilitySchema = z.object({
  docker: z.boolean(),
  pipx: z.boolean(),
});

export type InstallerAvailability = z.infer<typeof InstallerAvailabilitySchema>;

export const LocalServicesListResponseSchema = z.object({
  type: z.literal("local-services/list/response"),
  payload: z.object({
    requestId: z.string(),
    services: z.array(LocalServiceStatusSchema),
    installers: InstallerAvailabilitySchema.optional(),
    error: z.string().nullable(),
  }),
});

export const LocalServicesInstallRequestSchema = z.object({
  type: z.literal("local-services/install"),
  requestId: z.string(),
  serviceId: z.literal("open-webui"),
  method: z.enum(["docker", "pipx"]),
});

export const LocalServicesInstallResponseSchema = z.object({
  type: z.literal("local-services/install/response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    serviceId: z.literal("open-webui"),
    method: z.enum(["docker", "pipx"]),
    message: z.string(),
    output: z.string(),
    port: z.number().nullable(),
    error: z.string().nullable(),
  }),
});
