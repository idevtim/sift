import { create } from "zustand";
import type { ScanProgress } from "@/types/api";

/** Live progress of the disk index scan, and whether the overlay shows it. */
interface ScanState {
  progress: ScanProgress | null;
  /** Show the first-scan overlay for the current scan. */
  overlay: boolean;
  /** When the overlay's scan started — results older than this are stale. */
  startedAt: number;
}

export const useScanStore = create<ScanState>()(() => ({ progress: null, overlay: false, startedAt: 0 }));
