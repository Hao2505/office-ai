// Hiệu ứng: ánh sáng ngày/đêm, đèn bàn ban đêm, sự cố sập server / mất wifi, phòng sếp khi vắng.
import { clamp, lerp } from '../util.js';
import { FONT, EMOJI_FONT } from './draw.js';

const TINT_KEYS = [
  [0, [104, 116, 188]],
  [300, [104, 116, 188]],
  [400, [150, 136, 190]],
  [440, [255, 214, 188]],
  [480, [255, 238, 224]],
  [525, [255, 255, 255]],
  [1000, [255, 255, 255]],
  [1050, [255, 237, 216]],
  [1095, [250, 208, 180]],
  [1130, [188, 168, 210]],
  [1175, [108, 120, 190]],
  [1440, [104, 116, 188]],
];

export function tintAt(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  for (let i = 1; i < TINT_KEYS.length; i++) {
    const [m1, c1] = TINT_KEYS[i];
    if (m <= m1) {
      const [m0, c0] = TINT_KEYS[i - 1];
      const k = m1 === m0 ? 0 : (m - m0) / (m1 - m0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return [255, 255, 255];
}

/** 0 = ban ngày, 1 = đêm hẳn */
export function darkness(minute) {
  const c = tintAt(minute);
  const l = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
  return clamp((1 - l) / 0.42, 0, 1);
}

/** phủ màu nhân (multiply) lên vùng bản đồ — đang ở hệ toạ độ ô */
export function drawTint(ctx, minute, x, y, w, h) {
  const c = tintAt(minute);
  if (c[0] > 252 && c[1] > 252 && c[2] > 252) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** các nguồn sáng (đèn bàn, màn hình) khi trời tối — cộng sáng */
export function drawLights(ctx, lights, dark) {
  if (dark < 0.05 || !lights.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const r = l.r;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
    const a = clamp(l.a * dark, 0, 1);
    g.addColorStop(0, l.color.replace('ALPHA', a.toFixed(3)));
    g.addColorStop(1, l.color.replace('ALPHA', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** báo động phòng server (hệ toạ độ ô) */
export function drawServerAlarm(ctx, room, t) {
  if (!room) return;
  const p = (Math.sin(t / 180) + 1) / 2;
  ctx.save();
  // chỉ trong phòng server (kể cả tường bao)
  ctx.beginPath();
  ctx.rect(room.x - 1, room.y - 1, room.w + 2, room.h + 2);
  ctx.clip();
  ctx.fillStyle = `rgba(239,68,68,${(0.12 + p * 0.16).toFixed(3)})`;
  ctx.fillRect(room.x - 1, room.y - 1, room.w + 2, room.h + 2);
  // đèn xoay
  const cx = room.x + room.w / 2, cy = room.y + 0.5;
  const ang = (t / 400) % (Math.PI * 2);
  ctx.globalCompositeOperation = 'lighter';
  for (const off of [0, Math.PI]) {
    const a = ang + off;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
    g.addColorStop(0, 'rgba(255,80,60,0.45)');
    g.addColorStop(1, 'rgba(255,80,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 6, a - 0.35, a + 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, 0.18, 0, Math.PI * 2);
  ctx.fillStyle = p > 0.5 ? '#ff3b30' : '#b91c1c';
  ctx.fill();
}

/** viền đỏ nhấp nháy quanh canvas (px CSS) */
export function drawAlarmVignette(ctx, w, h, t) {
  const p = (Math.sin(t / 180) + 1) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(239,68,68,0)');
  g.addColorStop(1, `rgba(239,68,68,${(0.08 + p * 0.14).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** lửa trên tủ server (px CSS) */
export function drawFlames(ctx, pts, t, size) {
  ctx.save();
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  pts.forEach((p, i) => {
    const s = 1 + Math.sin(t / 120 + i * 1.7) * 0.12;
    ctx.save();
    ctx.translate(p.x, p.y + Math.sin(t / 200 + i) * 2);
    ctx.scale(s, s);
    ctx.fillText('🔥', 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

/** nhãn nổi (px CSS) */
export function drawFloatLabel(ctx, x, y, text, bg, fg, t, pulse = true) {
  ctx.save();
  ctx.font = `800 12px ${FONT}`;
  const w = ctx.measureText(text).width + 20, h = 24;
  const s = pulse ? 1 + Math.sin(t / 160) * 0.04 : 1;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, 12) : ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

/** làm tối phòng sếp khi vắng (hệ toạ độ ô) */
export function dimRoom(ctx, room, a = 0.3) {
  if (!room) return;
  ctx.save();
  ctx.fillStyle = `rgba(22,26,46,${a})`;
  ctx.fillRect(room.x, room.y - 0.05, room.w, room.h + 0.05);
  ctx.restore();
}
