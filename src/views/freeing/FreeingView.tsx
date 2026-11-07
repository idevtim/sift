import { fmtGB } from "@/lib/format";
import { useFreeStore } from "@/stores/freeStore";

const grain = "absolute top-[70px] rounded-full animate-[sift-fall_1s_ease-in_infinite]";

export function FreeingView() {
  const { items, totalBytes, progress } = useFreeStore();
  // Which item the shown progress has reached, by cumulative size.
  let acc = 0;
  const current =
    items.find((f) => (acc += f.sizeBytes) >= progress * totalBytes) ?? items[items.length - 1];

  return (
    <div className="absolute inset-0 flex animate-[sift-in_.35s_ease_both] flex-col items-center justify-center gap-9">
      <div className="relative flex h-[120px] flex-col items-center gap-[9px]">
        <div className="h-4 w-[120px] animate-[sift-pulse_1.2s_ease-in-out_infinite] rounded-lg bg-teal" />
        <div className="h-4 w-[86px] animate-[sift-pulse_1.2s_ease-in-out_.15s_infinite] rounded-lg bg-teal-2" />
        <div className="h-4 w-12 animate-[sift-pulse_1.2s_ease-in-out_.3s_infinite] rounded-lg bg-teal-3" />
        <div className={`${grain} left-11 size-2 bg-teal`} />
        <div className={`${grain} left-[66px] size-1.5 bg-teal-2 [animation-delay:.4s]`} />
        <div className={`${grain} left-14 size-[5px] bg-ink [animation-delay:.7s]`} />
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <span className="text-[34px] font-bold tracking-[-0.02em]">Freeing up space…</span>
        {current && (
          <span className="text-base text-mut">
            Clearing {current.name.toLowerCase()}… {fmtGB(totalBytes * progress)} of{" "}
            {fmtGB(totalBytes)}
          </span>
        )}
      </div>
      <div className="h-2.5 w-[420px] overflow-hidden rounded-[5px] bg-line">
        <div className="h-full rounded-[5px] bg-teal" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}
