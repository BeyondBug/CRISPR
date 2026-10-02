from ai.tools.guardrail import extract_money_claims, validate


def test_ordinary_prose_and_punctuation_do_not_match_currency():
    text = "Eavesdroppers, attackers, and users, can observe photons. It supports 20 users."
    assert extract_money_claims(text) == []
    assert validate(text, {}) == {"text": text, "violations": [], "ok": True}


def test_supported_currency_formats_are_still_checked():
    text = "₹1,00,000, Rs. 1 lakh, INR 100000, and 1 lakh."
    assert len(extract_money_claims(text)) == 4
    assert validate(text, {"cost_inr": 100000})["ok"] is True
    assert validate(text, {})["ok"] is False
