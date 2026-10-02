"""Verify OpenRouter requests and graceful failures without external API calls."""

import json

import httpx
import pytest

from ai.tools import llm


@pytest.fixture(autouse=True)
def configure(monkeypatch):
    monkeypatch.setenv("LLM_ENABLED", "true")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setattr(llm, "_client", None)
    monkeypatch.setattr(llm, "_last_availability_check", 0)


def install_transport(monkeypatch, handler):
    client = httpx.Client(base_url=llm.DEFAULT_BASE_URL, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(llm, "_client", client)
    return client


@pytest.mark.parametrize("task", ["route", "general", "explain", "agent", "mitigate"])
def test_all_tasks_use_pinned_free_model(monkeypatch, task):
    def handler(request):
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-key"
        assert json.loads(request.content)["model"] == "inclusionai/ling-3.0-flash-sante:free"
        assert json.loads(request.content)["reasoning"] == {"enabled": False, "exclude": True}
        return httpx.Response(200, json={"choices": [{"message": {"content": "Test answer"}}]})

    with install_transport(monkeypatch, handler):
        assert llm.chat(task, "system", "question") == "Test answer"


def test_model_override(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "example/model:free")

    def handler(request):
        assert json.loads(request.content)["model"] == "example/model:free"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    with install_transport(monkeypatch, handler):
        assert llm.chat("general", "system", "question") == "OK"


@pytest.mark.parametrize("status", [401, 429, 503])
def test_api_failure_returns_fallback_without_paid_retry(monkeypatch, status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, json={"error": {"message": "Unavailable"}})

    with install_transport(monkeypatch, handler):
        assert llm.chat("explain", "system", "question") is None
    assert len(requests) == 1


def test_missing_key_does_not_call_provider(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "")

    def handler(request):
        pytest.fail("Provider must not be called without a key")

    with install_transport(monkeypatch, handler):
        assert llm.is_available(force_check=True) is False
        assert llm.chat("general", "system", "question") is None


def test_blank_base_url_uses_openrouter(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "")
    assert llm._settings()[0] == llm.DEFAULT_BASE_URL


def test_truncated_completion_falls_back(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": "Incomplete answer"}}]})

    with install_transport(monkeypatch, handler):
        assert llm.chat("general", "system", "question") is None


def test_safety_classification_is_not_shown_as_an_answer(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "User Safety: safe"}}]})

    with install_transport(monkeypatch, handler):
        assert llm.chat("agent", "system", "question") is None


def test_groq_uses_supported_reasoning_parameters(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-120b")

    def handler(request):
        assert str(request.url) == "https://api.groq.com/openai/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["model"] == "openai/gpt-oss-120b"
        assert payload["reasoning_effort"] == "low"
        assert payload["include_reasoning"] is False
        assert payload["max_completion_tokens"] == 2048
        assert "max_tokens" not in payload
        assert "reasoning" not in payload
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "Final answer"}}]})

    with httpx.Client(base_url="https://api.groq.com/openai/v1", transport=httpx.MockTransport(handler)) as client:
        monkeypatch.setattr(llm, "_client", client)
        assert llm.chat("general", "system", "question", max_tokens=350) == "Final answer"
