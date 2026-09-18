"""ROLE 07 — Concurrency race probe with real concurrent PostgreSQL sessions.

Scenarios (each with two concurrent transactions):
1. Double-submit: both pass ensure_transition_allowed before either commits.
2. Duplicate HR approval (claim race).
3. Audit hash-chain concurrent appends (advisory-lock serialization).
4. Duplicate evaluation creation (partial unique index race).
Each scenario records the T1/T2 interleaving and final state.
"""
import os
import sys
import threading
import time

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")

from datetime import UTC, date, datetime  # noqa: E402

from sqlalchemy import create_engine, select  # noqa: E402

from app.models.enums import EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.audit import verify_chain  # noqa: E402
from app.services.workflow import apply_transition  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])

results = []


def check(label, cond, detail=""):
    results.append((label, bool(cond), detail))


class FakeUser:
    def __init__(self, id, role, personnel_id=None):
        self.id = id
        self.role = role
        self.personnel_id = personnel_id


def make_session():
    from sqlalchemy.orm import sessionmaker

    return sessionmaker(bind=engine)()


def seed():
    from app.core.security import hash_password
    from app.models.personnel import Personnel

    s = make_session()
    for uid, uname, role in [
        (201, "race_sup", UserRole.unit_supervisor),
        (202, "race_dep", UserRole.deputy),
        (203, "race_ceo", UserRole.ceo),
        (204, "race_hr1", UserRole.hr),
        (205, "race_hr2", UserRole.hr),
        (206, "race_sup2", UserRole.unit_supervisor),
    ]:
        if s.get(User, uid) is None:
            s.add(User(id=uid, username=uname, password_hash=hash_password("x"), role=role, is_active=True))
    for pid in (601, 602, 603, 604):
        if s.get(Personnel, pid) is None:
            s.add(Personnel(
                id=pid, personnel_code=f"RACE-{pid}", full_name=f"مسابقه {pid}",
                job_title="کارشناس", org_unit="واحد مسابقه",
                contract_start_date=date(2025, 1, 1), contract_end_date=date(2026, 1, 1),
            ))
    s.commit()
    s.close()


def cleanup():
    # NOTE: audit_log is append-only by DB trigger (cannot delete probe events);
    # leftover probe events keep the chain valid and are harmless here.
    s = make_session()
    from sqlalchemy import delete

    from app.models.evaluation import EvaluationScore

    s.execute(delete(EvaluationScore).where(EvaluationScore.evaluation_record_id.in_(
        select(EvaluationRecord.id).where(EvaluationRecord.evaluation_code.like("RACE-%"))
    )))
    s.execute(delete(EvaluationRecord).where(EvaluationRecord.evaluation_code.like("RACE-%")))
    s.commit()
    s.close()


def make_record(pid, **kw):
    s = make_session()
    code = kw.pop("code")
    r = EvaluationRecord(
        evaluation_code=code,
        subject_personnel_id=pid,
        hr_user_id=None,
        status=EvaluationStatus.draft,
        **kw,
    )
    s.add(r)
    s.commit()
    rid = r.id
    s.close()
    return rid


def race_double_submit():
    """T1 and T2 both submit the same draft concurrently."""
    rid = make_record(601, code="RACE-DS", unit_supervisor_user_id=201,
                      deputy_user_id=202, ceo_user_id=203, hr_review_skipped=False)
    actor = FakeUser(201, UserRole.unit_supervisor)
    barrier = threading.Barrier(2)
    outcomes = {}

    def worker(name):
        s = make_session()
        try:
            barrier.wait(timeout=10)
            rec = s.scalar(
                select(EvaluationRecord).where(EvaluationRecord.id == rid)
                .with_for_update(of=EvaluationRecord)
            )
            from app.services.workflow import _transition_block

            b = _transition_block(rec, "submit", actor)
            if b is None:
                rec.status = EvaluationStatus.submitted
                outcomes[name] = "submitted"
            else:
                outcomes[name] = f"blocked:{b}"
            time.sleep(0.2)
            s.commit()
        except Exception as e:
            s.rollback()
            outcomes[name] = f"error:{type(e).__name__}"
        finally:
            s.close()

    t1 = threading.Thread(target=worker, args=("T1",))
    t2 = threading.Thread(target=worker, args=("T2",))
    t1.start(); t2.start(); t1.join(); t2.join()
    s = make_session()
    final = s.get(EvaluationRecord, rid).status
    s.close()
    check("race:double-submit:single-transition",
          final == EvaluationStatus.submitted and sorted(outcomes.values()) == ["blocked:stage", "submitted"],
          f"outcomes={outcomes} final={final}")


def race_duplicate_claim():
    """Two HR users claim the same unowned case concurrently via hr_approve."""
    rid = make_record(602, code="RACE-CL", unit_supervisor_user_id=201,
                      deputy_user_id=202, ceo_user_id=203, hr_review_skipped=False)
    # pre-advance to submitted with scores stamped (bypass guards for race focus)
    s = make_session()
    rec = s.get(EvaluationRecord, rid)
    rec.status = EvaluationStatus.submitted
    rec.final_weighted_pct = 50.0
    rec.base_weighted_pct = 50.0
    from app.models.evaluation import EvaluationScore

    s.add(EvaluationScore(evaluation_record_id=rid, indicator_id=1, score=3))
    s.commit()
    s.close()

    barrier = threading.Barrier(2)
    outcomes = {}

    def worker(name, uid):
        s = make_session()
        user = FakeUser(uid, UserRole.hr)
        try:
            barrier.wait(timeout=10)
            rec = s.scalar(
                select(EvaluationRecord).where(EvaluationRecord.id == rid)
                .with_for_update(of=EvaluationRecord)
            )
            apply_transition(s, rec, "hr_approve", user)
            s.commit()
            outcomes[name] = "approved"
        except Exception as e:
            s.rollback()
            outcomes[name] = f"error:{type(e).__name__}:{str(e)[:60]}"
        finally:
            s.close()

    t1 = threading.Thread(target=worker, args=("T1", 204))
    t2 = threading.Thread(target=worker, args=("T2", 205))
    t1.start(); t2.start(); t1.join(); t2.join()
    s = make_session()
    rec = s.get(EvaluationRecord, rid)
    final_status = rec.status
    hr_owner = rec.hr_user_id
    s.close()
    check("race:hr-claim:single-owner",
          final_status == EvaluationStatus.hr_approved and hr_owner in (204, 205)
          and list(outcomes.values()).count("approved") == 1,
          f"outcomes={outcomes} status={final_status} owner={hr_owner}")


def race_audit_chain():
    """Concurrent audit appends must not fork the hash chain."""
    from app.services.audit import log_event

    barrier = threading.Barrier(2)
    outcomes = {}

    def worker(name, uid):
        s = make_session()
        barrier.wait(timeout=10)
        try:
            for i in range(10):
                log_event(s, actor_user_id=uid, event_type="probe_race_event",
                          new_value={"i": i, "worker": name})
                s.commit()
            outcomes[name] = "ok"
        except Exception as e:
            s.rollback()
            outcomes[name] = f"error:{type(e).__name__}:{str(e)[:60]}"
        finally:
            s.close()

    t1 = threading.Thread(target=worker, args=("T1", 204))
    t2 = threading.Thread(target=worker, args=("T2", 205))
    t1.start(); t2.start(); t1.join(); t2.join()
    s = make_session()
    v = verify_chain(s)
    s.close()
    check("race:audit-chain:no-fork", v["ok"], f"outcomes={outcomes} verify={v}")


def race_duplicate_evaluation():
    """Two supervisors create an evaluation for the same personnel concurrently."""
    outcomes = {}
    barrier = threading.Barrier(2)

    def worker(name):
        s = make_session()
        barrier.wait(timeout=10)
        try:
            from sqlalchemy.exc import IntegrityError

            r = EvaluationRecord(
                evaluation_code=f"RACE-DUP-{name}",
                subject_personnel_id=603,
                unit_supervisor_user_id=201, deputy_user_id=202, ceo_user_id=203,
                hr_review_skipped=False, status=EvaluationStatus.draft,
            )
            s.add(r)
            s.commit()
            outcomes[name] = "created"
        except IntegrityError:
            s.rollback()
            outcomes[name] = "conflict"
        finally:
            s.close()

    t1 = threading.Thread(target=worker, args=("T1",))
    t2 = threading.Thread(target=worker, args=("T2",))
    t1.start(); t2.start(); t1.join(); t2.join()
    s = make_session()
    n = len(s.scalars(select(EvaluationRecord).where(EvaluationRecord.subject_personnel_id == 603)).all())
    s.close()
    check("race:duplicate-eval:exactly-one",
          n == 1 and sorted(outcomes.values()) == ["conflict", "created"],
          f"outcomes={outcomes} count={n}")


def main():
    seed()
    cleanup()
    race_double_submit()
    race_duplicate_claim()
    race_audit_chain()
    race_duplicate_evaluation()
    fails = [x for x in results if not x[1]]
    print(f"\n==== CONCURRENCY PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
    for label, ok, detail in fails:
        print(f"  FAIL {label} ({detail})")
    if not fails:
        print("  all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
