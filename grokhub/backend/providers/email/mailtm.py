"""Mail.tm temp email provider (public, no key required)."""
import time

import httpx

from . import EmailProvider, Mailbox, register_provider


@register_provider
class MailTmProvider(EmailProvider):
    name = "mailtm"

    def __init__(self) -> None:
        self.base = "https://api.mail.tm"
        self.client = httpx.Client(timeout=30)

    def get_address(self) -> Mailbox:
        domains = self.client.get(f"{self.base}/domains").json().get("hydra:member", [])
        domain = domains[0]["domain"] if domains else "mail.tm"
        local = f"grokhub{int(time.time())}{int(time.time()*1000)%1000}"
        address = f"{local}@{domain}"
        pwd = "GrokhubPass1!"
        self.client.post(f"{self.base}/accounts", json={"address": address, "password": pwd})
        token = self.client.post(
            f"{self.base}/token", json={"address": address, "password": pwd}
        ).json().get("token", "")
        return Mailbox(address=address, token=token, client=self.client)

    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        headers = {"Authorization": f"Bearer {mailbox.token}"}
        deadline = time.time() + timeout
        while time.time() < deadline:
            msgs = self.client.get(f"{self.base}/messages", headers=headers).json().get("hydra:member", [])
            for m in msgs:
                if sender_filter and sender_filter.lower() not in m.get("from", {}).get("address", "").lower():
                    continue
                msg_id = m["id"]
                body = self.client.get(f"{self.base}/messages/{msg_id}", headers=headers).json()
                text = body.get("text", "") or body.get("html", "")
                code = self._extract_code(text)
                if code:
                    return code
            time.sleep(4)
        raise TimeoutError("No verification code received from Mail.tm")

    @staticmethod
    def _extract_code(text: str) -> str:
        import re
        m = re.search(r"\b(\d{6})\b", text)
        return m.group(1) if m else ""
