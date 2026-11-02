// Ngăn kéo hồ sơ nhân viên: chân dung, tiểu sử, sở thích, tính cách, chỉ số trực tiếp,
// lịch sử KPI (sparkline), quan hệ (thân / ghét), ký ức, món đồ trên bàn (link tiếp thị).
import { store } from '../store.js';
import { el, setKids, svg, clamp, num, str, arr, pct, fmtClock, safeProductUrl } from '../util.js';
import { statusBadge, activityText, TRAIT_LABELS, kpiPaceTone } from '../labels.js';
import { avatarEl, portraitEl } from './avatar.js';

let drawer, backdrop, body, current = null;
let openedAt = 0; // lúc mở ngăn kéo (chặn "ghost click" của thao tác chạm)
let lastFocus = null;
let showAllRel = false;
let onLocate = () => {};

export function initProfile(locate) {
  onLocate = locate || onLocate;
  drawer = document.getElementById('drawer');
  backdrop = document.getElementById('drawer-backdrop');
  body = drawer.querySelector('.drawer-body');
  drawer.querySelector('.drawer-close').addEventListener('click', closeProfile);
  // chạm trên điện thoại: sau touchend trình duyệt mới sinh "click" tại chỗ chạm — lúc đó lớp nền đã hiện
  // và nhận cú click đó -> ngăn kéo vừa mở đã đóng. Bỏ qua click vào nền trong ~0,5 s đầu.
  backdrop.addEventListener('click', () => { if (performance.now() - openedAt > 500) closeProfile(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closeProfile(); });
  drawer.addEventListener('click', (e) => {
    const t = e.target.closest('[data-agent]');
    if (t && t.dataset.agent !== current) openProfile(t.dataset.agent);
    if (e.target.closest('.rel-more')) { showAllRel = !showAllRel; render(true); }
    if (e.target.closest('.locate-btn')) { onLocate(current); if (window.matchMedia('(max-width: 899px)').matches) closeProfile(); }
  });
  store.on('agents', () => { if (current) render(true); });
  store.on('hello', () => { if (current && !store.agents.has(current)) closeProfile(); else if (current) render(false); });
}

export function openProfile(id) {
  if (!id || !store.agents.has(id)) return;
  if (!current) lastFocus = document.activeElement;
  current = id;
  showAllRel = false;
  render(false);
  openedAt = performance.now();
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('show'));
  body.scrollTop = 0;
  drawer.querySelector('.drawer-close').focus({ preventScroll: true });
}

export function closeProfile() {
  current = null;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('show');
  setTimeout(() => { if (!current) backdrop.hidden = true; }, 250);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

function statBar(label, icon, value, tone) {
  const v = clamp(num(value), 0, 100);
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-label', text: `${icon} ${label}` }),
    el('span', { class: `stat-bar ${tone}` }, el('span', { style: { width: `${v}%` } })),
    el('span', { class: 'stat-num', text: String(Math.round(v)) }));
}

function section(title, ...kids) {
  return el('section', { class: 'pf-sec' }, el('h4', { class: 'pf-h', text: title }), ...kids);
}

function sparkline(history, target = 1) {
  const W = 300, H = 92, P = 8;
  const low = store.rules.kpiLowRatio;
  const pts = arr(history).slice(-14);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': 'Lịch sử KPI 14 ngày' });
  const maxR = Math.max(1.3, ...pts.map((p) => num(p.ratio)));
  const GUT = 46; // lề phải dành cho nhãn ngưỡng
  const PW = W - GUT;
  const y = (r) => H - P - (clamp(r, 0, maxR) / maxR) * (H - 2 * P);
  const x = (i) => (pts.length <= 1 ? PW / 2 : P + (i * (PW - 2 * P)) / (pts.length - 1));
  // vùng nền + vạch mục tiêu 100% / ngưỡng 70%
  root.append(svg('rect', { x: 0, y: 0, width: PW, height: y(target), fill: 'rgba(34,197,94,0.07)' }));
  root.append(svg('line', { x1: 0, x2: PW, y1: y(target), y2: y(target), stroke: '#22c55e', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
  root.append(svg('line', { x1: 0, x2: PW, y1: y(low), y2: y(low), stroke: '#f59e0b', 'stroke-dasharray': '3 4', 'stroke-width': 1 }));
  const tl = svg('text', { x: PW + 5, y: y(target) + 3.5, 'text-anchor': 'start', class: 'spark-label' });
  tl.textContent = '100%';
  root.append(tl);
  const tl2 = svg('text', { x: PW + 5, y: y(low) + 3.5, 'text-anchor': 'start', class: 'spark-label warn' });
  tl2.textContent = `${Math.round(low * 100)}%`;
  root.append(tl2);
  if (!pts.length) {
    const t = svg('text', { x: W / 2, y: H / 2 + 4, 'text-anchor': 'middle', class: 'spark-empty' });
    t.textContent = 'Chưa có dữ liệu — KPI được chấm cuối ngày';
    root.append(t);
    return root;
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(num(p.ratio)).toFixed(1)}`).join(' ');
  root.append(svg('path', { d: `${d} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`, fill: 'rgba(255,122,69,0.12)' }));
  root.append(svg('path', { d, fill: 'none', stroke: '#ff7a45', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  pts.forEach((p, i) => {
    const r = num(p.ratio);
    const c = svg('circle', { cx: x(i), cy: y(r), r: 3.6, fill: r >= 1 ? '#22c55e' : r >= low ? '#f59e0b' : '#ef4444', stroke: '#fff', 'stroke-width': 1.5 });
    const tt = svg('title', {});
    tt.textContent = `Ngày ${num(p.day)}: ${pct(r)}%`;
    c.append(tt);
    root.append(c);
  });
  return root;
}

function relRow(id, rel) {
  const s = clamp(num(rel.score), -100, 100);
  const name = store.name(id);
  const pos = s >= 0;
  return el('div', { class: 'rel' },
    el('button', { class: 'av-btn', type: 'button', 'data-agent': id }, avatarEl(id, name, 28)),
    el('div', { class: 'rel-main' },
      el('div', { class: 'rel-top' },
        el('button', { class: 'linkish', type: 'button', 'data-agent': id, text: name }),
        el('span', { class: `rel-score ${pos ? 'pos' : 'neg'}`, text: `${s > 0 ? '+' : ''}${Math.round(s)}` })),
      el('div', { class: 'rel-bar' }, el('span', { class: pos ? 'pos' : 'neg', style: { width: `${Math.abs(s) / 2}%`, [pos ? 'left' : 'right']: '50%' } })),
      rel.note ? el('div', { class: 'rel-note', text: str(rel.note, 140) }) : null));
}

function render(keepScroll) {
  const a = store.agents.get(current);
  if (!a) { closeProfile(); return; }
  const scroll = body.scrollTop;
  const [btext, tone] = statusBadge(a);
  const ratio = a.kpiTarget > 0 ? a.kpiToday / a.kpiTarget : 0;
  const traits = a.traits || {};
  const rels = Object.entries(a.relationships || {})
    .filter(([id]) => id !== a.id && (store.agents.has(id) || store.nameCache.has(id)))
    .map(([id, r]) => [id, r || { score: 0, note: '' }]);
  const friends = rels.filter(([, r]) => num(r.score) > 0).sort((p, q) => num(q[1].score) - num(p[1].score));
  const enemies = rels.filter(([, r]) => num(r.score) < 0).sort((p, q) => num(p[1].score) - num(q[1].score));
  const memories = [...arr(a.memories)].sort((p, q) => (num(q.day) * 1440 + num(q.minute)) - (num(p.day) * 1440 + num(p.minute)));
  const item = a.deskItem;
  const itemUrl = item ? safeProductUrl(item.url) : null;
  const atRisk = a.role !== 'boss' && a.role !== 'hr' && num(a.lowStreak) >= store.rules.kpiWarnDays;
  // v3 (nếu server gửi): thử thách tới ngày N, số lần được thưởng / thăng chức, tính cách gốc
  const today = num(store.clock?.day, 0);
  const probation = num(a.probationUntilDay, 0);
  const onProbation = a.status === 'active' && probation > 0 && probation >= today;
  const bonuses = Math.max(0, Math.round(num(a.bonuses, 0)));
  const promotions = Math.max(0, Math.round(num(a.promotions, 0)));
  const base = a.traitBase && typeof a.traitBase === 'object' ? a.traitBase : null;

  setKids(body,
    el('div', { class: 'pf-hero' },
      el('div', { class: 'pf-portrait' }, portraitEl(a, 104, true)),
      el('div', { class: 'pf-id' },
        el('h3', { class: 'pf-name', text: str(a.name, 40) }),
        el('div', { class: 'pf-full', text: str(a.fullName, 60) }),
        el('div', { class: 'pf-role', text: `${str(a.roleLabel)} · ${num(a.age)} tuổi · ${a.gender === 'nữ' ? 'Nữ' : 'Nam'}` }),
        el('div', { class: 'pf-badges' },
          el('span', { class: `badge tone-${tone}`, text: btext }),
          num(a.warnings) > 0 ? el('span', { class: 'badge tone-warn', text: `⚠️ ${num(a.warnings)} lần cảnh cáo` }) : null,
          onProbation ? el('span', { class: 'badge tone-warn', title: 'HR đưa vào thử thách — KPI phải khá lên trước hạn', text: `⏳ đang thử thách tới ngày ${probation}` }) : null,
          atRisk ? el('span', { class: 'badge tone-danger', text: '🔥 nguy cơ bị đuổi' }) : null,
          bonuses > 0 ? el('span', { class: 'badge tone-ok', text: `🎁 ${bonuses} lần được thưởng` }) : null,
          promotions > 0 ? el('span', { class: 'badge tone-info', text: `🎖️ ${promotions} lần thăng chức` }) : null),
        el('div', { class: 'pf-since', text: `Vào làm từ ngày ${num(a.hiredDay, 1)}` }),
        a.present ? el('button', { class: 'locate-btn', type: 'button', text: '📍 Xem trên bản đồ' }) : null)),
    a.bio ? el('p', { class: 'pf-bio', text: str(a.bio, 600) }) : null,
    section('⚡ Bây giờ',
      el('div', { class: 'pf-now' }, el('span', { class: 'pf-now-emote', text: a.present ? str(a.emote || '•', 8) : '🏠' }), el('span', { text: activityText(a) })),
      statBar('Năng lượng', '⚡', a.energy, num(a.energy) < 30 ? 'low' : 'ok'),
      statBar('Tâm trạng', '😊', a.mood, num(a.mood) < 35 ? 'low' : 'mood'),
      statBar('Căng thẳng', '😰', a.stress, num(a.stress) > 70 ? 'low' : 'stress'),
      el('div', { class: 'pf-kpi' },
        el('div', { class: 'pf-kpi-top' }, el('b', { text: 'KPI hôm nay' }), el('span', { text: `${Math.round(num(a.kpiToday))}/${num(a.kpiTarget)} điểm · ${pct(ratio)}%` })),
        el('div', { class: 'kpi-bar big' }, el('span', { class: kpiPaceTone(ratio, store.clock?.minute ?? 0, store.rules.kpiLowRatio), style: { width: `${clamp(ratio, 0, 1) * 100}%` } }))),
      num(a.caughtToday) > 0 ? el('div', { class: 'pf-caught', text: `😱 Bị sếp bắt quả tang ${num(a.caughtToday)} lần hôm nay` }) : null,
      num(a.lowStreak) > 0 ? el('div', { class: 'pf-caught', text: `📉 KPI thấp ${num(a.lowStreak)} ngày liên tiếp` }) : null),
    section('📈 Lịch sử KPI', sparkline(a.kpiHistory)),
    section('🧬 Tính cách',
      el('div', { class: 'traits' }, TRAIT_LABELS.map(([k, label, color]) => {
        const v = clamp(num(traits[k]), 0, 1);
        // v3: chấm nhỏ = tính cách gốc (traitBase); thanh = hiện tại (đã "trôi" theo trải nghiệm)
        const b = base && Number.isFinite(Number(base[k])) ? clamp(num(base[k]), 0, 1) : null;
        const delta = b == null ? 0 : Math.round(v * 10) - Math.round(b * 10);
        return el('div', { class: 'trait', title: b == null ? null : `${label}: gốc ${Math.round(b * 10)}/10 → hiện tại ${Math.round(v * 10)}/10` },
          el('span', { class: 'trait-label', text: label }),
          el('span', { class: 'trait-bar' },
            el('span', { style: { width: `${v * 100}%`, background: color } }),
            b == null ? null : el('i', { class: 'trait-base', 'aria-hidden': 'true', style: { left: `${clamp(b, 0.04, 0.96) * 100}%` } })),
          el('span', { class: 'trait-num', text: `${Math.round(v * 10)}/10` },
            delta ? el('small', { class: `trait-delta ${delta > 0 ? 'up' : 'down'}`, 'aria-label': delta > 0 ? 'tăng so với gốc' : 'giảm so với gốc', text: delta > 0 ? '▲' : '▼' }) : null));
      })),
      base ? el('div', { class: 'pf-note', text: 'Chấm đen = tính cách gốc lúc vào công ty; thanh màu = hiện tại, trôi dần theo những gì đã trải qua.' }) : null),
    (arr(a.quirks).length || arr(a.likes).length || arr(a.dislikes).length) ? section('🎭 Thói quen & sở thích',
      arr(a.quirks).length ? el('ul', { class: 'quirks' }, arr(a.quirks).slice(0, 6).map((q) => el('li', { text: str(q, 140) }))) : null,
      el('div', { class: 'chips-row' },
        arr(a.likes).slice(0, 8).map((x) => el('span', { class: 'tag like', text: `💚 ${str(x, 40)}` })),
        arr(a.dislikes).slice(0, 8).map((x) => el('span', { class: 'tag dislike', text: `💔 ${str(x, 40)}` })))) : null,
    rels.length ? section('💞 Quan hệ',
      friends.length ? el('div', { class: 'rel-group' }, el('div', { class: 'rel-title', text: '🤝 Thân nhất' }), (showAllRel ? friends : friends.slice(0, 3)).map(([id, r]) => relRow(id, r))) : null,
      enemies.length ? el('div', { class: 'rel-group' }, el('div', { class: 'rel-title', text: '😤 Không ưa' }), (showAllRel ? enemies : enemies.slice(0, 3)).map(([id, r]) => relRow(id, r))) : null,
      (friends.length > 3 || enemies.length > 3) ? el('button', { class: 'rel-more', type: 'button', text: showAllRel ? 'Thu gọn' : `Xem tất cả (${friends.length + enemies.length})` }) : null) : null,
    section('🧠 Ký ức gần đây',
      memories.length
        ? el('ul', { class: 'memories' }, memories.slice(0, 10).map((m) => el('li', {}, el('time', { class: 'when', text: `Ngày ${num(m.day)} · ${fmtClock(m.minute)}` }), el('span', { text: str(m.text, 200) }))))
        : el('div', { class: 'muted', text: 'Chưa có ký ức đáng nhớ nào.' })),
    item && item.name ? section('🛍️ Món đồ trên bàn',
      el('div', { class: 'prod prod-card' },
        el(itemUrl ? 'a' : 'div', itemUrl ? { class: 'prod-chip big', href: itemUrl, target: '_blank', rel: 'noopener sponsored' } : { class: 'prod-chip big' },
          el('span', { class: 'prod-emoji big', text: str(item.emoji || '🛍️', 8) }),
          el('span', { class: 'prod-info' },
            el('span', { class: 'prod-name', text: str(item.name, 90) }),
            el('span', { class: 'prod-price', text: `${str(item.priceHint || '', 20)}${itemUrl ? ' — Xem trên Shopee ↗' : ''}` }))),
        el('div', { class: 'prod-cap', text: 'Link tiếp thị liên kết' }))) : null,
  );
  if (keepScroll) body.scrollTop = scroll;
}
