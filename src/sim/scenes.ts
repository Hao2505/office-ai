// =====================================================================
//  Drama layer — registry các loại cảnh + helper chọn người + viết "tình huống"
//  (situation) tiếng Việt cho GPT. Không có thoại cứng ở đây: chỉ mô tả bối cảnh
//  và mục tiêu kịch tính; thoại do Brain (GPT / offline) viết.
// =====================================================================
import type {
  Activity, AgentState, Channel, NewsCategory, NewsItem, Priority, ProductShelf, RoleKey, SceneEffectKind, SceneRequest,
  SceneType, WorldApi,
} from '../types.js';
import type { Pt } from './map.js';
import { SPOTS, roomAt } from './map.js';
import {
  NEWS_CATEGORY_LABEL, NEWS_INTEREST, NEWS_REACTION_SEEDS, NEWS_SAFETY_RULES, pickTopic, type TopicCategory,
} from '../content/catalog.js';

// ---------------------------------------------------------------- tiện ích nhỏ
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const chance = (p: number): boolean => Math.random() < p;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function pick<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

export function weightedPick<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  const ws = items.map((it) => {
    const w = Math.max(0, fin(weight(it)));
    total += w;
    return w;
  });
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function hhmm(minuteOfDay: number): string {
  const m = ((Math.floor(fin(minuteOfDay)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function cut(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function listVi(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------- registry
export interface SceneDef {
  title: string;
  icon: string;
  channel: Channel;
  priority: Priority;
  minLines: number;
  maxLines: number;
  effects: SceneEffectKind[];
  /** có thể lồng sản phẩm affiliate (desk_visit: chỉ khi người ghé là marketing) */
  product: boolean;
  /** nhãn/emote hoạt động cho người tham gia cảnh ở văn phòng */
  label: string;
  emote: string;
  topics: TopicCategory[];
}

export const GROUP_CHAT_LABEL = 'Nhóm Zalo "Anh em văn phòng 🍻"';
export const COMPANY_CHAT_LABEL = 'Nhóm "VibeCorp – Official"';

export const SCENE_DEFS: Record<SceneType, SceneDef> = {
  pantry_chat: {
    title: 'Tám chuyện ở pantry', icon: '☕', channel: 'office', priority: 'low', minLines: 4, maxLines: 8,
    effects: ['relationship', 'mood', 'memory'], product: true, label: 'đang tám chuyện', emote: '💬',
    topics: ['doi_song', 'an_uong', 'giai_tri', 'van_phong', 'tien_bac', 'tinh_cam', 'cong_nghe'],
  },
  desk_visit: {
    title: 'Ghé bàn', icon: '🚶', channel: 'office', priority: 'low', minLines: 3, maxLines: 7,
    effects: ['relationship', 'mood', 'memory', 'kpi'], product: false, label: 'đang nói chuyện', emote: '💬',
    topics: ['van_phong', 'cong_viec_dev', 'cong_viec_sales'],
  },
  gossip: {
    title: 'Nói xấu sau lưng', icon: '🤫', channel: 'office', priority: 'low', minLines: 4, maxLines: 8,
    effects: ['relationship', 'memory', 'rumor'], product: false, label: 'đang thì thầm', emote: '🤫',
    topics: ['drama', 'tinh_cam', 'van_phong'],
  },
  group_chat: {
    title: 'Nhóm chat kín', icon: '📱', channel: 'group', priority: 'low', minLines: 4, maxLines: 9,
    effects: ['mood', 'relationship', 'memory'], product: true, label: 'đang nhắn tin', emote: '📱',
    topics: ['giai_tri', 'doi_song', 'an_uong', 'tien_bac', 'drama', 'van_phong', 'tinh_cam'],
  },
  company_chat: {
    title: 'Nhóm công ty', icon: '🏢', channel: 'company', priority: 'low', minLines: 3, maxLines: 7,
    effects: ['mood', 'memory'], product: false, label: 'đang nhắn tin', emote: '📱',
    topics: ['van_phong', 'cong_viec_sales', 'cong_viec_dev'],
  },
  standup: {
    title: 'Họp standup', icon: '🗓️', channel: 'office', priority: 'normal', minLines: 5, maxLines: 9,
    effects: ['kpi', 'mood', 'relationship', 'memory'], product: false, label: 'đang họp standup', emote: '🗓️',
    topics: ['cong_viec_dev'],
  },
  lunch: {
    title: 'Ăn trưa', icon: '🍜', channel: 'office', priority: 'normal', minLines: 5, maxLines: 9,
    effects: ['relationship', 'mood', 'memory', 'rumor'], product: true, label: 'đang ăn trưa', emote: '🍜',
    topics: ['an_uong', 'doi_song', 'tinh_cam', 'tien_bac', 'giai_tri'],
  },
  boss_catch: {
    title: 'Sếp bắt quả tang', icon: '😱', channel: 'office', priority: 'high', minLines: 3, maxLines: 6,
    effects: ['mood', 'kpi', 'relationship', 'memory'], product: false, label: 'bị sếp bắt quả tang', emote: '😱',
    topics: [],
  },
  boss_call: {
    title: 'Lên phòng sếp', icon: '📞', channel: 'office', priority: 'normal', minLines: 3, maxLines: 7,
    effects: ['mood', 'kpi', 'relationship', 'memory'], product: false, label: 'lên phòng sếp', emote: '📞',
    topics: ['van_phong'],
  },
  hr_warning: {
    title: 'HR nhắc nhở KPI', icon: '⚠️', channel: 'office', priority: 'high', minLines: 4, maxLines: 8,
    effects: ['mood', 'relationship', 'memory'], product: false, label: 'bị HR mời lên nói chuyện', emote: '⚠️',
    topics: [],
  },
  firing: {
    title: 'Cho nghỉ việc', icon: '📦', channel: 'office', priority: 'high', minLines: 5, maxLines: 9,
    effects: ['memory', 'relationship'], product: false, label: 'bị gọi lên phòng sếp', emote: '😨',
    topics: [],
  },
  interview: {
    title: 'Phỏng vấn ứng viên', icon: '🤝', channel: 'office', priority: 'high', minLines: 6, maxLines: 10,
    effects: ['verdict', 'memory', 'relationship'], product: false, label: 'đang phỏng vấn', emote: '🤝',
    topics: [],
  },
  incident: {
    title: 'Sập server!', icon: '🔥', channel: 'office', priority: 'high', minLines: 5, maxLines: 9,
    effects: ['mood', 'relationship', 'kpi'], product: false, label: 'đang cứu server', emote: '🔥',
    topics: [],
  },
  celebration: {
    title: 'Ăn mừng', icon: '🎉', channel: 'office', priority: 'normal', minLines: 5, maxLines: 9,
    effects: ['mood', 'relationship', 'memory'], product: true, label: 'đang ăn mừng', emote: '🎉',
    topics: ['an_uong', 'giai_tri'],
  },
  confront: {
    title: 'Đối chất', icon: '😤', channel: 'office', priority: 'normal', minLines: 4, maxLines: 8,
    effects: ['relationship', 'mood', 'memory'], product: false, label: 'đang đối chất', emote: '😤',
    topics: [],
  },
  pingpong_match: {
    title: 'Đánh bóng bàn', icon: '🏓', channel: 'office', priority: 'low', minLines: 3, maxLines: 6,
    effects: ['mood', 'relationship'], product: false, label: 'đang đánh bóng bàn', emote: '🏓',
    topics: ['giai_tri', 'tien_bac'],
  },
  welcome: {
    title: 'Chào người mới', icon: '👋', channel: 'office', priority: 'normal', minLines: 4, maxLines: 7,
    effects: ['relationship', 'memory'], product: false, label: 'đang chào người mới', emote: '👋',
    topics: ['van_phong'],
  },
  // v2: 2–3 người đứng ở phòng trưng bày khoe / bàn về 1 món trên kệ (sản phẩm BẮT BUỘC, đúng 1 câu product=true)
  showroom_chat: {
    title: 'Khoe đồ ở phòng trưng bày', icon: '🛍️', channel: 'office', priority: 'low', minLines: 4, maxLines: 7,
    effects: ['mood', 'relationship', 'memory'], product: true, label: 'đang ngắm đồ trên kệ', emote: '🛍️',
    topics: [],
  },
  // ---- v3 (docs/v3-news.md) — kênh của news_chat có thể bị Director đổi sang 'group' khi slot văn phòng đang bận
  news_chat: {
    title: 'Tám chuyện thời sự', icon: '🗞️', channel: 'office', priority: 'normal', minLines: 4, maxLines: 8,
    effects: ['mood', 'relationship', 'memory'], product: false, label: 'đang bàn chuyện thời sự', emote: '🗞️',
    topics: [],
  },
  hr_review: {
    title: 'Họp xét nhân sự', icon: '⚖️', channel: 'office', priority: 'high', minLines: 4, maxLines: 8,
    effects: ['decisions', 'memory', 'relationship'], product: false, label: 'đang họp xét nhân sự', emote: '⚖️',
    topics: [],
  },
  resign_talk: {
    title: 'Nói chuyện xin nghỉ', icon: '🚪', channel: 'office', priority: 'high', minLines: 5, maxLines: 9,
    effects: ['verdict', 'mood', 'relationship', 'memory'], product: false, label: 'đang nói chuyện riêng với HR', emote: '🚪',
    topics: [],
  },
  raise_request: {
    title: 'Xin tăng lương', icon: '💵', channel: 'office', priority: 'normal', minLines: 4, maxLines: 8,
    effects: ['verdict', 'mood', 'relationship', 'memory'], product: false, label: 'đang xin tăng lương', emote: '💵',
    topics: [],
  },
  promotion: {
    title: 'Thăng chức', icon: '🎖️', channel: 'office', priority: 'high', minLines: 4, maxLines: 8,
    effects: ['mood', 'relationship', 'memory'], product: false, label: 'đang nhận tin thăng chức', emote: '🎖️',
    topics: [],
  },
  layoff: {
    title: 'Cắt giảm nhân sự', icon: '📉', channel: 'office', priority: 'high', minLines: 5, maxLines: 9,
    effects: ['memory', 'relationship'], product: false, label: 'bị gọi lên phòng sếp', emote: '😟',
    topics: [],
  },
};

/** Cảnh v3 do AI quyết (kết quả nằm trong verdict / hrDecisions) */
export const VERDICT_SCENES: SceneType[] = ['interview', 'resign_talk', 'raise_request'];

export const SCENE_TYPES = Object.keys(SCENE_DEFS) as SceneType[];
export const isSceneType = (v: unknown): v is SceneType =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SCENE_DEFS, v);

// ---------------------------------------------------------------- vai trò
export const STANDUP_ROLES: RoleKey[] = ['techlead', 'senior', 'junior', 'qa', 'designer'];
export const DEV_ROLES: RoleKey[] = ['techlead', 'senior', 'junior', 'qa'];
export const TECH_ROLES: RoleKey[] = ['techlead', 'senior', 'junior', 'qa', 'designer'];
export const BIZ_ROLES: RoleKey[] = ['saleslead', 'salesnew', 'marketing'];
export const isTech = (r: RoleKey): boolean => TECH_ROLES.includes(r);
export const isBiz = (r: RoleKey): boolean => BIZ_ROLES.includes(r);
export const isStaff = (a: AgentState): boolean => a.role !== 'boss' && a.role !== 'hr';

/** người ta gọi nhau ở ngôi thứ ba trong văn bản tình huống: "sếp Hùng", "chị Ngọc (HR)"... */
export function who(a: AgentState | undefined): string {
  if (!a) return 'ai đó';
  if (a.role === 'boss') return `sếp ${a.name}`;
  return a.name;
}
export function whoRole(a: AgentState | undefined): string {
  if (!a) return 'ai đó';
  return a.role === 'boss' ? `sếp ${a.name} (Giám đốc)` : `${a.name} (${a.roleLabel})`;
}

// ---------------------------------------------------------------- mô tả trạng thái
const ACT_PHRASE: Record<Activity, string> = {
  offsite: 'không có ở văn phòng', arriving: 'vừa tới văn phòng', leaving: 'đang dọn đồ ra về',
  working: 'đang làm việc', slacking: 'đang lướt điện thoại', napping: 'đang ngủ gật trên bàn',
  coffee: 'đang pha cà phê', water: 'đang lấy nước', snack: 'đang lục đồ ăn vặt', toilet: 'đang trong toilet',
  pingpong: 'đang đánh bóng bàn', chill: 'đang nằm sofa góc chill', window: 'đang đứng ở góc cửa sổ',
  showroom: 'đang ngắm đồ ở phòng trưng bày',
  printing: 'đang in tài liệu', lunch: 'đang ăn trưa', meeting: 'đang họp', scene: 'đang nói chuyện',
  boss_office: 'đang ngồi trong phòng riêng', patrol: 'đang đi một vòng kiểm tra', away: 'đang ra ngoài',
  server_fix: 'đang cứu server', idle: 'đang đứng không',
};

/** "đang lướt TikTok", "đang giả vờ làm việc"... (ưu tiên nhãn World đặt) */
export function actPhrase(activity: Activity, label?: string): string {
  const l = cut(label ?? '', 60);
  if (!l || l === activity || /^[a-z_]+$/.test(l) || activity === 'scene' || activity === 'offsite' || activity === 'away') {
    return ACT_PHRASE[activity] ?? 'đang loanh quanh';
  }
  if (/^(đang|vừa|mới|sắp|bị|giả vờ đang)\s/i.test(l)) return l;
  return `đang ${l}`;
}

export interface ActSnap { activity: Activity; label: string; emote: string; present: boolean }
export const snapOf = (a: AgentState): ActSnap =>
  ({ activity: a.activity, label: a.activityLabel ?? '', emote: a.emote ?? '', present: a.present });

/** tính từ ngắn về thể trạng, '' nếu bình thường */
export function bodyWord(a: AgentState): string {
  const parts: string[] = [];
  const e = fin(a.energy, 70), m = fin(a.mood, 60), s = fin(a.stress, 30);
  if (e < 25) parts.push('mệt lả'); else if (e < 42) parts.push('hơi đuối');
  if (s > 78) parts.push('stress sắp nổ tung'); else if (s > 60) parts.push('đang căng thẳng');
  if (m < 30) parts.push('tâm trạng rất tệ'); else if (m < 45) parts.push('hơi cáu');
  else if (m > 82) parts.push('đang vui phơi phới');
  return parts.join(', ');
}

export const kpiPct = (a: AgentState): number =>
  a.kpiTarget > 0 ? Math.round((fin(a.kpiToday) / a.kpiTarget) * 100) : 0;

export function lastRatioPct(a: AgentState): number | null {
  const h = Array.isArray(a.kpiHistory) ? a.kpiHistory : [];
  const last = h[h.length - 1];
  return last && Number.isFinite(last.ratio) ? Math.round(last.ratio * 100) : null;
}

/** "68%, 55%, 41%" — KPI các ngày gần nhất (cũ → mới) */
export function kpiTrail(a: AgentState, n = 3): string {
  const h = Array.isArray(a.kpiHistory) ? a.kpiHistory.slice(-n) : [];
  return h.filter((x) => x && Number.isFinite(x.ratio)).map((x) => `ngày ${x.day}: ${Math.round(x.ratio * 100)}%`).join(', ');
}

export function relScore(a: AgentState | undefined, toId: string): number {
  return fin(a?.relationships?.[toId]?.score, 0);
}
export function relNote(a: AgentState | undefined, toId: string): string {
  const n = a?.relationships?.[toId]?.note;
  return typeof n === 'string' && n !== 'người mới' ? cut(n, 60) : '';
}
export function mutual(a: AgentState, b: AgentState): number {
  return Math.min(relScore(a, b.id), relScore(b, a.id));
}

/** mô tả quan hệ cặp đôi cho tình huống (kỳ phùng địch thủ, bạn thân, thần tượng...) */
export function pairDynamic(a: AgentState, b: AgentState): string {
  const ab = relScore(a, b.id), ba = relScore(b, a.id);
  const na = relNote(a, b.id), nb = relNote(b, a.id);
  const why = na || nb ? ` (${na || nb})` : '';
  if (ab <= -15 && ba <= -15) return `${a.name} và ${b.name} là kỳ phùng địch thủ${why}`;
  if (ab >= 35 && ba >= 35) return `${a.name} và ${b.name} là cặp bạn thân${why}`;
  if (ab >= 28 && ba < 15) return `${a.name} rất ngưỡng mộ ${b.name}, còn ${b.name} thì không để ý lắm${na ? ` (${na})` : ''}`;
  if (ba >= 28 && ab < 15) return `${b.name} rất ngưỡng mộ ${a.name}${nb ? ` (${nb})` : ''}`;
  if (ab <= -15) return `${a.name} đang khó chịu với ${b.name}${na ? ` (${na})` : ''}`;
  if (ba <= -15) return `${b.name} đang khó chịu với ${a.name}${nb ? ` (${nb})` : ''}`;
  if (ab >= 20 && ba >= 20) return `${a.name} và ${b.name} khá thân${why}`;
  return '';
}

/** tất cả các cặp có quan hệ đáng chú ý trong nhóm */
export function groupDynamics(people: AgentState[], max = 2): string[] {
  const out: string[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const d = pairDynamic(people[i], people[j]);
      if (d) out.push(d);
    }
  }
  return out.slice(0, max);
}

export function timeFlavor(minute: number): string {
  if (minute < 510) return 'Đầu giờ sáng, mọi người còn đang khởi động';
  if (minute < 600) return 'Giữa buổi sáng';
  if (minute < 700) return 'Gần trưa, bụng bắt đầu đói';
  if (minute < 790) return 'Giờ nghỉ trưa';
  if (minute < 870) return 'Đầu giờ chiều, ai cũng buồn ngủ';
  if (minute < 990) return 'Giữa buổi chiều';
  if (minute < 1050) return 'Sắp tan làm, ai cũng ngóng đồng hồ';
  return 'Ngoài giờ, văn phòng vắng dần';
}

export function projectBrief(w: WorldApi): string {
  const p = w.company()?.project;
  if (!p) return '';
  const left = fin(p.deadlineDay, w.day()) - w.day();
  const due = left > 1 ? `còn ${left} ngày` : left === 1 ? 'hạn là ngày mai' : left === 0 ? 'hạn chót là HÔM NAY' : `đã trễ hạn ${-left} ngày`;
  return `dự án "${cut(p.name, 50)}" (${Math.round(fin(p.progress))}%, ${due})`;
}
export function deadlineDaysLeft(w: WorldApi): number {
  const p = w.company()?.project;
  return p ? fin(p.deadlineDay, w.day() + 5) - w.day() : 99;
}

/** lý do sếp vắng, bỏ chữ "Sếp" ở đầu cho khỏi lặp */
export function bossNoteShort(w: WorldApi, max = 70): string {
  return cut(String(w.bossNote() ?? '').replace(/^\s*sếp\s+(đang\s+)?/i, ''), max);
}

/** sếp đang ở đâu: 'present' | 'away' (đi công chuyện) | 'out' (chưa tới / đã về) */
export function bossWhere(w: WorldApi): 'present' | 'away' | 'out' {
  const b = w.boss();
  if (!b) return 'out';
  if (w.bossAway()) return 'away';
  return b.present ? 'present' : 'out';
}

export function bossBrief(w: WorldApi): string {
  const b = w.boss();
  if (!b) return '';
  if (w.bossAway()) return `${who(b)} đang vắng (${bossNoteShort(w) || 'ra ngoài'})`;
  if (!b.present) return `${who(b)} không có ở văn phòng`;
  return `${who(b)} đang ở văn phòng, ${actPhrase(b.activity, b.activityLabel)}`;
}

// ---------------------------------------------------------------- vị trí / khu vực
export const SPOT_LABELS: Record<string, string> = {
  coffee: 'Góc máy pha cà phê', fridge: 'Tủ lạnh pantry', water: 'Cây nước pantry', snack: 'Kệ đồ ăn vặt',
  pantry_table: 'Bàn ăn pantry', lounge: 'Góc chill', toilet: 'Khu WC', pingpong: 'Bàn bóng bàn ở sảnh',
  printer: 'Máy in ở sảnh', window: 'Góc cửa sổ', meeting: 'Phòng họp', boss_visit: 'Phòng Giám đốc',
  server: 'Phòng server', kpi_board: 'Trước bảng KPI', entrance: 'Cửa ra vào',
  showroom_beauty: 'Kệ làm đẹp (phòng trưng bày)', showroom_tech: 'Kệ công nghệ (phòng trưng bày)',
};

export type Area = 'pantry' | 'lounge' | 'window' | 'kpi_board' | 'printer';
export const AREA_LABELS: Record<Area, string> = {
  pantry: 'Pantry', lounge: 'Góc chill', window: 'Góc cửa sổ', kpi_board: 'Trước bảng KPI', printer: 'Máy in ở sảnh',
};

/** khu vực "tụ tập" của 1 người (null nếu không ở chỗ tám chuyện được) */
export function areaOf(a: AgentState): Area | null {
  if (!a.present) return null;
  if (a.activity === 'window') return 'window';
  const p = { x: a.x, y: a.y };
  if ((SPOTS.kpi_board ?? []).some((s) => dist(s, p) <= 1.6)) return 'kpi_board';
  if (a.activity === 'printing') return 'printer';
  const room = roomAt(a.x, a.y)?.id;
  if (room === 'pantry') return 'pantry';
  if (room === 'lounge') return 'lounge';
  if (a.activity === 'coffee' || a.activity === 'water' || a.activity === 'snack') return 'pantry';
  if (a.activity === 'chill') return 'lounge';
  if ((SPOTS.window ?? []).some((s) => dist(s, p) <= 2.5)) return 'window';
  return null;
}

/** các nhóm chủ đề hợp với người tham gia (để pickTopic đa dạng) */
export function topicCatsFor(people: AgentState[], base: TopicCategory[]): TopicCategory[] {
  const set = new Set<TopicCategory>(base);
  if (people.some((p) => isTech(p.role)) && chance(0.5)) { set.add('cong_viec_dev'); set.add('cong_nghe'); }
  if (people.some((p) => isBiz(p.role)) && chance(0.5)) { set.add('cong_viec_sales'); set.add('tien_bac'); }
  return [...set];
}

export function safeTopic(cats: TopicCategory[], exclude: string[]): string | undefined {
  try {
    const t = pickTopic(cats.length ? cats : undefined, exclude);
    return typeof t === 'string' && t.trim() ? t.trim() : undefined;
  } catch {
    return undefined;
  }
}

// =====================================================================
//  Chọn người tham gia (thuần, không đổi state). `free` = điều kiện rảnh của
//  Director (có mặt, không trong cảnh, không bận điện thoại, cooldown...).
// =====================================================================
export type FreeFn = (a: AgentState) => boolean;

export function atDesk(w: WorldApi, a: AgentState): boolean {
  try {
    return a.present && dist(w.deskSeat(a.id), a) <= 1.6;
  } catch {
    return false;
  }
}

/** đang làm/lười/ngủ tại bàn — có thể bị ghé bàn */
export function sittingAtDesk(w: WorldApi, a: AgentState): boolean {
  return (a.activity === 'working' || a.activity === 'slacking' || a.activity === 'napping' || a.activity === 'idle')
    && w.isArrived(a.id) && atDesk(w, a);
}

const CATCHABLE: Activity[] = ['slacking', 'napping', 'pingpong', 'chill'];

// ---------------------------------------------------------------- tụ tập tự nhiên
export interface CoLocation { area: Area; people: AgentState[] }

export function findCoLocated(w: WorldApi, free: FreeFn): CoLocation | null {
  const groups = new Map<Area, AgentState[]>();
  for (const a of w.activeAgents()) {
    if (!free(a) || !w.isArrived(a.id)) continue;
    if (a.role === 'boss' && chance(0.7)) continue; // sếp hiếm khi đứng tám
    const area = areaOf(a);
    if (!area) continue;
    const list = groups.get(area) ?? [];
    list.push(a);
    groups.set(area, list);
  }
  const options: CoLocation[] = [];
  for (const [area, list] of groups) {
    if (list.length < 2) continue;
    const seed = pick(list)!;
    const radius = area === 'pantry' || area === 'lounge' ? 10 : 5.5;
    const near = shuffle(list.filter((o) => o === seed || dist(o, seed) <= radius));
    if (near.length < 2) continue;
    near.sort((x, y) => (x === seed ? -1 : y === seed ? 1 : 0));
    const size = near.length >= 3 && chance(0.45) ? 3 : 2;
    options.push({ area, people: near.slice(0, size) });
  }
  return pick(options) ?? null;
}

// ---------------------------------------------------------------- ghé bàn: động cơ theo cặp vai trò
export interface Motive {
  key: string;
  from: RoleKey | '*';
  to: RoleKey[] | '*';
  w: number;
  /** việc người ghé muốn làm ({project} = tên dự án) */
  acts: string[];
  /** mục tiêu kịch tính cho GPT */
  goal: string;
  topics: TopicCategory[];
}

export const MOTIVES: Motive[] = [
  {
    key: 'qa_bug', from: 'qa', to: ['techlead', 'senior', 'junior'], w: 1.7,
    acts: ['báo một bug mới tìm thấy trong {project}', 'khịa đoạn code vừa được push lên', 'hỏi vì sao bug báo từ hôm qua vẫn chưa ai fix', 'đưa video quay màn hình làm bằng chứng bug'],
    goal: 'dev chống chế ("máy anh chạy được mà", "đó là feature"), QA khịa lại sắc lẻm có dẫn chứng; chốt bằng một bên chịu thua hoặc hẹn "để mai fix"',
    topics: ['cong_viec_dev'],
  },
  {
    key: 'sales_promise', from: 'saleslead', to: ['techlead', 'senior'], w: 1.6,
    acts: ['báo tin vừa hứa với khách thêm một tính năng mới trước deadline', 'xin dời deadline sớm lên vì khách VIP hối', 'nhờ chuẩn bị demo gấp cho khách chiều nay', 'hỏi "sửa chút xíu thôi mà" cho khách'],
    goal: 'sales nói ngọt "anh lo được hết", dev cáu vì bị hứa bừa; mặc cả qua lại, chốt bằng một thỏa hiệp gượng ép hoặc một câu khịa đau',
    topics: ['cong_viec_sales', 'cong_viec_dev'],
  },
  {
    key: 'design_pixel', from: 'designer', to: ['senior', 'junior', 'techlead'], w: 1.4,
    acts: ['bắt lỗi giao diện lệch 2px so với bản thiết kế', 'chê màu nút "chưa đủ vibe" và đòi sửa', 'đòi làm lại animation cho mượt hơn', 'phát hiện dev tự đổi font chữ'],
    goal: 'designer bảo vệ "vibe" tới cùng, dev than vì sửa mãi; cãi nhau vui, chốt bằng một bên nhượng bộ trong ấm ức',
    topics: ['cong_viec_dev', 'cong_nghe'],
  },
  {
    key: 'dev_design', from: 'senior', to: ['designer'], w: 0.9,
    acts: ['than bản thiết kế mới khó code', 'hỏi sao thiết kế đổi lần thứ ba trong tuần', 'xin bỏ bớt hiệu ứng cho kịp deadline'],
    goal: 'dev lý sự về kỹ thuật, designer lý sự về trải nghiệm người dùng; không ai chịu ai',
    topics: ['cong_viec_dev'],
  },
  {
    key: 'junior_ask', from: 'junior', to: ['senior', 'techlead'], w: 1.6,
    acts: ['hỏi bài vì đoạn code chạy lỗi mà không hiểu tại sao', 'nhờ fix lỗi trong đoạn code chép từ ChatGPT', 'xin review pull request đầu tiên trong tuần', 'hỏi git bị conflict thì làm sao'],
    goal: 'người hỏi ngây ngô kiểu Gen Z, người được hỏi vừa chỉ vừa khịa (hoặc lười chỉ, đẩy qua người khác); có một câu hài về ChatGPT',
    topics: ['cong_viec_dev', 'cong_nghe'],
  },
  {
    key: 'junior_design', from: 'junior', to: ['designer'], w: 0.7,
    acts: ['xin file thiết kế bản mới nhất', 'hỏi icon này lấy ở đâu'],
    goal: 'trao đổi ngắn, designer tranh thủ dặn đủ thứ "vibe"',
    topics: ['cong_viec_dev'],
  },
  {
    key: 'lead_review', from: 'techlead', to: ['junior', 'senior', 'qa'], w: 1.5,
    acts: ['review code và phát hiện có người push thẳng lên main', 'hối tiến độ vì {project} sắp tới hạn', 'hỏi sao task hôm qua vẫn chưa xong', 'nhắc viết test trước khi merge'],
    goal: 'techlead gắt, nói thẳng nhưng thật ra quan tâm; người bị hỏi chống chế; chốt bằng một deadline cụ thể',
    topics: ['cong_viec_dev'],
  },
  {
    key: 'mkt_banner', from: 'marketing', to: ['designer'], w: 1.5,
    acts: ['xin gấp banner cho chiến dịch mới', 'nhờ chỉnh thumbnail TikTok cho "trend" hơn', 'rủ quay clip hậu trường văn phòng'],
    goal: 'marketing nài nỉ đủ kiểu, designer than quá tải nhưng mềm lòng vì là bạn; tám thêm một chuyện ngoài lề',
    topics: ['giai_tri', 'van_phong'],
  },
  {
    key: 'mkt_sales', from: 'marketing', to: ['saleslead', 'salesnew'], w: 1.0,
    acts: ['xin số liệu khách hàng để làm bài case study', 'bàn kịch bản livestream bán BánNhanh POS', 'hỏi khách nào chịu quay video review'],
    goal: 'hai bên trao đổi công việc nhưng lạc đề sang chuyện khác; có màn chém gió',
    topics: ['cong_viec_sales'],
  },
  {
    key: 'mkt_any', from: 'marketing', to: '*', w: 0.9,
    acts: ['rủ săn sale Shopee giờ vàng', 'nhờ đóng thế một clip TikTok theo trend mới', 'khoe món đồ vừa mua online', 'xin ý kiến cho caption bài đăng'],
    goal: 'marketing rủ rê nhiệt tình, người kia từ chối yếu ớt rồi cũng bị cuốn theo',
    topics: ['giai_tri', 'tien_bac'],
  },
  {
    key: 'hr_probe', from: 'hr', to: '*', w: 0.9,
    acts: ['làm khảo sát mức độ hài lòng nơi làm việc', 'nhắc chấm công và nộp giấy tờ còn thiếu', 'dò la xem dạo này văn phòng có tin gì hot', 'hỏi han "dạo này em ổn không" kèm cuốn sổ'],
    goal: 'HR ngọt ngào nhưng ghi chép mọi thứ; người bị hỏi trả lời dè chừng, sợ lỡ lời',
    topics: ['van_phong', 'drama'],
  },
  {
    key: 'new_sales_tip', from: 'salesnew', to: ['saleslead'], w: 1.2,
    acts: ['xin bí kíp chốt đơn vì KPI đang thấp', 'hỏi cách trả lời khách khó tính', 'nhờ đi gặp khách cùng'],
    goal: 'đàn anh chém gió bí kíp "nói ngọt, hứa trước tính sau", đàn em gật gù nhưng không làm theo nổi',
    topics: ['cong_viec_sales', 'tien_bac'],
  },
  {
    key: 'new_sales_game', from: 'salesnew', to: ['junior', 'marketing'], w: 1.0,
    acts: ['rủ làm một trận game mobile', 'mượn sạc điện thoại vì lại hết pin', 'rủ order trà sữa'],
    goal: 'rủ rê trốn việc, người kia vừa muốn vừa sợ bị bắt; nhắc tới KPI thấp như một trò đùa',
    topics: ['giai_tri', 'an_uong'],
  },
  {
    key: 'senior_feature', from: 'senior', to: ['qa'], w: 1.4,
    acts: ['giải thích rằng "đó không phải bug mà là feature"', 'năn nỉ đóng bớt mấy ticket bug cho đẹp báo cáo', 'hỏi ai cho phép test trên môi trường production'],
    goal: 'senior ngụy biện lười biếng, QA không tha, khịa qua lại kiểu "yêu nhau lắm cắn nhau đau"',
    topics: ['cong_viec_dev'],
  },
  {
    key: 'lead_sales', from: 'saleslead', to: ['salesnew', 'marketing'], w: 1.0,
    acts: ['hối số liệu chốt đơn tuần này', 'khoe vừa đi nhậu với khách tới khuya', 'giao thêm danh sách khách cần gọi'],
    goal: 'trưởng nhóm vừa hối vừa khoe, người kia dạ vâng nhưng lườm thầm',
    topics: ['cong_viec_sales', 'tien_bac'],
  },
  {
    key: 'any_borrow', from: '*', to: '*', w: 0.55,
    acts: ['mượn đồ (sạc, tai nghe, cái kéo)', 'rủ đặt trà sữa chung cho được freeship', 'hỏi han chuyện tối qua', 'trả lại món đồ mượn từ tuần trước'],
    goal: 'chuyện phiếm vài câu, có một câu đùa, rồi ai về việc nấy',
    topics: ['doi_song', 'an_uong', 'giai_tri'],
  },
];

export function motiveAct(m: Motive, w: WorldApi): string {
  const act = pick(m.acts) ?? m.acts[0];
  const p = w.company()?.project;
  return act.replace('{project}', p ? `dự án "${cut(p.name, 40)}"` : 'dự án đang làm');
}

export function motivesFor(from: RoleKey, to: RoleKey): Motive[] {
  return MOTIVES.filter((m) => (m.from === '*' || m.from === from) && (m.to === '*' || m.to.includes(to)));
}

export interface DeskVisitPick { initiator: AgentState; target: AgentState; motive: Motive }

export function pickDeskVisit(
  w: WorldApi, free: FreeFn,
  opts: { initiatorId?: string; targetId?: string; motiveKey?: string } = {},
): DeskVisitPick | null {
  const people = w.activeAgents().filter((a) => a.role !== 'boss' && free(a));
  const initiators = people.filter((a) => (!opts.initiatorId || a.id === opts.initiatorId)
    && a.activity !== 'napping' && a.activity !== 'toilet' && a.activity !== 'server_fix' && a.activity !== 'arriving');
  const targets = people.filter((a) => (!opts.targetId || a.id === opts.targetId) && sittingAtDesk(w, a));
  const options: { p: DeskVisitPick; wt: number }[] = [];
  for (const i of initiators) {
    const iFactor = 0.6 + 0.4 * fin(i.traits?.humor) + 0.3 * fin(i.traits?.gossip) + 0.2 * fin(i.traits?.ambition);
    for (const t of targets) {
      if (t.id === i.id) continue;
      let ms = motivesFor(i.role, t.role);
      if (opts.motiveKey) ms = ms.filter((m) => m.key === opts.motiveKey);
      for (const m of ms) {
        const r = relScore(i, t.id);
        let wt = m.w * iFactor * (1 + Math.abs(r) / 40);
        if (r < -10) wt *= 1.3; // kỳ phùng địch thủ hay "va" nhau
        if (t.activity === 'slacking' || t.activity === 'napping') wt *= 1.25;
        options.push({ p: { initiator: i, target: t, motive: m }, wt });
      }
    }
  }
  return weightedPick(options, (o) => o.wt)?.p ?? null;
}

// ---------------------------------------------------------------- nói xấu
export function pickGossipPair(w: WorldApi, free: FreeFn): { a: AgentState; b: AgentState } | null {
  const pool = w.activeAgents().filter((a) => a.role !== 'boss' && free(a)
    && a.activity !== 'napping' && a.activity !== 'server_fix');
  const pairs: { a: AgentState; b: AgentState; wt: number }[] = [];
  for (const a of pool) {
    const g = fin(a.traits?.gossip, 0.4);
    for (const b of pool) {
      if (b.id === a.id) continue;
      const m = mutual(a, b);
      if (m < 10) continue;
      pairs.push({ a, b, wt: (0.2 + g * g) * (1 + m / 30) });
    }
  }
  const p = weightedPick(pairs, (x) => x.wt);
  return p ? { a: p.a, b: p.b } : null;
}

/** chọn người bị nói xấu: không ưa + có "phốt" trong ngày */
export function pickGossipSubject(
  w: WorldApi, a: AgentState, b: AgentState, interest: (x: AgentState) => number,
  /** số tin đồn gần đây về x — người "mới" được ưu tiên để đỡ lặp */
  rumorsAbout: (x: AgentState) => number = () => 0,
): AgentState | null {
  const cands = w.agents().filter((x) => x.id !== a.id && x.id !== b.id && x.status !== 'fired');
  return weightedPick(cands, (x) => {
    const dislike = Math.max(0, -(relScore(a, x.id) + relScore(b, x.id)) / 2);
    let wt = (0.5 + dislike / 15 + interest(x)) / (1 + rumorsAbout(x));
    if (x.role === 'boss') wt += w.bossAway() ? 0.6 : 0.15;
    if (x.status === 'candidate') wt *= 0.3;
    if (x.present && (dist(x, a) < 5 || dist(x, b) < 5)) wt *= 0.4; // đang đứng gần thì ngại
    return wt;
  }) ?? null;
}

// ---------------------------------------------------------------- nhóm chat
export function pickGroupMembers(
  w: WorldApi, free: FreeFn, opts: { must?: string[]; exclude?: string[]; min?: number; max?: number } = {},
): AgentState[] | null {
  const min = opts.min ?? 3, max = opts.max ?? 5;
  const ex = new Set(opts.exclude ?? []);
  const pool = w.activeAgents().filter((a) => a.role !== 'boss' && !ex.has(a.id) && free(a));
  const must = pool.filter((a) => opts.must?.includes(a.id));
  const rest = pool.filter((a) => !must.includes(a) && (a.role !== 'hr' || chance(0.25)));
  const size = clamp(randInt(min, max), min, Math.min(max, must.length + rest.length));
  if (must.length + rest.length < min) return null;
  const chosen = [...must];
  while (chosen.length < size && rest.length) {
    const nxt = weightedPick(rest, (x) => 0.3 + 0.6 * fin(x.traits?.gossip) + 0.4 * fin(x.traits?.humor)
      + chosen.reduce((s, c) => s + Math.max(0, relScore(x, c.id)) / 40, 0));
    if (!nxt) break;
    chosen.push(nxt);
    rest.splice(rest.indexOf(nxt), 1);
  }
  return chosen.length >= min ? chosen : null;
}

export function pickCompanyChat(
  w: WorldApi, freeStaff: FreeFn, bossFree: (b: AgentState) => boolean, opts: { must?: string[] } = {},
): AgentState[] | null {
  const boss = w.boss();
  if (!boss || boss.status !== 'active' || !bossFree(boss)) return null;
  const pool = w.activeAgents().filter((a) => a.role !== 'boss' && freeStaff(a));
  const must = pool.filter((a) => opts.must?.includes(a.id));
  const rest = pool.filter((a) => !must.includes(a));
  const size = clamp(randInt(2, 4), 2, must.length + rest.length);
  if (must.length + rest.length < 2) return null;
  const chosen = [...must];
  while (chosen.length < size && rest.length) {
    const nxt = weightedPick(rest, (x) => 0.3 + fin(x.traits?.ambition) + (x.role === 'hr' ? 0.4 : 0));
    if (!nxt) break;
    chosen.push(nxt);
    rest.splice(rest.indexOf(nxt), 1);
  }
  return [boss, ...chosen];
}

// ---------------------------------------------------------------- ăn trưa / ăn mừng
export function pickFriendsGroup(
  pool: AgentState[], size: number, seed?: AgentState,
): AgentState[] {
  const rest = pool.filter((a) => a !== seed);
  const first = seed ?? weightedPick(rest, (a) => 0.5 + fin(a.traits?.gossip) + fin(a.traits?.humor));
  if (!first) return [];
  const chosen = [first];
  const left = rest.filter((a) => a !== first);
  while (chosen.length < size && left.length) {
    const nxt = weightedPick(left, (x) => 1 + chosen.reduce((s, c) => s + Math.max(-8, relScore(x, c.id) + relScore(c, x.id)) / 25, 0));
    if (!nxt) break;
    chosen.push(nxt);
    left.splice(left.indexOf(nxt), 1);
  }
  return chosen;
}

// ---------------------------------------------------------------- bóng bàn / bắt quả tang
export function findPingpongPair(w: WorldApi, free: FreeFn): [AgentState, AgentState] | null {
  const ps = w.activeAgents().filter((a) => a.activity === 'pingpong' && free(a) && w.isArrived(a.id));
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (dist(ps[i], ps[j]) <= 9) return chance(0.5) ? [ps[i], ps[j]] : [ps[j], ps[i]];
    }
  }
  return null;
}

export function nearbySlacker(w: WorldApi, victim: AgentState, free: FreeFn, minuteOfDay: number): AgentState | null {
  const lunchNap = minuteOfDay >= 720 && minuteOfDay < 795;
  const near = w.activeAgents().filter((a) => a.id !== victim.id && a.role !== 'boss' && free(a)
    && CATCHABLE.includes(a.activity) && !(a.activity === 'napping' && lunchNap) && dist(a, victim) <= 5);
  near.sort((x, y) => dist(x, victim) - dist(y, victim));
  return near[0] ?? null;
}

// =====================================================================
//  Viết "tình huống" (situation) + bối cảnh thêm (extra) cho từng loại cảnh.
//  Prompt của Brain đã có sẵn: giờ, sếp, dự án, hoạt động/thể trạng/KPI/cảm xúc/
//  ký ức từng người. Ở đây tập trung vào MỤC TIÊU kịch tính + chi tiết sống.
// =====================================================================
export interface SitKit {
  w: WorldApi;
  /** chi tiết sống động hôm nay về 1 người (đi trễ, mấy ly cà phê, mới bị bắt...) */
  facts: (a: AgentState) => string[];
  /** vài sự kiện đáng chú ý gần đây trong ngày (đã rút gọn, cũ → mới) */
  recent: string[];
  /** ảnh chụp hoạt động trước khi vào cảnh (vì vào cảnh thì activity thành 'scene') */
  snap: (id: string) => ActSnap | undefined;
}
export interface Situation { situation: string; extra: string[] }

function actOf(k: SitKit, a: AgentState): string {
  const s = k.snap(a.id);
  return s ? actPhrase(s.activity, s.label) : actPhrase(a.activity, a.activityLabel);
}

function withBody(a: AgentState): string {
  const b = bodyWord(a);
  return b ? ` (${b})` : '';
}

/** dòng "bối cảnh thêm": chi tiết từng người, 1 thói quen để lồng, chuyện mới trong ngày */
export function commonExtra(k: SitKit, people: AgentState[], opts: { recent?: number; quirk?: boolean; about?: AgentState } = {}): string[] {
  const out: string[] = [];
  const all = opts.about ? [...people, opts.about] : people;
  for (const p of all) {
    const f = k.facts(p);
    if (f.length) out.push(`${p.name}: ${f.slice(0, 3).join('; ')}`);
  }
  if (opts.quirk !== false && chance(0.5)) {
    const p = pick(people.filter((x) => Array.isArray(x.quirks) && x.quirks.length));
    const q = p ? pick(p.quirks) : undefined;
    if (p && q) out.push(`Có thể lồng thói quen của ${p.name}: ${cut(q, 100)}`);
  }
  const n = opts.recent ?? 1;
  if (n > 0) for (const r of k.recent.slice(-n)) out.push(`Chuyện mới trong ngày: ${cut(r, 130)}`);
  return out.slice(0, 6);
}

function joinSit(parts: (string | false | null | undefined)[]): string {
  return cut(parts.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim().replace(/[.。]+$/, '')).join('. ') + '.', 690);
}

function bossMood(k: SitKit, people: AgentState[]): string {
  const w = k.w;
  if (people.some((p) => p.role === 'boss')) return 'Có sếp đứng đây nên ai cũng giữ ý, nịnh khéo, nhưng vẫn lộ chút thật lòng';
  if (w.bossAway()) return pick(['Sếp đang vắng nên ai cũng thả lỏng', `Sếp vắng (${bossNoteShort(w, 50)}) nên nói chuyện thoải mái hơn`]) ?? '';
  const b = w.boss();
  if (b && b.present && b.activity === 'patrol') return 'Sếp đang đi tuần quanh văn phòng nên thỉnh thoảng phải liếc chừng';
  return '';
}

// ---------------------------------------------------------------- pantry_chat
const PANTRY_GOALS = [
  'tám chuyện tự nhiên như đồng nghiệp tình cờ gặp nhau: than chuyện việc rồi lạc đề sang chuyện đời, chốt bằng một câu hài',
  'một người kể chuyện vừa nghe được, người kia hóng hớt và bình luận chua cay',
  'khịa nhau về thói quen của từng người, ai cũng có miếng, không ai giận thật',
  'rủ rê kéo dài giờ giải lao thêm chút nữa, vừa nói vừa canh chừng',
  'than mệt, than áp lực; người kia an ủi kiểu bá đạo và hiến một kế trời ơi',
  'tranh luận một chuyện vặt (ăn gì, xem gì, mua gì) mà căng như họp',
];

export function sitPantry(k: SitKit, area: Area, people: AgentState[]): Situation {
  const where = AREA_LABELS[area];
  const acts = people.map((p) => `${who(p)} ${actOf(k, p)}${withBody(p)}`);
  return {
    situation: joinSit([
      `${timeFlavor(k.w.minuteOfDay())}. Ở ${where}: ${listVi(acts)}`,
      ...groupDynamics(people),
      bossMood(k, people),
      `Mục tiêu: ${pick(PANTRY_GOALS)}`,
    ]),
    extra: commonExtra(k, people),
  };
}

// ---------------------------------------------------------------- desk_visit
/**
 * tone (v3, mạch truyện): 'tense' = hai người đang bất đồng (cãi căng, không ai chịu ai);
 * 'warm' = đang thân nhau bất ngờ (nói chuyện vui, lộ sở thích chung); 'makeup' = làm hoà sau cãi vã.
 */
export type VisitTone = 'tense' | 'warm' | 'makeup';

export function sitDeskVisit(k: SitKit, i: AgentState, t: AgentState, m: Motive, act: string, why?: string, tone?: VisitTone): Situation {
  const tAct = actOf(k, t);
  const snap = k.snap(t.id);
  const react = snap?.activity === 'napping' ? `${t.name} bị đánh thức, ngái ngủ`
    : snap?.activity === 'slacking' ? `${t.name} giật mình giấu điện thoại`
      : '';
  const urgent = isTech(t.role) && isTech(i.role) && deadlineDaysLeft(k.w) <= 1 ? `Deadline ${projectBrief(k.w)} đang rất gấp` : '';
  const goal = tone === 'tense'
    ? `hai bên đang bất đồng thật, lời qua tiếng lại căng dần, mỗi người bảo vệ lý của mình, có một câu nói hơi quá; chốt bằng một bên bỏ đi hoặc "để sếp quyết" — không ai chịu ai`
    : tone === 'warm'
      ? `bất ngờ phát hiện sở thích chung, nói chuyện vui hơn thường ngày, hẹn hò nhau (ăn trưa, cà phê) — tình bạn mới chớm, trong sáng; người khác đi ngang liếc nhìn`
      : tone === 'makeup'
        ? `sau vụ cãi nhau trước đó, ${i.name} tới làm hoà vụng về (mang trà sữa, nói vòng vo); ${t.name} còn giận nhưng mềm dần; chốt bằng câu đùa, quan hệ ấm lại`
        : m.goal;
  return {
    situation: joinSit([
      `${whoRole(i)} đi tới bàn ${whoRole(t)} để ${act}${why ? ` (${why})` : ''}`,
      `Lúc đó ${t.name} ${tAct}${withBody(t)}`,
      react,
      pairDynamic(i, t),
      urgent,
      `Mục tiêu: ${goal}`,
    ]),
    extra: commonExtra(k, [i, t]),
  };
}

// ---------------------------------------------------------------- gossip
const GOSSIP_GOALS = [
  'đoán già đoán non lý do thật sự đằng sau, mỗi câu lại phóng đại thêm một chút',
  'lôi chuyện cũ ra so sánh rồi đi tới một kết luận vô lý mà nghe rất thuyết phục',
  'một người bênh nhẹ, người kia càng thêm mắm muối; chốt bằng "nói nhỏ thôi, người ta nghe kìa"',
  'vừa nói xấu vừa tự nhận mình "không phải người nhiều chuyện"',
];

export function subjectFacts(k: SitKit, c: AgentState, lowRatio: number): string[] {
  const f: string[] = [];
  if (c.status === 'candidate') f.push('đang là ứng viên phỏng vấn');
  if (isStaff(c) && c.status === 'active') {
    const pct = kpiPct(c);
    if (k.w.minuteOfDay() >= 660 && pct < 60) f.push(`KPI hôm nay mới ${pct}%`);
    if (c.lowStreak > 0) f.push(`${c.lowStreak} ngày liền KPI dưới ${Math.round(lowRatio * 100)}%`);
    if (c.warnings > 0) f.push(`đã bị HR nhắc ${c.warnings} lần`);
  }
  if (c.caughtToday > 0) f.push(`hôm nay bị sếp bắt quả tang ${c.caughtToday} lần`);
  f.push(...k.facts(c));
  if (c.role === 'boss' && k.w.bossAway()) f.push(`đang "${bossNoteShort(k.w, 60)}"`);
  return f.slice(0, 5);
}

export function sitGossip(
  k: SitKit, a: AgentState, b: AgentState, c: AgentState, where: string,
  rumor: { isNew: boolean; text: string }, lowRatio: number,
): Situation {
  const cWhere = c.present ? `${c.name} ${actPhrase(c.activity, c.activityLabel)} ở chỗ khác, không nghe thấy` : `${c.name} không có ở văn phòng`;
  const facts = subjectFacts(k, c, lowRatio);
  const feel: string[] = [];
  for (const p of [a, b]) {
    const s = relScore(p, c.id);
    const n = relNote(p, c.id);
    if (s <= -10 || n) feel.push(`${p.name} ${s <= -10 ? 'không ưa' : 'nghĩ về'} ${c.name}${n ? ` (${n})` : ''}`);
  }
  return {
    situation: joinSit([
      `${a.name} kéo ${b.name} ra ${where} nói nhỏ về ${whoRole(c)} — ${cWhere}`,
      facts.length ? `Phốt của ${c.name}: ${facts.join('; ')}` : '',
      ...feel.slice(0, 2),
      rumor.isNew ? `${a.name} là người tung tin mới (vô hại, hơi phóng đại) dựa trên các chi tiết trên` : `${a.name} kể lại tin đồn đã nghe từ người khác, có sửa chi tiết cho "hấp dẫn" hơn`,
      `Mục tiêu: ${pick(GOSSIP_GOALS)}`,
    ]),
    extra: commonExtra(k, [a, b], { recent: 1 }),
  };
}

// ---------------------------------------------------------------- group_chat
export type GroupReason =
  | 'random' | 'boss_left' | 'boss_back' | 'after_catch' | 'after_firing' | 'after_warning' | 'payday'
  | 'wifi_down' | 'server_down' | 'deal' | 'release' | 'lunch_plan' | 'end_of_day' | 'new_hire' | 'late'
  | 'deadline' | 'birthday' | 'kpi_risk'
  // v3: hậu quả của quyết định nhân sự / mạch truyện do AI biên kịch lên
  | 'after_resign' | 'after_layoff' | 'after_promotion' | 'after_probation' | 'karaoke' | 'overtime' | 'prank' | 'viral'
  | 'client_angry' | 'sick' | 'boss_mood' | 'conflict' | 'resign_hint' | 'lost_item' | 'crush' | 'news';
export const GROUP_REASONS: GroupReason[] = ['random', 'boss_left', 'boss_back', 'after_catch', 'after_firing',
  'after_warning', 'payday', 'wifi_down', 'server_down', 'deal', 'release', 'lunch_plan', 'end_of_day', 'new_hire',
  'late', 'deadline', 'birthday', 'kpi_risk',
  'after_resign', 'after_layoff', 'after_promotion', 'after_probation', 'karaoke', 'overtime', 'prank', 'viral',
  'client_angry', 'sick', 'boss_mood', 'conflict', 'resign_hint', 'lost_item', 'crush', 'news'];
export interface ReasonData {
  name?: string; label?: string; note?: string;
  /** id người được nhắc (vd người vừa bị đuổi) → Director đặt làm aboutId nếu người đó không ở trong nhóm chat */
  id?: string;
}

const GROUP_TEXT: Record<GroupReason, (d: ReasonData) => string> = {
  random: () => pick([
    'Nhóm chat đang im thì có người khơi một chuyện, cả nhóm nhảy vào bàn tán, thả emoji và cà khịa nhau',
    'Một người gửi ảnh/clip vào nhóm, cả nhóm bình luận rôm rả rồi lạc đề hoàn toàn',
    'Có người than một chuyện trong ngày, cả nhóm vào an ủi kiểu bá đạo và hiến kế trời ơi',
    'Có người hỏi một câu tưởng nghiêm túc, cả nhóm trả lời toàn meme',
  ]) ?? '',
  boss_left: (d) => `Sếp vừa ra ngoài (${d.note || 'gặp đối tác'}). Có người báo ngay "sếp đi rồi anh em ơi" — cả nhóm rủ trốn việc, đặt trà sữa, đánh bóng bàn; có người lo sếp quay về bất chợt`,
  boss_back: () => 'Sếp vừa về bất ngờ! Cả nhóm nhắn báo động, ai đang lười thì giả vờ làm việc, khịa người suýt bị bắt',
  after_catch: (d) => `${d.name} vừa bị sếp bắt quả tang đang ${d.label || 'lười'}. Cả nhóm vào khịa, an ủi giả trân, đoán xem có bị trừ lương không`,
  after_firing: (d) => `${d.name} vừa bị cho nghỉ việc. Cả nhóm sốc, kể lại chi tiết nghe được, lo không biết ai là người tiếp theo, đoán người mới sẽ thế nào`,
  after_warning: (d) => `${d.name} vừa bị HR mời lên phòng họp nhắc nhở KPI. Cả nhóm hóng chuyện, hỏi han, có người chột dạ lo cho mình`,
  payday: () => 'Lương vừa về tài khoản! Cả nhóm khoe, tính chuyện tiêu tiền, săn sale, trả nợ thẻ tín dụng, rủ đi ăn',
  wifi_down: () => 'Văn phòng vừa mất wifi, ai cũng phải bật 4G nhắn tin than thở, đổ lỗi lung tung, có người mừng thầm vì có cớ nghỉ tay',
  server_down: () => 'Server đang sập, team kinh doanh nhắn khịa team dev, dev bận cứu server trả lời cộc lốc',
  deal: (d) => `${d.name} vừa chốt được hợp đồng. Cả nhóm vào chúc mừng, đòi khao trà sữa; có người ghen tị nhẹ`,
  release: (d) => `Vừa release ${d.note ? `"${d.note}"` : 'bản mới'}. Cả nhóm vừa mừng vừa lo có bug production, rủ đi ăn mừng`,
  lunch_plan: () => 'Sắp tới giờ trưa, cả nhóm bàn nhau ăn gì (cơm tấm, bún bò, đặt đồ ăn...) mà không ai chịu quyết',
  end_of_day: () => 'Sắp tan làm, cả nhóm rủ đi nhậu/karaoke hoặc than kẹt xe; có người phải ở lại OT nên cay',
  new_hire: (d) => `Công ty vừa nhận người mới là ${d.name}. Cả nhóm soi Facebook, đoán tính cách, cá xem bao lâu thì bị sai đi mua trà sữa`,
  late: (d) => `${d.name} vừa đi trễ (${d.note || 'sáng nay'}). Cả nhóm khịa, cá xem lần này viện cớ gì`,
  deadline: (d) => `Deadline ${d.note || 'dự án'} sắp tới mà còn ngập việc. Cả nhóm than thở, đổ lỗi cho sales hứa bừa, tính chuyện OT`,
  birthday: (d) => `Hôm nay sinh nhật ${d.name}. Cả nhóm (trừ ${d.name}) bàn kế hoạch tổ chức bất ngờ, góp tiền mua bánh và quà`,
  kpi_risk: (d) => `Nhóm chat (không có ${d.name}) bàn tán chuyện KPI của ${d.name} (${d.note || 'đang thấp'}): cá cược xem bao giờ bị HR gọi lên, nửa thương nửa khịa, có người lo tới lượt mình`,
  // ---- v3
  after_resign: (d) => `${d.name} vừa nộp đơn nghỉ việc và đã rời công ty. Cả nhóm sốc, kể lại dấu hiệu từ trước, có người tiếc, có người thấy cũng đúng; đoán xem ai sẽ ngồi chỗ đó`,
  after_layoff: (d) => `Công ty vừa cắt giảm: ${d.name} phải nghỉ vì doanh thu kém. Cả nhóm hoang mang, lo "ai tiếp theo", than kinh tế, an ủi nhau và khịa nhẹ lãnh đạo`,
  after_promotion: (d) => `${d.name} vừa được thăng chức${d.note ? ` (${d.note})` : ''}. Cả nhóm chúc mừng nửa thật nửa ghen, đòi khao, đoán xem ${d.name} có "thay đổi" không`,
  after_probation: (d) => `${d.name} vừa bị HR đưa vào diện thử thách KPI. Cả nhóm hóng, động viên kiểu bá đạo, có người chột dạ`,
  karaoke: () => 'Tối nay cả nhóm rủ đi karaoke sau giờ làm: chốt quán, chia tiền, giành micro trước; ai đó than mai còn phải đi làm sớm',
  overtime: () => 'Team dev phải tăng ca cả tuần vì tiến độ. Cả nhóm than thở, đổ lỗi, đặt đồ ăn tối chung, đùa về việc "về nhà chỉ để ngủ"',
  prank: (d) => `${d.name} vừa bị chơi khăm (${d.note || 'đổi hình nền máy tính'}) mà chưa biết ai làm. Cả nhóm cười lăn, giả vờ vô can, đổ cho nhau`,
  viral: (d) => `Clip/bài đăng của ${d.name} bất ngờ lên xu hướng. Cả nhóm xôn xao, soi bình luận, khịa "sắp nổi rồi quên anh em", ${d.name} khiêm tốn giả`,
  client_angry: (d) => `Một khách hàng vừa nổi giận với ${d.name}${d.note ? ` (${d.note})` : ''}. Cả nhóm hóng, an ủi, dev lo bị kéo vào sửa gấp`,
  sick: (d) => `${d.name} ốm bất chợt, phải ${d.note || 'về sớm'}. Cả nhóm hỏi thăm, chia việc, có người tranh thủ khịa nhẹ`,
  boss_mood: () => 'Sếp hôm nay rõ ràng khó ở: đi tuần nhiều, mặt lạnh. Cả nhóm cảnh báo nhau, đoán nguyên nhân, dặn nhau giả vờ bận',
  conflict: (d) => `${d.name} và ${d.note || 'một người khác'} vừa cãi nhau về công việc. Cả nhóm (không có hai người đó) bàn tán, chia phe nhẹ, rủ đi hoà giải`,
  resign_hint: (d) => `${d.name} dạo này úp mở chuyện nghỉ việc (story than mệt, hỏi dò chỗ khác). Cả nhóm hóng, khuyên ở lại hoặc khuyên đi, lo công việc dồn sang mình`,
  lost_item: (d) => `${d.name} làm mất ${d.note || 'món đồ'} và đang đi hỏi khắp văn phòng. Cả nhóm vào đoán vị trí, khịa tính hay quên, có người thú nhận cầm nhầm`,
  crush: (d) => `Có tin đồn nhẹ rằng ${d.name} đang để ý ${d.note || 'ai đó'} trong công ty. Cả nhóm trêu trong sáng, không ai nói gì quá đà`,
  news: (d) => `Có người ném vào nhóm một tin đang hot${d.note ? ` ("${d.note}")` : ''}. Cả nhóm bàn tán cảm nghĩ, mỗi người một ý, lạc đề dần`,
};

export function sitGroupChat(k: SitKit, reason: GroupReason, people: AgentState[], d: ReasonData = {}): Situation {
  const base = (GROUP_TEXT[reason] ?? GROUP_TEXT.random)(d);
  const odd = people.map((p) => {
    const sn = k.snap(p.id);
    switch (sn?.activity) {
      case 'toilet': return `${p.name} nhắn từ trong toilet`;
      case 'napping': return `${p.name} vừa ngủ gật dậy đã nhắn`;
      case 'pingpong': return `${p.name} nhắn giữa hai ván bóng bàn`;
      case 'chill': return `${p.name} nằm sofa góc chill nhắn`;
      case 'server_fix': return `${p.name} vừa cứu server vừa nhắn`;
      case 'lunch': return `${p.name} vừa ăn trưa vừa nhắn`;
      case 'showroom': return `${p.name} đứng ngắm đồ ở phòng trưng bày, vừa ngắm vừa nhắn`;
      case 'slacking': return `${p.name} nhắn trong lúc ${actOf(k, p).replace(/^đang\s+/, '')}`;
      default: return '';
    }
  }).filter(Boolean).slice(0, 2);
  return {
    situation: joinSit([
      base,
      odd.length ? odd.join('; ') : '',
      'Văn phong chat: câu ngắn, viết tắt, emoji, teencode nhẹ; có người thả reaction, có người "seen" không rep',
    ]),
    extra: commonExtra(k, people, { recent: reason === 'random' ? 2 : 1 }),
  };
}

// ---------------------------------------------------------------- company_chat
export type CompanyReason = 'morning' | 'release' | 'deal' | 'new_hire' | 'payday' | 'incident' | 'kpi_push' | 'announce' | 'firing'
  | 'promotion' | 'layoff' | 'resign' | 'team_building' | 'viral' | 'bonus';
export const COMPANY_REASONS: CompanyReason[] = ['morning', 'release', 'deal', 'new_hire', 'payday', 'incident', 'kpi_push', 'announce', 'firing',
  'promotion', 'layoff', 'resign', 'team_building', 'viral', 'bonus'];

const COMPANY_TEXT: Record<CompanyReason, (d: ReasonData, k: SitKit) => string> = {
  morning: () => 'Đầu ngày, sếp gửi một câu nói truyền cảm hứng (có thể nhầm tác giả) vào nhóm công ty và nhắc mục tiêu hôm nay; nhân viên thả tim, "Dạ sếp", có người nịnh lố',
  release: (d) => `Sếp chúc mừng team vừa release ${d.note ? `"${d.note}"` : 'dự án'} trong nhóm công ty, hứa thưởng mơ hồ; nhân viên cảm ơn, dev khiêm tốn giả`,
  deal: (d) => `Sếp khen ${d.name || 'team sales'} vừa chốt hợp đồng trong nhóm công ty; mọi người chúc mừng, người được khen khiêm tốn giả, có người tranh thủ nịnh`,
  new_hire: (d) => `HR giới thiệu thành viên mới ${d.name} trong nhóm công ty; sếp chào kiểu "chúng ta là một gia đình"; mọi người chào đón xã giao`,
  payday: () => 'Sếp thông báo đã chuyển lương, nhắc "lương là động lực, KPI là danh dự"; nhân viên cảm ơn rối rít',
  incident: () => 'Sếp hỏi tình hình sự cố trong nhóm công ty bằng giọng lo lắng; dev trấn an, sales xin cập nhật để báo khách',
  kpi_push: (_d, k) => {
    const c = k.w.company();
    return `Sếp nhắc KPI và doanh số tháng (${Math.round(fin(c?.revenueMonth))}/${Math.round(fin(c?.revenueTarget))} triệu) trong nhóm công ty, kèm một ví von chuyện đánh golf; nhân viên dạ vâng`;
  },
  announce: () => pick([
    'Sếp thông báo kế hoạch team building cuối tháng, ai cũng giả vờ hào hứng',
    'Sếp nhắc mọi người mặc đồng phục vì sắp có khách tới thăm văn phòng',
    'Sếp thông báo buổi đào tạo "văn hóa doanh nghiệp" vào sáng thứ Bảy, nhân viên dạ mà lòng đau',
    'Sếp gửi ảnh mình đang ở sân golf kèm thông điệp "làm việc chăm chỉ như cú putt này"',
  ]) ?? '',
  firing: (d) => `HR thông báo ngắn gọn ${d.name} đã nghỉ việc, cảm ơn đóng góp; sếp nói vài câu "gia đình"; mọi người trả lời dè dặt`,
  // ---- v3
  promotion: (d) => `Sếp công bố ${d.name} được thăng chức${d.note ? ` thành ${d.note}` : ''} trong nhóm công ty; mọi người chúc mừng rập khuôn, có người nịnh lố, có người "chúc mừng" rất khéo`,
  layoff: (d) => `Sếp thông báo công ty phải cắt giảm nhân sự vì doanh thu, ${d.name} sẽ nghỉ từ hôm nay; giọng "gia đình khó khăn"; nhân viên trả lời dè dặt, không ai dám hỏi thêm`,
  resign: (d) => `HR thông báo ${d.name} xin nghỉ việc vì lý do cá nhân; sếp chúc may mắn kiểu xã giao; nhân viên tạm biệt lịch sự, ẩn ý trong vài câu`,
  team_building: () => 'Sếp thông báo chiều nay có hoạt động gắn kết nhỏ ở góc chill (trà sữa, trò chơi), yêu cầu "ai cũng tham gia"; nhân viên hào hứng giả, hỏi khéo có được về sớm không',
  viral: (d) => `Sếp khen ${d.name} vì clip/bài đăng đang lên xu hướng, nhắc "thương hiệu công ty"; mọi người chúc mừng, có người xin bí kíp`,
  bonus: (d) => `Sếp thông báo thưởng nóng cho ${d.name} vì KPI xuất sắc; mọi người chúc mừng, có người hỏi khéo "tiêu chí là gì ạ"`,
};

export function sitCompanyChat(k: SitKit, reason: CompanyReason, people: AgentState[], d: ReasonData = {}): Situation {
  const boss = people.find((p) => p.role === 'boss');
  const where = boss ? bossWhere(k.w) : 'present';
  const bossLine = where === 'away' ? `Sếp đang ở ngoài (${bossNoteShort(k.w, 50)}) nhưng vẫn nhắn vào nhóm`
    : where === 'out' ? (k.w.minuteOfDay() < 600 ? 'Sếp chưa tới văn phòng, nhắn từ trên đường đi' : 'Sếp không có ở văn phòng nhưng vẫn nhắn vào nhóm') : '';
  return {
    situation: joinSit([
      (COMPANY_TEXT[reason] ?? COMPANY_TEXT.announce)(d, k),
      bossLine,
      'Văn phong nhóm công ty: lịch sự, "Dạ", "ạ", nịnh sếp; ai cũng giữ hình ảnh, ẩn ý cà khịa rất kín',
    ]),
    extra: commonExtra(k, people, { recent: 0, quirk: false }),
  };
}

// ---------------------------------------------------------------- standup
export function sitStandup(k: SitKit, people: AgentState[], absent: string[], late: string[], variant?: 'pitch'): Situation {
  const w = k.w;
  const boss = people.find((p) => p.role === 'boss');
  const staff = people.filter((p) => p.role !== 'boss');
  const yesterday = staff.map((p) => {
    const r = lastRatioPct(p);
    return r === null ? '' : `${p.name} hôm qua ${r}%`;
  }).filter(Boolean);
  const inc = w.company()?.incident;
  if (variant === 'pitch') {
    return {
      situation: joinSit([
        `Buổi "pitch ý tưởng" bất ngờ lúc ${hhmm(w.minuteOfDay())} ở phòng họp${boss ? `: ${who(boss)} vừa đi hội thảo về, đòi mỗi người trình bày 1 ý tưởng trong 30 giây` : ': sếp dặn từ xa, mỗi người phải trình bày 1 ý tưởng trong 30 giây'}`,
        'Ý tưởng toàn trời ơi (app đặt trà sữa nội bộ, AI chấm công bằng tiếng ngáp, BánNhanh POS phiên bản cho quán ốc…), có 1 ý tưởng nghe lại hợp lý bất ngờ',
        ...groupDynamics(staff, 2),
        `Mục tiêu: mỗi người 1 câu pitch đúng tính cách, người khác khịa; ${boss ? 'sếp chấm điểm theo cảm tính và hứa thưởng mơ hồ' : 'techlead chấm điểm kiểu kỹ thuật khô khan'}; chốt bằng người thắng được "đặc quyền" trời ơi`,
      ]),
      extra: commonExtra(k, staff, { recent: 1 }),
    };
  }
  return {
    situation: joinSit([
      `Họp standup ${hhmm(w.minuteOfDay())} ở phòng họp${boss ? `, ${who(boss)} ngồi dự và thích chen ngang` : ''}`,
      `Bàn về ${projectBrief(w) || 'dự án hiện tại'}; lần lượt báo cáo: hôm qua làm gì, hôm nay làm gì, vướng gì`,
      yesterday.length ? `KPI hôm qua: ${yesterday.join(', ')}` : '',
      late.length ? `Đi trễ sáng nay: ${late.join(', ')}` : '',
      absent.length ? `Chưa thấy mặt: ${absent.join(', ')}` : '',
      inc === 'server_down' ? 'Server đang có sự cố, ai cũng sốt ruột' : inc === 'wifi_down' ? 'Đang mất wifi, chẳng ai demo được gì' : '',
      ...groupDynamics(staff, 2),
      'Mục tiêu: techlead điều phối gắt gọn, có người chống chế hoặc đổ lỗi, có người khịa; một khoảnh khắc hài; chốt bằng phân task và hối deadline',
    ]),
    extra: commonExtra(k, staff, { recent: 1 }),
  };
}

// ---------------------------------------------------------------- lunch
const FOODS = ['cơm tấm sườn bì chả', 'bún bò Huế', 'cơm văn phòng hộp xốp', 'mì xào bò', 'bánh mì thịt', 'cơm gà xối mỡ',
  'phở mang lên', 'salad giảm cân kèm ly trà sữa full topping', 'cơm nhà tự nấu', 'bún thịt nướng'];
const LUNCH_GOALS = [
  'chuyện giá cả, chuyện nhà rồi trượt sang chuyện công ty; có người lỡ miệng nói hơi quá',
  'kể chuyện cuối tuần, có người bị khịa vì sống ảo trên mạng',
  'bàn tán ai sắp được tăng lương, ai đang "nguy hiểm", nói nhỏ khi có người đi ngang',
  'than giá vàng giá xăng, mơ chuyện nghỉ việc đi bán hàng online rồi tự cười',
  'so đồ ăn của nhau, gắp trộm, tranh luận món nào ngon nhất quận',
];

export function sitLunch(k: SitKit, people: AgentState[], rumorAbout?: AgentState): Situation {
  const foods = people.slice(0, 3).map((p) => `${p.name} ăn ${pick(FOODS)}`);
  return {
    situation: joinSit([
      `Giờ ăn trưa ở bàn pantry: ${listVi(people.map((p) => p.name))} ngồi ăn chung (${foods.join(', ')})`,
      ...groupDynamics(people, 2),
      bossMood(k, people),
      rumorAbout ? `Có người khơi lại tin đồn về ${rumorAbout.name} đang lan trong văn phòng` : '',
      `Mục tiêu: chuyện trò rôm rả lúc ăn — ${pick(LUNCH_GOALS)}`,
    ]),
    extra: commonExtra(k, people, { recent: 1 }),
  };
}

// ---------------------------------------------------------------- boss_catch
function catchPlace(s: ActSnap | undefined): string {
  switch (s?.activity) {
    case 'pingpong': return 'ở bàn bóng bàn';
    case 'chill': return 'trên sofa góc chill';
    case 'napping': return 'gục ngay trên bàn';
    default: return 'ngay tại bàn làm việc';
  }
}

export function sitBossCatch(
  k: SitKit, boss: AgentState, victim: AgentState, second: AgentState | null, lowRatio: number, where?: string,
  /** nhãn lúc sếp nhìn thấy (cảnh có thể diễn trễ một chút sau khoảnh khắc đó) */
  caught?: string,
): Situation {
  const vs = k.snap(victim.id);
  const ss = second ? k.snap(second.id) : undefined;
  const what = caught && caught.trim() ? caught.trim() : actPhrase(vs?.activity ?? victim.activity, vs?.label);
  const v = `${victim.name} (${victim.roleLabel}) ${what} ${where || catchPlace(vs)}`;
  const bossAct = k.snap(boss.id)?.activity === 'patrol' ? 'đang đi tuần một vòng' : 'đi ngang qua';
  const facts = subjectFacts(k, victim, lowRatio);
  return {
    situation: joinSit([
      `${who(boss)} ${bossAct} thì bắt quả tang ${v}`,
      second ? `${second.name} ${actPhrase(ss?.activity ?? second.activity, ss?.label)} gần đó cũng bị vạ lây` : '',
      facts.length ? `Tình hình của ${victim.name}: ${facts.join('; ')}` : '',
      victim.caughtToday >= 2 ? `Đây không phải lần đầu trong ngày, sếp đã mất kiên nhẫn` : '',
      `Mục tiêu: sếp mắng kiểu "chúng ta là một gia đình" pha giận dỗi, ${victim.name} chống chế bằng lý do trời ơi${second ? `, ${second.name} cố lẻn đi nhưng bị gọi lại` : ''}; chốt bằng lời dọa trừ KPI hoặc giao thêm việc`,
    ]),
    extra: commonExtra(k, second ? [victim, second] : [victim], { recent: 0, quirk: true }),
  };
}

// ---------------------------------------------------------------- boss_call
export type BossCallReason = 'praise' | 'scold' | 'task';
const BOSS_TASKS = [
  'làm slide báo cáo cho buổi gặp nhà đầu tư chiều mai', 'đặt sân golf cuối tuần cho sếp và đối tác',
  'kiểm tra lại hợp đồng với khách mới', 'viết bài đăng fanpage về văn hóa "gia đình" của công ty',
  'tìm quà sinh nhật cho vợ sếp', 'chuẩn bị số liệu doanh thu tháng để sếp "đọc cho có"',
  'nghiên cứu xem AI có thay được nửa công ty không', 'sửa máy in đang kẹt giấy (dù không phải việc của mình)',
  'lên kế hoạch team building tiết kiệm mà vẫn "hoành tráng"', 'trả lời giúp sếp mấy email tiếng Anh',
];

/** note (v3): lý do cụ thể do HR / mạch truyện đưa (vd "khách đòi hoàn tiền", "KPI dẫn đầu cả tuần") */
export function sitBossCall(k: SitKit, boss: AgentState, emp: AgentState, reason: BossCallReason, lowRatio: number, note?: string): Situation {
  const pct = kpiPct(emp);
  const empAct = actOf(k, emp);
  const why = cut(note ?? '', 90);
  let goal = '';
  let open = '';
  if (reason === 'praise') {
    open = why
      ? `${who(boss)} gọi ${whoRole(emp)} lên phòng để khen theo đề nghị của HR: ${why}`
      : `${who(boss)} gọi ${whoRole(emp)} lên phòng để khen vì KPI hôm nay đã ${pct}%, cao nhất văn phòng`;
    goal = `sếp khen bằng ví von golf, hứa thưởng mơ hồ rồi tiện thể giao thêm việc; ${emp.name} vừa mừng vừa sợ`;
  } else if (reason === 'scold') {
    const streak = emp.lowStreak > 0 ? `, ${emp.lowStreak} ngày liền dưới ${Math.round(lowRatio * 100)}%` : '';
    open = why
      ? `${who(boss)} gọi ${whoRole(emp)} lên phòng vì ${why}`
      : `${who(boss)} gọi ${whoRole(emp)} lên phòng vì KPI hôm nay mới ${pct}%${streak}`;
    goal = `sếp mắng kiểu "chúng ta là một gia đình" nhưng giọng lạnh, ${emp.name} viện cớ đúng tính cách; chốt bằng một yêu cầu cụ thể kèm hạn chót`;
  } else {
    open = `${who(boss)} gọi ${whoRole(emp)} lên phòng giao việc: ${pick(BOSS_TASKS)}`;
    goal = `việc trời ơi, không đúng chuyên môn; ${emp.name} dạ vâng nhưng lộ vẻ ngán ngẩm, thử từ chối khéo mà không được`;
  }
  return {
    situation: joinSit([
      open,
      `Trước khi bị gọi, ${emp.name} ${empAct}`,
      pairDynamic(boss, emp),
      `Mục tiêu: ${goal}`,
    ]),
    extra: commonExtra(k, [emp], { recent: 1 }),
  };
}

// ---------------------------------------------------------------- hr_warning
export function sitHrWarning(k: SitKit, hr: AgentState, emp: AgentState, lowRatio: number, lateCount: number): Situation {
  const n = emp.warnings + 1;
  const trail = kpiTrail(emp, 3);
  const bits: string[] = [];
  if (emp.caughtToday > 0) bits.push(`hôm nay còn bị sếp bắt quả tang ${emp.caughtToday} lần`);
  if (lateCount > 0) bits.push(`đi trễ ${lateCount} lần gần đây`);
  return {
    situation: joinSit([
      `${who(hr)} (${hr.roleLabel}) mời ${whoRole(emp)} vào phòng họp nói chuyện riêng về KPI`,
      `Số liệu: ${trail || 'KPI thấp nhiều ngày'}; ${emp.lowStreak} ngày liên tiếp dưới ${Math.round(lowRatio * 100)}%; đây là lần nhắc nhở thứ ${n}`,
      bits.length ? `Thêm: ${bits.join('; ')}` : '',
      `Mục tiêu: HR mở đầu ngọt ngào ("em ơi...") nhưng thép về số liệu, ghi chép vào sổ; ${emp.name} viện cớ đúng tính cách; kết bằng lời cảnh cáo rõ ràng: ${n >= 2 ? 'lần sau là phải mời nghỉ việc' : 'nếu còn tái diễn sẽ xem xét hợp đồng'}`,
    ]),
    extra: commonExtra(k, [emp], { recent: 0 }),
  };
}

// ---------------------------------------------------------------- firing
export function sitFiring(k: SitKit, hr: AgentState, emp: AgentState, boss: AgentState | null, lowRatio: number): Situation {
  const trail = kpiTrail(emp, 3);
  const opener = boss
    ? `${who(boss)} và ${who(hr)} gọi ${whoRole(emp)} lên phòng Giám đốc để thông báo cho nghỉ việc`
    : `Sếp vắng (${bossNoteShort(k.w, 50) || 'ra ngoài'}) nhưng đã dặn trước, ${who(hr)} gọi ${whoRole(emp)} lên phòng Giám đốc để thông báo cho nghỉ việc`;
  return {
    situation: joinSit([
      opener,
      `Lý do: ${emp.lowStreak} ngày liên tiếp KPI dưới ${Math.round(lowRatio * 100)}%${trail ? ` (${trail})` : ''}, đã bị nhắc ${emp.warnings} lần${emp.caughtToday > 0 ? `, hôm nay còn bị bắt lười ${emp.caughtToday} lần` : ''}`,
      `Diễn biến: HR mở lời nhẹ nhàng${boss ? ', sếp chêm câu "chúng ta là một gia đình, nhưng..."' : ', đọc quyết định có chữ ký sếp'}; ${emp.name} sốc → năn nỉ, viện cớ → chấp nhận; nhắc bàn giao laptop, thẻ từ`,
      `Mục tiêu: căng mà vẫn có duyên, không tàn nhẫn; ${emp.name} có một câu chốt đáng nhớ trước khi ôm thùng đồ ra về`,
    ]),
    extra: commonExtra(k, [emp], { recent: 0, quirk: true }),
  };
}

// ---------------------------------------------------------------- interview
export function sitInterview(
  k: SitKit, hr: AgentState, cand: AgentState, panel: AgentState[],
  info: { replacingName?: string; rejections: number; forceHire: boolean },
): Situation {
  const boss = panel.find((p) => p.role === 'boss');
  const expert = panel.find((p) => p.role !== 'boss' && p.role !== 'hr');
  const quirk = Array.isArray(cand.quirks) && cand.quirks.length ? pick(cand.quirks) : undefined;
  return {
    situation: joinSit([
      `Phỏng vấn ứng viên ${cand.name} (${cand.age} tuổi) cho vị trí ${cand.roleLabel}${info.replacingName ? `, thay chỗ ${info.replacingName} vừa nghỉ` : ''}`,
      `Hội đồng: ${listVi([hr, ...panel.filter((p) => p !== hr)].map((p) => whoRole(p)))}`,
      info.rejections > 0 ? `Trước đó đã loại ${info.rejections} ứng viên cho vị trí này nên HR hơi sốt ruột` : '',
      quirk ? `Ứng viên có tật: ${cut(quirk, 80)} — để lộ ra trong buổi phỏng vấn` : '',
      `Mục tiêu: HR hỏi câu kinh điển (điểm yếu, vì sao nghỉ chỗ cũ, lương mong muốn)${expert ? `, ${expert.name} hỏi một câu chuyên môn hóc búa` : ''}${boss ? ', sếp hỏi một câu trời ơi về golf hoặc "gia đình"' : ''}; ứng viên trả lời đúng tính cách`,
      info.forceHire
        ? 'Kết quả BẮT BUỘC: nhận (verdict "hired") vì công ty đang thiếu người gấp; câu cuối báo tin vui'
        : 'Tự quyết kết quả hợp lý theo màn thể hiện (thường là nhận, đôi khi loại vì quá kỳ quặc); câu cuối hé lộ kết quả',
    ]),
    extra: commonExtra(k, panel.filter((p) => p.role !== 'boss'), { recent: 0, quirk: false }),
  };
}

// ---------------------------------------------------------------- incident
export function sitIncident(k: SitKit, team: AgentState[], reason: 'server_down' | 'bug_prod', note?: string): Situation {
  const w = k.w;
  const boss = w.boss();
  const bw = bossWhere(w);
  const bossBit = boss ? (bw === 'present' ? `${who(boss)} đi qua đi lại sốt ruột` : `${who(boss)} đang ở ngoài, gọi điện về liên tục`) : '';
  const opener = reason === 'server_down'
    ? 'Server production vừa sập! Khách gọi liên tục, đơn hàng BánNhanh POS treo cứng'
    : `Vừa release ${note ? `"${cut(note, 50)}"` : 'bản mới'} thì khách báo bug production nghiêm trọng`;
  return {
    situation: joinSit([
      opener,
      `${listVi(team.map((p) => p.name))} lao vào phòng server`,
      bossBit,
      ...groupDynamics(team, 1),
      'Mục tiêu: hoảng loạn, đổ lỗi ("ai deploy chiều nay?", "máy anh chạy được mà"), thuật ngữ thật (log, rollback, hotfix, database); Tech Lead chỉ huy; chốt bằng hướng xử lý hoặc lộ thủ phạm',
    ]),
    extra: commonExtra(k, team, { recent: 1, quirk: false }),
  };
}

// ---------------------------------------------------------------- celebration
export type CelebrationReason = 'birthday' | 'payday' | 'release' | 'deal' | 'bonus' | 'team_building' | 'viral' | 'promotion';
export const CELEBRATION_REASONS: CelebrationReason[] = ['birthday', 'payday', 'release', 'deal', 'bonus', 'team_building', 'viral', 'promotion'];

export function celebrationTitle(reason: CelebrationReason, center?: AgentState, note?: string): string {
  switch (reason) {
    case 'birthday': return center ? `Mừng sinh nhật ${center.name}` : 'Mừng sinh nhật';
    case 'payday': return 'Ăn mừng ngày lương về';
    case 'release': return note ? `Ăn mừng release ${cut(note, 30)}` : 'Ăn mừng release';
    case 'deal': return center ? `Ăn mừng ${center.name} chốt deal` : 'Ăn mừng chốt deal';
    case 'bonus': return center ? `${center.name} khao vì được thưởng` : 'Ăn mừng thưởng nóng';
    case 'team_building': return 'Team building mini ở góc chill';
    case 'viral': return center ? `Ăn mừng ${center.name} lên xu hướng` : 'Ăn mừng lên xu hướng';
    case 'promotion': return center ? `Chúc mừng ${center.name} thăng chức` : 'Chúc mừng thăng chức';
  }
}

export function sitCelebration(k: SitKit, people: AgentState[], reason: CelebrationReason, center?: AgentState, note?: string): Situation {
  const boss = people.find((p) => p.role === 'boss');
  let open = '';
  let goal = '';
  if (reason === 'birthday') {
    open = `Sinh nhật ${center?.name ?? 'một đồng nghiệp'}! Mọi người tụ tập ở góc chill với bánh kem và trà sữa`;
    goal = `chúc tụng, trêu ${center?.name ?? 'nhân vật chính'} (tuổi tác, người yêu, KPI), tặng quà, có người hát chúc mừng lạc tông`;
  } else if (reason === 'payday') {
    open = 'Lương về! Cả đám tụ tập góc chill ăn mừng nhỏ: order trà sữa, bánh tráng trộn';
    goal = 'khoe giỏ hàng, bàn chuyện tiêu tiền, có người than lương về rồi đi ngay';
  } else if (reason === 'release') {
    open = `Vừa release xong ${note ? `"${cut(note, 50)}"` : 'dự án'}! Team kéo nhau ra góc chill ăn mừng`;
    goal = 'kể lại những đêm OT, khoe ai cứu dự án, khịa người gây bug nhiều nhất, lo bug production lúc nửa đêm';
  } else if (reason === 'bonus') {
    open = `${center?.name ?? 'Một đồng nghiệp'} vừa được sếp thưởng nóng vì KPI xuất sắc, bị cả đám kéo ra góc chill đòi khao`;
    goal = `${center?.name ?? 'người được thưởng'} khiêm tốn giả rồi khoe thật, mọi người hỏi "thưởng bao nhiêu" mà không ai nói số, bàn tiêu tiền thưởng giúp`;
  } else if (reason === 'team_building') {
    open = 'Sếp cho tổ chức team building mini ở góc chill: trà sữa, trò chơi nhỏ (đoán tên bài hát, kể chuyện xấu hổ)';
    goal = 'ai cũng tham gia miễn cưỡng rồi cuốn theo, lộ vài bí mật vô hại, có người thắng trò chơi và được "đặc quyền" trời ơi';
  } else if (reason === 'viral') {
    open = `Clip/bài đăng của ${center?.name ?? 'marketing'} đang lên xu hướng! Cả đám tụ ở góc chill đọc bình luận`;
    goal = `đọc bình luận của người lạ (vô hại), đếm view, khịa "sắp nổi rồi quên anh em", ${center?.name ?? 'nhân vật chính'} vừa khiêm tốn vừa sướng`;
  } else if (reason === 'promotion') {
    open = `${center?.name ?? 'Một đồng nghiệp'} vừa được thăng chức! Cả đám kéo ra góc chill chúc mừng và đòi khao`;
    goal = `chúc mừng nửa thật nửa ghen, hỏi "giờ gọi là sếp hả", ${center?.name ?? 'nhân vật chính'} hứa khao rồi tìm cách giảm nhẹ lời hứa`;
  } else {
    open = `${center?.name ?? 'Team sales'} vừa chốt hợp đồng lớn! Cả đám kéo ra góc chill ăn mừng`;
    goal = `${center?.name ?? 'người chốt deal'} kể chuyện chốt deal (có phần chém gió), mọi người đòi khao, dev lo bị hứa thêm tính năng`;
  }
  return {
    situation: joinSit([
      open,
      boss ? `${who(boss)} ghé qua phát biểu "chúng ta là một gia đình" và hứa thưởng mơ hồ` : '',
      ...groupDynamics(people, 1),
      `Mục tiêu: hò reo, ${goal}`,
    ]),
    extra: commonExtra(k, people, { recent: 1 }),
  };
}

// ---------------------------------------------------------------- confront
export function sitConfront(
  k: SitKit, subject: AgentState, teller: AgentState,
  rumor: { original: string; latest: string; reach: number; otherTeller?: string },
): Situation {
  return {
    situation: joinSit([
      `${subject.name} vừa nghe phong thanh tin đồn về mình: "${cut(rumor.latest, 160)}"`,
      rumor.original && rumor.original !== rumor.latest ? `Bản gốc ban đầu chỉ là: "${cut(rumor.original, 120)}"` : '',
      `Tin đã lan tới ${rumor.reach} người; ${subject.name} biết ${teller.name} là người vừa kể nên đi thẳng tới chỗ ${teller.name} hỏi tội`,
      `Lúc đó ${teller.name} ${actOf(k, teller)}`,
      pairDynamic(subject, teller),
      `Mục tiêu: ${subject.name} chất vấn, ${teller.name} chối hoặc đổ cho người khác${rumor.otherTeller ? ` ("em nghe ${rumor.otherTeller} nói mà")` : ''}, chữa cháy vụng về; căng rồi chốt bằng một câu hài hoặc lời thề "từ giờ không tám nữa"`,
    ]),
    extra: commonExtra(k, [subject, teller], { recent: 0, quirk: false }),
  };
}

// ---------------------------------------------------------------- pingpong_match
export function sitPingpong(k: SitKit, a: AgentState, b: AgentState): Situation {
  const w = k.w;
  return {
    situation: joinSit([
      `${a.name} và ${b.name} đang đánh bóng bàn ở sảnh${bossWhere(w) === 'present' ? ', dù sếp đang ở văn phòng' : w.bossAway() ? ` trong lúc sếp vắng (${bossNoteShort(w, 50)})` : ''}`,
      pairDynamic(a, b),
      `Mục tiêu: trash talk, đếm điểm, cá cược trà sữa, ăn mừng lố${bossWhere(w) === 'present' ? '; thỉnh thoảng giật mình liếc về phía phòng sếp' : ''}`,
    ]),
    extra: commonExtra(k, [a, b], { recent: 0 }),
  };
}

// =====================================================================
//  showroom_chat (v2) — phòng trưng bày: 2 kệ (làm đẹp / công nghệ), SPOTS.showroom_beauty / showroom_tech
//  do sim engineer thêm trong map.ts; mọi tra cứu đều phòng khi chưa có (?? []).
// =====================================================================
export const SHELF_LABEL: Record<ProductShelf, string> = { beauty: 'kệ làm đẹp', tech: 'kệ công nghệ' };
export const SHELF_SPOT: Record<ProductShelf, string> = { beauty: 'showroom_beauty', tech: 'showroom_tech' };
const SHOWROOM_SPOT_RE = /^showroom_(beauty|tech)(?::|$)/;

/** Có phòng trưng bày trên bản đồ chưa (SPOTS.showroom_* tồn tại) */
export function showroomAvailable(): boolean {
  return !!(SPOTS.showroom_beauty ?? []).length || !!(SPOTS.showroom_tech ?? []).length;
}

/** Kệ mà một người đang đứng cạnh (null nếu không ở phòng trưng bày / đang ẩn trong WC) */
export function shelfAt(a: AgentState): ProductShelf | null {
  if (!a.present || a.hidden) return null;
  const m = typeof a.spotKey === 'string' ? SHOWROOM_SPOT_RE.exec(a.spotKey) : null;
  if (m) return m[1] as ProductShelf;
  const p = { x: a.x, y: a.y };
  const nearSpot = (g: string) => (SPOTS[g] ?? []).some((s) => dist(s, p) <= 1.6);
  if (nearSpot('showroom_beauty')) return 'beauty';
  if (nearSpot('showroom_tech')) return 'tech';
  const inRoom = roomAt(a.x, a.y)?.id === 'showroom';
  if (!inRoom && a.activity !== 'showroom') return null;
  const label = String(a.activityLabel ?? '');
  if (/làm đẹp|lam dep|beauty/iu.test(label)) return 'beauty';
  if (/công nghệ|cong nghe|tech/iu.test(label)) return 'tech';
  if (!inRoom) return null;
  // kệ làm đẹp bên trái (x1..4), kệ công nghệ bên phải (x5..8) — docs/v2-contract.md §1
  const room = roomAt(a.x, a.y);
  return room && a.x < room.x + room.w / 2 ? 'beauty' : 'tech';
}

/** Kệ hợp với một người khi được rủ đi xem (nữ nghiêng làm đẹp, dev/design nghiêng công nghệ — không tuyệt đối) */
export function preferredShelf(a: AgentState): ProductShelf {
  let pBeauty = 0.5;
  if (a.gender === 'nữ') pBeauty += 0.2;
  if (a.role === 'marketing') pBeauty += 0.1;
  if (isTech(a.role)) pBeauty -= 0.2;
  if (a.role === 'boss') pBeauty -= 0.15;
  return chance(clamp(pBeauty, 0.2, 0.8)) ? 'beauty' : 'tech';
}

export interface ShowroomGroup { shelf: ProductShelf; people: AgentState[] }

/**
 * ≥ 2 người (không ẩn, đã tới chỗ, rảnh) đang đứng trong phòng trưng bày → nhóm 2–3 người cho showroom_chat.
 * Ưu tiên nhóm đứng cùng một kệ; không có thì gom cả phòng (phòng nhỏ) và lấy kệ của số đông.
 */
export function findShowroomGroup(w: WorldApi, free: FreeFn): ShowroomGroup | null {
  const here = w.activeAgents()
    .filter((a) => free(a) && w.isArrived(a.id))
    .map((a) => ({ a, shelf: shelfAt(a) }))
    .filter((x): x is { a: AgentState; shelf: ProductShelf } => !!x.shelf);
  if (here.length < 2) return null;
  const byShelf = new Map<ProductShelf, AgentState[]>();
  for (const h of here) byShelf.set(h.shelf, [...(byShelf.get(h.shelf) ?? []), h.a]);
  const same = [...byShelf.entries()].filter(([, l]) => l.length >= 2);
  let shelf: ProductShelf;
  let pool: AgentState[];
  if (same.length) {
    [shelf, pool] = pick(same)!;
  } else {
    pool = here.map((h) => h.a);
    const nb = byShelf.get('beauty')?.length ?? 0, nt = byShelf.get('tech')?.length ?? 0;
    shelf = nb > nt ? 'beauty' : nt > nb ? 'tech' : pick(['beauty', 'tech'] as ProductShelf[])!;
  }
  const size = pool.length >= 3 && chance(0.55) ? 3 : 2;
  return { shelf, people: shuffle([...pool]).slice(0, size) };
}

/** Người "khoe đồ": marketing > người hợp kệ (nữ với kệ làm đẹp, dev/design với kệ công nghệ) > người nhiều chuyện */
export function pickRecommender(people: AgentState[], shelf: ProductShelf): AgentState {
  return weightedPick(people, (a) => {
    let w = 0.4 + fin(a.traits?.gossip) * 0.6 + fin(a.traits?.humor) * 0.3;
    if (a.role === 'marketing') w += 1.6;
    if (shelf === 'beauty' && a.gender === 'nữ') w += 0.6;
    if (shelf === 'tech' && isTech(a.role)) w += 0.6;
    if (a.role === 'boss') w *= 0.4;
    return w;
  }) ?? people[0];
}

const SHOWROOM_GOALS = [
  'người khoe khuyên thật lòng, người kia giả vờ không quan tâm rồi lén hỏi tên shop',
  'người nghe khịa "ăn hoa hồng hả" rồi tự thấy cũng muốn mua, chốt bằng "để tối săn sale"',
  'so với món cũ đang xài ở nhà, cãi nhẹ, cuối cùng rủ mua chung cho được freeship',
  'người nghi ngờ nhất lại là người đòi mượn xài thử trước, chốt bằng một câu hài',
  'tranh nhau kể trải nghiệm, một người kể lố, người kia kéo về sự thật',
];

/** situation cho showroom_chat: kệ đang đứng, món trên kệ + nhận xét của chủ dự án làm chất liệu, đúng 1 câu product=true */
export function sitShowroom(
  k: SitKit, people: AgentState[], shelf: ProductShelf,
  product: { name: string; note: string; emoji?: string }, recommender: AgentState, nudged: boolean,
): Situation {
  const rec = people.find((p) => p.id === recommender.id) ?? people[0];
  const others = people.filter((p) => p.id !== rec.id);
  const where = SHELF_LABEL[shelf];
  const how = nudged
    ? `${rec.name} vừa kéo ${listVi(others.map((o) => o.name)) || 'mọi người'} qua coi đồ mới trên kệ`
    : 'ai cũng tranh thủ nghỉ tay ra ngắm đồ';
  const note = cut(product.note, 170);
  return {
    situation: joinSit([
      `${timeFlavor(k.w.minuteOfDay())}. ${listVi(people.map((p) => p.name))} đứng trước ${where} trong phòng trưng bày của công ty — ${how}`,
      `Trên kệ có ${product.emoji ? `${product.emoji} ` : ''}"${cut(product.name, 60)}"${note ? ` — lý do người dùng thích: "${note}"` : ''}`,
      `${rec.name} đã xài món này và mê: kể trải nghiệm thật bằng lời mình trong đúng 1 câu nhắc món đồ (câu đó product=true, không nói giá, không nói link); ${listVi(others.map((o) => o.name)) || 'người kia'} khịa hoặc nghi ngờ, hỏi giá nhưng không ai nói giá cụ thể`,
      ...groupDynamics(people, 1),
      bossMood(k, people),
      `Mục tiêu: ${pick(SHOWROOM_GOALS)}`,
    ]),
    extra: commonExtra(k, people, { recent: 1 }),
  };
}

// ---------------------------------------------------------------- welcome
export function sitWelcome(k: SitKit, newbie: AgentState, others: AgentState[], replacingName?: string): Situation {
  const junior = others.find((o) => o.role === 'junior');
  return {
    situation: joinSit([
      `${whoRole(newbie)} là nhân viên mới, hôm nay ngày đầu đi làm${replacingName ? `, ngồi vào bàn cũ của ${replacingName}` : ''}`,
      `${listVi(others.map((o) => o.name))} ghé bàn chào hỏi`,
      junior && junior.id !== newbie.id ? `${junior.name} mừng thầm vì từ nay không còn là người bị sai vặt nhất` : '',
      `Mục tiêu: giới thiệu, dặn "luật ngầm" (giờ sếp đi tuần, KPI, đừng deploy thứ Sáu, ai hay bị sai đi mua trà sữa), trêu người mới; ${newbie.name} bỡ ngỡ đúng tính cách`,
    ]),
    extra: commonExtra(k, others, { recent: 1, quirk: false }),
  };
}

// =====================================================================
//  V3 — thời sự (news_chat), họp xét nhân sự, xin nghỉ, xin tăng lương, thăng chức, cắt giảm
//  (docs/v3-news.md). Thoại vẫn do Brain viết; ở đây chỉ chọn người + viết tình huống.
// =====================================================================
export type HrDossierEntry = NonNullable<SceneRequest['hrDossier']>[number];

/** Thẻ tin gốc để gắn vào log / PublicScene (người xem tự kiểm chứng) */
export function newsRefOf(n: NewsItem): { id: string; title: string; source: string; url: string; category: NewsCategory } {
  return { id: n.id, title: cut(n.title, 160), source: cut(n.source, 40), url: n.url, category: n.category };
}

/** Mức hợp sở thích của một người với nhóm tin (0 = chỉ còn trọng số nền) */
export function newsInterest(a: AgentState, cat: NewsCategory): number {
  const t = NEWS_INTEREST[cat];
  if (!t) return 0;
  let v = t.ids[a.id] ?? 0;
  v += t.roles[a.role] ?? 0;
  const text = [...(a.likes ?? []), ...(a.quirks ?? []), a.bio ?? ''].join(' ').toLowerCase();
  for (const k of t.keywords) if (text.includes(k)) v += 0.5;
  return v;
}

/**
 * Chọn 2–4 người bàn tin: ưu tiên hợp sở thích (likes/vai trò/roster), ai cũng có trọng số nền để không ai bị
 * "cấm" hóng chuyện; sếp hiếm khi tham gia. prefer = ưu tiên người đang rảnh ở pantry/góc chill (cảnh văn phòng).
 */
export function pickNewsGroup(
  w: WorldApi, free: FreeFn, cat: NewsCategory, opts: { exclude?: string[]; online?: boolean } = {},
): AgentState[] | null {
  const ex = new Set(opts.exclude ?? []);
  const pool = w.activeAgents().filter((a) => free(a) && !ex.has(a.id) && a.activity !== 'server_fix'
    && (a.role !== 'boss' || chance(0.15)));
  if (pool.length < 2) return null;
  const weight = (a: AgentState, chosen: AgentState[]) => {
    let v = 0.35 + newsInterest(a, cat) + 0.4 * fin(a.traits?.gossip);
    if (!opts.online && areaOf(a)) v += 0.6; // đang đứng ở chỗ tám chuyện → tự nhiên hơn
    v += chosen.reduce((s, c) => s + Math.max(0, relScore(a, c.id)) / 40, 0);
    return v;
  };
  const first = weightedPick(pool, (a) => weight(a, []));
  if (!first) return null;
  const chosen = [first];
  const rest = pool.filter((a) => a !== first);
  const size = clamp(randInt(2, 4), 2, Math.min(4, pool.length));
  while (chosen.length < size && rest.length) {
    const nxt = weightedPick(rest, (a) => weight(a, chosen));
    if (!nxt) break;
    chosen.push(nxt);
    rest.splice(rest.indexOf(nxt), 1);
  }
  return chosen.length >= 2 ? chosen : null;
}

/** situation cho news_chat: thẻ tin + nguyên tắc an toàn + ai hợp tin + mục tiêu kịch tính */
export function sitNewsChat(k: SitKit, people: AgentState[], news: NewsItem, where: string, online: boolean): Situation {
  const label = NEWS_CATEGORY_LABEL[news.category] ?? 'thời sự';
  const fans = people.filter((p) => newsInterest(p, news.category) >= 1).map((p) => p.name);
  const starter = people[0];
  const how = online
    ? `${starter.name} ném link bài báo vào nhóm chat kín`
    : `${starter.name} vừa đọc báo trên điện thoại, kể cho ${listVi(people.slice(1).map((p) => p.name))} nghe ở ${where.toLowerCase()}`;
  return {
    situation: joinSit([
      `${timeFlavor(k.w.minuteOfDay())}. ${how}`,
      `Tin thật (${label}, báo ${cut(news.source, 30)}): "${cut(news.title, 150)}"${news.summary ? ` — tóm tắt báo: ${cut(news.summary, 200)}` : ''}`,
      fans.length ? `${listVi(fans)} mê chủ đề này nên hào hứng nhất; người khác hóng hoặc khịa` : 'Không ai rành lắm nên chỉ nói cảm nghĩ, hỏi nhau rồi lạc đề sang chuyện của mình',
      `Nguyên tắc: ${NEWS_SAFETY_RULES}`,
      `Mục tiêu: ${pick(NEWS_REACTION_SEEDS[news.category] ?? NEWS_REACTION_SEEDS.giai_tri)}; cuối cùng quay về chuyện công ty một câu`,
    ]),
    extra: commonExtra(k, people, { recent: 1, quirk: false }),
  };
}

/** situation cho hr_review: HR + sếp họp trong phòng Giám đốc; hồ sơ nằm ở req.hrDossier (prompt render riêng) */
export function sitHrReview(k: SitKit, hr: AgentState, boss: AgentState, dossier: HrDossierEntry[], triggers: string[]): Situation {
  const w = k.w;
  const c = w.company();
  const rev = c ? `${Math.round(fin(c.revenueMonth))}/${Math.round(fin(c.revenueTarget))} triệu` : '';
  const risky = dossier.filter((d) => d.lowStreak >= 1 || d.warnings >= 1).map((d) => `${d.name} (${d.lowStreak} ngày thấp${d.warnings ? `, ${d.warnings} lần nhắc` : ''})`);
  const stars = dossier.filter((d) => d.kpiRatios.length >= 3 && d.kpiRatios.reduce((s, x) => s + x, 0) / d.kpiRatios.length >= 1.0).map((d) => d.name);
  return {
    situation: joinSit([
      `${who(hr)} (${hr.roleLabel}) mang sổ vào phòng ${who(boss)} họp xét nhân sự định kỳ, cửa đóng`,
      triggers.length ? `Lý do họp sớm: ${triggers.slice(0, 3).join('; ')}` : 'Họp định kỳ, chưa có gì cháy nhà',
      rev ? `Doanh thu tháng: ${rev}; ${projectBrief(w) || 'dự án đang chạy'}; ${dossier.length} nhân viên được xét` : '',
      risky.length ? `Đáng lo: ${risky.slice(0, 3).join(', ')}` : 'KPI chung ổn, không ai quá tệ',
      stars.length ? `Nổi bật: ${listVi(stars.slice(0, 2))}` : '',
      'Mục tiêu: HR đọc số liệu kiểu kế toán, sếp phán theo cảm tính và ví von golf, hai người giằng co (HR muốn công bằng, sếp muốn tiết kiệm hoặc "gia đình"); '
      + 'cuối cùng chốt vài quyết định hợp lý (hrDecisions) — chỉ chọn trong hành động được phép của từng người, mỗi quyết định kèm lý do 1 câu; không nhất thiết phải đuổi ai',
    ]),
    extra: commonExtra(k, [hr, boss], { recent: 2, quirk: false }),
  };
}

/** situation cho resign_talk: nhân viên chán việc, HR mời nói chuyện riêng; verdict stay | leave do AI quyết */
export function sitResignTalk(k: SitKit, hr: AgentState, emp: AgentState, info: { lowMoodDays: number; bossScore: number; hint?: string }): Situation {
  const boss = k.w.boss();
  const why: string[] = [];
  if (info.lowMoodDays >= 3) why.push(`tâm trạng tệ ${info.lowMoodDays} ngày liền`);
  if (info.bossScore <= -30) why.push(`quan hệ với ${boss ? who(boss) : 'sếp'} rất xấu (${info.bossScore})`);
  if (emp.warnings > 0) why.push(`đã bị nhắc KPI ${emp.warnings} lần`);
  if (info.hint) why.push(info.hint);
  return {
    situation: joinSit([
      `${who(hr)} (${hr.roleLabel}) nhận ra ${whoRole(emp)} dạo này úp mở chuyện nghỉ việc nên mời vào phòng họp nói chuyện riêng, giọng chị em`,
      why.length ? `Dấu hiệu: ${why.join('; ')}` : '',
      `Lúc đó ${emp.name} ${actOf(k, emp)}${withBody(emp)}`,
      pairDynamic(hr, emp),
      `Mục tiêu: ${emp.name} trút hết bức xúc đúng tính cách (sếp, KPI, lương, đồng nghiệp); HR vừa lắng nghe vừa giữ người bằng lời hứa khéo; `
      + 'kết quả tự quyết hợp lý: ở lại (verdict "stay", có điều kiện) hoặc đi thật (verdict "leave", nộp đơn, hẹn ngày bàn giao); câu cuối hé lộ kết quả',
    ]),
    extra: commonExtra(k, [emp], { recent: 1, quirk: true }),
  };
}

/** situation cho raise_request: nhân viên KPI cao xin tăng lương với sếp; verdict approved | denied do AI quyết */
export function sitRaiseRequest(k: SitKit, boss: AgentState, emp: AgentState, info: { avgPct: number; revenuePct: number; askedBefore: boolean }): Situation {
  return {
    situation: joinSit([
      `${whoRole(emp)} lấy hết can đảm gõ cửa phòng ${who(boss)} để xin tăng lương`,
      `Lý lẽ: KPI 7 ngày gần nhất trung bình ${info.avgPct}% mục tiêu${emp.promotions ? `, đã thăng chức ${emp.promotions} lần` : ''}; doanh thu công ty đang ở ${info.revenuePct}% mục tiêu${info.askedBefore ? '; lần trước đã xin và bị từ chối' : ''}`,
      pairDynamic(boss, emp),
      `Mục tiêu: ${emp.name} mở lời vòng vo rồi vào thẳng số, sếp ghét câu "tăng lương" nên lái sang "gia đình", golf, "công ty đang khó"; `
      + 'kết quả tự quyết hợp lý theo số liệu và tâm trạng sếp: đồng ý (verdict "approved", có thể kèm điều kiện) hoặc từ chối khéo (verdict "denied", hứa xem lại sau); câu cuối hé lộ kết quả',
    ]),
    extra: commonExtra(k, [emp], { recent: 1 }),
  };
}

/** situation cho promotion: công bố thăng chức trong phòng Giám đốc (sếp + HR + người được thăng, có thể thêm 1 đồng nghiệp) */
export function sitPromotion(k: SitKit, boss: AgentState | null, hr: AgentState, emp: AgentState, newLabel: string, others: AgentState[]): Situation {
  const avg = emp.kpiHistory.slice(-7).map((h) => fin(h.ratio)).filter((x) => x > 0);
  const pct = avg.length ? Math.round((avg.reduce((s, x) => s + x, 0) / avg.length) * 100) : 0;
  return {
    situation: joinSit([
      boss
        ? `${who(boss)} và ${who(hr)} gọi ${whoRole(emp)} lên phòng Giám đốc để công bố thăng chức thành ${newLabel}`
        : `${who(hr)} thay mặt sếp (đang vắng) báo cho ${whoRole(emp)} tin thăng chức thành ${newLabel}`,
      pct ? `Căn cứ: KPI trung bình ${pct}% mục tiêu trong tuần, ${k.w.day() - fin(emp.hiredDay, 1)} ngày gắn bó` : '',
      others.length ? `${listVi(others.map((o) => o.name))} được gọi vào làm chứng (và để lan tin)` : '',
      `Mục tiêu: ${boss ? 'sếp nói dài về "gia đình" và golf trước khi vào tin chính, ' : ''}HR đọc quyết định, ${emp.name} bất ngờ đúng tính cách (hét, nghẹn, hoặc hỏi "có tăng lương không"); nhắc chỉ tiêu mới cao hơn; chốt bằng câu đùa hoặc lời hứa khao`,
    ]),
    extra: commonExtra(k, [emp, ...others], { recent: 0, quirk: true }),
  };
}

/** situation cho layoff: cắt giảm vì doanh thu kém — người bị cắt rời công ty như firing nhưng không phải vì lỗi của họ */
export function sitLayoff(k: SitKit, boss: AgentState | null, hr: AgentState, emp: AgentState, info: { revenuePct: number; periods: number }): Situation {
  return {
    situation: joinSit([
      boss
        ? `${who(boss)} và ${who(hr)} gọi ${whoRole(emp)} lên phòng Giám đốc để báo tin công ty phải cắt giảm nhân sự`
        : `Sếp vắng nhưng đã ký, ${who(hr)} gọi ${whoRole(emp)} lên phòng Giám đốc để báo tin cắt giảm nhân sự`,
      `Lý do: doanh thu tháng chỉ đạt ${info.revenuePct}% mục tiêu${info.periods >= 2 ? ` suốt ${info.periods} kỳ liền` : ''}, công ty không gánh nổi lương; không phải vì ${emp.name} làm sai`,
      `Diễn biến: HR nói về gói hỗ trợ, thư giới thiệu; ${boss ? 'sếp nói "gia đình khó khăn" và né nhìn thẳng; ' : ''}${emp.name} sốc → hỏi "sao lại là em" → chấp nhận trong ấm ức; nhắc bàn giao laptop, thẻ từ`,
      `Mục tiêu: buồn mà vẫn có duyên, có một câu chốt đáng nhớ của ${emp.name} trước khi ôm thùng đồ ra về; không tàn nhẫn`,
    ]),
    extra: commonExtra(k, [emp], { recent: 0, quirk: true }),
  };
}
