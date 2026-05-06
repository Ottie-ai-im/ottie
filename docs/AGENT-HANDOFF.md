# Agent handoff — read this first

You are Claude Opus 4.7 picking up a long-running collaboration. The
previous you ran out of context. This file is the single source of
truth — everything you need to continue is either here or pointed to
from here.

## TL;DR (read this if nothing else)

- **Project**: ottie — local AI-agent control app (TypeScript + Expo
  RN + Tauri + Node daemon). Working repo: `packages/server`,
  `packages/app`, `packages/relay`, etc. GitHub: `Ottie-ai-im/ottie`.
- **Side-quest in flight**: extend ottie into multi-user collab.
  Design doc: [`docs/MULTI-USER-COLLABORATION-DESIGN.md`](./MULTI-USER-COLLABORATION-DESIGN.md).
- **Current state**: **Phases 1 + 2 fully complete** (identity +
  device-linking + multi-daemon sync + remove device). 192 tests
  green across 20 files. Pushed up through commit `ef63e9a4`.
- **Next phase**: **Phase 3 — friend pairing + 1-to-1 chat**.
  Detailed sub-task breakdown in design doc §17 (Phase 3 section).
- **User**: Wendell. Native Mandarin speaker, talks to you in 中文.
  Wants direct answers + small commits + tests for everything. He
  pushed back hard once when I designed without reading existing
  code first — always read before planning.

## 1. How to read what's already done

```
git log --oneline -50
```

Look for `feat(identity):` and `feat(app):` commits. Each Phase 2
sub-commit has a long body explaining what it added + what's left.

The design doc's §17 ("Implementation Status") is the canonical
checklist of "done vs. not done" — keep updating it when you finish
work. §16 ("Concept Clarifications") pins three confusions to avoid
(multi-device ≠ "千军万马", etc.) — don't let those drift back in.

## 2. User preferences — non-negotiable

These are saved in your auto-memory at
`/Users/a123456/.claude/projects/-Users-a123456-Downloads-ottie-workspace/memory/`.
Highlights:

- **No purple in UI** — never use as accent or decorative color.
- **Research isolation** — never clone or copy 3rd-party project code
  into the working directory. Specifically, HuLa was researched for
  inspiration but its code MUST stay out of this repo. Public
  protocol references (Signal X3DH, SIGMA-I, Matrix federation) are
  fine to cite by name in comments.
- **Read existing code before writing plans** — when working in
  this project, always read README/CLAUDE.md/relevant code first.
  Don't design from external research alone.
- **Bilingual i18n** — every user-visible string change updates both
  `packages/app/src/i18n/locales/en.json` and `zh.json`.
- **Email**: `wwwwendell638@gmail.com`.

## 3. Critical commands

```bash
# Always run after changes:
cd /Users/a123456/Downloads/ottie-workspace/ottie
npm run typecheck                                   # whole workspace
npm run format:files -- <changed files>             # not full format
npm run lint -- <changed files>                     # not full lint

# Targeted vitest (preferred — full suite is heavy):
cd packages/server && npx vitest run src/server/identity/  # all identity tests
cd packages/server && npx vitest run src/server/identity/foo.test.ts  # one file
cd packages/server && npx vitest run --reporter=verbose -t "test name"

# Stability check (vitest has occasional parallel flakes):
for i in 1 2 3 4 5; do
  npx vitest run src/server/identity/ src/server/relay-transport.test.ts \
    2>&1 | grep "Tests.*passed\|failed"
done

# Commits use --no-verify because lefthook fires full-repo lint
# (141 pre-existing errors). User has authorized this for the
# multi-user-collab branch:
git commit --no-verify -m "feat(...): subject"
git push                                            # push every step
```

**Daemon rules** (from CLAUDE.md):
- NEVER restart the user's main daemon on port 6868 — it manages
  running agents. Tests use `OTTIE_HOME=/tmp/...` + a different
  `OTTIE_LISTEN` port.
- NEVER run the full test suite (`npm run test`) — too heavy. Run
  targeted vitest files only.

## 4. Tech-stack invariants — do not re-litigate

| | What it is | Why we don't change it |
|---|---|---|
| Relay | Cloudflare Workers at `relay.claws.company:443` | Free tier covers personal-scale. User vetted SimpleX as alternative; ruled out (China network, AI-share friction, 50% rewrite cost). |
| App-layer encryption | NaCl box (Curve25519 + XSalsa20-Poly1305) | Standard, audited, exposed via `@ottie/relay/e2ee`. |
| Signatures | Ed25519 throughout (root, self-device, events, peer-hello) | Same. |
| Key serialization on disk | JWK base64url (43-char raw) | Matches existing daemon-keypair pattern. |
| Peer-sync handshake | SIGMA-I (sign ephPubKey under long-term key) | Mutual auth + forward secrecy + MitM-resistant. |
| License | AGPL-3.0 | User explicitly OK with traction; project is open source. |

If you find yourself wanting to change one of these, **stop and ask
the user first** — they cost design rounds in earlier conversations.

## 5. Architecture cheat sheet

```
$OTTIE_HOME/
  identity/
    root.json           — root identity (Ed25519 keypair + displayName)
    self-device.json    — this daemon's signing keypair
    devices.json        — every device this user owns (root-signed each)
    events.json         — append-only log of device-list events
                          (Ed25519-signed by emitter's self-device key)

Relay routing (Cloudflare Workers, V2 protocol):
  role=server (no connectionId)        — daemon control socket per serverId
  role=server&connectionId=X           — daemon per-connection data socket
  role=client&connectionId=X           — client side of connectionId X
  Custom prefixes (relay-transport.ts connectionHandlers extension):
    "device-link:<nonce>"  — Phase 2.d redemption (one-shot)
    "peer-sync:<nonce>"    — Phase 2.f long-lived peer session
```

Key code locations:

```
packages/server/src/server/identity/
  identity-types.ts                       — RootIdentity schema
  root-identity-store.ts                  — load/create root.json
  self-device-store.ts                    — load/create/import self-device.json
  device-types.ts                         — Device + DeviceList schemas
  device-list-store.ts                    — load/save devices.json + buildAuthorizedDevice (root-sign)
  device-list-event-types.ts              — event schemas
  device-list-event.ts                    — sign/verify/applyDeviceListEvent (pure)
  device-list-event-store.ts              — events.json append-only log
  device-link-{types,redeem,redeem-types}.ts
                                          — Phase 2.d crypto core (NaCl box redemption)
  device-link-pending-store.ts            — outstanding offers (memory)
  device-link-pending-candidate-store.ts  — received candidates awaiting approval (memory)
  device-link-receiver.ts                 — RelayConnectionHandler for "device-link:" prefix
  device-link-sender.ts                   — outbound redemption + WS RPC
  device-link-approve{-types,}.ts         — Phase 2.e approval reply (sign + encrypt)
  peer-sync-{types,handshake}.ts          — SIGMA-I crypto (peer-hello + ECDH frame)
  peer-session-registry.ts                — active peer sessions (memory)
  peer-sync-receiver.ts                   — RelayConnectionHandler for "peer-sync:"
  peer-sync-dialer.ts                     — outbound peer-daemon connections + reconnect
  identity-service.ts                     — top-level wrapper used by bootstrap + WS RPCs
  identity-rpc-schemas.ts                 — wire shapes for /identity, /device, /device/link, /device/remove
  test-utils/mock-relay.ts                — in-process Cloudflare-relay clone for tests
  *.test.ts                               — collocated tests

packages/server/src/server/
  relay-transport.ts                      — daemon ↔ relay glue + connectionHandlers extension
  bootstrap.ts                            — wires it all together at daemon startup
  session.ts                              — WS RPC handlers; identity dispatch is dispatchIdentityMessage()
                                            (look for handleDevice* methods)

packages/server/src/client/daemon-client.ts
                                          — DaemonClient class with all WS RPC client methods
                                            (deviceLinkGenerate / Redeem / Approve / Reject /
                                            Candidates / Cancel / deviceRemove / identityGet / …)

packages/server/src/shared/messages.ts   — Zod-validated WS message union; new RPCs add here

packages/app/src/app/
  onboarding/add-device.tsx               — QR generator screen (old device side)
  onboarding/link-existing-device.tsx     — paste-link redeem screen (new device side)
  settings/identity.tsx                   — main "identity & devices" page
                                            (includes DeviceRow with Remove button +
                                             PendingCandidatesSection with Approve/Reject)

packages/app/src/actions/
  ids.ts                                  — ActionId union; chat.add.linkToExisting was added
  chat-row-actions.ts                     — registers the action handlers

packages/app/src/components/top-right-add-menu.tsx
                                          — 6-item dropdown for "+" button
                                            (newChat / scanToPair / joinHost / createWorkspace /
                                             addDevice / linkToExisting)

packages/app/src/i18n/locales/{en,zh}.json — all UI strings (bilingual, MUST update both)
```

## 6. What to do next

Phase 3 — friend pairing + 1-to-1 chat. **Read these first:**

1. Design doc §5.4 ("Adding a friend") — wire shape decided.
2. Design doc §17 (Phase 3 section) — sub-task breakdown.
3. Design doc §6 — peer/chat data-model proposals.
4. The Phase 2.d codebase (device-link-*) — Phase 3 reuses ~50% of
   this pattern. Don't reinvent; refactor when generalizable.

Suggested first sub-commit: **Phase 3.a/0 — peer-pair offer schema +
ECDH crypto core**. Pure functions only, no I/O, fully unit-tested.
This was the proven pattern for Phase 2.d/0 + 2.e/0 + 2.f/0 + 2.f/2a
and it always saved time downstream. See `device-link-redeem.ts`
for the shape to mirror.

**Don't**: jump straight to UI. Don't write transport before crypto.
Don't change tech-stack invariants. Don't copy HuLa code. Don't
auto-route AI shares (§7.5 — owner picks every time, two modals).

**Do**: read the user's response to your handoff prompt before
starting. They may have priorities you don't know about (e.g.
"actually let's polish Phase 2 UI a bit first").

## 7. Phase 4 + 5 quick reminders (so you don't drift)

- Phase 4 (AI sharing) — every share triggers a 2-step modal on
  every online owner-device (§7.5.1–7.5.3). NO auto-route, NO
  per-friend defaults, NO mid-session switching.
- Phase 4 routing detail decided: a friend's request lands on
  exactly ONE owner-daemon (the one the owner picks). Other owner-
  daemons don't pool compute or share AI quotas.
- Phase 5: block / unblock, display name updates (rate-limited 24h
  per §13 Q9), limits exhaustion UI, transparency mode toggle (§13
  Q10).

## 8. Common confusions that were already cleared up (don't re-explain)

- "千军万马" — multi-device is NOT a way to scale AI capacity to
  friends. See §16.1.
- Adding friends is identity-to-identity, not device-to-device.
  Setting up multi-device first is NOT a prerequisite for adding
  friends. See §16.2.
- Daemons sync state but don't pool compute. See §16.3.
- Cloudflare Workers usage means USERS don't sign up for Cloudflare
  accounts. They never see Cloudflare. The user's own Cloudflare
  account is the dev-side dependency only.

## 9. If you're confused about state, run this

```bash
cd /Users/a123456/Downloads/ottie-workspace/ottie
git log --oneline -30
git diff HEAD~5
cat docs/MULTI-USER-COLLABORATION-DESIGN.md | head -100
ls packages/server/src/server/identity/
cd packages/server && npx vitest run src/server/identity/ 2>&1 | tail -8
```

The combination of recent commits + design doc + identity dir + test
output tells you everything. Don't ask the user questions you can
answer from these.
