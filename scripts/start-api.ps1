[CmdletBinding()]
param(
  [string]$Config = ".\native-host\config\default.workspaces.json",
  [string]$Host = "127.0.0.1",
  [int]$Port = 1840
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server = Join-Path $Root "native-host\bin\agent-server.js"
$Node = Get-Command node,node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Node) { throw "Node.js 18+ is required." }
if (-not (Test-Path -LiteralPath $Server)) { throw "agent-server.js not found at $Server" }

$resolvedConfig = [IO.Path]::GetFullPath((Join-Path $Root $Config))
Write-Host "Starting Tiiextension API on http://$Host`:$Port"
& $Node.Source $Server --config $resolvedConfig --host $Host --port $Port
