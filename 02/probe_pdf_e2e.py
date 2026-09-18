"""ROLE 03 — end-to-end PDF archival probe: finalize a record via API,
verify archived document exists, sha256 matches bytes, QR verify page data."""
import hashlib
import os
import sys

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("BOOTSTRAP_ADMIN", "false")
os.environ.setdefault("PUBLIC_BASE_URL", "http://example.com")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")
sys.path.insert(0, "/home/z/my-project/nexahr-review/backend/tests")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.main import app  # noqa: E402
from app.models.enums import EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord, EvaluationScore  # noqa: E402
from app.models.indicator import Indicator  # noqa: E402
from app.models.personnel import Personnel  # noqa: E402
from app.models.user import User  # noqa: E402
from helpers import auth_header, make_user  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)
client = TestClient(app)

results = []


def check(label, cond, detail=""):
    results.append((label, bool(cond), str(detail)[:160]))


with Session() as db:
    # build full chain with all indicators scored
    import uuid as _uuid
    tag = _uuid.uuid4().hex[:6]
    sup = make_user(db, "unit_supervisor", username=f"pdf_sup_{tag}")
    dep = make_user(db, "deputy", username=f"pdf_dep_{tag}")
    ceo = make_user(db, "ceo", username=f"pdf_ceo_{tag}")
    hr = make_user(db, "hr", username=f"pdf_hr_{tag}")
    p = Personnel(personnel_code="PDF-1", full_name="کارمند پی‌دی‌اف",
                  job_title="کارشناس", org_unit="واحد پروب",
                  contract_start_date=__import__("datetime").date(2025, 1, 1),
                  contract_end_date=__import__("datetime").date(2026, 1, 1))
    db.add(p)
    db.flush()
    indicators = list(db.scalars(select(Indicator).where(Indicator.is_active.is_(True))))
    rec = EvaluationRecord(
        evaluation_code="PDF-E2E-1", subject_personnel_id=p.id,
        unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
        hr_review_skipped=False, status=EvaluationStatus.draft)
    db.add(rec)
    db.flush()
    db.add_all(EvaluationScore(evaluation_record_id=rec.id, indicator_id=i.id, score=3)
               for i in indicators)
    db.commit()
    rid = rec.id
    for u in (sup, dep, ceo, hr):
        db.refresh(u)
        db.expunge(u)
    sup_h, dep_h, ceo_h, hr_h = auth_header(sup), auth_header(dep), auth_header(ceo), auth_header(hr)

# submit
r = client.post(f"/api/evaluations/{rid}/submit", headers=sup_h)
check("pdf-e2e:submit-200", r.status_code == 200, r.status_code)
# hr approve
r = client.post(f"/api/evaluations/{rid}/hr-approve", headers=hr_h)
check("pdf-e2e:hr-approve-200", r.status_code == 200, r.status_code)
# deputy approve
r = client.post(f"/api/evaluations/{rid}/deputy-approve", headers=dep_h)
check("pdf-e2e:deputy-approve-200", r.status_code == 200, r.status_code)
# ceo finalize
r = client.post(f"/api/evaluations/{rid}/ceo-finalize", headers=ceo_h)
check("pdf-e2e:ceo-finalize-200", r.status_code == 200, r.status_code)
# background tasks run on TestClient response completion
with Session() as db:
    rec = db.get(EvaluationRecord, rid)
    check("pdf-e2e:finalized", rec.status == EvaluationStatus.finalized, rec.status)
    check("pdf-e2e:verify-token-set", bool(rec.verify_token), rec.verify_token)
    check("pdf-e2e:snapshot-v6", rec.final_snapshot.get("snapshot_version") == 6,
          rec.final_snapshot.get("snapshot_version"))
    check("pdf-e2e:signatories-real", len(rec.final_snapshot.get("signatories", [])) >= 3,
          rec.final_snapshot.get("signatories"))
    token = rec.verify_token

# archived document
from app.services.documents import get_document  # noqa: E402

with Session() as db:
    doc = get_document(db, rid)
    check("pdf-e2e:document-archived", doc is not None, doc)
    if doc:
        check("pdf-e2e:sha-matches", doc.sha256 == hashlib.sha256(doc.pdf_bytes).hexdigest(),
              doc.sha256[:16])
        check("pdf-e2e:pdf-magic", doc.pdf_bytes[:5] == b"%PDF-", doc.pdf_bytes[:5])

# public verify endpoint
r = client.get(f"/api/verify/{token}")
check("pdf-e2e:verify-200", r.status_code == 200, r.status_code)
if r.status_code == 200:
    body = r.json()
    check("pdf-e2e:verify-valid", body["valid"] is True, body)
    check("pdf-e2e:verify-name", body["subject_full_name"] == "کارمند پی‌دی‌اف", body["subject_full_name"])
    check("pdf-e2e:verify-sha", body["sha256"] == hashlib.sha256(doc.pdf_bytes).hexdigest() if doc else False)
    check("pdf-e2e:verify-has-recommendation", bool(body["recommendation"]), body.get("recommendation"))

# download PDF as HR
r = client.get(f"/api/evaluations/{rid}/summary.pdf", headers=hr_h)
check("pdf-e2e:hr-download-200", r.status_code == 200, r.status_code)
if r.status_code == 200:
    check("pdf-e2e:download-bytes-equal-archive", r.content == doc.pdf_bytes if doc else False, len(r.content))

# non-HR chain member cannot download
r = client.get(f"/api/evaluations/{rid}/summary.pdf", headers=sup_h)
check("pdf-e2e:sup-download-403", r.status_code == 403, r.status_code)

fails = [x for x in results if not x[1]]
print(f"\n==== PDF E2E PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
for label, ok, detail in fails:
    print(f"  FAIL {label} ({detail})")
if not fails:
    print("  all checks passed")
sys.exit(1 if fails else 0)
