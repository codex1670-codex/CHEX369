import pytest
from fastapi.testclient import TestClient

from app import llm
from app.config import Settings, get_settings
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def test_health_reports_llm_status():
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key=None)
    body = client.get("/health").json()
    assert body["ok"] is True and body["llm_configured"] is False


def test_chat_503_without_api_key():
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key=None)
    r = client.post("/v1/chat", json={"message": "hi"})
    assert r.status_code == 503


def test_chat_uses_locale_and_history(monkeypatch):
    seen = {}

    async def fake(system, messages, max_tokens=700):
        seen.update(system=system, messages=messages)
        return "vanakkam!"

    monkeypatch.setattr(llm, "complete", fake)
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key="x")
    r = client.post("/v1/chat", json={"message": "hello", "locale": "ta-IN",
                                      "history": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200 and r.json()["reply"] == "vanakkam!"
    assert "ta-IN" in seen["system"]
    assert seen["messages"][-1] == {"role": "user", "content": "hello"}


def test_translate(monkeypatch):
    async def fake(system, messages, max_tokens=700):
        assert "'hi'" in system
        return "नमस्ते"

    monkeypatch.setattr(llm, "complete", fake)
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key="x")
    r = client.post("/v1/translate", json={"text": "hello", "target": "hi"})
    assert r.json()["translation"] == "नमस्ते"


def test_moderation_flags_threats_and_passes_normal_text():
    assert client.post("/v1/moderate", json={"text": "have a great day"}).json()["flagged"] is False
    r = client.post("/v1/moderate", json={"text": "I will kill you"}).json()
    assert r["flagged"] is True and "threat" in r["categories"]


def test_service_token_is_enforced():
    app.dependency_overrides[get_settings] = lambda: Settings(ai_service_token="s3cret")
    assert client.post("/v1/moderate", json={"text": "x"}).status_code == 401
    ok = client.post("/v1/moderate", json={"text": "x"}, headers={"Authorization": "Bearer s3cret"})
    assert ok.status_code == 200


def test_input_validation():
    assert client.post("/v1/chat", json={"message": ""}).status_code == 422
    assert client.post("/v1/translate", json={"text": "x" * 5000, "target": "fr"}).status_code == 422
