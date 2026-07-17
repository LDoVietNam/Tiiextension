# Tirouter Automation Workflow

## Mô tả
Workflow tự động hoá Tirouter AI Agent stack (CLIProxyAPI + OmniRoute + Claude-NIM Proxy) với khả năng chạy agent tasks qua MCP, tự động thu thập logs và dừng services sau mỗi lần chạy.

## Thành phần
- **CLIProxyAPI**: Cổng public trên port 20128
- **OmniRoute**: Docker container nội bộ (mạng nội thành)
- **Claude-NIM Proxy**: Truy cập 100+ NVIDIA NIM models

## Lịch trình
- Tự động: Chạy mỗi 6 giờ (`0 */6 * * *`)
- Thủ công: Trigger qua tab Actions > Tirouter Automation > Run workflow

## Quy trình thực thi
1. **Checkout mã nguồn** - Lấy mã từ repository
2. **Setup Node.js** - Cài đặt Node.js v18 cho claude-nim
3. **Install claude-nim** - Cài đặt gói claude-nim toàn cục
4. **Setup Bun** - Cài đặt Bun runtime (tùy chọn)
5. **Start Tirouter Stack** - Khởi động qua `start-tirouter.bat`
6. **Wait for services** - Chờ dịch vụ sẵn sàng (health check)
7. **Run MCP tasks** - Thực thi agent tasks qua `/v1/agent/runs`
8. **Collect Logs** - Thu thập logs làm artifact
9. **Stop Tirouter Stack** - Dừng services (luôn thực hiện)

## Cách thiết lập NVIDIA NIM API Key

### Bước 1: Lấy API Key
1. Truy cập https://build.nvidia.com
2. Đăng nhập/đăng ký tài khoản NVIDIA Developer
3. Vào mục API Keys hoặc Secrets
4. Tạo API key mới (định dạng: `nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### Bước 2: Thêm Secret vào Repository
1. Vào Repository > Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Điền thông tin:
   - **Name**: `NVIDIA_NIM_API_KEY`
   - **Value**: Dán API key đã tạo
4. Click "Add secret"

### Bước 3: Xác nhận
- Secret sẽ xuất hiện trong danh sách
- Có thể kiểm tra trong workflow logs mà không có giá trị thực
- Key sẽ được truyền qua biến môi trường `NVIDIA_NIM_API_KEY`

## Troubleshooting

### Lỗi: Services không khởi động
```powershell
# Kiểm tra process đang chạy
Get-Process -Name "claude-nim","CLIProxyAPI" -ErrorAction SilentlyContinue

# Kiểm tra ports
Get-NetTCPConnection -LocalPort 20128,3456 -ErrorAction SilentlyContinue
```

### Lỗi: Health check timeout
```powershell
# Chạy thủ cộng để debug
cd Z:\01_PROJECTS\apps\Tirouter
.\start-tirouter.bat

# Kiểm tra endpoint
curl http://localhost:20128/health
```

### Lỗi: Docker container không chạy
```powershell
# Kiểm tra Docker
docker ps -a

# Khởi động thủ cộng
docker-compose -f docker-compose.tirouter.yml up -d

# Xem logs
docker-compose -f docker-compose.tirouter.yml logs
```

## Monitoring

### Health Endpoints
- CLIProxyAPI: `http://localhost:20128/health`
- Claude-NIM Proxy: `http://localhost:3456/health` (nếu expose)
- Dashboard: `http://localhost:20128/dashboard`

### Logs Artifact
- Mỗi lần chạy đều tạo artefact `tirouter-logs-{run_id}`
- Chứa thống kê và logs từ CLIProxyAPI
- Lưu trữ trong 7 ngày

## File liên quan
- `.github/workflows/tirouter-auto.yml` - Workflow chính
- `Z:\01_PROJECTS\apps\Tirouter\start-tirouter.bat` - Script khởi động
- `Z:\02_CORE\_cli\.config\shared\commands\tirouter-*.md` - CLI commands
- `Z:\02_CORE\_cli\.config\shared\commands\claude-nim-*.md` - Claude-NIM commands

## Các lệnh CLI thủ công

### Tirouter Commands
- `tirouter-start.md` - Khởi động hệ thống
- `tirouter-status.md` - Kiểm tra trạng thái  
- `tirouter-stop.md` - Dừng hệ thống

### Claude-NIM Commands
- `claude-nim-start.md` - Khởi động proxy
- `claude-nim-status.md` - Kiểm tra trạng thái
- `claude-nim-stop.md` - Dừng proxy

## Lưu ý bảo mật
- Claude-NIM Proxy chỉ lắng nghe trên localhost (127.0.0.1)
- API key được lưu trữ an toàn dưới dạng GitHub Secret
- Không bao giờ commit API key trực tiếp vào repository
- Logs được lưu làm artifact riêng, không chứa thông tin nhạy cảm
- Services tự động dừng sau mỗi workflow run để giảm tài nguyên