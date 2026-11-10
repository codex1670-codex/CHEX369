import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException

from . import llm, moderation
from .config import Settings, get_settings
from .schemas import (
    ChatRequest, ChatResponse, ModerateRequest, ModerateResponse,
    TranslateRequest, TranslateResponse,
)

log = logging.getLogger("nexa.ai")
app = FastAPI(title="Nexa AI Service", version="1.0.0")

SYSTEM_PROMPT = (
    "You are the in-app assistant for CHEX, a social app for chatting, sharing, games and learning. "
    "Be concise, friendly and safe. Always reply in the user's language (locale: {locale})."
)


def require_token(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """If AI_SERVICE_TOKEN is set, callers must send `Authorization: Bearer <token>`."""
    if not settings.ai_service_token:
        return
    expected = f"Bearer {settings.ai_service_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid service token")


@app.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {"ok": True, "llm_configured": bool(settings.anthropic_api_key), "model": settings.ai_model}


async def _ask(system: str, messages: list[dict[str, str]], max_tokens: int = 700) -> str:
    try:
        return await llm.complete(system, messages, max_tokens)
    except llm.LLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # network / provider errors must not leak internals
        log.exception("LLM call failed")
        raise HTTPException(status_code=502, detail="AI provider error") from exc


@app.post("/v1/chat", response_model=ChatResponse, dependencies=[Depends(require_token)])
async def chat(req: ChatRequest, settings: Settings = Depends(get_settings)) -> ChatResponse:
    messages = [t.model_dump() for t in req.history] + [{"role": "user", "content": req.message}]
    reply = await _ask(SYSTEM_PROMPT.format(locale=req.locale), messages)
    return ChatResponse(reply=reply, model=settings.ai_model)


@app.post("/v1/translate", response_model=TranslateResponse, dependencies=[Depends(require_token)])
async def translate(req: TranslateRequest) -> TranslateResponse:
    system = (
        "You are a translation engine. Translate the user's text into the language with BCP-47 tag "
        f"'{req.target}'. Output ONLY the translation, nothing else."
    )
    out = await _ask(system, [{"role": "user", "content": req.text}], max_tokens=1200)
    return TranslateResponse(translation=out)


@app.post("/v1/moderate", response_model=ModerateResponse, dependencies=[Depends(require_token)])
async def moderate(req: ModerateRequest) -> ModerateResponse:
    cats = moderation.check(req.text)
    return ModerateResponse(flagged=bool(cats), categories=cats)
