import { create } from "zustand";
import type { IconName } from "@/components/ui/Icon";

export interface FreeItem {
  name: string;
  sizeBytes: number;
  icon: IconName;
  /** Kept in Restore for 30 days; false = deleted for good (Trash, caches). */
  held: boolean;
}

/**
 * The in-flight (or just-finished) free-up, shared by Freeing and Done, and
 * by Home's in-place Sweep (`sweep`), which outlives Home remounting.
 */
interface FreeState {
  /** What's being freed, in order — drives the "Clearing …" label and Home's rows. */
  items: FreeItem[];
  totalBytes: number;
  /** Shown progress, 0–1 (real progress, paced to a minimum duration). */
  progress: number;
  freedBytes: number;
  skipped: number;
  error: string | null;
  /** Home's Sweep: idle until started, then running → done (until dismissed). */
  sweep: "idle" | "running" | "done";
}

export const useFreeStore = create<FreeState>()(() => ({
  items: [],
  totalBytes: 0,
  progress: 0,
  freedBytes: 0,
  skipped: 0,
  error: null,
  sweep: "idle",
}));
