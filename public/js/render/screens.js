// Nội dung màn hình máy tính (vẽ mỗi khung hình, toạ độ theo ô).
// Người xem có thể "nhìn trộm" màn hình: code thật hay đang lướt TikTok / săn sale Shopee.
import { hash2 } from '../util.js';
import { fillRR, rect, circle, ellipse, line } from './draw.js';

const CODE_COLORS = ['#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#e06c75', '#abb2bf'];

function code(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#1e2433');
  rect(ctx, r.x, r.y, r.w * 0.1, r.h, '#181d29');
  rect(ctx, r.x, r.y, r.w, r.h * 0.1, '#262c3b');
  circle(ctx, r.x + r.w * 0.05, r.y + r.h * 0.05, r.h * 0.025, '#ef4444');
  circle(ctx, r.x + r.w * 0.09, r.y + r.h * 0.05, r.h * 0.025, '#f59e0b');
  const lh = r.h / 10;
  const n = 14;
  const scroll = ((t / 1000) * 0.5 + seed) % n;
  for (let i = 0; i < n; i++) {
    let yy = (i - scroll + n) % n;
    const y = r.y + r.h * 0.13 + yy * lh;
    if (y > r.y + r.h - lh * 0.4) continue;
    const li = (i + Math.floor(seed)) | 0;
    const indent = Math.floor(hash2(li, 1, seed) * 4) * r.w * 0.06;
    let x = r.x + r.w * 0.14 + indent;
    rect(ctx, r.x + r.w * 0.03, y + lh * 0.25, r.w * 0.04, lh * 0.35, 'rgba(171,178,191,0.3)');
    const segs = 1 + Math.floor(hash2(li, 2, seed) * 3);
    for (let s = 0; s < segs; s++) {
      const w = r.w * (0.08 + hash2(li, s + 3, seed) * 0.22);
      if (x + w > r.x + r.w * 0.96) break;
      ctx.fillStyle = CODE_COLORS[Math.floor(hash2(li, s + 9, seed) * CODE_COLORS.length)];
      ctx.fillRect(x, y + lh * 0.22, w, lh * 0.42);
      x += w + r.w * 0.03;
    }
  }
  if (Math.floor(t / 500) % 2) rect(ctx, r.x + r.w * 0.5, r.y + r.h * 0.8, r.w * 0.03, lh * 0.5, '#e5e7eb');
}

function qa(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#111827');
  const lh = r.h / 8;
  const scroll = ((t / 1000) * 0.6 + seed) % 12;
  for (let i = 0; i < 12; i++) {
    const yy = (i - scroll + 12) % 12;
    const y = r.y + r.h * 0.06 + yy * lh;
    if (y > r.y + r.h * 0.78) continue;
    const ok = hash2(i, 1, seed) > 0.22;
    circle(ctx, r.x + r.w * 0.08, y + lh * 0.45, lh * 0.25, ok ? '#22c55e' : '#ef4444');
    rect(ctx, r.x + r.w * 0.16, y + lh * 0.3, r.w * (0.3 + hash2(i, 2, seed) * 0.45), lh * 0.3, ok ? 'rgba(209,213,219,0.6)' : 'rgba(252,165,165,0.8)');
  }
  const p = ((t / 1000) * 0.08 + seed) % 1;
  rect(ctx, r.x + r.w * 0.06, r.y + r.h * 0.84, r.w * 0.88, r.h * 0.08, '#374151');
  rect(ctx, r.x + r.w * 0.06, r.y + r.h * 0.84, r.w * 0.88 * p, r.h * 0.08, '#22c55e');
}

function design(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#e5e7eb');
  rect(ctx, r.x, r.y, r.w * 0.1, r.h, '#1f2937');
  for (let i = 0; i < 4; i++) rect(ctx, r.x + r.w * 0.03, r.y + r.h * (0.12 + i * 0.18), r.w * 0.04, r.h * 0.08, i === 1 ? '#a78bfa' : '#6b7280');
  rect(ctx, r.x + r.w * 0.82, r.y, r.w * 0.18, r.h, '#f9fafb');
  for (let i = 0; i < 5; i++) rect(ctx, r.x + r.w * 0.85, r.y + r.h * (0.1 + i * 0.16), r.w * 0.12, r.h * 0.05, '#d1d5db');
  const cx = r.x + r.w * 0.14, cw = r.w * 0.64;
  rect(ctx, cx, r.y + r.h * 0.1, cw, r.h * 0.8, '#ffffff');
  const k = (Math.sin(t / 900 + seed) + 1) / 2;
  fillRR(ctx, cx + cw * 0.08, r.y + r.h * 0.2, cw * 0.4, r.h * 0.22, r.h * 0.04, '#ff7a45');
  circle(ctx, cx + cw * (0.7 + k * 0.1), r.y + r.h * 0.38, r.h * 0.13, '#60a5fa');
  rect(ctx, cx + cw * 0.08, r.y + r.h * 0.55, cw * 0.6, r.h * 0.06, '#d1d5db');
  rect(ctx, cx + cw * 0.08, r.y + r.h * 0.66, cw * 0.4, r.h * 0.06, '#e5e7eb');
  fillRR(ctx, cx + cw * 0.08, r.y + r.h * 0.76, cw * 0.28, r.h * 0.09, r.h * 0.03, '#22c55e');
  // con trỏ chuột
  const mx = cx + cw * (0.3 + 0.4 * Math.sin(t / 1300 + seed) ** 2), my = r.y + r.h * (0.3 + 0.35 * Math.cos(t / 1700 + seed) ** 2);
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + r.w * 0.04, my + r.h * 0.1); ctx.lineTo(mx + r.w * 0.012, my + r.h * 0.08); ctx.closePath();
  ctx.fillStyle = '#111827'; ctx.fill();
}

function sheet(ctx, r, t, seed, accent = '#16a34a') {
  rect(ctx, r.x, r.y, r.w, r.h, '#ffffff');
  rect(ctx, r.x, r.y, r.w, r.h * 0.13, accent);
  rect(ctx, r.x + r.w * 0.04, r.y + r.h * 0.04, r.w * 0.25, r.h * 0.05, 'rgba(255,255,255,0.8)');
  const rows = 7, cols = 5;
  const gy = r.y + r.h * 0.17, gh = r.h * 0.78, gw = r.w * 0.62;
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = r.h * 0.01;
  ctx.beginPath();
  for (let i = 0; i <= rows; i++) { ctx.moveTo(r.x, gy + (gh * i) / rows); ctx.lineTo(r.x + gw, gy + (gh * i) / rows); }
  for (let j = 0; j <= cols; j++) { ctx.moveTo(r.x + (gw * j) / cols, gy); ctx.lineTo(r.x + (gw * j) / cols, gy + gh); }
  ctx.stroke();
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const v = hash2(i, j, seed);
    if (v < 0.6) rect(ctx, r.x + (gw * j) / cols + r.w * 0.015, gy + (gh * i) / rows + gh / rows * 0.35, (gw / cols) * (0.3 + v * 0.6), gh / rows * 0.3, v < 0.1 ? '#f59e0b' : '#9ca3af');
  }
  const sel = Math.floor(t / 1200 + seed) % (rows * cols);
  ctx.strokeStyle = accent;
  ctx.lineWidth = r.h * 0.02;
  ctx.strokeRect(r.x + (gw * (sel % cols)) / cols, gy + (gh * Math.floor(sel / cols)) / rows, gw / cols, gh / rows);
  // biểu đồ cột nhỏ
  const bx = r.x + r.w * 0.68, bw = r.w * 0.28, by = r.y + r.h * 0.9;
  for (let k = 0; k < 5; k++) {
    const h = r.h * (0.15 + hash2(k, Math.floor(t / 4000), seed) * 0.5);
    rect(ctx, bx + (bw * k) / 5, by - h, (bw / 5) * 0.7, h, k === 4 ? '#ff7a45' : '#60a5fa');
  }
}

function mkt(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#18181b');
  const pv = { x: r.x + r.w * 0.2, y: r.y + r.h * 0.06, w: r.w * 0.6, h: r.h * 0.5 };
  const hue = (t / 40 + seed * 50) % 360;
  const g = ctx.createLinearGradient(pv.x, pv.y, pv.x + pv.w, pv.y + pv.h);
  g.addColorStop(0, `hsl(${hue},80%,60%)`);
  g.addColorStop(1, `hsl(${(hue + 80) % 360},80%,55%)`);
  ctx.fillStyle = g;
  ctx.fillRect(pv.x, pv.y, pv.w, pv.h);
  ctx.beginPath(); ctx.moveTo(pv.x + pv.w * 0.44, pv.y + pv.h * 0.3); ctx.lineTo(pv.x + pv.w * 0.6, pv.y + pv.h * 0.5); ctx.lineTo(pv.x + pv.w * 0.44, pv.y + pv.h * 0.7); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  const tracks = ['#f472b6', '#60a5fa', '#facc15'];
  for (let k = 0; k < 3; k++) {
    const ty = r.y + r.h * (0.64 + k * 0.11);
    let x = r.x + r.w * 0.04 - ((t / 3000 + k * 0.3) % 1) * r.w * 0.2;
    while (x < r.x + r.w) {
      const w = r.w * (0.12 + hash2(k, Math.floor(x * 100), seed) * 0.18);
      fillRR(ctx, x, ty, w - r.w * 0.015, r.h * 0.08, r.h * 0.02, tracks[k]);
      x += w;
    }
  }
  const ph = r.x + r.w * (0.1 + ((t / 5000 + seed) % 1) * 0.8);
  rect(ctx, ph, r.y + r.h * 0.6, r.w * 0.012, r.h * 0.38, '#ef4444');
}

function tiktok(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#050505');
  const vw = r.w * 0.38, vx = r.x + (r.w - vw) / 2;
  const clip = Math.floor(t / 3500 + seed) % 4;
  const hue = [330, 185, 280, 20][clip];
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, `hsl(${hue},85%,62%)`);
  g.addColorStop(1, `hsl(${(hue + 50) % 360},85%,45%)`);
  ctx.fillStyle = g;
  ctx.fillRect(vx, r.y, vw, r.h);
  // người nhảy
  const bob = Math.sin(t / 160) * r.h * 0.05;
  const sway = Math.sin(t / 320) * vw * 0.12;
  circle(ctx, vx + vw / 2 + sway, r.y + r.h * 0.3 + bob, r.h * 0.1, 'rgba(255,255,255,0.92)');
  fillRR(ctx, vx + vw / 2 - vw * 0.15 + sway * 0.6, r.y + r.h * 0.42 + bob, vw * 0.3, r.h * 0.34, r.h * 0.05, 'rgba(255,255,255,0.85)');
  line(ctx, vx + vw / 2 - vw * 0.15 + sway * 0.6, r.y + r.h * 0.48 + bob, vx + vw * 0.15 + sway, r.y + r.h * (0.35 + 0.1 * Math.sin(t / 160)), 'rgba(255,255,255,0.85)', r.h * 0.06);
  line(ctx, vx + vw / 2 + vw * 0.15 + sway * 0.6, r.y + r.h * 0.48 + bob, vx + vw * 0.85 + sway, r.y + r.h * (0.35 - 0.1 * Math.sin(t / 160)), 'rgba(255,255,255,0.85)', r.h * 0.06);
  // tim bay
  for (let k = 0; k < 3; k++) {
    const p = ((t / 1400 + k / 3 + seed) % 1);
    ctx.fillStyle = `rgba(254,44,85,${(1 - p).toFixed(2)})`;
    const hx = vx + vw * 0.86, hy = r.y + r.h * (0.85 - p * 0.6);
    circle(ctx, hx - r.h * 0.025, hy, r.h * 0.03, ctx.fillStyle);
    circle(ctx, hx + r.h * 0.025, hy, r.h * 0.03, ctx.fillStyle);
  }
  for (let k = 0; k < 3; k++) circle(ctx, vx + vw * 0.9, r.y + r.h * (0.45 + k * 0.13), r.h * 0.035, 'rgba(255,255,255,0.8)');
  rect(ctx, vx + vw * 0.08, r.y + r.h * 0.84, vw * 0.5, r.h * 0.04, 'rgba(255,255,255,0.8)');
  rect(ctx, r.x + r.w * 0.05, r.y + r.h * 0.1, r.w * 0.15, r.h * 0.05, '#25f4ee');
  rect(ctx, r.x + r.w * 0.8, r.y + r.h * 0.1, r.w * 0.15, r.h * 0.05, '#fe2c55');
}

function shopee(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#f5f5f5');
  rect(ctx, r.x, r.y, r.w, r.h * 0.17, '#ee4d2d');
  fillRR(ctx, r.x + r.w * 0.2, r.y + r.h * 0.04, r.w * 0.6, r.h * 0.09, r.h * 0.02, '#ffffff');
  const cols = 3, rows = 2;
  const cw = (r.w * 0.92) / cols, ch = (r.h * 0.74) / rows;
  const shift = Math.floor(t / 2500 + seed);
  const blobs = ['#f472b6', '#60a5fa', '#facc15', '#34d399', '#a78bfa', '#fb923c'];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const x = r.x + r.w * 0.04 + j * cw, y = r.y + r.h * 0.22 + i * ch;
    fillRR(ctx, x + cw * 0.05, y + ch * 0.05, cw * 0.9, ch * 0.9, r.h * 0.02, '#ffffff');
    const c = blobs[(i * 3 + j + shift) % blobs.length];
    fillRR(ctx, x + cw * 0.2, y + ch * 0.12, cw * 0.6, ch * 0.46, r.h * 0.03, c);
    rect(ctx, x + cw * 0.12, y + ch * 0.66, cw * 0.5, ch * 0.08, '#d1d5db');
    rect(ctx, x + cw * 0.12, y + ch * 0.78, cw * 0.32, ch * 0.08, '#ee4d2d');
  }
  if (Math.floor(t / 400) % 2) {
    fillRR(ctx, r.x + r.w * 0.66, r.y + r.h * 0.2, r.w * 0.3, r.h * 0.14, r.h * 0.03, '#facc15');
    rect(ctx, r.x + r.w * 0.7, r.y + r.h * 0.25, r.w * 0.22, r.h * 0.04, '#b91c1c');
  }
}

function game(ctx, r, t, seed) {
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#312e81'); g.addColorStop(1, '#7c3aed');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  for (let k = 0; k < 6; k++) circle(ctx, r.x + r.w * hash2(k, 1, seed), r.y + r.h * hash2(k, 2, seed) * 0.5, r.h * 0.015, 'rgba(255,255,255,0.8)');
  const gy = r.y + r.h * 0.78;
  rect(ctx, r.x, gy, r.w, r.h * 0.22, '#16a34a');
  rect(ctx, r.x, gy, r.w, r.h * 0.04, '#4ade80');
  const sp = (t / 1000) * 0.6;
  for (let k = 0; k < 3; k++) {
    const ox = r.x + r.w * (((k * 0.4 - sp) % 1.2 + 1.2) % 1.2) - r.w * 0.1;
    rect(ctx, ox, gy - r.h * 0.16, r.w * 0.06, r.h * 0.16, '#f97316');
  }
  const jump = Math.abs(Math.sin(t / 380)) * r.h * 0.3;
  rect(ctx, r.x + r.w * 0.22, gy - r.h * 0.16 - jump, r.w * 0.08, r.h * 0.16, '#facc15');
  rect(ctx, r.x + r.w * 0.26, gy - r.h * 0.13 - jump, r.w * 0.02, r.h * 0.03, '#111827');
  rect(ctx, r.x + r.w * 0.7, r.y + r.h * 0.08, r.w * 0.24, r.h * 0.08, 'rgba(255,255,255,0.85)');
}

function crypto(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#0b1220');
  const n = 12;
  const shift = Math.floor(t / 700);
  let prev = 0.5;
  for (let i = 0; i < n; i++) {
    const v = hash2(i + shift, 1, seed);
    const o = prev, c = Math.min(0.9, Math.max(0.1, prev + (v - 0.5) * 0.3));
    const up = c >= o;
    const x = r.x + r.w * (0.05 + (i / n) * 0.9);
    const y1 = r.y + r.h * (1 - Math.max(o, c)) * 0.8 + r.h * 0.1, y2 = r.y + r.h * (1 - Math.min(o, c)) * 0.8 + r.h * 0.1;
    line(ctx, x + r.w * 0.025, y1 - r.h * 0.05, x + r.w * 0.025, y2 + r.h * 0.05, up ? '#22c55e' : '#ef4444', r.h * 0.015);
    rect(ctx, x, y1, r.w * 0.05, Math.max(r.h * 0.02, y2 - y1), up ? '#22c55e' : '#ef4444');
    prev = c;
  }
  rect(ctx, r.x + r.w * 0.05, r.y + r.h * 0.04, r.w * 0.25, r.h * 0.08, '#f7931a');
}

function video(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#0f0f0f');
  const v = { x: r.x + r.w * 0.04, y: r.y + r.h * 0.06, w: r.w * 0.92, h: r.h * 0.7 };
  const hue = (seed * 70 + t / 90) % 360;
  const g = ctx.createLinearGradient(v.x, v.y, v.x + v.w, v.y + v.h);
  g.addColorStop(0, `hsl(${hue},55%,35%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},60%,55%)`);
  ctx.fillStyle = g;
  ctx.fillRect(v.x, v.y, v.w, v.h);
  circle(ctx, v.x + v.w * (0.3 + 0.2 * Math.sin(t / 1100)), v.y + v.h * 0.55, v.h * 0.2, 'rgba(255,255,255,0.25)');
  rect(ctx, v.x, v.y + v.h - v.h * 0.25, v.w, v.h * 0.25, 'rgba(0,0,0,0.25)');
  rect(ctx, r.x + r.w * 0.04, r.y + r.h * 0.8, r.w * 0.92, r.h * 0.04, '#3f3f46');
  rect(ctx, r.x + r.w * 0.04, r.y + r.h * 0.8, r.w * 0.92 * (((t / 20000) + seed) % 1), r.h * 0.04, '#ff0000');
  fillRR(ctx, r.x + r.w * 0.04, r.y + r.h * 0.88, r.w * 0.12, r.h * 0.08, r.h * 0.02, '#ff0000');
}

function chat(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#ffffff');
  rect(ctx, r.x, r.y, r.w, r.h * 0.15, '#0068ff');
  circle(ctx, r.x + r.w * 0.08, r.y + r.h * 0.075, r.h * 0.045, '#ffffff');
  const n = 8, lh = r.h * 0.13;
  const scroll = ((t / 1000) * 0.4 + seed) % n;
  for (let i = 0; i < n; i++) {
    const yy = (i - scroll + n) % n;
    const y = r.y + r.h * 0.2 + yy * lh;
    if (y > r.y + r.h - lh * 0.6) continue;
    const mine = hash2(i, 1, seed) > 0.5;
    const w = r.w * (0.25 + hash2(i, 2, seed) * 0.35);
    fillRR(ctx, mine ? r.x + r.w * 0.94 - w : r.x + r.w * 0.06, y, w, lh * 0.75, lh * 0.35, mine ? '#3b82f6' : '#e5e7eb');
  }
}

function news(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#fafafa');
  rect(ctx, r.x, r.y, r.w, r.h * 0.12, '#b91c1c');
  rect(ctx, r.x + r.w * 0.05, r.y + r.h * 0.18, r.w * 0.42, r.h * 0.36, `hsl(${(seed * 40) % 360},40%,60%)`);
  for (let k = 0; k < 4; k++) rect(ctx, r.x + r.w * 0.52, r.y + r.h * (0.2 + k * 0.09), r.w * (0.4 - k * 0.05), r.h * 0.05, k === 0 ? '#111827' : '#9ca3af');
  const scroll = ((t / 1000) * 0.3) % 1;
  for (let k = 0; k < 4; k++) rect(ctx, r.x + r.w * 0.05, r.y + r.h * (0.62 + k * 0.09 - scroll * 0.09), r.w * (0.8 - (k % 2) * 0.2), r.h * 0.045, '#d1d5db');
}

function football(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#15803d');
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = r.h * 0.015;
  ctx.strokeRect(r.x + r.w * 0.05, r.y + r.h * 0.12, r.w * 0.9, r.h * 0.8);
  line(ctx, r.x + r.w / 2, r.y + r.h * 0.12, r.x + r.w / 2, r.y + r.h * 0.92, 'rgba(255,255,255,0.7)', r.h * 0.015);
  ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h * 0.52, r.h * 0.12, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const px = r.x + r.w * (0.15 + 0.7 * ((hash2(k, 1, seed) + Math.sin(t / 2000 + k) * 0.08 + 1) % 1));
    const py = r.y + r.h * (0.2 + 0.65 * hash2(k, 2, seed));
    circle(ctx, px, py, r.h * 0.03, k < 4 ? '#ef4444' : '#facc15');
  }
  circle(ctx, r.x + r.w * (0.5 + 0.3 * Math.sin(t / 900)), r.y + r.h * (0.5 + 0.2 * Math.cos(t / 700)), r.h * 0.02, '#ffffff');
  rect(ctx, r.x, r.y, r.w * 0.35, r.h * 0.1, 'rgba(0,0,0,0.6)');
}

function lockScreen(ctx, r, t, seed) {
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  const hue = (seed * 37) % 360;
  g.addColorStop(0, `hsl(${hue},45%,32%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},45%,22%)`);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  rect(ctx, r.x + r.w * 0.35, r.y + r.h * 0.3, r.w * 0.3, r.h * 0.14, 'rgba(255,255,255,0.75)');
  circle(ctx, r.x + r.w * 0.5, r.y + r.h * 0.64, r.h * 0.08, 'rgba(255,255,255,0.45)');
}

function sleepScreen(ctx, r, t, seed) {
  rect(ctx, r.x, r.y, r.w, r.h, '#05070c');
  const px = r.x + r.w * (0.2 + 0.6 * ((Math.sin(t / 2300 + seed) + 1) / 2));
  const py = r.y + r.h * (0.25 + 0.5 * ((Math.cos(t / 1700 + seed) + 1) / 2));
  circle(ctx, px, py, r.h * 0.08, 'rgba(96,165,250,0.35)');
  ctx.fillStyle = 'rgba(147,197,253,0.4)';
  ctx.font = `700 ${r.h * 0.18}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('z', px, py);
}

function offScreen(ctx, r) {
  rect(ctx, r.x, r.y, r.w, r.h, '#0b0d12');
}

const PAINT = { code, qa, design, sheet, mkt, tiktok, shopee, game, crypto, video, chat, news, football, lock: lockScreen, sleep: sleepScreen, off: offScreen };

/** vẽ màn hình loại kind vào hình chữ nhật r */
export function drawScreen(ctx, kind, r, t, seed, opts = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  (PAINT[kind] || offScreen)(ctx, r, t, seed);
  if (opts.wifiDown && kind !== 'off' && kind !== 'sleep') {
    ctx.globalCompositeOperation = 'saturation';
    rect(ctx, r.x, r.y, r.w, r.h, '#808080');
    ctx.globalCompositeOperation = 'source-over';
    rect(ctx, r.x, r.y, r.w, r.h, 'rgba(20,20,30,0.35)');
    // biểu tượng mất wifi
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = r.h * 0.05;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.arc(cx, cy + r.h * 0.15, r.h * 0.11 * k, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
    }
    line(ctx, cx - r.h * 0.3, cy - r.h * 0.25, cx + r.h * 0.3, cy + r.h * 0.25, '#ef4444', r.h * 0.07);
  }
  // vệt kính phản chiếu
  if (kind !== 'off') {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w * 0.25, r.y + r.h); ctx.lineTo(r.x + r.w * 0.55, r.y); ctx.lineTo(r.x + r.w * 0.3, r.y); ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * 0.1, r.y + r.h); ctx.lineTo(r.x + r.w * 0.3, r.y + r.h); ctx.lineTo(r.x + r.w * 0.6, r.y); ctx.lineTo(r.x + r.w * 0.4, r.y); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** độ sáng ánh màn hình hắt ra (cho hiệu ứng đêm) */
export function screenGlow(kind) {
  switch (kind) {
    case 'off': return null;
    case 'sleep': return 'rgba(96,165,250,0.25)';
    case 'tiktok': return 'rgba(244,114,182,0.55)';
    case 'shopee': return 'rgba(249,115,22,0.55)';
    case 'game': return 'rgba(167,139,250,0.55)';
    case 'code': case 'qa': case 'crypto': return 'rgba(96,165,250,0.5)';
    default: return 'rgba(219,234,254,0.5)';
  }
}

/** TV góc chill: đổi kênh mỗi ~30 giây (bóng đá, MV ca nhạc, nấu ăn, thời sự) */
export function drawTvScreen(ctx, r, t) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const ch = Math.floor(t / 30000) % 4;
  if (ch === 0) football(ctx, r, t, 3);
  else if (ch === 1) {
    const hue = (t / 30) % 360;
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, `hsl(${hue},70%,45%)`); g.addColorStop(1, `hsl(${(hue + 120) % 360},70%,35%)`);
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const h = r.h * (0.15 + 0.55 * Math.abs(Math.sin(t / 180 + i * 0.7) * Math.cos(t / 410 + i)));
      rect(ctx, r.x + (r.w * i) / n + r.w * 0.01, r.y + r.h - h, r.w / n - r.w * 0.02, h, 'rgba(255,255,255,0.55)');
    }
    circle(ctx, r.x + r.w * 0.5, r.y + r.h * 0.38, r.h * 0.16, 'rgba(255,255,255,0.85)');
    fillRR(ctx, r.x + r.w * 0.44, r.y + r.h * 0.52, r.w * 0.12, r.h * 0.3, r.h * 0.05, 'rgba(255,255,255,0.8)');
  } else if (ch === 2) {
    rect(ctx, r.x, r.y, r.w, r.h, '#fde9d2');
    rect(ctx, r.x, r.y + r.h * 0.65, r.w, r.h * 0.35, '#c08457');
    ellipse(ctx, r.x + r.w * 0.5, r.y + r.h * 0.62, r.w * 0.16, r.h * 0.1, '#374151');
    rect(ctx, r.x + r.w * 0.34, r.y + r.h * 0.45, r.w * 0.32, r.h * 0.17, '#4b5563');
    for (let k = 0; k < 3; k++) {
      const p = ((t / 1200) + k / 3) % 1;
      circle(ctx, r.x + r.w * (0.45 + k * 0.05), r.y + r.h * (0.42 - p * 0.3), r.h * 0.04, `rgba(255,255,255,${(1 - p) * 0.8})`);
    }
    circle(ctx, r.x + r.w * 0.2, r.y + r.h * 0.35, r.h * 0.12, '#fcd34d');
    rect(ctx, r.x + r.w * 0.14, r.y + r.h * 0.47, r.w * 0.12, r.h * 0.2, '#ffffff');
  } else {
    rect(ctx, r.x, r.y, r.w, r.h, '#1e3a8a');
    rect(ctx, r.x, r.y + r.h * 0.78, r.w, r.h * 0.22, '#b91c1c');
    const off = (t / 25) % (r.w * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 6; k++) ctx.fillRect(r.x + r.w - off + k * r.w * 0.38, r.y + r.h * 0.85, r.w * 0.25, r.h * 0.06);
    circle(ctx, r.x + r.w * 0.3, r.y + r.h * 0.36, r.h * 0.14, '#fcd34d');
    fillRR(ctx, r.x + r.w * 0.22, r.y + r.h * 0.5, r.w * 0.16, r.h * 0.28, r.h * 0.05, '#111827');
    rect(ctx, r.x + r.w * 0.55, r.y + r.h * 0.18, r.w * 0.36, r.h * 0.42, '#60a5fa');
  }
  // nhiễu sáng nhấp nháy
  ctx.fillStyle = `rgba(255,255,255,${(0.03 + 0.03 * Math.sin(t / 60)).toFixed(3)})`;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}
