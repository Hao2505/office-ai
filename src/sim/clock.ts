// Đồng hồ game: thời gian nén (mặc định) hoặc theo giờ thật Việt Nam.
// `time` = phút game tuyệt đối (float). Ngày 1 bắt đầu ở time 0 (00:00).

export const MIN_PER_DAY = 1440;
/** 07:30 — giờ "mở cửa" mỗi ngày ở chế độ nén */
export const DAY_START = 450;
export const ALLOWED_SPEEDS: readonly number[] = [1, 2, 5, 10];

export const WEEKDAYS_5 = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu'] as const;
/** Theo Date.getUTCDay(): 0 = Chủ Nhật */
export const WEEKDAYS_7 = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

/** Việt Nam: UTC+7, không có giờ mùa hè */
const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

/** Phút trong ngày từ giờ:phút */
export const hm = (h: number, m = 0): number => h * 60 + m;

/** 'HH:MM' từ phút trong ngày (float ok) */
export function fmtClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Giờ thật Việt Nam: số ngày kể từ epoch (theo lịch VN), phút trong ngày, thứ (0 = CN) */
export function vnWall(ms: number = Date.now()): { epochDay: number; minute: number; dow: number } {
  const local = ms + VN_OFFSET_MS;
  const epochDay = Math.floor(local / DAY_MS);
  const minute = (local - epochDay * DAY_MS) / 60_000;
  const dow = (((epochDay + 4) % 7) + 7) % 7; // 1970-01-01 là Thứ Năm
  return { epochDay, minute, dow };
}

/** Tên thứ cho ngày game ở chế độ nén (không có cuối tuần) */
export const compressedWeekday = (day: number): string =>
  WEEKDAYS_5[(((Math.max(1, Math.floor(day)) - 1) % 5) + 5) % 5];

/** Thứ theo lịch thật cho chế độ realtime */
export const realWeekday = (epochDay: number): string => WEEKDAYS_7[(((epochDay + 4) % 7) + 7) % 7];

export const isWeekendEpochDay = (epochDay: number): boolean => {
  const dow = (((epochDay + 4) % 7) + 7) % 7;
  return dow === 0 || dow === 6;
};

/** Ban đêm: trước 07:00 hoặc từ 19:00 */
export const isNightMinute = (minuteOfDay: number): boolean => minuteOfDay < hm(7) || minuteOfDay >= hm(19);
