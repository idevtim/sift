---
name: release
description: Build Sift desktop bundles for macOS, Windows, or Linux. Use when the user asks to release, build, package, ship, bundle, or produce installers/DMGs/MSIs/AppImages for the app.
allowed-tools: Read, Write, Edit, Bash
---
Build Sift (Tauri 2 + React 19) into installable bundles. Outputs land in `src-tauri/target/<target>/release/bundle/`. Releases draft onto the public `idevtim/sift`, the same public repo as the code. See `RELEASE.md` for one-time setup.

## Production releases (signed) — use the per-platform skill

| Platform | Command | Skill | Host |
| --- | --- | --- | --- |
| macOS | `npm run dist:mac` | `release-mac` | Mac (signs + notarizes) |
| Windows | `npm run dist:win` | `release-win` | Windows only |
| Linux | `npm run dist:nix` | `release-linux` | Linux, or macOS via Docker |

Each script enforces its own pre-flight (version parity, `release-notes/v<version>.md`, updater pubkey match, credentials) and leaves the GitHub release as a **draft**. Each platform merges its entries into the release's shared `latest.json`, so run them in any order.

## Pre-flight

1. Confirm icons exist — `src-tauri/icons/icon.icns` (mac), `src-tauri/icons/icon.ico` (win). If missing, `npm run icons`.
2. Confirm versions match across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
3. If `release-notes/v<version>.md` doesn't exist, write it with the `ship-notes` skill first — every script refuses to run without it.
4. If `tsc -b` has been flaky, delete `tsconfig.tsbuildinfo` first.

## Dev / unsigned bundle

`npm run tauri:build` produces unsigned bundles with no updater payload and needs no key. Updater artifacts are opt-in via `src-tauri/tauri.release.conf.json`, which the `dist:*` scripts pass (`--config`) only when `~/.tauri/sift.key` exists. To produce updater artifacts by hand, export the key first — `.env` is only read by the `dist:*` scripts, not by `tauri build`:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/sift.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
npm run tauri:build -- --config src-tauri/tauri.release.conf.json
```

Without the export, Tauri fails with "A public key has been found, but no private key." Unsigned DMGs trigger a Gatekeeper warning (right-click → Open to bypass).

## After a successful build

1. Smoke-test the bundle: open the `.app` / install the `.exe` / `.deb`, confirm Home lists drives and Review shows findings (real data, not fixtures).
2. Surface the bundle paths and draft release URL to the user — don't just say "done."
3. Never publish the draft — the user does that.

## Common failures

- **"failed to bundle project: target not installed"** → run the matching `rustup target add ...`.
- **"icon not found"** → `npm run icons`.
- **"not allowed" / capability errors at runtime** → new plugin permissions must be listed in `src-tauri/capabilities/default.json` (per CLAUDE.md).
- **Linker errors on universal build** → one of the two arch targets isn't installed; `rustup target list --installed` to confirm.

Do not retry destructive recovery (delete tags, force-push, recreate releases) without asking.
