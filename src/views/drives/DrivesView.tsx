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
      <div className="grid grid-cols-2 gap-3.5">
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
              className="flex animate-[sift-in_.4s_ease_both] cursor-pointer items-center gap-5 rounded-[22px] bg-panel p-[22px] text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-12px_rgba(34,38,43,.35)]"
            >
              <div
                className="flex size-[88px] flex-none items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(#1F8A76 0 ${tealPct.toFixed(2)}%, var(--ink) 0 ${usedPct.toFixed(2)}%, var(--line3) 0)`,
                }}
              >
                <div className="flex size-[66px] items-center justify-center rounded-full bg-panel text-[17px] font-bold">
                  {Math.round(usedPct)}%
                </div>
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
