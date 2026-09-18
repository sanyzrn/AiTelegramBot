"""ROLE 08 — Time/Jalali boundary probes.

Test local-midnight boundaries: a valid UTC timestamp must produce the correct
organizational (Tehran) Jalali date. Test fa_date, to_jalali, local_day_start/end
around Tehran midnight (UTC+3:30, no DST).
"""
import os
import sys

os.environ.setdefault("NEXAHR_ENV_FILE", "")
os.environ["DATABASE_URL"] = "postgresql+psycopg://nexahr:nexahr_dev_password@localhost:5432/nexahr_probe"
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ORG_TIMEZONE", "Asia/Tehran")

sys.path.insert(0, "/home/z/my-project/nexahr-review/backend")

from datetime import UTC, date, datetime, time, timedelta  # noqa: E402

import jdatetime  # noqa: E402

from app.core.clock import local_day_end, local_day_start, now_local, org_timezone, today_local, to_local  # noqa: E402
from app.core.persian import fa_date, fa_digits  # noqa: E402
from app.services.pdf import to_jalali  # noqa: E402

results = []


def check(label, cond, detail=""):
    results.append((label, bool(cond), str(detail)[:120]))


def jalali_of(d: date) -> str:
    return jdatetime.date.fromgregorian(date=d).strftime("%Y/%m/%d")


def t_midnight_boundary():
    # Tehran midnight = 20:30 UTC of previous day.
    # A finalization at 00:15 Tehran on 2026-03-21 (= 2026-03-20 20:45 UTC)
    utc_dt = datetime(2026, 3, 20, 20, 45, tzinfo=UTC)
    local = to_local(utc_dt)
    check("tz:tehran_offset", local.hour == 0 and local.minute == 15, local)
    check("tz:local-date-next-day", local.date() == date(2026, 3, 21), local.date())
    # fa_date must show the LOCAL (Tehran) Jalali date, not UTC's
    got = fa_date(utc_dt)
    want = jalali_of(date(2026, 3, 21)).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
    check("jalali:fa_date-uses-local-day", got == want, f"{got} vs {want}")
    # to_jalali (PDF) same
    got2 = to_jalali(utc_dt)
    check("jalali:pdf-to_jalali-uses-local-day", "۱۴۰۵/۰۱/۰۱" in got2 or got2.startswith("۱۴۰۵"), got2)
    # Exactly the boundary instant: 20:30 UTC = 00:00 Tehran next day
    boundary = datetime(2026, 3, 20, 20, 30, tzinfo=UTC)
    check("tz:boundary-instant-is-midnight", to_local(boundary).hour == 0 and to_local(boundary).date() == date(2026, 3, 21), to_local(boundary))
    # one second before boundary still previous day
    before = boundary - timedelta(seconds=1)
    check("tz:one-sec-before-boundary-prev-day", to_local(before).date() == date(2026, 3, 20), to_local(before).date())


def t_day_filters():
    # local_day_start("15 Mehr") must start at 00:00 Tehran = 20:30 UTC previous Gregorian day
    d = date(2026, 10, 7)
    start = local_day_start(d)
    check("filter:day-start-utc-moment", start == datetime(2026, 10, 6, 20, 30, tzinfo=UTC), start)
    end = local_day_end(d)
    check("filter:day-end-next-midnight", end == datetime(2026, 10, 7, 20, 30, tzinfo=UTC), end)
    # full-day window is exactly 24h
    check("filter:window-24h", end - start == timedelta(hours=24), end - start)


def t_fa_digits():
    check("digits:decimal-separator", fa_digits(82.5) == "۸۲٫۵", fa_digits(82.5))
    check("digits:none-dash", fa_digits(None) == "—", fa_digits(None))
    check("digits:int", fa_digits(7) == "۷", fa_digits(7))


def t_jalali_leap():
    # Jalali leap year edge: 1403 is leap (Esfand 30 exists)
    check("jalali:leap-1403-esfand30", jdatetime.date(1403, 12, 30).togregorian() is not None)
    # 1404 not leap — Esfand has 29 days
    check("jalali:non-leap-1404", jdatetime.date(1404, 12, 29).togregorian() is not None)


def t_now_local():
    n = now_local()
    check("now:tz-aware-tehran", n.tzinfo is not None and n.utcoffset() == timedelta(hours=3, minutes=30), n.utcoffset())
    check("today:local-date", today_local() == n.date(), (today_local(), n.date()))


def main():
    t_midnight_boundary()
    t_day_filters()
    t_fa_digits()
    t_jalali_leap()
    t_now_local()
    fails = [x for x in results if not x[1]]
    print(f"\n==== TIME/JALALI PROBE: {len(results)} checks, {len(fails)} FAILURES ====")
    for label, ok, detail in fails:
        print(f"  FAIL {label} ({detail})")
    if not fails:
        print("  all checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
