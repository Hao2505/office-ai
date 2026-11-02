// Trạng thái phía client + xử lý thông điệp từ server (ServerMsg trong src/types.ts).
import { clamp, num, str, arr, warnOnce } from './util.js';
import { ROLE_ORDER } from './labels.js';

const listeners = new Map();

export const store = {
  ready: false, // đã nhận hello
  conn: 'connecting', // 'connecting' | 'open' | 'closed'
  map: null,
  companyName: '',
  dev: false,
  /** luật KPI từ server (hello.rules); mặc định = SPEC */
  rules: { kpiLowRatio: 0.7, kpiWarnDays: 2, kpiFireDays: 3 },
  clock: null,
  status: null,
  agents: new Map(), // id -> PublicAgent
  lookCache: new Map(), // id -> look (giữ cả người đã nghỉ để vẽ avatar trong feed cũ)
  nameCache: new Map(), // id -> name
  scenes: new Map(), // cảnh đang diễn
  sceneMeta: new Map(), // mọi cảnh đã thấy (để vẽ thẻ tiêu đề)
  recaps: [],
  rumors: [],
  products: [], // ShowroomProduct[] (hello.products, v2) — đã kiểm tra & chuẩn hoá
  news: [], // NewsRef[] (v3: hello.news + tin của các cảnh news_chat đã thấy), mới nhất CUỐI, tối đa 30
  actors: new Map(), // id -> trạng thái vẽ (nội suy từ frame)
  bubbles: [], // bong bóng thoại trên map
  typing: new Map(), // speakerId -> { from, until }
  pings: new Map(), // speakerId -> thời điểm vừa nhắn trong nhóm chat
  frameDt: 200,
  lastFrameAt: 0,
  helloAt: 0,

  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { warnOnce('listener lỗi', type, e); }
    }
  },
  /** danh sách agent theo thứ tự phòng ban (active trước, rồi ứng viên, rồi đã nghỉ) */
  roster() {
    const list = [...this.agents.values()];
    const rank = (a) => (a.status === 'active' ? 0 : a.status === 'candidate' ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b)
      || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
      || (a.hiredDay || 0) - (b.hiredDay || 0));
  },
  name(id) {
    const n = this.agents.get(id)?.name || this.nameCache.get(id);
    if (n) return n;
    // người đã nghỉ trước khi mở trang: đừng hiện id thô kiểu "bao"
    return typeof id === 'string' && /^[a-z]{2,12}$/.test(id) ? id[0].toUpperCase() + id.slice(1) : id || '?';
  },
  look(id) {
    return this.agents.get(id)?.look || this.lookCache.get(id) || null;
  },
  /** chủ bàn (nhân viên chính thức đang dùng deskId) */
  deskOwner(deskId) {
    for (const a of this.agents.values()) {
      if (a.deskId === deskId && a.status === 'active') return a;
    }
    return null;
  },
  // ---- v2: phòng trưng bày
  productById(id) {
    return this.products.find((p) => p.id === id) || null;
  },
  /** { beauty: [...], tech: [...] } đã sắp theo slot */
  productsByShelf() {
    const out = { beauty: [], tech: [] };
    for (const p of this.products) (out[p.shelf] || out.tech).push(p);
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.slot - b.slot);
    return out;
  },
  /** actor đang ẩn (trong WC, FrameAgent flag 8) — canvas không vẽ những người này */
  hiddenActors() {
    return [...this.actors.values()].filter((a) => (a.flags & 8) && !a.goneAt);
  },
  /** có ai đang trong WC không (để vẽ "Có người" trên cửa) */
  wcOccupied() {
    return this.hiddenActors().length > 0;
  },
};

/** chuẩn hoá một ShowroomProduct từ server (bỏ phần tử hỏng) */
function normProduct(p, i) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) return null;
  const category = p.category === 'lam-dep' ? 'lam-dep' : 'cong-nghe';
  const shelf = p.shelf === 'beauty' || p.shelf === 'tech' ? p.shelf : category === 'lam-dep' ? 'beauty' : 'tech';
  return {
    id: str(p.id, 60),
    name: str(p.name, 120).trim(),
    emoji: str(p.emoji || '🛍️', 8),
    priceHint: str(p.priceHint || '', 24),
    url: typeof p.url === 'string' ? p.url : '',
    category, shelf,
    slot: Number.isFinite(Number(p.slot)) ? Number(p.slot) : i,
    note: str(p.note || '', 300).trim(),
    image: typeof p.image === 'string' ? p.image : '',
    tags: arr(p.tags).filter((t) => typeof t === 'string').slice(0, 12),
  };
}

/** chuẩn hoá một NewsRef (v3) từ server: cần title; url giữ nguyên (UI chỉ gắn link khi là http/https) */
export function normNewsRef(n) {
  if (!n || typeof n !== 'object' || typeof n.title !== 'string' || !n.title.trim()) return null;
  const url = typeof n.url === 'string' ? n.url.trim().slice(0, 1000) : '';
  const title = str(n.title.trim(), 220);
  return {
    id: str(typeof n.id === 'string' && n.id ? n.id : url || title, 160),
    title,
    source: str(typeof n.source === 'string' ? n.source.trim() : '', 40),
    url,
    category: typeof n.category === 'string' ? n.category.slice(0, 20) : '',
  };
}

/** ghi nhớ tin đang bàn (mới nhất cuối, trùng id/url thì đưa lên mới nhất); trả về true nếu danh sách đổi */
function rememberNews(raw) {
  const n = normNewsRef(raw);
  if (!n) return false;
  const i = store.news.findIndex((x) => x.id === n.id || (n.url && x.url === n.url));
  if (i === store.news.length - 1 && i >= 0) return false; // đã là tin mới nhất
  if (i >= 0) store.news.splice(i, 1);
  store.news.push(n);
  while (store.news.length > 30) store.news.shift();
  return true;
}

export function bubbleDuration(text) {
  return clamp(1600 + 55 * String(text || '').length, 2200, 7500);
}

// ---------------------------------------------------------------- nội suy chuyển động với bộ đệm chống giật
// Server gửi 'frame' mỗi 200 ms kèm `ts` (giờ server lúc gửi). Qua Cloudflare/VPS các gói đến so le (100 / 300 ms…),
// nếu vẽ theo lúc gói TỚI thì nhân vật đi–khựng–đi. Cách làm: mỗi frame được gán mốc `ft` trên trục performance.now()
// suy từ `ts` (neo ở frame đầu, nên không phụ thuộc lệch đồng hồ), giữ vài khung hình gần nhất cho từng actor, và
// vẽ "trễ" một bộ đệm `store.net.buffer` ms: tại thời điểm vẽ, tìm 2 khung hình kẹp mốc đó rồi nội suy tuyến tính.
// Bộ đệm tự nới khi gói đến muộn, tự siết dần khi đường mạng êm. Server cũ không có `ts` → dùng lúc gói tới (như trước).
const NET_BUFFER_MIN = 260, NET_BUFFER_MAX = 700, NET_BUFFER_START = 340;
const NET_SLACK_MIN = 60;     // frame phải tới sớm hơn lúc cần vẽ ít nhất chừng này, không thì nới bộ đệm
const KF_MAX = 10;            // số khung hình giữ lại cho mỗi actor
const TELEPORT_TILES = 3.2;   // nhảy xa hơn mức này giữa 2 khung hình = dịch chuyển tức thời (vào/ra WC, mới xuất hiện)

store.net = {
  tsBase: null, localBase: 0,  // neo: ts của frame đầu ↔ performance.now() lúc frame đầu tới
  buffer: NET_BUFFER_START,    // ms vẽ trễ so với mốc frame mới nhất
  minSlack: Infinity, window: 0, // thống kê trong cửa sổ 40 frame để siết bộ đệm
  lateFrames: 0, frames: 0,
};

/** mốc thời gian (trục performance.now()) của frame vừa tới */
function frameTime(ts, now) {
  const n = store.net;
  if (!Number.isFinite(ts)) return now;
  if (n.tsBase === null || Math.abs((ts - n.tsBase) - (now - n.localBase)) > 60_000) { n.tsBase = ts; n.localBase = now; }
  const ft = n.localBase + (ts - n.tsBase);
  // slack = còn bao lâu nữa frame này mới cần được vẽ; âm/nhỏ = gói tới muộn → nới bộ đệm ngay
  const slack = ft - (now - n.buffer);
  n.frames++;
  if (slack < NET_SLACK_MIN) { n.buffer = Math.min(NET_BUFFER_MAX, n.buffer + (NET_SLACK_MIN - slack)); n.lateFrames++; }
  n.minSlack = Math.min(n.minSlack, slack);
  if (++n.window >= 40) {
    // cả 40 frame đều tới sớm hơn mức cần nhiều → giảm bộ đệm một phần để bớt trễ (không bao giờ dưới sàn)
    if (n.minSlack > NET_SLACK_MIN + 80) n.buffer = Math.max(NET_BUFFER_MIN, n.buffer - (n.minSlack - NET_SLACK_MIN - 40) / 2);
    n.minSlack = Infinity; n.window = 0;
  }
  return ft;
}

/** thêm khung hình vị trí cho actor (ft = mốc trên trục performance.now()) */
function pushKeyframe(a, ft, x, y) {
  const kf = a.kf;
  const last = kf.length ? kf[kf.length - 1] : null;
  if (last && ft <= last.t) { last.x = x; last.y = y; return; } // cùng mốc / ngược thời gian: ghi đè
  const jump = !!last && Math.hypot(x - last.x, y - last.y) > TELEPORT_TILES;
  kf.push({ t: ft, x, y, jump });
  if (kf.length > KF_MAX) kf.splice(0, kf.length - KF_MAX);
}

/** vị trí nội suy của actor tại thời điểm now (vẽ trễ store.net.buffer ms so với frame mới nhất) */
export function actorPos(a, now) {
  const kf = a.kf;
  if (!kf || kf.length === 0) return { x: a.x, y: a.y };
  const rt = now - store.net.buffer;
  const last = kf[kf.length - 1];
  if (rt >= last.t || kf.length === 1) { a.t0 = last.t; a.dur = 0; return { x: last.x, y: last.y }; }
  if (rt <= kf[0].t) { a.t0 = kf[0].t; a.dur = 0; return { x: kf[0].x, y: kf[0].y }; }
  let i = kf.length - 2;
  while (i > 0 && kf[i].t > rt) i--;
  const p = kf[i], q = kf[i + 1];
  a.t0 = p.t; a.dur = q.t - p.t;
  if (q.jump) return { x: p.x, y: p.y }; // dịch chuyển tức thời: đứng ở chỗ cũ tới đúng mốc rồi mới nhảy
  const k = a.dur > 0 ? clamp((rt - p.t) / a.dur, 0, 1) : 1;
  return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
}

/** học tên người (kể cả người đã nghỉ) từ log / bản tin / tin đồn để tin cũ vẫn hiện đúng tên có dấu */
function learnName(id, name) {
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return;
  if (!store.nameCache.has(id)) store.nameCache.set(id, str(name, 40));
}
function learnNames(msg) {
  for (const e of arr(msg.log)) if (e && e.kind === 'line') learnName(e.speaker, e.speakerName);
  for (const r of arr(msg.recaps)) {
    for (const k of arr(r?.kpi)) learnName(k?.id, k?.name);
    if (r?.mvp) learnName(r.mvp.id, r.mvp.name);
  }
  for (const r of arr(msg.rumors)) learnName(r?.aboutId, r?.aboutName);
}

function rememberAgent(a) {
  if (!a || typeof a.id !== 'string') return;
  if (a.look) store.lookCache.set(a.id, a.look);
  if (a.name) store.nameCache.set(a.id, a.name);
}

function setAgents(list) {
  const next = new Map();
  for (const a of arr(list)) {
    if (!a || typeof a.id !== 'string') continue;
    next.set(a.id, a);
    rememberAgent(a);
  }
  store.agents = next;
}

function rememberScene(sc) {
  if (!sc || typeof sc.id !== 'string') return;
  const prev = store.sceneMeta.get(sc.id);
  store.sceneMeta.set(sc.id, { ...(prev || {}), ...sc });
  if (store.sceneMeta.size > 300) {
    const first = store.sceneMeta.keys().next().value;
    store.sceneMeta.delete(first);
  }
}

function newActor(id, x, y, now) {
  return {
    id, kf: [{ t: now, x, y, jump: false }], t0: now, dur: 0,
    x, y, dir: 'down', activity: 'idle', emote: '', flags: 0,
    emoteAt: 0, bornAt: now, goneAt: 0, seenAt: now,
    phase: 0, lastX: x, lastY: y, moveAmt: 0,
    deskAct: null, seed: (Math.random() * 1000) | 0,
  };
}

function onFrame(msg) {
  const now = performance.now();
  if (store.lastFrameAt) {
    const dt = now - store.lastFrameAt;
    if (dt > 40 && dt < 1500) store.frameDt = store.frameDt * 0.8 + dt * 0.2;
  }
  store.lastFrameAt = now;
  if (msg.clock) store.clock = msg.clock;
  const ft = frameTime(num(msg.ts, NaN), now);
  const seen = new Set();
  for (const fa of arr(msg.a)) {
    if (!Array.isArray(fa) || fa.length < 7) continue;
    const [id, x, y, dir, activity, emote, flags] = fa;
    if (typeof id !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen.add(id);
    let a = store.actors.get(id);
    if (!a) {
      a = newActor(id, x, y, ft);
      store.actors.set(id, a);
    } else {
      if (a.goneAt) { a.goneAt = 0; a.bornAt = now - 400; a.kf = []; }
      pushKeyframe(a, ft, x, y);
    }
    const em = typeof emote === 'string' ? emote : '';
    if (a.emote !== em) { a.emote = em; a.emoteAt = now; }
    a.dir = dir === 'up' || dir === 'left' || dir === 'right' ? dir : 'down';
    a.activity = typeof activity === 'string' ? activity : 'idle';
    a.flags = num(flags) | 0;
    a.seenAt = now;
    if (a.activity === 'working' || a.activity === 'slacking' || a.activity === 'napping') {
      a.deskAct = { activity: a.activity, emote: em };
    }
  }
  for (const a of store.actors.values()) {
    if (!seen.has(a.id) && !a.goneAt) a.goneAt = now;
  }
  store.emit('frame', msg.clock);
}

function onLog(msg) {
  const e = msg.entry;
  if (!e || typeof e !== 'object' || typeof e.text !== 'string') return;
  const now = performance.now();
  if (e.kind === 'line' && typeof e.speaker === 'string') {
    learnName(e.speaker, e.speakerName);
    const ch = e.channel || 'office';
    if (ch === 'office') {
      const dur = clamp(num(msg.bubble?.durationMs, bubbleDuration(e.text)), 700, 15000);
      store.bubbles = store.bubbles.filter((b) => b.speaker !== e.speaker && now - b.t0 < b.dur + 400);
      store.typing.delete(e.speaker);
      store.bubbles.push({
        key: e.id, speaker: e.speaker, name: str(e.speakerName || store.name(e.speaker), 40),
        text: str(e.text, 400), icon: str(e.icon || '', 8), product: e.product || null,
        t0: now, dur,
      });
      if (store.bubbles.length > 5) store.bubbles.shift();
      const next = msg.bubble?.nextSpeaker;
      if (typeof next === 'string' && next !== e.speaker) {
        store.typing.set(next, { from: now + Math.max(dur * 0.6, dur - 1100), until: now + dur + 2600 });
      }
    } else {
      store.pings.set(e.speaker, now);
    }
  }
  if (e.kind === 'scene_end' && e.sceneId) {
    const sc = store.sceneMeta.get(e.sceneId);
    if (sc) for (const p of arr(sc.participants)) store.typing.delete(p);
  }
  // v3: thẻ tin gốc đi kèm cảnh news_chat -> cập nhật dải "Tin đang bàn"
  if (e.kind === 'scene_start' && e.news && rememberNews(e.news)) store.emit('news', store.news);
  store.emit('log', { entry: e, live: true });
}

function onScene(msg) {
  const sc = msg.scene;
  if (!sc || typeof sc.id !== 'string') return;
  rememberScene(sc);
  if (sc.status === 'end') {
    store.scenes.delete(sc.id);
    for (const p of arr(sc.participants)) store.typing.delete(p);
  } else {
    store.scenes.set(sc.id, sc);
    if (sc.news && rememberNews(sc.news)) store.emit('news', store.news);
  }
  store.emit('scene', sc);
}

function onHello(msg) {
  store.ready = true;
  store.helloAt = performance.now();
  store.map = msg.map || null;
  store.companyName = str(msg.companyName || 'Văn Phòng Ảo', 80);
  store.dev = !!msg.dev;
  const r = msg.rules && typeof msg.rules === 'object' ? msg.rules : {};
  store.rules = {
    kpiLowRatio: clamp(num(r.kpiLowRatio, 0.7), 0.05, 2),
    kpiWarnDays: Math.max(1, Math.round(num(r.kpiWarnDays, 2))),
    kpiFireDays: Math.max(1, Math.round(num(r.kpiFireDays, 3))),
  };
  store.clock = msg.clock || null;
  store.status = msg.status || null;
  setAgents(msg.agents);
  learnNames(msg);
  store.scenes = new Map();
  for (const sc of arr(msg.scenes)) {
    if (sc && typeof sc.id === 'string') { store.scenes.set(sc.id, sc); rememberScene(sc); }
  }
  store.recaps = arr(msg.recaps).filter((r) => r && typeof r === 'object');
  store.rumors = arr(msg.rumors).filter((r) => r && typeof r === 'object');
  store.products = arr(msg.products).map(normProduct).filter(Boolean).slice(0, 60);
  // v3: tin đang bàn — học từ log cũ / cảnh đang diễn trước, rồi hello.news (mới nhất cuối) đè lên thứ tự
  store.news = [];
  for (const e of arr(msg.log)) if (e && e.kind === 'scene_start' && e.news) rememberNews(e.news);
  for (const sc of arr(msg.scenes)) if (sc && sc.news) rememberNews(sc.news);
  for (const n of arr(msg.news)) rememberNews(n);
  store.actors = new Map();
  store.bubbles = [];
  store.typing = new Map();
  store.pings = new Map();
  store.lastFrameAt = 0;
  store.emit('hello', msg);
  store.emit('agents', store.agents);
  store.emit('status', store.status);
  store.emit('recaps', store.recaps);
  store.emit('rumors', store.rumors);
  store.emit('products', store.products);
  store.emit('news', store.news);
}

/** điểm vào duy nhất cho mọi ServerMsg */
export function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  try {
    switch (msg.t) {
      case 'hello': onHello(msg); break;
      case 'frame': if (store.ready) onFrame(msg); break;
      case 'agents': setAgents(msg.agents); store.emit('agents', store.agents); break;
      case 'status': if (msg.status) { store.status = msg.status; store.emit('status', msg.status); } break;
      case 'log': onLog(msg); break;
      case 'scene': onScene(msg); break;
      case 'recap':
        if (msg.recap && typeof msg.recap === 'object') {
          store.recaps = [...store.recaps.filter((r) => r.day !== msg.recap.day), msg.recap].slice(-14);
          store.emit('recaps', store.recaps);
          store.emit('recap', msg.recap);
        }
        break;
      case 'rumors': store.rumors = arr(msg.rumors).filter((r) => r && typeof r === 'object'); store.emit('rumors', store.rumors); break;
      case 'toast': store.emit('toast', { icon: str(msg.icon || '🔔', 8), text: str(msg.text, 300) }); break;
      default: break;
    }
  } catch (e) {
    warnOnce('lỗi xử lý thông điệp', msg.t, e);
  }
}

export function setConn(state) {
  if (store.conn === state) return;
  store.conn = state;
  store.emit('conn', state);
}
