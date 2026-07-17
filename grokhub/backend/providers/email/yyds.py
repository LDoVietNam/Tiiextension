"""YYDS fixed-domain temp email provider."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class YYDSProvider(EmailProvider):
    name = "yyds"

    def __init__(self) -> None:
        self.base = os.environ.get("YYDS_API_BASE", "https://api.yydsMail.com")
        self.default_domain = os.environ.get("YYDS_DEFAULT_DOMAIN", "")
        self.client = httpx.Client(timeout=30)

    def get_address(self) -> Mailbox:
        body = {"domain": self.default_domain} if self.default_domain else {}
        resp = self.client.post(f"{self.base}/addresses", json=body).json()
        return Mailbox(address=resp["address"], token=resp.get("token", ""), client=self.client)

    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            msgs = self.client.get(f"{self.base}/messages", params={"address": mailbox.address}).json()
            for m in msgs.get("messages", []):
                if sender_filter and sender_filter.lower() not in str(m.get("from", "")).lower():
                    continue
                body = self.client.get(f"{self.base}/messages/{m['id']}").text
                code = self._extract_code(body)
                if code:
                    return code
            time.sleep(4)
        raise TimeoutError("No verification code received from YYDS")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
