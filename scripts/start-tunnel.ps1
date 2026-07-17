[CmdletBinding()]
param(
  [string]$EnvPath = ".\cloudflare\.env",
  [string]$Url = "http://127.0.0.1:1840",
  [switch]$NamedTunnel
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ResolvedEnv = [IO.Path]::GetFullPath((Join-Path $Root $EnvPath))
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared is required. Install Cloudflare Tunnel first." }

if (Test-Path -LiteralPath $ResolvedEnv) {
  Get-Content -LiteralPath $ResolvedEnv | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

if ($NamedTunnel) {
  if (-not $env:CLOUDFLARE_TUNNEL_TOKEN) { throw "CLOUDFLARE_TUNNEL_TOKEN is required for named tunnel mode." }
  Write-Host "Starting named Cloudflare tunnel for Tiiextension"
  & cloudflared tunnel run --token $env:CLOUDFLARE_TUNNEL_TOKEN
} else {
  Write-Host "Starting temporary Cloudflare tunnel to $Url"
  & cloudflared tunnel --url $Url
}
