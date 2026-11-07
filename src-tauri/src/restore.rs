//! The Restore holding area. Nothing Sift removes is deleted in place: it's
//! renamed into `<app data>/hold/<entry id>/` (same volume as the user's
//! home, so a move is a cheap rename) and recorded in `restore.json`.
//! Entries are purged after `RETENTION`, or straight away with "Clear now".
//!
//! Two categories skip the hold (`is_held`): the Trash (already deleted once)
//! and temporary files (apps rebuild them, so holding them would only keep
//! the space taken). Those are deleted for good and recorded as
//! non-restorable entries so Restore can say where the space went.

use crate::models::{FindingKind, HeldItem, RestoreEntry};
use anyhow::{anyhow, bail, Context, Result};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

const MANIFEST: &str = "restore.json";
const HOLD_DIR: &str = "hold";

/// Whether a category goes to the holding area (true) or is deleted for good.
pub fn is_held(kind: FindingKind) -> bool {
    !matches!(kind, FindingKind::Trash | FindingKind::TempFiles)
}

/// What a Restore entry is called: a Home category, or a label for paths
/// removed from Big files, Explore, Duplicates or Developer.
#[derive(Debug, Clone)]
pub enum Origin {
    Category(FindingKind),
    Label(String),
}

impl Origin {
    fn split(self) -> (Option<FindingKind>, Option<String>) {
        match self {
            Origin::Category(k) => (Some(k), None),
            Origin::Label(l) => (None, Some(l)),
        }
    }
}

pub struct RestoreStore {
    root: PathBuf,
    /// Serializes manifest read-modify-write cycles.
    lock: Mutex<()>,
}

impl RestoreStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { root: app_data_dir, lock: Mutex::new(()) }
    }

    /// Restore entries, newest first. Purges expired ones on the way.
    pub fn list(&self) -> Result<Vec<RestoreEntry>> {
        self.purge_expired()?;
        let _g = self.lock.lock().unwrap();
        let mut entries = self.load()?;
        entries.sort_by_key(|e| std::cmp::Reverse(e.removed_at_ms));
        Ok(entries)
    }

    /// Move `paths` into the holding area as one entry. `on_item` is called
    /// with each item's size after it's handled (moved or skipped), for
    /// progress. Returns the entry (None if nothing moved) and the skip count.
    pub fn hold(
        &self,
        origin: Origin,
        paths: Vec<(PathBuf, u64)>,
        mut on_item: impl FnMut(u64),
    ) -> Result<(Option<RestoreEntry>, u64)> {
        let id = uuid::Uuid::new_v4().to_string();
        let dir = self.root.join(HOLD_DIR).join(&id);
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;

        let mut items = Vec::new();
        let mut skipped = 0;
        for (n, (src, size)) in paths.into_iter().enumerate() {
            let name = src.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let dst = dir.join(format!("{n}-{name}"));
            match self.ensure_allowed(&src).and_then(|_| move_path(&src, &dst).map_err(Into::into)) {
                Ok(()) => items.push(HeldItem {
                    original_path: src.to_string_lossy().into_owned(),
                    held_path: dst.to_string_lossy().into_owned(),
                    size_bytes: size,
                }),
                Err(_) => skipped += 1,
            }
            on_item(size);
        }

        if items.is_empty() {
            let _ = fs::remove_dir(&dir);
            return Ok((None, skipped));
        }
        let (kind, label) = origin.split();
        let entry = RestoreEntry {
            id,
            kind,
            label,
            size_bytes: items.iter().map(|i| i.size_bytes).sum(),
            removed_at_ms: now_ms(),
            restorable: true,
            items,
        };
        self.mutate(|entries| entries.push(entry.clone()))?;
        Ok((Some(entry), skipped))
    }

    /// Permanently delete `paths` (emptying the Trash). Recorded as a
    /// non-restorable entry so Restore can say it can't come back.
    pub fn delete_permanently(
        &self,
        origin: Origin,
        paths: Vec<(PathBuf, u64)>,
        mut on_item: impl FnMut(u64),
    ) -> Result<(Option<RestoreEntry>, u64)> {
        let mut freed = 0;
        let mut skipped = 0;
        for (path, size) in paths {
            match self.ensure_allowed(&path).and_then(|_| remove_path(&path).map_err(Into::into)) {
                Ok(()) => freed += size,
                Err(_) => skipped += 1,
            }
            on_item(size);
        }
        Ok((self.record_deleted(origin, freed)?, skipped))
    }

    /// Record space freed outside Sift's own file handling (the Windows
    /// Recycle Bin, emptied by the shell) as a non-restorable entry.
    pub fn record_deleted(&self, origin: Origin, bytes: u64) -> Result<Option<RestoreEntry>> {
        if bytes == 0 {
            return Ok(None);
        }
        let (kind, label) = origin.split();
        let entry = RestoreEntry {
            id: uuid::Uuid::new_v4().to_string(),
            kind,
            label,
            size_bytes: bytes,
            removed_at_ms: now_ms(),
            restorable: false,
            items: Vec::new(),
        };
        self.mutate(|entries| entries.push(entry.clone()))?;
        Ok(Some(entry))
    }

    /// Put an entry's items back where they came from. If something now
    /// occupies an original path, the item comes back beside it as
    /// "name (restored)". Items that fail stay held and the entry remains.
    pub fn restore(&self, id: &str) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut entries = self.load()?;
        let idx = entries.iter().position(|e| e.id == id).ok_or_else(|| anyhow!("nothing to restore"))?;
        if !entries[idx].restorable {
            bail!("this can't be restored");
        }

        let mut failed = Vec::new();
        for item in std::mem::take(&mut entries[idx].items) {
            let original = PathBuf::from(&item.original_path);
            let result = (|| -> Result<()> {
                if let Some(parent) = original.parent() {
                    fs::create_dir_all(parent)?;
                }
                move_path(Path::new(&item.held_path), &free_name(&original))?;
                Ok(())
            })();
            if result.is_err() {
                failed.push(item);
            }
        }

        let failures = failed.len();
        if failed.is_empty() {
            let entry = entries.remove(idx);
            let _ = fs::remove_dir_all(self.root.join(HOLD_DIR).join(&entry.id));
        } else {
            entries[idx].size_bytes = failed.iter().map(|i| i.size_bytes).sum();
            entries[idx].items = failed;
        }
        self.save(&entries)?;
        if failures > 0 {
            bail!("{failures} items couldn't be put back");
        }
        Ok(())
    }

    /// Drop entries older than `RETENTION`, deleting their held files.
    pub fn purge_expired(&self) -> Result<()> {
        let cutoff = now_ms().saturating_sub(RETENTION.as_millis() as u64);
        self.drop_where(|e| e.removed_at_ms < cutoff)
    }

    /// "Clear now": delete held entries for good instead of waiting out the
    /// 30 days. `None` clears every held entry.
    pub fn clear(&self, id: Option<&str>) -> Result<()> {
        self.drop_where(|e| e.restorable && id.is_none_or(|id| e.id == id))
    }

    /// Forget the records of things already deleted for good (Trash, caches).
    /// They hold no files; this only tidies the list.
    pub fn hide_cleared(&self) -> Result<()> {
        self.drop_where(|e| !e.restorable)
    }

    /// Remove matching entries and their held files. An entry whose files
    /// can't be deleted is kept, so nothing is left on disk untracked.
    fn drop_where(&self, matches: impl Fn(&RestoreEntry) -> bool) -> Result<()> {
        let hold = self.root.join(HOLD_DIR);
        let mut failed = 0;
        self.mutate(|entries| {
            entries.retain(|e| {
                if !matches(e) {
                    return true;
                }
                match fs::remove_dir_all(hold.join(&e.id)) {
                    Ok(()) => false,
                    Err(err) if err.kind() == io::ErrorKind::NotFound => false,
                    Err(_) => {
                        failed += 1;
                        true
                    }
                }
            })
        })?;
        if failed > 0 {
            bail!("{failed} items couldn't be cleared");
        }
        Ok(())
    }

    /// Allowed paths, minus Sift's own data (the holding area lives there).
    fn ensure_allowed(&self, path: &Path) -> Result<()> {
        if path.starts_with(&self.root) {
            bail!("refusing to move Sift's own data");
        }
        ensure_allowed_in_home(path)
    }

    fn mutate(&self, f: impl FnOnce(&mut Vec<RestoreEntry>)) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut entries = self.load()?;
        f(&mut entries);
        self.save(&entries)
    }

    fn load(&self) -> Result<Vec<RestoreEntry>> {
        match fs::read(self.root.join(MANIFEST)) {
            Ok(bytes) => serde_json::from_slice(&bytes).context("reading restore.json"),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    /// Write to a temp file then rename, so a crash never leaves a torn
    /// manifest (which would orphan everything in the holding area).
    fn save(&self, entries: &[RestoreEntry]) -> Result<()> {
        fs::create_dir_all(&self.root)?;
        let tmp = self.root.join(format!("{MANIFEST}.{}.tmp", std::process::id()));
        fs::write(&tmp, serde_json::to_vec_pretty(entries)?)?;
        fs::rename(&tmp, self.root.join(MANIFEST))?;
        Ok(())
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Sift only ever touches things strictly inside the user's home folder (or
/// the OS temp folder), plus — for uninstalling — a macOS app bundle sitting
/// directly in /Applications. Never the home folder itself, nothing else
/// system-owned.
fn ensure_allowed_in_home(path: &Path) -> Result<()> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        bail!("refusing relative path {}", path.display());
    }
    if cfg!(target_os = "macos")
        && path.parent() == Some(Path::new("/Applications"))
        && path.extension().is_some_and(|x| x == "app")
    {
        return Ok(());
    }
    let roots = dirs::home_dir().into_iter().chain(std::iter::once(std::env::temp_dir()));
    for root in roots {
        if path != root && path.starts_with(&root) {
            return Ok(());
        }
    }
    bail!("{} is outside the areas Sift may change", path.display())
}

/// Rename, falling back to copy + delete when `src` and `dst` are on
/// different volumes.
fn move_path(src: &Path, dst: &Path) -> io::Result<()> {
    match fs::rename(src, dst) {
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
            copy_recursive(src, dst)?;
            remove_path(src)
        }
        other => other,
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else if meta.file_type().is_symlink() {
        let target = fs::read_link(src)?;
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, dst);
        #[cfg(windows)]
        return std::os::windows::fs::symlink_file(target, dst);
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

fn remove_path(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

/// `path` if it's free, else "stem (restored).ext", "stem (restored 2).ext", …
fn free_name(path: &Path) -> PathBuf {
    if fs::symlink_metadata(path).is_err() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|n| {
            let suffix = if n == 1 { " (restored)".to_string() } else { format!(" (restored {n})") };
            path.with_file_name(format!("{stem}{suffix}{ext}"))
        })
        .find(|p| fs::symlink_metadata(p).is_err())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &Path) -> RestoreStore {
        RestoreStore::new(dir.join("appdata"))
    }

    #[test]
    fn hold_then_restore_round_trips() {
        let home = dirs::home_dir().unwrap();
        let tmp = tempfile::Builder::new().prefix(".sift-test").tempdir_in(&home).unwrap();
        let store = store_in(tmp.path());
        let file = tmp.path().join("installer.dmg");
        fs::write(&file, b"hello").unwrap();

        let (entry, skipped) = store.hold(Origin::Category(FindingKind::OldInstallers), vec![(file.clone(), 5)], |_| {}).unwrap();
        let entry = entry.unwrap();
        assert_eq!(skipped, 0);
        assert!(!file.exists());
        assert_eq!(store.list().unwrap().len(), 1);

        // Something new took the original name meanwhile.
        fs::write(&file, b"new").unwrap();
        store.restore(&entry.id).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        assert_eq!(fs::read(tmp.path().join("installer (restored).dmg")).unwrap(), b"hello");
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn refuses_paths_outside_home() {
        assert!(ensure_allowed_in_home(Path::new("/etc/hosts")).is_err());
        assert!(ensure_allowed_in_home(&dirs::home_dir().unwrap()).is_err());
        assert!(ensure_allowed_in_home(&dirs::home_dir().unwrap().join("../x")).is_err());
        assert!(ensure_allowed_in_home(Path::new("/Applications")).is_err());
        assert!(ensure_allowed_in_home(Path::new("/Applications/Foo.app/Contents")).is_err());
        assert!(ensure_allowed_in_home(Path::new("/System/Applications/Mail.app")).is_err());
        if cfg!(target_os = "macos") {
            assert!(ensure_allowed_in_home(Path::new("/Applications/Foo.app")).is_ok());
        }
    }

    #[test]
    fn purges_expired_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let old = RestoreEntry {
            id: "old".into(),
            kind: Some(FindingKind::TempFiles),
            label: None,
            size_bytes: 1,
            removed_at_ms: now_ms() - RETENTION.as_millis() as u64 - 1,
            restorable: true,
            items: Vec::new(),
        };
        store.save(&[old]).unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn clear_now_deletes_held_files() {
        let home = dirs::home_dir().unwrap();
        let tmp = tempfile::Builder::new().prefix(".sift-test").tempdir_in(&home).unwrap();
        let store = store_in(tmp.path());
        let file = tmp.path().join("old.pkg");
        fs::write(&file, b"x").unwrap();
        let (entry, _) = store.hold(Origin::Category(FindingKind::OldInstallers), vec![(file, 1)], |_| {}).unwrap();
        let entry = entry.unwrap();
        let held = PathBuf::from(&entry.items[0].held_path);
        assert!(held.exists());

        store.clear(Some(&entry.id)).unwrap();
        assert!(!held.exists());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn hiding_cleared_records_keeps_held_items() {
        let home = dirs::home_dir().unwrap();
        let tmp = tempfile::Builder::new().prefix(".sift-test").tempdir_in(&home).unwrap();
        let store = store_in(tmp.path());
        let file = tmp.path().join("old.pkg");
        fs::write(&file, b"x").unwrap();
        let (held, _) = store.hold(Origin::Category(FindingKind::OldInstallers), vec![(file, 1)], |_| {}).unwrap();
        store.record_deleted(Origin::Label("cache".into()), 5).unwrap();
        assert_eq!(store.list().unwrap().len(), 2);

        store.hide_cleared().unwrap();
        let left = store.list().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, held.unwrap().id);
    }

    #[test]
    fn caches_and_trash_skip_the_hold() {
        assert!(!is_held(FindingKind::Trash));
        assert!(!is_held(FindingKind::TempFiles));
        assert!(is_held(FindingKind::OldInstallers));
    }

    #[test]
    fn trash_entries_are_not_restorable() {
        let home = dirs::home_dir().unwrap();
        let tmp = tempfile::Builder::new().prefix(".sift-test").tempdir_in(&home).unwrap();
        let store = store_in(tmp.path());
        let file = tmp.path().join("deleted.txt");
        fs::write(&file, b"x").unwrap();
        let (entry, _) = store.delete_permanently(Origin::Category(FindingKind::Trash), vec![(file.clone(), 1)], |_| {}).unwrap();
        assert!(!file.exists());
        assert!(store.restore(&entry.unwrap().id).is_err());
    }
}
