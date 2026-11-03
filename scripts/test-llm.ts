// =====================================================================
//  TEST ĐƯỜNG GPT (không tốn tiền, không ra Internet): dựng một server giả lập
//  POST /v1/chat/completions trên 127.0.0.1:4500+ rồi trỏ Brain vào đó.
//
//  npm run test:llm
//
//  Kiểm tra: parse + làm sạch kết quả (sanitize), đường lui offline khi JSON hỏng /
//  HTTP 500 / treo, thử lại json_object khi json_schema bị 400, tính tiền theo token
//  (có cached_tokens), che API key trong lỗi, provider nghỉ (cooldown) khi lỗi, cầu dao
//  khi lỗi liên tiếp, nhịp reserve(), trần ngân sách, không ai xem thì không gọi GPT;
//  v3: news_chat (luật tin thật trong prompt + lưới an toàn bỏ câu gán tội), hr_review (quyết định lọc theo
//  "được phép"), verdict theo loại cảnh (stay/leave, approved/denied), generateBeats (AI biên kịch) + kích cỡ prompt;
//  cuối cùng chạy World + Director thật ở chế độ GPT vài chục phút game với server giả lập.
//  (Chính sách nhiều provider / failover: scripts/test-router.ts)
// =====================================================================
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentState, BeatRequest, NewsItem, PromptContext, SceneRequest, ServerMsg } from '../src/types.js';
import { CONFIG, makeProvider, withProviders, type Config } from '../src/config.js';
import { createBrain } from '../src/ai/brain.js';
import { World } from '../src/sim/world.js';
import { COMPANY_INFO } from '../src/content/catalog.js';
import { buildBeatsSystemPrompt, buildBeatsUserPrompt, buildSceneUserPrompt, buildSystemPrompt } from '../src/ai/prompts.js';
import { estimateTokens } from '../src/ai/prompt-budget.js';
import { hasPrice, isNewsSafe } from '../src/ai/sanitize.js';
import { offlineScene } from '../src/ai/offline.js';
import { getProducts, shortNameOf } from '../src/content/products.js';
import { SHOPPING_THEMES } from '../src/content/shopping.js';
// Director được nạp động ở mục cuối: file của drama engineer đang sửa thì các mục AI vẫn chạy, mục đó báo lỗi rõ ràng.

// ---------------------------------------------------------------- tiện ích test
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, info = ''): void {
  if (ok) { passed++; console.log(`  ✅ ${name}${info ? ` — ${info}` : ''}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${info ? ` — ${info}` : ''}`); }
}
const section = (t: string): void => console.log(`\n▶ ${t}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const SECRET = 'sk-test-SECRETKEY-0123456789abcdefXYZ';
const warned: string[] = [];
const origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')); if (process.env.TEST_VERBOSE === '1') origWarn(...args); };
process.on('unhandledRejection', (e) => { failures.push(`unhandledRejection: ${String(e)}`); console.log('  ❌ unhandledRejection', e); });

// ---------------------------------------------------------------- server giả lập OpenAI
interface Req { path: string; auth: string; body: Record<string, unknown> }
type Handler = (r: Req, res: ServerResponse) => void;
const requests: Req[] = [];
const script: Handler[] = [];

function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}
function completion(content: string, usage?: Record<string, unknown>) {
  return {
    id: `chatcmpl-mock-${requests.length}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'gpt-4o-mini',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null }],
    usage: usage ?? { prompt_tokens: 1200, completion_tokens: 250, total_tokens: 1450, prompt_tokens_details: { cached_tokens: 1024 } },
  };
}
const userOf = (r: Req): string => {
  const msgs = Array.isArray(r.body.messages) ? r.body.messages as { role: string; content: string }[] : [];
  return msgs.find((m) => m.role === 'user')?.content ?? '';
};
const systemOf = (r: Req): string => {
  const msgs = Array.isArray(r.body.messages) ? r.body.messages as { role: string; content: string }[] : [];
  return msgs.find((m) => m.role === 'system')?.content ?? '';
};
const formatOf = (r: Req): string => String((r.body.response_format as { type?: string } | undefined)?.type ?? '');

/** Trả lời "thông minh" theo nhiệm vụ trong prompt (dùng cho chạy World + Director) */
const smart: Handler = (r, res) => {
  const user = userOf(r);
  if (user.startsWith('NHIỆM VỤ: ỨNG VIÊN')) {
    sendJson(res, 200, completion(JSON.stringify({
      name: 'Khánh Vy', fullName: 'Trịnh Khánh Vy', gender: 'nữ', age: 24, bio: 'Từng bán bảo hiểm, nói chuyện như tư vấn mở thẻ.',
      speechStyle: 'Xưng em, hay "dạ dạ".', quirks: ['ghi chú bằng bút 4 màu'], likes: ['trà đào'], dislikes: ['họp dài'],
      traits: { diligence: 0.7, laziness: 0.3, gossip: 0.5, temper: 0.3, humor: 0.6, ambition: 0.7 },
      look: { skin: '#f1c27d', hair: '#1b1b1b', hairStyle: 'bob', shirt: '#4f86f7', pants: '#2d3748', accessory: 'none' },
    })));
    return;
  }
  if (user.startsWith('NHIỆM VỤ: BẢN TIN')) {
    sendJson(res, 200, completion(JSON.stringify({
      headline: 'Bản tin giả lập: văn phòng chạy bằng GPT', bullets: ['Ý giả lập 1', 'Ý giả lập 2', 'Ý giả lập 3'],
      mvp: { id: 'khoa', reason: 'Gánh team' }, drama: 'Drama giả lập trong ngày.',
    })));
    return;
  }
  if (user.startsWith('NHIỆM VỤ: BIẾN')) {
    // v3: AI biên kịch — chọn kind đầu trong MENU, gán cho người đầu trong NHÂN SỰ
    const kind = /^- ([a-z0-9_]+) — /mu.exec(user)?.[1] ?? 'conflict';
    const rosterLine = /NHÂN SỰ[^\n]*?: ([^\n]+)/u.exec(user)?.[1] ?? '';
    const ids = rosterLine.split(' · ').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    sendJson(res, 200, completion(JSON.stringify({
      beats: [{ kind, a: ids[0] ?? null, b: null, intensity: 1, note: 'Biến giả lập cho vài giờ tới' }],
    }), { prompt_tokens: 600, completion_tokens: 60, total_tokens: 660 }));
    return;
  }
  const ids = (/speaker chỉ dùng: ([^·\n]+)/.exec(user)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const [min] = (/(\d+)–(\d+) câu/.exec(user) ?? ['', '4']).slice(1).map(Number);
  const n = Math.max(2, Math.min(min || 4, 6));
  const lines = Array.from({ length: n }, (_, i) => ({
    speaker: ids[i % Math.max(1, ids.length)] ?? 'khoa', text: `Câu thoại giả lập số ${i + 1} nè`, emote: i === 0 ? '😄' : null,
    // v4: prompt không còn chữ "SẢN PHẨM"; cảnh có sản phẩm thì YÊU CẦU ghi "đúng 1 câu product=true"
    product: user.includes('đúng 1 câu product=true') && i === 1,
  }));
  // v3: hr_review → quyết định "none" cho từng người trong HỒ SƠ; verdict theo loại cảnh
  const dossierIds = [...user.matchAll(/^- \[([a-z0-9_]+)\]/gmu)].map((m) => m[1]);
  const verdict = user.includes('verdict: "hired"') ? 'hired' : user.includes('verdict: "stay"') ? 'stay' : user.includes('verdict: "approved"') ? 'denied' : null;
  sendJson(res, 200, completion(JSON.stringify({
    lines, summary: 'Cảnh giả lập do GPT viết.', relationshipChanges: [], moodChanges: [], memories: [], kpiChanges: [],
    rumor: user.includes('TIN ĐỒN') ? { aboutId: (/aboutId "([^"]+)"/.exec(user)?.[1] ?? ''), text: 'Tin đồn giả lập được thêm mắm muối' } : null,
    verdict,
    hrDecisions: user.includes('HỒ SƠ NHÂN SỰ') ? dossierIds.map((id) => ({ id, action: 'none', reason: 'Giả lập: theo dõi thêm.' })) : null,
  }), { prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800, prompt_tokens_details: { cached_tokens: 1280 } }));
};

async function startMock(): Promise<{ server: Server; port: number }> {
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
  for (let port = 4500; port < 4600; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return { server, port: (server.address() as AddressInfo).port };
  }
  throw new Error('không tìm được cổng trống 4500–4599');
}

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
    situation: 'Vy (QA Tester) đi tới bàn Tùng (Senior Developer) để báo một bug mới tìm thấy. Lúc đó Tùng đang lướt TikTok.',
    participants: ['vy', 'tung'], minLines: 3, maxLines: 7, allowedEffects: ['relationship', 'mood', 'memory'], priority: 'low',
    ...over,
  };
}

// ================================================================== chạy
const { server, port } = await startMock();
console.log(`🧪 Test đường GPT với server giả lập http://127.0.0.1:${port}/v1 (key giả, không ra Internet)`);
let vt = Date.now();
const now = (): number => vt;
// 1 provider giả lập (cấu hình kiểu mới); các trường OPENAI_* cũ được withProviders() đồng bộ theo
const MOCK = makeProvider({
  name: 'mock', label: 'Mock', apiKey: SECRET, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'gpt-4o-mini',
  price: { input: 0.15, cached: 0.075, output: 0.6 },
});
const baseCfg: Config = withProviders({
  ...CONFIG,
  dailyBudgetUsd: 1,
  minSecondsBetweenLlm: 20,
  maxConcurrentLlm: 2,
  llmOnlyWhenWatched: true,
  persist: false,
  timeMode: 'compressed',
}, [MOCK]);
const offCfg: Config = withProviders(baseCfg, []); // không provider → offline, không ra mạng
const quiet = { quiet: true } as const;

// agent thật từ World (offline) để prompt/sanitize chạy trên dữ liệu thật
const seedWorld = new World({ config: offCfg, brain: createBrain(offCfg, quiet), emit: () => {} });
const agents = seedWorld.agents().map((a) => ({ ...a, present: true, activity: 'working' as const, activityLabel: 'đang code' }));
const ctx = makeCtx(agents);

// ---------------------------------------------------------------- 1. reserve()
section('1. reserve(): nhịp gọi + không ai xem');
{
  const brain = createBrain(baseCfg, { ...quiet, now, deadlineMs: { scene: 4000, candidate: 4000, recap: 4000 } });
  check('mode() = llm khi có key', brain.mode() === 'llm');
  const u0 = brain.usage();
  check('usage() có activeProvider + providers[] (chip AI)', u0.activeProvider === 'Mock' && u0.providers?.length === 1 && u0.providers[0].enabled && u0.model === 'gpt-4o-mini');
  brain.setAudience(0);
  check('không ai xem: cảnh low bị bỏ', brain.reserve('low') === null);
  check('không ai xem: cảnh normal bị bỏ', brain.reserve('normal') === null);
  check('không ai xem: cảnh high dùng thoại offline', brain.reserve('high') === 'offline');
  check('đếm cảnh bị bỏ (skipped)', brain.usage().skipped === 2, `skipped=${brain.usage().skipped}`);
  brain.setAudience(3);
  check('có người xem: low được GPT', brain.reserve('low') === 'llm');
  check('ngay sau đó: low bị chặn (≥ 20 s)', brain.reserve('low') === null);
  check('ngay sau đó: normal bị chặn (≥ 10 s)', brain.reserve('normal') === null);
  check('high luôn được', brain.reserve('high') === 'llm');
  vt += 10_500;
  check('sau 10.5 s: normal được', brain.reserve('normal') === 'llm');
  check('sau đó low vẫn chờ', brain.reserve('low') === null);
  vt += 20_500;
  check('sau 20.5 s: low được', brain.reserve('low') === 'llm');
  check('chặn vì nhịp thì không tính skipped', brain.usage().skipped === 2);
  const req0 = requests.length;
  const r = await brain.generateScene(sceneReq(), ctx, 'offline');
  check('via=offline: không gọi HTTP', requests.length === req0 && r.source === 'offline' && r.lines.length >= 2);
}

// ---------------------------------------------------------------- 2. cảnh hợp lệ (bẩn) → sanitize + tiền
section('2. Cảnh GPT hợp lệ nhưng "bẩn" → làm sạch + tính tiền');
// providerTimeoutMs 3500 < hạn chót 4000: lượt gọi treo hết trọn cửa sổ riêng (không phải bị hạn chót cắt ngắn) → bị phạt
const brain = createBrain(baseCfg, { ...quiet, now, deadlineMs: { scene: 4000, candidate: 4000, recap: 4000 }, providerTimeoutMs: 3500 });
brain.setAudience(1);
{
  script.push((_r, res) => sendJson(res, 200, completion(JSON.stringify({
    lines: [
      { speaker: 'tung', text: 'Tùng: "Bug đó anh fix rồi mà."', emote: '😅 hihi', product: false },
      { speaker: 'Vy', text: '(cười) Máy anh chạy được thôi, khách thì không.', emote: null, product: false },
      { speaker: 'sep_ma', text: 'Tôi là ai?', emote: null, product: false },
      { speaker: 'anh Tùng', text: 'Thôi để anh coi lại, mà con bàn phím cơ không dây gõ sướng tay ghê.', emote: null, product: true },
      { speaker: 'vy', text: 'Nhớ fix trước 5 giờ nha https://shopee.vn/abc 🙂', emote: '🙂', product: true },
    ],
    summary: 'Vy khịa Tùng vì bug.',
    relationshipChanges: [{ from: 'vy', to: 'tung', delta: -40, reason: 'khịa' }, { from: 'tung', to: 'khoa', delta: 5, reason: 'không liên quan' }],
    moodChanges: [{ id: 'tung', delta: -30 }],
    memories: [{ id: 'vy', text: 'Bắt được bug của Tùng ngay trước mặt' }],
    kpiChanges: [{ id: 'tung', delta: 10 }],
    rumor: { aboutId: 'khoa', text: 'Khoa sắp nghỉ' },
    verdict: 'rejected',
  }), { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 600 } })));
  const req0 = requests.length;
  const r = await brain.generateScene(sceneReq({ product: { id: 'ban-phim-co', name: 'Bàn phím cơ không dây', pitch: 'gõ sướng tay', preferSpeaker: 'tung' } }), ctx, 'llm');
  const sent = requests[req0];
  check('đúng 1 request', requests.length === req0 + 1);
  check('gửi json_schema strict', formatOf(sent) === 'json_schema' && (sent.body.response_format as { json_schema?: { strict?: boolean } }).json_schema?.strict === true);
  check('system prompt tĩnh + user prompt có id được phép', systemOf(sent).includes('biên kịch') && userOf(sent).includes('speaker chỉ dùng: vy, tung'));
  check('max_completion_tokens 1300, temperature 1', sent.body.max_completion_tokens === 1300 && sent.body.temperature === 1);
  check('có OPENAI_BASE_URL thì không gửi prompt_cache_key', !('prompt_cache_key' in sent.body));
  check('gửi Bearer key', sent.auth === `Bearer ${SECRET}`);
  check('nguồn = llm', r.source === 'llm');
  check('bỏ câu của người ngoài cảnh, giữ 4 câu', r.lines.length === 4, r.lines.map((l) => l.speaker).join(','));
  check('map tên → id ("Vy" → vy, "anh Tùng" → tung)', r.lines[1]?.speaker === 'vy' && r.lines[2]?.speaker === 'tung');
  check('bỏ "Tên:" + ngoặc kép', r.lines[0]?.text === 'Bug đó anh fix rồi mà.', JSON.stringify(r.lines[0]?.text));
  check('bỏ chỉ dẫn sân khấu "(cười)"', !r.lines[1]?.text.includes('(cười)'), r.lines[1]?.text);
  check('emote chỉ giữ 1 emoji', r.lines[0]?.emote === '😅');
  check('bỏ link trong lời thoại', !r.lines[3]?.text.includes('http') && !r.lines[3]?.text.includes('shopee'), r.lines[3]?.text);
  check('đúng 1 câu product (câu nhắc bàn phím)', r.lines.filter((l) => l.product).length === 1 && !!r.lines[2]?.product);
  check('quan hệ: kẹp ±15, chỉ trong cảnh', r.relationshipChanges.length === 1 && r.relationshipChanges[0].delta === -15 && r.relationshipChanges[0].to === 'tung');
  check('tâm trạng kẹp ±15', r.moodChanges.length === 1 && r.moodChanges[0].delta === -15);
  check('KPI không được phép → bỏ', r.kpiChanges.length === 0);
  check('rumor không được phép → null; verdict ngoài phỏng vấn → null', r.rumor === null && r.verdict === null);
  check('giữ ký ức hợp lệ', r.memories.length === 1 && r.memories[0].id === 'vy');
  const u = brain.usage();
  const expected = (400 * 0.15 + 600 * 0.075 + 200 * 0.6) / 1e6;
  check('tính tiền có cached_tokens', near(u.costTodayUsd, Math.round(expected * 1e6) / 1e6), `$${u.costTodayUsd} (kỳ vọng $${expected})`);
  check('đếm token', u.calls === 1 && u.inputTokens === 1000 && u.cachedTokens === 600 && u.outputTokens === 200);
}

// ---------------------------------------------------------------- 3. JSON hỏng → offline
section('3. JSON hỏng → thoại offline');
{
  script.push((_r, res) => sendJson(res, 200, completion('{"lines": [ {"speaker": "vy", "text": "Câu bị cắt ngang')));
  const r = await brain.generateScene(sceneReq(), ctx, 'llm');
  const u = brain.usage();
  check('fallback offline, vẫn đủ thoại', r.source === 'offline' && r.lines.length >= 2);
  check('failures++ và lastError nói về JSON', u.failures === 1 && /JSON/i.test(u.lastError ?? ''), u.lastError);
  check('response hỏng vẫn bị tính tiền (đã tiêu token)', u.calls === 2);
}

// ---------------------------------------------------------------- 4. HTTP 500 → provider nghỉ 20 s → offline
section('4. HTTP 500 → không retry cùng provider, provider nghỉ 20 s → offline');
{
  const boom: Handler = (_r, res) => sendJson(res, 500, { error: { message: 'Máy chủ giả lập lỗi', type: 'server_error' } }, { 'retry-after-ms': '5' });
  script.push(boom);
  const req0 = requests.length;
  const r = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('đúng 1 request (router không retry, SDK maxRetries 0)', requests.length === req0 + 1, `${requests.length - req0}`);
  check('fallback offline', r.source === 'offline' && r.lines.length >= 2);
  const u = brain.usage();
  check('failures = 2', u.failures === 2);
  const p = u.providers?.[0];
  check('provider nghỉ 20 s, có lý do tiếng Việt', !!p && !p.enabled && p.cooldownUntil === vt + 20_000 && /máy chủ lỗi \(500\)/.test(p.cooldownReason ?? ''), p?.cooldownReason);
  check('đang nghỉ → usage().mode = offline (chip AI), mode() vẫn = llm', u.mode === 'offline' && brain.mode() === 'llm');
  const req1 = requests.length;
  const r2 = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('đang nghỉ: không gọi HTTP, thoại offline ngay', requests.length === req1 && r2.source === 'offline');
  check('đang nghỉ: reserve() theo nhịp offline (high → offline)', brain.reserve('high') === 'offline');
  vt += 20_001;
  check('hết 20 s: provider sẵn sàng lại', brain.usage().mode === 'llm' && brain.usage().providers?.[0].enabled === true);
}

// ---------------------------------------------------------------- 5. 400 json_schema → json_object
section('5. Model không nhận json_schema (400) → thử lại json_object');
{
  script.push((r, res) => {
    if (formatOf(r) === 'json_schema') {
      sendJson(res, 400, { error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", type: 'invalid_request_error', param: 'response_format', code: null } });
    } else smart(r, res);
  });
  const req0 = requests.length;
  const r = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('2 request: json_schema rồi json_object', requests.length === req0 + 2 && formatOf(requests[req0]) === 'json_schema' && formatOf(requests[req0 + 1]) === 'json_object');
  check('kết quả từ GPT', r.source === 'llm' && r.lines.length >= 2);
  check('json_object: prompt có chữ "JSON"', /JSON/.test(systemOf(requests[req0 + 1])));
  const req1 = requests.length;
  const r2 = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('lần sau dùng thẳng json_object (nhớ 24 giờ)', requests.length === req1 + 1 && formatOf(requests[req1]) === 'json_object' && r2.source === 'llm');
  check('usage().providers[0].format = json_object', brain.usage().providers?.[0].format === 'json_object');
}

// ---------------------------------------------------------------- 6. che API key + tắt provider khi sai key + cầu dao
section('6. Lỗi 401 không lộ key, provider bị tắt 1 giờ; lỗi liên tiếp → cầu dao');
{
  script.push((r, res) => sendJson(res, 401, { error: { message: `Incorrect API key provided: ${r.auth.replace('Bearer ', '')}. You can find your API key at ...`, type: 'invalid_request_error', code: 'invalid_api_key' } }));
  await brain.generateScene(sceneReq(), ctx, 'llm');
  const u = brain.usage();
  const le = u.lastError ?? '';
  check('lastError không chứa key', !le.includes(SECRET) && !le.includes('SECRETKEY'), le);
  check('lastError có giải thích tiếng Việt', /API key/i.test(le));
  const p = u.providers?.[0];
  check('provider bị tắt 60 phút, lý do nói rõ sai key + tên biến .env', !!p && p.cooldownUntil === vt + 3_600_000 && /API key/.test(p.cooldownReason ?? '') && /AI_MOCK_API_KEY/.test(p.cooldownReason ?? ''), p?.cooldownReason);
  check('lỗi của provider cũng không lộ key', !JSON.stringify(u).includes(SECRET) && !JSON.stringify(u).includes('SECRETKEY'));
  vt += 3_600_001; // hết hạn tắt
  const broken: Handler = (_r, res) => sendJson(res, 200, completion('{"lines": ['));
  script.push(broken, broken); // JSON hỏng không làm provider nghỉ, nhưng tính vào cầu dao
  await brain.generateScene(sceneReq(), ctx, 'llm');
  await brain.generateScene(sceneReq(), ctx, 'llm'); // lỗi thứ 3 liên tiếp (401 + 2 JSON hỏng) → cầu dao mở
  script.length = 0;
  const req0 = requests.length;
  const r = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('cầu dao mở: không gọi HTTP, thoại offline ngay', requests.length === req0 && r.source === 'offline');
  check('cầu dao mở → usage().mode = offline', brain.usage().mode === 'offline');
  vt += 61_000;
  const r2 = await brain.generateScene(sceneReq(), ctx, 'llm');
  check('hết 60 s: gọi lại GPT bình thường', requests.length === req0 + 1 && r2.source === 'llm');
  check('không in key ra console', !warned.some((w) => w.includes(SECRET) || w.includes('SECRETKEY')));
}

// ---------------------------------------------------------------- 7. ứng viên + bản tin qua GPT
section('7. Ứng viên + bản tin qua GPT');
{
  script.push((_r, res) => sendJson(res, 200, completion(JSON.stringify({
    name: 'Tú', fullName: 'Lý Minh Tú', gender: 'Nam', age: 23, bio: 'Cựu streamer game, nói nhanh như bình luận viên.',
    speechStyle: 'Xưng em, nói nhanh.', quirks: ['đập bàn khi thắng'], likes: ['game'], dislikes: ['họp'],
    traits: { diligence: 7, laziness: 3, gossip: 5, temper: 2, humor: 9, ambition: 6 },
    look: { skin: 'đỏ', hair: '#222222', hairStyle: 'mohawk', shirt: '#22c55e', pants: '#1f2937', accessory: 'cap' },
  }))));
  const cand = await brain.generateCandidate({ role: 'salesnew', roleLabel: 'Nhân viên Sales', deskId: 'd_salesnew', kpiTarget: 300, usedNames: ['Tú'] }, ctx);
  check('id ứng viên đúng dạng', /^cand_salesnew_2_[a-z0-9]{4}$/.test(cand.id), cand.id);
  check('tên trùng → đổi sang "Minh Tú"', cand.name === 'Minh Tú', cand.name);
  check('role/desk/kpiTarget lấy từ yêu cầu', cand.role === 'salesnew' && cand.deskId === 'd_salesnew' && cand.kpiTarget === 300);
  check('traits thang 0..10 → 0..1', near(cand.traits.diligence, 0.7) && near(cand.traits.humor, 0.9));
  check('màu/kiểu tóc sai → thay bằng giá trị hợp lệ', /^#[0-9a-f]{6}$/i.test(cand.look.skin) && cand.look.hairStyle !== ('mohawk' as never));
  script.push((_r, res) => sendJson(res, 200, completion(JSON.stringify({
    headline: 'Sập server, Khoa gánh team', bullets: ['Server sập lúc 10h', 'Khoa rollback kịp'], mvp: { id: 'Khoa', reason: 'Cứu server' }, drama: 'Vy khịa Tùng.',
  }))));
  const recap = await brain.generateRecap({ day: 2, weekday: 'Thứ Ba', events: ['10:00 🔥 Sập server'], kpi: [{ id: 'khoa', name: 'Khoa', roleLabel: 'Tech Lead', kpi: 300, target: 290, ratio: 1.03, lowStreak: 0 }], firedToday: [], hiredToday: [] }, ctx);
  check('bản tin từ GPT', recap.source === 'llm' && recap.headline.includes('Khoa'));
  check('mvp theo tên → id', recap.mvp?.id === 'khoa');
  check('bù đủ ≥ 3 ý từ sự kiện', recap.bullets.length >= 3);
}

// ---------------------------------------------------------------- 8. treo → hạn chót
section('8. Server treo → hết hạn chót → offline (không treo sim), provider nghỉ 20 s');
{
  script.push(() => { /* không bao giờ trả lời */ });
  const t0 = Date.now();
  const r = await brain.generateScene(sceneReq(), ctx, 'llm');
  const ms = Date.now() - t0;
  check('trả về trong ~4 s với thoại offline', r.source === 'offline' && ms >= 3000 && ms < 8000, `${ms} ms`);
  const p = brain.usage().providers?.[0];
  check('timeout → provider nghỉ 20 s', !!p && !p.enabled && /quá thời gian/.test(p.cooldownReason ?? ''), p?.cooldownReason);
}

// ---------------------------------------------------------------- 9. trần ngân sách
section('9. Trần ngân sách mỗi ngày');
{
  const b2 = createBrain({ ...baseCfg, dailyBudgetUsd: 0.0003 }, { ...quiet, now });
  b2.setAudience(1);
  script.push((r, res) => smart(r, res));
  await b2.generateScene(sceneReq(), ctx, 'llm');
  const u = b2.usage();
  check('1 cảnh đã vượt trần', u.costTodayUsd >= 0.0003, `$${u.costTodayUsd}`);
  vt += 60_000;
  check('vượt trần: low bị bỏ', b2.reserve('low') === null);
  check('vượt trần: high dùng offline', b2.reserve('high') === 'offline');
  const req0 = requests.length;
  const cand = await b2.generateCandidate({ role: 'junior', roleLabel: 'Fresher Developer', deskId: 'd_junior', kpiTarget: 250, usedNames: [] }, ctx);
  const recap = await b2.generateRecap({ day: 2, weekday: 'Thứ Ba', events: [], kpi: [], firedToday: [], hiredToday: [] }, ctx);
  check('vượt trần: ứng viên + bản tin offline, không gọi HTTP', requests.length === req0 && !!cand.name && recap.source === 'offline');
  const snap = JSON.parse(JSON.stringify(b2.serialize()));
  const b3 = createBrain({ ...baseCfg, dailyBudgetUsd: 0.0003 }, { ...quiet, now });
  b3.restore(snap);
  b3.restore('rác');
  check('serialize/restore giữ chi phí hôm nay', near(b3.usage().costTodayUsd, u.costTodayUsd) && b3.usage().calls === u.calls);
  check('snapshot không chứa key', !JSON.stringify(snap).includes(SECRET));
}

// ================================================================== v3: thời sự, nhân sự do AI quyết, AI biên kịch
const v3Deadline = { scene: 4000, candidate: 4000, recap: 4000, beats: 4000 } as const;
const v3 = createBrain(baseCfg, { ...quiet, now, deadlineMs: v3Deadline });
v3.setAudience(1);
const NEWS: NewsItem = {
  id: 'n_test', title: 'Đội tuyển Việt Nam thắng 2-0 trong trận giao hữu', summary: 'Hai bàn thắng đến trong hiệp hai.',
  source: 'VnExpress', url: 'https://vnexpress.net/the-thao/test', category: 'bong_da', publishedAt: Date.now() - 3_600_000,
};
const sceneJson = (over: Record<string, unknown>) => JSON.stringify({
  lines: [], summary: '', relationshipChanges: [], moodChanges: [], memories: [], kpiChanges: [], rumor: null, verdict: null, hrDecisions: null, ...over,
});
const twoLines = (a: string, z: string) => [
  { speaker: a, text: 'Câu một giả lập nè.', emote: null, product: false },
  { speaker: z, text: 'Câu hai giả lập đây.', emote: null, product: false },
  { speaker: a, text: 'Câu ba cho đủ số.', emote: null, product: false },
];

// ---------------------------------------------------------------- 10. news_chat
section('10. v3 — news_chat: luật tin thật trong prompt + lưới an toàn bỏ câu gán tội');
{
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: [
      { speaker: 'phat', text: 'Ê thấy tin tuyển mình thắng 2-0 chưa? Báo VnExpress đăng đó.', emote: '⚽', product: false },
      { speaker: 'tu', text: 'Nghe nói huấn luyện viên bị bắt vì bán độ rồi đó anh.', emote: null, product: false },
      { speaker: 'tu', text: 'Em chưa đọc kỹ, mà nghe là thấy muốn đi đá banh rồi.', emote: null, product: false },
      { speaker: 'phat', text: 'Chắc cầu thủ đó ngoại tình nên đá hăng vậy.', emote: null, product: false },
      { speaker: 'phat', text: 'Tối nay ra quán cà phê coi lại highlight nha, hồi sáng anh bị bắt lười nên giờ phải cày.', emote: null, product: false },
    ],
    summary: 'Phát và Tú bàn tin tuyển Việt Nam thắng, nghi có người bị bắt.',
    moodChanges: [{ id: 'phat', delta: 3 }],
    memories: [{ id: 'tu', text: 'Nghe Phát kể vụ huấn luyện viên bị bắt' }, { id: 'phat', text: 'Tám tin bóng đá với Tú ở pantry' }],
  }))));
  const req0 = requests.length;
  const newsReq = sceneReq({
    type: 'news_chat', channel: 'office', participants: ['phat', 'tu'], locationLabel: 'Pantry', news: NEWS,
    situation: 'Phát và Tú đứng pha cà phê ở pantry, tám chuyện về tin trên báo.', minLines: 4, maxLines: 8,
    allowedEffects: ['relationship', 'mood', 'memory'], priority: 'low',
  });
  const r = await v3.generateScene(newsReq, ctx, 'llm');
  const user = userOf(requests[req0]);
  const sys = systemOf(requests[req0]);
  check('prompt có thẻ TIN: tiêu đề + nguồn + lúc đăng + mục', user.includes(NEWS.title) && /TIN \(thật, theo báo VnExpress đăng hôm nay, mục bóng đá\)/.test(user), user.split('\n').find((l) => l.startsWith('TIN')) ?? '');
  check('prompt có LUẬT TIN THẬT: không thêm sự thật/con số, không gán tội, không đời tư, không "chắc là bị…", dẫn nguồn',
    /LUẬT TIN THẬT/.test(user) && /không thêm sự thật, con số/.test(user) && /không gán tội/.test(user) && /đời tư/.test(user)
    && /chắc là bị/.test(user) && /theo báo X đăng/.test(user) && /4–8 câu/.test(user));
  check('prompt gợi ý liên hệ sở thích của người trong cảnh (Phát, Tú)', /Có thể liên hệ sang chuyện của mình: .*Phát \(.*\).*Tú \(.*\)/.test(user), user.split('\n').find((l) => l.startsWith('Có thể liên hệ')) ?? '');
  check('định hướng news_chat + thẻ "thích:" trong hồ sơ nhân vật', /Loại: news_chat/.test(user) && /thích: /.test(user));
  check('system prompt có luật tin thật gọn + hrDecisions trong mẫu JSON', /TIN THẬT/.test(sys) && /"hrDecisions":null/.test(sys));
  check('schema verdict đủ giá trị (v3 + v5 plan_a..plan_d, inspired, unmoved) + hrDecisions enum HrAction', (() => {
    const s = JSON.stringify(requests[req0].body.response_format);
    return s.includes('"stay"') && s.includes('"approved"') && s.includes('"second_chance"') && s.includes('hrDecisions')
      && ['plan_a', 'plan_b', 'plan_c', 'plan_d', 'inspired', 'unmoved'].every((v) => s.includes(`"${v}"`));
  })());
  check('lưới an toàn: bỏ 2 câu "bị bắt"/"ngoại tình", giữ 3 câu an toàn (kể cả "bị bắt lười")', r.source === 'llm' && r.lines.length === 3
    && r.lines.every((l) => !/bị bắt vì|ngoại tình/.test(l.text)) && r.lines.some((l) => l.text.includes('bị bắt lười')), r.lines.map((l) => l.text).join(' | '));
  check('tóm tắt vi phạm → thay bằng tóm tắt an toàn có nguồn', !/bị bắt/.test(r.summary) && r.summary.includes('VnExpress'), r.summary);
  // ký ức của cảnh có tin thật đi theo MẪU cố định (tiêu đề + nguồn) — không giữ "sự thật" do model viết (kể cả câu an toàn)
  check('ký ức cảnh thời sự theo mẫu "Bàn tin … (nguồn)" cho cả 2 người (không giữ chữ của model); mood giữ', r.memories.length === 2
    && r.memories.every((m) => /^Bàn tin "/.test(m.text) && m.text.includes('VnExpress') && !/bị bắt/.test(m.text)) && r.moodChanges.length === 1,
    r.memories.map((m) => `${m.id}: ${m.text}`).join(' | '));
  // 10b. chữ không phải tiếng Việt (model dự phòng trộn chữ Hán) + câu phán xét / đoán động cơ người có tên trong tin → bỏ
  const NEWS2: NewsItem = { ...NEWS, id: 'n_test2', title: 'Bruno Fernandes nén khóc sau trận thua Chelsea', summary: 'Tiền vệ Man Utd dường như cố kìm nước mắt sau trận thua 0-2.', url: 'https://vnexpress.net/the-thao/test2' };
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: [
      { speaker: 'phat', text: 'Ê, VnExpress đăng Fernandes nén khóc sau trận thua Chelsea đó, 喝完 trà sữa về coi lại.', emote: null, product: false },
      { speaker: 'tu', text: 'Fernandes khóc vậy chắc làm màu cho fan thương thôi anh.', emote: null, product: false },
      { speaker: 'tu', text: 'Thấy tội ông Fernandes, mà đá bóng thua là chuyện thường.', emote: null, product: false },
      { speaker: 'phat', text: 'Tối nay anh ra quán cà phê coi lại highlight.', emote: null, product: false },
      { speaker: 'tu', text: 'Em chạy deadline Spa Hương Sen đây, mai kể tiếp.', emote: null, product: false },
      { speaker: 'phat', text: 'You know what, this match was really the worst thing I have seen this year.', emote: null, product: false },
    ],
    summary: 'Phát và Tú bàn tin Fernandes khóc, 他们 nói về deadline.',
    memories: [{ id: 'phat', text: 'Fernandes khóc vì thua Chelsea 0-2, chắc hết thời rồi' }],
  }))));
  const r3 = await v3.generateScene(sceneReq({ ...newsReq, news: NEWS2 }), ctx, 'llm');
  check('bỏ câu lẫn chữ Hán và câu tiếng Anh nguyên câu; bỏ câu "chắc làm màu" về người có tên trong tin; giữ 3 câu an toàn (kể cả câu nhắc tên không phán xét)',
    r3.source === 'llm' && r3.lines.length === 3 && r3.lines.some((l) => l.text.includes('Thấy tội ông Fernandes'))
    && r3.lines.every((l) => !/喝完|làm màu|You know what/.test(l.text)), r3.lines.map((l) => l.text).join(' | '));
  check('tóm tắt lẫn chữ Hán → tóm tắt an toàn; ký ức "chắc hết thời" → mẫu "Bàn tin …"', !/他们/.test(r3.summary) && r3.summary.includes('VnExpress')
    && r3.memories.length === 1 && /^Bàn tin "Bruno Fernandes/.test(r3.memories[0].text), `${r3.summary} || ${r3.memories[0]?.text ?? ''}`);
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: [
      { speaker: 'phat', text: '这是一个测试句子，不是越南语。', emote: null, product: false },
      { speaker: 'tu', text: '네, 저도 그렇게 생각해요 anh.', emote: null, product: false },
      { speaker: 'phat', text: 'Thôi làm việc đi em.', emote: null, product: false },
    ],
    summary: 'Thử.',
  }))));
  const f1 = v3.usage().failures;
  const r4 = await v3.generateScene(sceneReq({ type: 'pantry_chat', participants: ['phat', 'tu'], situation: 'Hai người tám chuyện ở pantry.' }), ctx, 'llm');
  check('toàn câu chữ Hán / Hàn → còn < 2 câu → thoại offline, lastError nói "không phải tiếng Việt"', r4.source === 'offline' && v3.usage().failures === f1 + 1
    && /không phải tiếng Việt/.test(v3.usage().lastError ?? ''), v3.usage().lastError);
  // gợi ý "nghe nói …" cũ (không có thẻ tin) vẫn kích hoạt lưới an toàn tin thật — dây an toàn thứ hai
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: [
      { speaker: 'phat', text: 'Nghe nói ông HLV đó bị bắt vì bán độ rồi đó.', emote: null, product: false },
      { speaker: 'tu', text: 'Thôi em không rành, để em đọc rồi nói.', emote: null, product: false },
      { speaker: 'phat', text: 'Ừ, giờ lo deadline đi.', emote: null, product: false },
    ],
    summary: 'Tám chuyện.',
  }))));
  const r5 = await v3.generateScene(sceneReq({ type: 'pantry_chat', participants: ['phat', 'tu'], situation: 'Tám chuyện ở pantry.', topicHint: 'nghe nói HLV bị thay giữa mùa (báo X đăng)' }), ctx, 'llm');
  check('topicHint "nghe nói …" (không thẻ tin) vẫn bật lưới an toàn: câu "bị bắt vì bán độ" bị bỏ', r5.source === 'llm' && r5.lines.length === 2 && r5.lines.every((l) => !/bị bắt/.test(l.text)),
    r5.lines.map((l) => l.text).join(' | '));
  // tin len vào tám chuyện (pantry_chat có req.news): prompt có thẻ TIN + luật + dòng "chuyện xen vào"
  const hinted = buildSceneUserPrompt(sceneReq({ type: 'pantry_chat', participants: ['phat', 'tu'], situation: 'Tám chuyện ở pantry.', news: NEWS }), ctx);
  check('pantry_chat kèm req.news: prompt có thẻ TIN, LUẬT TIN THẬT và dòng "chuyện xen vào lúc tám"', /^TIN \(thật/m.test(hinted) && /LUẬT TIN THẬT/.test(hinted) && /chuyện xen vào lúc tám/.test(hinted));
  // mọi câu đều vi phạm → không còn gì để diễn → thoại offline (an toàn)
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: [
      { speaker: 'phat', text: 'Ông đó bị bắt rồi, báo nói vậy.', emote: null, product: false },
      { speaker: 'tu', text: 'Chắc lừa đảo gì đó anh.', emote: null, product: false },
    ],
    summary: 'Tin đồn.',
  }))));
  const f0 = v3.usage().failures;
  const r2 = await v3.generateScene(newsReq, ctx, 'llm');
  check('mọi câu vi phạm → fallback offline, lastError nói rõ "luật tin thật"', r2.source === 'offline' && v3.usage().failures === f0 + 1 && /luật tin thật/.test(v3.usage().lastError ?? ''), v3.usage().lastError);
  // offline: ≥ 30 mẫu, chỉ dùng tiêu đề + nguồn
  const seen = new Set<string>();
  let safe = true, mentionTitle = 0, mentionSource = 0, runs = 0;
  for (let i = 0; i < 12; i++) {
    const off = await v3.generateScene(sceneReq({
      type: 'news_chat', participants: i % 2 ? ['phat', 'tu', 'bao'] : ['tram', 'linh'], locationLabel: 'Góc chill', news: { ...NEWS, category: (['bong_da', 'game', 'giai_tri', 'cong_nghe', 'the_thao', 'khoa_hoc'] as const)[i % 6] },
      situation: 'Tám chuyện thời sự ở góc chill.', minLines: 4, maxLines: 8, allowedEffects: ['relationship', 'mood', 'memory'],
    }), ctx, 'offline');
    runs++;
    if (off.lines.length < 4 || off.source !== 'offline') safe = false;
    for (const l of off.lines) { seen.add(l.text.replace(NEWS.title, '').replace(/\s+/g, ' ')); if (!isNewsSafe(l.text)) safe = false; }
    if (off.lines.some((l) => l.text.includes(NEWS.title))) mentionTitle++;
    if (off.lines.some((l) => l.text.includes('VnExpress'))) mentionSource++;
  }
  check('offline news_chat: ≥ 4 câu, luôn nhắc đúng tiêu đề, thường nhắc nguồn, không câu nào vi phạm', safe && mentionTitle === runs && mentionSource >= runs * 0.6, `title ${mentionTitle}/${runs}, source ${mentionSource}/${runs}`);
  check('offline news_chat: đa dạng mẫu câu (≥ 30 câu khác nhau sau 12 cảnh)', seen.size >= 30, `${seen.size} câu khác nhau`);
}

// ---------------------------------------------------------------- 11. hr_review
section('11. v3 — hr_review: hồ sơ trong prompt, quyết định lọc theo "được phép"');
{
  const capsPrompt = buildSceneUserPrompt(sceneReq({ type: 'hr_review', participants: ['ngoc', 'hung'], situation: 'Họp xét.', hrDossier: [
    { id: 'tu', name: 'Tú', roleLabel: 'Nhân viên Sales', kpiRatios: [0.6], lowStreak: 1, warnings: 0, caughtToday: 0, hiredDay: 1, mood: 50, stress: 40, attitude: '', allowed: ['none', 'warn'] },
  ], allowedEffects: ['memory', 'decisions'] }), ctx);
  check('prompt hr_review nói rõ TRẦN 1 LẦN HỌP (≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise+bonus, ≤ 4) và yêu cầu thoại nói tiếng Việt', /TRẦN 1 LẦN HỌP/.test(capsPrompt)
    && /≤ 1 fire\/layoff/.test(capsPrompt) && /≤ 2 praise\+bonus/.test(capsPrompt) && /≤ 4 quyết định/.test(capsPrompt) && /không đọc mã action/.test(capsPrompt));
  const dossier: NonNullable<SceneRequest['hrDossier']> = [
    { id: 'tu', name: 'Tú', roleLabel: 'Nhân viên Sales', kpiRatios: [0.62, 0.55, 0.71, 0.4, 0.38], lowStreak: 3, warnings: 1, caughtToday: 2, hiredDay: 1, mood: 31, stress: 70, attitude: 'Hay chống chế, lướt game trong giờ', allowed: ['none', 'warn', 'probation', 'second_chance'] },
    { id: 'bao', name: 'Bảo', roleLabel: 'Fresher Developer', kpiRatios: [1.1, 1.2, 1.05], lowStreak: 0, warnings: 0, caughtToday: 0, hiredDay: 1, mood: 80, stress: 30, attitude: 'Chăm, hay hỏi', allowed: ['none', 'praise', 'bonus'] },
    { id: 'khoa', name: 'Khoa', roleLabel: 'Tech Lead', kpiRatios: [1, 1, 1], lowStreak: 0, warnings: 0, caughtToday: 0, hiredDay: 1, mood: 70, stress: 50, attitude: 'Gánh team', allowed: ['none'] },
    { id: 'vy', name: 'Vy', roleLabel: 'QA Tester', kpiRatios: [0.9, 0.8], lowStreak: 0, warnings: 0, caughtToday: 0, hiredDay: 1, mood: 65, stress: 40, attitude: 'Soi bug kỹ', allowed: ['none', 'warn'] },
    { id: 'linh', name: 'Linh', roleLabel: 'UI/UX Designer', kpiRatios: [1.0], lowStreak: 0, warnings: 0, caughtToday: 0, hiredDay: 1, mood: 75, stress: 35, attitude: 'Tinh tế', allowed: ['none', 'praise'] },
  ];
  const hrReq = sceneReq({
    type: 'hr_review', channel: 'office', participants: ['ngoc', 'hung'], locationLabel: 'Phòng sếp', hrDossier: dossier,
    situation: 'Ngọc (HR) mang sổ vào phòng sếp Hùng họp kín xét nhân sự định kỳ.', minLines: 4, maxLines: 7,
    allowedEffects: ['memory', 'decisions'], priority: 'high',
  });
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({
    lines: twoLines('ngoc', 'hung'),
    summary: 'Ngọc và sếp Hùng họp xét nhân sự.',
    hrDecisions: [
      { id: 'tu', action: 'fire', reason: 'Lười quá' },
      { id: 'tu', action: 'warn', reason: 'Trùng id, phải bị bỏ' },
      { id: 'Bảo', action: 'praise', reason: 'Chăm chỉ, KPI cao' },
      { id: 'ghost', action: 'warn', reason: 'Không có trong hồ sơ' },
      { id: 'khoa', action: 'promote', reason: 'Gánh team' },
      { id: 'ngoc', action: 'bonus', reason: 'HR tự thưởng mình' },
      { id: 'vy', action: 'cảnh cáo', reason: 'Alias tiếng Việt' },
      { id: 'linh', action: 'yeet', reason: 'Action lạ' },
    ],
  }))));
  const req0 = requests.length;
  const r = await v3.generateScene(hrReq, ctx, 'llm');
  const user = userOf(requests[req0]);
  check('prompt có HỒ SƠ NHÂN SỰ 1 dòng/người với KPI, tình trạng, thái độ, được phép', /HỒ SƠ NHÂN SỰ/.test(user)
    && /- \[tu\] Tú · Sales · KPI 62→55→71→40→38% · thấp 3 ngày liền, đã nhắc 1 lần, bị bắt lười 2 lần hôm nay, tâm trạng 31, stress 70 · Hay chống chế, lướt game trong giờ · được phép: none, warn, probation, second_chance/.test(user),
    user.split('\n').find((l) => l.startsWith('- [tu]')) ?? '');
  check('người bình thường: không ghi thể trạng (gọn)', /- \[khoa\] Khoa · Tech Lead · KPI 100→100→100% · Gánh team · được phép: none/.test(user), user.split('\n').find((l) => l.startsWith('- [khoa]')) ?? '');
  check('prompt giải nghĩa action + yêu cầu hrDecisions theo "được phép"; bỏ ĐÃ DIỄN cho gọn; NGƯỜI KHÁC chỉ còn người ngoài hồ sơ', /Action: warn=nhắc, second_chance=thêm cơ hội/.test(user) && /TRẦN 1 LẦN HỌP/.test(user) && /hrDecisions: mỗi người trong HỒ SƠ đúng 1 mục/.test(user) && /verdict: null/.test(user) && !/ĐÃ DIỄN GẦN ĐÂY/.test(user)
    && /NGƯỜI KHÁC[^\n]*Tùng/.test(user) && !/NGƯỜI KHÁC[^\n]*Tú \(/.test(user), user.split('\n').find((l) => l.startsWith('NGƯỜI KHÁC')) ?? '');
  const d = Object.fromEntries((r.hrDecisions ?? []).map((x) => [x.id, x.action]));
  check('nguồn llm, 5 quyết định (ghost + ngoc bị bỏ, tu không trùng)', r.source === 'llm' && r.hrDecisions?.length === 5 && !('ghost' in d) && !('ngoc' in d), JSON.stringify(d));
  check('tu: fire không được phép → none (mục trùng bị bỏ)', d.tu === 'none');
  check('"Bảo" (tên) → bao: praise được phép', d.bao === 'praise');
  check('khoa: promote không được phép → none', d.khoa === 'none');
  check('vy: "cảnh cáo" → warn (alias)', d.vy === 'warn');
  check('linh: action lạ → none', d.linh === 'none');
  check('reason được giữ/cắt, có mặc định khi none', (r.hrDecisions ?? []).every((x) => x.reason.length > 0 && x.reason.length <= 100));
  // đề xuất ngoài hàng rào → none nhưng reason giữ dấu vết "ngoài hàng rào (<action>)" để Director kể lại "sếp đổi ý…" (thoại đã hứa)
  const reasonOf = (id: string) => (r.hrDecisions ?? []).find((x) => x.id === id)?.reason ?? '';
  check('đề xuất ngoài "được phép" để lại dấu vết trong reason (tu: fire, khoa: promote); mục hợp lệ không có dấu vết',
    /^ngoài hàng rào \(fire\): Lười quá/.test(reasonOf('tu')) && /^ngoài hàng rào \(promote\)/.test(reasonOf('khoa')) && !/ngoài hàng rào/.test(reasonOf('bao')),
    `tu: ${reasonOf('tu')} · khoa: ${reasonOf('khoa')} · bao: ${reasonOf('bao')}`);
  // offline hr_review: quyết định xác suất trong "được phép"
  let okAll = true, nonNone = 0, total = 0;
  for (let i = 0; i < 15; i++) {
    const off = await v3.generateScene(hrReq, ctx, 'offline');
    if (off.source !== 'offline' || !Array.isArray(off.hrDecisions) || off.lines.length < 4) { okAll = false; continue; }
    const ids = new Set<string>();
    for (const x of off.hrDecisions) {
      total++;
      if (x.action !== 'none') nonNone++;
      const row = dossier.find((e) => e.id === x.id);
      if (!row || ids.has(x.id) || (x.action !== 'none' && !row.allowed.includes(x.action)) || !x.reason) okAll = false;
      ids.add(x.id);
    }
    if (off.hrDecisions.length > 6) okAll = false;
  }
  check('offline hr_review: mọi quyết định ∈ được phép, ≤ 1/người, ≤ 6, có lý do; không phải lúc nào cũng none', okAll && nonNone > 0 && nonNone < total, `${nonNone}/${total} quyết định khác none`);
  const offNo = await v3.generateScene({ ...hrReq, hrDossier: [] }, ctx, 'offline');
  check('offline hr_review không có hồ sơ: vẫn có thoại, hrDecisions = []', offNo.lines.length >= 4 && Array.isArray(offNo.hrDecisions) && offNo.hrDecisions.length === 0);
  const other = await v3.generateScene(sceneReq(), ctx, 'offline');
  check('cảnh khác: hrDecisions = null', other.hrDecisions === null);
}

// ---------------------------------------------------------------- 12. verdict theo loại cảnh
section('12. v3 — verdict: resign_talk stay/leave, raise_request approved/denied, mặc định khi model không trả');
{
  const resign = sceneReq({ type: 'resign_talk', participants: ['tu', 'ngoc'], locationLabel: 'Phòng họp nhỏ', situation: 'Tú chán việc, xin gặp Ngọc (HR) nói chuyện nghỉ việc.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory', 'verdict'] });
  const raise = sceneReq({ type: 'raise_request', participants: ['khoa', 'hung'], locationLabel: 'Phòng sếp', situation: 'Khoa lên phòng sếp Hùng xin tăng lương.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory', 'verdict'] });
  const cases: [SceneRequest, unknown, string, string][] = [
    [resign, null, 'stay', 'resign_talk: null → stay (mặc định)'],
    [resign, 'leave', 'leave', 'resign_talk: "leave" giữ nguyên'],
    [resign, 'ở lại', 'stay', 'resign_talk: "ở lại" → stay'],
    [resign, 'hired', 'stay', 'resign_talk: giá trị của loại khác → mặc định stay'],
    [raise, 'approved', 'approved', 'raise_request: "approved" giữ nguyên'],
    [raise, 'maybe later', 'denied', 'raise_request: lạ → denied (mặc định)'],
    [raise, 'đồng ý', 'approved', 'raise_request: "đồng ý" → approved'],
    [sceneReq({ type: 'interview', participants: ['ngoc', 'tu'], allowedEffects: ['verdict'] }), 'rejected', 'rejected', 'interview: "rejected" vẫn như cũ'],
  ];
  for (const [req, v, expect, label] of cases) {
    script.push((_r, res) => sendJson(res, 200, completion(sceneJson({ lines: twoLines(req.participants[0], req.participants[1]), summary: 'x', verdict: v }))));
    const r = await v3.generateScene(req, ctx, 'llm');
    check(label, r.source === 'llm' && r.verdict === expect, `verdict=${String(r.verdict)}`);
  }
  script.push((_r, res) => sendJson(res, 200, completion(sceneJson({ lines: twoLines('hung', 'bao'), summary: 'x', verdict: 'approved', hrDecisions: [{ id: 'bao', action: 'promote', reason: 'x' }] }))));
  const promo = await v3.generateScene(sceneReq({ type: 'promotion', participants: ['hung', 'bao', 'tung'], aboutId: 'bao', locationLabel: 'Giữa văn phòng', situation: 'Sếp Hùng công bố thăng chức cho Bảo trước mọi người.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), ctx, 'llm');
  check('promotion: verdict null, hrDecisions null dù model trả bừa', promo.verdict === null && promo.hrDecisions === null);
  check('prompt resign_talk/raise_request có hướng dẫn verdict + định hướng {A} là nhân viên', (() => {
    const u1 = buildSceneUserPrompt(resign, ctx), u2 = buildSceneUserPrompt(raise, ctx);
    return /verdict: "stay" hoặc "leave"/.test(u1) && /Tú chán việc/.test(u1) && /verdict: "approved" hoặc "denied"/.test(u2) && /Khoa xin tăng lương/.test(u2) && /chúng ta là một gia đình/.test(u2);
  })());
  // offline: kết quả hợp lệ theo loại, có đủ thoại
  const counts = { stay: 0, leave: 0, approved: 0, denied: 0 };
  let okOff = true;
  for (let i = 0; i < 12; i++) {
    const a = await v3.generateScene(resign, ctx, 'offline');
    const z = await v3.generateScene(raise, ctx, 'offline');
    if (a.verdict !== 'stay' && a.verdict !== 'leave') okOff = false; else counts[a.verdict]++;
    if (z.verdict !== 'approved' && z.verdict !== 'denied') okOff = false; else counts[z.verdict]++;
    if (a.lines.length < 4 || z.lines.length < 4) okOff = false;
  }
  check('offline resign_talk / raise_request: verdict đúng loại, ≥ 4 câu', okOff, JSON.stringify(counts));
  const offPromo = await v3.generateScene(sceneReq({ type: 'promotion', participants: ['hung', 'bao', 'tung', 'vy'], aboutId: 'bao', locationLabel: 'Giữa văn phòng', situation: 'Sếp Hùng công bố thăng chức cho Bảo trước mọi người.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), ctx, 'offline');
  const offLayoff = await v3.generateScene(sceneReq({ type: 'layoff', participants: ['hung', 'ngoc', 'tu', 'phat'], aboutId: 'tu', locationLabel: 'Phòng sếp', situation: 'Công ty lỗ, sếp Hùng và Ngọc báo tin cắt giảm cho Tú, Phát ngồi cùng.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), ctx, 'offline');
  check('offline promotion: sếp công bố, Bảo cảm ơn, đồng nghiệp phản ứng; verdict null', offPromo.lines.length >= 4 && offPromo.verdict === null && offPromo.lines[0].speaker === 'hung' && offPromo.lines.some((l) => l.speaker === 'bao') && offPromo.moodChanges.some((m) => m.id === 'bao' && m.delta > 0), offPromo.lines.map((l) => `${l.speaker}: ${l.text}`).join(' | '));
  check('offline layoff: sếp mở lời, Tú phản ứng, đồng nghiệp buồn; verdict null', offLayoff.lines.length >= 4 && offLayoff.verdict === null && offLayoff.lines[0].speaker === 'hung' && offLayoff.lines.some((l) => l.speaker === 'tu') && offLayoff.moodChanges.some((m) => m.id === 'tu' && m.delta < 0), offLayoff.lines.map((l) => `${l.speaker}: ${l.text}`).join(' | '));
}

// ---------------------------------------------------------------- 12b. v5 — tình huống công ty
section('12b. v5 — crisis_meeting chốt mã phương án, pep_talk inspired/unmoved, offline khớp lựa chọn dự phòng');
{
  const options = [
    { code: 'plan_a', label: 'thắt lưng buộc bụng: tạm dừng trà sữa thứ Sáu' },
    { code: 'plan_b', label: 'dồn sức đòi công nợ, sales chạy hết công suất' },
    { code: 'plan_c', label: 'nói thẳng với anh em: lương trễ vài ngày' },
  ];
  const meet = sceneReq({
    type: 'crisis_meeting', participants: ['hung', 'ngoc', 'phat'], locationLabel: 'Phòng họp', minLines: 5, maxLines: 9,
    situation: 'Sếp Hùng triệu tập họp kín vì chuyện kẹt tiền xoay vòng vốn.', allowedEffects: ['verdict', 'mood', 'relationship', 'memory'],
    crisis: { kind: 'cash_crunch', title: 'Kẹt tiền xoay vòng vốn', note: 'Khách lớn chậm thanh toán', options, pick: 'plan_c' },
  });
  const pep = sceneReq({
    type: 'pep_talk', participants: ['hung', 'tu', 'vy'], locationLabel: 'Phòng họp', minLines: 4, maxLines: 8,
    situation: 'Sếp Hùng gom mọi người vào phòng họp làm công tác tư tưởng.', allowedEffects: ['verdict', 'mood', 'relationship', 'memory'],
    crisis: { kind: 'morale_talk', title: 'Sếp làm công tác tư tưởng', note: 'Tinh thần anh em đi xuống', pick: 'unmoved', variant: 'all', topic: 'vực lại tinh thần' },
  });
  const cases: [SceneRequest, unknown, string | null, string][] = [
    [meet, 'plan_b', 'plan_b', 'crisis_meeting: "plan_b" giữ nguyên'],
    [meet, 'Phương án C', 'plan_c', 'crisis_meeting: "Phương án C" → plan_c'],
    [meet, 'bỏ qua', null, 'crisis_meeting: rác → null (Director dùng lựa chọn dự phòng)'],
    [pep, 'inspired', 'inspired', 'pep_talk: "inspired" giữ nguyên'],
    [pep, 'chưa thuyết phục được', 'unmoved', 'pep_talk: "chưa thuyết phục được" → unmoved'],
    [pep, null, null, 'pep_talk: null → null'],
    // phủ định ngay trước từ "tốt" (rà soát 2026-11-03: trước đây "chưa xuôi" / "not moved" bị đọc thành inspired)
    [pep, 'chưa xuôi', 'unmoved', 'pep_talk: "chưa xuôi" → unmoved'],
    [pep, 'not moved', 'unmoved', 'pep_talk: "not moved" → unmoved'],
    [pep, 'xuôi rồi', 'inspired', 'pep_talk: "xuôi rồi" → inspired'],
    // phủ định cách từ "tốt" 1–3 từ (rà soát vòng 3): "chưa đủ thuyết phục", "not really convinced"
    [pep, 'chưa đủ thuyết phục', 'unmoved', 'pep_talk: "chưa đủ thuyết phục" → unmoved'],
    [pep, 'not really convinced', 'unmoved', 'pep_talk: "not really convinced" → unmoved'],
    // phủ định từ "xấu" → giá trị tốt
    [sceneReq({ type: 'resign_talk', participants: ['tu', 'ngoc'], locationLabel: 'Phòng họp nhỏ', situation: 'Tú chán việc, xin gặp Ngọc (HR) nói chuyện nghỉ việc.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory', 'verdict'] }),
      'không nghỉ việc nữa', 'stay', 'resign_talk: "không nghỉ việc nữa" → stay'],
    // trả số thứ tự → phương án thứ n TRONG DANH SÁCH đã đưa (bỏ chữ cái: a, c, d → "2" là plan_c)
    [{ ...meet, crisis: { ...meet.crisis!, options: [options[0], options[2], { code: 'plan_d', label: 'sếp bỏ tiền túi' }] } }, '2', 'plan_c', 'crisis_meeting: "2" với phương án a/c/d → plan_c (theo thứ tự đã đưa)'],
    // số vượt danh sách → đọc như chữ cái nếu phương án đó có trong danh sách, không thì null
    [{ ...meet, crisis: { ...meet.crisis!, options: [options[0], options[2]] } }, '3', 'plan_c', 'crisis_meeting: "3" với phương án a/c → plan_c (đọc như chữ cái c)'],
    [{ ...meet, crisis: { ...meet.crisis!, options: [options[0], options[2]] } }, '4', null, 'crisis_meeting: "4" với phương án a/c → null'],
  ];
  for (const [req, v, expect, label] of cases) {
    script.push((_r, res) => sendJson(res, 200, completion(sceneJson({ lines: twoLines(req.participants[0], req.participants[1]), summary: 'x', verdict: v }))));
    const r = await v3.generateScene(req, ctx, 'llm');
    check(label, r.source === 'llm' && r.verdict === expect, `verdict=${String(r.verdict)}`);
  }
  check('prompt crisis_meeting: khối PHƯƠNG ÁN đủ mã + dòng verdict liệt kê đúng 3 mã', (() => {
    const u = buildSceneUserPrompt(meet, ctx);
    return /PHƯƠNG ÁN \(chốt đúng 1, ghi mã vào verdict\): plan_a = thắt lưng/.test(u) && /plan_c = nói thẳng/.test(u)
      && /verdict: một trong "plan_a" \| "plan_b" \| "plan_c"/.test(u) && !/plan_d/.test(u);
  })());
  check('prompt pep_talk: có BỐI CẢNH + verdict inspired/unmoved', (() => {
    const u = buildSceneUserPrompt(pep, ctx);
    return /BỐI CẢNH: Sếp làm công tác tư tưởng/.test(u) && /verdict: "inspired" hoặc "unmoved"/.test(u);
  })());
  let okMeet = true, okPep = true;
  for (let i = 0; i < 8; i++) {
    const m = await v3.generateScene(meet, ctx, 'offline');
    if (m.verdict !== 'plan_c' || m.lines.length < 4 || !m.lines.some((l) => /lương trễ vài ngày/.test(l.text))) okMeet = false;
    const z = await v3.generateScene(pep, ctx, 'offline');
    if (z.verdict !== 'unmoved' || z.lines.length < 4 || z.lines[0].speaker !== 'hung') okPep = false;
  }
  check('offline crisis_meeting: verdict = lựa chọn dự phòng, câu chốt nhắc đúng phương án', okMeet);
  check('offline pep_talk: verdict = lựa chọn dự phòng, sếp mở lời, ≥ 4 câu', okPep);
  // v4/v5: dò con số giá (rà soát 2026-11-03: trước đây lọt "5tr7", "199.000₫", "1.290.000"; bắt nhầm "20k view", "1 đồng nghiệp")
  const priceYes = ['có 5tr7 thôi', 'giá 1tr2 à', '199.000₫', '₫199.000', 'có 1.290.000 à', '390k', '1,05tr', '2 triệu', '150.000đ',
    '390k like new', '199.000', '1290000', '2 trăm nghìn'];
  const priceNo = ['màn 2K', '4K nét', '27 inch', '3 tháng', '210Hz', '20.000mAh', '20k view', '1 triệu lượt xem', '10k bước', '1 đồng nghiệp', '2 củ khoai', '8.000 bước',
    '1tr7 view', '300 likes', '3 người xem', '12 lần', '1600 dpi'];
  check('hasPrice: bắt mọi kiểu giá, không bắt số đếm / thông số', priceYes.every(hasPrice) && !priceNo.some(hasPrice),
    `lọt: ${priceYes.filter((t) => !hasPrice(t)).join(' | ') || '—'} · bắt nhầm: ${priceNo.filter(hasPrice).join(' | ') || '—'}`);
}

// ---------------------------------------------------------------- 12c. thoại offline: sản phẩm, hỏi han, họp, truyền lửa
section('12c. Thoại offline — sản phẩm (không nhận vơ "đã xài", cớ đúng ngữ pháp, không lặp tên), hỏi han / thương lượng, họp, truyền lửa');
{
  const fold = (t: string) => t.normalize('NFC').toLowerCase();
  /** câu nhắc lại tên gọi đời thường lần 2 ("lót chuột hình mèo, vải in hình mèo") */
  const repeatsName = (text: string, short: string): boolean => {
    const t = fold(text), sh = fold(short);
    const i = t.indexOf(sh);
    if (i < 0) return false;
    const rest = `${t.slice(0, i)} ${t.slice(i + sh.length)}`;
    const w = sh.split(/\s+/).filter(Boolean);
    for (let k = 0; k + 1 < w.length; k++) if (rest.includes(`${w[k]} ${w[k + 1]}`)) return true;
    return false;
  };
  const CLAIM_MENTION = /mới mua|xài rồi|săn được|xài thấy ok|mới chốt đơn|mới đặt|xài sướng|từ hồi có/iu;
  const BAD_HOOK = /hoài|quá trời|hay than|cũng vậy nè/iu;
  const prods = getProducts();
  const themeHooks = SHOPPING_THEMES.map((t) => t.hook);
  const bad: string[] = [];
  let n = 0;
  const base = (p: (typeof prods)[number]) => ({
    id: p.id, name: p.name, pitch: p.pitch, short: shortNameOf(p),
    ...(p.spoken ? { spoken: p.spoken } : {}), ...(p.facts ? { facts: p.facts } : {}), ...(p.avoid ? { avoid: p.avoid } : {}),
  });
  for (const p of prods) {
    const short = shortNameOf(p);
    for (const hook of ['', ...(p.hooks ?? []), ...themeHooks]) {
      for (const [type, channel] of [['pantry_chat', 'office'], ['group_chat', 'group'], ['celebration', 'office']] as const) {
        const r = offlineScene(sceneReq({
          type, channel, participants: ['tram', 'tung', 'vy'], locationLabel: channel === 'group' ? 'Nhóm Zalo "Anh em văn phòng"' : 'Pantry',
          situation: 'Ba người tám chuyện lúc nghỉ tay.', minLines: 4, maxLines: 8,
          product: { ...base(p), preferSpeaker: 'tram', mode: 'mention', ...(hook ? { hook } : {}) },
        }), ctx);
        n++;
        const pl = r.lines.filter((l) => l.product);
        if (pl.length !== 1) { bad.push(`${p.id}/${type}: ${pl.length} câu sản phẩm`); continue; }
        const t = pl[0].text;
        if (CLAIM_MENTION.test(t) && !CLAIM_MENTION.test(hook)) bad.push(`nhận vơ (${p.id}/${type}): ${t}`);
        if (BAD_HOOK.test(t) && !BAD_HOOK.test(hook)) bad.push(`cớ sai ngữ pháp (${p.id}/${type}): ${t}`);
        if (t.length > 200) bad.push(`dài ${t.length} (${p.id})`);
        if (!hook && repeatsName(t, short)) bad.push(`lặp tên (${p.id}/${type}): ${t}`);
      }
    }
  }
  check(`offline câu sản phẩm (chưa có món) × ${n}: đúng 1 câu, không "mới mua / xài rồi", cớ đúng ngữ pháp, không lặp tên, ≤ 200 ký tự`, !bad.length, bad.slice(0, 4).join(' | '));

  // phòng trưng bày: người khoe chưa có món (showroom) → không câu nào kể đã dùng; đã có (owner) → người đó kể, không "để trong giỏ"
  const CLAIM_SHOWROOM = /xài thấy được|xài rồi mới dám|mang cái ở nhà|kể trải nghiệm|đồ nào mới mua|shop gửi đồ|xài thiệt hay|được một thời gian|mua rồi nè|ưng nhất kệ|y chang ở nhà|về mới thấy|xài lâu rồi/iu;
  const BUYER_TALK = /giỏ hàng hai tuần|đang tính rinh về|mê cái|xem review cái/iu;
  const srBad: string[] = [];
  for (let i = 0; i < 4 * prods.length; i++) {
    const p = prods[i % prods.length];
    const req = (mode: 'showroom' | 'owner') => sceneReq({
      type: 'showroom_chat', participants: ['tram', 'tung', 'vy'], locationLabel: 'Kệ công nghệ & nhà cửa',
      situation: 'Trâm, Tùng, Vy đứng trước kệ ở phòng trưng bày.', minLines: 4, maxLines: 8,
      product: { ...base(p), preferSpeaker: 'tram', mode },
    });
    const a = offlineScene(req('showroom'), ctx);
    for (const l of a.lines) if (CLAIM_SHOWROOM.test(l.text)) srBad.push(`chưa có mà kể đã dùng: ${l.speaker}: ${l.text}`);
    if (a.lines.filter((l) => l.product).length !== 1) srBad.push(`showroom ${p.id}: không đúng 1 câu sản phẩm`);
    const b = offlineScene(req('owner'), ctx);
    if (!b.lines.some((l) => l.product && l.speaker === 'tram')) srBad.push(`owner ${p.id}: người có món không có câu sản phẩm`);
    for (const l of b.lines) if (l.speaker === 'tram' && BUYER_TALK.test(l.text)) srBad.push(`owner nói như chưa mua: ${l.text}`);
  }
  check(`offline showroom_chat × ${8 * prods.length}: người chưa có món không kể "đã xài"; người đã có kể lại, không "để trong giỏ hàng"`, !srBad.length, srBad.slice(0, 4).join(' | '));

  // hỏi han riêng: hướng đã chốt nói với chính người đó (không viết thường tên, không gọi tên ngôi thứ ba); thương lượng có lời riêng
  const sup = (why: string) => sceneReq({
    type: 'desk_visit', participants: ['ngoc', 'tu'], locationLabel: 'Bàn của Tú', minLines: 4, maxLines: 7,
    situation: `Ngọc (HR) đi tới bàn Tú (Backend Developer) để ${why}. Lúc đó Tú đang code. Mục tiêu: nói chuyện riêng, nhỏ nhẹ: Ngọc hỏi han.`,
  });
  let okSup = true, okDeal = true, okConsole = true;
  const supSample: string[] = [];
  for (let i = 0; i < 12; i++) {
    const r1 = offlineScene(sup('cho Tú nghỉ phép vài hôm, team chia nhau gánh việc'), ctx);
    const txt1 = r1.lines.map((l) => l.text).join(' | ');
    if (!/nghỉ phép vài hôm/.test(txt1) || /(?<![\p{L}])tú(?![\p{L}])/u.test(txt1)) { okSup = false; supSample.push(txt1); }
    const r2 = offlineScene(sup('thương lượng: Tú được như ý nhưng nhận thêm việc khác bù lại'), ctx);
    const txt2 = r2.lines.map((l) => l.text).join(' | ');
    if (!/được như ý/.test(txt2) || /thương lượng:/.test(txt2) || /lo cho mình trước|đừng ôm một mình/.test(txt2)) { okDeal = false; supSample.push(txt2); }
    const r3 = offlineScene(sup('hỏi han vì thấy dạo này khác lạ'), ctx);
    if (r3.lines.some((l) => /bàn rồi nè|khỏi lo:/.test(l.text))) { okConsole = false; supSample.push(r3.lines.map((l) => l.text).join(' | ')); }
  }
  check('offline hỏi han: nói hướng đã chốt với chính người đó (không viết thường / gọi tên "tú")', okSup, supSample[0] ?? '');
  check('offline thương lượng (chống đối): lời thương lượng riêng, không an ủi, không lộ nhãn "thương lượng:"', okDeal, supSample[0] ?? '');
  check('offline hỏi han khi công ty chưa có hướng: không nói "mọi người bàn rồi"', okConsole, supSample[0] ?? '');

  // họp xử lý: câu "triển khai liền" không đứng trước câu chốt; câu đệm của chủ trì do chủ trì nói
  const meet = sceneReq({
    type: 'crisis_meeting', participants: ['hung', 'ngoc', 'phat', 'khoa'], locationLabel: 'Phòng họp', minLines: 8, maxLines: 10,
    situation: 'Sếp Hùng triệu tập họp kín vì chuyện kẹt tiền xoay vòng vốn.', allowedEffects: ['verdict', 'mood', 'relationship', 'memory'],
    crisis: { kind: 'cash_crunch', title: 'Kẹt tiền xoay vòng vốn', note: 'Khách lớn chậm thanh toán', options: [{ code: 'plan_a', label: 'thắt lưng buộc bụng' }, { code: 'plan_c', label: 'nói thẳng với anh em: lương trễ vài ngày' }], pick: 'plan_c' },
  });
  const CHAIR_FILL = /^(Ừ, nói tiếp đi|Còn ai ý kiến gì nữa không|Từ từ, từng người một|Nói ngắn gọn thôi, mình còn phải quyết)/u;
  const OK_LINE = /triển khai liền|lo phần của|báo anh em nhẹ nhàng|cập nhật liên tục/u;
  let okCm = true;
  const cmSample: string[] = [];
  // họp 2 người: thành viên nói liền 2 câu → câu đệm chen giữa do chủ trì nói, nằm TRƯỚC câu chốt
  const meet2 = { ...meet, participants: ['hung', 'ngoc'], minLines: 6, maxLines: 8 };
  for (let i = 0; i < 60; i++) {
    const r = offlineScene(i % 2 ? meet2 : meet, ctx);
    const di = r.lines.findIndex((l) => /lương trễ vài ngày/.test(l.text));
    const early = r.lines.slice(0, Math.max(0, di)).some((l) => OK_LINE.test(l.text));
    const wrongChair = r.lines.some((l) => CHAIR_FILL.test(l.text) && l.speaker !== 'hung');
    if (di < 0 || early || wrongChair) { okCm = false; cmSample.push(r.lines.map((l) => `${l.speaker}: ${l.text}`).join(' | ')); }
  }
  check('offline crisis_meeting (8–10 câu, có câu đệm): không "triển khai liền" trước câu chốt; câu đệm chủ trì do chủ trì nói', okCm, cmSample[0] ?? '');

  // truyền lửa: câu đệm của người nói không vào miệng người nghe; không gộp "…? Dạ, em nghe rồi" thành một bong bóng
  const pepReq = (variant: 'all' | 'one', pick: 'inspired' | 'unmoved') => sceneReq({
    type: 'pep_talk', participants: variant === 'all' ? ['hung', 'tu', 'vy', 'phat', 'bao'] : ['hung', 'tu'], locationLabel: 'Phòng họp',
    minLines: variant === 'all' ? 7 : 6, maxLines: 9,
    situation: 'Sếp Hùng làm công tác tư tưởng.', allowedEffects: ['verdict', 'mood', 'relationship', 'memory'],
    crisis: { kind: 'morale_talk', title: 'Sếp làm công tác tư tưởng', note: 'Tinh thần đi xuống', pick, variant, topic: 'vực lại tinh thần' },
  });
  const SPEAKER_FILL = /ai có ý gì cứ nói|Mình nói chuyện thẳng thắn|nói thẳng để|mong .* hiểu cho/u;
  let okPt = true;
  const ptSample: string[] = [];
  for (let i = 0; i < 30; i++) {
    for (const r of [offlineScene(pepReq('all', 'unmoved'), ctx), offlineScene(pepReq('one', i % 2 ? 'unmoved' : 'inspired'), ctx)]) {
      const wrong = r.lines.some((l) => l.speaker !== 'hung' && SPEAKER_FILL.test(l.text));
      const merged = r.lines.some((l) => /\?\s+(Dạ|Ờ)[,… ]/u.test(l.text));
      if (wrong || merged) { okPt = false; ptSample.push(r.lines.map((l) => `${l.speaker}: ${l.text}`).join(' | ')); }
    }
  }
  check('offline pep_talk: câu đệm đúng vai (người nghe không "nói thẳng để … hiểu"), không gộp câu hỏi với câu kết', okPt, ptSample[0] ?? '');
}

// ---------------------------------------------------------------- 13. generateBeats
section('13. v3 — generateBeats: parse + lọc theo menu/nhân sự, fallback offline, không ai xem');
{
  const beatReq: BeatRequest = {
    situation: 'Dự án trễ hạn 1 ngày; Khoa và Phát cự nhau vì khách đòi thêm tính năng; Trâm vừa có clip viral; doanh thu 320/1500 triệu.',
    menu: [
      { kind: 'conflict', desc: 'hai người cãi nhau vì việc' }, { kind: 'viral', desc: 'clip marketing bất ngờ nổi' },
      { kind: 'big_bug', desc: 'bug lớn trên production' }, { kind: 'client_angry', desc: 'khách hàng nổi giận' },
      { kind: 'secret_friendship', desc: 'hai người bí mật thân nhau' },
    ],
    openArcs: ['Khoa–Phát căng vì tính năng khách hứa (từ ngày 2)'],
    recentBeats: ['viral(tram): clip 1 triệu view'],
    roster: ctx.roster,
  };
  script.push((_r, res) => sendJson(res, 200, completion(JSON.stringify({
    beats: [
      { kind: 'Conflict', a: 'khoa', b: 'Phát', intensity: 7, note: 'Khoa cự Phát vì hứa khách tính năng chưa có' },
      { kind: 'alien_invasion', a: 'tu', b: null, intensity: 1, note: 'Người ngoài hành tinh' },
      { kind: 'conflict', a: 'khoa', b: 'phat', intensity: 2, note: 'Trùng, phải bị bỏ' },
      { kind: 'client_angry', a: 'ghost', b: 'tu', intensity: '2', note: '' },
      { kind: 'big_bug', a: 'tung', b: 'tung', intensity: 1, note: 'Tùng đẩy bug lên production' },
    ],
  }), { prompt_tokens: 650, completion_tokens: 90, total_tokens: 740 })));
  const req0 = requests.length;
  const calls0 = v3.usage().calls;
  const plan = await v3.generateBeats(beatReq, ctx);
  const sent = requests[req0];
  const user = userOf(sent), sys = systemOf(sent);
  check('1 request, schema ke_hoach_bien, max_completion_tokens 450', requests.length === req0 + 1 && JSON.stringify(sent.body.response_format).includes('ke_hoach_bien') && sent.body.max_completion_tokens === 450);
  check('system riêng cho biên kịch (không phải system cảnh)', /biên kịch trưởng/.test(sys) && !/LUẬT CẢNH/.test(sys));
  check('user prompt: NHIỆM VỤ: BIẾN + TÌNH HÌNH + NHÂN SỰ + MENU + MẠCH + BIẾN GẦN ĐÂY', user.startsWith('NHIỆM VỤ: BIẾN') && /TÌNH HÌNH:/.test(user) && /NHÂN SỰ/.test(user) && /- conflict — hai người cãi nhau vì việc/.test(user) && /MẠCH ĐANG MỞ/.test(user) && /BIẾN GẦN ĐÂY/.test(user));
  const beatTokens = estimateTokens(sys) + estimateTokens(user);
  check('prompt biên kịch ≤ 700 token (system + user)', beatTokens <= 700, `${beatTokens} token`);
  check('kết quả llm, 3 biến (bỏ kind lạ + biến trùng)', plan.source === 'llm' && plan.beats.length === 3, JSON.stringify(plan.beats));
  check('biến 1: kind thường hoá, "Phát" → phat, intensity kẹp 3', plan.beats[0]?.kind === 'conflict' && plan.beats[0]?.a === 'khoa' && plan.beats[0]?.b === 'phat' && plan.beats[0]?.intensity === 3);
  check('biến 2: a lạ bị bỏ, b = tu, note trống → mô tả menu, intensity "2" → 2', plan.beats[1]?.kind === 'client_angry' && plan.beats[1]?.a === undefined && plan.beats[1]?.b === 'tu' && plan.beats[1]?.note === 'khách hàng nổi giận' && plan.beats[1]?.intensity === 2);
  check('biến 3: b trùng a → bỏ b', plan.beats[2]?.kind === 'big_bug' && plan.beats[2]?.a === 'tung' && plan.beats[2]?.b === undefined);
  check('tính vào usage (calls +1)', v3.usage().calls === calls0 + 1);
  // JSON hỏng → offline
  script.push((_r, res) => sendJson(res, 200, completion('{"beats": [ {"kind": "conflict"')));
  const plan2 = await v3.generateBeats(beatReq, ctx);
  const kinds = new Set(beatReq.menu.map((m) => m.kind));
  const ids = new Set(ctx.roster.map((r) => r.id));
  check('JSON hỏng → kế hoạch offline: 1–2 biến, kind trong menu, a/b là người thật, intensity 1..3, note tiếng Việt', plan2.source === 'offline' && plan2.beats.length >= 1 && plan2.beats.length <= 2
    && plan2.beats.every((b) => kinds.has(b.kind) && (!b.a || ids.has(b.a)) && (!b.b || ids.has(b.b)) && b.a !== b.b && b.intensity >= 1 && b.intensity <= 3 && b.note.length > 0), JSON.stringify(plan2.beats));
  // không có kind hợp lệ → offline
  script.push((_r, res) => sendJson(res, 200, completion(JSON.stringify({ beats: [{ kind: 'nope', a: null, b: null, intensity: 1, note: 'x' }] }))));
  const plan3 = await v3.generateBeats(beatReq, ctx);
  check('không biến nào hợp lệ → offline, lastError nói rõ', plan3.source === 'offline' && /kind không thuộc menu/.test(v3.usage().lastError ?? ''), v3.usage().lastError);
  // không ai xem → không gọi AI
  v3.setAudience(0);
  const reqN = requests.length;
  const plan4 = await v3.generateBeats(beatReq, ctx);
  check('không ai xem: không gọi HTTP, kế hoạch offline', requests.length === reqN && plan4.source === 'offline');
  v3.setAudience(1);
  // menu rỗng → không biến, không throw
  script.push((_r, res) => smart(_r, res));
  const plan5 = await v3.generateBeats({ ...beatReq, menu: [] }, ctx);
  check('menu rỗng → beats [] (không throw)', Array.isArray(plan5.beats) && plan5.beats.length === 0);
  // vượt ngân sách → offline, không gọi HTTP
  const broke = createBrain({ ...baseCfg, dailyBudgetUsd: 0 }, { ...quiet, now, deadlineMs: v3Deadline });
  broke.setAudience(1);
  const reqB = requests.length;
  const plan6 = await broke.generateBeats(beatReq, ctx);
  check('hết ngân sách → offline, không gọi HTTP', requests.length === reqB && plan6.source === 'offline');
}

// ---------------------------------------------------------------- 14. kích cỡ prompt
section('14. v3 — kích cỡ prompt (ước lượng token, system + user) ≤ 2.5k mỗi cảnh');
{
  const system = buildSystemPrompt(CONFIG.companyName, COMPANY_INFO);
  const sysTok = estimateTokens(system);
  const staff = ctx.roster.filter((r) => !['hung', 'ngoc'].includes(r.id));
  const bigDossier: NonNullable<SceneRequest['hrDossier']> = staff.map((r, i) => ({
    id: r.id, name: r.name, roleLabel: r.roleLabel, kpiRatios: [0.9, 1.1, 0.7, 0.6, 1.2, 0.8, 0.95].map((x) => x + i * 0.01),
    lowStreak: i % 3, warnings: i % 2, caughtToday: i % 2, hiredDay: 1, mood: 40 + i * 5, stress: 30 + i * 4,
    attitude: 'Thái độ mẫu dài để thử trần: hay than deadline, hợp tác tốt với QA, thích khịa sales về tính năng hứa bừa.',
    allowed: ['none', 'warn', 'probation', 'second_chance', 'praise', 'bonus'],
  }));
  const longNews = { ...NEWS, summary: 'Hai bàn thắng đến trong hiệp hai sau khi đội chủ nhà thay ba cầu thủ; huấn luyện viên hài lòng với tinh thần thi đấu của toàn đội.' };
  const tok = (req: SceneRequest) => estimateTokens(buildSceneUserPrompt(req, ctx));
  // Ước lượng 2,7 ký tự/token cố ý đếm DƯ (prompt-budget.ts). Phần system tĩnh đo thật trên Gemini ≈ 1300 token khi ước lượng
  // ≈ 1530 (đầu prompts.ts) → hệ số 0,85 cho system; phần user động giữ nguyên ước lượng (≈ 2,65 ký tự/token thật).
  const sysReal = Math.round(sysTok * 0.85);
  // mốc so sánh: cảnh v2 cùng số người
  const base3 = tok(sceneReq({ type: 'pantry_chat', participants: ['phat', 'tu', 'bao'], situation: 'Ba người tám chuyện ở pantry lúc nghỉ tay.', minLines: 4, maxLines: 8 }));
  const base4 = tok(sceneReq({ type: 'lunch', participants: ['hung', 'ngoc', 'tu', 'phat'], situation: 'Bốn người ăn trưa.', minLines: 5, maxLines: 9, allowedEffects: ['relationship', 'mood', 'memory', 'rumor'] }));
  const base5 = tok(sceneReq({ type: 'standup', participants: ['khoa', 'tung', 'bao', 'vy', 'linh'], situation: 'Họp standup sáng.', minLines: 5, maxLines: 9, allowedEffects: ['kpi', 'mood', 'relationship', 'memory'] }));
  console.log(`  ℹ️  system cảnh ≈ ${sysTok} token ước lượng (≈ ${sysReal} thật, tĩnh, cache được) · mốc v2 (ước lượng): pantry 3 người ≈ ${sysTok + base3}, lunch 4 ≈ ${sysTok + base4}, standup 5 ≈ ${sysTok + base5}`);
  /** [nhãn, yêu cầu, trần (user + system hiệu chỉnh), lý do trần] */
  const cases: [string, SceneRequest, number, string][] = [
    ['news_chat (2 người)', sceneReq({ type: 'news_chat', participants: ['phat', 'tu'], news: longNews, situation: 'Hai người tám chuyện thời sự ở pantry.', minLines: 4, maxLines: 8 }), 2500, '≤ 2.5k'],
    ['news_chat (3 người)', sceneReq({ type: 'news_chat', participants: ['phat', 'tu', 'bao'], news: longNews, situation: 'Ba người tám chuyện thời sự ở pantry lúc nghỉ tay.', minLines: 4, maxLines: 8 }), sysReal + base3 + 450, 'pantry 3 người + 450 (thẻ tin + luật)'],
    // +60: dòng TRẦN 1 LẦN HỌP (≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise+bonus) — rà soát v3: model không biết trần nên thoại hứa thưởng rồi bị gác
    ['hr_review (hồ sơ 3 người)', sceneReq({ type: 'hr_review', participants: ['ngoc', 'hung'], hrDossier: bigDossier.slice(0, 3), situation: 'Ngọc và sếp Hùng họp kín xét nhân sự định kỳ.', minLines: 4, maxLines: 7, allowedEffects: ['memory', 'decisions'] }), 2560, '≤ 2.5k + 60 (TRẦN 1 LẦN HỌP)'],
    [`hr_review (hồ sơ ${bigDossier.length} người, thái độ dài)`, sceneReq({ type: 'hr_review', participants: ['ngoc', 'hung'], hrDossier: bigDossier, situation: 'Ngọc và sếp Hùng họp kín xét nhân sự định kỳ.', minLines: 4, maxLines: 7, allowedEffects: ['memory', 'decisions'] }), 2900, '1 cảnh thay cho 8 cảnh HR riêng'],
    ['resign_talk', sceneReq({ type: 'resign_talk', participants: ['tu', 'ngoc'], situation: 'Tú chán việc xin gặp HR.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory', 'verdict'] }), 2500, '≤ 2.5k'],
    ['raise_request', sceneReq({ type: 'raise_request', participants: ['khoa', 'hung'], situation: 'Khoa xin tăng lương.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory', 'verdict'] }), 2500, '≤ 2.5k'],
    ['promotion (3 người)', sceneReq({ type: 'promotion', participants: ['hung', 'bao', 'tung'], aboutId: 'bao', situation: 'Sếp công bố thăng chức cho Bảo.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), 2500, '≤ 2.5k'],
    ['promotion (5 người)', sceneReq({ type: 'promotion', participants: ['hung', 'bao', 'tung', 'vy', 'linh'], aboutId: 'bao', situation: 'Sếp công bố thăng chức cho Bảo.', minLines: 5, maxLines: 9, allowedEffects: ['mood', 'relationship', 'memory'] }), sysReal + base5 + 150, 'standup 5 người + 150'],
    ['layoff (3 người)', sceneReq({ type: 'layoff', participants: ['hung', 'ngoc', 'tu'], aboutId: 'tu', situation: 'Công ty lỗ, cắt giảm Tú.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), 2500, '≤ 2.5k'],
    ['layoff (4 người)', sceneReq({ type: 'layoff', participants: ['hung', 'ngoc', 'tu', 'phat'], aboutId: 'tu', situation: 'Công ty lỗ, cắt giảm Tú.', minLines: 4, maxLines: 8, allowedEffects: ['mood', 'relationship', 'memory'] }), sysReal + base4 + 150, 'lunch 4 người + 150'],
  ];
  // v4: khối sản phẩm đủ facts / avoid / chuyện không được phình lại (rà soát 2026-11-03: từng đẩy gần mọi cảnh có sản phẩm vượt ngân sách)
  const base2 = tok(sceneReq({ type: 'desk_visit', participants: ['tram', 'tung'], situation: 'Trâm đi tới bàn Tùng để hỏi chuyện deadline.', minLines: 3, maxLines: 7 }));
  cases.push(['desk_visit + sản phẩm đủ trường (2 người)', sceneReq({
    type: 'desk_visit', participants: ['tram', 'tung'], situation: 'Trâm đi tới bàn Tùng để hỏi chuyện deadline.', minLines: 3, maxLines: 7,
    product: {
      id: 'man-hinh-aoc', name: 'Màn hình AOC 27 inch 2K 210Hz', pitch: 'Màn hình 27 inch 2K tấm nền Fast IPS, 210Hz, chơi game lẫn làm việc đều mượt.', preferSpeaker: 'tram',
      short: 'màn hình 27 inch 2K', facts: 'Màn hình 27 inch, độ phân giải 2K, tấm nền Fast IPS, tần số quét 210Hz, có chân đế chỉnh góc nghiêng.',
      avoid: 'không nói bảo hành bao lâu, không so sánh với hãng khác, không nói "rẻ nhất".',
      angle: 'Trâm mua về thấy ổn bất ngờ, giờ rủ Tùng dùng thử; mỗi lần sửa clip là khen màu đẹp', mode: 'owner', priceFeel: 'vua',
    },
  }), sysReal + base2 + 320, 'ghé bàn 2 người + 320 (khối sản phẩm ≈ 290: có thật, CẤM, chuyện, luật giá)']);
  // nhóm chat 3 người + phòng trưng bày (2 chế độ): cùng mức dư cho khối sản phẩm (PRODUCT_TOKEN_ALLOWANCE trong prompts.ts)
  const fullProduct = {
    id: 'man-hinh-aoc', name: 'Màn hình AOC 27 inch 2K 210Hz', pitch: 'Màn hình 27 inch 2K tấm nền Fast IPS, 210Hz.', preferSpeaker: 'tram',
    short: 'màn hình 27 inch 2K', facts: 'Màn hình 27 inch, độ phân giải 2K, tấm nền Fast IPS, tần số quét 210Hz, có chân đế chỉnh góc nghiêng.',
    avoid: 'không nói bảo hành bao lâu, không so sánh với hãng khác, không nói "rẻ nhất".',
    angle: 'Trâm để ý món này cả tuần, hôm nay rủ Tùng với Vy coi thử (rắc rối gợi ý: màn hình cũ mờ mắt)', priceFeel: 'vua' as const,
  };
  const baseG3 = tok(sceneReq({ type: 'group_chat', channel: 'group', participants: ['tram', 'tung', 'vy'], locationLabel: 'Nhóm Zalo "Anh em văn phòng"', situation: 'Nhóm chat tám chuyện giờ nghỉ.', minLines: 4, maxLines: 8 }));
  cases.push(['group_chat 3 người + sản phẩm đủ trường', sceneReq({
    type: 'group_chat', channel: 'group', participants: ['tram', 'tung', 'vy'], locationLabel: 'Nhóm Zalo "Anh em văn phòng"', situation: 'Nhóm chat tám chuyện giờ nghỉ.',
    minLines: 4, maxLines: 8, product: { ...fullProduct, mode: 'mention' },
  }), sysReal + baseG3 + 320, 'nhóm chat 3 người + 320 (khối sản phẩm)']);
  const baseS3 = tok(sceneReq({ type: 'showroom_chat', participants: ['tram', 'tung', 'vy'], locationLabel: 'Kệ công nghệ & nhà cửa', situation: 'Trâm, Tùng, Vy đứng trước kệ ở phòng trưng bày. Chuyện quanh món này: Trâm để ý món này cả tuần.', minLines: 4, maxLines: 8 }));
  for (const mode of ['showroom', 'owner'] as const) {
    cases.push([`showroom_chat 3 người (${mode}) + sản phẩm đủ trường`, sceneReq({
      type: 'showroom_chat', participants: ['tram', 'tung', 'vy'], locationLabel: 'Kệ công nghệ & nhà cửa',
      situation: 'Trâm, Tùng, Vy đứng trước kệ ở phòng trưng bày. Chuyện quanh món này: Trâm để ý món này cả tuần.', minLines: 4, maxLines: 8,
      product: { ...fullProduct, mode },
    }), sysReal + baseS3 + 320, 'phòng trưng bày 3 người + 320 (khối sản phẩm, không lặp "Chuyện")']);
  }
  for (const [label, req, cap, why] of cases) {
    const t = tok(req);
    check(`${label}: user ${t} + system ≈ ${sysReal + t} token thật (ước lượng thô ${sysTok + t}) ≤ ${cap} (${why})`, sysReal + t <= cap && t <= 2000);
  }
  const bSys = buildBeatsSystemPrompt(CONFIG.companyName);
  const bUser = buildBeatsUserPrompt({
    situation: 'Dự án trễ hạn 1 ngày; Khoa và Phát cự nhau; Trâm có clip viral; Tú KPI thấp 3 ngày; sếp đi golf cả chiều; doanh thu 320/1500 triệu; tin thời sự: tuyển Việt Nam thắng giao hữu.',
    menu: Array.from({ length: 12 }, (_, i) => ({ kind: `kind_${i}`, desc: `mô tả biến số ${i} hơi dài để thử trần token của menu` })),
    openArcs: ['mạch 1', 'mạch 2', 'mạch 3'], recentBeats: ['biến 1', 'biến 2', 'biến 3', 'biến 4'], roster: ctx.roster,
  }, ctx);
  const bTok = estimateTokens(bSys) + estimateTokens(bUser);
  check(`beats: system + user ≈ ${bTok} token ≤ 700 (menu 12 loại)`, bTok <= 700);
}

// ---------------------------------------------------------------- 15. World + Director thật ở chế độ GPT
section('15. World + Director ở chế độ GPT (server giả lập)');
const directorMod = await import('../src/sim/director.js').catch((e: unknown) => {
  check('nạp được src/sim/director.ts (đang được drama engineer sửa)', false, String(e).split('\n')[0].slice(0, 200));
  return null;
});
if (directorMod) {
  script.length = 0;
  const msgs: ServerMsg[] = [];
  const cfg: Config = { ...baseCfg, minSecondsBetweenLlm: 20, kpiWarnDays: 2, kpiFireDays: 3 };
  const b = createBrain(cfg, { ...quiet, now });
  const world = new World({ config: cfg, brain: b, emit: (m) => msgs.push(m), now });
  const director = new directorMod.Director(world, b);
  world.attachDirector(director);
  world.setViewers(1);
  const req0 = requests.length;
  const step = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      vt += 100;
      world.advance(100);
      await yieldLoop();
      if (i % 4 === 0) await sleep(1); // cho HTTP giả lập kịp trả lời (giờ thật ≈ giờ ảo / 25)
    }
  };
  const vt0 = vt;
  while (world.minuteOfDay() < 600) await step(50);   // 07:30 → 10:00
  const elapsedSec = (vt - vt0) / 1000;
  const lines = (): Extract<ServerMsg, { t: 'log' }>[] => msgs.filter((m): m is Extract<ServerMsg, { t: 'log' }> => m.t === 'log' && m.entry.kind === 'line');
  const gptLines = lines().filter((m) => m.entry.text.includes('giả lập'));
  check('có cảnh do GPT viết được diễn ra', gptLines.length >= 4, `${gptLines.length}/${lines().length} câu`);
  check('đã gọi API (có tính tiền)', b.usage().calls > 0 && b.usage().costTodayUsd > 0, `${b.usage().calls} lượt, $${b.usage().costTodayUsd}`);
  // low: ≥ 20 s/lần, normal: ≥ 10 s/lần, high: không giới hạn nhưng hiếm → trần thô = thời gian / 10 s + vài cảnh high
  const maxReq = Math.floor(elapsedSec / (cfg.minSecondsBetweenLlm / 2)) + 5;
  check('nhịp gọi tôn trọng MIN_SECONDS_BETWEEN_LLM', requests.length - req0 <= maxReq,
    `${requests.length - req0} request trong ${Math.round(elapsedSec)} s (trần ${maxReq})`);
  // không ai xem → thôi gọi GPT cho cảnh thường
  world.setViewers(0);
  await step(300);
  const before = requests.length;
  await step(1200);
  const idle = requests.length - before;
  check('không ai xem: không gọi GPT cho cảnh thường', idle <= 1, `${idle} request trong ~60 phút game`);
  world.setViewers(1);
  // hết ngày → bản tin qua GPT
  world.handleClient({ t: 'dev', action: 'event', name: 'end_day' });
  for (let i = 0; i < 400 && !msgs.some((m) => m.t === 'recap'); i++) await step(1);
  const recap = msgs.find((m): m is Extract<ServerMsg, { t: 'recap' }> => m.t === 'recap');
  check('bản tin cuối ngày do GPT viết', recap?.recap.source === 'llm', recap?.recap.headline);
  check('status gửi xuống client có thống kê AI', msgs.some((m) => m.t === 'status' && m.status.ai.mode === 'llm' && m.status.ai.calls > 0));
  world.stop();
}

// ---------------------------------------------------------------- tổng kết
server.close();
const total = passed + failures.length;
console.log(`\n${failures.length ? '❌' : '✅'} ${passed}/${total} kiểm tra đạt${failures.length ? ` — lỗi: ${failures.join('; ')}` : ''}`);
console.log(`   (server giả lập nhận ${requests.length} request; không có request nào ra Internet)`);
process.exit(failures.length ? 1 : 0);
