// =====================================================================
//  Showrunner (v3) — "AI biên kịch": mỗi ~2 giờ game lên 1–3 "biến" (beat) cho vài giờ tới,
//  chọn từ thực đơn (catalog BEAT_MENU) kèm người liên quan + mức độ. Module này:
//    - dựng BeatRequest (tình hình ≤ 900 ký tự), kiểm tra kế hoạch AI trả về,
//    - giữ sổ mạch truyện (arcs: started → escalated → resolved, ≤ 2 mạch mở, ≤ 3 bước/mạch),
//    - ánh xạ mỗi beat thành các "hành động" cụ thể (StoryAction) để Director thi hành
//      bằng cảnh / sự kiện có sẵn — người xem chỉ thấy đời sống văn phòng, không thấy "AI lên beat".
//    - kế hoạch offline (ngẫu nhiên có trọng số theo tình hình) khi không có AI.
//  Thuần dữ liệu: không gọi World/Brain trực tiếp ngoài việc đọc trạng thái qua WorldApi.
// =====================================================================
import type { AgentState, Beat, BeatPlan, BeatRequest, NewsRef, Priority, RoleKey, SceneType, WorldApi } from '../types.js';
import { BEAT_KINDS, BEAT_MENU } from '../content/catalog.js';
import {
  chance, clamp, cut, deadlineDaysLeft, fin, hhmm, isBiz, isTech, listVi, mutual, pick, projectBrief, rand, randInt, relScore,
  shuffle, weightedPick, type GroupReason, type ReasonData, type VisitTone,
} from './scenes.js';
import { avgRatio, revenueRatio } from './hr.js';
import { findProductInText, getProducts, pickProduct, shortNameOf } from '../content/products.js';
import { DESK_ITEM_TAGS } from '../content/roster.js';
import {
  SITUATIONS, fillSit, isSituation, plansFor, situationDef, isBizRole, isTechRole,
  type PlanCode, type PlanDef, type SitFx, type SitWorld, type SituationDef,
} from '../content/situations.js';

/** v5: ảnh chụp tình hình cho tình huống công ty (doanh thu theo NHỊP tháng, tâm trạng trung bình…) */
export function sitWorldOf(w: WorldApi): SitWorld {
  const staff = w.activeAgents().filter((x) => x.role !== 'boss');
  const roles = new Set(staff.map((x) => x.role));
  const moodAvg = staff.length ? staff.reduce((s, x) => s + fin(x.mood, 60), 0) / staff.length : 60;
  return {
    revenuePct: Math.round(revenueRatio(w) * 100),
    moodAvg,
    staff: staff.length,
    hasRole: (r) => roles.has(r),
    negPair: staff.some((x) => staff.some((y) => x !== y && mutual(x, y) <= -15)),
    star: staff.some((x) => { const r = avgRatio(x, 7); return r !== null && r >= 1.1; }),
  };
}
const capFirst = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** v4: tên đời thường các món trên kệ (cho thực đơn biến shopping_story) — ngắn gọn để đỡ tốn token */
function shelfNames(): string {
  try { return getProducts().map((p) => shortNameOf(p)).join(', '); } catch { return ''; }
}

/**
 * v4: món của một mạch shopping_story: khớp tên trong note của AI; không thấy thì chọn món hợp vai người chính — TRỪ mọi món
 * người đó đã có (món trên bàn + sổ đồ: mạch là "vừa săn được"), ưu tiên cả món người kia chưa có. Note của AI nêu đúng một
 * món người đó đã có → undefined (mạch bị bỏ: note đã hiện cho người xem nên không đổi sang món khác).
 */
function productForArc(arc: { note: string }, a: AgentState | undefined, c: StoryContext, b?: AgentState): string | undefined {
  try {
    const ownedOf = (x?: AgentState): string[] => (x ? [...(x.deskItemProductId ? [x.deskItemProductId] : []), ...(c.ownedBy?.(x.id) ?? [])] : []);
    const mine = new Set<string>(ownedOf(a));
    const hit = findProductInText(arc.note);
    if (hit) return mine.has(hit.id) ? undefined : hit.id;
    const tags = a ? DESK_ITEM_TAGS[a.role] ?? [] : [];
    return (pickProduct(tags, new Set([...mine, ...ownedOf(b)])) ?? pickProduct(tags, mine))?.id;
  } catch {
    return undefined;
  }
}

export type ArcStatus = 'started' | 'escalated' | 'resolved' | 'dropped';

export interface Arc {
  id: string;
  kind: string;
  a?: string;
  b?: string;
  intensity: number;          // 1..3
  note: string;               // 1 câu: chuyện gì xảy ra (từ AI hoặc mẫu offline)
  status: ArcStatus;
  createdDay: number;
  createdAt: number;          // phút game tuyệt đối
  step: number;               // số bước đã thi hành
  total: number;              // số bước dự kiến (1..3)
  nextAt: number;             // phút game tuyệt đối của bước kế
  source: 'llm' | 'offline';
  resolvedDay?: number;
  /** v4 shopping_story: món trên kệ mà chuyện xoay quanh (khớp từ note của AI, không thấy thì chọn hợp người) */
  productId?: string;
  // --- v5 tình huống công ty (src/content/situations.ts)
  /** phương án đã chốt ở cuộc họp xử lý + ai chốt (AI viết cảnh họp / dự phòng offline) */
  plan?: PlanCode;
  planBy?: 'llm' | 'offline';
  /** kết quả "công tác tư tưởng" nếu phương án có bước đó */
  pep?: 'inspired' | 'unmoved';
  /** faction_split: hai phe */
  sideA?: string[];
  sideB?: string[];
  /** số phút đã chờ cuộc họp chốt phương án */
  waited?: number;
  outcome?: 'good' | 'bad';
}

/** Hành động cụ thể Director thi hành (ánh xạ beat → đời sống văn phòng) */
export type StoryAction =
  | { t: 'scene'; type: SceneType; delay: number; window: number; prio: Priority; data: Record<string, string | undefined> }
  | { t: 'event'; name: 'deal' | 'server_down' | 'release'; agentId?: string; note?: string }
  | { t: 'adjust'; id: string; mood?: number; stress?: number; kpi?: number; energy?: number }
  | { t: 'rel'; from: string; to: string; delta: number; note: string }
  | { t: 'memory'; id: string; text: string }
  | { t: 'log'; icon: string; text: string; kind?: 'event' | 'system' }
  | { t: 'toast'; icon: string; text: string }
  | { t: 'leave_early'; id: string; inMinutes: number }
  | { t: 'overtime'; ids: string[]; days: number; minutes: number }
  | { t: 'late_tomorrow'; ids: string[]; minutes: number }
  | { t: 'strict_boss'; minutes: number }
  | { t: 'revenue'; amount: number }
  | { t: 'resign_check'; id: string; hint: string }
  | { t: 'raise_check'; id: string }
  | { t: 'rumor'; about: string; text: string; exclude: string[] }
  | { t: 'boost'; reason: GroupReason; data: ReasonData; minutes: number }
  /** v4: người này giờ có món đồ (mua / săn sale trong chuyện của AI biên kịch) → món đồ trên bàn + nhớ để kể lại */
  | { t: 'own'; id: string; productId: string }
  /** v5: bước này chưa chạy được (chờ cuộc họp chốt phương án) → hoãn, không tính là đã thi hành */
  | { t: 'wait'; minutes: number }
  /** v5: HR + sếp họp xét nhân sự (kết cục xấu của "thị trường khó") — AI quyết trong hàng rào như thường */
  | { t: 'hr_review'; note: string };

export interface StoryContext {
  w: WorldApi;
  /** tin đồn đang lan (tên người bị đồn + bản mới nhất) */
  rumors: { aboutName: string; text: string }[];
  /** tin thời sự vừa được bàn (nếu có) */
  latestNews?: NewsRef;
  /** vài sự kiện đáng chú ý gần đây trong ngày (đã rút gọn) */
  recentEvents: string[];
  /** số người đang làm (sim engineer: world.headcount()) */
  headcount: number;
  /** món một người đã có (món trên bàn + sổ đồ của Director) — shopping_story không "mua mới" món đã có */
  ownedBy?: (agentId: string) => string[];
}

export const MAX_OPEN_ARCS = 2;
/** số bước tối đa của một mạch (v5: tình huống công ty có 4 bước — bùng phát, họp, triển khai, kết cục) */
export const MAX_ARC_STEPS = 4;
export const MAX_ARCS_KEPT = 8;
export const MAX_RECENT_BEATS = 10;
/** mạch chưa xong sau bấy nhiêu ngày thì tự rơi */
export const ARC_MAX_AGE_DAYS = 2;
/** chỉ lên beat / thi hành bước trong giờ này */
const STORY_HOURS = { from: 8 * 60 + 30, to: 17 * 60 + 20 };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** danh sách id hợp lệ (≤ 6) khi khôi phục; rỗng → undefined */
const idList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ids = v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, 6);
  return ids.length ? ids : undefined;
};
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

type Need = 'none' | 'a' | 'ab';
/** beat cần bao nhiêu người, vai nào hợp (ưu tiên, không bắt buộc) */
const BEAT_CAST: Record<string, { need: Need; a?: (x: AgentState) => number; b?: (x: AgentState, a: AgentState) => number; steps: number }> = {
  conflict: { need: 'ab', a: () => 1, b: (x, a) => 1 + Math.max(0, -mutual(a, x)) / 15, steps: 3 },
  viral: { need: 'a', a: (x) => (x.role === 'marketing' ? 3 : x.role === 'designer' ? 1.2 : 0.5), steps: 2 },
  big_bug: { need: 'ab', a: (x) => (x.role === 'qa' ? 4 : isTech(x.role) ? 0.6 : 0), b: (x) => (isTech(x.role) && x.role !== 'qa' ? 1 + (x.role === 'junior' ? 0.6 : 0) : 0), steps: 3 },
  client_angry: { need: 'a', a: (x) => (x.role === 'saleslead' ? 2 : x.role === 'salesnew' ? 1.6 : x.role === 'marketing' ? 0.4 : 0), steps: 3 },
  secret_friendship: { need: 'ab', a: () => 1, b: (x, a) => (isTech(a.role) === isTech(x.role) ? 0.6 : 1.2) + Math.max(0, mutual(a, x)) / 50, steps: 3 },
  crush_rumor: { need: 'ab', a: () => 1, b: (x, a) => (x.gender !== a.gender ? 1.4 : 0.4), steps: 2 },
  raise_request: { need: 'a', a: (x) => { const r = avgRatio(x, 7); return (r !== null && r >= 1.1 ? 2 : 0.2) + fin(x.traits?.ambition); }, steps: 1 },
  resign_threat: { need: 'a', a: (x) => (fin(x.mood, 60) < 35 ? 2.5 : 0.3) + (fin(x.warnings) > 0 ? 0.6 : 0), steps: 2 },
  boss_mood_swing: { need: 'none', steps: 2 },
  team_building: { need: 'none', steps: 2 },
  new_client_deal: { need: 'a', a: (x) => (x.role === 'saleslead' ? 2 : x.role === 'salesnew' ? 1.5 : 0), steps: 1 },
  overtime_week: { need: 'none', steps: 2 },
  office_prank: { need: 'ab', a: (x) => 0.4 + fin(x.traits?.humor), b: (x, a) => 0.5 + Math.max(0, mutual(a, x)) / 40, steps: 3 },
  lost_item: { need: 'a', a: (x) => 0.5 + fin(x.traits?.laziness) * 0.5, steps: 3 },
  sick_day: { need: 'a', a: (x) => 0.6 + (fin(x.energy, 70) < 40 ? 1 : 0) + (fin(x.stress, 30) > 65 ? 0.6 : 0), steps: 1 },
  karaoke_night: { need: 'a', a: (x) => 0.5 + fin(x.traits?.gossip) + (x.role === 'saleslead' ? 0.8 : 0), steps: 2 },
  pitch_contest: { need: 'none', steps: 1 },
  shopping_story: { need: 'ab', a: (x) => 0.5 + fin(x.traits?.gossip) + (x.role === 'marketing' ? 1 : 0), b: (x, a) => 0.6 + Math.max(0, mutual(a, x)) / 40, steps: 2 },
  // v5: tình huống công ty — 4 bước, người trung tâm theo từng loại
  ...Object.fromEntries(SITUATIONS.map((d) => [d.kind, { need: d.cast as Need, a: d.castA, b: d.castB, steps: MAX_ARC_STEPS }])),
};

const LOST_ITEMS = ['cục sạc dự phòng', 'thẻ từ ra vào', 'cái cốc giữ nhiệt', 'tai nghe', 'chìa khoá xe', 'cuốn sổ ghi chép', 'con chuột không dây', 'cái ô'];
const FOUND_AT = ['trong tủ lạnh pantry', 'dưới gầm sofa góc chill', 'trên kệ phòng trưng bày', 'trong phòng họp, ngay ghế sếp', 'ở máy in', 'trong balo của chính mình'];
const PRANKS = ['đổi hình nền máy tính thành ảnh sếp đánh golf', 'dán giấy nhớ kín màn hình', 'giấu con chuột vào ngăn kéo', 'đổi ngôn ngữ bàn phím sang tiếng Thái', 'bọc giấy bạc cái cốc', 'treo dòng "đang tuyển vợ" sau lưng ghế'];
const CONFLICT_TOPICS = ['yêu cầu đổi tới đổi lui của khách', 'ai làm chậm tiến độ', 'chuyện deploy chiều thứ Sáu', 'cách đặt tên biến', 'ai quên tắt máy lạnh', 'việc đổi màu nút không hỏi ai'];
const CLIENT_ISSUES = ['khách đòi hoàn tiền vì demo bị lỗi', 'khách chửi vì phần mềm báo sai số', 'khách doạ huỷ hợp đồng vì trễ hạn', 'khách so sánh với đối thủ rẻ hơn'];

export class Showrunner {
  private arcs: Arc[] = [];
  private recentBeats: string[] = [];
  private nextPlanAt = -1e9;
  private seq = 0;
  private counters = { plans: 0, beatsPlanned: 0, beatsRejected: 0, arcsResolved: 0, arcsDropped: 0, stepsRun: 0, llmPlans: 0 };

  constructor(private readonly everyMin: number) {}

  // ---------------------------------------------------------------- lịch
  /** đã tới lúc lên beat chưa (trong giờ làm, đủ nhịp, còn chỗ cho mạch mới) */
  due(now: number, minuteOfDay: number): boolean {
    if (minuteOfDay < STORY_HOURS.from || minuteOfDay > STORY_HOURS.to) return false;
    if (now < this.nextPlanAt) return false;
    return this.openArcs().length < MAX_OPEN_ARCS;
  }

  /** đặt nhịp lần lên beat kế (gọi sau khi vừa lên, hoặc lúc khởi động) */
  schedule(now: number, delayMin?: number): void {
    this.nextPlanAt = now + (delayMin ?? this.everyMin * rand(0.85, 1.2));
  }

  nextPlan(): number {
    return this.nextPlanAt;
  }

  openArcs(): Arc[] {
    return this.arcs.filter((a) => a.status === 'started' || a.status === 'escalated');
  }

  allArcs(): Arc[] {
    return [...this.arcs];
  }

  stats(): Record<string, number> {
    return { ...this.counters, arcsOpen: this.openArcs().length, arcsKept: this.arcs.length, recentBeats: this.recentBeats.length };
  }

  // ---------------------------------------------------------------- yêu cầu cho AI
  buildRequest(c: StoryContext): BeatRequest {
    const w = c.w;
    const staff = w.agents().filter((a) => a.status === 'active' && a.role !== 'boss' && a.role !== 'hr');
    const comp = w.company();
    const parts: string[] = [];
    parts.push(`Ngày ${w.day()} ${w.weekday()} ${hhmm(w.minuteOfDay())}, ${c.headcount} người`);
    if (comp) {
      const pct = fin(comp.revenueTarget) > 0 ? Math.round((fin(comp.revenueMonth) / comp.revenueTarget) * 100) : 0;
      parts.push(`doanh thu ${Math.round(fin(comp.revenueMonth))}/${Math.round(fin(comp.revenueTarget))} triệu (${pct}%)`);
      const pb = projectBrief(w);
      if (pb) parts.push(pb);
      if (comp.incident) parts.push(comp.incident === 'server_down' ? 'server đang sập' : 'đang mất wifi');
    }
    parts.push(w.bossAway() ? 'sếp đang vắng' : 'sếp có mặt');
    const ranked = staff.map((a) => ({ a, r: avgRatio(a, 7) ?? -1 })).filter((x) => x.r >= 0).sort((x, y) => y.r - x.r);
    if (ranked.length >= 2) {
      const top = ranked.slice(0, 2).map((x) => `${x.a.name} ${Math.round(x.r * 100)}%`);
      const low = ranked.slice(-2).reverse().map((x) => `${x.a.name} ${Math.round(x.r * 100)}%${x.a.lowStreak ? `, ${x.a.lowStreak} ngày thấp` : ''}${x.a.warnings ? `, ${x.a.warnings} lần nhắc` : ''}`);
      parts.push(`KPI tuần dẫn đầu: ${top.join(', ')}; đuối: ${low.join(', ')}`);
    }
    const pairs: { s: string; v: number }[] = [];
    for (let i = 0; i < staff.length; i++) {
      for (let j = i + 1; j < staff.length; j++) {
        const m = mutual(staff[i], staff[j]);
        if (Math.abs(m) >= 18) pairs.push({ s: `${staff[i].name}–${staff[j].name} ${m > 0 ? 'thân' : 'kỳ phùng'} (${m > 0 ? '+' : ''}${m})`, v: Math.abs(m) });
      }
    }
    if (pairs.length) parts.push(`quan hệ nổi bật: ${pairs.sort((x, y) => y.v - x.v).slice(0, 3).map((p) => p.s).join(', ')}`);
    const moody = staff.filter((a) => fin(a.mood, 60) < 35).map((a) => `${a.name} (mood ${Math.round(a.mood)})`);
    if (moody.length) parts.push(`đang buồn: ${moody.slice(0, 2).join(', ')}`);
    if (c.rumors.length) parts.push(`tin đồn đang lan: ${c.rumors.length} — "${cut(c.rumors[c.rumors.length - 1].text, 90)}"`);
    if (c.latestNews) parts.push(`tin thời sự vừa bàn: "${cut(c.latestNews.title, 80)}"`);
    if (c.recentEvents.length) parts.push(`mới xảy ra: ${c.recentEvents.slice(-2).map((e) => cut(e, 70)).join('; ')}`);
    const situation = cut(parts.join('. ') + '.', 900);
    const open = new Set(this.openArcs().map((a) => a.kind));
    // v5: tình huống công ty — chỉ đưa ≤ 3 loại hợp tình hình nhất lúc này (bốc thăm theo trọng số) cho đỡ tốn token;
    // đang có một tình huống mở thì không đưa thêm
    const sitKinds = this.situationMenu(w);
    return {
      situation,
      menu: BEAT_MENU.filter((m) => !open.has(m.kind) && (!isSituation(m.kind) || sitKinds.has(m.kind)))
        .map((m) => ({ kind: m.kind, desc: m.kind === 'shopping_story' ? `${m.desc}. Các món: ${shelfNames()}` : m.desc })),
      openArcs: this.openArcs().map((a) => this.describe(a, w)),
      recentBeats: [...this.recentBeats],
      roster: w.agents().filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name, roleLabel: a.roleLabel })),
    };
  }

  private describe(a: Arc, w: WorldApi): string {
    const n = (id?: string) => (id ? w.agent(id)?.name ?? id : '');
    const who = [n(a.a), n(a.b)].filter(Boolean).join(' & ');
    const def = situationDef(a.kind);
    const plan = def && a.plan ? def.plans.find((p) => p.code === a.plan) : undefined;
    const chosen = plan ? `, đã chốt: ${cut(fillSit(plan.label, { a: n(a.a), b: n(a.b) }), 60)}` : '';
    return `${a.kind}${who ? ` (${who})` : ''}: ${cut(a.note, 80)} — bước ${a.step}/${a.total}${chosen}`;
  }

  /** v5: các loại tình huống được đưa lên thực đơn AI lần này (≤ 3, theo trọng số tình hình; đang có tình huống mở → rỗng) */
  private situationMenu(w: WorldApi): Set<string> {
    const out = new Set<string>();
    if (this.openArcs().some((a) => isSituation(a.kind))) return out;
    const sw = sitWorldOf(w);
    const recent = new Set(this.recentBeats.slice(-6).map((x) => x.split('(')[0]));
    const pool = SITUATIONS.filter((d) => !recent.has(d.kind) && d.weight(sw) > 0);
    while (out.size < 3 && pool.length) {
      const d = weightedPick(pool, (x) => x.weight(sw));
      if (!d) break;
      out.add(d.kind);
      pool.splice(pool.indexOf(d), 1);
    }
    return out;
  }

  // ---------------------------------------------------------------- nhận kế hoạch (AI hoặc offline), tạo mạch
  /** Kiểm tra từng beat (kind ∈ menu, a/b là người đang làm & có mặt, intensity 1..3) → mạch mới. Trả về các mạch vừa mở. */
  accept(plan: BeatPlan | null | undefined, c: StoryContext): Arc[] {
    const w = c.w;
    const out: Arc[] = [];
    const beats = plan && Array.isArray(plan.beats) ? plan.beats.slice(0, 3) : [];
    const source: 'llm' | 'offline' = plan?.source === 'llm' ? 'llm' : 'offline';
    this.counters.plans++;
    if (source === 'llm') this.counters.llmPlans++;
    const open = new Set(this.openArcs().map((a) => a.kind));
    const now = fin(w.time());
    for (const raw of beats) {
      if (this.openArcs().length >= MAX_OPEN_ARCS) break;
      const b = this.cleanBeat(raw, w);
      // v5: mỗi lúc chỉ một tình huống công ty (nặng: 4 bước, có họp)
      if (!b || open.has(b.kind) || (isSituation(b.kind) && this.openArcs().some((a) => isSituation(a.kind)))) {
        this.counters.beatsRejected++;
        continue;
      }
      const cast = BEAT_CAST[b.kind];
      const total = clamp(cast?.steps ?? 1, 1, MAX_ARC_STEPS);
      const arc: Arc = {
        id: `arc${w.day()}_${++this.seq}`, kind: b.kind, a: b.a, b: b.b, intensity: b.intensity, note: b.note,
        status: 'started', createdDay: w.day(), createdAt: now, step: 0, total,
        nextAt: now + rand(4, 25), source,
      };
      this.arcs.push(arc);
      open.add(b.kind);
      out.push(arc);
      this.counters.beatsPlanned++;
      const names = [b.a, b.b].map((id) => (id ? w.agent(id)?.name ?? id : '')).filter(Boolean);
      this.recentBeats = [...this.recentBeats, `${b.kind}${names.length ? `(${names.join(', ')})` : ''}`].slice(-MAX_RECENT_BEATS);
    }
    this.pruneArcs();
    return out;
  }

  /** chuẩn hoá 1 beat: kind hợp lệ, người hợp lệ (tự chọn nếu AI bỏ trống / chọn sai), intensity 1..3, note ≤ 160 */
  private cleanBeat(raw: unknown, w: WorldApi): Beat | null {
    if (!isObj(raw)) return null;
    const kind = str(raw.kind, 40);
    if (!BEAT_KINDS.includes(kind)) return null;
    const cast = BEAT_CAST[kind];
    const ok = (id: unknown): string | undefined => {
      if (typeof id !== 'string' || !id.trim()) return undefined;
      const a = w.agent(id.trim());
      return a && a.status === 'active' && a.present && !a.hidden && a.role !== 'boss' && a.role !== 'hr' ? a.id : undefined;
    };
    let a = ok(raw.a);
    let b = ok(raw.b);
    if (cast && cast.need !== 'none') {
      const pool = w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr' && !x.hidden);
      if (!a) a = weightedPick(pool, (x) => (cast.a ? cast.a(x) : 1))?.id;
      if (!a) return null;
      if (cast.need === 'ab') {
        const aa = w.agent(a)!;
        if (!b || b === a) b = weightedPick(pool.filter((x) => x.id !== a), (x) => (cast.b ? cast.b(x, aa) : 1))?.id;
        if (!b) return null;
      } else b = undefined;
    } else {
      a = undefined;
      b = undefined;
    }
    const intensity = clamp(Math.round(fin(raw.intensity, 1)), 1, 3);
    const note = str(raw.note, 160) || this.defaultNote(kind, w, a, b);
    return { kind, a, b, intensity, note };
  }

  private defaultNote(kind: string, w: WorldApi, a?: string, b?: string): string {
    const n = (id?: string) => (id ? w.agent(id)?.name ?? 'ai đó' : 'ai đó');
    const sit = situationDef(kind);
    if (sit) return fillSit(pick(sit.notes) ?? sit.title, { a: n(a), b: n(b), boss: w.boss()?.name });
    switch (kind) {
      case 'conflict': return `${n(a)} và ${n(b)} bất đồng về ${pick(CONFLICT_TOPICS)}`;
      case 'viral': return `clip của ${n(a)} bất ngờ lên xu hướng`;
      case 'big_bug': return `${n(a)} phát hiện bug lớn trong phần của ${n(b)}`;
      case 'client_angry': return `${pick(CLIENT_ISSUES)} — ${n(a)} hứng trọn`;
      case 'secret_friendship': return `${n(a)} và ${n(b)} bỗng thân nhau vì cùng sở thích`;
      case 'crush_rumor': return `có tin đồn ${n(a)} để ý ${n(b)}`;
      case 'raise_request': return `${n(a)} muốn xin tăng lương`;
      case 'resign_threat': return `${n(a)} úp mở chuyện nghỉ việc`;
      case 'boss_mood_swing': return 'sếp hôm nay khó ở';
      case 'team_building': return 'team building mini ở góc chill';
      case 'new_client_deal': return `${n(a)} sắp chốt được khách mới`;
      case 'overtime_week': return 'team dev tăng ca vì tiến độ';
      case 'office_prank': return `${n(a)} chơi khăm ${n(b)}: ${pick(PRANKS)}`;
      case 'lost_item': return `${n(a)} làm mất ${pick(LOST_ITEMS)}`;
      case 'sick_day': return `${n(a)} ốm bất chợt`;
      case 'karaoke_night': return `${n(a)} rủ cả nhóm đi karaoke tối nay`;
      case 'pitch_contest': return 'sếp bất ngờ tổ chức buổi pitch ý tưởng';
      case 'shopping_story': return `${n(a)} vừa săn được một món trên kệ phòng trưng bày, kể cho ${n(b)} nghe`;
      default: return kind;
    }
  }

  // ---------------------------------------------------------------- kế hoạch offline (không AI)
  offlinePlan(c: StoryContext): BeatPlan {
    const w = c.w;
    const staff = w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr' && !x.hidden);
    if (staff.length < 2) return { beats: [], source: 'offline' };
    const comp = w.company();
    const rev = comp && fin(comp.revenueTarget) > 0 ? fin(comp.revenueMonth) / comp.revenueTarget : 1;
    const dl = deadlineDaysLeft(w);
    const progress = fin(comp?.project?.progress, 50);
    const minute = w.minuteOfDay();
    const boss = w.boss();
    const bossHere = !!boss && boss.present && !w.bossAway();
    const hasRole = (r: RoleKey) => staff.some((x) => x.role === r);
    const negPair = staff.some((x) => staff.some((y) => x !== y && mutual(x, y) <= -15));
    const star = staff.some((x) => { const r = avgRatio(x, 7); return r !== null && r >= 1.1 && fin(x.traits?.ambition) >= 0.6; });
    const sad = staff.some((x) => fin(x.mood, 60) < 35);
    const recent = new Set(this.recentBeats.slice(-6).map((s) => s.split('(')[0]));
    const open = new Set(this.openArcs().map((a) => a.kind));
    const wts: Record<string, number> = {
      conflict: 1.0 + (negPair ? 1.0 : 0),
      viral: hasRole('marketing') ? 0.7 : 0.3,
      big_bug: hasRole('qa') && staff.some((x) => isTech(x.role) && x.role !== 'qa') ? 0.8 + (dl <= 2 ? 0.8 : 0) : 0,
      client_angry: staff.some((x) => isBiz(x.role)) ? 0.7 + (rev < 0.7 ? 0.6 : 0) : 0,
      secret_friendship: 0.7,
      crush_rumor: 0.45,
      raise_request: star ? 1.2 : 0.15,
      resign_threat: sad ? 1.3 : 0.2,
      boss_mood_swing: bossHere ? 0.5 + (rev < 0.6 ? 0.5 : 0) : 0,
      team_building: 0.4 + (rev >= 1.0 ? 0.5 : 0),
      new_client_deal: staff.some((x) => x.role === 'saleslead' || x.role === 'salesnew') ? 0.6 + (rev < 0.8 ? 0.6 : 0) : 0,
      overtime_week: 0.35 + (dl <= 2 && progress < 70 ? 0.9 : 0),
      office_prank: 0.7,
      lost_item: 0.6,
      sick_day: 0.5,
      karaoke_night: 0.35 + (minute >= 14 * 60 ? 0.5 : 0),
      pitch_contest: staff.length >= 4 ? 0.3 : 0,
      shopping_story: 0.6,
    };
    // v5: tình huống công ty theo tình hình (mỗi lúc một tình huống)
    const sw = sitWorldOf(w);
    const sitOpen = this.openArcs().some((a) => isSituation(a.kind));
    for (const d of SITUATIONS) wts[d.kind] = sitOpen ? 0 : d.weight(sw);
    const kinds = BEAT_KINDS.filter((k) => !open.has(k) && !recent.has(k) && (wts[k] ?? 0) > 0);
    const beats: Beat[] = [];
    const n = chance(0.3) ? 2 : 1;
    const left = [...kinds];
    while (beats.length < n && left.length) {
      const k = weightedPick(left, (x) => wts[x] ?? 0);
      if (!k) break;
      left.splice(left.indexOf(k), 1);
      if (isSituation(k)) for (const x of [...left]) if (isSituation(x)) left.splice(left.indexOf(x), 1);
      // mức độ: phần lớn nhẹ (1), đôi khi vừa (2), hiếm khi đậm (3) — mạch đậm mới có dòng 🎬
      const intensity = chance(0.5) ? 1 : chance(0.7) ? 2 : 3;
      const b = this.cleanBeat({ kind: k, intensity, note: '' }, w);
      if (b) beats.push(b);
    }
    return { beats, source: 'offline' };
  }

  // ---------------------------------------------------------------- thi hành
  /** các mạch tới hạn bước kế (trong giờ làm) */
  dueArcs(now: number, minuteOfDay: number): Arc[] {
    if (minuteOfDay < STORY_HOURS.from || minuteOfDay > STORY_HOURS.to) return [];
    return this.openArcs().filter((a) => a.nextAt <= now);
  }

  /** mạch quá hạn (sang ngày thứ 3) → rơi; trả về danh sách để Director ghi sổ */
  expire(day: number): Arc[] {
    const out: Arc[] = [];
    for (const a of this.openArcs()) {
      if (day - a.createdDay >= ARC_MAX_AGE_DAYS + 1) {
        a.status = 'dropped';
        a.resolvedDay = day;
        this.counters.arcsDropped++;
        out.push(a);
      }
    }
    if (out.length) this.pruneArcs();
    return out;
  }

  /**
   * Hành động cho bước hiện tại của mạch. Trả về null nếu người liên quan không còn (Director sẽ drop mạch).
   * Bước cuối là bước "kết": ký ức cho người liên quan + (Director) ghi archive.
   */
  actionsFor(arc: Arc, c: StoryContext): StoryAction[] | null {
    const w = c.w;
    const A = arc.a ? w.agent(arc.a) : undefined;
    const B = arc.b ? w.agent(arc.b) : undefined;
    const cast = BEAT_CAST[arc.kind];
    if (cast && cast.need !== 'none' && (!A || A.status !== 'active')) return null;
    if (cast && cast.need === 'ab' && (!B || B.status !== 'active')) return null;
    if (isSituation(arc.kind)) return this.situationActions(arc, c, A, B);
    const aid = A?.id ?? '', bid = B?.id ?? '';
    const an = A?.name ?? 'ai đó', bn = B?.name ?? 'ai đó';
    const last = arc.step >= arc.total - 1;
    const hi = arc.intensity >= 2;
    const scene = (type: SceneType, data: Record<string, string | undefined>, delay = rand(1, 6), window = 60, prio: Priority = 'normal'): StoryAction =>
      ({ t: 'scene', type, delay, window, prio, data });
    const visit = (from: string, to: string, why: string, tone?: VisitTone, motiveKey?: string, delay?: number): StoryAction =>
      scene('desk_visit', { initiatorId: from, targetId: to, why, tone, motiveKey }, delay);
    const group = (reason: GroupReason, data: ReasonData = {}, exclude: string[] = [], delay = rand(2, 10)): StoryAction =>
      scene('group_chat', { reason, name: data.name, note: data.note, aboutId: data.id, exclude: exclude.join(',') }, delay, 45, 'low');
    const mem = (id: string, text: string): StoryAction => ({ t: 'memory', id, text });
    const out: StoryAction[] = [];
    switch (arc.kind) {
      case 'conflict': {
        const topic = arc.note || pick(CONFLICT_TOPICS) || 'công việc';
        if (arc.step === 0) {
          out.push(visit(aid, bid, `tranh cãi về ${cut(topic, 70)}`, 'tense'));
          out.push({ t: 'rel', from: aid, to: bid, delta: -4, note: 'cãi nhau về công việc' }, { t: 'rel', from: bid, to: aid, delta: -4, note: 'cãi nhau về công việc' });
          if (hi) out.push({ t: 'boost', reason: 'conflict', data: { name: an, note: bn }, minutes: 60 });
        } else if (arc.step === 1 && !last) {
          out.push(group('conflict', { name: an, note: bn }, [aid, bid]));
          out.push({ t: 'adjust', id: aid, stress: 6 }, { t: 'adjust', id: bid, stress: 6 });
        } else if (arc.intensity === 3 && chance(0.4)) {
          out.push(mem(aid, `Vẫn còn khó chịu với ${bn} sau vụ ${cut(topic, 50)}`), mem(bid, `Giữ khoảng cách với ${an} sau vụ cãi nhau`));
          out.push({ t: 'rel', from: aid, to: bid, delta: -3, note: 'không làm hoà' });
        } else {
          out.push(visit(bid, aid, 'làm hoà sau vụ cãi nhau', 'makeup'));
          out.push({ t: 'rel', from: aid, to: bid, delta: 7, note: 'đã làm hoà' }, { t: 'rel', from: bid, to: aid, delta: 7, note: 'đã làm hoà' });
          out.push(mem(aid, `Đã làm hoà với ${bn} sau vụ ${cut(topic, 50)}`), mem(bid, `Đã làm hoà với ${an}`));
        }
        break;
      }
      case 'viral': {
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '📈', text: `Clip của ${an} bất ngờ lên xu hướng, lượt xem tăng vù vù!` });
          out.push({ t: 'adjust', id: aid, mood: 12, kpi: 15 });
          out.push({ t: 'boost', reason: 'viral', data: { name: an, id: aid }, minutes: 90 });
          out.push(scene('company_chat', { reason: 'viral', name: an, targetId: aid }, rand(2, 8), 40, 'low'));
          out.push(group('viral', { name: an, id: aid }, [], rand(10, 25)));
        } else {
          out.push(scene('celebration', { reason: 'viral', centerId: aid }, rand(2, 10), 70));
          out.push(mem(aid, 'Clip của mình từng lên xu hướng, cả công ty bàn tán'));
        }
        break;
      }
      case 'big_bug': {
        if (arc.step === 0) {
          out.push(visit(aid, bid, `bug lớn: ${cut(arc.note, 60)}`, undefined, 'qa_bug'));
          out.push({ t: 'adjust', id: bid, stress: 12 });
        } else if (arc.step === 1 && !last) {
          out.push(scene('incident', { reason: 'bug_prod', note: cut(arc.note, 50) }, rand(1, 5), 45, 'high'));
        } else {
          out.push({ t: 'log', icon: '✅', text: `${bn} đã fix xong bug lớn mà ${an} tìm ra, cả team thở phào` });
          out.push({ t: 'adjust', id: bid, kpi: 12, stress: -8 }, { t: 'adjust', id: aid, kpi: 6 });
          out.push({ t: 'rel', from: bid, to: aid, delta: 4, note: 'nhờ QA bắt bug kịp' });
          out.push(mem(aid, `Bắt được bug lớn của ${bn} ngay trước deadline`), mem(bid, `Suýt toang vì bug lớn, may ${an} bắt kịp`));
        }
        break;
      }
      case 'client_angry': {
        const issue = arc.note || pick(CLIENT_ISSUES) || 'khách nổi giận';
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '📞', text: `Khách hàng nổi giận với ${an}: ${cut(issue, 80)}` });
          out.push({ t: 'adjust', id: aid, stress: 15, mood: -8 });
          out.push({ t: 'boost', reason: 'client_angry', data: { name: an, note: cut(issue, 50), id: aid }, minutes: 60 });
          out.push(scene('boss_call', { reason: 'scold', targetId: aid, note: cut(issue, 60) }, rand(8, 20), 60));
        } else if (arc.step === 1 && !last) {
          const lead = w.activeAgents().find((x) => x.role === 'techlead') ?? w.activeAgents().find((x) => x.role === 'senior');
          if (lead) {
            out.push(visit(aid, lead.id, 'khách đòi sửa gấp, nhờ dev cứu', undefined, 'sales_promise'));
            out.push({ t: 'adjust', id: lead.id, stress: 8 });
          }
        } else if (chance(0.6)) {
          out.push({ t: 'revenue', amount: randInt(8, 30) });
          out.push({ t: 'log', icon: '🤝', text: `${an} xoa dịu được khách, hợp đồng vẫn giữ` });
          out.push({ t: 'adjust', id: aid, mood: 10, kpi: 20, stress: -10 });
          out.push(mem(aid, `Xoa dịu được khách sau vụ ${cut(issue, 50)}`));
        } else {
          out.push({ t: 'log', icon: '💸', text: `Khách của ${an} rút lui, công ty mất một hợp đồng nhỏ` });
          out.push({ t: 'adjust', id: aid, mood: -6, stress: 5 });
          out.push(mem(aid, `Mất khách sau vụ ${cut(issue, 50)}`));
        }
        break;
      }
      case 'secret_friendship': {
        if (arc.step === 0) {
          out.push(visit(aid, bid, cut(arc.note, 70), 'warm', 'any_borrow'));
          out.push({ t: 'rel', from: aid, to: bid, delta: 6, note: 'phát hiện sở thích chung' }, { t: 'rel', from: bid, to: aid, delta: 6, note: 'phát hiện sở thích chung' });
        } else if (arc.step === 1 && !last) {
          out.push({ t: 'rumor', about: aid, text: `${an} và ${bn} dạo này thân nhau lạ, hay đi cà phê riêng`, exclude: [aid, bid] });
        } else {
          out.push(visit(bid, aid, 'rủ đi ăn trưa riêng như bạn thân mới', 'warm', 'any_borrow'));
          out.push({ t: 'rel', from: aid, to: bid, delta: 5, note: 'bạn thân mới' }, { t: 'rel', from: bid, to: aid, delta: 5, note: 'bạn thân mới' });
          out.push(mem(aid, `Bỗng thân với ${bn} vì cùng sở thích`), mem(bid, `Có bạn mới ở công ty: ${an}`));
        }
        break;
      }
      case 'crush_rumor': {
        if (arc.step === 0) {
          out.push({ t: 'rumor', about: aid, text: `${an} hình như đang để ý ${bn}, hay liếc qua bàn`, exclude: [aid, bid] });
        } else {
          out.push(group('crush', { name: an, note: bn, id: aid }, [aid, bid]));
          out.push(mem(aid, `Nghe đồn mình thích ${bn}, quê không biết giấu mặt đi đâu`));
          out.push({ t: 'adjust', id: aid, mood: -3, stress: 4 });
        }
        break;
      }
      case 'raise_request': {
        out.push({ t: 'raise_check', id: aid });
        break;
      }
      case 'resign_threat': {
        if (arc.step === 0) {
          out.push(group('resign_hint', { name: an, id: aid }, [aid]));
          out.push({ t: 'adjust', id: aid, mood: -4 });
        } else {
          out.push({ t: 'resign_check', id: aid, hint: cut(arc.note, 80) });
        }
        break;
      }
      case 'boss_mood_swing': {
        const boss = w.boss();
        if (!boss || !boss.present || w.bossAway()) return null;
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '😤', text: 'Sếp hôm nay khó ở: mặt lạnh từ lúc bước vào, đi tuần liên tục' });
          out.push({ t: 'strict_boss', minutes: hi ? 150 : 100 });
          out.push(group('boss_mood', {}, [], rand(3, 12)));
          out.push(scene('boss_call', { reason: 'scold' }, rand(10, 30), 60));
        } else {
          out.push(scene('boss_call', { reason: 'task' }, rand(5, 20), 60));
          out.push({ t: 'log', icon: '☕', text: 'Sếp uống xong ly cà phê thứ ba, mặt mới dãn ra được chút' });
        }
        break;
      }
      case 'team_building': {
        if (arc.step === 0) {
          out.push(scene('company_chat', { reason: 'team_building' }, rand(1, 6), 40, 'low'));
        } else {
          out.push(scene('celebration', { reason: 'team_building' }, rand(2, 10), 80));
          for (const x of w.activeAgents()) if (x.role !== 'boss') out.push({ t: 'adjust', id: x.id, mood: 4, stress: -3 });
        }
        break;
      }
      case 'new_client_deal': {
        out.push({ t: 'revenue', amount: randInt(15, 60) });
        out.push({ t: 'log', icon: '💰', text: `${an} chốt được khách mới: ${cut(arc.note, 70)}` });
        out.push({ t: 'adjust', id: aid, kpi: 35 });
        out.push({ t: 'event', name: 'deal', agentId: aid });
        out.push(mem(aid, `Chốt được khách mới: ${cut(arc.note, 60)}`));
        break;
      }
      case 'overtime_week': {
        const devs = w.agents().filter((x) => x.status === 'active' && isTech(x.role)).map((x) => x.id);
        if (!devs.length) return null;
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '🌙', text: `Team dev phải tăng ca 3 ngày tới vì tiến độ ${projectBrief(w) || 'dự án'}` });
          out.push({ t: 'overtime', ids: devs, days: 3, minutes: 90 });
          out.push(group('overtime', {}, [], rand(3, 12)));
        } else {
          for (const id of devs) out.push({ t: 'adjust', id, stress: 6, mood: -3 }, mem(id, 'Tuần tăng ca vì tiến độ, về nhà chỉ để ngủ'));
        }
        break;
      }
      case 'office_prank': {
        const prank = arc.note.includes(':') ? arc.note.split(':').slice(1).join(':').trim() : pick(PRANKS) ?? 'đổi hình nền máy tính';
        if (arc.step === 0) {
          out.push(visit(aid, bid, `lén ${cut(prank, 60)} khi ${bn} vừa rời bàn`, undefined, 'any_borrow'));
        } else if (arc.step === 1 && !last) {
          out.push({ t: 'log', icon: '😂', text: `${bn} phát hiện mình bị chơi khăm (${cut(prank, 60)}), cả phòng cười rần` });
          out.push(group('prank', { name: bn, note: cut(prank, 60), id: bid }, [bid]));
          out.push({ t: 'adjust', id: bid, mood: -3 });
        } else {
          out.push(visit(bid, aid, 'hỏi tội vụ chơi khăm', arc.intensity >= 3 ? 'tense' : 'makeup'));
          out.push({ t: 'rel', from: bid, to: aid, delta: arc.intensity >= 3 ? -4 : 3, note: 'vụ chơi khăm' });
          out.push(mem(aid, `Chơi khăm ${bn}: ${cut(prank, 50)}`), mem(bid, `Bị ${an} chơi khăm: ${cut(prank, 50)}`));
        }
        break;
      }
      case 'shopping_story': {
        // v4: chuyện do AI biên kịch nghĩ (note) quanh một món trên kệ → cảnh ghé bàn kèm món đó, bước sau lan sang nhóm chat kín
        const pid = arc.productId ?? (arc.productId = productForArc(arc, A, c, B));
        if (!pid) return null;
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '🛍️', text: cut(arc.note, 150) });
          out.push({ t: 'own', id: aid, productId: pid });
          out.push(scene('desk_visit', { initiatorId: aid, targetId: bid, why: 'kể chuyện món đồ mới mua', productId: pid, productMode: 'mention', productAngle: arc.note }));
        } else {
          out.push(scene('desk_visit', { initiatorId: bid, targetId: aid, why: 'hỏi thêm về món đồ hôm bữa', productId: pid, productMode: 'owner', productAngle: `${bn} hỏi lại ${an} sau vụ: ${cut(arc.note, 140)}` }, rand(30, 90)));
          out.push(mem(aid, `Kể cho ${bn} nghe chuyện món đồ mới mua`));
        }
        break;
      }
      case 'lost_item': {
        const item = arc.note.replace(/^.*làm mất\s*/i, '').trim() || pick(LOST_ITEMS) || 'món đồ';
        const others = w.activeAgents().filter((x) => x.id !== aid && x.role !== 'boss');
        if (arc.step === 0) {
          out.push({ t: 'log', icon: '🔍', text: `${an} làm mất ${item}, đang đi hỏi khắp văn phòng` });
          const t = pick(others);
          if (t) out.push(visit(aid, t.id, `hỏi có thấy ${item} không`, undefined, 'any_borrow'));
          out.push(group('lost_item', { name: an, note: item, id: aid }, [], rand(8, 20)));
        } else if (arc.step === 1 && !last) {
          const t = pick(others);
          if (t) out.push(visit(aid, t.id, `vẫn đi tìm ${item}, hỏi tiếp`, undefined, 'any_borrow'));
          out.push({ t: 'adjust', id: aid, stress: 5 });
        } else {
          out.push({ t: 'log', icon: '✅', text: `${an} tìm thấy ${item} ${pick(FOUND_AT)}` });
          out.push({ t: 'adjust', id: aid, mood: 6, stress: -5 });
          out.push(mem(aid, `Làm mất ${item}, tìm cả buổi, hoá ra ${pick(FOUND_AT)}`));
        }
        break;
      }
      case 'sick_day': {
        if (!A?.present) return null;
        out.push({ t: 'log', icon: '🤒', text: `${an} ốm bất chợt, xin về sớm nghỉ ngơi` });
        out.push({ t: 'leave_early', id: aid, inMinutes: 25 });
        out.push({ t: 'adjust', id: aid, mood: -8, kpi: -15, stress: 4 });
        out.push(group('sick', { name: an, note: 'về sớm', id: aid }, [aid], rand(10, 25)));
        out.push(mem(aid, 'Ốm phải xin về sớm, đồng nghiệp gánh việc'));
        break;
      }
      case 'karaoke_night': {
        if (arc.step === 0) {
          const crew = shuffle(w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr' && x.id !== aid)).slice(0, 3).map((x) => x.id);
          out.push(group('karaoke', { name: an, id: aid }, [], rand(1, 6)));
          out.push({ t: 'late_tomorrow', ids: [aid, ...crew], minutes: randInt(25, 50) });
          for (const id of [aid, ...crew]) out.push(mem(id, `Tối đi karaoke với ${an} và hội anh em`));
        } else {
          out.push({ t: 'log', icon: '🎤', text: 'Hậu karaoke: vài gương mặt tới trễ, mắt thâm quầng, giọng khàn đặc' });
          for (const id of [aid]) out.push({ t: 'adjust', id, energy: -10 });
        }
        break;
      }
      case 'pitch_contest': {
        out.push(scene('standup', { variant: 'pitch' }, rand(2, 8), 60));
        const winner = pick(w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr'));
        if (winner) {
          out.push({ t: 'adjust', id: winner.id, mood: 8 });
          out.push(mem(winner.id, 'Thắng buổi pitch ý tưởng trời ơi của sếp'));
        }
        break;
      }
      default:
        return null;
    }
    return out;
  }

  /** đánh dấu đã thi hành bước hiện tại; đặt giờ bước kế hoặc kết mạch */
  advance(arc: Arc, now: number, minuteOfDay: number): void {
    arc.step++;
    this.counters.stepsRun++;
    if (arc.step >= arc.total) {
      arc.status = 'resolved';
      arc.resolvedDay = undefined;
      this.counters.arcsResolved++;
      this.pruneArcs();
      return;
    }
    arc.status = arc.step >= 1 ? 'escalated' : 'started';
    // v5 tình huống: bùng phát → họp sau 40–90 phút; họp → triển khai 30–70 phút; triển khai → kết cục 2–4 giờ
    const gap = isSituation(arc.kind)
      ? (arc.step === 1 ? rand(40, 90) : arc.step === 2 ? rand(30, 70) : rand(120, 240))
      : arc.step === 1 ? rand(60, 150) : rand(90, 200);
    let next = now + gap;
    // rơi ra ngoài giờ làm → sáng mai 09:30–11:00
    if (minuteOfDay + gap > STORY_HOURS.to) next = now + (1440 - minuteOfDay) + 9 * 60 + 30 + rand(0, 90);
    arc.nextAt = next;
  }

  /**
   * v5: ngày văn phòng không ai làm (cuối tuần ở realtime, ngày server tắt) không tính vào tuổi mạch (expire), và bước kế
   * lùi theo đúng số ngày đó (giữ khung giờ đã hẹn, không dồn hết vào 08:30 sáng mở cửa). Tối đa 5 ngày: nghỉ lâu hơn thì
   * mạch vẫn già đi rồi tự rơi.
   */
  holdAges(days: number): void {
    const n = Math.min(5, Math.max(0, Math.floor(fin(days, 0))));
    if (n) for (const a of this.openArcs()) { a.createdDay += n; a.nextAt += n * 1440; }
  }

  /** v5: chờ cảnh của chính mạch (họp xử lý / truyền lửa) diễn xong — không tính vào "waited" (không kích hoạt phương án dự phòng) */
  hold(arc: Arc, now: number, minutes: number): void {
    arc.nextAt = now + Math.max(1, minutes);
  }

  /** v5: hoãn bước hiện tại (chờ cuộc họp chốt phương án) — không tính là đã chạy bước */
  postpone(arc: Arc, now: number, minutes: number): void {
    arc.waited = Math.min(10000, (arc.waited ?? 0) + minutes);
    arc.nextAt = now + minutes;
  }

  arcById(id: string | undefined): Arc | undefined {
    return id ? this.arcs.find((a) => a.id === id) : undefined;
  }

  /** v5: ghi phương án đã chốt (sau cảnh crisis_meeting) */
  setPlan(id: string | undefined, plan: PlanCode, by: 'llm' | 'offline'): Arc | undefined {
    const arc = this.arcById(id);
    if (!arc || arc.plan || arc.status === 'resolved' || arc.status === 'dropped') return undefined;
    arc.plan = plan;
    arc.planBy = by;
    return arc;
  }

  /** v5: ghi kết quả công tác tư tưởng (sau cảnh pep_talk) */
  setPep(id: string | undefined, v: 'inspired' | 'unmoved'): void {
    const arc = this.arcById(id);
    if (arc && !arc.pep) arc.pep = v;
  }

  /** v5: hành động "ngay khi chốt" của phương án (Director gọi sau cuộc họp) */
  planNowActions(arc: Arc, w: WorldApi): StoryAction[] {
    const def = situationDef(arc.kind);
    const plan = def && arc.plan ? def.plans.find((p) => p.code === arc.plan) : undefined;
    if (!def || !plan) return [];
    return this.fxActions(plan.now, arc, w, plan, `${def.title.toLowerCase()}: ${cut(plan.label, 40)}`);
  }

  // ---------------------------------------------------------------- v5: tình huống công ty
  /** hiệu ứng SitFx → hành động có sẵn (adjust / rel / revenue) */
  private fxActions(fx: SitFx | undefined, arc: Arc, w: WorldApi, plan: PlanDef | undefined, why: string): StoryAction[] {
    if (!fx) return [];
    const out: StoryAction[] = [];
    const boss = w.boss();
    const staff = w.activeAgents().filter((x) => x.role !== 'boss');
    const center = arc.a ? w.agent(arc.a) : undefined;
    if (fx.all) for (const x of staff) out.push({ t: 'adjust', id: x.id, mood: fx.all.mood, stress: fx.all.stress });
    if (fx.center && center && center.status === 'active') out.push({ t: 'adjust', id: center.id, mood: fx.center.mood, stress: fx.center.stress, kpi: fx.center.kpi });
    if (fx.group) for (const id of this.groupOf(arc, w, plan)) out.push({ t: 'adjust', id, mood: fx.group.mood, stress: fx.group.stress, kpi: fx.group.kpi });
    if (fx.boss && boss && boss.status === 'active') out.push({ t: 'adjust', id: boss.id, mood: fx.boss.mood, stress: fx.boss.stress });
    if (fx.bossRel && boss) for (const x of staff) if (x.role !== 'hr') out.push({ t: 'rel', from: x.id, to: boss.id, delta: fx.bossRel, note: cut(why, 60) });
    if (fx.revenue) out.push({ t: 'revenue', amount: randInt(fx.revenue[0], fx.revenue[1]) });
    return out;
  }

  /** nhóm chịu ảnh hưởng của phương án: sales (giao việc sales), dev (tăng ca), hai phe, hoặc người trong cuộc */
  private groupOf(arc: Arc, w: WorldApi, plan?: PlanDef): string[] {
    const active = w.activeAgents().filter((x) => x.role !== 'boss');
    if (plan?.follow === 'sales_push') return active.filter((x) => isBizRole(x.role)).map((x) => x.id);
    if (plan?.follow === 'overtime') return active.filter((x) => isTechRole(x.role)).map((x) => x.id);
    const sides = [...(arc.sideA ?? []), ...(arc.sideB ?? [])].filter((id) => active.some((x) => x.id === id));
    if (sides.length) return sides;
    return [arc.a, arc.b].filter((id): id is string => !!id && active.some((x) => x.id === id));
  }

  /** chọn phương án dự phòng (offline / AI không chốt được): theo xác suất thành công, vẫn có bất ngờ */
  pickPlan(def: SituationDef, w: WorldApi): PlanDef {
    const plans = plansFor(def, sitWorldOf(w));
    return weightedPick(plans, (p) => 0.25 + p.odds) ?? plans[0];
  }

  /** hai phe quanh A và B: mỗi bên thêm ≤ 2 người thân với "thủ lĩnh" hơn bên kia */
  private splitSides(w: WorldApi, A: AgentState, B: AgentState): [string[], string[]] {
    const rest = w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr' && x.id !== A.id && x.id !== B.id);
    const sa = [A.id], sb = [B.id];
    for (const x of shuffle(rest)) {
      const da = mutual(A, x), db = mutual(B, x);
      if (da > db + 4 && sa.length < 3) sa.push(x.id);
      else if (db > da + 4 && sb.length < 3) sb.push(x.id);
    }
    return [sa, sb];
  }

  private situationActions(arc: Arc, c: StoryContext, A?: AgentState, B?: AgentState): StoryAction[] | null {
    const w = c.w;
    const def = situationDef(arc.kind);
    if (!def) return null;
    const boss = w.boss();
    const bossName = boss?.name ?? 'Sếp';
    const fill = (t: string) => fillSit(t, { a: A?.name, b: B?.name, boss: boss?.name });
    const out: StoryAction[] = [];
    const scene = (type: SceneType, data: Record<string, string | undefined>, delay = rand(1, 6), window = 90, prio: Priority = 'normal'): StoryAction =>
      ({ t: 'scene', type, delay, window, prio, data });
    const group = (note: string, exclude: string[] = [], delay = rand(4, 15)): StoryAction =>
      scene('group_chat', { reason: 'situation', note: cut(note, 220), aboutId: A?.id, exclude: exclude.join(',') }, delay, 45, 'low');
    const company = (note: string, delay = rand(2, 8)): StoryAction =>
      scene('company_chat', { reason: 'situation', note: cut(note, 220) }, delay, 45, 'low');
    const personal = def.cast !== 'none';
    switch (arc.step) {
      // ---- 1. bùng phát: dòng nhật ký + hiệu ứng + nhóm kín bàn tán (không có người trong cuộc)
      case 0: {
        if (arc.kind === 'faction_split' && A && B) {
          const [sa, sb] = this.splitSides(w, A, B);
          arc.sideA = sa;
          arc.sideB = sb;
          out.push({ t: 'rel', from: A.id, to: B.id, delta: -3, note: 'chia phe' }, { t: 'rel', from: B.id, to: A.id, delta: -3, note: 'chia phe' });
        }
        out.push({ t: 'log', icon: def.icon, text: cut(capFirst(fill(arc.note)), 150) });
        out.push(...this.fxActions(def.outbreak.fx, arc, w, undefined, def.title));
        const exclude = arc.kind === 'faction_split' ? (arc.sideB ?? []) : personal && A ? [A.id] : [];
        out.push(group(fill(def.outbreak.whisper), exclude));
        if (arc.kind === 'good_press') out.push(company(`${bossName} chia sẻ tin vui vào nhóm công ty: ${fill(arc.note)}`));
        if (arc.kind === 'investor_visit') out.push(company(`${bossName} báo trong nhóm công ty: ${fill(arc.note)}; dặn mọi người dọn bàn, ăn mặc chỉn chu`));
        if (arc.kind === 'personal_trouble' && A) {
          const friend = w.activeAgents().filter((x) => x.id !== A.id && x.role !== 'boss').sort((x, y) => mutual(A, y) - mutual(A, x))[0];
          if (friend) out.push(scene('desk_visit', { initiatorId: friend.id, targetId: A.id, why: 'hỏi han vì thấy dạo này khác lạ', tone: 'support' }, rand(10, 30)));
        }
        if (personal && A) out.push({ t: 'memory', id: A.id, text: cut(fill(arc.note), 100) });
        break;
      }
      // ---- 2. họp xử lý: AI chốt phương án (Director ghi vào arc.plan sau cảnh)
      case 1: {
        out.push(scene('crisis_meeting', { kind: arc.kind, centerId: def.meeting.withCenter ? A?.id : undefined }, rand(2, 10), 150, 'high'));
        break;
      }
      // ---- 3. triển khai theo phương án (chưa chốt thì chờ; quá lâu thì người phụ trách chốt nhanh)
      case 2: {
        if (!arc.plan) {
          // Director giữ bước này lại suốt lúc cuộc họp còn chờ / đang diễn (hold) → tới đây là cuộc họp đã xong mà chưa chốt
          // (thiếu người, hết giờ): chờ thêm một nhịp rồi người phụ trách chốt nhanh
          if ((arc.waited ?? 0) < 30) return [{ t: 'wait', minutes: 30 }];
          const pk = this.pickPlan(def, w);
          arc.plan = pk.code;
          arc.planBy = 'offline';
          out.push({ t: 'log', icon: '🧯', text: cut(`Không họp được đủ người, ${bossName} chốt nhanh qua điện thoại: ${fill(pk.label)}`, 150) });
          out.push(...this.planNowActions(arc, w));
        }
        const plan = def.plans.find((p) => p.code === arc.plan) ?? def.plans[0];
        const label = fill(plan.label);
        switch (plan.follow) {
          case 'announce':
            out.push(company(`${bossName} thông báo quyết định trong nhóm công ty: ${label}`));
            out.push(group(`Nhóm kín bàn quyết định "${label}": người thấy hợp lý, người bức xúc, có người đoán ẩn ý`, [], rand(12, 30)));
            break;
          case 'pep_all':
            out.push(scene('pep_talk', { variant: 'all', kind: arc.kind, note: label }, rand(2, 10), 120));
            break;
          case 'pep_one': {
            const target = A && A.status === 'active' ? A
              : w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr').sort((x, y) => fin(x.mood, 60) - fin(y.mood, 60))[0];
            if (!target) break;
            if (!arc.a) arc.a = target.id;
            // nói riêng: điều cần nói = chuyện của người đó + hướng đã chốt (nhãn phương án tả hành động, không phải lời thoại)
            const about = fillSit(def.meeting.topic, { a: target.name, b: B?.name, boss: boss?.name });
            out.push(scene('pep_talk', { variant: 'one', kind: arc.kind, targetId: target.id, note: cut(`${about} — hướng đã chốt: ${label}`, 200) }, rand(2, 10), 120));
            break;
          }
          case 'mediate':
            if (A && B) out.push(scene('pep_talk', { variant: 'mediate', kind: arc.kind, aId: A.id, bId: B.id, note: label }, rand(2, 10), 120));
            break;
          case 'support': {
            if (!A) break;
            const lead = (isTechRole(A.role) ? w.activeAgents().find((x) => x.role === 'techlead' && x.id !== A.id) : undefined)
              ?? (isBizRole(A.role) ? w.activeAgents().find((x) => x.role === 'saleslead' && x.id !== A.id) : undefined)
              ?? w.hr();
            if (lead && lead.id !== A.id) out.push(scene('desk_visit', { initiatorId: lead.id, targetId: A.id, why: cut(label, 90), tone: 'support' }, rand(3, 15)));
            break;
          }
          case 'sales_push': {
            const s = w.activeAgents().find((x) => x.role === 'saleslead') ?? w.activeAgents().find((x) => isBizRole(x.role));
            if (s) out.push(scene('boss_call', { reason: 'task', targetId: s.id, note: cut(label, 80) }, rand(3, 12), 90));
            const ids = w.activeAgents().filter((x) => isBizRole(x.role)).map((x) => x.id);
            if (ids.length) out.push({ t: 'overtime', ids, days: 2, minutes: 60 });
            break;
          }
          case 'overtime': {
            const ids = w.activeAgents().filter((x) => isTechRole(x.role)).map((x) => x.id);
            if (ids.length) out.push({ t: 'overtime', ids, days: 2, minutes: 90 });
            out.push(group(`Team dev phải tăng ca vì "${label}": than thở, đặt đồ ăn tối, đùa "về nhà chỉ để ngủ"`, [], rand(5, 15)));
            break;
          }
          case 'strict':
            out.push({ t: 'strict_boss', minutes: 150 });
            if (A && A.status === 'active') out.push(scene('boss_call', { reason: 'scold', targetId: A.id, note: cut(label, 80) }, rand(5, 20), 90));
            out.push(group(`Sếp siết kỷ luật sau vụ ${def.title.toLowerCase()}: cả nhóm dặn nhau giả vờ bận, đoán ai bị gọi tiếp`, A ? [A.id] : [], rand(10, 25)));
            break;
          case 'party':
            out.push(company(`${bossName} thông báo: ${label}`));
            out.push(scene('celebration', { reason: 'team_building' }, rand(20, 45), 90));
            break;
          case 'quiet':
          default:
            out.push(group(`Nhóm kín đoán già đoán non chuyện ${def.title.toLowerCase()}: sếp tính gì mà im re, có người nghe phong thanh`, personal && A ? [A.id] : [], rand(15, 40)));
            break;
        }
        break;
      }
      // ---- 4. kết cục: xác suất theo phương án + công tác tư tưởng + mức độ; AI chỉ viết thoại
      default: {
        const plan = (arc.plan && def.plans.find((p) => p.code === arc.plan)) || this.pickPlan(def, w);
        let p = plan.odds;
        if (arc.pep === 'inspired') p += 0.2;
        else if (arc.pep === 'unmoved') p -= 0.2;
        if (arc.intensity >= 3) p -= 0.1;
        else if (arc.intensity <= 1) p += 0.05;
        const good = chance(clamp(p, 0.08, 0.92));
        arc.outcome = good ? 'good' : 'bad';
        const res = good ? plan.good : plan.bad;
        const text = cut(capFirst(fill(res.text)), 150);
        out.push({ t: 'log', icon: good ? '✅' : '⚠️', text });
        out.push(...this.fxActions(res.fx, arc, w, plan, def.title));
        const center = arc.a ? w.agent(arc.a) : undefined;
        if (center && center.status === 'active') out.push({ t: 'memory', id: center.id, text: cut(`${def.title}: ${fill(res.text)}`, 100) });
        if (boss && boss.status === 'active') out.push({ t: 'memory', id: boss.id, text: cut(`Xử lý ${def.title.toLowerCase()} bằng cách ${fill(plan.label)} — ${good ? 'ổn' : 'chưa ổn'}`, 100) });
        if (!good && plan.bad.resign) {
          const who = center && center.status === 'active' && center.role !== 'boss' && center.role !== 'hr' ? center
            : w.activeAgents().filter((x) => x.role !== 'boss' && x.role !== 'hr').sort((x, y) => fin(x.mood, 60) - fin(y.mood, 60))[0];
          if (who) out.push({ t: 'resign_check', id: who.id, hint: cut(fill(res.text), 80) });
        }
        if (!good && plan.bad.hrReview) out.push({ t: 'hr_review', note: cut(`${def.title}: ${fill(res.text)}`, 120) });
        out.push(good
          ? company(`${bossName} cập nhật trong nhóm công ty: ${fill(plan.good.text)}`, rand(5, 20))
          : group(`Cả nhóm than chuyện ${def.title.toLowerCase()}: ${fill(plan.bad.text)}`, [], rand(5, 20)));
        break;
      }
    }
    return out;
  }

  /** mạch bị bỏ (người liên quan nghỉ việc / điều kiện không còn hợp lý) */
  drop(arc: Arc, day: number): void {
    if (arc.status === 'resolved' || arc.status === 'dropped') return;
    arc.status = 'dropped';
    arc.resolvedDay = day;
    this.counters.arcsDropped++;
    this.pruneArcs();
  }

  /** mạch có người này không (để drop khi người đó rời công ty) */
  arcsWith(id: string): Arc[] {
    return this.openArcs().filter((a) => a.a === id || a.b === id);
  }

  private pruneArcs(): void {
    while (this.arcs.length > MAX_ARCS_KEPT) {
      const i = this.arcs.findIndex((a) => a.status === 'resolved' || a.status === 'dropped');
      this.arcs.splice(i >= 0 ? i : 0, 1);
    }
  }

  // ---------------------------------------------------------------- lưu / khôi phục
  serialize(): unknown {
    return {
      v: 1, seq: this.seq, nextPlanAt: this.nextPlanAt, recentBeats: this.recentBeats, counters: this.counters,
      // thứ tự khoá cố định (trường được gán dần trong lúc chạy — plan, waited, a… — không làm lệch bản lưu)
      arcs: this.arcs.slice(-MAX_ARCS_KEPT).map(canonArc),
    };
  }

  restore(raw: unknown): void {
    if (!isObj(raw)) return;
    this.seq = clamp(Math.floor(fin(raw.seq, 0)), 0, 1e9);
    this.nextPlanAt = fin(raw.nextPlanAt, -1e9);
    this.recentBeats = Array.isArray(raw.recentBeats) ? raw.recentBeats.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 80)).slice(-MAX_RECENT_BEATS) : [];
    if (isObj(raw.counters)) {
      for (const k of Object.keys(this.counters) as (keyof Showrunner['counters'])[]) {
        this.counters[k] = clamp(Math.floor(fin(raw.counters[k], this.counters[k])), 0, 1e9);
      }
    }
    const arcs: Arc[] = [];
    if (Array.isArray(raw.arcs)) {
      for (const x of raw.arcs.slice(-MAX_ARCS_KEPT)) {
        if (!isObj(x)) continue;
        const kind = str(x.kind, 40);
        const id = str(x.id, 40);
        if (!BEAT_KINDS.includes(kind) || !id || arcs.some((a) => a.id === id)) continue;
        const status = x.status === 'escalated' || x.status === 'resolved' || x.status === 'dropped' ? x.status : 'started';
        const total = clamp(Math.floor(fin(x.total, 1)), 1, MAX_ARC_STEPS);
        arcs.push({
          id, kind, a: str(x.a, 80) || undefined, b: str(x.b, 80) || undefined,
          intensity: clamp(Math.round(fin(x.intensity, 1)), 1, 3), note: str(x.note, 160),
          status, createdDay: Math.floor(fin(x.createdDay, 1)), createdAt: fin(x.createdAt, 0),
          step: clamp(Math.floor(fin(x.step, 0)), 0, total), total, nextAt: fin(x.nextAt, 0),
          source: x.source === 'llm' ? 'llm' : 'offline',
          resolvedDay: typeof x.resolvedDay === 'number' && Number.isFinite(x.resolvedDay) ? x.resolvedDay : undefined,
          productId: str(x.productId, 80) || undefined,
          // v5
          plan: x.plan === 'plan_a' || x.plan === 'plan_b' || x.plan === 'plan_c' || x.plan === 'plan_d' ? x.plan : undefined,
          planBy: x.planBy === 'llm' ? 'llm' : x.planBy === 'offline' ? 'offline' : undefined,
          pep: x.pep === 'inspired' || x.pep === 'unmoved' ? x.pep : undefined,
          sideA: idList(x.sideA),
          sideB: idList(x.sideB),
          waited: Number.isFinite(x.waited) ? clamp(Math.floor(fin(x.waited, 0)), 0, 10000) : undefined,
          outcome: x.outcome === 'good' || x.outcome === 'bad' ? x.outcome : undefined,
        });
      }
    }
    this.arcs = arcs;
    // không bao giờ khôi phục quá 2 mạch mở
    let open = 0;
    for (const a of this.arcs) {
      if (a.status === 'started' || a.status === 'escalated') {
        open++;
        if (open > MAX_OPEN_ARCS) a.status = 'dropped';
      }
    }
  }
}

/** bản lưu của một mạch với thứ tự khoá cố định (khớp thứ tự restore dựng lại) */
function canonArc(a: Arc): Arc {
  return {
    id: a.id, kind: a.kind, a: a.a, b: a.b, intensity: a.intensity, note: a.note, status: a.status,
    createdDay: a.createdDay, createdAt: a.createdAt, step: a.step, total: a.total, nextAt: a.nextAt, source: a.source,
    resolvedDay: a.resolvedDay, productId: a.productId,
    plan: a.plan, planBy: a.planBy, pep: a.pep, sideA: a.sideA, sideB: a.sideB, waited: a.waited, outcome: a.outcome,
  };
}

/** mô tả ngắn gọn một mạch đã kết để ghi archive / bản tin */
export function arcSummary(arc: Arc, w: WorldApi): string {
  const n = (id?: string) => (id ? w.agent(id)?.name ?? id : '');
  const who = [n(arc.a), n(arc.b)].filter(Boolean);
  return `${cut(arc.note, 100)}${who.length ? ` (${listVi(who)})` : ''}`;
}
