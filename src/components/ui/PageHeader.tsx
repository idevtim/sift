import type { ReactNode } from "react";

/** H2 page title (36/700) with a muted subtitle. */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-4xl font-bold tracking-[-0.02em]">{title}</h2>
      {children && <span className="text-base text-mut">{children}</span>}
    </div>
  );
}
