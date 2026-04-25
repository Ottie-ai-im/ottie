// Daemon sidecar supervisor.
//
// Tauri v2 ships sidecars declared in `tauri.conf.json#bundle.externalBin`.
// At dev time the binary must exist at `binaries/<name>-<target-triple>` —
// see https://v2.tauri.app/develop/sidecar/.
//
// TODO: the daemon today is a Node entrypoint launched via `spawnProcess`
// from `@ottie/server`. To package it as a single-file sidecar we need a
// build step (e.g. pkg, ncc + node-sea, or bun build --compile). Decide
// during Stage 2.

use std::io;
use tauri::{AppHandle, Runtime};
use tauri::plugin::{TauriPlugin, Builder as PluginBuilder};

#[cfg(feature = "shell")]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

pub struct DaemonHandle {
    #[cfg(feature = "shell")]
    child: CommandChild,
    #[cfg(not(feature = "shell"))]
    _placeholder: (),
}

impl DaemonHandle {
    pub fn shutdown(self) -> io::Result<()> {
        #[cfg(feature = "shell")]
        {
            self.child
                .kill()
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        }
        Ok(())
    }
}

pub fn spawn<R: Runtime>(_app: &AppHandle<R>) -> io::Result<DaemonHandle> {
    // TODO: wire up `tauri-plugin-shell` and call:
    //
    //   let (mut rx, child) = app
    //       .shell()
    //       .sidecar("ottie-daemon")
    //       .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?
    //       .spawn()
    //       .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    //   tauri::async_runtime::spawn(async move {
    //       while let Some(event) = rx.recv().await {
    //           match event {
    //               CommandEvent::Stdout(line) => log::info!("[daemon] {}", String::from_utf8_lossy(&line)),
    //               CommandEvent::Stderr(line) => log::warn!("[daemon] {}", String::from_utf8_lossy(&line)),
    //               _ => {}
    //           }
    //       }
    //   });
    //
    // For now, return a no-op handle so the shell can run without the
    // sidecar binary present.
    log::warn!("daemon sidecar not wired up yet — shell will run without daemon");
    Ok(DaemonHandle {
        #[cfg(feature = "shell")]
        child: unreachable!(),
        #[cfg(not(feature = "shell"))]
        _placeholder: (),
    })
}

#[allow(dead_code)]
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("ottie-daemon").build()
}
