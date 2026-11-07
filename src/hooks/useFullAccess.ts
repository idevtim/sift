import { useQuery } from "@tanstack/react-query";
import { usePlatform } from "@/hooks/usePlatform";
import { api } from "@/lib/tauri";

/**
 * Whether Sift can see macOS's private folders (Full Disk Access). Checked
 * again whenever the window comes back to the front, and every second while
 * `watching` (the permission step), so it flips as soon as access is on.
 * Windows and Linux have nothing to grant: always true. `undefined` until
 * the first check is back.
 */
export function useFullAccess(watching = false): boolean | undefined {
  const platform = usePlatform();
  const { data } = useQuery({
    queryKey: ["full-access"],
    queryFn: api.fullAccess,
    enabled: platform === "macos",
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: watching ? 1000 : false,
  });
  return platform === "macos" ? data : true;
}
