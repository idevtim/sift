import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small ring spinner in the current text colour (neutral — teal is kept for
 * "you can reclaim this"). With reduced motion it's a still ring.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn(
        "inline-block flex-none animate-spin rounded-full border-2 border-current border-r-transparent opacity-70",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

/** "Something is happening" line: spinner plus muted text. */
export function Loading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 text-[15px] text-mut", className)}>
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** Button label while its action runs: small spinner, then the text. */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner size={14} />
      {children}
    </span>
  );
}
