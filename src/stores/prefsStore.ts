import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "light" | "dark";

export type OnboardingStep = "welcome" | "how" | "access" | "prefs" | "ready";

/**
 * Where onboarding is. Kept across launches so "Reopen Sift" (macOS applies
 * Full Disk Access to a fresh process) comes back to the same step.
 * `permission` mode is just the access step, opened from Home's banner.
 */
export interface Onboarding {
  step: OnboardingStep | "done";
  mode: "setup" | "permission";
}

interface PrefsState {
  theme: ThemePref;
  soundOn: boolean;
  powerToolsOpen: boolean;
  /** The first-scan overlay has played once; later launches scan quietly. */
  firstScanDone: boolean;
  /** Look for space every Sunday and say so. Never removes anything. */
  weeklyCheck: boolean;
  onboarding: Onboarding;
  setTheme: (theme: ThemePref) => void;
  toggleSound: () => void;
  togglePowerTools: () => void;
  setOnboarding: (onboarding: Onboarding) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "system",
      soundOn: true,
      powerToolsOpen: true,
      firstScanDone: false,
      weeklyCheck: true,
      onboarding: { step: "welcome", mode: "setup" },
      setTheme: (theme) => set({ theme }),
      toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
      togglePowerTools: () => set((s) => ({ powerToolsOpen: !s.powerToolsOpen })),
      setOnboarding: (onboarding) => set({ onboarding }),
    }),
    { name: "sift-prefs" },
  ),
);
