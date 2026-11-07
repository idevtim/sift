import installer from "@/assets/icons/installer.svg?url";
import trash from "@/assets/icons/trash.svg?url";
import leftovers from "@/assets/icons/leftovers.svg?url";
import temp from "@/assets/icons/temp.svg?url";
import dupes from "@/assets/icons/dupes.svg?url";
import video from "@/assets/icons/video.svg?url";
import photo from "@/assets/icons/photo.svg?url";
import album from "@/assets/icons/album.svg?url";
import doc from "@/assets/icons/doc.svg?url";
import music from "@/assets/icons/music.svg?url";
import play from "@/assets/icons/play.svg?url";
import { cn } from "@/lib/utils";

const urls = { installer, trash, leftovers, temp, dupes, video, photo, album, doc, music, play };

export type IconName = keyof typeof urls;

/** 24px line icon, painted in `currentColor` via a CSS mask. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const mask = `url("${urls[name]}") center / contain no-repeat`;
  return (
    <span
      aria-hidden
      className={cn("block size-6 bg-current", className)}
      style={{ mask, WebkitMask: mask }}
    />
  );
}
