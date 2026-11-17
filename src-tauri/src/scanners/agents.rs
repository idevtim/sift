//! What AI coding tools leave on disk: leftover git worktrees, app caches,
//! old versions of the tools themselves, old conversations and editor state
//! for folders that no longer exist. Read-only; `clean_agents` re-runs
//! `scan` and looks items up by id, so a path from the UI is never trusted.
//!
//! Only explicit, known folders are offered — never settings, credentials,
//! MCP or auth files, the version in use, `memory/` or the Claude app's own
//! runtime (`vm_bundles`). Caches are deleted for good (apps rebuild them);
//! everything else is held in Restore. Local models are listed, not removed:
//! their files are shared between models and owned by the model tool.

use super::dir_size;
use crate::models::{AgentItem, AgentItemKind as K, AgentReport, AgentTool};
use crate::process_ext::NoWindow;
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: u64 = 86_400_000;
/// Conversations untouched this long are offered (switched off).
const OLD_CHAT_DAYS: u64 = 90;
/// Rewind checkpoints untouched this long are offered (switched off).
const OLD_CHECKPOINT_DAYS: u64 = 30;

/// Chromium/Electron folders an editor rebuilds on its own. Never `User/`,
/// `WebStorage`, `IndexedDB`, `Local Storage`, `Partitions` or cookies.
const ELECTRON_CACHES: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GraphiteDawnCache",
    "CachedData",
    "CachedExtensionVSIXs",
    "logs",
];

/// An item with the paths cleaning it would touch (kept on this side).
pub struct Found {
    pub item: AgentItem,
    pub paths: Vec<PathBuf>,
}

/// Running programs: their executables and working folders.
pub struct Procs {
    exes: Vec<PathBuf>,
    cwds: Vec<PathBuf>,
}

impl Procs {
    pub fn snapshot() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::new()
                .with_exe(sysinfo::UpdateKind::Always)
                .with_cwd(sysinfo::UpdateKind::Always),
        );
        let procs = sys.processes().values();
        Procs {
            exes: procs.clone().filter_map(|p| p.exe().map(Path::to_path_buf)).collect(),
            cwds: procs.filter_map(|p| p.cwd().map(Path::to_path_buf)).collect(),
        }
    }

    /// A program runs from inside `path` (a bundle, or a version file).
    fn runs_from(&self, path: &Path) -> bool {
        self.exes.iter().any(|e| e.starts_with(path))
    }

    /// A program is working inside `dir` (a terminal, an agent, a build).
    fn works_in(&self, dir: &Path) -> bool {
        self.cwds.iter().any(|c| c.starts_with(dir))
    }

    /// One of an app's bundles or programs is open.
    fn app_open(&self, app: &App) -> bool {
        app.bundles.iter().any(|b| self.runs_from(b))
            || self.exes.iter().any(|e| {
                e.file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| app.programs.iter().any(|p| s.eq_ignore_ascii_case(p)))
            })
    }
}

/// A desktop app whose caches need it closed.
struct App {
    bundles: Vec<PathBuf>,
    /// Program names outside macOS (`Cursor.exe`, `cursor`).
    programs: &'static [&'static str],
}

fn app(name: &str, programs: &'static [&'static str]) -> App {
    let mut bundles = Vec::new();
    if cfg!(target_os = "macos") {
        bundles.push(PathBuf::from(format!("/Applications/{name}.app")));
        if let Some(home) = dirs::home_dir() {
            bundles.push(home.join(format!("Applications/{name}.app")));
        }
    }
    App { bundles, programs }
}

pub fn scan() -> Vec<Found> {
    scan_with(&Procs::snapshot())
}

pub fn report() -> AgentReport {
    let procs = Procs::snapshot();
    let found = scan_with(&procs);
    let mut tools: Vec<AgentTool> = TOOLS
        .iter()
        .map(|(id, name)| AgentTool {
            id: (*id).into(),
            name: (*name).into(),
            open: tool_app(id).is_some_and(|a| procs.app_open(&a)),
            items: found.iter().filter(|f| f.item.id.starts_with(&format!("{id}:"))).map(|f| f.item.clone()).collect(),
        })
        .filter(|t| !t.items.is_empty())
        .collect();
    for t in &mut tools {
        t.items.sort_by_key(|i| std::cmp::Reverse(i.size_bytes));
    }
    tools.sort_by_key(|t| std::cmp::Reverse(t.items.iter().filter(|i| i.removable).map(|i| i.size_bytes).sum::<u64>()));
    AgentReport { tools }
}

const TOOLS: &[(&str, &str)] = &[
    ("claude-code", "Claude Code"),
    ("claude", "Claude app"),
    ("cursor", "Cursor"),
    ("vscode", "VS Code"),
    ("windsurf", "Windsurf"),
    ("codex", "Codex"),
    ("ollama", "Ollama"),
];

fn tool_app(id: &str) -> Option<App> {
    match id {
        "claude" => Some(app("Claude", &["Claude", "claude-desktop"])),
        "cursor" => Some(app("Cursor", &["Cursor"])),
        "vscode" => Some(app("Visual Studio Code", &["Code"])),
        "windsurf" => Some(app("Windsurf", &["Windsurf"])),
        _ => None,
    }
}

/// Where an Electron app keeps its data (`~/Library/Application Support/X`,
/// `%APPDATA%\X`, `~/.config/X`).
fn app_support(name: &str) -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(name))
}

fn scan_with(procs: &Procs) -> Vec<Found> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let now = now_ms();
    let mut jobs: Vec<Box<dyn Fn() -> Vec<Found> + Send + Sync + '_>> = Vec::new();

    // Claude Code: worktrees in the projects it has worked in, old installs,
    // its cache, and old conversations and checkpoints.
    let claude_dir = home.join(".claude");
    jobs.push(Box::new({
        let claude_dir = claude_dir.clone();
        move || {
            let roots = project_roots(&claude_dir.join("projects"));
            roots
                .iter()
                .flat_map(|r| children(&r.join(".claude/worktrees")))
                .filter_map(|wt| worktree("claude-code", &wt, procs))
                .collect()
        }
    }));
    jobs.push(Box::new({
        let home = home.clone();
        move || old_versions("claude-code", &home.join(".local/share/claude/versions"), procs, "Claude Code")
    }));
    if let Some(cache) = dirs::cache_dir() {
        jobs.push(Box::new(move || {
            cache_item("claude-code", &cache.join("claude-cli-nodejs"), "Claude Code logs and cache", None)
                .into_iter()
                .collect()
        }));
    }
    jobs.push(Box::new({
        let claude_dir = claude_dir.clone();
        move || old_conversations(&claude_dir.join("projects"), now)
    }));
    jobs.push(Box::new({
        let claude_dir = claude_dir.clone();
        move || old_checkpoints(&claude_dir.join("file-history"), now)
    }));

    // Claude app: its caches, and copies of Claude Code it no longer runs.
    if let Some(dir) = app_support("Claude") {
        let open = tool_app("claude").is_some_and(|a| procs.app_open(&a));
        jobs.push(Box::new({
            let dir = dir.clone();
            move || electron_caches("claude", &dir, open, "Claude")
        }));
        jobs.push(Box::new(move || old_versions("claude", &dir.join("claude-code"), procs, "Claude Code")));
    }

    // Editors: caches, and state kept for folders that no longer exist.
    for (id, folder, name) in [("cursor", "Cursor", "Cursor"), ("vscode", "Code", "VS Code"), ("windsurf", "Windsurf", "Windsurf")] {
        let Some(dir) = app_support(folder) else { continue };
        let open = tool_app(id).is_some_and(|a| procs.app_open(&a));
        jobs.push(Box::new({
            let dir = dir.clone();
            move || electron_caches(id, &dir, open, name)
        }));
        jobs.push(Box::new(move || orphan_workspaces(id, &dir.join("User/workspaceStorage"), open, name)));
    }

    // Worktrees Cursor and Codex make in their own folders.
    for (id, dir) in [("cursor", home.join(".cursor/worktrees")), ("codex", home.join(".codex/worktrees"))] {
        jobs.push(Box::new(move || {
            // Either `worktrees/<name>` or `worktrees/<project>/<name>`.
            children(&dir)
                .into_iter()
                .flat_map(|d| if is_worktree(&d) { vec![d] } else { children(&d) })
                .filter_map(|wt| worktree(id, &wt, procs))
                .collect()
        }));
    }
    jobs.push(Box::new({
        let home = home.clone();
        move || {
            let dir = home.join(".codex/archived_sessions");
            let Some(meta) = std::fs::metadata(&dir).ok().filter(|m| m.is_dir()) else { return Vec::new() };
            let size = dir_size(&dir).0;
            if size == 0 {
                return Vec::new();
            }
            vec![Found {
                item: AgentItem {
                    id: format!("codex:history:{}", dir.display()),
                    kind: K::History,
                    name: "Archived conversations".into(),
                    detail: "Codex sessions you archived".into(),
                    path: dir.display().to_string(),
                    size_bytes: size,
                    last_used_ms: modified_ms(&meta),
                    held: true,
                    default_on: false,
                    removable: true,
                    note: None,
                    blocked: None,
                },
                paths: vec![dir],
            }]
        }
    }));

    // Local models: listed so their size is visible, never removed here.
    jobs.push(Box::new({
        let home = home.clone();
        move || ollama_models(&home.join(".ollama/models"))
    }));

    jobs.par_iter().flat_map(|job| job()).collect()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// Sub-folders of `dir` (none if it's missing).
fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}

/// Claude Code names each project folder after its path, with every
/// character that isn't a letter or digit turned into `-`.
fn encode(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// The real folders behind `~/.claude/projects/<encoded>`. The encoding is
/// lossy, so each one is found by walking down from `/` along children
/// whose encoded name matches the next piece.
fn project_roots(projects: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = children(projects)
        .into_iter()
        .filter_map(|p| p.file_name()?.to_str().map(String::from))
        .filter_map(|name| resolve(Path::new("/"), &name, 0))
        .collect();
    roots.sort();
    roots.dedup();
    roots
}

fn resolve(dir: &Path, rest: &str, depth: usize) -> Option<PathBuf> {
    if depth > 16 {
        return None;
    }
    for child in children(dir) {
        let Some(name) = child.file_name().and_then(|n| n.to_str()) else { continue };
        let enc = format!("-{}", encode(name));
        if rest == enc {
            return Some(child);
        }
        if let Some(next) = rest.strip_prefix(&enc).filter(|n| n.starts_with('-')) {
            if let Some(found) = resolve(&child, next, depth + 1) {
                return Some(found);
            }
        }
    }
    None
}

/// A linked git worktree: a `.git` *file* pointing at the main repository.
fn is_worktree(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(".git")).is_ok_and(|s| s.starts_with("gitdir:"))
}

/// Read-only git (no index refresh or lock files).
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(dir)
        .args(args)
        .no_window()
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn worktree(tool: &str, dir: &Path, procs: &Procs) -> Option<Found> {
    if !is_worktree(dir) {
        return None;
    }
    let meta = std::fs::metadata(dir).ok()?;
    let name = dir.file_name()?.to_string_lossy().into_owned();
    let branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let dirty = git(dir, &["status", "--porcelain"]).is_none_or(|s| !s.is_empty());
    // Safe to let go when another branch already has its latest commit.
    let elsewhere = git(dir, &["branch", "-a", "--contains", "HEAD", "--format=%(refname:short)"])
        .is_some_and(|s| s.lines().any(|b| !b.is_empty() && b != branch && !b.starts_with('(')));
    let in_use = procs.works_in(dir);
    let note = if dirty {
        Some("Has changes you haven't committed".to_string())
    } else if !elsewhere {
        Some("Its latest commits aren't on any other branch".to_string())
    } else {
        None
    };
    let repo = dir.ancestors().nth(3).and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned());
    let detail = match (repo, branch.as_str()) {
        (Some(r), b) if tool == "claude-code" && !b.is_empty() => format!("In {r} · branch {b}"),
        (_, b) if !b.is_empty() && b != "HEAD" => format!("Branch {b}"),
        _ => "Detached worktree".into(),
    };
    Some(Found {
        item: AgentItem {
            id: format!("{tool}:worktree:{}", dir.display()),
            kind: K::Worktree,
            name,
            detail,
            path: dir.display().to_string(),
            size_bytes: dir_size(dir).0,
            last_used_ms: modified_ms(&meta),
            held: true,
            default_on: !dirty && elsewhere && !in_use,
            removable: true,
            note,
            blocked: in_use.then(|| "A program is working in this folder".to_string()),
        },
        paths: vec![dir.to_path_buf()],
    })
}

/// "2.1.325" → [2, 1, 325] for ordering; anything else sorts first.
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect()
}

/// Every installed version but the newest and any that's running.
fn old_versions(tool: &str, dir: &Path, procs: &Procs, what: &str) -> Vec<Found> {
    let mut versions: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    versions.retain(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| !version_key(n).is_empty()));
    versions.sort_by_key(|p| version_key(&p.file_name().unwrap_or_default().to_string_lossy()));
    versions.pop(); // keep the newest
    versions
        .into_iter()
        .filter(|v| !procs.runs_from(v))
        .filter_map(|v| {
            let meta = std::fs::symlink_metadata(&v).ok()?;
            let size = if meta.is_dir() { dir_size(&v).0 } else { meta.len() };
            let version = v.file_name()?.to_string_lossy().into_owned();
            Some(Found {
                item: AgentItem {
                    id: format!("{tool}:oldVersion:{}", v.display()),
                    kind: K::OldVersion,
                    name: format!("{what} {version}"),
                    detail: "An older version that's no longer used".into(),
                    path: v.display().to_string(),
                    size_bytes: size,
                    last_used_ms: modified_ms(&meta),
                    held: true,
                    default_on: true,
                    removable: true,
                    note: None,
                    blocked: None,
                },
                paths: vec![v],
            })
        })
        .collect()
}

fn cache_item(tool: &str, dir: &Path, name: &str, blocked: Option<String>) -> Option<Found> {
    let meta = std::fs::metadata(dir).ok().filter(|m| m.is_dir())?;
    let size = dir_size(dir).0;
    (size > 0).then(|| Found {
        item: AgentItem {
            id: format!("{tool}:cache:{}", dir.display()),
            kind: K::Cache,
            name: name.into(),
            detail: "Rebuilt automatically when it's needed".into(),
            path: dir.display().to_string(),
            size_bytes: size,
            last_used_ms: modified_ms(&meta),
            held: false,
            default_on: true,
            removable: true,
            note: None,
            blocked,
        },
        paths: vec![dir.to_path_buf()],
    })
}

/// An Electron app's rebuildable caches, as one item.
fn electron_caches(tool: &str, dir: &Path, open: bool, app: &str) -> Vec<Found> {
    let paths: Vec<PathBuf> = ELECTRON_CACHES.iter().map(|c| dir.join(c)).filter(|p| p.is_dir()).collect();
    let size: u64 = paths.iter().map(|p| dir_size(p).0).sum();
    if size == 0 {
        return Vec::new();
    }
    vec![Found {
        item: AgentItem {
            id: format!("{tool}:cache:{}", dir.display()),
            kind: K::Cache,
            name: format!("{app} caches"),
            detail: "Downloaded and compiled files the app rebuilds on its own".into(),
            path: dir.display().to_string(),
            size_bytes: size,
            last_used_ms: None,
            held: false,
            default_on: true,
            removable: true,
            note: None,
            blocked: open.then(|| format!("Quit {app} to clear these")),
        },
        paths,
    }]
}

/// Claude Code conversations untouched for `OLD_CHAT_DAYS`, one item per
/// project: each `<session>.jsonl` with its `<session>/` folder. Never
/// `memory/` or anything else in the project folder.
fn old_conversations(projects: &Path, now: u64) -> Vec<Found> {
    children(projects)
        .into_iter()
        .filter_map(|project| {
            let mut paths = Vec::new();
            let mut size = 0;
            let mut newest = 0;
            for entry in std::fs::read_dir(&project).ok()?.filter_map(Result::ok) {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let modified = modified_ms(&meta).unwrap_or(now);
                if now.saturating_sub(modified) < OLD_CHAT_DAYS * DAY_MS {
                    continue;
                }
                newest = newest.max(modified);
                size += meta.len();
                let session = path.with_extension("");
                if session.is_dir() && session.file_name().is_some_and(|n| n != "memory") {
                    size += dir_size(&session).0;
                    paths.push(session);
                }
                paths.push(path);
            }
            if paths.is_empty() {
                return None;
            }
            let count = paths.iter().filter(|p| p.extension().is_some_and(|e| e == "jsonl")).count();
            let encoded = project.file_name()?.to_string_lossy().into_owned();
            let label = resolve(Path::new("/"), &encoded, 0)
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .or_else(|| encoded.rsplit('-').find(|s| !s.is_empty()).map(String::from))?;
            Some(Found {
                item: AgentItem {
                    id: format!("claude-code:history:{}", project.display()),
                    kind: K::History,
                    name: format!("Old conversations in {label}"),
                    detail: format!(
                        "{count} {} untouched for {OLD_CHAT_DAYS} days",
                        if count == 1 { "conversation" } else { "conversations" }
                    ),
                    path: project.display().to_string(),
                    size_bytes: size,
                    last_used_ms: Some(newest),
                    held: true,
                    default_on: false,
                    removable: true,
                    note: None,
                    blocked: None,
                },
                paths,
            })
        })
        .collect()
}

/// Claude Code's rewind checkpoints for sessions untouched a while.
fn old_checkpoints(dir: &Path, now: u64) -> Vec<Found> {
    let old: Vec<(PathBuf, u64)> = children(dir)
        .into_iter()
        .filter_map(|d| {
            let m = modified_ms(&std::fs::metadata(&d).ok()?)?;
            (now.saturating_sub(m) >= OLD_CHECKPOINT_DAYS * DAY_MS).then_some((d, m))
        })
        .collect();
    let size: u64 = old.iter().map(|(d, _)| dir_size(d).0).sum();
    if size == 0 {
        return Vec::new();
    }
    vec![Found {
        item: AgentItem {
            id: format!("claude-code:history:{}", dir.display()),
            kind: K::History,
            name: "Old rewind checkpoints".into(),
            detail: format!("File snapshots from {} sessions older than {OLD_CHECKPOINT_DAYS} days", old.len()),
            path: dir.display().to_string(),
            size_bytes: size,
            last_used_ms: old.iter().map(|(_, m)| *m).max(),
            held: true,
            default_on: false,
            removable: true,
            note: None,
            blocked: None,
        },
        paths: old.into_iter().map(|(d, _)| d).collect(),
    }]
}

/// The folder a `workspaceStorage/<hash>/workspace.json` was kept for.
fn workspace_folder(json: &str) -> Option<PathBuf> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let uri = v["folder"].as_str().or(v["workspace"].as_str())?;
    let path = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode(path)))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Editor state (chat history, open files) kept for local folders that no
/// longer exist. Remote and untitled workspaces are left alone.
fn orphan_workspaces(tool: &str, dir: &Path, open: bool, app: &str) -> Vec<Found> {
    let orphans: Vec<PathBuf> = children(dir)
        .into_iter()
        .filter(|ws| {
            std::fs::read_to_string(ws.join("workspace.json"))
                .ok()
                .and_then(|j| workspace_folder(&j))
                .is_some_and(|folder| folder.is_absolute() && !folder.exists())
        })
        .collect();
    let size: u64 = orphans.iter().map(|p| dir_size(p).0).sum();
    if size == 0 {
        return Vec::new();
    }
    vec![Found {
        item: AgentItem {
            id: format!("{tool}:workspace:{}", dir.display()),
            kind: K::Workspace,
            name: "State for deleted folders".into(),
            detail: format!(
                "Chat history and editor state for {} {} that no longer exist",
                orphans.len(),
                if orphans.len() == 1 { "folder" } else { "folders" }
            ),
            path: dir.display().to_string(),
            size_bytes: size,
            last_used_ms: None,
            held: true,
            default_on: true,
            removable: true,
            note: None,
            blocked: open.then(|| format!("Quit {app} first")),
        },
        paths: orphans,
    }]
}

/// Ollama's models, read from its manifests (`library/<model>/<tag>`).
fn ollama_models(root: &Path) -> Vec<Found> {
    let manifests = root.join("manifests/registry.ollama.ai/library");
    children(&manifests)
        .into_iter()
        .flat_map(|model| {
            std::fs::read_dir(&model)
                .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).collect::<Vec<_>>())
                .unwrap_or_default()
                .into_iter()
                .filter_map(move |tag| {
                    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&tag).ok()?).ok()?;
                    let size: u64 = json["layers"].as_array()?.iter().filter_map(|l| l["size"].as_u64()).sum();
                    let name = format!(
                        "{}:{}",
                        tag.parent()?.file_name()?.to_string_lossy(),
                        tag.file_name()?.to_string_lossy()
                    );
                    Some(Found {
                        item: AgentItem {
                            id: format!("ollama:model:{}", tag.display()),
                            kind: K::Model,
                            name,
                            detail: "A downloaded model. Remove it with `ollama rm`".into(),
                            path: root.display().to_string(),
                            size_bytes: size,
                            last_used_ms: std::fs::metadata(&tag).ok().as_ref().and_then(modified_ms),
                            held: false,
                            default_on: false,
                            removable: false,
                            note: None,
                            blocked: None,
                        },
                        paths: Vec::new(),
                    })
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn no_procs() -> Procs {
        Procs { exes: Vec::new(), cwds: Vec::new() }
    }

    #[test]
    fn versions_sort_numerically() {
        let mut v = vec!["2.1.9", "2.1.325", "2.1.31"];
        v.sort_by_key(|s| version_key(s));
        assert_eq!(v, ["2.1.9", "2.1.31", "2.1.325"]);
    }

    #[test]
    fn keeps_newest_and_running_versions() {
        let tmp = tempfile::tempdir().unwrap();
        for v in ["2.1.9", "2.1.31", "2.1.325"] {
            fs::write(tmp.path().join(v), b"bin").unwrap();
        }
        fs::write(tmp.path().join("notes.txt"), b"x").unwrap();
        let procs = Procs { exes: vec![tmp.path().join("2.1.31")], cwds: Vec::new() };
        let old = old_versions("claude-code", tmp.path(), &procs, "Claude Code");
        let names: Vec<_> = old.iter().map(|f| f.item.name.clone()).collect();
        assert_eq!(names, ["Claude Code 2.1.9"]);
        assert!(old[0].item.held);
    }

    #[test]
    fn encodes_like_claude_code() {
        assert_eq!(encode("/Users/a/Sites/my.site"), "-Users-a-Sites-my-site");
    }

    #[test]
    fn resolves_lossy_project_names() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("Sites/my.site/.claude/worktrees/feat-x");
        fs::create_dir_all(&real).unwrap();
        fs::create_dir_all(tmp.path().join("Sites/my-other")).unwrap();
        let name = encode(&tmp.path().join("Sites/my.site").to_string_lossy());
        assert_eq!(resolve(Path::new("/"), &name, 0).map(|p| p.canonicalize().unwrap()), Some(tmp.path().join("Sites/my.site").canonicalize().unwrap()));
    }

    #[test]
    fn conversations_skip_memory_and_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("-Users-a-Sites-demo");
        fs::create_dir_all(project.join("memory")).unwrap();
        fs::create_dir_all(project.join("old-session/tool-results")).unwrap();
        fs::write(project.join("old-session.jsonl"), b"{}").unwrap();
        fs::write(project.join("new-session.jsonl"), b"{}").unwrap();
        fs::write(project.join("memory/MEMORY.md"), b"keep").unwrap();
        // Everything was just written, so pretend "now" is a year on.
        let later = now_ms() + 365 * DAY_MS;
        let found = old_conversations(tmp.path(), later);
        assert_eq!(found.len(), 1);
        let paths = &found[0].paths;
        assert!(paths.iter().all(|p| !p.starts_with(project.join("memory"))));
        assert!(paths.contains(&project.join("old-session.jsonl")));
        assert!(paths.contains(&project.join("old-session")));
        assert!(!found[0].item.default_on);
        // Nothing is old yet today.
        assert!(old_conversations(tmp.path(), now_ms()).is_empty());
    }

    #[test]
    fn decodes_workspace_folders() {
        assert_eq!(
            workspace_folder(r#"{"folder":"file:///Users/a/My%20Project"}"#),
            Some(PathBuf::from("/Users/a/My Project"))
        );
        assert_eq!(workspace_folder(r#"{"folder":"vscode-remote://ssh/x"}"#), None);
    }

    fn sh(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap().status.success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn worktrees_are_on_only_when_safe() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        fs::create_dir_all(&repo).unwrap();
        sh(&repo, &["init", "-q", "-b", "main"]);
        sh(&repo, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
        let clean = repo.join(".claude/worktrees/clean");
        let dirty = repo.join(".claude/worktrees/dirty");
        sh(&repo, &["worktree", "add", "-q", "-b", "clean", clean.to_str().unwrap()]);
        sh(&repo, &["worktree", "add", "-q", "-b", "dirty", dirty.to_str().unwrap()]);
        fs::write(dirty.join("wip.txt"), b"unsaved").unwrap();

        let procs = no_procs();
        let c = worktree("claude-code", &clean, &procs).unwrap();
        let d = worktree("claude-code", &dirty, &procs).unwrap();
        assert!(c.item.default_on, "clean worktree whose commit is on main");
        assert!(!d.item.default_on);
        assert!(d.item.note.as_deref().unwrap().contains("haven't committed"));

        let busy = Procs { exes: Vec::new(), cwds: vec![clean.clone()] };
        let b = worktree("claude-code", &clean, &busy).unwrap();
        assert!(!b.item.default_on && b.item.blocked.is_some());

        assert!(worktree("claude-code", &repo, &procs).is_none(), "the main checkout isn't a worktree");
    }

    /// Read-only look at this computer: `cargo test live_agent_report -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_agent_report() {
        for t in report().tools {
            println!("{} (open: {})", t.name, t.open);
            for i in t.items {
                println!(
                    "  {:>9.1} MB  {:?} {} | {} | held={} on={} blocked={:?} note={:?}",
                    i.size_bytes as f64 / 1e6, i.kind, i.name, i.detail, i.held, i.default_on, i.blocked, i.note
                );
            }
        }
    }
}
