// Lưu / đọc trạng thái ra file JSON — ghi nguyên tử (file tạm + rename) để không bao giờ để lại file hỏng.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const STATE_VERSION = 1;

export interface StateFile {
  version: number;
  savedAt: string;
  world: unknown;
  director: unknown;
  brain: unknown;
}

/** Ghi JSON nguyên tử: ghi vào file tạm cùng thư mục, fsync, rồi rename đè lên file thật. */
export function writeJsonAtomic(file: string, data: unknown): void {
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  const json = JSON.stringify(data);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, 'w');
    writeSync(fd, json);
    try { fsyncSync(fd); } catch { /* fsync không bắt buộc */ }
    closeSync(fd);
    fd = null;
    renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) { try { closeSync(fd); } catch { /* bỏ qua */ } }
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* bỏ qua */ }
    throw e;
  }
}

/** Đọc file JSON. undefined nếu file không tồn tại; throw nếu đọc/parse lỗi. */
export function readJsonFile(file: string): unknown {
  const target = resolve(file);
  if (!existsSync(target)) return undefined;
  const text = readFileSync(target, 'utf8');
  return JSON.parse(text);
}

/** Đổi tên file hỏng sang *.bad-<thời gian> để lần lưu sau không ghi đè mất dữ liệu (có thể cứu tay). */
export function quarantineFile(file: string): string | null {
  try {
    const target = resolve(file);
    if (!existsSync(target)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${target}.bad-${stamp}`;
    renameSync(target, dest);
    return dest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- validators (dùng khi khôi phục)

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Số hữu hạn, kẹp trong [min, max]; sai kiểu => giá trị mặc định */
export function num(v: unknown, def: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Chuỗi (cắt ngắn); sai kiểu => mặc định */
export function str(v: unknown, def: string, maxLen = 2000): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : def;
}

export function strArr(v: unknown, maxItems = 20, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').slice(0, maxItems).map((s) => s.slice(0, maxLen));
}

export function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
