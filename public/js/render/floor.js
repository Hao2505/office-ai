// Layer tĩnh: sàn theo loại phòng, tường (mặt trước + mép trên), tường kính, cửa, cửa sổ,
// thảm, bóng đổ của nội thất, nhãn phòng. Vẽ 1 lần vào canvas offscreen (vẽ lại khi đổi tỉ lệ).
import { hash2 } from '../util.js';
import {
  rrPath, fillRR, rect, ellipse, circle, line, softShadow, softEllipseShadow, vGrad, makeCanvas, FONT, alpha, drawEmoji,
} from './draw.js';
import { ROOM_ICONS } from '../labels.js';

export const MARGIN = 1; // ô viền quanh bản đồ (bóng toà nhà, mặt tiền)
export const CAP = 0.2; // độ dày mép trên tường (mặt cắt)
const STRIP = 0.34; // bề rộng tường dọc nhìn từ trên

const WOOD = {
  work: { base: '#e0c299', tones: ['#e5c9a1', '#dcbd92', '#e8cfab', '#d8b78b', '#e2c59b'], seam: 'rgba(110,70,35,0.24)', grain: 'rgba(125,85,45,0.10)', plank: 0.5, len: [2.2, 3.6], vertical: false },
  hall: { base: '#ead3ab', tones: ['#eed9b4', '#e6cda2', '#f1ddba', '#e2c798'], seam: 'rgba(110,70,35,0.2)', grain: 'rgba(125,85,45,0.09)', plank: 0.5, len: [2.0, 3.2], vertical: true },
  boss: { base: '#6a4832', tones: ['#714d36', '#654430', '#7a553b', '#5f402c', '#6d4a33'], seam: 'rgba(25,15,8,0.4)', grain: 'rgba(255,220,180,0.06)', plank: 0.66, len: [2.6, 4.2], vertical: false },
};

const WALL_PAINT = {
  work: ['#f4ece0', '#e6d9c7'],
  toilet: ['#e4f1f3', '#cfe2e6'],
  wc: ['#e4f1f3', '#cfe2e6'],
  showroom: ['#fff7f1', '#f6e6da'],
  server: ['#596476', '#465062'],
  meeting: ['#eef2f5', '#dde4ea'],
  boss: ['#3f5f55', '#2f4a41'],
  hall: ['#f6ecdc', '#e8d8bf'],
  pantry: ['#f8e8cd', '#ecd6b2'],
  lounge: ['#f4e5d1', '#e6d2b8'],
};
const CAP_COLOR = '#fbf8f3';
const CAP_EDGE = 'rgba(105,85,65,0.38)';
const OUTER_CAP = '#d8c8b2';
const OUTER_EDGE = 'rgba(90,70,50,0.45)';

function clip(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
}

// ------------------------------------------------------------------ sàn
function paintWood(ctx, x0, y0, x1, y1, pal, seed) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  rect(ctx, x0, y0, x1 - x0, y1 - y0, pal.base);
  const ph = pal.plank;
  const V = pal.vertical;
  const a0 = V ? x0 : y0, a1 = V ? x1 : y1; // trục ngang qua các hàng ván
  const b0 = V ? y0 : x0, b1 = V ? y1 : x1; // trục dọc theo ván
  const R = (a, b, la, lb) => (V ? ctx.fillRect(a, b, la, lb) : ctx.fillRect(b, a, lb, la));
  for (let r = Math.floor(a0 / ph); r * ph < a1; r++) {
    const a = r * ph;
    const L = pal.len[0] + hash2(r, 3, seed) * (pal.len[1] - pal.len[0]);
    const off = hash2(r, 5, seed) * L;
    for (let i = Math.floor((b0 - off) / L) - 1; off + i * L < b1; i++) {
      const b = off + i * L;
      const tone = pal.tones[Math.floor(hash2(r, i, seed + 11) * pal.tones.length)];
      ctx.fillStyle = tone;
      R(a, b, ph, L);
      // vân gỗ
      ctx.fillStyle = pal.grain;
      const g1 = 0.25 + hash2(r, i, seed + 21) * 0.5;
      R(a + ph * g1, b + 0.2, 0.025, L * (0.4 + hash2(r, i, seed + 31) * 0.5));
      if (hash2(r, i, seed + 41) < 0.5) R(a + ph * (1 - g1 * 0.7), b + L * 0.35, 0.02, L * 0.45);
      if (hash2(r, i, seed + 51) < 0.12) {
        ctx.beginPath();
        const ka = a + ph * 0.5, kb = b + L * (0.25 + hash2(r, i, seed + 61) * 0.5);
        if (V) ctx.ellipse(ka, kb, 0.05, 0.09, 0, 0, Math.PI * 2); else ctx.ellipse(kb, ka, 0.09, 0.05, 0, 0, Math.PI * 2);
        ctx.fillStyle = pal.seam;
        ctx.fill();
      }
      // khe nối đầu ván
      ctx.fillStyle = pal.seam;
      R(a, b, ph, 0.028);
    }
    ctx.fillStyle = pal.seam;
    R(a + ph - 0.022, b0, 0.022, b1 - b0);
  }
  ctx.restore();
}

function paintTiles(ctx, x0, y0, x1, y1, size, c1, c2, grout) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  for (let ty = Math.floor(y0 / size); ty * size < y1; ty++) {
    for (let tx = Math.floor(x0 / size); tx * size < x1; tx++) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? c1 : c2;
      ctx.fillRect(tx * size, ty * size, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(tx * size + 0.03, ty * size + 0.03, size * 0.5, 0.025);
    }
  }
  ctx.strokeStyle = grout;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let tx = Math.floor(x0 / size); tx * size <= x1; tx++) { ctx.moveTo(tx * size, y0); ctx.lineTo(tx * size, y1); }
  for (let ty = Math.floor(y0 / size); ty * size <= y1; ty++) { ctx.moveTo(x0, ty * size); ctx.lineTo(x1, ty * size); }
  ctx.stroke();
  ctx.restore();
}

/** gạch bông kiểu Sài Gòn cho pantry */
function paintGachBong(ctx, x0, y0, x1, y1) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  rect(ctx, x0, y0, x1 - x0, y1 - y0, '#f4ecdf');
  for (let ty = Math.floor(y0); ty < y1; ty++) {
    for (let tx = Math.floor(x0); tx < x1; tx++) {
      const cx = tx + 0.5, cy = ty + 0.5;
      // góc: 1/4 hình tròn (ghép với ô bên cạnh thành hoa tròn)
      ctx.fillStyle = '#ebc3a6';
      for (const [qx, qy, a0] of [[tx, ty, 0], [tx + 1, ty, Math.PI / 2], [tx + 1, ty + 1, Math.PI], [tx, ty + 1, Math.PI * 1.5]]) {
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.arc(qx, qy, 0.26, a0, a0 + Math.PI / 2);
        ctx.closePath();
        ctx.fill();
      }
      for (const [qx, qy] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]) circle(ctx, qx, qy, 0.11, '#f4ecdf');
      // hoa 4 cánh ở giữa
      ctx.fillStyle = '#a9cfc9';
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(ang) * 0.15, cy + Math.sin(ang) * 0.15, 0.12, 0.055, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      circle(ctx, cx, cy, 0.06, '#ecd08d');
      // viền ô
      ctx.strokeStyle = 'rgba(140,105,75,0.18)';
      ctx.lineWidth = 0.025;
      ctx.strokeRect(tx, ty, 1, 1);
    }
  }
  ctx.restore();
}

/** sàn phòng trưng bày: đá sáng khổ lớn, bóng nhẹ, vệt đèn rọi */
function paintShowroomFloor(ctx, x0, y0, x1, y1) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  rect(ctx, x0, y0, x1 - x0, y1 - y0, '#f5efe7');
  for (let ty = Math.floor(y0); ty < y1; ty++) {
    for (let tx = Math.floor(x0); tx < x1; tx++) {
      const v = hash2(tx, ty, 303);
      ctx.fillStyle = v < 0.5 ? '#f7f2eb' : '#f1eae1';
      ctx.fillRect(tx + 0.03, ty + 0.03, 0.94, 0.94);
      // vân đá mờ
      ctx.fillStyle = 'rgba(190,170,150,0.12)';
      ctx.fillRect(tx + 0.15 + v * 0.5, ty + 0.2, 0.025, 0.55);
      if (v > 0.6) ctx.fillRect(tx + 0.25, ty + 0.35 + v * 0.3, 0.45, 0.022);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(tx + 0.03, ty + 0.03, 0.94, 0.03);
    }
  }
  ctx.strokeStyle = 'rgba(160,140,120,0.22)';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let tx = Math.floor(x0); tx <= x1; tx++) { ctx.moveTo(tx, y0); ctx.lineTo(tx, y1); }
  for (let ty = Math.floor(y0); ty <= y1; ty++) { ctx.moveTo(x0, ty); ctx.lineTo(x1, ty); }
  ctx.stroke();
  // vệt đèn rọi (spotlight) trên sàn
  const w = x1 - x0;
  for (const fx of [0.25, 0.75]) {
    const g = ctx.createRadialGradient(x0 + w * fx, y0 + 1.6, 0.2, x0 + w * fx, y0 + 1.6, 2.6);
    g.addColorStop(0, 'rgba(255,250,230,0.75)');
    g.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, y1 - y0);
  }
  ctx.restore();
}

/** phòng kín (WC): mái kính mờ phủ lên phòng, không nhìn vào trong */
function paintClosedRoom(ctx, room) {
  const { x, y, w, h } = room;
  const x0 = x, y0 = y - 0.08, x1 = x + w, y1 = y + h;
  ctx.save();
  fillRR(ctx, x0, y0, x1 - x0, y1 - y0, 0.06, '#d9e3ea');
  // tấm kính mờ + sườn
  rrPath(ctx, x0, y0, x1 - x0, y1 - y0, 0.06);
  ctx.clip();
  rect(ctx, x0, y0, x1 - x0, y1 - y0, vGrad(ctx, y0, y1, [[0, '#e8f0f5'], [1, '#d3dee6']]));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(x0 + 0.3, y1); ctx.lineTo(x0 + 1.4, y1); ctx.lineTo(x0 + 2.6, y0); ctx.lineTo(x0 + 1.5, y0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,145,160,0.45)';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  for (let xx = x0 + 1; xx < x1; xx += 1) { ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); }
  for (let yy = y0 + 1; yy < y1; yy += 1) { ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(100,125,140,0.6)';
  ctx.lineWidth = 0.05;
  rrPath(ctx, x0, y0, x1 - x0, y1 - y0, 0.06);
  ctx.stroke();
  // biển 🚻 WC trên mái
  const cx = x0 + w / 2, cy = y0 + (y1 - y0) / 2;
  fillRR(ctx, cx - 1.1, cy - 0.62, 2.2, 1.24, 0.16, 'rgba(255,255,255,0.78)');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawEmoji(ctx, '🚻', cx, cy - 0.17, 0.62);
  ctx.fillStyle = '#334155';
  ctx.font = `800 0.34px ${FONT}`;
  ctx.fillText('WC', cx, cy + 0.36);
}

function paintCarpet(ctx, x0, y0, x1, y1) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  rect(ctx, x0, y0, x1 - x0, y1 - y0, '#8ea8b5');
  for (let ty = Math.floor(y0); ty < y1; ty++) {
    for (let tx = Math.floor(x0); tx < x1; tx++) {
      const odd = (tx + ty) % 2;
      ctx.fillStyle = odd ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.03)';
      ctx.fillRect(tx, ty, 1, 1);
      ctx.fillStyle = odd ? 'rgba(255,255,255,0.06)' : 'rgba(30,50,60,0.06)';
      for (let k = 0; k < 4; k++) {
        const p = 0.15 + k * 0.23;
        if (odd) ctx.fillRect(tx + 0.05, ty + p, 0.9, 0.025); else ctx.fillRect(tx + p, ty + 0.05, 0.025, 0.9);
      }
      for (let k = 0; k < 6; k++) {
        const hx = hash2(tx * 7 + k, ty, 91), hy = hash2(tx, ty * 7 + k, 92);
        ctx.fillStyle = hash2(tx, ty, k + 93) < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(20,40,55,0.10)';
        ctx.fillRect(tx + hx, ty + hy, 0.04, 0.04);
      }
    }
  }
  ctx.restore();
}

function paintServerFloor(ctx, x0, y0, x1, y1) {
  ctx.save();
  clip(ctx, x0, y0, x1, y1);
  rect(ctx, x0, y0, x1 - x0, y1 - y0, '#252c3a');
  for (let ty = Math.floor(y0); ty < y1; ty++) {
    for (let tx = Math.floor(x0); tx < x1; tx++) {
      fillRR(ctx, tx + 0.04, ty + 0.04, 0.92, 0.92, 0.05, '#2f3849');
      rect(ctx, tx + 0.06, ty + 0.05, 0.88, 0.025, 'rgba(255,255,255,0.06)');
      rect(ctx, tx + 0.06, ty + 0.92, 0.88, 0.025, 'rgba(0,0,0,0.25)');
      if (hash2(tx, ty, 77) < 0.45) {
        ctx.fillStyle = 'rgba(10,14,22,0.55)';
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) ctx.fillRect(tx + 0.2 + i * 0.15, ty + 0.2 + j * 0.15, 0.04, 0.04);
      }
    }
  }
  ctx.restore();
}

function paintFloorType(ctx, room, x0, y0, x1, y1) {
  const type = room ? room.floor : 'wood';
  const id = room ? room.id : 'work';
  switch (type) {
    case 'tile':
      if (id === 'pantry') paintGachBong(ctx, x0, y0, x1, y1);
      else paintTiles(ctx, x0, y0, x1, y1, 0.5, '#eef6f7', '#dfecef', 'rgba(120,155,165,0.4)');
      break;
    case 'dark': paintServerFloor(ctx, x0, y0, x1, y1); break;
    case 'showroom': paintShowroomFloor(ctx, x0, y0, x1, y1); break;
    case 'carpet': paintCarpet(ctx, x0, y0, x1, y1); break;
    case 'boss': paintWood(ctx, x0, y0, x1, y1, WOOD.boss, 5); break;
    case 'rug': paintWood(ctx, x0, y0, x1, y1, WOOD.work, 1); break;
    default: paintWood(ctx, x0, y0, x1, y1, id === 'hall' ? WOOD.hall : WOOD.work, id === 'hall' ? 3 : 1);
  }
}

// ------------------------------------------------------------------ thảm
function persianRug(ctx, x, y, w, h, field, border, accent) {
  softShadow(ctx, x + 0.04, y + 0.08, w, h, 0.12, 0.12, 'rgba(40,20,10,0.25)');
  fillRR(ctx, x, y, w, h, 0.12, border);
  fillRR(ctx, x + 0.22, y + 0.22, w - 0.44, h - 0.44, 0.08, accent);
  fillRR(ctx, x + 0.3, y + 0.3, w - 0.6, h - 0.6, 0.06, field);
  // hoạ tiết viền
  ctx.fillStyle = accent;
  for (let i = x + 0.5; i < x + w - 0.4; i += 0.45) {
    ctx.beginPath(); ctx.moveTo(i, y + 0.11); ctx.lineTo(i + 0.1, y + 0.05); ctx.lineTo(i + 0.2, y + 0.11); ctx.lineTo(i + 0.1, y + 0.17); ctx.fill();
    ctx.beginPath(); ctx.moveTo(i, y + h - 0.11); ctx.lineTo(i + 0.1, y + h - 0.05); ctx.lineTo(i + 0.2, y + h - 0.11); ctx.lineTo(i + 0.1, y + h - 0.17); ctx.fill();
  }
  // huy chương giữa
  const cx = x + w / 2, cy = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.3); ctx.lineTo(cx + w * 0.22, cy); ctx.lineTo(cx, cy + h * 0.3); ctx.lineTo(cx - w * 0.22, cy); ctx.closePath();
  ctx.fillStyle = alpha(accent, 0.55); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.18); ctx.lineTo(cx + w * 0.12, cy); ctx.lineTo(cx, cy + h * 0.18); ctx.lineTo(cx - w * 0.12, cy); ctx.closePath();
  ctx.fillStyle = border; ctx.fill();
  // tua rua
  ctx.strokeStyle = 'rgba(245,235,215,0.9)';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  for (let i = y + 0.1; i < y + h - 0.05; i += 0.12) { ctx.moveTo(x, i); ctx.lineTo(x - 0.1, i); ctx.moveTo(x + w, i); ctx.lineTo(x + w + 0.1, i); }
  ctx.stroke();
}

function loungeRug(ctx, x, y, w, h) {
  softShadow(ctx, x + 0.04, y + 0.08, w, h, 0.5, 0.12, 'rgba(60,30,10,0.22)');
  fillRR(ctx, x, y, w, h, 0.55, '#f4e4cc');
  fillRR(ctx, x + 0.18, y + 0.18, w - 0.36, h - 0.36, 0.45, '#dea283');
  fillRR(ctx, x + 0.42, y + 0.42, w - 0.84, h - 0.84, 0.3, '#e8b496');
  ctx.save();
  rrPath(ctx, x + 0.42, y + 0.42, w - 0.84, h - 0.84, 0.3);
  ctx.clip();
  for (let i = 0; i < w / 1.1; i++) {
    for (let j = 0; j < h / 1.1; j++) {
      const cx = x + 0.95 + i * 1.1, cy = y + 0.95 + j * 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 0.24); ctx.lineTo(cx + 0.24, cy); ctx.lineTo(cx, cy + 0.24); ctx.lineTo(cx - 0.24, cy); ctx.closePath();
      ctx.fillStyle = (i + j) % 2 ? 'rgba(79,148,143,0.3)' : 'rgba(250,236,214,0.55)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function roundRug(ctx, cx, cy, rx, ry) {
  softEllipseShadow(ctx, cx + 0.04, cy + 0.08, rx, ry, 0.12, 'rgba(40,40,20,0.2)');
  ellipse(ctx, cx, cy, rx, ry, '#f1e8d3');
  ellipse(ctx, cx, cy, rx - 0.16, ry - 0.16, '#a9bf9a');
  ctx.strokeStyle = 'rgba(241,232,211,0.85)';
  ctx.lineWidth = 0.05;
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, (rx - 0.16) * (1 - k * 0.22), (ry - 0.16) * (1 - k * 0.22), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function floorLogo(ctx, cx, cy, text) {
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineWidth = 0.12;
  ctx.beginPath(); ctx.arc(cx, cy, 2.1, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#5b3a1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 0.9px ${FONT}`;
  ctx.fillText('</>', cx, cy - 0.45);
  ctx.font = `800 0.42px ${FONT}`;
  let s = 0.42;
  while (ctx.measureText(text).width > 3.2 && s > 0.2) { s -= 0.02; ctx.font = `800 ${s}px ${FONT}`; }
  ctx.fillText(text, cx, cy + 0.55);
  ctx.restore();
}

// ------------------------------------------------------------------ tường
function paintOf(world, x, y) {
  // màu sơn của mặt tường = phòng nằm ngay phía dưới (mặt tường hướng về phía đó)
  for (let yy = y + 1; yy < Math.min(world.H, y + 3); yy++) {
    if (!world.isWall(x, yy)) {
      const r = world.roomAt(x, yy);
      return WALL_PAINT[r?.id] || WALL_PAINT.work;
    }
  }
  for (const dx of [-1, 1, -2, 2]) {
    if (!world.isWall(x + dx, y + 1)) {
      const r = world.roomAt(x + dx, y + 1);
      return WALL_PAINT[r?.id] || WALL_PAINT.work;
    }
  }
  return WALL_PAINT.work;
}

function faceTile(ctx, world, x, y, outer) {
  const [c1, c2] = paintOf(world, x, y);
  const room = world.roomAt(x, y + 1);
  const rid = room?.id;
  rect(ctx, x, y + CAP, 1, 1 - CAP, vGrad(ctx, y + CAP, y + 1, [[0, c1], [1, c2]]));
  if (rid === 'toilet' || rid === 'wc') {
    ctx.strokeStyle = 'rgba(120,160,170,0.35)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    for (let k = 1; k < 4; k++) { ctx.moveTo(x, y + CAP + k * 0.2); ctx.lineTo(x + 1, y + CAP + k * 0.2); }
    for (let k = 0; k < 4; k++) { const xx = x + k * 0.25 + ((Math.floor((y + 1) * 5) % 2) ? 0.125 : 0); ctx.moveTo(xx, y + CAP); ctx.lineTo(xx, y + 1); }
    ctx.stroke();
  } else if (rid === 'boss') {
    rect(ctx, x, y + 0.6, 1, 0.4, '#5b3e2a');
    rect(ctx, x, y + 0.6, 1, 0.035, '#c9a35f');
    rect(ctx, x, y + 0.7, 1, 0.015, 'rgba(0,0,0,0.25)');
  } else if (rid === 'server') {
    rect(ctx, x, y + 0.86, 1, 0.14, '#363e4c');
  } else {
    rect(ctx, x, y + 0.9, 1, 0.1, rid === 'pantry' ? '#b98d63' : '#b39678');
    rect(ctx, x, y + 0.9, 1, 0.018, 'rgba(255,255,255,0.35)');
  }
  // mép trên
  rect(ctx, x, y, 1, CAP, outer ? OUTER_CAP : CAP_COLOR);
  rect(ctx, x, y + CAP - 0.02, 1, 0.02, outer ? OUTER_EDGE : CAP_EDGE);
  rect(ctx, x, y, 1, 0.018, outer ? OUTER_EDGE : 'rgba(105,85,65,0.2)');
  // cạnh hai bên khi tường kết thúc
  if (!world.isWall(x - 1, y) && world.at(x - 1, y) !== 'D') rect(ctx, x, y, 0.035, 1, 'rgba(90,70,50,0.4)');
  if (!world.isWall(x + 1, y) && world.at(x + 1, y) !== 'D') rect(ctx, x + 0.965, y, 0.035, 1, 'rgba(90,70,50,0.4)');
}

function glassFace(ctx, world, x, y) {
  paintFloorType(ctx, world.roomAt(x, y - 1) || world.roomAt(x, y + 1), x, y, x + 1, y + 1);
  rect(ctx, x, y + CAP, 1, 1 - CAP, 'rgba(178,218,236,0.46)');
  // vệt phản chiếu
  ctx.save();
  clip(ctx, x, y + CAP, x + 1, y + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath();
  const o = (x * 0.37) % 1;
  ctx.moveTo(x + o, y + 1); ctx.lineTo(x + o + 0.18, y + 1); ctx.lineTo(x + o + 0.5, y + CAP); ctx.lineTo(x + o + 0.32, y + CAP); ctx.closePath();
  ctx.fill();
  ctx.restore();
  rect(ctx, x, y + 0.94, 1, 0.06, '#93a9b6');
  rect(ctx, x, y, 1, CAP, '#d7e3ea');
  rect(ctx, x, y + CAP - 0.025, 1, 0.025, '#8ea5b3');
  if (x % 2 === 0) rect(ctx, x - 0.02, y + CAP, 0.04, 1 - CAP, '#9fb4c0');
  if (!world.isWall(x - 1, y) && world.at(x - 1, y) !== 'D') rect(ctx, x, y, 0.05, 1, '#8ea5b3');
  if (!world.isWall(x + 1, y) && world.at(x + 1, y) !== 'D') rect(ctx, x + 0.95, y, 0.05, 1, '#8ea5b3');
}

function columnTile(ctx, world, x, y, isGlass) {
  // sàn hai bên rồi dải tường dọc ở giữa
  const lr = world.isWall(x - 1, y) ? null : world.roomAt(x - 1, y);
  const rr = world.isWall(x + 1, y) ? null : world.roomAt(x + 1, y);
  paintFloorType(ctx, lr || rr || world.roomAt(x, y), x, y, x + 0.5, y + 1);
  paintFloorType(ctx, rr || lr || world.roomAt(x, y), x + 0.5, y, x + 1, y + 1);
  const sx = x + 0.5 - STRIP / 2;
  const joinL = world.isWall(x - 1, y), joinR = world.isWall(x + 1, y);
  const x0 = joinL ? x : sx, x1 = joinR ? x + 1 : sx + STRIP;
  // bóng đổ nhẹ 2 bên
  rect(ctx, x0 - 0.08, y, 0.08, 1, 'rgba(60,40,20,0.07)');
  rect(ctx, x1, y, 0.1, 1, 'rgba(60,40,20,0.1)');
  if (isGlass) {
    rect(ctx, x0, y, x1 - x0, 1, 'rgba(160,205,228,0.7)');
    rect(ctx, x + 0.47, y, 0.06, 1, 'rgba(255,255,255,0.55)');
    rect(ctx, x0, y, 0.035, 1, '#8ea5b3');
    rect(ctx, x1 - 0.035, y, 0.035, 1, '#8ea5b3');
  } else {
    rect(ctx, x0, y, x1 - x0, 1, CAP_COLOR);
    rect(ctx, x0, y, 0.03, 1, CAP_EDGE);
    rect(ctx, x1 - 0.03, y, 0.03, 1, CAP_EDGE);
  }
  if (!world.isWall(x, y - 1)) rect(ctx, x0, y, x1 - x0, 0.03, isGlass ? '#8ea5b3' : CAP_EDGE);
}

function sideOuterTile(ctx, world, x, y, win) {
  rect(ctx, x, y, 1, 1, OUTER_CAP);
  const inner = x === 0 ? x + 1 : x;
  rect(ctx, inner - 0.035, y, 0.035, 1, OUTER_EDGE);
  rect(ctx, x === 0 ? x : x + 0.97, y, 0.03, 1, 'rgba(70,50,30,0.35)');
  if (win) {
    rect(ctx, x + 0.3, y, 0.4, 1, 'rgba(170,212,235,0.9)');
    rect(ctx, x + 0.47, y, 0.06, 1, 'rgba(255,255,255,0.6)');
    rect(ctx, x + 0.28, y, 0.03, 1, '#8b9aa4');
    rect(ctx, x + 0.69, y, 0.03, 1, '#8b9aa4');
    if (y % 2 === 0) rect(ctx, x + 0.28, y - 0.02, 0.44, 0.04, '#8b9aa4');
  }
}

function bottomOuterTile(ctx, world, x, y, win) {
  rect(ctx, x, y, 1, 1, OUTER_CAP);
  rect(ctx, x, y, 1, 0.035, OUTER_EDGE);
  // mặt tiền bên ngoài (nhìn từ phía nam)
  rect(ctx, x, y + 1, 1, 0.42, vGrad(ctx, y + 1, y + 1.42, [[0, '#cbb497'], [1, '#b49b7c']]));
  rect(ctx, x, y + 1.38, 1, 0.04, 'rgba(60,40,20,0.35)');
  if (win) {
    rect(ctx, x, y + 0.3, 1, 0.4, 'rgba(170,212,235,0.9)');
    rect(ctx, x, y + 0.47, 1, 0.06, 'rgba(255,255,255,0.6)');
    rect(ctx, x, y + 0.28, 1, 0.03, '#8b9aa4');
    rect(ctx, x, y + 0.69, 1, 0.03, '#8b9aa4');
    if (x % 2 === 0) rect(ctx, x - 0.02, y + 0.28, 0.04, 0.44, '#8b9aa4');
    rect(ctx, x + 0.08, y + 1.06, 0.84, 0.26, 'rgba(150,195,220,0.85)');
    rect(ctx, x + 0.08, y + 1.06, 0.84, 0.05, 'rgba(255,255,255,0.5)');
  }
}

function doorTile(ctx, world, x, y) {
  const horiz = (world.isWall(x - 1, y) || world.at(x - 1, y) === 'D') && (world.isWall(x + 1, y) || world.at(x + 1, y) === 'D')
    && !world.isWall(x, y - 1) && !world.isWall(x, y + 1);
  const below = world.roomAt(x, y + 1), above = world.roomAt(x, y - 1);
  const left = world.roomAt(x - 1, y), right = world.roomAt(x + 1, y);
  if (horiz && (above?.id === 'wc' || below?.id === 'wc')) {
    closedDoorTile(ctx, world, x, y, above?.id === 'wc' ? below : above);
    return;
  }
  if (horiz) {
    paintFloorType(ctx, above || below, x, y, x + 1, y + 0.5);
    paintFloorType(ctx, below || above, x, y + 0.5, x + 1, y + 1);
    const glassy = world.glass[y * world.W + x - 1] || world.glass[y * world.W + x + 1];
    // lanh tô phía trên cửa
    rect(ctx, x, y, 1, CAP, glassy ? '#d7e3ea' : CAP_COLOR);
    rect(ctx, x, y + CAP, 1, 0.16, glassy ? 'rgba(150,190,210,0.75)' : paintOf(world, x, y)[1]);
    rect(ctx, x, y + CAP + 0.16, 1, 0.03, 'rgba(60,40,20,0.3)');
    rect(ctx, x, y + 0.9, 1, 0.08, 'rgba(120,100,80,0.45)');
    if (world.isWall(x - 1, y)) rect(ctx, x, y, 0.07, 1, glassy ? '#8ea5b3' : '#bfa98d');
    if (world.isWall(x + 1, y)) rect(ctx, x + 0.93, y, 0.07, 1, glassy ? '#8ea5b3' : '#bfa98d');
  } else {
    paintFloorType(ctx, left || right, x, y, x + 0.5, y + 1);
    paintFloorType(ctx, right || left, x + 0.5, y, x + 1, y + 1);
    rect(ctx, x + 0.42, y, 0.16, 1, 'rgba(120,100,80,0.35)');
    if (world.isWall(x, y - 1)) fillRR(ctx, x + 0.5 - STRIP / 2 - 0.04, y - 0.04, STRIP + 0.08, 0.14, 0.04, '#bfa98d');
    if (world.isWall(x, y + 1)) fillRR(ctx, x + 0.5 - STRIP / 2 - 0.04, y + 0.9, STRIP + 0.08, 0.14, 0.04, '#bfa98d');
  }
}

/** cánh cửa WC đóng kín (mỗi ô = 1 cánh; 2 ô liền = cửa đôi), tay nắm quay vào giữa */
function closedDoorTile(ctx, world, x, y, outsideRoom) {
  paintFloorType(ctx, outsideRoom, x, y, x + 1, y + 1);
  const leftDoor = world.at(x - 1, y) === 'D', rightDoor = world.at(x + 1, y) === 'D';
  // khung + lanh tô
  rect(ctx, x, y, 1, CAP, CAP_COLOR);
  rect(ctx, x, y + CAP - 0.02, 1, 0.02, CAP_EDGE);
  rect(ctx, x, y + CAP, 1, 1 - CAP, '#8d6a4a');
  // cánh cửa gỗ
  const dx = x + (leftDoor ? 0.02 : 0.08), dw = 1 - (leftDoor ? 0.02 : 0.08) - (rightDoor ? 0.02 : 0.08);
  fillRR(ctx, dx, y + CAP + 0.04, dw, 1 - CAP - 0.06, 0.03, '#b98a5c');
  rect(ctx, dx + 0.07, y + CAP + 0.12, dw - 0.14, 0.22, 'rgba(255,255,255,0.14)');
  rect(ctx, dx + 0.07, y + CAP + 0.42, dw - 0.14, 0.4, 'rgba(0,0,0,0.1)');
  ctx.strokeStyle = 'rgba(80,50,25,0.45)';
  ctx.lineWidth = 0.02;
  ctx.strokeRect(dx + 0.07, y + CAP + 0.12, dw - 0.14, 0.22);
  ctx.strokeRect(dx + 0.07, y + CAP + 0.42, dw - 0.14, 0.4);
  // tay nắm: cửa đôi -> quay vào giữa; cửa đơn -> bên phải
  const hx = rightDoor ? x + 0.84 : leftDoor ? x + 0.16 : x + 0.8;
  circle(ctx, hx, y + 0.62, 0.045, '#e5c76b');
  circle(ctx, hx, y + 0.62, 0.02, '#8a6b1f');
  if (!world.isWall(x - 1, y) && !leftDoor) rect(ctx, x, y, 0.035, 1, 'rgba(90,70,50,0.4)');
  if (!world.isWall(x + 1, y) && !rightDoor) rect(ctx, x + 0.965, y, 0.035, 1, 'rgba(90,70,50,0.4)');
}

/** biển "WC" gắn trên cụm cửa (toạ độ tâm cụm cửa) */
function wcDoorSign(ctx, cx, y) {
  fillRR(ctx, cx - 0.42, y + CAP + 0.03, 0.84, 0.26, 0.05, '#1f3a5f');
  rect(ctx, cx - 0.36, y + CAP + 0.06, 0.72, 0.02, 'rgba(255,255,255,0.35)');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawEmoji(ctx, '🚻', cx - 0.2, y + CAP + 0.165, 0.17);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 0.17px ${FONT}`;
  ctx.fillText('WC', cx + 0.14, y + CAP + 0.165);
}

/** cửa sổ trên mặt tường hàng trên cùng */
function topWindow(ctx, x0, x1, y) {
  const wx = x0 + 0.1, ww = x1 - x0 - 0.2;
  const wy = y + CAP + 0.1, wh = 1 - CAP - 0.26;
  fillRR(ctx, wx - 0.05, wy - 0.05, ww + 0.1, wh + 0.12, 0.04, '#e8e1d6');
  rect(ctx, wx, wy, ww, wh, vGrad(ctx, wy, wy + wh, [[0, '#9fd0ee'], [1, '#dcf0fa']]));
  // mây + toà nhà xa
  ctx.save();
  clip(ctx, wx, wy, wx + ww, wy + wh);
  ellipse(ctx, wx + ww * 0.3, wy + wh * 0.3, 0.3, 0.07, 'rgba(255,255,255,0.8)');
  ellipse(ctx, wx + ww * 0.75, wy + wh * 0.22, 0.22, 0.05, 'rgba(255,255,255,0.7)');
  for (let bx = wx; bx < wx + ww; bx += 0.22) {
    const bh = 0.1 + hash2(Math.floor(bx * 10), 3, 9) * 0.3;
    rect(ctx, bx, wy + wh - bh, 0.2, bh, 'rgba(120,150,175,0.45)');
    if (hash2(Math.floor(bx * 10), 4, 9) < 0.5) rect(ctx, bx + 0.05, wy + wh - bh + 0.04, 0.03, 0.03, 'rgba(255,255,255,0.6)');
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(wx + ww * 0.15, wy + wh); ctx.lineTo(wx + ww * 0.15 + 0.2, wy + wh); ctx.lineTo(wx + ww * 0.15 + 0.55, wy); ctx.lineTo(wx + ww * 0.15 + 0.35, wy); ctx.closePath(); ctx.fill();
  ctx.restore();
  const n = Math.max(1, Math.round(ww / 1.2));
  for (let i = 1; i < n; i++) rect(ctx, wx + (ww * i) / n - 0.02, wy, 0.04, wh, '#e8e1d6');
  rect(ctx, wx - 0.08, wy + wh + 0.02, ww + 0.16, 0.06, '#fffaf2');
  rect(ctx, wx - 0.08, wy + wh + 0.08, ww + 0.16, 0.02, 'rgba(80,60,40,0.3)');
}

// ------------------------------------------------------------------ trang trí tường
function banner(ctx, x0, x1, y, text) {
  const by = y + 0.3, bh = 0.4;
  line(ctx, x0 + 0.2, y + CAP, x0 + 0.3, by, 'rgba(80,60,40,0.6)', 0.02);
  line(ctx, x1 - 0.2, y + CAP, x1 - 0.3, by, 'rgba(80,60,40,0.6)', 0.02);
  ctx.fillStyle = '#d9342b';
  ctx.beginPath();
  ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.lineTo(x1 - 0.12, by + bh / 2); ctx.lineTo(x1, by + bh); ctx.lineTo(x0, by + bh); ctx.lineTo(x0 + 0.12, by + bh / 2); ctx.closePath();
  ctx.fill();
  rect(ctx, x0 + 0.1, by + 0.04, x1 - x0 - 0.2, 0.015, 'rgba(255,220,120,0.8)');
  rect(ctx, x0 + 0.1, by + bh - 0.055, x1 - x0 - 0.2, 0.015, 'rgba(255,220,120,0.8)');
  ctx.fillStyle = '#ffe27a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let s = 0.26;
  ctx.font = `800 ${s}px ${FONT}`;
  while (ctx.measureText(text).width > x1 - x0 - 0.5 && s > 0.12) { s -= 0.01; ctx.font = `800 ${s}px ${FONT}`; }
  ctx.fillText(text, (x0 + x1) / 2, by + bh / 2 + 0.01);
}

/** đoạn tường liền (không cửa, không nội thất kê sát dưới) dài nhất trên hàng y, trong [xa, xb] */
function bannerSpan(world, y, xa, xb) {
  const blockedBelow = (x) => world.furniture.some((f) => f.blocked && f.type !== 'door_mat' && x >= f.x && x < f.x + f.w && f.y === y + 1);
  let best = null, run = null;
  for (let x = xa; x <= xb + 1; x++) {
    const ok = x <= xb && world.isWall(x, y) && !blockedBelow(x) && world.at(x, y - 1) !== 'D' && world.at(x, y + 1) !== 'D';
    if (ok) { if (!run) run = [x, x + 1]; else run[1] = x + 1; }
    else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
  }
  return best && best[1] - best[0] >= 3 ? best : null;
}

function chalkboard(ctx, x0, x1, y) {
  const by = y + CAP + 0.06, bh = 0.62;
  fillRR(ctx, x0, by, x1 - x0, bh, 0.04, '#8a5a35');
  fillRR(ctx, x0 + 0.05, by + 0.05, x1 - x0 - 0.1, bh - 0.1, 0.03, '#2f4a3a');
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 0.15px ${FONT}`;
  ctx.fillText('MENU HÔM NAY ☕', x0 + 0.15, by + 0.1);
  ctx.font = `500 0.11px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Cà phê sữa đá · Trà đào · Bánh mì', x0 + 0.15, by + 0.3);
  ctx.fillText('Bạc xỉu · Trà tắc · Bánh flan', x0 + 0.15, by + 0.43);
}

function calligraphy(ctx, x0, x1, y) {
  const by = y + CAP + 0.05, bh = 0.6;
  rect(ctx, x0, by - 0.03, x1 - x0, 0.05, '#6b3f1f');
  rect(ctx, x0 + 0.04, by, x1 - x0 - 0.08, bh, '#f3e6c8');
  rect(ctx, x0 + 0.04, by, x1 - x0 - 0.08, 0.04, '#b0322a');
  rect(ctx, x0 + 0.04, by + bh - 0.04, x1 - x0 - 0.08, 0.04, '#b0322a');
  rect(ctx, x0, by + bh, x1 - x0, 0.05, '#6b3f1f');
  ctx.fillStyle = '#9b1c16';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 800 0.24px Georgia, "Times New Roman", serif`;
  ctx.fillText('Phát Tài', (x0 + x1) / 2, by + bh / 2);
}

function clockFace(ctx, cx, cy, r) {
  circle(ctx, cx + 0.02, cy + 0.04, r, 'rgba(0,0,0,0.18)');
  circle(ctx, cx, cy, r, '#3b3027');
  circle(ctx, cx, cy, r * 0.86, '#fffdf8');
  ctx.fillStyle = '#3b3027';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const rr = k % 3 === 0 ? 0.05 : 0.028;
    circle(ctx, cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, rr, '#3b3027');
  }
}

// ------------------------------------------------------------------ bóng nội thất
const NO_SHADOW = new Set(['door_mat', 'sofa', 'sofa_back']);
function furnitureShadow(ctx, f) {
  if (NO_SHADOW.has(f.type)) return;
  const c = 'rgba(55,35,20,0.26)';
  switch (f.type) {
    case 'plant': softEllipseShadow(ctx, f.x + 0.56, f.y + 0.82, 0.38, 0.16, 0.08, c); break;
    case 'beanbag': softEllipseShadow(ctx, f.x + 0.55, f.y + 0.82, 0.5, 0.22, 0.1, c); break;
    case 'toilet': case 'coffee_machine': case 'water': softShadow(ctx, f.x + 0.12, f.y + 0.3, f.w - 0.1, f.h - 0.2, 0.1, 0.1, c); break;
    case 'whiteboard': softShadow(ctx, f.x + 0.2, f.y + 0.7, f.w - 0.3, 0.25, 0.1, 0.1, c); break;
    case 'kpi_board': softShadow(ctx, f.x + 0.4, f.y + f.h - 0.35, f.w - 0.6, 0.3, 0.1, 0.1, c); break;
    case 'counter': softShadow(ctx, f.x + 0.0, f.y + 0.1, f.w, f.h + 0.05, 0.05, 0.12, c); break;
    default: softShadow(ctx, f.x + 0.08, f.y + 0.14, f.w - 0.02, f.h - 0.02, 0.12, 0.14, c);
  }
}

// ------------------------------------------------------------------ cửa sổ tự động
function windowPlan(world) {
  const { W, H } = world;
  const blockedAt = (x, y) => world.furniture.some((f) => f.blocked && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
  const okRoom = (r) => r && r.id !== 'toilet' && r.id !== 'server' && r.id !== 'wc';
  const top = [];
  let run = null;
  for (let x = 1; x < W - 1; x++) {
    const ok = !world.isWall(x, 1) && okRoom(world.roomAt(x, 1)) && !blockedAt(x, 1) && world.isWall(x, 0);
    if (ok) { if (!run) run = [x, x + 1]; else run[1] = x + 1; } else if (run) { top.push(run); run = null; }
  }
  if (run) top.push(run);
  const topWins = [];
  for (const [a, b] of top) {
    if (b - a < 2) continue;
    for (let s = a; s < b; s += 4) topWins.push([s, Math.min(b, s + 4)]);
  }
  const side = new Set();
  for (let y = 2; y < H - 2; y++) {
    for (const [x, ix] of [[0, 1], [W - 1, W - 2]]) {
      if (!world.isWall(x, y)) continue;
      const near = [y - 1, y, y + 1].some((yy) => world.at(x, yy) === 'D' || world.at(x, yy + 1) === 'D' || world.at(x, yy - 1) === 'D');
      if (near) continue;
      if (world.isWall(ix, y)) continue;
      if (okRoom(world.roomAt(ix, y)) && world.roomAt(ix, y)?.id !== 'meeting') side.add(y * W + x);
    }
  }
  for (let x = 2; x < W - 2; x++) {
    if (!world.isWall(x, H - 2) && okRoom(world.roomAt(x, H - 2))) side.add((H - 1) * W + x);
  }
  return { topWins, side };
}

// ------------------------------------------------------------------ nhãn phòng
const LABEL_POS = {
  work: [1.3, 8.65], toilet: [1.25, 5.85], showroom: [1.25, 5.85], server: [10.25, 5.85], meeting: [24.25, 8.85],
  boss: [45.3, 9.85], hall: [48.1, 12.55], pantry: [48.6, 23.55], lounge: [24.3, 26.35],
};
const ROOM_ICONS_V2 = { ...ROOM_ICONS, showroom: '🛍️', wc: '🚻' };

/**
 * Nhãn phòng, vẽ MỖI KHUNG theo px màn hình (gọi ngay sau khi dán layer tĩnh, nên vẫn nằm dưới nội thất + nhân vật).
 * Trước đây nướng vào layer tĩnh theo đơn vị ô → phóng to là chữ phình theo (lớn hơn cả tên người),
 * bản đồ nhỏ (điện thoại xoay ngang) thì nhãn to hơn cả phòng. Giờ: ~9,5 px × ui, nhích lên tối đa 13 px khi phóng to,
 * ẩn hẳn khi ô < 7 px (bản đồ quá nhỏ, nhãn chỉ che phòng); nhãn đụng nhãn vẽ trước hoặc đụng `avoid` (biển WC) thì bỏ.
 * ctx: transform px CSS (dpr, 0, 0, dpr, 0, 0); ox / oy: gốc bản đồ (px CSS); ui: hệ số co chữ nổi (office.js).
 */
export function drawRoomLabels(ctx, world, T, ox, oy, ui = 1, avoid = []) {
  if (!world || T < 7) return;
  const fs0 = Math.min(13, Math.max(9.5 * ui, 0.36 * T));
  // bản đồ nhỏ: nhãn sau đụng nhãn trước (vd "Phòng server" đè đuôi "Phòng trưng bày") hoặc đụng biển WC → thu nhỏ chữ
  // (tối đa còn 72 %, không dưới 7,5 px) cho vừa; vẫn đụng thì bỏ nhãn sau
  const placed = Array.isArray(avoid) ? avoid.filter((r) => r && Number.isFinite(r.x)) : [];
  const hitsPlaced = (x, y, w, h) => placed.some((r) => x < r.x + r.w + 2 && r.x < x + w + 2 && y < r.y + r.h + 1 && r.y < y + h + 1);
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const room of world.rooms) {
    if (room.id === 'wc') continue;
    const icon = ROOM_ICONS_V2[room.id] || '📍';
    const pos = LABEL_POS[room.id] || [room.x + 0.25, room.y + 0.3];
    const x = Math.round(ox + pos[0] * T), y = Math.round(oy + pos[1] * T);
    let fs = 0, iw = 0, h = 0, w = 0;
    for (const k of [1, 0.85, 0.72]) {
      const f = fs0 * k;
      if (k < 1 && f < 7.5) break;
      ctx.font = `700 ${f}px ${FONT}`;
      const fw = ctx.measureText(room.label).width + f * 1.25 + f * 0.9, fh = f * 1.55;
      if (!hitsPlaced(x, y, fw, fh)) { fs = f; iw = f * 1.25; h = fh; w = fw; break; }
    }
    if (!fs) continue;
    placed.push({ x, y, w, h });
    fillRR(ctx, x + 0.6, y + 1.2, w, h, h / 2, 'rgba(60,40,20,0.12)');
    fillRR(ctx, x, y, w, h, h / 2, room.floor === 'dark' || room.floor === 'boss' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.78)');
    drawEmoji(ctx, icon, x + fs * 0.4, y + h / 2 + fs * 0.05, fs * 0.92, 'left');
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.fillStyle = '#5b4636';
    ctx.fillText(room.label, x + fs * 0.4 + iw, y + h / 2 + fs * 0.04);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ vẽ layer
/**
 * @returns {{canvas, T, dpr, x0, y0, w, h, clock?:{x,y,r}}}
 */
export function renderFloorLayer(world, T, dpr, opts = {}) {
  const { W, H } = world;
  const M = MARGIN;
  const s = T * dpr;
  const cw = Math.round((W + 2 * M) * s), ch = Math.round((H + 2 * M) * s);
  const cv = makeCanvas(cw, ch);
  const ctx = cv.getContext('2d');
  ctx.setTransform(s, 0, 0, s, M * s, M * s);
  ctx.lineCap = 'butt';

  // bóng toà nhà
  softShadow(ctx, 0.1, 0.35, W - 0.2, H + 0.05, 0.3, 0.45, 'rgba(80,55,30,0.35)');
  // lối vào bên ngoài: bậc thềm đá + thảm
  const leftDoors = world.entrance.filter((e) => e.x === 0).map((e) => e.y);
  if (leftDoors.length) {
    const y0 = Math.min(...leftDoors) - 0.3, y1 = Math.max(...leftDoors) + 1.3;
    softShadow(ctx, -0.95, y0 + 0.08, 0.95, y1 - y0, 0.06, 0.08, 'rgba(60,40,20,0.3)');
    fillRR(ctx, -0.95, y0, 0.98, y1 - y0, [0.08, 0, 0, 0.08], '#d9cfc2');
    ctx.strokeStyle = 'rgba(120,100,80,0.35)';
    ctx.lineWidth = 0.025;
    for (let yy = y0 + 0.5; yy < y1 - 0.1; yy += 0.5) line(ctx, -0.92, yy, 0, yy, 'rgba(120,100,80,0.3)', 0.025);
    fillRR(ctx, -0.78, y0 + 0.45, 0.62, y1 - y0 - 0.9, 0.06, '#7b5b3d');
    fillRR(ctx, -0.72, y0 + 0.51, 0.5, y1 - y0 - 1.02, 0.05, '#9a7550');
  }

  // sàn: nền = phòng lớn nhất, sau đó các phòng (lớn -> nhỏ)
  paintFloorType(ctx, world.largest, 0, 0, W, H);
  const byArea = [...world.rooms].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const r of byArea) {
    if (r === world.largest) continue;
    paintFloorType(ctx, r, r.x, r.y, r.x + r.w, r.y + r.h);
  }

  // thảm
  const boss = world.bossRoom;
  if (boss) persianRug(ctx, boss.x + 2.3, boss.y + 1.45, boss.w - 4.6, boss.h - 2.1, '#8a2f2f', '#22324d', '#d4a84b');
  const lounge = world.roomById('lounge');
  if (lounge) loungeRug(ctx, lounge.x + 1.2, lounge.y + 1.55, lounge.w - 2.4, lounge.h - 0.65);
  const work = world.workRoom;
  if (work && work.id === 'work') {
    roundRug(ctx, work.x + 3.6, work.y + 21.4, 3.3, 2.3);
    floorLogo(ctx, work.x + 16, work.y + 20.4, opts.logoText || 'VIBECORP');
  }

  // bóng nội thất
  for (const f of world.furniture) furnitureShadow(ctx, f);
  // bóng chân tường (ambient occlusion)
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (world.isWall(x, y) && !world.isWall(x, y + 1)) {
        rect(ctx, x, y + 1, 1, 0.24, vGrad(ctx, y + 1, y + 1.24, [[0, 'rgba(50,30,15,0.16)'], [1, 'rgba(50,30,15,0)']]));
      }
    }
  }

  // tường
  const { topWins, side } = windowPlan(world);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = world.at(x, y);
      if (c === 'D') { doorTile(ctx, world, x, y); continue; }
      if (c !== '#') continue;
      const isGlass = !!world.glass[y * W + x];
      if (y === 0) faceTile(ctx, world, x, y, true);
      else if (y === H - 1) bottomOuterTile(ctx, world, x, y, side.has(y * W + x));
      else if (x === 0 || x === W - 1) sideOuterTile(ctx, world, x, y, side.has(y * W + x));
      else if (!world.isWall(x, y + 1)) { if (isGlass) glassFace(ctx, world, x, y); else faceTile(ctx, world, x, y, false); }
      else columnTile(ctx, world, x, y, isGlass);
    }
  }
  for (const [a, b] of topWins) topWindow(ctx, a, b, 0);
  // phòng kín (WC v2): mái + biển trên cửa
  for (const r of world.rooms) {
    if (r.id !== 'wc') continue;
    paintClosedRoom(ctx, r);
    const d = world.wcDoor;
    if (d) wcDoorSign(ctx, d.x, d.y);
  }

  // trang trí tường (theo bản đồ chuẩn; bỏ qua nếu không khớp)
  let clock = null;
  if (W === 60 && H === 34) {
    // băng rôn: chọn đoạn tường trống dài nhất ở hàng y=7 (x 1..17), không có cửa, không bị tủ locker che
    const span = bannerSpan(world, 7, 1, 17);
    if (span) banner(ctx, span[0] + 0.2, span[1] - 0.2, 7, 'CHÚNG TA LÀ MỘT GIA ĐÌNH ❤');
    if (world.isWall(16, 7)) { clockFace(ctx, 16.5, 7.6, 0.38); clock = { x: 16.5, y: 7.6, r: 0.38 }; }
    if (world.isWall(50, 22) && world.isWall(54, 22)) chalkboard(ctx, 49.6, 54.4, 22);
    if (world.isWall(57, 0)) calligraphy(ctx, 56.15, 57.85, 0);
  }

  // thảm chùi chân + sofa (phần mặt ngồi, phẳng)
  for (const f of world.furniture) {
    if (f.type === 'door_mat') {
      fillRR(ctx, f.x + 0.1, f.y + 0.08, f.w - 0.2, f.h - 0.16, 0.08, '#8c6a46');
      fillRR(ctx, f.x + 0.16, f.y + 0.14, f.w - 0.32, f.h - 0.28, 0.06, '#b08a5c');
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(70,45,25,0.75)';
      ctx.font = `800 ${Math.min(0.24, f.w * 0.3)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('XIN CHÀO', 0, 0);
      ctx.restore();
    }
  }

  // nhãn phòng: không nướng vào layer — office.js vẽ mỗi khung bằng drawRoomLabels() (cỡ chữ theo px màn hình)

  return { canvas: cv, T, dpr, x0: -M, y0: -M, w: W + 2 * M, h: H + 2 * M, clock };
}
