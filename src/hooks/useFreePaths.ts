import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshAfterRemoval } from "@/lib/refresh";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";

interface FreePathsArgs {
  paths: string[];
  /** What the Restore entry is called ("Vacation 2023.mov", "Extra copies"). */
  label: string;
  /** Browser-mode only: shapes the fake Restore entry. */
  bytes?: number;
  restorable?: boolean;
}

/**
 * Remove specific paths (Big files, Explore, Duplicates, Developer, Apps).
 * The Rust side drops them from the index, so index-backed views just refetch.
 */
export function useFreePaths() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paths, label, bytes, restorable }: FreePathsArgs) =>
      api.freePaths(paths, label, bytes, restorable),
    onSuccess: () => play("chime"),
    onSettled: () => {
      refreshAfterRemoval(queryClient);
      // Re-listing apps re-measures every one; just mark it for next visit.
      void queryClient.invalidateQueries({ queryKey: ["apps"], refetchType: "none" });
    },
  });
}
