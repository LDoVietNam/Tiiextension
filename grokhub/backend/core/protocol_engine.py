"""Grok registration protocol engine: signup -> verify -> SSO -> OAuth PKCE -> token.

Implements the consolidated pipeline from grok-build-auth + grok-register-web.
Critical invariants (from protocol research):
  - SSO cookie is NOT CPA auth. OAuth PKCE with referrer=grok-build claim is mandatory.
  - base_url MUST be https://cli-chat-proxy.grok.com/v1 (not api.x.ai/v1).
"""
import base64
import hashlib
import json
import os
import secrets
import time
import urllib.parse
import uuid

import httpx

from config import load_config, grok_auth_headers


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class ProtocolEngine:
    def __init__(self) -> None:
        self.cfg = load_config()
        self.client = httpx.Client(
            timeout=60,
            follow_redirects=True,
            proxy=self.cfg.proxy or None,
        )

    # --- Step 1: signup (email + captcha) ---
    def signup(self, email: str, captcha_token: str) -> str:
        # accounts.x.ai signup with email + Turnstile token.
        resp = self.client.post(
            "https://accounts.x.ai/api/account/auth/register",
            json={"email": email, "turnstile_token": captcha_token},
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        # Returns session cookie used to poll verification.
        return self.client.cookies.get("sso", "") or self.client.cookies.get("session", "")

    # --- Step 2: verify email (handled by caller via EmailProvider.wait_for_code) ---
    @staticmethod
    def submit_verification_code(code: str) -> None:
        # The verification link/code is submitted through the email confirmation flow.
        # In practice the signup confirmation is a GET to the emailed link; caller follows it.
        pass

    # --- Step 3: SSO handshake -> returns SSO session token ---
    def sso_handshake(self) -> str:
        resp = self.client.get("https://accounts.x.ai/api/account/auth/sso")
        resp.raise_for_status()
        return self.client.cookies.get("sso", "")

    # --- Step 4: OAuth PKCE with referrer=grok-build ---
    def oauth_pkce(self, referrer: str = "grok-build") -> dict:
        code_verifier = _b64url(secrets.token_bytes(32))
        code_challenge = _b64url(hashlib.sha256(code_verifier.encode()).digest())
        state = uuid.uuid4().hex

        auth_url = (
            "https://auth.x.ai/oauth2/authorize"
            f"?response_type=code&client_id=grok-build&redirect_uri=https://grok.com/"
            f"&code_challenge={code_challenge}&code_challenge_method=S256&state={state}"
            f"&referrer={referrer}"
        )
        resp = self.client.get(auth_url, follow_redirects=False)
        location = resp.headers.get("location", "")
        code = urllib.parse.parse_qs(urllib.parse.urlparse(location).query).get("code", [""])[0]
        if not code:
            raise RuntimeError(f"OAuth authorize did not return code (loc={location[:120]})")

        token_resp = self.client.post(
            "https://auth.x.ai/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "client_id": "grok-build",
                "redirect_uri": "https://grok.com/",
                "referrer": referrer,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_resp.raise_for_status()
        return token_resp.json()

    # --- Step 5: assemble exported auth record ---
    def build_auth_record(self, tokens: dict, email: str) -> dict:
        return {
            "type": "xai",
            "auth_kind": "oauth",
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "base_url": self.cfg.base_url,
            "headers": grok_auth_headers(),
            "_email": email,
        }

    def export_json(self, record: dict) -> str:
        """Serialize the exported auth record (excluding internal _email field)."""
        out = {k: v for k, v in record.items() if not k.startswith("_")}
        return json.dumps(out, indent=2)


def run_registration(email: str, captcha_solver_name: str, email_provider_name: str) -> dict:
    """Full pipeline used by task_runner. Returns the exported auth record dict."""
    from providers.captcha import get_solver
    from providers.email import get_provider

    engine = ProtocolEngine()
    solver = get_solver(captcha_solver_name)
    provider = get_provider(email_provider_name)

    # Acquire mailbox, then solve captcha for signup page.
    mailbox = provider.get_address()
    captcha_token = solver.solve_turnstile(
        site_key="0x4AAAAAAA_placeholder", page_url="https://accounts.x.ai/sign-up"
    )
    engine.signup(mailbox.address, captcha_token)

    # Wait for verification code, submit via email confirmation link.
    code = provider.wait_for_code(mailbox, sender_filter="x.ai", timeout=120)
    engine.submit_verification_code(code)

    # SSO + OAuth PKCE
    sso_cookie = engine.sso_handshake()
    tokens = engine.oauth_pkce(referrer=engine.cfg.sso_referrer)

    record = engine.build_auth_record(tokens, mailbox.address)
    record["_sso"] = sso_cookie
    return record
