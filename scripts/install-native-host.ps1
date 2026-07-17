[CmdletBinding()]
param(
  [ValidateSet("Install", "Repair", "Doctor")]
  [string]$Action = "Install",

  [ValidateSet("Chrome", "Edge", "Both")]
  [string]$Browser = "Both",

  [string]$ExtensionId,
  [string]$HostName = "com.chatgpt_native_agent.host",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ChatGPTNativeAgent"),
  [string[]]$WorkspaceRoot = @(),
  [string[]]$ReadOnlyRoot = @(),

  [ValidateSet("dev", "release")]
  [string]$Mode = "dev",

  [switch]$ResetConfig,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProductVersion = "1.3.0"
$SourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$ConfigPath = Join-Path $InstallDir "config\runtime.json"
$TokenPath = Join-Path $InstallDir "secrets\local-api.token"
$ManifestPath = Join-Path $InstallDir "manifests\$HostName.json"
$LauncherPath = Join-Path $InstallDir "chatgpt-native-agent-host.cmd"
$InstallerLog = Join-Path $InstallDir "logs\installer.log"
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$SelectedBrowsers = if ($Browser -eq "Both") { @("Chrome", "Edge") } else { @($Browser) }
$Plan = New-Object System.Collections.Generic.List[string]

function Add-Plan([string]$Message) {
  $Plan.Add($Message)
  Write-Host "[plan] $Message"
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  if ($DryRun) { Add-Plan "Write $Path"; return }
  $Parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $Parent -Force | Out-Null
  [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Write-InstallerLog([string]$Message) {
  if ($DryRun) { return }
  New-Item -ItemType Directory -Path (Split-Path -Parent $InstallerLog) -Force | Out-Null
  $safe = $Message -replace '(?i)(token|secret|authorization)\s*[=:]\s*\S+', '$1=[REDACTED]'
  Add-Content -LiteralPath $InstallerLog -Value "$(Get-Date -Format o) $safe" -Encoding UTF8
}

function Get-RegistryPath([string]$Name) {
  if ($Name -eq "Chrome") { return "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" }
  return "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}

function Get-BrowserExecutable([string]$Name) {
  $candidates = if ($Name -eq "Chrome") {
    @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
  } else {
    @(
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
  }
  return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function Assert-Prerequisites {
  if ($env:OS -ne "Windows_NT") { throw "This installer supports Windows only." }
  if (-not $NodeCommand) { throw "Node.js 18 or newer is required and must be on PATH." }
  $versionText = & $NodeCommand.Source -p "process.versions.node"
  $major = [int]($versionText -split '\.')[0]
  if ($major -lt 18) { throw "Node.js 18 or newer is required; found $versionText." }
  if ($Action -ne "Doctor") {
    if (-not $ExtensionId) { throw "-ExtensionId is required for Install or Repair." }
    if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ExtensionId must be a 32-character Chrome/Edge extension ID (letters a-p)." }
  }
}

function Copy-ProductFiles {
  foreach ($folder in @("native-host", "schemas", "payloads")) {
    $source = Join-Path $SourceRoot $folder
    $destination = Join-Path $InstallDir $folder
    Add-Plan "Copy $folder to $destination"
    if (-not $DryRun) {
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
      Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
    }
  }
  foreach ($document in @("README.md", "SECURITY.md", "RELEASE-NOTES.md")) {
    $source = Join-Path $SourceRoot $document
    if (Test-Path -LiteralPath $source) {
      Add-Plan "Copy $document"
      if (-not $DryRun) { Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDir $document) -Force }
    }
  }
}

function Ensure-Config {
  if ((Test-Path -LiteralPath $ConfigPath) -and -not $ResetConfig) {
    Add-Plan "Preserve existing config $ConfigPath"
    return
  }
  $writeRoots = @($WorkspaceRoot)
  if ($writeRoots.Count -eq 0) { $writeRoots = @($SourceRoot) }
  $roots = New-Object System.Collections.Generic.List[object]
  $index = 0
  foreach ($root in $writeRoots) {
    $index += 1
    $roots.Add(@{ id = "workspace-$index"; path = [IO.Path]::GetFullPath($root); read_only = $false })
  }
  foreach ($root in $ReadOnlyRoot) {
    $index += 1
    $roots.Add(@{ id = "reference-$index"; path = [IO.Path]::GetFullPath($root); read_only = $true })
  }
  $config = [ordered]@{
    schema = "cnagent-config/2"
    mode = $Mode
    active_profile = "default"
    data_dir = (Join-Path $InstallDir "data")
    profiles = @([ordered]@{
      id = "default"
      roots = @($roots)
      payload_roots = @((Join-Path $InstallDir "payloads"))
      capabilities = @("filesystem.read", "filesystem.write", "process.run", "payload.load", "browser.control")
      process = [ordered]@{
        allow = @("node", "npm", "npx", "pnpm", "yarn", "git", "python", "python3", "go", "cargo", "powershell", "pwsh", "cmd")
        shell = $false
        max_concurrency = 2
        default_timeout_ms = 120000
        max_output_bytes = 1048576
      }
      filesystem = [ordered]@{
        max_read_bytes = 4194304
        max_write_bytes = 16777216
        max_results = 1000
        deny_globs = @("**/*.pem", "**/id_rsa*")
        redact_globs = @("**/.env*")
        snapshot_retention_days = 14
        transaction_max_bytes = 1073741824
      }
    })
    provider = [ordered]@{
      preferred = "chatgpt-web"
      domains = @("https://chatgpt.com/*", "https://chat.openai.com/*")
      max_iterations = 20
      response_timeout_ms = 180000
    }
    native_hosts = [ordered]@{
      preferred = $HostName
      compatible = @("com.openai.codexextension", "com.openai.codexextension.dev", "com.openai.codexextension.internal")
    }
    trusted_publishers_file = (Join-Path $InstallDir "config\trusted-publishers.json")
    api = [ordered]@{
      enabled = $true
      host = "127.0.0.1"
      port = 1840
      token_file = $TokenPath
      allowed_origins = @()
    }
    audit = [ordered]@{
      path = (Join-Path $InstallDir "data\audit.jsonl")
      retention_days = 30
      hash_chain = $true
    }
  }
  Write-Utf8NoBom $ConfigPath (($config | ConvertTo-Json -Depth 12) + "`n")
  $trustPath = Join-Path $InstallDir "config\trusted-publishers.json"
  if (-not (Test-Path -LiteralPath $trustPath)) {
    Write-Utf8NoBom $trustPath "{`n  `"schema`": `"cnagent-trust/1`",`n  `"keys`": {},`n  `"revoked`": []`n}`n"
  }
}

function Ensure-Token {
  if (Test-Path -LiteralPath $TokenPath) { Add-Plan "Preserve local API token"; return }
  Add-Plan "Create local API token with current-user ACL"
  if ($DryRun) { return }
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-Utf8NoBom $TokenPath ($token + "`n")
  try {
    $acl = Get-Acl -LiteralPath $TokenPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $TokenPath -AclObject $acl
  } catch {
    Write-Warning "Could not restrict token ACL automatically: $($_.Exception.Message)"
  }
}

function Write-LauncherAndManifest {
  $hostScript = Join-Path $InstallDir "native-host\bin\chatgpt-native-agent-host.js"
  $launcher = "@echo off`r`nset `"CHATGPT_NATIVE_AGENT_CONFIG=$ConfigPath`"`r`n`"$($NodeCommand.Source)`" `"$hostScript`"`r`n"
  Add-Plan "Write native host launcher $LauncherPath"
  if (-not $DryRun) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $LauncherPath) -Force | Out-Null
    [IO.File]::WriteAllText($LauncherPath, $launcher, [Text.Encoding]::ASCII)
  }
  $manifest = [ordered]@{
    name = $HostName
    description = "Tiiextension Native Agent Host v$ProductVersion"
    path = $LauncherPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  Write-Utf8NoBom $ManifestPath (($manifest | ConvertTo-Json -Depth 5) + "`n")
}

function Register-Browsers {
  foreach ($name in $SelectedBrowsers) {
    $key = Get-RegistryPath $name
    $detected = Get-BrowserExecutable $name
    Add-Plan "Register $HostName for $name at $key (browser detected: $([bool]$detected))"
    if (-not $DryRun) {
      New-Item -Path $key -Force | Out-Null
      Set-Item -Path $key -Value $ManifestPath
    }
  }
}

function Invoke-SelfTest {
  if ($DryRun) { Add-Plan "Run native runtime doctor"; return @{ skipped = $true; reason = "dry-run" } }
  $cli = Join-Path $InstallDir "native-host\bin\agent-cli.js"
  $output = & $NodeCommand.Source $cli doctor --config $ConfigPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Native runtime doctor failed: $($output -join [Environment]::NewLine)" }
  return ($output -join "`n" | ConvertFrom-Json)
}

function Invoke-Doctor {
  $checks = New-Object System.Collections.Generic.List[object]
  $checks.Add(@{ name = "windows"; ok = ($env:OS -eq "Windows_NT"); detail = $env:OS })
  $checks.Add(@{ name = "node"; ok = [bool]$NodeCommand; detail = if ($NodeCommand) { (& $NodeCommand.Source -v) } else { "not found" } })
  $checks.Add(@{ name = "config"; ok = (Test-Path -LiteralPath $ConfigPath); detail = $ConfigPath })
  $checks.Add(@{ name = "manifest"; ok = (Test-Path -LiteralPath $ManifestPath); detail = $ManifestPath })
  $checks.Add(@{ name = "launcher"; ok = (Test-Path -LiteralPath $LauncherPath); detail = $LauncherPath })
  foreach ($name in $SelectedBrowsers) {
    $key = Get-RegistryPath $name
    $registered = Test-Path $key
    $value = if ($registered) { (Get-Item $key).GetValue("") } else { $null }
    $checks.Add(@{ name = "$($name.ToLower())-registry"; ok = ($registered -and $value -eq $ManifestPath); detail = $value })
  }
  $runtime = $null
  if ($NodeCommand -and (Test-Path -LiteralPath $ConfigPath) -and (Test-Path -LiteralPath (Join-Path $InstallDir "native-host\bin\agent-cli.js"))) {
    try { $runtime = Invoke-SelfTest } catch { $runtime = @{ ok = $false; error = $_.Exception.Message } }
  }
  $ok = -not ($checks | Where-Object { -not $_.ok }) -and ($null -ne $runtime) -and ($runtime.ok -ne $false)
  $report = [ordered]@{
    ok = $ok
    product = "Tiiextension"
    version = $ProductVersion
    install_dir = $InstallDir
    checks = @($checks)
    runtime = $runtime
    note = "Reload the unpacked extension to complete an actual browser/native handshake smoke test."
  }
  Write-Output ($report | ConvertTo-Json -Depth 12)
  if (-not $ok) { $global:LASTEXITCODE = 1; exit 1 }
}

Assert-Prerequisites
if ($Action -eq "Doctor") { Invoke-Doctor; return }

Add-Plan "$Action Tiiextension v$ProductVersion"
Copy-ProductFiles
Ensure-Config
Ensure-Token
Write-LauncherAndManifest
Register-Browsers
$selfTest = Invoke-SelfTest
Write-InstallerLog "$Action completed version=$ProductVersion browsers=$Browser mode=$Mode"

$result = [ordered]@{
  ok = $true
  action = $Action.ToLower()
  dry_run = [bool]$DryRun
  version = $ProductVersion
  install_dir = $InstallDir
  config = $ConfigPath
  manifest = $ManifestPath
  browsers = $SelectedBrowsers
  browser_detected = @($SelectedBrowsers | ForEach-Object { @{ name = $_; path = (Get-BrowserExecutable $_) } })
  self_test = $selfTest
  plan = @($Plan)
  next = "Load extension/ unpacked, then reload it and run scripts\doctor.ps1."
}
Write-Output ($result | ConvertTo-Json -Depth 12)
