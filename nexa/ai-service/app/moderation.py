"""Fast, dependency-free first-pass moderation. Cheap enough to run on every message;
anything it flags can be escalated to the LLM or a human."""
import re

_RULES: dict[str, re.Pattern[str]] = {
    "self_harm": re.compile(r"\b(kill myself|end my life|suicide)\b", re.I),
    "threat": re.compile(r"\b(i('| wi)ll (kill|hurt|find) you)\b", re.I),
    "spam": re.compile(r"(https?://\S+.*){4,}|(.)\2{15,}", re.I | re.S),
}


def check(text: str) -> list[str]:
    return [name for name, rx in _RULES.items() if rx.search(text)]
