// Hàm vẽ cơ bản cho Canvas 2D + xử lý màu.
import { safeColor } from '../util.js';

const colorCache = new Map();
let cctx = null;

/** chuỗi màu CSS -> [r,g,b,a] (null nếu không hợp lệ) */
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  if (colorCache.has(c)) return colorCache.get(c);
  if (!cctx) cctx = document.createElement('canvas').getContext('2d');
  let v = null;
  const safe = safeColor(c, '');
  if (safe) {
    cctx.fillStyle = '#010203';
    cctx.fillStyle = safe;
    const s = cctx.fillStyle;
    if (s !== '#010203' || safe.toLowerCase() === '#010203') {
      if (s[0] === '#') {
        v = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
      } else {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(',').map((x) => parseFloat(x));
          v = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
        }
      }
    }
  }
  if (colorCache.size > 600) colorCache.clear();
  colorCache.set(c, v);
  return v;
}

export function rgba(p, a = 1) {
  const alpha = a * (p[3] ?? 1);
  return alpha >= 1
    ? `rgb(${p[0] | 0},${p[1] | 0},${p[2] | 0})`
    : `rgba(${p[0] | 0},${p[1] | 0},${p[2] | 0},${Math.max(0, alpha).toFixed(3)})`;
}

/** k < 0: tối hơn (pha đen), k > 0: sáng hơn (pha trắng) */
export function shade(c, k, fallback = '#888888') {
  const p = Array.isArray(c) ? c : parseColor(c) || parseColor(fallback);
  const t = k < 0 ? 0 : 255;
  const f = Math.min(1, Math.abs(k));
  return rgba([p[0] + (t - p[0]) * f, p[1] + (t - p[1]) * f, p[2] + (t - p[2]) * f, 1]);
}

export function mix(a, b, t) {
  const p = Array.isArray(a) ? a : parseColor(a) || [128, 128, 128, 1];
  const q = Array.isArray(b) ? b : parseColor(b) || [128, 128, 128, 1];
  return rgba([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, 1]);
}

export function alpha(c, a) {
  const p = Array.isArray(c) ? c : parseColor(c) || [0, 0, 0, 1];
  return rgba([p[0], p[1], p[2], 1], a);
}

export function luma(c) {
  const p = Array.isArray(c) ? c : parseColor(c) || [128, 128, 128, 1];
  return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
}

/** đường viền chữ nhật bo góc; r có thể là số hoặc [tl,tr,br,bl] */
export function rrPath(ctx, x, y, w, h, r) {
  let tl, tr, br, bl;
  if (Array.isArray(r)) [tl, tr, br, bl] = r;
  else tl = tr = br = bl = r || 0;
  const m = Math.min(w / 2, h / 2);
  tl = Math.max(0, Math.min(tl, m)); tr = Math.max(0, Math.min(tr, m));
  br = Math.max(0, Math.min(br, m)); bl = Math.max(0, Math.min(bl, m));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

export function fillRR(ctx, x, y, w, h, r, fill) {
  rrPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRR(ctx, x, y, w, h, r, stroke, lw) {
  rrPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

export function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export function ellipse(ctx, cx, cy, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.0001, rx), Math.max(0.0001, ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function circle(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.0001, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function line(ctx, x1, y1, x2, y2, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/**
 * Khối hộp nhìn 3/4: footprint (x, y, w, d) trên sàn, chiều cao h.
 * Mặt trên = footprint dịch lên h; mặt trước từ y+d-h tới y+d.
 */
export function box(ctx, x, y, w, d, h, top, front, r = 0.06) {
  if (h > 0) fillRR(ctx, x, y + d - h - Math.min(r, 0.05), w, h + Math.min(r, 0.05), [0, 0, r, r], front);
  fillRR(ctx, x, y - h, w, d, r, top);
}

/** viền sáng mép trước mặt trên (tạo độ dày) */
export function topEdge(ctx, x, y, w, d, h, color, lw = 0.035) {
  line(ctx, x + 0.04, y + d - h - lw / 2, x + w - 0.04, y + d - h - lw / 2, color, lw);
}

/**
 * Bóng mềm trên sàn: dùng mẹo shadowBlur (vẽ hình ở xa, chỉ bóng rơi vào đúng chỗ).
 * Chỉ dùng trong layer tĩnh (tốn kém).
 */
export function softShadow(ctx, x, y, w, h, r, blur, color) {
  const m = ctx.getTransform();
  const s = m.a || 1;
  const off = 20000;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0.5, blur * s);
  ctx.shadowOffsetX = off;
  ctx.shadowOffsetY = 0;
  rrPath(ctx, x - off / s, y, w, h, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

export function softEllipseShadow(ctx, cx, cy, rx, ry, blur, color) {
  const m = ctx.getTransform();
  const s = m.a || 1;
  const off = 20000;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0.5, blur * s);
  ctx.shadowOffsetX = off;
  ctx.beginPath();
  ctx.ellipse(cx - off / s, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

export function vGrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function hGrad(ctx, x0, x1, stops) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** chữ căn giữa, tự co cho vừa maxW */
export function fitText(ctx, text, cx, cy, maxW, size, weight = 700, color = '#111', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  let w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    s = Math.max(size * 0.5, (s * maxW) / w);
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

export const FONT = '"Be Vietnam Pro", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
