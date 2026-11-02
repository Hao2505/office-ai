// Tab "🛍️ Sản phẩm": kệ phòng trưng bày theo 2 nhóm (Làm đẹp / Công nghệ) từ hello.products, kèm nhận xét
// của chủ dự án và nút mua (src=sidebar). Cũng lo tooltip sản phẩm khi rê chuột lên kệ trên canvas
// (hook onProductHover) và mở link khi bấm (hook onProductClick) — link luôn đi qua /go/<id>.
import { store } from '../store.js';
import { el, setKids, str, safeProductUrl, safeImageUrl, clamp } from '../util.js';
import { SHELF_LABELS } from '../labels.js';

let box = null, tip = null, stage = null;
let tipId = null;

export function initProducts() {
  box = document.getElementById('products');
  tip = document.getElementById('prod-tip');
  stage = document.getElementById('stage');
  store.on('products', render);
  render();
}

/** đổi (hoặc thêm) tham số src của link /go/<id> — vẫn phải là link nội bộ hợp lệ */
export function productUrl(url, src) {
  const u = safeProductUrl(url);
  if (!u) return null;
  const s = /^[a-z_]{1,20}$/.test(src) ? src : 'sidebar';
  if (/[?&]src=/.test(u)) return u.replace(/([?&])src=[^&#]*/, `$1src=${s}`);
  return `${u}${u.includes('?') ? '&' : '?'}src=${s}`;
}

/** mở trang sản phẩm ở tab mới (từ kệ trên canvas: src=showroom) */
export function openProduct(product, src = 'showroom') {
  const url = productUrl(product?.url, src);
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  return true;
}

/** tooltip DOM cạnh con trỏ (toạ độ client), null = ẩn */
export function showProductTip(product, clientX, clientY) {
  if (!tip) return;
  if (!product || typeof product !== 'object') { tip.hidden = true; tipId = null; return; }
  const p = store.productById(product.id) || product;
  if (tipId !== p.id || tip.hidden) {
    tipId = p.id;
    setKids(tip,
      media(p, 'pt-media'),
      el('div', { class: 'pt-main' },
        el('div', { class: 'pt-name', text: str(p.name, 90) }),
        p.priceHint ? el('div', { class: 'pt-price', text: str(p.priceHint, 24) }) : null,
        el('div', { class: 'pt-hint', text: safeProductUrl(p.url) ? 'Bấm để xem trên Shopee ↗' : 'Chưa có link' }),
        el('div', { class: 'pt-cap', text: 'Link tiếp thị liên kết' })));
  }
  tip.hidden = false;
  const s = stage.getBoundingClientRect();
  const x = clamp(Number(clientX) - s.left, 0, s.width), y = clamp(Number(clientY) - s.top, 0, s.height);
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let tx = x + 16, ty = y + 16;
  if (tx + tw > s.width - 8) tx = Math.max(8, x - tw - 12);
  if (ty + th > s.height - 8) ty = Math.max(8, y - th - 12);
  tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
}

function media(p, cls) {
  const img = safeImageUrl(p.image);
  const wrap = el('span', { class: cls, 'aria-hidden': 'true' });
  if (img) {
    const im = el('img', { src: img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    im.addEventListener('error', () => setKids(wrap, str(p.emoji || '🛍️', 8)));
    wrap.append(im);
  } else wrap.append(str(p.emoji || '🛍️', 8));
  return wrap;
}

function card(p) {
  const url = productUrl(p.url, 'sidebar');
  return el('article', { class: 'pcard', 'data-id': p.id },
    media(p, 'pcard-media'),
    el('div', { class: 'pcard-main' },
      el('div', { class: 'pcard-name', text: p.name }),
      p.priceHint ? el('div', { class: 'pcard-price', text: p.priceHint }) : null,
      p.note ? el('div', { class: 'pcard-note', text: `“${p.note}”` }) : null,
      el('div', { class: 'pcard-row' },
        url ? el('a', { class: 'pcard-buy', href: url, target: '_blank', rel: 'noopener sponsored', 'aria-label': `Mua ${p.name} trên Shopee` }, '🛒 Mua trên Shopee ↗') : null,
        el('span', { class: 'pcard-cap', text: 'Link tiếp thị liên kết' }))));
}

function render() {
  if (!box) return;
  const groups = store.productsByShelf();
  const total = groups.beauty.length + groups.tech.length;
  if (!total) {
    setKids(box, el('div', { class: 'empty' },
      el('div', { class: 'empty-icon', text: '🛍️' }),
      el('div', { class: 'empty-title', text: 'Kệ trưng bày còn trống' }),
      el('div', { class: 'empty-text', text: 'Chủ dự án sẽ bày lên đây những món mình đang dùng và thấy ổn (kèm link Shopee). Nhân viên cũng sẽ ghé phòng trưng bày để khoe đồ với nhau.' })));
    return;
  }
  setKids(box,
    el('p', { class: 'products-note', text: 'Đồ chủ dự án đang dùng thật và thấy ổn — bày trên kệ phòng trưng bày trong văn phòng. Bấm vào món trên kệ hoặc nút bên dưới để xem trên Shopee.' }),
    ['beauty', 'tech'].map((shelf) => {
      const list = groups[shelf];
      if (!list.length) return null;
      const [ic, label] = SHELF_LABELS[shelf];
      return el('section', { class: `pg pg-${shelf}`, 'aria-label': label },
        el('h3', { class: 'pg-title' }, el('span', { class: 'pg-ic', 'aria-hidden': 'true', text: ic }), label, el('span', { class: 'pg-count', text: `${list.length} món` })),
        list.map(card));
    }));
}
