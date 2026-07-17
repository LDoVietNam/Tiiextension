# download-baidu-pan.ps1
# Tự động tải file từ Baidu Pan share link
# Yêu cầu: tài khoản Baidu đã đăng nhập + cookie BDUSS
#
# Cách lấy BDUSS:
# 1. Mở https://pan.baidu.com trong Chrome
# 2. Đăng nhập
# 3. F12 → Application → Cookies → pan.baidu.com → copy cookie "BDUSS"

param(
  [string]$Url = "https://pan.baidu.com/s/1ptWfWRzGTR7ibHtm_lBt3w?pwd=flow",
  [string]$Pwd = "flow",
  [string]$BDUSS = "",
  [string]$OutputDir = "."
)

$ErrorActionPreference = "Stop"

# Parse surl và shareid từ HTML hoặc API
$surl = ""
if ($Url -match "pan\.baidu\.com/s/([A-Za-z0-9_\-]+)") {
  $surl = $matches[1]
}
if (-not $surl) { throw "Không tìm thấy surl trong URL" }

Write-Host "Share URL: $surl"
Write-Host "Pwd: $Pwd"

# API: verify password
$verifyUrl = "https://pan.baidu.com/share/verify?shareid=&uk=&pwd=$Pwd&vcode=&vcode_str="
# Thực tế cần thêm shareid + uk từ trang

# B1: Lấy shareid + uk từ HTML
$html = Invoke-WebRequest -Uri $Url -UserAgent "Mozilla/5.0" -SessionVariable session
if ($BDUSS) {
  $session.Cookies.Add([System.Net.Cookie]::new("BDUSS", $BDUSS, "/", ".baidu.com"))
}

# Tìm yunData
if ($html.Content -match "shareid:""(\d+)""") { $shareId = $matches[1] }
if ($html.Content -match "share_uk:""(\d+)""") { $uk = $matches[1] }

if (-not $shareId -or -not $uk) {
  Write-Host "shareId=$shareId uk=$uk"
  # Fallback: parse từ locals.mset
  if ($html.Content -match "shareid.:(\d+)") { $shareId = $matches[1] }
  if ($html.Content -match "share_uk.:.(\d+)") { $uk = $matches[1] }
}

if (-not $shareId -or -not $uk) {
  throw "Không thể lấy shareid/uk. Cần đăng nhập hoặc nhập提取码 thủ công."
}

Write-Host "shareId=$shareId uk=$uk"

# B2: Verify password
$verifyBody = "pwd=$Pwd"
$verifyResp = Invoke-WebRequest -Uri "https://pan.baidu.com/share/verify?surl=$surl&shareid=$shareId&uk=$uk" `
  -Method POST `
  -ContentType "application/x-www-form-urlencoded" `
  -Body $verifyBody `
  -WebSession $session `
  -UserAgent "Mozilla/5.0"

$verifyJson = $verifyResp.Content | ConvertFrom-Json
if ($verifyJson.errno -ne 0) {
  throw "Verify failed: $($verifyJson.errno) $($verifyJson.errmsg)"
}

Write-Host "Verify OK, randsk=$($verifyJson.randsk)"

# B3: List files
$listResp = Invoke-WebRequest -Uri "https://pan.baidu.com/api/share/list?shareid=$shareId&uk=$uk&pwd=$Pwd&randsk=$($verifyJson.randsk)" `
  -WebSession $session `
  -UserAgent "Mozilla/5.0"

$listJson = $listResp.Content | ConvertFrom-Json
if ($listJson.errno -ne 0) {
  throw "List failed: $($listJson.errno)"
}

$files = $listJson.list
Write-Host "Found $($files.Count) items:"
foreach ($f in $files) {
  Write-Host "  - $($f.server_filename) ($($f.size) bytes)"
}

# B4: Get download link (cần login BDUSS)
foreach ($f in $files) {
  $dlResp = Invoke-WebRequest -Uri "https://pan.baidu.com/api/sharedownload?shareid=$shareId&uk=$uk" `
    -Method POST `
    -ContentType "application/x-www-form-urlencoded" `
    -Body "encrypt=0&product=share&uk=$uk&primaryid=$shareId&fid_list=[$($f.fs_id)]" `
    -WebSession $session `
    -UserAgent "Mozilla/5.0"
  $dlJson = $dlResp.Content | ConvertFrom-Json
  if ($dlJson.errno -ne 0) {
    Write-Warning "Download link failed for $($f.server_filename): $($dlJson.errno)"
    continue
  }
  $dlink = $dlJson.list[0].dlink
  $outPath = Join-Path $OutputDir $f.server_filename
  Write-Host "Downloading $($f.server_filename) -> $outPath"
  Invoke-WebRequest -Uri $dlink -OutFile $outPath -WebSession $session -UserAgent "Mozilla/5.0"
}

Write-Host "Done."