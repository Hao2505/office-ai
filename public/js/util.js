// Tiện ích chung cho client (không phụ thuộc DOM ngoài document).
// AN TOÀN: mọi chuỗi từ server/AI chỉ được đưa vào DOM qua textContent / createTextNode.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  t = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** phút trong ngày -> "HH:MM" */
export function fmtClock(minute) {
  const m = Math.floor(((Number(minute) || 0) % 1440 + 1440) % 1440);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function fmtNum(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtUsd(n, digits = 3) {
  const v = Number(n);
  return '$' + (Number.isFinite(v) ? v.toFixed(digits) : '0');
}

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (v >= 1e4) return Math.round(v / 1e3) + 'k';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

export const pct = (ratio) => Math.round((Number(ratio) || 0) * 100);

export function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** số giả ngẫu nhiên ổn định theo (x, y, seed) trong [0,1) */
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1013, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[-0-9.,%\s/deg]+\)|[a-z]{3,24})$/i;
/** Chỉ nhận chuỗi màu CSS "lành" (không url(), không ký tự lạ) để gán vào style/canvas */
export function safeColor(c, fallback = '#9ca3af') {
  if (typeof c !== 'string') return fallback;
  const s = c.trim();
  return s.length <= 40 && COLOR_RE.test(s) ? s : fallback;
}

/** Link sản phẩm chỉ được đi qua /go/:id của server (không open redirect) */
export function safeProductUrl(url) {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/go/') || url.startsWith('//') || /[\s"'<>\\]/.test(url)) return null;
  return url;
}

export const str = (v, max = 2000) => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) + '…' : v) : v == null ? '' : String(v));
export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const arr = (v) => (Array.isArray(v) ? v : []);

/** chữ cái đầu của tên (hỗ trợ tiếng Việt) */
export function initial(name) {
  const s = str(name).trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  const last = parts[parts.length - 1];
  return Array.from(last)[0].toUpperCase();
}

/** bỏ emoji ở đầu text nếu trùng với icon (server có thể gửi cả hai) */
export function stripIcon(text, icon) {
  const t = str(text);
  const ic = str(icon).trim();
  if (!ic) return t;
  const s = t.trimStart();
  return s.startsWith(ic) ? s.slice(ic.length).replace(/^[\s️:·–-]+/, '') : t;
}

/** viết hoa chữ cái đầu */
export function capFirst(s) {
  const t = str(s).trim();
  if (!t) return t;
  const ch = Array.from(t);
  return ch[0].toUpperCase() + ch.slice(1).join('');
}

/** bỏ dấu tiếng Việt (để so khớp từ khoá) */
export function noAccent(s) {
  return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/**
 * Tạo phần tử DOM an toàn.
 * props: class, text, style{}, dataset{}, on*: handler, các thuộc tính khác -> setAttribute
 * children: Node | string | number | mảng; chuỗi luôn thành text node.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'style') {
        for (const sk of Object.keys(v)) {
          if (v[sk] == null) continue;
          if (sk.startsWith('--')) node.style.setProperty(sk, String(v[sk]));
          else node.style[sk] = String(v[sk]);
        }
      } else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendKids(node, children);
  return node;
}

function appendKids(node, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(node, c);
    else node.append(c instanceof Node ? c : String(c));
  }
}

/** Thay toàn bộ con của node */
export function setKids(node, ...children) {
  node.replaceChildren();
  appendKids(node, children);
}

export function setText(node, text) {
  const t = String(text ?? '');
  if (node && node.textContent !== t) node.textContent = t;
}

/** SVG element (cho sparkline) */
export function svg(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  return n;
}

export const isMobile = () => window.matchMedia('(max-width: 899px)').matches;
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "$0" khi miễn phí, còn lại tối đa 4 số lẻ, bỏ số 0 thừa ("$0.012") */
export function fmtUsdShort(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1) return '$' + v.toFixed(2);
  return '$' + v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** Ảnh sản phẩm: chỉ nhận https tuyệt đối (hoặc ảnh cùng nguồn /...), không data:/javascript: */
export function safeImageUrl(url) {
  if (typeof url !== 'string' || url.length > 600 || /[\s"'<>\\]/.test(url)) return null;
  if (/^https:\/\/[^/]+\//i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

/** "Cty TNHH VibeCorp" -> "VibeCorp" (tên ngắn cho tiêu đề / header) */
export function shortCompanyName(name) {
  const s = str(name, 80).trim();
  const short = s.replace(/^(cty|công ty|c\.ty)\s*(tnhh|cp|cổ phần|mtv|jsc)?\s*/i, '').trim();
  return short || s || 'VibeCorp';
}

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* chế độ riêng tư: bỏ qua */ }
}

let warnCount = 0;
export function warnOnce(...args) {
  if (warnCount++ < 20) console.warn('[văn phòng]', ...args);
}
