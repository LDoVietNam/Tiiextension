# Cloudflare Tunnel

Tiiextension ships tunnel templates but no Cloudflare token.

Default local service:

```text
http://127.0.0.1:18401
```

Quick temporary tunnel:

```powershell
.\scripts\start-api.ps1
.\scripts\start-tunnel.ps1
```

Named tunnel:

```powershell
Copy-Item .\cloudflare\.env.example .\cloudflare\.env
# edit .\cloudflare\.env and set CLOUDFLARE_TUNNEL_TOKEN
.\scripts\start-tunnel.ps1 -NamedTunnel
```

Doctor:

```powershell
.\scripts\doctor-tunnel.ps1 -PublicUrl https://YOUR-TUNNEL.trycloudflare.com
```
