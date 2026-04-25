// Ottie Tauri v2 desktop shell.
//
// Ports the responsibilities of the previous Electron main process:
//   - Supervise the daemon sidecar (start at launch, stop at exit).
//   - Open a single main window pointing at the Expo build.
//
// Items not yet ported (need product decisions or platform-specific work):
//   - TODO: custom URL scheme handler (Electron used a custom app:// scheme).
//   - TODO: CLI passthrough (`runCliPassthroughIfRequested`).
//   - TODO: macOS dock badge / native context menu / drag-drop prevention.
//   - TODO: open-project IPC reimplemented as a Tauri command.
//   - TODO: dev-worktree userData isolation.
//   - TODO: notifications, dialogs, shell openers, application menu.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod daemon;

use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct AppState {
    daemon: Mutex<Option<daemon::DaemonHandle>>,
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            daemon: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            match daemon::spawn(&handle) {
                Ok(child) => {
                    let state = app.state::<AppState>();
                    *state.daemon.lock().unwrap() = Some(child);
                }
                Err(err) => {
                    log::error!("daemon sidecar failed to start: {err}");
                    // Surface to the user without blocking the window — the
                    // shell still loads the frontend so they can see the
                    // error and choose what to do.
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
