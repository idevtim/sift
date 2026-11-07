import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { findingCopy } from "@/lib/findingCopy";
import { fmtGB, fmtSize } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { RestoreEntry } from "@/types/api";
import { Busy } from "@/components/ui/Spinner";

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Old installers" for a Home category, else the label it was removed with. */
export const entryName = (e: RestoreEntry) => e.label ?? (e.kind ? findingCopy[e.kind].name : "Removed items");

function note(e: RestoreEntry) {
  if (e.kind === "trash") return `The ${findingCopy.trash.name} is emptied for good, so this one can't come back`;
  if (!e.restorable) return "Cleared right away. These get rebuilt when they're needed";
  const left = Math.max(1, Math.ceil(RETENTION_DAYS - (Date.now() - e.removedAtMs) / DAY_MS));
  return `Cleared automatically in ${left} ${left === 1 ? "day" : "days"}`;
}

/** Which "Clear now" is waiting for its confirming click: an entry id, or "all". */
type Confirming = string | null;

export function RestoreView() {
  const queryClient = useQueryClient();
  const { data: entries = [], isLoading } = useQuery(queries.restore);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["restore"] });
    void queryClient.invalidateQueries({ queryKey: ["findings"] });
    void queryClient.invalidateQueries({ queryKey: ["drives"] });
  };
  const restore = useMutation({ mutationFn: api.restoreEntry, onSettled: refresh });
  const clear = useMutation({
    mutationFn: (target: string) => api.clearRestore(target === "all" ? undefined : target),
    onSuccess: () => play("chime"),
    onSettled: () => {
      setConfirming(null);
      refresh();
    },
  });
  const hide = useMutation({ mutationFn: api.hideCleared, onSettled: refresh });
  const busy = restore.isPending || clear.isPending;
  const held = entries.filter((e) => e.restorable);
  // Records of what was deleted for good: where the space went, nothing to bring back.
  const cleared = entries.filter((e) => !e.restorable);
  const heldBytes = held.reduce((sum, e) => sum + e.sizeBytes, 0);
  const error = restore.error ?? clear.error;

  /** First click arms it, second click clears. */
  const clearClick = (target: string) => {
    play("tick");
    if (confirming === target) clear.mutate(target);
    else setConfirming(target);
  };

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-6 overflow-auto px-[52px] py-11">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-4xl font-bold tracking-[-0.02em]">Restore</h2>
          <span className="text-base text-mut">
            Most things Sift removes are kept here for 30 days, then cleared automatically.
          </span>
        </div>
        {held.length > 0 && (
          <ClearButton
            armed={confirming === "all"}
            disabled={busy}
            working={clear.isPending && clear.variables === "all"}
            onClick={() => clearClick("all")}
            onBlur={() => setConfirming(null)}
            label={`Clear all now · ${fmtGB(heldBytes)}`}
            armedLabel={`Clear ${fmtGB(heldBytes)} for good`}
          />
        )}
      </div>

      {!isLoading && held.length === 0 && (
        <div className="max-w-[520px] rounded-[20px] bg-panel p-7 text-base leading-[1.45] text-mut2">
          {cleared.length
            ? "Nothing to bring back right now. Things you remove will wait here for 30 days."
            : "Nothing here yet. Things you free up will show here so you can bring them back."}
        </div>
      )}

      {error && (
        <div className="self-start rounded-[14px] bg-sand px-[18px] py-3.5 text-[15px] font-semibold text-sandtx">
          Some things couldn't be finished yet. {String(error)}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {held.map((e) => {
          const restoring = restore.isPending && restore.variables === e.id;
          return (
            <div key={e.id} className="flex animate-[sift-in_.4s_ease_both] items-center gap-4 rounded-[18px] bg-panel px-[18px] py-4">
              <div className="flex flex-1 flex-col gap-[3px]">
                <span className="text-base font-semibold">{entryName(e)}</span>
                <span className="text-sm text-mut">
                  {confirming === e.id ? "Clearing removes these for good. They can't come back after this." : note(e)}
                </span>
              </div>
              <span className="text-base font-semibold">{fmtSize(e.sizeBytes)}</span>
              {e.restorable && (
                <ClearButton
                  armed={confirming === e.id}
                  disabled={busy}
                  working={clear.isPending && clear.variables === e.id}
                  onClick={() => clearClick(e.id)}
                  onBlur={() => setConfirming(null)}
                  label="Clear now"
                  armedLabel="Clear for good"
                />
              )}
              <button
                type="button"
                disabled={!e.restorable || busy}
                onClick={() => {
                  play("tap");
                  restore.mutate(e.id);
                }}
                className={cn(
                  "rounded-full px-4 py-[9px] text-sm font-semibold transition-transform active:scale-[.97]",
                  e.restorable ? "cursor-pointer bg-ink text-surface" : "bg-line text-mut",
                )}
              >
                {e.restorable ? (restoring ? <Busy>Restoring…</Busy> : "Restore") : e.kind === "trash" ? "Emptied" : "Cleared"}
              </button>
            </div>
          );
        })}
      </div>

      {cleared.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-[0.08em] text-mut3">CLEARED FOR GOOD</span>
            <button
              type="button"
              disabled={hide.isPending}
              onClick={() => {
                play("tap");
                hide.mutate();
              }}
              className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold text-mut2 hover:bg-panel"
            >
              {hide.isPending ? <Busy>Hiding…</Busy> : "Hide these"}
            </button>
          </div>
          {cleared.map((e) => (
            <div key={e.id} className="flex items-center gap-4 rounded-[14px] px-[18px] py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-mut2">{entryName(e)}</span>
                <span className="text-[13px] text-mut">{note(e)}</span>
              </div>
              <span className="text-sm font-semibold text-mut2">{fmtSize(e.sizeBytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClearButtonProps {
  armed: boolean;
  disabled: boolean;
  /** The clear is running. */
  working: boolean;
  onClick: () => void;
  onBlur: () => void;
  label: string;
  armedLabel: string;
}

/**
 * Two-step "Clear now". Outlined at rest; the first click arms it (teal —
 * this is space you get back), the second clears. Losing focus disarms.
 */
function ClearButton({ armed, disabled, working, onClick, onBlur, label, armedLabel }: ClearButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onBlur={onBlur}
      className={cn(
        "flex-none cursor-pointer rounded-full px-4 py-[9px] text-sm font-semibold whitespace-nowrap transition-[background-color,color,transform] duration-200 active:scale-[.97] disabled:cursor-default",
        armed
          ? "bg-teal text-white hover:bg-teal-hover"
          : "bg-surface shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-mint",
      )}
    >
      {working ? <Busy>Clearing…</Busy> : armed ? armedLabel : label}
    </button>
  );
}
