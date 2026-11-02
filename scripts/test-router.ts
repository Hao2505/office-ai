// =====================================================================
//  TEST ROUTER NHIỀU NHÀ CUNG CẤP AI (không tốn tiền, không ra Internet):
//  dựng 2 server giả lập OpenAI-compatible "Alpha" và "Beta" trên 127.0.0.1:4600+
//  rồi cho Brain/Router chạy với đồng hồ ảo.
//
//  npm run test:router
//
//  Kiểm tra: A ok → B không bị gọi; 429 + Retry-After → sang B rồi quay lại A;
//  429 quota NGÀY → tin gợi ý của máy chủ, không có thì Gemini nghỉ tới 0h Pacific /
//  provider khác dò lại sau 1 giờ; body lỗi dạng mảng của Gemini được bóc; hết TPD /
//  RPM / RPD → chuyển provider (Gemini đếm theo ngày Pacific); 401 / sai key → tắt 1 giờ
//  với lý do rõ; 500 → failover ngay trong 1 request; timeout trong cửa sổ bị cắt ngắn
//  không bị phạt; 400 json_schema → nhớ json_object, json_validate_failed → không phạt;
//  cả hai chết → offline + cầu dao; tier strong; gộp thống kê + lưu/khôi phục; cấu hình
//  OPENAI_* kiểu cũ; key không bao giờ lộ.
// =====================================================================
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentState, PromptContext, SceneRequest, UsageStats } from '../src/types.js';
import { CONFIG, buildProviders, makeProvider, withProviders, type Config, type ProviderConfig } from '../src/config.js';
import { createBrain } from '../src/ai/brain.js';
import { classifyError, createRouter, isDailyQuota, messageRetryAfterMs, parseDurationMs, parseTooLarge, quotaResetTz, resolveProviders } from '../src/ai/router.js';
import { LlmError, PACIFIC_TZ, VN_TZ, dateKeyIn, localDateKey, nextLocalMidnight, nextMidnightIn, redactSecrets, type LlmRequest } from '../src/ai/llm.js';
import { World } from '../src/sim/world.js';

// ---------------------------------------------------------------- tiện ích test
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, info = ''): void {
  if (ok) { passed++; console.log(`  ✅ ${name}${info ? ` — ${info}` : ''}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${info ? ` — ${info}` : ''}`); }
}
const section = (t: string): void => console.log(`\n▶ ${t}`);
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const KEY_A = 'sk-A-SECRETKEY-aaaaaaaaaaaaaaaaaaaa0001';
const KEY_B = 'gsk_B_SECRETKEY_bbbbbbbbbbbbbbbbbbbb0002';
const leaks = (s: string): boolean => s.includes(KEY_A) || s.includes(KEY_B) || s.includes('SECRETKEY');
const warned: string[] = [];
const infos: string[] = [];
const origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')); if (process.env.TEST_VERBOSE === '1') origWarn(...args); };
process.on('unhandledRejection', (e) => { failures.push(`unhandledRejection: ${String(e)}`); console.log('  ❌ unhandledRejection', e); });

// ---------------------------------------------------------------- server giả lập
interface Req { path: string; auth: string; body: Record<string, unknown> }
type Handler = (r: Req, res: ServerResponse) => void;
interface Mock { name: string; url: string; requests: Req[]; script: Handler[]; server: Server }

function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}
const USAGE_DEFAULT = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 };
function completion(content: string, usage: Record<string, unknown> = USAGE_DEFAULT) {
  return {
    id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null }],
    usage,
  };
}
const formatOf = (r: Req): string => String((r.body.response_format as { type?: string } | undefined)?.type ?? '');
const schemaNameOf = (r: Req): string => String((r.body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name ?? '');
const userOf = (r: Req): string => {
  const msgs = Array.isArray(r.body.messages) ? r.body.messages as { role: string; content: string }[] : [];
  return msgs.find((m) => m.role === 'user')?.content ?? '';
};
let participants = ['vy', 'tung'];
let currentTask: 'scene' | 'candidate' | 'recap' = 'scene';
const taskOf = (r: Req): 'scene' | 'candidate' | 'recap' => {
  const n = schemaNameOf(r);
  if (n === 'ho_so_ung_vien') return 'candidate';
  if (n === 'ban_tin_ngay') return 'recap';
  if (n === 'canh_hoi_thoai') return 'scene';
  const u = userOf(r);
  if (u.startsWith('NHIỆM VỤ: ỨNG VIÊN')) return 'candidate';
  if (u.startsWith('NHIỆM VỤ: BẢN TIN')) return 'recap';
  return currentTask;
};

/** Trả lời hợp lệ theo nhiệm vụ */
const smart: Handler = (r, res) => {
  const task = taskOf(r);
  if (task === 'candidate') {
    sendJson(res, 200, completion(JSON.stringify({
      name: 'Khánh Vy', fullName: 'Trịnh Khánh Vy', gender: 'nữ', age: 24, bio: 'Từng bán bảo hiểm.', speechStyle: 'Xưng em.',
      quirks: ['bút 4 màu'], likes: ['trà đào'], dislikes: ['họp dài'],
      traits: { diligence: 0.7, laziness: 0.3, gossip: 0.5, temper: 0.3, humor: 0.6, ambition: 0.7 },
      look: { skin: '#f1c27d', hair: '#1b1b1b', hairStyle: 'bob', shirt: '#4f86f7', pants: '#2d3748', accessory: 'none' },
    })));
    return;
  }
  if (task === 'recap') {
    sendJson(res, 200, completion(JSON.stringify({
      headline: 'Bản tin giả lập', bullets: ['Ý 1', 'Ý 2', 'Ý 3'], mvp: { id: 'khoa', reason: 'Gánh team' }, drama: 'Drama giả lập.',
    })));
    return;
  }
  const lines = Array.from({ length: 4 }, (_, i) => ({
    speaker: participants[i % participants.length], text: `Câu thoại giả lập số ${i + 1} nè`, emote: null, product: false,
  }));
  sendJson(res, 200, completion(JSON.stringify({
    lines, summary: 'Cảnh giả lập.', relationshipChanges: [], moodChanges: [], memories: [], kpiChanges: [], rumor: null, verdict: null,
  })));
};

async function startMock(name: string, from: number): Promise<Mock> {
  const requests: Req[] = [];
  const script: Handler[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* bỏ qua */ }
      const r: Req = { path: req.url ?? '', auth: String(req.headers.authorization ?? ''), body };
      requests.push(r);
      if (req.method !== 'POST' || !r.path.endsWith('/chat/completions')) { sendJson(res, 404, { error: { message: 'not found' } }); return; }
      const h = script.shift() ?? smart;
      try { h(r, res); } catch (e) { sendJson(res, 500, { error: { message: String(e) } }); }
    });
  });
  for (let port = from; port < 4700; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) {
      const p = (server.address() as AddressInfo).port;
      return { name, url: `http://127.0.0.1:${p}/v1`, requests, script, server };
    }
  }
  throw new Error('không tìm được cổng trống 4600–4699');
}

// lỗi hay gặp (nhái định dạng thật)
const err500: Handler = (_r, res) => sendJson(res, 500, { error: { message: 'Internal server error', type: 'server_error' } });
const err401: Handler = (r, res) => sendJson(res, 401, { error: { message: `Incorrect API key provided: ${r.auth.replace('Bearer ', '')}. You can find your API key at https://platform.openai.com/account/api-keys.`, type: 'invalid_request_error', code: 'invalid_api_key' } });
const err429RetryAfter = (sec: number): Handler => (_r, res) => sendJson(res, 429, { error: { message: 'Rate limit reached for model in organization on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 2s.', type: 'requests', code: 'rate_limit_exceeded' } }, { 'retry-after': String(sec) });
const err429Daily: Handler = (_r, res) => sendJson(res, 429, { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 2h13m4.5s. Quota exceeded per day.', type: 'requests', code: 'rate_limit_exceeded' } });
const err429GeminiMinute: Handler = (_r, res) => sendJson(res, 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-2.5-flash-lite. Please retry in 20.5s.', status: 'RESOURCE_EXHAUSTED', code: 429 } });
const err429GeminiDaily: Handler = (_r, res) => sendJson(res, 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 1000, model: gemini-3.5-flash-lite.', status: 'RESOURCE_EXHAUSTED', code: 429 } });
const err429GroqTpd: Handler = (_r, res) => sendJson(res, 429, { error: { message: 'Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 99500, Requested 1500. Please try again in 14m22.5s.', type: 'tokens', code: 'rate_limit_exceeded' } }, { 'retry-after': '862' });
// Body THẬT của endpoint OpenAI-compatible Gemini: bọc trong MẢNG; hết quota NGÀY vẫn kèm "Please retry in 27.08s"
const err429GeminiDailyArray: Handler = (_r, res) => sendJson(res, 429, [{ error: {
  code: 429,
  message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 1000, model: gemini-3.5-flash-lite\nPlease retry in 27.08s.',
  status: 'RESOURCE_EXHAUSTED',
  details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: { model: 'gemini-3.5-flash-lite', location: 'global' }, quotaValue: '1000' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' },
  ],
} }]);
// Body THẬT khi key sai (dò bằng key giả, dạng mảng): không có chữ "API key not valid"
const err400GeminiKeyArray: Handler = (_r, res) => sendJson(res, 400, [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }]);
// Groq: model viết JSON lệch schema → 400 json_validate_failed (không phải "không hỗ trợ json_schema")
const err400GroqJsonValidate: Handler = (_r, res) => sendJson(res, 400, { error: { message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.", type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '{"lines": [ {"speaker": "vy", "text": "cắt' } });
const err400Schema: Handler = (r, res) => {
  if (formatOf(r) === 'json_schema') sendJson(res, 400, { error: { message: "response_format 'json_schema' is not supported with this model. Use 'json_object' instead.", type: 'invalid_request_error', param: 'response_format', code: null } });
  else smart(r, res);
};
const badJson: Handler = (_r, res) => sendJson(res, 200, completion('{"lines": [ {"speaker": "vy", "text": "cắt ngang'));
const hang: Handler = () => { /* không bao giờ trả lời */ };

// ---------------------------------------------------------------- dữ liệu mẫu
function makeCtx(agents: AgentState[]): PromptContext {
  const map: Record<string, AgentState> = {};
  for (const a of agents) map[a.id] = a;
  return {
    companyName: CONFIG.companyName,
    company: { name: CONFIG.companyName, project: { name: 'App đặt lịch Spa Hương Sen', client: 'Chuỗi spa Hương Sen', desc: 'App đặt lịch', progress: 40, startedDay: 1, deadlineDay: 4 },
      projectsDone: 0, revenueMonth: 320, revenueTarget: 1500, incident: null },
    day: 2, minuteOfDay: 615, weekday: 'Thứ Ba', timeLabel: '10:15', agents: map,
    roster: agents.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name, roleLabel: a.roleLabel })),
    recentSummaries: ['Vy khịa Tùng vì bug thanh toán.'], bossAway: false, bossNote: 'Sếp đang xem báo cáo',
  };
}
function sceneReq(over: Partial<SceneRequest> = {}): SceneRequest {
  return {
    sceneId: 'sc_test', type: 'desk_visit', channel: 'office', locationLabel: 'Bàn của Tùng',
    situation: 'Vy (QA Tester) đi tới bàn Tùng (Senior Developer) để báo một bug mới tìm thấy.',
    participants: ['vy', 'tung'], minLines: 3, maxLines: 7, allowedEffects: ['relationship', 'mood', 'memory'], priority: 'low',
    ...over,
  };
}
const CAND = { role: 'salesnew' as const, roleLabel: 'Nhân viên Sales', deskId: 'd_salesnew', kpiTarget: 300, usedNames: [] as string[] };
const RECAP = { day: 2, weekday: 'Thứ Ba', events: ['10:00 🔥 Sập server'], kpi: [], firedToday: [], hiredToday: [] };

// ================================================================== chạy
const A = await startMock('Alpha', 4600);
const B = await startMock('Beta', 4601);
console.log(`🧪 Test router với 2 server giả lập: Alpha ${A.url} · Beta ${B.url} (key giả, không ra Internet)`);
let vt = Date.now();
const now = (): number => vt;

const provA = (over: Partial<ProviderConfig> = {}): ProviderConfig =>
  makeProvider({ name: 'alpha', label: 'Alpha', apiKey: KEY_A, baseUrl: A.url, model: 'model-a', ...over });
const provB = (over: Partial<ProviderConfig> = {}): ProviderConfig =>
  makeProvider({ name: 'beta', label: 'Beta', apiKey: KEY_B, baseUrl: B.url, model: 'model-b', price: { input: 1, cached: 0.5, output: 2 }, ...over });
/** provider TÊN "gemini" (trỏ vào mock Alpha): áp chính sách riêng của Gemini — quota ngày reset 0h Pacific */
const provGemini = (over: Partial<ProviderConfig> = {}): ProviderConfig =>
  makeProvider({ name: 'gemini', label: 'Gemini', apiKey: KEY_A, baseUrl: A.url, model: 'gemini-mock', ...over });
const cfgWith = (providers: ProviderConfig[], over: Partial<Config> = {}): Config => withProviders({
  ...CONFIG, dailyBudgetUsd: 5, minSecondsBetweenLlm: 20, maxConcurrentLlm: 2, llmOnlyWhenWatched: false,
  offlineMinSeconds: 8, persist: false, timeMode: 'compressed', aiRouting: 'priority', ...over,
}, providers);
const log = { info: (m: string) => infos.push(m), warn: (m: string) => warned.push(m) };
const mkBrain = (providers: ProviderConfig[], over: Partial<Config> = {}, deadline = 3000, providerTimeoutMs?: number) => {
  const b = createBrain(cfgWith(providers, over), {
    now, quiet: true, log, deadlineMs: { scene: deadline, candidate: deadline, recap: deadline }, providerTimeoutMs,
  });
  b.setAudience(1);
  return b;
};
const statsOf = (u: UsageStats, name: string) => u.providers?.find((p) => p.name === name);
const countA = () => A.requests.length;
const countB = () => B.requests.length;

// agent thật từ World (offline) để prompt/sanitize chạy trên dữ liệu thật
const offCfg = cfgWith([]);
const seedWorld = new World({ config: offCfg, brain: createBrain(offCfg, { quiet: true, log }), emit: () => {} });
const agents = seedWorld.agents().map((a) => ({ ...a, present: true, activity: 'working' as const, activityLabel: 'đang code' }));
const ctx = makeCtx(agents);

// ---------------------------------------------------------------- 0. hàm thuần
section('0. Phân loại lỗi 429: Retry-After / quota ngày / quota phút');
{
  check('parseDurationMs("14m22.5s") = 862500', parseDurationMs('14m22.5s') === 862_500);
  check('parseDurationMs("1h 2m") = 3720000', parseDurationMs('1h 2m') === 3_720_000);
  check('messageRetryAfterMs("Please retry in 32.5s.")', messageRetryAfterMs('Please retry in 32.5s.') === 32_500);
  check('messageRetryAfterMs(Groq "try again in 14m22.5s.")', messageRetryAfterMs('Please try again in 14m22.5s. Need more tokens?') === 862_500);
  check('messageRetryAfterMs("try again in 20 seconds")', messageRetryAfterMs('Please try again in 20 seconds') === 20_000);
  check('messageRetryAfterMs(retryDelay: "27s")', messageRetryAfterMs('"retryDelay": "27s"') === 27_000);
  check('isDailyQuota: "requests per day (RPD)" → ngày', isDailyQuota('on requests per day (RPD): Limit 1000', 7_000_000));
  check('isDailyQuota: "per minute" → không', !isDailyQuota('on requests per minute (RPM): Limit 30', undefined));
  check('isDailyQuota: Gemini "exceeded your current quota" + retry 20 s → tạm thời', !isDailyQuota('You exceeded your current quota ... Please retry in 20.5s.', 20_500));
  check('isDailyQuota: Gemini "exceeded your current quota" không gợi ý → ngày', isDailyQuota('You exceeded your current quota, please check your plan and billing details.', undefined));
  check('isDailyQuota: "PerDay" (quotaId Gemini) → ngày', isDailyQuota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', 27_000));
  const c = classifyError(new LlmError('parse', 'x'));
  check('LlmError parse → content (không phạt provider)', c.kind === 'content');
}

// ---------------------------------------------------------------- 1. A ok
section('1. Alpha ổn → dùng Alpha, Beta không bị gọi');
{
  const b = mkBrain([provA(), provB()]);
  const a0 = countA(), b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  check('kết quả từ AI', r.source === 'llm' && r.lines.length >= 2);
  check('Alpha 1 request, Beta 0', countA() === a0 + 1 && countB() === b0);
  check('Bearer đúng key của Alpha', A.requests[a0]?.auth === `Bearer ${KEY_A}`);
  check('usage: activeProvider = Alpha, model = model-a, mode = llm', u.activeProvider === 'Alpha' && u.model === 'model-a' && u.mode === 'llm');
  check('usage.providers có 2 provider, đều sẵn sàng', u.providers?.length === 2 && u.providers.every((p) => p.enabled));
  check('thống kê Alpha: calls 1, rpdUsed 1, tpdUsed 1200', statsOf(u, 'alpha')?.calls === 1 && statsOf(u, 'alpha')?.rpdUsed === 1 && statsOf(u, 'alpha')?.tpdUsed === 1200);
  check('thống kê Beta: calls 0', statsOf(u, 'beta')?.calls === 0);
  check('pick(): Alpha đứng đầu', createRouter(cfgWith([provA(), provB()]), { now, quiet: true }).pick('scene', 'low')?.name === 'alpha');
}

// ---------------------------------------------------------------- 2. 429 Retry-After
section('2. Alpha 429 + Retry-After: 2 → sang Beta ngay trong request, 2 s sau dùng lại Alpha');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err429RetryAfter(2));
  const a0 = countA(), b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  let u = b.usage();
  const pa = statsOf(u, 'alpha');
  check('kết quả từ AI (Beta) ngay trong 1 request', r.source === 'llm' && countA() === a0 + 1 && countB() === b0 + 1);
  check('Alpha nghỉ đúng 2 s theo Retry-After', pa?.enabled === false && pa?.cooldownUntil === vt + 2000 && /429/.test(pa?.cooldownReason ?? ''), pa?.cooldownReason);
  check('activeProvider = Beta, mode vẫn llm, brain không tính là lỗi', u.activeProvider === 'Beta' && u.mode === 'llm' && u.failures === 0);
  check('Alpha failures 1, lastError có giờ', pa?.failures === 1 && /^\[\d\d:\d\d\]/.test(pa?.lastError ?? ''));
  const r2 = await b.generateScene(sceneReq(), ctx, 'llm');
  check('request tiếp theo: bỏ qua Alpha, đi thẳng Beta', r2.source === 'llm' && countA() === a0 + 1 && countB() === b0 + 2);
  vt += 2_100;
  const r3 = await b.generateScene(sceneReq(), ctx, 'llm');
  u = b.usage();
  check('sau 2 s: Alpha được dùng lại', r3.source === 'llm' && countA() === a0 + 2 && countB() === b0 + 2 && u.activeProvider === 'Alpha');
  check('Alpha sẵn sàng, không còn cooldown', statsOf(u, 'alpha')?.enabled === true && statsOf(u, 'alpha')?.cooldownUntil === 0);
  // 429 không có Retry-After → lùi dần 30 s, 60 s
  A.script.push((_r, res) => sendJson(res, 429, { error: { message: 'Too many requests', type: 'requests' } }));
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('429 không Retry-After: nghỉ 30 s', statsOf(b.usage(), 'alpha')?.cooldownUntil === vt + 30_000);
  vt += 30_001;
  A.script.push((_r, res) => sendJson(res, 429, { error: { message: 'Too many requests', type: 'requests' } }));
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('429 lần 2 liên tiếp: nghỉ 60 s (lùi dần)', statsOf(b.usage(), 'alpha')?.cooldownUntil === vt + 60_000);
  vt += 60_001;
  await b.generateScene(sceneReq(), ctx, 'llm'); // Alpha ok → reset lùi dần
  A.script.push((_r, res) => sendJson(res, 429, { error: { message: 'Too many requests', type: 'requests' } }));
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('thành công reset lùi dần: 429 kế tiếp lại nghỉ 30 s', statsOf(b.usage(), 'alpha')?.cooldownUntil === vt + 30_000);
}

// ---------------------------------------------------------------- 2b. 429 "Request too large" (Groq OTPM)
section('2b. 429 "Request too large" (Groq OTPM Limit 1000, Requested 1436): không nghỉ, hạ max_completion_tokens ≤ 900 rồi thử lại ngay cùng provider, nhớ qua snapshot');
{
  // Groq free tier: trần token RA mỗi phút theo model; "Requested" = min(max_tokens, ước lượng của máy chủ) → chỉ cần max_tokens ≤ Limit
  const otpm: Handler = (r, res) => {
    const max = Number(r.body.max_completion_tokens ?? r.body.max_tokens ?? 0);
    if (max > 1000) {
      sendJson(res, 429, { error: { message: 'Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1436. The request\'s expected output tokens exceed the enforced limit; reduce max_tokens (or the request\'s expected output) and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', type: 'tokens', code: 'rate_limit_exceeded' } });
      return;
    }
    smart(r, res);
  };
  const p1 = parseTooLarge('Request too large for model `x` on output tokens per minute (OTPM): Limit 1000, Requested 1436. reduce max_tokens');
  check('parseTooLarge: OTPM "Limit 1000, Requested 1436" → limit/requested đúng, output = true', !!p1 && p1.limit === 1000 && p1.requested === 1436 && p1.output);
  const p2 = parseTooLarge('Request too large for model `x` on tokens per minute (TPM): Limit 6000, Requested 6373, please reduce your message size and try again.');
  check('parseTooLarge: TPM "reduce your message size" → output = false', !!p2 && p2.limit === 6000 && p2.requested === 6373 && !p2.output);
  check('parseTooLarge: "Rate limit reached … Used 30, Requested 1" (hết lượt tạm thời) → null', parseTooLarge('Rate limit reached for model in organization on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 2s.') === null);
  const b = mkBrain([provA(), provB()]);
  const a0 = countA(), b0 = countB();
  A.script.push(otpm, otpm);
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  const pa = statsOf(u, 'alpha');
  const reqs = A.requests.slice(a0);
  check('Alpha trả lời ngay trong 1 request sau 2 lượt (429 rồi OK), Beta không bị gọi', r.source === 'llm' && countA() === a0 + 2 && countB() === b0, `A +${countA() - a0}, B +${countB() - b0}, source ${r.source}`);
  check('lượt 1 gửi max_completion_tokens mặc định của cảnh (> 1000)', Number(reqs[0]?.body.max_completion_tokens) > 1000, String(reqs[0]?.body.max_completion_tokens));
  check('lượt 2 hạ xuống 900 (90% của Limit 1000)', Number(reqs[1]?.body.max_completion_tokens) === 900, String(reqs[1]?.body.max_completion_tokens));
  check('Alpha không bị nghỉ (cooldown 0, vẫn sẵn sàng), brain không tính là lỗi', pa?.enabled === true && pa?.cooldownUntil === 0 && u.failures === 0, pa?.cooldownReason);
  check('có cảnh báo tiếng Việt về trần token ra', warned.some((w) => /OTPM 1000/.test(w) && /max_completion_tokens ≤ 900/.test(w)));
  const r2 = await b.generateScene(sceneReq(), ctx, 'llm');
  check('request sau: nhớ trần, gửi thẳng max 900 trong 1 lượt', r2.source === 'llm' && countA() === a0 + 3 && Number(A.requests[a0 + 2]?.body.max_completion_tokens) === 900);
  const snap = b.serialize();
  const b2 = mkBrain([provA(), provB()]);
  b2.restore(snap);
  await b2.generateScene(sceneReq(), ctx, 'llm');
  check('khôi phục từ snapshot: trần token ra vẫn còn (max 900)', Number(A.requests[a0 + 3]?.body.max_completion_tokens) === 900, String(A.requests[a0 + 3]?.body.max_completion_tokens));
  // TPM (tổng token) không đọc được Limit → giảm một nửa rồi thử lại; trần quá nhỏ → bỏ provider cho request này, không nghỉ
  const b3 = mkBrain([provA(), provB()]);
  const a3 = countA(), b3n = countB();
  const tooSmall: Handler = (_r, res) => sendJson(res, 429, { error: { message: 'Request too large for model `x` on tokens per minute (TPM): Limit 2000, Requested 9000, please reduce your message size and try again.', type: 'tokens', code: 'rate_limit_exceeded' } });
  A.script.push(tooSmall);
  const r3 = await b3.generateScene(sceneReq(), ctx, 'llm');
  check('TPM vượt quá xa (trần < 256): bỏ Alpha cho request này → Beta trả lời, Alpha không nghỉ', r3.source === 'llm' && countA() === a3 + 1 && countB() === b3n + 1 && statsOf(b3.usage(), 'alpha')?.cooldownUntil === 0, statsOf(b3.usage(), 'alpha')?.cooldownReason);
}

// ---------------------------------------------------------------- 3. quota ngày
section('3. 429 quota NGÀY: tin gợi ý của máy chủ; không có gợi ý → Gemini nghỉ tới 0h Pacific, provider khác dò lại sau 1 giờ');
{
  const midnight = nextLocalMidnight(vt);
  check('nextLocalMidnight > now và là 0h giờ VN', midnight > vt && midnight - vt <= 86_400_000 && new Date(midnight).toLocaleTimeString('en-GB', { timeZone: VN_TZ }) === '00:00:00');
  const midnightLA = nextMidnightIn(PACIFIC_TZ, vt);
  // ngày đổi giờ (PDT→PST) dài 25 h nên khoảng cách có thể > 24 h
  check('nextMidnightIn(Pacific) > now, ≤ 25 h, đúng 0h giờ Pacific', midnightLA > vt && midnightLA - vt <= 25 * 3_600_000 && new Date(midnightLA).toLocaleTimeString('en-GB', { timeZone: PACIFIC_TZ }) === '00:00:00', `${((midnightLA - vt) / 3_600_000).toFixed(2)} h`);
  // ngày đổi giờ ở Mỹ: 2026-03-08 (PST→PDT) và 2026-11-01 (PDT→PST) vẫn ra 0h
  for (const iso of ['2026-03-08T12:00:00-08:00', '2026-11-01T01:30:00-07:00', '2026-11-01T01:30:00-08:00']) {
    const m = nextMidnightIn(PACIFIC_TZ, Date.parse(iso));
    const d = new Date(m).toLocaleString('en-GB', { timeZone: PACIFIC_TZ });
    check(`nextMidnightIn(Pacific, ${iso}) = 0h ngày kế tiếp`, /00:00:00$/.test(d) && dateKeyIn(PACIFIC_TZ, new Date(m)) !== dateKeyIn(PACIFIC_TZ, new Date(Date.parse(iso))), d);
  }
  check('quotaResetTz: gemini → Pacific, groq/openai/alpha → VN', quotaResetTz({ name: 'gemini' }) === PACIFIC_TZ && quotaResetTz({ name: 'x', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' }) === PACIFIC_TZ && quotaResetTz({ name: 'groq' }) === VN_TZ && quotaResetTz({ name: 'alpha', baseUrl: A.url }) === VN_TZ);
  const ONE_HOUR = 3_600_000;
  const geminiWait = Math.min(midnightLA - vt, 6 * ONE_HOUR); // chờ tới 0h Pacific, dò lại tối đa mỗi 6 giờ

  const b = mkBrain([provA(), provB()]);
  A.script.push(err429Daily);
  const b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const pa = statsOf(b.usage(), 'alpha');
  check('Groq "requests per day (RPD)... try again in 2h13m4.5s": nghỉ đúng 2h13m4.5s theo máy chủ, Beta trả lời', r.source === 'llm' && countB() === b0 + 1 && pa?.cooldownUntil === vt + 7_984_500 && /quota ngày/.test(pa?.cooldownReason ?? ''), pa?.cooldownReason);
  const b2 = mkBrain([provA(), provB()]);
  A.script.push(err429GeminiMinute);
  await b2.generateScene(sceneReq(), ctx, 'llm');
  check('Gemini "exceeded your current quota ... retry in 20.5s": chỉ nghỉ 20.5 s', statsOf(b2.usage(), 'alpha')?.cooldownUntil === vt + 20_500);
  const b3 = mkBrain([provA(), provB()]);
  A.script.push(err429GeminiDaily);
  await b3.generateScene(sceneReq(), ctx, 'llm');
  check('"exceeded your current quota" không gợi ý chờ, provider không rõ giờ reset: dò lại sau 1 giờ', statsOf(b3.usage(), 'alpha')?.cooldownUntil === vt + ONE_HOUR && /1 giờ/.test(statsOf(b3.usage(), 'alpha')?.cooldownReason ?? ''), statsOf(b3.usage(), 'alpha')?.cooldownReason);
  const b3g = mkBrain([provGemini(), provB()]);
  A.script.push(err429GeminiDaily);
  await b3g.generateScene(sceneReq(), ctx, 'llm');
  const pg = statsOf(b3g.usage(), 'gemini');
  check('provider gemini, không gợi ý chờ: nghỉ tới 0h giờ Pacific (không phải 0h VN)', pg?.cooldownUntil === vt + geminiWait && /Pacific/.test(pg?.cooldownReason ?? ''), pg?.cooldownReason);
  const b3h = mkBrain([provGemini(), provB()]);
  A.script.push(err429GeminiDailyArray);
  const bh = countB();
  const rh = await b3h.generateScene(sceneReq(), ctx, 'llm');
  const ph = statsOf(b3h.usage(), 'gemini');
  check('body THẬT dạng mảng (PerDay + "retry in 27.08s"): bóc mảng, gợi ý 27 s không đáng tin → 0h Pacific, Beta trả lời', rh.source === 'llm' && countB() === bh + 1 && ph?.cooldownUntil === vt + geminiWait && /Pacific/.test(ph?.cooldownReason ?? ''), ph?.cooldownReason);
  check('body dạng mảng: lastError có nội dung thật (quota), không còn "(no body)"', /quota/i.test(ph?.lastError ?? '') && !/no body/.test(ph?.lastError ?? ''), ph?.lastError);
  const b4 = mkBrain([provA(), provB()]);
  A.script.push(err429GroqTpd);
  await b4.generateScene(sceneReq(), ctx, 'llm');
  check('Groq "tokens per day (TPD)" + Retry-After 862: tin máy chủ → nghỉ 862 s, không khoá tới 0h', statsOf(b4.usage(), 'alpha')?.cooldownUntil === vt + 862_000, statsOf(b4.usage(), 'alpha')?.cooldownReason);
  check('đang nghỉ vẫn mode llm nhờ Beta', b4.usage().mode === 'llm' && b4.usage().activeProvider === 'Beta');
  // Gemini báo quota ngày kèm gợi ý dài (≥ 10 phút) → tin gợi ý
  const b5 = mkBrain([provGemini(), provB()]);
  A.script.push((_r, res) => sendJson(res, 429, [{ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests (GenerateRequestsPerDayPerProjectPerModel). Please retry in 45m.', status: 'RESOURCE_EXHAUSTED' } }]));
  await b5.generateScene(sceneReq(), ctx, 'llm');
  check('gemini quota ngày + gợi ý 45 phút (≥ 10 phút): tin gợi ý', statsOf(b5.usage(), 'gemini')?.cooldownUntil === vt + 45 * 60_000, statsOf(b5.usage(), 'gemini')?.cooldownReason);
}

// ---------------------------------------------------------------- 4. TPD / RPM / RPD
section('4. Giới hạn TPD / RPM / RPD của từng provider');
{
  const b = mkBrain([provA({ tpd: 2000 }), provB()]);
  const a0 = countA(), b0 = countB();
  await b.generateScene(sceneReq(), ctx, 'llm'); // 1200 token
  check('TPD: sau 1200/2000 token Alpha vẫn sẵn sàng', statsOf(b.usage(), 'alpha')?.enabled === true);
  await b.generateScene(sceneReq(), ctx, 'llm'); // 2400 token
  const pa = statsOf(b.usage(), 'alpha');
  check('TPD: 2400/2000 → Alpha hết token hôm nay', pa?.enabled === false && /TPD/.test(pa?.cooldownReason ?? '') && pa?.tpdUsed === 2400 && pa?.tpdLimit === 2000 && pa?.cooldownUntil === nextLocalMidnight(vt), pa?.cooldownReason);
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('TPD: request kế tiếp sang Beta', countA() === a0 + 2 && countB() === b0 + 1);

  const b2 = mkBrain([provA({ rpm: 2 }), provB()]);
  const a1 = countA(), b1 = countB();
  await b2.generateScene(sceneReq(), ctx, 'llm');
  await b2.generateScene(sceneReq(), ctx, 'llm');
  await b2.generateScene(sceneReq(), ctx, 'llm');
  check('RPM 2: 2 request vào Alpha, request thứ 3 sang Beta', countA() === a1 + 2 && countB() === b1 + 1);
  check('RPM: lý do "lượt/phút"', /lượt\/phút/.test(statsOf(b2.usage(), 'alpha')?.cooldownReason ?? ''));
  vt += 60_001;
  await b2.generateScene(sceneReq(), ctx, 'llm');
  check('RPM: sau 60 s Alpha lại nhận request', countA() === a1 + 3);

  const b3 = mkBrain([provA({ rpd: 1 }), provB()]);
  const a2 = countA(), b2c = countB();
  await b3.generateScene(sceneReq(), ctx, 'llm');
  await b3.generateScene(sceneReq(), ctx, 'llm');
  const pa3 = statsOf(b3.usage(), 'alpha');
  check('RPD 1: request 2 sang Beta; Alpha báo hết lượt tới 0h', countA() === a2 + 1 && countB() === b2c + 1 && pa3?.rpdUsed === 1 && pa3?.rpdLimit === 1 && /RPD/.test(pa3?.cooldownReason ?? '') && pa3?.cooldownUntil === nextLocalMidnight(vt));
  vt = nextLocalMidnight(vt) + 1_000;
  await b3.generateScene(sceneReq(), ctx, 'llm');
  check('RPD: sang ngày mới (giờ VN) Alpha được dùng lại, bộ đếm reset', countA() === a2 + 2 && statsOf(b3.usage(), 'alpha')?.rpdUsed === 1);

  const b4 = mkBrain([provA({ rpd: 3 }), provB()]);
  A.script.push(err500);
  await b4.generateScene(sceneReq(), ctx, 'llm');
  const pa4 = statsOf(b4.usage(), 'alpha');
  check('RPD đếm cả request lỗi (500)', pa4?.rpdUsed === 1 && pa4?.calls === 1 && pa4?.failures === 1 && pa4?.tpdUsed === 0);

  // Gemini: ngày tính theo giờ Pacific (Google reset quota lúc 0h Pacific = 14–15h giờ VN)
  const b5 = mkBrain([provGemini({ rpd: 1 }), provB()]);
  const a5 = countA(), b5c = countB();
  await b5.generateScene(sceneReq(), ctx, 'llm');
  await b5.generateScene(sceneReq(), ctx, 'llm');
  const pg5 = statsOf(b5.usage(), 'gemini');
  const laMidnight = nextMidnightIn(PACIFIC_TZ, vt);
  check('Gemini RPD 1: hết lượt tới 0h giờ Pacific, request 2 sang Beta', countA() === a5 + 1 && countB() === b5c + 1 && pg5?.cooldownUntil === laMidnight && /RPD/.test(pg5?.cooldownReason ?? ''), pg5?.cooldownReason);
  const snap5 = JSON.parse(JSON.stringify(b5.serialize()));
  check('snapshot ghi "ngày" riêng của Gemini theo Pacific', snap5.router.providers.gemini.day === dateKeyIn(PACIFIC_TZ, new Date(vt)));
  const saveVt = vt;
  vt = laMidnight + 1_000;
  await b5.generateScene(sceneReq(), ctx, 'llm');
  check('qua 0h Pacific: Gemini dùng lại, bộ đếm reset', countA() === a5 + 2 && statsOf(b5.usage(), 'gemini')?.rpdUsed === 1);
  // khôi phục snapshot cũ sau khi Gemini đã sang ngày mới (dù ngày VN có thể chưa đổi) → RPD về 0
  const b6 = mkBrain([provGemini({ rpd: 1 }), provB()]);
  b6.restore(snap5);
  check('restore sau 0h Pacific: rpdUsed của Gemini = 0 (không mang số cũ sang ngày mới)', statsOf(b6.usage(), 'gemini')?.rpdUsed === 0 && statsOf(b6.usage(), 'gemini')?.enabled === true);
  vt = saveVt;
}

// ---------------------------------------------------------------- 5. 401
section('5. Alpha 401 → tắt 1 giờ với lý do rõ, Beta thay; key không lộ');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err401);
  const b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  const pa = statsOf(u, 'alpha');
  check('Beta trả lời thay', r.source === 'llm' && countB() === b0 + 1);
  check('Alpha tắt đúng 60 phút', pa?.enabled === false && pa?.cooldownUntil === vt + 3_600_000);
  check('lý do tiếng Việt, chỉ rõ biến AI_ALPHA_API_KEY', /API key sai hoặc hết hạn \(401\)/.test(pa?.cooldownReason ?? '') && /AI_ALPHA_API_KEY/.test(pa?.cooldownReason ?? ''), pa?.cooldownReason);
  check('lastError của Alpha có giải thích, không lộ key', /API key/.test(pa?.lastError ?? '') && !leaks(pa?.lastError ?? ''), pa?.lastError);
  check('log cảnh báo có nhắc Alpha + API key, không lộ key', warned.some((w) => /Alpha/.test(w) && /API key/.test(w)) && !warned.some(leaks));
  // Gemini trả 400 khi key sai
  const b2 = mkBrain([provA(), provB()]);
  A.script.push((_r, res) => sendJson(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }));
  await b2.generateScene(sceneReq(), ctx, 'llm');
  const pa2 = statsOf(b2.usage(), 'alpha');
  check('Gemini 400 "API key not valid" → cũng coi là sai key, tắt 1 giờ', pa2?.cooldownUntil === vt + 3_600_000 && /API key/.test(pa2?.cooldownReason ?? ''), pa2?.cooldownReason);
  // body thật dò bằng key giả: MẢNG + "Please pass a valid API key"
  const b2g = mkBrain([provGemini(), provB()]);
  A.script.push(err400GeminiKeyArray);
  const bg0 = countB();
  const rg = await b2g.generateScene(sceneReq(), ctx, 'llm');
  const pg = statsOf(b2g.usage(), 'gemini');
  check('Gemini body MẢNG "Please pass a valid API key" → sai key: tắt 1 giờ, nhắc AI_GEMINI_API_KEY, Beta trả lời', rg.source === 'llm' && countB() === bg0 + 1 && pg?.cooldownUntil === vt + 3_600_000 && /AI_GEMINI_API_KEY/.test(pg?.cooldownReason ?? ''), pg?.cooldownReason);
  check('sai key không bị hiểu nhầm thành "không nhận json_schema" (giữ json_schema, chỉ 1 request)', pg?.format === 'json_schema' && pg?.calls === 1);
  check('lastError nêu API key, không còn "(no body)"', /API key/i.test(pg?.lastError ?? '') && !/no body/.test(pg?.lastError ?? ''), pg?.lastError);
  const snapG = JSON.parse(JSON.stringify(b2g.serialize()));
  check('snapshot không ghi nhớ json_object sau lỗi sai key', snapG.router.providers.gemini.jsonObjectUntil === 0);
  // 404 model
  const b3 = mkBrain([provA(), provB()]);
  A.script.push((_r, res) => sendJson(res, 404, { error: { message: 'The model `model-a` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }));
  await b3.generateScene(sceneReq(), ctx, 'llm');
  const pa3 = statsOf(b3.usage(), 'alpha');
  check('404 model → tắt 1 giờ, lý do nêu tên model + AI_ALPHA_MODEL', pa3?.cooldownUntil === vt + 3_600_000 && /model-a/.test(pa3?.cooldownReason ?? '') && /AI_ALPHA_MODEL/.test(pa3?.cooldownReason ?? ''), pa3?.cooldownReason);
}

// ---------------------------------------------------------------- 6. 500 failover
section('6. Alpha 500 → Beta trả lời ngay trong cùng request; lùi dần 20 s → 40 s, thành công thì reset');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err500);
  const a0 = countA(), b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  check('1 request Alpha + 1 request Beta, kết quả llm', r.source === 'llm' && countA() === a0 + 1 && countB() === b0 + 1);
  check('Alpha nghỉ 20 s, lý do "máy chủ lỗi (500)"', statsOf(u, 'alpha')?.cooldownUntil === vt + 20_000 && /máy chủ lỗi \(500\)/.test(statsOf(u, 'alpha')?.cooldownReason ?? ''));
  check('brain không tính lỗi (request thành công), lastError trống', u.failures === 0 && u.lastError === undefined);
  vt += 20_001;
  A.script.push(err500);
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('500 lần 2 liên tiếp: nghỉ 40 s', statsOf(b.usage(), 'alpha')?.cooldownUntil === vt + 40_000);
  vt += 40_001;
  await b.generateScene(sceneReq(), ctx, 'llm'); // Alpha ok
  A.script.push(err500);
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('thành công reset: 500 kế tiếp lại nghỉ 20 s', statsOf(b.usage(), 'alpha')?.cooldownUntil === vt + 20_000);
  // mạng: provider trỏ vào cổng không ai nghe
  const dead = makeProvider({ name: 'dead', label: 'Dead', apiKey: 'sk-dead-SECRETKEY-000000000000', baseUrl: 'http://127.0.0.1:4699/v1', model: 'x' });
  const b2 = mkBrain([dead, provB()]);
  const b1 = countB();
  const r2 = await b2.generateScene(sceneReq(), ctx, 'llm');
  const pd = statsOf(b2.usage(), 'dead');
  check('không kết nối được → nghỉ 20 s, Beta trả lời', r2.source === 'llm' && countB() === b1 + 1 && pd?.enabled === false && /không kết nối/.test(pd?.cooldownReason ?? ''), pd?.cooldownReason);
  // treo hết cả cửa sổ riêng (1.5 s < hạn chót 3 s) → phạt 20 s; hết hạn chót → không thử Beta nữa, không treo
  const b3 = mkBrain([provA(), provB()], {}, 3000, 1500);
  A.script.push(hang);
  const b2c = countB();
  const t0 = Date.now();
  const r3 = await b3.generateScene(sceneReq(), ctx, 'llm');
  const ms = Date.now() - t0;
  check('Alpha treo → hết cửa sổ 1.5 s → offline, Beta không bị gọi vì không còn đủ giờ', r3.source === 'offline' && ms >= 1_200 && ms < 6_000 && countB() === b2c, `${ms} ms`);
  check('timeout trọn cửa sổ → Alpha nghỉ 20 s', /quá thời gian/.test(statsOf(b3.usage(), 'alpha')?.cooldownReason ?? '') && statsOf(b3.usage(), 'alpha')?.cooldownUntil === vt + 20_000, statsOf(b3.usage(), 'alpha')?.cooldownReason);
  // cửa sổ bị CẮT NGẮN bởi hạn chót: A trả JSON hỏng sau 0.5 s, B chỉ còn ~3 s (thay vì 20 s) và treo → KHÔNG phạt B
  const b4 = mkBrain([provA(), provB()], {}, 4000);
  A.script.push((r, res) => { setTimeout(() => badJson(r, res), 500); });
  B.script.push(hang);
  const a4 = countA(), b4c = countB();
  const r4 = await b4.generateScene(sceneReq(), ctx, 'llm');
  const pb4 = statsOf(b4.usage(), 'beta');
  check('A JSON hỏng → B được thử trong phần giờ còn lại, B treo → offline', r4.source === 'offline' && countA() === a4 + 1 && countB() === b4c + 1);
  check('B hết giờ trong cửa sổ bị cắt ngắn → không cooldown, không lùi dần (failures vẫn đếm)', pb4?.enabled === true && pb4?.cooldownUntil === 0 && pb4?.failures === 1, pb4?.cooldownReason);
  check('lỗi request ghi rõ "không phạt"', /không phạt/.test(b4.usage().lastError ?? '') && b4.usage().failures === 1, b4.usage().lastError);
  A.script.push(err500);
  const r5 = await b4.generateScene(sceneReq(), ctx, 'llm');
  check('request kế tiếp: B không bị bỏ qua, trả lời ngay', r5.source === 'llm' && countB() === b4c + 2);
  const snap4 = JSON.parse(JSON.stringify(b4.serialize()));
  check('snapshot: backoffServer của B = 0', snap4.router.providers.beta.backoffServer === 0);
}

// ---------------------------------------------------------------- 7. json_schema → json_object
section('7. Alpha 400 với json_schema → thử lại json_object, nhớ cho lần sau, lưu qua restore');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err400Schema);
  const a0 = countA(), b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  check('2 request vào Alpha: json_schema rồi json_object; Beta 0', r.source === 'llm' && countA() === a0 + 2 && countB() === b0 && formatOf(A.requests[a0]) === 'json_schema' && formatOf(A.requests[a0 + 1]) === 'json_object');
  check('stats Alpha: format json_object, không cooldown', statsOf(b.usage(), 'alpha')?.format === 'json_object' && statsOf(b.usage(), 'alpha')?.enabled === true);
  await b.generateScene(sceneReq(), ctx, 'llm');
  check('request sau đi thẳng json_object', countA() === a0 + 3 && formatOf(A.requests[a0 + 2]) === 'json_object');
  const snap = JSON.parse(JSON.stringify(b.serialize()));
  const b2 = mkBrain([provA(), provB()]);
  b2.restore(snap);
  await b2.generateScene(sceneReq(), ctx, 'llm');
  check('sau restore vẫn nhớ json_object', statsOf(b2.usage(), 'alpha')?.format === 'json_object' && formatOf(A.requests[a0 + 3]) === 'json_object');
  // AI_X_JSON=object: dùng thẳng json_object
  const b3 = mkBrain([provA({ json: 'object' }), provB()]);
  await b3.generateScene(sceneReq(), ctx, 'llm');
  check('cấu hình json: object → gửi json_object ngay từ đầu', formatOf(A.requests[countA() - 1]) === 'json_object');
  // tham số tuỳ chọn bị từ chối (temperature) → bỏ và thử lại cùng định dạng
  const b4 = mkBrain([provA(), provB()]);
  A.script.push((r, res) => {
    if ('temperature' in r.body) sendJson(res, 400, { error: { message: "Unsupported value: 'temperature' does not support 1 with this model.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } });
    else smart(r, res);
  });
  const a4 = countA();
  const r4 = await b4.generateScene(sceneReq(), ctx, 'llm');
  check('400 vì temperature → bỏ tham số, thử lại cùng json_schema', r4.source === 'llm' && countA() === a4 + 2 && !('temperature' in A.requests[a4 + 1].body) && formatOf(A.requests[a4 + 1]) === 'json_schema');
  // Groq json_validate_failed: model viết JSON lệch schema → lỗi NỘI DUNG: không hạ json_object, không cooldown, sang Beta
  const b5 = mkBrain([provA(), provB()]);
  A.script.push(err400GroqJsonValidate);
  const a5 = countA(), b5c = countB();
  const r5 = await b5.generateScene(sceneReq(), ctx, 'llm');
  const pa5 = statsOf(b5.usage(), 'alpha');
  check('json_validate_failed: Alpha giữ json_schema, không cooldown; Beta trả lời ngay trong request', r5.source === 'llm' && countA() === a5 + 1 && countB() === b5c + 1 && pa5?.format === 'json_schema' && pa5?.enabled === true && pa5?.cooldownUntil === 0, pa5?.cooldownReason);
  check('json_validate_failed: lastError nói JSON không khớp schema; brain không tính lỗi', /schema/i.test(pa5?.lastError ?? '') && pa5?.failures === 1 && b5.usage().failures === 0, pa5?.lastError);
  await b5.generateScene(sceneReq(), ctx, 'llm');
  check('request sau vẫn gửi json_schema cho Alpha', countA() === a5 + 2 && formatOf(A.requests[a5 + 1]) === 'json_schema');
  // 400 không liên quan response_format/schema → phạt "request bị từ chối" 20 s, KHÔNG đổi định dạng
  const b6 = mkBrain([provA(), provB()]);
  A.script.push((_r, res) => sendJson(res, 400, { error: { message: "Invalid 'messages[1].content': string too long. Expected a string with maximum length 1048576, but got a string with length 1200000 instead.", type: 'invalid_request_error', param: 'messages[1].content', code: 'string_above_max_length' } }));
  const a6 = countA();
  await b6.generateScene(sceneReq(), ctx, 'llm');
  const pa6 = statsOf(b6.usage(), 'alpha');
  check('400 lạ: giữ json_schema (không thử lại json_object), nghỉ 20 s "request bị từ chối (400)"', countA() === a6 + 1 && pa6?.format === 'json_schema' && pa6?.cooldownUntil === vt + 20_000 && /từ chối \(400\)/.test(pa6?.cooldownReason ?? ''), pa6?.cooldownReason);
  const snap6 = JSON.parse(JSON.stringify(b6.serialize()));
  check('snapshot không ghi nhớ json_object cho 400 lạ', snap6.router.providers.alpha.jsonObjectUntil === 0);
}

// ---------------------------------------------------------------- 8. cả hai chết
section('8. Cả hai provider lỗi → offline, reserve() theo nhịp offline; cầu dao chỉ mở khi MỌI provider thất bại');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err500);
  B.script.push(err500);
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  check('thoại offline, failures 1', r.source === 'offline' && r.lines.length >= 2 && u.failures === 1);
  check('lastError nêu cả Alpha và Beta', /Alpha/.test(u.lastError ?? '') && /Beta/.test(u.lastError ?? ''), u.lastError);
  check('cả hai nghỉ → usage().mode = offline, mode() = llm', u.mode === 'offline' && b.mode() === 'llm' && u.providers?.every((p) => !p.enabled) === true);
  check('reserve: high → offline', b.reserve('high') === 'offline');
  const r1 = b.reserve('low');
  const r2 = b.reserve('low');
  check('reserve: low theo nhịp offline (8 s): lần 1 offline, lần 2 null', r1 === null && r2 === null || (r1 === 'offline' && r2 === null));
  vt += 8_001;
  check('reserve: sau 8 s low lại được offline', b.reserve('low') === 'offline');
  const a0 = countA(), b0 = countB();
  const r3 = await b.generateScene(sceneReq(), ctx, 'llm');
  check('đang nghỉ: không gọi HTTP', r3.source === 'offline' && countA() === a0 && countB() === b0);
  vt += 20_001;
  check('hết nghỉ: mode llm trở lại', b.usage().mode === 'llm');

  // cầu dao: 1 provider hỏng nhưng provider kia ổn → KHÔNG mở
  const b2 = mkBrain([provA(), provB()]);
  for (let i = 0; i < 4; i++) { A.script.push(badJson); await b2.generateScene(sceneReq(), ctx, 'llm'); }
  const a1 = countA(), b1 = countB();
  const r4 = await b2.generateScene(sceneReq(), ctx, 'llm');
  check('Alpha JSON hỏng 4 lần nhưng Beta ổn → không cầu dao, vẫn gọi AI', r4.source === 'llm' && b2.usage().failures === 0 && countA() === a1 + 1 && countB() === b1 && b2.usage().mode === 'llm');
  // cả hai JSON hỏng 3 request liên tiếp → cầu dao mở 60 s
  const b3 = mkBrain([provA(), provB()]);
  for (let i = 0; i < 3; i++) { A.script.push(badJson); B.script.push(badJson); await b3.generateScene(sceneReq(), ctx, 'llm'); }
  const a2 = countA(), b2c = countB();
  const r5 = await b3.generateScene(sceneReq(), ctx, 'llm');
  check('cả hai hỏng 3 lần liên tiếp → cầu dao mở: không gọi HTTP', r5.source === 'offline' && countA() === a2 && countB() === b2c && b3.usage().failures === 3);
  check('cầu dao mở → usage().mode offline, reserve high → offline', b3.usage().mode === 'offline' && b3.reserve('high') === 'offline');
  vt += 61_000;
  const r6 = await b3.generateScene(sceneReq(), ctx, 'llm');
  check('hết 60 s: gọi lại AI (JSON hỏng không làm provider nghỉ)', r6.source === 'llm' && countA() === a2 + 1);
}

// ---------------------------------------------------------------- 9. tier strong
section('9. Tier strong được ưu tiên cho cảnh high / ứng viên / bản tin');
{
  const b = mkBrain([provA(), provB({ tier: 'strong' })]);
  let a0 = countA(), b0 = countB();
  await b.generateScene(sceneReq({ priority: 'low' }), ctx, 'llm');
  check('cảnh low → Alpha', countA() === a0 + 1 && countB() === b0);
  a0 = countA(); b0 = countB();
  await b.generateScene(sceneReq({ priority: 'normal' }), ctx, 'llm');
  check('cảnh normal → Alpha', countA() === a0 + 1 && countB() === b0);
  a0 = countA(); b0 = countB();
  await b.generateScene(sceneReq({ priority: 'high', type: 'firing' }), ctx, 'llm');
  check('cảnh high → Beta (strong)', countA() === a0 && countB() === b0 + 1);
  a0 = countA(); b0 = countB();
  currentTask = 'candidate';
  const cand = await b.generateCandidate(CAND, ctx);
  check('ứng viên → Beta (strong)', !!cand.name && countA() === a0 && countB() === b0 + 1);
  a0 = countA(); b0 = countB();
  currentTask = 'recap';
  const recap = await b.generateRecap(RECAP, ctx);
  check('bản tin → Beta (strong)', recap.source === 'llm' && countA() === a0 && countB() === b0 + 1);
  currentTask = 'scene';
  // strong đang nghỉ → high rơi về Alpha
  B.script.push(err500);
  a0 = countA(); b0 = countB();
  const r = await b.generateScene(sceneReq({ priority: 'high' }), ctx, 'llm');
  check('Beta lỗi → high rơi về Alpha ngay trong request', r.source === 'llm' && countB() === b0 + 1 && countA() === a0 + 1);
  check('pick(scene, high) với Beta đang nghỉ = Alpha', createRouter(cfgWith([provA(), provB({ tier: 'strong' })]), { now, quiet: true }).pick('scene', 'high')?.name === 'beta');
}

// ---------------------------------------------------------------- 10. thống kê + lưu/khôi phục
section('10. Gộp thống kê theo giá từng provider; serialize/restore qua "khởi động lại"');
{
  const b = mkBrain([provA(), provB()]);
  await b.generateScene(sceneReq(), ctx, 'llm');        // Alpha: 1000/200, giá 0
  A.script.push(err500);
  await b.generateScene(sceneReq(), ctx, 'llm');        // Alpha 500 (không usage) → Beta: 1000/200, giá 1/2 → $0.0014
  const u = b.usage();
  check('tổng calls = 3 (Alpha 2 kể cả lỗi + Beta 1)', u.calls === 3 && statsOf(u, 'alpha')?.calls === 2 && statsOf(u, 'beta')?.calls === 1);
  check('tổng token = 2000 vào / 400 ra', u.inputTokens === 2000 && u.outputTokens === 400 && u.cachedTokens === 0);
  check('chi phí theo giá riêng: Alpha $0, Beta $0.0014, tổng $0.0014', near(statsOf(u, 'alpha')?.costTodayUsd ?? -1, 0) && near(statsOf(u, 'beta')?.costTodayUsd ?? -1, 0.0014) && near(u.costTodayUsd, 0.0014) && near(u.costTotalUsd, 0.0014));
  check('brain.failures = 0 (request đều thành công), Alpha.failures = 1', u.failures === 0 && statsOf(u, 'alpha')?.failures === 1);
  const snap = JSON.parse(JSON.stringify(b.serialize()));
  check('snapshot không chứa key', !leaks(JSON.stringify(snap)));
  const b2 = mkBrain([provA(), provB()]);
  b2.restore(snap);
  const u2 = b2.usage();
  check('restore: tổng calls/token/chi phí giữ nguyên', u2.calls === 3 && u2.inputTokens === 2000 && u2.outputTokens === 400 && near(u2.costTodayUsd, 0.0014) && near(u2.costTotalUsd, 0.0014));
  check('restore: rpdUsed/tpdUsed/cooldown của từng provider giữ nguyên', statsOf(u2, 'alpha')?.rpdUsed === 2 && statsOf(u2, 'alpha')?.tpdUsed === 1200 && statsOf(u2, 'alpha')?.cooldownUntil === statsOf(u, 'alpha')?.cooldownUntil && statsOf(u2, 'beta')?.rpdUsed === 1);
  check('restore: activeProvider theo provider sẵn sàng (Beta vì Alpha đang nghỉ)', u2.activeProvider === 'Beta' && u2.model === 'model-b');
  b2.restore('rác');
  b2.restore({ v: 2, router: { providers: 'x' } });
  b2.restore({ v: 2, router: { v: 2, date: localDateKey(new Date(vt)), providers: { alpha: { calls: 'abc', cooldownUntil: 1e18, jsonObjectUntil: -5, rpdUsed: Infinity } } } });
  const u3 = b2.usage();
  check('restore dữ liệu rác: không đổ, số liệu hợp lý', u3.calls >= 1 && (statsOf(u3, 'alpha')?.cooldownUntil ?? 0) < vt + 86_400_000 && statsOf(u3, 'alpha')?.format === 'json_schema');
  // snapshot v1 (bản cũ, 1 provider) vẫn đọc được
  const b3 = mkBrain([provA(), provB()]);
  b3.restore({ v: 1, date: localDateKey(new Date(vt)), costTodayUsd: 0.5, costTotalUsd: 1.5, calls: 7, inputTokens: 100, cachedTokens: 10, outputTokens: 20, failures: 2, skipped: 3 });
  const u4 = b3.usage();
  check('snapshot v1: tổng gộp được giữ (calls 7, $0.5 hôm nay / $1.5 tổng, failures 2, skipped 3)', u4.calls === 7 && near(u4.costTodayUsd, 0.5) && near(u4.costTotalUsd, 1.5) && u4.failures === 2 && u4.skipped === 3);
  // provider bị gỡ khỏi cấu hình → tổng không tụt
  const b4 = mkBrain([provA()]);
  b4.restore(snap);
  check('gỡ Beta khỏi cấu hình: tổng calls/chi phí vẫn giữ (gộp vào carry)', b4.usage().calls === 3 && near(b4.usage().costTotalUsd, 0.0014));
  // sang ngày mới: chi phí hôm nay / RPD về 0, tổng giữ
  const b5 = mkBrain([provA(), provB()]);
  const saveVt = vt;
  vt = nextLocalMidnight(vt) + 5_000;
  b5.restore(snap);
  const u5 = b5.usage();
  check('restore sang ngày mới: chi phí hôm nay 0, RPD 0, tổng giữ', near(u5.costTodayUsd, 0) && near(u5.costTotalUsd, 0.0014) && statsOf(u5, 'alpha')?.rpdUsed === 0 && u5.calls === 3);
  vt = saveVt;
}

// ---------------------------------------------------------------- 11. cấu hình kiểu cũ
section('11. Cấu hình OPENAI_* kiểu cũ vẫn ra 1 provider chạy được; đọc AI_PROVIDERS');
{
  const legacy = buildProviders({ OPENAI_API_KEY: KEY_A, OPENAI_BASE_URL: A.url, OPENAI_MODEL: 'gpt-4o-mini' });
  check('OPENAI_* → 1 provider "openai", giá gpt-4o-mini', legacy.legacy && legacy.providers.length === 1 && legacy.providers[0].name === 'openai' && legacy.providers[0].label === 'OpenAI' && legacy.providers[0].price.input === 0.15 && !legacy.providers[0].isReasoningModel);
  const b = mkBrain(legacy.providers);
  const a0 = countA();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  check('brain với cấu hình cũ gọi được', r.source === 'llm' && countA() === a0 + 1 && b.usage().activeProvider === 'OpenAI');
  const gem = buildProviders({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/', OPENAI_MODEL: 'gemini-3.5-flash-lite' });
  check('OPENAI_BASE_URL trỏ Gemini → tên gemini, giá 0', gem.providers[0]?.name === 'gemini' && gem.providers[0]?.label === 'Gemini' && gem.providers[0]?.price.input === 0);
  const groqLegacy = buildProviders({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://api.groq.com/openai/v1', OPENAI_MODEL: 'openai/gpt-oss-120b' });
  check('OPENAI_BASE_URL trỏ Groq → tên groq, model reasoning', groqLegacy.providers[0]?.name === 'groq' && groqLegacy.providers[0]?.isReasoningModel === true);
  const none = buildProviders({});
  check('không có gì → 0 provider (offline)', none.providers.length === 0 && none.skipped.length === 0);
  const multi = buildProviders({
    AI_PROVIDERS: 'gemini, groq,openai', AI_GEMINI_API_KEY: 'g', AI_GEMINI_MODEL: 'gemini-3.5-flash-lite', AI_GEMINI_RPD: '1000',
    AI_GROQ_MODEL: 'openai/gpt-oss-120b', AI_GROQ_RPD: '1000', AI_GROQ_TPD: '200000', AI_GROQ_REASONING_EFFORT: 'low',
    AI_OPENAI_API_KEY: 'o', AI_OPENAI_MODEL: 'gpt-4o-mini', AI_OPENAI_TIER: 'strong', AI_OPENAI_LABEL: 'GPT trả tiền', AI_OPENAI_JSON: 'object',
    OPENAI_API_KEY: 'phải bị bỏ qua',
  });
  check('AI_PROVIDERS: Gemini (base URL mặc định, RPD 1000) + OpenAI (strong, label, json object); Groq bị bỏ qua vì chưa có key',
    multi.providers.length === 2 && multi.providers[0].name === 'gemini' && multi.providers[0].baseUrl === 'https://generativelanguage.googleapis.com/v1beta/openai/' && multi.providers[0].rpd === 1000 && multi.providers[0].price.input === 0
    && multi.providers[1].name === 'openai' && multi.providers[1].tier === 'strong' && multi.providers[1].label === 'GPT trả tiền' && multi.providers[1].json === 'object' && multi.providers[1].price.input === 0.15
    && multi.skipped.length === 1 && multi.skipped[0].name === 'groq' && /chưa có key/.test(multi.skipped[0].reason) && !multi.legacy, JSON.stringify(multi.skipped));
  const groq = buildProviders({ AI_PROVIDERS: 'groq', AI_GROQ_API_KEY: 'k', AI_GROQ_MODEL: 'openai/gpt-oss-120b', AI_GROQ_REASONING_EFFORT: 'low', AI_GROQ_TPD: '200000' });
  check('Groq: base URL mặc định, reasoning, TPD 200000, miễn phí', groq.providers[0]?.baseUrl === 'https://api.groq.com/openai/v1' && groq.providers[0]?.isReasoningModel === true && groq.providers[0]?.tpd === 200_000 && groq.providers[0]?.price.output === 0);
  // công tắc tương thích cũ: openaiKey rỗng = tắt AI
  const off = createBrain(cfgWith([]), { quiet: true, log, now });
  const a1 = countA();
  const r2 = await off.generateScene(sceneReq(), ctx, 'llm');
  check('không provider → mode offline, không gọi HTTP, reserve(low) = offline', off.mode() === 'offline' && r2.source === 'offline' && countA() === a1 && off.reserve('low') === 'offline');
  check('{ ...CONFIG, openaiKey: "" } → tắt AI dù providers còn (smoke.ts)', resolveProviders({ ...cfgWith([provA()]), openaiKey: '' }).length === 0);
  const handmade = { ...cfgWith([]), openaiKey: KEY_A, openaiBaseUrl: A.url, model: 'gpt-4o-mini', providers: undefined as unknown as ProviderConfig[] };
  check('Config dựng tay chỉ có trường cũ → 1 provider openai', resolveProviders(handmade).length === 1 && resolveProviders(handmade)[0].name === 'openai');
}

// ---------------------------------------------------------------- 12. key không lộ
section('12. Key không bao giờ xuất hiện trong stats / lỗi / log / snapshot');
{
  const b = mkBrain([provA(), provB()]);
  A.script.push(err401);
  B.script.push((r, res) => sendJson(res, 500, { error: { message: `boom ${r.auth} x-api-key: ${KEY_B}` } }));
  await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  check('usage() (kể cả lastError, providers[].lastError) không lộ key', !leaks(JSON.stringify(u)), u.lastError);
  check('serialize() không lộ key', !leaks(JSON.stringify(b.serialize())));
  check('mọi dòng log cảnh báo không lộ key', !warned.some(leaks) && warned.length > 0);
  check('mọi dòng log thông tin không lộ key', !infos.some(leaks));
  check('redactSecrets che sk-/gsk_/AIza/Bearer/key=', (() => {
    const s = redactSecrets(`Bearer abc.def key=AIzaSyA1234567890abcdef gsk_abcdefghijkl sk-proj-abcdefgh ?key=secret123`);
    return !/abc\.def|AIzaSyA1234567890|gsk_abcdefghijkl|sk-proj-abcdefgh|secret123/.test(s);
  })());
  check('startup log (quiet=false) không lộ key', (() => {
    const lines: string[] = [];
    createRouter(cfgWith([provA({ rpd: 1000 }), provB({ tpd: 200_000, tier: 'strong' })]), { now, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) } });
    return lines.length >= 3 && !lines.some(leaks) && lines.some((l) => /Alpha/.test(l) && /1000 lượt\/ngày/.test(l)) && lines.some((l) => /Beta/.test(l) && /ưu tiên/.test(l));
  })());
}

// ---------------------------------------------------------------- 13. giữ nhịp quota ngày, xen kẽ provider, trần token, tham số riêng
section('13. Giữ nhịp quota ngày (pace), AI_ROUTING=balanced, trần token ra / token mỗi request, AI_<NAME>_EXTRA_JSON');
{
  // pace: Alpha 100 lượt/ngày (ngày VN). 01:00 → được dùng 30 (bung tối thiểu) + 100 × 1/24 ≈ 34 lượt rồi phải giữ nhịp; 13:00 → 30 + 54 = 84
  const saveVt = vt;
  vt = nextLocalMidnight(vt) + 3_600_000;
  const bp = mkBrain([provA({ rpd: 100 }), provB()]);
  const a0 = countA(), b0 = countB();
  let paced = -1;
  for (let i = 0; i < 40; i++) {
    if (statsOf(bp.usage(), 'alpha')?.enabled === false) { paced = i; break; }
    await bp.generateScene(sceneReq(), ctx, 'llm');
  }
  const pa = statsOf(bp.usage(), 'alpha');
  check('pace: lúc 01:00 Alpha (100 RPD) nhận ~35 lượt rồi tạm giữ nhịp', paced >= 34 && paced <= 36 && countA() === a0 + paced, `paced=${paced}`);
  check('pace: lý do "giữ nhịp", mở lại trong vòng 1 giờ tới, Beta chưa bị gọi', /giữ nhịp/.test(pa?.cooldownReason ?? '') && (pa?.cooldownUntil ?? 0) > vt && (pa?.cooldownUntil ?? 0) <= vt + 3_600_000 + 60_000 && countB() === b0, pa?.cooldownReason);
  await bp.generateScene(sceneReq(), ctx, 'llm');
  check('pace: request kế tiếp sang Beta', countB() === b0 + 1);
  vt += 12 * 3_600_000; // 13:00
  check('pace: 13:00 mức cho phép ≈ 84 → Alpha sẵn sàng lại', statsOf(bp.usage(), 'alpha')?.enabled === true);
  const bnp = mkBrain([provA({ rpd: 100, pace: false })]);
  for (let i = 0; i < 50; i++) await bnp.generateScene(sceneReq(), ctx, 'llm');
  check('pace=false: dùng thoải mái (50/100 không bị chặn)', statsOf(bnp.usage(), 'alpha')?.rpdUsed === 50 && statsOf(bnp.usage(), 'alpha')?.enabled === true);
  vt = saveVt;

  // balanced: rand cố định → xáo theo quota còn lại; hoà thì theo thứ tự cấu hình
  const llmReq = (): LlmRequest => ({ task: 'scene', system: 'sys', user: 'user', schemaName: 'canh_hoi_thoai', schema: { type: 'object' }, maxTokens: 400 });
  const rb = createRouter(cfgWith([provA({ rpd: 100 }), provB({ rpd: 100 })], { aiRouting: 'balanced' }), { now, quiet: true, rand: () => 0.5 });
  check('balanced: hoà quota → Alpha (đứng trước) được chọn', rb.pick('scene', 'low')?.name === 'alpha');
  const a1 = countA(), b1 = countB();
  // rand cố định: quota ngang nhau thì luân phiên A, B, A… (bên vừa dùng còn ít hơn → lượt sau sang bên kia)
  await rb.complete(llmReq()); await rb.complete(llmReq()); await rb.complete(llmReq());
  check('balanced: 3 request luân phiên Alpha, Beta, Alpha', countA() === a1 + 2 && countB() === b1 + 1);
  check('balanced: Alpha còn 98% < Beta 99% → lượt sau sang Beta', rb.pick('scene', 'low')?.name === 'beta');
  await rb.complete(llmReq());
  check('balanced: request thứ 4 vào Beta', countB() === b1 + 2);
  const rbs = createRouter(cfgWith([provA({ rpd: 100 }), provB({ rpd: 100, tier: 'strong' })], { aiRouting: 'balanced' }), { now, quiet: true, rand: () => 0.5 });
  check('balanced + tier strong: việc quan trọng vẫn ưu tiên Beta (strong), cảnh thường Alpha', rbs.pick('candidate', 'high')?.name === 'beta' && rbs.pick('scene', 'low')?.name === 'alpha');
  const rbw = createRouter(cfgWith([provA({ rpd: 100, weight: 0.3 }), provB({ rpd: 100 })], { aiRouting: 'balanced' }), { now, quiet: true, rand: () => 0.5 });
  check('balanced + WEIGHT 0.3: Alpha nhường Beta dù quota ngang nhau', rbw.pick('scene', 'low')?.name === 'beta');
  check('buildProviders: WEIGHT đọc từ env, kẹp 0.05–5', buildProviders({ AI_PROVIDERS: 'w', AI_W_API_KEY: 'k', AI_W_MODEL: 'm', AI_W_WEIGHT: '0.3' } as NodeJS.ProcessEnv).providers[0]?.weight === 0.3
    && buildProviders({ AI_PROVIDERS: 'w', AI_W_API_KEY: 'k', AI_W_MODEL: 'm', AI_W_WEIGHT: '99' } as NodeJS.ProcessEnv).providers[0]?.weight === 5);

  // trần token ra cố định + extraBody + trần token/request
  const rc = createRouter(cfgWith([provA({ maxOutputTokens: 300, extraBody: { chat_template_kwargs: { enable_thinking: false } } })]), { now, quiet: true });
  await rc.complete(llmReq());
  const last = A.requests[A.requests.length - 1]?.body ?? {};
  check('AI_<NAME>_MAX_OUTPUT_TOKENS=300 → max_completion_tokens = 300', last.max_completion_tokens === 300, String(last.max_completion_tokens));
  check('AI_<NAME>_EXTRA_JSON ghép vào body (chat_template_kwargs.enable_thinking=false)', JSON.stringify(last.chat_template_kwargs) === '{"enable_thinking":false}');
  const rf = createRouter(cfgWith([provA({ maxRequestTokens: 200 }), provB()]), { now, quiet: true });
  const a2 = countA(), b2 = countB();
  const big = llmReq(); big.user = 'x'.repeat(4000); // ~1000 token > 200
  const res = await rf.complete(big);
  check('AI_<NAME>_MAX_REQUEST_TOKENS: request lớn không gửi tới Alpha, sang Beta ngay', res.provider === 'beta' && countA() === a2 && countB() === b2 + 1);

  // buildProviders: REASONING / PACE / MAX_* / EXTRA_JSON (EXTRA_JSON không được ghi đè model)
  const built = buildProviders({
    AI_PROVIDERS: 'x', AI_X_API_KEY: 'k-test', AI_X_MODEL: 'qwen/qwen3.8-27b', AI_X_REASONING: 'false', AI_X_PACE: 'false',
    AI_X_MAX_OUTPUT_TOKENS: '900', AI_X_MAX_REQUEST_TOKENS: '8000', AI_X_EXTRA_JSON: '{"chat_template_kwargs":{"enable_thinking":false},"model":"hack"}',
  } as NodeJS.ProcessEnv).providers[0];
  check('buildProviders: REASONING=false ép model qwen3 thành không suy luận', built?.isReasoningModel === false);
  check('buildProviders: PACE=false, MAX_OUTPUT_TOKENS=900, MAX_REQUEST_TOKENS=8000', built?.pace === false && built?.maxOutputTokens === 900 && built?.maxRequestTokens === 8000);
  check('buildProviders: EXTRA_JSON giữ chat_template_kwargs, bỏ "model"', JSON.stringify(built?.extraBody) === '{"chat_template_kwargs":{"enable_thinking":false}}');
  const built2 = buildProviders({ AI_PROVIDERS: 'y', AI_Y_API_KEY: 'k', AI_Y_MODEL: 'm', AI_Y_EXTRA_JSON: '{bad json' } as NodeJS.ProcessEnv).providers[0];
  check('buildProviders: EXTRA_JSON sai cú pháp → bỏ qua, không chết', built2 !== undefined && built2.extraBody === undefined);
  check('buildProviders: mặc định pace=true, không trần', buildProviders({ AI_PROVIDERS: 'z', AI_Z_API_KEY: 'k', AI_Z_MODEL: 'm' } as NodeJS.ProcessEnv).providers[0]?.pace === true);
}

// ---------------------------------------------------------------- tổng kết
A.server.close();
B.server.close();
const total = passed + failures.length;
console.log(`\n${failures.length ? '❌' : '✅'} ${passed}/${total} kiểm tra đạt${failures.length ? ` — lỗi: ${failures.join('; ')}` : ''}`);
console.log(`   (Alpha nhận ${A.requests.length} request, Beta nhận ${B.requests.length} request; không có request nào ra Internet)`);
process.exit(failures.length ? 1 : 0);
