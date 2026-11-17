import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DriveRing } from "@/components/ui/DriveRing";
import type { IconName } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/IconTile";
import { Spinner } from "@/components/ui/Spinner";
import { useCountUp } from "@/hooks/useCountUp";
import { useFindings, useSystemDrive } from "@/hooks/useFindings";
import { findingHeld, pickHeld, pickIcon, useFreeUp } from "@/hooks/useFreeUp";
import { useFullAccess } from "@/hooks/useFullAccess";
import { useScan } from "@/hooks/useScan";
import { findingCopy } from "@/lib/findingCopy";
import { fmtBig, fmtGB, fmtSize } from "@/lib/format";
import { queries } from "@/lib/queries";
import { play } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { RouteId } from "@/routes";
import { useFindingView } from "@/stores/findingStore";
import { useFreeStore } from "@/stores/freeStore";
import { usePicks } from "@/stores/pickStore";
import { usePrefs } from "@/stores/prefsStore";
import { useScanStore } from "@/stores/scanStore";
import { defaultCleanable } from "@/views/developer/DeveloperView";

const RING = 2 * Math.PI * 51;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/** One line in the hero list: icon, words, size and a status on the right. */
interface Row {
  key: string;
  icon: IconName;
  name: string;
  hint: string;
  sizeBytes: number;
  held: boolean;
  safe: boolean;
  status: "on" | "off" | "pending" | "active" | "done";
  onToggle?: () => void;
  onSeeAll?: () => void;
}

function HeroRow({ row, index }: { row: Row; index: number }) {
  const idle = row.status === "on" || row.status === "off";
  return (
    <div
      className={cn(
        "animate-rise relative flex h-[52px] flex-none items-center gap-3.5 rounded-2xl pr-3 pl-2.5 transition-[opacity,background-color] duration-300",
        row.status === "off" ? "st-row-off opacity-70" : "st-row",
      )}
      style={delay(0.12 + index * 0.06)}
    >
      {row.onToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={row.status === "on"}
          aria-label={row.name}
          onClick={() => {
            play("tick");
            row.onToggle?.();
          }}
          className="absolute inset-0 cursor-pointer rounded-2xl"
        />
      )}
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-3.5">
        <div className="scale-[.86]">
          <IconTile icon={row.icon} tone={row.safe ? "safe" : "review"} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold">{row.name}</span>
          <span className="st-mut truncate text-[12.5px]">
            {row.hint} · {row.held ? "Restore for 30 days" : "Deleted for good"}
          </span>
        </div>
      </div>
      {idle && row.onSeeAll && (
        <button
          type="button"
          onClick={() => {
            play("tap");
            row.onSeeAll?.();
          }}
          className="st-mut relative cursor-pointer rounded-full px-2.5 py-1 text-[13px] font-semibold hover:bg-[var(--st-glass-hi)]"
        >
          See all ›
        </button>
      )}
      <span className="st-gain pointer-events-none text-[15px] font-bold tabular-nums">{fmtSize(row.sizeBytes)}</span>
      <span className="pointer-events-none flex size-6 flex-none items-center justify-center">
        {row.status === "done" || row.status === "on" ? (
          <span
            key={row.status}
            className="animate-check flex size-6 items-center justify-center rounded-full bg-teal text-white"
          >
            <CheckGlyph />
          </span>
        ) : row.status === "active" ? (
          <Spinner size={18} className="st-mut" />
        ) : row.status === "off" ? (
          <span className="size-[22px] rounded-full shadow-[inset_0_0_0_2px_var(--st-mut)] opacity-60" />
        ) : (
          <span className="size-2 rounded-full bg-current opacity-30" />
        )}
      </span>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** What Sift is still looking through, with live progress while it walks the disk. */
function Looking({ quick }: { quick: boolean }) {
  const { isFetching: scanning } = useScan();
  const progress = useScanStore((s) => s.progress);
  const pct = progress && progress.bytesExpected ? Math.min(0.97, progress.bytesChecked / progress.bytesExpected) : 0;
  const text = quick
    ? "Checking old installers, the Trash and caches…"
    : scanning
      ? `Looking for duplicate photos and old videos · ${(progress?.filesChecked ?? 0).toLocaleString()} checked`
      : "Comparing photos to find exact copies…";
  return (
    <div className="st-row-off flex flex-none flex-col justify-center gap-2 rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Spinner size={14} className="st-mut" />
        <span className="st-mut text-[13px] tabular-nums">{text}</span>
      </div>
      {!quick && scanning && (
        <div className="ml-[26px] h-1 overflow-hidden rounded-sm bg-[var(--st-row)]">
          <div
            className="h-full rounded-sm bg-teal transition-[width] duration-300"
            style={{ width: `${(pct * 100).toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SweepButton({
  phase,
  progress,
  disabled,
  onClick,
  label,
}: {
  phase: "idle" | "running" | "done";
  progress: number;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const running = phase === "running";
  return (
    <div className="absolute -bottom-11 left-1/2 z-10 -translate-x-1/2">
      {phase === "idle" && !disabled && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-teal-2"
          style={{ animation: "sift-halo 2.4s ease-out infinite" }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || running}
        aria-label={label}
        className={cn(
          "relative flex size-24 items-center justify-center rounded-full text-[17px] font-bold text-white transition-transform duration-500 ease-spring-bounce",
          disabled
            ? "cursor-default opacity-45"
            : running
              ? "cursor-default"
              : "cursor-pointer hover:scale-[1.07] active:scale-[.92]",
        )}
        style={{
          background: "radial-gradient(circle at 35% 28%, #8ff0d6, #2fb59a 45%, #167a67)",
          boxShadow: "0 18px 44px -10px rgba(31,138,118,.6), inset 0 2px 0 rgba(255,255,255,.4)",
        }}
      >
        <svg
          aria-hidden="true"
          width="108"
          height="108"
          viewBox="0 0 108 108"
          className="absolute -top-1.5 -left-1.5 -rotate-90"
        >
          <circle cx="54" cy="54" r="51" fill="none" stroke="rgba(31,138,118,.22)" strokeWidth="3" />
          <circle
            cx="54"
            cy="54"
            r="51"
            fill="none"
            stroke="#1f8a76"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - (phase === "done" ? 1 : running ? progress : 0))}
          />
        </svg>
        <span className="relative tabular-nums">
          {running ? `${Math.round(progress * 100)}%` : phase === "done" ? "Done" : "Sweep"}
        </span>
      </button>
    </div>
  );
}

function Tile({
  title,
  hue,
  glyph,
  value,
  sub,
  gain,
  index,
  onClick,
}: {
  title: string;
  hue: string;
  glyph: ReactNode;
  value: ReactNode;
  sub: string;
  gain?: boolean;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="st-glass animate-rise group relative flex min-h-[124px] cursor-pointer flex-col overflow-hidden rounded-[22px] p-[18px] text-left transition-transform duration-500 ease-spring-bounce hover:-translate-y-1 hover:scale-[1.015] active:scale-[.97]"
      style={{
        ...delay(0.3 + index * 0.07),
        backgroundImage: `linear-gradient(165deg, color-mix(in srgb, ${hue} var(--st-tint), transparent), transparent 85%)`,
      }}
    >
      <span className="st-mut text-sm font-semibold">{title}</span>
      <div
        aria-hidden="true"
        className="absolute -top-4 -right-4 transition-transform duration-500 ease-spring-bounce group-hover:-translate-y-1 group-hover:rotate-6"
      >
        {glyph}
      </div>
      <div className="flex-1" />
      <span className={cn("text-[26px] leading-tight font-extrabold tracking-[-0.01em]", gain && "st-gain")}>
        {value}
      </span>
      <span className="st-mut mt-0.5 text-[13px]">{sub}</span>
    </button>
  );
}

const blob = (from: string, to: string, shape: string): ReactNode => (
  <div
    className={shape}
    style={{
      background: `linear-gradient(140deg, ${from}, ${to})`,
      boxShadow: "inset 0 2px 0 rgba(255,255,255,.5), 0 14px 28px -8px rgba(0,0,0,.35)",
    }}
  />
);

export function HomeView({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { findings, picks, selected, selectedPicks, selectedBytes, isLoading, indexLoading, isSelected, toggle } =
    useFindings();
  const flip = usePicks((s) => s.flip);
  const { isFetching: scanning, isSuccess: scanned } = useScan();
  const looking = isLoading || indexLoading || scanning;
  const hasItems = findings.length + picks.length > 0;
  const { system } = useSystemDrive();
  const limited = useFullAccess() === false;
  const weeklyCheck = usePrefs((s) => s.weeklyCheck);
  const free = useFreeStore();
  // The ring is the disk. While a sweep runs or shows its result, it keeps the
  // disk as it was when the sweep started, so it doesn't jump when the drive
  // list refreshes underneath.
  const capacity = system?.capacityBytes ?? 0;
  const usedNow = capacity ? (system!.usedBytes / capacity) : 0;
  const usedAtStart = useRef(usedNow);
  if (free.sweep === "idle") usedAtStart.current = usedNow;
  const sweep = useFreeUp(onNavigate, { inPlace: true });
  const freedCount = useCountUp(free.sweep === "done" ? free.freedBytes : 0, 1100);

  const { data: dupes } = useQuery({ ...queries.duplicates, enabled: scanned });
  const { data: dev } = useQuery({ ...queries.dev, enabled: scanned });
  const { data: big } = useQuery({ ...queries.bigFiles, enabled: scanned });
  const { data: restore = [] } = useQuery(queries.restore);
  const dupeBytes = (dupes ?? []).reduce((s, g) => s + g.sizeBytes * (g.copies.length - 1), 0);
  const devBytes = dev ? defaultCleanable(dev) : 0;
  const held = restore.filter((e) => e.restorable).length;

  const go = (id: RouteId) => {
    play("tap");
    onNavigate(id);
  };
  const phase = free.sweep;

  // Rows: live findings while idle; the swept snapshot while running or done,
  // so they stay put after the findings refresh underneath.
  let rows: Row[];
  if (phase === "idle") {
    rows = [
      ...findings.map((f): Row => {
        const copy = findingCopy[f.kind];
        return {
          key: f.id,
          icon: copy.icon,
          name: copy.name,
          hint: f.safety === "safe" ? copy.short(f) : "Take a look first",
          sizeBytes: f.sizeBytes,
          held: findingHeld(f.kind),
          safe: f.safety === "safe",
          status: isSelected(f) ? "on" : "off",
          onToggle: () => toggle(f),
          onSeeAll: () => {
            useFindingView.getState().show(f.kind);
            onNavigate("finding");
          },
        };
      }),
      ...picks.map((p): Row => ({
        key: p.path,
        icon: pickIcon(p),
        name: p.name,
        hint: "Added from Explore",
        sizeBytes: p.sizeBytes,
        held: pickHeld(p),
        safe: true,
        status: p.on ? "on" : "off",
        onToggle: () => flip(p.path),
      })),
    ];
  } else {
    const reached = free.progress * free.totalBytes;
    let acc = 0;
    rows = free.items
      .map((it, i): Row => {
        const before = acc;
        acc += it.sizeBytes;
        const status =
          phase === "done" || free.progress >= 1 || reached >= acc - 1
            ? "done"
            : reached >= before
              ? "active"
              : "pending";
        return {
          key: `${i}-${it.name}`,
          icon: it.icon,
          name: it.name,
          hint: "",
          sizeBytes: it.sizeBytes,
          held: it.held,
          safe: true,
          status,
        };
      })
      .map((r) => ({
        ...r,
        hint: r.status === "done" ? "Cleared" : r.status === "active" ? "Clearing…" : "Waiting",
      }));
  }

  const chosen = [
    ...selected.map((f) => ({
      name: findingCopy[f.kind].name,
      held: findingHeld(f.kind),
      category: true,
    })),
    ...selectedPicks.map((p) => ({
      name: p.name,
      held: pickHeld(p),
      category: false,
    })),
  ];
  // "Trash and temporary files": category names after the first read as plain
  // words; picks keep the user's own file names.
  const forGoodNames = chosen
    .filter((c) => !c.held)
    .map((c, i) => (i > 0 && c.category ? c.name.toLowerCase() : c.name));
  const forGood = forGoodNames.length > 2 ? [`${forGoodNames.length} of these`] : forGoodNames;
  const current = rows.find((r) => r.status === "active") ?? rows[rows.length - 1];

  let eyebrow: string;
  let headline: string;
  let subline: string;
  if (phase === "running") {
    eyebrow = "Sweeping…";
    headline = `${fmtGB(free.progress * free.totalBytes)} of ${fmtGB(free.totalBytes)}`;
    subline = current ? `Clearing ${current.name.toLowerCase()}. You can keep using your computer.` : "";
  } else if (phase === "done") {
    const keptAll = free.items.every((i) => i.held);
    const keptNone = free.items.every((i) => !i.held);
    eyebrow = "All done";
    headline = `You got ${fmtGB(freedCount)} back`;
    subline = keptNone
      ? "Those were cleared for good. Apps rebuild what they need."
      : keptAll
        ? "Changed your mind? Everything is in Restore for the next 30 days."
        : "Changed your mind? What Sift moved is in Restore for 30 days. The rest was cleared for good.";
  } else if (!hasItems) {
    eyebrow = looking ? "Taking a look around" : "All clear";
    headline = looking ? "Taking a look around…" : "Nothing left to clear";
    subline = looking
      ? "This usually takes a few seconds."
      : `${weeklyCheck ? "Sift will check again on Sunday. " : ""}You can still look through Big files yourself.`;
  } else if (selectedBytes === 0) {
    eyebrow = "Quick sweep";
    headline = "Nothing selected yet";
    subline = "Tap an item to include it in the sweep.";
  } else {
    eyebrow = "Quick sweep";
    headline = `${fmtGB(selectedBytes)} ready to sweep`;
    subline =
      forGoodNames.length === 0
        ? "Everything goes to Restore first, so you can put it back for 30 days."
        : forGoodNames.length === chosen.length
          ? `${forGood.join(" and ")} ${forGoodNames.length === 1 ? "is" : "are"} deleted for good. Apps rebuild what they need.`
          : `${forGood.join(" and ")} ${forGoodNames.length === 1 ? "is" : "are"} deleted for good. The rest goes to Restore for 30 days.`;
  }

  // Anything deleted for good (Trash, temporary files, caches) needs a second
  // click; a sweep that only moves things to Restore starts straight away.
  const [confirming, setConfirming] = useState(false);
  const startSweep = () => {
    setConfirming(false);
    void sweep(selected, selectedPicks);
  };
  const onSweep = () => {
    if (phase === "done") {
      play("tap");
      useFreeStore.setState({ sweep: "idle" });
    } else if (phase === "idle") {
      if (forGoodNames.length > 0) {
        play("tap");
        setConfirming(true);
      } else startSweep();
    }
  };
  const showButton = phase !== "idle" || hasItems;

  return (
    <div className="absolute inset-0 overflow-auto">
      <div className="flex min-h-full flex-col gap-4 px-9 pt-7 pb-7">
        <div className="animate-rise flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="st-mut text-[15px]">{greeting()}</span>
            <span className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
              {system
                ? `Your ${system.name} has ${fmtBig(system.capacityBytes - system.usedBytes)} free`
                : "Welcome back"}
            </span>
          </div>
          {phase === "idle" && hasItems && (
            <button
              type="button"
              onClick={() => go("review")}
              className="st-glass flex-none cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-400 ease-spring-bounce hover:-translate-y-0.5 active:scale-95"
            >
              Review everything ›
            </button>
          )}
        </div>

        {limited && (
          <div className="animate-rise flex items-center justify-between gap-4 rounded-[18px] bg-sand py-3 pr-3 pl-5">
            <span className="text-[15px] leading-[1.4] font-semibold text-sandtx">
              Some private folders are hidden from Sift, so there may be more space to find.
            </span>
            <button
              type="button"
              onClick={() => {
                play("tap");
                usePrefs.getState().setOnboarding({ step: "access", mode: "permission" });
              }}
              className="flex-none cursor-pointer rounded-full bg-ink px-[18px] py-2.5 text-sm font-semibold whitespace-nowrap text-surface transition-transform duration-400 ease-spring-bounce active:scale-95"
            >
              Allow full access
            </button>
          </div>
        )}

        <section
          className={cn(
            "st-glass animate-rise relative flex min-h-[300px] flex-none flex-col rounded-[26px] px-8 pt-6",
            showButton ? "mb-10 pb-12" : "pb-7",
          )}
          style={delay(0.05)}
        >
          {capacity > 0 && (
            <div className="absolute top-1/2 right-10 flex -translate-y-[56%] flex-col items-center gap-2">
              <DriveRing
                size={232}
                mode="drive"
                className="animate-rise [animation-delay:.12s]"
                used={phase === "idle" ? usedNow : usedAtStart.current}
                freeable={(phase === "idle" ? selectedBytes : free.totalBytes) / capacity}
                progress={phase === "idle" ? 0 : free.progress}
                working={phase === "running" || (looking && phase === "idle")}
                done={phase === "done"}
                capacityBytes={capacity}
              />
              <span className="st-mut pointer-events-none text-[13px] font-semibold tabular-nums">
                {phase === "idle"
                  ? `${Math.round(usedNow * 100)}% full`
                  : `${Math.round((usedAtStart.current - (free.totalBytes * free.progress) / capacity) * 100)}% full`}
              </span>
            </div>
          )}
          <div className="relative flex max-w-[560px] flex-col gap-1">
            <span className="st-mut text-[13px] font-semibold tracking-[.06em] uppercase">{eyebrow}</span>
            <h1 className="text-[34px] leading-[1.1] font-extrabold tracking-[-0.02em] tabular-nums">{headline}</h1>
            <p className="st-mut text-[15px] leading-[1.45] text-pretty">{subline}</p>
          </div>

          {(rows.length > 0 || (looking && phase === "idle")) && (
            <div className="relative mt-4 flex max-h-[232px] w-[560px] max-w-full flex-col gap-1.5 overflow-auto pr-1">
              {rows.map((r, i) => (
                <HeroRow key={r.key} row={r} index={i} />
              ))}
              {phase === "idle" && looking && <Looking quick={isLoading} />}
            </div>
          )}

          {phase === "done" && (
            <button
              type="button"
              onClick={() => go("restore")}
              className="st-glass animate-rise relative mt-5 cursor-pointer self-start rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-400 ease-spring-bounce hover:-translate-y-0.5 active:scale-95"
              style={delay(0.2)}
            >
              See what was removed
            </button>
          )}

          {confirming && phase === "idle" && (
            <div className="absolute inset-x-4 -bottom-9 z-10 flex justify-center">
              <div
                role="alertdialog"
                aria-labelledby="sweep-confirm-text"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setConfirming(false);
                }}
                className="st-glass animate-rise flex w-[620px] max-w-full items-center gap-4 rounded-[22px] py-3.5 pr-3.5 pl-5"
                style={{ backgroundColor: "var(--st-glass-hi)" }}
              >
                <span id="sweep-confirm-text" className="flex-1 text-[14px] leading-[1.4] font-semibold text-pretty">
                  {forGood.join(" and ")} {forGoodNames.length === 1 ? "is" : "are"} deleted for good and can't be put
                  back.
                  {forGoodNames.length < chosen.length && (
                    <span className="st-mut font-normal"> The rest goes to Restore.</span>
                  )}
                </span>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    play("tap");
                    setConfirming(false);
                  }}
                  className="flex-none cursor-pointer rounded-full px-3.5 py-2 text-sm font-semibold transition-transform duration-400 ease-spring-bounce hover:bg-[var(--st-row)] active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={startSweep}
                  className="flex-none cursor-pointer rounded-full bg-ink px-4 py-2 text-sm font-semibold whitespace-nowrap text-surface transition-transform duration-400 ease-spring-bounce hover:scale-[1.03] active:scale-95"
                >
                  Delete for good and sweep
                </button>
              </div>
            </div>
          )}

          {showButton && !(confirming && phase === "idle") && (
            <SweepButton
              phase={phase}
              progress={free.progress}
              disabled={phase === "idle" && selectedBytes === 0}
              onClick={onSweep}
              label={
                phase === "running"
                  ? `Sweeping, ${Math.round(free.progress * 100)}%`
                  : phase === "done"
                    ? "Done"
                    : `Sweep ${fmtGB(selectedBytes)}`
              }
            />
          )}
        </section>

        <div className="grid grid-cols-4 gap-3.5">
          <Tile
            index={0}
            title="Duplicates"
            hue="#5a68d8"
            glyph={blob("#9aa8ff", "#4b55c9", "size-[92px] rotate-[18deg] rounded-[28px]")}
            value={!scanned ? <Spinner size={18} className="st-mut" /> : dupeBytes > 0 ? fmtGB(dupeBytes) : "None"}
            sub={dupeBytes > 0 ? `in ${dupes?.length ?? 0} sets of copies` : "No copies found"}
            gain={dupeBytes > 0}
            onClick={() => go("duplicates")}
          />
          <Tile
            index={1}
            title="Developer"
            hue="#4f7891"
            glyph={blob("#d6e6f2", "#3f5a6d", "size-[84px] rounded-full")}
            value={!scanned ? <Spinner size={18} className="st-mut" /> : devBytes > 0 ? fmtGB(devBytes) : "None"}
            sub={devBytes > 0 ? "of build output tools rebuild" : "No old build output"}
            gain={devBytes > 0}
            onClick={() => go("developer")}
          />
          <Tile
            index={2}
            title="Big files"
            hue="#8a4fc7"
            glyph={blob("#d3b5ff", "#7a4fd6", "size-[88px] -rotate-[10deg] rounded-[24px]")}
            value={!scanned ? <Spinner size={18} className="st-mut" /> : (big?.length ?? 0).toLocaleString()}
            sub="large files worth a look"
            onClick={() => go("big-files")}
          />
          <Tile
            index={3}
            title="Restore"
            hue="#c48a3a"
            glyph={blob("#ffd99a", "#d39a45", "size-[88px] -rotate-[14deg] rounded-[28px]")}
            value={held > 0 ? `${held} held` : "Empty"}
            sub={held > 0 ? "safe for 30 days" : "Nothing to put back"}
            onClick={() => go("restore")}
          />
        </div>
      </div>
    </div>
  );
}
