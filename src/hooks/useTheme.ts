import { useEffect } from "react";
import { usePrefs, type ThemePref } from "@/stores/prefsStore";

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Writes the resolved theme to <html data-theme> and follows the OS while on "system". */
export function useTheme() {
  const pref = usePrefs((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(pref);
    };
    apply();
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
}
