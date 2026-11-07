import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconTile } from "@/components/ui/IconTile";
import { useFindings } from "@/hooks/useFindings";
import { useFreePaths } from "@/hooks/useFreePaths";
import { fileManagerName, usePlatform } from "@/hooks/usePlatform";
import { findingCopy } from "@/lib/findingCopy";
import { fmtSize } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { RouteId } from "@/routes";
import { useFindingView } from "@/stores/findingStore";
import { toast } from "@/stores/toastStore";
import type { FindingItem } from "@/types/api";
import { Busy, Loading } from "@/components/ui/Spinner";

/** A set of paths held in state, with add/remove that re-render. */
function usePathSet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  return {
    has: (p: string) => set.has(p),
    add: (p: string) => setSet((s) => new Set(s).add(p)),
    remove: (p: string) =>
      setSet((s) => {
        const next = new Set(s);
        next.delete(p);
        return next;
      }),
  };
}

/** Long categories (temporary files) render this many until asked for more. */
const FIRST_PAGE = 150;

/**
 * Review → "See all": every file and folder behind one Home category,
 * biggest first. Each can be shown in the file manager or removed on its
 * own — held in Restore, or deleted for good for the Trash and caches.
 */
export function FindingView({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const kind = useFindingView((s) => s.kind) ?? "oldInstallers";
  const copy = findingCopy[kind];
  const finding = useFindings().findings.find((f) => f.kind === kind);
  const { data: items = [], isLoading } = useQuery(queries.findingItems(kind));
  const remove = useFreePaths();
  const platform = usePlatform();
  // A removal shows a spinner on its row, then the row folds away and stays
  // hidden while the list refetches with fresh sizes.
  const working = usePathSet();
  const leaving = usePathSet();
  const gone = usePathSet();
  const [all, setAll] = useState(false);

  const shown = items.filter((i) => !gone.has(i.path));

  const total = shown.reduce((s, i) => s + i.sizeBytes, 0);
  const visible = all ? shown : shown.slice(0, FIRST_PAGE);

  const removeItem = (item: FindingItem) => {
    play("tap");
    working.add(item.path);
    remove.mutate(
      { paths: [item.path], label: item.name, bytes: item.sizeBytes, restorable: item.held },
      {
        onSuccess: () => {
          working.remove(item.path);
          leaving.add(item.path);
          setTimeout(() => {
            gone.add(item.path);
            leaving.remove(item.path);
          }, 380);
          toast(
            item.held ? `${item.name} is in Restore for 30 days.` : `${item.name} was deleted for good.`,
            item.held ? { action: { label: "View", route: "restore" } } : {},
          );
        },
        onError: (e) => {
          working.remove(item.path);
          toast(`Couldn't remove ${item.name}. ${String(e)}`, { tone: "problem" });
        },
      },
    );
  };

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-5 overflow-auto px-[52px] py-[30px]">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            play("tap");
            onNavigate("review");
          }}
          className="cursor-pointer self-start text-[15px] text-mut hover:text-ink"
        >
          ‹ Review
        </button>
        <div className="flex items-center gap-4">
          <IconTile icon={copy.icon} tone={finding?.safety === "review" ? "review" : "safe"} />
          <div className="flex flex-col gap-1">
            <h2 className="text-4xl font-bold tracking-[-0.02em]">{copy.name}</h2>
            <span className="text-base text-mut">
              {isLoading ? (
                <Loading className="text-base">Looking…</Loading>
              ) : (
                `${shown.length.toLocaleString()} ${shown.length === 1 ? "item" : "items"} · ${fmtSize(total)}`
              )}
            </span>
          </div>
        </div>
      </div>

      {!isLoading && shown.length === 0 && (
        <div className="max-w-[560px] rounded-[20px] bg-panel p-7 text-base leading-[1.45] text-mut2">
          {kind === "trash" && platform === "windows"
            ? "Sift can't list the Recycle Bin item by item. Open it from the desktop to look through it."
            : "Nothing left here."}
        </div>
      )}

      <div className="flex flex-col">
        {visible.map((item) => (
          // Grid rows fold the height to 0 once removed; spacing lives inside.
          <div
            key={item.path}
            className={cn(
              "grid transition-[grid-template-rows,opacity,transform] duration-350 ease-out-soft",
              leaving.has(item.path) ? "grid-rows-[0fr] scale-[.98] opacity-0" : "grid-rows-[1fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pb-2">
                <div className="flex items-center gap-4 rounded-[18px] bg-panel px-[18px] py-3.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-base font-semibold">{item.name}</span>
                    <span className="truncate text-[13px] text-mut">{item.location}</span>
                  </div>
                  <span className="w-20 flex-none text-right text-base font-semibold">{fmtSize(item.sizeBytes)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      play("tap");
                      void api.revealPath(item.path);
                    }}
                    className="flex-none cursor-pointer rounded-full px-3.5 py-[9px] text-sm font-semibold text-mut2 transition-colors hover:bg-surface"
                  >
                    Show in {fileManagerName(platform)}
                  </button>
                  <button
                    type="button"
                    disabled={working.has(item.path) || leaving.has(item.path)}
                    onClick={() => removeItem(item)}
                    className="flex-none cursor-pointer rounded-full bg-surface px-4 py-[9px] text-sm font-semibold shadow-[inset_0_0_0_1px_var(--line2)] transition-colors duration-200 hover:bg-mint active:scale-[.97] disabled:cursor-default disabled:hover:bg-surface"
                  >
                    {working.has(item.path) ? (
                      <Busy>{item.held ? "Removing…" : "Deleting…"}</Busy>
                    ) : item.held ? (
                      "Remove"
                    ) : (
                      "Delete for good"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {!all && shown.length > FIRST_PAGE && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="cursor-pointer self-start rounded-full px-4 py-2.5 text-sm font-semibold text-mut2 hover:bg-panel"
          >
            Show {(shown.length - FIRST_PAGE).toLocaleString()} more
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <span className="text-sm text-mut">
          {shown.every((i) => i.held)
            ? "Removed items wait in Restore for 30 days."
            : shown.some((i) => i.held)
              ? "Most removed items wait in Restore for 30 days. Caches are deleted for good, since apps rebuild them."
              : `These are deleted for good, not kept in Restore.`}
        </span>
      )}
    </div>
  );
}
