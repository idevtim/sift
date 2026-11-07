import type { FindingKind } from "@/types/api";
import { api } from "./tauri";

// Everything derived from the disk index shares the "index" prefix, so one
// invalidation refreshes Explore, Big files, Developer, Duplicates and search.
export const queries = {
  drives: { queryKey: ["drives"], queryFn: api.listDrives },
  findings: { queryKey: ["findings"], queryFn: api.scanFindings, staleTime: Infinity },
  indexFindings: { queryKey: ["index", "findings"], queryFn: api.indexFindings, staleTime: Infinity },
  /** Under ["findings"], so removing anything refreshes it with the totals. */
  findingItems: (kind: FindingKind) => ({
    queryKey: ["findings", "items", kind],
    queryFn: () => api.findingItems(kind),
  }),
  restore: { queryKey: ["restore"], queryFn: api.listRestore },
  bigFiles: { queryKey: ["index", "big-files"], queryFn: api.bigFiles, staleTime: Infinity },
  dev: { queryKey: ["index", "dev"], queryFn: api.devReport, staleTime: Infinity },
  duplicates: { queryKey: ["index", "duplicates"], queryFn: api.findDuplicates, staleTime: Infinity },
  /** Keyed by content hash, outside ["index"]: a rescan doesn't change them. */
  duplicatePreview: (hash: string) => ({
    queryKey: ["duplicate-preview", hash],
    queryFn: () => api.duplicatePreview(hash),
    staleTime: Infinity,
  }),
  duplicateFacts: (hash: string) => ({
    queryKey: ["duplicate-facts", hash],
    queryFn: () => api.duplicateFacts(hash),
    staleTime: Infinity,
  }),
  apps: { queryKey: ["apps"], queryFn: api.listApps, staleTime: Infinity },
  driveBreakdown: (mountPoint: string) => ({
    queryKey: ["drive-breakdown", mountPoint],
    queryFn: () => api.driveBreakdown(mountPoint),
    staleTime: 5 * 60_000,
  }),
  explore: (crumbs: string[]) => ({
    queryKey: ["index", "explore", ...crumbs],
    queryFn: () => api.explore(crumbs),
    staleTime: Infinity,
  }),
} as const;

/**
 * The index scan. `["scan"]` holds the summary; invalidate it to rescan.
 * Index-derived views live under `["index", …]` and read the result.
 */
export const scanQuery = (onProgress: Parameters<typeof api.scanIndex>[0]) => ({
  queryKey: ["scan"],
  queryFn: () => api.scanIndex(onProgress),
  staleTime: Infinity,
  retry: false,
});
