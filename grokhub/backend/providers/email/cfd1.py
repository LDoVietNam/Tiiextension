"""Cloudflare D1 alias email provider (self-hosted D1 backend)."""
import os
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class CloudflareD1Provider(EmailProvider):
    name = "cfd1"

    def __init__(self) -> None:
        self.base = os.environ.get("CFD1_API_BASE", "")
        self.account_id = os.environ.get("CFD1_ACCOUNT_ID", "")
        self.d1_db_id = os.environ.get("CFD1_D1_DB_ID", "")
        self.api_token = os.environ.get("CFD1_API_TOKEN", "")
        self.domains = os.environ.get("CFD1_DOMAINS", "").split(",")
        self.client = httpx.Client(timeout=30, headers={"Authorization": f"Bearer {self.api_token}"})

    def get_address(self) -> Mailbox:
        domain = self.domains[0] if self.domains else "example.com"
        local = f"grokhub{int(time.time())}"
        address = f"{local}@{domain}"
        self.client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/d1/database/{self.d1_db_id}/query",
            json={"sql": f"INSERT INTO aliases(address) VALUES('{address}')"},
        )
        return Mailbox(address=address, token="", client=self.client)

    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            # Query D1 for latest message to this alias.
            resp = self.client.post(
                f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/d1/database/{self.d1_db_id}/query",
                json={"sql": f"SELECT * FROM messages WHERE `to`='{mailbox.address}' ORDER BY id DESC LIMIT 5"},
            ).json()
            for row in resp.get("result", []):
                if sender_filter and sender_filter.lower() not in str(row.get("from", "")).lower():
                    continue
                code = self._extract_code(row.get("body", ""))
                if code:
                    return code
            time.sleep(4)
        raise TimeoutError("No verification code received from Cloudflare D1 alias")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
