import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex gap-0.5 rounded-xl bg-row p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "cursor-pointer rounded-[9px] px-3 py-[7px] text-[13px] transition-[background-color,transform] duration-400 ease-spring active:scale-95",
            o.value === value ? "bg-glass-hi font-semibold shadow-[0_1px_3px_rgba(34,38,43,.12)]" : "font-medium",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
