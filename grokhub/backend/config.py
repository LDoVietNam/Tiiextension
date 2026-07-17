"""GrokHub backend configuration loaded from environment / .env file."""
import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    # Core protocol
    sso_referrer: str = "grok-build"
    base_url: str = "https://cli-chat-proxy.grok.com/v1"
    client_version: str = "0.2.93"
    client_identifier: str = "grok-shell"
    xai_token_auth: str = "xai-grok-cli"

    # Database
    db_path: str = field(default_factory=lambda: os.path.join(os.path.dirname(__file__), "grokhub.db"))

    # CPA export targets
    cpa_local_dir: str = ""
    cpa_mgmt_api_url: str = ""
    cpa_mgmt_api_key: str = ""

    # grok2api
    grok2api_url: str = ""
    grok2api_key: str = ""
    pool_default: str = "ssoBasic"  # ssoBasic | ssoSuper

    # Captcha
    captcha_type: str = "yescaptcha"  # yescaptcha | sidecar
    yescaptcha_key: str = ""
    sidecar_url: str = "http://127.0.0.1:8787"

    # Email providers (comma separated; first is default)
    email_providers: str = "mailtm"

    # Network
    bind_host: str = "127.0.0.1"
    bind_port: int = 8000

    # Optional proxy for outbound registration requests
    proxy: str = ""


def _load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)


def load_config() -> Settings:
    _load_env_file(os.path.join(os.path.dirname(__file__), ".env"))
    s = Settings()
    mapping = {
        "SSO_REFERRER": "sso_referrer",
        "BASE_URL": "base_url",
        "CLIENT_VERSION": "client_version",
        "DB_PATH": "db_path",
        "CPA_LOCAL_DIR": "cpa_local_dir",
        "CPA_MGMT_API_URL": "cpa_mgmt_api_url",
        "CPA_MGMT_API_KEY": "cpa_mgmt_api_key",
        "GROK2API_URL": "grok2api_url",
        "GROK2API_KEY": "grok2api_key",
        "POOL_DEFAULT": "pool_default",
        "CAPTCHA_TYPE": "captcha_type",
        "YESCAPTCHA_KEY": "yescaptcha_key",
        "SIDECAR_URL": "sidecar_url",
        "EMAIL_PROVIDERS": "email_providers",
        "BIND_HOST": "bind_host",
        "BIND_PORT": "bind_port",
        "PROXY": "proxy",
    }
    for env_key, attr in mapping.items():
        if env_key in os.environ:
            val = os.environ[env_key]
            if attr == "bind_port":
                val = int(val)
            setattr(s, attr, val)
    return s


# Exported auth header template used by all exporters / serve layer.
def grok_auth_headers() -> dict:
    s = load_config()
    return {
        "X-XAI-Token-Auth": s.xai_token_auth,
        "x-grok-client-version": s.client_version,
        "x-grok-client-identifier": s.client_identifier,
    }
