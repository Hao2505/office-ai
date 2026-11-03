// =====================================================================
//  SMOKE TEST CÂU CHUYỆN (v3 — drama): World + Director + Brain OFFLINE, nhiều hạt giống, mỗi hạt 12 ngày game.
//  Không mạng (kho tin nạp từ scripts/fixtures/news/*.xml), archive ghi vào thư mục tạm (xoá khi xong).
//
//  npm run smoke:story
//    SMOKE_STORY_SEEDS=6     số hạt giống (chạy tuần tự, mỗi hạt một văn phòng mới)
//    SMOKE_STORY_DAYS=12     số ngày game mỗi hạt
//    SMOKE_STORY_SPEED=1     tốc độ tua (1|2|5|10) — x1 là nhịp thật (cap thời sự 25 phút thật ⇒ ~1 cảnh/ngày)
//    SMOKE_STORY_SEED=123    hạt giống đầu (các hạt sau = +1, +2, …); mặc định theo giờ — in ra để chạy lại y hệt
//    SMOKE_STORY_VERBOSE=1   in toàn bộ log văn phòng của hạt đầu
//
//  Khẳng định (docs/v3-news.md §7 + yêu cầu v3):
//   - mỗi hạt: ≥ 1 cảnh hr_review kết thúc tốt với ≥ 1 quyết định được thi hành; mọi quyết định đều qua HÀNG RÀO
//     (kiểm tra lại độc lập trong file này, không tin Director); ≤ 1 cho nghỉ / cắt giảm mỗi 2 ngày
//   - mỗi hạt: ≥ 1 cảnh news_chat kèm thẻ tin (scene.news + log.news) khi kho tin có tin; tin đã bàn được markUsed
//   - mỗi hạt: AI biên kịch lên ≥ 3 beat và ≥ 1 mạch kết (offline plan); mạch mở ≤ 2; sổ mạch ≤ 8; beat gần đây ≤ 10
//   - không ai bị "đánh dấu": qua các hạt, tập người bị nhắc / cho nghỉ khác nhau ít nhất một lần; có hạt KHÔNG đuổi ai
//   - không ai kẹt trong cảnh > 4 phút thật; hàng đợi / kho tin đã dùng / tin đã bàn có trần
//   - serialize → restore → serialize của phần câu chuyện (mạch, sổ HR, tin đã bàn) khớp nhau
//   - nút dev 🗞️ thời sự và 🎬 biên kịch có phản hồi; không có lỗi / exception / cảnh báo "lỗi"
// =====================================================================
import type { AgentState, DirectorApi, HrAction, KpiResult, LogEntry, SceneType, ServerMsg } from '../src/types.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- RNG có hạt giống (đặt TRƯỚC khi nạp module)
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const envNum = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) ? v : d;
};
const SEED0 = Math.floor(envNum('SMOKE_STORY_SEED', Date.now() % 1_000_000_007));
const SEEDS = Math.max(1, Math.floor(envNum('SMOKE_STORY_SEEDS', 6)));
const DAYS = Math.max(3, Math.floor(envNum('SMOKE_STORY_DAYS', 12)));
const SPEED = [1, 2, 5, 10].includes(envNum('SMOKE_STORY_SPEED', 1)) ? envNum('SMOKE_STORY_SPEED', 1) : 1;
const VERBOSE = process.env.SMOKE_STORY_VERBOSE === '1';
const DT = 100;
const hhmm = (m: number): string => {
  const v = Math.floor(((m % 1440) + 1440) % 1440);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
let rng = mulberry32(SEED0);
Math.random = () => rng();

// ---------------------------------------------------------------- bắt lỗi / cảnh báo
const problems: string[] = [];
const notes: string[] = [];
const fmtArgs = (args: unknown[]): string =>
  args.map((x) => (x instanceof Error ? (x.stack ?? x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);
let verboseRun = false;
console.error = (...args: unknown[]) => { problems.push(`console.error: ${fmtArgs(args)}`); if (verboseRun) origErr(...args); };
console.warn = (...args: unknown[]) => {
  const s = fmtArgs(args);
  if (/lỗi|quá 23:00|kẹt trong cảnh|failsafe/i.test(s) && !/Bỏ qua removeAgent/.test(s)) problems.push(`console.warn: ${s}`);
  else notes.push(s);
  if (verboseRun) origWarn(...args);
};
console.log = (...args: unknown[]) => { if (verboseRun) origLog(...args); };
process.on('unhandledRejection', (e) => problems.push(`unhandledRejection: ${fmtArgs([e])}`));
process.on('uncaughtException', (e) => problems.push(`uncaughtException: ${fmtArgs([e])}`));

// ---------------------------------------------------------------- nạp module
const { CONFIG } = await import('../src/config.js');
const { createBrain } = await import('../src/ai/brain.js');
const { World } = await import('../src/sim/world.js');
const { Director } = await import('../src/sim/director.js');
const { getArchive } = await import('../src/sim/archive.js');
const { configureNews, parseRss } = await import('../src/news/index.js');
const { SCENE_DEFS } = await import('../src/sim/scenes.js');
const { BEAT_KINDS } = await import('../src/content/catalog.js');
const { SITUATION_KINDS, SITUATIONS } = await import('../src/content/situations.js');
const { Showrunner, ARC_MAX_AGE_DAYS } = await import('../src/sim/story.js');
type DecisionInfo = import('../src/sim/director.js').DecisionInfo;

const HISTORY_DIR = mkdtempSync(join(tmpdir(), 'vpa-smoke-story-'));
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'news');
const fixtureItems = [
  ...parseRss(readFileSync(join(FIXTURES, 'gamek-home.xml'), 'utf8'), 'game'),
  ...parseRss(readFileSync(join(FIXTURES, 'tuoitre-the-thao.xml'), 'utf8'), 'the_thao'),
  ...parseRss(readFileSync(join(FIXTURES, 'vnexpress-giai-tri.xml'), 'utf8'), 'giai_tri'),
].map((it, i) => ({ ...it, publishedAt: Date.now() - (i + 1) * 60_000 })); // luôn "mới" dù mẫu đã cũ
const news = configureNews({ enabled: false, feeds: [] });
const archive = getArchive().configure({ enabled: true, dir: HISTORY_DIR, keepDays: 180, gzipAfterDays: 7, flushMs: 300 }).start();

const config = {
  ...CONFIG,
  openaiKey: '',
  persist: false,
  timeMode: 'compressed' as const,
  devPanel: true,
  newsEnabled: true,            // Director được bàn tin (kho tin nạp từ mẫu, không tải mạng)
  newsSceneMinMinutes: 25,
  showrunnerEnabled: true,
  storyRandomizeTraits: true,
  storyTraitDrift: true,
  historyEnabled: true,
  historyDir: HISTORY_DIR,
  // KPI_WARN_DAYS / KPI_FIRE_DAYS mặc định (2 / 3): hàng rào thật, không ép vòng HR nhanh
};

// ---------------------------------------------------------------- kiểm tra hàng rào ĐỘC LẬP (không dùng code của hr.ts)
function guardOk(d: DecisionInfo): string | null {
  const a = d.agent;
  const act = d.decision.action;
  if (act !== 'none' && !d.allowed.includes(act)) return `hành động ${act} không nằm trong allowed`;
  if (act === 'open_position') {
    return d.env.revenueRatio >= 0.8 && d.env.headcount < 12 && !d.env.hasOpenPosition && d.env.freeDesk ? null : 'open_position sai điều kiện';
  }
  if (!a) return 'thiếu hồ sơ người';
  const tenure = d.day - a.hiredDay;
  const avg = a.avg7;
  switch (act) {
    case 'warn': return a.lowStreak >= 1 ? null : 'warn khi lowStreak < 1';
    case 'probation': return a.lowStreak >= 1 && !a.onProbation ? null : 'probation sai điều kiện';
    case 'second_chance': return a.lowStreak >= 1 || a.warnings >= 1 ? null : 'second_chance khi không có gì';
    case 'fire':
      if (a.lowStreak < 2) return 'fire khi lowStreak < 2';
      if (!(a.warnings >= 1 || a.lowStreak >= a.kpiFireDays)) return 'fire chưa bị nhắc và chưa tới KPI_FIRE_DAYS';
      if (tenure < 3) return 'fire người mới < 3 ngày';
      if (d.day - d.ledger.lastFireDay < 2) return 'fire quá 1 lần / 2 ngày';
      return null;
    case 'praise': return avg !== null && avg >= 1.0 && a.ratios.length >= 2 ? null : 'praise khi KPI TB < 1.0';
    case 'bonus':
      if (!(avg !== null && avg >= 1.0 && a.ratios.length >= 2)) return 'bonus khi KPI TB < 1.0';
      if (d.day - d.ledger.lastBonusDay < 7) return 'bonus 2 lần trong 7 ngày';
      if (d.day - d.ledger.lastBonusAnyDay < 7) return 'thưởng 2 người trong cùng 7 ngày (toàn công ty)';
      return null;
    case 'promote':
      if (!(avg !== null && avg >= 1.15 && a.ratios.length >= 5)) return 'promote khi KPI TB < 1.15 / thiếu ngày';
      if (tenure < 10) return 'promote người < 10 ngày';
      if (d.day - d.ledger.lastPromotionDay < 7) return 'promote 2 lần / 7 ngày';
      return null;
    case 'layoff':
      if (d.ledger.lowRevenuePeriods < 2) return 'layoff khi doanh thu chưa thấp 2 kỳ';
      if (tenure < 10) return 'layoff người vào chưa đủ 10 ngày';
      if (d.day - d.ledger.lastFireDay < 2) return 'layoff quá 1 lần / 2 ngày';
      if (d.ledger.layoffsInMonth >= 2) return 'quá 2 đợt cắt giảm trong một tháng game';
      return null;
    case 'none': return null;
    default: return `hành động lạ ${act}`;
  }
}

// ---------------------------------------------------------------- một lượt chạy
interface RunResult {
  seed: number;
  days: number;
  secs: number;
  scenes: Record<string, { n: number; ok: number; lines: number }>;
  hrReviewsOk: number;
  decisions: DecisionInfo[];
  guardViolations: string[];
  fired: string[];          // tên bị cho nghỉ (fire)
  laidOff: string[];
  resigned: string[];
  warned: string[];
  promoted: string[];
  resignTalks: number;
  /**
   * v5: tình huống công ty — cảnh họp xử lý / truyền lửa; số lần CHỐT sau cuộc họp (dòng sự kiện "🧯 <chủ trì> chốt: …"),
   * số lần chốt nhanh dự phòng ("… qua điện thoại"), số mạch tình huống đi tới kết cục (có plan + outcome, lấy mẫu trong lúc chạy)
   */
  crisisMeetings: number;
  pepTalks: number;
  situationDecisions: number;
  situationFallbacks: number;
  situationOutcomes: number;
  situationLogs: string[];
  hires: number;            // người mới được tuyển (welcome)
  interviews: number;
  deferred: number;         // cảnh cho nghỉ / thăng chức bị hoãn sang mai
  laidOffTenure: number[];  // thâm niên lúc bị cắt giảm
  kpiAvgByName: Record<string, number>; // % KPI trung bình cả kỳ theo tên (để xem thiên lệch vai)
  newsScenes: number;
  newsWithCard: number;     // scene.news có đủ id/title/url
  newsLogCards: number;     // log scene_start có .news
  newsMarked: boolean;      // tin đã bàn nằm trong news.recent()
  newsHints: number;
  beatsPlanned: number;
  arcsResolved: number;
  arcsOpenMax: number;
  arcsKeptMax: number;
  recentBeatsMax: number;
  stepsRun: number;
  maxHoldMs: number;
  queueMax: number;
  newsUsedMax: number;
  newsDiscussedMax: number;
  roundTrip: string;
  devNews: string;
  devShowrunner: string;
  storyLogs: string[];
  hrLogs: string[];
  randomized: boolean;
  sample: string[];
}

/** slump = ép doanh thu tháng về 0 suốt kỳ (kịch bản cắt giảm: không tuyển thay / không tuyển lại trong kỳ kém, ≤ 2 đợt / tháng, không cắt người mới) */
async function runOnce(seed: number, verbose: boolean, opts: { slump?: boolean; days?: number } = {}): Promise<RunResult> {
  const DAYS_RUN = opts.days ?? DAYS;
  rng = mulberry32(seed);
  verboseRun = verbose;
  news.clear();
  const injected = news.inject(fixtureItems).added;
  if (injected < 10) problems.push(`kho tin chỉ nạp được ${injected} tin từ mẫu`);

  let vt = Date.now();
  const realNow = (): number => vt;
  const t0 = performance.now();

  const scenes = new Map<string, { type: SceneType; day: number; lines: number; ended: 'ok' | 'aborted' | null; news: boolean; newsCardOk: boolean }>();
  const logs: LogEntry[] = [];
  // đếm ngay lúc phát (mảng logs bị cắt khi quá 6000 dòng → đếm từ logs sẽ hụt khi chạy nhiều ngày)
  let sitDecided = 0, sitFallback = 0;
  const toasts: string[] = [];
  const names = new Map<string, string>();
  let newsLogCards = 0;
  const sample: string[] = [];

  function emit(msg: ServerMsg): void {
    switch (msg.t) {
      case 'log': {
        const e = msg.entry;
        logs.push(e);
        if (e.kind === 'event' && e.icon === '🧯') {
          if (/ chốt: /.test(e.text)) sitDecided++;
          else if (/qua điện thoại/.test(e.text)) sitFallback++;
        }
        if (logs.length > 6000) logs.splice(0, 1000);
        if (verbose) origLog(`  [N${e.day} ${hhmm(e.minute)}] ${e.kind}${e.channel && e.channel !== 'office' ? `/${e.channel}` : ''} ${e.icon ?? ''} ${e.speakerName ? e.speakerName + ': ' : ''}${e.text}${e.news ? `  🗞️ ${e.news.title} (${e.news.source})` : ''}`);
        if (e.kind === 'scene_start' && e.news && typeof e.news.url === 'string' && /^https?:\/\//.test(e.news.url)) newsLogCards++;
        if (e.kind === 'line' && e.sceneId) {
          const sc = scenes.get(e.sceneId);
          if (sc) {
            sc.lines++;
            if (sc.news && sample.length < 4) sample.push(`${e.speakerName}: ${e.text}`);
          }
        }
        break;
      }
      case 'scene': {
        const s = msg.scene;
        if (s.status === 'start') {
          const card = !!s.news && typeof s.news.id === 'string' && typeof s.news.title === 'string' && typeof s.news.url === 'string' && /^https?:\/\//.test(s.news.url);
          scenes.set(s.id, { type: s.type, day: world.day(), lines: 0, ended: null, news: s.type === 'news_chat', newsCardOk: card });
          if (s.type === 'news_chat' && !card) problems.push(`news_chat ${s.id} không có thẻ tin hợp lệ`);
        } else {
          const rec = scenes.get(s.id);
          if (rec) rec.ended = /bị gián đoạn/.test(s.summary ?? '') ? 'aborted' : 'ok';
        }
        break;
      }
      case 'agents': for (const a of msg.agents) names.set(a.id, a.name); break;
      case 'toast': toasts.push(`${msg.icon} ${msg.text}`); break;
      default: break;
    }
  }

  const brain = createBrain(config, { now: realNow, quiet: true });
  const world = new World({ config, brain, emit, now: realNow });
  const director = new Director(world, brain);
  const decisions: DecisionInfo[] = [];
  const guardViolations: string[] = [];
  director.hooks.decision = (info) => {
    decisions.push(info);
    const why = guardOk(info);
    if (why) guardViolations.push(`N${info.day} ${info.decision.action} ${info.decision.id}: ${why}`);
  };
  const spy: DirectorApi = {
    tick: (dt) => director.tick(dt),
    onDayStart: (d) => director.onDayStart(d),
    onDayEnd: (d: number, results: KpiResult[]) => director.onDayEnd(d, results),
    onEvent: (n, data) => director.onEvent(n, data),
    onBossLeft: (r) => director.onBossLeft(r),
    onBossReturned: () => director.onBossReturned(),
    onSlackerSpotted: (b, v) => director.onSlackerSpotted(b, v),
    onAgentArrived: (id, late) => director.onAgentArrived(id, late),
    publicScenes: () => director.publicScenes(),
    recaps: () => director.recaps(),
    rumors: () => director.rumors(),
    serialize: () => director.serialize(),
    restore: (d) => director.restore(d),
  };
  world.attachDirector(spy);
  for (const a of world.agents()) names.set(a.id, a.name);
  const randomized = world.agents().some((a: AgentState) => !!a.traitBase) && config.storyRandomizeTraits !== false;

  const sceneHold = new Map<string, { sid: string; since: number }>();
  let maxHoldMs = 0;
  let queueMax = 0, newsUsedMax = 0, newsDiscussedMax = 0, arcsOpenMax = 0, arcsKeptMax = 0, recentBeatsMax = 0;
  const sitResolved = new Set<string>(); // mạch tình huống đã có phương án + kết cục (sổ mạch chỉ giữ 8 → lấy mẫu trong lúc chạy)
  let steps = 0;
  const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
  async function step(n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
      vt += DT;
      world.advance(DT);
      steps++;
      if (opts.slump) {
        const rev = world.company().revenueMonth;
        if (rev > 0) world.addRevenue(-rev);
      }
      for (const a of world.agents()) {
        if (a.sceneId) {
          const h = sceneHold.get(a.id);
          if (!h || h.sid !== a.sceneId) sceneHold.set(a.id, { sid: a.sceneId, since: vt });
          else if (vt - h.since > maxHoldMs) maxHoldMs = vt - h.since;
        } else sceneHold.delete(a.id);
      }
      if (steps % 50 === 0) {
        const st = director.stats();
        queueMax = Math.max(queueMax, st.queue);
        newsUsedMax = Math.max(newsUsedMax, st.newsUsed);
        newsDiscussedMax = Math.max(newsDiscussedMax, st.newsDiscussed);
        arcsOpenMax = Math.max(arcsOpenMax, st.story_arcsOpen);
        arcsKeptMax = Math.max(arcsKeptMax, st.story_arcsKept);
        recentBeatsMax = Math.max(recentBeatsMax, st.story_recentBeats);
        for (const a of director.arcs()) if (a.plan && a.outcome && SITUATION_KINDS.includes(a.kind)) sitResolved.add(a.id);
      }
      await yieldLoop();
    }
  }

  if (SPEED !== 1) world.handleClient({ t: 'dev', action: 'speed', value: SPEED });
  let lastDay = world.day();
  while (true) {
    await step(1);
    const d = world.day();
    if (d !== lastDay) {
      lastDay = d;
      if (d > DAYS_RUN) break;
    }
    if (steps > 3_000_000) { problems.push(`seed ${seed}: quá nhiều bước — đồng hồ không chạy?`); break; }
  }
  const daysRun = lastDay - 1;

  // ---- nút dev 🗞️ / 🎬 (chỉ ở hạt đầu cho nhanh)
  let devNews = 'bỏ qua', devShowrunner = 'bỏ qua';
  if (!opts.slump && (verbose || seed === SEED0)) {
    if (SPEED !== 1) world.handleClient({ t: 'dev', action: 'speed', value: 1 });
    while (world.minuteOfDay() < 600) await step(1);
    const probe = async (name: 'news' | 'showrunner', re: RegExp, sec: number): Promise<string> => {
      const l0 = logs.length, t0s = toasts.length;
      world.handleClient({ t: 'dev', action: 'event', name });
      for (let i = 0; i < sec * (1000 / DT); i++) {
        await step(1);
        const hitLog = logs.slice(l0).find((e) => re.test(e.text) || (name === 'news' && e.kind === 'scene_start' && !!e.news));
        const hitToast = toasts.slice(t0s).find((t) => re.test(t));
        if (hitLog) return `log: ${hitLog.icon ?? ''} ${hitLog.text.slice(0, 90)}`;
        if (hitToast) return `toast: ${hitToast.slice(0, 90)}`;
      }
      return `KHÔNG thấy phản hồi khớp ${re} sau ${sec}s`;
    };
    devNews = await probe('news', /tin nóng|Tám chuyện thời sự|Chưa có tin|Chưa có nguồn tin|Thời sự đang tắt/, 30);
    devShowrunner = await probe('showrunner', /Biên kịch|mạch truyện|biên kịch/, 10);
  }

  // ---- serialize / restore round trip của phần câu chuyện
  let roundTrip = 'OK';
  try {
    const s1 = director.serialize() as { story?: unknown };
    const json = JSON.stringify(s1);
    const d2 = new Director(world, brain);
    d2.restore(JSON.parse(json));
    const s2 = d2.serialize() as { story?: unknown };
    const pick = (s: { story?: unknown }) => {
      const st = (s.story ?? {}) as Record<string, unknown>;
      const sr = (st.showrunner ?? {}) as Record<string, unknown>;
      return JSON.stringify({ arcs: sr.arcs, recentBeats: sr.recentBeats, ledger: st.ledger, newsUsed: st.newsUsed, discussedNews: st.discussedNews, overtime: st.overtime, lateTomorrow: st.lateTomorrow, driftPlans: st.driftPlans });
    };
    if (pick(s1) !== pick(s2)) roundTrip = 'LỆCH: ' + pick(s1).slice(0, 120) + ' ≠ ' + pick(s2).slice(0, 120);
    d2.restore('rác' as never);
    d2.restore({ v: 2, story: { showrunner: { arcs: [{ kind: 'khong_co', id: 'x' }, { kind: 'conflict', id: 'y', step: 99, total: 7 }] }, ledger: { lastFireDay: 'x' }, newsUsed: [1, 2], discussedNews: [{ id: 'z' }] } });
    const s3 = d2.serialize() as { story?: { showrunner?: { arcs?: unknown[] } } };
    const arcs3 = s3.story?.showrunner?.arcs ?? [];
    if (!Array.isArray(arcs3) || arcs3.length !== 1) roundTrip += ` · restore rác không lọc mạch (${Array.isArray(arcs3) ? arcs3.length : '?'})`;
    if (json.length > 200_000) roundTrip += ` · state quá lớn (${json.length} B)`;
  } catch (e) {
    problems.push(`seed ${seed}: serialize/restore lỗi: ${fmtArgs([e])}`);
    roundTrip = 'LỖI';
  }

  // ---- tổng hợp
  const byType: Record<string, { n: number; ok: number; lines: number }> = {};
  let newsScenes = 0, newsWithCard = 0;
  for (const s of scenes.values()) {
    const r = (byType[s.type] ??= { n: 0, ok: 0, lines: 0 });
    r.n++; r.lines += s.lines;
    if (s.ended === 'ok') r.ok++;
    if (s.news) { newsScenes++; if (s.newsCardOk) newsWithCard++; }
  }
  const st = director.stats();
  const recent = news.recent(20).map((r) => r.id);
  const discussed = director.recentNews(20).map((r) => r.id);
  const newsMarked = discussed.length === 0 || discussed.every((id) => recent.includes(id) || news.isUsed(id));
  const hrLogs = logs.filter((e) => e.kind === 'hr').map((e) => `N${e.day} ${hhmm(e.minute)} ${e.icon ?? ''} ${e.text}`);
  const storyLogs = logs.filter((e) => e.kind === 'system' && e.icon === '🎬').map((e) => `N${e.day} ${hhmm(e.minute)} ${e.text}`);
  const nameOf = (id: string) => names.get(id) ?? id;
  const result: RunResult = {
    seed, days: daysRun, secs: (performance.now() - t0) / 1000, scenes: byType,
    hrReviewsOk: byType.hr_review?.ok ?? 0,
    decisions, guardViolations,
    fired: logs.filter((e) => e.kind === 'hr' && /đã bị cho nghỉ việc/.test(e.text)).map((e) => e.text.split(' ')[0]),
    laidOff: logs.filter((e) => e.kind === 'hr' && /đợt cắt giảm/.test(e.text)).map((e) => e.text.split(' ')[0]),
    resigned: logs.filter((e) => e.kind === 'hr' && /xin nghỉ việc và rời/.test(e.text)).map((e) => e.text.split(' ')[0]),
    warned: logs.filter((e) => e.kind === 'hr' && /bị HR nhắc nhở KPI/.test(e.text)).map((e) => e.text.split(' ')[0]),
    promoted: decisions.filter((d) => d.decision.action === 'promote').map((d) => nameOf(d.decision.id)),
    resignTalks: byType.resign_talk?.n ?? 0,
    crisisMeetings: byType.crisis_meeting?.n ?? 0,
    pepTalks: byType.pep_talk?.n ?? 0,
    situationDecisions: sitDecided,
    situationFallbacks: sitFallback,
    situationOutcomes: sitResolved.size,
    situationLogs: logs.filter((e) => e.icon === '🧯').map((e) => `N${e.day} ${hhmm(e.minute)} ${e.text}`),
    hires: byType.welcome?.n ?? 0,
    interviews: byType.interview?.n ?? 0,
    deferred: st.decisionsDeferred ?? 0,
    laidOffTenure: decisions.filter((d) => d.decision.action === 'layoff' && d.agent).map((d) => d.day - d.agent!.hiredDay),
    // chỉ đội hình ban đầu (người do AI sinh ra vào sau có tính cách riêng, ít ngày số liệu)
    kpiAvgByName: Object.fromEntries(world.agents().filter((a: AgentState) => a.status === 'active' && a.role !== 'boss' && a.role !== 'hr' && a.hiredDay <= 1 && a.kpiHistory.length >= 3)
      .map((a: AgentState) => [a.name, Math.round((a.kpiHistory.reduce((s2: number, h) => s2 + (Number.isFinite(h.ratio) ? h.ratio : 0), 0) / a.kpiHistory.length) * 100) / 100])),
    newsScenes, newsWithCard, newsLogCards, newsMarked, newsHints: st.newsHints,
    beatsPlanned: st.story_beatsPlanned, arcsResolved: st.story_arcsResolved, arcsOpenMax, arcsKeptMax, recentBeatsMax, stepsRun: st.story_stepsRun,
    maxHoldMs, queueMax, newsUsedMax, newsDiscussedMax, roundTrip, devNews, devShowrunner, storyLogs, hrLogs, randomized, sample,
  };
  // ngày đuổi / cắt giảm cách nhau ≥ 2 ngày (cap toàn công ty)
  const fireDays = decisions.filter((d) => d.decision.action === 'fire' || d.decision.action === 'layoff').map((d) => d.day).sort((a, b) => a - b);
  for (let i = 1; i < fireDays.length; i++) if (fireDays[i] - fireDays[i - 1] < 2) guardViolations.push(`đuổi/cắt giảm 2 lần cách nhau ${fireDays[i] - fireDays[i - 1]} ngày (N${fireDays[i - 1]}, N${fireDays[i]})`);
  verboseRun = false;
  return result;
}

// ================================================================== chạy nhiều hạt
const T0 = performance.now();
origLog(`🎬 Smoke test câu chuyện (v3) — ${SEEDS} hạt từ ${SEED0}, ${DAYS} ngày game mỗi hạt, tốc độ x${SPEED}, offline`);
/**
 * v5: một văn phòng riêng (không AI) ép mạch "kẹt tiền"; giả lập kết quả cảnh như AI viết (source 'llm'): cuộc họp chốt plan_c
 * (luôn ≠ lựa chọn dự phòng, vì ép lựa chọn dự phòng khác đi) → truyền lửa cả phòng; truyền lửa trả NGƯỢC lựa chọn dự phòng.
 * Kỳ vọng: arc.plan = plan_c, planBy = llm, arc.pep = đúng giá trị AI trả.
 */
async function llmVerdictCheck(): Promise<{ ok: boolean; info: string }> {
  let vt = Date.now();
  const brain = createBrain(config, { now: () => vt, quiet: true });
  const world = new World({ config, brain, emit: () => undefined, now: () => vt });
  const director = new Director(world, brain);
  world.attachDirector({
    tick: (dt) => director.tick(dt), onDayStart: (d) => director.onDayStart(d),
    onDayEnd: (d: number, results: KpiResult[]) => director.onDayEnd(d, results),
    onEvent: (n, data) => director.onEvent(n, data), onBossLeft: (r) => director.onBossLeft(r), onBossReturned: () => director.onBossReturned(),
    onSlackerSpotted: (b, v) => director.onSlackerSpotted(b, v), onAgentArrived: (id, late) => director.onAgentArrived(id, late),
    publicScenes: () => director.publicScenes(), recaps: () => director.recaps(), rumors: () => director.rumors(),
    serialize: () => director.serialize(), restore: (d) => director.restore(d),
  });
  const aiPep = new Map<string, string>();
  const orig = brain.generateScene.bind(brain);
  brain.generateScene = async (req, ctx, via) => {
    const res = await orig(req, ctx, via);
    if (req.type === 'crisis_meeting') return { ...res, source: 'llm', verdict: 'plan_c' };
    if (req.type === 'pep_talk') {
      const v = req.crisis?.pick === 'unmoved' ? 'inspired' : 'unmoved';
      aiPep.set(req.sceneId, v);
      return { ...res, source: 'llm', verdict: v };
    }
    return res;
  };
  // ép lựa chọn dự phòng của cuộc họp ≠ plan_c
  const inner = director as unknown as {
    story: { schedule: (now: number, delay?: number) => void; accept: (plan: unknown, ctx: unknown) => { id: string }[]; pickPlan: (...a: unknown[]) => unknown };
    storyCtx: () => unknown;
  };
  const sit = SITUATIONS.find((d) => d.kind === 'cash_crunch');
  const notC = sit?.plans.find((pl) => pl.code !== 'plan_c');
  if (!sit || !notC) return { ok: false, info: 'thiếu tình huống cash_crunch' };
  inner.story.pickPlan = () => notC;
  let arcId = '';
  for (let i = 0; i < 2 * 1440 * 2 * 10 && world.day() <= 2; i++) {
    vt += DT;
    world.advance(DT);
    if (!arcId && world.minuteOfDay() >= 8 * 60 + 35) {
      inner.story.schedule(world.time(), 1e6); // không cho AI biên kịch mở tình huống khác
      arcId = inner.story.accept({ beats: [{ kind: 'cash_crunch', intensity: 1, note: '' }], source: 'offline' }, inner.storyCtx())[0]?.id ?? 'x';
    }
    const arc = director.arcs().find((a) => a.id === arcId);
    if (arc && arc.pep) break;
    await new Promise((r) => setImmediate(r));
  }
  const arc = director.arcs().find((a) => a.id === arcId);
  const pepAi = [...aiPep.values()][0];
  const ok = !!arc && arc.plan === 'plan_c' && arc.planBy === 'llm' && !!pepAi && arc.pep === pepAi;
  return { ok, info: arc ? `plan ${arc.plan ?? '—'} (${arc.planBy ?? '—'}), pep ${arc.pep ?? '—'} / AI ${pepAi ?? '—'}` : 'không mở được mạch' };
}

const runs: RunResult[] = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = SEED0 + i;
  const r = await runOnce(seed, VERBOSE && i === 0);
  runs.push(r);
  const hrTypes = ['hr_review', 'hr_warning', 'firing', 'layoff', 'promotion', 'resign_talk', 'raise_request', 'news_chat']
    .map((t) => `${t} ${r.scenes[t]?.ok ?? 0}`).join(' · ');
  origLog(`  ✓ hạt ${seed}: ${r.days} ngày trong ${r.secs.toFixed(1)}s · ${hrTypes} · quyết định ${r.decisions.length} (vi phạm ${r.guardViolations.length})`
    + ` · beat ${r.beatsPlanned} / mạch kết ${r.arcsResolved} · nghỉ: ${[...r.fired, ...r.laidOff, ...r.resigned].join(', ') || '—'} · nhắc: ${[...new Set(r.warned)].join(', ') || '—'}`);
}
// ---- kịch bản doanh thu kém (ép doanh thu về 0, 14 ngày): cắt giảm có trần, không tuyển thay / tuyển lại trong kỳ kém, không cắt người mới
const SLUMP_DAYS = 14;
const slump = await runOnce(SEED0 + 1000, false, { slump: true, days: SLUMP_DAYS });
origLog(`  ✓ kịch bản doanh thu 0 (hạt ${slump.seed}, ${slump.days} ngày): cắt giảm ${slump.laidOff.join(', ') || '—'} (thâm niên ${slump.laidOffTenure.join('/') || '—'}) · đuổi ${slump.fired.join(', ') || '—'}`
  + ` · phỏng vấn ${slump.interviews} · tuyển ${slump.hires} · hoãn ${slump.deferred} · quyết định ${slump.decisions.length} (vi phạm ${slump.guardViolations.length})`);
await archive.flush();
const archiveDays = await archive.listDays();
let archiveKinds = new Map<string, number>();
try {
  for (const d of archiveDays) {
    const rows = await archive.readDay(d.date, { limit: 5000 });
    for (const e of rows) archiveKinds.set(e.kind, (archiveKinds.get(e.kind) ?? 0) + 1);
  }
} catch (e) {
  problems.push(`đọc archive lỗi: ${fmtArgs([e])}`);
}
archive.stop();
rmSync(HISTORY_DIR, { recursive: true, force: true });

// ================================================================== báo cáo
const line = (s = ''): void => origLog(s);
const first = runs[0];
line('');
line('══════════════════════════════════════════════════════════════════');
line(`  KẾT QUẢ SMOKE TEST CÂU CHUYỆN (hạt ${SEED0}..${SEED0 + SEEDS - 1})`);
line('══════════════════════════════════════════════════════════════════');
line(`Tổng ${((performance.now() - T0) / 1000).toFixed(1)}s thật cho ${runs.reduce((n, r) => n + r.days, 0)} ngày game`);
line('');
line(`Hạt ${first.seed} — nhân sự (sổ HR):`);
for (const l of first.hrLogs.slice(0, 28)) line(`  ${l}`);
if (first.hrLogs.length > 28) line(`  … (+${first.hrLogs.length - 28} dòng)`);
line('');
line(`Hạt ${first.seed} — mạch truyện 🎬 (${first.storyLogs.length} dòng hệ thống, chỉ mạch đậm):`);
for (const l of first.storyLogs.slice(0, 6)) line(`  ${l}`);
line(`Hạt ${first.seed} — tình huống công ty 🧯 (${first.situationLogs.length} dòng: cảnh họp + câu chốt phương án):`);
for (const l of first.situationLogs.slice(0, 12)) line(`  ${l}`);
line('');
line(`Hạt ${first.seed} — thời sự: ${first.newsScenes} cảnh news_chat (${first.newsWithCard} có thẻ tin, ${first.newsLogCards} log có thẻ), ${first.newsHints} gợi ý "nghe nói…" cho pantry/lunch`);
for (const s of first.sample) line(`     ${s}`);
line('');
line('Cảnh theo loại (hạt đầu, bắt đầu · xong · câu):');
for (const [t, r] of Object.entries(first.scenes).sort((a, b) => b[1].n - a[1].n)) line(`  ${t.padEnd(15)} ${String(r.n).padStart(4)} · ${String(r.ok).padStart(4)} · ${String(r.lines).padStart(5)}`);
line('');
line('Quyết định nhân sự theo loại (tất cả hạt):');
const byAction = new Map<HrAction, number>();
for (const r of runs) for (const d of r.decisions) byAction.set(d.decision.action, (byAction.get(d.decision.action) ?? 0) + 1);
line(`  ${[...byAction.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
line(`Archive: ${archiveDays.length} ngày, bản ghi theo loại: ${[...archiveKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
line(`Nút dev (hạt đầu): 🗞️ ${first.devNews} · 🎬 ${first.devShowrunner}`);
line(`Serialize/restore: ${runs.map((r) => r.roundTrip).every((x) => x === 'OK') ? 'OK (mọi hạt)' : runs.map((r) => `${r.seed}: ${r.roundTrip}`).join(' | ')}`);
if (notes.length) {
  line('');
  line(`Ghi chú (${notes.length} cảnh báo không nghiêm trọng):`);
  for (const n of [...new Set(notes)].slice(0, 6)) line(`  · ${n.slice(0, 200)}`);
}

// ================================================================== khẳng định
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, info = ''): void => { checks.push([name, ok, info]); };
const all = (f: (r: RunResult) => boolean) => runs.every(f);
const infoOf = (f: (r: RunResult) => string | number) => runs.map((r) => `${r.seed}:${f(r)}`).join(' ');

check('không có lỗi / exception / cảnh báo "lỗi"', problems.length === 0, problems.length ? `${problems.length} vấn đề` : '');
check(`mỗi hạt chạy đủ ${DAYS} ngày`, all((r) => r.days >= DAYS), infoOf((r) => r.days));
check('SCENE_DEFS có đủ 6 loại cảnh v3', ['news_chat', 'hr_review', 'resign_talk', 'raise_request', 'promotion', 'layoff'].every((t) => t in SCENE_DEFS));
check('mỗi hạt: ≥ 1 hr_review kết thúc tốt và ≥ 1 quyết định được thi hành', all((r) => r.hrReviewsOk >= 1 && r.decisions.length >= 1),
  infoOf((r) => `${r.hrReviewsOk}/${r.decisions.length}`));
check('hàng rào không bao giờ bị vi phạm (kiểm tra độc lập từng quyết định) · ≤ 1 đuổi/cắt giảm mỗi 2 ngày',
  all((r) => r.guardViolations.length === 0), runs.flatMap((r) => r.guardViolations).slice(0, 3).join('; '));
check('quyết định đa dạng (≥ 3 loại hành động khác nhau qua các hạt)', byAction.size >= 3, [...byAction.keys()].join(', '));
check('mỗi hạt: ≥ 1 cảnh news_chat kèm thẻ tin (scene.news + log.news) khi kho tin có tin',
  all((r) => r.newsScenes >= 1 && r.newsWithCard === r.newsScenes && r.newsLogCards >= 1), infoOf((r) => `${r.newsScenes}/${r.newsWithCard}`));
check('tin đã bàn được markUsed (news.recent() / isUsed) và không bàn lại', all((r) => r.newsMarked), '');
check('mỗi hạt: AI biên kịch lên ≥ 3 beat và ≥ 1 mạch kết (kế hoạch offline)', all((r) => r.beatsPlanned >= 3 && r.arcsResolved >= 1),
  infoOf((r) => `${r.beatsPlanned}/${r.arcsResolved}`));
check('mọi beat đều thuộc thực đơn và mạch mở ≤ 2, sổ mạch ≤ 8, beat gần đây ≤ 10', all((r) => r.arcsOpenMax <= 2 && r.arcsKeptMax <= 8 && r.recentBeatsMax <= 10) && BEAT_KINDS.length === 28 && BEAT_KINDS.includes('shopping_story') && SITUATION_KINDS.every((k: string) => BEAT_KINDS.includes(k)),
  infoOf((r) => `${r.arcsOpenMax}/${r.arcsKeptMax}/${r.recentBeatsMax}`));
const victims = runs.map((r) => [...new Set([...r.fired, ...r.laidOff, ...r.resigned, ...r.warned])].sort().join(','));
const differs = runs.length < 2 || new Set(victims).size >= 2;
check('không ai bị "đánh dấu" trước: tập người bị nhắc / cho nghỉ khác nhau giữa các hạt', differs, victims.map((v, i) => `${runs[i].seed}:[${v || '—'}]`).join(' '));
// phổ người bị nhắc / cho nghỉ: không ai gánh quá nửa số lần (rà soát v3: Tú / Tùng / Trâm chiếm 94% số lần bị đuổi)
const victimEvents = runs.flatMap((r) => [...r.fired, ...r.laidOff, ...r.warned, ...r.resigned]);
const victimCount = new Map<string, number>();
for (const v of victimEvents) victimCount.set(v, (victimCount.get(v) ?? 0) + 1);
const topShare = victimEvents.length ? Math.max(...victimCount.values()) / victimEvents.length : 0;
check('phổ người bị nhắc / cho nghỉ trải rộng: ≥ 3 người khác nhau khi có ≥ 4 lượt, không ai chiếm > 60% số lượt (khi ≥ 5 lượt)',
  (victimEvents.length < 4 || victimCount.size >= 3) && (victimEvents.length < 5 || topShare <= 0.6),
  `${victimEvents.length} lượt: ${[...victimCount.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
const kpiAll = new Map<string, number[]>();
for (const r of runs) for (const [n, v] of Object.entries(r.kpiAvgByName)) kpiAll.set(n, [...(kpiAll.get(n) ?? []), v]);
const kpiMeans = [...kpiAll.entries()].map(([n, xs]) => [n, xs.reduce((a, b) => a + b, 0) / xs.length] as const).sort((a, b) => a[1] - b[1]);
check('% KPI trung bình theo tên (đội hình ban đầu) không thiên lệch hệ thống: người thấp nhất ≥ 70% người cao nhất (qua các hạt)',
  kpiMeans.length < 2 || kpiMeans[0][1] >= 0.7 * kpiMeans[kpiMeans.length - 1][1], kpiMeans.map(([n, v]) => `${n} ${v.toFixed(2)}`).join(' · '));
check('có hạt xảy ra cảnh xin nghỉ (resign_talk) — cửa xin nghỉ không còn bất khả thi', runs.some((r) => r.resignTalks >= 1), infoOf((r) => r.resignTalks));
// v5: tình huống công ty (kẹt tiền, bóc phốt, chia phe…) chạy trọn: có họp xử lý / chốt phương án, không lỗi
check('v5: tình huống công ty đi trọn — ≥ một nửa số hạt có ≥ 1 lần chốt SAU CUỘC HỌP và ≥ 1 mạch tới kết cục; cuộc họp nào diễn xong cũng có câu chốt',
  runs.filter((r) => r.situationDecisions >= 1 && r.situationOutcomes >= 1).length >= Math.ceil(runs.length / 2)
    && all((r) => r.situationDecisions >= (r.scenes.crisis_meeting?.ok ?? 0)),
  infoOf((r) => `${r.situationDecisions} chốt/${r.situationFallbacks} dự phòng/${r.situationOutcomes} kết cục/${r.scenes.crisis_meeting?.ok ?? 0} họp xong/${r.pepTalks} truyền lửa`));
// v5: tình huống không có người trong cuộc (cast 'none'): hiệu ứng "group" chỉ có người khi phương án giao việc sales / tăng ca
// (story.ts groupOf) hoặc nói riêng (pep_one gán người được nói chuyện); "center" chỉ có người sau pep_one — còn lại rơi vào
// nhóm rỗng (không ai chịu hậu quả, lặng lẽ mất tác dụng)
const deadFx = SITUATIONS.flatMap((d) => {
  if (d.cast !== 'none') return [];
  const out: string[] = [];
  if (d.outbreak.fx?.group || d.outbreak.fx?.center) out.push(`${d.kind}/bùng phát`);
  for (const pl of d.plans) {
    const groupNow = pl.follow === 'sales_push' || pl.follow === 'overtime';
    const later = groupNow || pl.follow === 'pep_one';
    if (pl.now?.center || (pl.now?.group && !groupNow)) out.push(`${d.kind}/${pl.code}: ngay khi chốt`);
    if ([pl.good.fx, pl.bad.fx].some((fx) => (fx?.group && !later) || (fx?.center && pl.follow !== 'pep_one'))) out.push(`${d.kind}/${pl.code}: kết cục`);
  }
  return out;
});
check('v5: không hiệu ứng "group" / "center" nào rơi vào nhóm rỗng (tình huống không có người trong cuộc)', deadFx.length === 0, deadFx.join(', '));
// v5: phương án / kết quả truyền lửa do AI chốt (source llm) phải được GIỮ — trước đây Director lọc mất plan_a..d / inspired / unmoved.
// Lỗi phát sinh TRONG lúc kiểm tra này (sau khẳng định "không có lỗi" ở trên) cũng làm nó đỏ.
const problemsBefore = problems.length;
const llmCheck = await llmVerdictCheck();
const llmProblems = problems.slice(problemsBefore);
check('v5: AI chốt phương án ≠ lựa chọn dự phòng → mạch dùng đúng phương án AI (planBy llm); kết quả truyền lửa của AI được giữ',
  llmCheck.ok && !llmProblems.length, llmProblems.length ? `${llmCheck.info} · lỗi: ${llmProblems[0].slice(0, 200)}` : llmCheck.info);
// v5: ngày văn phòng đóng cửa (cuối tuần realtime / server tắt) không làm mạch già đi; bước kế lùi đúng số ngày; tối đa 5 ngày
{
  const sr = new Showrunner(120);
  const mk = (id: string, day: number) => ({ id, kind: 'cash_crunch', intensity: 1, note: 'x', status: 'started', createdDay: day, createdAt: (day - 1) * 1440 + 900, step: 1, total: 4, nextAt: day * 1440 + 600, source: 'offline' });
  sr.restore({ arcs: [mk('fri', 5)] });
  sr.holdAges(2); // thứ Bảy + Chủ nhật
  const a = sr.openArcs()[0];
  const shifted = !!a && a.createdDay === 7 && a.nextAt === 7 * 1440 + 600;
  const keptMon = sr.expire(8).length === 0 && sr.expire(7 + ARC_MAX_AGE_DAYS).length === 0;
  const droppedLater = sr.expire(7 + ARC_MAX_AGE_DAYS + 1).length === 1;
  const sr2 = new Showrunner(120);
  sr2.restore({ arcs: [mk('old', 5)] });
  sr2.holdAges(30);
  const capped = sr2.openArcs()[0]?.createdDay === 10;
  check('v5: holdAges — mạch thứ Sáu còn mở sang thứ Hai, bước kế lùi đúng 2 ngày, rơi sau đủ ngày làm; nghỉ dài chỉ hoãn tối đa 5 ngày',
    shifted && keptMon && droppedLater && capped, `lùi ${shifted} · còn mở ${keptMon} · rơi ${droppedLater} · trần 5 ngày ${capped}`);
}
check('v5: SCENE_DEFS có crisis_meeting + pep_talk', 'crisis_meeting' in SCENE_DEFS && 'pep_talk' in SCENE_DEFS);
check(`kịch bản doanh thu 0 (${SLUMP_DAYS} ngày): ≥ 1 và ≤ 2 đợt cắt giảm, không ai bị cắt khi vào chưa đủ 10 ngày, không phỏng vấn / tuyển trong kỳ kém, hàng rào không vi phạm`,
  slump.laidOff.length >= 1 && slump.laidOff.length <= 2 && slump.laidOffTenure.every((t) => t >= 10) && slump.interviews === 0 && slump.hires === 0 && slump.guardViolations.length === 0,
  `cắt ${slump.laidOff.length} (${slump.laidOffTenure.join('/')}) · phỏng vấn ${slump.interviews} · tuyển ${slump.hires} · vi phạm ${slump.guardViolations.join('; ') || 0}`);
const noFire = runs.filter((r) => r.fired.length === 0 && r.laidOff.length === 0).length;
if (runs.every((r) => r.randomized)) {
  check(`có hạt KHÔNG đuổi / cắt giảm ai trong ${DAYS} ngày (tính cách đã ngẫu nhiên hoá)`, noFire >= 1, `${noFire}/${runs.length} hạt không đuổi ai`);
} else {
  line('  (bỏ qua "có hạt không đuổi ai": World chưa ngẫu nhiên hoá tính cách — chờ sim engineer)');
}
check('không ai kẹt trong cảnh > 4 phút thật', all((r) => r.maxHoldMs < 4 * 60_000), infoOf((r) => `${(r.maxHoldMs / 1000).toFixed(0)}s`));
check('trần: hàng đợi ≤ 40, tin đã dùng ≤ 60, tin đã bàn ≤ 20', all((r) => r.queueMax <= 40 && r.newsUsedMax <= 60 && r.newsDiscussedMax <= 20),
  infoOf((r) => `${r.queueMax}/${r.newsUsedMax}/${r.newsDiscussedMax}`));
check('serialize → restore → serialize khớp (mạch, sổ HR, tin đã bàn) và lọc dữ liệu rác', all((r) => r.roundTrip === 'OK'), runs.filter((r) => r.roundTrip !== 'OK').map((r) => r.roundTrip).join(' | '));
check('nút dev 🗞️ thời sự và 🎬 biên kịch có phản hồi', !/KHÔNG/.test(first.devNews) && !/KHÔNG/.test(first.devShowrunner), `${first.devNews} · ${first.devShowrunner}`);
check('archive có bản ghi hr / beat / news (ghi vào thư mục tạm, đã xoá)', (archiveKinds.get('hr') ?? 0) >= 1 && (archiveKinds.get('beat') ?? 0) >= 1 && (archiveKinds.get('news') ?? 0) >= 1,
  [...archiveKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · '));

line('');
line('Khẳng định:');
for (const [name, ok, info] of checks) line(`  ${ok ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`);
if (problems.length) {
  line('');
  line('Vấn đề:');
  for (const p of problems.slice(0, 20)) line(`  ✗ ${p.slice(0, 600)}`);
}
const failed = checks.filter(([, ok]) => !ok).length;
line('');
line(failed ? `❌ ${failed} khẳng định thất bại (hạt ${SEED0}, ${SEEDS} hạt)` : `✅ Tất cả ${checks.length} khẳng định đều đạt (hạt ${SEED0}, ${SEEDS} hạt)`);
process.exit(failed ? 1 : 0);
