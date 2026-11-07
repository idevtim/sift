mod access;
mod checkup;
mod commands;
mod models;
mod process_ext;
mod restore;
mod scanners;

use commands::{IndexState, SharedIndex};
use restore::RestoreStore;
use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    // GUI launches get a minimal PATH; docker/xcrun/gio live elsewhere.
    process_ext::augment_path();

    // Quick checks and removals share rayon's global pool; cap it at half
    // the cores so Sift never takes the whole machine.
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(scanners::pool_threads())
        .thread_name(|i| format!("sift-work-{i}"))
        .build_global();

    // Started by the OS for the Sunday check-up: no window, just a look.
    if checkup::requested() {
        checkup::run();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let store = Arc::new(RestoreStore::new(app.path().app_data_dir()?));
            // Clear anything past its 30 days without holding up launch.
            let purge = Arc::clone(&store);
            std::thread::spawn(move || {
                if let Err(e) = purge.purge_expired() {
                    eprintln!("restore purge failed: {e:#}");
                }
            });
            app.manage(store);
            app.manage::<SharedIndex>(Arc::new(IndexState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::full_access,
            commands::open_full_access_settings,
            commands::relaunch,
            commands::set_weekly_check,
            commands::list_drives,
            commands::scan_findings,
            commands::eject_drive,
            commands::scan_index,
            commands::explore,
            commands::search_index,
            commands::big_files,
            commands::dev_report,
            commands::clean_docker,
            commands::clean_simulators,
            commands::find_duplicates,
            commands::duplicate_preview,
            commands::duplicate_facts,
            commands::index_findings,
            commands::finding_items,
            commands::uninstall_app,
            commands::drive_breakdown,
            commands::list_apps,
            commands::app_icon,
            commands::free_up,
            commands::free_paths,
            commands::reveal_path,
            commands::list_restore,
            commands::restore_entry,
            commands::clear_restore,
            commands::hide_cleared,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sift");
}
