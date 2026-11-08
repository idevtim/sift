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
  };

  const go = (id: RouteId) => {
    play("tap");
    onNavigate(id);
  };

  return (
    <aside className="flex w-[220px] flex-none flex-col gap-[18px] bg-panel px-3.5 pt-5 pb-5 transition-colors duration-400">
      {/* macOS draws native traffic lights here (overlay title bar); on
          Windows/Linux the native title bar sits above, so no inset. */}
      {platform === "macos" && <div ref={dragRef} className="-mx-3.5 -mt-5 h-8 flex-none" />}

      <div className="flex items-center gap-2.5 px-2">
        <AppMark size={32} />
        <span className="text-xl font-extrabold tracking-[-0.03em]">sift</span>
      </div>

      <button
        type="button"
        onClick={() => usePalette.getState().setOpen(true)}
        className="flex cursor-pointer items-center justify-between rounded-xl bg-surface px-3 py-[9px] text-sm text-mut shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--line2)]"
      >
        <span>⌕&nbsp;&nbsp;Search</span>
        <kbd className="rounded-md px-1.5 py-0.5 font-sans text-xs font-semibold shadow-[inset_0_0_0_1px_var(--line2)]">
          {platform === "macos" ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <nav className="flex flex-col gap-1 text-[15px] font-medium">
        {routesIn("everyday").map((r) => (
          <NavItem key={r.id} active={active === r.id} badge={badges[r.id]} onClick={() => go(r.id)}>
            {r.label}
          </NavItem>
        ))}
      </nav>

      <div className="-mt-2 flex flex-col gap-1 text-[15px] font-medium">
        <button
          type="button"
          onClick={() => {
            play("tap");
            togglePowerTools();
          }}
          className="flex cursor-pointer items-center justify-between px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-mut3 hover:text-ink"
        >
          <span>POWER TOOLS</span>
          <span className={cn("inline-block text-base transition-transform duration-250 ease-spring", powerToolsOpen && "rotate-90")}>
            ›
          </span>
        </button>
        {powerToolsOpen && (
          <div className="flex animate-sift-in flex-col gap-1">
            {routesIn("power").map((r) => (
              <NavItem key={r.id} active={active === r.id} badge={badges[r.id]} onClick={() => go(r.id)}>
                {r.label}
              </NavItem>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {update.version && (
        <div className="flex animate-sift-in flex-col gap-2 rounded-[14px] bg-surface p-3">
          <span className="text-sm font-semibold">Sift {update.version} is ready</span>
          <button
            type="button"
            disabled={update.installing}
            onClick={() => {
              play("tap");
              void restartToUpdate();
            }}
            className="cursor-pointer rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-surface transition-transform duration-200 active:scale-[.97] disabled:cursor-default disabled:opacity-60"
          >
            {update.installing ? <Busy>Updating…</Busy> : "Restart to update"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[14px] bg-surface p-3">
        {system && (
          <>
            <span className="text-sm font-semibold">{system.name}</span>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-line">
              <div
                className="h-full rounded-[3px] bg-ink transition-[width] duration-1200"
                style={{ width: `${(system.usedBytes / system.capacityBytes) * 100}%` }}
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-mut">{system ? `${fmtBig(system.capacityBytes - system.usedBytes)} free` : ""}</span>
          <button
            type="button"
            disabled={rescanning}
            title="Look at this computer again for changes"
            onClick={() => {
              play("tap");
              void rescan();
            }}
            className="flex-none cursor-pointer rounded-full px-2 py-0.5 text-[13px] font-semibold text-mut2 shadow-[inset_0_0_0_1px_var(--line)] transition-[color,box-shadow,transform] duration-150 hover:text-ink hover:shadow-[inset_0_0_0_1px_var(--line2)] active:scale-[.96] disabled:cursor-default disabled:text-mut3 disabled:active:scale-100"
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
          className={soundOn ? "text-ink" : "text-mut3"}
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

function NavItem({ active, badge, onClick, children }: { active: boolean; badge?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors duration-200 hover:bg-surface",
        active ? "bg-surface text-ink shadow-nav-active" : "text-mut2",
      )}
    >
      <span>{children}</span>
      {badge && <span className="text-xs font-semibold text-mut">{badge}</span>}
    </button>
  );
}

function PillButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-surface px-1.5 py-[9px] text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--line)] transition-transform duration-150 active:scale-[.96]",
        className,
      )}
      {...props}
    />
  );
}
