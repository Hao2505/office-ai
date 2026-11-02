// =====================================================================
//  EYEBALL hr_review qua AI THẬT (không nằm trong `npm test` — cần key trong .env, tốn vài lượt gọi).
//  Chạy World + Director OFFLINE vài ngày game để có số liệu KPI thật, dựng hồ sơ y như Director, rồi gọi Brain
//  (router Gemini → Groq theo .env) đúng một cảnh hr_review và in thoại + hrDecisions + nguồn để người đọc tự đánh giá:
//  thoại có hứa thứ vượt TRẦN không, có đọc mã action không, quyết định có nằm trong "được phép" không.
//
//  npm run eyeball:hr                 (mặc định 6 ngày game, 1 cảnh)
//  EYEBALL_DAYS=9 EYEBALL_SCENES=2 npm run eyeball:hr
//  Không bao giờ in API key. Không ghi data/state.json, archive ghi vào thư mục tạm rồi xoá.
// =====================================================================
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, DirectorApi, KpiResult, PromptContext, SceneRequest, ServerMsg } from '../src/types.js';
import { CONFIG } from '../src/config.js';
import { createBrain } from '../src/ai/brain.js';
import { World } from '../src/sim/world.js';
import { Director } from '../src/sim/director.js';
import { getArchive } from '../src/sim/archive.js';
import { configureNews } from '../src/news/index.js';
import { buildDossier, newLedger, revenueRatio, validateDecisions, ACTION_LABEL } from '../src/sim/hr.js';
import { SCENE_DEFS, sitHrReview, snapOf } from '../src/sim/scenes.js';
import { isNewsSafe } from '../src/ai/sanitize.js';

const DAYS = Math.max(2, Math.floor(Number(process.env.EYEBALL_DAYS) || 6));
const SCENES = Math.max(1, Math.min(3, Math.floor(Number(process.env.EYEBALL_SCENES) || 1)));
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

if (!CONFIG.providers.length) {
  console.log('⚠️  Không có provider AI nào trong .env (AI_PROVIDERS / key) — không có gì để eyeball.');
  process.exit(0);
}

// ---------------------------------------------------------------- 1. mô phỏng offline vài ngày để có KPI thật
const HISTORY_DIR = mkdtempSync(join(tmpdir(), 'vpa-eyeball-'));
configureNews({ enabled: false, feeds: [] });
const archive = getArchive().configure({ enabled: true, dir: HISTORY_DIR, keepDays: 180, gzipAfterDays: 7, flushMs: 500 }).start();
const simConfig = { ...CONFIG, openaiKey: '', providers: [], persist: false, timeMode: 'compressed' as const, devPanel: true, newsEnabled: false, historyEnabled: true, historyDir: HISTORY_DIR };
let vt = Date.now();
const realNow = (): number => vt;
const quietLog = console.log.bind(console);
console.log = () => { /* im lặng trong lúc mô phỏng */ };
const offlineBrain = createBrain(simConfig, { now: realNow, quiet: true });
const world = new World({ config: simConfig, brain: offlineBrain, emit: (_m: ServerMsg) => { /* bỏ */ }, now: realNow });
const director = new Director(world, offlineBrain);
const spy: DirectorApi = {
  tick: (dt) => director.tick(dt), onDayStart: (d) => director.onDayStart(d), onDayEnd: (d: number, r: KpiResult[]) => director.onDayEnd(d, r),
  onEvent: (n, data) => director.onEvent(n, data), onBossLeft: (r) => director.onBossLeft(r), onBossReturned: () => director.onBossReturned(),
  onSlackerSpotted: (b, v) => director.onSlackerSpotted(b, v), onAgentArrived: (id, late) => director.onAgentArrived(id, late),
  publicScenes: () => director.publicScenes(), recaps: () => director.recaps(), rumors: () => director.rumors(),
  serialize: () => director.serialize(), restore: (d) => director.restore(d),
};
world.attachDirector(spy);
world.handleClient({ t: 'dev', action: 'speed', value: 10 });
let steps = 0;
while (world.day() <= DAYS && steps < 2_000_000) {
  vt += 100;
  world.advance(100);
  steps++;
  if (steps % 2000 === 0) await new Promise((r) => setImmediate(r));
}
// kéo tới 10:15 sáng để có người trong văn phòng
while (world.minuteOfDay() < 615 && steps < 2_200_000) { vt += 100; world.advance(100); steps++; }
console.log = quietLog;
const hr = world.hr();
const boss = world.boss();
if (!hr || !boss) { console.log('⚠️  Không có HR / sếp.'); process.exit(1); }

// ---------------------------------------------------------------- 2. hồ sơ y như Director + tình huống
const ledger = newLedger();
const env = { day: world.day(), headcount: world.headcount(), hasOpenPosition: false, freeDesk: false, revenueRatio: revenueRatio(world) };
const dossier = buildDossier(world, CONFIG, ledger, env);
const kit = { w: world, facts: (_a: AgentState) => [] as string[], recent: [] as string[], snap: (id: string) => { const a = world.agent(id); return a ? snapOf(a) : undefined; } };
const sit = sitHrReview(kit, hr, boss, dossier, []);
const def = SCENE_DEFS.hr_review;
const req: SceneRequest = {
  sceneId: 'eyeball_hr', type: 'hr_review', channel: 'office', locationLabel: 'Phòng Giám đốc', situation: sit.situation, extra: sit.extra.slice(0, 6),
  participants: [hr.id, boss.id], minLines: def.minLines, maxLines: def.maxLines, allowedEffects: [...def.effects], priority: 'high', hrDossier: dossier,
};
const agents: Record<string, AgentState> = {};
for (const a of world.agents()) agents[a.id] = a;
const ctx: PromptContext = {
  companyName: CONFIG.companyName, company: world.company(), day: world.day(), minuteOfDay: world.minuteOfDay(), weekday: world.weekday(),
  timeLabel: hhmm(world.minuteOfDay()), agents, roster: world.activeAgents().map((a) => ({ id: a.id, name: a.name, roleLabel: a.roleLabel })),
  recentSummaries: [], bossAway: false, bossNote: 'đang trong cảnh này',
};

console.log(`👁  eyeball hr_review — ngày ${world.day()} ${ctx.timeLabel}, ${dossier.length} người trong hồ sơ, doanh thu ${Math.round(env.revenueRatio * 100)}% nhịp`);
console.log('HỒ SƠ (được phép):');
for (const d of dossier) console.log(`  - ${d.name.padEnd(6)} KPI ${d.kpiRatios.map((r) => Math.round(r * 100)).join('→')}% · thấp ${d.lowStreak} · nhắc ${d.warnings} · ${d.allowed.join(', ')}`);

// ---------------------------------------------------------------- 3. gọi AI thật
const brain = createBrain(CONFIG, { now: () => Date.now(), quiet: false });
brain.setAudience(1);
for (let i = 0; i < SCENES; i++) {
  const t0 = performance.now();
  const res = await brain.generateScene({ ...req, sceneId: `eyeball_hr_${i}` }, ctx, 'llm');
  const u = brain.usage();
  console.log(`\n── Cảnh ${i + 1}: nguồn ${res.source} · ${res.lines.length} câu · ${((performance.now() - t0) / 1000).toFixed(1)}s · model ${u.model ?? '?'}${u.lastError ? ` · lỗi gần nhất: ${u.lastError}` : ''}`);
  for (const l of res.lines) console.log(`  ${agents[l.speaker]?.name ?? l.speaker}: ${l.text}${l.emote ? ` ${l.emote}` : ''}`);
  console.log(`  tóm tắt: ${res.summary}`);
  const decisions = Array.isArray(res.hrDecisions) ? res.hrDecisions : [];
  const { applied, rejected } = validateDecisions(decisions, dossier);
  console.log(`  hrDecisions (${decisions.length}): ${decisions.map((d) => `${agents[d.id]?.name ?? (d.id || 'cty')}:${d.action}`).join(', ') || '—'}`);
  console.log(`  → thi hành ${applied.length} (${applied.map((d) => `${ACTION_LABEL[d.action]} ${agents[d.id]?.name ?? ''}`).join(', ') || '—'}), gác lại ${rejected.length}${rejected.length ? ` (${rejected.map((r) => r.why).join('; ')})` : ''}`);
  const codes = res.lines.filter((l) => /\b(praise|bonus|warn|probation|second_chance|promote|layoff|fire)\b/i.test(l.text)).length;
  const unsafe = res.lines.filter((l) => !isNewsSafe(l.text)).length;
  console.log(`  kiểm nhanh: câu đọc mã action ${codes} · câu không tiếng Việt / vi phạm ${unsafe} · mọi quyết định trong allowed: ${rejected.every((r) => !/hàng rào/.test(r.why)) ? 'có' : 'KHÔNG'}`);
}
archive.stop();
rmSync(HISTORY_DIR, { recursive: true, force: true });
process.exit(0);
