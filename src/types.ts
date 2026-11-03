// =====================================================================
//  SHARED CONTRACT — mọi module dùng chung các kiểu dữ liệu ở đây.
//  Đọc SPEC.md để hiểu ý nghĩa. Không đổi shape nếu không cập nhật SPEC.md.
// =====================================================================
import type { Pt } from './sim/map.js';
import type { Config } from './config.js';
export type { Pt } from './sim/map.js';

export type RoleKey =
  | 'boss' | 'hr' | 'techlead' | 'senior' | 'junior'
  | 'qa' | 'designer' | 'saleslead' | 'salesnew' | 'marketing';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Gender = 'nam' | 'nữ';
export type Priority = 'low' | 'normal' | 'high';
/** office = nói chuyện trực tiếp; group = nhóm chat kín "không có sếp"; company = nhóm chat công ty (có sếp) */
export type Channel = 'office' | 'group' | 'company';

// ---------------------------------------------------------------- persona
export interface Look {
  skin: string;        // màu CSS
  hair: string;        // màu CSS
  hairStyle: 'short' | 'long' | 'bun' | 'ponytail' | 'spiky' | 'bald' | 'curly' | 'bob';
  shirt: string;       // màu CSS
  pants: string;       // màu CSS
  accessory: 'none' | 'glasses' | 'headphones' | 'tie' | 'cap' | 'bow';
}

/** Tất cả trong khoảng 0..1 */
export interface Traits {
  diligence: number;   // chăm chỉ
  laziness: number;    // lười, hay trốn việc
  gossip: number;      // thích buôn chuyện
  temper: number;      // nóng tính
  humor: number;       // hài hước, hay khịa
  ambition: number;    // tham vọng, nịnh sếp
}

export interface Persona {
  id: string;                 // ổn định, duy nhất (vd 'tung'); người mới: tự sinh
  name: string;               // tên gọi ngắn hiển thị (vd 'Tùng')
  fullName: string;           // 'Nguyễn Thanh Tùng'
  role: RoleKey;
  roleLabel: string;          // 'Senior Dev'
  gender: Gender;
  age: number;
  bio: string;                // 1-3 câu tính cách (đưa vào prompt)
  speechStyle: string;        // cách nói, xưng hô, câu cửa miệng (đưa vào prompt)
  quirks: string[];           // thói quen
  likes: string[];
  dislikes: string[];
  traits: Traits;
  look: Look;
  deskId: string;             // key trong DESKS (src/sim/map.ts)
  deskItemProductId?: string; // món đồ affiliate đặt trên bàn
  kpiTarget: number;          // điểm KPI mục tiêu mỗi ngày
}

// ---------------------------------------------------------------- runtime agent
export type Activity =
  | 'offsite'      // chưa đến / đã về / ngoài văn phòng (không vẽ)
  | 'arriving'     // đang đi từ cửa vào bàn
  | 'leaving'      // đang đi ra cửa về
  | 'working'      // làm việc tại bàn (tăng KPI)
  | 'slacking'     // ngồi bàn nhưng lướt điện thoại/TikTok/Shopee (bị sếp bắt được)
  | 'napping'      // ngủ gật tại bàn
  | 'coffee' | 'water' | 'snack' | 'toilet'
  | 'pingpong'     // đánh bóng bàn ở sảnh
  | 'chill'        // nằm sofa góc chill
  | 'window'       // gọi điện / hóng gió ở góc cửa sổ
  | 'showroom'     // ngắm đồ ở phòng trưng bày (kệ làm đẹp / công nghệ) — emote 🛍️
  | 'printing'
  | 'lunch'
  | 'meeting'
  | 'scene'        // đang tham gia một cảnh hội thoại (Director điều khiển)
  | 'boss_office'  // sếp ngồi phòng riêng
  | 'patrol'       // sếp đi tuần
  | 'away'         // sếp đi vắng (không có mặt)
  | 'server_fix'   // sửa server khi có sự cố
  | 'idle';        // vừa xong việc, chờ chọn hoạt động mới (tick sau)

export interface Relationship {
  score: number;   // -100 (ghét) .. 100 (thân)
  note: string;    // lý do gần nhất, tiếng Việt ngắn
}

export interface MemoryNote { day: number; minute: number; text: string }

export type AgentStatus = 'active' | 'candidate' | 'fired';

export interface AgentState extends Persona {
  status: AgentStatus;
  present: boolean;           // đang ở trong văn phòng (được vẽ)
  x: number; y: number;       // toạ độ ô (float)
  dir: Dir;
  path: Pt[];                 // các ô còn phải đi
  activity: Activity;
  activityUntil: number;      // thời điểm game tuyệt đối (phút) kết thúc hoạt động
  activityLabel: string;      // 'đang code', 'lướt TikTok', ...
  emote: string;              // emoji trên đầu
  spotKey: string | null;     // chỗ đang giữ, vd 'coffee:0'
  sceneId: string | null;     // != null => Director đang điều khiển, World không tự chọn hoạt động
  onPhone: boolean;           // đang nhắn tin trong nhóm chat (hiện 📱)
  energy: number;             // 0..100
  mood: number;               // 0..100
  stress: number;             // 0..100
  kpiToday: number;
  kpiHistory: { day: number; ratio: number }[];
  lowStreak: number;          // số ngày liên tiếp KPI thấp
  warnings: number;           // số lần bị HR cảnh cáo
  relationships: Record<string, Relationship>;
  memories: MemoryNote[];     // tối đa ~8 cái mới nhất
  arriveAt: number;           // phút trong ngày (0..1439) dự kiến đến hôm nay
  leaveAt: number;            // phút trong ngày dự kiến về
  hiredDay: number;
  lastSceneAt: number;        // Date.now() lần cuối tham gia cảnh
  caughtToday: number;        // số lần bị sếp bắt lười hôm nay
  hidden?: boolean;           // đang ở trong WC (không vẽ) — FrameAgent flag 8
  // --- v3: câu chuyện tự phát triển
  traitBase?: Traits;         // tính cách gốc sau khi ngẫu nhiên hoá lần đầu (traits trôi quanh đây)
  dayFactor?: number;         // hệ số "ngày hên/xui" hôm nay (0.75..1.2) nhân vào KPI
  probationUntilDay?: number; // đang thử thách tới ngày N (hr_review 'probation')
  bonuses?: number;           // số lần được thưởng
  promotions?: number;        // số lần thăng chức
}

// ---------------------------------------------------------------- company
export interface ProjectState {
  name: string;
  client: string;
  desc: string;
  progress: number;           // 0..100
  startedDay: number;
  deadlineDay: number;
}

export interface CompanyState {
  name: string;
  project: ProjectState;
  projectsDone: number;
  revenueMonth: number;       // triệu đồng
  revenueTarget: number;      // triệu đồng
  incident: 'server_down' | 'wifi_down' | null;
}

// ---------------------------------------------------------------- products (affiliate)
export interface Product {
  id: string;
  name: string;
  emoji: string;
  tags: string[];
  pitch: string;      // mô tả ngắn để AI lồng vào thoại
  priceHint: string;  // vd '~350k' (chỉ hiển thị, không cho AI đọc giá)
  url: string;        // link affiliate thật (Shopee) — chỉ server biết, client đi qua /go/:id
  // --- v2: phòng trưng bày (docs/v2-contract.md §2)
  category?: ProductCategory;
  shelf?: ProductShelf;        // suy từ category
  slot?: number;               // vị trí trên kệ (0-based)
  note?: string;               // 1 câu giới thiệu hiển thị ở tab 🛍️ (thông tin thật, không phải lời chứng thực)
  image?: string;              // URL ảnh tuỳ chọn
  // --- v4: sản phẩm có "chuyện" (docs/04 §11) — AI đọc các trường này, client không cần
  short?: string;              // tên gọi đời thường ("chuột gaming không dây") — nhân vật nói tên này
  spoken?: string;             // mệnh đề nói được (≤ 60 ký tự) cho câu mẫu offline khi pitch lặp lại tên ("bạc 925, có màu hồng")
  facts?: string;              // điều CÓ THẬT được phép nói (từ trang bán)
  avoid?: string;              // điều CẤM nói (tuyên bố chưa kiểm chứng, thông số lệch, chủ đề nhạy cảm)
  hooks?: string[];            // "cớ đời thường" (mệnh đề không chủ ngữ) khiến món này được nhắc tới tự nhiên
}

/** v4: cảm nhận giá suy từ priceHint — AI chỉ được nói kiểu cảm nhận, không bao giờ nói con số */
export type PriceFeel = 're' | 'vua' | 'cao';

export type ProductCategory = 'lam-dep' | 'cong-nghe';
export type ProductShelf = 'beauty' | 'tech';

export interface ProductPublic {
  id: string; name: string; emoji: string; priceHint: string;
  url: string;        // luôn là '/go/<id>?src=...'
}

/** Sản phẩm trên kệ phòng trưng bày — gửi trong hello.products (url có src=showroom) */
export interface ShowroomProduct extends ProductPublic {
  category: ProductCategory;
  shelf: ProductShelf;
  slot: number;
  note: string;
  image?: string;
  tags: string[];
}

// ---------------------------------------------------------------- scenes
export type SceneType =
  | 'pantry_chat' | 'desk_visit' | 'gossip' | 'group_chat' | 'company_chat'
  | 'standup' | 'lunch' | 'boss_catch' | 'boss_call' | 'hr_warning' | 'firing'
  | 'interview' | 'incident' | 'celebration' | 'confront' | 'pingpong_match' | 'welcome'
  | 'showroom_chat'    // 🛍️ khoe / bàn về đồ trên kệ phòng trưng bày (đúng 1 câu product=true)
  // --- v3 (docs/v3-news.md)
  | 'news_chat'        // 🗞️ tám chuyện thời sự về 1 tin thật (req.news) — chỉ bình luận, không bịa
  | 'hr_review'        // ⚖️ HR + sếp họp xét nhân sự → result.hrDecisions (AI quyết, code làm hàng rào)
  | 'resign_talk'      // 🚪 nhân viên chán việc nói chuyện với HR → verdict 'stay' | 'leave'
  | 'raise_request'    // 💵 xin tăng lương với sếp → verdict 'approved' | 'denied'
  | 'promotion'        // 🎖️ công bố thăng chức / thưởng (sau hr_review)
  | 'layoff'           // 📉 cắt giảm vì công ty lỗ (sau hr_review) — người bị cắt rời công ty như firing
  // --- v5 "tình huống công ty" (src/content/situations.ts, docs/04 §16)
  | 'crisis_meeting'   // 🧯 sếp / lead / HR họp xử lý tình huống → verdict = mã phương án AI chốt (plan_a..plan_d)
  | 'pep_talk';        // 📣 sếp (hoặc HR / lead) làm công tác tư tưởng: cả phòng / 1:1 / hoà giải hai phe → inspired | unmoved

export type SceneEffectKind = 'relationship' | 'mood' | 'memory' | 'kpi' | 'rumor' | 'verdict' | 'decisions';

// ---------------------------------------------------------------- v3: thời sự (tin thật từ RSS báo)
export type NewsCategory = 'the_thao' | 'bong_da' | 'cong_nghe' | 'game' | 'khoa_hoc' | 'giai_tri';

export interface NewsItem {
  id: string;                 // hash của url
  title: string;
  summary: string;            // ≤ 200 ký tự, đã bỏ HTML
  source: string;             // 'VnExpress' | 'Tuổi Trẻ' | 'Thanh Niên' | 'GameK'
  url: string;                // link bài gốc (hiện cho người xem)
  category: NewsCategory;
  publishedAt: number;        // ms epoch
}

/** Thẻ tin gắn vào cảnh news_chat (log + PublicScene) để người xem tự kiểm chứng */
export interface NewsRef { id: string; title: string; source: string; url: string; category: NewsCategory }

// ---------------------------------------------------------------- v3: quyết định nhân sự do AI đưa ra
export type HrAction =
  | 'warn' | 'fire' | 'second_chance' | 'probation' | 'praise' | 'bonus'
  | 'promote' | 'open_position' | 'layoff' | 'none';

export interface HrDecision {
  id: string;                 // agent id (open_position: id của người đề xuất, hoặc '' nếu chung)
  action: HrAction;
  reason: string;             // 1 câu tiếng Việt
}

export type Verdict = 'hired' | 'rejected' | 'stay' | 'leave' | 'approved' | 'denied'
  // v5: crisis_meeting = mã phương án được chốt; pep_talk = có thuyết phục được người nghe không
  | 'plan_a' | 'plan_b' | 'plan_c' | 'plan_d' | 'inspired' | 'unmoved';

/** Director tạo -> Brain sinh thoại */
export interface SceneRequest {
  sceneId: string;
  type: SceneType;
  channel: Channel;
  locationLabel: string;      // 'Pantry', 'Bàn của Tùng', 'Nhóm Zalo "Anh em văn phòng"'
  situation: string;          // mô tả tình huống + mục tiêu cảnh (tiếng Việt, do Director viết)
  topicHint?: string;         // gợi ý chủ đề (từ TOPIC_SEEDS) để đa dạng
  participants: string[];     // agent id, [0] = người khởi xướng
  aboutId?: string;           // người bị nói tới (vắng mặt) — gossip/confront
  minLines: number;
  maxLines: number;
  product?: {
    id: string; name: string; pitch: string; preferSpeaker?: string;
    // --- v4 (tuỳ chọn): chất liệu để món đồ có "chuyện" chứ không chèn ngang
    short?: string;           // tên gọi đời thường
    spoken?: string;          // mệnh đề nói được cho câu mẫu offline (thay cho pitch khi có)
    facts?: string;           // điều có thật được nói
    avoid?: string;           // điều cấm nói
    /** kiểu chuyện / cớ (đã điền tên người): "Bảo mua dùng thử, ai ngờ ổn bất ngờ, giờ rủ Vy xài" */
    angle?: string;
    /** cớ ngắn dạng mệnh đề cho câu mẫu offline ("ngủ trưa gục bàn dậy là ê cổ") */
    hook?: string;
    /** mention = len vào chuyện đang nói; showroom = đứng trước kệ; unboxing = vừa nhận hàng; gift = tặng quà; owner = người đã mua kể lại */
    mode?: 'mention' | 'showroom' | 'unboxing' | 'gift' | 'owner';
    priceFeel?: PriceFeel;
  };
  rumor?: { id: string; aboutId: string; currentText: string; isNew: boolean };
  extra?: string[];           // thêm bối cảnh (mỗi phần tử 1 dòng)
  allowedEffects: SceneEffectKind[];
  priority: Priority;
  // --- v3
  news?: NewsItem;            // news_chat: tin thật đang bàn
  /**
   * v5 crisis_meeting / pep_talk: tình huống công ty đang xử lý. options = phương án được đưa ra bàn (AI chốt 1 mã vào verdict);
   * pick = lựa chọn dự phòng đã chọn sẵn (offline viết thoại theo đúng nó; AI trả sai mã thì Director dùng nó).
   */
  crisis?: {
    kind: string; title: string; note: string;
    options?: { code: string; label: string }[];
    pick?: string;
    /** pep_talk: all = cả phòng · one = nói riêng người trung tâm · mediate = ngồi giữa hai phe */
    variant?: 'all' | 'one' | 'mediate';
    /** chủ đề họp / điều cần thuyết phục (đã điền tên) */
    topic?: string;
    /** người trung tâm (nếu có) */
    centerId?: string;
  };
  /** hr_review: hồ sơ từng người để AI quyết (code đã lọc theo hàng rào hợp lý) */
  hrDossier?: {
    id: string; name: string; roleLabel: string;
    kpiRatios: number[];      // 7 ngày gần nhất
    lowStreak: number; warnings: number; caughtToday: number; hiredDay: number;
    mood: number; stress: number;
    attitude: string;         // tóm tắt ký ức / thái độ (≤ 160 ký tự)
    allowed: HrAction[];      // hành động được phép với người này (hàng rào)
  }[];
}

export interface SceneLine {
  speaker: string;            // agent id (phải thuộc participants)
  text: string;
  emote?: string;             // 1 emoji tuỳ chọn
  product?: boolean;          // câu này nhắc tới sản phẩm affiliate
}

export interface SceneResult {
  lines: SceneLine[];
  summary: string;            // 1 câu tóm tắt (log, bản tin, chống lặp chủ đề)
  relationshipChanges: { from: string; to: string; delta: number; reason: string }[];
  moodChanges: { id: string; delta: number }[];
  memories: { id: string; text: string }[];
  kpiChanges: { id: string; delta: number }[];
  rumor: { aboutId: string; text: string } | null;
  verdict: Verdict | null;    // interview: hired/rejected · resign_talk: stay/leave · raise_request: approved/denied · crisis_meeting: plan_a..d · pep_talk: inspired/unmoved
  hrDecisions?: HrDecision[] | null;   // chỉ hr_review
  source: 'llm' | 'offline';
}

// ---------------------------------------------------------------- v3: AI biên kịch (showrunner)
export interface BeatRequest {
  situation: string;          // tình hình hiện tại (KPI, quan hệ nổi bật, dự án, doanh thu, tin đồn, tin thời sự)
  menu: { kind: string; desc: string }[];   // các loại "biến" được phép + mô tả ngắn
  openArcs: string[];         // mạch đang mở (1 dòng/mạch)
  recentBeats: string[];      // beat gần đây (chống lặp)
  roster: { id: string; name: string; roleLabel: string }[];
}

export interface Beat {
  kind: string;               // thuộc BeatRequest.menu
  a?: string;                 // agent id chính
  b?: string;                 // agent id phụ
  intensity: number;          // 1..3
  note: string;               // 1 câu tiếng Việt: chuyện gì xảy ra
}

export interface BeatPlan { beats: Beat[]; source: 'llm' | 'offline' }

// ---------------------------------------------------------------- candidate / recap / rumor
export interface CandidateRequest {
  role: RoleKey;
  roleLabel: string;
  deskId: string;
  kpiTarget: number;
  replacingName?: string;     // tên người vừa bị đuổi
  usedNames: string[];        // tránh trùng tên
}

export interface KpiResult { id: string; name: string; roleLabel: string; kpi: number; target: number; ratio: number; lowStreak: number }

export interface RecapRequest {
  day: number;
  weekday: string;
  events: string[];           // tóm tắt sự kiện + cảnh trong ngày (đã rút gọn)
  kpi: KpiResult[];
  firedToday: string[];       // tên
  hiredToday: string[];       // tên
}

export interface DayRecap {
  day: number;
  weekday: string;
  headline: string;
  bullets: string[];          // 3-5 ý
  mvp: { id: string; name: string; reason: string } | null;
  drama: string;              // drama nổi bật nhất trong ngày
  kpi: KpiResult[];
  source: 'llm' | 'offline';
}

export interface RumorVersion { day: number; minute: number; tellerId: string; listenerId: string; text: string }

export interface Rumor {
  id: string;
  aboutId: string;
  aboutName: string;
  versions: RumorVersion[];   // bản gốc -> các bản bị "tam sao thất bản"
  heardBy: string[];          // agent id đã nghe
  createdDay: number;
  active: boolean;
}

// ---------------------------------------------------------------- log / feed
export type LogKind = 'line' | 'event' | 'hr' | 'scene_start' | 'scene_end' | 'system';

export interface LogEntry {
  id: number;
  day: number;
  minute: number;             // phút trong ngày
  kind: LogKind;
  channel?: Channel;
  sceneId?: string;
  speaker?: string;           // agent id (kind = 'line')
  speakerName?: string;
  text: string;
  icon?: string;
  product?: ProductPublic;
  news?: NewsRef;             // v3: thẻ tin gốc (scene_start của news_chat)
}

// ---------------------------------------------------------------- AI usage
/** Thống kê từng nhà cung cấp AI (Gemini, Groq, OpenAI...) — src/ai/router.ts */
export interface ProviderStats {
  name: string;               // 'gemini'
  label: string;              // 'Gemini' (hiển thị)
  model: string;
  enabled: boolean;           // sẵn sàng gọi NGAY lúc này (có key, không nghỉ, chưa chạm RPM/RPD/TPD)
  calls: number;              // số request đã gửi (kể cả lỗi)
  failures: number;
  inputTokens: number;
  outputTokens: number;
  costTodayUsd: number;
  rpdUsed: number;            // request hôm nay ("ngày" theo mốc reset của provider: Gemini 0h giờ Pacific, còn lại 0h giờ VN)
  rpdLimit?: number;
  tpdUsed: number;            // token hôm nay (cùng mốc ngày)
  tpdLimit?: number;
  cooldownUntil?: number;     // ms epoch đang nghỉ tới lúc đó; 0/undefined = không nghỉ
  cooldownReason?: string;    // tiếng Việt: 'hết quota ngày', 'sai API key'...
  format: 'json_schema' | 'json_object';
  lastError?: string;
}

export interface UsageStats {
  mode: 'llm' | 'offline';    // llm = đang có ít nhất 1 provider gọi được ngay
  model: string;              // model của provider đang dùng
  calls: number;
  failures: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costTodayUsd: number;
  costTotalUsd: number;
  budgetUsd: number;
  skipped: number;            // số cảnh bị bỏ vì giới hạn token
  lastError?: string;
  /** tên hiển thị của provider vừa dùng thành công / đang đứng đầu hàng (vd 'Gemini') */
  activeProvider?: string;
  /** chi tiết từng provider theo thứ tự ưu tiên (chip AI có thể vẽ danh sách này) */
  providers?: ProviderStats[];
}

// ---------------------------------------------------------------- protocol
export interface ClockInfo {
  time: number;               // phút game tuyệt đối
  day: number;                // 1..
  minute: number;             // phút trong ngày 0..1439
  weekday: string;            // 'Thứ Hai'...
  speed: number;              // hệ số tua (1, 2, 5, 10)
  isNight: boolean;
  timeMode: 'compressed' | 'realtime';
}

export interface StatusInfo {
  bossAway: boolean;
  bossNote: string;           // 'Sếp đang trong phòng' | 'Sếp đi đánh golf với đối tác'...
  viewers: number;
  ai: UsageStats;
  company: CompanyState;
  clicks: number;             // tổng lượt click link affiliate
  speed: number;
}

export interface PublicAgent {
  id: string; name: string; fullName: string; role: RoleKey; roleLabel: string;
  gender: Gender; age: number; bio: string; quirks: string[]; likes: string[]; dislikes: string[];
  traits: Traits; look: Look; deskId: string; deskItem: ProductPublic | null;
  status: AgentStatus; present: boolean;
  activity: Activity; activityLabel: string; emote: string; onPhone: boolean; sceneId: string | null;
  energy: number; mood: number; stress: number;
  kpiToday: number; kpiTarget: number; kpiHistory: { day: number; ratio: number }[];
  lowStreak: number; warnings: number; caughtToday: number;
  relationships: Record<string, Relationship>;
  memories: MemoryNote[];
  hiredDay: number;
  // --- v3 (tuỳ chọn, additive): hồ sơ vẽ chấm "tính cách gốc" + huy hiệu ⏳ thử thách / 🎁 thưởng / 🎖️ thăng chức
  traitBase?: Traits;
  probationUntilDay?: number;
  bonuses?: number;
  promotions?: number;
}

/** [id, x, y, dir, activity, emote, flags]  flags: 1=đang đi, 2=onPhone, 4=trong cảnh, 8=ẩn (đang trong WC, client không vẽ) */
export type FrameAgent = [string, number, number, Dir, Activity, string, number];

export interface PublicScene {
  id: string;
  type: SceneType;
  title: string;              // 'Tám chuyện ở pantry'
  icon: string;
  channel: Channel;
  participants: string[];
  locationLabel: string;
  status: 'start' | 'end';
  summary?: string;
  news?: NewsRef;             // v3
}

export type DevEventName =
  | 'boss_leave' | 'boss_return' | 'server_down' | 'wifi_down' | 'payday'
  | 'birthday' | 'deal' | 'drama' | 'hr_review' | 'release' | 'end_day'
  | 'news' | 'showrunner';    // v3: ép 1 cảnh thời sự / ép AI biên kịch lên beat ngay

export type ServerMsg =
  | {
      t: 'hello';
      map: unknown;                 // MAP_DATA từ src/sim/map.ts
      companyName: string;
      clock: ClockInfo;
      status: StatusInfo;
      agents: PublicAgent[];
      log: LogEntry[];              // ~200 dòng gần nhất
      recaps: DayRecap[];
      rumors: Rumor[];
      scenes: PublicScene[];        // cảnh đang diễn ra
      dev: boolean;                 // có hiện bảng dev không
      /** luật KPI đang áp dụng (từ .env) để client vẽ ngưỡng / huy hiệu "nguy cơ bị đuổi" cho đúng */
      rules?: { kpiLowRatio: number; kpiWarnDays: number; kpiFireDays: number };
      /** v2: sản phẩm trên kệ phòng trưng bày (docs/v2-contract.md) */
      products?: ShowroomProduct[];
      /** v3: tin thời sự gần đây đã/đang được bàn (mới nhất cuối) */
      news?: NewsRef[];
    }
  | { t: 'frame'; clock: ClockInfo; a: FrameAgent[]; ts: number }   // ts = Date.now() lúc server gửi — web nội suy theo mốc này, không theo lúc gói tới (Cloudflare làm gói đến so le)
  | { t: 'agents'; agents: PublicAgent[] }
  | { t: 'log'; entry: LogEntry; bubble?: { durationMs: number; nextSpeaker?: string } }
  | { t: 'scene'; scene: PublicScene }
  | { t: 'status'; status: StatusInfo }
  | { t: 'recap'; recap: DayRecap }
  | { t: 'rumors'; rumors: Rumor[] }
  | { t: 'toast'; icon: string; text: string };

export type ClientMsg =
  | { t: 'dev'; action: 'speed'; value: number }
  | { t: 'dev'; action: 'event'; name: DevEventName }
  | { t: 'ping' };

// ---------------------------------------------------------------- AI context
export interface PromptContext {
  companyName: string;
  company: CompanyState;
  day: number;
  minuteOfDay: number;
  weekday: string;
  timeLabel: string;          // '10:24'
  agents: Record<string, AgentState>;     // tất cả agent theo id (để tra cứu)
  roster: { id: string; name: string; roleLabel: string }[];  // nhân sự đang làm (status active)
  recentSummaries: string[];  // ~8 tóm tắt cảnh gần nhất (chống lặp chủ đề)
  bossAway: boolean;
  bossNote: string;
}

// ---------------------------------------------------------------- module APIs

/** src/ai/brain.ts — createBrain(config) */
export interface Brain {
  mode(): 'llm' | 'offline';
  /**
   * Gọi TRƯỚC khi tạo cảnh. Trả về bộ sinh thoại sẽ dùng, hoặc null = bỏ qua cảnh (tiết kiệm token).
   * Nếu trả về khác null thì coi như đã giữ chỗ (tính vào nhịp gọi).
   */
  reserve(priority: Priority): 'llm' | 'offline' | null;
  /** Không bao giờ throw. Lỗi/JSON hỏng => tự fallback offline. */
  generateScene(req: SceneRequest, ctx: PromptContext, via: 'llm' | 'offline'): Promise<SceneResult>;
  generateCandidate(req: CandidateRequest, ctx: PromptContext): Promise<Persona>;
  generateRecap(req: RecapRequest, ctx: PromptContext): Promise<DayRecap>;
  /** v3: AI biên kịch — đề xuất 1–3 "biến" cho vài giờ tới; lỗi → kế hoạch offline (ngẫu nhiên có trọng số) */
  generateBeats(req: BeatRequest, ctx: PromptContext): Promise<BeatPlan>;
  setAudience(viewers: number): void;
  usage(): UsageStats;
  serialize(): unknown;
  restore(data: unknown): void;
}

/** Director dùng để điều khiển World. World (src/sim/world.ts) implement. */
export interface WorldApi {
  readonly config: Config;
  // --- thời gian
  time(): number;             // phút game tuyệt đối
  day(): number;
  minuteOfDay(): number;
  weekday(): string;
  speed(): number;
  clock(): ClockInfo;
  // --- truy vấn
  agents(): AgentState[];     // tất cả (kể cả candidate / fired đang đi ra)
  agent(id: string): AgentState | undefined;
  activeAgents(): AgentState[]; // status 'active' && present
  boss(): AgentState | undefined;
  hr(): AgentState | undefined;
  bossAway(): boolean;
  bossNote(): string;
  /** v5: hôm nay văn phòng đóng cửa (cuối tuần ở TIME_MODE=realtime) — tuỳ chọn để bản giả trong test khỏi phải cài */
  officeClosed?(): boolean;
  company(): CompanyState;
  viewers(): number;
  // --- điều khiển di chuyển / hoạt động
  /** Giữ 1 chỗ trống trong SPOTS[group]; trả về toạ độ hoặc null nếu hết chỗ */
  reserveSpot(id: string, group: string): Pt | null;
  releaseSpot(id: string): void;
  /** Ô đứng cạnh bàn của agent (để người khác đến nói chuyện) */
  visitorSpot(targetId: string): Pt;
  deskSeat(id: string): Pt;
  /** Đặt hoạt động; nếu có target thì tự tìm đường đi tới đó */
  setActivity(id: string, activity: Activity, durationMin: number,
    opts?: { target?: Pt; label?: string; emote?: string }): void;
  isArrived(id: string): boolean;
  teleport(id: string, p: Pt): void;
  faceToward(id: string, p: Pt): void;
  distance(aId: string, bId: string): number;
  // --- vòng đời nhân sự
  addAgent(p: Persona, status: AgentStatus, at: Pt): AgentState;
  /** Đuổi việc: status 'fired', ôm thùng 📦 đi ra cửa rồi biến mất */
  fireAgent(id: string): void;
  /** Ứng viên trúng tuyển: thành nhân viên chính thức, về bàn làm việc */
  hireAgent(id: string): void;
  /** Ứng viên trượt: đi ra cửa rồi biến mất */
  dismissCandidate(id: string): void;
  // --- hiệu ứng
  adjust(id: string, d: { energy?: number; mood?: number; stress?: number; kpi?: number }): void;
  changeRelationship(fromId: string, toId: string, delta: number, note: string): void;
  addMemory(id: string, text: string): void;
  /** v4: đổi "món đồ trên bàn" (hiện trên bàn + hồ sơ) — vd vừa nhận hàng / được tặng quà; id sai → bỏ qua */
  setDeskItem(id: string, productId: string): void;
  setIncident(kind: CompanyState['incident']): void;
  addRevenue(millionVnd: number): void;
  // --- đầu ra cho client
  emit(msg: ServerMsg): void;
  log(e: Omit<LogEntry, 'id' | 'day' | 'minute'>, bubble?: { durationMs: number; nextSpeaker?: string }): LogEntry;
  toast(icon: string, text: string): void;
}

/** World gọi vào Director. Director (src/sim/director.ts) implement. */
export interface DirectorApi {
  /** Gọi mỗi tick (~100ms thật), sau khi World cập nhật di chuyển */
  tick(dtRealMs: number): void;
  onDayStart(day: number): void;
  /** Cuối ngày: World đã tính KPI xong. Director lên lịch HR cho ngày mai + viết bản tin */
  onDayEnd(day: number, results: KpiResult[]): void;
  onEvent(name: DevEventName, data?: { agentId?: string; note?: string }): void;
  onBossLeft(reason: string): void;
  onBossReturned(): void;
  /** Sếp đi ngang thấy nhân viên đang lười. Director lo hậu quả (cảnh mắng hoặc log + phạt nhẹ) */
  onSlackerSpotted(bossId: string, victimId: string): void;
  onAgentArrived(id: string, late: boolean): void;
  publicScenes(): PublicScene[];
  recaps(): DayRecap[];
  rumors(): Rumor[];
  serialize(): unknown;
  restore(data: unknown): void;
}
