//! The everyday "what can I free up?" scan. Each category resolves to a set of
//! well-known per-OS paths (`targets`) and sizes them in parallel. Nothing
//! here mutates the filesystem — `restore` does the moving.
//!
//! Duplicate photos and large old videos come from the disk index instead
//! (`commands::index_findings`), and the Windows Recycle Bin is asked about
//! through the shell (`recycle_bin`).

use super::{dir_size, leftovers, recycle_bin};
use crate::models::{Finding, FindingKind, Safety};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Installers younger than this are probably mid-install; leave them out.
const INSTALLER_MIN_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Categories measured from well-known locations (the rest need the index).
const SCANNED: [FindingKind; 4] =
    [FindingKind::OldInstallers, FindingKind::Trash, FindingKind::TempFiles, FindingKind::AppLeftovers];

pub fn scan() -> Vec<Finding> {
    SCANNED
        .par_iter()
        .filter_map(|&kind| {
            let (size_bytes, item_count) = measure(kind);
            (size_bytes > 0).then(|| finding(kind, size_bytes, item_count))
        })
        .collect()
}

pub fn finding(kind: FindingKind, size_bytes: u64, item_count: u64) -> Finding {
    let safety = match kind {
        FindingKind::DuplicatePhotos | FindingKind::LargeOldVideos => Safety::Review,
        _ => Safety::Safe,
    };
    Finding { id: id_of(kind).into(), kind, size_bytes, item_count, safety }
}

/// (bytes, items). Items is a file count, except App leftovers, which
/// counts apps ("left behind by 7 apps").
fn measure(kind: FindingKind) -> (u64, u64) {
    if kind == FindingKind::Trash && cfg!(windows) {
        return recycle_bin::query().unwrap_or((0, 0));
    }
    let size = |paths: &[PathBuf]| {
        paths.par_iter().map(|p| dir_size(p)).reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1))
    };
    if kind == FindingKind::AppLeftovers {
        let found = leftovers::find();
        return (size(&found.paths).0, found.apps);
    }
    size(&targets(kind))
}

/// Top-level paths that make up a category — the units `restore` moves.
pub fn targets(kind: FindingKind) -> Vec<PathBuf> {
    match kind {
        FindingKind::OldInstallers => old_installers(),
        FindingKind::Trash => trash_targets(),
        FindingKind::TempFiles => temp_dirs().iter().flat_map(|d| children(d)).collect(),
        FindingKind::AppLeftovers => leftovers::find().paths,
        // Index-backed, or (the Recycle Bin) emptied through the shell.
        FindingKind::DuplicatePhotos | FindingKind::LargeOldVideos => Vec::new(),
    }
}

/// What a category is made of, one entry per removable item. Same paths as
/// `targets`, except the Linux Trash lists files only (each file's
/// `.trashinfo` record goes with it via `with_trash_records`).
pub fn items(kind: FindingKind) -> Vec<PathBuf> {
    match kind {
        FindingKind::Trash => trash_dir().map(|d| children(&d)).unwrap_or_default(),
        _ => targets(kind),
    }
}

/// Add the Linux `.trashinfo` record for each trashed file in `paths`, so
/// removing one item from the Trash doesn't leave a ghost in Files.
pub fn with_trash_records(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = paths.to_vec();
    if !cfg!(target_os = "linux") {
        return out;
    }
    let Some(files) = trash_dir() else { return out };
    let Some(info) = files.parent().map(|t| t.join("info")) else { return out };
    for p in paths {
        if p.parent() == Some(files.as_path()) {
            if let Some(name) = p.file_name() {
                let record = info.join(format!("{}.trashinfo", name.to_string_lossy()));
                if record.exists() && !out.contains(&record) {
                    out.push(record);
                }
            }
        }
    }
    out
}

fn id_of(kind: FindingKind) -> &'static str {
    match kind {
        FindingKind::OldInstallers => "old-installers",
        FindingKind::Trash => "trash",
        FindingKind::AppLeftovers => "app-leftovers",
        FindingKind::TempFiles => "temp-files",
        FindingKind::DuplicatePhotos => "duplicate-photos",
        FindingKind::LargeOldVideos => "large-old-videos",
    }
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default()
}

/// The Trash's contents. On Linux each trashed file also has a
/// `.trashinfo` record beside `files/`; those go too, or the file manager
/// would list ghosts.
fn trash_targets() -> Vec<PathBuf> {
    let Some(dir) = trash_dir() else { return Vec::new() };
    let mut out = children(&dir);
    if cfg!(target_os = "linux") {
        if let Some(info) = dir.parent().map(|t| t.join("info")) {
            out.extend(children(&info));
        }
    }
    out
}

fn trash_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    if cfg!(target_os = "macos") {
        Some(home.join(".Trash"))
    } else if cfg!(target_os = "linux") {
        Some(dirs::data_dir()?.join("Trash/files"))
    } else {
        // The Windows Recycle Bin is per-drive; see `recycle_bin`.
        None
    }
}

fn temp_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "windows") {
        vec![std::env::temp_dir()]
    } else {
        dirs::cache_dir().into_iter().collect()
    }
}

/// An installer in Downloads that's been sitting there at least a week.
pub fn is_old_installer(path: &Path, modified: Option<SystemTime>) -> bool {
    let in_downloads = dirs::download_dir().is_some_and(|d| path.parent() == Some(d.as_path()));
    let ext_ok = path
        .extension()
        .and_then(|x| x.to_str())
        .is_some_and(|x| installer_exts().contains(&x.to_ascii_lowercase().as_str()));
    let old = modified
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age >= INSTALLER_MIN_AGE);
    in_downloads && ext_ok && old
}

pub fn trash_path() -> Option<PathBuf> {
    trash_dir()
}

pub fn cache_paths() -> Vec<PathBuf> {
    temp_dirs()
}

fn installer_exts() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        &["dmg", "pkg", "mpkg"]
    } else if cfg!(target_os = "windows") {
        &["msi", "msix", "exe"]
    } else {
        &["deb", "rpm", "appimage"]
    }
}

fn old_installers() -> Vec<PathBuf> {
    let Some(downloads) = dirs::download_dir() else { return Vec::new() };
    children(&downloads)
        .into_iter()
        .filter(|p| {
            std::fs::symlink_metadata(p)
                .ok()
                .filter(|m| m.is_file())
                .is_some_and(|m| is_old_installer(p, m.modified().ok()))
        })
        .collect()
}

/// Manual timing of each quick check (read-only):
/// `cargo test --release time_quick_checks -- --ignored --nocapture`
#[cfg(test)]
mod timing {
    #[test]
    #[ignore]
    fn time_quick_checks() {
        for kind in super::SCANNED {
            let t = std::time::Instant::now();
            let (bytes, items) = super::measure(kind);
            println!("{kind:?}: {:.1} GB, {items} items, {:?}", bytes as f64 / 1e9, t.elapsed());
        }
        let t = std::time::Instant::now();
        let l = super::leftovers::find();
        println!("leftovers::find alone: {} paths, {:?}", l.paths.len(), t.elapsed());
    }
}
