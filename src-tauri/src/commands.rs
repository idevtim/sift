use crate::models::{
    AppList, BigFile, DevArtifact, Drive, DriveBreakdown, DriveKind, DuplicateGroup, ExploreView, FileFacts,
    Finding, FindingItem, FindingKind, FreeProgress, FreeUpReport, RestoreEntry, ScanProgress, ScanSummary, SearchHit,
};
use crate::process_ext::{output, NoWindow};
use crate::restore::{self, Origin, RestoreStore};
use crate::scanners::{self, index::Index, kinds};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager, State};

/// Run a synchronous, potentially-blocking closure on the Tauri async
/// runtime's blocking thread pool. Keeps the OS main thread free so the
/// webview can keep painting.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task panicked: {e}"))?
}

// ── Index state ───────────────────────────────────────────────────────

/// The latest disk index, plus caches derived from it.
#[derive(Default)]
pub struct IndexState {
    index: RwLock<Option<Index>>,
    duplicates: Mutex<Option<Arc<Vec<DuplicateGroup>>>>,
    /// Serializes scans; a second request waits and reuses the result.
    building: Mutex<()>,
    /// Bumped by every finished scan, so work started against an older
    /// index can tell (and a waiting scan request can reuse a fresh one).
    generation: AtomicU64,
}

pub type SharedIndex = Arc<IndexState>;

const SCAN_META: &str = "scan-meta.json";

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn system_drive() -> Option<Drive> {
    let drives = scanners::disks::list();
    drives.iter().find(|d| d.kind == crate::models::DriveKind::Internal).or(drives.first()).cloned()
}

fn run_scan(app: &AppHandle, state: &IndexState) -> Result<ScanSummary, String> {
    let seen = state.generation.load(Ordering::SeqCst);
    let _g = state.building.lock().unwrap();
    // Another request finished a scan while this one waited: that's fresh.
    if state.generation.load(Ordering::SeqCst) != seen {
        if let Some(index) = state.index.read().unwrap().as_ref() {
            return Ok(index.summary.clone());
        }
    }
    scan_locked(app, state)
}

/// The scan itself; the caller holds `state.building`.
fn scan_locked(app: &AppHandle, state: &IndexState) -> Result<ScanSummary, String> {
    let data = app_data(app)?;
    let drive = system_drive();
    let used = drive.as_ref().map_or(0, |d| d.used_bytes);
    // Last scan's byte total is the best progress denominator we have.
    let expected = std::fs::read(data.join(SCAN_META))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["bytesChecked"].as_u64())
        .unwrap_or(used);
    let name = drive.map_or_else(|| "This computer".into(), |d| d.name);
    let index = scanners::background(|| {
        scanners::index::build(data.clone(), name, used, expected, |p: ScanProgress| {
            let _ = app.emit("scan-progress", p);
        })
    })
    .ok_or("couldn't find your home folder")?;
    let summary = index.summary.clone();
    let _ = std::fs::create_dir_all(&data);
    let _ = std::fs::write(data.join(SCAN_META), serde_json::to_vec(&summary).unwrap_or_default());
    *state.index.write().unwrap() = Some(index);
    *state.duplicates.lock().unwrap() = None;
    state.generation.fetch_add(1, Ordering::SeqCst);
    Ok(summary)
}

/// Run `f` against the index, scanning first if there isn't one yet.
fn with_index<T>(app: &AppHandle, state: &IndexState, f: impl FnOnce(&Index) -> T) -> Result<T, String> {
    if state.index.read().unwrap().is_none() {
        let _g = state.building.lock().unwrap();
        // Another request may have finished a scan while we waited.
        if state.index.read().unwrap().is_none() {
            scan_locked(app, state)?;
        }
    }
    let guard = state.index.read().unwrap();
    Ok(f(guard.as_ref().ok_or("no index")?))
}

fn forget(state: &IndexState, paths: &[PathBuf]) {
    if let Some(index) = state.index.write().unwrap().as_mut() {
        index.forget_removed(paths);
    }
    // Prune the cached duplicate groups rather than dropping them: hashing
    // every candidate again after each removal kept all cores busy.
    let mut cached = state.duplicates.lock().unwrap();
    if let Some(groups) = cached.as_ref() {
        *cached = Some(Arc::new(scanners::duplicates::without(groups, paths)));
    }
}

// ── Drives & findings ────────────────────────────────────────────────

#[tauri::command]
pub async fn list_drives() -> Result<Vec<Drive>, String> {
    blocking(|| Ok(scanners::disks::list())).await
}

// ── Full Disk Access ──────────────────────────────────────────────────

#[tauri::command]
pub async fn full_access() -> Result<bool, String> {
    blocking(|| Ok(crate::access::granted())).await
}

#[tauri::command]
pub async fn open_full_access_settings() -> Result<(), String> {
    blocking(crate::access::open_settings).await
}

/// macOS only applies Full Disk Access to a fresh process.
#[tauri::command]
pub fn relaunch(app: AppHandle) {
    app.restart();
}

/// Turn the Sunday check-up on or off (the app calls this at every launch).
#[tauri::command]
pub async fn set_weekly_check(enabled: bool) -> Result<(), String> {
    blocking(move || crate::checkup::schedule(enabled)).await
}

#[tauri::command]
pub async fn scan_findings() -> Result<Vec<Finding>, String> {
    blocking(|| Ok(scanners::findings::scan())).await
}

/// Safely eject an external drive so it can be unplugged.
#[tauri::command]
pub async fn eject_drive(mount_point: String) -> Result<(), String> {
    blocking(move || {
        let drive = scanners::disks::list().into_iter().find(|d| d.mount_point == mount_point);
        match drive {
            Some(d) if d.kind != crate::models::DriveKind::Internal => {}
            _ => return Err("That drive can't be ejected".into()),
        }
        let ok = if cfg!(target_os = "macos") {
            output("diskutil", &["eject", &mount_point]).is_some()
        } else if cfg!(target_os = "windows") {
            let letter = mount_point.trim_end_matches('\\');
            let script = format!(
                "(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{letter}').InvokeVerb('Eject')"
            );
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .no_window()
                .status()
                .is_ok_and(|s| s.success())
        } else {
            output("gio", &["mount", "--eject", &mount_point]).is_some()
                || output("udisksctl", &["unmount", "--force", "-b", &mount_point]).is_some()
        };
        ok.then_some(()).ok_or_else(|| "Something on the drive is still in use. Close it and try again.".into())
    })
    .await
}

// ── Index-backed views ───────────────────────────────────────────────

/// Build (or rebuild) the index. Emits `scan-progress`.
#[tauri::command]
pub async fn scan_index(app: AppHandle, state: State<'_, SharedIndex>) -> Result<ScanSummary, String> {
    let state = Arc::clone(&state);
    blocking(move || run_scan(&app, &state)).await
}

#[tauri::command]
pub async fn explore(app: AppHandle, state: State<'_, SharedIndex>, crumbs: Vec<String>) -> Result<ExploreView, String> {
    let state = Arc::clone(&state);
    blocking(move || with_index(&app, &state, |i| i.explore(&crumbs))?.ok_or_else(|| "That folder is gone".into())).await
}

#[tauri::command]
pub async fn search_index(
    app: AppHandle,
    state: State<'_, SharedIndex>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        with_index(&app, &state, |i| i.search(query.trim(), 20))
    })
    .await
}

#[tauri::command]
pub async fn big_files(app: AppHandle, state: State<'_, SharedIndex>) -> Result<Vec<BigFile>, String> {
    let state = Arc::clone(&state);
    blocking(move || with_index(&app, &state, |i| i.big_files.clone())).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevReport {
    artifacts: Vec<DevArtifact>,
    /// None when Docker isn't installed or running.
    docker_bytes: Option<u64>,
    /// None when there are no unavailable simulators (or no Xcode).
    simulator_bytes: Option<u64>,
}

#[tauri::command]
pub async fn dev_report(app: AppHandle, state: State<'_, SharedIndex>) -> Result<DevReport, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let artifacts = with_index(&app, &state, |i| i.dev.clone())?;
        let (docker_bytes, simulator_bytes) =
            rayon::join(scanners::devtools::docker_dangling_bytes, scanners::devtools::simulator_bytes);
        Ok(DevReport { artifacts, docker_bytes, simulator_bytes })
    })
    .await
}

#[tauri::command]
pub async fn clean_docker() -> Result<(), String> {
    blocking(scanners::devtools::docker_prune).await
}

#[tauri::command]
pub async fn clean_simulators() -> Result<(), String> {
    blocking(scanners::devtools::delete_unavailable_simulators).await
}

#[tauri::command]
pub async fn find_duplicates(app: AppHandle, state: State<'_, SharedIndex>) -> Result<Arc<Vec<DuplicateGroup>>, String> {
    let state = Arc::clone(&state);
    blocking(move || duplicate_groups(&app, &state)).await
}

/// Duplicate groups, hashed once per index and cached.
fn duplicate_groups(app: &AppHandle, state: &IndexState) -> Result<Arc<Vec<DuplicateGroup>>, String> {
    if let Some(cached) = state.duplicates.lock().unwrap().clone() {
        return Ok(cached);
    }
    let home = dirs::home_dir().unwrap_or_default();
    // Hash outside the index lock: it reads files and can take minutes, and
    // a rescan must be able to swap the index in meanwhile.
    let (candidates, generation) =
        with_index(app, state, |i| (i.dupe_candidates.clone(), state.generation.load(Ordering::SeqCst)))?;
    let groups = Arc::new(scanners::background(|| {
        scanners::duplicates::find(&candidates, |p| location_words(p, &home))
    }));
    // Only cache what matches the current index.
    if state.generation.load(Ordering::SeqCst) == generation {
        *state.duplicates.lock().unwrap() = Some(Arc::clone(&groups));
    }
    Ok(groups)
}

/// A copy of the cached duplicate group with this content hash that's
/// still on disk. Paths never come from the UI.
fn duplicate_copy(state: &IndexState, hash: &str) -> Option<PathBuf> {
    let groups = state.duplicates.lock().unwrap().clone()?;
    let group = groups.iter().find(|g| g.hash == hash)?;
    group.copies.iter().map(|c| PathBuf::from(&c.path)).find(|p| p.is_file())
}

/// A duplicate set's preview as a data URL; null shows the drawn tile.
#[tauri::command]
pub async fn duplicate_preview(
    app: AppHandle,
    state: State<'_, SharedIndex>,
    hash: String,
) -> Result<Option<String>, String> {
    let cache = app_data(&app)?.join("previews");
    let state = Arc::clone(&state);
    blocking(move || {
        Ok(duplicate_copy(&state, &hash).and_then(|p| scanners::previews::thumbnail(&p, &hash, &cache)))
    })
    .await
}

/// What a duplicate set's contents are (dimensions, length, pages…).
#[tauri::command]
pub async fn duplicate_facts(state: State<'_, SharedIndex>, hash: String) -> Result<FileFacts, String> {
    let state = Arc::clone(&state);
    blocking(move || Ok(duplicate_copy(&state, &hash).map(|p| scanners::previews::facts(&p)).unwrap_or_default())).await
}

/// Home's "Duplicate photos": every copy but the oldest of each photo
/// group. Re-checked against the disk, so a changed or missing original
/// means that group is left alone.
fn duplicate_photo_extras(groups: &[DuplicateGroup]) -> Vec<(PathBuf, u64)> {
    let same_size = |p: &str, size: u64| std::fs::metadata(p).is_ok_and(|m| m.len() == size);
    groups
        .iter()
        .filter(|g| kinds::of(Path::new(&g.name)) == kinds::FileKind::Photo)
        .filter(|g| same_size(&g.copies[0].path, g.size_bytes))
        .flat_map(|g| {
            g.copies[1..]
                .iter()
                .filter(move |c| same_size(&c.path, g.size_bytes))
                .map(move |c| (PathBuf::from(&c.path), g.size_bytes))
        })
        .collect()
}

/// Home's "Large old videos", re-checked against the disk.
fn old_video_paths(index: &Index) -> Vec<(PathBuf, u64)> {
    index
        .old_videos
        .iter()
        .filter_map(|v| Some((PathBuf::from(&v.path), std::fs::metadata(&v.path).ok()?.len())))
        .collect()
}

/// The Home categories that need the disk index: duplicate photos and
/// large old videos. Separate from `scan_findings` so Home can show the
/// quick categories while the index builds.
#[tauri::command]
pub async fn index_findings(app: AppHandle, state: State<'_, SharedIndex>) -> Result<Vec<Finding>, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let photos = duplicate_photo_extras(&duplicate_groups(&app, &state)?);
        let videos = with_index(&app, &state, old_video_paths)?;
        Ok([(FindingKind::DuplicatePhotos, photos), (FindingKind::LargeOldVideos, videos)]
            .into_iter()
            .filter(|(_, items)| !items.is_empty())
            .map(|(kind, items)| {
                let bytes = items.iter().map(|(_, s)| s).sum();
                scanners::findings::finding(kind, bytes, items.len() as u64)
            })
            .collect())
    })
    .await
}

/// "Documents › Taxes" — the folder a file is in, relative to home.
fn location_words(path: &Path, home: &Path) -> String {
    let parent = path.parent().unwrap_or(path);
    match parent.strip_prefix(home) {
        Ok(rel) if rel.as_os_str().is_empty() => "Home".into(),
        Ok(rel) => rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join(" › "),
        Err(_) if parent.starts_with(std::env::temp_dir()) => "Temporary folder".into(),
        Err(_) => parent.to_string_lossy().into_owned(),
    }
}

/// Everything behind one Home category, biggest first — what "Free up"
/// would remove, so Review's "See all" can show it and remove items one
/// at a time. The Windows Recycle Bin can't be listed item by item.
#[tauri::command]
pub async fn finding_items(
    app: AppHandle,
    state: State<'_, SharedIndex>,
    kind: FindingKind,
) -> Result<Vec<FindingItem>, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let sized: Vec<(PathBuf, u64)> = match kind {
            FindingKind::DuplicatePhotos => duplicate_photo_extras(&duplicate_groups(&app, &state)?),
            FindingKind::LargeOldVideos => with_index(&app, &state, old_video_paths)?,
            _ => scanners::findings::items(kind)
                .into_par_iter()
                .map(|p| {
                    let size = scanners::dir_size(&p).0;
                    (p, size)
                })
                .collect(),
        };
        let home = dirs::home_dir().unwrap_or_default();
        let data = app_data(&app)?;
        let mut items: Vec<FindingItem> = sized
            .into_iter()
            .filter(|(_, size)| *size > 0)
            .map(|(p, size)| FindingItem {
                held: !scanners::index::reason_for(&p, data.clone()).is_some_and(|r| r.deletes_outright()),
                name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                location: location_words(&p, &home),
                path: p.to_string_lossy().into_owned(),
                size_bytes: size,
            })
            .collect();
        items.sort_by_key(|i| std::cmp::Reverse(i.size_bytes));
        Ok(items)
    })
    .await
}

/// An app's icon as a data URL, from the `icon` path `list_apps` gave.
/// Only icon files are read, and the result is only ever an image.
#[tauri::command]
pub async fn app_icon(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let cache = app_data(&app)?.join("icons");
    blocking(move || {
        let path = PathBuf::from(path);
        Ok(if path.is_absolute() { scanners::icons::data_url(&path, &cache) } else { None })
    })
    .await
}

#[tauri::command]
pub async fn list_apps() -> Result<AppList, String> {
    blocking(|| Ok(scanners::apps::list())).await
}

// ── Freeing ──────────────────────────────────────────────────────────

/// Free the selected categories. Most go to the Restore holding area; the
/// Trash and temporary files are deleted for good (`restore::is_held`).
/// Emits `free-progress`.
#[tauri::command]
pub async fn free_up(
    app: AppHandle,
    store: State<'_, Arc<RestoreStore>>,
    index: State<'_, SharedIndex>,
    kinds: Vec<FindingKind>,
) -> Result<FreeUpReport, String> {
    let store = Arc::clone(&store);
    let index = Arc::clone(&index);
    blocking(move || {
        // The Windows Recycle Bin is emptied by the shell, not path by path.
        let mut report = FreeUpReport { freed_bytes: 0, skipped: 0 };
        let mut kinds = kinds;
        if cfg!(windows) && kinds.contains(&FindingKind::Trash) {
            kinds.retain(|k| *k != FindingKind::Trash);
            let (bytes, _) = scanners::recycle_bin::query().unwrap_or((0, 0));
            if scanners::recycle_bin::empty() {
                let entry = store.record_deleted(Origin::Category(FindingKind::Trash), bytes).map_err(|e| e.to_string())?;
                report.freed_bytes += entry.map_or(0, |e| e.size_bytes);
            } else {
                report.skipped += 1;
            }
        }

        // Re-resolve targets now — the disk may have changed since the scan.
        let plan: Vec<(FindingKind, Vec<_>)> = kinds
            .into_iter()
            .map(|kind| {
                let sized = match kind {
                    FindingKind::DuplicatePhotos => duplicate_photo_extras(&duplicate_groups(&app, &index)?),
                    FindingKind::LargeOldVideos => with_index(&app, &index, old_video_paths)?,
                    _ => scanners::findings::targets(kind)
                        .into_par_iter()
                        .map(|p| {
                            let size = scanners::dir_size(&p).0;
                            (p, size)
                        })
                        .collect::<Vec<_>>(),
                };
                Ok((kind, sized))
            })
            .collect::<Result<_, String>>()?;
        let bytes_total: u64 = plan.iter().flat_map(|(_, v)| v).map(|(_, s)| s).sum();
        let touched: Vec<PathBuf> = plan.iter().flat_map(|(_, v)| v.iter().map(|(p, _)| p.clone())).collect();

        let mut bytes_done = 0;
        for (kind, paths) in plan {
            let progress = |size: u64| {
                bytes_done += size;
                let _ = app.emit("free-progress", FreeProgress { kind, bytes_done, bytes_total });
            };
            let (entry, skipped) = if restore::is_held(kind) {
                store.hold(Origin::Category(kind), paths, progress)
            } else {
                store.delete_permanently(Origin::Category(kind), paths, progress)
            }
            .map_err(|e| e.to_string())?;
            report.freed_bytes += entry.map_or(0, |e| e.size_bytes);
            report.skipped += skipped;
        }
        forget(&index, &touched);
        Ok(report)
    })
    .await
}

/// Free specific paths (Big files, Explore, Duplicates, Developer, Apps) as
/// one Restore entry called `label`. Caches and build output are deleted
/// outright; everything else is held for 30 days.
#[tauri::command]
pub async fn free_paths(
    app: AppHandle,
    store: State<'_, Arc<RestoreStore>>,
    index: State<'_, SharedIndex>,
    paths: Vec<String>,
    label: String,
) -> Result<FreeUpReport, String> {
    let store = Arc::clone(&store);
    let index = Arc::clone(&index);
    blocking(move || {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        free_paths_now(&app, &store, &index, &paths, label)
    })
    .await
}

fn free_paths_now(
    app: &AppHandle,
    store: &RestoreStore,
    index: &IndexState,
    paths: &[PathBuf],
    label: String,
) -> Result<FreeUpReport, String> {
    let data = app_data(app)?;
    let paths = scanners::findings::with_trash_records(paths);
    let (delete, hold): (Vec<_>, Vec<_>) = paths
        .par_iter()
        .map(|p| {
            let deletes = scanners::index::reason_for(p, data.clone()).is_some_and(|r| r.deletes_outright());
            (p.clone(), scanners::dir_size(p).0, deletes)
        })
        .collect::<Vec<_>>()
        .into_iter()
        .partition(|(_, _, deletes)| *deletes);
    let strip = |v: Vec<(PathBuf, u64, bool)>| v.into_iter().map(|(p, s, _)| (p, s)).collect::<Vec<_>>();

    let mut report = FreeUpReport { freed_bytes: 0, skipped: 0 };
    for (entry, skipped) in [
        store.hold(Origin::Label(label.clone()), strip(hold), |_| {}),
        store.delete_permanently(Origin::Label(label), strip(delete), |_| {}),
    ]
    .into_iter()
    .map(|r| r.map_err(|e| e.to_string()))
    .collect::<Result<Vec<_>, _>>()?
    {
        report.freed_bytes += entry.map_or(0, |e| e.size_bytes);
        report.skipped += skipped;
    }
    forget(index, &paths);
    Ok(report)
}

/// Uninstall an app (looked up again by `id`, never trusted from the UI).
/// Programs with their own uninstaller run it first; then the app (for
/// bundles and AppImages) and its leftovers go to Restore.
#[tauri::command]
pub async fn uninstall_app(
    app: AppHandle,
    store: State<'_, Arc<RestoreStore>>,
    index: State<'_, SharedIndex>,
    id: String,
) -> Result<FreeUpReport, String> {
    let store = Arc::clone(&store);
    let index = Arc::clone(&index);
    blocking(move || {
        let target = scanners::apps::list()
            .apps
            .into_iter()
            .find(|a| a.id == id)
            .ok_or("That app is already gone")?;
        if target.running {
            return Err(format!("Quit {} first, then try again.", target.name));
        }
        scanners::apps::stop_helpers(&target);
        scanners::apps::run_uninstaller(&target)?;
        let paths = scanners::apps::paths_to_free(&target);
        free_paths_now(&app, &store, &index, &paths, target.name)
    })
    .await
}

/// What's on an external drive or SD card (read-only). Backup drives and
/// the system drive aren't walked: one is off limits, the other is the index.
#[tauri::command]
pub async fn drive_breakdown(
    state: State<'_, SharedIndex>,
    mount_point: String,
) -> Result<DriveBreakdown, String> {
    let state = Arc::clone(&state);
    blocking(move || {
        let drive = scanners::disks::list().into_iter().find(|d| d.mount_point == mount_point);
        match drive {
            Some(d) if d.kind != DriveKind::Internal && !d.protected => {}
            _ => return Err("Sift doesn't look inside that drive".into()),
        }
        // Compare against this computer's files when the index is ready;
        // don't start a full scan just for this.
        let home_files = state.index.read().unwrap().as_ref().map(|i| i.dupe_candidates.clone()).unwrap_or_default();
        Ok(scanners::background(|| scanners::volume::breakdown(Path::new(&mount_point), &home_files)))
    })
    .await
}

/// Open the system file manager with `path` selected.
#[tauri::command]
pub async fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

// ── Restore ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_restore(store: State<'_, Arc<RestoreStore>>) -> Result<Vec<RestoreEntry>, String> {
    let store = Arc::clone(&store);
    blocking(move || store.list().map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn restore_entry(store: State<'_, Arc<RestoreStore>>, id: String) -> Result<(), String> {
    let store = Arc::clone(&store);
    blocking(move || store.restore(&id).map_err(|e| e.to_string())).await
}

/// "Clear now" — delete a held entry for good. No `id` clears all of them.
#[tauri::command]
pub async fn clear_restore(store: State<'_, Arc<RestoreStore>>, id: Option<String>) -> Result<(), String> {
    let store = Arc::clone(&store);
    blocking(move || store.clear(id.as_deref()).map_err(|e| e.to_string())).await
}

/// Drop Restore's records of things already deleted for good.
#[tauri::command]
pub async fn hide_cleared(store: State<'_, Arc<RestoreStore>>) -> Result<(), String> {
    let store = Arc::clone(&store);
    blocking(move || store.hide_cleared().map_err(|e| e.to_string())).await
}
