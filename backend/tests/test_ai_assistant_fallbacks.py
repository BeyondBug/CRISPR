from ai.assistant import query_engine


def test_full_analysis_supplies_top_risk_total_as_verified_evidence(monkeypatch):
    monkeypatch.setattr(query_engine.risk_tools, "get_enterprise_summary", lambda org: {"total_eal_inr": 600000})
    monkeypatch.setattr(query_engine.risk_tools, "get_all_risks", lambda org: {"risks": [{"eal_inr": 200000}, {"eal_inr": 100000}]})
    monkeypatch.setattr(query_engine, "load_assets", lambda org: [])
    monkeypatch.setattr(query_engine, "load_findings", lambda **kwargs: [])
    _, data = query_engine._answer_full_analysis("executive analysis", "org-1")
    assert data["top_risks_total_eal_inr"] == 300000
    assert query_engine.guardrail_validate("Top exposures total ₹3 lakh", data)["ok"]


def test_drawer_presets_route_to_distinct_intents():
    prompts = {
        "Explain my highest-risk finding": "top_risk",
        "Show exposed assets": "exposed_assets",
        "Why did risk increase?": "risk_increase",
        "Summarize today's security activity": "security_activity",
    }

    assert {query_engine.route_intent(prompt) for prompt in prompts} == set(prompts.values())
    for prompt, expected in prompts.items():
        assert query_engine.route_intent(prompt) == expected


def test_exposed_asset_fallback_uses_current_inventory(monkeypatch):
    monkeypatch.setattr(
        query_engine,
        "load_assets",
        lambda organization_id: [
            {"asset_id": "A-1", "name": "Public API", "internet_facing": True},
            {"asset_id": "A-2", "name": "Internal DB", "internet_facing": False},
        ],
    )

    answer, data = query_engine._answer_exposed_assets(organization_id="org-1")

    assert "1 of 2 assets" in answer
    assert "Public API" in answer
    assert data["exposed_assets"][0]["asset_id"] == "A-1"


def test_general_security_fallbacks_are_unique_when_llm_is_offline(monkeypatch):
    monkeypatch.setattr(query_engine, "chat", lambda **kwargs: None)
    questions = ["What is phishing?", "Explain ransomware", "What is SQL injection?", "Explain CVSS"]

    answers = [query_engine._answer_general(question)[0] for question in questions]

    assert len(set(answers)) == len(questions)
    assert all("₹" not in answer for answer in answers)
    assert all(query_engine._answer_general(question)[2] == "template" for question in questions)


def test_project_glossary_answers_without_llm(monkeypatch):
    monkeypatch.setattr(query_engine, "chat", lambda **kwargs: None)

    rosi, _, engine = query_engine._answer_general("What is ROSI?")
    fair, _, _ = query_engine._answer_general("Explain FAIR")
    epss, _, _ = query_engine._answer_general("What is EPSS?")

    assert engine == "template"
    assert "Return on Security Investment" in rosi
    assert "Factor Analysis of Information Risk" in fair
    assert "next 30 days" in epss


def test_core_project_calculations_are_deterministic():
    eal, eal_data = query_engine._answer_project_calculation(
        "Calculate EAL for 20% annual probability and ₹1 crore loss magnitude"
    )
    rosi, rosi_data = query_engine._answer_project_calculation(
        "Calculate ROSI for ₹24 lakh risk reduction and ₹10 lakh cost"
    )
    residual, residual_data = query_engine._answer_project_calculation(
        "Calculate residual risk for ₹50 lakh at 40% effectiveness"
    )
    reduction, reduction_data = query_engine._answer_project_calculation(
        "Calculate risk reduction from ₹80 lakh to ₹50 lakh"
    )

    assert eal_data["eal_inr"] == 2_000_000
    assert rosi_data["rosi_pct"] == 140
    assert residual_data["residual_risk_inr"] == 3_000_000
    assert reduction_data["reduction_inr"] == 3_000_000
    assert all(answer for answer in (eal, rosi, residual, reduction))
