import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  safe: "bg-mint text-tealtx",
  review: "bg-sand text-sandtx",
  neutral: "bg-surface text-mut2",
};

export function Pill({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cn("rounded-full px-[9px] py-[3px] text-xs font-semibold whitespace-nowrap", tones[tone])}>
      {children}
    </span>
  );
}
