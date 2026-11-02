// Lớp "thân xác" (0 token): bảng hoạt động, hiệu ứng mỗi phút game, trọng số chọn hoạt động (utility),
// nhãn/emote hiển thị, hướng nhìn tại các chỗ, lộ trình đi tuần của sếp. Xem SPEC §4.
import type { Activity, AgentState, Dir, RoleKey } from '../types.js';
import { DESKS, MAP_H, MAP_W, SPOTS, WALLS, isWalkable, type Pt } from './map.js';
import { ROLE_INFO } from '../content/roster.js';
import { ACTIVITY_FLAVOR, SLACK_ACTIVITIES } from '../content/catalog.js';
import { hm } from './clock.js';

// ---------------------------------------------------------------- tiện ích ngẫu nhiên / số học
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const chance = (p: number): boolean => Math.random() < p;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export function pick<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

// ---------------------------------------------------------------- nhóm vai trò
export const ROLE_KEYS: readonly RoleKey[] = [
  'boss', 'hr', 'techlead', 'senior', 'junior', 'qa', 'designer', 'saleslead', 'salesnew', 'marketing',
];
/** Làm dự án cho khách (KPI của họ đẩy tiến độ dự án) */
export const PROJECT_ROLES: ReadonlySet<RoleKey> = new Set<RoleKey>(['techlead', 'senior', 'junior', 'qa', 'designer']);
export const SALES_ROLES: ReadonlySet<RoleKey> = new Set<RoleKey>(['saleslead', 'salesnew']);
export const DEV_ROLES: ReadonlySet<RoleKey> = new Set<RoleKey>(['techlead', 'senior', 'junior']);

export const ALL_ACTIVITIES: readonly Activity[] = [
  'offsite', 'arriving', 'leaving', 'working', 'slacking', 'napping', 'coffee', 'water', 'snack', 'toilet',
  'pingpong', 'chill', 'window', 'showroom', 'printing', 'lunch', 'meeting', 'scene', 'boss_office', 'patrol', 'away',
  'server_fix', 'idle',
];
const ACTIVITY_SET: ReadonlySet<string> = new Set(ALL_ACTIVITIES);
export const isActivity = (v: unknown): v is Activity => typeof v === 'string' && ACTIVITY_SET.has(v);

// ---------------------------------------------------------------- bảng hoạt động tự chọn
export type ActionKey =
  | 'work' | 'slack' | 'nap' | 'coffee' | 'water' | 'snack' | 'toilet'
  | 'pingpong' | 'chill' | 'window' | 'showroom' | 'printing' | 'boss_office' | 'patrol';

export interface ActionDef {
  key: ActionKey;
  activity: Activity;
  /** nhóm chỗ trong SPOTS (thử lần lượt); null = ghế tại bàn mình; [] = đặc biệt (đi tuần) */
  spots: string[] | null;
  /** thời lượng (phút game), tính từ lúc tới nơi */
  dur: [number, number];
  /** phút game kể từ lúc bắt đầu, trước khi được chọn lại */
  cooldown: number;
}

export const ACTIONS: Record<ActionKey, ActionDef> = {
  work: { key: 'work', activity: 'working', spots: null, dur: [25, 70], cooldown: 0 },
  slack: { key: 'slack', activity: 'slacking', spots: null, dur: [8, 30], cooldown: 0 },
  nap: { key: 'nap', activity: 'napping', spots: null, dur: [10, 25], cooldown: 60 },
  coffee: { key: 'coffee', activity: 'coffee', spots: ['coffee'], dur: [5, 10], cooldown: 60 },
  water: { key: 'water', activity: 'water', spots: ['water'], dur: [3, 5], cooldown: 40 },
  snack: { key: 'snack', activity: 'snack', spots: ['snack', 'fridge'], dur: [4, 8], cooldown: 90 },
  toilet: { key: 'toilet', activity: 'toilet', spots: ['toilet'], dur: [4, 10], cooldown: 60 },
  pingpong: { key: 'pingpong', activity: 'pingpong', spots: ['pingpong'], dur: [12, 25], cooldown: 120 },
  chill: { key: 'chill', activity: 'chill', spots: ['lounge'], dur: [10, 25], cooldown: 45 },
  window: { key: 'window', activity: 'window', spots: ['window'], dur: [6, 14], cooldown: 15 },
  // v2: ngắm đồ ở phòng trưng bày (thứ tự kệ do showroomLean() quyết định theo từng người)
  showroom: { key: 'showroom', activity: 'showroom', spots: ['showroom_beauty', 'showroom_tech'], dur: [6, 12], cooldown: 120 },
  printing: { key: 'printing', activity: 'printing', spots: ['printer'], dur: [3, 6], cooldown: 40 },
  boss_office: { key: 'boss_office', activity: 'boss_office', spots: null, dur: [20, 60], cooldown: 0 },
  patrol: { key: 'patrol', activity: 'patrol', spots: [], dur: [8, 20], cooldown: 60 },
};

// ---------------------------------------------------------------- hiệu ứng
export interface StatDelta { energy?: number; mood?: number; stress?: number }

/** Hiệu ứng mỗi phút game khi đã tới nơi (không áp dụng lúc đang đi) */
const PER_MINUTE: Partial<Record<Activity, StatDelta>> = {
  working: { energy: -0.06, stress: 0.03 },
  slacking: { energy: 0.01, stress: -0.08, mood: 0.04 },
  napping: { energy: 0.5 },
  pingpong: { stress: -0.6, mood: 0.4, energy: -0.1 },
  chill: { stress: -0.4, energy: 0.2 },
  showroom: { mood: 0.12, stress: -0.08, energy: -0.02 }, // "window shopping" cho vui, 6–12 phút
  lunch: { energy: 0.3, mood: 0.2 },
  boss_office: { energy: -0.03 },
  patrol: { energy: -0.03 },
  server_fix: { energy: -0.08, stress: 0.06 },
};

export function perMinute(activity: Activity, role: RoleKey): StatDelta | undefined {
  // không phải sales: ra cửa sổ hóng gió => bớt căng thẳng chút
  if (activity === 'window') return SALES_ROLES.has(role) || role === 'boss' ? undefined : { stress: -0.1 };
  return PER_MINUTE[activity];
}

/** Hiệu ứng "khi xong" — World rải đều theo thời lượng, bị ngắt giữa chừng thì nhận một phần */
const ON_COMPLETE: Partial<Record<Activity, StatDelta>> = {
  coffee: { energy: 22 },
  water: { energy: 3 },
  snack: { mood: 4, energy: 5 },
  toilet: { stress: -6 },
};

export function onCompleteRate(activity: Activity, durMin: number): StatDelta | null {
  const e = ON_COMPLETE[activity];
  if (!e) return null;
  const d = Math.max(1, durMin);
  return {
    energy: e.energy !== undefined ? e.energy / d : undefined,
    mood: e.mood !== undefined ? e.mood / d : undefined,
    stress: e.stress !== undefined ? e.stress / d : undefined,
  };
}

/** Hệ số KPI theo hoạt động (0 = không ra KPI) */
export function kpiFactor(activity: Activity, role: RoleKey): number {
  switch (activity) {
    case 'working': return 1;
    case 'window': return SALES_ROLES.has(role) ? 0.8 : 0;
    case 'boss_office': return role === 'boss' ? 1 : 0;
    case 'server_fix': return DEV_ROLES.has(role) ? 0.5 : 0;
    default: return 0;
  }
}

/** v3: hệ số "ngày hên / xui" (AgentState.dayFactor, 0.75–1.2; ốm có thể xuống 0.6) — thiếu / hỏng => 1 */
export function dayFactorOf(a: Pick<AgentState, 'dayFactor'>): number {
  const f = a.dayFactor;
  return typeof f === 'number' && Number.isFinite(f) ? clamp(f, 0.5, 1.5) : 1;
}

/** chỉ tiêu "chuẩn" để quy đổi: vai trò có chỉ tiêu cao hơn (Sales 300) làm ra KPI nhanh hơn tương ứng, vai thấp hơn (sếp 240) chậm hơn */
const KPI_TARGET_REF = 260;
/**
 * v3: hệ số vai trò = chỉ tiêu GỐC của vai / 260 — để % KPI không phụ thuộc vai (trước đây Tú với chỉ tiêu 300 luôn thấp hơn Bảo
 * 250 dù chăm bằng nhau). Dùng chỉ tiêu gốc của vai, không dùng kpiTarget hiện tại: thăng chức (chỉ tiêu +10%) vẫn phải cố hơn.
 */
export function roleKpiFactor(role: RoleKey): number {
  const base = ROLE_INFO[role]?.kpiTarget;
  return typeof base === 'number' && base > 0 ? clamp(base / KPI_TARGET_REF, 0.7, 1.4) : 1;
}

/** KPI mỗi phút làm việc (SPEC §4) × hệ số ngày (v3) × hệ số vai trò (v3) */
export function kpiRate(a: AgentState, wifiDown: boolean): number {
  const r = (0.55 + 0.9 * a.traits.diligence) * (0.5 + 0.6 * a.energy / 100) * (0.75 + 0.35 * a.mood / 100);
  return Math.max(0, r) * dayFactorOf(a) * roleKpiFactor(a.role) * (wifiDown ? 0.3 : 1);
}

// ---------------------------------------------------------------- bắt quả tang
export const LUNCH_FROM = hm(12);
export const LUNCH_TO = hm(13);
export const NAP_SAFE_TO = hm(13, 15);
const CATCHABLE: ReadonlySet<Activity> = new Set<Activity>(['slacking', 'pingpong', 'chill', 'napping']);

/** Hoạt động có bị sếp bắt không. 12:00–13:00 là giờ nghỉ trưa (không bắt), ngủ trưa được tới 13:15. */
export function isCatchable(activity: Activity, minuteOfDay: number): boolean {
  if (!CATCHABLE.has(activity)) return false;
  if (minuteOfDay >= LUNCH_FROM && minuteOfDay < LUNCH_TO) return false;
  if (activity === 'napping' && minuteOfDay >= LUNCH_FROM && minuteOfDay < NAP_SAFE_TO) return false;
  return true;
}

// ---------------------------------------------------------------- utility
export interface Weighted<T> { key: T; w: number }

export interface UtilityCtx {
  agent: AgentState;
  minute: number;          // phút trong ngày
  bossPresent: boolean;    // sếp đang ở văn phòng
  /**
   * "Áp lực sếp" 0..1 — mở rộng liên tục của bossPresent/bossAway trong SPEC (trùng SPEC ở 2 đầu):
   * 1 = sếp đang đi lại ngoài khu làm việc / ở gần, ~0.75 = sếp ngồi trong phòng kính, 0 = sếp vắng.
   */
  bossPressure: number;
  wifiDown: boolean;
  deadlineDays: number;    // project.deadlineDay - day
  kpiBehind: boolean;      // KPI đang chậm so với tiến độ ngày
  sinceArrival: number;    // phút game kể từ lúc vào văn phòng
  breakTime: boolean;      // ăn trưa xong nhưng chưa tới 13:00
  overtime: boolean;       // sau 17:30
  available: (key: ActionKey) => boolean;
}

/** Trọng số cho nhân viên (SPEC §4) + vài tinh chỉnh cho sinh động */
export function staffWeights(c: UtilityCtx): Weighted<ActionKey>[] {
  const a = c.agent;
  const dil = clamp(a.traits.diligence, 0, 1);
  const laz = clamp(a.traits.laziness, 0, 1);
  const p = c.bossPresent ? clamp(c.bossPressure, 0, 1) : 0;
  const project = PROJECT_ROLES.has(a.role);
  const sales = SALES_ROLES.has(a.role);
  const m = c.minute;

  // SPEC: work +0.6 khi sếp có mặt; slack ×2.2 khi sếp vắng / ×0.6 khi có mặt — nội suy theo áp lực p
  let work = 1.2 * dil + 0.6 * p + (c.kpiBehind ? 0.5 * dil : 0)
    + (project && c.deadlineDays <= 1 ? 0.4 : 0);
  let slack = laz * (2.2 - 1.6 * p) + (a.stress > 70 ? 0.3 : 0) + (a.energy < 30 ? 0.2 : 0);
  if (c.wifiDown) slack *= 2;
  let nap = a.energy < 25 ? 0.3 + 0.8 * laz : (m >= hm(13) && m < hm(14, 30) ? 0.15 * laz : 0.02);
  let coffee = a.energy < 55 ? (55 - a.energy) / 40 : 0.05;
  if (c.sinceArrival < 25 && a.energy < 92) coffee += 0.35; // ly cà phê đầu ngày
  const water = 0.12;
  const snack = 0.1 + (a.mood < 40 ? 0.2 : 0);
  const toilet = 0.08 + 0.1 * laz;
  let pingpong = laz * (0.9 - 0.75 * p);
  let chill = laz * (0.6 - 0.5 * p) + (a.stress > 70 ? 0.2 : 0);
  let window = sales ? 0.5 : 0.05;
  const printing = a.role === 'hr' || sales ? 0.08 : 0;
  // v2 phòng trưng bày (docs/v2-contract.md §3): 0.08 · marketing 0.25 · +0.1 khi buồn (mood < 40)
  const showroom = (a.role === 'marketing' ? 0.25 : 0.08) + (a.mood < 40 ? 0.1 : 0);

  // Hôm qua KPI thấp / đã bị HR nhắc => cố gắng hơn, tỉ lệ theo độ chăm (dil²): người tử tế gỡ lại được,
  // người lười gần như không đổi (=> vòng cảnh cáo → đuổi việc có ý nghĩa)
  const heat = (a.lowStreak >= 1 ? 0.3 : 0) + (a.warnings > 0 ? 0.2 : 0);
  if (heat > 0) work += heat * 2.5 * dil * dil;

  if (c.breakTime) { // tranh thủ nốt giờ nghỉ trưa
    work *= 0.35;
    slack = slack * 1.3 + 0.35;
    chill += 0.2;
    pingpong += 0.1 * laz;
    nap += 0.1 * laz;
  }
  if (c.overtime) { // ở lại tối: chủ yếu làm cho xong
    pingpong *= 0.3;
    chill *= 0.5;
  }
  if (c.wifiDown) {
    window += 0.1;
    chill *= 1.5;
  }

  const out: Weighted<ActionKey>[] = [];
  const add = (key: ActionKey, w: number) => { if (w > 0.0001 && c.available(key)) out.push({ key, w }); };
  add('work', work);
  add('slack', slack);
  add('nap', nap);
  add('coffee', coffee);
  add('water', water);
  add('snack', snack);
  add('toilet', toilet);
  add('pingpong', pingpong);
  add('chill', chill);
  add('window', window);
  add('showroom', showroom);
  add('printing', printing);
  return out;
}

// ---------------------------------------------------------------- phòng trưng bày (v2)
export type ShowroomGroup = 'showroom_beauty' | 'showroom_tech';
export const SHOWROOM_GROUPS: readonly ShowroomGroup[] = ['showroom_beauty', 'showroom_tech'];

/** Kệ tương ứng với nhóm chỗ đứng / spotKey ('showroom_tech:1' → 'tech'); null nếu không phải chỗ trong phòng trưng bày */
export function showroomShelfOf(spotKeyOrGroup: string | null | undefined): 'beauty' | 'tech' | null {
  if (typeof spotKeyOrGroup !== 'string') return null;
  if (spotKeyOrGroup.startsWith('showroom_beauty')) return 'beauty';
  if (spotKeyOrGroup.startsWith('showroom_tech')) return 'tech';
  return null;
}

/**
 * Thứ tự kệ ưu tiên của một người (thử kệ đầu, hết chỗ thì sang kệ kia). Nữ nghiêng kệ làm đẹp, dev / designer /
 * QA nghiêng kệ công nghệ — nhưng không bao giờ tuyệt đối (kẹp 15%..85%) để ai cũng có lúc ngó kệ bên kia.
 */
export function showroomLean(a: Pick<AgentState, 'gender' | 'role'>): ShowroomGroup[] {
  let pBeauty = 0.5;
  if (a.gender === 'nữ') pBeauty += 0.3; else pBeauty -= 0.2;
  if (DEV_ROLES.has(a.role) || a.role === 'designer' || a.role === 'qa') pBeauty -= 0.25;
  if (a.role === 'marketing') pBeauty += 0.05;
  pBeauty = clamp(pBeauty, 0.15, 0.85);
  return chance(pBeauty) ? ['showroom_beauty', 'showroom_tech'] : ['showroom_tech', 'showroom_beauty'];
}

/** Trọng số cho sếp: chủ yếu ngồi phòng, thỉnh thoảng đi tuần */
export function bossWeights(c: UtilityCtx): Weighted<ActionKey>[] {
  const a = c.agent;
  const coffee = (a.energy < 55 ? (55 - a.energy) / 40 : 0.04) + (c.sinceArrival < 20 ? 0.25 : 0);
  const out: Weighted<ActionKey>[] = [];
  const add = (key: ActionKey, w: number) => { if (w > 0.0001 && c.available(key)) out.push({ key, w }); };
  add('boss_office', 1.0);
  add('patrol', c.sinceArrival < 10 ? 0 : 0.35);
  add('coffee', coffee);
  add('water', 0.06);
  add('toilet', 0.05);
  add('window', 0.04);
  add('snack', 0.02);
  return out;
}

/**
 * Thời lượng theo tính cách: người chăm tập trung lâu hơn, người lười lướt điện thoại lâu hơn
 * (bảng SPEC là mức trung bình; hệ số ≈ 1 với người "bình thường").
 */
export function personalDuration(key: ActionKey, a: AgentState, base: number): number {
  const dil = clamp(a.traits.diligence, 0, 1);
  const laz = clamp(a.traits.laziness, 0, 1);
  if (key === 'work') return base * (0.4 + 0.8 * dil);
  if (key === 'slack' || key === 'chill') return base * (0.6 + 0.6 * laz);
  return base;
}

export function pickWeighted<T>(items: readonly Weighted<T>[]): T | null {
  let total = 0;
  for (const it of items) total += it.w;
  if (!(total > 0)) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.key;
  }
  return items[items.length - 1].key;
}

// ---------------------------------------------------------------- nhãn / emote
export interface Flavor { label: string; emote: string }

const DEFAULT_FLAVOR: Partial<Record<Activity, Flavor[]>> = {
  working: [{ label: 'đang làm việc', emote: '💻' }],
  slacking: [
    { label: 'lướt TikTok', emote: '📱' }, { label: 'săn sale Shopee', emote: '🛒' },
    { label: 'chơi game điện thoại', emote: '🎮' }, { label: 'lướt Facebook', emote: '📱' },
  ],
  napping: [{ label: 'ngủ gật trên bàn', emote: '😴' }],
  coffee: [{ label: 'pha cà phê', emote: '☕' }],
  water: [{ label: 'lấy nước uống', emote: '🥤' }],
  snack: [{ label: 'lục tủ đồ ăn vặt', emote: '🍪' }],
  toilet: [{ label: 'đi vệ sinh', emote: '🚽' }],
  pingpong: [{ label: 'đánh bóng bàn', emote: '🏓' }],
  chill: [{ label: 'nằm sofa xem TV', emote: '🛋️' }],
  window: [{ label: 'hóng gió bên cửa sổ', emote: '🌬️' }],
  showroom: [
    { label: 'ngắm đồ ở phòng trưng bày', emote: '🛍️' }, { label: 'săm soi kệ công nghệ', emote: '🛍️' },
    { label: 'ngó kệ làm đẹp', emote: '🛍️' }, { label: 'cầm thử đồ trên kệ trưng bày', emote: '🛍️' },
  ],
  printing: [{ label: 'in tài liệu', emote: '🖨️' }],
  lunch: [{ label: 'ăn trưa', emote: '🍜' }],
  boss_office: [{ label: 'xem báo cáo trong phòng', emote: '📊' }],
  patrol: [{ label: 'đi tuần quanh văn phòng', emote: '👀' }],
  server_fix: [{ label: 'sửa server', emote: '🔥' }],
  meeting: [{ label: 'đang họp', emote: '🗓️' }],
  scene: [{ label: 'đang nói chuyện', emote: '💬' }],
  arriving: [{ label: 'vừa đến công ty', emote: '👋' }],
  leaving: [{ label: 'tan làm về nhà', emote: '👋' }],
  away: [{ label: 'đi vắng', emote: '🏌️' }],
  idle: [{ label: '', emote: '' }],
  offsite: [{ label: '', emote: '' }],
};

const validFlavor = (f: unknown): f is Flavor =>
  typeof f === 'object' && f !== null
  && typeof (f as Flavor).label === 'string' && (f as Flavor).label.trim() !== ''
  && typeof (f as Flavor).emote === 'string';

function contentFlavors(activity: Activity): Flavor[] {
  try {
    const list = (ACTIVITY_FLAVOR as Partial<Record<Activity, unknown>> | undefined)?.[activity];
    return Array.isArray(list) ? list.filter(validFlavor) : [];
  } catch {
    return [];
  }
}

const norm = (s: string): string => s.normalize('NFC').toLowerCase();

/** Độ hợp sở thích: nhãn có từ khoá trùng sở thích/thói quen/bio => hay chọn hơn */
function affinity(label: string, a?: AgentState): number {
  if (!a) return 1;
  const hay = norm([...(a.likes ?? []), ...(a.quirks ?? []), a.bio ?? ''].join(' '));
  let hits = 0;
  for (const w of norm(label).split(/[\s,./()-]+/)) {
    if (w.length >= 4 && hay.includes(w)) hits++;
  }
  return 1 + 2.5 * Math.min(2, hits);
}

export function workFlavor(a: AgentState): Flavor {
  const info = ROLE_INFO?.[a.role];
  const labels = Array.isArray(info?.workLabels) ? info.workLabels.filter((s) => typeof s === 'string' && s.trim()) : [];
  const emote = typeof info?.workEmote === 'string' && info.workEmote ? info.workEmote : '💻';
  return { label: pick(labels) ?? 'đang làm việc', emote };
}

export function slackFlavor(a?: AgentState): Flavor {
  let list: Flavor[] = [];
  try {
    list = Array.isArray(SLACK_ACTIVITIES) ? SLACK_ACTIVITIES.filter(validFlavor) : [];
  } catch { list = []; }
  if (!list.length) list = DEFAULT_FLAVOR.slacking!;
  return pickWeighted(list.map((f) => ({ key: f, w: affinity(f.label, a) }))) ?? list[0];
}

function windowFlavor(a?: AgentState): Flavor {
  const all = contentFlavors('window');
  if (a?.role === 'boss') return { label: 'gọi điện cho đối tác', emote: '📞' };
  if (a && SALES_ROLES.has(a.role)) {
    return pick(all.filter((f) => f.emote.includes('📞'))) ?? { label: 'gọi điện chăm sóc khách hàng', emote: '📞' };
  }
  return pick(all.filter((f) => !f.emote.includes('📞'))) ?? DEFAULT_FLAVOR.window![0];
}

const SHOWROOM_SHELF_FLAVOR: Record<'beauty' | 'tech', Flavor[]> = {
  beauty: [
    { label: 'ngó kệ làm đẹp ở phòng trưng bày', emote: '🛍️' }, { label: 'săm soi mấy món skincare trên kệ', emote: '🛍️' },
    { label: 'thử son ở kệ làm đẹp', emote: '💄' }, { label: 'đọc nhận xét của chủ shop về kệ làm đẹp', emote: '🛍️' },
  ],
  tech: [
    { label: 'săm soi kệ công nghệ', emote: '🛍️' }, { label: 'cầm thử đồ trên kệ công nghệ', emote: '🎧' },
    { label: 'ngắm đồ công nghệ ở phòng trưng bày', emote: '🛍️' }, { label: 'so giá mấy món trên kệ công nghệ', emote: '🛍️' },
  ],
};
const SHELF_WORDS: Record<'beauty' | 'tech', RegExp> = {
  beauty: /làm đẹp|son|skincare|mỹ phẩm|kem|dưỡng/i,
  tech: /công nghệ|tai nghe|bàn phím|chuột|sạc|màn hình|gadget/i,
};

/** Nhãn + emote khi đứng ngắm một kệ cụ thể: ưu tiên ACTIVITY_FLAVOR.showroom (lọc theo kệ nếu khớp), rồi dự phòng theo kệ */
export function showroomFlavor(a: AgentState | undefined, shelf: 'beauty' | 'tech' | null): Flavor {
  const content = contentFlavors('showroom');
  if (shelf) {
    const matching = content.filter((f) => SHELF_WORDS[shelf].test(f.label));
    const pool = matching.length ? matching : SHOWROOM_SHELF_FLAVOR[shelf];
    const fl = pickWeighted(pool.map((f) => ({ key: f, w: affinity(f.label, a) }))) ?? pool[0];
    return { label: fl.label, emote: fl.emote || '🛍️' };
  }
  const fl = pick(content) ?? pick(DEFAULT_FLAVOR.showroom!) ?? { label: 'ngắm đồ ở phòng trưng bày', emote: '🛍️' };
  return { label: fl.label, emote: fl.emote || '🛍️' };
}

/** Nhãn + emote cho một hoạt động (ưu tiên nội dung từ catalog, có dự phòng) */
export function flavorFor(activity: Activity, a?: AgentState): Flavor {
  if (activity === 'working' && a) return workFlavor(a);
  if (activity === 'slacking') return slackFlavor(a);
  if (activity === 'window') return windowFlavor(a);
  if (activity === 'showroom') return showroomFlavor(a, showroomShelfOf(a?.spotKey));
  return pick(contentFlavors(activity)) ?? pick(DEFAULT_FLAVOR[activity] ?? []) ?? { label: '', emote: '' };
}

// ---------------------------------------------------------------- hướng nhìn
const FACING_OVERRIDE: Record<string, Dir> = {
  lounge: 'up', boss_visit: 'up', server: 'up', window: 'down',
  coffee: 'right', water: 'right', fridge: 'right', entrance: 'right',
  // v2: quay mặt lên kệ trưng bày (cách 1 hàng) / vào cửa WC
  showroom_beauty: 'up', showroom_tech: 'up', toilet: 'up',
};

const isFurniture = (x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !isWalkable(x, y) && WALLS[y][x] !== '#';

/** Hướng nhìn khi đứng/ngồi ở ô p: quay về phía đồ vật kế bên (bàn, máy pha cà phê...) */
export function facingAt(p: Pt, group?: string): Dir {
  if (group && FACING_OVERRIDE[group]) return FACING_OVERRIDE[group];
  const order: [Dir, number, number][] = [['up', 0, -1], ['left', -1, 0], ['right', 1, 0], ['down', 0, 1]];
  for (const [d, dx, dy] of order) if (isFurniture(p.x + dx, p.y + dy)) return d;
  return 'down';
}

export function dirOf(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Ghế bàn: hướng nhìn vào bàn */
export function seatFacing(deskId: string): Dir {
  const d = DESKS[deskId];
  return d ? facingAt(d.seat) : 'up';
}

// ---------------------------------------------------------------- đi tuần
/** Bảng KPI — sếp hay dừng lại xem */
export const KPI_BOARD_STOP: Pt = SPOTS.kpi_board?.[1] ?? { x: 31, y: 21 };

const PATROL_ROUTES: Pt[][] = [
  // dãy bàn dev
  [{ x: 47, y: 15 }, { x: 38, y: 11 }, { x: 26, y: 11 }, { x: 16, y: 11 }, { x: 16, y: 17 }, KPI_BOARD_STOP, { x: 47, y: 16 }],
  // dãy bàn sales / marketing
  [{ x: 47, y: 16 }, { x: 38, y: 17 }, { x: 25, y: 23 }, { x: 15, y: 23 }, { x: 9, y: 17 }, { x: 30, y: 17 }, { x: 47, y: 15 }],
  // "khu vui chơi": bóng bàn, pantry, góc chill
  [{ x: 53, y: 14 }, { x: 46, y: 26 }, { x: 36, y: 27 }, { x: 25, y: 23 }, KPI_BOARD_STOP, { x: 47, y: 16 }],
  // vòng lớn
  [{ x: 47, y: 15 }, { x: 30, y: 17 }, { x: 16, y: 17 }, { x: 7, y: 14 }, { x: 5, y: 26 }, { x: 25, y: 23 }, { x: 36, y: 27 }, { x: 47, y: 20 }],
];

/** Một lộ trình đi tuần ngẫu nhiên (bản sao, đã lọc ô đi được) */
export function patrolRoute(): Pt[] {
  const base = pick(PATROL_ROUTES) ?? PATROL_ROUTES[0];
  let route = base.filter((p) => isWalkable(p.x, p.y)).map((p) => ({ x: p.x, y: p.y }));
  // bỏ ngẫu nhiên một điểm giữa cho đỡ lặp
  if (route.length > 4 && chance(0.5)) route.splice(1 + Math.floor(Math.random() * (route.length - 2)), 1);
  if (!route.length) route = [{ x: 30, y: 17 }];
  return route;
}

// ---------------------------------------------------------------- nhãn đặc biệt
export const LABELS = {
  panic: { label: 'giả vờ làm việc', emote: '😰' },
  toiletHide: { label: 'trốn vào WC lướt điện thoại', emote: '🚽' },
  deskLunch: { label: 'ăn cơm hộp tại bàn', emote: '🍱' },
  bossLunch: { label: 'ăn trưa trong phòng', emote: '🍱' },
  lunchNap: { label: 'ngủ trưa', emote: '😴' },
  arrive: { label: 'vừa đến công ty', emote: '👋' },
  arriveLate: { label: 'đến trễ, lén lút vào chỗ', emote: '😅' },
  arriveBoss: { label: 'vừa đến công ty', emote: '👔' },
  backFromLunch: { label: 'ăn trưa xong quay về', emote: '😋' },
  bossBack: { label: 'vừa về tới công ty', emote: '🚗' },
  newDesk: { label: 'nhận bàn làm việc mới', emote: '🥳' },
  goHome: { label: 'tan làm về nhà', emote: '👋' },
  goHomeSharp: { label: 'canh đúng giờ là về', emote: '⏰' },
  goHomeOT: { label: 'tăng ca xong, về nhà', emote: '🌙' },
  goHomeForced: { label: 'bị bảo vệ nhắc về', emote: '🔦' },
  lunchOut: { label: 'rủ nhau ra ngoài ăn trưa', emote: '🍜' },
  fired: { label: 'ôm thùng đồ ra về', emote: '📦' },
  resigned: { label: 'nộp đơn nghỉ việc, chào mọi người ra về', emote: '👋' },
  laidOff: { label: 'bị cắt giảm, ôm thùng đồ ra về', emote: '📦' },
  dismissed: { label: 'chào mọi người ra về', emote: '🙇' },
  waitInterview: { label: 'đang chờ phỏng vấn', emote: '🙂' },
  kpiBoard: { label: 'đứng xem bảng KPI', emote: '📊' },
} satisfies Record<string, Flavor>;
