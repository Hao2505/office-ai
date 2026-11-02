// =====================================================================
//  HR (v3): hàng rào hợp lý cho quyết định nhân sự do AI đưa ra, hồ sơ xét duyệt,
//  chính sách offline ngẫu nhiên có trọng số, vị trí trống, hội đồng phỏng vấn.
//  Thuần logic — Director lo lịch và cảnh. Không có luật cứng "N ngày thấp thì đuổi" nữa:
//  KPI_WARN_DAYS / KPI_FIRE_DAYS chỉ còn là mốc tối thiểu của hàng rào + điểm neo cho
//  chính sách offline (càng vượt mốc, xác suất bị xử lý càng cao — nhưng không bao giờ 100%).
// =====================================================================
import type { AgentState, CandidateRequest, HrAction, HrDecision, RoleKey, WorldApi } from '../types.js';
import type { Config } from '../config.js';
import { ROLE_INFO, ROLE_ORDER } from '../content/roster.js';
import { DESKS } from './map.js';
import { isBiz, isTech, type HrDossierEntry } from './scenes.js';

export interface Vacancy {
  role: RoleKey;
  roleLabel: string;
  deskId: string;
  kpiTarget: number;
  replacingName?: string;
  /** số ứng viên đã bị loại cho vị trí này */
  rejections: number;
  /** ngày bắt đầu trống */
  since: number;
  /** v3: vị trí MỚI (open_position) — không thay ai, được giữ dù vai trò đã có người */
  extra?: boolean;
}

export const HR_ACTIONS: HrAction[] = ['warn', 'fire', 'second_chance', 'probation', 'praise', 'bonus', 'promote', 'open_position', 'layoff', 'none'];
export const isHrAction = (v: unknown): v is HrAction => typeof v === 'string' && (HR_ACTIONS as string[]).includes(v);

export const ACTION_LABEL: Record<HrAction, string> = {
  warn: 'nhắc nhở KPI', fire: 'cho nghỉ việc', second_chance: 'cho cơ hội thứ hai', probation: 'đưa vào diện thử thách',
  praise: 'khen trước sếp', bonus: 'thưởng nóng', promote: 'thăng chức', open_position: 'mở thêm vị trí', layoff: 'cắt giảm', none: 'không làm gì',
};

const NEVER_FIRED: RoleKey[] = ['boss', 'hr'];
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** nhân viên có thể bị HR xử lý (không phải sếp/HR, đang làm chính thức) */
export function hrEligible(a: AgentState | undefined): a is AgentState {
  return !!a && a.status === 'active' && !NEVER_FIRED.includes(a.role);
}

// ---------------------------------------------------------------- sổ HR (Director giữ + lưu)
export interface HrLedger {
  lastReviewDay: number;
  /** ngày đã đếm kỳ doanh thu (không đếm 2 lần khi cảnh họp bị gián đoạn rồi diễn lại) */
  lastRevenueCheckDay: number;
  /** ngày đuổi / cắt giảm gần nhất (ghi khi cảnh cho nghỉ THẬT SỰ diễn xong) — tối đa 1 lần mỗi 2 ngày game (toàn công ty) */
  lastFireDay: number;
  /** ngày thăng chức gần nhất (ghi khi cảnh thăng chức diễn xong) — tối đa 1 lần mỗi 7 ngày (toàn công ty) */
  lastPromotionDay: number;
  /** ngày thưởng nóng gần nhất cho BẤT KỲ ai — docs/v3-news.md: không thưởng 2 người cùng tuần */
  lastBonusAnyDay: number;
  /** số kỳ xét liên tiếp doanh thu < 50% mục tiêu (≥ 2 → được phép cắt giảm) */
  lowRevenuePeriods: number;
  /** ngày của các đợt cắt giảm gần đây (≤ MAX_LAYOFFS_PER_MONTH trong MONTH_DAYS) */
  layoffDays: number[];
  lastBonusDay: Record<string, number>;
  lastPraiseDay: Record<string, number>;
  lastWarnDay: Record<string, number>;
  lastRaiseAskDay: Record<string, number>;
  /** ngày xin tăng lương bị từ chối gần nhất (để lần sau "lần trước đã xin và bị từ chối") */
  raiseDeniedDay: Record<string, number>;
  lastResignTalkDay: Record<string, number>;
  /** số ngày liên tiếp "chán việc" cuối ngày (mood < 40, stress > 70, ghét sếp ≤ −20, hoặc bị nhắc mà KPI vẫn thấp) */
  lowMoodDays: Record<string, number>;
  /** vai trò bị đóng băng tuyển dụng tới ngày N (sau cắt giảm) */
  frozenRoles: Partial<Record<RoleKey, number>>;
  /** vùng doanh thu lần kiểm cuối (low / ok / high) — để chỉ họp sớm khi vùng đổi */
  lastRevenueZone: RevenueZone;
  /** số lần họp liên tiếp không chốt gì (chính sách offline: họp mãi mà không làm gì thì HR sốt ruột dần) */
  idleReviews: number;
  reviews: number;
  decisions: number;
  rejected: number;
}

export function newLedger(): HrLedger {
  return {
    lastReviewDay: 0, lastRevenueCheckDay: -99, lastFireDay: -99, lastPromotionDay: -99, lastBonusAnyDay: -99, lowRevenuePeriods: 0, layoffDays: [],
    lastBonusDay: {}, lastPraiseDay: {}, lastWarnDay: {}, lastRaiseAskDay: {}, raiseDeniedDay: {}, lastResignTalkDay: {}, lowMoodDays: {},
    frozenRoles: {}, lastRevenueZone: 'ok', idleReviews: 0, reviews: 0, decisions: 0, rejected: 0,
  };
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 60)) if (typeof x === 'number' && Number.isFinite(x) && k.length <= 80) out[k] = clamp(x, -1e6, 1e7);
  return out;
}

export function restoreLedger(raw: unknown): HrLedger {
  const l = newLedger();
  if (!isObj(raw)) return l;
  l.lastReviewDay = Math.floor(fin(raw.lastReviewDay, 0));
  l.lastRevenueCheckDay = Math.floor(fin(raw.lastRevenueCheckDay, -99));
  l.lastRevenueZone = raw.lastRevenueZone === 'low' || raw.lastRevenueZone === 'high' ? raw.lastRevenueZone : 'ok';
  l.idleReviews = clamp(Math.floor(fin(raw.idleReviews, 0)), 0, 99);
  l.lastFireDay = Math.floor(fin(raw.lastFireDay, -99));
  l.lastPromotionDay = Math.floor(fin(raw.lastPromotionDay, -99));
  l.lastBonusAnyDay = Math.floor(fin(raw.lastBonusAnyDay, -99));
  l.lowRevenuePeriods = clamp(Math.floor(fin(raw.lowRevenuePeriods, 0)), 0, 99);
  l.layoffDays = (Array.isArray(raw.layoffDays) ? raw.layoffDays : []).filter((d): d is number => typeof d === 'number' && Number.isFinite(d)).map(Math.floor).slice(-10);
  l.lastBonusDay = numRecord(raw.lastBonusDay);
  l.lastPraiseDay = numRecord(raw.lastPraiseDay);
  l.lastWarnDay = numRecord(raw.lastWarnDay);
  l.lastRaiseAskDay = numRecord(raw.lastRaiseAskDay);
  l.raiseDeniedDay = numRecord(raw.raiseDeniedDay);
  l.lastResignTalkDay = numRecord(raw.lastResignTalkDay);
  l.lowMoodDays = numRecord(raw.lowMoodDays);
  const fr = numRecord(raw.frozenRoles);
  for (const [k, v] of Object.entries(fr)) if ((ROLE_ORDER as string[]).includes(k)) l.frozenRoles[k as RoleKey] = v;
  l.reviews = clamp(Math.floor(fin(raw.reviews, 0)), 0, 1e9);
  l.decisions = clamp(Math.floor(fin(raw.decisions, 0)), 0, 1e9);
  l.rejected = clamp(Math.floor(fin(raw.rejected, 0)), 0, 1e9);
  return l;
}

/** bỏ bản ghi của người không còn trong công ty (sổ không phình) */
export function pruneLedger(l: HrLedger, exists: (id: string) => boolean): void {
  for (const rec of [l.lastBonusDay, l.lastPraiseDay, l.lastWarnDay, l.lastRaiseAskDay, l.raiseDeniedDay, l.lastResignTalkDay, l.lowMoodDays]) {
    for (const id of Object.keys(rec)) if (!exists(id)) delete rec[id];
  }
}

// ---------------------------------------------------------------- số liệu
/** tỉ lệ KPI các ngày gần nhất (cũ → mới), chỉ lấy ngày có số */
export function kpiRatios(a: AgentState, days = 7): number[] {
  const h = Array.isArray(a.kpiHistory) ? a.kpiHistory : [];
  return h.slice(-days).map((x) => fin(x?.ratio, NaN)).filter((x) => Number.isFinite(x) && x >= 0);
}

/** trung bình KPI 7 ngày (null nếu chưa có ngày nào) */
export function avgRatio(a: AgentState, days = 7): number | null {
  const r = kpiRatios(a, days);
  return r.length ? r.reduce((s, x) => s + x, 0) / r.length : null;
}

/** tóm tắt thái độ từ ký ức gần nhất (≤ 160 ký tự); `day` để chỉ nhắc thử thách CÒN hiệu lực */
export function attitudeOf(a: AgentState, max = 160, day?: number): string {
  const mem = Array.isArray(a.memories) ? a.memories.slice(-3).map((m) => String(m?.text ?? '').trim()).filter(Boolean) : [];
  const bits: string[] = [];
  if (fin(a.caughtToday) > 0) bits.push(`bị bắt lười ${a.caughtToday} lần hôm nay`);
  if (fin(a.mood, 60) < 30) bits.push('tâm trạng rất tệ');
  else if (fin(a.mood, 60) > 80) bits.push('đang rất vui');
  if (fin(a.stress, 30) > 70) bits.push('stress cao');
  const until = a.probationUntilDay;
  if (typeof until === 'number' && Number.isFinite(until) && (day === undefined || until >= day)) bits.push(`đang thử thách tới ngày ${until}`);
  const s = [...bits, ...mem].join('; ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export interface GuardEnv {
  day: number;
  /** số nhân viên đang làm (active) */
  headcount: number;
  /** đang có vị trí trống chờ tuyển */
  hasOpenPosition: boolean;
  /** còn bàn trống cho người thứ N+1 */
  freeDesk: boolean;
  /** doanh thu tháng / mục tiêu */
  revenueRatio: number;
  /** đang có cảnh cho nghỉ / cắt giảm chờ diễn (đã chốt nhưng chưa xong) → không chốt thêm ai */
  firePending?: boolean;
  /** đang có cảnh thăng chức chờ diễn */
  promotionPending?: boolean;
}

/** tối đa bấy nhiêu đợt cắt giảm trong một tháng game (MONTH_DAYS ngày) */
export const MAX_LAYOFFS_PER_MONTH = 2;
/** người mới vào chưa đủ bấy nhiêu ngày thì không bị cắt giảm (vừa tuyển xong lại cắt là vô lý) */
export const LAYOFF_MIN_TENURE = 10;
export const layoffsInMonth = (l: HrLedger, day: number): number => l.layoffDays.filter((d) => day - d < MONTH_DAYS && day - d >= 0).length;

/**
 * HÀNG RÀO HỢP LÝ (code, không phải AI): hành động nào được phép với một người lúc này.
 *   fire          lowStreak ≥ 2 VÀ (warnings ≥ 1 HOẶC lowStreak ≥ KPI_FIRE_DAYS) VÀ vào làm ≥ 3 ngày VÀ chưa đuổi/cắt ai trong 2 ngày
 *   warn          lowStreak ≥ 1
 *   probation     lowStreak ≥ 1 và chưa trong diện thử thách
 *   second_chance lowStreak ≥ 1 hoặc warnings ≥ 1
 *   praise        KPI trung bình 7 ngày ≥ 1.0 (≥ 2 ngày số liệu), chưa được khen 3 ngày và chưa được thưởng 2 ngày
 *   bonus         KPI trung bình 7 ngày ≥ 1.0 (≥ 2 ngày số liệu), người đó chưa được thưởng trong 7 ngày VÀ công ty chưa thưởng ai
 *                 trong 7 ngày (không thưởng 2 người cùng tuần)
 *   promote       KPI trung bình ≥ 1.15 trên ≥ 5 ngày, thâm niên ≥ 10 ngày, toàn công ty ≤ 1 lần / 7 ngày, không có cảnh thăng chức đang chờ
 *   layoff        doanh thu < 50% nhịp mục tiêu 2 kỳ xét liên tiếp (kỳ = cách nhau ≥ HR_REVIEW_EVERY_DAYS), thâm niên ≥ LAYOFF_MIN_TENURE (10),
 *                 cùng cap 1 lần / 2 ngày với fire, ≤ MAX_LAYOFFS_PER_MONTH (2) đợt mỗi tháng game
 *   (fire / layoff đều bị khoá khi đang có cảnh cho nghỉ / cắt giảm chờ diễn — firePending)
 *   open_position doanh thu ≥ 80% nhịp mục tiêu, headcount < 12, chưa có vị trí trống, còn bàn trống
 *   none          luôn được phép
 */
export function allowedActions(a: AgentState, cfg: Config, l: HrLedger, env: GuardEnv): HrAction[] {
  const out: HrAction[] = ['none'];
  if (!hrEligible(a)) return out;
  const day = env.day;
  const streak = fin(a.lowStreak);
  const warnings = fin(a.warnings);
  const tenure = day - fin(a.hiredDay, 1);
  const ratios = kpiRatios(a, 7);
  const avg = ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : null;
  const fireCapOk = day - l.lastFireDay >= 2 && !env.firePending;
  const onProbation = typeof a.probationUntilDay === 'number' && a.probationUntilDay > day;
  if (streak >= 1) out.push('warn');
  if (streak >= 1 || warnings >= 1) out.push('second_chance');
  if (streak >= 1 && !onProbation) out.push('probation');
  if (streak >= 2 && (warnings >= 1 || streak >= fin(cfg.kpiFireDays, 3)) && tenure >= 3 && fireCapOk) out.push('fire');
  if (avg !== null && ratios.length >= 2 && avg >= 1.0) {
    const sinceBonus = day - (l.lastBonusDay[a.id] ?? -99);
    if (sinceBonus >= 2 && day - (l.lastPraiseDay[a.id] ?? -99) >= 3) out.push('praise');
    if (sinceBonus >= 7 && day - fin(l.lastBonusAnyDay, -99) >= 7) out.push('bonus');
  }
  if (avg !== null && ratios.length >= 5 && avg >= 1.15 && tenure >= 10 && day - l.lastPromotionDay >= 7 && !env.promotionPending) out.push('promote');
  if (l.lowRevenuePeriods >= 2 && fireCapOk && tenure >= LAYOFF_MIN_TENURE && layoffsInMonth(l, day) < MAX_LAYOFFS_PER_MONTH) out.push('layoff');
  if (env.revenueRatio >= 0.8 && env.headcount < 12 && !env.hasOpenPosition && env.freeDesk) out.push('open_position');
  return out;
}

/** hồ sơ từng nhân viên (không gồm sếp / HR) để AI quyết — allowed đã lọc theo hàng rào */
export function buildDossier(w: WorldApi, cfg: Config, l: HrLedger, env: GuardEnv): HrDossierEntry[] {
  const out: HrDossierEntry[] = [];
  for (const a of w.agents()) {
    if (!hrEligible(a)) continue;
    out.push({
      id: a.id, name: a.name, roleLabel: a.roleLabel,
      kpiRatios: kpiRatios(a, 7).map((x) => Math.round(x * 100) / 100),
      lowStreak: fin(a.lowStreak), warnings: fin(a.warnings), caughtToday: fin(a.caughtToday), hiredDay: fin(a.hiredDay, 1),
      mood: Math.round(fin(a.mood, 60)), stress: Math.round(fin(a.stress, 30)),
      attitude: attitudeOf(a, 160, env.day),
      allowed: allowedActions(a, cfg, l, env),
    });
  }
  // người đáng lo trước, rồi người nổi bật
  out.sort((x, y) => (y.lowStreak + y.warnings) - (x.lowStreak + x.warnings));
  return out;
}

/** vì sao cần họp sớm (rỗng = chỉ họp định kỳ) */
export function reviewTriggers(w: WorldApi, l: HrLedger): string[] {
  const out: string[] = [];
  for (const a of w.agents()) {
    if (!hrEligible(a)) continue;
    if (fin(a.lowStreak) >= 2) out.push(`${a.name} KPI thấp ${a.lowStreak} ngày liền`);
    else if (fin(a.warnings) >= 1 && fin(a.lowStreak) >= 1) out.push(`${a.name} đã bị nhắc mà KPI vẫn thấp`);
    if ((l.lowMoodDays[a.id] ?? 0) >= 3) out.push(`${a.name} chán việc ${l.lowMoodDays[a.id]} ngày liền`);
  }
  return out.slice(0, 6);
}

/** lý do họp sớm vì doanh thu — chỉ khi vùng doanh thu ĐỔI (một lần mỗi lần rơi xuống / vượt lên), không lặp mỗi ngày */
export function revenueTrigger(w: WorldApi, l: HrLedger): string | null {
  const ratio = revenueRatio(w);
  const zone = revenueZone(ratio);
  const prev = l.lastRevenueZone;
  l.lastRevenueZone = zone;
  if (zone === prev || zone === 'ok') return null;
  return zone === 'low'
    ? `doanh thu rơi xuống ${Math.round(ratio * 100)}% nhịp mục tiêu`
    : `doanh thu vượt ${Math.round(ratio * 100)}% nhịp mục tiêu`;
}

/** khớp World: doanh thu tháng reset mỗi 20 ngày game (MONTH_DAYS, trùng ngày lương) */
export const MONTH_DAYS = 20;

/**
 * Doanh thu so với NHỊP mục tiêu: revenueMonth / (mục tiêu × phần tháng đã trôi qua). Ngày 1–2 coi như ngày 2 để không
 * ai bị "doanh thu 0%" chỉ vì tháng mới bắt đầu. 1.0 = đúng nhịp; < 0.5 kém; > 1.2 vượt.
 */
export function revenueRatio(w: WorldApi): number {
  const c = w.company();
  if (!c || !(fin(c.revenueTarget) > 0)) return 1;
  const dayInMonth = ((Math.max(1, Math.floor(fin(w.day(), 1))) - 1) % MONTH_DAYS) + 1;
  const expected = c.revenueTarget * (Math.max(dayInMonth, 2) / MONTH_DAYS);
  return expected > 0 ? fin(c.revenueMonth) / expected : 1;
}

export type RevenueZone = 'low' | 'ok' | 'high';
export const revenueZone = (ratio: number): RevenueZone => (ratio < 0.5 ? 'low' : ratio > 1.2 ? 'high' : 'ok');

/** bàn trống (không ai active/candidate ngồi, không vị trí trống nào đang giữ) — cho open_position */
export function freeDesks(w: WorldApi, vacancies: Vacancy[]): string[] {
  const taken = new Set<string>();
  for (const a of w.agents()) if (a.status === 'active' || a.status === 'candidate') taken.add(a.deskId);
  for (const v of vacancies) taken.add(v.deskId);
  return Object.keys(DESKS).filter((id) => !taken.has(id));
}

// ---------------------------------------------------------------- kiểm tra quyết định của AI
export interface DecisionCheck {
  applied: HrDecision[];
  rejected: { d: HrDecision; why: string }[];
}

/** tối đa bấy nhiêu quyết định (khác none) được thi hành trong 1 lần họp */
export const MAX_DECISIONS = 4;

/**
 * Lọc quyết định: hành động phải nằm trong allowed của người đó (none luôn qua); mỗi người 1 quyết định;
 * ≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise/bonus mỗi lần họp; open_position là quyết định chung (id có thể rỗng).
 */
export function validateDecisions(raw: unknown, dossier: HrDossierEntry[]): DecisionCheck {
  const applied: HrDecision[] = [];
  const rejected: { d: HrDecision; why: string }[] = [];
  if (!Array.isArray(raw)) return { applied, rejected };
  const byId = new Map(dossier.map((d) => [d.id, d]));
  const openOk = dossier.some((d) => d.allowed.includes('open_position'));
  const seen = new Set<string>();
  let firings = 0, promotions = 0, rewards = 0, opened = 0;
  for (const x of raw.slice(0, 12)) {
    if (!isObj(x) || !isHrAction(x.action)) continue;
    const d: HrDecision = {
      id: typeof x.id === 'string' ? x.id.trim().slice(0, 80) : '',
      action: x.action,
      reason: typeof x.reason === 'string' ? x.reason.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    };
    if (d.action === 'none') continue;
    if (d.action === 'open_position') {
      if (!openOk) { rejected.push({ d, why: 'chưa đủ điều kiện mở thêm vị trí (doanh thu / số người / bàn trống)' }); continue; }
      if (opened >= 1) { rejected.push({ d, why: 'mỗi lần họp chỉ mở 1 vị trí' }); continue; }
      opened++;
      applied.push(d);
      continue;
    }
    const entry = byId.get(d.id);
    if (!entry) { rejected.push({ d, why: 'không có người này trong danh sách xét' }); continue; }
    if (seen.has(d.id)) { rejected.push({ d, why: `${entry.name} đã có quyết định rồi` }); continue; }
    if (!entry.allowed.includes(d.action)) { rejected.push({ d, why: `${ACTION_LABEL[d.action]} ${entry.name} chưa đủ căn cứ theo hàng rào` }); continue; }
    if ((d.action === 'fire' || d.action === 'layoff') && firings >= 1) { rejected.push({ d, why: 'mỗi lần họp chỉ cho nghỉ tối đa 1 người' }); continue; }
    if (d.action === 'promote' && promotions >= 1) { rejected.push({ d, why: 'mỗi lần họp chỉ thăng chức 1 người' }); continue; }
    if ((d.action === 'praise' || d.action === 'bonus') && rewards >= 2) { rejected.push({ d, why: 'khen/thưởng tối đa 2 người mỗi lần họp' }); continue; }
    if (applied.length >= MAX_DECISIONS) { rejected.push({ d, why: `quá ${MAX_DECISIONS} quyết định một lần họp` }); continue; }
    if (d.action === 'fire' || d.action === 'layoff') firings++;
    if (d.action === 'promote') promotions++;
    if (d.action === 'praise' || d.action === 'bonus') rewards++;
    seen.add(d.id);
    applied.push(d);
  }
  return { applied, rejected };
}

// ---------------------------------------------------------------- chính sách offline (không AI): ngẫu nhiên có trọng số
const REASONS: Record<HrAction, string[]> = {
  warn: ['KPI thấp mấy ngày liền, cần nhắc trước khi quá muộn', 'số liệu đi xuống rõ, nhắc nhở cho tỉnh', 'để lâu thành thói quen, nhắc sớm còn kịp'],
  fire: ['đã nhắc mà không cải thiện, công ty không gánh được nữa', 'KPI thấp kéo dài, sếp hết kiên nhẫn', 'nhắc rồi, thử thách rồi, vẫn vậy'],
  second_chance: ['có vẻ đang gặp chuyện riêng, cho thêm thời gian', 'thái độ còn tốt, chưa nên mạnh tay', 'mới sa sút gần đây, chờ thêm vài ngày'],
  probation: ['đặt mốc rõ ràng để tự xoay chuyển', 'cho một tuần để chứng minh', 'không ép nhưng phải có hạn'],
  praise: ['làm rất đều, nên được ghi nhận trước mặt sếp', 'KPI dẫn đầu nhiều ngày, khen để giữ lửa', 'xứng đáng được nhắc tên'],
  bonus: ['KPI vượt mục tiêu liên tục, thưởng nóng cho có động lực', 'công ty có lãi, chia chút cho người kéo số', 'giữ người giỏi bằng tiền thật'],
  promote: ['đã gánh team từ lâu, lên chức cho xứng', 'KPI vượt trội cả tuần, thăng chức tạo gương', 'cần người đứng mũi chịu sào, đây là lựa chọn hợp lý'],
  open_position: ['việc nhiều hơn người, cần tuyển thêm', 'doanh thu tốt, mở thêm vị trí để mở rộng', 'team quá tải, thêm một người'],
  layoff: ['doanh thu kém hai kỳ liền, buộc phải cắt chi phí', 'không gánh nổi quỹ lương, đau nhưng phải làm', 'tái cấu trúc, vị trí này tạm bỏ'],
  none: ['chưa cần động tới ai'],
};

const pickReason = (a: HrAction): string => REASONS[a][Math.floor(Math.random() * REASONS[a].length)];

interface Weighted { action: HrAction; w: number }

function pickWeighted(list: Weighted[]): HrAction {
  const total = list.reduce((s, x) => s + Math.max(0, x.w), 0);
  if (total <= 0) return 'none';
  let r = Math.random() * total;
  for (const x of list) {
    r -= Math.max(0, x.w);
    if (r <= 0) return x.action;
  }
  return list[list.length - 1]?.action ?? 'none';
}

/**
 * Quyết định khi không có AI: với mỗi người, chọn ngẫu nhiên trong các hành động được phép theo trọng số
 * leo thang quanh KPI_WARN_DAYS / KPI_FIRE_DAYS (càng vượt mốc, càng dễ bị nhắc / cho nghỉ; người làm tốt
 * có cơ hội được khen / thưởng). Không bao giờ chắc chắn 100% — ai bị, khi nào bị là chuyện ngẫu nhiên.
 */
export function offlineDecisions(dossier: HrDossierEntry[], cfg: Config, env: { revenueRatio: number; idleReviews?: number }): HrDecision[] {
  const out: HrDecision[] = [];
  const warnDays = Math.max(1, fin(cfg.kpiWarnDays, 2));
  const fireDays = Math.max(warnDays, fin(cfg.kpiFireDays, 3));
  // họp liên tiếp mà không chốt gì → lần sau dễ "làm một việc gì đó" hơn (vẫn ngẫu nhiên, vẫn trong allowed)
  const idle = clamp(Math.floor(fin(env.idleReviews, 0)), 0, 3);
  const pressure = 1 + idle;
  let firings = 0, promotions = 0, rewards = 0, opened = 0;
  for (const d of dossier) {
    if (out.length >= 3) break;
    const can = new Set(d.allowed);
    const avg = d.kpiRatios.length ? d.kpiRatios.reduce((s, x) => s + x, 0) / d.kpiRatios.length : null;
    const overWarn = d.lowStreak - warnDays;
    const overFire = d.lowStreak - fireDays;
    const trouble = d.lowStreak >= 1 || d.warnings >= 1;
    // người làm tốt: phần lớn các kỳ không ai nhắc tới (khen/thưởng là chuyện hiếm, có thì mới quý)
    const list: Weighted[] = [{ action: 'none', w: trouble ? 1.0 : idle ? 1.5 : 2.5 }];
    if (can.has('warn')) {
      list.push({ action: 'warn', w: d.warnings === 0 ? (overWarn >= 0 ? 1.5 + 1.0 * (overWarn + 1) : 0.35) : 0.4 });
    }
    if (can.has('probation')) list.push({ action: 'probation', w: overWarn >= 0 ? 0.5 + (d.warnings >= 1 ? 0.5 : 0) : 0.15 });
    if (can.has('second_chance')) list.push({ action: 'second_chance', w: 0.3 });
    if (can.has('fire') && firings < 1) {
      list.push({ action: 'fire', w: d.warnings >= 1 ? 2.5 + 2.5 * Math.max(0, overFire) + 1.0 * (d.warnings - 1) : 0.6 + 0.6 * Math.max(0, overFire) });
    }
    if (can.has('layoff') && firings < 1) list.push({ action: 'layoff', w: 1.2 });
    if (can.has('praise') && rewards < 1) list.push({ action: 'praise', w: 0.45 });
    if (can.has('bonus') && rewards < 1) list.push({ action: 'bonus', w: env.revenueRatio >= 0.9 ? 0.3 : 0.1 });
    if (can.has('promote') && promotions < 1) list.push({ action: 'promote', w: 0.6 });
    if (can.has('open_position') && opened < 1) list.push({ action: 'open_position', w: 0.35 });
    for (const x of list) if (x.action !== 'none') x.w *= pressure;
    const action = pickWeighted(list);
    if (action === 'none') continue;
    if (action === 'fire' || action === 'layoff') firings++;
    if (action === 'promote') promotions++;
    if (action === 'praise' || action === 'bonus') rewards++;
    if (action === 'open_position') opened++;
    out.push({ id: action === 'open_position' ? '' : d.id, action, reason: pickReason(action) });
  }
  return out;
}

// ---------------------------------------------------------------- thăng chức: nhãn mới + chỉ tiêu mới
export function promotedLabel(a: AgentState): string {
  const cur = String(a.roleLabel ?? '').trim();
  if (/Trưởng nhóm|Trưởng phòng|Lead/i.test(cur)) return /cấp cao/i.test(cur) ? cur : `${cur} cấp cao`;
  if (/\(Senior\)/i.test(cur) || /^Senior/i.test(cur)) return `${cur.replace(/\s*\(Senior\)/i, '')} (Trưởng nhóm)`;
  if (/^Fresher\s+/i.test(cur)) return cur.replace(/^Fresher\s+/i, '');
  if (/^Nhân viên\s+/i.test(cur)) return cur.replace(/^Nhân viên\s+/i, 'Chuyên viên ');
  return `${cur} (Senior)`;
}

export function promotedTarget(a: AgentState, pct = 0.1): number {
  const base = fin(a.kpiTarget, ROLE_INFO[a.role]?.kpiTarget ?? 260);
  return Math.round(base * (1 + pct));
}

// ---------------------------------------------------------------- giờ làm / hiệu suất (giữ từ v2)
/** Phần giờ hành chính (08:00–17:30, trừ trưa) đã trôi qua trong ngày, 0..1 */
export function workdayElapsed(minuteOfDay: number): number {
  const m = fin(minuteOfDay, 0);
  const lunch = Math.max(0, Math.min(m, 780) - 720);
  return Math.max(0, Math.min(1, (Math.min(m, 1050) - 480 - lunch) / 510));
}

/**
 * Hiệu suất để HR "xét" một người: KPI hôm nay so với tiến độ kỳ vọng tới giờ này,
 * pha 30% KPI hôm qua; sáng sớm (chưa ai kịp làm) thì xét theo hôm qua.
 */
export function performance(a: AgentState, minuteOfDay: number): number {
  const last = Array.isArray(a.kpiHistory) ? a.kpiHistory[a.kpiHistory.length - 1]?.ratio : undefined;
  const prev = typeof last === 'number' && Number.isFinite(last) ? last : null;
  const exp = workdayElapsed(minuteOfDay);
  if (exp < 0.15 || !(a.kpiTarget > 0)) return prev ?? 1;
  const today = fin(a.kpiToday) / (a.kpiTarget * exp);
  return prev === null ? today : 0.7 * today + 0.3 * prev;
}

/** người kém nhất đang có mặt (dùng cho tình huống / mầm chuyện; không còn quyết định đuổi) */
export function lowestPerformer(w: WorldApi): AgentState | null {
  const all = w.activeAgents().filter((a) => hrEligible(a));
  const veterans = all.filter((a) => !(fin(a.hiredDay, 0) > 1 && fin(a.hiredDay, 0) >= w.day()));
  const pool = veterans.length ? veterans : all;
  if (!pool.length) return null;
  const m = w.minuteOfDay();
  pool.sort((x, y) => (y.lowStreak - x.lowStreak) || (performance(x, m) - performance(y, m))
    || (y.caughtToday - x.caughtToday) || (fin(y.traits?.laziness) - fin(x.traits?.laziness)));
  return pool[0];
}

// ---------------------------------------------------------------- vị trí trống / ứng viên
export function roleInfo(role: RoleKey): { label: string; deskId: string; kpiTarget: number } | null {
  const info = (ROLE_INFO as Partial<Record<RoleKey, { label: string; deskId: string; kpiTarget: number }>>)[role];
  return info ? { label: info.label, deskId: info.deskId, kpiTarget: info.kpiTarget } : null;
}

export function vacancyFor(a: AgentState, day: number): Vacancy {
  const info = roleInfo(a.role);
  return {
    role: a.role,
    roleLabel: a.roleLabel || info?.label || a.role,
    deskId: a.deskId || info?.deskId || '',
    kpiTarget: a.kpiTarget > 0 ? a.kpiTarget : info?.kpiTarget ?? 260,
    replacingName: a.name,
    rejections: 0,
    since: day,
  };
}

/** vị trí MỚI (open_position): vai trò chọn theo nhu cầu, ngồi bàn trống */
export function extraVacancy(w: WorldApi, deskId: string, day: number): Vacancy | null {
  const c = w.company();
  const behind = c?.project ? fin(c.project.progress) < 50 && fin(c.project.deadlineDay) - day <= 3 : false;
  const pool: { role: RoleKey; w: number }[] = [
    { role: 'junior', w: behind ? 2 : 1 }, { role: 'qa', w: behind ? 1.2 : 0.6 }, { role: 'salesnew', w: 1.4 },
    { role: 'marketing', w: 0.7 }, { role: 'designer', w: 0.5 },
  ];
  let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
  let role: RoleKey = 'junior';
  for (const p of pool) { r -= p.w; if (r <= 0) { role = p.role; break; } }
  const info = roleInfo(role);
  if (!info) return null;
  return { role, roleLabel: info.label, deskId, kpiTarget: info.kpiTarget, rejections: 0, since: day, extra: true };
}

/** Vai trò đang không có ai (active/candidate) → vị trí trống (dùng khi khôi phục state thiếu dữ liệu). Vai trò đóng băng bị bỏ qua. */
export function detectVacancies(w: WorldApi, existing: Vacancy[], day: number, frozen: Partial<Record<RoleKey, number>> = {}): Vacancy[] {
  const agents = w.agents();
  if (agents.length < 3) return [];
  const roles = (Array.isArray(ROLE_ORDER) && ROLE_ORDER.length ? ROLE_ORDER : (Object.keys(ROLE_INFO) as RoleKey[]));
  const out: Vacancy[] = [];
  for (const role of roles) {
    if (NEVER_FIRED.includes(role) || existing.some((v) => v.role === role && !v.extra)) continue;
    if ((frozen[role] ?? -1) > day) continue;
    if (agents.some((a) => a.role === role && (a.status === 'active' || a.status === 'candidate'))) continue;
    const info = roleInfo(role);
    if (!info) continue;
    const gone = agents.find((a) => a.role === role && a.status === 'fired');
    out.push({ role, roleLabel: info.label, deskId: info.deskId, kpiTarget: info.kpiTarget, replacingName: gone?.name, rejections: 0, since: day });
  }
  return out;
}

export function candidateRequest(v: Vacancy, w: WorldApi, history: string[]): CandidateRequest {
  const used = new Set<string>(history);
  for (const a of w.agents()) {
    used.add(a.name);
    if (a.fullName) used.add(a.fullName);
  }
  return {
    role: v.role,
    roleLabel: v.roleLabel,
    deskId: v.deskId,
    kpiTarget: v.kpiTarget,
    replacingName: v.replacingName,
    usedNames: [...used].slice(-80),
  };
}

/** Hội đồng phỏng vấn ngoài HR: sếp (nếu có mặt) + chuyên môn (Tech Lead cho vị trí kỹ thuật, trưởng nhóm Sales cho kinh doanh) */
export function interviewPanel(w: WorldApi, role: RoleKey, free: (a: AgentState) => boolean): AgentState[] {
  const panel: AgentState[] = [];
  const boss = w.boss();
  if (boss && boss.status === 'active' && boss.present && !w.bossAway() && free(boss)) panel.push(boss);
  const findRole = (r: RoleKey) => w.activeAgents().find((a) => a.role === r && a.status === 'active' && free(a));
  let expert: AgentState | undefined;
  if (isTech(role)) expert = role === 'techlead' ? findRole('senior') : findRole('techlead');
  else if (isBiz(role)) expert = role === 'saleslead' ? undefined : findRole('saleslead');
  if (expert) panel.push(expert);
  return panel;
}
