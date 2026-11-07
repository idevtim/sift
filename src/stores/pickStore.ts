import { create } from "zustand";
import type { Reason } from "@/types/api";

/** Something added to Review from Explore ("Add to review"). */
export interface Pick {
  path: string;
  name: string;
  sizeBytes: number;
  reason: Reason | null;
  /** Included in "Free up space" (the Review toggle). */
  on: boolean;
}

interface PickState {
  picks: Pick[];
  /** Explore: add to review, or take back out. */
  toggle: (pick: Omit<Pick, "on">) => void;
  /** Review: include or skip without removing it from the list. */
  flip: (path: string) => void;
  clear: () => void;
}

export const usePicks = create<PickState>()((set) => ({
  picks: [],
  toggle: (pick) =>
    set((s) => ({
      picks: s.picks.some((p) => p.path === pick.path)
        ? s.picks.filter((p) => p.path !== pick.path)
        : [...s.picks, { ...pick, on: true }],
    })),
  flip: (path) => set((s) => ({ picks: s.picks.map((p) => (p.path === path ? { ...p, on: !p.on } : p)) })),
  clear: () => set({ picks: [] }),
}));
