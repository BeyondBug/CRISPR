"""LLM client for the AI Risk Advisor.

Talks to an OpenAI-compatible model API. Configuration
comes from environment variables loaded from .env:

    LLM_BASE_URL  (default: https://openrouter.ai/api/v1)
    LLM_API_KEY   (required for LLM features)
    LLM_MODEL     (default: inclusionai/ling-3.0-flash-sante:free)
    OPENROUTER_API_KEY (optional backup key, separate from Groq)
    OPENROUTER_MODEL   (optional backup model)
    LLM_ENABLED   (set to 'false' to force template-only answers)

The advisor NEVER depends on this module being reachable — every caller
must fall back to deterministic templates when chat() returns None.
"""

import logging
import os
import time
from typing import Callable, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "inclusionai/ling-3.0-flash-sante:free"
REQUEST_TIMEOUT_S = 90.0
AVAILABILITY_TIMEOUT_S = 25.0
AVAILABILITY_TTL_S = 60.0

logger = logging.getLogger(__name__)

_client: Optional[httpx.Client] = None
_backup_client: Optional[httpx.Client] = None
_last_availability_check: float = 0.0
_available: bool = False


def _settings() -> tuple[str, str, bool]:
    base_url = (os.environ.get("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/")
    api_key = os.environ.get("LLM_API_KEY", "")
    enabled = os.environ.get("LLM_ENABLED", "true").strip().lower() != "false"
    return base_url, api_key, enabled


def get_client() -> httpx.Client:
    global _client
    if _client is None:
        base_url, api_key, _ = _settings()
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        _client = httpx.Client(base_url=base_url, headers=headers, timeout=REQUEST_TIMEOUT_S)
    return _client


def _providers() -> list[tuple[str, str, str]]:
    """Primary provider first, then the explicitly configured OpenRouter backup."""
    base_url, api_key, enabled = _settings()
    if not enabled:
        return []
    providers = []
    if api_key:
        providers.append((base_url, api_key, os.getenv("LLM_MODEL", "").strip() or DEFAULT_MODEL))
    backup_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if backup_key and base_url != DEFAULT_BASE_URL:
        providers.append((DEFAULT_BASE_URL, backup_key,
                          os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL))
    return providers


def is_available(force_check: bool = False) -> bool:
    """Whether a provider is configured; chat performs the actual availability check.

    A failed primary /models probe must not prevent trying the backup provider.
    """
    return bool(_providers())


def _provider_client(base_url: str) -> httpx.Client:
    global _backup_client
    if base_url == _settings()[0]:
        return get_client()
    if _backup_client is None:
        _backup_client = httpx.Client(base_url=base_url, timeout=REQUEST_TIMEOUT_S)
    return _backup_client


def chat(
    task: str,
    system: str,
    user: str,
    max_tokens: int = 700,
    temperature: float = 0.2,
    request_timeout_s: float = REQUEST_TIMEOUT_S,
    max_attempts: Optional[int] = None,
    validate_answer: Optional[Callable[[str], bool]] = None,
) -> Optional[str]:
    """Generate a completion with the configured model for every advisor task.

    Returns None on any failure (router down, key missing, timeout) so
    callers can fall back to deterministic templates.
    """
    providers = _providers()
    if max_attempts is not None:
        providers = providers[:max_attempts]
    deadline = time.monotonic() + request_timeout_s
    for index, (base_url, api_key, model) in enumerate(providers):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        timeout = remaining / (len(providers) - index)
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        if "openrouter.ai" in base_url:
            payload["reasoning"] = {"enabled": False, "exclude": True}
        elif "api.groq.com" in base_url and model.startswith("openai/gpt-oss-"):
            payload["reasoning_effort"] = "low"
            payload["include_reasoning"] = False
            # Groq's limit includes reasoning tokens as well as the answer.
            payload["max_completion_tokens"] = max(max_tokens, 2048)
            del payload["max_tokens"]
        try:
            response = _provider_client(base_url).post(
                "/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=timeout,
            )
            response.raise_for_status()
            body = response.json()
            choice = body["choices"][0]
            if choice.get("finish_reason") == "length":
                logger.warning("LLM completion truncated (model=%s)", model)
                continue
            content = choice["message"]["content"]
            if isinstance(content, str) and content.strip():
                if content.strip().lower().startswith(("user safety:", "safety classification:")):
                    logger.warning("LLM returned a safety classification instead of an answer (model=%s)", model)
                    continue
                if validate_answer is not None and not validate_answer(content.strip()):
                    logger.warning("LLM answer rejected by validation (model=%s)", model)
                    continue
                return content.strip()
        except httpx.HTTPStatusError as error:
            logger.warning("LLM request failed (model=%s, status=%s)", model, error.response.status_code)
        except Exception as error:
            logger.warning("LLM request failed (model=%s, error=%s)", model, type(error).__name__)
    return None


def route_with_llm(question: str, candidates: list[str]) -> Optional[str]:
    """Ask the fast model to classify intent when keywords miss."""
    _, _, enabled = _settings()
    if not enabled or not is_available():
        return None
    raw = chat(
        task="route",
        system="Classify the user question into exactly one intent from this list: "
               + ", ".join(candidates)
               + ". Reply with ONLY the intent name, nothing else.",
        user=question,
        max_tokens=10,
        temperature=0.0,
    )
    if raw is None:
        return None
    cleaned = raw.strip().lower().replace(" ", "_")
    return cleaned if cleaned in candidates else None
