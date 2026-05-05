// PluginRPC — wires plugin install / uninstall / launch / list onto the
// session message router. Mirrors the LocalTokenService pattern: one helper
// (`registerPluginHandlers`) called from session.ts, no inline handlers.

import type { SessionOutboundMessage } from "../../shared/messages.js";
import type { MessageRouter } from "../session/router.js";
import type { PluginInstaller } from "./plugin-installer.js";

export function registerPluginHandlers(
  router: MessageRouter,
  installer: PluginInstaller,
  emit: (msg: SessionOutboundMessage) => void,
): void {
  router.register("plugin_list_request", async (msg) => {
    if (msg.type !== "plugin_list_request") return;
    try {
      const plugins = await installer.list();
      const serializable = plugins.map((p) => {
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          author: p.author,
          platforms: Array.from(p.platforms),
          status: p.status,
          companionApp: p.companionApp,
        };
      });
      emit({
        type: "plugin_list_response",
        payload: { requestId: msg.requestId, plugins: serializable },
      });
    } catch (err) {
      emit({
        type: "plugin_list_response",
        payload: {
          requestId: msg.requestId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  router.register("plugin_install_request", async (msg) => {
    if (msg.type !== "plugin_install_request") return;
    const result = await installer.install(msg.pluginId, (event) => {
      emit({
        type: "plugin_install_progress",
        payload: {
          requestId: msg.requestId,
          pluginId: event.pluginId,
          phase: event.phase,
          bytesLoaded: event.bytesLoaded,
          bytesTotal: event.bytesTotal,
          note: event.note,
        },
      });
    });
    emit({
      type: "plugin_install_response",
      payload: {
        requestId: msg.requestId,
        pluginId: result.pluginId,
        success: result.success,
        bridgeInstalled: result.bridgeInstalled,
        companionApp: result.companionApp
          ? {
              bundleName: result.companionApp.bundleName,
              state: result.companionApp.state,
              path: result.companionApp.path,
              releaseBrowserUrl: result.companionApp.releaseBrowserUrl,
              error: result.companionApp.error,
            }
          : undefined,
        error: result.error,
      },
    });
  });

  router.register("plugin_uninstall_request", async (msg) => {
    if (msg.type !== "plugin_uninstall_request") return;
    const result = await installer.uninstall(msg.pluginId);
    emit({
      type: "plugin_uninstall_response",
      payload: {
        requestId: msg.requestId,
        pluginId: result.pluginId,
        success: result.success,
        error: result.error,
      },
    });
  });

  router.register("plugin_launch_request", async (msg) => {
    if (msg.type !== "plugin_launch_request") return;
    const result = await installer.launch(msg.pluginId);
    emit({
      type: "plugin_launch_response",
      payload: {
        requestId: msg.requestId,
        pluginId: result.pluginId,
        success: result.success,
        error: result.error,
      },
    });
  });
}
