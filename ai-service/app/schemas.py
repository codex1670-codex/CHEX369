from typing import Literal

from pydantic import BaseModel, Field


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    locale: str = Field(default="en", max_length=16, description="BCP-47 tag, e.g. 'ta-IN'")
    history: list[Turn] = Field(default_factory=list, max_length=30)


class ChatResponse(BaseModel):
    reply: str
    model: str


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    target: str = Field(min_length=2, max_length=16)


class TranslateResponse(BaseModel):
    translation: str
    detectedLanguage: str | None = None


class ModerateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ModerateResponse(BaseModel):
    flagged: bool
    categories: list[str]
