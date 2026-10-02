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


def test_million_unit_does_not_hide_a_tenfold_error():
    data = {"top_risks_total_eal_inr": 38900000}
    assert validate("Top risks total ₹38.9 million", data)["ok"]
    assert not validate("Top risks total ₹389 million", data)["ok"]


def test_small_nonfinancial_values_do_not_approve_money_claims():
    assert not validate("Costs ₹389", {"asset_count": 20, "risk_score": 87})["ok"]
