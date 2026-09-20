/** Exact decimal arithmetic for common Persian calculator requests; no eval or floating point. */
const fa = (s: string) => s.replace(/[۰-۹٠-٩]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c) >= 0 ? "۰۱۲۳۴۵۶۷۸۹".indexOf(c) : "٠١٢٣٤٥٦٧٨٩".indexOf(c)));
type Decimal = { n: bigint; scale: bigint };
function parse(s: string): Decimal | null {
  const t = fa(s).trim().replace(/[,٬،]/g, "");
  const m = /^(-?\d{1,15})(?:\.(\d{1,9}))?(?:\s*(هزار|میلیون|میلیارد))?$/.exec(t);
  if (!m) return null;
  const scale = 10n ** BigInt((m[2] || "").length);
  let n = BigInt(m[1]) * scale + BigInt((m[1][0] === "-" ? "-" : "") + (m[2] || "0"));
  const factor = ({ هزار: 1000n, میلیون: 1000000n, میلیارد: 1000000000n } as Record<string, bigint>)[m[3]] || 1n;
  n *= factor;
  if (n > 10n ** 25n || n < -(10n ** 25n)) return null;
  return { n, scale };
}
const persian = (s: string) => s.replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)]);
function present(n: bigint, d: bigint): string {
  if (!d) throw Error("DIV_ZERO");
  const sign = (n < 0n) !== (d < 0n) ? "-" : "";
  n = n < 0n ? -n : n;
  d = d < 0n ? -d : d;
  const integer = n / d;
  let remainder = n % d;
  let frac = "";
  for (let i = 0; i < 9 && remainder !== 0n; i++) {
    remainder *= 10n;
    frac += String(remainder / d);
    remainder %= d;
  }
  if (remainder !== 0n) frac += "…";
  return sign + integer.toLocaleString("fa-IR") + (frac ? "." + persian(frac) : "");
}
export function calculateExact(input: string): string | null {
  const t = fa(input).trim().replace(/^(?:\/calc\s*|محاسبه\s*کن\s*|حساب\s*کن\s*)/iu, "");
  const percent = /^(.+?)\s*(?:%|٪|درصد)\s*(?:از|of)\s*(.+?)\s*[؟?]?$/iu.exec(t);
  if (percent) {
    const rate = parse(percent[1]), base = parse(percent[2]);
    if (!rate || !base) return null;
    return "🧮 نتیجه دقیق: " + present(rate.n * base.n, rate.scale * base.scale * 100n);
  }
  const binary = /^(.+?)\s*([+*×/÷-])\s*(.+?)\s*[؟?]?$/u.exec(t);
  if (!binary) return null;
  const a = parse(binary[1]), b = parse(binary[3]);
  if (!a || !b) return null;
  const op = binary[2];
  if ((op === "/" || op === "÷") && b.n === 0n) return "تقسیم بر صفر تعریف نشده است.";
  const n = op === "+" ? a.n * b.scale + b.n * a.scale : op === "-" ? a.n * b.scale - b.n * a.scale : op === "*" || op === "×" ? a.n * b.n : a.n * b.scale;
  const d = op === "+" || op === "-" ? a.scale * b.scale : op === "*" || op === "×" ? a.scale * b.scale : a.scale * b.n;
  return "🧮 نتیجه دقیق: " + present(n, d);
}
