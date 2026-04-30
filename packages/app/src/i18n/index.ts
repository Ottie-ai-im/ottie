// i18n bootstrap. Initialised once when the app starts (see _layout.tsx),
// then any component can call useTranslation()/t() from react-i18next.
//
// Storage:
//   - User-picked language wins, persisted in AsyncStorage under
//     LANGUAGE_STORAGE_KEY.
//   - If unset, fall back to the device locale (zh-* → zh, anything else → en).
//   - Default if locale lookup fails: en.
//
// Adding strings:
//   1. Add the key to BOTH locales/en.json and locales/zh.json.
//   2. Use it in components via `const { t } = useTranslation(); t("welcome.title")`.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "@ottie:language";

function detectDeviceLanguage(): SupportedLanguage {
  try {
    const locales = Localization.getLocales();
    const tag = locales[0]?.languageCode ?? "en";
    return tag === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

let initialized = false;

export async function initI18n(): Promise<void> {
  if (initialized) return;
  initialized = true;

  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    stored = null;
  }

  const lng: SupportedLanguage = isSupported(stored) ? stored : detectDeviceLanguage();

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

function isSupported(value: string | null): value is SupportedLanguage {
  return value === "en" || value === "zh";
}

export async function setLanguage(lng: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Persistence failure shouldn't crash the app — the in-memory change
    // already took effect.
  }
}

export function getCurrentLanguage(): SupportedLanguage {
  const cur = i18n.language;
  return isSupported(cur) ? cur : "en";
}

export { default as i18n } from "i18next";
