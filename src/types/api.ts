// TS mirrors of src-tauri/src/models.rs — keep them 1:1.

export type DriveKind = "internal" | "external" | "sd" | "backup";

export interface Drive {
  id: string;
  name: string;
  mountPoint: string;
  kind: DriveKind;
  capacityBytes: number;
  usedBytes: number;
  /** Backup volumes are read-only to Sift — never cleaned. */
  protected: boolean;
}

export type FindingKind =
  | "oldInstallers"
  | "trash"
  | "appLeftovers"
  | "tempFiles"
  | "duplicatePhotos"
  | "largeOldVideos";

export type Safety = "safe" | "review";

export interface Finding {
  id: string;
  kind: FindingKind;
  sizeBytes: number;
  itemCount: number;
  safety: Safety;
}

/** One file or folder behind a Home category (Review → "See all"). */
export interface FindingItem {
  path: string;
  name: string;
  /** Plain words for where it is ("Downloads", "Library › Caches"). */
  location: string;
  sizeBytes: number;
  /** Held in Restore when removed; false means deleted for good (Trash, caches). */
  held: boolean;
}

/** One removal batch in the Restore list (e.g. "Old installers"). */
export interface RestoreEntry {
  id: string;
  /** Set for Home/Review categories; null for paths removed elsewhere, which carry a `label`. */
  kind: FindingKind | null;
  label: string | null;
  sizeBytes: number;
  removedAtMs: number;
  /** False for emptied Trash — gone for good, listed so the user knows. */
  restorable: boolean;
  items: HeldItem[];
}

export interface HeldItem {
  originalPath: string;
  heldPath: string;
  sizeBytes: number;
}

/** Payload of the `free-progress` event. */
export interface FreeProgress {
  kind: FindingKind;
  bytesDone: number;
  bytesTotal: number;
}

export interface FreeUpReport {
  freedBytes: number;
  /** Items that couldn't be moved (in use, permission denied). Left in place. */
  skipped: number;
}

/** Why Sift treats a path the way it does. `system` = leave alone; the rest can be cleared. */
export type Reason = "system" | "cache" | "trash" | "installer" | "nodeModules" | "rustTarget" | "derivedData";

export interface ExploreNode {
  name: string;
  /** null for synthetic tiles ("Smaller items", the system total). */
  path: string | null;
  sizeBytes: number;
  freeBytes: number;
  isDir: boolean;
  hasChildren: boolean;
  reason: Reason | null;
}

export interface ExploreView {
  crumbs: string[];
  node: ExploreNode;
  children: ExploreNode[];
}

export interface BigFile {
  name: string;
  path: string;
  location: string;
  sizeBytes: number;
  lastOpenedMs: number;
}

export type DevKind = "nodeModules" | "rustTarget" | "derivedData" | "packageCaches";

export interface DevArtifact {
  kind: DevKind;
  path: string;
  sizeBytes: number;
  projectModifiedMs: number;
}

export interface DevReport {
  artifacts: DevArtifact[];
  /** null when Docker isn't installed or running. */
  dockerBytes: number | null;
  /** null when there are no unavailable simulators. */
  simulatorBytes: number | null;
}

export interface DuplicateCopy {
  path: string;
  location: string;
  modifiedMs: number;
}

/** What sort of file something is, by extension (`scanners/kinds.rs`). */
export type FileKind = "photo" | "video" | "audio" | "document" | "app" | "other";

export interface DuplicateGroup {
  /** Content hash: the set's id and its preview's cache key. */
  hash: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  /** Oldest first — the default keeper is index 0. */
  copies: DuplicateCopy[];
}

/** What Spotlight knows about a duplicate's contents (macOS; empty elsewhere). */
export interface FileFacts {
  width: number | null;
  height: number | null;
  durationSecs: number | null;
  pages: number | null;
  /** When the contents were made (photo taken, video recorded). */
  createdMs: number | null;
  bitRateKbps: number | null;
}

export interface ScanProgress {
  filesChecked: number;
  bytesChecked: number;
  bytesExpected: number;
  currentPath: string;
  done: boolean;
}

export type Category = "apps" | "media" | "documents" | "developer" | "system" | "other" | "freeable";

export interface CategoryTotal {
  category: Category;
  sizeBytes: number;
}

export interface ScanSummary {
  filesChecked: number;
  bytesChecked: number;
  categories: CategoryTotal[];
}

export interface SearchHit {
  name: string;
  path: string;
  /** Explore crumbs of the containing folder. */
  parentCrumbs: string[];
  sizeBytes: number;
  isDir: boolean;
  reason: Reason | null;
}

export type AppPartKind = "app" | "caches" | "support";

export interface AppPart {
  kind: AppPartKind;
  sizeBytes: number;
  paths: string[];
}

/** Where an app came from, which decides how it's uninstalled. */
export type AppSource = "bundle" | "installer" | "flatpak" | "snap" | "appImage";

export interface AppInfo {
  /** Stable key for `uninstallApp` (bundle path, registry key, flatpak id…). */
  id: string;
  name: string;
  path: string;
  source: AppSource;
  lastOpenedMs: number | null;
  installedMs: number | null;
  running: boolean;
  parts: AppPart[];
  /** Where the icon file is; `api.appIcon` turns it into an image. */
  icon: string | null;
}

export interface AppList {
  /** False where Sift can't list apps (no supported package source found). */
  supported: boolean;
  apps: AppInfo[];
}

/**
 * An external drive or SD card, sorted into categories. `freeable` here
 * means copies of files that are also on this computer — shown, never
 * cleaned.
 */
export interface DriveBreakdown {
  categories: CategoryTotal[];
  photos: number;
  videos: number;
}
