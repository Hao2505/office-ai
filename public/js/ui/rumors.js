// Tab "Tin đồn": chuỗi "tam sao thất bản" — ai kể cho ai, mỗi lần kể lại sai lệch thế nào.
import { store } from '../store.js';
import { el, setKids, arr, str, num, fmtClock, noAccent } from '../util.js';
import { avatarEl } from './avatar.js';
import { markUnread } from './tabs.js';

let box;
let onOpen = () => {};
let lastSig = '';

export function initRumors(openProfile) {
  onOpen = openProfile || onOpen;
  box = document.getElementById('rumors');
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-agent]');
    if (t) onOpen(t.dataset.agent);
  });
  store.on('hello', () => { lastSig = sig(); render(); });
  store.on('rumors', () => {
    const s = sig();
    if (s !== lastSig && lastSig) markUnread('rumors');
    lastSig = s;
    render();
  });
  store.on('agents', () => { if (box.childElementCount && store.rumors.length) render(); });
}

function sig() {
  return arr(store.rumors).map((r) => `${r.id}:${arr(r.versions).length}`).join('|');
}

function render() {
  const list = [...arr(store.rumors)].sort((a, b) => (b.active === a.active ? lastAt(b) - lastAt(a) : b.active ? 1 : -1));
  if (!list.length) {
    setKids(box, el('div', { class: 'empty' },
      el('div', { class: 'empty-icon', text: '🤫' }),
      el('div', { class: 'empty-title', text: 'Chưa có tin đồn nào' }),
      el('div', { class: 'empty-text', text: 'Khi có người "nói xấu sau lưng", tin đồn sẽ lan từ người này sang người khác — và mỗi lần kể lại là thêm mắm dặm muối. Theo dõi tại đây!' })));
    return;
  }
  setKids(box, list.map(card));
}

function lastAt(r) {
  const v = arr(r.versions);
  const x = v[v.length - 1];
  return x ? num(x.day) * 1440 + num(x.minute) : num(r.createdDay) * 1440;
}

const STOP = new Set(['la', 'va', 'thi', 'ma', 'co', 'cua', 'nay', 'do', 'voi', 'cho', 'nha', 'oi', 'a', 'ha', 'the', 'nghe', 'noi']);
function words(s, keepStop = false) {
  const all = noAccent(s).split(/[^a-z0-9]+/).filter(Boolean);
  return keepStop ? all : all.filter((w) => !STOP.has(w));
}

/**
 * Tô sáng phần bị "thêm mắm dặm muối" so với bản trước (DOM an toàn: chỉ text node + <mark>).
 * Từ nội dung mới -> tô; từ đệm (là, có, nghe nói…) chỉ tô khi nằm trong / mở đầu một cụm mới,
 * để cụm "nghe nói còn có ảnh làm bằng chứng" được tô liền một khối.
 */
function diffText(text, prev) {
  if (!prev) return [text];
  const before = new Set(words(prev));
  const beforeRaw = new Set(words(prev, true));
  const tokens = String(text).split(/(\s+)/).filter((t) => t !== '');
  // 'sp' khoảng trắng | 'new' | 'old' | 'n' từ đệm/dấu câu | 'n+' từ đệm chưa có ở bản trước
  const kind = tokens.map((t) => {
    if (/^\s+$/.test(t)) return 'sp';
    const w = words(t);
    if (w.length) return w.some((x) => !before.has(x)) ? 'new' : 'old';
    const raw = words(t, true);
    return raw.length && raw.some((x) => !beforeRaw.has(x)) ? 'n+' : 'n';
  });
  const content = (i, step) => {
    for (let j = i + step; j >= 0 && j < tokens.length; j += step) if (kind[j] === 'new' || kind[j] === 'old') return kind[j];
    return null;
  };
  const marked = kind.map((k, i) => {
    if (k === 'new') return true;
    if (k === 'n' || k === 'n+') return content(i, 1) === 'new' && (content(i, -1) === 'new' || k === 'n+');
    return false;
  });
  // khoảng trắng thuộc cụm tô nếu hai bên đều được tô
  for (let i = 0; i < tokens.length; i++) if (kind[i] === 'sp') marked[i] = !!(marked[i - 1] && marked[i + 1]);
  const out = [];
  let buf = '', bufMarked = false;
  const flush = () => { if (buf) out.push(bufMarked ? el('mark', { text: buf }) : buf); buf = ''; };
  tokens.forEach((t, i) => {
    if (marked[i] !== bufMarked) { flush(); bufMarked = marked[i]; }
    buf += t;
  });
  flush();
  return out;
}

function card(r) {
  const versions = arr(r.versions);
  const about = str(r.aboutId);
  const aboutName = str(r.aboutName || store.name(about), 40);
  const heard = arr(r.heardBy).length;
  return el('article', { class: `rumor ${r.active ? 'active' : 'cold'}` },
    el('header', { class: 'rm-head' },
      el('button', { class: 'av-btn', type: 'button', 'data-agent': about }, avatarEl(about, aboutName, 36)),
      el('div', { class: 'rm-headtext' },
        el('div', { class: 'rm-title' }, 'Tin đồn về ', el('b', { text: aboutName })),
        el('div', { class: 'rm-meta', text: `Từ ngày ${num(r.createdDay, 1)} · 👂 ${heard} người đã nghe · ${versions.length} phiên bản` })),
      el('span', { class: `badge ${r.active ? 'tone-danger' : 'tone-muted'}`, text: r.active ? '🔥 Đang lan' : '💤 Đã lắng' })),
    el('ol', { class: 'rm-chain' }, versions.map((v, i) => {
      const teller = str(v.tellerId), listener = str(v.listenerId);
      const tag = i === 0 ? 'Bản gốc' : i === versions.length - 1 ? 'Mới nhất' : `Lần ${i + 1}`;
      return el('li', { class: `rm-ver ${i === versions.length - 1 ? 'latest' : ''}` },
        el('div', { class: 'rm-who' },
          el('span', { class: 'rm-tag', text: tag }),
          el('button', { class: 'rm-person', type: 'button', 'data-agent': teller }, avatarEl(teller, store.name(teller), 20), el('span', { text: store.name(teller) })),
          el('span', { class: 'rm-arrow', text: '→' }),
          el('button', { class: 'rm-person', type: 'button', 'data-agent': listener }, avatarEl(listener, store.name(listener), 20), el('span', { text: store.name(listener) })),
          el('time', { class: 'when', text: `N${num(v.day)} · ${fmtClock(v.minute)}` })),
        el('blockquote', { class: 'rm-text' }, diffText(str(v.text, 400), i > 0 ? str(versions[i - 1].text, 400) : '')));
    })));
}
