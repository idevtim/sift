import { useQuery } from "@tanstack/react-query";
import { queries, scanQuery } from "@/lib/queries";
import { useScanStore } from "@/stores/scanStore";

const onProgress = (progress: Parameters<NonNullable<Parameters<typeof scanQuery>[0]>>[0]) =>
  useScanStore.setState({ progress });

/**
 * The disk index scan: summary once done, live progress in `useScanStore`.
 * It starts once Home's quick checks are back, so they aren't stuck behind
 * a minutes-long walk competing for the same disk.
 */
export function useScan() {
  const quickDone = useQuery(queries.findings).status !== "pending";
  return useQuery({ ...scanQuery(onProgress), enabled: quickDone });
}
