import type { Safety } from "@/types/api";
import { Icon, type IconName } from "./Icon";
import { cn } from "@/lib/utils";

const tones = {
  safe: "bg-mint text-tealtx",
  review: "bg-sand text-sandtx",
  neutral: "bg-panel text-mut2",
};

/** 44px rounded tile holding a line icon, tinted by safety. */
export function IconTile({ icon, tone }: { icon: IconName; tone: Safety | "neutral" }) {
  return (
    <div className={cn("flex size-11 flex-none items-center justify-center rounded-[14px]", tones[tone])}>
      <Icon name={icon} />
    </div>
  );
}
