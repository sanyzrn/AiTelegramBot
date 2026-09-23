import { parseTimerRequest } from "./timer.ts";
export type ToolIntent = "chat" | "remind" | "tasks" | "web" | "repo" | "summarize" | "translate" | "rewrite" | "calc" | "email" | "ideas" | "expenses" | "shopping" | "briefing"
  | "receipt" | "joke" | "story" | "horoscope" | "trivia" | "roast";
/** Explicit search commands — matched before how-to so «جستجو کن چطور…» still searches. */
const EXPLICIT_WEB =
  /(?:جست(?:جو|‌جو|‌وجو|و\s*جو)\s*(?:کن|کنم|بزن|بگیر)|جست(?:جو|‌جو|‌وجو)ی\s*(?:آنلاین|اینترنت|وب)|(?:آنلاین|اینترنت|وب)\s*(?:جست(?:جو|‌جو|‌وجو)|سرچ|بگرد|پیدا\s*کن)|سرچ\s*کن|search\s+(?:the\s+)?web|search\s+online|google\s+(?:کن|it)|بگرد\s*(?:دنبال|درباره|راجع)|تو\s*(?:اینترنت|گوگل|وب)\s*(?:بگرد|سرچ|جست))/iu;
/** Live facts that almost always need Google Search, not training data. */
const LIVE_FACTS =
  /(?:قیمت|نرخ|نرخِ|ارزش)\s*(?:الان|امروز|لحظه|فعلی|دلار|یورو|طلا|سکه|بیت|بیت‌کوین|مسکن|ارز|سکه|بنزین|نفت)|(?:خبر|رویداد|اتفاق|نتیجه|امتیاز)\s*(?:های?\s*)?(?:امروز|جدید|اخیر|آخرین|امسال)|(?:آب[\s‌]*و[\s‌]*هوا|هوا)ی?\s*(?:امروز|الان|فردا|این\s*هفته)|(?:چه\s*کسی|کی)\s+(?:برنده|رئیس|قهرمان|انتخاب)\s|who\s+(?:won|is|was)\s+(?:the\s+)?(?:latest|current|today|recent)|latest\s+(?:news|price|score|result)|today'?s\s+(?:news|price|weather|score)/iu;
/** Classify only explicit current requests, never treat examples or questions as actions. */
export function inferToolIntent(text: string): ToolIntent {
  const input = text.trim();
  if (/^(?:سلام|درود|hello|hi)[!؟?.،\s]*$/iu.test(input)) return "chat";
  if (EXPLICIT_WEB.test(input)) return "web";
  // Live-fact questions before how-to: «آب و هوای امروز چطوره؟» is weather, not a tutorial.
  if (LIVE_FACTS.test(input)) return "web";
  if (/(?:چطور|چگونه|آموزش|مثال|how\s+to)/iu.test(input)) return "chat";
  if (parseTimerRequest(input)) return "remind";
  if (/(?:تایمر|زمان[‌\s-]*سنج|timer)/iu.test(input) &&
      /(?:بذار|بگذار|بزن|تنظیم\s*کن|ست\s*کن|شروع\s*کن|set\s+(?:a\s+)?timer|start\s+(?:a\s+)?timer)/iu.test(input) &&
      !/(?:چرا|کار\s*نمی[‌\s]*کن|\?|؟)/iu.test(input)) return "remind";
  if (/^(?:\/briefing|صبح[‌\s-]*نامه)/iu.test(input)) return "briefing";
  // City selection belongs to the morning briefing: /city, «شهر من …», «شهرم …», «شهر صبح‌نامه …».
  if (/^\/city(?:\s|$)|^شهر(?:\s*من\s|\s*من$|\s*من\s*[:：]|\s*م\s|\s*م$|\s*صبح[‌\s-]*نامه\s|\s*[:：])/iu.test(input)) return "briefing";
  if (/^(?:\/shopping|لیست\s+خرید|به\s+لیست\s+خرید\s+اضافه\s+کن|خرید[‌\s-]*هام)/iu.test(input)) return "shopping";
  if (/^(?:\/expense|\/expenses|\/spend|خرج\s+|خرج[‌\s-]*هام|گزارش\s+خرج)/iu.test(input) || /^(?:ناهار|شام|صبحانه|بنزین|تاکسی|قهوه|خوراک|خرید|قبض|کرایه|اجاره|دارو|نان|سوخت|پارکینگ|سوپرمارکت)\s+[۰-۹٠-٩\d,٬،]+(?:\s*(?:هزار|میلیون))?\s*(?:تومان|تومن|ریال)?$/iu.test(input)) return "expenses";
  if (/(?:یادم\s*بنداز|یادآور(?:ی)?\s*(?:بذار|بگذار|ثبت|تنظیم|بساز)|ریمایندر\s*(?:بذار|بگذار|ثبت|بساز)|remind\s+me|set\s+(?:a\s+)?reminder)/iu.test(input)) return "remind";
  if (/https:\/\/github\.com\/[\w-]+\/[\w.-]+/i.test(input) && /(?:بررسی|تحلیل|audit|review|آنالیز)/iu.test(input)) return "repo";
  if (/(?:جستجو\s*کن|جست‌وجو\s*کن|آنلاین\s*بگرد|تو\s*اینترنت\s*بگرد|search\s+(?:the\s+)?web)/iu.test(input)) return "web";
  if (/(?:تسک(?:‌|\s)*(?:بساز|درست\s*کن|ثبت\s*کن)|لیست\s+کار(?:هام|هایم)?\s*(?:بساز|درست\s*کن)|create\s+(?:a\s+)?task\s*list)/iu.test(input)) return "tasks";
  if (/(?:خلاصه\s*کن|summari[sz]e)/iu.test(input)) return "summarize";
  if (/(?:ترجمه\s*کن|translate)/iu.test(input)) return "translate";
  if (/(?:بازنویسی\s*کن|rewrite)/iu.test(input)) return "rewrite";
  if (/(?:محاسبه\s*کن|حساب\s*کن|calculate|[\d۰-۹٠-٩]\s*[%٪]\s*(?:از|of)|^[\d۰-۹٠-٩.,٬،\s]+\s*[+*×/÷-]\s*[\d۰-۹٠-٩.,٬،\s]+$)/iu.test(input)) return "calc";
  if (/(?:ایمیل\s*بنویس|متن\s*ایمیل|draft\s+(?:an?\s+)?email)/iu.test(input)) return "email";
  if (/(?:ایده\s*بده|ایده‌پردازی|brainstorm)/iu.test(input)) return "ideas";
  // Every keyboard tool also works from plain text, no menu needed.
  if (/(?:رسید|فاکتور|فیش|صورت[\s‌]*حساب)(?:ه|م|ش)?\s*(?:(?:رو|را)\s*)?(?:ثبت|وارد|اضافه)\s*کن/iu.test(input)) return "receipt";
  if (/(?:(?:یه|یک)\s*)?(?:جوک|لطیفه)\s*(?:بگو|تعریف\s*کن|بلدی|داری)|^(?:یه|یک)\s*جوک/iu.test(input)) return "joke";
  if (/(?:یه|یک)\s*(?:داستان|قصه)(?:\s*کوتاه)?\s*(?:بگو|بنویس|تعریف\s*کن)|^(?:قصه|داستان)\s*(?:بگو|تعریف\s*کن)/iu.test(input)) return "story";
  if (!/حافظ/u.test(input) && /(?:طالع|فال)(?:\s*(?:امروز|روزانه))?(?:\s*(?:من|م))?\s*(?:(?:رو|را)\s*)?(?:بگو|بگیر|ببین|چیه)/iu.test(input)) return "horoscope";
  if (/(?:(?:یه|یک)\s*(?:معما|چیستان))|(?:معما|چیستان|تست\s*هوش)\s*(?:بگو|بده|بپرس|طرح\s*کن)/iu.test(input)) return "trivia";
  if (/(?:روست(?:م)?\s*کن|منو\s*روست|roast\s+me)/iu.test(input)) return "roast";
  return "chat";
}
