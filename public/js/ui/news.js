// Thẻ tin thời sự (v3): nhân vật chỉ bàn TIN THẬT lấy từ RSS báo — thẻ luôn hiện tiêu đề, nguồn, link bài gốc
// (để người xem tự kiểm chứng) + chip nhóm tin. Dùng trong thẻ cảnh news_chat (feed) và dải "🗞️ Tin đang bàn"
// ở đầu tab 📰 Bản tin (hello.news + tin của các cảnh news_chat mới). Link chỉ gắn khi là http(s) tuyệt đối.
import { store, normNewsRef } from '../store.js';
import { el, setKids } from '../util.js';
import { NEWS_CATEGORIES } from '../labels.js';

export const NEWS_CAPTION = 'Nhân vật AI chỉ bình luận cảm nghĩ về tin đã đăng trên báo; không phải phát ngôn hay sự thật được xác nhận.';

let strip = null;

/** chỉ nhận link http(s) tuyệt đối, không ký tự lạ; không hợp lệ -> null (thẻ hiện mà không có link) */
export function safeNewsUrl(url) {
  if (typeof url !== 'string' || url.length > 1000 || /[\s"'<>\\]/.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

/** chip nhóm tin: ⚽ Bóng đá / 🏅 Thể thao / 💻 Công nghệ / 🎮 Game / 🔬 Khoa học / 🎬 Giải trí (nhóm lạ -> không chip) */
export function categoryChip(category) {
  const c = NEWS_CATEGORIES[category];
  if (!c) return null;
  return el('span', { class: `cat-chip cat-${category}`, text: `${c[0]} ${c[1]}` });
}

/**
 * Thẻ tin gọn: 🗞️ tiêu đề (tối đa 2 dòng) · Nguồn · chip nhóm · "Đọc bài ↗" (tab mới, rel=noopener).
 * opts.caption = false: không in dòng chú thích dưới thẻ (dải Tin đang bàn in một dòng chung).
 */
export function newsCard(news, opts = {}) {
  const n = normNewsRef(news);
  if (!n) return null;
  const href = safeNewsUrl(n.url);
  const meta = el('div', { class: 'nc-meta' },
    n.source ? el('span', { class: 'nc-src', text: `Nguồn: ${n.source}` }) : null,
    categoryChip(n.category),
    href ? el('a', { class: 'nc-link', href, target: '_blank', rel: 'noopener', title: `Đọc bài gốc${n.source ? ` trên ${n.source}` : ''}` }, 'Đọc bài ↗') : null);
  return el('div', { class: `news-card${opts.compact ? ' compact' : ''}`, role: 'note', 'aria-label': `Tin đang bàn: ${n.title}` },
    el('div', { class: 'nc-top' },
      el('span', { class: 'nc-ic', 'aria-hidden': 'true', text: '🗞️' }),
      el('div', { class: 'nc-main' },
        el('div', { class: 'nc-title', title: n.title, text: n.title }),
        meta)),
    opts.caption === false ? null : el('div', { class: 'nc-cap', text: NEWS_CAPTION }));
}

const STRIP_MAX = 5;

/** Dải "🗞️ Tin đang bàn" (đầu tab Bản tin): 5 tin gần nhất, mới nhất trước; ẩn khi chưa có tin */
export function initNewsStrip() {
  strip = document.getElementById('news-strip');
  if (!strip) return;
  store.on('news', render);
  store.on('hello', render);
  render();
}

function render() {
  if (!strip) return;
  const list = [...store.news].reverse().slice(0, STRIP_MAX);
  if (!list.length) {
    strip.hidden = true;
    strip.replaceChildren();
    return;
  }
  strip.hidden = false;
  setKids(strip,
    el('div', { class: 'ns-head' },
      el('span', { class: 'ns-title', text: '🗞️ Tin đang bàn' }),
      el('span', { class: 'ns-count', text: `${list.length} tin gần nhất` })),
    el('div', { class: 'ns-list' }, list.map((n) => newsCard(n, { caption: false, compact: true }))),
    el('div', { class: 'nc-cap', text: NEWS_CAPTION }));
}
