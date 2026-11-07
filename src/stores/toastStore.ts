import { create } from "zustand";
import type { RouteId } from "@/routes";

/** "done" for something that worked, "problem" when it didn't. */
export type ToastTone = "done" | "problem";

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  /** Optional shortcut, e.g. "View in Restore". */
  action?: { label: string; route: RouteId };
  /** Animating out; removed once that's done. */
  leaving?: boolean;
}

interface ToastState {
  toasts: Toast[];
  /** Animate a toast out, then remove it. */
  dismiss: (id: number) => void;
}

/** How long the exit animation runs (matches Toaster's duration-300). */
export const LEAVE_MS = 300;
/** Older ones leave once there are more than this. */
const MAX_SHOWN = 3;
let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  dismiss: (id) => {
    // Already leaving (or gone): nothing to do.
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), LEAVE_MS);
  },
}));

/** Show a short result message in the corner. Fades on its own. */
export function toast(text: string, opts: { tone?: ToastTone; action?: Toast["action"] } = {}) {
  const t: Toast = { id: nextId++, text, tone: opts.tone ?? "done", action: opts.action, leaving: false };
  useToasts.setState((s) => ({ toasts: [...s.toasts, t] }));
  const { toasts, dismiss } = useToasts.getState();
  const showing = toasts.filter((x) => !x.leaving);
  for (const old of showing.slice(0, Math.max(0, showing.length - MAX_SHOWN))) dismiss(old.id);
}
