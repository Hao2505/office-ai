// Mục "🗂️ Lịch sử" trong tab 📰 Bản tin (v3): archive nối tiếp data/history/YYYY-MM-DD.jsonl của server.
//   GET /api/history                -> danh sách ngày [{ date: 'YYYY-MM-DD', count }] (mới nhất trước)
//   GET /api/history?date=YYYY-MM-DD -> mọi dòng của ngày đó (LogEntry: thoại, sự kiện, HR, cảnh; kèm bản tin / beat /
//                                      quyết định nhân sự nếu server ghi) — vẽ CHỈ ĐỌC, gom theo thẻ cảnh như feed trực tiếp.
// Chịu lỗi: server chưa có endpoint (404) -> "Chưa có lịch sử"; lỗi mạng / 5xx -> thông báo + "Thử lại"; dữ liệu rỗng.
// Hiển thị 300 dòng mỗi lần, "Tải thêm" cho phần còn lại (toàn bộ ngày đã được tải về, chỉ chia trang DOM).
import { el, setKids, setText, str, num } from '../util.js';
import { HR_ACTION_LABELS, WEEKDAYS_FULL } from '../labels.js';
import { createFeedView } from './feed.js';
import { store } from '../store.js';

const API = '/api/history';
const PAGE = 300;
const TIMEOUT_MS = 15000;
const LOG_KINDS = new Set(['line', 'event', 'hr', 'scene_start', 'scene_end', 'system']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let details, select, statusEl, feedEl, footEl, countEl, moreBtn, toggleBtn, refreshBtn, view;
let dates = [];        // [{ date, count }]
let entries = [];      // dòng của ngày đang xem (đã chuẩn hoá thành LogEntry)
let shown = 0;         // số dòng đã vẽ
let currentDate = '';
let expandAll = false;
let datesLoaded = false;
let req = 0;           // bộ đếm chống kết quả cũ đè kết quả mới

export function initHistory(openProfile) {
  details = document.getElementById('history');
  if (!details) return;
  select = document.getElementById('hist-date');
  statusEl = document.getElementById('hist-status');
  feedEl = document.getElementById('hist-feed');
  footEl = document.getElementById('hist-foot');
  countEl = document.getElementById('hist-count');
  moreBtn = document.getElementById('hist-more');
  toggleBtn = document.getElementById('hist-toggle');
  refreshBtn = document.getElementById('hist-refresh');
  view = createFeedView(feedEl, { live: false, onOpenProfile: openProfile });

  details.addEventListener('toggle', () => { if (details.open && !datesLoaded) loadDates(); });
  select.addEventListener('change', () => { if (select.value) loadDay(select.value); });
  refreshBtn.addEventListener('click', () => loadDates(true));
  moreBtn.addEventListener('click', renderPage);
  toggleBtn.addEventListener('click', () => {
    expandAll = !expandAll;
    view.setAllCollapsed(!expandAll);
    setText(toggleBtn, expandAll ? 'Thu gọn' : 'Mở hết');
  });
  // mở lại bằng liên kết sâu #tab=recap&history=YYYY-MM-DD (tuỳ chọn)
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const d = q.get('history');
  if (d && DATE_RE.test(d)) { details.open = true; currentDate = d; }
}

// ---------------------------------------------------------------- gọi API
async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctl.signal });
    if (res.status === 404) return { status: 404, data: null };
    const text = await res.text();
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: parseBody(text) };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON thường, hoặc JSONL (mỗi dòng 1 JSON — đúng định dạng file archive) */
function parseBody(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  try { return JSON.parse(t); } catch { /* thử JSONL */ }
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* bỏ dòng hỏng */ }
  }
  return out;
}

/** lấy mảng từ body: mảng trần hoặc { <một trong keys>: [...] } */
function listOf(data, keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') for (const k of keys) if (Array.isArray(data[k])) return data[k];
  return [];
}

function normDates(data) {
  const out = [];
  for (const it of listOf(data, ['dates', 'days', 'items', 'history', 'list'])) {
    const date = typeof it === 'string' ? it : str(it?.date ?? it?.day ?? it?.id ?? '', 10);
    if (!DATE_RE.test(date)) continue;
    const c = typeof it === 'object' && it ? Number(it.count ?? it.entries ?? it.lines ?? it.n) : NaN;
    out.push({ date, count: Number.isFinite(c) ? c : null });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out.filter((d, i) => i === 0 || d.date !== out[i - 1].date);
}

/**
 * Một bản ghi archive -> LogEntry để bộ vẽ feed hiểu. Bản ghi đã là LogEntry (kind + text) giữ nguyên;
 * bản tin / beat biên kịch / tin thời sự / quyết định nhân sự -> pill sự kiện tương ứng; loại lạ -> bỏ.
 */
function toEntry(rec) {
  if (!rec || typeof rec !== 'object') return null;
  // { t: 'log', entry: {...} } hoặc { entry: {...} }
  if (rec.entry && typeof rec.entry === 'object') return toEntry({ day: rec.day, minute: rec.minute, ...rec.entry });
  // Dòng archive thật của server (src/sim/archive.ts): { ts, kind, data } — World ghi 'log' (data = LogEntry) và 'kpi';
  // Director ghi 'hr' / 'beat' / 'news' / 'resign' (data = { day, minute, text, … }).
  if (rec.data && typeof rec.data === 'object' && typeof rec.kind === 'string' && typeof rec.text !== 'string') {
    return fromArchive(rec.kind, rec.data);
  }
  const kind = typeof rec.kind === 'string' ? rec.kind : typeof rec.t === 'string' ? rec.t : '';
  if (LOG_KINDS.has(kind) && typeof rec.text === 'string') return { ...rec, kind };
  const day = num(rec.day, NaN);
  const minute = num(rec.minute, NaN);
  const base = { id: rec.id, day: Number.isFinite(day) ? day : undefined, minute: Number.isFinite(minute) ? minute : 0 };
  // bản tin cuối ngày
  const rc = rec.recap && typeof rec.recap === 'object' ? rec.recap : (kind === 'recap' || typeof rec.headline === 'string') ? rec : null;
  if (rc && typeof rc.headline === 'string') {
    const headline = str(rc.headline, 200).trim();
    const rday = num(rc.day ?? rec.day, NaN);
    const text = /^ngày\s+\d+/i.test(headline) || !Number.isFinite(rday) ? `Bản tin: ${headline}` : `Bản tin ngày ${rday}: ${headline}`;
    return { ...base, day: base.day ?? (Number.isFinite(rday) ? rday : undefined), minute: Number.isFinite(minute) ? minute : 1110, kind: 'system', icon: '📰', text };
  }
  // AI biên kịch (showrunner) lên "biến"
  const beats = Array.isArray(rec.beats) ? rec.beats : kind === 'beat' && rec.beat && typeof rec.beat === 'object' ? [rec.beat] : kind === 'beat' ? [rec] : null;
  if (beats) {
    const notes = beats.map((b) => str(b?.note || b?.kind || '', 120)).filter(Boolean);
    if (!notes.length) return null;
    return { ...base, kind: 'system', icon: '🎬', text: `Biên kịch: ${notes.join(' · ')}` };
  }
  // tin thời sự được chọn để bàn
  const nw = rec.news && typeof rec.news === 'object' ? rec.news : kind === 'news' ? rec : null;
  if (nw && typeof nw.title === 'string') {
    return { ...base, kind: 'event', icon: '🗞️', text: `Tin đang bàn: ${str(nw.title, 160)}${nw.source ? ` — ${str(nw.source, 40)}` : ''}`, news: nw };
  }
  // quyết định nhân sự do AI đưa ra
  const decs = Array.isArray(rec.decisions) ? rec.decisions : Array.isArray(rec.hrDecisions) ? rec.hrDecisions : typeof rec.action === 'string' ? [rec] : null;
  if (decs) {
    const parts = decs.map((d) => {
      if (!d || typeof d !== 'object' || typeof d.action !== 'string') return '';
      const [ic, label] = HR_ACTION_LABELS[d.action] || ['⚖️', str(d.action, 30)];
      const who = str(d.name || (d.id ? store.name(d.id) : ''), 40);
      return `${ic} ${who ? who + ': ' : ''}${label}${d.reason ? ` — ${str(d.reason, 160)}` : ''}`;
    }).filter(Boolean);
    if (!parts.length) return null;
    return { ...base, kind: 'hr', icon: '⚖️', text: `Quyết định nhân sự: ${parts.join(' · ')}` };
  }
  return null;
}

/**
 * Bản ghi archive của server -> LogEntry. Những gì World đã lưu dưới 'log' (thoại, sự kiện, dòng ⚠️ / ⚖️ / 🚪, thẻ tin ở
 * scene_start) KHÔNG vẽ lại từ bản ghi có cấu trúc để khỏi trùng; chỉ thêm phần log không có: quyết định nhân sự kèm lý do,
 * mạch truyện của AI biên kịch, bảng KPI cuối ngày.
 */
function fromArchive(kind, d) {
  const day = num(d.day, NaN);
  const minute = num(d.minute, NaN);
  const base = { id: undefined, day: Number.isFinite(day) ? day : undefined, minute: Number.isFinite(minute) ? minute : 0 };
  switch (kind) {
    case 'log':
      return toEntry(d);
    case 'kpi': {
      const rs = Array.isArray(d.results) ? d.results : [];
      const parts = rs.filter((r) => r && typeof r === 'object' && typeof r.name === 'string')
        .map((r) => `${str(r.name, 30)} ${Math.round(num(r.ratio, 0) * 100)}%`);
      if (!parts.length) return null;
      // bản ghi KPI không có phút -> để trống, loadDay() cho thừa hưởng giờ của dòng ngay trước (lúc đóng cửa)
      return { ...base, minute: Number.isFinite(minute) ? minute : undefined, kind: 'system', icon: '📊', text: `KPI cuối ngày: ${parts.join(' · ')}` };
    }
    case 'hr': {
      const decs = Array.isArray(d.decisions) ? d.decisions : null;
      if (!decs || !decs.length) return null; // không có quyết định / dòng lẻ (⚠️ 💰 ⏳…) đã nằm trong 'log'
      return toEntry({ ...base, decisions: decs });
    }
    case 'beat': {
      // text: "🎬 <kind>: <ghi chú> (<ai>)" · "🎬 kết: <kind> — …" · "🎬 mạch tự rơi: <kind> — …"
      let t = str(d.text, 300).replace(/^🎬\s*/, '').trim();
      let label = 'Biên kịch mở mạch';
      let m;
      if ((m = /^kết:\s*[a-z_]+\s*—\s*([\s\S]*)$/.exec(t))) { label = 'Mạch truyện kết'; t = m[1]; }
      else if ((m = /^mạch tự rơi:\s*[a-z_]+\s*—\s*([\s\S]*)$/.exec(t))) { label = 'Mạch truyện tự rơi'; t = m[1]; }
      else if ((m = /^[a-z_]+:\s*([\s\S]*)$/.exec(t))) t = m[1];
      t = t.trim();
      if (!t) return null;
      return { ...base, kind: 'system', icon: '🎬', text: `${label}: ${t}` };
    }
    default:
      return null; // 'news' (thẻ tin đã ở scene_start), 'resign' (đã có dòng 🚪), loại lạ
  }
}

// ---------------------------------------------------------------- hiển thị
/** 'YYYY-MM-DD' -> { isToday, wd: 'Thứ Bảy', dmy: '31/10' (kèm /năm nếu khác năm nay) } */
function dateParts(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = dt.getFullYear() === today.getFullYear() && dt.getMonth() === today.getMonth() && dt.getDate() === today.getDate();
  const wd = Number.isFinite(dt.getTime()) ? WEEKDAYS_FULL[dt.getDay()] : '';
  const dmy = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}${y === today.getFullYear() ? '' : `/${y}`}`;
  return { isToday, wd, dmy };
}

/**
 * Nhãn trong ô chọn ngày. Ô chọn chỉ rộng ~200 px (bảng 260–320 px, cạnh nút ↻ / "Mở hết") nên nhãn phải ngắn:
 * "Hôm nay · 01/11 · 154 dòng" (hôm nay thì khỏi nhắc thứ) · "Thứ Bảy 31/10 · 315 dòng".
 */
function fmtDate(date, count) {
  const { isToday, wd, dmy } = dateParts(date);
  const label = isToday ? `Hôm nay · ${dmy}` : `${wd ? wd + ' ' : ''}${dmy}`;
  return count != null ? `${label} · ${count} dòng` : label;
}

/** "hôm nay" / "ngày 31/10" cho câu trạng thái */
function sayDate(date) {
  const { isToday, dmy } = dateParts(date);
  return isToday ? 'hôm nay' : `ngày ${dmy}`;
}

function setStatus(kind, text, retry) {
  if (!text) { statusEl.hidden = true; statusEl.replaceChildren(); statusEl.className = 'hist-status'; return; }
  statusEl.hidden = false;
  statusEl.className = `hist-status ${kind || ''}`.trim();
  setKids(statusEl,
    kind === 'loading' ? el('span', { class: 'spinner small', 'aria-hidden': 'true' }) : null,
    el('span', { text }),
    retry ? el('button', { class: 'hist-btn', type: 'button', text: 'Thử lại', onclick: retry }) : null);
}

function emptyBlock(icon, title, text) {
  return el('div', { class: 'hist-empty' },
    el('div', { class: 'hist-empty-ic', 'aria-hidden': 'true', text: icon }),
    el('div', { class: 'hist-empty-title', text: title }),
    text ? el('div', { text }) : null);
}

function resetFeed() {
  view.clear();
  entries = [];
  shown = 0;
  footEl.hidden = true;
  toggleBtn.hidden = true;
}

async function loadDates(force) {
  const my = ++req;
  datesLoaded = true;
  select.hidden = true;
  refreshBtn.disabled = true;
  resetFeed();
  setStatus('loading', 'Đang tải danh sách ngày…');
  let r;
  try {
    r = await fetchJson(API);
  } catch {
    if (my !== req) return;
    refreshBtn.disabled = false;
    setStatus('err', 'Không kết nối được máy chủ để lấy lịch sử.', () => loadDates(true));
    return;
  }
  if (my !== req) return;
  refreshBtn.disabled = false;
  if (r.status === 404) {
    setStatus('', '');
    setKids(feedEl, emptyBlock('🗂️', 'Chưa có lịch sử', 'Server chưa bật tính năng lưu trữ (HISTORY_ENABLED) hoặc chưa ghi ngày nào.'));
    return;
  }
  if (r.data == null) {
    setStatus('err', `Không tải được lịch sử (lỗi ${r.status}).`, () => loadDates(true));
    return;
  }
  dates = normDates(r.data);
  if (!dates.length) {
    setStatus('', '');
    setKids(feedEl, emptyBlock('🗂️', 'Chưa có lịch sử', 'Nhật ký văn phòng sẽ được lưu từng ngày và hiện ở đây.'));
    return;
  }
  setKids(select, dates.map((d) => el('option', { value: d.date, text: fmtDate(d.date, d.count) })));
  select.hidden = false;
  const want = (!force && currentDate && dates.some((d) => d.date === currentDate)) ? currentDate : dates[0].date;
  select.value = want;
  loadDay(want);
}

async function loadDay(date) {
  if (!DATE_RE.test(date)) return;
  const my = ++req;
  currentDate = date;
  resetFeed();
  setStatus('loading', `Đang tải nhật ký ${sayDate(date)}…`);
  let r;
  try {
    r = await fetchJson(`${API}?date=${encodeURIComponent(date)}`);
  } catch {
    if (my !== req) return;
    setStatus('err', 'Không kết nối được máy chủ.', () => loadDay(date));
    return;
  }
  if (my !== req) return;
  if (r.status === 404) {
    setStatus('', '');
    setKids(feedEl, emptyBlock('📭', 'Ngày này chưa có dữ liệu', 'Có thể file nhật ký của ngày này đã bị xoá theo hạn lưu trữ.'));
    return;
  }
  if (r.data == null) {
    setStatus('err', `Không tải được nhật ký ngày này (lỗi ${r.status}).`, () => loadDay(date));
    return;
  }
  const raw = listOf(r.data, ['entries', 'items', 'log', 'lines', 'records', 'events']);
  entries = raw.map(toEntry).filter(Boolean);
  // bản ghi không có ngày / phút (vd. KPI cuối ngày) thừa hưởng của dòng ngay trước để không hiện "00:00" hay nhảy ngược giờ
  let lastDay, lastMinute = 0;
  for (const e of entries) {
    if (Number.isFinite(e.day)) lastDay = e.day; else if (lastDay !== undefined) e.day = lastDay;
    if (Number.isFinite(e.minute)) lastMinute = e.minute; else e.minute = lastMinute;
  }
  if (!entries.length) {
    setStatus('', '');
    setKids(feedEl, emptyBlock('🤫', 'Không có gì được ghi lại trong ngày này', raw.length ? `${raw.length} bản ghi nhưng không có dòng nào hiển thị được.` : ''));
    return;
  }
  setStatus('', '');
  toggleBtn.hidden = false;
  setText(toggleBtn, expandAll ? 'Thu gọn' : 'Mở hết');
  renderPage();
}

function renderPage() {
  const end = Math.min(entries.length, shown + PAGE);
  for (let i = shown; i < end; i++) view.append(entries[i], false);
  shown = end;
  if (!expandAll) view.collapseFresh();
  footEl.hidden = false;
  setText(countEl, `Hiển thị ${shown}/${entries.length} dòng${view.cardCount ? ` · ${view.cardCount} cảnh` : ''}`);
  moreBtn.hidden = shown >= entries.length;
  if (!moreBtn.hidden) setText(moreBtn, `Tải thêm (còn ${entries.length - shown})`);
}
