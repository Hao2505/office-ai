// Thông báo nổi giữa phía trên canvas.
import { el, stripIcon } from '../util.js';

let box = null;

export function initToasts(container) {
  box = container;
}

export function toast(icon, text, tone = '') {
  if (!box) return;
  const node = el('div', { class: `toast ${tone ? 'toast-' + tone : ''}`, role: 'status' },
    el('span', { class: 'toast-icon', text: icon || '🔔' }),
    el('span', { class: 'toast-text', text: stripIcon(text, icon) }));
  box.append(node);
  while (box.children.length > 3) box.firstElementChild.remove();
  requestAnimationFrame(() => node.classList.add('in'));
  const ttl = Math.min(7000, 3800 + String(text || '').length * 25);
  setTimeout(() => {
    node.classList.remove('in');
    node.classList.add('out');
    setTimeout(() => node.remove(), 400);
  }, ttl);
}
