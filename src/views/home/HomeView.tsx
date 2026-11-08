import { Button } from "@/components/ui/Button";
import { IconTile } from "@/components/ui/IconTile";
import { UsageRing } from "@/components/ui/UsageRing";
import { useFindings, useSystemDrive } from "@/hooks/useFindings";
import { useFullAccess } from "@/hooks/useFullAccess";
import { useScan } from "@/hooks/useScan";
import { findingCopy } from "@/lib/findingCopy";
import { fmtGB, fmtSize } from "@/lib/format";
import { play } from "@/lib/sound";
import type { RouteId } from "@/routes";
import { usePrefs } from "@/stores/prefsStore";
import { useScanStore } from "@/stores/scanStore";
import { Spinner } from "@/components/ui/Spinner";

/** What Sift is doing right now, with live progress while it walks the disk. */
function Looking({ quick }: { quick: boolean }) {
  const { isFetching: scanning } = useScan();
  const progress = useScanStore((s) => s.progress);
  const pct =
    progress && progress.bytesExpected ? Math.min(0.97, progress.bytesChecked / progress.bytesExpected) : 0;
  const text = quick
    ? "Checking old installers, the Trash and caches…"
    : scanning
      ? `Looking through your files for duplicate photos and old videos · ${(progress?.filesChecked ?? 0).toLocaleString()} checked`
      : "Comparing photos to find exact copies…";
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] p-[18px] shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-3.5">
        <Spinner size={14} className="text-mut" />
        <span className="text-[13px] text-mut tabular-nums">{text}</span>
      </div>
      {!quick && scanning && (
        <div className="ml-7 h-1 overflow-hidden rounded-sm bg-line">
          <div className="h-full rounded-sm bg-teal transition-[width] duration-300" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomeView({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { findings, picks, selectedBytes, isLoading, indexLoading } = useFindings();
  // A rescan keeps the last results up while it walks, with live progress.
  const { isFetching: scanning } = useScan();
  const looking = isLoading || indexLoading || scanning;
  const hasItems = findings.length + picks.length > 0;
  const { system } = useSystemDrive();
  const limited = useFullAccess() === false;
  const weeklyCheck = usePrefs((s) => s.weeklyCheck);
  const review = () => {
    play("tap");
    onNavigate("review");
  };

  // Nothing back yet is not the same as nothing found.
  const headline = !hasItems
    ? looking
      ? "Taking a look around…"
      : `Your ${system?.name ?? "computer"} is in good shape`
    : selectedBytes === 0
      ? "Nothing selected yet"
      : `You can free up ${fmtGB(selectedBytes)} today`;

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-[30px] overflow-auto px-[52px] py-11">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="text-base text-mut">{greeting()}</span>
          <h1 className="max-w-[560px] text-[50px] leading-[1.05] font-bold tracking-[-0.03em]">{headline}</h1>
        </div>
        {system && (
          <UsageRing
            used={system.usedBytes / system.capacityBytes}
            freeable={selectedBytes / system.capacityBytes}
          />
        )}
      </div>

      {limited && (
        <div className="flex animate-[sift-in_.4s_ease_both] items-center justify-between gap-4 rounded-[18px] bg-sand py-3.5 pr-3.5 pl-5">
          <span className="text-[15px] leading-[1.4] font-semibold text-sandtx">
            Some private folders are hidden from Sift, so there may be more space to find.
          </span>
          <button
            type="button"
            onClick={() => {
              play("tap");
              usePrefs.getState().setOnboarding({ step: "access", mode: "permission" });
            }}
            className="flex-none cursor-pointer rounded-full bg-ink px-[18px] py-2.5 text-sm font-semibold whitespace-nowrap text-surface transition-transform active:scale-[.97]"
          >
            Allow full access
          </button>
        </div>
      )}

      {hasItems || looking ? (
        <>
          {hasItems && (
            <div className="flex items-center gap-3.5">
              <Button onClick={review}>Review and free up {fmtGB(selectedBytes)}</Button>
              <span className="text-sm text-mut">Nothing is removed until you confirm.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3.5">
            {findings.map((f) => {
              const copy = findingCopy[f.kind];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={review}
                  className="flex cursor-pointer items-center gap-3.5 rounded-[18px] bg-panel p-[18px] text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
                >
                  <IconTile icon={copy.icon} tone={f.safety} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-base font-semibold">{copy.name}</span>
                    <span className="text-[13px] text-mut">{copy.short(f)}</span>
                  </div>
                  <span className="text-base font-semibold">{fmtSize(f.sizeBytes)}</span>
                </button>
              );
            })}
            {picks.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={review}
                className="flex cursor-pointer items-center gap-3.5 rounded-[18px] bg-panel p-[18px] text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <IconTile icon={p.reason === "installer" ? "installer" : "temp"} tone="safe" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-base font-semibold">{p.name}</span>
                  <span className="text-[13px] text-mut">Added from Explore</span>
                </div>
                <span className="text-base font-semibold">{fmtSize(p.sizeBytes)}</span>
              </button>
            ))}
            {looking && <Looking quick={isLoading} />}
          </div>
        </>
      ) : (
        <div className="flex max-w-[560px] flex-col gap-1.5 rounded-[20px] bg-mint p-7">
          <span className="text-xl font-bold">Nothing left to clear</span>
          <span className="text-[15px] leading-[1.45] text-donetx">
            {weeklyCheck ? "Sift will check again on Sunday. " : ""}You can still look through Big files yourself.
          </span>
        </div>
      )}
    </div>
  );
}
