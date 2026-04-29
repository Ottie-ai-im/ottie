// Ottie Tauri v2 desktop shell.
//
// Functional parity with the previous Electron main process: supervises the
// daemon sidecar, exposes the `window.ottieDesktop` IPC surface, restores
// the application menu, isolates per-worktree user data in dev, and so on.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod bridge;
mod daemon;

use std::env;
use std::path::PathBuf;
use std::sync::Mutex;

use sha2::{Digest, Sha256};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Manager, RunEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;

/// Apply the platform-native window backdrop so the window background reads
/// as macOS 26 "Liquid Glass" / Windows acrylic. Called from `setup`.
fn apply_window_backdrop(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // HudWindow gives the strongest, most uniform blur and matches the
        // macOS 26 default for floating panels. State::Active keeps the
        // material lit even when the window is unfocused so the chrome
        // doesn't dim out behind us.
        if let Err(err) = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            None,
        ) {
            log::warn!("apply_vibrancy failed: {err}");
        }
    }
    #[cfg(target_os = "windows")]
    {
        // Use translucent acrylic on Windows 11. This is a no-op on older
        // Windows versions where acrylic isn't supported.
        if let Err(err) = apply_acrylic(window, Some((18, 18, 18, 125))) {
            log::warn!("apply_acrylic failed: {err}");
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // No-op on Linux — the window stays transparent and the renderer
        // covers it with its own surface.
        let _ = window;
    }
}

const BRIDGE_JS: &str = include_str!("../bridge.js");

struct AppState {
    daemon: Mutex<Option<daemon::DaemonHandle>>,
}

fn main() {
    env_logger::init();

    // Honour the same env override the Electron build used in dev for
    // worktree isolation. If unset, derive a stable suffix from the
    // current git checkout's worktree (only when the git CLI is available).
    apply_worktree_user_data_isolation();

    let initial_open_project = parse_open_project_path_from_argv(env::args().collect());

    // Inject the Electron-style bridge surface into every webview, plus the
    // platform string the bridge exposes synchronously.
    let init_script = format!(
        "window.__OTTIE_PLATFORM__ = {:?};\n{}",
        platform_label(),
        BRIDGE_JS
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            bridge::ottie_invoke,
            bridge::ottie_get_pending_open_project,
            bridge::ottie_dialog_ask,
            bridge::ottie_dialog_open,
            bridge::ottie_notification_is_supported,
            bridge::ottie_notification_send,
            bridge::ottie_opener_open_url,
            bridge::ottie_menu_show_context,
            bridge::ottie_window_toggle_maximize,
            bridge::ottie_window_is_fullscreen,
            bridge::ottie_window_update_controls,
            bridge::ottie_window_set_badge_count,
        ])
        .manage(AppState { daemon: Mutex::new(None) })
        .manage(bridge::PendingOpenProject(Mutex::new(initial_open_project)))
        .manage(bridge::DaemonInfoState(Mutex::new(bridge::DaemonInfo {
            listen: env::var("OTTIE_LISTEN").unwrap_or_else(|_| "127.0.0.1:6868".into()),
            home: env::var("OTTIE_HOME").unwrap_or_else(|_| {
                env::var("HOME")
                    .map(|h| format!("{h}/.ottie"))
                    .unwrap_or_else(|_| ".ottie".into())
            }),
        })))
        .setup(move |app| {
            // Apply the bridge init script to every existing webview. New
            // ones inherit it via WebviewWindowBuilder::initialization_script
            // when added programmatically (we don't do that today).
            for (_, window) in app.webview_windows() {
                let _ = window.eval(&init_script);
                apply_window_backdrop(&window);
            }
            install_application_menu(&app.handle())?;
            wire_window_events(app);

            // Open devtools automatically in dev so the renderer console is
            // available without a manual "Toggle Developer Tools" click.
            #[cfg(debug_assertions)]
            for (_, win) in app.webview_windows() {
                win.open_devtools();
            }

            let handle = app.handle().clone();
            match daemon::spawn(&handle) {
                Ok(child) => {
                    let state = app.state::<AppState>();
                    *state.daemon.lock().unwrap() = Some(child);
                }
                Err(err) => {
                    log::error!("daemon sidecar failed to start: {err}");
                    handle
                        .dialog()
                        .message(format!(
                            "Daemon failed to start.\n\n{err}\n\nThe app will open without a daemon."
                        ))
                        .kind(MessageDialogKind::Error)
                        .title("Ottie")
                        .blocking_show();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                let handle = state.daemon.lock().unwrap().take();
                if let Some(handle) = handle {
                    if let Err(err) = handle.shutdown() {
                        log::warn!("daemon shutdown error: {err}");
                    }
                }
            }
        });
}

// --------------------- application menu (parity Electron) ----------------

fn install_application_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<()> {
    let app_name = "Ottie";
    let mut builder = MenuBuilder::new(app);

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, app_name)
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let zoom_in = MenuItemBuilder::with_id("view.zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+Plus")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("view.zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("view.zoom_reset", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let toggle_devtools = MenuItemBuilder::with_id("view.devtools", "Toggle Developer Tools")
        .accelerator(if cfg!(target_os = "macos") {
            "Cmd+Alt+I"
        } else {
            "Ctrl+Shift+I"
        })
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .fullscreen()
        .separator()
        .item(&toggle_devtools)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .close_window()
        .build()?;

    let menu = builder
        .item(&edit)
        .item(&view)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "view.zoom_in" | "view.zoom_out" | "view.zoom_reset" => {
            // Zoom is handled by the webview itself via accelerators; no-op
            // here would suffice. We could also call window.set_zoom() but
            // that requires per-window state.
            log::debug!("zoom menu: {}", event.id().as_ref());
        }
        "view.devtools" => {
            #[cfg(debug_assertions)]
            for (_, w) in app.webview_windows() {
                if w.is_devtools_open() {
                    w.close_devtools();
                } else {
                    w.open_devtools();
                }
            }
            #[cfg(not(debug_assertions))]
            { let _ = app; }
        }
        _ => {}
    });
    Ok(())
}

// --------------------- window resize / drag-drop events -------------------

fn wire_window_events<R: tauri::Runtime>(app: &mut tauri::App<R>) {
    let app_handle = app.handle().clone();
    for (_, win) in app.webview_windows() {
        let h = app_handle.clone();
        win.on_window_event(move |event| match event {
            tauri::WindowEvent::Resized(size) => {
                let payload = serde_json::json!({
                    "width": size.width,
                    "height": size.height,
                });
                bridge::emit_to_webview(&h, "window-resized", &payload);
            }
            tauri::WindowEvent::DragDrop(drop) => {
                let payload = match drop {
                    tauri::DragDropEvent::Enter { paths, position } => serde_json::json!({
                        "type": "enter",
                        "paths": paths,
                        "x": position.x,
                        "y": position.y,
                    }),
                    tauri::DragDropEvent::Drop { paths, position } => serde_json::json!({
                        "type": "drop",
                        "paths": paths,
                        "x": position.x,
                        "y": position.y,
                    }),
                    tauri::DragDropEvent::Over { position } => serde_json::json!({
                        "type": "over",
                        "x": position.x,
                        "y": position.y,
                    }),
                    tauri::DragDropEvent::Leave => serde_json::json!({ "type": "leave" }),
                    _ => return,
                };
                bridge::emit_to_webview(&h, "drag-drop", &payload);
            }
            _ => {}
        });
    }
}

// ----------------------- worktree-isolated user data ---------------------

fn apply_worktree_user_data_isolation() {
    if env::var("OTTIE_DESKTOP_USER_DATA_DIR").is_ok() {
        return;
    }
    if !is_dev_mode() {
        return;
    }
    let Some(suffix) = derive_worktree_suffix() else {
        return;
    };
    let base = match dirs_data_dir() {
        Some(p) => p,
        None => return,
    };
    let dir = base.join(format!("Ottie-{suffix}"));
    if std::fs::create_dir_all(&dir).is_ok() {
        env::set_var("OTTIE_DESKTOP_USER_DATA_DIR", &dir);
        log::info!(
            "[worktree] isolated user data dir: {}",
            dir.display()
        );
    }
}

fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

fn derive_worktree_suffix() -> Option<String> {
    use std::process::Command;
    let toplevel = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()?;
    if !toplevel.status.success() {
        return None;
    }
    let toplevel = String::from_utf8(toplevel.stdout).ok()?.trim().to_string();
    if toplevel.is_empty() {
        return None;
    }
    let common = Command::new("git")
        .args(["rev-parse", "--git-common-dir"])
        .current_dir(&toplevel)
        .output()
        .ok()?;
    let common = String::from_utf8(common.stdout).ok()?.trim().to_string();
    let dot_git = PathBuf::from(&toplevel).join(".git");
    let common_real = if PathBuf::from(&common).is_absolute() {
        PathBuf::from(common)
    } else {
        PathBuf::from(&toplevel).join(common)
    };
    if dot_git == common_real {
        return None; // main checkout, no isolation
    }
    let basename = PathBuf::from(&toplevel)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "worktree".into());
    let mut hasher = Sha256::new();
    hasher.update(toplevel.as_bytes());
    let hash = hex::encode(hasher.finalize());
    Some(format!("{basename}-{}", &hash[..8]))
}

fn dirs_data_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        env::var_os("APPDATA").map(PathBuf::from)
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }
}

// ----------------------- open-project URL parsing -----------------------

fn parse_open_project_path_from_argv(argv: Vec<String>) -> Option<String> {
    // Accept either an explicit deep link URL or a positional path argument:
    // either a custom URL (`ottie://open-project/<path>`) or a positional
    // path argument that points at an existing directory.
    for arg in argv.iter().skip(1) {
        if let Some(rest) = arg.strip_prefix("ottie://open-project/") {
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
        if PathBuf::from(arg).is_dir() {
            return Some(arg.clone());
        }
    }
    None
}

fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}
