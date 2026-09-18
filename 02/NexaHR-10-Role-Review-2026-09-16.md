# NexaHR — 10-Role Full-System Review Report

**Reviewed commit:** `27c83e5efe9f6670b438e10ac70bbfb8cc879d76` (merge of PR #30, `main`)
**Review branch:** `review/10-role-full-system` (created from `main` at the above SHA; no product changes made)
**Reviewer environment:** Debian 13 sandbox, Python 3.12.14 (CI uses 3.11), Node v24.19.0 (CI uses 20), PostgreSQL **16.15** extracted from the official `postgres:16` Docker image (ICU present — `fa-x-icu` collation verified, CI-equivalent), backend deps from `backend/requirements-dev.txt` (fastapi 0.115.6, SQLAlchemy 2.0.36, Alembic 1.14.0, psycopg 3.2.3, weasyprint available and exercised). The sandbox injects a global `DATABASE_URL` pointing at an unrelated SQLite file; every command explicitly exported `postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/...` — an environment adaptation with no application-behavior change.
**Isolation:** All reproduction tests ran as standalone scripts under `/home/z/my-project/scripts/` against disposable databases (`nexahr_probe`, `nexahr_perf`, `nexahr_browser`), never inside the repo's test tree. Production files mutated during mutation testing were restored after each run (`git status` clean at the end). Baseline = the repo's own suite; review-added tests = the probe scripts listed in the evidence.

---

## Executive Verdict

NexaHR at `27c83e5` is in **unusually good health** for a system of this domain complexity. The full CI battery was reproduced locally and is green: backend **1542/1542** passed (414 s), launcher **89/89**, frontend **oxlint clean + 407/407 vitest + production build OK**, e2e-api scenario **ALL PASSED**, and `scripts/ci-local.sh --check-drift` confirms all 10 commands match `.github/workflows/ci.yml`. Inventory verified from the reviewed commit: 63 Alembic migrations, single head `f1b6d3e28a47`, `alembic check` clean; audit-event catalogue = 76 labelled event types with a bidirectional lock test.

This review went substantially beyond the suite: **206 standalone verification checks** across the ten roles (117 workflow transition-matrix checks over all 8 chain shapes; 24 scoring-boundary checks including a 3,000-case frontend/backend preview-parlay; 19 end-to-end finalized-PDF/QR/sha256 checks; 30 authorization/privacy API checks; 16 Jalali/timezone boundary checks; 4 real two-session concurrency races; constant-query-count performance measurements at 2 dataset sizes), plus **9 executed mutations** of production guards (8 detected by the suite; the 1 survivor guards a structurally unreachable state), live verification of the audit-log append-only triggers, and a real browser exercise (login → HR dashboard, RTL, dark theme, 390 px mobile, keyboard, zero console errors).

**Worst verified defect:** LOW — an existence oracle on `/api/improvement-plans/{id}` (403 for existing-but-not-yours vs 404 for missing), inconsistent with the codebase's own unified-404 doctrine. Second verified defect, also LOW: frontend `localTodayIso()` computes filter-default dates from the *browser's* timezone rather than the org timezone, producing off-by-one-day defaults for browsers outside Iran.

**Verified release blockers: none.** No CRITICAL/HIGH/MEDIUM defect survived challenge; no regression of any historical fix was found (all items from the repo's regression list and the previous reviews' open-findings list were re-verified present/fixed — details under Regressions). The two LOW defects are non-blocking with rationale given in the Release Gate. Material verification gaps that bound this verdict are listed per-role and include: the Playwright browser e2e scenario (AI-focused, excluded with Role 04), a production nginx deployment exercise, PWA service-worker upgrade in a real browser, upgrade-from-realistic-historical-data migration replay, and CI runner version deltas (Python 3.12 vs 3.11, Node 24 vs 20). None of these gaps produced evidence pointing at an undetected defect class; they are coverage bounds, not suspicions.

**Immediate priorities:** (1) unify the improvement-plans 404 (one-line change, one test); (2) compute `localTodayIso` in `ORG_TIMEZONE` (small change, one test); (3) keep the mutation-testing habit — it is the strongest part of this suite's culture and the reason 8/9 guard mutations died instantly.

---

## Role reports

## ROLE 01 — Authz & Session

### Verdict

Authorization and session management are the strongest part of this codebase. The two-axis model (UserRole = chain position; Capability = administrative power) is enforced consistently: `may_act_at` allows superiors to act at lower *seats* but never lets anyone but HR act at the HR seat; `require_capability` deliberately ignores role so an HR user without a capability is refused; the unknown-role default is deny (`scope_evaluations_for_role` raises 403 for unmapped roles; `is_module_enabled` raises `KeyError` on unknown module keys). JWT + `token_version` revocation works for both access tokens and the refresh path (verified live); refresh cookies are HttpOnly/SameSite=strict/path-scoped; refresh rotation detects reuse and revokes all sessions. No defect was verified in this role. One accepted-design objection, stated concisely: the login endpoint's deliberately different messages for "no such username" vs "wrong password" is an explicit accepted decision and is not counted as a finding.

### Findings

#### Top findings
None.

#### Additional verified findings
None. (No verified defects in this role.)

### Verified correct

- **Server-side scoping independent of frontend** (checklist: "verify server enforcement independently of frontend visibility"): 30 API-level checks via `TestClient` with raw bearer tokens (`/home/z/my-project/scripts/probe_authz_privacy.py`). Supervisor/deputy/CEO list scoping returns exactly their seat records; HR sees all minus shielded and own record (`evaluations.py:625-640`); employee branch of `/api/evaluations` returns an empty page **by design** (`evaluations.py:710-711`) — the big `EvaluationRead` schema never reaches employees, whose only view is the smaller `/api/me/evaluations` schema. Verified defense-in-depth, not a gap.
- **Shielded HR-unit records:** hidden from HR in list (`scope_evaluations_for_role`), detail (`_ensure_can_view` → `ensure_hr_may_handle`), and every HR action endpoint (hr-approve, cancel, claim — all 403 in the probe); deputy/CEO in the chain retain access (200). Cancel-by-deputy on a shielded open record succeeded as designed (`ensure_may_administer`, `self_evaluation.py:232-283`).
- **`token_version` revocation:** bumping the version 401s the access token *and* the refresh flow (`deps.py:66`, `auth.py:205`) — REPRODUCED.
- **Forced password change:** allowlist of exactly 3 paths (`deps.py:17-36`); `/api/evaluations` and `/api/notifications` 403 while `/api/auth/me` and `/api/administration/my-permissions` pass — REPRODUCED both directions.
- **`/metrics`:** 404 when no token configured (fail-closed, `main.py:214-229`), constant-time `secrets.compare_digest` on the bearer token. **`/docs`, `/redoc`, `/openapi.json`:** disabled in production (`main.py:60-66`).
- **Public `/api/verify/{token}`:** random `verify_token` (not the sequential `evaluation_code`) — enumeration-resistant by construction; unknown token → 404; shared rate-limit bucket (`verify.py:24`) so per-token guessing doesn't get fresh quotas; returns only non-sensitive fields. End-to-end verified in the PDF probe (below, ROLE 03).
- **Account lockout & login guard:** lock checked *before* password verification (`auth.py:121-130`); dummy-hash verification for unknown usernames closes the timing oracle; lockout counting also applies to unknown usernames; per-IP limits (10/min login, 30/min refresh, 10/min change-password — the last deliberately equal to login's, with the rationale documented at `auth.py:241-249`). Suite-covered by `test_login_lockout.py`, `test_rate_limit.py`, `test_login_guard_concurrency.py` (all green in the baseline run).
- **Support role:** blocked from `/api/me/*` even with a linked personnel file (`deps.py:111-118`) — REPRODUCED. HR without capabilities: personnel list still role-permitted; capability-gated routes refuse (verified consistent with `require_role_or_capability` semantics).
- **Mutation evidence for this role:** removing `if payload.get("tv") != user.token_version:` → suite fails in 61 s (**DETECTED**); removing the HR shield filter from the list scope → fails in 179 s (**DETECTED**). The session/revocation and row-scope guards are not decorative.

### Could not check, and why

- **`RATE_LIMIT_STORAGE_URI` shared-store behavior** (multi-process limiter storage): accepted as in-process for this single-instance deployment; the Redis/URI-backed path was not exercised. Potential impact: none under the accepted deployment; would matter only if replica count > 1. Needed check: run two uvicorn workers with the URI store configured and verify counters aggregate.
- **True distributed request forgery vectors** (Host header, proxy headers behind nginx): not exercised because no reverse proxy was in the review environment; CORS list comes from settings and is tested by `test_config_production_guards.py` / `test_deployment_config.py` (green). Needed check: exercise behind the shipped nginx config.

## ROLE 02 — Workflow State Machine

### Verdict

The declarative `TRANSITIONS` table plus `_transition_block`/`ensure_transition_allowed`/`apply_transition` is correct across **all eight chain shapes** (full, manager, no-deputy, CEO-direct × regular/HR-subject). The historically fragile CEO-direct path is now the *best-covered* shape: its submit twin (`ceo_submit`/`ceo_submit_hr_subject`), its finalization-by-HR rule (`hr_finalizes` in `models/chain.py:45-69`), its return window (`ceo_return_ceo_only` from both `deputy_approved` and `submitted`), and its queue predicate (`IS_ON_CEO_DESK`) are all consistent. No defect verified. The one nuance worth recording as an accepted-design objection (not a finding): in the CEO-direct **HR-subject** chain the CEO is necessarily both first scorer and final approver; this is disclosed on the official document via `single_decider` rather than prevented, because the HR review stage is deliberately absent for HR-unit subjects (`chain.py:61-63` documents why every alternative is worse).

### Findings

#### Top findings
None.

#### Additional verified findings
None.

### Verified correct

- **Exhaustive matrix probe** (`probe_workflow_matrix.py`, 117 checks): for every shape — happy path reaches `finalized` through the documented route; **no transition escapes `finalized` or `cancelled`** (all actions blocked from both terminal states, every shape); wrong-seat actors with the *same role* are rejected with owner-blocks (distinct probe users for each seat); supervisor cannot submit on manager/CEO-only paths; CEO cannot use `manager_submit`; return transitions target the correct previous stage per shape (`full`: submitted→draft; `manager`: hr_approved→submitted; `no_deputy`: submitted→draft; `ceo_only`: submitted→draft via `ceo_return_ceo_only`); `ceo_finalize` from `hr_approved` allowed **only** when `deputy_user_id IS NULL` (guard verified both ways); `cancel` available from every open status in every shape; claimable semantics — unassigned HR seat claimable by any HR, assigned seat owner-blocked for others; unknown action names raise `KeyError` (fail-loud).
- **Return-by-seat, not role** (`evaluations.py:1110-1131` `_return_action_for` asks the state machine itself): the historical role-based bug is fixed; the role table survives only to generate precise error messages.
- **Stage ownership / skips / reopening:** the six submit variants cover the 2×(HR-subject)×(manager/CEO-only) combinations with correct destinations (`submit_hr_subject`→`hr_approved` etc.); the finalization guards in `apply_transition` refuse (a) missing computed result (`workflow.py:608-624`) and (b) missing final snapshot (`workflow.py:655-662`) — both **mutation-verified as suite-enforced** (`finalize_guard_removed` DETECTED in 51 s).
- **Submission window & extensions:** window checked only at `submit` (rationale at `evaluations.py:952-955` — later stages must not die of old age); extensions restricted to `draft` + period-attached records (`evaluations.py:1304-1324`), reason mandatory, scorer notified via `scorer_field` (CEO-direct safe).
- **HR claim/handover/reassign:** handover refuses the subject and inactive/non-HR users (`evaluations.py:1451-1469`); reassign enforces seat role, subject-exclusion, and the redundant-pair rules (`evaluations.py:1647-1684`), under `ensure_may_administer`.
- **Stuck-record exits:** deputy/CEO can cancel shielded cases (`cancel_hr_subject`), and the code documents the six-dead-end scenario it was built from.

### Could not check, and why

- **Long-lived scheduled sweeps interacting with live transitions** (nightly SLA reminder racing a manual reassignment over hours): the leader-lock and row-lock machinery is verified (ROLE 07) and `test_scheduler_reliability.py`/`test_scheduled.py` are green, but no multi-hour interleaving was executed. Potential impact: a stale `stage_entered_at`-based reminder — cosmetic. Needed check: a time-accelerated soak test.
- **Bulk-evaluation paths** (`bulk_evaluation.py`) were read but not separately probed; they funnel into the same `apply_transition`/`finalize_scoring` machinery and are covered by `test_bulk_create.py` (green). No unresolved assumption remains, hence not reported as a gap in the state machine itself.

## ROLE 03 — Scoring & the Legal Document

### Verdict

Score computation and the finalized document pipeline are correct and — critically — **byte-stable**: the archived PDF is rendered once, hashed, and every later download serves the identical bytes; the public verify page reports the same sha256; the snapshot is versioned (v6) with additive keys and a template fallback that keeps ≤v4 archives rendering exactly as printed. The backend/front-end preview parity survived 3,000 randomized cases including weighted indicators, zero-weight sections, absent sections, and capped bonuses — the historical half-rounding mismatch is dead (frontend `round1` deliberately replicates Python banker's rounding). No defect verified.

### Findings

#### Top findings
None.

#### Additional verified findings
None.

### Verified correct

- **`compute_result` boundaries** (`probe_scoring.py`, 24 checks): absent-section redistribution (general-only and specialized-only frameworks both yield 100 for all-5s; empty score set → 0 with the lowest recommendation); zero-weights fallback = simple mean of present sections; indicator weights produce weighted caps (`(5·3+1·1)/(5·3+5·1)=80%`, never >100); **bonus double cap** — scheme cap and room-to-100 applied to the *additive* (`applied_bonus`, `evaluation.py:224-241`), so 80+5→85 but 100+5→100 with `bonus_points: 0.0`; raw 99 clamps to scheme cap; negative raw clamps to 0; threshold buckets are half-open with no gap on [0,100] and the top bucket is unreachable-but-monotone at exactly 100.
- **Frontend/backend preview parity:** faithful port of `computePreview` + `round1` (toFixed(20) decimal expansion + ROUND_HALF_EVEN) + `appliedBonus` compared against `compute_result`/`applied_bonus` over 3,000 random configurations — zero mismatches (base, per-section, and applied-bonus values).
- **Scheme versioning:** records stamped at creation (`scoring_scheme_id`, `indicator_framework_id`); `rules_for_record` reads the record's scheme, falling back to active→LEGACY (`scoring_scheme.py:92-107`); mid-cycle activation cannot rewrite open records (README + code comments; suite `test_scoring_schemes.py` green).
- **Finalized-document pipeline end-to-end** (`probe_pdf_e2e.py`, 19 checks): full chain submit→HR→deputy→CEO-finalize over a real DB; snapshot v6 written with real signatories (≥3 seats) and `single_decider` correct; archived document exists with **sha256 == sha256(pdf_bytes)** and `%PDF-` magic; public `/api/verify/{token}` returns valid=true, correct subject name, recommendation, and matching sha256; HR download returns byte-identical archived content; supervisor (chain member, non-HR) gets 403 on the PDF — both directions verified.
- **Historical snapshot readers:** template renders `signatories` when present and falls back to the legacy block for ≤v4 snapshots (`evaluation_summary.html:243-258`, locked by `test_old_snapshots_keep_their_original_block`); `to_jalali` returns invalid legacy strings untouched (`pdf.py:20-36`).
- **Signatories from real seats:** `document_signatories` builds rows from occupied seats only, merges duplicate humans into one row with a compound label, and inserts HR after the scorer unless the record skips HR review (`workflow.py:740-798`); suite `test_document_signatures.py` parametrizes all chain shapes (green).
- **Bonus in the document = applied, not raw** (`snapshot.py:37-54`, same rule exported for Excel via `applied_bonus_for_document`) — the "98 + 5 = 100" class of inconsistency is closed on both surfaces.
- **QR/verify token:** `secrets.token_urlsafe(24)` at finalization only (`evaluations.py:1053-1057`); archived PDFs embed the verify URL as a data-URI QR with a local-templates-only URL fetcher and mandatory Jinja autoescape (`pdf.py:49-94`) — content injection and external-fetch paths blocked (also `test_pdf_security.py` green).
- **Mutation evidence:** removing absent-section redistribution → DETECTED (161 s); removing the finalize-without-result guard → DETECTED (51 s).

### Could not check, and why

- **Rendering fidelity of Persian glyph shaping inside produced PDFs** (kerning/ligature correctness by visual inspection): fonts, autoescape, and table layout are test-covered (`test_document_fonts.py`, `test_pdf_table_layout.py` — both green; WeasyPrint was available and real PDF bytes were produced and hashed in this review), but no human visual comparison of the rendered Persian text was performed. Potential impact: cosmetic. Needed check: print one document and have a Persian-literate reviewer read it.
- **A real v1→v6 snapshot migration scenario** (documents archived years ago under old app versions being re-downloaded today): the template fallback is tested with synthetic old snapshots; no genuine multi-year-old archive exists in this repository to replay. Potential impact: low — the fallback path is the tested one.

## ROLE 05 — Privacy & Disclosure

### Verdict

The privacy model is coherent and, unusually, **switch-aware on the server**: the `employee_evaluation_visibility` module gates the employee's list scope, `/api/me`, *and* the subject's PDF download (all three verified live, including the PDF path that historically leaked). HR-panel shielding hides open HR-unit cases from every HR touchpoint probed (list, detail, actions) while routing their care to deputy/CEO; notification bodies carry codes and names but never scores; the subject's own finalized record stays out of the HR's own panel. Cohort suppression counts **distinct people** and its call sites were inventoried end-to-end. One LOW defect verified (existence oracle on improvement plans — detailed below). One accepted-design objection, recorded for the Verdict: `dashboard.overview`'s overall and site-filtered averages are not passed through `suppressed_avg` (`dashboard.py:185-188`) while every disaggregated row is; since the dashboard is HR-only and HR can already see every individual record, this discloses nothing today — but it is exactly the invariant the suppression module exists to establish before analytics ever open to other roles. Filed as proposal P-05-1 rather than a finding, consistent with the module's own framing ("پیش‌نیاز سختِ باز کردن گزارش‌ها به نقش‌های دیگر").

### Findings

#### Top findings
None.

#### Additional verified findings

**F-IMP-1 | LOW | REPRODUCED | `api/routers/improvement_plans.py:107-121` (`_ensure_can_view` + `_get_plan_or_404`)**
- **What breaks:** the unified-404 doctrine. For a plan that exists but is not assigned to the caller, the endpoint returns **403** ("این برنامهٔ بهبود به شما سپرده نشده است"); for a missing plan it returns **404**. Any `hr`/`unit_supervisor`/`deputy`/`ceo` user can therefore enumerate sequential plan IDs and distinguish which exist.
- **How to reach it:** role `unit_supervisor`; initial state: an improvement plan owned by another user; action `GET /api/improvement-plans/{id}` with `{id}` = existing vs `{id}` = large missing; observed: 403 vs 404 (probe output: `existing-but-not-owned -> 403`, `nonexistent -> 404`, `ORACLE: DISTINGUISHABLE`). Expected: both 404, byte-identical, mirroring `evaluations._not_found` whose docstring gives the exact rationale (sequential IDs must not be countable).
- **Impact:** existence-only disclosure (no titles/subjects/owners are returned); improvement-plan IDs are sequential. Limited blast radius, trivial workaround for an attacker is none — it is a doctrine inconsistency more than a leak.
- **Fix:** in the `GET /{plan_id}` route, catch the not-owned case and raise the same 404 detail as `_get_plan_or_404` (keep 403 for write endpoints where ownership errors are actionable). Regression validation: extend `tests/test_improvement_plans.py` with a byte-equality assertion modeled on `test_evaluation_existence_leak.py:60-79`.

### Verified correct

- **Visibility switch on all three server paths:** module off → `/api/me/evaluations` empty page, `/api/evaluations` employee scope empty, subject PDF 403 with the "see HR" message; module on → own finalized record via `/api/me` only, PDF downloadable — REPRODUCED both states.
- **HR own record:** HR user's own finalized evaluation is absent from their own panel list (`scope_evaluations_for_role` HR branch excludes `subject_personnel_id == user.personnel_id`) — REPRODUCED.
- **Shielded records:** see ROLE 01 list (list/detail/actions all hide them; notifications route vacated shielded seats to deputy/CEO, `notifications.py:339-386`).
- **Notification bodies:** inventory of every message template in `notifications.py` — evaluation code + subject name + stage/action prose only; **no scores or recommendations**; the subject's "finalized" self-notification is double-gated on `employee_results_are_visible` (`notifications.py:496-505`), as is objection-resolution notice (`evaluations.py:1591-1599`).
- **Self-assessment visibility:** `may_view` = HR only (plus the subject via `/api/me`); direct manager/deputy/CEO never see it before or after scoring (`self_assessment.py:91-118`; enforced at `evaluations.py:276-279`).
- **Cohort suppression call-site inventory** (recon verified, all `suppressed_avg`/`is_below_cohort` sites): analytics my-scoring + executive (overall/unit/site), reports summary/indicator/employee-vs-unit, dashboard unit/evaluator/indicator/period-trend rows — all distinct-person counts; explicit-person bypass exists only where the policy documents it (`reports.py:136-140, 254-256`: totals suppressed only when `personnel_id is None`; per-unit rows stay suppressed even then). AI tool path hard-codes `personnel_id=None`. Removing suppression entirely → **mutation DETECTED** (96 s) — the suite enforces the guard, not just the code's presence.
- **Excel exports:** evaluations export reuses `scope_evaluations_for_role` (shielded + own record excluded — same view as the screen); personnel export carries no scores; report export renders suppressed cells as an explicit marker; audit export requires `view_audit_log`; `EXPORT_MAX_ROWS=5000` with an in-file truncation note.
- **Audit-log access:** `view_diagnostics` holders see only system events with `evaluation_record_id IS NULL` (`audit_log.py:39-85`) — the score-bearing rows require the full `view_audit_log` capability.
- **Error-message discipline:** evaluations use one 404 object for missing and not-yours (locked by `test_evaluation_existence_leak.py`); create-evaluation 409 includes the existing evaluation_id only for the *caller who could open it anyway*; the improvement-plans exception is the sole verified deviation (F-IMP-1).

### Could not check, and why

- **Outbound delivery channel content** (email/SMS bodies through `delivery.py`): the delivery queue is module-gated and channel-agnostic, but no SMTP/webhook sink was configured in this environment, so only the enqueued payload shape was reviewed (notifications content, verified score-free). Potential impact: none beyond the verified bodies. Needed check: configure a sink and diff delivered text against in-app text.
- **Server logs as a disclosure channel at volume** (log mining across many request_ids): structured logs were inspected during probes and contained no score values; a systematic log-audit across all endpoints was not performed. Needed check: run the probe suite with DEBUG logging and grep for score fields.

## ROLE 06 — Data Integrity & Migrations

### Verdict

The migration chain is clean and defensible: 63 revisions, strictly linear, single head; Python enums and PostgreSQL enums are value-identical across all 12 types with a correct `values_callable` declaration and `ALTER TYPE ADD VALUE` history; `alembic check` reports no drift and the repo enforces parity with its own `test_model_schema_parity.py`; the audit append-only triggers were **exercised live** (UPDATE/DELETE/TRUNCATE all rejected, chain verification still ok); the one-open-evaluation partial unique index exists with the right predicate and was additionally race-tested (ROLE 07); FK behavior is NO ACTION everywhere around evaluations/personnel/users/audit — deletions fail rather than cascade, so no accidental data loss is possible from the API. No defect verified. The risk spots below are documented behaviors, not findings, and are listed for operational awareness.

### Findings

#### Top findings
None.

#### Additional verified findings
None.

### Verified correct

- **Full replay from empty, five times:** `nexahr_test`, `nexahr_probe`, `nexahr_perf`, `nexahr_browser` (plus the original CI-equivalent run) were each migrated from scratch via `alembic upgrade head` — zero errors; `alembic check` → "No new upgrade operations detected."
- **Audit protections live:** `UPDATE audit_log` → `audit_log is append-only: UPDATE is not permitted`; `DELETE` → same; `TRUNCATE … CASCADE` → trigger rejection; row counts unchanged and `verify_chain()` ok afterwards. Anchor table exists with the same triggers; `record_full_verification` advances the anchor only after a full successful verification (`audit.py:280-330`).
- **Enum parity (12/12),** verified against `pg_type`/`pg_enum` and `Base.metadata`: `user_role`, `personnel_status`, `separation_reason`, `indicator_section`, `evaluation_status`, `comment_stage`, `period_status`, `improvement_plan_status`, `scheme_status`, `delivery_channel`, `delivery_status`, `capability`. Status columns compared as native enums (no string-comparison drift found; `values_callable` used throughout).
- **Partial unique indexes:** `uq_open_evaluation_per_personnel (status NOT IN ('finalized','cancelled'))`, `uq_single_open_period`, `uq_single_active_scheme`, `ix_evaluation_records_open_objection` — all present with predicates; the first is also the Python-side one-open-evaluation assumption's DB twin (both verified; the race test proves the DB side wins under concurrency).
- **Check constraints:** 8/8 model-declared constraints exist; the two distinct-seat constraints are NOT VALID for pre-existing rows (added via `ALTER TABLE … NOT VALID`, `e9c47b3f1a52:110-112`) — new writes are enforced, and current violation count is zero. Recorded as a known nuance, not a defect (documented in-repo).
- **Cascade behavior:** no FK on evaluations/users/personnel/audit cascades deletes; user deletion is blocked by audit FKs (by design — the audit chain is the reason); AI-side tables cascade (out of scope).
- **Data migrations reviewed with existing-row effects tabulated** (subagent report, file:line cited): the genuinely destructive ones are guarded and intentional — `b41c07a9d2e1` deletes *duplicate* access rows and deliberately fails if a personnel already has >1 open evaluation; `c4a1f0e93b57` truncates over-limit text via `left(col, n)` (acknowledged in its docstring); `f2a7d3c9e861`/`e2c9a4b7f351` revoke privileges (the latter only when a replacement support admin exists); `a7f3c9b52d18` reopens in-flight manager-path cases to `draft` (documented, logged); `74797edbc85f` starts the evaluation-code sequence at 1 without aligning to pre-existing codes (relevant only to a pre-sequence deployment, which does not exist in this repo's history); guarded downgrades raise `RuntimeError` rather than silently corrupting (7 migrations, unit-tested in `test_migration_guards.py`).
- **Defaults:** no model default contradicts a DB default; Python-only defaults enumerated (ORM always supplies them); DB-only server defaults (~40 AI/settings columns) agree with application behavior and are invisible to autogenerate only because `compare_server_default` is off — drift-in-waiting is noted, nothing currently inconsistent.

### Could not check, and why

- **Upgrade with realistic valid historical data at scale** (a production-shaped DB with years of rows passing through the data migrations above): all replays were from empty databases; the data-migration branches (duplicate access cleanup, capability grants, scheme/framework stamping) were validated by their unit tests and by code reading, not against a large genuine dataset. Potential impact: the `b41c07a9d2e1` hard-fail mode on duplicate open evaluations would block a real upgrade until cleaned — by design, but the operational runbook for that cleanup was not exercised. Needed check: restore a production snapshot (anonymized) into a scratch DB and run `alembic upgrade head` from an early revision.
- **`alembic downgrade` chains beyond spot checks:** all 63 implement a downgrade; 7 are guarded refusals. Full downgrade-then-upgrade round trips were not executed (not requested by any deployment path in the repo).

## ROLE 07 — Concurrency & Scheduling

### Verdict

The concurrency discipline is real, not decorative: every workflow transition takes `SELECT … FOR UPDATE OF evaluation_records` (`_get_record_or_404_for_update`, used by submit/hr-approve/deputy-approve/ceo-finalize/return/cancel/claim/handover/reassign and the score/comment/bonus writers); the audit hash chain serializes appends with `pg_advisory_xact_lock` taken *before* reading the last hash; the scheduler leader lock runs on a dedicated connection so mid-sweep commits cannot leak the lock to a different pooled connection; PDF archival races are absorbed by SAVEPOINT + the document unique constraint. All four constructed interleavings produced the correct single outcome. No defect verified — for each candidate race the required `T1 | T2 | interleaving | wrong final state` could not be produced.

### Findings

#### Top findings
None.

#### Additional verified findings
None.

### Verified correct

- **Double-submit race** (two threads, barrier-synchronized, both calling the transition check on the same draft): T1 takes the row lock, transitions draft→submitted, commits; T2's `FOR UPDATE` wait ends on the post-commit state and is stage-blocked. Final state exactly one `submitted`; outcomes `{submitted, blocked:stage}` — REPRODUCED SAFE.
- **Competing HR claims via `hr_approve`** (two distinct HR users on an unowned submitted record): exactly one approval, exactly one owner (`hr_user_id` ∈ {hr1, hr2}, other blocked) — REPRODUCED SAFE.
- **Audit chain under concurrent appends** (2 threads × 10 sequential `log_event` commits interleaved): full-chain verification `ok: True` — no fork. The advisory xact lock plus `_last_hash` read-after-lock ordering is exactly the required serialization — REPRODUCED SAFE.
- **Duplicate evaluation creation** (two threads inserting an open record for the same personnel): the partial unique index rejects one (IntegrityError → 409 with the winner's evaluation_id per `create_evaluation`'s retry-fetch) — REPRODUCED SAFE.
- **Read-decide-write flows in the request paths:** scores/comments/bonus writers take the same row lock as transitions (documented rationale: the frontend autosaves scores while a concurrent submit could otherwise strand post-finalize score rows — `evaluations.py:839-851`).
- **Document archival race:** double-render window closed by `begin_nested()` + unique constraint + re-fetch (`documents.py:71-87`); background archival after response uses an independent session with swallow-and-log plus a scheduler backfill sweep (`documents.py:90-115`).
- **Scheduler exactly-once:** `run_sweeps_once` uses `pg_try_advisory_lock` on a **dedicated connection** (the M-10 fix — commit-returning-pool-connection leak is documented and addressed), records `skipped_locked`/`succeeded`/`failed` runs, and survives process death (session-bound lock auto-released by PG). Suite: `test_scheduler_reliability.py`, `test_scheduled.py` green.
- **Double-confirm / duplicate approvals:** covered by the suite for the AI path (`af_race` test with two real connections) and by the row-lock argument above for the HTTP path; `create_evaluation` and `hr_claim` have explicit second-time guards (409).

### Could not check, and why

- **Application restart *during* a background PDF archival or mid-sweep:** the code paths (idempotent archive + backfill sweep; failed-run row + raise) were read and their tests are green, but no actual kill -9 mid-flight was executed. Potential impact: a missed notification until the next sweep — self-healing by design. Needed check: kill a worker between archive request and completion, then run the backfill sweep and verify the document appears.
- **Multi-replica deployment behavior:** intentionally out of product scope (single instance); the leader lock would in fact handle two replicas, but this was not tested and is not a supported topology.

## ROLE 08 — Persian, RTL, Jalali & Time

### Verdict

Time correctness is centralized and correct: UTC storage, org-timezone judgment and display (`core/clock.py` is the single crossing point), local-midnight filter boundaries, and Jalali rendering in the official document all passed 16 boundary checks including the exact 20:30-UTC Tehran-midnight instant and the one-second-before edge. Persian digit normalization (including the U+066B decimal separator) is applied consistently to user-facing numbers; the public verify page prints Tehran time, not the viewer's local time. One LOW defect verified in the frontend's date-default helper (below). Persian hard-coding without an i18n catalogue is an accepted non-defect per the review brief.

### Findings

#### Top findings
None.

#### Additional verified findings

**F-TZ-1 | LOW | SOURCE-PROVEN | `frontend/src/utils/dates.ts:50-61` (`localTodayIso` / `localIsoDaysFromNow`)**
- **What breaks:** filter preset defaults computed in the **browser's** timezone instead of the org timezone. `localTodayIso` builds `YYYY-MM-DD` from `base.getFullYear()/getMonth()/getDate()` — the browser's local calendar — while the module's own header declares "هر تاریخی در این سامانه به وقتِ سازمان تصمیم گرفته و چاپ می‌شود" and the backend interprets every date-range boundary via `local_day_start`/`local_day_end` in `Asia/Tehran` (`clock.py:67-84`).
- **How to reach it (complete path, no unresolved assumptions):** a browser set to a non-Iranian timezone (e.g., UTC−5) at 20:00 local (= 01:00 UTC = 04:30 Tehran next day); user `hr` opens Reports (`ReportsSection.tsx:260-271`) or Audit log (`AuditLogPage.tsx:264-275`) and clicks the "منقضی‌شده / رو به اتمام" presets; observed (source-proven): `contract_end_to = localTodayIso()` = the *browser's* date — one day behind the org's today; expected: the org's today, matching the backend's `today_local()` which already counts the contract as expired. The two sides of the same feature disagree by one day for the whole browser-local evening window; the code comment itself identifies this class of bug for the UTC case and fixes only the UTC variant.
- **Impact:** wrong default window only (the user can adjust the filter manually); invisible to Tehran-timezone browsers — i.e., to almost the entire actual deployment. Worth fixing for correctness and for travelers/expatriate access.
- **Fix:** compute today in the org timezone using `Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE })` parts (or the existing jalali utils' Gregorian base), keep the same signature. Regression validation: a vitest case with `TZ` env set to `America/New_York` and a frozen clock asserting the ISO date equals the Tehran date for a chosen instant (mirror of `test_org_timezone.py`'s backend cases).

### Verified correct

- **Tehran midnight boundary:** `to_local` maps 2026-03-20 20:45 UTC → 2026-03-21 00:15+03:30; the exact 20:30 UTC instant is local midnight of the next day; one second earlier is still the previous local day — REPRODUCED.
- **Jalali day in text and document:** `fa_date(datetime)` and the PDF `to_jalali` both print the **local** Jalali date (a 01:00-Tehran finalization prints the *next* day, not the UTC day) — the historical "document printed yesterday" bug is dead; suite-locked in `test_org_timezone.py:38-52` (which also pins the exact string `۱۴۰۴/۰۷/۱۵ ساعت ۰۱:۰۰`).
- **Date-range filter boundaries:** `local_day_start(2026-10-07)` = 2026-10-06 20:30 UTC; `local_day_end` = next midnight; window exactly 24 h — REPRODUCED. Removing the timezone conversion → **mutation DETECTED** (60 s).
- **Persian digits:** `fa_digits(82.5)` → `۸۲٫۵` (U+066B separator), `fa_digits(None)` → `—`, integers normalized; identifiers (codes, usernames) deliberately excluded from the filter — verified by reading all `fa_digits` call sites in message construction.
- **Invalid `ORG_TIMEZONE` fails loudly** (RuntimeError, no silent UTC fallback) — `clock.py:37-42`, suite-locked.
- **Frontend display:** all ~20 display call sites use `Intl.DateTimeFormat("fa-IR", { timeZone: ORG_TIMEZONE })` (Persian calendar + Persian digits, Tehran-fixed); the public verify page inherits the same fixed timezone (historical browser-timezone bug fixed — `dates.ts:1-27` header documents it).
- **Jalali calendar correctness:** the frontend implements the standard break-table conversion with leap-year handling (1403 Esfand 30 exists, 1404 doesn't); the JalaliDatePicker exposes a full keyboard grid (ROLE 09).

### Could not check, and why

- **RTL visual perfection of every page in both themes:** the browser exercise verified document-level `dir="rtl"`, chart tooltip direction, and the deliberate RTL score-slider mapping; the remaining 13 physical `left:`/`right:` inline styles were inventoried (login-page mascot art and the documented RTL slider math — intentional). A pixel-level RTL audit of all ~60 pages was not performed. Potential impact: cosmetic. Needed check: screenshot sweep of all routes in RTL + both themes with a designer's eye.
- **DST assumptions:** Tehran currently has no DST; a future reinstatement would make `org_timezone` arithmetic change across the year — nothing to test today, noted as a config-time concern only.

## ROLE 09 — Frontend Correctness & Accessibility

### Verdict

The React application was exercised in a real browser (not screenshots alone): login → HR dashboard with live data, dark-mode toggle through `localStorage` + pre-paint bootstrap, 390 px mobile viewport, and keyboard traversal — **zero console errors** and a well-formed accessibility tree (banner/main/heading levels/tablist/radiogroup/labelled controls). The security-relevant frontend behaviors are the strongest I have reviewed in this product class: access token kept **in memory only** (never localStorage), single-flight refresh with one retry, logout clearing the entire React Query cache + local drafts + CacheStorage, login also clearing the cache before fetching the new identity, and a fail-closed `PermissionsContext` whose 403 listener invalidates and re-fetches permissions. Historical frontend findings from previous reviews were individually re-verified as fixed (details below). No defect verified in this role.

### Findings

#### Top findings
None.

#### Additional verified findings
None. (The two LOW findings F-IMP-1 and F-TZ-1 are owned by ROLE 05 and ROLE 08 respectively; F-TZ-1 lives in frontend code but is a localization-correctness defect, cross-referenced here.)

### Verified correct

- **Real-browser exercise** (`browser_exercise.sh`, agent-browser/Chromium): login page renders `dir="rtl"` with computed `direction: rtl`; submitting hr1's credentials lands on `/hr/dashboard`; the dashboard tree shows `banner` (title, theme radiogroup with checked states, notifications/profile buttons with aria-labels), `main`, `h1`, `tablist` with `selected` states; **`agent-browser errors` returned empty**; theme switch `light→dark` via `localStorage['nexahr:theme']` + reload confirms `data-theme="dark"`; mobile 390 px keeps RTL and all interactive elements; first Tab press focuses the username INPUT.
- **Cross-user leakage on shared machines:** logout = POST /auth/logout (fire-and-forget) + token null + `queryClient.clear()` + `clearAppCaches()` (all CacheStorage) + `clearLocalDrafts()` (`AuthContext.tsx:58-85`); login clears the cache as a "second seatbelt" before `fetchMe` (`AuthContext.tsx:48-56`); query keys deliberately exclude user identity *because* the whole cache is dropped at the identity boundary (documented at `AuthContext.tsx:63-74`). No sessionStorage use; no token in any storage — verified by storage inventory.
- **`PermissionsContext` fail-closed:** `isModuleEnabled` returns `false` for unknown/failed states; `can()` likewise; loading state renders fallbacks rather than hidden content; 403 → invalidate + refetch; 5-minute refetch interval + focus refetch on this one query (global focus refetch is off) — the historical "permissions never refresh" finding is closed.
- **React Query hygiene:** 60+ distinct keys inventoried; global `staleTime: 30s`, `refetchOnWindowFocus: false`, 4xx no-retry; notifications poll only when the tab is visible; invalidations are scoped by key (43 call sites inventoried — the one unscoped invalidation lives in the AI copilot panel, out of scope).
- **Client/server validation parity:** evidence word-count mirroring with live counters and `aria-live`; `maxLength` + CharCounter on all 16 bounded fields (backend `text_limits` mirrored in `utils/textLimits.ts`, kept in sync by `test_text_limits.py`); bonus client validation replicates the server's three rules (finite, ≥0, ≤ cap, reason minimum when > 0) and submit is blocked while a dirty invalid bonus exists; the preview only applies a *valid* bonus.
- **Preview parity:** 3,000-case backend equivalence including banker's rounding (ROLE 03) — the historical 31.3-vs-31.2 divergence is dead; the bonus line and ring both display the *applied* bonus.
- **Accessibility patterns:** shared `useFocusTrap` (Tab wrap, Escape, scroll lock, focus restore) used by Modal, mobile nav drawer, copilot drawer, and the JalaliDatePicker (with capture-phase Escape so it doesn't close the modal beneath); roving-tabindex day grid with arrow navigation and dedicated keyboard tests; slider/radiogroup ARIA roles with min/max/now; skip-link; `:focus-visible` outlines; `.tap-target` ≥24 px utility (applied to the previously-undersized mark-all button); toasts distinguish `role="alert"` vs `role="status"`; `prefers-reduced-motion` honored in CSS and JS.
- **Dark theme:** CSS-variable redefinition under `[data-theme="dark"]` with an explicit override layer for fixed-color utility classes, guarded by a static scan test (`darkTheme.test.ts:77-107`) that fails if a new `bg-white/NN` lacks a dark rule; theme-color meta swaps with the theme; pre-paint script avoids the flash without violating CSP.
- **PWA/service worker:** production-only registration; `/api/*` and `/verify/*` never cached; hashed assets cache-first, navigations network-first with offline fallback; `CACHE_VERSION`-prefixed names purged on activate; one-time `controllerchange` reload — the after-upgrade path is coherent by construction (real upgrade not exercised, see below).
- **Historical findings re-verified fixed at HEAD:** JalaliDatePicker keyboard trap (was: unusable by keyboard — now focus trap + roving tabindex + tests); maxLength coverage (was: 1 usage — now 16 + counters); `aria-activedescendant` on PersonPicker; users list fetch gated by `enabled: needsUserList` (was: unconditional 1000-row fetch per mount); seat-based return action; verify page Tehran time; clamped bonus preview; unified toggle direction with an explanatory comment; permissions refresh (above).

### Could not check, and why

- **Full-app browser flows beyond login/dashboard** (evaluation scoring form submission, objection filing, personnel import wizard in a real browser): component-level behavior is covered by the 407 vitest tests (jsdom) and the API layer by backend tests, but the end-to-end click-through of every page was not performed; the shipped Playwright scenario targets the AI copilot (excluded with Role 04). Potential impact: integration glitches between components not caught by either suite. Needed check: run `e2e/e2e_browser.sh` (requires Chromium download) and/or author a 10-minute manual click-path script for the evaluation lifecycle.
- **PWA/service-worker upgrade on a real deployed version bump:** logic read and internally consistent; actual `SKIP_WAITING`-style upgrade UX not observed. Needed check: deploy v1→v2 locally with the SW active and observe the one-time reload.
- **Screen-reader output (NVDA/JAWS)**: ARIA structure verified via the accessibility tree; no screen reader was run. Needed check: one NVDA pass over the evaluation form.

## ROLE 10 — Performance

### Verdict

Performance is healthy within the product's constraints and — more importantly — **structurally bounded**: every heavy endpoint's query count is a constant that does not grow with data (verified identically at 340 and 1,040 evaluation records), because the repository enforces query budgets as tests (`test_dashboard_query_budget.py` pins the score-table scan count to 1; `test_analytics_row_budget.py`, `test_sweep_query_count.py` similarly). Wall times on this modest sandbox were flat and sub-100 ms for all dashboard/report/list endpoints at both dataset sizes; Excel export scales linearly with exported rows (83 ms @ 340 → 211 ms @ 1,040, 50 KB payload) which is the correct complexity for a spreadsheet; PDF generation is moved off the finalization request path into background archival. The bundle is code-split (largest chunks: index 398 KB/120 KB gzip, charts 381 KB/109 KB gzip) — acceptable for an internal LAN tool. No defect verified; no microscopic optimizations are reported per the mode rules.

### Findings

#### Top findings
None.

#### Additional verified findings
None.

### Verified correct

- **Query-count measurements** (`probe_performance.py`, SQLAlchemy Engine-class instrumentation, HR-authenticated requests): `GET /api/dashboard/overview` 11 queries / 54→68 ms; `?site=` filter 12 / ~20 ms; `pipeline` 2; `period-trend` 2; `stage-stats` 4; `GET /api/evaluations?limit=200` 4 queries / ~30 ms returning 169 KB (the max page); `was_returned` filter 3 (EXISTS subquery, no N+1 — the returned-flag is batched for the page, `evaluations.py:736-747`); `on_ceo_desk` 4; report summary 6; report per-indicator 6; `export.xlsx` 5 queries. Counts **identical** at 340 and 1,040 records — constant complexity, measured, not assumed.
- **Growth check:** tripling the dataset moved overview by +14 ms and nothing else except the linearly-scaling export — indexes are used (migration analysis catalogued the targeted indexes: `d2a7f04b16c8` created_at, `d5b1f3e7c920` HR filter set, `c7f2d81a5e30` phase-1 set, `stage_stats`'s own created-at index with the SQL-vs-Python tradeoff documented in `docs/perf-3b.md`).
- **No N+1 in the hot paths:** the `was_returned` flag and deadline fields are batched/derived in single queries; module-state lookups are cached per session with an `after_flush` invalidator (`authorization.py:74-108`) — the 2,000-query fresh-deployment sweep bug is structurally dead.
- **CPU-heavy work off the request path:** finalization commits first, PDF renders in a background task with idempotent archival and a scheduler backfill (`documents.py:90-115`, `evaluations.py:1077-1084`).
- **Truncation safety:** exports cap at 5,000 rows with an explicit in-file truncation note; list pages cap at 200.
- **Frontend rerenders/invalidations:** invalidations are key-scoped (43 sites inventoried); the one unscoped invalidation is in the excluded AI panel. Notification polling pauses when hidden.

### Could not check, and why

- **Execution plans (`EXPLAIN ANALYZE`) under production-scale data (tens of thousands of records, real row widths):** plans were not captured because the sandbox dataset (1,040 records) executes everything in single-digit milliseconds where plan differences are invisible. The repo's own `perf-3b.md` documents plan-level work done previously. Potential impact: at 10×–50× scale a plan flip (e.g., seq scan on `evaluation_scores`) could matter. Needed check: seed 50k records and `EXPLAIN ANALYZE` the overview/report aggregates.
- **Frontend runtime performance (rerender counts, long-Persian-text layout, low-end devices):** bundle sizes measured from the production build; no React Profiler traces were taken. Needed check: profiler session on the evaluation form with 25 indicators on a mid-range laptop.

## ROLE 11 — Test Quality

### Verdict

This is a suite that can fail — the strongest claim a test-quality review can make, and here it is *earned by execution*: eight of nine behavior-changing mutations of security- and correctness-critical production lines were detected by the suite (most within seconds; the slowest within one full run), and the single survivor was analyzed to guard a state that cannot exist given the write paths (defense-in-depth, not a coverage hole — reasoning below). The historically suspicious leads from the review brief were each chased and found addressed. The suite's own hygiene (session-scoped savepoints, rate-limiter resets, frozen clock fixture, fail-loud conftest env) is exemplary. The remaining quality concerns are the ones the repo itself documents (a minority of status-code-only assertions; unbounded `af_race_*` user accumulation as the price of append-only audit) — both acknowledged, bounded, and not escalated to findings by this review.

### Findings

#### Top findings
None.

#### Additional verified findings
None. (No verified test that cannot meaningfully fail; no verified test-order dependency introduced pollution in the baseline run — 1542/1542 green with mutations restored.)

### Verified correct

- **Executed mutations (9), each: changed line → suite command `python -m pytest -q -x` → outcome:**

  | # | Mutation (file:line semantics) | Outcome |
  |---|---|---|
  | 1 | `workflow.py` `may_act_at`: `>=` → `>` (breaks superior-at-lower-seat) | **DETECTED**, 10 s |
  | 2 | `evaluations.py` HR scope: remove `~IS_SHIELDED_FROM_HR_PANEL` filter | **DETECTED**, 179 s (865 tests in) |
  | 3 | `deps.py`: remove `token_version` check (revocation dead) | **DETECTED**, 61 s |
  | 4 | `evaluation.py`: absent-section redistribution removed | **DETECTED**, 161 s |
  | 5 | `privacy.py`: `suppressed_avg` never suppresses | **DETECTED**, 96 s |
  | 6 | `clock.py`: `local_day_start` to UTC midnight | **DETECTED**, 60 s |
  | 7 | `workflow.py`: finalize-without-result guard removed | **DETECTED**, 51 s |
  | 8 | `verify.py`: remove `status != finalized` check | **SURVIVED** (full 1542 green, 422 s) — see analysis |
  | 9 | `evaluations.py`: remove `ensure_subject_may_read_own_result` on subject PDF | **DETECTED**, 401 s (1488 tests in) |

  All mutations were applied to a copy, run, and **restored** (git clean after). Detection commands and raw outputs recorded in `/home/z/my-project/scripts/mutation_results.txt`.
- **Mutation #8 survivor analysis (not a gap):** the guard rejects non-`finalized` records on the public verify endpoint. `verify_token` is written **only** inside `_stamp_finalization`, in the same transaction as the `finalized` status change; a failed transition rolls both back; no migration or code path creates token-without-finalized state (backfill `b28cc6abdf2a` stamps finalized records only; no transition leaves `finalized`). The mutated branch is therefore unreachable for every DB state the system can produce — per the review's own rule ("If no plausible behavior-changing mutation can be identified, reconsider the gap claim"), this is redundant defense kept intentionally, not a test hole.
- **Historical suspicious examples resolved:**
  - *UTC timestamps in the legal PDF* — `test_org_timezone.py:38-52` pins the local-day rendering (`۱۴۰۴/۰۷/۱۵ ساعت ۰۱:۰۰` for a 21:30-UTC finalization) and my probes re-verified the boundary from both sides.
  - *`af_race_*` shared-DB state in `test_audit_fixes.py`* — the test now commits deliberately (two real connections are required for the race) with cleanup moved **before assertions in a `finally`** (code-verified at `test_audit_fixes.py:655-670`); the residual unbounded growth of committed `af_race_*` users is the documented price of the append-only audit FK and is acknowledged in `docs/open-findings.md` as design.
  - *`pytestmark = usefixtures("employee_view_on")`* — no such pytestmark exists in the current tree (grep-verified); module gating is now explicit per-endpoint via `subject_may_read_own_result`/`ensure_module_enabled`, and mutation #9 proves the gate is enforced by tests.
- **Test inventories (from the reviewed commit, not docs):** backend 1,542 collected / 1,542 passed / 0 failed / 0 skipped / 0 xfailed (414 s); frontend 61 files / 407 tests passed (63 s); launcher 89 passed; e2e-api 12-step scenario ALL PASSED against a freshly rebuilt DB; drift check 10/10 commands match CI.
- **Suite hygiene:** session-scoped `alembic upgrade head`; per-test savepoint rollback (`join_transaction_mode="create_savepoint"`); autouse rate-limiter reset between tests (kills order dependence); frozen midday clock fixture with the midnight-oracle rationale documented; `NEXAHR_ENV_FILE=""` guard preventing the demo `.env` from silently weakening tests (the exact historical failure the comment describes); `_migrate_test_db` shells out to the venv's alembic on PATH (environment note below).
- **Guards that fail loud:** unknown module keys raise; unknown transition actions raise `KeyError`; unknown roles deny; production guards tested (`test_config_production_guards.py`).

### Could not check, and why

- **Full-suite mutation coverage beyond the 9 selected lines:** the 9 mutations targeted the highest-risk guards identified by reading; a systematic mutation campaign across all services was out of time budget. Claim is strictly limited to the executed set. Needed check: extend `run_one_mutation.sh` with the remaining guard inventory (notably `ensure_hr_may_handle`, `ensure_may_administer`, `_ensure_can_view`, `applied_bonus`, `verify_chain` internals) — each is currently covered indirectly via the API tests that failed for mutations 2/5/9.
- **Flaky-race stability under repeated runs:** the concurrency tests were each run once in-suite plus my dedicated probes; a 20× repeat run to hunt for rare interleavings was not performed. Needed check: `pytest tests/test_workflow_concurrency.py tests/test_login_guard_concurrency.py -k race --count=20` (pytest-repeat).
- **e2e browser suite execution:** requires a Chromium download (AI-copilot-focused scenario; excluded with Role 04). The API half ran green.

---

## Cross-Role Findings

**CF-1 (F-IMP-1 × ROLE 01 + ROLE 05).** The improvement-plans existence oracle (F-IMP-1) is owned by ROLE 05 but its significance is cross-role: the authorization layer (ROLE 01) established a unified-404 doctrine for sequential-ID resources (`evaluations._not_found`, locked by `test_evaluation_existence_leak.py`) and the privacy layer (ROLE 05) enforces it everywhere else probed; `improvement_plans._ensure_can_view` is the single surviving deviation. Combined impact beyond the single entry: it demonstrates the doctrine is convention, not mechanism — the next router written by a new contributor will follow whichever file they copy. The fix should therefore land in the shared doctrine's terms (a shared `_not_found`-style helper or a comment anchor on `deps.py`), not just in one file.

**CF-2 (F-TZ-1 × ROLE 08 + ROLE 09).** The `localTodayIso` off-by-one (F-TZ-1) is owned by ROLE 08 but manifests as frontend filter defaults (ROLE 09) and is *measured* against backend boundaries (ROLE 08's `local_day_start`): the same class of UTC-vs-local bug the backend centralized in `core/clock.py` and the frontend centralized in `utils/dates.ts` — one helper (`localTodayIso`) skipped the centralization and reads the browser clock. Combined impact is still LOW (default windows only, non-Tehran browsers only), but the fix belongs with the other timezone-boundary logic, and `test_org_timezone.py`'s backend cases have no frontend mirror — one vitest with a pinned TZ would lock the whole class.

No other cross-role defect combinations were verified.

## Regressions

**No verified regressions.**

Every item on the review brief's historical-fixes list was independently re-verified at `27c83e5` before reading the historical docs, then reconciled against `docs/open-findings.md` (the raw prior reports were removed from the tree at v1.15.0 per that file's own note — git history retains them; `docs/review-findings.md`, `docs/nafashr-port-candidates.md`, and `docs/nafashr-reported-bugs-check.md` named in the brief do not exist at HEAD):

- **Guards:** module switches gate writes through in-body `ensure_module_enabled` (mutation-adjacent evidence: the module-gated PDF path killed mutation #9); `add_comment` HR handling/visibility guard present (`evaluations.py:1823`); objection resolution seat-logic + module gate present (`evaluations.py:1561-1563`); capability revocation is session-aware (capabilities read per request); evaluation-subject identity independent of `employee` role (`require_own_personnel` role-agnostic; support-role exclusion verified live).
- **Score/document/time:** bonus bounded by scheme cap *and* room-to-100 (probe); applied-not-raw bonus in document and Excel (`applied_bonus_for_document`); signatories from real seats (suite + probe ≥3 seats for full chain); no duplicate/empty CEO-direct signatures (single_decider disclosed instead); PDF Latin glyph handling (`to_jalali` invalid-string passthrough + font tests); UTC/local boundaries centralized in `core/clock.py` (mutation #6 proves suite enforcement).
- **Chain shapes:** complete CEO-direct path (117-check matrix); HR-unit self-case deadlock exits present and live-verified; open-case seat ownership blocks role changes (`ensure_no_open_chain_seat`); role-change/deactivation protections around open evaluations (seat-liveness check at creation + separation flow).
- **Privacy/concurrency/cost:** distinct-person suppression (probe + mutation #5); concurrent login-failure counting (suite); bounded stage-statistics window (index + doc); Excel transaction/eager-load ordering (comment-documented at `evaluations.py:796-805`, export measured 5 queries); Persian sorting normalization and ICU collation (the earlier 26 test failures in this very review's setup — all caused by a missing ICU collation in *my* first PostgreSQL build, exactly reproducing why the code requires `fa-x-icu` — disappeared completely under the CI-equivalent image; this is positive evidence the collation dependency is real and load-bearing).
- **Previously-open frontend findings re-verified fixed at HEAD:** JalaliDatePicker keyboard operability; maxLength/CharCounter coverage; PersonPicker `aria-activedescendant`; gated users-list fetch; seat-based returns; Tehran-timezone verify page; clamped bonus preview; unified switch direction; tap-target on mark-all; permissions auto-refresh. **Still open by documented decision (not regressions):** users-list silent 1000-row cap in the account picker (code comment records the choice), `af_race_*` unbounded growth, trigram index and 5 s notification poll (both explicitly declined with rationale in `docs/open-findings.md`).

## Combined Proposals

Only roles 01, 05, 08, 09 and 10 contribute. Ranked by (value to a real HR user) / (implementation surface). The two LOW findings' fixes are folded into their finding entries above and are not repeated here.

**P-05-1 — Suppress the dashboard's overall/site averages like every other row.**
- **User-visible outcome:** when (and only when) analytics are ever opened to roles below HR, a 2-person site's "average final score" will not be that one person's score wearing a group label — the invariant the privacy module exists to guarantee will already hold everywhere, so opening reports becomes a policy decision instead of an audit project.
- **Originating role(s):** 05 (with 10 acknowledging the cost is one extra scalar per row).
- **Change:** route the `avg_final_pct` total (and its site-filtered variant) through `suppressed_avg` with `cohort_size` over the same filtered set, exactly as the per-unit rows already do.
- **Files/components:** `backend/app/api/routers/dashboard.py:185-188` (two call sites).
- **Implementation surface:** ~5 lines + one test asserting suppression below `MIN_COHORT_SIZE` and raw values at/above it; extend `tests/test_cohort_suppression.py`.
- **What could break:** HR sees `null` (rendered as the existing suppressed-cell marker) for a site with < 5 evaluated people where they previously saw a raw number. HR can still see the individuals themselves, so no information is lost; the dashboard copy for tiny sites changes from a number to a dash.
- **Migration/compat/finalized records:** none — display-time aggregation only; no data or document impact.
- **Priority:** 1 — the smallest surface in this list closing a doctrine gap before it can become a disclosure.

**P-09-1 — Server-side user search for the account-linking picker.**
- **User-visible outcome:** linking accounts to personnel keeps working past 1,000 users without silently hiding the 1,001st, and the personnel page stops fetching a 1,000-row list on every mount when the tab is used.
- **Originating role(s):** 09 (10 concurs: it is also the only unbounded-by-server-query list fetch left in the pages).
- **Change:** a `GET /api/users?limit=&offset=&q=`-style search box (endpoint exists; the picker currently downloads a page of 1,000 instead of querying it) — swap `useUsersList({ limit: 1000 })` for a debounced server search with pagination in the account-linking control.
- **Files/components:** `frontend/src/pages/hr/PersonnelPage.tsx:369`, one picker component, `frontend/src/api/queries.ts`.
- **Implementation surface:** one component + one hook; no backend change required.
- **What could break:** picker latency becomes network-dependent (mitigated by debounce); behavior for orgs under 1,000 users is visually unchanged.
- **Migration/compat/finalized records:** none.
- **Priority:** 2 — real future-proofing for a currently-invisible ceiling; not urgent for a single org under ~1,000 accounts.

No further qualifying proposals; performance and accessibility baselines are already covered by enforced tests, and filler is excluded by rule.

## Release Gate

**Gate reasons (all referencing verified evidence):**

1. **No verified release-blocking defect.** The complete review verified exactly two defects, both LOW (F-IMP-1 existence oracle; F-TZ-1 off-by-one filter defaults), with concrete one-file fixes and regression-validation recipes. Neither corrupts data, discloses scores, blocks the approval chain, or affects finalized documents.
2. **CI/test status is green and was reproduced end-to-end locally** (backend 1542, launcher 89, frontend 407 + build, e2e-api, drift check) on a CI-equivalent PostgreSQL 16 with ICU. A passing local run is not proof remote CI passed — but the drift check confirms command parity, and the latest push to `main` at the reviewed SHA carries the same suite.
3. **The highest-risk paths carry executable evidence, not just green tests:** 206 standalone checks, 9 mutations (8 detected), 4 reproduced-safe races, live audit-trigger rejection, and a real-browser exercise — covering the exact failure classes this system cannot afford (wrong-person workflow action, document corruption, privacy disclosure, timezone-wrong legal documents, concurrency corruption).
4. **Material verification gaps that bound this verdict** (each with the concrete check needed): production nginx deployment + CSP behavior not exercised; Playwright browser e2e not run (AI-scoped, excluded); PWA service-worker real upgrade not observed; migration replay against a genuine historical dataset not performed; execution plans at ≥10× scale not captured; screen-reader pass not performed; CI runner versions differ from the review environment (Python 3.12 vs 3.11, Node 24 vs 20 — suite green under both this review's 3.12 and the repo's CI 3.11 baseline claim, but the delta is noted). None of these gaps produced evidence of a hidden defect class; they are coverage bounds, and the two LOW findings do not block release.
5. **The two LOW defects are non-blocking with rationale:** F-IMP-1 discloses only existence of records whose contents remain protected, to already-authenticated chain roles, and contradicts a doctrine rather than a requirement; F-TZ-1 affects only default filter windows on browsers outside Iran in a single-organization Iranian deployment, with a manual workaround built into the very control that shows the wrong default.

**Status: `RELEASE: GO WITH NON-BLOCKING FIXES`**

Required follow-ups before the next release cycle: land the two LOW fixes with their regression tests (each is a one-file, one-test change), and ideally P-05-1 so the suppression invariant is total before any future role expansion of analytics.
