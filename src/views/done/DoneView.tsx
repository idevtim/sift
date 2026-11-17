import { Button } from "@/components/ui/Button";
import { CountingAmount } from "@/components/ui/CountingAmount";
import { useCountUp } from "@/hooks/useCountUp";
import { useSystemDrive } from "@/hooks/useFindings";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { fmtBig } from "@/lib/format";
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
        <span className="flex size-16 animate-check items-center justify-center rounded-full bg-sand text-[28px] font-bold text-sandtx">
          !
        </span>
        <span className="text-[34px] font-bold tracking-[-0.02em]">That didn't finish</span>
        <span className="max-w-[520px] text-base leading-[1.45] text-mut">
          Anything Sift already moved is safe in Restore. {error}
        </span>
        <div className="flex gap-3">
          <Button variant="ink" onClick={() => go("home")}>
            Back to home
          </Button>
          <Button variant="plain" onClick={() => go("restore")}>
            Open Restore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col items-center justify-center p-12 text-center">
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
      <div className="relative flex max-w-[680px] animate-rise flex-col items-center gap-7 rounded-[32px] bg-glass px-14 py-12 shadow-[var(--st-shadow)] ring-1 ring-[var(--st-edge)] ring-inset backdrop-blur-xl">
        <div className="relative">
          {!reduceMotion() && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-teal-2"
              style={{ animation: "sift-halo 1.6s ease-out .3s 3 both" }}
            />
          )}
          <span
            className="relative flex size-[96px] animate-check items-center justify-center rounded-full text-white shadow-[0_20px_44px_-14px_rgba(31,138,118,.7),inset_0_2px_0_rgba(255,255,255,.4)]"
            style={{
              background: "radial-gradient(circle at 35% 28%, #8ff0d6, #2fb59a 45%, #167a67)",
              animationDuration: ".8s",
            }}
          >
            <svg
              aria-hidden="true"
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </div>
        <div className="flex flex-col items-center gap-3">
          <span className="text-[13px] font-semibold tracking-[.06em] text-mut uppercase">All done</span>
          <span className="text-[56px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            You got <CountingAmount className="text-gain" bytes={count} to={freedBytes} /> back
          </span>
          <span className="max-w-[540px] text-[17px] leading-[1.5] text-pretty text-mut">
            {system && `Your ${device} now has ${fmtBig(system.capacityBytes - system.usedBytes)} free. `}
            If you need something back, open Restore at any time in the next 30 days.
            {skipped > 0 &&
              ` ${skipped} ${skipped === 1 ? "item was" : "items were"} in use, so Sift left ${skipped === 1 ? "it" : "them"} alone.`}
          </span>
        </div>
        <div className="relative flex gap-3">
          <Button variant="ink" onClick={() => go("home")}>
            Back to home
          </Button>
          <Button variant="plain" onClick={() => go("restore")}>
            See what was removed
          </Button>
        </div>
      </div>
    </div>
  );
}
