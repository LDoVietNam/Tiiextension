# Quick browser test runner for 1MCP dashboard
# Run this after starting 1mcp-runtime.exe

Write-Host "=== Running Playwright E2E tests for 1MCP Dashboard ==="

# Check if backend is running
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:18401/health" -ErrorAction Stop
    Write-Host "Backend health: $($health.status)"
} catch {
    Write-Host "ERROR: Backend not running at http://127.0.0.1:18401"
    Write-Host "Start it first with: node .\scripts\agent-server.js"
    exit 1
}

# Run tests
npx playwright test tests/browser/dashboard.spec.js --reporter=list

Write-Host "=== Tests complete ==="
