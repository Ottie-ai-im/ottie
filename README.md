# Ottie

Local-first IM client where AI agents are first-class members.

Ottie bridges external IM platforms and lets AI agents participate in conversations as room members alongside humans. The local daemon handles agent orchestration, pairing, and multi-client sync; clients (desktop, mobile, web, CLI) connect to it.

Repo: https://github.com/Wendell-Guan/ottie

> **Heads up about `claws.company`.** Out of the box, the daemon connects to the
> maintainer's personal Cloudflare Worker at `relay.claws.company` and points
> pairing URLs at `app.claws.company`. This is a single-maintainer side-project
> instance — not a hosted SaaS. Anyone serious about privacy or uptime should
> self-host the relay (`packages/relay`, one `wrangler deploy` away) and override
> the defaults via `OTTIE_RELAY_ENDPOINT` / `OTTIE_APP_URL` env vars or
> `~/.ottie/config.json`. Source defaults live in
> [`packages/server/src/server/config.ts`](packages/server/src/server/config.ts).

---

## Table of contents

- [Prerequisites (macOS)](#prerequisites-macos)
- [Get the source](#get-the-source)
- [Install dependencies](#install-dependencies)
- [Run in dev mode](#run-in-dev-mode)
- [Install on your Mac (production-style local install)](#install-on-your-mac-production-style-local-install)
- [iOS — install on your iPhone](#ios--install-on-your-iphone)
- [CLI](#cli)
- [Push your changes back to GitHub](#push-your-changes-back-to-github)
- [Repository map](#repository-map)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites (macOS)

Install once. Skip a tool if you already have it.

```bash
# Homebrew (skip if already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node 20+, pnpm, Rust toolchain (for Tauri), Xcode CLT (for iOS / native build)
brew install node pnpm rustup-init
rustup-init -y
xcode-select --install   # may already be installed

# Tauri requires the Xcode toolchain to be selected. Run once, then accept the EULA.
sudo xcodebuild -license accept

# (Optional) iOS device signing requires the full Xcode app from the App Store.
# Open Xcode once after install so it can finalize component download.
```

Confirm versions:

```bash
node -v        # v20+
pnpm -v        # 9.x
rustc --version
```

## Get the source

The whole monorepo lives at `~/Downloads/ottie-workspace/ottie` on this machine. To clone fresh somewhere else:

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/Wendell-Guan/ottie.git
cd ottie
```

All commands below assume you are inside the **repo root** (the directory that contains `package.json`, `packages/`, `scripts/`).

## Install dependencies

```bash
cd ~/Downloads/ottie-workspace/ottie     # or wherever you cloned
pnpm install
```

This installs every workspace package (server, app, cli, desktop, relay, website) in one go. Re-run after pulling new commits.

## Run in dev mode

The daemon, desktop shell, and Expo bundler all start with one command.

```bash
# Run from the repo root
cd ~/Downloads/ottie-workspace/ottie

# Desktop (Tauri) — auto-starts the daemon sidecar and the Expo web bundle
pnpm dev:desktop
```

Or run pieces individually:

```bash
pnpm dev:server   # daemon only (port 6868)
pnpm dev:app      # Expo Metro bundler (web + native)
pnpm dev          # daemon + Expo together in tmux
```

Stop everything:

```bash
pkill -9 -f "ottie-desktop|server.mjs|expo|metro"
rm -f ~/.ottie/ottie.pid
```

## Install on your Mac (production-style local install)

This builds an actual `.app` bundle and copies it to `/Applications`, so you can launch Ottie from Spotlight without keeping a terminal open.

```bash
# 1. Run from the repo root
cd ~/Downloads/ottie-workspace/ottie

# 2. Build the daemon sidecar binary (Node + bundled JS + native modules)
pnpm build:sidecar

# 3. Build the desktop app for release
pnpm build:desktop
```

The signed `.app` lands at:

```
packages/desktop/src-tauri/target/release/bundle/macos/Ottie.app
```

Install it system-wide:

```bash
# Move into /Applications so Spotlight picks it up
cp -R packages/desktop/src-tauri/target/release/bundle/macos/Ottie.app /Applications/

# (Optional) on first launch macOS Gatekeeper may complain because the build
# is locally signed. Right-click → Open, or run:
xattr -dr com.apple.quarantine /Applications/Ottie.app
```

Now you can launch Ottie from Spotlight (`⌘ Space` → "Ottie"). The daemon is started automatically by the Tauri shell as a sidecar — **no terminal required.**

To uninstall: drag `/Applications/Ottie.app` to Trash and `rm -rf ~/.ottie`.

### Producing a `.dmg` for sharing

`pnpm build:desktop` also writes a DMG to:

```
packages/desktop/src-tauri/target/release/bundle/dmg/Ottie_<version>_aarch64.dmg
```

Drag-install on any Apple Silicon Mac.

## iOS — install on your iPhone

For dogfooding on a real device. Run from the repo root.

```bash
cd ~/Downloads/ottie-workspace/ottie/packages/app

# Generate native iOS project (re-run after editing app.config.js)
npx expo prebuild --platform ios --clean

# Build, sign, and install onto your connected iPhone
npx expo run:ios --device
```

Pick your phone in the prompt; Xcode auto-signs with your Apple ID.

For a true standalone install (no Metro / no terminal):

```bash
npx expo run:ios --device --configuration Release
```

The Release build embeds the JS bundle, so the app runs offline from your home Wi-Fi and connects to your Mac's daemon via the Ottie relay (`relay.claws.company`) or local network.

> Free Apple ID signing expires every 7 days; re-run the command to renew. A paid Apple Developer account ($99/yr) extends this to 1 year.

## CLI

The `ottie` CLI talks to your local daemon. Install globally:

```bash
# From the repo root
cd ~/Downloads/ottie-workspace/ottie
pnpm --filter @ottie/cli build
pnpm --filter @ottie/cli exec npm link

# now `ottie` is on your PATH
ottie ls
ottie attach <id>
ottie send <id> "follow-up"
ottie daemon status
```

To uninstall: `pnpm --filter @ottie/cli exec npm unlink -g`.

## Push your changes back to GitHub

The repo is configured to push to `https://github.com/Wendell-Guan/ottie`.

```bash
# From the repo root
cd ~/Downloads/ottie-workspace/ottie

# 1. See what changed
git status

# 2. Stage everything you want to commit (avoid 'git add -A' if there are
#    secrets or large built artifacts in the working tree)
git add packages/app/src/components/composer.tsx README.md

# 3. Commit
git commit -m "feat(ui): two-level + menu on mobile"

# 4. Push to GitHub (first time on a new branch use -u)
git push                    # if branch already tracks origin
# or
git push -u origin main     # first push of a new local branch
```

If you hit GitHub Push Protection complaining about secrets in build artifacts:

```bash
# Untrack the build output (already in .gitignore but cached locally)
git rm -r --cached packages/desktop/src-tauri/binaries/resources \
                   packages/desktop/src-tauri/binaries/ottie-daemon-*
git commit -m "chore: stop tracking sidecar build artifacts"
git push
```

To pull updates from GitHub later:

```bash
git pull
pnpm install   # in case dependencies changed
```

## Repository map

- `packages/server` — daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Expo client (iOS, Android, web)
- `packages/cli` — `ottie` CLI
- `packages/desktop` — Tauri v2 desktop shell
- `packages/relay` — E2E encrypted relay for remote access (deployed to `relay.claws.company`)
- `packages/website` — Marketing site

## Troubleshooting

**`pnpm dev:desktop` fails with "Unable to resolve expo-document-picker"**
The hook is platform-split into `.web.ts` / `.native.ts`. Ensure `packages/app/src/hooks/use-file-attachment-picker.ts` (the type barrel) exists. Re-run `pnpm install` if it's missing.

**Tauri build fails on macOS with "tool xcrun requires Xcode"**
Run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` and `sudo xcodebuild -license accept`.

**iOS run crashes with `NSLocation*UsageDescription` missing**
Re-run `npx expo prebuild --platform ios --clean` so the new Info.plist keys in `app.config.js` get baked into the native project.

**Port 6868 already in use**
Another daemon is running. Stop it: `pkill -9 -f "ottie-desktop|server.mjs"` then `rm -f ~/.ottie/ottie.pid`.

**GitHub push rejected with "secret detected"**
Build artifacts under `packages/desktop/src-tauri/binaries/` got staged. They're now in `.gitignore`; run the `git rm --cached` snippet from the [push section](#push-your-changes-back-to-github).

## License

AGPL-3.0. See [LICENSE](LICENSE).
