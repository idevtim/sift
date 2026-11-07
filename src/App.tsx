import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { CommandPalette } from "@/components/overlays/CommandPalette";
import { FirstScan } from "@/components/overlays/FirstScan";
import { Onboarding } from "@/components/overlays/Onboarding";
import { Toaster } from "@/components/overlays/Toaster";
import { useHashRoute } from "@/hooks/useHashRoute";
import { useScan } from "@/hooks/useScan";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/tauri";
import type { RouteId } from "@/routes";
import { usePalette } from "@/stores/paletteStore";
import { usePrefs } from "@/stores/prefsStore";
import { useScanStore } from "@/stores/scanStore";
import { AppsView } from "@/views/apps/AppsView";
import { BigFilesView } from "@/views/big-files/BigFilesView";
import { DeveloperView } from "@/views/developer/DeveloperView";
import { DoneView } from "@/views/done/DoneView";
import { DriveDetailView } from "@/views/drives/DriveDetailView";
import { DrivesView } from "@/views/drives/DrivesView";
import { DuplicatesView } from "@/views/duplicates/DuplicatesView";
import { ExploreView } from "@/views/explore/ExploreView";
import { FreeingView } from "@/views/freeing/FreeingView";
import { HomeView } from "@/views/home/HomeView";
import { RestoreView } from "@/views/restore/RestoreView";
import { FindingView } from "@/views/review/FindingView";
import { ReviewView } from "@/views/review/ReviewView";
import { PlaceholderView } from "@/views/_placeholder/PlaceholderView";

// Onboarding ends by starting the first scan with its overlay; if it was
// closed before that played, show it now. Later launches scan quietly.
{
  const { onboarding, firstScanDone } = usePrefs.getState();
  if (onboarding.step === "done" && !firstScanDone) {
    useScanStore.setState({ overlay: true, startedAt: Date.now() });
  }
}

/**
 * First launch shows onboarding on its own — nothing scans until it's done,
 * so macOS can grant Full Disk Access before Sift looks at a single folder.
 */
export function App() {
  useTheme();
  const { step, mode } = usePrefs((s) => s.onboarding);
  if (step !== "done" && mode === "setup") {
    return (
      <div className="relative h-full bg-surface">
        <Onboarding />
      </div>
    );
  }
  return <Main permission={step !== "done"} />;
}

function Main({ permission }: { permission: boolean }) {
  const { route, navigate } = useHashRoute();
  const queryClient = useQueryClient();
  const { dataUpdatedAt } = useScan();

  // A fresh scan means fresh Explore / Big files / Developer / Duplicates.
  useEffect(() => {
    if (dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: ["index"] });
  }, [dataUpdatedAt, queryClient]);

  // Keep the OS schedule in step with the pref — at every launch too, so it
  // follows the app if it moves.
  const weeklyCheck = usePrefs((s) => s.weeklyCheck);
  useEffect(() => {
    api.setWeeklyCheck(weeklyCheck).catch((e) => console.warn("weekly check-up schedule failed", e));
  }, [weeklyCheck]);

  // ⌘K / Ctrl+K toggles quick search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && usePrefs.getState().onboarding.step === "done") {
        e.preventDefault();
        const { open, setOpen } = usePalette.getState();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AppShell
      current={route}
      onNavigate={navigate}
      overlays={
        <>
          <FirstScan onNavigate={navigate} />
          <CommandPalette onNavigate={navigate} />
          <Toaster onNavigate={navigate} />
          {permission && <Onboarding />}
        </>
      }
    >
      <View route={route} onNavigate={navigate} />
    </AppShell>
  );
}

function View({ route, onNavigate }: { route: RouteId; onNavigate: (id: RouteId) => void }) {
  switch (route) {
    case "home":
      return <HomeView onNavigate={onNavigate} />;
    case "review":
      return <ReviewView onNavigate={onNavigate} />;
    case "finding":
      return <FindingView onNavigate={onNavigate} />;
    case "freeing":
      return <FreeingView />;
    case "done":
      return <DoneView onNavigate={onNavigate} />;
    case "drives":
      return <DrivesView />;
    case "drive":
      return <DriveDetailView />;
    case "big-files":
      return <BigFilesView />;
    case "restore":
      return <RestoreView />;
    case "explore":
      return <ExploreView />;
    case "duplicates":
      return <DuplicatesView />;
    case "apps":
      return <AppsView />;
    case "developer":
      return <DeveloperView />;
    default:
      return <PlaceholderView route={route} />;
  }
}
