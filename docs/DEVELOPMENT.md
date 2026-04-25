# Development Setup

How to go from a fresh checkout to a running Ottie desktop window.

## Prerequisites

| Tool | Min version | Why | Install |
|---|---|---|---|
| Node.js | 20 | runtime for the daemon (in dev AND when the desktop app spawns it), app build, scripts | mise / nvm / brew install node |
| pnpm | 9 | monorepo / workspace manager | `curl -fsSL https://get.pnpm.io/install.sh \| sh -` |
| Rust toolchain | stable | builds the Tauri v2 desktop shell | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

> The daemon is bundled with esbuild and runs on the user's system Node.
> No Bun is required at runtime; we may revisit Node packaging for end-user
> distribution (see "Outstanding work").

### Tauri system dependencies

- **macOS**: Xcode Command Line Tools — `xcode-select --install`
- **Linux** (unverified): WebKitGTK + build essentials. Ubuntu/Debian:
  ```
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
  See https://v2.tauri.app/start/prerequisites/ for the canonical list.
- **Windows** (unverified): WebView2 Runtime + Visual Studio Build Tools with
  C++ workload. See the Tauri prerequisites page above.

> Verified on macOS arm64 (aarch64-apple-darwin). Linux and Windows steps are
> based on Tauri docs but have not been run end-to-end yet.

## First-time Setup

```bash
git clone <repo>
cd ottie

# 1. Install JS dependencies (~1–2 min)
pnpm install

# 2. Pre-build workspace deps that other packages import via dist/
pnpm --filter @ottie/highlight build
pnpm --filter @ottie/relay build

# 3. Bundle the daemon and stage it as the Tauri sidecar (~30 s)
#    Runs esbuild + copies native packages + drops the wrapper into
#    packages/desktop/src-tauri/binaries/.
pnpm build:sidecar

# 4. Start the desktop dev environment
pnpm dev:desktop
```

Step 4 will:
- run `pnpm --filter @ottie/app web` (Expo Metro on `localhost:8081`) via
  Tauri's `beforeDevCommand`,
- wait for `8081` to return 200,
- run `cargo run` to build and launch the desktop shell.

The first run downloads ~400 Rust crates (5–10 min on a fresh machine).
Subsequent runs are incremental and finish in seconds.

## Daily Development

| What you changed | What to do |
|---|---|
| Frontend (`packages/app`) | nothing — Metro hot-reloads automatically |
| Tauri Rust (`packages/desktop/src-tauri`) | nothing — `tauri dev` watches and recompiles |
| Daemon (`packages/server`) | `pnpm build:sidecar`, then restart `pnpm dev:desktop` |
| Other workspace deps (`@ottie/highlight`, `@ottie/relay`) | rebuild that package, then rebuild sidecar if used |

Run repo-wide checks before pushing:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

## Production Build

Not yet verified end-to-end. The intended command is:

```bash
pnpm build:desktop
# = pnpm version:sync-internal && pnpm --filter @ottie/app build:web
#   && pnpm --filter @ottie/desktop build  (= tauri build)
```

## Troubleshooting

### `Failed to read icon ... unexpected end of file`
The icon is empty. Check `packages/desktop/src-tauri/icons/icon.png` — it
must be a real PNG, not zero-byte. The current placeholder is a 32×32
transparent PNG; replace with the real Ottie logo when ready.

### `ERR_PNPM_FETCH_404 @ottie/expo-two-way-audio` on install
pnpm v9 ships with `link-workspace-packages=false`. The repo's `.npmrc`
sets it to `true` — verify the file is intact and re-run `pnpm install`.

### Tauri compile stalls on a single crate
Usually a network issue when fetching the crate from crates.io. Configure a
mirror in `~/.cargo/config.toml` (or a corporate proxy) and re-run.

### `ottie-daemon-wrapper: cannot find resources/server.mjs`
The Tauri sidecar wrapper looked for the bundled daemon next to itself and
its known fallback locations and found nothing. Run `pnpm build:sidecar` to
re-stage the bundle. If the error persists, set
`OTTIE_DAEMON_RESOURCES_DIR` to the absolute path of
`packages/desktop/src-tauri/binaries/resources/`.

### `node: command not found` (from the daemon log)
The wrapper exec's the system `node`. Install Node 20+ and ensure the
shell that launched `pnpm dev:desktop` has it on PATH.

### Daemon binary missing for sidecar
Tauri sidecars are looked up by target triple. Confirm your platform's
files exist:

```bash
rustc -vV | awk '/^host:/ {print $2}'        # e.g. aarch64-apple-darwin
ls packages/desktop/src-tauri/binaries/      # ottie-daemon-<triple> + resources/
```

If missing, run `pnpm build:sidecar`.

### Port 6767 already in use
A previously installed Paseo or Ottie daemon is still listening. Find and
stop it before starting dev:

```bash
lsof -i:6767                                 # find PID
kill -9 <PID>                                # then retry pnpm dev:desktop
```

You can also point the new daemon at an unused port:
`OTTIE_LISTEN=127.0.0.1:6868 pnpm dev:desktop`.

## Outstanding work

- **Stage 2: bundle the Node runtime into the Tauri app**. The current
  pipeline depends on the user's system `node` being on PATH at launch.
  For end-user distribution we need to either ship a Node binary inside
  the app bundle (download from nodejs.org per platform) or switch the
  daemon to a Node SEA build.
- **Tauri `bundle.resources` for production**. `bundle.resources` is not
  enabled yet because in dev mode Tauri evaluates the glob before
  `pnpm build:sidecar` has populated it, which fails the build. For
  packaged builds the `binaries/resources/` tree must be added so the
  daemon JS and native modules ship inside the `.app` / `.msi`.
- **Graceful shutdown via OS signals**. Closing the app window triggers
  Tauri's `RunEvent::ExitRequested` which calls `daemon.shutdown()` and
  cleans up. SIGTERM directly to the shell process bypasses that handler
  and orphans the daemon — install a signal handler if SIGTERM cleanup
  matters in CI.
- **381 MB daemon resources tree** (~321 MB native deps + ~22 MB JS).
  Trim by stripping non-host platform binaries from `onnxruntime-node`,
  `node-pty`, and the sherpa optional packages.
- **Linux and Windows** prerequisites and bundle steps are not verified
  yet.
