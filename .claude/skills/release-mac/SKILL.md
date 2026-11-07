---
name: release-mac
description: Build, sign, notarize, and publish a macOS DMG release of Sift. Runs scripts/build-dmg.sh end-to-end. Use when the user asks to release/ship/bundle for macOS.
allowed-tools: Read, Write, Edit, Bash
---

Run a macOS production release of Sift. **Do not ask the user clarifying questions** — `.env` holds all credentials and config; trust it.

## What this skill does

Runs `scripts/build-dmg.sh` which:
1. Sources `.env` and validates `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
2. Confirms version parity across `package.json`, `tauri.conf.json`, `Cargo.toml`.
3. Confirms `release-notes/v<version>.md` exists.
4. Confirms `Developer ID Application: Tim Murphy ($APPLE_TEAM_ID)` resolves in keychain.
5. If `~/.tauri/sift.key` exists, confirms `plugins.updater.pubkey` in `tauri.conf.json` matches `~/.tauri/sift.key.pub`.
6. Auto-installs `aarch64-apple-darwin` + `x86_64-apple-darwin` rust targets if missing.
7. Builds universal; the Tauri bundler codesigns, notarizes and staples the `.app` and (with the key) emits the `.app.tar.gz` + `.sig` updater payload.
8. Signs, notarizes and staples the DMG, then verifies with `codesign`, `stapler` and `spctl`.
9. Builds a merged `latest.json` (preserving any `windows-*` / `linux-*` entries already on the release).
10. If `gh` is authed (`gh auth login`), creates/updates a draft GitHub release on `idevtim/sift` with the DMG, updater payload, and `latest.json`.

**If a draft release for `v<version>` already exists on `idevtim/sift`, the script overwrites every asset via `gh release upload ... --clobber`. This is intended — never pause to ask the user whether to replace existing draft assets. Just let the script run.** The release stays a draft either way; nothing is published until the user clicks publish.

The script enforces every pre-flight itself and exits early on failure — there is nothing to verify upfront.

## How to run

Just execute the script and stream output. Don't read `.env`, don't grep for keys, don't probe `gh auth status`. The script's own checks are authoritative. Expect 10–25 minutes total (universal compile + notarization).

```bash
npm run dist:mac
```

(`npm run build:mac` is an alias; both run `scripts/build-dmg.sh`.)

Use `run_in_background: true` so the build doesn't block. Watch the log via Read on the BashOutput; surface progress milestones to the user (build started, notarization submitted, stapling complete, GitHub release drafted).

## After the script completes

1. Surface the final DMG path:
   `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Sift_<version>_universal.dmg`
2. If a GitHub release was drafted, surface the URL the script prints:
   `https://github.com/idevtim/sift/releases/tag/v<version>`
3. Don't auto-publish the draft — the script intentionally leaves it as a draft for the user to review.

## If the script fails

Read the failure output and report it verbatim. Common patterns:
- **Version mismatch** → fix the offending manifest, re-run.
- **Missing release notes** → create `release-notes/v<version>.md` with the user, re-run.
- **Signing identity not found** → confirm `APPLE_TEAM_ID` in `.env` matches a cert from `security find-identity -v -p codesigning`.
- **Updater pubkey mismatch** → paste `cat ~/.tauri/sift.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, re-run.
- **`Signing was enabled but updater payload is missing`** → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in `.env` is wrong for `~/.tauri/sift.key`.
- **Notarization rejected** → script prints the submission ID; fetch the log with `xcrun notarytool log <id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"`.
- **gh upload 401** → the logged-in `gh` account lacks scope on `idevtim/sift`; re-run `gh auth login` (or `gh auth refresh -s repo`). The local artifacts are still valid, only the release upload failed.

Do not retry destructive recovery (delete tags, force-push, recreate releases) without asking.
