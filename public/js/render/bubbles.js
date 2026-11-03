// Lớp phủ trong toạ độ màn hình (px CSS): bong bóng thoại, "•••" đang gõ, emote, bảng tên.
// Chữ luôn cùng cỡ dù phóng to/thu nhỏ bản đồ -> luôn đọc được; bong bóng luôn nằm trong canvas.
import { clamp, easeOutBack } from '../util.js';
import { rrPath, FONT, EMOJI_FONT, shade, luma } from './draw.js';

const wrapCache = new Map();

/** xoá cache ngắt dòng (gọi khi font web tải xong vì độ rộng chữ thay đổi) */
export function clearTextCache() {
  wrapCache.clear();
}

function wrap(ctx, text, maxW, font) {
  const key = `${font}|${maxW}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  ctx.font = font;
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
    if (cur) lines.push(cur);
    if (ctx.measureText(w).width > maxW) {
      let part = '';
      for (const ch of Array.from(w)) {
        if (ctx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ch; } else part += ch;
      }
      cur = part;
    } else cur = w;
  }
  if (cur) lines.push(cur);
  const MAX = 7;
  if (lines.length > MAX) {
    lines.length = MAX;
    lines[MAX - 1] = lines[MAX - 1].replace(/\s*\S{0,3}$/, '') + '…';
  }
  let width = 0;
  for (const l of lines) width = Math.max(width, ctx.measureText(l).width);
  const v = { lines, width };
  wrapCache.set(key, v);
  if (wrapCache.size > 400) wrapCache.delete(wrapCache.keys().next().value);
  return v;
}

function overlaps(a, b, pad = 4) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/**
 * Tính vị trí + vẽ các bong bóng.
 * items: [{kind:'speech'|'typing', key, ax, ay (đỉnh đầu), hy (giữa đầu), hr (bán kính đầu, px), fy (chân),
 *          text, name, color, icon, product, t0, dur, until}]
 * Vị trí ưu tiên: phía trên đầu → (trên, bong bóng rộng hơn) → bên cạnh đầu (đuôi chỉ ngang) → dưới chân.
 * Nhớ vị trí đã chọn theo key để bong bóng không nhảy qua lại giữa các khung hình.
 */
const lastSlot = new Map(); // key -> tên vị trí đã chọn ở khung trước

/**
 * scale < 1: co cả lớp bong bóng (chữ, khung, đuôi, khoảng né) khi bản đồ hiện nhỏ — tính bố cục trong hệ toạ độ
 * đã chia cho scale rồi vẽ qua ctx.scale, nên mọi hằng số px bên dưới tự co theo.
 */
export function drawBubbles(ctx, items, vw, vh, now, compact, insets, scale = 1) {
  if (!(scale > 0) || Math.abs(scale - 1) < 0.01) return layoutBubbles(ctx, items, vw, vh, now, compact, insets);
  const k = 1 / scale;
  const sc = (v) => (typeof v === 'number' ? v * k : v);
  const its = items.map((it) => ({ ...it, ax: sc(it.ax), ay: sc(it.ay), hy: sc(it.hy), hr: sc(it.hr), fy: sc(it.fy) }));
  const ins = insets ? { ...insets, top: (insets.top || 0) * k, bottom: (insets.bottom || 0) * k } : insets;
  ctx.save();
  ctx.scale(scale, scale);
  try {
    return layoutBubbles(ctx, its, vw * k, vh * k, now, compact, ins);
  } finally {
    ctx.restore();
  }
}

function layoutBubbles(ctx, items, vw, vh, now, compact, insets) {
  const placed = [];
  const fs = compact ? 12 : 12.5;
  const lineH = compact ? 15.5 : 16.5;
  const textFont = `500 ${fs}px ${FONT}`;
  const nameFont = `700 ${compact ? 10 : 10.5}px ${FONT}`;
  const baseW = compact ? Math.min(190, vw * 0.58) : 220;
  const wideW = Math.max(baseW, Math.min(compact ? 250 : 320, vw * 0.62));
  const m = 6;
  // vùng an toàn: không chui xuống dưới HUD (mép trên) hay dải ticker (mép dưới)
  const mt = m + Math.max(0, insets?.top || 0), mb = m + Math.max(0, insets?.bottom || 0);
  const fits = (r) => r.x >= m && r.y >= mt && r.x + r.w <= vw - m && r.y + r.h <= vh - mb;
  const free = (r, pad) => !placed.some((p) => overlaps(r, p, pad));
  const seen = new Set();
  // speech trước (ưu tiên vị trí đẹp), typing sau
  const order = [...items].sort((a, b) => (a.kind === b.kind ? a.t0 - b.t0 : a.kind === 'speech' ? -1 : 1));
  const draws = [];
  for (const it of order) {
    const hr = it.hr || 8;
    const hy = it.hy ?? it.ay + hr;
    const right = it.ax < vw / 2; // nghiêng về phía có nhiều chỗ hơn
    const sizeFor = (maxW) => {
      if (it.kind !== 'speech') return { w: 40, h: 22, lines: null };
      const wr = wrap(ctx, it.text, maxW, textFont);
      ctx.font = nameFont;
      const nameW = it.name ? ctx.measureText(it.name).width : 0;
      return {
        lines: wr.lines,
        w: Math.max(wr.width, nameW + (it.icon ? 16 : 0), 40) + 20,
        h: 14 + (it.name ? 14 : 0) + wr.lines.length * lineH - 2,
      };
    };
    const S = sizeFor(baseW);
    const above = (s, slot, dx = 0) => ({ slot, ...s, x: clamp(it.ax - s.w / 2 + dx, m, Math.max(m, vw - m - s.w)), y: it.ay - 10 - s.h, tail: 'bottom' });
    const side = (s, toRight) => ({
      slot: toRight ? 'right' : 'left', ...s,
      x: toRight ? it.ax + hr + 10 : it.ax - hr - 10 - s.w,
      y: clamp(hy - s.h * 0.5, mt, Math.max(mt, vh - mb - s.h)),
      tail: toRight ? 'left' : 'right',
    });
    const below = (s) => ({ slot: 'below', ...s, x: clamp(it.ax - s.w / 2, m, Math.max(m, vw - m - s.w)), y: it.fy + 20, tail: 'top' });
    const cands = [];
    // người ngồi quay lưng ở bàn làm việc: ưu tiên đặt bong bóng bên cạnh để không che màn hình
    if (it.sideFirst) cands.push(side(S, right), side(S, !right));
    if (it.kind === 'speech') {
      cands.push(above(S, 'above'));
      if (wideW > baseW + 20 && S.lines.length > 1) {
        const W2 = sizeFor(wideW);
        if (W2.h < S.h) cands.push(above(W2, 'above-wide'));
      }
      // lệch hẳn sang một bên nhưng vẫn ở trên đầu (đuôi vẫn chỉ xuống người nói)
      const dx = S.w / 2 - 22;
      cands.push(above(S, right ? 'above-r' : 'above-l', right ? dx : -dx), above(S, right ? 'above-l' : 'above-r', right ? -dx : dx));
      cands.push(side(S, right), side(S, !right), below(S));
    } else {
      // "•••": sát đầu người sắp nói
      cands.push(above(S, 'above'), above(S, 'above-r', S.w / 2 + 4), above(S, 'above-l', -S.w / 2 - 4), side(S, right), side(S, !right), below(S));
    }
    const pad = it.kind === 'speech' ? 4 : 2;
    // giữ vị trí cũ cho khỏi nhảy qua lại; chỉ "nâng hạng" lên vị trí ưu tiên hơn khi nó trống rộng rãi
    const best = cands.find((c) => fits(c) && free(c, pad));
    const prev = lastSlot.get(it.key);
    const keep = prev && prev !== best?.slot ? cands.find((c) => c.slot === prev && fits(c) && free(c, pad)) : null;
    // (best luôn đứng trước keep trong danh sách ưu tiên)
    let pick = keep && best && !free(best, pad + 14) ? keep : best;
    if (!pick) {
      // kín chỗ: chồng lên phía trên bong bóng đang vướng, nếu không được thì chấp nhận đè
      const base = cands.find((c) => fits(c)) || cands[0];
      pick = { ...base };
      for (let pass = 0; pass < 4; pass++) {
        const hit = placed.find((p) => overlaps(pick, p, pad));
        if (!hit) break;
        const ny = hit.y - pick.h - 6;
        if (pick.tail === 'bottom' && ny >= mt) pick.y = ny;
        else break;
      }
      pick.x = clamp(pick.x, m, Math.max(m, vw - m - pick.w));
      pick.y = clamp(pick.y, mt, Math.max(mt, vh - mb - pick.h));
    }
    if (it.key != null) { lastSlot.set(it.key, pick.slot); seen.add(it.key); }
    const rect = { x: pick.x, y: pick.y, w: pick.w, h: pick.h };
    // đầu nhọn của đuôi: chỉ vào đỉnh đầu (trên/dưới) hoặc cạnh đầu (trái/phải)
    let tip;
    if (pick.tail === 'bottom') tip = { x: clamp(it.ax, rect.x + 10, rect.x + rect.w - 10), y: rect.y + rect.h + 8 };
    else if (pick.tail === 'top') tip = { x: clamp(it.ax, rect.x + 10, rect.x + rect.w - 10), y: rect.y - 8 };
    else if (pick.tail === 'left') tip = { x: rect.x - 8, y: clamp(hy, rect.y + 10, rect.y + rect.h - 10) };
    else tip = { x: rect.x + rect.w + 8, y: clamp(hy, rect.y + 10, rect.y + rect.h - 10) };
    placed.push(rect);
    draws.push({ it, rect, tail: pick.tail, tip, lines: pick.lines });
  }
  if (lastSlot.size > 60) for (const k of lastSlot.keys()) if (!seen.has(k)) lastSlot.delete(k);
  // vẽ typing trước, speech sau (speech nằm trên)
  for (const d of draws) if (d.it.kind === 'typing') drawTyping(ctx, d, now);
  for (const d of draws) if (d.it.kind === 'speech') drawSpeech(ctx, d, now, textFont, nameFont, lineH);
}

/** khung bong bóng bo góc + đuôi ở một cạnh (side: top|bottom|left|right), đầu nhọn tại tip */
function bubblePath(ctx, x, y, w, h, r, side, tip) {
  const tw = 7;
  const cx = clamp(tip.x, x + r + tw, x + w - r - tw);
  const cy = clamp(tip.y, y + r + tw, y + h - r - tw);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (side === 'top') { ctx.lineTo(cx - tw, y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(cx + tw, y); }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  if (side === 'right') { ctx.lineTo(x + w, cy - tw); ctx.lineTo(tip.x, tip.y); ctx.lineTo(x + w, cy + tw); }
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (side === 'bottom') { ctx.lineTo(cx + tw, y + h); ctx.lineTo(tip.x, tip.y); ctx.lineTo(cx - tw, y + h); }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  if (side === 'left') { ctx.lineTo(x, cy + tw); ctx.lineTo(tip.x, tip.y); ctx.lineTo(x, cy - tw); }
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawSpeech(ctx, d, now, textFont, nameFont, lineH) {
  const { it, rect, tail, tip, lines } = d;
  const age = now - it.t0;
  const a = clamp(age / 240, 0, 1);
  const out = clamp((it.t0 + it.dur - now) / 260, 0, 1);
  const alpha = Math.min(clamp(a * 1.6, 0, 1), out);
  if (alpha <= 0) return;
  const sc = 0.55 + 0.45 * easeOutBack(a);
  ctx.save();
  ctx.globalAlpha = alpha;
  // bật ra từ đầu đuôi (phía người nói)
  ctx.translate(tip.x, tip.y);
  ctx.scale(sc, sc);
  ctx.translate(-tip.x, -tip.y);
  ctx.shadowColor = 'rgba(40,25,10,0.22)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  bubblePath(ctx, rect.x, rect.y, rect.w, rect.h, 10, tail, tip);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(31,41,55,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // vạch màu nhân vật bên trái
  ctx.save();
  rrPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
  ctx.clip();
  ctx.fillStyle = it.color || '#ff7a45';
  ctx.fillRect(rect.x, rect.y, 3.5, rect.h);
  ctx.restore();
  let y = rect.y + 8;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (it.name) {
    ctx.font = nameFont;
    const c = it.color || '#ff7a45';
    ctx.fillStyle = luma(c) > 0.62 ? shade(c, -0.45) : c;
    ctx.fillText(it.name, rect.x + 11, y);
    y += 14;
  }
  ctx.font = textFont;
  ctx.fillStyle = '#1f2937';
  for (const l of lines) {
    ctx.fillText(l, rect.x + 11, y);
    y += lineH;
  }
  // emote của câu
  if (it.icon) {
    const bx = rect.x + rect.w - 4, by = rect.y + 3;
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#fff7ed';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,122,69,0.35)';
    ctx.stroke();
    ctx.font = `12px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.icon, bx, by + 1);
  }
  if (it.product) {
    const bx = rect.x + 2, by = rect.y + 2;
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ff7a45';
    ctx.fill();
    ctx.font = `10px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛒', bx, by + 1);
  }
  ctx.restore();
}

function drawTyping(ctx, d, now) {
  const { it, rect, tail, tip } = d;
  const a = clamp((now - it.from) / 200, 0, 1);
  const out = clamp((it.until - now) / 250, 0, 1);
  const alpha = Math.min(a, out);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.96;
  ctx.shadowColor = 'rgba(40,25,10,0.18)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  bubblePath(ctx, rect.x, rect.y, rect.w, rect.h, 11, tail, tip);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  for (let k = 0; k < 3; k++) {
    const ph = (now / 180 - k * 0.9);
    const up = Math.max(0, Math.sin(ph)) * 3;
    ctx.beginPath();
    ctx.arc(rect.x + 11 + k * 9, rect.y + rect.h / 2 - up, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = k === Math.floor((now / 300) % 3) ? '#9ca3af' : '#cbd5e1';
    ctx.fill();
  }
  ctx.restore();
}

/** emote trên đầu: vòng trắng + emoji, bật lên khi đổi */
export function drawEmote(ctx, x, y, emoji, since, now, opts = {}) {
  if (!emoji) return;
  const age = now - since;
  const a = clamp(age / 320, 0, 1);
  let sc = since ? 0.35 + 0.65 * easeOutBack(a) : 1;
  const size = opts.size || 20;
  if (opts.pulse) sc *= 1 + Math.sin(now / 260) * 0.07;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.ping) {
    const pp = clamp((now - opts.ping) / 1200, 0, 1);
    if (pp < 1) {
      ctx.beginPath();
      ctx.arc(0, 0, size / 2 + 2 + pp * 14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34,197,94,${(1 - pp) * 0.8})`;
      ctx.lineWidth = 2.5 * (1 - pp) + 0.5;
      ctx.stroke();
    }
  }
  ctx.shadowColor = 'rgba(40,25,10,0.25)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = opts.bg || '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.moveTo(-3, size / 2 - 1.5);
  ctx.lineTo(0, size / 2 + 3.5);
  ctx.lineTo(3, size / 2 - 1.5);
  ctx.fill();
  ctx.font = `${Math.round(size * 0.62)}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 1);
  ctx.restore();
}

/** kích thước bảng tên (để tránh chồng nhau trước khi vẽ) */
export function measureNamePill(ctx, name, opts = {}) {
  const fs = opts.size || 10;
  ctx.font = `700 ${fs}px ${FONT}`;
  const tw = ctx.measureText(name).width;
  const dot = opts.dot ? fs * 0.9 : 0;
  const tag = opts.tag || '';
  ctx.font = `800 ${fs * 0.82}px ${FONT}`;
  const tagW = tag ? ctx.measureText(tag).width + fs : 0;
  return { w: tw + dot + tagW + fs * 1.2, h: fs * 1.7, tw, dot, tagW };
}

/** đẩy các bảng tên chồng nhau ra xa (items: {x(tâm), y, w, h, up?}) — sửa y tại chỗ.
 *  Bảng tên đặt trên đầu (up) thì đẩy lên trên để không che mặt chính người đó. */
export function spreadPills(items) {
  const placed = [];
  for (const it of items) {
    for (let k = 0; k < 4; k++) {
      const hit = placed.find((p) => it.x - it.w / 2 < p.x + p.w / 2 + 2 && it.x + it.w / 2 + 2 > p.x - p.w / 2 && it.y < p.y + p.h && it.y + it.h > p.y);
      if (!hit) break;
      it.y = it.up ? hit.y - it.h - 1 : hit.y + hit.h + 1;
    }
    placed.push(it);
  }
}

/** bảng tên dưới chân */
export function drawNamePill(ctx, x, y, name, opts = {}) {
  const fs = opts.size || 10;
  const m = measureNamePill(ctx, name, opts);
  const { w, h, tw, dot, tagW } = m;
  const tag = opts.tag || '';
  const px = x - w / 2, py = y;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  rrPath(ctx, px, py, w, h, h / 2);
  ctx.fillStyle = opts.bg || 'rgba(31,41,55,0.78)';
  ctx.fill();
  if (opts.highlight) {
    ctx.strokeStyle = '#ff7a45';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  let cx = px + fs * 0.6;
  if (dot) {
    ctx.beginPath();
    ctx.arc(cx + dot * 0.35, py + h / 2, dot * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = opts.dot;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    cx += dot;
  }
  ctx.font = `700 ${fs}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, cx, py + h / 2 + 0.5);
  if (tag) {
    const tx = cx + tw + fs * 0.4;
    rrPath(ctx, tx, py + 2, tagW - fs * 0.4, h - 4, (h - 4) / 2);
    ctx.fillStyle = opts.tagBg || '#ff7a45';
    ctx.fill();
    ctx.font = `800 ${fs * 0.82}px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tag, tx + fs * 0.3, py + h / 2 + 0.5);
  }
  ctx.restore();
  return { x: px, y: py, w, h };
}

/** ngắt phụ đề biển hiệu: ưu tiên ngắt ở " · ", tối đa maxLines dòng */
function wrapSub(ctx, text, maxW, maxLines) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (ctx.measureText(t).width <= maxW) return [t];
  const segs = t.split(' · ');
  if (segs.length === maxLines && segs.every((x) => ctx.measureText(x).width <= maxW)) return segs;
  const words = t.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !cur) { cur = test; continue; }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length > 3) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.replace(/[\s·,]+$/, '')}…`;
  }
  return lines.map((l) => l.replace(/^·\s*/, '').replace(/\s*·$/, ''));
}

/** biển hiệu treo (sếp vắng, sự cố...) — phụ đề tối đa 2 dòng */
export function drawSign(ctx, x, y, title, sub, opts = {}) {
  const size = opts.size || 12;
  const tf = `800 ${size}px ${FONT}`;
  const sf = `600 ${size - 2.5}px ${FONT}`;
  ctx.font = tf;
  const tw = ctx.measureText(title).width;
  ctx.font = sf;
  const subLines = sub ? wrapSub(ctx, sub, opts.subMax || 200, 2) : [];
  let sw = 0;
  for (const l of subLines) sw = Math.max(sw, ctx.measureText(l).width);
  const lh = size + 0.5;
  const w = Math.max(tw, sw) + 22;
  const h = 26 + (subLines.length ? subLines.length * lh + 1 : 0);
  const sway = opts.sway ? Math.sin(opts.t / 900) * 0.035 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  if (opts.hang) {
    ctx.strokeStyle = 'rgba(80,55,30,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w / 3, 0); ctx.lineTo(0, -10); ctx.lineTo(w / 3, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -10, 2, 0, Math.PI * 2); ctx.fillStyle = '#6b4a2e'; ctx.fill();
  }
  ctx.shadowColor = 'rgba(30,20,10,0.3)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  rrPath(ctx, -w / 2, 0, w, h, 7);
  ctx.fillStyle = opts.bg || '#fff7ed';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = opts.border || '#c2410c';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = tf;
  ctx.fillStyle = opts.color || '#9a3412';
  ctx.fillText(title, 0, 13.5);
  if (subLines.length) {
    ctx.font = sf;
    ctx.fillStyle = opts.subColor || '#78716c';
    subLines.forEach((l, i) => ctx.fillText(l, 0, 26 + lh * (i + 0.5) - 1));
  }
  ctx.restore();
}
