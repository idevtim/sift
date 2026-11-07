import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFindings, useSystemDrive } from "@/hooks/useFindings";
import { useHashRoute } from "@/hooks/useHashRoute";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { useScan } from "@/hooks/useScan";
import { fmtBig, fmtGB } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Category, Drive, DriveBreakdown } from "@/types/api";
import { CATEGORY_COLORS, kindLabel } from "./driveCopy";
import { Busy, Spinner } from "@/components/ui/Spinner";
import { toast } from "@/stores/toastStore";

interface Row {
  name: string;
  bytes: number;
  color: string;
  desc: string;
  /** Still being measured (spinner beside the description). */
  loading?: boolean;
}

const systemName = { macos: "macOS", windows: "Windows", linux: "System" } as const;

/** Rows for an external drive or SD card. Whatever the walk couldn't see
 * (unreadable or hidden system folders) is counted as Other. */
function externalRows(drive: Drive, b: DriveBreakdown, device: string): Row[] {
  const total = (c: Category) => b.categories.find((x) => x.category === c)?.sizeBytes ?? 0;
  const counted = b.categories.reduce((sum, c) => sum + c.sizeBytes, 0);
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const media =
    drive.kind === "sd" && b.photos + b.videos > 0
      ? `${plural(b.photos, "photo")} and ${plural(b.videos, "video")}`
      : "Photos, videos and music";
  return [
    { name: "Can be freed", bytes: total("freeable"), color: CATEGORY_COLORS.freeable, desc: `Copies of files that are also on your ${device}` },
    { name: "Photos & videos", bytes: total("media"), color: CATEGORY_COLORS.media, desc: media },
    { name: "Documents", bytes: total("documents"), color: CATEGORY_COLORS.documents, desc: "Documents, archives and design files" },
    { name: "Apps", bytes: total("apps"), color: CATEGORY_COLORS.apps, desc: "Apps and setup files" },
    {
      name: "Other",
      bytes: total("other") + Math.max(0, drive.usedBytes - counted),
      color: CATEGORY_COLORS.other,
      desc: "Small things that don't fit anywhere else",
    },
  ].filter((r) => r.bytes > 50e6);
}

export function DriveDetailView() {
  const { params, navigate, navigateTo } = useHashRoute();
  const { drives } = useSystemDrive();
  const { selectedBytes } = useFindings();
  const { data: summary } = useScan();
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const drive = drives.find((d) => d.id === params.get("id")) ?? drives[0];
  const eject = useMutation({
    mutationFn: (d: Drive) => api.ejectDrive(d.mountPoint),
    onSuccess: (_, d) => {
      void queryClient.invalidateQueries({ queryKey: ["drives"] });
      toast(`${d.name} is safe to unplug.`);
      navigateTo("drives");
    },
  });
  const isSystem = drive?.kind === "internal";
  const walkable = !!drive && !isSystem && !drive.protected;
  const { data: breakdown } = useQuery({ ...queries.driveBreakdown(drive?.mountPoint ?? ""), enabled: walkable });
  if (!drive) return null;

  const total = (c: Category) => summary?.categories.find((x) => x.category === c)?.sizeBytes ?? 0;
  const rows: Row[] =
    isSystem && summary
      ? [
          { name: "Can be freed", bytes: total("freeable"), color: CATEGORY_COLORS.freeable, desc: "Old installers, temporary files and other things you won't miss" },
          { name: "Apps", bytes: total("apps"), color: CATEGORY_COLORS.apps, desc: "Installed apps, including games and creative tools" },
          { name: "Photos & videos", bytes: total("media"), color: CATEGORY_COLORS.media, desc: "Your photos, movies and music" },
          { name: "Documents", bytes: total("documents"), color: CATEGORY_COLORS.documents, desc: "Files in Documents, Desktop and Downloads" },
          { name: systemName[platform], bytes: total("system"), color: CATEGORY_COLORS.system, desc: `Needed to run your ${deviceName(platform)}. Sift leaves this alone` },
          { name: "Other", bytes: total("other"), color: CATEGORY_COLORS.other, desc: "Settings, app data and everything else" },
        ].filter((r) => r.bytes > 50e6)
      : walkable && breakdown
        ? externalRows(drive, breakdown, deviceName(platform))
        : [
            {
              name: drive.protected ? "Backups" : "Files",
              bytes: drive.usedBytes,
              color: "var(--ink)",
              desc: drive.protected ? `Backups of this ${deviceName(platform)}` : "Sorting out what's on it…",
              loading: !drive.protected,
            },
          ];

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-[22px] overflow-auto px-[52px] py-8">
      <button
        type="button"
        onClick={() => {
          play("tap");
          navigate("drives");
        }}
        className="cursor-pointer self-start text-[15px] text-mut hover:text-ink"
      >
        ‹ Drives
      </button>
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-[40px] font-bold tracking-[-0.03em]">{drive.name}</span>
            <span className={cn("rounded-full px-2.5 py-1 text-[13px] font-semibold", drive.protected ? "bg-mint text-tealtx" : "bg-surface text-mut2")}>
              {kindLabel[drive.kind]}
            </span>
          </div>
          <span className="text-lg text-mut2">
            <span className="font-bold text-ink">{fmtBig(drive.capacityBytes - drive.usedBytes)} free</span> of{" "}
            {fmtBig(drive.capacityBytes)}
          </span>
        </div>
        <div className="flex gap-2.5">
          {!isSystem && (
            <button
              type="button"
              disabled={eject.isPending}
              onClick={() => eject.mutate(drive)}
              className="cursor-pointer rounded-full bg-surface px-5 py-3 text-[15px] font-semibold shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-panel"
            >
              {eject.isPending ? <Busy>Ejecting…</Busy> : "Eject"}
            </button>
          )}
          {isSystem && selectedBytes > 0 && (
            <button
              type="button"
              onClick={() => {
                play("tap");
                navigate("review");
              }}
              className="cursor-pointer rounded-full bg-teal px-[22px] py-3 text-[15px] font-semibold text-white transition-colors hover:bg-tealtx"
            >
              Free up {fmtGB(selectedBytes)}
            </button>
          )}
        </div>
      </div>

      <div className="flex h-7 gap-[3px] overflow-hidden rounded-[10px] bg-line">
        {rows.map((r) => (
          <div
            key={r.name}
            className="transition-[width] duration-800 ease-out-soft"
            style={{ width: `${((r.bytes / drive.capacityBytes) * 100).toFixed(2)}%`, background: r.color }}
          />
        ))}
      </div>

      {drive.protected && (
        <div className="rounded-2xl bg-mint px-5 py-4 text-[15px] leading-[1.45]">
          This is your backup drive. Sift never changes or removes anything on it.
        </div>
      )}
      {drive.kind === "sd" && (
        <div className="rounded-2xl bg-sand px-5 py-4 text-[15px] leading-[1.45]">
          Sift won't suggest removing photos from a camera card. Import them first, then clear the card.
        </div>
      )}
      {eject.error && (
        <div className="rounded-2xl bg-sand px-5 py-4 text-[15px] leading-[1.45]">{String(eject.error)}</div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3.5 rounded-[18px] bg-panel px-[18px] py-4">
            <div className="size-3.5 flex-none rounded-[5px]" style={{ background: r.color }} />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-base font-semibold">{r.name}</span>
              <span className="flex items-center gap-2 text-[13px] leading-[1.35] text-mut">
                {r.loading && <Spinner size={12} />}
                {r.desc}
              </span>
            </div>
            <span className="text-base font-semibold whitespace-nowrap">{fmtBig(r.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
