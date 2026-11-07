import { useQueryClient } from "@tanstack/react-query";
import { useScanStore } from "@/stores/scanStore";

/** Rescan with the first-scan overlay showing (⌘K → "Replay first scan"). */
export function useReplayScan() {
  const queryClient = useQueryClient();
  return () => {
    useScanStore.setState({ overlay: true, startedAt: Date.now(), progress: null });
    void queryClient.invalidateQueries({ queryKey: ["scan"] });
  };
}
