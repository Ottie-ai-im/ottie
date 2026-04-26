// Side-effect-only entry that initializes i18next synchronously with a best
// guess at the user's language, then upgrades to the persisted choice when
// AsyncStorage finishes loading.
//
// Importing this file in app/_layout.tsx (before any component renders) is
// what makes `useTranslation()` and `t()` work everywhere else.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./index";

function detectDeviceLanguage(): SupportedLanguage {
  try {
    const locales = Localization.getLocales();
    const tag = locales[0]?.languageCode ?? "en";
    return tag === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

if (!i18n.isInitialized) {
  // Initialize synchronously with the device-detected language. The user's
  // persisted choice is loaded right after; if it differs, we switch.
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: detectDeviceLanguage(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
    // Hermes (the JS engine RN uses) ships without Intl.PluralRules. Without
    // this flag, i18next logs a "your environment seems not to be Intl API
    // compatible" error on iOS / Android. v3 plural format works fine for
    // simple en/zh keys (no plural forms in our locale files yet).
    compatibilityJSON: "v3",
  });

  // Pull persisted language out of AsyncStorage and switch if it's set
  // and supported.
  void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      void i18n.changeLanguage(stored);
    }
  });
}
