import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFindings } from "@/hooks/useFindings";
import { usePlatform } from "@/hooks/usePlatform";
import { useReplayScan } from "@/hooks/useReplayScan";
import { useRescan } from "@/hooks/useRescan";
import { resolveTheme } from "@/hooks/useTheme";
import { fmtGB, tildify } from "@/lib/format";
import { isFreeable } from "@/lib/reasonCopy";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { routesIn, type RouteId } from "@/routes";
import { useExplore } from "@/stores/exploreStore";
import { usePalette } from "@/stores/paletteStore";
import { usePrefs } from "@/stores/prefsStore";
import { Spinner } from "@/components/ui/Spinner";

interface Result {
  group: "Files" | "Actions" | "Pages";
  label: string;
  sub: string;
  glyph: string;
  tint: string;
  hint?: string;
  run: () => void;
}

const MAX_RESULTS = 9;

/** Debounce a value by `ms`. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { open, setOpen } = usePalette();
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const platform = usePlatform();
  const { theme, setTheme, soundOn, toggleSound, weeklyCheck } = usePrefs();
  const { selectedBytes } = useFindings();
  const replay = useReplayScan();
  const { rescan } = useRescan();
  const q = useDebounced(query.trim(), 120);
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["index", "search", q],
    queryFn: () => api.searchIndex(q),
    enabled: open && q.length > 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIdx(0);
    play("open");
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const dark = resolveTheme(theme) === "dark";
  const go = (id: RouteId) => () => {
    play("tap");
    onNavigate(id);
  };

  const actions: Result[] = [
    { group: "Actions", label: "Free up space", sub: `${fmtGB(selectedBytes)} ready to review`, glyph: "✓", tint: "var(--mint)", run: go("review") },
    {
      group: "Actions",
      label: dark ? "Switch to light theme" : "Switch to dark theme",
      sub: "Appearance",
      glyph: dark ? "☀" : "☾",
      tint: "var(--panel)",
      run: () => {
        play("tap");
        setTheme(dark ? "light" : "dark");
      },
    },
    { group: "Actions", label: soundOn ? "Turn sounds off" : "Turn sounds on", sub: "Soft clicks and chimes", glyph: "♪", tint: "var(--panel)", run: toggleSound },
    {
      group: "Actions",
      label: weeklyCheck ? "Turn weekly check-up off" : "Turn weekly check-up on",
      sub: "Sift looks every Sunday and lets you know",
      glyph: "◷",
      tint: "var(--panel)",
      run: () => {
        play("tap");
        usePrefs.setState({ weeklyCheck: !weeklyCheck });
      },
    },
    { group: "Actions", label: "Rescan", sub: "Look at this computer again for changes", glyph: "↻", tint: "var(--panel)", run: () => void rescan() },
    { group: "Actions", label: "Replay first scan", sub: "See the launch animation again", glyph: "↻", tint: "var(--panel)", run: replay },
    {
      group: "Actions",
      label: "Replay onboarding",
      sub: "Welcome, permission and setup",
      glyph: "★",
      tint: "var(--panel)",
      run: () => usePrefs.getState().setOnboarding({ step: "welcome", mode: "setup" }),
    },
  ];
  const pages: Result[] = [...routesIn("everyday"), ...routesIn("power")].map((r) => ({
    group: "Pages",
    label: r.label,
    sub: `Go to ${r.label}`,
    glyph: r.label[0],
    tint: "var(--panel)",
    run: go(r.id),
  }));
  const files: Result[] = hits.map((h) => ({
    group: "Files",
    label: h.name,
    sub: tildify(h.path),
    glyph: isFreeable(h.reason) ? "✓" : "·",
    tint: isFreeable(h.reason) ? "var(--mint)" : "var(--panel)",
    hint: fmtGB(h.sizeBytes),
    run: () => {
      play("tap");
      useExplore.getState().open(h.parentCrumbs, h.name);
      onNavigate("explore");
    },
  }));
  const needle = query.trim().toLowerCase();
  const all = needle
    ? [...files, ...[...actions, ...pages].filter((r) => `${r.label} ${r.sub}`.toLowerCase().includes(needle))]
    : [...actions, ...pages];
  const list = all.slice(0, MAX_RESULTS);
  const cur = Math.min(idx, Math.max(0, list.length - 1));
  const runAt = (i: number) => {
    close();
    list[i]?.run();
  };
  const mod = platform === "macos" ? "⌘K" : "Ctrl K";

  return (
    <div
      onClick={close}
      className="absolute inset-0 z-40 box-border flex animate-[sift-fade_.2s_ease_both] items-start justify-center bg-[rgba(15,17,20,.38)] pt-24 backdrop-blur-[4px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[580px] animate-[sift-pop_.28s_cubic-bezier(.2,.9,.3,1.2)_both] overflow-hidden rounded-[20px] bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,.5),0_0_0_1px_var(--line3)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="text-xl text-mut">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                play("tick");
                setIdx(Math.min(cur + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                play("tick");
                setIdx(Math.max(cur - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(cur);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="Search files, pages and actions"
            className="flex-1 border-none bg-transparent font-sans text-lg text-ink outline-none select-text placeholder:text-mut3"
          />
          {isFetching && <Spinner size={14} className="text-mut" />}
          <kbd className="rounded-md px-[7px] py-[3px] font-sans text-xs font-semibold text-mut shadow-[inset_0_0_0_1px_var(--line2)]">esc</kbd>
        </div>
        <div className="max-h-[400px] overflow-auto p-2">
          {list.map((r, k) => (
            <div key={`${r.group}-${r.label}-${r.sub}`} className="flex flex-col">
              {(k === 0 || list[k - 1].group !== r.group) && (
                <div className="px-3 pt-2.5 pb-1 text-[11px] font-bold tracking-[0.08em] text-mut3">{r.group.toUpperCase()}</div>
              )}
              <button
                type="button"
                onClick={() => runAt(k)}
                onMouseEnter={() => k !== cur && setIdx(k)}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-[9px] text-left transition-colors duration-100"
                style={{ background: k === cur ? "var(--panel)" : "transparent" }}
              >
                <div className="flex size-8 flex-none items-center justify-center rounded-[10px] text-sm font-bold" style={{ background: r.tint }}>
                  {r.glyph}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[15px] font-semibold">{r.label}</span>
                  <span className="truncate text-xs text-mut">{r.sub}</span>
                </div>
                {r.hint && <span className="text-xs font-semibold text-mut">{r.hint}</span>}
              </button>
            </div>
          ))}
          {!list.length && !isFetching && q === query.trim() && <div className="p-6 text-center text-sm text-mut">No matches for "{query}"</div>}
        </div>
        <div className="flex gap-4 border-t border-line px-5 py-2.5 text-xs text-mut">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>{mod} to close</span>
        </div>
      </div>
    </div>
  );
}
