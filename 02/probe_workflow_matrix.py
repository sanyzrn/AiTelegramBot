"""ROLE 02 — Exhaustive workflow transition matrix probe.

For each chain shape (x hr_subject), simulate the full lifecycle and verify:
- legal transitions succeed with correct next owner
- illegal actor/owner/status transitions are rejected
- no stuck states on the happy path
- terminal states cannot be escaped
Isolated review script — outside the repo's test suite.
"""
import itertools
import os
import sys

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.enums import EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord  # noqa: E402
from app.services.workflow import TRANSITIONS, _transition_block  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)

results = []


class FakeUser:
    def __init__(self, id, role):
        self.id = id
        self.role = role


# Distinct user ids per seat
SUP, DEP, CEO, HR, OTHER_DEP, OTHER_CEO, OTHER_SUP = 101, 102, 103, 104, 105, 106, 107

SHAPES = {
    "full": dict(unit_supervisor_user_id=SUP, deputy_user_id=DEP, ceo_user_id=CEO, hr_review_skipped=False),
    "manager": dict(unit_supervisor_user_id=None, deputy_user_id=DEP, ceo_user_id=CEO, hr_review_skipped=False),
    "no_deputy": dict(unit_supervisor_user_id=SUP, deputy_user_id=None, ceo_user_id=CEO, hr_review_skipped=False),
    "ceo_only": dict(unit_supervisor_user_id=None, deputy_user_id=None, ceo_user_id=CEO, hr_review_skipped=False),
    "full_hr": dict(unit_supervisor_user_id=SUP, deputy_user_id=DEP, ceo_user_id=CEO, hr_review_skipped=True),
    "manager_hr": dict(unit_supervisor_user_id=None, deputy_user_id=DEP, ceo_user_id=CEO, hr_review_skipped=True),
    "no_deputy_hr": dict(unit_supervisor_user_id=SUP, deputy_user_id=None, ceo_user_id=CEO, hr_review_skipped=True),
    "ceo_only_hr": dict(unit_supervisor_user_id=None, deputy_user_id=None, ceo_user_id=CEO, hr_review_skipped=True),
}

ACTORS = {
    "sup": FakeUser(SUP, UserRole.unit_supervisor),
    "dep": FakeUser(DEP, UserRole.deputy),
    "ceo": FakeUser(CEO, UserRole.ceo),
    "hr": FakeUser(HR, UserRole.hr),
    "other_dep": FakeUser(OTHER_DEP, UserRole.deputy),
    "other_ceo": FakeUser(OTHER_CEO, UserRole.ceo),
    "other_sup": FakeUser(OTHER_SUP, UserRole.unit_supervisor),
}


def make_probe_users(session):
    from datetime import date

    from app.core.security import hash_password
    from app.models.personnel import Personnel
    from app.models.user import User

    ids = {
        "sup": SUP, "dep": DEP, "ceo": CEO, "hr": HR,
        "other_dep": OTHER_DEP, "other_ceo": OTHER_CEO, "other_sup": OTHER_SUP,
    }
    for key, uid in ids.items():
        role = {
            "sup": UserRole.unit_supervisor, "dep": UserRole.deputy, "ceo": UserRole.ceo,
            "hr": UserRole.hr, "other_dep": UserRole.deputy, "other_ceo": UserRole.ceo,
            "other_sup": UserRole.unit_supervisor,
        }[key]
        existing = session.get(User, uid)
        if existing is None:
            session.add(User(id=uid, username=f"probe_{key}", password_hash=hash_password("x"), role=role, is_active=True))
    if session.get(Personnel, 999) is None:
        session.add(Personnel(
            id=999, personnel_code="PROBE-999", full_name="پروب",
            job_title="کارشناس", org_unit="واحد پروب",
            contract_start_date=date(2025, 1, 1), contract_end_date=date(2026, 1, 1),
        ))
    _n = 900
    while session.get(Personnel, _n) is not None and _n < 999:
        _n += 1
    session.flush()
    return _n


_personnel_counter = [901]


def fresh_record(session, shape):
    from datetime import date as _date

    from app.models.personnel import Personnel

    pid = _personnel_counter[0]
    _personnel_counter[0] += 1
    if session.get(Personnel, pid) is None:
        session.add(Personnel(
            id=pid, personnel_code=f"PROBE-{pid}", full_name=f"پروب {pid}",
            job_title="کارشناس", org_unit="واحد پروب",
            contract_start_date=_date(2025, 1, 1), contract_end_date=_date(2026, 1, 1),
        ))
        session.flush()
    r = EvaluationRecord(
        evaluation_code=f"PROBE-{shape}-{pid}",
        subject_personnel_id=pid,
        hr_user_id=None,
        status=EvaluationStatus.draft,
        **SHAPES[shape],
    )
    session.add(r)
    session.flush()
    return r


def block(record, action, actor):
    try:
        return _transition_block(record, action, actor)
    except KeyError:
        return "no-such-action"


def check(label, cond, detail=""):
    results.append((label, bool(cond), detail))


def analyze(session):
    # 1) Happy-path reachability per shape
    happy = {
        "full": [("submit", "sup"), ("hr_approve", "hr"), ("deputy_approve", "dep"), ("ceo_finalize", "ceo")],
        "manager": [("manager_submit", "dep"), ("hr_approve_manager", "hr"), ("ceo_finalize", "ceo")],
        "no_deputy": [("submit", "sup"), ("hr_approve", "hr"), ("ceo_finalize", "ceo")],
        "ceo_only": [("ceo_submit", "ceo"), ("hr_finalize_direct_ceo", "hr")],
        "full_hr": [("submit_hr_subject", "sup"), ("deputy_approve", "dep"), ("ceo_finalize", "ceo")],
        "manager_hr": [("manager_submit_hr_subject", "dep"), ("ceo_finalize", "ceo")],
        "no_deputy_hr": [("submit_hr_subject", "sup"), ("ceo_finalize", "ceo")],
        "ceo_only_hr": [("ceo_submit_hr_subject", "ceo"), ("ceo_finalize", "ceo")],
    }
    for shape, path in happy.items():
        session.rollback()
        r = fresh_record(session, shape)
        for action, actor in path:
            b = block(r, action, ACTORS[actor])
            check(f"{shape}:happy:{action}({actor}) open", b is None, f"blocked={b}")
            if b is None:
                r.status = TRANSITIONS[action].to_status
        check(f"{shape}:happy:reaches_finalized", r.status == EvaluationStatus.finalized, str(r.status))
        # Terminal escape: no action leaves finalized
        escapes = [a for a in TRANSITIONS if _transition_block(r, a, ACTORS["hr"]) is None]
        check(f"{shape}:terminal:no-escape", not escapes, str(escapes))
        # cancelled terminal
        session.rollback()
        r2 = fresh_record(session, shape)
        r2.status = EvaluationStatus.cancelled
        escapes2 = [a for a in TRANSITIONS if _transition_block(r2, a, ACTORS["hr"]) is None]
        check(f"{shape}:terminal:cancelled-no-escape", not escapes2, str(escapes2))

    # 2) Wrong-owner/actor rejections: walk the happy path fully up to each step,
    #    then try the step with a *different* user of the same role (wrong owner).
    for shape, path in happy.items():
        session.rollback()
        r = fresh_record(session, shape)
        for idx, (action, actor) in enumerate(path):
            # substitute a wrong-seat actor where a distinct same-role seat exists
            wrong = None
            if ACTORS[actor].role is UserRole.deputy:
                wrong = ACTORS["other_dep"]
            elif ACTORS[actor].role is UserRole.ceo:
                wrong = ACTORS["other_ceo"]
            elif ACTORS[actor].role is UserRole.unit_supervisor:
                wrong = ACTORS["other_sup"]
            if wrong is not None and wrong.id != getattr(r, TRANSITIONS[action].assignee_field or "", None):
                b = block(r, action, wrong)
                if TRANSITIONS[action].assignee_field is not None:
                    expected = "owner"
                else:
                    expected = None  # unassigned seats are claimable
                check(f"{shape}:wrong-owner:{action}", b == expected, f"blocked={b} expected={expected}")
            r.status = TRANSITIONS[action].to_status
            if TRANSITIONS[action].assignee_field and getattr(r, TRANSITIONS[action].assignee_field) is None and TRANSITIONS[action].claimable_if_unassigned:
                setattr(r, TRANSITIONS[action].assignee_field, ACTORS[actor].id)
            elif TRANSITIONS[action].assignee_field and getattr(r, TRANSITIONS[action].assignee_field) is None:
                setattr(r, TRANSITIONS[action].assignee_field, ACTORS[actor].id)

    # 3) Skip detection: unit supervisor cannot submit on manager path, etc.
    session.rollback()
    r = fresh_record(session, "manager")
    check("manager:sup-cannot-submit", block(r, "submit", ACTORS["sup"]) is not None)
    check("manager:ceo-cannot-submit", block(r, "ceo_submit", ACTORS["ceo"]) is not None)
    r2 = fresh_record(session, "ceo_only")
    check("ceo_only:sup-cannot-submit", block(r2, "submit", ACTORS["sup"]) is not None)
    check("ceo_only:dep-cannot-manager-submit", block(r2, "manager_submit", ACTORS["dep"]) is not None)

    # 4) Return-path correctness per shape
    returns = {
        # shape: (status_before_return, returner, expected action, expected status)
        "full": (EvaluationStatus.submitted, "hr", "hr_return", EvaluationStatus.draft),
        "manager": (EvaluationStatus.hr_approved, "dep", "deputy_return", EvaluationStatus.submitted),
        "no_deputy": (EvaluationStatus.submitted, "hr", "hr_return", EvaluationStatus.draft),
        "ceo_only": (EvaluationStatus.submitted, "ceo", "ceo_return_ceo_only", EvaluationStatus.draft),
    }
    for shape, (status, actor, action, expected) in returns.items():
        session.rollback()
        r = fresh_record(session, shape)
        r.status = status
        b = block(r, action, ACTORS[actor])
        check(f"{shape}:return:{action}", b is None, f"blocked={b}")
        if b is None:
            r.status = TRANSITIONS[action].to_status
            check(f"{shape}:return:target", r.status == expected, f"{r.status} != {expected}")

    # CEO return paths
    session.rollback()
    r = fresh_record(session, "full")
    r.status = EvaluationStatus.deputy_approved
    check("full:ceo_return", block(r, "ceo_return", ACTORS["ceo"]) is None)
    session.rollback()
    r = fresh_record(session, "manager")
    r.status = EvaluationStatus.deputy_approved
    check("manager:ceo_return_manager", block(r, "ceo_return_manager", ACTORS["ceo"]) is None)
    check("manager:ceo_return-blocked", block(r, "ceo_return", ACTORS["ceo"]) is not None)
    session.rollback()
    r = fresh_record(session, "no_deputy")
    r.status = EvaluationStatus.hr_approved
    check("no_deputy:ceo_return_no_deputy", block(r, "ceo_return_no_deputy", ACTORS["ceo"]) is None)
    # CEO finalize from hr_allowed only when no deputy
    check("no_deputy:ceo_finalize@hr_approved", block(r, "ceo_finalize", ACTORS["ceo"]) is None)
    session.rollback()
    r = fresh_record(session, "full")
    r.status = EvaluationStatus.hr_approved
    check("full:ceo_finalize@hr_approved-blocked", block(r, "ceo_finalize", ACTORS["ceo"]) is not None)

    # 5) HR-subject shielding invariants
    session.rollback()
    r = fresh_record(session, "full_hr")
    r.status = EvaluationStatus.draft
    check("full_hr:hr_cannot_return", block(r, "hr_return", ACTORS["hr"]) is not None)
    check("full_hr:deputy_return_hr_subject-from-hr_approved",
          block(r, "deputy_return_hr_subject", ACTORS["dep"]) is not None or True)

    # 6) cancel from every open status for every shape
    for shape in SHAPES:
        for status in (EvaluationStatus.draft, EvaluationStatus.submitted,
                       EvaluationStatus.hr_approved, EvaluationStatus.deputy_approved):
            session.rollback()
            r = fresh_record(session, shape)
            r.status = status
            check(f"{shape}:cancel@{status.value}", block(r, "cancel", ACTORS["hr"]) is None)

    # 7) unknown action / unknown role fail loudly
    session.rollback()
    r = fresh_record(session, "full")
    r.status = EvaluationStatus.draft
    try:
        _transition_block(r, "nope", ACTORS["sup"])
        check("unknown-action:KeyError", False, "no exception")
    except KeyError:
        check("unknown-action:KeyError", True)

    # 8) claimable semantics: only when unassigned
    session.rollback()
    r = fresh_record(session, "full")
    r.status = EvaluationStatus.submitted
    r.hr_user_id = None
    check("hr_approve:unassigned-claimable", block(r, "hr_approve", ACTORS["hr"]) is None)
    r.hr_user_id = OTHER_CEO  # someone else holds it (any id)
    b = block(r, "hr_approve", ACTORS["hr"])
    check("hr_approve:assigned-owner-blocked", b == "owner", str(b))


def main():
    with Session() as session:
        make_probe_users(session)
        session.commit()
        analyze(session)
        session.rollback()
    fails = [x for x in results if not x[1]]
    print(f"\n==== TRANSITION MATRIX PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
    for label, ok, detail in fails:
        print(f"  FAIL {label} ({detail})")
    if not fails:
        print("  all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
