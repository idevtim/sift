//! The disk index: one parallel walk of the home folder (plus /Applications
//! on macOS) that powers Explore, Big files, Developer, Duplicates, ⌘K file
//! search, the drive breakdown and the first-scan progress. Read-only.
//!
//! The tree is pruned as it's built — per folder, only children big enough
//! to draw in the treemap are kept and the rest fold into "Smaller items" —
//! so memory stays bounded however many files the user has.

use super::{findings, kinds};
use crate::models::{
    BigFile, Category, CategoryTotal, DevArtifact, DevKind, ExploreNode, ExploreView, Reason, ScanProgress,
    ScanSummary, SearchHit,
};
use rayon::prelude::*;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MB: u64 = 1_000_000;
/// Files at least this big are "Big files" candidates.
const BIG_FILE_MIN: u64 = 100 * MB;
const BIG_FILES_KEPT: usize = 50;
/// Videos at least this big, not opened for `OLD_VIDEO_AGE`, are "Large old videos".
const OLD_VIDEO_MIN: u64 = 100 * MB;
const OLD_VIDEO_AGE: Duration = Duration::from_secs(365 * 24 * 60 * 60);
/// Duplicate detection ignores files smaller than this.
pub const DUPE_MIN: u64 = 512 * 1024;
/// Folders that are really one document or one app (or a git repo's
/// internals). Their contents are never offered as Big files or duplicates —
/// removing a file from inside one would break the whole thing.
const PACKAGE_EXTS: &[&str] = &[
    "app", "photoslibrary", "photolibrary", "musiclibrary", "tvlibrary", "imovielibrary", "fcpbundle",
    "logicx", "band", "aplibrary", "lrdata", "bundle", "framework", "xcodeproj", "xcworkspace", "sparsebundle",
];

/// Duplicates are only looked for in these top-level home folders — the
/// user's own files, not tools' or projects' working sets.
const DUPE_FOLDERS: &[&str] = &["Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Videos"];

/// Per-folder pruning: keep at most this many children…
const MAX_CHILDREN: usize = 120;
/// …and only those at least this big (or this share of the folder).
const MIN_CHILD: u64 = MB;
const MIN_CHILD_SHARE: u64 = 500;

pub struct Node {
    pub name: String,
    /// None for synthetic nodes ("Smaller items", the system total).
    pub path: Option<PathBuf>,
    pub size: u64,
    pub free: u64,
    pub is_dir: bool,
    pub reason: Option<Reason>,
    pub children: Vec<Node>,
}

/// A file worth checking for duplicates.
#[derive(Clone)]
pub struct FileRec {
    pub path: PathBuf,
    pub size: u64,
    pub modified_ms: u64,
}

pub struct Index {
    pub root: Node,
    pub big_files: Vec<BigFile>,
    /// Home's "Large old videos": big videos not opened in a year.
    pub old_videos: Vec<BigFile>,
    pub dev: Vec<DevArtifact>,
    pub dupe_candidates: Vec<FileRec>,
    pub summary: ScanSummary,
}

/// Well-known locations, resolved once per scan.
struct Places {
    home: PathBuf,
    caches: Vec<PathBuf>,
    trash: Option<PathBuf>,
    derived_data: PathBuf,
    package_caches: Vec<PathBuf>,
    /// Never walked: cloud-sync placeholders (listing them can trigger
    /// downloads), other apps' sandboxes (macOS prompts for each), and
    /// Sift's own data.
    skip: Vec<PathBuf>,
    /// Inside these, files aren't offered as Big files or duplicates.
    system_areas: Vec<PathBuf>,
}

impl Places {
    fn resolve(home: PathBuf, own_data: PathBuf) -> Self {
        let lib = home.join("Library");
        let mut skip = vec![own_data];
        let mut system_areas = Vec::new();
        if cfg!(target_os = "macos") {
            skip.extend([
                lib.join("CloudStorage"),
                lib.join("Mobile Documents"),
                lib.join("Containers"),
                lib.join("Group Containers"),
            ]);
            system_areas.push(lib.clone());
        } else if cfg!(target_os = "windows") {
            system_areas.push(home.join("AppData"));
        }
        Self {
            caches: findings::cache_paths(),
            trash: findings::trash_path(),
            derived_data: lib.join("Developer/Xcode/DerivedData"),
            package_caches: vec![home.join(".npm/_cacache"), home.join(".cargo/registry/cache")],
            skip,
            system_areas,
            home,
        }
    }

    /// Inside a package (see PACKAGE_EXTS) or a .git folder.
    fn is_package(path: &Path) -> bool {
        let name = name_of(path);
        name == ".git"
            || Path::new(&name)
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| PACKAGE_EXTS.contains(&x.to_ascii_lowercase().as_str()))
    }

    fn in_dupe_folder(&self, path: &Path) -> bool {
        path.strip_prefix(&self.home)
            .ok()
            .and_then(|rel| rel.components().next())
            .is_some_and(|c| DUPE_FOLDERS.iter().any(|f| c.as_os_str() == *f))
    }

    fn is_system_area(&self, path: &Path) -> bool {
        Self::is_package(path)
            || self.system_areas.iter().any(|a| path.starts_with(a))
            // Dot-folders at the top of home (.cache, .rustup, …) are tool data.
            || path
                .strip_prefix(&self.home)
                .ok()
                .and_then(|rel| rel.components().next())
                .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    }

    fn dir_reason(&self, path: &Path, name: &str) -> Option<Reason> {
        if self.caches.iter().any(|c| c == path) || self.package_caches.iter().any(|c| c == path) {
            return Some(Reason::Cache);
        }
        if self.trash.as_deref() == Some(path) {
            return Some(Reason::Trash);
        }
        if name == "node_modules" {
            return Some(Reason::NodeModules);
        }
        if name == "target" && path.parent().is_some_and(|p| p.join("Cargo.toml").is_file()) {
            return Some(Reason::RustTarget);
        }
        if path.parent() == Some(self.derived_data.as_path()) {
            return Some(Reason::DerivedData);
        }
        None
    }
}

struct Ctx<'a> {
    places: &'a Places,
    files: AtomicU64,
    bytes: AtomicU64,
    current: Mutex<String>,
    big: Mutex<Vec<BigFile>>,
    old_videos: Mutex<Vec<BigFile>>,
    dev: Mutex<Vec<DevArtifact>>,
    dupes: Mutex<Vec<FileRec>>,
}

fn ms(t: Option<SystemTime>) -> u64 {
    t.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

fn name_of(path: &Path) -> String {
    path.file_name().map_or_else(|| path.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned())
}

impl<'a> Ctx<'a> {
    fn new(places: &'a Places) -> Self {
        Self {
            places,
            files: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            current: Mutex::new(String::new()),
            big: Mutex::new(Vec::new()),
            old_videos: Mutex::new(Vec::new()),
            dev: Mutex::new(Vec::new()),
            dupes: Mutex::new(Vec::new()),
        }
    }

    fn file(&self, path: PathBuf, meta: &Metadata, inherited: Option<Reason>, system: bool) -> Node {
        // Cloud files that aren't downloaded take no space here and must
        // never be offered (removing or hashing one means downloading it).
        let size = super::local_len(meta);
        let cloud_only = super::is_dataless(meta);
        self.files.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(size, Ordering::Relaxed);
        let reason = inherited.or_else(|| {
            findings::is_old_installer(&path, meta.modified().ok()).then_some(Reason::Installer)
        });
        if reason.is_none() && !system && !cloud_only {
            if size >= BIG_FILE_MIN {
                let opened = ms(meta.accessed().ok()).max(ms(meta.modified().ok()));
                let file = BigFile {
                    name: name_of(&path),
                    location: self.location(&path),
                    path: path.to_string_lossy().into_owned(),
                    size_bytes: size,
                    last_opened_ms: opened,
                };
                let old = ms(SystemTime::now().checked_sub(OLD_VIDEO_AGE)) > opened;
                if size >= OLD_VIDEO_MIN && old && kinds::of(&path) == kinds::FileKind::Video {
                    self.old_videos.lock().unwrap().push(file.clone());
                }
                self.big.lock().unwrap().push(file);
            }
            if size >= DUPE_MIN && self.places.in_dupe_folder(&path) {
                self.dupes.lock().unwrap().push(FileRec {
                    path: path.clone(),
                    size,
                    modified_ms: ms(meta.modified().ok()),
                });
            }
        }
        Node {
            name: name_of(&path),
            path: Some(path),
            size,
            free: if reason.is_some_and(|r| r != Reason::System) { size } else { 0 },
            is_dir: false,
            reason,
            children: Vec::new(),
        }
    }

    /// Top-level home folder a path sits in, for "Movies · last opened …".
    fn location(&self, path: &Path) -> String {
        path.strip_prefix(&self.places.home)
            .ok()
            .and_then(|rel| rel.components().next())
            .filter(|_| path.parent() != Some(self.places.home.as_path()))
            .map_or_else(|| "Home".into(), |c| c.as_os_str().to_string_lossy().into_owned())
    }

    fn dir(&self, path: &Path, inherited: Option<Reason>, system: bool) -> Node {
        let name = name_of(path);
        let empty = |path: &Path| Node {
            name: name.clone(),
            path: Some(path.to_path_buf()),
            size: 0,
            free: 0,
            is_dir: true,
            reason: inherited,
            children: Vec::new(),
        };
        if self.places.skip.iter().any(|s| s == path) {
            return empty(path);
        }
        if let Ok(mut cur) = self.current.try_lock() {
            *cur = path.to_string_lossy().into_owned();
        }
        let Ok(rd) = fs::read_dir(path) else { return empty(path) };

        let mut files = Vec::new();
        let mut dirs = Vec::new();
        for entry in rd.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                dirs.push(entry.path());
            } else if ft.is_file() {
                if let Ok(meta) = entry.metadata() {
                    files.push((entry.path(), meta));
                }
            }
        }

        let mut children: Vec<Node> = files
            .into_iter()
            .map(|(p, m)| self.file(p, &m, inherited, system))
            .collect();
        children.par_extend(dirs.into_par_iter().map(|p| {
            let child_name = name_of(&p);
            let own = if inherited.is_none() { self.places.dir_reason(&p, &child_name) } else { None };
            let node = self.dir(&p, inherited.or(own), system || self.places.is_system_area(&p));
            if let Some(kind) = own.and_then(dev_kind_of) {
                self.record_dev(kind, &p, node.size);
            } else if own == Some(Reason::Cache) && self.places.package_caches.contains(&p) {
                self.record_dev(DevKind::PackageCaches, &p, node.size);
            }
            node
        }));

        let size = children.iter().map(|c| c.size).sum();
        let free = if inherited.is_some_and(|r| r != Reason::System) {
            size
        } else {
            children.iter().map(|c| c.free).sum()
        };
        Node {
            name,
            path: Some(path.to_path_buf()),
            size,
            free,
            is_dir: true,
            reason: inherited,
            children: prune(children, size),
        }
    }

    fn record_dev(&self, kind: DevKind, path: &Path, size: u64) {
        if size == 0 {
            return;
        }
        let project_modified_ms = match kind {
            // The artifact folder itself is touched by each build.
            DevKind::DerivedData | DevKind::PackageCaches => ms(fs::metadata(path).and_then(|m| m.modified()).ok()),
            DevKind::NodeModules | DevKind::RustTarget => project_modified(path),
        };
        self.dev.lock().unwrap().push(DevArtifact {
            kind,
            path: path.to_string_lossy().into_owned(),
            size_bytes: size,
            project_modified_ms,
        });
    }
}

fn dev_kind_of(reason: Reason) -> Option<DevKind> {
    match reason {
        Reason::NodeModules => Some(DevKind::NodeModules),
        Reason::RustTarget => Some(DevKind::RustTarget),
        Reason::DerivedData => Some(DevKind::DerivedData),
        _ => None,
    }
}

/// Newest change among the project's own top-level entries (excluding the
/// artifact folder), as a cheap "when was this project last worked on".
fn project_modified(artifact: &Path) -> u64 {
    let Some(project) = artifact.parent() else { return 0 };
    fs::read_dir(project)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path() != artifact)
                .filter_map(|e| e.metadata().ok())
                .map(|m| ms(m.modified().ok()))
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0)
}

/// Keep the children worth drawing; fold the rest into "Smaller items".
fn prune(mut children: Vec<Node>, total: u64) -> Vec<Node> {
    children.sort_by_key(|c| std::cmp::Reverse(c.size));
    let floor = MIN_CHILD.max(total / MIN_CHILD_SHARE);
    let keep = children.iter().take(MAX_CHILDREN).take_while(|c| c.size >= floor).count();
    let rest: Vec<Node> = children.split_off(keep);
    let rest_size: u64 = rest.iter().map(|c| c.size).sum();
    if rest_size > 0 {
        children.push(Node {
            name: format!("Smaller items ({})", rest.len()),
            path: None,
            size: rest_size,
            free: rest.iter().map(|c| c.free).sum(),
            is_dir: false,
            reason: None,
            children: Vec::new(),
        });
    }
    children
}

fn system_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else {
        "System"
    }
}

/// Build the index. `expected_bytes` is only for progress (last scan's
/// total, or disk usage on first run). `progress` is called every ~120ms
/// from a helper thread, and once more with `done: true`.
pub fn build(
    own_data: PathBuf,
    drive_name: String,
    drive_used: u64,
    expected_bytes: u64,
    progress: impl Fn(ScanProgress) + Send + Sync,
) -> Option<Index> {
    let home = dirs::home_dir()?;
    let places = Places::resolve(home.clone(), own_data);
    let ctx = Ctx::new(&places);
    let done = AtomicBool::new(false);
    let snapshot = |done: bool| ScanProgress {
        files_checked: ctx.files.load(Ordering::Relaxed),
        bytes_checked: ctx.bytes.load(Ordering::Relaxed),
        bytes_expected: expected_bytes,
        current_path: ctx.current.lock().map(|c| c.clone()).unwrap_or_default(),
        done,
    };

    let (home_node, apps_node) = std::thread::scope(|s| {
        s.spawn(|| {
            while !done.load(Ordering::Relaxed) {
                progress(snapshot(false));
                std::thread::sleep(Duration::from_millis(120));
            }
        });
        let result = rayon::join(
            || ctx.dir(&home, None, false),
            || cfg!(target_os = "macos").then(|| ctx.dir(Path::new("/Applications"), None, true)),
        );
        done.store(true, Ordering::Relaxed);
        result
    });
    progress(snapshot(true));

    let summary = summarize(&home_node, apps_node.as_ref(), drive_used, &ctx);
    let mut root_children: Vec<Node> = home_node.children;
    let home_size = home_node.size;
    let apps_size = apps_node.as_ref().map_or(0, |a| a.size);
    if let Some(mut apps) = apps_node {
        apps.name = "Applications".into();
        root_children.push(apps);
    }
    let system = drive_used.saturating_sub(home_size + apps_size);
    if system > 0 {
        root_children.push(Node {
            name: system_name().into(),
            path: None,
            size: system,
            free: 0,
            is_dir: false,
            reason: Some(Reason::System),
            children: Vec::new(),
        });
    }
    root_children.sort_by_key(|c| std::cmp::Reverse(c.size));
    let root = Node {
        name: drive_name,
        path: None,
        size: root_children.iter().map(|c| c.size).sum(),
        free: root_children.iter().map(|c| c.free).sum(),
        is_dir: true,
        reason: None,
        children: root_children,
    };

    let mut big_files = ctx.big.into_inner().unwrap();
    big_files.sort_by_key(|c| std::cmp::Reverse(c.size_bytes));
    big_files.truncate(BIG_FILES_KEPT);
    let mut dev = ctx.dev.into_inner().unwrap();
    dev.sort_by_key(|c| std::cmp::Reverse(c.size_bytes));

    let mut old_videos = ctx.old_videos.into_inner().unwrap();
    old_videos.sort_by_key(|c| std::cmp::Reverse(c.size_bytes));

    Some(Index {
        root,
        big_files,
        old_videos,
        dev,
        dupe_candidates: ctx.dupes.into_inner().unwrap(),
        summary,
    })
}

/// Non-overlapping category totals for the system drive (scan chips and the
/// drive detail bar). Freeable bytes are pulled out of every other bucket.
fn summarize(home_node: &Node, apps: Option<&Node>, drive_used: u64, ctx: &Ctx) -> ScanSummary {
    let top = |names: &[&str]| -> u64 {
        home_node
            .children
            .iter()
            .filter(|c| names.contains(&c.name.as_str()))
            .map(|c| c.size - c.free)
            .sum()
    };
    let media = top(&["Pictures", "Movies", "Music", "Videos"]);
    let documents = top(&["Documents", "Desktop", "Downloads"]);
    let apps_total = apps.map_or(0, |a| a.size - a.free);
    let freeable = home_node.free + apps.map_or(0, |a| a.free);
    let dev: u64 = ctx.dev.lock().unwrap().iter().map(|d| d.size_bytes).sum();
    let other = (home_node.size - home_node.free).saturating_sub(media + documents);
    let system = drive_used.saturating_sub(home_node.size + apps.map_or(0, |a| a.size));
    ScanSummary {
        files_checked: ctx.files.load(Ordering::Relaxed),
        bytes_checked: ctx.bytes.load(Ordering::Relaxed),
        categories: vec![
            CategoryTotal { category: Category::System, size_bytes: system },
            CategoryTotal { category: Category::Apps, size_bytes: apps_total },
            CategoryTotal { category: Category::Media, size_bytes: media },
            CategoryTotal { category: Category::Documents, size_bytes: documents },
            CategoryTotal { category: Category::Developer, size_bytes: dev },
            CategoryTotal { category: Category::Other, size_bytes: other },
            CategoryTotal { category: Category::Freeable, size_bytes: freeable },
        ],
    }
}

fn to_view(node: &Node) -> ExploreNode {
    ExploreNode {
        name: node.name.clone(),
        path: node.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        size_bytes: node.size,
        free_bytes: node.free,
        is_dir: node.is_dir,
        has_children: !node.children.is_empty(),
        reason: node.reason,
    }
}

/// Drop nodes whose paths no longer exist under any of `roots`, fixing up
/// sizes on the way back up. Returns the (size, free) removed.
fn remove_missing(node: &mut Node, roots: &[PathBuf]) -> (u64, u64) {
    let mut removed = (0, 0);
    node.children.retain_mut(|child| {
        let Some(path) = &child.path else { return true };
        let relevant = roots.iter().any(|r| path.starts_with(r) || r.starts_with(path));
        if !relevant {
            return true;
        }
        if roots.iter().any(|r| path.starts_with(r)) && fs::symlink_metadata(path).is_err() {
            removed.0 += child.size;
            removed.1 += child.free;
            return false;
        }
        let (s, f) = remove_missing(child, roots);
        child.size -= s;
        child.free -= f;
        removed.0 += s;
        removed.1 += f;
        true
    });
    removed
}

impl Index {
    /// Forget paths Sift just removed (they no longer exist on disk), so
    /// Explore, Big files, Developer and Duplicates update without a rescan.
    pub fn forget_removed(&mut self, paths: &[PathBuf]) {
        let (s, f) = remove_missing(&mut self.root, paths);
        self.root.size -= s;
        self.root.free -= f;
        let gone = |p: &str| fs::symlink_metadata(p).is_err();
        self.big_files.retain(|b| !gone(&b.path));
        self.old_videos.retain(|b| !gone(&b.path));
        self.dev.retain(|d| !gone(&d.path));
        self.dupe_candidates.retain(|d| fs::symlink_metadata(&d.path).is_ok());
    }

    /// The folder at `crumbs` (names below the root) and its children.
    pub fn explore(&self, crumbs: &[String]) -> Option<ExploreView> {
        let mut node = &self.root;
        for name in crumbs {
            node = node.children.iter().find(|c| &c.name == name)?;
        }
        Some(ExploreView {
            crumbs: std::iter::once(self.root.name.clone()).chain(crumbs.iter().cloned()).collect(),
            node: to_view(node),
            children: node.children.iter().map(to_view).collect(),
        })
    }

    /// Case-insensitive name search over the (pruned) tree, biggest first.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.to_lowercase();
        let mut hits = Vec::new();
        fn visit(node: &Node, crumbs: &mut Vec<String>, q: &str, hits: &mut Vec<SearchHit>) {
            for child in &node.children {
                if let Some(path) = &child.path {
                    if child.name.to_lowercase().contains(q) {
                        hits.push(SearchHit {
                            name: child.name.clone(),
                            path: path.to_string_lossy().into_owned(),
                            parent_crumbs: crumbs.clone(),
                            size_bytes: child.size,
                            is_dir: child.is_dir,
                            reason: child.reason,
                        });
                    }
                }
                if !child.children.is_empty() {
                    crumbs.push(child.name.clone());
                    visit(child, crumbs, q, hits);
                    crumbs.pop();
                }
            }
        }
        visit(&self.root, &mut Vec::new(), &q, &mut hits);
        hits.sort_by_key(|c| std::cmp::Reverse(c.size_bytes));
        hits.truncate(limit);
        hits
    }
}

/// What Sift should do with a path picked outside the Home categories:
/// the same reasons the index tags, worked out on demand.
pub fn reason_for(path: &Path, own_data: PathBuf) -> Option<Reason> {
    let home = dirs::home_dir()?;
    let places = Places::resolve(home, own_data);
    let mut cur = Some(path);
    while let Some(p) = cur {
        let name = name_of(p);
        if let Some(r) = places.dir_reason(p, &name) {
            return Some(r);
        }
        cur = p.parent();
    }
    let meta = fs::symlink_metadata(path).ok()?;
    findings::is_old_installer(path, meta.modified().ok()).then_some(Reason::Installer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(name: &str, size: u64) -> Node {
        Node { name: name.into(), path: None, size, free: 0, is_dir: false, reason: None, children: Vec::new() }
    }

    /// The walk recurses per folder level; deep trees (nested
    /// node_modules) once overflowed the background pool's stack.
    #[test]
    fn deeply_nested_folders_dont_overflow() {
        let tmp = tempfile::tempdir().unwrap();
        let mut deep = tmp.path().to_path_buf();
        for _ in 0..300 {
            deep.push("d");
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("f"), b"x").unwrap();
        let places = Places::resolve(tmp.path().to_path_buf(), tmp.path().join(".sift-none"));
        let ctx = Ctx::new(&places);
        let root = crate::scanners::background(|| ctx.dir(tmp.path(), None, false));
        assert_eq!(root.size, 1);
    }

    #[test]
    fn prune_folds_small_children() {
        let kids = vec![leaf("big", 10 * MB), leaf("tiny", 10), leaf("tiny2", 20)];
        let pruned = prune(kids, 10 * MB + 30);
        assert_eq!(pruned.len(), 2);
        assert_eq!(pruned[0].name, "big");
        assert_eq!(pruned[1].name, "Smaller items (2)");
        assert_eq!(pruned[1].size, 30);
    }

    #[test]
    fn package_contents_are_never_candidates() {
        let tmp = tempfile::tempdir().unwrap();
        let lib = tmp.path().join("Pictures/Photos Library.photoslibrary/originals");
        fs::create_dir_all(&lib).unwrap();
        fs::write(lib.join("a.heic"), vec![1u8; 600_000]).unwrap();
        fs::write(lib.join("b.heic"), vec![1u8; 600_000]).unwrap();
        let docs = tmp.path().join("Documents");
        fs::create_dir_all(&docs).unwrap();
        fs::write(docs.join("c.pdf"), vec![1u8; 600_000]).unwrap();
        let code = tmp.path().join("code");
        fs::create_dir_all(&code).unwrap();
        fs::write(code.join("d.bin"), vec![1u8; 600_000]).unwrap();

        let places = Places::resolve(tmp.path().to_path_buf(), tmp.path().join("own"));
        let ctx = Ctx::new(&places);
        ctx.dir(tmp.path(), None, false);
        let dupes = ctx.dupes.into_inner().unwrap();
        // Only the Documents file: not the library's insides, not code/.
        assert_eq!(dupes.len(), 1);
        assert!(dupes[0].path.ends_with("c.pdf"));
    }

    #[test]
    fn old_big_videos_are_found() {
        let tmp = tempfile::tempdir().unwrap();
        let movies = tmp.path().join("Movies");
        fs::create_dir_all(&movies).unwrap();
        let two_years_ago = SystemTime::now() - Duration::from_secs(2 * 365 * 24 * 60 * 60);
        // Sparse files: big on paper, nothing written.
        for (name, old) in [("old.mov", true), ("recent.mov", false), ("old.zip", true)] {
            let f = fs::File::create(movies.join(name)).unwrap();
            f.set_len(OLD_VIDEO_MIN).unwrap();
            if old {
                f.set_times(fs::FileTimes::new().set_accessed(two_years_ago).set_modified(two_years_ago)).unwrap();
            }
        }
        let places = Places::resolve(tmp.path().to_path_buf(), tmp.path().join("own"));
        let ctx = Ctx::new(&places);
        ctx.dir(tmp.path(), None, false);
        let videos = ctx.old_videos.into_inner().unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].name, "old.mov");
    }

    #[test]
    fn walk_tags_build_output_and_counts_free() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("proj");
        fs::create_dir_all(proj.join("node_modules/dep/node_modules")).unwrap();
        fs::write(proj.join("package.json"), "{}").unwrap();
        fs::write(proj.join("node_modules/dep/index.js"), vec![0u8; 2_000_000]).unwrap();
        fs::write(proj.join("node_modules/dep/node_modules/x.js"), vec![0u8; 1_000_000]).unwrap();

        let places = Places::resolve(tmp.path().to_path_buf(), tmp.path().join("own"));
        let ctx = Ctx::new(&places);
        let root = ctx.dir(tmp.path(), None, false);
        assert_eq!(root.free, 3_000_000);
        // Only the outer node_modules is recorded, not the nested one.
        let dev = ctx.dev.into_inner().unwrap();
        assert_eq!(dev.len(), 1);
        assert_eq!(dev[0].size_bytes, 3_000_000);
        assert_eq!(ctx.files.load(Ordering::Relaxed), 3);
    }
}

/// Manual speed check on a real folder:
/// `SIFT_BENCH_DIR=~/Sites cargo test --release bench_walk -- --ignored --nocapture`
#[cfg(test)]
mod bench {
    use super::*;

    #[test]
    #[ignore]
    fn bench_walk() {
        let Ok(dir) = std::env::var("SIFT_BENCH_DIR") else { return };
        let dir = PathBuf::from(dir);
        let places = Places::resolve(dir.clone(), dir.join(".sift-none"));
        let ctx = Ctx::new(&places);
        let t = std::time::Instant::now();
        // Same pool the app uses (half the cores, low priority).
        let root = crate::scanners::background(|| ctx.dir(&dir, None, false));
        let elapsed = t.elapsed();
        fn count(n: &Node) -> usize {
            1 + n.children.iter().map(count).sum::<usize>()
        }
        let dev = ctx.dev.into_inner().unwrap();
        let candidates = ctx.dupes.into_inner().unwrap();
        let t2 = std::time::Instant::now();
        let groups = crate::scanners::background(|| crate::scanners::duplicates::find(&candidates, |_| String::new()));
        println!(
            "walk {:?}: {} files, {:.1} GB, {:.1} GB freeable, {} kept nodes, {} dev artifacts ({:.1} GB)",
            elapsed,
            ctx.files.load(Ordering::Relaxed),
            root.size as f64 / 1e9,
            root.free as f64 / 1e9,
            count(&root),
            dev.len(),
            dev.iter().map(|d| d.size_bytes).sum::<u64>() as f64 / 1e9,
        );
        println!("duplicates {:?}: {} candidates → {} groups", t2.elapsed(), candidates.len(), groups.len());
    }
}
