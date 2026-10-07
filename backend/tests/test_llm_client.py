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
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    monkeypatch.setattr(llm, "_client", None)
    monkeypatch.setattr(llm, "_backup_client", None)
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


@pytest.mark.parametrize("failure", [401, 429, 503, "timeout", "invalid", "truncated", "classification", "financial"])
def test_groq_failure_tries_openrouter_with_separate_credentials(monkeypatch, failure):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setenv("OPENROUTER_API_KEY", "backup-key")
    calls = []

    def handler(request):
        calls.append(request.url.host)
        payload = json.loads(request.content)
        if request.url.host == "api.groq.com":
            assert request.headers["Authorization"] == "Bearer test-key"
            if failure == "timeout":
                raise httpx.ReadTimeout("Timeout", request=request)
            if failure == "invalid":
                return httpx.Response(200, json={"choices": []})
            if failure == "truncated":
                return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": "Partial"}}]})
            if failure in ("classification", "financial"):
                text = "User Safety: safe" if failure == "classification" else "Unsupported amount"
                return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})
            return httpx.Response(failure, json={"error": {"message": "Unavailable"}})
        assert request.url.host == "openrouter.ai"
        assert request.headers["Authorization"] == "Bearer backup-key"
        assert payload["model"] == llm.DEFAULT_MODEL
        assert "reasoning_effort" not in payload
        assert payload["reasoning"]["exclude"] is True
        return httpx.Response(200, json={"choices": [{"message": {"content": "Backup answer"}}]})

    transport = httpx.MockTransport(handler)
    with httpx.Client(base_url="https://api.groq.com/openai/v1", transport=transport) as primary, httpx.Client(base_url=llm.DEFAULT_BASE_URL, transport=transport) as backup:
        monkeypatch.setattr(llm, "_client", primary)
        monkeypatch.setattr(llm, "_backup_client", backup)
        assert llm.chat("explain", "system", "question", validate_answer=lambda text: text != "Unsupported amount") == "Backup answer"
    assert calls == ["api.groq.com", "openrouter.ai"]


def test_both_providers_fail_returns_template_signal(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "backup-key")
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(503)

    transport = httpx.MockTransport(handler)
    with httpx.Client(base_url="https://api.groq.com/openai/v1", transport=transport) as primary, httpx.Client(base_url=llm.DEFAULT_BASE_URL, transport=transport) as backup:
        monkeypatch.setattr(llm, "_client", primary)
        monkeypatch.setattr(llm, "_backup_client", backup)
        assert llm.chat("general", "system", "question") is None
    assert hosts == ["api.groq.com", "openrouter.ai"]


def test_missing_primary_key_still_allows_backup(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "backup-key")
    assert llm.is_available()
    assert llm._providers() == [(llm.DEFAULT_BASE_URL, "backup-key", llm.DEFAULT_MODEL)]


def test_disabled_llm_disables_both_providers(monkeypatch):
    monkeypatch.setenv("LLM_ENABLED", "false")
    monkeypatch.setenv("OPENROUTER_API_KEY", "backup-key")
    assert not llm.is_available()
    assert llm.chat("general", "system", "question") is None
