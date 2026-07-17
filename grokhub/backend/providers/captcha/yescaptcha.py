"""YesCaptcha (createTask-compatible) Turnstile solver."""
import os
import time

import httpx

from . import CaptchaSolver, register_solver


@register_solver
class YesCaptchaSolver(CaptchaSolver):
    name = "yescaptcha"

    def __init__(self) -> None:
        self.api_key = os.environ.get("YESCAPTCHA_KEY", "")
        self.base = "https://api.yescaptcha.com"
        self.client = httpx.Client(timeout=60)

    def solve_turnstile(self, site_key: str, page_url: str, action: str = "") -> str:
        if not self.api_key:
            raise RuntimeError("YESCAPTCHA_KEY not configured")
        task_resp = self.client.post(
            f"{self.base}/createTask",
            json={
                "clientKey": self.api_key,
                "task": {
                    "type": "TurnstileTaskProxyless",
                    "websiteKey": site_key,
                    "websiteURL": page_url,
                    "action": action or None,
                },
            },
        ).json()
        task_id = task_resp.get("taskId")
        if not task_id:
            raise RuntimeError(f"YesCaptcha createTask failed: {task_resp}")
        deadline = time.time() + 180
        while time.time() < deadline:
            res = self.client.post(
                f"{self.base}/getTaskResult", json={"clientKey": self.api_key, "taskId": task_id}
            ).json()
            if res.get("status") == "ready":
                return res["solution"]["token"]
            time.sleep(5)
        raise TimeoutError("YesCaptcha Turnstile solve timed out")
