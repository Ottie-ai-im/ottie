// Daemon sidecar supervisor.
//
// Tauri v2 ships sidecars declared in `tauri.conf.json#bundle.externalBin`.
// At dev time the binary must exist at `binaries/ottie-daemon-<target-triple>` —
// see https://v2.tauri.app/develop/sidecar/.

use std::io;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// ARCH-03 (D-15): write `$OTTIE_HOME/local-token` (mode 0600 on POSIX, default
/// user-profile permissions on Windows) BEFORE spawning the daemon subprocess.
///
/// Idempotent: if the file already exists, leaves it alone (regenerating from
/// here would invalidate paired clients — the user must explicitly regenerate
/// via Settings → Advanced → Local daemon, which goes through the daemon's
/// `LocalTokenService.regenerate()` path).
///
/// The write completes synchronously before this function returns, so `spawn()`
/// can call `ensure_local_token()?` ahead of `.spawn()` and the daemon is
/// guaranteed to see the file on boot. Race is impossible by ordering.
pub fn ensure_local_token() -> Result<String, String> {
    let home = std::env::var("OTTIE_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let mut p = dirs::home_dir().unwrap_or_default();
            p.push(".ottie");
            p
        });
    std::fs::create_dir_all(&home).map_err(|e| format!("create OTTIE_HOME: {e}"))?;
    let token_path = home.join("local-token");
    if token_path.exists() {
        return std::fs::read_to_string(&token_path).map_err(|e| format!("read token: {e}"));
    }
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = URL_SAFE_NO_PAD.encode(buf);
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&token_path)
            .map_err(|e| format!("open token: {e}"))?;
        f.write_all(token.as_bytes())
            .map_err(|e| format!("write token: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        // Windows ACL strategy is a follow-up (Phase 5). For now relies on
        // default user-profile permissions, which limit reads to the same
        // OS user — acceptable for the v1.11 milestone per CONTEXT.md
        // <code_context> Windows ACL note.
        std::fs::write(&token_path, &token).map_err(|e| format!("write token: {e}"))?;
    }
    Ok(token)
}

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

pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<(DaemonHandle, String), String> {
    // ARCH-03 (D-15): write the local-daemon auth token before spawning the
    // daemon. The synchronous write completes before .spawn() returns, so the
    // daemon is guaranteed to see the file on boot. Race-free by ordering.
    let token = ensure_local_token()?;

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
        .env("OTTIE_CORS_ORIGINS", cors_origins);

    // In dev, Tauri copies the externalBin into target/<profile>/, so the
    // wrapper's siblings are not the staged resources/. Pin the resources
    // directory at compile time to the source layout. Gated to debug builds
    // so release packages never leak the build machine's path — that env var
    // would point to a non-existent directory on the user's machine and
    // cause the wrapper's fallback search to behave inconsistently.
    #[cfg(debug_assertions)]
    let sidecar = sidecar.env(
        "OTTIE_DAEMON_RESOURCES_DIR",
        concat!(env!("CARGO_MANIFEST_DIR"), "/binaries/resources"),
    );

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

    Ok((DaemonHandle { child }, token))
}
