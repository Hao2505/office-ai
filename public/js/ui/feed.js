// Tab "Trực tiếp" (v2): luồng hội thoại GOM THEO THẺ CẢNH — mỗi cảnh là một thẻ (icon, tiêu đề, 📍 nơi,
// người tham gia, "Đang diễn" / đã xong + tóm tắt) chứa các dòng thoại của nó. Hai cảnh chạy song song
// (văn phòng + chat nhóm) không bao giờ xen kẽ dòng: dòng mới luôn chui vào đúng thẻ của nó.
// Thứ tự: thẻ/sự kiện đã xong ở trên (theo thời gian), các thẻ đang diễn luôn nằm cuối. Thẻ đã xong cũ tự thu
// gọn còn 1 dòng tóm tắt (bấm để mở). Sự kiện = pill 1 dòng. Tự cuộn trừ khi người xem cuộn lên ("▼ Tin mới").
// Giới hạn DOM: ≤ 300 dòng thoại — cắt thẻ cũ nhất trước.
// v3: bộ vẽ tách thành createFeedView(root, { live }) để trang 🗂️ Lịch sử dùng lại ở chế độ CHỈ ĐỌC (không theo dõi
// cảnh đang diễn, không cắt bớt, thẻ thu gọn mặc định); thẻ cảnh news_chat có thẻ tin gốc (🗞️ tiêu đề · nguồn · link).
import { store, normNewsRef } from '../store.js';
import { el, setKids, setText, fmtClock, str, arr, safeProductUrl, stripIcon } from '../util.js';
import { FEED_FILTERS, CHANNEL_BADGE, sceneToneOf, SCENE_DEFAULTS } from '../labels.js';
import { avatarEl, colorOf } from './avatar.js';
import { onTab } from './tabs.js';
import { onSidebarToggle } from './sidebar.js';
import { newsCard } from './news.js';

const MAX_LINES = 300;   // tổng số dòng thoại trong DOM (chế độ trực tiếp)
const MAX_TOP = 180;     // số phần tử cấp 1 (thẻ, pill, ngăn ngày)
const KEEP_OPEN = 2;     // số thẻ đã xong gần nhất vẫn mở

// ---------------------------------------------------------------- tab Trực tiếp
let feed, newBtn, filtersBox, view;
let unread = 0;
let follow = true; // người xem đang ở cuối feed -> tự cuộn theo tin mới (chỉ đổi khi CHÍNH người xem cuộn)

export function initFeed(openProfile) {
  feed = document.getElementById('feed');
  newBtn = document.getElementById('new-msgs');
  filtersBox = document.getElementById('filters');
  view = createFeedView(feed, { live: true, onOpenProfile: openProfile });
  for (const [key, label] of FEED_FILTERS) {
    const b = el('button', { class: `filter ${key === 'all' ? 'active' : ''}`, type: 'button', 'data-filter': key, text: label, 'aria-pressed': key === 'all' ? 'true' : 'false' });
    b.addEventListener('click', () => setFilter(key));
    filtersBox.append(b);
  }
  // sidebar hẹp: hàng chip lọc cuộn ngang -> mờ mép phải báo còn chip phía sau
  const syncMore = () => filtersBox.classList.toggle('more', filtersBox.scrollWidth - filtersBox.scrollLeft - filtersBox.clientWidth > 4);
  filtersBox.addEventListener('scroll', syncMore, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(syncMore).observe(filtersBox);
  syncMore();
  feed.addEventListener('scroll', () => {
    follow = nearBottom();
    if (follow) { unread = 0; updateNewBtn(); }
  }, { passive: true });
  // font tải xong làm chữ đổi cỡ -> feed dài ra: nếu đang theo dõi cuối feed thì cuộn lại cho đúng
  document.fonts?.ready?.then(() => { if (follow) scrollToBottom(false); }).catch(() => {});
  newBtn.addEventListener('click', () => scrollToBottom(true));
  onTab((name) => { if (name === 'live') requestAnimationFrame(() => scrollToBottom(false)); });
  onSidebarToggle((collapsed) => { if (!collapsed) requestAnimationFrame(() => scrollToBottom(false)); });

  store.on('hello', (msg) => {
    view.clear();
    unread = 0;
    const entries = arr(msg.log);
    for (const e of entries) view.append(e, false);
    if (!entries.length) feed.append(emptyNote());
    for (const sc of store.scenes.values()) view.updateScene(sc);
    view.trim();
    view.autoCollapse();
    follow = true;
    requestAnimationFrame(() => scrollToBottom(false));
    updateNewBtn();
  });
  store.on('log', ({ entry }) => {
    feed.querySelector('.feed-empty')?.remove();
    const stick = follow || nearBottom();
    view.append(entry, true);
    view.trim();
    if (stick) scrollToBottom(false);
    else if (matchesFilter(entry)) { unread++; updateNewBtn(); }
  });
  store.on('scene', (sc) => view.updateScene(sc));
}

function emptyNote() {
  return el('div', { class: 'feed-empty' },
    el('div', { class: 'feed-empty-icon', text: '🏢' }),
    el('div', { text: 'Văn phòng còn yên ắng… Các cuộc trò chuyện sẽ hiện ở đây.' }));
}

// ---------------------------------------------------------------- lọc / cuộn
function setFilter(key) {
  feed.dataset.filter = key;
  for (const b of filtersBox.children) {
    const on = b.dataset.filter === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  unread = 0;
  updateNewBtn();
  scrollToBottom(false);
}

function catOf(e) {
  if (e.kind === 'line') return e.channel || 'office';
  if (e.kind === 'scene_start' || e.kind === 'scene_end') {
    const sc = e.sceneId ? store.sceneMeta.get(e.sceneId) : null;
    return sc?.channel || e.channel || 'office';
  }
  return 'event';
}

function matchesFilter(e) {
  const f = feed.dataset.filter || 'all';
  return f === 'all' || catOf(e) === f;
}

function nearBottom() {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
}

function scrollToBottom(smooth) {
  feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  follow = true;
  unread = 0;
  updateNewBtn();
}

function updateNewBtn() {
  newBtn.hidden = unread <= 0;
  newBtn.textContent = unread > 1 ? `▼ ${unread} tin mới` : '▼ Tin mới';
}

// ================================================================ bộ vẽ dùng chung (trực tiếp + lịch sử)
/**
 * Khung vẽ LogEntry -> thẻ cảnh / dòng thoại / pill sự kiện vào `root`.
 *   opts.live = true  : tab Trực tiếp — theo dõi cảnh đang diễn (store.scenes / sceneMeta), cắt thẻ cũ, tự thu gọn.
 *   opts.live = false : chỉ đọc (Lịch sử) — chỉ dùng dữ liệu ngay trong từng dòng (id cảnh có thể lặp giữa các ngày),
 *                       không cắt bớt (trang gọi tự chia trang), không có vùng "đang diễn".
 *   opts.onOpenProfile(id): bấm tên / avatar.
 */
export function createFeedView(root, opts = {}) {
  const v = {
    root,
    live: opts.live !== false,
    cards: new Map(), // sceneId -> card
    lastDay: null,
    lineTotal: 0,
    seq: 0,
    openProfile: typeof opts.onOpenProfile === 'function' ? opts.onOpenProfile : () => {},
  };
  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('a')) return; // link sản phẩm / bài báo: để trình duyệt mở
    const who = e.target.closest('[data-agent]');
    if (who) { v.openProfile(who.dataset.agent); return; }
    const head = e.target.closest('.sc-head');
    if (head) {
      const card = v.cards.get(head.parentElement?.dataset.scene);
      if (card) { card.userToggled = true; setCollapsed(card, !card.collapsed); }
    }
  });
  return {
    get lineTotal() { return v.lineTotal; },
    get cardCount() { return v.cards.size; },
    append: (entry, fresh) => appendEntry(v, entry, fresh),
    clear: () => { root.replaceChildren(); v.cards.clear(); v.lastDay = null; v.lineTotal = 0; },
    updateScene: (sc) => updateSceneCard(v, sc),
    trim: () => trim(v),
    autoCollapse: () => autoCollapse(v),
    /** mở / thu gọn mọi thẻ (Lịch sử: "Mở hết" / "Thu gọn") */
    setAllCollapsed: (c) => { for (const card of v.cards.values()) { card.userToggled = false; setCollapsed(card, !!c); } },
    /** thu gọn những thẻ đang mở mà người xem chưa đụng tới (Lịch sử: trang mới thêm vào) */
    collapseFresh: () => { for (const card of v.cards.values()) if (!card.userToggled && !card.collapsed && !card.live) setCollapsed(card, true); },
  };
}

// ---------------------------------------------------------------- bố cục: vùng "đã xong" rồi vùng "đang diễn"
function firstLiveNode(v) {
  if (!v.live) return null;
  for (const n of v.root.children) if (n.classList.contains('is-live')) return n;
  return null;
}
/** chèn vào cuối vùng đã xong (ngay trước thẻ đang diễn đầu tiên) */
function insertSettled(v, node) {
  const live = firstLiveNode(v);
  if (live) v.root.insertBefore(node, live); else v.root.append(node);
}

function trim(v) {
  if (!v.live) return;
  while ((v.lineTotal > MAX_LINES || v.root.childElementCount > MAX_TOP) && v.root.firstElementChild) {
    const n = v.root.firstElementChild;
    if (n.classList.contains('is-live')) break; // chỉ còn thẻ đang diễn: không cắt
    if (n.classList.contains('scene-card')) {
      const c = v.cards.get(n.dataset.scene);
      if (c) { v.lineTotal -= c.lineCount; v.cards.delete(n.dataset.scene); }
    } else if (n.classList.contains('loose')) v.lineTotal -= 1;
    n.remove();
  }
}

/** thẻ đã xong: giữ KEEP_OPEN thẻ gần nhất mở, các thẻ cũ hơn thu gọn (trừ thẻ người xem tự bấm) */
function autoCollapse(v) {
  if (!v.live) return;
  const done = [];
  for (const n of v.root.children) if (n.classList.contains('scene-card') && !n.classList.contains('is-live')) done.push(n);
  done.forEach((n, i) => {
    const card = v.cards.get(n.dataset.scene);
    if (!card || card.userToggled) return;
    const should = i < done.length - KEEP_OPEN;
    if (should !== card.collapsed) setCollapsed(card, should);
  });
}

/** dòng tóm tắt khi thẻ thu gọn: "giờ · tóm tắt" (hàng trạng thái có giờ bị ẩn lúc này) */
function sumText(card) {
  const body = card.summary ? card.summary
    : card.news?.title ? `🗞️ ${card.news.title}`
      : card.live ? `đang diễn · ${card.lineCount} câu` : `${card.lineCount} câu thoại`;
  const m = card.entry?.minute;
  return typeof m === 'number' && Number.isFinite(m) ? `${fmtClock(m)} · ${body}` : body;
}

function setCollapsed(card, c) {
  card.collapsed = !!c;
  card.node.classList.toggle('collapsed', card.collapsed);
  card.head.setAttribute('aria-expanded', card.collapsed ? 'false' : 'true');
  if (card.collapsed) setText(card.sum, sumText(card));
}

// ---------------------------------------------------------------- vào feed
const WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu'];
function weekdayOf(day) {
  const c = store.clock;
  if (c && c.day === day && c.weekday) return str(c.weekday, 20);
  if (c && c.timeMode === 'realtime') return '';
  return WEEKDAYS[(((day - 1) % 5) + 5) % 5];
}

function timeEl(e) {
  return el('time', { class: 'when', text: fmtClock(e.minute) });
}

function appendEntry(v, e, fresh) {
  if (!e || typeof e !== 'object') return;
  if (typeof e.day === 'number' && e.day !== v.lastDay) {
    const wd = weekdayOf(e.day);
    insertSettled(v, el('div', { class: 'day-sep', 'data-cat': 'all' }, el('span', { text: wd ? `${wd} · Ngày ${e.day}` : `Ngày ${e.day}` })));
    v.lastDay = e.day;
  }
  try {
    switch (e.kind) {
      case 'line': addLine(v, e, fresh); break;
      case 'scene_start': startCard(v, e, fresh); break;
      case 'scene_end': endCard(v, e); break;
      default: {
        const node = eventNode(e);
        if (fresh) node.classList.add('fresh');
        insertSettled(v, node);
      }
    }
  } catch (err) {
    console.warn('[feed] lỗi hiển thị', err);
  }
}

// ---------------------------------------------------------------- thẻ cảnh
// cảnh đã diễn trước khi mở trang (chỉ có dòng log "tiêu đề · người · địa điểm"): đoán lại thông tin thẻ
const ICON_TYPE = {
  '😱': 'boss_catch', '⚠': 'hr_warning', '📦': 'firing', '🔥': 'incident', '😤': 'confront',
  '🎉': 'celebration', '👋': 'welcome', '🏓': 'pingpong_match', '🤝': 'interview', '🛍': 'showroom_chat',
  '🗞': 'news_chat', '⚖': 'hr_review', '🚪': 'resign_talk', '💵': 'raise_request', '🎖': 'promotion', '📉': 'layoff',
};
function guessScene(e) {
  const icon = str(e.icon, 8);
  const parts = stripIcon(str(e.text, 300), icon).split(' · ');
  const title = parts.length >= 3 ? parts.slice(0, -2).join(' · ') : parts[0] || 'Cuộc trò chuyện';
  return {
    id: e.sceneId || '', guessed: true, title, icon: icon || '💬', channel: e.channel || 'office',
    type: ICON_TYPE[icon.replace(/️/g, '')] || '',
    locationLabel: parts.length >= 3 ? parts[parts.length - 1] : '',
    participants: [],
    news: e.news || null,
  };
}

function buildCard(v, sid, meta, e) {
  const ch = meta?.channel || e.channel || 'office';
  const head = el('button', { class: 'sc-head', type: 'button', 'aria-expanded': 'true' });
  const iconEl = el('span', { class: 'sc-icon', 'aria-hidden': 'true' });
  const titleEl = el('div', { class: 'sc-title' });
  const sub = el('div', { class: 'sc-sub' });
  const sum = el('div', { class: 'sc-sum' });
  const avs = el('div', { class: 'sc-avs' });
  // hàng 1: icon · tiêu đề (+ "giờ · tóm tắt" khi gọn) · avatar · mũi tên; hàng 2 (trọn chiều ngang): 📍 nơi · kênh · giờ · trạng thái
  head.append(iconEl, el('div', { class: 'sc-main' }, titleEl, sum), avs, el('span', { class: 'sc-caret', 'aria-hidden': 'true', text: '▼' }), sub);
  const newsBox = el('div', { class: 'sc-news', hidden: true }); // v3: thẻ tin gốc của cảnh news_chat (ngoài <button> để link bấm được)
  const lines = el('div', { class: 'sc-lines' });
  const foot = el('div', { class: 'sc-foot', hidden: true });
  const node = el('article', { class: `scene-card tone-${sceneToneOf(meta?.type, ch)} ch-${ch}`, 'data-scene': sid, 'data-cat': ch }, head, newsBox, lines, foot);
  const card = {
    id: sid, node, head, iconEl, titleEl, sub, sum, avs, newsBox, lines, foot, entry: e, meta,
    live: false, collapsed: false, userToggled: false, summary: '', news: null,
    speakers: new Set(), lastSpeaker: null, lastMinute: 0, lastDay: null, lineCount: 0, channel: ch,
  };
  fill(card, meta, e);
  return card;
}

function fill(card, meta, e) {
  if (meta) card.meta = meta; else meta = card.meta || null; // giữ thông tin đoán được của cảnh cũ (không có sceneMeta)
  const ch = meta?.channel || e?.channel || card.channel || 'office';
  const def = SCENE_DEFAULTS[meta?.type] || null;
  const icon = meta?.icon || e?.icon || (def ? def[0] : '💬');
  const title = meta?.title || (e ? stripIcon(e.text, icon) : '') || (def ? def[1] : 'Cuộc trò chuyện');
  setText(card.iconEl, str(icon, 8));
  setText(card.titleEl, str(title, 90));
  const parts = [];
  if (meta?.locationLabel) parts.push(el('span', { class: 'sc-loc', title: str(meta.locationLabel, 120), text: `📍 ${str(meta.locationLabel, 60)}` }));
  if (ch !== 'office') parts.push(el('span', { class: `ch-badge ch-badge-${ch}`, text: CHANNEL_BADGE[ch] || ch }));
  if (e) parts.push(timeEl(e));
  if (card.live) parts.push(el('span', { class: 'sc-live', text: 'Đang diễn' }));
  else if (card.summary) parts.push(el('span', { class: 'sc-done', text: '· đã xong' }));
  setKids(card.sub, parts);
  if (meta && arr(meta.participants).length) {
    card.avs.replaceChildren(...arr(meta.participants).slice(0, 6).map((id) =>
      el('button', { class: 'av-btn', type: 'button', 'data-agent': id, 'aria-label': store.name(id) }, avatarEl(id, store.name(id), 22))));
  }
  // v3: thẻ tin gốc (từ PublicScene.news hoặc LogEntry.news của scene_start)
  const news = normNewsRef(meta?.news) || normNewsRef(e?.news) || card.news;
  if (news && (!card.news || card.news.id !== news.id || card.news.url !== news.url || card.news.title !== news.title)) {
    card.news = news;
    setKids(card.newsBox, newsCard(news, { compact: true }));
  }
  card.newsBox.hidden = !card.news;
  card.node.className = `scene-card tone-${sceneToneOf(meta?.type, ch)} ch-${ch}${card.live ? ' is-live' : ''}${card.collapsed ? ' collapsed' : ''}${card.news ? ' has-news' : ''}`;
  card.node.dataset.cat = ch;
  card.channel = ch;
  card.head.setAttribute('aria-label', `${title}${card.live ? ' — đang diễn' : ''}${card.summary ? ' — ' + card.summary : ''}`);
  if (card.collapsed) setText(card.sum, sumText(card));
}

function startCard(v, e, fresh) {
  const sid = e.sceneId || `anon_${e.id ?? ++v.seq}`;
  const meta = (v.live && e.sceneId && store.sceneMeta.get(e.sceneId)) || guessScene(e);
  let card = v.cards.get(sid);
  if (card && (card.live || !card.lineCount)) { card.entry = e; fill(card, meta, e); return; } // thẻ tạm đã được tạo khi dòng đến trước
  if (card) {
    // id cảnh được dùng lại cho một cảnh mới (thẻ cũ đã xong): giữ thẻ cũ dưới khoá khác, tạo thẻ mới
    v.cards.delete(sid);
    const oldKey = `${sid}#${e.id ?? ++v.seq}`;
    card.node.dataset.scene = oldKey;
    v.cards.set(oldKey, card);
  }
  card = buildCard(v, sid, meta, e);
  v.cards.set(sid, card);
  card.live = !!(v.live && e.sceneId && store.scenes.has(e.sceneId));
  if (fresh) card.node.classList.add('fresh');
  fill(card, meta, e);
  if (card.live) v.root.append(card.node); else insertSettled(v, card.node);
}

function finish(v, card, summary) {
  const wasLive = card.live;
  card.live = false;
  if (summary) card.summary = str(summary, 300);
  card.node.classList.remove('is-live');
  if (card.summary) {
    setKids(card.foot, el('span', { class: 'sc-foot-ic', 'aria-hidden': 'true', text: '🎬' }), el('span', { text: card.summary }));
    card.foot.hidden = false;
  }
  setText(card.sum, sumText(card));
  fill(card, (v.live && store.sceneMeta.get(card.id)) || card.meta || null, card.entry);
  // đưa thẻ vừa xong về cuối vùng "đã xong" để các thẻ đang diễn luôn nằm cuối
  const live = firstLiveNode(v);
  if (wasLive && live && live !== card.node && (card.node.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_PRECEDING)) {
    v.root.insertBefore(card.node, live);
  }
  autoCollapse(v);
}

function endCard(v, e) {
  const card = e.sceneId ? v.cards.get(e.sceneId) : null;
  const sc = v.live && e.sceneId ? store.sceneMeta.get(e.sceneId) : null;
  const text = stripIcon(str(e.text || sc?.summary || '', 300), e.icon);
  if (!card) {
    if (text) insertSettled(v, el('div', { class: 'ev ev-end', 'data-cat': sc?.channel || e.channel || 'office' }, el('span', { class: 'ev-icon', 'aria-hidden': 'true', text: '🎬' }), el('span', { class: 'ev-text', text }), timeEl(e)));
    return;
  }
  finish(v, card, text);
}

function updateSceneCard(v, sc) {
  if (!v.live || !sc || !sc.id) return;
  const card = v.cards.get(sc.id);
  if (!card) return;
  const meta = store.sceneMeta.get(sc.id) || sc;
  if (sc.status === 'end') {
    if (card.live) finish(v, card, str(sc.summary || card.summary || '', 300));
    else fill(card, meta, card.entry);
    return;
  }
  const wasLive = card.live;
  card.live = true;
  fill(card, meta, card.entry);
  if (!wasLive) {
    v.root.append(card.node); // chuyển sang vùng đang diễn (cuối feed)
    if (card.collapsed && !card.userToggled) setCollapsed(card, false);
  }
}

// ---------------------------------------------------------------- dòng thoại
function addLine(v, e, fresh) {
  const sid = typeof e.sceneId === 'string' && e.sceneId ? e.sceneId : null;
  let card = sid ? v.cards.get(sid) : null;
  if (sid && !card) {
    // cảnh bắt đầu trước cửa sổ log (hoặc thẻ đã bị cắt): tạo thẻ tạm, đặt tên theo kênh
    const ch = e.channel || 'office';
    const stub = ch === 'group' ? ['Nhóm chat kín', '📱'] : ch === 'company' ? ['Nhóm công ty', '🏢'] : ['Cuộc trò chuyện', '💬'];
    const meta = (v.live && store.sceneMeta.get(sid)) || { id: sid, title: stub[0], icon: stub[1], channel: ch, participants: [], locationLabel: '' };
    card = buildCard(v, sid, meta, { ...e, text: meta.title, icon: meta.icon });
    v.cards.set(sid, card);
    card.live = !!(v.live && store.scenes.has(sid));
    fill(card, meta, card.entry);
    if (card.live) v.root.append(card.node); else insertSettled(v, card.node);
  }
  const node = lineNode(e, card);
  if (fresh) node.classList.add('fresh');
  if (card) {
    card.lines.append(node);
    card.lineCount++;
    if (card.collapsed) {
      if (!card.userToggled && v.live) setCollapsed(card, false);
      else setText(card.sum, sumText(card));
    }
  } else {
    const ch = e.channel || 'office';
    insertSettled(v, el('div', { class: `loose ch-${ch}`, 'data-cat': ch }, node));
  }
  v.lineTotal++;
}

function lineNode(e, card) {
  const ch = e.channel || 'office';
  const speaker = str(e.speaker);
  const agent = store.agents.get(speaker);
  const name = str(e.speakerName || store.name(speaker), 40);
  const role = agent?.status === 'candidate' ? `Ứng viên · ${agent.roleLabel || ''}`.replace(/ · $/, '')
    : agent?.status === 'fired' ? `${agent.roleLabel || ''} (đã nghỉ)`.trim()
      : agent?.roleLabel || '';
  const minute = e.minute || 0;
  const cont = !!card && card.lastSpeaker === speaker && card.lastDay === e.day && Math.abs(minute - card.lastMinute) <= 3;
  if (card) { card.lastSpeaker = speaker; card.lastMinute = minute; card.lastDay = e.day; }
  const who = el('button', { class: 'who', type: 'button', 'data-agent': speaker, style: { '--who': colorOf(speaker) }, text: name });
  const icon = e.icon ? el('span', { class: 'line-icon', 'aria-hidden': 'true', text: str(e.icon, 8) }) : null;
  const body = el('div', { class: 'body' },
    cont ? null : el('div', { class: 'meta' }, who, role ? el('span', { class: 'role', text: `· ${role}` }) : null, icon, timeEl(e)),
    el('div', { class: 'text', text: e.text }),
    productChip(e.product));
  const avBtn = el('button', { class: 'av-btn', type: 'button', 'data-agent': speaker, 'aria-label': `Hồ sơ ${name}` }, avatarEl(speaker, name, 22));
  const node = el('div', { class: `line ch-${ch}${cont ? ' cont' : ''}`, 'data-id': e.id }, cont ? el('span', { class: 'av-gap' }) : avBtn, body);
  // bổ sung avatar người nói vào thẻ cảnh nếu chưa có danh sách người tham gia
  if (card && !card.speakers.has(speaker)) {
    card.speakers.add(speaker);
    const known = arr(card.meta?.participants).length > 0;
    if (!known && card.avs.childElementCount < 6) {
      card.avs.append(el('button', { class: 'av-btn', type: 'button', 'data-agent': speaker, 'aria-label': name }, avatarEl(speaker, name, 22)));
    }
  }
  return node;
}

function productChip(p) {
  if (!p || typeof p !== 'object' || !p.name) return null;
  const url = safeProductUrl(p.url);
  // "{emoji} {tên} · {giá} — Xem Shopee ↗" gọn 1 dòng, tên dài thì "…" (rê chuột xem đủ tên)
  const price = p.priceHint ? str(p.priceHint, 20) : '';
  const inner = [
    el('span', { class: 'prod-emoji', 'aria-hidden': 'true', text: str(p.emoji || '🛍️', 8) }),
    el('span', { class: 'prod-name', text: str(p.name, 80) }),
    price ? el('span', { class: 'prod-price', text: `· ${price}` }) : null,
    url ? el('span', { class: 'prod-cta', text: 'Shopee ↗' }) : null, // CSS thêm "Xem " phía trước khi bảng đủ rộng
  ];
  const title = `${str(p.name, 80)}${price ? ` · ${price}` : ''}`;
  const chip = url
    ? el('a', { class: 'prod-chip', href: url, target: '_blank', rel: 'noopener sponsored', title }, inner)
    : el('span', { class: 'prod-chip', title }, inner);
  // bảng hẹp (< 380px): CSS giấu giá trong chip và in nó trước chú thích (attr data-price) để tên còn chỗ
  return el('div', { class: 'prod' }, chip, el('div', { class: 'prod-cap', 'data-price': price || null, text: 'Link tiếp thị liên kết' }));
}

// ---------------------------------------------------------------- sự kiện: pill 1 dòng
function eventNode(e) {
  const kind = e.kind === 'hr' ? 'hr' : e.kind === 'system' ? 'system' : 'event';
  const text = stripIcon(str(e.text, 300), e.icon);
  const pill = el('div', { class: `ev ev-${kind}`, 'data-cat': 'event', title: text.length > 70 ? text : null },
    e.icon ? el('span', { class: 'ev-icon', 'aria-hidden': 'true', text: str(e.icon, 8) }) : null,
    el('span', { class: 'ev-text', text }),
    timeEl(e));
  const prod = productChip(e.product);
  const news = e.news ? newsCard(e.news, { compact: true, caption: false }) : null; // v3: sự kiện kèm thẻ tin
  if (!prod && !news) return pill;
  return el('div', { class: 'ev-wrap', 'data-cat': 'event' }, pill, prod, news);
}
