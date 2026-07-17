# Cloudflare Tunnel for Tiiextension

This folder contains templates only. It does not include your Cloudflare token.

Default local target:

```text
http://127.0.0.1:18401
```

Quick flow on Windows:

```powershell
Copy-Item .\cloudflare\.env.example .\cloudflare\.env
# edit .\cloudflare\.env and add CLOUDFLARE_TUNNEL_TOKEN
powershell -ExecutionPolicy Bypass -File .\scripts\start-api.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\doctor-tunnel.ps1 -PublicUrl https://YOUR-TUNNEL.trycloudflare.com
```

For quick temporary tunnels, `start-tunnel.ps1` can run:

```powershell
cloudflared tunnel --url http://127.0.0.1:18401
```

Use the public URL in `openapi/chatgpt-action.yaml` for GPT Custom Actions.
