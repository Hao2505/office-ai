// =====================================================================
//  Lưu trữ dài hạn (v3, docs/v3-news.md "Lưu trữ dài hạn"): mỗi ngày (theo giờ Việt Nam) một file
//  data/history/YYYY-MM-DD.jsonl, chỉ nối thêm — mọi LogEntry (thoại, sự kiện, HR, cảnh), bản tin, quyết định
//  nhân sự, beat của AI biên kịch… Dòng = {"ts":<ms>,"kind":"log|recap|hr|beat|kpi|news|…","data":{…}}.
//  Không bao giờ chặn tick: hàng đợi có trần, ghi theo lô mỗi 2 s (fs/promises); lỗi → ghi log 1 lần rồi bỏ lô.
//  Xoay vòng (lúc khởi động + mỗi ngày): gzip file cũ hơn HISTORY_GZIP_AFTER_DAYS, xoá cũ hơn HISTORY_KEEP_DAYS.
//  Singleton getArchive(): tắt cho tới khi configure({ enabled: true }).start() — test không bao giờ vô tình ghi file.
// =====================================================================
import { createReadStream, createWriteStream, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { join, resolve } from 'node:path';

const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HISTORY_READ_MAX = 5000;

export interface ArchiveEntry { ts: number; kind: string; data: unknown }
export interface ArchiveDay { date: string; count: number; bytes: number; gz: boolean }
export interface ArchiveOptions {
  dir: string;
  enabled: boolean;
  keepDays: number;
  gzipAfterDays: number;
  flushMs: number;        // mặc định 2000
  maxQueue: number;       // trần hàng đợi (dòng); vượt → bỏ dòng cũ nhất
  maxLineBytes: number;   // dòng quá dài bị cắt data thành chuỗi ngắn
  now: () => number;
  warn: (msg: string) => void;
  info: (msg: string) => void;
}
export interface ArchiveStats {
  enabled: boolean; dir: string; queued: number; written: number; dropped: number; errors: number;
  lastError: string | null; lastFlushAt: number | null; lastRotateAt: number | null; gzipped: number; deleted: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7) — ngày của chủ dự án / người xem, không phụ thuộc múi giờ VPS */
export function vnDate(ms: number): string {
  const d = new Date(ms + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const isDateString = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s) && Number.isFinite(dateToDays(s));
/** số ngày kể từ epoch của 'YYYY-MM-DD' (NaN nếu sai) */
export function dateToDays(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return NaN;
  const [y, mo, d] = date.split('-').map(Number);
  const t = Date.UTC(y, mo - 1, d);
  if (new Date(t).getUTCMonth() !== mo - 1 || new Date(t).getUTCDate() !== d) return NaN;
  return Math.floor(t / DAY_MS);
}

export class Archive {
  private opts: ArchiveOptions;
  private queue: { date: string; line: string }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private rotating: Promise<{ gzipped: number; deleted: number }> | null = null;
  private lastRotateDate = '';
  private lastWarnAt = 0;
  private dirReady = false;
  /** lô vừa được xếp lại hàng đợi sau ENOENT (chỉ thử lại một lần cho tới khi ghi được) */
  private requeued = false;
  private countCache = new Map<string, { mtimeMs: number; size: number; count: number }>();
  /** số dòng của các ngày đã nén (bất biến) được ghi xuống HISTORY_DIR/index.json để khỏi giải nén lại sau mỗi lần khởi động */
  private indexLoaded = false;
  private indexDirty = false;
  private st: ArchiveStats;

  constructor(opts: Partial<ArchiveOptions> = {}) {
    this.opts = { ...Archive.defaults(), ...opts };
    this.st = {
      enabled: this.opts.enabled, dir: resolve(this.opts.dir), queued: 0, written: 0, dropped: 0, errors: 0,
      lastError: null, lastFlushAt: null, lastRotateAt: null, gzipped: 0, deleted: 0,
    };
  }

  static defaults(): ArchiveOptions {
    return {
      dir: 'data/history', enabled: false, keepDays: 180, gzipAfterDays: 7, flushMs: 2000, maxQueue: 5000,
      maxLineBytes: 64 * 1024, now: () => Date.now(),
      warn: (m) => console.warn(m), info: (m) => console.log(m),
    };
  }

  /** Đổi cấu hình (server / smoke). Đổi thư mục → bộ đệm đếm dòng được làm mới. */
  configure(opts: Partial<ArchiveOptions>): this {
    const wasRunning = this.timer !== null;
    if (wasRunning) this.stop();
    this.opts = { ...this.opts, ...opts };
    this.st.enabled = this.opts.enabled;
    this.st.dir = resolve(this.opts.dir);
    this.dirReady = false;
    this.countCache.clear();
    this.indexLoaded = false;
    this.indexDirty = false;
    if (wasRunning) this.start();
    return this;
  }

  options(): Readonly<ArchiveOptions> { return this.opts; }
  dir(): string { return this.st.dir; }
  enabled(): boolean { return this.opts.enabled; }

  // ---------------------------------------------------------------- vòng đời
  /** Bật bộ ghi theo lô + xoay vòng (sau 5 s, rồi mỗi khi sang ngày mới). Idempotent. */
  start(): this {
    if (!this.opts.enabled || this.timer) return this;
    const iv = setInterval(() => this.tickFlush(), Math.max(250, this.opts.flushMs));
    iv.unref();
    this.timer = iv;
    const boot = setTimeout(() => { void this.rotate(); }, 5000);
    boot.unref();
    this.bootTimer = boot;
    return this;
  }

  /** Dừng hẹn giờ và ghi nốt hàng đợi (đồng bộ — dùng khi tắt server) */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
    this.flushSync();
  }

  // ---------------------------------------------------------------- ghi
  /**
   * Xếp một bản ghi vào hàng đợi (không chặn). kind: 'log' | 'recap' | 'hr' | 'beat' | 'kpi' | 'news' | tuỳ ý (≤ 32 ký tự).
   * Trả về false khi archive tắt hoặc bản ghi bị bỏ (không serialize được).
   */
  record(kind: string, data: unknown): boolean {
    if (!this.opts.enabled) return false;
    const k = typeof kind === 'string' && kind.trim() ? kind.trim().slice(0, 32) : 'misc';
    const ts = this.opts.now();
    let line: string;
    try {
      line = JSON.stringify({ ts, kind: k, data: data === undefined ? null : data });
      if (line.length > this.opts.maxLineBytes) {
        line = JSON.stringify({ ts, kind: k, data: { truncated: true, text: line.slice(0, 2000) } });
      }
    } catch (e) {
      this.st.dropped++;
      this.warnOnce(`[archive] Không serialize được bản ghi ${k}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    this.queue.push({ date: vnDate(ts), line: `${line}\n` });
    if (this.queue.length > this.opts.maxQueue) {
      const over = this.queue.length - this.opts.maxQueue;
      this.queue.splice(0, over);
      this.st.dropped += over;
      this.warnOnce(`[archive] Hàng đợi quá trần ${this.opts.maxQueue} dòng — bỏ ${over} dòng cũ nhất`);
    }
    this.st.queued = this.queue.length;
    return true;
  }

  private tickFlush(): void {
    void this.flush();
    const today = vnDate(this.opts.now());
    if (today !== this.lastRotateDate && this.lastRotateDate !== '') void this.rotate();
  }

  /** Ghi hàng đợi ra file (bất đồng bộ, không chạy chồng). Lỗi → cảnh báo 1 lần / 10 phút, bỏ lô. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return Promise.resolve();
    this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    this.st.queued = 0;
    const groups = new Map<string, string[]>();
    for (const q of batch) {
      const g = groups.get(q.date);
      if (g) g.push(q.line); else groups.set(q.date, [q.line]);
    }
    try {
      await this.ensureDir();
      for (const [date, lines] of groups) {
        await appendFile(this.pathOf(date), lines.join(''), 'utf8');
        this.st.written += lines.length;
        this.countCache.delete(date);
      }
      this.st.lastFlushAt = this.opts.now();
    } catch (e) {
      this.st.errors++;
      this.st.lastError = e instanceof Error ? e.message : String(e);
      // thư mục bị xoá / đổi khi đang chạy → lần ghi sau tạo lại; lô này xếp lại hàng đợi đúng 1 lần (không lặp vô hạn)
      this.dirReady = false;
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT' && !this.requeued) {
        this.requeued = true;
        this.queue = [...batch, ...this.queue].slice(-this.opts.maxQueue);
        this.st.queued = this.queue.length;
        this.warnOnce(`[archive] Thư mục ${this.st.dir} biến mất (${this.st.lastError}) — tạo lại ở lần ghi sau, giữ ${batch.length} dòng`);
        return;
      }
      this.st.dropped += batch.length;
      this.warnOnce(`[archive] Không ghi được ${this.st.dir}: ${this.st.lastError} — bỏ ${batch.length} dòng`);
      return;
    }
    this.requeued = false;
  }

  /** Ghi đồng bộ (khi tắt server / cuối test). Lỗi → cảnh báo, bỏ. */
  flushSync(): void {
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.st.queued = 0;
    try {
      if (!existsSync(this.st.dir)) mkdirSync(this.st.dir, { recursive: true });
      this.dirReady = true;
      const groups = new Map<string, string[]>();
      for (const q of batch) {
        const g = groups.get(q.date);
        if (g) g.push(q.line); else groups.set(q.date, [q.line]);
      }
      for (const [date, lines] of groups) {
        appendFileSync(this.pathOf(date), lines.join(''), 'utf8');
        this.st.written += lines.length;
        this.countCache.delete(date);
      }
      this.st.lastFlushAt = this.opts.now();
    } catch (e) {
      this.st.errors++;
      this.st.dropped += batch.length;
      this.st.lastError = e instanceof Error ? e.message : String(e);
      this.dirReady = false;
      this.warnOnce(`[archive] Không ghi được ${this.st.dir}: ${this.st.lastError} — bỏ ${batch.length} dòng`);
    }
  }

  // ---------------------------------------------------------------- xoay vòng
  /** gzip file cũ hơn gzipAfterDays (không đụng file hôm nay), xoá file cũ hơn keepDays. Không bao giờ throw. */
  rotate(): Promise<{ gzipped: number; deleted: number }> {
    if (this.rotating) return this.rotating;
    this.rotating = this.doRotate().finally(() => { this.rotating = null; });
    return this.rotating;
  }

  private async doRotate(): Promise<{ gzipped: number; deleted: number }> {
    const out = { gzipped: 0, deleted: 0 };
    if (!this.opts.enabled) return out;
    const today = vnDate(this.opts.now());
    this.lastRotateDate = today;
    this.st.lastRotateAt = this.opts.now();
    let names: string[];
    try {
      await this.ensureDir();
      names = await readdir(this.st.dir);
    } catch (e) {
      this.dirReady = false;
      this.warnOnce(`[archive] Không đọc được thư mục ${this.st.dir}: ${e instanceof Error ? e.message : String(e)}`);
      return out;
    }
    const todayDays = dateToDays(today);
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      const date = m[1];
      const gz = !!m[2];
      const age = todayDays - dateToDays(date);
      if (!Number.isFinite(age) || date === today) continue;
      const file = join(this.st.dir, name);
      try {
        if (age > this.opts.keepDays) {
          await unlink(file);
          this.countCache.delete(date);
          out.deleted++;
        } else if (!gz && age >= this.opts.gzipAfterDays) {
          await this.gzipFile(file, join(this.st.dir, `${date}.jsonl.gz`));
          this.countCache.delete(date);
          out.gzipped++;
        }
      } catch (e) {
        this.st.errors++;
        this.st.lastError = e instanceof Error ? e.message : String(e);
        this.warnOnce(`[archive] Xoay vòng ${name} lỗi: ${this.st.lastError}`);
      }
    }
    this.st.gzipped += out.gzipped;
    this.st.deleted += out.deleted;
    if (out.gzipped || out.deleted) this.opts.info(`🗄️  Lưu trữ: nén ${out.gzipped} file, xoá ${out.deleted} file cũ (${this.st.dir})`);
    return out;
  }

  /** Nén src → dest (nếu dest đã có thì nối thêm một thành viên gzip — gunzip đọc được nhiều thành viên), rồi xoá src */
  private async gzipFile(src: string, dest: string): Promise<void> {
    const tmp = `${dest}.tmp-${process.pid}`;
    await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(tmp));
    if (existsSync(dest)) {
      await pipeline(createReadStream(tmp), createWriteStream(dest, { flags: 'a' }));
      await unlink(tmp);
    } else {
      await rename(tmp, dest);
    }
    await unlink(src);
  }

  // ---------------------------------------------------------------- đọc
  /** Các ngày có dữ liệu (tăng dần), kèm số dòng (đếm 1 lần, nhớ theo mtime; ngày đã nén ghi vào index.json) và cỡ file */
  async listDays(): Promise<ArchiveDay[]> {
    let names: string[];
    try { names = await readdir(this.st.dir); } catch { return []; }
    await this.loadIndex();
    const byDate = new Map<string, { gz: boolean; name: string }>();
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      const prev = byDate.get(m[1]);
      if (!prev || !m[2]) byDate.set(m[1], { gz: !!m[2], name }); // có cả .jsonl và .gz → ưu tiên .jsonl (ngày đang ghi)
    }
    const out: ArchiveDay[] = [];
    for (const [date, f] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const file = join(this.st.dir, f.name);
      try {
        const s = await stat(file);
        const cached = this.countCache.get(date);
        let count: number;
        if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) count = cached.count;
        else {
          count = await this.countLines(file, f.gz);
          this.countCache.set(date, { mtimeMs: s.mtimeMs, size: s.size, count });
          if (f.gz) this.indexDirty = true; // ngày đã nén không đổi nữa → đáng ghi xuống đĩa
        }
        out.push({ date, count, bytes: s.size, gz: f.gz });
      } catch { /* file vừa bị xoay vòng: bỏ qua */ }
    }
    await this.saveIndex(out);
    return out;
  }

  /** index.json: { "YYYY-MM-DD": { mtimeMs, size, count } } cho các ngày .gz — đọc một lần sau khi khởi động */
  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    try {
      const raw = JSON.parse(await readFile(this.indexPath(), 'utf8')) as Record<string, { mtimeMs?: unknown; size?: unknown; count?: unknown }>;
      if (!raw || typeof raw !== 'object') return;
      for (const [date, v] of Object.entries(raw)) {
        if (!isDateString(date) || !v || typeof v !== 'object') continue;
        const { mtimeMs, size, count } = v;
        if (typeof mtimeMs === 'number' && typeof size === 'number' && typeof count === 'number' && Number.isFinite(count) && count >= 0) {
          if (!this.countCache.has(date)) this.countCache.set(date, { mtimeMs, size, count });
        }
      }
    } catch { /* chưa có index hoặc hỏng → đếm lại rồi ghi mới */ }
  }

  private async saveIndex(days: ArchiveDay[]): Promise<void> {
    if (!this.indexDirty) return;
    this.indexDirty = false;
    const data: Record<string, { mtimeMs: number; size: number; count: number }> = {};
    for (const d of days) {
      const c = d.gz ? this.countCache.get(d.date) : undefined;
      if (c) data[d.date] = c;
    }
    try {
      const tmp = `${this.indexPath()}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(data), 'utf8');
      await rename(tmp, this.indexPath());
    } catch (e) {
      this.warnOnce(`[archive] Không ghi được index.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private indexPath(): string { return join(this.st.dir, 'index.json'); }

  /** Đọc các bản ghi của một ngày (.jsonl hoặc .jsonl.gz); dòng hỏng bị bỏ; tối đa limit (≤ 5000) */
  async readDay(date: string, opts: { offset?: number; limit?: number } = {}): Promise<ArchiveEntry[]> {
    if (!isDateString(date)) return [];
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const limit = Math.max(1, Math.min(HISTORY_READ_MAX, Math.floor(opts.limit ?? HISTORY_READ_MAX)));
    const plain = this.pathOf(date);
    const gz = `${plain}.gz`;
    const out: ArchiveEntry[] = [];
    // ngày có cả 2 file (ghi thêm sau khi đã nén): đọc .gz trước rồi .jsonl
    let skipped = 0;
    for (const [file, isGz] of [[gz, true], [plain, false]] as const) {
      if (!existsSync(file)) continue;
      // giữ tham chiếu tới stream file: destroy() cái Gunzip không đóng file descriptor bên dưới (rò fd mỗi lần đọc dở)
      const src = createReadStream(file);
      const input = isGz ? src.pipe(createGunzip()) : src;
      const rl = createInterface({ input, crlfDelay: Infinity });
      const stop = (): void => {
        rl.close();
        if (input !== src) input.destroy();
        src.destroy();
      };
      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          if (skipped < offset) { skipped++; continue; }
          try {
            const v = JSON.parse(line) as Partial<ArchiveEntry>;
            if (v && typeof v === 'object' && typeof v.ts === 'number' && typeof v.kind === 'string') {
              out.push({ ts: v.ts, kind: v.kind, data: v.data ?? null });
            }
          } catch { /* dòng hỏng */ }
          if (out.length >= limit) { stop(); break; }
        }
      } catch (e) {
        this.warnOnce(`[archive] Đọc ${file} lỗi: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!src.destroyed) src.destroy();
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Ngày này có file (.jsonl hoặc .jsonl.gz) không */
  hasDay(date: string): boolean {
    if (!isDateString(date)) return false;
    const plain = this.pathOf(date);
    return existsSync(plain) || existsSync(`${plain}.gz`);
  }

  /** Ngày chỉ còn bản .gz (đã xoay vòng, không ghi thêm) → nội dung bất biến, HTTP có thể cache */
  isFrozenDay(date: string): boolean {
    if (!isDateString(date)) return false;
    const plain = this.pathOf(date);
    return !existsSync(plain) && existsSync(`${plain}.gz`);
  }

  stats(): ArchiveStats { return { ...this.st, queued: this.queue.length }; }

  // ---------------------------------------------------------------- nội bộ
  private pathOf(date: string): string { return join(this.st.dir, `${date}.jsonl`); }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.st.dir, { recursive: true });
    this.dirReady = true;
  }

  private countLines(file: string, gz: boolean): Promise<number> {
    return new Promise((resolve) => {
      let n = 0;
      let last = 10;
      const src = createReadStream(file);
      const s = gz ? src.pipe(createGunzip()) : src;
      s.on('data', (chunk: Buffer | string) => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        for (let i = 0; i < b.length; i++) if (b[i] === 10) n++;
        if (b.length) last = b[b.length - 1];
      });
      s.on('end', () => resolve(last === 10 ? n : n + 1));
      s.on('error', () => resolve(n));
      src.on('error', () => resolve(n));
    });
  }

  private warnOnce(msg: string): void {
    const now = this.opts.now();
    if (now - this.lastWarnAt < 10 * 60_000) return;
    this.lastWarnAt = now;
    this.opts.warn(msg);
  }
}

// ---------------------------------------------------------------- singleton
let singleton: Archive | null = null;

/** Archive dùng chung. Mặc định TẮT (không ghi gì) cho tới khi server / smoke gọi configure({ enabled: true, dir… }).start(). */
export function getArchive(): Archive {
  if (!singleton) singleton = new Archive();
  return singleton;
}
