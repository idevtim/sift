// Sample data from the design prototype.
// Served by `api.*` when running outside Tauri or with VITE_DEMO_MODE=1.

import { demoIndex } from "./demoIndex";
import type { AppInfo, Drive, Finding, FindingItem, FindingKind, FreeUpReport, RestoreEntry } from "@/types/api";

const GB = 1e9;

export const findings: Finding[] = [
  { id: "old-installers", kind: "oldInstallers", sizeBytes: 9.1 * GB, itemCount: 14, safety: "safe" },
  { id: "trash", kind: "trash", sizeBytes: 6.8 * GB, itemCount: 212, safety: "safe" },
  { id: "app-leftovers", kind: "appLeftovers", sizeBytes: 4.3 * GB, itemCount: 7, safety: "safe" },
  { id: "temp-files", kind: "tempFiles", sizeBytes: 12.0 * GB, itemCount: 48_210, safety: "safe" },
  { id: "duplicate-photos", kind: "duplicatePhotos", sizeBytes: 4.2 * GB, itemCount: 312, safety: "review" },
  { id: "large-old-videos", kind: "largeOldVideos", sizeBytes: 18.2 * GB, itemCount: 9, safety: "review" },
];

export const drives: Drive[] = [
  { id: "/", name: "Macintosh HD", mountPoint: "/", kind: "internal", capacityBytes: 994.3 * GB, usedBytes: 278.6 * GB, protected: false },
  { id: "/Volumes/Archive SSD", name: "Archive SSD", mountPoint: "/Volumes/Archive SSD", kind: "external", capacityBytes: 1000 * GB, usedBytes: 420 * GB, protected: false },
  { id: "/Volumes/Camera card", name: "Camera card", mountPoint: "/Volumes/Camera card", kind: "sd", capacityBytes: 128 * GB, usedBytes: 97 * GB, protected: false },
  { id: "/Volumes/Time Machine", name: "Time Machine", mountPoint: "/Volumes/Time Machine", kind: "backup", capacityBytes: 2000 * GB, usedBytes: 1430 * GB, protected: true },
];

const DEMO_ITEMS: Record<FindingKind, [string, string][]> = {
  oldInstallers: [["Xcode_15.dmg", "Downloads"], ["Figma-125.3.dmg", "Downloads"], ["Zoom.pkg", "Downloads"], ["Docker.dmg", "Downloads"], ["Slack-4.36.dmg", "Downloads"]],
  trash: [["Old exports", ".Trash"], ["Screen Recording 2024-03-02.mov", ".Trash"], ["Archive.zip", ".Trash"], ["IMG_2231.HEIC", ".Trash"]],
  appLeftovers: [["com.adobe.Photoshop", "Library › Application Support"], ["com.spotify.client", "Library › Caches"], ["com.tinyspeck.slackmacgap", "Library › Application Support"], ["com.figma.Desktop.plist", "Library › Preferences"]],
  tempFiles: [["com.apple.Safari", "Library › Caches"], ["Google", "Library › Caches"], ["com.spotify.client", "Library › Caches"], ["Homebrew", "Library › Caches"], ["pip", "Library › Caches"], ["com.microsoft.VSCode.ShipIt", "Library › Caches"]],
  duplicatePhotos: [["IMG_4410 copy.HEIC", "Pictures › Exports"], ["Beach (1).jpg", "Downloads"], ["DSC_0192.JPG", "Desktop › Old phone"], ["Wedding-12.jpg", "Documents › Prints"]],
  largeOldVideos: [["Vacation 2023.mov", "Movies"], ["Recital.mp4", "Movies › 2022"], ["Drone flight.mov", "Desktop"]],
};

// ── Browser-mode Restore: an in-memory stand-in for the Rust holding area so
// the free → done → restore loop works without Tauri. Resets on reload.

/** Kinds that come from the disk index (`api.indexFindings`). */
export const INDEX_KINDS: FindingKind[] = ["duplicatePhotos", "largeOldVideos"];

let liveFindings = [...findings];
let restore: RestoreEntry[] = [];
/** Items removed one at a time from Review → "See all". */
const goneItems = new Set<string>();

/** Made-up contents of a category, summing to its original size. */
function allItems(kind: FindingKind): FindingItem[] {
  const total = findings.find((x) => x.kind === kind)?.sizeBytes ?? 0;
  const names = DEMO_ITEMS[kind];
  const weights = names.map((_, i) => 1 / (i + 1.4));
  const sum = weights.reduce((a, b) => a + b, 0);
  return names.map(([name, location], i) => ({
    path: `~/${location.replaceAll(" › ", "/")}/${name}`,
    name,
    location,
    sizeBytes: Math.round((total * weights[i]) / sum),
    held: kind !== "trash" && kind !== "tempFiles",
  }));
}

/** Live findings, shrunk by whatever was removed item by item. */
function current(): Finding[] {
  return liveFindings
    .map((f) => {
      const gone = allItems(f.kind).filter((i) => goneItems.has(i.path));
      const bytes = gone.reduce((s, i) => s + i.sizeBytes, 0);
      return { ...f, sizeBytes: f.sizeBytes - bytes, itemCount: Math.max(0, f.itemCount - gone.length) };
    })
    .filter((f) => f.sizeBytes > 0);
}

export const demoStore = {
  findings: () => current().filter((f) => !INDEX_KINDS.includes(f.kind)),
  indexFindings: () => current().filter((f) => INDEX_KINDS.includes(f.kind)),
  restore: () => restore,
  findingItems: (kind: FindingKind): FindingItem[] =>
    liveFindings.some((f) => f.kind === kind) ? allItems(kind).filter((i) => !goneItems.has(i.path)) : [],
  freeUp(kinds: FindingKind[]): FreeUpReport {
    const freed = liveFindings.filter((f) => kinds.includes(f.kind));
    liveFindings = liveFindings.filter((f) => !kinds.includes(f.kind));
    restore = [
      ...freed.map((f) => ({
        id: `${f.id}-${Date.now()}`,
        kind: f.kind,
        label: null,
        sizeBytes: f.sizeBytes,
        removedAtMs: Date.now(),
        // Mirrors restore::is_held — Trash and caches are deleted for good.
        restorable: f.kind !== "trash" && f.kind !== "tempFiles",
        items: [],
      })),
      ...restore,
    ];
    return { freedBytes: freed.reduce((sum, f) => sum + f.sizeBytes, 0), skipped: 0 };
  },
  /** Paths removed from Big files, Explore, Duplicates, Developer or Apps. */
  freePaths(paths: string[], label: string, sizeBytes: number, restorable: boolean): FreeUpReport {
    demoIndex.forget(paths);
    for (const p of paths) goneItems.add(p);
    restore = [
      { id: `${label}-${Date.now()}`, kind: null, label, sizeBytes, removedAtMs: Date.now(), restorable, items: [] },
      ...restore,
    ];
    return { freedBytes: sizeBytes, skipped: 0 };
  },
  uninstallApp(app: AppInfo): FreeUpReport {
    const bytes = app.parts.reduce((sum, p) => sum + p.sizeBytes, 0);
    return this.freePaths([app.path], app.name, bytes, true);
  },
  hideCleared() {
    restore = restore.filter((e) => e.restorable);
  },
  clear(id?: string) {
    restore = restore.filter((e) => !e.restorable || (id !== undefined && e.id !== id));
  },
  restoreEntry(id: string) {
    const entry = restore.find((e) => e.id === id);
    if (!entry?.restorable) return;
    restore = restore.filter((e) => e.id !== id);
    const finding = findings.find((f) => f.kind === entry.kind);
    if (finding) liveFindings = [...liveFindings, finding];
  },
};
