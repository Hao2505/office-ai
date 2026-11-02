// Kết nối WebSocket tới server: tự kết nối lại với backoff, ping giữ kết nối.
// v3: mã dev (DEV_TOKEN) — đọc từ ?dev=TOKEN hoặc #dev=TOKEN, cất LÂU DÀI trong localStorage của trình duyệt (vào 1 lần là
// nhớ mãi, tới khi bấm "Thoát admin" hoặc mở trang với #dev= rỗng), gỡ khỏi thanh địa chỉ, gắn vào URL WebSocket (?dev=TOKEN)
// để server quyết định có mở bảng dev không. Không bao giờ hiển thị / ghi log.
import { handleMessage, setConn } from './store.js';

let ws = null;
let attempt = 0;
let retryTimer = 0;
let pingTimer = 0;
let everOpened = false;

const DEV_KEY = 'vpa.dev';

function readStored() {
  try {
    // bản cũ cất trong sessionStorage → chuyển sang localStorage một lần
    const s = sessionStorage.getItem(DEV_KEY);
    if (s) { localStorage.setItem(DEV_KEY, s); sessionStorage.removeItem(DEV_KEY); return s; }
    return localStorage.getItem(DEV_KEY) || '';
  } catch { return ''; }
}
function writeStored(token) {
  try {
    if (token) localStorage.setItem(DEV_KEY, token); else localStorage.removeItem(DEV_KEY);
    sessionStorage.removeItem(DEV_KEY);
  } catch { /* trình duyệt chặn storage: chỉ dùng được trong tab này */ }
}

let cookieSynced = false;
/** Đặt cookie admin HttpOnly trên server (sống 1 năm): tắt trình duyệt, xoá bộ nhớ JS vẫn còn admin. Mỗi lần mở trang làm 1 lần. */
function syncCookie(token) {
  if (cookieSynced || !token) return;
  cookieSynced = true;
  fetch('/api/dev/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    .catch(() => { /* mất mạng: lần mở trang sau thử lại */ });
}

/** Quên mã admin trên trình duyệt này (bộ nhớ JS + cookie) rồi tải lại trang (nút "Thoát admin" ở bảng dev) */
export function forgetDevToken() {
  writeStored('');
  fetch('/api/dev/logout', { method: 'POST', credentials: 'same-origin', keepalive: true })
    .catch(() => { /* bỏ qua */ })
    .finally(() => location.reload());
}

/**
 * Mã dev hiện tại ('' nếu không có). Lần đầu: lấy từ URL rồi xoá khỏi URL (giữ nguyên các tham số #tab/#profile),
 * `?dev=` / `#dev=` rỗng = quên mã. Các lần sau (mở lại trang, tab mới, kết nối lại): lấy từ localStorage.
 */
function devToken() {
  let token = null;
  try {
    const url = new URL(location.href);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (url.searchParams.has('dev')) token = url.searchParams.get('dev');
    else if (hash.has('dev')) token = hash.get('dev');
    if (token != null) {
      token = token.trim().slice(0, 200);
      writeStored(token);
      url.searchParams.delete('dev');
      hash.delete('dev');
      const h = hash.toString();
      url.hash = h ? `#${h}` : '';
      history.replaceState(history.state, '', url.toString());
    } else {
      token = readStored();
    }
  } catch {
    token = '';
  }
  if (token) syncCookie(token);
  return token || '';
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = devToken();
  return `${proto}//${location.host}/ws${token ? `?dev=${encodeURIComponent(token)}` : ''}`;
}

export function connect() {
  clearTimeout(retryTimer);
  setConn(everOpened ? 'closed' : 'connecting');
  let sock;
  try {
    sock = new WebSocket(wsUrl());
  } catch (e) {
    scheduleRetry();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    attempt = 0;
    everOpened = true;
    setConn('open');
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ t: 'ping' }), 25000);
  };
  sock.onmessage = (ev) => {
    if (ws !== sock || typeof ev.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    setConn(everOpened ? 'closed' : 'connecting');
    scheduleRetry();
  };
  sock.onerror = () => { /* onclose sẽ xử lý */ };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = Math.min(15000, 800 * Math.pow(1.7, attempt)) * (0.8 + Math.random() * 0.4);
  attempt++;
  retryTimer = setTimeout(connect, delay);
}

export function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

// Quay lại tab sau khi máy ngủ: thử kết nối ngay
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !ws) {
    attempt = 0;
    connect();
  }
});
window.addEventListener('online', () => {
  if (!ws) { attempt = 0; connect(); }
});
