import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import type { IconName } from "@/components/ui/Icon";
import { Icon } from "@/components/ui/Icon";
import { queries } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/types/api";
import { typeOf } from "./dupes";

/** A steady hue per set, from its content hash. */
function hues(hash: string): [number, number] {
  let n = 0;
  for (const ch of hash) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return [n, (n + 50) % 360];
}

/** The drawn tile used until (or instead of) a real preview. */
function tile(g: DuplicateGroup): { style: CSSProperties; icon?: IconName; iconClass?: string } {
  const [h, h2] = hues(g.hash);
  const land = `radial-gradient(circle at 72% 30%, oklch(0.96 0.05 ${h}) 0 8%, transparent 8.5%), linear-gradient(to top, oklch(0.42 0.06 ${h2}) 0 28%, transparent 28%), linear-gradient(to top, oklch(0.56 0.07 ${h2}) 0 44%, transparent 44%), linear-gradient(170deg, oklch(0.87 0.06 ${h}) 0%, oklch(0.72 0.08 ${h2}) 100%)`;
  switch (typeOf(g)) {
    case "photo":
      return { style: { background: land } };
    case "video":
      return { style: { background: land }, icon: "play", iconClass: "text-white opacity-95" };
    case "audio":
      return {
        style: { background: `linear-gradient(135deg, oklch(0.6 0.11 ${h}), oklch(0.36 0.07 ${h2}))` },
        icon: "music",
        iconClass: "text-white opacity-90",
      };
    case "document":
      return {
        style: {
          background:
            "linear-gradient(#3A3F45,#3A3F45) 20% 16% / 42% 5% no-repeat, repeating-linear-gradient(to bottom, transparent 0 9px, #DCD7CE 9px 11px) 20% 34% / 60% 54% no-repeat, #FFFFFF",
        },
      };
    default:
      return { style: { background: "var(--line)" }, icon: "installer", iconClass: "text-mut2" };
  }
}

/**
 * A set's preview: Quick Look's thumbnail when there is one (fetched only
 * for what's on screen, cached by content hash), else a drawn tile.
 */
export function Preview({
  group,
  big,
  className,
  children,
}: {
  group: DuplicateGroup;
  /** Card size (38px glyph); the list's 40px thumb otherwise. */
  big?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const kind = typeOf(group);
  const { data: src } = useQuery({ ...queries.duplicatePreview(group.hash), enabled: kind !== "other" });
  const drawn = tile(group);
  const glyph = src ? (kind === "video" ? "play" : undefined) : drawn.icon;
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden", className)} style={src ? undefined : drawn.style}>
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 size-full animate-[sift-fade_.3s_ease_both]",
            kind === "document" ? "bg-line object-contain" : "object-cover",
          )}
        />
      )}
      {glyph && (
        <Icon
          name={glyph}
          className={cn(
            "relative",
            big ? "size-[38px]" : "size-4",
            src ? "text-white drop-shadow-[0_1px_4px_rgba(0,0,0,.45)]" : drawn.iconClass,
          )}
        />
      )}
      {children}
    </div>
  );
}
