// =====================================================================
//  Kiểm tra & làm sạch kết quả GPT (SPEC 6.4). Hàm thuần, không I/O.
//  Nhận `unknown` (JSON đã parse — có thể sai shape nếu chạy json_object),
//  trả { ok, value } hoặc { ok:false, reason } để brain fallback offline.
// =====================================================================
import type {
  AgentState, Beat, BeatPlan, BeatRequest, CandidateRequest, DayRecap, Gender, HrAction, HrDecision, Look, Persona,
  PromptContext, RecapRequest, RoleKey, SceneLine, SceneRequest, SceneResult, SceneType, Traits, Verdict,
} from '../types.js';
import { ACCESSORIES, HAIR_STYLES, HR_ACTIONS } from './schemas.js';
import { ROLE_AGE, cut } from './prompts.js';
import { fillBeatDesc } from '../content/catalog.js';

export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = <T>(reason: string): Outcome<T> => ({ ok: false, reason });

export const LIMITS = {
  lineChars: 220,
  summaryChars: 160,
  reasonChars: 80,
  memoryChars: 120,
  rumorChars: 160,
  relDelta: 15,
  moodDelta: 15,
  kpiDelta: 25,
  decisionReasonChars: 100,
  maxDecisions: 6,
  beatNoteChars: 140,
  maxBeats: 3,
} as const;

// ---------------------------------------------------------------- v3: kết quả (verdict) theo loại cảnh

/**
 * Cảnh có verdict: các giá trị hợp lệ (cảnh 2 kết quả: [tốt, xấu]) + mặc định khi model không trả / trả sai.
 * v5: crisis_meeting (mã phương án) và pep_talk có mặc định null — Director tự dùng lựa chọn dự phòng đã chọn sẵn
 * (req.crisis.pick) để phân biệt "AI chốt" với "AI trả rác". Cảnh khác luôn null.
 */
export const VERDICT_BY_TYPE: Partial<Record<SceneType, { values: Verdict[]; fallback: Verdict | null }>> = {
  interview: { values: ['hired', 'rejected'], fallback: 'hired' },
  resign_talk: { values: ['stay', 'leave'], fallback: 'stay' },
  raise_request: { values: ['approved', 'denied'], fallback: 'denied' },
  crisis_meeting: { values: ['plan_a', 'plan_b', 'plan_c', 'plan_d'], fallback: null },
  pep_talk: { values: ['inspired', 'unmoved'], fallback: null },
};

/** Model có thể viết tiếng Việt / đồng nghĩa; map về đúng giá trị của loại cảnh, sai thì về mặc định. */
const VERDICT_SYNONYMS: Record<Verdict, RegExp> = {
  hired: /^(yes|ok|dau|nhan)$|hire|nhan|dau|pass|accept|trung/,
  rejected: /^no$|reject|loai|truot|khongnhan|fail|tuchoi|khongdat/,
  stay: /^(stay|olai|giu)$|stay|olai|giulai|remain|keep|thuyetphuc|convinc/,
  leave: /^(leave|quit|resign|nghi|di|roi|out)$|leave|quit|resign|nghiviec|xinnghi|thoiviec|rakhoi/,
  approved: /^(yes|ok|tang|duyet)$|approv|accept|dongy|duyet|grant|tangluong|raise/,
  denied: /^(no|sau|chua)$|deni|denied|reject|tuchoi|khong|hoan|later|chuaduoc|defer/,
  // v5: "Plan A", "phương án A", "PA1", "a" → plan_a …
  plan_a: /^(plana|a|pa_?a|pa1|phuongana|phuongan1|option_?a|1)$/,
  plan_b: /^(planb|b|pa_?b|pa2|phuonganb|phuongan2|option_?b|2)$/,
  plan_c: /^(planc|c|pa_?c|pa3|phuonganc|phuongan3|option_?c|3)$/,
  plan_d: /^(pland|d|pa_?d|pa4|phuongand|phuongan4|option_?d|4)$/,
  inspired: /^(yes|ok)$|inspir|convinc|moved|thuyetphuc|camdong|xuoi|lamlanh|reconcil|dongy/,
  unmoved: /^(no|meh)$|unmov|notconv|khongthuyet|chuathuyet|vancang|khongnghe|bothay/,
};

/**
 * Phủ định (đã bỏ dấu) đứng trong ≤ 3 TỪ ngay trước từ khoá kết quả ("chưa đủ thuyết phục", "không mấy cảm động",
 * "chưa hoàn toàn xuôi", "not really convinced") hoặc dính liền phía trước trong cùng một từ ("uninspired", "khôngxuôi")
 * thì đảo nghĩa. So theo từ nguyên vẹn (không theo đuôi chuỗi đã gộp) để "un"/"ko" nằm trong từ khác không bị tính.
 */
const NEG_WORDS = new Set(['khong', 'chua', 'chang', 'ko', 'k', 'hong', 'hok', 'not', 'no', 'never', 'cannot', 'cant', 'hardly', 'barely', 'nobody', 'noone']);
const NEG_GLUED = /(?:khong|chua|chang|ko|not|un|non)$/;
function negatedAt(tokens: string[], joined: string, idx: number): boolean {
  let start = 0, ti = 0;
  for (; ti < tokens.length; ti++) {
    if (idx < start + tokens[ti].length) break;
    start += tokens[ti].length;
  }
  if (ti >= tokens.length) return false;
  if (NEG_GLUED.test(joined.slice(start, idx))) return true;
  for (let k = Math.max(0, ti - 3); k < ti; k++) if (NEG_WORDS.has(tokens[k])) return true;
  return false;
}

export function normalizeVerdict(type: SceneType, raw: unknown): Verdict | null {
  const rule = VERDICT_BY_TYPE[type];
  if (!rule) return null;
  const v = typeof raw === 'string' ? foldKey(raw) : '';
  if (!v) return rule.fallback;
  for (const val of rule.values) if (v === val || v === foldKey(val)) return val;
  if (rule.values.length === 2) {
    const [good, bad] = rule.values;
    const tokens = words(String(raw));
    const joined = tokens.join('');
    // "xấu" trước để "khongnhan" không bị bắt bởi mẫu "nhan"; "xấu" bị phủ định ("không nghỉ việc nữa") → "tốt"
    const mb = VERDICT_SYNONYMS[bad].exec(joined);
    if (mb) return negatedAt(tokens, joined, mb.index) ? good : bad;
    // "tốt" bị phủ định ("chưa xuôi", "chưa đủ thuyết phục", "not moved", "uninspired", "không ở lại") → "xấu"
    const mg = VERDICT_SYNONYMS[good].exec(joined);
    if (mg) return negatedAt(tokens, joined, mg.index) ? bad : good;
    return rule.fallback;
  }
  for (const val of rule.values) if (VERDICT_SYNONYMS[val].test(v)) return val;
  return rule.fallback;
}

/** Mặc định khi không có AI (offline/cấp cứu) */
export const defaultVerdict = (type: SceneType): Verdict | null => VERDICT_BY_TYPE[type]?.fallback ?? null;

// ---------------------------------------------------------------- v3: lưới an toàn cuối cho cảnh thời sự

/**
 * Câu nào trong news_chat đụng tới chuyện bắt bớ / khởi tố / lừa đảo / ngoại tình (gán tội, đời tư người thật) thì bỏ hẳn,
 * kể cả khi AI "chỉ đùa". Trừ mấy thành ngữ văn phòng vô hại: "bị bắt lười", "bị bắt quả tang", "bị bắt gặp", "bị bắt phải…".
 */
export const NEWS_BLOCK_RE = /bị bắt(?!\s+(?:lười|quả tang|gặp|phải|làm|đi|đứng|ngồi|trực|viết|học|cài|tay|nạt|bẻ|OT))|bắt giữ|tạm giam|khởi tố|truy tố|lừa đảo|ngoại tình|ma túy|giết người|hiếp dâm|tự tử|đánh bạc/iu;
export const isNewsSafe = (text: string): boolean => !NEWS_BLOCK_RE.test(text);

/**
 * Chữ không thuộc hệ Latin (Hán, Hàn, Nhật, Kirin, Thái, Ả Rập…) — model dự phòng đôi lúc trộn "喝完 trà sữa" vào thoại.
 * Mọi chữ hiển thị phải là tiếng Việt có dấu nên câu như vậy bị bỏ (đếm như câu vi phạm; còn < 2 câu → thoại offline).
 */
export const FOREIGN_SCRIPT_RE = /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Cyrillic}|\p{Script=Thai}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}/u;
const ENGLISH_WORDS = /\b(?:the|and|is|are|was|were|you|your|this|that|with|have|has|will|for|not|but|they|their|about|what|just|really|think|know|because|would|should)\b/i;
/** Câu tiếng Anh nguyên câu (≥ 5 chữ, không dấu tiếng Việt, ≥ 2 từ nối tiếng Anh) — teencode "ok", "sorry", "deadline" không tính */
export function looksForeign(text: string): boolean {
  if (FOREIGN_SCRIPT_RE.test(text)) return true;
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 5) return false;
  if (/[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i.test(text)) return false;
  const hits = text.match(new RegExp(ENGLISH_WORDS.source, 'gi'))?.length ?? 0;
  return hits >= 2;
}

/** Tên riêng (chữ viết hoa, không đứng đầu câu) trong tiêu đề / tóm tắt tin — người / đội / hãng được báo nhắc tới */
export function newsProperNames(news: { title?: unknown; summary?: unknown } | undefined): string[] {
  if (!news) return [];
  const out = new Set<string>();
  for (const raw of [news.title, news.summary]) {
    if (typeof raw !== 'string') continue;
    const sentences = raw.normalize('NFC').split(/[.!?:;]\s+|["“”]/u);
    for (const sent of sentences) {
      const words = sent.trim().split(/\s+/);
      words.forEach((w, i) => {
        const t = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        if (i === 0 || t.length < 2 || !/^[\p{Lu}]/u.test(t)) return;
        if (/^(?:Việt|Nam|Anh|Em|Chị|Ông|Bà|Tôi)$/u.test(t)) return; // đại từ / địa danh hay viết hoa trong tiêu đề
        out.add(t.toLowerCase());
      });
    }
  }
  return [...out];
}
/** Lời phán xét / đoán động cơ: "đăng vậy cho engagement", "chắc", "đáng đời", "làm màu", "dở", "ngu"… */
const JUDGEMENT_RE = /(?<![\p{L}])(?:cho engagement|engagement|chắc(?: là)?|đáng(?: đời)?|dở|tệ|ngu|ghét|kém|làm màu|câu view|câu like|sống ảo|giả tạo|diễn sâu|hám fame|hám|tham|lừa|bịp|thằng|mụ|lão|cố tình|cố ý|mục đích|âm mưu|dàn dựng|dựng chuyện|chiêu trò|chiêu bài|bẩn|đểu|khốn|ngớ ngẩn|dở hơi|ảo tưởng|hết thời|flop|cùi|phế|trash|noob|xấu tính|xấu xa|xấu chơi|đáng khinh|đáng ghét|vô dụng|bất tài)(?![\p{L}])/iu;
/**
 * Câu có tên người thật trong tin kèm lời phán xét / đoán động cơ → bỏ (luật tin thật: không đoán "chắc là…", không chê người thật).
 * Chỉ áp cho cảnh có TIN; tên của nhân vật trong truyện không tính.
 */
export function judgesNamedPerson(text: string, names: readonly string[], castNames: ReadonlySet<string>): boolean {
  if (!names.length) return false;
  const low = text.toLowerCase();
  const hit = names.some((n) => !castNames.has(n) && new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(low));
  return hit && JUDGEMENT_RE.test(text);
}

// ---------------------------------------------------------------- tiện ích

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
  return null;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Bỏ dấu, thường hoá, chỉ giữ [a-z0-9_] — dùng so khớp lỏng tên/id. */
export function foldKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

function words(s: string): string[] {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const HONORIFIC = /^(anh|chị|chi|em|sếp|sep|bé|be|ông|ong|bà|ba|cô|co|chú|chu|bạn|ban|dì|di|mr|ms|mrs|miss)\.?\s+/i;

/** Map chuỗi model trả (id, tên, họ tên, "anh Tùng", "Tùng (Senior Dev)"...) → id trong `ids`. */
export function makeIdResolver(ids: string[], agents: Record<string, AgentState | undefined>): (v: unknown) => string | null {
  const exact = new Map<string, string | null>();
  const loose = new Map<string, string | null>();
  const put = (m: Map<string, string | null>, k: string, id: string) => {
    if (!k) return;
    const cur = m.get(k);
    m.set(k, cur === undefined || cur === id ? id : null); // null = nhập nhằng
  };
  for (const id of ids) {
    const a = agents[id];
    const parts = typeof a?.fullName === 'string' ? a.fullName.trim().split(/\s+/) : [];
    const keys = [a?.name, a?.fullName, parts.slice(-1)[0], parts.slice(-2).join(' ')]
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    for (const k of keys) {
      put(exact, k.normalize('NFC').trim().toLowerCase(), id);
      put(loose, foldKey(k), id);
    }
  }
  for (const id of ids) { exact.set(id.toLowerCase(), id); loose.set(foldKey(id), id); } // id luôn thắng

  const lookup = (s: string): string | null | undefined => {
    const e = exact.get(s.toLowerCase());
    return e !== undefined ? e : loose.get(foldKey(s));
  };
  return (v: unknown) => {
    if (typeof v !== 'string') return null;
    let s = v.normalize('NFC').trim()
      .replace(/^[[(@"'“‘]+|[\])"'”’:：]+$/g, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .trim();
    if (!s) return null;
    let r = lookup(s);
    if (r === undefined) {
      const stripped = s.replace(HONORIFIC, '');
      if (stripped !== s) { s = stripped; r = lookup(s); }
    }
    return r ?? null;
  };
}

const QUOTES = '"“”\'‘’«»„「」『』';
const isQuote = (ch: string | undefined) => !!ch && QUOTES.includes(ch);

function stripWrappingQuotes(t: string): string {
  for (let i = 0; i < 2; i++) {
    if (t.length >= 2 && isQuote(t[0]) && isQuote(t[t.length - 1])) {
      const inner = t.slice(1, -1);
      if ([...inner].some(isQuote)) break; // kiểu: "A" là sao, "B" hả → không đụng
      t = inner.trim();
    } else break;
  }
  if (isQuote(t[0]) && ![...t.slice(1)].some(isQuote)) t = t.slice(1).trim();
  if (isQuote(t[t.length - 1]) && ![...t.slice(0, -1)].some(isQuote)) t = t.slice(0, -1).trim();
  return t;
}

// chỉ dẫn sân khấu thường gặp giữa câu: "(cười)", "(nói nhỏ)", "(liếc Tùng)"...
const STAGE_INLINE = /\s*\((?:cười|thở|nói|thì thầm|thầm|nhìn|liếc|gật|lắc|chỉ tay|vỗ|quay|hét|la lên|hạ giọng|giọng|ngáp|đập|gõ|cầm|đưa|nháy|bĩu|nhún|mỉm|khóc|run|lẩm bẩm|im lặng|ngập ngừng|tặc lưỡi|che miệng)[^)]{0,40}\)\s*/giu;

/** Làm sạch lời thoại: 1 dòng, bỏ "Tên:", chỉ dẫn sân khấu, link, ngoặc kép bao ngoài, ≤ 220 ký tự. */
export function cleanSpokenText(raw: unknown, isNamePrefix: (p: string) => boolean, max: number = LIMITS.lineChars): string {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-–—•·]+\s*/, '');
  for (let i = 0; i < 2; i++) {
    const m = t.match(/^([^:：]{1,32})[:：]\s*/);
    if (m && isNamePrefix(m[1])) t = t.slice(m[0].length).trim();
    else break;
  }
  t = t.replace(/\*[^*]{1,80}\*/g, ' ');
  t = t.replace(STAGE_INLINE, ' ');
  t = t.replace(/^\s*[([][^)\]]{1,50}[)\]]\s*/, '');
  t = t.replace(/\s*[([][^)\]]{1,50}[)\]]\s*$/, '');
  t = t.replace(/\bhttps?:\/\/\S+/gi, '').replace(/\bwww\.\S+/gi, '').replace(/\b[\w.-]*shopee\.vn\S*/gi, '');
  t = stripWrappingQuotes(t.replace(/\s+/g, ' ').trim());
  t = t.replace(/\s+([,.!?…])/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length > max ? cut(t, max) : t;
}

/** Chuỗi ngắn (tóm tắt, lý do, ký ức...): 1 dòng, bỏ ngoặc kép bao ngoài, cắt độ dài. */
export function cleanShort(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = stripWrappingQuotes(v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim());
  return t.length > max ? cut(t, max) : t;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Lấy đúng 1 emoji đầu tiên; không có emoji → undefined. */
export function cleanEmote(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t || t.length > 24) return undefined;
  for (const { segment } of GRAPHEMES.segment(t)) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) return segment;
  }
  return undefined;
}

/**
 * v4: con số giá tiền trong câu: "390k", "1,05tr", "5tr7", "1tr2", "2 triệu", "3 trăm nghìn", "150.000đ", "199.000₫", "₫199.000",
 * "199.000", "1.290.000", "1290000". Không bắt "2K"/"4K" (độ phân giải: 1 chữ số + k), "27 inch", "3 tháng", "210Hz",
 * "20.000mAh", "năm 2026" (4 chữ số trần). Cụm đếm (lượt xem, bước, người xem…) gỡ trước bằng NOT_PRICE_RE.
 * Câu nhắc sản phẩm có giá bị bỏ (giá Shopee đổi theo voucher → dễ thành thông tin sai).
 */
export const PRICE_RE = /(?<![\p{L}\p{N}])(?:₫\s?\d+(?:[.,]\d+)*|\d{2,}(?:[.,]\d+)*\s?(?:k|nghìn|ngàn)|\d+\s?trăm(?:\s?(?:k|nghìn|ngàn))?|\d+(?:[.,]\d+)*\s?(?:tr|triệu|củ|đồng|vnđ|vnd|đ|₫)|\d+\s?tr\d{1,3}|\d{1,3}(?:[.,]\d{3}){2,}|\d{2,3}[.,]000|\d{6,})(?![\p{L}\p{N}])/iu;
/**
 * cụm đếm trông giống giá ("20k view", "1tr7 view", "1 triệu lượt xem", "10k bước", "10 người xem", "1 đồng nghiệp", "2 củ khoai")
 * — gỡ ra trước khi dò giá. Từ đếm có biên cuối (không ăn "like new" của "390k like new").
 */
const NOT_PRICE_RE = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:\s?(?:k|nghìn|ngàn|triệu|tr\d{0,3}))?\s*(?:views?|lượt|follows?|followers?|likes?(?!\s*new)|subs?|fans?|shares?|cmts?|comments?|bình\s+luận|tim|lần|bước|km|dpi|người\s+(?:xem|theo\s+dõi))(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])\d+\s?(?:đồng\s+(?:nghiệp|hồ|phục|bộ|ý|loạt|đội)|củ\s+(?:khoai|tỏi|hành|gừng|cải|sắn|sạc|cà\s+rốt))(?![\p{L}\p{N}])/giu;
/** câu có con số giá tiền (đã gỡ các cụm đếm; chuẩn hoá NFC để dấu tổ hợp không lọt) */
export const hasPrice = (t: string): boolean => PRICE_RE.test(String(t ?? '').normalize('NFC').replace(NOT_PRICE_RE, ' '));

/** Điểm "câu này có nhắc sản phẩm không": bigram tên = 2, token thương hiệu (có chữ Latin + số/hoa) = 3. */
export function mentionScore(text: string, productName: string): number {
  const nameW = words(productName);
  if (!nameW.length) return 0;
  const hay = ` ${words(text).join(' ')} `;
  let score = 0;
  for (let i = 0; i + 1 < nameW.length; i++) if (hay.includes(` ${nameW[i]} ${nameW[i + 1]} `)) score += 2;
  const raw = productName.normalize('NFC').split(/\s+/);
  raw.forEach((w, i) => {
    const t = w.replace(/[^\p{L}\p{N}+-]/gu, '');
    if (i === 0 || t.length < 2 || !/^[A-Za-z0-9+-]+$/.test(t) || !/[A-Za-z]/.test(t)) return;
    if (!/\d/.test(t) && !/[A-Z]/.test(t)) return;
    if (hay.includes(` ${t.toLowerCase()} `)) score += 3;
  });
  return score;
}

/** Model lỡ viết id ("[tung]", "cand_junior_4_ab12") vào chữ → đổi thành tên. Không đụng id trần (vd "bao" là từ thường). */
export function idsToNames(text: string, agents: Record<string, AgentState | undefined>): string {
  if (!text) return text;
  return text
    .replace(/\[([a-z0-9_]{2,40})\]/g, (m, id: string) => agents[id]?.name ?? m)
    .replace(/\bcand_[a-z]+_\d+_[a-z0-9]{2,8}\b/g, (m) => agents[m]?.name ?? m);
}

const joinNames = (ns: string[]): string =>
  ns.length <= 1 ? ns[0] ?? 'Mọi người' : `${ns.slice(0, -1).join(', ')} và ${ns[ns.length - 1]}`;

// ---------------------------------------------------------------- tóm tắt dự phòng

export function deriveSummary(req: SceneRequest, ctx: PromptContext, lines?: SceneLine[], verdict?: SceneResult['verdict']): string {
  const ag = ctx.agents ?? {};
  const name = (id?: string) => (id && ag[id]?.name) || '';
  const ps = req.participants ?? [];
  const all = joinNames(ps.map(name).filter(Boolean));
  const staff = ps.find((id) => ag[id] && ag[id].role !== 'boss');
  const employee = ps.find((id) => ag[id] && ag[id].role !== 'boss' && ag[id].role !== 'hr');
  const cand = ps.find((id) => ag[id]?.status === 'candidate');
  const newest = [...ps].filter((id) => ag[id]).sort((a, b) => (ag[b]!.hiredDay ?? 0) - (ag[a]!.hiredDay ?? 0))[0];
  const loc = cut(req.locationLabel || 'văn phòng', 40);
  let s: string;
  switch (req.type) {
    case 'pantry_chat': s = `${all} tám chuyện ở ${loc}`; break;
    case 'desk_visit': s = `${name(ps[0]) || 'Một người'} ghé bàn ${name(ps[1]) || 'đồng nghiệp'}`; break;
    case 'gossip': s = `${all} xì xào sau lưng ${name(req.aboutId) || 'một đồng nghiệp'}`; break;
    case 'group_chat': s = `Nhóm chat kín rôm rả: ${all}`; break;
    case 'company_chat': s = `Nhóm công ty xôn xao: ${all}`; break;
    case 'standup': s = `Họp standup cùng ${all}`; break;
    case 'lunch': s = `${all} ăn trưa cùng nhau`; break;
    case 'boss_catch': s = `Sếp bắt quả tang ${name(staff) || 'một nhân viên'} đang lười`; break;
    case 'boss_call': s = `${name(staff) || 'Một nhân viên'} bị gọi lên phòng sếp`; break;
    case 'hr_warning': s = `${name(employee) || 'Một nhân viên'} bị HR nhắc nhở vì KPI thấp`; break;
    case 'firing': s = `${name(employee) || 'Một nhân viên'} bị cho nghỉ việc`; break;
    case 'interview':
      s = `Phỏng vấn ứng viên ${name(cand) || 'mới'}${verdict === 'hired' ? ' — đậu' : verdict === 'rejected' ? ' — trượt' : ''}`;
      break;
    case 'incident': s = `${all} chữa cháy sự cố`; break;
    case 'celebration': s = `${all} ăn mừng ở ${loc}`; break;
    case 'confront': s = `${name(ps[0]) || 'Một người'} đối chất ${name(ps[1]) || 'người tung tin'} vì tin đồn`; break;
    case 'pingpong_match': s = `${all} so tài bóng bàn`; break;
    case 'welcome': s = `Chào đón người mới ${name(newest)}`.trim(); break;
    case 'showroom_chat': s = `${all} khoe đồ ở phòng trưng bày`; break;
    // --- v3
    case 'news_chat': {
      const src = req.news?.source ? ` trên ${cut(req.news.source, 20)}` : '';
      s = `${all} bàn tin${src}: ${cut(req.news?.title || 'tin thời sự', 70)}`;
      break;
    }
    case 'hr_review': s = `${all} họp kín xét nhân sự`; break;
    case 'resign_talk':
      s = `${name(employee) || 'Một nhân viên'} tâm sự chuyện nghỉ việc với HR${verdict === 'leave' ? ' — quyết định nghỉ' : verdict === 'stay' ? ' — được giữ lại' : ''}`;
      break;
    case 'raise_request':
      s = `${name(employee) || 'Một nhân viên'} xin sếp tăng lương${verdict === 'approved' ? ' — được duyệt' : verdict === 'denied' ? ' — bị từ chối khéo' : ''}`;
      break;
    case 'promotion': s = `Công bố thăng chức/thưởng cho ${name(req.aboutId && ps.includes(req.aboutId) ? req.aboutId : employee) || 'một nhân viên'}`; break;
    case 'layoff': s = `${name(req.aboutId && ps.includes(req.aboutId) ? req.aboutId : employee) || 'Một nhân viên'} bị cắt giảm vì công ty lỗ`; break;
    // --- v5
    case 'crisis_meeting': {
      const opt = req.crisis?.options?.find((o) => o.code === verdict);
      s = `${all} họp xử lý: ${cut(req.crisis?.title || 'tình huống công ty', 50)}${opt ? ` — chốt ${cut(opt.label, 60)}` : ''}`;
      break;
    }
    case 'pep_talk': {
      const v = req.crisis?.variant;
      const head = v === 'mediate' ? 'Ngồi lại hoà giải' : v === 'one' ? 'Nói chuyện riêng' : 'Sếp truyền lửa';
      s = `${head}: ${all}${verdict === 'inspired' ? ' — xuôi rồi' : verdict === 'unmoved' ? ' — chưa xuôi' : ''}`;
      break;
    }
    default: s = `${all} nói chuyện`;
  }
  const first = lines?.[0]?.text;
  if (first) s += `: “${cut(first, 70)}”`;
  return cut(s, LIMITS.summaryChars);
}

// ---------------------------------------------------------------- v3: quyết định nhân sự (hr_review)

const HR_ACTION_SET = new Set<string>(HR_ACTIONS);
/** Model có thể viết "cảnh cáo", "warning", "sa thải"… → HrAction */
const HR_ACTION_ALIASES: [RegExp, HrAction][] = [
  [/^(warn|warning|canhcao|nhacnho|remind)$/, 'warn'],
  [/^(fire|fired|sathai|duoi|duoiviec|chonghi|terminate|dismiss)$/, 'fire'],
  [/^(secondchance|second_chance|chance|themcohoi|cohoi|cohoithu(hai|2))$/, 'second_chance'],
  [/^(probation|thuthach|thuviec|theodoi|watch)$/, 'probation'],
  [/^(praise|khen|khenthuong|recognize|recognition)$/, 'praise'],
  [/^(bonus|thuong|thuongtien|reward)$/, 'bonus'],
  [/^(promote|promotion|thangchuc|lenchuc)$/, 'promote'],
  [/^(openposition|open_position|tuyen|tuyenthem|hire|hiring|recruit)$/, 'open_position'],
  [/^(layoff|catgiam|giambien|downsize)$/, 'layoff'],
  [/^(none|khong|giunguyen|skip|nothing|null|no)$/, 'none'],
];

export function normalizeHrAction(raw: unknown): HrAction | null {
  if (typeof raw !== 'string') return null;
  const k = foldKey(raw);
  if (!k) return null;
  if (HR_ACTION_SET.has(k)) return k as HrAction;
  for (const [re, action] of HR_ACTION_ALIASES) if (re.test(k)) return action;
  return null;
}

/**
 * Lọc hrDecisions của model theo hồ sơ: bỏ id không có trong hồ sơ, action lạ → none, action không nằm trong `allowed`
 * của người đó → none, mỗi id tối đa 1 quyết định, giữ ≤ 6. `open_position` với id rỗng được giữ nếu có ai được phép đề xuất.
 */
export function sanitizeHrDecisions(raw: unknown, req: SceneRequest, agents: Record<string, AgentState | undefined>): HrDecision[] {
  const dossier = (Array.isArray(req.hrDossier) ? req.hrDossier : []).filter((d) => d && typeof d.id === 'string' && d.id);
  if (!dossier.length) return [];
  const allowedOf = new Map<string, Set<string>>();
  for (const d of dossier) allowedOf.set(d.id, new Set((Array.isArray(d.allowed) ? d.allowed : []).filter((x) => typeof x === 'string')));
  const ids = dossier.map((d) => d.id);
  const named: Record<string, AgentState | undefined> = { ...agents };
  for (const d of dossier) {
    // người trong hồ sơ nhưng không có trong ctx.agents (hiếm): vẫn cho map theo tên
    if (!named[d.id] && typeof d.name === 'string') named[d.id] = { id: d.id, name: d.name, fullName: d.name } as AgentState;
  }
  const resolve = makeIdResolver(ids, named);
  const out = new Map<string, HrDecision>();
  const anyOpenPosition = dossier.some((d) => Array.isArray(d.allowed) && d.allowed.includes('open_position'));
  for (const item of asArr(raw)) {
    const o = asObj(item);
    if (!o) continue;
    const actionRaw = normalizeHrAction(o.action ?? o.decision ?? o.type);
    const rawId = o.id ?? o.agentId ?? o.name ?? o.who;
    let id = resolve(rawId);
    if (!id) {
      // open_position chung (id rỗng) — chỉ khi có người được phép đề xuất
      if (actionRaw === 'open_position' && anyOpenPosition && (rawId === '' || rawId === null || rawId === undefined)) id = '';
      else continue;
    }
    if (out.has(id)) continue; // ≤ 1 quyết định mỗi người (giữ mục đầu)
    let action: HrAction = actionRaw ?? 'none';
    if (id === '') {
      if (action !== 'open_position') continue;
    }
    let outside: HrAction | null = null;
    if (id !== '' && action !== 'none' && !allowedOf.get(id)?.has(action)) {
      // ngoài hàng rào → none, nhưng để lại dấu vết trong reason: Director kể lại cho người xem ("sếp đổi ý…") vì thoại đã hứa
      outside = action;
      action = 'none';
    }
    let reason = idsToNames(cleanShort(o.reason ?? o.why ?? o.note, LIMITS.decisionReasonChars), agents)
      || (action === 'none' ? 'Chưa cần làm gì thêm lúc này.' : 'Theo kết luận của buổi họp nhân sự.');
    if (outside) reason = cut(`ngoài hàng rào (${outside}): ${reason}`, LIMITS.decisionReasonChars);
    out.set(id, { id, action, reason });
    if (out.size >= LIMITS.maxDecisions) break;
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- CẢNH

interface DraftLine extends SceneLine { flagged: boolean }

export function sanitizeScene(raw: unknown, req: SceneRequest, ctx: PromptContext): Outcome<SceneResult> {
  const root = asObj(raw);
  if (!root) return fail('Kết quả không phải object JSON');
  const agents = ctx.agents ?? {};
  const participants = (req.participants ?? []).filter((id): id is string => typeof id === 'string' && id !== '');
  const pSet = new Set(participants);
  const allowed = new Set(req.allowedEffects ?? []);
  const resolveSpeaker = makeIdResolver(participants, agents);
  const resolveAny = makeIdResolver(Object.keys(agents), agents);
  const isNamePrefix = (p: string) => resolveAny(p) !== null || resolveSpeaker(p) !== null
    || /^(sếp|giám đốc|hr|chị hr|nhân sự|ứng viên)$/i.test(p.trim());

  // ---- thoại
  const draft: DraftLine[] = [];
  for (const item of asArr(root.lines)) {
    const o = asObj(item);
    if (!o) continue;
    const speaker = resolveSpeaker(o.speaker ?? o.id ?? o.name);
    if (!speaker) continue;
    const text = idsToNames(cleanSpokenText(o.text ?? o.line ?? o.content, isNamePrefix), agents);
    // cần có chữ/số/emoji; riêng nhóm chat cho phép mặt cười kiểu "=)))", ":(("
    if (!text || !(/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text) || (req.channel !== 'office' && /^[=:;]+[)(DPp]+$/.test(text)))) continue;
    const prev = draft[draft.length - 1];
    if (prev && prev.speaker === speaker && prev.text === text) continue;
    const emote = cleanEmote(o.emote);
    draft.push({ speaker, text, ...(emote ? { emote } : {}), flagged: o.product === true || o.product === 'true' });
  }
  // chữ hiển thị phải là tiếng Việt: câu lẫn chữ Hán / Hàn / Kirin… hay nguyên câu tiếng Anh thì bỏ
  let foreignDropped = 0;
  for (let i = draft.length - 1; i >= 0; i--) {
    if (looksForeign(draft[i].text)) { draft.splice(i, 1); foreignDropped++; }
  }
  // v3: cảnh thời sự — lưới an toàn cuối: câu nào gán tội / đời tư người thật, hoặc phán xét / đoán động cơ người có tên trong tin, thì bỏ hẳn
  // (gợi ý "nghe nói …" cũ của Director cũng tính là có tin — dây an toàn thứ hai)
  const newsy = req.type === 'news_chat' || !!req.news || /^nghe nói/i.test(req.topicHint ?? '');
  let newsDropped = 0;
  if (newsy) {
    const names = newsProperNames(req.news);
    const castNames = new Set(Object.values(agents).filter((a): a is AgentState => !!a).map((a) => a.name.toLowerCase()));
    for (let i = draft.length - 1; i >= 0; i--) {
      if (!isNewsSafe(draft[i].text) || judgesNamedPerson(draft[i].text, names, castNames)) { draft.splice(i, 1); newsDropped++; }
    }
  }
  draft.splice(Math.max(2, Math.floor(req.maxLines || 8) + 2));
  if (draft.length < 2) {
    if (newsDropped) return fail(`Chỉ còn ${draft.length} câu sau khi bỏ ${newsDropped} câu vi phạm luật tin thật`);
    if (foreignDropped) return fail(`Chỉ còn ${draft.length} câu sau khi bỏ ${foreignDropped} câu không phải tiếng Việt`);
    return fail(`Chỉ có ${draft.length} câu thoại hợp lệ`);
  }
  if (participants.length >= 2 && new Set(draft.map((l) => l.speaker)).size < 2) return fail('Chỉ có 1 người nói');

  // ---- sản phẩm: tối đa 1 câu, chỉ khi có req.product
  let productIdx = -1;
  if (req.product?.name) {
    const pname = req.product.name;
    const pshort = typeof req.product.short === 'string' ? req.product.short : '';
    // v4: tên đời thường ("chuột gaming không dây") cũng tính — model được dặn gọi theo tên này
    const score = (t: string): number => Math.max(mentionScore(t, pname), pshort ? mentionScore(t, pshort) + 1 : 0);
    // v4: câu nhắc món đồ có con số giá (giá đổi theo voucher → dễ sai) → bỏ câu; còn < 2 câu thì cảnh hỏng (về câu mẫu)
    let priceDropped = 0;
    for (let i = draft.length - 1; i >= 0; i--) {
      const l = draft[i];
      if (hasPrice(l.text) && (l.flagged || score(l.text) >= 2)) { draft.splice(i, 1); priceDropped++; }
    }
    if (priceDropped && (draft.length < 2 || (participants.length >= 2 && new Set(draft.map((l) => l.speaker)).size < 2))) {
      return fail(`Bỏ ${priceDropped} câu nói giá sản phẩm, không còn đủ thoại`);
    }
    const flagged = draft.map((l, i) => (l.flagged ? i : -1)).filter((i) => i >= 0);
    if (flagged.length === 1) productIdx = flagged[0];
    else if (flagged.length > 1) {
      productIdx = flagged.reduce((best, i) => (score(draft[i].text) > score(draft[best].text) ? i : best), flagged[0]);
    } else {
      // model quên đánh dấu nhưng câu nhắc rất rõ tên sản phẩm → đánh dấu hộ (ngưỡng chặt)
      let bestScore = 0;
      draft.forEach((l, i) => {
        const sc = score(l.text);
        if (sc >= 3 && sc > bestScore) { bestScore = sc; productIdx = i; }
      });
    }
  }
  const lines: SceneLine[] = draft.map(({ flagged: _f, ...l }, i) => (i === productIdx ? { ...l, product: true } : l));

  // ---- hiệu ứng (chỉ loại được phép, chỉ id hợp lệ, có kẹp biên)
  const known = (id: string | null): id is string => !!id && !!agents[id];
  const aboutOk = !!req.aboutId && known(req.aboutId);
  const resolveRelTarget = makeIdResolver(aboutOk ? [...participants, req.aboutId!] : participants, agents);

  const relMap = new Map<string, { from: string; to: string; delta: number; reason: string }>();
  if (allowed.has('relationship')) {
    for (const item of asArr(root.relationshipChanges)) {
      const o = asObj(item);
      if (!o) continue;
      const from = resolveSpeaker(o.from);
      const to = resolveRelTarget(o.to);
      const d = toNum(o.delta);
      if (!known(from) || !known(to) || from === to || d === null) continue;
      const key = `${from}>${to}`;
      const prev = relMap.get(key);
      const delta = Math.round(clamp((prev?.delta ?? 0) + d, -LIMITS.relDelta, LIMITS.relDelta));
      const reason = prev?.reason || idsToNames(cleanShort(o.reason, LIMITS.reasonChars), agents) || 'sau một lần nói chuyện';
      relMap.set(key, { from, to, delta, reason });
    }
  }
  const sumById = (key: 'moodChanges' | 'kpiChanges', lim: number) => {
    const m = new Map<string, number>();
    for (const item of asArr(root[key])) {
      const o = asObj(item);
      if (!o) continue;
      const id = resolveSpeaker(o.id);
      const d = toNum(o.delta);
      if (!known(id) || d === null) continue;
      m.set(id, clamp((m.get(id) ?? 0) + d, -lim, lim));
    }
    return [...m].map(([id, delta]) => ({ id, delta: Math.round(delta) })).filter((x) => x.delta !== 0);
  };
  const moodChanges = allowed.has('mood') ? sumById('moodChanges', LIMITS.moodDelta) : [];
  const kpiChanges = allowed.has('kpi') ? sumById('kpiChanges', LIMITS.kpiDelta) : [];

  const memories: { id: string; text: string }[] = [];
  if (allowed.has('memory')) {
    const seen = new Set<string>();
    // cảnh có tin thật: ký ức theo mẫu cố định (tiêu đề + nguồn), không giữ "sự thật" do model viết ra
    const newsMemo = req.news && typeof req.news.title === 'string' && req.news.title.trim()
      ? cut(`Bàn tin "${cut(req.news.title.trim(), 60)}" (${cut(String(req.news.source || 'báo'), 20)})`, LIMITS.memoryChars) : '';
    for (const item of asArr(root.memories)) {
      const o = asObj(item);
      if (!o) continue;
      const id = resolveSpeaker(o.id);
      const text = newsMemo || idsToNames(cleanShort(o.text, LIMITS.memoryChars), agents);
      if (!known(id) || !text || seen.has(id)) continue;
      if (newsy && (!isNewsSafe(text) || looksForeign(text))) continue;
      if (looksForeign(text)) continue;
      seen.add(id);
      memories.push({ id, text });
    }
  }

  // ---- tin đồn
  let rumor: SceneResult['rumor'] = null;
  if (allowed.has('rumor')) {
    const ro = asObj(root.rumor);
    const text = ro ? idsToNames(cleanSpokenText(ro.text, isNamePrefix, LIMITS.rumorChars), agents) : '';
    if (req.rumor) {
      // chủ thể do Director quyết; model quên trả → giữ bản cũ để chuỗi lan truyền không đứt
      const t = text || cleanShort(req.rumor.currentText, LIMITS.rumorChars);
      if (t && req.rumor.aboutId) rumor = { aboutId: req.rumor.aboutId, text: t };
    } else if (ro && text) {
      const pool = Object.keys(agents).filter((id) => !pSet.has(id) && agents[id]?.status !== 'candidate');
      const about = makeIdResolver(pool, agents)(ro.aboutId) ?? (aboutOk && !pSet.has(req.aboutId!) ? req.aboutId! : null);
      if (about) rumor = { aboutId: about, text };
    }
  }

  // ---- kết quả (verdict): interview hired/rejected · resign_talk stay/leave · raise_request approved/denied; cảnh khác null
  let verdict = normalizeVerdict(req.type, root.verdict);
  // v5 crisis_meeting: model trả số thứ tự ("2", "phương án 2", "PA2") → phương án thứ n TRONG DANH SÁCH đã đưa ra
  // (danh sách có thể bỏ qua chữ cái, vd plan_a, plan_c, plan_d — "2" nghĩa là plan_c chứ không phải plan_b)
  if (req.type === 'crisis_meeting' && typeof root.verdict === 'string' && req.crisis?.options?.length) {
    const n = /^(?:pa|phuongan|option|plan)?_?([1-4])$/.exec(foldKey(root.verdict))?.[1];
    if (n) {
      const k = Number(n);
      const opts = req.crisis.options;
      // số trong khoảng → phương án thứ k đã đưa; ngoài khoảng → đọc như chữ cái (4 → plan_d) nếu phương án đó có trong danh sách
      const opt = opts[k - 1] ?? opts.find((o) => o.code === `plan_${'abcd'[k - 1]}`);
      verdict = opt && (VERDICT_BY_TYPE.crisis_meeting?.values ?? []).includes(opt.code as Verdict) ? (opt.code as Verdict) : null;
    }
  }

  // ---- v3: quyết định nhân sự — chỉ hr_review (theo loại cảnh, như verdict)
  const hrDecisions: HrDecision[] | null = req.type === 'hr_review'
    ? sanitizeHrDecisions(root.hrDecisions ?? root.decisions, req, agents)
    : null;

  let summary = idsToNames(cleanShort(root.summary, LIMITS.summaryChars), agents);
  if (summary && ((newsy && !isNewsSafe(summary)) || looksForeign(summary))) summary = '';
  summary ||= deriveSummary(req, ctx, lines, verdict);

  return ok({
    lines,
    summary,
    relationshipChanges: [...relMap.values()].filter((r) => r.delta !== 0),
    moodChanges,
    memories,
    kpiChanges,
    rumor,
    verdict,
    hrDecisions,
    source: 'llm',
  });
}

/** Cảnh cấp cứu khi cả GPT lẫn offline.ts đều hỏng (gần như không bao giờ dùng). */
export function emergencyScene(req: SceneRequest, ctx: PromptContext): SceneResult {
  const ps = (req.participants ?? []).filter(Boolean);
  const lines: SceneLine[] = [];
  if (ps[0]) lines.push({ speaker: ps[0], text: 'Ủa, nãy mình đang nói tới đâu rồi ta?' });
  if (ps[1]) lines.push({ speaker: ps[1], text: 'Thôi để lát nói tiếp, giờ làm cho xong việc cái đã.' });
  const verdict = defaultVerdict(req.type);
  return {
    lines,
    summary: deriveSummary(req, ctx, undefined, verdict),
    relationshipChanges: [], moodChanges: [], memories: [], kpiChanges: [],
    rumor: null,
    verdict,
    hrDecisions: req.type === 'hr_review' ? [] : null,
    source: 'offline',
  };
}

// ---------------------------------------------------------------- v3: kế hoạch "biến" của AI biên kịch

/**
 * Kiểm tra kế hoạch beats: kind phải có trong menu (so khớp lỏng), a/b map về id nhân sự (hoặc bỏ), intensity 1..3,
 * note tiếng Việt ≤ 140 ký tự (thiếu thì lấy mô tả menu); bỏ biến trùng; giữ ≤ 3. Không có biến hợp lệ → thất bại (brain dùng offline).
 */
export function sanitizeBeats(raw: unknown, req: BeatRequest, ctx: PromptContext): Outcome<BeatPlan> {
  const root = asObj(raw);
  if (!root) return fail('Kế hoạch biến không phải object JSON');
  const menu = (Array.isArray(req.menu) ? req.menu : []).filter((m) => m && typeof m.kind === 'string' && m.kind);
  if (!menu.length) return fail('Menu biến rỗng');
  const kindByKey = new Map<string, string>();
  for (const m of menu) kindByKey.set(foldKey(m.kind), m.kind);
  const descOf = new Map(menu.map((m) => [m.kind, typeof m.desc === 'string' ? m.desc : '']));
  const roster = (Array.isArray(req.roster) && req.roster.length ? req.roster : ctx.roster ?? []).filter((r) => r && typeof r.id === 'string' && r.id);
  const agents = ctx.agents ?? {};
  const named: Record<string, AgentState | undefined> = {};
  for (const r of roster) named[r.id] = agents[r.id] ?? ({ id: r.id, name: r.name, fullName: r.name } as AgentState);
  const resolve = makeIdResolver(roster.map((r) => r.id), named);
  const items = asArr(root.beats ?? root.plan ?? root.items);
  const beats: Beat[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const o = asObj(item);
    if (!o) continue;
    const kind = typeof o.kind === 'string' ? kindByKey.get(foldKey(o.kind)) : undefined;
    if (!kind) continue;
    const a = resolve(o.a ?? o.who ?? o.agent) ?? undefined;
    let b = resolve(o.b ?? o.with ?? o.target) ?? undefined;
    if (b && b === a) b = undefined;
    const iRaw = toNum(o.intensity ?? o.level);
    const intensity = iRaw === null ? 2 : Math.round(clamp(iRaw, 1, 3));
    // AI bỏ trống note → mô tả thực đơn, điền tên vào chỗ trống "a" / "b" (người xem không thấy "a và b bỗng thân nhau…").
    // Note hiện ra dòng sự kiện → có giá tiền (giá Shopee đổi liên tục, không bao giờ đọc số) thì cũng dùng mô tả thực đơn.
    const aiNote = idsToNames(cleanShort(o.note ?? o.desc ?? o.text, LIMITS.beatNoteChars), agents);
    const note = (aiNote && !hasPrice(aiNote) ? aiNote : '')
      || cut(fillBeatDesc(descOf.get(kind) || kind, a ? named[a]?.name : undefined, b ? named[b]?.name : undefined), LIMITS.beatNoteChars);
    const key = `${kind}|${a ?? ''}|${b ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    beats.push({ kind, ...(a ? { a } : {}), ...(b ? { b } : {}), intensity, note });
    if (beats.length >= LIMITS.maxBeats) break;
  }
  if (!beats.length) return fail('Không có biến nào hợp lệ (kind không thuộc menu)');
  return ok({ beats, source: 'llm' });
}

/** Kế hoạch cấp cứu: không biến nào (Director coi như vài giờ yên ả). */
export const emergencyBeats = (): BeatPlan => ({ beats: [], source: 'offline' });

// ---------------------------------------------------------------- ỨNG VIÊN

export interface LookPoolLike {
  skin: string[];
  hair: string[];
  shirt: string[];
  pants: string[];
  hairStyles: Record<Gender, Look['hairStyle'][]>;
  accessories: Look['accessory'][];
}

export interface CandidateDeps {
  lookPool?: LookPoolLike | null;
  /** chọn món đồ affiliate đặt trên bàn theo vai trò */
  pickDeskItem?: (role: RoleKey) => string | undefined;
  rng?: () => number;
}

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isCssHex = (v: unknown): v is string => typeof v === 'string' && COLOR_RE.test(v.trim());

const nameKey = (s: string) => s.normalize('NFC').trim().toLowerCase();

function cleanPersonName(v: unknown, maxWords: number): string {
  if (typeof v !== 'string') return '';
  const t = v.normalize('NFC').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 48) return '';
  const ws = t.split(' ');
  if (ws.length > maxWords) return '';
  return ws.map((w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi')).join(' ');
}

function normGender(v: unknown): Gender | null {
  if (typeof v !== 'string') return null;
  const k = foldKey(v);
  if (['nu', 'female', 'f', 'woman', 'girl'].includes(k)) return 'nữ';
  if (['nam', 'male', 'm', 'man', 'boy'].includes(k)) return 'nam';
  return null;
}

function cleanList(v: unknown, maxItems: number, maxChars: number): string[] {
  const out: string[] = [];
  for (const x of asArr(v)) {
    const t = cleanShort(x, maxChars);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function pickFrom<T>(arr: readonly T[] | undefined | null, rng: () => number, fallback: T): T {
  return arr && arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : fallback;
}

function buildLook(raw: unknown, gender: Gender, deps: CandidateDeps, rng: () => number): Look {
  const lo = asObj(raw) ?? {};
  const pool = deps.lookPool ?? null;
  const color = (v: unknown, arr: string[] | undefined, fb: string) =>
    isCssHex(v) ? v.trim().toLowerCase() : pickFrom((arr ?? []).filter(isCssHex), rng, fb);
  const hs = typeof lo.hairStyle === 'string' && (HAIR_STYLES as string[]).includes(lo.hairStyle)
    ? (lo.hairStyle as Look['hairStyle'])
    : pickFrom((pool?.hairStyles?.[gender] ?? []).filter((h) => HAIR_STYLES.includes(h)), rng, gender === 'nữ' ? 'long' : 'short');
  const acc = typeof lo.accessory === 'string' && (ACCESSORIES as string[]).includes(lo.accessory)
    ? (lo.accessory as Look['accessory'])
    : pickFrom((pool?.accessories ?? []).filter((a) => ACCESSORIES.includes(a)), rng, 'none');
  return {
    skin: color(lo.skin, pool?.skin, '#f1c27d'),
    hair: color(lo.hair, pool?.hair, '#1b1b1b'),
    hairStyle: hs,
    shirt: color(lo.shirt, pool?.shirt, '#4f86f7'),
    pants: color(lo.pants, pool?.pants, '#2d3748'),
    accessory: acc,
  };
}

const TRAIT_KEYS: (keyof Traits)[] = ['diligence', 'laziness', 'gossip', 'temper', 'humor', 'ambition'];

function buildTraits(raw: unknown): Traits {
  const t = asObj(raw) ?? {};
  const vals = TRAIT_KEYS.map((k) => toNum(t[k]));
  // model lỡ dùng thang 0..10 hoặc 0..100 cho phần lớn chỉ số → quy đổi; lẻ tẻ vượt 1 thì chỉ kẹp
  const big = vals.filter((v): v is number => v !== null && v > 1);
  const scale = big.length >= 3 ? (Math.max(...big) <= 10 ? 10 : 100) : 1;
  const out = {} as Traits;
  TRAIT_KEYS.forEach((k, i) => {
    const v = vals[i];
    out[k] = v === null ? 0.5 : Math.round(clamp(v / scale, 0, 1) * 100) / 100;
  });
  return out;
}

function usedNameSet(req: CandidateRequest, ctx: PromptContext): Set<string> {
  const used = new Set<string>();
  for (const n of req.usedNames ?? []) if (typeof n === 'string' && n.trim()) used.add(nameKey(n));
  for (const a of Object.values(ctx.agents ?? {})) if (a && typeof a.name === 'string') used.add(nameKey(a.name));
  return used;
}

function candidateId(req: CandidateRequest, ctx: PromptContext, rng: () => number): string {
  const day = Number.isFinite(ctx.day) ? Math.floor(ctx.day) : 0;
  const rand = Math.floor(rng() * 36 ** 4).toString(36).padStart(4, '0').slice(-4);
  return `cand_${req.role}_${day}_${rand}`;
}

export function sanitizeCandidate(raw: unknown, req: CandidateRequest, ctx: PromptContext, deps: CandidateDeps = {}): Outcome<Persona> {
  const o = asObj(raw);
  if (!o) return fail('Hồ sơ ứng viên không phải object JSON');
  const rng = deps.rng ?? Math.random;
  const used = usedNameSet(req, ctx);

  const fullName = cleanPersonName(o.fullName, 5);
  if (!fullName || fullName.split(' ').length < 2) return fail('Thiếu họ tên đầy đủ hợp lệ');
  const parts = fullName.split(' ');
  let name = cleanPersonName(o.name, 2) || parts[parts.length - 1];
  if (used.has(nameKey(name))) {
    const alt = parts.slice(-2).join(' ');
    if (alt === name || used.has(nameKey(alt))) return fail(`Tên "${name}" bị trùng`);
    name = alt; // vd "Tú" trùng → gọi "Minh Tú"
  }

  const gender = normGender(o.gender) ?? (rng() < 0.5 ? 'nam' : 'nữ');
  const [lo, hi] = ROLE_AGE[req.role] ?? [21, 40];
  const ageRaw = toNum(o.age);
  const age = Math.round(clamp(ageRaw ?? (lo + hi) / 2, Math.max(18, lo - 2), hi + 6));
  const bio = cleanShort(o.bio, 240);
  if (!bio) return fail('Thiếu bio');
  const speechStyle = cleanShort(o.speechStyle, 200) || 'Lễ phép, hơi rụt rè, xưng "em" với người lớn hơn.';

  let deskItemProductId: string | undefined;
  try { deskItemProductId = deps.pickDeskItem?.(req.role) || undefined; } catch { deskItemProductId = undefined; }

  return ok({
    id: candidateId(req, ctx, rng),
    name,
    fullName,
    role: req.role,
    roleLabel: req.roleLabel,
    gender,
    age,
    bio,
    speechStyle,
    quirks: cleanList(o.quirks, 4, 60),
    likes: cleanList(o.likes, 4, 60),
    dislikes: cleanList(o.dislikes, 4, 60),
    traits: buildTraits(o.traits),
    look: buildLook(o.look, gender, deps, rng),
    deskId: req.deskId,
    ...(deskItemProductId ? { deskItemProductId } : {}),
    kpiTarget: req.kpiTarget,
  });
}

const EMERGENCY_NAMES: Record<Gender, [string, string][]> = {
  nam: [['Nguyễn Minh Khang', 'Khang'], ['Trần Quốc Huy', 'Huy'], ['Lê Hoàng Nam', 'Nam'], ['Đỗ Gia Phúc', 'Phúc']],
  nữ: [['Phạm Ngọc Hân', 'Hân'], ['Võ Thu Hà', 'Hà'], ['Đặng Bảo Anh', 'Bảo Anh'], ['Bùi Khánh Linh', 'Khánh Linh']],
};

/** Ứng viên cấp cứu khi cả GPT lẫn offline.ts đều hỏng. */
export function emergencyCandidate(req: CandidateRequest, ctx: PromptContext, deps: CandidateDeps = {}): Persona {
  const rng = deps.rng ?? Math.random;
  const used = usedNameSet(req, ctx);
  const gender: Gender = rng() < 0.5 ? 'nam' : 'nữ';
  const pool = [...EMERGENCY_NAMES[gender], ...EMERGENCY_NAMES[gender === 'nam' ? 'nữ' : 'nam']];
  const found = pool.find(([, n]) => !used.has(nameKey(n))) ?? pool[0];
  const g: Gender = EMERGENCY_NAMES.nam.includes(found) ? 'nam' : 'nữ';
  const [lo, hi] = ROLE_AGE[req.role] ?? [22, 30];
  let deskItemProductId: string | undefined;
  try { deskItemProductId = deps.pickDeskItem?.(req.role) || undefined; } catch { deskItemProductId = undefined; }
  return {
    id: candidateId(req, ctx, rng),
    name: found[1],
    fullName: found[0],
    role: req.role,
    roleLabel: req.roleLabel,
    gender: g,
    age: Math.round((lo + hi) / 2),
    bio: 'Ứng viên chăm chỉ, hơi run khi phỏng vấn nhưng rất muốn có việc ổn định.',
    speechStyle: 'Lễ phép, nói hơi nhanh khi hồi hộp, xưng "em".',
    quirks: ['hay gãi đầu khi bối rối'],
    likes: ['cà phê sữa đá'],
    dislikes: ['họp kéo dài'],
    traits: { diligence: 0.6, laziness: 0.35, gossip: 0.4, temper: 0.3, humor: 0.5, ambition: 0.55 },
    look: buildLook(null, g, deps, rng),
    deskId: req.deskId,
    ...(deskItemProductId ? { deskItemProductId } : {}),
    kpiTarget: req.kpiTarget,
  };
}

// ---------------------------------------------------------------- BẢN TIN

function deriveMvp(req: RecapRequest, ctx: PromptContext): DayRecap['mvp'] {
  const ag = ctx.agents ?? {};
  const pool = (req.kpi ?? []).filter((k) => k && typeof k.id === 'string' && Number.isFinite(k.ratio)
    && ag[k.id]?.role !== 'boss' && ag[k.id]?.role !== 'hr');
  if (!pool.length) return null;
  const top = pool.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return { id: top.id, name: ag[top.id]?.name ?? top.name, reason: `Cán mốc ${Math.round(top.ratio * 100)}% KPI — cao nhất văn phòng hôm nay` };
}

export function sanitizeRecap(raw: unknown, req: RecapRequest, ctx: PromptContext): Outcome<DayRecap> {
  const o = asObj(raw);
  if (!o) return fail('Bản tin không phải object JSON');
  const ag = ctx.agents ?? {};
  const headline = cleanShort(o.headline, 120);
  if (!headline) return fail('Bản tin thiếu tít');
  const bullets: string[] = [];
  for (const b of asArr(o.bullets)) {
    const t = cleanShort(b, 180);
    if (t && !bullets.includes(t)) bullets.push(t);
    if (bullets.length >= 5) break;
  }
  if (bullets.length < 2) return fail('Bản tin quá ít ý');
  for (const e of req.events ?? []) {
    if (bullets.length >= 3) break;
    const t = cleanShort(e, 140);
    if (t && !bullets.includes(t)) bullets.push(t);
  }

  // mvp: id hoặc tên, phải là người có thật; không chọn Giám đốc
  const kpiIds = (req.kpi ?? []).map((k) => k?.id).filter((x): x is string => typeof x === 'string');
  const ids = [...new Set([...kpiIds, ...Object.keys(ag)])];
  let mvp: DayRecap['mvp'] = null;
  const mo = asObj(o.mvp);
  if (mo) {
    const id = makeIdResolver(ids, ag)(mo.id ?? mo.name);
    if (id && ag[id]?.role !== 'boss') {
      const name = ag[id]?.name ?? req.kpi.find((k) => k.id === id)?.name ?? id;
      mvp = { id, name, reason: cleanShort(mo.reason, 120) || 'Nổi bật nhất văn phòng hôm nay' };
    }
  }
  if (!mvp) mvp = deriveMvp(req, ctx);

  return ok({
    day: req.day,
    weekday: req.weekday,
    headline,
    bullets,
    mvp,
    drama: cleanShort(o.drama, 240) || 'Một ngày hiếm hoi văn phòng không có drama nào đáng kể.',
    kpi: req.kpi ?? [],
    source: 'llm',
  });
}

/** Bản tin cấp cứu khi cả GPT lẫn offline.ts đều hỏng. */
export function emergencyRecap(req: RecapRequest, ctx: PromptContext): DayRecap {
  const bullets = (req.events ?? []).filter((e) => typeof e === 'string' && e.trim()).slice(-4).map((e) => cut(e, 140));
  return {
    day: req.day,
    weekday: req.weekday,
    headline: `Bản tin ngày ${req.day}: một ngày làm việc ở ${ctx.companyName}`,
    bullets: bullets.length ? bullets : ['Văn phòng làm việc bình thường, không có biến lớn.'],
    mvp: deriveMvp(req, ctx),
    drama: 'Chưa ghi nhận drama nổi bật.',
    kpi: req.kpi ?? [],
    source: 'offline',
  };
}
