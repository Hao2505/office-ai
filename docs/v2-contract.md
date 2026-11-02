# V2 contract — UI redesign + Showroom (frontend ⇄ backend)

This document fixes the data shapes for v2 so the frontend (public/**) and the backend (src/**) can be built in
parallel. Backend owners implement exactly this; frontend owners code against exactly this (and keep working when the
new fields are absent — the server may still be v1 for a while). All user-facing text: Vietnamese with full diacritics.

## 1. Map changes (`src/sim/map.ts` → `hello.map`)

Old WC room (x1..8, y1..6) becomes the **showroom**; the WC becomes a small closed room in the alcove between the server
room and the meeting room, with a door only.

```ts
// ROOMS: 'toilet' room removed; added:
{ id: 'showroom', label: 'Phòng trưng bày', x: 1,  y: 1, w: 8, h: 6, floor: 'showroom' }   // door stays at (4,7),(5,7)
{ id: 'wc',       label: 'WC',              x: 19, y: 1, w: 4, h: 6, floor: 'tile' }       // walled; door tiles (20,7),(21,7) = 'D'
// FURNITURE: 'toilet' ×2 and 'sink' removed; lockers moved out of the alcove (to the work-area top wall, e.g. x10..13,y9). Added:
{ type: 'shelf_beauty',  x: 1, y: 1, w: 4, h: 1, blocked: true, label: 'LÀM ĐẸP' }
{ type: 'shelf_tech',    x: 5, y: 1, w: 4, h: 1, blocked: true, label: 'CÔNG NGHỆ' }
{ type: 'display_table', x: 4, y: 4, w: 2, h: 1, blocked: true }          // small podium in the middle (optional decoration)
{ type: 'plant',         x: 8, y: 5, w: 1, h: 1, blocked: true }
// SPOTS:
showroom_beauty: [{x:2,y:3},{x:3,y:3},{x:1,y:3}]
showroom_tech:   [{x:6,y:3},{x:7,y:3},{x:8,y:3}]
toilet:          [{x:20,y:8},{x:21,y:8}]        // standing tile in front of the WC door; the agent then "enters" (hidden)
```
WC interior (x19..22, y1..6) is non-walkable (furniture-free, walls around, door gaps at (20,7),(21,7) drawn as a closed
door with a "WC" sign). Everything else in the map is unchanged.

## 2. Products (`data/products.json` → `hello.products`)

```ts
// data/products.json entries gain:
category: 'lam-dep' | 'cong-nghe';   // which shelf group
shelf: 'beauty' | 'tech';            // derived from category (kept explicit for clarity)
slot: number;                        // 0-based position on the shelf (≤ 5 per shelf shown on the canvas; extra ones only in the sidebar)
note: string;                        // the owner's own 1-line review ("Xài 3 tháng, pin trâu, đeo cả ngày không đau tai")
image?: string;                      // optional image URL (client shows the emoji when absent)

// ServerMsg 'hello' gains:
products: ShowroomProduct[];

export interface ShowroomProduct extends ProductPublic {   // ProductPublic = { id, name, emoji, priceHint, url }
  category: 'lam-dep' | 'cong-nghe';
  shelf: 'beauty' | 'tech';
  slot: number;
  note: string;
  image?: string;
  tags: string[];
}
```
`url` is always `/go/<id>?src=<src>`; the server fills `src=showroom` for `hello.products`. The client may replace the
`src` query value with `sidebar` for links rendered in the 🛍️ tab. Click counts per product+src are at `GET /api/stats`.
Placeholder content until the owner supplies real items: 5 beauty + 5 tech products with believable Vietnamese notes.

## 3. Activities / frames / scenes

```ts
// Activity union gains:
'showroom'      // browsing the shelves; emote 🛍️; labels like 'ngắm đồ ở phòng trưng bày', 'săm soi kệ công nghệ'
// FrameAgent flags: 1 = walking, 2 = onPhone, 4 = in scene, 8 = hidden (inside the WC — client must NOT draw the agent,
//   but may show "Có người" on the WC door while any agent with activity 'toilet' has flag 8).
// SceneType gains:
'showroom_chat' // icon 🛍️, title 'Khoe đồ ở phòng trưng bày', channel 'office', 2–3 participants standing at showroom spots
```
Showroom behaviour (backend): activity weight 0.08 (marketing 0.25; +0.1 when mood < 40), 6–12 game minutes, agents stand at
`showroom_beauty` / `showroom_tech` (women lean beauty, dev/design lean tech, never absolute). Director: `showroom_chat`
when ≥ 2 agents are in the showroom (or scheduled every ~2–3 game hours with Trâm/marketing), max 1 per 30 real minutes,
`req.product` = a product from the shelf the participants stand at, exactly one line `product: true` → product chip in the
feed; use `note` as material so the recommendation sounds lived-in and specific. Rename `COMPANY_CHAT_LABEL`/defaults to
"Cty TNHH VibeCorp" everywhere.

## 4. AI status (`UsageStats`, already added by the router work)

```ts
activeProvider?: string;             // label of the provider in use ('Gemini', 'Groq', ...)
providers?: {
  name: string; label: string; model: string; enabled: boolean;
  calls: number; failures: number; inputTokens: number; outputTokens: number; costTodayUsd: number;
  rpdUsed: number; rpdLimit?: number; tpdUsed: number; tpdLimit?: number;
  cooldownUntil?: number; cooldownReason?: string; format: 'json_schema' | 'json_object'; lastError?: string;
}[];
```
UI: the AI chip says "🤖 AI · Gemini · gemini-3.5-flash-lite · 35 lượt · $0" (never "GPT" unless the provider is OpenAI);
tooltip lists every provider with used/limit and cooldown ("Groq · dự phòng · 0/1000 lượt · sẵn sàng").

## 5. Frontend module boundaries (two engineers in parallel)

- **canvas** owns `public/js/render/**`. Must keep `createOffice(canvas, hooks)` and all existing hooks working and may
  ADD: `office.setProducts(products: ShowroomProduct[])`, hooks `onProductHover(product | null, clientX, clientY)` and
  `onProductClick(product)`, `office.setCharacterScale(n)` (default = the new bigger size). Reads state through the
  existing `store.js` API only (no edits to `store.js`).
- **ui** owns `public/index.html`, `public/style.css`, `public/js/ui/**`, `public/js/main.js`, `public/js/store.js`,
  `public/js/net.js`, `public/js/labels.js`, `public/js/util.js`. Renders the DOM tooltip for `onProductHover`, opens
  `product.url` on `onProductClick` (`window.open(url, '_blank', 'noopener')`), calls `office.setProducts(hello.products)`.
  Any new `store.js` getter the canvas engineer needs must be requested in their report; until then the canvas reads
  `hello`/`status` data through the current getters.

## 6. Layout (v2)

- No top bar. The office canvas fills the top of the page; a translucent HUD overlay (DOM) sits on the canvas:
  top-left clock pill `10:00 · Thứ Sáu · Ngày 5 · x10` + thin day-progress line; top-right icon chips 👔 🚀 💰 👀 🤖
  (hover/tap → details popover; red pulsing badge on incidents). Company name small in the sidebar header.
- In-world (canvas): wall clock follows game time; meeting-room whiteboard shows project name + progress% + deadline;
  KPI wall board readable (names + % + revenue line "Doanh thu tháng 488/1.500 tr"); boss door sign "ĐI VẮNG: lý do"
  when away; floor logo 'VIBECORP' (derived from company name).
- Sidebar: default 320 px, drag handle to resize (persist in localStorage), collapse button (canvas goes full width; a
  thin ticker along the bottom of the canvas shows the latest 2–3 lines). Dense rows; feed grouped by scene cards (older
  cards collapse to a one-line summary, click to expand); events as one-line pills; product chips one line with the
  caption "Link tiếp thị liên kết". Tabs: 💬 Trực tiếp · 👥 Nhân sự · 🛍️ Sản phẩm · 📰 Bản tin · 🗣️ Tin đồn.
- Characters: ~1.8–2 tiles tall (chibi: big head, visible eyes/mouth/hair/accessories at default zoom), name pill readable,
  recognisable from behind (hair + shirt + accessory). Mobile (< 900 px): canvas on top, HUD as one icon row, sidebar below.
