[CmdletBinding()]
param(
  [ValidateSet("Chrome", "Edge", "Both")]
  [string]$Browser = "Both",
  [string]$HostName = "com.chatgpt_native_agent.host",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ChatGPTNativeAgent")
)

$Script = Join-Path $PSScriptRoot "install-native-host.ps1"
& $Script -Action Doctor -Browser $Browser -HostName $HostName -InstallDir $InstallDir
exit $LASTEXITCODE
