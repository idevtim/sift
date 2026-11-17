import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { useFindings, useSystemDrive } from "@/hooks/useFindings";
import { useHashRoute } from "@/hooks/useHashRoute";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { fmtBig, fmtGB } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import type { DriveBreakdown } from "@/types/api";
import { driveHint, kindLabel } from "./driveCopy";

export function DrivesView() {
  const { drives } = useSystemDrive();
  const { findings } = useFindings();
  const { navigateTo } = useHashRoute();
  const freeable = findings.reduce((s, f) => s + f.sizeBytes, 0);
  const device = deviceName(usePlatform());
  const queryClient = useQueryClient();
  /** From a breakdown already fetched by opening the drive; never starts a walk. */
  const copiesOn = (mountPoint: string) =>
    queryClient
      .getQueryData<DriveBreakdown>(queries.driveBreakdown(mountPoint).queryKey)
      ?.categories.find((c) => c.category === "freeable")?.sizeBytes;

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-6 overflow-auto px-[52px] py-11">
      <PageHeader title="Drives">
        {drives.length === 1
          ? "Just this computer right now. Plug in a drive and it will appear here."
          : `${drives.length} drives connected. Tap one to see what's on it.`}
      </PageHeader>
      <div className="stagger grid grid-cols-2 gap-3.5">
        {drives.map((d) => {
          const usedPct = (d.usedBytes / d.capacityBytes) * 100;
          const tealPct = d.kind === "internal" ? (freeable / d.capacityBytes) * 100 : 0;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                play("tap");
                navigateTo("drive", { id: d.id });
              }}
              className="flex cursor-pointer items-center gap-5 rounded-[22px] bg-glass ring-1 ring-inset ring-[var(--st-edge)] p-[22px] text-left transition-[transform,box-shadow] duration-500 ease-spring hover:-translate-y-1 hover:shadow-[0_10px_24px_-12px_rgba(34,38,43,.35)]"
            >
              <div
                className="relative flex size-[88px] flex-none items-center justify-center"
              >
                {/* A true ring (masked), so the glass card shows through the middle. */}
                <div
                  className="absolute inset-0 animate-sift-sweep rounded-full"
                  style={{
                    background: `conic-gradient(#1F8A76 0 calc(var(--sw) * ${tealPct.toFixed(2)}%), var(--ink) 0 calc(var(--sw) * ${usedPct.toFixed(2)}%), var(--line3) 0)`,
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 11px), #000 calc(100% - 10px))",
                  }}
                />
                <span className="relative text-[17px] font-bold">{Math.round(usedPct)}%</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold">{d.name}</span>
                  <Pill tone={d.protected ? "safe" : "neutral"}>{kindLabel[d.kind]}</Pill>
                </div>
                <span className="text-[15px] font-medium">
                  {fmtBig(d.capacityBytes - d.usedBytes)} free of {fmtBig(d.capacityBytes)}
                </span>
                <span className="text-sm leading-[1.4] text-mut">{driveHint(d, freeable, fmtGB, device, copiesOn(d.mountPoint))}</span>
              </div>
              <span className="text-[22px] text-mut3">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
