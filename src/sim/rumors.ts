// =====================================================================
//  Tin đồn "tam sao thất bản": mỗi lần kể lại là một phiên bản mới.
//  Thuần dữ liệu — Director quyết định khi nào kể / khi nào lộ / đối chất.
// =====================================================================
import type { AgentState, Rumor, RumorVersion } from '../types.js';

export const MAX_RUMORS = 12;
const MAX_VERSIONS = 10;
const MAX_TEXT = 300;

export interface RumorPick { rumor: Rumor; tellerId: string; listenerId: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class RumorBook {
  private list: Rumor[] = [];
  /** tin đồn đã tới tai người bị đồn (chờ đối chất) */
  private leaked = new Set<string>();
  private seq = 0;

  all(): Rumor[] {
    return this.list;
  }

  get(id: string): Rumor | undefined {
    return this.list.find((r) => r.id === id);
  }

  newId(day: number): string {
    this.seq++;
    return `r${day}_${this.seq}`;
  }

  latest(r: Rumor): RumorVersion | undefined {
    return r.versions[r.versions.length - 1];
  }

  latestText(r: Rumor): string {
    return this.latest(r)?.text ?? '';
  }

  originalText(r: Rumor): string {
    return r.versions[0]?.text ?? '';
  }

  activeAbout(aboutId: string): Rumor | undefined {
    return this.list.find((r) => r.active && r.aboutId === aboutId);
  }

  /**
   * Chọn tin đồn đang lan để kể tiếp: teller đã nghe (và rảnh), listener chưa nghe,
   * không ai là người bị đồn. Ưu tiên cặp thân nhau.
   */
  pickContinuation(pool: AgentState[], mutual: (a: AgentState, b: AgentState) => number, minMutual = 10): RumorPick | null {
    const options: { p: RumorPick; wt: number }[] = [];
    for (const r of this.list) {
      if (!r.active) continue;
      const tellers = pool.filter((a) => a.id !== r.aboutId && r.heardBy.includes(a.id));
      if (!tellers.length) continue;
      const listeners = pool.filter((a) => a.id !== r.aboutId && !r.heardBy.includes(a.id));
      for (const t of tellers) {
        for (const l of listeners) {
          if (t.id === l.id) continue;
          const m = mutual(t, l);
          if (m < minMutual) continue;
          const fresh = r.versions.length < 4 ? 0.6 : 0;
          options.push({ p: { rumor: r, tellerId: t.id, listenerId: l.id }, wt: 1 + Math.max(0, m) / 25 + fresh });
        }
      }
    }
    if (!options.length) return null;
    const total = options.reduce((s, o) => s + o.wt, 0);
    let x = Math.random() * total;
    for (const o of options) {
      x -= o.wt;
      if (x <= 0) return o.p;
    }
    return options[options.length - 1].p;
  }

  /** Ghi nhận một lần kể: tạo tin đồn mới hoặc thêm phiên bản. Trả về rumor (hoặc null nếu dữ liệu hỏng). */
  record(o: {
    id: string; isNew: boolean; aboutId: string; aboutName: string;
    tellerId: string; listenerIds: string[]; text: string; day: number; minute: number;
  }): Rumor | null {
    const text = (o.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text || !o.aboutId) return null;
    const listeners = o.listenerIds.filter((id) => id && id !== o.tellerId && id !== o.aboutId);
    let r = o.isNew ? undefined : this.get(o.id);
    if (!r) {
      r = {
        id: this.get(o.id) ? this.newId(o.day) : o.id,
        aboutId: o.aboutId,
        aboutName: o.aboutName,
        versions: [],
        heardBy: [],
        createdDay: o.day,
        active: true,
      };
      this.list.push(r);
    }
    const minute = Math.floor(numOr(o.minute, 0));
    // 1 lần kể = 1 phiên bản (người nghe chính = người đầu tiên; ai ngồi cùng cũng tính là đã nghe)
    r.versions.push({ day: o.day, minute, tellerId: o.tellerId, listenerId: listeners[0] ?? '', text });
    if (r.versions.length > MAX_VERSIONS) {
      // giữ bản gốc + các bản mới nhất
      r.versions = [r.versions[0], ...r.versions.slice(-(MAX_VERSIONS - 1))];
    }
    for (const id of [o.tellerId, ...listeners]) {
      if (id && id !== o.aboutId && !r.heardBy.includes(id)) r.heardBy.push(id);
    }
    r.active = true;
    this.prune();
    return r;
  }

  /** "nghe phong thanh": tin đồn lan ≥ minReach người, mỗi lần kiểm tra có xác suất p lộ tới tai người bị đồn */
  leakCheck(p: number, minReach = 3): Rumor[] {
    const out: Rumor[] = [];
    for (const r of this.list) {
      if (!r.active || this.leaked.has(r.id) || r.heardBy.length < minReach) continue;
      if (Math.random() < p) {
        this.leaked.add(r.id);
        out.push(r);
      }
    }
    return out;
  }

  markLeaked(id: string): void {
    if (this.get(id)) this.leaked.add(id);
  }

  isLeaked(id: string): boolean {
    return this.leaked.has(id);
  }

  /** tin đồn đã lộ, đang chờ đối chất */
  confrontable(): Rumor[] {
    return this.list.filter((r) => r.active && this.leaked.has(r.id));
  }

  deactivate(id: string): void {
    const r = this.get(id);
    if (r) r.active = false;
    this.leaked.delete(id);
  }

  /** người bị đồn đã rời công ty → tin đồn nguội; bỏ người nghe không còn tồn tại khỏi danh sách đi kể tiếp */
  sweep(exists: (id: string) => boolean): boolean {
    let changed = false;
    for (const r of this.list) {
      if (r.active && !exists(r.aboutId)) {
        r.active = false;
        this.leaked.delete(r.id);
        changed = true;
      }
    }
    return changed;
  }

  prune(): void {
    while (this.list.length > MAX_RUMORS) {
      const idx = this.list.findIndex((r) => !r.active);
      const removed = this.list.splice(idx >= 0 ? idx : 0, 1)[0];
      if (removed) this.leaked.delete(removed.id);
    }
  }

  serialize(): unknown {
    return { seq: this.seq, list: this.list, leaked: [...this.leaked] };
  }

  restore(data: unknown): void {
    if (!isObj(data)) return;
    this.seq = Math.max(0, Math.floor(numOr(data.seq, 0)));
    const list: Rumor[] = [];
    if (Array.isArray(data.list)) {
      for (const raw of data.list.slice(-MAX_RUMORS)) {
        if (!isObj(raw)) continue;
        const id = str(raw.id, 40), aboutId = str(raw.aboutId, 80);
        if (!id || !aboutId || list.some((r) => r.id === id)) continue;
        const versions: RumorVersion[] = [];
        if (Array.isArray(raw.versions)) {
          for (const v of raw.versions.slice(-MAX_VERSIONS)) {
            if (!isObj(v)) continue;
            const text = str(v.text, MAX_TEXT);
            if (!text) continue;
            versions.push({
              day: Math.floor(numOr(v.day, 1)), minute: Math.floor(numOr(v.minute, 0)),
              tellerId: str(v.tellerId, 80) ?? '', listenerId: str(v.listenerId, 80) ?? '', text,
            });
          }
        }
        if (!versions.length) continue;
        const heardBy = Array.isArray(raw.heardBy)
          ? [...new Set(raw.heardBy.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 40))]
          : [];
        list.push({
          id, aboutId, aboutName: str(raw.aboutName, 80) ?? aboutId, versions, heardBy,
          createdDay: Math.floor(numOr(raw.createdDay, 1)), active: raw.active !== false,
        });
      }
    }
    this.list = list;
    this.leaked = new Set(
      Array.isArray(data.leaked) ? data.leaked.filter((x): x is string => typeof x === 'string' && list.some((r) => r.id === x)) : [],
    );
  }
}
