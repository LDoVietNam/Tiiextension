"""Push exported Grok auth records into a real grok2api instance.

grok2api (chenyme/grok2api) is a pure-Go multi-account gateway exposing OpenAI-style
/v1/* endpoints. It organizes accounts into three provider pools:
  - grok_build : Device OAuth or OAuth JSON
  - grok_web   : SSO JSON or line-by-line SSO token
  - grok_console: SSO JSON or line-by-line SSO token

All /v1/* calls require a client key: Authorization: Bearer g2a_xxx
Account import is done through the management API (not /api/import/*).

Reference: https://github.com/chenyme/grok2api
"""
import os

import httpx

from core.protocol_engine import ProtocolEngine


def _auth_header(grok2api_key: str) -> dict:
    # grok2api uses g2a_ client keys, not raw OAuth tokens, for its management/API auth.
    return {"Authorization": f"Bearer {grok2api_key}", "Content-Type": "application/json"}


def _import_path() -> str:
    return os.environ.get("GROK2API_IMPORT_PATH", "/api/accounts")


def import_build(record: dict, grok2api_url: str, grok2api_key: str) -> dict:
    """Push an exported xai OAuth auth JSON into the grok_build pool."""
    engine = ProtocolEngine()
    url = grok2api_url.rstrip("/") + _import_path()
    payload = {
        "provider": "grok_build",
        "type": "oauth_json",
        "auth": engine.export_json(record),
    }
    resp = httpx.post(url, headers=_auth_header(grok2api_key), json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


def import_web(sso: str, grok2api_url: str, grok2api_key: str) -> dict:
    """Push a Grok Web SSO session into the grok_web pool.

    sso may be a raw SSO token string or an SSO JSON document.
    """
    if not sso:
        return {"skipped": True, "reason": "no sso provided"}
    url = grok2api_url.rstrip("/") + _import_path()
    payload = {
        "provider": "grok_web",
        "type": "sso_json" if sso.strip().startswith("{") else "sso_token",
        "auth": sso,
    }
    resp = httpx.post(url, headers=_auth_header(grok2api_key), json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


def pool_status(grok2api_url: str, grok2api_key: str) -> dict:
    """Return currently servable models from the grok2api instance."""
    url = grok2api_url.rstrip("/") + "/v1/models"
    resp = httpx.get(url, headers=_auth_header(grok2api_key), timeout=30)
    resp.raise_for_status()
    return resp.json()
