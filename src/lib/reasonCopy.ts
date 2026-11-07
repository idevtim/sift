import type { Reason } from "@/types/api";

/** Plain-words explanation for a tile Sift has an opinion about. */
export function reasonDesc(reason: Reason, device: string): string {
  switch (reason) {
    case "system":
      return `Needed to run your ${device}. Sift never touches it.`;
    case "cache":
      return "Temporary files that apps recreate when they need them.";
    case "trash":
      return "Already deleted. Emptying it removes these for good.";
    case "installer":
      return "A setup file for an app you've already installed.";
    case "nodeModules":
      return "Installed packages. npm install brings them back.";
    case "rustTarget":
      return "Compiled output. cargo build recreates it.";
    case "derivedData":
      return "Xcode build cache. It rebuilds automatically.";
  }
}

export const isFreeable = (reason: Reason | null): reason is Exclude<Reason, "system"> =>
  reason !== null && reason !== "system";
