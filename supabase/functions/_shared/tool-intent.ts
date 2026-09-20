export type ToolIntent = "chat" | "remind" | "tasks" | "web" | "repo" | "summarize" | "translate" | "rewrite" | "calc" | "email" | "ideas";

/** Infer explicit requests only. This function never executes an action. */
export function inferToolIntent(text: string): ToolIntent {
  const input = text.trim();
  if (/^(?:سلام|درود|hello|hi)[!؟?.،\s]*$/iu.test(input)) return "chat";
  if (/(?:یادم\s*بنداز|یادآور(?:ی)?\s*(?:بذار|بگذار|ثبت|تنظیم|بساز)|ریمایندر\s*(?:بذار|بگذار|ثبت|بساز)|remind\s+me|set\s+(?:a\s+)?reminder)/iu.test(input) && !/(?:چطور|چگونه|آموزش|مثال|how\s+to)/iu.test(input)) return "remind";
  if (/https:\/\/github\.com\/[\w-]+\/[\w.-]+/i.test(input) && /(?:بررسی|تحلیل|audit|review|آنالیز)/iu.test(input)) return "repo";
  if (/(?:جستجو\s*کن|جست‌وجو\s*کن|آنلاین\s*بگرد|تو\s*اینترنت\s*بگرد|search\s+(?:the\s+)?web)/iu.test(input)) return "web";
  if (/(?:تسک(?:‌|\s)*(?:بساز|درست\s*کن|ثبت\s*کن)|لیست\s*کار(?:هام|هایم)?\s*(?:بساز|درست\s*کن)|create\s+(?:a\s+)?task\s*list)/iu.test(input)) return "tasks";
  if (/(?:خلاصه\s*کن|summari[sz]e)/iu.test(input)) return "summarize";
  if (/(?:ترجمه\s*کن|translate)/iu.test(input)) return "translate";
  if (/(?:بازنویسی\s*کن|rewrite)/iu.test(input)) return "rewrite";
  if (/(?:محاسبه\s*کن|حساب\s*کن|calculate)/iu.test(input)) return "calc";
  if (/(?:ایمیل\s*بنویس|متن\s*ایمیل|draft\s+(?:an?\s+)?email)/iu.test(input)) return "email";
  if (/(?:ایده\s*بده|ایده‌پردازی|brainstorm)/iu.test(input)) return "ideas";
  return "chat";
}
