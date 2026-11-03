// =====================================================================
//  BỘ SINH THOẠI OFFLINE — dùng khi không có API key hoặc GPT lỗi/hết ngân sách.
//  Đây cũng là thứ chủ web thấy đầu tiên khi chưa có key, nên phải tự nhiên,
//  đúng giọng từng người và ít lặp.
//
//  Cách làm: mỗi loại cảnh có một "kịch bản khung" (mở → thân → phản ứng → chốt).
//  Mỗi nhịp chọn ngẫu nhiên một mẫu câu; mẫu câu là hàm nhận ngữ cảnh (người nói,
//  người nghe, người được nhắc) nên xưng hô luôn đúng: anh/chị/em/sếp/tui/ông/bà,
//  nhắc người vắng mặt bằng ảnh/chỉ/ẻm/ổng/bả. Thêm chủ đề, tình huống, quan hệ,
//  sản phẩm, tin đồn; câu vừa dùng gần đây bị né để đỡ lặp.
//  Không gọi mạng, không đụng state của World (chỉ đọc PromptContext).
// =====================================================================
import type {
  AgentState, Beat, BeatPlan, BeatRequest, CandidateRequest, DayRecap, Gender, HrAction, HrDecision, KpiResult, Look,
  NewsCategory, Persona, PromptContext, RecapRequest, RoleKey, SceneEffectKind, SceneLine, SceneRequest, SceneResult,
  SceneType, Traits, Verdict,
} from '../types.js';
import { CONFIG } from '../config.js';
import { LOOK_POOL, NAME_POOL } from '../content/roster.js';
import {
  ACTIVITY_FLAVOR, PROJECT_POOL, SLACK_ACTIVITIES, fillBeatDesc, pickTopic, topicCategoryOf, type TopicCategory,
} from '../content/catalog.js';
import { getProduct, pickProduct } from '../content/products.js';

// =====================================================================
//  1. Tiện ích nhỏ
// =====================================================================
const R = Math.random;
const ri = (a: number, b: number): number => a + Math.floor(R() * (b - a + 1));
const chance = (p: number): boolean => R() < p;
function pick<T>(a: readonly T[]): T { return a[Math.floor(R() * a.length)]; }
function shuffle<T>(a: readonly T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Hạ chữ cái đầu nếu là chữ thường hoá được và chữ thứ 2 không viết hoa (tránh phá chữ viết tắt) */
function lowerFirst(s: string): string {
  if (s.length > 1 && s[0] !== s[0].toLowerCase() && s[1] === s[1].toLowerCase()) return s[0].toLowerCase() + s.slice(1);
  return s;
}
const NUM_WORDS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];
/** 1..10 viết bằng chữ cho tự nhiên ("lần thứ hai"), còn lại giữ số */
const numWord = (n: number): string => (Number.isInteger(n) && n >= 0 && n <= 10 ? NUM_WORDS[n] : String(n));
/** số thứ tự: "thứ nhất", "thứ hai", "thứ tư"... */
const ordWord = (n: number): string => (n === 1 ? 'nhất' : n === 4 ? 'tư' : numWord(n));
const pctOf = (r: number): number => Math.round((Number.isFinite(r) ? r : 0) * 100);
const EMOJI_END = /\p{Extended_Pictographic}️?$/u;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
/** Cắt chuỗi ở ranh giới từ, thêm … */
function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max - 1);
  const sp = slice.lastIndexOf(' ');
  return (sp > max * 0.6 ? slice.slice(0, sp) : slice).replace(/[\s,.;:–-]+$/, '') + '…';
}
/** Regex khớp nguyên từ tiếng Việt (\b của JS không hiểu chữ có dấu) */
const wre = (w: string, flags = 'giu'): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, flags);
const norm = (s: string): string => s.normalize('NFC').toLowerCase();

/** Hoàn thiện 1 câu: gọn khoảng trắng, viết hoa đầu câu, thêm dấu chấm nếu cần */
function finish(raw: string): string {
  let t = raw.normalize('NFC').replace(/\s+/g, ' ').replace(/\s+([,.!?…])/g, '$1')
    .replace(/,\s*,/g, ',').replace(/([!?])\s*\.(?!\.)/g, '$1').replace(/(?<!\.)\.\s+\.(?!\.)/g, '.')
    .replace(/^[\s,]+/, '').trim();
  t = t.replace(/^Dạ, (Em|Anh|Chị|Tui|Tôi|Mình|Con)(?=[\s,.!?])/u, (_m, w: string) => 'Dạ, ' + w.toLowerCase());
  t = cap(t);
  if (t && !/[.!?…:)\]"'”»]$/u.test(t) && !EMOJI_END.test(t)) t += '.';
  return t;
}

// Bộ nhớ chống lặp câu giữa các cảnh (chỉ là cache chuỗi, không ảnh hưởng mô phỏng)
const RECENT_MAX = 2500; // ~10+ ngày game câu thoại: ưu tiên xoay vòng mẫu câu trước khi lặp lại
const recentQ: string[] = [];
const recentS = new Set<string>();
function remember(text: string): void {
  const k = norm(text);
  if (recentS.has(k)) return;
  recentQ.push(k); recentS.add(k);
  while (recentQ.length > RECENT_MAX) recentS.delete(recentQ.shift()!);
}

// =====================================================================
//  2. Nhân vật & xưng hô
// =====================================================================
interface P {
  id: string; name: string; fullName: string; role: RoleKey; roleLabel: string;
  gender: Gender; age: number; traits: Traits; a: AgentState | null; cand: boolean;
}
const DEFAULT_TRAITS: Traits = { diligence: 0.5, laziness: 0.5, gossip: 0.5, temper: 0.4, humor: 0.5, ambition: 0.5 };
const ROLE_KEYS: RoleKey[] = ['boss', 'hr', 'techlead', 'senior', 'junior', 'qa', 'designer', 'saleslead', 'salesnew', 'marketing'];
const DEV_ROLES: RoleKey[] = ['techlead', 'senior', 'junior'];
const TECH_ROLES: RoleKey[] = ['techlead', 'senior', 'junior', 'qa', 'designer'];
const SALES_ROLES: RoleKey[] = ['saleslead', 'salesnew'];
const isDev = (p: P): boolean => DEV_ROLES.includes(p.role);
const isSales = (p: P): boolean => SALES_ROLES.includes(p.role);

function toP(a: AgentState): P {
  const role = ROLE_KEYS.includes(a.role) ? a.role : 'junior';
  return {
    id: a.id, name: a.name || a.id, fullName: a.fullName || a.name || a.id, role,
    roleLabel: a.roleLabel || role, gender: a.gender === 'nữ' ? 'nữ' : 'nam',
    age: Number.isFinite(a.age) ? a.age : 27, traits: { ...DEFAULT_TRAITS, ...(a.traits ?? {}) },
    a, cand: a.status === 'candidate',
  };
}
function personOf(id: string, ctx: PromptContext): P {
  const a = ctx?.agents?.[id];
  if (a) return toP(a);
  return { id, name: id, fullName: id, role: 'junior', roleLabel: 'Nhân viên', gender: 'nam', age: 27,
    traits: DEFAULT_TRAITS, a: null, cand: false };
}
const relScore = (s: P, l: P): number => {
  const v = s.a?.relationships?.[l.id]?.score;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

interface Kin { you: string; me: string; yn: string }
/** Cách người nói (s) gọi người nghe (l): you = ngôi 2, me = tự xưng, yn = gọi kèm tên */
function kinOf(s: P, l: P): Kin {
  if (s.id === l.id) return { you: 'mình', me: 'mình', yn: 'mình' };
  if (s.role === 'boss') return { you: 'em', me: 'anh', yn: l.name };
  if (l.role === 'boss') return s.cand ? { you: 'anh', me: 'em', yn: `anh ${l.name}` } : { you: 'sếp', me: 'em', yn: 'sếp' };
  if (s.cand) { // ứng viên luôn giữ lễ: anh/chị – em
    const you = l.gender === 'nam' ? 'anh' : 'chị';
    return { you, me: 'em', yn: `${you} ${l.name}` };
  }
  const d = l.age - s.age;
  const sc = relScore(s, l);
  if (sc >= 20 && Math.abs(d) <= 3 && !s.cand && !l.cand) {
    const you = l.gender === 'nam' ? 'ông' : 'bà';
    return { you, me: 'tui', yn: `${you} ${l.name}` };
  }
  if (d >= 2 || (s.cand && d >= 0)) {
    const you = l.gender === 'nam' ? 'anh' : 'chị';
    // đang bực người lớn hơn vài tuổi thì xưng "tui" cho lạnh (kiểu Sài Gòn)
    return { you, me: sc <= -15 && d <= 6 && !s.cand ? 'tui' : 'em', yn: `${you} ${l.name}` };
  }
  if (d <= -2 || l.cand) return { you: 'em', me: s.gender === 'nam' ? 'anh' : 'chị', yn: l.name };
  return { you: l.name, me: 'tui', yn: l.name };
}
/** Gọi người thứ ba (có tên) từ góc nhìn người nói */
function refOf(s: P, x: P): string {
  if (s.id === x.id) return 'mình';
  if (x.role === 'boss' && s.role !== 'boss') return 'sếp';
  if (s.role === 'boss') return x.name;
  return x.age - s.age >= 2 ? `${x.gender === 'nam' ? 'anh' : 'chị'} ${x.name}` : x.name;
}
/** Đại từ ngôi ba kiểu Sài Gòn: ảnh/chỉ (lớn hơn), ẻm (nhỏ hơn), ổng/bả (ngang tuổi, sếp, nói sau lưng) */
function pronOf(s: P, x: P, behindBack = false): string {
  if (s.id === x.id) return 'mình';
  if (x.role === 'boss' && s.role !== 'boss') return 'ổng';
  if (s.role === 'boss') return x.gender === 'nam' ? 'cậu đó' : 'cô đó';
  const d = x.age - s.age;
  if (d <= -2) return 'ẻm';
  if (d >= 2 && !behindBack) return x.gender === 'nam' ? 'ảnh' : 'chỉ';
  return x.gender === 'nam' ? 'ổng' : 'bả';
}

// =====================================================================
//  3. Kho chi tiết đời thường
// =====================================================================
const FOODS = ['cơm tấm sườn bì chả', 'bún bò', 'bánh mì heo quay', 'hủ tiếu Nam Vang', 'cơm gà xối mỡ', 'bún thịt nướng',
  'phở tái', 'mì Quảng', 'bánh canh cua', 'bún riêu', 'cơm chay', 'xôi mặn', 'bánh xèo', 'mì cay', 'cơm sườn trứng',
  'bún đậu', 'gỏi cuốn', 'cơm văn phòng', 'bún mắm', 'cháo sườn'];
const DRINKS = ['trà sữa trân châu', 'bạc xỉu', 'cà phê sữa đá', 'trà đào cam sả', 'cà phê muối', 'nước mía', 'trà tắc',
  'sinh tố bơ', 'matcha latte', 'trà chanh'];
const SNACKS = ['bánh tráng trộn', 'khô gà lá chanh', 'hạt hướng dương', 'bánh quy bơ', 'rong biển sấy', 'mít sấy',
  'snack khoai tây', 'kẹo dẻo', 'bánh bông lan trứng muối', 'xoài lắc'];
const BUGS = ['trừ tiền hai lần khi bấm thanh toán', 'đăng nhập xong bị văng ra', 'in hóa đơn ra toàn ô vuông',
  'giỏ hàng trắng trơn trên điện thoại cũ', 'giá tiền hiện số âm', 'tìm kiếm có dấu không ra kết quả',
  'upload ảnh 5MB là sập', 'giờ hiển thị lệch 7 tiếng', 'bấm quay lại là mất hết dữ liệu',
  'ô số điện thoại nhập chữ cũng cho qua', 'thông báo bắn ba lần liền', 'tên có dấu bị lỗi font',
  'báo cáo doanh thu tính sai thuế', 'tồn kho ra số âm', 'mã giảm giá áp được hai lần', 'nút Lưu nằm sát nút Xóa'];
const FEATURES = ['xuất hóa đơn điện tử', 'đăng nhập bằng khuôn mặt', 'chatbot AI trả lời khách', 'chế độ tối',
  'đồng bộ kho năm chi nhánh', 'tích điểm đổi quà', 'báo cáo doanh thu theo giờ', 'chạy được khi mất mạng',
  'in tem mã vạch', 'tự gửi tin nhắn chúc mừng sinh nhật khách', 'đặt bàn online', 'kết nối máy tính tiền đời cũ'];
/** lý do một lần ("sáng nay ...") */
const EXCUSES = ['kẹt xe ở vòng xoay', 'xe xẹp lốp giữa đường', 'mưa ngập tới mắt cá', 'thang máy đông quá',
  'báo thức hết pin', 'cây xăng xếp hàng dài', 'bãi giữ xe hết chỗ', 'đường bị rào sửa ống nước',
  'quên ví phải quay về lấy', 'chở mẹ đi chợ', 'con mèo giấu mất chìa khóa xe'];
/** lý do lặp lại ("mấy hôm nay ...") */
const EXCUSES_DAILY = ['kẹt xe ở vòng xoay', 'trời mưa ngập đường', 'thang máy tòa nhà đông nghẹt', 'bãi giữ xe hết chỗ',
  'đường đang rào sửa ống nước', 'khu trọ cúp nước buổi sáng'];
const ERRORS = ['lỗi CORS', 'lỗi đọc dữ liệu rỗng', 'lỗi 500 lúc gọi API', 'lỗi không kết nối được database', 'lỗi build đỏ lòm',
  'cái màn hình trắng trơn', 'lỗi timeout', 'merge conflict', 'lỗi phân quyền', 'lỗi font tiếng Việt'];
const ITEMS = ['cây kéo', 'cái bấm kim', 'cục sạc', 'cây bút', 'cái dù', 'cuộn băng keo', 'cái tai nghe', 'cái đồ bấm lỗ'];
const SCREENS = ['đăng nhập', 'giỏ hàng', 'thanh toán', 'trang chủ', 'hồ sơ khách hàng', 'báo cáo'];

const TASKS: Record<RoleKey, string[]> = {
  boss: ['cuộc gọi với đối tác', 'đống hợp đồng chờ ký', 'buổi gặp nhà đầu tư'],
  hr: ['bảng chấm công', 'đống CV', 'bảng lương tháng này', 'hợp đồng của người mới'],
  techlead: ['mấy cái PR chờ review', 'tài liệu kiến trúc', 'vụ tối ưu database', 'buổi họp kỹ thuật'],
  senior: ['task thanh toán', 'mấy cái bug tồn', 'cái API báo cáo', 'phần refactor'],
  junior: ['task màn hình đăng nhập', 'mấy cái unit test', 'cái bug CSS', 'phần việc anh lead giao'],
  qa: ['bộ test case', 'đợt test hồi quy', 'mấy cái bug cần test lại', 'bản build mới'],
  designer: ['màn hình thanh toán', 'bộ banner sale', 'cái prototype cho khách', 'bộ icon mới'],
  saleslead: ['buổi demo cho khách', 'cái báo giá gấp', 'cuộc gọi cho khách VIP', 'hợp đồng chờ ký'],
  salesnew: ['danh sách khách phải gọi', 'cái báo giá', 'mấy tin nhắn khách chưa trả lời', 'đống dữ liệu CRM'],
  marketing: ['cái clip TikTok', 'bài đăng fanpage', 'chiến dịch quảng cáo', 'mấy cái inbox của khách'],
};
const TEAM_OF: Record<RoleKey, string> = {
  boss: 'ban giám đốc', hr: 'phòng nhân sự', techlead: 'phòng dev', senior: 'phòng dev', junior: 'phòng dev',
  qa: 'phòng dev', designer: 'team thiết kế', saleslead: 'team sales', salesnew: 'team sales', marketing: 'team marketing',
};
const ROLE_GENERIC: Record<RoleKey, string> = {
  boss: 'sếp', hr: 'phòng nhân sự', techlead: 'tech lead', senior: 'dev chính', junior: 'bạn fresher', qa: 'bên QA',
  designer: 'bên thiết kế', saleslead: 'trưởng nhóm sales', salesnew: 'bạn sales', marketing: 'bên marketing',
};

// Biểu cảm
const E = {
  fun: ['😂', '🤣', '😆', '😅'], shock: ['😱', '😳', '😮'], annoy: ['😤', '🙄', '😒'], sad: ['🥲', '😢', '😞'],
  sly: ['😏', '🤭', '🤫'], happy: ['😄', '😊', '🥳'], nervous: ['😰', '😅', '🥺'], think: ['🤔', '🧐'],
  polite: ['🙏', '😊'], boss: ['👔', '💪'], ok: ['👍', '👌'], party: ['🎉', '🥳', '🎂'], tired: ['😮', '🥱', '😩'],
  smile: ['🙂'], cool: ['😎'],
} as const;

// =====================================================================
//  4. Ngữ cảnh cảnh (SC) + ngữ cảnh câu (C)
// =====================================================================
interface Draft {
  sp: P; text: string; emote?: string; product?: boolean; opt?: boolean;
  /** người nghe lúc sinh câu */
  to?: P;
  /** cùng nhóm = cắt thì cắt cả nhóm (cặp hỏi–đáp) */
  grp?: number;
  /** câu này đáp lại câu kia: câu kia bị cắt thì câu này cũng bị cắt (nhưng câu này cắt riêng được) */
  dep?: Draft;
}
type Tpl = (c: C) => string | null | undefined | false;
type Loc = 'coffee' | 'water' | 'snack' | 'lounge' | 'window' | 'kpi' | 'table' | 'pantry';

interface SC {
  req: SceneRequest; ctx: PromptContext; type: SceneType; channel: 'office' | 'group' | 'company';
  cast: P[];
  /** người được nhắc tới (aboutId / chủ đề tin đồn / người mới...) */
  x: P | null;
  sit: string; sitRaw: string;
  /** những ai được gọi tên trong tình huống, theo thứ tự xuất hiện */
  named: P[];
  /** tên gọi của mọi nhân vật (để không lỡ viết thường tên riêng) */
  names: Set<string>;
  topic: string; topicCat: TopicCategory | null;
  food: string; drink: string; snack: string; bug: string; feature: string; err: string; item: string; screen: string;
  excuse: string; excuseDaily: string; ticket: number; project: string; client: string; deadlineText: string; daysLeft: number; time: string;
  companyShort: string; revenueText: string; bossNoteLow: string; loc: Loc;
  // dữ liệu riêng từng loại cảnh (builder điền)
  targetAct: string; subjAct: string; victimAct: string; victimKpi: number; histText: string; warnCount: number;
  lowPct: number; friendRef: string; deskItem: string; fixerName: string; blameRef: string; cheer: boolean; incRelease: boolean;
  // v3: tin thật đang bàn (chỉ tiêu đề + nguồn, không bao giờ thêm chi tiết), người đang được bàn tới trong cảnh nhân sự
  nTitle: string; nSource: string; nCat: NewsCategory | null;
  focus: P | null; action: HrAction;
  kin: Map<string, Kin>; usedT: Set<Tpl>; lines: Draft[];
}

function kin(sc: SC, s: P, l: P): Kin {
  const k = `${s.id}>${l.id}`;
  let v = sc.kin.get(k);
  if (!v) { v = kinOf(s, l); sc.kin.set(k, v); }
  return v;
}
const has = (sc: SC, ...words: string[]): boolean => words.some((w) => sc.sit.includes(w));

function findAgentByRole(sc: SC, role: RoleKey, notId?: string): P | null {
  const all = Object.values(sc.ctx?.agents ?? {}).filter((a) => a && a.role === role && a.status === 'active' && a.id !== notId);
  const inCast = sc.cast.find((p) => p.role === role && p.id !== notId);
  if (inCast) return inCast;
  const present = all.find((a) => a.present);
  const a = present ?? all[0];
  return a ? toP(a) : null;
}

class C {
  constructor(readonly sc: SC, readonly s: P, readonly l: P, readonly x: P | null) {}
  private get k(): Kin { return kin(this.sc, this.s, this.l); }
  get you(): string { return this.k.you; }
  get You(): string { return cap(this.k.you); }
  get me(): string { return this.k.me; }
  get Me(): string { return cap(this.k.me); }
  get yn(): string { return this.k.yn; }
  get Yn(): string { return cap(this.k.yn); }
  get S(): string { return this.s.name; }
  get L(): string { return this.l.name; }
  /** "Dạ, " khi người nói nhỏ hơn / nói với sếp */
  get da(): string { return this.s.role !== 'boss' && this.k.me === 'em' ? 'Dạ, ' : ''; }
  /** " ạ" cuối câu khi nói với sếp, người phỏng vấn hoặc người lớn hơn nhiều */
  get a(): string {
    if (this.s.role === 'boss' || this.k.me !== 'em') return '';
    return this.l.role === 'boss' || this.s.cand || this.l.age - this.s.age >= 9 ? ' ạ' : '';
  }
  get xn(): string { return this.x ? refOf(this.s, this.x) : 'người ta'; }
  get Xn(): string { return cap(this.xn); }
  get xp(): string { return this.x ? pronOf(this.s, this.x, true) : 'người ta'; }
  get Xp(): string { return cap(this.xp); }
  get X(): string { return this.x ? this.x.name : 'người ta'; }
  get crowd(): string {
    const others = this.sc.cast.filter((p) => p.id !== this.s.id);
    if (this.s.role === 'boss') return pick(['các em', 'cả nhà']);
    if (this.sc.channel === 'group') return pick(['ae', 'mn', 'cả nhà']);
    if (!others.length) return 'mọi người';
    if (others.every((o) => o.role === 'boss' || o.age - this.s.age >= 2)) {
      const g = new Set(others.map((o) => o.gender));
      return g.size > 1 ? 'anh chị' : others[0].gender === 'nam' ? 'mấy anh' : 'mấy chị';
    }
    if (others.every((o) => o.role !== 'boss' && this.s.age - o.age >= 2)) return pick(['mấy đứa', 'mấy em']);
    return pick(['mọi người', 'cả nhà']);
  }
  get Crowd(): string { return cap(this.crowd); }
  get topic(): string { return this.sc.topic; }
  get food(): string { return this.sc.food; }
  get anyFood(): string { return pick(FOODS); }
  get drink(): string { return this.sc.drink; }
  get Drink(): string { return cap(this.sc.drink); }
  get snack(): string { return this.sc.snack; }
  get bug(): string { return this.sc.bug; }
  get feature(): string { return this.sc.feature; }
  get Feature(): string { return cap(this.sc.feature); }
  get err(): string { return this.sc.err; }
  get item(): string { return this.sc.item; }
  get screen(): string { return this.sc.screen; }
  get ticket(): number { return this.sc.ticket; }
  get project(): string { return this.sc.project; }
  get Project(): string { return cap(this.sc.project); }
  get client(): string { return this.sc.client; }
  get deadline(): string { return this.sc.deadlineText; }
  get time(): string { return this.sc.time; }
  get weekday(): string { return this.sc.ctx?.weekday || 'hôm nay'; }
  get company(): string { return this.sc.companyShort; }
  get taskS(): string { return pick(TASKS[this.s.role]); }
  get taskL(): string { return pick(TASKS[this.l.role]); }
  get teamL(): string { return TEAM_OF[this.l.role]; }
  get bossAway(): boolean { return !!this.sc.ctx?.bossAway; }
  get rel(): number { return relScore(this.s, this.l); }
  get close(): boolean { return this.rel >= 25; }
  get hostile(): boolean { return this.rel <= -15; }
  get genz(): boolean { return this.s.age <= 25; }
  get isDevish(): boolean { return TECH_ROLES.includes(this.s.role); }
  /** Gọi người đang giữ vai trò role (từ góc nhìn người nói) */
  roleRef(role: RoleKey): string {
    const p = findAgentByRole(this.sc, role, this.s.id);
    return p ? refOf(this.s, p) : ROLE_GENERIC[role];
  }
  get hrRef(): string { return this.s.role === 'hr' ? this.me : this.roleRef('hr'); }
  get tlRef(): string { return this.s.role === 'techlead' ? this.me : this.roleRef('techlead'); }
  get watcher(): string { return this.bossAway ? this.hrRef : 'sếp'; }
  ref(p: P | null | undefined): string { return p ? (p.id === this.s.id ? this.me : refOf(this.s, p)) : 'người ta'; }
  /** câu ngay trước có chứa một trong các từ này không (để câu đáp khớp câu hỏi) */
  prevHas(...words: string[]): boolean {
    const t = norm(this.sc.lines[this.sc.lines.length - 1]?.text ?? '');
    return words.some((w) => t.includes(norm(w)));
  }
  /** cảnh đã có câu nào chứa một trong các từ này chưa */
  sceneHas(...words: string[]): boolean {
    return this.sc.lines.some((l) => words.some((w) => norm(l.text).includes(norm(w))));
  }
  /** trưởng phòng nhân sự có đang trong cảnh không */
  get hrHere(): boolean { return this.sc.cast.some((p) => p.role === 'hr'); }
  /** sếp có đang trong cảnh không (để không nói về sếp như người vắng mặt) */
  get bossHere(): boolean { return this.sc.cast.some((p) => p.role === 'boss'); }
  pron(p: P | null | undefined): string { return p ? pronOf(this.s, p) : 'người ta'; }
  // --- v3
  /** tiêu đề tin thật (đã cắt ≤ 90 ký tự) — chỉ dùng nguyên văn, không diễn giải */
  get title(): string { return this.sc.nTitle; }
  /** tên báo đăng tin */
  get src(): string { return this.sc.nSource; }
  /** người đang được HR/sếp bàn tới (hr_review) theo cách gọi của người nói */
  get focus(): string { return this.sc.focus ? this.ref(this.sc.focus) : 'bạn đó'; }
  get Focus(): string { return cap(this.focus); }
  /** thiện cảm của người nói với sếp (0 nếu không rõ) */
  get bossRel(): number { const b = findAgentByRole(this.sc, 'boss'); return b ? relScore(this.s, b) : 0; }
}

// =====================================================================
//  5. Builder: chọn mẫu câu, chống lặp, gắn biểu cảm
// =====================================================================
interface SayOpt { em?: readonly string[]; pe?: number; opt?: boolean; x?: P | null; product?: boolean; grp?: number; dep?: Draft | null }
/** [câu nói, các câu đáp hợp với nó] */
type Pair = readonly [Tpl, readonly Tpl[]];
/** Ghép một mảnh ngẫu nhiên từ mỗi nhóm thành một câu (mảnh trả null/'' bị bỏ) — nhiều tổ hợp, ít lặp */
function mix(...parts: readonly (readonly Tpl[])[]): Tpl {
  return (c) => {
    const out: string[] = [];
    for (const part of parts) {
      if (!part.length) continue;
      const t = pick(part)(c);
      if (t) out.push(t);
    }
    return out.length ? out.join(' ') : null;
  };
}
/** Tiền tố lễ phép cho người nhỏ hơn / nói với sếp ("Dạ, " / "Dạ vâng, "...) */
const daPre = (c: C): string => (c.da ? pick(['Dạ, ', 'Dạ, ', 'Dạ vâng, ']) : '');
let grpSeq = 0;

class B {
  constructor(readonly sc: SC) {}
  get lines(): Draft[] { return this.sc.lines; }
  last(): Draft | undefined { return this.sc.lines[this.sc.lines.length - 1]; }
  /** Người nghe mặc định: người vừa nói (nếu khác), không thì người đầu tiên khác mình */
  partnerOf(s: P): P {
    const lastSp = this.last()?.sp;
    if (lastSp && lastSp.id !== s.id) return lastSp;
    return this.sc.cast.find((p) => p.id !== s.id) ?? s;
  }
  /** Chọn người nói tiếp: khác người vừa nói, ưu tiên người nói ít */
  next(avoid?: P | null): P {
    const lastSp = this.last()?.sp;
    const counts = new Map<string, number>();
    for (const l of this.sc.lines) counts.set(l.sp.id, (counts.get(l.sp.id) ?? 0) + 1);
    let pool = this.sc.cast.filter((p) => p.id !== lastSp?.id && p.id !== avoid?.id);
    if (!pool.length) pool = this.sc.cast.filter((p) => p.id !== lastSp?.id);
    if (!pool.length) pool = this.sc.cast;
    const min = Math.min(...pool.map((p) => counts.get(p.id) ?? 0));
    const fresh = pool.filter((p) => (counts.get(p.id) ?? 0) === min);
    return chance(0.75) ? pick(fresh) : pick(pool);
  }
  isRepeat(text: string): boolean {
    const k = norm(text);
    return recentS.has(k) || this.sc.lines.some((l) => norm(l.text) === k);
  }
  /** Tạo câu (chưa thêm vào cảnh) */
  make(s: P, l: P | null | undefined, pool: readonly Tpl[], o: SayOpt = {}): Draft | null {
    if (!s || !pool.length) return null;
    const lis = l && l.id !== s.id ? l : this.partnerOf(s);
    const c = new C(this.sc, s, lis, o.x !== undefined ? o.x : this.sc.x);
    const order = [...shuffle(pool.filter((t) => !this.sc.usedT.has(t))), ...shuffle(pool.filter((t) => this.sc.usedT.has(t)))];
    let fb: { t: Tpl; text: string } | null = null;
    for (const t of order) {
      let raw: string | null | undefined | false;
      try { raw = t(c); } catch { raw = null; }
      if (!raw) continue;
      const text = finish(raw);
      if (!text) continue;
      if (this.isRepeat(text)) { if (!fb) fb = { t, text }; continue; }
      this.sc.usedT.add(t);
      return this.draft(s, text, o, lis);
    }
    if (fb) { this.sc.usedT.add(fb.t); return this.draft(s, fb.text, o, lis); }
    return null;
  }
  private draft(s: P, text: string, o: SayOpt, to?: P): Draft {
    const d: Draft = { sp: s, text, to };
    // câu đã có emoji thì thôi không gắn thêm biểu cảm (tránh "🙂 🙂", "😭 🎉")
    if (o.em && o.em.length && !HAS_EMOJI.test(text) && chance(o.pe ?? 0.45)) d.emote = pick(o.em);
    if (o.opt) d.opt = true;
    if (o.product) d.product = true;
    if (o.grp !== undefined) d.grp = o.grp;
    if (o.dep) d.dep = o.dep;
    return d;
  }
  /** Nói một câu rồi người kia đáp bằng câu khớp với nó; hai câu cùng nhóm (cắt thì cắt cả cặp) */
  pair(a: P | null | undefined, z: P | null | undefined, pairs: readonly Pair[], o1: SayOpt = {}, o2: SayOpt = {}): boolean {
    if (!a || !z) return false;
    const grp = ++grpSeq;
    const fresh = pairs.filter(([q]) => !this.sc.usedT.has(q));
    for (const [q, answers] of [...shuffle(fresh), ...shuffle(pairs.filter((p) => !fresh.includes(p)))]) {
      const d1 = this.make(a, z, [q], { ...o1, grp });
      if (!d1) continue;
      this.sc.lines.push(d1);
      const d2 = this.make(z, a, answers, { ...o2, grp });
      if (d2) this.sc.lines.push(d2);
      return true;
    }
    return false;
  }
  /** Ưu tiên kho riêng (theo vai trò/tình huống), không có câu hợp thì lấy kho chung */
  sayPref(s: P | null | undefined, l: P | null | undefined, primary: readonly Tpl[], fallback: readonly Tpl[], o: SayOpt = {}, p = 0.8): Draft | null {
    if (!s) return null;
    const first = chance(p) ? primary : fallback;
    const d = this.make(s, l, first, o) ?? this.make(s, l, first === primary ? fallback : primary, o);
    if (d) this.sc.lines.push(d);
    return d;
  }
  say(s: P | null | undefined, l: P | null | undefined, pool: readonly Tpl[], o: SayOpt = {}): Draft | null {
    if (!s) return null;
    const d = this.make(s, l, pool, o);
    if (d) this.sc.lines.push(d);
    return d;
  }
}

// =====================================================================
//  6. Hiệu ứng (gom rồi lọc theo allowedEffects khi trả kết quả)
// =====================================================================
class FX {
  rel: { from: string; to: string; delta: number; reason: string }[] = [];
  mood = new Map<string, number>();
  kpi = new Map<string, number>();
  mem = new Map<string, string>();
  rumor: { aboutId: string; text: string } | null = null;
  verdict: Verdict | null = null;
  /** v3: quyết định nhân sự (chỉ hr_review) */
  decisions: HrDecision[] | null = null;
  relAdd(from: P | null | undefined, to: P | null | undefined, delta: number, reason: string): void {
    if (!from || !to || from.id === to.id || !delta) return;
    this.rel.push({ from: from.id, to: to.id, delta, reason });
  }
  moodAdd(p: P | null | undefined, d: number): void { if (p && d) this.mood.set(p.id, (this.mood.get(p.id) ?? 0) + d); }
  kpiAdd(p: P | null | undefined, d: number): void { if (p && d) this.kpi.set(p.id, (this.kpi.get(p.id) ?? 0) + d); }
  memo(p: P | null | undefined, text: string): void { if (p && text && !this.mem.has(p.id)) this.mem.set(p.id, text); }
}

/** Cảnh có kết quả do AI/offline quyết + giá trị mặc định (giống sanitize.ts VERDICT_BY_TYPE) */
const VERDICT_DEFAULT: Partial<Record<SceneType, Verdict>> = {
  interview: 'hired', resign_talk: 'stay', raise_request: 'denied',
  // v5: builder luôn đặt theo req.crisis.pick; đây chỉ là chốt chặn
  crisis_meeting: 'plan_a', pep_talk: 'inspired',
};

function finalizeFx(fx: FX, sc: SC): Pick<SceneResult, 'relationshipChanges' | 'moodChanges' | 'memories' | 'kpiChanges' | 'rumor' | 'verdict' | 'hrDecisions'> {
  const allowed = new Set<SceneEffectKind>(Array.isArray(sc.req.allowedEffects) ? sc.req.allowedEffects : []);
  const ids = new Set(sc.cast.map((p) => p.id));
  const aboutIds = new Set<string>([...ids]);
  if (sc.req.aboutId) aboutIds.add(sc.req.aboutId);
  if (sc.req.rumor?.aboutId) aboutIds.add(sc.req.rumor.aboutId);
  // gộp các thay đổi trùng cặp
  const relMap = new Map<string, { from: string; to: string; delta: number; reason: string }>();
  if (allowed.has('relationship')) {
    for (const r of fx.rel) {
      if (!ids.has(r.from) || !aboutIds.has(r.to) || r.from === r.to) continue;
      const k = `${r.from}>${r.to}`;
      const prev = relMap.get(k);
      if (prev) prev.delta += r.delta; else relMap.set(k, { ...r });
    }
  }
  const relationshipChanges = [...relMap.values()]
    .map((r) => ({ ...r, delta: Math.round(clamp(r.delta, -8, 8)), reason: cut(r.reason, 60) }))
    .filter((r) => r.delta !== 0);
  const moodChanges = allowed.has('mood')
    ? [...fx.mood].filter(([id]) => ids.has(id)).map(([id, d]) => ({ id, delta: Math.round(clamp(d, -10, 10)) })).filter((m) => m.delta)
    : [];
  const kpiChanges = allowed.has('kpi')
    ? [...fx.kpi].filter(([id]) => ids.has(id)).map(([id, d]) => ({ id, delta: Math.round(clamp(d, -10, 10)) })).filter((m) => m.delta)
    : [];
  const memories = allowed.has('memory')
    ? [...fx.mem].filter(([id]) => ids.has(id)).map(([id, text]) => ({ id, text: cut(text, 100) }))
    : [];
  const rumor = allowed.has('rumor') && fx.rumor && fx.rumor.text ? { aboutId: fx.rumor.aboutId, text: cut(fx.rumor.text, 140) } : null;
  // verdict theo LOẠI cảnh (như sanitize): interview hired/rejected · resign_talk stay/leave · raise_request approved/denied
  const vDefault = VERDICT_DEFAULT[sc.type] ?? null;
  const verdict: Verdict | null = vDefault ? (fx.verdict ?? vDefault) : null;
  const hrDecisions = sc.type === 'hr_review' ? (fx.decisions ?? []) : null;
  return { relationshipChanges, moodChanges, memories, kpiChanges, rumor, verdict, hrDecisions };
}

// =====================================================================
//  7. Văn chat (nhóm kín) — viết tắt, emoji, thường hoá
// =====================================================================
const CHAT_SUBS: [string, string, number][] = [
  ['không', 'ko', 0.7], ['được', 'đc', 0.7], ['rồi', 'r', 0.55], ['gì', 'j', 0.5], ['vậy', 'v', 0.45],
  ['với', 'vs', 0.45], ['anh em', 'ae', 0.8], ['mọi người', 'mn', 0.7], ['công ty', 'cty', 0.7],
  ['trước', 'trc', 0.35], ['biết', 'bít', 0.2], ['nữa', 'nx', 0.3], ['luôn', 'lun', 0.3], ['cũng', 'cx', 0.3],
  ['thôi', 'thui', 0.3], ['bây giờ', 'bh', 0.5], ['điện thoại', 'đt', 0.6], ['chưa', 'chx', 0.2], ['nhiêu', 'nhiu', 0.3],
];
const CHAT_TAILS = [' =))', ' :))', ' kkk', ' 🤣', ' 😂', ' hihi', ' 😅', ' :v'];
function chatify(text: string, sp: P): string {
  const lv = sp.age <= 25 ? 0.9 : sp.age <= 30 ? 0.6 : sp.age <= 36 ? 0.35 : 0.15;
  let out = text;
  for (const [w, r, p] of CHAT_SUBS) {
    if (!norm(out).includes(w)) continue;
    out = out.replace(wre(w), (m, off: number) => (off > 0 && R() < p * lv ? r : m));
  }
  out = out.replace(/\.$/u, '');
  if (R() < 0.55 * lv) out = lowerFirst(out);
  if (R() < 0.22 * lv && !HAS_EMOJI.test(out) && !/[=:]\)\)|kkk|:v|hehe|hihi|haha/i.test(out)) out += pick(CHAT_TAILS);
  return out;
}

// =====================================================================
//  8. Tin đồn: tạo mới & "tam sao thất bản"
// =====================================================================
function makeRumor(x: P, sc: SC): string {
  const name = x.role === 'boss' ? `Sếp ${x.name}` : x.name;
  const hr = findAgentByRole(sc, 'hr', x.id);
  const hrName = hr ? `${hr.gender === 'nam' ? 'anh' : 'chị'} ${hr.name}` : 'phòng nhân sự';
  const pool: string[] = [];
  const a = x.a;
  const kpiLow = !!a && ((a.lowStreak ?? 0) >= 1 || (a.warnings ?? 0) > 0);
  if (kpiLow && x.role !== 'boss' && x.role !== 'hr') {
    pool.push(`${name} sắp bị cho nghỉ vì KPI thấp`, `${name} đã lén nộp CV chỗ khác vì sợ bị đuổi`);
    if (!sc.cast.some((p) => p.role === 'hr')) pool.push(`${name} bị ${hrName} gọi lên phòng họp hai lần trong tuần`);
  }
  // cặp oan gia => đồn hẹn hò
  const rivals = Object.entries(a?.relationships ?? {}).filter(([, r]) => r && r.score <= -15).map(([id]) => sc.ctx.agents?.[id])
    .filter((o): o is AgentState => !!o && o.status === 'active' && o.gender !== x.gender && o.role !== 'boss');
  if (rivals.length) { const o = pick(rivals); pool.push(`${name} với ${o.name} cãi nhau là giả, thật ra đang hẹn hò`); }
  switch (x.role) {
    case 'boss': pool.push(`${name} sắp mua thêm bộ gậy golf bằng tiền thưởng Tết`, `${name} đang tính chuyển văn phòng ra gần sân golf`,
      `${name} đang bí mật tuyển người thay cả team sales`); break;
    case 'hr': pool.push(`${name} có danh sách những người sắp bị cho nghỉ`, `${name} sắp được lên phó giám đốc`,
      `${name} ghi cả chuyện ai ăn vụng bánh vào sổ`); break;
    case 'techlead': case 'senior': case 'junior':
      pool.push(`${name} đang nhận làm thêm cho công ty khác ban đêm`, `${name} sắp được tăng lương gấp rưỡi`,
        `${name} mới lỗ crypto mất nửa năm lương`); break;
    case 'qa': pool.push(`${name} có file ghi bug riêng của từng người để nộp sếp`, `${name} sắp được mời qua công ty đối thủ`); break;
    case 'designer': pool.push(`${name} đang quen một anh làm bên tòa nhà đối diện`, `${name} đi trễ vì đi chụp ảnh ngoại cảnh`); break;
    case 'saleslead': case 'salesnew':
      pool.push(`${name} sắp nhảy qua công ty đối thủ`, `${name} được khách tặng hẳn một chai rượu ngoại`,
        `${name} chốt deal xong đi karaoke với khách tới 2 giờ sáng`); break;
    case 'marketing': pool.push(`${name} sắp nghỉ để làm KOL toàn thời gian`, `${name} có kênh TikTok bí mật 50 nghìn follow`); break;
  }
  if (x.role === 'boss') {
    pool.push(`${name} đang học nhảy để biểu diễn tiệc cuối năm`, `${name} nhờ AI viết hết bài phát biểu buổi sáng`,
      `${name} là người ăn vụng bánh trong tủ lạnh`, `${name} sắp đổi xe mới bằng tiền thưởng dự án`);
    return pick(pool);
  }
  pool.push(`${name} được sếp tăng lương bí mật`, `${name} lén đi phỏng vấn công ty khác`, `${name} sắp cưới mà giấu cả công ty`,
    `${name} là người ăn vụng bánh trong tủ lạnh`, `${name} nhờ AI viết hết báo cáo tuần`, `${name} đăng story than công ty rồi xóa liền`,
    `${name} đang để dành tiền mua nhà mặt tiền`, `${name} hay đi trễ vì đi tập pickleball với crush`);
  return pick(pool);
}

const TWISTS: [string, string][] = [
  ['sắp bị cho nghỉ', 'đã bị cho nghỉ, chỉ chờ ngày công bố'], ['sắp được', 'đã được'], ['sắp', 'đã'],
  ['có thể', 'chắc chắn'], ['nghe nói', 'chính mắt thấy'], ['hai lần', 'năm lần'], ['ba lần', 'bảy lần'],
  ['một lần', 'ba lần'], ['gấp rưỡi', 'gấp ba'], ['gấp đôi', 'gấp ba'], ['tăng lương', 'tăng lương gấp đôi'],
  ['phỏng vấn', 'nhận offer'], ['nộp CV', 'ký hợp đồng'], ['hẹn hò', 'sắp cưới'], ['đi trễ', 'nghỉ không phép'],
  ['đi cà phê', 'đi hẹn hò'], ['chơi game', 'chơi game xuyên trưa'], ['ngủ gật', 'ngủ ngáy'], ['bí mật', 'công khai luôn'],
  ['công ty khác', 'công ty đối thủ'], ['nửa năm lương', 'cả năm lương'], ['50 nghìn', '200 nghìn'],
  ['cãi nhau', 'cãi nhau tới mức sếp phải can'], ['tòa nhà đối diện', 'tòa nhà đối diện, còn đưa đón mỗi ngày'],
];
function escalations(sc: SC, x: P): string[] {
  const hr = findAgentByRole(sc, 'hr', x.id);
  return ['mà còn bị bắt gặp tận hai lần', hr ? `${hr.gender === 'nam' ? 'anh' : 'chị'} ${hr.name} cũng biết rồi` : 'phòng nhân sự cũng biết rồi',
    'có người thấy tận mắt luôn', 'cả tòa nhà đồn rần rần', 'tuần sau là có kết quả', 'mà giấu kỹ lắm',
    'sếp biết rồi mà làm lơ', 'nghe nói còn có ảnh làm bằng chứng', 'chuyện này kéo dài cả tháng rồi',
    'bảo vệ tòa nhà cũng xác nhận', 'nhóm chat bên kia bàn tán quá trời', 'mà ai hỏi cũng chối'];
}
/** Kể lại tin đồn: phóng đại 1–2 chi tiết + thêm một vế "mắm muối" */
function twistRumor(text: string, sc: SC, x: P): string {
  let t = text.replace(/\s+/g, ' ').trim().replace(/[.!…]+$/u, '');
  let changed = false;
  let swaps = chance(0.5) ? 2 : 1;
  for (const [from, to] of shuffle(TWISTS)) {
    if (swaps <= 0) break;
    const re = wre(from, 'iu');
    if (!re.test(t)) continue;
    if (to.includes('gấp') && /gấp/u.test(t) && from === 'tăng lương') continue;
    if (norm(t).includes(norm(to))) continue;
    t = t.replace(re, to); changed = true; swaps--;
  }
  if (!changed || chance(0.3)) {
    const m = t.match(/\d+/);
    if (m) { const n = Number(m[0]); t = t.replace(m[0], String(n < 10 ? n + ri(2, 4) : n * ri(2, 3))); changed = true; }
  }
  // bỏ vế "mắm muối" đã có (kể cả khi vế cũ vừa bị đổi chữ, vd "nghe nói" -> "chính mắt thấy"):
  // so cả 3 từ đầu / 3 từ cuối, tránh "…còn có ảnh làm bằng chứng, nghe nói còn có ảnh làm bằng chứng"
  const seen = (e: string): boolean => {
    const nt = norm(t), ne = norm(e);
    if (nt.includes(ne) || norm(text).includes(ne)) return true;
    const w = ne.split(/\s+/).filter(Boolean);
    return w.length >= 4 && (nt.includes(w.slice(0, 3).join(' ')) || nt.includes(w.slice(-3).join(' ')));
  };
  const esc = escalations(sc, x).filter((e) => !seen(e));
  if (esc.length && (!changed || chance(0.85))) {
    const add = pick(esc);
    // giữ ≤ 140 ký tự: bỏ bớt vế cuối cũ nếu quá dài
    let base = t;
    while (base.length + add.length + 2 > 140 && base.includes(', ')) base = base.slice(0, base.lastIndexOf(', '));
    t = `${base}, ${add}`;
  }
  return cut(t, 140);
}
/** Thay tên người bị đồn ở đầu câu bằng cách người kể gọi họ ("anh Khoa", "sếp") */
function tellAs(sc: SC, teller: P, x: P | null, text: string): string {
  const t = text.trim().replace(/[.!…]+$/u, '');
  if (x) {
    const r = refOf(teller, x);
    for (const head of [`Sếp ${x.name}`, `sếp ${x.name}`, x.name]) {
      if (t.startsWith(head + ' ')) return r + t.slice(head.length);
    }
  }
  return softLower(sc, t);
}
/** Hạ chữ đầu câu trừ khi đó là tên người */
function softLower(sc: SC, t: string): string {
  const first = t.split(/[\s,]/)[0] ?? '';
  return sc.names.has(first) ? t : lowerFirst(t);
}

/** Nhãn hoạt động (lười, ngủ, bóng bàn...) mà Director hay ghi trong tình huống */
type ActKind = 'slack' | 'nap' | 'pingpong' | 'chill';
const actOf = (list: { label: string; emote: string }[] | undefined, kind: ActKind) =>
  (list ?? []).map((a) => ({ label: a.label, emote: a.emote, kind }));
const ACT_LABELS: { label: string; emote: string; kind: ActKind }[] = [
  ...actOf(SLACK_ACTIVITIES, 'slack'), ...actOf(ACTIVITY_FLAVOR.napping, 'nap'),
  ...actOf(ACTIVITY_FLAVOR.pingpong, 'pingpong'), ...actOf(ACTIVITY_FLAVOR.chill, 'chill'),
  ...actOf([{ label: 'ngủ', emote: '😴' }], 'nap'), ...actOf([{ label: 'bóng bàn', emote: '🏓' }], 'pingpong'),
  ...actOf([{ label: 'sofa', emote: '🛋️' }], 'chill'), ...actOf([{ label: 'điện thoại', emote: '📱' }], 'slack'),
].sort((a, b) => b.label.length - a.label.length);
interface ActInfo { label: string; emote: string; kind: ActKind | 'none' }
/** Người này đang lười kiểu gì? Ưu tiên "<Tên> đang <nhãn>" trong tình huống, rồi tới state của agent */
function activityOf(sc: SC, p: P, anywhere = false): ActInfo {
  const raw = sc.sitRaw;
  const i = raw.indexOf(`${p.name} đang `);
  if (i >= 0) {
    const rest = norm(raw.slice(i + p.name.length + 6, i + p.name.length + 60));
    const hit = ACT_LABELS.find((a) => rest.startsWith(norm(a.label)));
    if (hit) return { ...hit };
  }
  // "Trâm vừa bị sếp bắt quả tang đang gục mặt xuống bàn", "Tú (Nhân viên Sales) đang chơi game"
  for (let from = 0, n = 0; n < 4; n++) {
    const j = raw.indexOf(p.name, from);
    if (j < 0) break;
    from = j + p.name.length;
    const win = raw.slice(from, from + 70);
    const k = win.indexOf('đang ');
    if (k < 0 || /[.;\n]/u.test(win.slice(0, k))) continue;
    const rest = norm(win.slice(k + 5));
    const hit = ACT_LABELS.find((a) => rest.startsWith(norm(a.label)));
    if (hit) return { ...hit };
  }
  const a = p.a;
  if (a && ['slacking', 'napping', 'pingpong', 'chill'].includes(a.activity) && a.activityLabel) {
    const kind = a.activity === 'napping' ? 'nap' : a.activity === 'pingpong' ? 'pingpong' : a.activity === 'chill' ? 'chill' : 'slack';
    return { label: a.activityLabel, emote: a.emote || '📱', kind };
  }
  if (anywhere) {
    const hit = ACT_LABELS.find((x) => sc.sit.includes(norm(x.label)));
    if (hit) return { ...hit };
  }
  return { label: '', emote: '', kind: 'none' };
}

// =====================================================================
//  9. Kho mẫu câu dùng chung: chủ đề, phản ứng, than việc, chốt cảnh
// =====================================================================
const TOPIC_OPEN: Tpl[] = [
  (c) => `${c.Yn} nghe chuyện ${c.topic} chưa?`,
  (c) => `Nói chứ vụ ${c.topic} làm ${c.me} rầu thiệt sự.`,
  (c) => `Sáng giờ cả văn phòng bàn chuyện ${c.topic} quá trời.`,
  (c) => `${c.Yn} thấy chuyện ${c.topic} sao?`,
  (c) => `Cả tuần nay ${c.me} cứ nghĩ tới chuyện ${c.topic} hoài.`,
  (c) => `Ủa vụ ${c.topic} là thiệt hả ${c.you}?`,
  (c) => `Hồi sáng ${c.me} mới nghe chuyện ${c.topic}, giờ vẫn còn sốc.`,
];
const CAT_OPEN: Record<TopicCategory, Tpl[]> = {
  doi_song: [(c) => `Kể ${c.you} nghe vụ ${c.topic} nè.`, (c) => `Dạo này ${c.me} đang đau đầu vụ ${c.topic}.`,
    (c) => `Nói chứ vụ ${c.topic} làm ${c.me} rầu thiệt sự.`],
  cong_viec_dev: [(c) => `Nghe chuyện ${c.topic} mà ${c.me} nổi da gà.`,
    (c) => (c.isDevish ? `Hôm qua bên ${c.me} lại dính vụ ${c.topic} đó.` : `Nghe bên dev than vụ ${c.topic} mà ${c.me} thấy tội.`)],
  cong_viec_sales: [(c) => (isSales(c.s) ? `Sales khổ lắm ${c.you} ơi, mới dính vụ ${c.topic} xong.` : `Nghe team sales than vụ ${c.topic} mà thấy tội ghê.`),
    (c) => `${c.Yn} biết vụ ${c.topic} chưa, nghe mà muốn khóc.`],
  van_phong: [(c) => `Văn phòng mình lại có vụ ${c.topic} nữa rồi.`, (c) => `Ai chịu nổi vụ ${c.topic} vậy trời?`],
  drama: [(c) => `Nói nhỏ nè, vụ ${c.topic} đó ${c.you} nghe chưa?`, (c) => `Hóng nè: chuyện ${c.topic}, ${c.you} biết gì hông?`],
  giai_tri: [(c) => `${c.Yn} coi ${c.topic} chưa? Hay xỉu luôn.`, (c) => `Tối qua ${c.me} thức khuya coi ${c.topic} đó.`,
    (c) => `Tuần này ai cũng bàn ${c.topic}, ${c.you} biết chưa?`, (c) => `${c.Yn} có hóng ${c.topic} hông?`],
  tien_bac: [(c) => `Nói chuyện tiền nong chút: vụ ${c.topic} ${c.you} tính sao?`, (c) => `Nhìn chuyện ${c.topic} mà ${c.me} muốn đi làm thêm ca đêm.`,
    (c) => `Dạo này ai cũng than vụ ${c.topic}, ${c.you} thấy sao?`],
  tinh_cam: [(c) => `Hỏi thiệt nha, chuyện ${c.topic} ${c.you} nghĩ sao?`, (c) => `${c.Me} đang rối vụ ${c.topic} nè, cho ${c.me} lời khuyên đi.`,
    (c) => `${c.You} từng bị vụ ${c.topic} chưa?`],
  cong_nghe: [(c) => `${c.Yn} có để ý chuyện ${c.topic} hông?`, (c) => `Công nghệ giờ ghê thiệt, vụ ${c.topic} đó.`,
    (c) => `Dạo này ai cũng bàn chuyện ${c.topic}, ${c.you} thấy sao?`],
  an_uong: [(c) => `Nhắc tới ${c.topic} là ${c.me} đói liền.`, (c) => `${c.Yn} thấy ${c.topic} sao, đáng thử hông?`, (c) => `Dạo này ai cũng rủ ${c.me} vụ ${c.topic}.`],
};
const CAT_REACT: Record<TopicCategory, Tpl[]> = {
  doi_song: [(c) => `Trời ơi, nghe thôi đã thấy mệt.`, (c) => `Sài Gòn mà, chuyện thường ngày ở huyện.`,
    (c) => `${c.Me} cũng y chang, sáng nay muốn bỏ về luôn.`, (c) => `Thôi kệ, sống chung với nó riết rồi quen.`],
  cong_viec_dev: [(c) => `Nghe là thấy mùi production rồi.`, (c) => `Dev mà, khổ quen rồi ${c.you} ơi.`,
    (c) => `Ai làm người đó chịu nha, đừng réo ${c.me}.`, (c) => `Haizz, chuyện muôn thuở.`],
  cong_viec_sales: [(c) => `Sales mà, cười trên môi khóc trong tim.`, (c) => `Khách là thượng đế, mà thượng đế hay đổi ý lắm.`,
    (c) => `Nghe quen ghê, tháng nào cũng vậy.`],
  van_phong: [(c) => `Văn phòng mình chuyện gì cũng có.`, (c) => `Vậy mà không ai nói gì hả trời?`,
    (c) => (c.hrHere ? null : `Chuyện này phải báo ${c.hrRef} mới được.`)],
  drama: [(c) => `Trời, drama vậy mà giờ ${c.me} mới biết?`, (c) => `Hóng! Kể tiếp đi ${c.you}.`, (c) => `Nói nhỏ thôi, tường có tai đó.`],
  giai_tri: [(c) => `Coi rồi, hay xỉu luôn!`, (c) => `Chưa coi, đừng spoil nha ${c.you}!`, (c) => `Cái đó hot cả tuần nay rồi.`],
  tien_bac: [(c) => `Nhắc tới tiền là ${c.me} đau tim.`, (c) => `Ví ${c.me} đang ở chế độ tiết kiệm pin.`,
    (c) => `Lương về rồi đi đâu mất tiêu, ${c.me} cũng không hiểu.`],
  tinh_cam: [(c) => `Ui, chuyện tình cảm là ${c.me} hóng nhất.`, (c) => `Thôi, độc thân vui vẻ đi ${c.you}.`, (c) => `Nghe mà thấy thương ghê.`],
  cong_nghe: [(c) => `Công nghệ đổi nhanh quá, theo không kịp.`, (c) => `Cái đó xịn thiệt mà giá cũng xịn.`,
    (c) => `Mua về chắc cũng chỉ để lướt TikTok thôi.`],
  an_uong: [(c) => `Nói tới ăn là ${c.me} tỉnh liền.`, (c) => `Thèm quá, đói bụng luôn rồi.`, (c) => `Nghe là thấy calo nhảy múa.`],
};
const CAT_DETAIL: Record<TopicCategory, Tpl[]> = {
  doi_song: [
    (c) => `Sáng nay ${c.me} chạy xe mất 45 phút cho có 6 cây số.`,
    (c) => `Tiền trọ tăng thêm 500 nghìn, chủ nhà nói tại giá điện lên.`,
    (c) => `Mèo nhà ${c.me} cào nát cái sofa mới mua.`,
    (c) => `${c.Me} đăng ký tập gym 6 tháng, đi được đúng 3 buổi.`,
    (c) => `Hàng xóm hát karaoke tới 11 giờ đêm, bài nào cũng lên tông.`,
    (c) => `Cuối tuần về quê, mẹ hỏi ${c.me} "bao giờ cưới" đúng bảy lần.`,
    (c) => `Hôm qua mưa ngập, ${c.me} dắt xe bộ gần một cây số.`,
    (c) => `Chung cư ${c.me} cúp nước, sáng nay đánh răng bằng nước suối.`,
  ],
  cong_viec_dev: [
    (c) => (c.isDevish ? `Hôm qua ${c.me} debug ba tiếng, hóa ra thiếu một dấu phẩy.` : `Nghe nói bên dev debug ba tiếng, hóa ra thiếu một dấu phẩy.`),
    (c) => `Code cũ toàn comment "đừng sửa đoạn này", ai dám đụng.`,
    (c) => `Khách đổi yêu cầu lần thứ năm, lần này đổi luôn màu logo.`,
    (c) => `Test trên máy thì ngon, lên máy khách là đứng hình.`,
    (c) => (c.isDevish ? `${c.Me} nhờ AI viết code, nó viết luôn bug cho tiện.` : `Bên dev nhờ AI viết code, nghe nói nó viết luôn bug cho tiện.`),
    (c) => (c.isDevish ? `Merge xong cái nhánh tuần trước mà conflict cả trăm dòng.` : `Thấy mấy ông dev mặt mày tái mét vì cái gì mà "conflict" đó.`),
    (c) => (c.isDevish ? `Đọc log lỗi dài như sớ, lướt mỏi tay mới tới dòng quan trọng.` : `${c.Me} liếc màn hình dev mà toàn chữ đỏ, nhìn thôi đã chóng mặt.`),
  ],
  cong_viec_sales: [
    (c) => (isSales(c.s) ? `Khách hẹn mai ký, sáng nay chặn luôn số ${c.me}.` : `Nghe nói có khách hẹn mai ký, sáng nay chặn số luôn.`),
    (c) => (isSales(c.s) ? `Gọi 40 cuộc, được hai người nghe, một người cúp máy.` : `Bên sales gọi 40 cuộc mới có hai người nghe máy, khổ ghê.`),
    (c) => `Khách quán trà sữa đòi dùng thử thêm một tháng nữa.`,
    (c) => (isSales(c.s) ? `Khách hỏi phần mềm có AI không, ${c.me} gật liền cho chắc.` : `Khách hỏi phần mềm có AI không, sales gật liền cho chắc.`),
    (c) => `Doanh số tháng này mới được ${c.sc.revenueText}, ${c.me} nhìn mà run.`,
  ],
  van_phong: [
    (c) => `Máy lạnh để 18 độ, ${c.me} mặc hai lớp áo vẫn run.`,
    (c) => `Máy in kẹt giấy lần thứ ba trong ngày rồi đó.`,
    (c) => `Ai lấy hộp sữa chua ghi tên ${c.me} trong tủ lạnh vậy trời.`,
    (c) => `Họp hai tiếng mà kết luận là... họp tiếp.`,
    (c) => `Wifi chỗ bàn ${c.me} có đúng một vạch.`,
    (c) => `Thang máy hỏng, sáng nay ${c.me} leo bộ bảy tầng.`,
    (c) => `Tủ lạnh pantry có hộp cơm ai để từ tuần trước, mở ra là xỉu.`,
  ],
  drama: [
    (c) => `Hôm qua ${c.me} thấy có người ra vào phòng sếp ba lần.`,
    (c) => `Có người đăng story "mệt mỏi quá" rồi xóa liền.`,
    (c) => `Nghe đâu có người được tăng lương mà giấu kỹ lắm.`,
    (c) => `Bàn ai đó tự nhiên dọn sạch trơn, nghi lắm nha.`,
  ],
  giai_tri: [
    (c) => `Tối qua ${c.me} cày tới 2 giờ sáng, giờ mắt như gấu trúc.`,
    (c) => `Trend đó ${c.me} quay năm lần mà vẫn lệch nhịp.`,
    (c) => `Cuối tuần đi concert, đứng xa tới mức nhìn ca sĩ như con kiến.`,
    (c) => `Tập cuối mà kết mở, ${c.me} tức muốn xỉu.`,
    (c) => `Coi trận tối qua tới gần sáng, giờ mắt ${c.me} díp lại.`,
  ],
  tien_bac: [
    (c) => `Lương về ba ngày là trả góp, tiền nhà, tiền điện, hết sạch.`,
    (c) => `${c.Me} mua vàng đúng đỉnh, giờ ôm nhìn thôi.`,
    (c) => `Coin của ${c.me} đỏ lòm, đang chờ về bờ.`,
    (c) => `Tháng này đi bốn đám cưới, ví ${c.me} khóc thét.`,
    (c) => `Tiền điện tháng này gấp đôi, tại máy lạnh chạy suốt.`,
    (c) => `${c.Me} chia lương thành sáu hũ, hũ nào cũng rỗng.`,
    (c) => `Nghe nói thưởng Tết năm nay "tùy tình hình", ${c.me} hiểu rồi.`,
  ],
  tinh_cam: [
    (c) => `Crush seen tin nhắn từ hôm qua tới giờ chưa rep.`,
    (c) => `Mẹ ${c.me} sắp xếp đi xem mắt cuối tuần, người ta làm ngân hàng.`,
    (c) => `Tháng này ${c.me} đi đám cưới bạn thân, đi một mình.`,
    (c) => `Người yêu giận vì ${c.me} trả lời tin nhắn chậm năm phút.`,
    (c) => `Bạn thân ${c.me} cưới tháng sau, giờ ${c.me} là người duy nhất còn ế.`,
  ],
  cong_nghe: [
    (c) => `Điện thoại ${c.me} mới mua hai năm mà pin như đồ cổ.`,
    (c) => `AI bây giờ viết email còn hay hơn ${c.me}.`,
    (c) => `Đồng hồ thông minh cứ nhắc ${c.me} đứng dậy đi lại, nhắc cả ngày.`,
    (c) => `Laptop công ty mở hai tab là quạt kêu như máy bay.`,
    (c) => `Hôm qua ${c.me} suýt dính tin nhắn lừa đảo giả ngân hàng, hú hồn.`,
  ],
  an_uong: [
    (c) => `Quán ${c.anyFood} đầu hẻm tăng giá mà vẫn đông nghẹt.`,
    (c) => `${c.Me} đang ăn kiêng, mà chỉ kiêng... buổi sáng.`,
    (c) => `Chiều qua ${c.me} uống trà sữa size L, tối mất ngủ luôn.`,
    (c) => `Ăn mì cay cấp 7 xong ${c.me} khóc như mất người yêu.`,
    (c) => `Tối qua ${c.me} đặt lẩu Thái về nhà, ăn tới giờ vẫn còn cay.`,
  ],
};
const CAT_JOKE: Record<TopicCategory, Tpl[]> = {
  doi_song: [(c) => `Chắc ${c.me} dọn lên văn phòng ở luôn cho tiện.`, (c) => `Lương thì không tăng, chỉ có tiền trọ là tăng đều.`],
  cong_viec_dev: [(c) => `Code chạy được thì đừng hỏi tại sao.`, (c) => `Không có bug, chỉ có tính năng chưa kịp viết tài liệu.`],
  cong_viec_sales: [(c) => `Không chốt được khách thì chốt đơn trà sữa vậy.`, (c) => `Chốt được deal này là ${c.me} khao cả phòng... trà đá.`],
  van_phong: [(c) => `Văn phòng mình thiếu mỗi cái giường thôi.`, (c) => `Ghế này ngồi một năm chắc ${c.me} thành con tôm.`],
  drama: [(c) => `Văn phòng mình drama còn hơn phim Hàn.`, (c) => `Chuyện gì tới tai ${c.hrRef} là cả công ty biết.`],
  giai_tri: [(c) => `Coi phim thì không buồn ngủ, mở code ra là ngáp liền.`, (c) => `Nếu KPI tính bằng số tập phim thì ${c.me} đứng nhất.`],
  tien_bac: [(c) => `Giàu thì chưa thấy đâu, chỉ thấy nghèo bền vững.`, (c) => `Chắc phải nhờ sếp "cuối năm tính" sớm hơn.`],
  tinh_cam: [(c) => `Yêu đương gì tầm này, deadline còn chưa yêu nổi.`, (c) => `Crush không rep thì mình rep khách vậy.`],
  cong_nghe: [(c) => `Công nghệ tiến bộ mà wifi văn phòng vẫn y chang.`, (c) => `Mong có ngày AI đi họp thay mình.`],
  an_uong: [(c) => `Ăn no rồi mới có sức chạy deadline.`, (c) => `Ăn kiêng từ thứ Hai, mà thứ Hai nào cũng dời.`],
};
const GEN_REACT: Tpl[] = [
  (c) => `Thiệt luôn hả? ${c.Me} mới nghe lần đầu.`,
  (c) => `Trời, nhắc chi cho buồn vậy ${c.you}.`,
  (c) => `Nghe rồi, mà ${c.me} thấy chắc gì đã vậy.`,
  (c) => `Thôi đừng nhắc, ${c.me} đang cố quên đây.`,
  (c) => `Chuyện đó ai mà không biết, ${c.you} lạc hậu quá.`,
  (c) => `Ủa vậy hả, kể ${c.me} nghe kỹ coi.`,
];
const ACKS: Tpl[] = [
  (c) => `${c.da || 'Ừ ha, '}${c.you} nói cũng đúng.`,
  (c) => `Chuẩn luôn, ${c.me} cũng nghĩ vậy.`,
  (c) => `Trời ơi, nghe mà mệt dùm.`,
  (c) => `Thôi kệ đi, chuyện gì tới sẽ tới.`,
  (c) => `Nói vậy chứ ${c.me} cũng lo lắm.`,
  (c) => `Haha, ${c.you} lầy quá trời.`,
  (c) => `Vậy mới nói, đời không như mơ.`,
  (c) => `Công nhận, nghe xong tỉnh cả ngủ.`,
  (c) => `Nghe xong muốn xin nghỉ phép luôn.`,
  (c) => `Ủa thiệt hả, vậy mà giờ ${c.me} mới biết.`,
  (c) => `Chuyện này phải kể cả nhóm nghe mới được.`,
];
const ROLE_GRIPES: Record<RoleKey, Tpl[]> = {
  boss: [(c) => `Anh vừa nói chuyện với đối tác, họ khen công ty mình lắm.`,
    (c) => `Tháng này doanh thu mà đạt là anh tính chuyện thưởng.`,
    (c) => `Năm nay công ty mình phải bứt phá, như cú putt lỗ 18 vậy.`],
  hr: [(c) => `${c.Me} đang lọc CV, ai cũng ghi "chịu được áp lực cao".`,
    (c) => `Bảng chấm công tháng này trống nhiều chỗ ghê.`,
    (c) => `Tuần này ${c.me} phải phỏng vấn ba người, mệt ghê.`],
  techlead: [(c) => `Sáng giờ ${c.me} review năm cái PR, cái nào cũng có biến tên "data2".`,
    (c) => `Production mà yên được một tuần là ${c.me} mừng lắm rồi.`,
    (c) => `Haizz, sales lại hứa thêm tính năng mới rồi đó.`],
  senior: [(c) => `Task này ${c.me} làm hai tiếng là xong, để chiều làm cho có cảm hứng.`,
    (c) => `Hôm qua ${c.me} fix một bug, đẻ ra hai bug mới.`,
    (c) => `Coin hôm nay đỏ quá, ${c.me} đang gồng lỗ.`],
  junior: [(c) => `${c.Me} hỏi AI mười lần, nó trả lời mười kiểu luôn.`,
    (c) => `Sáng giờ ${c.me} bị merge conflict ba lần rồi.`,
    (c) => `Code của ${c.me} chạy được mà ${c.me} cũng không hiểu tại sao.`],
  qa: [(c) => `Sáng giờ ${c.me} log được bảy con bug, kỷ lục tuần này.`,
    (c) => `Bug ${c.me} báo từ thứ Hai mà tới giờ vẫn "đang xem".`,
    (c) => `Ai nói app không có bug là chưa gặp ${c.me}.`],
  designer: [(c) => `Khách đòi logo to hơn mà vẫn phải tinh tế, ${c.me} chịu.`,
    (c) => `Dev đổi màu nút của ${c.me} từ cam sang... một màu cam khác.`,
    (c) => `Màn hình thanh toán ${c.me} làm lại lần thứ tư rồi đó.`],
  saleslead: [(c) => `Khách ${c.client} hối dữ lắm, ${c.me} hứa tuần sau có liền.`,
    (c) => `Tháng này chốt thêm hai hợp đồng là team sales vượt chỉ tiêu.`,
    (c) => `Khách VIP mà, phải chiều chứ.`],
  salesnew: [(c) => `${c.Me} gọi khách cả sáng mà toàn thuê bao.`,
    (c) => `Khách hỏi giá xong seen luôn, buồn ghê.`,
    (c) => `Doanh số tháng này của ${c.me}... thôi đừng hỏi.`],
  marketing: [(c) => `Clip hôm qua mới được 300 view, chắc tại thuật toán.`,
    (c) => `${c.Me} đang chạy quảng cáo mà ngân sách hết rồi.`,
    (c) => `Trend tuần này phải quay liền, để qua tuần là hết hot.`],
};
const CLOSE_OFFICE: Tpl[] = [
  mix([(c) => `Thôi chết,`, (c) => `Ủa,`, (c) => `Ê,`, (c) => null],
    [(c) => `${c.time} rồi, ${c.me} còn ${c.taskS} chưa xong.`, (c) => `${c.me} quên mất ${c.taskS}, về chỗ đây.`]),
  (c) => (c.bossHere ? `Thôi ${c.me} vô làm đây, còn ${c.taskS} nữa.` : `Thôi ${c.me} vô làm đây, ${c.bossAway ? 'lỡ sếp về bất tử' : 'sếp đang đi tuần đó'}.`),
  (c) => `Rồi rồi, về chỗ thôi, ${c.me} còn ${c.taskS} nữa.`,
  (c) => `Mai tám tiếp nha, giờ chạy deadline đã.`,
  (c) => (c.bossHere || (c.s.role === 'hr' && c.bossAway) ? null : `Nói nhỏ thôi, ${c.s.role === 'hr' ? 'sếp' : c.watcher} đi ngang kìa.`),
  (c) => `Thôi đi ${c.you}, đứng đây nữa là ${c.me} ngủ luôn.`,
  (c) => `Ok, ${c.me} về chỗ đây, có gì nhắn nhóm nha.`,
  (c) => `Rồi, hết giờ giải lao, ai về chỗ nấy.`,
  (c) => `${c.Me} về trước nha, lát gặp lại ở nhóm chat.`,
];

/** Một nhịp tám theo chủ đề: mở → phản ứng → (chi tiết) → (chọc cười) */
/** nhóm chủ đề chỉ dùng câu mở riêng (câu mở chung nghe gượng) */
const SPECIFIC_CATS: TopicCategory[] = ['an_uong', 'giai_tri', 'drama', 'doi_song', 'tinh_cam', 'cong_nghe', 'tien_bac'];
function topicBeat(b: B, A: P, Bp: P, depth: number): void {
  const cat = b.sc.topicCat;
  const opens = !cat ? TOPIC_OPEN : SPECIFIC_CATS.includes(cat) ? CAT_OPEN[cat] : [...TOPIC_OPEN, ...CAT_OPEN[cat], ...CAT_OPEN[cat]];
  const reacts = !cat ? GEN_REACT : SPECIFIC_CATS.includes(cat) ? CAT_REACT[cat] : [...CAT_REACT[cat], ...GEN_REACT.slice(0, 3)];
  b.say(A, Bp, opens, { em: E.think, pe: 0.2 });
  b.say(Bp, A, reacts, { em: [...E.shock, ...E.fun], pe: 0.35 });
  if (depth >= 3) b.say(chance(0.7) ? A : Bp, null, cat ? CAT_DETAIL[cat] : ROLE_GRIPES[A.role], { opt: true, em: E.sad, pe: 0.25 });
  if (depth >= 4) b.say(b.next(), null, cat ? CAT_JOKE[cat] : ACKS, { opt: true, em: E.fun, pe: 0.4 });
}
/** tên dùng trong tóm tắt / ký ức: sếp thì thêm chữ "sếp" */
const called = (p: P): string => (p.role === 'boss' ? `sếp ${p.name}` : p.name);
const joinNames = (ps: P[]): string =>
  ps.length <= 1 ? (ps[0]?.name ?? '') : `${ps.slice(0, -1).map((p) => p.name).join(', ')} và ${ps[ps.length - 1].name}`;
const othersOf = (sc: SC, p: P): P[] => sc.cast.filter((q) => q.id !== p.id);
function pairsOf(ps: P[]): [P, P][] {
  const out: [P, P][] = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) out.push([ps[i], ps[j]]);
  return out;
}
/** Thay đổi quan hệ cả hai chiều */
function bond(fx: FX, p: P, q: P, lo: number, hi: number, reason: string): void {
  fx.relAdd(p, q, ri(lo, hi), reason); fx.relAdd(q, p, ri(lo, hi), reason);
}

// =====================================================================
//  10. Các loại cảnh
// =====================================================================
// ---------------------------------------------------------------- pantry_chat
const LOC_NAME: Record<Loc, string> = {
  coffee: 'máy pha cà phê', water: 'máy nước', snack: 'tủ lạnh pantry', lounge: 'góc chill', window: 'cửa sổ',
  kpi: 'bảng KPI', table: 'bàn ăn pantry', pantry: 'pantry',
};
const PANTRY_OPEN: Record<Loc, Tpl[]> = {
  coffee: [
    (c) => `${c.Yn} cũng ra pha cà phê hả? Ly thứ mấy rồi?`,
    (c) => `Máy pha cà phê lại kêu rè rè rồi kìa ${c.you}.`,
    (c) => `Mới ${c.time} mà ${c.me} hết pin rồi, phải làm ly cà phê mới sống nổi.`,
    (c) => `Cho ${c.me} chen ké máy pha chút, ${c.me} sắp gục rồi.`,
    (c) => `${c.Yn} uống đen hay sữa? ${c.Me} pha luôn cho.`,
    (c) => `Ly này là ly thứ ba của ${c.me} đó, tim đập theo nhịp deadline luôn.`,
  ],
  water: [
    (c) => `${c.Yn} ra lấy nước hay ra trốn việc vậy?`,
    (c) => `Uống nước đi ${c.you}, ngồi máy lạnh cả ngày khô người lắm.`,
    (c) => `Bình nước sắp hết rồi, ai thay giùm đi, ${c.me} thay hoài.`,
    (c) => `Ra đây đứng chút cho giãn lưng, ngồi nãy giờ tê hết chân.`,
  ],
  snack: [
    (c) => `Ủa ai ăn hộp ${c.snack} của ${c.me} trong tủ lạnh rồi?`,
    (c) => `${c.Yn} ăn ${c.snack} hông, ${c.me} mới mua nè.`,
    (c) => `Kệ snack trống trơn, chắc có người stress dữ lắm.`,
    (c) => `Đói quá, ${c.me} ra kiếm gì nhai cho tỉnh.`,
  ],
  lounge: [
    (c) => `${c.Yn} cũng ra đây nằm hả? Sofa này êm quá trời.`,
    (c) => `Ngồi đây năm phút thôi, ${c.me} thề đó.`,
    (c) => `Góc chill mà có thêm cái mền là ${c.me} ngủ tới chiều.`,
  ],
  window: [
    (c) => `Ra đây hóng gió chút ${c.you}, trong kia ngột ngạt quá.`,
    (c) => `Nhìn xuống đường kẹt xe mà thấy mình còn may.`,
    (c) => `Trời đẹp vầy mà ngồi văn phòng, uổng ghê ${c.you}.`,
  ],
  kpi: [
    (c) => `Nhìn bảng KPI mà muốn xỉu luôn ${c.you} ơi.`,
    (c) => `Thanh KPI của ${c.me} đỏ lè, ${c.you} thấy hông?`,
    (c) => `Ai mà KPI xanh dữ vậy trời, chắc không ngủ.`,
  ],
  table: [
    (c) => `Ngồi đây chút ${c.you}, đứng nãy giờ mỏi chân quá.`,
    (c) => `Bàn ăn sạch bóng ghê, ai dọn vậy ta?`,
  ],
  pantry: [
    (c) => `Ủa ${c.yn}, nay rảnh ra đây chơi hả?`,
    (c) => `${c.Yn} ơi, đứng đây chút cho đỡ mỏi lưng.`,
    (c) => `${c.Yn} ăn uống gì chưa mà mặt mệt vậy?`,
    (c) => (c.weekday === 'Thứ Sáu' ? `Thứ Sáu rồi, tối nay ${c.you} đi đâu chơi hông?`
      : `Mới ${lowerFirst(c.weekday)} mà ${c.me} thấy mệt như cuối tuần rồi.`),
  ],
};
const PANTRY_REPLY: Tpl[] = [
  (c) => `${c.da}${c.me} ra đây cho tỉnh, chứ ngồi trong đó gục mất.`,
  (c) => `Thì ${c.me} trốn xíu thôi, ${c.you} đừng méc ai nha.`,
  (c) => `${c.da || 'Ờ, '}${c.me} vừa xong ${c.taskS}, thưởng cho mình năm phút.`,
  (c) => `Không ra đây chắc ${c.me} điên mất.`,
  (c) => `Mệt muốn xỉu, sáng giờ ${c.me} chưa ngồi yên được phút nào.`,
  (c) => (c.bossHere ? null : `Sếp ${c.bossAway ? 'đi vắng' : 'đang trong phòng'}, ${c.me} tranh thủ chút thôi.`),
  (c) => (c.sc.loc === 'coffee' ? `Ly thứ hai rồi ${c.you} ơi, mà mắt vẫn díp lại.` : null),
  (c) => `${c.da || 'Ừ, '}${c.me} mới họp xong, đầu muốn bốc khói.`,
  (c) => `${c.Me} ra đây trốn cái deadline chút xíu thôi.`,
  (c) => `${c.da || 'Ờ, '}ngồi lâu quá lưng ${c.me} kêu răng rắc rồi.`,
];
const JAB: Tpl[] = [
  (c) => (c.s.role === 'qa' && isDev(c.l) ? `${c.Yn} thong thả ghê, ticket số ${c.ticket} còn mở kìa 🙂` : null),
  (c) => (c.s.role === 'qa' && isDev(c.l) ? `${c.You} nghỉ từ từ thôi, bug thì không có từ từ đâu nha.` : null),
  (c) => (isDev(c.s) && c.l.role === 'qa' ? `Ra đây cũng gặp ${c.you}, đừng nói ${c.you} theo dõi ${c.me} để báo bug nha.` : null),
  (c) => (isDev(c.s) && c.l.role === 'qa' ? `Hôm nay ${c.you} hiền ghê, chưa báo bug nào cho ${c.me}.` : null),
  (c) => (c.s.role === 'techlead' && isSales(c.l) ? `Hôm nay ${c.you} lại hứa thêm tính năng nào với khách nữa đây?` : null),
  (c) => (isSales(c.s) && c.l.role === 'techlead' ? `Gặp ${c.you} đúng lúc, khách ${c.client} hỏi thăm ${c.you} hoài đó.` : null),
  (c) => (c.s.role === 'designer' && isDev(c.l) ? `Cái nút ${c.you} làm lệch 2px đó, ${c.me} thấy hết nha.` : null),
  (c) => (isDev(c.s) && c.l.role === 'designer' ? `Mấy cái animation ${c.you} vẽ, ${c.me} code tới mùa sau chưa xong.` : null),
  (c) => (c.sc.type === 'lunch' ? null : `Ủa ${c.you} cũng biết ra đây nghỉ hả, tưởng bận lắm.`),
  (c) => `Hôm nay ${c.you} hiền ghê, chưa kiếm chuyện với ${c.me}.`,
  (c) => (c.sc.type === 'lunch' && (c.s.role === 'hr' || c.s.role === 'boss') && (c.l.a?.arriveAt ?? 0) > 510
    ? `Ăn trưa thì đúng giờ ghê ha, sao đi làm không đúng giờ vậy ${c.you}?` : null),
  (c) => (c.sc.type === 'lunch' ? `${c.You} ăn ít thôi, chiều còn chạy deadline đó.` : null),
];
const RETORT: Tpl[] = [
  (c) => `Thôi đi, ${c.me} ra đây năm phút mà ${c.you} cũng soi.`,
  (c) => `${c.You} lo phần ${c.you} đi, phần ${c.me} để ${c.me} lo.`,
  (c) => `Nói vậy là ${c.me} buồn đó nha.`,
  (c) => `${c.da || 'Ờ, '}${c.you} giỏi thì ${c.you} làm đi.`,
  (c) => `Haizz, sáng giờ mới được yên có chút.`,
];
const TEASE: Tpl[] = [
  (c) => `Trưa nay đi ăn chung hông, ${c.me} bao trà sữa.`,
  (c) => `Có ${c.you} ra đây là ${c.me} hết buồn ngủ liền.`,
  (c) => `Tối nay đi ${pick(['ăn ốc', 'coi phim', 'cà phê'])} hông ${c.you}?`,
  (c) => (c.s.role === 'junior' && isDev(c.l) ? `${c.Yn} ơi, chỉ ${c.me} cái mẹo hôm qua đi, ${c.me} thề không hỏi nữa.` : null),
  (c) => `Nhìn ${c.you} hôm nay tươi ghê, có chuyện gì vui kể nghe coi.`,
];
const TEASE_BACK: Tpl[] = [
  (c) => `Chốt luôn, ${c.you} hứa rồi đó nha!`,
  (c) => `Nghe ${c.you} nói ${c.me} vui cả ngày.`,
  (c) => `Bữa nay chắc trời mưa, ${c.you} tự nhiên dễ thương dữ.`,
];
const THIRD_CHIME: Tpl[] = [
  (c) => `Cho ${c.me} hóng với, nãy giờ nghe loáng thoáng.`,
  (c) => `Nói gì mà vui vậy, kể ${c.me} nghe với.`,
  (c) => `Ủa, ${c.me} cũng đang định hỏi chuyện này nè.`,
  (c) => `Ủa ${c.me} vừa tới là đổi chủ đề hả?`,
];
const CLOSE_COFFEE: Tpl[] = [
  (c) => `Uống xong ly này là ${c.me} cày tới chiều luôn.`,
  (c) => `Cà phê xong rồi, giờ ${c.me} quay lại ${c.taskS} đây.`,
];
/** Khịa hoặc chọc ghẹo theo quan hệ. Trả về true nếu có khịa (để tính hiệu ứng) */
function relationBeat(b: B, A: P, Bp: P): boolean {
  const ab = relScore(A, Bp), ba = relScore(Bp, A);
  if (Math.min(ab, ba) <= -15 && chance(0.85)) {
    const [j, t] = ab <= ba ? [A, Bp] : [Bp, A];
    b.say(j, t, JAB, { em: E.sly, pe: 0.4 });
    b.say(t, j, RETORT, { em: E.annoy, pe: 0.5 });
    return true;
  }
  if (Math.max(ab, ba) >= 25 && chance(0.6)) {
    const [j, t] = ab >= ba ? [A, Bp] : [Bp, A];
    const d = b.say(j, t, TEASE, { em: E.happy, opt: true });
    b.say(t, j, TEASE_BACK, { em: E.fun, opt: true, dep: d });
  }
  return false;
}

function bPantry(b: B, sc: SC, fx: FX): string {
  const [A, Bp, C3] = sc.cast;
  const where = LOC_NAME[sc.loc];
  b.say(A, Bp, sc.loc === 'pantry' ? PANTRY_OPEN.pantry : [...PANTRY_OPEN[sc.loc], ...PANTRY_OPEN.pantry.slice(0, 2)],
    { em: sc.loc === 'coffee' || sc.loc === 'kpi' ? E.tired : E.smile, pe: 0.25 });
  if (!Bp) {
    b.say(A, A, sc.topicCat ? CAT_DETAIL[sc.topicCat] : ROLE_GRIPES[A.role]);
    b.say(A, A, CLOSE_OFFICE);
    return `${A.name} đứng một mình ở ${where} lẩm bẩm chuyện ${sc.topic}.`;
  }
  b.say(Bp, A, PANTRY_REPLY, { em: E.fun, pe: 0.25 });
  const fight = relationBeat(b, A, Bp);
  const lastSp = b.last()?.sp;
  const teller = chance(0.75) ? (lastSp?.id === A.id ? Bp : A) : pick([A, Bp]);
  topicBeat(b, teller, teller === A ? Bp : A, C3 ? 3 : 4);
  if (C3) {
    const grp = ++grpSeq;
    b.say(C3, null, THIRD_CHIME, { em: E.sly, pe: 0.3, grp, opt: true });
    b.say(b.next(C3), C3, sc.topicCat ? CAT_JOKE[sc.topicCat] : ACKS, { opt: true, em: E.fun, grp });
  }
  b.say(b.next(), null, sc.loc === 'coffee' ? [...CLOSE_OFFICE, ...CLOSE_COFFEE] : CLOSE_OFFICE, { em: E.ok, pe: 0.2 });
  for (const [p, q] of pairsOf(sc.cast)) {
    const isFight = fight && [p.id, q.id].includes(A.id) && [p.id, q.id].includes(Bp.id);
    if (isFight) bond(fx, p, q, -4, -2, 'bị khịa ở pantry'); else bond(fx, p, q, 1, 3, 'tám chuyện vui');
  }
  for (const p of sc.cast) {
    fx.moodAdd(p, fight ? ri(-3, 1) : ri(2, 5));
    fx.memo(p, `Tám chuyện ${sc.topic} với ${joinNames(othersOf(sc, p))} ở ${where}`);
  }
  const names = joinNames(sc.cast);
  return pick([
    `${names} tám chuyện ${sc.topic} ở ${where}.`,
    `Ở ${where}, ${names} than vụ ${sc.topic}.`,
    fight ? `${A.name} và ${Bp.name} khịa nhau ở ${where} rồi lan sang chuyện ${sc.topic}.` : `${names} đứng ${where} bàn tán chuyện ${sc.topic}.`,
  ]);
}

// ---------------------------------------------------------------- desk_visit
type Motive = 'bug' | 'promise' | 'pixel' | 'pixel_dev' | 'ask' | 'review' | 'banner' | 'sale' | 'tiktok' | 'mkt_sales'
  | 'hr_survey' | 'hr_checkin' | 'hr_spy' | 'tips' | 'game' | 'charger' | 'feature' | 'borrow' | 'milktea' | 'chat';

function pickMotive(sc: SC, A: P, Bp: P): Motive {
  const late = (Bp.a?.arriveAt ?? 0) > 510;
  if (has(sc, 'trà sữa')) return 'milktea';
  if (has(sc, 'sạc')) return 'charger';
  if (has(sc, 'mượn')) return 'borrow';
  if (A.role === 'marketing' && has(sc, 'banner')) return 'banner';
  if (A.role === 'marketing' && has(sc, 'tiktok', 'quay clip', 'quay video')) return 'tiktok';
  if (A.role === 'marketing' && has(sc, 'săn sale', 'mã giảm', 'freeship')) return 'sale';
  if (A.role === 'hr' && has(sc, 'khảo sát')) return 'hr_survey';
  if (A.role === 'hr' && has(sc, 'chấm công', 'đi trễ')) return 'hr_checkin';
  if (A.role === 'hr' && has(sc, 'dò la', 'tin tức', 'hóng')) return 'hr_spy';
  if (isDev(A) && Bp.role === 'qa' && has(sc, 'feature', 'không phải bug')) return 'feature';
  if (A.role === 'qa' && TECH_ROLES.includes(Bp.role) && has(sc, 'bug', 'lỗi', 'khịa')) return 'bug';
  if (A.role === 'saleslead' && has(sc, 'hứa', 'deadline gấp', 'tính năng')) return 'promise';
  if (A.role === 'techlead' && has(sc, 'review', 'hối deadline', 'deadline')) return 'review';
  if (A.role === 'junior' && has(sc, 'hỏi bài', 'nhờ fix', 'hỏi', 'nhờ')) return 'ask';
  if (has(sc, 'leo rank', 'chơi game', 'rủ game')) return 'game';
  if (A.role === 'salesnew' && has(sc, 'bí kíp')) return 'tips';
  if (has(sc, 'pixel', 'vibe', '2px')) return A.role === 'designer' ? 'pixel' : 'pixel_dev';
  if (A.role === 'qa' && TECH_ROLES.includes(Bp.role) && Bp.role !== 'qa') return Bp.role === 'designer' ? 'chat' : 'bug';
  if (A.role === 'saleslead' && (Bp.role === 'techlead' || Bp.role === 'senior')) return 'promise';
  if (A.role === 'designer' && isDev(Bp)) return 'pixel';
  if ((A.role === 'senior' || A.role === 'junior') && Bp.role === 'designer') return 'pixel_dev';
  if (A.role === 'junior' && (Bp.role === 'senior' || Bp.role === 'techlead')) return 'ask';
  if (A.role === 'techlead' && (Bp.role === 'junior' || Bp.role === 'senior')) return 'review';
  if (A.role === 'senior' && Bp.role === 'qa') return 'feature';
  if (A.role === 'marketing') {
    if (Bp.role === 'designer') return pick(['banner', 'banner', 'sale', 'tiktok']);
    if (Bp.role === 'saleslead') return pick(['mkt_sales', 'tiktok', 'sale']);
    return pick(['sale', 'tiktok', 'sale', 'milktea']);
  }
  if (A.role === 'hr') return late && chance(0.6) ? 'hr_checkin' : pick(['hr_survey', 'hr_spy', 'hr_checkin']);
  if (A.role === 'salesnew') {
    if (Bp.role === 'saleslead') return 'tips';
    if (Bp.role === 'junior') return pick(['game', 'game', 'charger']);
    return pick(['charger', 'borrow', 'milktea']);
  }
  return pick(['borrow', 'milktea', 'chat', 'chat']);
}

// --- bug (QA → dev): mở → chối (kèm phản bác khớp) → nhượng bộ → chốt
const BUG_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, lại bug nữa nè 🙂 Lỗi ${c.bug}.`,
  (c) => `${c.Yn} rảnh hông? ${c.Me} có món quà nhỏ: lỗi ${c.bug}.`,
  (c) => `Ticket số ${c.ticket} của ${c.you} nè: lỗi ${c.bug}.`,
  (c) => `${c.Yn}, khách vừa báo lỗi ${c.bug}, ${c.me} tái hiện được luôn rồi.`,
  (c) => `Chào ${c.you}, ${c.me} tới giao hàng: một con bug size L, lỗi ${c.bug}.`,
];
const BUG_DENY: Pair[] = [
  [(c) => `Máy ${c.me} chạy được mà.`, [
    (c) => `Khách không có xài máy của ${c.you} đâu nha.`,
    (c) => `${c.Me} test trên ba máy, máy nào cũng lỗi, trừ máy ${c.you} 🙂`]],
  [(c) => `${c.da}${c.me} test rồi mà, chắc tại dữ liệu của ${c.you} đó.`, [
    (c) => `Dữ liệu thật của khách đó ${c.you}, không phải dữ liệu test đâu.`,
    (c) => `${c.Me} quay video rồi nè, bấm đúng ba lần là ra.`]],
  [(c) => `${c.You} xóa cache chưa? Nhiều khi tại trình duyệt thôi.`, [
    (c) => `Xóa rồi, đổi trình duyệt rồi, khởi động lại máy rồi, vẫn lỗi.`,
    (c) => `${c.Me} xóa cache ba lần rồi đó ${c.you} 🙂`]],
  [(c) => `Cái đó là tính năng đó ${c.you}, không phải bug.`, [
    (c) => `Tính năng gì mà lỗi ${c.bug} vậy ${c.you}?`,
    (c) => `Vậy ${c.me} ghi vô tài liệu hướng dẫn là tính năng nha 🙂`]],
  [(c) => `Hôm qua còn chạy ngon mà, ai đụng vô code của ${c.me} vậy?`, [
    (c) => `Lịch sử commit ghi tên ${c.you} đó 🙂`,
    (c) => `Không ai đụng hết, chỉ có ${c.you} thôi.`]],
  [(c) => `Sao bug nào cũng ra tên ${c.me} vậy trời?`, [
    (c) => `Tại code của ${c.you} chứ sao 🙂`,
    (c) => `Có đủ bước tái hiện, ảnh chụp màn hình, cả giờ phút luôn đó ${c.you}.`]],
];
const BUG_CONCEDE: Tpl[] = [
  (c) => `Rồi rồi, để ${c.me} coi, mà cho ${c.me} uống ly cà phê đã.`,
  (c) => `Ok, ${c.me} sửa liền... sau khi xong cái này.`,
  (c) => `Haizz, đưa ticket đây ${c.me} xem.`,
  (c) => `${c.da}${c.me} sửa liền, ${c.you} đừng báo ${c.tlRef} nha.`,
  (c) => `Ok ok, chiều nay ${c.me} xem, đừng nhìn ${c.me} kiểu đó.`,
  (c) => `Để ${c.me} ghi lại, xong việc này là sửa liền.`,
];
const BUG_CLOSE: Tpl[] = [
  (c) => `Chiều nay ${c.me} test lại nha, không xong là ${c.me} ghi tên ${c.you} vô báo cáo 🙂`,
  (c) => `Cảm ơn ${c.you} trước nha, ${c.me} biết ${c.you} giỏi mà.`,
  (c) => `Nhớ nha, lần thứ ba ${c.me} báo bug này rồi đó.`,
  (c) => `${c.Me} canh đồng hồ đó nha ${c.you}.`,
  (c) => `${c.Me} gửi lại ticket số ${c.ticket} rồi đó, nhớ đóng khi xong nha.`,
];
const BUG_FLIRT: Pair[] = [
  [(c) => `Ngày nào ${c.you} cũng tới bàn ${c.me}, ${c.me} nghi ${c.you} thích ${c.me} rồi đó.`, [
    (c) => `Mơ đi ${c.you}, ${c.me} chỉ thích bug của ${c.you} thôi 🙂`,
    (c) => `Thích thì ${c.me} đã không báo bug công khai rồi 🙂`]],
  [(c) => `Báo bug gì mà ngày ba lần, ${c.you} nhớ ${c.me} thì nói thẳng đi.`, [
    (c) => `Nhớ cái gì, ${c.me} nhớ deadline thôi 🙂`,
    (c) => `Sửa bug đi rồi hẵng mơ nha ${c.you} 🙂`]],
];
function dvBug(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, BUG_OPEN, { em: E.smile, pe: 0.5 });
  b.pair(Bp, A, BUG_DENY, { em: [...E.annoy, ...E.think], pe: 0.4 }, { em: E.smile, pe: 0.35 });
  b.say(Bp, A, BUG_CONCEDE, { em: E.tired, pe: 0.3 });
  const spark = A.gender !== Bp.gender && Math.abs(A.age - Bp.age) <= 6
    && Math.min(relScore(A, Bp), relScore(Bp, A)) <= -10 && chance(0.4);
  if (spark) b.pair(Bp, A, BUG_FLIRT, { em: E.sly }, { em: E.smile });
  else b.say(A, Bp, BUG_CLOSE, { em: E.smile, pe: 0.4 });
  fx.relAdd(Bp, A, -ri(2, 4), 'bị báo bug tận bàn');
  fx.relAdd(A, Bp, spark ? 2 : chance(0.5) ? -1 : 1, spark ? 'bị chọc mà hơi vui' : 'lại cãi "máy chạy được"');
  fx.moodAdd(A, ri(2, 4)); fx.moodAdd(Bp, -ri(2, 4)); fx.kpiAdd(Bp, ri(2, 4));
  fx.memo(A, `Báo bug cho ${Bp.name}: lỗi ${sc.bug}`);
  fx.memo(Bp, spark ? `Bị ${A.name} báo bug, chọc lại một câu thấy ${A.name} đỏ mặt` : `Bị ${A.name} báo bug: lỗi ${sc.bug}`);
  return pick([`${A.name} ghé bàn ${Bp.name} báo lỗi ${sc.bug}.`, `${A.name} mang bug tới tận bàn ${Bp.name}, hai bên lại khẩu chiến.`]);
}

// --- promise (sales lead → tech)
const PROMISE_OPEN: Pair[] = [
  [(c) => `${c.Yn} ơi, tin vui nè: khách ${c.client} muốn ký thêm, chỉ cần thêm chút xíu tính năng.`, [
    (c) => `Chút xíu là bao nhiêu? Nói rõ coi.`, (c) => `Tin vui của ${c.you} thường là tin buồn của ${c.me}.`]],
  [(c) => `${c.Yn}, ${c.me} vừa gặp khách ${c.client}, họ mê công ty mình lắm, có điều...`, [
    (c) => `Có điều gì? Nói lẹ đi.`, (c) => `Nghe chữ "có điều" là ${c.me} biết có chuyện rồi.`]],
  [(c) => `${c.Yn} ơi, ${c.me} lỡ hứa với khách là thứ Sáu này có ${c.feature} rồi.`, [
    (c) => `Thứ Sáu? Thứ Sáu năm nào?`, (c) => `Khoan, ai cho ${c.you} hứa vậy?`]],
];
const PROMISE_PITCH: Pair[] = [
  [(c) => `Có chút xíu thôi: thêm ${c.feature}, thứ Sáu demo.`, [
    (c) => `${c.Feature} mà "chút xíu"? Ít nhất hai tuần đó ${c.you}.`,
    (c) => `Chút xíu của ${c.you} là ba đêm không ngủ của ${c.me} đó.`]],
  [(c) => `Chuyện nhỏ mà, ${c.you} làm ${c.feature} chút là xong, ${c.me} bao cà phê cả tuần.`, [
    (c) => `Cà phê cả tuần không đổi được ba đêm thức trắng đâu ${c.you}.`,
    (c) => `Chút là xong? ${c.Feature} đó ${c.you}, đâu phải đổi màu cái nút.`]],
  [(c) => `Khách VIP đó ${c.you}, ký là cả team có thưởng. Chỉ cần thêm ${c.feature}.`, [
    (c) => `Thưởng thì chưa thấy, tăng ca thì thấy liền.`,
    (c) => (c.sceneHas('ai cho') ? `${c.Feature} chưa có trong phạm vi hợp đồng đâu ${c.you}!` : `Ai cho ${c.you} hứa? ${c.Feature} chưa có trong phạm vi hợp đồng!`),
    (c) => `Lần trước ${c.you} cũng nói vậy, team ${c.me} tăng ca cả tuần.`]],
];
const PROMISE_CHARM: Tpl[] = [
  (c) => `Thôi mà, công ty này không ai làm nổi ngoài ${c.you}.`,
  (c) => `Vậy... thứ Hai tuần sau được hông? ${c.Me} nói khách là đang tối ưu.`,
  (c) => `Sếp cũng gật rồi đó ${c.you}, ${c.me} chỉ báo trước thôi.`,
];
const PROMISE_CLOSE: Tpl[] = [
  (c) => `Gửi yêu cầu qua ticket, đừng ghi trên khăn giấy nữa.`,
  (c) => `Ba ly cà phê, và lần sau hỏi ${c.me} trước khi hứa.`,
  (c) => `Được, nhưng trễ thì ${c.you} tự đi giải thích với khách.`,
];
function dvPromise(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.pair(A, Bp, PROMISE_OPEN, { em: E.happy, pe: 0.5 }, { em: E.think, pe: 0.4 });
  b.pair(A, Bp, PROMISE_PITCH, { em: E.cool, pe: 0.3 }, { em: E.annoy, pe: 0.5 });
  b.say(A, Bp, PROMISE_CHARM, { opt: true, em: E.polite });
  b.say(Bp, A, PROMISE_CLOSE, { em: E.tired, pe: 0.3 });
  fx.relAdd(Bp, A, -ri(3, 5), 'lại hứa bừa với khách'); fx.relAdd(A, Bp, ri(-1, 1), 'khó tính quá');
  fx.moodAdd(Bp, -ri(3, 5)); fx.moodAdd(A, ri(1, 3)); fx.kpiAdd(Bp, ri(1, 3));
  fx.memo(A, `Năn nỉ ${Bp.name} làm gấp ${sc.feature} cho khách ${sc.client}`);
  fx.memo(Bp, `Bị ${A.name} giao thêm ${sc.feature} vì lỡ hứa với khách`);
  return pick([`${A.name} lỡ hứa với khách tính năng ${sc.feature}, ghé năn nỉ ${Bp.name} làm gấp.`,
    `${A.name} mang "tin vui" của khách ${sc.client} tới bàn ${Bp.name}, kèm một deadline trời ơi.`]);
}

// --- pixel (designer ↔ dev): mỗi kiểu cãi một mạch riêng
interface Spat { open: Tpl[]; def: Tpl[]; arg: Tpl[]; give: Tpl[] }
const PIXEL_SPATS: Spat[] = [
  { open: [(c) => `${c.Yn} ơi, nút thanh toán lệch 2px kìa.`, (c) => `${c.Yn}, khoảng cách mấy cái nút này không đều nha.`],
    def: [(c) => `2px thì ai mà thấy ${c.you}?`, (c) => `Lệch chút xíu thôi mà ${c.you}.`],
    arg: [(c) => `${c.Me} thấy, khách thấy, cả vũ trụ thấy.`, (c) => `Khoảng cách 16px chứ đâu phải 14px, nhìn ngột ngạt muốn xỉu.`],
    give: [(c) => `Rồi rồi, để ${c.me} chỉnh, mà ${c.you} đứng đây canh luôn hả?`, (c) => `Chỉnh xong cái này ${c.you} hứa không đổi nữa nha.`] },
  { open: [(c) => `${c.Yn}, màu nút này đâu phải màu ${c.me} gửi đâu?`],
    def: [(c) => `Màu y chang mà, ${c.me} nhìn hoài có thấy khác đâu.`],
    arg: [(c) => `Mã màu là #FF7A45, còn ${c.you} để #FF7A44, khác hoàn toàn luôn đó.`],
    give: [(c) => `Rồi, ${c.me} sửa lại đúng mã màu, chịu chưa?`, (c) => `Ok, ${c.me} đổi. Mà ${c.you} kiểm tra lại mắt chưa vậy?`] },
  { open: [(c) => `${c.Yn}, màn hình ${c.screen} ${c.you} làm chưa đủ vibe gì hết trơn.`],
    def: [(c) => `Vibe là cái gì, ${c.me} code đúng file thiết kế mà.`],
    arg: [(c) => `File nào? File bản cũ từ tuần trước đó ${c.you}.`, (c) => `Đúng file mà font chữ nhìn như thực đơn quán nhậu vậy hả?`],
    give: [(c) => `Thôi được, gửi ${c.me} file mới nhất, ${c.me} làm lại.`, (c) => `Rồi, để ${c.me} sửa, nhưng animation xoay 3D thì ${c.me} không làm đâu.`] },
];
const PIXEL_DEV_SPATS: Spat[] = [
  { open: [(c) => `${c.Yn} ơi, design này có animation bay lượn, ${c.me} code sao nổi?`],
    def: [(c) => `Nó phải mượt như lụa thì mới đủ vibe chứ.`],
    arg: [(c) => `Khách xài điện thoại cũ, animation vầy là đứng máy luôn.`],
    give: [(c) => `Thôi được, bỏ animation, nhưng màu là ${c.me} giữ nguyên.`] },
  { open: [(c) => `${c.Yn}, sao màn hình nào cũng có bóng đổ bảy lớp vậy?`],
    def: [(c) => `Bỏ bóng đổ là màn hình mất hồn liền.`],
    arg: [(c) => `Mất hồn còn hơn mất deadline đó ${c.you}.`, (c) => `Hay mình bớt hai lớp bóng, giữ lại năm thôi?`],
    give: [(c) => `Thôi được, bớt một lớp. Một thôi đó.`] },
  { open: [(c) => `${c.Yn} cho ${c.me} xin file thiết kế bản cuối... cuối thiệt nha.`],
    def: [(c) => `Bản cuối là "final_v7_thiệt_sự" đó ${c.you}.`],
    arg: [(c) => `V7 hôm qua hay v7 sáng nay vậy ${c.you}?`],
    give: [(c) => `Sáng nay. Mà chiều chắc có v8.`] },
];
const PIXEL_CLOSE: Tpl[] = [
  (c) => `Ok, chỉnh xong gửi ${c.me} xem, nhớ là phải mượt như lụa.`,
  (c) => `Cảm ơn ${c.you}, giờ mới thấy có chút vibe rồi đó.`,
  (c) => `Chiều ${c.me} bao ${c.you} ly ${c.drink}, coi như huề.`,
];
function dvPixel(b: B, sc: SC, fx: FX, A: P, Bp: P, devFirst: boolean): string {
  const spat = pick(devFirst ? PIXEL_DEV_SPATS : PIXEL_SPATS);
  b.say(A, Bp, spat.open, { em: devFirst ? E.tired : E.think, pe: 0.4 });
  b.say(Bp, A, spat.def, { em: devFirst ? E.sly : E.annoy, pe: 0.4 });
  b.say(A, Bp, spat.arg, { em: E.annoy, pe: 0.3 });
  b.say(Bp, A, spat.give, { em: E.tired, pe: 0.3 });
  if (!devFirst) b.say(A, Bp, PIXEL_CLOSE, { em: E.happy, pe: 0.4 });
  const d = relScore(A, Bp) < 0 ? -2 : 1;
  bond(fx, A, Bp, d - 1, d + 1, 'cãi nhau vì 2px');
  fx.moodAdd(A, ri(-2, 2)); fx.moodAdd(Bp, ri(-3, 1)); fx.kpiAdd(devFirst ? A : Bp, ri(1, 3));
  const designer = devFirst ? Bp : A, dev = devFirst ? A : Bp;
  fx.memo(designer, `Cãi với ${dev.name} vì từng px và "vibe" màn hình`);
  fx.memo(dev, `Bị ${designer.name} bắt chỉnh từng px`);
  return pick([`${A.name} ghé bàn ${Bp.name} cãi nhau vì 2px và "vibe".`, `${designer.name} và ${dev.name} giằng co từng pixel trên màn hình ${sc.screen}.`]);
}

// --- ask (junior → senior/techlead)
const ASK_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, cho ${c.me} hỏi xíu được hông?`,
  (c) => `${c.Yn} ơi, ${c.me} bị ${c.err} từ sáng tới giờ, cứu ${c.me} với.`,
  (c) => `${c.Yn} rảnh hông, ${c.me} hỏi một câu thôi, thề luôn.`,
];
const ASK_WHAT: Pair[] = [
  [(c) => `Lại gì nữa đó ${c.you}?`, [
    (c) => `${c.da}${c.me} bị ${c.err}, tìm trên mạng hoài không ra.`,
    (c) => (c.genz ? `Code ${c.me} chép y chang trên mạng mà không chạy, j z trời.` : `Code ${c.me} làm y chang tài liệu mà không chạy.`)]],
  [(c) => `Hỏi AI chưa?`, [
    (c) => `${c.da}hỏi rồi, nó bảo ${c.me} xóa node_modules, xong lỗi thêm ba cái.`,
    (c) => `${c.da}hỏi rồi, mỗi lần nó trả lời một kiểu${c.a}.`]],
  [(c) => `Một câu thôi nha, câu thứ hai tính phí trà sữa.`, [
    (c) => `${c.da}một câu thôi: sao ${c.me} bị ${c.err} hoài vậy${c.a}?`,
    (c) => `${c.da}trà sữa thì ${c.me} bao, miễn ${c.you} chỉ ${c.me}${c.a}.`]],
];
const ASK_HELP: Tpl[] = [
  (c) => `Đưa đây coi... Thiếu import kìa.`,
  (c) => `${c.You} đọc log chưa? Dòng đầu tiên ghi rõ kìa.`,
  (c) => `Sai biến môi trường thôi, sửa file .env là chạy.`,
  (c) => `Cái này ${c.me} gặp hồi mới đi làm, để ${c.me} chỉ.`,
  (c) => `Coi nè, dòng này ${c.you} gõ sai tên biến.`,
  (c) => `Phiên bản thư viện lệch rồi, cài lại bản cũ là chạy.`,
];
const ASK_THANKS: Tpl[] = [
  (c) => (c.genz ? `J z trời, có vậy thôi hả? ${c.Me} xỉu.` : `Trời, có vậy thôi mà ${c.me} ngồi cả buổi.`),
  (c) => `${c.da}${c.me} hiểu rồi, ${c.you} đỉnh thiệt sự.`,
  (c) => `${c.You} giỏi quá, ${c.me} mà được một nửa là mừng rồi.`,
];
const ASK_CLOSE: Tpl[] = [
  (c) => `Lần sau đọc log trước rồi hỏi nha.`,
  (c) => `Về làm đi, tối nay ${c.me} gửi tài liệu cho mà đọc.`,
  (c) => `Trà sữa nha, size L.`,
  (c) => `Kẹt nữa thì cứ qua, đừng ngồi im tới tối.`,
  (c) => `Ghi chú lại đi, lần sau gặp là tự sửa được.`,
];
function dvAsk(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, ASK_OPEN, { em: E.nervous, pe: 0.5 });
  b.pair(Bp, A, ASK_WHAT, { em: E.tired, pe: 0.3 }, { em: E.sad, pe: 0.3 });
  b.say(Bp, A, ASK_HELP, { em: E.cool, pe: 0.3 });
  b.say(A, Bp, ASK_THANKS, { em: E.happy, pe: 0.5 });
  b.say(Bp, A, ASK_CLOSE, { opt: true, em: E.ok });
  fx.relAdd(A, Bp, ri(3, 5), 'được chỉ cách fix lỗi'); fx.relAdd(Bp, A, ri(0, 2), 'hỏi hoài mà chịu học');
  fx.kpiAdd(A, ri(3, 5)); fx.moodAdd(A, ri(3, 5)); fx.moodAdd(Bp, ri(-1, 2));
  fx.memo(A, `Được ${Bp.name} chỉ cách sửa ${sc.err}`); fx.memo(Bp, `Chỉ ${A.name} sửa ${sc.err}`);
  return pick([`${A.name} chạy qua hỏi ${Bp.name} cách sửa ${sc.err}, được chỉ trong một nốt nhạc.`,
    `${A.name} bí ${sc.err}, ${Bp.name} xem một phát ra liền.`]);
}

// --- review (techlead → dev): hỏi → chống chế → đáp đúng lời chống chế
interface Review { open: Tpl; replies: Pair[] }
const R_RUNS: Pair = [(c) => `Code chạy được mà ${c.you}, đẹp tính sau.`, [(c) => `Chạy được không có nghĩa là đúng. Tách hàm, viết test.`]];
const R_90: Pair = [(c) => `${c.da}xong 90% rồi, còn 10% khó nhất${c.a}.`, [(c) => `90% đó ${c.you} nói từ thứ Hai rồi.`, (c) => `10% còn lại đó là bao lâu?`]];
const REVIEWS: Review[] = [
  { open: (c) => `${c.L}, PR của ${c.you} đó, sao một hàm dài 300 dòng vậy?`, replies: [
    [(c) => `${c.da}${c.me} tính tách hàm mà chưa kịp${c.a}.`, [(c) => `Chưa kịp thì giờ làm. Trước 5 giờ nha.`]], R_RUNS] },
  { open: (c) => `${c.L}, ai đặt tên biến "dataFinalFinal2" vậy?`, replies: [
    [(c) => `${c.da}là ${c.me}${c.a}. Tại "data" với "dataFinal" có rồi.`, [(c) => `Haizz, đặt tên cho đàng hoàng, người sau còn đọc.`]], R_RUNS] },
  { open: (c) => `${c.L}, ${c.taskL} sao ba ngày rồi chưa xong?`, replies: [R_90,
    [(c) => `${c.da}tại yêu cầu đổi hoài, ${c.me} làm lại hai lần rồi.`, [(c) => `Đổi thì báo ${c.me}, đừng âm thầm làm lại.`]]] },
  { open: (c) => `${c.L}, ${c.project} ${c.deadline}, ${c.you} làm tới đâu rồi?`, replies: [R_90,
    [(c) => `${c.da}đang chạy nước rút${c.a}, chiều nay có bản.`, [(c) => `Chiều nay ${c.me} muốn thấy PR, không phải lời hứa.`]]] },
];
const REVIEW_OK: Tpl[] = [
  (c) => `${c.da}${c.me} sửa liền${c.a}.`,
  (c) => `${c.da}chiều nay xong, ${c.me} hứa.`,
  (c) => (c.genz ? `${c.da}dạ, ${c.me} làm liền, khum dám chậm nữa.` : `${c.da}${c.me} hiểu rồi${c.a}.`),
];
const REVIEW_SOFT: Tpl[] = [
  (c) => `Mà phần xử lý lỗi ${c.you} viết cũng tạm được.`,
  (c) => `Kẹt chỗ nào thì hỏi, đừng ngồi im tới tối.`,
  (c) => `Sửa xong ${c.me} review liền, không để qua mai.`,
];
function dvReview(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  const rv = pick(REVIEWS);
  b.say(A, Bp, [rv.open], { em: E.annoy, pe: 0.4 });
  b.pair(Bp, A, rv.replies, { em: E.nervous, pe: 0.4 }, { em: E.tired, pe: 0.3 });
  b.say(Bp, A, REVIEW_OK, { em: E.nervous, pe: 0.3 });
  const soft = chance(0.6);
  if (soft) b.say(A, Bp, REVIEW_SOFT, { opt: true, em: E.ok });
  fx.kpiAdd(Bp, ri(2, 4)); fx.moodAdd(Bp, soft ? ri(0, 2) : -ri(2, 4));
  fx.relAdd(Bp, A, soft ? ri(1, 3) : -ri(1, 2), soft ? 'khó mà vẫn quan tâm' : 'review gắt quá');
  fx.memo(Bp, `Bị ${A.name} review code, để lại cả rổ comment`); fx.memo(A, `Review code của ${Bp.name}, nhắc không push lên main`);
  return pick([`${A.name} ghé bàn ${Bp.name} review code, để lại cả rổ comment.`, `${A.name} hối ${Bp.name} vì ${sc.project} ${sc.deadlineText}.`]);
}

// --- marketing → designer: banner
const BANNER_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, làm giùm ${c.me} cái banner sale cuối tháng nha, chiều nay đăng.`,
  (c) => `${c.Yn}, cần banner BánNhanh POS gấp, ${c.me} nhờ ${c.you} xíu thôi.`,
];
const BANNER_NO: Pair[] = [
  [(c) => `Chiều nay?? ${c.You} nghĩ banner là mì gói hả?`, [
    (c) => `${c.Me} bao ${c.you} ly ${c.drink} nha, năn nỉ đó.`, (c) => `Gấp thiệt mà, khách đòi chiều nay đó.`]],
  [(c) => `Brief đâu? Màu gì, chữ gì, kích thước nhiêu?`, [
    (c) => `Brief là... làm sao cho đẹp, hợp trend, nhìn là muốn mua.`, (c) => `Màu cam cho nổi, chữ to, thêm chữ SALE thiệt bự.`]],
  [(c) => `Lại gấp nữa hả, lần nào cũng gấp.`, [
    (c) => `Lần cuối, ${c.me} hứa đó.`, (c) => `${c.Me} bao ${c.you} ly ${c.drink} nha, năn nỉ đó.`]],
];
const BANNER_OK: Tpl[] = [
  (c) => (c.prevHas('sale thiệt bự') ? `Chữ SALE thiệt bự là hết vibe đó ${c.you}. Để ${c.me} làm theo kiểu của ${c.me}.` : null),
  (c) => (c.prevHas('lần cuối') ? `Câu "lần cuối" ${c.me} nghe lần thứ năm rồi. Thôi được, bốn giờ lấy.` : null),
  (c) => `Thôi được, nhưng ${c.me} làm theo kiểu của ${c.me}.`,
  (c) => `Ok, bốn giờ lấy. Năm giờ là ${c.me} về đó nha.`,
];
const BANNER_CLOSE: Tpl[] = [
  (c) => `Thương ${c.you} nhất, đăng xong ${c.me} tag tên ${c.you} luôn.`,
  (c) => `Cảm ơn ${c.you}! Nhớ thêm chút lấp lánh nha.`,
];
function dvBanner(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, BANNER_OPEN, { em: E.polite, pe: 0.5 });
  b.pair(Bp, A, BANNER_NO, { em: E.annoy, pe: 0.4 }, { em: E.polite, pe: 0.3 });
  b.say(Bp, A, BANNER_OK, { em: E.tired, pe: 0.3 });
  b.say(A, Bp, BANNER_CLOSE, { opt: true, em: E.happy });
  bond(fx, A, Bp, 0, 2, 'nhờ làm banner gấp'); fx.moodAdd(Bp, -ri(1, 3)); fx.moodAdd(A, ri(2, 4));
  fx.memo(A, `Nhờ ${Bp.name} làm banner gấp`); fx.memo(Bp, `Bị ${A.name} nhờ banner gấp lần nữa`);
  return `${A.name} nhờ ${Bp.name} làm banner gấp, năn nỉ đủ kiểu.`;
}

// --- marketing → bất kỳ: săn sale
const SALE_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, tối nay sale lớn đó, săn chung hông?`,
  (c) => `${c.Yn}, ${c.me} có mã freeship nè, gom đơn chung hông?`,
  (c) => `${c.Yn} ơi, ${c.me} mới phát hiện mấy món đồ văn phòng đang giảm mạnh lắm.`,
];
const SALE_REPLY: Tpl[] = [
  (c) => `Lại sale nữa hả, tháng này ${c.me} cháy ví rồi.`,
  (c) => `Có gì ngon, nói ${c.me} nghe coi.`,
  (c) => `${c.You} đừng dụ ${c.me} nữa, giỏ hàng ${c.me} đầy rồi.`,
];
const SALE_PUSH: Tpl[] = [
  (c) => `Mua chung được giảm thêm, không mua là lỗ đó.`,
  (c) => `Toàn đồ cần thiết hết á, ${c.me} lọc kỹ rồi.`,
  (c) => `Mua về xài cho năng suất, sếp còn phải khen.`,
];
const SALE_YES: Tpl[] = [
  (c) => `Thôi được, cho ${c.me} một suất, nhưng đừng nói ai nha.`,
  (c) => `Để lương về rồi tính ${c.you} ơi.`,
  (c) => `${c.You} đúng là chuyên gia làm người khác nghèo.`,
  (c) => `Thôi được, nhưng lần này thôi đó.`,
];
const SALE_CLOSE: Tpl[] = [
  (c) => `Chốt! 12 giờ đêm canh giờ nha.`,
  (c) => `Ok, ${c.me} thêm ${c.you} vô nhóm săn sale.`,
];
function dvSale(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, SALE_OPEN, { em: ['🛒', '🤩'], pe: 0.5 });
  b.say(Bp, A, SALE_REPLY, { em: E.fun, pe: 0.3 });
  if (!sayProduct(b, sc, A, Bp)) b.say(A, Bp, SALE_PUSH, { em: E.sly });
  b.say(Bp, A, SALE_YES, { em: E.fun, pe: 0.3 });
  b.say(A, Bp, SALE_CLOSE, { opt: true, em: E.happy });
  bond(fx, A, Bp, 1, 3, 'rủ săn sale chung'); fx.moodAdd(A, ri(2, 4)); fx.moodAdd(Bp, ri(1, 3));
  fx.memo(A, `Rủ ${Bp.name} săn sale chung`); fx.memo(Bp, `Bị ${A.name} dụ săn sale`);
  return pick([`${A.name} rủ ${Bp.name} săn sale chung.`, `${A.name} ghé bàn ${Bp.name} "tư vấn mua sắm".`]);
}

// --- marketing → bất kỳ: quay TikTok
const TT_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, quay giúp ${c.me} clip trend này 15 giây thôi.`,
  (c) => `${c.Yn}, công ty cần clip TikTok mới, ${c.you} đóng vai chính nha.`,
];
const TT_NO: Pair[] = [
  [(c) => `${c.Me} đang bận... mà trend gì vậy?`, [
    (c) => `Trend "một ngày của dân văn phòng", ${c.you} chỉ cần ngồi gõ phím rồi quay lại cười thôi.`,
    (c) => `Trend giả bộ bị sếp bắt quả tang, rồi hô "chúng ta là một gia đình".`]],
  [(c) => `${c.Me} mà lên clip là công ty mất khách đó.`, [
    (c) => `Không đâu, ${c.you} lên hình là triệu view luôn.`,
    (c) => `Ai nói, clip văn phòng đang hot lắm, ${c.you} là gương mặt vàng đó.`]],
  [(c) => `Có phải nhảy hông? ${c.Me} không nhảy đâu.`, [
    (c) => `Không nhảy đâu, ${c.you} chỉ cần ngồi gõ phím rồi quay lại cười thôi.`]],
];
const TT_YES: Tpl[] = [
  (c) => `Thôi được, một lần thôi nha, quay xấu là xóa.`,
  (c) => `Cho ${c.me} chải đầu cái đã.`,
  (c) => (c.prevHas('triệu view') ? `Triệu view mà không có thưởng là ${c.me} giận đó.` : `Quay xong nhớ chỉnh da cho ${c.me} nha.`),
];
const TT_CLOSE: Tpl[] = [
  (c) => `Ok, ba, hai, một... diễn!`,
  (c) => `Lên xu hướng là ${c.me} bao trà sữa!`,
];
function dvTiktok(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, TT_OPEN, { em: ['🤳', '🎬'], pe: 0.5 });
  b.pair(Bp, A, TT_NO, { em: E.nervous, pe: 0.4 }, { em: E.sly, pe: 0.3 });
  b.say(Bp, A, TT_YES, { em: E.fun, pe: 0.4 });
  b.say(A, Bp, TT_CLOSE, { em: ['🎬', '🤳'], pe: 0.5 });
  bond(fx, A, Bp, 1, 3, 'quay clip chung'); fx.moodAdd(A, ri(2, 5)); fx.moodAdd(Bp, ri(0, 3));
  fx.memo(A, `Lôi ${Bp.name} vào quay clip TikTok`); fx.memo(Bp, `Bị ${A.name} kéo đi đóng clip TikTok`);
  return `${A.name} lôi ${Bp.name} vào quay clip TikTok cho công ty.`;
}

// --- marketing → sales lead: xin câu chuyện khách hàng
const MS_LINES: Tpl[][] = [
  [(c) => `${c.Yn} ơi, cho ${c.me} xin câu chuyện khách xài BánNhanh POS nào hay hay để làm content.`],
  [(c) => `Có ngay! Quán trà sữa chị Tư xài phần mềm mình, doanh thu tăng gấp đôi.`,
    (c) => `Chuyện nhỏ! Tiệm cà phê anh Bảy xài xong, tính tiền nhanh gấp ba.`],
  [(c) => (c.prevHas('gấp ba') ? `Gấp ba thiệt hông đó ${c.you}? Đăng lên là khách hỏi liền.` : `Gấp đôi thiệt hả ${c.you}? ${c.Me} cần số liệu thật nha.`)],
  [(c) => `Thì... gần như vậy. Tầm 30%. Mà viết gấp đôi cho nó kêu.`],
  [(c) => `Thôi ${c.me} viết "tăng trưởng ấn tượng" cho an toàn.`],
  [(c) => `Đó, dân marketing nói chuyện nghe sang hẳn.`],
];
function dvMktSales(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  MS_LINES.forEach((pool, i) => b.say(i % 2 === 0 ? A : Bp, i % 2 === 0 ? Bp : A, pool, { em: i === 3 ? E.sly : E.think, pe: 0.3, opt: i === 5 }));
  bond(fx, A, Bp, 1, 2, 'hỗ trợ làm content'); fx.moodAdd(A, ri(1, 3));
  fx.memo(A, `Xin ${Bp.name} câu chuyện khách hàng, nhận về con số hơi phóng đại`);
  fx.memo(Bp, `Kể chuyện khách hàng cho ${A.name} làm content`);
  return `${A.name} xin ${Bp.name} câu chuyện khách hàng để làm content, nhận về con số "hơi phóng đại".`;
}

// --- HR
const HRS_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, ${c.me} đang làm khảo sát mức độ hài lòng, ${c.you} chấm công ty mấy điểm?`,
  (c) => `${c.Yn}, điền giúp ${c.me} phiếu khảo sát nha, ẩn danh đó.`,
];
/** [câu trả lời khảo sát, câu HR ghi nhận đúng câu đó] */
const HRS_ANS: readonly (readonly [Tpl, Tpl])[] = [
  [(c) => `${c.da}chấm... 10 điểm${c.a}.`, (c) => `${c.Me} ghi 10 nha.`],
  [(c) => `Ẩn danh thiệt hông ${c.you}?`, (c) => `Ẩn danh mà, ${c.me} hứa.`],
  [(c) => `Có được chấm thêm điểm cho cái máy lạnh hông?`, (c) => `Máy lạnh thì ${c.me} ghi nhận rồi.`],
];
/** câu dò la + các câu né đúng kiểu */
const HRS_PROBE: readonly (readonly [Tpl, readonly Tpl[]])[] = [
  [(c) => `Mà sao hôm qua ${c.you} về sớm vậy?`, [
    (c) => `${c.da}${c.me} về sớm vì... đi khám răng${c.a}.`,
    (c) => `${c.da}nhà ${c.me} có khách dưới quê lên${c.a}.`]],
  [(c) => `À mà dạo này ${c.teamL} có ai than gì không?`, [
    (c) => `${c.da}${c.me} hông biết gì hết${c.a}.`,
    (c) => `Thì... có người than lương, mà ${c.me} không nói tên đâu.`]],
  [(c) => `Mà ${c.you} thấy sếp dạo này sao?`, [
    (c) => `${c.da}sếp vẫn khỏe, vẫn đi golf đều${c.a}.`,
    (c) => `${c.da}câu này ${c.me} xin phép không trả lời${c.a}.`]],
];
const HR_CLOSE: Tpl[] = [
  (c) => `Ừ, ${c.me} ghi nhận hết nha.`,
  (c) => `Cảm ơn ${c.you}, ${c.me} ghi vô sổ rồi.`,
  (c) => `Ok, có gì cần cứ lên phòng ${c.me} nha.`,
  (c) => `Vậy thôi nha, ${c.you} làm việc tiếp đi.`,
];
const HRC_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, sáng nay ${c.you} quên chấm công nha.`,
  (c) => `${c.Yn}, tuần này ${c.you} đi trễ hai lần rồi đó.`,
  (c) => `${c.Yn}, máy chấm công báo ${c.you} tới lúc 8 giờ 47, đúng hông?`,
];
const HRC_EXCUSE: Pair[] = [
  [(c) => `${c.da}tại ${c.sc.excuse}${c.a}.`, [
    (c) => `Lý do đó ${c.me} nghe lần thứ ba rồi nha.`, (c) => `${c.Me} ghi nhận, nhưng lần sau báo trước cho ${c.me} nha.`]],
  [(c) => `${c.da}${c.me} có chấm mà máy không nhận mặt${c.a}.`, [
    (c) => `Máy nhận mặt cả công ty được mà riêng ${c.you} là không hả?`]],
  [(c) => `Máy chấm công nhận mặt ${c.me} thành người khác đó ${c.you}.`, [
    (c) => `Máy nhận mặt cả công ty được mà riêng ${c.you} là không hả?`,
    (c) => `Vậy mai ${c.me} đứng cạnh máy nhận mặt giùm ${c.you} nha.`]],
];
const HRC_PROMISE: Tpl[] = [
  (c) => `${c.da}lần sau ${c.me} đi sớm${c.a}.`,
  (c) => `${c.da}${c.me} hứa, mai ${c.me} tới sớm nhất văn phòng.`,
  (c) => `${c.da}mai ${c.me} đặt hai cái báo thức${c.a}.`,
];
const HRC_CLOSE: Tpl[] = [
  (c) => `${c.Me} ghi vô sổ rồi đó, ráng nha.`,
  (c) => `Ừ, mai ${c.me} đứng ngay cửa chờ ${c.you} đó.`,
];
const HRSPY_OPEN: Tpl[] = [
  (c) => `${c.Yn}, dạo này bên ${c.teamL} có chuyện gì vui hông?`,
  (c) => `${c.Yn} ơi, nghe nói hôm qua ${c.teamL} rôm rả lắm hả?`,
];
const HRSPY_A: Tpl[] = [
  (c) => `${c.da}cũng bình thường${c.a}... à mà có chuyện này.`,
  (c) => `Vui thì không, mà drama thì có.`,
];
const HRSPY_B: Tpl[] = [
  (c) => `Nghe đâu có người ${pick(['sắp nghỉ', 'đi phỏng vấn chỗ khác', 'được tăng lương', 'hay về sớm'])}, mà ${c.me} không chắc.`,
  (c) => `Có người than deadline dồn quá, mà ${c.me} không nói ai đâu.`,
];
const HRSPY_C: Tpl[] = [
  (c) => `Ai vậy ${c.you}? Nói nhỏ ${c.me} nghe thôi.`,
  (c) => `${c.Me} không hỏi đâu, ${c.me} chỉ quan tâm thôi.`,
];
const HRSPY_D: Tpl[] = [
  (c) => `Thôi ${c.me} không nói đâu, ${c.you} ghi sổ liền.`,
  (c) => `${c.da}${c.me} quên rồi${c.a}, thiệt đó.`,
];
const HRSPY_E: Tpl[] = [
  (c) => (c.prevHas('ghi sổ') ? `Đâu có, ${c.me} chỉ ghi... lịch họp thôi.` : null),
  (c) => `Ừ, vậy thôi. Mà có gì nhớ kể ${c.me} trước nha.`,
];
function dvHr(b: B, sc: SC, fx: FX, A: P, Bp: P, m: 'hr_survey' | 'hr_checkin' | 'hr_spy'): string {
  if (m === 'hr_survey') {
    const [ans, ack] = pick(HRS_ANS);
    const [probe, dodges] = pick(HRS_PROBE);
    b.say(A, Bp, HRS_OPEN, { em: ['📋', '😊'], pe: 0.4 });
    b.say(Bp, A, [ans], { em: E.nervous, pe: 0.4 });
    b.say(A, Bp, [(c) => `${ack(c)} ${probe(c)}`], { em: E.sly, pe: 0.3 });
    b.say(Bp, A, dodges, { em: E.nervous, pe: 0.4 });
    b.say(A, Bp, HR_CLOSE, { em: ['📝'], pe: 0.4 });
    fx.memo(A, `Khảo sát ${Bp.name}, dò thêm được chút tin`); fx.memo(Bp, `Bị ${A.name} khảo sát, trả lời né`);
    fx.relAdd(Bp, A, -1, 'hỏi han hơi kỹ');
    return `${A.name} đi khảo sát mức độ hài lòng, tiện dò la tin tức từ ${Bp.name}.`;
  }
  if (m === 'hr_checkin') {
    b.say(A, Bp, HRC_OPEN, { em: ['📋', '🙂'], pe: 0.4 });
    b.pair(Bp, A, HRC_EXCUSE, { em: E.nervous, pe: 0.5 }, { em: E.smile, pe: 0.3 });
    b.say(Bp, A, HRC_PROMISE, { em: E.nervous, pe: 0.3 });
    b.say(A, Bp, HRC_CLOSE, { opt: true, em: ['📝'] });
    fx.moodAdd(Bp, -ri(2, 4)); fx.relAdd(Bp, A, -ri(1, 3), 'bị nhắc chấm công');
    fx.memo(Bp, `Bị ${A.name} nhắc chuyện chấm công, lại phải kiếm lý do`); fx.memo(A, `Nhắc ${Bp.name} chuyện đi trễ, chấm công`);
    return `${A.name} nhắc ${Bp.name} chuyện chấm công, nghe thêm một lý do mới.`;
  }
  b.say(A, Bp, HRSPY_OPEN, { em: E.smile, pe: 0.4 });
  b.say(Bp, A, HRSPY_A, { em: E.think, pe: 0.3 });
  b.say(Bp, A, HRSPY_B, { em: E.sly, pe: 0.3 });
  b.say(A, Bp, HRSPY_C, { em: E.sly, pe: 0.3 });
  b.say(Bp, A, HRSPY_D, { opt: true, em: E.nervous });
  b.say(A, Bp, HRSPY_E, { em: ['📝'], pe: 0.4 });
  bond(fx, A, Bp, 0, 2, 'tám chuyện nội bộ');
  fx.memo(A, `Dò la được tin từ ${Bp.name}: có người không vui`); fx.memo(Bp, `Lỡ kể ${A.name} chuyện nội bộ`);
  return `${A.name} ghé bàn ${Bp.name} hỏi han, thật ra là đi dò tin.`;
}

// --- sales mới → sales lead: bí kíp (mỗi bí kíp kéo theo câu hỏi và lời đáp riêng)
interface Tip { adv: Tpl; q: Tpl; a: Tpl[] }
const TIPS_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, chỉ ${c.me} bí kíp chốt khách khó với.`,
  (c) => `${c.Yn}, khách ${c.client} cứ hỏi giá rồi im, ${c.me} làm sao giờ?`,
];
const TIPS: Tip[] = [
  { adv: (c) => `Bí kíp là... khách nói gì cũng "dạ anh lo được hết".`, q: (c) => `Lỡ dev không làm được thì sao ${c.you}?`,
    a: [(c) => `Thì... để ${c.tlRef} lo.`, (c) => `Thì nói khách là đang tối ưu, mua thêm thời gian.`] },
  { adv: (c) => `Gọi lúc 10 giờ sáng, khách vừa uống cà phê là dễ chịu nhất.`, q: (c) => `Rồi khách đòi giảm 30% thì sao ${c.you}?`,
    a: [(c) => `Giảm 5%, tặng thêm tháng dùng thử, khách vui là chốt.`, (c) => `Cười thiệt tươi rồi nói "để em xin sếp", vậy là có thời gian.`] },
  { adv: (c) => `Đừng gửi báo giá trước, mời khách đi cà phê trước.`, q: (c) => `Cà phê ai trả vậy ${c.you}?`,
    a: [(c) => `Công ty trả, nhớ giữ hóa đơn đưa ${c.hrRef}.`, (c) => `Mình trả, chốt được deal là lời gấp trăm lần.`] },
];
const TIPS_OK: Tpl[] = [
  (c) => `${c.da}${c.me} hiểu rồi, chiều ${c.me} gọi liền${c.a}.`,
  (c) => `Nghe ${c.you} nói ${c.me} thấy dễ ợt.`,
];
const TIPS_CLOSE: Tpl[] = [
  (c) => `Gọi đi, đừng ngồi chơi game nữa là được.`,
  (c) => (c.hrHere ? null : `Tháng này ráng nha, ${c.hrRef} đang để ý đó.`),
  (c) => `Chốt được thì anh em mình đi karaoke.`,
];
function dvTips(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  const tip = pick(TIPS);
  b.say(A, Bp, TIPS_OPEN, { em: E.nervous, pe: 0.4 });
  b.say(Bp, A, [tip.adv], { em: E.cool, pe: 0.4 });
  const q = b.say(A, Bp, [tip.q], { em: E.think, pe: 0.3, opt: true });
  if (q) b.say(Bp, A, tip.a, { em: E.sly, pe: 0.3, opt: true, dep: q });
  b.say(A, Bp, TIPS_OK, { em: E.happy, pe: 0.3 });
  b.say(Bp, A, TIPS_CLOSE, { em: E.ok, pe: 0.3 });
  bond(fx, A, Bp, 1, 3, 'chỉ bí kíp chốt khách'); fx.kpiAdd(A, ri(1, 3)); fx.moodAdd(A, ri(1, 3));
  fx.memo(A, `Xin ${Bp.name} bí kíp chốt khách`); fx.memo(Bp, `Chỉ ${A.name} bí kíp chốt khách`);
  return `${A.name} xin ${Bp.name} bí kíp chốt khách, nhận về một câu thần chú.`;
}

// --- sales mới → fresher: rủ game (hai kịch bản: từ chối / đồng ý)
const GAME_OPEN: Tpl[] = [
  (c) => `${c.Yn}, trưa nay leo rank hông? ${c.Me} mới lên kim cương.`,
  (c) => `${c.Yn}, sự kiện game mới ra kìa, vô liền hông?`,
];
function dvGame(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, GAME_OPEN, { em: ['🎮'], pe: 0.5 });
  if (chance(0.55)) {
    b.say(Bp, A, [(c) => (c.genz ? `Khum được đâu, ${c.tlRef} đang soi ${c.me}.` : `Thôi, ${c.tlRef} đang soi ${c.me} đó.`)], { em: E.nervous, pe: 0.3 });
    b.say(A, Bp, [(c) => `Một trận thôi mà, ${c.me} gánh cho.`,
      (c) => (c.bossAway ? `${c.You} sợ gì, sếp đi vắng mà.` : `Giờ nghỉ trưa thì ai cấm được.`)], { em: E.sly, pe: 0.3 });
    b.say(Bp, A, [(c) => `Thôi tối nha, giờ ${c.me} sửa bug.`, (c) => `Trưa nha, ăn lẹ rồi vô.`], { em: E.ok, pe: 0.3 });
  } else {
    b.say(Bp, A, [(c) => `Một trận thôi nha, mười lăm phút.`, (c) => `Chơi luôn, ${c.me} đang muốn xả stress.`], { em: E.cool, pe: 0.3 });
    b.say(A, Bp, [(c) => `Ok, ai thua bao trà sữa.`, (c) => `Chốt! Vô phòng chờ đi.`], { em: ['🎮', '😎'], pe: 0.4 });
    b.say(Bp, A, [(c) => `Nói nhỏ thôi, ${c.tlRef} nghe là toang.`, (c) => `Nhớ tắt tiếng, đừng để ai nghe.`], { opt: true, em: E.sly });
  }
  b.say(A, Bp, [(c) => `Chốt vậy nha, đừng có bùng.`, (c) => `Ok, lên mạng nhớ réo ${c.me}.`], { opt: true, em: ['🎮'] });
  bond(fx, A, Bp, 1, 3, 'chiến hữu leo rank'); fx.moodAdd(A, ri(1, 3)); fx.moodAdd(Bp, ri(1, 2));
  fx.memo(A, `Rủ ${Bp.name} leo rank`); fx.memo(Bp, `Hẹn ${A.name} leo rank "một trận thôi"`);
  return `${A.name} rủ ${Bp.name} leo rank, hẹn "một trận thôi".`;
}
// --- mượn sạc (hai kịch bản)
function dvCharger(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  b.say(A, Bp, [(c) => `${c.Yn} ơi cho ${c.me} mượn cục sạc, điện thoại ${c.me} còn 2%.`,
    (c) => `${c.Yn}, cứu ${c.me} cục sạc với, máy sắp tắt rồi.`], { em: ['🔋', '🥺'], pe: 0.5 });
  if (chance(0.6)) {
    b.say(Bp, A, [(c) => `Lại hết pin nữa hả? Sáng giờ ${c.you} làm gì mà hết?`], { em: E.sly, pe: 0.3 });
    const sales = isSales(A);
    b.say(A, Bp, sales ? [(c) => `${c.da}${c.me}... gọi khách đó${c.a}.`, (c) => `${c.da}${c.me} tra cứu thông tin khách hàng${c.a}.`]
      : A.role === 'qa' ? [(c) => `${c.da}${c.me} test app trên điện thoại cả buổi${c.a}.`]
        : A.role === 'marketing' ? [(c) => `${c.da}${c.me} quay clip cho fanpage cả sáng${c.a}.`]
          : [(c) => `${c.da}${c.me} tra tài liệu trên điện thoại${c.a}.`, (c) => `${c.da}${c.me} nghe nhạc cho tập trung${c.a}.`], { em: E.nervous, pe: 0.4 });
    b.say(Bp, A, sales ? [(c) => `Gọi khách hay leo rank?`, (c) => `Tra cứu bằng game hả ${c.you}?`]
      : [(c) => `Làm việc hay lướt TikTok đó?`, (c) => `Thiệt hông đó ${c.you}?`], { em: E.sly, pe: 0.4 });
    b.say(A, Bp, [(c) => `Hehe, cả hai${c.a}.`, (c) => `${c.da}một chút xíu thôi${c.a}.`], { opt: true, em: E.fun });
    b.say(Bp, A, sales ? [(c) => `Cầm đi, mà chiều nay phải gọi khách thiệt đó nha.`] : [(c) => `Cầm đi, nhớ trả trước 5 giờ nha.`, (c) => `Cầm đi, lần sau tự mang sạc nha.`], { em: E.ok, pe: 0.3 });
  } else {
    b.say(Bp, A, [(c) => `Cục sạc hôm qua ${c.you} mượn còn chưa trả đó.`], { em: E.annoy, pe: 0.3 });
    b.say(A, Bp, [(c) => `${c.da}${c.me} để quên ở nhà${c.a}, mai ${c.me} mang lên liền.`,
      (c) => `${c.da}${c.me} trả liền chiều nay, hứa${c.a}.`], { em: E.nervous, pe: 0.4 });
    b.say(Bp, A, [(c) => `Lần cuối đó nha. Cầm đi.`, (c) => `Hứa hoài... thôi cầm đi, nhớ trả cả hai cục.`], { em: E.tired, pe: 0.3 });
  }
  bond(fx, A, Bp, 0, 2, 'cho mượn sạc'); fx.moodAdd(A, ri(1, 2));
  fx.memo(A, `Mượn sạc của ${Bp.name}, bị hỏi khó`); fx.memo(Bp, `Lại cho ${A.name} mượn sạc`);
  return `${A.name} sang mượn sạc của ${Bp.name}, lý do "công việc".`;
}
// --- senior → QA: "không phải bug"
const FEAT: Tpl[][] = [
  [(c) => `${c.L} nè, ticket ${c.you} báo hôm qua, đó là tính năng chứ không phải bug.`, (c) => `${c.L}, cái ticket số ${c.ticket} đó, thiết kế vậy mà.`],
  [(c) => `Tính năng gì mà lỗi ${c.bug} hả ${c.you}?`],
  [(c) => `Tính năng... giúp khách cẩn thận hơn.`, (c) => `Đó là thiết kế có chủ đích, khách nào tinh mới thấy.`],
  [(c) => `Vậy ${c.me} ghi vô release note là "tính năng lỗi ${c.bug}" nha 🙂`, (c) => `Để ${c.me} hỏi ${c.tlRef} coi đây là tính năng hay bug ha.`],
  [(c) => `Thôi thôi, để ${c.me} sửa, đừng làm lớn chuyện.`],
  [(c) => `Biết vậy là tốt 🙂 Chiều ${c.me} test lại.`],
];
function dvFeature(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  FEAT.forEach((pool, i) => b.say(i % 2 === 0 ? A : Bp, i % 2 === 0 ? Bp : A, pool, { em: i % 2 ? E.smile : E.cool, pe: 0.35 }));
  fx.relAdd(A, Bp, -ri(1, 3), 'không chịu cho qua bug'); fx.relAdd(Bp, A, -ri(1, 3), 'gọi bug là tính năng');
  fx.moodAdd(A, -ri(1, 3)); fx.moodAdd(Bp, ri(1, 3)); fx.kpiAdd(A, ri(1, 3));
  fx.memo(A, `Cố cãi với ${Bp.name} rằng bug là tính năng, thua`); fx.memo(Bp, `${A.name} gọi bug là tính năng, bị bắt sửa`);
  return `${A.name} cố thuyết phục ${Bp.name} rằng lỗi ${sc.bug} là tính năng, thất bại.`;
}
// --- ai cũng được: mượn đồ / trà sữa / tám
const BORROW_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, cho ${c.me} mượn ${c.item} chút.`,
  (c) => `${c.Yn} có ${c.item} hông, cho ${c.me} mượn năm phút.`,
  (c) => `${c.Yn} ơi, ${c.item} của ${c.you} cho ${c.me} mượn xíu, ${c.me} trả liền.`,
];
const BORROW_REPLY: Pair[] = [
  [(c) => `Lần trước ${c.you} mượn cây bút tới giờ chưa trả đó.`, [
    (c) => `${c.da}${c.me} trả liền, hứa luôn.`, (c) => `${c.da}cây bút đó ${c.me} làm rớt mất tiêu rồi${c.a}, ${c.me} đền cây khác.`]],
  [(c) => `Mượn chi vậy ${c.you}?`, [
    (c) => `Để ${c.me} mở hộp hàng mới về.`, (c) => `Để ${c.me} làm cái thiệp sinh nhật cho cả phòng.`]],
  [(c) => `Lấy đi, nhớ trả nha.`, [(c) => `${c.da}${c.me} trả liền, hứa luôn.`]],
];
const BORROW_CLOSE: Tpl[] = [
  (c) => `Cảm ơn ${c.you} nha, chiều ${c.me} bao ${c.drink}.`,
  (c) => `Ok, trả trước 5 giờ, ${c.me} hứa.`,
  (c) => `${c.Me} trả lại liền, ${c.you} đừng lo nha.`,
  (c) => `Cảm ơn ${c.you}, có gì cần cứ qua bàn ${c.me}.`,
];
const MT_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, chiều nay order trà sữa hông, ${c.me} gom đơn nè.`,
  (c) => `${c.Yn}, uống ${c.drink} hông? Đơn chung đủ năm ly là freeship.`,
  (c) => `${c.Yn} ơi, chiều nay trời nóng, làm ly ${c.drink} hông?`,
];
const MT_REPLY: Tpl[] = [
  (c) => `Có chứ! Cho ${c.me} một ly ít đường, nhiều trân châu.`,
  (c) => `Đang giảm cân mà... thôi cho ${c.me} size M.`,
  (c) => `Ai bao vậy ${c.you}?`,
];
const MT_PAY: Tpl[] = [
  (c) => `Ai uống người đó trả nha, ${c.me} chỉ gom đơn thôi.`,
  (c) => `Sales chốt deal thì có người bao, chưa chốt thì tự trả.`,
];
const MT_ADD: Tpl[] = [
  (c) => `Vậy cho ${c.me} thêm cái bánh flan nữa.`,
  (c) => `Thôi được, ${c.me} tự trả, mà nhớ thêm thạch nha.`,
];
const MT_CLOSE: Tpl[] = [
  (c) => `Ok, ${c.me} chốt đơn lúc ba giờ nha.`,
  (c) => `Ghi rồi, ai đặt sau ba giờ là ráng chịu.`,
  (c) => `Ok, tới giờ là ${c.me} réo nha.`,
];
const CHAT_OPEN: Tpl[] = [
  (c) => `${c.Yn} đang làm gì đó, cho ${c.me} ngồi ké xíu.`,
  (c) => `${c.Yn} ơi, nghỉ tay năm phút đi, ${c.me} kể cái này nghe.`,
  (c) => `${c.Yn} bận hông? ${c.Me} đi ngang thấy ${c.you} căng thẳng quá.`,
  (c) => `${c.Yn}, nghỉ năm phút đi, ${c.me} mới nghe được chuyện này hay lắm.`,
];
const CHAT_REPLY: Tpl[] = [
  (c) => `Ngồi đi, ${c.me} cũng đang cần nghỉ chút.`,
  (c) => `Nói lẹ nha, ${c.me} còn ${c.taskS} chưa xong.`,
  (c) => `${c.da}có gì vui kể ${c.me} nghe với${c.a}.`,
  (c) => `Ngồi đi, nãy giờ ${c.me} cũng cần người nói chuyện.`,
  (c) => `Năm phút thôi nha, ${c.me} đang chạy deadline.`,
];
function dvChat(b: B, sc: SC, fx: FX, A: P, Bp: P, kind: 'borrow' | 'milktea' | 'chat'): string {
  if (kind === 'borrow') {
    b.say(A, Bp, BORROW_OPEN, { em: E.polite, pe: 0.3 });
    b.pair(Bp, A, BORROW_REPLY, { em: E.sly, pe: 0.3 }, { opt: false });
  } else if (kind === 'milktea') {
    b.say(A, Bp, MT_OPEN, { em: ['🧋'], pe: 0.6 });
    b.say(Bp, A, MT_REPLY, { em: E.happy, pe: 0.3 });
    b.say(A, Bp, MT_PAY, { em: E.fun, pe: 0.3 });
    b.say(Bp, A, MT_ADD, { opt: true, em: E.fun });
  } else {
    b.say(A, Bp, CHAT_OPEN, { em: E.smile, pe: 0.3 });
    b.say(Bp, A, CHAT_REPLY, { em: E.ok, pe: 0.2 });
  }
  if (kind !== 'milktea' || chance(0.4)) {
    const lastSp = b.last()?.sp;
    topicBeat(b, lastSp?.id === A.id ? Bp : A, lastSp?.id === A.id ? A : Bp, 3);
  }
  b.say(kind === 'borrow' ? A : b.next(), null, kind === 'borrow' ? BORROW_CLOSE : kind === 'milktea' ? MT_CLOSE : CLOSE_OFFICE,
    { em: E.ok, pe: 0.3 });
  bond(fx, A, Bp, 1, 3, kind === 'milktea' ? 'rủ trà sữa' : kind === 'borrow' ? 'cho mượn đồ' : 'tám chuyện');
  fx.moodAdd(A, ri(1, 4)); fx.moodAdd(Bp, ri(0, 3));
  fx.memo(A, kind === 'borrow' ? `Mượn ${sc.item} của ${Bp.name}` : kind === 'milktea' ? `Gom đơn ${sc.drink}, ${Bp.name} đặt liền`
    : `Ghé bàn ${Bp.name} tám chuyện ${sc.topic}`);
  fx.memo(Bp, `${A.name} ghé bàn ${kind === 'milktea' ? 'rủ trà sữa' : kind === 'borrow' ? 'mượn đồ' : 'tám chuyện'}`);
  if (kind === 'borrow') return `${A.name} ghé bàn ${Bp.name} mượn ${sc.item}, tiện tám vụ ${sc.topic}.`;
  if (kind === 'milktea') return `${A.name} đi gom đơn ${sc.drink}, ${Bp.name} đặt liền một ly.`;
  return pick([`${A.name} ghé bàn ${Bp.name} tám chuyện ${sc.topic}.`, `${A.name} sang bàn ${Bp.name} than vụ ${sc.topic}.`]);
}
const NOTICE_OPEN: Tpl[] = [
  (c) => `Ủa ${c.yn} đang ${c.sc.targetAct} hả?`,
  (c) => `${c.Yn} ${c.sc.targetAct} chăm chỉ ghê ha.`,
  (c) => `Bắt quả tang ${c.you} đang ${c.sc.targetAct} nha.`,
];
const NOTICE_REPLY: Tpl[] = [
  (c) => `Đâu có, ${c.me} nghỉ mắt xíu thôi mà.`,
  (c) => `Suỵt, nói nhỏ thôi, ${c.me} xem có năm phút.`,
  (c) => `${c.da}${c.me} đang nghiên cứu thị trường đó${c.a}.`,
];
// ---------------------------------------------------------------- v5: ghé hỏi han / nói chuyện riêng (desk_visit giọng "support")
//  Ba kiểu: hỏi han (chưa có hướng xử lý) · nói rõ hướng đã chốt · thương lượng (chống đối: "thương lượng: … bù lại")
const SUP: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.Yn} ơi, ${c.me} ghé hỏi thăm chút. Dạo này ổn hông?`,
    (c) => `Không phải chuyện việc đâu, ${c.me} hỏi thăm ${c.you} thôi.`,
    (c) => `${c.Me} nghe loáng thoáng rồi. ${c.You} có cần gì cứ nói ${c.me} nha.`,
  ],
  reply: [
    (c) => `${c.da}cũng hơi rối, mà ${c.me} đang cố${c.a}.`,
    (c) => `${c.da}${c.me} ngại làm phiền mọi người quá${c.a}.`,
    (c) => `${c.da}dạo này ${c.me} không tập trung nổi, ${c.me} xin lỗi${c.a}.`,
  ],
  plan: [
    (c) => (planFor(c) ? `Mọi người bàn rồi nè: ${planFor(c)}. ${c.You} yên tâm.` : null),
    (c) => (planFor(c) ? `${c.Me} nói luôn cho ${c.you} khỏi lo: ${planFor(c)}.` : null),
  ],
  care: [
    (c) => `Việc thì từ từ, ${c.you} lo cho mình trước đã.`,
    (c) => `Có gì cứ nhắn ${c.me}, đừng ôm một mình.`,
    (c) => `Chiều ${c.me} mua ly nước cho ${c.you}, uống cho tỉnh.`,
  ],
  thanks: [
    (c) => `${c.da}cảm ơn ${c.you} nhiều nha${c.a}.`,
    (c) => `${c.da}nghe vậy ${c.me} thấy nhẹ người hơn chút${c.a}.`,
    (c) => `${c.da}${c.me} sẽ cố, không để ảnh hưởng mọi người nữa${c.a}.`,
  ],
  // thương lượng (chống đối): người kia nêu điều kiện rồi chịu, hoặc vẫn càu nhàu — không an ủi kiểu "lo cho mình trước"
  dealOpen: [
    (c) => `${c.Yn}, ${c.me} qua nói chuyện vụ hôm trước chút, nói riêng thôi.`,
    (c) => `Vụ ${c.you} góp ý hôm bữa, ${c.me} nói chuyện thẳng với nhau chút nha.`,
  ],
  dealPlan: [
    (c) => (planFor(c) ? `${c.Me} nói thẳng nha: ${planFor(c)}. Vậy được hông?` : null),
    (c) => (planFor(c) ? `Mọi người chốt vầy: ${planFor(c)}. ${c.You} thấy sao?` : null),
  ],
  dealCond: [
    (c) => `${c.da}nhận thêm cũng được, mà ${c.me} xin nói rõ là việc gì, đừng dồn hết qua ${c.me}${c.a}.`,
    (c) => `${c.da}vậy cũng công bằng, ${c.me} chỉ cần được nói lý lẽ thôi${c.a}.`,
    (c) => `${c.da}nghe vẫn hơi thiệt cho ${c.me}, mà thôi, ${c.me} chịu${c.a}.`,
  ],
  dealClose: [
    (c) => `Vậy chốt nha, có gì vướng thì nói ${c.me}, đừng để bụng.`,
    (c) => `Ok, ${c.me} ghi lại, cuối tuần mình xem lại cho công bằng.`,
    (c) => `Được vậy là đẹp, mình làm tiếp nha ${c.you}.`,
  ],
};
/**
 * Hướng xử lý đã chốt (lý do ghé bàn trong tình huống: "… đi tới bàn X để <hướng>.") — trống nếu chỉ là hỏi han.
 * Đọc sitRaw (giữ hoa/thường): sc.sit đã viết thường nên tên người sẽ thành "linh".
 */
function supportPlan(sc: SC): string {
  const m = /đi tới bàn .+? để (.+?)(?: \(|\. |\.$|\s\n)/u.exec(sc.sitRaw);
  const why = m ? m[1].trim() : '';
  return why && !/hỏi han/u.test(why) ? cut(why, 90) : '';
}
/** hướng xử lý nói với chính người đó: tên người nghe → "em / anh / chị…", bỏ nhãn "thương lượng:" */
function planFor(c: C): string {
  const plan = supportPlan(c.sc).replace(/^thương lượng\s*:\s*/u, '');
  return plan ? plan.replace(wre(c.L), c.you) : '';
}
function dvSupport(b: B, sc: SC, fx: FX, A: P, Bp: P): string {
  const plan = supportPlan(sc);
  if (/^thương lượng/u.test(plan)) {
    b.say(A, Bp, SUP.dealOpen, { em: E.polite, pe: 0.3 });
    b.say(A, Bp, SUP.dealPlan, { pe: 0 });
    b.say(Bp, A, SUP.dealCond, { em: E.sly, pe: 0.3 });
    b.say(A, Bp, SUP.dealClose, { em: E.ok, pe: 0.3 });
    fx.moodAdd(Bp, ri(0, 3));
    fx.relAdd(Bp, A, ri(1, 3), 'thương lượng êm');
    fx.memo(Bp, `${A.name} ghé thương lượng riêng, mình chịu nhận thêm việc để được như ý`);
    return `${A.name} ghé bàn ${Bp.name} thương lượng riêng, hai bên chốt được.`;
  }
  b.say(A, Bp, SUP.open, { em: E.polite, pe: 0.4 });
  b.say(Bp, A, SUP.reply, { em: E.sad, pe: 0.4 });
  if (plan) b.say(A, Bp, SUP.plan, { pe: 0 });
  b.say(A, Bp, SUP.care, { opt: true, em: E.polite, pe: 0.3 });
  b.say(Bp, A, SUP.thanks, { em: E.happy, pe: 0.4 });
  fx.moodAdd(Bp, ri(2, 5));
  fx.relAdd(Bp, A, ri(2, 4), 'được hỏi han lúc khó khăn');
  fx.memo(Bp, `${A.name} ghé hỏi han lúc mình đang rối`);
  return `${A.name} ghé hỏi han ${Bp.name}, nói chuyện nhỏ nhẹ.`;
}

function bDeskVisit(b: B, sc: SC, fx: FX): string {
  const A = sc.cast[0];
  const Bp = sc.cast[1] ?? sc.cast[0];
  if (A.id === Bp.id) { topicBeat(b, A, A, 2); return `${A.name} ngồi một mình nghĩ về chuyện ${sc.topic}.`; }
  // v5: giọng "support" (tình huống công ty: hỏi han người gặp chuyện / nói rõ hướng xử lý) — không rơi vào mô-típ ghé bàn thường
  if (has(sc, 'mục tiêu: nói chuyện riêng, nhỏ nhẹ')) return dvSupport(b, sc, fx, A, Bp);
  const act = activityOf(sc, Bp);
  if (act.kind === 'slack' && chance(0.7)) {
    sc.targetAct = act.label;
    const d = b.say(A, Bp, NOTICE_OPEN, { em: E.sly, pe: 0.5 });
    b.say(Bp, A, NOTICE_REPLY, { em: E.nervous, pe: 0.5, dep: d });
  }
  const m = pickMotive(sc, A, Bp);
  switch (m) {
    case 'bug': return dvBug(b, sc, fx, A, Bp);
    case 'promise': return dvPromise(b, sc, fx, A, Bp);
    case 'pixel': return dvPixel(b, sc, fx, A, Bp, false);
    case 'pixel_dev': return dvPixel(b, sc, fx, A, Bp, true);
    case 'ask': return dvAsk(b, sc, fx, A, Bp);
    case 'review': return dvReview(b, sc, fx, A, Bp);
    case 'banner': return dvBanner(b, sc, fx, A, Bp);
    case 'sale': return dvSale(b, sc, fx, A, Bp);
    case 'tiktok': return dvTiktok(b, sc, fx, A, Bp);
    case 'mkt_sales': return dvMktSales(b, sc, fx, A, Bp);
    case 'hr_survey': case 'hr_checkin': case 'hr_spy': return dvHr(b, sc, fx, A, Bp, m);
    case 'tips': return dvTips(b, sc, fx, A, Bp);
    case 'game': return dvGame(b, sc, fx, A, Bp);
    case 'charger': return dvCharger(b, sc, fx, A, Bp);
    case 'feature': return dvFeature(b, sc, fx, A, Bp);
    default: return dvChat(b, sc, fx, A, Bp, m);
  }
}

// ---------------------------------------------------------------- gossip
const GOSSIP_OPEN: Tpl[] = [
  (c) => `${c.Yn} ơi, lại đây ${c.me} nói cái này, nhỏ nhỏ thôi nha.`,
  (c) => `${c.Yn} biết chuyện của ${c.xn} chưa?`,
  (c) => `Hóng nè, chuyện ${c.xn} đó, nghe xong đừng nói ai nha.`,
  (c) => `${c.Me} mới nghe được tin này, nóng hổi luôn.`,
  (c) => `${c.Yn} rảnh hai phút hông? Chuyện ${c.xn} đó.`,
  (c) => `Nói nhỏ nha ${c.you}, ${c.me} biết một chuyện mà ${c.me} không biết có nên kể không.`,
  (c) => `${c.Yn} ơi, vụ của ${c.xn} ${c.you} nghe gì chưa?`,
];
const GOSSIP_HUH: Tpl[] = [
  (c) => `Chuyện gì? Nói lẹ đi, ${c.me} hóng nè.`,
  (c) => `Gì vậy trời, mặt ${c.you} nghiêm trọng quá.`,
  (c) => `Lại tin gì nữa đây ${c.you}?`,
  (c) => `Kể đi, ${c.me} hứa không nói ai.`,
  (c) => `Lại hóng nữa hả trời, kể lẹ đi.`,
];
const GOSSIP_SHOCK: Tpl[] = [
  (c) => `Trời đất, thiệt hả?`,
  (c) => `Má ơi, ${c.me} không tin nổi luôn.`,
  (c) => `Hèn chi dạo này ${c.xp} lạ lạ.`,
  (c) => `Ủa vậy hả? Sao ${c.me} không biết gì hết trơn?`,
  (c) => `Trời, vậy mà ${c.xp} giấu kỹ ghê.`,
  (c) => `Trời ơi, nghe mà sốc thiệt sự.`,
  (c) => `Vậy mà ${c.me} tưởng ${c.xp} hiền lắm.`,
];
const GOSSIP_DOUBT: Tpl[] = [
  (c) => `Thôi đi ${c.you}, ${c.xn} đâu phải người vậy.`,
  (c) => `Nghe ai nói vậy? Chắc gì đúng.`,
  (c) => `${c.You} đừng có thêm mắm thêm muối nha.`,
];
const GOSSIP_EVIDENCE: Tpl[] = [
  (c) => `Hôm qua ${c.me} thấy ${c.xp} nghe điện thoại ngoài hành lang, nói nhỏ xíu.`,
  (c) => `Mấy bữa nay ${c.xp} mặc đồ đẹp bất thường luôn.`,
  (c) => `${c.Xp} còn đổi hình đại diện thành ảnh đi biển nữa.`,
  (c) => (c.x?.role === 'boss' ? `Sáng nay ${c.xp} đóng cửa phòng nói điện thoại cả tiếng.` : `Sáng nay ${c.xp} ra vào phòng sếp ba lần.`),
  (c) => `${c.Xp} cứ nhìn điện thoại rồi cười một mình hoài.`,
  (c) => `Bàn ${c.xp} tự nhiên dọn sạch trơn, nghi lắm.`,
  (c) => `Hôm trước ${c.xp} về sớm, nói đi gặp khách mà khách nào đâu.`,
  (c) => (c.x?.role === 'boss' ? `${c.Me} còn thấy ${c.xp} tập putt golf một mình mà cười cười.` : `${c.Me} còn thấy ${c.xp} lén xem trang tuyển dụng nữa.`),
];
const GOSSIP_SPEC: Tpl[] = [
  (c) => `Vậy chắc ${c.xp} sắp ${c.x?.role === 'boss' ? pick(['có tin vui', 'đi golf cả tuần', 'mở thêm chi nhánh']) : pick(['nghỉ thiệt', 'được thăng chức', 'đổi việc', 'có tin vui'])} rồi.`,
  (c) => `Thảo nào hôm qua ${c.xp} bao trà sữa cả phòng.`,
  (c) => (c.x?.role === 'boss' ? `Bảo sao dạo này ${c.xp} vui tính bất thường.` : null),
  (c) => `${c.Me} đoán vụ này còn dài, hóng tiếp.`,
  (c) => `Để ${c.me} để ý thêm, có gì báo ${c.you}.`,
  (c) => `Bởi vậy hôm bữa ${c.xp} hỏi ${c.me} mấy câu lạ lạ.`,
  (c) => `Chắc ${c.xp} cũng có nỗi khổ riêng á.`,
];
const GOSSIP_DEFEND: Tpl[] = [
  (c) => `Thôi, chưa rõ thì đừng nói lung tung, tội ${c.xp}.`,
  (c) => `${c.Me} mà nghe ai nói nữa là ${c.me} hỏi thẳng ${c.xp} luôn đó.`,
];
const GOSSIP_CLOSE: Tpl[] = [
  (c) => `Thôi im, ${c.xp} đi tới kìa!`,
  (c) => `Nhớ đó, ${c.me} chưa nói gì với ${c.you} hết nha.`,
  (c) => `Chuyện này ${c.me} chỉ kể cho ${c.you} thôi đó.`,
  (c) => (c.hrHere ? null : `Thôi về chỗ, đứng đây lâu ${c.hrRef} để ý.`),
  (c) => `Yên tâm, miệng ${c.me} kín lắm.`,
  (c) => `Thôi, chuyện người ta, mình biết vậy thôi nha.`,
  (c) => `Nhớ đó, nghe xong là quên liền nha ${c.you}.`,
];
const RUMOR_NEW: ((c: C, r: string) => string)[] = [
  (c, r) => `Nghe nói ${r}.`,
  (c, r) => `Tin nóng nè: ${r}.`,
  (c, r) => `Nói nhỏ thôi nha: ${r}.`,
  (c, r) => `${c.Me} nghe người trong cuộc kể là ${r} đó.`,
];
const RUMOR_RETELL: ((c: C, r: string) => string)[] = [
  (c, r) => `Nghe đâu ${r}.`,
  (c, r) => `Hồi sáng ở pantry ai cũng nói ${r}.`,
  (c, r) => `Có người thấy tận mắt: ${r}.`,
  (c, r) => `Không phải tin đồn nữa đâu, thiệt luôn: ${r}.`,
  (c, r) => `${c.Me} nghe lại từ nguồn rất đáng tin là ${r}.`,
];
/** Tin đồn của cảnh: kể tiếp (có "thêm mắm") hoặc tạo mới */
function rumorFor(sc: SC, x: P): { text: string; isNew: boolean } {
  const r = sc.req.rumor;
  const cur = r && typeof r.currentText === 'string' ? r.currentText.trim() : '';
  if (r && cur && !r.isNew) return { text: twistRumor(cur, sc, x), isNew: false };
  if (r && cur && r.isNew) return { text: cut(cur.replace(/[.!…]+$/u, ''), 140), isNew: true };
  return { text: makeRumor(x, sc), isNew: true };
}
function tellRumor(b: B, teller: P, listener: P, x: P, text: string, isNew: boolean, opt = false): void {
  const pool = (isNew ? RUMOR_NEW : RUMOR_RETELL).map((f) => (c: C) => f(c, tellAs(b.sc, c.s, x, text)));
  b.say(teller, listener, pool, { em: E.sly, pe: 0.5, x, opt });
}
function bGossip(b: B, sc: SC, fx: FX): string {
  const A = sc.cast[0];
  const L = sc.cast[1] ?? sc.cast[0];
  const x = sc.x;
  if (!x || x.id === A.id || x.id === L.id) {
    // không rõ nói về ai → tám drama chung
    sc.topicCat = 'drama';
    sc.topic = pickTopic(['drama'], sc.ctx.recentSummaries);
    topicBeat(b, A, L, 4);
    b.say(b.next(), null, GOSSIP_CLOSE.slice(1), {});
    bond(fx, A, L, 1, 3, 'chung hội hóng chuyện');
    return `${A.name} và ${L.name} xì xào chuyện ${sc.topic}.`;
  }
  const { text, isNew } = rumorFor(sc, x);
  const defends = relScore(L, x) >= 25;
  b.say(A, L, GOSSIP_OPEN, { em: E.sly, pe: 0.4 });
  b.say(L, A, GOSSIP_HUH, { opt: true, em: E.think, pe: 0.3 });
  tellRumor(b, A, L, x, text, isNew);
  b.say(L, A, defends ? GOSSIP_DOUBT : GOSSIP_SHOCK, { em: defends ? E.think : E.shock, pe: 0.5 });
  b.say(A, L, GOSSIP_EVIDENCE, { opt: !defends, em: E.sly, pe: 0.3 });
  b.say(L, A, defends ? GOSSIP_DEFEND : GOSSIP_SPEC, { opt: true, em: E.think, pe: 0.3 });
  b.say(b.next(), null, GOSSIP_CLOSE, { em: E.sly, pe: 0.4 });
  fx.rumor = { aboutId: x.id, text };
  bond(fx, A, L, defends ? -2 : 1, defends ? 0 : 3, defends ? 'nói xấu người khác' : 'chung hội hóng chuyện');
  fx.relAdd(L, x, defends ? 0 : -ri(1, 3), `nghe đồn: ${cut(text, 40)}`);
  fx.relAdd(A, x, -1, 'đem chuyện đi kể');
  fx.memo(A, `Kể với ${L.name}: ${cut(text, 70)}`);
  fx.memo(L, `Nghe ${A.name} kể: ${cut(text, 70)}`);
  return pick([`${A.name} rỉ tai ${L.name} tin đồn về ${called(x)}.`, `${A.name} và ${L.name} xì xào sau lưng ${called(x)}.`,
    `${A.name} kể cho ${L.name} nghe "tin nóng" về ${called(x)}.`]);
}

// ---------------------------------------------------------------- group_chat (văn chat, không có sếp)
type GTrig = 'boss_left' | 'caught' | 'fired' | 'payday' | 'wifi' | 'server' | 'birthday' | 'deal' | 'release' | 'newhire' | 'random';
function groupTrigger(sc: SC): GTrig {
  if (has(sc, 'wifi', 'mất mạng', 'rớt mạng', 'mạng chập')) return 'wifi';
  if (has(sc, 'sập server', 'server sập', 'sự cố server', 'sập rồi')) return 'server';
  if (has(sc, 'cho nghỉ', 'đuổi việc', 'bị đuổi', 'nghỉ việc', 'ôm thùng', 'thôi việc')) return 'fired';
  if (has(sc, 'quả tang', 'bị sếp bắt', 'sếp bắt', 'bị bắt gặp', 'bị sếp mắng', 'bị sếp nhắc')) return 'caught';
  if (has(sc, 'lương về', 'ngày lương', 'nhận lương', 'trả lương', 'có lương')) return 'payday';
  if (has(sc, 'sinh nhật')) return 'birthday';
  if (has(sc, 'người mới', 'gia nhập', 'nhân viên mới', 'tuyển được')) return 'newhire';
  if (has(sc, 'chốt deal', 'chốt hợp đồng', 'ký hợp đồng', 'deal')) return 'deal';
  if (has(sc, 'release', 'phát hành', 'ra mắt', 'hoàn thành dự án', 'bàn giao dự án')) return 'release';
  if (has(sc, 'sếp') && has(sc, 'ra ngoài', 'đi vắng', 'vừa đi', 'đi rồi', 'rời văn phòng', 'vắng', 'đi đánh golf', 'đi gặp')) return 'boss_left';
  // sếp đang đi công chuyện (ghi chú có giờ dự kiến về) — không tính lúc sếp chưa tới / đã về nhà
  if (sc.ctx?.bossAway && /dự kiến về/u.test(sc.ctx.bossNote ?? '') && chance(0.3)) return 'boss_left';
  return 'random';
}
const G: Record<GTrig, { open: Tpl[]; mid: Tpl[]; close: Tpl[]; self?: Tpl[] }> = {
  boss_left: {
    open: [
      (c) => `${c.crowd} ơi sếp ra ngoài rồi 🎉`,
      (c) => `báo động xanh: sếp đã rời tòa nhà 🟢`,
      (c) => `ổng vừa xách cặp đi rồi kìa ${c.crowd}`,
      (c) => `sếp đi rồi nha ${c.crowd}, thở được rồi 😌`,
    ],
    mid: [
      (c) => (c.sc.bossNoteLow ? `nghe nói ${c.sc.bossNoteLow}` : null),
      (c) => `ai order trà sữa hông, ${c.me} gom đơn nè 🧋`,
      (c) => `tranh thủ đánh một ván bóng bàn hông ae 🏓`,
      (c) => `nhớ canh cửa nha, ổng về bất tử lắm`,
      (c) => `lần trước ổng nói đi hai tiếng mà 30 phút sau quay về 😭`,
      (c) => `ai làm thì làm, ${c.me} nghỉ mắt 5 phút 😴`,
      (c) => `${c.me} vẫn đang chạy deadline nha, đừng rủ ${c.me} 🙂`,
      (c) => `có ai thấy ổng cầm áo khoác hông, cầm là đi lâu đó`,
      (c) => (c.sc.cast.some((p) => p.role === 'hr') ? null : `còn ${c.hrRef} ở đây đó, bình tĩnh nha mn 😅`),
      (c) => `ai đi mua bánh mì không, ${c.me} đi ké 🥖`,
      (c) => `${c.me} mở nhạc nhỏ nhỏ được không ae 🎶`,
      (c) => `hôm nay ổng đi xa, chắc chiều mới về 🙏`,
    ],
    close: [
      (c) => `ok ai thấy xe ổng thì nhắn nhóm liền nha`,
      (c) => `thôi ${c.me} làm tiếp đây, deadline không đi golf được 🥲`,
      (c) => `nhớ nha, ổng về là ai đang lướt TikTok thì tự giác 😂`,
    ],
  },
  caught: {
    open: [
      (c) => (c.x && c.x.id !== c.s.id ? `ủa vụ hồi nãy sao rồi ${c.xn}? 👀` : null),
      (c) => (c.x && c.x.id !== c.s.id ? `nghe nói ${c.xn} bị sếp bắt quả tang hả mn 😱` : null),
      (c) => `ai bị bắt hồi nãy vậy, ${c.me} nghe ổng nói lớn lắm`,
    ],
    self: [
      (c) => `toang thật sự, đang ${c.sc.subjAct} thì ổng đứng sau lưng 😭`,
      (c) => `ổng nói "chúng ta là một gia đình" xong nhìn ${c.me} năm giây 😶`,
      (c) => `${c.me} quê độ quá trời luôn á`,
      (c) => `${c.me} mới mở có hai phút thôi đó, xui gì đâu`,
    ],
    mid: [
      (c) => `trời ơi sao không úp điện thoại xuống`,
      (c) => `lần sau ngồi quay lưng vô tường nha`,
      (c) => `${c.me} nghe tiếng giày ổng là biết rồi kkk`,
      (c) => `có bị ghi sổ không đó 🥲`,
      (c) => `ae lập đội canh gác đi, ${c.me} xung phong ngồi gần cửa 😎`,
      (c) => (c.x && c.x.id !== c.s.id ? `tội ${c.xn} ghê, mới ${c.sc.subjAct} có chút xíu` : null),
    ],
    close: [
      (c) => `thôi coi như bài học, mai mốt có động là nhắn nhóm liền`,
      (c) => `ok giờ ai cũng làm việc nghiêm túc 5 phút nha 😂`,
    ],
  },
  fired: {
    open: [
      (c) => (c.x ? `${c.xn} nghỉ thiệt rồi hả mn 🥲` : `vụ hồi sáng buồn ghê mn 🥲`),
      (c) => (c.x ? `${c.me} vừa thấy ${c.xn} ôm thùng đồ ra cửa, nhìn thương ghê 📦` : `có người ôm thùng ra về rồi kìa mn 📦`),
    ],
    mid: [
      (c) => `buồn ghê, mới hôm qua còn ngồi ăn trưa chung`,
      (c) => `công ty mình là một gia đình mà 😶`,
      (c) => `thôi mn cày KPI đi, không là tới lượt mình`,
      (c) => `nghe nói sắp phỏng vấn người mới đó 👀`,
      (c) => (c.x ? `ai còn giữ liên lạc với ${c.xn} thì hỏi thăm giùm nha` : null),
      (c) => (c.s.role === 'hr' ? `nói trước nha, ${c.me} không có ghi sổ vụ này 🙂` : `bài học: đừng để ${c.hrRef} lấy cuốn sổ ra 😭`),
      (c) => `mai mốt ai cũng nhớ chấm công đầy đủ nha ae`,
      (c) => `cái bàn trống nhìn trống trải ghê 🥲`,
      (c) => `chắc tối nay ${c.me} cày bù KPI quá`,
    ],
    close: [
      (c) => `thôi làm việc đi ae, nhìn bảng KPI mà run`,
      (c) => `tối nay ai rảnh đi ăn chia tay một bữa hông`,
    ],
  },
  payday: {
    open: [
      (c) => `LƯƠNG VỀ RỒI ${c.crowd.toUpperCase()} ƠI 💸`,
      (c) => `tài khoản vừa ting ting 🥹`,
    ],
    mid: [
      (c) => `lương về 5 phút, trả nợ xong còn hai trăm 🥲`,
      (c) => `tối nay đi lẩu hông ae 🍲`,
      (c) => `${c.me} chuyển tiền nhà xong rồi, giờ nghèo lại như cũ`,
      (c) => `đêm nay sale lớn đó, ai săn chung hông 🛒`,
      (c) => `thưởng đâu sếp ơi, "cuối năm tính" là năm nào 😂`,
      (c) => `${c.me} thề tháng này tiết kiệm... từ mai`,
      (c) => `app ngân hàng lag rồi kìa, chắc cả thành phố cùng ngày lương 😂`,
      (c) => `lương về rồi mà giỏ hàng còn dài hơn lương 🛒`,
    ],
    close: [
      (c) => `ok chốt tối nay đi ăn, ai không đi là thiệt`,
      (c) => `thôi làm việc tiếp, lương về rồi phải cày cho xứng 😤`,
    ],
  },
  wifi: {
    open: [
      (c) => `wifi sập rồi hay mạng ${c.me} yếu vậy mn`,
      (c) => `mất mạng nguyên văn phòng hả trời 😭`,
    ],
    mid: [
      (c) => `4G cũng chập chờn nữa 😭`,
      (c) => `không có mạng thì code kiểu gì đây`,
      (c) => `tranh thủ ngủ 15 phút, có mạng gọi ${c.me} nha 😴`,
      (c) => (c.s.role === 'techlead' ? null : `${c.tlRef} đang gọi tổng đài kìa, mặt căng lắm`),
      (c) => `${c.me} phát 4G cho ai cần nè, 5 nghìn một phút kkk`,
      (c) => `tin nhắn này gửi bằng niềm tin đó ae 📶`,
      (c) => `ai rút dây modem để sạc điện thoại thì tự thú đi 🙂`,
    ],
    close: [
      (c) => `có mạng lại rồi kìa, ai nấy về chỗ 🏃`,
      (c) => `thôi ${c.me} đi pha cà phê chờ mạng ☕`,
    ],
  },
  server: {
    open: [
      (c) => `server sập rồi hả, khách gọi cháy máy 🔥`,
      (c) => `ai deploy cuối cùng vậy ae 👀`,
    ],
    mid: [
      (c) => (c.s.role === 'techlead' ? null : `đừng ai hỏi ${c.tlRef} lúc này nha`),
      (c) => `${c.me} vô tội nha, sáng giờ ${c.me} chưa đụng gì hết`,
      (c) => `cầu trời lên lại trước khi sếp biết 🙏`,
      (c) => `khách quán trà sữa gọi ${c.me} ba cuộc rồi 😭`,
    ],
    close: [
      (c) => `lên lại rồi, cảm ơn team dev 🙏`,
      (c) => `chiều nay chắc có họp rút kinh nghiệm, chuẩn bị tinh thần`,
    ],
  },
  birthday: {
    open: [
      (c) => (c.x && c.x.id !== c.s.id ? `hôm nay sinh nhật ${c.xn} nè ae 🎂` : `ae ơi hôm nay có người sinh nhật nè 🎂`),
      (c) => `ai nhớ hôm nay ngày gì hông 🎂`,
    ],
    self: [
      (c) => `ủa mn nói gì vậy, ${c.me} thấy hết á 😂`,
      (c) => `${c.me} không biết gì hết, ${c.me} không đọc gì hết 🙈`,
    ],
    mid: [
      (c) => `góp tiền mua bánh nha, mỗi người 50 nghìn`,
      (c) => `${c.me} lo bánh, ai lo nến với nón giấy?`,
      (c) => `3 giờ chiều tập trung góc chill nha, giữ bí mật đó 🤫`,
      (c) => `${c.me} chuẩn bị bài hát rồi, để ${c.me} hát 🎤`,
    ],
    close: [
      (c) => `chốt kế hoạch, ai lộ bí mật là bao trà sữa cả nhóm`,
      (c) => `ok 3 giờ nha ae, nhớ đó`,
    ],
  },
  deal: {
    open: [
      (c) => (c.x && c.x.id !== c.s.id ? `${c.xn} vừa chốt deal kìa mn 💰` : `team sales vừa chốt deal kìa mn 💰`),
      (c) => `nghe nói có hợp đồng mới về hả ae 💰`,
    ],
    self: [
      (c) => `chuyện nhỏ thôi mà ae 😎`,
      (c) => `tối nay ${c.me} bao trà sữa nha, chịu hông`,
    ],
    mid: [
      (c) => `tối nay bao karaoke hông 🎤`,
      (c) => `deal bao nhiêu vậy, đủ trà sữa cả tháng hông`,
      (c) => `sếp mà biết là có bài phát biểu dài 30 phút 😂`,
      (c) => (c.s.role === 'techlead' || c.s.role === 'senior' ? `lại hứa thêm tính năng gì với khách nữa hả 🙂` : null),
    ],
    close: [
      (c) => `ok chiều nay có trà sữa, ai không uống thì đưa ${c.me}`,
      (c) => `chúc mừng nha, tháng này đỡ bị réo KPI rồi`,
    ],
  },
  release: {
    open: [
      (c) => `release xong rồi, cầu trời đừng có bug production 🙏`,
      (c) => `bản mới lên rồi đó ae 🚀`,
    ],
    mid: [
      (c) => `${c.me} test kỹ rồi nha, có gì đừng réo ${c.me} 🙂`,
      (c) => `tối nay ai trực server vậy 🥲`,
      (c) => `xong dự án này sếp hứa thưởng đó, ai nhớ thì nhắc giùm`,
      (c) => `cuối cùng cũng xong, ${c.me} muốn ngủ ba ngày`,
    ],
    close: [
      (c) => `thôi ai về sớm được thì về đi, mai còn sửa bug 😂`,
      (c) => `ăn mừng nhỏ đi ae, chiều nay order gì đó`,
    ],
  },
  newhire: {
    open: [
      (c) => `người mới vô rồi kìa mn 👀`,
      (c) => (c.x ? `có ai nói chuyện với ${c.xn} chưa 👀` : `ai thấy bạn mới chưa 👀`),
    ],
    mid: [
      (c) => `nhìn hiền ghê, mong là không phải gián điệp của sếp 😂`,
      (c) => `để ${c.me} kết bạn Zalo rủ vô nhóm này`,
      (c) => `khoan, đợi qua thử việc rồi hẵng thêm vô 😅`,
      (c) => `trưa nay rủ người mới đi ăn chung đi`,
    ],
    close: [
      (c) => `ok vậy thôi, ai lo dẫn người mới đi một vòng nha`,
      (c) => (c.s.role === 'hr' ? null : `thôi làm việc, ${c.hrRef} đang dắt người mới đi giới thiệu kìa`),
    ],
  },
  random: {
    open: [
      (c) => `ae ơi tám vụ ${c.topic} chút nè 😆`,
      (c) => `mn nghĩ sao về vụ ${c.topic}`,
      (c) => `có ai hóng chuyện ${c.topic} hông 👀`,
      (c) => (c.sc.topicCat ? pick(CAT_OPEN[c.sc.topicCat])(c) : null),
      (c) => (c.sc.topicCat ? pick(CAT_OPEN[c.sc.topicCat])(c) : null),
    ],
    mid: [
      (c) => `thiệt luôn hả 😳`,
      (c) => `kkk ${c.me} cũng vậy nè`,
      (c) => `thôi đừng nhắc, đau lòng 🥲`,
      (c) => `chuyện thường ngày ở huyện =))`,
      (c) => `ai có hình hông gửi ${c.me} coi với`,
      (c) => `${c.me} cười muốn té ghế luôn 😂`,
      (c) => `ủa rồi sao nữa, kể tiếp đi`,
      (c) => `công nhận, ai cũng vậy hết á`,
    ],
    close: [
      (c) => (c.s.role === 'hr' ? `thôi làm việc đi mn, ${c.me} đi một vòng đây 👀` : `thôi làm việc đi ae, ${c.hrRef} đi ngang kìa 👀`),
      (c) => `ok tối nói tiếp, giờ ${c.me} họp`,
      (c) => `bye ae, ${c.me} đi lấy cà phê ☕`,
      (c) => `thôi ${c.me} out đây, ${c.taskS} đang chờ 🥲`,
      (c) => `để dành chuyện này trưa mai kể tiếp nha`,
      (c) => `sếp mà đọc được nhóm này chắc cả đám nghỉ việc 😂`,
      (c) => `ok giải tán, ai về việc nấy 🫡`.replace('🫡', '👋'),
    ],
  },
};
function bGroup(b: B, sc: SC, fx: FX): string {
  const trig = groupTrigger(sc);
  const pool = G[trig];
  const subject = sc.x ?? sc.named.find((p) => p.role !== 'boss') ?? null;
  sc.x = subject;
  if (subject) sc.subjAct = activityOf(sc, subject, true).label || 'lướt TikTok';
  const inChat = !!subject && sc.cast.some((p) => p.id === subject.id);
  const opener = sc.cast.find((p) => p.id !== subject?.id) ?? sc.cast[0];
  const em = trig === 'fired' ? E.sad : trig === 'payday' || trig === 'deal' ? E.party : E.fun;
  // người được nhắc (bị bắt, có deal, sinh nhật...) chỉ nói câu của riêng mình, không nói câu dành cho người khác
  const avoid = inChat ? subject : null;
  b.say(opener, null, pool.open, { em, pe: 0.3 });
  if (trig !== 'random' && chance(0.3)) b.say(opener, null, pool.mid, { opt: true });
  if (inChat && pool.self && subject) b.say(subject, opener, pool.self, { em: E.sad, pe: 0.3 });
  if (trig === 'random') {
    const cat = sc.topicCat;
    b.say(b.next(), null, cat ? [...CAT_REACT[cat], ...pool.mid] : pool.mid, { em: E.fun, pe: 0.3 });
    b.say(b.next(), null, cat ? CAT_DETAIL[cat] : ACKS, { opt: true });
    b.say(b.next(), null, cat ? [...CAT_JOKE[cat], ...pool.mid] : pool.mid, { opt: true, em: E.fun, pe: 0.3 });
  } else {
    const n = Math.max(2, Math.min(4, sc.cast.length));
    for (let i = 0; i < n; i++) b.say(b.next(avoid), null, pool.mid, { em, pe: 0.25, opt: i >= 2 });
    if (inChat && pool.self && subject && chance(0.6)) b.say(subject, null, pool.self, { opt: true, em: trig === 'caught' ? E.sad : E.fun });
  }
  b.say(b.next(avoid), null, pool.close, { em: E.ok, pe: 0.2 });
  // hiệu ứng
  for (const p of sc.cast) {
    const base = trig === 'payday' ? ri(3, 6) : trig === 'fired' ? -ri(2, 4) : trig === 'caught' && p.id === subject?.id ? -ri(1, 3) : ri(1, 3);
    fx.moodAdd(p, base);
  }
  const pairs = shuffle(pairsOf(sc.cast)).slice(0, 2);
  for (const [p, q] of pairs) bond(fx, p, q, 1, 2, 'tám trong nhóm kín');
  const memoText: Record<GTrig, string> = {
    boss_left: 'Sếp vừa đi, cả nhóm kín rôm rả rủ trà sữa',
    caught: subject ? `Nhóm kín bàn vụ ${subject.name} bị sếp bắt quả tang` : 'Nhóm kín bàn vụ có người bị sếp bắt',
    fired: subject ? `Buồn vì ${subject.name} bị cho nghỉ việc` : 'Buồn vì có đồng nghiệp bị cho nghỉ',
    payday: 'Lương về, cả nhóm kín rủ nhau đi ăn', wifi: 'Mất wifi, cả nhóm than trời trong nhóm kín',
    server: 'Server sập, nhóm kín nháo nhào', birthday: subject ? `Lên kế hoạch sinh nhật bất ngờ cho ${subject.name}` : 'Lên kế hoạch sinh nhật bất ngờ',
    deal: subject ? `Đòi ${subject.name} bao sau khi chốt deal` : 'Nhóm kín mừng có deal mới',
    release: 'Release xong, cầu trời không có bug', newhire: 'Nhóm kín soi người mới',
    random: `Tám vụ ${sc.topic} trong nhóm kín`,
  };
  for (const p of shuffle(sc.cast).slice(0, 2)) fx.memo(p, memoText[trig]);
  const names = joinNames(sc.cast);
  const sum: Record<GTrig, string> = {
    boss_left: `Sếp vừa đi, nhóm kín của ${names} lập tức rôm rả.`,
    caught: `Nhóm kín xôn xao vụ ${subject?.name ?? 'có người'} bị sếp bắt quả tang.`,
    fired: `Nhóm kín buồn thiu vì ${subject?.name ?? 'một đồng nghiệp'} vừa bị cho nghỉ.`,
    payday: `Lương về, nhóm kín của ${names} bàn chuyện tiêu tiền.`,
    wifi: `Mất wifi, ${names} than trời trong nhóm kín.`,
    server: `Server sập, nhóm kín nháo nhào tìm thủ phạm.`,
    birthday: `Nhóm kín bí mật lên kế hoạch sinh nhật cho ${subject?.name ?? 'đồng nghiệp'}.`,
    deal: `Nhóm kín đòi ${subject?.name ?? 'team sales'} bao vì chốt deal.`,
    release: `Release xong, nhóm kín cầu trời đừng có bug.`,
    newhire: `Nhóm kín soi người mới${subject ? ` ${subject.name}` : ''}.`,
    random: `${names} tám vụ ${sc.topic} trong nhóm kín.`,
  };
  return sum[trig];
}

// ---------------------------------------------------------------- company_chat (lịch sự, có sếp)
type CTrig = 'release' | 'deal' | 'newhire' | 'payday' | 'birthday' | 'announce' | 'motivation';
function companyTrigger(sc: SC): CTrig {
  if (has(sc, 'release', 'phát hành', 'ra mắt', 'hoàn thành dự án', 'bàn giao')) return 'release';
  if (has(sc, 'chốt', 'hợp đồng', 'deal')) return 'deal';
  if (has(sc, 'người mới', 'gia nhập', 'chào mừng', 'nhân viên mới')) return 'newhire';
  if (has(sc, 'lương')) return 'payday';
  if (has(sc, 'sinh nhật')) return 'birthday';
  if (has(sc, 'thông báo', 'họp', 'quy định', 'deadline', 'hạn chót')) return 'announce';
  return chance(0.5) ? 'motivation' : 'announce';
}
const C_BOSS_POST: Record<CTrig, Tpl[]> = {
  release: [(c) => `Chúc mừng cả nhà đã hoàn thành ${c.project}! Anh rất tự hào về các em 👏`,
    (c) => `${c.Project} đã lên sóng. Cảm ơn các em đã chiến đấu hết mình! 🚀`],
  deal: [(c) => (c.x ? `Chúc mừng ${c.xn} vừa chốt hợp đồng mới! Cả nhà học tập tinh thần này nhé 💪` : `Công ty vừa có hợp đồng mới! Cảm ơn team sales 💪`),
    (c) => `Tin vui: thêm một khách hàng tin dùng BánNhanh POS. Cả nhà cố gắng phục vụ tốt nhé!`],
  newhire: [(c) => (c.x ? `Chào mừng ${c.x.name} gia nhập đại gia đình ${c.company}! Mọi người giúp đỡ em ấy nhé 🎉` : `Chào mừng thành viên mới gia nhập đại gia đình ${c.company}! 🎉`)],
  payday: [(c) => `Lương tháng này đã về, các em kiểm tra tài khoản nhé. Tháng sau mình cùng bứt phá hơn nữa!`],
  birthday: [(c) => (c.x ? `Chúc mừng sinh nhật ${c.x.name}! Chúc em tuổi mới KPI luôn xanh 🎂` : `Chúc mừng sinh nhật thành viên của gia đình mình! 🎂`)],
  announce: [
    (c) => `Thông báo: sáng thứ Hai họp giao ban 8 giờ, các em đi đúng giờ giúp anh.`,
    (c) => `Anh nhắc lại: ${c.project} ${c.deadline}, cả nhà tập trung nhé.`,
    (c) => `Từ tuần sau công ty chấm công bằng khuôn mặt, ai quên là ${c.hrRef} nhắc nha.`,
    (c) => `Cuối tháng này mình đi team building, ai có ý tưởng địa điểm thì góp ý nhé.`,
    (c) => `Doanh số tháng này mới ${c.sc.revenueText}, team sales tăng tốc giúp anh nhé.`,
    (c) => `Nhắc cả nhà: tắt máy lạnh khi về, tháng này tiền điện cao quá.`,
    (c) => `Chiều nay ${lowerFirst(c.weekday)} anh có khách tới thăm văn phòng, các em dọn bàn gọn gàng giúp anh.`,
    (c) => `Từ nay ai deploy sau 4 giờ chiều phải báo anh trước nhé.`,
  ],
  motivation: [
    (c) => `"Thành công là tổng của những nỗ lực nhỏ lặp lại mỗi ngày." Chúc cả nhà một ngày năng suất! ☀️`,
    (c) => `Chào buổi sáng cả nhà! Hôm nay mình cùng về đích như một cú putt hoàn hảo nhé ⛳`,
    (c) => `Anh vừa gặp đối tác, họ khen sản phẩm của mình lắm. Chúng ta là một gia đình, cùng giữ phong độ nhé!`,
    (c) => `Ai tháng này vượt KPI, anh có quà. Quà gì thì... bí mật 🎁`,
    (c) => `"Khách hàng không mua sản phẩm, khách hàng mua niềm tin." Cả nhà nhớ nhé!`,
    (c) => `${c.weekday} rồi, nạp năng lượng và chiến thôi cả nhà! 💪`,
    (c) => `Golf dạy anh một điều: bình tĩnh thì bóng mới vô lỗ. Làm việc cũng vậy nhé cả nhà.`,
    (c) => `Năm nay mục tiêu của mình là gấp đôi khách hàng BánNhanh POS. Anh tin các em!`,
  ],
};
const C_HR_POST: Tpl[] = [
  (c) => `Phòng Nhân sự xin thông báo: ${c.project} ${c.deadline}, mọi người sắp xếp công việc giúp ${c.me} nha.`,
  (c) => `Nhân sự nhắc mọi người chấm công đầy đủ trước 8 giờ 30 nha ạ.`,
  (c) => `Phòng Nhân sự đang nhận góp ý cho chuyến team building, mọi người phản hồi giúp ${c.me} nha.`,
];
const C_EMO_CHEER = ['🎉', '👏', '🙌', '🥳', '❤️', ''];
const C_EMO_ACK = ['🙏', '👍', '💪', '✅', ''];
/** trả lời tin vui (release, deal, người mới, lương, sinh nhật) */
const C_CHEER: Tpl[] = [
  (c) => `${pick(['Chúc mừng cả team', 'Chúc mừng cả nhà', 'Quá đỉnh luôn', 'Tuyệt vời quá'])}${c.a}! ${pick(C_EMO_CHEER)}`,
  (c) => `${daPre(c)}${c.me} cảm ơn ${c.you}${c.a} ${pick(C_EMO_CHEER)}`,
  (c) => `Nhờ ${c.you} định hướng nên team mới làm được${c.a} ${pick(['🙏', '👏', ''])}`,
  (c) => `${daPre(c)}cả team sẽ cố gắng hơn nữa${c.a}! ${pick(['💪', '🔥', ''])}`,
  (c) => `${pick(['Tin vui quá', 'Hay quá', 'Đỉnh quá'])}${c.a}, ${pick(['tháng này bùng nổ luôn', 'cả nhà xứng đáng', 'phải ăn mừng thôi'])}! ${pick(C_EMO_CHEER)}`,
];
/** trả lời thông báo, câu động lực */
const C_ACK: Tpl[] = [
  (c) => `${daPre(c) || 'Dạ, '}${c.me} ${pick(['đã nhận thông tin', 'đã nắm', 'đã đọc', 'ghi nhận'])}${c.a} ${pick(C_EMO_ACK)}`,
  (c) => `${daPre(c)}${c.me} ghi nhớ${c.a}, cảm ơn ${c.you} đã nhắc ${pick(['🙏', ''])}`,
  (c) => `${c.You} nói quá chuẩn luôn${c.a} ${pick(['👏👏', '💯', '🙏'])}`,
  (c) => `${daPre(c)}cả team sẽ cố gắng hết sức${c.a}! ${pick(['💪', ''])}`,
  (c) => `${c.da ? 'Dạ ' : ''}vâng${c.a} ${pick(['👍', '🙏', ''])}`,
  (c) => `${pick(['Rõ', 'Đã rõ', 'Nhận'])}${c.a}! ${pick(C_EMO_ACK)}`,
];
const C_FILL: Tpl[] = [(c) => `${c.da}vâng${c.a} 👍`, (c) => `👍👍`, (c) => `${c.da}${c.me} đã xem${c.a}.`, (c) => `${pick(['💯', '🙏', '👏'])}`];
const C_REPLY_ROLE: Partial<Record<RoleKey, Tpl[]>> = {
  saleslead: [(c) => (c.l.role === 'boss' ? `Sếp đúng là thuyền trưởng của gia đình mình${c.a} 🚢` : null),
    (c) => (c.sc.cheer ? `Có ${c.you} dẫn dắt thì deal nào cũng chốt được${c.a}!` : `${c.da}team sales luôn sẵn sàng${c.a} 💪`)],
  hr: [(c) => (c.sc.cheer ? `Phòng Nhân sự xin chúc mừng cả nhà${c.a} 🎉` : `Phòng Nhân sự xin ghi nhận, ${c.me} sẽ triển khai ngay${c.a}.`),
    (c) => (c.sc.cheer ? null : `${c.da}${c.me} đã cập nhật vào lịch chung của công ty${c.a} 📅`)],
  techlead: [(c) => (c.sc.cheer ? `Cảm ơn team dev. Mong là không có bug.` : `Đã nhận. Team dev sẽ xử lý.`),
    (c) => (c.sc.cheer ? null : `${c.da}miễn là đừng ai hứa thêm tính năng${c.a}.`)],
  junior: [(c) => `${c.da}${c.me} cảm ơn ${c.you}${c.a}, ${c.you} đỉnh quá 🔥`,
    (c) => (c.sc.cheer ? null : `${c.da}${c.me} sẽ cố gắng học hỏi thêm${c.a} 💪`)],
  marketing: [(c) => `${c.da}${c.me} xin phép đăng tin này lên fanpage công ty luôn nha ${c.you} ✨`,
    (c) => (c.sc.cheer ? `${c.da}${c.me} làm clip ăn mừng liền nha ${c.you} 🎬` : `${c.da}${c.me} đã nắm${c.a}, ${c.me} báo cả team marketing ✨`)],
  salesnew: [(c) => `${c.da}${c.me} sẽ cố gắng hơn nữa${c.a} 😅`, (c) => `${c.da}tháng sau ${c.me} hứa có deal${c.a} 💪`,
    (c) => `${c.da}${c.me} đang chăm thêm ${numWord(ri(2, 5))} khách tiềm năng${c.a} 🙏`],
  designer: [(c) => (c.sc.cheer ? `${c.da}${c.me} làm thêm cái ảnh chúc mừng cho đủ vibe nha ${c.you} ✨` : `${c.da}${c.me} đã nhận${c.a} ✨`)],
  qa: [(c) => (c.sc.cheer ? `${c.da}chúc mừng cả team${c.a}, ${c.me} vẫn đang theo dõi bug nha 🙂` : `${c.da}${c.me} đã nhận${c.a} 👍`)],
  senior: [(c) => (c.sc.cheer ? `${c.da}chúc mừng cả nhà${c.a} 👍` : `${c.da}rõ${c.a}.`),
    (c) => (c.sc.cheer ? `${c.da}vui quá, tối nay ngủ ngon rồi${c.a} 😴` : `${c.da}${c.me} đã đọc${c.a} 👌`)],
};
const C_WRONG: Tpl[] = [
  (c) => `ổng nói vậy chứ thưởng có bao giờ thấy đâu 🙄`,
  (c) => `lại "cuối năm tính" nữa rồi ae ơi 😂`,
  (c) => (c.sc.cheer ? `vậy chắc tối nay có nhậu ha ae 😂` : `họp 8 giờ sáng thứ Hai là hết ngủ nướng rồi 😭`),
];
const C_OOPS: Tpl[] = [
  (c) => `Ấy chết, ${c.me} nhắn nhầm nhóm${c.a}, ${c.me} xin lỗi ${c.you} 🙏`,
  (c) => `${c.da}${c.me} lỡ tay${c.a}! Tin vừa rồi ${c.me} định gửi cho bạn ${c.me} 🙏`,
];
const C_FORGIVE: Tpl[] = [
  (c) => (c.s.role === 'boss' ? `Không sao, anh cũng đang tính chuyện thưởng mà. Cuối năm nhé.` : null),
  (c) => (c.s.role === 'boss' ? `Anh đọc hết rồi đó em. Thôi làm việc đi.` : null),
  (c) => (c.s.role === 'hr' ? `${c.Me} chụp màn hình rồi nha ${c.you} 🙂` : null),
  (c) => (c.s.role !== 'boss' && c.s.role !== 'hr' ? `Thu hồi tin nhắn lẹ đi ${c.you} ơi 😅` : null),
];
const C_BOSS_CLOSE: Tpl[] = [
  mix([(c) => `Cảm ơn các em!`, (c) => `Tốt lắm.`, (c) => `Anh vui lắm.`, (c) => null],
    [(c) => `Cuối năm anh sẽ có chính sách thưởng xứng đáng.`, (c) => `Cố lên cả nhà, chúng ta là một gia đình! ❤️`,
      (c) => `Anh tin năm nay mình sẽ về đích sớm.`, (c) => `Tối nay anh có hẹn với đối tác, các em làm việc chăm chỉ nhé.`,
      (c) => `Tháng sau anh muốn thấy con số còn đẹp hơn.`, (c) => `Ai làm tốt anh đều ghi nhận hết.`]),
];
const C_HR_CLOSE: Tpl[] = [
  (c) => `Cảm ơn mọi người đã phối hợp ạ.`,
  (c) => `Có gì thắc mắc mọi người nhắn riêng ${c.me} nha.`,
];
function bCompany(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const poster = boss ?? sc.cast.find((p) => p.role === 'hr') ?? sc.cast[0];
  const trig = companyTrigger(sc);
  sc.cheer = ['release', 'deal', 'newhire', 'payday', 'birthday'].includes(trig);
  if (!sc.x) sc.x = sc.named.find((p) => p.role !== 'boss') ?? null;
  const staff = sc.cast.filter((p) => p.id !== poster.id);
  b.say(poster, staff[0] ?? null, boss ? C_BOSS_POST[trig] : C_HR_POST, { em: ['📢', '💪', '🎉'], pe: 0.4 });
  const gagger = staff.find((p) => p.traits.humor >= 0.5 && p.role !== 'hr' && p.role !== 'techlead');
  // màn nhắn nhầm cần 3 câu: chỉ diễn khi vẫn đủ chỗ cho mọi người trả lời
  const room = (Number(sc.req.maxLines) || 7) - 5;
  const gag = !!boss && !!gagger && staff.length - 1 <= room && chance(0.15);
  for (const p of shuffle(staff).slice(0, 4)) {
    if (gag && p.id === gagger?.id) continue;
    b.sayPref(p, poster, C_REPLY_ROLE[p.role] ?? [], sc.cheer ? C_CHEER : C_ACK, { em: E.polite, pe: 0.5 }, 0.6);
  }
  if (gag && gagger) {
    const grp = ++grpSeq;
    b.say(gagger, null, C_WRONG, { grp });
    b.say(gagger, poster, C_OOPS, { em: ['😱', '🙏'], pe: 0.6, grp });
    const forgiver = chance(0.6) ? poster : sc.cast.find((p) => p.role === 'hr') ?? poster;
    b.say(forgiver, gagger, C_FORGIVE, { em: E.smile, pe: 0.3, grp });
    fx.moodAdd(gagger, -ri(4, 7));
    fx.memo(gagger, 'Lỡ nhắn nhầm vào nhóm công ty, quê xỉu');
    fx.relAdd(poster, gagger, -ri(2, 4), 'nhắn nhầm nhóm nói xấu');
  }
  b.say(poster, null, boss ? C_BOSS_CLOSE : C_HR_CLOSE, { em: ['❤️', '💪', '🙏'], pe: 0.4 });
  for (const p of staff) fx.moodAdd(p, sc.cheer ? ri(2, 5) : ri(0, 2));
  if (trig === 'deal' && sc.x) fx.memo(sc.x, 'Được sếp khen trong nhóm công ty vì chốt deal');
  if (trig === 'newhire' && sc.x) fx.memo(sc.x, 'Được chào mừng trong nhóm công ty');
  if (trig === 'release') for (const p of staff.filter((q) => TECH_ROLES.includes(q.role))) fx.memo(p, `Được sếp khen vì hoàn thành ${sc.project}`);
  const sum: Record<CTrig, string> = {
    release: `${poster.name} chúc mừng cả nhà hoàn thành ${sc.project} trong nhóm công ty.`,
    deal: `${poster.name} khen ${sc.x?.name ?? 'team sales'} chốt deal trong nhóm công ty.`,
    newhire: `Nhóm công ty chào mừng ${sc.x?.name ?? 'người mới'}.`,
    payday: `${poster.name} báo lương đã về, nhóm công ty cảm ơn rối rít.`,
    birthday: `Nhóm công ty chúc mừng sinh nhật ${sc.x?.name ?? 'đồng nghiệp'}.`,
    announce: `${poster.name} đăng thông báo, nhóm công ty "dạ vâng" đồng loạt.`,
    motivation: `${poster.name} đăng câu truyền động lực, nhân viên thả tim lia lịa.`,
  };
  return gag && gagger ? `${gagger.name} lỡ nhắn nhầm câu than sếp vào nhóm công ty.` : sum[trig];
}

// ---------------------------------------------------------------- standup
const ST_OPEN: Tpl[] = [
  mix([(c) => `Rồi, standup nhanh nha.`, (c) => `Bắt đầu đi.`, (c) => `Ok, vô việc.`, (c) => `Đủ người rồi ha.`],
    [(c) => `Mỗi người một phút thôi.`, (c) => `Hôm qua làm gì, hôm nay làm gì, vướng gì.`,
      (c) => `${c.Project} ${c.deadline}, báo cáo ngắn gọn giùm ${c.me}.`, (c) => `Ai tới trễ thì báo cáo trước nha.`,
      (c) => `Nói ngắn thôi, ${c.me} còn họp với khách.`]),
];
const ST_BOSS_IN: Tpl[] = [
  (c) => `Anh ngồi nghe thôi, các em cứ tự nhiên như ở nhà.`,
  (c) => `Anh ghé xem tinh thần gia đình mình sáng nay thế nào.`,
];
/** báo cáo + phản ứng khớp với nó (qa = QA khịa, tl = lead đáp, dev = dev khác đáp) */
interface StReport { t: Tpl; qa?: Tpl[]; tl?: Tpl[]; dev?: Tpl[] }
const ST_REPORTS: Partial<Record<RoleKey, StReport[]>> = {
  senior: [
    { t: (c) => `Hôm qua ${c.me} xong vụ thanh toán, hôm nay làm tiếp phần báo cáo. Vướng duy nhất là... hết cà phê.`,
      qa: [(c) => `Hết cà phê mà vẫn kịp đánh hai ván bóng bàn ha ${c.you} 🙂`], tl: [(c) => `Cà phê thì tự pha, báo cáo thì chiều nay phải có.`] },
    { t: (c) => `${c.Me} xong 90% rồi, còn 10% khó nhất thôi.`,
      qa: [(c) => `90% đó ${c.you} nói từ thứ Hai rồi 🙂`], tl: [(c) => `${c.L}, 10% còn lại đó là bao lâu?`] },
    { t: (c) => `Task của ${c.me} chạy ngon trên máy ${c.me}, chờ QA test.`,
      qa: [(c) => `Máy ${c.you} chạy được thì ${c.you} giao máy cho khách luôn đi 🙂`], tl: [(c) => `Chạy trên máy ${c.you} chưa tính là xong nha.`] },
    { t: (c) => `Hôm qua ${c.me} refactor, xóa được 500 dòng code thừa, hôm nay nghỉ ngơi chút.`,
      qa: [(c) => `Xóa 500 dòng mà bug vẫn còn nguyên kìa ${c.you} 🙂`], tl: [(c) => `Nghỉ ngơi gì, còn task thanh toán kìa.`] },
    { t: (c) => `Hôm nay ${c.me} làm API báo cáo doanh thu, chiều có bản cho bên QA.`,
      qa: [(c) => `Chiều là chiều mấy giờ, chiều thứ mấy vậy ${c.you} 🙂`], tl: [(c) => `Ok, nhớ viết test luôn.`] },
    { t: (c) => `Hôm qua ${c.me} sửa được ba bug, hôm nay sửa nốt hai cái, không vướng gì.`,
      qa: [(c) => `Ba bug sửa xong đẻ thêm mấy bug vậy ${c.you} 🙂`], tl: [(c) => `Tốt. Chiều gửi PR cho ${c.me} review.`] },
  ],
  junior: [
    { t: (c) => `${c.da}hôm qua ${c.me} làm màn hình đăng nhập, hôm nay làm tiếp... ủa ${c.me} làm gì ta.`,
      tl: [(c) => `Làm tiếp màn hình đăng nhập, xong qua ${c.me} giao việc mới.`] },
    { t: (c) => `${c.da}${c.me} bị kẹt ${c.err} từ hôm qua tới giờ${c.a}.`, tl: [(c) => `Kẹt từ hôm qua sao không hỏi? Họp xong qua bàn ${c.me}.`] },
    { t: (c) => `${c.da}${c.me} làm xong rồi mà chưa test${c.a}.`, tl: [(c) => `Chưa test thì chưa gọi là xong nha ${c.you}.`] },
    { t: (c) => `${c.da}hôm nay ${c.me} viết unit test, lần đầu viết nên hơi run${c.a}.`, tl: [(c) => `Ok, cố lên, có gì hỏi ${c.roleRef('senior')}.`] },
    { t: (c) => `${c.da}hôm qua ${c.me} sửa xong màn hình ${c.screen}, hôm nay ${c.me} làm phần còn lại${c.a}.`,
      tl: [(c) => `Ok, làm xong nhớ tự test trước khi gửi.`] },
  ],
  qa: [
    { t: (c) => `Hôm qua ${c.me} log được ${numWord(ri(5, 9))} bug, ${numWord(ri(2, 4))} cái của ${c.roleRef('senior')} 🙂`,
      dev: [(c) => (c.s.role === 'senior' ? `Sao bug nào cũng ra tên ${c.me} vậy trời?` : `Gửi danh sách đi, ${c.me} xem phụ.`)], tl: [(c) => `Gửi danh sách vô nhóm, chiều xử lý.`] },
    { t: (c) => `Hôm nay ${c.me} test hồi quy ${c.project}, ai merge gì nhớ báo ${c.me}.`, tl: [(c) => `Ok, từ giờ tới chiều không ai merge lung tung.`] },
    { t: (c) => `Vướng của ${c.me} là mấy bug cũ không ai chịu sửa.`, dev: [(c) => `Bug cũ quá thì thành tính năng rồi ${c.you}.`], tl: [(c) => `Gửi lại danh sách, ${c.me} chia người sửa.`] },
    { t: (c) => `${c.Me} test xong luồng thanh toán, còn đúng một lỗi ${c.bug}.`, dev: [(c) => `Lỗi đó chắc tại dữ liệu test thôi.`], tl: [(c) => `Ưu tiên sửa lỗi đó trước.`] },
  ],
  designer: [
    { t: (c) => `${c.Me} làm lại màn hình thanh toán cho đủ vibe, chiều gửi.`, dev: [(c) => `Lần này đừng có animation bay lượn nha.`] },
    { t: (c) => `Hôm nay ${c.me} làm prototype cho khách ${c.client}.`, tl: [(c) => `Gửi sớm để bên dev ước lượng nha.`] },
    { t: (c) => `${c.Me} chỉ xin một điều: dev đừng tự đổi màu nút nữa.`, dev: [(c) => `Màu nào cũng là màu cam mà ${c.you}.`] },
    { t: (c) => `Vướng là khách chưa chốt màu logo, ${c.me} làm năm bản rồi.`, tl: [(c) => `Gửi khách hai bản thôi, đưa năm bản là khách đòi bản thứ sáu.`] },
  ],
  techlead: [
    { t: (c) => `${c.Me} review hết PR tồn, ai chưa sửa comment thì sửa trước trưa.` },
    { t: (c) => `Hôm nay ${c.me} tối ưu database, chiều có thể chậm chút, đừng hoảng.` },
  ],
};
const ST_REPORT_ANY: Tpl[] = [
  (c) => `Hôm qua ${c.me} làm ${c.taskS}, hôm nay làm tiếp, chưa vướng gì.`,
  (c) => `${c.Me} đang làm ${c.taskS}, chiều xong.`,
];
const ST_DEFEND: Tpl[] = [
  (c) => `${c.You} soi kỹ quá, ${c.me} làm không kịp thở.`,
  (c) => `${c.You} test nhẹ tay thôi, app nó cũng biết đau.`,
  (c) => `Rồi rồi, chiều ${c.me} gửi, chịu chưa?`,
];
const ST_BOSS_PUSH: Tpl[] = [
  (c) => `Anh muốn thấy tinh thần chiến đấu! Dự án này xong anh có thưởng.`,
  (c) => `Anh nghe "gần xong" nhiều rồi, anh muốn nghe "xong rồi".`,
  (c) => `Các em nhớ: khách hàng là thượng đế, deadline là thánh chỉ.`,
];
const ST_CLOSE: Tpl[] = [
  mix([(c) => `Rồi, giải tán.`, (c) => `Ok vậy thôi.`, (c) => `Hết giờ.`, (c) => `Xong.`],
    [(c) => `Nhớ: không ai push thẳng lên main.`, (c) => `Ai vướng gì nhắn ${c.me}. Đi làm!`,
      (c) => `${c.Project} mà trễ là cả team ở lại đó nha.`, (c) => `Chiều ${c.me} kiểm tra lại từng người.`,
      (c) => `Bug nào gấp thì xử lý trước trưa.`]),
];
const ST_BOSS_CLOSE: Tpl[] = [
  (c) => `Cố lên các em, chúng ta là một gia đình! Xong dự án anh tính thưởng.`,
  (c) => `Tốt, anh đi gặp đối tác đây, các em tập trung nha.`,
];
function bStandup(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const host = sc.cast.find((p) => p.role === 'techlead') ?? sc.cast.find((p) => p.role === 'senior')
    ?? sc.cast.find((p) => p.role !== 'boss') ?? sc.cast[0];
  b.say(host, null, ST_OPEN, { em: ['📋', '☕'], pe: 0.3 });
  if (boss && chance(0.7)) b.say(boss, host, ST_BOSS_IN, { opt: true, em: E.boss });
  const reporters = shuffle(sc.cast.filter((p) => p.id !== host.id && p.role !== 'boss'));
  const qa = sc.cast.find((p) => p.role === 'qa') ?? null;
  let jabbed: P | null = null;
  let helped: P | null = null;
  for (const p of reporters) {
    const reps = ST_REPORTS[p.role];
    if (!reps) { b.say(p, host, ST_REPORT_ANY, { em: E.ok, pe: 0.3 }); continue; }
    const rep = pick(reps);
    const d = b.say(p, host, [rep.t], { em: p.role === 'junior' ? E.nervous : E.ok, pe: 0.3 });
    if (!d) continue;
    const opts: [P, Tpl[]][] = [];
    if (rep.qa && qa && qa.id !== p.id) opts.push([qa, rep.qa]);
    if (rep.tl && host.role === 'techlead' && host.id !== p.id) opts.push([host, rep.tl]);
    if (rep.dev) {
      const dev = sc.cast.find((q) => (q.role === 'senior' || q.role === 'junior') && q.id !== p.id) ?? (host.role === 'techlead' ? host : null);
      if (dev) opts.push([dev, rep.dev]);
    }
    if (!opts.length || chance(0.25)) continue;
    const [who, pool] = pick(opts);
    const r = b.say(who, p, pool, { opt: true, dep: d, em: who.role === 'qa' ? E.smile : E.tired, pe: 0.3 });
    if (!r) continue;
    if (who.role === 'qa' && p.role === 'senior') {
      jabbed = p;
      if (chance(0.45)) b.say(p, who, ST_DEFEND, { opt: true, dep: r, em: E.annoy, pe: 0.4 });
    }
    if (who.id === host.id && p.role === 'junior') helped = p;
  }
  if (host.role === 'techlead' && b.last()?.sp.id !== host.id && chance(0.4)) b.say(host, null, (ST_REPORTS.techlead ?? []).map((x) => x.t), { opt: true });
  if (boss && chance(0.6)) b.say(boss, null, ST_BOSS_PUSH, { em: E.boss, pe: 0.4 });
  const closer = boss && chance(0.4) ? boss : host;
  b.say(closer, null, closer.role === 'boss' ? ST_BOSS_CLOSE : ST_CLOSE, { em: E.ok, pe: 0.3 });
  if (jabbed && qa) { fx.relAdd(jabbed, qa, -ri(1, 3), 'bị khịa giữa standup'); fx.moodAdd(jabbed, -ri(1, 3)); }
  if (helped) { fx.kpiAdd(helped, ri(2, 4)); fx.relAdd(helped, host, ri(1, 3), 'được hẹn chỉ bài'); fx.memo(helped, `Standup: được ${host.name} hẹn qua chỉ lỗi`); }
  for (const p of sc.cast) if (p.role !== 'boss') fx.kpiAdd(p, ri(0, 2));
  if (boss) for (const p of sc.cast) if (p.id !== boss.id) fx.moodAdd(p, -ri(0, 2));
  fx.memo(host, `Chủ trì standup, ${sc.project} ${sc.deadlineText}`);
  if (jabbed && qa) { fx.memo(qa, `Khịa ${jabbed.name} ngay giữa standup`); fx.memo(jabbed, `Bị ${qa.name} khịa giữa standup`); }
  return pick([`${host.name} chủ trì standup, ${sc.project} ${sc.deadlineText}.`,
    boss ? `Standup có sếp ngồi dự, ai cũng báo cáo "gần xong".` : `Standup sáng nay: ai cũng "sắp xong".`,
    jabbed && qa ? `Standup: ${qa.name} khịa ${jabbed.name} trước cả team.` : `Team dev họp standup, ${host.name} hối deadline ${sc.project}.`]);
}

// ---------------------------------------------------------------- lunch
const LUNCH_OPEN: Tpl[] = [
  (c) => `Trưa nay ăn gì đây ${c.crowd}?`,
  (c) => `${c.Me} mang cơm nhà nè, ai ăn thử trứng chiên hông?`,
  (c) => `Đặt ${c.food} chung hông, đơn trên 200 nghìn là freeship.`,
  (c) => `Đói muốn xỉu, sáng giờ ${c.me} mới uống có ly cà phê.`,
  (c) => `${c.weekday} rồi, ăn gì cho có động lực đi ${c.crowd}.`,
  (c) => `Ai đặt đồ ăn chưa, ${c.me} đói tới mức nhìn bàn phím thành bánh tráng rồi.`,
  (c) => `Trưa nay trời nóng quá, ăn gì mát mát đi ${c.crowd}.`,
];
const LUNCH_FOOD: Tpl[] = [
  (c) => `${c.Me} ăn ${c.anyFood}, nhớ thêm đồ chua nha.`,
  (c) => `${c.Me} đang ăn kiêng... mà thôi, cho ${c.me} một phần ${c.anyFood}.`,
  (c) => `Ăn gì cũng được, miễn đừng ăn chung với deadline.`,
  (c) => `${c.Me} mang cơm mẹ nấu, thịt kho trứng nè, ai ăn ké hông?`,
  (c) => `Hôm qua ăn ${c.anyFood} rồi, nay đổi món đi.`,
  (c) => `Quán ${c.anyFood} đầu hẻm tăng giá lên 50 nghìn rồi đó.`,
  (c) => `Cho ${c.me} một ly ${c.drink} nữa, ăn xong phải có nước.`,
  (c) => `Hôm nay ${c.me} ăn ${c.anyFood}, ăn xong chắc ngủ gật luôn.`,
  (c) => `Quán ${c.anyFood} hôm qua giao trễ một tiếng, ${c.me} xỉu.`,
  (c) => `${c.Me} tính ăn salad, mà thấy ${c.anyFood} thơm quá nên thôi.`,
];
const LUNCH_CLOSE: Tpl[] = [
  (c) => `Ăn lẹ còn ngủ trưa 15 phút nữa.`,
  (c) => `Ai rửa hộp thì rửa giùm ${c.me} luôn nha, hihi.`,
  (c) => (c.bossHere ? `Thôi dọn dẹp, bàn bừa quá rồi.` : `Thôi dọn dẹp, sếp mà thấy bàn bừa là có bài phát biểu.`),
  (c) => `No quá, chiều nay chắc ${c.me} gục trên bàn phím.`,
  (c) => `Mai đi ăn ${c.anyFood} nha, ${c.me} chốt rồi đó.`,
  (c) => `Ăn xong nhớ bỏ rác đúng chỗ nha, hôm qua bị nhắc rồi đó.`,
  (c) => `${c.Me} đi pha ly cà phê chống buồn ngủ đây.`,
];
function bLunch(b: B, sc: SC, fx: FX): string {
  const cast = sc.cast;
  b.say(cast[0], null, LUNCH_OPEN, { em: ['🍜', '🍱', '😋'], pe: 0.4 });
  if (cast.length < 2) { b.say(cast[0], null, LUNCH_FOOD); return `${cast[0].name} ăn trưa một mình ở pantry.`; }
  b.say(b.next(), null, LUNCH_FOOD, { em: ['😋', '🤤'], pe: 0.3 });
  if (cast.length > 2) b.say(b.next(), null, LUNCH_FOOD, { opt: true });
  const A = b.next();
  const Bp = cast.find((p) => p.id !== A.id && p.id !== b.last()?.sp.id) ?? cast.find((p) => p.id !== A.id) ?? A;
  let rumorText = '';
  const allowRumor = (sc.req.allowedEffects ?? []).includes('rumor');
  if (sc.req.rumor && sc.x && allowRumor && !cast.some((p) => p.id === sc.x?.id)) {
    const r = rumorFor(sc, sc.x); rumorText = r.text;
    const teller = cast.find((p) => p.traits.gossip >= 0.6) ?? A;
    const listener = cast.find((p) => p.id !== teller.id) ?? Bp;
    tellRumor(b, teller, listener, sc.x, r.text, r.isNew);
    b.say(listener, teller, GOSSIP_SHOCK, { em: E.shock, pe: 0.4, x: sc.x });
    fx.rumor = { aboutId: sc.x.id, text: r.text };
    fx.memo(listener, `Nghe ${teller.name} kể lúc ăn trưa: ${cut(r.text, 60)}`);
  } else {
    topicBeat(b, A, Bp, 4);
  }
  if (cast.length >= 3 && chance(0.6)) {
    const p = b.next();
    const q = cast.find((o) => o.id !== p.id && o.id !== b.last()?.sp.id) ?? cast.find((o) => o.id !== p.id);
    if (q) relationBeat(b, p, q);
  }
  b.say(b.next(), null, LUNCH_CLOSE, { em: E.happy, pe: 0.3 });
  for (const [p, q] of pairsOf(cast)) bond(fx, p, q, 1, 3, 'ăn trưa chung');
  for (const p of cast) {
    fx.moodAdd(p, ri(2, 5));
    fx.memo(p, rumorText ? `Ăn trưa với ${joinNames(othersOf(sc, p))}, nghe tin đồn về ${sc.x?.name}` : `Ăn trưa với ${joinNames(othersOf(sc, p))}, tám vụ ${sc.topic}`);
  }
  const names = joinNames(cast);
  return rumorText ? `${names} ăn trưa, tranh thủ "cập nhật" tin đồn về ${sc.x?.name}.`
    : pick([`${names} ăn trưa ở pantry, tám vụ ${sc.topic}.`, `Bữa trưa của ${names} xoay quanh chuyện ${sc.topic}.`]);
}

// ---------------------------------------------------------------- số liệu KPI để nói
function kpiPct(p: P): number {
  const a = p.a;
  if (!a || !(a.kpiTarget > 0)) return 0;
  return Math.round((100 * (a.kpiToday || 0)) / a.kpiTarget);
}
function histText(p: P): string {
  const low = Number.isFinite(CONFIG.kpiLowRatio) ? CONFIG.kpiLowRatio : 0.7;
  const last = (p.a?.kpiHistory ?? []).slice(-2);
  // chỉ trích lịch sử khi nó thật sự thấp; HR bị gọi tên vì hôm nay chậm (vd bấm "HR xét KPI")
  // mà mấy ngày trước vẫn 136%, 176% thì nói con số hôm nay — tránh câu "KPI 176% rồi 136% là chị phải gặp em"
  if (!last.length || last.some((x) => !(x.ratio < low))) return `${kpiPct(p)}%`;
  const h = last.map((x) => `${pctOf(x.ratio)}%`);
  return h.length === 2 ? `${h[0]} rồi ${h[1]}` : h[0];
}

// ---------------------------------------------------------------- boss_catch
const CATCH_OPEN: Record<ActInfo['kind'], Tpl[]> = {
  nap: [
    (c) => `${c.L}! Dậy dậy, đây là văn phòng chứ đâu phải khách sạn!`,
    (c) => `${c.L} ơi, ngủ ngon hông em? Mơ thấy KPI chưa?`,
    (c) => `Ủa ${c.L}, mới ${c.time} mà đã ngủ rồi hả em?`,
  ],
  pingpong: [
    (c) => `Bóng bàn giờ hành chính hả các em?`,
    (c) => `Cú giật đẹp đó ${c.L}, giờ giật giùm anh cái KPI coi.`,
    (c) => `${c.L}, anh tưởng mình là công ty phần mềm chứ đâu phải câu lạc bộ bóng bàn?`,
  ],
  chill: [
    (c) => `${c.L}, sofa này anh mua cho khách ngồi chứ đâu phải cho em nằm.`,
    (c) => `${c.L}, chill dữ ha, tưởng đang ở resort chứ.`,
  ],
  slack: [
    (c) => `${c.L}! Giờ này em đang ${c.sc.victimAct} hả?`,
    (c) => `Ủa ${c.L}, màn hình em sao toàn ${c.sc.victimAct} vậy?`,
    (c) => `Anh đứng sau lưng em ba phút rồi đó ${c.L}.`,
    (c) => `Khoan, cho anh hỏi: ${c.sc.victimAct} là công việc hả em?`,
  ],
  none: [
    (c) => `${c.L}, anh thấy hết rồi nha.`,
    (c) => `Anh đứng sau lưng em ba phút rồi đó ${c.L}.`,
  ],
};
const CATCH_EMOTE: Record<string, Tpl[]> = {
  '🛒': [(c) => `Săn sale giờ làm hả ${c.L}? Giỏ hàng đầy hơn KPI luôn ha.`],
  '🎮': [(c) => `Game gì mà nhập tâm dữ vậy ${c.L}, lên rank gì rồi?`],
  '📈': [(c) => `Xem chứng khoán hả ${c.L}? Xanh hay đỏ? Anh thấy KPI em đỏ lè.`],
  '🪙': [(c) => `Coin lên chưa ${c.L}? KPI của em thì chưa thấy lên.`],
  '📺': [(c) => `${c.L}, phim gì mà hay hơn công việc vậy em?`],
  '⚽': [(c) => `Tỉ số bao nhiêu rồi ${c.L}? KPI của em thì đang thua đậm.`],
  '💬': [(c) => `Chat với ai mà cười tủm tỉm vậy ${c.L}?`],
  '🛍️': [(c) => `Xem livestream bán hàng hả ${c.L}? Công ty mình bán phần mềm mà em.`],
};
/** [lời chống chế của nhân viên, câu sếp đáp lại đúng lời đó] */
const CATCH_RESEARCH: Pair = [(c) => `${c.da}${c.me} đang nghiên cứu hành vi khách hàng trên mạng xã hội${c.a}.`,
  [(c) => `Nghiên cứu gì mà cười to vậy em?`, (c) => `Nghiên cứu xong rồi thì gọi khách giùm anh.`]];
const CATCH_BUILD: Pair = [(c) => `${c.da}${c.me} đang chờ build${c.a}, build lâu quá trời.`,
  [(c) => `Build gì mà build trên điện thoại vậy em?`, (c) => `Chờ build thì đọc tài liệu, đừng có lướt.`]];
const CATCH_PAIRS_ROLE: Partial<Record<RoleKey, Pair[]>> = {
  salesnew: [CATCH_RESEARCH, [(c) => `${c.da}khách nhắn hỏi giá, ${c.me} đang tham khảo giá thị trường${c.a}.`,
    [(c) => `Tham khảo xong chưa? Giờ gọi lại cho khách đi.`, (c) => `Thị trường nào mà có nhạc nền vui vậy em?`]],
    [(c) => `${c.da}${c.me} đang chờ khách ${c.client} gọi lại${c.a}.`, [(c) => `Chờ thì gọi khách khác, danh sách dài lắm mà.`]],
    [(c) => `${c.da}${c.me} vừa gọi xong 20 cuộc, nghỉ xíu${c.a}.`, [(c) => `20 cuộc hả? Lát anh hỏi tổng đài coi nha.`]]],
  saleslead: [CATCH_RESEARCH],
  senior: [CATCH_BUILD, [(c) => `${c.da}${c.me} nghỉ mắt theo quy tắc 20-20-20${c.a}.`,
    [(c) => `Quy tắc gì mà nghỉ mắt bằng cách nhìn điện thoại vậy em?`]],
    [(c) => `${c.da}${c.me} đang đọc tài liệu kỹ thuật trên điện thoại cho tiện${c.a}.`, [(c) => `Tài liệu gì mà có nhạc vui vậy em?`]]],
  junior: [CATCH_BUILD, [(c) => `${c.da}${c.me} đang tìm cách sửa lỗi trên mạng${c.a}.`, [(c) => `Sửa lỗi gì mà cười tủm tỉm vậy em?`]]],
  techlead: [[(c) => `${c.da}${c.me} đang chờ chạy test${c.a}.`, [(c) => `Test chạy thì em chạy theo nó đi chứ.`]]],
  designer: [
    [(c) => `${c.da}${c.me} đang lấy cảm hứng thiết kế${c.a}.`, [(c) => `Cảm hứng lấy đủ chưa? Giờ vẽ ra cho anh coi.`]],
    [(c) => `${c.da}đây là moodboard đó sếp.`, [(c) => `Moodboard gì toàn ảnh đồ ăn vậy em?`]],
  ],
  marketing: [
    [(c) => `${c.da}đây là nghiên cứu trend cho chiến dịch mới đó sếp!`,
      [(c) => `Nghiên cứu thì nghiên cứu, mà nghiên cứu ít thôi em.`, (c) => `Trend nào mà xem hoài chưa thấy ra clip vậy em?`]],
    [(c) => `${c.da}${c.me} đang khảo sát đối thủ${c.a}.`, [(c) => `Đối thủ của mình bán quần áo hả em?`]],
  ],
  qa: [[(c) => `${c.da}${c.me} đang test app trên điện thoại thật${c.a}.`, [(c) => `App mình có màn hình nhảy múa hả em?`]],
    [(c) => `${c.da}${c.me} đang chờ dev sửa bug để test lại${c.a}.`, [(c) => `Chờ thì viết thêm test case đi em.`]]],
  hr: [[(c) => `${c.da}${c.me} đang xem hồ sơ ứng viên trên mạng${c.a}.`, [(c) => `Ứng viên nào mà livestream bán hàng vậy em?`]]],
};
const CATCH_PAIRS_KIND: Partial<Record<ActKind, Pair[]>> = {
  nap: [
    [(c) => `${c.da}${c.me}... ${c.me} đang suy nghĩ giải pháp với mắt nhắm${c.a}.`, [(c) => `Giải pháp có kèm tiếng ngáy hả em?`]],
    [(c) => `${c.da}${c.me} mới chợp mắt có một phút thôi${c.a}.`, [(c) => `Một phút mà in luôn vết bàn phím lên má vậy em?`]],
  ],
  pingpong: [
    [(c) => `${c.da}tụi ${c.me} đang vận động cho tỉnh táo${c.a}.`, [(c) => `Tỉnh rồi thì về bàn làm việc giùm anh.`]],
    [(c) => `${c.da}tụi ${c.me} đang team building mini${c.a}.`, [(c) => `Team building thì anh tổ chức, không phải em.`]],
  ],
  chill: [
    [(c) => `${c.da}${c.me} đau lưng quá nên nằm thẳng lưng xíu${c.a}.`, [(c) => `Đau lưng thì đi khám, đừng nằm sofa của khách.`]],
    [(c) => `${c.da}${c.me} đang ngồi nghĩ ý tưởng${c.a}.`, [(c) => `Ý tưởng đâu, nói anh nghe thử một cái coi.`]],
  ],
};
const CATCH_PAIRS_ANY: Pair[] = [
  [(c) => `${c.da}${c.me} xem có một chút xíu thôi${c.a}.`, [(c) => `Chút xíu của em dài ghê ha.`]],
  [(c) => `${c.da}${c.me} vừa làm xong task, nghỉ hai phút${c.a}.`, [(c) => `Hai phút của em dài ghê ha.`, (c) => `Xong task nào, đưa anh coi thử.`]],
];
const CATCH_SERMON: Tpl[] = [
  (c) => (c.sc.victimAct ? `Chúng ta là một gia đình, mà gia đình thì không ai ${c.sc.victimAct} lúc ${c.time} cả.`
    : `Chúng ta là một gia đình, mà gia đình thì phải làm việc chứ em.`),
  (c) => `Đánh golf mà mất tập trung một giây là bóng xuống hồ, làm việc cũng vậy đó em.`,
  (c) => `KPI hôm nay của em mới ${c.sc.victimKpi}% đó, em biết không?`,
];
const CATCH_PROMISE: Tpl[] = [
  (c) => `${c.da}${c.me} xin lỗi, ${c.me} làm liền${c.a}.`,
  (c) => `${c.da}lần sau ${c.me} không dám nữa${c.a}.`,
  (c) => `${c.da}${c.me} tắt liền, ${c.me} tắt liền${c.a}.`,
  (c) => `${c.da}${c.me} quay lại làm ngay${c.a}, ${c.me} hứa.`,
  (c) => `${c.da}${c.me} biết lỗi rồi${c.a}.`,
];
const CATCH_THIRD: Tpl[] = [
  (c) => `Còn ${c.L} nữa, đừng tưởng anh không thấy.`,
  (c) => `${c.L}, em cũng vậy luôn hả?`,
];
const CATCH_THIRD_REPLY: Tpl[] = [
  (c) => `${c.da}${c.me}... ${c.me} đang hỗ trợ bạn${c.a}.`,
  (c) => `${c.da}${c.me} đi ngang qua thôi${c.a}!`,
  (c) => `${c.da}${c.me} về chỗ liền${c.a}.`,
];
const CATCH_CLOSE: Tpl[] = [
  mix([(c) => `Lần này anh bỏ qua.`, (c) => `Thôi được.`, (c) => `Anh nhắc lần cuối.`, (c) => null],
    [(c) => `Lần sau anh nhờ ${c.hrRef} nói chuyện với em.`, (c) => `Cuối ngày gửi anh báo cáo những gì em làm được hôm nay.`,
      (c) => `Anh tin em làm được, đừng phụ lòng gia đình mình.`, (c) => `Làm việc đi em. Anh đi một vòng nữa rồi quay lại đó.`,
      (c) => `Chiều nay anh muốn thấy KPI của em nhích lên.`]),
];
function bCatch(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? sc.cast[0];
  const victim = sc.cast.find((p) => p.id !== boss.id) ?? boss;
  const third = sc.cast.find((p) => p.id !== boss.id && p.id !== victim.id) ?? null;
  const act = activityOf(sc, victim, true);
  sc.victimAct = act.label;
  sc.victimKpi = kpiPct(victim);
  const opens = [...CATCH_OPEN[act.kind], ...(act.emote && CATCH_EMOTE[act.emote] ? CATCH_EMOTE[act.emote] : [])];
  b.say(boss, victim, opens, { em: ['😠', '👀', '😤'], pe: 0.6 });
  const special = act.kind === 'nap' || act.kind === 'pingpong' || act.kind === 'chill'
    ? CATCH_PAIRS_KIND[act.kind] ?? [] : CATCH_PAIRS_ROLE[victim.role] ?? [];
  const kindSpecific = act.kind === 'nap' || act.kind === 'pingpong' || act.kind === 'chill';
  b.pair(victim, boss, kindSpecific && special.length ? special : chance(0.75) && special.length ? special : [...special, ...CATCH_PAIRS_ANY],
    { em: E.nervous, pe: 0.7 }, { em: E.boss, pe: 0.3 });
  if (chance(0.45)) b.say(boss, victim, CATCH_SERMON, { opt: true, em: E.boss, pe: 0.3 });
  if (third) {
    b.say(boss, third, CATCH_THIRD, { em: ['👀'], pe: 0.5 });
    b.say(third, boss, CATCH_THIRD_REPLY, { em: E.nervous, pe: 0.6 });
  }
  b.say(victim, boss, CATCH_PROMISE, { opt: true, em: E.nervous, pe: 0.5 });
  b.say(boss, victim, CATCH_CLOSE, { em: E.boss, pe: 0.3 });
  const doing = sc.victimAct ? `đang ${sc.victimAct}` : 'lơ là';
  for (const v of third ? [victim, third] : [victim]) {
    const main = v.id === victim.id;
    fx.moodAdd(v, -(main ? ri(6, 10) : ri(3, 6)));
    fx.kpiAdd(v, -(main ? ri(3, 6) : ri(1, 3)));
    fx.relAdd(v, boss, -(main ? ri(2, 4) : ri(1, 2)), 'bị bắt quả tang');
    fx.memo(v, main ? `Bị sếp bắt quả tang ${doing} lúc ${sc.time}, quê độ` : `Bị sếp bắt chung với ${victim.name}`);
  }
  fx.relAdd(boss, victim, -ri(2, 4), `bắt gặp ${doing} giờ làm`);
  fx.memo(boss, `Bắt quả tang ${victim.name} ${doing}${third ? ` cùng ${third.name}` : ''}`);
  return pick([
    `Sếp ${boss.name} bắt quả tang ${victim.name} ${doing}${third ? `, ${third.name} bị vạ lây` : ''}.`,
    `${victim.name} bị sếp bắt tại trận${sc.victimAct ? ` khi đang ${sc.victimAct}` : ''}, viện cớ không ai tin.`,
  ]);
}

// ---------------------------------------------------------------- boss_call
function bossCallMode(sc: SC, emp: P): 'praise' | 'scold' | 'task' {
  if (has(sc, 'khen', 'dẫn đầu', 'top kpi', 'cao nhất', 'xuất sắc', 'tuyên dương')) return 'praise';
  if (has(sc, 'kpi thấp', 'thấp nhất', 'đội sổ', 'nhắc nhở', 'mắng', 'chấn chỉnh', 'phê bình')) return 'scold';
  if (has(sc, 'giao việc', 'việc gấp', 'nhiệm vụ', 'nhờ việc', 'giao task', 'việc riêng')) return 'task';
  const a = emp.a;
  if (a && a.kpiTarget > 0) {
    const expect = clamp(((sc.ctx?.minuteOfDay ?? 600) - 480) / 570, 0.15, 1);
    const r = (a.kpiToday || 0) / a.kpiTarget / expect;
    if (r >= 1.15) return chance(0.7) ? 'praise' : 'task';
    if (r <= 0.6) return chance(0.75) ? 'scold' : 'task';
  }
  return pick(['task', 'task', 'praise', 'scold'] as const);
}
const BC_HI: Tpl[] = [(c) => `Ngồi đi ${c.L}.`, (c) => `${c.L} nè.`, (c) => `Vô đây ${c.L}.`, (c) => `${c.L}, vô đây anh nói cái này.`];
const BC: Record<string, Tpl[]> = {
  praiseOpen: [
    mix(BC_HI, [
      (c) => `Anh xem bảng KPI thấy em đang dẫn đầu đó.`,
      (c) => (c.sc.victimKpi >= 60 ? `KPI hôm nay em đạt ${c.sc.victimKpi}% rồi, giỏi lắm.` : `Dạo này em làm tốt lắm, anh để ý hết đó.`),
      (c) => `Khách ${c.client} vừa gọi khen em đó, biết chưa?`,
      (c) => `Mấy hôm nay anh thấy em đi sớm về muộn, tốt lắm.`,
      (c) => `Hôm nay anh không la đâu, yên tâm.`,
      (c) => `Anh nghe ${c.hrRef} khen em quá trời.`,
    ]),
  ],
  praiseReply: [
    (c) => `${c.da}${c.me} cảm ơn sếp, ${c.me} chỉ cố làm tốt việc của mình thôi${c.a}.`,
    (c) => `${c.da}nhờ sếp dẫn dắt hết${c.a}!`,
    (c) => `${c.da}${c.me} cũng không ngờ luôn${c.a}.`,
    (c) => `${c.da}${c.me} cảm ơn sếp, cả team giúp ${c.me} nhiều lắm${c.a}.`,
    (c) => `${c.da}nghe sếp khen mà ${c.me} hết mệt luôn${c.a}.`,
    (c) => `${c.da}${c.me} sẽ cố giữ phong độ${c.a}.`,
  ],
  praiseBoss: [
    mix([(c) => `Em là tấm gương cho cả gia đình mình đó.`, (c) => `Cứ giữ phong độ nha.`, (c) => `Anh định giao em kèm thêm mấy bạn khác nữa.`,
      (c) => `Làm tốt vậy là ${c.project} kịp hạn chắc luôn.`, (c) => `Anh mà có mười người như em là khỏe.`],
    [(c) => `Cuối năm anh tính cho em.`, (c) => `Tháng này anh có quà.`, (c) => `Để anh nói ${c.hrRef} ghi nhận.`, (c) => null, (c) => null]),
  ],
  praiseCheeky: [
    (c) => (c.prevHas('cuối năm') ? `${c.da}"tính" là tính thưởng hả sếp${c.a}?` : null),
    (c) => (c.prevHas('cuối năm') ? `${c.da}cuối năm là năm nay hả sếp${c.a}?` : null),
    (c) => (c.prevHas('tấm gương') ? `${c.da}tấm gương thì có được tăng lương không sếp${c.a}?` : null),
    (c) => (c.prevHas('kèm') ? `${c.da}kèm thêm thì có... thêm lương không sếp${c.a}?` : null),
    (c) => (c.prevHas('quà') ? `${c.da}quà là tiền hả sếp${c.a}?` : null),
    (c) => (c.prevHas('mười người') ? `${c.da}vậy sếp trả lương mười người cho ${c.me} được hông${c.a}?` : null),
    (c) => (c.prevHas('ghi nhận') ? `${c.da}ghi nhận bằng phong bì được hông sếp${c.a}?` : null),
  ],
  praiseCheekyAny: [
    (c) => `${c.da}vậy... có thưởng không sếp${c.a}?`,
    (c) => `${c.da}khen vầy là ${c.me} tính chuyện tăng lương được chưa sếp${c.a}?`,
  ],
  praiseEnd: [
    (c) => `...Thôi em về làm tiếp đi, anh còn cuộc gọi với đối tác.`,
    (c) => `Tất nhiên rồi, anh nói là làm. Mà để anh tính đã.`,
    (c) => `Làm tiếp đi em, anh tin em.`,
    (c) => `Ừ... chuyện đó mình bàn sau. Giờ anh phải đi gặp khách.`,
    (c) => `Em này lanh ghê. Thôi về làm đi, anh còn họp.`,
  ],
  scoldOpen: [
    mix(BC_HI, [
      (c) => `KPI hôm nay của em mới có ${c.sc.victimKpi}%, em giải thích anh nghe coi.`,
      (c) => `Anh hỏi thật, dạo này em có chuyện gì không?`,
      (c) => `Anh nhìn bảng KPI mà đau đầu quá em ơi.`,
      (c) => `Anh muốn nói chuyện thẳng với em chút.`,
      (c) => `Mới ${c.time} mà KPI em đứng chót bảng rồi đó.`,
    ]),
  ],
  scoldExcuse: [
    (c) => (isSales(c.s) ? `${c.da}tại khách hôm nay toàn hẹn lại${c.a}.` : null),
    (c) => (isSales(c.s) ? `${c.da}khách ${c.client} đang cân nhắc, chắc mai ký${c.a}.` : null),
    (c) => (TECH_ROLES.includes(c.s.role) ? `${c.da}task khó quá, ${c.me} đang tìm hiểu${c.a}.` : null),
    (c) => (TECH_ROLES.includes(c.s.role) ? `${c.da}${c.me} bị kẹt ${c.err} từ sáng${c.a}.` : null),
    (c) => `${c.da}sáng nay ${c.sc.excuse} nên ${c.me} tới trễ${c.a}.`,
    (c) => `${c.da}${c.me} đang dồn sức cho buổi chiều${c.a}.`,
    (c) => `${c.da}bữa nay ${c.me} hơi mệt${c.a}.`,
  ],
  scoldBoss: [
    (c) => `Anh không cần lý do, anh cần kết quả.`,
    (c) => `Chúng ta là một gia đình, nhưng gia đình cũng có KPI em à.`,
    (c) => `Hồi anh mới ra trường, anh làm gấp ba vậy đó.`,
    (c) => `Đánh golf mà cứ đổ tại gió thì không bao giờ vô lỗ được đâu em.`,
    (c) => `Lý do thì anh nghe nhiều rồi, anh muốn nghe tin vui.`,
    (c) => `${c.Project} ${c.deadline}, ai cũng phải chạy hết sức đó em.`,
  ],
  scoldPromise: [
    (c) => `${c.da}${c.me} hứa chiều nay sẽ cải thiện${c.a}.`,
    (c) => `${c.da}${c.me} sẽ cố gắng hơn${c.a}.`,
    (c) => `${c.da}chiều nay ${c.me} làm bù${c.a}.`,
    (c) => `${c.da}${c.me} hiểu rồi, mai sếp nhìn bảng sẽ thấy khác${c.a}.`,
  ],
  scoldEnd: [
    (c) => `Chiều nay anh muốn thấy con số khác. Đi đi em.`,
    (c) => `Anh tin em. Đừng để ${c.hrRef} phải mời em lên phòng họp nha.`,
    (c) => `Ừ, về làm đi. Anh theo dõi đó.`,
    (c) => `Được, anh cho em thêm cơ hội. Đừng phụ lòng anh.`,
  ],
  taskOpen: [
    (c) => (isDev(c.l) || c.l.role === 'qa' ? `${c.L}, em coi giúp anh sao điện thoại anh không vào được wifi.` : null),
    (c) => (isDev(c.l) ? `${c.L}, khách ${c.client} muốn thêm ${c.feature}, em xem làm được không.` : null),
    (c) => (c.l.role === 'designer' ? `${c.L}, em làm giúp anh cái thiệp mời sự kiện công ty, nhìn cho sang.` : null),
    (c) => (c.l.role === 'designer' ? `${c.L}, logo công ty mình làm lại cho nó... thịnh vượng hơn được không em?` : null),
    (c) => (isSales(c.l) ? `${c.L}, chiều nay em đi gặp khách thay anh, anh bận... gặp đối tác.` : null),
    (c) => (isSales(c.l) ? `${c.L}, em gọi lại cho khách ${c.client}, nói anh đang họp nha.` : null),
    (c) => (c.l.role === 'marketing' ? `${c.L}, em quay giúp anh clip anh phát biểu, đăng lên fanpage.` : null),
    (c) => (c.l.role === 'marketing' ? `${c.L}, em viết bài về buổi anh đánh golf với đối tác, gọi là "kết nối chiến lược".` : null),
    (c) => (c.l.role === 'qa' ? `${c.L}, em test giúp anh cái app đặt sân golf này, anh đặt hoài không được.` : null),
    (c) => (c.l.role === 'hr' ? `${c.L}, em lên kế hoạch team building giúp anh, chỗ nào có sân golf càng tốt.` : null),
    (c) => `${c.L}, em làm giúp anh cái slide giới thiệu BánNhanh POS, chiều nay gặp đối tác.`,
    (c) => `${c.L}, em in giúp anh 50 bản hợp đồng, chiều nay cần.`,
    (c) => `${c.L}, em đặt giúp anh bàn ăn trưa mai cho sáu người, chỗ nào sang sang.`,
    (c) => `${c.L}, em tóm tắt giúp anh tình hình ${c.project}, anh cần báo cáo nhà đầu tư.`,
  ],
  taskReply: [
    (c) => `${c.da}chiều nay luôn hả sếp${c.a}?`,
    (c) => `${c.da}${c.me} làm liền${c.a}.`,
    (c) => `${c.da}cái này... có tính vào KPI không sếp${c.a}?`,
    (c) => `${c.da}gấp cỡ nào vậy sếp${c.a}?`,
    (c) => `${c.da}để ${c.me} sắp xếp, trước 4 giờ có liền${c.a}.`,
  ],
  taskBoss: [
    (c) => (c.prevHas('kpi') ? `Tính chứ, tính vào KPI tinh thần.` : `Ừ, anh tin em mà.`),
    (c) => (c.prevHas('chiều nay', 'gấp') ? `Gấp lắm, như cú putt cuối cùng vậy đó em.` : `Ừ, nhanh giúp anh nha.`),
    (c) => `Làm xong báo anh, anh có thưởng... tinh thần.`,
    (c) => (c.prevHas('4 giờ') ? `4 giờ là đẹp. Cảm ơn em.` : `Càng sớm càng tốt nha em.`),
  ],
  taskEnd: [
    (c) => `${c.da}${c.me} hiểu rồi, ${c.me} về làm liền${c.a}.`,
    (c) => `${c.da}vậy ${c.me} xin phép về chỗ${c.a}.`,
    (c) => `${c.da}xong ${c.me} báo sếp liền${c.a}.`,
    (c) => `${c.da}${c.me} đi làm liền đây${c.a}.`,
  ],
};
function bBossCall(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? sc.cast[0];
  const emp = sc.cast.find((p) => p.id !== boss.id) ?? boss;
  const mode = bossCallMode(sc, emp);
  sc.victimKpi = kpiPct(emp);
  if (mode === 'praise') {
    b.say(boss, emp, BC.praiseOpen, { em: E.happy, pe: 0.4 });
    b.say(emp, boss, BC.praiseReply, { em: E.polite, pe: 0.5 });
    b.say(boss, emp, BC.praiseBoss, { em: E.boss, pe: 0.3 });
    if (emp.traits.humor >= 0.55 || chance(0.35)) {
      b.sayPref(emp, boss, BC.praiseCheeky, BC.praiseCheekyAny, { em: E.sly, pe: 0.5 }, 1);
      b.say(boss, emp, BC.praiseEnd, { em: ['😅', '👔'], pe: 0.4 });
    }
    fx.moodAdd(emp, ri(6, 10)); fx.kpiAdd(emp, ri(2, 5)); fx.relAdd(emp, boss, ri(3, 5), 'được sếp khen');
    fx.relAdd(boss, emp, ri(2, 4), 'làm tốt'); fx.memo(emp, 'Được sếp gọi lên khen, hứa "cuối năm tính"'); fx.memo(boss, `Khen ${emp.name} vì KPI tốt`);
    return pick([`Sếp gọi ${emp.name} lên khen, kèm lời hứa thưởng "cuối năm tính".`, `${emp.name} được sếp khen trong phòng, lời hứa thưởng vẫn mơ hồ.`]);
  }
  if (mode === 'scold') {
    b.say(boss, emp, BC.scoldOpen, { em: ['😠', '👔'], pe: 0.5 });
    b.say(emp, boss, BC.scoldExcuse, { em: E.nervous, pe: 0.6 });
    b.say(boss, emp, BC.scoldBoss, { em: E.boss, pe: 0.3 });
    b.say(emp, boss, BC.scoldPromise, { em: E.nervous, pe: 0.4 });
    b.say(boss, emp, BC.scoldEnd, { opt: true, em: E.boss });
    fx.moodAdd(emp, -ri(6, 9)); fx.kpiAdd(emp, ri(0, 2)); fx.relAdd(emp, boss, -ri(2, 4), 'bị sếp gọi lên nhắc KPI');
    fx.memo(emp, `Bị sếp gọi lên nhắc KPI mới ${sc.victimKpi}%`); fx.memo(boss, `Nhắc ${emp.name} vì KPI thấp`);
    return pick([`Sếp gọi ${emp.name} lên phòng hỏi thăm KPI ${sc.victimKpi}%.`, `${emp.name} bị gọi lên phòng sếp vì KPI lẹt đẹt.`]);
  }
  b.say(boss, emp, BC.taskOpen, { em: E.boss, pe: 0.3 });
  b.say(emp, boss, BC.taskReply, { em: E.think, pe: 0.4 });
  b.say(boss, emp, BC.taskBoss, { em: E.boss, pe: 0.3 });
  b.say(emp, boss, BC.taskEnd, { opt: true, em: E.ok });
  fx.moodAdd(emp, ri(-3, 1)); fx.kpiAdd(emp, ri(2, 4)); fx.relAdd(emp, boss, ri(-2, 1), 'bị giao việc gấp');
  fx.memo(emp, 'Bị sếp gọi lên giao thêm việc gấp');
  return pick([`Sếp gọi ${emp.name} lên giao thêm một việc "gấp lắm".`, `${emp.name} lên phòng sếp, về chỗ với thêm một nhiệm vụ.`]);
}

// ---------------------------------------------------------------- hr_warning
const HW: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.You} ngồi đi, đừng căng thẳng, ${c.me} chỉ nói chuyện chút thôi nha.`,
    (c) => `${c.Yn} ơi, ${c.me} mời ${c.you} vô đây vì có mấy con số mình cần nhìn cùng nhau nè.`,
    (c) => `Uống miếng nước đi ${c.you}, rồi mình nói chuyện nhẹ nhàng thôi.`,
    (c) => `Ngồi đi ${c.you}. Chuyện nhỏ thôi mà cần nói cho rõ.`,
    (c) => `${c.You} biết vì sao ${c.me} mời ${c.you} lên đây hông?`,
  ],
  num: [
    (c) => `Mấy ngày gần đây KPI của ${c.you} chỉ đạt ${c.sc.histText}, dưới mức ${c.sc.lowPct}% công ty yêu cầu.`,
    (c) => `${c.Me} xem bảng rồi: ${c.sc.histText}. Con số không biết nói dối đâu ${c.you}.`,
    (c) => (c.sc.warnCount > 0 ? `Đây là lần thứ ${ordWord(c.sc.warnCount + 1)} ${c.me} phải mời ${c.you} lên đây rồi đó.`
      : `KPI ${c.sc.histText} là ${c.me} phải gặp ${c.you} rồi.`),
    (c) => `Bảng KPI ghi ${c.sc.histText}, cả phòng nhìn thấy hết đó ${c.you}.`,
  ],
  excuse: [
    (c) => (c.s.traits.laziness >= 0.6 ? `${c.da}tại mấy hôm nay ${c.sc.excuseDaily}, ${c.me} tới nơi là mệt rồi${c.a}.` : null),
    (c) => (isSales(c.s) ? `${c.da}khách của ${c.me} toàn khách khó, gọi hoài không bắt máy${c.a}.` : null),
    (c) => (isDev(c.s) || c.s.role === 'qa' ? `${c.da}${c.me} bị giao task khó, bug cũ chồng bug mới${c.a}.` : null),
    (c) => (c.s.role === 'designer' || c.s.role === 'marketing' ? `${c.da}khách đổi ý hoài, ${c.me} làm lại năm lần rồi${c.a}.` : null),
    (c) => `${c.da}${c.me} cũng biết, ${c.me} đang cố gắng${c.a}.`,
    (c) => `${c.da}dạo này nhà ${c.me} có chút chuyện${c.a}.`,
    (c) => `${c.da}tuần này ${c.me} hơi mệt, tuần sau ${c.me} bù lại${c.a}.`,
  ],
  steel: [
    mix([(c) => `${c.Me} hiểu.`, (c) => `${c.Me} ghi nhận hết nha.`, (c) => `Ừ, ${c.me} nghe rồi.`, (c) => null],
      [(c) => `Nhưng ai cũng có lý do mà KPI người ta vẫn đủ đó ${c.you}.`, (c) => `Nhưng công ty cần thấy kết quả.`,
        (c) => `Lý do này ${c.me} nghe lần thứ ba rồi đó ${c.you}.`, (c) => `Lý do thì ai cũng có, ${c.me} chỉ cần con số thôi.`]),
  ],
  ack: [
    (c) => `${c.da}${c.me} biết rồi${c.a}...`,
    (c) => `${c.da}có chuyện gì vậy ${c.you}${c.a}?`,
    (c) => `${c.da}${c.me} hơi run${c.a}.`,
  ],
  write: [
    (c) => `${c.Me} ghi vô sổ rồi nha, ${c.you} ký xác nhận giúp ${c.me}.`,
    (c) => `${c.Me} ghi lại: ${c.you} hứa tuần này đạt ít nhất 80% nha.`,
    (c) => `${c.Me} ghi chú vô hồ sơ nha, coi như lần nhắc chính thức.`,
  ],
  promise: [
    (c) => `${c.da}${c.me} hứa sẽ cải thiện${c.a}.`,
    (c) => (c.s.traits.laziness >= 0.6 ? `${c.da}${c.me} sẽ đặt ba cái báo thức${c.a}.` : `${c.da}tuần này ${c.me} sẽ làm bù${c.a}.`),
    (c) => (isSales(c.s) ? `${c.da}từ mai ${c.me} gọi 50 cuộc mỗi ngày${c.a}.` : null),
    (c) => (c.s.traits.humor >= 0.5 && c.s.traits.laziness >= 0.6 ? `${c.da}${c.me} sẽ xóa game khỏi điện thoại... trong giờ làm${c.a}.` : null),
    (c) => `${c.da}${c.me} hiểu rồi, ${c.me} sẽ không để ${c.you} phải nhắc nữa${c.a}.`,
  ],
  close: [
    (c) => `${c.Me} tin ${c.you} làm được. Nhưng nếu tuần sau vẫn vậy thì ${c.me} cũng khó giúp nha.`,
    (c) => `Rồi, ${c.you} về làm việc đi. Nhớ là ${c.me} luôn ở đây... với cuốn sổ.`,
    (c) => `Ráng lên nha ${c.you}, ${c.me} không muốn gặp ${c.you} ở phòng này lần nữa đâu.`,
    (c) => `Ok, vậy thôi. Cuối tuần mình xem lại con số nha ${c.you}.`,
    (c) => `Về làm đi ${c.you}, có gì vướng thì nói ${c.me} sớm.`,
  ],
};
function bHrWarning(b: B, sc: SC, fx: FX): string {
  const hr = sc.cast.find((p) => p.role === 'hr') ?? sc.cast[0];
  const emp = sc.cast.find((p) => p.id !== hr.id && p.role !== 'boss') ?? sc.cast.find((p) => p.id !== hr.id) ?? hr;
  sc.histText = histText(emp);
  sc.warnCount = emp.a?.warnings ?? 0;
  b.say(hr, emp, HW.open, { em: E.smile, pe: 0.4 });
  b.say(emp, hr, HW.ack, { em: E.nervous, pe: 0.4, opt: true });
  b.say(hr, emp, HW.num, { em: ['📋', '📉'], pe: 0.5 });
  b.say(emp, hr, HW.excuse, { em: E.nervous, pe: 0.6 });
  b.say(hr, emp, HW.steel, { em: E.smile, pe: 0.3 });
  b.say(emp, hr, HW.promise, { em: E.sad, pe: 0.4 });
  b.say(hr, emp, chance(0.5) ? HW.write : HW.close, { em: E.smile, pe: 0.3 });
  fx.moodAdd(emp, -ri(6, 9)); fx.relAdd(emp, hr, -ri(3, 5), 'bị nhắc nhở KPI'); fx.relAdd(hr, emp, -ri(0, 2), 'KPI thấp kéo dài');
  fx.memo(emp, `Bị ${hr.name} nhắc nhở KPI (${sc.histText}), đã ký biên bản`);
  fx.memo(hr, `Nhắc nhở ${emp.name} về KPI thấp, lần thứ ${ordWord(sc.warnCount + 1)}`);
  return pick([`${hr.name} mời ${emp.name} lên phòng họp nhắc nhở vì KPI ${sc.histText}.`,
    `${emp.name} bị ${hr.name} nhắc KPI, hứa cải thiện và ký biên bản.`]);
}

// ---------------------------------------------------------------- firing
const FI: Record<string, Tpl[]> = {
  hrOpen: [
    (c) => `${c.You} ngồi đi. Chuyện hôm nay chắc ${c.you} cũng đoán được rồi.`,
    (c) => `${c.Me} đã cân nhắc kỹ lắm rồi ${c.you} à.`,
    (c) => `Mấy tuần qua ${c.me} đã nhắc ${c.you} ${c.sc.warnCount > 0 ? `${numWord(c.sc.warnCount)} lần` : 'mấy lần'} rồi, ${c.you} nhớ hông?`,
    (c) => `${c.You} ngồi đi, ${c.me} nói thẳng luôn cho ${c.you} đỡ hồi hộp nha.`,
    (c) => `Hôm nay ${c.me} mời ${c.you} lên vì một chuyện không vui lắm.`,
  ],
  boss: [
    (c) => `Chúng ta là một gia đình... nhưng đôi khi gia đình cũng phải để mỗi người đi con đường riêng.`,
    (c) => `Anh đánh giá cao sự vui vẻ của em, nhưng con số thì không biết nói dối.`,
    (c) => `Anh cũng buồn lắm, như đánh hụt cú putt cuối vậy.`,
    (c) => `Công ty mình đang cần người chạy nhanh hơn, em hiểu cho anh.`,
  ],
  react: [
    (c) => `${c.da}cho ${c.me} thêm một tuần được không${c.a}?`,
    (c) => `${c.da}${c.me} hiểu, ${c.me} cũng biết mình chưa làm tốt${c.a}.`,
    (c) => `${c.da}vậy... tháng này ${c.me} có được lương đủ không${c.a}?`,
    (c) => `${c.da}${c.me} mới trả góp cái điện thoại hôm qua mà...`,
    (c) => `${c.da}${c.me} đoán trước rồi, mà nghe vẫn buồn${c.a}.`,
    (c) => `${c.da}tuần sau ${c.me} định chăm chỉ lại thiệt đó${c.a}...`,
  ],
  proc: [
    mix([(c) => `${c.You} bàn giao laptop, tài khoản và thẻ ra vào cho ${c.me} trước 5 giờ nha.`,
      (c) => `Chiều nay ${c.you} bàn giao lại máy với tài khoản cho ${c.me} nha.`,
      (c) => `Một tuần nữa thì kết quả cũng vậy thôi ${c.you}, ${c.me} xin lỗi.`],
    [(c) => `Lương và các chế độ ${c.me} chuyển đủ cho ${c.you}, ${c.you} yên tâm.`, (c) => `Giấy tờ ${c.me} làm sẵn rồi.`, (c) => null]),
  ],
  bossEnd: [
    (c) => `Anh tin em sẽ thành công ở môi trường phù hợp hơn.`,
    (c) => `Cửa công ty lúc nào cũng mở... để em ghé chơi.`,
    (c) => `Có gì cần giấy giới thiệu thì cứ nói anh.`,
    (c) => `Đi đâu cũng nhớ là em từng ở trong gia đình này nha.`,
  ],
  hrEnd: [
    (c) => `${c.Me} chúc ${c.you} sớm tìm được chỗ hợp hơn nha.`,
    (c) => `Có gì cần xác nhận kinh nghiệm cứ nhắn ${c.me} nha.`,
    (c) => `${c.Me} tiếc thiệt đó ${c.you}, giữ liên lạc nha.`,
  ],
  empEnd: [
    (c) => `${c.da}${c.me} cảm ơn anh chị thời gian qua. ${c.Me} xin phép đi dọn đồ${c.a}.`,
    (c) => (c.sc.friendRef ? `${c.da}nhắn ${c.sc.friendRef} giùm ${c.me}, tối nay ${c.me} vẫn lên game nha.` : null),
    (c) => (c.sc.deskItem ? `${c.da}cho ${c.me} mang cái ${c.sc.deskItem} về nha${c.a}.` : null),
    (c) => `${c.da}${c.me} hiểu. Chúc công ty mình chốt được thật nhiều deal${c.a}.`,
    (c) => `${c.da}vậy ${c.me} xin phép ra dọn bàn, chào anh chị${c.a}.`,
  ],
};
function bFiring(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const hr = sc.cast.find((p) => p.role === 'hr') ?? sc.cast.find((p) => p.id !== boss?.id) ?? sc.cast[0];
  const emp = sc.cast.find((p) => p.id !== hr.id && p.id !== boss?.id) ?? hr;
  sc.warnCount = emp.a?.warnings ?? 0;
  const friend = Object.entries(emp.a?.relationships ?? {}).filter(([id, r]) => id !== emp.id && r && r.score >= 15)
    .sort((a, z) => z[1].score - a[1].score).map(([id]) => sc.ctx.agents?.[id]).find((a) => a && a.status === 'active');
  sc.friendRef = friend ? refOf(emp, toP(friend)) : '';
  const item = emp.a?.deskItemProductId ? getProduct(emp.a.deskItemProductId) : undefined;
  sc.deskItem = item ? lowerFirst(item.name) : '';
  b.say(hr, emp, FI.hrOpen, { em: E.sad, pe: 0.4 });
  if (boss) b.say(boss, emp, FI.boss, { em: ['😔', '👔'], pe: 0.4 });
  b.say(emp, hr, FI.react, { em: ['😢', '😨', '🥲'], pe: 0.7 });
  b.say(hr, emp, FI.proc, { em: ['📋'], pe: 0.3 });
  if (boss) b.say(boss, emp, FI.bossEnd, { opt: true, em: E.boss });
  else b.say(hr, emp, FI.hrEnd, { opt: true });
  b.say(emp, boss ?? hr, FI.empEnd, { em: ['📦', '🥲'], pe: 0.6 });
  fx.relAdd(emp, hr, -ri(5, 7), 'bị cho nghỉ việc');
  if (boss) { fx.relAdd(emp, boss, -ri(4, 6), 'ký quyết định cho nghỉ'); fx.memo(boss, `Ký quyết định cho ${emp.name} nghỉ việc`); }
  fx.memo(emp, `Bị cho nghỉ việc vì KPI thấp, ôm thùng ra về`);
  fx.memo(hr, `Cho ${emp.name} nghỉ việc vì KPI thấp kéo dài`);
  return pick([`${emp.name} chính thức bị cho nghỉ việc sau chuỗi ngày KPI thấp.`,
    `${hr.name}${boss ? ` và sếp ${boss.name}` : ''} thông báo cho ${emp.name} nghỉ việc, ${emp.name} ôm thùng ra về.`]);
}

// ---------------------------------------------------------------- interview
/** câu hỏi + câu trả lời tốt / dở */
interface QA { q: Tpl; good: Tpl[]; bad: Tpl[] }
const IV_PREV = ['một công ty outsource', 'một startup fintech', 'một agency quảng cáo', 'một chuỗi bán lẻ', 'một công ty game',
  'một công ty phần mềm kế toán'];
const IV_OPEN: Tpl[] = [
  mix([(c) => `Chào ${c.you}, ${c.you} ngồi đi.`, (c) => `Cảm ơn ${c.you} đã tới.`, (c) => `${c.You} uống nước đi, đừng run.`],
    [(c) => `${c.You} giới thiệu sơ về bản thân giúp ${c.me} nha.`, (c) => `Hôm nay mình phỏng vấn vị trí ${c.l.roleLabel} nha.`,
      (c) => `Mình nói chuyện thoải mái thôi, ${c.you} kể ${c.me} nghe về mình đi.`]),
];
const IV_INTRO: Tpl[] = [
  (c) => `${c.da}${c.me} chào anh chị, ${c.me} là ${c.s.fullName}, ${c.s.age} tuổi${c.a}.`,
  (c) => (c.s.role === 'junior'
    ? `${c.da}${c.me} tên ${c.s.fullName}, vừa tốt nghiệp ngành công nghệ thông tin${c.a}.`
    : `${c.da}${c.me} tên ${c.s.fullName}, có ${numWord(clamp(c.s.age - 22, 1, 10))} năm kinh nghiệm làm ${c.s.roleLabel}${c.a}.`),
];
const IV_BG: Tpl[] = [
  (c) => (c.s.role === 'junior' ? `Trước đây ${c.me} thực tập ở ${pick(IV_PREV)}, học được nhiều lắm${c.a}.`
    : `Trước đây ${c.me} làm ở ${pick(IV_PREV)}, học được nhiều lắm${c.a}.`),
  (c) => (c.s.role === 'junior' ? `${c.Me} từng làm đồ án cho ${pick(IV_PREV)}, toàn chạy deadline${c.a}.`
    : `${c.Me} từng làm cho ${pick(IV_PREV)}, dự án toàn chạy deadline${c.a}.`),
];
const IV_WHY: QA = {
  q: (c) => pick([`Vì sao ${c.you} muốn về ${c.company}?`, `${c.You} biết gì về công ty mình chưa?`]),
  good: [(c) => `${c.da}${c.me} nghe nói công ty mình như một gia đình${c.a}.`,
    (c) => `${c.da}quán cà phê gần nhà ${c.me} đang xài BánNhanh POS, ${c.me} thấy hay lắm${c.a}.`],
  bad: [(c) => `${c.da}tại chỗ này gần nhà ${c.me}${c.a}.`, (c) => `${c.da}${c.me} nộp hết mấy chỗ, chỗ mình gọi trước${c.a}.`],
};
const IV_TECH: QA[] = [
  { q: (c) => `Production sập lúc 2 giờ sáng, việc đầu tiên em làm là gì?`,
    good: [(c) => `${c.da}${c.me} xem log trước, cần thì rollback, rồi mới báo cáo${c.a}.`],
    bad: [(c) => `${c.da}${c.me} khởi động lại máy rồi đi ngủ${c.a}.`] },
  { q: (c) => `Em đã bao giờ push thẳng lên main chưa?`,
    good: [(c) => `${c.da}chưa bao giờ, ${c.me} luôn tạo pull request${c.a}.`],
    bad: [(c) => `${c.da}push thẳng cho nhanh mà anh${c.a}?`] },
  { q: (c) => `Code của em bị review 30 comment thì em làm sao?`,
    good: [(c) => `${c.da}${c.me} sửa hết, rồi cảm ơn người review${c.a}.`],
    bad: [(c) => `${c.da}${c.me} nhờ AI sửa giùm${c.a}.`] },
  { q: (c) => `Khi nào thì em dùng cache?`,
    good: [(c) => `${c.da}khi dữ liệu ít đổi mà đọc nhiều${c.a}.`],
    bad: [(c) => `${c.da}web chậm thì ${c.me} xóa cache${c.a}.`] },
];
const IV_QA_ROLE: QA[] = [
  { q: (c) => `Test một cái nút bấm thì em test những gì?`,
    good: [(c) => `${c.da}bấm một lần, bấm hai lần, bấm lúc mất mạng, bấm bằng cùi chỏ luôn${c.a}.`],
    bad: [(c) => `${c.da}bấm thử một lần, chạy là được${c.a}.`] },
  { q: (c) => `Dev nói "không phải bug mà là tính năng" thì em làm sao?`,
    good: [(c) => `${c.da}${c.me} gửi video quay màn hình với các bước tái hiện, để dữ liệu nói chuyện${c.a}.`],
    bad: [(c) => `${c.da}vậy ${c.me} đóng ticket luôn${c.a}.`] },
];
const IV_SALES: QA[] = [
  { q: (c) => `${c.You} bán giúp ${c.me} cây bút này đi.`,
    good: [(c) => `${c.da}cây bút này ký được mọi hợp đồng, ${c.you} cầm nó là chốt deal liền${c.a}.`],
    bad: [(c) => `${c.da}cây bút này... màu xanh, viết được${c.a}.`] },
  { q: (c) => `Khách chê phần mềm mình đắt, ${c.you} trả lời sao?`,
    good: [(c) => `${c.da}${c.me} hỏi khách mỗi ngày mất bao nhiêu đơn vì tính tiền chậm, rồi mới nói giá${c.a}.`],
    bad: [(c) => `${c.da}thì ${c.me} giảm giá thôi${c.a}.`] },
];
const IV_MKT: QA[] = [
  { q: (c) => `${c.You} có kênh TikTok riêng không?`,
    good: [(c) => `${c.da}có, 20 nghìn người theo dõi, chuyên review đồ văn phòng${c.a}.`],
    bad: [(c) => `${c.da}có, mà 12 người theo dõi, toàn người nhà${c.a}.`] },
  { q: (c) => `Clip nào của ${c.you} nhiều view nhất?`,
    good: [(c) => `${c.da}clip "một ngày của dân văn phòng", hơn 300 nghìn view${c.a}.`],
    bad: [(c) => `${c.da}clip con mèo nhà ${c.me}, được 200 view${c.a}.`] },
];
const IV_DESIGN: QA[] = [
  { q: (c) => `${c.You} thấy giao diện app công ty mình sao?`,
    good: [(c) => `${c.da}ổn, nhưng nút thanh toán nên to hơn chút cho dễ bấm${c.a}.`],
    bad: [(c) => `${c.da}${c.me} thấy... chưa đủ vibe lắm${c.a}.`] },
  { q: (c) => `${c.You} mất bao lâu để làm xong một màn hình?`,
    good: [(c) => `${c.da}tùy độ khó, nhưng ${c.me} luôn gửi bản nháp trong ngày${c.a}.`],
    bad: [(c) => `${c.da}tùy cảm hứng, có khi một tuần${c.a}.`] },
];
const IV_LEAD: QA[] = [
  { q: (c) => `Team trễ deadline thì ${c.you} xử lý sao?`,
    good: [(c) => `${c.da}${c.me} chia nhỏ việc, ưu tiên cái khách cần nhất, rồi báo sớm cho sếp${c.a}.`],
    bad: [(c) => `${c.da}${c.me} cho cả team tăng ca tới khi xong${c.a}.`] },
  { q: (c) => `Trong team có người làm chậm thì ${c.you} làm gì?`,
    good: [(c) => `${c.da}${c.me} ngồi riêng hỏi xem vướng chỗ nào rồi kèm thêm${c.a}.`],
    bad: [(c) => `${c.da}${c.me} báo nhân sự liền${c.a}.`] },
];
const IV_SOFT: QA[] = [
  { q: (c) => `${c.You} làm việc nhóm thế nào?`,
    good: [(c) => `${c.da}chưa rõ là ${c.me} hỏi liền, xong việc thì phụ người khác${c.a}.`],
    bad: [(c) => `${c.da}${c.me} thích làm một mình hơn${c.a}.`] },
  { q: (c) => `Bị khách hối deadline thì ${c.you} làm sao?`,
    good: [(c) => `${c.da}${c.me} báo tiến độ rõ ràng, có gì vướng thì nói sớm${c.a}.`],
    bad: [(c) => `${c.da}${c.me} tắt điện thoại cho đỡ áp lực${c.a}.`] },
];
const IV_HRQ: QA[] = [
  { q: (c) => `Nhân viên đi trễ hoài thì ${c.you} xử lý sao?`,
    good: [(c) => `${c.da}${c.me} nói chuyện riêng trước, ghi nhận, rồi mới nhắc nhở${c.a}.`],
    bad: [(c) => `${c.da}${c.me} trừ lương liền${c.a}.`] },
];
const IV_BOSS: QA[] = [
  { q: (c) => `Em có chơi golf không?`,
    good: [(c) => `${c.da}${c.me} chưa chơi, nhưng ${c.me} học nhanh lắm${c.a}.`],
    bad: [(c) => `${c.da}golf là... môn đánh bằng vợt hả anh?`] },
  { q: (c) => `Em hiểu thế nào là "chúng ta là một gia đình"?`,
    good: [(c) => `${c.da}là cùng nhau vượt deadline${c.a}.`],
    bad: [(c) => `${c.da}là... cuối tuần cũng phải đi làm hả anh?`] },
  { q: (c) => `Năm năm nữa em thấy mình ở đâu?`,
    good: [(c) => `${c.da}năm năm nữa ${c.me} muốn là người giỏi nhất team${c.a}.`],
    bad: [(c) => `${c.da}năm năm nữa ${c.me} ngồi ghế của anh${c.a}.`] },
  { q: (c) => `Công ty cần em ở lại tới 9 giờ tối thì em nghĩ sao?`,
    good: [(c) => `${c.da}dự án cần thì ${c.me} ở lại, miễn có trà sữa${c.a}.`],
    bad: [(c) => `${c.da}5 giờ 30 là ${c.me} về, ${c.me} có lớp pickleball${c.a}.`] },
];
const IV_SALARY: Pair = [(c) => `${c.You} mong muốn mức lương bao nhiêu?`, [
  (c) => `${c.da}${c.me} mong mức thỏa thuận, mà thỏa thuận cao một chút${c.a}.`,
  (c) => `${c.da}đủ trả tiền trọ với trà sữa là được${c.a}.`,
  (c) => `${c.da}${c.me} tin công ty sẽ trả xứng đáng${c.a}.`,
]];
const IV_TL_YES: Tpl[] = [(c) => `Cũng tạm. Nhận đi.`, (c) => `Được, tuần đầu anh kèm.`];
const IV_TL_NO: Tpl[] = [(c) => `Về đọc thêm về git đi em.`, (c) => `Haizz, nền tảng còn yếu quá.`];
const IV_HIRE: Tpl[] = [
  (c) => `Ok, ${c.me} thấy ${c.you} phù hợp. Mai ${c.you} đi làm được không?`,
  (c) => `Chào mừng ${c.you} gia nhập ${c.company} nha!`,
];
const IV_BOSS_HIRE: Tpl[] = [(c) => `Chào mừng em đến với gia đình ${c.company}!`, (c) => `Anh thích tinh thần của em. Mai đi làm luôn nhé.`];
const IV_HIRE_ANS: Tpl[] = [
  mix([(c) => `${c.da}${c.me} cảm ơn anh chị nhiều${c.a}!`, (c) => `${c.da}thiệt hả${c.a}? ${c.Me} vui quá!`, (c) => `${c.da}${c.me} cảm ơn${c.a}!`],
    [(c) => `${c.Me} đi làm liền được luôn.`, (c) => `${c.Me} sẽ cố gắng hết sức.`, (c) => `Mai ${c.me} có mặt từ 7 giờ 45.`,
      (c) => `${c.Me} sẽ không làm anh chị thất vọng.`]),
];
const IV_REJECT: Tpl[] = [
  (c) => `Cảm ơn ${c.you} đã tới, ${c.me} sẽ liên hệ lại sau nha.`,
  (c) => `Hôm nay vậy thôi nha ${c.you}, có kết quả ${c.me} báo sau.`,
];
const IV_BOSS_REJECT: Tpl[] = [(c) => `Em còn trẻ, cứ thử thêm nhiều nơi nha.`, (c) => `Anh cảm ơn em, mình giữ liên lạc nhé.`];
const IV_REJECT_ANS: Tpl[] = [
  (c) => `${c.da}${c.me} cảm ơn, ${c.me} chờ tin anh chị${c.a}.`,
  (c) => `${c.da}vâng${c.a}... ${c.me} hiểu rồi.`,
  (c) => `${c.da}${c.me} cảm ơn anh chị đã dành thời gian${c.a}.`,
  (c) => `${c.da}dù sao ${c.me} cũng học được nhiều${c.a}.`,
];
function askQA(b: B, asker: P, cand: P, set: readonly QA[], good: boolean, opt = false): boolean {
  const qa = pick(set);
  const grp = ++grpSeq;
  const q = b.say(asker, cand, [qa.q], { em: E.think, pe: 0.25, grp, opt });
  if (!q) return false;
  b.say(cand, asker, good ? qa.good : qa.bad, { em: good ? E.cool : E.nervous, pe: 0.4, grp, opt });
  return true;
}
function findCastByRole(sc: SC, role: RoleKey, notId: string): P | null {
  return sc.cast.find((p) => p.role === role && p.id !== notId) ?? null;
}
function bInterview(b: B, sc: SC, fx: FX): string {
  const cand = sc.cast.find((p) => p.cand) ?? sc.cast.find((p) => p.id.startsWith('cand_'))
    ?? [...sc.cast].reverse().find((p) => !['hr', 'boss', 'techlead'].includes(p.role)) ?? sc.cast[sc.cast.length - 1];
  const hr = sc.cast.find((p) => p.role === 'hr' && p.id !== cand.id) ?? sc.cast.find((p) => p.id !== cand.id) ?? cand;
  const boss = sc.cast.find((p) => p.role === 'boss' && p.id !== cand.id) ?? null;
  const tl = sc.cast.find((p) => p.role === 'techlead' && p.id !== cand.id) ?? null;
  const hired = chance(cand.traits.diligence < 0.35 ? 0.6 : 0.8);
  const good = (): boolean => (hired ? chance(0.85) : chance(0.3));
  b.say(hr, cand, IV_OPEN, { em: E.smile, pe: 0.3 });
  b.say(cand, hr, IV_INTRO, { em: E.nervous, pe: 0.5 });
  b.say(cand, hr, IV_BG, { opt: true });
  if (chance(0.6)) askQA(b, hr, cand, [IV_WHY], good(), true);
  const tech = DEV_ROLES.includes(cand.role) || cand.role === 'qa';
  // câu chuyên môn kỹ thuật chỉ tech lead hỏi; không có tech lead thì hỏi kỹ năng mềm / dẫn dắt
  const techAsker = tech && tl ? tl : tech ? findCastByRole(sc, 'senior', cand.id) : null;
  const set = cand.role === 'techlead' || cand.role === 'saleslead' ? (isSales(cand) ? [...IV_SALES, ...IV_LEAD] : techAsker ? [...IV_TECH, ...IV_LEAD] : IV_LEAD)
    : tech ? (techAsker ? (cand.role === 'qa' ? [...IV_QA_ROLE, ...IV_TECH.slice(0, 2)] : IV_TECH) : (cand.role === 'qa' ? IV_QA_ROLE : IV_SOFT))
      : isSales(cand) ? IV_SALES : cand.role === 'marketing' ? IV_MKT : cand.role === 'designer' ? IV_DESIGN : IV_HRQ;
  const asker = techAsker ?? (boss && chance(0.4) ? boss : hr);
  askQA(b, asker, cand, set, good());
  if (tl && tech && asker.id === tl.id && chance(0.5)) b.say(tl, cand, hired ? IV_TL_YES : IV_TL_NO, { opt: true, dep: b.last() });
  if (boss) askQA(b, boss, cand, IV_BOSS, good());
  if (chance(0.5)) b.pair(hr, cand, [IV_SALARY], { opt: true, em: E.think, pe: 0.2 }, { opt: true, em: E.fun, pe: 0.3 });
  const decider = boss && chance(0.5) ? boss : hr;
  b.say(decider, cand, hired ? (decider.role === 'boss' ? IV_BOSS_HIRE : IV_HIRE) : (decider.role === 'boss' ? IV_BOSS_REJECT : IV_REJECT),
    { em: hired ? E.happy : E.smile, pe: 0.5 });
  b.say(cand, decider, hired ? IV_HIRE_ANS : IV_REJECT_ANS, { em: hired ? E.happy : E.sad, pe: 0.6 });
  fx.verdict = hired ? 'hired' : 'rejected';
  fx.relAdd(hr, cand, hired ? ri(3, 5) : -ri(1, 2), hired ? 'ứng viên tiềm năng' : 'chưa phù hợp');
  fx.relAdd(cand, hr, ri(2, 4), 'phỏng vấn nhẹ nhàng');
  if (boss) fx.relAdd(boss, cand, hired ? ri(2, 4) : -ri(1, 2), hired ? 'có tinh thần' : 'trả lời chưa ưng');
  if (tl) fx.relAdd(tl, cand, hired ? ri(1, 3) : -ri(1, 3), hired ? 'nền tảng ổn' : 'kiến thức còn yếu');
  fx.memo(cand, hired ? `Phỏng vấn vị trí ${cand.roleLabel} ở ${sc.companyShort} và được nhận` : `Phỏng vấn vị trí ${cand.roleLabel}, chờ kết quả`);
  fx.memo(hr, `Phỏng vấn ${cand.name} cho vị trí ${cand.roleLabel}: ${hired ? 'đạt' : 'chưa đạt'}`);
  if (boss) fx.memo(boss, `Phỏng vấn ${cand.name}${hired ? ', nhận vào làm' : ''}`);
  const who = decider.role === 'boss' ? `Sếp ${decider.name}` : decider.name;
  return hired ? pick([`${cand.name} vượt qua buổi phỏng vấn vị trí ${cand.roleLabel}.`, `${who} phỏng vấn ${cand.name} và quyết định nhận vào làm.`])
    : pick([`${cand.name} phỏng vấn vị trí ${cand.roleLabel} nhưng chưa được nhận.`, `Buổi phỏng vấn ${cand.name} kết thúc bằng câu "sẽ liên hệ lại sau".`]);
}

// ---------------------------------------------------------------- incident
const INC_PANIC: Tpl[] = [
  (c) => `Chết rồi!`, (c) => `Toang rồi!`, (c) => `Cứu với!`, (c) => `${c.Yn} ơi!`, (c) => `Báo động đỏ!`, (c) => null,
];
const INC: Record<string, Tpl[]> = {
  alarmDown: [
    mix(INC_PANIC, [(c) => `BánNhanh POS sập rồi, khách gọi quá trời!`, (c) => `Server đỏ lòm hết rồi kìa!`,
      (c) => `Production trả lỗi 500 hết rồi, khách không tính tiền được!`, (c) => `Mấy quán trà sữa báo không in được hóa đơn!`,
      (c) => `Trang quản lý quay vòng vòng mười phút rồi!`]),
  ],
  alarmRelease: [
    mix(INC_PANIC, [(c) => `Bản mới vừa lên là khách báo không in được hóa đơn!`, (c) => `Bug production rồi, lỗi ${c.bug} ngay trên bản mới!`,
      (c) => `Khách gọi quá trời, bản vừa release bị lỗi ${c.bug}!`, (c) => `Bản mới làm báo cáo doanh thu ra toàn số 0!`]),
  ],
  tlAsk: [
    mix([(c) => `Bình tĩnh.`, (c) => `Từ từ.`, (c) => (c.sc.cast.some((p) => p.role === 'boss') ? null : `Haizz.`), (c) => null],
      [(c) => `Ai deploy cuối cùng?`, (c) => `Mở log ra coi.`, (c) => `Hôm nay ai đụng vô database?`, (c) => `Ai push thẳng lên main?!`,
        (c) => `Bị từ mấy giờ vậy?`, (c) => `Báo lỗi gì, chụp màn hình gửi ${c.me} coi.`]),
  ],
  seniorDeny: [
    (c) => `Máy ${c.me} chạy được mà...`,
    (c) => (c.sc.incRelease ? `Trên môi trường test chạy ngon lành mà.` : `Chắc ổ cứng đầy, để ${c.me} dọn log.`),
    (c) => `Không phải ${c.me}, ${c.me} đi cà phê từ nãy tới giờ.`,
    (c) => (c.sc.incRelease ? `Phần đó ${c.me} không đụng tới nha.` : `Chắc bên nhà cung cấp cloud bị gì rồi.`),
    (c) => `${c.Me} chỉ sửa đúng một dòng log thôi mà, đâu có liên quan.`,
  ],
  juniorConfess: [
    (c) => `${c.da}${c.me}... ${c.me} lỡ chạy lệnh cập nhật database trên production${c.a}.`,
    (c) => `${c.da}${c.me} chỉ sửa có một dòng thôi mà${c.a}!`,
    (c) => (c.genz ? `J z trời, ${c.me} xỉu, hình như tại ${c.me}.` : `Hình như tại ${c.me}, ${c.me} xin lỗi.`),
    (c) => `${c.da}hồi nãy ${c.me} có xóa thử một bảng... bảng test thôi mà${c.a}?`,
  ],
  qaTold: [
    (c) => `${c.Me} báo lỗi này từ tuần trước rồi, ticket còn đây nè 🙂`,
    (c) => `Trên môi trường test thì ngon lành mà.`,
    (c) => `Ticket số ${c.ticket}, ${c.me} ghi rõ "nguy hiểm" rồi đó 🙂`,
  ],
  tlCmd: [
    mix([(c) => `Rollback về bản hôm qua!`, (c) => `Tắt tính năng mới đi, chuyển về bản ổn định trước!`,
      (c) => `Không ai đụng gì nữa hết! Từng bước một, rollback trước.`, (c) => `Chuyển sang server dự phòng ngay!`],
    [(c) => (c.sc.fixerName ? `${c.sc.fixerName} khởi động lại service.` : `Khởi động lại service.`), (c) => `Ai rảnh thì báo khách đang bảo trì.`,
      (c) => `Lẹ lên!`, (c) => (c.sc.fixerName ? `${c.sc.fixerName} canh log giùm ${c.me}.` : null)]),
  ],
  working: [
    mix([(c) => `Đang rollback...`, (c) => `Đang khởi động lại...`, (c) => `Đang chuyển qua server dự phòng...`, (c) => `Đang xóa cache...`],
      [(c) => `50%... 90%...`, (c) => `chờ ${c.me} chút...`, (c) => `cầu trời đừng có lỗi gì thêm.`, (c) => `log nhẹ lại rồi.`]),
  ],
  fixed: [
    mix([(c) => `Lên rồi!`, (c) => `Xong!`, (c) => `Ổn rồi!`, (c) => `Sống lại rồi!`],
      [(c) => `Khách vào lại được rồi.`, (c) => `Đơn hàng chạy lại bình thường.`, (c) => `Log xanh lại rồi.`, (c) => `In hóa đơn được rồi.`]),
  ],
  tlClose: [
    mix([(c) => `Chiều nay họp rút kinh nghiệm.`, (c) => `Ghi lại sự cố đi.`, (c) => `Ok, mọi người uống miếng nước đi.`,
      (c) => `Viết báo cáo sự cố trước 5 giờ.`],
    [(c) => `Từ nay cấm deploy sau 4 giờ chiều.`, (c) => `Và nhớ: không ai push thẳng lên main.`, (c) => `Mai viết thêm test cho chỗ này.`,
      (c) => `Lần sau deploy phải có người trực.`, (c) => `Cảm ơn mọi người, hú hồn.`]),
  ],
};
function bIncident(b: B, sc: SC, fx: FX): string {
  const tl = sc.cast.find((p) => p.role === 'techlead') ?? null;
  const senior = sc.cast.find((p) => p.role === 'senior') ?? null;
  const junior = sc.cast.find((p) => p.role === 'junior') ?? null;
  const qa = sc.cast.find((p) => p.role === 'qa') ?? null;
  const boss = tl ?? senior ?? sc.cast[0];
  const fixer = senior && senior.id !== boss.id ? senior : sc.cast.find((p) => p.id !== boss.id) ?? boss;
  sc.fixerName = fixer.id !== boss.id ? fixer.name : '';
  const release = has(sc, 'release', 'bản mới', 'cập nhật', 'bug production', 'phiên bản');
  sc.incRelease = release;
  const alarmBy = junior ?? qa ?? sc.cast.find((p) => p.id !== boss.id) ?? boss;
  b.say(alarmBy, boss, release ? INC.alarmRelease : INC.alarmDown, { em: ['😱', '🔥'], pe: 0.7 });
  b.say(boss, null, INC.tlAsk, { em: ['😤', '🔥'], pe: 0.5 });
  if (senior && senior.id !== boss.id) b.say(senior, boss, INC.seniorDeny, { em: E.nervous, pe: 0.4 });
  let culprit: P | null = null;
  if (junior && junior.id !== boss.id && chance(0.5)) { b.say(junior, boss, INC.juniorConfess, { em: ['😭', '😰'], pe: 0.7 }); culprit = junior; }
  if (qa && qa.id !== boss.id) b.say(qa, boss, INC.qaTold, { opt: true, em: E.smile, pe: 0.5 });
  b.say(boss, null, INC.tlCmd, { em: ['🔥'], pe: 0.4 });
  b.say(fixer, boss, INC.working, { em: ['⌛', '🙏'], pe: 0.4, opt: true });
  b.say(fixer, null, INC.fixed, { em: ['🎉', '😌'], pe: 0.6 });
  b.say(boss, null, INC.tlClose, { em: E.tired, pe: 0.3 });
  for (const p of sc.cast) fx.moodAdd(p, -ri(3, 6));
  fx.kpiAdd(fixer, ri(4, 6)); if (boss.id !== fixer.id) fx.kpiAdd(boss, ri(2, 4));
  if (culprit) { fx.kpiAdd(culprit, -ri(2, 4)); fx.relAdd(boss, culprit, -ri(2, 4), 'gây sự cố production'); fx.relAdd(culprit, fixer, ri(2, 4), 'được cứu bàn thua'); }
  if (qa && senior && qa.id !== boss.id) fx.relAdd(qa, senior, -ri(1, 2), 'bug đã báo mà không sửa');
  for (const p of sc.cast) if (p.id !== culprit?.id && p.id !== boss.id) fx.relAdd(p, boss, ri(1, 2), 'chỉ huy cứu server');
  return release ? `Bản mới vừa lên đã dính bug production, ${boss.name} chỉ huy rollback.`
    : pick([`Server sập, ${boss.name} và ${fixer.name} chạy vào phòng server cứu nguy.`, `Sự cố server: cả team dev toát mồ hôi, ${fixer.name} cứu kịp.`]);
}

// ---------------------------------------------------------------- celebration
type CelReason = 'birthday' | 'payday' | 'release' | 'deal' | 'generic';
function celReason(sc: SC): CelReason {
  if (has(sc, 'sinh nhật')) return 'birthday';
  if (has(sc, 'lương')) return 'payday';
  if (has(sc, 'release', 'phát hành', 'hoàn thành dự án', 'ra mắt', 'xong dự án', 'bàn giao')) return 'release';
  if (has(sc, 'deal', 'hợp đồng', 'chốt')) return 'deal';
  return 'generic';
}
const CEL_OPEN: Record<CelReason, Tpl[]> = {
  birthday: [
    (c) => (c.x && c.x.id !== c.s.id ? `Chúc mừng sinh nhật ${c.xn}! Ước đi rồi thổi nến nè! 🎂` : `Chúc mừng sinh nhật! Ước đi rồi thổi nến nè! 🎂`),
    (c) => (c.x && c.x.id !== c.s.id ? `Cả nhà hát lên nào, hôm nay sinh nhật ${c.xn}!` : `Cả nhà hát lên nào!`),
  ],
  payday: [
    (c) => `Lương về rồi, hôm nay ăn mừng chút, mai ăn mì gói tiếp!`,
    (c) => `Ngày đẹp nhất tháng tới rồi ${c.crowd} ơi!`,
    (c) => `Tài khoản vừa ting ting, ăn mừng thôi ${c.crowd}!`,
  ],
  release: [
    (c) => `Release thành công! Không có bug nào... tính tới giờ này.`,
    (c) => `${c.Project} xong rồi ${c.crowd} ơi, nâng ly trà sữa nào!`,
    (c) => `Cán đích rồi ${c.crowd} ơi! Bàn giao xong cho khách rồi!`,
  ],
  deal: [
    (c) => (c.x && c.x.id !== c.s.id ? `Chúc mừng ${c.xn} chốt hợp đồng! Bao trà sữa cả phòng đi!` : `Chốt deal rồi, ăn mừng thôi ${c.crowd}!`),
    (c) => `Hợp đồng mới về rồi, tháng này đỡ bị réo KPI!`,
  ],
  generic: [
    (c) => `Hôm nay vui quá, ăn mừng chút cho có tinh thần ${c.crowd} ơi!`,
    (c) => `Tranh thủ ăn mừng năm phút rồi làm tiếp nha ${c.crowd}!`,
  ],
};
const CEL_SUBJ: Partial<Record<CelReason, Tpl[]>> = {
  birthday: [
    (c) => `Trời ơi, ${c.me} cảm động quá, cảm ơn ${c.crowd}!`,
    (c) => `Ước gì ${c.me} cũng không nói đâu, nói ra mất linh.`,
    (c) => `Ước được tăng lương, ước KPI tự đủ, ước sếp đi golf mỗi ngày!`,
  ],
  deal: [
    (c) => `Chuyện nhỏ thôi mà, nhờ cả team hỗ trợ đó.`,
    (c) => `Chiều nay ${c.me} bao, ai uống gì ghi vô đi.`,
  ],
};
/** câu tám theo từng lý do ăn mừng (không dành cho sếp) */
const CEL_MID: Record<CelReason, Tpl[]> = {
  birthday: [
    (c) => `Bánh kem này ai chọn mà ngon dữ vậy?`,
    (c) => (c.x && c.x.id !== c.s.id ? `Thổi nến đi ${c.xn}, ước gì cũng được trừ nghỉ việc nha.` : null),
    (c) => `Nến bao nhiêu cây vậy, ${c.me} đếm không kịp.`,
    (c) => `Cắt miếng to cho ${c.me} nha, ${c.me} stress nhất văn phòng.`,
    (c) => (c.x && c.x.id !== c.s.id ? `Tuổi mới chúc ${c.xn} KPI xanh, crush rep tin nhắn nha!` : null),
  ],
  payday: [
    (c) => `Tối nay đi lẩu hông ${c.crowd}?`,
    (c) => `Lương về năm phút, trả nợ xong là hết, mà vẫn vui.`,
    (c) => `Tháng này ${c.me} thề tiết kiệm... bắt đầu từ mai.`,
    (c) => `Ai giữ hóa đơn trà sữa hôm nay thì gửi ${c.me} chia tiền nha.`,
    (c) => `Lương về là ${c.me} trả góp liền, còn lại đúng một ly ${c.drink}.`,
  ],
  release: [
    (c) => `Cuối cùng cũng xong, ${c.me} muốn ngủ ba ngày.`,
    (c) => `Cầu trời khách đừng gọi lúc nửa đêm.`,
    (c) => `Nâng ly trà sữa cho production bình yên!`,
    (c) => `Mấy đêm OT cuối cùng cũng có kết quả.`,
    (c) => `Dự án sau ai lo ước lượng thì ước lượng dư dư ra nha.`,
  ],
  deal: [
    (c) => (c.x && c.x.id === c.s.id ? `Deal này mà không có cả team hỗ trợ thì ${c.me} chịu.` : `Deal bao nhiêu vậy, đủ trà sữa cả tháng hông?`),
    (c) => `Tối nay karaoke ăn mừng luôn!`,
    (c) => `Chốt deal kiểu này mỗi tuần thì tuyệt vời.`,
    (c) => (c.isDevish ? `Nhớ đừng hứa thêm tính năng nào nha, dev xin đó.` : `Doanh số tháng này có hy vọng rồi.`),
  ],
  generic: [
    (c) => `Lâu lâu mới thấy văn phòng vui vầy.`,
    (c) => `Có đồ ăn là ${c.me} có mặt liền.`,
  ],
};
const CEL_ANY: Tpl[] = [
  (c) => `Tối nay đi karaoke tiếp hông ${c.crowd}?`,
  (c) => `Ăn mừng xong ai dọn thì dọn nha, ${c.me} né trước.`,
  (c) => `Ăn mừng vầy mỗi tuần thì ${c.me} chịu khó đi làm sớm.`,
];
const CEL: Record<'boss' | 'close', Tpl[]> = {
  boss: [
    (c) => `Các em thấy chưa, chúng ta là một gia đình! Cuối năm anh còn tổ chức to hơn.`,
    (c) => `Cố lên các em, niềm vui này là của cả gia đình mình.`,
  ],
  close: [
    (c) => `Chụp tấm hình đăng fanpage nè, ${c.crowd} cười lên!`,
    (c) => `Thôi dọn dẹp, ăn mừng mười lăm phút thôi đó.`,
    (c) => `Rồi, ai về chỗ nấy, mai ăn mừng tiếp.`,
    (c) => `Ai còn bụng thì ăn nốt, ${c.me} về chạy deadline đây.`,
    (c) => `Một, hai, ba... cười! Tấm này đăng nhóm công ty nha.`,
  ],
};
function bCelebration(b: B, sc: SC, fx: FX): string {
  const reason = celReason(sc);
  const subj = sc.x && sc.cast.some((p) => p.id === sc.x?.id) ? sc.x
    : sc.named.find((p) => sc.cast.some((q) => q.id === p.id) && p.role !== 'boss') ?? sc.x ?? null;
  sc.x = subj;
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const subjIn = !!subj && sc.cast.some((p) => p.id === subj.id);
  const host = sc.cast.find((p) => p.role === 'marketing' && p.id !== subj?.id)
    ?? sc.cast.find((p) => p.id !== subj?.id && p.role !== 'boss') ?? sc.cast[0];
  const em = reason === 'birthday' ? ['🎂', '🥳', '🎉'] : ['🎉', '🥳', '🙌'];
  b.say(host, subjIn ? subj : null, CEL_OPEN[reason], { em, pe: 0.6 });
  const subjPool = CEL_SUBJ[reason];
  if (subjIn && subj && subjPool) b.say(subj, host, subjPool, { em: E.happy, pe: 0.5 });
  const mids = [...CEL_MID[reason], ...CEL_ANY];
  b.say(b.next(boss), null, CEL_MID[reason], { em: E.fun, pe: 0.4 });
  if (boss) b.say(boss, null, CEL.boss, { em: E.boss, pe: 0.4 });
  b.say(b.next(boss), null, mids, { opt: true, em: E.fun, pe: 0.4 });
  if (sc.cast.length >= 4) b.say(b.next(boss), null, mids, { opt: true, em: em, pe: 0.4 });
  b.say(b.next(boss), null, CEL.close, { em: ['📸', '😄'], pe: 0.4 });
  for (const p of sc.cast) fx.moodAdd(p, ri(4, 8) + (p.id === subj?.id ? 2 : 0));
  for (const [p, q] of shuffle(pairsOf(sc.cast)).slice(0, 4)) bond(fx, p, q, 1, 3, 'ăn mừng chung');
  const what = reason === 'birthday' ? `sinh nhật ${subj?.name ?? 'đồng nghiệp'}` : reason === 'payday' ? 'ngày lương'
    : reason === 'release' ? `hoàn thành ${sc.project}` : reason === 'deal' ? `deal mới${subj ? ` của ${subj.name}` : ''}` : 'một ngày vui';
  for (const p of sc.cast) fx.memo(p, `Ăn mừng ${what} ở góc chill`);
  const who = sc.cast.length > 4 ? `${sc.cast.slice(0, 3).map((p) => p.name).join(', ')} cùng mọi người` : joinNames(sc.cast);
  return pick([`Cả văn phòng tụ tập ăn mừng ${what}.`, `${who} ăn mừng ${what} ở góc chill.`]);
}

// ---------------------------------------------------------------- confront
const CF_DENY: Tpl[] = [
  (c) => `Đâu có, ${c.me} chỉ nghe người ta nói lại thôi mà!`,
  (c) => `Ai nói vậy? ${c.Me} có kể gì đâu, ai thêm mắm thêm muối vậy trời!`,
  (c) => `Thì... ${c.me} nghe ở pantry, tưởng ai cũng biết rồi.`,
  (c) => (c.sc.blameRef ? `${c.Me} nghe ${c.sc.blameRef} nói mà, ${c.me} chỉ kể lại thôi.` : null),
];
/** đính chính theo nội dung tin đồn */
const CF_TRUTH: [RegExp, Tpl[]][] = [
  [/nghỉ|đuổi|thôi việc|nộp cv/iu, [(c) => `${c.Me} vẫn ngồi đây làm việc nè, nghỉ đâu mà nghỉ!`, (c) => `${c.Me} còn đang trả góp, nghỉ sao được mà nghỉ!`]],
  [/hẹn hò|quen|cưới|crush|yêu/iu, [(c) => `${c.Me} với người ta chỉ là đồng nghiệp thôi, đồng nghiệp hiểu chưa!`, (c) => `Hẹn hò gì, tối nào ${c.me} cũng ở nhà chạy deadline!`]],
  [/phỏng vấn|offer|đối thủ|công ty khác/iu, [(c) => `Hôm đó ${c.me} đi khám răng chứ phỏng vấn gì!`, (c) => `${c.Me} mặc đẹp vì đi đám cưới bạn, vậy thôi!`]],
  [/tăng lương|thưởng/iu, [(c) => `Tăng lương đâu ra, tháng này ${c.me} còn bị trừ tiền đi trễ nè!`]],
  [/crypto|coin|lỗ/iu, [(c) => `${c.Me} lỗ có chút xíu, đâu tới mức đó!`]],
  [/tiktok|kol|kênh/iu, [(c) => `Kênh của ${c.me} có 30 người theo dõi, KOL gì trời!`]],
  [/ăn vụng|bánh/iu, [(c) => `Hộp bánh đó ${c.me} mua mà, ăn vụng gì!`]],
];
const CF_TRUTH_ANY: Tpl[] = [
  (c) => `Làm gì có chuyện đó, ai bịa ra vậy trời!`,
  (c) => `Chuyện bé xé ra to, sự thật đâu có vậy.`,
];
const CF_SORRY: Tpl[] = [
  (c) => `Thôi cho ${c.me} xin lỗi, chiều ${c.me} bao ${c.you} ly ${c.drink} nha.`,
  (c) => `${c.da}${c.me} sai rồi, lần sau ${c.me} không kể lung tung nữa.`,
];
const CF_DEFIANT: Tpl[] = [
  (c) => `Không có lửa làm sao có khói hả ${c.you}?`,
  (c) => `Thì cả văn phòng ai cũng nói vậy mà, đâu riêng gì ${c.me}.`,
];
const CF_OK: Tpl[] = [
  (c) => (QUESTION_END.test(c.sc.lines[c.sc.lines.length - 1]?.text ?? '') ? null : `Ừ, lần sau nghe gì thì hỏi thẳng ${c.me} nha.`),
  (c) => (norm(c.sc.lines[c.sc.lines.length - 1]?.text ?? '').includes(norm(c.drink)) ? `${c.Drink} size L, thêm trân châu. Vậy mới huề.` : null),
  (c) => `Thôi được, lần này ${c.me} bỏ qua.`,
];
const CF_BAD: Tpl[] = [
  (c) => `Được, để ${c.me} nhớ vụ này.`,
  (c) => (c.s.role === 'hr' ? null : `Lần sau có chuyện gì ${c.me} hỏi thẳng ${c.hrRef} luôn cho rõ.`),
];
function bConfront(b: B, sc: SC, fx: FX): string {
  const subjId = sc.req.rumor?.aboutId ?? sc.req.aboutId;
  const subject = sc.cast.find((p) => p.id === subjId) ?? sc.cast[0];
  const teller = sc.cast.find((p) => p.id !== subject.id) ?? subject;
  const rumor = (sc.req.rumor?.currentText ?? '').trim().replace(/[.!…]+$/u, '');
  const others = Object.values(sc.ctx.agents ?? {}).filter((a) => a.status === 'active' && a.id !== subject.id && a.id !== teller.id && a.role !== 'boss');
  const blame = others.length ? toP(pick(others)) : null;
  sc.blameRef = blame ? refOf(teller, blame) : '';
  const selfRumor = (c: C): string => {
    for (const head of [`Sếp ${subject.name}`, subject.name]) if (rumor.startsWith(head + ' ')) return c.me + rumor.slice(head.length);
    return softLower(sc, rumor);
  };
  const OPEN: Tpl[] = rumor ? [
    (c) => `Nè ${c.you}, nghe nói ${c.you} đi kể là ${selfRumor(c)} hả?`,
    (c) => `${c.Yn}, ${c.me} nghe phong thanh có người đồn ${selfRumor(c)}. Là ${c.you} phải hông?`,
    (c) => `Ủa ${c.you}, ai nói với ${c.you} là ${selfRumor(c)} vậy?`,
  ] : [
    (c) => `Nè ${c.you}, nghe nói ${c.you} đi kể chuyện của ${c.me} khắp văn phòng hả?`,
    (c) => `${c.Yn}, ${c.me} hỏi thẳng nha: ${c.you} nói gì về ${c.me} ở pantry vậy?`,
  ];
  b.say(subject, teller, OPEN, { em: ['😤', '🤨'], pe: 0.6 });
  b.say(teller, subject, CF_DENY, { em: E.nervous, pe: 0.6 });
  const truth = CF_TRUTH.find(([re]) => re.test(rumor))?.[1] ?? [];
  b.say(subject, teller, truth.length && chance(0.85) ? truth : [...truth, ...CF_TRUTH_ANY], { em: E.annoy, pe: 0.4 });
  const sorry = chance(0.6);
  b.say(teller, subject, sorry ? CF_SORRY : CF_DEFIANT, { em: sorry ? E.polite : E.sly, pe: 0.5 });
  b.say(subject, teller, sorry ? CF_OK : CF_BAD, { em: sorry ? E.ok : E.annoy, pe: 0.4 });
  fx.relAdd(subject, teller, sorry ? -ri(3, 5) : -ri(6, 8), sorry ? 'đi kể chuyện mình, đã xin lỗi' : 'tung tin đồn về mình');
  fx.relAdd(teller, subject, -ri(1, 3), 'bị hỏi tội trước mặt người khác');
  fx.moodAdd(subject, -ri(3, 5)); fx.moodAdd(teller, -ri(4, 6));
  fx.memo(subject, `Đối chất ${teller.name} vì tin đồn${rumor ? `: ${cut(rumor, 50)}` : ''}`);
  fx.memo(teller, `Bị ${subject.name} hỏi tội vì đi kể chuyện`);
  return sorry ? `${subject.name} hỏi tội ${teller.name} vì tin đồn, ${teller.name} xin lỗi rối rít.`
    : `${subject.name} đối chất ${teller.name} vì tin đồn, hai bên chưa ai chịu ai.`;
}

// ---------------------------------------------------------------- pingpong_match
const PP: Record<'open' | 'accept' | 'play' | 'win' | 'lose' | 'close', Tpl[]> = {
  open: [
    (c) => `Ván này thua là bao ${c.drink} nha ${c.you}.`,
    (c) => `Hôm nay ${c.me} luyện cú giật mới, thua bao ${c.drink} nha ${c.you}.`,
    (c) => `Chấp ${c.you} ba điểm nè, thua thì bao ${c.drink}, chịu hông?`,
  ],
  accept: [
    (c) => `Chấp gì, ${c.me} cho ${c.you} thua trắng luôn.`,
    (c) => `Chơi! Tới 11 điểm nha.`,
    (c) => `Nói ít thôi, giao bóng đi.`,
  ],
  play: [
    (c) => `Đỡ nè! Ăn chưa?`,
    (c) => `Ê, bóng chạm lưới mà!`,
    (c) => `${ri(6, 9)}–${ri(2, 5)}, ${c.me} dẫn rồi nha.`,
    (c) => `Smash! Ăn trọn luôn!`,
    (c) => `Khoan khoan, hồi nãy ${c.you} giao bóng sai luật.`,
    (c) => `Bóng ra ngoài rồi, đừng có cãi.`,
    (c) => `Cú này xoáy nè, đỡ được ${c.me} bao luôn!`,
    (c) => `Ui, trúng mép bàn, may mắn thôi nha.`,
  ],
  win: [
    (c) => `Thắng rồi! ${c.Drink} nha ${c.you}.`,
    (c) => `11 điểm! ${c.Drink} của ${c.me} đâu ${c.you}?`,
    (c) => `Xong! ${c.Drink} size L, cảm ơn ${c.you} trước nha.`,
    (c) => `Ván này ${c.me} thắng nha, nhớ ${c.drink} đó.`,
  ],
  lose: [
    (c) => `Tại vợt trơn chứ bộ.`,
    (c) => `Ván phục thù, ngay bây giờ!`,
    (c) => `${c.Me} nhường đó, nể tình đồng nghiệp.`,
    (c) => `Tại đèn chói mắt quá, không tính!`,
    (c) => `Bàn này nghiêng, ${c.me} nói hoài mà không ai sửa.`,
    (c) => `Ba ván thắng hai mới tính chứ.`,
  ],
  close: [
    (c) => `Phục thù thì mai nha, giờ về làm việc đã.`,
    (c) => (c.bossHere ? null : `Nghe tiếng giày ai kìa, giải tán!`),
    (c) => `Thôi về chỗ, ${c.me} còn ${c.taskS} nữa.`,
  ],
};
function bPingpong(b: B, sc: SC, fx: FX): string {
  const A = sc.cast[0], Bp = sc.cast[1] ?? sc.cast[0];
  const wA = 0.5 + (A.id === 'tung' ? 0.25 : 0) - (Bp.id === 'tung' ? 0.25 : 0) + (A.traits.laziness - Bp.traits.laziness) * 0.3;
  const winner = chance(clamp(wA, 0.15, 0.85)) ? A : Bp;
  const loser = winner.id === A.id ? Bp : A;
  const hostile = Math.min(relScore(A, Bp), relScore(Bp, A)) <= -15;
  b.say(A, Bp, PP.open, { em: ['🏓', '😏'], pe: 0.5 });
  b.say(Bp, A, PP.accept, { em: E.cool, pe: 0.4 });
  b.say(loser, winner, PP.play, { em: ['🏓', '😆'], pe: 0.4 });
  b.say(winner, loser, PP.play, { opt: true, em: ['🏓'], pe: 0.3 });
  b.say(winner, loser, PP.win, { em: ['🏆', '😎'], pe: 0.6 });
  b.say(loser, winner, PP.lose, { em: E.annoy, pe: 0.4 });
  b.say(winner, loser, PP.close, { opt: true, em: E.ok, pe: 0.3 });
  fx.moodAdd(winner, ri(4, 6)); fx.moodAdd(loser, hostile ? -ri(1, 3) : ri(0, 2));
  if (hostile) bond(fx, A, Bp, -2, -1, 'khẩu chiến bên bàn bóng');
  else bond(fx, A, Bp, 1, 3, 'đánh bóng bàn vui');
  return pick([`${A.name} và ${Bp.name} đánh bóng bàn, ${winner.name} thắng kèo ${sc.drink}.`,
    `${winner.name} hạ ${loser.name} ở bàn bóng bàn, ${loser.name} đòi phục thù.`]);
}

// ---------------------------------------------------------------- welcome
const WC: Record<'hrIntro' | 'newIntro' | 'mateRole' | 'mateAny' | 'hrPractical' | 'newClose', Tpl[]> = {
  hrIntro: [
    (c) => `${c.Crowd} ơi, đây là ${c.X}, ${c.x?.roleLabel ?? 'thành viên'} mới của mình nha. Mọi người giúp đỡ em ấy nhé.`,
    (c) => `Giới thiệu với ${c.crowd}: ${c.x?.fullName ?? c.X}, từ hôm nay ngồi bàn này nha.`,
  ],
  newIntro: [
    (c) => `${c.da}${c.me} chào anh chị, ${c.me} là ${c.S}, mong anh chị chỉ bảo thêm${c.a}.`,
    (c) => `${c.da}${c.me} hơi run, mong mọi người thương ${c.me}${c.a}.`,
    (c) => `${c.da}${c.me} là ${c.S}, ${c.s.roleLabel}, rất vui được làm việc với mọi người${c.a}.`,
  ],
  mateRole: [
    (c) => (isDev(c.s) ? `Chào ${c.you}, máy lạnh chỗ này lạnh lắm, mai nhớ mang áo khoác.` : null),
    (c) => (isDev(c.s) && c.s.role !== 'techlead' ? `Mật khẩu wifi dán sau màn hình ${c.me} đó, cần thì qua lấy.` : null),
    (c) => (c.s.role === 'junior' ? `Yeah, có người mới, ${c.me} hết làm út rồi!` : null),
    (c) => (c.s.role === 'marketing' ? `Cho ${c.me} xin tấm hình để đăng fanpage chào người mới nha!` : null),
    (c) => (c.s.role === 'qa' ? `Chào ${c.you}, mong là ${c.you} ít bug hơn ai đó 🙂` : null),
    (c) => (c.s.role === 'techlead' ? `Chiều nay ${c.me} gửi tài liệu, đọc trước. Và đừng push thẳng lên main.` : null),
    (c) => (c.s.role === 'saleslead' ? `Chào ${c.you}, có gì cứ hỏi ${c.me}, bí kíp chốt deal ${c.me} chỉ hết.` : null),
    (c) => (c.s.role === 'designer' ? `Bàn ${c.you} hơi trống, để ${c.me} làm cái bảng tên cho đủ vibe.` : null),
    (c) => (c.s.role === 'salesnew' ? `Chào ${c.you}, trưa nay đi ăn chung nha, ${c.me} chỉ quán ngon.` : null),
    (c) => (c.s.age <= 26 && c.l.age <= 30 ? `${c.You} chơi game gì? Tối leo rank chung nha.` : null),
  ],
  mateAny: [
    (c) => `Chào mừng ${c.you} nha, có gì cần cứ hỏi.`,
    (c) => `Chào ${c.you}! Pantry ở cuối phòng, cà phê miễn phí, đừng uống quá ba ly.`,
    (c) => `Chào ${c.you}, ở đây vui lắm, chỉ có deadline là hơi khó tính thôi.`,
    (c) => `Chào ${c.you}! Trưa nay đi ăn chung với mọi người nha.`,
    (c) => `Chào ${c.you}, nhóm chat kín của văn phòng lát ${c.me} thêm vô nha.`,
  ],
  hrPractical: [
    (c) => `Sáng 8 giờ chấm công bằng khuôn mặt, trễ là ${c.me} biết liền nha ${c.you}.`,
    (c) => `Thứ Sáu có trà sữa nếu sales chốt deal, nhớ đó.`,
    (c) => `Có gì không hiểu cứ hỏi ${c.me}, phòng ${c.me} lúc nào cũng mở.`,
    (c) => `Mật khẩu wifi với tài khoản email ${c.me} gửi qua tin nhắn rồi nha.`,
    (c) => `Tuần đầu cứ từ từ làm quen, đừng áp lực quá ${c.you}.`,
  ],
  newClose: [
    mix([(c) => `${c.da}${c.me} cảm ơn mọi người${c.a}!`, (c) => `${c.da}${c.me} cảm ơn anh chị${c.a}.`, (c) => `${c.da}${c.me} thấy ở đây vui ghê${c.a}.`],
      [(c) => `${c.Me} sẽ cố gắng hết sức.`, (c) => `Có gì sai mọi người nhắc ${c.me} nha.`, (c) => `Trưa nay ${c.me} mời mọi người trà sữa!`, (c) => null]),
  ],
};
function bWelcome(b: B, sc: SC, fx: FX): string {
  const hr = sc.cast.find((p) => p.role === 'hr') ?? null;
  const fresh = sc.cast.find((p) => p.id.startsWith('cand_') && p.id !== hr?.id)
    ?? [...sc.cast].filter((p) => p.id !== hr?.id).sort((a, z) => (z.a?.hiredDay ?? 0) - (a.a?.hiredDay ?? 0))[0] ?? sc.cast[0];
  sc.x = fresh;
  const host = hr ?? sc.cast.find((p) => p.id !== fresh.id) ?? fresh;
  const mates = sc.cast.filter((p) => p.id !== fresh.id && p.id !== host.id);
  if (host.id !== fresh.id) b.say(host, fresh, WC.hrIntro, { em: ['👋', '😊'], pe: 0.5, x: fresh });
  b.say(fresh, host, WC.newIntro, { em: E.nervous, pe: 0.5 });
  for (const m of mates.slice(0, 2)) b.sayPref(m, fresh, WC.mateRole, WC.mateAny, { em: ['👋', '😄'], pe: 0.4 }, 0.8);
  if (hr && hr.id !== fresh.id) b.say(hr, fresh, WC.hrPractical, { opt: true, em: E.smile, pe: 0.3 });
  b.say(fresh, null, WC.newClose, { em: E.happy, pe: 0.5 });
  for (const m of sc.cast) if (m.id !== fresh.id) bond(fx, m, fresh, 3, 5, 'chào đón người mới');
  fx.memo(fresh, `Ngày đầu đi làm, được ${joinNames(othersOf(sc, fresh))} chào đón`);
  for (const m of mates) fx.memo(m, `Chào đón người mới ${fresh.name}`);
  if (hr && hr.id !== fresh.id) fx.memo(hr, `Dẫn ${fresh.name} đi giới thiệu với mọi người`);
  return pick([`${host.name} dẫn ${fresh.name} đi chào mọi người ngày đầu đi làm.`, `${fresh.name} ra mắt văn phòng, được cả team chào đón.`]);
}

// ---------------------------------------------------------------- showroom_chat (v2): khoe đồ trên kệ phòng trưng bày
//  Sản phẩm BẮT BUỘC (req.product); pitch = nhận xét thật của chủ dự án ("Mình xài 3 tháng rồi, pin trâu…") →
//  đổi "mình" thành xưng hô của người nói. Đúng 1 câu product:true (người khoe), người kia khịa / hỏi giá mà
//  không ai nói giá / "để tối săn sale".
type SrTpl = (c: C, pn: string, pt: string) => string;
type SrOpenTpl = (c: C, shelf: string) => string;
const UNIT_WORD = /^(inch|ml|mah|cm|kg|gb|hz|w)$/i;
/** "Sạc dự phòng 20.000mAh sạc nhanh" → "Sạc dự phòng": bỏ thông số để gọi kiểu đời thường */
function shortProductName(name: string): string {
  const words = name.trim().split(/\s+/);
  const out: string[] = [];
  for (const [i, w] of words.entries()) {
    if (i > 0 && (/\d/.test(w) || UNIT_WORD.test(w))) break;
    out.push(w);
  }
  return (out.length >= 2 ? out : words).join(' ');
}
/** Nhận xét của chủ dự án → lời của người nói: "Mình xài 3 tháng rồi" → "em xài 3 tháng rồi" */
function noteAs(c: C, note: string): string {
  const t = note.replace(/\s+/g, ' ').trim().replace(/[.!…]+$/u, '');
  if (!t) return 'xài thích lắm';
  return lowerFirst(t.replace(/(?<![\p{L}])(?:mình|tôi|tui)(?![\p{L}])/giu, c.me));
}
const SR_OPEN: SrOpenTpl[] = [
  (c, shelf) => `Ủa ${c.you} cũng ra ngắm ${shelf} hả, tưởng ${c.me} lười một mình.`,
  (c, shelf) => `${cap(shelf)} có đồ mới nè ${c.you}, hồi sáng ${c.me} thấy chưa có.`,
  (c) => `${c.You} đứng đây nãy giờ, định mua hay định ngắm cho đỡ buồn?`,
  (c, shelf) => `Nghỉ tay chút, ra ${shelf} coi đồ cho đỡ mỏi mắt ${c.you}.`,
  (c) => `Trốn việc ra đây ngắm đồ hả? ${c.Me} cũng vậy, đừng nói ai nha.`,
  (c, shelf) => `${c.You} coi ${shelf} này, bày đẹp hơn tủ nhà ${c.me}.`,
  (c, shelf) => `Món nào trên ${shelf} ${c.you} xài rồi, chỉ ${c.me} với.`,
  (c) => `Hồi nãy ${c.me} thấy ${c.you} cầm lên bỏ xuống ba lần rồi đó.`,
  (c) => (c.bossHere ? `Sếp cũng ra ngắm đồ hả, ${c.me} tưởng sếp chỉ ngắm bảng KPI.` : `${c.Me} ra đây năm phút thôi, ${c.you} canh sếp giùm.`),
];
/** mở đầu kiểu "chưa mua" — không dùng khi người mở lời chính là người đã có món (chế độ owner) */
const SR_OPEN_CART: SrOpenTpl[] = [
  (c) => `Ê ${c.you}, cái này ${c.me} để trong giỏ hàng hai tuần rồi đó.`,
];
const SR_PRODUCT: SrTpl[] = [
  (c, pn, pt) => `${c.Me} xài ${pn} được một thời gian rồi, ${pt}.`,
  (c, pn, pt) => `Cái ${pn} này ${c.me} mua rồi nè, ${pt}.`,
  (c, pn, pt) => `Nói thiệt, ${pn} là món ${c.me} ưng nhất kệ này: ${pt}.`,
  (c, pn, pt) => `${c.You} đang cần đúng cái ${pn} này đó, ${pt}.`,
  (c, pn, pt) => `${c.Me} có cái ${pn} y chang ở nhà, ${pt}.`,
  (c, pn, pt) => `Hồi đầu ${c.me} cũng nghi, mua ${pn} về mới thấy ${pt}.`,
  (c, pn, pt) => `Món này ${c.me} xài lâu rồi mới dám khen: ${pn}, ${pt}.`,
  (c, pn, pt) => `${c.Yn} nhìn cái ${pn} kìa, ${pt}.`,
  (c, pn, pt) => `Đừng lướt qua cái ${pn} nha, ${pt}, ${c.me} nói thiệt.`,
  (c, pn, pt) => `Cái ${pn} đó hả? ${cap(pt)}, ${c.me} không nói dóc đâu.`,
];
// nghi ngờ / bênh: phần chung + phần theo việc người khoe ĐÃ CÓ món (owner) hay chưa — người chưa có không được nói "xài rồi"
const SR_DOUBT: Tpl[] = [
  (c) => `Nghe như đọc quảng cáo vậy ${c.you}, hoa hồng bao nhiêu?`,
  (c) => `${c.You} khen cái gì cũng hay, hôm bữa khen ${c.item} giờ nó nằm xó rồi.`,
  (c) => `Bao nhiêu vậy? Thôi khỏi nói, nhìn mặt ${c.you} là ${c.me} biết lương ${c.me} không đủ.`,
  (c) => `Để tối ${c.me} lên app săn sale coi, giờ mà chốt là lỗ.`,
  (c) => `${c.You} mà đi bán hàng chắc giàu hơn làm ở đây.`,
  (c) => `Nghe ham quá mà ví ${c.me} đang kêu cứu.`,
  (c) => `Lại dụ ${c.me} tiêu tiền nữa hả, tháng này ${c.me} ăn mì gói rồi đó.`,
  (c) => `Để ${c.me} lưu vô giỏ hàng, bao giờ sale thì tính.`,
];
const SR_DOUBT_OWNER: Tpl[] = [
  (c) => `Thiệt hông đó, hay ${c.you} được shop gửi đồ review?`,
  (c) => `${c.Me} nghi lắm, đồ nào mới mua ai cũng khen tuần đầu.`,
  (c) => `Khoan, cái này ${c.you} xài thiệt hay coi review rồi nói lại?`,
];
const SR_DOUBT_NEW: Tpl[] = [
  (c) => `Chưa xài mà khen như đúng rồi, mua về rồi kể ${c.me} nghe.`,
  (c) => `Ủa ${c.you} chưa mua mà rành dữ vậy, coi review nhiều quá rồi đó.`,
];
const SR_DEFEND: Tpl[] = [
  (c) => `Tiền nào của nấy ${c.you}, mua cái rẻ xài hai tuần hư còn tốn hơn.`,
  (c) => `${c.Me} đâu có ép, mua hay không tuỳ ${c.you}.`,
  (c) => `Săn sale cũng được, mà ${c.me} nói trước là hết hàng thì ráng chịu nha.`,
];
const SR_DEFEND_OWNER: Tpl[] = [
  (c) => `Hoa hồng gì, ${c.me} xài thấy được thì nói, không tin mượn xài thử một tuần.`,
  (c) => `Xài rồi mới dám khen, chứ không ${c.me} khen chi cho mang tiếng.`,
  (c) => `Coi review làm gì, mai ${c.me} mang cái ở nhà lên cho ${c.you} coi.`,
];
const SR_DEFEND_NEW: Tpl[] = [
  (c) => `Hoa hồng gì, ${c.me} coi review cả tuần rồi mới dám rủ đó.`,
  (c) => `${c.Me} cũng đang tính mua nè, mua chung cho vui.`,
  (c) => `Đọc kỹ thông tin rồi mới nói, chứ ${c.me} đâu có khen bừa.`,
];
const SR_SOFTEN: Tpl[] = [
  (c) => `Thôi được, cho ${c.me} xin tên shop.`,
  (c) => `Ừ thì... để ${c.me} tính, lương về rồi nói.`,
  (c) => `Nghe cũng có lý, mà để ${c.me} canh sale cái đã.`,
  (c) => `Rồi rồi, ${c.me} tin ${c.you} một lần, hư là ${c.you} đền.`,
  (c) => `Thôi ${c.me} không nghe nữa, nghe nữa là ${c.me} chốt đơn mất.`,
];
const SR_THIRD: Tpl[] = [
  (c) => `Hai người bàn gì mà sôi nổi, cho ${c.me} hóng với.`,
  (c) => `Mua chung đi, ba người là đủ freeship rồi đó.`,
  (c) => `Ủa ${c.me} tưởng kệ này để trang trí, mua được luôn hả?`,
  (c) => `Nghe hai người nói ${c.me} cũng muốn chốt rồi nè.`,
  (c) => `Thôi hai người đừng dụ nhau nữa, lương chưa về đâu.`,
];
const SR_CLOSE: Tpl[] = [
  (c) => (c.bossHere ? null : `Thôi về chỗ làm, sếp thấy cả đám đứng đây là mệt.`),
  (c) => `Để ${c.me} chụp cái kệ gửi vô nhóm, tối cả đám săn sale.`,
  (c) => `Ngắm đủ rồi, về làm cho đủ KPI rồi tính chuyện mua.`,
  (c) => `Lương về nhắc ${c.me} nha, giờ ${c.me} về ${c.taskS} tiếp.`,
  (c) => `Đi đi, đứng đây lâu ${c.me} lại xách thêm món nữa đó.`,
  (c) => (c.bossHere ? null : `Nghe tiếng sếp rồi, giải tán giải tán!`),
];
const SR_NEW: SrTpl[] = [
  (c, pn, pt) => `Cái ${pn} này nè ${c.you}, ${pt}, ${c.me} đang tính rinh về.`,
  (c, pn, pt) => `${c.You} coi cái ${pn} này, ${pt}, hợp với ${c.you} lắm đó.`,
  (c, pn, pt) => `Đứng đây nãy giờ ${c.me} mê cái ${pn}, ${pt}.`,
  (c, pn, pt) => `${c.Me} xem review cái ${pn} cả tuần rồi, ${pt}, mà chưa dám chốt.`,
];
const SR_HOOK: ((c: C, pn: string, pt: string, hk: string) => string)[] = [
  (c, pn, pt, hk) => `Nói tới chuyện ${hk}, ${c.you} coi cái ${pn} này nè, ${pt}.`,
  (c, pn, pt, hk) => `Vụ ${hk} á, có cái ${pn} trên kệ nè, ${pt}.`,
];
const SR_FILL: Tpl[] = [
  (c) => `Kệ này toàn đồ xài được, không phải đồ trang trí đâu.`,
  (c) => `Để ${c.me} coi kỹ cái này chút.`,
  (c) => `Mỗi lần ra đây là ${c.me} lại muốn tiêu tiền.`,
  (c) => `Đọc cái nhận xét trên kệ là thấy muốn mua rồi.`,
];
function srShelfName(sc: SC): string {
  const label = norm(sc.req.locationLabel || '');
  if (/làm đẹp|beauty/u.test(label)) return 'kệ làm đẹp';
  if (/công nghệ|tech/u.test(label)) return 'kệ đồ công nghệ';
  return /kệ làm đẹp/u.test(sc.sit) ? 'kệ làm đẹp' : 'kệ đồ công nghệ';
}
function bShowroom(b: B, sc: SC, fx: FX): string {
  const pr = sc.req.product;
  const shelf = srShelfName(sc);
  const rec = (pr?.preferSpeaker && sc.cast.find((p) => p.id === pr.preferSpeaker))
    || sc.cast.find((p) => p.role === 'marketing') || sc.cast[0];
  const others = sc.cast.filter((p) => p.id !== rec.id);
  const Bp = others[0] ?? rec;
  const C3 = others[1];
  const pn = pr && typeof pr.short === 'string' && pr.short.trim() ? pr.short.trim()
    : pr && typeof pr.name === 'string' && pr.name.trim() ? lowerFirst(shortProductName(pr.name.trim())) : '';
  const hk = pr && typeof pr.hook === 'string' && pr.hook.trim() ? lowerFirst(pr.hook.trim().replace(/[.!…]+$/u, '')) : '';
  const owner = pr?.mode === 'owner';
  const spoken = pr ? spokenOf(pr, pn) : '';
  const pt = spoken || PT_FALLBACK[owner ? 'owner' : 'other'];
  const opener = others.length && chance(0.55) ? Bp : rec;
  const opens = owner && opener.id === rec.id ? SR_OPEN : [...SR_OPEN, ...SR_OPEN_CART];
  b.say(opener, opener.id === rec.id ? Bp : rec, opens.map((f) => (c: C) => f(c, shelf)), { em: ['🛍️', '👀'], pe: 0.3 });
  // v4: người đã có món (mode owner) kể lại; còn lại giới thiệu theo cớ / thông tin — không ai "đã xài lâu" nếu không có món
  const srTpls: ((c: C) => string)[] = owner
    ? SR_PRODUCT.map((f) => (c: C) => f(c, pn, noteAs(c, pt)))
    : [...SR_NEW.map((f) => (c: C) => f(c, pn, pt)), ...(hk ? SR_HOOK.map((f) => (c: C) => f(c, pn, pt, hk)) : [])];
  if (pn) b.say(rec, Bp, srTpls, { product: true, em: ['😍', '👌', '🛍️'], pe: 0.4 });
  else b.say(rec, Bp, SR_FILL, { em: E.smile, pe: 0.2 });
  if (others.length) {
    b.say(Bp, rec, owner ? [...SR_DOUBT, ...SR_DOUBT_OWNER] : [...SR_DOUBT, ...SR_DOUBT_NEW], { em: E.sly, pe: 0.4 });
    b.say(rec, Bp, owner ? [...SR_DEFEND, ...SR_DEFEND_OWNER] : [...SR_DEFEND, ...SR_DEFEND_NEW], { em: E.fun, pe: 0.3 });
    if (C3) {
      const grp = ++grpSeq;
      b.say(C3, null, SR_THIRD, { em: E.fun, pe: 0.3, grp, opt: true });
      b.say(Bp, rec, SR_SOFTEN, { opt: true, em: E.fun, pe: 0.3, grp });
    } else {
      b.say(Bp, rec, SR_SOFTEN, { opt: true, em: E.fun, pe: 0.3 });
    }
  }
  b.say(b.next(), null, SR_CLOSE, { em: E.ok, pe: 0.2 });
  for (const [p, q] of pairsOf(sc.cast)) bond(fx, p, q, 1, 3, 'khoe đồ ở phòng trưng bày');
  for (const p of sc.cast) fx.moodAdd(p, ri(1, 4));
  const item = pn || 'món đồ trên kệ';
  const otherNames = others.length ? joinNames(others) : 'đồng nghiệp';
  fx.memo(rec, `Khoe ${item} với ${otherNames} ở phòng trưng bày`);
  for (const o of others) fx.memo(o, `Nghe ${rec.name} khen ${item} ở phòng trưng bày, tính tối săn sale`);
  return pick([
    `${rec.name} khoe ${item} với ${otherNames} ở ${shelf}, ai cũng đòi săn sale.`,
    `${joinNames(sc.cast)} đứng ở ${shelf} bàn chuyện ${item}, ${Bp.name} nghi là quảng cáo.`,
    `Ở phòng trưng bày, ${rec.name} dụ ${otherNames} mua ${item}.`,
  ]);
}

// =====================================================================
//  10b. v3 — thời sự (tin thật) + nhân sự do AI/offline quyết (docs/v3-news.md)
// =====================================================================

// ---------------------------------------------------------------- news_chat
// Nguyên tắc: chỉ dùng TIÊU ĐỀ + TÊN BÁO nguyên văn; mọi câu còn lại là cảm nghĩ, liên hệ bản thân — không thêm chi tiết.
const NEWS_CATS: NewsCategory[] = ['the_thao', 'bong_da', 'cong_nghe', 'game', 'khoa_hoc', 'giai_tri'];
const NEWS_OPEN: Tpl[] = [
  (c) => `Ê ${c.you}, thấy tin "${c.title}" trên ${c.src} chưa?`,
  (c) => `Báo ${c.src} đăng vụ "${c.title}" đó, ${c.you} đọc chưa?`,
  (c) => `Nãy ${c.me} lướt ${c.src} thấy tin "${c.title}", ${c.you} biết chưa?`,
  (c) => `${c.Yn} ơi, trên ${c.src} có bài "${c.title}" nè.`,
  (c) => `Sáng nay ${c.me} đọc ${c.src} thấy "${c.title}", mới đọc tiêu đề thôi mà thấy tò mò.`,
  (c) => `Hồi nãy nhóm bạn ${c.me} share bài "${c.title}" của ${c.src}, ${c.you} coi chưa?`,
  (c) => `Nghe tin "${c.title}" chưa ${c.you}? Báo ${c.src} đăng đó.`,
  (c) => `Ủa ${c.you}, vụ "${c.title}" là sao vậy? ${c.Me} mới thấy trên ${c.src}, chưa đọc kỹ.`,
  (c) => `Tin hot nè: "${c.title}". ${c.Me} đọc trên ${c.src} hồi sáng.`,
  (c) => `${c.Yn} có theo dõi vụ "${c.title}" hông? ${c.Me} thấy ${c.src} đăng mà chưa kịp đọc hết.`,
  (c) => `Cho ${c.me} hỏi ngu: "${c.title}" là chuyện gì vậy? ${c.src} đăng mà ${c.me} đọc chưa hiểu.`,
  (c) => `Ê, ${c.src} vừa đăng "${c.title}". Nghe xong ${c.me} quên luôn ${c.taskS}.`,
];
const NEWS_OPEN_CAT: Record<NewsCategory, Tpl[]> = {
  // mọi câu mở đều dẫn nguồn (luật tin thật: "theo báo X đăng")
  the_thao: [(c) => `Dân thể thao như ${c.you} chắc biết vụ "${c.title}" rồi hả? ${c.src} đăng đó.`, (c) => `Ê, tin thể thao nè: "${c.title}". ${c.src} vừa đăng.`,
    (c) => `Coi ${c.src} thấy "${c.title}", ${c.me} đọc tiêu đề mà máu nổi lên.`],
  bong_da: [(c) => `Fan bóng đá đâu, "${c.title}" nè, ${c.src} vừa đăng!`, (c) => `Ê ${c.you}, ${c.src} đăng "${c.title}" đó, có coi trận hông?`,
    (c) => `${c.Me} đọc ${c.src} thấy "${c.title}", tối nay quán cà phê đầu hẻm chắc đông.`],
  cong_nghe: [(c) => `Dân công nghệ coi nè: "${c.title}", ${c.src} đăng hồi sáng.`, (c) => `Ê ${c.you}, "${c.title}" đó, ${c.me} đọc tiêu đề trên ${c.src} xong muốn đổi máy.`,
    (c) => `Trên ${c.src} có bài "${c.title}", ${c.you} nghĩ sao?`],
  game: [(c) => `Game thủ ơi, "${c.title}" nè, ${c.src} đăng đó.`, (c) => `Ê ${c.you}, thấy tin "${c.title}" trên ${c.src} chưa? Tối nay cày hông?`,
    (c) => `${c.Me} lướt ${c.src} thấy "${c.title}", tay ngứa muốn chơi liền.`],
  khoa_hoc: [(c) => `Tin khoa học nè: "${c.title}". Đọc ${c.src} mà thấy mình nhỏ bé ghê.`, (c) => `Ê ${c.you}, "${c.title}" đó, ${c.src} đăng, nghe hay ha.`,
    (c) => `Vụ "${c.title}" trên ${c.src} đọc xong ${c.me} thấy khoa học xịn thiệt.`],
  giai_tri: [(c) => `Tin giải trí nè ${c.you}: "${c.title}", ${c.src} đăng đó.`, (c) => `Ê, ${c.src} đăng "${c.title}" đó, ${c.you} hóng chưa?`,
    (c) => `Trưa nay ${c.me} đọc ${c.src} thấy "${c.title}", hóng ghê.`],
};
const NEWS_REACT: Tpl[] = [
  (c) => `Thấy rồi, mà ${c.me} mới đọc tiêu đề thôi, chưa đọc kỹ.`,
  (c) => `Ủa thiệt hả? ${c.Me} chưa thấy, để lát ${c.me} đọc.`,
  (c) => `Nghe tiêu đề thôi là ${c.me} thấy hấp dẫn rồi.`,
  (c) => `Báo ${c.src} đăng thì ${c.me} đọc kỹ rồi tính, giờ mới thấy tiêu đề thôi.`,
  (c) => `${c.Me} thấy từ sáng, cả nhóm bạn ${c.me} cũng bàn.`,
  (c) => `Trời, chuyện gì cũng tới tai ${c.you} đầu tiên hết.`,
  (c) => `${c.Me} đọc rồi, cảm giác chung là... hóng tiếp.`,
  (c) => `Tin này hot thiệt, ${c.me} lướt đâu cũng thấy.`,
  (c) => `${c.Me} đọc mà chưa hiểu hết, ${c.you} tóm lại coi.`,
  (c) => `Thôi ${c.me} không dám bàn sâu, biết tới đâu nói tới đó thôi.`,
  (c) => `Nghe sao thấy vậy thôi, mình đâu ở trong cuộc.`,
  (c) => `${c.Me} đọc bài đó rồi, ${c.src} viết cũng kỹ.`,
  (c) => `Mới sáng sớm mà ${c.you} cập nhật tin lẹ hơn cả ${c.src}.`,
  (c) => `Ừ, ${c.me} thấy rồi, mà đọc báo xong lại nhớ ra deadline.`,
];
const NEWS_REACT_CAT: Record<NewsCategory, Tpl[]> = {
  the_thao: [(c) => `Nghe là thấy muốn đi đá banh rồi.`, (c) => `Thể thao mà, lên xuống là chuyện thường.`,
    (c) => `Tối nay ${c.me} mở coi lại highlight cho đã.`, (c) => `Tập gym cả tuần được ba buổi mà bàn thể thao hăng ghê.`],
  bong_da: [(c) => `Nghe là thấy muốn đi đá banh rồi.`, (c) => `Bóng đá mà, vui buồn theo trận là chuyện thường.`,
    (c) => `Tối nay quán cà phê đầu hẻm chắc chật kín.`, (c) => `Đội ${c.me} mê thì cứ làm ${c.me} đau tim hoài.`],
  cong_nghe: [(c) => `Công nghệ đổi nhanh quá, ${c.me} theo không kịp.`, (c) => `Đọc xong tự nhiên thấy cái laptop công ty cũ hẳn.`,
    (c) => `Nghe xịn, mà xịn thì giá cũng xịn.`, (c) => `Mong có ngày mấy thứ đó làm giùm ${c.me} đống việc này.`],
  game: [(c) => `Tối nay ${c.me} về cày liền, KPI tính sau.`, (c) => `Game giờ làm đẹp quá, tiền đâu mua máy đây trời.`,
    (c) => `Đọc xong tay ${c.me} ngứa ngáy muốn bấm nút rồi.`, (c) => `Rủ nhau lập team tối nay hông?`],
  khoa_hoc: [(c) => `Đọc tin khoa học xong thấy chuyện deadline nhỏ xíu.`, (c) => `Người ta làm được vậy, mình fix một con bug cả ngày.`,
    (c) => `Hay ghê, ${c.me} để dành kể cho đứa cháu nghe.`, (c) => `Nghe mà não ${c.me} xoắn nhẹ.`],
  giai_tri: [(c) => `Hóng ghê, mà ${c.me} chỉ dám hóng thôi, không dám phán.`, (c) => `Showbiz mà, tuần nào cũng có chuyện để bàn.`,
    (c) => `Tối nay ${c.me} coi cho biết rồi mai tám tiếp.`, (c) => `Mấy vụ này ${c.me} coi cho vui, không nghĩ nhiều.`],
};
/** liên hệ sang đời mình (theo vai) — không đụng tới nội dung tin */
const NEWS_RELATE: Tpl[] = [
  (c) => (isSales(c.s) ? `Mà nói chứ, khách của ${c.me} mà hóng tin lẹ như ${c.me} thì chốt deal lẹ hơn.` : null),
  (c) => (c.isDevish ? `Thôi, đọc tin vậy đủ rồi, ${c.me} còn ${c.taskS} chờ.` : null),
  (c) => (c.s.role === 'marketing' ? `Tin này mà làm content kịp trend là view bay lắm.` : null),
  (c) => (c.s.role === 'hr' ? `Chuyện bên ngoài rộn ràng vậy, trong này ai cũng đúng giờ là ${c.me} mừng.` : null),
  (c) => (c.s.role === 'boss' ? `Thấy người ta làm lớn vậy, các em cũng phải bứt phá như cú putt lỗ 18 nha.` : null),
  (c) => (c.s.role === 'designer' ? `${c.Me} coi tin mà toàn để ý font với màu của tờ báo.` : null),
  (c) => (c.s.role === 'qa' ? `${c.Me} đọc tin cũng như test: đọc hai lần cho chắc.` : null),
  (c) => `Bàn chuyện người ta vui vậy chứ việc của mình vẫn còn nguyên đó.`,
  (c) => `Cuối tuần ${c.me} rủ ${c.you} đi cà phê bàn tiếp vụ này nha.`,
  (c) => `Nhìn người ta rồi nhìn lại KPI của mình, thôi làm tiếp.`,
  (c) => `Nói chứ đọc báo xong ${c.me} thấy công việc mình cũng... bình yên.`,
];
const NEWS_CLOSE: Tpl[] = [
  (c) => `Rồi, hóng tới đây thôi, có gì mới ${c.you} báo ${c.me} nha.`,
  (c) => `Thôi làm tiếp đi, lát trưa đọc kỹ rồi bàn tiếp.`,
  (c) => `Để tối ${c.me} đọc hết bài rồi mai kể ${c.you} nghe.`,
  (c) => `Ok, lưu bài đó lại, giờ chạy deadline cái đã.`,
  (c) => `Chuyện thiên hạ vậy thôi, mình lo chuyện mình trước.`,
  (c) => `Mai có tin mới lại tám tiếp nha ${c.you}.`,
  (c) => (c.bossHere ? `Thôi ${c.me} vô làm, kẻo sếp tưởng mình đọc báo cả ngày.` : `Thôi vô làm, ${c.watcher} đi ngang là biết mình đọc báo giờ làm đó.`),
];
/** người có sở thích hợp nhóm tin → người mở chuyện */
const NEWS_LIKE_RE: Record<NewsCategory, RegExp> = {
  the_thao: /bóng|banh|thể thao|gym|chạy bộ|cầu lông|pickleball|bơi/iu,
  bong_da: /bóng|banh|đội|world cup|v-league|ngoại hạng/iu,
  cong_nghe: /công nghệ|code|bàn phím|laptop|điện thoại|AI|crypto|coin|gadget/iu,
  game: /game|rank|esport|anime|chơi/iu,
  khoa_hoc: /khoa học|sách|vũ trụ|công nghệ|code/iu,
  giai_tri: /phim|trend|tiktok|show|nhạc|idol|son|thời trang|concert|k-pop|kpop/iu,
};
function likesNewsCat(p: P, cat: NewsCategory | null): boolean {
  if (!cat) return false;
  const likes = Array.isArray(p.a?.likes) ? p.a!.likes.join(' ') : '';
  return NEWS_LIKE_RE[cat].test(likes);
}
function bNews(b: B, sc: SC, fx: FX): string {
  const cast = sc.cast;
  if (!sc.nTitle) {
    // không có thẻ tin (Director quên) → tám chuyện thường theo chủ đề
    return bPantry(b, sc, fx);
  }
  const fans = cast.filter((p) => likesNewsCat(p, sc.nCat));
  const opener = fans.length ? pick(fans) : pick(cast);
  const second = b.next(opener);
  const catOpen = sc.nCat ? NEWS_OPEN_CAT[sc.nCat] : [];
  const catReact = sc.nCat ? NEWS_REACT_CAT[sc.nCat] : [];
  b.say(opener, second, [...NEWS_OPEN, ...catOpen, ...catOpen], { em: ['📰', '👀', ...E.think], pe: 0.35 });
  b.say(second, opener, [...NEWS_REACT, ...catReact], { em: [...E.shock, ...E.fun], pe: 0.35 });
  const third = cast.length >= 3 ? b.next() : null;
  if (third) b.say(third, null, [...catReact, ...NEWS_REACT.slice(0, 6)], { opt: true, em: E.fun, pe: 0.3 });
  const relater = fans.find((p) => p.id !== (b.last()?.sp.id ?? '')) ?? b.next();
  b.say(relater, null, [...catReact, ...NEWS_RELATE], { opt: true, em: E.fun, pe: 0.3 });
  b.say(b.next(), null, NEWS_RELATE, { opt: true, em: E.sly, pe: 0.25 });
  b.say(b.next(), null, NEWS_CLOSE, { em: E.ok, pe: 0.2 });
  for (const p of cast) fx.moodAdd(p, ri(1, 3));
  for (const [p, q] of pairsOf(cast)) bond(fx, p, q, 1, 2, 'tám chuyện thời sự');
  fx.memo(opener, `Bàn tin "${cut(sc.nTitle, 60)}" (${sc.nSource}) với ${joinNames(othersOf(sc, opener))}`);
  return pick([`${joinNames(cast)} tám chuyện về tin "${cut(sc.nTitle, 60)}" trên ${sc.nSource}.`,
    `${opener.name} mở chuyện tin "${cut(sc.nTitle, 60)}" (${sc.nSource}), cả nhóm hóng theo.`]);
}

// ---------------------------------------------------------------- hr_review (HR + sếp quyết nhân sự theo hồ sơ)
/** Trọng số chọn hành động offline (chỉ trong `allowed` của từng người; none luôn hợp lệ) */
const HR_WEIGHTS: Record<HrAction, number> = {
  none: 50, warn: 20, probation: 10, praise: 10, second_chance: 5, bonus: 5, fire: 3, promote: 1, open_position: 1, layoff: 1,
};
const HR_ACTION_LIST = Object.keys(HR_WEIGHTS) as HrAction[];
function pickHrAction(allowed: unknown): HrAction {
  const set = new Set<HrAction>(['none']);
  for (const a of Array.isArray(allowed) ? allowed : []) if (typeof a === 'string' && (HR_ACTION_LIST as string[]).includes(a)) set.add(a as HrAction);
  const opts = [...set];
  const total = opts.reduce((s, a) => s + HR_WEIGHTS[a], 0);
  let r = R() * total;
  for (const a of opts) { r -= HR_WEIGHTS[a]; if (r <= 0) return a; }
  return 'none';
}
type Dossier = NonNullable<SceneRequest['hrDossier']>[number];
function hrReason(action: HrAction, d: Dossier): string {
  const low = Number.isFinite(d.lowStreak) ? d.lowStreak : 0;
  switch (action) {
    case 'warn': return low > 0 ? `KPI thấp ${numWord(low)} ngày liền, cần nhắc chính thức.` : 'Dạo này đuối, cần nhắc chính thức một lần.';
    case 'probation': return 'Cho thử thách vài ngày với mục tiêu rõ ràng.';
    case 'second_chance': return 'Mới sa sút gần đây, cho thêm một cơ hội.';
    case 'praise': return 'Làm tốt đều tay, xứng đáng được ghi nhận trước công ty.';
    case 'bonus': return 'Vượt KPI, thưởng nóng để giữ lửa.';
    case 'promote': return 'Gánh việc cho cả team, đã tới lúc lên chức.';
    case 'fire': return (d.warnings ?? 0) > 0 ? 'Đã nhắc nhiều lần mà không cải thiện.' : 'Không cải thiện dù đã có thời gian.';
    case 'layoff': return 'Công ty lỗ, buộc phải cắt giảm.';
    case 'open_position': return 'Việc quá tải, cần tuyển thêm người.';
    default: return pick(['Chưa có gì đáng lo, theo dõi thêm.', 'KPI lên xuống trong mức chấp nhận được.', 'Để thêm một tuần nữa rồi xem lại.']);
  }
}
const HRV: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.da}sếp rảnh chút không, ${c.me} muốn rà lại nhân sự tuần này${c.a}.`,
    (c) => `${c.da}sếp ơi, ${c.me} mang sổ qua, mình điểm qua mấy bạn một chút nha${c.a}.`,
    (c) => `${c.da}${c.me} có vài chuyện nhân sự cần sếp quyết, nói nhanh thôi${c.a}.`,
    (c) => `${c.da}sếp uống trà đi, ${c.me} báo tình hình anh em cho sếp nghe${c.a}.`,
    (c) => `${c.da}tới kỳ rồi, ${c.me} tổng kết sơ về mấy bạn cho sếp nha${c.a}.`,
  ],
  bossOpen: [
    (c) => `Ừ, nói đi em. Anh vừa đi tuần một vòng, thấy vài gương mặt không vui.`,
    (c) => `Ngồi đi em. Có ai làm anh đau tim không?`,
    (c) => `Nói lẹ nha em, lát anh có cuộc gọi với đối tác.`,
    (c) => `Anh nghe. Gia đình mình tuần này sao rồi?`,
    (c) => `Ừ, anh cũng đang coi bảng KPI đây. Em thấy sao?`,
  ],
  concern: [
    (c) => `${c.da}${c.focus} dạo này đuối thấy rõ, ${c.me} nhìn bảng mà lo${c.a}.`,
    (c) => `${c.da}${c.focus} mấy hôm nay chậm, bị bắt lười mấy lần, ${c.me} thấy không ổn${c.a}.`,
    (c) => `${c.da}chuyện ${c.focus} thì sếp biết rồi đó, con số không khá hơn${c.a}.`,
    (c) => `${c.da}${c.focus} ${c.me} nhắc rồi mà vẫn vậy, giờ tính sao sếp${c.a}?`,
    (c) => `${c.da}${c.me} hơi lo cho ${c.focus}, không phải vì lười mà vì xuống tinh thần${c.a}.`,
  ],
  praiseUp: [
    // "còn … thì ngược lại" chỉ hợp khi vừa bàn xong một người đáng lo
    (c) => (c.sc.lines.length > 3 ? `${c.da}còn ${c.focus} thì ngược lại, cày dữ lắm, ${c.me} nghĩ nên ghi nhận${c.a}.`
      : `${c.da}${c.focus} dạo này cày dữ lắm, ${c.me} nghĩ nên ghi nhận${c.a}.`),
    (c) => `${c.da}${c.focus} kỳ này gánh team, sếp có tính gì cho bạn ấy không${c.a}?`,
    (c) => `${c.da}${c.me} phải khen ${c.focus} một câu, làm tốt mà im im${c.a}.`,
    (c) => `${c.da}${c.focus} vượt chỉ tiêu mấy ngày liền, để lâu người ta tủi${c.a}.`,
  ],
  neutral: [
    (c) => `${c.da}${c.focus} thì bình thường, chưa có gì phải lo${c.a}.`,
    (c) => `${c.da}${c.focus} lúc lên lúc xuống, ${c.me} nghĩ để thêm một tuần nữa coi sao${c.a}.`,
    (c) => `${c.da}còn ${c.focus} thì ${c.me} theo dõi thêm, chưa cần làm gì${c.a}.`,
  ],
  openPos: [
    (c) => `${c.da}việc nhiều quá, ${c.me} nghĩ mình nên tuyển thêm một người${c.a}.`,
    (c) => `${c.da}anh em kêu quá tải, sếp tính tuyển thêm người được không${c.a}?`,
  ],
  quiet: [
    (c) => `${c.da}tuần này êm, không ai làm ${c.me} đau đầu${c.a}.`,
    (c) => `${c.da}nhìn chung ổn sếp, ${c.me} chỉ muốn báo cho sếp yên tâm${c.a}.`,
    (c) => `${c.da}chưa có ai cần xét, mà ${c.me} vẫn muốn giữ nhịp họp cho có nếp${c.a}.`,
  ],
  hrClose: [
    (c) => `${c.da}${c.me} ghi lại hết rồi, mai ${c.me} làm từng việc${c.a}.`,
    (c) => `${c.da}rõ rồi, ${c.me} lo. Sếp nhớ đừng nói lỡ miệng ngoài kia nha${c.a}.`,
    (c) => `${c.da}vậy chốt nha sếp. ${c.Me} đi làm giấy tờ${c.a}.`,
    (c) => `${c.da}${c.me} ghi vô sổ rồi, có gì ${c.me} báo lại${c.a}.`,
  ],
  bossClose: [
    (c) => `Ừ. Nhớ nha em, mình làm vì cái chung. Chúng ta là một gia đình.`,
    (c) => `Xong. Giờ anh đi tập putt cho đỡ căng.`,
    (c) => `Rồi, giữ kín giùm anh. Tường văn phòng này mỏng lắm.`,
    (c) => `Ok. Tuần sau mình ngồi lại, hy vọng bảng số đẹp hơn.`,
  ],
};
const BOSS_DECIDE: Record<HrAction, Tpl[]> = {
  none: [
    (c) => `Thôi, cho thêm thời gian. Chúng ta là một gia đình, không ai bỏ ai.`,
    (c) => `Để coi thêm tuần nữa, anh không muốn vội.`,
    (c) => `Ừ, ghi nhận. Chưa làm gì hết, em theo dõi giùm anh.`,
  ],
  warn: [
    (c) => `Em gọi lên nhắc chính thức đi, nhẹ nhàng thôi nhưng phải rõ.`,
    (c) => `Nhắc một lần cho rõ. Anh không muốn nói mà không ai nghe.`,
    (c) => `Em làm biên bản nhắc nhở nha, cho có nếp.`,
  ],
  probation: [
    (c) => `Cho thử thách vài ngày. Lên thì ở lại, không lên thì tính tiếp.`,
    (c) => `Đặt mục tiêu rõ cho bạn đó, mấy ngày coi lại một lần.`,
  ],
  second_chance: [
    (c) => `Thôi, cho thêm một cơ hội. Ai cũng có lúc xuống phong độ, như anh đánh hụt putt vậy.`,
    (c) => `Lần này bỏ qua, nhưng em nói khéo cho bạn đó hiểu.`,
  ],
  praise: [
    (c) => `Chiều nay anh khen trước công ty. Người làm tốt phải được thấy.`,
    (c) => `Ừ, để anh nói một câu trong nhóm công ty cho bạn đó sướng.`,
  ],
  bonus: [
    (c) => `Thưởng! Không nhiều, nhưng phải có. Em làm giấy đi.`,
    (c) => `Chốt thưởng nóng cho bạn đó, coi như đầu tư vào gia đình mình.`,
  ],
  promote: [
    (c) => `Lên chức. Anh đã để ý lâu rồi, tới lúc rồi.`,
    (c) => `Thăng chức cho bạn đó đi, trách nhiệm thêm thì lương thêm.`,
  ],
  fire: [
    (c) => `Haizz... anh không muốn, nhưng công ty không gánh nổi nữa. Em lo thủ tục nhẹ nhàng nha.`,
    (c) => `Thôi, cho nghỉ. Nói chuyện tử tế, chế độ đủ, đừng để ai tổn thương.`,
  ],
  layoff: [
    (c) => `Doanh thu vậy thì phải cắt một người, anh đau lắm nhưng không còn cách.`,
    (c) => `Cắt giảm thôi em. Lo chế độ đầy đủ, mình còn gặp nhau ngoài đời.`,
  ],
  open_position: [
    (c) => `Ừ, mở vị trí mới đi. Mình đang lên, phải có người chạy cùng.`,
    (c) => `Tuyển. Nhưng tuyển người chịu khó, đừng tuyển người chịu... chơi.`,
  ],
};
const ACTION_LABEL: Record<HrAction, string> = {
  none: 'theo dõi thêm', warn: 'nhắc nhở', probation: 'thử thách', second_chance: 'cho thêm cơ hội', praise: 'khen',
  bonus: 'thưởng', promote: 'thăng chức', fire: 'cho nghỉ việc', layoff: 'cắt giảm', open_position: 'tuyển thêm người',
};
function bHrReview(b: B, sc: SC, fx: FX): string {
  const hr = sc.cast.find((p) => p.role === 'hr') ?? sc.cast[0];
  const boss = sc.cast.find((p) => p.role === 'boss' && p.id !== hr.id) ?? sc.cast.find((p) => p.id !== hr.id) ?? hr;
  const dossier = (Array.isArray(sc.req.hrDossier) ? sc.req.hrDossier : []).filter((d): d is Dossier => !!d && typeof d.id === 'string' && d.id !== '');
  const decisions: HrDecision[] = dossier.map((d) => {
    const action = pickHrAction(d.allowed);
    return { id: d.id, action, reason: hrReason(action, d) };
  });
  // nói về người có quyết định trước; giữ tối đa 6 quyết định (ưu tiên khác none)
  const sorted = [...decisions].sort((x, y) => Number(x.action === 'none') - Number(y.action === 'none'));
  // số người bàn được trong khung câu: mở (2 câu) + mỗi người 2 câu + chốt (1 câu) — không vượt maxLines để fitLines
  // không phải cắt ngẫu nhiên một câu giữa (mất câu HR nêu vấn đề thì sếp "quyết" khơi khơi)
  const [, maxLines] = lineBounds(sc);
  const slots = Math.min(2, Math.max(1, Math.floor((maxLines - 3) / 2)));
  const talk = sorted.filter((d) => d.action !== 'none').slice(0, slots);
  if (!talk.length && sorted.length) talk.push(sorted[0]);
  // quyết định khác none mà không kịp bàn trong cảnh → none (thoại và quyết định phải khớp nhau)
  fx.decisions = sorted.slice(0, 6).map((d) => (talk.includes(d) || d.action === 'none' ? d
    : { ...d, action: 'none' as HrAction, reason: 'Chưa bàn tới kỳ này, để kỳ sau xem lại.' }));
  b.say(hr, boss, HRV.open, { em: ['📋'], pe: 0.4 });
  b.say(boss, hr, HRV.bossOpen, { em: E.boss, pe: 0.3 });
  for (const d of talk) {
    sc.focus = personOf(d.id, sc.ctx);
    sc.action = d.action;
    const pool = d.action === 'open_position' ? HRV.openPos
      : d.action === 'praise' || d.action === 'bonus' || d.action === 'promote' ? HRV.praiseUp
        : d.action === 'none' ? HRV.neutral : HRV.concern;
    b.say(hr, boss, pool, { em: ['📋', '📉', '📈'], pe: 0.3 });
    b.say(boss, hr, BOSS_DECIDE[d.action], { em: E.boss, pe: 0.3 });
  }
  if (!talk.length) {
    b.say(hr, boss, HRV.quiet, { em: E.smile, pe: 0.3 });
    b.say(boss, hr, BOSS_DECIDE.none, { em: E.boss, pe: 0.3 });
  }
  b.say(hr, boss, HRV.hrClose, { em: ['📋'], pe: 0.2 });
  if (sc.lines.length < maxLines) b.say(boss, hr, HRV.bossClose, { opt: true, em: E.boss, pe: 0.3 });
  const notable = fx.decisions.filter((d) => d.action !== 'none').map((d) => `${personOf(d.id, sc.ctx).name}: ${ACTION_LABEL[d.action]}`);
  const gist = notable.length ? notable.join(', ') : 'chưa ai cần xử lý';
  fx.memo(hr, `Họp xét nhân sự với sếp — ${gist}`);
  fx.memo(boss, `Họp nhân sự với ${hr.name} — ${gist}`);
  return cut(`${hr.name} và sếp ${boss.name} họp kín xét nhân sự: ${gist}.`, 120);
}

// ---------------------------------------------------------------- resign_talk (nhân viên chán việc tâm sự với HR → stay/leave)
const RS: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.da}${c.me} nói thiệt, ${c.me} đang tính xin nghỉ${c.a}.`,
    (c) => `${c.da}${c.you} rảnh không, ${c.me} muốn nói chuyện riêng chút. Chuyện nghỉ việc${c.a}.`,
    (c) => `${c.da}${c.me} mệt rồi ${c.you}, chắc ${c.me} không trụ nổi nữa${c.a}.`,
    (c) => `${c.da}${c.me} viết đơn xin nghỉ ba lần rồi xóa, giờ ${c.me} lên nói thẳng với ${c.you}${c.a}.`,
    (c) => `${c.da}${c.you} ơi, ${c.me} hỏi thiệt: xin nghỉ thì báo trước bao lâu${c.a}?`,
    (c) => `${c.da}${c.me} vô đây không phải xin phép, mà là xin nghỉ${c.a}.`,
  ],
  hrListen: [
    (c) => `Ngồi xuống đi ${c.you}, uống miếng nước. Kể ${c.me} nghe từ đầu.`,
    (c) => `Khoan, đừng nói chuyện đơn vội. Có chuyện gì vậy ${c.you}?`,
    (c) => `${c.Me} nghe nè. Ở đây chỉ có hai đứa mình thôi, nói thiệt đi.`,
    (c) => `Trời, ${c.you} làm ${c.me} hết hồn. Chuyện gì tới mức đó?`,
    (c) => `${c.Me} đóng cửa rồi, ${c.you} cứ nói, ${c.me} không ghi sổ đâu.`,
  ],
  hrProbe: [
    (c) => `Còn gì nữa không, nói hết ra đi ${c.you}.`,
    (c) => `Ừ, ${c.me} nghe. Rồi sao nữa?`,
    (c) => `Chuyện đó ${c.me} có nghe phong thanh. Còn gì nữa không?`,
    (c) => `${c.Me} hiểu. Mà chắc không chỉ có vậy đâu, đúng không?`,
  ],
  reason: [
    (c) => ((c.s.a?.mood ?? 60) < 35 ? `${c.da}sáng nào mở mắt ${c.me} cũng không muốn đi làm, mấy tuần rồi${c.a}.` : null),
    (c) => (c.bossRel <= -15 ? `${c.da}sếp cứ đứng sau lưng ${c.me} soi màn hình, ${c.me} thở không nổi${c.a}.` : null),
    (c) => ((c.s.a?.warnings ?? 0) > 0 ? `${c.da}bị nhắc KPI mà ${c.me} thấy chẳng ai hỏi ${c.me} đang kẹt gì${c.a}.` : null),
    (c) => ((c.s.a?.stress ?? 0) >= 60 ? `${c.da}deadline chồng deadline, ${c.me} làm hoài không thấy đích${c.a}.` : null),
    (c) => `${c.da}lương thì vậy, việc thì tăng, ${c.me} thấy không công bằng${c.a}.`,
    (c) => `${c.da}${c.me} có chỗ khác gọi, lương nhỉnh hơn, ${c.me} đang phân vân${c.a}.`,
    (c) => `${c.da}${c.me} thấy mình đứng một chỗ, không học được gì mới${c.a}.`,
    (c) => `${c.da}chuyện nhỏ thôi mà cộng lại thành lớn: máy chậm, họp dài, không ai lắng nghe${c.a}.`,
    (c) => (isSales(c.s) ? `${c.da}chạy doanh số mà khách thì khó, hoa hồng thì chờ hoài${c.a}.` : null),
    (c) => (c.isDevish ? `${c.da}sửa bug người khác suốt, code mình viết chưa được dòng nào${c.a}.` : null),
    (c) => (c.s.role === 'marketing' ? `${c.da}clip nào ít view là bị hỏi, clip nào nhiều view thì coi như đương nhiên${c.a}.` : null),
  ],
  hrPersuade: [
    (c) => `${c.Me} hiểu. Nhưng nghỉ ngay giữa dự án thì ${c.you} thiệt trước, chờ ${c.me} nói với sếp một tiếng được không?`,
    (c) => `Chuyện lương ${c.me} không hứa được, nhưng chuyện việc quá tải thì ${c.me} sửa được, cho ${c.me} một tuần.`,
    (c) => `${c.You} đi là cả phòng mất một người biết việc. Ở lại, mình cùng gỡ từng cái.`,
    (c) => `${c.Me} từng muốn nghỉ y chang ${c.you}, rồi ở lại tới giờ. Nghe ${c.me} nói hết đã.`,
    (c) => `Nếu ${c.me} xin cho ${c.you} nghỉ phép hai ngày, về nghĩ kỹ rồi quyết, chịu không?`,
    (c) => `${c.Me} tôn trọng ${c.you}. Nhưng đừng quyết lúc đang mệt, quyết lúc đầu tỉnh.`,
    (c) => `Nói thiệt nha, sếp quý ${c.you} hơn ${c.you} nghĩ, chỉ là sếp không biết cách nói.`,
  ],
  stayEmp: [
    (c) => `${c.da}thôi... cho ${c.me} thêm một tuần, ${c.me} thử lại lần nữa${c.a}.`,
    (c) => `${c.da}${c.you} nói vậy ${c.me} cũng mềm lòng. Ở lại, mà phải khác đi đó${c.a}.`,
    (c) => `${c.da}ừ thì... ${c.me} chưa nộp đơn mà. Ở lại coi sao${c.a}.`,
    (c) => `${c.da}${c.me} nghe ${c.you} lần này. Nhưng ${c.me} nói trước, lần sau là ${c.me} đi thiệt${c.a}.`,
    (c) => `${c.da}được, ${c.me} ở lại. Mà ${c.you} nhớ lời hứa đó nha${c.a}.`,
  ],
  leaveEmp: [
    (c) => `${c.da}${c.me} suy nghĩ kỹ rồi ${c.you}, ${c.me} nghỉ. Cho ${c.me} báo trước đúng luật${c.a}.`,
    (c) => `${c.da}${c.me} cảm ơn ${c.you}, mà lòng ${c.me} đi rồi, chân cũng phải đi${c.a}.`,
    (c) => `${c.da}${c.me} quyết rồi. Tháng này ${c.me} bàn giao đầy đủ, không để ai khổ${c.a}.`,
    (c) => `${c.da}${c.you} đừng giữ nữa, ${c.me} sợ ở lại rồi lại ghét chỗ này${c.a}.`,
    (c) => `${c.da}${c.me} đi. Không giận ai, chỉ là hết duyên${c.a}.`,
  ],
  hrStay: [
    (c) => `Ok, deal. Tuần sau mình ngồi lại coi có khá hơn không. ${c.Me} ghi vô sổ... ghi điều tốt thôi.`,
    (c) => `Vậy là ở lại nha. ${c.Me} nói với sếp liền, ${c.you} về làm việc nhẹ nhẹ thôi hôm nay.`,
    (c) => `Cảm ơn ${c.you} đã nói thẳng. Chuyện này ${c.me} giữ kín.`,
    (c) => `Rồi, hôm nay coi như chưa có gì. Chiều ${c.me} mang trà sữa qua bàn ${c.you}.`,
  ],
  hrLeave: [
    (c) => `${c.Me} tôn trọng. Làm giấy tờ cho ${c.you} tử tế, có gì cần xác nhận cứ nói ${c.me}.`,
    (c) => `Buồn thiệt đó ${c.you}, mà ${c.me} chúc ${c.you} đi tới chỗ hợp hơn.`,
    (c) => `Ok. Báo trước đúng luật, bàn giao gọn, cửa ở đây lúc nào cũng mở.`,
    (c) => `${c.Me} nói với sếp giùm ${c.you}, đừng để sếp nghe từ người khác.`,
  ],
};
function bResign(b: B, sc: SC, fx: FX): string {
  const hr = sc.cast.find((p) => p.role === 'hr') ?? sc.cast.find((p) => p.role === 'boss') ?? sc.cast[sc.cast.length - 1];
  const emp = (sc.x && sc.cast.some((p) => p.id === sc.x!.id && p.id !== hr.id) ? sc.cast.find((p) => p.id === sc.x!.id) : null)
    ?? sc.cast.find((p) => p.id !== hr.id && p.role !== 'boss' && p.role !== 'hr') ?? sc.cast.find((p) => p.id !== hr.id) ?? hr;
  const mood = emp.a?.mood ?? 60;
  const bossP = findAgentByRole(sc, 'boss');
  const relBoss = bossP ? relScore(emp, bossP) : 0;
  const relHr = relScore(emp, hr);
  let pLeave = 0.3;
  if (mood < 25) pLeave += 0.25; else if (mood < 40) pLeave += 0.1;
  if (relBoss <= -20) pLeave += 0.2;
  if ((emp.a?.warnings ?? 0) > 0) pLeave += 0.1;
  if (relHr >= 20) pLeave -= 0.15;
  if (emp.traits.ambition >= 0.6) pLeave += 0.05;
  if (has(sc, 'chỗ mới', 'offer', 'headhunt', 'công ty khác gọi')) pLeave += 0.15;
  if (has(sc, 'bắt buộc ở lại', 'phải ở lại', 'không được nghỉ')) pLeave = 0;
  if (has(sc, 'chắc chắn nghỉ', 'quyết nghỉ', 'bắt buộc nghỉ')) pLeave = 1;
  const leave = chance(clamp(pLeave, 0, 1) === 0 ? 0 : clamp(pLeave, 0.1, 0.85));
  b.say(emp, hr, RS.open, { em: E.sad, pe: 0.5 });
  b.say(hr, emp, RS.hrListen, { em: E.shock, pe: 0.4 });
  b.say(emp, hr, RS.reason, { em: E.sad, pe: 0.4 });
  const probe = b.say(hr, emp, RS.hrProbe, { opt: true, em: E.think, pe: 0.2 });
  if (probe) b.say(emp, hr, RS.reason, { opt: true, em: E.tired, pe: 0.3, dep: probe });
  b.say(hr, emp, RS.hrPersuade, { em: E.polite, pe: 0.3 });
  b.say(emp, hr, leave ? RS.leaveEmp : RS.stayEmp, { em: leave ? ['🥲', '🚪'] : ['😮‍💨', '🙂'], pe: 0.5 });
  b.say(hr, emp, leave ? RS.hrLeave : RS.hrStay, { em: leave ? E.sad : E.smile, pe: 0.4 });
  fx.verdict = leave ? 'leave' : 'stay';
  if (leave) {
    fx.moodAdd(emp, ri(1, 3)); fx.relAdd(emp, hr, ri(1, 3), 'HR lắng nghe tử tế'); fx.relAdd(hr, emp, -ri(0, 2), 'xin nghỉ giữa dự án');
    fx.memo(emp, `Nói chuyện với ${hr.name} và quyết định xin nghỉ việc`);
    fx.memo(hr, `${emp.name} xin nghỉ, không giữ được`);
  } else {
    fx.moodAdd(emp, ri(3, 6)); fx.relAdd(emp, hr, ri(4, 6), 'được HR lắng nghe và giữ lại'); fx.relAdd(hr, emp, ri(2, 3), 'nói chuyện thẳng thắn');
    fx.memo(emp, `Định xin nghỉ, được ${hr.name} thuyết phục ở lại thêm một thời gian`);
    fx.memo(hr, `Thuyết phục ${emp.name} ở lại sau khi em ấy định nghỉ`);
  }
  return leave ? pick([`${emp.name} tâm sự với ${hr.name} và quyết định xin nghỉ việc.`, `${hr.name} không giữ được ${emp.name}: em ấy chốt nghỉ.`])
    : pick([`${emp.name} định nghỉ việc, ${hr.name} thuyết phục ở lại thêm một thời gian.`, `${hr.name} lắng nghe ${emp.name} trút bầu tâm sự, cuối cùng em ấy ở lại.`]);
}

// ---------------------------------------------------------------- raise_request (xin tăng lương với sếp → approved/denied)
const RR: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.da}sếp cho ${c.me} năm phút, ${c.me} muốn nói chuyện lương${c.a}.`,
    (c) => `${c.da}sếp ơi, ${c.me} làm ở đây cũng lâu rồi, ${c.me} xin phép nói thẳng chuyện tăng lương${c.a}.`,
    (c) => `${c.da}${c.me} chuẩn bị số liệu rồi, sếp coi giùm ${c.me} chuyện lương một chút${c.a}.`,
    (c) => `${c.da}sếp đừng giật mình nha: ${c.me} xin tăng lương${c.a}.`,
    (c) => `${c.da}${c.me} biết sếp ghét câu này, mà ${c.me} phải hỏi: lương ${c.me} khi nào lên${c.a}?`,
  ],
  bossReact: [
    (c) => `Chà, mở đầu ngày bằng chữ "lương", em có thấy anh tái mặt không?`,
    (c) => `Ngồi đi. Nói anh nghe, em có gì trong tay?`,
    (c) => `Em biết là chúng ta là một gia đình mà, gia đình thì... thôi, em nói trước đi.`,
    (c) => `Anh vừa coi dòng tiền xong, giờ em nói chuyện lương, đúng là thử thách.`,
    (c) => `Ừ, anh nghe. Nhưng đưa bằng chứng, đừng đưa cảm xúc.`,
  ],
  evidence: [
    (c) => `${c.da}KPI ${c.me} đang ${kpiPct(c.s)}% mục tiêu, không phải ăn may${c.a}.`,
    (c) => ((c.sc.ctx?.company?.projectsDone ?? 0) > 0 ? `${c.da}công ty giao được ${numWord(c.sc.ctx.company.projectsDone)} dự án, dự án nào ${c.me} cũng có mặt${c.a}.` : null),
    (c) => `${c.da}${c.me} gánh thêm việc của người khác mà lương vẫn y cũ${c.a}.`,
    (c) => ((c.s.a?.hiredDay ?? 1) <= 1 ? `${c.da}${c.me} ở đây từ ngày đầu, chưa xin gì, giờ mới xin lần đầu${c.a}.` : `${c.da}${c.me} vô từ ngày ${c.s.a?.hiredDay}, chưa xin gì, giờ mới xin lần đầu${c.a}.`),
    (c) => (isSales(c.s) ? `${c.da}deal ${c.client} là ${c.me} chốt, sếp nhớ không${c.a}?` : null),
    (c) => (c.isDevish ? `${c.da}bản release vừa rồi ${c.me} thức hai đêm fix cho kịp${c.a}.` : null),
    (c) => (c.s.role === 'marketing' ? `${c.da}clip tháng này của ${c.me} kéo khách về cho sales mà${c.a}.` : null),
    (c) => (c.s.role === 'designer' ? `${c.da}khách nào cũng khen giao diện, mà người vẽ thì lương vẫn vậy${c.a}.` : null),
    (c) => (c.s.role === 'qa' ? `${c.da}bug ${c.me} chặn được trước khi tới khách, tính ra tiền cũng nhiều lắm${c.a}.` : null),
    (c) => `${c.da}ngoài kia người ta trả cho vị trí này cao hơn, ${c.me} hỏi rồi${c.a}.`,
  ],
  bossAnswer: [
    (c) => `Anh thấy hết, anh ghi nhận hết. Nhưng em nhìn bảng doanh thu kìa, ${c.sc.revenueText}.`,
    (c) => `Chúng ta là một gia đình, mà gia đình mình tháng này... hơi kẹt.`,
    (c) => `Lương là một con số, còn cơ hội ở đây là vô hạn. Em hiểu ý anh không?`,
    (c) => `Như golf vậy đó em, không phải cú nào cũng vô lỗ. Để anh tính.`,
    (c) => `Em nói đúng. Mà đúng chưa đủ, phải đúng lúc. Để cuối quý anh xem lại.`,
    (c) => `Anh thích cách em chuẩn bị. Người như em anh không muốn mất.`,
  ],
  push: [
    (c) => `${c.da}sếp nói "để tính" lần này là lần thứ ba rồi${c.a}.`,
    (c) => `${c.da}${c.me} không cần nhiều, chỉ cần đúng với công sức${c.a}.`,
    (c) => `${c.da}nếu không được, sếp cho ${c.me} biết thẳng để ${c.me} tính${c.a}.`,
    (c) => `${c.da}cơ hội thì ${c.me} cảm ơn, mà tiền trọ không nhận cơ hội${c.a}.`,
  ],
  approved: [
    (c) => `Được. Anh duyệt. Không nhiều như em muốn, nhưng từ tháng sau có thêm. Ráng giữ phong độ nha.`,
    (c) => `Ok, anh đồng ý tăng, có điều kiện: KPI giữ mức này ba tháng. Deal?`,
    (c) => `Thôi được, em thắng anh rồi đó. Anh nói HR làm giấy, nhưng đừng khoe cả phòng.`,
    (c) => `Chốt. Anh tăng cho em, coi như đầu tư vào gia đình mình.`,
  ],
  denied: [
    (c) => `Chưa được lúc này em. Cuối quý doanh thu lên, anh hứa nói lại chuyện này trước.`,
    (c) => `Anh không duyệt được bây giờ. Nhưng anh ghi vào sổ, và sổ anh không mất đâu.`,
    (c) => `Thôi em, tháng này công ty gồng rồi. Để qua đợt này rồi tính.`,
    (c) => `Chúng ta là một gia đình, em thương anh thì chờ anh thêm một quý.`,
    (c) => `Anh nghe hết rồi, mà câu trả lời vẫn là: chưa. Đừng buồn, cuối năm tính.`,
  ],
  thanksYes: [
    (c) => `${c.da}cảm ơn sếp! ${c.Me} hứa không để sếp hối${c.a}.`,
    (c) => `${c.da}${c.me} giữ phong độ. Chiều ${c.me} mời sếp trà sữa${c.a}.`,
    (c) => `${c.da}sếp nói giữ kín, ${c.me} giữ... tới giờ ăn trưa${c.a}.`,
  ],
  sighNo: [
    (c) => `${c.da}${c.me} hiểu rồi... "cuối năm tính". ${c.Me} ghi lại ngày hôm nay nha sếp${c.a}.`,
    (c) => `${c.da}vậy ${c.me} xin phép về làm, mà sếp nhớ lời hứa đó${c.a}.`,
    (c) => `${c.da}${c.me} biết trước rồi, mà vẫn phải hỏi cho khỏi tức${c.a}.`,
    (c) => `${c.da}thôi ${c.me} coi như luyện kỹ năng thuyết trình. Lần sau ${c.me} mang slide${c.a}.`,
  ],
};
function bRaise(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? sc.cast.find((p) => p.role === 'hr') ?? sc.cast[sc.cast.length - 1];
  const emp = (sc.x && sc.cast.some((p) => p.id === sc.x!.id && p.id !== boss.id) ? sc.cast.find((p) => p.id === sc.x!.id) : null)
    ?? sc.cast.find((p) => p.id !== boss.id && p.role !== 'boss' && p.role !== 'hr') ?? sc.cast.find((p) => p.id !== boss.id) ?? boss;
  const hist = (emp.a?.kpiHistory ?? []).slice(-3).map((x) => x.ratio).filter((r) => Number.isFinite(r));
  const avg = hist.length ? hist.reduce((s, r) => s + r, 0) / hist.length : kpiPct(emp) / 100;
  const comp = sc.ctx?.company;
  const revRatio = comp && comp.revenueTarget > 0 ? comp.revenueMonth / comp.revenueTarget : 0.5;
  const relBossToEmp = boss.a?.relationships?.[emp.id]?.score ?? 0;
  let pYes = 0.25;
  if (avg >= 1) pYes += 0.25; else if (avg >= 0.85) pYes += 0.1;
  if ((emp.a?.lowStreak ?? 0) > 0) pYes -= 0.2;
  if (relBossToEmp >= 20) pYes += 0.15; else if (relBossToEmp <= -15) pYes -= 0.1;
  if (revRatio < 0.5) pYes -= 0.15; else if (revRatio >= 0.9) pYes += 0.1;
  if (has(sc, 'bắt buộc duyệt', 'phải duyệt', 'chắc chắn duyệt')) pYes = 1;
  if (has(sc, 'bắt buộc từ chối', 'không được duyệt', 'chắc chắn từ chối')) pYes = 0;
  const approved = chance(pYes >= 1 ? 1 : pYes <= 0 ? 0 : clamp(pYes, 0.05, 0.75));
  b.say(emp, boss, RR.open, { em: E.nervous, pe: 0.5 });
  b.say(boss, emp, RR.bossReact, { em: ['😅', '👔'], pe: 0.4 });
  b.say(emp, boss, RR.evidence, { em: ['📈', '🧐'], pe: 0.3 });
  b.say(boss, emp, RR.bossAnswer, { em: E.boss, pe: 0.3 });
  // câu "có qua có lại": chỉ bị cắt khi khung câu quá chật (opt), không để fitLines cắt ngẫu nhiên câu quan trọng khác
  b.say(emp, boss, approved ? RR.evidence : RR.push, { opt: true, em: E.think, pe: 0.3 });
  b.say(boss, emp, approved ? RR.approved : RR.denied, { em: approved ? E.happy : ['😅', '👔'], pe: 0.5 });
  b.say(emp, boss, approved ? RR.thanksYes : RR.sighNo, { em: approved ? E.happy : E.sad, pe: 0.5 });
  fx.verdict = approved ? 'approved' : 'denied';
  if (approved) {
    fx.moodAdd(emp, ri(7, 10)); fx.kpiAdd(emp, ri(2, 4)); fx.relAdd(emp, boss, ri(5, 7), 'được duyệt tăng lương'); fx.relAdd(boss, emp, ri(1, 3), 'xin tăng lương có bằng chứng');
    fx.memo(emp, `Xin tăng lương với sếp và được duyệt (có điều kiện giữ KPI)`); fx.memo(boss, `Duyệt tăng lương cho ${emp.name}`);
  } else {
    fx.moodAdd(emp, -ri(4, 7)); fx.relAdd(emp, boss, -ri(3, 5), 'xin tăng lương bị hẹn "cuối năm tính"'); fx.relAdd(boss, emp, ri(0, 1), 'dám lên xin tăng lương');
    fx.memo(emp, `Xin tăng lương, sếp hẹn "cuối năm tính"`); fx.memo(boss, `${emp.name} xin tăng lương, chưa duyệt`);
  }
  return approved ? pick([`${emp.name} xin tăng lương với bằng chứng KPI và được sếp duyệt.`, `Sếp ${boss.name} đồng ý tăng lương cho ${emp.name}, kèm điều kiện giữ phong độ.`])
    : pick([`${emp.name} xin tăng lương, sếp ${boss.name} từ chối khéo kiểu "cuối năm tính".`, `Sếp hẹn ${emp.name} chuyện tăng lương sang cuối quý.`]);
}

// ---------------------------------------------------------------- promotion (công bố thăng chức / thưởng trước đồng nghiệp)
const PM: Record<string, Tpl[]> = {
  bossAnnounce: [
    (c) => `Cả nhà chú ý chút! Hôm nay anh có tin vui: ${c.X} chính thức lên chức.`,
    (c) => `Mọi người nghe anh nói nè. Người làm tốt phải được thấy: ${c.X}, lên nhận lời khen và quyết định mới.`,
    (c) => `Như cú putt vô lỗ 18, anh công bố: ${c.X} được thăng chức từ hôm nay!`,
    (c) => `Chúng ta là một gia đình, mà gia đình thì phải mừng cho nhau: ${c.X} được thưởng nóng!`,
    (c) => `Tin nóng hơn cả server sập: ${c.X} được công ty ghi nhận, thưởng đợt này!`,
    (c) => `Anh nói ngắn gọn: ${c.X} làm tốt, anh thưởng. Vỗ tay cái coi!`,
  ],
  hrAnnounce: [
    (c) => `Thay mặt công ty, ${c.me} thông báo: ${c.X} được ghi nhận và thưởng đợt này. Vỗ tay nào!`,
    (c) => `Mọi người ơi, tin vui: ${c.X} được thăng chức. ${c.Me} ghi vô sổ bằng mực đỏ luôn.`,
    (c) => `${c.Me} ít khi báo tin vui, nên hôm nay nói to: ${c.X} được thưởng!`,
  ],
  thanks: [
    (c) => `${c.da}${c.me} cảm ơn sếp, cảm ơn mọi người. ${c.Me}... hơi run${c.a}.`,
    (c) => `${c.da}${c.me} không biết nói gì, chắc chiều ${c.me} khao trà sữa${c.a}.`,
    (c) => (c.s.traits.humor >= 0.5 ? `${c.da}vậy từ mai ${c.me} đi làm trễ được không sếp${c.a}?` : null),
    (c) => (c.s.traits.ambition >= 0.6 ? `${c.da}${c.me} hứa làm gấp đôi, sếp chờ coi${c.a}.` : null),
    (c) => `${c.da}${c.me} tưởng bị gọi lên vì KPI, ai ngờ... cảm ơn sếp${c.a}!`,
    (c) => `${c.da}mọi người giúp ${c.me} nhiều lắm, ${c.me} cảm ơn nha${c.a}.`,
  ],
  joy: [
    (c) => `Xứng đáng! ${c.Xn} cày dữ lắm, ${c.me} làm chứng.`,
    (c) => `Mừng cho ${c.xn} nha, mà khao là phải khao đó!`,
    (c) => `Trời, cuối cùng cũng có người được thưởng, văn phòng còn hy vọng.`,
    (c) => `Chúc mừng ${c.xn}! Nhớ chia lộc cho ${c.me} một ly.`,
    (c) => `Vỗ tay vỗ tay! Mà sếp ơi, bao giờ tới lượt ${c.me}?`,
    (c) => `${c.Xn} lên chức rồi, nhớ anh em nha, đừng quên tụi này.`,
  ],
  envy: [
    (c) => `Chúc mừng... ${c.me} cũng làm y vậy mà sao không ai thấy ta.`,
    (c) => `Ừ, mừng cho ${c.xn}. KPI ${c.me} cũng đâu thua.`,
    (c) => `Ghen tị nhẹ thôi nha, mà ${c.xn} khao gì cho tụi này?`,
    (c) => `Vậy là ${c.xn} được thưởng, còn ${c.me} được... động lực. Cũng được.`,
    (c) => `Thưởng cho ${c.xn} rồi, chắc tới quý sau tới ${c.me} hả sếp?`,
    (c) => `${c.Me} cười mà lòng hơi chua, thiệt tình.`,
  ],
  bossClose: [
    (c) => `Rồi, ai cũng có cơ hội, miễn là làm tốt. Giờ về chỗ, bàn KPI cho anh nha.`,
    (c) => `Vui vậy đủ rồi, tối nay ${c.X} khao, anh góp... lời chúc.`,
    (c) => `Ai muốn như ${c.X} thì làm như ${c.X}. Giải tán!`,
    (c) => `Chúng ta là một gia đình, nhà có người lên thì cả nhà vui. Làm việc tiếp nha.`,
  ],
};
/** nhân viên là nhân vật chính của cảnh nhân sự: aboutId → người được nhắc tên đầu tiên → người đầu không phải sếp/HR */
function subjectEmployee(sc: SC, exclude: P[]): P | null {
  const ex = new Set(exclude.map((p) => p.id));
  const ok = (p: P | null | undefined): p is P => !!p && !ex.has(p.id) && sc.cast.some((q) => q.id === p.id);
  if (ok(sc.x)) return sc.x;
  const named = sc.named.find((p) => ok(p) && p.role !== 'boss' && p.role !== 'hr');
  if (named) return named;
  return sc.cast.find((p) => !ex.has(p.id) && p.role !== 'boss' && p.role !== 'hr') ?? sc.cast.find((p) => !ex.has(p.id)) ?? null;
}
function bPromotion(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const hr = sc.cast.find((p) => p.role === 'hr') ?? null;
  const star = subjectEmployee(sc, [boss, hr].filter((p): p is P => !!p)) ?? sc.cast[0];
  sc.x = star;
  const announcer = boss ?? hr ?? sc.cast.find((p) => p.id !== star.id) ?? star;
  const mates = sc.cast.filter((p) => p.id !== star.id && p.id !== announcer.id);
  const bonusOnly = has(sc, 'thưởng') && !has(sc, 'thăng chức', 'lên chức');
  b.say(announcer, star, announcer.role === 'boss' ? PM.bossAnnounce : PM.hrAnnounce, { em: ['🎖️', '🎉', '📣'], pe: 0.6 });
  b.say(star, announcer, PM.thanks, { em: E.happy, pe: 0.6 });
  for (const m of shuffle(mates).slice(0, 3)) {
    const envious = relScore(m, star) <= -5 || (m.traits.ambition >= 0.65 && chance(0.6));
    b.say(m, star, envious ? PM.envy : PM.joy, { em: envious ? E.annoy : E.party, pe: 0.5, opt: mates.length > 2 });
    if (envious) { fx.relAdd(m, star, -ri(2, 4), 'ganh tị vì bạn được thăng chức'); fx.moodAdd(m, -ri(1, 3)); }
    else { fx.relAdd(m, star, ri(2, 4), 'mừng cho bạn được thăng chức'); fx.moodAdd(m, ri(1, 3)); }
  }
  if (announcer.role === 'boss') b.say(announcer, star, PM.bossClose, { opt: true, em: E.boss, pe: 0.3 });
  fx.moodAdd(star, ri(8, 10)); fx.kpiAdd(star, ri(2, 4));
  if (boss) fx.relAdd(star, boss, ri(5, 7), bonusOnly ? 'được sếp thưởng' : 'được sếp thăng chức');
  fx.memo(star, bonusOnly ? `Được công bố thưởng trước cả công ty` : `Được thăng chức trước cả công ty`);
  if (boss) fx.memo(boss, `${bonusOnly ? 'Thưởng' : 'Thăng chức'} cho ${star.name} trước mọi người`);
  return pick([`Sếp công bố ${bonusOnly ? 'thưởng nóng' : 'thăng chức'} cho ${star.name} trước cả văn phòng.`,
    `${star.name} được ${bonusOnly ? 'thưởng' : 'thăng chức'}, đồng nghiệp người mừng người ganh.`]);
}

// ---------------------------------------------------------------- layoff (cắt giảm vì công ty lỗ — nhẹ nhàng, không chê năng lực)
const LO: Record<string, Tpl[]> = {
  bossOpen: [
    (c) => `${c.L} ngồi đi em. Hôm nay anh nói chuyện khó nói nhất từ hồi mở công ty.`,
    (c) => `Em ngồi đi. Chuyện này không phải vì em, mà vì con số của công ty.`,
    (c) => `Anh nói thẳng, vì vòng vo chỉ làm em thêm khổ: công ty phải cắt giảm.`,
    (c) => `Em biết dòng tiền tháng này rồi đó. Anh buộc phải cho một người nghỉ, và anh xin lỗi vì đó là em.`,
    (c) => `Anh đã cố giữ hết mọi người tới hôm nay. Hôm nay anh giữ không nổi nữa.`,
  ],
  hrOpen: [
    (c) => `${c.You} ngồi đi. ${c.Me} nói chuyện này mà tay ${c.me} còn run: công ty phải cắt giảm.`,
    (c) => `Chuyện hôm nay không vui, ${c.me} nói thẳng để ${c.you} đỡ hồi hộp: công ty lỗ, phải cho một người nghỉ.`,
    (c) => `${c.Me} xin lỗi trước, vì điều ${c.me} sắp nói không phải lỗi của ${c.you}.`,
  ],
  hrGentle: [
    (c) => `${c.Me} muốn ${c.you} hiểu: đây là cắt giảm vì công ty lỗ, không phải vì ${c.you} làm dở.`,
    (c) => `Hồ sơ của ${c.you} ${c.me} ghi "nghỉ do cắt giảm", chỗ mới sẽ hiểu.`,
    (c) => `Lương, phép, bảo hiểm ${c.me} tính đủ, không thiếu một đồng. Có gì ${c.you} hỏi ${c.me}.`,
    (c) => `${c.Me} xin lỗi ${c.you}. Nếu ${c.me} có cách khác, ${c.me} đã làm rồi.`,
    (c) => `${c.Me} viết thư giới thiệu cho ${c.you}, viết thật, viết hay.`,
  ],
  react: [
    (c) => `${c.da}${c.me}... ${c.me} hiểu. Mà vẫn hụt chân một chút${c.a}.`,
    (c) => `${c.da}vậy là tại doanh thu, không phải tại ${c.me}? ${c.You} nói thiệt nha${c.a}.`,
    (c) => `${c.da}${c.me} có đoán được, thấy sếp nhìn bảng số mấy ngày nay${c.a}.`,
    (c) => `${c.da}được rồi. ${c.Me} chỉ xin giữ liên lạc với mọi người${c.a}.`,
    (c) => `${c.da}${c.me} mới trả góp xong cái máy, đúng là đời${c.a}...`,
    (c) => `${c.da}cảm ơn ${c.you} đã nói thẳng. Nói thẳng dễ chịu hơn nói vòng${c.a}.`,
    (c) => (c.s.traits.humor >= 0.5 ? `${c.da}vậy chiều nay ${c.me} được về sớm hả${c.a}? Đùa thôi...` : null),
    (c) => `${c.da}${c.me} bàn giao gọn, không để ai phải mò${c.a}.`,
  ],
  mateSad: [
    (c) => `Trời... ${c.me} không ngờ luôn. Tối nay đi nhậu, ${c.me} bao.`,
    (c) => `${c.Xn} đi rồi ai ngồi chỗ đó cho ${c.me} tám đây.`,
    (c) => `Giữ liên lạc nha, có job là ${c.me} ném link liền.`,
    (c) => `Buồn ghê. Hôm nay ${c.me} không muốn làm gì nữa.`,
    (c) => `Mình còn nhóm chat mà, ${c.xn} đừng rời nhóm nha.`,
    (c) => (c.bossHere ? `Sếp... hết cách thiệt hả sếp?` : null),
  ],
  bossClose: [
    (c) => `Anh nợ em một lời cảm ơn và một bữa cơm. Khi nào công ty khá lại, anh gọi em đầu tiên.`,
    (c) => `Cửa ở đây mở với em. Anh nói thiệt, không phải câu cho đẹp.`,
    (c) => `Chúng ta vẫn là một gia đình, chỉ là tạm xa nhau một thời gian.`,
    (c) => `Em đi đâu cũng làm tốt. Anh tin vậy, và anh xin lỗi lần nữa.`,
  ],
  hrProc: [
    (c) => `Chiều nay ${c.you} bàn giao máy với tài khoản cho ${c.me}, từ từ thôi, không ai hối.`,
    (c) => `Giấy tờ ${c.me} làm xong rồi, ${c.you} coi lại rồi ký, có gì thắc mắc hỏi ${c.me}.`,
    (c) => `${c.Me} đặt lịch bàn giao chiều mai, hôm nay ${c.you} muốn về sớm cũng được.`,
  ],
  empEnd: [
    (c) => `${c.da}${c.me} cảm ơn anh chị. ${c.Me} xin phép ra dọn bàn, mai ${c.me} ghé chào mọi người${c.a}.`,
    (c) => `${c.da}${c.me} hiểu. Chúc công ty mình sớm khá lại, lúc đó nhớ gọi ${c.me}${c.a}.`,
    (c) => `${c.da}vậy ${c.me} bàn giao rồi về sớm. Tối nay ai rảnh đi nhậu, ${c.me}... không bao nha${c.a}.`,
    (c) => `${c.da}${c.me} không giận ai hết. Chỉ tiếc chưa kịp thấy công ty mình lên${c.a}.`,
    (c) => (c.sc.friendRef ? `${c.da}nhắn ${c.sc.friendRef} giùm ${c.me}, tối nay ${c.me} vẫn lên nhóm chat nha${c.a}.` : null),
  ],
};
function bLayoff(b: B, sc: SC, fx: FX): string {
  const boss = sc.cast.find((p) => p.role === 'boss') ?? null;
  const hr = sc.cast.find((p) => p.role === 'hr') ?? null;
  const emp = subjectEmployee(sc, [boss, hr].filter((p): p is P => !!p)) ?? sc.cast[sc.cast.length - 1];
  sc.x = emp;
  const lead = boss ?? hr ?? sc.cast.find((p) => p.id !== emp.id) ?? emp;
  const mates = sc.cast.filter((p) => p.id !== emp.id && p.id !== boss?.id && p.id !== hr?.id);
  b.say(lead, emp, lead.role === 'boss' ? LO.bossOpen : LO.hrOpen, { em: ['😔', '👔'], pe: 0.5 });
  if (hr && lead.id !== hr.id) b.say(hr, emp, LO.hrGentle, { em: E.sad, pe: 0.3 });
  b.say(emp, lead, LO.react, { em: ['😢', '😶', '🥲'], pe: 0.6 });
  if (hr) b.say(hr, emp, lead.id === hr.id ? LO.hrGentle : LO.hrProc, { opt: true, em: ['📋'], pe: 0.3 });
  for (const m of shuffle(mates).slice(0, 2)) {
    b.say(m, emp, LO.mateSad, { em: E.sad, pe: 0.5, opt: mates.length > 1 });
    fx.moodAdd(m, -ri(2, 4)); fx.relAdd(m, emp, ri(2, 4), 'thương bạn bị cắt giảm');
  }
  if (boss) b.say(boss, emp, LO.bossClose, { em: ['😔', '🤝'], pe: 0.4 });
  const friend = Object.entries(emp.a?.relationships ?? {}).filter(([id, r]) => id !== emp.id && r && r.score >= 15)
    .sort((a, z) => z[1].score - a[1].score).map(([id]) => sc.ctx.agents?.[id]).find((a) => a && a.status === 'active' && !sc.cast.some((p) => p.id === a.id));
  sc.friendRef = friend ? refOf(emp, toP(friend)) : '';
  b.say(emp, lead, LO.empEnd, { em: ['📦', '🥲'], pe: 0.5 });
  fx.moodAdd(emp, -ri(8, 10));
  if (boss) { fx.relAdd(emp, boss, -ri(2, 4), 'bị cắt giảm vì công ty lỗ'); fx.memo(boss, `Phải cắt giảm ${emp.name} vì công ty lỗ`); }
  if (hr) { fx.relAdd(emp, hr, ri(0, 2), 'HR lo chế độ tử tế'); fx.memo(hr, `Lo thủ tục cắt giảm cho ${emp.name}, không phải vì năng lực`); }
  fx.memo(emp, `Bị cắt giảm vì công ty lỗ, không phải vì làm dở; mọi người hứa giữ liên lạc`);
  return pick([`${emp.name} bị cắt giảm vì công ty lỗ; ${boss ? `sếp ${boss.name}` : hr?.name ?? 'công ty'} báo tin nhẹ nhàng, đồng nghiệp buồn.`,
    `Công ty lỗ phải cắt giảm ${emp.name}, cả phòng lặng đi.`]);
}

// ---------------------------------------------------------------- v5: họp xử lý tình huống (crisis_meeting)
/** phương án offline đã chọn sẵn (req.crisis.pick) — thoại phải khớp đúng nó */
function crisisPick(sc: SC): { code: string; label: string } {
  const cr = sc.req.crisis;
  const opts = cr?.options ?? [];
  return opts.find((o) => o.code === cr?.pick) ?? opts[0] ?? { code: 'plan_a', label: 'làm từng bước, theo dõi sát' };
}
const crTitle = (c: C): string => cut((c.sc.req.crisis?.title || 'chuyện công ty').toLowerCase(), 50);
const crNote = (c: C): string => cut(c.sc.req.crisis?.note || 'tình hình đang căng', 110);
const CM: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.Crowd} ngồi đi, chuyện gấp: ${crNote(c)}.`,
    (c) => `Không vòng vo nữa, ${crTitle(c)}. Mình phải quyết ngay trong buổi này.`,
    (c) => `${c.Me} gọi mọi người vô vì chuyện ${crTitle(c)}. Ai có ý gì nói thẳng.`,
    (c) => `Tình hình là vầy: ${crNote(c)}. Giờ tính sao?`,
  ],
  hr: [
    (c) => `${c.da}${c.me} lo nhất là tinh thần anh em, quyết gì cũng phải nói rõ ràng${c.a}.`,
    (c) => `${c.da}mấy hôm nay không khí chùng hẳn, ai cũng chạy qua hỏi ${c.me}${c.a}.`,
    (c) => `${c.da}quyết gì thì quyết, đừng để anh em nghe tin từ nhóm chat trước${c.a}.`,
    (c) => `${c.da}${c.me} chỉ xin một điều: đừng để ai thấy mình bị bỏ rơi${c.a}.`,
  ],
  sales: [
    (c) => `${c.da}bên ${c.me} còn mấy khách có thể chốt nhanh, nhưng cần chút ưu đãi${c.a}.`,
    (c) => `${c.da}khách giờ ai cũng thắt chặt, ${c.me} gọi mười cuộc được hai cuộc nghe máy${c.a}.`,
    (c) => `${c.da}tiền về hay không nằm ở công nợ, ${c.me} xin đi đòi trực tiếp${c.a}.`,
    (c) => `${c.da}khách mà nghe tin mình lục đục là họ chạy liền, phải giữ hình ảnh${c.a}.`,
  ],
  tech: [
    (c) => `${c.da}dev bên ${c.me} đang chạy ${c.project}, dồn thêm là trễ hạn chắc${c.a}.`,
    (c) => `${c.da}làm vội là có bug, ${c.me} nói trước để mọi người khỏi bất ngờ${c.a}.`,
    (c) => `${c.da}nếu cần, team ${c.me} tăng ca được vài hôm, nhưng không kéo dài được${c.a}.`,
    (c) => `${c.da}${c.me} cần biết thứ tự ưu tiên, chứ cái gì cũng gấp là không ai làm nổi${c.a}.`,
  ],
  mkt: [
    (c) => `${c.da}trên mạng người ta đang soi mình, nói gì cũng phải cẩn thận${c.a}.`,
    (c) => `${c.da}chuyện này xử khéo thì thành quảng cáo, xử vụng thì thành phốt${c.a}.`,
    (c) => `${c.da}${c.me} soạn sẵn hai bản trả lời rồi, chờ chốt hướng thôi${c.a}.`,
  ],
  center: [
    (c) => `${c.da}${c.me} xin nói thật: ${c.me} không cố ý làm khó ai${c.a}.`,
    (c) => `${c.da}${c.me} chỉ mong mọi người nghe ${c.me} nói hết đã${c.a}.`,
    (c) => `${c.da}${c.me} vẫn giữ ý của ${c.me}, nhưng ${c.me} nghe${c.a}.`,
    (c) => `${c.da}chuyện của ${c.me} làm phiền mọi người, ${c.me} ngại lắm${c.a}.`,
  ],
  push: [
    (c) => `${c.da}nhưng làm vậy anh em sẽ nghĩ sao${c.a}?`,
    (c) => `${c.da}cách đó nhanh, mà cái giá hơi đắt${c.a}.`,
    (c) => `${c.da}${c.me} sợ chữa cháy chỗ này lại cháy chỗ khác${c.a}.`,
    (c) => `${c.da}${c.me} không phản đối, chỉ xin tính trước đường lui${c.a}.`,
  ],
  decide: [
    (c) => `Rồi, chốt: ${crisisPick(c.sc).label}. Cách này hợp với tình hình nhất lúc này.`,
    (c) => (c.s.role === 'boss' ? `Anh quyết vậy: ${crisisPick(c.sc).label}. Có gì anh chịu trách nhiệm.` : null),
    (c) => `Nghe hết rồi. Phương án của mình: ${crisisPick(c.sc).label}.`,
    (c) => (c.s.role !== 'boss' ? `${c.Me} chốt thế này rồi báo sếp sau: ${crisisPick(c.sc).label}.` : null),
  ],
  ok: [
    (c) => `${c.da}${c.me} triển khai liền${c.a}.`,
    (c) => `${c.da}vậy ${c.me} lo phần của ${c.me}${c.a}.`,
    (c) => `${c.da}rõ rồi, ${c.me} báo anh em nhẹ nhàng thôi${c.a}.`,
    (c) => `${c.da}ok, có gì ${c.me} cập nhật liên tục${c.a}.`,
  ],
};
/** câu đệm của người chủ trì (giọng điều phối, không quyết thêm gì) */
const CM_CHAIR_FILL: Tpl[] = [
  (c) => `Ừ, nói tiếp đi.`,
  (c) => `Còn ai ý kiến gì nữa không?`,
  (c) => `Từ từ, từng người một.`,
  (c) => `Nói ngắn gọn thôi, mình còn phải quyết.`,
];
/** câu đệm của người dự họp (chưa có quyết định → không "triển khai liền") */
const CM_MEMBER_FILL: Tpl[] = [
  (c) => `${c.da}${c.me} đồng ý là phải xử lý sớm${c.a}.`,
  (c) => `${c.da}nghe mọi người nói ${c.me} thấy cũng có lý${c.a}.`,
  (c) => `${c.da}${c.me} xin nói thêm một ý thôi${c.a}.`,
];
function bCrisisMeeting(b: B, sc: SC, fx: FX): string {
  const cr = sc.req.crisis;
  const chair = sc.cast[0];
  const center = cr?.centerId ? sc.cast.find((p) => p.id === cr.centerId) ?? null : null;
  const members = sc.cast.filter((p) => p.id !== chair.id && p.id !== center?.id);
  const poolOf = (p: P): readonly Tpl[] => (p.role === 'hr' ? CM.hr : isSales(p) ? CM.sales : p.role === 'marketing' ? CM.mkt : TECH_ROLES.includes(p.role) ? CM.tech : CM.push);
  sc.x = center;
  b.say(chair, members[0] ?? center, CM.open, { em: ['🧯', '😤', '📊'], pe: 0.35 });
  if (center) b.say(center, chair, CM.center, { em: E.nervous, pe: 0.4 });
  for (const m of members.slice(0, 3)) b.say(m, chair, poolOf(m), { em: E.think, pe: 0.3 });
  const objector = members.find((m) => m.role !== 'hr') ?? center ?? members[0];
  if (objector) b.say(objector, chair, CM.push, { opt: true, em: E.think, pe: 0.3 });
  const pk = crisisPick(sc);
  b.say(chair, members[0] ?? center, CM.decide, { em: E.boss, pe: 0.4 });
  b.say(members[0] ?? center, chair, CM.ok, { em: E.ok, pe: 0.4 });
  fx.verdict = PLAN_VERDICTS.includes(pk.code as Verdict) ? (pk.code as Verdict) : 'plan_a';
  fx.memo(chair, `Chủ trì họp xử lý ${cut((cr?.title || 'tình huống').toLowerCase(), 40)}: chốt ${cut(pk.label, 50)}`);
  if (center) fx.memo(center, `Được gọi vào họp vì chuyện của mình, cuối cùng chốt ${cut(pk.label, 50)}`);
  // câu chốt cụ thể đã có ở dòng sự kiện 🧯 của Director → tóm tắt thẻ cảnh không lặp lại nhãn phương án
  return pick([
    `${chair.name} họp kín về ${cut((cr?.title || 'tình huống công ty').toLowerCase(), 50)}, tranh luận một hồi rồi cũng chốt được hướng đi.`,
    `Phòng họp căng như dây đàn: chuyện ${cut((cr?.title || 'công ty').toLowerCase(), 50)}, mỗi người một ý, ${chair.name} chốt hạ.`,
    `${chair.name} gom mọi người bàn chuyện ${cut((cr?.title || 'công ty').toLowerCase(), 50)}, ai cũng có lý của mình.`,
  ]);
}
const PLAN_VERDICTS: Verdict[] = ['plan_a', 'plan_b', 'plan_c', 'plan_d'];

// ---------------------------------------------------------------- v5: công tác tư tưởng (pep_talk)
const PT: Record<string, Tpl[]> = {
  open: [
    (c) => `${c.Crowd} ngồi xuống hết đi, hôm nay ${c.me} không nói chuyện KPI.`,
    (c) => `${c.Me} gom mọi người lại vì ${c.me} thấy dạo này ai cũng mệt.`,
    (c) => `Mười phút thôi, ${c.me} nói chuyện bằng cái tâm.`,
    (c) => `Chuyện ${crTitle(c)} ${c.me} biết hết, ${c.me} không giấu ai.`,
  ],
  oneOpen: [
    (c) => `${c.You} ngồi đi. ${c.Me} muốn nghe ${c.you} nói trước.`,
    (c) => `${c.Me} gọi ${c.you} vô không phải để mắng, yên tâm.`,
    (c) => `Dạo này ${c.me} thấy ${c.you} khác lắm. Có chuyện gì kể ${c.me} nghe.`,
  ],
  medOpen: [
    (c) => `Hai người ngồi xuống. Hôm nay nói hết ra, ra khỏi phòng này thì thôi.`,
    (c) => `${c.Me} không bênh ai. Mỗi người nói một lượt, không ngắt lời.`,
    (c) => `Công ty có mấy người mà chia hai phe, ${c.me} nhìn mà mệt thay.`,
  ],
  story: [
    (c) => (c.s.role === 'boss' ? `Hồi mới mở công ty, anh với hai thằng bạn ngồi quán cóc, laptop cắm nhờ điện quán trà đá.` : null),
    (c) => `Công ty mình như con thuyền, sóng lớn thì càng phải chèo chung nhịp.`,
    (c) => (c.s.role === 'boss' ? `Chúng ta là một gia đình. Gia đình thì có lúc khó, nhưng không bỏ nhau.` : null),
    (c) => (c.s.role === 'boss' ? `Đánh golf anh học được một điều: cú quan trọng nhất là cú tiếp theo.` : null),
    (c) => `${c.Me} không hứa hão: qua đợt này, ai gồng cùng, ${c.me} nhớ hết.`,
    (c) => (c.s.role !== 'boss' ? `${c.Me} không nói hay được như sếp, ${c.me} chỉ nói thật lòng.` : null),
  ],
  moved: [
    (c) => `${c.da}nghe ${c.you} nói vậy ${c.me} thấy có động lực lại thiệt${c.a}.`,
    (c) => `${c.da}${c.me} hiểu rồi, ${c.me} sẽ cố thêm chút nữa${c.a}.`,
    (c) => `${c.da}lâu lắm mới thấy ${c.you} nói chuyện kiểu này, ${c.me} cảm động thật${c.a}.`,
    (c) => `${c.da}vậy là ${c.me} yên tâm rồi${c.a}.`,
  ],
  meh: [
    (c) => `${c.da ? 'Dạ… ' : 'Ờ… '}${c.me} nghe rồi${c.a}.`,
    (c) => `${c.da}câu "gia đình" này ${c.me} nghe lần thứ mấy rồi ta${c.a}.`,
    (c) => `${c.da}${c.me} hiểu, mà ${c.me} vẫn mệt${c.a}.`,
    (c) => `${c.da}nói thì dễ, làm mới khó${c.a}.`,
  ],
  ask: [
    (c) => `${c.da}vậy lương thưởng tháng này có gì thay đổi không${c.a}?`,
    (c) => `${c.da}"qua đợt này" là bao lâu vậy${c.a}?`,
    (c) => `${c.da}${c.me} hỏi thẳng nha: công ty có tính cắt người không${c.a}?`,
  ],
  answer: [
    (c) => `Câu hỏi hay. ${c.Me} trả lời thật: ${c.me} đang lo, và sẽ báo mọi người từng bước.`,
    (c) => `Không ai phải lo mất việc vì chuyện này, ${c.me} nói rõ luôn.`,
    (c) => `Thưởng thì chưa hứa được, nhưng cuối tuần ${c.me} khao cả nhà.`,
  ],
  /** 1:1 — trả lời đúng người đang ngồi trước mặt, không nói chuyện "cả công ty" */
  answerOne: [
    (c) => `${c.Me} hiểu. Có gì cứ nói thẳng với ${c.me}, đừng để bụng rồi nói ở nhóm chat.`,
    (c) => `${c.You} góp ý đúng, mà mình nói đúng chỗ, đúng lúc nha.`,
    (c) => `${c.Me} ghi nhận. Tuần này ${c.me} với ${c.you} tính lại cho hợp lý.`,
    (c) => `${c.Me} không cần ${c.you} đồng ý ngay, chỉ cần ${c.you} biết ${c.me} đang nghe.`,
  ],
  /** hoà giải: một bên chìa tay / vẫn còn căng (nói với người kia) */
  medYes: [
    (c) => `${c.da}thôi, ${c.me} cũng có lỗi. Trưa nay đi ăn chung không${c.a}?`,
    (c) => `${c.da}${c.me} xin lỗi vụ nhóm chat. Từ giờ có gì nói thẳng với nhau${c.a}.`,
    (c) => `${c.da}bắt tay cái cho ${c.hrRef} yên tâm, ly trà sữa chiều nay ${c.me} bao${c.a}.`,
  ],
  medNo: [
    (c) => `${c.da}${c.me} nghe rồi, mà để từ từ${c.a}.`,
    (c) => `${c.da}${c.me} làm việc bình thường, còn thân thì chưa được${c.a}.`,
    (c) => `${c.da}${c.me} vẫn thấy mình không sai, nhưng ${c.me} sẽ không nói nữa${c.a}.`,
  ],
  complain: [
    (c) => `${c.da}${c.me} chỉ muốn ${c.xn} tôn trọng công việc của ${c.me}${c.a}.`,
    (c) => `${c.da}${c.me} không ghét ai, chỉ là bị nói sau lưng nhiều quá${c.a}.`,
    (c) => `${c.da}chuyện bắt đầu từ cái nhóm chat, đâu phải từ ${c.me}${c.a}.`,
  ],
  yesClose: [
    (c) => `Vậy nha, mình làm tiếp. Chiều nay trà sữa ${c.me} bao.`,
    (c) => (c.sc.cast.length > 2 ? `Cảm ơn mọi người đã nghe. ${c.Me} tin mình qua được.` : `Cảm ơn ${c.you} đã nói thật. ${c.Me} tin mình qua được.`),
    (c) => `Rồi, vậy là rõ. Có gì cửa phòng ${c.me} luôn mở.`,
  ],
  noClose: [
    (c) => `${c.da}vậy ${c.me} về chỗ làm tiếp${c.a}.`,
    (c) => `${c.da}${c.me} về suy nghĩ thêm${c.a}.`,
    (c) => `${c.da}${c.me} nghe rồi, mà để từ từ${c.a}.`,
  ],
};
/** câu đệm của người nói (sếp / lead / HR đang truyền lửa) */
const PT_SPEAKER_FILL: Tpl[] = [
  (c) => `${c.Me} nói vậy thôi, ai có ý gì cứ nói.`,
  (c) => `Cứ từ từ, ${c.me} nghe đây.`,
  (c) => `Mình nói chuyện thẳng thắn với nhau nha.`,
];
/** câu đệm của người nghe */
const PT_LISTENER_FILL: Tpl[] = [
  (c) => `${c.da}${c.me} nghe đây${c.a}.`,
  (c) => `${c.da}${c.me} hiểu ý ${c.you} rồi${c.a}.`,
  (c) => `${c.da}${c.me} ghi nhận${c.a}.`,
];
function bPepTalk(b: B, sc: SC, fx: FX): string {
  const cr = sc.req.crisis;
  const sp = sc.cast[0];
  const aud = sc.cast.filter((p) => p.id !== sp.id);
  const yes = (cr?.pick ?? 'inspired') !== 'unmoved';
  const variant = cr?.variant ?? 'all';
  if (variant === 'mediate' && aud.length >= 2) {
    const [x, y] = aud;
    b.say(sp, x, PT.medOpen, { em: E.think, pe: 0.3 });
    b.say(x, sp, PT.complain, { em: E.annoy, pe: 0.4, x: y });
    b.say(y, sp, PT.complain, { em: E.annoy, pe: 0.4, x });
    b.say(sp, null, PT.story, { em: E.polite, pe: 0.3 });
    b.say(yes ? x : y, yes ? y : x, yes ? PT.medYes : PT.medNo, { em: yes ? E.happy : E.annoy, pe: 0.5 });
    if (yes) { fx.relAdd(x, y, ri(3, 6), 'ngồi lại nói chuyện, làm lành'); fx.relAdd(y, x, ri(3, 6), 'ngồi lại nói chuyện, làm lành'); }
    else { fx.relAdd(x, y, -ri(1, 3), 'hoà giải không thành'); }
  } else {
    const one = variant === 'one' && aud.length >= 1;
    b.say(sp, aud[0], one ? PT.oneOpen : PT.open, { em: E.boss, pe: 0.35 });
    b.say(sp, aud[0], PT.story, { em: E.polite, pe: 0.3 });
    const reactors = aud.slice(0, one ? 1 : 4);
    let asked = false;
    for (const a of reactors) {
      const moved = yes ? chance(0.7) : chance(0.25);
      const ask = !moved && chance(0.5);
      if (ask) asked = true;
      b.say(a, sp, moved ? PT.moved : ask ? PT.ask : PT.meh, { em: moved ? E.happy : E.think, pe: 0.4 });
      if (moved) { fx.moodAdd(a, ri(2, 4)); fx.relAdd(a, sp, ri(1, 3), 'được nói chuyện thật lòng'); } else fx.moodAdd(a, -ri(0, 2));
    }
    // có người hỏi thì phải có câu trả lời (không bị cắt); nói riêng 1:1 cũng giữ để câu kết không dính vào câu phản ứng
    b.say(sp, aud[0], one ? PT.answerOne : PT.answer, { opt: !asked && !one, em: E.boss, pe: 0.3 });
    // chưa xuôi: câu kết do người phản ứng ĐẦU (khác người vừa nói cuối) → không gộp thành "Dạ …? Dạ, em nghe rồi"
    const closer = yes ? sp : aud[0] ?? sp;
    b.say(closer, sp, yes ? PT.yesClose : PT.noClose, { em: yes ? E.happy : E.tired, pe: 0.5 });
  }
  fx.verdict = yes ? 'inspired' : 'unmoved';
  fx.memo(sp, yes ? 'Làm công tác tư tưởng, mọi người xuôi' : 'Làm công tác tư tưởng mà mọi người chưa xuôi');
  return variant === 'mediate' ? `${sp.name} ngồi giữa hoà giải${yes ? ', hai bên làm lành' : ', hai bên vẫn căng'}.`
    : `${sp.name} làm công tác tư tưởng${yes ? ', mọi người xuôi dần' : ', người nghe chưa xuôi'}.`;
}

// =====================================================================
//  11. Lắp ráp cảnh: dựng ngữ cảnh → kịch bản → sản phẩm → đủ số câu → giọng kênh
// =====================================================================
const BUILDERS: Record<SceneType, (b: B, sc: SC, fx: FX) => string> = {
  pantry_chat: bPantry, desk_visit: bDeskVisit, gossip: bGossip, group_chat: bGroup, company_chat: bCompany,
  standup: bStandup, lunch: bLunch, boss_catch: bCatch, boss_call: bBossCall, hr_warning: bHrWarning,
  firing: bFiring, interview: bInterview, incident: bIncident, celebration: bCelebration, confront: bConfront,
  pingpong_match: bPingpong, welcome: bWelcome, showroom_chat: bShowroom,
  // v3
  news_chat: bNews, hr_review: bHrReview, resign_talk: bResign, raise_request: bRaise, promotion: bPromotion, layoff: bLayoff,
  // v5
  crisis_meeting: bCrisisMeeting, pep_talk: bPepTalk,
};
const TYPE_CATS: Partial<Record<SceneType, TopicCategory[]>> = {
  promotion: ['giai_tri', 'an_uong'],
  pantry_chat: ['doi_song', 'van_phong', 'giai_tri', 'tien_bac', 'tinh_cam', 'cong_nghe', 'an_uong', 'drama'],
  desk_visit: ['van_phong', 'cong_nghe', 'doi_song', 'tien_bac', 'giai_tri'],
  lunch: ['an_uong', 'doi_song', 'giai_tri', 'tien_bac', 'tinh_cam', 'drama'],
  group_chat: ['giai_tri', 'tien_bac', 'doi_song', 'tinh_cam', 'van_phong', 'cong_nghe', 'an_uong', 'drama'],
  gossip: ['drama'],
  pingpong_match: ['giai_tri', 'doi_song', 'tien_bac'],
  welcome: ['doi_song', 'an_uong', 'van_phong'],
  celebration: ['giai_tri', 'an_uong'],
};
function topicCatsFor(type: SceneType, cast: P[]): TopicCategory[] | undefined {
  const base = TYPE_CATS[type];
  if (type !== 'desk_visit' || !cast[0]) return base;
  const r = cast[0].role;
  return [...(base ?? []), ...(isDev(cast[0]) || r === 'qa' ? ['cong_viec_dev' as const] : []), ...(isSales(cast[0]) ? ['cong_viec_sales' as const] : [])];
}
const anyWord = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const CAT_GUESS: [RegExp, TopicCategory][] = [
  [anyWord(['drama', 'tin đồn', 'nghỉ việc', 'tăng lương', 'phỏng vấn', 'nói xấu']), 'drama'],
  [anyWord(['vàng', 'lương', 'tiền', 'crypto', 'coin', 'chứng khoán', 'tiết kiệm', 'trả góp', 'thưởng', 'lãi suất']), 'tien_bac'],
  [anyWord(['ăn', 'cơm', 'bún', 'phở', 'trà sữa', 'cà phê', 'lẩu', 'bánh', 'ốc', 'chè', 'mì']), 'an_uong'],
  [anyWord(['bug', 'code', 'deploy', 'merge', 'API', 'server', 'database', 'test', 'production', 'PR']), 'cong_viec_dev'],
  [anyWord(['khách', 'deal', 'doanh số', 'hợp đồng', 'báo giá', 'hoa hồng']), 'cong_viec_sales'],
  [anyWord(['crush', 'người yêu', 'cưới', 'hẹn hò', 'xem mắt', 'ế']), 'tinh_cam'],
  [anyWord(['phim', 'game', 'TikTok', 'nhạc', 'concert', 'bóng đá', 'karaoke', 'livestream', 'meme', 'show']), 'giai_tri'],
  [anyWord(['điện thoại', 'laptop', 'AI', 'app', 'công nghệ', 'bàn phím', 'đồng hồ']), 'cong_nghe'],
  [anyWord(['máy lạnh', 'máy in', 'họp', 'chấm công', 'văn phòng', 'pantry', 'thang máy', 'team building', 'wifi']), 'van_phong'],
  [anyWord(['kẹt xe', 'mưa', 'trọ', 'mèo', 'quê', 'Tết', 'gym', 'chạy bộ']), 'doi_song'],
];
function guessCategory(topic: string): TopicCategory | null {
  for (const [re, cat] of CAT_GUESS) if (re.test(topic)) return cat;
  return null;
}
function locOf(sc: SC): Loc {
  const test = (t: string): Loc | null => {
    if (/cà phê|coffee|máy pha/u.test(t)) return 'coffee';
    if (/máy nước|bình nước|nước lọc|water/u.test(t)) return 'water';
    if (/tủ lạnh|snack|ăn vặt|kệ bánh|fridge/u.test(t)) return 'snack';
    if (/chill|sofa|lounge|bean/u.test(t)) return 'lounge';
    if (/cửa sổ|window|ban công/u.test(t)) return 'window';
    if (/kpi/u.test(t)) return 'kpi';
    if (/bàn ăn|pantry_table/u.test(t)) return 'table';
    return null;
  };
  return test(norm(sc.req.locationLabel || '')) ?? test(sc.sit) ?? 'pantry';
}
/** "Sếp đi đánh golf · dự kiến về khoảng 15:21" -> "sếp đi đánh golf đó, chắc 15:21 mới về" */
function bossNoteText(note: string): string {
  const [reason, ...rest] = note.split(/\s+[·•|–-]\s+/u);
  const back = rest.join(' ').match(/(\d{1,2}[:h]\d{2})/u)?.[1];
  const r = lowerFirst(reason.trim().replace(/[.!…]+$/u, ''));
  return back ? `${r} đó, chắc ${back} mới về` : `${r} đó`;
}
const fmtTime = (m: number): string => {
  const v = Number.isFinite(m) ? ((m % 1440) + 1440) % 1440 : 600;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
};
function indexOfName(text: string, name: string): number {
  if (!name || name.length < 2) return -1;
  const m = wre(name, 'u').exec(text);
  return m ? m.index : -1;
}

const BACKGROUND_LINE = /^\s*(Chuyện mới trong ngày|Có thể lồng thói quen)/u;
/** Director: 'Vừa release xong "X"', 'vừa release "X"' */
const RELEASED_RE = /release(?:\s+xong)?\s+"([^"]{2,90})"/iu;

function buildSC(req: SceneRequest, ctx: PromptContext): SC {
  const ids = [...new Set((Array.isArray(req.participants) ? req.participants : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const cast = ids.map((id) => personOf(id, ctx));
  const extra = Array.isArray(req.extra) ? req.extra.filter((v): v is string => typeof v === 'string') : [];
  const situation = typeof req.situation === 'string' ? req.situation : '';
  const sitRaw = [situation, ...extra].join(' \n ').normalize('NFC');
  // Từ khoá kích hoạt (has()) + người được nhắc chỉ lấy từ tình huống chính và chi tiết từng người;
  // dòng nền ("Chuyện mới trong ngày: …", "Có thể lồng thói quen …") không phải là lý do của cảnh
  // (vd "Sếp ra ngoài" từ 2 tiếng trước không được biến mọi nhóm chat thành "sếp vừa đi").
  const sitTrig = [situation, ...extra.filter((l) => !BACKGROUND_LINE.test(l))].join(' \n ').normalize('NFC');
  const agents = Object.values(ctx?.agents ?? {}).filter((a): a is AgentState => !!a && typeof a.name === 'string');
  const named = agents.map((a) => ({ a, i: indexOfName(sitTrig, a.name) })).filter((v) => v.i >= 0)
    .sort((p, q) => p.i - q.i).map((v) => toP(v.a));
  // cảnh về một dự án VỪA release: nói về dự án đó, không phải dự án mới vừa nhận
  const released = RELEASED_RE.exec(sitTrig)?.[1]?.trim();
  const releasedInfo = released ? PROJECT_POOL.find((p) => norm(p.name) === norm(released)) : undefined;
  const aboutId = req.aboutId ?? req.rumor?.aboutId;
  const aboutAgent = aboutId ? ctx?.agents?.[aboutId] : undefined;
  const type: SceneType = BUILDERS[req.type] ? req.type : 'pantry_chat';
  const channel = req.channel === 'group' || req.channel === 'company' ? req.channel : 'office';
  const recent = Array.isArray(ctx?.recentSummaries) ? ctx.recentSummaries.filter((s) => typeof s === 'string') : [];
  // gợi ý chủ đề của Director: bỏ phần chỉ dẫn trong ngoặc ở cuối (nếu có) — thoại không được đọc chỉ dẫn nội bộ
  const hintRaw = typeof req.topicHint === 'string' ? req.topicHint.replace(/\s*\([^()]*\)\s*$/u, '').trim() : '';
  const topic = hintRaw || pickTopic(topicCatsFor(type, cast), recent);
  const proj = ctx?.company?.project;
  const fallbackProj = pick(PROJECT_POOL);
  const day = Number.isFinite(ctx?.day) ? ctx.day : 1;
  const daysLeft = proj && Number.isFinite(proj.deadlineDay) ? Math.round(proj.deadlineDay - day) : 3;
  const comp = ctx?.company;
  const sc: SC = {
    req, ctx: ctx ?? ({} as PromptContext), type, channel, cast,
    x: aboutAgent ? toP(aboutAgent) : null,
    sit: norm(sitTrig), sitRaw, named, names: new Set(agents.map((a) => a.name)),
    topic, topicCat: topicCategoryOf(topic) ?? guessCategory(topic),
    food: pick(FOODS), drink: pick(DRINKS), snack: pick(SNACKS), bug: pick(BUGS), feature: pick(FEATURES),
    err: pick(ERRORS), item: pick(ITEMS), screen: pick(SCREENS), excuse: pick(EXCUSES), excuseDaily: pick(EXCUSES_DAILY), ticket: ri(120, 980),
    project: released || proj?.name || fallbackProj.name,
    client: released ? (releasedInfo?.client || 'khách hàng') : (proj?.client || fallbackProj.client),
    daysLeft,
    deadlineText: released ? 'vừa bàn giao xong'
      : daysLeft > 1 ? `còn ${daysLeft} ngày là tới hạn` : daysLeft === 1 ? 'mai là tới hạn'
        : daysLeft === 0 ? 'hôm nay là hạn chót' : `đã trễ hạn ${-daysLeft} ngày`,
    time: typeof ctx?.timeLabel === 'string' && ctx.timeLabel ? ctx.timeLabel : fmtTime(ctx?.minuteOfDay ?? 600),
    companyShort: (ctx?.companyName || 'Cty TNHH VibeCorp').replace(/^(cty|công ty)\s+(tnhh\s+)?/iu, '').trim() || 'công ty',
    revenueText: comp && Number.isFinite(comp.revenueMonth)
      ? `${Math.round(comp.revenueMonth)} trên ${Math.round(comp.revenueTarget || 1500)} triệu` : '420 trên 1500 triệu',
    bossNoteLow: ctx?.bossAway && typeof ctx.bossNote === 'string' && ctx.bossNote.trim() ? bossNoteText(ctx.bossNote) : '',
    loc: 'pantry', targetAct: '', subjAct: 'lướt TikTok', victimAct: '', victimKpi: 0, histText: '', warnCount: 0,
    lowPct: pctOf(Number.isFinite(CONFIG.kpiLowRatio) ? CONFIG.kpiLowRatio : 0.7), friendRef: '', deskItem: '',
    fixerName: '', blameRef: '', cheer: false, incRelease: false,
    nTitle: cut(typeof req.news?.title === 'string' ? req.news.title.replace(/["“”]/g, '') : '', 90),
    nSource: cut(typeof req.news?.source === 'string' && req.news.source.trim() ? req.news.source : 'báo', 30),
    nCat: req.news && NEWS_CATS.includes(req.news.category) ? req.news.category : null,
    focus: null, action: 'none',
    kin: new Map(), usedT: new Set(), lines: [],
  };
  sc.loc = locOf(sc);
  return sc;
}

// --- sản phẩm affiliate: đúng 1 câu product:true, ưu tiên preferSpeaker
//  Chế độ "mention" = người nói CHƯA có món (người đã có → PRODUCT_OWNER): chỉ "đang tính / để ý / nghe kể", không "mua rồi,
//  xài rồi" — sau cảnh, Director có thể cho người đó chốt đơn thật (vài giờ sau "hàng về"), nên lời nói phải khớp sổ đồ.
const PRODUCT_OFFICE: ((c: C, pn: string, pt: string) => string)[] = [
  (c, pn, pt) => `${c.Me} đang tính sắm ${pn}, nghe nói ${pt}.`,
  (c, pn, pt) => `Nói chứ ${c.me} để ý ${pn} lâu rồi, ${pt}.`,
  (c, pn, pt) => `${c.Yn} thử coi ${pn} đi, ${pt}.`,
  (c, pn, pt) => `Hôm bữa ${c.me} thấy ${pn} trên mạng, ${pt}, đang nằm trong giỏ hàng.`,
  (c, pn, pt) => `Bởi vậy ${c.me} mới tính mua ${pn}, ${pt}.`,
  (c, pn, pt) => `Hay ${c.you} sắm ${pn} đi, ${pt}, ${c.me} cũng đang tính.`,
  (c, pn, pt) => `Nhóm bạn ${c.me} có người dùng ${pn}, nghe kể ${pt}.`,
];
const PRODUCT_PARTY: ((c: C, pn: string, pt: string) => string)[] = [
  (c, pn, pt) => `Lần sau ăn mừng phải có ${pn} nha, ${pt}.`,
  (c, pn, pt) => `Nói chứ tiệc mà có ${pn} là vui hẳn, ${pt}.`,
  (c, pn, pt) => `${c.Me} đang tính sắm ${pn}, ${pt}, lần sau mang lên góp vui.`,
];
const PRODUCT_CHAT: ((c: C, pn: string, pt: string) => string)[] = [
  (c, pn, pt) => `ê ${c.crowd} ơi, ${c.me} đang tính chốt đơn ${pn}, ${pt} 🛒`,
  (c, pn, pt) => `ai cần ${pn} hông, ${pt}, ${c.me} thấy review khen nhiều`,
  (c, pn, pt) => `${c.me} mới thấy ${pn} nè, ${pt} 👀`,
];
const PRODUCT_REACT: Tpl[] = [
  (c) => `Nghe hấp dẫn ta, để ${c.me} coi thử.`,
  (c) => `${c.You} lại dụ ${c.me} xài tiền nữa rồi.`,
  (c) => `Cho ${c.me} xin tên shop với.`,
  (c) => `Thiệt hông đó? Vậy chắc ${c.me} cũng sắm thử.`,
  (c) => `Lương về là ${c.me} chốt liền.`,
  (c) => `Ủa nghe được đó, ${c.me} đang cần.`,
];
const PRODUCT_REACT_CHAT: Tpl[] = [
  (c) => `cho xin tên shop với 🙏`,
  (c) => `nghe ngon vậy, lương về chốt`,
  (c) => `lại dụ dỗ ae tiêu tiền 😂`,
  (c) => `${c.me} cũng đang tính mua nè`,
];
// v4 (docs/04 §11): câu nhắc theo "kiểu chuyện" — có cớ (hook), người đã có món kể lại, khui hộp, tặng quà
type PTpl = (c: C, pn: string, pt: string) => string;
type HTpl = (c: C, pn: string, pt: string, hk: string) => string;
// cớ (hk) có thể là than phiền ("ngủ trưa gục bàn dậy là ê cổ") hoặc thông báo của "vụ mua sắm" ("sếp phát động thi góc làm việc
// đẹp nhất") → mọi câu phải đúng ngữ pháp với BẤT KỲ mệnh đề nào ("Vụ <cớ> á…", "Nói tới chuyện <cớ>…"), không "<cớ> hoài"
const PRODUCT_HOOK: HTpl[] = [
  (c, pn, pt, hk) => `Vụ ${hk} á, ${c.you} thử cái ${pn} đi, ${pt}.`,
  (c, pn, pt, hk) => `Nói tới chuyện ${hk} mới nhớ, có cái ${pn}, ${pt}, ${c.me} đang tính chốt.`,
  (c, pn, pt, hk) => `Chuyện ${hk} đó, ${c.me} đang để ý cái ${pn}, ${pt}.`,
];
const PRODUCT_HOOK_CHAT: HTpl[] = [
  (c, pn, pt, hk) => `vụ ${hk} á, ${c.me} đang tính đặt cái ${pn}, ${pt} 🛒`,
  (c, pn, pt, hk) => `nhắc vụ ${hk} mới nhớ, ai cần ${pn} hông, ${pt}`,
];

/**
 * Pitch catalogue ("Ấm siêu tốc hai lớp công suất 1800W…") → mệnh đề nói được (≤ 40 ký tự, bỏ phần lặp lại tên gọi đời thường):
 * tránh câu "cái ấm siêu tốc, ấm siêu tốc hai lớp công suất 1800W" đọc như quảng cáo. Không ra được thì ''.
 */
function spokenPitch(pitch: string, short: string): string {
  const sw = new Set(norm(short).split(/\s+/).filter(Boolean));
  for (const clause of String(pitch ?? '').replace(/\s+/g, ' ').trim().replace(/[.!…]+$/u, '').split(/\s*[,;:(]\s*/u)) {
    const words = clause.split(' ').filter(Boolean);
    let i = 0;
    while (i < words.length && sw.has(norm(words[i]))) i++;
    const rest = words.slice(i);
    if (i === 0 && rest.filter((x) => sw.has(norm(x))).length >= 2) continue; // mệnh đề vẫn nhắc lại tên
    let out = '';
    for (const x of rest) {
      if (`${out} ${x}`.trim().length > 40) break;
      out = `${out} ${x}`.trim();
    }
    if (out.split(' ').length >= 2) return lowerFirst(out.replace(/[)\]]+$/u, ''));
  }
  return '';
}
const PRODUCT_OWNER: PTpl[] = [
  (c, pn, pt) => `Hồi đầu ${c.me} mua cái ${pn} cho vui thôi, ai ngờ dùng ổn bất ngờ, ${pt}.`,
  (c, pn, pt) => `${c.Me} có cái ${pn} rồi nè, tưởng thường thôi mà dùng thấy đáng, ${pt}.`,
  (c, pn, pt) => `${c.You} hỏi đúng người rồi, cái ${pn} ${c.me} đang dùng đây, ${pt}.`,
  (c, pn) => `Cái ${pn} ${c.me} mua về mà người nhà mượn luôn không trả, đủ hiểu rồi đó.`,
  (c, pn, pt) => `Định mua cái ${pn} làm quà, ai dè ${c.me} dùng thử rồi giữ luôn, ${pt}.`,
];
const PRODUCT_OWNER_CHEAP: PTpl[] = [
  (c, pn, pt) => `Cái ${pn} giá mềm mà dùng thấy được lắm ${c.you}, ${pt}.`,
  (c, pn) => `Nói thiệt, cái ${pn} rẻ bất ngờ mà ${c.me} dùng không chê được chỗ nào.`,
];
const PRODUCT_UNBOX: PTpl[] = [
  (c, pn, pt) => `Hàng về rồi nè, cái ${pn} ${c.me} đặt hôm bữa, ${pt}.`,
  (c, pn, pt) => `Shipper vừa giao cái ${pn}, mở ra coi chung nè, ${pt}.`,
  (c, pn, pt) => `Khui hộp nè ${c.you}, cái ${pn} đây, ${pt}.`,
];
const PRODUCT_GIFT: PTpl[] = [
  (c, pn, pt) => `Quà cho ${c.you} nè, cái ${pn}, ${pt}, mở ra coi có thích không.`,
  (c, pn, pt) => `Tặng ${c.you} cái ${pn} nè, ${pt}, đừng chê nha.`,
  (c, pn) => `${c.Me} lựa mãi mới chọn được cái ${pn} cho ${c.you} đó, mở đi.`,
];

/** mệnh đề nói được: `spoken` trong data (viết tay) → rút từ pitch → '' */
function spokenOf(pr: NonNullable<SceneRequest['product']>, pn: string): string {
  const sp = typeof pr.spoken === 'string' ? pr.spoken.replace(/\s+/g, ' ').trim().replace(/[.!…]+$/u, '') : '';
  return sp ? lowerFirst(cut(sp, 60)) : spokenPitch(typeof pr.pitch === 'string' ? pr.pitch : '', pn);
}
/** khi không rút được mệnh đề nào: chỉ người đã có món mới được nói "dùng thích" */
const PT_FALLBACK = { owner: 'dùng thích lắm', unboxing: 'nhìn ngoài xịn hơn trong hình', other: 'review khen nhiều lắm' } as const;

/** Bộ câu mẫu theo chế độ / kênh / có cớ hay không */
function productTpls(sc: SC): ((c: C) => string)[] {
  const pr = sc.req.product!;
  const pn = typeof pr.short === 'string' && pr.short.trim() ? pr.short.trim() : lowerFirst(pr.name.trim());
  const pt = spokenOf(pr, pn) || PT_FALLBACK[pr.mode === 'owner' ? 'owner' : pr.mode === 'unboxing' ? 'unboxing' : 'other'];
  const hk = typeof pr.hook === 'string' && pr.hook.trim() ? lowerFirst(pr.hook.trim().replace(/[.!…]+$/u, '')) : '';
  const P = (list: PTpl[]) => list.map((f) => (c: C) => f(c, pn, pt));
  const H = (list: HTpl[]) => list.map((f) => (c: C) => f(c, pn, pt, hk));
  if (pr.mode === 'unboxing') return P(PRODUCT_UNBOX);
  if (pr.mode === 'gift') return P(PRODUCT_GIFT);
  if (pr.mode === 'owner') return P(pr.priceFeel === 're' || pr.priceFeel === 'vua' ? [...PRODUCT_OWNER, ...PRODUCT_OWNER_CHEAP] : PRODUCT_OWNER);
  if (sc.channel === 'group') return hk ? [...H(PRODUCT_HOOK_CHAT), ...P(PRODUCT_CHAT)] : P(PRODUCT_CHAT);
  if (sc.type === 'celebration') return P([...PRODUCT_PARTY, ...PRODUCT_OFFICE.slice(0, 2)]);
  return hk ? [...H(PRODUCT_HOOK), ...H(PRODUCT_HOOK), ...P(PRODUCT_OFFICE)] : P(PRODUCT_OFFICE);
}

/** Builder tự chèn câu sản phẩm ngay tại nhịp hợp lý (insertProduct sẽ bỏ qua nếu đã có) */
function sayProduct(b: B, sc: SC, speaker?: P, listener?: P): boolean {
  const pr = sc.req.product;
  if (!pr || typeof pr.name !== 'string' || !pr.name.trim() || sc.lines.some((l) => l.product)) return false;
  const sp = (pr.preferSpeaker && sc.cast.find((p) => p.id === pr.preferSpeaker)) || speaker || sc.cast[0];
  const d = b.make(sp, listener && listener.id !== sp.id ? listener : b.partnerOf(sp), productTpls(sc), { em: ['😍', '👍', '🛒'], pe: 0.4 });
  if (!d) return false;
  d.product = true;
  sc.lines.push(d);
  return true;
}
function insertProduct(b: B, sc: SC): void {
  const pr = sc.req.product;
  if (!pr || typeof pr.name !== 'string' || !pr.name.trim() || sc.lines.some((l) => l.product)) return;
  const speaker = (pr.preferSpeaker && sc.cast.find((p) => p.id === pr.preferSpeaker))
    || sc.cast.find((p) => p.role === 'marketing') || sc.cast.find((p) => p.role !== 'boss') || sc.cast[0];
  const L = sc.lines;
  const n = L.length;
  // chỗ chèn tốt: không tách cặp hỏi–đáp, không ngay sau câu hỏi, không kề câu của chính người nói, ưu tiên trước câu chốt
  let best: number[] = [];
  let bestScore = -Infinity;
  for (let pos = Math.min(1, n); pos <= Math.max(Math.min(1, n), n - 1); pos++) {
    const prev = L[pos - 1], next = L[pos];
    let score = 0;
    if (prev && next && ((prev.grp !== undefined && prev.grp === next.grp) || next.dep === prev)) score -= 5;
    if (prev && QUESTION_END.test(prev.text)) score -= 3;
    if (prev?.sp.id === speaker.id) score -= 2;
    if (next?.sp.id === speaker.id) score -= 1;
    if (pos === n - 1) score += 2;
    if (pos >= 2) score += 1;
    if (score > bestScore) { bestScore = score; best = [pos]; } else if (score === bestScore) best.push(pos);
  }
  const pos = best.length ? pick(best) : n;
  const prevSp = L[pos - 1]?.sp;
  const listener = prevSp && prevSp.id !== speaker.id ? prevSp : sc.cast.find((p) => p.id !== speaker.id) ?? speaker;
  const d = b.make(speaker, listener, productTpls(sc), { em: ['😍', '👍', '🛒'], pe: 0.4 });
  if (!d) return;
  d.product = true;
  L.splice(pos, 0, d);
  const after = L[pos + 1]?.sp;
  const mustReact = after?.id === speaker.id;
  const reactors = sc.cast.filter((p) => p.id !== speaker.id && p.role !== 'boss');
  const reactor = reactors.find((p) => p.id !== after?.id) ?? reactors[0] ?? sc.cast.find((p) => p.id !== speaker.id);
  if (reactor && (mustReact || chance(0.75))) {
    const r = b.make(reactor, speaker, sc.channel === 'group' ? PRODUCT_REACT_CHAT : PRODUCT_REACT, { opt: !mustReact, em: E.fun, pe: 0.3 });
    if (r) L.splice(pos + 1, 0, r);
  }
}
const QUESTION_END = /\?(\s*\p{Extended_Pictographic}️?)*\s*$/u;

// --- câu đệm theo loại cảnh (khi thiếu câu / cần chen người khác vào giữa)
const FORMAL_FILL: Tpl[] = [
  (c) => (c.me === 'em' ? `${c.da}${c.me} hiểu${c.a}.` : `${c.Me} nói thẳng để ${c.you} hiểu thôi.`),
  (c) => (c.me === 'em' ? `${c.da}${c.me} xin ghi nhận${c.a}.` : `Cứ từ từ, ${c.me} nghe đây.`),
  (c) => (c.me === 'em' ? `${c.da}${c.me} sẽ cố gắng hơn${c.a}.` : `${c.Me} mong ${c.you} hiểu cho.`),
  (c) => `Mình nói chuyện thẳng thắn với nhau nha.`,
];
const INC_FILL: Tpl[] = [
  (c) => `Log đỏ lòm luôn rồi!`,
  (c) => `Khách gọi nữa kìa, ai nghe máy giùm với!`,
  (c) => `Bình tĩnh, từng bước một.`,
  (c) => `Đừng ai deploy gì thêm nha!`,
];
const CONF_FILL: Tpl[] = [
  (c) => `Nói rõ ràng ra đi ${c.you}.`,
  (c) => `${c.Me} không muốn làm lớn chuyện đâu.`,
  (c) => `Thôi, chuyện cũng lỡ rồi.`,
];
const CHAT_FILL: Tpl[] = [
  (c) => `kkk chuẩn luôn`, (c) => `thiệt hả 😳`, (c) => `${c.me} cũng nghĩ vậy`, (c) => `hóng 👀`, (c) => `=)) trời ơi`,
  (c) => `ủa vậy hả`, (c) => `+1`,
];
const WORK_FILL: Tpl[] = [
  (c) => (c.da ? `${c.da}${c.me} ghi nhận${c.a}.` : `Ok, ghi nhận. Tiếp đi.`),
  (c) => `${c.da || 'Ừ, '}vậy cũng được.`,
  (c) => `${c.da}${c.me} hiểu rồi, chiều ${c.me} gửi.`,
];
const GOSSIP_FILL: Tpl[] = [
  (c) => `Nói nhỏ thôi ${c.you}, tường có tai đó.`,
  (c) => `Trời, ai mà ngờ được.`,
  (c) => `Thôi kệ, chuyện người ta mà.`,
];
function fillerPool(sc: SC, sp: P): Tpl[] {
  switch (sc.type) {
    case 'hr_warning': case 'firing': case 'interview': case 'boss_call': case 'boss_catch':
    case 'hr_review': case 'resign_talk': case 'raise_request': case 'layoff': return FORMAL_FILL;
    // v5: họp xử lý / truyền lửa — câu đệm cũng phải nghiêm túc, không tám chuyện ngoài lề
    // không dùng CM.ok ("em triển khai liền") làm câu đệm: có thể bị chèn TRƯỚC câu chốt
    case 'crisis_meeting': return sp.id === sc.cast[0]?.id ? CM_CHAIR_FILL : [...CM.push, ...CM_MEMBER_FILL];
    case 'pep_talk': return sp.id === sc.cast[0]?.id ? PT_SPEAKER_FILL : PT_LISTENER_FILL;
    case 'news_chat': return [...NEWS_REACT, ...(sc.nCat ? NEWS_REACT_CAT[sc.nCat] : []), ...ACKS.slice(0, 4)];
    case 'promotion': return sp.role === 'boss' ? PM.bossClose : [...PM.joy, ...ACKS.slice(0, 3)];
    case 'incident': return INC_FILL;
    case 'confront': return CONF_FILL;
    case 'company_chat': return C_FILL;
    case 'group_chat': return CHAT_FILL;
    case 'celebration': return sp.role === 'boss' ? CEL.boss : [...CEL_ANY, ...CEL_MID[celReason(sc)]];
    case 'standup': return sp.role === 'boss' ? ST_BOSS_PUSH : [...WORK_FILL, ...ST_REPORT_ANY];
    case 'welcome': return WC.mateAny;
    case 'pingpong_match': return PP.play;
    case 'showroom_chat': return [...SR_FILL, ...ACKS];
    case 'gossip': return GOSSIP_FILL;
    case 'lunch': return [...LUNCH_FOOD, ...ACKS];
    default: return [...ACKS, ...(sc.topicCat ? CAT_DETAIL[sc.topicCat] : []), ...ROLE_GRIPES[sp.role]];
  }
}
/** Chèn 1 câu đệm tại vị trí `at` (mặc định: trước câu chốt). who = ép người nói, avoid = không chọn người này */
function padLine(b: B, sc: SC, who?: P, at?: number, avoid?: P): boolean {
  const L = sc.lines;
  const pos = at ?? (L.length >= 2 ? L.length - 1 : L.length);
  const prev = L[pos - 1]?.sp ?? null;
  const nxt = L[pos]?.sp ?? null;
  let sp = who;
  if (!sp) {
    const elig = sc.cast.filter((p) => p.id !== prev?.id && p.id !== nxt?.id && p.id !== avoid?.id);
    if (!elig.length) return false;
    sp = pick(elig);
  }
  const listener = prev && prev.id !== sp.id ? prev : sc.cast.find((p) => p.id !== sp!.id) ?? sp;
  const d = b.make(sp, listener, fillerPool(sc, sp), { opt: true, em: E.ok, pe: 0.1 });
  if (!d) return false;
  L.splice(pos, 0, d);
  return true;
}
const adjacency = (arr: Draft[]): number => arr.reduce((n, d, i) => n + (i > 0 && arr[i - 1].sp.id === d.sp.id ? 1 : 0), 0);
function lineBounds(sc: SC): [number, number] {
  let min = Math.floor(Number(sc.req.minLines));
  let max = Math.floor(Number(sc.req.maxLines));
  if (!Number.isFinite(min) || min < 1) min = 3;
  if (!Number.isFinite(max) || max < 1) max = Math.max(min, 8);
  if (min > max) [min, max] = [max, min];
  if (sc.cast.length >= 2) { min = Math.max(min, 2); max = Math.max(max, 2); }
  return [min, max];
}
/** Đưa số câu về [minLines, maxLines]; cắt câu phụ trước (cắt cả cặp hỏi–đáp), ai cũng nói ít nhất 1 câu */
function fitLines(b: B, sc: SC): void {
  const [min, max] = lineBounds(sc);
  const L = sc.lines;
  const target = clamp(Math.round((ri(min, max) + ri(min, max)) / 2), min, max);
  const unitAt = (i: number): number[] => {
    const set = new Set<Draft>([L[i]]);
    const g = L[i].grp;
    if (g !== undefined) for (const d of L) if (d.grp === g) set.add(d);
    for (let grew = true; grew;) {
      grew = false;
      for (const d of L) if (d.dep && set.has(d.dep) && !set.has(d)) { set.add(d); grew = true; }
    }
    return [...set].map((d) => L.indexOf(d)).filter((j) => j >= 0).sort((x, y) => x - y);
  };
  const units = (onlyOpt: boolean): number[][] => {
    const seen = new Set<string>();
    const out: number[][] = [];
    for (let i = 1; i < L.length - 1; i++) {
      const u = unitAt(i);
      const key = u.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (u.every((j) => j > 0 && j < L.length - 1 && !L[j].product && (!onlyOpt || L[j].opt))) out.push(u);
    }
    return out;
  };
  const score = (u: number[]): number => {
    const rest = L.filter((_, j) => !u.includes(j));
    const silenced = sc.cast.filter((p) => L.some((d) => d.sp.id === p.id) && !rest.some((d) => d.sp.id === p.id)).length;
    return -silenced * 10 - (adjacency(rest) - adjacency(L)) * 3 + R();
  };
  const removeUnit = (u: number[]): void => { for (const j of [...u].sort((x, y) => y - x)) L.splice(j, 1); };
  while (L.length > target) {
    let pool = units(true).filter((u) => L.length - u.length >= min);
    if (!pool.length && L.length > max) pool = units(false).filter((u) => L.length - u.length >= Math.min(min, max));
    if (!pool.length) break;
    removeUnit(pool.sort((x, y) => score(y) - score(x))[0]);
  }
  // ai trong cảnh cũng nói ít nhất 1 câu
  for (const p of sc.cast) {
    if (L.some((d) => d.sp.id === p.id)) continue;
    if (L.length >= max) {
      const pool = units(false).filter((u) => u.length === 1 && L.filter((x) => x.sp.id === L[u[0]].sp.id).length > 1);
      if (!pool.length) continue;
      removeUnit(pick(pool));
    }
    padLine(b, sc, p);
  }
  let guard = 0;
  while (L.length < min && guard++ < 12) if (!padLine(b, sc)) break;
  while (L.length > max && L.length > 2) {
    const pool = units(false);
    if (!pool.length) break;
    removeUnit(pool.sort((x, y) => score(y) - score(x))[0]);
  }
}
/** Hai câu liền nhau cùng một người (văn nói): gộp thành một lượt; nhóm chat cho phép tối đa 2 tin liên tiếp */
function mergeAdjacent(b: B, sc: SC): void {
  const [min, max] = lineBounds(sc);
  const L = sc.lines;
  const limit = sc.channel === 'office' ? 1 : 2; // nhóm chat: một người nhắn liền 2 tin là bình thường
  for (let i = 1; i < L.length; i++) {
    let run = 1;
    while (i - run >= 0 && L[i - run].sp.id === L[i].sp.id) run++;
    if (run <= limit) continue;
    const a = L[i - 1], z = L[i];
    if (!a.product && !z.product && L.length > min && a.text.length + z.text.length <= 170) {
      a.text = `${a.text} ${z.text}`;
      a.emote = a.emote ?? z.emote;
      a.opt = !!(a.opt && z.opt);
      if (a.grp === undefined) a.grp = z.grp;
      for (const d of L) if (d.dep === z) d.dep = a;
      L.splice(i, 1);
      i--;
    } else if (L.length < max && padLine(b, sc, undefined, i, a.sp)) i++;
    else if (z.opt && !z.product && L.length > min) { L.splice(i, 1); i--; }
    else if (a.opt && !a.product && L.length > min) { L.splice(i - 1, 1); i--; }
    else if (a.product !== z.product) {
      // gộp câu thường vào câu nhắc sản phẩm (câu product vẫn nhắc tên sản phẩm)
      const merged = cut(`${a.text} ${z.text}`, 200);
      if (a.product) { a.text = merged; for (const d of L) if (d.dep === z) d.dep = a; L.splice(i, 1); }
      else { z.text = merged; for (const d of L) if (d.dep === a) d.dep = z; L.splice(i - 1, 1); }
      i--;
    } else if (!a.product && !z.product) {
      a.text = cut(`${a.text} ${z.text}`, 200);
      for (const d of L) if (d.dep === z) d.dep = a;
      L.splice(i, 1);
      i--;
    }
  }
}

// --- tật nói riêng của 10 nhân vật gốc: rắc nhẹ, tối đa 1 lần mỗi cảnh (pre = chêm đầu câu)
interface Tic { t: Tpl; pre?: boolean; when?: RegExp; unless?: RegExp; types?: SceneType[]; officeOnly?: boolean }
const EXCLAIM = /(?:!|\.\.\.)$|(?<![\p{L}])(?:xỉu|mệt|đói|ghê|quá|chịu|trời)(?![\p{L}])/iu;
const TICS: Record<string, Tic[]> = {
  hung: [{ t: () => 'Chúng ta là một gia đình mà.' }],
  ngoc: [{ t: (c) => (c.l.role === 'boss' ? null : `${c.Me} ghi lại rồi đó.`), unless: /ghi|sổ/iu }],
  khoa: [{ t: (c) => (c.sc.cast.some((p) => p.role === 'boss') ? null : 'Haizz,'), pre: true }],
  vy: [{ t: (c) => (isDev(c.l) ? '🙂' : null) }],
  linh: [{ t: () => 'Trời ơi,', pre: true, when: EXCLAIM }],
  phat: [{ t: (c) => (c.l.role === 'boss' ? 'Sếp yên tâm.' : 'Chuyện nhỏ!'), types: ['desk_visit', 'celebration', 'boss_call', 'standup'] }],
  tu: [{ t: () => 'Hehe.', officeOnly: true }],
  tram: [{ t: () => 'Trời ơi,', pre: true, when: EXCLAIM }],
};
const INTERJ = /^(dạ|trời|ủa|ê|haizz|ơ|má|thôi|ừ|ờ|ok|rồi|hả|khoan|chào|nè|hú|ui|ấy)\b/iu;
function applyTics(b: B, sc: SC): void {
  if (sc.channel === 'company') return;
  const formal = ['hr_warning', 'firing', 'interview', 'boss_call', 'boss_catch', 'hr_review', 'resign_talk', 'raise_request', 'layoff'].includes(sc.type);
  for (const [i, d] of shuffle([...sc.lines.entries()])) {
    const tics = TICS[d.sp.id];
    if (!tics || d.product || chance(formal ? 0.95 : 0.8)) continue;
    const prevSp = sc.lines[i - 1]?.sp;
    const to = d.to && d.to.id !== d.sp.id ? d.to : prevSp && prevSp.id !== d.sp.id ? prevSp : b.partnerOf(d.sp);
    const c = new C(sc, d.sp, to, sc.x);
    const tic = pick(tics);
    if ((tic.when && !tic.when.test(d.text)) || (tic.unless && tic.unless.test(d.text))) continue;
    if ((tic.types && !tic.types.includes(sc.type)) || (tic.officeOnly && sc.channel !== 'office')) continue;
    const t = tic.t(c);
    if (!t || d.text.length > 140) continue;
    const core = norm(t.replace(/[,.!]+$/u, ''));
    if (sc.lines.some((x) => x.sp.id === d.sp.id && norm(x.text).includes(core))) continue;
    if (tic.pre) {
      if (INTERJ.test(d.text)) continue;
      d.text = `${t} ${softLower(sc, d.text)}`;
    } else {
      if (QUESTION_END.test(d.text) || (t === '🙂' && (HAS_EMOJI.test(d.text) || d.emote))) continue;
      d.text = `${d.text} ${t}`;
    }
    return;
  }
}

function emptyResult(req: SceneRequest, summary: string): SceneResult {
  return { lines: [], summary, relationshipChanges: [], moodChanges: [], memories: [], kpiChanges: [], rumor: null,
    verdict: VERDICT_DEFAULT[req?.type] ?? null, hrDecisions: req?.type === 'hr_review' ? [] : null, source: 'offline' };
}
/** Đường lui cuối cùng nếu bộ sinh chính gặp lỗi bất ngờ */
function emergencyScene(req: SceneRequest, ctx: PromptContext): SceneResult {
  const ids = [...new Set((Array.isArray(req?.participants) ? req.participants : []).filter((v): v is string => typeof v === 'string' && !!v))];
  if (!ids.length) return emptyResult(req, 'Cảnh bị hủy vì không có ai tham gia.');
  const a = ids[0], z = ids[1] ?? ids[0];
  const nameOf = (id: string): string => ctx?.agents?.[id]?.name ?? id;
  const lines: SceneLine[] = [
    { speaker: a, text: 'Ủa, tới giờ rồi hả?' },
    { speaker: z, text: 'Ừ, làm cho xong việc rồi tính tiếp.' },
  ];
  if (req?.product?.name) {
    const sp = req.product.preferSpeaker && ids.includes(req.product.preferSpeaker) ? req.product.preferSpeaker : a;
    lines.splice(1, 0, { speaker: sp, text: `Mà nói chứ ${lowerFirst(req.product.name)} xài được lắm đó.`, product: true });
  }
  return { ...emptyResult(req, `${nameOf(a)}${z !== a ? ` và ${nameOf(z)}` : ''} nói chuyện vài câu.`), lines };
}

function generate(req: SceneRequest, ctx: PromptContext): SceneResult {
  const sc = buildSC(req, ctx);
  if (!sc.cast.length) return emptyResult(req, 'Cảnh bị hủy vì không có ai tham gia.');
  const b = new B(sc);
  const fx = new FX();
  let summary = '';
  try {
    // tám chuyện / ăn trưa có thẻ tin thật (Director gắn tin làm chủ đề) → dùng bộ dựng thời sự: chỉ nói tiêu đề + tên báo
    const builder = sc.nTitle && (sc.type === 'pantry_chat' || sc.type === 'lunch') ? bNews : BUILDERS[sc.type];
    summary = builder(b, sc, fx);
  } catch (e) {
    if (sc.lines.length < 2) throw e; // lỗi sớm => đường lui khẩn cấp
  }
  if (!sc.lines.length) throw new Error('offline: không sinh được câu nào');
  // từng bước hậu kỳ chạy độc lập: một bước lỗi không làm mất cả cảnh
  const safe = (fn: () => void): void => { try { fn(); } catch { /* bỏ qua bước lỗi */ } };
  safe(() => insertProduct(b, sc));
  safe(() => fitLines(b, sc));
  safe(() => mergeAdjacent(b, sc));
  safe(() => applyTics(b, sc));
  const prd = sc.req.product;
  // tên mà câu sản phẩm thật sự dùng (productTpls / bShowroom): short, không có thì tên catalogue viết thường
  const pn = typeof prd?.short === 'string' && prd.short.trim() ? prd.short.trim()
    : typeof prd?.name === 'string' && prd.name.trim() ? lowerFirst(prd.name.trim()) : '';
  const lines: SceneLine[] = sc.lines.map((d) => {
    let text = d.text;
    if (sc.channel === 'group') {
      // giữ nguyên tên sản phẩm khi chuyển sang văn chat ("không dây" không thành "ko dây")
      const guard = pn && text.includes(pn) ? pn : '';
      text = guard ? chatify(text.replace(guard, '\u0000'), d.sp).replace('\u0000', guard) : chatify(text, d.sp);
    }
    const line: SceneLine = { speaker: d.sp.id, text: cut(text, 200) };
    if (d.emote) line.emote = d.emote;
    if (d.product) line.product = true;
    return line;
  });
  for (const d of sc.lines) remember(d.text);
  return {
    lines,
    summary: cut(summary || `${joinNames(sc.cast)} nói chuyện ở ${sc.req.locationLabel || 'văn phòng'}.`, 120),
    ...finalizeFx(fx, sc),
    source: 'offline',
  };
}

/** Sinh cảnh hội thoại bằng template (không cần mạng). Không bao giờ throw. */
export function offlineScene(req: SceneRequest, ctx: PromptContext): SceneResult {
  try {
    return generate(req, ctx);
  } catch {
    try { return emergencyScene(req, ctx); } catch { return emptyResult(req, 'Cảnh bị lỗi nên bỏ qua.'); }
  }
}

// =====================================================================
//  12. Ứng viên mới (offline)
// =====================================================================
const AGE_RANGE: Record<RoleKey, [number, number]> = {
  boss: [40, 50], hr: [27, 38], techlead: [29, 38], senior: [26, 33], junior: [21, 24], qa: [23, 30],
  designer: [23, 30], saleslead: [29, 38], salesnew: [22, 27], marketing: [22, 28],
};
const PREV_JOBS: Record<RoleKey, string[]> = {
  boss: ['từng làm giám đốc chi nhánh một công ty phần mềm'],
  hr: ['từng làm tuyển dụng cho một công ty sản xuất', 'có bảy năm làm nhân sự tổng hợp', 'từng làm hành chính rồi chuyển sang nhân sự'],
  techlead: ['từng dẫn team tám người ở một công ty outsource lớn', 'có mười năm kinh nghiệm, từng làm việc ở Singapore', 'từng làm kiến trúc sư phần mềm cho một ví điện tử'],
  senior: ['từng làm năm năm ở công ty outsource chuyên khách Nhật', 'có nhiều năm làm backend cho sàn thương mại điện tử', 'từng khởi nghiệp app giao đồ ăn nhưng thất bại'],
  junior: ['vừa tốt nghiệp ngành CNTT, từng thực tập ở một startup fintech', 'tự học lập trình sau hai năm làm kế toán', 'mới học xong khóa lập trình sáu tháng'],
  qa: ['từng làm tester cho công ty game, chơi một màn cả trăm lần', 'chuyển từ chăm sóc khách hàng sang QA vì mê bắt lỗi', 'có ba năm test app ngân hàng'],
  designer: ['từng làm designer cho agency quảng cáo', 'nhận thiết kế app cho các quán cà phê', 'học kiến trúc rồi rẽ ngang làm UI/UX'],
  saleslead: ['từng là sales số một của một công ty phần mềm kế toán', 'có tám năm bán giải pháp phần mềm cho chuỗi bán lẻ'],
  salesnew: ['từng bán bảo hiểm một năm', 'mới ra trường, từng làm part-time ở quán trà sữa', 'từng bán điện thoại ở cửa hàng, nói chuyện có duyên'],
  marketing: ['từng chạy fanpage cho một chuỗi trà sữa', 'có kênh TikTok review đồ ăn vài chục nghìn người theo dõi', 'từng viết content cho một agency'],
};
type TraitKey = keyof Traits;
const TRAIT_LINE: Record<TraitKey, string[]> = {
  diligence: ['Chăm chỉ, đi làm sớm, ghi chú cẩn thận.', 'Làm việc có kế hoạch, ghét trễ hạn.'],
  laziness: ['Sáng dạ nhưng hay trì hoãn tới phút chót.', 'Làm nhanh nhưng thích ngồi chill.'],
  gossip: ['Thích hóng chuyện, hai ngày là biết hết văn phòng.', 'Nói nhiều, quen ai cũng nhanh.'],
  temper: ['Thẳng tính, dễ nổi nóng khi bị hối.', 'Nguyên tắc, không chịu được ai làm ẩu.'],
  humor: ['Hài hước, hay pha trò lúc căng thẳng.', 'Lầy lội, đi tới đâu có tiếng cười tới đó.'],
  ambition: ['Tham vọng, muốn lên trưởng nhóm trong một năm.', 'Rất muốn được sếp chú ý.'],
};
const HOOKS = ['Quê ở Bến Tre, hay mang dừa lên biếu cả phòng.', 'Mê cà phê muối.', 'Đang tập pickleball.',
  'Nuôi hai con mèo tên Bug và Fix.', 'Sợ nhất là bị gọi lên phòng họp.', 'Mỗi sáng chạy xe 15 cây số đi làm.',
  'Đang để dành tiền đi Nhật chơi.', 'Thuộc lòng menu mọi quán quanh công ty.', 'Hay mang trái cây lên chia cả phòng.'];
const TONE: Record<TraitKey, string> = {
  diligence: 'Nói rõ ràng, hay hỏi lại "deadline khi nào ạ?".',
  laziness: 'Nói chậm, hay "để từ từ", giỏi viện cớ.',
  gossip: 'Nói nhanh, hay mở đầu bằng "nghe nói là...".',
  temper: 'Nói thẳng, hơi cộc khi bị hối.',
  humor: 'Hay pha trò, thích chơi chữ.',
  ambition: 'Hay khen sếp, nói chuyện kiểu chuyên nghiệp.',
};
const CAND_QUIRKS: Record<RoleKey, string[]> = {
  boss: ['Gọi điện thoại bằng loa ngoài', 'Mê sách quản trị'],
  hr: ['Ghi chú bằng bút nhiều màu', 'Nhớ tên con cái của từng nhân viên', 'Luôn mang theo kẹo gừng'],
  techlead: ['Vẽ sơ đồ hệ thống lên mọi tờ giấy', 'Uống trà xanh thay cà phê', 'Đọc log như đọc truyện'],
  senior: ['Gõ phím rất mạnh', 'Hay lẩm bẩm nói chuyện với code', 'Nghe nhạc lofi cả ngày'],
  junior: ['Ghi chép mọi lời anh chị dặn', 'Hay hỏi "dạ cái này là sao ạ"', 'Mang cơm nhà đi làm'],
  qa: ['Dán giấy nhớ đủ màu quanh màn hình', 'Test trên ba cái điện thoại cùng lúc', 'Chụp màn hình mọi thứ'],
  designer: ['Đổi hình nền máy mỗi tuần', 'Để hộp bút vẽ trên bàn', 'Sưu tầm sticker dễ thương'],
  saleslead: ['Vừa đi vừa nói điện thoại', 'Nhớ tên khách hơn tên đồng nghiệp', 'Áo sơ mi lúc nào cũng ủi phẳng'],
  salesnew: ['Tập nói chuyện trước gương', 'Ghi kịch bản gọi khách ra giấy', 'Hay đi mượn sạc'],
  marketing: ['Quay clip mọi khoảnh khắc', 'Biết hết mọi trend mới', 'Đặt tên file kèm emoji'],
};
const ANY_QUIRKS = ['Đi làm sớm mười phút để giành chỗ gửi xe', 'Lúc nào cũng mang bình nước hai lít',
  'Ăn trưa đúng 12 giờ, không sớm không trễ', 'Hay ngân nga hát khi làm việc'];
const CAND_LIKES = ['trà sữa', 'cà phê muối', 'pickleball', 'phim Hàn', 'đi Đà Lạt', 'nhạc lofi', 'mèo', 'ăn ốc',
  'game mobile', 'đọc sách', 'chạy bộ', 'karaoke', 'săn sale', 'bún bò'];
const CAND_DISLIKES = ['họp dài', 'kẹt xe', 'bị hối deadline', 'máy lạnh quá lạnh', 'tin nhắn lúc nửa đêm',
  'người nói không giữ lời', 'wifi chậm', 'bị gọi tên trước đám đông'];
const DESK_TAGS: Record<RoleKey, string[]> = {
  boss: ['golf', 'sep', 'qua-tang', 'suc-khoe'], hr: ['massage', 'thu-gian', 'van-phong', 'lam-dep'],
  techlead: ['dev', 'ban-phim', 'man-hinh', 'ca-phe'], senior: ['dev', 'tai-nghe', 'ban-phim', 'chuot'],
  junior: ['dev', 'laptop', 'sach', 'chuot'], qa: ['dev', 'chuot', 'man-hinh', 'mat'], designer: ['design', 'man-hinh', 'chuot'],
  saleslead: ['karaoke', 'dien-thoai', 'sac'], salesnew: ['sac', 'dien-thoai', 'gaming'],
  marketing: ['livestream', 'lam-dep', 'thoi-trang', 'tiktok'],
};
const r2 = (v: number): number => Math.round(clamp(v, 0.05, 0.95) * 100) / 100;
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = R() * total;
  for (const [v, w] of items) { r -= Math.max(0, w); if (r <= 0) return v; }
  return items[items.length - 1][0];
}

/** Hồ sơ ứng viên ngẫu nhiên cho vai trò cần tuyển (không cần mạng) */
export function offlineCandidate(req: CandidateRequest, ctx: PromptContext): Persona {
  const role: RoleKey = ROLE_KEYS.includes(req?.role) ? req.role : 'junior';
  const gender: Gender = chance(0.5) ? 'nam' : 'nữ';
  const agents = Object.values(ctx?.agents ?? {}).filter((a): a is AgentState => !!a);
  const used = new Set([...(Array.isArray(req?.usedNames) ? req.usedNames : []), ...agents.map((a) => a.name), ...agents.map((a) => a.fullName)]
    .filter((s): s is string => typeof s === 'string' && !!s).map(norm));
  const pool = NAME_POOL[gender];
  const ho = pick(pool.ho);
  let ten = shuffle(pool.ten).find((t) => !used.has(norm(t)));
  let dem = pick(pool.dem.filter((d) => d !== ten));
  let name = ten ?? '';
  if (!ten) { // hết tên đơn: dùng "đệm + tên" (vd "Minh Huy")
    outer: for (const d of shuffle(pool.dem)) for (const t of shuffle(pool.ten)) {
      if (d !== t && !used.has(norm(`${d} ${t}`))) { dem = d; ten = t; name = `${d} ${t}`; break outer; }
    }
    if (!ten) { ten = pick(pool.ten); name = `${ten} ${ri(2, 9)}`; }
  }
  const fullName = `${ho} ${dem} ${ten}`;
  const [lo, hi] = AGE_RANGE[role];
  const age = ri(lo, hi);
  const diligence = 0.45 + R() * 0.4;
  const traits: Traits = {
    diligence: r2(diligence), laziness: r2(1 - diligence - 0.1 + (R() - 0.5) * 0.3),
    gossip: r2(0.2 + R() * 0.6), temper: r2(0.1 + R() * 0.6), humor: r2(0.2 + R() * 0.7), ambition: r2(0.3 + R() * 0.6),
  };
  const dom = (Object.keys(traits) as TraitKey[]).filter((k) => k !== 'laziness' || traits.laziness >= 0.5)
    .sort((a, z) => traits[z] - traits[a])[0] ?? 'diligence';
  let bio = `${cap(pick(PREV_JOBS[role]))}. ${pick(TRAIT_LINE[dom])} ${pick(HOOKS)}`;
  if (req?.replacingName && bio.length < 150) bio += ` Vào thay chỗ ${req.replacingName} nên rất muốn chứng tỏ.`;
  const xh = age <= 25 ? 'Xưng "em" với hầu hết mọi người, gọi anh/chị + tên.' : 'Xưng "em" với người lớn hơn, "anh"/"chị" với người nhỏ hơn.';
  const speechStyle = cut(`${xh} ${TONE[dom]}${age <= 25 ? ' Thỉnh thoảng chêm từ Gen Z (khum, xỉu).' : ''}`, 160);
  const usedShirts = new Set(agents.filter((a) => a.status === 'active').map((a) => String(a.look?.shirt ?? '').toLowerCase()));
  const shirts = LOOK_POOL.shirt.filter((s) => !usedShirts.has(s.toLowerCase()));
  const styles = LOOK_POOL.hairStyles[gender].filter((s) => s !== 'bald' || (age >= 35 && chance(0.3)));
  const accessory = weighted<Look['accessory']>([
    ['none', 5], ['glasses', 2], ['headphones', isDev({ role } as P) ? 2 : 0.7], ['cap', age <= 27 ? 1 : 0.2],
    ['bow', gender === 'nữ' ? 1.5 : 0], ['tie', ['saleslead', 'hr', 'boss'].includes(role) ? 1 : 0],
  ].filter(([a]) => LOOK_POOL.accessories.includes(a as Look['accessory'])) as [Look['accessory'], number][]);
  const look: Look = {
    skin: pick(LOOK_POOL.skin),
    hair: age >= 40 && chance(0.4) ? '#8c8c8c' : pick(LOOK_POOL.hair.filter((h) => h !== '#8c8c8c')),
    hairStyle: pick(styles.length ? styles : LOOK_POOL.hairStyles[gender]),
    shirt: pick(shirts.length ? shirts : LOOK_POOL.shirt),
    pants: pick(LOOK_POOL.pants),
    accessory,
  };
  const quirks = shuffle([...CAND_QUIRKS[role], ...ANY_QUIRKS]).slice(0, ri(2, 3));
  const likes = shuffle(CAND_LIKES).slice(0, ri(2, 3));
  const dislikes = shuffle(CAND_DISLIKES).slice(0, 2);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  const persona: Persona = {
    id: `cand_${role}_${Number.isFinite(ctx?.day) ? ctx.day : 1}_${rand}`,
    name, fullName, role, roleLabel: req?.roleLabel || role, gender, age, bio: cut(bio, 200), speechStyle,
    quirks, likes, dislikes, traits, look,
    deskId: req?.deskId ?? '', kpiTarget: Number.isFinite(req?.kpiTarget) ? req.kpiTarget : 260,
  };
  const item = pickProduct(DESK_TAGS[role]);
  if (item) persona.deskItemProductId = item.id;
  return persona;
}

// =====================================================================
//  13. Bản tin cuối ngày (offline)
// =====================================================================
type EvKind = 'firing' | 'incident' | 'rumor' | 'hire' | 'warning' | 'catch' | 'deal' | 'release' | 'party' | 'wifi' | 'late' | 'boss';
const EV_RULES: [RegExp, number, EvKind][] = [
  [/cho nghỉ|đuổi việc|ôm thùng|nghỉ việc/iu, 10, 'firing'],
  [/sập|server|sự cố|bug production/iu, 8, 'incident'],
  [/đối chất|tin đồn|nói xấu|rỉ tai|xì xào|hỏi tội/iu, 7, 'rumor'],
  [/phỏng vấn|gia nhập|chào mừng|người mới|ra mắt văn phòng/iu, 7, 'hire'],
  [/nhắc nhở|cảnh cáo|kpi thấp|biên bản/iu, 6, 'warning'],
  [/quả tang|sếp bắt|bị sếp|tại trận/iu, 6, 'catch'],
  [/chốt|hợp đồng|deal/iu, 6, 'deal'],
  [/release|hoàn thành|cán đích|lên sóng/iu, 6, 'release'],
  [/sinh nhật|ăn mừng|lương/iu, 5, 'party'],
  [/wifi|mất mạng/iu, 4, 'wifi'],
  [/đi trễ/iu, 3, 'late'],
  [/sếp ra ngoài|đi vắng|golf/iu, 2, 'boss'],
];
function classify(ev: string): { kind: EvKind | null; score: number } {
  for (const [re, score, kind] of EV_RULES) if (re.test(ev)) return { kind, score };
  return { kind: null, score: 1 };
}
const cleanEvent = (s: string): string => cut(s.replace(/\s+/g, ' ').trim().replace(/^[-•*]\s*/, ''), 140);

/** Bản tin kiểu báo lá cải văn phòng (không cần mạng) */
export function offlineRecap(req: RecapRequest, ctx: PromptContext): DayRecap {
  const day = Number.isFinite(req?.day) ? req.day : (ctx?.day ?? 1);
  const weekday = req?.weekday || ctx?.weekday || '';
  const kpi: KpiResult[] = Array.isArray(req?.kpi) ? req.kpi.filter((k) => k && typeof k.id === 'string') : [];
  const events = (Array.isArray(req?.events) ? req.events : []).filter((e): e is string => typeof e === 'string' && !!e.trim());
  const fired = (Array.isArray(req?.firedToday) ? req.firedToday : []).filter((s) => typeof s === 'string' && s);
  const hired = (Array.isArray(req?.hiredToday) ? req.hiredToday : []).filter((s) => typeof s === 'string' && s);
  // sếp và HR không bị xét KPI (giống prompt GPT + sanitize.deriveMvp) → không đưa vào top / bét / MVP
  const exempt = (k: KpiResult): boolean => {
    const role = ctx?.agents?.[k.id]?.role;
    return role === 'boss' || role === 'hr' || /giám đốc|nhân sự/iu.test(k.roleLabel || '');
  };
  const staff = kpi.filter((k) => !exempt(k) && Number.isFinite(k.ratio)).sort((a, z) => z.ratio - a.ratio);
  const top = staff[0];
  const bottom = staff.length > 1 ? staff[staff.length - 1] : undefined;
  const scored = events.map((e, i) => ({ e, i, ...classify(e) })).sort((a, z) => z.score - a.score || a.i - z.i);
  const kinds = new Set(scored.map((s) => s.kind));
  // --- headline
  let headline: string;
  if (fired.length) headline = `Chấn động: ${fired.join(', ')} chính thức ôm thùng rời công ty!`;
  else if (hired.length) headline = `Chào sân: ${hired.join(', ')} gia nhập, văn phòng thêm gương mặt mới`;
  else if (kinds.has('incident')) headline = pick(['Server "đình công", team dev toát mồ hôi hột', 'Sập server giữa ban ngày, cả văn phòng nín thở']);
  else if (kinds.has('rumor')) headline = pick(['Tin đồn bay khắp pantry, ai nói thật ai nói xạo?', 'Tam sao thất bản: một tin đồn, năm phiên bản']);
  else if (kinds.has('catch')) headline = pick(['Sếp đi tuần, dân lướt TikTok "bay màu"', 'Bắt quả tang giữa giờ làm: không ai an toàn']);
  else if (kinds.has('deal')) headline = pick(['Tiền về! Sales chốt deal, cả phòng mơ thưởng', 'Hợp đồng mới cập bến, sếp cười như vừa putt trúng lỗ']);
  else if (kinds.has('release')) headline = pick(['Dự án cán đích, sếp hứa thưởng (như mọi lần)', 'Release thành công — tạm thời chưa thấy bug']);
  else if (kinds.has('warning')) headline = 'KPI đỏ lửa, phòng họp lại sáng đèn';
  else if (kinds.has('party')) headline = pick(['Văn phòng mở tiệc, KPI tạm gác một bên', 'Bánh kem, trà sữa và những lời hứa thưởng']);
  else headline = pick([`Một ngày ${weekday ? lowerFirst(weekday) + ' ' : ''}bình yên... đến mức đáng ngờ`,
    `Ngày ${day}: KPI lên xuống, cà phê cạn bình`, `Văn phòng ngày ${day}: ai làm, ai lướt, bảng KPI biết hết`]);
  // --- bullets
  const bullets: string[] = [];
  if (fired.length) bullets.push(`${fired.join(', ')} chính thức rời công ty sau chuỗi ngày KPI thấp.`);
  if (hired.length) bullets.push(`Chào mừng ${hired.join(', ')} gia nhập ${ctx?.companyName || 'công ty'}.`);
  for (const s of scored) {
    if (bullets.length >= 3) break;
    if ((s.kind === 'firing' && fired.length) || (s.kind === 'hire' && hired.length)) continue;
    const t = cleanEvent(s.e);
    if (t && !bullets.some((x) => norm(x) === norm(t))) bullets.push(t);
  }
  if (top) {
    bullets.push(bottom && bottom.id !== top.id
      ? `${top.name} dẫn đầu KPI với ${pctOf(top.ratio)}%, còn ${bottom.name} lẹt đẹt ${pctOf(bottom.ratio)}%.`
      : `${top.name} dẫn đầu KPI với ${pctOf(top.ratio)}%.`);
  }
  const FILLERS = ['Máy pha cà phê chạy hết công suất, chưa ai báo lỗi.', 'Pantry vẫn là trung tâm phát sóng tin đồn của văn phòng.',
    'Nhóm chat kín hoạt động sôi nổi hơn cả kênh chính thức.', 'Bảng KPI tiếp tục là bức tường quyền lực nhất văn phòng.',
    'Sếp lại nhắc "chúng ta là một gia đình", chưa ai đếm được là lần thứ mấy.'];
  for (const f of shuffle(FILLERS)) { if (bullets.length >= 3) break; bullets.push(f); }
  // --- mvp
  const mvp = top && top.ratio > 0 ? {
    id: top.id, name: top.name,
    reason: cut(pick([`Đạt ${pctOf(top.ratio)}% KPI, cày không nghỉ`, `${pctOf(top.ratio)}% KPI — thanh KPI xanh lè`,
      `Gánh team với ${pctOf(top.ratio)}% KPI`]), 100),
  } : null;
  // --- drama
  const dramaEv = scored.find((s) => s.kind === 'firing' || s.kind === 'rumor' || s.kind === 'catch' || s.kind === 'warning' || s.kind === 'incident');
  const drama = dramaEv ? cut(dramaEv.e.replace(/\s+/g, ' ').trim(), 200)
    : fired.length ? `${fired[0]} ôm thùng ra về, cả văn phòng im lặng mất năm phút.`
      : pick(['Không có drama lớn, chỉ có vài lời xì xào ở pantry.', 'Một ngày hiếm hoi không ai giận ai — đáng ngờ!']);
  return {
    day, weekday, headline: cut(headline, 90), bullets: bullets.slice(0, 5).map((s) => cut(s, 140)),
    mvp, drama, kpi, source: 'offline',
  };
}

// =====================================================================
//  14. v3 — AI biên kịch offline: 1–2 "biến" ngẫu nhiên có trọng số từ menu, dùng người đang có mặt
// =====================================================================
function weightedPick<T>(items: readonly T[], weights: readonly number[]): T | undefined {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return undefined;
  let r = R() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Kế hoạch biến khi không có AI: chọn 1 (55%) hoặc 2 biến từ menu — loại vừa diễn gần đây (recentBeats) ít được chọn hơn —
 * gán cho người đang có mặt (ưu tiên nhân viên, 60% có người thứ hai), mức độ đa số nhẹ. Không bao giờ throw.
 */
export function offlineBeats(req: BeatRequest, ctx: PromptContext): BeatPlan {
  const menu = (Array.isArray(req?.menu) ? req.menu : []).filter((m) => m && typeof m.kind === 'string' && m.kind.trim());
  if (!menu.length) return { beats: [], source: 'offline' };
  const recent = (Array.isArray(req.recentBeats) ? req.recentBeats : []).filter((s) => typeof s === 'string').map(norm);
  const all = Object.values(ctx?.agents ?? {}).filter((a): a is AgentState => !!a && a.status === 'active');
  const present = all.filter((a) => a.present);
  const pool = present.length ? present : all;
  const staff = pool.filter((a) => a.role !== 'boss');
  const n = chance(0.55) ? 1 : 2;
  const used = new Set<string>();
  const beats: Beat[] = [];
  for (let i = 0; i < n && used.size < menu.length; i++) {
    const weights = menu.map((m) => (used.has(m.kind) ? 0 : recent.some((r) => r.includes(norm(m.kind))) ? 1 : 3));
    const m = weightedPick(menu, weights);
    if (!m) break;
    used.add(m.kind);
    const a = (staff.length && chance(0.85) ? pick(staff) : pool.length ? pick(pool) : undefined);
    const others = pool.filter((x) => x.id !== a?.id);
    const bAgent = others.length && chance(0.6) ? pick(others) : undefined;
    const intensity = chance(0.5) ? 1 : chance(0.7) ? 2 : 3;
    const desc = (typeof m.desc === 'string' && m.desc.trim() ? m.desc : m.kind).trim().replace(/[.!…]+$/u, '');
    // mô tả thực đơn dùng "a" / "b" làm chỗ trống → điền tên (người xem thấy "Vy và Trâm bỗng thân nhau…" thay vì "a và b…")
    const note = cut(cap(fillBeatDesc(desc, a?.name, bAgent?.name)), 120);
    beats.push({ kind: m.kind, ...(a ? { a: a.id } : {}), ...(bAgent ? { b: bAgent.id } : {}), intensity, note });
  }
  return { beats, source: 'offline' };
}
