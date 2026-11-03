// Nhãn tiếng Việt + hằng số hiển thị phía client.
import { capFirst, noAccent } from './util.js';

/** Thứ tự hiển thị phòng ban (giống ROLE_ORDER của server) */
export const ROLE_ORDER = ['boss', 'hr', 'techlead', 'senior', 'junior', 'qa', 'designer', 'saleslead', 'salesnew', 'marketing'];

/** Mặc định của SPEC; giá trị thật lấy từ hello.rules (store.rules) */
export const KPI_WARN_DAYS = 2;

/** tông màu KPI theo ngưỡng: ok ≥ 100%, mid ≥ ngưỡng thấp, low dưới ngưỡng */
export function kpiTone(ratio, lowRatio = 0.7) {
  return ratio >= 1 ? 'ok' : ratio >= lowRatio ? 'mid' : 'low';
}

/** phần ngày làm việc đã trôi qua (08:00→17:30, trừ giờ trưa) — cùng công thức với src/sim/hr.ts */
export function workdayElapsed(minute) {
  const m = Number(minute) || 0;
  const lunch = Math.max(0, Math.min(m, 780) - 720);
  return Math.max(0, Math.min(1, (Math.min(m, 1050) - 480 - lunch) / 510));
}

/**
 * Tông màu KPI HÔM NAY theo tiến độ trong ngày: 9h sáng đạt 15% là bình thường, không tô đỏ.
 * Hết giờ làm (17:30) thì giống kpiTone. Bảng KPI trên tường vẫn dùng ngưỡng tuyệt đối (SPEC).
 */
export function kpiPaceTone(ratio, minute, lowRatio = 0.7) {
  if (ratio >= 1) return 'ok';
  const expected = workdayElapsed(minute);
  if (expected < 0.06) return 'ok';
  return kpiTone(ratio / expected, lowRatio);
}

export const DAY_START_MIN = 7 * 60 + 30; // 07:30
export const DAY_END_MIN = 18 * 60 + 30; // 18:30

export const DEV_EVENTS = [
  ['boss_leave', '🏌️', 'Sếp đi vắng'],
  ['boss_return', '🚶', 'Sếp về'],
  ['server_down', '🔥', 'Sập server'],
  ['wifi_down', '📶', 'Mất wifi'],
  ['payday', '💸', 'Ngày lương'],
  ['birthday', '🎂', 'Sinh nhật'],
  ['deal', '💰', 'Chốt deal'],
  ['drama', '🤫', 'Tạo drama'],
  ['hr_review', '📋', 'HR xét KPI'],
  ['release', '🚀', 'Release'],
  ['end_day', '🌙', 'Kết thúc ngày'],
  // v3: ép 1 cảnh tám chuyện thời sự / ép AI biên kịch lên "biến" ngay
  ['news', '🗞️', 'Thời sự'],
  ['showrunner', '🎬', 'Biên kịch'],
];

export const SPEEDS = [1, 2, 5, 10];

export const FEED_FILTERS = [
  ['all', 'Tất cả'],
  ['office', 'Văn phòng'],
  ['group', 'Nhóm kín'],
  ['company', 'Nhóm cty'],
  ['event', 'Sự kiện'],
];

export const CHANNEL_BADGE = {
  group: '📱 Nhóm kín',
  company: '🏢 Nhóm Cty',
  office: '🏢 Văn phòng',
};

export const TRAIT_LABELS = [
  ['diligence', 'Chăm chỉ', '#22c55e'],
  ['laziness', 'Lười biếng', '#a78bfa'],
  ['gossip', 'Nhiều chuyện', '#ec4899'],
  ['temper', 'Nóng tính', '#ef4444'],
  ['humor', 'Hài hước', '#f59e0b'],
  ['ambition', 'Tham vọng', '#3b82f6'],
];

const ACT = {
  offsite: ['Vắng', 'muted'],
  arriving: ['Đang đến', 'info'],
  leaving: ['Đang về', 'muted'],
  working: ['Đang làm', 'ok'],
  slacking: ['Đang lười', 'slack'],
  napping: ['Ngủ gật', 'slack'],
  coffee: ['Pha cà phê', 'break'],
  water: ['Uống nước', 'break'],
  snack: ['Ăn vặt', 'break'],
  toilet: ['Đi WC', 'break'],
  pingpong: ['Bóng bàn', 'slack'],
  chill: ['Nằm chill', 'slack'],
  window: ['Hóng gió', 'break'],
  printing: ['In tài liệu', 'info'],
  lunch: ['Ăn trưa', 'break'],
  meeting: ['Đang họp', 'info'],
  scene: ['Đang nói chuyện', 'talk'],
  boss_office: ['Trong phòng', 'ok'],
  patrol: ['Đi tuần', 'warn'],
  away: ['Đi vắng', 'muted'],
  server_fix: ['Sửa server', 'danger'],
  showroom: ['Ngắm đồ', 'break'],
  idle: ['Đang rảnh', 'muted'],
};

/** Huy hiệu trạng thái: [text, tone] */
export function statusBadge(agent) {
  if (!agent) return ['?', 'muted'];
  if (agent.status === 'fired') return ['Đã nghỉ', 'fired'];
  if (agent.status === 'candidate') return ['Ứng viên', 'cand'];
  if (!agent.present && agent.activity !== 'away') return ['Vắng', 'muted'];
  const a = ACT[agent.activity] || ['…', 'muted'];
  if (agent.activity === 'slacking' && agent.activityLabel) return [capFirst(shortLabel(agent.activityLabel)), 'slack'];
  if (agent.activity === 'window' && /sales/.test(agent.role || '')) return ['Gọi khách', 'info'];
  if (agent.activity === 'working' && /giả vờ/.test(agent.activityLabel || '')) return ['Giả vờ làm', 'warn'];
  return a;
}

function shortLabel(s) {
  const t = String(s).trim();
  return t.length > 18 ? t.slice(0, 17) + '…' : t;
}

export function activityText(agent) {
  if (!agent) return '';
  if (agent.status === 'fired') return 'ôm thùng đồ ra về';
  if (!agent.present) return agent.activity === 'away' ? (agent.activityLabel || 'đi vắng') : 'không có mặt';
  return agent.activityLabel || (ACT[agent.activity] || ['…'])[0].toLowerCase();
}

/** Loại màn hình khi lười: dựa vào nhãn hoạt động rồi emote */
export function slackScreenKind(label, emote) {
  const s = noAccent(label || '');
  if (/tiktok|reels|short/.test(s)) return 'tiktok';
  if (/shopee|lazada|sale|mua sam|san sale|tiki/.test(s)) return 'shopee';
  if (/game|lien quan|pubg|choi/.test(s)) return 'game';
  if (/crypto|coin|chung khoan|co phieu|bitcoin|vang/.test(s)) return 'crypto';
  if (/youtube|phim|netflix|video|xem/.test(s)) return 'video';
  if (/facebook|zalo|nhan tin|chat|messenger|insta/.test(s)) return 'chat';
  if (/bao|tin tuc|doc/.test(s)) return 'news';
  if (/bong da|football/.test(s)) return 'football';
  const e = String(emote || '');
  if (/🛒|🛍|💳/u.test(e)) return 'shopee';
  if (/🎮|🕹|👾/u.test(e)) return 'game';
  if (/📈|📉|💹|🪙|💸|💰/u.test(e)) return 'crypto';
  if (/🎬|📺|🍿|▶/u.test(e)) return 'video';
  if (/💬|👍|💌/u.test(e)) return 'chat';
  if (/📰/u.test(e)) return 'news';
  if (/⚽/u.test(e)) return 'football';
  return 'tiktok';
}

export function workScreenKind(role) {
  switch (role) {
    case 'techlead': case 'senior': case 'junior': return 'code';
    case 'qa': return 'qa';
    case 'designer': return 'design';
    case 'marketing': return 'mkt';
    case 'boss': return 'chart';
    default: return 'sheet';
  }
}

export const ROOM_ICONS = {
  work: '💻', toilet: '🚻', wc: '🚻', server: '🖥️', meeting: '📋', boss: '👔', hall: '🏓', pantry: '☕', lounge: '🛋️', showroom: '🛍️',
};

/** Kệ phòng trưng bày (v2): [icon, nhãn] */
export const SHELF_LABELS = { beauty: ['💄', 'Làm đẹp & thời trang'], tech: ['🔌', 'Công nghệ & nhà cửa'] };

/**
 * Tên nhà cung cấp AI đang dùng (UsageStats.activeProvider). Server cũ chỉ gửi model:
 * suy ra từ tên model, KHÔNG bao giờ ghi "GPT" trừ khi thật sự là OpenAI.
 */
export function aiProviderName(ai) {
  const p = typeof ai?.activeProvider === 'string' ? ai.activeProvider.trim() : '';
  if (p) return p.slice(0, 24);
  const m = noAccent(ai?.model || '');
  if (/gemini/.test(m)) return 'Gemini';
  if (/^(gpt-|o[1-9]|chatgpt)/.test(m)) return 'OpenAI';
  if (/claude/.test(m)) return 'Claude';
  if (/llama|mixtral|gpt-oss|qwen|deepseek/.test(m)) return 'Groq';
  return 'AI';
}

/** "AI · Gemini · gemini-3.5-flash-lite · 35 lượt · $0" (docs/v2-contract.md §4) */
export function aiFullLabel(ai, fmtCalls, fmtCost) {
  if (!ai) return 'AI · đang tải…';
  if (ai.mode !== 'llm') return 'Offline · câu thoại mẫu';
  const model = String(ai.model || '').trim();
  return ['AI', aiProviderName(ai), model, `${fmtCalls(ai.calls)} lượt`, fmtCost(ai.costTodayUsd)].filter(Boolean).join(' · ');
}

/** Trạng thái một provider trong popover: "sẵn sàng" / "nghỉ tới 15:32 (hết quota ngày)" / "tắt" */
export function providerStateLabel(p, now = Date.now()) {
  const until = Number(p?.cooldownUntil) || 0;
  if (until > now) {
    const d = new Date(until);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const why = typeof p.cooldownReason === 'string' && p.cooldownReason.trim() ? ` (${p.cooldownReason.trim()})` : '';
    return [`nghỉ tới ${hhmm}${why}`, 'cool'];
  }
  if (p?.enabled === false) return [p?.cooldownReason ? String(p.cooldownReason) : 'chưa sẵn sàng', 'off'];
  return ['sẵn sàng', 'ok'];
}

/** biểu tượng + tiêu đề khi sếp vắng, dựa vào ghi chú của server */
export function bossAwayLabel(note) {
  const s = noAccent(note || '');
  if (/cuoi tuan|dong cua/.test(s)) return ['🏖️', 'Cuối tuần nghỉ'];
  if (/chua (den|toi|vao)/.test(s)) return ['🕗', 'Sếp chưa đến'];
  if (/(da )?ve (nha|roi)|tan lam|het gio|ra ve/.test(s)) return ['🏠', 'Sếp đã về'];
  return ['🏌️', 'Sếp đi vắng'];
}

/** loại cảnh nghiêm trọng -> tô màu đỏ */
export const HOT_SCENES = new Set(['boss_catch', 'firing', 'hr_warning', 'incident', 'confront', 'layoff']);
export const HAPPY_SCENES = new Set(['celebration', 'welcome', 'pingpong_match']);
export const SHOP_SCENES = new Set(['showroom_chat']);

/**
 * Tông màu thẻ cảnh theo loại (v3 thêm: news 🗞️ xanh biển · hr ⚖️🚪💵 tím · gold 🎖️ vàng · layoff 📉 đỏ;
 * v5: crisis 🧯 cam đất cho họp xử lý tình huống, 📣 truyền lửa dùng tông nhân sự).
 * Loại lạ -> theo kênh (office / group / company) như trước.
 */
const SCENE_TONE = { news_chat: 'news', hr_review: 'hr', resign_talk: 'hr', raise_request: 'hr', promotion: 'gold', crisis_meeting: 'crisis', pep_talk: 'hr' };
export function sceneToneOf(type, channel) {
  if (HOT_SCENES.has(type)) return 'hot';
  if (HAPPY_SCENES.has(type)) return 'happy';
  if (SHOP_SCENES.has(type)) return 'shop';
  return SCENE_TONE[type] || channel || 'office';
}

/** icon + tiêu đề mặc định cho các loại cảnh v3 (server vẫn gửi title/icon riêng; đây là dự phòng) */
export const SCENE_DEFAULTS = {
  news_chat: ['🗞️', 'Tám chuyện thời sự'],
  hr_review: ['⚖️', 'Họp xét nhân sự'],
  resign_talk: ['🚪', 'Nói chuyện xin nghỉ'],
  raise_request: ['💵', 'Xin tăng lương'],
  promotion: ['🎖️', 'Thăng chức & khen thưởng'],
  layoff: ['📉', 'Cắt giảm nhân sự'],
  // v5: tình huống công ty
  crisis_meeting: ['🧯', 'Họp xử lý tình huống'],
  pep_talk: ['📣', 'Sếp truyền lửa'],
};

/** Nhóm tin thời sự (NewsCategory): [icon, nhãn] */
export const NEWS_CATEGORIES = {
  bong_da: ['⚽', 'Bóng đá'],
  the_thao: ['🏅', 'Thể thao'],
  cong_nghe: ['💻', 'Công nghệ'],
  game: ['🎮', 'Game'],
  khoa_hoc: ['🔬', 'Khoa học'],
  giai_tri: ['🎬', 'Giải trí'],
};

/** Quyết định nhân sự do AI đưa ra (HrAction) -> nhãn tiếng Việt (trang Lịch sử) */
export const HR_ACTION_LABELS = {
  warn: ['⚠️', 'cảnh cáo'],
  fire: ['📦', 'cho nghỉ việc'],
  second_chance: ['🤝', 'cho thêm cơ hội'],
  probation: ['⏳', 'đưa vào thử thách'],
  praise: ['👏', 'khen trước công ty'],
  bonus: ['🎁', 'thưởng nóng'],
  promote: ['🎖️', 'thăng chức'],
  open_position: ['🪑', 'mở vị trí tuyển mới'],
  layoff: ['📉', 'cắt giảm'],
  none: ['➖', 'giữ nguyên'],
};

/** Thứ trong tuần theo ngày thật (Date.getDay()) — nhãn ngày trong Lịch sử */
export const WEEKDAYS_FULL = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
