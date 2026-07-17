[CmdletBinding()]
param(
  [string]$LogDir = ".\runtime\orchestrator"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$StateFile = [IO.Path]::GetFullPath((Join-Path $Root "runtime\orchestrator-state.json"))

# Helper function to write both to console and log
function Write-Log {
  param([string]$Message)
  Write-Host $Message
}

# Load orchestrator state
if (-not (Test-Path -LiteralPath $StateFile)) {
  Write-Log "No orchestrator state found. Nothing to stop."
  exit 0
}

$state = Get-Content -Path $StateFile | ConvertFrom-Json

Write-Log "Stopping Tiiextension services..."

# Stop tunnel process
if ($state.tunnel_pid) {
  try {
    $tunnelProc = Get-Process -Id $state.tunnel_pid -ErrorAction SilentlyContinue
    if ($tunnelProc) {
      Stop-Process -Id $state.tunnel_pid -Force -ErrorAction SilentlyContinue
      Write-Log "Tunnel: stopped (PID: $($state.tunnel_pid))"
    }
  } catch {
    Write-Log "Tunnel: failed to stop - $_"
  }
} else {
  Write-Log "Tunnel: not running"
}

# Stop MCP process
if ($state.mcp_pid) {
  try {
    $mcpProc = Get-Process -Id $state.mcp_pid -ErrorAction SilentlyContinue
    if ($mcpProc) {
      Stop-Process -Id $state.mcp_pid -Force -ErrorAction SilentlyContinue
      Write-Log "MCP: stopped (PID: $($state.mcp_pid))"
    }
  } catch {
    Write-Log "MCP: failed to stop - $_"
  }
} else {
  Write-Log "MCP: not running"
}

# Stop API process
if ($state.api_pid) {
  try {
    $apiProc = Get-Process -Id $state.api_pid -ErrorAction SilentlyContinue
    if ($apiProc) {
      Stop-Process -Id $state.api_pid -Force -ErrorAction SilentlyContinue
      Write-Log "API: stopped (PID: $($state.api_pid))"
    }
  } catch {
    Write-Log "API: failed to stop - $_"
  }
}

# Clean up state file
Remove-Item -Path $StateFile -ErrorAction SilentlyContinue

Write-Log "Tiiextension is DOWN"