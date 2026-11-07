---
name: release-linux
description: Build, sign, and publish a Linux release of Sift (deb + rpm + AppImage). Runs scripts/build-linux.sh on a Linux host, or scripts/docker-build-linux.sh in an amd64 container from macOS. Use when the user asks to release/ship/bundle for Linux.
allowed-tools: Read, Write, Edit, Bash
---

Run a Linux production release of Sift. **Do not ask the user clarifying questions** — `.env` and `~/.tauri/sift.key` hold all credentials and config; trust them.

## Pick the entry point by host OS

`npm run dist:nix` handles this for you — `scripts/dist-linux.sh` dispatches on
`uname -s` and passes flags through, so you don't have to branch:

| Host | What `dist:nix` runs |
| --- | --- |
| `Linux` | `./scripts/build-linux.sh` |
| `Darwin` | `./scripts/docker-build-linux.sh` |

(`npm run build:linux` is an alias. `npm run dist:nix:docker` forces the
container path.) `build-linux.sh` itself must run on Linux — it checks `dpkg`
for the GTK/webkit dev packages and builds for whatever `uname -m` reports.

On macOS the Docker wrapper builds an amd64 Ubuntu 22.04 image and runs the
same `build-linux.sh` inside it, so everything below still applies — the
container just supplies the Linux host. It needs the Docker daemon running
(`open -a Docker`); the script fails with that exact hint if it isn't.

Do **not** try to satisfy `build-linux.sh` directly on macOS by installing the
GTK stack via Homebrew. Tauri links against Linux system libraries; there is no
macOS-hosted path to a Linux bundle.

## What this skill does

Runs `scripts/build-linux.sh` which:
1. Prepends `$HOME/.cargo/bin` to PATH (rustup/cargo aren't always on PATH in non-interactive shells).
2. Strips snap-injected env vars (`LOCPATH`, `GTK_PATH`, `XDG_DATA_DIRS`, …) when launched from VS Code's snap-integrated terminal — without this the built binary dies at startup with a `GLIBC_PRIVATE` symbol-lookup error.
3. Sources `.env` if present (picks up `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). GitHub auth comes from `gh auth login`.
4. Detects host arch (`x86_64` → `x86_64-unknown-linux-gnu` / `linux-x86_64`; `aarch64` → `aarch64-unknown-linux-gnu` / `linux-aarch64`). Cross-compiling is intentionally not supported.
5. Loads the updater key from `~/.tauri/sift.key` and exports both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (Tauri silently skips signing if either is unset). If the key file is missing the build still succeeds but produces UNSIGNED bundles with no updater payload.
6. Confirms version parity across `package.json`, `tauri.conf.json`, `Cargo.toml`.
7. Confirms `release-notes/v<version>.md` exists.
8. Confirms `rustc`, `cargo`, `node`, `npm` are on PATH.
9. Auto-installs the host's rust target if missing.
10. On Debian-family systems, checks for required system libs (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libfuse2`, `patchelf`) and prints the exact `apt-get install` command for any missing.
11. Builds `.deb`, `.rpm`, and `.AppImage` via `npx tauri build --target <triple>`.
12. Locates the updater payload alongside the AppImage (newer Tauri emits `<name>.AppImage.sig` directly; older versions emit `<name>.AppImage.tar.gz` + `.sig`).
13. If `gh` is authed (`gh auth login`), creates/updates a draft GitHub release on `idevtim/sift` with all bundles, the updater payload, the `.sig`, and a merged `latest.json` (preserves any existing `darwin-*` / `windows-*` platform entries from a prior macOS or Windows release).

**If a draft release for `v<version>` already exists on `idevtim/sift`, the script overwrites every asset via `gh release upload ... --clobber`. This is intended — never pause to ask the user whether to replace existing draft assets. Just let the script run.** The release stays a draft either way; nothing is published until the user clicks publish.

The script enforces every pre-flight itself and exits early on failure — there is nothing to verify upfront.

## How to run

Just execute the script and stream output. Don't read `.env`, don't probe `gh auth status`, don't check the signing key path, don't verify apt packages. The script's own checks are authoritative.

```bash
npm run dist:nix
```

Expect 5–15 minutes on a Linux host. Via Docker on Apple Silicon, expect
considerably longer on a cold cache: the Rust release profile
(`lto = true`, `codegen-units = 1`) compiles the whole dependency graph under
amd64 emulation. The cargo registry and `target/` persist in named Docker
volumes, so later runs are incremental.

Add `-- --build-only` (`npm run dist:nix -- --build-only`) to produce bundles
without tagging or uploading — worth doing first when the build environment
itself is what's being verified. On a Linux host the equivalent is
`SKIP_RELEASE=1`.

Use `run_in_background: true` so the build doesn't block. Watch the log via Read on the BashOutput; surface progress milestones to the user (target install, build start/finish, draft release creation).

## After the script completes

1. Surface the final bundle paths (the script prints them at the end):
   - `src-tauri/target/<triple>/release/bundle/deb/Sift_<version>_<arch>.deb`
   - `src-tauri/target/<triple>/release/bundle/rpm/Sift-<version>-1.<arch>.rpm`
   - `src-tauri/target/<triple>/release/bundle/appimage/Sift_<version>_<arch>.AppImage`
2. If a GitHub release was drafted, surface the URL the script prints:
   `https://github.com/idevtim/sift/releases/tag/v<version>`
3. Don't auto-publish the draft — the script intentionally leaves it as a draft for the user to review.

## If the script fails

Read the failure output and report it verbatim. Common patterns:
- **Updater pubkey mismatch** → paste the contents of `~/.tauri/sift.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, re-run.
- **Version mismatch** → fix the offending manifest, re-run.
- **Missing release notes** → create `release-notes/v<version>.md` with the user, re-run.
- **Missing system packages** → the script prints the exact `sudo apt-get install -y …` line; run it, re-run the script.
- **Unsupported host architecture** → the script only targets the host arch (`x86_64` or `aarch64`); cross-compiling Linux bundles needs a sysroot and isn't wired up.
- **`symbol lookup error: … GLIBC_PRIVATE`** at app startup → snap env vars leaked into the build environment. The script strips these automatically; if it still happens, run from a non-snap terminal.
- **`Signing was enabled but no .sig was produced`** → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is wrong for the key at `~/.tauri/sift.key`. Set the right password in `.env` (or remove the key file to fall back to unsigned bundles without an updater payload).
- **AppImage build fails with `libfuse` / `patchelf` errors** → those packages are listed in the pre-flight; install them via the printed `apt-get` line.
- **`gh release upload` failure / 401** → the logged-in `gh` account lacks scope on `idevtim/sift`; re-run `gh auth login` (or `gh auth refresh -s repo`). The local bundles are still valid, only the release upload failed.

Docker-path only (macOS host):

- **`Docker daemon not reachable`** → `open -a Docker`, wait for it to finish starting, re-run.
- **Exit 137 during the link step** → the linker was OOM-killed. `lto = true` + `codegen-units = 1` needs headroom; raise the VM to 12–16GB in Docker Desktop → Settings → Resources.
- **Build is drastically slower than expected** → confirm Docker Desktop → Settings → General → *Use Rosetta for x86_64/amd64 emulation* is on. Plain QEMU is several times slower for this compile.
- **`cannot execute binary file` / arch errors from node or esbuild** → the `node_modules` volume got polluted with macOS binaries. Reset it: `docker volume rm sift-linux-node-modules`, then re-run.
- **AppImage step fails mounting a squashfs / FUSE error** → `APPIMAGE_EXTRACT_AND_RUN=1` is set in the image for exactly this; if it's failing, the image is stale — re-run with `--rebuild`.

Do not retry destructive recovery (delete tags, force-push, recreate releases) without asking.
