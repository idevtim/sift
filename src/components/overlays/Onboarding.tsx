import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppMark } from "@/components/ui/DriveMark";
import { Toggle } from "@/components/ui/Toggle";
import { useFullAccess } from "@/hooks/useFullAccess";
import { deviceName, usePlatform } from "@/hooks/usePlatform";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { play } from "@/lib/sound";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { usePrefs, type OnboardingStep, type ThemePref } from "@/stores/prefsStore";
import { useScanStore } from "@/stores/scanStore";

/** Windows and Linux have no permission to ask for, so they skip that step. */
const STEPS: OnboardingStep[] = ["welcome", "how", "access", "prefs", "ready"];

const PROMISES = ["Plain-English answers", "Nothing removed without your OK", "Undo for 30 days"];

const HIDDEN = [
  ["Mail & Messages", "M"],
  ["Other apps' data", "A"],
  ["Safari & downloads history", "S"],
  ["Time Machine snapshots", "T"],
] as const;

const LOOKS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

const enter = "animate-rise";
/** Frosted card on the stage. */
const glass = "bg-glass ring-1 ring-[var(--st-edge)] ring-inset shadow-[var(--st-shadow)]";

/**
 * First-launch onboarding: welcome → how it works → Full Disk Access (macOS)
 * → preferences → first scan. Covers the whole window. In `permission` mode
 * (Home's "Allow full access") it's just the access step, without dots or Back.
 */
export function Onboarding() {
  const { onboarding, setOnboarding } = usePrefs();
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const dragRef = useRef<HTMLDivElement>(null);
  useWindowDrag(dragRef);

  const steps = platform === "macos" ? STEPS : STEPS.filter((s) => s !== "access");
  const perm = onboarding.mode === "permission";
  const idx = Math.max(0, steps.indexOf(onboarding.step as OnboardingStep));
  const step = steps[idx];
  const device = deviceName(platform);

  const granted = useFullAccess(step === "access");
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const access = granted ? "granted" : pending ? "pending" : "none";

  // Chime the moment access turns on.
  const wasGranted = useRef(granted);
  useEffect(() => {
    if (wasGranted.current === false && granted && step === "access") play("chime");
    wasGranted.current = granted;
  }, [granted, step]);

  // Back from System Settings without access: macOS wants a fresh process.
  useEffect(() => {
    if (!asked || step !== "access") return;
    const onFocus = async () => {
      const ok = await queryClient.fetchQuery({ queryKey: ["full-access"], queryFn: api.fullAccess, staleTime: 0 });
      if (!ok) setPending(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [asked, step, queryClient]);

  const go = (n: number) => {
    play("tap");
    setOnboarding({ step: steps[n], mode: "setup" });
  };

  /** Close onboarding; `scan` replays the first-scan overlay with a fresh scan. */
  const finish = (scan: boolean) => {
    setOnboarding({ step: "done", mode: "setup" });
    if (!scan) return;
    useScanStore.setState({ overlay: true, startedAt: Date.now(), progress: null });
    for (const key of ["scan", "findings"]) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const openSettings = () => {
    play("open");
    setAsked(true);
    void api.openFullAccessSettings();
  };
  const skip = () => {
    play("tap");
    if (perm) finish(false);
    else go(idx + 1);
  };
  const relaunch = () => {
    setRelaunching(true);
    // Let "Reopening Sift…" show before the window goes away.
    setTimeout(() => {
      void api.relaunch().then(() => {
        setRelaunching(false);
        setPending(false);
      });
    }, 900);
  };

  let primary: [string, () => void];
  let secondary: [string, () => void] | null = null;
  if (step === "welcome") primary = ["Get started", () => go(idx + 1)];
  else if (step === "access") {
    if (access === "granted") primary = perm ? ["Done", () => finish(true)] : ["Continue", () => go(idx + 1)];
    else if (access === "pending") {
      primary = ["Reopen Sift", relaunch];
      secondary = ["Later", skip];
    } else {
      primary = ["Open System Settings", openSettings];
      secondary = ["Not now", skip];
    }
  } else if (step === "ready") primary = ["Start first scan", () => {
    play("tap");
    finish(true);
  }];
  else primary = ["Continue", () => go(idx + 1)];

  return (
    <div className="stage absolute inset-0 z-[35] flex animate-[sift-fade_.3s_ease_both] flex-col overflow-hidden text-ink">
      {/* Soft glows drifting behind every step. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -right-32 size-[520px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, #5fd3b8, transparent 65%)", animation: "sift-float 12s ease-in-out infinite" }}
        />
        <div
          className="absolute -bottom-48 -left-40 size-[560px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #7cb4ff, transparent 65%)", animation: "sift-float 15s ease-in-out -4s infinite" }}
        />
      </div>
      <div ref={dragRef} className="relative flex items-center justify-between px-7 py-5">
        <div className="w-[52px]" />
        <div className={cn("flex items-center gap-1.5", perm && "opacity-0")}>
          {steps.map((s, i) => (
            <div
              key={s}
              className="h-2 rounded transition-[width,background-color] duration-600 ease-spring"
              style={{ width: i === idx ? 32 : 8, background: i <= idx ? "#1F8A76" : "var(--line2)" }}
            />
          ))}
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-[72px]">
        {step === "welcome" && <Welcome device={device} />}
        {step === "how" && <HowItWorks />}
        {step === "access" && <Access access={access} device={device} />}
        {step === "prefs" && <Prefs />}
        {step === "ready" && <Ready device={device} limited={granted === false} />}
      </div>

      <div className="relative flex items-center justify-between px-10 pt-5 pb-8">
        <div className="min-w-20">
          {!perm && idx > 0 && (
            <button
              type="button"
              onClick={() => go(idx - 1)}
              className="cursor-pointer rounded-full px-3 py-3 text-[15px] font-semibold text-mut transition-[color,background-color,transform] duration-400 ease-spring hover:bg-glass-hi hover:text-ink active:scale-95"
            >
              ‹ Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {secondary && (
            <button
              type="button"
              onClick={secondary[1]}
              className="cursor-pointer rounded-full px-[22px] py-[15px] text-base font-semibold text-mut2 transition-[background-color,transform] duration-400 ease-spring hover:bg-glass-hi active:scale-95"
            >
              {secondary[0]}
            </button>
          )}
          <button
            key={primary[0]}
            type="button"
            onClick={primary[1]}
            className="min-w-[120px] animate-rise cursor-pointer rounded-full bg-teal px-7 py-[15px] text-center text-base font-semibold text-white shadow-[0_14px_30px_-12px_rgba(31,138,118,.7)] transition-[background-color,transform] duration-500 ease-spring hover:scale-[1.04] hover:bg-teal-hover active:scale-95"
          >
            {primary[0]}
          </button>
        </div>
      </div>

      {relaunching && (
        <div className="stage absolute inset-0 z-10 flex animate-[sift-fade_.25s_ease_both] flex-col items-center justify-center gap-[22px]">
          <AppMark size={90} drop />
          <span className="text-xl font-semibold text-mut">Reopening Sift…</span>
        </div>
      )}
    </div>
  );
}

/** The app icon, popping in and then floating gently. */
function Icon({ size }: { size: number }) {
  return (
    <div className="animate-check" style={{ animationDuration: ".8s" }}>
      <div
        className="rounded-[27%] shadow-[0_26px_50px_-20px_rgba(23,112,95,.65)]"
        style={{ animation: "sift-float 6s ease-in-out .8s infinite" }}
      >
        <AppMark size={size} drop />
      </div>
    </div>
  );
}

function Welcome({ device }: { device: string }) {
  return (
    <div className={cn("flex max-w-[640px] flex-col items-center gap-7 text-center", enter)}>
      <Icon size={130} />
      <div className="flex flex-col items-center gap-3.5">
        <h1 className="text-[56px] leading-none font-extrabold tracking-[-0.04em]">Welcome to Sift</h1>
        <p className="text-[19px] leading-normal text-pretty text-mut">
          Find out what's filling up your {device} and get space back, without worrying about deleting the wrong thing.
        </p>
      </div>
      <div className="stagger flex flex-wrap justify-center gap-2.5">
        {PROMISES.map((p) => (
          <div key={p} className={cn("flex items-center gap-2 rounded-full px-3.5 py-[9px] text-sm font-semibold", glass)}>
            <div className="flex size-[18px] items-center justify-center rounded-full bg-teal text-[11px] text-white">✓</div>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

function HowCard({ n, title, body, delay, children }: { n: number; title: string; body: string; delay: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[24px] p-6 transition-transform duration-500 ease-spring hover:-translate-y-1.5",
        glass,
        enter,
      )}
      style={{ animationDelay: delay }}
    >
      <div className="h-[84px] rounded-2xl bg-glass-hi px-[18px] ring-1 ring-[var(--st-edge)] ring-inset">{children}</div>
      <div className="flex flex-col gap-1.5">
        <span className="flex size-6 items-center justify-center rounded-full bg-teal text-[13px] font-bold text-white">{n}</span>
        <span className="text-[19px] font-bold">{title}</span>
        <span className="text-[15px] leading-normal text-mut">{body}</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  const bar = "h-[9px] origin-left animate-[sift-pulse_1.6s_ease-in-out_infinite] rounded-[5px]";
  return (
    <div className={cn("flex w-full max-w-[920px] flex-col gap-8", enter)}>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[44px] font-extrabold tracking-[-0.03em]">Here's how it works</h1>
        <p className="text-lg text-mut">Three steps, and you're in charge of every one.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <HowCard
          n={1}
          title="Sift looks around"
          body="It measures your folders. It only reads names and sizes, never what's inside your files."
          delay=".05s"
        >
          <div className="flex h-full flex-col justify-center gap-[7px]">
            <div className={cn(bar, "w-4/5 bg-ink")} />
            <div className={cn(bar, "w-[55%] bg-teal [animation-delay:.2s]")} />
            <div className={cn(bar, "w-[30%] bg-stone [animation-delay:.4s]")} />
          </div>
        </HowCard>
        <HowCard
          n={2}
          title="You decide"
          body="Sift suggests what's safe and explains each item. Nothing is removed without your OK."
          delay=".15s"
        >
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Old installers</span>
              <span className="text-xs font-semibold text-tealtx">Safe to remove</span>
            </div>
            <Toggle on />
          </div>
        </HowCard>
        <HowCard
          n={3}
          title="Change your mind"
          body="Removed things wait in Restore for 30 days, so you can bring anything back."
          delay=".25s"
        >
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Vacation video</span>
              <span className="text-xs text-mut">Kept for 28 more days</span>
            </div>
            <div className="rounded-full bg-ink px-3 py-[7px] text-[13px] font-semibold text-surface">Restore</div>
          </div>
        </HowCard>
      </div>
    </div>
  );
}

function Access({ access, device }: { access: "none" | "pending" | "granted"; device: string }) {
  const granted = access === "granted";
  const promises = [
    "Sift only reads names and sizes, never what's inside your files.",
    `Nothing leaves your ${device}. No accounts, no uploads.`,
    "You can turn this off any time in System Settings.",
  ];
  return (
    <div className={cn("grid w-full max-w-[960px] grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-12", enter)}>
      <div className="flex flex-col gap-5">
        <span className="text-xs font-bold tracking-[0.08em] text-teal">ONE PERMISSION</span>
        <h1 className="text-[42px] leading-[1.05] font-extrabold tracking-[-0.03em]">Let Sift see your whole Mac</h1>
        <p className="text-[17px] leading-[1.55] text-pretty text-mut">
          macOS keeps some folders private, like Mail, Messages and other apps' data. Without access, Sift can't see what's
          filling them up, and that's often where the most space is hiding.
        </p>
        <div className="flex flex-col gap-2.5">
          {promises.map((p) => (
            <div key={p} className="flex items-start gap-2.5 text-[15px] leading-[1.45]">
              <div className="mt-px flex size-5 flex-none items-center justify-center rounded-full bg-mint text-[11px] font-bold text-tealtx">✓</div>
              <span>{p}</span>
            </div>
          ))}
        </div>
        {access === "none" && (
          <div className="flex flex-wrap gap-2">
            {["Open System Settings", "Turn on Sift", "Choose Quit & Reopen"].map((t, i) => (
              <div key={t} className="flex items-center gap-2 rounded-xl bg-glass-hi px-3 py-2 text-[13px] font-semibold ring-1 ring-[var(--st-edge)] ring-inset">
                <span className="text-teal">{i + 1}</span>
                {t}
              </div>
            ))}
          </div>
        )}
        {granted && (
          <div className="flex animate-rise items-center gap-2.5 rounded-2xl bg-mint px-[18px] py-3.5 text-base font-bold text-tealtx">
            <div className="flex size-[22px] items-center justify-center rounded-full bg-teal text-xs text-white">✓</div>
            Full access is on. Thanks!
          </div>
        )}
        {access === "pending" && (
          <div className="animate-rise rounded-2xl bg-sand px-[18px] py-3.5 text-[15px] font-semibold text-sandtx">
            Almost there. Sift needs to reopen before the change takes effect.
          </div>
        )}
      </div>

      <div className={cn("flex flex-col gap-[18px] rounded-[28px] p-[26px] [animation-delay:.1s]", glass, enter)}>
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold">What Sift can see</span>
          <span className={cn("text-[32px] font-extrabold tracking-[-0.03em] tabular-nums", granted ? "text-teal" : "text-ink")}>
            {granted ? "100%" : "71%"}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-md bg-row">
          <div
            className="h-full rounded-md bg-teal transition-[width] duration-1000 ease-spring"
            style={{ width: granted ? "100%" : "71%" }}
          />
        </div>
        <div className="stagger flex flex-col gap-1.5">
          {HIDDEN.map(([name, glyph]) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-[14px] bg-glass-hi px-3.5 py-[11px] transition-opacity duration-400"
              style={{ opacity: granted ? 1 : 0.75 }}
            >
              <div
                key={granted ? "on" : "off"}
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-[9px] text-[13px] font-bold transition-colors duration-400",
                  granted && "animate-check",
                  granted ? "bg-teal text-white" : "bg-line text-mut",
                )}
              >
                {granted ? "✓" : glyph}
              </div>
              <span className="flex-1 text-[15px] font-semibold">{name}</span>
              <span className="text-[13px] text-mut">{granted ? "Visible" : "Hidden"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrefRow({ label, desc, onClick, children }: { label: string; desc: string; onClick?: () => void; children: ReactNode }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-4 rounded-[20px] bg-glass px-5 py-4 text-left ring-1 ring-[var(--st-edge)] ring-inset",
        onClick && "cursor-pointer transition-[background-color,transform] duration-400 ease-spring hover:bg-glass-hi active:scale-[.99]",
      )}
    >
      <div className="flex flex-col gap-[3px]">
        <span className="text-[17px] font-semibold">{label}</span>
        <span className="text-sm leading-[1.45] text-mut">{desc}</span>
      </div>
      {children}
    </Tag>
  );
}

function Prefs() {
  const { theme, setTheme, soundOn, toggleSound, weeklyCheck, powerToolsOpen, togglePowerTools } = usePrefs();
  const toggle = (fn: () => void) => () => {
    fn();
    play("tick");
  };
  return (
    <div className={cn("flex w-full max-w-[680px] flex-col gap-[26px]", enter)}>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[44px] font-extrabold tracking-[-0.03em]">Make it yours</h1>
        <p className="text-lg text-mut">You can change any of these later.</p>
      </div>
      <div className="stagger flex flex-col gap-2">
        <PrefRow label="Appearance" desc="Light, dark, or follow your system.">
          <div className="flex flex-none gap-0.5 rounded-xl bg-row p-[3px]">
            {LOOKS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => {
                  play("tap");
                  setTheme(l.value);
                }}
                className={cn(
                  "cursor-pointer rounded-[9px] px-3.5 py-2 text-sm transition-[background-color,transform] duration-400 ease-spring active:scale-95",
                  theme === l.value ? "bg-glass-hi font-semibold shadow-[0_1px_3px_rgba(34,38,43,.12)]" : "font-medium",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </PrefRow>
        <PrefRow label="Soft sounds" desc="Gentle clicks, and a chime when something's done." onClick={toggle(toggleSound)}>
          <Toggle on={soundOn} />
        </PrefRow>
        <PrefRow
          label="Weekly check-up"
          desc="Sift looks every Sunday and lets you know if there's space to free. It never removes anything on its own."
          onClick={toggle(() => usePrefs.setState({ weeklyCheck: !weeklyCheck }))}
        >
          <Toggle on={weeklyCheck} />
        </PrefRow>
        <PrefRow
          label="Show Power tools"
          desc="Extra pages for a closer look: Explore, Duplicates, Apps and Developer."
          onClick={toggle(togglePowerTools)}
        >
          <Toggle on={powerToolsOpen} />
        </PrefRow>
      </div>
    </div>
  );
}

function Ready({ device, limited }: { device: string; limited: boolean }) {
  return (
    <div className={cn("flex max-w-[620px] flex-col items-center gap-[26px] text-center", enter)}>
      <Icon size={108} />
      <div className="flex flex-col items-center gap-3.5">
        <h1 className="text-[52px] leading-none font-extrabold tracking-[-0.04em]">You're all set</h1>
        <p className="text-lg leading-normal text-pretty text-mut">
          {limited
            ? "Sift will skip private folders for now. You can allow full access from Home any time."
            : `Sift is ready to look around your whole ${device}. The first scan takes about a minute, and nothing is changed while it runs.`}
        </p>
      </div>
    </div>
  );
}
