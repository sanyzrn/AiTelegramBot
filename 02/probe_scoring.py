"""ROLE 03 — Scoring boundary probe + frontend/backend preview parity.

1. compute_result boundaries: absent sections, zero-weight sections, bonus caps,
   rounding, threshold edges (threshold-1/exact/threshold+1).
2. Replicate the frontend computePreview + round1 (banker's rounding via
   toFixed(20)) and appliedBonus in Python; compare against backend on
   randomized cases.
"""
import os
import random
import sys

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")

from decimal import ROUND_HALF_EVEN, Decimal  # noqa: E402

from app.core import constants  # noqa: E402
from app.services.evaluation import applied_bonus, compute_result  # noqa: E402
from app.services.scoring_scheme import LEGACY_RULES, Rules  # noqa: E402


class FakeIndicator:
    def __init__(self, section):
        self.section = type("S", (), {"value": section})()


results = []


def check(label, cond, detail=""):
    results.append((label, bool(cond), detail))


def backend_result(scores, indicators, rules, bonus=0.0):
    return compute_result(scores, indicators, rules, bonus_points=bonus)


# ---------- 1. Absent-section redistribution ----------
def t_absent_sections():
    ind_g = FakeIndicator("general")
    rules = LEGACY_RULES  # 0.6 / 0.4
    # Only general indicators present; all scored 5 → general 100%, spec absent
    res = backend_result([{"indicator_id": 1, "score": 5}], {1: ind_g}, rules)
    check("absent-spec:base=100", res["base_weighted_pct"] == 100.0, str(res))
    check("absent-spec:final=100", res["final_weighted_pct"] == 100.0, str(res))
    # Only specialized
    ind_s = FakeIndicator("specialized")
    res = backend_result([{"indicator_id": 1, "score": 5}], {1: ind_s}, rules)
    check("absent-gen:base=100", res["base_weighted_pct"] == 100.0, str(res))
    # Empty scores (both sections absent)
    res = backend_result([], {}, rules)
    check("empty:base=0", res["base_weighted_pct"] == 0.0, str(res))
    check("empty:recommendation=lowest", res["recommendation"] == rules.recommendation_for(0.0), str(res))


def t_zero_weight_sections():
    ind_g = FakeIndicator("general")
    ind_s = FakeIndicator("specialized")
    rules = Rules(
        general_section_weight=0.0, specialized_section_weight=0.0,
        evidence_required_scores=(1, 5), evidence_min_words=3, evidence_max_words=40,
        thresholds=LEGACY_RULES.thresholds, indicator_weights={},
        bonus_max_points=5.0,
    )
    # both present but zero weights → simple mean of present pcts
    res = backend_result(
        [{"indicator_id": 1, "score": 5}, {"indicator_id": 2, "score": 5}],
        {1: ind_g, 2: ind_s}, rules,
    )
    check("zero-weights:simple-mean=100", res["base_weighted_pct"] == 100.0, str(res))
    res = backend_result(
        [{"indicator_id": 1, "score": 3}, {"indicator_id": 2, "score": 5}],
        {1: ind_g, 2: ind_s}, rules,
    )
    check("zero-weights:simple-mean=80", res["base_weighted_pct"] == 80.0, str(res))


def t_weighted_indicators():
    ind_g = FakeIndicator("general")
    rules = Rules(
        general_section_weight=1.0, specialized_section_weight=0.0,
        evidence_required_scores=(1, 5), evidence_min_words=3, evidence_max_words=40,
        thresholds=LEGACY_RULES.thresholds, indicator_weights={1: 3.0, 2: 1.0},
        bonus_max_points=5.0,
    )
    # weighted: (5*3 + 1*1) / (5*3 + 5*1) = 16/20 = 80%
    res = backend_result(
        [{"indicator_id": 1, "score": 5}, {"indicator_id": 2, "score": 1}],
        {1: ind_g, 2: ind_g}, rules,
    )
    check("indicator-weights:80", res["general_score_pct"] == 80.0, str(res))
    check("indicator-weights:capped-100", res["general_score_pct"] <= 100.0, str(res))


def t_bonus_caps():
    ind_g = FakeIndicator("general")
    rules = Rules(
        general_section_weight=1.0, specialized_section_weight=0.0,
        evidence_required_scores=(1, 5), evidence_min_words=3, evidence_max_words=40,
        thresholds=LEGACY_RULES.thresholds, indicator_weights={},
        bonus_max_points=5.0,
    )
    res = backend_result([{"indicator_id": 1, "score": 5}], {1: ind_g}, rules, bonus=5.0)
    check("bonus:100+5=100", res["final_weighted_pct"] == 100.0, str(res))
    check("bonus:applied-0", res["bonus_points"] == 0.0, str(res))
    # base 98 → room 2, raw 5, scheme cap 5 → applied 2
    # scores: 5,5,5,5,4.9 not possible (integers). Use weights: 4 of 5 (80%) + bonus
    res = backend_result([{"indicator_id": 1, "score": 5}, {"indicator_id": 2, "score": 3}],
                         {1: ind_g, 2: ind_g}, rules, bonus=5.0)
    # base = (5+3)/10 = 80; applied = min(5, 5, 20) = 5 → 85
    check("bonus:80+5=85", res["final_weighted_pct"] == 85.0, str(res))
    check("bonus:applied-5", res["bonus_points"] == 5.0, str(res))
    # raw bonus beyond scheme cap
    res = backend_result([{"indicator_id": 1, "score": 3}], {1: ind_g}, rules, bonus=99.0)
    check("bonus:raw99-capped", res["bonus_points"] == 5.0 and res["final_weighted_pct"] == 65.0, str(res))
    # negative bonus → clamped to 0
    check("bonus:negative-clamped", applied_bonus(-5.0, rules, 50.0) == 0.0)


def t_threshold_edges():
    # thresholds from constants: check boundary semantics
    for upper, label in constants.FINAL_RESULT_THRESHOLDS:
        below = round(upper - 0.1, 1)
        res = backend_result([], {}, LEGACY_RULES)  # base 0
        # direct test of recommendation_for
        check(f"threshold:{upper}:below", LEGACY_RULES.recommendation_for(below) == label,
              f"{below} → {LEGACY_RULES.recommendation_for(below)} (want {label})")
    # exact threshold value: upper is exclusive → next bucket
    # exact threshold value: upper is exclusive → next bucket; top threshold is
    # unreachable (final_pct is capped at 100 by applied_bonus)
    for upper, label in constants.FINAL_RESULT_THRESHOLDS[:-1]:
        got = LEGACY_RULES.recommendation_for(float(upper))
        check(f"threshold:{upper}:exact-exclusive", got != label, f"exact {upper} → {got}")
    top = float(constants.FINAL_RESULT_THRESHOLDS[-1][0])
    check("threshold:top-unreachable-but-monotone",
          LEGACY_RULES.recommendation_for(100.0) == constants.FINAL_RESULT_THRESHOLDS[-1][1])


# ---------- 2. Frontend parity ----------
def js_round1(x: float) -> float:
    """Replicate frontend round1: read decimal expansion via toFixed(20), then
    round-half-even at 1 decimal."""
    # Python's format with 20 digits approximates JS toFixed(20)
    s = f"{x:.20f}"
    d = Decimal(s).quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN)
    return float(d)


def py_round1(x: float) -> float:
    return round(x, 1)


def frontend_compute_preview(drafts, indicators, config):
    """Faithful port of src/components/ScoreForm.tsx computePreview."""
    if not drafts or any(d["score"] is None for d in drafts):
        return None
    general_sum = general_max = specialized_sum = specialized_max = 0.0
    for d in drafts:
        w = config.get("indicator_weights", {}).get(str(d["indicator_id"]), 1)
        ind = indicators[d["indicator_id"]]
        if ind.section.value == "general":
            general_sum += d["score"] * w
            general_max += 5 * w
        else:
            specialized_sum += d["score"] * w
            specialized_max += 5 * w
    general_pct = js_round1((general_sum / general_max) * 100) if general_max else 0.0
    specialized_pct = js_round1((specialized_sum / specialized_max) * 100) if specialized_max else 0.0
    sections = [(general_pct, config["general_weight"], general_max),
                (specialized_pct, config["specialized_weight"], specialized_max)]
    present = [(pct, w) for pct, w, m in sections if m]
    weight_sum = sum(w for _, w in present)
    if not present:
        base = 0.0
    elif weight_sum > 0:
        base = js_round1(sum(p * w for p, w in present) / weight_sum)
    else:
        base = js_round1(sum(p for p, _ in present) / len(present))
    return {"general": general_pct, "specialized": specialized_pct, "base": base}


def frontend_applied_bonus(raw, config, base_pct):
    capped = max(0.0, min(raw, config["bonus_max_points"], 100 - base_pct))
    return round(capped * 100) / 100


def t_frontend_parity():
    random.seed(20260916)
    mismatches = []
    for trial in range(3000):
        n_gen = random.randint(0, 6)
        n_spec = random.randint(0, 6)
        if n_gen + n_spec == 0:
            continue
        indicators = {}
        drafts = []
        nid = 0
        for _ in range(n_gen):
            nid += 1
            indicators[nid] = FakeIndicator("general")
            drafts.append({"indicator_id": nid, "score": random.randint(1, 5)})
        for _ in range(n_spec):
            nid += 1
            indicators[nid] = FakeIndicator("specialized")
            drafts.append({"indicator_id": nid, "score": random.randint(1, 5)})
        gw = random.choice([0.6, 0.5, 1.0, 0.0, 0.7])
        sw = random.choice([0.4, 0.5, 0.0, 0.3, 1.0])
        weights = {i: random.choice([0.5, 1.0, 1.0, 1.0, 2.0, 3.0]) for i in indicators}
        rules = Rules(
            general_section_weight=gw, specialized_section_weight=sw,
            evidence_required_scores=(1, 5), evidence_min_words=3, evidence_max_words=40,
            thresholds=LEGACY_RULES.thresholds,
            indicator_weights=weights, bonus_max_points=5.0,
        )
        config = {
            "general_weight": gw, "specialized_weight": sw,
            "indicator_weights": {str(k): v for k, v in weights.items()},
            "bonus_max_points": 5.0,
        }
        bonus = random.choice([0.0, 0.0, 1.0, 2.5, 5.0, 7.0])
        be = backend_result(drafts, indicators, rules, bonus)
        fe = frontend_compute_preview(drafts, indicators, config)
        if be["base_weighted_pct"] != fe["base"]:
            mismatches.append((trial, "base", be["base_weighted_pct"], fe["base"]))
        if be["general_score_pct"] != fe["general"]:
            mismatches.append((trial, "general", be["general_score_pct"], fe["general"]))
        if be["specialized_score_pct"] != fe["specialized"]:
            mismatches.append((trial, "specialized", be["specialized_score_pct"], fe["specialized"]))
        # bonus parity
        fe_bonus = frontend_applied_bonus(bonus, config, fe["base"])
        if abs(be["bonus_points"] - fe_bonus) > 1e-9:
            mismatches.append((trial, "bonus", be["bonus_points"], fe_bonus))
    check(f"parity:3000-random-cases", not mismatches, str(mismatches[:8]))


def main():
    t_absent_sections()
    t_zero_weight_sections()
    t_weighted_indicators()
    t_bonus_caps()
    t_threshold_edges()
    t_frontend_parity()
    fails = [x for x in results if not x[1]]
    print(f"\n==== SCORING PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
    for label, ok, detail in fails:
        print(f"  FAIL {label} ({detail})")
    if not fails:
        print("  all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
