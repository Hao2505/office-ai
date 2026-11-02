// Avatar DOM: vòng tròn màu áo + chữ cái đầu (feed, tin đồn, quan hệ). Chân dung chibi cho thẻ nhân sự.
import { store } from '../store.js';
import { el, safeColor, initial, hashStr } from '../util.js';
import { luma } from '../render/draw.js';
import { portrait } from '../render/character.js';

const FALLBACK = ['#f97316', '#0ea5e9', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#6366f1'];

export function colorOf(id) {
  const look = store.look(id);
  return safeColor(look?.shirt, FALLBACK[hashStr(id || '?') % FALLBACK.length]);
}

export function avatarEl(id, name, size = 32, extraClass = '') {
  const look = store.look(id);
  const bg = colorOf(id);
  const hair = safeColor(look?.hair, '#3b2a20');
  const dark = luma(bg) > 0.68;
  return el('span', {
    class: `av ${extraClass}`.trim(),
    style: {
      '--av-bg': bg,
      '--av-hair': hair,
      '--av-size': `${size}px`,
      color: dark ? '#1f2937' : '#ffffff',
    },
    title: name || '',
    'aria-hidden': 'true',
  }, initial(name || store.name(id)));
}

const portraitCache = new Map();
/** canvas chân dung (mỗi lần trả về canvas mới, vẽ lại từ look) */
export function portraitEl(agent, size = 44, full = false) {
  const look = agent?.look || store.look(agent?.id);
  const wrap = el('span', { class: `portrait ${full ? 'portrait-full' : ''}`, style: { '--pt-bg': safeColor(look?.shirt, '#e5e7eb') }, 'aria-hidden': 'true' });
  if (look) {
    const c = portrait(look, size, { full, blazer: agent?.role === 'boss' || agent?.role === 'saleslead', carry: agent?.status === 'fired' });
    wrap.append(c);
  } else wrap.append(initial(agent?.name));
  portraitCache.set(agent?.id, true);
  return wrap;
}
