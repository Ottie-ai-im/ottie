import * as burnt from "burnt";
import { toast as sonnerToast } from "sonner";
import { isWeb } from "@/constants/platform";
import { t } from "i18next";
import { useOnboardingStateStore } from "@/stores/onboarding-state-store";

export type DelightEvent = "first-agent" | "first-permission" | "first-voice";

/**
 * One-shot Otter-branded delight toast wrapper.
 * Reads + writes useOnboardingStateStore flag to ensure each event fires only once per install.
 */
export function fireDelightToast(event: DelightEvent) {
  const store = useOnboardingStateStore.getState();

  let alreadyFired = false;
  let setter: (value: boolean) => void;

  switch (event) {
    case "first-agent":
      alreadyFired = store.delightFiredFirstAgent;
      setter = store.setDelightFiredFirstAgent;
      break;
    case "first-permission":
      alreadyFired = store.delightFiredFirstPermission;
      setter = store.setDelightFiredFirstPermission;
      break;
    case "first-voice":
      alreadyFired = store.delightFiredFirstVoice;
      setter = store.setDelightFiredFirstVoice;
      break;
  }

  if (alreadyFired) return;

  const title = t(`toasts.delight.${event}.title`);
  const message = t(`toasts.delight.${event}.message`);

  if (isWeb) {
    sonnerToast(title, {
      description: message,
    });
  } else {
    // Note: burnt presets are "done" | "error" | "none".
    // We use "done" as the system default for positive delight beats.
    burnt.alert({
      title,
      message,
      preset: "done",
    });
  }

  setter(true);
}
