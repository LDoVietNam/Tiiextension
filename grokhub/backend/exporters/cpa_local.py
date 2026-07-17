"""Write exported auth record to a local CPA auth directory (hot-reload)."""
import os

from core.protocol_engine import ProtocolEngine


def write_auth(record: dict, cpa_local_dir: str) -> str:
    os.makedirs(cpa_local_dir, exist_ok=True)
    email = record.get("_email", "unknown")
    fname = f"xai-{email}.json"
    path = os.path.join(cpa_local_dir, fname)
    engine = ProtocolEngine()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(engine.export_json(record))
    return path
