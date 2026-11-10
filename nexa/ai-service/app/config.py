from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (12-factor)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str | None = None
    ai_model: str = "claude-sonnet-5-5"
    ai_service_token: str | None = None  # shared secret with the Node backend
    max_input_chars: int = 4000


@lru_cache
def get_settings() -> Settings:
    return Settings()
