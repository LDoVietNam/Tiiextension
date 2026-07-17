# Troubleshooting

## Native offline

1. Chạy `.\scripts\doctor.ps1 -Browser Both`.
2. Kiểm tra Node.js 18+, manifest/launcher/config tồn tại và registry HKCU trỏ đúng manifest tuyệt đối.
3. Extension ID trong `allowed_origins` phải khớp ID của bản unpacked hiện tại.
4. Chạy repair với đúng ID, reload extension và đóng/mở lại ChatGPT tab.

```powershell
.\scripts\install-native-host.ps1 -Action Repair -Browser Both -ExtensionId YOUR_EXTENSION_ID
```

Nếu đổi thư mục gói hoặc extension ID, luôn repair vì native manifest lưu absolute launcher path và allowed origin.

## ChatGPT login required / provider unavailable

Mở `https://chatgpt.com`, đăng nhập trực tiếp và hoàn tất challenge/consent trong tab. Extension không thể và không nên lấy cookie để đăng nhập thay. Model list chỉ lấy từ UI hiển thị; nếu selector không còn tương thích, status sẽ báo model selection unavailable.

Một request/provider/tab tại một thời điểm. Nếu submit state ambiguous, kiểm tra tab trước khi retry để tránh gửi hai lần. Rate limit/challenge được báo thành structured provider error.

## Path outside workspace hoặc read-only

Mở `%LOCALAPPDATA%\ChatGPTNativeAgent\config\runtime.json`, kiểm tra active profile và root path. Thêm root rõ ràng, không dùng prefix gần giống. Root tham chiếu có `read_only: true` chỉ cho đọc. Sau khi sửa JSON, đóng/reload extension để native runtime nạp lại.

Symlink, junction hoặc target chưa tồn tại có parent canonical nằm ngoài root bị chặn. Device path, ADS và namespace đặc biệt không nên cấu hình làm root.

## Process denied

`process.run` không dùng shell. `command` phải nằm trong `profile.process.allow`; `cwd` phải nằm trong workspace. Truyền args thành array thay vì chuỗi shell. Tăng `default_timeout_ms`/`max_output_bytes` có kiểm soát nếu build hợp lệ cần nhiều tài nguyên.

## Patch conflict / transaction dirty

Dùng `fs.preview_patch` hoặc `fs.patch_check` trước khi apply. Unified diff dùng path tương đối workspace, context/line count phải khớp. Khi conflict, không tự commit phần còn lại. Xem `fs.transaction.status` và gọi rollback; snapshot có thể phục hồi bằng `fs.rollback`.

## Payload signature errors

- Dev: kiểm tra manifest/entry nằm trong configured root, type là `module`/`command`, checksum nếu đã khai báo.
- Release: phải có SHA-256, Ed25519, trusted `key_id` và đúng canonical signing data.
- Không sửa manifest hoặc entry sau khi ký.

Worker timeout/crash chỉ dừng payload call; unload/reload payload sau khi sửa. Worker không phải môi trường cho mã không tin cậy.

## Local API 401/403/503

- `401`: dùng bearer token từ `secrets/local-api.token`, loại bỏ newline.
- `403 API_ORIGIN_DENIED`: request có Origin chưa nằm trong `api.allowed_origins`; command-line client thường không cần Origin.
- `503 PROVIDER_UNAVAILABLE`: native server chưa có extension/ChatGPT provider bridge. Đây là hành vi an toàn; API không proxy session.

Kiểm tra port 18401 không bị process khác dùng. Release chỉ bind loopback. Không mở port qua firewall/LAN.

## Thu thập diagnostics an toàn

Chạy doctor, `agent-cli.js health`, `audit.verify`, `task.events` và ghi lại error code/version; bỏ token/path nhạy cảm trước khi chia sẻ. Không gửi `local-api.token`, cookie, `.env`, private key hoặc full browser profile. Audit tự redact key phổ biến nhưng vẫn nên review thủ công.
