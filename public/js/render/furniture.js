// Nội thất: mỗi món vẽ vào 1 sprite offscreen (cache theo tỉ lệ), vẽ theo thứ tự y cùng nhân vật.
// Phần động (màn hình, bảng KPI, TV, đèn server, hơi cà phê...) vẽ mỗi khung hình qua drawOverlay.
import { hashStr, hash2 } from '../util.js';
import {
  fillRR, strokeRR, rrPath, rect, ellipse, circle, line, box, makeCanvas, FONT, shade, fitText, drawEmoji,
} from './draw.js';

// ------------------------------------------------------------------ hình học dùng chung
export const DESK_H = 0.42;

/** vị trí các chi tiết trên bàn nhân viên (ghế ở dưới bàn -> màn hình quay về phía người xem) */
export function deskGeom(f) {
  const { x, y, w } = f;
  const topY = y - DESK_H; // mép sau của mặt bàn
  const monW = Math.min(1.56, w * 0.52), monH = 0.9;
  const monBottom = topY + 0.3;
  const mx = x + w / 2 - monW / 2;
  return {
    topY,
    mon: { x: mx, y: monBottom - monH, w: monW, h: monH },
    screen: { x: mx + 0.07, y: monBottom - monH + 0.07, w: monW - 0.14, h: monH - 0.19 },
    item: { x: x + w - 0.45, y: topY + 0.95 },
    lamp: { x: x + 0.38, y: topY + 0.02 },
    keyboard: { x: x + w / 2 - 0.55, y: topY + 1.32, w: 1.1, h: 0.28 },
  };
}

export function bossDeskGeom(f) {
  const { x, y, w } = f;
  const topY = y - 0.45;
  return {
    topY,
    lamp: { x: x + 0.62, y: topY + 0.15 },
    mon: { x: x + w - 2.15, y: topY - 0.42, w: 1.45, h: 0.78 },
  };
}

/** bảng KPI v2: panel rộng hơn footprint (9.4 ô), cao 3 ô — chữ to hơn; rê chuột lên bảng còn có tooltip đọc được */
export function kpiGeom(f) {
  const pw = Math.max(f.w, 9.4), ph = 3.0;
  const px = f.x + f.w / 2 - pw / 2, py = f.y + f.h - 0.55 - ph;
  const title = { x: px + 0.1, y: py + 0.1, w: pw - 0.2, h: 0.5 };
  const chart = { x: px + 0.55, y: py + 0.76, w: pw - 0.8, h: 1.1 };
  const names = { y: chart.y + chart.h + 0.05, h: 0.5 };
  const revenue = { x: px + 0.3, y: py + ph - 0.44, w: pw - 0.6, h: 0.34 };
  return { panel: { x: px, y: py, w: pw, h: ph }, title, chart, names, revenue, base: chart.y + chart.h, full: chart.h * 0.8 };
}

/** bảng trắng phòng họp v2: khung tĩnh + vùng nội dung động (tên dự án, % tiến độ, hạn) */
export function whiteboardGeom(f) {
  const { x, y, w } = f;
  const bx = x + 0.1, bw = w - 0.2, by = y - 0.78, bh = 1.42;
  const inner = { x: bx + 0.07, y: by + 0.07, w: bw - 0.14, h: bh - 0.14 };
  const dyn = { x: inner.x + 0.12, y: inner.y + 0.08, w: inner.w * 0.6, h: inner.h - 0.16 };
  const side = { x: inner.x + inner.w * 0.63, y: inner.y + 0.08, w: inner.w * 0.37 - 0.1, h: inner.h - 0.16 };
  return { board: { x: bx, y: by, w: bw, h: bh }, inner, dyn, side };
}

/** kệ trưng bày v4: 2 tầng × 7 ô (slot 0–6 tầng trên, 7–13 tầng dưới) — khớp SHELF_SLOTS ở src/content/products.ts */
export const SHELF_PER_TIER = 7;
export const SHELF_TIERS = 2;
export function shelfGeom(f) {
  const { x, y, w } = f;
  const n = SHELF_PER_TIER;
  const pitch = (w - 0.16) / n;
  const cardW = Math.min(0.5, pitch * 0.9), cardH = 0.44;
  const unit = { x: x + 0.03, y: y - 0.8, w: w - 0.06, h: 1.8 };
  const header = { x: x + 0.08, y: y - 0.77, w: w - 0.16, h: 0.3 };
  const tiers = [y + 0.1, y + 0.66]; // mép trước từng tấm kệ (sản phẩm đứng trên)
  const slots = [];
  for (let t = 0; t < SHELF_TIERS; t++) {
    for (let i = 0; i < n; i++) {
      const cx = x + 0.08 + pitch * (i + 0.5);
      slots.push({ i: t * n + i, tier: t, cx, x: cx - cardW / 2, y: tiers[t] - cardH - 0.02, w: cardW, h: cardH });
    }
  }
  return { unit, header, tiers, slots, cardW, cardH, pitch, perTier: n };
}

/** bục trưng bày giữa phòng: bệ tròn + lồng kính */
export function podiumGeom(f) {
  const cx = f.x + f.w / 2, baseY = f.y + f.h - 0.12;
  const topY = baseY - 0.62;
  return { cx, baseY, topY, rx: Math.min(0.62, f.w * 0.36), item: { x: cx - 0.3, y: topY - 0.64, w: 0.6, h: 0.56 } };
}

export function tvGeom(f) {
  const cabTop = f.y + 0.35 - 0.35;
  const sw = f.w - 0.8;
  return { screen: { x: f.x + 0.4 + 0.06, y: cabTop - 1.12 + 0.06, w: sw - 0.12, h: 0.94 - 0.12 }, frame: { x: f.x + 0.4, y: cabTop - 1.12, w: sw, h: 0.94 } };
}

export function rackGeom(f) {
  const n = Math.max(1, Math.round(f.w / 2));
  const cw = f.w / n;
  const H = 1.6, backY = f.y + f.h - 1.2;
  const cabs = [];
  for (let i = 0; i < n; i++) {
    const cx = f.x + i * cw + 0.06;
    const frontTop = backY + 1.15 - H;
    cabs.push({ x: cx, w: cw - 0.12, frontTop, frontBottom: backY + 1.15 });
  }
  const leds = [];
  cabs.forEach((c, ci) => {
    for (let k = 0; k < 6; k++) {
      const ly = c.frontTop + 0.22 + k * 0.2;
      for (let j = 0; j < 3; j++) leds.push({ x: c.x + 0.2 + j * 0.13, y: ly + 0.05, seed: ci * 100 + k * 10 + j });
    }
  });
  return { cabs, leds };
}

export function coffeeGeom(f) {
  return { spout: { x: f.x + 0.5, y: f.y - 0.45 - 0.35 }, top: { x: f.x + 0.5, y: f.y - 0.45 - 0.62 } };
}

// ------------------------------------------------------------------ chi tiết nhỏ
function mug(ctx, cx, cy, color) {
  ellipse(ctx, cx + 0.02, cy + 0.12, 0.11, 0.04, 'rgba(0,0,0,0.18)');
  fillRR(ctx, cx - 0.09, cy - 0.12, 0.18, 0.22, [0, 0, 0.05, 0.05], color);
  ellipse(ctx, cx, cy - 0.12, 0.09, 0.035, shade(color, 0.25));
  ellipse(ctx, cx, cy - 0.115, 0.07, 0.025, '#6b4226');
  ctx.beginPath();
  ctx.arc(cx + 0.1, cy - 0.03, 0.05, -Math.PI / 2, Math.PI / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.03;
  ctx.stroke();
}

function paperStack(ctx, x, y, w, h, rot = 0) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rot);
  rect(ctx, -w / 2 + 0.02, -h / 2 + 0.03, w, h, 'rgba(0,0,0,0.12)');
  rect(ctx, -w / 2, -h / 2, w, h, '#fbfbf8');
  ctx.fillStyle = 'rgba(100,116,139,0.45)';
  for (let i = 0; i < 4; i++) ctx.fillRect(-w / 2 + 0.05, -h / 2 + 0.06 + i * 0.06, w * (0.5 + ((i * 37) % 4) * 0.1), 0.018);
  ctx.restore();
}

function tinyPlant(ctx, cx, cy, kind) {
  fillRR(ctx, cx - 0.1, cy - 0.06, 0.2, 0.16, [0, 0, 0.04, 0.04], kind % 2 ? '#e8e2d6' : '#d9825b');
  if (kind % 3 === 0) {
    fillRR(ctx, cx - 0.05, cy - 0.32, 0.1, 0.3, 0.05, '#5c9b5a');
    fillRR(ctx, cx - 0.12, cy - 0.22, 0.06, 0.12, 0.03, '#5c9b5a');
    circle(ctx, cx, cy - 0.33, 0.03, '#f472b6');
  } else {
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.5;
      ellipse(ctx, cx + Math.cos(a) * 0.1, cy - 0.12 + Math.sin(a) * 0.1, 0.07, 0.04, k % 2 ? '#4f9e57' : '#3f8a4a');
    }
  }
}

function deskLamp(ctx, x, y) {
  ellipse(ctx, x, y + 0.04, 0.1, 0.035, '#374151');
  line(ctx, x, y + 0.02, x + 0.06, y - 0.3, '#4b5563', 0.03);
  line(ctx, x + 0.06, y - 0.3, x + 0.22, y - 0.38, '#4b5563', 0.03);
  ctx.beginPath();
  ctx.moveTo(x + 0.16, y - 0.42); ctx.lineTo(x + 0.33, y - 0.36); ctx.lineTo(x + 0.27, y - 0.26); ctx.closePath();
  ctx.fillStyle = '#f59e0b';
  ctx.fill();
}

const MUG_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#ffffff', '#14b8a6'];

// ------------------------------------------------------------------ painters
function paintDesk(ctx, f) {
  const { x, y, w, h } = f;
  const g = deskGeom(f);
  const seed = hashStr(f.owner || `${x},${y}`);
  const fy = y + h - DESK_H; // mép trước mặt bàn
  // phần dưới: tấm chắn + hộc tủ
  rect(ctx, x + 0.18, fy + 0.08, w - 0.36, DESK_H - 0.08, '#9c7a55');
  rect(ctx, x + 0.18, fy + 0.08, w - 0.36, 0.05, 'rgba(0,0,0,0.18)');
  fillRR(ctx, x + 0.03, fy, 0.15, DESK_H, [0, 0, 0.03, 0.03], '#8e6c48');
  fillRR(ctx, x + w - 0.95, fy, 0.82, DESK_H, [0, 0, 0.03, 0.03], '#b38e64');
  for (let k = 0; k < 2; k++) {
    rect(ctx, x + w - 0.9, fy + 0.1 + k * 0.15, 0.72, 0.012, 'rgba(60,40,20,0.35)');
    rect(ctx, x + w - 0.6, fy + 0.16 + k * 0.15, 0.14, 0.03, '#e5e7eb');
  }
  // mặt bàn
  fillRR(ctx, x, fy - 0.03, w, 0.11, [0, 0, 0.04, 0.04], '#b48d62');
  fillRR(ctx, x, g.topY, w, h, 0.08, '#ecd7b3');
  rect(ctx, x + 0.06, fy - 0.035, w - 0.12, 0.025, 'rgba(255,255,255,0.45)');
  ctx.fillStyle = 'rgba(160,120,70,0.10)';
  for (let k = 0; k < 4; k++) ctx.fillRect(x + 0.1, g.topY + 0.2 + k * 0.42, w - 0.2, 0.02);
  // tấm lót chuột
  fillRR(ctx, x + w / 2 + 0.6, g.topY + 1.22, 0.42, 0.36, 0.05, '#334155');
  // bàn phím
  const kb = g.keyboard;
  fillRR(ctx, kb.x + 0.02, kb.y + 0.04, kb.w, kb.h, 0.05, 'rgba(0,0,0,0.15)');
  fillRR(ctx, kb.x, kb.y, kb.w, kb.h, 0.05, '#e9ebef');
  ctx.fillStyle = '#c4c9d2';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) ctx.fillRect(kb.x + 0.06 + c * 0.1, kb.y + 0.05 + r * 0.07, 0.07, 0.045);
  ellipse(ctx, x + w / 2 + 0.82, g.topY + 1.42, 0.075, 0.1, '#f3f4f6');
  ellipse(ctx, x + w / 2 + 0.82, g.topY + 1.37, 0.03, 0.02, '#9ca3af');
  // đồ đạc
  mug(ctx, x + 0.45, g.topY + 1.22, MUG_COLORS[seed % MUG_COLORS.length]);
  paperStack(ctx, x + 0.14, g.topY + 0.48, 0.44, 0.34, -0.12 + (seed % 5) * 0.05);
  deskLamp(ctx, g.lamp.x, g.lamp.y + 0.12);
  if (seed % 3 !== 1) tinyPlant(ctx, x + w - 0.3, g.topY + 0.32, seed);
  // màn hình: chân đế + viền (nội dung vẽ động)
  const m = g.mon;
  ellipse(ctx, x + w / 2, m.y + m.h + 0.11, 0.3, 0.075, '#4b5563');
  ellipse(ctx, x + w / 2, m.y + m.h + 0.1, 0.26, 0.06, '#6b7280');
  rect(ctx, x + w / 2 - 0.06, m.y + m.h - 0.05, 0.12, 0.16, '#4b5563');
  fillRR(ctx, m.x + 0.03, m.y + 0.06, m.w, m.h, 0.06, 'rgba(0,0,0,0.25)');
  fillRR(ctx, m.x, m.y, m.w, m.h, 0.06, '#1f232b');
  rect(ctx, m.x + 0.04, m.y + 0.03, m.w - 0.08, 0.02, 'rgba(255,255,255,0.12)');
  circle(ctx, x + w / 2, m.y + m.h - 0.06, 0.018, '#9ca3af');
  // giấy note dán màn hình
  if (seed % 4 === 0) {
    ctx.save(); ctx.translate(m.x + m.w - 0.04, m.y + 0.12); ctx.rotate(0.15);
    rect(ctx, -0.08, -0.08, 0.16, 0.16, '#fde047'); ctx.restore();
  }
  if (seed % 5 === 2) {
    ctx.save(); ctx.translate(m.x + 0.06, m.y + m.h - 0.12); ctx.rotate(-0.2);
    rect(ctx, -0.07, -0.07, 0.14, 0.14, '#f9a8d4'); ctx.restore();
  }
}

function paintBossDesk(ctx, f) {
  const { x, y, w, h } = f;
  const g = bossDeskGeom(f);
  const fy = y + h - 0.45;
  // thân bàn gỗ óc chó
  fillRR(ctx, x + 0.02, fy - 0.04, w - 0.04, 0.49, [0, 0, 0.05, 0.05], '#4a2f1c');
  for (let k = 1; k < 6; k++) rect(ctx, x + (w * k) / 6, fy + 0.05, 0.02, 0.34, 'rgba(0,0,0,0.25)');
  rect(ctx, x + 0.05, fy + 0.03, w - 0.1, 0.025, '#c9a35f');
  // mặt bàn
  fillRR(ctx, x, g.topY, w, h, 0.1, '#6b4428');
  rect(ctx, x + 0.08, fy - 0.035, w - 0.16, 0.025, 'rgba(255,220,170,0.25)');
  ctx.fillStyle = 'rgba(255,220,170,0.06)';
  for (let k = 0; k < 5; k++) ctx.fillRect(x + 0.15, g.topY + 0.2 + k * 0.35, w - 0.3, 0.02);
  // tấm lót da trước ghế sếp
  fillRR(ctx, x + 1.2, g.topY + 0.18, 2.2, 1.0, 0.06, '#2f5d4a');
  strokeRR(ctx, x + 1.26, g.topY + 0.24, 2.08, 0.88, 0.05, 'rgba(255,230,180,0.35)', 0.02);
  paperStack(ctx, x + 1.6, g.topY + 0.42, 0.55, 0.42, 0.08);
  // bút ký
  line(ctx, x + 2.55, g.topY + 0.5, x + 2.95, g.topY + 0.75, '#111827', 0.04);
  line(ctx, x + 2.9, g.topY + 0.72, x + 2.97, g.topY + 0.76, '#d4a84b', 0.04);
  // đèn bàn xanh kiểu ngân hàng
  const l = g.lamp;
  ellipse(ctx, l.x, l.y + 0.36, 0.16, 0.06, '#b08a3e');
  rect(ctx, l.x - 0.02, l.y + 0.05, 0.04, 0.32, '#b08a3e');
  fillRR(ctx, l.x - 0.28, l.y - 0.08, 0.56, 0.18, [0.09, 0.09, 0.03, 0.03], '#1f6b4a');
  rect(ctx, l.x - 0.24, l.y - 0.05, 0.48, 0.03, 'rgba(255,255,255,0.3)');
  // bóng golf trên tee + cờ nhỏ
  rect(ctx, x + 4.1, g.topY + 1.18, 0.02, 0.1, '#f8fafc');
  circle(ctx, x + 4.11, g.topY + 1.15, 0.06, '#ffffff');
  line(ctx, x + 4.45, g.topY + 1.3, x + 4.45, g.topY + 0.92, '#9ca3af', 0.02);
  ctx.beginPath(); ctx.moveTo(x + 4.45, g.topY + 0.92); ctx.lineTo(x + 4.65, g.topY + 0.98); ctx.lineTo(x + 4.45, g.topY + 1.04); ctx.closePath();
  ctx.fillStyle = '#ef4444'; ctx.fill();
  mug(ctx, x + 0.7, g.topY + 1.3, '#ffffff');
  // màn hình quay về phía sếp (thấy mặt sau)
  const m = g.mon;
  rect(ctx, m.x + m.w / 2 - 0.06, m.y + m.h - 0.02, 0.12, 0.2, '#374151');
  ellipse(ctx, m.x + m.w / 2, m.y + m.h + 0.2, 0.26, 0.06, '#4b5563');
  fillRR(ctx, m.x, m.y, m.w, m.h, 0.07, '#9ca3af');
  fillRR(ctx, m.x + 0.08, m.y + 0.08, m.w - 0.16, m.h - 0.16, 0.05, '#b7bec8');
  circle(ctx, m.x + m.w / 2, m.y + m.h / 2, 0.08, '#e5e7eb');
  // biển tên GIÁM ĐỐC
  const px = x + w / 2 - 1.05, py = fy - 0.42;
  fillRR(ctx, px + 0.03, py + 0.05, 2.1, 0.34, 0.04, 'rgba(0,0,0,0.3)');
  fillRR(ctx, px, py, 2.1, 0.34, 0.04, '#3b2414');
  fillRR(ctx, px + 0.06, py + 0.05, 1.98, 0.24, 0.03, '#e3b85a');
  rect(ctx, px + 0.1, py + 0.07, 1.9, 0.03, 'rgba(255,255,255,0.4)');
  ctx.fillStyle = '#3b2414';
  ctx.font = `800 0.17px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GIÁM ĐỐC', px + 1.05, py + 0.175);
}

function paintPlant(ctx, f) {
  const cx = f.x + f.w / 2, by = f.y + f.h - 0.08;
  const v = hashStr(`${f.x},${f.y}`) % 4;
  // chậu
  const potW = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - potW / 2, by - 0.42); ctx.lineTo(cx + potW / 2, by - 0.42); ctx.lineTo(cx + potW * 0.38, by); ctx.lineTo(cx - potW * 0.38, by); ctx.closePath();
  ctx.fillStyle = v % 2 ? '#e9e4da' : '#cf7652';
  ctx.fill();
  rect(ctx, cx - potW / 2 - 0.03, by - 0.46, potW + 0.06, 0.08, v % 2 ? '#d6d0c4' : '#b9613f');
  rect(ctx, cx - potW * 0.3, by - 0.33, 0.05, 0.25, 'rgba(255,255,255,0.18)');
  ellipse(ctx, cx, by - 0.44, potW / 2 - 0.02, 0.05, '#5b4030');
  const top = by - 0.45;
  if (v === 0) {
    // lưỡi hổ
    for (let k = 0; k < 6; k++) {
      const lx = cx - 0.2 + k * 0.08, hgt = 0.7 + ((k * 7) % 5) * 0.12, lean = (k - 2.5) * 0.05;
      ctx.beginPath();
      ctx.moveTo(lx - 0.05, top); ctx.quadraticCurveTo(lx - 0.07 + lean, top - hgt * 0.6, lx + lean * 2, top - hgt);
      ctx.quadraticCurveTo(lx + 0.07 + lean, top - hgt * 0.6, lx + 0.05, top); ctx.closePath();
      ctx.fillStyle = k % 2 ? '#2f7d4a' : '#3d8f55';
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,200,90,0.75)';
      ctx.lineWidth = 0.015;
      ctx.stroke();
    }
  } else if (v === 1) {
    // trầu bà lá to
    const leaves = [[-0.32, -0.35, -0.6], [0.3, -0.38, 0.6], [-0.12, -0.7, -0.2], [0.16, -0.66, 0.25], [0, -0.95, 0], [-0.34, -0.72, -0.9], [0.34, -0.74, 0.9]];
    for (const [dx, dy, rot] of leaves) {
      ctx.save();
      ctx.translate(cx + dx, top + dy);
      ctx.rotate(rot);
      ellipse(ctx, 0, 0, 0.17, 0.25, '#3f8f4f');
      ellipse(ctx, 0.03, -0.02, 0.12, 0.19, '#4fa55e');
      line(ctx, 0, 0.22, 0, -0.2, 'rgba(30,80,40,0.5)', 0.015);
      ctx.restore();
    }
  } else if (v === 2) {
    // bụi tròn
    const pts = [[0, -0.45, 0.32], [-0.22, -0.3, 0.22], [0.22, -0.3, 0.22], [-0.12, -0.65, 0.22], [0.14, -0.66, 0.2]];
    for (const [dx, dy, r] of pts) circle(ctx, cx + dx, top + dy + 0.12, r, '#3b8a48');
    for (const [dx, dy, r] of pts) circle(ctx, cx + dx - 0.04, top + dy + 0.08, r * 0.7, '#4fa25a');
    for (let k = 0; k < 6; k++) circle(ctx, cx - 0.25 + hash2(k, 1, f.x) * 0.5, top - 0.6 + hash2(k, 2, f.y) * 0.5, 0.03, '#f9a8d4');
  } else {
    // bàng Singapore
    line(ctx, cx, top, cx + 0.02, top - 0.85, '#6b4a2e', 0.04);
    const ls = [[-0.2, -0.3], [0.2, -0.42], [-0.22, -0.6], [0.2, -0.72], [-0.05, -0.95], [0.12, -1.0]];
    for (const [dx, dy] of ls) {
      ellipse(ctx, cx + dx, top + dy, 0.17, 0.13, '#2f7a40');
      ellipse(ctx, cx + dx - 0.03, top + dy - 0.02, 0.11, 0.08, '#44994f');
    }
  }
}

function paintRack(ctx, f) {
  const g = rackGeom(f);
  for (const c of g.cabs) {
    const backY = c.frontBottom - 1.15;
    box(ctx, c.x, backY, c.w, 1.15, 1.6, '#3b4354', '#232a36', 0.04);
    rect(ctx, c.x + 0.05, c.frontTop + 0.05, c.w - 0.1, 1.48, '#1b212c');
    for (let k = 0; k < 6; k++) {
      const ly = c.frontTop + 0.18 + k * 0.2;
      fillRR(ctx, c.x + 0.1, ly, c.w - 0.2, 0.15, 0.02, '#2e3644');
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let j = 0; j < 6; j++) ctx.fillRect(c.x + c.w - 0.75 + j * 0.09, ly + 0.05, 0.05, 0.05);
    }
    ctx.save();
    rrPath(ctx, c.x + 0.05, c.frontTop + 0.05, c.w - 0.1, 1.48, 0.02);
    ctx.clip();
    ctx.fillStyle = 'rgba(160,200,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(c.x, c.frontTop + 1.5); ctx.lineTo(c.x + 0.3, c.frontTop + 1.5); ctx.lineTo(c.x + 1.1, c.frontTop); ctx.lineTo(c.x + 0.8, c.frontTop); ctx.closePath(); ctx.fill();
    ctx.restore();
    rect(ctx, c.x + c.w - 0.12, c.frontTop + 0.6, 0.04, 0.3, '#9ca3af');
  }
  if (f.label && g.cabs.length) {
    const mid = g.cabs[Math.floor(g.cabs.length / 2)];
    const lx = f.x + f.w / 2;
    fillRR(ctx, lx - 0.5, mid.frontTop - 0.36, 1.0, 0.24, 0.04, '#f8fafc');
    ctx.fillStyle = '#1f2937';
    ctx.font = `800 0.15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.label, lx, mid.frontTop - 0.235);
  }
}

function paintLockers(ctx, f) {
  const { x, y, w } = f;
  const backY = y + 0.4, H = 1.3, d = 0.56;
  box(ctx, x + 0.03, backY, w - 0.06, d, H, '#b5c4d4', '#90a5bb', 0.04);
  const n = Math.max(1, Math.round(w));
  const dw = (w - 0.06) / n;
  const ft = backY + d - H, fb = backY + d;
  for (let i = 0; i < n; i++) {
    const dx = x + 0.03 + i * dw;
    strokeRR(ctx, dx + 0.04, ft + 0.04, dw - 0.08, fb - ft - 0.08, 0.03, 'rgba(50,70,95,0.45)', 0.02);
    ctx.fillStyle = 'rgba(40,55,75,0.55)';
    for (let k = 0; k < 3; k++) ctx.fillRect(dx + 0.15, ft + 0.12 + k * 0.06, dw - 0.3, 0.025);
    fillRR(ctx, dx + dw / 2 - 0.12, ft + 0.36, 0.24, 0.12, 0.02, '#f1f5f9');
    ctx.fillStyle = '#334155';
    ctx.font = `700 0.08px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1).padStart(2, '0'), dx + dw / 2, ft + 0.42);
    rect(ctx, dx + dw - 0.16, ft + 0.6, 0.05, 0.16, '#e2e8f0');
    if (i === 1) circle(ctx, dx + dw / 2 - 0.08, ft + 0.85, 0.07, '#f472b6');
    if (i === 2) { ctx.save(); ctx.translate(dx + dw / 2, ft + 0.85); ctx.rotate(0.2); rect(ctx, -0.07, -0.07, 0.14, 0.14, '#fde047'); ctx.restore(); }
  }
}

function paintWhiteboard(ctx, f) {
  const g = whiteboardGeom(f);
  const { board: b, inner, side } = g;
  rect(ctx, b.x + 0.5, b.y + b.h, 0.05, f.y + f.h - 0.2 - (b.y + b.h), '#9ca3af');
  rect(ctx, b.x + b.w - 0.55, b.y + b.h, 0.05, f.y + f.h - 0.2 - (b.y + b.h), '#9ca3af');
  fillRR(ctx, b.x + 0.04, b.y + 0.07, b.w, b.h, 0.05, 'rgba(0,0,0,0.2)');
  fillRR(ctx, b.x, b.y, b.w, b.h, 0.05, '#c9ced6');
  rect(ctx, inner.x, inner.y, inner.w, inner.h, '#fbfcfd');
  // vệt lau bảng mờ mờ
  ctx.fillStyle = 'rgba(148,163,184,0.08)';
  for (let k = 0; k < 5; k++) ctx.fillRect(inner.x + 0.2 + k * 1.7, inner.y + 0.15 + (k % 2) * 0.3, 1.2, 0.45);
  ctx.save();
  ctx.beginPath(); ctx.rect(inner.x, inner.y, inner.w, inner.h); ctx.clip();
  // vùng bên phải: burndown + giấy note (tĩnh); vùng bên trái để office.js ghi dự án / tiến độ
  line(ctx, side.x - 0.12, inner.y + 0.12, side.x - 0.12, inner.y + inner.h - 0.12, 'rgba(37,99,235,0.35)', 0.025);
  const gx = side.x + 0.1, gy = side.y + 0.22, gw = side.w * 0.5, gh = side.h * 0.62;
  ctx.fillStyle = '#374151';
  ctx.font = `800 0.13px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('BURNDOWN', gx, side.y + 0.02);
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.stroke();
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 0.035;
  ctx.beginPath(); ctx.moveTo(gx, gy + gh * 0.1); ctx.lineTo(gx + gw * 0.3, gy + gh * 0.3); ctx.lineTo(gx + gw * 0.5, gy + gh * 0.28); ctx.lineTo(gx + gw * 0.75, gy + gh * 0.62); ctx.lineTo(gx + gw * 0.95, gy + gh * 0.7); ctx.stroke();
  ctx.setLineDash([0.05, 0.05]);
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(gx, gy + gh * 0.1); ctx.lineTo(gx + gw * 0.95, gy + gh * 0.95); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#dc2626';
  ctx.font = `800 0.12px ${FONT}`;
  ctx.fillText('DEADLINE!!!', gx + 0.05, gy + gh + 0.06);
  // giấy note
  const notes = ['#fde047', '#f9a8d4', '#86efac', '#93c5fd', '#fde047', '#fdba74'];
  const nx0 = side.x + side.w * 0.56, ny0 = side.y + 0.06;
  for (let i = 0; i < 6; i++) {
    const nx = nx0 + (i % 2) * 0.46, ny = ny0 + Math.floor(i / 2) * 0.42;
    ctx.save(); ctx.translate(nx, ny); ctx.rotate((hash2(i, 3, 5) - 0.5) * 0.25);
    rect(ctx, 0.02, 0.03, 0.38, 0.34, 'rgba(0,0,0,0.12)');
    rect(ctx, 0, 0, 0.38, 0.34, notes[i]);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0.05, 0.1, 0.26, 0.03); ctx.fillRect(0.05, 0.18, 0.18, 0.03);
    ctx.restore();
  }
  ctx.restore();
  // khay bút
  rect(ctx, b.x + 0.6, b.y + b.h - 0.02, b.w - 1.2, 0.08, '#aeb5bf');
  rect(ctx, b.x + 1.0, b.y + b.h - 0.05, 0.24, 0.045, '#dc2626');
  rect(ctx, b.x + 1.32, b.y + b.h - 0.05, 0.24, 0.045, '#2563eb');
  rect(ctx, b.x + 1.64, b.y + b.h - 0.05, 0.24, 0.045, '#111827');
  rect(ctx, b.x + 1.96, b.y + b.h - 0.05, 0.24, 0.045, '#16a34a');
}

function laptop(ctx, cx, cy, facingViewer) {
  if (facingViewer) {
    fillRR(ctx, cx - 0.25, cy - 0.06, 0.5, 0.14, 0.02, '#cbd5e1');
    fillRR(ctx, cx - 0.23, cy - 0.38, 0.46, 0.32, 0.03, '#334155');
    rect(ctx, cx - 0.2, cy - 0.35, 0.4, 0.26, '#60a5fa');
    rect(ctx, cx - 0.17, cy - 0.31, 0.2, 0.03, 'rgba(255,255,255,0.7)');
    rect(ctx, cx - 0.17, cy - 0.26, 0.28, 0.03, 'rgba(255,255,255,0.5)');
  } else {
    fillRR(ctx, cx - 0.23, cy - 0.32, 0.46, 0.3, 0.03, '#d1d5db');
    circle(ctx, cx, cy - 0.17, 0.04, '#f8fafc');
    fillRR(ctx, cx - 0.25, cy - 0.04, 0.5, 0.1, 0.02, '#9ca3af');
  }
}

function paintMeetingTable(ctx, f) {
  const { x, y, w, h } = f;
  const H = 0.38;
  fillRR(ctx, x + 0.1, y + h - H - 0.1, w - 0.2, H + 0.05, [0, 0, 0.5, 0.5], '#5c3f2a');
  rect(ctx, x + 1.2, y + h - 0.2, 0.12, 0.2, '#3b2a1c');
  rect(ctx, x + w - 1.32, y + h - 0.2, 0.12, 0.2, '#3b2a1c');
  fillRR(ctx, x + 0.08, y - H + 0.08, w - 0.16, h - 0.16, 0.7, '#8b6646');
  fillRR(ctx, x + 0.22, y - H + 0.2, w - 0.44, h - 0.4, 0.55, '#96704e');
  rect(ctx, x + 0.6, y + h - H - 0.12, w - 1.2, 0.025, 'rgba(255,230,190,0.35)');
  // đồ trên bàn
  for (let i = x + 1; i <= x + w - 2; i += 2) {
    if (hash2(i, 1, 3) < 0.6) laptop(ctx, i + 0.5, y - H + 0.55, false);
    else paperStack(ctx, i + 0.3, y - H + 0.3, 0.36, 0.28, 0.1);
    if (hash2(i, 2, 3) < 0.55) laptop(ctx, i + 0.5, y - H + h - 0.32, true);
    else mug(ctx, i + 0.5, y - H + h - 0.45, MUG_COLORS[(i * 3) % MUG_COLORS.length]);
  }
  // loa hội nghị
  const cx = x + w / 2, cy = y - H + h / 2;
  ctx.beginPath(); ctx.moveTo(cx, cy - 0.2); ctx.lineTo(cx + 0.24, cy + 0.14); ctx.lineTo(cx - 0.24, cy + 0.14); ctx.closePath();
  ctx.fillStyle = '#1f2937'; ctx.fill();
  circle(ctx, cx, cy + 0.02, 0.04, '#22c55e');
  // chai nước
  for (const dx of [-2.2, 2.4]) {
    fillRR(ctx, cx + dx - 0.05, cy - 0.15, 0.1, 0.26, 0.03, 'rgba(147,197,253,0.85)');
    rect(ctx, cx + dx - 0.035, cy - 0.2, 0.07, 0.05, '#2563eb');
  }
}

function paintShelf(ctx, f) {
  const { x, y, w } = f;
  const backY = y + 0.45, H = 1.45, d = 0.5;
  box(ctx, x + 0.05, backY, w - 0.1, d, H, '#7a5232', '#5e3d24', 0.03);
  const ft = backY + d - H;
  rect(ctx, x + 0.12, ft + 0.08, w - 0.24, H - 0.16, '#3e2817');
  const shelves = 3;
  const sh = (H - 0.16) / shelves;
  const bookColors = ['#b91c1c', '#1d4ed8', '#047857', '#b45309', '#6d28d9', '#be185d', '#0f766e', '#f8fafc'];
  for (let s = 0; s < shelves; s++) {
    const sy = ft + 0.08 + (s + 1) * sh;
    rect(ctx, x + 0.1, sy - 0.04, w - 0.2, 0.05, '#8a5c38');
    let bx = x + 0.16;
    let i = 0;
    while (bx < x + w - 0.25) {
      const bw = 0.07 + hash2(s, i, 7) * 0.06;
      const bh = sh * (0.55 + hash2(s, i, 8) * 0.35);
      if (s === 1 && i === 3) {
        // cúp golf
        rect(ctx, bx + 0.05, sy - 0.08, 0.2, 0.04, '#7c5a17');
        rect(ctx, bx + 0.12, sy - 0.18, 0.06, 0.1, '#d4a84b');
        ctx.beginPath(); ctx.moveTo(bx + 0.02, sy - 0.36); ctx.lineTo(bx + 0.28, sy - 0.36); ctx.lineTo(bx + 0.2, sy - 0.18); ctx.lineTo(bx + 0.1, sy - 0.18); ctx.closePath();
        ctx.fillStyle = '#e8bf5a'; ctx.fill();
        bx += 0.36;
      } else {
        rect(ctx, bx, sy - 0.04 - bh, bw, bh, bookColors[Math.floor(hash2(s, i, 9) * bookColors.length)]);
        rect(ctx, bx, sy - 0.04 - bh + 0.05, bw, 0.015, 'rgba(255,255,255,0.4)');
        bx += bw + 0.01;
      }
      i++;
    }
  }
}

function paintSofaV(ctx, f) {
  const { x, y, h } = f;
  const c = '#7b4a2e', cd = '#5e3720', cl = '#94603f';
  box(ctx, x + 0.08, y + 0.15, 0.62, h - 0.3, 0.32, cl, cd, 0.06);
  for (let k = 1; k < 3; k++) rect(ctx, x + 0.1, y + 0.15 - 0.32 + (k * (h - 0.3)) / 3, 0.58, 0.02, 'rgba(0,0,0,0.25)');
  box(ctx, x + 0.62, y + 0.05, 0.34, h - 0.1, 0.75, c, cd, 0.08);
  box(ctx, x + 0.05, y, 0.92, 0.3, 0.5, cl, cd, 0.08);
  box(ctx, x + 0.05, y + h - 0.32, 0.92, 0.3, 0.5, cl, cd, 0.08);
  circle(ctx, x + 0.8, y + 1.0 - 0.75, 0.03, 'rgba(0,0,0,0.35)');
  circle(ctx, x + 0.8, y + 2.0 - 0.75, 0.03, 'rgba(0,0,0,0.35)');
  circle(ctx, x + 0.8, y + 3.0 - 0.75, 0.03, 'rgba(0,0,0,0.35)');
}

function paintPrinter(ctx, f) {
  const { x, y, w } = f;
  box(ctx, x + 0.12, y + 0.18, w - 0.24, 0.72, 0.62, '#e5e7eb', '#c9ced6', 0.06);
  fillRR(ctx, x + 0.2, y + 0.18 - 0.62 + 0.06, w - 0.4, 0.3, 0.04, '#f3f4f6');
  rect(ctx, x + 0.4, y + 0.18 - 0.62 + 0.18, w - 0.8, 0.04, '#9ca3af');
  fillRR(ctx, x + w - 0.62, y + 0.18 - 0.62 + 0.42, 0.42, 0.18, 0.03, '#1f2937');
  rect(ctx, x + w - 0.58, y + 0.18 - 0.62 + 0.45, 0.26, 0.1, '#34d399');
  rect(ctx, x + 0.35, y + 0.9 - 0.45, w - 0.7, 0.08, '#9ca3af');
  rect(ctx, x + 0.4, y + 0.9 - 0.5, w - 0.8, 0.06, '#fafafa');
  rect(ctx, x + 0.25, y + 0.9 - 0.2, w - 0.5, 0.025, 'rgba(0,0,0,0.25)');
}

function paintPingpong(ctx, f) {
  const { x, y, w, h } = f;
  const H = 0.36;
  rect(ctx, x + 0.5, y + h - 0.3, 0.1, 0.3, '#1f2937');
  rect(ctx, x + w - 0.6, y + h - 0.3, 0.1, 0.3, '#1f2937');
  box(ctx, x + 0.1, y + 0.2, w - 0.2, h - 0.4, H, '#2563eb', '#1e3a8a', 0.04);
  const tx = x + 0.1, ty = y + 0.2 - H, tw = w - 0.2, th = h - 0.4;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 0.05;
  ctx.strokeRect(tx + 0.06, ty + 0.06, tw - 0.12, th - 0.12);
  line(ctx, tx + 0.06, ty + th / 2, tx + tw - 0.06, ty + th / 2, 'rgba(248,250,252,0.85)', 0.025);
  // lưới
  const nx = x + w / 2;
  rect(ctx, nx - 0.03, ty - 0.12, 0.06, th + 0.12, 'rgba(15,23,42,0.55)');
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let k = 0; k < th / 0.08; k++) ctx.fillRect(nx - 0.03, ty - 0.1 + k * 0.08, 0.06, 0.015);
  rect(ctx, nx - 0.04, ty - 0.14, 0.08, 0.03, '#f8fafc');
  rect(ctx, nx - 0.05, ty - 0.16, 0.1, 0.08, '#111827');
  rect(ctx, nx - 0.05, ty + th - 0.06, 0.1, 0.12, '#111827');
}

function paintCounter(ctx, f) {
  const { x, y, w, h } = f;
  const H = 0.45;
  fillRR(ctx, x + 0.02, y + h - H - 0.05, w - 0.04, H + 0.05, [0, 0, 0.04, 0.04], '#c4ae8f');
  rect(ctx, x + 0.1, y + h - H + 0.05, w - 0.2, 0.02, 'rgba(0,0,0,0.2)');
  fillRR(ctx, x + 0.02, y + 0.05 - H, w - 0.04, h - 0.05, 0.05, '#efece6');
  rect(ctx, x + 0.02, y + 0.05 - H, 0.08, h - 0.05, '#d9d4cb');
  ctx.fillStyle = 'rgba(160,150,135,0.12)';
  for (let k = 0; k < h * 2; k++) ctx.fillRect(x + 0.15 + hash2(k, 1, 4) * (w - 0.4), y - H + 0.1 + k * 0.5, 0.2, 0.02);
  const ty = y - H;
  // lò vi sóng
  if (h >= 4) {
    const my = ty + 2.4;
    box(ctx, x + 0.14, my + 0.1, w - 0.28, 0.8, 0.42, '#4b5563', '#374151', 0.04);
    rect(ctx, x + 0.22, my + 0.9 - 0.36, w - 0.7, 0.28, '#111827');
    rect(ctx, x + 0.26, my + 0.9 - 0.33, w - 0.78, 0.04, 'rgba(255,255,255,0.15)');
    rect(ctx, x + w - 0.42, my + 0.9 - 0.35, 0.22, 0.12, '#22c55e');
  }
  // bồn rửa
  if (h >= 7) {
    const sy = ty + 6.0;
    fillRR(ctx, x + 0.2, sy + 0.1, w - 0.4, 0.9, 0.1, '#cbd5e1');
    fillRR(ctx, x + 0.28, sy + 0.18, w - 0.56, 0.74, 0.08, '#94a3b8');
    rect(ctx, x + w - 0.3, sy + 0.45, 0.16, 0.05, '#cbd5e1');
    circle(ctx, x + w - 0.3, sy + 0.47, 0.05, '#e2e8f0');
  }
  // giá chén + rổ trái cây
  if (h >= 9) {
    const ry = ty + 9.15;
    fillRR(ctx, x + 0.2, ry, w - 0.4, 0.6, 0.06, '#e2e8f0');
    for (let k = 0; k < 4; k++) ellipse(ctx, x + 0.4 + k * 0.32, ry + 0.3, 0.12, 0.2, ['#fca5a5', '#93c5fd', '#fde68a', '#86efac'][k]);
  }
  ellipse(ctx, x + w / 2, ty + 0.55, 0.36, 0.2, '#b98a5a');
  for (const [dx, dy, c] of [[-0.12, -0.02, '#f97316'], [0.1, 0.0, '#84cc16'], [0, -0.1, '#ef4444'], [0.18, -0.08, '#facc15']]) circle(ctx, x + w / 2 + dx, ty + 0.5 + dy, 0.09, c);
}

function paintCoffeeMachine(ctx, f) {
  const { x, y } = f;
  const base = y - 0.45; // đặt trên mặt quầy
  box(ctx, x + 0.14, base + 0.18, 0.72, 0.62, 0.72, '#3a3d45', '#2a2c33', 0.06);
  const ft = base + 0.8 - 0.72;
  fillRR(ctx, x + 0.2, ft + 0.06, 0.6, 0.6, 0.04, '#c7ccd4');
  fillRR(ctx, x + 0.26, ft + 0.1, 0.48, 0.14, 0.03, '#0f172a');
  rect(ctx, x + 0.3, ft + 0.13, 0.2, 0.06, '#38bdf8');
  rect(ctx, x + 0.42, ft + 0.28, 0.16, 0.08, '#4b5563');
  fillRR(ctx, x + 0.4, ft + 0.42, 0.2, 0.16, [0, 0, 0.04, 0.04], '#fafafa');
  rect(ctx, x + 0.3, ft + 0.6, 0.4, 0.04, '#6b7280');
  circle(ctx, x + 0.28, ft + 0.32, 0.03, '#ef4444');
  // phễu hạt
  fillRR(ctx, x + 0.3, base + 0.18 - 0.72 - 0.14, 0.4, 0.2, 0.05, 'rgba(180,140,100,0.75)');
  ctx.fillStyle = '#5b3a1e';
  for (let k = 0; k < 6; k++) ctx.fillRect(x + 0.34 + k * 0.055, base + 0.18 - 0.72 - 0.04 + (k % 2) * 0.03, 0.035, 0.025);
}

function paintFridge(ctx, f) {
  const { x, y, w, h } = f;
  const H = 1.55;
  box(ctx, x + 0.08, y + 0.18, w - 0.16, h - 0.22, H, '#f8fafc', '#e5e9ee', 0.08);
  const ft = y + h - 0.04 - H, fb = y + h - 0.04;
  rect(ctx, x + w - 0.3, ft, 0.22, H, 'rgba(0,0,0,0.05)');
  rect(ctx, x + 0.1, ft + H * 0.36, w - 0.2, 0.025, 'rgba(100,116,139,0.45)');
  rect(ctx, x + 0.25, ft + 0.12, 0.05, H * 0.2, '#94a3b8');
  rect(ctx, x + 0.25, ft + H * 0.42, 0.05, H * 0.3, '#94a3b8');
  // nam châm, ảnh, giấy nhắn
  circle(ctx, x + 0.8, ft + 0.2, 0.05, '#ef4444');
  circle(ctx, x + 1.3, ft + 0.3, 0.05, '#22c55e');
  ctx.save(); ctx.translate(x + 1.0, ft + 0.78); ctx.rotate(-0.08);
  rect(ctx, -0.18, -0.13, 0.36, 0.26, '#ffffff');
  rect(ctx, -0.15, -0.1, 0.3, 0.17, '#7dd3fc');
  ellipse(ctx, -0.05, 0.02, 0.05, 0.06, '#fcd34d');
  ctx.restore();
  ctx.save(); ctx.translate(x + 1.45, ft + 1.05); ctx.rotate(0.12);
  rect(ctx, -0.13, -0.13, 0.26, 0.26, '#fde047');
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-0.09, -0.06, 0.18, 0.02); ctx.fillRect(-0.09, 0.0, 0.12, 0.02);
  ctx.restore();
  rect(ctx, x + 0.12, fb - 0.06, w - 0.24, 0.06, '#94a3b8');
}

function paintWater(ctx, f) {
  const { x, y } = f;
  box(ctx, x + 0.18, y + 0.22, 0.64, 0.62, 0.86, '#f8fafc', '#e2e8f0', 0.06);
  const ft = y + 0.84 - 0.86;
  rect(ctx, x + 0.3, ft + 0.22, 0.4, 0.26, '#cbd5e1');
  rect(ctx, x + 0.36, ft + 0.26, 0.08, 0.06, '#ef4444');
  rect(ctx, x + 0.56, ft + 0.26, 0.08, 0.06, '#3b82f6');
  rect(ctx, x + 0.32, ft + 0.44, 0.36, 0.04, '#94a3b8');
  // bình nước
  const by = y + 0.22 - 0.86;
  fillRR(ctx, x + 0.26, by - 0.62, 0.48, 0.66, 0.16, 'rgba(96,165,250,0.55)');
  fillRR(ctx, x + 0.29, by - 0.42, 0.42, 0.44, [0.02, 0.02, 0.14, 0.14], 'rgba(59,130,246,0.55)');
  rect(ctx, x + 0.33, by - 0.56, 0.06, 0.5, 'rgba(255,255,255,0.55)');
  rect(ctx, x + 0.42, by - 0.68, 0.16, 0.08, '#2563eb');
}

function paintSnackShelf(ctx, f) {
  const { x, y, w } = f;
  const backY = y + 0.45, H = 1.2, d = 0.5;
  box(ctx, x + 0.05, backY, w - 0.1, d, H, '#c99d6e', '#a67b50', 0.03);
  const ft = backY + d - H;
  rect(ctx, x + 0.12, ft + 0.06, w - 0.24, H - 0.12, '#7a5636');
  const rows = 3, rh = (H - 0.12) / rows;
  const bag = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#f97316'];
  for (let r = 0; r < rows; r++) {
    const sy = ft + 0.06 + (r + 1) * rh;
    rect(ctx, x + 0.1, sy - 0.035, w - 0.2, 0.045, '#d8b183');
    let bx = x + 0.16, i = 0;
    while (bx < x + w - 0.3) {
      const kind = Math.floor(hash2(r, i, 13) * 3);
      if (kind === 0) {
        const c = bag[Math.floor(hash2(r, i, 14) * bag.length)];
        fillRR(ctx, bx, sy - 0.04 - rh * 0.72, 0.2, rh * 0.68, 0.04, c);
        rect(ctx, bx + 0.04, sy - 0.04 - rh * 0.5, 0.12, 0.06, 'rgba(255,255,255,0.75)');
        bx += 0.23;
      } else if (kind === 1) {
        fillRR(ctx, bx, sy - 0.04 - rh * 0.6, 0.18, rh * 0.56, [0.02, 0.02, 0.05, 0.05], '#fafafa');
        rect(ctx, bx, sy - 0.04 - rh * 0.42, 0.18, 0.06, '#dc2626');
        bx += 0.21;
      } else {
        fillRR(ctx, bx, sy - 0.04 - rh * 0.7, 0.22, rh * 0.66, 0.06, 'rgba(219,234,254,0.8)');
        for (let k = 0; k < 4; k++) circle(ctx, bx + 0.06 + (k % 2) * 0.1, sy - 0.1 - rh * 0.15 * Math.floor(k / 2) - 0.02, 0.04, bag[(k + i) % bag.length]);
        bx += 0.25;
      }
      i++;
    }
  }
}

function paintTable(ctx, f) {
  const { x, y, w, h } = f;
  const H = 0.36;
  rect(ctx, x + 0.3, y + h - H, 0.12, H, '#7a5634');
  rect(ctx, x + w - 0.42, y + h - H, 0.12, H, '#7a5634');
  fillRR(ctx, x + 0.1, y + h - H - 0.12, w - 0.2, 0.14, [0, 0, 0.05, 0.05], '#a87f50');
  fillRR(ctx, x + 0.1, y - H + 0.08, w - 0.2, h - 0.2, 0.12, '#e3c18f');
  rect(ctx, x + 0.18, y + h - H - 0.13, w - 0.36, 0.025, 'rgba(255,255,255,0.4)');
  // khăn trải giữa
  rect(ctx, x + 0.35, y - H + h / 2 - 0.25, w - 0.7, 0.46, '#4f948f');
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let k = 0; k < (w - 0.7) / 0.2; k++) ctx.fillRect(x + 0.4 + k * 0.2, y - H + h / 2 - 0.25, 0.08, 0.46);
  const cx = x + w / 2, cy = y - H + h / 2;
  // bình hoa
  fillRR(ctx, cx - 0.09, cy - 0.12, 0.18, 0.24, 0.06, '#f8fafc');
  for (const [dx, dy, c] of [[-0.1, -0.24, '#f472b6'], [0.08, -0.28, '#facc15'], [0, -0.36, '#fb7185'], [0.14, -0.18, '#a78bfa']]) {
    line(ctx, cx, cy - 0.1, cx + dx, cy + dy, '#3f8a4a', 0.02);
    circle(ctx, cx + dx, cy + dy, 0.06, c);
  }
  // ấm trà + chén
  ellipse(ctx, cx - 1.2, cy + 0.02, 0.18, 0.14, '#e2e8f0');
  ellipse(ctx, cx - 1.2, cy - 0.08, 0.1, 0.05, '#cbd5e1');
  line(ctx, cx - 1.38, cy, cx - 1.5, cy - 0.1, '#e2e8f0', 0.04);
  for (const dx of [-0.85, -0.65]) ellipse(ctx, cx + dx, cy + 0.08, 0.06, 0.045, '#f1f5f9');
  // hộp khăn giấy
  fillRR(ctx, cx + 1.0, cy - 0.08, 0.3, 0.18, 0.03, '#fca5a5');
  ellipse(ctx, cx + 1.15, cy - 0.1, 0.06, 0.04, '#ffffff');
}

function paintTV(ctx, f) {
  const { x, y, w } = f;
  const g = tvGeom(f);
  box(ctx, x + 0.1, y + 0.35, w - 0.2, 0.6, 0.35, '#8a6446', '#6b4b33', 0.05);
  for (let k = 1; k < 4; k++) rect(ctx, x + 0.1 + ((w - 0.2) * k) / 4, y + 0.95 - 0.33, 0.02, 0.3, 'rgba(0,0,0,0.25)');
  circle(ctx, x + w / 2 - 0.15, y + 0.95 - 0.17, 0.03, '#d4a84b');
  circle(ctx, x + w / 2 + 0.15, y + 0.95 - 0.17, 0.03, '#d4a84b');
  // chân TV + loa
  rect(ctx, x + w / 2 - 0.08, g.frame.y + g.frame.h - 0.02, 0.16, 0.12, '#1f2937');
  fillRR(ctx, x + w / 2 - 0.45, y - 0.08, 0.9, 0.08, 0.03, '#111827');
  fillRR(ctx, g.frame.x + 0.03, g.frame.y + 0.06, g.frame.w, g.frame.h, 0.05, 'rgba(0,0,0,0.25)');
  fillRR(ctx, g.frame.x, g.frame.y, g.frame.w, g.frame.h, 0.05, '#14161b');
  rect(ctx, g.frame.x + 0.05, g.frame.y + 0.03, g.frame.w - 0.1, 0.02, 'rgba(255,255,255,0.12)');
  tinyPlant(ctx, x + 0.4, y + 0.35 - 0.35 + 0.25, 2);
  // loa nhỏ
  fillRR(ctx, x + w - 0.55, y - 0.2, 0.22, 0.34, 0.04, '#1f2937');
  circle(ctx, x + w - 0.44, y - 0.04, 0.06, '#4b5563');
}

function paintCoffeeTable(ctx, f) {
  const { x, y, w, h } = f;
  const H = 0.24;
  rect(ctx, x + 0.2, y + h - H, 0.08, H, '#6b4b33');
  rect(ctx, x + w - 0.28, y + h - H, 0.08, H, '#6b4b33');
  fillRR(ctx, x + 0.1, y + h - H - 0.08, w - 0.2, 0.1, [0, 0, 0.04, 0.04], '#8a6446');
  fillRR(ctx, x + 0.1, y - H + 0.1, w - 0.2, h - 0.18, 0.1, '#a87b55');
  ctx.save(); ctx.translate(x + 0.6, y - H + 0.42); ctx.rotate(-0.15);
  rect(ctx, -0.22, -0.15, 0.44, 0.3, '#f472b6'); rect(ctx, -0.18, -0.1, 0.2, 0.06, '#ffffff'); ctx.restore();
  ctx.save(); ctx.translate(x + 0.9, y - H + 0.5); ctx.rotate(0.2);
  rect(ctx, -0.2, -0.14, 0.4, 0.28, '#60a5fa'); rect(ctx, -0.16, -0.1, 0.24, 0.05, '#ffffff'); ctx.restore();
  ellipse(ctx, x + w - 0.75, y - H + 0.45, 0.24, 0.13, '#f1f5f9');
  for (const [dx, dy, c] of [[-0.08, -0.02, '#f97316'], [0.08, 0.0, '#84cc16'], [0, -0.07, '#facc15']]) circle(ctx, x + w - 0.75 + dx, y - H + 0.42 + dy, 0.07, c);
  rect(ctx, x + 1.5, y - H + 0.4, 0.22, 0.07, '#1f2937');
  mug(ctx, x + 1.95, y - H + 0.48, '#ffffff');
}

function paintSofa(ctx, f) {
  const { x, y, w } = f;
  const c = '#3d8c86', cd = '#2c6a65', cl = '#4aa39c';
  box(ctx, x + 0.3, y + 0.15, w - 0.6, 1.4, 0.3, cl, cd, 0.08);
  const n = 3, cw = (w - 0.6) / n;
  for (let i = 0; i < n; i++) {
    fillRR(ctx, x + 0.34 + i * cw, y + 0.15 - 0.3 + 0.04, cw - 0.08, 1.0, 0.1, c);
    rect(ctx, x + 0.4 + i * cw, y + 0.15 - 0.3 + 0.08, cw - 0.2, 0.03, 'rgba(255,255,255,0.18)');
  }
  // gối tựa
  for (const [dx, col] of [[0.9, '#f59e0b'], [w - 1.5, '#fb7185']]) {
    ctx.save(); ctx.translate(x + dx + 0.3, y + 0.82); ctx.rotate(dx < 2 ? -0.2 : 0.2);
    fillRR(ctx, -0.3, -0.22, 0.6, 0.44, 0.12, col);
    fillRR(ctx, -0.25, -0.18, 0.5, 0.1, 0.05, 'rgba(255,255,255,0.25)');
    ctx.restore();
  }
  box(ctx, x + 0.02, y + 0.05, 0.38, 1.9, 0.55, cl, cd, 0.12);
  box(ctx, x + w - 0.4, y + 0.05, 0.38, 1.9, 0.55, cl, cd, 0.12);
}

function paintSofaBack(ctx, f) {
  const { x, y, w } = f;
  box(ctx, x + 0.3, y + 0.42, w - 0.6, 0.5, 0.78, '#3a857f', '#2b6662', 0.1);
  const ft = y + 0.92 - 0.78;
  for (let i = 1; i < 6; i++) circle(ctx, x + 0.3 + ((w - 0.6) * i) / 6, ft + 0.32, 0.035, 'rgba(0,0,0,0.3)');
  rect(ctx, x + 0.4, y + 0.42 - 0.78 + 0.05, w - 0.8, 0.03, 'rgba(255,255,255,0.18)');
  rect(ctx, x + 0.6, y + 0.92 - 0.04, 0.08, 0.06, '#3b2a1c');
  rect(ctx, x + w - 0.68, y + 0.92 - 0.04, 0.08, 0.06, '#3b2a1c');
}

function paintBeanbag(ctx, f) {
  const cx = f.x + 0.5, cy = f.y + 0.55;
  const col = (f.x % 2 === 0) ? '#f472b6' : '#60a5fa';
  ellipse(ctx, cx, cy + 0.08, 0.48, 0.3, shade(col, -0.25));
  ellipse(ctx, cx, cy - 0.02, 0.46, 0.34, col);
  ellipse(ctx, cx - 0.1, cy - 0.12, 0.22, 0.12, shade(col, 0.3));
  ctx.beginPath(); ctx.arc(cx + 0.05, cy + 0.02, 0.2, 0.3, 2.6); ctx.strokeStyle = shade(col, -0.2); ctx.lineWidth = 0.025; ctx.stroke();
}

function paintKpiBoard(ctx, f) {
  const g = kpiGeom(f);
  const { panel: p, title, chart: c, revenue: rv } = g;
  // chân + đế
  for (const lx of [p.x + 1.2, p.x + p.w - 1.2]) {
    rect(ctx, lx - 0.05, p.y + p.h, 0.1, f.y + f.h - 0.14 - (p.y + p.h), '#4b5563');
    fillRR(ctx, lx - 0.4, f.y + f.h - 0.2, 0.8, 0.12, 0.05, '#374151');
  }
  fillRR(ctx, p.x + 0.06, p.y + 0.1, p.w, p.h, 0.1, 'rgba(0,0,0,0.22)');
  fillRR(ctx, p.x, p.y, p.w, p.h, 0.1, '#2f3542');
  fillRR(ctx, p.x + 0.08, p.y + 0.08, p.w - 0.16, p.h - 0.16, 0.06, '#fffdf8');
  // tiêu đề
  fillRR(ctx, title.x, title.y, title.w, title.h, [0.06, 0.06, 0, 0], '#ef4444');
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 0.3px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${f.label || 'BẢNG KPI'} HÔM NAY`, title.x + 0.22, title.y + title.h / 2 + 0.01);
  ctx.textAlign = 'right';
  ctx.font = `700 0.18px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('mục tiêu 100%', title.x + title.w - 0.22, title.y + title.h / 2 + 0.01);
  // lưới + vạch 100% / 70%
  line(ctx, c.x, g.base, c.x + c.w, g.base, '#9ca3af', 0.03);
  ctx.setLineDash([0.1, 0.07]);
  line(ctx, c.x, g.base - g.full, c.x + c.w, g.base - g.full, 'rgba(34,197,94,0.8)', 0.03);
  line(ctx, c.x, g.base - g.full * 0.7, c.x + c.w, g.base - g.full * 0.7, 'rgba(245,158,11,0.6)', 0.025);
  ctx.setLineDash([]);
  ctx.font = `800 0.15px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#16a34a';
  ctx.fillText('100%', c.x - 0.06, g.base - g.full);
  ctx.fillStyle = '#d97706';
  ctx.fillText('70%', c.x - 0.06, g.base - g.full * 0.7);
  // khung dòng doanh thu
  fillRR(ctx, rv.x, rv.y, rv.w, rv.h, 0.08, '#fff1e8');
  // nam châm góc
  for (const [dx, dy] of [[0.2, 0.2], [p.w - 0.2, 0.2], [0.2, p.h - 0.2], [p.w - 0.2, p.h - 0.2]]) circle(ctx, p.x + dx, p.y + dy, 0.05, '#9ca3af');
}

function paintToilet(ctx, f) {
  const { x, y } = f;
  box(ctx, x + 0.2, y + 0.04, 0.6, 0.26, 0.55, '#ffffff', '#e5e7eb', 0.06);
  rect(ctx, x + 0.42, y + 0.04 - 0.55 + 0.06, 0.16, 0.04, '#cbd5e1');
  ellipse(ctx, x + 0.5, y + 0.62, 0.3, 0.3, '#f1f5f9');
  ellipse(ctx, x + 0.5, y + 0.6, 0.27, 0.27, '#ffffff');
  ellipse(ctx, x + 0.5, y + 0.62, 0.17, 0.18, '#bfe3f0');
  ellipse(ctx, x + 0.5, y + 0.62, 0.17, 0.18, 'rgba(255,255,255,0.0)');
  ctx.beginPath(); ctx.ellipse(x + 0.5, y + 0.6, 0.27, 0.27, 0, 0, Math.PI * 2); ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.02; ctx.stroke();
  circle(ctx, x + 0.92, y + 0.25, 0.09, '#ffffff');
  circle(ctx, x + 0.92, y + 0.25, 0.03, '#d1d5db');
}

function paintSink(ctx, f) {
  const { x, y, h } = f;
  box(ctx, x + 0.1, y + 0.05, 0.82, h - 0.1, 0.45, '#f1f5f9', '#cbd5e1', 0.06);
  const ty = y + 0.05 - 0.45;
  for (let k = 0; k < Math.max(1, Math.floor(h)); k++) {
    ellipse(ctx, x + 0.48, ty + 0.45 + k, 0.24, 0.3, '#e2e8f0');
    ellipse(ctx, x + 0.48, ty + 0.47 + k, 0.18, 0.23, '#cbd5e1');
    rect(ctx, x + 0.78, ty + 0.42 + k, 0.12, 0.05, '#94a3b8');
  }
  fillRR(ctx, x + 0.75, ty + 0.9, 0.12, 0.2, 0.03, '#a7f3d0');
  // gương trên tường
  fillRR(ctx, x + 0.92, y - 0.3, 0.1, h + 0.1, 0.03, '#bfdbfe');
  rect(ctx, x + 0.95, y - 0.25, 0.03, h, 'rgba(255,255,255,0.8)');
}

// ------------------------------------------------------------------ phòng trưng bày
const SHELF_THEME = {
  shelf_beauty: { wood: '#f3dfe6', woodD: '#d9b4c2', back: '#fff4f8', head: '#f472b6', headText: '#ffffff', glow: 'rgba(251,207,232,0.55)', icon: '💄' },
  shelf_tech: { wood: '#dbe7f6', woodD: '#aec6e8', back: '#f2f7ff', head: '#2563eb', headText: '#ffffff', glow: 'rgba(191,219,254,0.6)', icon: '🔌' },
};

function paintShelfUnit(ctx, f) {
  const th = SHELF_THEME[f.type] || SHELF_THEME.shelf_tech;
  const g = shelfGeom(f);
  const u = g.unit;
  // tủ: thân + bóng
  fillRR(ctx, u.x + 0.04, u.y + 0.08, u.w, u.h, 0.08, 'rgba(0,0,0,0.18)');
  fillRR(ctx, u.x, u.y, u.w, u.h, 0.08, th.wood);
  // tấm lưng sáng (đèn hắt từ trên xuống) phía sau cả 2 tầng
  const backTop = g.header.y + g.header.h + 0.04;
  const backBot = g.tiers[1];
  fillRR(ctx, u.x + 0.07, backTop, u.w - 0.14, backBot - backTop, 0.05, th.back);
  const grad = ctx.createLinearGradient(0, backTop, 0, backBot);
  grad.addColorStop(0, th.glow); grad.addColorStop(1, 'rgba(255,255,255,0)');
  fillRR(ctx, u.x + 0.07, backTop, u.w - 0.14, backBot - backTop, 0.05, grad);
  rect(ctx, u.x + 0.14, backTop + 0.01, u.w - 0.28, 0.03, 'rgba(255,255,255,0.95)');
  // bảng tên kệ (co chữ cho vừa: "LÀM ĐẸP & THỜI TRANG")
  fillRR(ctx, g.header.x, g.header.y, g.header.w, g.header.h, 0.07, th.head);
  rect(ctx, g.header.x + 0.07, g.header.y + 0.03, g.header.w - 0.14, 0.022, 'rgba(255,255,255,0.35)');
  // biểu tượng vẽ riêng (emoji trong chuỗi cỡ 0,2 bị Chrome vẽ lệch đè lên chữ đầu)
  const hcx = g.header.x + g.header.w / 2, hcy = g.header.y + g.header.h / 2 + 0.01;
  const isz = th.icon ? 0.2 : 0, gap = th.icon ? 0.06 : 0, shift = (isz + gap) / 2;
  const tw = fitText(ctx, f.label || '', hcx + shift, hcy, g.header.w - 0.24 - isz - gap, 0.2, 800, th.headText);
  if (th.icon) drawEmoji(ctx, th.icon, hcx + shift - tw / 2 - gap - isz / 2, hcy - 0.005, isz);
  // 2 tấm kệ: mặt trên + mép trước + bóng; vách ngăn mờ giữa các ô
  for (const ty of g.tiers) {
    rect(ctx, u.x + 0.04, ty - 0.05, u.w - 0.08, 0.07, th.woodD);
    rect(ctx, u.x + 0.04, ty + 0.02, u.w - 0.08, 0.035, 'rgba(0,0,0,0.14)');
  }
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let k = 1; k < g.perTier; k++) {
    const vx = f.x + 0.08 + g.pitch * k - 0.006;
    ctx.fillRect(vx, backTop + 0.06, 0.012, g.tiers[0] - backTop - 0.12);
    ctx.fillRect(vx, g.tiers[0] + 0.1, 0.012, g.tiers[1] - g.tiers[0] - 0.16);
  }
  // tủ dưới có ngăn kéo
  const cabY = g.tiers[1] + 0.07;
  rect(ctx, u.x + 0.04, cabY, u.w - 0.08, u.y + u.h - cabY - 0.04, th.woodD);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  const drawers = 4;
  const dw = (u.w - 0.08) / drawers;
  for (let k = 1; k < drawers; k++) ctx.fillRect(u.x + 0.04 + dw * k - 0.01, cabY + 0.03, 0.02, u.y + u.h - cabY - 0.1);
  for (let k = 0; k < drawers; k++) fillRR(ctx, u.x + 0.04 + dw * (k + 0.5) - 0.12, cabY + (u.y + u.h - cabY) / 2 - 0.03, 0.24, 0.05, 0.02, 'rgba(255,255,255,0.7)');
}

function paintDisplayTable(ctx, f) {
  const g = podiumGeom(f);
  const { cx, baseY, topY, rx } = g;
  // vòng sáng dưới sàn (đèn rọi)
  ellipse(ctx, cx, baseY + 0.05, rx + 0.7, 0.36, 'rgba(255,250,235,0.55)');
  // bệ trụ tròn
  ellipse(ctx, cx + 0.03, baseY + 0.06, rx + 0.02, rx * 0.4, 'rgba(0,0,0,0.2)');
  rect(ctx, cx - rx, topY, rx * 2, baseY - topY, '#f3f1ec');
  rect(ctx, cx - rx, topY, rx * 0.35, baseY - topY, 'rgba(255,255,255,0.5)');
  rect(ctx, cx + rx * 0.55, topY, rx * 0.45, baseY - topY, 'rgba(0,0,0,0.08)');
  ellipse(ctx, cx, baseY, rx, rx * 0.4, '#e8e4dc');
  ellipse(ctx, cx, topY, rx, rx * 0.4, '#faf9f6');
  ctx.beginPath(); ctx.ellipse(cx, topY, rx, rx * 0.4, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.02; ctx.stroke();
  // biển nhỏ "MỚI VỀ"
  fillRR(ctx, cx + rx * 0.3, topY - 0.02, 0.34, 0.14, 0.03, '#ff7a45');
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 0.09px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MỚI VỀ', cx + rx * 0.3 + 0.17, topY + 0.05);
}

function paintGeneric(ctx, f) {
  box(ctx, f.x + 0.1, f.y + 0.1, f.w - 0.2, f.h - 0.2, 0.5, '#d6c7b0', '#b8a68a', 0.08);
  if (f.label) {
    ctx.fillStyle = '#3f3a33';
    ctx.font = `700 0.2px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.label, f.x + f.w / 2, f.y + f.h / 2 - 0.4);
  }
}

// ------------------------------------------------------------------ registry
const H_DEFAULT = 1.0;
const SPECS = {
  desk: { paint: paintDesk, top: 1.4 },
  boss_desk: { paint: paintBossDesk, top: 1.1 },
  plant: { paint: paintPlant, top: 1.4, key: (f) => f.y + 0.5 },
  rack: { paint: paintRack, top: 1.0 },
  lockers: { paint: paintLockers, top: 1.0 },
  whiteboard: { paint: paintWhiteboard, top: 1.0 },
  meeting_table: { paint: paintMeetingTable, top: 0.6 },
  shelf: { paint: paintShelf, top: 1.1 },
  sofa_v: { paint: paintSofaV, top: 0.9 },
  printer: { paint: paintPrinter, top: 0.7 },
  pingpong: { paint: paintPingpong, top: 0.6 },
  counter: { paint: paintCounter, top: 0.6, key: (f) => f.y - 0.6 },
  coffee_machine: { paint: paintCoffeeMachine, top: 1.5, key: (f) => f.y + f.h - 0.45 },
  fridge: { paint: paintFridge, top: 1.5 },
  water: { paint: paintWater, top: 1.8, key: (f) => f.y + f.h - 0.45 },
  snack_shelf: { paint: paintSnackShelf, top: 1.0 },
  table: { paint: paintTable, top: 0.7 },
  tv: { paint: paintTV, top: 1.3 },
  coffee_table: { paint: paintCoffeeTable, top: 0.5 },
  sofa: { paint: paintSofa, top: 0.6, key: (f) => f.y + 0.12 },
  sofa_back: { paint: paintSofaBack, top: 0.6, key: (f) => f.y + f.h - 0.45 },
  beanbag: { paint: paintBeanbag, top: 0.3, key: (f) => f.y + 0.15 },
  kpi_board: { paint: paintKpiBoard, top: 2.2, padX: 1.2 },
  toilet: { paint: paintToilet, top: 0.7 },
  sink: { paint: paintSink, top: 0.7 },
  shelf_beauty: { paint: paintShelfUnit, top: 1.0, key: (f) => f.y + f.h - 0.5 },
  shelf_tech: { paint: paintShelfUnit, top: 1.0, key: (f) => f.y + f.h - 0.5 },
  display_table: { paint: paintDisplayTable, top: 1.5, padX: 0.6 },
};
const FLAT = new Set(['door_mat']);

/** tạo sprite cho mọi món nội thất ở tỉ lệ T (px CSS / ô) và dpr */
export function buildSprites(world, T, dpr) {
  const s = T * dpr;
  const snap = (v, up) => (up ? Math.ceil(v * s) : Math.floor(v * s)) / s;
  const out = [];
  for (const f of world.furniture) {
    if (FLAT.has(f.type)) continue;
    const spec = SPECS[f.type] || { paint: paintGeneric, top: H_DEFAULT };
    const padX = 0.3 + (spec.padX || 0);
    const x0 = snap(f.x - padX, false), x1 = snap(f.x + f.w + padX, true);
    const y0 = snap(f.y - (spec.top ?? H_DEFAULT) - 0.35, false), y1 = snap(f.y + f.h + 0.3, true);
    const cv = makeCanvas((x1 - x0) * s, (y1 - y0) * s);
    const ctx = cv.getContext('2d');
    ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    try {
      spec.paint(ctx, f);
    } catch (e) {
      console.warn('[văn phòng] lỗi vẽ nội thất', f.type, e);
    }
    out.push({
      kind: 'furn', f, canvas: cv, x0, y0, w: x1 - x0, h: y1 - y0,
      key: spec.key ? spec.key(f) : f.y + f.h - 0.5,
    });
  }
  return out;
}

// ------------------------------------------------------------------ ghế (vẽ động mỗi khung hình)
const CHAIR = {
  desk: { seat: '#374151', back: '#1f2937', light: '#4b5563' },
  boss: { seat: '#2a2b33', back: '#202128', light: '#3f414d' },
  office: { seat: '#4b5563', back: '#374151', light: '#6b7280' },
  wood: { seat: '#c08a55', back: '#a0703f', light: '#d9a46b' },
};

/** phần mặt ghế + chân (vẽ trước người ngồi) */
export function drawChairBase(ctx, cx, cy, style, facing) {
  const c = CHAIR[style] || CHAIR.office;
  if (style === 'desk' || style === 'boss' || style === 'office') {
    // chân sao + bánh xe
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      ctx.moveTo(cx, cy + 0.08);
      ctx.lineTo(cx + Math.cos(a) * 0.26, cy + 0.08 + Math.sin(a) * 0.1);
    }
    ctx.stroke();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      circle(ctx, cx + Math.cos(a) * 0.26, cy + 0.1 + Math.sin(a) * 0.1, 0.03, '#111827');
    }
    rect(ctx, cx - 0.025, cy - 0.14, 0.05, 0.22, '#4b5563');
  } else {
    for (const [dx, dy] of [[-0.2, 0.05], [0.2, 0.05], [-0.17, -0.12], [0.17, -0.12]]) rect(ctx, cx + dx - 0.02, cy + dy - 0.04, 0.04, 0.16, c.back);
  }
  const sw = style === 'boss' ? 0.6 : 0.5;
  fillRR(ctx, cx - sw / 2, cy - 0.3, sw, 0.3, 0.08, c.seat);
  fillRR(ctx, cx - sw / 2 + 0.04, cy - 0.29, sw - 0.08, 0.08, 0.04, c.light);
  if (facing === 'down' || facing === 'left' || facing === 'right') drawChairBack(ctx, cx, cy, style, facing, true);
}

/** tựa ghế: phía sau người ngồi. behind=true khi tựa nằm phía sau (vẽ trước người) */
export function drawChairBack(ctx, cx, cy, style, facing, behind) {
  const c = CHAIR[style] || CHAIR.office;
  const tall = style === 'boss' ? 1.45 : style === 'wood' ? 0.5 : 0.62;
  const bw = style === 'boss' ? 1.12 : 0.52;
  if (facing === 'down' && behind && style === 'boss') {
    // ghế giám đốc lưng cao bọc da đen, nhô cao hơn đầu
    rrPath(ctx, cx - bw / 2, cy - 0.3 - tall, bw, tall + 0.05, 0.2);
    ctx.fillStyle = c.back;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 0.035;
    ctx.stroke();
    fillRR(ctx, cx - bw / 2 + 0.08, cy - 0.24 - tall, bw - 0.16, tall - 0.2, 0.16, c.light);
    fillRR(ctx, cx - bw / 2 + 0.14, cy - 0.2 - tall, bw - 0.28, 0.08, 0.04, 'rgba(255,255,255,0.18)');
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(cx - 0.2 + k * 0.2, cy - 0.3 - tall + 0.32, 0.025, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
    }
    return;
  }
  if (facing === 'up' && !behind) {
    // tựa ở phía nam (gần người xem), che phần dưới lưng. Màu sáng hơn quần + viền + nan lưới
    // để nhìn ra là tựa ghế chứ không nhầm thành chân người đang đứng.
    const y0 = cy - 0.12 - tall * 0.55, h = tall * 0.62;
    fillRR(ctx, cx - bw / 2, y0, bw, h, 0.1, c.back);
    fillRR(ctx, cx - bw / 2 + 0.035, y0 + 0.035, bw - 0.07, h - 0.07, 0.08, c.light);
    fillRR(ctx, cx - bw / 2 + 0.07, y0 + 0.065, bw - 0.14, 0.05, 0.025, 'rgba(255,255,255,0.26)');
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    for (let k = 1; k <= 2; k++) { const yy = y0 + 0.12 + (h - 0.16) * (k / 3); ctx.moveTo(cx - bw / 2 + 0.07, yy); ctx.lineTo(cx + bw / 2 - 0.07, yy); }
    ctx.stroke();
    rect(ctx, cx - 0.03, cy - 0.12, 0.06, 0.1, '#2b2f36');
  } else if (facing === 'down' && behind) {
    fillRR(ctx, cx - bw / 2, cy - 0.3 - tall, bw, tall + 0.05, 0.12, c.back);
    fillRR(ctx, cx - bw / 2 + 0.06, cy - 0.26 - tall, bw - 0.12, 0.08, 0.04, c.light);
  } else if ((facing === 'left' || facing === 'right') && behind) {
    const dx = facing === 'left' ? 0.2 : -0.2;
    fillRR(ctx, cx + dx - 0.08, cy - 0.28 - tall, 0.16, tall + 0.02, 0.06, c.back);
  }
}

// ------------------------------------------------------------------ overlays động
/** hơi nóng bốc lên từ máy pha cà phê */
export function steam(ctx, x, y, t, strength = 1) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const ph = ((t / 1600 + k / 3) % 1);
    const yy = y - ph * 0.55;
    const a = Math.sin(ph * Math.PI) * 0.45 * strength;
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.lineWidth = 0.05 * (1 - ph * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + (k - 1) * 0.08, yy + 0.12);
    ctx.quadraticCurveTo(x + (k - 1) * 0.08 + Math.sin(t / 300 + k) * 0.08, yy, x + (k - 1) * 0.08, yy - 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

