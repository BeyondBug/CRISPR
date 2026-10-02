"""Number guardrail — enforces 'AI never invents ₹ figures'.

Every LLM-generated answer passes through validate(): money amounts are
extracted from the text and checked against the set of figures actually
present in the fetched API data (including lakh/crore expansions and the
display rounding used by our formatters). Any figure that cannot be
traced back to the data is redacted and reported as a violation.
"""

import re
from typing import Optional

MONEY_PATTERN = re.compile(
    r"(?:₹\s*|\brs\.?\s*|\binr\s*)(\d[\d,]*(?:\.\d+)?)\s*(crore|cr|lakh|laks|lakh|l)?"
    r"|(\d[\d,]*(?:\.\d+)?)\s*(crore|lakh)\b",
    re.IGNORECASE,
)

UNIT_MULTIPLIERS = {"crore": 1e7, "cr": 1e7, "lakh": 1e5, "laks": 1e5, "l": 1e5}

RELATIVE_TOLERANCE = 0.015
ABSOLUTE_TOLERANCE_INR = 5_000


def _parse_number(text: str) -> float:
    return float(text.replace(",", ""))


def extract_money_claims(text: str) -> list[dict]:
    claims = []
    for match in MONEY_PATTERN.finditer(text):
        groups = match.groups()
        if groups[0] is not None:
            amount, unit = _parse_number(groups[0]), (groups[1] or "").lower()
        else:
            amount, unit = _parse_number(groups[2]), (groups[3] or "").lower()
        multiplier = UNIT_MULTIPLIERS.get(unit, 1.0)
        claims.append({
            "text": match.group(0).strip(),
            "amount": amount,
            "unit": unit,
            "value_inr": amount * multiplier,
        })
    return claims


def collect_allowed_values(data) -> set[float]:
    """Walk any JSON-shaped structure and gather every legitimate figure."""
    allowed: set[float] = set()

    def walk(node, key: Optional[str] = None):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, str(k))
        elif isinstance(node, list):
            for item in node:
                walk(item, key)
        elif isinstance(node, bool):
            return
        elif isinstance(node, (int, float)):
            value = float(node)
            candidates = {value}
            key_lower = (key or "").lower()
            if key_lower.endswith(("_lakh", "_l")) or key_lower.startswith("total_eal_l"):
                candidates.add(value * 1e5)
            if key_lower.endswith("_crore"):
                candidates.add(value * 1e7)
            for base in list(candidates):
                candidates.add(round(base, 2))
                candidates.add(round(base, -3))
                candidates.add(float(int(base)))
                if base > 0:
                    candidates.add(round(base / 1e5, 1) * 1e5)
                    candidates.add(round(base / 1e5, 2) * 1e5)
                    candidates.add(round(base / 1e7, 1) * 1e7)
                    candidates.add(round(base / 1e7, 2) * 1e7)
            allowed.update(c for c in candidates if c == c)

    walk(data)
    return allowed


def _is_supported(value_inr: float, allowed: set[float]) -> bool:
    for candidate in allowed:
        scale = max(abs(candidate), 1.0)
        if abs(value_inr - candidate) <= ABSOLUTE_TOLERANCE_INR:
            return True
        if abs(value_inr - candidate) / scale <= RELATIVE_TOLERANCE:
            return True
    return False


def validate(text: str, data) -> dict:
    """Redact untraceable money figures from LLM output.

    Returns {"text", "violations", "ok"} — ok=False means at least one
    figure could not be traced to the fetched data and was redacted;
    callers should then prefer their deterministic template answer.
    """
    allowed = collect_allowed_values(data)
    violations = []

    def replace(match: re.Match) -> str:
        groups = match.groups()
        if groups[0] is not None:
            amount, unit = _parse_number(groups[0]), (groups[1] or "").lower()
        else:
            amount, unit = _parse_number(groups[2]), (groups[3] or "").lower()
        claimed = amount * UNIT_MULTIPLIERS.get(unit, 1.0)
        if _is_supported(claimed, allowed):
            return match.group(0)
        violations.append(match.group(0).strip())
        return "[redacted]"

    cleaned = MONEY_PATTERN.sub(replace, text)
    return {"text": cleaned, "violations": violations, "ok": len(violations) == 0}
