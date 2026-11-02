// Sản phẩm trên kệ phòng trưng bày (v2, docs/v2-contract.md §2) → `hello.products`.
// Ưu tiên `getShowroomProducts()` của src/content/products.ts nếu content đã có; chưa có (hoặc trả về rỗng) thì tự dựng
// từ `getProducts()` bằng bộ ánh xạ phòng thủ: thiếu trường nào cũng không sao (category suy từ tag, slot tự điền,
// note lấy pitch). Không bao giờ throw. `url` LUÔN là `/go/<id>?src=showroom` (server đếm click theo nguồn).
import type { ProductCategory, ProductShelf, ShowroomProduct } from '../types.js';
import * as products from '../content/products.js';

const SRC = 'showroom';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_ITEMS = 40;
const SHELF_OF: Record<ProductCategory, ProductShelf> = { 'lam-dep': 'beauty', 'cong-nghe': 'tech' };
/** tag → kệ, dùng khi data/products.json chưa có `category` */
const BEAUTY_TAGS: ReadonlySet<string> = new Set(['lam-dep', 'my-pham', 'skincare', 'son']);
const TECH_TAGS: ReadonlySet<string> = new Set(['cong-nghe', 'gadget']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function tagsOf(r: Record<string, unknown>): string[] {
  if (!Array.isArray(r.tags)) return [];
  const out: string[] = [];
  for (const t of r.tags) {
    const s = str(t, 40).toLowerCase();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function categoryOf(r: Record<string, unknown>, tags: string[]): ProductCategory | null {
  if (r.category === 'lam-dep' || r.category === 'cong-nghe') return r.category;
  if (r.shelf === 'beauty') return 'lam-dep';
  if (r.shelf === 'tech') return 'cong-nghe';
  if (tags.some((t) => BEAUTY_TAGS.has(t))) return 'lam-dep';
  if (tags.some((t) => TECH_TAGS.has(t))) return 'cong-nghe';
  return null;
}

/** Chuẩn hoá 1 mục (từ Product hoặc từ getShowroomProducts()); null = không lên kệ */
function toShowroom(raw: unknown): ShowroomProduct | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  if (!ID_RE.test(id)) return null;
  const name = str(raw.name, 120);
  if (!name) return null;
  const tags = tagsOf(raw);
  const category = categoryOf(raw, tags);
  if (!category) return null;
  const slot = typeof raw.slot === 'number' && Number.isInteger(raw.slot) && raw.slot >= 0 && raw.slot < 1000 ? raw.slot : -1;
  const out: ShowroomProduct = {
    id,
    name,
    emoji: str(raw.emoji, 16) || '🛒',
    priceHint: str(raw.priceHint, 30),
    url: `/go/${encodeURIComponent(id)}?src=${SRC}`,
    category,
    shelf: SHELF_OF[category],
    slot,
    note: str(raw.note, 200) || str(raw.pitch, 200),
    tags,
  };
  const image = str(raw.image, 500);
  if (image && /^(https?:\/\/|\/)/i.test(image)) out.image = image;
  return out;
}

/** slot thiếu (-1) → số trống nhỏ nhất trên kệ đó; rồi sắp theo kệ (làm đẹp trước) → slot → tên */
function assignSlots(list: ShowroomProduct[]): ShowroomProduct[] {
  for (const shelf of ['beauty', 'tech'] as const) {
    const items = list.filter((p) => p.shelf === shelf);
    const used = new Set(items.filter((p) => p.slot >= 0).map((p) => p.slot));
    let next = 0;
    for (const p of items) {
      if (p.slot >= 0) continue;
      while (used.has(next)) next++;
      p.slot = next;
      used.add(next);
    }
  }
  return list.sort((a, b) => {
    if (a.shelf !== b.shelf) return a.shelf === 'beauty' ? -1 : 1;
    return a.slot - b.slot || a.name.localeCompare(b.name, 'vi');
  });
}

/** Danh sách sản phẩm cho hello.products (bản mới mỗi lần gọi; World cache lại) */
export function buildShowroomProducts(): ShowroomProduct[] {
  let raw: unknown[] = [];
  // 1) content engineer có thể export getShowroomProducts(); truy cập qua namespace để biên dịch được dù chưa có
  const custom = (products as unknown as Record<string, unknown>).getShowroomProducts;
  if (typeof custom === 'function') {
    try {
      const v = (custom as () => unknown)();
      if (Array.isArray(v)) raw = v;
    } catch (e) {
      console.warn('[showroom] getShowroomProducts() lỗi — tự dựng từ getProducts():', e instanceof Error ? e.message : e);
    }
  }
  // 2) dự phòng: toàn bộ danh mục, lọc theo category / tag
  if (!raw.length) {
    try {
      raw = products.getProducts();
    } catch (e) {
      console.warn('[showroom] getProducts() lỗi — phòng trưng bày trống:', e instanceof Error ? e.message : e);
      raw = [];
    }
  }
  const seen = new Set<string>();
  const list: ShowroomProduct[] = [];
  for (const r of raw) {
    const p = toShowroom(r);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    list.push(p);
    if (list.length >= MAX_ITEMS) break;
  }
  return assignSlots(list);
}
