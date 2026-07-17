"""Cloudflare temp email provider (Worker-backed)."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class CloudflareTempProvider(EmailProvider):
    name = "cloudflare"

    def __init__(self) -> None:
        self.base = os.environ.get("CLOUDFLARE_API_BASE", "")
        self.api_key = os.environ.get("CLOUDFLARE_API_KEY", "")
        self.auth_mode = os.environ.get("CLOUDFLARE_AUTH_MODE", "none")
        self.default_domains = os.environ.get("DEFAULT_DOMAINS", "")
        headers = {}
        if self.api_key:
            if self.auth_mode == "x-api-key":
                headers["x-api-key"] = self.api_key
            elif self.auth_mode == "x-admin-auth":
                headers["x-admin-auth"] = self.api_key
            elif self.auth_mode == "x-custom-auth":
                headers["x-custom-auth"] = self.api_key
        self.client = httpx.Client(timeout=30, headers=headers)

    def get_address(self) -> Mailbox:
        resp = self.client.post(f"{self.base}/api/new_address").json()
        return Mailbox(address=resp["address"], token=resp.get("token", ""), client=self.client)

    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            msgs = self.client.get(f"{self.base}/api/mails", params={"address": mailbox.address}).json()
            for m in msgs.get("mails", []):
                if sender_filter and sender_filter.lower() not in str(m.get("from", "")).lower():
                    continue
                body = self.client.get(f"{self.base}/api/mails/{m['id']}").text
                code = self._extract_code(body)
                if code:
                    return code
            time.sleep(4)
        raise TimeoutError("No verification code received from Cloudflare temp mail")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
