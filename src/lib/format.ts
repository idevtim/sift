const GB = 1e9;

/** "9.1 GB" — one decimal, trailing ".0" dropped. Decimal units, like Finder. */
export function fmtGB(bytes: number): string {
  return `${Math.round((bytes / GB) * 10) / 10} GB`;
}

/** "994 GB" / "2 TB" — for drive capacities and free space. */
export function fmtBig(bytes: number): string {
  const gb = bytes / GB;
  return gb >= 1000 ? `${Math.round(gb / 100) / 10} TB` : `${Math.round(gb)} GB`;
}

/** Size for small things too: "4.1 MB", "620 MB", "1.8 GB". */
export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return fmtGB(bytes);
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Like `fmtSize`, with a decimal under 10 MB: "4.1 MB", "62 MB", "1.8 GB". */
export function fmtSizeFine(bytes: number): string {
  if (bytes >= 1e6 && bytes < 1e7) return `${(bytes / 1e6).toFixed(1)} MB`;
  return fmtSize(bytes);
}

/** Show the home folder as "~" in mono paths (Power tools only). */
export function tildify(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, "~");
}
