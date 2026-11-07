import type { Drive, DriveKind } from "@/types/api";

export const kindLabel: Record<DriveKind, string> = {
  internal: "This computer",
  external: "External",
  sd: "SD card",
  backup: "Backup",
};

/** Teal for "can be freed", then ink → stone for everything else. */
export const CATEGORY_COLORS = {
  freeable: "#1F8A76",
  apps: "var(--ink)",
  media: "var(--mut2)",
  documents: "var(--mut3)",
  system: "var(--stone2)",
  other: "var(--stone)",
} as const;

/**
 * Card hint under "N free of M". `copiesBytes` is known once the drive has
 * been opened (its breakdown is cached); until then externals say what Sift
 * does with them.
 */
export function driveHint(
  d: Drive,
  freeableBytes: number,
  fmt: (n: number) => string,
  device: string,
  copiesBytes?: number,
): string {
  if (d.protected) return "Protected. Sift won't touch it.";
  if (d.kind === "sd") return "Import photos before clearing";
  if (d.kind === "internal") return freeableBytes > 0 ? `${fmt(freeableBytes)} can be freed` : "Nothing to clear right now";
  if (copiesBytes) return `${fmt(copiesBytes)} of copies also on your ${device}`;
  return "Sift only cleans this computer's drive";
}
