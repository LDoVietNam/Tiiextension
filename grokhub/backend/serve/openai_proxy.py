"""OpenAI-compatible /v1/chat/completions proxy backed by exported Grok tokens."""
import json

import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

from config import load_config, grok_auth_headers
from serve.token_pool import acquire_or_refresh


def _openai_error(message: str, status: int = 502) -> Response:
    return Response(
        content=json.dumps({"error": {"message": message, "type": "grokhub_error"}}),
        status_code=status,
        media_type="application/json",
    )


async def chat_completions(request: Request) -> Response:
    cfg = load_config()
    body = await request.body()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return _openai_error("Invalid JSON body", 400)

    token = acquire_or_refresh()
    if token is None:
        return _openai_error("No healthy Grok token available in pool", 503)

    headers = dict(grok_auth_headers())
    headers["Authorization"] = f"Bearer {token['access_token']}"
    headers["Content-Type"] = "application/json"

    upstream = cfg.base_url.rstrip("/") + "/chat/completions"

    try:
        if payload.get("stream"):
            return await _stream(upstream, payload, headers)
        async with httpx.AsyncClient(timeout=120, proxy=cfg.proxy or None) as client:
            resp = await client.post(upstream, content=json.dumps(payload), headers=headers)
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
    except httpx.HTTPStatusError as exc:
        return _openai_error(f"Upstream error: {exc.response.status_code}", exc.response.status_code)
    except httpx.HTTPError as exc:
        return _openai_error(f"Upstream request failed: {exc}")


async def _stream(upstream: str, payload: dict, headers: dict) -> StreamingResponse:
    cfg = load_config()

    async def gen():
        async with httpx.AsyncClient(timeout=120, proxy=cfg.proxy or None) as client:
            async with client.stream("POST", upstream, json=payload, headers=headers) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")
