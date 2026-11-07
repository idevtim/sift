import { cn } from "@/lib/utils";

/** 48×28 switch. Purely visual — the row it sits in owns the click. */
export function Toggle({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "box-border h-7 w-12 flex-none rounded-[14px] p-[3px] transition-colors duration-250",
        on ? "bg-teal" : "bg-line2",
      )}
    >
      <div
        className={cn(
          "size-[22px] rounded-full bg-white shadow-knob transition-transform duration-250 ease-spring",
          on && "translate-x-5",
        )}
      />
    </div>
  );
}
