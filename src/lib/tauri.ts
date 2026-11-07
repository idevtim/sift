import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppInfo,
  AppList,
  BigFile,
  DevReport,
  Drive,
  DriveBreakdown,
  DuplicateGroup,
  ExploreView,
  FileFacts,
  Finding,
  FindingItem,
  FindingKind,
  FreeProgress,
  FreeUpReport,
  RestoreEntry,
  ScanProgress,
  ScanSummary,
  SearchHit,
} from "@/types/api";
import * as demo from "./demoFixtures";
import * as demoIdx from "./demoIndex";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Demo mode: serve the prototype's fixtures even under `tauri:dev`. */
const isDemo = () => import.meta.env.VITE_DEMO_MODE === "1";

/** True when `call()` should bypass IPC and return the fixture instead. */
export const useFixtures = () => !isTauri() || isDemo();

async function call<T>(cmd: string, fallback: () => T | Promise<T>, args?: Record<string, unknown>): Promise<T> {
  if (useFixtures()) return fallback();
  return invoke<T>(cmd, args);
}

/** Pretend a fixture took a moment, so loading states and the scan overlay are visible in the browser. */
const slow = <T,>(value: () => T, ms = 400) => () => new Promise<T>((r) => setTimeout(() => r(value()), ms));

/** Browser demo: access turns on a moment after "Open System Settings". */
let demoAccess = false;

export const api = {
  /** macOS Full Disk Access. Always true on Windows and Linux. */
  fullAccess: () => call<boolean>("full_access", () => demoAccess),
  openFullAccessSettings: () =>
    call<void>("open_full_access_settings", () => {
      setTimeout(() => (demoAccess = true), 2500);
    }),
  /** Quit and reopen Sift (macOS applies Full Disk Access to a fresh process). */
  relaunch: () =>
    call<void>("relaunch", () => {
      demoAccess = true;
    }),
  /** Schedule (or stop) the Sunday check-up with the OS. */
  setWeeklyCheck: (enabled: boolean) => call<void>("set_weekly_check", () => undefined, { enabled }),
  listDrives: () => call<Drive[]>("list_drives", () => demo.drives),
  ejectDrive: (mountPoint: string) => call<void>("eject_drive", () => undefined, { mountPoint }),
  scanFindings: () => call<Finding[]>("scan_findings", demo.demoStore.findings),
  /** Duplicate photos and large old videos — they need the disk index. */
  indexFindings: () => call<Finding[]>("index_findings", slow(demo.demoStore.indexFindings, 900)),
  /** Everything behind one Home category, biggest first. */
  findingItems: (kind: FindingKind) =>
    call<FindingItem[]>("finding_items", slow(() => demo.demoStore.findingItems(kind), 500), { kind }),
  /** What's on an external drive or SD card (never the system or a backup drive). */
  driveBreakdown: (mountPoint: string) =>
    call<DriveBreakdown>("drive_breakdown", slow(() => demoIdx.breakdown(mountPoint), 900), { mountPoint }),

  /**
   * Build the disk index. `onProgress` gets live counts; resolves with the
   * category totals when done.
   */
  async scanIndex(onProgress?: (p: ScanProgress) => void): Promise<ScanSummary> {
    if (useFixtures()) return simulateScan(onProgress);
    const unlisten = onProgress ? await listen<ScanProgress>("scan-progress", (e) => onProgress(e.payload)) : null;
    try {
      return await invoke<ScanSummary>("scan_index");
    } finally {
      unlisten?.();
    }
  },
  explore: (crumbs: string[]) => call<ExploreView>("explore", () => demoIdx.explore(crumbs), { crumbs }),
  searchIndex: (query: string) => call<SearchHit[]>("search_index", () => demoIdx.search(query), { query }),
  bigFiles: () => call<BigFile[]>("big_files", slow(demoIdx.demoIndex.bigFiles)),
  devReport: () => call<DevReport>("dev_report", slow(demoIdx.demoIndex.dev)),
  cleanDocker: () => call<void>("clean_docker", demoIdx.demoIndex.clearDocker),
  cleanSimulators: () => call<void>("clean_simulators", demoIdx.demoIndex.clearSimulators),
  findDuplicates: () => call<DuplicateGroup[]>("find_duplicates", slow(demoIdx.demoIndex.duplicates, 700)),
  /** A duplicate set's preview as a data URL (null: the drawn tile instead). */
  duplicatePreview: (hash: string) => call<string | null>("duplicate_preview", () => null, { hash }),
  duplicateFacts: (hash: string) =>
    call<FileFacts>("duplicate_facts", slow(() => demoIdx.duplicateFacts(hash), 150), { hash }),
  listApps: () => call<AppList>("list_apps", slow(demoIdx.demoIndex.apps)),
  /** An app's icon as a data URL (null when there isn't one; letter tile instead). */
  appIcon: (path: string) => call<string | null>("app_icon", () => null, { path }),
  /**
   * Uninstall an app by id. Windows programs, Flatpaks and Snaps run their
   * own uninstaller first; the rest (and all leftovers) go to Restore.
   */
  uninstallApp: (app: AppInfo) =>
    call<FreeUpReport>("uninstall_app", () => demo.demoStore.uninstallApp(app), { id: app.id }),
  revealPath: (path: string) => call<void>("reveal_path", () => undefined, { path }),

  /**
   * Remove specific paths as one Restore entry called `label`. Caches and
   * build output are deleted outright; everything else is held 30 days.
   * `demoBytes` / `demoRestorable` only shape the browser-mode entry.
   */
  freePaths: (paths: string[], label: string, demoBytes = 0, demoRestorable = true) =>
    call<FreeUpReport>("free_paths", slow(() => demo.demoStore.freePaths(paths, label, demoBytes, demoRestorable), 500), {
      paths,
      label,
    }),

  listRestore: () => call<RestoreEntry[]>("list_restore", demo.demoStore.restore),
  restoreEntry: (id: string) => call<void>("restore_entry", () => demo.demoStore.restoreEntry(id), { id }),
  /** "Clear now" — delete a held entry for good. No `id` clears all of them. */
  clearRestore: (id?: string) => call<void>("clear_restore", () => demo.demoStore.clear(id), { id: id ?? null }),
  /** Forget the records of things already deleted for good (nothing held is touched). */
  hideCleared: () => call<void>("hide_cleared", () => demo.demoStore.hideCleared()),

  /**
   * Move the chosen categories to Restore (Trash and caches are deleted for
   * good). `onProgress` gets 0–1 as items are handled.
   */
  async freeUp(kinds: FindingKind[], onProgress: (fraction: number) => void): Promise<FreeUpReport> {
    if (useFixtures()) {
      onProgress(1);
      return demo.demoStore.freeUp(kinds);
    }
    const unlisten = await listen<FreeProgress>("free-progress", ({ payload }) => {
      onProgress(payload.bytesTotal ? payload.bytesDone / payload.bytesTotal : 1);
    });
    try {
      const report = await invoke<FreeUpReport>("free_up", { kinds });
      onProgress(1);
      return report;
    } finally {
      unlisten();
    }
  },
};

/** Browser-mode scan: the prototype's 3.8s ease-out run over sample paths. */
function simulateScan(onProgress?: (p: ScanProgress) => void): Promise<ScanSummary> {
  const paths = [
    "~/Library/Caches/com.spotify.client",
    "~/Movies/Vacation 2023.mov",
    "/Applications/Xcode.app/Contents",
    "~/code/sift/target/debug",
    "~/Downloads/Figma-125.3.dmg",
    "~/Library/Developer/CoreSimulator",
    "~/Pictures/Photos Library.photoslibrary",
    "~/Documents/Work/Q3 deck.key",
    "~/.cargo/registry/cache",
    "~/code/web/node_modules/.pnpm",
  ];
  const { filesChecked, bytesChecked } = demoIdx.summary;
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 3800);
      const e = 1 - (1 - k) ** 2;
      onProgress?.({
        filesChecked: Math.floor(filesChecked * e),
        bytesChecked: bytesChecked * e,
        bytesExpected: bytesChecked,
        currentPath: paths[Math.floor(k * 46) % paths.length],
        done: k >= 1,
      });
      if (k < 1) setTimeout(tick, 50);
      else resolve(demoIdx.summary);
    };
    tick();
  });
}
