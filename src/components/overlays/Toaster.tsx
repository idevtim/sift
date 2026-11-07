import { useEffect, useState } from "react";
import { play } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { RouteId } from "@/routes";
import { useToasts, type Toast } from "@/stores/toastStore";

/** How long a toast stays; problems stay a little longer to be read. */
const SHOW_MS = { done: 4200, problem: 7000 } as const;

/**
 * Result messages, stacked bottom-right above everything else. A leaving
 * toast fades and slides right while its height folds to 0, so the rest
 * glide into place whichever one goes.
 */
export function Toaster({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute right-6 bottom-4 z-50 flex w-[360px] flex-col">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out-soft",
            t.leaving ? "translate-x-6 grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
          )}
        >
          {/* Clip only while folding, so the shadow shows the rest of the time. */}
          <div className={cn("min-h-0", t.leaving && "overflow-hidden")}>
            <div className="pb-2">
              <ToastCard toast={t} onNavigate={onNavigate} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToastCard({ toast, onNavigate }: { toast: Toast; onNavigate: (id: RouteId) => void }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [hovered, setHovered] = useState(false);

  // Leave after a while, unless the pointer is resting on it.
  useEffect(() => {
    if (hovered || toast.leaving) return;
    const t = setTimeout(() => dismiss(toast.id), SHOW_MS[toast.tone]);
    return () => clearTimeout(t);
  }, [hovered, toast, dismiss]);

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="pointer-events-auto flex w-full animate-[sift-pop_.28s_cubic-bezier(.2,.9,.3,1.2)_both] items-center gap-3 rounded-2xl bg-surface py-3 pr-2 pl-3.5 shadow-[0_18px_40px_-16px_rgba(0,0,0,.35),0_0_0_1px_var(--line2)]"
    >
      <div
        className={cn(
          "flex size-6 flex-none items-center justify-center rounded-full text-xs font-bold",
          toast.tone === "done" ? "bg-mint text-tealtx" : "bg-sand text-sandtx",
        )}
      >
        {toast.tone === "done" ? "✓" : "!"}
      </div>
      {/* Long unbroken names (bundle ids, file names) wrap instead of spilling. */}
      <span className="min-w-0 flex-1 text-sm leading-[1.4] font-semibold text-pretty [overflow-wrap:anywhere]">
        {toast.text}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            play("tap");
            onNavigate(toast.action!.route);
            dismiss(toast.id);
          }}
          className="flex-none cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-mut2 hover:bg-panel hover:text-ink"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="flex size-7 flex-none cursor-pointer items-center justify-center rounded-full text-mut hover:bg-panel hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
