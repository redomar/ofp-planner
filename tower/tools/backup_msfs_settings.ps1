# Back up MSFS 2024 (Microsoft Store) settings into a dated folder. Copy only: changes nothing in the sim.
# Run:      powershell -ExecutionPolicy Bypass -File backup_msfs_settings.ps1
# Restore:  close MSFS, then copy the files from a backup folder back to the same places (see RESTORE.txt in it).
$pkg   = Join-Path $env:LOCALAPPDATA "Packages\Microsoft.Limitless_8wekyb3d8bbwe"
$cache = Join-Path $pkg "LocalCache"
$dest  = Join-Path ([Environment]::GetFolderPath("MyDocuments")) ("MSFS 2024 settings backup\" + (Get-Date -Format "yyyy-MM-dd_HHmm"))
New-Item -ItemType Directory -Force $dest | Out-Null

# The sim's files carry an encryption attribute that Copy-Item tries (and fails) to keep, so copy the bytes only.
function Copy-Bytes($src, $dst) {
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    [IO.File]::WriteAllBytes($dst, [IO.File]::ReadAllBytes($src))
}

# Graphics/sound/general options + package path, sim CFG, cameras, add-on autostart, SimConnect, behaviour tweaks.
$files = "UserCfg.opt", "FlightSimulator2024.CFG", "Cameras.CFG", "EXE.xml", "SimConnect.xml", "model_behaviors.user.cfg"
foreach ($f in $files) {
    $src = Join-Path $cache $f
    if (Test-Path $src) { Copy-Bytes $src (Join-Path $dest $f); "copied $f" } else { "missing $f (skipped)" }
}
# Local copy of the cloud-synced profile (controls, assistance settings). ROLLINGCACHE.CCC is NOT copied (17 GB cache).
$wgs = Join-Path $pkg "SystemAppData\wgs"
if (Test-Path $wgs) {
    $n = 0
    Get-ChildItem $wgs -Recurse -File | ForEach-Object { Copy-Bytes $_.FullName (Join-Path $dest ("wgs" + $_.FullName.Substring($wgs.Length))); $n++ }
    "copied wgs (cloud profile cache, $n files)"
}

@"
MSFS 2024 settings backup taken $(Get-Date -Format "yyyy-MM-dd HH:mm").
To restore: CLOSE MSFS first. Then copy
  the .opt/.CFG/.xml/.cfg files  ->  $cache
  the wgs folder (only if controls/profile were lost)  ->  $pkg\SystemAppData\
replacing the existing ones. Start the sim afterwards.
"@ | Out-File -Encoding utf8 (Join-Path $dest "RESTORE.txt")
"backup in: $dest"
