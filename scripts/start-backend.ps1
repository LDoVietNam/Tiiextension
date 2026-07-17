# PowerShell script to start Go backend
$ErrorActionPreference = "Stop"

# Set environment variables
$env:DASHBOARD_PATH = "Z:\01_PROJECTS\apps\Tiiextension\dashboard"
$env:PORT = "1840"

# Ensure we're in the right directory
Set-Location "Z:\01_PROJECTS\apps\Tiiextension\Tirouter\CLIProxyAPI"

Write-Host "Starting CLIProxyAPI backend on port $env:PORT..." -ForegroundColor Green
Write-Host "Dashboard path: $env:DASHBOARD_PATH" -ForegroundColor Cyan

# Build and run (if Go is installed)
# go run ./cmd/server/main.go
# For now, just verify dashboard exists
if (Test-Path $env:DASHBOARD_PATH) {
    Write-Host "Dashboard files found:" (Get-ChildItem $env:DASHBOARD_PATH | Measure-Object).Count "items" -ForegroundColor Yellow
} else {
    Write-Host "Warning: Dashboard path not found" -ForegroundColor Red
}