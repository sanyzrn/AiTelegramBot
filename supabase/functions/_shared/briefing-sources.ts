/** Optional, no-key daily briefing sources. Never label stale/unknown market data live. */
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Weather = { line: string; source: string; updatedAt: string };
export type Market = { line: string; source: string; updatedAt: string };
const weatherSource = 'https://open-meteo.com/';
const marketSource = 'https://github.com/HosseinOdd/Navasan-API';
const rawBase = 'https://raw.githubusercontent.com/HosseinOdd/Navasan-API/main/data/';
const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
const fresh = (stamp: unknown, now: number, maxAgeMs: number): number | null => {
  const ts = Number(stamp);
  if (!Number.isFinite(ts) || ts < 1700000000) return null;
  const ms = ts * 1000;
  return ms <= now + 120000 && ms >= now - maxAgeMs ? ms : null;
};
async function json(url: string, fetcher: Fetcher): Promise<any> {
  const r = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6500) });
  if (!r.ok) throw new Error(`SOURCE_HTTP_${r.status}`);
  const body = await r.text();
  if (body.length > 250000) throw new Error('SOURCE_OVERSIZED');
  return JSON.parse(body);
}
/** Tehran is an explicit default until a user-set city is implemented. */
export async function fetchTehranWeather(fetcher: Fetcher = fetch, now = Date.now()): Promise<Weather | null> {
  try {
    const params = new URLSearchParams({
      latitude: '35.6892', longitude: '51.3890',
      current: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: '1', timezone: 'Asia/Tehran',
    });
    const j = await json(`https://api.open-meteo.com/v1/forecast?${params}`, fetcher);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    if (j?.timezone !== 'Asia/Tehran' || j?.daily?.time?.[0] !== today) return null;
    const low = Number(j.daily.temperature_2m_min?.[0]);
    const high = Number(j.daily.temperature_2m_max?.[0]);
    const rain = Number(j.daily.precipitation_probability_max?.[0]);
    const temp = Number(j.current?.temperature_2m);
    if (![low, high, rain, temp].every(Number.isFinite) || low < -80 || high > 65 || low > high || rain < 0 || rain > 100) return null;
    const clothing = low < 8 ? 'لباس گرم' : low < 17 ? 'یک لایه سبک' : high >= 32 ? 'لباس خنک' : 'لباس معمولی';
    const umbrella = rain >= 45 ? '؛ چتر هم بردار' : '';
    return { line: `🌤 هوای تهران: الان ${fa(temp)}°، کمینه ${fa(low)}°، بیشینه ${fa(high)}°؛ احتمال بارش تا ${fa(rain)}٪. پیشنهاد: ${clothing}${umbrella}.\nمنبع هوا: Open-Meteo (پیش‌بینی، نه مشاهده قطعی)`, source: weatherSource, updatedAt: String(j.current?.time || today) };
  } catch { return null; }
}
/** The feed is unofficial and may stop refreshing. Per-quote timestamps are mandatory. */
export async function fetchIranMarket(fetcher: Fetcher = fetch, now = Date.now()): Promise<Market | null> {
  try {
    const [fiat, gold] = await Promise.all([json(rawBase + 'fiat.json', fetcher), json(rawBase + 'gold.json', fetcher)]);
    const usd = fiat?.usd;
    const gold18 = gold?.['18ayar'];
    const usdTime = fresh(usd?.date, now, 24 * 3600000);
    const goldTime = fresh(gold18?.date, now, 24 * 3600000);
    // This Navasan feed publishes USD/IRR and 18K gold quotes in toman. Never guess or silently convert again.
    const usdValue = Number(usd?.value), goldValue = Number(gold18?.value);
    const lines: string[] = [];
    const times: number[] = [];
    if (usdTime && Number.isFinite(usdValue) && Number.isInteger(usdValue) && usdValue > 1000 && usdValue < 10000000) {
      lines.push(`💵 دلار بازار: ${fa(usdValue)} تومان`); times.push(usdTime);
    }
    if (goldTime && Number.isFinite(goldValue) && Number.isInteger(goldValue) && goldValue > 100000 && goldValue < 1000000000) {
      lines.push(`🥇 هر گرم طلای ۱۸ عیار: ${fa(goldValue)} تومان`); times.push(goldTime);
    }
    if (!lines.length) return null;
    const oldest = Math.min(...times);
    const stamp = new Date(oldest).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });
    return { line: `${lines.join('\n')}\n🕒 زمان قدیمی‌ترین نرخ: ${stamp} (تهران)؛ منبع: Navasan-API، غیررسمی و صرفاً اطلاع‌رسانی`, source: marketSource, updatedAt: new Date(oldest).toISOString() };
  } catch { return null; }
}
/** Fetch independent inputs concurrently: one outage must not erase the other section. */
export async function briefingExternalSections(fetcher: Fetcher = fetch, now = Date.now()): Promise<string> {
  const [weather, market] = await Promise.all([fetchTehranWeather(fetcher, now), fetchIranMarket(fetcher, now)]);
  return [weather?.line || '🌤 آب‌وهوا: منبع معتبر فعلاً در دسترس نیست.', market?.line || '💰 قیمت ارز و طلا: نرخ تازه و قابل‌تأیید در دسترس نیست.'].join('\n\n');
}
