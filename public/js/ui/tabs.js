// Tab sidebar + chấm "có tin mới".
const handlers = new Set();
let current = 'live';

export function initTabs(root) {
  const buttons = [...root.querySelectorAll('[data-tab]')];
  const panels = [...root.querySelectorAll('[data-panel]')];
  const activate = (name, focus = false) => {
    current = name;
    for (const b of buttons) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) {
        b.classList.remove('unread');
        if (focus) b.focus();
      }
    }
    for (const p of panels) p.classList.toggle('active', p.dataset.panel === name);
    for (const fn of handlers) fn(name);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => activate(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      activate(n.dataset.tab, true);
    });
  });
  activate(current);
  return { activate };
}

export function onTab(fn) {
  handlers.add(fn);
}

export function currentTab() {
  return current;
}

export function markUnread(name) {
  if (name === current) return;
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('unread');
}
