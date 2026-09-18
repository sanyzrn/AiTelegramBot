"""ROLE 05 — improvement_plans 403-vs-404 existence oracle probe."""
import os
import sys

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")
sys.path.insert(0, "/home/z/my-project/nexahr-review/backend/tests")

from datetime import UTC, date, datetime  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.main import app  # noqa: E402
from app.models.enums import EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord  # noqa: E402
from app.models.improvement_plan import ImprovementPlan  # noqa: E402
from app.models.personnel import Personnel  # noqa: E402
from app.models.user import User  # noqa: E402
from helpers import auth_header, make_user  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)
client = TestClient(app)

with Session() as db:
    # clean previous probe plans
    for p in db.scalars(select(ImprovementPlan).where(ImprovementPlan.title.like("PROBE-%"))):
        db.delete(p)
    db.commit()

    sup = make_user(db, "unit_supervisor", capabilities=[])
    ceo = make_user(db, "ceo", capabilities=[])
    p = Personnel(personnel_code=f"IP-{datetime.now().strftime('%H%M%S')}", full_name="پروب برنامه",
                  job_title="کارشناس", org_unit="واحد پروب",
                  contract_start_date=date(2025, 1, 1), contract_end_date=date(2026, 1, 1))
    db.add(p)
    db.flush()
    rec = EvaluationRecord(
        evaluation_code=f"IP-{datetime.now().strftime('%H%M%S')}", subject_personnel_id=p.id,
        unit_supervisor_user_id=sup.id, deputy_user_id=None, ceo_user_id=ceo.id,
        hr_review_skipped=False, status=EvaluationStatus.finalized, final_weighted_pct=55.0)
    db.add(rec)
    db.flush()
    plan = ImprovementPlan(title="PROBE-plan", personnel_id=p.id, evaluation_record_id=rec.id,
                           owner_user_id=ceo.id, review_date=date(2026, 6, 1),
                           )
    db.add(plan)
    db.commit()
    plan_id = plan.id
    missing_id = plan_id + 100000
    db.refresh(sup)
    db.expunge(sup)
    hdr = auth_header(sup)

r1 = client.get(f"/api/improvement-plans/{plan_id}", headers=hdr)
r2 = client.get(f"/api/improvement-plans/{missing_id}", headers=hdr)
print(f"existing-but-not-owned -> {r1.status_code} {r1.json()['detail'][:50]}")
print(f"nonexistent            -> {r2.status_code} {r2.json()['detail'][:50]}")
print("ORACLE:", "DISTINGUISHABLE" if r1.status_code != r2.status_code else "unified")
