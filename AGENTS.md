# Sift — agent instructions

Read [`CLAUDE.md`](CLAUDE.md). It's the full guide for AI coding agents working on Sift (commands, architecture, safety rules and gotchas) and applies to any agent, not just Claude Code.

The short version:

- Tauri 2 (Rust core in `src-tauri/`) + React 19 / TypeScript / Vite / Tailwind 4 (`src/`).
- Scanners are read-only. Removals go through `free_paths` / `free_up` into the Restore holding area; never delete in place.
- Keep `src-tauri/src/models.rs` and `src/types/api.ts` in sync, and give every new `api.*` call a fixture so `npm run dev` keeps working in a plain browser.
- Before finishing: `npm run typecheck`, and `cd src-tauri && cargo test && cargo clippy` if Rust changed.
