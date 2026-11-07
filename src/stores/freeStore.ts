import { create } from "zustand";

/** The in-flight (or just-finished) free-up, shared by Freeing and Done. */
interface FreeState {
  /** What's being freed, in order — drives the "Clearing …" label. */
  items: { name: string; sizeBytes: number }[];
  totalBytes: number;
  /** Shown progress, 0–1 (real progress, paced to a minimum duration). */
  progress: number;
  freedBytes: number;
  skipped: number;
  error: string | null;
}

export const useFreeStore = create<FreeState>()(() => ({
  items: [],
  totalBytes: 0,
  progress: 0,
  freedBytes: 0,
  skipped: 0,
  error: null,
}));
