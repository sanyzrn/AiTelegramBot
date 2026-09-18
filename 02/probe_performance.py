"""ROLE 10 — Performance probe: query counts + timing on heavy endpoints,
with a seeded dataset (300 finalized records + open records).
"""
import os
import sys
import time

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_perf"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")
sys.path.insert(0, "/home/z/my-project/nexahr-review/backend/tests")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event, func, select  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.main import app  # noqa: E402
from app.models.enums import EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord, EvaluationScore  # noqa: E402
from app.models.indicator import Indicator  # noqa: E402
from app.models.module import ModuleSetting  # noqa: E402
from app.models.personnel import Personnel  # noqa: E402
from app.models.user import User  # noqa: E402
from helpers import auth_header, make_user  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)
client = TestClient(app)

import os as _os
N_FINALIZED = int(_os.environ.get("PERF_SEED", "300"))
N_OPEN = 40


def seed():
    from datetime import date

    from app.core.security import hash_password

    with Session() as db:
        if db.scalar(select(func.count()).select_from(EvaluationRecord).where(EvaluationRecord.evaluation_code.like("PERF-%"))):
            print("already seeded")
            return
        indicators = list(db.scalars(select(Indicator)))
        ceo = make_user(db, "ceo", capabilities=[])
        sup = make_user(db, "unit_supervisor", capabilities=[])
        dep = make_user(db, "deputy", capabilities=[])
        hr = make_user(db, "hr")
        from datetime import UTC, datetime

        for i in range(N_FINALIZED):
            p = Personnel(
                personnel_code=f"PERF-{i:04d}", full_name=f"کارمند {i}",
                job_title="کارشناس", org_unit=f"واحد {i % 5}",
                contract_start_date=date(2024, 1, 1), contract_end_date=date(2026, 1, 1),
            )
            db.add(p)
            db.flush()
            rec = EvaluationRecord(
                evaluation_code=f"PERF-F-{i:04d}",
                subject_personnel_id=p.id,
                unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
                hr_review_skipped=(i % 37 == 0),
                status=EvaluationStatus.finalized,
                final_weighted_pct=60 + (i * 13) % 40,
                general_score_pct=60, specialized_score_pct=70,
                finalized_at=datetime(2025, 11, (i % 28) + 1, tzinfo=UTC),
                created_at=datetime(2025, 10, (i % 28) + 1, tzinfo=UTC),
            )
            db.add(rec)
            db.flush()
            db.add_all(EvaluationScore(evaluation_record_id=rec.id, indicator_id=ind.id,
                                       score=(ind.id % 5) + 1) for ind in indicators)
        for i in range(N_OPEN):
            p = Personnel(
                personnel_code=f"PERF-O-{i:04d}", full_name=f"کارمند باز {i}",
                job_title="کارشناس", org_unit=f"واحد {i % 5}",
                contract_start_date=date(2024, 1, 1), contract_end_date=date(2026, 1, 1),
            )
            db.add(p)
            db.flush()
            rec = EvaluationRecord(
                evaluation_code=f"PERF-O-{i:04d}",
                subject_personnel_id=p.id,
                unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
                hr_review_skipped=False,
                status=[EvaluationStatus.draft, EvaluationStatus.submitted,
                        EvaluationStatus.hr_approved, EvaluationStatus.deputy_approved][i % 4],
                created_at=datetime(2025, 12, (i % 28) + 1, tzinfo=UTC),
            )
            db.add(rec)
            db.flush()
            db.add_all(EvaluationScore(evaluation_record_id=rec.id, indicator_id=ind.id,
                                       score=3) for ind in indicators)
        db.merge(ModuleSetting(key="employee_evaluation_visibility", enabled=True))
        db.commit()
        print(f"seeded {N_FINALIZED} finalized + {N_OPEN} open")


_query_log = []


def instrument():
    def before(conn, cursor, statement, parameters, context, executemany):
        _query_log.append(" ".join(statement.split())[:160])

    event.listen(Engine, "before_cursor_execute", before)


def uninstrument():
    event.remove(Engine, "before_cursor_execute", lambda *a, **k: None)


def measure(label, path, hdr):
    _query_log.clear()
    t0 = time.perf_counter()
    r = client.get(path, headers=hdr)
    dt = (time.perf_counter() - t0) * 1000
    n = len(_query_log)
    ok = r.status_code
    body_len = len(r.content)
    print(f"{label:<46} queries={n:<4} time={dt:<8.0f}ms status={ok} bytes={body_len}")
    return n, dt, r


def main():
    seed()
    instrument()
    with Session() as db:
        hr = db.scalar(select(User).where(User.username.like("hr_%")).limit(1))
        db.refresh(hr)
        db.expunge(hr)
        hdr = auth_header(hr)
    print("\n--- HR-heavy endpoints (query count / wall time) ---")
    measure("GET /api/dashboard/overview", "/api/dashboard/overview", hdr)
    measure("GET /api/dashboard/overview?site=site1", "/api/dashboard/overview?site=%D8%B3%D8%A7%DB%8C%D8%AA1", hdr)
    measure("GET /api/dashboard/pipeline", "/api/dashboard/pipeline", hdr)
    measure("GET /api/dashboard/period-trend", "/api/dashboard/period-trend", hdr)
    measure("GET /api/dashboard/stage-stats", "/api/dashboard/stage-stats", hdr)
    measure("GET /api/evaluations?limit=200", "/api/evaluations?limit=200", hdr)
    measure("GET /api/evaluations?limit=50", "/api/evaluations?limit=50", hdr)
    measure("GET /api/evaluations?was_returned=true", "/api/evaluations?was_returned=true", hdr)
    measure("GET /api/evaluations?on_ceo_desk=true", "/api/evaluations?on_ceo_desk=true", hdr)
    measure("GET /api/dashboard/report/summary", "/api/dashboard/report/summary", hdr)
    measure("GET /api/dashboard/report/indicator/1", "/api/dashboard/report/indicator/1", hdr)
    measure("GET /api/evaluations/export.xlsx", "/api/evaluations/export.xlsx", hdr)
    print("\n--- per-unit rows detail for overview (N+1 check) ---")
    _query_log.clear()
    r = client.get("/api/dashboard/overview", headers=hdr)
    scans = [q for q in _query_log if "evaluation_scores" in q]
    print(f"overview evaluation_scores scans: {len(scans)}")
    for s in scans[:5]:
        print("   ", s[:150])


if __name__ == "__main__":
    main()
