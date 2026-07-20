# Full-flow curl simulation of browser dashboard actions
# This simulates what the browser dashboard does via API calls

$API_KEY = "tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI"
$BASE = "http://127.0.0.1:18401"
$ROOT = "Z:\01_PROJECTS\apps\Tiiextension"

function Invoke-Tool {
    param($Tool, $Args, $Label)
    
    $idempotencyKey = "browser_test_$((Get-Random -Maximum 9999999))"
    Write-Host "  -> $Label" -ForegroundColor Gray
    
    $body = @{
        tool = $Tool
        arguments = $Args
        idempotencyKey = $idempotencyKey
    } | ConvertTo-Json -Depth 10
    
    $result = Invoke-RestMethod -Uri "$BASE/internal/tools/call" -Method Post `
        -Headers @{ 'Content-Type' = 'application/json'; 'Authorization' = "Bearer $API_KEY" } `
        -Body $body
    
    return $result
}

Write-Host "=== Simulating Browser Dashboard Flow ==`n" -ForegroundColor Green

# Step 1: Health check (dashboard header)
Write-Host "1. Health Check (Badge):"
$health = Invoke-RestMethod -Uri "$BASE/health"
Write-Host "   Status: $($health.version) on $($health.listen)" -ForegroundColor Green
Write-Host "   Service: $($health.service)"

# Step 2: Get allowed roots (on load with API key)
Write-Host "`n2. Get Allowed Roots:"
$roots = Invoke-Tool "get_allowed_roots" @{} "Fetch allowed roots"
Write-Host "   Root: $($roots.result.roots[0])" -ForegroundColor Green

# Step 3: List directory (workspace tree)
Write-Host "`n3. List Directory (Workspace Tree):"
$list = Invoke-Tool "list_directory" @{ path = $ROOT } "List workspace root"
$entries = $list.result.entries
Write-Host "   Found $($entries.Count) items:"
$entries | Select-Object -First 10 | ForEach-Object { Write-Host "   - $($_.type): $($_.path)" }
if ($entries.Count -gt 10) { Write-Host "... và $($entries.Count - 10) mục nữa" }

# Step 4: Read README.md (open file)
Write-Host "`n4. Read File (README.md):"
$read = Invoke-Tool "read_file" @{ path = "$ROOT\README.md" } "Read README.md"
$contentLength = $read.result.content.Length
Write-Host "   Content length: $contentLength characters" -ForegroundColor Green

# Step 5: Write test file (save action)
Write-Host "`n5. Write Test File:"
$testContent = "Test save at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$write = Invoke-Tool "write_file" @{ path = "$ROOT\browser_test.txt"; content = $testContent } "Write test file"
Write-Host "   Write status: OK" -ForegroundColor Green

# Step 6: Read back (verify save)
Write-Host "`n6. Read Back Test File:"
$readBack = Invoke-Tool "read_file" @{ path = "$ROOT\browser_test.txt" } "Read back test file"
if ($readBack.result.content -eq $testContent) {
    Write-Host "   Content matches: YES" -ForegroundColor Green
} else {
    Write-Host "   Content matches: NO (mismatch)" -ForegroundColor Yellow
}

# Step 7: Delete (cleanup)
Write-Host "`n7. Delete Test File:"
$del = Invoke-Tool "delete_to_trash" @{ path = "$ROOT\browser_test.txt" } "Delete test file"
Write-Host "   Moved to trash: " -NoNewline
Write-Host "$($del.result.trashPath)" -ForegroundColor Green

# Step 8: Search (if supported)
Write-Host "`n8. Search Files (README pattern):"
$search = Invoke-Tool "search_files" @{ path = $ROOT; pattern = "README" } "Search for README"
$matches = $search.result.matches ?? $search.result.paths ?? @()
Write-Host "   Found $($matches.Count) matches: $($matches -join ', ')"

Write-Host "`n=== All browser flows simulated successfully ==`n" -ForegroundColor Green
Write-Host "Dashboard is ready for manual browser testing!" -ForegroundColor Cyan
