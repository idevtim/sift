import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/stores/toastStore";

/**
 * Look at the computer again after changes made outside Sift (or since the
 * launch scan). Same order as launch: Home's quick checks first, then the
 * disk index, whose new summary refreshes everything under ["index"].
 * Apps is only marked stale — re-listing measures every app, so it waits
 * until the page is opened.
 */
export function useRescan() {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const scanning = useIsFetching({ queryKey: ["scan"] }) > 0;
  const busy = starting || scanning;

  const rescan = async () => {
    if (busy) return;
    setStarting(true);
    try {
      void queryClient.invalidateQueries({ queryKey: ["apps"], refetchType: "none" });
      for (const key of ["drives", "restore"]) void queryClient.invalidateQueries({ queryKey: [key] });
      await queryClient.invalidateQueries({ queryKey: ["findings"] });
    } finally {
      setStarting(false);
    }
    try {
      await queryClient.refetchQueries({ queryKey: ["scan"] }, { throwOnError: true });
      toast("Rescan finished. Everything's up to date.");
    } catch (e) {
      toast(`Couldn't finish the rescan. ${String(e)}`, { tone: "problem" });
    }
  };

  return { rescan, busy };
}
