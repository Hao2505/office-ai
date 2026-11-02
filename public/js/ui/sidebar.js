// Sidebar: tay kéo đổi độ rộng (260–520 px, nhớ trong localStorage), nút thu gọn / mở lại,
// dải ticker ở đáy canvas khi thu gọn (chạy 2–3 dòng thoại mới nhất kèm tên người nói).
import { store } from '../store.js';
import { el, setKids, clamp, lsGet, lsSet, str, arr, stripIcon, isMobile } from '../util.js';

const KEY_W = 'vpa.sidebar.w';
const KEY_C = 'vpa.sidebar.collapsed';
export const SB_MIN = 260, SB_MAX = 520, SB_DEFAULT = 320;
const $ = (id) => document.getElementById(id);
const listeners = new Set();

let main, handle, collapseBtn, expandBtn, ticker, tkBody;
let width = SB_DEFAULT;
let collapsed = false;
const tk = { items: [], idx: 0, timer: 0 };
const TK_MAX = 3;
const TK_EVERY = 4500;

export function initSidebar() {
  main = $('main');
  handle = $('sb-handle');
  collapseBtn = $('sb-collapse');
  expandBtn = $('sb-expand');
  ticker = $('ticker');
  tkBody = $('tk-body');

  width = clamp(Math.round(Number(lsGet(KEY_W, SB_DEFAULT))) || SB_DEFAULT, SB_MIN, SB_MAX);
  applyWidth(width);
  setCollapsed(lsGet(KEY_C) === '1', false);

  // --- kéo đổi độ rộng (pointer capture trên tay kéo)
  handle.addEventListener('pointerdown', (e) => {
    if (isMobile() || e.button !== 0) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    const sx = e.clientX, sw = width;
    document.body.classList.add('resizing');
    const move = (ev) => applyWidth(clamp(sw - (ev.clientX - sx), SB_MIN, SB_MAX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      lsSet(KEY_W, width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => { applyWidth(SB_DEFAULT); lsSet(KEY_W, SB_DEFAULT); });
  handle.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? 20 : e.key === 'ArrowRight' ? -20 : e.key === 'Home' ? SB_MAX - width : e.key === 'End' ? SB_MIN - width : 0;
    if (!d) return;
    e.preventDefault();
    applyWidth(clamp(width + d, SB_MIN, SB_MAX));
    lsSet(KEY_W, width);
  });

  collapseBtn.addEventListener('click', () => setCollapsed(true, true));
  expandBtn.addEventListener('click', () => setCollapsed(false, true));

  // --- ticker: học từ lịch sử rồi theo dõi dòng mới
  store.on('hello', (msg) => {
    tk.items = [];
    for (const e of arr(msg.log).slice(-40)) pushTicker(e);
    tk.idx = Math.max(0, tk.items.length - 1);
    renderTicker();
  });
  store.on('log', ({ entry }) => {
    if (pushTicker(entry)) { tk.idx = tk.items.length - 1; renderTicker(); }
  });
}

/** fn(collapsed: boolean) — feed dùng để cuộn xuống cuối khi mở lại */
export function onSidebarToggle(fn) { listeners.add(fn); }
export const isCollapsed = () => collapsed;
export const sidebarWidth = () => width;

function applyWidth(w) {
  width = w;
  main.style.setProperty('--sidebar-w', `${w}px`);
  handle.setAttribute('aria-valuenow', String(w));
}

function setCollapsed(c, persist) {
  collapsed = !!c;
  document.body.classList.toggle('sb-collapsed', collapsed);
  ticker.hidden = !collapsed;
  collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (persist) lsSet(KEY_C, collapsed ? '1' : '0');
  if (collapsed) { renderTicker(); startTicker(); } else stopTicker();
  for (const fn of listeners) { try { fn(collapsed); } catch { /* bỏ qua */ } }
  if (persist) (collapsed ? expandBtn : collapseBtn).focus({ preventScroll: true });
}

// ---------------------------------------------------------------- ticker
function pushTicker(e) {
  if (!e || typeof e !== 'object' || typeof e.text !== 'string' || !e.text.trim()) return false;
  if (e.kind === 'scene_start' || e.kind === 'scene_end') return false;
  let item;
  if (e.kind === 'line') {
    const ch = e.channel || 'office';
    item = { icon: ch === 'group' ? '📱' : ch === 'company' ? '🏢' : '💬', who: str(e.speakerName || store.name(e.speaker), 40), text: str(e.text, 220) };
  } else item = { icon: str(e.icon || '🔔', 8), who: '', text: stripIcon(str(e.text, 220), e.icon) };
  tk.items.push(item);
  while (tk.items.length > TK_MAX) tk.items.shift();
  return true;
}

function renderTicker() {
  if (!collapsed) return;
  if (!tk.items.length) { setKids(tkBody, el('span', { class: 'tk-empty', text: 'Văn phòng còn yên ắng…' })); return; }
  tk.idx = ((tk.idx % tk.items.length) + tk.items.length) % tk.items.length;
  const it = tk.items[tk.idx];
  setKids(tkBody, el('div', { class: 'tk-item' },
    el('span', { class: 'tk-ic', 'aria-hidden': 'true', text: it.icon }),
    it.who ? el('span', { class: 'tk-who', text: `${it.who}:` }) : null,
    el('span', { class: 'tk-text', text: it.text })));
}

function startTicker() {
  stopTicker();
  tk.timer = setInterval(() => {
    if (document.visibilityState === 'hidden' || tk.items.length < 2) return;
    tk.idx = (tk.idx + 1) % tk.items.length;
    renderTicker();
  }, TK_EVERY);
}
function stopTicker() { clearInterval(tk.timer); tk.timer = 0; }
