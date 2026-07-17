[CmdletBinding()]
param(
  [ValidateSet("Chrome", "Edge", "Both")]
  [string]$Browser = "Both",
  [string]$HostName = "com.chatgpt_native_agent.host",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ChatGPTNativeAgent"),
  [switch]$KeepData,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "This uninstaller supports Windows only." }
$SelectedBrowsers = if ($Browser -eq "Both") { @("Chrome", "Edge") } else { @($Browser) }
$removed = New-Object System.Collections.Generic.List[string]

foreach ($name in $SelectedBrowsers) {
  $key = if ($name -eq "Chrome") {
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
  } else {
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  }
  if (Test-Path $key) {
    $removed.Add($key)
    if (-not $DryRun) { Remove-Item -Path $key -Recurse -Force }
  }
}

if (Test-Path -LiteralPath $InstallDir) {
  if ($KeepData) {
    foreach ($relative in @("native-host", "schemas", "payloads", "manifests", "chatgpt-native-agent-host.cmd", "README.md", "SECURITY.md", "RELEASE-NOTES.md")) {
      $target = Join-Path $InstallDir $relative
      if (Test-Path -LiteralPath $target) {
        $removed.Add($target)
        if (-not $DryRun) { Remove-Item -LiteralPath $target -Recurse -Force }
      }
    }
  } else {
    $removed.Add($InstallDir)
    if (-not $DryRun) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
  }
}

[ordered]@{
  ok = $true
  action = "uninstall"
  dry_run = [bool]$DryRun
  keep_data = [bool]$KeepData
  removed = @($removed)
} | ConvertTo-Json -Depth 5
