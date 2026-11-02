// Canvas văn phòng: camera (thu phóng/kéo), cache layer tĩnh + sprite nội thất, vòng requestAnimationFrame,
// sắp xếp theo y (nội thất + ghế + nhân vật), lớp phủ chữ (tên, emote, bong bóng), hiệu ứng.
// v2: nhân vật to (setCharacterScale), phòng trưng bày (setProducts + onProductHover/onProductClick),
// WC kín (flag 8 = ẩn, biển "Có người"), bảng trắng / bảng KPI / đồng hồ / biển cửa sếp theo dữ liệu thật.
import { store, actorPos } from '../store.js';
import { clamp, lerp, safeColor, initial as initialOf, noAccent, capFirst, str, num, fmtNum } from '../util.js';
import { prepareWorld } from './world.js';
import { renderFloorLayer } from './floor.js';
import {
  buildSprites, deskGeom, bossDeskGeom, kpiGeom, whiteboardGeom, tvGeom, rackGeom, coffeeGeom, shelfGeom, podiumGeom,
  drawChairBase, drawChairBack, steam,
} from './furniture.js';
import { drawScreen, screenGlow, drawTvScreen } from './screens.js';
import { drawCharacter, U, headTop, headCenter, HEAD_RADIUS, moodOf } from './character.js';
import { drawBubbles, drawEmote, drawNamePill, drawSign, measureNamePill, spreadPills, clearTextCache } from './bubbles.js';
import {
  tintAt, drawTint, darkness, drawLights, drawServerAlarm, drawAlarmVignette, drawFlames, drawFloatLabel, dimRoom,
} from './fx.js';
import { slackScreenKind, workScreenKind, bossAwayLabel } from '../labels.js';
import { FONT, EMOJI_FONT, fillRR, rect, circle, line, fitText, makeCanvas } from './draw.js';
import { sanitizeProducts, drawShelfProducts, drawPodiumProduct, shelfOfType, shelfProducts } from './showroom.js';

const MAX_CACHE_SCALE = 64; // px thiết bị / ô tối đa cho layer cache
const FEET_Y = 0.84; // điểm chân trong ô
const DESK_ACTS = new Set(['working', 'slacking', 'napping', 'boss_office']);
const FLAG_WALK = 1, FLAG_PHONE = 2, FLAG_SCENE = 4, FLAG_HIDDEN = 8;
const DEFAULT_CHAR_SCALE = 1; // nhân vật ≈ 1.95 ô (character.js) × tỉ lệ này

export function createOffice(canvas, hooks = {}) {
  const ctx = canvas.getContext('2d');
  let world = null;
  let logoText = 'VIBECORP';
  let layer = null;
  let sprites = [];
  let cacheKey = '';
  let cacheTimer = 0;
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let cssW = 1, cssH = 1;
  let fitT = 16, T = 16, ox = 0, oy = 0;
  const cam = { zoom: 1, cx: 30, cy: 17, userMoved: false };
  let lastInteract = 0;
  let hits = [];
  let hoverId = null;
  let raf = 0;
  let doorOpen = 0;
  let bossDoor = null;
  let deskInfo = new Map();
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let charScale = DEFAULT_CHAR_SCALE;
  // vùng bị HUD (mép trên) / dải ticker (mép dưới) che: bong bóng, emote né ra; bản đồ căn vào phần còn lại
  const insets = { top: 0, bottom: 0 };
  let bandTop = 0, bandBottom = 0;
  // bảng KPI / bảng trắng đang rê chuột (tooltip DOM qua hook onBoardHover)
  let hoverBoard = null;
  // phòng trưng bày
  let products = [];
  let productHits = []; // {x,y,w,h,product} toạ độ ô (kệ: cố định; bục: cập nhật mỗi khung)
  const podiumHit = { x: 0, y: 0, w: 0, h: 0, product: null };
  let hoverProduct = null;
  let wcBusy = false;
  // sprite động (bảng KPI, bảng trắng): vẽ lại khi nội dung đổi
  const dyn = new Map();

  // ---------------------------------------------------------------- kích thước & camera
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (w === cssW && h === cssH && nd === dpr && canvas.width === Math.round(w * dpr)) return;
    cssW = w; cssH = h; dpr = nd;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (world) {
      computeFit();
      if (!cam.userMoved) defaultView();
      clampCam();
    }
  }

  function computeFit() {
    const t0 = Math.max(3, Math.min(cssW / (world.W + 0.6), cssH / (world.H + 1.3)));
    // HUD / ticker được phép đè lên lề + tường ngoài toà nhà (không có nội dung), phần còn lại thì né
    bandTop = Math.max(0, insets.top - 1.2 * t0);
    bandBottom = Math.max(0, insets.bottom - 1.0 * t0);
    fitT = Math.max(3, Math.min(cssW / (world.W + 0.6), bandH() / (world.H + 1.3)));
  }
  const bandH = () => Math.max(40, cssH - bandTop - bandBottom);
  const bandCy = () => bandTop + bandH() / 2;

  function maxZoom() {
    return Math.max(2.2, 40 / fitT);
  }

  function defaultView() {
    // điện thoại: phóng to vừa đủ để đọc tên (≥ 13 px/ô), nhìn khu làm việc, kéo để xem chỗ khác
    const tall = bandH() / (world.H + 1.3);
    if (cssW < 640) {
      cam.zoom = clamp(Math.max(tall, 13) / fitT, 1, maxZoom());
      cam.cx = world.W * 0.32;
    } else {
      cam.zoom = 1;
      cam.cx = world.W / 2;
    }
    cam.cy = (world.H + 0.25) / 2;
  }

  function currentT() {
    return Math.max(2, Math.floor(fitT * cam.zoom * dpr) / dpr);
  }

  function clampCam() {
    T = currentT();
    const W = world.W, H = world.H;
    const halfW = cssW / 2 / T, halfH = bandH() / 2 / T;
    if (W + 0.6 <= halfW * 2) cam.cx = W / 2;
    else cam.cx = clamp(cam.cx, halfW - 0.4, W + 0.4 - halfW);
    if (H + 1.3 <= halfH * 2) cam.cy = (H + 0.25) / 2;
    else cam.cy = clamp(cam.cy, halfH - 0.6, H + 0.9 - halfH);
    ox = Math.round((cssW / 2 - cam.cx * T) * dpr) / dpr;
    oy = Math.round((bandCy() - cam.cy * T) * dpr) / dpr;
  }

  function zoomAt(factor, sx, sy) {
    if (!world) return;
    const before = toTile(sx, sy);
    cam.zoom = clamp(cam.zoom * factor, 1, maxZoom());
    T = currentT();
    // giữ điểm dưới con trỏ đứng yên
    cam.cx = before.x - (sx - cssW / 2) / T;
    cam.cy = before.y - (sy - bandCy()) / T;
    cam.userMoved = true;
    lastInteract = performance.now();
    clampCam();
    scheduleCache();
  }

  function toTile(sx, sy) {
    return { x: (sx - ox) / T, y: (sy - oy) / T };
  }

  // ---------------------------------------------------------------- cache
  function cacheScale() {
    return Math.min(T * dpr, MAX_CACHE_SCALE);
  }

  function rebuildCaches() {
    if (!world) return;
    const s = cacheScale();
    const Tc = s / dpr;
    layer = renderFloorLayer(world, Tc, dpr, { logoText });
    sprites = buildSprites(world, Tc, dpr);
    dyn.clear();
    cacheKey = `${s}`;
  }

  function scheduleCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      cacheTimer = 0;
      if (`${cacheScale()}` !== cacheKey) rebuildCaches();
    }, 180);
  }

  /** sprite động: vẽ lại khi key đổi (nội dung / tỉ lệ), còn lại chỉ drawImage */
  function dynSprite(name, key, x0, y0, w, h, paint) {
    const s = cacheScale();
    let e = dyn.get(name);
    const k = `${key}|${s}`;
    if (!e || e.key !== k) {
      const cv = e && e.canvas.width === Math.ceil(w * s) && e.canvas.height === Math.ceil(h * s) ? e.canvas : makeCanvas(w * s, h * s);
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      try { paint(c); } catch (err) { if (!dynSprite.warned) { console.warn('[văn phòng] lỗi vẽ bảng', name, err); dynSprite.warned = true; } }
      e = { key: k, canvas: cv, x0, y0, w, h };
      dyn.set(name, e);
    }
    ctx.drawImage(e.canvas, e.x0, e.y0, e.w, e.h);
  }

  // ---------------------------------------------------------------- dữ liệu bản đồ
  function setMap(raw, companyName) {
    const w = prepareWorld(raw);
    if (!w) return false;
    world = w;
    logoText = logoFrom(companyName);
    // cửa phòng sếp (để treo biển)
    bossDoor = null;
    const br = w.bossRoom;
    if (br) {
      const doors = [];
      for (let y = br.y - 1; y <= br.y + br.h; y++) {
        for (let x = br.x - 1; x <= br.x + br.w; x++) if (w.at(x, y) === 'D') doors.push({ x, y });
      }
      if (doors.length) {
        const ax = doors.reduce((s, d) => s + d.x, 0) / doors.length;
        const ay = doors.reduce((s, d) => s + d.y, 0) / doors.length;
        bossDoor = { x: ax + 0.5, y: ay };
      } else bossDoor = { x: br.x + br.w / 2, y: br.y + br.h };
    }
    rebuildProductHits();
    resizeForce();
    rebuildCaches();
    return true;
  }

  /** logo sàn: bỏ "Cty TNHH / Công ty CP ..." rồi viết hoa; mặc định VIBECORP */
  function logoFrom(companyName) {
    const t = String(companyName || '').replace(/^(cty|công ty|c\.ty)\s*(tnhh|cp|cổ phần|mtv)?\s*/i, '').trim().toUpperCase().slice(0, 22);
    return t || 'VIBECORP';
  }

  function resizeForce() {
    cssW = 0;
    resize();
    if (world) { computeFit(); if (!cam.userMoved) defaultView(); clampCam(); }
  }

  // ---------------------------------------------------------------- sản phẩm (phòng trưng bày)
  function setProducts(list) {
    products = sanitizeProducts(list);
    rebuildProductHits();
    if (hoverProduct && !products.some((p) => p.id === hoverProduct.id)) setHoverProduct(null, 0, 0);
  }

  function rebuildProductHits() {
    productHits = [];
    if (!world || !products.length) return;
    for (const f of world.furniture) {
      const shelf = shelfOfType(f.type);
      if (!shelf) continue;
      const g = shelfGeom(f);
      const list = shelfProducts(products, shelf);
      for (let i = 0; i < list.length && i < g.slots.length; i++) {
        const sl = g.slots[i];
        productHits.push({ x: sl.x - 0.04, y: sl.y - 0.06, w: sl.w + 0.08, h: sl.h + g.labelH + 0.3, product: list[i] });
      }
    }
  }

  function pickProduct(sx, sy) {
    if (!world) return null;
    const t = toTile(sx, sy);
    for (let i = 0; i < productHits.length; i++) {
      const h = productHits[i];
      if (t.x >= h.x && t.x <= h.x + h.w && t.y >= h.y && t.y <= h.y + h.h) return h.product;
    }
    const p = podiumHit;
    if (p.product && t.x >= p.x && t.x <= p.x + p.w && t.y >= p.y && t.y <= p.y + p.h) return p.product;
    return null;
  }

  function setHoverProduct(p, clientX, clientY) {
    const changed = (p ? p.id : null) !== (hoverProduct ? hoverProduct.id : null);
    hoverProduct = p;
    if (p || changed) hooks.onProductHover?.(p || null, clientX, clientY);
    if (changed) updateCursor();
  }

  /** bảng KPI / bảng trắng dưới con trỏ (chữ trên bảng nhỏ -> UI hiện tooltip đọc được) */
  function pickBoard(sx, sy) {
    if (!world) return null;
    const t = toTile(sx, sy);
    for (const f of world.furniture) {
      if (f.type === 'kpi_board') {
        const p = kpiGeom(f).panel;
        if (t.x >= p.x && t.x <= p.x + p.w && t.y >= p.y && t.y <= p.y + p.h) return 'kpi';
      } else if (f.type === 'whiteboard') {
        const b = whiteboardGeom(f).board;
        if (t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h) return 'whiteboard';
      }
    }
    return null;
  }

  function setHoverBoard(kind, clientX, clientY) {
    const changed = kind !== hoverBoard;
    hoverBoard = kind;
    if (kind || changed) hooks.onBoardHover?.(kind || null, clientX, clientY);
    if (changed) updateCursor();
  }

  function updateCursor() {
    canvas.style.cursor = hoverProduct || hoverId || hoverBoard ? 'pointer' : (cam.zoom > 1.01 ? 'grab' : 'default');
  }

  /** vùng HUD (trên) / ticker (dưới) đè lên canvas, px CSS — UI gọi khi kích thước đổi */
  function setInsets(o) {
    const t = Math.max(0, num(o?.top, 0)), b = Math.max(0, num(o?.bottom, 0));
    if (t === insets.top && b === insets.bottom) return;
    insets.top = t; insets.bottom = b;
    if (!world) return;
    computeFit();
    if (!cam.userMoved) defaultView();
    clampCam();
    scheduleCache();
  }

  // ---------------------------------------------------------------- vẽ
  function frame() {
    raf = requestAnimationFrame(frame);
    // Dùng CÙNG đồng hồ với store (performance.now() lúc nhận frame/log). Mốc thời gian của rAF có thể lệch
    // performance.now() (Chrome headless --virtual-time-budget, tab vừa thức dậy…) -> alpha "hiện dần" của nhân vật
    // kẹt ở mức nửa trong suốt, bong bóng thoại hiện sai lúc.
    const now = performance.now();
    try {
      draw(now);
    } catch (e) {
      if (!frame.warned) { console.error('[văn phòng] lỗi vẽ', e); frame.warned = true; }
    }
  }

  function draw(now) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!world || !layer) return;
    followCamera(now);
    clampCam();
    if (`${cacheScale()}` !== cacheKey && !cacheTimer) scheduleCache();

    const k = T * dpr;
    const minute = store.clock ? store.clock.minute : 600;
    const status = store.status;
    const incident = status?.company?.incident || null;
    const bossAway = !!status?.bossAway;

    // ---- layer tĩnh
    ctx.setTransform(k, 0, 0, k, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer.canvas, layer.x0, layer.y0, layer.w, layer.h);
    drawWallClock(minute);
    drawEntrance(now);
    // biển "Có người / Trống" nằm TRÊN cửa WC nhưng DƯỚI nhân vật đang đứng trước cửa
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWcIndicator(now);
    ctx.restore();

    // ---- chuẩn bị actor
    const acts = prepareActors(now);
    computeDeskInfo(acts);

    // ---- danh sách vẽ theo y
    const items = [];
    const view = { x0: -ox / T - 2, y0: -oy / T - 3, x1: (cssW - ox) / T + 2, y1: (cssH - oy) / T + 3 };
    for (const sp of sprites) {
      if (sp.x0 > view.x1 || sp.x0 + sp.w < view.x0 || sp.y0 > view.y1 || sp.y0 + sp.h < view.y0) continue;
      items.push(sp);
    }
    for (const d of world.desks) {
      const info = deskInfo.get(d.id);
      const occ = info?.seated ? info.actor : null;
      const facing = occ ? occ.viewDir : d.facing;
      const style = d.boss ? 'boss' : 'desk';
      // ghế trống: đẩy sát vào bàn
      const dy = occ ? 0 : d.facing === 'up' ? -0.32 : d.facing === 'down' ? 0.14 : 0;
      items.push({ kind: 'chair', key: d.seat.y + 0.45, x: d.seat.x, y: d.seat.y, dy, style, facing, part: 'base' });
      if (facing === 'up') items.push({ kind: 'chair', key: d.seat.y + 0.56, x: d.seat.x, y: d.seat.y, dy, style, facing, part: 'back' });
    }
    for (const c of world.chairs) {
      items.push({ kind: 'chair', key: c.y + 0.45, x: c.x, y: c.y, dy: 0, style: c.style, facing: c.facing, part: 'base' });
      if (c.facing === 'up') items.push({ kind: 'chair', key: c.y + 0.56, x: c.x, y: c.y, dy: 0, style: c.style, facing: c.facing, part: 'back' });
    }
    for (const a of acts) {
      if (a.x + 1.2 < view.x0 || a.x - 1.2 > view.x1 || a.y + 1 < view.y0 || a.y - 2.5 > view.y1) continue;
      items.push({ kind: 'actor', key: a.y + 0.5 + (a.pose === 'beanbag' ? 0.1 : 0), a });
    }
    items.sort((p, q) => p.key - q.key || (p.kind === 'actor') - (q.kind === 'actor'));

    const env = { now, minute, incident, wifiDown: incident === 'wifi_down', acts };
    for (const it of items) {
      if (it.kind === 'furn') {
        ctx.drawImage(it.canvas, it.x0, it.y0, it.w, it.h);
        overlay(it.f, env);
      } else if (it.kind === 'chair') {
        const cx = it.x + 0.5, cy = it.y + 0.9 + (it.dy || 0);
        if (it.part === 'base') drawChairBase(ctx, cx, cy, it.style, it.facing);
        else drawChairBack(ctx, cx, cy, it.style, it.facing, false);
      } else {
        drawActor(it.a, now);
      }
    }
    drawPingpongBall(acts, now);

    // ---- hiệu ứng thế giới
    if (bossAway && world.bossRoom) dimRoom(ctx, world.bossRoom, 0.3);
    if (incident === 'server_down') drawServerAlarm(ctx, world.serverRoom, now);
    const dark = darkness(minute);
    drawTint(ctx, minute, 0, 0, world.W, world.H + 0.45);
    if (dark > 0.05) drawLights(ctx, collectLights(acts, now), dark);
    syncStageTint(minute);

    // ---- lớp phủ màn hình (px CSS)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (incident === 'server_down') {
      drawAlarmVignette(ctx, cssW, cssH, now);
      const sr = world.serverRoom;
      if (sr) {
        const pts = [];
        for (const f of world.furniture) if (f.type === 'rack') for (let i = 0; i < 3; i++) pts.push({ x: ox + (f.x + 0.9 + i * (f.w - 1.8) / 2) * T, y: oy + (f.y + 0.55) * T });
        drawFlames(ctx, pts, now, clamp(T * 0.8, 12, 30));
        drawFloatLabel(ctx, ox + (sr.x + sr.w / 2) * T, oy + (sr.y + sr.h + 0.4) * T, '🔥 SẬP SERVER!', '#ef4444', '#ffffff', now);
      }
    }
    if (incident === 'wifi_down' && world.workRoom) {
      const wr = world.workRoom;
      drawFloatLabel(ctx, ox + (wr.x + wr.w * 0.5) * T, oy + (wr.y + 3.2) * T + Math.sin(now / 400) * 3, '📶❌ Mất wifi — cả văn phòng đứng hình', '#f59e0b', '#ffffff', now);
    }
    if (bossAway && bossDoor) {
      const [bi, bt] = bossAwayLabel(status?.bossNote);
      drawSign(ctx, ox + bossDoor.x * T, oy + (bossDoor.y + 0.75) * T, `${bi} ĐI VẮNG`, awayReason(bt, status?.bossNote), { hang: true, sway: true, t: now, size: clamp(T * 0.62, 10.5, 13.5), subMax: clamp(T * 9, 150, 220) });
    }
    drawOverlays(acts, now);
  }

  /** lý do trên biển "ĐI VẮNG": ghi chú của server (bỏ chữ "Sếp"), nếu trống thì dùng nhãn (Sếp chưa đến / đã về…) */
  function awayReason(title, note) {
    const s = String(note || '').trim();
    if (!s) return title === 'Sếp đi vắng' ? '' : title;
    return capFirst(s.replace(/^sếp\s+/i, '').replace(/^(đang|đã|vừa)\s+/i, (m) => m)).slice(0, 120);
  }

  let stageTintKey = '';
  /** màu nền sân khấu (CSS) đổi theo giờ, khớp với màu phủ trên toà nhà */
  function syncStageTint(minute) {
    const key = tintAt(minute).map((v) => Math.round(v / 3) * 3).join(',');
    if (key === stageTintKey) return;
    stageTintKey = key;
    canvas.parentElement?.style.setProperty('--stage-tint', `rgb(${key})`);
  }

  // ---------------------------------------------------------------- actor
  function prepareActors(now) {
    const out = [];
    let busy = false;
    for (const a of store.actors.values()) {
      if (a.bornAt > now) a.bornAt = now;
      let alpha = clamp((now - a.bornAt) / 420, 0, 1);
      if (a.goneAt) {
        alpha = Math.min(alpha, 1 - clamp((now - a.goneAt) / 480, 0, 1));
        if (now - a.goneAt > 520) { store.actors.delete(a.id); continue; }
      }
      // trong WC (flag 8): không vẽ, chỉ bật biển "Có người"
      if ((a.flags & FLAG_HIDDEN) !== 0) {
        if (a.activity === 'toilet' || a.activity === 'wc') busy = true;
        a.alpha = 0;
        continue;
      }
      const agent = store.agents.get(a.id) || null;
      // chưa biết ngoại hình (agent mới, danh sách 'agents' chưa tới) -> tạm ẩn, hiện dần khi có
      if (!agent && !store.lookCache.has(a.id)) { a.unknown = true; continue; }
      if (a.unknown) { a.unknown = false; a.bornAt = now; alpha = 0; }
      const p = actorPos(a, now);
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      a.x = p.x; a.y = p.y;
      const walking = (a.flags & FLAG_WALK) !== 0;
      // đang đi: có dịch chuyển giữa 2 khung vẽ, hoặc cờ "đang đi" + đang ở giữa một đoạn nội suy (a.dur > 0)
      a.moveAmt = lerp(a.moveAmt || 0, d > 0.0008 || (walking && a.dur > 0) ? 1 : 0, 0.35);
      if (d > 0.0008) a.phase += d * 9.5;
      else if (a.moveAmt < 0.3) a.phase = lerp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 0.2);
      const near = Math.abs(a.x - Math.round(a.x)) < 0.14 && Math.abs(a.y - Math.round(a.y)) < 0.14;
      const seat = near && a.moveAmt < 0.5 ? world.seatAt(a.x, a.y) : null;
      let pose = 'stand';
      let dir = a.dir;
      if (seat) {
        pose = seat.kind === 'beanbag' ? 'beanbag' : 'sit';
        if (seat.kind === 'sofa' && !(a.flags & FLAG_SCENE) && (dir === 'down')) dir = 'up';
        if (seat.kind === 'desk' && !(a.flags & FLAG_SCENE) && DESK_ACTS.has(a.activity)) dir = seat.facing;
      }
      a.pose = pose;
      a.viewDir = dir;
      a.seat = seat;
      a.alpha = alpha;
      a.agent = agent;
      out.push(a);
    }
    wcBusy = busy;
    return out;
  }

  function holdFor(a) {
    const act = a.activity;
    if (act === 'coffee') return 'cup';
    if (act === 'water') return 'water';
    if (act === 'pingpong') return 'paddle';
    if (act === 'printing') return 'paper';
    if (act === 'showroom' && a.agent?.role === 'marketing') return 'bag';
    if (act === 'window' && /sales/.test(a.agent?.role || '')) return 'phone';
    if ((a.flags & FLAG_PHONE) || act === 'slacking') return 'phone';
    return null;
  }

  function drawActor(a, now) {
    const look = a.agent?.look || store.look(a.id);
    if (!look || a.alpha <= 0.001) return;
    const fx = a.x + 0.5, fy = a.y + FEET_Y;
    const talking = store.bubbles.some((b) => b.speaker === a.id && now - b.t0 < b.dur);
    if (a.id === hoverId) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(fx, fy + 0.02, 0.5 * charScale, 0.19 * charScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,122,69,0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,122,69,0.95)';
      ctx.lineWidth = 0.05;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.translate(fx, fy);
    ctx.scale(charScale / U, charScale / U);
    const fired = a.agent?.status === 'fired' || a.emote === '📦';
    drawCharacter(ctx, look, {
      dir: a.viewDir,
      pose: a.pose,
      moving: a.moveAmt > 0.5,
      phase: a.phase,
      t: now,
      seed: a.seed,
      mood: moodOf(a.emote, a.activity),
      talking,
      blink: (now + a.seed * 997) % 4300 < 130,
      typing: a.activity === 'working' && a.pose === 'sit' && a.seat?.kind === 'desk',
      napping: a.activity === 'napping' && a.pose === 'sit',
      hold: fired ? null : holdFor(a),
      carry: fired,
      blazer: a.agent?.role === 'boss' || a.agent?.role === 'saleslead',
      badge: a.agent?.status === 'candidate' ? '#f97316' : null,
      panic: a.activity === 'server_fix' || (a.emote === '😰' && now - a.emoteAt < 2600),
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- bàn làm việc
  function computeDeskInfo(acts) {
    const byId = new Map(acts.map((a) => [a.id, a]));
    const m = new Map();
    for (const d of world.desks) {
      const owner = store.deskOwner(d.id);
      let actor = owner ? byId.get(owner.id) : null;
      let seated = false;
      if (actor) seated = Math.abs(actor.x - d.seat.x) < 0.2 && Math.abs(actor.y - d.seat.y) < 0.2 && actor.moveAmt < 0.5;
      // người khác ngồi nhờ ghế (hiếm)
      if (!seated) {
        const other = acts.find((a) => a.seat && a.seat.deskId === d.id);
        if (other) { actor = other; seated = true; }
      }
      m.set(d.id, { owner, actor, seated });
    }
    deskInfo = m;
  }

  function deskScreenKind(d, info) {
    const { owner, actor, seated } = info;
    if (!owner || !owner.present || !actor) return 'off';
    if (!seated || actor.id !== owner.id) return 'lock';
    let act = actor.activity, emote = actor.emote;
    if (!(act === 'working' || act === 'slacking' || act === 'napping') && actor.deskAct) {
      act = actor.deskAct.activity; emote = actor.deskAct.emote;
    }
    if (act === 'napping') return 'sleep';
    if (act === 'slacking') return slackScreenKind(owner.activityLabel, emote);
    return workScreenKind(owner.role);
  }

  // ---------------------------------------------------------------- overlays động của nội thất
  function overlay(f, env) {
    const { now } = env;
    switch (f.type) {
      case 'desk': {
        const d = world.deskById.get(f.owner);
        const info = d ? deskInfo.get(d.id) : null;
        const g = deskGeom(f);
        const kind = info ? deskScreenKind(d, info) : 'off';
        drawScreen(ctx, kind, g.screen, now, (f.x * 7 + f.y * 13) % 97, { wifiDown: env.wifiDown });
        const item = info?.owner?.deskItem;
        if (item && item.emoji) {
          ctx.font = `0.42px ${EMOJI_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(item.emoji).slice(0, 4), g.item.x, g.item.y);
        }
        break;
      }
      case 'kpi_board': drawKpiBoard(f); break;
      case 'whiteboard': drawWhiteboard(f); break;
      case 'shelf_beauty': case 'shelf_tech':
        // nhãn tên dưới thẻ chỉ vẽ khi đủ to để đọc (khi thu nhỏ chỉ thành vệt mờ)
        if (products.length) drawShelfProducts(ctx, f, products, hoverProduct ? hoverProduct.id : null, null, { labels: T >= 34 });
        break;
      case 'display_table': {
        const tmp = podiumTmp;
        tmp.length = 0;
        drawPodiumProduct(ctx, f, products, now, hoverProduct ? hoverProduct.id : null, tmp);
        if (tmp.length) { const r = tmp[0]; podiumHit.x = r.x; podiumHit.y = r.y; podiumHit.w = r.w; podiumHit.h = r.h; podiumHit.product = r.product; }
        else podiumHit.product = null;
        break;
      }
      case 'tv': drawTvScreen(ctx, tvGeom(f).screen, now); break;
      case 'rack': drawRackLeds(f, env); break;
      case 'coffee_machine': {
        const g = coffeeGeom(f);
        const busy = env.acts.some((a) => a.activity === 'coffee');
        steam(ctx, g.spout.x, g.spout.y, now, busy ? 1 : 0.45);
        break;
      }
      case 'printer': {
        const busy = env.acts.some((a) => a.activity === 'printing' && Math.abs(a.x - (f.x + 0.5)) < 2.5 && Math.abs(a.y - f.y) < 2.5);
        if (busy) {
          const p = (now % 1400) / 1400;
          rect(ctx, f.x + 0.45, f.y + 0.9 - 0.5 + p * 0.25, f.w - 0.9, 0.08 + p * 0.22, '#ffffff');
          circle(ctx, f.x + f.w - 0.3, f.y + 0.18 - 0.62 + 0.65, 0.04, Math.floor(now / 250) % 2 ? '#22c55e' : '#065f46');
        }
        break;
      }
      case 'water': {
        const busy = env.acts.some((a) => a.activity === 'water' && Math.abs(a.x - f.x) < 2.5 && Math.abs(a.y - f.y) < 2.5);
        if (busy) {
          const by = f.y + 0.22 - 0.86;
          for (let k2 = 0; k2 < 3; k2++) {
            const p = ((now / 900) + k2 / 3) % 1;
            circle(ctx, f.x + 0.42 + k2 * 0.08, by - 0.05 - p * 0.45, 0.035, 'rgba(255,255,255,0.8)');
          }
        }
        break;
      }
      default: break;
    }
  }
  const podiumTmp = [];

  /** bảng KPI: cột theo nhân viên (% + màu), chấm màu áo + chữ cái đầu (tên khi phóng to), dòng doanh thu */
  function drawKpiBoard(f) {
    const g = kpiGeom(f);
    const list = store.roster().filter((a) => a.status === 'active');
    const co = store.status?.company;
    const rev = Math.round(num(co?.revenueMonth, 0)), target = Math.round(num(co?.revenueTarget, 0));
    const lowRatio = store.rules.kpiLowRatio;
    let key = `${rev}/${target}|${lowRatio}|${T >= 30 ? 'n' : 'i'}`;
    for (const a of list) key += `|${a.id}:${Math.round(100 * (a.kpiTarget > 0 ? a.kpiToday / a.kpiTarget : 0))}:${a.look?.shirt}`;
    const p = g.panel;
    dynSprite('kpi', key, p.x - 0.2, p.y - 0.2, p.w + 0.4, p.h + 0.4, (c) => {
      const n = list.length;
      const ch = g.chart;
      if (n) {
        const slot = ch.w / n;
        const bw = Math.min(0.56, slot * 0.58);
        const showNames = T >= 30 && slot >= 0.75;
        for (let i = 0; i < n; i++) {
          const a = list[i];
          const ratio = a.kpiTarget > 0 ? a.kpiToday / a.kpiTarget : 0;
          const r = clamp(ratio, 0, 1.25);
          const h = Math.min(Math.max(0.04, r * g.full), ch.h - 0.06);
          const x = ch.x + slot * i + (slot - bw) / 2;
          const color = ratio >= 1 ? '#22c55e' : ratio >= lowRatio ? '#f59e0b' : '#ef4444';
          fillRR(c, x, g.base - h, bw, h, [0.07, 0.07, 0, 0], color);
          rect(c, x + bw * 0.15, g.base - h + 0.04, bw * 0.2, Math.max(0, h - 0.08), 'rgba(255,255,255,0.3)');
          // % trên đầu cột (cột quá cao -> ghi vào trong cột để không đè tiêu đề)
          const inside = h > g.full * 1.02;
          const pctText = `${Math.round(ratio * 100)}%`;
          c.fillStyle = inside ? '#ffffff' : color === '#f59e0b' ? '#b45309' : color;
          // chữ trắng trong cột phải nằm gọn trong bề rộng cột (tràn ra nền trắng là mất chữ)
          const fsz = inside ? Math.min(0.23, (bw - 0.04) / (pctText.length * 0.58)) : Math.min(0.3, slot * 0.42);
          c.font = `800 ${fsz.toFixed(3)}px ${FONT}`;
          c.textAlign = 'center';
          c.textBaseline = inside ? 'top' : 'bottom';
          c.fillText(pctText, x + bw / 2, inside ? g.base - h + 0.05 : g.base - h - 0.03);
          // chấm màu áo + chữ cái đầu / tên
          const dotR = Math.min(0.2, slot * 0.3);
          const cy = g.names.y + dotR + 0.02;
          circle(c, x + bw / 2, cy, dotR, safeColor(a.look?.shirt, '#9ca3af'));
          c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.025; c.stroke();
          c.fillStyle = '#ffffff';
          c.font = `800 ${(dotR * 1.3).toFixed(3)}px ${FONT}`;
          c.textBaseline = 'middle';
          c.fillText(initialOf(a.name), x + bw / 2, cy + 0.01);
          if (showNames) {
            c.fillStyle = '#374151';
            fitText(c, a.name, x + bw / 2, cy + dotR + 0.1, slot - 0.06, 0.15, 700, '#374151');
          }
        }
      } else {
        c.fillStyle = '#9ca3af';
        c.font = `700 0.22px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Chưa có dữ liệu KPI', ch.x + ch.w / 2, ch.y + ch.h / 2);
      }
      // dòng doanh thu tháng
      const rv = g.revenue;
      const ratio = target > 0 ? clamp(rev / target, 0, 1) : 0;
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.font = `800 0.25px ${FONT}`;
      c.fillStyle = '#9a3412';
      const label = `💰 Doanh thu tháng ${fmtNum(rev)}/${fmtNum(target)} tr`;
      c.fillText(label, rv.x + 0.14, rv.y + rv.h / 2 + 0.01);
      const tw = c.measureText(label).width;
      const bx = rv.x + 0.14 + tw + 0.25, bwid = rv.x + rv.w - 0.14 - bx;
      if (bwid > 0.6) {
        fillRR(c, bx, rv.y + 0.1, bwid, rv.h - 0.2, 0.06, '#fed7aa');
        fillRR(c, bx, rv.y + 0.1, Math.max(0.06, bwid * ratio), rv.h - 0.2, 0.06, ratio >= 1 ? '#22c55e' : '#ff7a45');
        c.textAlign = 'right';
        c.font = `800 0.17px ${FONT}`;
        c.fillStyle = '#7c2d12';
        c.fillText(`${Math.round(ratio * 100)}%`, bx + bwid - 0.06, rv.y + rv.h / 2 + 0.01);
      }
    });
  }

  /** bảng trắng phòng họp: tên dự án + thanh tiến độ % + hạn (dữ liệu từ status.company.project) */
  function drawWhiteboard(f) {
    const g = whiteboardGeom(f);
    const pj = store.status?.company?.project;
    const day = num(store.clock?.day, 1);
    const name = str(pj?.name || '', 60) || 'Chưa có dự án';
    const client = str(pj?.client || '', 60);
    const progress = clamp(num(pj?.progress, 0), 0, 100);
    const deadline = Math.round(num(pj?.deadlineDay, 0));
    const left = deadline - day;
    const key = `${name}|${client}|${Math.round(progress)}|${deadline}|${day}`;
    const d = g.dyn;
    dynSprite('whiteboard', key, d.x - 0.1, d.y - 0.1, d.w + 0.2, d.h + 0.2, (c) => {
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillStyle = '#1d4ed8';
      c.font = `800 0.14px ${FONT}`;
      c.fillText('DỰ ÁN ĐANG CHẠY', d.x, d.y);
      // tên dự án (bút lông xanh đậm), tự co cho vừa
      let fs = 0.34;
      c.font = `800 ${fs}px ${FONT}`;
      while (c.measureText(name).width > d.w - 0.1 && fs > 0.16) { fs -= 0.02; c.font = `800 ${fs}px ${FONT}`; }
      c.fillStyle = '#1e3a8a';
      c.fillText(name, d.x, d.y + 0.2);
      if (client) {
        c.font = `600 0.13px ${FONT}`;
        c.fillStyle = '#475569';
        c.fillText(`Khách: ${client}`, d.x, d.y + 0.2 + fs + 0.04);
      }
      // thanh tiến độ + %
      const by = d.y + d.h - 0.5, bh = 0.26;
      const pctW = 0.9;
      const bw = d.w - pctW - 0.08;
      const col = progress >= 100 ? '#16a34a' : left < 0 ? '#dc2626' : left <= 1 && progress < 85 ? '#f59e0b' : '#2563eb';
      fillRR(c, d.x, by, bw, bh, 0.06, '#e5e7eb');
      fillRR(c, d.x, by, Math.max(0.08, bw * progress / 100), bh, 0.06, col);
      // vạch mốc 25/50/75
      c.fillStyle = 'rgba(255,255,255,0.6)';
      for (const q of [0.25, 0.5, 0.75]) c.fillRect(d.x + bw * q - 0.012, by + 0.04, 0.024, bh - 0.08);
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.font = `800 0.36px ${FONT}`;
      c.fillStyle = col;
      c.fillText(`${Math.round(progress)}%`, d.x + d.w, by + bh / 2 + 0.01);
      // hạn
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.font = `800 0.16px ${FONT}`;
      let dl;
      if (!deadline) dl = '';
      else if (left < 0) dl = `TRỄ HẠN ${-left} NGÀY — hạn ngày ${deadline}`;
      else if (left === 0) dl = `HẠN HÔM NAY (ngày ${deadline})`;
      else dl = `Hạn: ngày ${deadline} · còn ${left} ngày`;
      c.fillStyle = left < 0 ? '#dc2626' : left <= 1 ? '#b45309' : '#374151';
      c.fillText(dl, d.x, by + bh + 0.06);
    });
  }

  function drawRackLeds(f, env) {
    const g = rackGeom(f);
    const down = env.incident === 'server_down';
    const t = env.now;
    for (const l of g.leds) {
      const ph = Math.sin(t / (down ? 90 : 260 + (l.seed % 7) * 60) + l.seed);
      let color;
      if (down) color = ph > 0 ? '#ff3b30' : '#5b0f0f';
      else color = ph > 0.2 ? (l.seed % 5 === 0 ? '#fbbf24' : '#34d399') : '#14532d';
      rect(ctx, l.x, l.y, 0.07, 0.05, color);
    }
  }

  function drawWallClock(minute) {
    const c = layer.clock;
    if (!c) return;
    const m = minute % 60, h = (minute / 60) % 12;
    const ha = (h / 12) * Math.PI * 2 - Math.PI / 2, ma = (m / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.lineCap = 'round';
    line(ctx, c.x, c.y, c.x + Math.cos(ha) * c.r * 0.5, c.y + Math.sin(ha) * c.r * 0.5, '#1f2937', 0.07);
    line(ctx, c.x, c.y, c.x + Math.cos(ma) * c.r * 0.72, c.y + Math.sin(ma) * c.r * 0.72, '#1f2937', 0.045);
    circle(ctx, c.x, c.y, 0.045, '#ef4444');
    ctx.lineCap = 'butt';
  }

  /** biển trạng thái trên cửa WC: "Có người" (đỏ) khi có người bên trong, "Trống" (xanh) khi rảnh */
  function drawWcIndicator(now) {
    const d = world.wcDoor;
    if (!d) return;
    const x = ox + d.x * T, y = oy + (d.y + 0.72) * T;
    const size = clamp(T * 0.42, 8, 11);
    ctx.save();
    ctx.font = `800 ${size}px ${FONT}`;
    const text = wcBusy ? 'Có người' : 'Trống';
    const w = ctx.measureText(text).width + size * 1.9, h = size * 1.55;
    const pulse = wcBusy ? 0.85 + Math.sin(now / 300) * 0.15 : 1;
    ctx.globalAlpha = wcBusy ? 1 : 0.92;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2) : ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = wcBusy ? '#dc2626' : '#15803d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - w / 2 + size * 0.75, y, size * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x - w / 2 + size * 1.3, y + 0.5);
    ctx.restore();
  }

  function drawEntrance(now) {
    if (!world.entrance.length) return;
    const ys = world.entrance.filter((e) => e.x === 0).map((e) => e.y);
    if (!ys.length) return;
    const y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    const cy = (y0 + y1) / 2;
    let near = false;
    for (const a of store.actors.values()) {
      if (Math.abs(a.x - 0.5) < 2.4 && Math.abs(a.y + 0.5 - cy) < 1.8 && !a.goneAt) { near = true; break; }
    }
    doorOpen = lerp(doorOpen, near ? 1 : 0, 0.12);
    const half = (y1 - y0) / 2;
    const slide = doorOpen * (half - 0.08);
    for (const s of [-1, 1]) {
      const py = s < 0 ? y0 - slide : cy + slide;
      fillRR(ctx, 0.3, py + 0.02, 0.4, half - 0.04, 0.03, 'rgba(176,216,236,0.75)');
      rect(ctx, 0.46, py + 0.08, 0.06, half - 0.16, 'rgba(255,255,255,0.6)');
      ctx.strokeStyle = '#8b9aa4';
      ctx.lineWidth = 0.03;
      ctx.strokeRect(0.3, py + 0.02, 0.4, half - 0.04);
    }
  }

  function drawPingpongBall(acts, now) {
    const table = world.furniture.find((f) => f.type === 'pingpong');
    if (!table) return;
    const players = acts.filter((a) => a.activity === 'pingpong' && a.moveAmt < 0.5
      && a.y > table.y - 2 && a.y < table.y + table.h + 1 && a.x > table.x - 3 && a.x < table.x + table.w + 2);
    if (players.length < 2) return;
    players.sort((p, q) => p.x - q.x);
    const L = players[0], R = players[players.length - 1];
    const P = 1300;
    const ph = (now % (P * 2)) / P;
    const forward = ph < 1;
    const p = forward ? ph : ph - 1;
    const x0 = L.x + 1.0, x1 = R.x;
    const x = forward ? lerp(x0, x1, p) : lerp(x1, x0, p);
    const y = table.y + table.h / 2 - 0.36 + Math.sin(p * Math.PI) * 0.15 * (forward ? 1 : -1);
    const bounceP = p < 0.62 ? p / 0.62 : (p - 0.62) / 0.38;
    const z = Math.sin(bounceP * Math.PI) * (p < 0.62 ? 0.55 : 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.07, 0.03, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    circle(ctx, x, y - z - 0.06, 0.07, '#ffffff');
    circle(ctx, x - 0.02, y - z - 0.08, 0.025, '#fde68a');
  }

  function collectLights(acts, now) {
    const lights = [];
    for (const d of world.desks) {
      const info = deskInfo.get(d.id);
      if (!info || !info.owner || !info.owner.present) continue;
      const f = world.furniture.find((q) => (q.type === 'desk' || q.type === 'boss_desk') && q.owner === d.id);
      if (!f) continue;
      if (f.type === 'desk') {
        const g = deskGeom(f);
        // đèn bàn vàng ấm, đủ dịu để mặt bàn không cháy trắng
        lights.push({ x: g.lamp.x + 0.3, y: g.lamp.y + 0.1, r: 2.4, a: 0.3, color: 'rgba(255,184,100,ALPHA)' });
        const kind = deskScreenKind(d, info);
        const glow = screenGlow(kind);
        if (glow) lights.push({ x: g.screen.x + g.screen.w / 2, y: g.screen.y + g.screen.h + 0.6, r: 1.9, a: 0.36, color: glow.replace(/[\d.]+\)$/, 'ALPHA)') });
      } else {
        const g = bossDeskGeom(f);
        lights.push({ x: g.lamp.x, y: g.lamp.y + 0.3, r: 3, a: 0.38, color: 'rgba(255,196,120,ALPHA)' });
      }
    }
    const tv = world.furniture.find((f) => f.type === 'tv');
    if (tv) {
      const g = tvGeom(tv);
      const fl = 0.75 + Math.sin(now / 130) * 0.1 + Math.sin(now / 47) * 0.05;
      lights.push({ x: g.screen.x + g.screen.w / 2, y: g.screen.y + g.screen.h + 1.2, r: 3.4, a: 0.45 * fl, color: 'rgba(150,190,255,ALPHA)' });
    }
    // phòng trưng bày: đèn rọi kệ luôn sáng nhẹ
    for (const f of world.furniture) {
      if (!shelfOfType(f.type)) continue;
      lights.push({ x: f.x + f.w / 2, y: f.y + 0.9, r: Math.max(2.2, f.w * 0.6), a: 0.3, color: 'rgba(255,240,215,ALPHA)' });
    }
    for (const r of world.rooms) {
      if (r.id === 'work' || r.id === 'wc') continue;
      const occupied = acts.some((a) => a.x >= r.x && a.x < r.x + r.w && a.y >= r.y && a.y < r.y + r.h);
      if (occupied) lights.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: Math.max(r.w, r.h) * 0.6, a: 0.28, color: 'rgba(255,225,170,ALPHA)' });
    }
    return lights;
  }

  // ---------------------------------------------------------------- lớp phủ chữ
  function drawOverlays(acts, now) {
    const showNames = T >= 10.5;
    const compact = cssW < 560;
    const nameSize = clamp(T * 0.48, 9, 11.5);
    const emoteSize = clamp(T * 1.05 * charScale, 17, 28);
    const bubbleItems = [];
    hits = [];
    const speaking = new Set();
    for (const b of store.bubbles) if (now - b.t0 < b.dur) speaking.add(b.speaker);
    const sorted = [...acts].sort((p, q) => p.y - q.y || p.x - q.x);
    const unit = (charScale / U) * T; // px CSS cho 1 đơn vị nhân vật
    const halfW = 0.5 * charScale * T;
    // bảng tên: đo -> giãn cho khỏi chồng -> vẽ
    const pills = [];
    for (const a of sorted) {
      const sx = ox + (a.x + 0.5) * T;
      const fy = oy + (a.y + FEET_Y) * T;
      const top = fy + headTop(a.pose) * unit;
      a._sx = sx; a._fy = fy; a._top = top; a._head = fy + headCenter(a.pose) * unit; a._hr = HEAD_RADIUS * unit;
      // ngoài khung nhìn (đang phóng to): không vẽ bảng tên (bong bóng thoại vẫn được kẹp vào mép khung)
      if (sx < -halfW || sx > cssW + halfW || top > cssH + 4 || fy + 0.3 * T < 0) continue;
      if (a.alpha > 0.3) hits.push({ id: a.id, x0: sx - halfW, x1: sx + halfW, y0: top - 0.08 * T, y1: fy + 0.15 * T, y: a.y });
      if (a.alpha <= 0.02) continue;
      // sếp ngồi sau bàn quay mặt xuống: đặt tên trên đầu (không che bảng tên "GIÁM ĐỐC").
      // Ghế phía bắc bàn họp / bàn ăn: tên nằm trên mặt bàn trước mặt (như bảng tên hội nghị), không che mặt nhau.
      const behindDesk = a.pose === 'sit' && a.seat && a.seat.facing === 'down' && a.seat.kind === 'desk';
      const ag = a.agent;
      const name = ag?.name || store.name(a.id);
      const isHover = a.id === hoverId;
      if (!showNames && !isHover && !speaking.has(a.id)) continue;
      let tag = '', tagBg = '#ff7a45', bg;
      if (ag?.status === 'candidate') { tag = 'Ứng viên'; tagBg = '#f97316'; }
      else if (ag?.status === 'fired') { tag = '📦 Nghỉ việc'; tagBg = '#6b7280'; bg = 'rgba(75,85,99,0.85)'; }
      else if (ag?.role === 'boss') bg = 'rgba(146,64,14,0.88)';
      const opts = { size: nameSize, dot: safeColor(ag?.look?.shirt, '#9ca3af'), tag, tagBg, bg, alpha: a.alpha, highlight: isHover };
      const m = measureNamePill(ctx, name, opts);
      // bảng tên không bị cắt ở mép canvas (người đứng sát cửa ra vào / mép bản đồ)
      const px = clamp(sx, m.w / 2 + 4, Math.max(m.w / 2 + 4, cssW - m.w / 2 - 4));
      if (behindDesk) {
        const py = top - m.h - 3;
        pills.push({ id: a.id, x: px, y: py, w: m.w, h: m.h, name, opts, up: true, actor: a });
        a._top = py - 1;
      } else pills.push({ id: a.id, x: px, y: fy + 0.1 * T + 2, w: m.w, h: m.h, name, opts });
    }
    spreadPills(pills);
    for (const p of pills) {
      if (p.up) p.actor._top = Math.min(p.actor._top, p.y - 1);
      drawNamePill(ctx, p.x, p.y, p.name, p.opts);
    }
    // emote không được che bảng tên của người khác (hay gặp khi 2 người đi nối đuôi nhau)
    const er = emoteSize / 2;
    const coversPill = (id, x, y) => pills.some((p) => p.id !== id
      && x + er > p.x - p.w / 2 && x - er < p.x + p.w / 2 && y + er > p.y && y - er < p.y + p.h);
    // emote
    for (const a of sorted) {
      if (a.alpha <= 0.02) continue;
      if (speaking.has(a.id)) continue;
      const onPhone = (a.flags & FLAG_PHONE) !== 0;
      const ping = store.pings.get(a.id);
      const em = onPhone ? '📱' : a.emote;
      if (!em) continue;
      let ex = a._sx, ey = a._top - emoteSize * 0.5 - 3;
      if (a.pose !== 'stand' && a.viewDir === 'up') {
        // ngồi quay lưng (bàn làm việc / bàn họp / bàn ăn / sofa): emote đặt cạnh đầu để không che màn hình
        // hay bảng tên của người ngồi đối diện
        ex = a._sx + 0.95 * T * charScale; ey = a._head;
      } else if (ey - er < insets.top + 2) {
        // đỉnh đầu sát HUD (phòng trưng bày, phòng server…): emote đặt cạnh đầu, về phía còn chỗ
        ex = a._sx + (a._sx < cssW / 2 ? 1 : -1) * 0.95 * T * charScale; ey = Math.max(a._head, insets.top + er + 2);
      }
      if (coversPill(a.id, ex, ey)) {
        const alt = [
          [ex + emoteSize * 0.85, ey + emoteSize * 0.45], [ex - emoteSize * 0.85, ey + emoteSize * 0.45],
          [ex + emoteSize * 1.3, ey], [ex - emoteSize * 1.3, ey], [ex, ey - emoteSize * 0.9],
        ].find(([x, y]) => !coversPill(a.id, x, y));
        if (alt) [ex, ey] = alt;
      }
      drawEmote(ctx, ex, ey, em, onPhone ? 0 : a.emoteAt, now, {
        size: emoteSize, pulse: onPhone, ping: onPhone && ping && now - ping < 1300 ? ping : 0, alpha: a.alpha,
        bg: onPhone ? '#ecfdf5' : '#ffffff',
      });
    }
    // bong bóng
    for (const b of store.bubbles) {
      if (now - b.t0 >= b.dur) continue;
      const a = acts.find((q) => q.id === b.speaker);
      if (!a) continue;
      const ag = a.agent;
      bubbleItems.push({
        kind: 'speech', key: b.key, ax: a._sx, ay: a._top - 2, hy: a._head, hr: Math.max(6, a._hr),
        fy: a._fy + nameSize * 1.7, text: b.text, name: b.name,
        color: safeColor(ag?.look?.shirt, '#ff7a45'), icon: b.icon, product: !!b.product, t0: b.t0, dur: b.dur,
      });
    }
    for (const [id, ty] of store.typing) {
      if (now > ty.until) { store.typing.delete(id); continue; }
      if (now < ty.from || speaking.has(id)) continue;
      const a = acts.find((q) => q.id === id);
      if (!a) continue;
      bubbleItems.push({
        kind: 'typing', key: `typing:${id}`, ax: a._sx, ay: a._top - 2, hy: a._head, hr: Math.max(6, a._hr),
        fy: a._fy + nameSize * 1.7, from: ty.from, until: ty.until, t0: ty.from,
      });
    }
    store.bubbles = store.bubbles.filter((b) => now - b.t0 < b.dur + 500);
    if (bubbleItems.length) drawBubbles(ctx, bubbleItems, cssW, cssH, now, compact, insets);
  }

  // ---------------------------------------------------------------- camera tự theo người nói (khi đang phóng to)
  function followCamera(now) {
    if (!world || cam.zoom <= 1.05 || drag || pinch) return;
    if (now - lastInteract < 9000) return;
    let target = null;
    const b = store.bubbles.length ? store.bubbles[store.bubbles.length - 1] : null;
    if (b && now - b.t0 < b.dur) {
      const a = store.actors.get(b.speaker);
      if (a && !(a.flags & FLAG_HIDDEN)) target = { x: a.x + 0.5, y: a.y };
    }
    if (!target) return;
    cam.cx = lerp(cam.cx, target.x, 0.025);
    cam.cy = lerp(cam.cy, target.y - 0.5, 0.025);
  }

  // ---------------------------------------------------------------- input
  function pick(sx, sy) {
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (sx >= h.x0 && sx <= h.x1 && sy >= h.y0 && sy <= h.y1) return h.id;
    }
    // bàn làm việc -> chủ bàn
    const t = toTile(sx, sy);
    for (const d of world?.desks || []) {
      const r = d.desk;
      if (t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y - 1.1 && t.y <= r.y + r.h) {
        const o = store.deskOwner(d.id);
        if (o) return o.id;
      }
    }
    return null;
  }

  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setHover(id, x, y) {
    if (id !== hoverId) {
      hoverId = id;
      updateCursor();
    }
    hooks.onHover?.(id, x, y);
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = localXY(e);
    pointers.set(e.pointerId, p);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    if (pointers.size === 1) drag = { x: p.x, y: p.y, cx: cam.cx, cy: cam.cy, moved: false, t: performance.now() };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
    }
    lastInteract = performance.now();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = clamp(pinch.zoom * (d / Math.max(10, pinch.d)), 1, maxZoom());
      zoomAt(target / cam.zoom, pinch.mx, pinch.my);
      return;
    }
    if (drag) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved && cam.zoom > 1.01) {
        cam.cx = drag.cx - dx / T;
        cam.cy = drag.cy - dy / T;
        cam.userMoved = true;
        lastInteract = performance.now();
        canvas.style.cursor = 'grabbing';
      }
      return;
    }
    if (e.pointerType === 'mouse' && world) {
      const prod = pickProduct(p.x, p.y);
      if (prod) {
        if (hoverId) setHover(null, p.x, p.y);
        if (hoverBoard) setHoverBoard(null, e.clientX, e.clientY);
        setHoverProduct(prod, e.clientX, e.clientY);
      } else {
        if (hoverProduct) setHoverProduct(null, e.clientX, e.clientY);
        const id = pick(p.x, p.y);
        // người đứng trước bảng KPI được ưu tiên hơn bảng
        const board = id ? null : pickBoard(p.x, p.y);
        if (hoverBoard !== board) setHoverBoard(board, e.clientX, e.clientY);
        else if (board) setHoverBoard(board, e.clientX, e.clientY);
        setHover(id, p.x, p.y);
      }
    }
  });

  function endPointer(e) {
    const p = localXY(e);
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
    if (wasDrag && !wasDrag.moved && e.type === 'pointerup' && world) {
      const prod = pickProduct(p.x, p.y);
      if (prod) hooks.onProductClick?.(prod);
      else {
        const id = pick(p.x, p.y);
        if (id) hooks.onPick?.(id);
        else {
          const board = pickBoard(p.x, p.y);
          if (board) hooks.onBoardClick?.(board);
        }
      }
    }
    if (e.pointerType === 'mouse') updateCursor();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    setHover(null, 0, 0);
    if (hoverProduct) setHoverProduct(null, e.clientX, e.clientY);
    if (hoverBoard) setHoverBoard(null, e.clientX, e.clientY);
  });

  canvas.addEventListener('wheel', (e) => {
    if (!world) return;
    e.preventDefault();
    const p = localXY(e);
    const f = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022));
    zoomAt(f, p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const p = localXY(e);
    if (cam.zoom > 1.6) fit(); else zoomAt(2, p.x, p.y);
  });

  // ---------------------------------------------------------------- API
  function fit() {
    if (!world) return;
    cam.userMoved = false;
    cam.zoom = 1;
    cam.cx = world.W / 2;
    cam.cy = (world.H + 0.25) / 2;
    lastInteract = performance.now();
    clampCam();
    scheduleCache();
  }

  function focusAgent(id) {
    const a = store.actors.get(id);
    if (!a || !world) return;
    if (cam.zoom < 1.6) cam.zoom = Math.min(maxZoom(), 1.8);
    cam.cx = a.x + 0.5;
    cam.cy = a.y;
    cam.userMoved = true;
    lastInteract = performance.now();
    clampCam();
    scheduleCache();
  }

  function setCharacterScale(n) {
    const v = Number(n);
    charScale = Number.isFinite(v) ? clamp(v, 0.6, 1.6) : DEFAULT_CHAR_SCALE;
  }

  const ro = new ResizeObserver(() => { resize(); if (world) scheduleCache(); });
  ro.observe(canvas);
  let mq = null;
  function watchDpr() {
    mq?.removeEventListener?.('change', onDpr);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener?.('change', onDpr);
  }
  function onDpr() { resize(); rebuildCaches(); watchDpr(); }
  watchDpr();

  // sản phẩm đi kèm hello (UI cũng có thể gọi setProducts(hello.products) — gọi hai lần vô hại)
  store.on('hello', (msg) => { if (msg && Array.isArray(msg.products)) setProducts(msg.products); });

  raf = requestAnimationFrame(frame);
  // thông tin camera chỉ-đọc (cho test tự động / chụp màn hình headless)
  canvas.__view = () => ({ T, ox, oy, zoom: cam.zoom, w: cssW, h: cssH, charScale, products: products.length, wcBusy, insets: { ...insets }, bandTop, bandBottom });

  return {
    setMap,
    setProducts,
    setCharacterScale,
    setInsets,
    zoomIn: () => zoomAt(1.35, cssW / 2, cssH / 2),
    zoomOut: () => zoomAt(1 / 1.35, cssW / 2, cssH / 2),
    fit,
    focusAgent,
    refresh: () => { clearTextCache(); if (world) rebuildCaches(); },
    isZoomed: () => cam.zoom > 1.01,
    get hasMap() { return !!world; },
    get characterScale() { return charScale; },
  };
}
