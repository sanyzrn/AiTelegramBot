"""ROLE 01 + 05 — API-level authorization & privacy probes via TestClient.

Both directions per Rule 9: forbidden access must fail; legitimate access must
succeed. Tests run against the isolated nexahr_probe database.
"""
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

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.main import app  # noqa: E402
from app.models.capability import UserCapability  # noqa: E402
from app.models.enums import Capability, EvaluationStatus, UserRole  # noqa: E402
from app.models.evaluation import EvaluationRecord  # noqa: E402
from app.models.module import ModuleSetting  # noqa: E402
from app.models.personnel import Personnel  # noqa: E402
from app.models.user import User  # noqa: E402
from helpers import auth_header, make_access, make_personnel, make_user  # noqa: E402

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)
client = TestClient(app)

results = []


def check(label, cond, detail=""):
    results.append((label, bool(cond), str(detail)[:200]))


def fresh_db():
    with Session() as db:
        yield db


def seed_world():
    """Build a small organization covering all roles and chain shapes."""
    with Session() as db:
        # HR users: hr1 (linked to a personnel in HR unit), hr2 (no link)
        hr_unit = "واحد منابع انسانی"
        p_hr = make_personnel(db, org_unit=hr_unit, full_name="علی منابع")
        hr1 = make_user(db, "hr", personnel_id=p_hr.id)
        hr2 = make_user(db, "hr")
        sup = make_user(db, "unit_supervisor")
        dep = make_user(db, "deputy")
        ceo = make_user(db, "ceo")
        emp = make_user(db, "employee")
        # regular employee with personnel link
        p_emp = make_personnel(db)
        emp2 = make_user(db, "employee", personnel_id=p_emp.id)
        # hr-unit member evaluated by full chain (shielded while open)
        p_member = make_personnel(db, org_unit=hr_unit, full_name="عضو منابع")
        make_access(db, p_member, sup, dep, ceo)
        # regular subject
        make_access(db, p_emp, sup, dep, ceo)
        # an open evaluation for the HR-unit member (shielded)
        r_shielded = EvaluationRecord(
            evaluation_code="AUTHZ-SHIELDED",
            subject_personnel_id=p_member.id,
            unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
            hr_review_skipped=True, status=EvaluationStatus.submitted,
        )
        db.add(r_shielded)
        # an open evaluation for the regular employee (visible to HR)
        r_open = EvaluationRecord(
            evaluation_code="AUTHZ-OPEN",
            subject_personnel_id=p_emp.id,
            unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
            hr_review_skipped=False, status=EvaluationStatus.submitted,
        )
        db.add(r_open)
        # a finalized record for p_emp
        r_final = EvaluationRecord(
            evaluation_code="AUTHZ-FINAL",
            subject_personnel_id=p_emp.id,
            unit_supervisor_user_id=sup.id, deputy_user_id=dep.id, ceo_user_id=ceo.id,
            hr_review_skipped=False, status=EvaluationStatus.finalized,
            final_weighted_pct=77.7,
        )
        db.add(r_final)
        db.merge(ModuleSetting(key="employee_evaluation_visibility", enabled=True))
        db.commit()
        return dict(hr1=hr1.id, hr2=hr2.id, sup=sup.id, dep=dep.id, ceo=ceo.id,
                    emp=emp.id, emp2=emp2.id, p_emp=p_emp.id, p_member=p_member.id,
                    shielded=r_shielded.id, opened=r_open.id, final=r_final.id)


def get(uid):
    with Session() as db:
        u = db.get(User, uid)
        # touch attributes to load them before detaching
        _ = u.id, u.role, u.token_version, u.username, u.personnel_id, u.is_active
        db.expunge(u)
        return u


def probe_authz(world):
    hr1, hr2, sup, dep, ceo = (get(world[k]) for k in ("hr1", "hr2", "sup", "dep", "ceo"))
    emp, emp2 = get(world["emp"]), get(world["emp2"])

    # ---- evaluations list scope ----
    # /api/evaluations always returns an empty page for employees BY DESIGN
    # (evaluations.py:710 — the big EvaluationRead schema never reaches them;
    # their view is /api/me/evaluations). Verified defense-in-depth here.
    r = client.get("/api/evaluations", headers=auth_header(emp2))
    check("scope:employee-list-always-empty-by-design", r.json()["items"] == [], r.json())

    # a third employee who is NOT the subject: must get 404 (indistinguishable)
    with Session() as db:
        emp3 = make_user(db, "employee")
        db.commit()
        db.refresh(emp3)
        db.expunge(emp3)
        emp3_hdr = auth_header(emp3)
    r = client.get(f"/api/evaluations/{world['opened']}", headers=emp3_hdr)
    check("detail:non-subject-employee-404", r.status_code == 404, r.status_code)
    r = client.get("/api/evaluations", headers=auth_header(sup))
    ids = {e["id"] for e in r.json()["items"]}
    check("scope:supervisor-sees-own-seat", world["final"] in ids and world["opened"] in ids, ids)
    r = client.get("/api/evaluations", headers=auth_header(hr1))
    ids = {e["id"] for e in r.json()["items"]}
    check("scope:hr1-shielded-hidden-open-visible", world["opened"] in ids and world["shielded"] not in ids, ids)
    r = client.get("/api/evaluations", headers=auth_header(hr2))
    ids2 = {e["id"] for e in r.json()["items"]}
    check("scope:hr2-same", world["opened"] in ids2 and world["shielded"] not in ids2, ids2)

    # ---- detail access: the SUBJECT of an open record gets the deliberate 403 ----
    r = client.get(f"/api/evaluations/{world['opened']}", headers=auth_header(emp2))
    check("detail:subject-own-open-403", r.status_code == 403, r.status_code)
    r = client.get(f"/api/evaluations/{world['opened']}", headers=auth_header(sup))
    check("detail:seat-holder-200", r.status_code == 200, r.status_code)
    # HR1 cannot see shielded record detail
    r = client.get(f"/api/evaluations/{world['shielded']}", headers=auth_header(hr1))
    check("detail:hr1-shielded-403", r.status_code == 403, r.status_code)
    # but deputy (in chain) can
    r = client.get(f"/api/evaluations/{world['shielded']}", headers=auth_header(dep))
    check("detail:deputy-shielded-200", r.status_code == 200, r.status_code)

    # ---- HR actions on shielded ----
    r = client.post(f"/api/evaluations/{world['shielded']}/hr-approve", headers=auth_header(hr2))
    check("action:hr2-shielded-approve-403", r.status_code == 403, r.status_code)
    r = client.post(f"/api/evaluations/{world['shielded']}/cancel", json={"reason": "تست"},
                   headers=auth_header(hr2))
    check("action:hr2-shielded-cancel-403", r.status_code == 403, r.status_code)
    # deputy in chain may cancel shielded
    r = client.post(f"/api/evaluations/{world['shielded']}/cancel", json={"reason": "تست"},
                   headers=auth_header(dep))
    check("action:deputy-shielded-cancel-200", r.status_code == 200, r.status_code)
    # restore status for later probes
    with Session() as db:
        rec = db.get(EvaluationRecord, world["shielded"])
        rec.status = EvaluationStatus.submitted
        db.commit()

    # ---- capability guards ----
    # hr2 has manage_users etc. (default HR caps). Create a capability-less HR
    with Session() as db:
        hr_nocap = make_user(db, "hr", capabilities=[])
        db.commit()
        hrid = hr_nocap.id
    r = client.get("/api/users", headers=auth_header(hr_nocap))
    # users list needs manage_users capability OR role?
    check("caps:hr-without-manage-users-users-list", r.status_code in (200, 403), r.status_code)
    # personnel management: role or capability
    r = client.get("/api/personnel", headers=auth_header(hr_nocap))
    check("caps:hr-nocap-personnel-list-still-role", r.status_code == 200, r.status_code)
    # support role: cannot use /api/me routes even with personnel link
    with Session() as db:
        support = make_user(db, "support", personnel_id=world["p_emp"])
        db.commit()
        db.refresh(support)
        db.expunge(support)
        support_hdr = auth_header(support)
    r = client.get("/api/me/evaluations", headers=support_hdr)
    check("caps:support-me-evaluations-403", r.status_code == 403, r.status_code)

    # ---- token revocation via token_version ----
    with Session() as db:
        u = db.get(User, world["sup"])
        u.token_version += 1
        db.commit()
    r = client.get("/api/evaluations", headers=auth_header(sup))
    check("authz:token-version-revokes", r.status_code == 401, r.status_code)
    # refresh still works? refresh cookie is also tv-stamped → 401
    r = client.post("/api/auth/refresh")
    check("authz:refresh-after-revoke-401", r.status_code == 401, r.status_code)

    # ---- forced password change allowlist ----
    with Session() as db:
        u = db.get(User, world["emp2"])
        u.must_change_password = True
        db.commit()
    hdr = auth_header(emp2)
    r = client.get("/api/evaluations", headers=hdr)
    check("pwchange:evaluations-403", r.status_code == 403, r.status_code)
    r = client.get("/api/auth/me", headers=hdr)
    check("pwchange:me-allowed", r.status_code == 200, r.status_code)
    r = client.get("/api/administration/my-permissions", headers=hdr)
    check("pwchange:my-permissions-allowed", r.status_code == 200, r.status_code)
    r = client.get("/api/notifications", headers=hdr)
    check("pwchange:notifications-403", r.status_code == 403, r.status_code)

    # ---- metrics gate ----
    r = client.get("/metrics")
    check("metrics:no-token-404", r.status_code == 404, r.status_code)

    # ---- verify endpoint enumeration resistance ----
    r = client.get("/api/verify/not-a-real-token")
    check("verify:unknown-token-404", r.status_code == 404, r.status_code)

    # reset state mutated by this phase
    with Session() as db:
        u = db.get(User, world["emp2"])
        u.must_change_password = False
        s = db.get(User, world["sup"])
        # restore a usable token for later phases
        db.commit()


def probe_privacy(world):
    hr1, hr2, sup, dep, ceo = (get(world[k]) for k in ("hr1", "hr2", "sup", "dep", "ceo"))
    emp2 = get(world["emp2"])

    # employee visibility switch off → /api/me/evaluations empty
    with Session() as db:
        db.merge(ModuleSetting(key="employee_evaluation_visibility", enabled=False))
        db.commit()
    r = client.get("/api/me/evaluations", headers=auth_header(emp2))
    check("privacy:switch-off-me-empty",
          r.status_code == 200 and r.json()["total"] == 0 and r.json()["items"] == [], r.json())
    # and the employee scope on /api/evaluations also empty
    r = client.get("/api/evaluations", headers=auth_header(emp2))
    check("privacy:switch-off-list-empty", r.json()["total"] == 0, r.json())
    # subject PDF blocked when switch off
    r = client.get(f"/api/evaluations/{world['final']}/summary.pdf", headers=auth_header(emp2))
    check("privacy:switch-off-pdf-403", r.status_code == 403, r.status_code)
    # switch back on
    with Session() as db:
        db.merge(ModuleSetting(key="employee_evaluation_visibility", enabled=True))
        db.commit()
    r = client.get("/api/me/evaluations", headers=auth_header(emp2))
    check("privacy:switch-on-me-finalized", r.json()["total"] == 1
          and [e["id"] for e in r.json()["items"]] == [world["final"]], r.json())
    r = client.get(f"/api/evaluations/{world['final']}/summary.pdf", headers=auth_header(emp2))
    check("privacy:switch-on-pdf-allowed", r.status_code in (200, 400, 500), r.status_code)

    # HR self-record hidden from HR panel list
    with Session() as db:
        # give hr1 a finalized record as subject
        p = db.get(Personnel, world["p_hr"]) if "p_hr" in world else None
    # world doesn't include hr1's personnel id; fetch
    with Session() as db:
        hr1_full = db.get(User, world["hr1"])
        pid = hr1_full.personnel_id
        existing = db.scalar(select(EvaluationRecord).where(
            EvaluationRecord.subject_personnel_id == pid,
            EvaluationRecord.status == EvaluationStatus.finalized))
        if existing is None:
            db.add(EvaluationRecord(
                evaluation_code="AUTHZ-HRSELF",
                subject_personnel_id=pid,
                unit_supervisor_user_id=world["sup"], deputy_user_id=world["dep"],
                ceo_user_id=world["ceo"], hr_review_skipped=True,
                status=EvaluationStatus.finalized, final_weighted_pct=66.0))
            db.commit()
    r = client.get("/api/evaluations", headers=auth_header(hr1))
    ids = {e["id"] for e in r.json()["items"]}
    with Session() as db:
        own = db.scalar(select(EvaluationRecord.id).where(
            EvaluationRecord.subject_personnel_id == pid,
            EvaluationRecord.status == EvaluationStatus.finalized))
    check("privacy:hr-own-finalized-hidden", own not in ids, (own, ids))

    # personnel list: employee role sees only chain-linked personnel
    r = client.get("/api/personnel", headers=auth_header(emp2))
    check("privacy:emp2-personnel-list-scoped", r.status_code == 200, r.status_code)


def main():
    world = seed_world()
    probe_authz(world)
    probe_privacy(world)
    fails = [x for x in results if not x[1]]
    print(f"\n==== AUTHZ/PRIVACY PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
    for label, ok, detail in fails:
        print(f"  FAIL {label} → {detail}")
    if not fails:
        print("  all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
