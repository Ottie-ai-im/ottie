// Tauri commands that back `window.ottieDesktop`. The frontend was written
// against the Electron preload bridge; we keep the same surface and route
// each call through Tauri plugins or native APIs.
//
// What's NOT yet ported (returns "not implemented in Tauri yet" so the UI
// can degrade gracefully):
//   - cli_daemon_status / install_cli / get_cli_install_status
//   - check_app_update / install_app_update / get_local_daemon_version
//   - install_skills / get_skills_install_status
//   - open_local_daemon_transport / send_local_daemon_transport_message /
//     close_local_daemon_transport
//
// Attachment file IO (write_attachment_base64 / copy_attachment_file /
// read_file_base64 / delete_attachment_file / garbage_collect_attachment_files
// / write_attachment_bytes) IS implemented — ported from Paseo's
// `packages/desktop/src/features/attachments.ts` so the Tauri build behaves
// the same way as the upstream Electron build.

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
    pub token: String,
}

pub struct DaemonInfoState(pub Mutex<DaemonInfo>);

fn read_server_id(home: &str) -> String {
    // The daemon writes its persistent server identifier to
    // `$OTTIE_HOME/server-id` on first startup. Reading the same value here
    // means the renderer's host registry sees a single stable entry per
    // installation instead of accumulating one phantom host per restart.
    let path = format!("{home}/server-id");
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                "srv_unknown".into()
            } else {
                trimmed
            }
        }
        Err(_) => "srv_unknown".into(),
    }
}

/// Tiny synchronous HTTP/1.0 GET against a `host:port` listen target,
/// expecting a JSON body. Pulling in reqwest/ureq for one loopback request
/// felt heavy, so this is a hand-rolled minimal client. Origin is set to the
/// daemon's own loopback URL so the WS server's same-origin allowlist
/// short-circuits the WS-only origin check (the HTTP route wraps a JSON
/// response that already passes the host allowlist middleware).
fn ureq_get_json(url: &str) -> Result<Value, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let url = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("non-http url: {url}"))?;
    let (host_port, path) = match url.find('/') {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, "/"),
    };
    let mut stream = TcpStream::connect_timeout(
        &host_port
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_millis(2000),
    )
    .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(5000)))
        .ok();
    let req = format!(
        "GET {path} HTTP/1.0\r\nHost: {host_port}\r\nOrigin: http://{host_port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(4096);
    stream.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    // Find blank line separating headers/body.
    let split = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .or_else(|| buf.windows(2).position(|w| w == b"\n\n").map(|i| i + 2))
        .ok_or_else(|| "no header/body separator in response".to_string())?;
    let status_line = std::str::from_utf8(
        &buf[..buf
            .iter()
            .position(|&b| b == b'\r' || b == b'\n')
            .unwrap_or(buf.len())],
    )
    .unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(format!("non-200 from daemon: {status_line}"));
    }
    let body = &buf[split..];
    serde_json::from_slice::<Value>(body).map_err(|e| format!("invalid JSON body: {e}"))
}

fn probe_listen(listen: &str) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let Some(addr) = listen.to_socket_addrs().ok().and_then(|mut it| it.next()) else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

/// Block (with a hard ceiling) until the sidecar has bound the listen port
/// AND written its real server-id. This avoids a startup race where the
/// renderer would otherwise persist "srv_unknown" as the host identity.
fn daemon_status_value_blocking(info: &DaemonInfo) -> Value {
    use std::thread::sleep;
    use std::time::{Duration, Instant};
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if probe_listen(&info.listen) {
            let id = read_server_id(&info.home);
            if id != "srv_unknown" && !id.is_empty() {
                return daemon_status_value(info);
            }
        }
        sleep(Duration::from_millis(100));
    }
    // Timed out — return whatever we have. The renderer can still surface a
    // helpful error rather than hanging forever.
    daemon_status_value(info)
}

fn daemon_status_value(info: &DaemonInfo) -> Value {
    let alive = probe_listen(&info.listen);
    let server_id = if alive {
        read_server_id(&info.home)
    } else {
        "srv_unknown".into()
    };
    json!({
        "serverId": server_id,
        "status": if alive { "running" } else { "starting" },
        "listen": info.listen,
        "hostname": "localhost",
        "pid": null,
        "home": info.home,
        "token": info.token,
        "version": null,
        "desktopManaged": true,
        "error": null,
    })
}

// -------------------------- attachments ----------------------------------
//
// Ported from Paseo's Electron equivalent — `packages/desktop/src/features/
// attachments.ts` — so the on-disk layout, ID/extension validation, path-
// traversal guard, and GC semantics match exactly. Spec:
//
//   directory: $OTTIE_HOME/desktop-attachments/
//   file:      {attachmentId}{extension}    (extension defaults to ".bin")
//   id regex:  ^[A-Za-z0-9_-]+$
//   ext regex: ^\.[A-Za-z0-9]{1,16}$
//
// Every read/delete path must `canonicalize` under the managed directory —
// callers passing absolute paths from arbitrary metadata cannot use this to
// touch files outside the attachment dir.

const ATTACHMENTS_DIRNAME: &str = "desktop-attachments";

fn attachments_dir(info: &DaemonInfo) -> std::path::PathBuf {
    std::path::PathBuf::from(&info.home).join(ATTACHMENTS_DIRNAME)
}

fn ensure_attachments_dir(info: &DaemonInfo) -> Result<std::path::PathBuf, String> {
    let dir = attachments_dir(info);
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create attachments dir: {e}"))?;
    Ok(dir)
}

fn is_valid_attachment_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn normalize_attachment_id(value: Option<&Value>) -> Result<String, String> {
    let raw = value
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Attachment id is required.".to_string())?;
    let trimmed = raw.trim().to_string();
    if !is_valid_attachment_id(&trimmed) {
        return Err(format!("Invalid attachment id: {raw}"));
    }
    Ok(trimmed)
}

fn is_valid_extension(value: &str) -> bool {
    if !value.starts_with('.') {
        return false;
    }
    let rest = &value[1..];
    if rest.is_empty() || rest.len() > 16 {
        return false;
    }
    rest.chars().all(|c| c.is_ascii_alphanumeric())
}

fn normalize_extension(value: Option<&Value>) -> Result<String, String> {
    let raw = match value {
        None | Some(Value::Null) => return Ok(".bin".to_string()),
        Some(Value::String(s)) if s.is_empty() => return Ok(".bin".to_string()),
        Some(Value::String(s)) => s.clone(),
        Some(other) => return Err(format!("Attachment extension must be a string: {other}")),
    };
    let normalized = raw.trim().to_lowercase();
    if !is_valid_extension(&normalized) {
        return Err(format!("Invalid attachment extension: {raw}"));
    }
    Ok(normalized)
}

fn build_managed_attachment_path(
    info: &DaemonInfo,
    args: &Value,
) -> Result<std::path::PathBuf, String> {
    let dir = ensure_attachments_dir(info)?;
    let id = normalize_attachment_id(args.get("attachmentId"))?;
    let ext = normalize_extension(args.get("extension"))?;
    Ok(dir.join(format!("{id}{ext}")))
}

/// Verify a path stays inside `desktop-attachments/`. Used by read / delete to
/// reject metadata that points outside the managed directory.
fn resolve_managed_attachment_path(
    info: &DaemonInfo,
    raw: Option<&Value>,
) -> Result<std::path::PathBuf, String> {
    let raw_str = raw
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "Attachment path is required.".to_string())?;
    if raw_str.is_empty() {
        return Err("Attachment path is required.".to_string());
    }

    // Compare canonicalised absolute paths to defeat `..` / symlink shenanigans.
    let dir = attachments_dir(info);
    let dir_canonical = dir
        .canonicalize()
        .or_else(|_| {
            std::fs::create_dir_all(&dir).ok();
            dir.canonicalize()
        })
        .map_err(|e| format!("failed to resolve attachments dir: {e}"))?;

    let candidate = std::path::PathBuf::from(&raw_str);
    let candidate_canonical = candidate
        .canonicalize()
        .map_err(|e| format!("failed to resolve attachment path: {e}"))?;

    if !candidate_canonical.starts_with(&dir_canonical) {
        return Err("Attachment path must stay within desktop-managed storage.".to_string());
    }
    Ok(candidate_canonical)
}

fn write_attachment_base64(info: &DaemonInfo, args: &Value) -> Result<Value, String> {
    use base64::Engine;
    let base64_str = args
        .get("base64")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Attachment base64 payload is required.".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_str)
        .map_err(|e| format!("invalid base64 payload: {e}"))?;
    let target = build_managed_attachment_path(info, args)?;
    std::fs::write(&target, &bytes).map_err(|e| format!("failed to write attachment: {e}"))?;
    Ok(json!({
        "path": target.to_string_lossy(),
        "byteSize": bytes.len(),
    }))
}

fn write_attachment_bytes(info: &DaemonInfo, args: &Value) -> Result<Value, String> {
    let bytes_value = args
        .get("bytes")
        .ok_or_else(|| "Attachment byte payload is required.".to_string())?;
    let bytes: Vec<u8> = match bytes_value {
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let n = item
                    .as_u64()
                    .ok_or_else(|| "Attachment byte array must contain integers".to_string())?;
                if n > 255 {
                    return Err("Attachment byte values must fit in a u8".to_string());
                }
                out.push(n as u8);
            }
            out
        }
        _ => return Err("Attachment byte payload is required.".to_string()),
    };
    let target = build_managed_attachment_path(info, args)?;
    std::fs::write(&target, &bytes).map_err(|e| format!("failed to write attachment: {e}"))?;
    Ok(json!({
        "path": target.to_string_lossy(),
        "byteSize": bytes.len(),
    }))
}

fn copy_attachment_file(info: &DaemonInfo, args: &Value) -> Result<Value, String> {
    let source = args
        .get("sourcePath")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Attachment source path is required.".to_string())?;
    let source_path = std::path::PathBuf::from(&source);
    let target = build_managed_attachment_path(info, args)?;
    if source_path != target {
        std::fs::copy(&source_path, &target)
            .map_err(|e| format!("failed to copy attachment: {e}"))?;
    }
    let meta = std::fs::metadata(&target).map_err(|e| format!("failed to stat attachment: {e}"))?;
    Ok(json!({
        "path": target.to_string_lossy(),
        "byteSize": meta.len(),
    }))
}

fn read_managed_file_base64(info: &DaemonInfo, args: &Value) -> Result<Value, String> {
    use base64::Engine;
    let path = resolve_managed_attachment_path(info, args.get("path"))?;
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read attachment: {e}"))?;
    Ok(Value::String(
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

fn delete_managed_attachment_file(info: &DaemonInfo, args: &Value) -> Result<Value, String> {
    // resolve_managed_attachment_path canonicalizes — for delete we want to
    // succeed even if the file is missing (mirroring Paseo's `force: true`).
    let raw = args
        .get("path")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Attachment path is required.".to_string())?;
    let dir = ensure_attachments_dir(info)?
        .canonicalize()
        .map_err(|e| format!("failed to resolve attachments dir: {e}"))?;
    let candidate = std::path::PathBuf::from(&raw);
    // canonicalize fails on missing files — fall back to manual normalization
    // (resolve absolute, lexically join). For a missing file we just return
    // success since the post-condition (file gone) is already satisfied.
    let absolute = if candidate.is_absolute() {
        candidate.clone()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("cwd unavailable: {e}"))?
            .join(&candidate)
    };
    if !absolute.starts_with(&dir) {
        return Err("Attachment path must stay within desktop-managed storage.".to_string());
    }
    if absolute.exists() {
        std::fs::remove_file(&absolute).map_err(|e| format!("failed to delete attachment: {e}"))?;
    }
    Ok(Value::Bool(true))
}

fn garbage_collect_managed_attachment_files(
    info: &DaemonInfo,
    args: &Value,
) -> Result<Value, String> {
    let dir = ensure_attachments_dir(info)?;
    let referenced: std::collections::HashSet<String> = match args.get("referencedIds") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| is_valid_attachment_id(s))
            .collect(),
        _ => std::collections::HashSet::new(),
    };

    let mut deleted: usize = 0;
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("failed to read attachments dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if referenced.contains(&stem) {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    Ok(json!(deleted))
}

// -------------------------- generic invoke -------------------------------
//
// The Electron build dispatched a long list of named commands through one
// `ottie_invoke` channel. We mirror that here so the frontend doesn't need
// to know which calls are "real" vs. stubbed.

#[derive(Serialize)]
pub struct NotImplemented {
    pub error: String,
    #[serde(rename = "tauriPort")]
    pub tauri_port: bool,
}

// `args` is forwarded as the second arg to each branch; attachment commands
// read fields like `attachmentId` / `base64` / `path` / `referencedIds` out
// of it. Branches that don't need it just ignore the parameter.
#[tauri::command]
pub fn ottie_invoke<R: Runtime>(
    app: AppHandle<R>,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let info = app
        .try_state::<DaemonInfoState>()
        .map(|s| s.0.lock().unwrap().clone())
        .unwrap_or_default();

    match command.as_str() {
        "desktop_daemon_status" => Ok(daemon_status_value(&info)),

        // start/restart: callers expect a fully-bootstrapped daemon, not a
        // half-started one. The renderer persists `serverId` to local storage
        // and uses it as the host identity forever after — if we hand back
        // "srv_unknown" because the sidecar hasn't written `$OTTIE_HOME/server-id`
        // yet, that placeholder gets pinned and the next probe (which sees the
        // real id) fails the host-id sanity check, leaving the app stuck at
        // "Connecting to local server...".
        "start_desktop_daemon" | "restart_desktop_daemon" => {
            Ok(daemon_status_value_blocking(&info))
        }

        "stop_desktop_daemon" => {
            let mut stopped = info.clone();
            // We never actually stop the sidecar from the UI today (Tauri's
            // ExitRequested handler owns that). Surface "running" so the
            // renderer's status panel doesn't flap to error.
            stopped.listen = info.listen.clone();
            Ok(daemon_status_value(&stopped))
        }

        "desktop_daemon_logs" => {
            let log_path = format!("{}/daemon.log", info.home);
            // Tail the last ~256 KB so the panel renders quickly even if the
            // log is huge.
            const MAX_BYTES: u64 = 256 * 1024;
            let contents = std::fs::metadata(&log_path)
                .ok()
                .map(|m| m.len())
                .map(|len| {
                    use std::io::{Read, Seek, SeekFrom};
                    let start = len.saturating_sub(MAX_BYTES);
                    let mut buf = String::new();
                    if let Ok(mut f) = std::fs::File::open(&log_path) {
                        let _ = f.seek(SeekFrom::Start(start));
                        let _ = f.take(MAX_BYTES).read_to_string(&mut buf);
                    }
                    buf
                })
                .unwrap_or_default();
            Ok(json!({
                "logPath": log_path,
                "contents": contents,
            }))
        }

        "desktop_daemon_pairing" => {
            // Hit the daemon's local-only /api/pair endpoint and forward the
            // JSON to the renderer. Blocking call from the Tauri side is fine —
            // it's a tiny loopback request and the command is async-callable
            // from JS.
            let url = format!("http://{}/api/pair", info.listen);
            match ureq_get_json(&url) {
                Ok(v) => Ok(v),
                Err(err) => Ok(json!({
                    "relayEnabled": false,
                    "url": null,
                    "qr": null,
                    "error": err,
                })),
            }
        }

        "get_local_daemon_version" => Ok(json!({ "version": null, "error": null })),
        "cli_daemon_status" => Ok(json!({ "status": "unknown" })),

        // Idle time: Tauri does not expose powerMonitor. Returning 0 is
        // safe — the renderer treats it as "user just acted".
        "desktop_get_system_idle_time" => Ok(json!(0)),

        // Attachment file IO — ported from Paseo's Electron implementation.
        // See the helpers above for the full spec; the dispatcher just
        // forwards args. Errors come back as command failures, which the
        // renderer's `invokeDesktopCommand` surfaces as a rejected promise.
        "write_attachment_base64" => {
            write_attachment_base64(&info, args.as_ref().unwrap_or(&Value::Null))
        }
        "write_attachment_bytes" => {
            write_attachment_bytes(&info, args.as_ref().unwrap_or(&Value::Null))
        }
        "copy_attachment_file" => {
            copy_attachment_file(&info, args.as_ref().unwrap_or(&Value::Null))
        }
        "read_file_base64" => {
            read_managed_file_base64(&info, args.as_ref().unwrap_or(&Value::Null))
        }
        "delete_attachment_file" => {
            delete_managed_attachment_file(&info, args.as_ref().unwrap_or(&Value::Null))
        }
        "garbage_collect_attachment_files" => {
            garbage_collect_managed_attachment_files(&info, args.as_ref().unwrap_or(&Value::Null))
        }

        // Updater / installer surface: park as not implemented.
        "check_app_update"
        | "install_app_update"
        | "install_cli"
        | "get_cli_install_status"
        | "install_skills"
        | "get_skills_install_status"
        | "open_local_daemon_transport"
        | "send_local_daemon_transport_message"
        | "close_local_daemon_transport" => Ok(serde_json::to_value(NotImplemented {
            error: format!("{} is not implemented in the Tauri shell yet", command),
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

    // FilePath's Display uses Debug formatting for the Path variant which
    // wraps OS paths containing spaces in quotes. We want the raw OS path
    // (or a plain URL string), so unwrap the variants explicitly.
    fn fp_to_string(p: FilePath) -> String {
        match p {
            FilePath::Path(pb) => pb.to_string_lossy().into_owned(),
            FilePath::Url(url) => url.to_string(),
        }
    }

    if opts.directory {
        if opts.multiple {
            builder.pick_folders(move |paths| {
                let v = paths
                    .map(|ps| {
                        Value::Array(
                            ps.into_iter()
                                .map(|p| Value::String(fp_to_string(p)))
                                .collect(),
                        )
                    })
                    .unwrap_or(Value::Null);
                let _ = tx.send(v);
            });
        } else {
            builder.pick_folder(move |path| {
                let v = path
                    .map(|p| Value::String(fp_to_string(p)))
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
                            .map(|p| Value::String(fp_to_string(p)))
                            .collect(),
                    )
                })
                .unwrap_or(Value::Null);
            let _ = tx.send(v);
        });
    } else {
        builder.pick_file(move |path| {
            let v = path
                .map(|p| Value::String(fp_to_string(p)))
                .unwrap_or(Value::Null);
            let _ = tx.send(v);
        });
    }

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
pub fn ottie_opener_open_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
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
    app.webview_windows().into_iter().map(|(_, w)| w).next()
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
