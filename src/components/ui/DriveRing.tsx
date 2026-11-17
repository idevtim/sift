import { useEffect, useState, type MouseEvent } from "react";
import { fmtBig, fmtGB } from "@/lib/format";
import { cn } from "@/lib/utils";

const R = 45;
const C = 2 * Math.PI * R;
/** The drive is drawn at its 128×100 master size (like `DriveMark`) and scaled. */
const MASTER_W = 128;
const BARS = [
  { w: 72, color: "#1F8A76" },
  { w: 50, color: "#7FCDBB" },
  { w: 26, color: "#BFE6DC" },
];

interface DriveRingProps {
  size: number;
  /**
   * `drive`: the ring is the disk — used space in ink, what can be freed in
   * teal, the rest free. `progress`: the ring just fills as work goes.
   */
  mode: "drive" | "progress";
  /** Fraction of the disk in use (drive mode). */
  used?: number;
  /** Fraction of the disk that can be freed (drive mode). */
  freeable?: number;
  /** 0–1. Drive mode drains the teal slice; progress mode fills the ring. */
  progress?: number;
  /** Grains fall out of the drive while it works. */
  working?: boolean;
  /** Finished: the bars settle short and the dot pops. */
  done?: boolean;
  /** The disk's size (drive mode): hovering a part of the ring names it. */
  capacityBytes?: number;
  className?: string;
}

interface Tip {
  label: string;
  value: string;
  color: string;
  x: number;
  y: number;
}

/**
 * Sift's drive icon inside a ring. On Home the ring is the real disk and the
 * teal slice drains as a sweep frees it; on Freeing and first scan it fills
 * with progress. The bars shrink as space comes back. With `capacityBytes`,
 * hovering a part of the ring shows what it is and how big.
 */
export function DriveRing({
  size,
  mode,
  used = 0,
  freeable = 0,
  progress = 0,
  working = false,
  done = false,
  capacityBytes,
  className,
}: DriveRingProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  // Arcs grow in from nothing once, so the ring springs into place.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const p = Math.min(1, Math.max(0, progress));
  const k = shown ? 1 : 0;
  // Drive mode: ink is what stays, teal what's left to free.
  const keep = mode === "drive" ? Math.max(0, used - freeable) * k : 0;
  const teal = (mode === "drive" ? freeable * (1 - (done ? 1 : p)) : done ? 1 : p) * k;
  const arc = (from: number, len: number) => ({
    strokeDasharray: `${Math.max(0, len) * C} ${C}`,
    strokeDashoffset: -from * C,
  });

  // What each part of the ring stands for, in bytes, for the hover tooltip.
  const tips = mode === "drive" && capacityBytes ? capacityBytes : 0;
  const inUse = Math.max(0, used - freeable) * tips;
  const toFree = freeable * (1 - (done ? 1 : p)) * tips;
  const freeSpace = Math.max(0, tips - inUse - toFree);

  /** Which part of the ring the pointer is over, by angle (clockwise from the top). */
  const hover = (e: MouseEvent<HTMLDivElement>) => {
    if (!tips) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const dx = x - box.width / 2;
    const dy = y - box.height / 2;
    // Measured against the drawn box, which can be mid-spring (scaled).
    const r = (Math.hypot(dx, dy) / box.width) * 100;
    if (Math.abs(r - R) > 6) return setTip(null);
    const at = ((Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    // Uses the settled sizes, not the animated ones, so it's right mid-spring.
    const keepAt = inUse / tips;
    const part =
      at < keepAt
        ? { label: "In use", value: fmtBig(inUse), color: "var(--ink)" }
        : at < keepAt + toFree / tips
          ? { label: done || p > 0 ? "Left to free" : "You can free", value: fmtGB(toFree), color: "#1f8a76" }
          : { label: "Free space", value: fmtBig(freeSpace), color: "var(--track)" };
    setTip({ ...part, x, y });
  };

  const scale = (size * 0.5) / MASTER_W;
  // Bars shrink as space comes back: a little in drive mode, all the way to "short" when done.
  const shrink = done ? 0.45 : mode === "drive" ? 1 - 0.5 * p : 1;

  return (
    <div
      role={tips ? "img" : undefined}
      aria-label={
        tips ? `${fmtBig(inUse)} in use, ${fmtGB(toFree)} you can free, ${fmtBig(freeSpace)} free` : undefined
      }
      aria-hidden={tips ? undefined : true}
      onMouseMove={tips ? hover : undefined}
      onMouseLeave={() => setTip(null)}
      className={cn("relative flex-none", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" className="absolute inset-0 -rotate-90 overflow-visible">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--track)" strokeWidth="6" />
        {/* Ink ends rounded at the top; teal is drawn over its far end with
            square ends, so the two read as one continuous line. */}
        {keep > 0 && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="6"
            strokeLinecap="round"
            className="transition-[stroke-dasharray,stroke-dashoffset] duration-1000 ease-spring"
            style={arc(0, keep)}
          />
        )}
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="#1f8a76"
          strokeWidth="6"
          strokeLinecap="butt"
          className="transition-[stroke-dasharray,stroke-dashoffset] duration-1000 ease-spring"
          style={{
            ...arc(keep, teal),
            filter: "drop-shadow(0 0 3px rgba(47,181,154,.55))",
            opacity: teal > 0.002 ? 1 : 0,
          }}
        />
        {/* The teal's free end gets the round cap: a dot riding the arc's end,
            turned into place with the same spring. */}
        <g
          className="transition-[transform,opacity] duration-1000 ease-spring"
          style={{
            transform: `rotate(${(keep + teal) * 360}deg)`,
            transformOrigin: "50px 50px",
            opacity: teal > 0.002 ? 1 : 0,
          }}
        >
          <circle cx={50 + R} cy="50" r="3" fill="#1f8a76" />
        </g>
      </svg>

      {/* The drive, centred, at its master size scaled to fit. */}
      <div
        className="absolute top-1/2 left-1/2"
        style={{ width: MASTER_W * scale, height: 100 * scale, transform: "translate(-50%, -54%)" }}
      >
        <div
          className="relative origin-top-left"
          style={{ width: MASTER_W, height: 100, transform: `scale(${scale})` }}
        >
          <div style={{ position: "absolute", inset: 0, animation: "sift-float 6s ease-in-out infinite" }}>
            <div
              className="absolute inset-0 flex flex-col gap-[7px] rounded-3xl px-5 py-[22px]"
              style={{
                background: "linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, white), var(--surface))",
                boxShadow:
                  "inset 0 -12px 0 var(--mint), inset 0 1px 0 rgba(255,255,255,.7), 0 18px 34px -14px rgba(23,112,95,.55), 0 0 0 1px var(--st-edge)",
              }}
            >
              {BARS.map((b, i) => (
                <div
                  key={b.w}
                  className="h-[9px] origin-left transition-transform duration-1000 ease-spring"
                  style={{ width: b.w, transform: `scaleX(${shrink})`, transitionDelay: `${i * 0.08}s` }}
                >
                  <div
                    className={cn("size-full origin-left rounded-[5px]", !working && !done && "animate-sift-pulse")}
                    style={{ background: b.color, animationDelay: `${i * 0.15}s` }}
                  />
                </div>
              ))}
              <div
                key={done ? "done" : "idle"}
                className={cn(
                  "absolute right-5 bottom-[22px] size-[11px] rounded-[6px] bg-teal",
                  done && "animate-check",
                )}
              />
            </div>
            {working &&
              [44, 62, 78].map((x, i) => (
                <span
                  key={x}
                  className="absolute top-[96px] size-[7px] rounded-full bg-teal-2 opacity-0"
                  style={{ left: x, animation: `sift-drip 1.1s ease-in ${i * 0.35}s infinite` }}
                />
              ))}
          </div>
        </div>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-20 flex items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-3 py-2 text-[13px] whitespace-nowrap shadow-[0_10px_28px_-10px_rgba(0,0,0,.4),inset_0_0_0_1px_var(--st-edge)] backdrop-blur-xl"
          style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 12px))" }}
        >
          <span
            className="size-2.5 flex-none rounded-full shadow-[inset_0_0_0_1px_var(--line2)]"
            style={{ background: tip.color }}
          />
          <span className="text-mut">{tip.label}</span>
          <span className="font-semibold tabular-nums">{tip.value}</span>
        </div>
      )}
    </div>
  );
}
