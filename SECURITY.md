# Security model

## Bất biến

1. Cookie/session ChatGPT được extension **đọc có chủ đích** (model config `oai-last-model-config`, model đang chọn, các key localStorage không nhạy cảm) và có thể lưu vào `chrome.storage.local` để tự động chọn model / khôi phục phiên. Dữ liệu này **chỉ lưu cục bộ**, không bao giờ dùng làm credential cho API/CLI, không proxy và không xuất khỏi thiết bị.
2. Browser tự gửi cookie xác thực cho `chatgpt.com`; extension không chiếm quyền xác thực (không đọc auth/access token để gọi API thay mặt user). Tính năng `set_cookie` chỉ ghi lại cookie model do người dùng chủ động yêu cầu, không can thiệp mật khẩu hay token đăng nhập.
3. Mọi đường dẫn native phải nằm trong root của active workspace profile sau canonicalization.
4. Read-only root không nhận mutation; path bị deny, symlink/junction escape và prefix collision đều bị từ chối.
5. Filesystem mutation thuộc transaction hoặc maintenance operation có audit tương đương.
6. Process không dùng shell, command phải trong allowlist, cwd phải ở workspace, environment được thu gọn, có timeout/output limit/cancel.
7. Local API release chỉ bind loopback, bắt buộc bearer token độc lập với ChatGPT và deny Origin theo mặc định.
8. Release payload bắt buộc SHA-256 + Ed25519 hợp lệ từ trusted publisher. Model không thể thêm trust key.

## Profile và quyền

Quyền được xác lập một lần qua extension install và runtime config, không hỏi lại ở từng tool. `capabilities` kiểm soát `filesystem.read`, `filesystem.write`, `process.run`, `payload.load` và `browser.control`; root có thể đánh dấu `read_only`. Các giới hạn dung lượng, concurrency, timeout, deny/redact glob và snapshot retention nằm trong config v2.

Extension dùng `nativeMessaging`, `storage`, `sidePanel`, `tabs`, `scripting`, `debugger`, `downloads`, `activeTab` và host permission. Profile full-control cần `<all_urls>` để điều khiển nhiều site. Browser vẫn hiển thị permission/debugger UI của chính nền tảng khi bắt buộc.

## Audit và dữ liệu nhạy cảm

Audit JSONL nối hash của record trước để phát hiện sửa chuỗi. Policy scrub các key nhạy cảm như auth token, session secret, password, authorization và API key; bearer value bị thay bằng `[REDACTED]`. Cookie cấu hình model và session UI được lưu cục bộ vì là tính năng chủ động của extension, nhưng KHÔNG được ghi vào audit log hay xuất qua API/CLI. Artifact lớn nằm ngoài native message, có SHA-256 và metadata. Không đưa file `.env`, private key hay token đăng nhập vào ZIP phát hành.

Local API token nằm ở `secrets/local-api.token`. Installer cố gắng giới hạn ACL cho user hiện tại. Không paste token vào prompt, log, issue hoặc script được commit. Origin có header chỉ được chấp nhận khi nằm trong `api.allowed_origins`.

## Payload trust

Dev mode cho unsigned module/command payload trong root đã cấu hình và UI phải coi là mã phát triển. Module chạy trong Worker với memory limits; command chạy qua process supervisor. Release mode fail closed nếu thiếu checksum, thiếu signature, key lạ, thuật toán khác Ed25519 hoặc nội dung bị sửa.

Worker isolation giúp crash/cancel và giới hạn heap nhưng không phải sandbox cấp hệ điều hành. Payload đã ký vẫn là code có quyền theo profile; chỉ thêm publisher mà bạn quản lý và review mã trước khi ký.

## Threats được xử lý

- Prompt injection: model output chỉ là đề xuất; tool manifest, policy, schema và workspace guard quyết định thực thi.
- Path traversal/reparse: canonical parent gần nhất, realpath và containment check; revalidate trước mutation.
- Duplicate/replay: call journal + `call_id`/`idempotency_key` trả lại result cũ thay vì lặp mutation.
- Localhost CSRF: bearer token, Origin deny, body limit, loopback-only release bind.
- Process runaway: timeout, output cap, cancel và Windows process-tree termination.
- Native host giả: extension ưu tiên host riêng và chỉ chấp nhận compatibility host sau handshake `cnagent/1` đúng.

## Giới hạn và hardening release

Build trong ZIP là source distribution để load unpacked. Trước triển khai tổ chức, nên pin extension ID, phát hành qua Chrome Web Store/Edge Add-ons hoặc enterprise policy, code-sign PowerShell/launcher, lưu signing key ngoài repo, chạy Windows E2E sạch, thay trust store rỗng bằng public keys được quản trị và rà soát `<all_urls>` theo distribution profile.

Nếu adapter không xác định chắc trạng thái submit/response, nó trả lỗi ambiguous/timeout; không tự lặp prompt có thể tạo tác dụng kép. Nếu provider mất kết nối, ngừng mutation mới và giữ task để chẩn đoán.
