import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import type { RouteId } from "@/routes";

interface AppShellProps {
  current: RouteId;
  onNavigate: (id: RouteId) => void;
  children: ReactNode;
  /** Whole-window layers (first scan, quick search) — outside the route-keyed main. */
  overlays?: ReactNode;
}

export function AppShell({ current, onNavigate, children, overlays }: AppShellProps) {
  return (
    <div className="relative flex h-full bg-surface text-ink transition-colors duration-400">
      <Sidebar current={current} onNavigate={onNavigate} />
      {/* Keyed by route so each screen replays its enter animation. */}
      <main key={current} className="relative min-w-0 flex-1 overflow-hidden">
        {children}
      </main>
      {overlays}
    </div>
  );
}
