import { create } from "zustand";

/**
 * A downloaded update waiting for a restart. Only set once the bytes are on
 * disk, so the sidebar card never shows something that can't be applied yet.
 */
interface UpdateState {
  version: string | null;
  installing: boolean;
  /** Install the downloaded bytes and relaunch. */
  apply: (() => Promise<void>) | null;
  setReady: (version: string, apply: () => Promise<void>) => void;
  setInstalling: (installing: boolean) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  version: null,
  installing: false,
  apply: null,
  setReady: (version, apply) => set({ version, apply }),
  setInstalling: (installing) => set({ installing }),
}));
