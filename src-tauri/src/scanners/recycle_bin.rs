//! The Windows Recycle Bin. It lives in a hidden folder on every drive, so
//! Sift asks the shell for its size and to empty it rather than touching
//! those folders itself. Elsewhere these return None / false.

/// Total size and item count across every drive's Recycle Bin.
#[cfg(windows)]
pub fn query() -> Option<(u64, u64)> {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, i64Size: 0, i64NumItems: 0 };
    // A null root path means "all drives".
    let hr = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    (hr >= 0).then(|| (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64))
}

/// Empty every drive's Recycle Bin, without the shell's confirmation,
/// progress window or sound (Sift shows its own).
#[cfg(windows)]
pub fn empty() -> bool {
    use windows_sys::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };
    let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), flags) };
    hr >= 0
}

#[cfg(not(windows))]
pub fn query() -> Option<(u64, u64)> {
    None
}

#[cfg(not(windows))]
pub fn empty() -> bool {
    false
}
