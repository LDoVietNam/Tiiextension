# Hướng dẫn Kiểm thử Dashboard 1MCP

## Cách 1: Tự động hóa với PowerShell

Chạy lệnh sau để mở trình duyệt và hiển thị hướng dẫn:

```powershell
# Mở dashboard
Start-Process "http://127.0.0.1:1840/ui/"

# Copy API key vào clipboard
echo "tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI" | Set-Clipboard
```

## Các bước kiểm thử thủ cộng (5 phút)

1. **Mở trình duyệt** (Chrome/Edge)
   - Truy cập: `http://127.0.0.1:1840/ui/`
   - Hoặc chạy: `Start-Process "http://127.0.0.1:1840/ui/"`

2. **Nhập API key**
   - API key: `tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI`
   - Dán vào ô "API key" và nhấn **Kết nối**

3. **Kiểm tra Workspace tree**
   - Sidebar bên trái phải hiển thị 27 mục (README.md, AGENTS.MD, các thư mục con)
   - Nhấp vào thư mục để đi sâu hơn

4. **Mở và sửa file**
   - Nhấp vào `README.md` → nội dung hiển thị trong editor
   - Thử thay đổi nội dung (thêm 1 dòng test)
   - Nhấn **Lưu** → xuất hiện thông báo "Đã lưu"

5. **Run Agent (nếu có phiên AI)**
   - Mở tab ChatGPT/Claude trong cùng trình duyệt
   - Nhấn **Quét session** trên dashboard
   - Nếu có model, nhập goal vào ô và nhấn **Run**

## Cách 2: Chạy script xác minh API tự động

```powershell
node tests/browser/simple-verify.mjs
```

Kết quả mong đợi:
```
1. Health Check: OK
2. Dashboard UI Files: OK
3. Get Allowed Roots: OK
4. List Directory: OK (27 entries)
5. Read File: OK
6. Write/Read Cycle: OK
7. Delete: OK
```

## File đã tạo

- `tests/browser/simple-verify.mjs` - Script xác minh API bằng Node.js
- `tests/browser/dashboard.spec.js` - Playwright E2E tests (cần cài browser)
- `tests/browser/manual-test-guide.md` - Hướng dẫn này