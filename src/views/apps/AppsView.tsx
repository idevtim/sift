import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { useFreePaths } from "@/hooks/useFreePaths";
import { fmtGB } from "@/lib/format";
import { usePlatform } from "@/hooks/usePlatform";
import { queries } from "@/lib/queries";
import { refreshAfterRemoval } from "@/lib/refresh";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { ago, daysSince, isStale } from "@/lib/time";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toastStore";
import type { AppInfo, AppList, AppPartKind, AppSource } from "@/types/api";
import { Busy, Loading } from "@/components/ui/Spinner";

const partLabel: Record<AppPartKind, string> = {
  app: "App",
  caches: "Caches",
  support: "Settings & support",
};

const totalOf = (a: AppInfo) => a.parts.reduce((s, p) => s + p.sizeBytes, 0);
const cachesOf = (a: AppInfo) => a.parts.find((p) => p.kind === "caches")?.sizeBytes ?? 0;

/** Not opened in half a year (and not open now): the "Unused" filter. */
const UNUSED_DAYS = 182;
const isUnused = (a: AppInfo) => !a.running && !!a.lastOpenedMs && daysSince(a.lastOpenedMs) >= UNUSED_DAYS;

/** Apps that run their own uninstaller before Sift clears the leftovers. */
const ownUninstaller = (s: AppSource) => s === "installer" || s === "flatpak" || s === "snap";

const sourceLabel: Record<AppSource, string> = {
  bundle: "",
  installer: "",
  flatpak: "Flatpak",
  snap: "Snap",
  appImage: "AppImage",
};

/** The app's own icon once it's loaded; its initial on an ink tile until then. */
function AppIcon({ app }: { app: AppInfo }) {
  const { data: src } = useQuery({
    queryKey: ["app-icon", app.icon],
    queryFn: () => api.appIcon(app.icon!),
    enabled: !!app.icon,
    staleTime: Infinity,
  });
  if (src) return <img src={src} alt="" className="size-[42px] flex-none object-contain" draggable={false} />;
  return (
    <div className="flex size-[42px] flex-none items-center justify-center rounded-xl bg-ink font-bold text-surface">
      {app.name[0]?.toUpperCase()}
    </div>
  );
}

function subtitle(a: AppInfo): string {
  if (a.running) return "Open now";
  if (a.lastOpenedMs) return `Last opened ${ago(a.lastOpenedMs)}`;
  if (a.installedMs) return `Installed ${ago(a.installedMs)}`;
  return a.source === "bundle" ? "Never opened" : sourceLabel[a.source];
}

export function AppsView() {
  const { data, isLoading } = useQuery(queries.apps);
  const [open, setOpen] = useState<string | null>(null);
  /** Rows folding away after an uninstall, before they leave the list. */
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const free = useFreePaths();
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const all = data?.apps ?? [];
  const [show, setShow] = useState<"all" | "unused">("all");
  const unused = all.filter(isUnused);
  const apps = show === "unused" ? unused : all;

  const remove = useMutation({
    mutationFn: api.uninstallApp,
    onSuccess: (report, a) => {
      play("chime");
      setOpen(null);
      // Fold the row away now, then drop it from the cached list — a full
      // re-list re-measures every app and takes a while.
      setLeaving((s) => new Set(s).add(a.id));
      setTimeout(() => {
        queryClient.setQueryData<AppList>(["apps"], (list) =>
          list ? { ...list, apps: list.apps.filter((x) => x.id !== a.id) } : list,
        );
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(a.id);
          return next;
        });
      }, 380);
      toast(
        ownUninstaller(a.source)
          ? `${a.name} uninstalled.${report.freedBytes > 0 ? ` ${fmtGB(report.freedBytes)} it left behind is in Restore.` : ""}`
          : `${a.name} uninstalled, with everything it left behind. ${fmtGB(report.freedBytes)} freed.`,
        { action: { label: "View", route: "restore" } },
      );
    },
    onError: (e, a) => {
      const msg = String(e);
      // Still open: show it on the row, too.
      if (msg.startsWith("Quit ")) {
        queryClient.setQueryData<AppList>(["apps"], (list) =>
          list ? { ...list, apps: list.apps.map((x) => (x.id === a.id ? { ...x, running: true } : x)) } : list,
        );
      }
      toast(`Couldn't uninstall ${a.name}. ${msg}`, { tone: "problem" });
    },
    onSettled: () => refreshAfterRemoval(queryClient),
  });
  const busy = free.isPending || remove.isPending;

  // The list is cached, so `running` can be stale (the app was open when
  // it was listed). Sift re-checks before uninstalling, so always ask.
  const uninstall = (a: AppInfo) => remove.mutate(a);

  const clearCaches = (a: AppInfo) => {
    const caches = a.parts.find((p) => p.kind === "caches");
    if (!caches) return;
    free.mutate(
      { paths: caches.paths, label: `${a.name} caches`, bytes: caches.sizeBytes, restorable: false },
      {
        onSuccess: () => {
          toast(`Cleared ${fmtGB(caches.sizeBytes)} of ${a.name} caches.`);
          queryClient.setQueryData<AppList>(["apps"], (list) =>
            list
              ? {
                  ...list,
                  apps: list.apps.map((x) =>
                    x.id === a.id ? { ...x, parts: x.parts.filter((p) => p.kind !== "caches") } : x,
                  ),
                }
              : list,
          );
        },
      },
    );
  };

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-[18px] overflow-auto px-[52px] py-[34px]">
      <PageHeader title="Apps">
        Includes the hidden files each app leaves around. Uninstalling here removes everything, not just the app.
      </PageHeader>
      {all.length > 0 && (
        <div className="stagger grid flex-none grid-cols-3 gap-3.5">
          <SummaryTile
            title="Not opened in 6 months"
            value={unused.length ? fmtGB(unused.reduce((s, a) => s + totalOf(a), 0)) : "None"}
            sub={
              unused.length
                ? `${unused.length} ${unused.length === 1 ? "app" : "apps"} · tap to see ${unused.length === 1 ? "it" : "them"}`
                : "You use everything you have"
            }
            hue="#e0743a"
            gain={unused.length > 0}
            on={show === "unused"}
            onClick={
              unused.length
                ? () => {
                    play("tap");
                    setOpen(null);
                    setShow(show === "unused" ? "all" : "unused");
                  }
                : undefined
            }
          />
          <SummaryTile
            title="All apps"
            value={fmtGB(all.reduce((s, a) => s + totalOf(a), 0))}
            sub={`${all.length} ${all.length === 1 ? "app" : "apps"}, with what they leave around`}
            hue="#7a4fd6"
            on={show === "all"}
            onClick={
              show === "all"
                ? undefined
                : () => {
                    play("tap");
                    setOpen(null);
                    setShow("all");
                  }
            }
          />
          <SummaryTile
            title="App caches"
            value={fmtGB(all.reduce((s, a) => s + cachesOf(a), 0))}
            sub="Apps rebuild these when they need them"
            hue="#2d7fd6"
            gain
          />
        </div>
      )}
      {isLoading && <Loading>Measuring your apps…</Loading>}
      {remove.isPending && remove.variables && ownUninstaller(remove.variables.source) && (
        <Note tone="sand">
          {remove.variables.source === "installer"
            ? `Finish in ${remove.variables.name}'s uninstaller. Sift clears what it leaves behind once it's gone.`
            : `Uninstalling ${remove.variables.name}. Your system may ask for your password.`}
        </Note>
      )}
      {data && !data.supported && (
        <div className="max-w-[560px] rounded-[20px] bg-glass ring-1 ring-inset ring-[var(--st-edge)] p-7 text-base leading-[1.45] text-mut2">
          Sift can uninstall Flatpaks, Snaps and AppImages, and didn't find any. For apps from your package manager, use
          its own tools.
        </div>
      )}
      {data?.supported && platform === "linux" && (
        <span className="text-sm text-mut">
          Showing Flatpaks, Snaps and AppImages. For apps from your package manager, use its own tools.
        </span>
      )}

      <div key={show} className="stagger flex flex-col">
        {apps.map((a) => {
          const isOpen = open === a.id;
          const total = totalOf(a);
          const caches = a.parts.find((p) => p.kind === "caches");
          return (
            // Grid rows animate the height to 0 when the app leaves; the
            // spacing lives inside, so it folds away too.
            <div
              key={a.id}
              className={cn(
                "grid transition-[grid-template-rows,opacity,transform] duration-350 ease-out-soft",
                leaving.has(a.id) ? "grid-rows-[0fr] scale-[.98] opacity-0" : "grid-rows-[1fr]",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="pb-2">
                  <div
                    className={cn(
                      "overflow-hidden rounded-[20px] ring-1 ring-[var(--st-edge)] ring-inset transition-[background-color,box-shadow] duration-300",
                      isOpen ? "bg-glass-hi shadow-[var(--st-shadow)]" : "bg-glass hover:bg-glass-hi",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        play("tap");
                        setOpen(isOpen ? null : a.id);
                      }}
                      aria-expanded={isOpen}
                      className="group flex w-full cursor-pointer items-center gap-3.5 px-[18px] py-3.5 text-left"
                    >
                      <span className="transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-6">
                        <AppIcon app={a} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-base font-semibold">{a.name}</span>
                        <span
                          className={cn(
                            "text-[13px]",
                            a.lastOpenedMs && isStale(a.lastOpenedMs) ? "text-sandtx" : "text-mut",
                          )}
                        >
                          {subtitle(a)}
                        </span>
                      </div>
                      <span className="text-base font-semibold text-gain tabular-nums">{fmtGB(total)}</span>
                      <span
                        className={cn(
                          "inline-block text-lg text-mut3 transition-transform duration-500 ease-spring",
                          isOpen && "rotate-90",
                        )}
                      >
                        ›
                      </span>
                    </button>
                    {isOpen && (
                      <div className="flex animate-rise flex-col gap-3 pr-[18px] pb-4 pl-[74px]">
                        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
                          {a.parts.map((p) => (
                            <div
                              key={p.kind}
                              className="origin-left animate-[sift-grow_.7s_var(--spring)_both] bg-teal opacity-90"
                              style={{ width: `${((p.sizeBytes / total) * 100).toFixed(1)}%` }}
                            />
                          ))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {a.parts.map((p) => (
                            <div key={p.kind} className="flex justify-between text-sm">
                              <span className="text-mut2">{partLabel[p.kind]}</span>
                              <span className="font-semibold">{fmtGB(p.sizeBytes)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => uninstall(a)}
                            className="cursor-pointer rounded-full bg-ink px-[18px] py-2.5 text-sm font-semibold text-surface transition-transform duration-400 ease-spring hover:scale-[1.03] active:scale-95"
                          >
                            {remove.isPending && remove.variables?.id === a.id ? (
                              <Busy>Uninstalling…</Busy>
                            ) : (
                              `Uninstall completely · ${fmtGB(total)}`
                            )}
                          </button>
                          {caches && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => clearCaches(a)}
                              className="cursor-pointer rounded-full bg-glass-hi px-[18px] py-2.5 text-sm font-semibold shadow-[inset_0_0_0_1px_var(--line2)] transition-transform duration-400 ease-spring hover:scale-[1.03] active:scale-95"
                            >
                              {free.isPending && free.variables?.label === `${a.name} caches` ? (
                                <Busy>Clearing…</Busy>
                              ) : (
                                "Just clear caches"
                              )}
                            </button>
                          )}
                        </div>
                        <span className="text-[13px] text-mut">
                          {caches
                            ? "Uninstalling keeps everything in Restore for 30 days. Caches are cleared for good; apps rebuild them."
                            : "Uninstalling keeps everything in Restore for 30 days."}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Glass summary card above the list; tappable ones filter it. */
function SummaryTile({
  title,
  value,
  sub,
  hue,
  gain,
  on,
  onClick,
}: {
  title: string;
  value: string;
  sub: string;
  hue: string;
  gain?: boolean;
  on?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-sm font-semibold text-dim">{title}</span>
      <span className={cn("mt-2 text-[26px] leading-tight font-extrabold tracking-[-0.01em] tabular-nums", gain && "text-gain")}>
        {value}
      </span>
      <span className="text-[13px] text-dim">{sub}</span>
    </>
  );
  const cls = cn(
    "flex flex-col rounded-[22px] bg-glass p-[18px] text-left ring-1 ring-[var(--st-edge)] ring-inset",
    on && onClick === undefined && "bg-glass-hi",
    on && "ring-2 ring-[var(--st-ink)]",
  );
  const style = { backgroundImage: `linear-gradient(165deg, color-mix(in srgb, ${hue} var(--st-tint), transparent), transparent 85%)` };
  return onClick ? (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(cls, "cursor-pointer transition-transform duration-500 ease-spring hover:-translate-y-1 active:scale-[.97]")}
      style={style}
    >
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
