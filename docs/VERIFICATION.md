# Verification summary — v1.1.0

Final release evidence is recorded in the root `VERIFICATION.md`.

Tài liệu này được cập nhật khi tạo artifact cuối. Release gate gồm unit/component/integration tests, syntax checks, MV3/UI static contract, deterministic packaging, checksum và kiểm tra ZIP độc lập.

Các lệnh chuẩn:

```bash
npm test
npm run check
npm run static-check
npm run package
unzip -t ../Tiiextension-v1.1.0.zip
```

Coverage contract bao gồm protocol parser/handshake/framing, durable tasks/events/idempotency, workspace traversal/policy, filesystem transaction/diff/encoding/watch, process cancellation/output limits, payload checksum/Ed25519/worker lifecycle, audit/artifacts, HTTP/WebSocket security, CLI exits, provider queue/state, browser locators, UI contract, installer contract và package inventory.

Windows-only acceptance vẫn phải chạy trên máy đích: install/repair/doctor/uninstall cho Chrome và Edge, extension/native handshake thật, authenticated ChatGPT goal loop, browser debugger/download flows và filesystem E2E trên NTFS với junction/reparse points. Môi trường đóng gói Linux không thể tạo bằng chứng cho các bước đó; release không được mô tả là store-signed hoặc Windows-certified chỉ dựa trên test tự động này.
