---
name: release-win
description: Build, sign, and publish a Windows NSIS release of Sift (x64 + arm64). Runs scripts/build-windows.ps1 end-to-end. Use when the user asks to release/ship/bundle for Windows.
allowed-tools: Read, Write, Edit, Bash
---

Run a Windows production release of Sift. **Do not ask the user clarifying questions** — `.env` and `~/.tauri/sift.key` hold all credentials and config; trust them.

## What this skill does

Runs `scripts/build-windows.ps1` which:
1. Refreshes `PATH` from registry and prepends `C:\Program Files\LLVM\bin` (clang is required to build `ring` on `aarch64-pc-windows-msvc`).
2. Sources `.env` if present (picks up `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). GitHub auth comes from `gh auth login`.
3. Loads the updater key from `~/.tauri/sift.key` and exports both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (Tauri silently skips signing if either is unset).
4. Confirms version parity across `package.json`, `tauri.conf.json`, `Cargo.toml`.
5. Confirms `release-notes/v<version>.md` exists.
6. Confirms `rustc`, `cargo`, `npm`, `clang` are on PATH.
7. Auto-installs `aarch64-pc-windows-msvc` + `x86_64-pc-windows-msvc` rust targets if missing.
8. Builds NSIS installers for both arches via `npx tauri build --bundles nsis --target <triple>`.
9. Validates the wrapped `.exe`'s PE machine type matches the requested target (catches Tauri's hardcoded `_x64-` filename mistake), then renames to `Sift_<version>_<arch>-setup.exe` and moves the `.sig` sibling alongside.
10. If `gh` is authed (`gh auth login`), creates/updates a draft GitHub release on `idevtim/sift` with both installers, both `.sig` files, and a merged `latest.json` (preserves any existing `darwin-*` platform entries from a prior macOS release).

**If a draft release for `v<version>` already exists on `idevtim/sift`, the script overwrites every asset via `gh release upload ... --clobber`. This is intended — never pause to ask the user whether to replace existing draft assets. Just let the script run.** The release stays a draft either way; nothing is published until the user clicks publish.

The script enforces every pre-flight itself and exits early on failure — there is nothing to verify upfront.

## How to run

Just execute the script and stream output. Don't read `.env`, don't probe `gh auth status`, don't check the signing key path. The script's own checks are authoritative. Expect 10–25 minutes total (two arch builds + release upload).

```powershell
npm run dist:win
```

(`npm run build:win` is an alias; both run `scripts/build-windows.ps1`.)

If invoking the script directly instead of through npm, use
`powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1`.

**Use forward slashes in the script path.** The Bash tool routes through bash, which strips backslashes from `scripts\build-windows.ps1` and yields `scriptsbuild-windows.ps1` — PowerShell then errors with `The argument '...' to the -File parameter does not exist`. Forward slashes (`scripts/build-windows.ps1`) work fine on Windows PowerShell and survive bash quoting.

Use `run_in_background: true` so the build doesn't block. Watch the log via Read on the BashOutput; surface progress milestones to the user (target install, per-arch build start/finish, draft release creation).

## After the script completes

1. Surface the final installer paths:
   - `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Sift_<version>_x64-setup.exe`
   - `src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis\Sift_<version>_arm64-setup.exe`
2. If a GitHub release was drafted, surface the URL the script prints:
   `https://github.com/idevtim/sift/releases/tag/v<version>`
3. Don't auto-publish the draft — the script intentionally leaves it as a draft for the user to review.

## If the script fails

Read the failure output and report it verbatim. Common patterns:
- **Updater pubkey mismatch** → paste the contents of `~/.tauri/sift.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, re-run.
- **Version mismatch** → fix the offending manifest, re-run.
- **Missing release notes** → create `release-notes/v<version>.md` with the user, re-run.
- **`required tool not on PATH: clang`** → install LLVM (`winget install --id LLVM.LLVM`), open a fresh shell, re-run.
- **`tauri build failed for aarch64-pc-windows-msvc`** → almost always a clang/`ring` issue; confirm `C:\Program Files\LLVM\bin\clang.exe` exists.
- **`PE machine 0x... doesn't match expected ...`** → the build produced a binary for the wrong arch (stale target dir). Delete `src-tauri\target\<triple>\release\` and re-run.
- **`Signing was enabled but no .sig file produced`** → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is wrong for the key at `~/.tauri/sift.key`. Set the right password in `.env` (or unset both env vars to fall back to unsigned).
- **`gh release upload` failure / 401** → the logged-in `gh` account lacks scope on `idevtim/sift`; re-run `gh auth login` (or `gh auth refresh -s repo`). The local installers are still valid, only the release upload failed.

Do not retry destructive recovery (delete tags, force-push, recreate releases) without asking.
