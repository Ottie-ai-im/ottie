import * as burnt from "burnt";
import { toast as sonnerToast } from "sonner";
import { isWeb } from "@/constants/platform";
import { t } from "i18next";

export type SystemToastEvent =
  | "mark-read"
  | "mute"
  | "unmute"
  | "delete"
  | "send-ack"
  | "agent-run-start"
  | "agent-run-stop"
  | "permission-approve"
  | "permission-deny";

/**
 * burnt-backed system-toast helper for state-change acknowledgments.
 * Uses sonner on web as a fallback.
 */
export function systemToast(
  event: SystemToastEvent,
  overrides?: { title?: string; message?: string },
) {
  const title = overrides?.title ?? t(`toasts.${event}.title`);
  const message = overrides?.message ?? t(`toasts.${event}.message`);

  if (isWeb) {
    sonnerToast(title, {
      description: message,
    });
    return;
  }

  const preset =
    event.includes("deny") || event.includes("delete") || event.includes("stop") ? "error" : "done";

  burnt.alert({
    title,
    message: message || undefined,
    preset,
  });
}
