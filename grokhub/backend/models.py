"""ORM-style row helpers + init for GrokHub SQLite store."""
from datetime import datetime, timezone

from db import db, init_db


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_account(email: str, status: str = "pending") -> int:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO accounts(email, status, created_at) VALUES(?,?,?)",
            (email, status, now_iso()),
        )
        return cur.lastrowid


def update_account_status(account_id: int, status: str) -> None:
    with db() as conn:
        conn.execute("UPDATE accounts SET status=? WHERE id=?", (status, account_id))


def insert_token(
    account_id: int,
    access_token: str,
    refresh_token: str,
    base_url: str,
    headers: str,
    expires_at: str = "",
) -> int:
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO tokens(account_id, access_token, refresh_token, base_url, headers, expires_at, in_pool)
               VALUES(?,?,?,?,?,?,1)""",
            (account_id, access_token, refresh_token, base_url, headers, expires_at),
        )
        return cur.lastrowid


def list_accounts() -> list:
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM accounts ORDER BY id DESC")]


def list_tokens() -> list:
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM tokens ORDER BY id DESC")]


def pool_status() -> dict:
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM tokens WHERE in_pool=1").fetchone()["c"]
        valid = conn.execute(
            "SELECT COUNT(*) c FROM tokens WHERE in_pool=1 AND (expires_at='' OR expires_at > ?)",
            (now_iso(),),
        ).fetchone()["c"]
    return {"total": total, "valid": valid, "expiring": total - valid}


def upsert_task(task_id: str, task_type: str, progress: int, status: str, result: str = "") -> None:
    with db() as conn:
        conn.execute(
            """INSERT INTO tasks(id, type, progress, status, result, created_at)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET progress=excluded.progress, status=excluded.status, result=excluded.result""",
            (task_id, task_type, progress, status, result, now_iso()),
        )


def get_task(task_id: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None


def add_log(task_id: str, level: str, msg: str) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO logs(task_id, level, msg, ts) VALUES(?,?,?,?)",
            (task_id, level, msg, now_iso()),
        )


def get_logs(task_id: str) -> list:
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM logs WHERE task_id=? ORDER BY id", (task_id,))]
