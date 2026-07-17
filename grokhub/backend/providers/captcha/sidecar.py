"""Local captcha-solver sidecar (CloakBrowser-based) Turnstile solver."""
import os

import httpx

from . import CaptchaSolver, register_solver


@register_solver
class SidecarSolver(CaptchaSolver):
    name = "sidecar"

    def __init__(self) -> None:
        self.url = os.environ.get("SIDECAR_URL", "http://127.0.0.1:8787").rstrip("/")
        self.client = httpx.Client(timeout=120)

    def solve_turnstile(self, site_key: str, page_url: str, action: str = "") -> str:
        resp = self.client.post(
            f"{self.url}/solve",
            json={"type": "turnstile", "site_key": site_key, "page_url": page_url, "action": action},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["token"]
