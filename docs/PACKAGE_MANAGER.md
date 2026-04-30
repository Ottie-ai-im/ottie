# Package manager

Ottie uses **pnpm** for development inside the monorepo and **npm** for end-user install commands.

## Internal development → pnpm

All workspace, dev, build, and release scripts run through pnpm. The repo defines `packageManager: pnpm@9.x` in the root `package.json` and a `pnpm-workspace.yaml` lists the package globs.

```bash
pnpm install           # install all workspaces
pnpm dev:desktop       # run desktop shell
pnpm build:sidecar     # build daemon binary for Tauri
pnpm build:web         # build the Expo web bundle
pnpm typecheck
pnpm lint
```

Reasons for pnpm internally:

- mature `workspace:` protocol
- content-addressed store, faster cold installs
- stricter peer-dep resolution catches issues earlier
- pnpm filters (`--filter @ottie/server`) replace `npm --workspace=`

## End-user install → npm

Commands shown in the README and other user-facing docs install the published CLI with **npm**, because that is what most Node users have on their machine by default:

```bash
npm install -g @ottie/cli
```

Do not rewrite these to pnpm. The user is not expected to have pnpm installed.

## Quick rule

| Audience               | Tool | Example                     |
| ---------------------- | ---- | --------------------------- |
| Contributor / dev      | pnpm | `pnpm dev:desktop`          |
| End user (CLI install) | npm  | `npm install -g @ottie/cli` |
