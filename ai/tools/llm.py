"""LLM client for the AI Risk Advisor.

Talks to an OpenAI-compatible model API. Configuration
comes from environment variables loaded from .env:

    LLM_BASE_URL  (default: https://openrouter.ai/api/v1)
    LLM_API_KEY   (required for LLM features)
    LLM_MODEL     (default: inclusionai/ling-3.0-flash-sante:free)
    LLM_ENABLED   (set to 'false' to force template-only answers)

The advisor NEVER depends on this module being reachable — every caller
must fall back to deterministic templates when chat() returns None.
"""

import logging
import os
import time
from typing import Optional

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


def is_available(force_check: bool = False) -> bool:
    global _last_availability_check, _available
    _, api_key, enabled = _settings()
    if not enabled or not api_key:
        return False
    now = time.monotonic()
    if not force_check and (now - _last_availability_check) < AVAILABILITY_TTL_S:
        return _available
    try:
        response = get_client().get("/models", timeout=AVAILABILITY_TIMEOUT_S)
        _available = response.status_code == 200
    except Exception:
        _available = False
    _last_availability_check = now
    return _available


def chat(
    task: str,
    system: str,
    user: str,
    max_tokens: int = 700,
    temperature: float = 0.2,
    request_timeout_s: float = REQUEST_TIMEOUT_S,
    max_attempts: Optional[int] = None,
) -> Optional[str]:
    """Generate a completion with the configured model for every advisor task.

    Returns None on any failure (router down, key missing, timeout) so
    callers can fall back to deterministic templates.
    """
    _, api_key, enabled = _settings()
    if not enabled or not api_key:
        return None
    # Use a specific assistant model; never select the random free router.
    models = [os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL]
    if max_attempts is not None:
        models = models[:max_attempts]
    for model in dict.fromkeys(models):
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
        if "openrouter.ai" in _settings()[0]:
            payload["reasoning"] = {"enabled": False, "exclude": True}
        elif "api.groq.com" in _settings()[0] and model.startswith("openai/gpt-oss-"):
            payload["reasoning_effort"] = "low"
            payload["include_reasoning"] = False
            # Groq's limit includes reasoning tokens as well as the answer.
            payload["max_completion_tokens"] = max(max_tokens, 2048)
            del payload["max_tokens"]
        try:
            response = get_client().post(
                "/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=request_timeout_s,
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
