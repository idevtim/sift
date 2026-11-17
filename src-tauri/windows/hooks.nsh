; Custom NSIS hooks, wired up in tauri.conf.json (bundle > windows > nsis > installerHooks).

; "Restart to update" starts this installer and then Sift exits. If Sift is
; still closing when setup checks for it, Windows can't stop it a second time
; (the process is already ending) and setup aborts with "Failed to kill Sift".
; So for updates, wait up to 15s for the old Sift.exe to be let go first: a
; running exe can't be opened for writing, so the open succeeds once it's gone.
!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R9 0
    sift_wait_exit:
      ClearErrors
      FileOpen $R8 "$INSTDIR\${MAINBINARYNAME}.exe" a
      IfErrors 0 sift_exited
      IntOp $R9 $R9 + 1
      IntCmp $R9 30 sift_wait_done
      Sleep 500
      Goto sift_wait_exit
    sift_exited:
      FileClose $R8
    sift_wait_done:
  ${EndIf}
!macroend
