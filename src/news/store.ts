// =====================================================================
//  Kho tin thời sự trong bộ nhớ (docs/v3-news.md): ≤ 40 tin / nhóm, làm mới mỗi NEWS_REFRESH_MINUTES
//  (lần đầu ~20 s sau khi bật server, không bao giờ chặn khởi động), lỗi mạng → giữ tin cũ, cảnh báo có giới hạn.
//  API cho Director: pick() / markUsed() / recent(); serialize() / restore() do World gọi (lưu chung data/state.json).
//  Test / smoke: inject(items) — không cần mạng.
// =====================================================================
import type { NewsCategory, NewsItem, NewsRef } from '../types.js';
import { CONFIG, type NewsFeedConfig } from '../config.js';
import { fetchText, parseRss, sourceLabel } from './feeds.js';
import { filterNews, type Dropped } from './filter.js';

export const ALL_CATEGORIES: readonly NewsCategory[] = ['the_thao', 'bong_da', 'cong_nghe', 'game', 'khoa_hoc', 'giai_tri'];
const CATEGORY_SET: ReadonlySet<string> = new Set(ALL_CATEGORIES);
export const isNewsCategory = (v: unknown): v is NewsCategory => typeof v === 'string' && CATEGORY_SET.has(v);

const USED_KEEP = 500;
const RECENT_KEEP = 20;
const PERSIST_PER_CATEGORY = 12;
const FEED_WARN_EVERY_MS = 60 * 60_000;
const TOP_N = 5;

export interface NewsStoreOptions {
  enabled: boolean;
  feeds: NewsFeedConfig[];
  refreshMinutes: number;
  maxAgeDays: number;
  allowShowbiz: boolean;
  blocklist: string[];
  perCategory: number;                       // ≤ 40 tin / nhóm
  firstFetchMs: number;                      // lần tải đầu sau khi start()
  fetcher: (url: string) => Promise<string>; // test: giả lập mạng
  now: () => number;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface RefreshReport {
  ok: number;            // số feed tải được
  failed: number;
  added: number;         // tin mới thêm vào kho
  dropped: number;       // tin bị lọc bỏ
  total: number;         // tổng tin trong kho sau khi làm mới
  errors: string[];      // "nguồn: lý do"
}

export interface NewsStatus {
  enabled: boolean;
  feeds: number;
  refreshMinutes: number;
  lastRefreshAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  refreshes: number;
  counts: Record<NewsCategory, number>;
  total: number;
  used: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Chuẩn hoá một NewsItem lạ (từ file / inject) — null nếu hỏng */
export function sanitizeNewsItem(raw: unknown): NewsItem | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 40) : '';
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const url = typeof raw.url === 'string' ? raw.url.trim().slice(0, 600) : '';
  if (!id || title.length < 8 || !/^https?:\/\//i.test(url) || !isNewsCategory(raw.category)) return null;
  return {
    id, title, url,
    summary: typeof raw.summary === 'string' ? raw.summary.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    source: (typeof raw.source === 'string' && raw.source.trim()) ? raw.source.trim().slice(0, 40) : sourceLabel(url),
    category: raw.category,
    publishedAt: fin(raw.publishedAt) ? raw.publishedAt : 0,
  };
}

export const toNewsRef = (it: NewsItem): NewsRef => ({ id: it.id, title: it.title, source: it.source, url: it.url, category: it.category });

function sanitizeRef(raw: unknown): NewsRef | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.url !== 'string' || !isNewsCategory(raw.category)) return null;
  return {
    id: raw.id.slice(0, 40), title: raw.title.slice(0, 200), url: raw.url.slice(0, 600), category: raw.category,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 40) : sourceLabel(raw.url),
  };
}

/** the_thao bao gồm cả bong_da; không truyền = mọi nhóm */
export function expandCategories(categories?: readonly NewsCategory[] | null): NewsCategory[] {
  const list = Array.isArray(categories) ? categories.filter(isNewsCategory) : [];
  if (!list.length) return [...ALL_CATEGORIES];
  const out = new Set<NewsCategory>(list);
  if (out.has('the_thao')) out.add('bong_da');
  return [...out];
}

export class NewsStore {
  private opts: NewsStoreOptions;
  private byCat = new Map<NewsCategory, NewsItem[]>();   // mỗi nhóm: mới nhất trước
  private usedIds: string[] = [];
  private usedSet = new Set<string>();
  private recentRefs: NewsRef[] = [];
  private timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<RefreshReport> | null = null;
  private feedWarnedAt = new Map<string, number>();
  private lastRefreshAt: number | null = null;
  private lastOkAt: number | null = null;
  private lastError: string | null = null;
  private refreshes = 0;
  private started = false;

  constructor(opts: Partial<NewsStoreOptions> = {}) {
    this.opts = { ...NewsStore.defaults(), ...opts };
    for (const c of ALL_CATEGORIES) this.byCat.set(c, []);
  }

  static defaults(): NewsStoreOptions {
    return {
      enabled: true, feeds: [], refreshMinutes: 45, maxAgeDays: 3, allowShowbiz: true, blocklist: [], perCategory: 40,
      firstFetchMs: 20_000, fetcher: (url) => fetchText(url), now: () => Date.now(),
      log: (m) => console.log(m), warn: (m) => console.warn(m),
    };
  }

  /** Đổi cấu hình (test / server). Không xoá tin đang có. */
  configure(opts: Partial<NewsStoreOptions>): this {
    this.opts = { ...this.opts, ...opts };
    if (this.started) { this.stop(); this.start(); }
    return this;
  }

  options(): Readonly<NewsStoreOptions> { return this.opts; }

  // ---------------------------------------------------------------- lịch tải
  /** Bắt đầu tải định kỳ: lần đầu sau firstFetchMs, rồi mỗi refreshMinutes. Không chặn khởi động. */
  start(): void {
    if (this.started || !this.opts.enabled || !this.opts.feeds.length) return;
    this.started = true;
    const every = Math.max(60_000, this.opts.refreshMinutes * 60_000);
    const first = setTimeout(() => {
      void this.refresh();
      const iv = setInterval(() => { void this.refresh(); }, every);
      iv.unref();
      this.timer = iv;
    }, Math.max(0, this.opts.firstFetchMs));
    first.unref();
    this.timer = first;
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer as ReturnType<typeof setTimeout>); clearInterval(this.timer as ReturnType<typeof setInterval>); }
    this.timer = null;
    this.started = false;
  }

  /** Tải mọi feed (song song), lọc, trộn vào kho. Không bao giờ throw; lỗi từng feed được ghi có giới hạn. */
  refresh(): Promise<RefreshReport> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<RefreshReport> {
    const rep: RefreshReport = { ok: 0, failed: 0, added: 0, dropped: 0, total: 0, errors: [] };
    const now = this.opts.now();
    this.lastRefreshAt = now;
    this.refreshes++;
    const results = await Promise.allSettled(this.opts.feeds.map(async (f) => {
      const xml = await this.opts.fetcher(f.url);
      // mỗi feed đọc ở một lượt event loop riêng: một feed to / hỏng không chặn tick của mô phỏng cùng lúc với các feed khác
      await new Promise<void>((resolve) => setImmediate(resolve));
      return { feed: f, items: parseRss(xml, f.group, { now: this.opts.now(), feedUrl: f.url }) };
    }));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const feed = this.opts.feeds[i];
      if (r.status === 'fulfilled') {
        rep.ok++;
        const { added, dropped } = this.ingest(r.value.items);
        rep.added += added;
        rep.dropped += dropped.length;
        this.feedWarnedAt.delete(feed.url);
      } else {
        rep.failed++;
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        const label = `${sourceLabel(feed.url)} · ${feed.group}`;
        rep.errors.push(`${label}: ${msg}`);
        const last = this.feedWarnedAt.get(feed.url) ?? -Infinity;
        if (now - last >= FEED_WARN_EVERY_MS) {
          this.feedWarnedAt.set(feed.url, now);
          this.opts.warn(`[news] Không tải được ${label} (${feed.url}): ${msg} — giữ tin cũ`);
        }
      }
    }
    this.prune();
    rep.total = this.size();
    if (rep.ok > 0) this.lastOkAt = now;
    this.lastError = rep.errors.length ? rep.errors[rep.errors.length - 1] : null;
    if (rep.added > 0 || this.refreshes === 1) {
      const parts = ALL_CATEGORIES.map((c) => `${c} ${this.byCat.get(c)!.length}`).join(' · ');
      this.opts.log(`📰 Thời sự: ${rep.total} tin (${parts}) — thêm ${rep.added}, bỏ ${rep.dropped} tin không phù hợp`
        + (rep.failed ? `, ${rep.failed}/${this.opts.feeds.length} nguồn lỗi` : ''));
    }
    return rep;
  }

  // ---------------------------------------------------------------- nạp tin
  /** Lọc an toàn + trộn vào kho (dedupe theo id, mới nhất trước, ≤ perCategory). Dùng cho test: không cần mạng. */
  inject(items: readonly NewsItem[]): { added: number; dropped: Dropped[] } {
    return this.ingest(items);
  }

  private ingest(items: readonly NewsItem[]): { added: number; dropped: Dropped[] } {
    const clean: NewsItem[] = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const it = sanitizeNewsItem(raw);
      if (it) clean.push(it);
    }
    const { kept, dropped } = filterNews(clean, {
      now: this.opts.now(), maxAgeDays: this.opts.maxAgeDays, allowShowbiz: this.opts.allowShowbiz, blocklist: this.opts.blocklist,
    });
    const before = new Set<string>();
    for (const list of this.byCat.values()) for (const x of list) before.add(x.id);
    const touched = new Set<NewsCategory>();
    const max = this.maxPerCategory();
    for (const it of kept) {
      const list = this.byCat.get(it.category)!;
      if (list.some((x) => x.id === it.id)) continue;
      // kho đầy: chỉ nhận tin mới hơn tin cũ nhất đang giữ (không nạp rồi cắt đi cắt lại mỗi lần làm mới)
      if (list.length >= max && it.publishedAt <= list[list.length - 1].publishedAt) continue;
      list.push(it);
      touched.add(it.category);
    }
    for (const c of touched) this.trim(c);
    let added = 0;
    for (const list of this.byCat.values()) for (const x of list) if (!before.has(x.id)) added++;
    return { added, dropped };
  }

  private maxPerCategory(): number {
    return Math.max(1, Math.min(40, Math.floor(this.opts.perCategory)));
  }

  private trim(c: NewsCategory): void {
    const list = this.byCat.get(c)!;
    list.sort((a, b) => b.publishedAt - a.publishedAt);
    const max = this.maxPerCategory();
    if (list.length > max) list.length = max;
  }

  /** Bỏ tin đã quá hạn (tin già đi theo thời gian) */
  private prune(): void {
    const now = this.opts.now();
    const maxMs = Math.max(0, this.opts.maxAgeDays) * 86_400_000;
    for (const list of this.byCat.values()) {
      for (let i = list.length - 1; i >= 0; i--) if (now - list[i].publishedAt > maxMs) list.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- API cho Director
  /**
   * Chọn 1 tin chưa dùng: ngẫu nhiên một nhóm (trong `categories`, mặc định mọi nhóm; the_thao gồm cả bong_da)
   * còn tin, rồi ngẫu nhiên trong 5 tin mới nhất của nhóm đó. `exclude` = id tạm thời không muốn (vd đã bàn hôm nay).
   * Trả về bản sao; null nếu không còn tin phù hợp.
   */
  pick(categories?: readonly NewsCategory[] | null, exclude?: ReadonlySet<string> | null): NewsItem | null {
    this.prune();
    const pools: NewsItem[][] = [];
    for (const c of expandCategories(categories)) {
      const list = (this.byCat.get(c) ?? []).filter((it) => !this.usedSet.has(it.id) && !exclude?.has(it.id));
      if (list.length) pools.push(list);
    }
    if (!pools.length) return null;
    const pool = pools[Math.floor(Math.random() * pools.length)];
    const top = pool.slice(0, TOP_N);
    return { ...top[Math.floor(Math.random() * top.length)] };
  }

  /** Tin đã được bàn: không chọn lại; ghi vào danh sách "tin gần đây" (hello.news) */
  markUsed(id: string): void {
    if (typeof id !== 'string' || !id) return;
    if (!this.usedSet.has(id)) {
      this.usedSet.add(id);
      this.usedIds.push(id);
      while (this.usedIds.length > USED_KEEP) {
        const old = this.usedIds.shift();
        if (old !== undefined) this.usedSet.delete(old);
      }
    }
    const it = this.find(id);
    if (it) {
      this.recentRefs = this.recentRefs.filter((r) => r.id !== id);
      this.recentRefs.push(toNewsRef(it));
      if (this.recentRefs.length > RECENT_KEEP) this.recentRefs.splice(0, this.recentRefs.length - RECENT_KEEP);
    }
  }

  isUsed(id: string): boolean { return this.usedSet.has(id); }

  /** n tin đã bàn gần đây nhất, cũ → mới (mới nhất cuối) */
  recent(n = 5): NewsRef[] {
    const k = Math.max(0, Math.min(RECENT_KEEP, Math.floor(n)));
    return this.recentRefs.slice(-k).map((r) => ({ ...r }));
  }

  find(id: string): NewsItem | undefined {
    for (const list of this.byCat.values()) {
      const it = list.find((x) => x.id === id);
      if (it) return it;
    }
    return undefined;
  }

  /** Tin trong kho (mới nhất trước), tuỳ chọn theo nhóm (the_thao gồm cả bong_da) */
  items(category?: NewsCategory): NewsItem[] {
    const cats = category ? expandCategories([category]) : [...ALL_CATEGORIES];
    const out: NewsItem[] = [];
    for (const c of cats) out.push(...(this.byCat.get(c) ?? []));
    return out.sort((a, b) => b.publishedAt - a.publishedAt).map((it) => ({ ...it }));
  }

  size(): number {
    let n = 0;
    for (const list of this.byCat.values()) n += list.length;
    return n;
  }

  counts(): Record<NewsCategory, number> {
    const out = {} as Record<NewsCategory, number>;
    for (const c of ALL_CATEGORIES) out[c] = this.byCat.get(c)?.length ?? 0;
    return out;
  }

  status(): NewsStatus {
    return {
      enabled: this.opts.enabled, feeds: this.opts.feeds.length, refreshMinutes: this.opts.refreshMinutes,
      lastRefreshAt: this.lastRefreshAt, lastOkAt: this.lastOkAt, lastError: this.lastError, refreshes: this.refreshes,
      counts: this.counts(), total: this.size(), used: this.usedIds.length,
    };
  }

  /** Xoá hết tin + lịch sử dùng (test) */
  clear(): void {
    for (const c of ALL_CATEGORIES) this.byCat.set(c, []);
    this.usedIds = [];
    this.usedSet.clear();
    this.recentRefs = [];
  }

  // ---------------------------------------------------------------- lưu / khôi phục (World gọi, nằm trong data/state.json)
  serialize(): unknown {
    const items: NewsItem[] = [];
    for (const list of this.byCat.values()) items.push(...list.slice(0, PERSIST_PER_CATEGORY));
    return { v: 1, used: this.usedIds.slice(-USED_KEEP), recent: this.recentRefs.slice(-RECENT_KEEP), items, lastRefreshAt: this.lastRefreshAt };
  }

  restore(data: unknown): void {
    if (!isObj(data)) return;
    if (Array.isArray(data.used)) {
      for (const id of data.used.slice(-USED_KEEP)) {
        if (typeof id === 'string' && id && !this.usedSet.has(id)) { this.usedSet.add(id); this.usedIds.push(id); }
      }
      while (this.usedIds.length > USED_KEEP) {
        const old = this.usedIds.shift();
        if (old !== undefined) this.usedSet.delete(old);
      }
    }
    if (Array.isArray(data.recent)) {
      const refs = data.recent.map(sanitizeRef).filter((r): r is NewsRef => r !== null);
      for (const r of refs) {
        this.recentRefs = this.recentRefs.filter((x) => x.id !== r.id);
        this.recentRefs.push(r);
      }
      if (this.recentRefs.length > RECENT_KEEP) this.recentRefs.splice(0, this.recentRefs.length - RECENT_KEEP);
    }
    if (Array.isArray(data.items)) this.ingest(data.items.slice(0, ALL_CATEGORIES.length * 40) as NewsItem[]);
    if (fin(data.lastRefreshAt)) this.lastRefreshAt = data.lastRefreshAt;
  }
}

// ---------------------------------------------------------------- singleton
let singleton: NewsStore | null = null;

/** Kho tin dùng chung, cấu hình từ CONFIG (NEWS_*). Chưa tải gì cho tới khi server gọi start(). */
export function getNews(): NewsStore {
  if (!singleton) {
    singleton = new NewsStore({
      enabled: CONFIG.newsEnabled, feeds: CONFIG.newsFeeds, refreshMinutes: CONFIG.newsRefreshMinutes,
      maxAgeDays: CONFIG.newsMaxAgeDays, allowShowbiz: CONFIG.newsAllowShowbiz, blocklist: CONFIG.newsBlocklist,
    });
  }
  return singleton;
}

/** Đổi cấu hình kho dùng chung (test / smoke: enabled false, fetcher giả…) */
export function configureNews(opts: Partial<NewsStoreOptions>): NewsStore {
  return getNews().configure(opts);
}
