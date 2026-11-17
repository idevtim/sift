import { useRef, type ReactNode } from "react";
import { AppMark } from "@/components/ui/DriveMark";
import { useQuery } from "@tanstack/react-query";
import { useFindings, useSystemDrive } from "@/hooks/useFindings";
import { usePlatform } from "@/hooks/usePlatform";
import { resolveTheme } from "@/hooks/useTheme";
import { useRescan } from "@/hooks/useRescan";
import { useScan } from "@/hooks/useScan";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { fmtBig, fmtGB } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { restartToUpdate } from "@/lib/updates";
import { cn } from "@/lib/utils";
import { routeById, routesIn, type RouteId } from "@/routes";
import { usePalette } from "@/stores/paletteStore";
import { usePrefs } from "@/stores/prefsStore";
import { useUpdateStore } from "@/stores/updateStore";
import { defaultCleanable } from "@/views/developer/DeveloperView";
import { Busy } from "@/components/ui/Spinner";

interface SidebarProps {
  current: RouteId;
  onNavigate: (id: RouteId) => void;
}

/** Each page's tile: a line glyph on its own colour, like the Home tiles. */
const NAV: Partial<Record<RouteId, { hue: [string, string]; glyph: ReactNode }>> = {
  home: {
    hue: ["#5fd3b8", "#1f8a76"],
    glyph: (
      <>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v10h14V10" />
      </>
    ),
  },
  drives: {
    hue: ["#9fb4c6", "#4f6b80"],
    glyph: (
      <>
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M5 13l2-8h10l2 8" />
        <path d="M17 16.5h.01" />
      </>
    ),
  },
  "big-files": {
    hue: ["#d3b5ff", "#7a4fd6"],
    glyph: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </>
    ),
  },
  restore: {
    hue: ["#ffd99a", "#d39a45"],
    glyph: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </>
    ),
  },
  explore: {
    hue: ["#8fd0ff", "#2d7fd6"],
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" />
      </>
    ),
  },
  duplicates: {
    hue: ["#9aa8ff", "#4b55c9"],
    glyph: (
      <>
        <rect x="3" y="7" width="14" height="13" rx="2" />
        <path d="M7 4h12a2 2 0 0 1 2 2v11" />
      </>
    ),
  },
  apps: {
    hue: ["#ffb98a", "#e0743a"],
    glyph: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
      </>
    ),
  },
  agents: {
    hue: ["#f3a6d8", "#a24bd1"],
    glyph: (
      <>
        <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" />
        <path d="M18 15l.8 2 2 .8-2 .7-.8 2.1-.8-2.1-2-.7 2-.8z" />
      </>
    ),
  },
  developer: {
    hue: ["#c3ccd6", "#5b6672"],
    glyph: (
      <>
        <path d="M8 8l-4 4 4 4" />
        <path d="M16 8l4 4-4 4" />
      </>
    ),
  },
};

export function Sidebar({ current, onNavigate }: SidebarProps) {
  const platform = usePlatform();
  const dragRef = useRef<HTMLDivElement>(null);
  useWindowDrag(dragRef);
  const { selectedBytes, findings, picks } = useFindings();
  const { drives, system } = useSystemDrive();
  const { data: restore = [] } = useQuery(queries.restore);
  const { isSuccess: scanned } = useScan();
  // Power-tool badges once the index exists. Apps needs a separate (slower)
  // pass, so its badge waits until the page has been opened.
  const { data: dupes } = useQuery({ ...queries.duplicates, enabled: scanned });
  const { data: dev } = useQuery({ ...queries.dev, enabled: scanned });
  const { data: apps } = useQuery({ ...queries.apps, enabled: false });
  // Like Apps, the AI agents badge waits until that page has been opened.
  const { data: agents } = useQuery({ ...queries.agents, enabled: false });
  const agentBytes = (agents?.tools ?? [])
    .flatMap((t) => t.items)
    .filter((i) => i.removable && i.defaultOn && !i.blocked)
    .reduce((s, i) => s + i.sizeBytes, 0);
  const dupeBytes = (dupes ?? []).reduce((s, g) => s + g.sizeBytes * (g.copies.length - 1), 0);
  const devBytes = dev ? defaultCleanable(dev) : 0;
  const { theme, setTheme, soundOn, toggleSound, powerToolsOpen, togglePowerTools } = usePrefs();
  const update = useUpdateStore();
  const { rescan, busy: rescanning } = useRescan();
  const active = routeById(current).activeAs ?? current;
  const dark = resolveTheme(theme) === "dark";

  const badges: Partial<Record<RouteId, string>> = {
    home: findings.length + picks.length ? fmtGB(selectedBytes) : "",
    drives: drives.length ? String(drives.length) : "",
    // Only what can still come back; records of deleted caches don't count.
    restore: restore.some((e) => e.restorable) ? String(restore.filter((e) => e.restorable).length) : "",
    duplicates: dupeBytes > 0 ? fmtGB(dupeBytes) : "",
    apps: apps?.supported && apps.apps.length ? String(apps.apps.length) : "",
    developer: devBytes > 0 ? fmtGB(devBytes) : "",
    agents: agentBytes > 0 ? fmtGB(agentBytes) : "",
  };
  // Amounts you can free read in the reclaim colour; counts stay neutral.
  const gainBadge: Partial<Record<RouteId, boolean>> = { home: true, duplicates: true, developer: true, agents: true };

  const go = (id: RouteId) => {
    play("tap");
    onNavigate(id);
  };

  const item = (id: RouteId, label: string) => (
    <NavItem
      key={id}
      id={id}
      active={active === id}
      badge={badges[id]}
      gain={gainBadge[id]}
      onClick={() => go(id)}
    >
      {label}
    </NavItem>
  );

  return (
    <aside className="flex w-[220px] flex-none flex-col gap-4 px-3 pt-5 pb-4">
      {/* macOS draws native traffic lights here (overlay title bar); on
          Windows/Linux the native title bar sits above, so no inset. */}
      {platform === "macos" && <div ref={dragRef} className="-mx-3 -mt-5 h-8 flex-none" />}

      <div className="flex items-center gap-2.5 px-2">
        <AppMark size={32} />
        <span className="text-xl font-extrabold tracking-[-0.03em]">sift</span>
      </div>

      <button
        type="button"
        onClick={() => usePalette.getState().setOpen(true)}
        className="st-glass st-mut flex cursor-pointer items-center justify-between rounded-[14px] py-2 pr-2 pl-3 text-sm transition-transform duration-400 ease-spring-bounce hover:-translate-y-px active:scale-[.97]"
      >
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          Search
        </span>
        <kbd className="rounded-md bg-[var(--st-row)] px-1.5 py-0.5 font-sans text-xs font-semibold">
          {platform === "macos" ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <nav aria-label="Main" className="flex flex-col gap-0.5 text-[15px] font-medium">
        {routesIn("everyday").map((r) => item(r.id, r.label))}
      </nav>

      <div className="-mt-1 flex flex-col gap-0.5 text-[15px] font-medium">
        <button
          type="button"
          aria-expanded={powerToolsOpen}
          onClick={() => {
            play("tap");
            togglePowerTools();
          }}
          className="st-mut flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-xs font-bold tracking-[0.08em] hover:text-[var(--st-ink)]"
        >
          <span>POWER TOOLS</span>
          <span
            className={cn(
              "inline-block text-base transition-transform duration-500 ease-spring-bounce",
              powerToolsOpen && "rotate-90",
            )}
          >
            ›
          </span>
        </button>
        {powerToolsOpen && (
          <div className="flex flex-col gap-0.5">
            {routesIn("power").map((r, i) => (
              <div key={r.id} className="animate-rise" style={{ animationDelay: `${i * 0.04}s` }}>
                {item(r.id, r.label)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {update.version && (
        <div className="st-glass animate-rise flex flex-col gap-2 rounded-2xl p-3">
          <span className="text-sm font-semibold">Sift {update.version} is ready</span>
          <button
            type="button"
            disabled={update.installing}
            onClick={() => {
              play("tap");
              void restartToUpdate();
            }}
            className="cursor-pointer rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-surface transition-transform duration-400 ease-spring-bounce active:scale-95 disabled:cursor-default disabled:opacity-60"
          >
            {update.installing ? <Busy>Updating…</Busy> : "Restart to update"}
          </button>
        </div>
      )}

      <div className="st-glass flex flex-col gap-2 rounded-2xl p-3">
        {system && (
          <>
            <span className="text-sm font-semibold">{system.name}</span>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-[var(--st-row)] shadow-[inset_0_0_0_1px_var(--st-edge)]">
              <div
                className="h-full rounded-[3px] bg-ink transition-[width] duration-1200 ease-spring-bounce"
                style={{ width: `${(system.usedBytes / system.capacityBytes) * 100}%` }}
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="st-mut text-[13px]">
            {system ? `${fmtBig(system.capacityBytes - system.usedBytes)} free` : ""}
          </span>
          <button
            type="button"
            disabled={rescanning}
            title="Look at this computer again for changes"
            onClick={() => {
              play("tap");
              void rescan();
            }}
            className="st-mut flex-none cursor-pointer rounded-full px-2 py-0.5 text-[13px] font-semibold transition-[color,background-color,transform] duration-400 ease-spring-bounce hover:bg-[var(--st-row)] hover:text-[var(--st-ink)] active:scale-95 disabled:cursor-default disabled:opacity-60 disabled:active:scale-100"
          >
            {rescanning ? <Busy>Scanning</Busy> : "↻ Rescan"}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <PillButton
          onClick={() => {
            play("tap");
            setTheme(dark ? "light" : "dark");
          }}
        >
          <span>{dark ? "☀" : "☾"}</span>
          <span>{dark ? "Light" : "Dark"}</span>
        </PillButton>
        <PillButton
          className={soundOn ? "" : "st-mut"}
          onClick={() => {
            toggleSound();
            play("tap");
          }}
        >
          <span>♪</span>
          <span>{soundOn ? "Sound on" : "Muted"}</span>
        </PillButton>
      </div>
    </aside>
  );
}

function NavItem({
  id,
  active,
  badge,
  gain,
  onClick,
  children,
}: {
  id: RouteId;
  active: boolean;
  badge?: string;
  gain?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const nav = NAV[id];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2.5 rounded-[14px] py-1.5 pr-2.5 pl-1.5 text-left transition-[background-color,box-shadow,transform] duration-300 active:scale-[.97]",
        active ? "st-glass" : "hover:bg-[var(--st-row)]",
      )}
      style={active ? { backgroundColor: "var(--st-glass-hi)" } : undefined}
    >
      {nav && (
        <span
          // Re-keyed when it becomes active, so the pop replays.
          key={active ? "on" : "off"}
          aria-hidden="true"
          className={cn(
            "flex size-[30px] flex-none items-center justify-center rounded-[9px] text-white transition-transform duration-500 ease-spring-bounce group-hover:scale-110",
            active && "animate-nav-pop",
          )}
          style={{
            background: `linear-gradient(140deg, ${nav.hue[0]}, ${nav.hue[1]})`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.45), 0 3px 8px -2px rgba(0,0,0,.25)",
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {nav.glyph}
          </svg>
        </span>
      )}
      <span className={cn("flex-1 truncate", active ? "font-semibold" : "st-mut")}>{children}</span>
      {badge && (
        <span className={cn("text-xs font-semibold tabular-nums", gain ? "st-gain" : "st-mut")}>{badge}</span>
      )}
    </button>
  );
}

function PillButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "st-glass flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-1.5 py-[9px] text-[13px] font-semibold transition-transform duration-400 ease-spring-bounce hover:-translate-y-px active:scale-95",
        className,
      )}
      {...props}
    />
  );
}
