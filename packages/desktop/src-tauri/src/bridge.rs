// Tauri commands that back `window.ottieDesktop`. The frontend was written
// against the Electron preload bridge; we keep the same surface and route
// each call through Tauri plugins or native APIs.
//
// What's NOT yet ported (returns "not implemented in Tauri yet" so the UI
// can degrade gracefully):
//   - desktop_daemon_status / start / stop / restart / logs / pairing
//   - cli_daemon_status / install_cli / get_cli_install_status
//   - check_app_update / install_app_update / get_local_daemon_version
//   - install_skills / get_skills_install_status
//   - write_attachment_base64 / copy_attachment_file / read_file_base64 /
//     delete_attachment_file / garbage_collect_attachment_files
//   - open_local_daemon_transport / send_local_daemon_transport_message /
//     close_local_daemon_transport
//
// These were Electron main-process helpers tied to Node APIs. Reimplementing
// them in Rust is real work and not required for first-time UI bring-up.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct PendingOpenProject(pub Mutex<Option<String>>);

#[tauri::command]
pub fn ottie_get_pending_open_project(state: State<'_, PendingOpenProject>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[derive(Default, Clone)]
pub struct DaemonInfo {
    pub listen: String,
    pub home: String,
}

pub struct DaemonInfoState(pub Mutex<DaemonInfo>);

fn daemon_status_value(info: &DaemonInfo) -> Value {
    json!({
        "serverId": "ottie-desktop",
        "status": "running",
        "listen": info.listen,
        "hostname": "localhost",
        "pid": null,
        "home": info.home,
        "version": null,
        "desktopManaged": true,
        "error": null,
    })
}

// -------------------------- generic invoke -------------------------------
//
// The Electron build dispatched a long list of named commands through one
// `paseo:invoke` channel. We mirror that here so the frontend doesn't need
// to know which calls are "real" vs. stubbed.

#[derive(Serialize)]
pub struct NotImplemented {
    pub error: String,
    #[serde(rename = "tauriPort")]
    pub tauri_port: bool,
}

// `args` is currently informational — every dispatched branch ignores it,
// but keeping it in the signature lets the frontend pass the same payload
// shape Paseo's Electron preload used and lets us read it later without
// rewiring the bridge.
#[tauri::command]
pub fn ottie_invoke<R: Runtime>(
    app: AppHandle<R>,
    command: String,
    #[allow(unused_variables)] args: Option<Value>,
) -> Result<Value, String> {
    let _ = args;
    let info = app
        .try_state::<DaemonInfoState>()
        .map(|s| s.0.lock().unwrap().clone())
        .unwrap_or_default();

    match command.as_str() {
        "desktop_daemon_status"
        | "start_desktop_daemon"
        | "restart_desktop_daemon" => Ok(daemon_status_value(&info)),

        "stop_desktop_daemon" => {
            let mut stopped = info.clone();
            // We never actually stop the sidecar from the UI today (Tauri's
            // ExitRequested handler owns that). Surface "running" so the
            // renderer's status panel doesn't flap to error.
            stopped.listen = info.listen.clone();
            Ok(daemon_status_value(&stopped))
        }

        "desktop_daemon_logs" => Ok(json!({
            "logPath": format!("{}/daemon.log", info.home),
            "contents": "",
        })),

        "desktop_daemon_pairing" => Ok(json!({
            "relayEnabled": false,
            "url": null,
            "qr": null,
        })),

        "get_local_daemon_version" => Ok(json!({ "version": null, "error": null })),
        "cli_daemon_status" => Ok(json!({ "status": "unknown" })),

        // Idle time: Tauri does not expose powerMonitor. Returning 0 is
        // safe — the renderer treats it as "user just acted".
        "desktop_get_system_idle_time" => Ok(json!(0)),

        // Updater / installer surface: park as not implemented.
        "check_app_update"
        | "install_app_update"
        | "install_cli"
        | "get_cli_install_status"
        | "install_skills"
        | "get_skills_install_status"
        | "write_attachment_base64"
        | "copy_attachment_file"
        | "read_file_base64"
        | "delete_attachment_file"
        | "garbage_collect_attachment_files"
        | "open_local_daemon_transport"
        | "send_local_daemon_transport_message"
        | "close_local_daemon_transport" => Ok(serde_json::to_value(NotImplemented {
            error: format!(
                "{} is not implemented in the Tauri shell yet",
                command
            ),
            tauri_port: true,
        })
        .unwrap()),

        other => Err(format!("Unknown desktop command: {other}")),
    }
}

// ------------------------------- dialogs ---------------------------------

#[derive(Deserialize, Default)]
pub struct DialogAskOptions {
    pub title: Option<String>,
    #[serde(rename = "okLabel")]
    pub ok_label: Option<String>,
    #[serde(rename = "cancelLabel")]
    pub cancel_label: Option<String>,
    pub kind: Option<String>,
}

#[tauri::command]
pub async fn ottie_dialog_ask<R: Runtime>(
    app: AppHandle<R>,
    message: String,
    options: Option<DialogAskOptions>,
) -> Result<bool, String> {
    let options = options.unwrap_or_default();
    let kind = match options.kind.as_deref() {
        Some("warning") => MessageDialogKind::Warning,
        Some("error") => MessageDialogKind::Error,
        _ => MessageDialogKind::Info,
    };
    let ok = options.ok_label.unwrap_or_else(|| "OK".into());
    let cancel = options.cancel_label.unwrap_or_else(|| "Cancel".into());
    let title = options.title.unwrap_or_else(|| "Confirm".into());

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    rx.await.map_err(|e| e.to_string())
}

#[derive(Deserialize, Default, Debug)]
pub struct DialogOpenOptions {
    pub title: Option<String>,
    #[serde(rename = "defaultPath")]
    pub default_path: Option<String>,
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub filters: Vec<DialogFilter>,
}

#[derive(Deserialize, Debug)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[tauri::command]
pub async fn ottie_dialog_open<R: Runtime>(
    app: AppHandle<R>,
    options: Option<DialogOpenOptions>,
) -> Result<Value, String> {
    use tauri_plugin_dialog::FilePath;

    let opts = options.unwrap_or_default();
    let mut builder = app.dialog().file();
    if let Some(t) = opts.title {
        builder = builder.set_title(t);
    }
    if let Some(p) = opts.default_path {
        builder = builder.set_directory(p);
    }
    for f in opts.filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(f.name, &exts);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();

    fn first_string(paths: Vec<FilePath>) -> Option<String> {
        paths
            .into_iter()
            .next()
            .map(|p| p.to_string())
    }

    if opts.directory {
        if opts.multiple {
            builder.pick_folders(move |paths| {
                let v = paths
                    .map(|ps| {
                        Value::Array(
                            ps.into_iter()
                                .map(|p| Value::String(p.to_string()))
                                .collect(),
                        )
                    })
                    .unwrap_or(Value::Null);
                let _ = tx.send(v);
            });
        } else {
            builder.pick_folder(move |path| {
                let v = path
                    .map(|p| Value::String(p.to_string()))
                    .unwrap_or(Value::Null);
                let _ = tx.send(v);
            });
        }
    } else if opts.multiple {
        builder.pick_files(move |paths| {
            let v = paths
                .map(|ps| {
                    Value::Array(
                        ps.into_iter()
                            .map(|p| Value::String(p.to_string()))
                            .collect(),
                    )
                })
                .unwrap_or(Value::Null);
            let _ = tx.send(v);
        });
    } else {
        builder.pick_file(move |path| {
            let v = path
                .and_then(|p| Some(Value::String(p.to_string())))
                .unwrap_or(Value::Null);
            let _ = tx.send(v);
        });
    }

    let _ = first_string; // suppress unused warning when arms above don't all use it
    rx.await.map_err(|e| e.to_string())
}

// ----------------------------- notifications -----------------------------

#[tauri::command]
pub fn ottie_notification_is_supported<R: Runtime>(app: AppHandle<R>) -> bool {
    // tauri-plugin-notification works on every desktop target Ottie targets.
    // We could also gate on user permission grant but that requires async.
    let _ = app;
    true
}

#[derive(Deserialize)]
pub struct NotificationSendPayload {
    pub title: String,
    pub body: Option<String>,
    #[allow(dead_code)]
    pub data: Option<Value>,
}

#[tauri::command]
pub fn ottie_notification_send<R: Runtime>(
    app: AppHandle<R>,
    payload: NotificationSendPayload,
) -> Result<bool, String> {
    let mut builder = app.notification().builder().title(&payload.title);
    if let Some(body) = &payload.body {
        builder = builder.body(body);
    }
    builder.show().map_err(|e| e.to_string())?;
    Ok(true)
}

// ------------------------------ opener -----------------------------------

#[tauri::command]
pub fn ottie_opener_open_url<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ------------------------------ menu -------------------------------------

#[derive(Deserialize, Default)]
pub struct ContextMenuInput {
    #[allow(dead_code)]
    pub kind: Option<String>,
    #[serde(rename = "hasSelection", default)]
    #[allow(dead_code)]
    pub has_selection: bool,
}

#[tauri::command]
pub fn ottie_menu_show_context<R: Runtime>(
    app: AppHandle<R>,
    input: Option<ContextMenuInput>,
) -> Result<(), String> {
    let _ = input;
    use tauri::menu::{MenuBuilder, PredefinedMenuItem};

    let win = match focused(&app) {
        Some(w) => w,
        None => return Ok(()),
    };

    let menu = MenuBuilder::new(&app)
        .item(&PredefinedMenuItem::cut(&app, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::copy(&app, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::paste(&app, None).map_err(|e| e.to_string())?)
        .separator()
        .item(&PredefinedMenuItem::select_all(&app, None).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    win.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------ window -----------------------------------

fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_iter()
        .map(|(_, w)| w)
        .next()
}

#[tauri::command]
pub fn ottie_window_toggle_maximize<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let win = focused(&app).ok_or("no window")?;
    let is_max = win.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        win.unmaximize().map_err(|e| e.to_string())?;
    } else {
        win.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn ottie_window_is_fullscreen<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let win = focused(&app).ok_or("no window")?;
    win.is_fullscreen().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct WindowControlsUpdate {
    pub height: Option<f64>,
    #[serde(rename = "backgroundColor")]
    pub background_color: Option<String>,
    #[serde(rename = "foregroundColor")]
    pub foreground_color: Option<String>,
}

#[tauri::command]
pub fn ottie_window_update_controls<R: Runtime>(
    _app: AppHandle<R>,
    update: Option<WindowControlsUpdate>,
) -> Result<(), String> {
    // Electron's Window Controls Overlay is configurable via the `windows`
    // bundle config. Tauri v2 has no programmatic equivalent yet — the
    // overlay style is fixed at window creation. Treat as a soft no-op.
    let _ = update;
    Ok(())
}

#[tauri::command]
pub fn ottie_window_set_badge_count<R: Runtime>(
    app: AppHandle<R>,
    count: Option<i64>,
) -> Result<(), String> {
    set_dock_badge(&app, count);
    Ok(())
}

fn set_dock_badge<R: Runtime>(_app: &AppHandle<R>, count: Option<i64>) {
    // TODO: Tauri v2 AppHandle does not expose a dock-badge API directly.
    // The macOS implementation will need to call AppKit
    // `NSApp.dockTile.badgeLabel = …` via the `objc2-app-kit` crate.
    // Linux has no equivalent; Windows requires drawing an overlay icon
    // through the Taskbar API. Logging the request is enough for now.
    log::debug!("dock badge request (unimplemented): {:?}", count);
}

// ------------------------------ event emit -------------------------------

/// Push a payload to the webview as a DOM CustomEvent named
/// `ottie://<event>`. The bridge.js shim's `listen()` function picks it up.
#[allow(dead_code)]
pub fn emit_to_webview<R: Runtime>(app: &AppHandle<R>, event: &str, payload: &Value) {
    let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "null".into());
    let event_name = format!("ottie://{event}");
    let script = format!(
        "window.dispatchEvent(new CustomEvent({:?}, {{ detail: {} }}));",
        event_name, payload_json
    );
    for (_, win) in app.webview_windows() {
        let _ = win.eval(&script);
    }
    // Also use Tauri's own event bus so listeners using @tauri-apps/api work.
    let _ = app.emit(&event_name, payload.clone());
}
