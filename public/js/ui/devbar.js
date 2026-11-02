// Bảng dev nổi góc dưới trái canvas (chỉ hiện khi hello.dev = true).
import { store } from '../store.js';
import { el } from '../util.js';
import { DEV_EVENTS, SPEEDS } from '../labels.js';
import { toast } from './toasts.js';
import { forgetDevToken } from '../net.js';

let bar, speedBtns = [];
let sendFn = () => false;
const KEY = 'vpa.devbar.collapsed';

export function initDevbar(send) {
  sendFn = send;
  bar = document.getElementById('devbar');
  const collapsed = localStorage.getItem(KEY) === '1' || window.matchMedia('(max-width: 899px)').matches && localStorage.getItem(KEY) !== '0';
  const toggle = el('button', { class: 'dev-toggle', type: 'button', 'aria-expanded': collapsed ? 'false' : 'true', title: 'Bảng điều khiển dev' }, '🛠️', el('span', { class: 'dev-toggle-text', text: 'Dev' }));
  const speeds = el('div', { class: 'dev-speeds', role: 'group', 'aria-label': 'Tốc độ thời gian' });
  speedBtns = SPEEDS.map((v) => {
    const b = el('button', { class: 'dev-speed', type: 'button', 'data-speed': String(v), text: `x${v}`, 'aria-label': `Tốc độ x${v}` });
    b.addEventListener('click', () => {
      if (store.clock?.timeMode === 'realtime') { toast('🕒', 'Chế độ giờ thật — không tua được thời gian'); return; }
      if (sendFn({ t: 'dev', action: 'speed', value: v })) highlight(v);
      else toast('⚠️', 'Chưa kết nối server', 'warn');
    });
    return b;
  });
  speeds.append(el('span', { class: 'dev-label', text: '⏩' }), ...speedBtns);
  const events = el('div', { class: 'dev-events' });
  for (const [name, icon, label] of DEV_EVENTS) {
    const b = el('button', { class: 'dev-ev', type: 'button', 'data-tip': label, 'aria-label': label }, el('span', { text: icon }));
    b.addEventListener('click', () => {
      if (sendFn({ t: 'dev', action: 'event', name })) {
        b.classList.add('sent');
        setTimeout(() => b.classList.remove('sent'), 600);
      } else toast('⚠️', 'Chưa kết nối server', 'warn');
    });
    events.append(b);
  }
  // 🚪 Thoát admin: quên mã dev đã lưu trong trình duyệt này rồi tải lại (vào lại bằng link có #dev=…)
  const logout = el('button', { class: 'dev-ev dev-logout', type: 'button', 'data-tip': 'Thoát admin (quên mã trên trình duyệt này)', 'aria-label': 'Thoát admin' }, el('span', { text: '🚪' }));
  logout.addEventListener('click', () => {
    if (window.confirm('Thoát chế độ admin trên trình duyệt này? Muốn vào lại thì mở link có mã dev.')) forgetDevToken();
  });
  const panel = el('div', { class: 'dev-panel' }, speeds, el('span', { class: 'dev-sep' }), events, el('span', { class: 'dev-sep' }), logout);
  bar.append(toggle, panel);
  bar.classList.toggle('collapsed', collapsed);
  toggle.addEventListener('click', () => {
    const c = !bar.classList.contains('collapsed');
    bar.classList.toggle('collapsed', c);
    toggle.setAttribute('aria-expanded', c ? 'false' : 'true');
    try { localStorage.setItem(KEY, c ? '1' : '0'); } catch { /* bỏ qua */ }
  });
  store.on('hello', () => {
    bar.hidden = !store.dev;
    document.body.classList.toggle('has-devbar', !!store.dev);
    highlight(store.status?.speed || store.clock?.speed || 1);
  });
  store.on('status', (s) => highlight(s?.speed || store.clock?.speed || 1));
}

function highlight(v) {
  for (const b of speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === Number(v));
}
