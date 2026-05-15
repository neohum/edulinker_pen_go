# Bundled with the NSIS installer. Runs elevated. Installs the Microsoft
# handwriting recognizer capabilities for Korean and English (US) so that the
# main app can recognize text out of the box.
#
# These are official "Features on Demand" packages distributed via Windows
# Update — Add-WindowsCapability triggers a download from there. Requires:
#   - Administrator rights (NSIS provides this)
#   - Internet connectivity to Microsoft Update servers
#
# Exit code:
#   0  -> all requested capabilities are installed (or were already present)
#   1  -> at least one capability could not be installed (Windows Update unreachable, etc.)
#
# Stdout is logged into the NSIS install detail view so the user can see what
# happened.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$capabilities = @(
    'Language.Handwriting~~~ko-KR~0.0.1.0',  # Korean handwriting recognizer
    'Language.Handwriting~~~en-US~0.0.1.0'   # English (US) handwriting recognizer
)

$installed = 0
$alreadyPresent = 0
$failed = 0

Write-Host "=== Edulinker-Pen: handwriting recognizer setup ==="

foreach ($cap in $capabilities) {
    Write-Host ""
    Write-Host "Checking $cap ..."
    try {
        $info = Get-WindowsCapability -Online -Name $cap -ErrorAction Stop
        if ($info.State -eq 'Installed') {
            Write-Host "  Already installed."
            $alreadyPresent++
            continue
        }
        Write-Host "  State: $($info.State). Installing from Windows Update (this may take 30-60 seconds)..."
        Add-WindowsCapability -Online -Name $cap -ErrorAction Stop | Out-Null
        # Re-check to confirm.
        $after = Get-WindowsCapability -Online -Name $cap -ErrorAction Stop
        if ($after.State -eq 'Installed') {
            Write-Host "  Installed successfully."
            $installed++
        } else {
            Write-Host "  Install reported success but state is now '$($after.State)'."
            $failed++
        }
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)"
        $failed++
    }
}

Write-Host ""
Write-Host "Summary: newly installed=$installed  already present=$alreadyPresent  failed=$failed"

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "Some recognizers could not be installed automatically (likely no internet"
    Write-Host "or Windows Update is blocked). The app will still install. To enable"
    Write-Host "recognition later, open Windows Settings -> Time & Language -> Language ->"
    Write-Host "[language] -> Options -> Hand-writing -> Download."
    exit 1
}

exit 0
