import { Button } from "@/components/ui/Button";
import { IconTile } from "@/components/ui/IconTile";
import type { IconName } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { Toggle } from "@/components/ui/Toggle";
import { useFindings } from "@/hooks/useFindings";
import { useFreeUp } from "@/hooks/useFreeUp";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { findingCopy } from "@/lib/findingCopy";
import { fmtGB, fmtSize } from "@/lib/format";
import { reasonDesc } from "@/lib/reasonCopy";
import { play } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { RouteId } from "@/routes";
import { useFindingView } from "@/stores/findingStore";
import { usePicks } from "@/stores/pickStore";

export function ReviewView({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { findings, picks, selected, selectedPicks, selectedBytes, isSelected, toggle } = useFindings();
  const flip = usePicks((s) => s.flip);
  const freeUp = useFreeUp(onNavigate);
  const device = deviceName(usePlatform());

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col">
      <div className="flex items-end justify-between gap-6 px-[52px] pt-[30px] pb-[18px]">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              play("tap");
              onNavigate("home");
            }}
            className="cursor-pointer self-start text-[15px] text-mut hover:text-ink"
          >
            ‹ Home
          </button>
          <h2 className="text-4xl font-bold tracking-[-0.02em]">Here's what Sift found</h2>
        </div>
        <span className="text-[15px] text-mut">Tap any item to include or skip it.</span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-auto px-[52px]">
        {findings.map((f) => {
          const copy = findingCopy[f.kind];
          return (
            <ReviewRow
              key={f.id}
              icon={copy.icon}
              safe={f.safety === "safe"}
              name={copy.name}
              why={copy.why(f)}
              sizeBytes={f.sizeBytes}
              on={isSelected(f)}
              onToggle={() => toggle(f)}
              look={{
                label: "See all",
                onClick: () => {
                  useFindingView.getState().show(f.kind);
                  onNavigate("finding");
                },
              }}
            />
          );
        })}
        {picks.map((p) => (
          <ReviewRow
            key={p.path}
            icon={p.reason === "installer" ? "installer" : p.reason === "trash" ? "trash" : "temp"}
            safe
            name={p.name}
            why={`Added from Explore. ${p.reason ? reasonDesc(p.reason, device) : ""}`}
            sizeBytes={p.sizeBytes}
            on={p.on}
            onToggle={() => flip(p.path)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-line px-[52px] py-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-mut">You'll free up</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{fmtGB(selectedBytes)}</span>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="text-sm text-mut">You can restore most things for 30 days.</span>
          <Button disabled={selectedBytes === 0} onClick={() => void freeUp(selected, selectedPicks)}>
            Free up space
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ReviewRowProps {
  icon: IconName;
  safe: boolean;
  name: string;
  why: string;
  sizeBytes: number;
  on: boolean;
  onToggle: () => void;
  look?: { label: string; onClick: () => void };
}

/** The whole row toggles (a stretched switch underneath); "See all" sits above it. */
function ReviewRow({ icon, safe, name, why, sizeBytes, on, onToggle, look }: ReviewRowProps) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-4 rounded-[18px] px-[18px] py-[13px] transition-colors duration-250 hover:bg-hover",
        on ? "bg-panel" : "bg-surface",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        onClick={() => {
          play("tick");
          onToggle();
        }}
        className="absolute inset-0 cursor-pointer rounded-[18px]"
      />
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-4">
        <IconTile icon={icon} tone={safe ? "safe" : "review"} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <span className="truncate text-[17px] font-semibold">{name}</span>
            <Pill tone={safe ? "safe" : "review"}>{safe ? "Safe to remove" : "Take a look"}</Pill>
          </div>
          <span className="text-sm text-pretty text-mut">{why}</span>
        </div>
      </div>
      {look && (
        <button
          type="button"
          onClick={() => {
            play("tap");
            look.onClick();
          }}
          className={cn(
            "relative cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold",
            safe ? "text-tealtx hover:bg-mint" : "text-sandtx hover:bg-sand",
          )}
        >
          {look.label} ›
        </button>
      )}
      <span className="pointer-events-none w-20 text-right text-[17px] font-semibold">{fmtSize(sizeBytes)}</span>
      <div className="pointer-events-none">
        <Toggle on={on} />
      </div>
    </div>
  );
}
