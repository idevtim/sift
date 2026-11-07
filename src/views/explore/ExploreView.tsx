import { useLayoutEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fileManagerName, deviceName, usePlatform } from "@/hooks/usePlatform";
import { fmtGB, tildify } from "@/lib/format";
import { queries } from "@/lib/queries";
import { isFreeable, reasonDesc } from "@/lib/reasonCopy";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/exploreStore";
import { usePicks } from "@/stores/pickStore";
import { useFindings } from "@/hooks/useFindings";
import type { ExploreNode, FindingKind, Reason } from "@/types/api";
import { layout } from "./treemap";
import { Loading } from "@/components/ui/Spinner";

/** Reasons a Home category already covers — picking them would count twice. */
const COVERED_BY: Partial<Record<Reason, FindingKind>> = {
  cache: "tempFiles",
  trash: "trash",
  installer: "oldInstallers",
};

const FOLDER_SHADES = ["#262A30", "#30353B", "#3F444A", "#4E535A", "#5D6269"];
const FILE_SHADES = ["#3A3F45", "#4B5057", "#565B62", "#62676E", "#6E737A"];
/** Space between tiles, px (half on each side of every tile). */
const GAP = 4;
/** Name + size need this much room (px); name alone needs less. */
const FULL_LABEL = { w: 96, h: 64 };
const NAME_ONLY = { w: 64, h: 40 };
/** The "· 12 GB can go" note only shows on tiles at least this wide. */
const NOTE_MIN_W = 220;

/** Live pixel size of an element. A callback ref, so it starts measuring
 * whenever the element appears (the map isn't there while loading). */
function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function tileColor(n: ExploreNode, k: number) {
  if (n.reason === "system") return { bg: "var(--stone)", fg: "var(--ink)" };
  if (isFreeable(n.reason)) return { bg: "#1F8A76", fg: "#FFFFFF" };
  return { bg: (n.hasChildren ? FOLDER_SHADES : FILE_SHADES)[k % 5], fg: "#FFFFFF" };
}

export function ExploreView() {
  const { crumbs, selected, open, select } = useExplore();
  const { data } = useQuery({ ...queries.explore(crumbs), placeholderData: keepPreviousData });
  const platform = usePlatform();
  const { picks, toggle } = usePicks();
  const { findings } = useFindings();
  const [mapRef, map] = useSize<HTMLDivElement>();
  if (!data) {
    return (
      <div className="absolute inset-0 flex animate-sift-in items-center justify-center">
        <Loading>Looking around…</Loading>
      </div>
    );
  }

  const children = data.children.filter((c) => c.sizeBytes > 0);
  const tiles = layout(children, (c) => c.sizeBytes);
  const sel = children.find((c) => c.name === selected) ?? null;
  const node = data.node;

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-[18px] px-10 py-[30px]">
      <div className="flex flex-col gap-2">
        {data.crumbs.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {data.crumbs.map((c, d) => {
              const last = d === data.crumbs.length - 1;
              return (
                <span key={d} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => open(crumbs.slice(0, d))}
                    className={cn("cursor-pointer hover:text-teal", last ? "font-semibold text-ink" : "text-mut")}
                  >
                    {c}
                  </button>
                  {!last && <span className="text-stone2">/</span>}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-baseline justify-between gap-5">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="truncate text-[32px] font-bold tracking-[-0.02em]">{node.name}</span>
            <span className="flex-none text-xl font-medium text-mut3">{fmtGB(node.sizeBytes)}</span>
          </div>
          <div className="flex flex-none gap-4 text-[13px] text-mut">
            <Legend color="#1F8A76">Can be freed</Legend>
            <Legend color="#3F444A">Folder</Legend>
            <Legend color="var(--stone)">Leave alone</Legend>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Bleeds GAP/2 past its box so the outer tile edges line up with
            the header and the detail panel. */}
        <div ref={mapRef} className="relative -m-0.5 min-w-0 flex-1">
          {tiles.map(({ item: n, x, y, w, h }, k) => {
            const { bg, fg } = tileColor(n, k);
            // Tile size in px, inside its half-gap on each side.
            const pw = (w / 100) * map.w - GAP;
            const ph = (h / 100) * map.h - GAP;
            if (pw < 1 || ph < 1) return null;
            const full = pw >= FULL_LABEL.w && ph >= FULL_LABEL.h;
            const nameOnly = !full && pw >= NAME_ONLY.w && ph >= NAME_ONLY.h;
            const roomy = full && pw >= NOTE_MIN_W;
            const more = n.hasChildren ? (roomy && n.freeBytes > 50e6 ? ` · ${fmtGB(n.freeBytes)} can go` : " ›") : "";
            // Small tiles keep square-ish corners instead of turning into pills.
            const radius = Math.min(12, Math.min(pw, ph) / 4);
            return (
              <div
                key={n.name}
                className="absolute box-border animate-sift-in"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${w}%`,
                  height: `${h}%`,
                  padding: GAP / 2,
                  animationDelay: `${Math.min(k, 20) * 0.03}s`,
                }}
              >
                <button
                  type="button"
                  title={full ? undefined : n.name}
                  onClick={() => {
                    play("tap");
                    if (n.hasChildren) open([...crumbs, n.name]);
                    else select(n.name);
                  }}
                  className={cn(
                    "box-border flex size-full min-h-0 min-w-0 cursor-pointer flex-col justify-between overflow-hidden text-left transition-[filter] duration-200 hover:brightness-115",
                    (full || nameOnly) && "px-3.5 py-3",
                  )}
                  style={{
                    background: bg,
                    color: fg,
                    borderRadius: radius,
                    boxShadow: selected === n.name ? "inset 0 0 0 3px #BFE6DC" : "none",
                  }}
                >
                  {(full || nameOnly) && <span className="truncate text-[15px] font-semibold">{n.name}</span>}
                  {full && (
                    <span className="truncate text-[13px] opacity-90">
                      {fmtGB(n.sizeBytes)}
                      {more}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <DetailPanel
          node={sel ?? node}
          isSelection={!!sel}
          canGoUp={crumbs.length > 0}
          onUp={() => open(crumbs.slice(0, -1))}
          picked={!!sel?.path && picks.some((p) => p.path === sel.path)}
          covered={!!sel?.reason && findings.some((f) => f.kind === COVERED_BY[sel.reason!])}
          onPick={(n) => {
            play("tick");
            toggle({ path: n.path!, name: n.name, sizeBytes: n.sizeBytes, reason: n.reason });
          }}
          device={deviceName(platform)}
          fileManager={fileManagerName(platform)}
        />
      </div>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="size-3 rounded" style={{ background: color }} />
      {children}
    </div>
  );
}

interface DetailPanelProps {
  node: ExploreNode;
  isSelection: boolean;
  canGoUp: boolean;
  onUp: () => void;
  picked: boolean;
  /** Already part of a Home category (e.g. Caches is "Temporary files"). */
  covered: boolean;
  onPick: (n: ExploreNode) => void;
  device: string;
  fileManager: string;
}

function DetailPanel({ node, isSelection, canGoUp, onUp, picked, covered, onPick, device, fileManager }: DetailPanelProps) {
  const freeable = isFreeable(node.reason);
  const desc = node.reason
    ? reasonDesc(node.reason, device)
    : isSelection
      ? node.path
        ? "Sift won't suggest removing this. It's yours to decide."
        : "Lots of small files, grouped together to keep the map readable."
      : "Tap a block to look inside. Teal blocks can be freed safely.";

  let action: { label: string; primary?: boolean; run: () => void } | null = null;
  if (isSelection && freeable && covered) {
    action = { label: "Already on Home ✓", run: () => {} };
  } else if (isSelection && freeable && node.path) {
    action = { label: picked ? "Added to review ✓" : "Add to review", primary: !picked, run: () => onPick(node) };
  } else if (!isSelection && canGoUp) {
    action = { label: "‹ Up one level", run: onUp };
  } else if (node.path) {
    action = { label: `Show in ${fileManager}`, run: () => void api.revealPath(node.path!) };
  }

  return (
    <div className="box-border flex w-[250px] flex-none flex-col gap-3 rounded-[18px] bg-panel p-[22px]">
      <span className="text-xl leading-[1.2] font-bold break-words">{node.name}</span>
      {node.path && (
        <span className="font-mono text-xs leading-[1.4] break-all text-mut select-text">{tildify(node.path)}</span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{fmtGB(node.sizeBytes)}</span>
        {isSelection && node.reason && (
          <span className={cn("rounded-full px-[9px] py-[3px] text-xs font-semibold", freeable ? "bg-mint text-tealtx" : "bg-line text-mut2")}>
            {freeable ? "Safe to remove" : "Leave alone"}
          </span>
        )}
        {!isSelection && node.freeBytes > 50e6 && (
          <span className="rounded-full bg-mint px-[9px] py-[3px] text-xs font-semibold text-tealtx">
            {fmtGB(node.freeBytes)} can go
          </span>
        )}
      </div>
      <span className="text-sm leading-normal text-pretty text-mut2">{desc}</span>
      <div className="flex-1" />
      {action && (
        <button
          type="button"
          onClick={action.run}
          className={cn(
            "cursor-pointer rounded-full p-3 text-center text-sm font-semibold shadow-[inset_0_0_0_1px_var(--line2)] transition-colors duration-200",
            action.primary ? "bg-teal text-white hover:bg-tealtx" : "bg-surface text-ink",
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
