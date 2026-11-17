import { IconTile } from "@/components/ui/IconTile";
import { DriveRing } from "@/components/ui/DriveRing";
import { useSystemDrive } from "@/hooks/useFindings";
import { Spinner } from "@/components/ui/Spinner";
import { fmtGB, fmtSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFreeStore } from "@/stores/freeStore";

/** Review → "Free up space": the drive ring drains while each item ticks off in turn. */
export function FreeingView() {
  const { items, totalBytes, progress } = useFreeStore();
  const { system } = useSystemDrive();
  const capacity = system?.capacityBytes ?? 0;
  // Each item's state from where the shown progress has reached, by cumulative size.
  const reached = progress * totalBytes;
  let acc = 0;
  const rows = items.map((it) => {
    const before = acc;
    acc += it.sizeBytes;
    const status = progress >= 1 || reached >= acc - 1 ? "done" : reached >= before ? "active" : "pending";
    return { ...it, status };
  });
  const current = rows.find((r) => r.status === "active") ?? rows[rows.length - 1];

  return (
    <div className="absolute inset-0 flex animate-sift-in items-center justify-center gap-14 overflow-auto px-12">
      {capacity > 0 ? (
        <DriveRing
          size={260}
          mode="drive"
          used={system!.usedBytes / capacity}
          freeable={totalBytes / capacity}
          progress={progress}
          working={progress < 1}
          done={progress >= 1}
          capacityBytes={capacity}
          className="animate-rise"
        />
      ) : (
        <DriveRing size={260} mode="progress" progress={progress} working={progress < 1} className="animate-rise" />
      )}
      <div className="flex w-[420px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold tracking-[.06em] text-mut uppercase">Freeing up space…</span>
          <span className="text-[40px] leading-[1.05] font-extrabold tracking-[-0.03em] tabular-nums">
            {fmtGB(totalBytes * progress)} <span className="text-mut3">of {fmtGB(totalBytes)}</span>
          </span>
          {current && (
            <span className="text-[15px] text-mut">Clearing {current.name.toLowerCase()}. You can keep using your computer.</span>
          )}
        </div>
        <div className="stagger flex max-h-[300px] flex-col gap-1.5 overflow-auto">
          {rows.map((r, i) => (
            <div
              key={`${i}-${r.name}`}
              className={cn(
                "flex h-[52px] flex-none items-center gap-3 rounded-2xl bg-glass pr-3 pl-2 ring-1 ring-[var(--st-edge)] ring-inset transition-opacity duration-300",
                r.status === "pending" && "opacity-70",
              )}
            >
              <div className="scale-[.82]">
                <IconTile icon={r.icon} tone="safe" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{r.name}</span>
                <span className="truncate text-xs text-mut">
                  {r.held ? "Kept in Restore for 30 days" : "Deleted for good"}
                </span>
              </div>
              <span className="text-sm font-bold text-gain tabular-nums">{fmtSize(r.sizeBytes)}</span>
              <span className="flex size-6 flex-none items-center justify-center">
                {r.status === "done" ? (
                  <span className="animate-check flex size-6 items-center justify-center rounded-full bg-teal text-white">
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                ) : r.status === "active" ? (
                  <Spinner size={18} className="text-mut" />
                ) : (
                  <span className="size-2 rounded-full bg-current opacity-30" />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
