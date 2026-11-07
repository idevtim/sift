// Everyday-screen copy per finding kind. Plain words only — no paths or
// extensions here (those belong in Power tools).

import type { Finding, FindingKind } from "@/types/api";
import type { IconName } from "@/components/ui/Icon";

interface Copy {
  name: string;
  icon: IconName;
  short: (f: Finding) => string;
  why: (f: Finding) => string;
}

const trashNoun = () =>
  navigator.userAgent.toLowerCase().includes("win") ? "Recycle Bin" : "Trash";

export const findingCopy: Record<FindingKind, Copy> = {
  oldInstallers: {
    name: "Old installers",
    icon: "installer",
    short: () => "Setup files you no longer need",
    why: () => "Leftover setup files for apps you've already installed.",
  },
  trash: {
    name: trashNoun(),
    icon: "trash",
    short: () => "Already deleted",
    why: () => `You've already deleted these. Emptying the ${trashNoun()} removes them for good.`,
  },
  appLeftovers: {
    name: "App leftovers",
    icon: "leftovers",
    short: () => "From apps you removed",
    why: (f) => `Settings and caches left behind by ${f.itemCount} apps you uninstalled.`,
  },
  tempFiles: {
    name: "Temporary files",
    icon: "temp",
    short: () => "Apps recreate these",
    why: () =>
      "Caches that apps rebuild when they need them, so Sift clears these right away. Some apps may open a little slower the first time.",
  },
  duplicatePhotos: {
    name: "Duplicate photos",
    icon: "dupes",
    short: (f) => `${f.itemCount.toLocaleString()} exact copies`,
    why: () => "Exact copies of photos you already have. Check them first, then we'll keep the originals.",
  },
  largeOldVideos: {
    name: "Large old videos",
    icon: "video",
    short: () => "Not opened in a year",
    why: () => "Videos you haven't opened in over a year. Only you know if you still need them.",
  },
};
