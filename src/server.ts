// Server: HTTP (file tĩnh trong public/), /go/:id (chuyển hướng link affiliate), /api/health,
// WebSocket /ws (phát trực tiếp cho mọi người xem), nối dây World + Director + Brain, lưu trạng thái định kỳ.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { CONFIG } from './config.js';
import type { ClientMsg, DevEventName, ServerMsg, StatusInfo } from './types.js';
import { createBrain } from './ai/brain.js';
import { World } from './sim/world.js';
import { Director } from './sim/director.js';
import { getProduct } from './content/products.js';
import { HISTORY_READ_MAX, getArchive, isDateString } from './sim/archive.js';
import { getNews, toNewsRef } from './news/store.js';

// ---------------------------------------------------------------- hằng số
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const PUBLIC_ROOT = (() => {
  try { return realpathSync(PUBLIC_DIR); } catch { return normalize(PUBLIC_DIR).replace(/[\\/]+$/, ''); }
})();
const MAX_MSG_BYTES = 2048;
const MAX_BUFFERED = 1024 * 1024;
const SAVE_EVERY_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const DEV_RATE = { windowMs: 5000, max: 10 };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const DEV_EVENTS: ReadonlySet<string> = new Set<DevEventName>([
  'boss_leave', 'boss_return', 'server_down', 'wifi_down', 'payday', 'birthday', 'deal', 'drama', 'hr_review',
  'release', 'end_day', 'news', 'showrunner',
]);
const SPEEDS: readonly number[] = [1, 2, 5, 10];
/** cảnh báo "client không có quyền bấm dev" tối đa 1 lần / phút */
const DEV_IGNORED_WARN_MS = 60_000;

// ---------------------------------------------------------------- v3: quyền dev theo từng socket (DEV_TOKEN)
/** So chuỗi không lộ thời gian (băm trước để độ dài luôn bằng nhau) */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Socket này có quyền dev không: DEV_PANEL=false → không ai; DEV_TOKEN rỗng → mọi người (như cũ);
 * có DEV_TOKEN → chỉ khi url WebSocket mang ?dev=<token> đúng. Không bao giờ ghi token ra log.
 */
function devAllowed(req: IncomingMessage): boolean {
  if (!CONFIG.devPanel) return false;
  if (!CONFIG.devToken) return true;
  let token = '';
  try { token = new URL(req.url ?? '/', 'http://localhost').searchParams.get('dev') ?? ''; } catch { token = ''; }
  if (!token) token = cookieValue(req, DEV_COOKIE); // cookie HttpOnly đặt qua POST /api/dev/login (nhớ qua tắt trình duyệt)
  return token !== '' && token.length <= 200 && safeEqual(token, CONFIG.devToken);
}

/** Cookie admin: đặt khi mở trang kèm mã dev đúng, sống 1 năm, HttpOnly (JS không đọc được), chỉ gửi cùng site. */
const DEV_COOKIE = 'vpa_dev';
function cookieValue(req: IncomingMessage, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
  }
  return '';
}
function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) { reject(new Error('body quá lớn')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
/** POST /api/dev/login {token} → đặt cookie admin; POST /api/dev/logout → xoá. DEV_PANEL=false → như không tồn tại. */
function handleDevCookie(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!CONFIG.devPanel) { send(res, 404, 'Not found'); return; }
  if (req.method !== 'POST') { send(res, 405, 'Phương thức không được hỗ trợ', 'text/plain; charset=utf-8', { Allow: 'POST' }); return; }
  const attrs = `Path=/; HttpOnly; SameSite=Lax${requestIsHttps(req) ? '; Secure' : ''}`;
  if (url.pathname === '/api/dev/logout') {
    res.writeHead(204, { 'Set-Cookie': `${DEV_COOKIE}=; ${attrs}; Max-Age=0`, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  readBody(req, 2048).then((body) => {
    let token = '';
    try {
      const j: unknown = JSON.parse(body || '{}');
      if (j && typeof j === 'object' && typeof (j as { token?: unknown }).token === 'string') token = (j as { token: string }).token.trim().slice(0, 200);
    } catch { token = ''; }
    if (!CONFIG.devToken) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return; } // không đặt mã: ai cũng là dev
    if (!token || !safeEqual(token, CONFIG.devToken)) { noteIgnoredDev(); send(res, 403, 'Sai mã'); return; }
    res.writeHead(204, { 'Set-Cookie': `${DEV_COOKIE}=${encodeURIComponent(token)}; ${attrs}; Max-Age=31536000`, 'Cache-Control': 'no-store' });
    res.end();
  }).catch(() => { if (!res.headersSent) send(res, 400, 'Body không hợp lệ'); });
}

/**
 * Phiên bản tài nguyên tĩnh = băm (đường dẫn, kích thước, mtime) của mọi file trong public/ lúc khởi động. index.html trỏ
 * js/css qua /v/<phiên bản>/… và các file đó được cache "mãi mãi" (immutable); deploy mới → phiên bản mới → URL mới, nên
 * trình duyệt và Cloudflare không bao giờ dùng bản cũ (trước đây Cloudflare ép max-age 4 giờ cho .js/.css → người xem chạy
 * code cũ hàng giờ sau khi deploy). index.html luôn no-cache.
 */
function computeAssetVersion(): string {
  const h = createHash('sha1');
  const walk = (dir: string, rel: string): void => {
    let names: string[] = [];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, `${rel}${n}/`);
      else h.update(`${rel}${n}|${st.size}|${Math.floor(st.mtimeMs)}\n`);
    }
  };
  walk(PUBLIC_ROOT, '');
  return h.digest('hex').slice(0, 12);
}
const ASSET_VERSION = existsSync(PUBLIC_ROOT) ? computeAssetVersion() : 'dev';
const ASSET_PREFIX_RE = /^\/v\/([A-Za-z0-9]{4,40})(\/.*)$/;
/** băm nội dung ảnh xem trước (public/og-image.jpg) → ?v= trong og:image: Facebook / Zalo chỉ tải lại ảnh khi ảnh thật sự đổi */
const OG_VERSION = (() => {
  try { return createHash('sha1').update(readFileSync(join(PUBLIC_ROOT, 'og-image.jpg'))).digest('hex').slice(0, 10); } catch { return '0'; }
})();

/** request tới qua https? (trực tiếp, hoặc sau nginx: X-Forwarded-Proto, sau Cloudflare: CF-Visitor) */
function requestIsHttps(req: IncomingMessage): boolean {
  const xfp = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return xfp === 'https' || String(req.headers['cf-visitor'] ?? '').includes('"https"')
    || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/;
/**
 * Gốc URL công khai cho thẻ Open Graph / canonical (phải là URL tuyệt đối): SITE_URL nếu có, không thì suy ra từ request.
 * Host lạ (ký tự ngoài [a-z0-9.-:]) → localhost, để không ai chèn được chuỗi tuỳ ý vào HTML qua header Host.
 */
function siteOrigin(req: IncomingMessage): string {
  if (CONFIG.siteUrl) return CONFIG.siteUrl;
  const host = String(req.headers.host ?? '').trim().toLowerCase();
  return `${requestIsHttps(req) ? 'https' : 'http'}://${HOST_RE.test(host) ? host : `localhost:${CONFIG.port}`}`;
}
const escAttr = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let indexCache: { mtime: number; html: string } | null = null;
/**
 * index.html: viết lại href/src tương đối của .css/.js thành /v/<phiên bản>/… ; điền %OG_VERSION% (băm ảnh xem trước)
 * và %SITE_URL% (gốc URL công khai, theo từng request); luôn no-cache.
 */
function sendIndexHtml(req: IncomingMessage, res: ServerResponse, file: string, mtimeMs: number): void {
  if (!indexCache || indexCache.mtime !== mtimeMs) {
    const html = readFileSync(file, 'utf8').replace(/(href|src)="(?!https?:|data:|\/|%)([^"]+\.(?:css|js))"/g,
      (_m, attr: string, path: string) => `${attr}="/v/${ASSET_VERSION}/${path}"`).replaceAll('%OG_VERSION%', OG_VERSION);
    indexCache = { mtime: mtimeMs, html };
  }
  const body = Buffer.from(indexCache.html.replaceAll('%SITE_URL%', escAttr(siteOrigin(req))), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(body.length),
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(body);
}

let devIgnored = 0;
let devIgnoredWarnAt = 0;
function noteIgnoredDev(): void {
  devIgnored++;
  const now = Date.now();
  if (now - devIgnoredWarnAt < DEV_IGNORED_WARN_MS) return;
  devIgnoredWarnAt = now;
  console.warn(`[ws] Bỏ qua lệnh dev từ client không có quyền (tổng ${devIgnored} lần) — cần nối ws với ?dev=<DEV_TOKEN>`);
}

// ---------------------------------------------------------------- WebSocket hub
let wss: WebSocketServer | null = null;

/** socket nào có quyền dev (mở trang kèm ?dev=<DEV_TOKEN>) — quyết định lúc kết nối */
const devSockets = new WeakMap<WebSocket, boolean>();

/**
 * Bản "công khai" của StatusInfo cho người xem thường: không lộ gì về hệ thống (nguồn AI, model, lượt gọi,
 * token, chi phí, lỗi) và số lượt bấm link tiếp thị. Chỉ giữ ai.mode để web vẽ chấm xanh/xám (AI hay câu mẫu).
 */
function publicStatus(s: StatusInfo): StatusInfo {
  return {
    ...s,
    clicks: 0,
    ai: {
      mode: s.ai.mode, model: '', calls: 0, failures: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0,
      costTodayUsd: 0, costTotalUsd: 0, budgetUsd: 0, skipped: 0,
    },
  };
}

/** Gửi cho mọi người xem; bỏ qua socket đang nghẽn (> 1 MB chưa gửi được). 'status' gửi bản công khai cho socket thường. */
function broadcast(msg: ServerMsg): void {
  if (!wss || wss.clients.size === 0) return;
  let data: string;
  let dataPublic: string | null = null;
  try {
    data = JSON.stringify(msg);
    if (msg.t === 'status') dataPublic = JSON.stringify({ ...msg, status: publicStatus(msg.status) });
  } catch (e) {
    console.error('[ws] Không serialize được tin nhắn:', e instanceof Error ? e.message : e);
    return;
  }
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) continue;
    try { ws.send(dataPublic !== null && !devSockets.get(ws) ? dataPublic : data); } catch { /* socket hỏng: để sự kiện close dọn */ }
  }
}

function openCount(): number {
  if (!wss) return 0;
  let n = 0;
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) n++;
  return n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Kiểm tra tin nhắn client: JSON ≤ 2 KB, đúng một trong các dạng ClientMsg */
function parseClientMsg(data: RawData, isBinary: boolean): ClientMsg | null {
  if (isBinary) return null;
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  if (buf.length === 0 || buf.length > MAX_MSG_BYTES) return null;
  let m: unknown;
  try { m = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!isRecord(m)) return null;
  if (m.t === 'ping') return { t: 'ping' };
  if (m.t !== 'dev') return null;
  if (m.action === 'speed' && typeof m.value === 'number' && SPEEDS.includes(m.value)) {
    return { t: 'dev', action: 'speed', value: m.value };
  }
  if (m.action === 'event' && typeof m.name === 'string' && DEV_EVENTS.has(m.name)) {
    return { t: 'dev', action: 'event', name: m.name as DevEventName };
  }
  return null;
}

// ---------------------------------------------------------------- nối dây
// v3: archive cấu hình TRƯỚC khi dựng World để dòng log đầu tiên ("văn phòng mở cửa") cũng được lưu
const archive = getArchive().configure({
  enabled: CONFIG.historyEnabled, dir: CONFIG.historyDir, keepDays: CONFIG.historyKeepDays, gzipAfterDays: CONFIG.historyGzipAfterDays,
}).start();
const brain = createBrain(CONFIG);
const world = new World({ config: CONFIG, brain, emit: broadcast });
const director = new Director(world, brain);
world.attachDirector(director);
if (CONFIG.persist) world.load();
world.start();
// v3: tin thời sự — lần tải đầu ~20 s sau khi bật, không bao giờ chặn khởi động
const news = getNews();
if (CONFIG.newsEnabled) news.start();

// ---------------------------------------------------------------- HTTP
function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8',
  extra: Record<string, string> = {}): void {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown, cacheControl = 'no-store'): void {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': cacheControl });
}

/** v3: tối đa bấy nhiêu lần đọc lịch sử (giải nén + parse tới 5000 dòng) chạy song song — quá thì 429, không để RSS phình */
const HISTORY_MAX_INFLIGHT = 3;
let historyInflight = 0;

function intParam(url: URL, name: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}

/** GET /api/news — kho tin thời sự (chỉ NewsRef công khai + ngày đăng), để kiểm tra feed / bộ lọc */
function handleNews(res: ServerResponse, url: URL): void {
  const limit = intParam(url, 'limit', 120, 1, 240);
  const items = news.items().slice(0, limit).map((it) => ({ ...toNewsRef(it), publishedAt: it.publishedAt }));
  sendJson(res, 200, { ...news.status(), recent: news.recent(20), items });
}

/**
 * GET /api/history            → { enabled, days: [{ date, count, bytes, gz }] }
 * GET /api/history?date=YYYY-MM-DD[&offset=0&limit=5000] → { date, offset, limit, count, entries: [{ ts, kind, data }] } (≤ 5000)
 */
async function handleHistory(res: ServerResponse, url: URL): Promise<void> {
  try {
    const date = url.searchParams.get('date');
    if (date === null) {
      const days = await archive.listDays();
      const s = archive.stats();
      sendJson(res, 200, {
        enabled: archive.enabled(), days,
        stats: { queued: s.queued, written: s.written, dropped: s.dropped, errors: s.errors, lastFlushAt: s.lastFlushAt, lastRotateAt: s.lastRotateAt },
      });
      return;
    }
    if (!isDateString(date)) { sendJson(res, 400, { error: 'date phải có dạng YYYY-MM-DD' }); return; }
    if (!archive.hasDay(date)) { sendJson(res, 404, { error: `không có dữ liệu ngày ${date}` }); return; }
    const limit = intParam(url, 'limit', HISTORY_READ_MAX, 1, HISTORY_READ_MAX);
    const offset = intParam(url, 'offset', 0, 0, 1e9);
    if (historyInflight >= HISTORY_MAX_INFLIGHT) {
      send(res, 429, JSON.stringify({ error: 'đang có quá nhiều yêu cầu đọc lịch sử, thử lại sau vài giây' }), 'application/json; charset=utf-8', { 'Retry-After': '3' });
      return;
    }
    historyInflight++;
    let entries;
    try {
      entries = await archive.readDay(date, { limit, offset });
    } finally {
      historyInflight--;
    }
    // ngày đã nén không đổi nữa → cho trình duyệt / nginx / Cloudflare cache 1 ngày; ngày đang ghi thì không
    const cache = archive.isFrozenDay(date) ? 'public, max-age=86400' : 'no-store';
    sendJson(res, 200, { date, offset, limit, count: entries.length, entries }, cache);
  } catch (e) {
    console.error('[http] /api/history lỗi:', e instanceof Error ? e.message : e);
    if (!res.headersSent) sendJson(res, 500, { error: 'lỗi máy chủ' });
    else res.destroy();
  }
}

/** GET /go/:productId?src=... — chỉ id có trong danh mục; luôn chuyển tới đúng url của sản phẩm (không open redirect) */
function handleGo(req: IncomingMessage, res: ServerResponse, url: URL): void {
  let id = '';
  try { id = decodeURIComponent(url.pathname.slice('/go/'.length)); } catch { id = ''; }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) { send(res, 404, 'Không tìm thấy sản phẩm'); return; }
  let product;
  try { product = getProduct(id); } catch { product = undefined; }
  let target: URL | null = null;
  try { target = product ? new URL(product.url) : null; } catch { target = null; }
  if (!product || !target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
    send(res, 404, 'Không tìm thấy sản phẩm');
    return;
  }
  const rawSrc = url.searchParams.get('src') ?? '';
  const src = /^[A-Za-z0-9_-]{1,32}$/.test(rawSrc) ? rawSrc : 'khac';
  if (req.method === 'GET') { // HEAD = trình duyệt / bot đoán trước link, không tính click
    try { world.recordClick(product.id, src); } catch (e) { console.error('[http] recordClick lỗi:', e); }
  }
  res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.end();
}

/** File tĩnh trong public/ — chặn path traversal, dotfile, symlink ra ngoài */
function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL, opts: { immutable?: boolean } = {}): void {
  let rel: string;
  try { rel = decodeURIComponent(url.pathname); } catch { send(res, 400, 'Đường dẫn không hợp lệ'); return; }
  if (rel.includes('\0')) { send(res, 400, 'Đường dẫn không hợp lệ'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p.startsWith('.'))) { send(res, 404, 'Không tìm thấy'); return; }
  let file = join(PUBLIC_ROOT, ...parts);
  if (file !== PUBLIC_ROOT && !file.startsWith(PUBLIC_ROOT + sep)) { send(res, 403, 'Cấm truy cập'); return; }
  try {
    let st = statSync(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = statSync(file);
    }
    const real = realpathSync(file);
    if (!real.startsWith(PUBLIC_ROOT + sep) || !st.isFile()) { send(res, 404, 'Không tìm thấy'); return; }
    if (real === join(PUBLIC_ROOT, 'index.html')) { sendIndexHtml(req, res, real, st.mtimeMs); return; }
    // /v/<phiên bản hiện tại>/… → cache mãi (URL đổi theo mỗi deploy); còn lại no-cache = trình duyệt luôn hỏi lại, 304 nếu chưa đổi
    const cache = opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
    const mtime = Math.floor(st.mtimeMs / 1000) * 1000;
    const ims = Date.parse(String(req.headers['if-modified-since'] ?? ''));
    if (Number.isFinite(ims) && ims >= mtime) {
      res.writeHead(304, { 'Cache-Control': cache, 'Last-Modified': new Date(mtime).toUTCString() });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(st.size),
      'Cache-Control': cache,
      'Last-Modified': new Date(mtime).toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(real);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'index.html')) {
      send(res, 404, existsSync(PUBLIC_ROOT)
        ? 'Chưa có public/index.html — giao diện đang được xây dựng.'
        : 'Chưa có thư mục public/ — giao diện đang được xây dựng.');
      return;
    }
    send(res, 404, 'Không tìm thấy');
  }
}

const server = createServer((req, res) => {
  try {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { send(res, 400, 'URL không hợp lệ'); return; }
    const method = req.method ?? 'GET';
    if (url.pathname === '/api/dev/login' || url.pathname === '/api/dev/logout') { handleDevCookie(req, res, url); return; }
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'Phương thức không được hỗ trợ', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true, mode: brain.mode(), viewers: world.viewers(), day: world.day(), minute: Math.floor(world.minuteOfDay()),
      });
      return;
    }
    if (url.pathname === '/api/stats') {
      // thống kê hệ thống (AI, lượt bấm link): chỉ admin — gọi kèm ?dev=<DEV_TOKEN>; người khác thấy như không tồn tại
      if (!devAllowed(req)) { send(res, 404, 'Not found'); return; }
      const u = brain.usage();
      sendJson(res, 200, {
        ...world.clickStats(),
        ai: {
          mode: u.mode, model: u.model, activeProvider: u.activeProvider ?? null, calls: u.calls, failures: u.failures,
          costTodayUsd: u.costTodayUsd, costTotalUsd: u.costTotalUsd, budgetUsd: u.budgetUsd, skipped: u.skipped,
          lastError: u.lastError ?? null,
          // chi tiết từng provider (như status.ai.providers): router đã che key trong mọi lastError
          providers: u.providers ?? [],
        },
        day: world.day(),
      });
      return;
    }
    if (url.pathname === '/api/news') { handleNews(res, url); return; }
    if (url.pathname === '/api/history') { void handleHistory(res, url); return; }
    if (url.pathname.startsWith('/go/')) { handleGo(req, res, url); return; }
    // /v/<phiên bản>/… → file tĩnh, cache mãi nếu đúng phiên bản đang chạy (index.html cũ trỏ phiên bản cũ vẫn được phục vụ, chỉ không cache)
    const vm = ASSET_PREFIX_RE.exec(url.pathname);
    if (vm) { handleStatic(req, res, new URL(vm[2], 'http://localhost'), { immutable: vm[1] === ASSET_VERSION }); return; }
    handleStatic(req, res, url);
  } catch (e) {
    console.error('[http] Lỗi xử lý request:', e);
    if (!res.headersSent) send(res, 500, 'Lỗi máy chủ');
    else res.destroy();
  }
});

// ---------------------------------------------------------------- WebSocket
wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();
const devHits = new WeakMap<WebSocket, number[]>();

wss.on('connection', (ws, req) => {
  alive.set(ws, true);
  const isDev = devAllowed(req); // v3: quyền dev theo từng socket (?dev=<DEV_TOKEN>)
  devSockets.set(ws, isDev);
  ws.on('pong', () => alive.set(ws, true));
  ws.on('error', () => { /* bỏ qua: close sẽ dọn */ });
  try {
    const hello = world.hello() as Extract<ServerMsg, { t: 'hello' }>;
    hello.dev = isDev;
    if (!isDev) hello.status = publicStatus(hello.status); // người xem thường: không có chi tiết hệ thống
    ws.send(JSON.stringify(hello));
  } catch (e) {
    console.error('[ws] Không gửi được hello:', e instanceof Error ? e.message : e);
  }
  world.setViewers(openCount());

  ws.on('message', (data, isBinary) => {
    const msg = parseClientMsg(data, isBinary);
    if (!msg || msg.t === 'ping') return;
    if (!isDev) { noteIgnoredDev(); return; }
    const now = Date.now();
    const hits = (devHits.get(ws) ?? []).filter((t) => now - t < DEV_RATE.windowMs);
    if (hits.length >= DEV_RATE.max) return; // bấm quá nhanh
    hits.push(now);
    devHits.set(ws, hits);
    try { world.handleClient(msg); } catch (e) { console.error('[ws] handleClient lỗi:', e); }
  });

  ws.on('close', () => world.setViewers(openCount()));
});
wss.on('error', (e) => console.error('[ws] Lỗi WebSocket server:', e.message));

// ping định kỳ để loại kết nối chết (đếm người xem cho đúng)
const heartbeat = setInterval(() => {
  if (!wss) return;
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) { ws.terminate(); continue; }
    alive.set(ws, false);
    try { ws.ping(); } catch { /* bỏ qua */ }
  }
  world.setViewers(openCount());
}, HEARTBEAT_MS);
heartbeat.unref();

// ---------------------------------------------------------------- lưu trạng thái + tắt server
if (CONFIG.persist) setInterval(() => world.save(), SAVE_EVERY_MS).unref();

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n👋 Nhận ${signal} — đang lưu trạng thái và tắt server…`);
  try { world.stop(); } catch { /* bỏ qua */ }
  try { news.stop(); } catch { /* bỏ qua */ }
  if (CONFIG.persist) {
    try { world.save(); console.log(`💾 Đã lưu trạng thái vào ${CONFIG.stateFile}`); } catch (e) { console.error('Lưu thất bại:', e); }
  }
  try { archive.stop(); } catch (e) { console.error('Ghi archive thất bại:', e); } // ghi nốt hàng đợi (đồng bộ)
  try { for (const ws of wss?.clients ?? []) ws.close(1001, 'server shutdown'); } catch { /* bỏ qua */ }
  try { wss?.close(); } catch { /* bỏ qua */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// livestream không được chết vì một lỗi lẻ: ghi log rồi chạy tiếp
process.on('uncaughtException', (e) => console.error('[server] Lỗi không bắt được:', e));
process.on('unhandledRejection', (e) => console.error('[server] Promise bị từ chối không xử lý:', e));

// ---------------------------------------------------------------- khởi động
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Cổng ${CONFIG.port} đang bị chương trình khác dùng. Đổi PORT trong .env rồi chạy lại.`);
  } else {
    console.error('❌ Không khởi động được server:', e.message);
  }
  process.exit(1);
});

server.listen(CONFIG.port, () => {
  const url = `http://localhost:${CONFIG.port}`;
  // không ghi "GPT" trừ khi provider là OpenAI: in chuỗi provider thật (Gemini → Groq → câu mẫu offline)
  const chain = CONFIG.providers.map((p) => `${p.label} (${p.model})`);
  const ai = brain.mode() === 'llm'
    ? `🤖 AI: ${chain.join(' → ')} → câu mẫu offline · ngân sách $${CONFIG.dailyBudgetUsd}/ngày · tối thiểu ${CONFIG.minSecondsBetweenLlm}s giữa 2 lần gọi`
    : '🧪 AI: OFFLINE (chưa có key — điền AI_PROVIDERS và AI_<TÊN>_API_KEY trong .env) — dùng câu thoại mẫu, không tốn tiền';
  const hello = world.hello() as Extract<ServerMsg, { t: 'hello' }>;
  const shelf = hello.products ?? [];
  const nBeauty = shelf.filter((p) => p.shelf === 'beauty').length;
  const time = CONFIG.timeMode === 'realtime'
    ? '⏱️  Thời gian: theo giờ thật Việt Nam (thứ Bảy, Chủ Nhật nghỉ)'
    : `⏱️  Thời gian: nén — ${CONFIG.gameMinutesPerSecond} phút game / giây thật (tua nhanh bằng bảng dev)`;
  console.log('');
  console.log(`🏢 Văn Phòng Ảo — ${CONFIG.companyName}`);
  console.log(`👉 Mở trình duyệt: ${url}`);
  console.log(ai);
  for (const n of CONFIG.providerNotes) console.log(`   ⚠️  ${n}`);
  console.log(time);
  console.log(`🛍️  Phòng trưng bày: ${shelf.length} sản phẩm (kệ làm đẹp ${nBeauty} · kệ công nghệ ${shelf.length - nBeauty}) — chỉnh trong data/products.json`);
  console.log(CONFIG.persist ? `💾 Lưu trạng thái: ${CONFIG.stateFile} (mỗi 60 giây và khi tắt)` : '💾 Không lưu trạng thái (PERSIST=false)');
  console.log(CONFIG.historyEnabled
    ? `🗄️  Lưu trữ dài hạn: ${archive.dir()} (JSONL theo ngày, nén sau ${CONFIG.historyGzipAfterDays} ngày, giữ ${CONFIG.historyKeepDays} ngày) — GET /api/history`
    : '🗄️  Lưu trữ dài hạn: tắt (HISTORY_ENABLED=false)');
  console.log(CONFIG.newsEnabled
    ? `📰 Thời sự: ${CONFIG.newsFeeds.length} nguồn RSS, tải sau 20 giây rồi mỗi ${CONFIG.newsRefreshMinutes} phút` +
      `${CONFIG.newsAllowShowbiz ? ' (có giải trí nhẹ)' : ' (không giải trí)'} — GET /api/news`
    : '📰 Thời sự: tắt (NEWS_ENABLED=false)');
  for (const n of CONFIG.newsFeedNotes) console.log(`   ⚠️  ${n}`);
  // không bao giờ in DEV_TOKEN
  console.log(!CONFIG.devPanel
    ? '🛠️  Bảng dev: tắt'
    : CONFIG.devToken
      ? '🛠️  Bảng dev: chỉ cho trình duyệt mở trang kèm ?dev=<DEV_TOKEN> (token không in ra đây)'
      : '🛠️  Bảng dev: BẬT cho mọi người xem (đặt DEV_TOKEN hoặc DEV_PANEL=false khi lên production)');
  console.log(`📅 Hiện tại: ${world.weekday()}, ngày ${world.day()} — ${String(Math.floor(world.minuteOfDay() / 60)).padStart(2, '0')}:${String(Math.floor(world.minuteOfDay() % 60)).padStart(2, '0')}`);
  console.log('');
});
