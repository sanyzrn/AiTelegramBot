/** Pure regexes for typed life commands; the gateway forwards anything matched here. */
import { isExpenseCommand } from "./life-expenses.ts";

export const RX = {
  briefingTest: /^(?:\/briefing_test|صبح[‌\s-]*نامه\s+(?:تست|الان))$/iu,
  briefing: /^(?:\/briefing(?:\s+(on|off))?|صبح[‌\s-]*نامه(?:\s+(روشن|خاموش|فعال|غیرفعال))?)$/iu,
  briefingHour: /^(?:\/briefing_hour\s+([0-9۰-۹]{1,2})|صبح[‌\s-]*نامه\s+(?:رو\s+)?(?:ساعت\s+)?([0-9۰-۹]{1,2})(?:\s*صبح)?(?:\s+(?:بفرست|بذار|تنظیم\s*کن))?)$/iu,
  briefingVoice: /^(?:\/briefing_voice\s+(on|off)|صبح[‌\s-]*نامه\s+صوتی\s+(روشن|خاموش|فعال|غیرفعال))$/iu,
  expensesReport: /^(?:\/expenses|خرج[‌\s-]*هام|گزارش\s*خرج(?:‌|\s)*ها)$/iu,
  expenseDeleteLast: /^(?:\/expense_undo|حذف\s+آخرین\s+(?:خرج|هزینه)|آخرین\s+(?:خرج|هزینه)\s*(?:رو|را)?\s*(?:پاک|حذف)\s*کن)$/iu,
  shoppingAdd: /^(?:\/shopping\s+add\s+|به\s+لیست\s+خرید\s+اضافه\s+کن\s+|لیست\s+خرید\s*[:：]\s*)(.+)$/iu,
  shoppingList: /^(?:\/shopping|لیست\s+خرید|خرید[‌\s-]*هام)$/iu,
  shoppingRemove: /^(?:\/shopping\s+remove\s+|(?:از\s+لیست\s+خرید\s+)?(?:حذف|پاک)\s+کن\s+از\s+لیست\s+خرید\s+|حذف\s+از\s+لیست\s+خرید\s+)(.+)$/iu,
  shoppingClearDone: /^(?:\/shopping\s+clear|(?:پاک(?:\s*کردن)?|حذف)\s+(?:خریدهای|اقلام)\s+(?:انجام[‌\s-]*شده|خریده[‌\s-]*شده|تیک[‌\s-]*خورده))$/iu,
  shoppingShare: /^(?:\/share|اشتراک\s+(?:گذاری\s+)?لیست\s+خرید|لیست\s+خرید\s+(?:رو\s+)?(?:شریک|مشترک)\s+کن)$/iu,
  shoppingJoin: /^(?:\/join\s+([0-9۰-۹]{6})|عضو(?:یت)?\s+(?:در\s+)?لیست\s+خرید\s+([0-9۰-۹]{6}))$/iu,
  shoppingLeave: /^(?:\/leave|ترک\s+لیست\s+خرید|خروج\s+از\s+لیست\s+خرید)$/iu,
  tasksList: /^(?:\/tasks|تسک[‌\s-]*هام|کارهای\s+من)$/iu,
  taskEdit: /^\/task\s+(delete|edit)\s+(\d{1,16})(?:\s+([\s\S]{1,200}))?$/i,
  remindersList: /^(?:\/reminders|یادآور(?:‌|\s)*هام|یادآورهای\s+(?:من|فعال))$/iu,
  timezoneShow: /^(?:\/timezone|منطقه\s+زمانی(?:\s+من)?(?:\s*(?:چیه|[?؟]))?)$/iu,
  timezoneSet: /^(?:\/timezone\s+(.+)|منطقه\s+زمانی(?:\s+من)?\s*(?:[:：]\s*|(?:رو|را)\s+(?:بذار|بگذار|تنظیم\s*کن)\s+)?(.+))$/iu,
  weekly: /^(?:\/weekly|خلاصه(?:\s+ی)?\s+هفته(?:\s*(?:م|ام|‌ام))?(?:\s+(?:روشن|خاموش|فعال|غیرفعال))?)$/iu,
  pomodoro: /^(?:\/pomodoro(?:\s+([0-9۰-۹]))?|پومودورو(?:\s+([0-9۰-۹]))?(?:\s+(?:شروع|بذار|بزن))?)$/iu,
  memoryAdd: /^(?:سعید[،,]?\s*)?(?:یادت\s*(?:باشه|بمونه)|به\s*خاطر\s*بسپار|remember\s+that)\s+(?:که\s+)?([\s\S]{3,300})$/iu,
  memoryList: /^(?:\/memories|حافظه(?:‌|\s)*(?:هام|ی\s+من|من)|چی\s+(?:از\s+من\s+)?یادته[?؟]?)$/iu,
  memoryClear: /^(?:\/memories\s+clear|(?:همه(?:\s+ی)?\s+)?حافظه(?:‌|\s)*ها(?:مو|م\s+رو|ی\s+من\s+رو)?\s+پاک\s+کن)$/iu,
  watchersList: /^(?:\/alerts|هشدار(?:‌|\s)*هام|هشدارهای\s+من)$/iu,
  watcherAdd: /^(?:وقتی|اگه|اگر|هر\s*وقت|هروقت)\s+[\s\S]{3,200}(?:خبرم\s+کن|یادم\s+بنداز|بهم\s+بگو)[\s\S]{0,80}$/iu,
};

/** Reply-to-bot speech: «بخونش», «🔊», /speak. */
export const SPEAK = /^(?:\/speak|🔊|بخونش|بلند\s+بخون(?:ش)?|برام\s+بخون(?:ش)?|صوتیش\s+کن)$/iu;
/** Full-history Markdown export. */
export const EXPORT_ALL = /^(?:\/md\s+all|\/md_all|خروجی\s+کامل)$/iu;
/** Reply-translate shortcut on any replied text. */
export const REPLY_TRANSLATE = /^(?:ترجمه|ترجمه[‌\s]*(?:ش|اش)?\s*کن|translate)$/iu;

/** True when the text is a typed life command the processor owns. */
export function isLifeCommand(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  // Smart expense lines and batch headers («چند تا هزینه ثبت کن حاجی» + list)
  // are handled deterministically — no classifier call, no silent chat downgrade.
  if (isExpenseCommand(t)) return true;
  return Object.values(RX).some((rx) => rx.test(t)) || SPEAK.test(t) || EXPORT_ALL.test(t);
}

export const toLatinDigits = (s: string) =>
  s.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".includes(d) ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
