[CmdletBinding()]
param(
  [string]$PublicUrl,
  [string]$Token,
  [string]$TokenFile = ".\native-host\config\secrets\local-api.token"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Token -and (Test-Path -LiteralPath (Join-Path $Root $TokenFile))) {
  $Token = (Get-Content -LiteralPath (Join-Path $Root $TokenFile) -Raw).Trim()
}
if (-not $PublicUrl) { throw "-PublicUrl is required, for example https://YOUR-TUNNEL.trycloudflare.com" }
if (-not $Token) { throw "API bearer token is required. Pass -Token or provide -TokenFile." }

$health = "$($PublicUrl.TrimEnd('/'))/v1/health"
Write-Host "Checking $health"
$response = Invoke-RestMethod -Uri $health -Headers @{ Authorization = "Bearer $Token" } -Method GET
$response | ConvertTo-Json -Depth 12
