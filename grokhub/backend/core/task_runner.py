"""Async-ish task runner with progress tracking backed by SQLite."""
import threading
import uuid

from models import (
    add_log,
    get_task,
    insert_account,
    insert_token,
    update_account_status,
    upsert_task,
)
from config import load_config
from core.protocol_engine import run_registration
from exporters.cpa_local import write_auth
from exporters.cpa_remote import mgmt_upload
from exporters.grok2api import import_web, import_build


def _run_task(task_id: str, email_provider: str, captcha_type: str) -> None:
    cfg = load_config()
    try:
        upsert_task(task_id, "register", 10, "running")
        add_log(task_id, "info", f"Starting registration with provider={email_provider}")

        record = run_registration(
            email="",  # generated inside engine via provider
            captcha_solver_name=captcha_type,
            email_provider_name=email_provider,
        )
        upsert_task(task_id, "register", 60, "exporting")

        email = record.get("_email", "")
        account_id = insert_account(email, "registered")
        insert_token(
            account_id,
            record["access_token"],
            record["refresh_token"],
            record["base_url"],
            str(record.get("headers", "")),
        )
        update_account_status(account_id, "token_stored")

        # Export to configured targets.
        if cfg.cpa_local_dir:
            write_auth(record, cfg.cpa_local_dir)
            add_log(task_id, "info", "Exported to CPA local dir")
        if cfg.cpa_mgmt_api_url:
            mgmt_upload(record, cfg.cpa_mgmt_api_url, cfg.cpa_mgmt_api_key)
            add_log(task_id, "info", "Uploaded to CPA remote Management API")
        if cfg.grok2api_url:
            import_web(record.get("_sso", ""), cfg.grok2api_url, cfg.grok2api_key)
            import_build(record, cfg.grok2api_url, cfg.grok2api_key)
            add_log(task_id, "info", "Imported to grok2api (Web + Build)")

        upsert_task(task_id, "register", 100, "done", result=email)
        add_log(task_id, "info", "Registration complete")
    except Exception as exc:  # noqa: BLE001
        upsert_task(task_id, "register", 0, "failed", result=str(exc))
        add_log(task_id, "error", f"Registration failed: {exc}")


def enqueue(email_provider: str, captcha_type: str) -> str:
    task_id = uuid.uuid4().hex
    upsert_task(task_id, "register", 0, "queued")
    t = threading.Thread(target=_run_task, args=(task_id, email_provider, captcha_type), daemon=True)
    t.start()
    return task_id


def enqueue_batch(count: int, email_provider: str, captcha_type: str) -> list:
    return [enqueue(email_provider, captcha_type) for _ in range(max(1, min(count, 8)))]


def progress(task_id: str) -> dict:
    return get_task(task_id)
