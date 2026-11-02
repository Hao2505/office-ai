// =====================================================================
//  Router nhiều nhà cung cấp AI (Gemini → Groq → ... → offline do brain lo).
//  Mỗi provider = 1 client (llm.ts). Router lo CHÍNH SÁCH:
//  - pick(): provider đầu tiên "sẵn sàng" (có key, không nghỉ, dưới RPM/RPD/TPD);
//    tier 'strong' được ưu tiên cho việc quan trọng (high / bản tin / ứng viên).
//  - complete(): thử lần lượt các provider NGAY TRONG 1 request khi còn thời gian
//    (tối đa 3 lượt gọi HTTP, không vượt hạn chót của brain).
//  - Lỗi → nghỉ (cooldown) riêng từng provider: 429 theo Retry-After / gợi ý trong
//    message, không có thì lùi dần 30 s→15 phút; hết quota NGÀY không có gợi ý: Gemini
//    nghỉ tới 0h giờ Pacific (mốc reset của Google), provider khác dò lại sau 1 giờ;
//    401/403/404 → tắt 1 giờ; 5xx/mạng/timeout → 20 s rồi lùi dần (timeout trong cửa
//    sổ bị cắt ngắn vì hạn chót thì không phạt); 400 vì json_schema → nhớ json_object;
//    429 "Request too large … Limit L, Requested R" (Groq OTPM/TPM) → KHÔNG nghỉ, hạ trần
//    max_completion_tokens của provider đó (nhớ 7 ngày) và thử lại ngay trong cùng request.
//  - Đếm request/token/chi phí theo ngày của từng provider (Gemini theo ngày Pacific,
//    còn lại giờ VN), lưu/khôi phục được.
//  Đồng hồ `now` tiêm được (test chạy nhanh); hạn chót HTTP dùng giờ thật.
// =====================================================================
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { inferProviderName, type Config, type ProviderConfig } from '../config.js';
import type { Priority, ProviderStats } from '../types.js';
import {
  createProviderClient, dateKeyIn, describeError, localDateKey, localTimeLabel, nextMidnightIn, outputBudget, safeJson,
  LlmError, PACIFIC_TZ, VN_TZ,
  type AttemptLimits, type JsonFormat, type LlmCallUsage, type LlmRequest, type LlmResponse, type LlmTask, type ProviderClient,
} from './llm.js';
import { estimateTokens } from './prompt-budget.js';

// ---------------------------------------------------------------- hằng số chính sách
export const ROUTER_POLICY = {
  providerTimeoutMs: 20_000,        // 1 lượt gọi HTTP tối đa
  minAttemptMs: 2_500,              // còn ít hơn tới hạn chót → không mở lượt gọi mới
  minAttemptReasoningMs: 6_000,     // model suy luận (gpt-oss...) cần cửa sổ rộng hơn mới đáng mở lượt gọi
  maxAttempts: 3,                   // số lượt gọi HTTP tối đa trong 1 request
  defaultDeadlineMs: 25_000,        // khi request không ghi deadlineAt
  rateBackoffBaseMs: 30_000,        // 429 không có Retry-After: 30 s, 60 s, 120 s...
  serverBackoffBaseMs: 20_000,      // 5xx / mạng / timeout: 20 s, 40 s, 80 s...
  backoffMaxMs: 15 * 60_000,
  retryAfterMaxMs: 6 * 3_600_000,   // Retry-After vớ vẩn quá lớn → kẹp; cũng là nhịp dò tối đa khi chờ 0h Pacific
  dailyProbeMs: 60 * 60_000,        // hết quota ngày, không biết giờ reset, không có gợi ý → dò lại sau 1 giờ
  dailyHintTrustMs: 10 * 60_000,    // Gemini kèm "retry in 27s" cả khi hết quota NGÀY → gợi ý < 10 phút không đáng tin
  authDisableMs: 60 * 60_000,       // 401/403/404: tắt 1 giờ
  jsonObjectRememberMs: 24 * 3_600_000,
  cooldownRestoreMaxMs: 36 * 3_600_000, // khôi phục từ file: cooldown xa hơn mức này coi là rác
  outputCapRememberMs: 7 * 86_400_000, // "Request too large" (Groq OTPM/TPM): nhớ trần max_completion_tokens của provider 7 ngày
  outputCapMargin: 0.9,             // trần = 90% Limit máy chủ báo (Requested là ước lượng của máy chủ)
  minOutputTokens: 256,             // dưới mức này không đủ chỗ cho JSON cảnh → bỏ provider cho request này
  maxCapRetries: 2,                 // mỗi request hạ trần rồi thử lại tối đa 2 lần trên cùng provider
  // Giữ nhịp quota ngày (ProviderConfig.pace): được dùng tối đa (phần ngày quota đã trôi × limit) + phần "bung" đầu ngày
  paceBurst: 0.25,                  // bung = 25% limit…
  paceMinBurstReq: 30,              // …nhưng không dưới 30 lượt
  paceMinBurstTok: 30_000,          // …/ 30k token
  paceRecheckMs: 60_000,            // provider đang giữ nhịp: xem lại sau ≥ 1 phút
} as const;

/** Múi giờ reset quota ngày đã biết. Gemini (Google AI Studio): 0h giờ Pacific = 14h (PDT) / 15h (PST) giờ VN. */
export const QUOTA_RESET_TZ: Record<string, string> = { gemini: PACIFIC_TZ };

/** Múi giờ tính "ngày" cho RPD/TPD của provider: theo mốc reset đã biết, còn lại giờ VN (xấp xỉ). */
export function quotaResetTz(cfg: Pick<ProviderConfig, 'name' | 'baseUrl'>): string {
  return QUOTA_RESET_TZ[cfg.name] ?? QUOTA_RESET_TZ[inferProviderName(cfg.baseUrl)] ?? VN_TZ;
}
/** Provider có giờ reset quota ngày được tài liệu hoá (Gemini) */
export const hasKnownQuotaReset = (cfg: Pick<ProviderConfig, 'name' | 'baseUrl'>): boolean =>
  quotaResetTz(cfg) !== VN_TZ;

// ---------------------------------------------------------------- phân loại lỗi (export để test)
export type ErrKind =
  | 'rate' | 'auth' | 'forbidden' | 'notfound' | 'bad_request' | 'server' | 'network' | 'timeout' | 'aborted'
  | 'content' | 'other';

/** 429 "Request too large": request này vượt trần token/phút của model (không phải hết lượt) */
export interface TooLarge {
  limit: number;            // "Limit 1000" (0 = không đọc được)
  requested: number;        // "Requested 1436" (0 = không đọc được)
  output: boolean;          // trần token RA (OTPM / "reduce max_tokens") hay tổng token (TPM / "reduce your message size")
}

export interface ClassifiedError {
  kind: ErrKind;
  status?: number;
  retryAfterMs?: number;    // từ header Retry-After / retry-after-ms hoặc gợi ý trong message
  daily: boolean;           // 429 vì quota NGÀY (RPD/TPD/"quota exceeded")
  text: string;
  tooLarge?: TooLarge;      // 429 vì request quá lớn so với trần token/phút → hạ max_completion_tokens, không nghỉ
}

const TOO_LARGE_RE = /request too large|reduce (?:your message size|max_tokens)|expected output tokens exceed/i;
const LIMIT_REQUESTED_RE = /limit:?\s*([\d,]+)\s*,?\s*(?:used:?\s*[\d,]+\s*,?\s*)?requested:?\s*([\d,]+)/i;
const OUTPUT_LIMIT_RE = /output tokens|\bOTPM\b|max_tokens|expected output|completion tokens/i;

/**
 * Groq: "Request too large for model `x` … on output tokens per minute (OTPM): Limit 1000, Requested 1436. … reduce max_tokens …"
 * hoặc "… on tokens per minute (TPM): Limit 6000, Requested 6373, please reduce your message size …". "Rate limit reached … Used 30"
 * (hết lượt tạm thời) → null.
 */
export function parseTooLarge(text: string): TooLarge | null {
  if (!TOO_LARGE_RE.test(text)) return null;
  const m = LIMIT_REQUESTED_RE.exec(text);
  const num = (s: string | undefined): number => {
    const n = parseInt((s ?? '').replace(/,/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return { limit: num(m?.[1]), requested: num(m?.[2]), output: OUTPUT_LIMIT_RE.test(text) };
}

const DAILY_RE = /per[\s_-]?day|daily|\bRPD\b|\bTPD\b|PerDay|requests_per_day|tokens_per_day|limit for the day|hết lượt/i;
const MINUTE_RE = /per[\s_-]?minute|PerMinute|\bRPM\b|\bTPM\b|requests_per_minute|tokens_per_minute|per[\s_-]?second|\bRPS\b/i;
const QUOTA_RE = /quota exceeded|exceeded your current quota|resource_exhausted|insufficient_quota|billing|out of credits|credit balance|quota/i;
// "API key not valid", "Please pass a valid API key" (Gemini), "invalid API key", reason API_KEY_INVALID...
const KEY_INVALID_RE = /valid api key|incorrect api key|invalid_api_key|api_key_invalid|invalid authentication|unauthorized|invalid x-api-key|no auth credentials/i;
const UNIT_RE = /(\d+(?:\.\d+)?)\s*(ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;

/** "14m22.5s", "32s", "1h 2m", "20 seconds", "500ms" → ms */
export function parseDurationMs(s: string): number | undefined {
  let total = 0;
  let found = false;
  UNIT_RE.lastIndex = 0;
  for (let m = UNIT_RE.exec(s); m; m = UNIT_RE.exec(s)) {
    found = true;
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    total += u === 'ms' ? v : u.startsWith('h') ? v * 3_600_000 : u.startsWith('m') ? v * 60_000 : v * 1000;
  }
  return found && Number.isFinite(total) ? total : undefined;
}

/** Gợi ý thời gian chờ trong message lỗi: "Please retry in 32.5s", "try again in 14m22s", retryDelay: "27s" */
export function messageRetryAfterMs(text: string): number | undefined {
  const m = /(?:retry(?:ing)?|try again|retry[_-]?delay|wait)[^0-9]{0,24}(\d[\d.]*\s*(?:ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])(?:\s*\d[\d.]*\s*(?:ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z]))*)/i.exec(text);
  return m ? parseDurationMs(m[1]) : undefined;
}

function headerRetryAfterMs(e: APIError, realNow: number): number | undefined {
  const h = e.headers as Headers | undefined;
  if (!h || typeof h.get !== 'function') return undefined;
  const ms = h.get('retry-after-ms');
  if (ms !== null && ms !== undefined && Number.isFinite(parseFloat(ms))) return Math.max(0, parseFloat(ms));
  const ra = h.get('retry-after');
  if (!ra) return undefined;
  if (/^\s*\d+(\.\d+)?\s*$/.test(ra)) return Math.max(0, parseFloat(ra) * 1000);
  const at = Date.parse(ra);
  return Number.isFinite(at) ? Math.max(0, at - realNow) : undefined;
}

/**
 * 429 có phải vì quota NGÀY? Chữ "per day / daily / RPD / TPD" → có (trừ khi cùng lúc nói "per minute").
 * "quota exceeded" chung chung (Gemini) → có, trừ khi server gợi ý chờ ngắn (< 10 phút) → coi là tạm thời.
 */
export function isDailyQuota(text: string, hintMs?: number): boolean {
  const daily = DAILY_RE.test(text);
  const minute = MINUTE_RE.test(text);
  if (daily && !minute) return true;
  if (minute) return false;
  if (QUOTA_RE.test(text)) return hintMs === undefined || hintMs >= 10 * 60_000;
  return false;
}

export function classifyError(e: unknown, realNow: number = Date.now()): ClassifiedError {
  if (e instanceof LlmError) {
    const kind: ErrKind = e.code === 'aborted' ? 'aborted' : e.code === 'timeout' ? 'timeout' : 'content';
    return { kind, daily: false, text: e.message };
  }
  if (e instanceof APIUserAbortError) return { kind: 'aborted', daily: false, text: e.message };
  if (e instanceof APIConnectionTimeoutError) return { kind: 'timeout', daily: false, text: e.message };
  if (e instanceof APIConnectionError) return { kind: 'network', daily: false, text: e.message };
  if (e instanceof APIError) {
    const status = typeof e.status === 'number' ? e.status : 0;
    const text = `${e.message} ${safeJson(e.error)}`;
    if (status === 429) {
      const retryAfterMs = headerRetryAfterMs(e, realNow) ?? messageRetryAfterMs(text);
      const tooLarge = parseTooLarge(text);
      if (tooLarge) return { kind: 'rate', status, retryAfterMs, daily: false, text, tooLarge };
      return { kind: 'rate', status, retryAfterMs, daily: isDailyQuota(text, retryAfterMs), text };
    }
    if (status === 401) return { kind: 'auth', status, daily: false, text };
    if (status === 403) return { kind: 'forbidden', status, daily: false, text };
    if (status === 404) return { kind: 'notfound', status, daily: false, text };
    if (status === 400 || status === 422) {
      return { kind: KEY_INVALID_RE.test(text) ? 'auth' : 'bad_request', status, daily: false, text };
    }
    if (status >= 500) return { kind: 'server', status, daily: false, text };
    return { kind: 'other', status, daily: false, text };
  }
  if (e instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(e.message)) {
    return { kind: 'network', daily: false, text: e.message };
  }
  return { kind: 'other', daily: false, text: e instanceof Error ? e.message : String(e) };
}

// ---------------------------------------------------------------- kiểu dữ liệu router

export interface RouterLogger { info(msg: string): void; warn(msg: string): void }
export interface RouterOptions {
  /** đồng hồ chính sách (cooldown, RPM, ngày) — mặc định Date.now; test truyền đồng hồ ảo */
  now?: () => number;
  log?: Partial<RouterLogger>;
  /** không in dòng giới thiệu provider lúc khởi động (test) */
  quiet?: boolean;
  /** cửa sổ tối đa cho 1 lượt gọi HTTP (mặc định ROUTER_POLICY.providerTimeoutMs; test rút ngắn) */
  providerTimeoutMs?: number;
  /** nguồn ngẫu nhiên cho AI_ROUTING=balanced (test truyền hàm cố định) — mặc định Math.random */
  rand?: () => number;
}

export interface RouterTotals {
  calls: number; failures: number; inputTokens: number; cachedTokens: number; outputTokens: number;
  costTodayUsd: number; costTotalUsd: number;
}
export interface RouterStats extends RouterTotals {
  providers: ProviderStats[];
  activeProvider?: string;    // label
  activeModel: string;
  anyAvailable: boolean;
}

export interface Router {
  /** có ít nhất 1 provider có key */
  readonly enabled: boolean;
  /** key của mọi provider — để che trong log/lỗi */
  readonly keys: readonly string[];
  readonly providers: readonly ProviderConfig[];
  inflight(): number;
  costToday(): number;
  anyAvailable(): boolean;
  pick(task: LlmTask, priority: Priority): ProviderConfig | null;
  /** Throw LlmError / lỗi SDK khi mọi provider đều thất bại. Không tự fallback offline — brain lo. */
  complete(req: LlmRequest): Promise<LlmResponse>;
  stats(): RouterStats;
  serialize(): RouterSnapshot;
  restore(data: unknown): void;
}

interface Carry extends RouterTotals { date: string }

export interface ProviderSnapshot {
  calls: number; failures: number; inputTokens: number; cachedTokens: number; outputTokens: number;
  costTodayUsd: number; costTotalUsd: number; rpdUsed: number; tpdUsed: number;
  /** ngày (theo múi giờ reset của provider) mà rpdUsed/tpdUsed/costTodayUsd thuộc về */
  day?: string;
  cooldownUntil: number; cooldownReason: string; jsonObjectUntil: number;
  backoffRate: number; backoffServer: number; lastError?: string;
  /** trần max_completion_tokens học từ "Request too large" (0 = không) và hạn nhớ */
  maxOutputTokens?: number; maxOutputUntil?: number;
}
export interface RouterSnapshot {
  v: 2;
  date: string;
  carry: Carry;
  providers: Record<string, ProviderSnapshot>;
}

interface Runtime {
  cfg: ProviderConfig;
  client: ProviderClient | null;
  day: string;
  rpmTimes: number[];
  rpdUsed: number;
  tpdUsed: number;
  calls: number;
  failures: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costToday: number;
  costTotal: number;
  cooldownUntil: number;
  cooldownReason: string;
  backoffRate: number;      // số lần 429 liên tiếp (nhân đôi thời gian nghỉ)
  backoffServer: number;    // số lần 5xx/mạng/timeout liên tiếp
  jsonObjectUntil: number;  // > now ⇒ dùng json_object
  maxOutputTokens: number;  // trần max_completion_tokens học từ "Request too large" (0 = không trần)
  maxOutputUntil: number;   // hạn nhớ trần đó
  lastError?: string;
  lastOkAt: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNeg = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const nonNegInt = (v: unknown): number | undefined => {
  const n = nonNeg(v);
  return n === undefined ? undefined : Math.round(n);
};
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} giây`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} phút`;
  const h = Math.round(m / 6) / 10;
  return `${h} giờ`;
}

const defaultLabel = (name: string): string => {
  const known: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini', groq: 'Groq' };
  return known[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * Danh sách provider thực sự dùng. Công tắc tương thích cũ: `openaiKey` rỗng = TẮT AI
 * (scripts/smoke.ts đặt { ...CONFIG, openaiKey: '' } để chạy offline, không ra mạng).
 * Config dựng tay không có `providers` → 1 provider từ các trường OPENAI_* cũ.
 */
export function resolveProviders(config: Config): ProviderConfig[] {
  if (!config.openaiKey) return [];
  if (Array.isArray(config.providers)) {
    const list = config.providers.filter((p): p is ProviderConfig =>
      isObj(p) && typeof p.apiKey === 'string' && p.apiKey !== '' && typeof p.model === 'string' && p.model !== '');
    if (list.length) return list;
  }
  const name = inferProviderName(config.openaiBaseUrl);
  return [{
    name, label: defaultLabel(name), baseUrl: config.openaiBaseUrl, apiKey: config.openaiKey, model: config.model,
    price: config.price, reasoningEffort: config.reasoningEffort ?? '', isReasoningModel: !!config.isReasoningModel,
    tier: 'normal', json: 'schema', pace: true, weight: 1,
  }];
}

// ---------------------------------------------------------------- factory

export function createRouter(config: Config, opts: RouterOptions = {}): Router {
  const now: () => number = typeof opts.now === 'function' ? opts.now : Date.now;
  const log: RouterLogger = {
    info: opts.log?.info ?? ((m) => console.log(m)),
    warn: opts.log?.warn ?? ((m) => console.warn(m)),
  };
  const P = ROUTER_POLICY;
  const providerTimeoutMs = typeof opts.providerTimeoutMs === 'number' && opts.providerTimeoutMs >= 1_000
    ? opts.providerTimeoutMs : P.providerTimeoutMs;
  const providers = resolveProviders(config);
  const keys = providers.map((p) => p.apiKey);
  const warn = (m: string) => log.warn(`[ai] ${describeError(m, keys)}`);

  /** "ngày" của provider (Gemini: ngày Pacific; còn lại: ngày VN) */
  const dayKey = (cfg: ProviderConfig, t: number): string => dateKeyIn(quotaResetTz(cfg), new Date(t));
  /** 0h kế tiếp theo múi giờ reset của provider */
  const nextReset = (cfg: ProviderConfig, t: number): number => nextMidnightIn(quotaResetTz(cfg), t);

  const runtimes: Runtime[] = providers.map((cfg) => ({
    cfg,
    client: createProviderClient(cfg, providerTimeoutMs),
    day: dayKey(cfg, now()),
    rpmTimes: [],
    rpdUsed: 0, tpdUsed: 0,
    calls: 0, failures: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0,
    costToday: 0, costTotal: 0,
    cooldownUntil: 0, cooldownReason: '',
    backoffRate: 0, backoffServer: 0,
    jsonObjectUntil: cfg.json === 'object' ? Number.POSITIVE_INFINITY : 0,
    maxOutputTokens: 0, maxOutputUntil: 0,
    lastOkAt: 0,
  }));
  const byName = new Map(runtimes.map((r) => [r.cfg.name, r]));
  let carry: Carry = { date: localDateKey(new Date(now())), calls: 0, failures: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costTodayUsd: 0, costTotalUsd: 0 };
  let lastOk: Runtime | null = null;

  for (const r of runtimes) {
    if (!r.client) warn(`${r.cfg.label}: không khởi tạo được client (BASE_URL/key không hợp lệ?) → bỏ qua`);
  }
  if (!opts.quiet && (runtimes.length || config.providerNotes?.length)) {
    const lines = runtimes.map((r, i) => {
      const lim = [
        r.cfg.rpm ? `${r.cfg.rpm} lượt/phút` : '',
        r.cfg.rpd ? `${r.cfg.rpd} lượt/ngày` : '',
        r.cfg.tpd ? `${r.cfg.tpd.toLocaleString('vi-VN')} token/ngày` : '',
      ].filter(Boolean).join(', ');
      const price = r.cfg.price.input === 0 && r.cfg.price.output === 0 ? 'miễn phí' : `$${r.cfg.price.input}/$${r.cfg.price.output} mỗi 1M token`;
      const extra = [
        r.cfg.tier === 'strong' ? 'ưu tiên việc quan trọng' : '',
        r.cfg.json === 'object' ? 'json_object' : '',
        r.cfg.pace && (r.cfg.rpd !== undefined || r.cfg.tpd !== undefined) ? 'giữ nhịp quota ngày' : '',
        r.cfg.maxOutputTokens ? `≤ ${r.cfg.maxOutputTokens} token ra` : '',
        r.cfg.maxRequestTokens ? `≤ ${r.cfg.maxRequestTokens} token/request` : '',
        config.aiRouting === 'balanced' && r.cfg.weight !== 1 ? `trọng số ${r.cfg.weight}` : '',
        hasKnownQuotaReset(r.cfg) ? `quota ngày reset 0h Pacific (${localTimeLabel(new Date(nextReset(r.cfg, now())))} giờ VN)` : '',
      ].filter(Boolean);
      return `[ai]   ${i + 1}. ${r.cfg.label} — ${r.cfg.model}${lim ? ` · ${lim}` : ''} · ${price}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
    });
    log.info(config.aiRouting === 'balanced'
      ? `[ai] Nhà cung cấp AI (cảnh thường xen kẽ, nghiêng về bên còn nhiều quota ngày)${runtimes.length ? '' : ': (không có)'}`
      : `[ai] Nhà cung cấp AI theo thứ tự ưu tiên${runtimes.length ? '' : ': (không có)'}`);
    for (const l of lines) log.info(l);
    for (const n of config.providerNotes ?? []) log.info(`[ai]   ⚠️  bỏ qua: ${n}`);
    if (runtimes.length > 1) log.info('[ai]   → provider đầu hết lượt / lỗi thì tự chuyển sang provider sau; hết cả thì dùng câu thoại mẫu.');
  }

  // ---- ngày (theo múi giờ reset của từng provider; carry/ngân sách theo giờ VN)
  function rollDay(r: Runtime, t: number): void {
    const key = dayKey(r.cfg, t);
    if (r.day !== key) {
      r.day = key;
      r.rpdUsed = 0;
      r.tpdUsed = 0;
      r.costToday = 0;
      r.rpmTimes = [];
    }
  }
  function rollCarry(t: number): void {
    const key = localDateKey(new Date(t));
    if (carry.date !== key) { carry.date = key; carry.costTodayUsd = 0; }
  }
  function pruneRpm(r: Runtime, t: number): void {
    if (r.rpmTimes.length && r.rpmTimes[0] <= t - 60_000) r.rpmTimes = r.rpmTimes.filter((x) => x > t - 60_000);
  }

  /** Vì sao provider chưa gọi được lúc này (null = sẵn sàng) */
  function blocked(r: Runtime, t: number): { reason: string; until: number } | null {
    if (!r.client) return { reason: 'không khởi tạo được client', until: 0 };
    rollDay(r, t);
    if (t < r.cooldownUntil) return { reason: r.cooldownReason || 'đang nghỉ', until: r.cooldownUntil };
    if (r.cfg.rpd !== undefined && r.rpdUsed >= r.cfg.rpd) {
      return { reason: `hết lượt gọi hôm nay (${r.rpdUsed}/${r.cfg.rpd} RPD)`, until: nextReset(r.cfg, t) };
    }
    if (r.cfg.tpd !== undefined && r.tpdUsed >= r.cfg.tpd) {
      return { reason: `hết token hôm nay (${r.tpdUsed.toLocaleString('vi-VN')}/${r.cfg.tpd.toLocaleString('vi-VN')} TPD)`, until: nextReset(r.cfg, t) };
    }
    if (r.cfg.rpm !== undefined) {
      pruneRpm(r, t);
      if (r.rpmTimes.length >= r.cfg.rpm) return { reason: `đủ ${r.cfg.rpm} lượt/phút, chờ nhịp`, until: r.rpmTimes[0] + 60_000 };
    }
    if (r.cfg.pace) {
      const p = paceBlock(r, t);
      if (p) return p;
    }
    return null;
  }
  const available = (r: Runtime, t: number): boolean => blocked(r, t) === null;

  /**
   * Giữ nhịp quota NGÀY: trước đây Gemini (500 lượt/ngày) bị xài sạch trong vài giờ đầu rồi phải chờ tới 0h Pacific.
   * Cho dùng tối đa: phần "bung" đầu ngày (25% limit, tối thiểu 30 lượt / 30k token) + limit × (phần ngày quota đã trôi).
   * Vượt mức đó → tạm coi như đang nghỉ, mở lại dần theo giờ (provider khác / câu mẫu gánh trong lúc đó).
   */
  function paceBlock(r: Runtime, t: number): { reason: string; until: number } | null {
    const end = nextReset(r.cfg, t);
    const start = end - 86_400_000;
    const frac = clamp((t - start) / (end - start), 0, 1);
    const over = (used: number, limit: number, minBurst: number, what: string): { reason: string; until: number } | null => {
      const burst = Math.max(minBurst, limit * P.paceBurst);
      const allowance = Math.min(limit, burst + limit * frac);
      if (used < allowance) return null;
      // thời điểm mức cho phép vượt qua used (+1): start + (used + 1 − burst) / limit × 24h
      const until = Math.min(end, start + ((used + 1 - burst) / limit) * (end - start));
      return { reason: `giữ nhịp cho đủ cả ngày (đã dùng ${what}), mở lại dần`, until: Math.max(until, t + P.paceRecheckMs) };
    };
    if (r.cfg.rpd !== undefined) {
      const b = over(r.rpdUsed, r.cfg.rpd, P.paceMinBurstReq, `${r.rpdUsed}/${r.cfg.rpd} lượt`);
      if (b) return b;
    }
    if (r.cfg.tpd !== undefined) {
      const b = over(r.tpdUsed, r.cfg.tpd, P.paceMinBurstTok, `${r.tpdUsed.toLocaleString('vi-VN')}/${r.cfg.tpd.toLocaleString('vi-VN')} token`);
      if (b) return b;
    }
    return null;
  }

  // ---- AI_ROUTING=balanced: xen kẽ provider, nghiêng về bên còn nhiều quota ngày
  const rand: () => number = typeof opts.rand === 'function' ? opts.rand : Math.random;
  /** phần quota ngày còn lại (0..1); không khai báo RPD/TPD = 1 */
  function headroom(r: Runtime): number {
    let h = 1;
    if (r.cfg.rpd !== undefined && r.cfg.rpd > 0) h = Math.min(h, 1 - r.rpdUsed / r.cfg.rpd);
    if (r.cfg.tpd !== undefined && r.cfg.tpd > 0) h = Math.min(h, 1 - r.tpdUsed / r.cfg.tpd);
    return Math.max(0, h);
  }
  /** xáo theo trọng số = quota còn lại × AI_<NAME>_WEIGHT × ngẫu nhiên: bên còn nhiều hay được chọn hơn nhưng không độc chiếm; hoà thì theo thứ tự cấu hình */
  function balancedOrder(list: Runtime[]): Runtime[] {
    return list
      .map((r, i) => ({ r, i, s: (headroom(r) + 0.05) * r.cfg.weight * (0.5 + rand()) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r);
  }

  /** Thứ tự thử: tier 'strong' trước cho việc quan trọng (cảnh high, ứng viên, bản tin); còn lại theo cấu hình hoặc xen kẽ (balanced) */
  function order(task: LlmTask, priority: Priority): Runtime[] {
    const strongFirst = priority === 'high' || (task !== 'scene' && task !== 'beats');
    const base = config.aiRouting === 'balanced' ? balancedOrder(runtimes) : runtimes;
    if (!strongFirst || !runtimes.some((r) => r.cfg.tier === 'strong')) return base;
    return [...base.filter((r) => r.cfg.tier === 'strong'), ...base.filter((r) => r.cfg.tier !== 'strong')];
  }

  /** Request có vừa trần token/request của provider không (Groq free: TPM 8000 → prompt lớn gửi là lỗi chắc) */
  function fits(r: Runtime, req: LlmRequest, cap?: number): { ok: true } | { ok: false; est: number } {
    const max = r.cfg.maxRequestTokens;
    if (max === undefined || max <= 0) return { ok: true };
    const est = estimateTokens(req.system) + estimateTokens(req.user) + outputBudget(req, r.cfg, cap);
    return est <= max ? { ok: true } : { ok: false, est };
  }

  const formatFor = (r: Runtime, t: number): JsonFormat => (t < r.jsonObjectUntil ? 'json_object' : 'json_schema');

  // ---- hàng đợi đồng thời (chung cho mọi provider)
  const maxConc = Math.max(1, Math.floor(config.maxConcurrentLlm) || 1);
  let running = 0;
  const waiters: Array<() => void> = [];

  function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new LlmError('aborted', 'Đã huỷ trước khi gửi'));
    if (running < maxConc) { running++; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        running++;
        resolve();
      };
      const onAbort = () => {
        const i = waiters.indexOf(grant);
        if (i >= 0) waiters.splice(i, 1);
        reject(new LlmError('aborted', 'Quá thời gian khi đang xếp hàng chờ gọi AI'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.push(grant);
    });
  }
  function release(): void {
    running = Math.max(0, running - 1);
    const next = waiters.shift();
    if (next) next();
  }

  // ---- ghi nhận
  function recordAttempt(r: Runtime, t: number): void {
    rollDay(r, t);
    r.calls++;
    r.rpdUsed++;
    r.rpmTimes.push(t);
  }
  function account(r: Runtime, u: LlmCallUsage, t: number): void {
    rollDay(r, t);
    r.inputTokens += u.promptTokens;
    r.cachedTokens += u.cachedTokens;
    r.outputTokens += u.completionTokens;
    r.tpdUsed += u.promptTokens + u.completionTokens;
    if (u.costUsd > 0) { r.costToday += u.costUsd; r.costTotal += u.costUsd; }
  }
  function cool(r: Runtime, ms: number, reason: string, t: number): void {
    const until = t + Math.max(1_000, Math.round(ms));
    if (until > r.cooldownUntil) r.cooldownUntil = until;
    r.cooldownReason = reason;
    warn(`${r.cfg.label} (${r.cfg.model}): ${reason} → tạm nghỉ ${fmtDuration(r.cooldownUntil - t)} (tới ${localTimeLabel(new Date(r.cooldownUntil))})`);
  }
  const envName = (r: Runtime) => `AI_${r.cfg.name.toUpperCase()}`;

  /** Áp "hình phạt" theo loại lỗi (SPEC 6.2) */
  function penalize(r: Runtime, c: ClassifiedError, t: number): void {
    switch (c.kind) {
      case 'rate': {
        if (c.tooLarge) return; // request quá lớn, không phải hết lượt → complete() đã hạ trần token ra, không nghỉ
        const hint = c.retryAfterMs;
        if (c.daily) {
          // Gemini biết giờ reset (0h Pacific) nhưng vẫn kèm "retry in 27s" khi hết quota ngày → gợi ý ngắn không đáng tin
          const reset = hasKnownQuotaReset(r.cfg) ? nextReset(r.cfg, t) : 0;
          if (hint !== undefined && !(reset && hint < P.dailyHintTrustMs)) {
            // Groq: "tokens per day ... try again in 1m2s" + Retry-After chính xác → tin máy chủ
            cool(r, clamp(hint, 1_000, P.retryAfterMaxMs), 'hết quota ngày (429), chờ theo thời gian máy chủ báo', t);
          } else if (reset) {
            cool(r, Math.min(reset - t, P.retryAfterMaxMs),
              `hết quota ngày (429) — ${r.cfg.label} reset lúc 0h giờ Pacific (${localTimeLabel(new Date(reset))} giờ VN)`, t);
          } else {
            cool(r, P.dailyProbeMs, 'hết quota ngày (429) — dò lại sau 1 giờ', t);
          }
        } else if (hint !== undefined) {
          r.backoffRate++;
          cool(r, clamp(hint, 1_000, P.retryAfterMaxMs), 'bị giới hạn tốc độ (429), chờ theo Retry-After', t);
        } else {
          const ms = Math.min(P.rateBackoffBaseMs * 2 ** r.backoffRate, P.backoffMaxMs);
          r.backoffRate++;
          cool(r, ms, 'bị giới hạn tốc độ (429)', t);
        }
        return;
      }
      case 'auth':
        cool(r, P.authDisableMs, `API key sai hoặc hết hạn (${c.status ?? 401}) — kiểm tra ${envName(r)}_API_KEY trong .env`, t);
        return;
      case 'forbidden':
        cool(r, P.authDisableMs, `không có quyền dùng model/tài khoản (403) — kiểm tra key hoặc ${envName(r)}_MODEL`, t);
        return;
      case 'notfound':
        cool(r, P.authDisableMs, `không tìm thấy model "${r.cfg.model}" (404) — kiểm tra ${envName(r)}_MODEL / ${envName(r)}_BASE_URL`, t);
        return;
      case 'server': case 'network': case 'timeout': case 'bad_request': case 'other': {
        const label = c.kind === 'server' ? `máy chủ lỗi (${c.status ?? '5xx'})`
          : c.kind === 'network' ? 'không kết nối được'
          : c.kind === 'timeout' ? 'quá thời gian chờ'
          : c.kind === 'bad_request' ? `request bị từ chối (${c.status ?? 400})` : 'lỗi không rõ';
        const ms = Math.min(P.serverBackoffBaseMs * 2 ** r.backoffServer, P.backoffMaxMs);
        r.backoffServer++;
        cool(r, ms, label, t);
        return;
      }
      case 'content': case 'aborted':
        return; // không phải lỗi hạ tầng của provider
      default:
        return;
    }
  }
  function onSuccess(r: Runtime, t: number): void {
    r.backoffRate = 0;
    r.backoffServer = 0;
    r.lastOkAt = t;
    lastOk = r;
  }
  /** Trần max_completion_tokens mới sau "Request too large" (so với ngân sách `used` vừa gửi); luôn nhỏ hơn `used` */
  function shrinkOutputCap(used: number, tl: TooLarge): number {
    let cap: number;
    if (tl.limit > 0 && tl.output) cap = tl.limit * P.outputCapMargin;                       // OTPM: Requested = ước lượng token ra
    else if (tl.limit > 0 && tl.requested > tl.limit) cap = used - (tl.requested - tl.limit) - tl.limit * (1 - P.outputCapMargin); // TPM: bớt phần vượt + lề
    else cap = used / 2;
    if (cap >= used) cap = used * 0.75;
    return Math.max(0, Math.floor(cap));
  }
  const short = (e: unknown): string => {
    const s = describeError(e, keys);
    return s.length > 110 ? s.slice(0, 109) + '…' : s;
  };

  function unavailableSummary(t: number): string {
    if (!runtimes.length) return 'chưa cấu hình API key';
    return runtimes.map((r) => {
      const b = blocked(r, t);
      return `${r.cfg.label}: ${b ? `${b.reason}${b.until ? ` (tới ${localTimeLabel(new Date(b.until))})` : ''}` : 'sẵn sàng'}`;
    }).join('; ');
  }

  // ---- gọi
  async function complete(req: LlmRequest): Promise<LlmResponse> {
    if (runtimes.length === 0) throw new LlmError('disabled', 'Chưa cấu hình API key cho nhà cung cấp AI nào');
    if (req.signal?.aborted) throw new LlmError('aborted', 'Đã huỷ trước khi gửi');
    await acquire(req.signal);
    try {
      const priority: Priority = req.priority ?? 'normal';
      const deadlineAt = typeof req.deadlineAt === 'number' && Number.isFinite(req.deadlineAt)
        ? req.deadlineAt : Date.now() + P.defaultDeadlineMs;
      const tried = new Set<Runtime>();
      const capRetries = new Map<Runtime, number>(); // số lần đã hạ trần token ra rồi thử lại (mỗi provider)
      const notes: string[] = [];
      let attempts = 0;
      let outOfTime = false;
      while (attempts < P.maxAttempts) {
        if (req.signal?.aborted) throw new LlmError('aborted', 'Đã huỷ request (quá thời gian chờ)');
        const t = now();
        const r = order(req.task, priority).find((x) => !tried.has(x) && available(x, t));
        if (!r || !r.client) break;
        const remaining = deadlineAt - Date.now();
        const minAttempt = r.cfg.isReasoningModel ? P.minAttemptReasoningMs : P.minAttemptMs;
        if (remaining < minAttempt) {
          outOfTime = true;
          notes.push(`hết thời gian trước khi thử ${r.cfg.label}`);
          tried.add(r);
          continue; // provider khác (model nhẹ hơn) có thể vẫn kịp
        }
        const format = formatFor(r, t);
        // cửa sổ cho lượt này; bị cắt ngắn bởi hạn chót của brain thì timeout không phải lỗi của provider
        const perCall = Math.min(providerTimeoutMs, remaining - 300);
        const truncated = perCall < providerTimeoutMs;
        // trần token ra: học từ máy chủ ("Request too large", còn hạn nhớ) và/hoặc trần cố định AI_<NAME>_MAX_OUTPUT_TOKENS
        const learned = r.maxOutputTokens > 0 && t < r.maxOutputUntil ? r.maxOutputTokens : 0;
        const fixed = r.cfg.maxOutputTokens ?? 0;
        const cap = learned > 0 && fixed > 0 ? Math.min(learned, fixed) : learned || fixed;
        const limits: AttemptLimits | undefined = cap > 0 ? { maxOutputTokens: cap } : undefined;
        // request quá lớn so với trần token/request của provider → không gửi (chắc chắn lỗi), sang provider khác
        const fit = fits(r, req, limits?.maxOutputTokens);
        if (!fit.ok) {
          notes.push(`${r.cfg.label}: request ~${fit.est} token vượt trần ${r.cfg.maxRequestTokens} token/request, không gửi`);
          tried.add(r);
          continue;
        }
        attempts++;
        recordAttempt(r, t);
        try {
          const res = await r.client.attempt(req, format, perCall, limits);
          account(r, res.usage, now());
          onSuccess(r, now());
          return { ...res, provider: r.cfg.name, attempts };
        } catch (e) {
          const t2 = now();
          if (e instanceof LlmError && e.usage) account(r, e.usage, t2);
          let c = classifyError(e);
          let shown: unknown = e;
          r.failures++;
          if (c.kind === 'aborted') throw e; // brain hết hạn → dừng hẳn, không phạt provider
          if (c.kind === 'rate' && c.tooLarge) {
            // Groq: "Request too large … (OTPM): Limit 1000, Requested 1436" — request vượt trần token/phút của model (không phải hết
            // lượt) → không nghỉ; hạ max_completion_tokens cho provider này (nhớ 7 ngày) và thử lại ngay nếu còn đủ chỗ cho JSON
            r.lastError = `[${localTimeLabel(new Date(t2))}] ${short(e)}`;
            const used = outputBudget(req, r.cfg, limits?.maxOutputTokens);
            const cap = shrinkOutputCap(used, c.tooLarge);
            const n = capRetries.get(r) ?? 0;
            if (cap >= P.minOutputTokens && cap < used && n < P.maxCapRetries) {
              capRetries.set(r, n + 1);
              r.maxOutputTokens = cap;
              r.maxOutputUntil = t2 + P.outputCapRememberMs;
              const kind = c.tooLarge.output ? 'token ra mỗi phút (OTPM' : 'token mỗi phút (TPM';
              warn(`${r.cfg.label} (${r.cfg.model}): máy chủ giới hạn ${kind}${c.tooLarge.limit ? ` ${c.tooLarge.limit}` : ''}) → từ nay max_completion_tokens ≤ ${cap} cho provider này, thử lại ngay`);
              continue; // cùng provider, cùng định dạng, trần mới
            }
            notes.push(`${r.cfg.label}: ${short(e)} (request quá lớn so với trần token/phút, không phạt)`);
            tried.add(r);
            continue;
          }
          if (c.kind === 'bad_request') {
            const adapt = r.client.adaptTo400(e, format);
            if (adapt === 'retry') {
              r.lastError = `[${localTimeLabel(new Date(t2))}] ${short(e)}`;
              warn(`${r.cfg.label}: model/proxy không nhận một tham số tuỳ chọn → bỏ tham số đó và thử lại`);
              continue; // cùng provider, cùng định dạng
            }
            if (adapt === 'json_object') {
              r.lastError = `[${localTimeLabel(new Date(t2))}] ${short(e)}`;
              r.jsonObjectUntil = t2 + P.jsonObjectRememberMs;
              warn(`${r.cfg.label} (${r.cfg.model}): không nhận json_schema → dùng json_object (nhớ 24 giờ)`);
              continue; // cùng provider, định dạng json_object
            }
            if (adapt === 'content') {
              // model viết JSON lệch schema (Groq json_validate_failed): lỗi của 1 lần sinh → không phạt provider
              shown = new LlmError('parse', 'Model trả JSON không khớp schema (json_validate_failed)');
              c = { ...c, kind: 'content' };
            }
          }
          r.lastError = `[${localTimeLabel(new Date(t2))}] ${short(shown)}`;
          if (c.kind === 'timeout' && truncated) {
            // chỉ còn vài giây vì hạn chót của brain → không phạt, không lùi dần
            notes.push(`${r.cfg.label}: ${short(shown)} (cửa sổ chỉ còn ${Math.round(perCall / 1000)} s, không phạt)`);
          } else {
            penalize(r, c, t2);
            notes.push(`${r.cfg.label}: ${short(shown)}`);
          }
          tried.add(r);
        }
      }
      if (attempts === 0) {
        if (outOfTime) throw new LlmError('timeout', `Hết thời gian trước khi gọi AI (${notes.join('; ')})`);
        throw new LlmError('unavailable', `Không có nhà cung cấp AI nào sẵn sàng — ${unavailableSummary(now())}`);
      }
      throw new LlmError('exhausted', notes.join(' · ') || 'Mọi nhà cung cấp AI đều lỗi');
    } finally {
      release();
    }
  }

  // ---- thống kê
  function totals(t: number): RouterTotals {
    rollCarry(t);
    const sum: RouterTotals = {
      calls: carry.calls, failures: carry.failures, inputTokens: carry.inputTokens, cachedTokens: carry.cachedTokens,
      outputTokens: carry.outputTokens, costTodayUsd: carry.costTodayUsd, costTotalUsd: carry.costTotalUsd,
    };
    for (const r of runtimes) {
      rollDay(r, t);
      sum.calls += r.calls; sum.failures += r.failures; sum.inputTokens += r.inputTokens; sum.cachedTokens += r.cachedTokens;
      sum.outputTokens += r.outputTokens; sum.costTodayUsd += r.costToday; sum.costTotalUsd += r.costTotal;
    }
    return sum;
  }

  function stats(): RouterStats {
    const t = now();
    const list: ProviderStats[] = runtimes.map((r) => {
      const b = blocked(r, t);
      return {
        name: r.cfg.name, label: r.cfg.label, model: r.cfg.model, enabled: b === null,
        calls: r.calls, failures: r.failures, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        costTodayUsd: round6(r.costToday),
        rpdUsed: r.rpdUsed, ...(r.cfg.rpd !== undefined ? { rpdLimit: r.cfg.rpd } : {}),
        tpdUsed: r.tpdUsed, ...(r.cfg.tpd !== undefined ? { tpdLimit: r.cfg.tpd } : {}),
        cooldownUntil: b ? b.until : 0,
        ...(b ? { cooldownReason: b.reason } : {}),
        format: formatFor(r, t),
        ...(r.lastError ? { lastError: r.lastError } : {}),
      };
    });
    const firstAvail = runtimes.find((r) => available(r, t));
    const active = lastOk && available(lastOk, t) ? lastOk : firstAvail ?? lastOk ?? runtimes[0];
    const sum = totals(t);
    return {
      ...sum,
      costTodayUsd: round6(sum.costTodayUsd),
      costTotalUsd: round6(sum.costTotalUsd),
      providers: list,
      ...(active ? { activeProvider: active.cfg.label } : {}),
      activeModel: active?.cfg.model ?? config.model ?? '',
      anyAvailable: firstAvail !== undefined,
    };
  }

  // ---- lưu / khôi phục
  function serialize(): RouterSnapshot {
    const t = now();
    rollCarry(t);
    const out: Record<string, ProviderSnapshot> = {};
    for (const r of runtimes) {
      rollDay(r, t);
      out[r.cfg.name] = {
        calls: r.calls, failures: r.failures, inputTokens: r.inputTokens, cachedTokens: r.cachedTokens, outputTokens: r.outputTokens,
        costTodayUsd: r.costToday, costTotalUsd: r.costTotal, rpdUsed: r.rpdUsed, tpdUsed: r.tpdUsed, day: r.day,
        cooldownUntil: r.cooldownUntil > t ? r.cooldownUntil : 0,
        cooldownReason: r.cooldownUntil > t ? r.cooldownReason : '',
        jsonObjectUntil: Number.isFinite(r.jsonObjectUntil) && r.jsonObjectUntil > t ? r.jsonObjectUntil : 0,
        backoffRate: r.backoffRate, backoffServer: r.backoffServer,
        ...(r.lastError ? { lastError: r.lastError } : {}),
        ...(r.maxOutputTokens > 0 && r.maxOutputUntil > t ? { maxOutputTokens: r.maxOutputTokens, maxOutputUntil: r.maxOutputUntil } : {}),
      };
    }
    return { v: 2, date: localDateKey(new Date(t)), carry: { ...carry }, providers: out };
  }

  /** Gộp số liệu (bản cũ v1 hoặc provider đã bị gỡ khỏi cấu hình) vào "carry" để tổng không tụt */
  function foldIntoCarry(d: Record<string, unknown>, sameDay: boolean, replace: boolean): void {
    const pick = (k: string, cur: number) => {
      const v = nonNeg(d[k]);
      return v === undefined ? (replace ? cur : cur) : replace ? v : cur + v;
    };
    carry = {
      date: localDateKey(new Date(now())),
      calls: Math.round(pick('calls', carry.calls)),
      failures: Math.round(pick('failures', carry.failures)),
      inputTokens: Math.round(pick('inputTokens', carry.inputTokens)),
      cachedTokens: Math.round(pick('cachedTokens', carry.cachedTokens)),
      outputTokens: Math.round(pick('outputTokens', carry.outputTokens)),
      costTotalUsd: pick('costTotalUsd', carry.costTotalUsd),
      costTodayUsd: sameDay ? pick('costTodayUsd', carry.costTodayUsd) : (replace ? 0 : carry.costTodayUsd),
    };
    if (carry.costTotalUsd < carry.costTodayUsd) carry.costTotalUsd = carry.costTodayUsd;
  }

  function restore(data: unknown): void {
    if (!isObj(data)) return;
    const t = now();
    const today = localDateKey(new Date(t));
    const sameDay = data.date === today;
    if (isObj(data.providers)) {
      if (isObj(data.carry)) foldIntoCarry(data.carry, sameDay, true);
      for (const [name, raw] of Object.entries(data.providers)) {
        if (!isObj(raw)) continue;
        const r = byName.get(name);
        if (!r) { foldIntoCarry(raw, sameDay, false); continue; }
        r.calls = nonNegInt(raw.calls) ?? r.calls;
        r.failures = nonNegInt(raw.failures) ?? r.failures;
        r.inputTokens = nonNegInt(raw.inputTokens) ?? r.inputTokens;
        r.cachedTokens = nonNegInt(raw.cachedTokens) ?? r.cachedTokens;
        r.outputTokens = nonNegInt(raw.outputTokens) ?? r.outputTokens;
        r.costTotal = nonNeg(raw.costTotalUsd) ?? r.costTotal;
        r.day = dayKey(r.cfg, t);
        // bản mới ghi "ngày" riêng của provider (Gemini theo ngày Pacific); bản cũ chỉ có ngày VN chung
        const providerSameDay = typeof raw.day === 'string' ? raw.day === r.day : sameDay;
        if (providerSameDay) {
          r.rpdUsed = nonNegInt(raw.rpdUsed) ?? 0;
          r.tpdUsed = nonNegInt(raw.tpdUsed) ?? 0;
          r.costToday = nonNeg(raw.costTodayUsd) ?? 0;
          if (r.costTotal < r.costToday) r.costTotal = r.costToday;
        } else {
          r.rpdUsed = 0; r.tpdUsed = 0; r.costToday = 0;
        }
        const cu = nonNeg(raw.cooldownUntil) ?? 0;
        if (cu > t && cu - t <= P.cooldownRestoreMaxMs) {
          r.cooldownUntil = cu;
          r.cooldownReason = typeof raw.cooldownReason === 'string' && raw.cooldownReason.trim()
            ? raw.cooldownReason.slice(0, 160) : 'đang nghỉ (từ lần chạy trước)';
        }
        const jo = nonNeg(raw.jsonObjectUntil) ?? 0;
        if (r.cfg.json !== 'object' && jo > t && jo - t <= P.jsonObjectRememberMs) r.jsonObjectUntil = jo;
        const mo = nonNegInt(raw.maxOutputTokens) ?? 0;
        const mu = nonNeg(raw.maxOutputUntil) ?? 0;
        if (mo >= P.minOutputTokens && mu > t && mu - t <= P.outputCapRememberMs) { r.maxOutputTokens = mo; r.maxOutputUntil = mu; }
        r.backoffRate = Math.min(nonNegInt(raw.backoffRate) ?? 0, 20);
        r.backoffServer = Math.min(nonNegInt(raw.backoffServer) ?? 0, 20);
        if (typeof raw.lastError === 'string' && raw.lastError.trim()) r.lastError = describeError(raw.lastError, keys);
      }
      return;
    }
    // bản v1 (llm.ts cũ, 1 provider): chỉ có tổng gộp
    if (typeof data.calls === 'number' || typeof data.costTotalUsd === 'number') foldIntoCarry(data, sameDay, true);
  }

  return {
    enabled: runtimes.some((r) => r.client !== null),
    keys,
    providers,
    inflight: () => running + waiters.length,
    costToday: () => totals(now()).costTodayUsd,
    anyAvailable: () => { const t = now(); return runtimes.some((r) => available(r, t)); },
    pick: (task, priority) => { const t = now(); return order(task, priority).find((r) => available(r, t))?.cfg ?? null; },
    complete,
    stats,
    serialize,
    restore,
  };
}
