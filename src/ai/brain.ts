// =====================================================================
//  Brain = "bộ não" của văn phòng: quyết định khi nào được gọi AI (tiết kiệm
//  token), gọi AI viết cả cảnh trong 1 JSON, kiểm tra/làm sạch, và LUÔN có
//  đường lui offline. Không bao giờ throw, không bao giờ treo (có hạn chót riêng).
//  Nhiều nhà cung cấp (Gemini → Groq → ...) do router.ts lo; với Director việc
//  chuyển provider là trong suốt: chỉ thấy 'llm' hay 'offline'.
// =====================================================================
import type { Config } from '../config.js';
import type {
  BeatPlan, BeatRequest, Brain, CandidateRequest, DayRecap, Persona, Priority, PromptContext, RecapRequest, RoleKey,
  SceneRequest, SceneResult, UsageStats,
} from '../types.js';
import { COMPANY_INFO } from '../content/catalog.js';
import { pickProduct } from '../content/products.js';
import { LOOK_POOL, DESK_ITEM_TAGS } from '../content/roster.js';
import { describeError, localTimeLabel, LlmError, type LlmTask } from './llm.js';
import { createRouter, type RouterLogger } from './router.js';
import { offlineBeats, offlineCandidate, offlineRecap, offlineScene } from './offline.js';
import {
  buildBeatsSystemPrompt, buildBeatsUserPrompt, buildCandidateUserPrompt, buildRecapUserPrompt, buildSceneUserPrompt,
  buildSystemPrompt,
} from './prompts.js';
import {
  emergencyBeats, emergencyCandidate, emergencyRecap, emergencyScene, sanitizeBeats, sanitizeCandidate, sanitizeRecap,
  sanitizeScene, type CandidateDeps, type Outcome,
} from './sanitize.js';
import {
  BEATS_SCHEMA, BEATS_SCHEMA_NAME, CANDIDATE_SCHEMA, CANDIDATE_SCHEMA_NAME, RECAP_SCHEMA, RECAP_SCHEMA_NAME,
  SCENE_SCHEMA, SCENE_SCHEMA_NAME,
} from './schemas.js';

/** Hạn chót toàn phần (xếp hàng + HTTP + failover). Scene < 35 s Director chờ; beats ~20 s (Director gọi mỗi ~2 giờ game). */
const DEADLINE_MS: Record<LlmTask, number> = { scene: 27_000, candidate: 30_000, recap: 45_000, beats: 20_000 };
/**
 * max_completion_tokens cho model thường (llm.ts nhân 3 với model reasoning). Là TRẦN, không phải chi phí:
 * cảnh 10 câu + ký ức/quan hệ khi model trót viết JSON xuống dòng tốn ~1.000 token → để 1.300 cho khỏi bị cắt ngang.
 */
const MAX_TOKENS: Record<LlmTask, number> = { scene: 1300, candidate: 700, recap: 800, beats: 450 };
const TASK_LABEL: Record<LlmTask, string> = { scene: 'Cảnh', candidate: 'Ứng viên', recap: 'Bản tin', beats: 'Biên kịch' };

/** Lỗi request liên tiếp ≥ 3 (MỌI provider đều thất bại) → tạm nghỉ 60 s, 120 s, ... tối đa 10 phút */
const BREAKER_AFTER = 3;
const BREAKER_BASE_MS = 60_000;
const BREAKER_MAX_MS = 600_000;

/** Tag sản phẩm affiliate cho món đồ trên bàn người mới (SPEC 5.5 + tag thật trong data/products.json) */
/** món đồ trên bàn cho nhân viên mới: tag theo vai (src/content/roster.ts) */
const DESK_TAGS: Record<RoleKey, string[]> = DESK_ITEM_TAGS;

/** Chạy fn với AbortSignal; quá ms thì huỷ và reject ngay. */
function withDeadline<T>(ms: number, label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ac.abort();
      reject(new LlmError('timeout', `Quá ${Math.round(ms / 1000)} giây chưa có kết quả (${label})`));
    }, ms);
    timer.unref?.();
    let work: Promise<T>;
    try {
      work = fn(ac.signal);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    // luôn gắn handler → lời hứa bị bỏ rơi sau timeout không thành unhandled rejection
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const nonNegInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/** Tuỳ chọn phụ (test / smoke): rút ngắn hạn chót, đồng hồ ảo, tắt log giới thiệu. SPEC chỉ cần createBrain(config). */
export interface BrainOptions {
  deadlineMs?: Partial<Record<LlmTask, number>>;
  /**
   * Đồng hồ "giờ thật" (ms) cho nhịp reserve(), cầu dao, cooldown/RPM/RPD của router, chống spam log.
   * Mặc định Date.now; test headless truyền đồng hồ ảo để chạy nhanh mà nhịp vẫn đúng.
   */
  now?: () => number;
  /** Không in dòng giới thiệu provider lúc khởi động (test) */
  quiet?: boolean;
  /** Nơi nhận log của router (mặc định console) */
  log?: Partial<RouterLogger>;
  /** Cửa sổ tối đa cho 1 lượt gọi HTTP của router (test rút ngắn; mặc định 20 s) */
  providerTimeoutMs?: number;
}

export function createBrain(config: Config, opts: BrainOptions = {}): Brain {
  const clock: () => number = typeof opts.now === 'function' ? opts.now : Date.now;
  const router = createRouter(config, { now: clock, quiet: opts.quiet, log: opts.log, providerTimeoutMs: opts.providerTimeoutMs });
  const keys = router.keys;
  const deadline = (task: LlmTask): number => {
    const v = opts.deadlineMs?.[task];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEADLINE_MS[task];
  };
  // TĨNH cho cả tiến trình → prompt cache (prefix = schema + system)
  const system = buildSystemPrompt(config.companyName, COMPANY_INFO);
  // v3: system riêng, nhỏ (~250 token) cho AI biên kịch — cũng tĩnh → cache riêng
  const beatsSystem = buildBeatsSystemPrompt(config.companyName);

  let viewers = 0;
  let lastLlmAt = 0;
  let lastOfflineAt = 0;
  let skipped = 0;
  let failures = 0;
  let lastError: string | undefined;
  let consecutive = 0;
  let breakerUntil = 0;
  let lastWarnAt = 0;
  let suppressedWarns = 0;

  // = SPEC: có ít nhất 1 provider có key → 'llm'
  const mode = (): 'llm' | 'offline' => (router.enabled ? 'llm' : 'offline');
  const breakerOpen = () => clock() < breakerUntil;
  /** có provider gọi được NGAY lúc này (không nghỉ, chưa chạm giới hạn) và cầu dao đóng */
  const llmReady = () => router.enabled && !breakerOpen() && router.anyAvailable();
  const underBudget = () => router.costToday() < config.dailyBudgetUsd;
  const canUseLlm = () => llmReady() && underBudget();

  function warn(msg: string, force = false): void {
    const now = clock();
    if (force || now - lastWarnAt >= 30_000) {
      console.warn(`[ai] ${msg}${suppressedWarns ? ` (+${suppressedWarns} lỗi tương tự đã ẩn)` : ''}`);
      lastWarnAt = now;
      suppressedWarns = 0;
    } else {
      suppressedWarns++;
    }
  }

  function noteApiOk(): void {
    consecutive = 0;
    breakerUntil = 0;
  }

  /** apiLevel = cả request thất bại (mọi provider đã thử đều lỗi / không provider nào sẵn sàng) → tính vào cầu dao */
  function noteFailure(task: LlmTask, err: unknown, apiLevel: boolean): void {
    failures++;
    const msg = typeof err === 'string' ? describeError(err, keys) : describeError(err, keys);
    lastError = `[${localTimeLabel()}] ${TASK_LABEL[task]}: ${msg}`;
    if (apiLevel) {
      consecutive++;
      if (consecutive >= BREAKER_AFTER) {
        const pause = Math.min(BREAKER_BASE_MS * 2 ** (consecutive - BREAKER_AFTER), BREAKER_MAX_MS);
        breakerUntil = clock() + pause;
        warn(`${lastError} → lỗi ${consecutive} lần liên tiếp, tạm dùng thoại offline ${Math.round(pause / 1000)} giây`, true);
        return;
      }
    }
    warn(`${lastError} → dùng thoại offline`);
  }

  // ---------------------------------------------------------------- đường lui offline (không bao giờ throw)

  function offlineSceneSafe(req: SceneRequest, ctx: PromptContext): SceneResult {
    try {
      const r = offlineScene(req, ctx);
      if (r && Array.isArray(r.lines) && r.lines.length > 0) return { ...r, source: 'offline' };
      warn('offlineScene trả kết quả rỗng → dùng cảnh cấp cứu');
    } catch (e) {
      warn(`offlineScene lỗi: ${describeError(e, keys)} → dùng cảnh cấp cứu`);
    }
    return emergencyScene(req, ctx);
  }

  const depsFor = (ctx: PromptContext): CandidateDeps => ({
    lookPool: LOOK_POOL,
    pickDeskItem: (role: RoleKey) => {
      const taken = new Set<string>();
      for (const a of Object.values(ctx.agents ?? {})) {
        if (a && a.status !== 'fired' && a.deskItemProductId) taken.add(a.deskItemProductId);
      }
      const tags = DESK_TAGS[role] ?? ['van-phong'];
      return (pickProduct(tags, taken) ?? pickProduct(tags))?.id;
    },
  });

  function offlineCandidateSafe(req: CandidateRequest, ctx: PromptContext): Persona {
    try {
      const p = offlineCandidate(req, ctx);
      if (p && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name) {
        return { ...p, role: req.role, roleLabel: req.roleLabel, deskId: req.deskId, kpiTarget: req.kpiTarget };
      }
      warn('offlineCandidate trả kết quả không hợp lệ → dùng ứng viên cấp cứu');
    } catch (e) {
      warn(`offlineCandidate lỗi: ${describeError(e, keys)} → dùng ứng viên cấp cứu`);
    }
    try {
      return emergencyCandidate(req, ctx, depsFor(ctx));
    } catch {
      return emergencyCandidate(req, ctx, {});
    }
  }

  function offlineRecapSafe(req: RecapRequest, ctx: PromptContext): DayRecap {
    try {
      const r = offlineRecap(req, ctx);
      if (r && typeof r.headline === 'string' && Array.isArray(r.bullets)) return { ...r, source: 'offline' };
      warn('offlineRecap trả kết quả không hợp lệ → dùng bản tin cấp cứu');
    } catch (e) {
      warn(`offlineRecap lỗi: ${describeError(e, keys)} → dùng bản tin cấp cứu`);
    }
    return emergencyRecap(req, ctx);
  }

  function offlineBeatsSafe(req: BeatRequest, ctx: PromptContext): BeatPlan {
    try {
      const r = offlineBeats(req, ctx);
      if (r && Array.isArray(r.beats)) return { beats: r.beats, source: 'offline' };
      warn('offlineBeats trả kết quả không hợp lệ → không có biến nào');
    } catch (e) {
      warn(`offlineBeats lỗi: ${describeError(e, keys)} → không có biến nào`);
    }
    return emergencyBeats();
  }

  // ---------------------------------------------------------------- Brain API

  function reserve(priority: Priority): 'llm' | 'offline' | null {
    const now = clock();
    // không có key, mọi provider đang nghỉ/hết lượt, hoặc cầu dao mở → nhịp offline (văn phòng không bao giờ im)
    if (!llmReady()) {
      if (priority === 'high' || now - lastOfflineAt >= config.offlineMinSeconds * 1000) {
        lastOfflineAt = now;
        return 'offline';
      }
      return null;
    }
    if (!underBudget() || (config.llmOnlyWhenWatched && viewers === 0)) {
      if (priority === 'high') return 'offline';
      skipped++;
      return null;
    }
    if (router.inflight() >= Math.max(1, config.maxConcurrentLlm)) {
      if (priority !== 'high') return null;
      lastLlmAt = now; // cảnh quan trọng vẫn được AI, xếp hàng chờ slot
      return 'llm';
    }
    const gap = config.minSecondsBetweenLlm * 1000;
    if (priority === 'low' && now - lastLlmAt < gap) return null;
    if (priority === 'normal' && now - lastLlmAt < gap / 2) return null;
    lastLlmAt = now;
    return 'llm';
  }

  /** Gọi AI cho 1 nhiệm vụ; null = thất bại (đã ghi nhận lỗi) → caller dùng offline. */
  async function runLlm<T>(
    task: LlmTask,
    priority: Priority,
    buildUser: () => string,
    schemaName: string,
    schema: Record<string, unknown>,
    accept: (data: unknown) => Outcome<T>,
    systemText: string = system,
  ): Promise<T | null> {
    let user: string;
    try {
      user = buildUser();
    } catch (e) {
      noteFailure(task, `Không dựng được prompt: ${describeError(e, keys)}`, false);
      return null;
    }
    let data: unknown;
    try {
      const ms = deadline(task);
      const deadlineAt = Date.now() + ms;
      const res = await withDeadline(ms, TASK_LABEL[task].toLowerCase(), (signal) => router.complete({
        task, system: systemText, user, schemaName, schema, maxTokens: MAX_TOKENS[task], signal, priority, deadlineAt,
      }));
      data = res.data;
      noteApiOk();
    } catch (e) {
      noteFailure(task, e, true);
      return null;
    }
    try {
      const out = accept(data);
      if (out.ok) return out.value;
      noteFailure(task, `Kết quả AI không dùng được: ${out.reason}`, false);
    } catch (e) {
      noteFailure(task, `Lỗi khi kiểm tra kết quả: ${describeError(e, keys)}`, false);
    }
    return null;
  }

  async function generateScene(req: SceneRequest, ctx: PromptContext, via: 'llm' | 'offline'): Promise<SceneResult> {
    try {
      if (via !== 'llm' || !llmReady()) return offlineSceneSafe(req, ctx);
      const r = await runLlm('scene', req.priority ?? 'normal', () => buildSceneUserPrompt(req, ctx), SCENE_SCHEMA_NAME, SCENE_SCHEMA,
        (d) => sanitizeScene(d, req, ctx));
      return r ?? offlineSceneSafe(req, ctx);
    } catch (e) {
      warn(`generateScene lỗi bất ngờ: ${describeError(e, keys)}`);
      return emergencyScene(req, ctx);
    }
  }

  async function generateCandidate(req: CandidateRequest, ctx: PromptContext): Promise<Persona> {
    try {
      if (!canUseLlm()) return offlineCandidateSafe(req, ctx);
      const r = await runLlm('candidate', 'high', () => buildCandidateUserPrompt(req, ctx), CANDIDATE_SCHEMA_NAME, CANDIDATE_SCHEMA,
        (d) => sanitizeCandidate(d, req, ctx, depsFor(ctx)));
      return r ?? offlineCandidateSafe(req, ctx);
    } catch (e) {
      warn(`generateCandidate lỗi bất ngờ: ${describeError(e, keys)}`);
      return emergencyCandidate(req, ctx, {});
    }
  }

  async function generateRecap(req: RecapRequest, ctx: PromptContext): Promise<DayRecap> {
    try {
      if (!canUseLlm()) return offlineRecapSafe(req, ctx);
      const r = await runLlm('recap', 'high', () => buildRecapUserPrompt(req, ctx), RECAP_SCHEMA_NAME, RECAP_SCHEMA,
        (d) => sanitizeRecap(d, req, ctx));
      return r ?? offlineRecapSafe(req, ctx);
    } catch (e) {
      warn(`generateRecap lỗi bất ngờ: ${describeError(e, keys)}`);
      return emergencyRecap(req, ctx);
    }
  }

  /**
   * v3: AI biên kịch. Không cần reserve() (Director gọi tối đa mỗi ~2 giờ game) nhưng vẫn tôn trọng trần ngân sách ngày
   * và luật "không ai xem thì không gọi AI"; lỗi / JSON hỏng → kế hoạch offline (ngẫu nhiên có trọng số). Không bao giờ throw.
   */
  async function generateBeats(req: BeatRequest, ctx: PromptContext): Promise<BeatPlan> {
    try {
      if (!canUseLlm() || (config.llmOnlyWhenWatched && viewers === 0)) return offlineBeatsSafe(req, ctx);
      const r = await runLlm('beats', 'normal', () => buildBeatsUserPrompt(req, ctx), BEATS_SCHEMA_NAME, BEATS_SCHEMA,
        (d) => sanitizeBeats(d, req, ctx), beatsSystem);
      return r ?? offlineBeatsSafe(req, ctx);
    } catch (e) {
      warn(`generateBeats lỗi bất ngờ: ${describeError(e, keys)}`);
      return emergencyBeats();
    }
  }

  function usage(): UsageStats {
    const s = router.stats();
    return {
      // 'llm' = đang có provider gọi được ngay → chip AI trên web giữ nguyên cách hiển thị cũ
      mode: llmReady() ? 'llm' : 'offline',
      model: s.activeModel || config.model,
      calls: s.calls,
      failures,
      inputTokens: s.inputTokens,
      cachedTokens: s.cachedTokens,
      outputTokens: s.outputTokens,
      costTodayUsd: s.costTodayUsd,
      costTotalUsd: s.costTotalUsd,
      budgetUsd: config.dailyBudgetUsd,
      skipped,
      ...(lastError ? { lastError } : {}),
      ...(s.activeProvider ? { activeProvider: s.activeProvider } : {}),
      ...(s.providers.length ? { providers: s.providers } : {}),
    };
  }

  return {
    mode,
    reserve,
    generateScene,
    generateCandidate,
    generateRecap,
    generateBeats,
    setAudience(n: number) {
      viewers = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    },
    usage,
    serialize() {
      return { v: 2, router: router.serialize(), failures, skipped };
    },
    restore(data: unknown) {
      try {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        const d = data as Record<string, unknown>;
        // v2: { router: {...} }; v1 (bản cũ, 1 provider): số liệu nằm ngay ở gốc
        router.restore(d.router && typeof d.router === 'object' ? d.router : d);
        failures = nonNegInt(d.failures) ?? failures;
        skipped = nonNegInt(d.skipped) ?? skipped;
      } catch {
        /* dữ liệu rác → giữ nguyên trạng thái hiện tại */
      }
    },
  };
}
