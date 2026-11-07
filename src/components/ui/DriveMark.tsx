import { cn } from "@/lib/utils";

/**
 * The "sifted drive": off-white body with a mint lip, three bars of
 * decreasing width and a status dot. Drawn at its 128×100 master size —
 * scale it with `zoom` (sidebar logo, scan overlay, Done screen).
 *
 * `pulse`: bars breathe (scanning). `drop`: bars fall into place once (Done).
 */
export function DriveMark({ pulse = false, drop = false, className }: { pulse?: boolean; drop?: boolean; className?: string }) {
  const bar = "h-[9px] rounded-[5px] origin-left";
  const anim = pulse
    ? "animate-sift-pulse"
    : drop
      ? "animate-[sift-drop_.6s_cubic-bezier(.2,.8,.2,1)_.1s_both]"
      : "";
  const [d2, d3] = drop ? ["[animation-delay:.22s]", "[animation-delay:.34s]"] : ["[animation-delay:.15s]", "[animation-delay:.3s]"];
  return (
    <div
      className={cn(
        "relative box-border flex h-[100px] w-32 flex-col gap-[7px] rounded-3xl bg-surface px-5 py-[22px] shadow-[inset_0_-12px_0_var(--mint)]",
        className,
      )}
    >
      <div className={cn(bar, anim, "w-[72px] bg-teal")} />
      <div className={cn(bar, anim, "w-[50px] bg-teal-2", d2)} />
      <div className={cn(bar, anim, "w-[26px] bg-teal-3", d3)} />
      <div className="absolute right-5 bottom-[22px] size-[11px] rounded-[6px] bg-teal" />
    </div>
  );
}

/** App icon: teal tile (radius 48/180) around the drive mark. */
export function AppMark({ size, drop, pulse }: { size: number; drop?: boolean; pulse?: boolean }) {
  return (
    <div className="flex-none" style={{ width: size, height: size }}>
      <div
        className="flex size-[180px] items-center justify-center rounded-[48px] bg-teal"
        style={{ zoom: size / 180 }}
      >
        <DriveMark drop={drop} pulse={pulse} />
      </div>
    </div>
  );
}
