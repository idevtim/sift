import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { useFreePaths } from "@/hooks/useFreePaths";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { fmtGB } from "@/lib/format";
import { queries } from "@/lib/queries";
import { ago } from "@/lib/time";
import { Busy, Loading } from "@/components/ui/Spinner";
import { toast } from "@/stores/toastStore";

export function BigFilesView() {
  const { data: files = [], isLoading } = useQuery(queries.bigFiles);
  const remove = useFreePaths();
  const device = deviceName(usePlatform());
  const max = Math.max(1, ...files.map((f) => f.sizeBytes));

  return (
    <div className="absolute inset-0 flex animate-sift-in flex-col gap-6 overflow-auto px-[52px] py-11">
      <PageHeader title="Big files">
        The largest things on your {device} that you haven't opened in a while.
      </PageHeader>
      {isLoading && <Loading>Looking through your files…</Loading>}
      {!isLoading && files.length === 0 && (
        <div className="max-w-[520px] rounded-[20px] bg-panel p-7 text-base leading-[1.45] text-mut2">
          Nothing big is sitting around. Files over 100 MB will show up here.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {files.map((f) => (
          <div key={f.path} className="flex animate-[sift-in_.4s_ease_both] items-center gap-[18px] rounded-[18px] bg-panel px-[18px] py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-base font-semibold">{f.name}</span>
                <span className="flex-none text-sm whitespace-nowrap text-mut">
                  {f.location} · last opened {ago(f.lastOpenedMs)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-[3px] bg-track">
                <div className="h-full rounded-[3px] bg-ink" style={{ width: `${(f.sizeBytes / max) * 100}%` }} />
              </div>
            </div>
            <span className="w-[72px] text-right text-base font-semibold">{fmtGB(f.sizeBytes)}</span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { paths: [f.path], label: f.name, bytes: f.sizeBytes },
                  {
                    onSuccess: () =>
                      toast(`${f.name} is in Restore for 30 days.`, { action: { label: "View", route: "restore" } }),
                    onError: (e) => toast(`Couldn't remove ${f.name}. ${String(e)}`, { tone: "problem" }),
                  },
                )
              }
              className="cursor-pointer rounded-full bg-surface px-4 py-[9px] text-sm font-semibold shadow-[inset_0_0_0_1px_var(--line2)] transition-colors duration-200 hover:bg-mint active:scale-[.97]"
            >
              {remove.isPending && remove.variables?.paths[0] === f.path ? <Busy>Removing…</Busy> : "Remove"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
