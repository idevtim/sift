import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Busy, Loading } from "@/components/ui/Spinner";
import { useFreePaths } from "@/hooks/useFreePaths";
import { useHashRoute } from "@/hooks/useHashRoute";
import { fmtSizeFine } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toastStore";
import type { DuplicateGroup } from "@/types/api";
import {
  diffNote,
  duration,
  extLabel,
  extraBytes,
  factsFor,
  fileName,
  KEEP_RULES,
  keeperOf,
  matches,
  PAGE_SIZE,
  pageTokens,
  plural,
  SORTS,
  TYPES,
  typeOf,
  type KeepRule,
  type SortKey,
  type TypeFilter,
} from "./dupes";
import { Preview } from "./Preview";

const outline = "rounded-full shadow-[inset_0_0_0_1px_var(--line2)] font-semibold cursor-pointer";

export function DuplicatesView() {
  const { data: groups = [], isLoading } = useQuery(queries.duplicates);
  const remove = useFreePaths();
  const queryClient = useQueryClient();
  const { navigate } = useHashRoute();

  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("savings");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [rule, setRule] = useState<KeepRule>("oldest");
  // Copies picked by hand (set hash → path) and sets kept whole.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  /** Bytes freed by the last removal; shows the done state. */
  const [done, setDone] = useState<number | null>(null);
  /** The set whose extras are being removed on their own, if any. */
  const [removingSet, setRemovingSet] = useState<string | null>(null);

  const keeper = (g: DuplicateGroup) => {
    const picked = g.copies.findIndex((c) => c.path === picks[g.hash]);
    return picked >= 0 ? picked : keeperOf(g, rule);
  };

  // Filtering, sorting and paging.
  const found = groups.filter((g) => matches(g, query));
  const list = found.filter((g) => type === "all" || typeOf(g) === type).sort(SORTS.find((s) => s.value === sort)!.compare);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const rows = list.slice(at * PAGE_SIZE, at * PAGE_SIZE + PAGE_SIZE);
  const sel = rows.find((g) => g.hash === selected) ?? list.find((g) => g.hash === selected) ?? rows[0] ?? null;

  const browse = (change: () => void) => {
    change();
    setPage(0);
    setSelected(null);
  };
  const goPage = (p: number) => {
    play("tap");
    setPage(p);
    setSelected(null);
  };

  // Totals: everything for the header, without kept-whole sets for the footer.
  const allBytes = groups.reduce((s, g) => s + extraBytes(g), 0);
  const included = groups.filter((g) => !skipped[g.hash]);
  const total = included.reduce((s, g) => s + extraBytes(g), 0);
  const extras = included.reduce((s, g) => s + g.copies.length - 1, 0);

  const removeExtras = () => {
    const paths = included.flatMap((g) => g.copies.filter((_, i) => i !== keeper(g)).map((c) => c.path));
    if (!paths.length) return;
    remove.mutate(
      { paths, label: `Extra copies (${plural(paths.length, "file", "files")})`, bytes: total },
      {
        onSuccess: () => {
          setDone(total);
          setPicks({});
        },
        onError: (e) => toast(`Couldn't remove the extra copies. ${String(e)}`, { tone: "problem" }),
      },
    );
  };

  /** Remove just this set's extras; the set leaves the list once the index forgets them. */
  const removeSet = (g: DuplicateGroup) => {
    const keep = keeper(g);
    const paths = g.copies.filter((_, i) => i !== keep).map((c) => c.path);
    if (!paths.length) return;
    const bytes = extraBytes(g);
    setRemovingSet(g.hash);
    remove.mutate(
      { paths, label: `Extra copies of ${g.name}`, bytes },
      {
        onSuccess: () => {
          // Drop the set now rather than waiting for the debounced refresh.
          queryClient.setQueryData<DuplicateGroup[]>(queries.duplicates.queryKey, (old) =>
            old?.filter((x) => x.hash !== g.hash),
          );
          setPicks(({ [g.hash]: _, ...rest }) => rest);
          setSelected(null);
          toast(`Removed ${plural(paths.length, "extra copy", "extra copies")} of ${g.name} · ${fmtSizeFine(bytes)} back`, {
            action: { label: "View in Restore", route: "restore" },
          });
        },
        onError: (e) => toast(`Couldn't remove the copies of ${g.name}. ${String(e)}`, { tone: "problem" }),
        onSettled: () => setRemovingSet(null),
      },
    );
  };

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col">
      <div className="flex items-end justify-between gap-5 px-8 pt-6 pb-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-[32px] font-bold tracking-[-0.02em]">Duplicates</h2>
          <div className="text-[15px] text-mut">
            {isLoading ? (
              <Loading>Comparing files to find exact copies…</Loading>
            ) : groups.length ? (
              <>
                {plural(groups.length, "set", "sets")} of identical files ·{" "}
                <span className="font-semibold text-ink">{fmtSizeFine(allBytes)}</span> in extra copies
              </>
            ) : (
              "No exact copies in your Desktop, Documents, Downloads, Pictures, Movies or Music."
            )}
          </div>
        </div>
        {groups.length > 0 && done === null && (
          <div className="flex flex-none flex-col items-end gap-1.5">
            <span className="text-[11px] font-bold tracking-[.08em] text-mut3">WHICH COPY TO KEEP</span>
            <Segmented
              options={KEEP_RULES}
              value={rule}
              onChange={(r) => {
                play("tap");
                setRule(r);
                setPicks({});
              }}
            />
          </div>
        )}
      </div>

      {done !== null ? (
        <div className="flex flex-1 animate-sift-in flex-col items-center justify-center gap-4 border-t border-line p-10 text-center">
          <div className="flex size-16 animate-[sift-pop_.45s_cubic-bezier(.2,.9,.3,1.3)_both] items-center justify-center rounded-full bg-teal text-[28px] font-bold text-white">
            ✓
          </div>
          <span className="text-[34px] font-extrabold tracking-[-0.03em]">You got {fmtSizeFine(done)} back</span>
          <span className="max-w-[460px] text-base leading-normal text-pretty text-mut">
            One copy of every file is kept. The extras wait in Restore for 30 days in case you need them.
          </span>
          <div className="mt-1.5 flex gap-2.5">
            <Button
              variant="ink"
              className="px-[22px] py-[13px] text-[15px]"
              onClick={() => {
                play("tap");
                navigate("restore");
              }}
            >
              Open Restore
            </Button>
            <button
              type="button"
              className={cn(outline, "px-[22px] py-[13px] text-[15px]")}
              onClick={() => {
                setDone(null);
                setPage(0);
                setSelected(null);
              }}
            >
              Back to duplicates
            </button>
          </div>
        </div>
      ) : (
        groups.length > 0 && (
          <>
            <div className="flex min-h-0 flex-1 border-t border-line">
              <div className="box-border flex min-h-0 w-[340px] flex-none flex-col gap-2.5 border-r border-line px-4 py-3.5">
                <label className="flex h-10 flex-none items-center gap-2.5 rounded-xl bg-panel px-3 shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="text-base text-mut">⌕</span>
                  <input
                    value={query}
                    onChange={(e) => browse(() => setQuery(e.target.value))}
                    placeholder="Search by name or folder"
                    className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-mut3"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => browse(() => setQuery(""))}
                      className="flex size-5 flex-none cursor-pointer items-center justify-center rounded-full bg-line2 text-[11px] text-mut2"
                    >
                      ✕
                    </button>
                  )}
                </label>

                <div className="flex flex-none flex-wrap gap-1.5">
                  {TYPES.map((t) => {
                    const on = type === t.value;
                    const count = t.value === "all" ? found.length : found.filter((g) => typeOf(g) === t.value).length;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => {
                          play("tick");
                          browse(() => setType(t.value));
                        }}
                        className={cn(
                          "flex cursor-pointer gap-[5px] rounded-full px-2.5 py-[5px] text-[13px] font-semibold whitespace-nowrap transition-colors duration-200",
                          on ? "bg-ink text-surface" : "text-mut2 shadow-[inset_0_0_0_1px_var(--line2)]",
                        )}
                      >
                        <span>{t.label}</span>
                        <span className="tabular-nums opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-none items-center justify-between text-[13px] text-mut">
                  <span>{plural(list.length, "set", "sets")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      play("tick");
                      const i = SORTS.findIndex((s) => s.value === sort);
                      browse(() => setSort(SORTS[(i + 1) % SORTS.length].value));
                    }}
                    className="cursor-pointer font-semibold text-mut2 hover:text-ink"
                  >
                    Sort: {SORTS.find((s) => s.value === sort)!.label} ⇅
                  </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-auto">
                  {rows.map((g) => {
                    const skip = !!skipped[g.hash];
                    return (
                      <button
                        key={g.hash}
                        type="button"
                        onClick={() => {
                          play("tick");
                          setSelected(g.hash);
                        }}
                        className={cn(
                          "flex flex-none animate-[sift-in_.3s_ease_both] cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-[7px] text-left transition-colors duration-150",
                          g === sel ? "bg-panel" : "hover:bg-hover",
                        )}
                      >
                        <div className="relative flex-none">
                          <Preview group={g} className="size-10 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)]" />
                          <span className="absolute -right-[5px] -bottom-[5px] flex h-[18px] items-center rounded-[9px] bg-ink px-[5px] text-[10px] font-bold text-surface shadow-[0_0_0_2px_var(--surface)]">
                            ×{g.copies.length}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold">{g.name}</span>
                          <span className={cn("truncate text-xs", skip ? "text-sandtx" : "text-mut")}>
                            {skip ? "Keeping all copies" : `${g.copies.length} copies · ${fmtSizeFine(g.sizeBytes)} each`}
                          </span>
                        </div>
                        <span className={cn("text-[13px] font-semibold whitespace-nowrap tabular-nums", skip && "text-mut3")}>
                          {skip ? "—" : fmtSizeFine(extraBytes(g))}
                        </span>
                      </button>
                    );
                  })}
                  {!list.length && (
                    <div className="flex flex-col items-center gap-2.5 px-3 py-7 text-center">
                      <span className="text-[15px] font-semibold">No duplicates match</span>
                      <span className="text-[13px] text-mut">Try another name or folder, or clear the filters.</span>
                      <button
                        type="button"
                        className={cn(outline, "px-3.5 py-2 text-[13px]")}
                        onClick={() =>
                          browse(() => {
                            setQuery("");
                            setType("all");
                          })
                        }
                      >
                        Clear search
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-none items-center justify-between pt-0.5">
                  <span className="text-xs text-mut tabular-nums">
                    {list.length
                      ? `${at * PAGE_SIZE + 1}–${Math.min(list.length, (at + 1) * PAGE_SIZE)} of ${list.length.toLocaleString()}`
                      : "0 of 0"}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <PageArrow disabled={at === 0} onClick={() => goPage(at - 1)} label="Previous page">
                      ‹
                    </PageArrow>
                    {pageTokens(at, pages).map((p, i) =>
                      p === "gap" ? (
                        <span key={`gap${i}`} className="flex h-7 min-w-7 items-center justify-center text-[13px] font-semibold text-mut3">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => p !== at && goPage(p)}
                          className={cn(
                            "box-border flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg px-1.5 text-[13px] font-semibold tabular-nums transition-colors duration-150",
                            p === at ? "bg-ink text-surface" : "text-mut2 hover:bg-hover",
                          )}
                        >
                          {p + 1}
                        </button>
                      ),
                    )}
                    <PageArrow disabled={at >= pages - 1} onClick={() => goPage(at + 1)} label="Next page">
                      ›
                    </PageArrow>
                  </div>
                </div>
              </div>

              <div className="box-border min-w-0 flex-1 overflow-auto px-[26px] pt-5 pb-[22px]">
                {sel && (
                  <SetDetail
                    key={sel.hash}
                    group={sel}
                    keep={keeper(sel)}
                    skip={!!skipped[sel.hash]}
                    removing={removingSet === sel.hash}
                    busy={remove.isPending}
                    onRemove={() => removeSet(sel)}
                    onKeep={(path) => {
                      play("tick");
                      setPicks((p) => ({ ...p, [sel.hash]: path }));
                    }}
                    onToggleSkip={() => {
                      play("tap");
                      setSkipped((s) => ({ ...s, [sel.hash]: !s[sel.hash] }));
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-5 border-t border-line px-8 py-3.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-mut">
                  Removing {plural(extras, "extra copy", "extra copies")} from {plural(included.length, "set", "sets")}
                </span>
                <span className="text-2xl font-bold tracking-[-0.02em] tabular-nums">{fmtSizeFine(total)}</span>
              </div>
              <div className="flex items-center gap-3.5">
                <span className="text-[13px] text-mut">Extras wait in Restore for 30 days.</span>
                <Button className="px-6 py-3.5 text-base" disabled={!total || remove.isPending} onClick={removeExtras}>
                  {remove.isPending && !removingSet ? <Busy>Removing…</Busy> : "Remove all extra copies"}
                </Button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

function PageArrow({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-[17px] text-mut2 hover:bg-hover disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function SetDetail({
  group: g,
  keep,
  skip,
  removing,
  busy,
  onKeep,
  onToggleSkip,
  onRemove,
}: {
  group: DuplicateGroup;
  keep: number;
  skip: boolean;
  /** This set's extras are being removed right now. */
  removing: boolean;
  /** Any removal is running (this set's or all of them). */
  busy: boolean;
  onKeep: (path: string) => void;
  onToggleSkip: () => void;
  onRemove: () => void;
}) {
  const { data: facts } = useQuery(queries.duplicateFacts(g.hash));
  const names = g.copies.map(fileName);
  const nameVaries = new Set(names).size > 1;
  const length = g.kind === "video" && facts?.durationSecs ? duration(facts.durationSecs) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[22px] font-bold tracking-[-0.01em]">{g.name}</span>
          <span className="text-sm text-mut">
            {g.copies.length} identical copies · {skip ? "keeping all of them" : `${fmtSizeFine(extraBytes(g))} can be freed`}
          </span>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={onToggleSkip}
            disabled={busy}
            className={cn(outline, "px-3.5 py-[9px] text-[13px] whitespace-nowrap hover:bg-hover disabled:cursor-default disabled:opacity-50")}
          >
            {skip ? "Remove extras instead" : "Keep all copies"}
          </button>
          {!skip && (
            <Button className="px-3.5 py-[9px] text-[13px] whitespace-nowrap" disabled={busy} onClick={onRemove}>
              {removing ? (
                <Busy>Removing…</Busy>
              ) : (
                `Remove ${g.copies.length - 1 === 1 ? "extra copy" : `${g.copies.length - 1} extras`}`
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl bg-mint px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-teal text-xs font-extrabold text-white">=</span>
          <span className="text-[15px] font-bold text-tealtx">These are the same file</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {factsFor(g, facts).map(([label, value]) => (
            <span key={label} className="flex items-center gap-1.5 rounded-[10px] bg-surface px-2.5 py-1.5 text-[13px]">
              <span className="font-bold text-teal">✓</span>
              <span className="text-mut">{label}</span>
              <span className="font-semibold">{value}</span>
            </span>
          ))}
        </div>
        <span className="text-[13px] leading-[1.4] text-tealtx">{diffNote(g)}</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {g.copies.map((c, i) => {
          const kept = skip || i === keep;
          const unique = nameVaries && names.filter((n) => n === names[i]).length === 1;
          return (
            <button
              key={c.path}
              type="button"
              title={c.path}
              onClick={() => !kept && onKeep(c.path)}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl bg-panel text-left transition-[box-shadow,transform] duration-[250ms] hover:-translate-y-0.5",
                kept ? "cursor-default shadow-[inset_0_0_0_2px_#1F8A76]" : "cursor-pointer shadow-[inset_0_0_0_1px_var(--line)]",
              )}
            >
              <Preview
                group={g}
                big
                className={cn(
                  "h-[148px] transition-[opacity,filter] duration-300",
                  kept ? "opacity-100" : "opacity-50 grayscale-[.6]",
                )}
              >
                <span className="absolute bottom-2.5 left-2.5 rounded-md bg-[rgba(20,22,25,.62)] px-[7px] py-[3px] text-[11px] font-bold tracking-[.04em] text-white">
                  {extLabel(g)}
                </span>
                {length && (
                  <span className="absolute right-2.5 bottom-2.5 rounded-md bg-[rgba(20,22,25,.62)] px-[7px] py-[3px] text-[11px] font-bold text-white tabular-nums">
                    {length}
                  </span>
                )}
              </Preview>
              <span
                className={cn(
                  "absolute top-2.5 left-2.5 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,.18)] transition-colors duration-[250ms]",
                  kept ? "bg-teal" : "bg-[rgba(20,22,25,.7)]",
                )}
              >
                {kept ? "Keep" : "Remove"}
              </span>
              <div className="flex min-w-0 flex-col gap-1 px-3.5 pt-[11px] pb-[13px]">
                <span className="truncate text-sm font-semibold">
                  <span className={cn("-mx-[3px] rounded px-[3px]", unique && "bg-sand text-sandtx")}>{names[i]}</span>
                </span>
                <span className="truncate text-[13px] text-mut2">{c.location}</span>
                <span className="text-xs text-mut3">Modified {ago(c.modifiedMs)}</span>
              </div>
            </button>
          );
        })}
      </div>
      <span className="text-[13px] text-mut">
        {skip
          ? "You're keeping every copy of this file."
          : "Tap a copy to keep that one instead. The others will be removed, and wait in Restore for 30 days."}
      </span>
    </div>
  );
}
