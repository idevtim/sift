import { useFixtures } from "@/lib/tauri";
import { useUpdateStore } from "@/stores/updateStore";

/**
 * Quietly look for a newer release and download it in the background. The
 * sidebar offers "Restart to update" once it's ready; failures stay silent
 * (offline, GitHub down) and we simply try again next launch.
 */
export async function checkForUpdates() {
  if (useFixtures()) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;
    await update.download();
    useUpdateStore.getState().setReady(update.version, async () => {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      // On Windows the installer closes Sift itself; relaunch only runs elsewhere.
      await update.install();
      await relaunch();
    });
  } catch (e) {
    console.warn("update check failed", e);
  }
}

/** Apply the downloaded update. Leaves the card in place if it fails. */
export async function restartToUpdate() {
  const { apply, setInstalling } = useUpdateStore.getState();
  if (!apply) return;
  setInstalling(true);
  try {
    await apply();
  } catch (e) {
    console.warn("update install failed", e);
    setInstalling(false);
  }
}
