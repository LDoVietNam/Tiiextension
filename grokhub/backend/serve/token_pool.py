"""Token pool: pick a healthy exported token, refresh on expiry."""
from datetime import datetime, timezone

from models import db, now_iso


def _parse(ts: str) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def acquire() -> dict | None:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM tokens WHERE in_pool=1 ORDER BY id DESC"
        ).fetchall()
    for r in rows:
        exp = _parse(r["expires_at"])
        if exp is None or exp > datetime.now(timezone.utc):
            return dict(r)
    return None


def refresh(token_row: dict) -> dict | None:
    """Attempt to refresh an expired token via x.ai OAuth token endpoint."""
    import httpx

    from config import load_config

    cfg = load_config()
    resp = httpx.post(
        "https://auth.x.ai/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": token_row["refresh_token"],
            "client_id": "grok-build",
            "referrer": cfg.sso_referrer,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if not resp.ok:
        # Mark token unhealthy.
        with db() as conn:
            conn.execute("UPDATE tokens SET in_pool=0 WHERE id=?", (token_row["id"],))
        return None
    data = resp.json()
    with db() as conn:
        conn.execute(
            "UPDATE tokens SET access_token=?, refresh_token=?, expires_at=? WHERE id=?",
            (data.get("access_token", ""), data.get("refresh_token", ""), now_iso(), token_row["id"]),
        )
    return dict(token_row, access_token=data.get("access_token", ""), refresh_token=data.get("refresh_token", ""))


def acquire_or_refresh() -> dict | None:
    tok = acquire()
    if tok is None:
        return None
    exp = _parse(tok["expires_at"])
    if exp is not None and exp <= datetime.now(timezone.utc):
        return refresh(tok)
    return tok
