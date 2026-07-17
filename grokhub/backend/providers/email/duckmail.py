"""DuckMail / Mail.tm-compatible temp email provider."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class DuckMailProvider(EmailProvider):
    name = "duckmail"

    def __init__(self) -> None:
        self.base = os.environ.get("DUCKMAIL_API_BASE", "https://api.duckmail.sbs")
        self.api_key = os.environ.get("DUCKMAIL_API_KEY", "")
        self.client = httpx.Client(timeout=30, headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})

    def get_address(self) -> Mailbox:
        resp = self.client.post(f"{self.base}/addresses").json()
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
        raise TimeoutError("No verification code received from DuckMail")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
