import { create } from "zustand";

/** Where Explore is looking. Lives outside the view so ⌘K can jump in. */
interface ExploreState {
  crumbs: string[];
  /** Name of the selected tile in the current folder. */
  selected: string | null;
  open: (crumbs: string[], selected?: string | null) => void;
  select: (name: string | null) => void;
}

export const useExplore = create<ExploreState>()((set) => ({
  crumbs: [],
  selected: null,
  open: (crumbs, selected = null) => set({ crumbs, selected }),
  select: (selected) => set({ selected }),
}));
