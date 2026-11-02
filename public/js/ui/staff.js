// Tab "Nhân sự": thẻ từng người theo thứ tự phòng ban, cập nhật tại chỗ mỗi 2 giây.
import { store } from '../store.js';
import { el, setText, setKids, clamp, pct, num, str } from '../util.js';
import { statusBadge, activityText, kpiPaceTone } from '../labels.js';
import { portraitEl } from './avatar.js';

let box, summary, list;
const cards = new Map(); // id -> refs
let onOpen = () => {};

export function initStaff(openProfile) {
  onOpen = openProfile || onOpen;
  box = document.getElementById('staff');
  summary = el('div', { class: 'staff-summary' });
  list = el('div', { class: 'staff-list' });
  box.append(summary, list);
  list.addEventListener('click', (e) => {
    const c = e.target.closest('.staff-card');
    if (c) onOpen(c.dataset.id);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.staff-card');
    if (c) { e.preventDefault(); onOpen(c.dataset.id); }
  });
  store.on('hello', () => { cards.clear(); list.replaceChildren(); render(); });
  store.on('agents', render);
}

function bar(cls) {
  const fill = el('b');
  return { node: el('i', { class: `mbar ${cls}` }, fill), fill };
}

function buildCard(a) {
  const badge = el('span', { class: 'badge' });
  const warn = el('span', { class: 'warn-chip', hidden: true });
  const name = el('span', { class: 'st-name-text' });
  const role = el('div', { class: 'st-role' });
  const act = el('div', { class: 'st-act' });
  const kpiFill = el('span');
  const kpiBar = el('div', { class: 'kpi-bar' }, kpiFill);
  const kpiNum = el('span', { class: 'kpi-num' });
  const e = bar('energy'), m = bar('mood'), s = bar('stress');
  const risk = el('div', { class: 'risk', hidden: true, text: '🔥 nguy cơ bị đuổi' });
  const portraitBox = el('span', { class: 'st-portrait' }, portraitEl(a, 46));
  const node = el('div', { class: 'staff-card', 'data-id': a.id, tabindex: '0', role: 'button' },
    el('div', { class: 'st-top' },
      portraitBox,
      el('div', { class: 'st-id' }, el('div', { class: 'st-name' }, name, warn), role),
      badge),
    act,
    el('div', { class: 'st-kpi' }, el('span', { class: 'st-kpi-label', text: 'KPI' }), kpiBar, kpiNum),
    el('div', { class: 'st-mini' },
      el('span', { class: 'mini', title: 'Năng lượng' }, '⚡', e.node),
      el('span', { class: 'mini', title: 'Tâm trạng' }, '😊', m.node),
      el('span', { class: 'mini', title: 'Căng thẳng' }, '😰', s.node)),
    risk);
  return { node, badge, warn, name, role, act, kpiFill, kpiNum, e, m, s, risk, portraitBox, look: JSON.stringify(a.look || {}), status: a.status };
}

function render() {
  const roster = store.roster();
  const ids = new Set(roster.map((a) => a.id));
  for (const [id, c] of cards) if (!ids.has(id)) { c.node.remove(); cards.delete(id); }
  let present = 0, active = 0, kpiSum = 0, kpiN = 0;
  roster.forEach((a, i) => {
    let c = cards.get(a.id);
    if (!c) { c = buildCard(a); cards.set(a.id, c); }
    const lk = JSON.stringify(a.look || {});
    if (lk !== c.look || c.status !== a.status) {
      c.portraitBox.replaceChildren(portraitEl(a, 46));
      c.look = lk; c.status = a.status;
    }
    if (list.children[i] !== c.node) list.insertBefore(c.node, list.children[i] || null);
    update(c, a);
    if (a.status === 'active') {
      active++;
      if (a.present) present++;
      if (a.role !== 'boss' && a.kpiTarget > 0) { kpiSum += a.kpiToday / a.kpiTarget; kpiN++; }
    }
  });
  const avg = kpiN ? Math.round((kpiSum / kpiN) * 100) : 0;
  setKids(summary,
    el('span', {}, '👥 ', el('b', { text: String(active) }), ' nhân sự'),
    el('span', {}, '🟢 ', el('b', { text: String(present) }), ' có mặt'),
    el('span', {}, '📊 KPI TB ', el('b', { text: `${avg}%` })));
}

function update(c, a) {
  const [btext, tone] = statusBadge(a);
  setText(c.badge, btext);
  c.badge.className = `badge tone-${tone}`;
  setText(c.name, a.name || a.id);
  setText(c.role, a.roleLabel || '');
  setText(c.act, `${a.present && a.emote ? a.emote + ' ' : ''}${activityText(a)}`);
  const ratio = a.kpiTarget > 0 ? a.kpiToday / a.kpiTarget : 0;
  c.kpiFill.style.width = `${clamp(ratio, 0, 1) * 100}%`;
  const pace = kpiPaceTone(ratio, store.clock?.minute ?? 0, store.rules.kpiLowRatio);
  c.kpiFill.className = pace;
  c.kpiFill.parentElement.title = pace === 'ok' ? 'KPI hôm nay: đúng / vượt tiến độ' : pace === 'mid' ? 'KPI hôm nay: hơi chậm so với giờ này' : 'KPI hôm nay: chậm so với giờ này';
  setText(c.kpiNum, `${Math.round(num(a.kpiToday))}/${num(a.kpiTarget)} · ${pct(ratio)}%`);
  c.e.fill.style.width = `${clamp(num(a.energy), 0, 100)}%`;
  c.m.fill.style.width = `${clamp(num(a.mood), 0, 100)}%`;
  c.s.fill.style.width = `${clamp(num(a.stress), 0, 100)}%`;
  c.s.node.classList.toggle('high', num(a.stress) > 70);
  c.e.node.classList.toggle('low', num(a.energy) < 30);
  const w = num(a.warnings);
  c.warn.hidden = w <= 0;
  if (w > 0) setText(c.warn, `⚠️ ${w}`);
  c.warn.title = w > 0 ? `${w} lần bị HR nhắc nhở` : '';
  const atRisk = a.status === 'active' && a.role !== 'boss' && a.role !== 'hr' && num(a.lowStreak) >= store.rules.kpiWarnDays;
  c.risk.hidden = !atRisk;
  if (atRisk) setText(c.risk, `🔥 nguy cơ bị đuổi · KPI thấp ${num(a.lowStreak)} ngày liền`);
  c.node.classList.toggle('absent', !a.present && a.status === 'active');
  c.node.classList.toggle('fired', a.status === 'fired');
  c.node.classList.toggle('candidate', a.status === 'candidate');
  c.node.classList.toggle('in-scene', !!a.sceneId);
  c.node.setAttribute('aria-label', `${str(a.name)} — ${str(a.roleLabel)} — ${btext}`);
}
