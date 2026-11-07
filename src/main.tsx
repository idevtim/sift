import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { applyPlatformAttribute } from "./hooks/usePlatform";
import { resolveTheme } from "./hooks/useTheme";
import { queries } from "./lib/queries";
import { checkForUpdates } from "./lib/updates";
import { usePrefs } from "./stores/prefsStore";
import "./index.css";

void applyPlatformAttribute();

// Apply the saved theme before first paint so there's no light flash.
document.documentElement.dataset.theme = resolveTheme(usePrefs.getState().theme);

window.addEventListener("contextmenu", (event) => event.preventDefault());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Start the scan while React mounts — unless onboarding comes first (macOS
// would ask about each private folder before Full Disk Access is on).
if (usePrefs.getState().onboarding.step === "done") void queryClient.prefetchQuery(queries.findings);
void queryClient.prefetchQuery(queries.drives);

void checkForUpdates();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
