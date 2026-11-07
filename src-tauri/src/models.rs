use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveKind {
    Internal,
    External,
    Sd,
    Backup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub kind: DriveKind,
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    /// Backup volumes are read-only to Sift — never cleaned.
    pub protected: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    OldInstallers,
    Trash,
    AppLeftovers,
    TempFiles,
    DuplicatePhotos,
    LargeOldVideos,
}

/// One file or folder behind a Home category ("See all" on Review).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingItem {
    pub path: String,
    pub name: String,
    /// Plain words for where it is ("Downloads", "Library › Caches").
    pub location: String,
    pub size_bytes: u64,
    /// Held in Restore when removed; false means deleted for good (Trash,
    /// caches), same rule as `free_paths`.
    pub held: bool,
}

/// `Safe` items are pre-selected on Review; `Review` items ("Take a look")
/// start unselected.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Safety {
    Safe,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub kind: FindingKind,
    pub size_bytes: u64,
    pub item_count: u64,
    pub safety: Safety,
}

/// One removal batch in the Restore list (e.g. "Old installers").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEntry {
    pub id: String,
    /// Set for Home/Review categories; None for paths removed elsewhere
    /// (Big files, Explore, Duplicates, Developer), which carry a `label`.
    pub kind: Option<FindingKind>,
    #[serde(default)]
    pub label: Option<String>,
    pub size_bytes: u64,
    pub removed_at_ms: u64,
    /// False for emptied Trash — gone for good, listed so the user knows.
    pub restorable: bool,
    pub items: Vec<HeldItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldItem {
    pub original_path: String,
    pub held_path: String,
    pub size_bytes: u64,
}

/// Emitted as `free-progress` while `free_up` runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeProgress {
    pub kind: FindingKind,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeUpReport {
    pub freed_bytes: u64,
    /// Items that couldn't be moved (in use, permission denied). Left in place.
    pub skipped: u64,
}

/// Why Sift treats a path the way it does. `System` means leave alone; the
/// rest are things Sift can clear. The UI maps each to plain-words copy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    System,
    Cache,
    Trash,
    Installer,
    NodeModules,
    RustTarget,
    DerivedData,
}

impl Reason {
    /// Things that get rebuilt (or were already deleted) skip the Restore
    /// hold — holding them would only keep the space taken.
    pub fn deletes_outright(self) -> bool {
        matches!(self, Reason::Cache | Reason::Trash | Reason::NodeModules | Reason::RustTarget | Reason::DerivedData)
    }
}

/// One tile in Explore.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreNode {
    pub name: String,
    /// Real filesystem path; None for synthetic tiles ("Smaller items", the system total).
    pub path: Option<String>,
    pub size_bytes: u64,
    /// Bytes inside this tile that Sift can clear.
    pub free_bytes: u64,
    pub is_dir: bool,
    pub has_children: bool,
    pub reason: Option<Reason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreView {
    /// Names from the root down to this node.
    pub crumbs: Vec<String>,
    pub node: ExploreNode,
    pub children: Vec<ExploreNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BigFile {
    pub name: String,
    pub path: String,
    /// Top-level folder it lives in ("Movies", "Downloads").
    pub location: String,
    pub size_bytes: u64,
    pub last_opened_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DevKind {
    NodeModules,
    RustTarget,
    DerivedData,
    PackageCaches,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevArtifact {
    pub kind: DevKind,
    pub path: String,
    pub size_bytes: u64,
    /// Last change to the project around it — for "untouched for N days".
    pub project_modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCopy {
    pub path: String,
    /// Where it lives, in plain words ("Documents › Taxes").
    pub location: String,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// Content hash (BLAKE3, hex): the group's id and its preview's cache key.
    pub hash: String,
    pub name: String,
    pub kind: crate::scanners::kinds::FileKind,
    pub size_bytes: u64,
    /// Oldest first — the default keeper is index 0.
    pub copies: Vec<DuplicateCopy>,
}

/// What Spotlight knows about a duplicate's contents (macOS; all empty
/// elsewhere). Shown as the "same file" facts on Duplicates.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_secs: Option<f64>,
    pub pages: Option<u32>,
    /// When the contents were made (photo taken, video recorded).
    pub created_ms: Option<u64>,
    pub bit_rate_kbps: Option<u32>,
}

/// Emitted as `scan-progress` while the index builds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files_checked: u64,
    pub bytes_checked: u64,
    /// Rough total to measure progress against (previous scan, or disk usage).
    pub bytes_expected: u64,
    pub current_path: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub files_checked: u64,
    pub bytes_checked: u64,
    pub categories: Vec<CategoryTotal>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Apps,
    Media,
    Documents,
    Developer,
    System,
    Other,
    Freeable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category: Category,
    pub size_bytes: u64,
}

/// A ⌘K file hit: enough to open Explore at its folder with it selected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub name: String,
    pub path: String,
    /// Explore crumbs of the folder that contains it.
    pub parent_crumbs: Vec<String>,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub reason: Option<Reason>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppPartKind {
    App,
    Caches,
    Support,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPart {
    pub kind: AppPartKind,
    pub size_bytes: u64,
    pub paths: Vec<String>,
}

/// Where an app came from, which decides how it's uninstalled.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppSource {
    /// A macOS .app bundle: moved to Restore with its leftovers.
    Bundle,
    /// A Windows program: its own uninstaller runs, then leftovers go to Restore.
    Installer,
    Flatpak,
    Snap,
    /// A Linux AppImage file: moved to Restore with its leftovers.
    AppImage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Stable key for `uninstall_app` (bundle path, registry key, flatpak id…).
    pub id: String,
    pub name: String,
    pub path: String,
    pub source: AppSource,
    pub last_opened_ms: Option<u64>,
    pub installed_ms: Option<u64>,
    pub running: bool,
    pub parts: Vec<AppPart>,
    /// Where the app's icon file is (`.icns`, `.exe`, `.png`, …); `app_icon`
    /// turns it into an image.
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppList {
    /// False where Sift can't list apps (no supported package source found).
    pub supported: bool,
    pub apps: Vec<AppInfo>,
}

/// An external drive or SD card, sorted into categories. `Freeable` here
/// means copies of files that are also on this computer (shown, never
/// cleaned — Sift doesn't change other drives).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveBreakdown {
    pub categories: Vec<CategoryTotal>,
    pub photos: u64,
    pub videos: u64,
}
