/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Job-safety screening.
 *
 * Flags recruitment-scam and unsafe-listing patterns. This runs on every job
 * before an application is generated; anything rated "high" is never applied to.
 */
import { normaliseText } from './skillTaxonomy.js';

const FREE_EMAIL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.ru', 'yandex.com', 'protonmail.com', 'gmx.com'];
const URL_SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'rebrand.ly'];

/** Each signal: id, label, severity (1-3), weight contributed to the risk score. */
const SIGNALS = [
  { id: 'money_request', label: 'Asks the candidate for money or a registration/admin fee', severity: 3, weight: 45, re: /(registration|admin(istration)?|processing|placement|training|application|security)\s*(fee|fees|payment|deposit)|pay\s*(a\s*)?(small\s*)?(fee|deposit)|fee\s*(of\s*)?R?\s?\d|invoice\s*(you|the candidate)|pay\s*for\s*(your\s*)?(training|equipment|medical|placement)/i },
  { id: 'upfront_payment', label: 'Requests any upfront payment, deposit or "refundable" amount', severity: 3, weight: 45, re: /(upfront|up-front|refundable|deposit\s*required|payment\s*required|cash\s*deposit|transfer\s*(the\s*)?(money|funds))/i },
  { id: 'crypto_payment', label: 'Requires or requests cryptocurrency payment / wallet details', severity: 3, weight: 40,
    re: /((paid|payment|pay|salary|deposit|transfer|send)\s*(in|via|using|with)?\s*(crypto(currency)?|bitcoin|usdt|ethereum|usdc)\b)|(bitcoin|usdt|ethereum|usdc)\s*(wallet|address|payment)|crypto\s*wallet|wallet\s*address|forex\s*trading\s*(job|assistant)/i },
  { id: 'bank_details', label: 'Asks for bank account details / ID copies before any interview', severity: 3, weight: 35, re: /(bank\s*(account|details|verification)|account\s*number|cv\s*and\s*(id|passport)|copy\s*of\s*(your\s*)?(id|passport)|certified\s*copy\s*of\s*(your\s*)?(id|passport)|sms\s*the\s*word|facial\s*verification\s*app)/i },
  { id: 'whatsapp_only', label: 'Interviews or applications only via WhatsApp/Telegram with no company presence', severity: 2, weight: 18, re: /(whats?app\s*(us|me|only|\+?\d)|apply\s*(via|through)\s*whats?app|telegram\s*(only|us|me)|contact\s*(me\s*)?on\s*whats?app)/i },
  { id: 'free_email_recruiter', label: 'Recruiter contact uses a free personal email domain', severity: 2, weight: 15, re: new RegExp(`[a-z0-9._%+-]+@(?:${FREE_EMAIL.map((d) => d.replace('.', '\\.')).join('|')})`, 'i') },
  { id: 'vague_employer', label: 'Employer name withheld / "confidential client" with no company details', severity: 2, weight: 14, re: /(confidential\s*(client|company|employer)|client\s*(name\s*)?withheld|undisclosed\s*(company|employer)|our\s*client\s*is\s*an?\s*(leading|reputable)\s*(company|firm)\s*in\b)/i },
  { id: 'unrealistic_pay', label: 'Pay that is unrealistic for the stated experience or effort', severity: 3, weight: 30, re: /(earn\s*(up\s*to\s*)?R?\s?\d{3,}\s*(per|\/)\s*(day|hour|week)|R\s?\d{3,}\s*(per|\/)\s*(hour|day)\s*(no\s*experience)?|no\s*experience\s*(needed|required|necessary).{0,60}(R\s?\d{3,}|salary|\$\d{3,}))/i },
  { id: 'shortened_link', label: 'Uses a link shortener to hide the destination', severity: 2, weight: 16, re: new RegExp(`(?:${URL_SHORTENERS.map((d) => d.replace('.', '\\.')).join('|')})`, 'i') },
  { id: 'sensitive_info', label: 'Requests sensitive personal information unnecessarily (banking, ID numbers, OTP codes)', severity: 3, weight: 32, re: /(otp\s*code|one[- ]time\s*pin|send\s*(us\s*)?your\s*(id\s*)?number|pin\s*number|credit\s*card\s*(details|number)|banking\s*details\s*via\s*email)/i },
  { id: 'urgency_pressure', label: 'High-pressure urgency with limited information', severity: 1, weight: 8, re: /(urgent(ly)?\s*(hire|hiring|need)|immediate\s*start\s*(only)?|limited\s*(slots|positions)\s*[-–!]|act\s*now|positions\s*close\s*(today|tonight))/i },
  { id: 'no_interview_process', label: 'Hiring with no interview or verification step at all', severity: 2, weight: 20, re: /(no\s*(interview|experience)\s*(needed|required)|hired?\s*(immediately|instantly)\s*(without|no)\s*interview|start\s*(work(ing)?)?\s*(today|immediately)\s*without\s*(an\s*)?interview)/i },
  { id: 'pyramid', label: 'MLM / recruitment-of-recruits or commission-only "business opportunity" language', severity: 3, weight: 34, re: /(business\s*opportunity\s*(of\s*a\s*lifetime)?|be\s*your\s*own\s*boss.{0,40}(commission|recruit)|recruit\s*(friends|family|people)\s*(and|to)\s*(earn|get)|network\s*marketing|\bmlm\b|downline)/i },
  { id: 'gift_card', label: 'Gift cards, vouchers or vouchers-as-payment mentions', severity: 3, weight: 28, re: /(gift\s*card|voucher\s*(payment|code)|steam\s*card|itunes\s*card)/i },
];

/**
 * @param {{title?:string, company?:string, description?:string, url?:string, applyEmail?:string, requirements?:object}} job
 * @returns {{ level:'low'|'medium'|'high', score:number, flags:Array<{id:string,label:string,severity:number,evidence?:string}>, checkedAt:string }}
 */
export function assessJobRisk(job = {}) {
  const haystack = [job.title, job.company, job.description, job.url, job.applyEmail, job.requirements ? JSON.stringify(job.requirements) : '']
    .filter(Boolean)
    .join('\n');
  const text = normaliseText(haystack);
  const flags = [];
  let score = 0;

  for (const signal of SIGNALS) {
    const m = signal.re.exec(haystack) || signal.re.exec(text);
    if (!m) continue;
    const severity = signal.severity;
    // A weak employer/company signal alone is less concerning on legitimate job boards.
    const weight = signal.id === 'free_email_recruiter' && job.sourceKey === 'manual' ? signal.weight / 2 : signal.weight;
    score += weight;
    flags.push({ id: signal.id, label: signal.label, severity, evidence: excerpt(haystack, m.index) });
  }

  if (job.company && /^(confidential|private|n\/a|none)$/i.test(String(job.company).trim())) {
    flags.push({ id: 'no_company_name', label: 'No company name provided', severity: 2 });
    score += 12;
  }

  score = Math.min(100, score);
  const level = score >= 45 ? 'high' : score >= 18 ? 'medium' : 'low';
  return {
    level,
    score,
    flags,
    blocked: level === 'high',
    checkedAt: new Date().toISOString(),
    summary:
      level === 'high'
        ? 'High-risk listing — will not be applied to.'
        : level === 'medium'
          ? 'Some risk signals — review before applying.'
          : 'No notable risk signals.',
  };
}

function excerpt(text, index) {
  if (index === undefined || index < 0) return undefined;
  return text.slice(Math.max(0, index - 40), Math.min(text.length, index + 90)).replace(/\s+/g, ' ').trim();
}

/** Convenience guard used by the application pipeline. */
export function isBlocked(risk) {
  return risk?.level === 'high';
}
