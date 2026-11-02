// HUD mỏng nổi trên canvas (thay thanh trên cùng cũ): đồng hồ + tiến độ ngày ở góc trái,
// các chip gọn 🚀 💰 👀 (+ badge sự cố) ở góc phải. Rê chuột / bấm / focus vào chip -> popover chi tiết.
// Popover chỉ đóng khi bấm ra ngoài, Esc, đổi cỡ cửa sổ — feed tự cuộn KHÔNG làm nó tắt.
// Người xem thường không thấy gì về "hệ thống" (nguồn AI, lượt gọi, lỗi, số bấm link…) — chỉ thấy chuyện công ty.
// Admin (mở trang kèm mã dev → store.dev) có thêm chip 🤖 AI với popover chi tiết (nguồn, model, lỗi gần nhất, token, chi phí)
// và số lượt bấm link trong popover 👀.
// Sếp có mặt / đi vắng: không có chip riêng, xem biển "ĐI VẮNG" ngay trên phòng Giám đốc trong bản đồ.
import { store } from '../store.js';
import { el, setKids, setText, fmtClock, fmtNum, fmtUsd, fmtUsdShort, fmtTokens, clamp, str, num } from '../util.js';
import { DAY_START_MIN, DAY_END_MIN, aiProviderName, aiFullLabel, providerStateLabel } from '../labels.js';

const $ = (id) => document.getElementById(id);
let lastClockKey = '';
let pop = null, chips = null, stage = null;
let openChip = null;   // chip đang mở popover
let pinned = false;    // mở bằng bấm: giữ tới khi bấm ra ngoài / Esc
let closeTimer = 0;

export function initHud() {
  pop = $('popover');
  chips = $('chips');
  stage = $('stage');
  store.on('hello', () => { lastClockKey = ''; renderClock(); renderStatus(); });
  store.on('frame', renderClock);
  store.on('status', renderStatus);
  store.on('conn', (c) => {
    if (c !== 'open') setText($('clock-day'), store.ready ? 'Mất kết nối…' : 'Đang kết nối…');
  });

  const chipOf = (t) => (t instanceof Element ? t.closest('.chip') : null);
  // chuột: rê vào mở tạm, bấm để ghim
  chips.addEventListener('mouseover', (e) => {
    const c = chipOf(e.target);
    if (c && !pinned && c !== openChip) open(c, false);
    if (c) clearTimeout(closeTimer);
  });
  chips.addEventListener('mouseout', (e) => {
    const c = chipOf(e.target);
    if (c && !pinned && !c.contains(e.relatedTarget) && !pop.contains(e.relatedTarget)) scheduleClose();
  });
  pop.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  pop.addEventListener('mouseleave', () => { if (!pinned) scheduleClose(); });
  chips.addEventListener('click', (e) => {
    const c = chipOf(e.target);
    if (!c) return;
    if (pinned && openChip === c) close();
    else open(c, true);
  });
  // bàn phím
  chips.addEventListener('focusin', (e) => { const c = chipOf(e.target); if (c && !pinned) open(c, false); });
  chips.addEventListener('focusout', (e) => {
    if (!pinned && !(e.relatedTarget instanceof Node && (chips.contains(e.relatedTarget) || pop.contains(e.relatedTarget)))) scheduleClose();
  });
  document.addEventListener('pointerdown', (e) => {
    if (openChip && !(e.target instanceof Node && (chips.contains(e.target) || pop.contains(e.target)))) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openChip) { const c = openChip; close(); c.focus({ preventScroll: true }); }
  });
  window.addEventListener('resize', () => { if (openChip) position(); });
  chips.addEventListener('scroll', () => { if (openChip) position(); }, { passive: true });
  $('hud').addEventListener('scroll', () => { if (openChip) position(); }, { passive: true });
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, 140);
}

function open(chip, pin) {
  clearTimeout(closeTimer);
  if (openChip && openChip !== chip) openChip.classList.remove('open');
  openChip = chip;
  pinned = pin || (pinned && openChip === chip);
  chip.classList.add('open');
  renderPop();
  pop.hidden = false;
  position();
}

function close() {
  clearTimeout(closeTimer);
  if (openChip) openChip.classList.remove('open');
  openChip = null;
  pinned = false;
  pop.hidden = true;
}

function position() {
  if (!openChip || pop.hidden) return;
  const r = openChip.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  // căn mép phải popover theo mép phải chip (chip nằm góc phải), kẹp trong khung canvas
  let x = r.right - s.left - pw;
  x = clamp(x, 8, Math.max(8, s.width - pw - 8));
  let y = r.bottom - s.top + 6;
  if (y + ph > s.height - 8) y = Math.max(8, r.top - s.top - ph - 6);
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}

function renderPop() {
  if (!openChip) return;
  const s = store.status;
  const id = openChip.id;
  let kids;
  switch (id) {
    case 'chip-project': kids = projectPop(s); break;
    case 'chip-revenue': kids = revenuePop(s); break;
    case 'chip-viewers': kids = viewersPop(s); break;
    case 'chip-incident': kids = incidentPop(s); break;
    case 'chip-ai': kids = store.dev ? aiPop(s?.ai) : []; break;
    default: kids = [];
  }
  setKids(pop, kids);
}

// ---------------------------------------------------------------- đồng hồ
function renderClock() {
  const c = store.clock;
  if (!c) return;
  const key = `${Math.floor(c.minute)}|${c.day}|${c.speed}|${c.timeMode}`;
  if (key === lastClockKey) return;
  lastClockKey = key;
  setText($('clock-time'), fmtClock(c.minute));
  setText($('clock-day'), `${str(c.weekday, 20) || ''}${c.weekday ? ' · ' : ''}Ngày ${num(c.day, 1)}`);
  const p = clamp((c.minute - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN), 0, 1);
  $('clock-fill').style.width = `${(p * 100).toFixed(1)}%`;
  const sp = $('clock-speed');
  if (c.timeMode === 'realtime') { sp.hidden = false; setText(sp, '🕒 giờ thật'); }
  else if (c.speed > 1) { sp.hidden = false; setText(sp, `x${c.speed}`); }
  else sp.hidden = true;
  const night = c.isNight || c.minute >= DAY_END_MIN || c.minute < 7 * 60;
  $('hud-clock').classList.toggle('night', !!night);
  $('hud-clock').setAttribute('aria-label', `${fmtClock(c.minute)}, ${str(c.weekday)}, ngày ${num(c.day, 1)}${c.speed > 1 ? `, tua nhanh x${c.speed}` : ''}`);
  // dự án quá hạn phụ thuộc ngày
  if (store.status) { renderProject(store.status); if (openChip?.id === 'chip-project') renderPop(); }
}

// ---------------------------------------------------------------- chip
function chipContent(chip, icon, text, detail) {
  setKids(chip,
    el('span', { class: 'chip-ic', 'aria-hidden': 'true', text: icon }),
    el('span', { class: 'chip-tx', text }),
    detail ? el('span', { class: 'chip-dt', text: detail }) : null);
}

function renderStatus() {
  const s = store.status;
  if (!s) return;
  renderProject(s);
  // doanh thu
  const co = s.company || {};
  const rev = $('chip-revenue');
  chipContent(rev, '💰', `${fmtNum(co.revenueMonth)}/${fmtNum(co.revenueTarget)} tr`);
  rev.classList.toggle('ok', co.revenueTarget > 0 && co.revenueMonth >= co.revenueTarget);
  rev.setAttribute('aria-label', `Doanh thu tháng ${fmtNum(co.revenueMonth)} trên mục tiêu ${fmtNum(co.revenueTarget)} triệu`);
  // sự cố
  const inc = $('chip-incident');
  if (co.incident === 'server_down') {
    inc.hidden = false; inc.className = 'chip chip-incident danger';
    chipContent(inc, '🔥', 'Sập server');
    inc.setAttribute('aria-label', 'Sự cố: server production đang sập');
  } else if (co.incident === 'wifi_down') {
    inc.hidden = false; inc.className = 'chip chip-incident warn';
    chipContent(inc, '📶', 'Mất wifi');
    inc.setAttribute('aria-label', 'Sự cố: mất wifi toàn văn phòng');
  } else {
    if (openChip === inc) close();
    inc.hidden = true;
  }
  // người xem
  const v = $('chip-viewers');
  chipContent(v, '👀', fmtNum(s.viewers));
  v.setAttribute('aria-label', `${fmtNum(s.viewers)} người đang xem`);
  renderAiDot(s.ai);
  renderAi(s.ai);
  if (openChip) { renderPop(); position(); }
}

/** chip 🤖 AI: chỉ admin (store.dev) mới thấy — nguồn đang dùng + lượt gọi; đổi màu khi offline / chạm trần / đang dùng dự phòng */
function renderAi(ai) {
  const chip = $('chip-ai');
  if (!chip) return;
  if (!store.dev) {
    if (openChip === chip) close();
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  if (!ai) { chipContent(chip, '🤖', '…'); return; }
  chip.classList.remove('offline', 'over', 'backup');
  if (ai.mode === 'llm') {
    const name = aiProviderName(ai);
    chipContent(chip, '🤖', name, `${fmtNum(ai.calls)} lượt`);
    if (ai.budgetUsd > 0 && ai.costTodayUsd >= ai.budgetUsd) chip.classList.add('over');
    // đang chạy bằng nguồn dự phòng (nguồn ưu tiên đang nghỉ)
    const first = Array.isArray(ai.providers) ? ai.providers[0] : null;
    if (first && ai.activeProvider && first.label !== ai.activeProvider) chip.classList.add('backup');
  } else {
    chipContent(chip, '🧪', 'Offline', 'câu thoại mẫu');
    chip.classList.add('offline');
  }
  chip.setAttribute('aria-label', aiFullLabel(ai, fmtNum, fmtUsdShort));
}

/** chấm nhỏ cạnh "TRỰC TIẾP": xanh = AI đang viết thoại, xám = đang dùng câu thoại mẫu (không lộ chi tiết hệ thống) */
function renderAiDot(ai) {
  const dot = $('ai-dot');
  if (!dot) return;
  const on = !!ai && ai.mode === 'llm';
  dot.classList.toggle('on', on);
  dot.classList.toggle('off', !!ai && !on);
  const label = !ai ? 'Thoại: đang kiểm tra' : on ? 'Thoại: AI đang viết (online)' : 'Thoại: câu mẫu (AI offline)';
  dot.setAttribute('aria-label', label);
  dot.setAttribute('title', label);
}

function renderProject(s) {
  const pr = s.company?.project;
  const chip = $('chip-project');
  if (!pr) { chipContent(chip, '🚀', '—'); return; }
  const day = store.clock?.day ?? 0;
  const prog = clamp(num(pr.progress), 0, 100);
  const left = num(pr.deadlineDay) - day;
  chip.classList.toggle('overdue', left < 0);
  chip.classList.toggle('due', left === 0);
  const detail = left > 0 ? `còn ${left} ngày` : left === 0 ? 'hạn hôm nay!' : `trễ ${-left} ngày`;
  chipContent(chip, '🚀', `${Math.round(prog)}%`, detail);
  chip.setAttribute('aria-label', `Dự án ${str(pr.name)}: ${Math.round(prog)}%, ${detail}`);
}

// ---------------------------------------------------------------- popover
function bar(p, tone) {
  return el('div', { class: `tip-bar ${tone || ''}` }, el('span', { style: { width: `${(clamp(p, 0, 1) * 100).toFixed(0)}%` } }));
}

function projectPop(s) {
  const pr = s?.company?.project;
  if (!pr) return [el('div', { text: 'Chưa có dự án' })];
  const day = store.clock?.day ?? 0;
  const prog = clamp(num(pr.progress), 0, 100);
  const left = num(pr.deadlineDay) - day;
  const due = left > 0 ? `còn ${left} ngày` : left === 0 ? 'HẠN CHÓT HÔM NAY!' : `trễ hạn ${-left} ngày 😱`;
  return [
    el('div', { class: 'tip-title', text: `🚀 ${str(pr.name, 80)}` }),
    pr.client ? el('div', {}, el('span', { class: 'tip-muted', text: 'Khách: ' }), str(pr.client, 80)) : null,
    pr.desc ? el('div', { text: str(pr.desc, 220) }) : null,
    bar(prog / 100, left < 0 ? 'bad' : prog >= 100 ? 'ok' : ''),
    el('div', {}, el('b', { text: `Tiến độ ${Math.round(prog)}%` }), ` · hạn ngày ${num(pr.deadlineDay)} · ${due}`),
  ];
}

function revenuePop(s) {
  const co = s?.company || {};
  const p = co.revenueTarget > 0 ? co.revenueMonth / co.revenueTarget : 0;
  return [
    el('div', { class: 'tip-title', text: '💰 Doanh thu tháng' }),
    el('div', {}, el('b', { text: `${fmtNum(co.revenueMonth)} triệu` }), ` / mục tiêu ${fmtNum(co.revenueTarget)} triệu (${Math.round(p * 100)}%)`),
    bar(p, p >= 1 ? 'ok' : ''),
    el('div', { class: 'tip-muted', text: `Đã bàn giao ${fmtNum(co.projectsDone)} dự án. Sales chốt deal là doanh thu nhảy số ngay.` }),
  ];
}

function viewersPop(s) {
  return [
    el('div', { class: 'tip-title', text: `👀 ${fmtNum(s?.viewers)} người đang xem trực tiếp` }),
    // số lượt bấm link tiếp thị: chỉ admin
    store.dev ? el('div', { text: `🛒 ${fmtNum(s?.clicks)} lượt bấm link tiếp thị liên kết` }) : null,
  ];
}

/** popover chip 🤖 (admin): nguồn AI theo thứ tự ưu tiên, trạng thái từng nguồn, thống kê token / chi phí, lỗi gần nhất */
function aiPop(ai) {
  if (!ai) return [el('div', { text: 'Đang tải…' })];
  if (ai.mode !== 'llm') {
    const provs = Array.isArray(ai.providers) ? ai.providers.filter((p) => p && typeof p === 'object') : [];
    const now = Date.now();
    return [
      el('div', { class: 'tip-title', text: '🧪 Chế độ OFFLINE — câu thoại mẫu' }),
      el('div', { text: provs.length
        ? 'Mọi nguồn AI đang nghỉ (hết lượt / lỗi liên tiếp) — thoại ghép từ câu mẫu, sẽ tự bật lại khi có nguồn sẵn sàng.'
        : 'Chưa có nguồn AI nào (thiếu AI_<NAME>_API_KEY trong .env) — thoại ghép từ câu mẫu.' }),
      provs.length ? el('div', { class: 'prov-list' }, provs.slice(0, 6).map((p, i) => {
        const [state, tone] = providerStateLabel(p, now);
        return el('div', { class: `prov ${tone}` },
          el('span', { class: 'prov-dot', 'aria-hidden': 'true' }),
          el('div', {}, el('span', { class: 'prov-name', text: str(p.label || p.name || `#${i + 1}`, 24) }), el('span', { class: 'prov-role', text: i === 0 ? 'ưu tiên' : 'dự phòng' })),
          el('div', { class: 'prov-meta', text: str(p.model, 48) }),
          el('div', { class: 'prov-state', text: state }));
      })) : null,
      ai.lastError ? el('div', { class: 'tip-muted', text: `Lỗi gần nhất: ${str(ai.lastError, 200)}` }) : null,
    ];
  }
  const active = aiProviderName(ai);
  const provs = Array.isArray(ai.providers) ? ai.providers.filter((p) => p && typeof p === 'object') : [];
  const now = Date.now();
  const out = [el('div', { class: 'tip-title', text: `🤖 ${aiFullLabel(ai, fmtNum, fmtUsdShort)}` })];
  if (provs.length) {
    out.push(el('div', { class: 'tip-sub', text: 'Nguồn AI (theo thứ tự ưu tiên)' }));
    out.push(el('div', { class: 'prov-list' }, provs.slice(0, 6).map((p, i) => {
      const label = str(p.label || p.name || `#${i + 1}`, 24);
      const isActive = label === active || (!ai.activeProvider && i === 0);
      const [state, tone] = providerStateLabel(p, now);
      const rpd = `${fmtNum(p.rpdUsed)}/${p.rpdLimit ? fmtNum(p.rpdLimit) : '∞'} lượt`;
      const tpd = p.tpdUsed || p.tpdLimit ? ` · ${fmtTokens(p.tpdUsed)}${p.tpdLimit ? '/' + fmtTokens(p.tpdLimit) : ''} token` : '';
      const role = isActive ? 'đang dùng' : i === 0 ? 'ưu tiên · đang nghỉ' : 'dự phòng';
      return el('div', { class: `prov ${isActive ? 'active' : tone}` },
        el('span', { class: 'prov-dot', 'aria-hidden': 'true' }),
        el('div', {}, el('span', { class: 'prov-name', text: label }), el('span', { class: 'prov-role', text: role })),
        el('div', { class: 'prov-meta', text: `${str(p.model, 48)} · ${rpd}${tpd}` }),
        el('div', { class: 'prov-state', text: isActive && tone === 'ok' ? 'sẵn sàng' : state }));
    })));
  } else {
    out.push(el('div', { class: 'tip-muted', text: `Model: ${str(ai.model, 60)}` }));
  }
  const rows = [
    ['Lượt gọi hôm nay', `${fmtNum(ai.calls)} (lỗi ${fmtNum(ai.failures)})`],
    ['Token vào', `${fmtTokens(ai.inputTokens)}${ai.cachedTokens ? ` (cache ${fmtTokens(ai.cachedTokens)})` : ''}`],
    ['Token ra', fmtTokens(ai.outputTokens)],
    ['Chi phí hôm nay', `${fmtUsdShort(ai.costTodayUsd)} / ${fmtUsd(ai.budgetUsd, 2)}`],
    ['Tổng chi phí', fmtUsdShort(ai.costTotalUsd)],
    ['Cảnh bỏ qua (tiết kiệm)', fmtNum(ai.skipped)],
  ];
  out.push(el('div', { class: 'tip-sub', text: 'Thống kê' }));
  out.push(el('table', { class: 'tip-table' }, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { text: k }), el('td', { text: v }))))));
  if (ai.budgetUsd > 0 && ai.costTodayUsd >= ai.budgetUsd) out.push(el('div', { class: 'tip-warn', text: '⚠️ Đã chạm trần chi phí hôm nay — cảnh thường tạm nghỉ, cảnh quan trọng dùng câu mẫu.' }));
  if (ai.lastError) out.push(el('div', { class: 'tip-muted', text: `Lỗi gần nhất: ${str(ai.lastError, 200)}` }));
  return out;
}

function incidentPop(s) {
  const inc = s?.company?.incident;
  if (inc === 'server_down') {
    return [
      el('div', { class: 'tip-title', text: '🔥 Sập server production!' }),
      el('div', { text: 'Dev đang chữa cháy trong phòng server. Khách gọi liên tục, sếp đứng sau lưng.' }),
    ];
  }
  return [
    el('div', { class: 'tip-title', text: '📶 Mất wifi toàn văn phòng' }),
    el('div', { text: 'Năng suất giảm còn 30%, nhóm chat (4G) thì sôi nổi hẳn lên.' }),
  ];
}
