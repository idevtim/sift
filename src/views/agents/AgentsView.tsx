import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Busy, Loading } from "@/components/ui/Spinner";
import { Toggle } from "@/components/ui/Toggle";
import { fileManagerName, usePlatform } from "@/hooks/usePlatform";
import { fmtGB, fmtSize } from "@/lib/format";
import { queries } from "@/lib/queries";
import { refreshAfterRemoval } from "@/lib/refresh";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toastStore";
import type { AgentItem, AgentItemKind, AgentReport, AgentTool } from "@/types/api";

const KIND_LABEL: Record<AgentItemKind, string> = {
  worktree: "Worktree",
  cache: "Cache",
  oldVersion: "Old version",
  history: "History",
  workspace: "Editor state",
  model: "Model",
};

/** Each tool's tile: initials on its own colour. */
const TOOL_LOOK: Record<string, { tag: string; hue: [string, string] }> = {
  "claude-code": { tag: "CC", hue: ["#f2b38f", "#c9643b"] },
  claude: { tag: "C", hue: ["#f5c6a5", "#d97757"] },
  cursor: { tag: "Cu", hue: ["#9aa3ad", "#2b3138"] },
  vscode: { tag: "VS", hue: ["#7cc4ff", "#1f6fc8"] },
  windsurf: { tag: "W", hue: ["#8ff0d6", "#1f8a76"] },
  codex: { tag: "Cx", hue: ["#c3ccd6", "#3f4852"] },
  ollama: { tag: "O", hue: ["#e6e2da", "#8a8f96"] },
};

/** Removable now, and part of what "Clean selected" would do by default. */
const canClean = (i: AgentItem) => i.removable && !i.blocked;

export function AgentsView() {
  const { data, isLoading } = useQuery(queries.agents);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const platform = usePlatform();
  const tools = data?.tools ?? [];
  const items = tools.flatMap((t) => t.items);
  const isOn = (i: AgentItem) => canClean(i) && (overrides[i.id] ?? i.defaultOn);
  const selected = items.filter(isOn);
  const total = selected.reduce((s, i) => s + i.sizeBytes, 0);
  const forGood = selected.filter((i) => !i.held);
  const forGoodBytes = forGood.reduce((s, i) => s + i.sizeBytes, 0);

  const worktrees = items.filter((i) => i.kind === "worktree");
  const models = items.filter((i) => i.kind === "model");
  const cleanable = items.filter(canClean).reduce((s, i) => s + i.sizeBytes, 0);

  const clean = useMutation({
    mutationFn: (chosen: AgentItem[]) => api.cleanAgents(chosen.map((i) => i.id)),
    onSuccess: (report, chosen) => {
      play("chime");
      const ids = new Set(chosen.map((i) => i.id));
      // Drop them now; the refetch below confirms what's left.
      queryClient.setQueryData<AgentReport>(["agents"], (r) =>
        r
          ? {
              tools: r.tools
                .map((t) => ({ ...t, items: t.items.filter((i) => !ids.has(i.id)) }))
                .filter((t) => t.items.length),
            }
          : r,
      );
      setOverrides({});
      toast(
        `Cleaned ${fmtGB(report.freedBytes)}.${chosen.some((i) => i.held) ? " Worktrees, versions and history are in Restore for 30 days." : ""}${report.skipped ? ` ${report.skipped} in use, so Sift left them alone.` : ""}`,
        { action: chosen.some((i) => i.held) ? { label: "View", route: "restore" } : undefined },
      );
    },
    onError: (e) => toast(`Couldn't finish cleaning. ${String(e)}`, { tone: "problem" }),
    onSettled: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      refreshAfterRemoval(queryClient);
    },
  });

  const run = () => {
    if (forGood.length && !confirming) {
      play("tap");
      setConfirming(true);
    } else clean.mutate(selected);
  };

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col">
      <div className="flex flex-col px-[52px] pt-[34px] pb-[18px]">
        <PageHeader title="AI agents">
          Worktrees, caches and old versions that AI coding tools leave behind. Settings, sign-ins and anything in use
          are never touched.
        </PageHeader>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 overflow-auto px-9 pb-2">
        {tools.length > 0 && (
          <div className="stagger grid flex-none grid-cols-3 gap-3.5">
            <Summary title="Can be cleaned" value={fmtGB(cleanable)} sub="Across every tool below" hue="#1f8a76" gain />
            <Summary
              title="Leftover worktrees"
              value={worktrees.length ? fmtGB(worktrees.reduce((s, i) => s + i.sizeBytes, 0)) : "None"}
              sub={
                worktrees.length
                  ? `${worktrees.length} ${worktrees.length === 1 ? "copy" : "copies"} of projects agents worked in`
                  : "No worktrees left behind"
              }
              hue="#a24bd1"
            />
            <Summary
              title="Local models"
              value={models.length ? fmtGB(models.reduce((s, i) => s + i.sizeBytes, 0)) : "None"}
              sub={models.length ? "Listed only. Remove them in their own tool" : "No downloaded models"}
              hue="#5b6672"
            />
          </div>
        )}
        {isLoading && <Loading className="px-4">Looking for worktrees, caches and old versions…</Loading>}
        {!isLoading && tools.length === 0 && (
          <div className="mx-4 max-w-[540px] rounded-[20px] bg-glass p-7 text-base leading-[1.45] text-mut2 ring-1 ring-[var(--st-edge)] ring-inset">
            Nothing to clean up. Sift looks for Claude, Cursor, VS Code, Windsurf, Codex and Ollama.
          </div>
        )}
        <div className="stagger flex flex-col gap-3.5">
          {tools.map((t) => (
            <ToolCard
              key={t.id}
              tool={t}
              isOn={isOn}
              fileManager={fileManagerName(platform)}
              onToggle={(i) => {
                play("tick");
                setConfirming(false);
                setOverrides((o) => ({ ...o, [i.id]: !isOn(i) }));
              }}
            />
          ))}
        </div>
      </div>

      {tools.length > 0 && (
        <div className="mx-9 mt-3 mb-6 flex animate-rise items-center justify-between gap-5 rounded-[24px] bg-glass-hi py-4 pr-4 pl-7 shadow-[inset_0_0_0_1px_var(--st-edge),var(--st-shadow)] backdrop-blur-xl [animation-delay:.2s]">
          {confirming ? (
            <>
              <span className="flex-1 text-[15px] leading-[1.4] font-semibold text-pretty">
                {fmtGB(forGoodBytes)} of caches {forGood.length === 1 ? "is" : "are"} deleted for good and can't be put
                back.
                {forGood.length < selected.length && (
                  <span className="font-normal text-mut"> The rest goes to Restore.</span>
                )}
              </span>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  play("tap");
                  setConfirming(false);
                }}
                className="flex-none cursor-pointer rounded-full px-4 py-2.5 text-sm font-semibold transition-transform duration-400 ease-spring hover:bg-row active:scale-95"
              >
                Cancel
              </button>
              <Button variant="ink" className="px-5 py-3 text-[15px]" disabled={clean.isPending} onClick={run}>
                {clean.isPending ? <Busy>Cleaning…</Busy> : "Delete for good and clean"}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-mut">Selected</span>
                <span className="text-[26px] font-extrabold tracking-[-0.02em] text-gain tabular-nums">
                  {fmtGB(total)}
                </span>
              </div>
              <span className="ml-auto max-w-[320px] text-right text-[13px] leading-[1.4] text-mut">
                Caches are cleared for good. Worktrees, old versions and history wait in Restore for 30 days.
              </span>
              <Button className="px-6 py-3.5 text-base" disabled={total === 0 || clean.isPending} onClick={run}>
                {clean.isPending ? <Busy>Cleaning…</Busy> : "Clean selected"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({
  title,
  value,
  sub,
  hue,
  gain,
}: {
  title: string;
  value: string;
  sub: string;
  hue: string;
  gain?: boolean;
}) {
  return (
    <div
      className="flex flex-col rounded-[22px] bg-glass p-[18px] ring-1 ring-[var(--st-edge)] ring-inset"
      style={{
        backgroundImage: `linear-gradient(165deg, color-mix(in srgb, ${hue} var(--st-tint), transparent), transparent 85%)`,
      }}
    >
      <span className="text-sm font-semibold text-dim">{title}</span>
      <span
        className={cn(
          "mt-2 text-[26px] leading-tight font-extrabold tracking-[-0.01em] tabular-nums",
          gain && "text-gain",
        )}
      >
        {value}
      </span>
      <span className="text-[13px] text-dim">{sub}</span>
    </div>
  );
}

function ToolCard({
  tool,
  isOn,
  onToggle,
  fileManager,
}: {
  tool: AgentTool;
  isOn: (i: AgentItem) => boolean;
  onToggle: (i: AgentItem) => void;
  fileManager: string;
}) {
  const look = TOOL_LOOK[tool.id] ?? { tag: tool.name[0], hue: ["#c3ccd6", "#5b6672"] };
  const size = tool.items.reduce((s, i) => s + i.sizeBytes, 0);
  return (
    <section className="flex flex-col gap-1.5 rounded-[24px] bg-glass p-3 ring-1 ring-[var(--st-edge)] ring-inset">
      <div className="flex items-center gap-3 px-2 pt-1 pb-1.5">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-[12px] text-[13px] font-extrabold text-white"
          style={{
            background: `linear-gradient(140deg, ${look.hue[0]}, ${look.hue[1]})`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.45), 0 4px 12px -4px rgba(0,0,0,.3)",
          }}
        >
          {look.tag}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-[17px] font-bold">{tool.name}</h2>
          <span className="text-[13px] text-mut">
            {tool.items.length} {tool.items.length === 1 ? "item" : "items"} · {fmtGB(size)}
          </span>
        </div>
        {tool.open && (
          <span className="rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-sandtx">Open now</span>
        )}
      </div>
      {tool.items.map((i) => (
        <ItemRow key={i.id} item={i} on={isOn(i)} onToggle={() => onToggle(i)} fileManager={fileManager} />
      ))}
    </section>
  );
}

function ItemRow({
  item: i,
  on,
  onToggle,
  fileManager,
}: {
  item: AgentItem;
  on: boolean;
  onToggle: () => void;
  fileManager: string;
}) {
  const toggleable = i.removable && !i.blocked;
  const meta = [
    i.removable ? (i.held ? "Kept in Restore for 30 days" : "Deleted for good") : null,
    i.lastUsedMs ? `last used ${ago(i.lastUsedMs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{i.name}</span>
          <span className="flex-none rounded-full bg-row px-2 py-0.5 text-[11px] font-semibold text-mut2">
            {KIND_LABEL[i.kind]}
          </span>
        </div>
        <span className="truncate text-[13px] text-mut2">{i.detail}</span>
        {meta && <span className="text-xs text-mut">{meta}</span>}
        {i.note && <span className="text-xs font-semibold text-sandtx">{i.note}</span>}
        {i.blocked && <span className="text-xs font-semibold text-mut2">{i.blocked}</span>}
      </div>
      <span
        className={cn(
          "w-[84px] flex-none text-right text-[15px] font-semibold tabular-nums",
          on ? "text-gain" : "text-mut",
        )}
      >
        {fmtSize(i.sizeBytes)}
      </span>
    </>
  );

  if (!i.removable) {
    return (
      <div className="flex items-center gap-4 rounded-[18px] bg-glass/40 px-4 py-3">
        {body}
        <button
          type="button"
          onClick={() => {
            play("tap");
            void api.revealPath(i.path);
          }}
          className="flex-none cursor-pointer rounded-full bg-glass-hi px-3.5 py-2 text-[13px] font-semibold ring-1 ring-[var(--st-edge)] ring-inset transition-transform duration-400 ease-spring hover:scale-[1.03] active:scale-95"
        >
          Show in {fileManager}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={i.name}
      disabled={!toggleable}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-4 rounded-[18px] px-4 py-3 text-left transition-[background-color,box-shadow,transform] duration-300",
        toggleable ? "cursor-pointer hover:bg-glass-hi active:scale-[.99]" : "cursor-default opacity-75",
        on ? "bg-glass-hi shadow-[inset_0_0_0_1px_var(--st-edge)]" : "bg-glass/40",
      )}
    >
      {body}
      <Toggle on={on} />
    </button>
  );
}
