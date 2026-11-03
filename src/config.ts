import { config as loadEnv } from 'dotenv';
loadEnv({ quiet: true });

const num = (v: string | undefined, d: number) =>
  v === undefined || v.trim() === '' || isNaN(Number(v)) ? d : Number(v);
const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v.trim() === '' ? d : !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase());
const str = (v: string | undefined): string => (v ?? '').trim();
/** Số dương hoặc undefined (= không giới hạn) */
const limit = (v: string | undefined): number | undefined => {
  const n = num(v, 0);
  return n > 0 ? Math.floor(n) : undefined;
};

// Giá ước tính (USD / 1M token) cho model OpenAI. Có thể ghi đè trong .env.
const PRICE_TABLE: Record<string, ProviderPrice> = {
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cached: 0.025, output: 0.4 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.0 },
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4 },
};
const FREE: ProviderPrice = { input: 0, cached: 0, output: 0 };

const tablePrice = (model: string): ProviderPrice | undefined =>
  Object.entries(PRICE_TABLE)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([k]) => model.startsWith(k))?.[1];

export type TimeMode = 'compressed' | 'realtime';

// ---------------------------------------------------------------- nhà cung cấp AI (nhiều provider, failover)

export interface ProviderPrice { input: number; cached: number; output: number }
/** normal = dùng theo thứ tự; strong = ưu tiên cho việc quan trọng (đuổi việc, phỏng vấn, bản tin, ứng viên) */
export type ProviderTier = 'normal' | 'strong';
/** schema = thử json_schema trước (tự hạ xuống json_object khi bị 400); object = dùng thẳng json_object */
export type ProviderJsonMode = 'schema' | 'object';

export interface ProviderConfig {
  name: string;               // tên trong AI_PROVIDERS, chữ thường (vd 'gemini')
  label: string;              // tên hiển thị (AI_<NAME>_LABEL, mặc định 'Gemini'/'Groq'/'OpenAI'/NAME)
  baseUrl?: string;           // undefined = api.openai.com
  apiKey: string;
  model: string;
  rpm?: number;               // requests / phút (cửa sổ trượt 60 s)
  rpd?: number;               // requests / ngày (theo ngày giờ VN)
  tpd?: number;               // tokens / ngày
  price: ProviderPrice;       // USD / 1M token (0 = miễn phí)
  reasoningEffort: string;    // '' = không gửi reasoning_effort
  isReasoningModel: boolean;  // nhân 3 max_completion_tokens, không gửi temperature
  tier: ProviderTier;
  json: ProviderJsonMode;
  /** AI_<NAME>_EXTRA_JSON: trường bổ sung ghép thẳng vào body chat/completions (vd Cloudflare Gemma:
   *  {"chat_template_kwargs":{"enable_thinking":false}} để tắt chế độ "suy nghĩ"). undefined = không gửi gì thêm */
  extraBody?: Record<string, unknown>;
  /** AI_<NAME>_MAX_OUTPUT_TOKENS: trần cố định cho max_completion_tokens (Groq free: OTPM 1000 → đặt 900). undefined = không trần */
  maxOutputTokens?: number;
  /** AI_<NAME>_MAX_REQUEST_TOKENS: request (prompt + token ra xin) lớn hơn mức này thì KHÔNG gửi tới provider này
   *  (Groq free: TPM 8000) — tránh gọi hỏng "Request too large". undefined = không giới hạn */
  maxRequestTokens?: number;
  /** AI_<NAME>_PACE (mặc định true): giữ nhịp quota NGÀY (RPD/TPD) theo giờ đã trôi của ngày quota + một phần "bung" đầu ngày,
   *  để không cạn sạch trong vài giờ đầu rồi chờ reset. false = cho dùng thoải mái tới hết */
  pace: boolean;
  /** AI_<NAME>_WEIGHT (mặc định 1, 0.05–5): trọng số khi AI_ROUTING=balanced — nhỏ hơn 1 = ít được chọn cho cảnh thường
   *  (vd model tiếng Việt kém hơn chỉ gánh phụ), vẫn được dùng khi bên khác hết quota */
  weight: number;
}

/** Cách chọn provider cho cảnh thường: priority = đúng thứ tự AI_PROVIDERS; balanced = xen kẽ, nghiêng về provider còn nhiều quota ngày */
export type AiRouting = 'priority' | 'balanced';

/** Đọc AI_<NAME>_EXTRA_JSON: phải là JSON object; sai cú pháp → bỏ qua + cảnh báo (không làm app chết) */
function parseExtraBody(raw: string, label: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      // không cho ghi đè các trường router tự đặt
      for (const k of ['model', 'messages', 'response_format', 'max_tokens', 'max_completion_tokens', 'stream']) delete o[k];
      return Object.keys(o).length ? o : undefined;
    }
  } catch { /* rơi xuống cảnh báo */ }
  console.warn(`[config] ${label}: AI_*_EXTRA_JSON không phải JSON object hợp lệ — bỏ qua`);
  return undefined;
}

export const KNOWN_BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  groq: 'https://api.groq.com/openai/v1',
};

const DEFAULT_LABEL: Record<string, string> = {
  openai: 'OpenAI', gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', mistral: 'Mistral', deepseek: 'DeepSeek',
  together: 'Together', cerebras: 'Cerebras', ollama: 'Ollama', local: 'Local', cloudflare: 'Cloudflare',
};
const defaultLabel = (name: string): string =>
  DEFAULT_LABEL[name] ?? (name.charAt(0).toUpperCase() + name.slice(1));

/** Model "suy luận": tốn token nghĩ → nhân 3 max_completion_tokens, gửi reasoning_effort, bỏ temperature */
export const REASONING_MODEL_RE = /^(o\d|gpt-5|(openai\/)?gpt-oss|deepseek-r|(qwen\/)?qwen3)/i;

const isOpenAiEndpoint = (baseUrl: string | undefined): boolean => !baseUrl || /api\.openai\.com/i.test(baseUrl);

/** Tên provider suy ra từ OPENAI_BASE_URL kiểu cũ: gemini / groq / openai */
export function inferProviderName(baseUrl: string | undefined): string {
  const u = (baseUrl ?? '').toLowerCase();
  if (u.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (u.includes('api.groq.com')) return 'groq';
  return 'openai';
}

export interface ProviderSkipped { name: string; label: string; model: string; reason: string }
export interface ProviderBuild {
  providers: ProviderConfig[];     // chỉ những provider có key, đúng thứ tự ưu tiên
  skipped: ProviderSkipped[];      // bị bỏ qua (chưa có key, tên sai...) → cảnh báo lúc khởi động
  legacy: boolean;                 // true = dựng từ OPENAI_* kiểu cũ
}

function priceFromEnv(env: NodeJS.ProcessEnv, prefix: string, fallback: ProviderPrice): ProviderPrice {
  return {
    input: num(env[`${prefix}PRICE_INPUT_PER_M`], fallback.input),
    cached: num(env[`${prefix}PRICE_CACHED_INPUT_PER_M`], fallback.cached),
    output: num(env[`${prefix}PRICE_OUTPUT_PER_M`], fallback.output),
  };
}

/**
 * Đọc danh sách provider từ env. AI_PROVIDERS=gemini,groq → AI_GEMINI_*, AI_GROQ_* ...
 * Không có AI_PROVIDERS → dựng 1 provider từ OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL (tương thích cũ).
 * Hàm thuần (nhận env) để test được.
 */
export function buildProviders(env: NodeJS.ProcessEnv = process.env): ProviderBuild {
  const names = [...new Set(str(env.AI_PROVIDERS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const skipped: ProviderSkipped[] = [];
  if (names.length === 0) {
    const apiKey = str(env.OPENAI_API_KEY);
    if (!apiKey) return { providers: [], skipped, legacy: true };
    const baseUrl = str(env.OPENAI_BASE_URL) || undefined;
    const model = str(env.OPENAI_MODEL) || 'gpt-4o-mini';
    const name = inferProviderName(baseUrl);
    const base = tablePrice(model) ?? (name === 'openai' ? PRICE_TABLE['gpt-4o-mini'] : FREE);
    const reasoningEffort = str(env.OPENAI_REASONING_EFFORT);
    return {
      legacy: true,
      skipped,
      providers: [{
        name, label: defaultLabel(name), baseUrl, apiKey, model,
        rpm: limit(env.OPENAI_RPM), rpd: limit(env.OPENAI_RPD), tpd: limit(env.OPENAI_TPD),
        price: priceFromEnv(env, '', base),
        reasoningEffort,
        isReasoningModel: REASONING_MODEL_RE.test(model) || reasoningEffort !== '',
        tier: 'normal', json: 'schema', pace: true, weight: 1,
      }],
    };
  }
  const providers: ProviderConfig[] = [];
  for (const name of names) {
    const label0 = defaultLabel(name);
    if (!/^[a-z0-9_]+$/.test(name)) {
      skipped.push({ name, label: label0, model: '', reason: 'tên không hợp lệ (chỉ a-z, 0-9, _)' });
      continue;
    }
    const P = `AI_${name.toUpperCase()}_`;
    const label = str(env[`${P}LABEL`]) || label0;
    const model = str(env[`${P}MODEL`]);
    const baseUrl = str(env[`${P}BASE_URL`]) || KNOWN_BASE_URLS[name] || undefined;
    const apiKey = str(env[`${P}API_KEY`]);
    if (!apiKey) { skipped.push({ name, label, model, reason: `chưa có key (${P}API_KEY)` }); continue; }
    if (!model) { skipped.push({ name, label, model, reason: `chưa khai báo model (${P}MODEL)` }); continue; }
    const reasoningEffort = str(env[`${P}REASONING_EFFORT`]);
    const tier: ProviderTier = str(env[`${P}TIER`]).toLowerCase() === 'strong' ? 'strong' : 'normal';
    const json: ProviderJsonMode = str(env[`${P}JSON`]).toLowerCase() === 'object' ? 'object' : 'schema';
    // AI_<NAME>_REASONING=true|false: ép coi là model suy luận hay không (mặc định: đoán theo tên model / có REASONING_EFFORT)
    const reasoningRaw = str(env[`${P}REASONING`]).toLowerCase();
    const isReasoningModel = reasoningRaw === 'true' || reasoningRaw === '1' ? true
      : reasoningRaw === 'false' || reasoningRaw === '0' ? false
        : REASONING_MODEL_RE.test(model) || reasoningEffort !== '';
    // Mặc định miễn phí (0). Riêng endpoint OpenAI chính chủ với model quen thì lấy bảng giá có sẵn.
    const base = (isOpenAiEndpoint(baseUrl) && tablePrice(model)) || FREE;
    providers.push({
      name, label, baseUrl, apiKey, model,
      rpm: limit(env[`${P}RPM`]), rpd: limit(env[`${P}RPD`]), tpd: limit(env[`${P}TPD`]),
      price: priceFromEnv(env, P, base),
      reasoningEffort,
      isReasoningModel,
      tier, json,
      extraBody: parseExtraBody(str(env[`${P}EXTRA_JSON`]), label),
      maxOutputTokens: limit(env[`${P}MAX_OUTPUT_TOKENS`]),
      maxRequestTokens: limit(env[`${P}MAX_REQUEST_TOKENS`]),
      pace: !bool(env[`${P}PACE`], true) ? false : true,
      weight: Math.min(5, Math.max(0.05, num(env[`${P}WEIGHT`], 1))),
    });
  }
  return { providers, skipped, legacy: false };
}

// ---------------------------------------------------------------- v3: thời sự từ RSS báo (docs/v3-news.md)

/** Nhóm tin cấu hình được (NewsCategory trong types.ts; `bong_da` là nhãn phụ tự gắn cho tin the_thao, không cấu hình feed) */
export const NEWS_GROUPS = ['the_thao', 'cong_nghe', 'game', 'khoa_hoc', 'giai_tri'] as const;
export type NewsGroup = typeof NEWS_GROUPS[number];
export interface NewsFeedConfig { group: NewsGroup; url: string }

/** Danh sách RSS mặc định (đã kiểm tra 2026-11-01, không cần key) — dạng "nhom|url", cách nhau bằng dấu phẩy */
export const DEFAULT_NEWS_FEEDS = [
  'the_thao|https://vnexpress.net/rss/the-thao.rss',
  'the_thao|https://tuoitre.vn/rss/the-thao.rss',
  'the_thao|https://thanhnien.vn/rss/the-thao.rss',
  'cong_nghe|https://vnexpress.net/rss/so-hoa.rss',
  'cong_nghe|https://tuoitre.vn/rss/nhip-song-so.rss',
  'game|https://gamek.vn/home.rss',
  'khoa_hoc|https://vnexpress.net/rss/khoa-hoc.rss',
  'giai_tri|https://vnexpress.net/rss/giai-tri.rss',
  'giai_tri|https://tuoitre.vn/rss/giai-tri.rss',
  'giai_tri|https://thanhnien.vn/rss/giai-tri.rss',
].join(',');

/** Đọc NEWS_FEEDS ("nhom|url,nhom|url"); mục sai (nhóm lạ, url không phải http/https) bị bỏ qua và ghi vào notes. Hàm thuần. */
export function parseNewsFeeds(raw: string): { feeds: NewsFeedConfig[]; notes: string[] } {
  const feeds: NewsFeedConfig[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw ?? '').split(/[,\n]/)) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf('|');
    const group = (i >= 0 ? s.slice(0, i) : '').trim().toLowerCase();
    const url = (i >= 0 ? s.slice(i + 1) : s).trim();
    if (!(NEWS_GROUPS as readonly string[]).includes(group)) {
      notes.push(`NEWS_FEEDS: nhóm "${group || '?'}" không hợp lệ (${url}) — dùng ${NEWS_GROUPS.join(' / ')}`);
      continue;
    }
    if (!/^https?:\/\/\S+$/i.test(url)) { notes.push(`NEWS_FEEDS: url không hợp lệ "${url}"`); continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    feeds.push({ group: group as NewsGroup, url });
  }
  return { feeds, notes };
}

/** Danh sách chuỗi cách nhau bằng dấu phẩy */
const list = (v: string | undefined): string[] => str(v).split(',').map((s) => s.trim()).filter(Boolean);

const newsFeedsParsed = parseNewsFeeds(str(process.env.NEWS_FEEDS) || DEFAULT_NEWS_FEEDS);

const built = buildProviders(process.env);
const primary: ProviderConfig | undefined = built.providers[0];
const legacyModel = str(process.env.OPENAI_MODEL) || 'gpt-4o-mini';

/** SITE_URL → "https://host[:port][/path]" không có "/" cuối; sai định dạng → '' */
function siteUrlOf(v: string | undefined): string {
  const raw = str(v);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export const CONFIG = {
  port: num(process.env.PORT, 3000),

  // ---- AI ----
  /** Nguồn sự thật: danh sách provider (chỉ provider có key), theo thứ tự ưu tiên */
  providers: built.providers,
  /** Provider bị bỏ qua lúc khởi động (vd Groq chưa có key) — để in cảnh báo */
  providerNotes: built.skipped.map((s) => `${s.label}${s.model ? ` (${s.model})` : ''}: ${s.reason}`),
  providersLegacy: built.legacy,
  // Các trường cũ = "gương" của provider chính (để code/script cũ còn chạy).
  // openaiKey rỗng = tắt AI hoàn toàn (script test đặt { ...CONFIG, openaiKey: '' } để chạy offline).
  openaiKey: primary?.apiKey ?? '',
  openaiBaseUrl: primary ? primary.baseUrl : str(process.env.OPENAI_BASE_URL) || undefined,
  model: primary?.model ?? legacyModel,
  reasoningEffort: primary?.reasoningEffort ?? str(process.env.OPENAI_REASONING_EFFORT),
  isReasoningModel: primary?.isReasoningModel ?? REASONING_MODEL_RE.test(legacyModel),
  price: primary?.price ?? priceFromEnv(process.env, '', tablePrice(legacyModel) ?? PRICE_TABLE['gpt-4o-mini']),
  dailyBudgetUsd: num(process.env.DAILY_BUDGET_USD, 1),
  minSecondsBetweenLlm: num(process.env.MIN_SECONDS_BETWEEN_LLM, 20),
  maxConcurrentLlm: num(process.env.MAX_CONCURRENT_LLM, 2),
  // AI_ROUTING=balanced: cảnh thường xen kẽ các provider, nghiêng về bên còn nhiều quota ngày (priority = đúng thứ tự AI_PROVIDERS)
  aiRouting: (str(process.env.AI_ROUTING).toLowerCase() === 'balanced' ? 'balanced' : 'priority') as AiRouting,
  offlineMinSeconds: num(process.env.OFFLINE_MIN_SECONDS, 8),
  // Không ai xem => không gọi GPT cho cảnh thường (cảnh quan trọng dùng câu mẫu offline)
  llmOnlyWhenWatched: bool(process.env.LLM_ONLY_WHEN_WATCHED, true),

  // ---- Thời gian ----
  timeMode: (process.env.TIME_MODE?.trim() === 'realtime' ? 'realtime' : 'compressed') as TimeMode,
  gameMinutesPerSecond: num(process.env.GAME_MINUTES_PER_SECOND, 0.5),

  // ---- KPI / HR ----
  kpiLowRatio: num(process.env.KPI_LOW_RATIO, 0.7),
  kpiWarnDays: num(process.env.KPI_WARN_DAYS, 2),
  kpiFireDays: num(process.env.KPI_FIRE_DAYS, 3),

  // ---- Affiliate ----
  productMentionMinMinutes: num(process.env.PRODUCT_MENTION_MIN_MINUTES, 8),

  // ---- Khác ----
  devPanel: bool(process.env.DEV_PANEL, true),
  persist: bool(process.env.PERSIST, true),
  stateFile: process.env.STATE_FILE?.trim() || 'data/state.json',
  companyName: process.env.COMPANY_NAME?.trim() || 'Cty TNHH VibeCorp',
  /**
   * Địa chỉ gốc công khai của site (vd https://corp.vibe-coder.fun) — dùng cho thẻ Open Graph / canonical trong index.html
   * (ảnh xem trước khi dán link lên Facebook / Zalo phải là URL tuyệt đối). Trống = suy ra từ request (Host + https sau
   * Cloudflare / nginx). Sai định dạng (không phải http/https) → coi như trống.
   */
  siteUrl: siteUrlOf(process.env.SITE_URL),

  // ---- v3: thời sự (tin thật từ RSS báo — docs/v3-news.md) ----
  newsEnabled: bool(process.env.NEWS_ENABLED, true),
  /** feed hợp lệ theo thứ tự cấu hình (mặc định DEFAULT_NEWS_FEEDS) */
  newsFeeds: newsFeedsParsed.feeds,
  /** mục NEWS_FEEDS bị bỏ qua (nhóm / url sai) — in cảnh báo lúc khởi động */
  newsFeedNotes: newsFeedsParsed.notes,
  newsRefreshMinutes: Math.max(5, num(process.env.NEWS_REFRESH_MINUTES, 45)),
  /** tối thiểu bao nhiêu phút THẬT giữa 2 cảnh news_chat (0 = không giới hạn) */
  newsSceneMinMinutes: Math.max(0, num(process.env.NEWS_SCENE_MIN_MINUTES, 25)),
  newsAllowShowbiz: bool(process.env.NEWS_ALLOW_SHOWBIZ, true),
  newsMaxAgeDays: Math.max(0.5, num(process.env.NEWS_MAX_AGE_DAYS, 3)),
  /** từ / cụm từ chặn thêm (ngoài danh sách có sẵn trong src/news/filter.ts) */
  newsBlocklist: list(process.env.NEWS_BLOCKLIST),

  // ---- v3: câu chuyện tự phát triển (AI biên kịch + nhân sự do AI quyết) ----
  showrunnerEnabled: bool(process.env.SHOWRUNNER_ENABLED, true),
  showrunnerEveryGameMinutes: Math.max(30, num(process.env.SHOWRUNNER_EVERY_GAME_MINUTES, 120)),
  /** lần khởi tạo đầu: tính cách = roster ± 0.15 (không ai bị "đánh dấu" lười/kém từ trước) */
  storyRandomizeTraits: bool(process.env.STORY_RANDOMIZE_TRAITS, true),
  /** cho phép tính cách trôi theo sự kiện (World.driftTrait, kẹp ±0.25 quanh traitBase) */
  storyTraitDrift: bool(process.env.STORY_TRAIT_DRIFT, true),
  /** HR + sếp họp xét nhân sự (hr_review) định kỳ mỗi N ngày game */
  hrReviewEveryDays: Math.max(1, Math.round(num(process.env.HR_REVIEW_EVERY_DAYS, 3))),

  // ---- v3: lưu trữ dài hạn (archive JSONL theo ngày, src/sim/archive.ts) ----
  historyEnabled: bool(process.env.HISTORY_ENABLED, true),
  historyDir: str(process.env.HISTORY_DIR) || 'data/history',
  historyKeepDays: Math.max(1, num(process.env.HISTORY_KEEP_DAYS, 180)),
  historyGzipAfterDays: Math.max(1, num(process.env.HISTORY_GZIP_AFTER_DAYS, 7)),

  // ---- v3: bảng dev trên production ----
  /** rỗng = như cũ (DEV_PANEL quyết định cho mọi người); có giá trị = chỉ client nối ws với ?dev=<token> mới có bảng dev */
  devToken: str(process.env.DEV_TOKEN),
};

export type Config = typeof CONFIG;

/** Dựng ProviderConfig với giá trị mặc định (test / script). */
export function makeProvider(p: Partial<ProviderConfig> & { name: string; apiKey: string; model: string }): ProviderConfig {
  return {
    label: defaultLabel(p.name),
    price: FREE,
    reasoningEffort: '',
    isReasoningModel: REASONING_MODEL_RE.test(p.model),
    tier: 'normal',
    json: 'schema',
    pace: true,
    weight: 1,
    ...p,
  };
}

/**
 * Config dùng đúng danh sách provider này (test / script); đồng bộ luôn các trường cũ
 * (openaiKey = key của provider đầu — rỗng nghĩa là tắt AI).
 */
export function withProviders(base: Config, providers: ProviderConfig[]): Config {
  const p = providers[0];
  return {
    ...base,
    providers,
    providerNotes: [],
    providersLegacy: false,
    openaiKey: p?.apiKey ?? '',
    openaiBaseUrl: p?.baseUrl,
    model: p?.model ?? base.model,
    reasoningEffort: p?.reasoningEffort ?? '',
    isReasoningModel: p?.isReasoningModel ?? false,
    price: p?.price ?? base.price,
  };
}
