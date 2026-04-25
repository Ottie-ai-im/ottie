// Daemon sidecar supervisor.
//
// Tauri v2 ships sidecars declared in `tauri.conf.json#bundle.externalBin`.
// At dev time the binary must exist at `binaries/ottie-daemon-<target-triple>` —
// see https://v2.tauri.app/develop/sidecar/.

use std::io;
use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct DaemonHandle {
    child: CommandChild,
}

impl DaemonHandle {
    pub fn shutdown(self) -> io::Result<()> {
        let pid = self.child.pid();
        if let Err(err) = self.child.kill() {
            return Err(io::Error::new(io::ErrorKind::Other, err.to_string()));
        }
        // Best-effort: wait briefly for the child to exit. CommandChild does not
        // expose a wait API, so we just sleep so the OS has time to reap it.
        std::thread::sleep(Duration::from_millis(500));
        log::info!("daemon sidecar killed (pid={pid})");
        Ok(())
    }
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<DaemonHandle, String> {
    // In dev, Tauri copies the externalBin into target/<profile>/, so the
    // wrapper's siblings are not the staged resources/. Pin the resources
    // directory at compile time to the source layout. For bundled builds this
    // path will not exist, and the wrapper's relative-path search will take
    // over.
    let dev_resources_dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/binaries/resources",
    );

    // Origins the renderer can connect from. In dev the renderer is served
    // by Expo at http://localhost:8081; in packaged builds Tauri's webview
    // uses tauri://localhost on macOS / Linux and http://tauri.localhost on
    // Windows. Same-origin (loopback to the daemon's own host:port) is
    // always allowed by the WS server.
    let cors_origins = "http://localhost:8081,tauri://localhost,http://tauri.localhost";

    let sidecar = app
        .shell()
        .sidecar("ottie-daemon")
        .map_err(|e| format!("failed to resolve ottie-daemon sidecar: {e}"))?
        .env("OTTIE_DESKTOP_MANAGED", "1")
        .env("OTTIE_DAEMON_RESOURCES_DIR", dev_resources_dir)
        .env("OTTIE_CORS_ORIGINS", cors_origins);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("failed to spawn ottie-daemon: {e}"))?;

    log::info!("daemon sidecar spawned (pid={})", child.pid());

    // Forward daemon stdout/stderr to the host log so users can see what the
    // daemon is doing. Without this the sidecar's output is silently discarded.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[daemon] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[daemon] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    log::error!("[daemon] error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[daemon] terminated: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(DaemonHandle { child })
}
