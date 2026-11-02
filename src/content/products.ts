// =====================================================================
//  Danh mục sản phẩm tiếp thị liên kết (Shopee affiliate) + phòng trưng bày (v2).
//  Đọc data/products.json đồng bộ đúng 1 lần (lần gọi đầu), kiểm tra từng mục, cache lại.
//  Mục nào sai thì bỏ qua + console.warn; file hỏng/thiếu => danh sách rỗng (không bao giờ throw).
//  v2 (docs/v2-contract.md §2): mỗi món có category (lam-dep | cong-nghe) → shelf (beauty | tech),
//  slot trên kệ (0-based, không trùng trong kệ; 0..SHELF_SLOTS-1 vẽ trên canvas), note của chủ dự án, image tuỳ chọn.
// =====================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Product, ProductCategory, ProductPublic, ProductShelf, ShowroomProduct } from '../types.js';

/** data/products.json, tính từ vị trí file này (src/content/ -> ../../data/) */
const PRODUCTS_FILE = fileURLToPath(new URL('../../data/products.json', import.meta.url));

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_EMOJI = '🛒';
const MAX_SLOT = 999;

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['lam-dep', 'cong-nghe'];
export const PRODUCT_SHELVES: readonly ProductShelf[] = ['beauty', 'tech'];
/** kệ tương ứng với từng nhóm sản phẩm */
export const SHELF_OF_CATEGORY: Record<ProductCategory, ProductShelf> = { 'lam-dep': 'beauty', 'cong-nghe': 'tech' };
export const CATEGORY_OF_SHELF: Record<ProductShelf, ProductCategory> = { beauty: 'lam-dep', tech: 'cong-nghe' };
/** Số ô sản phẩm vẽ trên mỗi kệ ở phòng trưng bày; slot ≥ SHELF_SLOTS chỉ hiện ở tab 🛍️ (client quyết định cách vẽ) */
export const SHELF_SLOTS = 5;
/** tag gợi ý món thuộc kệ làm đẹp khi thiếu category */
const BEAUTY_TAGS = new Set(['lam-dep', 'my-pham', 'thoi-trang', 'massage', 'skincare', 'son', 'toc', 'spa']);

const isCategory = (v: string): v is ProductCategory => (PRODUCT_CATEGORIES as readonly string[]).includes(v);
const isShelf = (v: string): v is ProductShelf => (PRODUCT_SHELVES as readonly string[]).includes(v);

let cache: Product[] | null = null;
let byId = new Map<string, Product>();

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function validUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

/** slot: số nguyên ≥ 0 (chấp nhận chuỗi số); -1 = chưa có / sai → xếp sau */
function parseSlot(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_SLOT ? n : -1;
}

/** Kiểm tra + chuẩn hoá 1 mục. Trả về chuỗi lý do nếu không dùng được. */
function normalize(raw: unknown, index: number, seen: Set<string>): Product | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `mục #${index} không phải object`;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!ID_RE.test(id)) return `mục #${index}: id "${String(r.id)}" không hợp lệ (cần dạng kebab-case, vd "tai-nghe-chong-on")`;
  if (seen.has(id)) return `mục #${index}: id "${id}" bị trùng`;
  const name = str(r.name);
  if (!name) return `"${id}": thiếu name`;
  const url = str(r.url);
  if (!validUrl(url)) return `"${id}": url không hợp lệ (cần http/https)`;
  if (!Array.isArray(r.tags)) return `"${id}": tags phải là mảng chuỗi`;
  const tags = [...new Set(r.tags.map(str).map((t) => t.toLowerCase()).filter(Boolean))];
  const pitch = str(r.pitch);
  if (!pitch) console.warn(`[products] "${id}": thiếu pitch (AI sẽ khó lồng vào thoại)`);
  const emoji = str(r.emoji);

  // --- v2: nhóm / kệ / vị trí / nhận xét / ảnh
  const rawCat = str(r.category).toLowerCase();
  let category: ProductCategory;
  if (isCategory(rawCat)) category = rawCat;
  else {
    category = tags.some((t) => BEAUTY_TAGS.has(t)) ? 'lam-dep' : 'cong-nghe';
    if (rawCat) console.warn(`[products] "${id}": category "${rawCat}" không hợp lệ (lam-dep | cong-nghe) → dùng "${category}" theo tags`);
    else console.warn(`[products] "${id}": thiếu category → xếp vào "${category}" theo tags`);
  }
  const shelf = SHELF_OF_CATEGORY[category];
  const rawShelf = str(r.shelf).toLowerCase();
  if (rawShelf && (!isShelf(rawShelf) || rawShelf !== shelf)) {
    console.warn(`[products] "${id}": shelf "${rawShelf}" không khớp category "${category}" → dùng "${shelf}"`);
  }
  const slot = parseSlot(r.slot);
  if (r.slot !== undefined && slot < 0) console.warn(`[products] "${id}": slot "${String(r.slot)}" không hợp lệ (số nguyên ≥ 0) → tự xếp`);
  const note = str(r.note).replace(/\s+/g, ' ').slice(0, 200);
  if (!note) console.warn(`[products] "${id}": thiếu note (1 câu nhận xét của bạn để nhân vật khoe ở phòng trưng bày)`);
  const image = str(r.image);
  if (image && !validUrl(image)) console.warn(`[products] "${id}": image không phải URL http/https → bỏ qua ảnh`);

  return {
    id,
    name: name.slice(0, 120),
    emoji: emoji && emoji.length <= 16 ? emoji : DEFAULT_EMOJI,
    tags,
    pitch: pitch.slice(0, 200),
    priceHint: str(r.priceHint).slice(0, 30),
    url,
    category,
    shelf,
    slot,
    note,
    ...(image && validUrl(image) ? { image } : {}),
  };
}

/** Xếp slot còn thiếu / bị trùng: mỗi kệ riêng, lấy số nhỏ nhất còn trống, giữ thứ tự trong file */
function assignSlots(list: Product[]): void {
  for (const shelf of PRODUCT_SHELVES) {
    const items = list.filter((p) => p.shelf === shelf);
    const used = new Set<number>();
    const pending: Product[] = [];
    for (const p of items) {
      const s = p.slot ?? -1;
      if (s >= 0 && !used.has(s)) used.add(s);
      else {
        if (s >= 0) console.warn(`[products] "${p.id}": slot ${s} trùng với món khác trên kệ ${shelf} → tự xếp lại`);
        pending.push(p);
      }
    }
    let next = 0;
    for (const p of pending) {
      while (used.has(next)) next++;
      p.slot = next;
      used.add(next);
    }
  }
}

function load(): Product[] {
  if (cache) return cache;
  const list: Product[] = [];
  try {
    const json: unknown = JSON.parse(readFileSync(PRODUCTS_FILE, 'utf8'));
    const items = Array.isArray(json) ? json
      : json && typeof json === 'object' && Array.isArray((json as { products?: unknown }).products)
        ? (json as { products: unknown[] }).products
        : null;
    if (!items) {
      console.warn(`[products] ${PRODUCTS_FILE}: cần dạng { "products": [...] } — bỏ qua toàn bộ`);
    } else {
      const seen = new Set<string>();
      items.forEach((raw, i) => {
        const p = normalize(raw, i, seen);
        if (typeof p === 'string') { console.warn(`[products] bỏ qua ${p}`); return; }
        seen.add(p.id);
        list.push(p);
      });
      assignSlots(list);
    }
  } catch (e) {
    console.warn(`[products] không đọc được ${PRODUCTS_FILE}: ${(e as Error).message}`);
  }
  cache = list;
  byId = new Map(list.map((p) => [p.id, p]));
  return cache;
}

/** Tất cả sản phẩm hợp lệ (bản sao mảng; đừng sửa object bên trong) */
export function getProducts(): Product[] {
  return load().slice();
}

export function getProduct(id: string): Product | undefined {
  load();
  return byId.get(id);
}

/**
 * Chọn sản phẩm khớp nhiều tag nhất (hoà thì random). Không khớp tag nào thì random trong số còn lại.
 * Trả về null khi không còn sản phẩm nào (chưa có dữ liệu hoặc tất cả đều nằm trong exclude).
 */
export function pickProduct(tags: string[], exclude?: Set<string>): Product | null {
  const want = new Set((tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  let best: Product[] = [];
  let bestScore = -1;
  for (const p of load()) {
    if (exclude?.has(p.id)) continue;
    let score = 0;
    for (const t of p.tags) if (want.has(t)) score++;
    if (score > bestScore) { bestScore = score; best = [p]; }
    else if (score === bestScore) best.push(p);
  }
  if (!best.length) return null;
  return best[Math.floor(Math.random() * best.length)];
}

/** Sản phẩm trên một kệ, theo slot tăng dần */
export function getShelfProducts(shelf: ProductShelf): Product[] {
  return load().filter((p) => p.shelf === shelf).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

/**
 * Chọn 1 món trên kệ `shelf` cho cảnh showroom_chat: né `exclude` (món vừa nhắc) nếu còn món khác,
 * ưu tiên nhẹ món đang được vẽ trên kệ (slot < SHELF_SLOTS). Kệ trống → null.
 */
export function pickShelfProduct(shelf: ProductShelf, exclude?: Set<string>): Product | null {
  const all = getShelfProducts(shelf);
  if (!all.length) return null;
  const fresh = all.filter((p) => !exclude?.has(p.id));
  const pool = fresh.length ? fresh : all;
  const weights = pool.map((p) => ((p.slot ?? 0) < SHELF_SLOTS ? 1.5 : 1));
  let r = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Bản gửi xuống client: link luôn đi qua /go/:id để server đếm click rồi mới chuyển hướng */
export function toPublic(p: Product, src: string): ProductPublic {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    priceHint: p.priceHint,
    url: `/go/${encodeURIComponent(p.id)}?src=${encodeURIComponent(src)}`, // id kebab-case => giữ nguyên
  };
}

/**
 * Danh sách cho hello.products (docs/v2-contract.md §2): kệ làm đẹp trước, kệ công nghệ sau, theo slot.
 * url có src=showroom (client đổi thành sidebar cho link trong tab 🛍️).
 */
export function getShowroomProducts(): ShowroomProduct[] {
  const order: Record<ProductShelf, number> = { beauty: 0, tech: 1 };
  return load()
    .map((p) => {
      const category = p.category ?? 'cong-nghe';
      const shelf = p.shelf ?? SHELF_OF_CATEGORY[category];
      const item: ShowroomProduct = {
        ...toPublic(p, 'showroom'),
        category,
        shelf,
        slot: p.slot ?? 0,
        note: p.note ?? '',
        tags: [...p.tags],
      };
      if (p.image) item.image = p.image;
      return item;
    })
    .sort((a, b) => order[a.shelf] - order[b.shelf] || a.slot - b.slot || a.name.localeCompare(b.name, 'vi'));
}
