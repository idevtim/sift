interface UsageRingProps {
  /** Fraction of the disk in use, 0–1. */
  used: number;
  /** Fraction of the disk that the current selection would free, 0–1. */
  freeable: number;
}

/**
 * 140px conic ring: used-minus-selected in ink, the selection in teal, the
 * rest as track. Sweeps in on mount via the animatable `--sw` property.
 */
export function UsageRing({ used, freeable }: UsageRingProps) {
  const usedPct = used * 100;
  const keepPct = Math.max(0, used - freeable) * 100;
  const background = `conic-gradient(var(--ink) 0 calc(var(--sw) * ${keepPct.toFixed(2)}%), #1F8A76 0 calc(var(--sw) * ${usedPct.toFixed(2)}%), var(--line) 0)`;
  return (
    <div
      className="flex size-[140px] flex-none animate-sift-sweep items-center justify-center rounded-full"
      style={{ background }}
    >
      <div className="flex size-[110px] flex-col items-center justify-center rounded-full bg-surface">
        <span className="text-[26px] font-bold">{Math.round(usedPct)}%</span>
        <span className="text-xs text-mut">full</span>
      </div>
    </div>
  );
}
