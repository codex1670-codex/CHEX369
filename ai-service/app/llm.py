"""Thin wrapper around the Anthropic SDK so routes stay testable (tests replace `complete`)."""
from anthropic import AsyncAnthropic

from .config import get_settings


class LLMUnavailable(RuntimeError):
    pass


async def complete(system: str, messages: list[dict[str, str]], max_tokens: int = 700) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not configured")
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model=settings.ai_model, max_tokens=max_tokens, system=system, messages=messages
    )
    return "".join(block.text for block in msg.content if block.type == "text").strip()
