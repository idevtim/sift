// Browser-mode stand-ins for the Rust disk index, built from the design
// prototype's sample data. Mutable so
// removing things in demo mode behaves like the real app until reload.

import type {
  AppList,
  BigFile,
  DevReport,
  DriveBreakdown,
  DuplicateGroup,
  ExploreNode,
  ExploreView,
  FileFacts,
  FileKind,
  Reason,
  ScanSummary,
  SearchHit,
} from "@/types/api";

const GB = 1e9;
const MB = 1e6;
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

interface DemoNode {
  name: string;
  path?: string;
  size?: number; // GB, leaves only
  reason?: Reason;
  children?: DemoNode[];
}

const tree: DemoNode = {
  name: "Macintosh HD",
  children: [
    { name: "macOS", size: 96.6, reason: "system" },
    {
      name: "Applications",
      path: "/Applications",
      children: [
        { name: "Steam games", size: 18.4, path: "~/Library/Application Support/Steam" },
        { name: "Xcode.app", size: 12.0, path: "/Applications/Xcode.app" },
        { name: "Final Cut Pro.app", size: 7.4, path: "/Applications/Final Cut Pro.app" },
        { name: "Smaller items (118)", size: 6.6 },
        { name: "Adobe Photoshop 2025", size: 4.8, path: "/Applications/Adobe Photoshop 2025" },
      ],
    },
    {
      name: "Library",
      path: "~/Library",
      children: [
        { name: "Caches", size: 12.0, reason: "cache", path: "~/Library/Caches" },
        { name: "Application Support", size: 5.6, path: "~/Library/Application Support" },
        { name: "DerivedData", size: 7.1, reason: "derivedData", path: "~/Library/Developer/Xcode/DerivedData" },
      ],
    },
    {
      name: "Movies",
      path: "~/Movies",
      children: [
        { name: "Vacation 2023.mov", size: 14.6, path: "~/Movies/Vacation 2023.mov" },
        { name: "Exports", size: 10.2, path: "~/Movies/Exports" },
      ],
    },
    {
      name: "Documents",
      path: "~/Documents",
      children: [
        { name: "Work", size: 9.4, path: "~/Documents/Work" },
        { name: "Podcast", size: 3.9, path: "~/Documents/Podcast" },
        { name: "Smaller items (1204)", size: 3.2 },
      ],
    },
    {
      name: "Downloads",
      path: "~/Downloads",
      children: [
        { name: "Figma-125.3.dmg", size: 9.1, reason: "installer", path: "~/Downloads/Figma-125.3.dmg" },
        { name: "Smaller items (412)", size: 6.2 },
      ],
    },
    {
      name: "code",
      path: "~/code",
      children: [
        { name: "target", size: 5.8, reason: "rustTarget", path: "~/code/sift/target" },
        { name: "node_modules", size: 5.2, reason: "nodeModules", path: "~/code/web/node_modules" },
        { name: "Smaller items (2310)", size: 1.5 },
      ],
    },
    { name: "Old phone backup", size: 22.8, path: "~/Library/Application Support/MobileSync/Backup" },
    { name: ".Trash", size: 6.8, reason: "trash", path: "~/.Trash" },
  ],
};

const sizeOf = (n: DemoNode): number => (n.children ? n.children.reduce((a, c) => a + sizeOf(c), 0) : (n.size ?? 0) * GB);
const freeOf = (n: DemoNode): number =>
  n.reason && n.reason !== "system" ? sizeOf(n) : (n.children ?? []).reduce((a, c) => a + freeOf(c), 0);

const view = (n: DemoNode): ExploreNode => ({
  name: n.name,
  path: n.path ?? null,
  sizeBytes: sizeOf(n),
  freeBytes: freeOf(n),
  isDir: !!n.children,
  hasChildren: !!n.children?.length,
  reason: n.reason ?? null,
});

function sorted(children: DemoNode[] = []) {
  return [...children].sort((a, b) => sizeOf(b) - sizeOf(a));
}

export function explore(crumbs: string[]): ExploreView {
  let node = tree;
  for (const name of crumbs) node = node.children?.find((c) => c.name === name) ?? node;
  return { crumbs: [tree.name, ...crumbs], node: view(node), children: sorted(node.children).map(view) };
}

export function search(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const visit = (n: DemoNode, crumbs: string[]) => {
    for (const c of n.children ?? []) {
      if (c.path && c.name.toLowerCase().includes(q)) {
        hits.push({ name: c.name, path: c.path, parentCrumbs: crumbs, sizeBytes: sizeOf(c), isDir: !!c.children, reason: c.reason ?? null });
      }
      if (c.children) visit(c, [...crumbs, c.name]);
    }
  };
  visit(tree, []);
  return hits.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 20);
}

let bigFiles: BigFile[] = [
  { name: "Old phone backup", path: "~/Library/Application Support/MobileSync/Backup", location: "Backups", sizeBytes: 22.8 * GB, lastOpenedMs: now - 730 * DAY },
  { name: "Vacation 2023 (original video).mov", path: "~/Movies/Vacation 2023.mov", location: "Movies", sizeBytes: 14.6 * GB, lastOpenedMs: now - 425 * DAY },
  { name: "Windows 11 installer.iso", path: "~/Downloads/Win11.iso", location: "Downloads", sizeBytes: 6.2 * GB, lastOpenedMs: now - 270 * DAY },
  { name: "Screen recordings (38)", path: "~/Desktop/Screen recordings", location: "Desktop", sizeBytes: 5.4 * GB, lastOpenedMs: now - 150 * DAY },
  { name: "Podcast project", path: "~/Documents/Podcast", location: "Documents", sizeBytes: 3.9 * GB, lastOpenedMs: now - 240 * DAY },
];

/**
 * The prototype's duplicate sets (Power tools › Duplicates): nine by hand,
 * then 303 generated with its seeded random, so paging and filters have
 * something to work on. Folders stay in home, like the real scan.
 */
const dupeFacts: Record<string, FileFacts> = {};

function demoDuplicates(): DuplicateGroup[] {
  type Seed = { name: string; kind: FileKind; gb: number; facts: Partial<FileFacts>; copies: [string, string, number][] };
  const date = (s: string) => Date.parse(s);
  const hand: Seed[] = [
    { name: "Wedding highlights.mp4", kind: "video", gb: 1.8, facts: { durationSecs: 252, width: 3840, height: 2160, createdMs: date("2023-09-02T12:00") },
      copies: [["Wedding highlights.mp4", "Movies", 420], ["Wedding highlights.mp4", "Documents › Video backup", 380]] },
    { name: "Kitchen remodel walkthrough.mov", kind: "video", gb: 0.86, facts: { durationSecs: 168, width: 1920, height: 1080, createdMs: date("2025-03-18T12:00") },
      copies: [["Kitchen remodel walkthrough.mov", "Movies", 560], ["IMG_8812.MOV", "Downloads", 300]] },
    { name: "Podcast ep 12 final.wav", kind: "audio", gb: 0.412, facts: { durationSecs: 2890, bitRateKbps: 1536 },
      copies: [["Podcast ep 12 final.wav", "Documents › Podcast", 240], ["Podcast ep 12 final.wav", "Desktop", 236], ["Podcast ep 12 final (1).wav", "Downloads", 230]] },
    { name: "Figma-125.3.dmg", kind: "app", gb: 0.41, facts: {},
      copies: [["Figma-125.3.dmg", "Downloads", 90], ["Figma-125.3 (1).dmg", "Downloads › Old", 88]] },
    { name: "Beach sunset.jpg", kind: "photo", gb: 0.0068, facts: { width: 6000, height: 4000, createdMs: date("2024-08-09T12:00") },
      copies: [["Beach sunset.jpg", "Pictures", 440], ["Beach sunset.jpg", "Desktop", 400], ["DSC_0412.jpg", "Pictures › Old Mac import", 438]] },
    { name: "IMG_2041.HEIC", kind: "photo", gb: 0.0041, facts: { width: 4032, height: 3024, createdMs: date("2024-06-12T12:00") },
      copies: [["IMG_2041.HEIC", "Pictures", 505], ["IMG_2041 copy.HEIC", "Desktop › Phone dump", 503], ["IMG_2041.HEIC", "Downloads", 501]] },
    { name: "Tax return 2024.pdf", kind: "document", gb: 0.0023, facts: { pages: 14, createdMs: date("2025-04-03T12:00") },
      copies: [["Tax return 2024.pdf", "Documents › Taxes", 575], ["Tax return 2024.pdf", "Downloads", 575], ["Tax return 2024 (1).pdf", "Desktop", 574]] },
    { name: "Lease agreement.pdf", kind: "document", gb: 0.0011, facts: { pages: 9, createdMs: date("2026-01-20T12:00") },
      copies: [["Lease agreement.pdf", "Documents", 283], ["Lease agreement signed.pdf", "Downloads", 280]] },
  ];

  let x = 11;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const pad = (n: number) => String(n).padStart(2, "0");
  const someDate = () => Date.UTC(2021 + Math.floor(r() * 5), Math.floor(r() * 12), 1 + Math.floor(r() * 28), 12);
  const secs = (a: number, b: number) => a + Math.floor(r() * (b - a));
  const pools: Record<string, string[]> = {
    photo: ["Pictures", "Desktop › Phone dump", "Downloads", "Pictures › Old Mac import"],
    document: ["Documents", "Downloads", "Desktop", "Documents › Old"],
    audio: ["Music", "Downloads", "Documents › Voice memos"],
    video: ["Movies", "Downloads", "Desktop"],
    other: ["Downloads", "Downloads › Old", "Desktop"],
  };
  const gen: Seed[] = [];
  for (let n = 0; n < 303; n++) {
    const q = r();
    const kind: FileKind = q < 0.6 ? "photo" : q < 0.75 ? "document" : q < 0.85 ? "audio" : q < 0.93 ? "video" : "other";
    let name: string, gb: number, facts: Partial<FileFacts>;
    if (kind === "photo") {
      if (r() < 0.35) {
        name = `Screenshot 202${3 + Math.floor(r() * 3)}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))} at ${10 + Math.floor(r() * 9)}.${pad(Math.floor(r() * 60))}.png`;
        gb = (0.4 + r()) / 1000;
        facts = { width: 2880, height: 1800, createdMs: someDate() };
      } else {
        name = `IMG_${3000 + Math.floor(r() * 6000)}.HEIC`;
        gb = (2 + r() * 4) / 1000;
        facts = { width: 4032, height: 3024, createdMs: someDate() };
      }
    } else if (kind === "document") {
      name = r() < 0.5 ? `Invoice-${1000 + Math.floor(r() * 900)}.pdf` : `Meeting notes ${1 + Math.floor(r() * 90)}.docx`;
      gb = (0.1 + r() * 2.5) / 1000;
      facts = { pages: 1 + Math.floor(r() * 12), createdMs: someDate() };
    } else if (kind === "audio") {
      name = r() < 0.5 ? `Voice memo ${1 + Math.floor(r() * 140)}.m4a` : `Track ${pad(1 + Math.floor(r() * 30))}.mp3`;
      gb = (3 + r() * 9) / 1000;
      facts = { durationSecs: secs(60, 420), bitRateKbps: name.endsWith(".mp3") ? 320 : 256 };
    } else if (kind === "video") {
      name = `Clip ${1 + Math.floor(r() * 400)}.mov`;
      gb = (20 + r() * 70) / 1000;
      facts = { durationSecs: secs(8, 180), width: 1920, height: 1080, createdMs: someDate() };
    } else {
      name = `Setup-${100 + Math.floor(r() * 800)}.dmg`;
      gb = (20 + r() * 130) / 1000;
      facts = { createdMs: someDate() };
    }
    const k = r() < 0.75 ? 2 : 3;
    const fold = pools[kind];
    const off = Math.floor(r() * fold.length);
    const base = 30 + Math.floor(r() * 900);
    const copies = Array.from({ length: k }, (_, j): [string, string, number] => {
      const nm = j === 2 && r() < 0.5 ? name.replace(/(\.\w+)$/, " (1)$1") : j === 1 && r() < 0.3 ? name.replace(/(\.\w+)$/, " copy$1") : name;
      return [nm, fold[(j + off) % fold.length], Math.max(1, base - j * Math.floor(1 + r() * 20))];
    });
    gen.push({ name, kind: kind === "other" ? "app" : kind, gb, facts, copies });
  }

  return [...hand, ...gen].map((d, i) => {
    const hash = `demo${i}`;
    dupeFacts[hash] = { width: null, height: null, durationSecs: null, pages: null, createdMs: null, bitRateKbps: null, ...d.facts };
    const copies = d.copies
      .map(([name, location, days]) => ({
        path: `~/${location.split(" › ").join("/")}/${name}`,
        location,
        modifiedMs: now - days * DAY,
      }))
      .sort((a, b) => a.modifiedMs - b.modifiedMs);
    return { hash, name: d.name, kind: d.kind, sizeBytes: Math.round(d.gb * GB), copies };
  });
}

let duplicates: DuplicateGroup[] = demoDuplicates();

const noFacts: FileFacts = { width: null, height: null, durationSecs: null, pages: null, createdMs: null, bitRateKbps: null };
export const duplicateFacts = (hash: string): FileFacts => dupeFacts[hash] ?? noFacts;

let dev: DevReport = {
  dockerBytes: 11.2 * GB,
  simulatorBytes: 9.8 * GB,
  artifacts: [
    { kind: "derivedData", path: "~/Library/Developer/Xcode/DerivedData/Sift-abc", sizeBytes: 4.1 * GB, projectModifiedMs: now - 95 * DAY },
    { kind: "derivedData", path: "~/Library/Developer/Xcode/DerivedData/Notes-def", sizeBytes: 3.0 * GB, projectModifiedMs: now - 2 * DAY },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({
      kind: "rustTarget" as const,
      path: `~/code/crate-${i}/target`,
      sizeBytes: (0.6 + i * 0.12) * GB,
      projectModifiedMs: now - (20 + i * 18) * DAY,
    })),
    ...Array.from({ length: 38 }, (_, i) => ({
      kind: "nodeModules" as const,
      path: `~/code/site-${i}/node_modules`,
      sizeBytes: (80 + (i * 37) % 120) * MB,
      projectModifiedMs: now - (5 + i * 4) * DAY,
    })),
    { kind: "packageCaches", path: "~/.npm/_cacache", sizeBytes: 2.1 * GB, projectModifiedMs: now },
    { kind: "packageCaches", path: "~/.cargo/registry/cache", sizeBytes: 1.3 * GB, projectModifiedMs: now },
  ],
};

let apps: AppList = {
  supported: true,
  apps: [
    { id: "/Applications/Steam.app", name: "Steam", path: "/Applications/Steam.app", source: "bundle", icon: null, installedMs: null, lastOpenedMs: now - 90 * DAY, running: false, parts: [
      { kind: "app", sizeBytes: 18.4 * GB, paths: [] }, { kind: "caches", sizeBytes: 0.6 * GB, paths: [] }, { kind: "support", sizeBytes: 0.2 * GB, paths: [] } ] },
    { id: "/Applications/Final Cut Pro.app", name: "Final Cut Pro", path: "/Applications/Final Cut Pro.app", source: "bundle", icon: null, installedMs: null, lastOpenedMs: now - 330 * DAY, running: false, parts: [
      { kind: "app", sizeBytes: 7.4 * GB, paths: [] }, { kind: "caches", sizeBytes: 3.1 * GB, paths: [] }, { kind: "support", sizeBytes: 0.5 * GB, paths: [] } ] },
    { id: "/Applications/Adobe Photoshop 2025.app", name: "Photoshop", path: "/Applications/Adobe Photoshop 2025.app", source: "bundle", icon: null, installedMs: null, lastOpenedMs: now - 180 * DAY, running: false, parts: [
      { kind: "app", sizeBytes: 4.8 * GB, paths: [] }, { kind: "caches", sizeBytes: 1.0 * GB, paths: [] }, { kind: "support", sizeBytes: 0.2 * GB, paths: [] } ] },
    { id: "/Applications/Spotify.app", name: "Spotify", path: "/Applications/Spotify.app", source: "bundle", icon: null, installedMs: null, lastOpenedMs: now - 2 * 60 * 60 * 1000, running: true, parts: [
      { kind: "app", sizeBytes: 0.4 * GB, paths: [] }, { kind: "caches", sizeBytes: 2.3 * GB, paths: [] } ] },
    { id: "/Applications/zoom.us.app", name: "Zoom", path: "/Applications/zoom.us.app", source: "bundle", icon: null, installedMs: null, lastOpenedMs: now - 365 * DAY, running: false, parts: [
      { kind: "app", sizeBytes: 0.6 * GB, paths: [] }, { kind: "caches", sizeBytes: 0.4 * GB, paths: [] } ] },
  ],
};

export const summary: ScanSummary = {
  filesChecked: 2_140_000,
  bytesChecked: 278.6 * GB,
  categories: [
    { category: "system", sizeBytes: 96.6 * GB },
    { category: "apps", sizeBytes: 49.2 * GB },
    { category: "media", sizeBytes: 47.6 * GB },
    { category: "documents", sizeBytes: 16.5 * GB },
    { category: "developer", sizeBytes: 12.5 * GB },
    { category: "other", sizeBytes: 21.5 * GB },
    { category: "freeable", sizeBytes: 54.6 * GB },
  ],
};

/** External drives from the prototype (Drives › Archive SSD / Camera card). */
const breakdowns: Record<string, DriveBreakdown> = {
  "/Volumes/Archive SSD": {
    categories: [
      { category: "freeable", sizeBytes: 31.5 * GB },
      { category: "media", sizeBytes: 286 * GB },
      { category: "documents", sizeBytes: 92.5 * GB },
      { category: "other", sizeBytes: 10 * GB },
    ],
    photos: 18_420,
    videos: 640,
  },
  "/Volumes/Camera card": {
    categories: [
      { category: "media", sizeBytes: 94.2 * GB },
      { category: "other", sizeBytes: 2.8 * GB },
    ],
    photos: 2_140,
    videos: 36,
  },
};

export const breakdown = (mountPoint: string): DriveBreakdown =>
  breakdowns[mountPoint] ?? { categories: [], photos: 0, videos: 0 };

export const demoIndex = {
  bigFiles: () => bigFiles,
  duplicates: () => duplicates,
  dev: () => dev,
  apps: () => apps,
  /** Forget removed paths everywhere, like `Index::forget_removed`. */
  forget(paths: string[]) {
    const gone = (p: string) => paths.includes(p);
    bigFiles = bigFiles.filter((b) => !gone(b.path));
    duplicates = duplicates
      .map((g) => ({ ...g, copies: g.copies.filter((c) => !gone(c.path)) }))
      .filter((g) => g.copies.length > 1);
    dev = { ...dev, artifacts: dev.artifacts.filter((a) => !gone(a.path)) };
    apps = { ...apps, apps: apps.apps.filter((a) => !gone(a.path)) };
  },
  clearDocker: () => {
    dev = { ...dev, dockerBytes: 0 };
  },
  clearSimulators: () => {
    dev = { ...dev, simulatorBytes: null };
  },
};
