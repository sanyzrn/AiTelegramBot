#!/usr/bin/env bash
# ROLE 09 — real browser exercise: backend + frontend + agent-browser in one call.
# Exercises: login page RTL, login flow, dashboard, dark theme, personnel page,
# keyboard focus, console errors. Demo seed data enabled.
set -u
export PATH=/home/z/my-project/nexahr-review/backend/.venv/bin:$PATH
export PGIMG=/home/z/my-project/pgimg/rootfs
export LD_LIBRARY_PATH="$PGIMG/usr/lib/x86_64-linux-gnu:$PGIMG/usr/lib/postgresql/16/lib"
export PGPASSWORD=nexahr_dev_password
PGBIN="$PGIMG/usr/lib/postgresql/16/bin"

# fresh browser DB
$PGBIN/psql -h 127.0.0.1 -U nexahr -d postgres -c "DROP DATABASE IF EXISTS nexahr_browser;" >/dev/null 2>&1
$PGBIN/psql -h 127.0.0.1 -U nexahr -d postgres -c "CREATE DATABASE nexahr_browser OWNER nexahr;" >/dev/null 2>&1
export DATABASE_URL="postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_browser"
export ENVIRONMENT=development JWT_SECRET_KEY=browser-test-secret ENABLE_SCHEDULER=false BOOTSTRAP_ADMIN=false SEED_DEMO_DATA=true

cd /home/z/my-project/nexahr-review/backend
alembic upgrade head >/dev/null 2>&1

.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/uvicorn.log 2>&1 &
BACKEND_PID=$!
cd /home/z/my-project/nexahr-review/frontend
npm run dev -- --port 5174 --strictPort --host 127.0.0.1 > /tmp/vite.log 2>&1 &
FRONT_PID=$!
sleep 12

curl -s http://127.0.0.1:8000/api/health && echo " BACKEND OK"
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/ && echo " FRONTEND OK"

echo "--- browser: login page ---"
agent-browser open http://127.0.0.1:5174/login
agent-browser wait --load networkidle 2>/dev/null || true
agent-browser get title
agent-browser eval "document.documentElement.getAttribute('dir')"
agent-browser eval "getComputedStyle(document.body).direction"
agent-browser snapshot -i -c 2>/dev/null | head -25

echo "--- browser: login as demo admin ---"
agent-browser find label "نام کاربری" fill "hr1" 2>/dev/null || agent-browser snapshot -i -c | head -12
agent-browser find label "رمز عبور" fill "NexaHR@12345" 2>/dev/null || true
agent-browser find role button click --name "ورود" 2>/dev/null || true
sleep 4
agent-browser get url
agent-browser snapshot -c -d 4 2>/dev/null | head -40

echo "--- browser: console errors after login ---"
agent-browser errors 2>/dev/null | head -10

echo "--- browser: dark theme toggle ---"
agent-browser eval "document.documentElement.getAttribute('data-theme')"
agent-browser storage local set nexahr:theme dark
agent-browser reload
agent-browser wait --load networkidle 2>/dev/null || true
sleep 2
agent-browser eval "document.documentElement.getAttribute('data-theme')"

echo "--- browser: keyboard focus check (Tab) ---"
agent-browser open http://127.0.0.1:5174/login
agent-browser wait --load networkidle 2>/dev/null || true
agent-browser eval "document.activeElement.tagName"
agent-browser press Tab
agent-browser eval "document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').slice(0,30)"

echo "--- browser: mobile viewport ---"
agent-browser set viewport 390 844
agent-browser open http://127.0.0.1:5174/login
agent-browser wait --load networkidle 2>/dev/null || true
agent-browser eval "document.documentElement.getAttribute('dir') + ' ' + window.innerWidth"
agent-browser snapshot -i -c 2>/dev/null | head -12

echo "--- browser: screenshots ---"
agent-browser set viewport 1440 900
agent-browser open http://127.0.0.1:5174/login
agent-browser wait --load networkidle 2>/dev/null || true
agent-browser screenshot /home/z/my-project/scripts/shot_login_light.png
agent-browser storage local set nexahr:theme dark
agent-browser reload
sleep 2
agent-browser screenshot /home/z/my-project/scripts/shot_login_dark.png

agent-browser close 2>/dev/null || true
kill $BACKEND_PID $FRONT_PID 2>/dev/null
echo "=== BROWSER EXERCISE DONE ==="
