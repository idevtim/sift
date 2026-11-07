import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import { play } from "@/lib/sound";
import type { RouteId } from "@/routes";
import { findingCopy } from "@/lib/findingCopy";
import { useFreeStore } from "@/stores/freeStore";
import { usePicks, type Pick } from "@/stores/pickStore";
import { resetSelection } from "@/stores/selectionStore";
import type { Finding } from "@/types/api";

/** The freeing animation never runs shorter than this, even when renames are instant. */
const MIN_DURATION_MS = 2400;

/**
 * Start freeing `items` (Home categories) and `picks` (from Explore): show
 * Freeing, move them to Restore, then show Done.
 * Shown progress is min(real, elapsed / MIN_DURATION) so a fast run still
 * reads as deliberate and a slow one never runs ahead of the disk.
 */
export function useFreeUp(onNavigate: (id: RouteId) => void) {
  const queryClient = useQueryClient();

  return async (items: Finding[], picks: Pick[] = []) => {
    if (!items.length && !picks.length) return;
    const labelled = [
      ...items.map((f) => ({ name: findingCopy[f.kind].name, sizeBytes: f.sizeBytes })),
      ...picks.map((p) => ({ name: p.name, sizeBytes: p.sizeBytes })),
    ];
    const totalBytes = labelled.reduce((sum, f) => sum + f.sizeBytes, 0);
    // Categories first, then picks; each phase's share of the bar is its share of the bytes.
    const categoryShare = totalBytes ? items.reduce((sum, f) => sum + f.sizeBytes, 0) / totalBytes : 1;
    useFreeStore.setState({ items: labelled, totalBytes, progress: 0, freedBytes: 0, skipped: 0, error: null });
    onNavigate("freeing");
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
      useFreeStore.setState({ freedBytes: report.freedBytes, skipped: report.skipped });
      play("chime");
      onNavigate("done");
    } catch (e) {
      finished = true;
      real = 1;
      useFreeStore.setState({ error: String(e) });
      onNavigate("done");
    } finally {
      resetSelection();
      usePicks.getState().clear();
      for (const key of ["findings", "drives", "restore", "index"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
  };
}
