# Register native host on Windows
$ErrorActionPreference = "Stop"

$manifestPath = "Z:\01_PROJECTS\apps\Tiiextension\native-host\com.chatgpt_native_agent.host.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.chatgpt_native_agent.host"

if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest file not found: $manifestPath"
    exit 1
}

# Create registry key for Chrome
New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty -Path $registryPath -Name "(default)" -Value $manifestPath

Write-Host "Native host registered successfully!" -ForegroundColor Green
Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan

# For Edge browser
$edgeRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.chatgpt_native_agent.host"
New-Item -Path $edgeRegistryPath -Force | Out-Null
Set-ItemProperty -Path $edgeRegistryPath -Name "(default)" -Value $manifestPath

Write-Host "Also registered for Edge" -ForegroundColor Yellow