import type { QueryClient } from "@tanstack/react-query";

/** Everything a removal can change. */
const AFTER_REMOVAL = ["index", "restore", "findings", "drives"];
/** Removals this close together share one refresh. */
const SETTLE_MS = 800;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Refresh what removals affect, once things settle. Each refresh re-measures
 * caches, leftovers, Docker and simulators in Rust; clicking Remove a few
 * times in a row used to start one of those per click, all at once.
 */
export function refreshAfterRemoval(queryClient: QueryClient) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    for (const key of AFTER_REMOVAL) void queryClient.invalidateQueries({ queryKey: [key] });
  }, SETTLE_MS);
}
