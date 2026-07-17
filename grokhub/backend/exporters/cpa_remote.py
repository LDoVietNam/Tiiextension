"""Upload exported auth record to a remote CPA Management API."""
import httpx

from core.protocol_engine import ProtocolEngine


def mgmt_upload(record: dict, api_url: str, api_key: str) -> dict:
    engine = ProtocolEngine()
    url = api_url.rstrip("/") + "/v0/management/auth-files"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        content=engine.export_json(record),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()
