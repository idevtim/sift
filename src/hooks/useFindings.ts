import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/queries";
import { usePicks } from "@/stores/pickStore";
import { isSelected, useSelection } from "@/stores/selectionStore";
import type { Finding, FindingKind } from "@/types/api";

/** Home's order, from the design. */
const ORDER: FindingKind[] = ["oldInstallers", "trash", "appLeftovers", "tempFiles", "duplicatePhotos", "largeOldVideos"];
const byOrder = (a: Finding, b: Finding) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);

/**
 * Findings plus anything picked in Explore, the current selection and its
 * total (what "Free up" would clear). Duplicate photos and large old videos
 * need the disk index, so they arrive after the rest (`indexLoading`).
 */
export function useFindings() {
  const { data: quick = [], isLoading } = useQuery(queries.findings);
  // Needs the index, which builds after the quick checks (see `useScan`).
  const { data: fromIndex = [], isPending: indexLoading } = useQuery({ ...queries.indexFindings, enabled: !isLoading });
  const findings = [...quick, ...fromIndex].sort(byOrder);
  const overrides = useSelection((s) => s.overrides);
  const toggle = useSelection((s) => s.toggle);
  const picks = usePicks((s) => s.picks);
  const selected = findings.filter((f) => isSelected(overrides, f));
  const selectedPicks = picks.filter((p) => p.on);
  const selectedBytes = [...selected, ...selectedPicks].reduce((sum, f) => sum + f.sizeBytes, 0);
  return {
    findings,
    picks,
    isLoading,
    indexLoading,
    selected,
    selectedPicks,
    selectedBytes,
    isSelected: (f: Finding) => isSelected(overrides, f),
    toggle,
  };
}

/** The drive the OS runs from — the one Home and the sidebar talk about. */
export function useSystemDrive() {
  const { data: drives = [] } = useQuery(queries.drives);
  return { drives, system: drives.find((d) => d.kind === "internal") ?? drives[0] };
}
