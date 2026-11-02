// Tab "Bản tin": mỗi ngày một tờ báo văn phòng (mới nhất ở trên).
// v3: tab còn có dải "🗞️ Tin đang bàn" (ui/news.js) và mục "🗂️ Lịch sử" (ui/history.js) ở trên các tờ báo;
// module này chỉ vẽ vào #recap-list.
import { store } from '../store.js';
import { el, setKids, arr, str, num, pct, clamp } from '../util.js';
import { avatarEl } from './avatar.js';
import { kpiTone } from '../labels.js';
import { markUnread } from './tabs.js';

let box;
let onOpen = () => {};

export function initRecaps(openProfile) {
  onOpen = openProfile || onOpen;
  box = document.getElementById('recap-list') || document.getElementById('recaps');
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-agent]');
    if (t) onOpen(t.dataset.agent);
  });
  store.on('recaps', render);
  store.on('recap', () => markUnread('recap'));
}

function render() {
  const list = [...arr(store.recaps)].sort((a, b) => num(b.day) - num(a.day));
  if (!list.length) {
    setKids(box, el('div', { class: 'empty' },
      el('div', { class: 'empty-icon', text: '📰' }),
      el('div', { class: 'empty-title', text: 'Chưa có số báo nào' }),
      el('div', { class: 'empty-text', text: 'Cuối mỗi ngày làm việc (khoảng 18:30), "phóng viên nội bộ" sẽ tổng kết drama, nhân viên của ngày và bảng KPI tại đây.' })));
    return;
  }
  setKids(box, list.map(paper));
}

function paper(r) {
  const kpi = [...arr(r.kpi)].sort((a, b) => num(b.ratio) - num(a.ratio));
  return el('article', { class: 'paper' },
    el('header', { class: 'paper-head' },
      el('div', { class: 'paper-mast', text: 'BẢN TIN VĂN PHÒNG' }),
      el('div', { class: 'paper-meta' },
        el('span', { text: `${str(r.weekday)}${r.weekday ? ', ' : ''}Ngày ${num(r.day)}` }),
        // nguồn bản tin (AI hay câu mẫu): chỉ admin mới thấy
        store.dev ? el('span', { class: `paper-src ${r.source === 'llm' ? 'llm' : ''}`, text: r.source === 'llm' ? '🤖 AI chấp bút' : '🧪 Bản tin mẫu' }) : null)),
    el('h3', { class: 'paper-headline', text: str(r.headline, 200) }),
    arr(r.bullets).length ? el('ul', { class: 'paper-bullets' }, arr(r.bullets).slice(0, 6).map((b) => el('li', { text: str(b, 300) }))) : null,
    r.mvp ? el('div', { class: 'paper-box mvp' },
      el('div', { class: 'paper-box-title', text: '🏆 Nhân viên của ngày' }),
      el('div', { class: 'mvp-row' },
        el('button', { class: 'av-btn', type: 'button', 'data-agent': str(r.mvp.id) }, avatarEl(str(r.mvp.id), str(r.mvp.name), 30)),
        el('div', {}, el('b', { text: str(r.mvp.name, 40) }), el('div', { class: 'mvp-reason', text: str(r.mvp.reason, 240) })))) : null,
    r.drama ? el('div', { class: 'paper-box drama' },
      el('div', { class: 'paper-box-title', text: '🍿 Drama' }),
      el('div', { text: str(r.drama, 400) })) : null,
    kpi.length ? el('table', { class: 'paper-kpi' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Nhân viên' }), el('th', { text: 'KPI' }), el('th', { text: '%' }))),
      el('tbody', {}, kpi.map((k) => {
        const ratio = num(k.ratio);
        const tone = kpiTone(ratio, store.rules.kpiLowRatio);
        return el('tr', { class: `kpi-${tone}` },
          el('td', {}, el('button', { class: 'linkish', type: 'button', 'data-agent': str(k.id), text: str(k.name, 30) }), el('span', { class: 'kpi-role', text: str(k.roleLabel, 30) })),
          el('td', { class: 'kpi-cell' }, el('span', { class: 'kpi-mini' }, el('span', { class: tone, style: { width: `${clamp(ratio, 0, 1) * 100}%` } })), el('span', { class: 'kpi-raw', text: `${Math.round(num(k.kpi))}/${num(k.target)}` })),
          el('td', { class: `pct ${tone}`, text: `${pct(ratio)}%${num(k.lowStreak) >= store.rules.kpiWarnDays ? ' ⚠️' : ''}` }));
      }))) : null);
}
