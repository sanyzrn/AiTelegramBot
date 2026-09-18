#!/usr/bin/env bash
# Single mutation runner: applies one mutation, runs suite, restores, reports.
# Usage: bash run_one_mutation.sh <name>
set -u
BACKEND=/home/z/my-project/nexahr-review/backend
NAME="${1:?mutation name}"
RESULTS=/home/z/my-project/scripts/mutation_results.txt
export PATH="$BACKEND/.venv/bin:$PATH"
export DATABASE_URL="postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_test"
export ENVIRONMENT=development JWT_SECRET_KEY=ci-test-secret-key-not-for-production ENABLE_SCHEDULER=false BOOTSTRAP_ADMIN=false
export PGIMG=/home/z/my-project/pgimg/rootfs
export LD_LIBRARY_PATH="$PGIMG/usr/lib/x86_64-linux-gnu:$PGIMG/usr/lib/postgresql/16/lib"
export PGPASSWORD=nexahr_dev_password
PGBIN="$PGIMG/usr/lib/postgresql/16/bin"

declare -A MUTATIONS=(
[mayact_rank_strict]="app/services/workflow.py|return user_rank >= stage_rank|return user_rank > stage_rank"
[scope_hr_shield_removed]="app/api/routers/evaluations.py|query = query.where(~IS_SHIELDED_FROM_HR_PANEL)|query = query"
[deps_token_version_removed]="app/api/deps.py|if payload.get(\"tv\") != user.token_version:|if False:"
[compute_redistribution_removed]="app/services/evaluation.py|present = [(pct, weight) for pct, weight, maximum in sections if maximum]|present = [(pct, weight) for pct, weight, maximum in sections]"
[privacy_never_suppress]="app/services/privacy.py|if value is None or is_below_cohort(count):|if value is None:"
[clock_day_start_utc]="app/core/clock.py|return datetime.combine(day, time.min, tzinfo=org_timezone()).astimezone(UTC)|return datetime.combine(day, time.min, tzinfo=UTC)"
[finalize_guard_removed]="app/services/workflow.py|if record.final_weighted_pct is None or has_scores == 0:|if False:"
[verify_token_gate_removed]="app/api/routers/verify.py|if record is None or record.status != EvaluationStatus.finalized:|if record is None:"
[pdf_gated_subject_removed]="app/api/routers/evaluations.py|ensure_subject_may_read_own_result(db)|pass"
)

IFS='|' read -r file old new <<< "${MUTATIONS[$NAME]}"
echo "=== MUTATION: $NAME ($file) ===" | tee -a "$RESULTS"
if [ -z "$file" ]; then echo "  unknown mutation" | tee -a "$RESULTS"; exit 2; fi
if ! grep -qF "$old" "$BACKEND/$file"; then
  echo "  SKIP: pattern not found" | tee -a "$RESULTS"; exit 2
fi
BACKUP=/tmp/mut_${NAME}.bak
cp "$BACKEND/$file" "$BACKUP"
python3 - "$BACKEND/$file" "$old" "$new" <<'PYEOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(old) >= 1
open(path, "w").write(src.replace(old, new, 1))
PYEOF
echo "  mutated OK" | tee -a "$RESULTS"

# fresh DB
$PGBIN/psql -h 127.0.0.1 -U nexahr -d postgres -c "DROP DATABASE IF EXISTS nexahr_test;" >/dev/null 2>&1
$PGBIN/psql -h 127.0.0.1 -U nexahr -d postgres -c "CREATE DATABASE nexahr_test OWNER nexahr;" >/dev/null 2>&1

cd "$BACKEND"
timeout 560 python -m pytest -q -x -p no:cacheprovider > /tmp/pytest_mut_out.txt 2>&1
code=$?
tail -2 /tmp/pytest_mut_out.txt | tee -a "$RESULTS"
if [ $code -eq 0 ]; then
  echo "  VERDICT: SURVIVED (suite green with mutation)" | tee -a "$RESULTS"
elif [ $code -eq 124 ]; then
  echo "  VERDICT: TIMEOUT (inconclusive)" | tee -a "$RESULTS"
else
  echo "  VERDICT: DETECTED (suite failed, exit=$code)" | tee -a "$RESULTS"
fi
cp "$BACKUP" "$BACKEND/$file"
cd /home/z/my-project/nexahr-review && git status --short | head -2
echo "restored"
