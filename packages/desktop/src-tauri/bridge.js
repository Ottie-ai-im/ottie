// Injected into every webview before user JS. Recreates the
// `window.ottieDesktop` surface that the Electron preload script used to
// expose, but routes every call through Tauri's `__TAURI_INTERNALS__.invoke`
// so the rest of the frontend stays untouched.
//
// The shape must match `DesktopHostBridge` in
// packages/app/src/desktop/host.ts.
(function () {
  if (typeof window === "undefined") return;
  if (window.ottieDesktop) return;

  // Mark the document so CSS can swap to a transparent root and let the
  // native macOS NSVisualEffect / Windows acrylic backdrop bleed through
  // beneath the React app. The CSS rule lives in packages/app/public/index.html.
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("data-tauri", "true");
    } else if (typeof document !== "undefined") {
      document.addEventListener("DOMContentLoaded", function () {
        document.documentElement.setAttribute("data-tauri", "true");
      });
    }
  } catch (_err) {
    // ignore — this is purely cosmetic chrome.
  }

  function tauri() {
    return window.__TAURI_INTERNALS__;
  }

  function invoke(cmd, args) {
    var t = tauri();
    if (!t || typeof t.invoke !== "function") {
      return Promise.reject(new Error("Tauri runtime not initialised"));
    }
    return t.invoke(cmd, args || {});
  }

  // Events from Rust arrive as DOM CustomEvents on the window. The Rust
  // side dispatches them with `webview.eval("window.dispatchEvent(...)")`
  // — see emit_to_webview() in main.rs. This sidesteps the need to pull in
  // @tauri-apps/api just to subscribe.
  function listen(event, handler) {
    var name = "ottie://" + event;
    function cb(e) {
      try {
        handler(e && e.detail !== undefined ? e.detail : undefined);
      } catch (err) {
        console.error("[ottieDesktop] listener for " + event + " threw:", err);
      }
    }
    window.addEventListener(name, cb);
    return Promise.resolve(function () {
      window.removeEventListener(name, cb);
    });
  }

  var bridge = {
    platform: undefined,
    invoke: function (command, args) {
      return invoke("ottie_invoke", { command: command, args: args || {} });
    },
    getPendingOpenProject: function () {
      return invoke("ottie_get_pending_open_project");
    },
    events: {
      on: function (event, handler) {
        return listen(event, handler);
      },
    },
    window: {
      getCurrentWindow: function () {
        return {
          toggleMaximize: function () {
            return invoke("ottie_window_toggle_maximize");
          },
          isFullscreen: function () {
            return invoke("ottie_window_is_fullscreen");
          },
          updateWindowControls: function (update) {
            return invoke("ottie_window_update_controls", { update: update });
          },
          onResized: function (handler) {
            return listen("window-resized", handler);
          },
          onDragDropEvent: function (handler) {
            return listen("drag-drop", handler);
          },
          setBadgeCount: function (count) {
            return invoke("ottie_window_set_badge_count", { count: count });
          },
        };
      },
    },
    dialog: {
      ask: function (message, options) {
        return invoke("ottie_dialog_ask", { message: message, options: options || {} });
      },
      open: function (options) {
        return invoke("ottie_dialog_open", { options: options || {} });
      },
    },
    notification: {
      isSupported: function () {
        return invoke("ottie_notification_is_supported");
      },
      sendNotification: function (payload) {
        var p = typeof payload === "string" ? { title: payload } : payload;
        return invoke("ottie_notification_send", { payload: p });
      },
    },
    opener: {
      openUrl: function (url) {
        return invoke("ottie_opener_open_url", { url: url });
      },
    },
    menu: {
      showContextMenu: function (input) {
        return invoke("ottie_menu_show_context", { input: input || {} });
      },
    },
  };

  // Resolve `platform` synchronously by reading the value the Rust side
  // will inject as window.__OTTIE_PLATFORM__ during initialization.
  Object.defineProperty(bridge, "platform", {
    get: function () {
      return window.__OTTIE_PLATFORM__;
    },
    enumerable: true,
  });

  window.ottieDesktop = bridge;
})();
