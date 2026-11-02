// World — "thân xác" của văn phòng (0 token): đồng hồ, nhân viên, di chuyển, lịch trong ngày, KPI, sếp,
// công ty (dự án / doanh thu / sự cố), xuất dữ liệu cho client, lưu / khôi phục trạng thái. Xem SPEC §3, §4.
// Director (kịch bản) gắn vào sau qua attachDirector(); mọi lời gọi Director đều được bọc try/catch.
import type {
  Activity, AgentState, AgentStatus, Brain, ClientMsg, ClockInfo, CompanyState, DevEventName, Dir,
  DirectorApi, FrameAgent, KpiResult, LogEntry, Look, MemoryNote, NewsRef, Persona, ProductPublic, ProjectState,
  PublicAgent, Relationship, RoleKey, ServerMsg, ShowroomProduct, StatusInfo, Traits, UsageStats, WorldApi,
} from '../types.js';
import { getArchive as archiveSingleton, type Archive } from './archive.js';
import { getNews } from '../news/store.js';
import type { Config } from '../config.js';
import { DESKS, MAP_DATA, MAP_H, MAP_W, SPOTS, WALLS, findPath, isWalkable, roomAt, type Pt } from './map.js';
import { INITIAL_RELATIONSHIPS, INITIAL_ROSTER, ROLE_INFO } from '../content/roster.js';
import { BOSS_AWAY_REASONS, PROJECT_POOL } from '../content/catalog.js';
import { getProduct, toPublic } from '../content/products.js';
import {
  ACTIONS, KPI_BOARD_STOP, LABELS, LUNCH_TO, PROJECT_ROLES, ROLE_KEYS, SALES_ROLES, bossWeights, chance, clamp,
  dirOf, facingAt, flavorFor, isActivity, isCatchable, kpiFactor, kpiRate, onCompleteRate, patrolRoute,
  perMinute, personalDuration, pick, pickWeighted, rand, randInt, showroomFlavor, showroomLean, showroomShelfOf,
  staffWeights, workFlavor,
  type ActionKey, type Flavor, type StatDelta, type UtilityCtx, type Weighted,
} from './behavior.js';
import { buildShowroomProducts } from './showroom.js';
import {
  ALLOWED_SPEEDS, DAY_START, MIN_PER_DAY, compressedWeekday, fmtClock, hm, isNightMinute, isWeekendEpochDay,
  realWeekday, vnWall,
} from './clock.js';
import {
  STATE_VERSION, bool, isObj, num, quarantineFile, readJsonFile, str, strArr, writeJsonAtomic, type StateFile,
} from './persist.js';

// ---------------------------------------------------------------- hằng số
const TICK_MS = 100;
const FRAME_MS = 200;
const AGENTS_MS = 2000;
/** ô / giây thật ở tốc độ x1 (nhân min(speed, 4)) */
const WALK_TILES_PER_SEC = 3.2;
const LOG_KEEP = 200;
const MEMORY_KEEP = 8;
const KPI_HISTORY_KEEP = 14;
const DOORS: readonly Pt[] = [{ x: 0, y: 16 }, { x: 0, y: 17 }];
const ENTRANCE: Pt = SPOTS.entrance?.[0] ?? { x: 1, y: 16 };
/** chỗ ứng viên ngồi chờ ngoài cửa phòng họp */
const CANDIDATE_WAIT: readonly Pt[] = [{ x: 32, y: 11 }, { x: 35, y: 11 }, { x: 31, y: 11 }, { x: 36, y: 11 }, { x: 30, y: 11 }];
const SPOT_RADIUS = 4.5;
const SPOT_VICTIM_CD = 90;
const SPOT_GLOBAL_CD = 30;
const SCENE_WATCHDOG_MS = 5 * 60_000;
const CANDIDATE_MAX_WAIT = 120;
const REMOVE_TIMEOUT = 45;
const INCIDENT_MAX = 150;
const MONTH_DAYS = 20;
/** tốc độ kéo mood / stress về mức nền mỗi phút game (xem applyEffects) */
const HOMEOSTASIS_MOOD = 0.006;
const HOMEOSTASIS_STRESS = 0.004;
const REVENUE_TARGET = 1500;
const T_LATE = hm(8, 30);
const T_WORK_START = hm(8);
const T_WORK_END = hm(17, 30);
const T_BOSS_HOME_EARLIEST = hm(17);
const T_NIGHT_SKIP = hm(18, 30);
const T_FORCE_OUT = hm(21);
const T_FAILSAFE = hm(23);
const T_TRIP_FROM = hm(9, 30);
const T_TRIP_TO = hm(15, 30);
const FAR = 1e12;

// ---- v3: câu chuyện tự phát triển (docs/v3-news.md "Thiết kế" 1–2)
const TRAIT_KEYS: readonly (keyof Traits)[] = ['diligence', 'laziness', 'gossip', 'temper', 'humor', 'ambition'];
/** lần khởi tạo đầu: trait = roster ± TRAIT_JITTER, kẹp [TRAIT_MIN, TRAIT_MAX] */
const TRAIT_JITTER = 0.15;
const TRAIT_MIN = 0.05;
const TRAIT_MAX = 0.95;
/** driftTrait(): trôi tối đa ±DRIFT_BOUND quanh traitBase, mỗi lần tối đa ±0.2 */
const DRIFT_BOUND = 0.25;
/**
 * Đội hình ban đầu: trait CÔNG VIỆC (diligence / laziness) của mọi nhân viên được rút về MỘT dải chung rồi mới thêm nhiễu
 * ±TRAIT_JITTER, để không ai bị "đánh dấu" kém (hay giỏi) từ trước: với roster v1 (Tú 0.3 / Khoa 0.9) chỉ kéo người cực đoan
 * về sàn vẫn để Tú / Tùng / Trâm chiếm 94% số lần bị đuổi qua 36 hạt. Tính cách lời nói (gossip / temper / humor / ambition)
 * vẫn theo roster ± nhiễu. Không áp cho sếp / HR (không bị xét) và người do AI sinh (họ vào sau, chuyện kể tự nhiên).
 */
const OPENING_DILIGENCE_BAND: [number, number] = [0.45, 0.7];
const OPENING_LAZINESS_BAND: [number, number] = [0.35, 0.6];
/** hệ số "ngày hên / xui" mỗi người mỗi ngày, nhân vào KPI (behavior.kpiRate) */
const DAY_FACTOR_MIN = 0.75;
const DAY_FACTOR_MAX = 1.2;
const DAY_FACTOR_LOW = 0.82;   // dưới mức này mới ghi lý do ("hôm nay bị cảm, uể oải")
const DAY_FACTOR_HIGH = 1.13;  // trên mức này: "hôm nay sung lắm"
const DAY_NOTES_MAX = 2;       // tối đa bấy nhiêu người được "kể lý do" mỗi ngày
/** ≈ 1 sự kiện cá nhân (bệnh, kẹt xe, thất tình, khách chửi, trúng số nhỏ) mỗi 3 ngày game cho cả văn phòng */
const PERSONAL_EVENT_P = 1 / 3;
const LOW_DAY_NOTES: readonly string[] = [
  'hôm nay {name} bị cảm, làm uể oải',
  '{name} đêm qua mất ngủ, sáng nay lờ đờ hẳn',
  '{name} hôm nay đầu óc để đâu đâu, làm gì cũng chậm',
  '{name} sáng nay đau bụng, ngồi làm mà không tập trung được',
];
const HIGH_DAY_NOTES: readonly string[] = [
  '{name} hôm nay sung lắm, làm việc hăng như uống cà phê gấp đôi',
  '{name} sáng nay tỉnh như sáo, gõ việc không ngơi tay',
  '{name} hôm nay có hứng, làm gì cũng trôi',
  'hôm nay {name} vào guồng từ sớm, KPI chắc bay',
];

const DEV_EVENTS: ReadonlySet<string> = new Set<DevEventName>([
  'boss_leave', 'boss_return', 'server_down', 'wifi_down', 'payday', 'birthday', 'deal', 'drama', 'hr_review',
  'release', 'end_day', 'news', 'showrunner',
]);
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const HAIR_STYLES: readonly Look['hairStyle'][] = ['short', 'long', 'bun', 'ponytail', 'spiky', 'bald', 'curly', 'bob'];
const ACCESSORIES: readonly Look['accessory'][] = ['none', 'glasses', 'headphones', 'tie', 'cap', 'bow'];

// ---------------------------------------------------------------- kiểu nội bộ
type ExitKind = 'home' | 'lunch' | 'trip' | 'remove';
type LunchMode = 'pantry' | 'desk' | 'out';
type LunchState = 'pending' | 'going' | 'eating' | 'out' | 'done';
interface LunchPlan { start: number; end: number; mode: LunchMode; napUntil: number; state: LunchState }
/** v3: lý do rời công ty (removeAgent) — quyết định nhãn / emote lúc đi ra cửa */
export type LeaveReason = 'fired' | 'resigned' | 'laid_off';
/** v3: sự kiện cá nhân ngẫu nhiên trong ngày */
export type PersonalKind = 'sick' | 'traffic' | 'heartbreak' | 'angry_client' | 'lottery';
const PERSONAL_KINDS: readonly PersonalKind[] = ['sick', 'traffic', 'heartbreak', 'angry_client', 'lottery'];
interface PersonalEvent { kind: PersonalKind; at: number; done: boolean } // at = phút trong ngày để công bố

/** Trạng thái chạy nội bộ của từng nhân viên (không gửi client, có lưu file) */
interface Rt {
  cd: Partial<Record<ActionKey, number>>; // thời điểm game được chọn lại hoạt động
  arrived: boolean;          // đã vào văn phòng hôm nay
  left: boolean;             // đã về nhà hôm nay
  arrivedAt: number;         // time lúc vào văn phòng
  lunch: LunchPlan | null;
  pendingDur: number | null; // thời lượng sẽ bắt đầu tính khi tới nơi
  rate: StatDelta | null;    // hiệu ứng "khi xong" rải theo phút
  exit: ExitKind | null;     // đang đi ra cửa để làm gì
  outUntil: number;          // ăn trưa ngoài: lúc quay lại
  partner: string | null;    // bạn đánh bóng bàn
  panic: boolean;            // đang "giả vờ làm việc"
  waypoints: Pt[];           // điểm đi tuần còn lại
  waitUntil: number;
  removeBy: number;          // bị đuổi / ứng viên về: hạn chót để xoá
  idleSince: number;         // ứng viên: lần cuối ở trong cảnh
  hiredAt: number | null;    // phút trong ngày được tuyển (tính KPI ngày đầu)
  justHired: boolean;
  waiting: boolean;          // ứng viên đã tới chỗ chờ
  sceneSeen: string | null;  // watchdog cảnh
  sceneSince: number;        // Date.now()
  /** phút giờ hành chính "mất oan" do tua nhanh (đi bộ bị giới hạn tốc độ, cảnh chạy theo giờ thật) */
  speedLoss: number;
  // --- v3
  personal: PersonalEvent | null;   // sự kiện cá nhân hôm nay
  tempTraits: Partial<Traits>;      // độ lệch trait "trong ngày" (thất tình → diligence −0.15), hoàn lại lúc sang ngày
  dayNote: string | null;           // lý do hệ số ngày cực đoan, ghi log lúc tới công ty
  leaveReason: LeaveReason | null;  // vì sao rời công ty (nhãn lúc đi ra cửa)
}

interface Trip { start: number; dur: number; reason: string; done: boolean }
interface BossPlan {
  trips: Trip[];
  state: 'none' | 'leaving' | 'away';
  reason: string;
  dur: number;
  returnAt: number;          // time tuyệt đối
  forced: Trip | null;       // dev: buộc đi ngay
}

interface DayFlags { lunchOutLogged: boolean; lastLeaverLogged: boolean; forceOutLogged: boolean; firstArrivalLogged: boolean }

interface BeginOpts { target?: Pt | null; label?: string; emote?: string; until?: number; panic?: boolean }

// ---------------------------------------------------------------- tiện ích
const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp100 = (v: number): number => clamp(v, 0, 100);
const near = (a: { x: number; y: number }, b: Pt, eps = 0.05): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
const errText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));
const tileKey = (x: number, y: number): number => x + y * MAP_W;

/** Số phút trong [a, b] thuộc giờ hành chính 08:00–17:30, trừ nghỉ trưa 12:00–13:00 (tối đa 510) */
function workOverlap(a: number, b: number): number {
  const ov = (x1: number, x2: number) => Math.max(0, Math.min(b, x2) - Math.max(a, x1));
  return ov(T_WORK_START, T_WORK_END) - ov(hm(12), hm(13));
}
const WORK_MINUTES = T_WORK_END - T_WORK_START - 60;

function parseSpotKey(key: string): { group: string; idx: number } | null {
  const i = key.lastIndexOf(':');
  if (i <= 0) return null;
  const idx = Number(key.slice(i + 1));
  return Number.isInteger(idx) && idx >= 0 ? { group: key.slice(0, i), idx } : null;
}

function spotPos(key: string): Pt | null {
  const k = parseSpotKey(key);
  const p = k ? SPOTS[k.group]?.[k.idx] : undefined;
  return p ? { x: p.x, y: p.y } : null;
}

function roleDesk(role: RoleKey): string {
  const d = ROLE_INFO?.[role]?.deskId;
  return d && DESKS[d] ? d : 'd_junior';
}

const isRole = (v: unknown): v is RoleKey => typeof v === 'string' && (ROLE_KEYS as readonly string[]).includes(v);

/** v3: nhãn lúc rời công ty theo lý do */
function leaveFlavor(reason: LeaveReason | null | undefined): Flavor {
  return reason === 'resigned' ? LABELS.resigned : reason === 'laid_off' ? LABELS.laidOff : LABELS.fired;
}

/**
 * v3: tính cách lần khởi tạo đầu = roster ± TRAIT_JITTER (kẹp 0.05..0.95). Nhân viên (không phải sếp / HR): trait công việc
 * rút về dải chung OPENING_*_BAND trước khi thêm nhiễu → người kém đầu tiên không bị định trước (xem chú thích OPENING_*).
 */
function randomizeOpeningTraits(t: Traits, role?: RoleKey): Traits {
  const out: Traits = { ...t };
  if (role !== 'boss' && role !== 'hr') {
    out.diligence = rand(OPENING_DILIGENCE_BAND[0], OPENING_DILIGENCE_BAND[1]);
    out.laziness = rand(OPENING_LAZINESS_BAND[0], OPENING_LAZINESS_BAND[1]);
  }
  for (const k of TRAIT_KEYS) out[k] = Math.round(clamp(out[k] + rand(-TRAIT_JITTER, TRAIT_JITTER), TRAIT_MIN, TRAIT_MAX) * 100) / 100;
  return out;
}

function reviveTraitBase(raw: unknown, fallback: Traits): Traits {
  const tb = isObj(raw) ? raw : {};
  const out: Traits = { ...fallback };
  for (const k of TRAIT_KEYS) out[k] = num(tb[k], fallback[k], 0, 1);
  return out;
}

function revivePersonal(raw: unknown): PersonalEvent | null {
  if (!isObj(raw) || !PERSONAL_KINDS.includes(raw.kind as PersonalKind)) return null;
  return { kind: raw.kind as PersonalKind, at: num(raw.at, 0, 0, 1439), done: bool(raw.done, false) };
}

/** Chuẩn hoá persona (từ content hoặc AI) — không bao giờ throw */
function sanitizePersona(p: unknown, fallbackId: string): Persona {
  const raw = isObj(p) ? p : {};
  const role: RoleKey = isRole(raw.role) ? raw.role : 'junior';
  const info = ROLE_INFO?.[role];
  const name = str(raw.name, '', 40).trim() || 'Người mới';
  const tr = isObj(raw.traits) ? raw.traits : {};
  const traits: Traits = {
    diligence: num(tr.diligence, 0.5, 0, 1), laziness: num(tr.laziness, 0.4, 0, 1), gossip: num(tr.gossip, 0.5, 0, 1),
    temper: num(tr.temper, 0.4, 0, 1), humor: num(tr.humor, 0.5, 0, 1), ambition: num(tr.ambition, 0.5, 0, 1),
  };
  const lk = isObj(raw.look) ? raw.look : {};
  const color = (v: unknown, d: string) => str(v, '', 40).trim() || d;
  const look: Look = {
    skin: color(lk.skin, '#f1c27d'), hair: color(lk.hair, '#2b2b2b'),
    hairStyle: HAIR_STYLES.includes(lk.hairStyle as Look['hairStyle']) ? lk.hairStyle as Look['hairStyle'] : 'short',
    shirt: color(lk.shirt, '#60a5fa'), pants: color(lk.pants, '#374151'),
    accessory: ACCESSORIES.includes(lk.accessory as Look['accessory']) ? lk.accessory as Look['accessory'] : 'none',
  };
  const deskId = typeof raw.deskId === 'string' && DESKS[raw.deskId] ? raw.deskId : roleDesk(role);
  const gender = typeof raw.gender === 'string' && raw.gender.normalize('NFC') === 'nữ' ? 'nữ' : 'nam';
  return {
    id: str(raw.id, '', 64).trim() || fallbackId,
    name,
    fullName: str(raw.fullName, '', 80).trim() || name,
    role,
    roleLabel: str(raw.roleLabel, '', 60).trim() || info?.label || role,
    gender,
    age: Math.round(num(raw.age, 26, 18, 70)),
    bio: str(raw.bio, '', 600),
    speechStyle: str(raw.speechStyle, '', 400),
    quirks: strArr(raw.quirks, 8, 160),
    likes: strArr(raw.likes, 8, 100),
    dislikes: strArr(raw.dislikes, 8, 100),
    traits,
    look,
    deskId,
    deskItemProductId: typeof raw.deskItemProductId === 'string' && raw.deskItemProductId
      ? raw.deskItemProductId.slice(0, 80) : undefined,
    kpiTarget: Math.round(num(raw.kpiTarget, info?.kpiTarget ?? 260, 30, 5000)),
  };
}

function newAgentState(p: Persona, status: AgentStatus, at: Pt, day: number, minute: number): AgentState {
  return {
    ...p,
    status, present: false, x: at.x, y: at.y, dir: 'down', path: [],
    activity: 'offsite', activityUntil: 0, activityLabel: '', emote: '',
    spotKey: null, sceneId: null, onPhone: false,
    energy: round1(rand(75, 95)), mood: round1(rand(55, 75)), stress: round1(rand(15, 35)),
    kpiToday: 0, kpiHistory: [], lowStreak: 0, warnings: 0,
    relationships: {}, memories: [],
    arriveAt: Math.floor(minute), leaveAt: T_WORK_END, hiredDay: day, lastSceneAt: 0, caughtToday: 0,
    hidden: false,
    // v3: tính cách gốc (trait trôi quanh đây), hệ số ngày, thưởng / thăng chức
    traitBase: { ...p.traits }, dayFactor: 1, bonuses: 0, promotions: 0,
  };
}

/** Khôi phục 1 agent từ file — null nếu hỏng nặng */
function reviveAgent(raw: unknown): AgentState | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || !isRole(raw.role)) {
    return null;
  }
  const p = sanitizePersona(raw, raw.id);
  p.id = raw.id;
  const status: AgentStatus = raw.status === 'candidate' || raw.status === 'fired' ? raw.status : 'active';
  const a = newAgentState(p, status, ENTRANCE, Math.round(num(raw.hiredDay, 1, -1e6, 1e6)), 0);
  a.present = bool(raw.present, false);
  const x = num(raw.x, NaN), y = num(raw.y, NaN);
  if (fin(x) && fin(y) && x >= 0 && y >= 0 && x <= MAP_W - 1 && y <= MAP_H - 1) { a.x = x; a.y = y; } else {
    const seat = DESKS[a.deskId]?.seat ?? ENTRANCE;
    a.x = seat.x; a.y = seat.y;
  }
  a.dir = DIRS.includes(raw.dir as Dir) ? raw.dir as Dir : 'down';
  a.activity = isActivity(raw.activity) ? raw.activity : (a.present ? 'idle' : 'offsite');
  a.activityUntil = num(raw.activityUntil, 0);
  a.activityLabel = str(raw.activityLabel, '', 160);
  a.emote = str(raw.emote, '', 16);
  a.energy = num(raw.energy, 70, 0, 100);
  a.mood = num(raw.mood, 60, 0, 100);
  a.stress = num(raw.stress, 30, 0, 100);
  a.kpiToday = num(raw.kpiToday, 0, 0, 1e7);
  a.kpiHistory = Array.isArray(raw.kpiHistory)
    ? raw.kpiHistory.filter(isObj).map((h) => ({ day: Math.round(num(h.day, 0)), ratio: round2(num(h.ratio, 0, 0, 100)) }))
      .slice(-KPI_HISTORY_KEEP)
    : [];
  a.lowStreak = Math.round(num(raw.lowStreak, 0, 0, 1e4));
  a.warnings = Math.round(num(raw.warnings, 0, 0, 1e4));
  a.caughtToday = Math.round(num(raw.caughtToday, 0, 0, 1e4));
  if (isObj(raw.relationships)) {
    for (const [k, v] of Object.entries(raw.relationships)) {
      if (isObj(v)) a.relationships[k] = { score: Math.round(num(v.score, 0, -100, 100)), note: str(v.note, '', 160) };
    }
  }
  a.memories = Array.isArray(raw.memories)
    ? raw.memories.filter(isObj).filter((m) => typeof m.text === 'string' && m.text.trim())
      .map((m): MemoryNote => ({ day: Math.round(num(m.day, 1)), minute: Math.round(num(m.minute, 0, 0, 1439)), text: str(m.text, '', 160) }))
      .slice(-MEMORY_KEEP)
    : [];
  a.arriveAt = Math.round(num(raw.arriveAt, 480, 0, 1439));
  a.leaveAt = Math.round(num(raw.leaveAt, T_WORK_END, 0, 1439));
  a.lastSceneAt = num(raw.lastSceneAt, 0, 0);
  // v3 (file cũ không có → traitBase = trait hiện tại, hệ số ngày 1)
  a.traitBase = reviveTraitBase(raw.traitBase, a.traits);
  a.dayFactor = num(raw.dayFactor, 1, 0.5, 1.5);
  const probation = Math.round(num(raw.probationUntilDay, 0, 0, 1e6));
  a.probationUntilDay = probation > 0 ? probation : undefined;
  a.bonuses = Math.round(num(raw.bonuses, 0, 0, 1e4));
  a.promotions = Math.round(num(raw.promotions, 0, 0, 1e4));
  return a;
}

function reviveCompany(raw: unknown, name: string): CompanyState | null {
  if (!isObj(raw) || !isObj(raw.project) || typeof raw.project.name !== 'string') return null;
  const p = raw.project;
  return {
    name,
    project: {
      name: str(p.name, 'Dự án', 100), client: str(p.client, 'Khách hàng', 100), desc: str(p.desc, '', 400),
      progress: num(p.progress, 0, 0, 100), startedDay: Math.round(num(p.startedDay, 1)),
      deadlineDay: Math.round(num(p.deadlineDay, 5)),
    },
    projectsDone: Math.round(num(raw.projectsDone, 0, 0, 1e6)),
    revenueMonth: round1(num(raw.revenueMonth, 0, 0, 1e9)),
    revenueTarget: num(raw.revenueTarget, REVENUE_TARGET, 1, 1e9),
    incident: null, // sự cố không sống sót qua khởi động lại (Director không còn hẹn giờ gỡ)
  };
}

const isLogEntry = (e: unknown): e is LogEntry =>
  isObj(e) && fin(e.id) && fin(e.day) && fin(e.minute) && typeof e.kind === 'string' && typeof e.text === 'string';

function reviveCounts(raw: unknown, maxKeys = 500): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, maxKeys)) if (fin(v)) out[k] = v;
  return out;
}

const LUNCH_MODES: readonly LunchMode[] = ['pantry', 'desk', 'out'];
const LUNCH_STATES: readonly LunchState[] = ['pending', 'going', 'eating', 'out', 'done'];

function reviveLunch(raw: unknown): LunchPlan | null {
  if (!isObj(raw)) return null;
  return {
    start: num(raw.start, hm(12), 0, 1439),
    end: num(raw.end, hm(12, 50), 0, 1439),
    mode: LUNCH_MODES.includes(raw.mode as LunchMode) ? raw.mode as LunchMode : 'pantry',
    napUntil: num(raw.napUntil, 0, 0, 1439),
    state: LUNCH_STATES.includes(raw.state as LunchState) ? raw.state as LunchState : 'done',
  };
}

function reviveBossPlan(raw: unknown): BossPlan {
  const plan: BossPlan = { trips: [], state: 'none', reason: '', dur: 0, returnAt: 0, forced: null };
  if (!isObj(raw)) return plan;
  if (Array.isArray(raw.trips)) {
    plan.trips = raw.trips.filter(isObj).slice(0, 4).map((t) => ({
      start: num(t.start, T_TRIP_FROM, 0, 1439), dur: num(t.dur, 90, 10, 600),
      reason: str(t.reason, 'đi gặp đối tác', 160), done: bool(t.done, true),
    }));
  }
  plan.state = raw.state === 'away' || raw.state === 'leaving' ? raw.state : 'none';
  plan.reason = str(raw.reason, 'đi gặp đối tác', 160);
  plan.dur = num(raw.dur, 90, 0, 600);
  plan.returnAt = num(raw.returnAt, 0);
  return plan;
}

// =====================================================================
export class World implements WorldApi {
  readonly config: Config;
  private readonly brain: Brain;
  private readonly emitFn: (msg: ServerMsg) => void;
  private director: DirectorApi | null = null;

  // ---- đồng hồ
  private readonly mode: 'compressed' | 'realtime';
  private readonly gmps: number;
  private t = DAY_START;
  private curDay = 1;
  private spd = 1;
  private realStartEpochDay = 0;
  private closedToday = false;

  // ---- thế giới
  private map = new Map<string, AgentState>();
  private rts = new Map<string, Rt>();
  private reservations = new Map<string, string>(); // spotKey -> agentId
  private comp!: CompanyState;
  private recentProjects: string[] = [];
  private bossPlan: BossPlan = { trips: [], state: 'none', reason: '', dur: 0, returnAt: 0, forced: null };
  private spotted: Record<string, number> = {};
  private lastSpotAny = -FAR;
  private progressPending = 0;
  private incidentSince = 0;
  /** số phút giờ hành chính (08:00–17:30 trừ trưa) đã thực sự mô phỏng hôm nay — để chấm KPI công bằng */
  private obsWork = 0;
  private flags: DayFlags = { lunchOutLogged: false, lastLeaverLogged: false, forceOutLogged: false, firstArrivalLogged: false };
  private doorToggle = 0;

  // ---- đầu ra
  private history: LogEntry[] = [];
  private logSeq = 0;
  private clicks = 0;
  private clicksBy: Record<string, number> = {};
  /** v2: lượt bấm theo nguồn (showroom / sidebar / scene / desk) và theo sản phẩm × nguồn — docs/v2-contract.md §2 */
  private clicksBySource: Record<string, number> = {};
  private clicksByProductSource: Record<string, Record<string, number>> = {};
  private viewerCount = 0;
  private deskItemCache = new Map<string, ProductPublic | null>();
  private showroomCache: ShowroomProduct[] | null = null;

  // ---- vòng lặp
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private lastFrameAt = -FAR; // tick đầu tiên luôn gửi frame + agents + status
  private lastAgentsAt = -FAR;
  private agentsDirty = true;
  private statusDirty = true;
  private forceFrame = true;
  private dayStartNotified = false;
  private readonly errLog = new Map<string, { t: number; n: number }>();
  /** đồng hồ "giờ thật" (ms) cho watchdog cảnh — test headless có thể truyền đồng hồ ảo */
  private readonly realNow: () => number;

  constructor(opts: { config: Config; brain: Brain; emit: (msg: ServerMsg) => void; now?: () => number }) {
    this.config = opts.config;
    this.brain = opts.brain;
    this.emitFn = opts.emit;
    this.realNow = typeof opts.now === 'function' ? opts.now : Date.now;
    this.mode = opts.config.timeMode === 'realtime' ? 'realtime' : 'compressed';
    const g = Number(opts.config.gameMinutesPerSecond);
    this.gmps = Number.isFinite(g) && g > 0 ? Math.min(g, 60) : 0.5;
    this.freshInit();
  }

  // =================================================================== vòng đời
  attachDirector(d: DirectorApi): void {
    this.director = d;
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = performance.now();
    this.notifyDayStartOnce();
    this.forceFrame = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Văn phòng mới (không khôi phục từ file) => báo Director ngày đầu tiên bắt đầu */
  private notifyDayStartOnce(): void {
    if (this.dayStartNotified) return;
    this.dayStartNotified = true;
    this.callDirector('onDayStart', (d) => d.onDayStart(this.curDay));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // =================================================================== thời gian
  time(): number { return this.t; }
  day(): number { return this.curDay; }
  minuteOfDay(): number {
    return clamp(this.t - (this.curDay - 1) * MIN_PER_DAY, 0, MIN_PER_DAY - 0.001);
  }
  weekday(): string { return this.weekdayOf(this.curDay); }
  speed(): number { return this.mode === 'realtime' ? 1 : this.spd; }
  clock(): ClockInfo {
    const m = this.minuteOfDay();
    return {
      time: round2(this.t), day: this.curDay, minute: Math.floor(m), weekday: this.weekday(),
      speed: this.speed(), isNight: isNightMinute(m), timeMode: this.mode,
    };
  }

  private weekdayOf(day: number): string {
    return this.mode === 'realtime' ? realWeekday(this.realStartEpochDay + day - 1) : compressedWeekday(day);
  }

  /** time tuyệt đối của một phút trong ngày hiện tại */
  private abs(minuteOfDay: number): number {
    return (this.curDay - 1) * MIN_PER_DAY + minuteOfDay;
  }

  // =================================================================== truy vấn
  agents(): AgentState[] { return [...this.map.values()]; }
  agent(id: string): AgentState | undefined { return this.map.get(id); }
  /**
   * status 'active' && present — KỂ CẢ người đang ẩn trong WC (`a.hidden === true`, activity 'toilet', đứng ở ô cửa
   * `SPOTS.toilet`). Director phải tự bỏ qua `a.hidden` khi chọn người vào cảnh (người trong WC không ra nói chuyện được).
   */
  activeAgents(): AgentState[] { return this.agents().filter((a) => a.status === 'active' && a.present); }
  boss(): AgentState | undefined {
    for (const a of this.map.values()) if (a.role === 'boss' && a.status === 'active') return a;
    return undefined;
  }
  hr(): AgentState | undefined {
    for (const a of this.map.values()) if (a.role === 'hr' && a.status === 'active') return a;
    return undefined;
  }
  /** true khi sếp không có mặt trong văn phòng (chưa đến, đi vắng, đã về) */
  bossAway(): boolean {
    const b = this.boss();
    return !b || !b.present;
  }
  bossNote(): string {
    if (this.closedToday) return 'Cuối tuần — văn phòng đóng cửa';
    const b = this.boss();
    if (!b) return 'Công ty đang không có sếp';
    const plan = this.bossPlan;
    if (plan.state === 'away') {
      return `${this.bossReasonText(plan.reason)} · dự kiến về khoảng ${fmtClock(plan.returnAt - (this.curDay - 1) * MIN_PER_DAY)}`;
    }
    if (!b.present) return this.rts.get(b.id)?.left ? 'Sếp đã về nhà' : 'Sếp chưa đến công ty';
    if (plan.state === 'leaving') return `Sếp đang ra ngoài: ${plan.reason}`;
    const label = (b.activityLabel || '').trim();
    if (!label) return 'Sếp đang ở văn phòng';
    // nhãn cảnh dùng chung cho mọi người trong cảnh (vd "bị sếp bắt quả tang") => đừng gán ngược cho sếp
    if (b.sceneId !== null && /sếp/i.test(label)) return 'Sếp đang bận nói chuyện với nhân viên';
    return /^(đang|vừa|mới|sắp)\s/i.test(label) ? `Sếp ${label}` : `Sếp đang ${label}`;
  }
  company(): CompanyState {
    return { ...this.comp, project: { ...this.comp.project } };
  }
  viewers(): number { return this.viewerCount; }

  private bossReasonText(reason: string): string {
    const r = reason.trim();
    return /^sếp\s/i.test(r) ? r : `Sếp ${r}`;
  }

  // =================================================================== chỗ đứng
  reserveSpot(id: string, group: string): Pt | null {
    const a = this.map.get(id);
    if (!a || typeof group !== 'string') return null;
    return this.reserveIn(a, [group], 'first');
  }

  releaseSpot(id: string): void {
    const a = this.map.get(id);
    if (a?.spotKey) {
      if (this.reservations.get(a.spotKey) === id) this.reservations.delete(a.spotKey);
      a.spotKey = null;
    }
    for (const [k, v] of this.reservations) if (v === id) this.reservations.delete(k);
  }

  visitorSpot(targetId: string): Pt {
    const t = this.map.get(targetId);
    const seat = this.deskSeat(targetId);
    let base: Pt = seat;
    if (t && t.present) {
      const dest = t.path.length ? t.path[t.path.length - 1] : { x: Math.round(t.x), y: Math.round(t.y) };
      if (Math.abs(dest.x - seat.x) > 1 || Math.abs(dest.y - seat.y) > 1) base = { x: dest.x, y: dest.y };
    }
    const used = this.usedTiles();
    const offs: [number, number][] = [
      [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, -1], [-1, -1], [1, -1],
      [-2, 0], [2, 0], [0, 2], [-2, 1], [2, 1], [-1, 2], [1, 2], [0, -2],
    ];
    for (const [dx, dy] of offs) {
      const x = base.x + dx, y = base.y + dy;
      if (isWalkable(x, y) && !used.has(tileKey(x, y))) return { x, y };
    }
    for (let r = 3; r <= 7; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = base.x + dx, y = base.y + dy;
          if (isWalkable(x, y) && !used.has(tileKey(x, y))) return { x, y };
        }
      }
    }
    return this.walkableNear(base);
  }

  deskSeat(id: string): Pt {
    const a = this.map.get(id);
    const d = a ? (DESKS[a.deskId] ?? DESKS[roleDesk(a.role)]) : undefined;
    return d ? { x: d.seat.x, y: d.seat.y } : { x: ENTRANCE.x, y: ENTRANCE.y };
  }

  // =================================================================== điều khiển (Director)
  setActivity(id: string, activity: Activity, durationMin: number,
    opts?: { target?: Pt; label?: string; emote?: string }): void {
    const a = this.map.get(id);
    if (!a || !a.present || !isActivity(activity)) return;
    const rt = this.rtOf(a);
    if (rt.exit === 'remove' || a.status === 'fired') return; // đang ôm đồ ra về: không nhận lệnh
    const dur = fin(durationMin) ? clamp(durationMin, 0, MIN_PER_DAY) : 0;
    const target = opts?.target && fin(opts.target.x) && fin(opts.target.y) ? opts.target : null;
    if (activity === 'leaving') { // không dự kiến, nhưng xử lý cho an toàn
      this.startLeaving(a, 'home', opts?.label ? { label: opts.label, emote: opts.emote ?? '👋' } : undefined);
      return;
    }
    this.begin(a, rt, activity, dur, {
      target,
      label: typeof opts?.label === 'string' ? opts.label.slice(0, 120) : undefined,
      emote: typeof opts?.emote === 'string' ? opts.emote.slice(0, 16) : undefined,
    });
    this.agentsDirty = true;
  }

  isArrived(id: string): boolean {
    const a = this.map.get(id);
    return !!a && a.present && a.path.length === 0;
  }

  teleport(id: string, p: Pt): void {
    const a = this.map.get(id);
    if (!a || !p || !fin(p.x) || !fin(p.y)) return;
    const q = this.walkableNear(p);
    a.x = q.x;
    a.y = q.y;
    a.path = [];
    if (a.present) this.onReached(a, this.rtOf(a));
  }

  faceToward(id: string, p: Pt): void {
    const a = this.map.get(id);
    if (!a || !p || !fin(p.x) || !fin(p.y)) return;
    a.dir = dirOf(p.x - a.x, p.y - a.y, a.dir);
  }

  distance(aId: string, bId: string): number {
    const a = this.map.get(aId), b = this.map.get(bId);
    if (!a || !b || !a.present || !b.present) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // =================================================================== vòng đời nhân sự
  addAgent(p: Persona, status: AgentStatus, at: Pt): AgentState {
    const persona = sanitizePersona(p, `nv_${this.curDay}_${Math.random().toString(36).slice(2, 7)}`);
    let id = persona.id;
    while (this.map.has(id)) id = `${persona.id}_${Math.random().toString(36).slice(2, 6)}`;
    persona.id = id;
    const st: AgentStatus = status === 'candidate' || status === 'fired' ? status : 'active';
    const pos = this.walkableNear(at && fin(at.x) && fin(at.y) ? at : ENTRANCE);
    const a = newAgentState(persona, st, pos, this.curDay, this.minuteOfDay());
    a.present = true;
    a.dir = 'right';
    a.activity = 'idle';
    a.activityUntil = this.t;
    a.energy = round1(rand(75, 90));
    a.mood = round1(rand(60, 75));
    a.stress = round1(rand(25, 45)); // hồi hộp ngày đầu
    for (const o of this.map.values()) {
      a.relationships[o.id] = { score: 0, note: 'người mới' };
      o.relationships[id] = { score: 0, note: 'người mới' };
    }
    this.map.set(id, a);
    const rt = this.newRt();
    rt.arrived = true;
    rt.arrivedAt = this.t;
    rt.idleSince = this.t;
    this.rts.set(id, rt);
    if (st === 'candidate') {
      a.activityLabel = LABELS.waitInterview.label;
      a.emote = LABELS.waitInterview.emote;
    } else if (st === 'active') {
      this.setupHire(a, rt);
    } else {
      rt.exit = 'remove';
      rt.removeBy = this.t + REMOVE_TIMEOUT;
    }
    this.agentsDirty = true;
    return a;
  }

  fireAgent(id: string): void {
    this.removeAgent(id, 'fired');
  }

  /**
   * v3: rời công ty — bị đuổi (📦 "ôm thùng đồ ra về"), xin nghỉ (👋) hoặc bị cắt giảm (📦). Tổng quát hoá fireAgent:
   * status 'fired' (AgentStatus không có giá trị riêng), đi ra cửa rồi biến mất; sếp / HR không bao giờ bị loại.
   */
  removeAgent(id: string, reason: LeaveReason = 'fired'): void {
    const a = this.map.get(id);
    if (!a || a.status === 'fired') return;
    if (a.role === 'boss' || a.role === 'hr') {
      console.warn(`[world] Bỏ qua removeAgent(${id}, ${reason}): sếp / HR không rời công ty.`);
      return;
    }
    const why: LeaveReason = reason === 'resigned' || reason === 'laid_off' ? reason : 'fired';
    const rt = this.rtOf(a);
    const fl = leaveFlavor(why);
    a.status = 'fired';
    a.activityLabel = fl.label;
    a.emote = fl.emote;
    rt.exit = 'remove';
    rt.removeBy = this.t + REMOVE_TIMEOUT;
    rt.leaveReason = why;
    this.unlinkPartner(a, rt);
    this.releaseSpot(id);
    this.agentsDirty = true;
    if (!a.present) { this.deleteAgent(id); return; }
    if (a.sceneId === null) this.startLeaving(a, 'remove', fl);
    // đang trong cảnh: tick sau khi Director thả ra sẽ tự đi ra cửa
  }

  // =================================================================== v3: câu chuyện tự phát triển
  /**
   * Tính cách trôi theo sự kiện (bị nhắc → chăm hơn, được khen → tham vọng hơn…). Mỗi lần tối đa ±0.2, kết quả kẹp
   * trong traitBase ± 0.25 (và 0.05..0.95). STORY_TRAIT_DRIFT=false → không đổi. Trả về giá trị mới (NaN nếu không có người).
   */
  driftTrait(id: string, key: keyof Traits, delta: number): number {
    const a = this.map.get(id);
    if (!a || !TRAIT_KEYS.includes(key)) return NaN;
    if (!fin(delta) || this.config.storyTraitDrift === false) return a.traits[key];
    const base = (a.traitBase ?? a.traits)[key] + (this.rts.get(a.id)?.tempTraits[key] ?? 0);
    const lo = Math.max(TRAIT_MIN, base - DRIFT_BOUND);
    const hi = Math.min(TRAIT_MAX, base + DRIFT_BOUND);
    const v = round2(clamp(a.traits[key] + clamp(delta, -0.2, 0.2), Math.min(lo, hi), Math.max(lo, hi)));
    if (v !== a.traits[key]) {
      a.traits[key] = v;
      this.agentsDirty = true;
    }
    return v;
  }

  /** Thăng chức / đổi vị trí: chức danh mới + mục tiêu KPI mới (30..5000); promotions++ */
  setRole(id: string, roleLabel: string, kpiTarget: number): void {
    const a = this.map.get(id);
    if (!a || a.status !== 'active') return;
    const label = typeof roleLabel === 'string' ? roleLabel.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (label) a.roleLabel = label;
    if (fin(kpiTarget)) a.kpiTarget = Math.round(clamp(kpiTarget, 30, 5000));
    a.promotions = (a.promotions ?? 0) + 1;
    this.agentsDirty = true;
  }

  /** Thử thách tới hết ngày untilDay (null / 0 = bỏ). Hết hạn ra sao do Director quyết (hr_review). */
  setProbation(id: string, untilDay: number | null): void {
    const a = this.map.get(id);
    if (!a) return;
    a.probationUntilDay = fin(untilDay) && untilDay > 0 ? Math.round(untilDay) : undefined;
    this.agentsDirty = true;
  }

  /** Ghi nhận một lần được thưởng (bonuses++) — Director lo cảnh / log / mood */
  grantBonus(id: string): void {
    const a = this.map.get(id);
    if (!a) return;
    a.bonuses = (a.bonuses ?? 0) + 1;
    this.agentsDirty = true;
  }

  /** Số nhân viên chính thức (status 'active', kể cả người chưa tới / đã về) */
  headcount(): number {
    let n = 0;
    for (const a of this.map.values()) if (a.status === 'active') n++;
    return n;
  }

  hireAgent(id: string): void {
    const a = this.map.get(id);
    if (!a || a.status !== 'candidate') return;
    const rt = this.rtOf(a);
    rt.exit = null;
    rt.removeBy = FAR;
    a.kpiToday = 0;
    a.lowStreak = 0;
    this.setupHire(a, rt);
    this.agentsDirty = true;
  }

  dismissCandidate(id: string): void {
    const a = this.map.get(id);
    if (!a || a.status !== 'candidate') return;
    const rt = this.rtOf(a);
    if (rt.exit === 'remove') return;
    rt.exit = 'remove';
    rt.removeBy = this.t + REMOVE_TIMEOUT;
    this.agentsDirty = true;
    if (!a.present) { this.deleteAgent(id); return; }
    if (a.sceneId === null) this.startLeaving(a, 'remove', LABELS.dismissed);
  }

  // =================================================================== hiệu ứng
  adjust(id: string, d: { energy?: number; mood?: number; stress?: number; kpi?: number }): void {
    const a = this.map.get(id);
    if (!a || !d || typeof d !== 'object') return;
    if (fin(d.energy)) a.energy = clamp100(a.energy + d.energy);
    if (fin(d.mood)) a.mood = clamp100(a.mood + d.mood);
    if (fin(d.stress)) a.stress = clamp100(a.stress + d.stress);
    if (fin(d.kpi)) a.kpiToday = Math.max(0, a.kpiToday + d.kpi);
    this.agentsDirty = true;
  }

  changeRelationship(fromId: string, toId: string, delta: number, note: string): void {
    const a = this.map.get(fromId);
    if (!a || fromId === toId || !this.map.has(toId) || !fin(delta)) return;
    const r: Relationship = a.relationships[toId] ?? { score: 0, note: '' };
    r.score = Math.round(clamp(r.score + delta, -100, 100));
    if (typeof note === 'string' && note.trim()) r.note = note.trim().slice(0, 120);
    a.relationships[toId] = r;
  }

  addMemory(id: string, text: string): void {
    const a = this.map.get(id);
    if (!a || typeof text !== 'string') return;
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return;
    const last = a.memories[a.memories.length - 1];
    if (last && last.text === t) return;
    a.memories.push({ day: this.curDay, minute: Math.floor(this.minuteOfDay()), text: t });
    if (a.memories.length > MEMORY_KEEP) a.memories.splice(0, a.memories.length - MEMORY_KEEP);
  }

  setIncident(kind: CompanyState['incident']): void {
    const k = kind === 'server_down' || kind === 'wifi_down' ? kind : null;
    if (this.comp.incident === k) return;
    this.comp.incident = k;
    this.incidentSince = this.t;
    this.statusDirty = true;
  }

  addRevenue(millionVnd: number): void {
    if (!fin(millionVnd)) return;
    this.comp.revenueMonth = round1(Math.max(0, this.comp.revenueMonth + millionVnd));
    this.statusDirty = true;
  }

  // =================================================================== đầu ra
  emit(msg: ServerMsg): void {
    try {
      this.emitFn(msg);
    } catch (e) {
      this.reportError('emit', e);
    }
  }

  log(e: Omit<LogEntry, 'id' | 'day' | 'minute'>, bubble?: { durationMs: number; nextSpeaker?: string }): LogEntry {
    let text = (typeof e?.text === 'string' ? e.text : String(e?.text ?? '')).slice(0, 1000);
    // quy ước: emoji nằm ở `icon`, text là chữ thuần (client không phải lọc "👔 👔 …")
    const icon = typeof e?.icon === 'string' ? e.icon.trim() : '';
    if (icon && e.kind !== 'line' && text.trimStart().startsWith(icon)) {
      text = text.trimStart().slice(icon.length).replace(/^[\s️:·–-]+/u, '');
    }
    const entry: LogEntry = {
      ...e,
      text,
      id: ++this.logSeq,
      day: this.curDay,
      minute: Math.floor(this.minuteOfDay()),
    };
    this.history.push(entry);
    if (this.history.length > LOG_KEEP) this.history.splice(0, this.history.length - LOG_KEEP);
    this.archiveRecord('log', entry); // v3: lưu trữ dài hạn (no-op khi archive tắt)
    if (bubble && fin(bubble.durationMs)) {
      const b: { durationMs: number; nextSpeaker?: string } = { durationMs: Math.round(clamp(bubble.durationMs, 300, 30_000)) };
      if (typeof bubble.nextSpeaker === 'string' && bubble.nextSpeaker) b.nextSpeaker = bubble.nextSpeaker;
      this.emit({ t: 'log', entry, bubble: b });
    } else {
      this.emit({ t: 'log', entry });
    }
    return entry;
  }

  toast(icon: string, text: string): void {
    this.emit({ t: 'toast', icon: String(icon ?? '').slice(0, 16), text: String(text ?? '').slice(0, 300) });
  }

  hello(): ServerMsg {
    return {
      t: 'hello',
      map: MAP_DATA,
      companyName: this.config.companyName,
      clock: this.clock(),
      status: this.statusInfo(),
      agents: this.publicAgents(),
      log: this.history.slice(),
      recaps: this.askDirector('recaps', (d) => d.recaps(), []),
      rumors: this.askDirector('rumors', (d) => d.rumors(), []),
      scenes: this.askDirector('publicScenes', (d) => d.publicScenes(), []),
      dev: !!this.config.devPanel, // server ghi đè theo từng socket khi có DEV_TOKEN
      rules: { kpiLowRatio: this.config.kpiLowRatio, kpiWarnDays: this.config.kpiWarnDays, kpiFireDays: this.config.kpiFireDays },
      products: this.showroomProducts(),
      news: this.newsRecent(),
    };
  }

  /** v3: tin thời sự đã / đang được bàn gần đây (mới nhất cuối) cho hello.news */
  private newsRecent(): NewsRef[] {
    try {
      return getNews().recent(5);
    } catch (e) {
      this.reportError('news.recent', e);
      return [];
    }
  }

  /** v3: archive dùng chung (Director gọi `world.getArchive().record(kind, payload)`; tắt cho tới khi server / smoke bật) */
  getArchive(): Archive {
    return archiveSingleton();
  }

  /** v3: ghi vào archive JSONL (không bao giờ throw, không chặn tick) */
  private archiveRecord(kind: string, data: unknown): void {
    try {
      archiveSingleton().record(kind, data);
    } catch (e) {
      this.reportError('archive', e);
    }
  }

  handleClient(msg: ClientMsg): void {
    try {
      if (!isObj(msg) || msg.t !== 'dev') return;
      if (msg.action === 'speed') this.setSpeed(msg.value);
      else if (msg.action === 'event' && typeof msg.name === 'string' && DEV_EVENTS.has(msg.name)) this.devEvent(msg.name);
    } catch (e) {
      this.reportError('handleClient', e);
    }
  }

  setViewers(n: number): void {
    const v = fin(n) ? Math.max(0, Math.floor(n)) : 0;
    if (v !== this.viewerCount) this.statusDirty = true;
    this.viewerCount = v;
    try {
      this.brain.setAudience(v);
    } catch (e) {
      this.reportError('brain.setAudience', e);
    }
  }

  /** Thống kê lượt bấm link affiliate (tổng + theo sản phẩm + theo nguồn + sản phẩm × nguồn) — cho /api/stats */
  clickStats(): {
    clicks: number;
    clicksBy: Record<string, number>;
    clicksBySource: Record<string, number>;
    clicksByProductSource: Record<string, Record<string, number>>;
  } {
    const byProductSource: Record<string, Record<string, number>> = {};
    for (const [id, m] of Object.entries(this.clicksByProductSource)) byProductSource[id] = { ...m };
    return {
      clicks: this.clicks,
      clicksBy: { ...this.clicksBy },
      clicksBySource: { ...this.clicksBySource },
      clicksByProductSource: byProductSource,
    };
  }

  recordClick(productId: string, src: string): void {
    if (typeof productId !== 'string' || !productId) return;
    // nguồn: showroom (kệ) / sidebar (tab 🛍️) / scene (chip thoại) / desk (hồ sơ); lạ → 'khac'
    const source = typeof src === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(src) ? src : 'khac';
    this.clicks++;
    // giới hạn số khoá (500 sản phẩm, 16 nguồn) để request lạ không làm phình bộ nhớ / file trạng thái
    if (productId in this.clicksBy || Object.keys(this.clicksBy).length < 500) {
      this.clicksBy[productId] = (this.clicksBy[productId] ?? 0) + 1;
      if (source in this.clicksBySource || Object.keys(this.clicksBySource).length < 16) {
        this.clicksBySource[source] = (this.clicksBySource[source] ?? 0) + 1;
        const m = (this.clicksByProductSource[productId] ??= {});
        if (source in m || Object.keys(m).length < 16) m[source] = (m[source] ?? 0) + 1;
      }
    }
    this.statusDirty = true;
    console.log(`[click] ${productId} (nguồn: ${source}) — tổng ${this.clicks}`);
  }

  // =================================================================== lưu / khôi phục
  save(): void {
    if (!this.config.persist) return;
    try {
      const state: StateFile = {
        version: STATE_VERSION,
        savedAt: new Date().toISOString(),
        world: this.serializeWorld(),
        director: this.director ? this.jsonSafe('director.serialize', () => this.director!.serialize()) : null,
        brain: this.jsonSafe('brain.serialize', () => this.brain.serialize()),
      };
      writeJsonAtomic(this.config.stateFile, state);
    } catch (e) {
      this.reportError('save', e);
    }
  }

  load(): boolean {
    if (!this.config.persist) return false;
    const file = this.config.stateFile;
    let data: unknown;
    try {
      data = readJsonFile(file);
    } catch (e) {
      this.loadFailed(`không đọc được ${file}: ${e instanceof Error ? e.message : String(e)}`, true);
      return false;
    }
    if (data === undefined) {
      console.log(`[world] Chưa có file trạng thái (${file}) — bắt đầu văn phòng mới.`);
      return false;
    }
    if (!isObj(data) || data.version !== STATE_VERSION) {
      this.loadFailed('file trạng thái sai định dạng / sai phiên bản', true);
      return false;
    }
    // Brain trước: giữ chi phí đã tiêu trong ngày kể cả khi phần world hỏng
    if (data.brain !== undefined && data.brain !== null) {
      try {
        this.brain.restore(data.brain);
      } catch (e) {
        console.warn('[world] Không khôi phục được trạng thái AI:', e instanceof Error ? e.message : e);
      }
    }
    let ok = false;
    try {
      ok = this.restoreWorld(data.world);
    } catch (e) {
      console.warn('[world] Lỗi khi khôi phục world:', errText(e));
      ok = false;
    }
    if (!ok) {
      this.loadFailed('dữ liệu world không hợp lệ', true);
      return false;
    }
    if (this.director && data.director !== undefined && data.director !== null) {
      try {
        this.director.restore(data.director);
      } catch (e) {
        console.warn('[world] Không khôi phục được Director (dùng trạng thái mới):', e instanceof Error ? e.message : e);
      }
    }
    this.dayStartNotified = true;
    const n = [...this.map.values()].filter((a) => a.status === 'active').length;
    console.log(`[world] Đã khôi phục: ${this.weekday()}, ngày ${this.curDay} lúc ${fmtClock(this.minuteOfDay())} — ${n} nhân viên.`);
    return true;
  }

  private loadFailed(why: string, quarantine: boolean): void {
    const moved = quarantine ? quarantineFile(this.config.stateFile) : null;
    console.warn(`[world] ⚠️ Không khôi phục được trạng thái (${why}) — bắt đầu văn phòng mới.`
      + (moved ? ` File cũ được giữ lại tại: ${moved}` : ''));
    this.freshInit();
  }

  // =================================================================== tick
  private tick(): void {
    const now = performance.now();
    const dtReal = clamp(now - this.lastTickAt, 0, 1000);
    this.lastTickAt = now;
    this.runTick(dtReal, now);
  }

  private runTick(dtReal: number, now: number): void {
    try {
      this.step(dtReal);
    } catch (e) {
      this.reportError('tick', e);
    }
    if (this.director) {
      try {
        this.director.tick(dtReal);
      } catch (e) {
        this.reportError('director.tick', e);
      }
    }
    try {
      this.output(now);
    } catch (e) {
      this.reportError('output', e);
    }
  }

  /**
   * Chạy đúng 1 tick với dt cho trước (không cần chờ đồng hồ thật) — tiện cho test headless:
   * mô phỏng + director.tick + xuất frame/agents/status. Bình thường do interval 100 ms gọi.
   */
  advance(dtRealMs: number): void {
    const dt = fin(dtRealMs) ? clamp(dtRealMs, 0, 1000) : TICK_MS;
    this.notifyDayStartOnce();
    this.runTick(dt, this.lastTickAt + dt);
    this.lastTickAt += dt;
  }

  private step(dtReal: number): void {
    const before = this.t;
    if (this.mode === 'realtime') {
      const w = vnWall();
      const realDay = w.epochDay - this.realStartEpochDay + 1;
      if (realDay > this.curDay) {
        this.endDay('rollover', realDay);
        this.t = Math.max(this.t, (this.curDay - 1) * MIN_PER_DAY + w.minute);
        // server tắt qua đêm, bật lại giữa ngày: ai lẽ ra đã tới thì ngồi sẵn ở bàn (không báo đi trễ hàng loạt)
        this.placeForCurrentTime(true);
      }
      this.t = Math.max(this.t, (this.curDay - 1) * MIN_PER_DAY + w.minute);
    } else {
      this.t += this.gmps * this.spd * Math.max(0, dtReal) / 1000;
    }
    let dtGame = this.t - before;
    if (!(dtGame > 0)) dtGame = 0;
    dtGame = Math.min(dtGame, 10);

    const m = this.minuteOfDay();
    if (dtGame > 0) this.obsWork += workOverlap(m - dtGame, m);
    if (this.mode === 'compressed') {
      if (m >= T_FAILSAFE) { this.endDay('failsafe'); return; }
      if (m >= T_NIGHT_SKIP && !this.anyonePresent()) { this.endDay('night'); return; }
    }
    if (m >= T_FORCE_OUT) this.forceOut();
    this.checkIncident();

    this.processArrivals();
    this.processPersonal();
    this.processBoss();
    this.processSchedules();
    for (const a of [...this.map.values()]) {
      if (!this.map.has(a.id)) continue; // đã bị xoá trong tick này
      this.updateAgent(a, dtReal, dtGame);
    }
    this.detectSlackers();
    this.applyProjectProgress();
  }

  private updateAgent(a: AgentState, dtReal: number, dtGame: number): void {
    const rt = this.rtOf(a);
    this.sanitize(a);
    this.watchScene(a, rt);
    if (!a.present) return;
    if (a.status === 'candidate' && a.sceneId !== null) rt.idleSince = this.t;
    if (rt.exit === 'remove' && a.sceneId === null && this.t > rt.removeBy) { this.deleteAgent(a.id); return; }
    if (dtGame > 0 && a.status === 'active') this.trackSpeedLoss(a, rt, dtGame);
    if (a.path.length) {
      this.move(a, dtReal);
      if (!a.path.length) this.onReached(a, rt);
    }
    if (!a.path.length) this.applyEffects(a, rt, dtGame);
    if (a.sceneId === null && this.map.has(a.id)) this.updateActivity(a, rt);
  }

  /**
   * Tua nhanh làm méo KPI: đi bộ bị giới hạn ×4 (để client nội suy mượt) và cảnh hội thoại chạy theo giờ thật
   * (÷ min(speed, 3)) => tốn nhiều phút game hơn hẳn so với x1. Ghi lại phần "tốn thêm" trong giờ hành chính
   * để chấm KPI công bằng ở mọi tốc độ (ở x1–x3 phần này = 0, không ảnh hưởng cân chỉnh gốc).
   */
  private trackSpeedLoss(a: AgentState, rt: Rt, dtGame: number): void {
    const s = this.speed();
    if (s <= 3) return;
    const m = this.minuteOfDay();
    const inWork = workOverlap(m - dtGame, m);
    if (inWork <= 0) return;
    let f = 0;
    if (a.path.length) f = 1 - Math.min(s, 4) / s;
    else if (a.sceneId !== null && a.activity === 'scene') f = 1 - Math.min(s, 3) / s;
    if (f > 0) rt.speedLoss += inWork * f;
  }

  // =================================================================== di chuyển
  private move(a: AgentState, dtReal: number): void {
    let dist = WALK_TILES_PER_SEC * Math.min(this.speed(), 4) * dtReal / 1000;
    while (dist > 0 && a.path.length) {
      const n = a.path[0];
      const dx = n.x - a.x, dy = n.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) a.dir = dirOf(dx, dy, a.dir);
      if (d <= dist + 1e-9) {
        a.x = n.x;
        a.y = n.y;
        a.path.shift();
        dist -= d;
      } else {
        a.x += (dx / d) * dist;
        a.y += (dy / d) * dist;
        dist = 0;
      }
    }
  }

  /** Tìm đường tới target; không có đường => dịch chuyển tức thời (không bao giờ kẹt) */
  private walkTo(a: AgentState, target: Pt): void {
    const tgt = this.walkableNear(target);
    if (near(a, tgt, 1e-6)) { a.path = []; return; }
    const sx = Math.round(a.x), sy = Math.round(a.y);
    if (sx === tgt.x && sy === tgt.y) { a.path = [{ x: tgt.x, y: tgt.y }]; return; }
    const path = isWalkable(sx, sy) ? findPath({ x: sx, y: sy }, tgt) : [];
    if (!path.length) {
      a.x = tgt.x;
      a.y = tgt.y;
      a.path = [];
      return;
    }
    // đang ở giữa 2 ô: về tâm ô gần nhất trước để luôn đi trên lưới (không cắt góc tường)
    if (Math.abs(a.x - sx) > 1e-6 || Math.abs(a.y - sy) > 1e-6) path.unshift({ x: sx, y: sy });
    a.path = path;
  }

  private walkableNear(p: Pt): Pt {
    if (!p || !fin(p.x) || !fin(p.y)) return { x: ENTRANCE.x, y: ENTRANCE.y };
    const x0 = clamp(Math.round(p.x), 0, MAP_W - 1), y0 = clamp(Math.round(p.y), 0, MAP_H - 1);
    if (isWalkable(x0, y0)) return { x: x0, y: y0 };
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (isWalkable(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
        }
      }
    }
    return { x: ENTRANCE.x, y: ENTRANCE.y };
  }

  private nearestDoor(a: AgentState): Pt {
    let best = DOORS[0], bd = Infinity;
    for (const d of DOORS) {
      const dd = Math.hypot(a.x - d.x, a.y - d.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return { x: best.x, y: best.y };
  }

  private nextDoor(): Pt {
    const d = DOORS[this.doorToggle++ % DOORS.length];
    return { x: d.x, y: d.y };
  }

  private atDoor(a: AgentState): boolean {
    return DOORS.some((d) => near(a, d, 0.05));
  }

  /** Các ô đang có người đứng / sắp tới / chỗ đã giữ / ghế bàn — để chọn chỗ đứng cho khách */
  private usedTiles(): Set<number> {
    const used = new Set<number>();
    for (const d of Object.values(DESKS)) used.add(tileKey(d.seat.x, d.seat.y));
    for (const d of DOORS) used.add(tileKey(d.x, d.y));
    for (const a of this.map.values()) {
      if (!a.present) continue;
      const p = a.path.length ? a.path[a.path.length - 1] : { x: Math.round(a.x), y: Math.round(a.y) };
      used.add(tileKey(p.x, p.y));
    }
    for (const key of this.reservations.keys()) {
      const p = spotPos(key);
      if (p) used.add(tileKey(p.x, p.y));
    }
    return used;
  }

  private lineOfSight(a: Pt, b: Pt): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist * 4));
    for (let i = 1; i < steps; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
      if (WALLS[y]?.[x] === '#') return false;
    }
    return true;
  }

  // =================================================================== giữ chỗ
  private reserveIn(a: AgentState, groups: readonly string[], mode: 'first' | 'random'): Pt | null {
    for (const g of groups) {
      const pts = SPOTS[g];
      if (!pts?.length) continue;
      if (a.spotKey && this.reservations.get(a.spotKey) === a.id) {
        const k = parseSpotKey(a.spotKey);
        if (k && k.group === g && pts[k.idx]) return { x: pts[k.idx].x, y: pts[k.idx].y };
      }
      const free: number[] = [];
      for (let i = 0; i < pts.length; i++) if (this.spotFreeFor(`${g}:${i}`, a.id)) free.push(i);
      if (!free.length) continue;
      const i = mode === 'first' ? free[0] : free[Math.floor(Math.random() * free.length)];
      this.releaseSpot(a.id);
      const key = `${g}:${i}`;
      this.reservations.set(key, a.id);
      a.spotKey = key;
      return { x: pts[i].x, y: pts[i].y };
    }
    return null;
  }

  private spotFreeFor(key: string, id: string): boolean {
    const holder = this.reservations.get(key);
    if (!holder || holder === id) return true;
    const h = this.map.get(holder);
    if (!h || h.spotKey !== key) { // giữ chỗ "ma" (người đã đi / bị xoá) => dọn
      this.reservations.delete(key);
      return true;
    }
    return false;
  }

  private freeSpotCount(group: string, forId: string): number {
    const pts = SPOTS[group];
    if (!pts) return 0;
    let n = 0;
    for (let i = 0; i < pts.length; i++) if (this.spotFreeFor(`${group}:${i}`, forId)) n++;
    return n;
  }

  // =================================================================== hoạt động
  private newRt(): Rt {
    return {
      cd: {}, arrived: false, left: false, arrivedAt: this.t, lunch: null, pendingDur: null, rate: null, exit: null,
      outUntil: 0, partner: null, panic: false, waypoints: [], waitUntil: 0, removeBy: FAR, idleSince: this.t,
      hiredAt: null, justHired: false, waiting: false, sceneSeen: null, sceneSince: 0, speedLoss: 0,
      personal: null, tempTraits: {}, dayNote: null, leaveReason: null,
    };
  }

  private rtOf(a: AgentState): Rt {
    let rt = this.rts.get(a.id);
    if (!rt) {
      rt = this.newRt();
      rt.arrived = a.present;
      this.rts.set(a.id, rt);
    }
    return rt;
  }

  /** Bắt đầu một hoạt động (nội bộ). Thời lượng tính từ lúc tới nơi (trừ khi có `until`). */
  private begin(a: AgentState, rt: Rt, activity: Activity, dur: number, o: BeginOpts = {}): void {
    const target = o.target ?? null;
    this.cleanupActivity(a, rt, target);
    let fl: Flavor | null = null;
    if (o.label === undefined || o.emote === undefined) fl = flavorFor(activity, a);
    a.activity = activity;
    a.activityLabel = o.label ?? fl?.label ?? '';
    a.emote = o.emote ?? fl?.emote ?? '';
    rt.panic = !!o.panic;
    if (o.until !== undefined && fin(o.until)) {
      a.activityUntil = o.until;
      rt.pendingDur = null;
      rt.rate = onCompleteRate(activity, Math.max(1, o.until - this.t));
    } else {
      a.activityUntil = this.t + dur;
      rt.pendingDur = dur;
      rt.rate = onCompleteRate(activity, dur);
    }
    if (target) this.walkTo(a, target);
    else a.path = [];
    if (!a.path.length) this.onReached(a, rt);
  }

  /** Dọn trạng thái của hoạt động cũ trước khi đổi sang hoạt động mới */
  private cleanupActivity(a: AgentState, rt: Rt, nextTarget: Pt | null): void {
    a.hidden = false; // ra khỏi WC (nếu đang ẩn) — mọi hoạt động mới đều đi qua đây
    if (a.spotKey) {
      const sp = spotPos(a.spotKey);
      const keep = sp && (nextTarget ? sp.x === nextTarget.x && sp.y === nextTarget.y : near(a, sp, 0.5));
      if (!keep) this.releaseSpot(a.id);
    }
    this.unlinkPartner(a, rt);
    rt.panic = false;
    rt.waypoints = [];
    rt.rate = null;
    rt.pendingDur = null;
    rt.exit = rt.exit === 'remove' ? 'remove' : null;
    rt.waiting = false;
  }

  private unlinkPartner(a: AgentState, rt: Rt): void {
    if (!rt.partner) return;
    const p = this.map.get(rt.partner);
    rt.partner = null;
    if (!p) return;
    const prt = this.rtOf(p);
    if (prt.partner !== a.id) return;
    prt.partner = null;
    if (p.activity === 'pingpong' && p.sceneId === null) {
      // hết bạn chơi => dừng lại, tick sau tự chọn việc khác
      p.activityUntil = Math.min(p.activityUntil, this.t);
      prt.pendingDur = null;
      p.path = [];
    }
  }

  /** Tới nơi (hết đường đi) */
  private onReached(a: AgentState, rt: Rt): void {
    if (rt.pendingDur !== null) {
      a.activityUntil = this.t + rt.pendingDur;
      rt.pendingDur = null;
    }
    if (a.activity === 'patrol') {
      const atKpi = near(a, KPI_BOARD_STOP, 0.1);
      rt.waitUntil = this.t + (atKpi ? 2 : rand(0.4, 1.2));
      if (atKpi) {
        a.activityLabel = LABELS.kpiBoard.label;
        a.emote = LABELS.kpiBoard.emote;
        a.dir = 'up';
      }
      return;
    }
    this.faceForPlace(a);
    // v2: tới ô trước cửa WC => "vào trong": không vẽ (FrameAgent flag 8) cho tới khi đổi hoạt động
    if (a.activity === 'toilet' && a.spotKey?.startsWith('toilet:')) a.hidden = true;
  }

  private faceForPlace(a: AgentState): void {
    if (a.spotKey) {
      const k = parseSpotKey(a.spotKey);
      const p = k ? SPOTS[k.group]?.[k.idx] : undefined;
      if (k && p && near(a, p, 0.1)) { a.dir = facingAt(p, k.group); return; }
    }
    const d = DESKS[a.deskId];
    if (d && near(a, d.seat, 0.1)) a.dir = facingAt(d.seat);
  }

  /** Cập nhật hoạt động mỗi tick cho người có mặt, không trong cảnh */
  private updateActivity(a: AgentState, rt: Rt): void {
    if (a.status === 'fired' || rt.exit === 'remove') { this.updateExiting(a, rt); return; }
    if (a.status === 'candidate') { this.updateCandidate(a, rt); return; }

    switch (a.activity) {
      case 'leaving':
        if (!rt.exit) rt.exit = 'home';
        if (a.path.length) return;
        if (!this.atDoor(a)) {
          this.walkTo(a, this.nearestDoor(a));
          if (a.path.length) return;
        }
        this.reachExit(a, rt);
        return;
      case 'patrol':
        if (this.t < a.activityUntil) {
          if (a.path.length || this.t < rt.waitUntil) return;
          const nx = rt.waypoints.shift();
          if (nx) {
            const fl = flavorFor('patrol', a);
            if (a.emote === LABELS.kpiBoard.emote) { a.activityLabel = fl.label; a.emote = fl.emote; }
            this.walkTo(a, nx);
            if (!a.path.length) this.onReached(a, rt);
            return;
          }
        }
        this.next(a, rt);
        return;
      case 'server_fix':
        if (this.comp.incident !== 'server_down') a.activityUntil = Math.min(a.activityUntil, this.t);
        break;
      case 'pingpong':
        if (rt.partner) {
          const p = this.map.get(rt.partner);
          if (!p || !p.present || p.activity !== 'pingpong') {
            rt.partner = null;
            a.activityUntil = Math.min(a.activityUntil, this.t);
          }
        }
        break;
      case 'scene': // Director đã thả (sceneId = null) mà quên đổi hoạt động
      case 'offsite':
      case 'away':
        a.activityUntil = Math.min(a.activityUntil, this.t);
        rt.pendingDur = null;
        break;
      default:
        break;
    }
    if (a.path.length) return;
    if (rt.pendingDur !== null) this.onReached(a, rt);
    if (a.activity === 'idle' || this.t >= a.activityUntil) this.next(a, rt);
  }

  /** Kết thúc hoạt động hiện tại và chọn hoạt động tiếp theo */
  private next(a: AgentState, rt: Rt): void {
    if (a.activity === 'lunch' && rt.lunch && rt.lunch.state === 'eating') rt.lunch.state = 'done';
    this.choose(a, rt);
  }

  private choose(a: AgentState, rt: Rt): void {
    const m = this.minuteOfDay();
    const isBoss = a.role === 'boss';
    if (this.shouldLeave(a, rt, m)) { this.goHome(a, rt, m); return; }
    const L = rt.lunch;
    if (L && L.state !== 'done' && L.state !== 'out') {
      if (m >= L.end) L.state = 'done';
      else if (m >= L.start) { this.startLunch(a, rt); return; }
    }
    if (L && L.state === 'done' && L.napUntil > m && m >= L.start) {
      const until = this.abs(L.napUntil);
      L.napUntil = 0;
      this.begin(a, rt, 'napping', 0, { target: this.deskSeat(a.id), until, ...LABELS.lunchNap });
      return;
    }
    if (rt.justHired) {
      rt.justHired = false;
      this.begin(a, rt, 'working', randInt(20, 40), { target: this.deskSeat(a.id), ...LABELS.newDesk });
      return;
    }

    const partner: { v: AgentState | null; checked: boolean } = { v: null, checked: false };
    const ctx: UtilityCtx = {
      agent: a,
      minute: m,
      bossPresent: !this.bossAway(),
      bossPressure: this.bossPressure(a),
      wifiDown: this.comp.incident === 'wifi_down',
      deadlineDays: this.deadlineDays(),
      kpiBehind: this.kpiBehind(a, m),
      sinceArrival: this.t - rt.arrivedAt,
      breakTime: !!L && L.state === 'done' && m >= hm(11, 45) && m < LUNCH_TO,
      overtime: m >= T_WORK_END,
      available: (key) => {
        if ((rt.cd[key] ?? -FAR) > this.t) return false;
        if (key === 'pingpong') {
          if (!partner.checked) { partner.checked = true; partner.v = this.findPingpongPartner(a); }
          return !!partner.v && this.freeSpotCount('pingpong', a.id) >= 2;
        }
        const spots = ACTIONS[key].spots;
        if (spots && spots.length) return spots.some((g) => this.freeSpotCount(g, a.id) > 0);
        return true;
      },
    };
    const key = pickWeighted(isBoss ? bossWeights(ctx) : staffWeights(ctx)) ?? (isBoss ? 'boss_office' : 'work');
    this.startAction(a, rt, key, partner.v);
  }

  private startAction(a: AgentState, rt: Rt, key: ActionKey, partner: AgentState | null): void {
    const def = ACTIONS[key];
    let dur = personalDuration(key, a, rand(def.dur[0], def.dur[1]));
    if (def.cooldown > 0) rt.cd[key] = this.t + def.cooldown;
    switch (key) {
      case 'work': {
        const fl = workFlavor(a);
        const label = this.minuteOfDay() >= T_WORK_END ? `tăng ca: ${fl.label}` : fl.label;
        this.begin(a, rt, 'working', dur, { target: this.deskSeat(a.id), label, emote: fl.emote });
        return;
      }
      case 'slack':
      case 'nap':
      case 'boss_office':
        this.begin(a, rt, def.activity, dur, { target: this.deskSeat(a.id) });
        return;
      case 'patrol':
        this.startPatrol(a, rt, dur);
        return;
      case 'pingpong':
        if (partner && this.startPingpong(a, rt, partner, dur)) return;
        break;
      case 'showroom': { // v2: kệ ưu tiên theo giới tính / vai trò (không tuyệt đối), hết chỗ thì sang kệ kia
        const spot = this.reserveIn(a, showroomLean(a), 'random');
        if (!spot) break;
        const fl = showroomFlavor(a, showroomShelfOf(a.spotKey));
        this.begin(a, rt, 'showroom', dur, { target: spot, label: fl.label, emote: fl.emote });
        this.maybeInvite(a, 'showroom', dur);
        return;
      }
      default: {
        let fl: Flavor | undefined;
        if (key === 'toilet' && a.traits.laziness >= 0.6 && chance(0.6)) { // "trốn việc"
          dur *= 2;
          fl = LABELS.toiletHide;
        }
        const spot = this.reserveIn(a, def.spots ?? [], 'random');
        if (!spot) break;
        this.begin(a, rt, def.activity, dur, { target: spot, ...(fl ?? {}) });
        if (key === 'coffee' || key === 'snack' || key === 'water') this.maybeInvite(a, key, dur);
        return;
      }
    }
    // dự phòng: về bàn
    if (a.role === 'boss') this.begin(a, rt, 'boss_office', rand(20, 40), { target: this.deskSeat(a.id) });
    else this.begin(a, rt, 'working', rand(20, 40), { target: this.deskSeat(a.id), ...workFlavor(a) });
  }

  private startPatrol(a: AgentState, rt: Rt, dur: number): void {
    const route = patrolRoute();
    const first = route.shift() ?? { x: 30, y: 17 };
    this.begin(a, rt, 'patrol', dur, { target: first });
    rt.waypoints = route;
    // đi tuần: thời lượng tính cả lúc đi
    a.activityUntil = this.t + dur;
    rt.pendingDur = null;
  }

  private startPingpong(a: AgentState, rt: Rt, b: AgentState, dur: number): boolean {
    const brt = this.rtOf(b);
    const sa = this.reserveIn(a, ['pingpong'], 'first');
    if (!sa) return false;
    const sb = this.reserveIn(b, ['pingpong'], 'first');
    if (!sb) { this.releaseSpot(a.id); return false; }
    const fl = flavorFor('pingpong', a);
    const emote = fl.emote || '🏓';
    this.begin(a, rt, 'pingpong', dur, { target: sa, label: `${fl.label} với ${b.name}`, emote });
    this.begin(b, brt, 'pingpong', dur, { target: sb, label: `${fl.label} với ${a.name}`, emote });
    rt.partner = b.id;
    brt.partner = a.id;
    brt.cd.pingpong = this.t + ACTIONS.pingpong.cooldown;
    return true;
  }

  /** Người đang rảnh tay (ngồi bàn / đang lười) — có thể bị rủ đi chơi */
  private isFreeForInvite(b: AgentState, m: number): boolean {
    if (!b.present || b.status !== 'active' || b.sceneId !== null || b.path.length) return false;
    const rt = this.rtOf(b);
    if (rt.left || rt.exit || rt.panic || rt.pendingDur !== null) return false;
    if (this.shouldLeave(b, rt, m)) return false;
    if (rt.lunch && rt.lunch.state !== 'done' && m >= rt.lunch.start - 10) return false;
    return b.activity === 'working' || b.activity === 'slacking' || b.activity === 'idle' || b.activity === 'chill'
      || (b.activity === 'window' && !SALES_ROLES.has(b.role));
  }

  private findPingpongPartner(a: AgentState): AgentState | null {
    const m = this.minuteOfDay();
    const away = this.bossAway();
    const opts: Weighted<AgentState>[] = [];
    for (const b of this.map.values()) {
      if (b === a || b.role === 'boss' || b.traits.laziness < 0.4 || !this.isFreeForInvite(b, m)) continue;
      const brt = this.rtOf(b);
      if ((brt.cd.pingpong ?? -FAR) > this.t) continue;
      const rel = a.relationships[b.id]?.score ?? 0;
      if (rel < -30) continue;
      const accept = clamp(0.3 + 0.7 * b.traits.laziness + (away ? 0.2 : -0.15) - (this.kpiBehind(b, m) ? 0.2 : 0), 0.05, 0.95);
      if (!chance(accept)) continue;
      opts.push({ key: b, w: 1 + Math.max(0, rel) / 30 });
    }
    return pickWeighted(opts);
  }

  /** Rủ bạn thân đi cà phê / ăn vặt / lấy nước / ngắm đồ cùng => tạo cơ hội tám chuyện ở pantry / phòng trưng bày */
  private maybeInvite(a: AgentState, key: 'coffee' | 'snack' | 'water' | 'showroom', dur: number): void {
    if (a.role === 'boss') return;
    const p = key === 'showroom'
      ? (0.2 + 0.4 * a.traits.gossip) * (this.bossAway() ? 1 : 0.7) // đi "shopping" có bạn mới vui (=> showroom_chat)
      : (0.15 + 0.35 * a.traits.gossip) * (this.bossAway() ? 1 : 0.5) * (key === 'coffee' ? 1 : 0.6);
    if (!chance(p)) return;
    // ngắm đồ: người được rủ ưu tiên đứng cùng kệ với người rủ
    const myShelf = showroomShelfOf(a.spotKey);
    const groups: string[] = key === 'showroom'
      ? (myShelf === 'tech' ? ['showroom_tech', 'showroom_beauty'] : ['showroom_beauty', 'showroom_tech'])
      : ACTIONS[key].spots ?? [];
    const m = this.minuteOfDay();
    const away = this.bossAway();
    const opts: Weighted<AgentState>[] = [];
    for (const b of this.map.values()) {
      if (b === a || b.role === 'boss' || !this.isFreeForInvite(b, m)) continue;
      if ((this.rtOf(b).cd[key] ?? -FAR) > this.t) continue;
      const ab = a.relationships[b.id]?.score ?? 0;
      const ba = b.relationships[a.id]?.score ?? 0;
      if (ab < 20 || ba < 0) continue;
      opts.push({ key: b, w: 1 + ab / 25 });
    }
    const b = pickWeighted(opts);
    if (!b) return;
    const accept = clamp(0.35 + 0.5 * b.traits.laziness + (away ? 0.15 : 0) - (this.kpiBehind(b, m) ? 0.2 : 0), 0.1, 0.95);
    if (!chance(accept)) return;
    if (!groups.some((g) => this.freeSpotCount(g, b.id) > 0)) return;
    const brt = this.rtOf(b);
    const spot = this.reserveIn(b, groups, 'random');
    if (!spot) return;
    brt.cd[key] = this.t + ACTIONS[key].cooldown;
    const fl = flavorFor(ACTIONS[key].activity, b);
    this.begin(b, brt, ACTIONS[key].activity, dur, { target: spot, label: `${fl.label} cùng ${a.name}`, emote: fl.emote });
  }

  // =================================================================== hiệu ứng mỗi phút / KPI
  private applyEffects(a: AgentState, rt: Rt, dt: number): void {
    if (dt <= 0 || !a.present || rt.pendingDur !== null) return;
    const act = a.activity;
    const per = perMinute(act, a.role);
    let dE = per?.energy ?? 0, dM = per?.mood ?? 0, dS = per?.stress ?? 0;
    if (act === 'working' && PROJECT_ROLES.has(a.role) && this.deadlineDays() <= 1) dS += 0.05;
    // Cân bằng nội môi: SPEC chỉ có các lực "đẩy" (ăn trưa, lười, cảnh vui... đều +mood; nghỉ ngơi đều −stress),
    // không có lực kéo về → chỉ sau 1–2 ngày cả văn phòng mood 95–100, stress 5–10 và prompt GPT ai cũng
    // "rất vui, thảnh thơi". Kéo nhẹ về mức nền của từng người (nửa đời ~4 giờ game) để sự kiện còn tạo sóng.
    if (a.status === 'active') {
      dM += (this.moodBase(a) - a.mood) * HOMEOSTASIS_MOOD;
      dS += (this.stressBase(a) - a.stress) * HOMEOSTASIS_STRESS;
    }
    if (rt.rate && this.t <= a.activityUntil + 1e-9) {
      dE += rt.rate.energy ?? 0;
      dM += rt.rate.mood ?? 0;
      dS += rt.rate.stress ?? 0;
    }
    if (dE) a.energy = clamp100(a.energy + dE * dt);
    if (dM) a.mood = clamp100(a.mood + dM * dt);
    if (dS) a.stress = clamp100(a.stress + dS * dt);

    const f = kpiFactor(act, a.role);
    if (f <= 0) return;
    let mult = f;
    if (rt.panic) mult *= 0.5;   // giả vờ làm việc
    if (a.onPhone) mult *= 0.6;  // vừa làm vừa chat nhóm
    const k = kpiRate(a, this.comp.incident === 'wifi_down') * mult * dt;
    if (k > 0) {
      a.kpiToday += k;
      if (act === 'working' && PROJECT_ROLES.has(a.role)) this.progressPending += 0.016 * k;
    }
    if (SALES_ROLES.has(a.role) && (act === 'working' || act === 'window') && !rt.panic) {
      const rate = 0.004 * (0.5 + clamp(a.traits.diligence, 0, 1));
      if (Math.random() < 1 - Math.exp(-rate * dt)) this.closeDeal(a);
    }
  }

  /**
   * Tâm trạng "bình thường" của một người (≈ 67–83): người hài hước vui hơn, người nóng tính dễ cáu hơn.
   * Mức nền khá cao vì cân chỉnh KPI (hệ số mood trong công thức KPI) được làm với văn phòng vui vẻ.
   */
  private moodBase(a: AgentState): number {
    return 75 + 12 * (clamp(a.traits.humor, 0, 1) - 0.5) - 8 * (clamp(a.traits.temper, 0, 1) - 0.5);
  }

  /** Mức stress "nền" theo khối lượng việc: hạn chót dự án, KPI đang chậm, vừa bị nhắc nhở */
  private stressBase(a: AgentState): number {
    let s = 18 + 10 * clamp(a.traits.temper, 0, 1);
    if (PROJECT_ROLES.has(a.role) && this.deadlineDays() <= 1) s += 15;
    if (a.lowStreak > 0 || a.warnings > 0) s += 10;
    if (a.role !== 'boss' && this.kpiBehind(a, this.minuteOfDay())) s += 6;
    if (this.comp.incident === 'server_down' && PROJECT_ROLES.has(a.role)) s += 12;
    return s;
  }

  /** Áp lực sếp với một nhân viên: 0 vắng · 0.75 ngồi trong phòng riêng · 1 đang ở ngoài / ở gần (≤ 10 ô) */
  private bossPressure(a: AgentState): number {
    const b = this.boss();
    if (!b || !b.present || b === a) return 0;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 10) return 1;
    return roomAt(b.x, b.y)?.id === 'boss' && !b.path.length ? 0.75 : 1;
  }

  private deadlineDays(): number {
    return this.comp.project.deadlineDay - this.curDay;
  }

  /** KPI đang chậm hơn tiến độ ngày (08:00–17:30, trừ giờ trưa) */
  private kpiBehind(a: AgentState, m: number): boolean {
    const target = a.kpiTarget > 0 ? a.kpiTarget : 260;
    const worked = clamp(Math.min(m, T_WORK_END) - T_WORK_START, 0, T_WORK_END - T_WORK_START)
      - clamp(Math.min(m, LUNCH_TO) - hm(12), 0, 60);
    const expected = (target * worked) / (T_WORK_END - T_WORK_START - 60);
    return a.kpiToday < 0.85 * expected;
  }

  private applyProjectProgress(): void {
    if (!(this.progressPending > 0)) return;
    const p = this.comp.project;
    p.progress = Math.min(100, p.progress + this.progressPending);
    this.progressPending = 0;
    if (p.progress >= 100) this.release();
  }

  private release(): void {
    const old = this.comp.project;
    this.comp.projectsDone++;
    const late = this.curDay > old.deadlineDay;
    this.comp.project = this.newProject(this.curDay, false);
    const np = this.comp.project;
    this.log({ kind: 'event', icon: '🚀', text: `Release xong dự án "${old.name}" cho ${old.client}${late ? ' — trễ hạn mất rồi 😅' : '!'}` });
    this.log({ kind: 'event', icon: '📁', text: `Dự án mới: "${np.name}" — khách ${np.client}, hạn chót ngày ${np.deadlineDay}` });
    this.statusDirty = true;
    this.callDirector('onEvent', (d) => d.onEvent('release', { note: old.name }));
  }

  private closeDeal(a: AgentState): void {
    const amount = randInt(10, 80);
    this.comp.revenueMonth = round1(this.comp.revenueMonth + amount);
    a.kpiToday += 40;
    this.log({
      kind: 'event', icon: '💰',
      text: `${a.name} chốt hợp đồng ${amount} triệu (doanh thu tháng: ${Math.round(this.comp.revenueMonth)}/${this.comp.revenueTarget} triệu)`,
    });
    this.statusDirty = true;
    this.agentsDirty = true;
    this.callDirector('onEvent', (d) => d.onEvent('deal', { agentId: a.id, note: `${amount} triệu` }));
  }

  private newProject(day: number, initial: boolean): ProjectState {
    let pool: { name: string; client: string; desc: string }[] = [];
    try {
      pool = Array.isArray(PROJECT_POOL)
        ? PROJECT_POOL.filter((p) => isObj(p) && typeof p.name === 'string' && p.name.trim() !== '') : [];
    } catch { pool = []; }
    const fresh = pool.filter((p) => !this.recentProjects.includes(p.name));
    const src = pick(fresh.length ? fresh : pool)
      ?? { name: 'App đặt lịch spa', client: 'Chuỗi spa Hoa Mai', desc: 'Ứng dụng đặt lịch và tích điểm cho khách' };
    this.recentProjects.push(src.name);
    const keep = Math.max(1, Math.min(4, pool.length - 1));
    if (this.recentProjects.length > keep) this.recentProjects.splice(0, this.recentProjects.length - keep);
    return {
      name: str(src.name, 'Dự án mới', 100),
      client: str(src.client, 'Khách hàng', 100),
      desc: str(src.desc, '', 400),
      progress: initial ? round1(rand(15, 35)) : 0,
      startedDay: day,
      deadlineDay: day + randInt(4, 6),
    };
  }

  private checkIncident(): void {
    // phòng hờ Director quên gỡ sự cố
    if (this.comp.incident && this.t - this.incidentSince > INCIDENT_MAX) this.setIncident(null);
  }

  // =================================================================== lịch trong ngày
  private shouldLeave(a: AgentState, rt: Rt, m: number): boolean {
    if (rt.left || m < a.leaveAt) return false;
    if (a.role === 'boss' && this.bossPlan.state !== 'none') return false;
    return true;
  }

  private goHome(a: AgentState, rt: Rt, m: number): void {
    const lazySharp = a.traits.laziness >= 0.6 && m < T_WORK_END + 10;
    const fl = m >= hm(18, 15) ? LABELS.goHomeOT : lazySharp ? LABELS.goHomeSharp : LABELS.goHome;
    this.startLeaving(a, 'home', fl);
  }

  private startLeaving(a: AgentState, kind: ExitKind, fl?: Flavor): void {
    const rt = this.rtOf(a);
    this.cleanupActivity(a, rt, null);
    this.releaseSpot(a.id);
    rt.exit = kind;
    const f = fl ?? (kind === 'remove' ? (a.status === 'fired' ? leaveFlavor(rt.leaveReason) : LABELS.dismissed) : LABELS.goHome);
    a.activity = 'leaving';
    a.activityLabel = f.label;
    a.emote = f.emote;
    a.activityUntil = this.t + 600;
    this.walkTo(a, this.nearestDoor(a));
    this.agentsDirty = true;
  }

  private updateExiting(a: AgentState, rt: Rt): void {
    if (a.activity !== 'leaving' || rt.exit !== 'remove') {
      this.startLeaving(a, 'remove', a.status === 'fired' ? leaveFlavor(rt.leaveReason) : LABELS.dismissed);
    }
    if (a.path.length) return;
    if (!this.atDoor(a)) {
      this.walkTo(a, this.nearestDoor(a));
      if (a.path.length) return;
    }
    this.reachExit(a, rt);
  }

  /** Ra tới cửa: biến mất khỏi văn phòng */
  private reachExit(a: AgentState, rt: Rt): void {
    const kind = rt.exit ?? 'home';
    a.present = false;
    a.hidden = false;
    a.path = [];
    this.releaseSpot(a.id);
    this.unlinkPartner(a, rt);
    rt.panic = false;
    rt.waypoints = [];
    rt.pendingDur = null;
    rt.rate = null;
    rt.exit = null;
    this.agentsDirty = true;
    switch (kind) {
      case 'remove':
        this.deleteAgent(a.id);
        return;
      case 'lunch':
        a.activity = 'offsite';
        a.activityLabel = 'ra ngoài ăn trưa';
        a.emote = '🍜';
        if (rt.lunch) rt.lunch.state = 'out';
        return;
      case 'trip': {
        const plan = this.bossPlan;
        plan.state = 'away';
        plan.returnAt = this.t + plan.dur;
        a.activity = 'away';
        a.activityLabel = plan.reason;
        a.emote = this.tripEmote(plan.reason);
        this.statusDirty = true;
        this.relaxWave();
        this.callDirector('onBossLeft', (d) => d.onBossLeft(plan.reason));
        return;
      }
      default: {
        a.activity = 'offsite';
        a.activityLabel = 'đã về';
        a.emote = '';
        rt.left = true;
        if (a.role === 'boss') {
          this.statusDirty = true;
          const others = [...this.map.values()].some((o) => o.present && o.status === 'active');
          this.log({ kind: 'event', icon: '👋', text: others ? 'Sếp đã về. Cả phòng thở phào…' : 'Sếp đã về.' });
          this.relaxWave();
        }
        this.maybeLogLastLeaver(a);
      }
    }
  }

  private maybeLogLastLeaver(a: AgentState): void {
    if (this.flags.lastLeaverLogged || this.minuteOfDay() < T_BOSS_HOME_EARLIEST) return;
    for (const o of this.map.values()) if (o.present && o.status === 'active') return;
    this.flags.lastLeaverLogged = true;
    this.log({ kind: 'event', icon: '🔒', text: `${a.name} là người cuối cùng tắt đèn ra về lúc ${fmtClock(this.minuteOfDay())}` });
  }

  private processArrivals(): void {
    if (this.closedToday) return;
    const m = this.minuteOfDay();
    for (const a of this.map.values()) {
      if (a.status !== 'active' || a.present || a.sceneId !== null) continue;
      const rt = this.rtOf(a);
      if (rt.lunch?.state === 'out') {
        if (this.t >= rt.outUntil) this.comeBackFromLunch(a, rt);
        continue;
      }
      if (rt.arrived || rt.left) continue;
      if (a.role === 'boss' && this.bossPlan.state !== 'none') continue;
      if (m >= a.arriveAt && m < a.leaveAt && m < T_FORCE_OUT) this.arrive(a, rt);
    }
  }

  private arrive(a: AgentState, rt: Rt): void {
    const door = this.nextDoor();
    a.present = true;
    a.x = door.x;
    a.y = door.y;
    a.path = [];
    a.dir = 'right';
    rt.arrived = true;
    rt.arrivedAt = this.t;
    rt.exit = null;
    const isBoss = a.role === 'boss';
    const late = !isBoss && this.minuteOfDay() > T_LATE;
    if (!this.flags.firstArrivalLogged) { // người mở cửa văn phòng (đối xứng với "người cuối cùng tắt đèn")
      this.flags.firstArrivalLogged = true;
      this.log({ kind: 'event', icon: '🔑', text: `${a.name} là người đến sớm nhất, mở cửa văn phòng lúc ${fmtClock(this.minuteOfDay())}` });
    }
    const fl = isBoss ? LABELS.arriveBoss : late ? LABELS.arriveLate : LABELS.arrive;
    this.begin(a, rt, 'arriving', 0, { target: this.deskSeat(a.id), ...fl });
    this.agentsDirty = true;
    if (isBoss) {
      this.statusDirty = true;
      this.log({ kind: 'event', icon: '👔', text: 'Sếp đã đến công ty' });
      this.panicSwitch(0.5); // có người kịp hô "sếp tới!"
    }
    this.announceArrival(a, rt); // v3: lý do hôm nay uể oải / sung sức / bị cảm / thất tình (trước dòng "đi trễ" của Director)
    this.callDirector('onAgentArrived', (d) => d.onAgentArrived(a.id, late));
  }

  // =================================================================== v3: hệ số ngày + sự kiện cá nhân
  /** Lúc tới công ty: công bố sự kiện cá nhân (bệnh / thất tình) hoặc lý do hệ số ngày cực đoan — log + ký ức */
  private announceArrival(a: AgentState, rt: Rt): void {
    const p = rt.personal;
    if (p && !p.done && (p.kind === 'sick' || p.kind === 'heartbreak')) {
      p.done = true;
      if (p.kind === 'sick') {
        a.energy = round1(clamp100(a.energy - 15));
        a.stress = round1(clamp100(a.stress + 5));
        this.log({ kind: 'event', icon: '🤒', text: `${a.name} bị cảm từ đêm qua, đến trễ, nhìn là biết hôm nay làm uể oải` });
        this.addMemory(a.id, 'hôm nay bị cảm, người uể oải, làm việc không nổi');
      } else {
        this.log({ kind: 'event', icon: '💔', text: `${a.name} đến công ty với bộ mặt thất tình, chẳng muốn làm gì` });
        this.addMemory(a.id, 'mới chia tay người yêu, không có tâm trạng làm việc');
      }
      this.agentsDirty = true;
      return;
    }
    if (rt.dayNote) {
      const low = (a.dayFactor ?? 1) < 1;
      this.log({ kind: 'event', icon: low ? '😪' : '✨', text: rt.dayNote });
      this.addMemory(a.id, low ? 'hôm nay người uể oải, làm gì cũng chậm' : 'hôm nay sung sức, làm việc hăng');
      rt.dayNote = null;
    }
  }

  /** Sự kiện cá nhân công bố giữa ngày: kẹt xe (nhắn nhóm trước khi tới), khách chửi, trúng số nhỏ */
  private processPersonal(): void {
    const m = this.minuteOfDay();
    for (const a of this.map.values()) {
      if (a.status !== 'active') continue;
      const rt = this.rts.get(a.id);
      const p = rt?.personal;
      if (!rt || !p || p.done || m < p.at) continue;
      switch (p.kind) {
        case 'traffic':
          p.done = true;
          if (a.present || rt.arrived) break;
          this.log({ kind: 'event', icon: '📱', text: `${a.name} nhắn vào nhóm: kẹt xe quá, tới trễ chút nha` });
          this.addMemory(a.id, 'sáng nay kẹt xe, đi làm trễ');
          break;
        case 'angry_client':
          if (!a.present || a.sceneId !== null || !SALES_ROLES.has(a.role)) { if (!SALES_ROLES.has(a.role)) p.done = true; break; }
          p.done = true;
          a.stress = round1(clamp100(a.stress + 15));
          a.mood = round1(clamp100(a.mood - 8));
          this.log({ kind: 'event', icon: '😤', text: `${a.name} vừa bị khách chửi một trận qua điện thoại, mặt tái mét` });
          this.addMemory(a.id, 'vừa bị khách chửi té tát qua điện thoại');
          this.agentsDirty = true;
          break;
        case 'lottery':
          if (!a.present || a.sceneId !== null) break;
          p.done = true;
          a.mood = round1(clamp100(a.mood + 20));
          this.log({ kind: 'event', icon: '🎉', text: `${a.name} trúng số nhỏ, hứa bao cả phòng trà sữa` });
          this.addMemory(a.id, 'vừa trúng số nhỏ, vui cả ngày, hứa bao trà sữa cả phòng');
          this.agentsDirty = true;
          break;
        default:
          break; // sick / heartbreak: công bố lúc tới công ty (announceArrival)
      }
    }
  }

  /** Sang ngày: rút thăm 1 sự kiện cá nhân cho cả văn phòng (xác suất PERSONAL_EVENT_P), áp hiệu ứng vào lịch / chỉ số */
  private rollPersonalEvent(): void {
    if (!chance(PERSONAL_EVENT_P)) return;
    const staff = [...this.map.values()].filter((a) => a.status === 'active' && a.role !== 'boss');
    if (!staff.length) return;
    const sales = staff.filter((a) => SALES_ROLES.has(a.role));
    const kinds: Weighted<PersonalKind>[] = [
      { key: 'sick', w: 1 }, { key: 'traffic', w: 1.2 }, { key: 'heartbreak', w: 0.6 }, { key: 'lottery', w: 0.5 },
    ];
    if (sales.length) kinds.push({ key: 'angry_client', w: 1 });
    const kind = pickWeighted(kinds);
    const a = pick(kind === 'angry_client' ? sales : staff);
    if (!kind || !a) return;
    const rt = this.rtOf(a);
    switch (kind) {
      case 'sick':
        a.arriveAt = Math.round(clamp(a.arriveAt + randInt(30, 60), hm(7, 30), hm(10, 30)));
        a.dayFactor = round2(Math.min(a.dayFactor ?? 1, rand(0.6, 0.8)));
        rt.personal = { kind, at: a.arriveAt, done: false };
        break;
      case 'traffic':
        a.arriveAt = Math.round(clamp(a.arriveAt + randInt(20, 45), hm(7, 30), hm(10, 30)));
        rt.personal = { kind, at: Math.max(hm(7, 45), a.arriveAt - randInt(15, 30)), done: false }; // nhắn nhóm trước khi tới
        break;
      case 'heartbreak':
        a.mood = round1(clamp100(a.mood - 20));
        this.applyTempTrait(a, rt, 'diligence', -0.15);
        a.dayFactor = round2((a.dayFactor ?? 1) * 0.9);
        rt.personal = { kind, at: a.arriveAt, done: false };
        break;
      default: // angry_client / lottery: giữa giờ làm
        rt.personal = { kind, at: randInt(hm(9, 30), hm(16)), done: false };
        break;
    }
    a.leaveAt = Math.round(clamp(Math.max(a.leaveAt, a.arriveAt + 60), 0, hm(20, 30)));
    rt.dayNote = null;
  }

  /** Hệ số ngày cực đoan → chọn tối đa DAY_NOTES_MAX người để "kể lý do" lúc tới công ty */
  private noteDayFactors(): void {
    let noted = 0;
    for (const a of this.map.values()) {
      if (a.status !== 'active' || a.role === 'boss') continue;
      const rt = this.rtOf(a);
      if (rt.personal) continue;
      const f = a.dayFactor ?? 1;
      const pool = f < DAY_FACTOR_LOW ? LOW_DAY_NOTES : f > DAY_FACTOR_HIGH ? HIGH_DAY_NOTES : null;
      if (!pool) continue;
      rt.dayNote = (pick(pool) ?? pool[0]).replace('{name}', a.name);
      if (++noted >= DAY_NOTES_MAX) break;
    }
  }

  /** Độ lệch trait trong ngày (hoàn lại ở planDay hôm sau) */
  private applyTempTrait(a: AgentState, rt: Rt, key: keyof Traits, delta: number): void {
    const before = a.traits[key];
    const after = round2(clamp(before + delta, TRAIT_MIN, TRAIT_MAX));
    rt.tempTraits[key] = round2((rt.tempTraits[key] ?? 0) + (after - before));
    a.traits[key] = after;
  }

  private revertTempTraits(a: AgentState, rt: Rt): void {
    for (const k of TRAIT_KEYS) {
      const off = rt.tempTraits[k];
      if (fin(off) && off !== 0) a.traits[k] = round2(clamp(a.traits[k] - off, TRAIT_MIN, TRAIT_MAX));
    }
    rt.tempTraits = {};
  }

  private comeBackFromLunch(a: AgentState, rt: Rt): void {
    const door = this.nextDoor();
    a.present = true;
    a.x = door.x;
    a.y = door.y;
    a.path = [];
    a.dir = 'right';
    if (rt.lunch) rt.lunch.state = 'done';
    this.begin(a, rt, 'arriving', 0, { target: this.deskSeat(a.id), ...LABELS.backFromLunch });
    this.agentsDirty = true;
  }

  /** Các mốc lịch ngắt hoạt động hiện tại: giờ về, giờ ăn trưa */
  private processSchedules(): void {
    const m = this.minuteOfDay();
    for (const a of this.map.values()) {
      if (!a.present || a.status !== 'active' || a.sceneId !== null || a.activity === 'leaving') continue;
      const rt = this.rtOf(a);
      if (rt.exit) continue;
      if (a.role === 'boss' && this.bossPlan.state !== 'none') continue;
      if (this.shouldLeave(a, rt, m)) {
        if (a.activity !== 'arriving') this.goHome(a, rt, m);
        continue;
      }
      const L = rt.lunch;
      if (L && L.state === 'pending' && m >= L.start) {
        if (m >= L.end) { L.state = 'done'; continue; }
        if (a.activity === 'arriving' || a.activity === 'server_fix' || a.activity === 'lunch') continue;
        this.startLunch(a, rt);
      }
    }
  }

  private startLunch(a: AgentState, rt: Rt): void {
    const L = rt.lunch;
    if (!L) return;
    if (L.mode === 'out') {
      L.state = 'going';
      rt.outUntil = this.abs(L.end) + rand(0, 10);
      this.startLeaving(a, 'lunch', LABELS.lunchOut);
      this.logLunchOut();
      return;
    }
    L.state = 'eating';
    const until = this.abs(L.end);
    let target: Pt | null = null;
    let fl: Flavor = a.role === 'boss' ? LABELS.bossLunch : LABELS.deskLunch;
    if (L.mode === 'pantry') {
      target = this.reserveIn(a, ['pantry_table', 'lounge'], 'first');
      if (target) fl = flavorFor('lunch', a);
    }
    this.begin(a, rt, 'lunch', 0, { target: target ?? this.deskSeat(a.id), until, label: fl.label, emote: fl.emote });
  }

  private logLunchOut(): void {
    if (this.flags.lunchOutLogged) return;
    this.flags.lunchOutLogged = true;
    const names = [...this.map.values()]
      .filter((o) => o.status === 'active' && this.rts.get(o.id)?.lunch?.mode === 'out')
      .map((o) => o.name);
    if (names.length >= 2) {
      this.log({ kind: 'event', icon: '🍜', text: `${names.join(', ')} rủ nhau ra ngoài ăn trưa` });
    }
  }

  // =================================================================== sếp
  private processBoss(): void {
    const b = this.boss();
    if (!b) return;
    const rt = this.rtOf(b);
    const plan = this.bossPlan;
    const m = this.minuteOfDay();
    if (plan.state === 'away') {
      if (this.t >= plan.returnAt && b.sceneId === null) {
        if (m >= b.leaveAt - 15 || m >= T_NIGHT_SKIP) {
          plan.state = 'none';
          rt.left = true;
          b.activity = 'offsite';
          b.activityLabel = 'đã về';
          b.emote = '';
          this.statusDirty = true;
          this.agentsDirty = true;
          this.log({ kind: 'event', icon: '🏠', text: 'Sếp đi thẳng về nhà luôn, không quay lại văn phòng' });
        } else {
          this.bossReturn();
        }
      }
      return;
    }
    if (!b.present || b.sceneId !== null) return;
    if (plan.state === 'leaving') {
      if (b.activity !== 'leaving' || rt.exit !== 'trip') { // bị cảnh cắt ngang => đi tiếp hoặc huỷ
        if (m < hm(16) && !rt.left) this.startLeaving(b, 'trip', { label: `ra ngoài: ${plan.reason}`, emote: '🚗' });
        else plan.state = 'none';
      }
      return;
    }
    if (rt.left || rt.exit) return;
    const forced = plan.forced;
    if (!forced && (b.activity === 'arriving' || b.activity === 'leaving')) return;
    const trip = forced ?? plan.trips.find((t) => !t.done && m >= t.start);
    if (!trip) return;
    trip.done = true;
    plan.forced = null;
    if (!forced && (m > trip.start + 90 || m >= b.leaveAt - 45)) return; // lỡ giờ => bỏ chuyến
    plan.state = 'leaving';
    plan.reason = trip.reason;
    plan.dur = trip.dur;
    this.startLeaving(b, 'trip', { label: `ra ngoài: ${trip.reason}`, emote: '🚗' });
    this.statusDirty = true;
  }

  private bossReturn(): void {
    const b = this.boss();
    if (!b) return;
    const rt = this.rtOf(b);
    this.bossPlan.state = 'none';
    this.bossPlan.forced = null;
    const door = this.nextDoor();
    b.present = true;
    b.x = door.x;
    b.y = door.y;
    b.path = [];
    b.dir = 'right';
    rt.arrived = true;
    rt.left = false;
    rt.exit = null;
    this.begin(b, rt, 'arriving', 0, { target: this.deskSeat(b.id), ...LABELS.bossBack });
    const n = this.panicSwitch(1);
    if (!this.director) { // có Director thì Director tự ghi log "Sếp đã về!" (tránh trùng)
      this.log({
        kind: 'event', icon: '🚗',
        text: n > 0 ? `Sếp đã về tới văn phòng! ${n} người vội vàng giả vờ làm việc 😰` : 'Sếp đã về tới văn phòng!',
      });
    }
    this.statusDirty = true;
    this.agentsDirty = true;
    this.callDirector('onBossReturned', (d) => d.onBossReturned());
  }

  /** "Sếp về!": ai đang lười (không trong cảnh) lập tức quay về bàn giả vờ làm việc */
  private panicSwitch(prob: number): number {
    const m = this.minuteOfDay();
    let n = 0;
    for (const a of this.map.values()) {
      if (!a.present || a.status !== 'active' || a.role === 'boss' || a.sceneId !== null) continue;
      if (!isCatchable(a.activity, m) || !chance(prob)) continue;
      const rt = this.rtOf(a);
      if (rt.exit) continue;
      this.begin(a, rt, 'working', rand(10, 20), { target: this.deskSeat(a.id), ...LABELS.panic, panic: true });
      n++;
    }
    if (n) this.agentsDirty = true;
    return n;
  }

  /** "Sếp đi rồi!": người lười đang làm việc (không trong cảnh) bỏ dở, tick sau chọn lại (thường là lướt điện thoại) */
  private relaxWave(): void {
    for (const a of this.map.values()) {
      if (!a.present || a.status !== 'active' || a.role === 'boss' || a.sceneId !== null || a.path.length) continue;
      if (a.activity !== 'working') continue;
      const rt = this.rtOf(a);
      if (rt.exit || rt.pendingDur !== null || !chance(clamp((a.traits.laziness - 0.3) * 1.6, 0, 0.9))) continue;
      rt.panic = false;
      a.activityUntil = Math.min(a.activityUntil, this.t + rand(0, 3));
    }
  }

  private detectSlackers(): void {
    const b = this.boss();
    if (!b || !b.present || b.sceneId !== null) return;
    if (!(b.path.length > 0 || b.activity === 'patrol')) return;
    if (this.t - this.lastSpotAny < SPOT_GLOBAL_CD) return;
    const m = this.minuteOfDay();
    let best: AgentState | null = null;
    let bestD = Infinity;
    for (const v of this.map.values()) {
      if (v === b || !v.present || v.status !== 'active' || v.sceneId !== null || v.path.length) continue;
      if (!isCatchable(v.activity, m)) continue;
      if (this.t - (this.spotted[v.id] ?? -FAR) < SPOT_VICTIM_CD) continue;
      const d = Math.hypot(v.x - b.x, v.y - b.y);
      if (d > SPOT_RADIUS || d >= bestD) continue;
      if (!this.lineOfSight(b, v)) continue;
      best = v;
      bestD = d;
    }
    if (!best) return;
    const victim = best;
    this.spotted[victim.id] = this.t;
    this.lastSpotAny = this.t;
    this.callDirector('onSlackerSpotted', (d) => d.onSlackerSpotted(b.id, victim.id));
  }

  private pickReasons(n: number): string[] {
    let pool: string[] = [];
    try {
      pool = Array.isArray(BOSS_AWAY_REASONS) ? BOSS_AWAY_REASONS.filter((s) => typeof s === 'string' && s.trim()) : [];
    } catch { pool = []; }
    if (!pool.length) pool = ['đi gặp đối tác', 'đi đánh golf với đối tác', 'họp với nhà đầu tư', 'đi ngân hàng'];
    const out: string[] = [];
    const bag = [...pool];
    for (let i = 0; i < n; i++) {
      if (!bag.length) bag.push(...pool);
      out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0].trim());
    }
    return out;
  }

  private tripEmote(reason: string): string {
    const r = reason.toLowerCase();
    if (r.includes('golf')) return '🏌️';
    if (r.includes('ăn') || r.includes('nhậu') || r.includes('cà phê')) return '🍽️';
    if (r.includes('họp') || r.includes('gặp') || r.includes('ký')) return '💼';
    if (r.includes('bay') || r.includes('sân bay')) return '✈️';
    return '🚗';
  }

  private planBossTrips(): Trip[] {
    const r = Math.random();
    const n = r < 0.4 ? 0 : r < 0.85 ? 1 : 2; // ≥ 1 chuyến với xác suất 60%
    const reasons = this.pickReasons(n);
    const trips: Trip[] = [];
    let earliest = T_TRIP_FROM;
    for (let i = 0; i < n; i++) {
      if (earliest > T_TRIP_TO) break;
      const latest = n === 2 && i === 0 ? Math.min(T_TRIP_TO, hm(12)) : T_TRIP_TO;
      const start = Math.round(rand(earliest, Math.max(earliest, latest)));
      const dur = randInt(60, 150);
      trips.push({ start, dur, reason: reasons[i], done: false });
      earliest = start + dur + randInt(30, 75);
    }
    return trips;
  }

  // =================================================================== ứng viên / người ra về
  private updateCandidate(a: AgentState, rt: Rt): void {
    if (a.activity === 'scene' || a.activity === 'meeting') { // vừa được thả khỏi cảnh
      a.activity = 'idle';
      rt.waiting = false;
    }
    if (this.t - rt.idleSince > CANDIDATE_MAX_WAIT) { this.dismissCandidate(a.id); return; }
    if (a.path.length || rt.waiting) return;
    rt.waiting = true;
    a.activity = 'idle';
    a.activityLabel = LABELS.waitInterview.label;
    a.emote = LABELS.waitInterview.emote;
    a.activityUntil = this.t + CANDIDATE_MAX_WAIT;
    const used = this.usedTiles();
    const spot = CANDIDATE_WAIT.find((p) => !used.has(tileKey(p.x, p.y)) && isWalkable(p.x, p.y)) ?? CANDIDATE_WAIT[0];
    this.walkTo(a, spot);
    if (!a.path.length) a.dir = 'up';
  }

  /** Xoá hẳn khỏi văn phòng (đã ra tới cửa / không có mặt). Phiên bản công khai có nhãn theo lý do: removeAgent(id, reason). */
  private deleteAgent(id: string): void {
    const a = this.map.get(id);
    if (!a) return;
    const rt = this.rts.get(id);
    if (rt) this.unlinkPartner(a, rt);
    this.releaseSpot(id);
    this.map.delete(id);
    this.rts.delete(id);
    for (const o of this.map.values()) delete o.relationships[id];
    delete this.spotted[id];
    this.agentsDirty = true;
  }

  // =================================================================== ngày
  private anyonePresent(): boolean {
    for (const a of this.map.values()) if (a.present) return true;
    return false;
  }

  /** 21:00: bảo vệ nhắc về — ai không trong cảnh thì đi ra cửa */
  private forceOut(): void {
    let any = false;
    for (const a of this.map.values()) {
      if (!a.present || a.sceneId !== null || a.activity === 'leaving') continue;
      const rt = this.rtOf(a);
      any = true;
      if (a.status !== 'active' || rt.exit === 'remove') this.startLeaving(a, 'remove');
      else this.startLeaving(a, 'home', LABELS.goHomeForced);
    }
    if (this.bossPlan.state === 'away') {
      const b = this.boss();
      this.bossPlan.state = 'none';
      if (b) { this.rtOf(b).left = true; b.activity = 'offsite'; b.activityLabel = 'đã về'; b.emote = ''; }
      this.statusDirty = true;
    }
    if (any && !this.flags.forceOutLogged) {
      this.flags.forceOutLogged = true;
      this.log({ kind: 'event', icon: '🔦', text: '21:00 rồi, bảo vệ đi một vòng nhắc mọi người về nhà' });
    }
  }

  private endDay(reason: 'night' | 'failsafe' | 'dev' | 'rollover', newDay?: number): void {
    const day = this.curDay;
    // 1. mọi người rời văn phòng; ứng viên / người bị đuổi biến mất hẳn
    for (const a of [...this.map.values()]) {
      const rt = this.rtOf(a);
      if (a.status !== 'active' || rt.exit === 'remove') { this.deleteAgent(a.id); continue; }
      this.unlinkPartner(a, rt);
      this.releaseSpot(a.id);
      a.present = false;
      a.hidden = false;
      a.path = [];
      a.activity = 'offsite';
      a.activityLabel = '';
      a.emote = '';
    }
    this.bossPlan.state = 'none';
    if (reason === 'failsafe') console.warn(`[world] Ngày ${day}: quá 23:00 vẫn còn người — buộc kết thúc ngày.`);

    // 2. KPI cuối ngày
    if (!this.closedToday) {
      const results = this.computeResults(day);
      this.logDaySummary(day, results);
      this.archiveRecord('kpi', { day, weekday: this.weekdayOf(day), results }); // v3
      this.callDirector('onDayEnd', (d) => d.onDayEnd(day, results));
    }

    // 3. sang ngày mới
    if (this.mode === 'compressed') {
      this.curDay = day + 1;
      this.t = (this.curDay - 1) * MIN_PER_DAY + DAY_START;
    } else {
      this.curDay = Math.max(day + 1, newDay ?? day + 1);
      this.t = Math.max(this.t, (this.curDay - 1) * MIN_PER_DAY);
    }
    this.planDay(this.curDay);
    this.callDirector('onDayStart', (d) => d.onDayStart(this.curDay));
    this.agentsDirty = true;
    this.statusDirty = true;
    this.forceFrame = true;
  }

  /**
   * Chấm KPI cuối ngày. Ngày chỉ được mô phỏng một phần (bấm "kết thúc ngày" sớm, server khởi động giữa ngày,
   * server tắt qua đêm ở chế độ giờ thật...) => mục tiêu co theo phần đã mô phỏng; dưới 30% thì không tính
   * chuỗi KPI thấp / lịch sử (không phạt oan ai).
   */
  private computeResults(day: number): KpiResult[] {
    const out: KpiResult[] = [];
    const coverage = clamp(this.obsWork / WORK_MINUTES, 0, 1);
    const complete = coverage >= 0.3;
    for (const a of this.map.values()) {
      if (a.status !== 'active') continue;
      const rt = this.rtOf(a);
      const lossShare = clamp(rt.speedLoss / WORK_MINUTES, 0, 0.8); // phần ngày bị "ăn" do tua nhanh
      let target = (a.kpiTarget > 0 ? a.kpiTarget : 260) * Math.max(coverage * (1 - lossShare), 0.15);
      const newHire = a.hiredDay === day && rt.hiredAt !== null;
      if (newHire) {
        const remain = clamp(workOverlap(rt.hiredAt ?? T_WORK_START, T_WORK_END) / WORK_MINUTES, 0.15, 1);
        target = Math.min(target, (a.kpiTarget > 0 ? a.kpiTarget : 260) * remain);
      }
      const ratio = target > 0 ? a.kpiToday / target : 0;
      const exempt = a.role === 'boss' || a.role === 'hr';
      if (exempt) a.lowStreak = 0;
      else if (complete && !newHire && rt.arrived) a.lowStreak = ratio < this.config.kpiLowRatio ? a.lowStreak + 1 : 0;
      if (complete) {
        a.kpiHistory.push({ day, ratio: round2(ratio) });
        if (a.kpiHistory.length > KPI_HISTORY_KEEP) a.kpiHistory.splice(0, a.kpiHistory.length - KPI_HISTORY_KEEP);
      }
      out.push({
        id: a.id, name: a.name, roleLabel: a.roleLabel, kpi: Math.round(a.kpiToday), target: Math.round(target),
        ratio: round2(ratio), lowStreak: a.lowStreak,
      });
    }
    return out;
  }

  private logDaySummary(day: number, results: KpiResult[]): void {
    const staff = results.filter((r) => { // sếp / HR không bị xét KPI => không đưa vào bảng xếp hạng
      const role = this.map.get(r.id)?.role;
      return role !== 'boss' && role !== 'hr';
    });
    if (!staff.length) {
      this.log({ kind: 'system', icon: '🌙', text: `Hết ngày ${day}.` });
      return;
    }
    const sorted = [...staff].sort((x, y) => y.ratio - x.ratio);
    const top = sorted[0], low = sorted[sorted.length - 1];
    const pct = (r: KpiResult) => `${Math.round(r.ratio * 100)}%`;
    this.log({
      kind: 'system', icon: '🌙',
      text: `Hết ${this.weekdayOf(day)}, ngày ${day}. KPI cao nhất: ${top.name} ${pct(top)} · thấp nhất: ${low.name} ${pct(low)}`,
    });
  }

  /** Lên lịch cho ngày mới: reset chỉ số, giờ đến/về, ăn trưa, chuyến đi của sếp */
  private planDay(day: number): void {
    this.closedToday = this.mode === 'realtime' && isWeekendEpochDay(this.realStartEpochDay + day - 1);
    this.flags = { lunchOutLogged: false, lastLeaverLogged: false, forceOutLogged: false, firstArrivalLogged: false };
    this.spotted = {};
    this.lastSpotAny = -FAR;
    this.progressPending = 0;
    this.obsWork = 0;
    this.reservations.clear();
    if (this.comp.incident) this.setIncident(null);

    if (day > 1 && (day - 1) % MONTH_DAYS === 0) {
      const rev = Math.round(this.comp.revenueMonth), target = this.comp.revenueTarget;
      this.log({
        kind: 'event', icon: '📅',
        text: `Sang tháng mới! Doanh thu tháng trước: ${rev}/${target} triệu${rev >= target ? ' — vượt chỉ tiêu 🎉' : ' — chưa đạt chỉ tiêu 😬'}`,
      });
      this.comp.revenueMonth = 0;
    }

    for (const a of this.map.values()) {
      const prev = this.rts.get(a.id);
      if (prev) this.revertTempTraits(a, prev); // v3: hiệu ứng "trong ngày" hôm qua (thất tình…) hết hạn
      a.kpiToday = 0;
      a.caughtToday = 0;
      a.energy = round1(rand(75, 95));
      a.stress = round1(Math.max(10, a.stress - 25));
      a.mood = round1(a.mood + (60 - a.mood) * 0.3);
      a.present = false;
      a.path = [];
      a.activity = 'offsite';
      a.activityLabel = '';
      a.emote = '';
      a.activityUntil = this.t;
      a.spotKey = null;
      a.hidden = false;
      a.dayFactor = round2(rand(DAY_FACTOR_MIN, DAY_FACTOR_MAX)); // v3: ngày hên / xui
      const rt = this.newRt();
      this.rts.set(a.id, rt);
      if (a.status === 'active') this.planSchedule(a);
    }
    this.planLunches();
    this.bossPlan = { trips: this.closedToday ? [] : this.planBossTrips(), state: 'none', reason: '', dur: 0, returnAt: 0, forced: null };

    if (this.closedToday) {
      this.log({ kind: 'system', icon: '🏖️', text: `${this.weekdayOf(day)}, ngày ${day} — cuối tuần, văn phòng đóng cửa` });
      return;
    }
    this.log({ kind: 'system', icon: '🌅', text: `${this.weekdayOf(day)}, ngày ${day} — văn phòng mở cửa` });
    this.rollPersonalEvent(); // v3 (sau planSchedule vì có thể dời giờ đến)
    this.noteDayFactors();
    const p = this.comp.project;
    if (day > p.deadlineDay) {
      this.log({ kind: 'event', icon: '⏰', text: `Dự án "${p.name}" đã trễ hạn ${day - p.deadlineDay} ngày, khách bắt đầu hối!` });
    } else if (day === p.deadlineDay) {
      this.log({ kind: 'event', icon: '⏰', text: `Hôm nay là hạn chót dự án "${p.name}" (${Math.round(p.progress)}%)` });
    }
  }

  /** Giờ đến / giờ về theo tính cách (SPEC §3) */
  private planSchedule(a: AgentState): void {
    const t = a.traits;
    const lazy = t.laziness >= 0.6;
    const diligent = t.diligence >= 0.7 && t.laziness < 0.45;
    let arrive: number;
    if (a.role === 'boss') arrive = rand(hm(8, 40), hm(9, 20));
    else if (a.role === 'hr') arrive = rand(hm(7, 50), hm(8, 5));
    else if (diligent) arrive = rand(hm(7, 40), hm(8));
    else if (lazy) { // SPEC 08:10–08:50; khung trượt theo độ lười (0.6 → 08:00–08:30, 0.8 → 08:10–08:50)
      const k = clamp((t.laziness - 0.6) / 0.2, 0, 1.5);
      arrive = rand(hm(8) + 10 * k, hm(8, 30) + 20 * k);
    }
    else arrive = rand(hm(7, 55), hm(8, 20));
    // kẹt xe / ngủ quên bất chợt
    if (a.role !== 'boss' && a.role !== 'hr' && chance(0.06 + 0.08 * t.laziness)) arrive += rand(10, 35);

    const nearDeadline = PROJECT_ROLES.has(a.role) && this.deadlineDays() <= 1;
    let leave: number;
    if (a.role === 'boss') leave = rand(hm(17), hm(18, 30));
    else if (a.role === 'hr') leave = rand(T_WORK_END, hm(17, 45));
    else if (lazy && !nearDeadline) leave = rand(T_WORK_END, hm(17, 35));
    else {
      const otChance = clamp(0.1 + 0.55 * t.diligence - 0.3 * t.laziness + (nearDeadline ? 0.35 : 0), 0, 0.95);
      leave = chance(otChance)
        ? T_WORK_END + rand(15, 120) * (0.4 + 0.6 * t.diligence)
        : rand(T_WORK_END, hm(17, 50));
    }
    a.arriveAt = Math.round(clamp(arrive, hm(7, 30), hm(10)));
    a.leaveAt = Math.round(clamp(leave, a.arriveAt + 60, hm(20, 30)));
  }

  /** Kế hoạch ăn trưa: một nhóm bạn thân ra ngoài ăn, số còn lại ăn ở pantry / tại bàn */
  private planLunches(): void {
    const active = [...this.map.values()].filter((a) => a.status === 'active');
    const staff = active.filter((a) => a.role !== 'boss');
    const out = new Set<string>();
    if (staff.length >= 4 && chance(0.7)) {
      const seed = pickWeighted(staff.map((a) => ({ key: a, w: 0.5 + a.traits.gossip + 0.5 * a.traits.laziness })));
      if (seed) {
        const friends = staff
          .filter((o) => o !== seed && (seed.relationships[o.id]?.score ?? 0) >= 15)
          .sort((x, y) => (seed.relationships[y.id]?.score ?? 0) - (seed.relationships[x.id]?.score ?? 0));
        const size = randInt(2, 3);
        const group = [seed, ...friends.slice(0, size - 1)];
        if (group.length >= 2) for (const g of group) out.add(g.id);
      }
    }
    for (const a of active) {
      const rt = this.rtOf(a);
      rt.lunch = this.makeLunch(a, out.has(a.id));
    }
  }

  private makeLunch(a: AgentState, goOut: boolean): LunchPlan {
    const t = a.traits;
    const lazy = t.laziness >= 0.6;
    const diligent = t.diligence >= 0.7;
    const start = clamp(hm(12) + rand(-5, 8) - (lazy ? 4 : 0) + (diligent ? 3 : 0), hm(11, 50), hm(12, 10));
    const end = rand(hm(12, 40), hm(12, 55)) + (lazy ? rand(3, 10) : 0); // người lười ăn trưa lâu hơn
    let mode: LunchMode;
    if (goOut) mode = 'out';
    else if (a.role === 'boss') mode = chance(0.7) ? 'desk' : 'pantry';
    else {
      const nearDeadline = PROJECT_ROLES.has(a.role) && this.deadlineDays() <= 1;
      mode = chance(0.06 + 0.12 * t.diligence + (nearDeadline ? 0.15 : 0)) ? 'desk' : 'pantry';
    }
    const napChance = mode === 'out' ? 0.05 + 0.2 * t.laziness : 0.12 + 0.5 * t.laziness;
    const napUntil = a.role !== 'boss' && chance(napChance) ? rand(hm(13), hm(13, 15)) : 0;
    return { start, end, mode, napUntil, state: 'pending' };
  }

  /**
   * Giờ thật: khởi động giữa ngày => xếp mọi người vào chỗ luôn (không phát sự kiện đi trễ).
   * onlyAbsent: chỉ xếp người chưa có mặt (khôi phục sau thời gian server tắt).
   */
  private placeForCurrentTime(onlyAbsent = false): void {
    if (this.closedToday) return;
    const m = this.minuteOfDay();
    for (const trip of this.bossPlan.trips) if (trip.start < m) trip.done = true;
    for (const a of this.map.values()) {
      if (a.status !== 'active' || a.sceneId !== null) continue;
      if (onlyAbsent && a.present) continue;
      const rt = this.rtOf(a);
      if (rt.left || rt.lunch?.state === 'out') continue;
      if (a.role === 'boss' && this.bossPlan.state !== 'none') continue;
      if (m >= a.arriveAt + 5 && m < a.leaveAt && m < T_FORCE_OUT) {
        this.flags.firstArrivalLogged = true; // đã có người ngồi sẵn → không còn "người mở cửa"
        rt.arrived = true;
        rt.arrivedAt = this.t - 60;
        a.present = true;
        const seat = this.deskSeat(a.id);
        a.x = seat.x;
        a.y = seat.y;
        a.dir = facingAt(seat);
        a.path = [];
        a.activity = 'idle';
        a.activityUntil = this.t;
        if (rt.lunch && m >= rt.lunch.end) rt.lunch.state = 'done';
      } else if (m >= a.leaveAt) {
        rt.arrived = true;
        rt.left = true;
        if (rt.lunch) rt.lunch.state = 'done';
      }
    }
  }

  // =================================================================== nhân viên mới
  private setupHire(a: AgentState, rt: Rt): void {
    const m = this.minuteOfDay();
    a.status = 'active';
    a.hiredDay = this.curDay;
    rt.hiredAt = m;
    rt.arrived = true;
    rt.left = false;
    rt.exit = null;
    rt.arrivedAt = this.t;
    a.arriveAt = Math.floor(m);
    a.leaveAt = Math.round(clamp(Math.max(T_WORK_END + rand(0, 20), m + 60), 0, hm(20, 30)));
    rt.lunch = m < hm(12, 20) ? this.makeLunch(a, false) : null;
    rt.justHired = true;
    if (a.present && a.sceneId === null) {
      rt.justHired = false;
      this.begin(a, rt, 'working', randInt(20, 40), { target: this.deskSeat(a.id), ...LABELS.newDesk });
    }
  }

  // =================================================================== dev panel
  private setSpeed(v: unknown): void {
    if (this.mode === 'realtime') {
      this.toast('⏱️', 'Đang chạy theo giờ thật Việt Nam — không tua nhanh được');
      return;
    }
    if (typeof v !== 'number' || !ALLOWED_SPEEDS.includes(v) || v === this.spd) return;
    this.spd = v;
    this.toast(v === 1 ? '▶️' : '⏩', v === 1 ? 'Tốc độ bình thường (x1)' : `Tua nhanh x${v}`);
    this.statusDirty = true;
    this.forceFrame = true;
  }

  private devEvent(name: string): void {
    switch (name) {
      case 'boss_leave': this.devBossLeave(); return;
      case 'boss_return': this.devBossReturn(); return;
      case 'end_day': this.devEndDay(); return;
      case 'deal': this.devDeal(); return;
      case 'release': this.release(); return;
      default:
        if (!this.director) { this.toast('⚠️', 'Chưa có Director để xử lý sự kiện'); return; }
        this.callDirector('onEvent', (d) => d.onEvent(name as DevEventName));
    }
  }

  private devBossLeave(): void {
    const b = this.boss();
    if (!b) { this.toast('⚠️', 'Công ty chưa có sếp'); return; }
    const plan = this.bossPlan;
    if (plan.state === 'away') { this.toast('🏌️', 'Sếp đang đi vắng rồi'); return; }
    if (plan.state === 'leaving') { this.toast('🚶', 'Sếp đang trên đường ra ngoài'); return; }
    const rt = this.rtOf(b);
    if (!b.present || rt.left) { this.toast('🏠', 'Sếp không có ở văn phòng'); return; }
    if (rt.exit === 'home') { this.toast('🏠', 'Sếp đang trên đường về nhà rồi'); return; }
    plan.forced = { start: Math.floor(this.minuteOfDay()), dur: randInt(60, 150), reason: this.pickReasons(1)[0], done: false };
    if (b.sceneId !== null) this.toast('🏌️', 'Sếp sẽ ra ngoài ngay khi nói chuyện xong');
    this.processBoss();
  }

  private devBossReturn(): void {
    const b = this.boss();
    if (!b) { this.toast('⚠️', 'Công ty chưa có sếp'); return; }
    const plan = this.bossPlan;
    const rt = this.rtOf(b);
    if (plan.state === 'away') { this.bossReturn(); return; }
    if (plan.state === 'leaving') {
      plan.state = 'none';
      plan.forced = null;
      if (b.sceneId === null) {
        this.begin(b, rt, 'arriving', 0, { target: this.deskSeat(b.id), label: 'đổi ý, quay lại phòng', emote: '🔙' });
      } else {
        rt.exit = null;
      }
      this.statusDirty = true;
      this.toast('🔙', 'Sếp đổi ý, quay lại phòng');
      return;
    }
    if (b.present) { this.toast('👔', 'Sếp đang ở văn phòng rồi'); return; }
    // chưa đến / đã về => gọi sếp tới ngay
    const m = this.minuteOfDay();
    rt.arrived = true;
    rt.left = false;
    if (!(rt.arrivedAt > 0)) rt.arrivedAt = this.t;
    b.leaveAt = Math.round(Math.max(b.leaveAt, Math.min(m + 90, hm(22))));
    for (const t of plan.trips) if (t.start <= m) t.done = true;
    this.bossReturn();
  }

  private devEndDay(): void {
    if (this.mode === 'realtime') {
      const m = Math.floor(this.minuteOfDay());
      for (const a of this.map.values()) if (a.status === 'active') a.leaveAt = Math.min(a.leaveAt, m);
      this.toast('🌙', 'Giờ thật: cho cả văn phòng về sớm (ngày mới bắt đầu lúc 0:00)');
      return;
    }
    this.toast('🌙', `Kết thúc ngày ${this.curDay}`);
    this.endDay('dev');
  }

  private devDeal(): void {
    const sales = [...this.map.values()].filter((a) => a.status === 'active' && SALES_ROLES.has(a.role));
    const who = pick(sales.filter((a) => a.present)) ?? pick(sales);
    if (who) this.closeDeal(who);
    else this.callDirector('onEvent', (d) => d.onEvent('deal'));
  }

  // =================================================================== xuất dữ liệu
  private output(nowMs: number): void {
    if (this.forceFrame || nowMs - this.lastFrameAt >= FRAME_MS) {
      this.lastFrameAt = nowMs;
      this.forceFrame = false;
      this.emit({ t: 'frame', clock: this.clock(), a: this.frameAgents(), ts: Date.now() });
    }
    const due = nowMs - this.lastAgentsAt >= AGENTS_MS;
    if (due || ((this.agentsDirty || this.statusDirty) && nowMs - this.lastAgentsAt >= 300)) {
      this.lastAgentsAt = nowMs;
      if (due || this.agentsDirty) this.emit({ t: 'agents', agents: this.publicAgents() });
      this.emit({ t: 'status', status: this.statusInfo() });
      this.agentsDirty = false;
      this.statusDirty = false;
    }
  }

  private frameAgents(): FrameAgent[] {
    const out: FrameAgent[] = [];
    for (const a of this.map.values()) {
      if (!a.present) continue;
      const flags = (a.path.length ? 1 : 0) | (a.onPhone ? 2 : 0) | (a.sceneId !== null ? 4 : 0) | (a.hidden ? 8 : 0);
      out.push([a.id, round2(a.x), round2(a.y), a.dir, a.activity, a.emote, flags]);
    }
    return out;
  }

  private publicAgents(): PublicAgent[] {
    return [...this.map.values()].map((a) => this.toPublicAgent(a));
  }

  private deskItem(id: string | undefined): ProductPublic | null {
    if (!id) return null;
    if (this.deskItemCache.has(id)) return this.deskItemCache.get(id) ?? null;
    let out: ProductPublic | null = null;
    try {
      const p = getProduct(id);
      out = p ? toPublic(p, 'desk') : null;
    } catch (e) {
      this.reportError('deskItem', e);
      return null;
    }
    this.deskItemCache.set(id, out);
    return out;
  }

  /** v2: sản phẩm trên kệ phòng trưng bày cho hello.products (url src=showroom) — tính 1 lần; lỗi => [] */
  private showroomProducts(): ShowroomProduct[] {
    if (!this.showroomCache) {
      try {
        this.showroomCache = buildShowroomProducts();
      } catch (e) {
        this.reportError('showroomProducts', e);
        this.showroomCache = [];
      }
    }
    return this.showroomCache;
  }

  private toPublicAgent(a: AgentState): PublicAgent {
    return {
      id: a.id, name: a.name, fullName: a.fullName, role: a.role, roleLabel: a.roleLabel,
      gender: a.gender, age: a.age, bio: a.bio, quirks: a.quirks, likes: a.likes, dislikes: a.dislikes,
      traits: a.traits, look: a.look, deskId: a.deskId, deskItem: this.deskItem(a.deskItemProductId),
      status: a.status, present: a.present,
      activity: a.activity, activityLabel: a.activityLabel, emote: a.emote, onPhone: a.onPhone, sceneId: a.sceneId,
      energy: round1(a.energy), mood: round1(a.mood), stress: round1(a.stress),
      kpiToday: round1(a.kpiToday), kpiTarget: a.kpiTarget, kpiHistory: a.kpiHistory,
      lowStreak: a.lowStreak, warnings: a.warnings, caughtToday: a.caughtToday,
      relationships: a.relationships, memories: a.memories, hiredDay: a.hiredDay,
      // v3: hồ sơ vẽ chấm "tính cách gốc" + huy hiệu thử thách / thưởng / thăng chức
      traitBase: a.traitBase, probationUntilDay: a.probationUntilDay, bonuses: a.bonuses ?? 0, promotions: a.promotions ?? 0,
    };
  }

  private statusInfo(): StatusInfo {
    let ai: UsageStats;
    try {
      ai = this.brain.usage();
    } catch (e) {
      this.reportError('brain.usage', e);
      ai = {
        mode: 'offline', model: this.config.model, calls: 0, failures: 0, inputTokens: 0, cachedTokens: 0,
        outputTokens: 0, costTodayUsd: 0, costTotalUsd: 0, budgetUsd: this.config.dailyBudgetUsd, skipped: 0,
      };
    }
    return {
      bossAway: this.bossAway(), bossNote: this.bossNote(), viewers: this.viewerCount, ai,
      company: this.company(), clicks: this.clicks, speed: this.speed(),
    };
  }

  // =================================================================== an toàn
  private sanitize(a: AgentState): void {
    if (!fin(a.energy)) a.energy = 70; else if (a.energy < 0 || a.energy > 100) a.energy = clamp100(a.energy);
    if (!fin(a.mood)) a.mood = 60; else if (a.mood < 0 || a.mood > 100) a.mood = clamp100(a.mood);
    if (!fin(a.stress)) a.stress = 30; else if (a.stress < 0 || a.stress > 100) a.stress = clamp100(a.stress);
    if (!fin(a.kpiToday) || a.kpiToday < 0) a.kpiToday = 0;
    if (!Array.isArray(a.path)) a.path = [];
    if (!fin(a.x) || !fin(a.y)) {
      const p = this.deskSeat(a.id);
      a.x = p.x;
      a.y = p.y;
      a.path = [];
    } else if (a.x < 0 || a.y < 0 || a.x > MAP_W - 1 || a.y > MAP_H - 1) {
      a.x = clamp(a.x, 0, MAP_W - 1);
      a.y = clamp(a.y, 0, MAP_H - 1);
    }
    if (!fin(a.activityUntil)) a.activityUntil = this.t;
    // v2: chỉ ẩn khi đang 'toilet', có mặt, đã tới chỗ và không trong cảnh — mọi trường hợp khác tự lộ ra
    // (không bao giờ "kẹt ẩn", kể cả khi Director lấy người đang trong WC vào cảnh)
    if (a.hidden && (!a.present || a.activity !== 'toilet' || a.sceneId !== null || a.path.length > 0)) a.hidden = false;
  }

  /** Watchdog: sceneId treo quá lâu mà Director không còn cảnh đó => gỡ */
  private watchScene(a: AgentState, rt: Rt): void {
    if (a.sceneId === null || a.sceneId === undefined) {
      if (a.sceneId === undefined) a.sceneId = null;
      rt.sceneSeen = null;
      return;
    }
    const now = this.realNow();
    if (rt.sceneSeen !== a.sceneId) {
      rt.sceneSeen = a.sceneId;
      rt.sceneSince = now;
      return;
    }
    if (now - rt.sceneSince < SCENE_WATCHDOG_MS) return;
    const sid = a.sceneId;
    const live = this.askDirector('publicScenes', (d) => d.publicScenes().some((s) => s.id === sid && s.status !== 'end'), false);
    if (live) {
      rt.sceneSince = now - SCENE_WATCHDOG_MS / 2; // còn diễn => kiểm tra lại sau
      return;
    }
    console.warn(`[world] ${a.name} kẹt trong cảnh ${sid} quá lâu — tự gỡ.`);
    a.sceneId = null;
    a.onPhone = false;
    rt.sceneSeen = null;
    if (a.activity === 'scene' || a.activity === 'meeting') a.activityUntil = this.t;
  }

  private callDirector(where: string, fn: (d: DirectorApi) => void): void {
    const d = this.director;
    if (!d) return;
    try {
      fn(d);
    } catch (e) {
      this.reportError(`director.${where}`, e);
    }
  }

  private askDirector<T>(where: string, fn: (d: DirectorApi) => T, def: T): T {
    const d = this.director;
    if (!d) return def;
    try {
      const v = fn(d);
      return v ?? def;
    } catch (e) {
      this.reportError(`director.${where}`, e);
      return def;
    }
  }

  /** Lấy dữ liệu serialize của module khác, đảm bảo JSON hợp lệ (lỗi => null, không làm hỏng cả file) */
  private jsonSafe(where: string, fn: () => unknown): unknown {
    try {
      const v = fn();
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    } catch (e) {
      this.reportError(where, e);
      return null;
    }
  }

  /** Log lỗi có giới hạn tần suất (mỗi loại tối đa 1 lần / 10 giây) */
  private reportError(where: string, e: unknown): void {
    const now = Date.now();
    const rec = this.errLog.get(where);
    if (rec && now - rec.t < 10_000) { rec.n++; return; }
    const extra = rec && rec.n ? ` (+${rec.n} lỗi tương tự đã ẩn)` : '';
    console.error(`[world] Lỗi ở ${where}${extra}:`, errText(e));
    this.errLog.set(where, { t: now, n: 0 });
  }

  // =================================================================== khởi tạo / serialize
  /** Văn phòng mới tinh: đội hình ban đầu + quan hệ + dự án đầu tiên */
  private freshInit(): void {
    this.map = new Map();
    this.rts = new Map();
    this.reservations = new Map();
    this.history = [];
    this.logSeq = 0;
    this.clicks = 0;
    this.clicksBy = {};
    this.clicksBySource = {};
    this.clicksByProductSource = {};
    this.recentProjects = [];
    this.spotted = {};
    this.lastSpotAny = -FAR;
    this.progressPending = 0;
    this.spd = 1;
    this.dayStartNotified = false;
    if (this.mode === 'realtime') {
      const w = vnWall();
      this.realStartEpochDay = w.epochDay;
      this.curDay = 1;
      this.t = w.minute;
    } else {
      this.curDay = 1;
      this.t = DAY_START;
    }

    let roster: unknown[] = [];
    try { roster = Array.isArray(INITIAL_ROSTER) ? INITIAL_ROSTER : []; } catch { roster = []; }
    if (!roster.length) console.warn('[world] ⚠️ INITIAL_ROSTER trống — văn phòng không có ai.');
    for (const raw of roster) {
      const p = sanitizePersona(raw, `nv_${this.map.size + 1}`);
      if (this.map.has(p.id)) continue;
      // v3: không ai bị "đánh dấu" trước — trait công việc về dải chung, phần còn lại roster ± 0.15 (traitBase lưu lại để trôi quanh đó)
      if (this.config.storyRandomizeTraits !== false) p.traits = randomizeOpeningTraits(p.traits, p.role);
      const a = newAgentState(p, 'active', DESKS[p.deskId]?.seat ?? ENTRANCE, 1, 0);
      this.map.set(p.id, a);
    }
    for (const a of this.map.values()) {
      for (const b of this.map.values()) if (a !== b) a.relationships[b.id] = { score: 0, note: 'đồng nghiệp' };
    }
    let rels: unknown[] = [];
    try { rels = Array.isArray(INITIAL_RELATIONSHIPS) ? INITIAL_RELATIONSHIPS : []; } catch { rels = []; }
    for (const r of rels) {
      if (!isObj(r) || typeof r.from !== 'string' || typeof r.to !== 'string' || r.from === r.to) continue;
      const a = this.map.get(r.from);
      if (!a || !this.map.has(r.to)) continue;
      a.relationships[r.to] = { score: Math.round(num(r.score, 0, -100, 100)), note: str(r.note, '', 120) || 'đồng nghiệp' };
    }

    this.comp = {
      name: this.config.companyName,
      project: this.newProject(1, true),
      projectsDone: 0,
      revenueMonth: 0,
      revenueTarget: REVENUE_TARGET,
      incident: null,
    };
    this.bossPlan = { trips: [], state: 'none', reason: '', dur: 0, returnAt: 0, forced: null };
    this.planDay(this.curDay);
    if (this.mode === 'realtime') this.placeForCurrentTime();
    this.agentsDirty = true;
    this.statusDirty = true;
    this.forceFrame = true;
  }

  private serializeWorld(): unknown {
    return {
      mode: this.mode,
      time: this.t,
      day: this.curDay,
      realStartEpochDay: this.realStartEpochDay,
      closedToday: this.closedToday,
      logSeq: this.logSeq,
      log: this.history,
      clicks: this.clicks,
      clicksBy: this.clicksBy,
      clicksBySource: this.clicksBySource,
      clicksByProductSource: this.clicksByProductSource,
      company: this.comp,
      recentProjects: this.recentProjects,
      agents: [...this.map.values()],
      rt: Object.fromEntries(this.rts),
      boss: this.bossPlan,
      spotted: this.spotted,
      lastSpotAny: this.lastSpotAny,
      obsWork: this.obsWork,
      flags: this.flags,
      // v3: kho tin thời sự (id đã dùng, tin gần đây, vài tin mỗi nhóm) — lưu chung một file
      news: this.jsonSafe('news.serialize', () => getNews().serialize()),
    };
  }

  private reviveRt(raw: unknown): Rt | null {
    if (!isObj(raw)) return null;
    const rt = this.newRt();
    if (isObj(raw.cd)) {
      for (const [k, v] of Object.entries(raw.cd)) if (k in ACTIONS && fin(v)) rt.cd[k as ActionKey] = v;
    }
    rt.arrived = bool(raw.arrived, false);
    rt.left = bool(raw.left, false);
    rt.arrivedAt = num(raw.arrivedAt, this.t);
    rt.lunch = reviveLunch(raw.lunch);
    rt.outUntil = num(raw.outUntil, 0);
    rt.idleSince = num(raw.idleSince, this.t);
    rt.hiredAt = raw.hiredAt === null || raw.hiredAt === undefined ? null : num(raw.hiredAt, 0, 0, 1439);
    rt.exit = raw.exit === 'home' || raw.exit === 'lunch' || raw.exit === 'trip' || raw.exit === 'remove' ? raw.exit : null;
    rt.removeBy = num(raw.removeBy, FAR);
    rt.justHired = bool(raw.justHired, false);
    rt.speedLoss = num(raw.speedLoss, 0, 0, WORK_MINUTES);
    // v3
    rt.personal = revivePersonal(raw.personal);
    if (isObj(raw.tempTraits)) {
      for (const k of TRAIT_KEYS) if (fin(raw.tempTraits[k]) && raw.tempTraits[k] !== 0) rt.tempTraits[k] = clamp(raw.tempTraits[k], -0.5, 0.5);
    }
    rt.dayNote = typeof raw.dayNote === 'string' && raw.dayNote.trim() ? raw.dayNote.slice(0, 160) : null;
    rt.leaveReason = raw.leaveReason === 'fired' || raw.leaveReason === 'resigned' || raw.leaveReason === 'laid_off' ? raw.leaveReason : null;
    return rt;
  }

  /** Dựng lại Rt khi file thiếu (suy ra từ giờ hiện tại) */
  private rebuildRt(a: AgentState): Rt {
    const rt = this.newRt();
    const m = this.minuteOfDay();
    rt.arrived = a.present || m > a.arriveAt;
    rt.left = !a.present && m >= a.leaveAt;
    rt.lunch = a.status === 'active' ? this.makeLunch(a, false) : null;
    if (rt.lunch && m >= rt.lunch.start) rt.lunch.state = 'done';
    return rt;
  }

  private restoreWorld(raw: unknown): boolean {
    if (!isObj(raw) || !Array.isArray(raw.agents)) return false;
    const agents = new Map<string, AgentState>();
    for (const x of raw.agents) {
      const a = reviveAgent(x);
      if (a && !agents.has(a.id)) agents.set(a.id, a);
    }
    if (!agents.size) return false;
    if (![...agents.values()].some((a) => a.role === 'boss' && a.status === 'active')) return false;
    const company = reviveCompany(raw.company, this.config.companyName);
    if (!company) return false;
    const savedDay = Math.round(num(raw.day, NaN, 1, 1e6));
    const savedTime = num(raw.time, NaN);
    if (!fin(savedDay) || !fin(savedTime)) return false;
    const savedMode = raw.mode === 'realtime' ? 'realtime' : 'compressed';

    // quan hệ: bỏ người không còn, thêm cặp còn thiếu
    for (const a of agents.values()) {
      for (const k of Object.keys(a.relationships)) if (k === a.id || !agents.has(k)) delete a.relationships[k];
      for (const b of agents.values()) if (a !== b && !a.relationships[b.id]) a.relationships[b.id] = { score: 0, note: 'đồng nghiệp' };
    }
    const log = Array.isArray(raw.log) ? raw.log.filter(isLogEntry).slice(-LOG_KEEP) : [];
    const rtRaw = isObj(raw.rt) ? raw.rt : {};

    // ---- commit (lỗi phía dưới => load() gọi freshInit) ----
    this.map = agents;
    this.rts = new Map();
    this.reservations = new Map();
    this.comp = company;
    this.recentProjects = strArr(raw.recentProjects, 6, 100);
    this.history = log;
    this.logSeq = Math.max(Math.round(num(raw.logSeq, 0, 0, 1e12)), ...log.map((e) => e.id), 0);
    this.clicks = Math.round(num(raw.clicks, 0, 0, 1e12));
    this.clicksBy = reviveCounts(raw.clicksBy);
    // v2 (thêm sau, file cũ không có → rỗng)
    this.clicksBySource = reviveCounts(raw.clicksBySource, 16);
    this.clicksByProductSource = {};
    if (isObj(raw.clicksByProductSource)) {
      for (const [id, m] of Object.entries(raw.clicksByProductSource).slice(0, 500)) {
        const counts = reviveCounts(m, 16);
        if (Object.keys(counts).length) this.clicksByProductSource[id] = counts;
      }
    }
    this.spotted = {};
    this.lastSpotAny = -FAR;
    this.progressPending = 0;
    this.spd = 1;
    this.flags = { lunchOutLogged: false, lastLeaverLogged: false, forceOutLogged: false, firstArrivalLogged: false };
    if (raw.news !== undefined && raw.news !== null) { // v3 (file cũ không có)
      try { getNews().restore(raw.news); } catch (e) { this.reportError('news.restore', e); }
    }

    if (savedMode === this.mode) {
      this.curDay = savedDay;
      const dayStart = (savedDay - 1) * MIN_PER_DAY;
      if (this.mode === 'compressed') {
        this.t = savedTime >= dayStart && savedTime < dayStart + MIN_PER_DAY ? savedTime : dayStart + DAY_START;
      } else {
        this.realStartEpochDay = fin(raw.realStartEpochDay) ? Math.round(raw.realStartEpochDay) : vnWall().epochDay - (savedDay - 1);
        this.t = clamp(savedTime, dayStart, dayStart + MIN_PER_DAY - 0.001);
      }
      this.closedToday = this.mode === 'realtime' && isWeekendEpochDay(this.realStartEpochDay + this.curDay - 1);
      this.bossPlan = reviveBossPlan(raw.boss);
      if (isObj(raw.flags)) {
        this.flags = {
          lunchOutLogged: bool(raw.flags.lunchOutLogged, false),
          firstArrivalLogged: bool(raw.flags.firstArrivalLogged, true),
          lastLeaverLogged: bool(raw.flags.lastLeaverLogged, false),
          forceOutLogged: bool(raw.flags.forceOutLogged, false),
        };
      }
      this.spotted = reviveCounts(raw.spotted);
      this.lastSpotAny = num(raw.lastSpotAny, -FAR);
      // không có trường này (file cũ) => coi như đã quan sát tới thời điểm lưu
      this.obsWork = num(raw.obsWork, workOverlap(0, this.minuteOfDay()), 0, WORK_MINUTES);
      const gone: string[] = [];
      for (const a of agents.values()) {
        const rt = this.reviveRt(rtRaw[a.id]) ?? this.rebuildRt(a);
        this.rts.set(a.id, rt);
        if (this.normalizeRestored(a, rt)) gone.push(a.id);
      }
      for (const id of gone) this.deleteAgent(id);
      if ([...this.rts.values()].some((rt) => rt.arrived)) this.flags.firstArrivalLogged = true;
      const b = this.boss();
      if (this.bossPlan.state === 'away' && b?.present) this.bossPlan.state = 'none';
      if (this.bossPlan.state === 'leaving' && !b?.present) this.bossPlan.state = 'none';
      if (this.mode === 'realtime') {
        // server tắt một lúc trong cùng ngày: nhảy tới giờ hiện tại, ai lẽ ra đã tới thì ngồi sẵn
        const w = vnWall();
        if (w.epochDay - this.realStartEpochDay + 1 === this.curDay) {
          this.t = Math.max(this.t, (this.curDay - 1) * MIN_PER_DAY + w.minute);
          this.placeForCurrentTime(true);
        }
      }
    } else {
      // đổi chế độ thời gian giữa 2 lần chạy: sang ngày mới cho gọn
      const nextDay = savedDay + 1;
      this.curDay = nextDay;
      if (this.mode === 'realtime') {
        const w = vnWall();
        this.realStartEpochDay = w.epochDay - (nextDay - 1);
        this.t = (nextDay - 1) * MIN_PER_DAY + w.minute;
      } else {
        this.t = (nextDay - 1) * MIN_PER_DAY + DAY_START;
      }
      for (const a of [...agents.values()]) if (a.status !== 'active') this.deleteAgent(a.id);
      this.bossPlan = { trips: [], state: 'none', reason: '', dur: 0, returnAt: 0, forced: null };
      this.planDay(this.curDay);
      if (this.mode === 'realtime') this.placeForCurrentTime();
    }
    this.agentsDirty = true;
    this.statusDirty = true;
    this.forceFrame = true;
    return true;
  }

  /** Chuẩn hoá agent sau khi đọc file. Trả về true nếu nên xoá (ứng viên / người bị đuổi đã ra khỏi văn phòng). */
  private normalizeRestored(a: AgentState, rt: Rt): boolean {
    a.path = [];
    a.hidden = false; // không ai còn trong WC sau khi khởi động lại
    a.sceneId = null; // cảnh không sống sót qua khởi động lại
    a.onPhone = false;
    a.spotKey = null;
    rt.partner = null;
    rt.pendingDur = null;
    rt.rate = null;
    rt.waypoints = [];
    rt.panic = false;
    rt.sceneSeen = null;
    if (a.status !== 'active') {
      if (!a.present) return true;
      rt.exit = 'remove';
      rt.removeBy = this.t + REMOVE_TIMEOUT;
      a.activity = 'idle';
      return false;
    }
    if (!a.present) {
      if (a.activity !== 'away') a.activity = 'offsite';
      return false;
    }
    if (a.activity === 'leaving') {
      if (!rt.exit) rt.exit = 'home';
      this.walkTo(a, this.nearestDoor(a));
      return false;
    }
    if (rt.exit) rt.exit = null;
    if (a.activity === 'arriving') {
      this.walkTo(a, this.deskSeat(a.id));
      rt.pendingDur = 0;
      return false;
    }
    a.activity = 'idle';
    a.activityUntil = this.t;
    return false;
  }
}
