# Frontend: HUD, sidebar, tab, bảng dev (giao diện DOM)

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `public/index.html`, `public/style.css`, `public/js/main.js`, `public/js/labels.js`, `public/js/util.js`, 14 module `public/js/ui/*.js` (hud, sidebar, tabs, feed, staff, profile, products, recaps, news, history, rumors, devbar, toasts, avatar) và các điểm nối với `store.js` / `net.js` / `render/office.js` / `src/server.ts` · Đọc khi: cần sửa bất kỳ thứ gì người xem nhìn thấy **ngoài canvas** (chip, popover, feed, hồ sơ, tab, bảng dev, toast, responsive), thêm loại cảnh / nhãn / nhóm tin mới, hoặc cần hiểu vì sao người xem thường không thấy số liệu hệ thống.

Tài liệu này trả lời: trang web được dựng từ gì (không có bước build), module nào vẽ phần nào, dữ liệu đi từ WebSocket tới DOM qua đường nào, các ngưỡng / hằng số / ràng buộc của từng khối, và "muốn đổi X trên giao diện thì sửa file nào". Phần **vẽ canvas** (bản đồ, nhân vật, bong bóng thoại, bộ đệm chống giật trong `store.js`, reconnect trong `net.js`) nằm ở [07-frontend-ve-canvas.md](./07-frontend-ve-canvas.md); hợp đồng thông điệp `ServerMsg` ở [02-kien-truc-va-giao-thuc.md](./02-kien-truc-va-giao-thuc.md) và [`src/types.ts`](../src/types.ts); biến môi trường ở [09-cau-hinh-du-lieu.md](./09-cau-hinh-du-lieu.md). Tài liệu cũ vẫn còn giá trị và được trỏ tới chứ không chép lại: [README.md](../README.md) §2 (người xem thấy gì), §3.6 (chip 🤖 chỉ admin), §8–§9 (mã dev, bảng dev); [SPEC.md](../SPEC.md) §8 (phần tả "thanh trên cùng" đã lỗi thời — xem §21); [docs/v2-contract.md](./v2-contract.md) §4–§6; [docs/v3-news.md](./v3-news.md) mục "Giao diện"; [docs/ui-polish-todo.md](./ui-polish-todo.md) §1, §4, §9. Tổng quan dự án: [01-tong-quan.md](./01-tong-quan.md); mục lục bộ tài liệu: [README.md](./README.md).

---

## 1. Toàn cảnh

### 1.1 Quy ước kỹ thuật (áp dụng cho mọi module trong vùng này)

| Quy ước | Chi tiết | Nơi kiểm chứng |
|---|---|---|
| Không build, không framework | Trình duyệt tải `js/main.js` dạng `type="module"`; các module import tương đối lẫn nhau. Không có bundler, không TypeScript ở client (`tsc --noEmit` của `npm run typecheck` **không** kiểm tra `public/`). | `public/index.html:14`, `package.json` scripts |
| Chống XSS | Mọi chuỗi từ server/AI chỉ vào DOM qua `textContent` / text node. Toàn vùng dùng `el(tag, props, ...children)`, `setKids(node, ...kids)`, `setText(node, text)`; chuỗi con luôn thành text node. Không có `innerHTML` nào trong `public/js/ui/`. | `public/js/util.js:125-165` |
| Cắt độ dài | `str(v, max = 2000)` cắt và thêm `…` (độ dài thật có thể = max + 1); `num(v, d = 0)`; `arr(v)`. Mọi trường hiển thị đều qua các hàm này. | `util.js:85-87` |
| Màu / link an toàn | Màu từ server chỉ dùng sau `safeColor(c, fallback)` (regex `COLOR_RE`, ≤ 40 ký tự, không `url()`); link sản phẩm chỉ chấp nhận dạng `/go/...` qua `safeProductUrl`; ảnh sản phẩm qua `safeImageUrl` (chỉ `https://` tuyệt đối hoặc đường dẫn cùng nguồn bắt đầu `/`, ≤ 600); link bài báo qua `safeNewsUrl` (chỉ `http:`/`https:`). | `util.js:70-83, 186-191`; `ui/news.js:13-19` |
| Font | "Be Vietnam Pro" từ Google Fonts (`preconnect` + stylesheet), fallback hệ thống trong `--font`. Đây là yêu cầu ra bên thứ ba duy nhất **theo mặc định** (ngoài WebSocket / API cùng nguồn). Ngoại lệ theo cấu hình: ảnh sản phẩm `image` (tuỳ chọn trong `data/products.json`; server chỉ chuyển xuống client nếu là URL http/https — `src/content/products.ts:87-88, 239`; client chỉ nhận `https://` tuyệt đối qua `safeImageUrl`) sẽ được tải từ host ngoài bằng `<img loading=lazy referrerpolicy=no-referrer>` (`products.js:61-70`). Hiện `data/products.json` chưa có ảnh thật nên chưa xảy ra. | `index.html:10-12`, `style.css:34` |
| Chủ sở hữu | Theo `docs/v2-contract.md` §5: nhóm "ui" sở hữu `index.html`, `style.css`, `ui/**`, `main.js`, `store.js`, `net.js`, `labels.js`, `util.js`; nhóm "canvas" sở hữu `render/**`. UI chỉ **đọc** store qua trường / getter, không tự sửa store. | `docs/v2-contract.md:86-96` |

### 1.2 Sơ đồ module

```
WebSocket /ws ──► net.js (connect/send/reconnect)
                     │  JSON ServerMsg
                     ▼
               store.js: handleMessage() → cập nhật store → store.emit(type, payload)
                     │
      ┌──────────────┼─────────────────────────────────────────────┐
      ▼              ▼                                             ▼
 render/office.js   ui/*.js (DOM: hud, sidebar, tabs, feed,      main.js (tên công ty, title,
 (canvas, đọc store  staff, profile, products, recaps, news,       overlay loading, deep link,
  trong rAF; xem 07) history, rumors, devbar, toasts, avatar)      tooltip rê chuột, syncInsets)
      ▲              │
      └──── hooks ───┘  onPick/onHover/onProductHover/onProductClick/onBoardHover/onBoardClick
                        + office.setInsets / setProducts / setMap / focusAgent / zoom*
```

Chiều ngược lại (client → server) chỉ có `ClientMsg` (`src/types.ts:488-491`): `{t:'dev', action:'speed', value}` và `{t:'dev', action:'event', name}` từ bảng dev qua `send()` (`net.js:124-132`), và `{t:'ping'}` tự động mỗi 25 s (`net.js:99`; server bỏ qua, `src/server.ts:471`). HTTP mà vùng này gọi: `GET /api/history`, `GET /api/history?date=YYYY-MM-DD` (history.js); `POST /api/dev/login` / `POST /api/dev/logout` (net.js); link `/go/<id>?src=…` (mở tab mới; server 302 sang Shopee và đếm click theo `src`, `src/server.ts:329-349`). Bộ giá trị `src` thực tế:

| `src` | Ai đặt | Nơi |
|---|---|---|
| `showroom` | server, sẵn trong `hello.products` (`getShowroomProducts` → `toPublic(p, 'showroom')`); canvas mở bằng `openProduct(p, 'showroom')` | `src/content/products.ts:232`, `main.js:34` |
| `sidebar` | **client** đổi bằng `productUrl(p.url, 'sidebar')` ở tab Sản phẩm | `products.js:20-26, 73` |
| `scene` | server, chip sản phẩm trong dòng thoại (`toPublic(s.product, 'scene')`); feed chỉ lọc qua `safeProductUrl`, không đổi `src` | `src/sim/director.ts:1460`, `feed.js:466` |
| `desk` | server, món đồ trên bàn trong hồ sơ (`toPublic(p, 'desk')`); profile chỉ lọc qua `safeProductUrl` | `src/sim/world.ts:2799`, `profile.js:138` |
| `khac` | server ghi khi `src` không khớp `^[A-Za-z0-9_-]{1,32}$` | `src/server.ts:342-343` |

Frontend **không** gọi `/api/stats`.

### 1.3 Thứ tự khởi động (`main.js`) — quan trọng khi thêm module mới

1. `main.js:2-4` — import `store, actorPos`, gắn `window.__vpa = { store, actorPos }` (non-enumerable; móc QA headless, không chứa gì ngoài dữ liệu server đã gửi).
2. `main.js:26-41` — `office` khởi tạo là **đối tượng giả** (`setMap: () => true`, các hàm `noop`, `hasMap: false`), rồi `await import('./render/office.js')` ở top-level và `createOffice($('office'), hooks)`. Nếu module vẽ lỗi, trang vẫn chạy (HUD, feed…) và chỉ `console.error`. Lưu ý: `createOffice` tự đăng ký `store.on('hello')` (`render/office.js:1206`) nên listener của canvas chạy **trước** mọi listener UI.
3. `main.js:43-55` — thứ tự init: `initTabs($('sidebar'))` → `initToasts($('toasts'))` → `initHud()` → `initSidebar()` → `initFeed(openProfile)` → `initStaff(openProfile)` → `initProducts()` → `initRecaps(openProfile)` → `initNewsStrip()` → `initHistory(openProfile)` → `initRumors(openProfile)` → `initProfile(id => office.focusAgent(id))` → `initDevbar(send)`.
4. `main.js:58-60` nút zoom; `main.js:64-78` `syncInsets()` đo chiều cao `#hud` và `#ticker` (khi không `hidden`) → `office.setInsets({top, bottom})`, gắn `ResizeObserver` cho hai phần tử, `onSidebarToggle`, `resize`; `main.js:81-85` `pushProducts()` khi `store` phát `products`; `main.js:88-111` handler `hello` của main; `main.js:116-125` deep link; `main.js:127-133` banner mất kết nối; `main.js:135-138` toast; `main.js:141-224` tooltip rê chuột nhân vật / bảng; `main.js:227-229` gợi ý lần đầu tắt sau 9 000 ms hoặc `pointerdown` đầu tiên trên canvas; `main.js:232-234` `document.fonts.ready` → `office.refresh()`.
5. `main.js:236` — **`connect()` là lệnh cuối cùng.** Quy ước: đăng ký `store.on(...)` trước dòng này cho rõ thứ tự. Về kỹ thuật, `connect()` chỉ tạo `new WebSocket` (`net.js:87`) và `hello` tới qua `sock.onmessage` ở một task sau, nên mọi `store.on` đồng bộ trong `main.js` (kể cả đặt sau `connect()`) vẫn kịp nhận `hello` đầu; chỉ module nạp động (`import()`) **sau khi socket đã mở** mới lỡ — và vẫn nhận `hello` ở lần kết nối lại. Bắt buộc: mọi module phải chịu được `hello` lặp lại khi kết nối lại (reset trạng thái cũ). Thứ tự với mã dev: `connect()` → `wsUrl()` → `devToken()` mới gỡ `?dev=`/`#dev=` khỏi URL (§1.6), tức **sau** mọi `init*` ở bước 3.

Handler `hello` của main (`main.js:88-111`): `shortCompanyName(store.companyName)` ("Cty TNHH VibeCorp" → "VibeCorp", `util.js:194-198`) vào `#company-name` và `document.title = "Văn Phòng Ảo — <tên>"`; `office.setMap(msg.map, msg.companyName)`; `pushProducts()`; nếu `setMap` trả `false` → thẻ lỗi "Không đọc được bản đồ văn phòng" trong `#loading` (bảng tin bên phải vẫn hoạt động); ngược lại `#loading` thêm lớp `done` rồi `hidden` sau 450 ms; ẩn `#conn-banner`; `applyHash()` đúng một lần (`deepLinked`).

### 1.4 Sự kiện store mà UI nghe

Trong `onHello` (`store.js:341-381`) mọi trường store đã được gán **trước** khi emit; thứ tự emit: `hello` → `agents` → `status` → `recaps` → `rumors` → `products` → `news`.

| Sự kiện | Payload | Nguồn ServerMsg | Module nghe |
|---|---|---|---|
| `hello` | thông điệp hello | `hello` | tất cả module (reset + vẽ lại), main, office |
| `frame` | `clock` | `frame` (mỗi `FRAME_MS = 200` ms, `src/sim/world.ts:34`) | hud.renderClock |
| `status` | `StatusInfo` | `status` (kèm mỗi `agents`, `world.ts:2769-2776`) | hud.renderStatus, devbar.highlight, main.refreshTip |
| `agents` | `Map<id, PublicAgent>` | `agents` (mỗi `AGENTS_MS = 2000` ms hoặc khi dirty ≥ 300 ms) | staff, profile, rumors, main.refreshTip |
| `log` | `{entry, live: true}` | `log` | feed, sidebar (ticker) |
| `scene` | `PublicScene` | `scene` | feed |
| `recaps` / `recap` | mảng / bản mới | `recap` (store giữ ≤ 14, `store.js:396`) | recaps (vẽ / `markUnread`) |
| `rumors` | mảng | `rumors` | rumors |
| `products` | mảng (≤ 60, đã `normProduct`) | `hello.products` | products, main.pushProducts |
| `news` | mảng (≤ 30, mới nhất cuối) | `hello.news`, `scene_start.news`, `scene.news` | news (dải Tin đang bàn) |
| `toast` | `{icon ≤ 8, text ≤ 300}` | `toast` | main → toasts |
| `conn` | `'connecting' \| 'open' \| 'closed'` | net.js | hud (`#clock-day`), main (banner, `.stage.offline`) |

### 1.5 Hai lớp ẩn thông tin hệ thống (nguyên tắc 4 của chủ dự án)

Người xem thường không được thấy nguồn AI, lượt gọi, lỗi, số bấm link. Cơ chế **hai lớp**, lớp server là lớp thật:

1. **Server**: `publicStatus()` (`src/server.ts:184-193`) đặt `clicks = 0` và rút `ai` còn `{mode, model: '', calls: 0, …}` cho socket không có quyền dev; `hello.dev = isDev` và `hello.status = publicStatus(...)` khi không phải dev (`server.ts:460-463`); `broadcast` gửi bản công khai của `status` cho socket thường (`server.ts:195-202`). Quyền dev theo từng socket: `devAllowed()` (`server.ts:68-75`) kiểm `?dev=` trên URL WebSocket, không có thì cookie HttpOnly `vpa_dev` (`server.ts:73, 78`); `DEV_PANEL=false` → không ai; `DEV_TOKEN` rỗng → mọi người là dev.
2. **Client** chỉ là lớp trình bày, bật theo `store.dev` (= `hello.dev`): chip 🤖 (`hud.js:186-190`), dòng "lượt bấm link" trong popover 👀 (`hud.js:270`), nhãn "🤖 AI chấp bút / 🧪 Bản tin mẫu" ở tờ báo (`recaps.js:44`), bảng dev `hidden = !store.dev` (`devbar.js:54`). Chấm `#ai-dot` chỉ dùng `ai.mode` — trường duy nhất `publicStatus` giữ lại (`hud.js:209-218`).

Ràng buộc: **không** đổi bất kỳ nhánh `store.dev` nào thành luôn hiện; muốn hiển thị thêm số liệu hệ thống thì phải vừa gate ở client vừa chắc server đã lược (xem §19).

### 1.6 Bộ nhớ trình duyệt và deep link

| Khoá / tham số | Ý nghĩa | Nơi đọc/ghi |
|---|---|---|
| `localStorage['vpa.dev']` | mã dev (DEV_TOKEN) — không bao giờ hiển thị/log; di trú một lần từ `sessionStorage` bản cũ | `net.js:13-28` |
| cookie `vpa_dev` (HttpOnly, SameSite=Lax, Secure khi https, Max-Age 31536000) | bản sao mã dev do server đặt qua `POST /api/dev/login`, để tắt trình duyệt / xoá JS storage vẫn là admin | `net.js:30-37`, `server.ts:100-121` |
| `localStorage['vpa.sidebar.w']`, `['vpa.sidebar.collapsed']` | độ rộng sidebar (260–520) và trạng thái thu gọn (`'1'`/`'0'`) | `sidebar.js:6-7, 27-29` |
| `localStorage['vpa.devbar.collapsed']` | bảng dev đang gọn (`'1'`) / mở (`'0'`) | `devbar.js:10, 15, 51` |
| `#tab=live\|staff\|products\|recap\|rumors`, `#filter=<key>`, `#profile=<agentId>` | deep link; áp một lần sau `hello`, và mỗi `hashchange` khi `store.ready` | `main.js:116-125` |
| `#history=YYYY-MM-DD` | mở sẵn mục Lịch sử và chọn ngày | `history.js:49-52` |
| `?dev=<token>` / `#dev=<token>` | mã dev; `net.js` đọc, lưu `localStorage` rồi gỡ khỏi URL bằng `history.replaceState` (giữ các khoá hash khác). **Thời điểm**: trong `devToken()` ← `wsUrl()` ← `connect()` (`main.js:236`) — **sau** mọi `init*` đồng bộ nhưng **trước** `applyHash()` (chạy sau `hello`, `main.js:104/110`, và mỗi `hashchange`, `main.js:125`). Hệ quả: `history.js:50-52` đọc `location.hash` lúc `initHistory` (`main.js:52`), khi `#dev=` **còn trên URL** (hiện vô hại vì chỉ lấy khoá `history`). Bẫy: module mới đọc `location.hash` lúc init không được log / hiển thị / lưu toàn bộ hash; muốn chắc URL đã sạch thì đọc trong handler `hello` hoặc sau `applyHash()`. | `net.js:51-74, 76-79, 87` |

Mọi truy cập storage bọc `try/catch` (`lsGet/lsSet`, `util.js:200-205`; `devbar.js:51` cho `setItem`) để không vỡ ở chế độ riêng tư — **trừ** `devbar.js:15` gọi `localStorage.getItem(KEY)` hai lần không bọc. Nếu storage ném lỗi (iframe sandbox chặn storage, một số chế độ riêng tư cũ) thì `initDevbar` ném ngay tại `main.js:55`: các `init*` trước đó đã xong nhưng `connect()` nằm sau nên trang **không kết nối**. Nên chuyển sang `lsGet` để đồng nhất (Câu hỏi còn mở 16).

### 1.7 Phiên bản tài nguyên tĩnh — bẫy cache

`index.html` viết `href="style.css"`, `src="js/main.js"` tương đối. Server (`src/server.ts:149-162`) viết lại mọi `href|src="…(.css|.js)"` tương đối (regex dòng 152: bỏ qua `https?:`, `data:` và đường dẫn bắt đầu `/`) thành `/v/<ASSET_VERSION>/…` và trả `index.html` với `Cache-Control: no-cache`. `ASSET_VERSION` = sha1 rút 12 ký tự của (đường dẫn, kích thước, mtime) mọi file trong `public/` lúc server khởi động (`server.ts:129-146`). File dưới `/v/<đúng phiên bản>/` được cache `public, max-age=31536000, immutable` (`server.ts:371, 439`). Vì `main.js` được nạp từ `/v/<ver>/js/main.js`, mọi `import` tương đối (kể cả `await import('./render/office.js')`) tự thừa hưởng tiền tố nên cũng cache mãi. Hệ quả:

- Sửa bất kỳ file trong `public/` → **phải khởi động lại server** (pm2 restart, xem [10-van-hanh-deploy.md](./10-van-hanh-deploy.md)) để đổi phiên bản.
- Trong `index.html` phải dùng **nháy đôi** và đường dẫn **tương đối** cho `href`/`src` của `.css`/`.js`; thuộc tính nháy đơn hoặc `/js/...` tuyệt đối sẽ không được đóng phiên bản.
- Tài nguyên tham chiếu từ CSS bằng `url(...)` (hiện chưa có) sẽ không được đóng phiên bản.
- `ASSET_PREFIX_RE = /^\/v\/([A-Za-z0-9]{4,40})(\/.*)$/` (`server.ts:147`) chấp nhận **mọi** chuỗi 4–40 ký tự chữ-số làm phiên bản: URL `/v/<phiên bản cũ>/…` vẫn được phục vụ bằng file hiện tại trong `public/` (để tab đang mở `index.html` cũ không vỡ) nhưng với `Cache-Control: no-cache`; chỉ đúng `ASSET_VERSION` đang chạy mới `immutable` (`server.ts:437-439`, `handleStatic` dòng 371). Hệ quả sau deploy: tab cũ chưa tải lại dùng file đã cache (bản cũ) cho những gì đã tải, nhưng file chưa từng tải (ví dụ module nạp động lần đầu) sẽ nhận **nội dung mới** dưới tiền tố cũ → có thể trộn phiên bản tới khi người xem tải lại trang. Đổi hợp đồng giữa các module JS cần tính tới điều này.
- `ASSET_VERSION` rơi về `'dev'` khi không có thư mục `public/` (`server.ts:146`); hàm băm bỏ qua dotfile (`server.ts:135`), nên thêm/sửa file bắt đầu bằng `.` trong `public/` không đổi phiên bản.

---

## 2. `public/index.html` — khung DOM tĩnh (143 dòng)

Vai trò: khung DOM duy nhất; mọi nội dung động do JS tạo. `lang="vi"`, viewport `viewport-fit=cover` (CSS dùng `env(safe-area-inset-*)`), `theme-color #f6f1ea`, `<title>` mặc định "Văn Phòng Ảo — VibeCorp" (JS ghi đè theo `companyName` sau `hello`), `<meta name="description">` cho SEO (`index.html:8` — chuỗi cứng, **không** theo `COMPANY_NAME`), favicon SVG data-URL (`index.html:5-9`). Cấu trúc: `#app` → `main.main#main` → `section.stage#stage` + `aside.sidebar#sidebar`; ngoài `main`: `#drawer-backdrop`, `aside.drawer#drawer`.

| Vùng | Phần tử (id / class) | Dòng | Module dùng |
|---|---|---|---|
| Canvas | `canvas#office` | 19-20 | render/office.js, main.js (stage-hint) |
| HUD | `.hud#hud` → `.hud-left` {`.live-badge` "TRỰC TIẾP", `span.ai-dot#ai-dot`, `.hud-clock#hud-clock` {`#clock-time`, `#clock-day`, `#clock-speed[hidden]`, `.hud-bar > #clock-fill`}} + `.hud-right#chips[role=group]` {`button.chip#chip-incident[hidden]`, `#chip-project`, `#chip-revenue`, `#chip-viewers`, `#chip-ai[hidden]`} | 23-42 | hud.js |
| Popover | `.popover#popover[role=dialog][hidden]` | 43 | hud.js |
| Toast | `.toasts#toasts[aria-live=polite]` | 45 | toasts.js |
| Mất kết nối | `.conn-banner#conn-banner[role=alert][hidden]` | 46 | main.js |
| Zoom | `.zoom` {`#zoom-in`, `#zoom-out`, `#zoom-fit`} | 47-51 | main.js |
| Bảng dev | `.devbar#devbar[hidden]` | 52 | devbar.js |
| Tooltip | `.hover-tip#hover-tip[hidden]`, `.prod-tip#prod-tip[role=tooltip][hidden]`, `.stage-hint#stage-hint` | 53-55 | main.js, products.js |
| Ticker | `.ticker#ticker[hidden]` {`#tk-body[aria-live=polite]`, `button#sb-expand`} | 58-61 | sidebar.js |
| Loading | `.loading#loading` {`.loading-card` {icon, title, `#loading-sub`, dots}} | 63-70 | main.js |
| Sidebar đầu | `.sb-handle#sb-handle[role=separator][aria-valuemin=260][aria-valuemax=520][aria-valuenow=320][tabindex=0]`; `.sb-head` {`h1#company-name` ("VibeCorp" mặc định), `#company-tag`, `button#sb-collapse`} | 74-82 | sidebar.js, main.js |
| Tabs | `nav.tabs[role=tablist]` 5 nút `[role=tab][data-tab=live\|staff\|products\|recap\|rumors]`; hai tab recap/rumors có `i.tab-dot` | 83-89 | tabs.js |
| Panel Trực tiếp | `section.panel.active[data-panel=live]` {`#filters[role=group]`, `.feed-wrap` {`#feed[data-filter=all][aria-live=polite]`, `button#new-msgs[hidden]`}} | 90-96 | feed.js |
| Panel Nhân sự / Sản phẩm | `#staff.staff.scroll`, `#products.products.scroll` | 97-98 | staff.js, products.js |
| Panel Bản tin | `#recaps.recaps.scroll` {`#news-strip[hidden]`, `details#history` {`summary.hist-sum`, `.hist-body` {`.hist-controls` {`label.hist-label`, `select#hist-date[hidden]`, `#hist-refresh`, `#hist-toggle[hidden]`}, `#hist-status[hidden]`, `#hist-feed`, `#hist-foot[hidden]` {`#hist-count`, `#hist-more`}}}, `#recap-list`} | 99-128 | news.js, history.js, recaps.js |
| Panel Tin đồn | `#rumors.rumors.scroll` | 129 | rumors.js |
| Drawer | `#drawer-backdrop[hidden]`; `aside.drawer#drawer[aria-hidden=true]` {`.drawer-head` {"🪪 Hồ sơ nhân viên", `button.drawer-close`}, `.drawer-body`} | 133-140 | profile.js |

Ràng buộc & bẫy:

- Mọi id trên được JS `getElementById` **trực tiếp**; đổi id là vỡ module tương ứng (vd `history.js:30-37`, `hud.js:20-22`, `sidebar.js:20-25`).
- `aria-valuemin/max` của tay kéo ghi cứng, trùng với `SB_MIN/SB_MAX` trong `sidebar.js:8`; JS chỉ cập nhật `aria-valuenow` (`sidebar.js:82`).
- `[hidden]` được CSS ép `display: none !important` (`style.css:52`) nên JS chỉ cần gán `.hidden`.
- `href/src` phải dùng nháy đôi, đường dẫn tương đối (§1.7).

---

## 3. `public/style.css` — toàn bộ giao diện (1180 dòng)

Không preprocessor. Thang khoảng cách 4 · 6 · 8 · 10 · 12 · 16 (`style.css:5`).

### 3.1 Biến CSS (`:root`, dòng 7-38)

| Nhóm | Biến | Giá trị / ghi chú |
|---|---|---|
| Nền | `--bg #f6f1ea`, `--bg-2`, `--panel #fff`, `--soft #fbf8f4`, `--line`, `--line-2` | nền ấm, panel trắng |
| Chữ | `--ink #1f2937`, `--ink-2`, `--muted #8a7f73` | |
| Nhấn | `--accent #ff7a45`, `--accent-ink #c2410c`, `--accent-soft #fff1e8` | cam thương hiệu |
| Trạng thái | `--ok #22c55e`, `--warn #f59e0b`, `--danger #ef4444`, `--info #3b82f6` | |
| Kênh / nhãn | `--group #16a34a` (nhóm kín), `--company #2563eb` (nhóm công ty), `--shopee #ee4d2d` | tông thẻ cảnh, nút mua |
| Hình | `--radius 12px`, `--radius-sm 8px`, `--shadow-sm`, `--shadow`, `--shadow-lg`, `--glass rgba(255,255,255,0.82)`, `--glass-line` | HUD kính mờ |
| Font | `--font` ("Be Vietnam Pro" + fallback), `--serif` ("Noto Serif", Georgia…) | serif cho masthead tờ báo |
| Bố cục | `--sidebar-w: 320px` (sidebar.js ghi đè trên `#main`), `--hud-h: 46px` | `--hud-h` **không được dùng ở đâu** (xem Câu hỏi còn mở) |

Biến đặt động từ JS: `--stage-tint` (canvas đặt lên `#stage`, dùng ở `.stage::before`, dòng 83-87), `--who` (màu tên người nói, `.who`, dòng 695), `--av-bg/--av-hair/--av-size` (avatar, dòng 599-612), `--pt-bg` (chân dung, dòng 791, 965), `--tone` (thẻ cảnh, dòng 620).

### 3.2 Bố cục

- `#app` grid cao `100vh` rồi `100dvh` (59-64). `.main` grid 2 cột `minmax(0,1fr) var(--sidebar-w)` (67-71); `body.sb-collapsed` → 1 cột và `.sidebar {display:none}` (72-73).
- `.stage` nền gradient + `::before` tint ngày/đêm theo `--stage-tint` (`mix-blend-mode: multiply`, transition 2 s) + `::after` lưới chấm 22 px (75-94). `#office` `touch-action: none`, z 1 (95); `.stage.offline #office` làm xám `saturate(0.45)` (96) và `.live-badge` chuyển xám (97).
- `body.resizing` đổi cursor `col-resize`, tắt `user-select`, và `#office {pointer-events:none}` khi đang kéo sidebar (56-57).
- `.sidebar` là **container query** `container-type: inline-size; container-name: sidebar` (480-481) — nền tảng cho mọi `@container sidebar (...)` bên dưới.

### 3.3 Thứ tự lớp z

| z | Phần tử | Dòng |
|---|---|---|
| 0 | `.stage::before/::after` | 84, 93 |
| 1 | `#office` | 95 |
| 2 | `.sidebar`; `.new-msgs` (trong `.feed-wrap`) | 479; 583 |
| 3 | `.stage-hint`; `.sb-handle` | 241; 484 |
| 4 | `.hud`, `.zoom`, `.devbar` | 101, 298, 418 |
| 5 | `.ticker` | 390 |
| 6 | `.hover-tip`, `.prod-tip` | 318, 343 |
| 7 | `.toasts` | 258 |
| 8 | `.popover` (chú thích: "trên toast") | 201 |
| 9 | `.conn-banner` | 287 |
| 10 | `.loading` | 363 |
| 40 / 41 | `.drawer-backdrop` / `.drawer` (`position: fixed`) | 946, 949 |

### 3.4 Các khối chính

| Khối | Dòng | Điểm đáng chú ý |
|---|---|---|
| HUD | 99-197 | `.hud {pointer-events:none}` và `.hud > * {pointer-events:auto}` để bấm xuyên khoảng trống xuống canvas (104-106). `.hud-right` cuộn ngang ẩn thanh cuộn. `.ai-dot` xám mặc định, `.on` xanh có glow, `.off` xám đậm (127-134). `.hud-clock.night` tông tối (155-159). `.chip` kính mờ cao 30 px; trạng thái `.chip-project.due/.overdue`, `.chip-ai.offline/.over/.backup`, `.chip-incident.danger` (đỏ, nhịp `chipAlarm` 0.9 s) / `.warn` (vàng, `chipPulse` 1.6 s) (183-197). `.chip-dt::before {content:"·"}` tạo dấu chấm giữa text và detail (180). `.chip-boss.away` (181-182) là **CSS chết** (chip sếp đã bỏ, `ui-polish-todo.md` §9). |
| Popover | 199-238 | nền tối `#1f2937`, rộng `min(340px, 100% − 16px)`; `.tip-title/.tip-sub/.tip-muted/.tip-warn/.tip-table/.tip-bar(.ok/.bad)`; danh sách nguồn AI `.prov` grid `14px 1fr` với `.prov.active/.cool/.off` đổi màu chấm và chữ. `.tip-steps` (217) không có JS nào dùng. |
| Gợi ý / toast / banner | 240-295 | `.stage-hint` đáy giữa, `.fade` mờ đi; `body.has-devbar .stage-hint {bottom:50px}`, cộng `sb-collapsed` → 84 px (254-255). `.toasts` `top:48px` giữa stage, rộng `min(520px, 100% − 40px)`, viên thuốc trắng, vào/ra bằng `.in/.out`; tông `.toast-hot/.toast-happy/.toast-warn` (257-284). `.conn-banner` vàng, `.spinner`. |
| Zoom / tooltip / loading | 297-386 | `.zoom` góc dưới phải; `.hover-tip` (max 260 px) với `.ht-kpi` grid 3 cột và `.ht-pct.ok/.mid/.low`; `.prod-tip` (max 270 px, ảnh 36 px); `.loading` overlay mờ, `.done` → opacity 0. |
| Ticker | 388-414 | dải tối 34 px đáy stage; khi `body.sb-collapsed` thì `.zoom/.devbar {bottom:44px}`, `.stage-hint {bottom:46px}` (413-414). |
| Devbar | 416-470 | `.devbar.collapsed .dev-panel {display:none}`; `.dev-speed.active` cam; `.dev-ev.sent` xanh; tooltip nút lấy từ `attr(data-tip)` qua `::after`, hiện khi hover/focus-visible (459-470). |
| Sidebar + tabs | 472-547 | `.sb-handle` rộng 9 px lệch trái 4 px, vạch cam khi hover/focus/kéo (483-490). `.tabs` grid 5 cột, tab cao 44 px; `.active::after` gạch cam; `.tab-dot` ẩn mặc định, hiện khi `.unread` (541-542). |
| Feed | 549-762 | `.panel.active {display:flex}`; `.filters.more` mask mờ mép phải (555). **Bộ lọc là CSS thuần**: `.feed[data-filter=X] > :not([data-cat=X]):not([data-cat=all]) {display:none}` (578-581). `.scene-card` viền trái 3 px màu `--tone`; `.is-live` vòng sáng; `.collapsed` ẩn `.sc-sub/.sc-lines/.sc-foot/.sc-news`, hiện `.sc-sum`, xoay caret (673-675, 1045). `.sc-sub {flex: 1 0 100%; padding-left: 33px}` chiếm trọn hàng 2 (661). `.line.cont` dính liền dòng trước (688); `.who` dùng `color-mix` với `--who` (695). `.prod-chip` 26 px một dòng, `.prod-cta::before {content:"Xem "}` (727). Pill `.ev` (+ `.ev-hr/.ev-system/.ev-end`), `.ev-wrap` khi kèm chip/thẻ tin (738-760). |
| Nhân sự | 764-828 | `.staff-card.absent/.fired/.candidate/.in-scene`; `.kpi-bar > span.mid/.low`; `.mbar.energy/.mood/.stress` (+ `.low`/`.high`); `.badge.tone-*` 10 tông: ok, slack, break, info, talk, warn, danger, muted, fired, cand (818-828). |
| Sản phẩm | 830-862 | `.pcard` grid `46px 1fr`; `.pcard-buy` nền `--shopee`. |
| Bản tin | 864-908 | `.empty` dùng chung cho trạng thái rỗng; `.paper` nền giấy kẻ, masthead serif, `.paper-src(.llm)` nhãn nguồn (chỉ admin), `.paper-kpi` bảng với `.kpi-mini` và `.pct.ok/.mid/.low`; `.linkish` nút giả link. |
| Tin đồn | 910-943 | `.rumor.active/.cold`; `.rm-chain` viền trái gạch, chấm mốc `.rm-ver::before`, `.latest` cam; `.rm-text mark` nền vàng. |
| Drawer / hồ sơ | 945-1026, 1116-1122 | `.drawer` rộng `min(430px, 100vw)` trượt từ phải; `.stat` grid `110px 1fr 28px`; `.spark` SVG; `.trait` grid `96px 1fr 34px`, `.trait-base` chấm gốc, `.trait-delta.up/.down`; `.rel-bar` thanh hai chiều từ tâm; `.memories`; `.prod-chip.big`. |
| Tông v3 + thẻ tin | 1028-1074 | `.tone-news #0284c7`, `.tone-hr #7c3aed`, `.tone-gold #ca8a04` (+ nền `.sc-head` riêng); `.sc-news`, `.news-card(.compact)`, `.nc-title` clamp 2 dòng, `.cat-chip.cat-<category>` 6 màu (1058-1063); `.news-strip`, `.ns-list .nc-ic {display:none}`. |
| Lịch sử | 1076-1114 | `.history` là `<details>`; `.hist-feed .ev-text {-webkit-line-clamp: 4}` (4 dòng thay vì 2); tắt animation `fresh` (1108). |

### 3.5 Container query và breakpoint

| Điều kiện | Tác dụng | Dòng |
|---|---|---|
| `@container sidebar (max-width: 299px)` | ẩn chữ tab, tab cao 38 px, icon 17 px | 543-547 |
| `@container sidebar (max-width: 379px)` | chip sản phẩm: giấu `.prod-price`, bỏ chữ "Xem ", in giá qua `.prod-cap[data-price]::before` | 731-735 |
| `@container sidebar (max-width: 299px)` | Lịch sử: ẩn nhãn "Ngày", ô chọn chiếm trọn hàng | 1104-1107 |
| `@media (max-width: 1280px)` | `.chip-tx` tối đa 110 px, ẩn `.chip-dt` | 1130-1133 |
| `@media (max-width: 1100px)` | ẩn chữ chip 👀 | 1134-1136 |
| `@media (max-width: 899px)` — **mobile** | `.main` 1 cột 2 hàng `minmax(240px,46%)` canvas + phần còn lại sidebar; ẩn `.sb-handle`; HUD thành một hàng cuộn ngang với `pointer-events:auto`; `.chip-incident {order:-1}`; ẩn `.chip-dt`; `.popover` rộng `100% − 16px`; `.toasts` `top:44px`; ẩn `.stage-hint/.hover-tip/.prod-tip`; ticker 30 px; drawer thành bottom-sheet `88dvh` trượt từ dưới; `env(safe-area-inset-*)` cho padding | 1137-1171 |
| `@media (max-width: 420px)` | tab chữ 10.5 px cao 42 px, chân dung hồ sơ 88 px, `.stat` cột 100 px | 1172-1177 |
| `@media (prefers-reduced-motion: reduce)` | tắt mọi animation / transition | 1178-1180 |

Breakpoint **899 px** dùng chung với JS: `isMobile()` (`util.js:174`), `devbar.js:15`, `profile.js:28` — đổi một chỗ phải đổi cả bốn.

### 3.6 Ràng buộc & bẫy CSS

- Dùng `color-mix()`, container query, `100dvh`, `-webkit-line-clamp`, `backdrop-filter` → cần trình duyệt hiện đại; không có fallback (trình duyệt cũ chỉ mất tinh chỉnh, không vỡ chức năng).
- Nhiều selector phụ thuộc **tên lớp do JS tạo**: `tone-${sceneToneOf()}`, `tone-${tone}` của badge, `cat-${category}`, `toast-${tone}`, `ev-${kind}`, `ch-${channel}`, `kpi-${tone}`, `.prov.${tone}`. Thêm giá trị mới ở `labels.js` thì phải thêm CSS tương ứng, nếu không phần tử hiện màu mặc định.
- Đổi chiều cao `.hud` / `.ticker` không cần sửa JS: `syncInsets` đo bằng `getBoundingClientRect` (`main.js:65-70`).

---

## 4. HUD (`public/js/ui/hud.js`, 345 dòng)

Vai trò: HUD mỏng nổi trên canvas thay thanh trên cùng cũ (v2): đồng hồ + tiến độ ngày (trái), chip 🚀 💰 👀 (+ 🔥/📶 sự cố, + 🤖 chỉ admin) (phải), **một** popover dùng chung. Không có chip sếp — biển "ĐI VẮNG" nằm trong canvas. Export: `initHud()`.

Luồng (`hud.js:23-28`): `hello` → reset `lastClockKey`, `renderClock()`, `renderStatus()`; `frame` → `renderClock`; `status` → `renderStatus`; `conn` ≠ `'open'` → `#clock-day` = "Mất kết nối…" nếu đã `store.ready`, ngược lại "Đang kết nối…".

### 4.1 Đồng hồ (`renderClock`, 120-139)

- Khoá chống vẽ lại: `${floor(minute)}|${day}|${speed}|${timeMode}` — chạy mỗi frame (~5 lần/s) nhưng chỉ chạm DOM khi phút đổi.
- `#clock-time` = `fmtClock(minute)` (HH:MM); `#clock-day` = `"{weekday ≤ 20} · Ngày {day}"`.
- `#clock-fill` width = `clamp((minute − DAY_START_MIN)/(DAY_END_MIN − DAY_START_MIN), 0, 1)` với `DAY_START_MIN = 450` (07:30), `DAY_END_MIN = 1110` (18:30) (`labels.js:33-34`).
- `#clock-speed`: `timeMode === 'realtime'` → "🕒 giờ thật"; `speed > 1` → "x{speed}"; còn lại ẩn (130-133).
- Lớp `.night` trên `#hud-clock` khi `isNight || minute ≥ 1110 || minute < 420` (134-135). `aria-label` đầy đủ (136).
- Cuối hàm vẽ lại chip dự án (vì "còn N ngày" phụ thuộc ngày) và popover dự án nếu đang mở (138).

### 4.2 Chấm AI (`renderAiDot`, 209-218)

`#ai-dot` thêm `.on` khi `ai.mode === 'llm'`, `.off` khi có `ai` mà không phải llm; `aria-label`/`title`: "Thoại: AI đang viết (online)" / "Thoại: câu mẫu (AI offline)" / "Thoại: đang kiểm tra". Đây là **thứ duy nhất** về hệ thống mà người xem thường thấy (README §3.6).

### 4.3 Chip (`renderStatus`, 149-180; `chipContent`, 142-147)

`chipContent(chip, icon, text, detail)` dựng `.chip-ic` / `.chip-tx` / `.chip-dt` (detail ẩn ở ≤ 1280 px).

| Chip | Nội dung | Lớp trạng thái | Popover |
|---|---|---|---|
| 🚀 `#chip-project` (`renderProject`, 220-232) | `"{progress}%"` + detail `"còn N ngày" / "hạn hôm nay!" / "trễ N ngày"` (left = `deadlineDay − clock.day`); không có dự án → "🚀 —" | `.overdue` (left < 0), `.due` (left === 0) | `projectPop` (239-253): tiêu đề ≤ 80, "Khách:", mô tả ≤ 220, `tip-bar` (bad khi trễ, ok khi ≥ 100 %), "Tiến độ N% · hạn ngày D · còn N ngày / HẠN CHÓT HÔM NAY! / trễ hạn N ngày 😱" |
| 💰 `#chip-revenue` | `"{revenueMonth}/{revenueTarget} tr"` (`fmtNum` vi-VN) | `.ok` khi `revenueTarget > 0 && revenueMonth ≥ revenueTarget` (`hud.js:157`) — **`style.css` không có rule `.chip-revenue.ok`** (grep `chip-revenue` → 0), lớp chết phía JS (Câu hỏi còn mở 1) | `revenuePop` (255-264): "X triệu / mục tiêu Y triệu (P%)", thanh, dòng "Đã bàn giao N dự án. Sales chốt deal là doanh thu nhảy số ngay." |
| 🔥/📶 `#chip-incident` (160-172) | `company.incident === 'server_down'` → "🔥 Sập server"; `'wifi_down'` → "📶 Mất wifi"; khác → ẩn (và đóng popover nếu đang mở chip này) | `className` đặt lại hoàn toàn: `chip chip-incident danger` / `warn` | `incidentPop` (333-345): hai đoạn văn mô tả cố định |
| 👀 `#chip-viewers` | `fmtNum(viewers)` | — | `viewersPop` (266-272): "👀 N người đang xem trực tiếp"; dòng "🛒 N lượt bấm link tiếp thị liên kết" **chỉ khi `store.dev`** |
| 🤖 `#chip-ai` (`renderAi`, 183-206) | xem §4.5 | `.offline/.over/.backup` | `aiPop` (275-331) chỉ khi `store.dev`, ngược lại `[]` (113) |

### 4.4 Popover dùng chung (`initHud` 30-62; `open/close/position/renderPop` 65-117)

- Mở **tạm** khi `mouseover` chip (nếu chưa ghim và khác chip đang mở) hoặc `focusin`; **ghim** (`pinned`) khi click; click lại chip đang ghim → đóng. `open(chip, pin)` tính `pinned = pin || (pinned && openChip === chip)` (`hud.js:74`): rê chuột / focus lại **chính chip đang ghim** vẫn giữ ghim, mở sang chip khác thì bỏ ghim.
- Rời chuột khỏi chip (không sang popover) → `scheduleClose()` trễ **140 ms** (67); vào popover thì huỷ hẹn; rời popover (không ghim) → hẹn đóng. `focusout` ra ngoài chips/popover → hẹn đóng.
- Đóng khi `pointerdown` ngoài chips/popover (54-56), `Escape` (trả focus về chip, 57-59). `resize`, cuộn `#chips`, cuộn `#hud` → chỉ **định vị lại** (60-62). Feed tự cuộn **không** đóng popover (chú thích đầu file).
- `position()` (89-101): căn mép phải popover theo mép phải chip, kẹp `x ∈ [8, stageW − pw − 8]`; `y = chip.bottom + 6`; lật lên trên nếu không đủ chỗ dưới (cách mép 8 px).
- `renderPop()` (103-117) `switch (openChip.id)`; `renderStatus` vẽ lại + định vị lại popover đang mở (179).

Thêm chip mới: thêm `<button class="chip" id="chip-x">` vào `#chips` (`index.html`), thêm hàm vẽ trong `renderStatus`, thêm `case 'chip-x'` trong `renderPop`, thêm CSS `.chip-x.*`.

### 4.5 Chip 🤖 AI — chỉ admin (`renderAi`, 183-206; `aiPop`, 275-331)

- `!store.dev` → `chip.hidden = true` (và đóng popover nếu đang mở chip này). Không có `ai` → "🤖 …".
- `ai.mode === 'llm'` → `"🤖 {aiProviderName(ai)}"` + detail `"{calls} lượt"`; `.over` khi `budgetUsd > 0 && costTodayUsd ≥ budgetUsd`; `.backup` khi có `providers[0]`, có `activeProvider` khác rỗng **và** `providers[0].label !== activeProvider` (đang chạy nguồn dự phòng; server cũ không gửi `activeProvider` thì không bao giờ có `.backup`) (197-200). Offline → "🧪 Offline · câu thoại mẫu", lớp `.offline`. `aria-label = aiFullLabel(ai, fmtNum, fmtUsdShort)` → "AI · Gemini · <model> · N lượt · $0" (`labels.js:185-190`).
- `aiProviderName(ai)` (`labels.js:173-182`): ưu tiên `activeProvider` (≤ 24); server cũ chỉ gửi model thì suy: gemini → "Gemini"; `gpt-`/`o1-9`/`chatgpt` → "OpenAI"; claude → "Claude"; llama|mixtral|gpt-oss|qwen|deepseek → "Groq"; khác → "AI". **Không bao giờ ghi "GPT"** nếu không phải OpenAI (yêu cầu `ui-polish-todo.md` §3).
- `aiPop` nhánh offline: tiêu đề "🧪 Chế độ OFFLINE — câu thoại mẫu"; câu giải thích tuỳ có nguồn hay chưa (nhắc tên biến `AI_<NAME>_API_KEY`); danh sách ≤ 6 nguồn với `providerStateLabel(p, now)` (`labels.js:193-203`: "nghỉ tới HH:MM (lý do)" khi `cooldownUntil > now` → tông `cool`; "chưa sẵn sàng"/`cooldownReason` khi `enabled === false` → `off`; "sẵn sàng" → `ok`); "Lỗi gần nhất" ≤ 200.
- Nhánh llm: tiêu đề "🤖 " + `aiFullLabel`; "Nguồn AI (theo thứ tự ưu tiên)" ≤ 6 dòng `.prov` {tên ≤ 24, vai "đang dùng" / "ưu tiên · đang nghỉ" / "dự phòng", meta `"{model ≤ 48} · {rpdUsed}/{rpdLimit|∞} lượt · {tpdUsed}/{tpdLimit} token"` (`fmtTokens`), trạng thái}; bảng "Thống kê" 6 hàng: Lượt gọi hôm nay (lỗi N), Token vào (+ cache), Token ra, Chi phí hôm nay / ngân sách (`fmtUsdShort` / `fmtUsd(…, 2)`), Tổng chi phí, Cảnh bỏ qua (tiết kiệm); cảnh báo "⚠️ Đã chạm trần chi phí hôm nay…" khi vượt ngân sách; "Lỗi gần nhất" ≤ 200. Dữ liệu từ `UsageStats`/`ProviderStats` (`src/types.ts:359-396`).

---

## 5. Sidebar: kéo rộng, thu gọn, ticker (`public/js/ui/sidebar.js`, 129 dòng)

Export: `initSidebar()`, `onSidebarToggle(fn)`, `isCollapsed()`, `sidebarWidth()`, hằng `SB_MIN = 260`, `SB_MAX = 520`, `SB_DEFAULT = 320` (dòng 8).

| Tính năng | Hành vi | Dòng |
|---|---|---|
| Khởi động | đọc `vpa.sidebar.w` (kẹp 260–520, hỏng → 320) → `applyWidth` đặt `--sidebar-w` trên `#main` + `aria-valuenow`; `setCollapsed(lsGet('vpa.sidebar.collapsed') === '1', false)` | 27-29, 79-83 |
| Kéo | `pointerdown` nút trái trên `#sb-handle`, bỏ qua nếu `isMobile()`; `setPointerCapture`; `body.resizing`; độ rộng mới = `sw − (clientX − sx)` (kéo sang trái = rộng hơn), kẹp 260–520; lưu khi nhả | 32-49 |
| Bấm đúp | về 320 và lưu | 50 |
| Phím trên tay kéo | ArrowLeft +20 px, ArrowRight −20 px, Home → 520, End → 260 | 51-57 |
| Thu gọn / mở lại (`setCollapsed`) | toggle `body.sb-collapsed` (CSS ẩn sidebar, canvas tràn), `#ticker.hidden = !collapsed`, `aria-expanded` trên `#sb-collapse`, lưu nếu `persist`, bật/tắt ticker, gọi mọi listener `onSidebarToggle(collapsed)`, chuyển focus sang nút tương ứng khi do người dùng bấm | 85-94 |
| Ticker | `TK_MAX = 3` mục, `TK_EVERY = 4500` ms. Học từ 40 dòng cuối `hello.log`, theo dõi `store.on('log')`. `pushTicker` bỏ `scene_start/scene_end` và dòng không có text; `line` → icon theo kênh (📱 group, 🏢 company, 💬 office) + `who` ≤ 40 + text ≤ 220; sự kiện → icon riêng (≤ 8) + `stripIcon(text)`. `renderTicker` chỉ vẽ khi đang thu gọn; rỗng → "Văn phòng còn yên ắng…". `startTicker` xoay vòng mỗi 4,5 s, đứng yên khi `document.visibilityState === 'hidden'` hoặc < 2 mục | 16-17, 63-71, 97-129 |

Ai nghe `onSidebarToggle`: feed (cuộn xuống cuối khi mở lại, `feed.js:49`), main (`syncInsets`, `main.js:76`). Listeners là `Set` cấp module nên đăng ký trước/sau `initSidebar` đều được. Trên mobile không kéo được nhưng vẫn thu gọn được (ticker 30 px, `style.css:1167`). `isCollapsed()` và `sidebarWidth()` hiện không có nơi nào gọi.

---

## 6. Tabs và chấm "có tin mới" (`public/js/ui/tabs.js`, 46 dòng)

Export: `initTabs(root)` → `{ activate(name, focus = false) }`; `onTab(fn)`; `currentTab()`; `markUnread(name)`.

- Tìm `[data-tab]` / `[data-panel]` trong `root` (6-7). `activate` đặt `.active`, `aria-selected`, roving `tabIndex` (0 cho tab đang chọn, −1 còn lại), **xoá `.unread`** khi vào tab, toggle `.active` trên panel, gọi mọi handler `onTab(name)` (8-22). Tab mặc định `'live'` (3).
- Phím ArrowLeft/ArrowRight xoay vòng và focus (25-29).
- `markUnread(name)` không làm gì nếu đang ở chính tab đó (44); chỉ thêm lớp `.unread` — chấm đỏ chỉ hiện ở tab có DOM `.tab-dot` (recap, rumors; `index.html:87-88`). Gọi cho tab khác sẽ thêm lớp mà không hiện gì.
- Ai gọi: `recaps.js:21` (`markUnread('recap')` khi có `recap` mới), `rumors.js:21` (`markUnread('rumors')` khi chữ ký tin đồn đổi), `feed.js:48` (`onTab` → cuộn cuối khi quay lại live), `main.js:37, 119` (`tabs.activate` từ bảng KPI trên canvas và deep link). `currentTab()` không có nơi nào dùng.

---

## 7. Feed "Trực tiếp" (`public/js/ui/feed.js`, 495 dòng)

Vai trò: gom thoại theo **thẻ cảnh** (mỗi cảnh một thẻ chứa các dòng của nó; hai cảnh song song không xen kẽ dòng); đồng thời là bộ vẽ dùng chung `createFeedView(root, opts)` cho trang Lịch sử (chế độ chỉ đọc). Export: `initFeed(openProfile)`, `createFeedView(root, { live, onOpenProfile })`.

Hằng số (17-19): `MAX_LINES = 300` (tổng dòng thoại trong DOM, chế độ live), `MAX_TOP = 180` (phần tử cấp 1: thẻ, pill, ngăn ngày), `KEEP_OPEN = 2` (số thẻ đã xong gần nhất vẫn mở). `nearBottom()` = cách đáy < 90 px (108-110). Nối dòng cùng người nói khi cùng ngày và cách ≤ 3 phút (443).

### 7.1 `initFeed` (26-73)

- Tạo view live; chip lọc từ `FEED_FILTERS` (`labels.js:55-61`: all / office / group / company / event) với `aria-pressed`; `syncMore()` toggle `.more` khi hàng chip còn tràn > 4 px (ResizeObserver + scroll).
- Theo dõi cuộn: `follow = nearBottom()` **chỉ đổi khi chính người xem cuộn** (41-44); `document.fonts.ready` → cuộn lại nếu đang theo dõi (46); `#new-msgs` → `scrollToBottom(true)`; `onTab('live')` và `onSidebarToggle(false)` → cuộn cuối ở frame sau.
- `hello`: `view.clear()`, append toàn bộ `msg.log` với `fresh = false`, chèn `emptyNote()` nếu rỗng, `updateScene` cho mọi `store.scenes`, `trim`, `autoCollapse`, `follow = true`, cuộn cuối (51-63).
- `log`: gỡ `.feed-empty`, `stick = follow || nearBottom()`, append `fresh = true`, trim, cuộn nếu `stick`, ngược lại tăng `unread` nếu `matchesFilter(entry)` → nút "▼ N tin mới" (64-71, 119-122). `scene` → `view.updateScene(sc)`.

### 7.2 Bộ lọc (82-106)

`setFilter(key)` đặt `feed.dataset.filter`, CSS làm phần còn lại (§3.4); reset unread, cuộn cuối. `catOf(e)`: `line` → `channel || 'office'`; `scene_start/scene_end` → `store.sceneMeta.get(sceneId).channel || e.channel || 'office'`; còn lại → `'event'`. `store.sceneMeta` được nạp từ `hello.scenes` và mỗi thông điệp `scene` (`rememberScene`, `store.js:234-242`, gọi tại 330 và 359) và bị **cắt còn 300 cảnh** (xoá cảnh chèn sớm nhất, `store.js:238-241`); cảnh cũ hơn rơi về `e.channel` ở đây và về `guessScene` ở `startCard` (§7.4) — tông / tiêu đề có thể kém chính xác nhưng không mất dòng. **Bẫy**: mọi phần tử cấp 1 trong feed phải có `data-cat` (`day-sep` mang `data-cat="all"` nên luôn hiện); quên là phần tử biến mất khi lọc.

### 7.3 `createFeedView` (132-166)

Trạng thái `v = { root, live, cards: Map(sceneId → card), lastDay, lineTotal, seq, openProfile }`. Click uỷ quyền trên `root`: bỏ qua nếu nằm trong `<a>` (link sản phẩm / bài báo), `[data-agent]` → mở hồ sơ, `.sc-head` → toggle thu gọn thủ công (`card.userToggled = true`). API trả về: `lineTotal`, `cardCount`, `append(entry, fresh)`, `clear()`, `updateScene(sc)`, `trim()`, `autoCollapse()`, `setAllCollapsed(c)`, `collapseFresh()` (hai hàm cuối cho Lịch sử).

Bố cục hai vùng (169-178): vùng "đã xong" ở trên, vùng "đang diễn" (`.is-live`) luôn ở cuối; `insertSettled` chèn ngay trước thẻ live đầu tiên. `live = false` không có vùng live.

- `trim` (180-191, chỉ live): xoá từ đầu khi `lineTotal > 300` hoặc `childElementCount > 180`; dừng khi gặp `.is-live`; trừ `lineCount` của thẻ, trừ 1 cho `.loose`. `lineTotal` không đếm pill.
- `autoCollapse` (194-204, chỉ live): các thẻ đã xong trừ 2 thẻ cuối → thu gọn, bỏ qua thẻ `userToggled`.
- `sumText` (207-213): `"HH:MM · {summary | 🗞️ news.title | đang diễn · N câu | N câu thoại}"`.
- Ngăn ngày (223-241): khi `e.day` đổi chèn `.day-sep[data-cat=all]` "Thứ X · Ngày N"; thứ lấy từ `store.clock.weekday` nếu cùng ngày, rỗng nếu `timeMode === 'realtime'`, ngược lại `WEEKDAYS[(day − 1) % 5]` (Thứ Hai..Thứ Sáu — **giả định tuần làm việc 5 ngày liên tục**).

### 7.4 Thẻ cảnh — cấu trúc và vòng đời

```
article.scene-card.tone-<tone>.ch-<channel>[.is-live][.collapsed][.has-news][data-scene][data-cat]
├─ button.sc-head[aria-expanded]
│   ├─ span.sc-icon            icon cảnh
│   ├─ div.sc-main             div.sc-title (≤ 90, clamp 2 dòng) + div.sc-sum (chỉ hiện khi gọn)
│   ├─ div.sc-avs              ≤ 6 avatar người tham gia (button.av-btn[data-agent])
│   ├─ span.sc-caret ▼
│   └─ div.sc-sub              hàng 2: 📍 nơi (≤ 60) · badge kênh (CHANNEL_BADGE, trừ office) · <time> · "Đang diễn" | "· đã xong"
├─ div.sc-news[hidden]         thẻ tin gốc (news_chat) — ngoài <button> để link bấm được
├─ div.sc-lines                các dòng thoại
└─ div.sc-foot[hidden]         "🎬 tóm tắt" (≤ 300) khi cảnh xong
```

- `ICON_TYPE` (260-264) ánh xạ 16 icon → loại cảnh để **đoán lại tông màu** cho cảnh đã diễn trước khi mở trang (`guessScene`, 265-276: tách `text` theo `" · "`, ≥ 3 phần → tiêu đề = các phần đầu, địa điểm = phần cuối).
- `fill(card, meta, e)` (301-332): icon = `meta.icon || e.icon || SCENE_DEFAULTS[type][0] || '💬'`; tiêu đề = `meta.title || stripIcon(e.text) || SCENE_DEFAULTS[type][1] || 'Cuộc trò chuyện'` (`SCENE_DEFAULTS`, `labels.js:232-239`); thẻ tin = `normNewsRef(meta.news) || normNewsRef(e.news) || card.news` → `newsCard(news, {compact: true})`; `className` tính lại toàn bộ (tone, kênh, live, collapsed, has-news); `aria-label`.
- `startCard` (334-352): `sid = e.sceneId || "anon_<id>"`; meta từ `store.sceneMeta` (live; chỉ còn ≤ 300 cảnh gần nhất, §7.2) hoặc `guessScene`; nếu đã có thẻ tạm (dòng tới trước) hoặc thẻ đang live → chỉ `fill`; nếu **id cảnh bị dùng lại** cho cảnh mới → thẻ cũ đổi khoá thành `"${sid}#${e.id}"` (339-345) — đừng dựa vào `cards.get(sid)` để tìm thẻ cũ; `card.live = store.scenes.has(sceneId)` (chỉ live mode); thẻ live append cuối, không thì `insertSettled`.
- `finish` (354-371): bỏ `.is-live`, ghi `.sc-foot`, vẽ lại, đưa thẻ vừa xong về cuối vùng đã xong, `autoCollapse`. `endCard` (373-382): không có thẻ → pill `.ev.ev-end` "🎬 …".
- `updateSceneCard` (384-401, chỉ live): `status === 'end'` → `finish` (nếu đang live) hoặc `fill`; ngược lại đặt live, append cuối, mở thẻ nếu đang gọn và chưa ai đụng.

### 7.5 Dòng thoại (`addLine` 404-432, `lineNode` 434-462)

- Dòng mang `sceneId` chưa có thẻ (cảnh bắt đầu trước cửa sổ `hello.log` 200 dòng — `LOG_KEEP`, `src/sim/world.ts:38` — hoặc thẻ đã bị cắt) → thẻ tạm tên theo kênh: "Nhóm chat kín" 📱 / "Nhóm công ty" 🏢 / "Cuộc trò chuyện" 💬 (409-416). Dòng không có `sceneId` → bọc `.loose.ch-X[data-cat]`.
- Dòng mới vào thẻ đang gọn: live và chưa ai đụng → mở thẻ; ngược lại chỉ cập nhật tóm tắt (423-426).
- `lineNode`: tên `str(speakerName || store.name(speaker), 40)`; vai "Ứng viên · role" / "role (đã nghỉ)" / role; dòng nối (`cont`) bỏ hàng meta và avatar (thay `.av-gap`); `data-id = e.id`; `productChip(e.product)`; thêm avatar người nói vào `.sc-avs` nếu thẻ không có danh sách participants (≤ 6).

```
div.line.ch-<channel>[.cont][data-id]
├─ button.av-btn[data-agent] > span.av (22 px)      | span.av-gap khi cont
└─ div.body
    ├─ div.meta   button.who[style=--who] · span.role · span.line-icon · time.when   (bỏ khi cont)
    ├─ div.text
    └─ div.prod  (nếu e.product)
```

### 7.6 Chip sản phẩm (`productChip`, 464-481)

Cần `p.name`; `url = safeProductUrl(p.url)`; `a.prod-chip[target=_blank][rel="noopener sponsored"][title]` hoặc `span.prod-chip` nếu không có link. Nội dung: `.prod-emoji` (≤ 8) · `.prod-name` (≤ 80) · `.prod-price` "· giá" (≤ 20) · `.prod-cta` "Shopee ↗" (CSS thêm "Xem " khi bảng ≥ 380 px). Bọc trong `.prod` kèm `.prod-cap[data-price]` "Link tiếp thị liên kết" (bảng hẹp in giá ở đây). Chuỗi chú thích tiếp thị **không được bỏ** (yêu cầu pháp lý / affiliate). Server đã chuyển `url` thành `/go/<id>?src=scene` (`toPublic(s.product, 'scene')`, `src/sim/director.ts:1460`; kiểu `ProductPublic.url`, `src/types.ts:166-169`); client giữ nguyên `src` (chỉ lọc qua `safeProductUrl`, `feed.js:466`) — xem bảng `src` ở §1.2.

### 7.7 Pill sự kiện (`eventNode`, 484-495) và thẻ quyết định nhân sự

`kind`: `hr` → `.ev-hr` (vàng), `system` → `.ev-system` (xám), còn lại `.ev-event` (cam); `title` khi text > 70 ký tự; text ≤ 300 qua `stripIcon`; kèm `productChip` và/hoặc `newsCard(e.news, {compact, caption: false})` → bọc `.ev-wrap[data-cat=event]`. Trong luồng trực tiếp, dòng ⚠️ cảnh cáo / ⚖️ quyết định / 🚪 xin nghỉ do server ghi với `kind: 'hr'` nên tự thành pill vàng. Ở Lịch sử, bản ghi archive `hr` có `decisions[]` được `history.js` đổi thành pill ⚖️ "Quyết định nhân sự: {icon} {tên}: {nhãn HR_ACTION_LABELS} — lý do" (§11.2).

### 7.8 Tông màu theo loại cảnh (`sceneToneOf`, `labels.js:214-229`; CSS 632-636, 1029-1041)

| Tông | Loại cảnh | Màu `--tone` |
|---|---|---|
| `hot` | `HOT_SCENES`: boss_catch, firing, hr_warning, incident, confront, layoff | `--danger` đỏ |
| `happy` | `HAPPY_SCENES`: celebration, welcome, pingpong_match | `--ok` xanh |
| `shop` | `SHOP_SCENES`: showroom_chat | `--shopee` |
| `news` | news_chat | `#0284c7` |
| `hr` | hr_review, resign_talk, raise_request | `#7c3aed` |
| `gold` | promotion | `#ca8a04` |
| `group` / `company` / `office` | loại khác → theo kênh | `--group` / `--company` / `--accent` |

Thêm `SceneType` mới: cập nhật `sceneToneOf` (hoặc một `Set`), `SCENE_DEFAULTS` (icon/tiêu đề dự phòng), `ICON_TYPE` trong feed.js (đoán từ icon), và CSS `.scene-card.tone-<x>` + `.tone-<x> .sc-head`.

---

## 8. Tab "Nhân sự" (`public/js/ui/staff.js`, 120 dòng)

Export: `initStaff(openProfile)`. Thẻ từng người theo `store.roster()` (active → candidate → fired, rồi `ROLE_ORDER`, rồi `hiredDay`; `store.js:47-53`), cập nhật **tại chỗ** theo `agents` (mỗi 2 s hoặc khi dirty). `#staff` ← `.staff-summary` + `.staff-list` (14-16). Click / Enter / Space trên `.staff-card` → `openProfile(dataset.id)` (17-25). `hello` → xoá cache thẻ, vẽ lại (26).

- `buildCard` (35-60): `.staff-card[data-id][tabindex=0][role=button]` → `.st-top` {`.st-portrait` (`portraitEl(a, 46)` chân dung chibi canvas), `.st-id` {`.st-name` {tên, `.warn-chip`}, `.st-role`}, `.badge`}, `.st-act`, `.st-kpi` {nhãn "KPI", `.kpi-bar > span`, `.kpi-num`}, `.st-mini` 3 thanh ⚡/😊/😰, `.risk[hidden]`. Lưu `look` (JSON) + `status` để chỉ vẽ lại chân dung khi đổi (70-74).
- `render` (62-88): xoá thẻ của id không còn; chèn đúng vị trí `list.children[i]`; tổng kết "👥 N nhân sự" (active), "🟢 N có mặt" (active && present), "📊 KPI TB x%" (trung bình `kpiToday/kpiTarget` của active không phải boss).
- `update` (90-120): badge = `statusBadge(a)` (§16); hoạt động = `emote + activityText(a)` (emote chỉ khi present); KPI width = ratio kẹp 0..1, lớp `kpiPaceTone(ratio, clock.minute, rules.kpiLowRatio)` (so với phần ngày làm việc đã trôi 08:00→17:30 trừ trưa 12:00–13:00; < 6 % ngày → luôn `ok`; `labels.js:16-31`), `title` giải thích; `.kpi-num` "kpi/target · x%"; thanh phụ (`energy.low` < 30, `stress.high` > 70); `.warn-chip` "⚠️ N" khi `warnings > 0`; `.risk` "🔥 nguy cơ bị đuổi · KPI thấp N ngày liền" khi active, không boss/hr và `lowStreak ≥ store.rules.kpiWarnDays` (112-114); lớp `.absent/.fired/.candidate/.in-scene`; `aria-label`.

Bẫy: ngưỡng lấy từ `store.rules` (`hello.rules`, mặc định 0.7 / 2 / 3, `store.js:14, 348-352`), **không hard-code**. Chân dung do `render/character.js` vẽ — phụ thuộc vùng canvas.

---

## 9. Hồ sơ nhân viên (`public/js/ui/profile.js`, 214 dòng)

Export: `initProfile(locate)`, `openProfile(id)`, `closeProfile()`. Ngăn kéo bên phải (`.drawer`), mobile là bottom-sheet.

- Khởi động (14-32): đóng bằng nút ✕, `Escape`, bấm nền (bỏ qua click nền trong **500 ms** đầu để chống "ghost click" sau touchend, 20-22); click trong drawer: `[data-agent]` **khác** `current` → mở hồ sơ người đó (trùng hồ sơ đang mở thì bỏ qua, `profile.js:26`); `.rel-more` → toggle `showAllRel`; `.locate-btn` → `onLocate(current)` (= `office.focusAgent`) và đóng drawer nếu mobile (28). `agents` → `render(true)` (giữ `scrollTop`); `hello` → đóng nếu agent không còn, ngược lại vẽ lại.
- `openProfile` (34-47): chỉ khi `store.agents.has(id)`; nhớ `lastFocus`; `.open`, `aria-hidden=false`, backdrop `.show` ở frame sau; focus nút đóng. `closeProfile` (49-56): gỡ lớp, ẩn backdrop sau 250 ms nếu không mở lại, trả focus.
- `render(keepScroll)` (124-214), các khối theo thứ tự:

| Khối | Nội dung | Dòng |
|---|---|---|
| `.pf-hero` | `portraitEl(a, 104, true)`; tên ≤ 40; `fullName` ≤ 60; "role · N tuổi · Nữ/Nam" (`gender === 'nữ'` → Nữ, **mọi giá trị khác → Nam**); huy hiệu: trạng thái (`statusBadge`), "⚠️ N lần cảnh cáo", "⏳ đang thử thách tới ngày N" (active và `probationUntilDay ≥ clock.day`), "🔥 nguy cơ bị đuổi" (không boss/hr, `lowStreak ≥ kpiWarnDays`), "🎁 N lần được thưởng", "🎖️ N lần thăng chức"; "Vào làm từ ngày N"; nút "📍 Xem trên bản đồ" chỉ khi `present` | 149-163 |
| `.pf-bio` | bio ≤ 600 | 164 |
| "⚡ Bây giờ" | emote (🏠 nếu vắng) + `activityText`; 3 `statBar` (năng lượng `.low` < 30, tâm trạng `.low` < 35, căng thẳng `.low` > 70); "KPI hôm nay" `kpi-bar.big` với `kpiPaceTone`; "😱 Bị sếp bắt quả tang N lần hôm nay"; "📉 KPI thấp N ngày liên tiếp" | 165-174 |
| "📈 Lịch sử KPI" | `sparkline(a.kpiHistory)` (70-108): SVG viewBox 300×92, padding 8, lề phải `GUT = 46`; **14 điểm cuối**; trục y tới `max(1.3, max ratio)`; vùng xanh dưới 100 %, vạch xanh đứt 100 %, vạch vàng đứt tại `rules.kpiLowRatio`; điểm xanh (≥ 1) / vàng (≥ low) / đỏ với `<title>` "Ngày N: x%"; rỗng → "Chưa có dữ liệu — KPI được chấm cuối ngày" | 175 |
| "🧬 Tính cách" | 6 thanh theo `TRAIT_LABELS` (`labels.js:69-76`), giá trị 0..1 → "x/10"; chấm đen `.trait-base` tại `traitBase[k]` (kẹp 4 %..96 %) và ▲/▼ khi lệch ≥ 1/10; ghi chú khi có `traitBase` | 176-190 |
| "🎭 Thói quen & sở thích" | quirks ≤ 6 (mỗi ≤ 140), likes/dislikes ≤ 8 (tag 💚/💔, ≤ 40) | 191-195 |
| "💞 Quan hệ" | lọc id còn trong `store.agents` hoặc `nameCache`; bạn (score > 0, giảm dần) và không ưa (score < 0, tăng dần); mỗi nhóm 3 người trừ khi `showAllRel`; nút "Xem tất cả (N)" / "Thu gọn"; `relRow` (110-122) thanh hai chiều từ tâm, width = `|score|/2 %`, ghi chú ≤ 140 | 196-199 |
| "🧠 Ký ức gần đây" | 10 mục mới nhất (sắp theo `day*1440 + minute`), text ≤ 200 | 200-203 |
| "🛍️ Món đồ trên bàn" | khi `deskItem.name`: `prod-chip.big` (link `/go/<id>?src=desk` do **server** đặt — `toPublic(p, 'desk')`, `src/sim/world.ts:2799`; client chỉ lọc qua `safeProductUrl` (`profile.js:138`), không đổi `src`; `rel="noopener sponsored"`) + "Link tiếp thị liên kết" | 204-211 |

Bẫy: `render` được gọi lại **mỗi 2 s** khi drawer mở (sự kiện `agents`) và dựng lại toàn bộ DOM — giữ `scrollTop` bằng `keepScroll`. Trường v3 (`traitBase`, `probationUntilDay`, `bonuses`, `promotions`) là tuỳ chọn nên luôn qua `num(…, 0)`.

---

## 10. Tab "Sản phẩm" + tooltip kệ (`public/js/ui/products.js`, 106 dòng)

Export: `initProducts()`, `productUrl(url, src)`, `openProduct(product, src = 'showroom')`, `showProductTip(product, clientX, clientY)`. Nghe `store.on('products')` → `render` (15). Dữ liệu: `store.products` đã qua `normProduct` và cắt ≤ 60 (`store.js:92-108, 363`); `store.productsByShelf()` → `{beauty, tech}` sắp theo `slot` (`store.js:74-80`).

- `productUrl` (20-26): chỉ nhận `/go/...` (`safeProductUrl`); `src` phải khớp `^[a-z_]{1,20}$` (`products.js:23`) không thì về `'sidebar'`; thay hoặc thêm `src=`. Tab dùng `src=sidebar`; canvas gọi `openProduct(p, 'showroom')` (`main.js:34`) → `window.open(url, '_blank', 'noopener')` (`hello.products` vốn đã mang `src=showroom` từ server, `src/content/products.ts:232`). Hai nguồn còn lại (`scene`, `desk`) do server đặt, client không đụng (bảng ở §1.2). Server (`src/server.ts:329-349`) chỉ chuyển hướng id có trong danh mục, đếm click theo `src` (`GET` thôi, `HEAD` không tính) với regex **rộng hơn** client: `^[A-Za-z0-9_-]{1,32}$` (`server.ts:343`), `src` lạ → `'khac'`. Thêm nguồn mới phía client: tên phải khớp **cả hai** regex (chữ thường + `_`, ≤ 20 ký tự).
- Tooltip kệ (`showProductTip`, 37-59): `#prod-tip`; `null` → ẩn; chỉ dựng lại DOM khi đổi `id`; vị trí = con trỏ + 16 px, lật nếu tràn, kẹp trong `#stage` cách mép 8 px, đặt bằng `transform: translate`. Nội dung: `media` (61-70: `img[loading=lazy][referrerpolicy=no-referrer]`, lỗi ảnh → emoji), tên ≤ 90, giá ≤ 24, "Bấm để xem trên Shopee ↗" / "Chưa có link", "Link tiếp thị liên kết". Trên mobile CSS ẩn `.prod-tip` dù JS vẫn dựng.
- Tab (`card`/`render`, 72-106): rỗng → `.empty` 3 dòng; `.products-note`; mỗi kệ `section.pg.pg-<shelf>` tiêu đề từ `SHELF_LABELS` (`labels.js:167`: 💄 Làm đẹp / 🔌 Công nghệ) + "N món"; `.pcard` {ảnh/emoji, tên, giá, ghi chú trong ngoặc kép, `a.pcard-buy[rel="noopener sponsored"]` "🛒 Mua trên Shopee ↗", `.pcard-cap`}.

Bẫy: **không bao giờ** nhúng URL Shopee thẳng vào DOM — mọi link đi qua `/go/<id>` của server (đếm click, chống open redirect). Danh mục sản phẩm và chỗ trống còn lại xem [09-cau-hinh-du-lieu.md](./09-cau-hinh-du-lieu.md) và [13-viec-con-lai-va-y-tuong.md](./13-viec-con-lai-va-y-tuong.md).

---

## 11. Tab "Bản tin": Tin đang bàn, Lịch sử, tờ báo

Ba module vẽ vào ba vùng con của `#recaps` theo thứ tự: `#news-strip` (news.js) → `details#history` (history.js) → `#recap-list` (recaps.js).

### 11.1 Thẻ tin và dải "🗞️ Tin đang bàn" (`public/js/ui/news.js`, 75 dòng)

Export: `NEWS_CAPTION` (dòng 8: "Nhân vật AI chỉ bình luận cảm nghĩ về tin đã đăng trên báo; không phải phát ngôn hay sự thật được xác nhận."), `safeNewsUrl(url)`, `categoryChip(category)`, `newsCard(news, opts)`, `initNewsStrip()`.

- `safeNewsUrl` (13-19): chuỗi ≤ 1000, không chứa khoảng trắng / `"'<>\`, parse được bằng `new URL`, protocol http/https → `u.href`; không hợp lệ → `null` (thẻ vẫn hiện, không có link).
- `newsCard` (32-47): qua `normNewsRef` (`store.js:111-122`: cần `title`; cắt title 220, source 40, url 1000, category 20; `id = id || url || title` ≤ 160) → `div.news-card[.compact][role=note]` {`.nc-top` {🗞️ `.nc-ic`, `.nc-main` {`.nc-title` (clamp 2 dòng), `.nc-meta` {"Nguồn: X", chip nhóm, `a.nc-link[target=_blank][rel=noopener]` "Đọc bài ↗"}}}, `.nc-cap` caption trừ khi `opts.caption === false`}.
- `categoryChip` dùng `NEWS_CATEGORIES` (`labels.js:242-249`: bong_da ⚽, the_thao 🏅, cong_nghe 💻, game 🎮, khoa_hoc 🔬, giai_tri 🎬); nhóm lạ → không chip. CSS `.cat-<category>` (`style.css:1058-1063`).
- Dải (52-75): `STRIP_MAX = 5`; nghe `news` và `hello`; `store.news` (≤ 30, mới nhất cuối) đảo ngược lấy 5; rỗng → `hidden`; có → "🗞️ Tin đang bàn" + "N tin gần nhất", danh sách `newsCard(n, {caption: false, compact: true})`, **một caption chung** ở cuối.

Ràng buộc pháp lý (nguyên tắc 5, [06-tin-tuc-thoi-su.md](./06-tin-tuc-thoi-su.md)): caption luôn đi kèm thẻ tin (trừ khi dải đã in caption chung); link bài gốc luôn hiện để người xem tự kiểm chứng. Không được bỏ.

### 11.2 Mục "🗂️ Lịch sử" (`public/js/ui/history.js`, 343 dòng)

Export: `initHistory(openProfile)`. Đọc archive `data/history/YYYY-MM-DD.jsonl` của server qua HTTP, vẽ **chỉ đọc** bằng `createFeedView(feedEl, {live: false})`. Hằng (12-16): `API = '/api/history'`, `PAGE = 300` dòng mỗi lần vẽ, `TIMEOUT_MS = 15000`, `LOG_KINDS` (6 `LogKind`), `DATE_RE = /^\d{4}-\d{2}-\d{2}$/`.

| Bước | Hành vi | Dòng |
|---|---|---|
| Khởi động | chỉ tải danh sách ngày khi `<details>` mở lần đầu (`toggle`); đổi ngày → `loadDay`; ↻ → `loadDates(true)`; "Tải thêm" → `renderPage`; "Mở hết / Thu gọn" → `view.setAllCollapsed(!expandAll)`; deep link `#history=YYYY-MM-DD` → `details.open = true`, `currentDate` | 27-53 |
| `fetchJson` | `AbortController` 15 s, `cache: 'no-store'`, `Accept: application/json`; 404 → `{status: 404, data: null}`; không ok → `data: null`; ok → `parseBody` (JSON hoặc JSONL) | 56-82 |
| Danh sách ngày (`loadDates`) | bộ đếm `req` chống kết quả cũ đè mới; `normDates` nhận chuỗi hoặc object `{date\|day\|id, count\|entries\|lines\|n}`, lọc `DATE_RE`, sắp giảm dần, khử trùng; server trả `{enabled, days: [{date, count, bytes, gz}], stats}` (`handleHistory`, `src/server.ts:292-302`) → khớp khoá `days`; client **không đọc `enabled`**: khi `HISTORY_ENABLED=false` server vẫn trả 200 với `enabled: false` và `days` = những file còn trong `HISTORY_DIR` (`listDays()` không kiểm `enabled`, chỉ `readdir`, `src/sim/archive.ts:313-345`) — thường `[]`, nhưng còn file cũ thì vẫn liệt kê ngày. 404 → "Chưa có lịch sử — Server chưa bật tính năng lưu trữ (HISTORY_ENABLED)…"; lỗi khác → "Không tải được lịch sử (lỗi N)" + Thử lại; rỗng → "Chưa có lịch sử — Nhật ký văn phòng sẽ được lưu từng ngày…". Nhãn ô chọn `fmtDate` (214-218): "Hôm nay · 01/11 · 154 dòng" / "Thứ Bảy 31/10 · 315 dòng" (`WEEKDAYS_FULL` theo `Date.getDay()`; thêm `/yyyy` nếu khác năm). Chọn `currentDate` nếu còn, không thì ngày mới nhất | 91-101, 251-289 |
| Một ngày (`loadDay`) | `GET /api/history?date=…` (**không** truyền `offset/limit`); server trả `{date, offset, limit, count, entries: [{ts, kind, data}]}` tối đa `HISTORY_READ_MAX = 5000` (`src/sim/archive.ts:20`, `server.ts:306`), **429** kèm `Retry-After: 3` khi quá `HISTORY_MAX_INFLIGHT = 3` yêu cầu đồng thời (`server.ts:271, 308-311`); 404 → "Ngày này chưa có dữ liệu". `entries = raw.map(toEntry).filter(Boolean)`; bản ghi thiếu ngày/phút thừa hưởng dòng trước (318-322) để KPI cuối ngày không hiện "00:00" | 291-332 |
| Chuẩn hoá (`toEntry` / `fromArchive`) | `{entry}` bọc → mở; bản ghi `{ts, kind, data}`: `log` → LogEntry giữ nguyên; `kpi` → pill `system` 📊 "KPI cuối ngày: Tên x% · …"; `hr` có `decisions[]` → pill `hr` ⚖️ "Quyết định nhân sự: {icon} {tên}: {nhãn `HR_ACTION_LABELS`} — lý do (≤ 160)"; `beat` → pill `system` 🎬 với nhãn "Biên kịch mở mạch / Mạch truyện kết / Mạch truyện tự rơi" bóc từ text; `news` / `resign` / loại lạ → bỏ (đã có trong `log`). Hỗ trợ thêm dạng phẳng: recap có `headline` → "Bản tin ngày N: …" (phút mặc định 1110), `beats[]`, `news{title}` → event 🗞️ kèm thẻ tin, `decisions[]/hrDecisions[]` | 107-196 |
| Vẽ trang (`renderPage`) | append 300 dòng tiếp theo với `fresh = false`; `collapseFresh()` nếu không "Mở hết" (thẻ mới thêm mặc định gọn); chân trang "Hiển thị a/b dòng · N cảnh"; nút "Tải thêm (còn N)" | 334-343 |

Bẫy: `view` ở chế độ `live: false` **không** bị `trim` nên một ngày lớn có thể tạo DOM nặng; `PAGE = 300` chỉ giảm tải ban đầu. Không phân trang phía server → ngày > 5000 bản ghi bị cắt âm thầm (Câu hỏi còn mở).

### 11.3 Tờ báo cuối ngày (`public/js/ui/recaps.js`, 65 dòng)

Export: `initRecaps(openProfile)`. Vẽ vào `#recap-list` (fallback `#recaps`). `store.on('recaps')` → `render` (toàn bộ, mới nhất trước theo `day`); `store.on('recap')` → `markUnread('recap')` (20-21). Click `[data-agent]` → mở hồ sơ.

`paper(r)` (36-65): masthead "BẢN TIN VĂN PHÒNG"; meta "Thứ X, Ngày N" + (chỉ `store.dev`) nhãn `.paper-src` "🤖 AI chấp bút" / "🧪 Bản tin mẫu" theo `r.source` (44); tít ≤ 200; ≤ 6 bullet (mỗi ≤ 300); hộp "🏆 Nhân viên của ngày" (avatar 30 px bấm được, lý do ≤ 240); hộp "🍿 Drama" (≤ 400); bảng KPI sắp theo `ratio` giảm dần: tên (nút `.linkish`), vai, `kpi-mini` với `kpiTone(ratio, rules.kpiLowRatio)` (**ngưỡng tuyệt đối**, khác tab Nhân sự dùng pace), "kpi/target", "x% ⚠️" nếu `lowStreak ≥ kpiWarnDays`. Dữ liệu `DayRecap` (`src/types.ts:316-325`).

Trạng thái rỗng nói "khoảng 18:30" — khớp `DAY_END_MIN` nhưng là chuỗi cứng (30).

---

## 12. Tab "Tin đồn" (`public/js/ui/rumors.js`, 120 dòng)

Export: `initRumors(openProfile)`. `hello` → `lastSig = sig()`, vẽ; `rumors` → nếu chữ ký `"id:sốPhiênBản|…"` đổi (và đã có chữ ký trước) → `markUnread('rumors')`, vẽ; `agents` → vẽ lại nếu đang có nội dung (để tên người cập nhật) (18-25). Sắp: `active` trước, rồi theo mốc phiên bản cuối `lastAt` (44-48).

- `card(r)` (96-120): `article.rumor.active|cold` → đầu đề {avatar người bị đồn 36 px, "Tin đồn về **tên**", "Từ ngày N · 👂 N người đã nghe · N phiên bản", badge "🔥 Đang lan" (`tone-danger`) / "💤 Đã lắng" (`tone-muted`)}; `ol.rm-chain` mỗi phiên bản `li.rm-ver[.latest]`: tag "Bản gốc / Lần i / Mới nhất", người kể → người nghe (`button.rm-person[data-agent]` avatar 20 px + tên), `time` "N{day} · HH:MM", `blockquote.rm-text` với `diffText(text ≤ 400, prev)`.
- `diffText` (61-94): bỏ dấu + tách từ (`noAccent`), từ đệm `STOP` (50: la, va, thi, ma, co, cua, nay, do, voi, cho, nha, oi, a, ha, the, nghe, noi) không tính là nội dung; token mới → `<mark>`; từ đệm / dấu câu chỉ tô khi nằm trong hoặc mở đầu một cụm mới; khoảng trắng tô nếu hai bên đều tô; gộp thành chuỗi text / `mark` liên tiếp — chỉ tạo text node và `<mark>` nên an toàn XSS. Dữ liệu `Rumor` (`src/types.ts:329-337`).

---

## 13. Bảng dev (`public/js/ui/devbar.js`, 63 dòng)

Export: `initDevbar(send)`. Góc dưới trái canvas, chỉ hiện khi `hello.dev = true`.

| Phần | Hành vi | Dòng |
|---|---|---|
| Trạng thái gọn | `localStorage['vpa.devbar.collapsed'] === '1'`, hoặc mặc định gọn trên mobile (`max-width: 899px`) trừ khi đã lưu `'0'`; nút "🛠️ Dev" toggle `.collapsed` + `aria-expanded` + lưu. `localStorage.getItem` ở dòng 15 **không bọc `try/catch`** (chỉ `setItem` dòng 51 có) — xem §1.6 | 15-16, 46-52 |
| Tốc độ | nút `x1 x2 x5 x10` từ `SPEEDS` (`labels.js:53`); `store.clock.timeMode === 'realtime'` → toast "Chế độ giờ thật — không tua được thời gian"; gửi `{t:'dev', action:'speed', value}`; `send` trả `false` → toast cảnh báo "Chưa kết nối server"; `highlight(v)` tô `.active` | 17-27, 61-63 |
| Sự kiện | 13 nút từ `DEV_EVENTS` (`labels.js:36-51`): boss_leave 🏌️, boss_return 🚶, server_down 🔥, wifi_down 📶, payday 💸, birthday 🎂, deal 💰, drama 🤫, hr_review 📋, release 🚀, end_day 🌙, news 🗞️, showrunner 🎬 (ý nghĩa từng nút: README §9); gửi `{t:'dev', action:'event', name}`; nháy `.sent` 600 ms; tooltip qua `data-tip` (CSS `::after`) | 28-38 |
| 🚪 Thoát admin | `window.confirm(...)` → `forgetDevToken()` (`net.js:40-45`: xoá `vpa.dev`, `POST /api/dev/logout` keepalive, `location.reload()`) | 40-43 |
| Đồng bộ | `hello` → `bar.hidden = !store.dev`, `body.has-devbar`, `highlight(status.speed || clock.speed || 1)`; `status` → `highlight` | 53-58 |

Bẫy: server **lặng lẽ bỏ** lệnh dev ở ba lớp, không lớp nào phản hồi cho client — UI vẫn nháy `.sent` vì chỉ biết `ws.send` thành công (`ws.on('message')`, `src/server.ts:469-479`):

1. `parseClientMsg` (`server.ts:225-241`) trả `null` cho tin nhị phân, JSON rỗng hoặc > `MAX_MSG_BYTES = 2048` byte (`server.ts:23`), `speed` không nằm trong `SPEEDS = [1, 2, 5, 10]` (`server.ts:52`, kiểm ở 234), hoặc `name` không nằm trong **allowlist runtime** `DEV_EVENTS: ReadonlySet<string>` (13 tên, `server.ts:48-51`, kiểm ở 237).
2. Socket không có quyền dev (`server.ts:472`, đếm bằng `noteIgnoredDev`).
3. Quá `DEV_RATE = 10 lệnh / 5000 ms` theo từng socket (`server.ts:27, 474-475`).

Vì vậy mọi `DevEventName` mới phải thêm ở **bốn** chỗ: `labels.js` `DEV_EVENTS` (nút), `src/types.ts:454-457` (kiểu), allowlist `DEV_EVENTS` trong `src/server.ts:48-51` (thiếu chỗ này thì nút mới bấm **không có tác dụng và không có lỗi nào**, kể cả ở console server), và xử lý ở `world.handleClient` (xem [03-mo-phong-the-gioi.md](./03-mo-phong-the-gioi.md)). Thêm tốc độ mới tương tự: `labels.js` `SPEEDS` **và** `server.ts:52`.

---

## 14. Toast (`public/js/ui/toasts.js`, 24 dòng)

Export: `initToasts(container)`, `toast(icon, text, tone = '')`. Tạo `.toast[.toast-<tone>][role=status]` {`.toast-icon` (icon hoặc 🔔), `.toast-text` = `stripIcon(text, icon)`}; giữ tối đa **3** toast (xoá cũ nhất, 16); `.in` ở frame sau; TTL = `min(7000, 3800 + 25 × độ dài text)` ms (18); ra bằng `.out` rồi remove sau 400 ms. Nguồn gọi: `main.js:135-138` từ `ServerMsg toast` với tông suy từ icon (`hot` nếu khớp `📦|🔥|😱|⚠️`, `happy` nếu `🎉|💰|🚀|🎂|💸`), và `devbar.js` (tone `'warn'` hoặc rỗng). Vị trí CSS `top: 48px` giữa stage, z 7 — **có thể đè bong bóng thoại trên canvas** (canvas chỉ né HUD/ticker qua `setInsets`, không biết vùng toast; chủ dự án đã ghi nhận).

---

## 15. Avatar DOM và chân dung (`public/js/ui/avatar.js`, 43 dòng)

Export: `colorOf(id)`, `avatarEl(id, name, size = 32, extraClass = '')`, `portraitEl(agent, size = 44, full = false)`.

- `avatarEl`: `span.av[aria-hidden]` màu áo từ `store.look(id).shirt` qua `safeColor`, fallback 8 màu theo `hashStr(id)` (7-12); biến CSS `--av-bg`, `--av-hair`, `--av-size`; chữ = `initial(name || store.name(id))` (chữ cái đầu của **từ cuối** tên, `util.js:90-96`); chữ tối khi `luma(bg) > 0.68` (`luma` từ `render/draw.js:61`). Dùng trong feed (22 px), tin đồn (36 / 20 px), hồ sơ quan hệ (28 px), tờ báo (30 px).
- `portraitEl`: chân dung chibi canvas qua `portrait(look, size, {full, blazer: role boss|saleslead, carry: status fired})` (`render/character.js:954`); nền `--pt-bg` màu áo; không có `look` → chữ cái. Dùng ở thẻ nhân sự (46 px) và hero hồ sơ (104 px, full). `portraitCache` (32, 41) được ghi nhưng không bao giờ đọc.

Ràng buộc: UI phụ thuộc hai export của vùng canvas (`luma`, `portrait`) — đổi chữ ký hàm bên `render/` là vỡ thẻ nhân sự / hồ sơ.

---

## 16. `public/js/labels.js` — bảng nhãn tiếng Việt và hằng số hiển thị (266 dòng)

Mọi nhãn tiếng Việt / bảng ánh xạ tập trung ở đây; thay đổi loại cảnh / kênh / hoạt động / nhóm tin / hành động HR phải đi qua file này (+ CSS tương ứng).

| Export | Dòng | Ý nghĩa | Ai dùng |
|---|---|---|---|
| `ROLE_ORDER` | 5 | thứ tự phòng ban (phải giống server) | `store.roster()` |
| `KPI_WARN_DAYS = 2` | 8 | mặc định SPEC — **không module nào import**; giá trị thật từ `hello.rules` | — |
| `kpiTone(ratio, lowRatio)` | 11-13 | `ok ≥ 1` · `mid ≥ lowRatio` · `low` (ngưỡng tuyệt đối) | chỉ `recaps.js:59` (bảng KPI tờ báo) và nội bộ `kpiPaceTone`. Bảng KPI trên tường (canvas) dùng **cùng luật** nhưng tự tính tại `render/office.js:643-660` với `store.rules.kpiLowRatio`, **không** import `kpiTone` (`office.js:19` chỉ import `slackScreenKind, workScreenKind, bossAwayLabel`) — đổi luật phải sửa cả hai chỗ |
| `workdayElapsed(minute)`, `kpiPaceTone(ratio, minute, lowRatio)` | 16-31 | phần ngày làm việc đã trôi (08:00→17:30 trừ 12:00–13:00, chia 510 phút); tông theo tiến độ, < 6 % ngày → `ok` | staff, profile, tooltip bảng KPI (main) |
| `DAY_START_MIN = 450`, `DAY_END_MIN = 1110` | 33-34 | 07:30 / 18:30 — thanh tiến độ ngày và lớp `.night` | hud |
| `DEV_EVENTS` (13), `SPEEDS = [1,2,5,10]` | 36-53 | nút bảng dev | devbar |
| `FEED_FILTERS` (5), `CHANNEL_BADGE` | 55-67 | chip lọc; badge "📱 Nhóm kín" / "🏢 Nhóm Cty" / "🏢 Văn phòng" | feed |
| `TRAIT_LABELS` (6: diligence, laziness, gossip, temper, humor, ambition + màu) | 69-76 | thanh tính cách | profile |
| `ACT` (private), `statusBadge(agent)`, `activityText(agent)` | 78-127 | activity → `[nhãn, tone]`; badge: fired → "Đã nghỉ/fired", candidate → "Ứng viên/cand", `!present && activity !== 'away'` → "Vắng/muted", slacking có `activityLabel` → nhãn rút ≤ 18 ký tự, `window` + role sales → "Gọi khách", working + "giả vờ" → "Giả vờ làm/warn"; `activityText` (`labels.js:122-127`): fired → "ôm thùng đồ ra về"; vắng với `activity === 'away'` → `activityLabel` hoặc "đi vắng"; vắng với hoạt động khác → luôn "không có mặt" (bỏ qua `activityLabel`); có mặt → `activityLabel` hoặc nhãn `ACT` viết thường | staff, profile, tooltip (main) |
| `slackScreenKind`, `workScreenKind`, `ROOM_ICONS`, `bossAwayLabel` | 130-164, 206-212 | dành cho canvas (xem 07) | render |
| `SHELF_LABELS` | 167 | 💄 Làm đẹp / 🔌 Công nghệ | products |
| `aiProviderName`, `aiFullLabel`, `providerStateLabel` | 173-203 | nhãn chip / popover AI (admin) | hud |
| `HOT_SCENES`, `HAPPY_SCENES`, `SHOP_SCENES`, `sceneToneOf`, `SCENE_DEFAULTS` | 215-239 | tông và icon/tiêu đề dự phòng của thẻ cảnh (§7.8) | feed |
| `NEWS_CATEGORIES` (6) | 242-249 | chip nhóm tin | news |
| `HR_ACTION_LABELS` (10: warn, fire, second_chance, probation, praise, bonus, promote, open_position, layoff, none) | 252-263 | pill quyết định nhân sự trong Lịch sử | history |
| `WEEKDAYS_FULL` | 266 | thứ theo `Date.getDay()` cho nhãn ngày Lịch sử | history |

---

## 17. Khả năng tiếp cận (a11y)

- Vai trò ARIA có sẵn trong HTML: `role=tablist/tab/tabpanel` (+ `aria-selected`, roving `tabIndex`, phím mũi tên — tabs.js), `role=separator` với `aria-valuemin/max/now` và phím mũi tên / Home / End trên tay kéo (sidebar.js), `role=dialog` cho popover (Esc trả focus về chip), `role=alert` banner mất kết nối, `aria-live=polite` cho feed / toast / ticker, `role=status` toast và trạng thái Lịch sử, `role=note` thẻ tin, `role=button` + `tabindex=0` + Enter/Space cho thẻ nhân sự, `aria-expanded` trên đầu thẻ cảnh / nút thu gọn / nút Dev, `aria-pressed` trên chip lọc, `aria-hidden` cho icon trang trí và avatar.
- Focus: `:focus-visible` viền cam 2 px toàn trang (`style.css:54-55`); drawer trả focus về phần tử trước khi mở (`profile.js:55`); `aria-hidden` trên drawer đổi theo trạng thái.
- Mọi phần tử bấm được là `<button type="button">` hoặc `<a>` thật (không `div onclick`), trừ `.staff-card` (`role=button` có xử lý phím).
- `prefers-reduced-motion` tắt animation; `reducedMotion()` trong `util.js:175` hiện không module nào gọi.
- Nhãn `aria-label` được cập nhật động cho chip (dự án, doanh thu, người xem, AI), đồng hồ, thẻ nhân sự, đầu thẻ cảnh.

---

## 18. Mobile (< 900 px)

- CSS: `.main` xếp dọc (canvas `minmax(240px, 46%)` trên, sidebar dưới), HUD một hàng cuộn ngang, chip sự cố nhảy lên đầu (`order: -1`), ẩn `.chip-dt`, drawer thành bottom-sheet `88dvh`, ẩn gợi ý / tooltip, ticker 30 px, `safe-area-inset` (§3.5).
- JS: `isMobile()` chặn kéo sidebar (`sidebar.js:33`); bảng dev mặc định gọn (`devbar.js:15`); bấm "📍 Xem trên bản đồ" đóng drawer để thấy canvas (`profile.js:28`); chống ghost click nền drawer 500 ms (`profile.js:22`). `products.js` vẫn dựng tooltip DOM dù CSS ẩn.
- Canvas trên điện thoại tự phóng (xem 07). Ảnh tham chiếu: `docs/preview/v2/mobile.png`, `docs/preview/v1-mobile.png`.

---

## 19. Muốn đổi X trên giao diện → sửa file nào

| Muốn đổi | Sửa ở | Lưu ý |
|---|---|---|
| Màu thương hiệu, bán kính, bóng, font | `style.css` `:root` (7-38) | `--shopee` dùng cho nút mua / tông showroom |
| Chữ / icon / thứ tự tab | `index.html:83-89` (+ `TABS` trong `main.js:23` nếu đổi tên `data-tab`) | `.tab-dot` chỉ có ở recap/rumors |
| Thêm chip HUD | `index.html` (`#chips`), `hud.js` (`renderStatus`, `renderPop`), `style.css` `.chip-x.*` | nếu là số liệu hệ thống → gate `store.dev` và kiểm `publicStatus` |
| Nội dung popover 🚀 💰 👀 🔥 🤖 | `hud.js` `projectPop/revenuePop/viewersPop/incidentPop/aiPop` | |
| Giờ bắt đầu/kết thúc thanh tiến độ ngày | `labels.js` `DAY_START_MIN/DAY_END_MIN` + chuỗi "18:30" ở `recaps.js:30` | khớp lịch server (03) |
| Độ rộng sidebar mặc định / min / max | `sidebar.js:8` + `aria-valuemin/max` ở `index.html:74` + `--sidebar-w` mặc định `style.css:36` | |
| Số mục / nhịp ticker | `sidebar.js` `TK_MAX`, `TK_EVERY` | |
| Trần DOM feed, số thẻ giữ mở | `feed.js` `MAX_LINES`, `MAX_TOP`, `KEEP_OPEN` | |
| Chip lọc feed | `labels.js` `FEED_FILTERS` + CSS `.feed[data-filter=X]` (578-581) + `catOf` | mỗi key cần một dòng CSS |
| Tông màu / icon loại cảnh mới | `labels.js` `sceneToneOf`, `SCENE_DEFAULTS`; `feed.js` `ICON_TYPE`; `style.css` `.tone-*` | xem §7.8 |
| Nhãn hoạt động / huy hiệu trạng thái | `labels.js` `ACT`, `statusBadge`, `activityText` | thêm `Activity` mới cũng cần `src/types.ts` + canvas (07) |
| Ngưỡng KPI, số ngày cảnh báo | **không sửa client** — đến từ `hello.rules` (`KPI_LOW_RATIO`, `KPI_WARN_DAYS`, `KPI_FIRE_DAYS` trong `.env`, 09) | `store.js:348-352` kẹp giá trị |
| Khối trong hồ sơ, số ký ức / quan hệ / điểm sparkline | `profile.js` `render`, `sparkline` | render lại mỗi 2 s |
| Chữ "Link tiếp thị liên kết", "Xem Shopee ↗", nút mua | `feed.js` `productChip`, `products.js` `card`/`showProductTip`, `profile.js` khối deskItem, CSS `.prod-*` / `.pcard-*` | không bỏ chú thích tiếp thị |
| Caption pháp lý thẻ tin, chip nhóm tin | `news.js` `NEWS_CAPTION`, `labels.js` `NEWS_CATEGORIES`, CSS `.cat-*` | không bỏ caption / link gốc |
| Số tin trong dải Tin đang bàn | `news.js` `STRIP_MAX`; trần `store.news` 30 ở `store.js:132` | |
| Số dòng mỗi trang Lịch sử, timeout | `history.js` `PAGE`, `TIMEOUT_MS` | server trần 5000 bản ghi |
| Nhãn quyết định nhân sự | `labels.js` `HR_ACTION_LABELS` | thêm `HrAction` mới ở `src/types.ts:214` |
| Nút / sự kiện bảng dev | `labels.js` `DEV_EVENTS`, `SPEEDS` + `src/types.ts` `DevEventName` + allowlist runtime `DEV_EVENTS` / `SPEEDS` trong `src/server.ts:48-52` + `world.handleClient` | thiếu allowlist server → lệnh bị bỏ lặng lẽ (§13) |
| Số toast đồng thời, thời gian hiện | `toasts.js:16, 18` | vị trí: `style.css:257-263` |
| Breakpoint mobile | `style.css` `@media (max-width: 899px)`, `util.js isMobile`, `devbar.js:15`, `profile.js:28` | đổi cả bốn |
| Tên công ty hiển thị | biến `COMPANY_NAME` (server) → `shortCompanyName` | không hard-code ở client |
| Khoá localStorage | `net.js:13`, `sidebar.js:6-7`, `devbar.js:10` | cập nhật §1.6 |
| Deep link mới | `main.js` `applyHash` (+ `history.js` nếu liên quan Lịch sử) | `applyHash` chạy sau `hello` nên URL đã sạch `#dev=`; module đọc hash lúc `init*` thì **chưa** (§1.6) — không log / hiển thị toàn bộ hash |

---

## 20. Kiểm thử vùng này

Không có test tự động nào chạm vào `public/` (`npm test` = typecheck TS của `src/` + smoke server + test news/llm/router; `scripts/smoke.ts` không khởi động HTTP/WS). Móc `window.__vpa` (`main.js:4`) và `canvas.__view()` (`render/office.js:1210`) dành cho QA headless nhưng **repo không có script nào dùng**. Kiểm tra hiện là **thủ công**; tối thiểu sau mỗi lần sửa:

1. Desktop ≥ 1280 px, 900–1280 px (ẩn `.chip-dt`, chữ 👀), mobile < 900 px (HUD một hàng, drawer bottom-sheet).
2. Bật / tắt admin (mở kèm `#dev=<mã>` rồi 🚪): chip 🤖, dòng lượt bấm, nhãn nguồn bản tin, bảng dev phải **biến mất hoàn toàn** khi không phải admin.
3. Thu gọn sidebar (ticker chạy, zoom/devbar nhích lên) và mở lại (feed cuộn cuối); kéo tay kéo tới 260 px để kích hoạt container query (tab chỉ còn icon, chip sản phẩm rút gọn, ô chọn ngày Lịch sử trọn hàng).
4. Feed: lọc từng kênh, cuộn lên để thấy "▼ N tin mới", thẻ cảnh tự gọn sau 2 thẻ, bấm đầu thẻ mở/đóng, link sản phẩm / bài báo mở tab mới với `rel` đúng.
5. Tắt server để thấy banner mất kết nối và canvas xám; mở lại để chắc `hello` lặp không nhân đôi nội dung.
6. So với ảnh chuẩn trong `docs/preview/` (`v2/desktop.png`, `v2/mobile.png`, `v2/hud-cham-ai.png`, `v2/an-khung-chat.png`, `v2/tab-san-pham.png`…) và cập nhật ảnh khi đổi giao diện. Chi tiết quy trình QA ở [11-kiem-thu-qa.md](./11-kiem-thu-qa.md).

---

## 21. Lệch giữa tài liệu cũ và code hiện tại

- `SPEC.md` §8 dòng 840-848 vẫn tả **thanh trên cùng v1** và chip "🤖 GPT…" — đã thay bằng HUD nổi trên canvas, chip AI chỉ admin (`docs/ui-polish-todo.md` §1, §9; `docs/v2-contract.md` §6). `SPEC.md:828` nói mã dev ở `sessionStorage['vpa.dev']` — thực tế `localStorage` + cookie HttpOnly `vpa_dev` (`net.js:13-37`).
- `docs/v2-contract.md` §6 liệt kê chip 👔 và 🤖 cho mọi người — nay 👔 bỏ, 🤖 chỉ admin.
- `README.md` §8 nói mở trang với `#dev=` rỗng là thoát admin — code chỉ xoá `localStorage` (`writeStored('')`), **không** gọi `/api/dev/logout`, nên cookie `vpa_dev` vẫn còn và server vẫn coi socket là dev; chỉ nút 🚪 (`forgetDevToken`) thoát hẳn (xem Câu hỏi còn mở).
- `README.md` §13 chỉ mô tả `public/` một dòng — tài liệu này (và 07) là nơi mô tả chi tiết.

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … |
|---|---|
| id / cấu trúc trong `index.html` | §2 bảng DOM; module `getElementById` tương ứng; §1.7 nếu thêm `<script>`/`<link>` (nháy đôi, đường dẫn tương đối); khởi động lại server |
| biến CSS, breakpoint, container query, z-index | §3.1, §3.3, §3.5 của tài liệu này; nếu đổi 899 px → `util.js`, `devbar.js`, `profile.js` + §18 |
| thêm / bỏ chip HUD hoặc nội dung popover | §4.3–§4.5; nếu lộ số liệu hệ thống → kiểm `publicStatus` (`src/server.ts`) + §1.5 + [02](./02-kien-truc-va-giao-thuc.md) |
| hằng sidebar (`SB_*`, `TK_*`) | §5 + `aria-valuemin/max` trong `index.html` |
| hằng feed (`MAX_LINES`, `MAX_TOP`, `KEEP_OPEN`), cấu trúc thẻ cảnh, chip sản phẩm, pill | §7 (+ §11.2 vì Lịch sử dùng chung `createFeedView`) |
| thêm `SceneType` / `Activity` / `NewsCategory` / `HrAction` / `DevEventName` | `labels.js` (§16) + CSS lớp tương ứng + `src/types.ts` + (riêng `DevEventName`) allowlist `DEV_EVENTS` trong `src/server.ts:48-51` + tài liệu server liên quan ([03](./03-mo-phong-the-gioi.md), [04](./04-dao-dien-cau-chuyen-nhan-su.md), [06](./06-tin-tuc-thoi-su.md)) + §7.8 / §11.1 / §13 |
| trường mới trong `ServerMsg` / `PublicAgent` / `StatusInfo` | `store.js` (`onHello`, `handleMessage`), module hiển thị, §1.4, `src/types.ts`, [02](./02-kien-truc-va-giao-thuc.md) |
| cách lưu mã dev / cookie / deep link / localStorage | §1.5, §1.6, §21; README §8; [10-van-hanh-deploy.md](./10-van-hanh-deploy.md) nếu liên quan nginx |
| `hello.rules` hoặc cách tô màu KPI | §8, §9, §11.3, §16 (`kpiTone` vs `kpiPaceTone`) + `render/office.js:643-660` (bảng KPI trên tường tự tính, không dùng `kpiTone` — xem 07) |
| endpoint `/api/history`, `/go/:id`, `/api/dev/*` | §1.2, §10, §11.2 + [02](./02-kien-truc-va-giao-thuc.md) |
| hành vi toast / vị trí | §14; cân nhắc `setInsets` cho canvas (07) |
| bất kỳ file trong `public/` | khởi động lại server (ASSET_VERSION, §1.7); chạy checklist §20; cập nhật ảnh `docs/preview/`; `npm run typecheck` không phát hiện lỗi JS client |
| hợp đồng `createOffice` hooks / API (`setInsets`, `focusAgent`, `setProducts`…) | §1.2, §1.3 và [07-frontend-ve-canvas.md](./07-frontend-ve-canvas.md) |

## Câu hỏi còn mở / cần kiểm tra

1. **CSS / JS lệch nhau**: CSS chết — `.chip-boss.away` (`style.css:181-182`, chip sếp đã bỏ), `.popover .tip-steps` (217), biến `--hud-h` (37) — không JS nào dùng; có thể xoá. Chiều ngược lại, JS gán lớp mà CSS không có — `#chip-revenue` toggle `.ok` (`hud.js:157`) nhưng `style.css` không có rule `.chip-revenue.ok` nào (grep `chip-revenue` → 0): hoặc thêm CSS (ví dụ tông xanh khi đạt mục tiêu tháng) hoặc bỏ toggle.
2. **Export không ai dùng**: `avatar.js portraitCache` (ghi, không đọc), `labels.js KPI_WARN_DAYS`, `sidebar.js isCollapsed/sidebarWidth`, `tabs.js currentTab`, `util.js reducedMotion`, `store.js hiddenActors/wcOccupied` (canvas tự tính `wcBusy`). Giữ hay bỏ là quyết định thiết kế.
3. **`#dev=` rỗng không thoát admin hẳn** (`net.js:58-66` chỉ xoá storage, không `POST /api/dev/logout`; cookie `vpa_dev` còn → server vẫn cấp dev). README §8 và chú thích `net.js:2-3` nói ngược lại. Nên sửa code (gọi logout khi token rỗng) hoặc sửa README.
4. **Lịch sử**: client không truyền `offset/limit` → ngày > 5000 bản ghi bị cắt âm thầm, chân trang vẫn "Hiển thị N/N dòng"; phản hồi 429 chỉ hiện "lỗi 429" + Thử lại, không tự thử lại theo `Retry-After`; thông điệp "HISTORY_ENABLED" chỉ ở nhánh 404 nhưng server khi tắt vẫn trả 200 với `enabled: false` và `days` = những file còn trong `HISTORY_DIR` (thường `[]`; `listDays()` không kiểm `enabled`, `src/sim/archive.ts:313-345`) — client không đọc `enabled` nên có thể vẫn liệt kê ngày cũ và không bao giờ hiện câu "chưa bật tính năng lưu trữ". Nên để client đọc `enabled` để hiện đúng thông điệp.
5. **Bảng dev** nháy `.sent` ngay khi `ws.send` thành công dù server có thể bỏ lệnh (không quyền / quá `DEV_RATE`) — admin không có phản hồi thật. Nút 🗞️ "news" bắn 2 cảnh `news_chat` liền nhau (chủ dự án ghi nhận) — lỗi phía server, ngoài vùng này.
6. **Hằng trùng lặp**: `aria-valuemin/max` (HTML) ↔ `SB_MIN/SB_MAX`; chuỗi "khoảng 18:30" (`recaps.js:30`) ↔ `DAY_END_MIN`; `WEEKDAYS` 5 ngày trong `feed.js:223` giả định tuần làm việc liên tục — cần kiểm tra cách server đánh số ngày cuối tuần (03).
7. **Toast đè bong bóng thoại** (`style.css:257-263`, `top: 48px`, z 7) — canvas chỉ né HUD/ticker qua `setInsets`. Gợi ý: tính vùng toast vào insets hoặc đổi vị trí toast.
8. `recap.source` vẫn nằm trong payload WS gửi mọi người xem; UI chỉ không hiển thị (`recaps.js:44`). Cần kiểm tra server có lược trường này không nếu muốn ẩn triệt để.
9. `profile.js:154`: mọi giá trị `gender` khác `'nữ'` hiển thị "Nam" (kiểu `Gender = 'nam' | 'nữ'` nên hiện vô hại).
10. `products.js:37-59` vẫn dựng DOM tooltip trên mobile dù CSS ẩn `.prod-tip` — lãng phí nhỏ.
11. Khi lọc theo kênh, thẻ cảnh **đang ẩn** vẫn nhận dòng và tự mở (`setCollapsed(card, false)`); bỏ lọc có thể thấy nhiều thẻ cũ mở hơn `KEEP_OPEN` tới lần `autoCollapse` kế (chỉ chạy khi có thẻ kết thúc).
12. CSS hiện đại (`color-mix`, container query, `100dvh`, `backdrop-filter`) không có fallback — chấp nhận hay cần kiểm tra trình duyệt mục tiêu?
13. Phụ thuộc Google Fonts (`index.html:10-12`): khi bị chặn chữ dùng font hệ thống; cân nhắc self-host trong `public/` để hưởng cache `/v/<ver>/` và tránh rò rỉ IP người xem.
14. Không có test tự động cho `public/`; móc `window.__vpa` / `canvas.__view` chưa có script nào dùng — nên commit script QA headless (11).
15. Liên kết tới các tài liệu tạo song song trong cùng đợt (07, 09, 10, 11, 13, 14) đã kiểm tra tồn tại (`ls docs/` ngày 2026-11-02). ~~`docs/README.md` chưa tồn tại~~ — mục lục [README.md](./README.md) đã được tạo cùng ngày và đoạn mở đầu đã trỏ tới; không còn việc mở.
16. `devbar.js:15` đọc `localStorage.getItem` hai lần không bọc `try/catch` (§1.6, §13) — khác mọi chỗ khác dùng `lsGet/lsSet`; nên sửa code sang `lsGet(KEY)` (tài liệu này không sửa code).
17. Trần `store.sceneMeta` 300 cảnh (`store.js:238-241`) hiện lớn hơn cửa sổ `hello.log` 200 dòng (`LOG_KEEP`) và `MAX_TOP = 180` phần tử feed nên đủ dùng; nếu tăng `LOG_KEEP` / `MAX_TOP` thì phải tăng cùng, không thì thẻ cảnh cũ trong feed rơi về `guessScene` (§7.2).
18. Hai regex `src` của link `/go/` lệch nhau: client `productUrl` `^[a-z_]{1,20}$` (`products.js:23`) chặt hơn server `^[A-Za-z0-9_-]{1,32}$` (`server.ts:343`) — không gây lỗi nhưng nên thống nhất, hoặc ghi danh sách nguồn hợp lệ (`showroom`, `sidebar`, `scene`, `desk`) ở một chỗ dùng chung (§1.2, §10).
