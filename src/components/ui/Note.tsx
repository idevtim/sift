import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline banner: mint for good news / protected, sand for "take a look". */
export function Note({ tone = "mint", children }: { tone?: "mint" | "sand"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "animate-[sift-in_.4s_ease_both] self-start rounded-[14px] px-[18px] py-3.5 text-[15px] font-semibold",
        tone === "mint" ? "bg-mint text-tealtx" : "bg-sand text-sandtx",
      )}
    >
      {children}
    </div>
  );
}
