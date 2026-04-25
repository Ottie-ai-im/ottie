// Ottie Tauri v2 desktop shell.
//
// Ports the responsibilities of the previous Electron main process:
//   - Supervise the daemon sidecar (start at launch, stop at exit).
//   - Open a single main window pointing at the Expo web build.
//   - Single-instance lock so a second launch focuses the existing window.
//
// Items not yet ported (need product decisions or platform-specific work):
//   - TODO: custom URL scheme handler (Electron used a custom app:// scheme); Tauri v2
//     serves `frontendDist` natively, but deep-link routing must be reimplemented
//     via the `tauri-plugin-deep-link` plugin if needed.
//   - TODO: CLI passthrough (`runCliPassthroughIfRequested`) — invoking the
//     packaged binary as a CLI; Tauri does not provide this out of the box.
//   - TODO: macOS dock badge, dock icon override, native context menu, drag/drop
//     prevention, react-devtools auto-load.
//   - TODO: open-project IPC (`ipcMain.handle("ottie:get-pending-open-project")`)
//     must be reimplemented as a Tauri command if the renderer still needs it.
//   - TODO: dev-worktree userData isolation (env override /
//     git worktree detection) — port to Tauri's `path` resolver if still wanted.
//   - TODO: notifications, dialogs, shell openers, application menu — use the
//     corresponding Tauri v2 plugins (`tauri-plugin-notification`,
//     `tauri-plugin-dialog`, `tauri-plugin-shell`).

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod daemon;

use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct AppState {
    daemon: Mutex<Option<daemon::DaemonHandle>>,
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
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
                    log::error!("failed to spawn daemon sidecar: {err}");
                    // TODO: surface a user-visible error dialog instead of just logging.
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                if let Some(handle) = state.daemon.lock().unwrap().take() {
                    if let Err(err) = handle.shutdown() {
                        log::warn!("daemon shutdown error: {err}");
                    }
                }
            }
        });
}
