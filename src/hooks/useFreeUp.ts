import { useQueryClient } from "@tanstack/react-query";
import type { IconName } from "@/components/ui/Icon";
import { api } from "@/lib/tauri";
import { play } from "@/lib/sound";
import type { RouteId } from "@/routes";
import { findingCopy } from "@/lib/findingCopy";
import { useFreeStore, type FreeItem } from "@/stores/freeStore";
import { usePicks, type Pick } from "@/stores/pickStore";
import { resetSelection } from "@/stores/selectionStore";
import { toast } from "@/stores/toastStore";
import type { Finding, FindingKind, Reason } from "@/types/api";

/** The freeing animation never runs shorter than this, even when renames are instant. */
const MIN_DURATION_MS = 2400;

/** Home categories that are deleted outright rather than held in Restore. */
const FOR_GOOD_KINDS: FindingKind[] = ["trash", "tempFiles"];
/** Mirrors `Reason::deletes_outright` in the Rust index. */
const FOR_GOOD_REASONS: Reason[] = ["cache", "trash", "nodeModules", "rustTarget", "derivedData"];

export const findingHeld = (kind: FindingKind) => !FOR_GOOD_KINDS.includes(kind);
export const pickHeld = (p: Pick) => !(p.reason && FOR_GOOD_REASONS.includes(p.reason));
export const pickIcon = (p: Pick): IconName =>
  p.reason === "installer" ? "installer" : p.reason === "trash" ? "trash" : "temp";

/**
 * Start freeing `items` (Home categories) and `picks` (from Explore), moving
 * them to Restore. By default it shows Freeing, then Done. With `inPlace`
 * (Home's Sweep) it stays put and drives `useFreeStore().sweep` instead;
 * results and failures arrive as toasts.
 * Shown progress is min(real, elapsed / MIN_DURATION) so a fast run still
 * reads as deliberate and a slow one never runs ahead of the disk.
 */
export function useFreeUp(onNavigate: (id: RouteId) => void, { inPlace = false } = {}) {
  const queryClient = useQueryClient();

  return async (items: Finding[], picks: Pick[] = []) => {
    if (!items.length && !picks.length) return;
    if (useFreeStore.getState().sweep === "running") return;
    const labelled: FreeItem[] = [
      ...items.map((f) => ({
        name: findingCopy[f.kind].name,
        sizeBytes: f.sizeBytes,
        icon: findingCopy[f.kind].icon,
        held: findingHeld(f.kind),
      })),
      ...picks.map((p) => ({ name: p.name, sizeBytes: p.sizeBytes, icon: pickIcon(p), held: pickHeld(p) })),
    ];
    const totalBytes = labelled.reduce((sum, f) => sum + f.sizeBytes, 0);
    // Categories first, then picks; each phase's share of the bar is its share of the bytes.
    const categoryShare = totalBytes ? items.reduce((sum, f) => sum + f.sizeBytes, 0) / totalBytes : 1;
    useFreeStore.setState({
      items: labelled,
      totalBytes,
      progress: 0,
      freedBytes: 0,
      skipped: 0,
      error: null,
      sweep: inPlace ? "running" : "idle",
    });
    if (!inPlace) onNavigate("freeing");
    play("sift");

    let real = 0;
    let finished = false;
    const start = performance.now();
    const raf = new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const paced = Math.min(1, (now - start) / MIN_DURATION_MS);
        useFreeStore.setState({ progress: Math.min(real, paced) });
        if (finished && paced >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    try {
      const report = items.length
        ? await api.freeUp(
            items.map((f) => f.kind),
            (fraction) => {
              real = fraction * categoryShare;
            },
          )
        : { freedBytes: 0, skipped: 0 };
      for (const [i, p] of picks.entries()) {
        const r = await api.freePaths([p.path], p.name, p.sizeBytes, p.reason === "installer");
        report.freedBytes += r.freedBytes;
        report.skipped += r.skipped;
        real = categoryShare + ((1 - categoryShare) * (i + 1)) / picks.length;
      }
      real = 1;
      finished = true;
      await raf;
      useFreeStore.setState({
        freedBytes: report.freedBytes,
        skipped: report.skipped,
        sweep: inPlace ? "done" : "idle",
      });
      play("chime");
      if (!inPlace) onNavigate("done");
      else if (report.skipped > 0)
        toast(
          `${report.skipped} ${report.skipped === 1 ? "item was" : "items were"} in use, so Sift left ${report.skipped === 1 ? "it" : "them"} alone.`,
        );
    } catch (e) {
      finished = true;
      real = 1;
      useFreeStore.setState({ error: String(e), sweep: "idle" });
      if (!inPlace) onNavigate("done");
      else toast(`That didn't finish. Anything Sift already moved is safe in Restore. ${String(e)}`, { tone: "problem" });
    } finally {
      resetSelection();
      usePicks.getState().clear();
      for (const key of ["findings", "drives", "restore", "index"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
  };
}
