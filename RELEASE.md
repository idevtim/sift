# Release runbook

Sift releases are built **locally** and drafted onto [`idevtim/sift`](https://github.com/idevtim/sift), the same repo as the code: each release script tags the commit it built and pushes the tag first. macOS and Windows build on their own hardware; Linux builds natively or in Docker from a Mac.

## One-time setup

### 1. Updater signing key

Installed copies verify every update against the public key baked into `src-tauri/tauri.conf.json`. Generate Sift's own key pair (choose a passphrase when prompted):

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/sift.key
cat ~/.tauri/sift.key.pub
```

Paste the printed public key into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` and commit it (already done for the current key).

The `dist:*` scripts load the key from that file themselves and pass `--config src-tauri/tauri.release.conf.json` to turn on updater artifacts, so nothing needs exporting in your shell. A plain `npm run tauri:build` stays unsigned.

**Back up `~/.tauri/sift.key` and its passphrase** to a password manager. Lose either and existing installs can never receive another update. Every release script checks that the config pubkey matches `~/.tauri/sift.key.pub` before building.

### 2. `.env`

```bash
cp .env.example .env
```

Fill in `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com), `APPLE_TEAM_ID`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The macOS script expects the `Developer ID Application: Tim Murphy (<team>)` certificate in the login keychain (override with `APPLE_SIGNING_IDENTITY`).

### 3. GitHub

`gh auth login` with `repo` scope on `idevtim/sift`.

### 4. Per platform

- **macOS:** Xcode command line tools; `jq` (`brew install jq`).
- **Windows:** Visual Studio Build Tools (C++), LLVM (`winget install --id LLVM.LLVM`), `gh`.
- **Linux from macOS:** Docker Desktop with *Use Rosetta for x86_64/amd64 emulation* on and 12–16 GB of memory.

## Shipping a version

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (they must match).
2. Write `release-notes/v<version>.md` (`/ship-notes` in Claude Code).
3. Build and draft, one per platform, in any order:

   ```bash
   npm run dist:mac                  # universal DMG, signed + notarized
   npm run dist:win                  # x64 + arm64 NSIS installers (on Windows)
   npm run dist:nix                  # deb + rpm + AppImage (Docker on macOS)
   npm run dist:nix -- --build-only  # Linux bundles only, no tag/upload
   ```

   Each run uploads its bundles, updater payload, `.sig`, and merges its platforms into the release's `latest.json`.
4. Review the draft at `https://github.com/idevtim/sift/releases` and publish. Installed copies find it at `releases/latest/download/latest.json` on next launch and offer **Restart to update** in the sidebar.
5. **Push the Homebrew cask.** `npm run dist:mac` also bumps `version` and `sha256` in [`idevtim/homebrew-tap`](https://github.com/idevtim/homebrew-tap)'s `Casks/sift.rb` (in `../homebrew-tap`, or `$HOMEBREW_TAP_DIR`) and commits it there, unpushed. Once the release is published:

   ```bash
   git -C ../homebrew-tap push
   ```

   Until that lands, `brew install --cask idevtim/tap/sift` keeps installing the previous version. Existing installs update themselves either way, which is why a stale cask goes unnoticed. If the script couldn't find or rewrite the cask, it prints the `version` and `sha256` to paste in by hand. Don't push before publishing: the cask's DMG URL 404s while the release is a draft.
