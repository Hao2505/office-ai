// =====================================================================
//  Director — "biên kịch trưởng" của văn phòng ảo (SPEC §5).
//  Lên lịch cảnh, gom người, gọi Brain viết thoại, phát từng câu, áp hiệu ứng,
//  HR (cảnh cáo → đuổi → phỏng vấn → chào người mới), sự kiện, tin đồn,
//  sản phẩm affiliate, bản tin cuối ngày, lưu/khôi phục.
//  Nguyên tắc: tick() không bao giờ throw; kết quả async đến muộn bị bỏ qua.
// =====================================================================
import type {
  Activity, AgentState, BeatPlan, Brain, Channel, DayRecap, DevEventName, DirectorApi, HrAction, HrDecision, KpiResult, NewsCategory,
  NewsItem, NewsRef, Persona, Priority, Product, ProductShelf, PromptContext, PublicScene, RecapRequest, RoleKey, Rumor,
  SceneRequest, SceneResult, SceneType, Traits, Verdict, WorldApi,
} from '../types.js';
import type { Config } from '../config.js';
import type { Pt } from './map.js';
import { SPOTS } from './map.js';
import { ACTIVITY_FLAVOR, NEWS_CATEGORIES, PERSONAL_EVENTS, newsBlocked, type TopicCategory } from '../content/catalog.js';
import { contextScore, getProduct, getProducts, pickProduct, pickShelfProduct, priceFeelOf, shortNameOf, toPublic } from '../content/products.js';
import { PRODUCT_ANGLES, SHOPPING_THEMES, fillAngle, themeByKey, type ProductAngle, type ShoppingTheme } from '../content/shopping.js';
import {
  SCENE_DEFS, SPOT_LABELS, AREA_LABELS, GROUP_CHAT_LABEL, COMPANY_CHAT_LABEL, STANDUP_ROLES, DEV_ROLES,
  GROUP_REASONS, COMPANY_REASONS, CELEBRATION_REASONS, isSceneType, isTech, isBiz, rand, randInt, chance, clamp, fin, pick, shuffle,
  weightedPick, hhmm, cut, listVi, actPhrase, bossNoteShort, kpiPct, relScore, mutual, deadlineDaysLeft, topicCatsFor, safeTopic,
  snapOf, atDesk, areaOf, motiveAct, findCoLocated, pickDeskVisit, pickGossipPair, pickGossipSubject, pickGroupMembers, pickCompanyChat,
  pickFriendsGroup, findPingpongPair, nearbySlacker, celebrationTitle,
  sitPantry, sitDeskVisit, sitGossip, sitGroupChat, sitCompanyChat, sitStandup, sitLunch, sitBossCatch,
  sitBossCall, sitHrWarning, sitFiring, sitInterview, sitIncident, sitCelebration, sitConfront, sitPingpong,
  sitWelcome,
  SHELF_LABEL, SHELF_SPOT, showroomAvailable, shelfAt, preferredShelf, findShowroomGroup, pickRecommender, sitShowroom,
  pickNewsGroup, newsRefOf, sitNewsChat, sitHrReview, sitResignTalk, sitRaiseRequest, sitPromotion, sitLayoff,
  sitCrisisMeeting, sitPepTalk,
  type SceneDef, type SitKit, type Situation, type GroupReason, type CompanyReason, type ReasonData,
  type CelebrationReason, type BossCallReason, type CoLocation, type DeskVisitPick, type ShowroomGroup, type VisitTone,
  type HrDossierEntry,
} from './scenes.js';
import { RumorBook } from './rumors.js';
import {
  lowestPerformer, hrEligible, vacancyFor, extraVacancy, detectVacancies, candidateRequest, interviewPanel, roleInfo, workdayElapsed,
  newLedger, restoreLedger, pruneLedger, allowedActions, buildDossier, reviewTriggers, revenueTrigger, revenueRatio, revenueZone, freeDesks,
  validateDecisions, offlineDecisions, avgRatio, kpiRatios, promotedLabel, promotedTarget, layoffsInMonth, ACTION_LABEL,
  type Vacancy, type HrLedger, type GuardEnv,
} from './hr.js';
import { Showrunner, arcSummary, sitWorldOf, type Arc, type StoryAction, type StoryContext } from './story.js';
import { fillSit, isSituation, plansFor, situationDef, type PlanCode } from '../content/situations.js';
import { getNews as newsSingleton } from '../news/store.js';
import { getArchive as archiveSingleton } from './archive.js';

// ---------------------------------------------------------------- hằng số (ms thật theo đồng hồ nội bộ)
const CHECK_MS = 2000;            // kiểm tra cảnh tự phát
const QUEUE_MS = 1000;            // xử lý hàng đợi
const WATCH_MS = 1000;            // theo dõi hoạt động (đếm cà phê, toilet...)
const SWEEP_MS = 10_000;          // dọn agent mồ côi, vị trí trống
const LEAK_MS = 15_000;           // tin đồn lộ tới tai người bị đồn
const GATHER_TELEPORT_MS = 45_000;
const RESULT_TIMEOUT_MS = 35_000;
const CANDIDATE_TIMEOUT_MS = 40_000;
const MAX_PLAY_MS = 3 * 60_000; // < watchdog 5 phút của World
const OFFICE_GAP_MS = 3000;
const ONLINE_GAP_MS = 45_000;
const AGENT_COOLDOWN_MS = 60_000;
const PRODUCT_WARMUP_MS = 2 * 60_000;
/** sếp bắt quả tang lúc slot văn phòng đang bận: chờ tối đa bấy nhiêu phút game rồi thôi (chỉ "ghi sổ") */
const CATCH_WAIT_MIN = 20;
/** v2: tối đa 1 cảnh showroom_chat mỗi bấy nhiêu phút THẬT (đổi bằng env SHOWROOM_SCENE_MIN_MINUTES) */
const SHOWROOM_MIN_MINUTES_DEFAULT = 30;
/** mời người qua phòng trưng bày: chờ tối đa bấy nhiêu phút game cho họ tới nơi */
const SHOWROOM_NUDGE_WAIT_MIN = 14;

function showroomMinMs(): number {
  const raw = process.env.SHOWROOM_SCENE_MIN_MINUTES;
  const n = raw !== undefined && raw.trim() !== '' ? Number(raw) : NaN;
  return (Number.isFinite(n) && n >= 0 ? n : SHOWROOM_MIN_MINUTES_DEFAULT) * 60_000;
}

/**
 * v3: cấu hình do sim engineer thêm vào src/config.ts — đọc phòng thủ: thử các tên camelCase trong CONFIG,
 * rồi biến môi trường, rồi mặc định (Director không phụ thuộc thứ tự tích hợp).
 */
function cfgNum(cfg: Config, keys: string[], env: string, d: number): number {
  const c = cfg as unknown as Record<string, unknown>;
  for (const k of keys) {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const raw = process.env[env];
  const n = raw !== undefined && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : d;
}
function cfgBool(cfg: Config, keys: string[], env: string, d: boolean): boolean {
  const c = cfg as unknown as Record<string, unknown>;
  for (const k of keys) if (typeof c[k] === 'boolean') return c[k] as boolean;
  const raw = process.env[env];
  if (raw === undefined || raw.trim() === '') return d;
  return !['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/** v3: các API World của sim engineer — gọi khi có, bỏ qua khi chưa có (Director không phụ thuộc thứ tự tích hợp) */
interface WorldV3 {
  driftTrait?(id: string, trait: keyof Traits, delta: number): unknown;
  /** World tự tăng promotions khi đổi chức danh */
  setRole?(id: string, roleLabel: string, kpiTarget: number): void;
  removeAgent?(id: string, reason: string): void;
  setProbation?(id: string, untilDay: number | null): void;
  grantBonus?(id: string): void;
  headcount?(): number;
  /** World có thể bọc kho tin; không có thì Director dùng singleton src/news/store.ts */
  getNews?(): NewsApi | null | undefined;
  getArchive?(): ArchiveApi | null | undefined;
}
/** src/news/store.ts (sim engineer): kho tin RSS đã lọc — exclude là Set id */
interface NewsApi {
  pick(categories?: readonly NewsCategory[] | null, exclude?: ReadonlySet<string> | null): NewsItem | null | undefined;
  markUsed?(id: string): void;
  recent?(n: number): NewsRef[];
}
/** src/sim/archive.ts (sim engineer): record(kind, data) — JSONL theo ngày, no-op khi archive tắt */
interface ArchiveApi {
  record?(kind: string, data: unknown): unknown;
}

/**
 * Verdict hợp lệ khi nhận kết quả cảnh (cleanResult). Record đầy đủ theo union `Verdict` để thêm giá trị mới mà quên ở đây
 * thì typecheck báo — v5 từng quên plan_a..plan_d / inspired / unmoved nên mọi phương án AI chốt bị thay bằng lựa chọn dự phòng.
 */
const VERDICT_OK: Record<Verdict, true> = {
  hired: true, rejected: true, stay: true, leave: true, approved: true, denied: true,
  plan_a: true, plan_b: true, plan_c: true, plan_d: true, inspired: true, unmoved: true,
};
const VERDICTS = Object.keys(VERDICT_OK) as Verdict[];
const NEWS_MIN_MINUTES_DEFAULT = 25;
const STORY_MS = 3000;            // nhịp kiểm tra mạch truyện (giờ thật)
const NEWS_USED_KEEP = 60;
const NEWS_DISCUSSED_KEEP = 20;
/** cảnh HR / câu chuyện được diễn lại nếu bị gián đoạn */
const RETRY_TYPES: SceneType[] = ['firing', 'hr_warning', 'hr_review', 'promotion', 'layoff', 'resign_talk', 'raise_request'];
/** quyết định đã chốt trong hr_review mà cảnh chưa diễn được (người vắng / bận) → hoãn sang sáng mai thay vì lặng lẽ bỏ */
const DEFERRABLE_TYPES: SceneType[] = ['firing', 'layoff', 'promotion'];
const DEFER_LABEL: Partial<Record<SceneType, string>> = { firing: 'cho nghỉ việc', layoff: 'cắt giảm', promotion: 'thăng chức' };
const DEFER_MAX_RETRIES = 2;
const HR_SCENE_TYPES: SceneType[] = ['hr_warning', 'firing', 'promotion', 'layoff', 'resign_talk', 'raise_request'];

/** thông tin 1 quyết định nhân sự đã thi hành (test kiểm tra hàng rào độc lập qua director.hooks.decision) */
export interface DecisionInfo {
  day: number;
  decision: HrDecision;
  allowed: HrAction[];
  source: 'llm' | 'offline';
  env: GuardEnv;
  ledger: { lastFireDay: number; lastPromotionDay: number; lowRevenuePeriods: number; lastBonusDay: number; lastBonusAnyDay: number; layoffsInMonth: number };
  agent: {
    id: string; lowStreak: number; warnings: number; hiredDay: number; onProbation: boolean;
    ratios: number[]; avg7: number | null; kpiFireDays: number;
  } | null;
}

const KEEP_SUMMARIES = 12;
const KEEP_DAY_EVENTS = 40;
const KEEP_RECAPS = 14;
const QUEUE_MAX = 40;

const PRIO_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const OFFICE_HOURS = { from: 470, to: 1095 };   // 07:50 – 18:15: cảnh tự phát
const COUNTED: Activity[] = ['coffee', 'toilet', 'pingpong', 'slacking', 'napping', 'snack', 'chill', 'showroom'];
const BUSY_ALWAYS: Activity[] = ['leaving', 'offsite', 'away'];

// ---------------------------------------------------------------- kiểu nội bộ
type Placement =
  | { how: 'stay' }
  | { how: 'seat' }
  | { how: 'visit'; hostId: string }
  | { how: 'spot'; group: string; optional?: boolean; orStay?: boolean };

interface SceneMeta {
  reason?: string;
  note?: string;
  targetId?: string;
  victimId?: string;
  candidateId?: string;
  vacancyRole?: RoleKey;
  forceHire?: boolean;
  centerId?: string;
  rumorId?: string;
  retries?: number;
  label?: string;
  // --- v3
  newsId?: string;
  arcId?: string;
  newLabel?: string;
  hint?: string;
  variant?: string;
  force?: boolean;
  // --- v5: tình huống công ty
  /** lựa chọn dự phòng đã chọn sẵn (offline viết thoại theo nó; AI trả sai mã thì dùng nó) */
  pick?: string;
  /** mã phương án đã đưa ra bàn, phân cách bằng dấu phẩy */
  options?: string;
}

interface Draft {
  type: SceneType;
  participants: string[];
  /** v3: kênh khác registry (news_chat online khi slot văn phòng bận) */
  channel?: Channel;
  /** v3: tin thật đang bàn (news_chat) → req.news + thẻ tin trên log/PublicScene */
  news?: NewsItem;
  /** v3: hồ sơ xét nhân sự (hr_review) → req.hrDossier */
  hrDossier?: HrDossierEntry[];
  /** v5: tình huống công ty (crisis_meeting / pep_talk) → req.crisis */
  crisis?: SceneRequest['crisis'];
  place?: Record<string, Placement>;
  /** những người phải giữ chỗ cùng 1 nhóm SPOTS (thử lần lượt) — vd nói xấu ở góc vắng */
  joint?: { ids: string[]; groups: string[] };
  aboutId?: string;
  locationLabel: string;
  /** viết tình huống SAU khi đã chốt người & chỗ (vd có người không còn chỗ thì bị loại) */
  sit: (people: AgentState[], label: string) => Situation;
  /** undefined = theo registry; [] = không gợi ý chủ đề */
  topicCats?: TopicCategory[];
  rumor?: { id: string; aboutId: string; currentText: string; isNew: boolean; tellerId: string };
  productFor?: { initiatorId?: string };
  /** sản phẩm đã chọn sẵn, BẮT BUỘC có (showroom_chat) — bỏ qua nhịp/cap sản phẩm thường */
  product?: Product;
  /** chất liệu thay cho pitch (showroom: nhận xét của chủ dự án) */
  productPitch?: string;
  /** người nên nói câu sản phẩm */
  productSpeaker?: string;
  /** v4: kiểu chuyện / cớ (đã điền tên) + cớ ngắn cho câu mẫu + chế độ (unboxing, gift…) */
  productAngle?: string;
  productHook?: string;
  productMode?: ProductMode;
  productAngleKey?: string;
  /** xác suất người nhắc chốt đơn sau cảnh (→ "hàng về, khui hộp") */
  productBuys?: number;
  prio?: Priority;
  meta?: SceneMeta;
  title?: string;
  icon?: string;
  allowAbsent?: string[];
  minPeople?: number;
  /** nhãn/emote hoạt động riêng cho từng người (mặc định theo registry) */
  labels?: Record<string, { label: string; emote: string }>;
}

interface Scene {
  id: string;
  type: SceneType;
  def: SceneDef;
  channel: Channel;
  prio: Priority;
  title: string;
  icon: string;
  participants: string[];
  aboutId?: string;
  locationLabel: string;
  targets: Record<string, Pt | null>;
  req: SceneRequest;
  via: 'llm' | 'offline';
  phase: 'gathering' | 'playing';
  createdAt: number;
  startedAt: number;
  result: SceneResult | null;
  failed: boolean;
  lineIdx: number;
  nextAt: number;
  started: boolean;
  ended: boolean;
  teleported: boolean;
  product: Product | null;
  productShown: boolean;
  /** v4: món này được mời vào cảnh theo kiểu chuyện nào (để ghi nhận + lên lịch giao hàng) */
  offer?: ProductOffer | null;
  rumor?: { id: string; aboutId: string; isNew: boolean; tellerId: string };
  meta: SceneMeta;
  allowAbsent: Set<string>;
  /** v3: thẻ tin gốc (news_chat) */
  news?: NewsRef;
}

interface QData {
  targetId?: string;
  reason?: string;
  note?: string;
  name?: string;
  label?: string;
  role?: RoleKey;
  centerId?: string;
  rumorId?: string;
  initiatorId?: string;
  motiveKey?: string;
  /** người được nhắc trong nhóm chat (vd người vừa bị đuổi) */
  aboutId?: string;
  why?: string;
  retries?: number;
  /** interview: ứng viên đã sinh sẵn (không lưu xuống file) */
  candidate?: Persona;
  // --- v3 (chuỗi để lưu/khôi phục đơn giản)
  /** desk_visit: giọng cảnh theo mạch truyện (tense | warm | makeup | unbox | gift | support) */
  tone?: string;
  /** standup: 'pitch' = buổi pitch ý tưởng */
  variant?: string;
  /** group_chat / gossip: id không được tham gia, phân cách bằng dấu phẩy */
  exclude?: string;
  /** news_chat: 'group' = diễn trong nhóm chat kín */
  channel?: string;
  /** mạch truyện sinh ra cảnh này */
  arcId?: string;
  /** promotion: nhãn chức danh mới */
  newLabel?: string;
  /** resign_talk: dấu hiệu chán việc */
  hint?: string;
  /** '1' = nút dev ép (bỏ nhịp/cap) */
  force?: string;
  // --- v4: cảnh có món đồ đi kèm (khui hộp, tặng quà, chuyện mua sắm của AI biên kịch)
  productId?: string;
  productMode?: string;
  productAngle?: string;
  // --- v5: tình huống công ty (crisis_meeting / pep_talk)
  kind?: string;
  aId?: string;
  bId?: string;
}

interface QItem {
  id: string;
  type: SceneType;
  at: number;       // phút game tuyệt đối: bắt đầu được diễn
  until: number;    // quá hạn thì bỏ
  prio: Priority;
  data: QData;
  tries: number;
  nextTry?: number; // đồng hồ nội bộ (không lưu)
}

interface Timer {
  id: string;
  at: number;       // phút game tuyệt đối
  /** personal (v3) = sự kiện cá nhân ngẫu nhiên (ốm, kẹt xe, thất tình…)
   *  v4: theme = bắt đầu một "vụ mua sắm"; theme_end = kết vụ; delivery = shipper giao hàng cho agentId */
  kind: 'clear_incident' | 'event' | 'personal' | 'theme' | 'theme_end' | 'delivery';
  incident?: 'server_down' | 'wifi_down';
  event?: DevEventName;
  agentId?: string;
  productId?: string;
  themeKey?: string;
  tries?: number;
  /** delivery: lúc đặt hàng (phút game) — đơn quá DELIVERY_MAX_AGE thì thôi (ngày văn phòng đóng cửa không tính lần giao hụt) */
  since?: number;
}

/** v4: đơn hàng chờ quá lâu (văn phòng đóng cửa nhiều ngày / server tắt) thì bỏ — 5 ngày */
const DELIVERY_MAX_AGE = 5 * 1440;

/** v4: chế độ câu nhắc sản phẩm (xem SceneRequest.product.mode) */
type ProductMode = NonNullable<NonNullable<SceneRequest['product']>['mode']>;

/** v4: món đồ được mời vào một cảnh + "chuyện" của nó */
interface ProductOffer {
  product: Product;
  angle: string;
  hook?: string;
  mode: ProductMode;
  speaker?: string;
  angleKey?: string;
  buys: number;
}

/** v4: "vụ mua sắm" đang chạy */
interface ThemeState { key: string; startedAt: number; until: number; announce: string }

interface Boost { until: number; reason: GroupReason; data: ReasonData; used: number }

// ---------------------------------------------------------------- Director
export class Director implements DirectorApi {
  private readonly world: WorldApi;
  private readonly brain: Brain;
  private readonly cfg: Config;

  private clockMs = 0;
  private office: Scene | null = null;
  private online: Scene | null = null;
  private queue: QItem[] = [];
  private timers: Timer[] = [];
  private book = new RumorBook();
  private recapList: DayRecap[] = [];
  private summaries: string[] = [];
  private recentTopics: string[] = [];
  private dayEvents: string[] = [];
  private notable: string[] = [];
  private firedToday: string[] = [];
  private hiredToday: string[] = [];
  private lateToday: Record<string, number> = {};
  private lateDays: Record<string, number[]> = {};
  private vacancies: Vacancy[] = [];
  private usedNames: string[] = [];
  private birthdays: Record<string, number> = {};
  private birthdayToday: string | null = null;
  private lastBirthdayDay = 0;
  private boost: Boost | null = null;
  private companyToday = new Set<CompanyReason>();
  private productBoostUntil = 0;
  private recentProducts: string[] = [];
  private productLock: string | null = null;
  // --- v4: chuyện mua sắm (docs/04 §11)
  private theme: ThemeState | null = null;
  private recentThemes: string[] = [];
  private lastThemeDay = -1;
  private recentAngles: string[] = [];
  /** số lần mỗi món đã được nhắc (xoay vòng cho đều 26 món) */
  private productUses: Record<string, number> = {};
  /** ai đang có món gì (mua về / được tặng) — để vài hôm sau họ quay lại giới thiệu cho người khác */
  private owned: Record<string, { id: string; day: number }[]> = {};
  private deliveriesToday = 0;
  private lastProductAt: number;
  /** v2: cảnh showroom_chat gần nhất (đồng hồ nội bộ) + cap riêng */
  private lastShowroomAt: number;
  private readonly showroomMinMsVal = showroomMinMs();
  /** nhóm vừa được mời qua phòng trưng bày, chờ họ tới nơi rồi diễn */
  private nudge: { ids: string[]; shelf: ProductShelf; until: number } | null = null;
  private plannedDay = 0;
  private lastRecapDay = 0;
  private seq = 0;
  private counters = { scenes: 0, lines: 0, aborted: 0, catches: 0, warnings: 0, firings: 0, hires: 0, rejections: 0, products: 0, showroom: 0 };

  private lastOfficeEnd = -1e9;
  private lastOnlineEnd = -1e9;
  private onlineGapMs = ONLINE_GAP_MS;
  private lastCaught = new Map<string, number>();
  private nextCheckAt = 0;
  private nextQueueAt = 0;
  private nextSweepAt = 0;
  private nextLeakAt = LEAK_MS;
  private nextWatchAt = 0;
  private agentLast = new Map<string, number>();
  private lastAct = new Map<string, Activity>();
  private actCounts: Record<string, Partial<Record<Activity, number>>> = {};
  private daySawPresence = false;
  private candJobs = new Map<string, number>();
  /** người vừa rời công ty (bị đuổi) — vẫn cho Brain tra tên vài ngày để thoại/nhóm chat nhắc đúng người */
  private departed = new Map<string, { a: AgentState; day: number }>();
  /** ai đã bị gọi lên phòng sếp hôm nay (đỡ gọi một người 2 lần/ngày) */
  private calledToday = new Set<string>();
  private dismissed = new Set<string>();
  private errAt = 0;
  private errSuppressed = 0;

  // ---------------------------------------------------------------- v3: câu chuyện tự phát triển
  /** AI biên kịch: sổ mạch truyện + lịch lên beat */
  private story: Showrunner;
  /** sổ HR: cap đuổi/thăng/thưởng, kỳ doanh thu thấp, ngày buồn… */
  private ledger: HrLedger = newLedger();
  private readonly newsEnabled: boolean;
  private readonly newsMinMsVal: number;
  private readonly newsAllowShowbiz: boolean;
  private readonly newsMaxAgeDays: number;
  private readonly showrunnerEnabled: boolean;
  private readonly traitDrift: boolean;
  private readonly hrReviewEveryDays: number;
  private lastNewsAt: number;
  /** lần gần nhất một tin thật được gắn làm chủ đề cho tám chuyện / ăn trưa (cũng theo nhịp NEWS_SCENE_MIN_MINUTES) */
  private lastNewsHintAt = -1e12;
  /** id tin đã bàn (mỗi tin chỉ dùng 1 lần) */
  private newsUsed: string[] = [];
  /** thẻ tin đã bàn gần đây (hello.news, bản tin) */
  private discussedNews: NewsRef[] = [];
  private newsCatIdx = 0;
  /** sếp đang "khó ở" (boss_mood_swing) tới phút game này: bắt lười phạt nặng hơn */
  private bossStrictUntil = 0;
  private bossLeftAt: number | null = null;
  private bossAwayMin = 0;
  private overtime: { untilDay: number; ids: string[]; minutes: number } | null = null;
  private lateTomorrow: Record<string, number> = {};
  private driftPlans: { id: string; trait: keyof Traits; delta: number; days: number }[] = [];
  private planning = false;
  private planningAt = 0;
  private nextStoryAt = 0;
  /** số dòng 🎬 đã ghi hôm nay (≤ 2) */
  private clapsToday = 0;
  private v3 = {
    newsScenes: 0, newsHints: 0, hrReviews: 0, decisionsApplied: 0, decisionsRejected: 0, decisionsDeferred: 0, decisionsCancelled: 0,
    resigns: 0, layoffs: 0, promotions: 0, raisesApproved: 0, raisesDenied: 0, personalEvents: 0, drifts: 0, archived: 0, probationsResolved: 0,
  };
  /** móc cho test / debug (không thuộc DirectorApi) */
  hooks: { decision?: (info: DecisionInfo) => void } = {};

  constructor(world: WorldApi, brain: Brain) {
    this.world = world;
    this.brain = brain;
    this.cfg = world.config;
    this.lastProductAt = -this.productMinMs() + PRODUCT_WARMUP_MS;
    this.lastShowroomAt = -this.showroomMinMsVal + PRODUCT_WARMUP_MS;
    const c = this.cfg;
    this.newsEnabled = cfgBool(c, ['newsEnabled'], 'NEWS_ENABLED', true);
    this.newsMinMsVal = Math.max(0, cfgNum(c, ['newsSceneMinMinutes'], 'NEWS_SCENE_MIN_MINUTES', NEWS_MIN_MINUTES_DEFAULT)) * 60_000;
    this.newsAllowShowbiz = cfgBool(c, ['newsAllowShowbiz'], 'NEWS_ALLOW_SHOWBIZ', true);
    this.newsMaxAgeDays = Math.max(0, cfgNum(c, ['newsMaxAgeDays'], 'NEWS_MAX_AGE_DAYS', 3));
    this.showrunnerEnabled = cfgBool(c, ['showrunnerEnabled'], 'SHOWRUNNER_ENABLED', true);
    this.traitDrift = cfgBool(c, ['storyTraitDrift'], 'STORY_TRAIT_DRIFT', true);
    this.hrReviewEveryDays = Math.max(1, Math.floor(cfgNum(c, ['hrReviewEveryDays'], 'HR_REVIEW_EVERY_DAYS', 3)));
    this.story = new Showrunner(Math.max(20, cfgNum(c, ['showrunnerEveryGameMinutes'], 'SHOWRUNNER_EVERY_GAME_MINUTES', 120)));
    this.lastNewsAt = -this.newsMinMsVal + PRODUCT_WARMUP_MS;
  }

  // ================================================================ DirectorApi
  tick(dtRealMs: number): void {
    try {
      const dt = fin(dtRealMs, 100);
      this.clockMs += clamp(dt, 0, 10_000);
      this.ensureDayPlanned();
      this.runTimers();
      for (const s of [this.office, this.online]) if (s) this.updateSceneSafe(s);
      if (this.clockMs >= this.nextWatchAt) {
        this.nextWatchAt = this.clockMs + WATCH_MS;
        this.watch();
      }
      if (this.clockMs >= this.nextSweepAt) {
        this.nextSweepAt = this.clockMs + SWEEP_MS;
        this.sweep();
      }
      if (this.clockMs >= this.nextQueueAt) {
        this.nextQueueAt = this.clockMs + QUEUE_MS;
        this.processQueue();
      }
      if (this.clockMs >= this.nextLeakAt) {
        this.nextLeakAt = this.clockMs + LEAK_MS;
        this.leakCheck();
      }
      if (this.clockMs >= this.nextCheckAt) {
        this.nextCheckAt = this.clockMs + CHECK_MS;
        this.spontaneous();
      }
      if (this.clockMs >= this.nextStoryAt) {
        this.nextStoryAt = this.clockMs + STORY_MS;
        this.storyTick();
      }
    } catch (e) {
      this.err('tick', e);
    }
  }

  onDayStart(day: number): void {
    this.guard('onDayStart', () => {
      for (const s of [this.office, this.online]) if (s) this.abort(s, 'sang ngày mới');
      const d = Math.floor(fin(day, this.world.day()));
      this.planDay(d);
      this.applyDayStartStory(d);
    });
  }

  onDayEnd(day: number, results: KpiResult[]): void {
    this.guard('onDayEnd', () => {
      const d = Math.floor(fin(day, this.world.day()));
      for (const s of [this.office, this.online]) if (s) this.abort(s, 'hết ngày');
      const list = Array.isArray(results) ? results.filter((r) => r && typeof r.id === 'string') : [];
      const worked = this.daySawPresence || list.some((r) => fin(r.kpi) > 0);
      if (worked) this.endOfDayHr(d);
      if (worked && this.lastRecapDay !== d) {
        this.lastRecapDay = d;
        this.makeRecap(d, list);
      }
      // dọn hàng đợi của ngày đã qua (giữ lịch của ngày mai); cảnh cho nghỉ / cắt giảm / thăng chức đã chốt → hoãn sang mai
      const tomorrow = this.absFor(d + 1, 0);
      const gone = this.queue.filter((q) => !(q.at >= tomorrow || q.until >= tomorrow));
      this.queue = this.queue.filter((q) => q.at >= tomorrow || q.until >= tomorrow);
      for (const q of gone) this.deferDecisionScene(q, 'hết ngày mà chưa diễn được');
      // v4: hàng chưa kịp giao (giờ giao rơi sau giờ tan làm / đêm bị tua qua) → để ở lễ tân, sáng mai 09:30–11:00 nhận
      // (như nhánh "vắng mặt" của deliver(); tối đa 2 lần dời — ngày không ai đi làm không tính; đơn quá 5 ngày thì thôi)
      for (const t of this.timers) {
        if (t.kind !== 'delivery' || t.at >= tomorrow) continue;
        if (this.daySawPresence) t.tries = (t.tries ?? 0) + 1;
        const stale = tomorrow - (t.since ?? t.at) > DELIVERY_MAX_AGE;
        t.at = (t.tries ?? 0) > 2 || stale ? -1 : this.absFor(d + 1, randInt(570, 660));
      }
      this.timers = this.timers.filter((t) => t.at >= tomorrow || t.kind === 'clear_incident');
    });
  }

  onEvent(name: DevEventName, data?: { agentId?: string; note?: string }): void {
    // World gọi = nút dev (hoặc deal/release thật của World) → có phản hồi khi sự kiện không làm được
    this.handleEvent(name, data, false);
  }

  /** auto = sự kiện ngẫu nhiên tự lên lịch trong ngày (im lặng nếu không làm được) */
  private handleEvent(name: DevEventName, data: { agentId?: string; note?: string } | undefined, auto: boolean): void {
    this.guard('onEvent', () => {
      const agentId = typeof data?.agentId === 'string' ? data.agentId : undefined;
      const note = typeof data?.note === 'string' ? cut(data.note, 80) : undefined;
      switch (name) {
        case 'server_down': this.evServerDown(auto); break;
        case 'wifi_down': this.evWifiDown(auto); break;
        case 'payday': this.evPayday(); break;
        case 'birthday': this.evBirthday(agentId, auto); break;
        case 'deal': this.evDeal(agentId); break;
        case 'drama': this.evDrama(); break;
        case 'release': this.evRelease(note); break;
        case 'hr_review': this.evHrReview(); break;
        case 'news': this.evNews(); break;
        case 'showrunner': this.evShowrunner(); break;
        default: break; // boss_leave / boss_return / end_day: World lo
      }
    });
  }

  onBossLeft(reason: string): void {
    this.guard('onBossLeft', () => {
      const r = cut(reason, 80) || bossNoteShort(this.world, 80) || 'ra ngoài gặp đối tác';
      this.logEvent('🏌️', `Sếp ra ngoài: ${r}`);
      const now = this.now();
      if (this.bossLeftAt === null) this.bossLeftAt = now;
      this.setBoost('boss_left', { note: r }, 120);
      this.enqueue('group_chat', now + rand(1.5, 5), now + 45, 'normal', { reason: 'boss_left', note: r });
    });
  }

  onBossReturned(): void {
    this.guard('onBossReturned', () => {
      this.logEvent('🚪', 'Sếp đã về! Cả văn phòng giả vờ làm việc 😰');
      const now = this.now();
      if (this.bossLeftAt !== null) {
        this.bossAwayMin += Math.max(0, now - this.bossLeftAt);
        this.bossLeftAt = null;
      }
      if (this.boost?.reason === 'boss_left') this.boost = null;
      this.queue = this.queue.filter((q) => !(q.type === 'group_chat' && q.data.reason === 'boss_left'));
      if (chance(0.5)) this.enqueue('group_chat', now + rand(0.3, 2), now + 20, 'normal', { reason: 'boss_back' });
      if (chance(0.35)) this.enqueue('boss_call', now + rand(8, 25), now + 70, 'normal', {});
    });
  }

  onSlackerSpotted(bossId: string, victimId: string): void {
    this.guard('onSlackerSpotted', () => this.handleSlacker(bossId, victimId));
  }

  onAgentArrived(id: string, late: boolean): void {
    this.guard('onAgentArrived', () => this.handleArrival(id, late));
  }

  publicScenes(): PublicScene[] {
    try {
      return [this.office, this.online]
        .filter((s): s is Scene => !!s && s.started && !s.ended)
        .map((s) => this.pub(s, 'start'));
    } catch {
      return [];
    }
  }

  recaps(): DayRecap[] {
    return [...this.recapList];
  }

  /** Số liệu đếm (chỉ đọc) — cho test headless / debug, không thuộc DirectorApi */
  stats(): Record<string, number> {
    return {
      ...this.counters,
      queue: this.queue.length,
      timers: this.timers.length,
      vacancies: this.vacancies.length,
      summaries: this.summaries.length,
      dayEvents: this.dayEvents.length,
      rumors: this.book.all().length,
      recaps: this.recapList.length,
      // v3
      ...this.v3,
      ...Object.fromEntries(Object.entries(this.story.stats()).map(([k, v]) => [`story_${k}`, v])),
      hrReviewsLedger: this.ledger.reviews,
      newsUsed: this.newsUsed.length,
      newsDiscussed: this.discussedNews.length,
      driftPlans: this.driftPlans.length,
    };
  }

  rumors(): Rumor[] {
    return [...this.book.all()];
  }

  /** v3: tin thời sự văn phòng đã bàn gần đây (mới nhất cuối) — World có thể dùng cho hello.news khi module tin không có recent() */
  recentNews(n = 5): NewsRef[] {
    return this.discussedNews.slice(-Math.max(1, n)).map((x) => ({ ...x }));
  }

  /** v3: sổ mạch truyện (chỉ đọc) — test / trang lịch sử */
  arcs(): Arc[] {
    return this.story.allArcs().map((a) => ({ ...a }));
  }

  /** v3: sổ HR (bản sao, chỉ đọc) */
  hrLedger(): HrLedger {
    return JSON.parse(JSON.stringify(this.ledger)) as HrLedger;
  }

  // ================================================================ thời gian & tiện ích
  private now(): number {
    return fin(this.world.time(), 0);
  }

  /**
   * Đổi N giây THẬT sang phút game theo tốc độ hiện tại (compressed: gameMinutesPerSecond × speed; realtime: 60 s = 1 phút).
   * Dùng cho các cửa sổ chờ phải đủ dài về thời gian thật dù người xem đang tua x5 / x10.
   */
  private realSecToGameMin(sec: number): number {
    if (this.cfg.timeMode === 'realtime') return sec / 60;
    return sec * Math.max(0.01, fin(this.cfg.gameMinutesPerSecond, 0.5)) * Math.max(1, fin(this.world.speed(), 1));
  }

  /** phút game tuyệt đối của (ngày, phút trong ngày) — tính tương đối so với ngày hiện tại của World */
  private absFor(day: number, minute: number): number {
    const w = this.world;
    return fin(w.time()) - fin(w.minuteOfDay()) + (day - w.day()) * 1440 + minute;
  }

  /** realtime: nhịp chậm hơn (1 phút game = 1 phút thật) */
  private pace(): number {
    return this.cfg.timeMode === 'realtime' ? 2.5 : 1;
  }

  private productMinMs(): number {
    return Math.max(0, fin(this.cfg.productMentionMinMinutes, 8)) * 60_000;
  }

  /** chế độ GPT mà không ai xem / hết ngân sách → cảnh thường chắc chắn bị Brain từ chối, khỏi hỏi */
  private llmGated(): boolean {
    try {
      if (this.brain.mode() !== 'llm') return false;
      if (this.cfg.llmOnlyWhenWatched && this.world.viewers() === 0) return true;
      const u = this.brain.usage();
      return fin(u.costTodayUsd) >= fin(u.budgetUsd, Infinity);
    } catch {
      return false;
    }
  }

  private guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.err(where, e);
    }
  }

  private err(where: string, e: unknown): void {
    const nowMs = Date.now();
    if (nowMs - this.errAt < 10_000) {
      this.errSuppressed++;
      return;
    }
    const msg = e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e);
    console.warn(`[director] lỗi ở ${where}: ${msg}${this.errSuppressed ? ` (+${this.errSuppressed} lỗi khác đã ẩn)` : ''}`);
    this.errAt = nowMs;
    this.errSuppressed = 0;
  }

  // ================================================================ lịch trong ngày
  private ensureDayPlanned(): void {
    const d = this.world.day();
    if (Number.isFinite(d) && d >= 1 && this.plannedDay !== d) this.planDay(d);
  }

  private planDay(day: number): void {
    if (this.plannedDay === day) return;
    // v5: ngày văn phòng không ai làm (cuối tuần ở TIME_MODE=realtime, ngày server tắt bị bỏ qua) không tính vào tuổi
    // mạch truyện — không thì tình huống mở chiều thứ Sáu bị expire() bỏ dở sáng thứ Hai sau khi đã có hậu quả.
    // Chạy trước resetDay (resetDay xoá daySawPresence của ngày vừa qua).
    if (this.plannedDay >= 1 && day > this.plannedDay) {
      const idle = (day - this.plannedDay - 1) + (this.daySawPresence ? 0 : 1);
      if (idle > 0) this.story.holdAges(idle);
    }
    this.plannedDay = day;
    this.resetDay(day);
    const now = this.now();
    const at = (m: number) => this.absFor(day, m);
    const add = (type: SceneType, m: number, window: number, prio: Priority, data: QData = {}) => {
      const a = at(m);
      if (a + window > now) this.enqueue(type, Math.max(a, now), a + window, prio, data);
    };
    add('standup', 570, 60, 'normal');
    add('lunch', 725, 40, 'normal');
    if (chance(0.55)) add('company_chat', randInt(515, 560), 50, 'low', { reason: 'morning' });
    for (let t = randInt(610, 690); t < 1000; t += randInt(120, 180)) add('boss_call', t, 60, 'normal');
    if (chance(0.35)) add('group_chat', randInt(675, 705), 25, 'low', { reason: 'lunch_plan' });
    if (chance(0.5)) add('group_chat', randInt(1020, 1050), 30, 'low', { reason: 'end_of_day' });
    if (chance(0.3)) add('company_chat', randInt(840, 960), 60, 'low', { reason: chance(0.5) ? 'kpi_push' : 'announce' });
    if (deadlineDaysLeft(this.world) <= 1 && chance(0.5)) {
      add('group_chat', randInt(600, 960), 60, 'low', { reason: 'deadline', note: cut(this.world.company()?.project?.name, 40) });
    }
    // v2: ~2–3 giờ game một lần mời marketing (Trâm) + 1–2 người qua phòng trưng bày (cap 30 phút thật xét lúc diễn)
    if (showroomAvailable()) {
      for (let t = randInt(560, 640); t < 1010; t += randInt(120, 180)) {
        if (t >= 705 && t <= 790) continue; // tránh giờ ăn trưa
        add('showroom_chat', t, 45, 'normal', { reason: 'nudge' });
      }
    }
    // sự kiện ngẫu nhiên trong ngày
    const ev = (m: number, event: DevEventName) => {
      const a = at(m);
      if (a > now) this.addTimer({ kind: 'event', at: a, event });
    };
    if (chance(0.25)) ev(randInt(570, 990), 'server_down');
    if (chance(0.15)) ev(randInt(560, 1000), 'wifi_down');
    if (day - this.lastBirthdayDay >= 4 || (day - this.lastBirthdayDay >= 3 && chance(0.35))) {
      this.lastBirthdayDay = day;
      ev(randInt(915, 990), 'birthday');
    }
    if (day % 20 === 0) ev(900, 'payday');
    if (!this.inSlump()) this.ensureInterviews(at(585)); // kỳ doanh thu kém: không tuyển (sweep mở lại khi khá lên)
    // ---- v3: họp xét nhân sự định kỳ (10:30), cửa sổ thời sự, sự kiện cá nhân, lịch AI biên kịch, xin nghỉ / xin tăng lương
    if (day % this.hrReviewEveryDays === 0 && day >= 2 && !this.queued('hr_review') && this.ledger.lastReviewDay !== day) {
      add('hr_review', randInt(625, 640), 150, 'high', { note: '' });
    }
    if (this.newsEnabled) {
      for (let t = randInt(545, 600); t < 1020; t += randInt(75, 110)) {
        if (t >= 715 && t <= 790) continue; // tránh giờ ăn trưa
        add('news_chat', t, 40, 'normal', {});
      }
    }
    if (chance(0.35)) {
      const a = at(randInt(500, 560));
      if (a > now) this.addTimer({ kind: 'personal', at: a });
    }
    // v4: khoảng 1/2 số ngày có một "vụ mua sắm" (bốc thăm quà, thi góc làm việc, tổng vệ sinh…) — chọn vụ lúc bắt đầu
    // vụ mua sắm cũ quá hạn mà chưa kết (qua đêm / khôi phục / đổi chế độ giờ) → bỏ, không chặn vụ hôm nay, không "khui quà" sáng hôm sau
    if (this.theme && this.theme.until <= now) this.theme = null;
    if (!this.theme && day !== this.lastThemeDay && chance(0.5)) {
      const a = at(randInt(560, 840));
      if (a > now) this.addTimer({ kind: 'theme', at: a });
    }
    if (this.showrunnerEnabled) {
      const np = this.story.nextPlan();
      if (np < at(0) || np > at(1439)) this.story.schedule(at(randInt(550, 590)), 0);
    }
    this.planStoryScenes(day, at);
  }

  private resetDay(day: number): void {
    this.dayEvents = [];
    this.notable = [];
    this.firedToday = [];
    this.hiredToday = [];
    this.lateToday = {};
    this.actCounts = {};
    this.daySawPresence = false;
    this.birthdayToday = null;
    this.boost = null;
    this.nudge = null;
    this.bossAwayMin = 0;
    this.bossLeftAt = null;
    this.bossStrictUntil = 0;
    this.clapsToday = 0;
    this.companyToday = new Set();
    this.calledToday = new Set();
    this.deliveriesToday = 0;
    for (const [id, g] of this.departed) if (day - g.day > 3) this.departed.delete(id);
    for (const id of Object.keys(this.lateDays)) {
      this.lateDays[id] = this.lateDays[id].filter((d) => day - d < 7);
      if (!this.lateDays[id].length) delete this.lateDays[id];
    }
  }

  private enqueue(type: SceneType, at: number, until: number, prio: Priority, data: QData): QItem | null {
    if (!Number.isFinite(at) || !Number.isFinite(until) || until < this.now()) return null;
    if (this.queue.length >= QUEUE_MAX) {
      const worst = [...this.queue].sort((a, b) => PRIO_RANK[b.prio] - PRIO_RANK[a.prio] || b.at - a.at)[0];
      if (!worst || PRIO_RANK[worst.prio] < PRIO_RANK[prio]) return null;
      this.removeQ(worst);
    }
    const q: QItem = { id: `q${++this.seq}`, type, at, until: Math.max(until, at + 1), prio, data, tries: 0 };
    this.queue.push(q);
    return q;
  }

  /**
   * v3: cảnh thi hành quyết định nhân sự (cho nghỉ / cắt giảm / thăng chức) hết hạn chờ → xếp lại sáng mai (≤ DEFER_MAX_RETRIES lần),
   * có log "hoãn" cho người xem; hết lượt hoặc người đã rời công ty → log "huỷ" + archive, không để quyết định biến mất lặng lẽ.
   * Sổ (lastFireDay / lastPromotionDay) chỉ ghi khi cảnh diễn xong nên hoãn không "ăn" cap của ngày.
   */
  private deferDecisionScene(q: QItem, why: string): boolean {
    if (!DEFERRABLE_TYPES.includes(q.type) || !q.data.targetId) return false;
    const w = this.world;
    const t = w.agent(q.data.targetId);
    const name = t?.name ?? q.data.targetId;
    const label = DEFER_LABEL[q.type] ?? q.type;
    const retries = (q.data.retries ?? 0) + 1;
    if (!hrEligible(t) || retries > DEFER_MAX_RETRIES) {
      this.v3.decisionsCancelled++;
      this.logEvent('⚖️', `Quyết định ${label} ${name} bị huỷ: ${hrEligible(t) ? 'hoãn quá nhiều lần' : 'người này không còn ở công ty'}`, 'hr', true);
      this.archive('hr', `⚖️ huỷ ${label} ${name}`, { id: q.data.targetId, action: q.type === 'firing' ? 'fire' : q.type === 'layoff' ? 'layoff' : 'promote', cancelled: true, why });
      return false;
    }
    const at = this.absFor(w.day() + 1, randInt(560, 620));
    const data: QData = { ...q.data, retries };
    if (!this.enqueue(q.type, at, at + 180, 'high', data)) return false;
    this.v3.decisionsDeferred++;
    this.logEvent('⏸️', `Hoãn ${label} ${name} sang sáng mai: ${why}`, 'hr', true);
    this.archive('hr', `⏸️ hoãn ${label} ${name} sang ngày ${w.day() + 1}`, { id: q.data.targetId, deferred: true, why });
    return true;
  }

  private removeQ(q: QItem): void {
    const i = this.queue.indexOf(q);
    if (i >= 0) this.queue.splice(i, 1);
    this.candJobs.delete(q.id);
  }

  private queued(type: SceneType, pred: (q: QItem) => boolean = () => true): boolean {
    return this.queue.some((q) => q.type === type && pred(q));
  }

  private addTimer(t: Omit<Timer, 'id'>): void {
    this.timers.push({ ...t, id: `t${++this.seq}` });
  }

  private runTimers(): void {
    if (!this.timers.length) return;
    const now = this.now();
    const due = this.timers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) {
      try {
        if (t.kind === 'clear_incident') this.clearIncident(t.incident);
        else if (t.kind === 'personal') {
          if (now - t.at < 60) this.personalEvent(t.agentId);
        } else if (t.kind === 'theme') {
          if (now - t.at < 90 && !this.theme) this.startTheme(themeByKey(t.themeKey));
        } else if (t.kind === 'theme_end') {
          this.endTheme(t.themeKey);
        } else if (t.kind === 'delivery') {
          this.deliver(t);
        } else if (t.event && now - t.at < 60 && this.world.activeAgents().length >= 2) {
          this.handleEvent(t.event, t.agentId ? { agentId: t.agentId } : undefined, true);
        }
      } catch (e) {
        this.err('timer', e);
      }
    }
  }

  // ================================================================ hàng đợi (cảnh lên lịch / ưu tiên cao)
  private processQueue(): void {
    if (!this.queue.length) return;
    const now = this.now();
    const expired = this.queue.filter((q) => q.until < now);
    if (expired.length) {
      this.queue = this.queue.filter((q) => q.until >= now);
      for (const q of expired) {
        this.candJobs.delete(q.id);
        if (q.type === 'boss_catch') this.catchFallback(q.data.targetId, q.data.label);
        else this.deferDecisionScene(q, 'người này vắng mặt hoặc bận suốt cửa sổ chờ');
      }
    }
    for (const q of this.queue) if (q.type === 'interview' && q.at - now <= 25) this.startCandidateJob(q);
    const due = this.queue
      .filter((q) => q.at <= now && (q.nextTry ?? 0) <= this.clockMs)
      .sort((a, b) => PRIO_RANK[a.prio] - PRIO_RANK[b.prio] || a.at - b.at);
    for (const q of due) {
      if (!this.queue.includes(q)) continue;
      let office = SCENE_DEFS[q.type].channel === 'office';
      if (q.type === 'news_chat') {
        // v3: bàn tin ở pantry/góc chill khi slot văn phòng rảnh, không thì ném vào nhóm chat kín
        if (!this.office) office = true;
        else if (!this.online) office = false;
        else continue;
        q.data.channel = office ? 'office' : 'group';
      }
      if (office ? this.office : this.online) continue;
      if (office && this.clockMs - this.lastOfficeEnd < (q.prio === 'high' ? 1000 : OFFICE_GAP_MS)) continue;
      if (q.prio !== 'high' && this.llmGated()) {
        q.nextTry = this.clockMs + 10_000;
        continue;
      }
      let outcome: 'done' | 'wait' | 'drop' | 'denied';
      try {
        outcome = q.type === 'interview' ? this.tryInterview(q) : this.tryQueued(q);
      } catch (e) {
        this.err(`queue:${q.type}`, e);
        outcome = q.tries++ >= 3 ? 'drop' : 'wait';
      }
      if (outcome === 'drop' && q.type === 'boss_catch') this.catchFallback(q.data.targetId, q.data.label);
      if (outcome === 'done' || outcome === 'drop') this.removeQ(q);
      else q.nextTry = this.clockMs + (outcome === 'denied' ? 4000 : 2500);
    }
  }

  private tryQueued(q: QItem): 'done' | 'wait' | 'drop' | 'denied' {
    const d = this.draftFromQueue(q);
    if (d === 'drop') return 'drop';
    if (!d) return 'wait';
    const via = this.brain.reserve(q.prio);
    if (!via) return 'denied';
    if (this.launch(d, via, q.prio)) return 'done';
    q.tries++;
    return q.tries >= 6 ? 'drop' : 'wait';
  }

  private draftFromQueue(q: QItem): Draft | null | 'drop' {
    const w = this.world;
    const d = q.data;
    const target = d.targetId ? w.agent(d.targetId) : undefined;
    switch (q.type) {
      case 'standup': return this.dStandup(d.variant === 'pitch' ? 'pitch' : undefined);
      case 'lunch': return this.dLunch();
      case 'boss_call': return this.dBossCall(asBossCallReason(d.reason), d.targetId, d.note);
      case 'hr_warning': return hrEligible(target) ? this.dHrWarning(target, d.retries) : 'drop';
      case 'firing': return hrEligible(target) ? this.dFiring(target, d.retries) : 'drop';
      // ---- v3
      case 'news_chat': return this.dNews(q);
      case 'hr_review': return this.dHrReview(d.note, d.force === '1', d.retries);
      case 'resign_talk': return hrEligible(target) ? this.dResignTalk(target, d.hint, d.retries) : 'drop';
      case 'raise_request': return hrEligible(target) ? this.dRaiseRequest(target, d.retries) : 'drop';
      case 'promotion': return hrEligible(target) ? this.dPromotion(target, d.newLabel, d.retries) : 'drop';
      case 'layoff': return hrEligible(target) ? this.dLayoff(target, d.retries) : 'drop';
      // ---- v5
      case 'crisis_meeting': return this.dCrisisMeeting(q);
      case 'pep_talk': return this.dPepTalk(q);
      case 'incident':
        // server đã chạy lại trước khi cảnh kịp diễn → bỏ (đừng hô "sập rồi" khi mọi thứ đã ổn)
        if (d.reason !== 'bug_prod' && w.company()?.incident !== 'server_down') return 'drop';
        return this.dIncident(d.reason === 'bug_prod' ? 'bug_prod' : 'server_down', d.note);
      case 'celebration': return this.dCelebration(asCelebration(d.reason), d.centerId, d.note);
      case 'confront': return this.dConfront(d.rumorId);
      case 'welcome':
        if (!target || target.status !== 'active') return 'drop';
        return this.dWelcome(target, d.note);
      case 'group_chat': return this.dGroup(asGroupReason(d.reason), { name: d.name, label: d.label, note: d.note, id: d.aboutId }, {
        must: d.targetId ? [d.targetId] : [],
        exclude: [...(d.reason === 'birthday' && d.centerId ? [d.centerId] : []), ...splitIds(d.exclude)],
      });
      case 'company_chat': return this.dCompany(asCompanyReason(d.reason), { name: d.name, note: d.note }, [d.targetId, d.centerId].filter((x): x is string => !!x));
      case 'desk_visit': {
        if ((d.initiatorId && !w.agent(d.initiatorId)) || (d.targetId && !w.agent(d.targetId))) return 'drop';
        const p = pickDeskVisit(w, (a) => this.free(a, 'normal'), { initiatorId: d.initiatorId, targetId: d.targetId, motiveKey: d.motiveKey });
        if (!p) return null;
        const draft = this.dDeskVisit(p, d.why, asTone(d.tone));
        if (d.productId) this.attachProduct(draft, d.productId, asProductMode(d.productMode), d.productAngle, p.initiator, p.target);
        return draft;
      }
      case 'gossip': {
        if (d.aboutId && d.note) return this.dGossipSeeded(d.aboutId, d.note, splitIds(d.exclude));
        const gp = pickGossipPair(w, (a) => this.free(a, 'normal'));
        return this.dGossip(gp, true);
      }
      case 'pantry_chat': {
        const co = findCoLocated(w, (a) => this.free(a, 'normal'));
        return co ? this.dPantry(co) : null;
      }
      case 'pingpong_match': {
        const pp = findPingpongPair(w, (a) => this.free(a, 'normal'));
        return pp ? this.dPingpong(pp) : null;
      }
      case 'showroom_chat': return this.dShowroomQueued();
      case 'boss_catch': {
        const boss = w.boss();
        if (!boss || !target || target.status !== 'active' || !target.present || !boss.present || w.bossAway()) return 'drop';
        if (!this.free(boss, 'high') || !this.free(target, 'high')) return null; // chờ cả hai rảnh
        return this.dBossCatch(boss, target, d.label);
      }
      default: return 'drop'; // interview không đi đường này
    }
  }

  // ---------------------------------------------------------------- phỏng vấn: sinh ứng viên trước, rồi mời vào
  private tryInterview(q: QItem): 'done' | 'wait' | 'drop' | 'denied' {
    const w = this.world;
    const v = this.vacancies.find((x) => x.role === q.data.role);
    if (!v) return 'drop';
    if (!v.extra && w.agents().some((a) => a.role === v.role && a.status === 'active')) {
      this.vacancies = this.vacancies.filter((x) => x !== v);
      return 'drop';
    }
    const hr = w.hr();
    if (!hr || hr.status !== 'active' || !this.free(hr, 'high')) return 'wait';
    if (!q.data.candidate) {
      this.startCandidateJob(q);
      return 'wait';
    }
    const via = this.brain.reserve('high');
    if (!via) return 'denied';
    let cand: AgentState | undefined;
    try {
      cand = w.addAgent(this.uniquePersona(q.data.candidate, v), 'candidate', { ...(SPOTS.entrance?.[0] ?? { x: 1, y: 16 }) });
    } catch (e) {
      this.err('addAgent', e);
    }
    if (!cand) {
      q.data.candidate = undefined;
      q.tries++;
      return q.tries >= 4 ? 'drop' : 'wait';
    }
    this.rememberName(cand.name);
    const d = this.dInterview(cand, v, hr);
    const s = d ? this.launch(d, via, 'high') : null;
    if (!s) {
      this.dismissCandidate(cand.id);
      q.data.candidate = undefined;
      q.tries++;
      return q.tries >= 4 ? 'drop' : 'wait';
    }
    this.logEvent('🧑‍💼', `Ứng viên ${cand.name} tới phỏng vấn vị trí ${v.roleLabel}`, 'hr', false);
    return 'done';
  }

  private startCandidateJob(q: QItem): void {
    if (q.data.candidate) return;
    const started = this.candJobs.get(q.id);
    if (started !== undefined && this.clockMs - started < CANDIDATE_TIMEOUT_MS) return;
    const v = this.vacancies.find((x) => x.role === q.data.role);
    if (!v) return;
    this.candJobs.set(q.id, this.clockMs);
    const token = q.id;
    const req = candidateRequest(v, this.world, this.usedNames);
    const ctx = this.ctx();
    Promise.resolve()
      .then(() => this.brain.generateCandidate(req, ctx))
      .then((p) => {
        this.candJobs.delete(token);
        const item = this.queue.find((x) => x.id === token);
        if (!item || item.data.candidate) return; // đã huỷ / đã có
        if (p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim()) {
          item.data.candidate = p;
        }
      })
      .catch((e) => {
        this.candJobs.delete(token);
        this.err('generateCandidate', e);
      });
  }

  private uniquePersona(p: Persona, v: Vacancy): Persona {
    let id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `cand_${v.role}_${this.world.day()}_${randInt(1000, 9999)}`;
    while (this.world.agent(id)) id = `${id}_${randInt(10, 99)}`;
    return { ...p, id, role: v.role, roleLabel: v.roleLabel, deskId: v.deskId || p.deskId, kpiTarget: v.kpiTarget || p.kpiTarget };
  }

  private rememberName(name: string): void {
    if (!name) return;
    this.usedNames = [...this.usedNames.filter((n) => n !== name), name].slice(-100);
  }

  /** mỗi vị trí trống luôn có 1 lịch phỏng vấn */
  private ensureInterviews(preferAt?: number): void {
    const w = this.world;
    const min = w.minuteOfDay();
    for (const v of this.vacancies) {
      if (this.queued('interview', (q) => q.data.role === v.role)) continue;
      if (this.office?.type === 'interview' && this.office.meta.vacancyRole === v.role) continue;
      let at: number;
      if (preferAt !== undefined && preferAt + 120 > this.now()) at = Math.max(preferAt, this.now());
      else if (min >= 480 && min < 960) at = this.now() + rand(20, 45);
      else at = this.absFor(w.day() + (min >= 480 ? 1 : 0), 585);
      this.enqueue('interview', at, at + 240, 'high', { role: v.role });
    }
  }

  private dismissCandidate(id: string): void {
    const a = this.world.agent(id);
    if (!a || a.status !== 'candidate' || this.dismissed.has(id)) return;
    this.dismissed.add(id);
    a.sceneId = null;
    a.onPhone = false;
    try {
      this.world.dismissCandidate(id);
    } catch (e) {
      this.err('dismissCandidate', e);
    }
  }

  // ================================================================ cảnh tự phát
  private spontaneous(): void {
    const w = this.world;
    const min = w.minuteOfDay();
    if (min < OFFICE_HOURS.from || min > OFFICE_HOURS.to) return;
    if (this.llmGated()) return;
    const pace = this.pace();
    const officeOpen = !this.office && this.clockMs - this.lastOfficeEnd >= OFFICE_GAP_MS * pace;
    const onlineOpen = !this.online && this.clockMs - this.lastOnlineEnd >= this.onlineGapMs * pace;
    if (!officeOpen && !onlineOpen) return;
    const cands: { w: number; prio: Priority; build: () => Draft | null }[] = [];
    const freeLow = (a: AgentState) => this.free(a, 'low');
    if (officeOpen) {
      // khoảnh khắc "tình cờ" (đứng cùng chỗ, đang đánh bóng bàn) qua rất nhanh → được ưu tiên hơn ghé bàn
      const co = findCoLocated(w, freeLow);
      if (co) cands.push({ w: 3, prio: 'low', build: () => this.dPantry(co) });
      const pp = findPingpongPair(w, freeLow);
      if (pp) cands.push({ w: 2.5, prio: 'low', build: () => this.dPingpong(pp) });
      // v2: ≥ 2 người đang đứng ở phòng trưng bày (cap riêng: 1 cảnh / 30 phút thật)
      const sg = this.showroomReady() ? findShowroomGroup(w, (a) => this.free(a, 'low', { nudged: true })) : null;
      if (sg) cands.push({ w: 3, prio: 'low', build: () => this.dShowroom(sg, this.nudgedIn(sg)) });
      const fleeting = !!co || !!pp || !!sg;
      const dv = pickDeskVisit(w, freeLow);
      if (dv) cands.push({ w: fleeting ? 1 : 2, prio: 'low', build: () => this.dDeskVisit(dv) });
      const gp = pickGossipPair(w, freeLow);
      if (gp) cands.push({ w: 1.5 * clamp(fin(gp.a.traits?.gossip, 0.4), 0.15, 1) * 1.3, prio: 'low', build: () => this.dGossip(gp) });
      const cf = this.confrontPick();
      if (cf) cands.push({ w: 2, prio: 'normal', build: () => this.dConfront(cf.rumor.id) });
      // nghỉ một nhịp cho tự nhiên (văn phòng im lâu thì thôi)
      const quiet = this.clockMs - this.lastOfficeEnd;
      if (quiet < 20_000 * pace && !fleeting) cands.push({ w: 1, prio: 'low', build: () => null });
    }
    if (onlineOpen) {
      const boosted = !!this.boost && this.boost.until > this.now();
      cands.push({ w: boosted ? 3 : 1, prio: boosted ? 'normal' : 'low', build: () => this.dGroupSpont() });
      cands.push({ w: 0.3, prio: 'low', build: () => this.dCompanySpont() });
    }
    const c = weightedPick(cands, (x) => x.w);
    if (!c) return;
    const d = c.build();
    if (!d) return;
    const via = this.brain.reserve(c.prio);
    if (!via) {
      this.nextCheckAt = this.clockMs + 5000;
      return;
    }
    this.launch(d, via, c.prio);
  }

  // ================================================================ vòng đời cảnh
  /**
   * rảnh để vào cảnh: có mặt, không ẩn trong WC, không trong cảnh, không bận nhắn tin; cảnh 'low' còn cần hết cooldown.
   * nudged = cảnh showroom đang hỏi (người được mời qua phòng trưng bày chỉ dành cho cảnh đó, trừ cảnh 'high').
   */
  private free(a: AgentState | undefined, prio: Priority, opts: { allowAbsent?: boolean; nudged?: boolean } = {}): boolean {
    if (!a || a.status !== 'active' || a.sceneId || a.onPhone) return false;
    if (a.hidden) return false; // đang trong WC (client không vẽ) → không vào cảnh nào
    if (!opts.allowAbsent) {
      if (!a.present || BUSY_ALWAYS.includes(a.activity)) return false;
      if (prio === 'low' && a.activity === 'arriving') return false;
    }
    if (prio !== 'high' && !opts.nudged && this.nudge && this.nudge.ids.includes(a.id) && this.now() <= this.nudge.until) return false;
    if (prio === 'low') {
      const last = this.agentLast.get(a.id);
      if (last !== undefined && this.clockMs - last < AGENT_COOLDOWN_MS * this.pace()) return false;
    }
    return true;
  }

  private safeRelease(id: string): void {
    try {
      this.world.releaseSpot(id);
    } catch (e) {
      this.err('releaseSpot', e);
    }
  }

  private launch(d: Draft, via: 'llm' | 'offline', prio: Priority): Scene | null {
    const w = this.world;
    const def = SCENE_DEFS[d.type];
    const channel = d.channel ?? def.channel;
    const isOffice = channel === 'office';
    if (isOffice ? this.office : this.online) return null;
    let ids = [...new Set(d.participants)];
    if (!ids.length || ids.length !== d.participants.length) return null;
    if (ids.some((id) => { const a = w.agent(id); return !a || !!a.sceneId; })) return null;

    const targets: Record<string, Pt | null> = {};
    const reserved: string[] = [];
    const rollback = () => { for (const id of reserved) this.safeRelease(id); };
    let label = d.locationLabel;
    if (isOffice) {
      // 1) giữ chỗ chung cho nhóm (thử lần lượt từng khu)
      if (d.joint && d.joint.ids.length) {
        let ok = false;
        for (const g of d.joint.groups) {
          const got: string[] = [];
          for (const id of d.joint.ids) {
            const p = w.reserveSpot(id, g);
            if (!p) break;
            got.push(id);
            targets[id] = p;
          }
          if (got.length === d.joint.ids.length) {
            reserved.push(...got);
            label = SPOT_LABELS[g] ?? label;
            ok = true;
            break;
          }
          for (const id of got) {
            this.safeRelease(id);
            delete targets[id];
          }
        }
        if (!ok) return null;
      }
      // 2) chỗ riêng từng người
      const dropped: string[] = [];
      for (const id of ids) {
        if (id in targets) continue;
        const pl: Placement = d.place?.[id] ?? { how: 'stay' };
        if (pl.how === 'spot') {
          const held = spotPos(w.agent(id)?.spotKey, pl.group);
          if (held) {
            targets[id] = held;
            continue;
          }
          const p = w.reserveSpot(id, pl.group);
          if (p) {
            targets[id] = p;
            reserved.push(id);
          } else if (pl.orStay) targets[id] = null;
          else if (pl.optional) dropped.push(id);
          else {
            rollback();
            return null;
          }
        } else if (pl.how === 'seat') targets[id] = w.deskSeat(id);
        else if (pl.how === 'stay') targets[id] = null;
        // 'visit' tính lúc giao quyền (visitorSpot tránh ô người khác đang nhắm tới)
      }
      if (dropped.length) ids = ids.filter((id) => !dropped.includes(id));
    }
    const minPeople = Math.min(d.minPeople ?? (channel === 'group' ? 3 : 2), d.participants.length);
    if (ids.length < minPeople) {
      rollback();
      return null;
    }
    const people = ids.map((id) => w.agent(id)!);
    const rumor = d.rumor && ids.includes(d.rumor.tellerId) ? d.rumor : undefined;

    // 3) tình huống + yêu cầu cho Brain
    let sit: Situation;
    try {
      sit = d.sit(people, label);
    } catch (e) {
      rollback();
      this.err(`sit:${d.type}`, e);
      return null;
    }
    const sid = `sc${w.day()}_${++this.seq}`;
    const offer: ProductOffer | null = d.product
      ? {
        product: d.product, angle: d.productAngle ?? '', hook: d.productHook, speaker: d.productSpeaker, angleKey: d.productAngleKey,
        mode: d.productMode ?? (d.type === 'showroom_chat' ? 'showroom' : 'mention'), buys: d.productBuys ?? 0,
      }
      : d.productFor ? this.offerProduct(d.type, people, d.productFor.initiatorId) : null;
    const product = offer?.product ?? null;
    // v3: 1/3 số lần tám chuyện / ăn trưa có một tin thật len vào — đi đường thẻ tin (req.news) để prompt có LUẬT TIN THẬT,
    // sanitize có lưới an toàn, người xem thấy thẻ tin + nguồn; cũng theo nhịp NEWS_SCENE_MIN_MINUTES (nửa nhịp sau news_chat)
    if (!d.news && (d.type === 'pantry_chat' || d.type === 'lunch') && this.newsEnabled && chance(1 / 3)
      && this.clockMs - this.lastNewsAt >= this.newsMinMsVal / 2 && this.clockMs - this.lastNewsHintAt >= this.newsMinMsVal) {
      const n = this.peekNews(this.newsCats());
      if (n) {
        d.news = n;
        this.lastNewsHintAt = this.clockMs;
        this.v3.newsHints++;
      }
    }
    const topic = d.news ? undefined : this.topicFor(d, people);
    const req: SceneRequest = {
      sceneId: sid,
      type: d.type,
      channel,
      locationLabel: label,
      situation: sit.situation,
      participants: ids,
      minLines: def.minLines,
      maxLines: def.maxLines,
      allowedEffects: [...def.effects],
      priority: prio,
    };
    if (topic) req.topicHint = topic;
    if (d.aboutId) req.aboutId = d.aboutId;
    if (sit.extra.length) req.extra = sit.extra.slice(0, 6);
    if (rumor) req.rumor = { id: rumor.id, aboutId: rumor.aboutId, currentText: rumor.currentText, isNew: rumor.isNew };
    if (d.news) req.news = d.news;
    if (d.hrDossier) req.hrDossier = d.hrDossier;
    if (d.crisis) req.crisis = { ...d.crisis, centerId: d.crisis.centerId && ids.includes(d.crisis.centerId) ? d.crisis.centerId : undefined };
    if (product && offer) {
      const marketer = people.find((p) => p.role === 'marketing');
      const speaker = offer.speaker && ids.includes(offer.speaker) ? offer.speaker
        : d.productSpeaker && ids.includes(d.productSpeaker) ? d.productSpeaker : marketer?.id ?? d.productFor?.initiatorId;
      req.product = {
        id: product.id, name: product.name, pitch: d.productPitch ?? product.pitch, preferSpeaker: speaker,
        short: shortNameOf(product), mode: offer.mode,
        ...(product.spoken ? { spoken: product.spoken } : {}),
        ...(product.facts ? { facts: product.facts } : {}),
        ...(product.avoid ? { avoid: product.avoid } : {}),
        ...(offer.angle ? { angle: offer.angle } : {}),
        ...(offer.hook ? { hook: offer.hook } : {}),
        ...(priceFeelOf(product) ? { priceFeel: priceFeelOf(product) } : {}),
      };
    }
    const scene: Scene = {
      id: sid, type: d.type, def, channel, prio,
      title: d.title ?? def.title, icon: d.icon ?? def.icon,
      participants: ids, aboutId: d.aboutId, locationLabel: label, targets, req, via,
      phase: 'gathering', createdAt: this.clockMs, startedAt: 0, result: null, failed: false,
      lineIdx: 0, nextAt: 0, started: false, ended: false, teleported: false,
      product, productShown: false, offer,
      rumor: rumor ? { id: rumor.id, aboutId: rumor.aboutId, isNew: rumor.isNew, tellerId: rumor.tellerId } : undefined,
      meta: d.meta ?? {}, allowAbsent: new Set(d.allowAbsent ?? []),
      news: d.news ? newsRefOf(d.news) : undefined,
    };

    // 4) giao quyền điều khiển cho Director
    if (isOffice) this.office = scene;
    else this.online = scene;
    if (d.type === 'company_chat' && COMPANY_REASONS.includes(d.meta?.reason as CompanyReason)) {
      this.companyToday.add(d.meta!.reason as CompanyReason);
    }
    if (d.type === 'boss_call' && d.meta?.targetId) this.calledToday.add(d.meta.targetId);
    for (const a of people) {
      a.sceneId = sid;
      if (isOffice) {
        const pl = d.place?.[a.id];
        let t = targets[a.id] ?? null;
        if (pl?.how === 'visit') {
          t = w.visitorSpot(pl.hostId);
          targets[a.id] = t;
        }
        const lb = d.labels?.[a.id];
        w.setActivity(a.id, 'scene', 600, { target: t ?? undefined, label: lb?.label ?? def.label, emote: lb?.emote ?? def.emote });
      } else {
        a.onPhone = true;
      }
    }
    if (product) this.productLock = sid;
    if (d.type === 'showroom_chat') {
      this.lastShowroomAt = this.clockMs; // cap tính từ lúc dựng cảnh (kể cả khi cảnh bị huỷ) cho khỏi dồn
      this.counters.showroom++;
      this.nudge = null;
    }
    if (d.news) {
      // mỗi tin chỉ dùng 1 lần (kể cả tin len vào tám chuyện); cap news_chat tính từ lúc dựng cảnh (kể cả khi bị huỷ) để không dồn tin
      this.markNewsUsed(d.news);
      if (d.type === 'news_chat') {
        this.lastNewsAt = this.clockMs;
        this.v3.newsScenes++;
      }
    }

    // 5) Brain viết thoại ngay (song song với lúc đi bộ)
    const ctx = this.ctx();
    let p: Promise<SceneResult>;
    try {
      p = Promise.resolve(this.brain.generateScene(req, ctx, via));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then((res) => {
      if (!this.isLive(scene)) return; // cảnh đã huỷ → bỏ qua
      const clean = this.cleanResult(res, scene);
      if (clean) scene.result = clean;
      else scene.failed = true;
    }).catch((e) => {
      if (this.isLive(scene)) scene.failed = true;
      this.err('generateScene', e);
    });
    return scene;
  }

  private topicFor(d: Draft, people: AgentState[]): string | undefined {
    const def = SCENE_DEFS[d.type];
    // (tin thật len vào tám chuyện đi đường d.news ở buildScene, không còn qua gợi ý chủ đề dạng chữ)
    const cats = d.topicCats ?? (def.topics.length ? topicCatsFor(people, def.topics) : []);
    if (!cats.length) return undefined;
    const t = safeTopic(cats, this.recentTopics);
    if (t) this.recentTopics = [...this.recentTopics, t].slice(-14);
    return t;
  }

  private cleanResult(res: SceneResult | null | undefined, s: Scene): SceneResult | null {
    if (!res || typeof res !== 'object' || !Array.isArray(res.lines)) return null;
    const set = new Set(s.participants);
    const lines = res.lines
      .filter((l) => l && typeof l.speaker === 'string' && set.has(l.speaker) && typeof l.text === 'string' && l.text.trim())
      .slice(0, s.req.maxLines + 2)
      .map((l) => ({
        speaker: l.speaker,
        text: cut(l.text, 240),
        emote: typeof l.emote === 'string' && l.emote.trim() ? l.emote.trim().slice(0, 8) : undefined,
        product: l.product === true,
      }));
    if (!lines.length) return null;
    return {
      lines,
      summary: typeof res.summary === 'string' ? res.summary : '',
      relationshipChanges: arr(res.relationshipChanges),
      moodChanges: arr(res.moodChanges),
      memories: arr(res.memories),
      kpiChanges: arr(res.kpiChanges),
      rumor: res.rumor && typeof res.rumor === 'object' ? res.rumor : null,
      verdict: VERDICTS.includes(res.verdict as Verdict) ? res.verdict : null,
      // v3: quyết định nhân sự (hr_review) — kiểm tra hàng rào lúc thi hành (validateDecisions)
      hrDecisions: Array.isArray(res.hrDecisions) ? res.hrDecisions.slice(0, 12) : res.hrDecisions === null ? null : undefined,
      source: res.source === 'llm' ? 'llm' : 'offline',
    };
  }

  private isLive(s: Scene): boolean {
    return !s.ended && (this.office === s || this.online === s);
  }

  private sceneValid(s: Scene): boolean {
    for (const id of s.participants) {
      const a = this.world.agent(id);
      if (!a || a.sceneId !== s.id) return false;
      if (a.status !== (id === s.meta.candidateId ? 'candidate' : 'active')) return false;
      if (!a.present && !s.allowAbsent.has(id)) return false;
      if (a.hidden) return false; // lỡ "vào WC" giữa cảnh → huỷ cho khỏi nói chuyện với người vô hình
      if (s.channel === 'office' && a.present && BUSY_ALWAYS.includes(a.activity)) return false;
    }
    return true;
  }

  private updateSceneSafe(s: Scene): void {
    try {
      this.updateScene(s);
    } catch (e) {
      this.err(`scene:${s.type}`, e);
      try {
        this.abort(s, 'lỗi');
      } catch (e2) {
        this.err('abort', e2);
        if (this.office === s) this.office = null;
        if (this.online === s) this.online = null;
      }
    }
  }

  private updateScene(s: Scene): void {
    if (s.ended) return;
    if (!this.sceneValid(s)) {
      this.abort(s, 'người tham gia không còn ở đây');
      return;
    }
    const w = this.world;
    const age = this.clockMs - s.createdAt;
    if (s.phase === 'gathering') {
      if (s.failed) return this.abort(s, 'không sinh được thoại');
      if (!s.result && age > RESULT_TIMEOUT_MS) return this.abort(s, 'chờ thoại quá lâu');
      let arrived = true;
      if (s.channel === 'office' && !s.teleported) {
        arrived = s.participants.every((id) => w.isArrived(id));
        if (!arrived && age > GATHER_TELEPORT_MS) {
          s.teleported = true;
          for (const id of s.participants) {
            const t = s.targets[id];
            if (t && !w.isArrived(id)) w.teleport(id, t);
          }
          arrived = true;
        }
      }
      if (arrived && s.result) this.startPlaying(s);
      return;
    }
    if (this.clockMs - s.startedAt > MAX_PLAY_MS) return this.finish(s);
    if (this.clockMs >= s.nextAt) {
      if (!s.result || s.lineIdx >= s.result.lines.length) this.finish(s);
      else this.playLine(s);
    }
  }

  private startPlaying(s: Scene): void {
    s.phase = 'playing';
    s.started = true;
    s.startedAt = this.clockMs;
    s.nextAt = this.clockMs;
    this.world.emit({ t: 'scene', scene: this.pub(s, 'start') });
    const names = s.participants.map((id) => this.world.agent(id)?.name ?? id);
    this.world.log({
      kind: 'scene_start', channel: s.channel, sceneId: s.id, text: `${s.title} · ${listVi(names)} · ${s.locationLabel}`, icon: s.icon,
      ...(s.news ? { news: { ...s.news } } : {}),
    });
    this.playLine(s);
  }

  private playLine(s: Scene): void {
    const w = this.world;
    const res = s.result;
    if (!res) return;
    const line = res.lines[s.lineIdx];
    const a = line ? w.agent(line.speaker) : undefined;
    if (!line || !a) {
      this.abort(s, 'người nói biến mất');
      return;
    }
    if (s.channel === 'office') this.faceFor(s, a.id);
    const speed = clamp(fin(w.speed(), 1), 1, 10);
    let dur = clamp(1600 + 55 * line.text.length, 2200, 7500) / Math.min(speed, 3);
    if (s.channel !== 'office') dur *= 0.8;
    dur = Math.round(dur);
    const next = res.lines[s.lineIdx + 1];
    let product: ReturnType<typeof toPublic> | undefined;
    if (line.product && s.product && !s.productShown) {
      try {
        product = toPublic(s.product, 'scene');
      } catch (e) {
        this.err('toPublic', e);
      }
      if (product) {
        s.productShown = true;
        this.lastProductAt = this.clockMs;
        this.recentProducts = [...this.recentProducts.filter((x) => x !== s.product!.id), s.product.id].slice(-8);
        this.counters.products++;
        this.afterProductLine(s, a.id);
      }
    }
    w.log(
      {
        kind: 'line', channel: s.channel, sceneId: s.id, speaker: a.id, speakerName: a.name, text: line.text,
        ...(line.emote ? { icon: line.emote } : {}),
        ...(product ? { product } : {}),
      },
      next ? { durationMs: dur, nextSpeaker: next.speaker } : { durationMs: dur },
    );
    this.counters.lines++;
    s.lineIdx++;
    s.nextAt = this.clockMs + dur + 300;
  }

  /** người nói quay về phía người nghe, người nghe quay về phía người nói */
  private faceFor(s: Scene, speakerId: string): void {
    const w = this.world;
    const sp = w.agent(speakerId);
    if (!sp) return;
    const others = s.participants.filter((id) => id !== speakerId).map((id) => w.agent(id)).filter((x): x is AgentState => !!x);
    if (!others.length) return;
    const cx = others.reduce((t, o) => t + o.x, 0) / others.length;
    const cy = others.reduce((t, o) => t + o.y, 0) / others.length;
    if (w.isArrived(speakerId)) w.faceToward(speakerId, { x: cx, y: cy });
    for (const o of others) if (w.isArrived(o.id)) w.faceToward(o.id, { x: sp.x, y: sp.y });
  }

  private finish(s: Scene): void {
    if (s.ended) return;
    s.ended = true;
    this.clearSlot(s);
    const res = s.result;
    if (res) {
      try {
        this.applyEffects(s, res);
      } catch (e) {
        this.err('effects', e);
      }
    }
    const names = s.participants.map((id) => this.world.agent(id)?.name ?? id);
    const summary = cut(res?.summary, 200) || `${s.title}: ${listVi(names)}`;
    this.pushSummary(summary);
    this.pushDayEvent(`${s.icon} ${summary}`, false);
    if (s.started) {
      this.world.emit({ t: 'scene', scene: this.pub(s, 'end', summary) });
      this.world.log({ kind: 'scene_end', channel: s.channel, sceneId: s.id, text: summary, icon: s.icon });
    }
    this.release(s);
    this.counters.scenes++;
    try {
      this.onEndHook(s, res);
    } catch (e) {
      this.err(`onEnd:${s.type}`, e);
    }
  }

  private abort(s: Scene, why: string): void {
    if (s.ended) return;
    s.ended = true;
    this.clearSlot(s);
    if (s.started) {
      const summary = `${s.title}: bị gián đoạn`;
      this.world.emit({ t: 'scene', scene: this.pub(s, 'end', summary) });
      this.world.log({ kind: 'scene_end', channel: s.channel, sceneId: s.id, text: summary, icon: s.icon });
    }
    this.release(s);
    this.counters.aborted++;
    try {
      this.onAbortHook(s, why);
    } catch (e) {
      this.err(`onAbort:${s.type}`, e);
    }
  }

  private clearSlot(s: Scene): void {
    if (this.office === s) {
      this.office = null;
      this.lastOfficeEnd = this.clockMs;
    }
    if (this.online === s) {
      this.online = null;
      this.lastOnlineEnd = this.clockMs;
      // ≥ 45 s giữa 2 cảnh online thường; ngẫu nhiên thêm cho đỡ dồn dập (sau sự kiện lớn thì sát hơn)
      const boosted = !!this.boost && this.boost.until > this.now();
      this.onlineGapMs = (boosted ? rand(45, 70) : rand(60, 120)) * 1000;
    }
    if (this.productLock === s.id) this.productLock = null;
  }

  private release(s: Scene): void {
    const w = this.world;
    const nowMs = Date.now();
    for (const id of s.participants) {
      const a = w.agent(id);
      if (!a) continue;
      if (a.sceneId && a.sceneId !== s.id) continue; // đã thuộc cảnh khác
      a.sceneId = null;
      a.onPhone = false;
      a.lastSceneAt = nowMs;
      // nhắn tin nhóm không "chiếm sóng" lâu như nói chuyện trực tiếp → cooldown một nửa
      this.agentLast.set(id, s.channel === 'office' ? this.clockMs : this.clockMs - AGENT_COOLDOWN_MS * this.pace() / 2);
      if (s.channel === 'office' && a.status !== 'fired') {
        this.safeRelease(id);
        try {
          w.setActivity(id, 'idle', 0);
        } catch (e) {
          this.err('release', e);
        }
      }
    }
  }

  private pub(s: Scene, status: 'start' | 'end', summary?: string): PublicScene {
    const p: PublicScene = {
      id: s.id, type: s.type, title: s.title, icon: s.icon, channel: s.channel,
      participants: [...s.participants], locationLabel: s.locationLabel, status,
    };
    if (summary) p.summary = summary;
    if (s.news) p.news = { ...s.news };
    return p;
  }

  // ---------------------------------------------------------------- hiệu ứng cuối cảnh (có kẹp biên)
  private applyEffects(s: Scene, res: SceneResult): void {
    const w = this.world;
    const set = new Set(s.participants);
    const about = s.aboutId && !set.has(s.aboutId) && w.agent(s.aboutId) ? s.aboutId : null;
    const allowed = new Set(s.req.allowedEffects);
    if (allowed.has('relationship')) {
      const agg = new Map<string, { from: string; to: string; delta: number; reason: string }>();
      for (const c of res.relationshipChanges) {
        if (!c || typeof c.from !== 'string' || typeof c.to !== 'string' || c.from === c.to) continue;
        if (!set.has(c.from) || (!set.has(c.to) && c.to !== about)) continue;
        const k = `${c.from}>${c.to}`;
        const cur = agg.get(k) ?? { from: c.from, to: c.to, delta: 0, reason: '' };
        cur.delta += fin(c.delta);
        if (!cur.reason && typeof c.reason === 'string') cur.reason = c.reason;
        agg.set(k, cur);
      }
      const hit = new Map<string, number>();
      for (const c of agg.values()) {
        const d = Math.round(clamp(c.delta, -15, 15));
        if (d && w.agent(c.from) && w.agent(c.to)) {
          w.changeRelationship(c.from, c.to, d, cut(c.reason, 60) || s.title);
          if (d < 0) hit.set(c.to, (hit.get(c.to) ?? 0) + d);
        }
      }
      // v3: bị khịa nhiều trong một cảnh → nóng tính hơn một chút (tính cách trôi, World kẹp biên)
      for (const [id, d] of hit) if (d <= -6 && set.has(id)) this.drift(id, 'temper', 0.01);
    }
    const sumBy = (list: { id: string; delta: number }[]) => {
      const m = new Map<string, number>();
      for (const x of list) if (x && typeof x.id === 'string' && set.has(x.id)) m.set(x.id, (m.get(x.id) ?? 0) + fin(x.delta));
      return m;
    };
    if (allowed.has('mood')) {
      for (const [id, d] of sumBy(res.moodChanges)) {
        const v = Math.round(clamp(d, -15, 15));
        if (v && w.agent(id)) w.adjust(id, { mood: v });
      }
    }
    if (allowed.has('kpi')) {
      for (const [id, d] of sumBy(res.kpiChanges)) {
        const v = Math.round(clamp(d, -25, 25));
        if (v && w.agent(id)) w.adjust(id, { kpi: v });
      }
    }
    if (allowed.has('memory')) {
      const count = new Map<string, number>();
      for (const m of res.memories) {
        if (!m || typeof m.id !== 'string' || !set.has(m.id) || typeof m.text !== 'string') continue;
        const text = cut(m.text, 120);
        const n = count.get(m.id) ?? 0;
        if (!text || n >= 2 || !w.agent(m.id)) continue;
        count.set(m.id, n + 1);
        w.addMemory(m.id, text);
      }
    }
    if (allowed.has('rumor')) this.applyRumor(s, res);
  }

  private applyRumor(s: Scene, res: SceneResult): void {
    const w = this.world;
    const day = w.day();
    const minute = Math.floor(w.minuteOfDay());
    const told = res.rumor && typeof res.rumor.text === 'string' ? res.rumor.text.trim() : '';
    if (s.rumor) {
      const text = told || (s.rumor.isNew ? cut(res.summary, 200) : '');
      if (!text) return;
      const subject = w.agent(s.rumor.aboutId);
      const r = this.book.record({
        id: s.rumor.id, isNew: s.rumor.isNew, aboutId: s.rumor.aboutId, aboutName: subject?.name ?? s.rumor.aboutId,
        tellerId: s.rumor.tellerId, listenerIds: s.participants.filter((id) => id !== s.rumor!.tellerId), text, day, minute,
      });
      if (r) this.emitRumors();
      return;
    }
    // AI tự tung tin (vd lúc ăn trưa): hợp lệ nếu người bị đồn tồn tại và không ngồi đó
    const aboutId = res.rumor && typeof res.rumor.aboutId === 'string' ? res.rumor.aboutId : '';
    const about = aboutId ? w.agent(aboutId) : undefined;
    if (!told || !about || about.status === 'fired' || s.participants.includes(about.id)) return;
    const existing = this.book.activeAbout(about.id);
    const r = this.book.record({
      id: existing?.id ?? this.book.newId(day), isNew: !existing, aboutId: about.id, aboutName: about.name,
      tellerId: s.participants[0], listenerIds: s.participants.slice(1), text: told, day, minute,
    });
    if (r) this.emitRumors();
  }

  // ================================================================ dựng cảnh (chọn người + chỗ + tình huống)
  private kit(): SitKit {
    const w = this.world;
    return {
      w,
      facts: (a) => this.factsOf(a),
      recent: this.notable.slice(-3),
      snap: (id) => {
        const a = w.agent(id);
        return a ? snapOf(a) : undefined;
      },
    };
  }

  private placeLabel(a: AgentState): string {
    if (atDesk(this.world, a)) return `Bàn của ${a.name}`;
    const ar = areaOf(a);
    if (ar) return AREA_LABELS[ar];
    const sh = shelfAt(a);
    if (sh) return SPOT_LABELS[SHELF_SPOT[sh]] ?? 'Phòng trưng bày';
    if (a.activity === 'pingpong') return SPOT_LABELS.pingpong;
    if (a.activity === 'toilet') return SPOT_LABELS.toilet;
    return 'Khu làm việc';
  }

  private dPantry(co: CoLocation): Draft {
    const [host, ...rest] = co.people;
    const place: Record<string, Placement> = { [host.id]: { how: 'stay' } };
    for (const p of rest) place[p.id] = Math.hypot(p.x - host.x, p.y - host.y) > 3 ? { how: 'visit', hostId: host.id } : { how: 'stay' };
    return {
      type: 'pantry_chat',
      participants: co.people.map((p) => p.id),
      place,
      locationLabel: AREA_LABELS[co.area],
      sit: (people) => sitPantry(this.kit(), co.area, people),
      productFor: {},
    };
  }

  private dPingpong(pair: [AgentState, AgentState]): Draft {
    const [a, b] = pair;
    return {
      type: 'pingpong_match',
      participants: [a.id, b.id],
      locationLabel: SPOT_LABELS.pingpong,
      sit: () => sitPingpong(this.kit(), a, b),
    };
  }

  // ---------------------------------------------------------------- showroom_chat (v2, docs/v2-contract.md §3)
  private showroomReady(): boolean {
    return this.clockMs - this.lastShowroomAt >= this.showroomMinMsVal;
  }

  /** nhóm vừa tìm được có người do Director mời qua không (tình huống sẽ nói "vừa kéo mọi người qua coi") */
  private nudgedIn(g: ShowroomGroup): boolean {
    return !!this.nudge && g.people.some((p) => this.nudge!.ids.includes(p.id));
  }

  /**
   * v4: món + kiểu chuyện cho cảnh ở phòng trưng bày. Ai trong nhóm đã có món trên kệ thì hay kể lại (đã mua thấy ổn…);
   * đang có "vụ mua sắm" thì ưu tiên món hợp vụ; còn lại xoay vòng món ít được nhắc. Không có sản phẩm nào → null.
   */
  private showroomOffer(shelf: ProductShelf, people: AgentState[], rec: AgentState): ProductOffer | null {
    let all: Product[] = [];
    try { all = getProducts(); } catch (e) { this.err('getProducts', e); return null; }
    if (!all.length) return null;
    const onShelf = all.filter((p) => p.shelf === shelf);
    const list = onShelf.length ? onShelf : all;
    const recent = new Set(this.recentProducts);
    const mine = people.flatMap((x) => this.ownedBy(x.id).map((id) => ({ x, id })))
      .filter((o) => list.some((p) => p.id === o.id) && !recent.has(o.id));
    if (mine.length && chance(0.6)) {
      const o = pick(mine)!;
      const p = getProduct(o.id);
      // người có món luôn là người kể (dShowroom chọn mode 'owner' theo đúng người kể)
      if (p) return this.makeOffer(p, people, { owner: o.x, speakerId: o.x.id, mode: 'showroom' });
    }
    const theme = this.activeTheme();
    const themeTags = theme ? new Set(theme.def.tags) : null;
    const fresh = list.filter((p) => !recent.has(p.id));
    const pool = (fresh.length ? fresh : list).map((p) => {
      const th = themeTags ? (themeTags.size ? contextScore(p, themeTags) : 1) : 0;
      return { p, th, w: (th > 0 ? 3 * th : 0) + 1 / (1 + (this.productUses[p.id] ?? 0) * 0.5) };
    });
    const c = weightedPick(pool, (x) => x.w);
    if (!c) return null;
    // người khoe lỡ đã có món này → chỉ chọn kiểu chuyện của người đã có (không "chưa mua, đang tính rinh về")
    const recOwns = this.owns(rec.id, c.p.id);
    return this.makeOffer(c.p, people, { owner: recOwns ? rec : undefined, speakerId: rec.id, mode: 'showroom', theme: c.th > 0 && !recOwns ? theme : null });
  }

  private dShowroom(g: ShowroomGroup, nudged: boolean): Draft | null {
    const rec0 = pickRecommender(g.people, g.shelf);
    const offer = this.showroomOffer(g.shelf, g.people, rec0);
    if (!offer) return null; // chưa có sản phẩm nào trong data/products.json → không có gì để khoe
    const product = offer.product;
    const rec = g.people.find((p) => p.id === offer.speaker) ?? rec0;
    const ids = [rec.id, ...g.people.filter((p) => p.id !== rec.id).map((p) => p.id)];
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'stay' }; // đã đứng sẵn trước kệ (giữ nguyên chỗ đang giữ)
    return {
      type: 'showroom_chat',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS[SHELF_SPOT[g.shelf]] ?? 'Phòng trưng bày',
      sit: (people) => sitShowroom(this.kit(), people, g.shelf, { name: product.name, short: shortNameOf(product), emoji: product.emoji, angle: offer.angle }, rec, nudged),
      topicCats: [],
      product,
      productSpeaker: rec.id,
      productAngle: offer.angle,
      productHook: offer.hook,
      // người khoe đã có món này → kể như người đã dùng (prompt "MÓN ĐỒ … ĐÃ CÓ", offline SR_PRODUCT); chưa có → "MÓN TRÊN KỆ"
      productMode: this.owns(rec.id, product.id) ? 'owner' : 'showroom',
      productAngleKey: offer.angleKey,
      productBuys: offer.buys,
      meta: { label: g.shelf },
      labels: { [rec.id]: { label: 'đang khoe đồ trên kệ', emote: '🛍️' } },
      minPeople: 2,
    };
  }

  /** lịch "mời qua phòng trưng bày": có người đứng đó rồi thì diễn; chưa thì rủ 2–3 người qua rồi chờ họ tới */
  private dShowroomQueued(): Draft | null | 'drop' {
    const w = this.world;
    if (!this.showroomReady()) return null; // chờ hết cap; quá hạn thì mục tự rơi khỏi hàng đợi
    const here = findShowroomGroup(w, (a) => this.free(a, 'normal', { nudged: true }));
    if (here) return this.dShowroom(here, this.nudgedIn(here));
    const n = this.nudge;
    if (n) {
      const stillGoing = n.ids.some((id) => w.agent(id)?.activity === 'showroom');
      if (this.now() > n.until || !stillGoing) {
        this.nudge = null; // không ai tới kịp / đã bỏ đi làm việc khác → mời nhóm khác ở lượt sau (mục tự rơi khi hết cửa sổ)
        return null;
      }
      return null; // đang đi tới
    }
    if (!showroomAvailable()) return 'drop';
    // Không đủ 2 người rảnh ngay lúc này (đang trong cảnh khác, đi ăn, đang họp…) là chuyện tạm thời — nhất là khi AI viết thoại
    // và nhiều cảnh chạy song song — nên CHỜ và thử lại sau ~2,5 s thay vì bỏ mục; hết cửa sổ 45 phút game thì hàng đợi tự rơi.
    this.sendToShowroom();
    return null;
  }

  /** Rủ marketing (Trâm) + 1–2 người qua ngắm kệ: giữ chỗ showroom_* rồi setActivity 'showroom' (World đi đường) */
  private sendToShowroom(): boolean {
    const w = this.world;
    if (!showroomAvailable()) return false;
    const busy: Activity[] = ['napping', 'server_fix', 'lunch', 'meeting', 'toilet', 'arriving', 'patrol'];
    const pool = w.activeAgents().filter((a) => a.role !== 'boss' && this.free(a, 'normal') && !busy.includes(a.activity));
    if (pool.length < 2) return false;
    const mkt = pool.find((a) => a.role === 'marketing');
    const lead = mkt && chance(0.8) ? mkt
      : weightedPick(pool, (a) => 0.3 + fin(a.traits?.gossip) + 0.5 * fin(a.traits?.laziness) + (a.gender === 'nữ' ? 0.2 : 0));
    if (!lead) return false;
    const group = pickFriendsGroup(pool, Math.min(pool.length, randInt(2, 3)), lead);
    if (group.length < 2) return false;
    const shelf = preferredShelf(lead);
    const groups = [SHELF_SPOT[shelf], SHELF_SPOT[shelf === 'beauty' ? 'tech' : 'beauty']];
    const ids: string[] = [];
    for (const a of group) {
      let p: Pt | null = null;
      for (const g of groups) {
        p = w.reserveSpot(a.id, g);
        if (p) break;
      }
      if (!p) continue;
      const fl = pick(ACTIVITY_FLAVOR.showroom ?? []) ?? { label: 'ngắm đồ ở phòng trưng bày', emote: '🛍️' };
      const label = a.id === lead.id ? `kéo đồng nghiệp qua coi ${SHELF_LABEL[shelf]}` : fl.label;
      // World đếm thời lượng từ lúc TỚI kệ. Khi tua x5 / x10, 8–12 phút game chỉ còn 1–2 s thật → nhóm tan trước khi
      // Director kịp dựng cảnh; giữ cửa sổ tối thiểu ~10 s thật (đổi sang phút game theo tốc độ hiện tại).
      const stayMin = Math.max(randInt(8, 12), Math.ceil(this.realSecToGameMin(10)));
      w.setActivity(a.id, 'showroom', stayMin, { target: p, label, emote: fl.emote || '🛍️' });
      if (w.agent(a.id)?.activity !== 'showroom') { // World chưa nhận hoạt động 'showroom' → trả chỗ, thôi
        this.safeRelease(a.id);
        continue;
      }
      ids.push(a.id);
    }
    if (ids.length < 2) {
      for (const id of ids) {
        this.safeRelease(id);
        w.setActivity(id, 'idle', 0);
      }
      return false;
    }
    // chờ họ đi tới: 14 phút game nhưng không dưới ~15 s thật (x10: 14 phút game = 2,8 s thật, chưa đủ đi từ bàn qua kệ)
    this.nudge = { ids, shelf, until: this.now() + Math.max(SHOWROOM_NUDGE_WAIT_MIN, this.realSecToGameMin(15)) };
    return true;
  }

  private dDeskVisit(p: DeskVisitPick, why?: string, tone?: VisitTone): Draft {
    const { initiator: i, target: t, motive: m } = p;
    const act = tone && why ? why : motiveAct(m, this.world);
    return {
      type: 'desk_visit',
      participants: [i.id, t.id],
      place: { [i.id]: { how: 'visit', hostId: t.id }, [t.id]: { how: 'stay' } },
      locationLabel: `Bàn của ${t.name}`,
      sit: () => sitDeskVisit(this.kit(), i, t, m, act, tone ? undefined : why, tone),
      topicCats: tone ? [] : m.topics,
      productFor: i.role === 'marketing' && !tone ? { initiatorId: i.id } : undefined,
      title: tone === 'tense' ? `${i.name} và ${t.name} lời qua tiếng lại` : tone === 'makeup' ? `${i.name} làm hoà với ${t.name}`
        : tone === 'support' ? `${i.name} hỏi han ${t.name}` : `${i.name} ghé bàn ${t.name}`,
      icon: tone === 'tense' ? '😠' : tone === 'makeup' ? '🤝' : undefined,
    };
  }

  /** v3: nói xấu với "mầm" cho sẵn (mạch truyện: tình bạn bí mật, tin đồn crush…) — về một người không có mặt trong cảnh */
  private dGossipSeeded(aboutId: string, text: string, exclude: string[]): Draft | null | 'drop' {
    const w = this.world;
    const about = w.agent(aboutId);
    if (!about || about.status !== 'active') return 'drop';
    const ex = new Set([aboutId, ...exclude]);
    const pair = pickGossipPair(w, (x) => !ex.has(x.id) && this.free(x, 'normal') && x.activity !== 'napping' && x.activity !== 'server_fix');
    if (!pair) return null;
    const existing = this.book.activeAbout(about.id);
    return this.gossipDraft(pair.a, pair.b, about, existing
      ? { id: existing.id, isNew: false, text: cut(text, 200) }
      : { id: this.book.newId(w.day()), isNew: true, text: cut(text, 200) });
  }

  private dGossip(gp: { a: AgentState; b: AgentState } | null, force = false): Draft | null {
    const w = this.world;
    const prio: Priority = force ? 'normal' : 'low';
    const freeFn = (x: AgentState) => this.free(x, prio) && x.activity !== 'server_fix' && x.activity !== 'napping';
    // 60%: kể tiếp một tin đồn đang lan (tam sao thất bản)
    if (chance(0.6)) {
      const pool = w.activeAgents().filter((x) => x.role !== 'boss' && freeFn(x));
      const cont = this.book.pickContinuation(pool, mutual, 10) ?? (force ? this.book.pickContinuation(pool, mutual, -10) : null);
      if (cont) {
        const teller = w.agent(cont.tellerId), listener = w.agent(cont.listenerId), about = w.agent(cont.rumor.aboutId);
        if (teller && listener && about && about.status !== 'fired') {
          return this.gossipDraft(teller, listener, about, { id: cont.rumor.id, isNew: false, text: this.book.latestText(cont.rumor) });
        }
      }
    }
    const pair = gp ?? pickGossipPair(w, freeFn);
    if (!pair) return null;
    const about = pickGossipSubject(w, pair.a, pair.b, (x) => this.interestOf(x),
      (x) => this.book.all().filter((r) => r.aboutId === x.id).length);
    if (!about) return null;
    const existing = this.book.activeAbout(about.id);
    if (existing && existing.heardBy.includes(pair.a.id) && !existing.heardBy.includes(pair.b.id)) {
      return this.gossipDraft(pair.a, pair.b, about, { id: existing.id, isNew: false, text: this.book.latestText(existing) });
    }
    return this.gossipDraft(pair.a, pair.b, about, { id: this.book.newId(w.day()), isNew: true, text: this.rumorSeed(about) });
  }

  private gossipDraft(a: AgentState, b: AgentState, about: AgentState, r: { id: string; isNew: boolean; text: string }): Draft {
    return {
      type: 'gossip',
      participants: [a.id, b.id],
      aboutId: about.id,
      joint: { ids: [a.id, b.id], groups: shuffle(['pantry_table', 'window', 'lounge']) },
      locationLabel: SPOT_LABELS.window,
      sit: (_people, label) => sitGossip(this.kit(), a, b, about, label.toLowerCase(), { isNew: r.isNew, text: r.text }, this.cfg.kpiLowRatio),
      rumor: { id: r.id, aboutId: about.id, currentText: r.text, isNew: r.isNew, tellerId: a.id },
      title: `Nói xấu ${about.role === 'boss' ? 'sếp' : about.name} sau lưng`,
    };
  }

  /** mầm tin đồn mới từ "phốt" có thật trong ngày */
  private rumorSeed(x: AgentState): string {
    const seeds: string[] = [];
    const c = this.actCounts[x.id] ?? {};
    if (x.caughtToday > 0) seeds.push(`${x.name} bị sếp bắt quả tang ${x.caughtToday} lần hôm nay`);
    if (this.lateToday[x.id] !== undefined) seeds.push(`${x.name} sáng nay đi trễ tới ${hhmm(this.lateToday[x.id])}`);
    if ((c.toilet ?? 0) >= 3) seeds.push(`${x.name} đi toilet ${c.toilet} lần trong ngày`);
    if ((c.coffee ?? 0) >= 3) seeds.push(`${x.name} uống ${c.coffee} ly cà phê một ngày`);
    if ((c.pingpong ?? 0) >= 2) seeds.push(`${x.name} trốn ra đánh bóng bàn hoài`);
    if ((c.showroom ?? 0) >= 2) seeds.push(`${x.name} cứ ra phòng trưng bày ngắm đồ hoài, chắc sắp chốt đơn lớn`);
    if (x.lowStreak > 0 && x.role !== 'boss') seeds.push(`KPI của ${x.name} thấp mấy ngày liền`);
    if (x.warnings > 0) seeds.push(`${x.name} từng bị HR gọi lên nói chuyện`);
    if (x.role === 'boss' && this.world.bossAway()) seeds.push(`sếp lại đi "${bossNoteShort(this.world, 50)}"`);
    if (fin(x.hiredDay) > 1 && this.world.day() - fin(x.hiredDay) <= 3) seeds.push(`${x.name} mới vào mà đã được ưu ái`);
    if (fin(x.mood, 60) > 80) seeds.push(`dạo này ${x.name} vui bất thường`);
    if (fin(x.stress, 30) > 70) seeds.push(`dạo này ${x.name} hay cáu bất thường`);
    return pick(seeds) ?? '';
  }

  private dGroup(reason: GroupReason, data: ReasonData, opts: { must?: string[]; exclude?: string[]; prio?: Priority } = {}): Draft | null {
    const prio = opts.prio ?? 'normal';
    const people = pickGroupMembers(this.world, (a) => this.free(a, prio), { must: opts.must, exclude: opts.exclude });
    if (!people) return null;
    const cats: Partial<Record<GroupReason, TopicCategory[]>> = {
      payday: ['tien_bac'], lunch_plan: ['an_uong'], end_of_day: ['giai_tri', 'doi_song'], boss_left: ['giai_tri', 'an_uong'],
    };
    const aboutId = data.id && !people.some((p) => p.id === data.id) && (this.world.agent(data.id) || this.departed.has(data.id))
      ? data.id : undefined;
    return {
      type: 'group_chat',
      participants: people.map((p) => p.id),
      aboutId,
      locationLabel: GROUP_CHAT_LABEL,
      sit: (ps) => sitGroupChat(this.kit(), reason, ps, data),
      topicCats: reason === 'random' ? undefined : cats[reason] ?? [],
      productFor: {},
      minPeople: 3,
    };
  }

  private dGroupSpont(): Draft | null {
    const w = this.world;
    const b = this.boost && this.boost.until > this.now() ? this.boost : null;
    let reason: GroupReason = 'random';
    let data: ReasonData = {};
    if (b && !(b.used > 0 && chance(0.7))) {
      reason = b.reason;
      data = b.data;
      b.used++;
    } else {
      const inc = w.company()?.incident;
      if (inc === 'wifi_down') reason = 'wifi_down';
      else if (inc === 'server_down' && chance(0.6)) reason = 'server_down';
      else if (deadlineDaysLeft(w) <= 1 && chance(0.25)) {
        reason = 'deadline';
        data = { note: cut(w.company()?.project?.name, 40) };
      } else if (chance(0.2)) {
        const risky = w.agents().filter((a) => a.status === 'active' && a.role !== 'boss' && a.role !== 'hr' && (a.lowStreak > 0 || a.warnings > 0))
          .sort((x, y) => (y.lowStreak + y.warnings) - (x.lowStreak + x.warnings))[0];
        if (risky) {
          reason = 'kpi_risk';
          data = { name: risky.name, note: `${risky.lowStreak} ngày KPI thấp${risky.warnings ? `, đã bị nhắc ${risky.warnings} lần` : ''}` };
          return this.dGroup(reason, data, { prio: 'low', exclude: [risky.id] });
        }
      }
    }
    return this.dGroup(reason, data, { prio: 'low' });
  }

  private dCompany(reason: CompanyReason, data: ReasonData, must: string[] = [], prio: Priority = 'normal'): Draft | null {
    const people = pickCompanyChat(this.world, (a) => this.free(a, prio), (b) => this.free(b, 'normal', { allowAbsent: true }), { must });
    if (!people) return null;
    return {
      type: 'company_chat',
      participants: people.map((p) => p.id),
      locationLabel: COMPANY_CHAT_LABEL,
      sit: (ps) => sitCompanyChat(this.kit(), reason, ps, data),
      topicCats: reason === 'announce' || reason === 'kpi_push' ? undefined : [],
      allowAbsent: [people[0].id],
      minPeople: 3,
      meta: { reason }, // đánh dấu "đã nhắn hôm nay" chỉ khi cảnh thật sự được tạo (xem launch)
    };
  }

  private dCompanySpont(): Draft | null {
    const min = this.world.minuteOfDay();
    const base: CompanyReason[] = min < 600 ? ['morning'] : ['kpi_push', 'announce'];
    const options = base.filter((r) => !this.companyToday.has(r));
    const reason = pick(options);
    return reason ? this.dCompany(reason, {}, [], 'low') : null;
  }

  private dStandup(variant?: 'pitch'): Draft | null {
    const w = this.world;
    // buổi pitch ý tưởng (mạch truyện): cả công ty được mời, không chỉ team dev
    const team = variant === 'pitch'
      ? w.agents().filter((a) => a.status === 'active' && a.role !== 'boss')
      : w.agents().filter((a) => a.status === 'active' && STANDUP_ROLES.includes(a.role));
    const here = team.filter((a) => this.free(a, 'normal'));
    if (here.length < 3) return null;
    const absent = team.filter((a) => !a.present).map((a) => a.name);
    const boss = w.boss();
    const withBoss = !!boss && boss.present && !w.bossAway() && this.free(boss, 'normal') && chance(variant === 'pitch' ? 0.8 : 0.3);
    const ids = [...shuffle(here).slice(0, variant === 'pitch' ? 5 : here.length).map((a) => a.id), ...(withBoss && boss ? [boss.id] : [])];
    const lead = here.find((a) => a.role === 'techlead');
    if (lead && ids.includes(lead.id)) ids.sort((x, y) => (x === lead.id ? -1 : y === lead.id ? 1 : 0));
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'spot', group: 'meeting', optional: true };
    const late = here.filter((a) => this.lateToday[a.id] !== undefined).map((a) => `${a.name} (${hhmm(this.lateToday[a.id])})`);
    return {
      type: 'standup',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.meeting,
      sit: (people) => sitStandup(this.kit(), people, absent, late, variant),
      minPeople: 3,
      title: variant === 'pitch' ? 'Buổi pitch ý tưởng trời ơi' : undefined,
      icon: variant === 'pitch' ? '💡' : undefined,
      meta: variant ? { variant } : undefined,
    };
  }

  private dLunch(): Draft | null {
    const w = this.world;
    const pool = w.activeAgents().filter((a) => a.role !== 'boss' && this.free(a, 'normal') && a.activity !== 'server_fix');
    const eating = pool.filter((a) => a.activity === 'lunch');
    const base = eating.length >= 3 ? eating : pool;
    if (base.length < 2) return null;
    const group = pickFriendsGroup(base, Math.min(base.length, randInt(3, 4)));
    if (group.length < 2) return null;
    const ids = group.map((a) => a.id);
    let rumor: Draft['rumor'];
    let rumorAbout: AgentState | undefined;
    const r = this.book.all().find((x) => x.active && !ids.includes(x.aboutId)
      && ids.some((id) => x.heardBy.includes(id)) && ids.some((id) => !x.heardBy.includes(id)));
    if (r && chance(0.45)) {
      const tellerId = ids.find((id) => r.heardBy.includes(id))!;
      ids.sort((x, y) => (x === tellerId ? -1 : y === tellerId ? 1 : 0));
      rumor = { id: r.id, aboutId: r.aboutId, currentText: this.book.latestText(r), isNew: false, tellerId };
      rumorAbout = w.agent(r.aboutId);
    }
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'spot', group: 'pantry_table', optional: true };
    return {
      type: 'lunch',
      participants: ids,
      place,
      aboutId: rumorAbout ? rumorAbout.id : undefined,
      locationLabel: SPOT_LABELS.pantry_table,
      sit: (people) => sitLunch(this.kit(), people, rumorAbout),
      rumor,
      productFor: {},
      minPeople: 2,
    };
  }

  private dBossCatch(boss: AgentState, victim: AgentState, caught?: string): Draft {
    const w = this.world;
    const second = nearbySlacker(w, victim, (a) => this.free(a, 'high'), w.minuteOfDay());
    const ids = [boss.id, victim.id, ...(second ? [second.id] : [])];
    const where = atDesk(w, victim) ? 'ngay tại bàn làm việc' : `ở ${this.placeLabel(victim).toLowerCase()}`;
    const place: Record<string, Placement> = { [boss.id]: { how: 'visit', hostId: victim.id }, [victim.id]: { how: 'stay' } };
    if (second) place[second.id] = { how: 'visit', hostId: victim.id };
    return {
      type: 'boss_catch',
      participants: ids,
      place,
      locationLabel: this.placeLabel(victim),
      sit: (people) => sitBossCatch(this.kit(), boss, victim, second && people.some((p) => p.id === second.id) ? second : null,
        this.cfg.kpiLowRatio, where, caught),
      topicCats: [],
      meta: { victimId: victim.id, label: caught ?? actPhrase(victim.activity, victim.activityLabel) },
      labels: { [boss.id]: { label: 'đang mắng nhân viên', emote: '😤' } },
    };
  }

  /** forced (v3): lý do + người do HR/mạch truyện chỉ định (vd khen sau họp xét nhân sự, mắng vì khách giận) */
  private dBossCall(forced?: BossCallReason, forcedId?: string, note?: string): Draft | null | 'drop' {
    const w = this.world;
    const boss = w.boss();
    if (!boss || boss.status !== 'active' || !boss.present || w.bossAway() || !this.free(boss, 'normal')) return null;
    const all = w.activeAgents().filter((a) => a.role !== 'boss' && this.free(a, 'normal'));
    let reason: BossCallReason = 'task';
    let emp: AgentState | undefined;
    if (forced && forcedId) {
      const t = w.agent(forcedId);
      if (!t || t.status !== 'active') return 'drop';
      if (!this.free(t, 'normal')) return null;
      reason = forced;
      emp = t;
    } else {
      // mỗi người tối đa 1 lần "lên phòng sếp" mỗi ngày (trừ khi chẳng còn ai khác)
      const staff = all.filter((a) => !this.calledToday.has(a.id)).length ? all.filter((a) => !this.calledToday.has(a.id)) : all;
      const ranked = staff.filter((a) => a.role !== 'hr');
      if (!staff.length) return null;
      const min = w.minuteOfDay();
      const top = [...ranked].sort((x, y) => kpiPct(y) - kpiPct(x))[0];
      const bottom = [...ranked].sort((x, y) => (y.lowStreak - x.lowStreak) || (kpiPct(x) - kpiPct(y)))[0];
      const roll = Math.random();
      if (forced === 'scold' && bottom) {
        reason = 'scold';
        emp = bottom;
      } else if (forced === 'task') {
        emp = pick(staff);
      } else if (roll < 0.35 && top && min >= 600 && kpiPct(top) >= 80) {
        reason = 'praise';
        emp = top;
      } else if (roll < 0.75 && bottom && (bottom.lowStreak > 0 || (min >= 660 && kpiPct(bottom) < 50))) {
        reason = 'scold';
        emp = bottom;
      } else {
        emp = weightedPick(staff, (a) => 0.4 + Math.max(0, relScore(boss, a.id)) / 40 + fin(a.traits?.ambition));
      }
      emp = emp ?? staff[0];
    }
    const e = emp;
    if (!e) return null;
    return {
      type: 'boss_call',
      participants: [boss.id, e.id],
      place: { [boss.id]: { how: 'seat' }, [e.id]: { how: 'spot', group: 'boss_visit' } },
      locationLabel: SPOT_LABELS.boss_visit,
      sit: () => sitBossCall(this.kit(), boss, e, reason, this.cfg.kpiLowRatio, note),
      topicCats: reason === 'task' ? undefined : [],
      meta: { reason, targetId: e.id, note },
      title: reason === 'praise' ? `Sếp khen ${e.name}` : undefined,
      labels: { [boss.id]: { label: reason === 'praise' ? 'đang khen nhân viên' : 'đang làm việc với nhân viên', emote: reason === 'scold' ? '😤' : '📊' } },
    };
  }

  private dHrWarning(emp: AgentState, retries = 0): Draft | null {
    const hr = this.world.hr();
    if (!hr || hr.status !== 'active' || hr.id === emp.id || !this.free(hr, 'high') || !this.free(emp, 'high')) return null;
    const lateCount = (this.lateDays[emp.id] ?? []).length;
    return {
      type: 'hr_warning',
      participants: [hr.id, emp.id],
      place: { [hr.id]: { how: 'spot', group: 'meeting' }, [emp.id]: { how: 'spot', group: 'meeting' } },
      locationLabel: SPOT_LABELS.meeting,
      sit: () => sitHrWarning(this.kit(), hr, emp, this.cfg.kpiLowRatio, lateCount),
      topicCats: [],
      meta: { targetId: emp.id, retries },
      labels: { [hr.id]: { label: 'đang nói chuyện KPI', emote: '📋' } },
    };
  }

  private dFiring(emp: AgentState, retries = 0): Draft | null {
    const w = this.world;
    const hr = w.hr();
    if (!hr || hr.status !== 'active' || hr.id === emp.id || !this.free(hr, 'high') || !this.free(emp, 'high')) return null;
    const boss = w.boss();
    const withBoss = !!boss && boss.status === 'active' && boss.present && !w.bossAway() && this.free(boss, 'high');
    const ids = withBoss && boss ? [boss.id, hr.id, emp.id] : [hr.id, emp.id];
    const place: Record<string, Placement> = { [hr.id]: { how: 'spot', group: 'boss_visit' }, [emp.id]: { how: 'spot', group: 'boss_visit' } };
    if (withBoss && boss) place[boss.id] = { how: 'seat' };
    return {
      type: 'firing',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.boss_visit,
      sit: () => sitFiring(this.kit(), hr, emp, withBoss && boss ? boss : null, this.cfg.kpiLowRatio),
      topicCats: [],
      meta: { targetId: emp.id, retries },
      labels: Object.fromEntries(ids.filter((id) => id !== emp.id).map((id) => [id, { label: 'đang thông báo nghỉ việc', emote: '📋' }])),
      minPeople: 2,
    };
  }

  private dInterview(cand: AgentState, v: Vacancy, hr: AgentState): Draft | null {
    const panel = interviewPanel(this.world, v.role, (a) => this.free(a, 'high')).filter((p) => p.id !== hr.id);
    const ids = [hr.id, cand.id, ...panel.map((p) => p.id)];
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'spot', group: 'meeting', optional: id !== hr.id && id !== cand.id };
    const forceHire = v.rejections >= 2;
    return {
      type: 'interview',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.meeting,
      sit: (people) => sitInterview(this.kit(), hr, cand, people.filter((p) => p.id !== cand.id),
        { replacingName: v.replacingName, rejections: v.rejections, forceHire }),
      topicCats: [],
      meta: { candidateId: cand.id, vacancyRole: v.role, forceHire },
      labels: Object.fromEntries(ids.filter((id) => id !== cand.id).map((id) => [id, { label: 'đang phỏng vấn ứng viên', emote: '📝' }])),
      title: `Phỏng vấn ${cand.name} · ${v.roleLabel}`,
      minPeople: 2,
    };
  }

  private dIncident(reason: 'server_down' | 'bug_prod', note?: string): Draft | null {
    const w = this.world;
    const taken = new Set<string>();
    const avail = (r: RoleKey) => {
      const a = w.activeAgents().find((x) => x.role === r && !taken.has(x.id) && this.free(x, 'high'));
      if (a) taken.add(a.id);
      return a;
    };
    const team: AgentState[] = [];
    for (const r of ['techlead', 'senior'] as RoleKey[]) {
      const a = avail(r);
      if (a) team.push(a);
    }
    const order: RoleKey[] = chance(0.5) ? ['junior', 'qa'] : ['qa', 'junior'];
    for (const r of order) {
      if (team.length >= 3) break;
      const a = avail(r);
      if (a) team.push(a);
    }
    if (team.length < 2) return null;
    const place: Record<string, Placement> = {};
    for (const a of team) place[a.id] = { how: 'spot', group: 'server', optional: team.length > 2 && a.role !== 'techlead' };
    return {
      type: 'incident',
      participants: team.map((a) => a.id),
      place,
      locationLabel: SPOT_LABELS.server,
      sit: (people) => sitIncident(this.kit(), people, reason, note),
      topicCats: [],
      meta: { reason, note },
      title: reason === 'bug_prod' ? 'Bug production sau release!' : undefined,
      icon: reason === 'bug_prod' ? '🐛' : undefined,
    };
  }

  private dCelebration(reason: CelebrationReason, centerId?: string, note?: string): Draft | null {
    const w = this.world;
    const center = centerId ? w.agent(centerId) : undefined;
    if (centerId && (!center || center.status !== 'active' || !this.free(center, 'normal'))) return null;
    let pool = w.activeAgents().filter((a) => a.role !== 'boss' && a.id !== center?.id && this.free(a, 'normal') && a.activity !== 'server_fix');
    if (reason === 'release') pool = [...pool.filter((a) => isTech(a.role)), ...pool.filter((a) => !isTech(a.role))].slice(0, 6);
    const want = Math.min(randInt(3, 5), pool.length + (center ? 1 : 0));
    const group = center ? pickFriendsGroup([center, ...pool], want, center) : pickFriendsGroup(pool, want);
    const boss = w.boss();
    const withBoss = !!boss && boss.present && !w.bossAway() && this.free(boss, 'normal') && reason !== 'payday' && chance(0.6);
    const ids = [...group.map((a) => a.id), ...(withBoss && boss ? [boss.id] : [])];
    if (ids.length < 3) return null;
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'spot', group: 'lounge', optional: id !== center?.id };
    return {
      type: 'celebration',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.lounge,
      sit: (people) => sitCelebration(this.kit(), people, reason, center, note),
      productFor: {},
      meta: { reason, centerId, note },
      title: celebrationTitle(reason, center, note),
      icon: reason === 'birthday' ? '🎂' : undefined,
      minPeople: 3,
    };
  }

  private confrontPick(rumorId?: string): { rumor: Rumor; subject: AgentState; teller: AgentState } | null {
    const w = this.world;
    const list = rumorId ? [this.book.get(rumorId)].filter((r): r is Rumor => !!r) : this.book.confrontable();
    for (const r of shuffle([...list])) {
      if (!r.active) continue;
      const subject = w.agent(r.aboutId);
      if (!subject || subject.status !== 'active' || !this.free(subject, 'normal')) continue;
      if (subject.role === 'boss' && w.bossAway()) continue;
      const order = [...r.versions].reverse().map((v) => v.tellerId).concat(r.heardBy);
      for (const tid of order) {
        if (!tid || tid === subject.id) continue;
        const t = w.agent(tid);
        if (t && t.status === 'active' && this.free(t, 'normal')) return { rumor: r, subject, teller: t };
      }
    }
    return null;
  }

  private dConfront(rumorId?: string): Draft | null {
    const p = this.confrontPick(rumorId);
    if (!p) return null;
    const { rumor, subject, teller } = p;
    const otherId = [...rumor.versions].reverse().map((v) => v.tellerId).find((id) => id && id !== teller.id && id !== subject.id);
    const otherName = otherId ? this.world.agent(otherId)?.name : undefined;
    const latest = this.book.latestText(rumor);
    return {
      type: 'confront',
      participants: [subject.id, teller.id],
      aboutId: subject.id,
      place: { [subject.id]: { how: 'visit', hostId: teller.id }, [teller.id]: { how: 'stay' } },
      locationLabel: this.placeLabel(teller),
      sit: () => sitConfront(this.kit(), subject, teller, { original: this.book.originalText(rumor), latest, reach: rumor.heardBy.length, otherTeller: otherName }),
      rumor: { id: rumor.id, aboutId: subject.id, currentText: latest, isNew: false, tellerId: teller.id },
      topicCats: [],
      meta: { rumorId: rumor.id },
      title: `${subject.name} đối chất ${teller.name}`,
    };
  }

  private dWelcome(newbie: AgentState, replacingName?: string): Draft | null {
    const w = this.world;
    if (!this.free(newbie, 'normal')) return null;
    const others: AgentState[] = [];
    const hr = w.hr();
    if (hr && hr.id !== newbie.id && this.free(hr, 'normal')) others.push(hr);
    const sameTeam = (a: AgentState) => (isTech(newbie.role) ? isTech(a.role) : isBiz(newbie.role) ? isBiz(a.role) : true);
    const team = shuffle(w.activeAgents().filter((a) => a.id !== newbie.id && a.role !== 'boss' && a.role !== 'hr'
      && this.free(a, 'normal') && sameTeam(a)));
    team.sort((x, y) => (y.role === 'junior' ? 1 : 0) - (x.role === 'junior' ? 1 : 0));
    others.push(...team.slice(0, randInt(1, 2)));
    if (!others.length) return null;
    const place: Record<string, Placement> = { [newbie.id]: { how: 'seat' } };
    for (const o of others) place[o.id] = { how: 'visit', hostId: newbie.id };
    return {
      type: 'welcome',
      participants: [newbie.id, ...others.map((o) => o.id)],
      place,
      locationLabel: `Bàn của ${newbie.name}`,
      sit: (people) => sitWelcome(this.kit(), newbie, people.filter((p) => p.id !== newbie.id), replacingName),
      topicCats: [],
      meta: { targetId: newbie.id },
      title: `Chào người mới ${newbie.name}`,
    };
  }

  // ================================================================ sếp bắt quả tang / đi trễ
  private handleSlacker(bossId: string, victimId: string): void {
    const w = this.world;
    const boss = w.agent(bossId);
    const victim = w.agent(victimId);
    if (!boss || !victim || victim.status !== 'active' || victim.sceneId || boss.sceneId) return;
    const last = this.lastCaught.get(victim.id);
    if (last !== undefined && this.now() - last < 15 && this.now() >= last) return; // World báo trùng
    this.lastCaught.set(victim.id, this.now());
    const label = actPhrase(victim.activity, victim.activityLabel);
    victim.caughtToday = fin(victim.caughtToday) + 1;
    this.counters.catches++;
    // v3: bị bắt → bớt lười một chút; sếp đang "khó ở" (mạch truyện) → phạt thêm
    this.drift(victim.id, 'laziness', -0.02);
    if (this.now() < this.bossStrictUntil) w.adjust(victim.id, { mood: -4, stress: 6, kpi: -4 });
    let scene: Scene | null = null;
    let queued = false;
    if (victim.present && this.free(boss, 'high')) {
      if (!this.office) {
        const via = this.brain.reserve('high');
        if (via) scene = this.launch(this.dBossCatch(boss, victim, label), via, 'high');
      } else if (!this.queued('boss_catch')) {
        // slot văn phòng đang bận: giữ "khoảnh khắc" một lúc ngắn, cảnh hiện tại xong là sếp quay lại xử lý
        const now = this.now();
        queued = !!this.enqueue('boss_catch', now, now + CATCH_WAIT_MIN, 'high', { targetId: victim.id, label });
      }
    }
    this.pushDayEvent(`😱 ${victim.name} bị sếp bắt quả tang ${label}`, true);
    if (!scene && !queued) this.catchFallback(victim.id, label);
    const short = label.replace(/^đang\s+/, '');
    this.setBoost('after_catch', { name: victim.name, label: short, id: victim.id }, 30);
    if (chance(0.45)) {
      const now = this.now();
      this.enqueue('group_chat', now + rand(3, 10), now + 40, 'low', { reason: 'after_catch', name: victim.name, label: short, aboutId: victim.id });
    }
  }

  /** không có cảnh bắt quả tang (không có slot / hết hạn chờ) → hậu quả nhẹ, không thoại */
  private catchFallback(victimId: string | undefined, label: string | undefined): void {
    const w = this.world;
    const victim = victimId ? w.agent(victimId) : undefined;
    if (!victim || victim.status !== 'active') return;
    const what = label || 'đang lơ là';
    w.log({ kind: 'event', text: `Sếp đi ngang thấy ${victim.name} ${what}…`, icon: '👀' });
    w.adjust(victim.id, { mood: -8, stress: 10, kpi: -5 });
    w.addMemory(victim.id, cut(`Bị sếp bắt gặp ${what}`, 120));
  }

  private handleArrival(id: string, late: boolean): void {
    const w = this.world;
    const a = w.agent(id);
    if (!a) return;
    this.daySawPresence = true;
    // sếp tự quyết giờ giấc; mỗi người chỉ tính trễ 1 lần/ngày
    if (!late || a.status !== 'active' || a.role === 'boss' || this.lateToday[id] !== undefined) return;
    const minute = Math.floor(w.minuteOfDay());
    this.lateToday[id] = minute;
    const days = this.lateDays[id] ?? [];
    if (!days.includes(w.day())) days.push(w.day());
    this.lateDays[id] = days.slice(-7);
    this.logEvent('⏰', `${a.name} đi trễ (${hhmm(minute)})`, 'event', true);
    const now = this.now();
    const hr = w.hr();
    if (hr && hr.id !== id && chance(0.35)) {
      this.enqueue('desk_visit', now + rand(8, 20), now + 60, 'normal', {
        initiatorId: hr.id, targetId: id, motiveKey: 'hr_probe', why: `nhắc chuyện sáng nay đi trễ, tới lúc ${hhmm(minute)}`,
      });
    } else if (chance(0.3)) {
      this.enqueue('group_chat', now + rand(2, 6), now + 30, 'low', { reason: 'late', name: a.name, note: `tới lúc ${hhmm(minute)}`, targetId: id });
    }
  }

  // ================================================================ sự kiện
  private evServerDown(auto = false): void {
    const w = this.world;
    const now = this.now();
    if (w.company()?.incident === 'server_down') { // đang sập rồi: không diễn lại cảnh sự cố
      if (!auto) w.toast('🔥', 'Server vẫn đang sập, team dev đang xử lý!');
      return;
    }
    w.setIncident('server_down');
    this.timers = this.timers.filter((t) => t.kind !== 'clear_incident');
    this.addTimer({ kind: 'clear_incident', at: now + randInt(30, 60), incident: 'server_down' });
    this.logEvent('🔥', 'Sập server! Khách gọi cháy máy, đơn hàng BánNhanh POS treo cứng', 'event', true);
    w.toast('🔥', 'Server production vừa sập!');
    for (const a of w.activeAgents()) if (DEV_ROLES.includes(a.role)) w.adjust(a.id, { stress: 15 });
    this.setBoost('server_down', {}, 60);
    if (chance(0.4)) this.enqueue('company_chat', now + rand(2, 6), now + 30, 'low', { reason: 'incident' });
    if (!this.queued('incident') && this.office?.type !== 'incident') {
      this.enqueue('incident', now, now + 45, 'high', { reason: 'server_down' });
    }
  }

  private evWifiDown(auto = false): void {
    const w = this.world;
    const now = this.now();
    const cur = w.company()?.incident;
    if (cur) { // đang có sự cố khác (1 sự cố một lúc)
      if (!auto) w.toast('📶', cur === 'wifi_down' ? 'Wifi vẫn đang mất, chờ chút nha!' : 'Đang sập server rồi — mất wifi để lúc khác');
      return;
    }
    w.setIncident('wifi_down');
    this.timers = this.timers.filter((t) => t.kind !== 'clear_incident');
    this.addTimer({ kind: 'clear_incident', at: now + randInt(20, 40), incident: 'wifi_down' });
    this.logEvent('📶', 'Mất wifi! Cả văn phòng chuyển sang 4G', 'event', true);
    w.toast('📶', 'Văn phòng mất wifi!');
    this.setBoost('wifi_down', {}, 40);
    this.enqueue('group_chat', now + rand(0.5, 3), now + 30, 'normal', { reason: 'wifi_down' });
  }

  private clearIncident(kind?: 'server_down' | 'wifi_down'): void {
    const w = this.world;
    const cur = w.company()?.incident ?? null;
    if (!cur || (kind && cur !== kind)) return;
    w.setIncident(null);
    if (cur === 'server_down') {
      this.logEvent('✅', 'Server đã chạy lại, cả team thở phào', 'event', true);
      if (!this.theme && chance(0.6)) this.startTheme(themeByKey('backup_scare'));
      for (const a of w.agents()) {
        if (a.activity === 'server_fix' && !a.sceneId && a.status === 'active') {
          this.safeRelease(a.id);
          w.setActivity(a.id, 'idle', 0);
        }
      }
    } else {
      this.logEvent('📶', 'Wifi đã có lại, ai nấy lại cắm mặt vào màn hình', 'event', false);
    }
    if (this.boost && (this.boost.reason === 'server_down' || this.boost.reason === 'wifi_down')) this.boost = null;
  }

  private evPayday(): void {
    const w = this.world;
    const now = this.now();
    for (const a of w.agents()) if (a.status === 'active') w.adjust(a.id, { mood: 15 });
    this.logEvent('💸', 'Lương về! Cả văn phòng rạng rỡ hẳn lên', 'event', true);
    w.toast('💸', 'Lương về rồi!');
    this.productBoostUntil = now + 120;
    this.setBoost('payday', {}, 120);
    this.enqueue('company_chat', now + rand(0.5, 2), now + 30, 'normal', { reason: 'payday' });
    this.enqueue('group_chat', now + rand(3, 8), now + 40, 'normal', { reason: 'payday' });
    if (chance(0.45)) this.enqueue('celebration', now + rand(10, 25), now + 90, 'normal', { reason: 'payday' });
  }

  private evBirthday(agentId?: string, auto = false): void {
    const w = this.world;
    let a = agentId ? w.agent(agentId) : undefined;
    if (!a || a.status !== 'active') {
      const pool = w.agents().filter((x) => x.status === 'active' && x.present);
      const fresh = pool.filter((x) => this.birthdays[x.id] === undefined);
      a = pick(fresh.length ? fresh : pool);
    }
    if (!a) {
      if (!auto) w.toast('🎂', 'Văn phòng đang không có ai để tổ chức sinh nhật');
      return;
    }
    this.birthdays[a.id] = w.day();
    this.birthdayToday = a.id;
    w.adjust(a.id, { mood: 6 });
    this.logEvent('🎂', `Hôm nay sinh nhật ${a.name}!`, 'event', true);
    w.toast('🎂', `Chúc mừng sinh nhật ${a.name}!`);
    const now = this.now();
    if (chance(0.5)) this.enqueue('group_chat', now + rand(1, 4), now + 30, 'normal', { reason: 'birthday', name: a.name, centerId: a.id });
    this.enqueue('celebration', now + rand(6, 15), now + 120, 'normal', { reason: 'birthday', centerId: a.id });
  }

  private evDeal(agentId?: string): void {
    const w = this.world;
    const now = this.now();
    let a = agentId ? w.agent(agentId) : undefined;
    const devTriggered = !agentId;
    if (!a || a.status !== 'active') {
      const sales = w.activeAgents().filter((x) => x.role === 'saleslead' || x.role === 'salesnew');
      a = pick(sales) ?? pick(w.activeAgents().filter((x) => isBiz(x.role)));
    }
    if (!a) return;
    if (devTriggered) {
      // nút dev không kèm người chốt → Director tự cộng doanh thu/KPI (World tự cộng cho deal của chính nó)
      w.addRevenue(randInt(10, 80));
      w.adjust(a.id, { kpi: 40 });
    }
    w.adjust(a.id, { mood: 8 });
    w.toast('💰', `${a.name} vừa chốt hợp đồng!`);
    // World đã tự ghi log deal của nó → Director chỉ ghi khi tự tạo deal (nút dev không có người chốt)
    if (devTriggered) this.logEvent('💰', `${a.name} vừa chốt hợp đồng mới`, 'event', true);
    else this.pushDayEvent(`💰 ${a.name} chốt được hợp đồng mới`, true);
    this.setBoost('deal', { name: a.name, id: a.id }, 30);
    const r = Math.random();
    if (r < 0.35) this.enqueue('celebration', now + rand(3, 10), now + 60, 'normal', { reason: 'deal', centerId: a.id });
    else if (r < 0.85) this.enqueue('company_chat', now + rand(1, 5), now + 30, 'low', { reason: 'deal', name: a.name, targetId: a.id });
    // trưởng nhóm sales chốt deal = lại hứa thêm tính năng → Tech Lead cáu
    if (a.role === 'saleslead' && chance(0.45)) {
      const lead = w.activeAgents().find((x) => x.role === 'techlead') ?? w.activeAgents().find((x) => x.role === 'senior');
      if (lead) {
        this.enqueue('desk_visit', now + rand(6, 18), now + 60, 'normal', {
          initiatorId: a.id, targetId: lead.id, motiveKey: 'sales_promise', why: 'vừa chốt deal và lỡ hứa thêm tính năng cho khách',
        });
      }
    }
  }

  private evDrama(): void {
    const now = this.now();
    let r: Rumor | undefined = this.book.confrontable()[0];
    if (!r) {
      r = pick(this.book.all().filter((x) => x.active && x.heardBy.length >= 2));
      if (r) this.book.markLeaked(r.id);
    }
    if (r && this.confrontPick(r.id)) this.enqueue('confront', now, now + 60, 'high', { rumorId: r.id });
    else this.enqueue('gossip', now, now + 60, 'high', {});
    this.logEvent('🤫', 'Có biến! Văn phòng sắp có drama…', 'event', false);
  }

  private evRelease(note?: string): void {
    const w = this.world;
    const now = this.now();
    const name = note || cut(w.company()?.project?.name, 50) || 'dự án';
    this.pushDayEvent(`🚀 Release xong "${name}"`, true); // World đã ghi log release
    w.toast('🚀', `Release ${name}!`);
    for (const a of w.activeAgents()) if (isTech(a.role)) w.adjust(a.id, { mood: 6 });
    if (chance(0.7)) {
      this.enqueue('celebration', now + rand(2, 8), now + 90, 'normal', { reason: 'release', note: name });
    } else {
      this.enqueue('incident', now + rand(1, 4), now + 45, 'high', { reason: 'bug_prod', note: name });
      for (const a of w.activeAgents()) if (DEV_ROLES.includes(a.role)) w.adjust(a.id, { stress: 8 });
    }
    if (chance(0.5)) this.enqueue('company_chat', now + rand(1, 4), now + 30, 'low', { reason: 'release', note: name });
    this.setBoost('release', { note: name }, 45);
  }

  /** nút dev 📋 (v3): ép HR + sếp họp xét nhân sự ngay — AI (hoặc chính sách offline) quyết, hàng rào kiểm tra */
  private evHrReview(): void {
    const w = this.world;
    const now = this.now();
    const t = lowestPerformer(w);
    const last = t ? t.kpiHistory[t.kpiHistory.length - 1] : undefined;
    const kpiText = t
      ? (workdayElapsed(w.minuteOfDay()) < 0.15 && last ? `KPI hôm qua ${Math.round(last.ratio * 100)}%` : `KPI hôm nay ${kpiPct(t)}%`)
      : '';
    if (this.office?.type === 'hr_review' || this.queued('hr_review', (q) => q.data.force === '1')) {
      this.logEvent('⚖️', 'HR rà soát KPI: HR và sếp đang họp xét nhân sự rồi, chờ kết quả', 'hr', false);
      return;
    }
    this.queue = this.queue.filter((q) => q.type !== 'hr_review');
    this.enqueue('hr_review', now, now + 120, 'high', { note: t ? `${t.name} đang kém nhất (${kpiText})` : '', force: '1' });
    this.logEvent('⚖️', `HR rà soát KPI: mời sếp họp xét nhân sự ngay${t ? ` — ${t.name} (${kpiText}) đang bị để ý` : ''}`, 'hr', true);
  }

  /** nút dev 🗞️ (v3): ép một cảnh tám chuyện thời sự ngay (bỏ nhịp 25 phút) */
  private evNews(): void {
    const w = this.world;
    if (!this.newsEnabled) {
      w.toast('🗞️', 'Thời sự đang tắt (NEWS_ENABLED=false)');
      return;
    }
    if (!this.newsApi()) {
      w.toast('🗞️', 'Chưa có nguồn tin (module tin RSS chưa chạy hoặc chưa tải được bài nào)');
      return;
    }
    const now = this.now();
    this.queue = this.queue.filter((q) => q.type !== 'news_chat');
    this.enqueue('news_chat', now, now + 40, 'high', { force: '1' });
    this.logEvent('🗞️', 'Có tin nóng trên báo, văn phòng sắp bàn tán', 'event', false);
  }

  /** nút dev 🎬 (v3): ép AI biên kịch lên beat ngay */
  private evShowrunner(): void {
    const w = this.world;
    if (!this.showrunnerEnabled) {
      w.toast('🎬', 'AI biên kịch đang tắt (SHOWRUNNER_ENABLED=false)');
      return;
    }
    if (this.story.openArcs().length >= 2) {
      w.toast('🎬', 'Đang có 2 mạch truyện mở rồi, chờ một mạch kết đã');
      return;
    }
    this.planBeats(true);
    w.toast('🎬', 'Biên kịch đang nghĩ biến mới cho vài giờ tới…');
  }

  private onEndHook(s: Scene, res: SceneResult | null): void {
    if (s.news && s.type !== 'news_chat') this.afterNews(s); // tin len vào tám chuyện / ăn trưa cũng được lưu "đã bàn"
    switch (s.type) {
      case 'hr_warning': this.afterWarning(s); break;
      case 'firing': this.afterFiring(s); break;
      case 'interview': this.afterInterview(s, res); break;
      case 'incident': this.afterIncident(s); break;
      case 'boss_catch': this.afterCatch(s); break;
      case 'confront':
        if (s.meta.rumorId) {
          this.book.deactivate(s.meta.rumorId);
          this.emitRumors();
        }
        break;
      case 'boss_call':
        // v3: được sếp khen → tham vọng nhích lên một chút
        if (s.meta.reason === 'praise' && s.meta.targetId) {
          this.drift(s.meta.targetId, 'ambition', 0.02);
          this.ledger.lastPraiseDay[s.meta.targetId] = this.world.day();
        }
        break;
      // ---- v3
      case 'news_chat': this.afterNews(s); break;
      case 'hr_review': this.afterHrReview(s, res); break;
      case 'resign_talk': this.afterResignTalk(s, res); break;
      case 'raise_request': this.afterRaise(s, res); break;
      case 'promotion': this.afterPromotion(s); break;
      case 'layoff': this.afterLayoff(s); break;
      // ---- v5
      case 'crisis_meeting': this.afterCrisisMeeting(s, res); break;
      case 'pep_talk': this.afterPepTalk(s, res); break;
      default: break;
    }
  }

  private onAbortHook(s: Scene, _why: string): void {
    const w = this.world;
    if (s.type === 'interview') {
      if (s.meta.candidateId) this.dismissCandidate(s.meta.candidateId);
      this.requeueInterview(s.meta.vacancyRole);
      return;
    }
    if (!RETRY_TYPES.includes(s.type)) return;
    const retries = (s.meta.retries ?? 0) + 1;
    if (retries > 3 || w.minuteOfDay() >= 1000) return;
    const now = this.now();
    if (s.type === 'hr_review') {
      if (!this.queued('hr_review')) this.enqueue('hr_review', now + rand(10, 25), now + 150, 'high', { note: s.meta.note, retries, force: s.meta.force ? '1' : undefined });
      return;
    }
    if (!s.meta.targetId) return;
    const t = w.agent(s.meta.targetId);
    if (!hrEligible(t) || this.queued(s.type, (q) => q.data.targetId === t.id)) return;
    const data: QData = { targetId: t.id, retries };
    if (s.meta.newLabel) data.newLabel = s.meta.newLabel;
    if (s.meta.hint) data.hint = s.meta.hint;
    if (s.meta.arcId) data.arcId = s.meta.arcId;
    this.enqueue(s.type, now + rand(10, 25), now + 150, SCENE_DEFS[s.type].priority === 'high' ? 'high' : 'normal', data);
  }

  private afterWarning(s: Scene): void {
    const emp = s.meta.targetId ? this.world.agent(s.meta.targetId) : undefined;
    if (!emp) return;
    emp.warnings = fin(emp.warnings) + 1;
    this.counters.warnings++;
    this.ledger.lastWarnDay[emp.id] = this.world.day();
    const msg = `${emp.name} bị HR nhắc nhở KPI (lần ${emp.warnings})`;
    this.logEvent('⚠️', msg, 'hr', true);
    this.world.toast('⚠️', msg);
    this.archive('hr', `⚠️ ${msg}`, { id: emp.id, action: 'warn' });
    // v3: bị nhắc → chăm hơn một chút trong 3 ngày tới (tính cách trôi)
    this.planDrift(emp.id, 'diligence', 0.01, 3);
    this.setBoost('after_warning', { name: emp.name, id: emp.id }, 60);
    if (chance(0.6)) {
      const now = this.now();
      this.enqueue('group_chat', now + rand(2, 8), now + 40, 'low', { reason: 'after_warning', name: emp.name, aboutId: emp.id });
    }
  }

  private afterFiring(s: Scene): void {
    const w = this.world;
    const emp = s.meta.targetId ? w.agent(s.meta.targetId) : undefined;
    if (!emp || emp.status !== 'active') return;
    this.depart(emp, 'fired');
  }

  /**
   * v3: một người rời công ty — bị đuổi (KPI), bị cắt giảm (doanh thu) hay tự xin nghỉ. Dùng world.removeAgent(id, reason)
   * của sim engineer khi World đã là bản v3; chưa có thì fireAgent (ôm thùng đi ra cửa như cũ).
   */
  private depart(emp: AgentState, reason: 'fired' | 'laid_off' | 'resigned'): void {
    const w = this.world;
    const day = w.day();
    const streak = emp.lowStreak;
    const friends = w.activeAgents().filter((a) => a.id !== emp.id && relScore(a, emp.id) >= 25);
    const label = reason === 'fired' ? 'đã nghỉ việc' : reason === 'laid_off' ? 'đã bị cắt giảm' : 'đã xin nghỉ';
    this.departed.set(emp.id, {
      day,
      a: {
        ...emp, status: 'fired', present: false, sceneId: null, onPhone: false, path: [], activity: 'offsite',
        activityLabel: label, emote: reason === 'resigned' ? '👋' : '📦', relationships: { ...emp.relationships }, memories: [...emp.memories],
        kpiHistory: [...emp.kpiHistory],
      },
    });
    if (this.departed.size > 8) this.departed.delete(this.departed.keys().next().value!);
    if (!this.removeAgentV3(emp.id, reason)) return;
    for (const arc of this.story.arcsWith(emp.id)) this.story.drop(arc, day);
    this.firedToday.push(emp.name);
    this.rememberName(emp.name);
    const vac = vacancyFor(emp, day);
    const now = this.now();
    if (reason === 'fired' || reason === 'laid_off') this.ledger.lastFireDay = day; // cap 1 lần / 2 ngày tính từ lúc THẬT SỰ cho nghỉ
    if (reason === 'fired') {
      this.counters.firings++;
      w.toast('📦', `${emp.name} đã bị cho nghỉ việc`);
      // bị cho nghỉ qua họp xét (đã bị nhắc nhưng chưa có chuỗi ngày thấp) -> đừng ghi "sau 0 ngày KPI thấp"
      const why = streak >= 1 ? `sau ${streak} ngày KPI thấp`
        : emp.warnings >= 1 ? `vì KPI vẫn thấp sau ${emp.warnings} lần bị nhắc nhở` : 'vì KPI quá thấp';
      this.logEvent('📦', `${emp.name} (${emp.roleLabel}) đã bị cho nghỉ việc ${why}`, 'hr', true);
      for (const a of w.activeAgents()) if (a.id !== emp.id) w.addMemory(a.id, cut(`Ngày ${day}: ${emp.name} bị cho nghỉ việc vì KPI thấp`, 120));
      for (const f of friends) w.adjust(f.id, { mood: -6 });
      // vị trí trống → lịch phỏng vấn (14:00 hôm nay nếu còn sớm, không thì 09:45 mai); đang kỳ doanh thu kém thì chờ khá lên
      this.vacancies = [...this.vacancies.filter((v) => v.role !== vac.role || v.extra), vac];
      this.queue = this.queue.filter((q) => !(q.type === 'interview' && q.data.role === vac.role));
      if (!this.inSlump()) {
        const at = w.minuteOfDay() < 780 ? this.absFor(day, 840) : this.absFor(day + 1, 585);
        this.enqueue('interview', at, at + 240, 'high', { role: vac.role });
      } else {
        w.log({ kind: 'system', icon: '🧑‍💼', text: `Vị trí ${vac.roleLabel} để trống chờ doanh thu khá lên rồi mới tuyển` });
      }
      this.setBoost('after_firing', { name: emp.name, id: emp.id }, 120);
      this.enqueue('group_chat', now + rand(2, 6), now + 45, 'normal', { reason: 'after_firing', name: emp.name, aboutId: emp.id });
      if (chance(0.4)) this.enqueue('company_chat', now + rand(8, 20), now + 60, 'low', { reason: 'firing', name: emp.name, targetId: w.hr()?.id });
      this.archive('hr', `📦 ${emp.name} (${emp.roleLabel}) bị cho nghỉ việc ${why}`, { id: emp.id, action: 'fire' });
    } else if (reason === 'laid_off') {
      this.v3.layoffs++;
      w.toast('📉', `${emp.name} phải nghỉ vì công ty cắt giảm`);
      this.logEvent('📉', `${emp.name} (${emp.roleLabel}) rời công ty vì đợt cắt giảm nhân sự — không phải lỗi của ${emp.name}`, 'hr', true);
      for (const a of w.activeAgents()) {
        if (a.id !== emp.id) {
          w.addMemory(a.id, cut(`Ngày ${day}: ${emp.name} bị cắt giảm vì công ty khó khăn`, 120));
          w.adjust(a.id, { mood: -4, stress: 6 });
        }
      }
      for (const f of friends) w.adjust(f.id, { mood: -6 });
      // vai trò đóng băng ≥ 6 ngày VÀ chừng nào còn kỳ doanh thu kém (inSlump → sweep không mở lại vị trí); ghi sổ đợt cắt giảm (cap theo tháng)
      this.ledger.frozenRoles[emp.role] = day + 6;
      this.ledger.layoffDays = [...this.ledger.layoffDays, day].slice(-10);
      this.vacancies = this.vacancies.filter((v) => v.role !== emp.role || v.extra);
      this.queue = this.queue.filter((q) => !(q.type === 'interview' && q.data.role === emp.role));
      this.setBoost('after_layoff', { name: emp.name, id: emp.id }, 120);
      this.enqueue('group_chat', now + rand(2, 6), now + 45, 'normal', { reason: 'after_layoff', name: emp.name, aboutId: emp.id });
      if (chance(0.6)) this.enqueue('company_chat', now + rand(8, 20), now + 60, 'low', { reason: 'layoff', name: emp.name, targetId: w.hr()?.id });
      this.archive('hr', `📉 ${emp.name} (${emp.roleLabel}) bị cắt giảm`, { id: emp.id, action: 'layoff' });
    } else {
      this.v3.resigns++;
      w.toast('🚪', `${emp.name} đã nộp đơn nghỉ việc`);
      this.logEvent('🚪', `${emp.name} (${emp.roleLabel}) xin nghỉ việc và rời công ty ngay hôm nay`, 'hr', true);
      for (const a of w.activeAgents()) if (a.id !== emp.id) w.addMemory(a.id, cut(`Ngày ${day}: ${emp.name} tự xin nghỉ việc`, 120));
      for (const f of friends) w.adjust(f.id, { mood: -10 });
      // tuyển người thay sau 1–2 ngày (HR cần thời gian lọc CV); đang kỳ doanh thu kém thì để trống chờ khá lên
      this.vacancies = [...this.vacancies.filter((v) => v.role !== vac.role || v.extra), vac];
      this.queue = this.queue.filter((q) => !(q.type === 'interview' && q.data.role === vac.role));
      if (!this.inSlump()) {
        const at = this.absFor(day + (chance(0.5) ? 1 : 2), 585);
        this.enqueue('interview', at, at + 240, 'high', { role: vac.role });
      } else {
        w.log({ kind: 'system', icon: '🧑‍💼', text: `Vị trí ${vac.roleLabel} để trống chờ doanh thu khá lên rồi mới tuyển` });
      }
      this.setBoost('after_resign', { name: emp.name, id: emp.id }, 120);
      this.enqueue('group_chat', now + rand(2, 6), now + 45, 'normal', { reason: 'after_resign', name: emp.name, aboutId: emp.id });
      if (chance(0.5)) this.enqueue('company_chat', now + rand(10, 25), now + 60, 'low', { reason: 'resign', name: emp.name, targetId: w.hr()?.id });
      this.archive('resign', `🚪 ${emp.name} (${emp.roleLabel}) xin nghỉ việc`, { id: emp.id });
    }
  }

  private afterInterview(s: Scene, res: SceneResult | null): void {
    const w = this.world;
    const cand = s.meta.candidateId ? w.agent(s.meta.candidateId) : undefined;
    const role = s.meta.vacancyRole;
    const v = this.vacancies.find((x) => x.role === role);
    if (!cand || cand.status !== 'candidate') {
      this.requeueInterview(role);
      return;
    }
    const verdict = s.meta.forceHire ? 'hired' : res?.verdict ?? 'hired';
    const now = this.now();
    if (verdict === 'hired') {
      try {
        w.hireAgent(cand.id);
      } catch (e) {
        this.err('hireAgent', e);
        this.dismissCandidate(cand.id);
        this.requeueInterview(role);
        return;
      }
      this.counters.hires++;
      this.vacancies = this.vacancies.filter((x) => x !== v);
      this.hiredToday.push(cand.name);
      if (s.meta.forceHire && res?.verdict === 'rejected') {
        // thoại lỡ "trượt" nhưng đã loại 2 người rồi → HR đổi ý (biến thành tình tiết)
        this.logEvent('📞', `${w.hr()?.name ?? 'HR'} gọi lại: công ty đang thiếu người quá, nhận ${cand.name} luôn!`, 'hr', true);
      }
      w.toast('🎉', `Chào mừng ${cand.name} gia nhập!`);
      this.logEvent('🎉', `${cand.name} chính thức gia nhập công ty, vị trí ${cand.roleLabel}`, 'hr', true);
      this.enqueue('welcome', now + 30, now + 150, 'normal', { targetId: cand.id, note: v?.replacingName });
      this.setBoost('new_hire', { name: cand.name, id: cand.id }, 90);
      if (chance(0.6)) {
        this.enqueue('company_chat', now + rand(5, 15), now + 60, 'low', { reason: 'new_hire', name: cand.name, targetId: w.hr()?.id, centerId: cand.id });
      }
    } else {
      this.counters.rejections++;
      this.dismissCandidate(cand.id);
      if (v) v.rejections++;
      this.logEvent('🙅', `${cand.name} không qua vòng phỏng vấn — HR lại lọc CV tiếp`, 'hr', true);
      if (v && !this.inSlump()) {
        const at = this.absFor(w.day() + 1, 585);
        this.queue = this.queue.filter((q) => !(q.type === 'interview' && q.data.role === v.role));
        this.enqueue('interview', at, at + 240, 'high', { role: v.role });
      }
    }
  }

  private requeueInterview(role?: RoleKey): void {
    if (!role || !this.vacancies.some((v) => v.role === role)) return;
    if (this.queued('interview', (q) => q.data.role === role)) return;
    if (this.inSlump()) return; // kỳ doanh thu kém: vị trí chờ, sweep mở lại phỏng vấn khi khá lên
    const w = this.world;
    const at = w.minuteOfDay() < 930 ? this.now() + rand(25, 40) : this.absFor(w.day() + 1, 585);
    this.enqueue('interview', at, at + 240, 'high', { role });
  }

  private afterIncident(s: Scene): void {
    const w = this.world;
    if (s.meta.reason !== 'server_down' || w.company()?.incident !== 'server_down') return;
    const t = this.timers.find((x) => x.kind === 'clear_incident' && x.incident === 'server_down');
    const remain = clamp(t ? t.at - this.now() : 20, 5, 60);
    for (const id of s.participants) {
      const a = w.agent(id);
      if (a && a.status === 'active' && a.present && !a.sceneId) {
        w.setActivity(id, 'server_fix', remain, { label: 'đang cứu server', emote: '🔥' });
      }
    }
  }

  private afterCatch(s: Scene): void {
    const w = this.world;
    const v = s.meta.victimId ? w.agent(s.meta.victimId) : undefined;
    if (v) w.adjust(v.id, { stress: 6 });
    for (const id of s.participants) {
      const a = w.agent(id);
      if (a && id !== s.meta.victimId && a.role !== 'boss') a.caughtToday = fin(a.caughtToday) + 1;
    }
  }

  // ================================================================ v3 — World API mới (phòng thủ)
  private w3(): WorldV3 {
    return this.world as unknown as WorldV3;
  }

  /** World đã là bản v3 (sim engineer đã thêm ít nhất một API mới) */
  private worldIsV3(): boolean {
    const w = this.w3();
    return typeof w.setProbation === 'function' || typeof w.driftTrait === 'function' || typeof w.headcount === 'function' || typeof w.setRole === 'function';
  }

  /** rời công ty: removeAgent(id, reason) nếu World v3 có; không thì fireAgent (ôm thùng ra cửa). false = không làm được */
  private removeAgentV3(id: string, reason: string): boolean {
    const w = this.w3();
    try {
      if (this.worldIsV3() && typeof w.removeAgent === 'function') w.removeAgent(id, reason);
      else this.world.fireAgent(id);
      return true;
    } catch (e) {
      this.err('removeAgent', e);
      return false;
    }
  }

  private headcount(): number {
    const w = this.w3();
    try {
      if (typeof w.headcount === 'function') {
        const n = w.headcount();
        if (typeof n === 'number' && Number.isFinite(n)) return n;
      }
    } catch (e) {
      this.err('headcount', e);
    }
    return this.world.agents().filter((a) => a.status === 'active').length;
  }

  private setProbation(id: string, untilDay: number | null): void {
    const w = this.w3();
    try {
      if (typeof w.setProbation === 'function') w.setProbation(id, untilDay);
      else {
        const a = this.world.agent(id);
        if (a) a.probationUntilDay = untilDay === null ? undefined : untilDay;
      }
    } catch (e) {
      this.err('setProbation', e);
    }
  }

  /** thăng chức: World.setRole (tự tăng promotions); chưa có thì đổi tại chỗ và tự đếm */
  private setRole(id: string, roleLabel: string, kpiTarget: number): void {
    const w = this.w3();
    try {
      if (typeof w.setRole === 'function') w.setRole(id, roleLabel, kpiTarget);
      else {
        const a = this.world.agent(id);
        if (a) {
          a.roleLabel = roleLabel;
          if (Number.isFinite(kpiTarget) && kpiTarget > 0) a.kpiTarget = Math.round(kpiTarget);
          a.promotions = fin(a.promotions) + 1;
        }
      }
    } catch (e) {
      this.err('setRole', e);
    }
  }

  private grantBonus(id: string): void {
    const w = this.w3();
    try {
      if (typeof w.grantBonus === 'function') w.grantBonus(id);
      else {
        const a = this.world.agent(id);
        if (a) a.bonuses = fin(a.bonuses) + 1;
      }
    } catch (e) {
      this.err('grantBonus', e);
    }
  }

  /** tính cách trôi (bounded do World): chỉ khi STORY_TRAIT_DRIFT và World có driftTrait */
  private drift(id: string, trait: keyof Traits, delta: number): void {
    if (!this.traitDrift || !delta) return;
    const w = this.w3();
    if (typeof w.driftTrait !== 'function') return;
    try {
      w.driftTrait(id, trait, delta);
      this.v3.drifts++;
    } catch (e) {
      this.err('driftTrait', e);
    }
  }

  /** trôi dần trong N ngày (mỗi sáng một nhịp) */
  private planDrift(id: string, trait: keyof Traits, delta: number, days: number): void {
    if (!this.traitDrift) return;
    this.driftPlans = [...this.driftPlans.filter((p) => !(p.id === id && p.trait === trait)), { id, trait, delta, days }].slice(-30);
  }

  /**
   * Ghi bản ghi có cấu trúc vào archive (quyết định nhân sự, beat, tin đã bàn, xin nghỉ). Mọi dòng log thường World
   * đã tự lưu ('log') nên ở đây không lưu lại tóm tắt cảnh / sự kiện. No-op khi archive tắt.
   */
  private archive(kind: string, text: string, data?: unknown): void {
    const w = this.w3();
    try {
      const ar: ArchiveApi | null | undefined = typeof w.getArchive === 'function' ? w.getArchive() : archiveSingleton();
      if (!ar || typeof ar.record !== 'function') return;
      const extra = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : (data !== undefined ? { data } : {});
      ar.record(kind, { day: this.world.day(), minute: Math.floor(this.world.minuteOfDay()), text: cut(text, 300), ...extra });
      this.v3.archived++;
    } catch (e) {
      this.err('archive', e);
    }
  }

  // ================================================================ v3 — thời sự (news_chat)
  /** kho tin: World bọc (getNews) nếu có, không thì singleton src/news/store.ts */
  private newsApi(): NewsApi | null {
    const w = this.w3();
    try {
      const n = typeof w.getNews === 'function' ? w.getNews() : newsSingleton();
      return n && typeof n.pick === 'function' ? n : null;
    } catch (e) {
      this.err('getNews', e);
      return null;
    }
  }

  /** nhóm tin đang bật (giải trí có công tắc riêng) */
  private newsCats(): NewsCategory[] {
    return NEWS_CATEGORIES.filter((c) => c !== 'giai_tri' || this.newsAllowShowbiz);
  }

  /** tin hợp lệ để bàn: đủ trường, chưa dùng, không quá hạn, không dính từ chặn (lớp bảo hiểm thứ hai) */
  private validNews(n: unknown): n is NewsItem {
    if (!n || typeof n !== 'object') return false;
    const x = n as Partial<NewsItem>;
    if (typeof x.id !== 'string' || !x.id || typeof x.title !== 'string' || !x.title.trim() || typeof x.url !== 'string' || !/^https?:\/\//i.test(x.url)) return false;
    if (typeof x.category !== 'string' || !(NEWS_CATEGORIES as string[]).includes(x.category)) return false;
    if (x.category === 'giai_tri' && !this.newsAllowShowbiz) return false;
    if (this.newsUsed.includes(x.id)) return false;
    if (typeof x.publishedAt === 'number' && Number.isFinite(x.publishedAt) && x.publishedAt > 0 && this.newsMaxAgeDays > 0
      && Date.now() - x.publishedAt > this.newsMaxAgeDays * 86_400_000) return false;
    if (newsBlocked(`${x.title} ${x.summary ?? ''}`)) return false;
    return true;
  }

  /** lấy 1 tin (không đánh dấu đã dùng) */
  private peekNews(cats: NewsCategory[]): NewsItem | null {
    const api = this.newsApi();
    if (!api || !cats.length) return null;
    try {
      for (let i = 0; i < 3; i++) {
        const n = api.pick(cats, new Set(this.newsUsed));
        if (!n) return null;
        if (this.validNews(n)) {
          return {
            id: n.id, title: cut(n.title, 160), summary: cut(n.summary ?? '', 200), source: cut(n.source ?? 'báo', 40), url: n.url,
            category: n.category, publishedAt: fin(n.publishedAt, 0),
          };
        }
        // tin không hợp lệ (dính từ chặn / thiếu trường) → coi như đã dùng để không bị trả lại nữa
        if (typeof (n as { id?: unknown }).id === 'string') this.newsUsed = [...this.newsUsed, (n as { id: string }).id].slice(-NEWS_USED_KEEP);
      }
    } catch (e) {
      this.err('news.pick', e);
    }
    return null;
  }

  private markNewsUsed(n: NewsItem): void {
    this.newsUsed = [...this.newsUsed.filter((x) => x !== n.id), n.id].slice(-NEWS_USED_KEEP);
    this.discussedNews = [...this.discussedNews.filter((x) => x.id !== n.id), newsRefOf(n)].slice(-NEWS_DISCUSSED_KEEP);
    const api = this.newsApi();
    try {
      if (api && typeof api.markUsed === 'function') api.markUsed(n.id);
    } catch (e) {
      this.err('news.markUsed', e);
    }
  }

  /** lịch news_chat: xoay vòng nhóm tin, chọn người hợp sở thích; văn phòng (pantry/góc chill) hay nhóm chat kín tuỳ slot */
  private dNews(q: QItem): Draft | null | 'drop' {
    const w = this.world;
    if (!this.newsEnabled) return 'drop';
    const force = q.data.force === '1';
    if (!force && this.clockMs - this.lastNewsAt < this.newsMinMsVal) return null; // chờ hết nhịp; hết cửa sổ thì mục tự rơi
    if (!this.newsApi()) return 'drop';
    const online = q.data.channel === 'group';
    const cats = this.newsCats();
    if (!cats.length) return 'drop';
    for (let i = 0; i < cats.length; i++) {
      const idx = (this.newsCatIdx + i) % cats.length;
      const item = this.peekNews([cats[idx]]);
      if (!item) continue;
      const people = pickNewsGroup(w, (a) => this.free(a, force ? 'high' : 'normal'), item.category, { online });
      if (!people) continue;
      this.newsCatIdx = (idx + 1) % cats.length;
      const ids = people.map((p) => p.id);
      if (online) {
        return {
          type: 'news_chat',
          channel: 'group',
          participants: ids,
          locationLabel: GROUP_CHAT_LABEL,
          sit: (ps) => sitNewsChat(this.kit(), ps, item, GROUP_CHAT_LABEL, true),
          topicCats: [],
          news: item,
          meta: { newsId: item.id },
          minPeople: 2,
        };
      }
      return {
        type: 'news_chat',
        participants: ids,
        joint: { ids, groups: shuffle(['pantry_table', 'lounge', 'window']) },
        locationLabel: SPOT_LABELS.pantry_table,
        sit: (ps, label) => sitNewsChat(this.kit(), ps, item, label, false),
        topicCats: [],
        news: item,
        meta: { newsId: item.id },
        minPeople: 2,
      };
    }
    // không có tin / không đủ người hợp → thử lại ở lượt sau (mục rơi khi hết cửa sổ); nút dev ép thì báo
    if (force) {
      w.toast('🗞️', 'Chưa có tin mới hợp lệ (đã bàn hết hoặc bị lọc), thử lại sau nhé');
      return 'drop';
    }
    return null;
  }

  private afterNews(s: Scene): void {
    if (!s.news) return;
    this.archive('news', `🗞️ ${s.news.title} (${s.news.source})`, { ...s.news, participants: s.participants });
  }

  // ================================================================ v3 — HR do AI quyết (hr_review) + hàng rào
  private guardEnv(): GuardEnv {
    const w = this.world;
    const live = this.office;
    return {
      day: w.day(),
      headcount: this.headcount(),
      hasOpenPosition: this.vacancies.length > 0,
      freeDesk: freeDesks(w, this.vacancies).length > 0,
      revenueRatio: revenueRatio(w),
      firePending: this.queued('firing') || this.queued('layoff') || (!!live && !live.ended && (live.type === 'firing' || live.type === 'layoff')),
      promotionPending: this.queued('promotion') || (!!live && !live.ended && live.type === 'promotion'),
    };
  }

  /** đang kỳ doanh thu kém: đã có kỳ xét < 50% nhịp hoặc vùng doanh thu hiện tại là "low" → không tuyển thêm / tuyển thay */
  private inSlump(): boolean {
    return this.ledger.lowRevenuePeriods >= 1 || revenueZone(revenueRatio(this.world)) === 'low';
  }

  /** cuối ngày: cập nhật ngày buồn, tính cách trôi theo chuyện sếp vắng, và lên lịch họp xét sớm nếu có lý do */
  private endOfDayHr(day: number): void {
    const w = this.world;
    const now = this.now();
    if (this.bossLeftAt !== null) {
      this.bossAwayMin += Math.max(0, now - this.bossLeftAt);
      this.bossLeftAt = null;
    }
    const boss = w.boss();
    for (const a of w.agents()) {
      if (!hrEligible(a)) continue;
      // "ngày chán việc": tâm trạng thấp cuối ngày, stress cao, ghét sếp, hoặc đã bị nhắc mà KPI vẫn thấp (mood đêm nào cũng hồi về 60
      // nên ngưỡng 25 không bao giờ chạm → cảnh xin nghỉ không bao giờ xảy ra)
      const bossScore = boss ? relScore(a, boss.id) : 0;
      const unhappy = fin(a.mood, 60) < 40 || fin(a.stress, 30) > 70 || bossScore <= -20 || (fin(a.warnings) >= 1 && fin(a.lowStreak) >= 1);
      this.ledger.lowMoodDays[a.id] = unhappy ? (this.ledger.lowMoodDays[a.id] ?? 0) + 1 : 0;
      // sếp vắng ≥ 3 giờ mà không bị bắt lần nào → lười thêm một chút
      if (this.bossAwayMin >= 180 && fin(a.caughtToday) === 0) this.drift(a.id, 'laziness', 0.01);
    }
    const triggers = reviewTriggers(w, this.ledger);
    // doanh thu: chỉ họp sớm khi vùng đổi (rơi xuống < 50% / vượt > 120% nhịp) — ngày 1–2 chưa xét
    const rev = day >= 2 ? revenueTrigger(w, this.ledger) : null;
    if (rev) triggers.push(rev);
    const periodic = (day + 1) % this.hrReviewEveryDays === 0;
    if (triggers.length && !periodic && !this.queued('hr_review')) {
      const at = this.absFor(day + 1, randInt(600, 645));
      this.enqueue('hr_review', at, at + 150, 'high', { note: triggers.join('; ') });
      const hrName = w.hr()?.name ?? 'HR';
      w.log({ kind: 'hr', text: `Sổ của ${hrName}: sáng mai họp sếp xét nhân sự sớm — ${cut(triggers.join('; '), 120)}`, icon: '📒' });
    }
  }

  /** sáng: xin nghỉ (buồn ≥ 3 ngày & ghét sếp) / xin tăng lương (KPI cao & tham vọng) — mỗi loại tối đa 1 người/ngày */
  private planStoryScenes(day: number, at: (m: number) => number): void {
    const w = this.world;
    const boss = w.boss();
    const now = this.now();
    const add = (type: SceneType, m: number, window: number, prio: Priority, data: QData) => {
      const a = at(m);
      if (a + window > now) this.enqueue(type, Math.max(a, now), a + window, prio, data);
    };
    const staff = shuffle(w.agents().filter((a) => hrEligible(a)));
    let resign = false, raise = false;
    for (const a of staff) {
      const lowMood = this.ledger.lowMoodDays[a.id] ?? 0;
      const bossScore = boss ? relScore(a, boss.id) : 0;
      // chán việc ≥ 2 ngày và (ghét sếp / đã bị nhắc / tâm trạng thấp) → 35% xin gặp HR (không bao giờ chắc chắn)
      if (!resign && lowMood >= 2 && (bossScore <= -15 || fin(a.warnings) >= 1 || fin(a.mood, 60) < 45)
        && day - (this.ledger.lastResignTalkDay[a.id] ?? -99) >= 5 && !this.queued('resign_talk') && chance(0.35)) {
        resign = true;
        this.ledger.lastResignTalkDay[a.id] = day;
        const why = bossScore <= -15 ? 'không hợp với sếp' : fin(a.warnings) >= 1 ? 'bị nhắc KPI, thấy bị soi' : 'tâm trạng tệ kéo dài';
        add('resign_talk', randInt(600, 900), 120, 'high', { targetId: a.id, hint: `chán việc ${lowMood} ngày liền, ${why}` });
      }
      const avg = avgRatio(a, 7);
      if (!raise && avg !== null && avg >= 1.1 && fin(a.traits?.ambition) >= 0.6 && day - (this.ledger.lastRaiseAskDay[a.id] ?? -99) >= 10
        && !this.queued('raise_request') && chance(0.5)) {
        raise = true;
        this.ledger.lastRaiseAskDay[a.id] = day;
        add('raise_request', randInt(630, 960), 120, 'normal', { targetId: a.id });
      }
    }
  }

  /** HR + sếp họp trong phòng Giám đốc; hồ sơ (allowed theo hàng rào) dựng ngay lúc dựng cảnh */
  private dHrReview(triggersNote?: string, force = false, retries = 0): Draft | null | 'drop' {
    const w = this.world;
    const day = w.day();
    const hr = w.hr();
    const boss = w.boss();
    if (!hr || hr.status !== 'active') return 'drop';
    if (!force && this.ledger.lastReviewDay === day) return 'drop'; // mỗi ngày tối đa 1 lần họp
    if (!boss || boss.status !== 'active' || !boss.present || w.bossAway() || !this.free(boss, 'high') || !this.free(hr, 'high')) return null;
    // kỳ xét doanh thu: các kỳ cách nhau ≥ HR_REVIEW_EVERY_DAYS (họp sớm liên tiếp không tính thành nhiều kỳ)
    if (day - this.ledger.lastRevenueCheckDay >= this.hrReviewEveryDays) {
      this.ledger.lastRevenueCheckDay = day;
      this.ledger.lowRevenuePeriods = revenueRatio(w) < 0.5 ? this.ledger.lowRevenuePeriods + 1 : 0;
    }
    const dossier = buildDossier(w, this.cfg, this.ledger, this.guardEnv());
    if (!dossier.length) return 'drop';
    const triggers = (triggersNote ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    const trig = triggers.length ? triggers : reviewTriggers(w, this.ledger);
    return {
      type: 'hr_review',
      participants: [hr.id, boss.id],
      place: { [hr.id]: { how: 'spot', group: 'boss_visit' }, [boss.id]: { how: 'seat' } },
      locationLabel: SPOT_LABELS.boss_visit,
      sit: () => sitHrReview(this.kit(), hr, boss, dossier, trig),
      topicCats: [],
      hrDossier: dossier,
      meta: { note: trig.join('; '), retries, force },
      labels: { [hr.id]: { label: 'đang họp xét nhân sự', emote: '⚖️' }, [boss.id]: { label: 'đang họp với HR', emote: '⚖️' } },
      minPeople: 2,
    };
  }

  private afterHrReview(s: Scene, res: SceneResult | null): void {
    const w = this.world;
    const day = w.day();
    const dossier = s.req.hrDossier ?? [];
    this.ledger.reviews++;
    this.ledger.lastReviewDay = day;
    this.v3.hrReviews++;
    const rr = revenueRatio(w);
    // AI quyết (llm) → dùng (sanitize đã lọc theo allowed, ở đây lọc lại). Không có AI → chính sách offline của Director
    // (ngẫu nhiên có trọng số leo thang quanh KPI_WARN_DAYS / KPI_FIRE_DAYS) — thoại mẫu offline chỉ là lời dẫn.
    let raw: unknown;
    let source: 'llm' | 'offline' = 'offline';
    if (res && res.source === 'llm') {
      // AI đã viết cảnh → quyết định là của AI (thiếu / sai dạng = "chưa động tới ai"), không bao giờ rơi về chính sách offline ngẫu nhiên
      raw = Array.isArray(res.hrDecisions) ? res.hrDecisions : [];
      source = 'llm';
    } else {
      raw = offlineDecisions(dossier, this.cfg, { revenueRatio: rr, idleReviews: this.ledger.idleReviews });
    }
    const { applied, rejected } = validateDecisions(raw, dossier);
    const hrName = w.hr()?.name ?? 'HR';
    // AI đề xuất hành động ngoài "được phép" → sanitize đã đổi thành none nhưng để dấu vết trong reason; thoại đã hứa nên phải kể lại
    if (source === 'llm' && Array.isArray(raw)) {
      for (const d of raw as HrDecision[]) {
        const m = d && d.action === 'none' && typeof d.reason === 'string' ? /^ngoài hàng rào \((\w+)\)/.exec(d.reason) : null;
        if (!m || !(m[1] in ACTION_LABEL)) continue;
        this.ledger.rejected++;
        this.v3.decisionsRejected++;
        const who = d.id ? w.agent(d.id)?.name ?? d.id : 'công ty';
        this.logEvent('⚖️', `${hrName} ghi sổ: sếp đổi ý về "${ACTION_LABEL[m[1] as HrAction]}" cho ${who} — chưa đủ căn cứ theo hàng rào, để kỳ sau`, 'hr', false);
      }
    }
    for (const r of rejected) {
      this.ledger.rejected++;
      this.v3.decisionsRejected++;
      const who = r.d.id ? w.agent(r.d.id)?.name ?? r.d.id : 'công ty';
      // người xem đã nghe lời hứa trong thoại → kể rõ vì sao không thành (sổ và chuyện kể khớp nhau)
      this.logEvent('⚖️', `${hrName} ghi sổ: sếp đổi ý về "${ACTION_LABEL[r.d.action]}" cho ${who} — để kỳ sau (${r.why})`, 'hr', false);
    }
    if (!applied.length) {
      this.ledger.idleReviews++;
      this.logEvent('⚖️', `Họp xét nhân sự xong: ${hrName} và sếp thống nhất chưa động tới ai`, 'hr', true);
      this.archive('hr', '⚖️ Họp xét nhân sự: không có quyết định', { decisions: [], source });
      return;
    }
    const done: HrDecision[] = [];
    for (const d of applied) {
      try {
        if (this.applyDecision(d, dossier, source)) done.push(d);
      } catch (e) {
        this.err(`decision:${d.action}`, e);
      }
    }
    this.ledger.idleReviews = done.length ? 0 : this.ledger.idleReviews + 1;
    this.ledger.decisions += done.length;
    this.v3.decisionsApplied += done.length;
    // bản ghi của CUỘC HỌP (điều đã chốt); cho nghỉ / cắt giảm / thăng chức có bản ghi riêng khi cảnh thi hành xong (depart / afterPromotion)
    this.archive('hr', `⚖️ Chốt họp xét nhân sự: ${done.map((d) => `${ACTION_LABEL[d.action]} ${d.id ? w.agent(d.id)?.name ?? d.id : ''}`.trim()).join(', ')}`,
      { decisions: done, source, pending: done.filter((d) => d.action === 'fire' || d.action === 'layoff' || d.action === 'promote').map((d) => d.id) });
  }

  /** thi hành 1 quyết định đã qua hàng rào (kiểm tra lại lần nữa với trạng thái hiện tại). true = đã thi hành */
  private applyDecision(d: HrDecision, dossier: HrDossierEntry[], source: 'llm' | 'offline'): boolean {
    const w = this.world;
    const day = w.day();
    const now = this.now();
    const env = this.guardEnv();
    const a = d.id ? w.agent(d.id) : undefined;
    const entry = dossier.find((x) => x.id === d.id);
    const reason = d.reason ? ` — ${cut(d.reason, 120)}` : '';
    if (d.action !== 'open_position') {
      if (!a || !hrEligible(a)) return false;
      // hàng rào lần hai với số liệu lúc này (có thể đổi trong lúc họp): không hợp thì gác lại
      const nowAllowed = allowedActions(a, this.cfg, this.ledger, env);
      if (!nowAllowed.includes(d.action)) {
        this.v3.decisionsRejected++;
        w.log({ kind: 'system', icon: '⚖️', text: `Đề xuất "${ACTION_LABEL[d.action]}" cho ${a.name} bị gác lại: tình hình đã đổi, chưa đủ căn cứ` });
        return false;
      }
    } else if (!env.revenueRatio || env.revenueRatio < 0.8 || env.headcount >= 12 || env.hasOpenPosition) {
      return false;
    }
    // ảnh chụp TRƯỚC khi thi hành (sổ chưa đổi) — test kiểm tra hàng rào độc lập; chỉ gọi móc khi quyết định thật sự được thi hành
    const info: DecisionInfo = {
      day, decision: { ...d }, allowed: entry ? [...entry.allowed] : (a ? allowedActions(a, this.cfg, this.ledger, env) : ['none', 'open_position']),
      source, env,
      ledger: {
        lastFireDay: this.ledger.lastFireDay, lastPromotionDay: this.ledger.lastPromotionDay, lowRevenuePeriods: this.ledger.lowRevenuePeriods,
        lastBonusDay: a ? this.ledger.lastBonusDay[a.id] ?? -99 : -99, lastBonusAnyDay: this.ledger.lastBonusAnyDay, layoffsInMonth: layoffsInMonth(this.ledger, day),
      },
      agent: a ? {
        id: a.id, lowStreak: fin(a.lowStreak), warnings: fin(a.warnings), hiredDay: fin(a.hiredDay, 1),
        onProbation: typeof a.probationUntilDay === 'number' && a.probationUntilDay > day,
        ratios: a.kpiHistory.slice(-7).map((h) => fin(h.ratio)), avg7: avgRatio(a, 7), kpiFireDays: fin(this.cfg.kpiFireDays, 3),
      } : null,
    };
    const ok = this.executeDecision(d, a, env, reason);
    if (ok && this.hooks.decision) {
      try {
        this.hooks.decision(info);
      } catch (e) {
        this.err('hooks.decision', e);
      }
    }
    return ok;
  }

  private executeDecision(d: HrDecision, a: AgentState | undefined, env: GuardEnv, reason: string): boolean {
    const w = this.world;
    const day = w.day();
    const now = this.now();
    const hrName = w.hr()?.name ?? 'HR';
    const name = a?.name ?? '';
    switch (d.action) {
      case 'warn': {
        this.queue = this.queue.filter((q) => !(q.type === 'hr_warning' && q.data.targetId === a!.id));
        this.enqueue('hr_warning', now + rand(5, 20), now + 150, 'high', { targetId: a!.id });
        this.logEvent('⚖️', `Chốt sau họp: ${hrName} sẽ nhắc nhở KPI ${name}${reason}`, 'hr', true);
        break;
      }
      case 'fire': {
        // lastFireDay ghi ở depart() — khi cảnh cho nghỉ THẬT SỰ diễn xong (cảnh không diễn được thì hoãn sang mai, không ăn cap)
        this.queue = this.queue.filter((q) => !((q.type === 'firing' || q.type === 'hr_warning') && q.data.targetId === a!.id));
        this.enqueue('firing', now + rand(10, 30), now + 150, 'high', { targetId: a!.id });
        this.logEvent('⚖️', `Chốt sau họp: cho ${name} nghỉ việc${reason}`, 'hr', true);
        break;
      }
      case 'layoff': {
        this.queue = this.queue.filter((q) => !((q.type === 'layoff' || q.type === 'firing') && q.data.targetId === a!.id));
        this.enqueue('layoff', now + rand(10, 30), now + 150, 'high', { targetId: a!.id });
        this.logEvent('⚖️', `Chốt sau họp: công ty cắt giảm vị trí của ${name} vì doanh thu kém${reason}`, 'hr', true);
        break;
      }
      case 'probation': {
        const until = day + 5;
        this.setProbation(a!.id, until);
        w.adjust(a!.id, { mood: -6, stress: 8 });
        w.addMemory(a!.id, cut(`Bị đưa vào diện thử thách KPI tới ngày ${until}`, 120));
        this.logEvent('⏳', `${name} bị đưa vào diện thử thách KPI 5 ngày${reason}`, 'hr', true);
        const hr = w.hr();
        if (hr) {
          this.enqueue('desk_visit', now + rand(5, 20), now + 90, 'normal', {
            initiatorId: hr.id, targetId: a!.id, motiveKey: 'hr_probe', why: `báo quyết định thử thách KPI 5 ngày (${cut(d.reason, 60) || 'KPI thấp'})`,
          });
        }
        this.setBoost('after_probation', { name, id: a!.id }, 60);
        this.archive('hr', `⏳ ${name} vào diện thử thách tới ngày ${until}`, { id: a!.id, action: 'probation' });
        break;
      }
      case 'second_chance': {
        w.adjust(a!.id, { mood: 5, stress: -4 });
        w.addMemory(a!.id, cut(`${hrName} nói đã bênh mình trong cuộc họp, cho thêm cơ hội`, 120));
        this.logEvent('🤲', `${hrName} xin sếp cho ${name} thêm cơ hội${reason}`, 'hr', true);
        this.archive('hr', `🤲 ${name} được cho cơ hội thứ hai`, { id: a!.id, action: 'second_chance' });
        break;
      }
      case 'praise': {
        this.ledger.lastPraiseDay[a!.id] = day;
        this.queue = this.queue.filter((q) => !(q.type === 'boss_call' && q.data.targetId === a!.id));
        this.enqueue('boss_call', now + rand(5, 25), now + 120, 'normal', { reason: 'praise', targetId: a!.id, note: cut(d.reason, 80) });
        this.logEvent('⚖️', `Chốt sau họp: sếp sẽ gọi ${name} lên khen${reason}`, 'hr', true);
        break;
      }
      case 'bonus': {
        this.ledger.lastBonusDay[a!.id] = day;
        this.ledger.lastBonusAnyDay = day; // không thưởng 2 người cùng tuần (docs/v3-news.md)
        this.grantBonus(a!.id);
        w.adjust(a!.id, { mood: 12, stress: -6 });
        w.addMemory(a!.id, cut(`Được thưởng nóng vì KPI xuất sắc (${cut(d.reason, 60) || 'làm tốt'})`, 120));
        w.toast('💰', `${name} được thưởng nóng!`);
        this.logEvent('💰', `${name} được thưởng nóng vì KPI xuất sắc${reason}`, 'hr', true);
        this.drift(a!.id, 'ambition', 0.02);
        this.enqueue('celebration', now + rand(10, 30), now + 90, 'normal', { reason: 'bonus', centerId: a!.id });
        if (chance(0.5)) this.enqueue('company_chat', now + rand(2, 8), now + 40, 'low', { reason: 'bonus', name, targetId: a!.id });
        this.archive('hr', `💰 ${name} được thưởng nóng`, { id: a!.id, action: 'bonus' });
        break;
      }
      case 'promote': {
        // lastPromotionDay ghi ở afterPromotion() khi cảnh công bố diễn xong
        const newLabel = promotedLabel(a!);
        this.queue = this.queue.filter((q) => !(q.type === 'promotion' && q.data.targetId === a!.id));
        this.enqueue('promotion', now + rand(10, 40), now + 150, 'high', { targetId: a!.id, newLabel });
        this.logEvent('⚖️', `Chốt sau họp: thăng chức ${name} lên ${newLabel}${reason}`, 'hr', true);
        break;
      }
      case 'open_position': {
        const desks = freeDesks(w, this.vacancies);
        if (!desks.length) {
          w.log({ kind: 'system', icon: '⚖️', text: 'Muốn mở thêm vị trí nhưng văn phòng hết bàn trống → tạm gác' });
          return false;
        }
        const v = extraVacancy(w, pick(desks)!, day);
        if (!v) return false;
        this.vacancies = [...this.vacancies, v];
        const at = w.minuteOfDay() < 780 ? this.absFor(day, 840) : this.absFor(day + 1, 585);
        this.enqueue('interview', at, at + 240, 'high', { role: v.role });
        this.logEvent('🧑‍💼', `Công ty mở thêm vị trí ${v.roleLabel}${reason}`, 'hr', true);
        this.archive('hr', `🧑‍💼 Mở thêm vị trí ${v.roleLabel}`, { action: 'open_position', role: v.role });
        break;
      }
      default:
        return false;
    }
    return true;
  }

  // ================================================================ v3 — xin nghỉ / xin tăng lương / thăng chức / cắt giảm
  private dResignTalk(emp: AgentState, hint?: string, retries = 0): Draft | null {
    const w = this.world;
    const hr = w.hr();
    if (!hr || hr.status !== 'active' || hr.id === emp.id || !this.free(hr, 'high') || !this.free(emp, 'high')) return null;
    const boss = w.boss();
    const info = { lowMoodDays: this.ledger.lowMoodDays[emp.id] ?? 0, bossScore: boss ? relScore(emp, boss.id) : 0, hint };
    return {
      type: 'resign_talk',
      participants: [hr.id, emp.id],
      place: { [hr.id]: { how: 'spot', group: 'meeting' }, [emp.id]: { how: 'spot', group: 'meeting' } },
      locationLabel: SPOT_LABELS.meeting,
      sit: () => sitResignTalk(this.kit(), hr, emp, info),
      topicCats: [],
      meta: { targetId: emp.id, hint, retries },
      labels: { [hr.id]: { label: 'đang nói chuyện riêng', emote: '🚪' } },
      title: `${emp.name} nói chuyện xin nghỉ với ${hr.name}`,
    };
  }

  private dRaiseRequest(emp: AgentState, retries = 0): Draft | null {
    const w = this.world;
    const boss = w.boss();
    if (!boss || boss.status !== 'active' || !boss.present || w.bossAway() || !this.free(boss, 'normal') || !this.free(emp, 'normal')) return null;
    const avg = avgRatio(emp, 7) ?? 1;
    const info = { avgPct: Math.round(avg * 100), revenuePct: Math.round(revenueRatio(w) * 100), askedBefore: (this.ledger.raiseDeniedDay[emp.id] ?? -99) > 0 };
    return {
      type: 'raise_request',
      participants: [boss.id, emp.id],
      place: { [boss.id]: { how: 'seat' }, [emp.id]: { how: 'spot', group: 'boss_visit' } },
      locationLabel: SPOT_LABELS.boss_visit,
      sit: () => sitRaiseRequest(this.kit(), boss, emp, info),
      topicCats: [],
      meta: { targetId: emp.id, retries },
      labels: { [boss.id]: { label: 'đang nghe xin tăng lương', emote: '💵' } },
      title: `${emp.name} xin tăng lương`,
    };
  }

  private dPromotion(emp: AgentState, newLabel?: string, retries = 0): Draft | null {
    const w = this.world;
    const hr = w.hr();
    if (!hr || hr.status !== 'active' || hr.id === emp.id || !this.free(hr, 'high') || !this.free(emp, 'high')) return null;
    const boss = w.boss();
    const withBoss = !!boss && boss.status === 'active' && boss.present && !w.bossAway() && this.free(boss, 'high');
    const label = newLabel || promotedLabel(emp);
    const friend = w.activeAgents().filter((x) => x.id !== emp.id && x.role !== 'boss' && x.role !== 'hr' && this.free(x, 'high'))
      .sort((x, y) => relScore(y, emp.id) - relScore(x, emp.id))[0];
    const others = friend && chance(0.6) ? [friend] : [];
    const ids = [...(withBoss && boss ? [boss.id] : []), hr.id, emp.id, ...others.map((o) => o.id)];
    const place: Record<string, Placement> = { [hr.id]: { how: 'spot', group: 'boss_visit' }, [emp.id]: { how: 'spot', group: 'boss_visit' } };
    if (withBoss && boss) place[boss.id] = { how: 'seat' };
    for (const o of others) place[o.id] = { how: 'spot', group: 'boss_visit', optional: true };
    return {
      type: 'promotion',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.boss_visit,
      sit: (people) => sitPromotion(this.kit(), withBoss && boss ? boss : null, hr, emp, label, people.filter((p) => others.some((o) => o.id === p.id))),
      topicCats: [],
      meta: { targetId: emp.id, newLabel: label, retries },
      labels: Object.fromEntries(ids.filter((id) => id !== emp.id).map((id) => [id, { label: 'đang công bố thăng chức', emote: '🎖️' }])),
      title: `${emp.name} được thăng chức`,
      minPeople: 2,
    };
  }

  private dLayoff(emp: AgentState, retries = 0): Draft | null {
    const w = this.world;
    const hr = w.hr();
    if (!hr || hr.status !== 'active' || hr.id === emp.id || !this.free(hr, 'high') || !this.free(emp, 'high')) return null;
    const boss = w.boss();
    const withBoss = !!boss && boss.status === 'active' && boss.present && !w.bossAway() && this.free(boss, 'high');
    const ids = withBoss && boss ? [boss.id, hr.id, emp.id] : [hr.id, emp.id];
    const place: Record<string, Placement> = { [hr.id]: { how: 'spot', group: 'boss_visit' }, [emp.id]: { how: 'spot', group: 'boss_visit' } };
    if (withBoss && boss) place[boss.id] = { how: 'seat' };
    const info = { revenuePct: Math.round(revenueRatio(w) * 100), periods: this.ledger.lowRevenuePeriods };
    return {
      type: 'layoff',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.boss_visit,
      sit: () => sitLayoff(this.kit(), withBoss && boss ? boss : null, hr, emp, info),
      topicCats: [],
      meta: { targetId: emp.id, retries },
      labels: Object.fromEntries(ids.filter((id) => id !== emp.id).map((id) => [id, { label: 'đang thông báo cắt giảm', emote: '📉' }])),
      minPeople: 2,
    };
  }

  // ================================================================ v5 — tình huống công ty: họp xử lý, công tác tư tưởng
  /** có mặt, đang làm, rảnh cho cảnh mức `prio` */
  private avail(a: AgentState | undefined, prio: Priority = 'high'): a is AgentState {
    return !!a && a.status === 'active' && a.present && !a.hidden && this.free(a, prio);
  }

  /**
   * crisis_meeting: chủ trì = sếp (có mặt, không đi vắng), không thì HR; thêm ≤ 3 người theo vai của tình huống
   * (+ người trong cuộc nếu tình huống cần). Phương án đưa ra bàn = plansFor(tình hình); chọn sẵn 1 phương án dự phòng.
   */
  private dCrisisMeeting(q: QItem): Draft | null | 'drop' {
    const w = this.world;
    const arc = this.story.arcById(q.data.arcId);
    const def = arc ? situationDef(arc.kind) : undefined;
    if (!arc || !def || arc.plan || arc.status === 'resolved' || arc.status === 'dropped') return 'drop';
    const boss = w.boss();
    const hr = w.hr();
    const chair = this.avail(boss) && !w.bossAway() ? boss : this.avail(hr) ? hr : undefined;
    if (!chair) return null;
    const center = def.meeting.withCenter && arc.a ? w.agent(arc.a) : undefined;
    if (center && !this.avail(center)) return null;
    const members: AgentState[] = [];
    for (const role of def.meeting.roles) {
      if (members.length >= 3) break;
      // người trong cuộc (bị câu, gặp chuyện riêng, hai phe…) không ngồi họp bàn về chính mình — trừ khi tình huống gọi vào (center)
      const m = w.activeAgents().find((x) => x.role === role && x.id !== chair.id && x.id !== center?.id && x.id !== arc.a && x.id !== arc.b
        && !members.includes(x) && this.avail(x));
      if (m) members.push(m);
    }
    if (!members.length && !center) return null;
    const A = arc.a ? w.agent(arc.a) : undefined;
    const B = arc.b ? w.agent(arc.b) : undefined;
    const fill = (t: string) => fillSit(t, { a: A?.name, b: B?.name, boss: boss?.name });
    const plans = plansFor(def, sitWorldOf(w));
    const pk = this.story.pickPlan(def, w);
    const ids = [chair.id, ...members.map((m) => m.id), ...(center ? [center.id] : [])];
    const place: Record<string, Placement> = {};
    for (const id of ids) place[id] = { how: 'spot', group: 'meeting' };
    const topic = fill(def.meeting.topic);
    return {
      type: 'crisis_meeting',
      participants: ids,
      place,
      locationLabel: SPOT_LABELS.meeting,
      sit: (people) => sitCrisisMeeting(this.kit(), chair, people.filter((p) => p.id !== chair.id && p.id !== center?.id),
        center && people.some((p) => p.id === center.id) ? center : null, { title: def.title, note: fill(arc.note), topic }),
      topicCats: [],
      meta: { arcId: arc.id, pick: pk.code, options: plans.map((p) => p.code).join(',') },
      crisis: {
        kind: def.kind, title: def.title, note: cut(fill(arc.note), 160), topic,
        options: plans.map((p) => ({ code: p.code, label: cut(fill(p.label), 100) })), pick: pk.code, centerId: center?.id,
      },
      labels: Object.fromEntries(ids.map((id) => [id, { label: 'đang họp xử lý tình huống', emote: '🧯' }])),
      title: `Họp xử lý: ${def.title}`,
      icon: '🧯',
      minPeople: 2,
    };
  }

  /** pep_talk: all = sếp (vắng thì HR) + ≤ 4 người đang buồn nhất; one = nói riêng; mediate = HR (không có thì sếp) ngồi giữa hai người */
  private dPepTalk(q: QItem): Draft | null | 'drop' {
    const w = this.world;
    const d = q.data;
    const arc = this.story.arcById(d.arcId);
    const def = arc ? situationDef(arc.kind) : undefined;
    if (!arc || !def || arc.status === 'resolved' || arc.status === 'dropped') return 'drop';
    const variant: 'all' | 'one' | 'mediate' = d.variant === 'one' || d.variant === 'mediate' ? d.variant : 'all';
    const boss = w.boss();
    const hr = w.hr();
    const bossOk = this.avail(boss, 'normal') && !w.bossAway();
    const hrOk = this.avail(hr, 'normal');
    const speaker = variant === 'mediate' ? (hrOk ? hr : bossOk ? boss : undefined) : (bossOk ? boss : hrOk ? hr : undefined);
    if (!speaker) return null;
    let audience: AgentState[];
    let a: AgentState | undefined, b: AgentState | undefined;
    if (variant === 'mediate') {
      a = d.aId ? w.agent(d.aId) : undefined;
      b = d.bId ? w.agent(d.bId) : undefined;
      if (!a || !b || a.status !== 'active' || b.status !== 'active') return 'drop';
      if (!this.avail(a, 'normal') || !this.avail(b, 'normal') || a.id === speaker.id || b.id === speaker.id) return null;
      audience = [a, b];
    } else if (variant === 'one') {
      const t = d.targetId ? w.agent(d.targetId) : undefined;
      if (!t || t.status !== 'active') return 'drop';
      if (!this.avail(t, 'normal') || t.id === speaker.id) return null;
      audience = [t];
    } else {
      audience = w.activeAgents().filter((x) => x.id !== speaker.id && x.role !== 'boss' && this.avail(x, 'normal'))
        .sort((x, y) => fin(x.mood, 60) - fin(y.mood, 60)).slice(0, 4);
      if (audience.length < 2) return null;
    }
    // lựa chọn dự phòng: tâm trạng, thiện cảm với người nói, độ "kỳ phùng" của hai phe
    const avgMood = audience.reduce((s, x) => s + fin(x.mood, 60), 0) / audience.length;
    const avgRel = audience.reduce((s, x) => s + relScore(x, speaker.id), 0) / audience.length;
    let p = 0.5 + avgRel / 120 + (avgMood - 55) / 150;
    if (variant === 'mediate' && a && b) p += mutual(a, b) / 100;
    const pick: 'inspired' | 'unmoved' = chance(clamp(p, 0.15, 0.85)) ? 'inspired' : 'unmoved';
    const A = arc.a ? w.agent(arc.a) : undefined;
    const B = arc.b ? w.agent(arc.b) : undefined;
    const fill = (t: string) => fillSit(t, { a: A?.name, b: B?.name, boss: boss?.name });
    const topic = cut(d.note || fill(def.meeting.topic), 120);
    const ids = [speaker.id, ...audience.map((x) => x.id)];
    const inBossRoom = variant === 'one' && speaker.role === 'boss';
    const place: Record<string, Placement> = {};
    if (inBossRoom) {
      place[speaker.id] = { how: 'seat' };
      place[audience[0].id] = { how: 'spot', group: 'boss_visit' };
    } else for (const id of ids) place[id] = { how: 'spot', group: 'meeting' };
    return {
      type: 'pep_talk',
      participants: ids,
      place,
      locationLabel: inBossRoom ? SPOT_LABELS.boss_visit : SPOT_LABELS.meeting,
      sit: (people) => sitPepTalk(this.kit(), speaker, people.filter((x) => x.id !== speaker.id), { variant, note: fill(arc.note), topic, a, b }),
      topicCats: [],
      meta: { arcId: arc.id, pick, variant, targetId: variant === 'one' ? audience[0].id : undefined },
      crisis: { kind: def.kind, title: def.title, note: cut(fill(arc.note), 160), topic, pick, variant, centerId: variant === 'one' ? audience[0].id : undefined },
      labels: Object.fromEntries(ids.map((id) => [id, { label: id === speaker.id ? 'đang làm công tác tư tưởng' : 'đang nghe truyền lửa', emote: '📣' }])),
      title: variant === 'mediate' ? `${speaker.name} hoà giải ${a?.name ?? ''} và ${b?.name ?? ''}`.trim()
        : variant === 'one' ? `${speaker.name} nói chuyện riêng với ${audience[0].name}` : `${speaker.name} truyền lửa cho cả phòng`,
      icon: '📣',
      // hoà giải phải đủ cả hai phía
      minPeople: variant === 'mediate' ? 3 : 2,
    };
  }

  /** sau cuộc họp: ghi phương án (AI chốt nếu mã hợp lệ, không thì lựa chọn dự phòng), nhật ký, hiệu ứng ngay khi chốt */
  private afterCrisisMeeting(s: Scene, res: SceneResult | null): void {
    const w = this.world;
    const arc = this.story.arcById(s.meta.arcId);
    const def = arc ? situationDef(arc.kind) : undefined;
    if (!arc || !def || arc.plan) return;
    const offered = (s.meta.options ?? '').split(',').filter(Boolean);
    const v = res?.verdict ?? null;
    const aiOk = !!v && offered.includes(v) && res?.source === 'llm';
    const code = (aiOk ? v : offered.includes(s.meta.pick ?? '') ? s.meta.pick : offered[0]) as PlanCode | undefined;
    if (!code || !this.story.setPlan(arc.id, code, aiOk ? 'llm' : 'offline')) return;
    const plan = def.plans.find((p) => p.code === code);
    if (!plan) return;
    const A = arc.a ? w.agent(arc.a) : undefined;
    const B = arc.b ? w.agent(arc.b) : undefined;
    const label = fillSit(plan.label, { a: A?.name, b: B?.name, boss: w.boss()?.name });
    const chair = w.agent(s.participants[0])?.name ?? 'Sếp';
    // ngắn gọn: thẻ cảnh ngay trên đã có tên tình huống
    this.logEvent('🧯', cut(`${chair} chốt: ${label}`, 120), 'event', true);
    for (const act of this.story.planNowActions(arc, w)) {
      try { this.runAction(act, arc); } catch (e) { this.err(`plan:${act.t}`, e); }
    }
    this.archive('beat', `🧯 ${def.title}: chốt ${cut(label, 80)}`, { id: arc.id, kind: arc.kind, plan: code, by: aiOk ? 'llm' : 'offline' });
  }

  /** sau công tác tư tưởng: ghi kết quả vào mạch; cả phòng không xuôi → nhóm kín chế lại bài nói */
  private afterPepTalk(s: Scene, res: SceneResult | null): void {
    // chỉ tin verdict của AI; offline (kể cả cảnh khẩn cấp dùng verdict mặc định) đi theo lựa chọn của Director
    const v = res?.source === 'llm' && (res.verdict === 'inspired' || res.verdict === 'unmoved') ? res.verdict
      : s.meta.pick === 'unmoved' ? 'unmoved' : 'inspired';
    this.story.setPep(s.meta.arcId, v);
    if (v === 'unmoved' && s.meta.variant !== 'mediate' && s.meta.variant !== 'one' && chance(0.6)) {
      const speaker = this.world.agent(s.participants[0]);
      const now = this.now();
      this.enqueue('group_chat', now + rand(10, 30), now + 90, 'low', {
        reason: 'situation', note: `Nhóm kín (không có ${speaker?.name ?? 'sếp'}) chế lại bài "truyền lửa" vừa rồi: trích câu hay nhất, thả meme, có người bênh`,
        exclude: s.participants[0], arcId: s.meta.arcId,
      });
    }
  }

  private afterResignTalk(s: Scene, res: SceneResult | null): void {
    const w = this.world;
    const emp = s.meta.targetId ? w.agent(s.meta.targetId) : undefined;
    const hr = w.hr();
    if (!emp || emp.status !== 'active') return;
    const boss = w.boss();
    let verdict: 'stay' | 'leave';
    if (res?.verdict === 'stay' || res?.verdict === 'leave') verdict = res.verdict;
    else {
      // không có AI / AI không chốt → xác suất theo tâm trạng và quan hệ với sếp (không bao giờ chắc chắn)
      const mood = fin(emp.mood, 50);
      const bossScore = boss ? relScore(emp, boss.id) : 0;
      const pLeave = clamp(0.35 + (25 - mood) / 100 + Math.max(0, -30 - bossScore) / 200, 0.2, 0.75);
      verdict = chance(pLeave) ? 'leave' : 'stay';
    }
    this.ledger.lastResignTalkDay[emp.id] = w.day();
    if (verdict === 'leave') {
      this.depart(emp, 'resigned');
      return;
    }
    w.adjust(emp.id, { mood: 10, stress: -8 });
    if (hr) w.changeRelationship(emp.id, hr.id, 6, 'được HR lắng nghe');
    w.addMemory(emp.id, cut(`Định nghỉ việc nhưng ${hr?.name ?? 'HR'} khuyên ở lại, thử thêm một thời gian`, 120));
    this.ledger.lowMoodDays[emp.id] = 0;
    this.logEvent('🚪', `${emp.name} định xin nghỉ nhưng sau khi nói chuyện với ${hr?.name ?? 'HR'} đã quyết định ở lại`, 'hr', true);
    this.archive('resign', `🚪 ${emp.name} định nghỉ nhưng ở lại`, { id: emp.id, verdict: 'stay' });
  }

  private afterRaise(s: Scene, res: SceneResult | null): void {
    const w = this.world;
    const emp = s.meta.targetId ? w.agent(s.meta.targetId) : undefined;
    const boss = w.boss();
    if (!emp || emp.status !== 'active') return;
    let verdict: 'approved' | 'denied';
    if (res?.verdict === 'approved' || res?.verdict === 'denied') verdict = res.verdict;
    else {
      const avg = avgRatio(emp, 7) ?? 1;
      const p = clamp(0.25 + (avg - 1.0) * 1.5 + (revenueRatio(w) - 0.8) * 0.5 + (boss ? relScore(boss, emp.id) : 0) / 200, 0.1, 0.8);
      verdict = chance(p) ? 'approved' : 'denied';
    }
    this.ledger.lastRaiseAskDay[emp.id] = w.day();
    if (verdict === 'approved') {
      this.v3.raisesApproved++;
      w.adjust(emp.id, { mood: 20, stress: -5 });
      w.addMemory(emp.id, 'Xin tăng lương và được sếp đồng ý — xứng đáng!');
      // lương lên thì chỉ tiêu cũng nhích 5% (một nửa số lần) — không qua setRole để khỏi tính là thăng chức
      if (chance(0.5) && fin(emp.kpiTarget) > 0) emp.kpiTarget = promotedTarget(emp, 0.05);
      this.drift(emp.id, 'ambition', 0.02);
      w.toast('💵', `${emp.name} được tăng lương!`);
      this.logEvent('💵', `Sếp đồng ý tăng lương cho ${emp.name} sau màn thuyết trình bằng số liệu`, 'hr', true);
      this.archive('hr', `💵 ${emp.name} được tăng lương`, { id: emp.id, verdict });
    } else {
      this.v3.raisesDenied++;
      this.ledger.raiseDeniedDay[emp.id] = w.day();
      w.adjust(emp.id, { mood: -10, stress: 6 });
      if (boss) w.changeRelationship(emp.id, boss.id, -10, 'xin tăng lương bị từ chối');
      w.addMemory(emp.id, 'Xin tăng lương bị sếp từ chối khéo, hứa "xem lại sau"');
      this.logEvent('💵', `${emp.name} xin tăng lương nhưng sếp từ chối khéo ("công ty đang khó")`, 'hr', true);
      this.archive('hr', `💵 ${emp.name} xin tăng lương bị từ chối`, { id: emp.id, verdict });
    }
  }

  private afterPromotion(s: Scene): void {
    const w = this.world;
    const emp = s.meta.targetId ? w.agent(s.meta.targetId) : undefined;
    if (!emp || emp.status !== 'active') return;
    const newLabel = s.meta.newLabel || promotedLabel(emp);
    const target = promotedTarget(emp, 0.1);
    this.setRole(emp.id, newLabel, target); // World.setRole tự tăng promotions
    this.ledger.lastPromotionDay = w.day(); // cap 1 lần / 7 ngày tính từ lúc công bố thật
    this.v3.promotions++;
    w.adjust(emp.id, { mood: 15, stress: 4 });
    w.addMemory(emp.id, cut(`Được thăng chức thành ${newLabel}, chỉ tiêu mới ${target}`, 120));
    this.drift(emp.id, 'ambition', 0.03);
    w.toast('🎖️', `${emp.name} được thăng chức thành ${newLabel}!`);
    this.logEvent('🎖️', `${emp.name} được thăng chức thành ${newLabel} (chỉ tiêu KPI mới ${target})`, 'hr', true);
    for (const a of w.activeAgents()) if (a.id !== emp.id && a.role !== 'boss') w.addMemory(a.id, cut(`${emp.name} vừa được thăng chức thành ${newLabel}`, 120));
    const now = this.now();
    this.setBoost('after_promotion', { name: emp.name, note: newLabel, id: emp.id }, 90);
    if (chance(0.6)) this.enqueue('company_chat', now + rand(3, 10), now + 45, 'low', { reason: 'promotion', name: emp.name, note: newLabel, targetId: emp.id });
    this.enqueue('group_chat', now + rand(5, 15), now + 45, 'low', { reason: 'after_promotion', name: emp.name, note: newLabel, aboutId: emp.id });
    if (chance(0.4)) this.enqueue('celebration', now + rand(20, 50), now + 120, 'normal', { reason: 'promotion', centerId: emp.id });
    this.archive('hr', `🎖️ ${emp.name} thăng chức thành ${newLabel}`, { id: emp.id, action: 'promote', kpiTarget: target });
  }

  private afterLayoff(s: Scene): void {
    const emp = s.meta.targetId ? this.world.agent(s.meta.targetId) : undefined;
    if (!emp || emp.status !== 'active') return;
    this.depart(emp, 'laid_off');
  }

  // ================================================================ v3 — AI biên kịch (showrunner) & mạch truyện
  private storyCtx(): StoryContext {
    const rumors = this.book.all().filter((r) => r.active).slice(-3).map((r) => ({ aboutName: r.aboutName, text: this.book.latestText(r) }));
    return {
      w: this.world,
      rumors,
      latestNews: this.discussedNews[this.discussedNews.length - 1],
      recentEvents: this.notable.slice(-3),
      headcount: this.headcount(),
      ownedBy: (id) => this.ownedBy(id),
    };
  }

  private storyTick(): void {
    if (!this.showrunnerEnabled) return;
    const w = this.world;
    if (w.activeAgents().length < 3) return;
    const now = this.now();
    const min = w.minuteOfDay();
    if (this.planning && this.clockMs - this.planningAt > 40_000) this.planning = false; // AI trả lời quá lâu → mở khoá
    if (!this.planning && this.story.due(now, min)) this.planBeats(false);
    for (const arc of this.story.dueArcs(now, min)) this.runArcStep(arc);
  }

  /** lên beat: AI (brain.generateBeats) nếu đang ở chế độ LLM, không thì kế hoạch offline ngẫu nhiên có trọng số */
  private planBeats(force: boolean): void {
    const now = this.now();
    this.story.schedule(now); // đặt nhịp trước để không lên hai lần
    const ctx = this.storyCtx();
    const useLlm = this.brain.mode() === 'llm' && typeof this.brain.generateBeats === 'function' && (force || !this.llmGated());
    if (!useLlm) {
      this.acceptPlan(this.story.offlinePlan(ctx), ctx);
      return;
    }
    let req;
    try {
      req = this.story.buildRequest(ctx);
    } catch (e) {
      this.err('buildRequest', e);
      this.acceptPlan(this.story.offlinePlan(ctx), ctx);
      return;
    }
    this.planning = true;
    this.planningAt = this.clockMs;
    const day = this.world.day();
    Promise.resolve()
      .then(() => this.brain.generateBeats(req, this.ctx()))
      .then((plan) => {
        this.planning = false;
        if (this.world.day() !== day) return; // qua ngày rồi → bỏ (sáng mai lên lại)
        const ok = plan && Array.isArray(plan.beats) && plan.beats.length;
        this.acceptPlan(ok ? plan : this.story.offlinePlan(this.storyCtx()), this.storyCtx());
      })
      .catch((e) => {
        this.planning = false;
        this.err('generateBeats', e);
        this.guard('offlinePlan', () => this.acceptPlan(this.story.offlinePlan(this.storyCtx()), this.storyCtx()));
      });
  }

  private acceptPlan(plan: BeatPlan, ctx: StoryContext): void {
    const arcs = this.story.accept(plan, ctx);
    // 🎬 hiếm: chỉ mạch "đậm" (intensity 3), ≤ 1 dòng mỗi lần lên beat và ≤ 2 dòng/ngày — đọc như tiêu đề chương, không như kỹ thuật
    // v5: tình huống công ty đã có dòng "bùng phát" riêng (cùng nội dung) → không in thêm dòng 🎬 trùng
    const loud = arcs.find((a) => a.intensity >= 3 && !isSituation(a.kind));
    if (loud && this.clapsToday < 2) {
      this.clapsToday++;
      const text = loud.note.charAt(0).toUpperCase() + loud.note.slice(1);
      this.world.log({ kind: 'system', icon: '🎬', text: cut(text, 140) });
      this.pushDayEvent(`🎬 ${cut(text, 120)}`, true);
    }
    for (const a of arcs) this.archive('beat', `🎬 ${a.kind}: ${arcSummary(a, this.world)}`, { id: a.id, kind: a.kind, a: a.a, b: a.b, intensity: a.intensity, source: a.source });
  }

  private runArcStep(arc: Arc): void {
    const w = this.world;
    const now = this.now();
    const min = w.minuteOfDay();
    // v5: cuộc họp / buổi truyền lửa của chính mạch còn chờ trong hàng hoặc đang diễn → đợi nó xong rồi mới tính bước kế
    // (phương án dự phòng không "chốt nhanh" giữa lúc họp, kết cục không công bố trước bài nói). Hàng đợi có hạn (until,
    // dọn cuối ngày) và cảnh nào cũng kết thúc nên không kẹt mãi.
    if (isSituation(arc.kind) && this.arcSceneLive(arc.id)) {
      this.story.hold(arc, now, 10);
      return;
    }
    const ctx = this.storyCtx();
    let actions: StoryAction[] | null;
    try {
      actions = this.story.actionsFor(arc, ctx);
    } catch (e) {
      this.err(`story:${arc.kind}`, e);
      actions = null;
    }
    if (!actions) {
      this.story.drop(arc, w.day());
      return;
    }
    // v5: bước chưa chạy được (chờ cuộc họp chốt phương án) → hoãn, không tính bước
    const wait = actions.find((a): a is Extract<StoryAction, { t: 'wait' }> => a.t === 'wait');
    if (wait) {
      this.story.postpone(arc, now, wait.minutes);
      return;
    }
    const last = arc.step >= arc.total - 1;
    // cổng xác suất: bước giữa có thể "không xảy ra" cho khỏi gượng; bước kết luôn chạy.
    // v5: tình huống công ty không bỏ bước (cuộc họp và triển khai là xương sống của mạch); bước ghi sổ đồ ("vừa mua"
    // của shopping_story) cũng không bỏ — bước sau coi người đó là chủ món
    if (!last && !isSituation(arc.kind) && !actions.some((a) => a.t === 'own') && !chance(0.88)) {
      this.story.advance(arc, now, min);
      return;
    }
    for (const act of actions) {
      try {
        this.runAction(act, arc);
      } catch (e) {
        this.err(`action:${act.t}`, e);
      }
    }
    this.story.advance(arc, now, min);
    if (arc.status === 'resolved') {
      this.archive('beat', `🎬 kết: ${arc.kind} — ${arcSummary(arc, w)}`, { id: arc.id, kind: arc.kind, steps: arc.step });
    }
  }

  /** v5: cảnh họp xử lý / truyền lửa của mạch này đang diễn hoặc còn chờ trong hàng đợi */
  private arcSceneLive(arcId: string): boolean {
    const mine = (type: SceneType, id: string | undefined) => (type === 'crisis_meeting' || type === 'pep_talk') && id === arcId;
    return [this.office, this.online].some((s) => !!s && !s.ended && mine(s.type, s.meta.arcId))
      || this.queue.some((q) => mine(q.type, q.data.arcId));
  }

  private runAction(act: StoryAction, arc: Arc): void {
    const w = this.world;
    const now = this.now();
    const day = w.day();
    switch (act.t) {
      case 'scene': {
        const data: QData = { arcId: arc.id };
        for (const [k, v] of Object.entries(act.data)) if (typeof v === 'string' && v) (data as Record<string, string>)[k] = v;
        this.enqueue(act.type, now + Math.max(0, act.delay), now + Math.max(0, act.delay) + Math.max(5, act.window), act.prio, data);
        break;
      }
      case 'event': this.handleEvent(act.name, { agentId: act.agentId, note: act.note }, true); break;
      case 'adjust': w.adjust(act.id, { mood: act.mood, stress: act.stress, kpi: act.kpi, energy: act.energy }); break;
      case 'rel': w.changeRelationship(act.from, act.to, act.delta, act.note); break;
      case 'memory': w.addMemory(act.id, act.text); break;
      case 'own':
        // đã có rồi (vd vừa được giao / được tặng đúng món đó) → không ghi lại, không thay món trên bàn
        if (w.agent(act.id)?.status === 'active' && !this.owns(act.id, act.productId)) { this.addOwned(act.id, act.productId); w.setDeskItem(act.id, act.productId); }
        break;
      case 'log':
        if (act.kind === 'system') w.log({ kind: 'system', icon: act.icon, text: act.text });
        else this.logEvent(act.icon, act.text, 'event', true);
        break;
      case 'toast': w.toast(act.icon, act.text); break;
      case 'leave_early': {
        const a = w.agent(act.id);
        if (a && a.present) a.leaveAt = Math.max(fin(a.arriveAt, 480) + 30, Math.min(fin(a.leaveAt, 1050), Math.floor(w.minuteOfDay()) + act.inMinutes));
        break;
      }
      case 'overtime': {
        this.overtime = { untilDay: day + act.days, ids: act.ids.slice(0, 12), minutes: act.minutes };
        this.applyOvertime();
        break;
      }
      case 'late_tomorrow':
        for (const id of act.ids.slice(0, 8)) this.lateTomorrow[id] = act.minutes;
        break;
      case 'strict_boss': this.bossStrictUntil = now + act.minutes; break;
      case 'revenue': w.addRevenue(act.amount); break;
      case 'resign_check': {
        const a = w.agent(act.id);
        const boss = w.boss();
        if (!hrEligible(a)) break;
        const lowMood = this.ledger.lowMoodDays[a.id] ?? 0;
        const bossScore = boss ? relScore(a, boss.id) : 0;
        // biên kịch đã quyết người này "dọa nghỉ": xác suất nói chuyện thật với HR tăng theo mức chán việc (15%..85%)
        const pTalk = clamp(0.15 + (fin(a.warnings) >= 1 ? 0.25 : 0) + (bossScore <= -10 ? 0.25 : 0) + (lowMood >= 1 ? 0.2 : 0) + (fin(a.mood, 60) < 50 ? 0.15 : 0), 0.15, 0.85);
        if (day - (this.ledger.lastResignTalkDay[a.id] ?? -99) >= 3 && !this.queued('resign_talk') && chance(pTalk)) {
          this.ledger.lastResignTalkDay[a.id] = day;
          this.enqueue('resign_talk', now + rand(5, 20), now + 120, 'high', { targetId: a.id, hint: act.hint, arcId: arc.id });
        } else {
          // chưa tới mức nghỉ thật: HR ghé hỏi han, tâm trạng đỡ hơn
          const hr = w.hr();
          if (hr) this.enqueue('desk_visit', now + rand(3, 15), now + 60, 'normal', { initiatorId: hr.id, targetId: a.id, motiveKey: 'hr_probe', why: 'nghe nói đang chán việc, tới hỏi han', arcId: arc.id });
          w.adjust(a.id, { mood: 5 });
        }
        break;
      }
      case 'raise_check': {
        const a = w.agent(act.id);
        if (!hrEligible(a)) break;
        const avg = avgRatio(a, 7);
        if (avg !== null && avg >= 1.1 && fin(a.traits?.ambition) >= 0.6 && day - (this.ledger.lastRaiseAskDay[a.id] ?? -99) >= 10 && !this.queued('raise_request')) {
          this.ledger.lastRaiseAskDay[a.id] = day;
          this.enqueue('raise_request', now + rand(5, 25), now + 120, 'normal', { targetId: a.id, arcId: arc.id });
        } else {
          const hr = w.hr();
          if (hr) this.enqueue('desk_visit', now + rand(3, 15), now + 60, 'normal', { initiatorId: a.id, targetId: hr.id, motiveKey: 'any_borrow', why: 'hỏi dò chuyện lương thưởng mà không dám nói thẳng', arcId: arc.id });
        }
        break;
      }
      case 'rumor':
        this.enqueue('gossip', now + rand(2, 12), now + 60, 'normal', { aboutId: act.about, note: act.text, exclude: act.exclude.join(','), arcId: arc.id });
        break;
      case 'boost': this.setBoost(act.reason, act.data, act.minutes); break;
      // v5: kết cục xấu của "thị trường khó" → HR + sếp xét nhân sự (AI quyết, hàng rào như thường)
      case 'hr_review':
        if (!this.queued('hr_review')) this.enqueue('hr_review', now + rand(15, 45), now + 180, 'high', { note: act.note, arcId: arc.id });
        break;
      case 'wait': break;
      default: break;
    }
  }

  /** tăng ca: ai trong danh sách còn ở văn phòng thì về trễ hơn (tối đa 20:30) */
  private applyOvertime(): void {
    const o = this.overtime;
    if (!o) return;
    const w = this.world;
    for (const id of o.ids) {
      const a = w.agent(id);
      if (!a || a.status !== 'active') continue;
      a.leaveAt = Math.round(clamp(Math.max(fin(a.leaveAt, 1050), 17 * 60 + 30) + o.minutes, fin(a.arriveAt, 480) + 60, 20 * 60 + 30));
    }
  }

  /** đầu ngày: tăng ca còn hiệu lực, tới trễ sau karaoke, tính cách trôi theo kế hoạch, mạch quá hạn */
  private applyDayStartStory(day: number): void {
    const w = this.world;
    if (this.overtime) {
      if (day > this.overtime.untilDay) this.overtime = null;
      else this.applyOvertime();
    }
    // tới trễ sau karaoke: để dành tới ngày văn phòng mở cửa (karaoke tối thứ Sáu → thứ Hai đi trễ, không "tiêu" vào thứ Bảy)
    if (!w.officeClosed?.()) {
      const late = Object.entries(this.lateTomorrow);
      this.lateTomorrow = {};
      for (const [id, m] of late) {
        const a = w.agent(id);
        if (a && a.status === 'active' && !a.present) a.arriveAt = Math.round(clamp(fin(a.arriveAt, 480) + m, 7 * 60, 10 * 60 + 30));
      }
    }
    const keep: typeof this.driftPlans = [];
    for (const p of this.driftPlans) {
      this.drift(p.id, p.trait, p.delta);
      if (p.days > 1) keep.push({ ...p, days: p.days - 1 });
    }
    this.driftPlans = keep;
    for (const a of this.story.expire(day)) this.archive('beat', `🎬 mạch tự rơi: ${a.kind} — ${arcSummary(a, w)}`, { id: a.id, kind: a.kind });
    this.resolveProbations(day);
  }

  /**
   * v3: hết hạn thử thách → có kết cục rõ (không treo mãi trong hồ sơ): KPI trung bình trong kỳ ≥ KPI_LOW_RATIO là "qua"
   * (mood +, ký ức, HR ghé báo tin); "không qua" → HR xin họp sếp sớm hôm nay để AI quyết tiếp (không tự đuổi theo luật cứng).
   */
  private resolveProbations(day: number): void {
    const w = this.world;
    const lowRatio = fin(this.cfg.kpiLowRatio, 0.7);
    for (const a of w.agents()) {
      if (!hrEligible(a) || typeof a.probationUntilDay !== 'number' || !Number.isFinite(a.probationUntilDay) || a.probationUntilDay >= day) continue;
      const until = a.probationUntilDay;
      const ratios = kpiRatios(a, 5);
      const avg = ratios.length ? ratios.reduce((x, y) => x + y, 0) / ratios.length : null;
      const passed = avg === null || avg >= lowRatio;
      this.setProbation(a.id, null);
      this.v3.probationsResolved++;
      const pct = avg === null ? 'chưa có số liệu' : `KPI trung bình ${Math.round(avg * 100)}%`;
      const hr = w.hr();
      const now = this.now();
      if (passed) {
        w.adjust(a.id, { mood: 8, stress: -6 });
        w.addMemory(a.id, cut(`Qua kỳ thử thách KPI (hết ngày ${until}), nhẹ cả người`, 120));
        this.drift(a.id, 'diligence', 0.02);
        this.logEvent('⏳', `${a.name} hết hạn thử thách KPI — qua (${pct})`, 'hr', true);
        if (hr) this.enqueue('desk_visit', this.absFor(day, randInt(545, 640)), this.absFor(day, 700), 'normal', { initiatorId: hr.id, targetId: a.id, motiveKey: 'hr_probe', why: 'báo tin đã qua kỳ thử thách KPI, dặn giữ phong độ' });
        this.archive('hr', `⏳ ${a.name} qua kỳ thử thách`, { id: a.id, action: 'probation', passed: true, avg });
      } else {
        w.adjust(a.id, { mood: -8, stress: 8 });
        w.addMemory(a.id, cut(`Hết kỳ thử thách KPI mà số vẫn thấp (${pct}), lo bị gọi lên`, 120));
        this.logEvent('⏳', `${a.name} hết hạn thử thách KPI — không qua (${pct}), HR xin họp sếp sớm`, 'hr', true);
        if (!this.queued('hr_review') && this.ledger.lastReviewDay !== day) {
          const at = this.absFor(day, randInt(600, 645));
          this.enqueue('hr_review', Math.max(at, now + 5), Math.max(at, now + 5) + 150, 'high', { note: `${a.name} không qua kỳ thử thách KPI` });
        }
        this.archive('hr', `⏳ ${a.name} không qua kỳ thử thách`, { id: a.id, action: 'probation', passed: false, avg });
      }
    }
  }

  /** sự kiện cá nhân ngẫu nhiên hiếm (ốm, kẹt xe, thất tình…) — có log để người xem hiểu vì sao KPI/mood đổi */
  private personalEvent(agentId?: string): void {
    const w = this.world;
    const pool = w.activeAgents().filter((a) => a.role !== 'boss' && !a.sceneId && !a.hidden);
    const a = (agentId ? w.agent(agentId) : undefined) ?? pick(pool);
    if (!a || a.status !== 'active') return;
    const options = PERSONAL_EVENTS.filter((e) => !e.roles || e.roles.includes(a.role));
    const ev = weightedPick(options, (e) => e.weight);
    if (!ev) return;
    this.v3.personalEvents++;
    this.logEvent(ev.icon, ev.text.replace(/\{name\}/g, a.name), 'event', true);
    w.adjust(a.id, { mood: ev.mood, kpi: ev.kpi, stress: ev.stress });
    w.addMemory(a.id, ev.memory);
  }

  // ================================================================ sản phẩm affiliate (v4: có "chuyện", không chèn ngang)
  private offerProduct(type: SceneType, people: AgentState[], initiatorId?: string): ProductOffer | null {
    const initiator = initiatorId ? people.find((p) => p.id === initiatorId) : undefined;
    const eligible = SCENE_DEFS[type].product || (type === 'desk_visit' && initiator?.role === 'marketing');
    if (!eligible || this.productLock) return null;
    if (this.clockMs - this.lastProductAt < this.productMinMs()) return null;
    const theme = this.activeTheme();
    const boosted = this.now() < this.productBoostUntil || !!theme;
    if (Math.random() >= (boosted ? 0.8 : 0.5)) return null;
    return this.chooseProduct(people, new Set(this.productTags(type, people)), theme, initiator?.id);
  }

  /**
   * Chọn món có CỚ để xuất hiện: khớp ngữ cảnh cảnh (mệt, ăn trưa, ngủ trưa, nắng chiều…), hợp "vụ mua sắm" đang chạy,
   * hoặc có người trong cảnh đã sở hữu (để kể lại). Không món nào có cớ → không nhắc (null). Món ít được nhắc được ưu tiên.
   */
  /** skip: món không được chọn (vd quà cho người đã có món đó) */
  private chooseProduct(people: AgentState[], ctx: ReadonlySet<string>, theme: { def: ShoppingTheme } | null, speakerId?: string,
    skip?: ReadonlySet<string>, ignoreRecent = false): ProductOffer | null {
    let list: Product[] = [];
    try { list = getProducts(); } catch (e) { this.err('getProducts', e); return null; }
    const recent = new Set(ignoreRecent ? [] : this.recentProducts);
    const themeTags = theme ? new Set(theme.def.tags) : null;
    const scored: { p: Product; w: number; th: number; owner: AgentState | null }[] = [];
    for (const p of list) {
      if (recent.has(p.id) || skip?.has(p.id)) continue;
      const c = contextScore(p, ctx);
      const th = themeTags ? (themeTags.size ? contextScore(p, themeTags) : 1) : 0;
      const owners = people.filter((x) => this.owns(x.id, p.id));
      if (!c && !th && !owners.length) continue; // không có cớ → không nhắc món này
      const w = (c + th * 2 + (owners.length ? 2 : 0)) / (1 + (this.productUses[p.id] ?? 0) * 0.35);
      scored.push({ p, w, th, owner: owners.length ? pick(owners)! : null });
    }
    const c = weightedPick(scored, (x) => x.w);
    if (!c) return null;
    return this.makeOffer(c.p, people, { owner: c.owner ?? undefined, speakerId, mode: 'mention', theme: c.th > 0 ? theme : null });
  }

  /** Ghép món + kiểu chuyện: hợp vụ đang chạy → lấy vụ làm cớ; có người đã sở hữu → kể lại; còn lại → kiểu chuyện xoay vòng */
  private makeOffer(
    p: Product, people: AgentState[],
    o: { owner?: AgentState; speakerId?: string; mode: ProductMode; theme?: { def: ShoppingTheme } | null },
  ): ProductOffer {
    const nonBoss = people.filter((x) => x.role !== 'boss');
    const hook = pick(p.hooks ?? []) ?? '';
    if (o.theme && !o.owner && chance(0.7)) {
      const speaker = people.find((x) => x.id === o.speakerId) ?? (o.theme.def.by === 'marketing' ? people.find((x) => x.role === 'marketing') : undefined) ?? pick(nonBoss) ?? people[0];
      return {
        product: p, mode: o.mode, speaker: speaker?.id, hook: o.theme.def.hook, angleKey: `theme:${o.theme.def.key}`, buys: 0.6,
        angle: `${this.themeText(o.theme.def.angle)}; món này hợp vụ (${o.theme.def.hook})`,
      };
    }
    const owner = o.owner && people.some((x) => x.id === o.owner!.id) ? o.owner : undefined;
    const feel = priceFeelOf(p);
    const recentKeys = new Set(this.recentAngles.slice(-5));
    const fits = (a: ProductAngle) => (owner ? a.need !== 'new' : a.need !== 'owner') && (!a.feel || (!!feel && a.feel.includes(feel)));
    let pool = PRODUCT_ANGLES.filter((a) => fits(a) && !recentKeys.has(a.key));
    if (!pool.length) pool = PRODUCT_ANGLES.filter(fits);
    const ang = weightedPick(pool, (a) => a.weight * (owner && a.need === 'owner' ? 1.6 : 1)) ?? PRODUCT_ANGLES[0];
    const speaker = (ang.need === 'owner' && owner) ? owner
      : people.find((x) => x.id === o.speakerId) ?? pick(nonBoss) ?? people[0];
    const other = pick(people.filter((x) => x.id !== speaker?.id));
    let angle = fillAngle(ang.text, { owner: owner?.name, speaker: speaker?.name, other: other?.name });
    if (ang.key === 'need_first' && hook) angle += ` (rắc rối gợi ý: ${hook})`;
    return {
      product: p, mode: owner && ang.need === 'owner' ? (o.mode === 'showroom' ? 'showroom' : 'owner') : o.mode,
      speaker: speaker?.id, hook, angle, angleKey: ang.key, buys: ang.buys ?? 0,
    };
  }

  /** thay {boss} {hr} {mkt} bằng tên người đang giữ vai đó */
  private themeText(t: string): string {
    const w = this.world;
    const mkt = w.activeAgents().find((a) => a.role === 'marketing');
    return t
      .replace(/\{boss\}/g, w.boss()?.name ?? 'Sếp')
      .replace(/\{hr\}/g, w.hr()?.name ?? 'HR')
      .replace(/\{mkt\}/g, mkt?.name ?? 'bên marketing');
  }

  /** món đi kèm cảnh khui hộp / tặng quà / chuyện mua sắm của AI biên kịch */
  private attachProduct(draft: Draft, productId: string, mode: ProductMode, angle: string | undefined, initiator: AgentState, target: AgentState): void {
    let p: Product | undefined;
    try { p = getProduct(productId); } catch { p = undefined; }
    if (!p) return;
    const short = shortNameOf(p);
    draft.product = p;
    draft.productMode = mode;
    draft.productSpeaker = mode === 'gift' || mode === 'mention' ? initiator.id : target.id;
    draft.productHook = pick(p.hooks ?? []) ?? '';
    // khui hộp / tặng quà: mục tiêu cảnh (sitDeskVisit tone unbox / gift) đã tả đúng chuyện này → không thêm "Chuyện" trùng lặp
    draft.productAngle = angle && angle.trim() ? cut(angle, 220)
      : mode === 'owner' ? `${target.name} đã dùng ${short} một thời gian, ${initiator.name} ghé hỏi thật lòng có đáng mua không`
        : '';
    if (mode === 'unboxing') { draft.title = `${target.name} khui hàng mới`; draft.icon = '📦'; }
    else if (mode === 'gift') { draft.title = `${initiator.name} tặng quà ${target.name}`; draft.icon = '🎁'; }
  }

  /** câu nhắc sản phẩm vừa lên sóng: đếm lượt, nhớ kiểu chuyện, đôi khi người nói chốt đơn → vài giờ sau "hàng về" */
  private afterProductLine(s: Scene, speakerId: string): void {
    const p = s.product;
    if (!p) return;
    this.productUses[p.id] = (this.productUses[p.id] ?? 0) + 1;
    const o = s.offer;
    if (o?.angleKey) this.recentAngles = [...this.recentAngles, o.angleKey].slice(-8);
    if (!o || o.mode === 'unboxing' || o.mode === 'gift' || o.mode === 'owner') return;
    const buyer = this.world.agent(speakerId);
    if (!buyer || buyer.status !== 'active' || this.owns(buyer.id, p.id) || this.deliveriesToday >= 3) return;
    if (!chance(o.buys)) return;
    this.addTimer({ kind: 'delivery', at: this.now() + randInt(90, 300), agentId: buyer.id, productId: p.id, since: this.now() });
  }

  /** shipper giao hàng: thành món đồ trên bàn + cảnh đồng nghiệp xúm lại xem khui hộp */
  private deliver(t: Timer): void {
    const w = this.world;
    const a = t.agentId ? w.agent(t.agentId) : undefined;
    let p: Product | undefined;
    try { p = t.productId ? getProduct(t.productId) : undefined; } catch { p = undefined; }
    if (!a || a.status !== 'active' || !p || this.owns(a.id, p.id)) return;
    if (!a.present || a.hidden) {
      // chưa đi làm / đã về: hàng để ở lễ tân, nhận vào 09:30–11:00 buổi sáng kế tiếp (trước 9h thì ngay sáng nay); hụt tối đa
      // 2 lần. Văn phòng đóng cửa (không ai đi làm: cuối tuần ở realtime) không tính là giao hụt; đơn quá 5 ngày thì thôi.
      const closed = !w.activeAgents().some((x) => x.present && !x.hidden);
      const tries = (t.tries ?? 0) + (closed ? 0 : 1);
      const fresh = this.now() - (t.since ?? t.at) <= DELIVERY_MAX_AGE;
      if (tries <= 2 && fresh) {
        const dayStart = this.now() - w.minuteOfDay();
        this.addTimer({ ...t, at: dayStart + (w.minuteOfDay() < 540 ? 0 : 1440) + randInt(570, 660), tries });
      }
      return;
    }
    const short = shortNameOf(p);
    this.addOwned(a.id, p.id);
    w.setDeskItem(a.id, p.id);
    w.addMemory(a.id, `Nhận hàng ${short} giao tới văn phòng`);
    this.deliveriesToday++;
    this.logEvent('📦', `Shipper giao hàng tới cho ${a.name}: ${p.emoji} ${p.name}`, 'event', true);
    const now = this.now();
    this.enqueue('desk_visit', now + rand(1, 6), now + 60, 'low', { targetId: a.id, why: `xem ${a.name} khui hộp ${short}`, tone: 'unbox', productId: p.id, productMode: 'unboxing' });
  }

  private owns(agentId: string, productId: string): boolean {
    if (this.world.agent(agentId)?.deskItemProductId === productId) return true;
    return (this.owned[agentId] ?? []).some((o) => o.id === productId);
  }

  private ownedBy(agentId: string): string[] {
    const ids = (this.owned[agentId] ?? []).map((o) => o.id);
    const desk = this.world.agent(agentId)?.deskItemProductId;
    return desk && !ids.includes(desk) ? [...ids, desk] : ids;
  }

  private addOwned(agentId: string, productId: string): void {
    const list = (this.owned[agentId] ?? []).filter((o) => o.id !== productId);
    // món đang trên bàn (preset roster / lúc tuyển) chưa có trong sổ → ghi trước khi bị thay (mọi nơi gọi addOwned rồi mới
    // setDeskItem), kẻo "quên" là đã có rồi sau đó lại "mua" lần nữa
    const desk = this.world.agent(agentId)?.deskItemProductId;
    if (desk && desk !== productId && !list.some((o) => o.id === desk)) list.push({ id: desk, day: this.world.day() });
    list.push({ id: productId, day: this.world.day() });
    this.owned[agentId] = list.slice(-6);
  }

  // ---------------------------------------------------------------- v4: "vụ mua sắm"
  private activeTheme(): { def: ShoppingTheme; state: ThemeState } | null {
    const t = this.theme;
    if (!t) return null;
    if (this.now() >= t.until) { this.endTheme(t.key); return null; }
    const def = themeByKey(t.key);
    return def ? { def, state: t } : null;
  }

  private themeOk(t: ShoppingTheme): boolean {
    const w = this.world;
    if (t.when === 'afternoon' && w.minuteOfDay() < 780) return false;
    if (t.when === 'friday' && !/sáu/i.test(w.weekday())) return false;
    if (t.by === 'boss' && !w.boss()) return false;
    if (t.by === 'hr' && !w.hr()) return false;
    if (t.by === 'marketing' && (!w.boss() || !w.activeAgents().some((a) => a.role === 'marketing'))) return false;
    return w.activeAgents().filter((a) => a.present && a.role !== 'boss').length >= 3;
  }

  /** bắt đầu một vụ (chỉ định sẵn hoặc bốc ngẫu nhiên, né 4 vụ gần nhất): thông báo + nhóm công ty + mời qua phòng trưng bày */
  private startTheme(want?: ShoppingTheme): boolean {
    if (this.theme) return false;
    let def = want && this.themeOk(want) ? want : undefined;
    if (!def && !want) {
      const recent = new Set(this.recentThemes.slice(-4));
      def = weightedPick(SHOPPING_THEMES.filter((t) => t.weight > 0 && !recent.has(t.key) && this.themeOk(t)), (t) => t.weight) ?? undefined;
    }
    if (!def) return false;
    const now = this.now();
    // kết trước 16:40 (còn người ở văn phòng để khui quà / trao giải); bắt đầu quá trễ (< 60 phút) thì thôi
    const until = Math.min(now + randInt(def.minutes[0], def.minutes[1]), this.absFor(this.world.day(), 1000));
    if (until - now < 60) return false;
    const announce = this.themeText(def.announce);
    this.theme = { key: def.key, startedAt: now, until, announce };
    this.lastThemeDay = this.world.day();
    this.recentThemes = [...this.recentThemes, def.key].slice(-6);
    this.productBoostUntil = Math.max(this.productBoostUntil, until);
    this.logEvent(def.icon, announce, 'event', true);
    this.enqueue('company_chat', now + rand(1, 4), now + 40, 'normal', { reason: 'shopping', note: announce });
    if (showroomAvailable()) this.enqueue('showroom_chat', now + rand(20, 60), now + 120, 'normal', { reason: 'nudge' });
    this.addTimer({ kind: 'theme_end', at: until, themeKey: def.key });
    return true;
  }

  /** kết vụ: bốc thăm quà → khui quà bí mật; thi góc làm việc → công bố người thắng */
  private endTheme(key?: string): void {
    const t = this.theme;
    if (!t || (key && t.key !== key)) return;
    this.theme = null;
    const def = themeByKey(t.key);
    if (!def?.payoff) return;
    const w = this.world;
    // quá giờ làm (vd server khởi động lại buổi tối, hẹn kết vụ đã trễ) → kết thúc lặng lẽ, không trao giải / khui quà
    // cho vài người còn ở lại muộn
    if (w.minuteOfDay() >= 17 * 60 + 30) return;
    const here = w.activeAgents().filter((a) => a.present && !a.hidden && a.status === 'active' && a.role !== 'boss');
    if (def.payoff === 'contest_winner') {
      if (!here.length) return;
      const win = weightedPick(here, (a) => 1 + this.ownedBy(a.id).length * 0.6) ?? here[0];
      this.logEvent('🏆', `${win.name} thắng thi "góc làm việc đẹp nhất", được ${w.boss()?.name ?? 'sếp'} bao trà sữa cả tuần`, 'event', true);
      w.adjust(win.id, { mood: 10 });
      w.addMemory(win.id, 'Thắng thi góc làm việc đẹp nhất công ty');
      return;
    }
    // gift_exchange: tối đa 2 cặp người tặng → người nhận, mỗi người nhận một món hợp vụ
    const givers = shuffle([...here]);
    const used = new Set<string>();
    const given = new Set<string>();
    let pairs = 0;
    const tags = new Set(def.tags);
    for (const g of givers) {
      if (pairs >= 2) break;
      // không tặng món người nhận đã có (kể cả món trên bàn) hay đang chờ giao, không tặng trùng món cặp trước; người này hết
      // món hợp thì thử người khác; vẫn hết thì bỏ qua lọc "món vừa nhắc gần đây"
      let r: AgentState | undefined;
      let gift: ProductOffer | null = null;
      for (const cand of shuffle(here.filter((x) => x.id !== g.id && !used.has(x.id)))) {
        const skip = new Set([...this.ownedBy(cand.id), ...this.pendingOrders(cand.id), ...given]);
        gift = this.chooseProduct([cand], tags, { def }, g.id, skip) ?? this.chooseProduct([cand], tags, { def }, g.id, skip, true);
        if (gift) { r = cand; break; }
      }
      if (!r || !gift) continue;
      used.add(r.id);
      given.add(gift.product.id);
      pairs++;
      const short = shortNameOf(gift.product);
      this.addOwned(r.id, gift.product.id);
      w.setDeskItem(r.id, gift.product.id);
      w.changeRelationship(g.id, r.id, 4, 'tặng quà bí mật');
      w.changeRelationship(r.id, g.id, 4, 'được tặng quà bí mật');
      w.addMemory(r.id, `Được ${g.name} tặng quà bí mật: ${short}`);
      w.addMemory(g.id, `Bốc thăm trúng ${r.name}, tặng ${short}`);
      this.logEvent('🎁', `Khui quà bí mật: ${g.name} tặng ${r.name} ${gift.product.emoji} ${gift.product.name}`, 'event', true);
      if (pairs === 1) {
        const now = this.now();
        this.enqueue('desk_visit', now + rand(1, 5), now + 60, 'normal', {
          initiatorId: g.id, targetId: r.id, why: `mang quà bí mật tới tặng ${r.name}`, tone: 'gift', productId: gift.product.id, productMode: 'gift',
        });
      }
    }
    // đã báo vụ mà không ghép được cặp nào (ít người / hết món hợp) → một dòng khép vụ, không im lặng
    if (!pairs && here.length >= 2) this.logEvent('🎁', 'Vụ tặng quà bí mật khép lại sớm: chưa ai chọn được món ưng ý, hẹn dịp khác', 'event', true);
  }

  /** món đang chờ shipper giao cho người này */
  private pendingOrders(agentId: string): string[] {
    return this.timers.filter((t) => t.kind === 'delivery' && t.agentId === agentId && t.productId).map((t) => t.productId!);
  }

  private productTags(type: SceneType, people: AgentState[]): string[] {
    const t = new Set<string>(['van-phong']);
    const add = (...xs: string[]) => { for (const x of xs) t.add(x); };
    const min = this.world.minuteOfDay();
    if (people.some((p) => fin(p.energy, 70) < 40)) add('ca-phe', 'nang-luong', 'do-uong', 'tra');
    if (people.some((p) => fin(p.stress, 30) > 65)) add('thu-gian', 'massage', 'suc-khoe');
    if (people.some((p) => isTech(p.role))) add('dev', 'ban-phim', 'chuot', 'tai-nghe', 'man-hinh', 'cong-nghe', 'ban-lam-viec');
    if (people.some((p) => p.role === 'designer')) add('design', 'decor');
    if (type === 'lunch') add('an-vat', 'hop-com', 'do-an', 'an-trua', 'nau-an');
    if (people.some((p) => p.role === 'marketing')) add('lam-dep', 'thoi-trang', 'livestream', 'tiktok', 'content', 'trang-diem');
    if (type === 'celebration') add('qua-tang', 'tiec', 'karaoke', 'sinh-nhat', 'trang-suc');
    if (people.some((p) => p.role === 'boss')) add('golf', 'sep', 'tra');
    if (people.some((p) => fin(p.stress, 30) > 50) || chance(0.3)) add('ghe', 'lung');
    if ((min >= 690 && min <= 840) || people.some((p) => fin(p.energy, 70) < 30)) add('ngu-trua', 'chan-goi');
    if (this.now() < this.productBoostUntil) add('qua-tang', 'du-lich', 'thoi-trang');
    if (people.some((p) => p.role === 'salesnew' || p.role === 'junior') && chance(0.4)) add('game', 'gaming', 'sac', 'dien-thoai');
    if (min >= 780 && min <= 960 && chance(0.25)) add('quat', 'may-lanh', 'nang', 'mo-hoi');
    if (people.some((p) => p.role === 'saleslead' || p.role === 'salesnew') && chance(0.3)) add('cong-tac', 'du-lich', 'phong-hop');
    if (/sáu/i.test(this.world.weekday()) && min >= 840) add('ve-sinh', 'don-dep', 'cuoi-tuan');
    if (this.world.day() % 15 === 0) add('di-chua', 'ram', 'le');
    return [...t];
  }

  // ================================================================ tin đồn / bản tin
  private emitRumors(): void {
    try {
      this.world.emit({ t: 'rumors', rumors: this.rumors() });
    } catch (e) {
      this.err('emitRumors', e);
    }
  }

  private leakCheck(): void {
    for (const r of this.book.leakCheck(0.3, 3)) {
      const subject = this.world.agent(r.aboutId);
      if (!subject || subject.status === 'fired') {
        this.book.deactivate(r.id);
        continue;
      }
      this.logEvent('👂', `${subject.name} hình như đã nghe phong thanh tin đồn về mình…`, 'event', true);
    }
  }

  private recapEvents(): string[] {
    const keep = new Set(this.notable);
    const fill = this.dayEvents.filter((e) => !keep.has(e)).slice(-Math.max(0, 32 - keep.size));
    return [...keep, ...fill].sort().map((e) => cut(e, 160));
  }

  private makeRecap(day: number, results: KpiResult[]): void {
    const w = this.world;
    const req: RecapRequest = {
      day,
      weekday: w.weekday(),
      events: this.recapEvents(),
      kpi: results,
      firedToday: [...this.firedToday],
      hiredToday: [...this.hiredToday],
    };
    const ctx = this.ctx();
    Promise.resolve()
      .then(() => this.brain.generateRecap(req, ctx))
      .then((r) => {
        if (!r || typeof r !== 'object' || typeof r.headline !== 'string') return;
        const recap: DayRecap = {
          day,
          weekday: typeof r.weekday === 'string' && r.weekday ? r.weekday : req.weekday,
          headline: r.headline,
          bullets: Array.isArray(r.bullets) ? r.bullets.filter((b) => typeof b === 'string').slice(0, 6) : [],
          mvp: r.mvp && typeof r.mvp === 'object' && typeof r.mvp.id === 'string' ? r.mvp : null,
          drama: typeof r.drama === 'string' ? r.drama : '',
          kpi: Array.isArray(r.kpi) && r.kpi.length ? r.kpi : results,
          source: r.source === 'llm' ? 'llm' : 'offline',
        };
        this.recapList = [...this.recapList.filter((x) => x.day !== day), recap].sort((a, b) => a.day - b.day).slice(-KEEP_RECAPS);
        w.emit({ t: 'recap', recap });
        w.log({ kind: 'event', text: `Bản tin ngày ${day} đã lên sóng`, icon: '📰' });
      })
      .catch((e) => this.err('generateRecap', e));
  }

  // ================================================================ ghi chép
  private setBoost(reason: GroupReason, data: ReasonData, minutes: number): void {
    const now = this.now();
    const rank = (r: GroupReason): number =>
      ({ after_firing: 5, payday: 4, boss_left: 3, server_down: 3, new_hire: 3, after_warning: 2, release: 2, wifi_down: 2 } as Partial<Record<GroupReason, number>>)[r] ?? 1;
    if (this.boost && this.boost.until > now && rank(this.boost.reason) > rank(reason)) return;
    this.boost = { until: now + minutes, reason, data, used: 0 };
  }

  private logEvent(icon: string, text: string, kind: 'event' | 'hr' = 'event', notable = true): void {
    try {
      this.world.log({ kind, text, icon });
    } catch (e) {
      this.err('log', e);
    }
    this.pushDayEvent(`${icon} ${text}`, notable);
  }

  private pushDayEvent(text: string, notable: boolean): void {
    const line = `${hhmm(this.world.minuteOfDay())} ${cut(text, 150)}`;
    this.dayEvents = [...this.dayEvents, line].slice(-KEEP_DAY_EVENTS);
    if (notable) this.notable = [...this.notable, line].slice(-25);
  }

  private pushSummary(s: string): void {
    this.summaries = [...this.summaries, cut(s, 160)].slice(-KEEP_SUMMARIES);
  }

  private ctx(): PromptContext {
    const w = this.world;
    const all = w.agents();
    const agents: Record<string, AgentState> = {};
    for (const a of all) agents[a.id] = a;
    for (const [id, g] of this.departed) if (!agents[id]) agents[id] = g.a; // người đã nghỉ: chỉ để tra tên
    const min = fin(w.minuteOfDay());
    return {
      companyName: this.cfg.companyName,
      company: w.company(),
      day: w.day(),
      minuteOfDay: Math.floor(min),
      weekday: w.weekday(),
      timeLabel: hhmm(min),
      agents,
      roster: all.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name, roleLabel: a.roleLabel })),
      recentSummaries: this.summaries.slice(-8),
      bossAway: w.bossAway(),
      bossNote: w.bossNote(),
    };
  }

  /** chi tiết sống động hôm nay (đưa vào "bối cảnh thêm") */
  private factsOf(a: AgentState): string[] {
    const f: string[] = [];
    const day = this.world.day();
    const late = this.lateToday[a.id];
    const lateN = this.lateDays[a.id]?.length ?? 0;
    if (late !== undefined) f.push(`sáng nay đi trễ, tới lúc ${hhmm(late)}${lateN >= 2 ? ` (lần thứ ${lateN} trong tuần)` : ''}`);
    else if (lateN >= 2) f.push(`tuần này đã đi trễ ${lateN} lần`);
    const c = this.actCounts[a.id] ?? {};
    if ((c.coffee ?? 0) >= 2) f.push(`hôm nay đã đi pha cà phê ${c.coffee} lần`);
    if ((c.toilet ?? 0) >= 3) f.push(`đi toilet ${c.toilet} lần (nghi trốn việc)`);
    if ((c.pingpong ?? 0) >= 2) f.push(`đã trốn ra đánh bóng bàn ${c.pingpong} lần`);
    if ((c.slacking ?? 0) >= 3) f.push(`lướt điện thoại ${c.slacking} lần trong giờ làm`);
    if ((c.napping ?? 0) >= 2) f.push(`ngủ gật ${c.napping} lần`);
    if ((c.snack ?? 0) >= 3) f.push(`ăn vặt ${c.snack} lần`);
    if ((c.showroom ?? 0) >= 2) f.push(`ghé phòng trưng bày ngắm đồ ${c.showroom} lần`);
    if (this.birthdayToday === a.id) f.push('hôm nay là sinh nhật');
    const hired = fin(a.hiredDay);
    if (hired > 1 && day - hired <= 2) f.push(day === hired ? 'mới vào làm hôm nay' : 'nhân viên mới vào');
    return f.slice(0, 3);
  }

  /** độ "hot" của 1 người để làm đề tài nói xấu */
  private interestOf(x: AgentState): number {
    let v = fin(x.caughtToday) * 0.8;
    if (this.lateToday[x.id] !== undefined) v += 0.8;
    if (x.role !== 'boss' && x.role !== 'hr') v += fin(x.lowStreak) * 0.5 + fin(x.warnings) * 0.6;
    if (fin(x.hiredDay) > 1 && this.world.day() - fin(x.hiredDay) <= 2) v += 1;
    const c = this.actCounts[x.id] ?? {};
    v += Math.min(1, ((c.toilet ?? 0) + (c.pingpong ?? 0) + (c.slacking ?? 0)) / 6);
    return v;
  }

  // ================================================================ bảo trì
  /** đếm hoạt động trong ngày (ly cà phê thứ mấy, đi toilet mấy lần...) */
  private watch(): void {
    for (const a of this.world.agents()) {
      const prev = this.lastAct.get(a.id);
      if (prev !== a.activity) {
        this.lastAct.set(a.id, a.activity);
        if (prev !== undefined && !a.sceneId && COUNTED.includes(a.activity)) {
          const c = (this.actCounts[a.id] ??= {});
          c[a.activity] = (c[a.activity] ?? 0) + 1;
        }
      }
      if (a.present && a.status === 'active') this.daySawPresence = true;
    }
  }

  /** dọn agent "mồ côi" (sceneId không thuộc cảnh nào), ứng viên lạc, tin đồn nguội, vị trí trống */
  private sweep(): void {
    const w = this.world;
    const live = new Set([this.office?.id, this.online?.id].filter((x): x is string => !!x));
    for (const a of w.agents()) {
      if (a.sceneId && !live.has(a.sceneId)) {
        a.sceneId = null;
        a.onPhone = false;
        if (a.present && a.status === 'active') {
          this.safeRelease(a.id);
          w.setActivity(a.id, 'idle', 0);
        }
      } else if (!a.sceneId && a.onPhone) {
        a.onPhone = false;
      }
      if (a.status === 'candidate' && !a.sceneId) this.dismissCandidate(a.id);
    }
    const ids = new Set(w.agents().map((a) => a.id));
    for (const id of [...this.lastAct.keys()]) if (!ids.has(id)) this.lastAct.delete(id);
    for (const id of [...this.agentLast.keys()]) if (!ids.has(id)) this.agentLast.delete(id);
    for (const id of [...this.dismissed]) if (!ids.has(id)) this.dismissed.delete(id);
    for (const id of [...this.lastCaught.keys()]) if (!ids.has(id)) this.lastCaught.delete(id);
    if (this.book.sweep((id) => { const a = w.agent(id); return !!a && a.status !== 'fired'; })) this.emitRumors();
    const slump = this.inSlump();
    if (!slump) for (const v of detectVacancies(w, this.vacancies, w.day(), this.ledger.frozenRoles)) this.vacancies.push(v);
    this.vacancies = this.vacancies.filter((v) => v.extra || !w.agents().some((a) => a.role === v.role && a.status === 'active'));
    if (!slump) this.ensureInterviews();
    if (this.boost && this.boost.until <= this.now()) this.boost = null;
    // v3: sổ HR / lịch trễ / mạch truyện không giữ người đã rời công ty
    pruneLedger(this.ledger, (id) => ids.has(id));
    for (const id of Object.keys(this.lateTomorrow)) if (!ids.has(id)) delete this.lateTomorrow[id];
    this.driftPlans = this.driftPlans.filter((p) => ids.has(p.id));
    for (const arc of this.story.openArcs()) {
      if ((arc.a && !ids.has(arc.a)) || (arc.b && !ids.has(arc.b))) this.story.drop(arc, w.day());
    }
  }

  // ================================================================ lưu / khôi phục
  serialize(): unknown {
    try {
      const now = this.now();
      const queue = this.queue.map((q) => {
        const data: QData = { ...q.data };
        delete data.candidate; // ứng viên sinh lại sau khi khởi động
        return { id: q.id, type: q.type, at: q.at, until: q.until, prio: q.prio, data };
      });
      // cảnh HR đang diễn dở → diễn lại sau khi khởi động
      const s = this.office;
      if (s && !s.ended && (s.type === 'firing' || s.type === 'hr_warning') && s.meta.targetId) {
        queue.push({ id: `${s.id}_r`, type: s.type, at: now + 1, until: now + 150, prio: 'high', data: { targetId: s.meta.targetId } });
      }
      // cảnh v3 do AI quyết đang diễn dở → diễn lại sau khi khởi động (hr_review: lịch lại trong 1 giờ)
      if (s && !s.ended && HR_SCENE_TYPES.includes(s.type) && s.meta.targetId && !(s.type === 'firing' || s.type === 'hr_warning')) {
        queue.push({ id: `${s.id}_r`, type: s.type, at: now + 1, until: now + 150, prio: 'high', data: { targetId: s.meta.targetId, newLabel: s.meta.newLabel, hint: s.meta.hint } });
      }
      if (s && !s.ended && s.type === 'hr_review') {
        queue.push({ id: `${s.id}_r`, type: 'hr_review', at: now + 1, until: now + 150, prio: 'high', data: { note: s.meta.note, force: s.meta.force ? '1' : undefined } });
      }
      // v5: họp xử lý / truyền lửa của tình huống công ty đang diễn dở → diễn lại sau khi khởi động (không thì mạch chờ 180 phút
      // rồi "chốt nhanh qua điện thoại" — trái với cuộc họp người xem vừa thấy; pep_talk mất thì mất luôn ±0,2 xác suất kết cục)
      if (s && !s.ended && s.meta.arcId && (s.type === 'crisis_meeting' || s.type === 'pep_talk')
        && !queue.some((q) => q.type === s.type && q.data.arcId === s.meta.arcId)) {
        const v = s.meta.variant;
        const data: QData = s.type === 'crisis_meeting'
          ? { arcId: s.meta.arcId }
          : {
            arcId: s.meta.arcId, variant: v, targetId: s.meta.targetId, note: s.req.crisis?.topic,
            // dPepTalk xếp người tham gia [người nói, a, b]
            ...(v === 'mediate' ? { aId: s.participants[1], bId: s.participants[2] } : {}),
          };
        queue.push({ id: `${s.id}_r`, type: s.type, at: now + 1, until: now + (s.type === 'crisis_meeting' ? 150 : 120), prio: s.prio, data });
      }
      return {
        v: 2,
        seq: this.seq,
        plannedDay: this.plannedDay,
        lastRecapDay: this.lastRecapDay,
        recaps: this.recapList,
        rumors: this.book.serialize(),
        queue,
        timers: this.timers,
        story: {
          showrunner: this.story.serialize(),
          ledger: this.ledger,
          newsUsed: this.newsUsed,
          discussedNews: this.discussedNews,
          newsCatIdx: this.newsCatIdx,
          bossStrictUntil: this.bossStrictUntil,
          overtime: this.overtime,
          lateTomorrow: this.lateTomorrow,
          driftPlans: this.driftPlans,
          counters: this.v3,
        },
        summaries: this.summaries,
        recentTopics: this.recentTopics,
        dayEvents: this.dayEvents,
        notable: this.notable,
        firedToday: this.firedToday,
        hiredToday: this.hiredToday,
        lateToday: this.lateToday,
        lateDays: this.lateDays,
        vacancies: this.vacancies,
        usedNames: this.usedNames,
        birthdays: this.birthdays,
        birthdayToday: this.birthdayToday,
        lastBirthdayDay: this.lastBirthdayDay,
        boost: this.boost,
        productBoostUntil: this.productBoostUntil,
        recentProducts: this.recentProducts,
        shopping: {
          theme: this.theme, recentThemes: this.recentThemes, lastThemeDay: this.lastThemeDay, recentAngles: this.recentAngles,
          productUses: this.productUses, owned: this.owned, deliveriesToday: this.deliveriesToday,
        },
        companyToday: [...this.companyToday],
        actCounts: this.actCounts,
        daySawPresence: this.daySawPresence,
        counters: this.counters,
      };
    } catch (e) {
      this.err('serialize', e);
      return { v: 1 };
    }
  }

  /** v4: khôi phục chuyện mua sắm (phòng thủ: sai kiểu → bỏ qua; id sản phẩm không còn trong danh mục → bỏ) */
  private restoreShopping(raw: unknown): void {
    if (!isObj(raw)) return;
    let valid = new Set<string>();
    try { valid = new Set(getProducts().map((p) => p.id)); } catch { valid = new Set(); }
    const t = raw.theme;
    if (isObj(t) && typeof t.key === 'string' && themeByKey(t.key)) {
      const until = numOrNull(t.until), startedAt = numOrNull(t.startedAt);
      if (until !== null && startedAt !== null) this.theme = { key: t.key, until, startedAt, announce: str(t.announce, 300) ?? '' };
    }
    this.recentThemes = strList(raw.recentThemes, 6, 40);
    this.lastThemeDay = numOrNull(raw.lastThemeDay) ?? -1;
    this.recentAngles = strList(raw.recentAngles, 8, 40);
    this.productUses = {};
    if (isObj(raw.productUses)) {
      for (const [k, v] of Object.entries(raw.productUses)) {
        if (valid.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) this.productUses[k] = Math.min(Math.floor(v), 100000);
      }
    }
    this.owned = {};
    if (isObj(raw.owned)) {
      for (const [id, list] of Object.entries(raw.owned)) {
        if (!Array.isArray(list) || typeof id !== 'string' || id.length > 80) continue;
        const items = list.filter((o): o is { id: string; day: number } => isObj(o) && typeof o.id === 'string' && valid.has(o.id) && typeof o.day === 'number')
          .map((o) => ({ id: o.id, day: Math.floor(o.day) })).slice(-6);
        if (items.length) this.owned[id] = items;
      }
    }
    this.deliveriesToday = Math.max(0, Math.min(10, numOrNull(raw.deliveriesToday) ?? 0));
  }

  restore(data: unknown): void {
    try {
      if (!isObj(data)) return;
      // cảnh đang chạy không được lưu → agent mồ côi sẽ được dọn ở tick đầu
      this.office = null;
      this.online = null;
      this.productLock = null;
      this.nextSweepAt = 0;
      this.seq = int(data.seq, 0, 0, 1e9);
      this.plannedDay = int(data.plannedDay, 0, 0, 1e7);
      this.lastRecapDay = int(data.lastRecapDay, 0, 0, 1e7);
      this.recapList = arrOf(data.recaps).filter(isRecap).sort((a, b) => a.day - b.day).slice(-KEEP_RECAPS);
      this.book = new RumorBook();
      this.book.restore(data.rumors);
      this.queue = arrOf(data.queue).map(parseQ).filter((q): q is QItem => !!q).slice(0, QUEUE_MAX);
      this.timers = arrOf(data.timers).map(parseTimer).filter((t): t is Timer => !!t).slice(0, 20);
      this.summaries = strList(data.summaries, KEEP_SUMMARIES, 200);
      this.recentTopics = strList(data.recentTopics, 14, 120);
      this.dayEvents = strList(data.dayEvents, KEEP_DAY_EVENTS, 200);
      this.notable = strList(data.notable, 25, 200);
      this.firedToday = strList(data.firedToday, 10, 80);
      this.hiredToday = strList(data.hiredToday, 10, 80);
      this.lateToday = numRecord(data.lateToday, 0, 1439);
      this.lateDays = {};
      if (isObj(data.lateDays)) {
        for (const [id, v] of Object.entries(data.lateDays)) {
          const days = arrOf(v).filter((d): d is number => typeof d === 'number' && Number.isFinite(d)).slice(-7);
          if (days.length && id.length <= 80) this.lateDays[id] = days;
        }
      }
      // vị trí MỚI (extra) không bị gộp theo vai trò với vị trí thay người
      this.vacancies = arrOf(data.vacancies).map(parseVacancy).filter((v): v is Vacancy => !!v)
        .filter((v, i, all) => v.extra || all.findIndex((x) => !x.extra && x.role === v.role) === i);
      this.usedNames = strList(data.usedNames, 100, 80);
      this.birthdays = numRecord(data.birthdays, 0, 1e7);
      this.birthdayToday = typeof data.birthdayToday === 'string' ? data.birthdayToday.slice(0, 80) : null;
      this.lastBirthdayDay = int(data.lastBirthdayDay, 0, 0, 1e7);
      this.boost = parseBoost(data.boost);
      this.productBoostUntil = fin(data.productBoostUntil, 0);
      this.recentProducts = strList(data.recentProducts, 8, 80);
      this.restoreShopping(data.shopping);
      this.companyToday = new Set(strList(data.companyToday, 10, 20).filter((r): r is CompanyReason => COMPANY_REASONS.includes(r as CompanyReason)));
      this.actCounts = {};
      if (isObj(data.actCounts)) {
        for (const [id, v] of Object.entries(data.actCounts)) {
          if (!isObj(v) || id.length > 80) continue;
          const c: Partial<Record<Activity, number>> = {};
          for (const act of COUNTED) if (typeof v[act] === 'number' && Number.isFinite(v[act])) c[act] = clamp(Math.floor(v[act] as number), 0, 999);
          this.actCounts[id] = c;
        }
      }
      this.daySawPresence = data.daySawPresence === true;
      if (isObj(data.counters)) {
        for (const k of Object.keys(this.counters) as (keyof Director['counters'])[]) {
          this.counters[k] = int(data.counters[k], this.counters[k], 0, 1e9);
        }
      }
      // ---- v3
      this.story = new Showrunner(Math.max(20, cfgNum(this.cfg, ['showrunnerEveryGameMinutes'], 'SHOWRUNNER_EVERY_GAME_MINUTES', 120)));
      this.ledger = newLedger();
      this.newsUsed = [];
      this.discussedNews = [];
      this.newsCatIdx = 0;
      this.bossStrictUntil = 0;
      this.overtime = null;
      this.lateTomorrow = {};
      this.driftPlans = [];
      if (isObj(data.story)) {
        const st = data.story;
        this.story.restore(st.showrunner);
        this.ledger = restoreLedger(st.ledger);
        this.newsUsed = strList(st.newsUsed, NEWS_USED_KEEP, 120);
        this.discussedNews = arrOf(st.discussedNews).map(parseNewsRef).filter((x): x is NewsRef => !!x).slice(-NEWS_DISCUSSED_KEEP);
        this.newsCatIdx = int(st.newsCatIdx, 0, 0, 99);
        this.bossStrictUntil = fin(st.bossStrictUntil, 0);
        if (isObj(st.overtime) && Array.isArray(st.overtime.ids)) {
          this.overtime = { untilDay: int(st.overtime.untilDay, 0, 0, 1e7), ids: strList(st.overtime.ids, 12, 80), minutes: int(st.overtime.minutes, 90, 0, 240) };
        }
        this.lateTomorrow = numRecord(st.lateTomorrow, 0, 180);
        for (const p of arrOf(st.driftPlans).slice(-30)) {
          if (!isObj(p) || typeof p.id !== 'string' || typeof p.trait !== 'string' || !TRAIT_KEYS.includes(p.trait as keyof Traits)) continue;
          this.driftPlans.push({ id: p.id.slice(0, 80), trait: p.trait as keyof Traits, delta: clamp(fin(p.delta, 0), -0.1, 0.1), days: int(p.days, 1, 1, 30) });
        }
        if (isObj(st.counters)) {
          for (const k of Object.keys(this.v3) as (keyof Director['v3'])[]) this.v3[k] = int(st.counters[k], this.v3[k], 0, 1e9);
        }
      }
    } catch (e) {
      this.err('restore', e);
    }
  }
}

// =====================================================================
//  helper cấp module
// =====================================================================
const ROLE_KEYS: RoleKey[] = ['boss', 'hr', 'techlead', 'senior', 'junior', 'qa', 'designer', 'saleslead', 'salesnew', 'marketing'];
const TIMER_EVENTS: DevEventName[] = ['server_down', 'wifi_down', 'payday', 'birthday', 'deal', 'drama', 'release', 'hr_review', 'news', 'showrunner'];
const TRAIT_KEYS: (keyof Traits)[] = ['diligence', 'laziness', 'gossip', 'temper', 'humor', 'ambition'];
const Q_STR_KEYS = ['targetId', 'reason', 'note', 'name', 'label', 'centerId', 'rumorId', 'initiatorId', 'motiveKey', 'why', 'aboutId',
  'tone', 'variant', 'exclude', 'channel', 'arcId', 'newLabel', 'hint', 'force', 'productId', 'productMode', 'productAngle',
  'kind', 'aId', 'bId'] as const;

function splitIds(v: string | undefined): string[] {
  return typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) : [];
}
function asTone(v: unknown): VisitTone | undefined {
  return v === 'tense' || v === 'warm' || v === 'makeup' || v === 'unbox' || v === 'gift' || v === 'support' ? v : undefined;
}
function asProductMode(v: unknown): ProductMode {
  return v === 'unboxing' || v === 'gift' || v === 'owner' || v === 'showroom' ? v : 'mention';
}
function asBossCallReason(v: unknown): BossCallReason | undefined {
  return v === 'praise' || v === 'scold' || v === 'task' ? v : undefined;
}
function parseNewsRef(raw: unknown): NewsRef | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80), title = str(raw.title, 200), source = str(raw.source, 60), url = str(raw.url, 500);
  if (!id || !title || !url || typeof raw.category !== 'string' || !(NEWS_CATEGORIES as string[]).includes(raw.category)) return null;
  return { id, title, source: source ?? 'báo', url, category: raw.category as NewsCategory };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function int(v: unknown, d: number, min: number, max: number): number {
  const n = numOrNull(v);
  return n === null ? d : clamp(Math.floor(n), min, max);
}
function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  return arrOf(v).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.slice(0, maxLen)).slice(-maxItems);
}
function numRecord(v: unknown, min: number, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    const n = numOrNull(x);
    if (n !== null && k.length <= 80) out[k] = clamp(n, min, max);
  }
  return out;
}

function arr<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** toạ độ của chỗ đang giữ (vd 'pantry_table:3') nếu thuộc nhóm `group` */
function spotPos(spotKey: string | null | undefined, group: string): Pt | null {
  if (typeof spotKey !== 'string') return null;
  const [g, idx] = spotKey.split(':');
  if (g !== group) return null;
  const p = SPOTS[g]?.[Number(idx)];
  return p ? { x: p.x, y: p.y } : null;
}

function asGroupReason(v: unknown): GroupReason {
  return GROUP_REASONS.includes(v as GroupReason) ? (v as GroupReason) : 'random';
}
function asCompanyReason(v: unknown): CompanyReason {
  return COMPANY_REASONS.includes(v as CompanyReason) ? (v as CompanyReason) : 'announce';
}
function asCelebration(v: unknown): CelebrationReason {
  return CELEBRATION_REASONS.includes(v as CelebrationReason) ? (v as CelebrationReason) : 'release';
}

function parseQ(raw: unknown): QItem | null {
  if (!isObj(raw) || !isSceneType(raw.type) || raw.type === 'boss_catch') return null;
  const at = numOrNull(raw.at);
  const until = numOrNull(raw.until);
  if (at === null || until === null) return null;
  const prio: Priority = raw.prio === 'high' || raw.prio === 'normal' || raw.prio === 'low' ? raw.prio : SCENE_DEFS[raw.type].priority;
  const d = isObj(raw.data) ? raw.data : {};
  const data: QData = {};
  for (const k of Q_STR_KEYS) {
    const s = str(d[k], 200);
    if (s) data[k] = s;
  }
  if (typeof d.role === 'string' && ROLE_KEYS.includes(d.role as RoleKey)) data.role = d.role as RoleKey;
  if (typeof d.retries === 'number' && Number.isFinite(d.retries)) data.retries = clamp(Math.floor(d.retries), 0, 5);
  if (raw.type === 'interview' && !data.role) return null;
  return { id: str(raw.id, 40) ?? `q_r${Math.floor(Math.random() * 1e6)}`, type: raw.type, at, until, prio, data, tries: 0 };
}

function parseTimer(raw: unknown): Timer | null {
  if (!isObj(raw)) return null;
  const at = numOrNull(raw.at);
  if (at === null) return null;
  const id = str(raw.id, 40) ?? `t_r${Math.floor(Math.random() * 1e6)}`;
  if (raw.kind === 'clear_incident') {
    const incident = raw.incident === 'server_down' || raw.incident === 'wifi_down' ? raw.incident : undefined;
    return { id, at, kind: 'clear_incident', incident };
  }
  if (raw.kind === 'personal') return { id, at, kind: 'personal', agentId: str(raw.agentId, 80) ?? undefined };
  if (raw.kind === 'theme' || raw.kind === 'theme_end') {
    const themeKey = str(raw.themeKey, 40) ?? undefined;
    return { id, at, kind: raw.kind, ...(themeKey && themeByKey(themeKey) ? { themeKey } : {}) };
  }
  if (raw.kind === 'delivery') {
    const agentId = str(raw.agentId, 80), productId = str(raw.productId, 80);
    if (!agentId || !productId) return null;
    const tries = typeof raw.tries === 'number' && Number.isFinite(raw.tries) ? clamp(Math.floor(raw.tries), 0, 5) : 0;
    // bản lưu cũ chưa có since → tính từ giờ giao đã hẹn
    const since = numOrNull(raw.since) ?? at;
    return { id, at, kind: 'delivery', agentId, productId, tries, since };
  }
  if (raw.kind === 'event' && TIMER_EVENTS.includes(raw.event as DevEventName)) {
    return { id, at, kind: 'event', event: raw.event as DevEventName, agentId: str(raw.agentId, 80) ?? undefined };
  }
  return null;
}

function parseVacancy(raw: unknown): Vacancy | null {
  if (!isObj(raw) || typeof raw.role !== 'string' || !ROLE_KEYS.includes(raw.role as RoleKey)) return null;
  const role = raw.role as RoleKey;
  if (role === 'boss' || role === 'hr') return null;
  const info = roleInfo(role);
  return {
    role,
    roleLabel: str(raw.roleLabel, 60) ?? info?.label ?? role,
    deskId: str(raw.deskId, 40) ?? info?.deskId ?? '',
    kpiTarget: clamp(numOrNull(raw.kpiTarget) ?? info?.kpiTarget ?? 260, 50, 2000),
    replacingName: str(raw.replacingName, 80) ?? undefined,
    rejections: int(raw.rejections, 0, 0, 5),
    since: int(raw.since, 1, 0, 1e7),
    ...(raw.extra === true ? { extra: true } : {}),
  };
}

function parseBoost(raw: unknown): Boost | null {
  if (!isObj(raw)) return null;
  const until = numOrNull(raw.until);
  if (until === null || !GROUP_REASONS.includes(raw.reason as GroupReason)) return null;
  const d = isObj(raw.data) ? raw.data : {};
  const data: ReasonData = {};
  for (const k of ['name', 'label', 'note', 'id'] as const) {
    const s = str(d[k], 120);
    if (s) data[k] = s;
  }
  return { until, reason: raw.reason as GroupReason, data, used: int(raw.used, 0, 0, 99) };
}

function isRecap(v: unknown): v is DayRecap {
  return isObj(v) && typeof v.day === 'number' && Number.isFinite(v.day) && typeof v.headline === 'string'
    && Array.isArray(v.bullets) && Array.isArray(v.kpi) && typeof v.weekday === 'string';
}
