import { useEffect, useRef, useState } from "react";
import { DriveMark } from "@/components/ui/DriveMark";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { useScan } from "@/hooks/useScan";
import { fmtGB } from "@/lib/format";
import { play } from "@/lib/sound";
import type { RouteId } from "@/routes";
import { usePrefs } from "@/stores/prefsStore";
import { useScanStore } from "@/stores/scanStore";
import type { Category } from "@/types/api";

/** The overlay never finishes faster than this, even on a small home folder. */
const MIN_DURATION_MS = 3800;

const systemName = { macos: "macOS", windows: "Windows", linux: "System" } as const;

/**
 * Launch overlay: shown on first launch and "Replay first scan". Progress is
 * min(real, elapsed / MIN_DURATION) like Freeing; the six category chips
 * reveal at the prototype's (k + 1) / 7.2 thresholds.
 */
export function FirstScan({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { overlay, progress, startedAt } = useScanStore();
  const { data: summary, dataUpdatedAt, errorUpdatedAt, isFetching } = useScan();
  const platform = usePlatform();
  const [shown, setShown] = useState(0);
  const [fading, setFading] = useState(false);
  const finishing = useRef(false);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Done when the scan has come back — or failed, so the overlay can never
  // be left waiting forever (Home just shows what it has).
  const finished = !isFetching && Math.max(dataUpdatedAt, errorUpdatedAt) >= startedAt;
  const finishedRef = useRef(finished);
  finishedRef.current = finished;

  useEffect(() => {
    if (!overlay) return;
    finishing.current = false;
    setFading(false);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const paced = Math.min(1, (now - start) / MIN_DURATION_MS);
      // Real progress against last scan's total, held under 97% until the
      // scanner says it's done (the estimate can undershoot).
      const p = useScanStore.getState().progress;
      const live =
        p?.done || finishedRef.current ? 1 : p && p.bytesExpected ? Math.min(0.97, p.bytesChecked / p.bytesExpected) : 0;
      setShown((s) => Math.max(s, Math.min(paced, live)));
      raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [overlay, startedAt]);

  // Finish once the scan has returned and the bar has reached the end.
  useEffect(() => {
    if (!overlay || !finished || shown < 1 || finishing.current) return;
    finishing.current = true;
    play("chime");
    const t1 = setTimeout(() => setFading(true), 500);
    const t2 = setTimeout(() => {
      useScanStore.setState({ overlay: false });
      usePrefs.setState({ firstScanDone: true });
      onNavigate("home");
    }, 950);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [overlay, finished, shown, onNavigate]);

  if (!overlay) return null;

  const pct = shown;
  const total = (c: Category) => summary?.categories.find((x) => x.category === c)?.sizeBytes;
  const chips: [string, number | undefined][] = [
    [systemName[platform], total("system")],
    ["Apps", total("apps")],
    ["Photos & videos", total("media")],
    ["Documents", total("documents")],
    ["Developer", total("developer")],
    ["Can be freed", total("freeable")],
  ];
  const done = pct >= 1;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-7 bg-surface transition-opacity duration-450"
      style={{ opacity: fading ? 0 : 1 }}
    >
      <div className="relative" style={{ zoom: 1.5 }}>
        <div className="relative overflow-hidden rounded-3xl bg-panel shadow-[0_0_0_1px_var(--line)]">
          <DriveMark pulse className="bg-panel" />
          {!reduceMotion && (
            <div className="absolute inset-x-0 top-3 h-0.5 animate-[sift-scan_1.6s_ease-in-out_infinite] bg-teal-2 shadow-[0_0_12px_2px_rgba(127,205,187,.7)]" />
          )}
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-[32px] font-bold tracking-[-0.02em]">
          {done ? `All set. Here's your ${deviceName(platform)}.` : "Taking a look around…"}
        </span>
        <span className="h-[18px] max-w-[520px] truncate font-mono text-[13px] text-mut">
          {done ? "Scan complete" : progress?.currentPath.replace(/^(\/Users\/[^/]+|\/home\/[^/]+)/, "~")}
        </span>
      </div>
      <div className="h-2 w-[440px] overflow-hidden rounded bg-line">
        <div className="h-full rounded bg-teal" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
      <div className="grid w-[580px] grid-cols-3 gap-2.5">
        {chips.map(([name, bytes], k) => {
          const on = pct > (k + 1) / 7.2;
          const last = k === chips.length - 1;
          return (
            <div
              key={name}
              className="flex justify-between gap-2 rounded-[14px] px-3.5 py-3 transition-[opacity,transform] duration-450 ease-[cubic-bezier(.2,.9,.3,1.3)]"
              style={{
                opacity: on ? 1 : 0,
                transform: on ? "none" : "translateY(8px) scale(.96)",
                background: last ? "#1F8A76" : "var(--panel)",
                color: last ? "#FFFFFF" : "var(--ink)",
              }}
            >
              <span className="text-sm font-semibold">{name}</span>
              <span className="text-sm">{bytes === undefined || !finished ? "…" : fmtGB(bytes)}</span>
            </div>
          );
        })}
      </div>
      <span className="text-sm text-mut tabular-nums">
        {(progress?.filesChecked ?? 0).toLocaleString()} files checked · nothing is changed during a scan
      </span>
    </div>
  );
}
