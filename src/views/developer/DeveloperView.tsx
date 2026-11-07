import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Toggle } from "@/components/ui/Toggle";
import { fmtGB, tildify } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { daysSince } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { DevArtifact, DevKind, DevReport } from "@/types/api";
import { Busy, Loading } from "@/components/ui/Spinner";
import { toast } from "@/stores/toastStore";

type Age = 30 | 60 | 90;

/** The page opens at 60 days; the sidebar badge counts the same. */
const DEFAULT_AGE: Age = 60;

interface Row {
  id: string;
  name: string;
  path: string;
  why: string;
  bytes: number;
  defaultOn: boolean;
  /** How to clean it: a tool command, or these paths (deleted outright). */
  clean: { tool: "docker" | "simulators" } | { paths: string[] };
}

const counted = (base: string, n: number) => (n > 1 ? `${base} ×${n}` : base);

/** First path, plus how many more — paths are a Power-tools detail. */
const pathSummary = (items: DevArtifact[]) =>
  tildify(items[0].path) + (items.length > 1 ? `  +${items.length - 1} more` : "");

function rows(report: DevReport, age: Age): Row[] {
  const out: Row[] = [];
  if (report.dockerBytes) {
    out.push({ id: "docker", name: "Docker images", path: "docker image prune", why: "Images that no container uses.", bytes: report.dockerBytes, defaultOn: true, clean: { tool: "docker" } });
  }
  if (report.simulatorBytes) {
    out.push({ id: "simulators", name: "iOS Simulators", path: "~/Library/Developer/CoreSimulator", why: "Old simulator runtimes. Xcode downloads them again if needed.", bytes: report.simulatorBytes, defaultOn: false, clean: { tool: "simulators" } });
  }
  // Project-based output only counts if the project's been left alone long enough.
  const stale = (kind: DevKind) =>
    report.artifacts.filter((a) => a.kind === kind && daysSince(a.projectModifiedMs) >= age);
  const group = (kind: DevKind, name: string, why: string) => {
    const items = kind === "packageCaches" ? report.artifacts.filter((a) => a.kind === kind) : stale(kind);
    if (!items.length) return;
    out.push({
      id: kind,
      name: kind === "packageCaches" ? name : counted(name, items.length),
      path: kind === "packageCaches" ? items.map((a) => tildify(a.path)).join(" · ") : pathSummary(items),
      why,
      bytes: items.reduce((s, a) => s + a.sizeBytes, 0),
      defaultOn: true,
      clean: { paths: items.map((a) => a.path) },
    });
  };
  group("derivedData", "Xcode DerivedData", "Build cache. Your next build is slower, nothing else changes.");
  group("rustTarget", "Rust target/", "Compiled output. cargo build recreates it.");
  group("nodeModules", "node_modules", "Installed packages. npm install brings them back.");
  group("packageCaches", "Package caches", "Downloaded packages, kept so installs are faster.");
  return out;
}

/** What the page selects when it opens — the sidebar's Developer badge. */
export const defaultCleanable = (report: DevReport) =>
  rows(report, DEFAULT_AGE)
    .filter((r) => r.defaultOn)
    .reduce((s, r) => s + r.bytes, 0);

export function DeveloperView() {
  const { data: report, isLoading } = useQuery(queries.dev);
  const [age, setAge] = useState<Age>(DEFAULT_AGE);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const list = report ? rows(report, age) : [];
  const isOn = (r: Row) => overrides[r.id] ?? r.defaultOn;
  const selected = list.filter(isOn);
  const total = selected.reduce((s, r) => s + r.bytes, 0);

  const clean = useMutation({
    mutationFn: async (targets: Row[]) => {
      for (const r of targets) {
        if ("tool" in r.clean) await (r.clean.tool === "docker" ? api.cleanDocker() : api.cleanSimulators());
        else await api.freePaths(r.clean.paths, r.name, r.bytes, false);
      }
    },
    onSuccess: (_, targets) => {
      play("chime");
      setDoneNote("done");
      toast(`Cleaned ${fmtGB(targets.reduce((s, r) => s + r.bytes, 0))}. Your tools will rebuild these when they need them.`);
    },
    onError: (e) => toast(`Couldn't finish cleaning. ${String(e)}`, { tone: "problem" }),
    onSettled: () => {
      for (const key of ["index", "restore", "drives"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col">
      <div className="flex items-end justify-between gap-6 px-[52px] pt-[34px] pb-[18px]">
        <PageHeader title="Developer">
          Build output and caches your tools can recreate. Projects you're working on are skipped.
        </PageHeader>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <span className="text-xs font-bold tracking-[0.06em] text-mut3">ONLY PROJECTS UNTOUCHED FOR</span>
          <Segmented<Age>
            value={age}
            onChange={(v) => {
              play("tick");
              setAge(v);
              setDoneNote(null);
            }}
            options={[30, 60, 90].map((v) => ({ value: v as Age, label: `${v} days` }))}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-auto px-[52px]">
        {isLoading && <Loading>Looking for build output…</Loading>}
        {!isLoading && list.length === 0 && (
          <div className="max-w-[520px] rounded-[20px] bg-panel p-7 text-base leading-[1.45] text-mut2">
            Nothing to clean. Projects untouched for {age} days will show their build output here.
          </div>
        )}
        {list.map((r) => {
          const on = isOn(r);
          return (
            <button
              key={r.id}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => {
                play("tick");
                setOverrides((o) => ({ ...o, [r.id]: !on }));
                setDoneNote(null);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-4 rounded-2xl px-[18px] py-[13px] text-left transition-colors duration-250 hover:bg-hover",
                on ? "bg-panel" : "bg-surface",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold">{r.name}</span>
                <span className="truncate font-mono text-xs text-mut">{r.path}</span>
                <span className="text-[13px] text-mut2">{r.why}</span>
              </div>
              <span className="w-[76px] text-right text-base font-semibold tabular-nums">{fmtGB(r.bytes)}</span>
              <Toggle on={on} />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-5 border-t border-line px-[52px] py-[18px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-mut">Selected</span>
          <span className="text-[26px] font-bold tracking-[-0.02em] tabular-nums">{fmtGB(total)}</span>
        </div>
        <Button
          className={cn("px-6 py-3.5 text-base", doneNote && "bg-line text-mut2 hover:bg-line")}
          disabled={total === 0 || clean.isPending || !!doneNote}
          onClick={() => clean.mutate(selected)}
        >
          {doneNote ? "Cleaned ✓" : clean.isPending ? <Busy>Cleaning…</Busy> : "Clean selected"}
        </Button>
      </div>
    </div>
  );
}
