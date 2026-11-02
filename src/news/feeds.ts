// =====================================================================
//  Tải + đọc RSS 2.0 (và Atom tối giản) bằng node:https + regex, không thêm thư viện (docs/v3-news.md).
//  fetchText(): timeout 10 s, theo 1 chuyển hướng, giới hạn 2 MB, tự giải nén gzip/deflate/br.
//  parseRss(): <item> title / link / description / pubDate / category → NewsItem (chưa lọc an toàn —
//  xem filter.ts). Chịu được CDATA, entity HTML, HTML trong description, ngày tháng nhiều định dạng.
// =====================================================================
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { NewsCategory, NewsItem } from '../types.js';
import type { NewsFeedConfig } from '../config.js';
import { matchKeyword, normText } from './filter.js';

export const USER_AGENT = 'VanPhongAo/3.0 (+van phong ao; doc RSS cong khai)';
export const SUMMARY_MAX = 200;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- tải
export interface FetchOptions {
  timeoutMs?: number;     // mặc định 10 000
  maxBytes?: number;      // mặc định 2 000 000
  maxRedirects?: number;  // mặc định 1
  userAgent?: string;
}

/**
 * Giải mã thân phản hồi: ưu tiên charset trong Content-Type, rồi khai báo `<?xml encoding="…"?>` (đọc trong 300 byte ASCII đầu),
 * mặc định utf-8; bộ mã lạ / lỗi → utf-8. Node có TextDecoder đầy đủ (windows-1252, windows-1258 cho tiếng Việt cũ…).
 */
export function decodeBody(buf: Buffer, contentType = ''): string {
  let enc = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1] ?? '';
  if (!enc) {
    const head = buf.subarray(0, 300).toString('latin1');
    enc = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ?? '';
  }
  enc = enc.toLowerCase();
  if (!enc || /^(utf-?8|us-ascii|ascii)$/.test(enc)) return buf.toString('utf8');
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/** Tải văn bản qua http/https. Lỗi → reject với thông điệp tiếng Việt ngắn. */
export function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 10_000);
  const maxBytes = Math.max(10_000, opts.maxBytes ?? 2_000_000);
  const redirectsLeft = opts.maxRedirects ?? 1;
  const userAgent = opts.userAgent ?? USER_AGENT;
  return new Promise<string>((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error('url không hợp lệ')); return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') { reject(new Error('chỉ hỗ trợ http/https')); return; }
    const doRequest = u.protocol === 'https:' ? httpsRequest : httpRequest;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (err: Error | null, text = ''): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err); else resolve(text);
    };
    const req = doRequest(u, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, identity',
        'Accept-Language': 'vi,en;q=0.8',
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirectsLeft <= 0) { finish(new Error(`quá nhiều chuyển hướng (HTTP ${status})`)); return; }
        let next: string;
        try { next = new URL(location, u).toString(); } catch { finish(new Error('chuyển hướng tới url lỗi')); return; }
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        fetchText(next, { ...opts, maxRedirects: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) { res.resume(); finish(new Error(`HTTP ${status}`)); return; }
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const contentType = String(res.headers['content-type'] ?? '');
      let stream: NodeJS.ReadableStream = res;
      if (enc.includes('gzip')) stream = res.pipe(createGunzip());
      else if (enc.includes('deflate')) stream = res.pipe(createInflate());
      else if (enc.includes('br')) stream = res.pipe(createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      let bodyEnded = false;
      stream.on('data', (c: Buffer | string) => {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
        size += buf.length;
        if (size > maxBytes) { finish(new Error(`nội dung quá lớn (> ${maxBytes} byte)`)); req.destroy(); return; }
        chunks.push(buf);
      });
      stream.on('end', () => { bodyEnded = true; finish(null, decodeBody(Buffer.concat(chunks), contentType)); });
      stream.on('error', (e: Error) => finish(e));
      // máy chủ ngắt giữa chừng khi đang giải nén: bộ giải nén không tự báo → nghe trên chính phản hồi
      const aborted = (): void => { if (!bodyEnded && !res.complete) finish(new Error('kết nối bị ngắt giữa chừng')); };
      res.on('aborted', aborted);
      res.on('close', () => { if (stream !== res) setImmediate(aborted); });
    });
    timer = setTimeout(() => { finish(new Error(`hết thời gian chờ ${timeoutMs} ms`)); req.destroy(); }, timeoutMs);
    req.on('error', (e: Error) => finish(e));
    req.end();
  });
}

// ---------------------------------------------------------------- văn bản
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', ndash: '–', mdash: '—', bull: '•', euro: '€',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', trade: '™', dagger: '†', permil: '‰', oelig: 'œ', OElig: 'Œ',
  scaron: 'š', Scaron: 'Š', Yuml: 'Ÿ', circ: 'ˆ', tilde: '˜', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
};
// HTML 4 Latin-1 (U+00A0..U+00FF) theo đúng thứ tự mã — Thanh Niên mã hoá "cách nào" thành "c&aacute;ch n&agrave;o"
const LATIN1_NAMES = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute '
  + 'micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave '
  + 'Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute '
  + 'THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve '
  + 'oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');
LATIN1_NAMES.forEach((name, i) => { NAMED_ENTITIES[name] = String.fromCharCode(0xa0 + i); });
NAMED_ENTITIES.nbsp = ' '; // khoảng trắng thường (tóm tắt / tiêu đề không cần non-breaking space)
// vài entity HTML 5 hay gặp trong tiếng Việt (chữ có dấu không thuộc Latin-1)
Object.assign(NAMED_ENTITIES, {
  Abreve: 'Ă', abreve: 'ă', Ohorn: 'Ơ', ohorn: 'ơ', Uhorn: 'Ư', uhorn: 'ư', Dstrok: 'Đ', dstrok: 'đ', Ecirc: 'Ê', ecirc: 'ê',
  Ocirc: 'Ô', ocirc: 'ô', Acirc: 'Â', acirc: 'â', Itilde: 'Ĩ', itilde: 'ĩ', Utilde: 'Ũ', utilde: 'ũ',
});

/** Entity số / tên → ký tự; entity hỏng (số 0, ngoài Unicode, surrogate, tên lạ) → bỏ hẳn thay vì chép nguyên văn vào tiêu đề */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (_m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n >= 0x110000 || (n >= 0xd800 && n <= 0xdfff) || n === 0xfffd) return '';
      if (n < 0x20 && n !== 0x09 && n !== 0x0a && n !== 0x0d) return '';
      return String.fromCodePoint(n);
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? ''; // phân biệt hoa / thường (Aacute ≠ aacute)
  });
}

export function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function stripHtml(s: string): string {
  return squash(
    s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  );
}

/**
 * CDATA → entity → bỏ HTML → entity lần 2 (nội dung bị mã hoá hai lớp) → bỏ HTML lần 2 (`&amp;lt;b&amp;gt;` vừa thành thẻ)
 * → bỏ ký tự thay thế U+FFFD / điều khiển → gọn khoảng trắng
 */
export function cleanText(raw: string): string {
  const once = stripHtml(decodeEntities(unwrapCdata(String(raw ?? ''))));
  return squash(stripHtml(decodeEntities(once)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''));
}

/** Văn bản có ký tự thay thế U+FFFD (giải mã sai bộ mã) không — tiêu đề như vậy không đem cho nhân vật bàn */
export const hasReplacementChar = (s: string): boolean => s.includes('\uFFFD');

/** Cắt ≤ max ký tự tại ranh giới từ, thêm "…" */
export function summarize(text: string, max = SUMMARY_MAX): string {
  const s = squash(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.!?…-]+$/u, '')}…`;
}

/**
 * Ngày đăng → ms epoch. Hiểu RFC 822 ("Sun, 01 Nov 2026 13:53:00 +0700"), "GMT+7", năm 2 chữ số, ISO,
 * "11/1/2026 2:20:00 PM" (Tuổi Trẻ). Không ghi múi giờ → coi là giờ Việt Nam. Không đọc được → fallback.
 */
export function parseDate(raw: string, fallback: number): number {
  let s = squash(String(raw ?? ''));
  if (!s) return fallback;
  s = s.replace(/GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i, (_m, sign: string, h: string, min?: string) =>
    `GMT${sign}${h.padStart(2, '0')}${min ?? '00'}`);
  const hasTz = /(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})$/i.test(s) || /(?:GMT|UTC)[+-]\d{4}$/i.test(s);
  if (!hasTz) s += /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? '+07:00' : ' GMT+0700';
  let t = Date.parse(s);
  if (!Number.isFinite(t)) t = Date.parse(raw);
  if (!Number.isFinite(t)) return fallback;
  if (t < Date.UTC(2000, 0, 1)) return fallback; // năm 2 chữ số bị hiểu thành 19xx…
  return t;
}

// ---------------------------------------------------------------- nguồn / id
const SOURCE_LABELS: Record<string, string> = {
  'vnexpress.net': 'VnExpress', 'tuoitre.vn': 'Tuổi Trẻ', 'thanhnien.vn': 'Thanh Niên', 'gamek.vn': 'GameK',
  'genk.vn': 'GenK', 'kenh14.vn': 'Kenh14', 'dantri.com.vn': 'Dân Trí', 'znews.vn': 'Znews', 'zingnews.vn': 'Znews',
  'laodong.vn': 'Lao Động', 'vietnamnet.vn': 'VietNamNet', 'nld.com.vn': 'Người Lao Động', 'bongdaplus.vn': 'Bongdaplus',
  'thethao247.vn': 'Thể thao 247', 'vtv.vn': 'VTV', 'vov.vn': 'VOV', 'tinhte.vn': 'Tinh tế', 'cafef.vn': 'CafeF',
  'baomoi.com': 'Báo Mới', 'plo.vn': 'Pháp Luật TP.HCM', 'kinhtedothi.vn': 'Kinh tế & Đô thị',
};

/** Tên báo từ url ("https://thethao.vnexpress.net/..." → "VnExpress"); không biết → tên miền viết hoa chữ đầu */
export function sourceLabel(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'Báo'; }
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts.slice(i).join('.');
    if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  }
  const base = parts.length >= 2 ? parts[parts.length - 2] : host;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Báo';
}

/** Bỏ #fragment và tham số theo dõi (utm_*, fbclid…) để cùng một bài luôn ra cùng một id */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** id tin = 12 ký tự hex đầu của sha1(url chuẩn hoá) */
export function newsId(url: string): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------- bóng đá
const FOOTBALL_KEYWORDS: readonly string[] = [
  'bóng đá', 'v-league', 'v.league', 'v league', 'ngoại hạng', 'premier league', 'champions league', 'europa league',
  'cup c1', 'cúp c1', 'world cup', 'euro', 'la liga', 'serie a', 'bundesliga', 'ligue 1', 'tuyển việt nam', 'đội tuyển',
  'u23', 'u22', 'u20', 'u17', 'aff cup', 'asian cup', 'fifa', 'uefa', 'afc', 'vff', 'man utd', 'man united', 'man city',
  'arsenal', 'liverpool', 'chelsea', 'tottenham', 'real madrid', 'barca', 'barcelona', 'atletico', 'bayern', 'dortmund',
  'psg', 'juventus', 'inter milan', 'ac milan', 'napoli', 'ronaldo', 'messi', 'mbappe', 'haaland', 'neymar', 'bellingham',
  'thủ môn', 'tiền đạo', 'tiền vệ', 'hậu vệ', 'trung vệ', 'ghi bàn', 'bàn thắng', 'penalty', 'phạt đền', 'việt vị',
  'sân cỏ', 'cầu thủ', 'hà nội fc', 'hagl', 'hoàng anh gia lai', 'thể công', 'nam định', 'becamex bình dương', 'bình dương fc', 'thanh hóa fc',
  'quang hải', 'tiến linh', 'hoàng đức', 'xuân son', 'văn toàn', 'công phượng', 'hlv kim sang-sik', 'kim sang-sik',
];

/** Tiêu đề / nhãn có phải tin bóng đá không (gắn nhãn phụ bong_da). Tên CLB phải đủ dài để không dính địa danh
 *  ("Thái Bình Dương" từng bị gắn bóng đá vì khớp "Bình Dương"). */
export function isFootball(text: string): boolean {
  const t = normText(text);
  for (const k of FOOTBALL_KEYWORDS) if (matchKeyword(t, k)) return true;
  return false;
}

// ---------------------------------------------------------------- RSS → NewsItem
/** trần cho feed hỏng / cố ý xấu: không quá bấy nhiêu <item> và mỗi item không dài quá bấy nhiêu ký tự */
export const MAX_ITEMS_PER_FEED = 500;
export const MAX_ITEM_CHARS = 64_000;

/** Một khối <item>/<entry>: bản gốc + bản chữ thường (tìm tag bằng indexOf, tuyến tính — không regex lười trên cả tài liệu) */
interface Block { raw: string; lower: string }

const isTagEnd = (ch: string): boolean => ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * Cắt tài liệu thành các khối <tag>…</tag> bằng indexOf (O(n)): mỗi <item không có </item> chỉ làm mất đúng khối đó,
 * không quét lại tới cuối tài liệu như regex lười. Có trần số khối và độ dài khối.
 */
export function splitBlocks(text: string, tag: 'item' | 'entry', maxBlocks = MAX_ITEMS_PER_FEED, maxChars = MAX_ITEM_CHARS): Block[] {
  const out: Block[] = [];
  const lower = text.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let pos = 0;
  while (out.length < maxBlocks) {
    const s = lower.indexOf(open, pos);
    if (s < 0) break;
    const after = lower.charAt(s + open.length);
    if (!isTagEnd(after) || after === '/') { pos = s + open.length; continue; } // <items>, <item/> → bỏ qua
    const gt = lower.indexOf('>', s);
    if (gt < 0) break;
    const e = lower.indexOf(close, gt + 1);
    if (e < 0) break;
    const body = text.slice(gt + 1, Math.min(e, gt + 1 + maxChars));
    out.push({ raw: body, lower: lower.slice(gt + 1, Math.min(e, gt + 1 + maxChars)) });
    const closeEnd = lower.indexOf('>', e);
    pos = closeEnd < 0 ? e + close.length : closeEnd + 1;
  }
  return out;
}

/** Vị trí thẻ mở `<name` (đúng tên, không phải tiền tố của tên khác) từ `from`, hoặc -1 */
function findOpen(b: Block, name: string, from = 0): number {
  const needle = `<${name.toLowerCase()}`;
  let i = from;
  while (true) {
    i = b.lower.indexOf(needle, i);
    if (i < 0) return -1;
    if (isTagEnd(b.lower.charAt(i + needle.length) || '>')) return i;
    i += needle.length;
  }
}

/** Nội dung thô của tag đầu tiên có tên `name` (hỗ trợ tiền tố namespace: content:encoded, dc:date); tag rỗng `<x/>` → '' */
function tagRaw(block: Block, name: string): string | null {
  const s = findOpen(block, name);
  if (s < 0) return null;
  const gt = block.lower.indexOf('>', s);
  if (gt < 0) return null;
  if (block.lower.charAt(gt - 1) === '/') return '';
  const e = block.lower.indexOf(`</${name.toLowerCase()}`, gt + 1);
  return e < 0 ? '' : block.raw.slice(gt + 1, e);
}

function tagRaws(block: Block, name: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (out.length < 20) {
    const s = findOpen(block, name, from);
    if (s < 0) break;
    const gt = block.lower.indexOf('>', s);
    if (gt < 0) break;
    const e = block.lower.indexOf(`</${name.toLowerCase()}`, gt + 1);
    if (e < 0) break;
    out.push(block.raw.slice(gt + 1, e));
    from = e + 1;
  }
  return out;
}

function tagAttr(block: Block, name: string, attr: string): string | null {
  let from = 0;
  while (true) {
    const s = findOpen(block, name, from);
    if (s < 0) return null;
    const gt = block.lower.indexOf('>', s);
    if (gt < 0) return null;
    const tagText = block.raw.slice(s, gt + 1);
    const m = new RegExp(`\\s${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tagText);
    if (m) return m[1];
    from = gt + 1;
  }
}

/** Link bài: <link> (RSS), <link href> (Atom) hoặc <guid> nếu là url */
function itemLink(block: Block): string {
  const candidates = [tagRaw(block, 'link'), tagAttr(block, 'link', 'href'), tagRaw(block, 'guid')];
  for (const c of candidates) {
    if (c === null) continue;
    const url = squash(decodeEntities(unwrapCdata(c)));
    if (/^https?:\/\/\S+$/i.test(url)) return url;
  }
  return '';
}

export interface ParseOptions { now?: number; feedUrl?: string }

/**
 * Đọc một tài liệu RSS 2.0 / Atom thành NewsItem (chưa lọc an toàn). Tin thiếu tiêu đề / link bị bỏ.
 * `group` = nhóm của feed; tin the_thao có từ khoá bóng đá → category 'bong_da'.
 */
export function parseRss(xml: string, group: NewsCategory, opts: ParseOptions = {}): NewsItem[] {
  const now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();
  const text = String(xml ?? '');
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  let blocks = splitBlocks(text, 'item');
  if (!blocks.length) blocks = splitBlocks(text, 'entry');
  for (const block of blocks) {
    const title = cleanText(tagRaw(block, 'title') ?? '');
    const url = itemLink(block);
    if (title.length < 8 || !url || hasReplacementChar(title)) continue; // tiêu đề giải mã sai bộ mã → không dùng
    const id = newsId(url);
    if (seen.has(id)) continue;
    seen.add(id);
    const descRaw = tagRaw(block, 'description') ?? tagRaw(block, 'content:encoded') ?? tagRaw(block, 'summary') ?? tagRaw(block, 'content') ?? '';
    const dateRaw = tagRaw(block, 'pubDate') ?? tagRaw(block, 'dc:date') ?? tagRaw(block, 'published') ?? tagRaw(block, 'updated') ?? '';
    const cats = tagRaws(block, 'category').map((c) => cleanText(c)).filter(Boolean);
    const category: NewsCategory = group === 'the_thao' && isFootball(`${title} ${cats.join(' ')}`) ? 'bong_da' : group;
    let summary = summarize(cleanText(descRaw).replace(/\uFFFD/g, ''));
    if (summary === title) summary = '';
    out.push({
      id, title: title.slice(0, 200), summary, source: sourceLabel(url || opts.feedUrl || ''), url: normalizeUrl(url),
      category, publishedAt: parseDate(cleanText(dateRaw), now),
    });
  }
  return out;
}

/** Tải 1 feed và đọc thành NewsItem (chưa lọc). Lỗi mạng / HTTP → throw. */
export async function fetchFeed(feed: NewsFeedConfig, opts: FetchOptions & ParseOptions = {}): Promise<NewsItem[]> {
  const xml = await fetchText(feed.url, opts);
  return parseRss(xml, feed.group, { now: opts.now, feedUrl: feed.url });
}
