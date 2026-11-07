import { create } from "zustand";
import type { Finding } from "@/types/api";

/**
 * Which findings are included in "Free up space". Ids absent from the map
 * fall back to the default: safe items on, "take a look" items off.
 */
interface SelectionState {
  overrides: Record<string, boolean>;
  toggle: (f: Finding) => void;
}

export const isSelected = (overrides: Record<string, boolean>, f: Finding) =>
  overrides[f.id] ?? f.safety === "safe";

export const useSelection = create<SelectionState>()((set) => ({
  overrides: {},
  toggle: (f) =>
    set((s) => ({ overrides: { ...s.overrides, [f.id]: !isSelected(s.overrides, f) } })),
}));

/** Back to defaults — after a free-up, the remaining findings start fresh. */
export const resetSelection = () => useSelection.setState({ overrides: {} });
