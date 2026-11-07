import { create } from "zustand";
import type { FindingKind } from "@/types/api";

/** Which Home category Review → "See all" is showing. */
interface FindingState {
  kind: FindingKind | null;
  show: (kind: FindingKind) => void;
}

export const useFindingView = create<FindingState>()((set) => ({
  kind: null,
  show: (kind) => set({ kind }),
}));
