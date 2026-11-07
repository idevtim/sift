// Duplicates page logic: filters, sorting, paging, which copy to keep and
// the "same file" facts. Mirrors `dupVals()` in the duplicates handoff.

import { fmtSizeFine } from "@/lib/format";
import { shortDate } from "@/lib/time";
import type { DuplicateCopy, DuplicateGroup, FileFacts } from "@/types/api";

export type KeepRule = "oldest" | "best" | "newest";
export type TypeFilter = "all" | "photo" | "video" | "audio" | "document" | "other";
export type SortKey = "savings" | "copies" | "name";

export const PAGE_SIZE = 6;

export const KEEP_RULES: { value: KeepRule; label: string }[] = [
  { value: "oldest", label: "Oldest" },
  { value: "best", label: "Best place" },
  { value: "newest", label: "Newest" },
];

export const TYPES: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "other", label: "Other" },
];

export const SORTS: { value: SortKey; label: string; compare: (a: DuplicateGroup, b: DuplicateGroup) => number }[] = [
  { value: "savings", label: "Biggest savings", compare: (a, b) => extraBytes(b) - extraBytes(a) },
  {
    value: "copies",
    label: "Most copies",
    compare: (a, b) => b.copies.length - a.copies.length || extraBytes(b) - extraBytes(a),
  },
  { value: "name", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
];

export const typeOf = (g: DuplicateGroup): Exclude<TypeFilter, "all"> => (g.kind === "app" ? "other" : g.kind);

export const extraBytes = (g: DuplicateGroup) => g.sizeBytes * (g.copies.length - 1);

export const fileName = (c: DuplicateCopy) => c.path.split(/[\\/]/).pop() || c.path;

/** "HEIC", "MP4"; a word for files without an extension. */
export function extLabel(g: DuplicateGroup): string {
  const m = g.name.match(/\.(\w+)$/);
  if (m) return m[1].toUpperCase();
  return { photo: "IMAGE", video: "VIDEO", audio: "AUDIO", document: "DOC", other: "FILE" }[typeOf(g)];
}

export function matches(g: DuplicateGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    g.name.toLowerCase().includes(q) ||
    g.copies.some((c) => fileName(c).toLowerCase().includes(q) || c.location.toLowerCase().includes(q))
  );
}

/**
 * 0 for the main folders, 2 for Downloads and Desktop. (1 is external
 * drives in the design; Duplicates only looks in this computer's folders.)
 */
const placeRank = (c: DuplicateCopy) => (/^(Downloads|Desktop)( ›|$)/.test(c.location) ? 2 : 0);

/** Index of the copy a rule keeps. Ties go to the oldest. */
export function keeperOf(g: DuplicateGroup, rule: KeepRule): number {
  let best = 0;
  g.copies.forEach((c, i) => {
    const b = g.copies[best];
    const better =
      rule === "oldest"
        ? c.modifiedMs < b.modifiedMs
        : rule === "newest"
          ? c.modifiedMs > b.modifiedMs
          : placeRank(c) < placeRank(b) || (placeRank(c) === placeRank(b) && c.modifiedMs < b.modifiedMs);
    if (better) best = i;
  });
  return best;
}

/** Page numbers to show; "gap" for "…". Past 6 pages: first, current ±1, last. */
export function pageTokens(page: number, pages: number): (number | "gap")[] {
  if (pages <= 6) return Array.from({ length: pages }, (_, p) => p);
  const shown = [...new Set([0, page - 1, page, page + 1, pages - 1])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = -1;
  for (const p of shown) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

/** "Only the name, folder and date modified are different." From what actually varies. */
export function diffNote(g: DuplicateGroup): string {
  const varies = (f: (c: DuplicateCopy) => string | number) => new Set(g.copies.map(f)).size > 1;
  const diff = [
    varies(fileName) && "name",
    varies((c) => c.location) && "folder",
    varies((c) => Math.floor(c.modifiedMs / 60_000)) && "date modified",
  ].filter((d): d is string => !!d);
  if (!diff.length) diff.push("folder");
  const list = diff.length > 1 ? `${diff.slice(0, -1).join(", ")} and ${diff[diff.length - 1]}` : diff[0];
  return `Only the ${list} ${diff.length > 1 ? "are" : "is"} different.`;
}

/** "4:12", or "5 hr 41 min" past an hour. */
export function duration(secs: number): string {
  const s = Math.round(secs);
  if (s >= 3600) return `${Math.floor(s / 3600)} hr ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The fact chips: always contents and size, then what's known for the kind. */
export function factsFor(g: DuplicateGroup, f: FileFacts | undefined): [string, string][] {
  const out: [string, string][] = [
    ["Contents", "Identical, byte for byte"],
    ["Size", fmtSizeFine(g.sizeBytes)],
  ];
  const add = (label: string, value: string | false | null | undefined) => {
    if (value) out.push([label, value]);
  };
  const dims = f?.width && f.height ? `${f.width} × ${f.height}` : null;
  const made = f?.createdMs ? shortDate(f.createdMs) : null;
  const length = f?.durationSecs ? duration(f.durationSecs) : null;
  switch (g.kind) {
    case "photo":
      add("Dimensions", dims);
      add("Taken", made);
      break;
    case "video":
      add("Length", length);
      add("Resolution", dims);
      add("Recorded", made);
      break;
    case "audio":
      add("Length", length);
      add("Format", f?.bitRateKbps ? `${extLabel(g)} ${f.bitRateKbps} kbps` : extLabel(g));
      break;
    case "document":
      add("Pages", f?.pages ? String(f.pages) : null);
      add("Created", made);
      break;
    case "app":
      add("Kind", "Installer");
      add("Created", made);
      break;
    default:
      add("Created", made);
  }
  return out;
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
