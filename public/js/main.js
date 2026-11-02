// Điểm vào client: nối WebSocket -> store -> canvas + HUD + sidebar (feed / nhân sự / sản phẩm / bản tin / tin đồn).
import { store, actorPos } from './store.js';
// móc đo hiệu năng / độ mượt (dùng bởi script QA headless): window.__vpa.store, window.__vpa.actorPos — không chứa gì ngoài dữ liệu server đã gửi
Object.defineProperty(window, '__vpa', { value: { store, actorPos }, enumerable: false });
import { connect, send } from './net.js';
import { initHud } from './ui/hud.js';
import { initSidebar, onSidebarToggle } from './ui/sidebar.js';
import { initFeed } from './ui/feed.js';
import { initStaff } from './ui/staff.js';
import { initProducts, showProductTip, openProduct } from './ui/products.js';
import { initRecaps } from './ui/recaps.js';
import { initNewsStrip } from './ui/news.js';
import { initHistory } from './ui/history.js';
import { initRumors } from './ui/rumors.js';
import { initProfile, openProfile } from './ui/profile.js';
import { initDevbar } from './ui/devbar.js';
import { initToasts, toast } from './ui/toasts.js';
import { initTabs } from './ui/tabs.js';
import { el, setKids, setText, str, num, clamp, fmtNum, safeColor, shortCompanyName, warnOnce } from './util.js';
import { activityText, kpiPaceTone } from './labels.js';

const $ = (id) => document.getElementById(id);
const TABS = ['live', 'staff', 'products', 'recap', 'rumors'];

// ---- canvas: nạp động để trang vẫn chạy (HUD, feed…) nếu module vẽ đang được sửa dở
const noop = () => {};
let office = { setMap: () => true, zoomIn: noop, zoomOut: noop, fit: noop, focusAgent: noop, refresh: noop, isZoomed: () => false, hasMap: false };
try {
  const mod = await import('./render/office.js');
  office = mod.createOffice($('office'), {
    onPick: (id) => openProfile(id),
    onHover: (id, x, y) => showHoverTip(id, x, y),
    onProductHover: (p, cx, cy) => showProductTip(p, cx, cy),
    onProductClick: (p) => openProduct(p, 'showroom'),
    // bảng KPI / bảng trắng: chữ trên bảng nhỏ -> rê chuột có tooltip đọc được, bấm mở phần tương ứng
    onBoardHover: (kind, cx, cy) => showBoardTip(kind, cx, cy),
    onBoardClick: (kind) => { if (kind === 'kpi') tabs.activate('staff'); else if (kind === 'whiteboard') $('chip-project')?.click(); },
  });
} catch (e) {
  console.error('[văn phòng] không nạp được module vẽ canvas', e);
}

const tabs = initTabs($('sidebar'));
initToasts($('toasts'));
initHud();
initSidebar();
initFeed(openProfile);
initStaff(openProfile);
initProducts();
initRecaps(openProfile);
initNewsStrip();
initHistory(openProfile);
initRumors(openProfile);
initProfile((id) => office.focusAgent(id));
initDevbar(send);

// ---- nút thu phóng
$('zoom-in').addEventListener('click', () => office.zoomIn());
$('zoom-out').addEventListener('click', () => office.zoomOut());
$('zoom-fit').addEventListener('click', () => office.fit());

// ---- HUD (mép trên) + dải ticker (mép dưới) đè lên canvas: báo cho canvas để bong bóng / emote né ra
// và bản đồ căn vào phần còn trống
const hudEl = $('hud'), tickerEl = $('ticker');
function syncInsets() {
  if (typeof office.setInsets !== 'function') return;
  const top = hudEl && !hudEl.hidden ? Math.round(hudEl.getBoundingClientRect().height) : 0;
  const bottom = tickerEl && !tickerEl.hidden ? Math.round(tickerEl.getBoundingClientRect().height) : 0;
  office.setInsets({ top, bottom });
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(syncInsets);
  if (hudEl) ro.observe(hudEl);
  if (tickerEl) ro.observe(tickerEl);
}
onSidebarToggle(() => requestAnimationFrame(syncInsets));
window.addEventListener('resize', syncInsets);
syncInsets();

// ---- sản phẩm trên kệ -> canvas (nếu module vẽ đã hỗ trợ)
function pushProducts() {
  if (typeof office.setProducts !== 'function') return;
  try { office.setProducts(store.products); } catch (e) { warnOnce('setProducts lỗi', e); }
}
store.on('products', pushProducts);

// ---- hello / kết nối
store.on('hello', (msg) => {
  const short = shortCompanyName(store.companyName);
  setText($('company-name'), short);
  document.title = `Văn Phòng Ảo — ${short}`;
  let ok = false;
  try { ok = office.setMap(msg.map, msg.companyName); } catch (e) { console.error('[văn phòng] setMap lỗi', e); }
  pushProducts();
  const loading = $('loading');
  if (!ok) {
    loading.hidden = false;
    loading.classList.remove('done');
    setKids(loading.querySelector('.loading-card'),
      el('div', { class: 'loading-icon', text: '🗺️' }),
      el('div', { class: 'loading-title', text: 'Không đọc được bản đồ văn phòng' }),
      el('div', { class: 'loading-sub', text: 'Dữ liệu map từ server không hợp lệ — bảng tin bên phải vẫn hoạt động.' }));
    $('conn-banner').hidden = true;
    if (!deepLinked) { deepLinked = true; applyHash(); }
    return;
  }
  loading.classList.add('done');
  setTimeout(() => { loading.hidden = true; }, 450);
  $('conn-banner').hidden = true;
  if (!deepLinked) { deepLinked = true; applyHash(); }
});

// ---- liên kết sâu (chia sẻ link / chụp màn hình): #tab=live|staff|products|recap|rumors, #profile=<id>, #filter=group
// (mã dev ?dev=/#dev= được net.js đọc và gỡ khỏi URL trước khi tới đây — không bao giờ hiển thị)
let deepLinked = false;
function applyHash() {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const tab = q.get('tab');
  if (tab && TABS.includes(tab)) tabs.activate(tab);
  const filter = q.get('filter');
  if (filter) document.querySelector(`#filters [data-filter="${CSS.escape(filter)}"]`)?.click();
  const pid = q.get('profile');
  if (pid && store.agents.has(pid)) openProfile(pid);
}
window.addEventListener('hashchange', () => { if (store.ready) applyHash(); });

store.on('conn', (state) => {
  const banner = $('conn-banner');
  $('stage').classList.toggle('offline', state !== 'open' && store.ready);
  if (state === 'open') { banner.hidden = true; return; }
  if (store.ready) banner.hidden = false;
  else setText($('loading-sub'), state === 'connecting' ? 'Đang kết nối tới văn phòng…' : 'Đang thử kết nối lại…');
});

store.on('toast', ({ icon, text }) => {
  const tone = /📦|🔥|😱|⚠️/u.test(icon) ? 'hot' : /🎉|💰|🚀|🎂|💸/u.test(icon) ? 'happy' : '';
  toast(icon, text, tone);
});

// ---- tooltip khi rê chuột lên nhân vật / bảng KPI / bảng trắng (một phần tử dùng chung)
const tip = $('hover-tip');
let tipKey = null; // 'agent:<id>' | 'board:kpi' | 'board:whiteboard'
function placeTip(x, y) {
  tip.hidden = false;
  const stage = $('stage').getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let tx = x + 16, ty = y + 16;
  if (tx + tw > stage.width - 8) tx = Math.max(8, x - tw - 12);
  if (ty + th > stage.height - 8) ty = Math.max(8, y - th - 12);
  tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
}
function hideTip(prefix) {
  if (tipKey && !tipKey.startsWith(prefix)) return; // tooltip loại khác đang mở
  tip.hidden = true;
  tipKey = null;
}
function showHoverTip(id, x, y) {
  if (!id) { hideTip('agent:'); return; }
  const a = store.agents.get(id);
  if (!a) { hideTip('agent:'); return; }
  const key = `agent:${id}`;
  if (tipKey !== key || tip.hidden) {
    tipKey = key;
    setKids(tip,
      el('div', { class: 'ht-name' }, el('b', { text: str(a.name, 40) }), el('span', { text: ` · ${str(a.roleLabel, 40)}` })),
      el('div', { class: 'ht-act', text: `${a.emote ? a.emote + ' ' : ''}${activityText(a)}` }),
      el('div', { class: 'ht-hint', text: 'Bấm để xem hồ sơ' }));
  }
  placeTip(x, y);
}
/** nội dung tooltip bảng KPI (danh sách % hôm nay) / bảng trắng (dự án) */
function boardTipKids(kind) {
  const s = store.status;
  if (kind === 'whiteboard') {
    const pr = s?.company?.project;
    if (!pr) return [el('div', { class: 'ht-name' }, el('b', { text: '📋 Bảng trắng phòng họp' })), el('div', { class: 'ht-act', text: 'Chưa có dự án' })];
    const day = num(store.clock?.day, 0);
    const prog = clamp(num(pr.progress), 0, 100);
    const left = num(pr.deadlineDay) - day;
    const due = left > 0 ? `còn ${left} ngày` : left === 0 ? 'hạn hôm nay!' : `trễ ${-left} ngày`;
    return [
      el('div', { class: 'ht-name' }, el('b', { text: `🚀 ${str(pr.name, 80)}` })),
      pr.client ? el('div', { class: 'ht-act', text: `Khách: ${str(pr.client, 80)}` }) : null,
      el('div', { class: 'ht-act' }, el('b', { text: `Tiến độ ${Math.round(prog)}%` }), ` · hạn ngày ${num(pr.deadlineDay)} · ${due}`),
      el('div', { class: 'ht-hint', text: 'Bấm để xem chi tiết dự án' }),
    ];
  }
  const list = store.roster().filter((a) => a.status === 'active');
  const minute = num(store.clock?.minute, 600);
  const co = s?.company || {};
  const pct = co.revenueTarget > 0 ? Math.round((co.revenueMonth / co.revenueTarget) * 100) : 0;
  return [
    el('div', { class: 'ht-name' }, el('b', { text: '📊 Bảng KPI hôm nay' }), el('span', { text: ' · mục tiêu 100%' })),
    list.length
      ? el('div', { class: 'ht-kpi' }, list.map((a) => {
        const ratio = a.kpiTarget > 0 ? a.kpiToday / a.kpiTarget : 0;
        return [
          el('span', { class: 'ht-dot', style: { background: safeColor(a.look?.shirt, '#9ca3af') } }),
          el('span', { class: 'ht-who', text: str(a.name, 30) }),
          el('span', { class: `ht-pct ${kpiPaceTone(ratio, minute, store.rules.kpiLowRatio)}`, text: `${Math.round(ratio * 100)}%` }),
        ];
      }))
      : el('div', { class: 'ht-act', text: 'Chưa có dữ liệu KPI' }),
    el('div', { class: 'ht-act', text: `💰 Doanh thu tháng ${fmtNum(co.revenueMonth)}/${fmtNum(co.revenueTarget)} triệu (${pct}%)` }),
    el('div', { class: 'ht-hint', text: 'Bấm để mở tab Nhân sự' }),
  ];
}
function showBoardTip(kind, clientX, clientY) {
  if (!kind) { hideTip('board:'); return; }
  const key = `board:${kind}`;
  if (tipKey !== key || tip.hidden) { tipKey = key; setKids(tip, boardTipKids(kind)); }
  const stage = $('stage').getBoundingClientRect();
  placeTip(num(clientX) - stage.left, num(clientY) - stage.top);
}
function refreshTip() {
  if (tip.hidden || !tipKey) return;
  if (tipKey.startsWith('agent:')) {
    const a = store.agents.get(tipKey.slice(6));
    const act = tip.querySelector('.ht-act');
    if (a && act) act.textContent = `${a.emote ? a.emote + ' ' : ''}${activityText(a)}`;
  } else if (tipKey.startsWith('board:')) setKids(tip, boardTipKids(tipKey.slice(6)));
}
store.on('agents', refreshTip);
store.on('status', refreshTip);

// ---- gợi ý lần đầu
const hint = $('stage-hint');
setTimeout(() => hint.classList.add('fade'), 9000);
$('office').addEventListener('pointerdown', () => hint.classList.add('fade'), { once: true });

// ---- font tải xong -> vẽ lại layer tĩnh (nhãn phòng)
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => office.refresh()).catch(() => {});
}

connect();
