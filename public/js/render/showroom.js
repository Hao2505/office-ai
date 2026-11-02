// Phòng trưng bày: sản phẩm trên kệ (hello.products -> office.setProducts), thẻ sản phẩm (emoji + nhãn),
// bục giữa phòng, hình chữ nhật để rê chuột / bấm (toạ độ ô). Không bao giờ chặn vẽ: ảnh chỉ là tuỳ chọn.
import { str, safeProductUrl } from '../util.js';
import { shelfGeom, podiumGeom } from './furniture.js';
import { fillRR, rrPath, FONT, EMOJI_FONT, fitText } from './draw.js';

const MAX_PER_SHELF = 5;

/** làm sạch danh sách sản phẩm từ server (chỉ giữ trường cần cho canvas; url phải là /go/...) */
export function sanitizeProducts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') continue;
    const shelf = p.shelf === 'beauty' || p.shelf === 'tech' ? p.shelf
      : p.category === 'lam-dep' ? 'beauty' : p.category === 'cong-nghe' ? 'tech' : null;
    if (!shelf) continue;
    out.push({
      id: str(p.id, 60),
      name: str(p.name || p.id, 120),
      emoji: str(p.emoji || '🛍️', 8),
      priceHint: str(p.priceHint || '', 30),
      url: safeProductUrl(p.url) || `/go/${encodeURIComponent(p.id)}?src=showroom`,
      category: p.category === 'lam-dep' || p.category === 'cong-nghe' ? p.category : shelf === 'beauty' ? 'lam-dep' : 'cong-nghe',
      shelf,
      slot: Number.isFinite(Number(p.slot)) ? Number(p.slot) : 99,
      note: str(p.note || '', 400),
      image: typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 500) : '',
      tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
      raw: p,
    });
    if (out.length >= 60) break;
  }
  out.sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
  return out;
}

/** sản phẩm hiện trên kệ nào (tối đa 5 / kệ, theo slot) */
export function shelfProducts(products, shelf) {
  const list = [];
  for (const p of products) if (p.shelf === shelf) { list.push(p); if (list.length >= MAX_PER_SHELF) break; }
  return list;
}

const SHELF_OF_TYPE = { shelf_beauty: 'beauty', shelf_tech: 'tech' };
export const shelfOfType = (type) => SHELF_OF_TYPE[type] || null;

// ---- ảnh sản phẩm (tuỳ chọn): tải nền, lỗi thì dùng emoji; không bao giờ chặn vẽ
const images = new Map(); // url -> { img, ok }
function imageFor(p) {
  if (!p.image) return null;
  let e = images.get(p.image);
  if (!e) {
    e = { img: null, ok: false };
    images.set(p.image, e);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { e.ok = img.naturalWidth > 0; e.img = img; };
      img.onerror = () => { e.ok = false; };
      img.src = p.image;
    } catch { e.ok = false; }
    if (images.size > 80) images.delete(images.keys().next().value);
  }
  return e.ok ? e.img : null;
}

/** vẽ một thẻ sản phẩm (toạ độ ô) */
function card(ctx, r, p, hot) {
  // bóng + thẻ trắng bo góc
  fillRR(ctx, r.x + 0.02, r.y + 0.04, r.w, r.h, 0.07, 'rgba(0,0,0,0.16)');
  fillRR(ctx, r.x, r.y, r.w, r.h, 0.07, hot ? '#fff7ed' : '#ffffff');
  // nền kiểu hộp sản phẩm: dải màu theo kệ
  fillRR(ctx, r.x + 0.04, r.y + 0.04, r.w - 0.08, r.h * 0.3, 0.04, p.shelf === 'beauty' ? 'rgba(251,207,232,0.55)' : 'rgba(191,219,254,0.6)');
  const img = imageFor(p);
  if (img) {
    ctx.save();
    rrPath(ctx, r.x + 0.05, r.y + 0.05, r.w - 0.1, r.h - 0.1, 0.05);
    ctx.clip();
    const s = Math.min((r.w - 0.1) / img.naturalWidth, (r.h - 0.1) / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, r.x + r.w / 2 - w / 2, r.y + r.h / 2 - h / 2, w, h);
    ctx.restore();
  } else {
    ctx.font = `${(r.h * 0.7).toFixed(3)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, r.x + r.w / 2, r.y + r.h * 0.56);
  }
  ctx.strokeStyle = hot ? '#ff7a45' : 'rgba(0,0,0,0.12)';
  ctx.lineWidth = hot ? 0.045 : 0.02;
  rrPath(ctx, r.x, r.y, r.w, r.h, 0.07);
  ctx.stroke();
}

/** nhãn tên ngắn dưới thẻ (chữ nhỏ, đọc được khi phóng to) */
function label(ctx, cx, y, w, h, text) {
  fitText(ctx, text, cx, y + h / 2 + 0.005, w - 0.06, 0.105, 700, '#374151');
}

function shortName(p) {
  const words = p.name.split(/\s+/);
  let s = '';
  for (const w of words) { if ((s + ' ' + w).trim().length > 16) break; s = (s + ' ' + w).trim(); }
  return s || p.name.slice(0, 16);
}

/**
 * Vẽ sản phẩm lên kệ f (gọi sau khi vẽ sprite kệ). Trả về danh sách rect đã vẽ (để hit-test).
 * hotId: sản phẩm đang rê chuột.
 */
export function drawShelfProducts(ctx, f, products, hotId, out, opts = {}) {
  const shelf = shelfOfType(f.type);
  if (!shelf) return;
  const g = shelfGeom(f);
  const list = shelfProducts(products, shelf);
  const showLabels = opts.labels !== false;
  for (let i = 0; i < list.length && i < g.slots.length; i++) {
    const p = list[i], sl = g.slots[i];
    const r = { x: sl.x, y: sl.y, w: sl.w, h: sl.h };
    const hot = p.id === hotId;
    if (hot) {
      // quầng sáng
      ctx.save();
      ctx.shadowColor = 'rgba(255,122,69,0.9)';
      ctx.shadowBlur = 10;
      fillRR(ctx, r.x - 0.03, r.y - 0.03, r.w + 0.06, r.h + 0.06, 0.09, 'rgba(255,200,160,0.55)');
      ctx.restore();
    }
    card(ctx, r, p, hot);
    if (showLabels) label(ctx, sl.cx, sl.labelY, g.pitch - 0.04, g.labelH, shortName(p));
    if (out) out.push({ x: r.x, y: r.y - 0.04, w: r.w, h: r.h + g.labelH + 0.26, product: p });
  }
}

/** sản phẩm nổi bật trên bục (đổi mỗi 25 giây) */
export function featuredProduct(products, now) {
  if (!products.length) return null;
  return products[Math.floor(now / 25000) % products.length];
}

export function drawPodiumProduct(ctx, f, products, now, hotId, out) {
  const g = podiumGeom(f);
  const p = featuredProduct(products, now);
  const it = g.item;
  // lồng kính
  const bob = Math.sin(now / 900) * 0.015;
  if (p) {
    const hot = p.id === hotId;
    ctx.font = `${(it.h * 0.72).toFixed(3)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, g.cx, it.y + it.h * 0.55 + bob);
    // thẻ giá nhỏ
    const tag = p.priceHint || '';
    if (tag) {
      fillRR(ctx, g.cx - 0.22, g.topY - 0.2, 0.44, 0.16, 0.04, hot ? '#ff7a45' : '#1f2937');
      fitText(ctx, tag, g.cx, g.topY - 0.12, 0.4, 0.1, 800, '#ffffff');
    }
    if (out) out.push({ x: it.x - 0.1, y: it.y - 0.1, w: it.w + 0.2, h: it.h + 0.5, product: p });
  }
  // vòm kính (vẽ sau để phủ lên sản phẩm)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g.cx - g.rx * 0.78, g.topY);
  ctx.lineTo(g.cx - g.rx * 0.78, it.y + 0.12);
  ctx.arc(g.cx, it.y + 0.12, g.rx * 0.78, Math.PI, 0);
  ctx.lineTo(g.cx + g.rx * 0.78, g.topY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(200,230,250,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 0.03;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(g.cx - g.rx * 0.6, g.topY - 0.05); ctx.lineTo(g.cx - g.rx * 0.45, g.topY - 0.05); ctx.lineTo(g.cx - g.rx * 0.25, it.y + 0.05); ctx.lineTo(g.cx - g.rx * 0.45, it.y + 0.05); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (p && p.id === hotId) {
    ctx.strokeStyle = '#ff7a45';
    ctx.lineWidth = 0.04;
    rrPath(ctx, it.x - 0.1, it.y - 0.1, it.w + 0.2, it.h + 0.2, 0.1);
    ctx.stroke();
  }
}

/** font helper dùng chung (để tránh import vòng) */
export const PRODUCT_FONT = FONT;
