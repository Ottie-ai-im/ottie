const fs = require("node:fs");
const path = require("node:path");
const pkg = require("./package.json");
const appVariant = process.env.APP_VARIANT ?? "production";

function resolveSecretFile(params) {
  const fromEnv = process.env[params.envKey];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const fallbackAbsolutePath = path.resolve(__dirname, params.fallbackRelativePath);
  if (fs.existsSync(fallbackAbsolutePath)) {
    return params.fallbackRelativePath;
  }

  return undefined;
}

const variants = {
  production: {
    name: "Ottie",
    packageId: "com.ottie",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_PROD",
      fallbackRelativePath: "./.secrets/google-services.prod.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_PROD",
      fallbackRelativePath: "./.secrets/GoogleService-Info.prod.plist",
    }),
  },
  development: {
    name: "Ottie Debug",
    packageId: "com.ottie.debug",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_DEBUG",
      fallbackRelativePath: "./.secrets/google-services.debug.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_DEBUG",
      fallbackRelativePath: "./.secrets/GoogleService-Info.debug.plist",
    }),
  },
};

const variant = variants[appVariant] ?? variants.production;

export default {
  expo: {
    name: variant.name,
    slug: "voice-mobile",
    version: pkg.version.replace(/-.*$/, ""),
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "ottie",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    runtimeVersion: {
      policy: "appVersion",
    },
    // OTA updates intentionally disabled in dev. The previous value pointed at
    // the upstream EAS project and would push OTA updates there if left in.
    // To enable: register Ottie's own EAS project with `eas init`, then add:
    //   updates: { url: "https://u.expo.dev/<your-project-id>" }
    // back to this config.
    ios: {
      supportsTablet: true,
      // CFBundleVersion. App Store Connect rejects re-uploads of the same
      // (version, buildNumber) pair, so the release script bumps this via
      // IOS_BUILD_NUMBER each run. Falls back to "1" for local dev builds.
      buildNumber: process.env.IOS_BUILD_NUMBER ?? "1",
      infoPlist: {
        NSMicrophoneUsageDescription: "This app needs access to the microphone for voice commands.",
        NSLocationWhenInUseUsageDescription:
          "Ottie uses your location when you tap 'Share location' so you can include it in messages to your agents.",
        NSCameraUsageDescription:
          "Ottie uses the camera when you tap 'Take photo' to attach images to messages.",
        NSPhotoLibraryUsageDescription:
          "Ottie reads your photo library when you tap 'Add image' to attach images to messages.",
        ITSAppUsesNonExemptEncryption: false,
        // Live Activities + Dynamic Island. iOS 16.1+ shows the lock-screen
        // widget; iOS 16.2+ on iPhone 14 Pro+ surfaces the Dynamic Island.
        NSSupportsLiveActivities: true,
      },
      bundleIdentifier: variant.packageId,
      ...(variant.googleServiceInfoPlist
        ? { googleServicesFile: variant.googleServiceInfoPlist }
        : {}),
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/android-icon-foreground.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: "resize",
      // Allow HTTP connections for local network hosts (required for release builds)
      usesCleartextTraffic: true,
      permissions: [
        "RECORD_AUDIO",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "CAMERA",
        "android.permission.CAMERA",
      ],
      package: variant.packageId,
      ...(variant.googleServicesFile ? { googleServicesFile: variant.googleServicesFile } : {}),
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: [
      "expo-router",
      "expo-sqlite",
      [
        "expo-camera",
        {
          cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to scan pairing QR codes.",
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#1FA855",
        },
      ],
      "expo-audio",
      [
        "expo-font",
        {
          fonts: [
            "./assets/fonts/JetBrainsMono-Regular.ttf",
            "./assets/fonts/JetBrainsMono-Bold.ttf",
            "./assets/fonts/JetBrainsMono-Italic.ttf",
            "./assets/fonts/JetBrainsMono-BoldItalic.ttf",
            "./assets/fonts/ArkPixel16px.ttf",
          ],
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            // Live Activities require iOS 16.1+. The Widget Extension target
            // also needs ≥16.1 (set in targets/OttieLiveActivity/expo-target.config.js).
            deploymentTarget: "16.1",
          },
          android: {
            minSdkVersion: 29,
            kotlinVersion: "2.1.20",
            // Allow HTTP connections for local network hosts in release builds
            usesCleartextTraffic: true,
          },
        },
      ],
      // @bacons/apple-targets generates the Widget Extension target from the
      // sibling `targets/OttieLiveActivity/` folder during `expo prebuild -p ios`.
      // The team ID is required so the Widget Extension can be code-signed.
      [
        "@bacons/apple-targets",
        {
          appleTeamId: "NYJ9G8WDLK",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
      autolinkingModuleResolution: true,
    },
    // EAS project intentionally not configured. To enable EAS builds,
    // run `eas init` once and Expo CLI will write the projectId back into
    // this block automatically.
    extra: {
      router: {},
      eas: {
        projectId: "5202b471-f4da-4f0e-b83d-3d3daa06dc09",
      },
    },
    owner: "gdbzriww",
  },
};
