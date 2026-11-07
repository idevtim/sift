import { Button } from "@/components/ui/Button";
import { DriveMark } from "@/components/ui/DriveMark";
import { useCountUp } from "@/hooks/useCountUp";
import { useSystemDrive } from "@/hooks/useFindings";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { fmtBig, fmtGB } from "@/lib/format";
import { play } from "@/lib/sound";
import type { RouteId } from "@/routes";
import { useFreeStore } from "@/stores/freeStore";

const GRAIN_COLORS = ["#1F8A76", "#7FCDBB", "var(--surface)", "var(--ink)", "#BFE6DC"];

/** 40 falling "grains" — deterministic spread, same as the prototype. */
const grains = Array.from({ length: 40 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  size: `${4 + ((i * 7) % 9)}px`,
  color: GRAIN_COLORS[i % 5],
  duration: `${(1.8 + (i % 5) * 0.3).toFixed(2)}s`,
  delay: `${((i * 0.09) % 1.4).toFixed(2)}s`,
}));

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function DoneView({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { freedBytes, skipped, error } = useFreeStore();
  const count = useCountUp(freedBytes, 1100);
  const { system } = useSystemDrive();
  const device = deviceName(usePlatform());
  const go = (id: RouteId) => {
    play("tap");
    onNavigate(id);
  };

  if (error) {
    return (
      <div className="absolute inset-0 flex animate-sift-in flex-col items-center justify-center gap-6 p-12 text-center">
        <span className="text-[34px] font-bold tracking-[-0.02em]">That didn't finish</span>
        <span className="max-w-[520px] text-base leading-[1.45] text-mut">
          Anything Sift already moved is safe in Restore. {error}
        </span>
        <div className="flex gap-3">
          <Button variant="ink" onClick={() => go("home")}>Back to home</Button>
          <Button variant="plain" onClick={() => go("restore")}>Open Restore</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex animate-[sift-in_.5s_ease_both] flex-col items-center justify-center gap-7 bg-mint p-12 text-center">
      {!reduceMotion() && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {grains.map((g, i) => (
            <div
              key={i}
              className="absolute -top-5 rounded-full"
              style={{
                left: g.left,
                width: g.size,
                height: g.size,
                background: g.color,
                animation: `sift-shower ${g.duration} cubic-bezier(.4,0,.8,.6) ${g.delay} both`,
              }}
            />
          ))}
        </div>
      )}
      <div style={{ zoom: 1.8 }}>
        <DriveMark drop className="shadow-[inset_0_-12px_0_#BFE6DC,0_12px_30px_-12px_rgba(23,112,95,.45)]" />
      </div>
      <div className="flex flex-col items-center gap-3">
        <span className="text-xl font-medium text-tealtx">All done</span>
        <span className="text-[64px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
          You got {fmtGB(count)} back
        </span>
        <span className="max-w-[560px] text-[19px] leading-[1.45] text-pretty text-donetx">
          {system && `Your ${device} now has ${fmtBig(system.capacityBytes - system.usedBytes)} free. `}
          If you need something back, open Restore at any time in the next 30 days.
          {skipped > 0 && ` ${skipped} ${skipped === 1 ? "item was" : "items were"} in use, so Sift left ${skipped === 1 ? "it" : "them"} alone.`}
        </span>
      </div>
      <div className="relative flex gap-3">
        <Button variant="ink" onClick={() => go("home")}>Back to home</Button>
        <Button variant="plain" onClick={() => go("restore")}>See what was removed</Button>
      </div>
    </div>
  );
}
