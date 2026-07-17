"""SQLite engine + session helper for GrokHub."""
import sqlite3
from contextlib import contextmanager

from config import load_config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    status TEXT,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS tokens(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    access_token TEXT,
    refresh_token TEXT,
    base_url TEXT,
    headers TEXT,
    expires_at TEXT,
    in_pool INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    level TEXT,
    msg TEXT,
    ts TEXT
);
CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,
    type TEXT,
    progress INTEGER DEFAULT 0,
    status TEXT,
    result TEXT,
    created_at TEXT
);
"""


def _connect() -> sqlite3.Connection:
    cfg = load_config()
    conn = sqlite3.connect(cfg.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
