// =====================================================================
//  SMOKE TEST headless: World + Director + Brain (offline) chạy ≥ 6 ngày game,
//  không cần trình duyệt, không cần mạng, không ghi file.
//
//  npm run smoke
//  Biến môi trường (tuỳ chọn):
//    SMOKE_DAYS=6        số ngày game tối thiểu
//    SMOKE_MAX_DAYS=10   chạy thêm tối đa tới ngày này nếu vòng HR (nhắc → đuổi → phỏng vấn → tuyển) chưa xong
//    SMOKE_SEED=123      hạt giống ngẫu nhiên (mặc định: theo giờ) — in ra để chạy lại y hệt
//    SMOKE_SPEED=1       tốc độ tua (1|2|5|10) — x1 là nhịp thật, cân chỉnh KPI chuẩn nhất
//    SMOKE_DEV=0         bỏ phần bấm thử các nút dev ở cuối
//    SMOKE_VERBOSE=1     in toàn bộ log văn phòng
//    SMOKE_SCENE_GAP=8   giây (ảo) tối thiểu giữa 2 cảnh thường (= OFFLINE_MIN_SECONDS) — tăng lên ~25
//                        để giả lập nhịp thưa của chế độ GPT và kiểm tra cân chỉnh KPI
//
//  Bộ điều khiển: bước cố định 100 ms "giờ thật ảo". World.advance(dt) chạy đúng 1 tick
//  (mô phỏng + director.tick + xuất frame), Brain dùng đồng hồ ảo cho nhịp reserve(),
//  và mỗi bước nhường event loop 1 lần để promise (thoại offline) kịp về — y như server thật.
// =====================================================================
import type {
  AgentState, DayRecap, DirectorApi, KpiResult, LogEntry, Rumor, SceneType, ServerMsg,
} from '../src/types.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- RNG có hạt giống (phải đặt TRƯỚC khi nạp module)
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
const SEED = Math.floor(envNum('SMOKE_SEED', Date.now() % 1_000_000_007));
Math.random = mulberry32(SEED);

const MIN_DAYS = Math.max(1, Math.floor(envNum('SMOKE_DAYS', 6)));
const MAX_DAYS = Math.max(MIN_DAYS, Math.floor(envNum('SMOKE_MAX_DAYS', 10)));
const SPEED = [1, 2, 5, 10].includes(envNum('SMOKE_SPEED', 1)) ? envNum('SMOKE_SPEED', 1) : 1;
const RUN_DEV = process.env.SMOKE_DEV !== '0';
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const DT = 100;
const hhmm = (m: number): string => {
  const v = Math.floor(((m % 1440) + 1440) % 1440);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- bắt mọi lỗi / cảnh báo
const problems: string[] = [];
const notes: string[] = [];
const fmtArgs = (args: unknown[]): string =>
  args.map((x) => (x instanceof Error ? (x.stack ?? x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);
console.error = (...args: unknown[]) => { problems.push(`console.error: ${fmtArgs(args)}`); if (VERBOSE) origErr(...args); };
console.warn = (...args: unknown[]) => {
  const s = fmtArgs(args);
  if (/lỗi|quá 23:00|kẹt trong cảnh|failsafe/i.test(s)) problems.push(`console.warn: ${s}`);
  else notes.push(s);
  if (VERBOSE) origWarn(...args);
};
process.on('unhandledRejection', (e) => problems.push(`unhandledRejection: ${fmtArgs([e])}`));
process.on('uncaughtException', (e) => problems.push(`uncaughtException: ${fmtArgs([e])}`));

// ---------------------------------------------------------------- nạp module (sau khi đã gài RNG)
const { CONFIG } = await import('../src/config.js');
const { createBrain } = await import('../src/ai/brain.js');
const { World } = await import('../src/sim/world.js');
const { Director } = await import('../src/sim/director.js');
const { MAP_W, MAP_H, isWalkable, SPOTS, DESKS, ROOMS, FURNITURE, WALLS, MAP_DATA, findPath, roomAt } = await import('../src/sim/map.js');
const scenesMod = await import('../src/sim/scenes.js') as unknown as Record<string, unknown>;
/** drama engineer đã thêm cảnh showroom_chat chưa (khẳng định có điều kiện) */
const hasShowroomChat = typeof scenesMod.SCENE_DEFS === 'object' && scenesMod.SCENE_DEFS !== null
  && 'showroom_chat' in (scenesMod.SCENE_DEFS as Record<string, unknown>);
// v3 (sim): lưu trữ dài hạn + kho tin thời sự (không mạng) + roster gốc để so tính cách
const { getArchive } = await import('../src/sim/archive.js');
const { configureNews, parseRss } = await import('../src/news/index.js');
const { INITIAL_ROSTER } = await import('../src/content/roster.js');

/** v3: archive ghi vào thư mục tạm riêng (xoá khi xong, giữ lại với SMOKE_KEEP_HISTORY=1) */
const HISTORY_DIR = process.env.SMOKE_HISTORY_DIR?.trim() || mkdtempSync(join(tmpdir(), 'vpa-smoke-history-'));

const config = {
  ...CONFIG,
  openaiKey: '',               // luôn offline, không bao giờ gọi mạng
  persist: false,              // không ghi data/state.json
  kpiWarnDays: 1,              // vòng HR diễn ra trong vài ngày
  kpiFireDays: 2,
  timeMode: 'compressed' as const,
  devPanel: true,
  offlineMinSeconds: envNum('SMOKE_SCENE_GAP', CONFIG.offlineMinSeconds),
  // v3 (sim)
  historyEnabled: true,
  historyDir: HISTORY_DIR,
  newsEnabled: false,          // kho tin nạp từ mẫu RSS đã lưu, không tải mạng
  storyRandomizeTraits: true,
  storyTraitDrift: true,
};

// ---------------------------------------------------------------- bản đồ v2 (phòng trưng bày + WC kín) — kiểm tra tĩnh
const mapIssues: string[] = [];
{
  const start = SPOTS.entrance?.[0] ?? { x: 1, y: 16 };
  const reach = (p: { x: number; y: number }): boolean => (p.x === start.x && p.y === start.y) || findPath(start, p).length > 0;
  for (const [g, pts] of Object.entries(SPOTS)) {
    for (const p of pts) {
      if (!isWalkable(p.x, p.y)) mapIssues.push(`chỗ ${g} (${p.x},${p.y}) không đi được`);
      else if (!reach(p)) mapIssues.push(`chỗ ${g} (${p.x},${p.y}) không tới được từ cửa`);
    }
  }
  for (const [id, d] of Object.entries(DESKS)) if (!isWalkable(d.seat.x, d.seat.y) || !reach(d.seat)) mapIssues.push(`ghế ${id} không tới được`);
  const room = (id: string) => ROOMS.find((r) => r.id === id);
  if (room('showroom')?.floor !== 'showroom') mapIssues.push('thiếu phòng showroom (floor showroom)');
  if (!room('wc') || room('toilet')) mapIssues.push('phòng WC sai (cần id wc, không còn toilet)');
  if (FURNITURE.some((f) => f.type === 'toilet' || f.type === 'sink')) mapIssues.push('còn đồ WC cũ (toilet/sink)');
  for (const t of ['shelf_beauty', 'shelf_tech', 'display_table', 'lockers']) if (!FURNITURE.some((f) => f.type === t)) mapIssues.push(`thiếu ${t}`);
  if (FURNITURE.some((f) => f.x >= 19 && f.x <= 22 && f.y >= 1 && f.y <= 6)) mapIssues.push('có đồ đạc bên trong WC');
  const same = (a: { x: number; y: number }[] | undefined, b: [number, number][]): boolean =>
    !!a && a.length === b.length && a.every((p, i) => p.x === b[i][0] && p.y === b[i][1]);
  if (!same(SPOTS.toilet, [[20, 8], [21, 8]])) mapIssues.push('SPOTS.toilet phải là (20,8),(21,8)');
  if (!same(SPOTS.showroom_beauty, [[2, 3], [3, 3], [1, 3]]) || !same(SPOTS.showroom_tech, [[6, 3], [7, 3], [8, 3]])) mapIssues.push('SPOTS showroom sai toạ độ');
  for (const g of ['showroom_beauty', 'showroom_tech']) for (const p of SPOTS[g] ?? []) if (roomAt(p.x, p.y)?.id !== 'showroom') mapIssues.push(`chỗ ${g} không nằm trong phòng showroom`);
  if (WALLS[7]?.[20] !== 'D' || WALLS[7]?.[21] !== 'D') mapIssues.push('cửa WC (20,7),(21,7) phải là D');
  for (let y = 1; y <= 6; y++) for (let x = 19; x <= 22; x++) if (isWalkable(x, y)) mapIssues.push(`bên trong WC (${x},${y}) đi được`);
  if (isWalkable(20, 7) || isWalkable(21, 7)) mapIssues.push('ô cửa WC phải không đi được (cửa đóng)');
  if (!(MAP_DATA as Record<string, unknown>).spots) mapIssues.push('MAP_DATA.spots thiếu');
  let dead = 0;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isWalkable(x, y) && !reach({ x, y })) dead++;
  if (dead) mapIssues.push(`${dead} ô đi được nhưng không tới được từ cửa`);
}

// ---------------------------------------------------------------- đồng hồ ảo + bộ ghi
let vt = Date.now();
const realNow = (): number => vt;

// ---------------------------------------------------------------- v3 (sim): archive JSONL (thư mục tạm) + kho tin từ mẫu RSS
const archive = getArchive().configure({ enabled: true, dir: HISTORY_DIR, keepDays: 180, gzipAfterDays: 7, flushMs: 300, now: realNow }).start();
const news = configureNews({ enabled: false, feeds: [] });
news.clear();
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'news');
const fixtureItems = [
  ...parseRss(readFileSync(join(FIXTURES, 'gamek-home.xml'), 'utf8'), 'game'),
  ...parseRss(readFileSync(join(FIXTURES, 'tuoitre-the-thao.xml'), 'utf8'), 'the_thao'),
].map((it, i) => ({ ...it, publishedAt: Date.now() - (i + 1) * 60_000 })); // luôn "mới" dù mẫu đã cũ
const injectedNews = news.inject(fixtureItems).added;

interface SceneRec {
  id: string; type: SceneType; title: string; day: number; channel: string; participants: string[];
  lines: number; products: number; ended: 'ok' | 'aborted' | null; startVt: number;
}
const scenes = new Map<string, SceneRec>();
const msgCount: Record<string, number> = {};
const toasts: string[] = [];
const recapsSeen: DayRecap[] = [];
const kpiByDay = new Map<number, KpiResult[]>();
const names = new Map<string, string>();
const samples = new Map<SceneType, string[]>();
const sampleScene = new Map<SceneType, string>();
const productSamples: string[] = [];
const allLogs: LogEntry[] = [];
let lines = 0;
let productLines = 0;
let frames = 0;
let badFrame = '';
let rumorsMsgs = 0;
let lastRumors: Rumor[] = [];
let maxRumorVersions = 0;
let mutatedRumor: Rumor | null = null;

const nameOf = (id: string): string => names.get(id) ?? id;

function onLog(e: LogEntry): void {
  allLogs.push(e);
  if (allLogs.length > 5000) allLogs.splice(0, 1000);
  if (VERBOSE) origLog(`  [N${e.day} ${hhmm(e.minute)}] ${e.kind}${e.channel && e.channel !== 'office' ? `/${e.channel}` : ''} ${e.icon ?? ''} ${e.speakerName ? e.speakerName + ': ' : ''}${e.text}`);
  if (e.kind !== 'line') return;
  lines++;
  const sc = e.sceneId ? scenes.get(e.sceneId) : undefined;
  if (sc) {
    sc.lines++;
    if (!sampleScene.has(sc.type)) sampleScene.set(sc.type, sc.id);
    if (sampleScene.get(sc.type) === sc.id) {
      const list = samples.get(sc.type) ?? [];
      if (list.length < 4) list.push(`${e.speakerName ?? e.speaker}: ${e.text}`);
      samples.set(sc.type, list);
    }
  }
  if (e.product) {
    productLines++;
    if (sc) sc.products++;
    if (productSamples.length < 3) productSamples.push(`${e.speakerName}: ${e.text}  →  🛒 ${e.product.emoji} ${e.product.name} (${e.product.url})`);
    if (!/^\/go\/[a-z0-9-]+\?src=[a-z0-9_-]+$/.test(e.product.url)) problems.push(`product url lạ: ${e.product.url}`);
  }
}

function emit(msg: ServerMsg): void {
  msgCount[msg.t] = (msgCount[msg.t] ?? 0) + 1;
  switch (msg.t) {
    case 'frame': {
      frames++;
      for (const fa of msg.a) {
        const [id, x, y, , act, , flags] = fa;
        const ok = typeof id === 'string' && Number.isFinite(x) && Number.isFinite(y)
          && x >= 0 && y >= 0 && x <= MAP_W - 1 && y <= MAP_H - 1 && isWalkable(Math.round(x), Math.round(y))
          && typeof act === 'string' && Number.isInteger(flags);
        if (!ok && !badFrame) badFrame = `N${msg.clock.day} ${hhmm(msg.clock.minute)}: ${JSON.stringify(fa)}`;
        // v2: flag 8 (ẩn trong WC) phải khớp a.hidden và chỉ đi với activity 'toilet'
        const ag = world.agent(id);
        if (ag && ((flags & 8) !== 0) !== !!ag.hidden && !badFrame) badFrame = `N${msg.clock.day} ${hhmm(msg.clock.minute)}: flag 8 lệch hidden (${id})`;
        if ((flags & 8) !== 0 && act !== 'toilet' && !badHidden) badHidden = `frame: ${id} ẩn nhưng activity=${act}`;
      }
      break;
    }
    case 'agents':
      for (const a of msg.agents) names.set(a.id, a.name);
      break;
    case 'log':
      onLog(msg.entry);
      break;
    case 'scene': {
      const s = msg.scene;
      if (s.status === 'start') {
        scenes.set(s.id, {
          id: s.id, type: s.type, title: s.title, day: world.day(), channel: s.channel, participants: s.participants,
          lines: 0, products: 0, ended: null, startVt: vt,
        });
      } else {
        const rec = scenes.get(s.id);
        if (rec) rec.ended = /bị gián đoạn/.test(s.summary ?? '') ? 'aborted' : 'ok';
        else problems.push(`scene end không có start: ${s.id}`);
      }
      break;
    }
    case 'recap':
      recapsSeen.push(msg.recap);
      break;
    case 'rumors':
      rumorsMsgs++;
      lastRumors = msg.rumors;
      for (const r of msg.rumors) {
        if (r.versions.length > maxRumorVersions) maxRumorVersions = r.versions.length;
        if (r.versions.length >= 2 && new Set(r.versions.map((v) => v.text)).size >= 2) mutatedRumor = r;
      }
      break;
    case 'toast':
      toasts.push(`${msg.icon} ${msg.text}`);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- dựng văn phòng
const brain = createBrain(config, { now: realNow });
const world = new World({ config, brain, emit, now: realNow });
const director = new Director(world, brain);
/** v3: tính cách lúc khởi tạo (đã ngẫu nhiên hoá) để so với roster; hệ số ngày từng ngày */
const initialTraits = new Map(world.agents().map((a) => [a.id, { traits: { ...a.traits }, base: a.traitBase ? { ...a.traitBase } : null }]));
const dayFactors = new Map<number, Map<string, number | undefined>>();
const snapDayFactors = (): void => {
  dayFactors.set(world.day(), new Map(world.agents().filter((a) => a.status === 'active').map((a) => [a.id, a.dayFactor])));
};
snapDayFactors();

interface DayStat { arrivals: number; late: number; departures: number; removed: number; maxPresent: number; endPresent: number }
const dayStats = new Map<number, DayStat>();
const dayStat = (d: number): DayStat => {
  let s = dayStats.get(d);
  if (!s) { s = { arrivals: 0, late: 0, departures: 0, removed: 0, maxPresent: 0, endPresent: 0 }; dayStats.set(d, s); }
  return s;
};
let slackerSpots = 0;
let bossLeft = 0;
let bossBack = 0;
const events: string[] = [];

// Director bọc lớp "nghe lén" để ghi lại World đã gọi gì
const spy: DirectorApi = {
  tick: (dt) => director.tick(dt),
  onDayStart: (d) => director.onDayStart(d),
  onDayEnd: (d, results) => {
    kpiByDay.set(d, results.map((r) => ({ ...r })));
    dayStat(d).endPresent = world.agents().filter((a) => a.present).length;
    for (const a of world.agents()) if (a.hidden) problems.push(`N${d}: ${a.name} vẫn ẩn (hidden) trong WC lúc hết ngày`);
    hiddenSince.clear(); // đồng hồ nhảy sang ngày mới — không tính thời gian ẩn qua đêm
    director.onDayEnd(d, results);
  },
  onEvent: (n, data) => { events.push(n); director.onEvent(n, data); },
  onBossLeft: (r) => { bossLeft++; director.onBossLeft(r); },
  onBossReturned: () => { bossBack++; director.onBossReturned(); },
  onSlackerSpotted: (b, v) => { slackerSpots++; director.onSlackerSpotted(b, v); },
  onAgentArrived: (id, late) => { if (late) dayStat(world.day()).late++; director.onAgentArrived(id, late); },
  publicScenes: () => director.publicScenes(),
  recaps: () => director.recaps(),
  rumors: () => director.rumors(),
  serialize: () => director.serialize(),
  restore: (d) => director.restore(d),
};
world.attachDirector(spy);
for (const a of world.agents()) names.set(a.id, a.name);

// ---------------------------------------------------------------- kiểm tra từng bước
const present = new Map<string, boolean>();
const sceneHold = new Map<string, { sid: string; since: number }>();
/** phút game trong cảnh (giờ hành chính 08:00–17:30) theo ngày → id → [office, online] */
const sceneMin = new Map<number, Map<string, [number, number]>>();
let lastT = world.time();
let maxHold = { ms: 0, who: '', sid: '' };
let badState = '';
let steps = 0;
// v2: phòng trưng bày + WC ẩn
const lastAct = new Map<string, string>();
let showroomVisits = 0;
const showroomBy = new Map<string, number>();
const shelfVisits = { beauty: 0, tech: 0, womenBeauty: 0, womenTotal: 0, techRoleTech: 0, techRoleTotal: 0 };
const shelfSeen = new Set<string>();
let badShowroom = '';
const hiddenSince = new Map<string, number>();
let hiddenToggles = 0;
let maxHidden = { min: 0, who: '', day: 0 };
let badHidden = '';
const TECH_ROLES = new Set(['techlead', 'senior', 'junior', 'qa', 'designer']);

function checkStep(): void {
  const d = world.day();
  const st = dayStat(d);
  const tNow = world.time();
  const dtGame = tNow - lastT > 0 && tNow - lastT < 10 ? tNow - lastT : 0;
  lastT = tNow;
  const mNow = world.minuteOfDay();
  const inWork = mNow >= 480 && mNow <= 1050 && !(mNow >= 720 && mNow < 780);
  const sm = sceneMin.get(d) ?? new Map<string, [number, number]>();
  sceneMin.set(d, sm);
  const seen = new Set<string>();
  let nPresent = 0;
  for (const a of world.agents()) {
    seen.add(a.id);
    names.set(a.id, a.name);
    const nums = [a.x, a.y, a.energy, a.mood, a.stress, a.kpiToday];
    if (!badState && (!nums.every(Number.isFinite) || a.energy < 0 || a.energy > 100 || a.mood < 0 || a.mood > 100
      || a.stress < 0 || a.stress > 100 || a.kpiToday < 0)) {
      badState = `N${d} ${hhmm(world.minuteOfDay())} ${a.id}: ${JSON.stringify(nums)}`;
    }
    const was = present.get(a.id) ?? false;
    if (a.present && !was) st.arrivals++;
    if (!a.present && was) st.departures++;
    present.set(a.id, a.present);
    if (a.present) nPresent++;
    if (a.sceneId && inWork && dtGame > 0 && a.status === 'active') {
      const rec = sm.get(a.id) ?? [0, 0];
      if (a.onPhone) rec[1] += dtGame; else rec[0] += dtGame;
      sm.set(a.id, rec);
    }
    // giữ sceneId bao lâu (giờ thật ảo)
    if (a.sceneId) {
      const h = sceneHold.get(a.id);
      if (!h || h.sid !== a.sceneId) sceneHold.set(a.id, { sid: a.sceneId, since: vt });
      else if (vt - h.since > maxHold.ms) maxHold = { ms: vt - h.since, who: a.name, sid: a.sceneId };
    } else sceneHold.delete(a.id);
    // v2 — phòng trưng bày: đếm lượt ghé, kiểm tra đứng đúng chỗ (spotKey showroom_* + trong phòng showroom)
    if (a.activity === 'showroom' && lastAct.get(a.id) !== 'showroom') {
      showroomVisits++;
      showroomBy.set(a.id, (showroomBy.get(a.id) ?? 0) + 1);
    }
    if (a.activity === 'showroom' && a.present && !a.path.length) {
      const shelf = a.spotKey?.startsWith('showroom_beauty') ? 'beauty' : a.spotKey?.startsWith('showroom_tech') ? 'tech' : null;
      if (!shelf || roomAt(a.x, a.y)?.id !== 'showroom') {
        if (!badShowroom) badShowroom = `N${d} ${hhmm(mNow)} ${a.name}: showroom nhưng spotKey=${a.spotKey} phòng=${roomAt(a.x, a.y)?.id}`;
      } else {
        const key = `${a.id}#${showroomBy.get(a.id) ?? 0}`;
        if (!shelfSeen.has(key)) {
          shelfSeen.add(key);
          shelfVisits[shelf]++;
          if (a.gender === 'nữ') { shelfVisits.womenTotal++; if (shelf === 'beauty') shelfVisits.womenBeauty++; }
          if (TECH_ROLES.has(a.role)) { shelfVisits.techRoleTotal++; if (shelf === 'tech') shelfVisits.techRoleTech++; }
        }
      }
    }
    lastAct.set(a.id, a.activity);
    // v2 — WC ẩn: chỉ khi có mặt + activity toilet; đo thời gian ẩn (phút game); không bao giờ > 30 phút
    const hid = !!a.hidden;
    const since = hiddenSince.get(a.id);
    if (hid && since === undefined) { hiddenSince.set(a.id, tNow); hiddenToggles++; }
    if (!hid && since !== undefined) {
      hiddenSince.delete(a.id);
      const durMin = tNow - since;
      if (durMin > maxHidden.min) maxHidden = { min: durMin, who: a.name, day: d };
    }
    if (hid && (!a.present || a.activity !== 'toilet') && !badHidden) badHidden = `N${d} ${hhmm(mNow)} ${a.name} ẩn nhưng present=${a.present} activity=${a.activity}`;
    if (hid && since !== undefined && tNow - since > 30 && !badHidden) badHidden = `N${d} ${hhmm(mNow)} ${a.name} ẩn quá 30 phút game`;
  }
  for (const id of [...present.keys()]) {
    if (!seen.has(id)) { present.delete(id); sceneHold.delete(id); st.removed++; }
  }
  if (nPresent > st.maxPresent) st.maxPresent = nPresent;
}

const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

async function step(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    vt += DT;
    world.advance(DT);
    steps++;
    checkStep();
    await yieldLoop();
  }
}

// ---------------------------------------------------------------- HR arc
function hrState() {
  const done = (t: SceneType) => [...scenes.values()].some((s) => s.type === t && s.ended === 'ok');
  return {
    warning: done('hr_warning'),
    firing: done('firing') && allLogs.some((e) => e.kind === 'hr' && /bị cho nghỉ việc/.test(e.text)),
    interview: done('interview'),
    hire: allLogs.some((e) => e.kind === 'hr' && /chính thức gia nhập/.test(e.text)),
  };
}
const hrDone = (): boolean => Object.values(hrState()).every(Boolean);

// ================================================================== chạy
const t0 = performance.now();
origLog(`🧪 Smoke test — seed ${SEED}, tốc độ x${SPEED}, tối thiểu ${MIN_DAYS} ngày (tối đa ${MAX_DAYS}), KPI_WARN_DAYS=1, KPI_FIRE_DAYS=2, offline`);
if (SPEED !== 1) world.handleClient({ t: 'dev', action: 'speed', value: SPEED });

let lastDay = world.day();
while (true) {
  await step(1);
  const d = world.day();
  if (d !== lastDay) {
    const k = kpiByDay.get(lastDay);
    const sc = [...scenes.values()].filter((s) => s.day === lastDay);
    origLog(`  ✓ Hết ngày ${lastDay}: ${sc.length} cảnh, ${sc.reduce((n, s) => n + s.lines, 0)} câu thoại, KPI chấm cho ${k?.length ?? 0} người`
      + ` (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    lastDay = d;
    snapDayFactors();
    if (d > MIN_DAYS && (hrDone() || d > MAX_DAYS)) break;
  }
  if (steps > 2_000_000) { problems.push('quá nhiều bước — đồng hồ không chạy?'); break; }
}
const mainSteps = steps;
const mainSec = (performance.now() - t0) / 1000;
const daysRun = lastDay - 1;

// ---------------------------------------------------------------- phần 2: bấm thử nút dev
interface DevCheck { name: string; ok: boolean; info: string }
const devChecks: DevCheck[] = [];
async function devEvent(name: string, expect: RegExp, waitSec: number, src: 'log' | 'toast' | 'any' = 'any'): Promise<void> {
  const logFrom = allLogs.length, toastFrom = toasts.length;
  world.handleClient({ t: 'dev', action: 'event', name: name as never });
  for (let i = 0; i < waitSec * (1000 / DT); i++) {
    await step(1);
    const hitLog = src !== 'toast' && allLogs.slice(logFrom).find((e) => expect.test(e.text));
    const hitToast = src !== 'log' && toasts.slice(toastFrom).find((t) => expect.test(t));
    if (hitLog || hitToast) {
      devChecks.push({ name, ok: true, info: hitLog ? `log: ${hitLog.icon ?? ''} ${hitLog.text}` : `toast: ${hitToast}` });
      return;
    }
  }
  devChecks.push({ name, ok: false, info: `không thấy phản hồi khớp ${expect} sau ${waitSec}s` });
}
if (RUN_DEV) {
  if (SPEED !== 1) world.handleClient({ t: 'dev', action: 'speed', value: 1 });
  // tới ~10:30 cho mọi người có mặt
  while (world.minuteOfDay() < 630) await step(1);
  await devEvent('boss_return', /Sếp/, 30);
  await devEvent('boss_leave', /Sếp ra ngoài|ra ngoài|đi vắng|Sếp không có|Sếp đang/, 60);
  await devEvent('boss_return', /Sếp đã về|Sếp/, 30);
  await devEvent('wifi_down', /wifi|Wifi/, 20);
  await devEvent('payday', /Lương về/, 20);
  await devEvent('birthday', /sinh nhật/i, 20);
  await devEvent('deal', /chốt hợp đồng/, 20);
  await devEvent('drama', /drama|Có biến/i, 20);
  await devEvent('server_down', /Sập server|server/i, 20);
  // v3: nút "HR xét KPI" có thể trả lời bằng log rà soát, cảnh hr_review (⚖️ Họp xét nhân sự) hoặc toast khi sếp vắng
  await devEvent('hr_review', /rà soát|xét nhân sự|nhân sự|hr_review/i, 30);
  await devEvent('release', /Release/i, 20);
  world.handleClient({ t: 'dev', action: 'speed', value: 10 });
  await step(300);
  world.handleClient({ t: 'dev', action: 'speed', value: 1 });
  const dayBefore = world.day();
  world.handleClient({ t: 'dev', action: 'event', name: 'end_day' });
  await step(50);
  devChecks.push({ name: 'end_day', ok: world.day() === dayBefore + 1, info: `ngày ${dayBefore} → ${world.day()}` });
  // garbage từ client không được làm sập
  world.handleClient({ t: 'dev', action: 'event', name: 'khong_co' as never });
  world.handleClient({ t: 'dev', action: 'speed', value: 7 });
  world.handleClient(null as never);
  await step(600);
}

// ---------------------------------------------------------------- phần 3: serialize / restore
let roundTrip = 'bỏ qua';
try {
  const json = JSON.stringify(director.serialize());
  const d2 = new Director(world, brain);
  d2.restore(JSON.parse(json));
  d2.restore('rác' as never);
  d2.restore({ v: 1, queue: [{ type: 'firing', at: 'x' }], rumors: { list: [{ id: 5 }] } });
  const helloJson = JSON.stringify(world.hello());
  roundTrip = `director ${json.length} B, hello ${helloJson.length} B — OK`;
} catch (e) {
  problems.push(`serialize/restore lỗi: ${fmtArgs([e])}`);
  roundTrip = 'LỖI';
}

// ---------------------------------------------------------------- phần 4: đếm click theo sản phẩm × nguồn (/api/stats, v2)
let clicksOk = false;
let clicksInfo = '';
try {
  const before = world.clickStats();
  const silent = console.log;
  console.log = () => { /* [click] ... không cần in trong smoke */ };
  try {
    world.recordClick('son-kem-li', 'showroom');
    world.recordClick('son-kem-li', 'sidebar');
    world.recordClick('ban-phim-co', 'showroom');
    world.recordClick('ban-phim-co', 'nguồn lạ!');
    world.recordClick('', 'showroom'); // id rỗng: bỏ qua
  } finally {
    console.log = silent;
  }
  const cs = world.clickStats();
  const d = (a: Record<string, number> | undefined, b: Record<string, number> | undefined, k: string): number => (a?.[k] ?? 0) - (b?.[k] ?? 0);
  clicksOk = cs.clicks - before.clicks === 4
    && d(cs.clicksBy, before.clicksBy, 'son-kem-li') === 2 && d(cs.clicksBy, before.clicksBy, 'ban-phim-co') === 2
    && d(cs.clicksBySource, before.clicksBySource, 'showroom') === 2 && d(cs.clicksBySource, before.clicksBySource, 'sidebar') === 1
    && d(cs.clicksBySource, before.clicksBySource, 'khac') === 1
    && d(cs.clicksByProductSource['son-kem-li'], before.clicksByProductSource['son-kem-li'], 'showroom') === 1
    && d(cs.clicksByProductSource['son-kem-li'], before.clicksByProductSource['son-kem-li'], 'sidebar') === 1
    && d(cs.clicksByProductSource['ban-phim-co'], before.clicksByProductSource['ban-phim-co'], 'khac') === 1;
  clicksInfo = `clicks ${cs.clicks}, nguồn ${JSON.stringify(cs.clicksBySource)}`;
} catch (e) {
  problems.push(`clickStats lỗi: ${fmtArgs([e])}`);
  clicksInfo = 'LỖI';
}

// ---------------------------------------------------------------- phần 5 (v3 — sim): tính cách, hệ số ngày, WorldApi mới, archive, kho tin
// Khẳng định về hr_review (quyết định hợp lệ, hàng rào), beats của AI biên kịch và news_chat nằm ở scripts/smoke-story.ts (6 hạt × 12 ngày).
const v3: [string, boolean, string][] = [];
const v3check = (name: string, ok: boolean, info = ''): void => { v3.push([name, ok, info]); };
const TRAIT_KEYS = ['diligence', 'laziness', 'gossip', 'temper', 'humor', 'ambition'] as const;
{
  // 5a. tính cách lần đầu ≠ roster (kẹp 0.05..0.95, có traitBase). Trait LỜI NÓI (gossip/temper/humor/ambition) = roster ± 0.15;
  //     trait CÔNG VIỆC của nhân viên (không sếp / HR) rút về dải chung (diligence 0.45..0.7, laziness 0.35..0.6) ± 0.15 → không ai
  //     bị "đánh dấu" kém từ roster (rà soát v3: Tú / Tùng / Trâm chiếm 94% số lần bị đuổi khi chỉ kéo người cực đoan về sàn).
  const rosterById = new Map(INITIAL_ROSTER.map((p) => [p.id, p]));
  const TALK_KEYS = ['gossip', 'temper', 'humor', 'ambition'] as const;
  let differ = 0, outOfRange = 0, tooFar = 0, badBase = 0, compared = 0, outOfBand = 0;
  for (const [id, rec] of initialTraits) {
    const p = rosterById.get(id);
    if (!p) continue;
    compared++;
    if (!rec.base || TRAIT_KEYS.some((k) => Math.abs(rec.base![k] - rec.traits[k]) > 1e-9)) badBase++;
    if (TRAIT_KEYS.some((k) => Math.abs(rec.traits[k] - p.traits[k]) > 1e-6)) differ++;
    if (TRAIT_KEYS.some((k) => rec.traits[k] < 0.05 || rec.traits[k] > 0.95)) outOfRange++;
    if (TALK_KEYS.some((k) => Math.abs(rec.traits[k] - p.traits[k]) > 0.1501)) tooFar++;
    const staff = p.role !== 'boss' && p.role !== 'hr';
    if (staff) {
      if (rec.traits.diligence < 0.45 - 0.1501 || rec.traits.diligence > 0.7 + 0.1501) outOfBand++;
      if (rec.traits.laziness < 0.35 - 0.1501 || rec.traits.laziness > 0.6 + 0.1501) outOfBand++;
    } else if (Math.abs(rec.traits.diligence - p.traits.diligence) > 0.1501 || Math.abs(rec.traits.laziness - p.traits.laziness) > 0.1501) tooFar++;
  }
  v3check('v3: tính cách lần đầu được ngẫu nhiên hoá (≠ roster; trait lời nói lệch ≤ 0.15; trait công việc của nhân viên trong dải chung; 0.05..0.95; traitBase = gốc)',
    compared >= 8 && differ >= compared - 1 && outOfRange === 0 && tooFar === 0 && badBase === 0 && outOfBand === 0,
    `${differ}/${compared} người khác roster · ngoài khoảng ${outOfRange} · lệch quá 0.15: ${tooFar} · ngoài dải công việc ${outOfBand} · traitBase sai ${badBase}`);
  // KPI không còn thiên lệch theo vai: % KPI 12 ngày không có ai thấp hệ thống chỉ vì chỉ tiêu cao (Sales 300) — xem cuối smoke-story

  // 5b. driftTrait bị kẹp quanh traitBase ± 0.25 (mỗi lần ≤ 0.2)
  const drifter = world.agents().find((a) => a.status === 'active' && a.role !== 'boss' && a.role !== 'hr' && a.traitBase);
  let driftOk = false;
  let driftInfo = 'không có ai để thử';
  if (drifter) {
    const base = drifter.traitBase!.diligence;
    const start = drifter.traits.diligence;
    let up = NaN;
    for (let i = 0; i < 6; i++) up = world.driftTrait(drifter.id, 'diligence', 0.2);
    let down = NaN;
    for (let i = 0; i < 12; i++) down = world.driftTrait(drifter.id, 'diligence', -0.2);
    // trần / sàn = base ± 0.25 (kẹp 0.05..0.95); lệch tạm trong ngày (thất tình −0.15) có thể dời tâm một chút
    driftOk = up >= down && up - down <= 0.5 + 1e-6 && up <= 0.95 && down >= 0.05 && Math.abs((up + down) / 2 - base) <= 0.16
      && drifter.traits.diligence === down && Number.isNaN(world.driftTrait('khong_co_ai', 'diligence', 0.1));
    driftInfo = `${drifter.name}: gốc ${base} (hiện ${start}) → lên ${up} → xuống ${down}`;
    world.driftTrait(drifter.id, 'diligence', start - down); // trả lại như cũ
  }
  v3check('v3: driftTrait kẹp trong traitBase ± 0.25, id lạ → NaN', driftOk, driftInfo);

  // 5c. hệ số ngày: mỗi người mỗi ngày trong 0.55..1.2 (ốm có thể xuống 0.6), đổi theo ngày; có log lý do tiếng Việt
  const dfDays = [...dayFactors.entries()].sort((a, b) => a[0] - b[0]);
  // (số người có thể < 10 vì hr_review của Director có thể cho nghỉ / cắt giảm — chỉ cần mọi người đang làm đều có hệ số)
  const dfOk = dfDays.length >= 2 && dfDays.every(([, m]) => m.size >= 3 && [...m.values()].every((f) => typeof f === 'number' && f >= 0.55 && f <= 1.2));
  let changed = 0;
  for (let i = 1; i < dfDays.length; i++) {
    for (const [id, f] of dfDays[i][1]) if (dfDays[i - 1][1].has(id) && dfDays[i - 1][1].get(id) !== f) changed++;
  }
  v3check('v3: dayFactor được đặt mỗi ngày (0.55..1.2) và đổi theo ngày', dfOk && changed >= (dfDays.length - 1) * 5, `${dfDays.length} ngày, ${changed} lần đổi`);
  const V3_ICONS = new Set(['😪', '✨', '🤒', '💔', '📱', '😤', '🎉']);
  const dayNotes = allLogs.filter((e) => e.kind === 'event' && V3_ICONS.has(e.icon ?? '') && /uể oải|lờ đờ|chậm|sung|tỉnh như sáo|có hứng|vào guồng|bị cảm|thất tình|kẹt xe|khách chửi|trúng số/.test(e.text));
  v3check('v3: có log lý do ngày hên / xui hoặc sự kiện cá nhân (tiếng Việt có dấu)', dayNotes.length >= 1 && dayNotes.every((e) => /[ăâđêôơưàảãáạ]/i.test(e.text)),
    dayNotes.slice(0, 3).map((e) => `${e.icon} ${e.text}`).join(' | ') || 'không có');

  // 5d. WorldApi v3: setRole / setProbation / grantBonus / headcount / removeAgent(reason) — sếp / HR không bị loại
  for (let i = 0; i < 3000 && !world.agents().some((a) => a.status === 'active' && a.present && a.role !== 'boss' && a.role !== 'hr'); i++) await step(1);
  const before = world.headcount();
  const victim = world.agents().find((a) => a.status === 'active' && a.present && a.role !== 'boss' && a.role !== 'hr');
  let removeOk = false;
  let removeInfo = 'không ai có mặt để thử';
  if (victim) {
    const day = world.day();
    const promos0 = victim.promotions ?? 0; // Director (hr_review) có thể đã thăng chức / thưởng người này trước đó
    const bonus0 = victim.bonuses ?? 0;
    world.setRole(victim.id, 'Chuyên viên cấp cao', 320);
    world.setProbation(victim.id, day + 2);
    world.grantBonus(victim.id);
    const roleOk = victim.roleLabel === 'Chuyên viên cấp cao' && victim.kpiTarget === 320 && victim.promotions === promos0 + 1
      && victim.probationUntilDay === day + 2 && victim.bonuses === bonus0 + 1;
    world.removeAgent(victim.id, 'resigned');
    const labelOk = victim.status === 'fired' && victim.emote === '👋' && /nghỉ việc/.test(victim.activityLabel);
    let gone = false;
    for (let i = 0; i < 4000 && !gone; i++) { await step(1); gone = world.agent(victim.id) === undefined; }
    removeOk = roleOk && labelOk && gone && world.headcount() === before - 1;
    removeInfo = `${victim.name}: setRole/setProbation/grantBonus ${roleOk ? 'ok' : 'LỖI'} · nhãn 👋 ${labelOk ? 'ok' : 'LỖI'} · ${gone ? 'đã rời văn phòng' : 'CHƯA rời'} · headcount ${before} → ${world.headcount()}`;
  }
  v3check('v3: setRole / setProbation / grantBonus / headcount / removeAgent(resigned) đi ra với 👋', removeOk, removeInfo);
  const hrId = world.hr()?.id;
  if (hrId) world.removeAgent(hrId, 'laid_off');
  v3check('v3: sếp / HR không bao giờ bị loại', !!world.hr() && !!world.boss());

  // 5e. archive JSONL: đủ dòng, đọc lại được, không rớt; xoay vòng gzip / xoá; đọc .gz
  await archive.flush();
  const days = await archive.listDays();
  const total = days.reduce((n, d) => n + d.count, 0);
  const st = archive.stats();
  const first = days[0];
  const sample = first ? await archive.readDay(first.date, { limit: 50 }) : [];
  const files = readdirSync(HISTORY_DIR);
  // Director có thể ghi thêm kind khác (recap / hr / beat / news…) — chỉ cần mọi dòng đúng dạng và có cả 'log' lẫn 'kpi'
  const allEntries: { ts: number; kind: string; data: unknown }[] = [];
  for (const d of days) allEntries.push(...await archive.readDay(d.date));
  const kinds = new Set(allEntries.map((e) => e.kind));
  v3check('v3: archive JSONL theo ngày — đủ dòng (≥ log + kpi), đọc lại được (có kind log + kpi), không rớt / lỗi, hàng đợi rỗng',
    days.length >= 1 && total >= (msgCount.log ?? 0) + daysRun && sample.length === 50 && allEntries.length === total
      && allEntries.every((e) => typeof e.ts === 'number' && typeof e.kind === 'string' && e.kind.length > 0) && kinds.has('log') && kinds.has('kpi')
      && allEntries.filter((e) => e.kind === 'log').length >= (msgCount.log ?? 0) && allEntries.filter((e) => e.kind === 'kpi').length >= daysRun
      && st.dropped === 0 && st.errors === 0 && st.queued === 0 && files.every((f) => /^\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$/.test(f)),
    `${days.map((d) => `${d.date}: ${d.count} dòng, ${(d.bytes / 1024).toFixed(0)} KB`).join(' · ')} · kind: ${[...kinds].join(', ')} · log ${msgCount.log ?? 0} · ghi ${st.written}, rớt ${st.dropped}, lỗi ${st.errors}`);
  const vnDay = (ms: number): string => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
  const oldDate = vnDay(vt - 10 * 86_400_000);
  const ancient = vnDay(vt - 700 * 86_400_000);
  writeFileSync(join(HISTORY_DIR, `${oldDate}.jsonl`), '{"ts":1,"kind":"log","data":{"text":"cũ"}}\nkhông phải json\n{"ts":2,"kind":"recap","data":null}\n');
  writeFileSync(join(HISTORY_DIR, `${ancient}.jsonl`), '{"ts":0,"kind":"log","data":null}\n');
  const rot = await archive.rotate();
  const afterRot = readdirSync(HISTORY_DIR).filter((f) => f !== 'index.json');
  const gzRead = await archive.readDay(oldDate);
  const whole = first ? await archive.readDay(first.date) : [];
  v3check('v3: archive xoay vòng — gzip file > 7 ngày, xoá file > 180 ngày, đọc được .gz (bỏ dòng hỏng), ≤ 5000 dòng / lần đọc',
    rot.gzipped === 1 && rot.deleted === 1 && afterRot.includes(`${oldDate}.jsonl.gz`) && !afterRot.includes(`${oldDate}.jsonl`)
      && !afterRot.some((f) => f.startsWith(ancient)) && gzRead.length === 2 && gzRead[1].kind === 'recap' && whole.length <= 5000 && !archive.hasDay(ancient),
    `nén ${rot.gzipped}, xoá ${rot.deleted}, đọc .gz ${gzRead.length} dòng, đọc cả ngày ${whole.length} dòng`);
  // 5e'. đọc dở một ngày .gz (limit nhỏ) không được rò file descriptor (rà soát v3: 100 lần mở "Lịch sử" = +100 fd → EMFILE trên VPS);
  //      số dòng ngày .gz được ghi vào index.json để sau khởi động không giải nén lại
  {
    const bigDate = vnDay(vt - 20 * 86_400_000);
    writeFileSync(join(HISTORY_DIR, `${bigDate}.jsonl`), Array.from({ length: 3000 }, (_, i) => JSON.stringify({ ts: i, kind: 'log', data: { text: `dòng ${i} ` + 'x'.repeat(120) } })).join('\n') + '\n');
    await archive.rotate();
    const fdCount = (): number => { try { return readdirSync('/dev/fd').length; } catch { return -1; } };
    const before = fdCount();
    for (let i = 0; i < 50; i++) await archive.readDay(bigDate, { limit: 5 });
    for (let i = 0; i < 10; i++) await archive.readDay(bigDate, { limit: 1200 });
    const after = fdCount();
    const listed = await archive.listDays();
    const idx = JSON.parse(readFileSync(join(HISTORY_DIR, 'index.json'), 'utf8')) as Record<string, { count?: number }>;
    const fresh = getArchive().configure({ enabled: true, dir: HISTORY_DIR, keepDays: 180, gzipAfterDays: 7 });
    const t0 = performance.now();
    const relisted = await fresh.listDays();
    const coldMs = performance.now() - t0;
    v3check('v3: đọc dở ngày .gz 60 lần không rò fd; index.json nhớ số dòng ngày .gz (3000) và được dùng lại sau configure() (không giải nén lại)',
      before >= 0 && after - before <= 2 && listed.find((d) => d.date === bigDate)?.count === 3000 && idx[bigDate]?.count === 3000
        && relisted.find((d) => d.date === bigDate)?.count === 3000 && coldMs < 150,
      `fd ${before} → ${after} · index.json[${bigDate}].count = ${idx[bigDate]?.count ?? '—'} · liệt kê lại ${coldMs.toFixed(0)} ms`);
  }

  // 5f. kho tin thời sự (inject từ mẫu RSS, không mạng): pick / exclude / markUsed / hello.news
  const picked = news.pick(['game']);
  const picked2 = news.pick(['the_thao'], new Set(picked ? [picked.id] : []));
  if (picked) news.markUsed(picked.id);
  const helloNews = (world.hello() as Extract<ServerMsg, { t: 'hello' }>).news ?? [];
  v3check('v3: kho tin (nạp từ mẫu RSS, không mạng) — pick theo nhóm / exclude / markUsed / hello.news ≤ 5, mới nhất cuối',
    injectedNews >= 60 && !!picked && picked.category === 'game' && !!picked2 && picked2.id !== picked.id
      && ['the_thao', 'bong_da'].includes(picked2.category) && news.isUsed(picked.id) && helloNews.length <= 5 && helloNews.at(-1)?.id === picked.id
      && news.status().enabled === false && news.status().refreshes === 0,
    `${injectedNews} tin nạp · chọn: "${picked?.title.slice(0, 48) ?? '—'}" (${picked?.source ?? ''})`);
  // Cảnh news_chat kèm thẻ tin + markUsed được kiểm ở scripts/smoke-story.ts (ở đây NEWS_ENABLED=false nên Director không lên lịch thời sự).
}

// ================================================================== tổng kết
const totalSec = (performance.now() - t0) / 1000;
const hello = world.hello() as Extract<ServerMsg, { t: 'hello' }>;
const finalAgents = world.agents();
const dstats = director.stats();
const usage = brain.usage();
const hr = hrState();

const byType = new Map<SceneType, { n: number; ok: number; aborted: number; lines: number; products: number }>();
for (const s of scenes.values()) {
  const r = byType.get(s.type) ?? { n: 0, ok: 0, aborted: 0, lines: 0, products: 0 };
  r.n++; r.lines += s.lines; r.products += s.products;
  if (s.ended === 'ok') r.ok++; else if (s.ended === 'aborted') r.aborted++;
  byType.set(s.type, r);
}

const line = (s = ''): void => origLog(s);
line('');
line('══════════════════════════════════════════════════════════════════');
line(`  KẾT QUẢ SMOKE TEST (seed ${SEED})`);
line('══════════════════════════════════════════════════════════════════');
line(`Chạy ${daysRun} ngày game (+ phần dev) trong ${totalSec.toFixed(1)}s thật · ${steps} bước (${mainSteps} bước chính, ${mainSec.toFixed(1)}s)`);
line(`Thông điệp: ${Object.entries(msgCount).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
line('');
line('Từng ngày:');
for (const [d, s] of [...dayStats.entries()].sort((a, b) => a[0] - b[0])) {
  const sc = [...scenes.values()].filter((x) => x.day === d);
  line(`  Ngày ${String(d).padStart(2)}: đến ${s.arrivals} (trễ ${s.late}) · rời ${s.departures} · xoá ${s.removed} · đông nhất ${s.maxPresent}`
    + ` · còn lại lúc hết ngày ${s.endPresent} · ${sc.length} cảnh / ${sc.reduce((n, x) => n + x.lines, 0)} câu`);
}
line('');
line('Cảnh theo loại (bắt đầu · xong · gián đoạn · câu · có sản phẩm):');
for (const [t, r] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n)) {
  line(`  ${t.padEnd(15)} ${String(r.n).padStart(4)} · ${String(r.ok).padStart(4)} · ${String(r.aborted).padStart(3)} · ${String(r.lines).padStart(5)} · ${r.products}`);
}
line(`  Director: ${Object.entries(dstats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
line('');
line('Câu thoại mẫu:');
for (const [t, list] of samples) {
  line(`  [${t}]`);
  for (const s of list.slice(0, 3)) line(`     ${s}`);
}
line('');
line(`Sản phẩm affiliate: ${productLines} câu có chip`);
for (const s of productSamples) line(`  ${s}`);
line('');
const showroomChat = byType.get('showroom_chat');
line(`v2 — Phòng trưng bày: ${showroomVisits} lượt ghé (${showroomBy.size} người) · kệ làm đẹp ${shelfVisits.beauty} / công nghệ ${shelfVisits.tech}`
  + ` · nữ→làm đẹp ${shelfVisits.womenBeauty}/${shelfVisits.womenTotal} · dev/design/QA→công nghệ ${shelfVisits.techRoleTech}/${shelfVisits.techRoleTotal}`);
line(`v2 — WC: ${hiddenToggles} lượt "vào trong" (ẩn) · lâu nhất ${maxHidden.min.toFixed(1)} phút game (${maxHidden.who || '—'}${maxHidden.day ? `, N${maxHidden.day}` : ''})`
  + ` · hello.products ${hello.products?.length ?? 0} món`
  + (hasShowroomChat ? ` · showroom_chat: ${showroomChat?.n ?? 0} cảnh / ${showroomChat?.products ?? 0} chip` : ' · showroom_chat: chưa có trong SCENE_DEFS (bỏ qua)'));
line('');
line('KPI cuối ngày (% mục tiêu):');
const dayList = [...kpiByDay.keys()].sort((a, b) => a - b);
const ids = [...new Set(dayList.flatMap((d) => kpiByDay.get(d)!.map((r) => r.id)))];
line(`  ${'Nhân viên'.padEnd(16)}${dayList.map((d) => `N${d}`.padStart(6)).join('')}`);
for (const id of ids) {
  const cells = dayList.map((d) => {
    const r = kpiByDay.get(d)!.find((x) => x.id === id);
    if (!r) return '     ·';
    const mark = r.ratio < config.kpiLowRatio ? '!' : ' ';
    return `${String(Math.round(r.ratio * 100)).padStart(5)}${mark}`;
  });
  line(`  ${nameOf(id).slice(0, 15).padEnd(16)}${cells.join('')}`);
}
line('  (! = dưới ngưỡng KPI thấp)');
line('');
line('Phút giờ hành chính trong cảnh (văn phòng + online), TB/ngày:');
{
  const tot = new Map<string, [number, number, number]>();
  for (const [d, m] of sceneMin) {
    if (d > daysRun) continue;
    for (const [id, [o, n]] of m) {
      const r = tot.get(id) ?? [0, 0, 0];
      r[0] += o; r[1] += n; r[2]++;
      tot.set(id, r);
    }
  }
  const rows = [...tot.entries()].map(([id, [o, n]]) => [nameOf(id), o / Math.max(1, daysRun), n / Math.max(1, daysRun)] as const)
    .sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
  line(`  ${rows.map(([nm, o, n]) => `${nm} ${Math.round(o)}+${Math.round(n)}`).join(' · ')}  (trên 510 phút)`);
}
line('');
line('Nhân sự:');
for (const e of allLogs.filter((x) => x.kind === 'hr')) line(`  N${e.day} ${hhmm(e.minute)} ${e.icon ?? ''} ${e.text}`);
const hiredNow = finalAgents.filter((a) => a.hiredDay > 1 && a.status === 'active');
line(`  Đội hình cuối: ${finalAgents.filter((a) => a.status === 'active').map((a) => `${a.name}${a.hiredDay > 1 ? '*' : ''}`).join(', ')} (* = người mới)`);
line('');
line(`Bản tin: ${recapsSeen.length} số`);
for (const r of recapsSeen.slice(-2)) line(`  N${r.day} [${r.source}] ${r.headline} — MVP: ${r.mvp?.name ?? '—'}`);
line(`Tin đồn: ${lastRumors.length} tin, ${rumorsMsgs} lần cập nhật, tối đa ${maxRumorVersions} phiên bản`);
if (mutatedRumor) {
  const r = mutatedRumor as Rumor;
  line(`  Về ${r.aboutName}:`);
  for (const v of r.versions.slice(0, 4)) line(`     ${nameOf(v.tellerId)} → ${nameOf(v.listenerId)}: ${v.text}`);
}
line(`Sếp: bắt quả tang ${slackerSpots} lần, ra ngoài ${bossLeft} lần, về ${bossBack} lần · sự kiện: ${[...new Set(events)].join(', ')}`);
line(`AI: mode=${usage.mode} calls=${usage.calls} failures=${usage.failures} skipped=${usage.skipped} cost=$${usage.costTodayUsd}`);
line(`Giữ sceneId lâu nhất: ${(maxHold.ms / 1000).toFixed(1)}s (${maxHold.who} ${maxHold.sid})`);
line(`Serialize/restore: ${roundTrip}`);
if (devChecks.length) {
  line('');
  line('Nút dev:');
  for (const c of devChecks) line(`  ${c.ok ? '✅' : '⚠️ '} ${c.name.padEnd(12)} ${c.info}`);
}
if (notes.length) {
  line('');
  line(`Ghi chú (${notes.length} cảnh báo không nghiêm trọng):`);
  for (const n of [...new Set(notes)].slice(0, 8)) line(`  · ${n.slice(0, 200)}`);
}

// ---------------------------------------------------------------- khẳng định
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, info = ''): void => { checks.push([name, ok, info]); };
const daysWithKpi = dayList.length;
const fullDays = [...dayStats.entries()].filter(([d]) => d <= daysRun);
check('không có lỗi / exception', problems.length === 0, problems.length ? `${problems.length} vấn đề` : '');
check(`chạy đủ ≥ ${MIN_DAYS} ngày`, daysRun >= MIN_DAYS, `${daysRun} ngày`);
check('mỗi ngày đều có người đến và về', fullDays.length >= MIN_DAYS && fullDays.every(([, s]) => s.arrivals >= 8 && s.departures >= 8),
  fullDays.map(([d, s]) => `N${d}:${s.arrivals}/${s.departures}`).join(' '));
check('hết ngày không còn ai kẹt lại', fullDays.every(([, s]) => s.endPresent === 0));
const typesWithLines = [...byType.entries()].filter(([, r]) => r.lines > 0).map(([t]) => t);
check('nhiều câu thoại, nhiều loại cảnh', lines >= 150 * daysRun / 2 && typesWithLines.length >= 12, `${lines} câu, ${typesWithLines.length} loại`);
// v3: số người có thể dưới 10 (hr_review cho nghỉ / cắt giảm, chờ tuyển) → chỉ cần KPI chấm cho mọi người đang làm (≥ 5)
check('KPI được chấm mỗi ngày', daysWithKpi >= daysRun && dayList.every((d) => kpiByDay.get(d)!.length >= 5),
  `${daysWithKpi} ngày, ít nhất ${Math.min(...dayList.map((d) => kpiByDay.get(d)!.length))} người / ngày`);
// v3: HR nhắc nhở chỉ còn là một trong nhiều quyết định của hr_review (thử thách / khen / thưởng / tăng lương / cho nghỉ…)
// → kiểm tra "có hoạt động nhân sự" (log kind 'hr'); nhắc nhở cụ thể ghi ở phần thông tin.
const hrLogs = allLogs.filter((e) => e.kind === 'hr');
check('có hoạt động nhân sự (HR nhắc nhở / quyết định sau họp xét nhân sự)', hr.warning || hrLogs.length > 0,
  `${hrLogs.length} dòng HR${hr.warning ? ', có cảnh hr_warning' : ', không có cảnh hr_warning'}`);
// v3: tính cách ngẫu nhiên + nhân sự do AI quyết → không còn ép "ai đó bị đuổi trong 10 ngày" (docs/v3-news.md §7).
// Giữ tính nhất quán của vòng nhân sự: hễ có người bị cho nghỉ thì phải có phỏng vấn và tuyển người thay.
// "Trong 12 ngày có ≥ 1 quyết định nhân sự hợp lệ từ hr_review, không vi phạm hàng rào" được kiểm ở scripts/smoke-story.ts.
check('vòng nhân sự nhất quán: cho nghỉ việc ⇒ phỏng vấn ⇒ tuyển người mới', !hr.firing || (hr.interview && hr.hire && hiredNow.length > 0),
  hr.firing ? `đã cho nghỉ · phỏng vấn ${hr.interview ? 'có' : 'KHÔNG'} · tuyển ${hiredNow.map((a) => a.name).join(', ') || 'KHÔNG'}` : 'không ai bị cho nghỉ trong kỳ (v3: không ép)');
check('bản tin được viết', recapsSeen.length >= daysRun - 1 && recapsSeen.every((r) => r.headline && r.bullets.length >= 2 && r.kpi.length > 0),
  `${recapsSeen.length} số`);
check('tin đồn được tạo và tam sao thất bản', lastRumors.length > 0 && !!mutatedRumor, `max ${maxRumorVersions} phiên bản`);
check('thỉnh thoảng có chip sản phẩm', productLines >= 3, `${productLines}`);
check('không có toạ độ NaN / ngoài bản đồ / trong tường', !badFrame && !badState, badFrame || badState);
check('không ai giữ sceneId quá 4 phút', maxHold.ms < 4 * 60_000, `${(maxHold.ms / 1000).toFixed(0)}s`);
check('log ≤ 200, tin đồn ≤ 12, bản tin ≤ 14', hello.log.length <= 200 && hello.rumors.length <= 12 && hello.recaps.length <= 14,
  `${hello.log.length}/${hello.rumors.length}/${hello.recaps.length}`);
check('ký ức ≤ 8, lịch sử KPI ≤ 14 mỗi người', finalAgents.every((a: AgentState) => a.memories.length <= 8 && a.kpiHistory.length <= 14));
check('quan hệ chỉ trỏ tới người còn tồn tại', finalAgents.every((a) => Object.keys(a.relationships).every((k) => world.agent(k))));
check('hàng đợi / tóm tắt có giới hạn', dstats.queue <= 40 && dstats.summaries <= 12 && dstats.dayEvents <= 40);
check('AI chạy offline, không gọi mạng', usage.mode === 'offline' && usage.calls === 0);
// ---- v2: phòng trưng bày + WC kín
check('bản đồ v2: showroom + WC kín, mọi chỗ / ghế tới được từ cửa', mapIssues.length === 0, mapIssues.slice(0, 3).join('; '));
check('có người ghé phòng trưng bày, đứng đúng kệ (v2)', showroomVisits >= 3 && !badShowroom, badShowroom || `${showroomVisits} lượt, ${showroomBy.size} người`);
check('WC: ẩn khi vào, flag 8 khớp, ≤ 30 phút game, không kẹt (v2)', hiddenToggles >= 1 && !badHidden && maxHidden.min <= 30,
  badHidden || `${hiddenToggles} lượt, lâu nhất ${maxHidden.min.toFixed(1)} phút`);
const shelfProducts = hello.products ?? [];
check('hello.products: kệ làm đẹp / công nghệ, url src=showroom (v2)',
  shelfProducts.length >= 1 && shelfProducts.every((p) => /^\/go\/[A-Za-z0-9_-]+\?src=showroom$/.test(p.url)
    && (p.shelf === 'beauty' || p.shelf === 'tech') && Number.isInteger(p.slot) && p.slot >= 0 && typeof p.note === 'string' && Array.isArray(p.tags)),
  `${shelfProducts.filter((p) => p.shelf === 'beauty').length} làm đẹp + ${shelfProducts.filter((p) => p.shelf === 'tech').length} công nghệ`);
// v2 đã hoàn tất: cảnh showroom_chat là bắt buộc (không còn kiểm tra có điều kiện)
check('có cảnh showroom_chat kèm chip sản phẩm (v2)', hasShowroomChat && !!showroomChat && showroomChat.n >= 1 && showroomChat.products >= 1,
  !hasShowroomChat ? 'SCENE_DEFS.showroom_chat chưa có' : showroomChat ? `${showroomChat.n} cảnh / ${showroomChat.products} chip` : 'không có cảnh nào');
check('đếm click theo sản phẩm × nguồn cho /api/stats (v2)', clicksOk, clicksInfo);
if (RUN_DEV) check('nút dev đều có phản hồi', devChecks.every((c) => c.ok), devChecks.filter((c) => !c.ok).map((c) => c.name).join(', '));
// ---- v3 (sim): xem phần 5
for (const c of v3) checks.push(c);

line('');
line(`v3 — Lưu trữ thử ở ${HISTORY_DIR}${process.env.SMOKE_KEEP_HISTORY === '1' ? ' (giữ lại)' : ' (xoá sau khi xong — SMOKE_KEEP_HISTORY=1 để giữ)'}`);
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
line(failed ? `❌ ${failed} khẳng định thất bại (seed ${SEED})` : `✅ Tất cả ${checks.length} khẳng định đều đạt (seed ${SEED})`);
// v3: dọn thư mục archive tạm
archive.stop();
if (process.env.SMOKE_KEEP_HISTORY !== '1' && !process.env.SMOKE_HISTORY_DIR) {
  try { rmSync(HISTORY_DIR, { recursive: true, force: true }); } catch { /* bỏ qua */ }
}
process.exit(failed ? 1 : 0);
