# GPT Custom Action for Tiiextension

Use `openapi/chatgpt-action.yaml` to let a GPT call Tiiextension through your Cloudflare Tunnel.

Flow:

```text
GPT Custom Action
→ Cloudflare Tunnel URL
→ 127.0.0.1:18401
→ Tiiextension native host
→ workspace filesystem/runtime tools
```

Steps:

1. Start the local API:

   ```powershell
   .\scripts\start-api.ps1
   ```

2. Start Cloudflare Tunnel:

   ```powershell
   .\scripts\start-tunnel.ps1
   ```

3. Copy `openapi/chatgpt-action.yaml`, replace:

   ```text
   https://YOUR-CLOUDFLARE-TUNNEL.trycloudflare.com
   ```

   with your tunnel URL.

4. Configure bearer auth with the local API token.

Important: this does not proxy ChatGPT cookies/session. It exposes only the Tiiextension local API that you explicitly run.
