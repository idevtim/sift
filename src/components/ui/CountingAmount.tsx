import { cn } from "@/lib/utils";

/** "9.8 GB" / "10.0 GB": one decimal always, so digits only change in place while counting. */
const fixed = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/**
 * An amount that counts up or down without shoving the words around it. It
 * reserves the width of its final value (a hidden copy in the same grid cell),
 * uses tabular digits and always shows one decimal, so "9.8 GB" turning into
 * "10.2 GB" doesn't move the text beside it.
 */
export function CountingAmount({ bytes, to, className }: { bytes: number; to: number; className?: string }) {
  return (
    <span className={cn("inline-grid text-right align-baseline tabular-nums", className)}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {fixed(Math.max(to, bytes))}
      </span>
      <span className="col-start-1 row-start-1">{fixed(bytes)}</span>
    </span>
  );
}
