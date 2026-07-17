"""MailNest (Outlook alias) temp email provider - supports alias batch registration."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class MailNestProvider(EmailProvider):
    name = "mailnest"

    def __init__(self) -> None:
        self.api_key = os.environ.get("MAILNEST_API_KEY", "")
        self.project = os.environ.get("MAILNEST_PROJECT_CODE", "x-ai001")
        self.base = "https://api.mailnest.top"
        self.client = httpx.Client(timeout=30, headers={"Authorization": f"Bearer {self.api_key}"})

    def get_address(self) -> Mailbox:
        resp = self.client.post(
            f"{self.base}/alias/new", json={"project": self.project}
        ).json()
        return Mailbox(address=resp["email"], token=resp.get("token", ""), client=self.client)

    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            msgs = self.client.get(f"{self.base}/messages", params={"project": self.project}).json()
            for m in msgs.get("messages", []):
                if m.get("to", "") != mailbox.address:
                    continue
                if sender_filter and sender_filter.lower() not in str(m.get("from", "")).lower():
                    continue
                body = self.client.get(f"{self.base}/messages/{m['id']}").text
                code = self._extract_code(body)
                if code:
                    return code
            time.sleep(4)
        raise TimeoutError("No verification code received from MailNest")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
