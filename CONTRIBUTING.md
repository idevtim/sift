# Contributing to Sift

Thanks for helping people get their disk space back! Here's how to get going.

## Setup

Requires Node 20+, Rust 1.90+, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/YOUR_USERNAME/sift.git
cd sift
npm install
npm run dev          # UI only on http://localhost:1430, backed by fixtures
npm run tauri:dev    # full app (first Rust compile takes a few minutes)
```

You don't need any signing certificates or keys to build and run Sift locally. `npm run tauri:build` produces unsigned bundles in `src-tauri/target/release/bundle/`.

Other useful commands:

```bash
npm run demo                  # UI with the design prototype's sample data
npm run typecheck
cd src-tauri && cargo test    # Rust tests
cd src-tauri && cargo clippy
npm run icons                 # regenerate the icon set from src-tauri/icons/source.png
```

On macOS, Full Disk Access granted while running `tauri:dev` belongs to your terminal, not to Sift.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run typecheck`, plus `cargo test` and `cargo clippy` in `src-tauri/` if you touched Rust
4. Try it in the app (`npm run tauri:dev`), on as many of macOS / Windows / Linux as you can
5. Open a PR and say which platforms you tested on

## Project overview

Tauri 2 (Rust core) · React 19 · TypeScript · Vite · Tailwind 4 · TanStack Query · Zustand

```
src/                    React UI
  routes.ts             sidebar groups + hash routes (single source of truth)
  lib/tauri.ts          typed `api` over Rust commands, with browser fixtures
  lib/findingCopy.ts    plain-words copy per finding kind
  components/overlays/  onboarding, first scan, ⌘K palette, toasts
  stores/               Zustand UI state (prefs, selection, toasts, …)
  views/                one folder per screen
src-tauri/src/
  commands.rs           IPC commands
  models.rs             serde types (mirrored in src/types/api.ts)
  restore.rs            the 30-day holding area
  access.rs             macOS Full Disk Access check
  checkup.rs            weekly check-up (launchd / Task Scheduler / systemd)
  scanners/             read-only scanners (disk index, findings, apps, drives)
```

[`CLAUDE.md`](CLAUDE.md) has the detailed architecture notes and conventions; it's written for AI coding agents but is the best map of the codebase for people too.

## Safety rules

Sift deletes things on people's computers, so these aren't negotiable:

- **Never delete in place.** Removals go through `free_paths` / `free_up`, which move items into the holding area so they stay in Restore for 30 days.
- **Permanent deletes are limited** to emptying the Trash / Recycle Bin, caches and build output that apps rebuild (`Reason::deletes_outright`), and the two-click "Clear now" in Restore. The UI must say so.
- **Scanners are read-only.** Don't walk cloud-sync folders or other apps' sandboxes, and never open cloud files that aren't downloaded.
- **Backup drives and OS-protected paths are off limits.** Nothing outside home (and the OS temp dir) gets removed, apart from a `.app` directly inside `/Applications`.
- **Fully local.** No telemetry, accounts or network calls beyond the update check.

## Guidelines

- Keep PRs focused: one feature or fix per PR
- Everyday screens use plain words; file paths only appear in Power tools
- Teal means "you can reclaim this". Everything else stays neutral (no red, no health scores)
- Keep `src-tauri/src/models.rs` and `src/types/api.ts` in sync
- New `api.*` calls need a fixture fallback so the UI still runs in a plain browser
- Be gentle with the CPU: scanning work runs on the existing rayon pools (`scanners::background`), never a new full-width one

## Releases

Signed releases are built by the maintainer (see [`RELEASE.md`](RELEASE.md)); contributors don't need any of that setup.

## Questions?

Open an issue. Happy to help!
