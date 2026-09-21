import { parseTimerRequest } from "./timer.ts";
export type ToolIntent = "chat" | "remind" | "tasks" | "web" | "repo" | "summarize" | "translate" | "rewrite" | "calc" | "email" | "ideas" | "expenses" | "shopping" | "briefing";
/** Classify only explicit current requests, never treat examples or questions as actions. */
export function inferToolIntent(text: string): ToolIntent {
  const input = text.trim();
  if (/^(?:سلام|درود|hello|hi)[!؟?.،\s]*$/iu.test(input)) return "chat";
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
  if (/(?:تسک(?:‌|\s)*(?:بساز|درست\s*کن|ثبت\s*کن)|لیست\s*کار(?:هام|هایم)?\s*(?:بساز|درست\s*کن)|create\s+(?:a\s+)?task\s*list)/iu.test(input)) return "tasks";
  if (/(?:خلاصه\s*کن|summari[sz]e)/iu.test(input)) return "summarize";
  if (/(?:ترجمه\s*کن|translate)/iu.test(input)) return "translate";
  if (/(?:بازنویسی\s*کن|rewrite)/iu.test(input)) return "rewrite";
  if (/(?:محاسبه\s*کن|حساب\s*کن|calculate|[\d۰-۹٠-٩]\s*[%٪]\s*(?:از|of)|^[\d۰-۹٠-٩.,٬،\s]+\s*[+*×/÷-]\s*[\d۰-۹٠-٩.,٬،\s]+$)/iu.test(input)) return "calc";
  if (/(?:ایمیل\s*بنویس|متن\s*ایمیل|draft\s+(?:an?\s+)?email)/iu.test(input)) return "email";
  if (/(?:ایده\s*بده|ایده‌پردازی|brainstorm)/iu.test(input)) return "ideas";
  return "chat";
}
