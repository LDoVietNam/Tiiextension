"""GrokHub FastAPI backend entrypoint."""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import load_config
from models import init_db, list_accounts, list_tokens, pool_status
from core.task_runner import enqueue, enqueue_batch, progress
from serve.openai_proxy import chat_completions

app = FastAPI(title="GrokHub", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

cfg = load_config()
init_db()


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/config")
def get_config():
    return {
        "sso_referrer": cfg.sso_referrer,
        "base_url": cfg.base_url,
        "client_version": cfg.client_version,
        "captcha_type": cfg.captcha_type,
        "email_providers": [p.strip() for p in cfg.email_providers.split(",") if p.strip()],
        "cpa_local_configured": bool(cfg.cpa_local_dir),
        "cpa_remote_configured": bool(cfg.cpa_mgmt_api_url),
        "grok2api_configured": bool(cfg.grok2api_url),
    }


@app.get("/accounts")
def get_accounts():
    return {"accounts": list_accounts()}


@app.get("/tokens")
def get_tokens():
    return {"pool": pool_status(), "tokens": list_tokens()}


@app.post("/register")
def register(body: dict):
    provider = body.get("email_provider") or cfg.email_providers.split(",")[0]
    task_id = enqueue(provider, cfg.captcha_type)
    return {"task_id": task_id}


@app.post("/register/batch")
def register_batch(body: dict):
    count = int(body.get("count", 1))
    provider = body.get("email_provider") or cfg.email_providers.split(",")[0]
    task_ids = enqueue_batch(count, provider, cfg.captcha_type)
    return {"task_ids": task_ids}


@app.get("/tasks/{task_id}")
def get_task_status(task_id: str):
    return progress(task_id)


@app.post("/v1/chat/completions")
async def chat(request: Request):
    return await chat_completions(request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=cfg.bind_host, port=cfg.bind_port)
