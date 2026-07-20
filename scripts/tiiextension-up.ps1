[CmdletBinding()]
param(
  [switch]$Tunnel,
  [switch]$Mcp,
  [string]$Config = ".\native-host\config\default.workspaces.json",
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 18401,
  [string]$LogDir = ".\runtime\orchestrator",
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Initialize log directory
$null = New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "up-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Helper function to write both to console and log
function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "HH:mm:ss"
  $logLine = "[$timestamp] $Message"
  Write-Host $Message
  Add-Content -Path $LogFile -Value $logLine
}

# Step 1: Check Node.js
Write-Log "Checking Node.js..."
$nodeExe = $null
if ($env:TIIEXTENSION_NODE_EXE) {
  $nodeExe = $env:TIIEXTENSION_NODE_EXE
} else {
  $nodeCommand = Get-Command node,node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nodeCommand) {
    $nodeExe = $nodeCommand.Source
  }
}

$nodeVersion = $null
try {
  $nodeVersion = (& $nodeExe --version 2>$null)
} catch {}

if (-not $nodeVersion) {
  Write-Log "ERROR: Node.js 18+ is required. Please install Node.js first."
  exit 1
}
$nodeVersion = $nodeVersion.Substring(1)
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 18) {
  Write-Log "ERROR: Node.js 18+ is required. Current version: $nodeVersion"
  exit 1
}
Write-Log "Node.js $nodeVersion detected."

# Step 2: Check config workspace
$ConfigPath = [IO.Path]::GetFullPath((Join-Path $Root $Config))
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Write-Log "ERROR: Config not found at $ConfigPath"
  exit 1
}
Write-Log "Config loaded from $ConfigPath"

# Step 3: Create/read local API token
$SecretsDir = Join-Path $Root "native-host\config\secrets"
$TokenFile = Join-Path $SecretsDir "local-api.token"
$null = New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null

if (-not (Test-Path -LiteralPath $TokenFile)) {
  $tokenBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
  $token = [Convert]::ToBase64String($tokenBytes).Replace('+', '-').Replace('/', '_')
  Set-Content -Path $TokenFile -Value $token -NoNewline
  Write-Log "Generated new API token at $TokenFile"
} else {
  $token = Get-Content -Path $TokenFile -Raw
  Write-Log "Loaded existing API token"
}

# Step 4: Start local API
$ApiProcess = $null
$ApiOutFile = Join-Path $LogDir "api.stdout.log"
$ApiErrFile = Join-Path $LogDir "api.stderr.log"

$ServerPath = Join-Path $Root "native-host\bin\agent-server.js"
if (-not (Test-Path -LiteralPath $ServerPath)) {
  Write-Log "ERROR: agent-server.js not found at $ServerPath"
  exit 1
}

Write-Log "Starting Tiiextension API on http://$BindHost`:$Port..."
$env:TIIEXTENSION_API_TOKEN = $token
$ApiProcess = Start-Process -FilePath $nodeExe -ArgumentList "`"$ServerPath`"", "--config", "`"$ConfigPath`"", "--host", $BindHost, "--port", $Port -WorkingDirectory $Root -NoNewWindow -PassThru -RedirectStandardOutput $ApiOutFile -RedirectStandardError $ApiErrFile

# Wait for API to be ready
$timeout = 30
$elapsed = 0
do {
  Start-Sleep -Milliseconds 500
  $elapsed += 0.5
  try {
    $health = Invoke-RestMethod -Uri "http://$BindHost`:$Port/v1/health" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 1
    if ($health.ok) { break }
  } catch {
    # API not ready yet
  }
} while ($elapsed -lt $timeout)

if ($elapsed -ge $timeout) {
  Write-Log "WARNING: API may not be fully ready. Check $ApiErrFile for details."
} else {
  Write-Log "API: running at http://$BindHost`:$Port"
}

# Step 5: Start MCP bridge if requested
$McpProcess = $null
$McpOutFile = Join-Path $LogDir "mcp.stdout.log"
$McpErrFile = Join-Path $LogDir "mcp.stderr.log"

if ($Mcp) {
  $McpServerPath = Join-Path $Root "mcp-bridge\src\server.js"
  if (Test-Path -LiteralPath $McpServerPath) {
    $env:TIIEXTENSION_API_URL = "http://$BindHost`:$Port"
    $env:TIIEXTENSION_API_TOKEN = $token
    Write-Log "Starting MCP bridge..."
    $McpProcess = Start-Process -FilePath $nodeExe -ArgumentList "`"$McpServerPath`"" -WorkingDirectory $Root -NoNewWindow -PassThru -RedirectStandardOutput $McpOutFile -RedirectStandardError $McpErrFile
    Write-Log "MCP: running over stdio/manual"
  } else {
    Write-Log "MCP: script not found at $McpServerPath"
  }
} else {
  Write-Log "MCP: running over stdio/manual"
}

# Step 6 & 7: Start Cloudflare Tunnel if requested and token available
$TunnelProcess = $null
$TunnelUrl = $null
$TunnelOutFile = Join-Path $LogDir "tunnel.stdout.log"
$TunnelErrFile = Join-Path $LogDir "tunnel.stderr.log"

if ($Tunnel) {
  # Check for CLOUDFLARE_TUNNEL_TOKEN in Z:\00_SECRET\cloudflare-api-key.txt or environment
  $SecretEnvPath = "Z:\00_SECRET\cloudflare-api-key.txt"
  $foundTunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN

  if (Test-Path -LiteralPath $SecretEnvPath) {
    $secretContent = Get-Content -Path $SecretEnvPath
    foreach ($line in $secretContent) {
      if ($line -match '^\s*CLOUDFLARE_TUNNEL_TOKEN\s*=\s*(.+)$') {
        $foundTunnelToken = $matches[1].Trim()
      }
    }
  }

  if (-not $foundTunnelToken) {
    Write-Log "Tunnel: skipped, CLOUDFLARE_TUNNEL_TOKEN missing"
  } else {
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
      Write-Log "Tunnel: skipped, cloudflared not installed"
    } else {
      Write-Log "Starting Cloudflare Tunnel..."
      $env:CLOUDFLARE_TUNNEL_TOKEN = $foundTunnelToken
      $TunnelProcess = Start-Process -FilePath cloudflared -ArgumentList "tunnel", "--url", "http://$BindHost`:$Port" -WorkingDirectory $Root -NoNewWindow -PassThru -RedirectStandardOutput $TunnelOutFile -RedirectStandardError $TunnelErrFile

      # Try to extract tunnel URL from logs (wait a bit)
      Start-Sleep -Seconds 3
      if (Test-Path -LiteralPath $TunnelOutFile) {
        $tunnelLog = Get-Content -Path $TunnelOutFile -Tail 20
        if ($tunnelLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
          $TunnelUrl = $matches[0]
          Write-Log "Tunnel: running at $TunnelUrl"
        }
      }
    }
  }
} else {
  Write-Log "Tunnel: skipped, CLOUDFLARE_TUNNEL_TOKEN missing"
}

# Step 8: Health check
try {
  $health = Invoke-RestMethod -Uri "http://$BindHost`:$Port/v1/health" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
  Write-Log "Health check passed"
} catch {
  Write-Log "WARNING: Health check failed - $_"
}

# Step 9 & 10: Write orchestrator state
$state = @{
  api_pid = $ApiProcess.Id
  api_url = "http://$BindHost`:$Port"
  api_token_file = $TokenFile
  mcp_pid = if ($McpProcess) { $McpProcess.Id } else { $null }
  tunnel_pid = if ($TunnelProcess) { $TunnelProcess.Id } else { $null }
  tunnel_url = $TunnelUrl
  started_at = (Get-Date).ToString("o")
  log_file = $LogFile
}
$StateFile = Join-Path $Root "runtime\orchestrator-state.json"
$state | ConvertTo-Json -Depth 10 | Set-Content -Path $StateFile

Write-Log "Orchestrator state saved to $StateFile"
Write-Log "Tiiextension is UP (PID: $($ApiProcess.Id))"

if (-not $NoWait) {
  Write-Log "Press Ctrl+C to stop, or run: node .\native-host\bin\agent-cli.js down"
  try {
    while ($ApiProcess.HasExited -eq $false) {
      Start-Sleep -Seconds 1
    }
  } finally {
    & (Join-Path $Root "scripts\tiiextension-down.ps1")
  }
}
