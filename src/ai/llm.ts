// =====================================================================
//  Lớp kỹ thuật thấp nhất: 1 provider = 1 client OpenAI-compatible (OpenAI,
//  Gemini, Groq...). attempt() = đúng 1 lần gọi HTTP → JSON đã parse + token/chi phí
//  theo giá của provider đó. Không retry, không failover, không hàng đợi — router.ts
//  lo chính sách (thứ tự, cooldown, giới hạn ngày, chuyển provider); brain.ts lo
//  cảnh/nhân vật. Ở đây còn: tiện ích che key, mô tả lỗi tiếng Việt, ngày giờ VN,
//  học dần tham số nào bị model/proxy từ chối (400), DEBUG_PROMPTS=1.
// =====================================================================
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import type { ProviderConfig } from '../config.js';
import type { Priority } from '../types.js';

/** beats = AI biên kịch (v3): 1 lượt gọi rẻ mỗi ~2 giờ game đề xuất 1–3 "biến" */
export type LlmTask = 'scene' | 'candidate' | 'recap' | 'beats';
export type JsonFormat = 'json_schema' | 'json_object';

export interface LlmRequest {
  task: LlmTask;
  system: string;                     // system prompt TĨNH (prompt cache)
  user: string;                       // prompt động
  schemaName: string;                 // ^[a-zA-Z0-9_-]{1,64}$
  schema: Record<string, unknown>;    // JSON schema strict (tĩnh)
  maxTokens: number;                  // ngân sách output cho model thường (reasoning ×3)
  signal?: AbortSignal;               // brain huỷ khi quá hạn
  priority?: Priority;                // high → ưu tiên provider tier 'strong'
  deadlineAt?: number;                // ms epoch (giờ thật): router không mở lượt gọi mới khi sắp hết hạn
}

export interface LlmCallUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
  estimated: boolean;                 // true nếu server không trả usage (proxy) → ước lượng theo ký tự
}

export interface LlmResponse {
  data: unknown;                      // JSON đã parse (chưa kiểm tra nội dung)
  format: JsonFormat;
  usage: LlmCallUsage;
  finishReason: string | null;
  ms: number;
  provider: string;                   // tên provider đã trả lời (vd 'gemini')
  attempts: number;                   // số lần gọi HTTP trong request này (kể cả failover)
}

export type LlmErrorCode =
  | 'disabled'      // không có provider nào có key
  | 'unavailable'   // có provider nhưng tất cả đang nghỉ / hết lượt
  | 'exhausted'     // đã thử hết provider trong hạn mà đều lỗi
  | 'aborted' | 'timeout' | 'empty' | 'refusal' | 'parse';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  /** token đã tiêu dù kết quả hỏng (JSON lỗi, rỗng, từ chối) — để router vẫn tính tiền */
  usage?: LlmCallUsage;
  constructor(code: LlmErrorCode, message: string, usage?: LlmCallUsage) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    if (usage) this.usage = usage;
  }
}

// ---------------------------------------------------------------- tiện ích dùng chung

/** Che mọi thứ giống API key / bearer token trong chuỗi (mọi provider). */
export function redactSecrets(s: string, keys?: string | readonly string[]): string {
  let out = String(s);
  const list = typeof keys === 'string' ? [keys] : keys ?? [];
  for (const key of list) {
    if (key && key.length >= 6) out = out.split(key).join('***');
  }
  out = out.replace(/\bsk-[A-Za-z0-9_\-*]{4,}/g, 'sk-***');          // OpenAI / OpenRouter
  out = out.replace(/\bgsk_[A-Za-z0-9_\-*]{4,}/g, 'gsk_***');        // Groq
  out = out.replace(/\bAIza[A-Za-z0-9_\-*]{8,}/g, 'AIza***');        // Google (AI Studio cũ)
  out = out.replace(/\bAQ\.[A-Za-z0-9_\-*]{12,}/g, 'AQ.***');         // Google (AI Studio mới)
  out = out.replace(/\bcfut_[A-Za-z0-9_\-*]{8,}/g, 'cfut_***');      // Cloudflare Workers AI token
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-~+/=]+/gi, '$1***');
  out = out.replace(/(api[_-]?key["'\s:=]+)[^\s"',}&]+/gi, '$1***');
  out = out.replace(/([?&]key=)[^\s&"']+/gi, '$1***');                // Gemini ?key=...
  out = out.replace(/(x-goog-api-key["'\s:=]+)[^\s"',}]+/gi, '$1***');
  return out;
}

// ---- múi giờ: ngày/0h theo một múi giờ bất kỳ (VN cho ngân sách; Gemini reset quota lúc 0h giờ Pacific)
export const VN_TZ = 'Asia/Ho_Chi_Minh';
export const PACIFIC_TZ = 'America/Los_Angeles';
/** Lệch giờ cố định dự phòng (phút) khi Intl không hỗ trợ múi giờ */
const FIXED_OFFSET_MIN: Record<string, number> = { [VN_TZ]: 420, [PACIFIC_TZ]: -480 };

const dateFmtCache = new Map<string, Intl.DateTimeFormat | null>();
const partsFmtCache = new Map<string, Intl.DateTimeFormat | null>();
function cachedFmt(cache: Map<string, Intl.DateTimeFormat | null>, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  if (!cache.has(tz)) {
    try { cache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts })); } catch { cache.set(tz, null); }
  }
  return cache.get(tz) ?? null;
}

/** Ngày YYYY-MM-DD theo múi giờ tz. */
export function dateKeyIn(tz: string, d: Date = new Date()): string {
  const f = cachedFmt(dateFmtCache, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (f) {
    const s = f.format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return new Date(d.getTime() + (FIXED_OFFSET_MIN[tz] ?? 0) * 60_000).toISOString().slice(0, 10);
}

/** Giờ địa phương của tz tại thời điểm atMs, biểu diễn như epoch UTC (để suy ra lệch giờ, kể cả DST). */
function wallClockAsUtc(tz: string, atMs: number): number | null {
  const f = cachedFmt(partsFmtCache, tz, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  if (!f) return null;
  const parts = f.formatToParts(new Date(atMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const v = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Number.isFinite(v) ? v : null;
}

/** 0h ngày kế tiếp theo múi giờ tz (ms epoch), đúng cả ngày đổi DST. */
export function nextMidnightIn(tz: string, nowMs: number = Date.now()): number {
  const [y, m, d] = dateKeyIn(tz, new Date(nowMs)).split('-').map(Number);
  const target = Date.UTC(y, m - 1, d + 1); // 0h ngày kế tiếp nếu tz là UTC
  const w1 = wallClockAsUtc(tz, target);
  if (w1 === null) return target - (FIXED_OFFSET_MIN[tz] ?? 0) * 60_000;
  let guess = target - (w1 - target);
  const w2 = wallClockAsUtc(tz, guess);
  if (w2 !== null) guess = target - (w2 - guess); // lặp 1 lần cho ngày đổi giờ
  return guess;
}

/** Ngày theo giờ Việt Nam dạng YYYY-MM-DD (mốc reset ngân sách mỗi ngày). */
export function localDateKey(d: Date = new Date()): string {
  return dateKeyIn(VN_TZ, d);
}

/** 0h ngày hôm sau theo giờ Việt Nam (ms epoch). */
export function nextLocalMidnight(nowMs: number = Date.now()): number {
  return nextMidnightIn(VN_TZ, nowMs);
}

const VN_TIME_FMT: Intl.DateTimeFormat | null = (() => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return null;
  }
})();

/** Giờ:phút theo giờ Việt Nam (đóng dấu thời gian cho lastError, mốc hết cooldown). */
export function localTimeLabel(d: Date = new Date()): string {
  if (VN_TIME_FMT) {
    const s = VN_TIME_FMT.format(d);
    if (/^\d{2}:\d{2}$/.test(s)) return s;
  }
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
}

/** Ước lượng token thô (tiếng Việt ~3.5 ký tự/token). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.5);
}

/** Thông báo lỗi ngắn gọn, tiếng Việt, đã che key (mọi provider). */
export function describeError(e: unknown, keys?: string | readonly string[]): string {
  let msg: string;
  if (e instanceof LlmError) {
    msg = e.message;
  } else if (e instanceof APIUserAbortError) {
    msg = 'Đã huỷ request (quá thời gian chờ)';
  } else if (e instanceof APIConnectionTimeoutError) {
    msg = 'Hết thời gian chờ máy chủ AI';
  } else if (e instanceof APIConnectionError) {
    msg = 'Không kết nối được tới máy chủ AI';
  } else if (e instanceof APIError) {
    const hint =
      e.status === 401 ? 'Sai hoặc thiếu API key' :
      e.status === 403 ? 'Không có quyền dùng model/tài khoản' :
      e.status === 404 ? 'Không tìm thấy model (hoặc sai BASE_URL)' :
      e.status === 429 ? 'Bị giới hạn tốc độ hoặc hết quota' :
      e.status === 400 ? 'Request bị từ chối' :
      (e.status ?? 0) >= 500 ? 'Máy chủ AI lỗi' : 'Lỗi API';
    msg = `${hint} — ${e.message}`;
  } else if (e instanceof Error) {
    msg = e.message;
  } else {
    msg = String(e);
  }
  msg = redactSecrets(msg.replace(/\s+/g, ' ').trim(), keys);
  return msg.length > 220 ? msg.slice(0, 219) + '…' : msg;
}

/** Parse JSON chịu lỗi nhẹ: bỏ ```json fence, cắt từ { đầu tới } cuối. */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim().replace(/^﻿/, '');
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); // throw nếu vẫn hỏng
    throw new SyntaxError('Phản hồi không chứa JSON');
  }
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const nonNeg = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** Token + chi phí của 1 phản hồi theo giá provider; ước lượng theo ký tự nếu server không trả usage. */
export function measureUsage(
  u: OpenAI.CompletionUsage | undefined, req: LlmRequest, content: string, price: ProviderConfig['price'],
): LlmCallUsage {
  let promptTokens = nonNeg(u?.prompt_tokens) ?? 0;
  let completionTokens = nonNeg(u?.completion_tokens) ?? 0;
  let cached = nonNeg(u?.prompt_tokens_details?.cached_tokens) ?? 0;
  let estimated = false;
  if (!u || (promptTokens === 0 && completionTokens === 0)) {
    promptTokens = estimateTokens(req.system) + estimateTokens(req.user);
    completionTokens = estimateTokens(content);
    cached = 0;
    estimated = true;
  }
  cached = Math.min(cached, promptTokens);
  const raw = ((promptTokens - cached) * price.input + cached * price.cached + completionTokens * price.output) / 1e6;
  const costUsd = Number.isFinite(raw) && raw > 0 ? raw : 0;
  return { promptTokens, cachedTokens: cached, completionTokens, costUsd, estimated };
}

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'] as const;

/** Tham số tuỳ chọn có thể bị model/proxy từ chối (400) → bỏ đi và thử lại. */
type OptionalParam = 'temperature' | 'reasoning_effort' | 'prompt_cache_key';
const OPTIONAL_PARAMS = new Set<string>(['temperature', 'reasoning_effort', 'prompt_cache_key']);

// ---------------------------------------------------------------- client cho 1 provider

/**
 * 'retry' = vừa bỏ một tham số không được hỗ trợ (gọi lại cùng định dạng); 'json_object' = server nói rõ
 * không nhận json_schema; 'content' = model sinh JSON không khớp schema (Groq json_validate_failed) — lỗi
 * nội dung, không phải lỗi provider; null = lỗi 400 khác.
 */
export type Adapt400 = 'retry' | 'json_object' | 'content' | null;

/** Giới hạn router áp cho 1 lượt gọi (học từ máy chủ, vd Groq "Request too large … OTPM Limit 1000") */
export interface AttemptLimits {
  /** trần max_completion_tokens cho provider này (0/undefined = không trần) */
  maxOutputTokens?: number;
}

/** Ngân sách token ra thực gửi đi: maxTokens của task (model suy luận ×3), kẹp dưới trần học được từ máy chủ (nếu có) */
export function outputBudget(req: Pick<LlmRequest, 'maxTokens'>, cfg: Pick<ProviderConfig, 'isReasoningModel'>, cap?: number): number {
  let maxTok = Math.max(64, Math.round(req.maxTokens * (cfg.isReasoningModel ? 3 : 1)));
  if (cap !== undefined && Number.isFinite(cap) && cap > 0 && cap < maxTok) maxTok = Math.max(64, Math.floor(cap));
  return maxTok;
}

export interface ProviderClient {
  readonly cfg: ProviderConfig;
  /** Đúng 1 lần gọi HTTP, không retry. Throw lỗi SDK (APIError...) hoặc LlmError (nội dung hỏng, kèm usage). */
  attempt(req: LlmRequest, format: JsonFormat, timeoutMs: number, limits?: AttemptLimits): Promise<Omit<LlmResponse, 'provider' | 'attempts'>>;
  /** Học từ lỗi 400 (xem Adapt400). */
  adaptTo400(e: unknown, format: JsonFormat): Adapt400;
}

const debugOn = () => process.env.DEBUG_PROMPTS === '1';
const printedSystems = new Set<string>();

/** Server nói rõ không nhận response_format / json_schema → hạ xuống json_object */
const SCHEMA_REJECT_RE = /response_format|json_schema|json schema|\bschema\b|strict|structured output/i;
/** Model sinh JSON hỏng/không khớp schema (Groq trả 400 json_validate_failed kèm failed_generation) */
const MODEL_JSON_FAIL_RE = /json_validate_failed|failed_generation|failed to generate json/i;

const isPlainObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * fetch bọc ngoài cho SDK: endpoint OpenAI-compatible của Gemini trả lỗi dạng MẢNG `[{"error":{...}}]`;
 * SDK openai chỉ đọc `body.error` nên với mảng sẽ mất hết message/code ("400 status code (no body)")
 * → router không nhận ra sai key / hết quota ngày. Bóc phần tử đầu ra thành object; còn lại giữ nguyên.
 */
export async function unwrapArrayErrorFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status < 400 || !res.body) return res;
  const text = await res.text();
  let body = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0 && isPlainObj(parsed[0]) && 'error' in parsed[0]) {
      body = JSON.stringify(parsed[0]);
    }
  } catch { /* không phải JSON → giữ nguyên */ }
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** Tạo client; null nếu SDK không khởi tạo được (key/baseURL vớ vẩn). */
export function createProviderClient(cfg: ProviderConfig, timeoutMs = 20_000): ProviderClient | null {
  let client: OpenAI;
  try {
    // maxRetries 0: router tự failover sang provider khác thay vì SDK ngủ chờ retry
    client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, timeout: timeoutMs, maxRetries: 0, fetch: unwrapArrayErrorFetch });
  } catch {
    return null;
  }
  const effort = (REASONING_EFFORTS as readonly string[]).includes(cfg.reasoningEffort)
    ? cfg.reasoningEffort
    : cfg.isReasoningModel ? 'low' : '';
  const openAiEndpoint = !cfg.baseUrl || /api\.openai\.com/i.test(cfg.baseUrl);

  const dropped = new Set<OptionalParam>();
  let useMaxTokensParam = false; // proxy cũ không hiểu max_completion_tokens

  function params(req: LlmRequest, format: JsonFormat, limits?: AttemptLimits): OpenAI.ChatCompletionCreateParamsNonStreaming {
    const maxTok = outputBudget(req, cfg, limits?.maxOutputTokens);
    const p: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: cfg.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: format === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } }
        : { type: 'json_object' },
    };
    if (useMaxTokensParam) p.max_tokens = maxTok;
    else p.max_completion_tokens = maxTok;
    if (cfg.isReasoningModel) {
      if (effort && !dropped.has('reasoning_effort')) p.reasoning_effort = effort as OpenAI.ReasoningEffort;
    } else if (!dropped.has('temperature')) {
      p.temperature = 1;
    }
    // prompt_cache_key chỉ cho API OpenAI chính chủ (endpoint khác có thể không hiểu)
    if (openAiEndpoint && !dropped.has('prompt_cache_key')) p.prompt_cache_key = `vpa-${req.task}`;
    // AI_<NAME>_EXTRA_JSON: trường riêng của endpoint (vd chat_template_kwargs tắt "suy nghĩ" của Gemma trên Cloudflare);
    // SDK gửi nguyên body nên các trường lạ đi thẳng tới server
    if (cfg.extraBody) Object.assign(p as unknown as Record<string, unknown>, cfg.extraBody);
    return p;
  }

  function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return p;
    if (signal.aborted) return Promise.reject(new LlmError('aborted', 'Đã huỷ request'));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new LlmError('aborted', 'Đã huỷ request (quá thời gian chờ)'));
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(
        (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  }

  async function attempt(req: LlmRequest, format: JsonFormat, perCallTimeoutMs: number, limits?: AttemptLimits) {
    const body = params(req, format, limits);
    const maxTok = body.max_completion_tokens ?? body.max_tokens ?? 0;
    if (debugOn()) {
      const h = fnv1a(req.system);
      if (!printedSystems.has(h)) {
        printedSystems.add(h);
        console.log(`[ai:debug] SYSTEM PROMPT #${h} (${req.system.length} ký tự ≈ ${estimateTokens(req.system)} token):\n${req.system}\n`);
      }
      console.log(`[ai:debug] ${req.task} → ${cfg.label}/${cfg.model} (${format}, max ${maxTok} tok) USER (${req.user.length} ký tự ≈ ${estimateTokens(req.user)} token):\n${req.user}\n`);
    }
    const t0 = Date.now();
    const pending = client.chat.completions.create(body, {
      signal: req.signal, timeout: Math.max(1_000, Math.round(perCallTimeoutMs)),
    });
    pending.catch(() => { /* có thể bị bỏ rơi khi quá hạn — nuốt để không unhandled rejection */ });
    const completion = await raceAbort(pending, req.signal);

    const choice = completion.choices?.[0];
    const msg = choice?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const usage = measureUsage(completion.usage, req, content, cfg.price);
    const finishReason = choice?.finish_reason ?? null;
    const ms = Date.now() - t0;
    if (debugOn()) {
      console.log(`[ai:debug] ${req.task} ← ${cfg.label} ${ms}ms finish=${finishReason} prompt=${usage.promptTokens} (cached ${usage.cachedTokens}) out=${usage.completionTokens} $${usage.costUsd.toFixed(6)}${usage.estimated ? ' (ước lượng)' : ''}\n${content}\n`);
    }
    if (msg?.refusal) throw new LlmError('refusal', `Model từ chối trả lời: ${String(msg.refusal).slice(0, 120)}`, usage);
    if (!content.trim()) {
      throw new LlmError('empty', finishReason === 'length'
        ? 'Hết max_completion_tokens trước khi có nội dung (model reasoning nghĩ quá lâu?)'
        : 'Phản hồi rỗng', usage);
    }
    let data: unknown;
    try {
      data = parseJsonLoose(content);
    } catch {
      throw new LlmError('parse', finishReason === 'length'
        ? 'JSON bị cắt ngang (hết max_completion_tokens)'
        : 'Phản hồi không phải JSON hợp lệ', usage);
    }
    return { data, format, usage, finishReason, ms };
  }

  function adaptTo400(e: unknown, format: JsonFormat): Adapt400 {
    if (!(e instanceof APIError) || e.status !== 400) return null;
    const param = typeof e.param === 'string' ? e.param : '';
    const text = `${e.message} ${param} ${safeJson(e.error)}`.toLowerCase();
    // model viết JSON hỏng / lệch schema (Groq json_validate_failed): lỗi nội dung của 1 lần sinh, không phải provider
    if (MODEL_JSON_FAIL_RE.test(text)) return 'content';
    if (OPTIONAL_PARAMS.has(param)) { dropped.add(param as OptionalParam); return 'retry'; }
    for (const op of OPTIONAL_PARAMS) {
      // một số server không điền `param` mà chỉ nhắc tên tham số trong message
      if (!dropped.has(op as OptionalParam) && text.includes(op) && /unsupported|not supported|unknown|invalid|unrecognized|không/.test(text)) {
        dropped.add(op as OptionalParam);
        return 'retry';
      }
    }
    if (!useMaxTokensParam && (param === 'max_completion_tokens' || text.includes('max_completion_tokens'))) {
      useMaxTokensParam = true;
      return 'retry';
    }
    if (/api key|api_key|apikey|unauthorized|authentication/.test(text)) return null; // sai key (Gemini trả 400) → router xử lý
    // chỉ hạ xuống json_object khi server nói rõ không nhận response_format / json_schema; 400 khác → router phạt, giữ định dạng
    if (format === 'json_schema' && (param === 'response_format' || SCHEMA_REJECT_RE.test(text))) return 'json_object';
    return null;
  }

  return { cfg, attempt, adaptTo400 };
}

export function safeJson(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v) ?? ''; } catch { return ''; }
}
