"""CloudMail temp email provider (self-hosted maillab/cloud-mail)."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class CloudMailProvider(EmailProvider):
    name = "cloudmail"

    def __init__(self) -> None:
        self.base = os.environ.get("CLOUDMAIL_URL", "").rstrip("/")
        self.admin_email = os.environ.get("CLOUDMAIL_ADMIN_EMAIL", "")
        self.admin_password = os.environ.get("CLOUDMAIL_PASSWORD", "")
        self.client = httpx.Client(timeout=30)

    def get_address(self) -> Mailbox:
        # Admin endpoint creates a random address; public endpoint reads mail.
        resp = self.client.post(
            f"{self.base}/admin/addresses",
            json={"admin_email": self.admin_email, "admin_password": self.admin_password},
        ).json()
        return Mailbox(address=resp["email"], token=resp.get("token", ""), client=self.client)

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
        raise TimeoutError("No verification code received from CloudMail")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
