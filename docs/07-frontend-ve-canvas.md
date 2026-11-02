# Frontend: canvas, nhân vật, store, mạng

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `public/index.html` (phần nạp script), `public/js/main.js`, `net.js`, `store.js`, `util.js`, `labels.js` và toàn bộ `public/js/render/` (`office.js`, `character.js`, `furniture.js`, `floor.js`, `screens.js`, `showroom.js`, `bubbles.js`, `fx.js`, `draw.js`, `world.js`) · Đọc khi: sửa bất kỳ thứ gì người xem nhìn thấy trên bản đồ văn phòng (nhân vật, nội thất, bong bóng, hiệu ứng, thu phóng), debug nhân vật giật / không hiện / sai chỗ, sửa cách trình duyệt kết nối và nhận dữ liệu (WebSocket, reconnect, mã admin), thêm loại nội thất / phòng / màn hình / hoạt động, hoặc cần hiểu `store` trước khi viết module UI mới.

Tài liệu này trả lời: **trình duyệt khởi động theo thứ tự nào, dữ liệu từ WebSocket đi qua `store` ra canvas thế nào, canvas vẽ từng lớp theo thứ tự gì và vì sao, nhân vật được dựng từ `look` ra sao, bộ đệm chống giật tính toán thế nào, và khi muốn thêm/sửa một thứ nhìn thấy được thì phải chạm vào những file nào**. Phần giao diện DOM (HUD, sidebar, feed, hồ sơ, bảng dev, CSS) nằm ở [08-frontend-giao-dien.md](08-frontend-giao-dien.md); giao thức WebSocket/HTTP và hợp đồng kiểu nằm ở [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md) (§5 thông điệp, §7 phiên bản tài nguyên, §8 quyền admin, §10 bộ đệm nhìn từ phía giao thức); bản đồ và luật mô phỏng sinh ra `frame` ở [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md). Hợp đồng kiểu gốc là [`../src/types.ts`](../src/types.ts); ranh giới canvas ↔ UI được chốt trong [v2-contract.md §5–§6](v2-contract.md); yêu cầu thẩm mỹ từng vòng ở [ui-polish-todo.md](ui-polish-todo.md) với ảnh duyệt trong `docs/preview/`. Mục lục chung của bộ tài liệu: [README.md](README.md); lộ trình đọc theo vai trò: [01-tong-quan.md §10](01-tong-quan.md).

Quy ước: `office.js:437` là số dòng tại thời điểm viết (tìm theo tên hàm nếu lệch). Tên file/hàm/biến giữ tiếng Anh. Không có API key, token, mật khẩu nào trong tài liệu; chỉ nhắc **tên** biến môi trường.

---

## 1. Toàn cảnh

### 1.1 Không có bước build; phiên bản tài nguyên do server gắn

- Toàn bộ frontend là **ES module thuần**: `public/index.html:13-14` nạp `<link rel="stylesheet" href="style.css">` và `<script type="module" src="js/main.js">`; các module khác được `import` tương đối. Không framework, không bundler, không file ảnh (mọi hình vẽ thủ tục bằng Canvas 2D). Phụ thuộc ngoài duy nhất: font "Be Vietnam Pro" từ Google Fonts (`index.html:10-12`).
- Server viết lại mọi `href|src="…​.css|.js"` **tương đối, nháy đôi** trong `index.html` thành `/v/<ASSET_VERSION>/…` và trả `index.html` với `Cache-Control: no-cache` (`src/server.ts:149-162`, regex `:152` bỏ qua `https?:`, `data:` và đường dẫn bắt đầu `/`). File dưới `/v/<phiên bản đang chạy>/` được cache `public, max-age=31536000, immutable` (`:371`, `:437-439`). `ASSET_VERSION` = sha1 rút gọn 12 ký tự của (đường dẫn, kích thước, mtime) mọi file trong `public/` lúc server khởi động (`:129-146`); `computeAssetVersion` **bỏ qua** file/thư mục bắt đầu bằng `.` (`:135`), và khi không có thư mục `public/` thì `ASSET_VERSION = 'dev'` (`:146`). `ASSET_PREFIX_RE = /^\/v\/([A-Za-z0-9]{4,40})(\/.*)$/` (`:147`) chấp nhận **mọi** chuỗi phiên bản hợp lệ, không chỉ phiên bản đang chạy: URL mang phiên bản cũ vẫn được phục vụ (tab đang mở `index.html` cũ không vỡ sau deploy) nhưng chỉ phiên bản đúng `ASSET_VERSION` mới được `immutable`, còn lại `no-cache` (`:437-439`).
- **Hệ quả cho người sửa frontend:** vì `main.js` được nạp từ `/v/<ver>/js/main.js`, mọi `import './store.js'`, `import('./render/office.js')`… tự phân giải trong cùng tiền tố — không phải sửa import khi deploy. Nhưng **sửa file trong `public/` phải khởi động lại server** (production: pm2 restart) để phiên bản đổi — kể cả khi chạy local bằng `npm run dev` (`tsx watch src/server.ts` chỉ theo dõi `src/`, không theo dõi `public/` — cần kiểm tra), nếu không trình duyệt vẫn dùng file cũ đã cache `immutable` dưới URL `/v/<ver cũ>/…` (hard reload hoặc tắt cache trong DevTools để tránh). Lý do có cơ chế này: Cloudflare ép `max-age` 4 giờ cho `.js/.css`, người xem từng chạy code cũ hàng giờ sau deploy (xem [02 §7](02-kien-truc-va-giao-thuc.md)).

### 1.2 Luồng dữ liệu một chiều

```
server  ──WS /ws──▶  net.js ──▶ store.handleMessage(msg) ──▶ cập nhật store ──▶ store.emit(type, payload)
                                                                   │                      │
                                            render/office.js đọc  ◀┘                      └─▶ main.js + ui/* (store.on)
                                            thẳng `store` trong vòng requestAnimationFrame     cập nhật DOM
canvas ──hooks (onPick/onHover/onProduct*/onBoard*)──▶ main.js ──▶ ui/* (hồ sơ, tooltip, mở link)
ui/*   ──office.setInsets / setProducts / setMap / focusAgent / zoom*──▶ canvas
```

- Canvas **không nhận dữ liệu qua tham số**, chỉ đọc `store` (và `actorPos`) — đúng ranh giới "canvas chỉ đọc `store.js` API" trong [v2-contract.md §5](v2-contract.md). UI không bao giờ sửa `store` trực tiếp; chỉ `handleMessage` sửa.
- Mọi handler `store.on` được bọc `try/catch` (`store.js:39-45`): một module UI lỗi không làm vòng xử lý thông điệp hay canvas dừng.
- `store.on(type, fn)` **trả về hàm huỷ đăng ký** (`store.js:34-38`: `return () => listeners.get(type)?.delete(fn)`). Listener được giữ trong `Set` nên gọi theo thứ tự đăng ký. Các module hiện có đăng ký một lần lúc `init*` và không bao giờ gỡ; module UI mới có vòng đời ngắn (popover, drawer tạm, thẻ bị xoá) nên giữ hàm trả về để gỡ listener, tránh rò bộ nhớ và handler chạy trên DOM đã mất.

### 1.3 Hai hệ toạ độ trên canvas

| Hệ | Đơn vị | Dùng cho | Transform |
|---|---|---|---|
| **Ô (tile)** | 1 ô = `T` px CSS; `(0,0)` góc trên-trái bản đồ | sàn, tường, nội thất, ghế, nhân vật, hiệu ứng thế giới (tint, đèn, báo động phòng server) | `ctx.setTransform(T·dpr, 0, 0, T·dpr, ox·dpr, oy·dpr)` (`office.js:332`) |
| **px CSS** | 1 đơn vị = 1 px CSS | bảng tên, emote, bong bóng, biển WC, biển "ĐI VẮNG", nhãn sự cố, viền báo động | `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` (`office.js:339, 398`) |

Lý do tách: chữ phải **giữ cỡ khi thu phóng** để luôn đọc được (`bubbles.js:1-2`). Quy đổi ô → px CSS: `sx = ox + x·T`, `sy = oy + y·T`; ngược lại `toTile(sx, sy) = ((sx − ox)/T, (sy − oy)/T)` (`office.js:139-141`). Nhân vật có thêm hệ **cục bộ** riêng (mục 8.1): `U = 24` đơn vị/ô, gốc tại điểm chân.

### 1.4 Nguyên tắc an toàn áp cho vùng này

- Chuỗi từ server/AI chỉ vào DOM qua `textContent`/`createTextNode` (`util.js:2`, hàm `el()` `:125-146`); trên canvas chỉ đi qua `fillText` nên không có nguy cơ HTML, nhưng vẫn **cắt độ dài** (`str(v, max)`) để không vẽ tràn.
- Màu từ `look` chỉ dùng sau `safeColor()` (`util.js:72-76`: regex `COLOR_RE`, ≤ 40 ký tự, chặn `url()`); link sản phẩm chỉ qua `safeProductUrl()` (`:79-83`, phải bắt đầu `/go/`); ảnh sản phẩm trên kệ chỉ `http(s)` (`showroom.js:28`).
- Người xem thường **không bao giờ thấy số liệu hệ thống**: server đã lược bằng `publicStatus()` (`src/server.ts:184-193`) và chỉ gửi `hello.dev = true` cho socket có quyền (`:455-462`); canvas không vẽ bất kỳ thông tin AI/lỗi/lượt gọi nào, và `store.dev` chỉ bật từ `hello.dev`. Mã admin không bao giờ được log hay vẽ (`net.js:4`).

### 1.5 Bản đồ file

| File | Dòng | Vai trò | Export dùng bởi module khác |
|---|---|---|---|
| `public/js/main.js` | 236 | điểm vào: khởi tạo canvas + UI, nối hooks, deep link, tooltip, `connect()` | (không export; gắn `window.__vpa`) |
| `public/js/net.js` | 143 | WebSocket, backoff, ping, mã dev (localStorage + cookie) | `connect`, `send`, `forgetDevToken` |
| `public/js/store.js` | 414 | trạng thái client, `handleMessage`, sự kiện, nội suy actor + bộ đệm chống giật | `store`, `actorPos`, `bubbleDuration`, `normNewsRef`, `handleMessage`, `setConn` |
| `public/js/util.js` | 210 | toán/easing, định dạng, băm ổn định, `safeColor/safeProductUrl/safeImageUrl`, `el/setKids/setText`, `warnOnce` | nhiều |
| `public/js/labels.js` | 266 | nhãn tiếng Việt, hằng hiển thị, ánh xạ activity → màn hình, `bossAwayLabel` | `ROLE_ORDER`, `slackScreenKind`, `workScreenKind`, `bossAwayLabel`, `ROOM_ICONS`, `activityText`, `kpiPaceTone`… |
| `render/office.js` | 1226 | bộ máy canvas: camera, cache, vòng rAF, sắp theo y, overlay, nhập liệu | `createOffice(canvas, hooks)` |
| `render/world.js` | 140 | `hello.map` → cấu trúc tiện vẽ (`roomAt`, `seatAt`, cửa WC, lối vào…) | `prepareWorld` |
| `render/floor.js` | 833 | layer tĩnh offscreen: sàn, tường, cửa, cửa sổ, thảm, bóng, trang trí, nhãn phòng | `renderFloorLayer`, `MARGIN`, `CAP` |
| `render/furniture.js` | 1099 | hình học nội thất, painter từng type, registry `SPECS`, `buildSprites`, ghế, hơi cà phê | `deskGeom`, `kpiGeom`, `whiteboardGeom`, `shelfGeom`, `podiumGeom`, `tvGeom`, `rackGeom`, `coffeeGeom`, `buildSprites`, `drawChairBase/Back`, `steam` |
| `render/character.js` | 969 | nhân vật chibi vẽ thủ tục từ `look`, 4 hướng, 3 tư thế, chân dung | `U`, `drawCharacter`, `moodOf`, `headTop`, `headCenter`, `HEAD_RADIUS`, `portrait` |
| `render/screens.js` | 399 | 16 kiểu màn hình máy tính + TV | `drawScreen`, `screenGlow`, `drawTvScreen` |
| `render/showroom.js` | 188 | sản phẩm trên kệ/bục, hit-rect, ảnh tải nền | `sanitizeProducts`, `drawShelfProducts`, `drawPodiumProduct`, `shelfOfType`, `shelfProducts`, `featuredProduct` |
| `render/bubbles.js` | 466 | lớp phủ px CSS: bong bóng, "•••", emote, bảng tên, biển treo | `drawBubbles`, `drawEmote`, `measureNamePill`, `spreadPills`, `drawNamePill`, `drawSign`, `clearTextCache` |
| `render/fx.js` | 159 | tint ngày/đêm, đèn, báo động server, lửa, nhãn nổi, làm tối phòng | `tintAt`, `darkness`, `drawTint`, `drawLights`, `drawServerAlarm`, `drawAlarmVignette`, `drawFlames`, `drawFloatLabel`, `dimRoom` |
| `render/draw.js` | 211 | hàm vẽ cơ bản, xử lý màu, `FONT`/`EMOJI_FONT`, `makeCanvas` | nhiều (cả `ui/avatar.js` dùng `luma`) |

Quan hệ import đáng nhớ: `office.js` import **tất cả** module render + `store.js` + `labels.js` + `util.js`; `showroom.js` → `furniture.js` (geom); `floor.js` → `labels.js` (`ROOM_ICONS`); `ui/avatar.js` → `render/draw.js` (`luma`) và `render/character.js` (`portrait`) — đổi chữ ký hai hàm này là vỡ thẻ nhân sự/hồ sơ.

---

## 2. `main.js` — thứ tự khởi động (bắt buộc giữ)

Module có **top-level `await`** (`main.js:29`), nên mọi thứ sau dòng 29 chạy sau khi `render/office.js` nạp xong (hoặc lỗi).

| Bước | Dòng | Việc làm | Vì sao / bẫy |
|---|---|---|---|
| 1 | 2–4 | `import { store, actorPos }`; gắn `window.__vpa = { store, actorPos }` (**non-enumerable**) | móc QA headless (mục 11.4); chỉ chứa dữ liệu server đã gửi |
| 2 | 26–41 | `office` khởi tạo là **đối tượng giả** (`setMap: () => true`, các hàm `noop`, `hasMap: false`), rồi `await import('./render/office.js')` → `createOffice($('office'), hooks)`; lỗi → `console.error`, trang vẫn chạy | HUD/feed hoạt động kể cả khi module vẽ đang sửa dở |
| 3 | 43–55 | `initTabs` → `initToasts` → `initHud` → `initSidebar` → `initFeed(openProfile)` → `initStaff` → `initProducts` → `initRecaps` → `initNewsStrip` → `initHistory` → `initRumors` → `initProfile(id => office.focusAgent(id))` → `initDevbar(send)` | mọi `init*` đăng ký `store.on(...)` **trước** khi kết nối nên không bỏ lỡ `hello` |
| 4 | 58–60 | nút `#zoom-in/#zoom-out/#zoom-fit` → `office.zoomIn/zoomOut/fit` | |
| 5 | 64–78 | `syncInsets()`: đo `#hud` (mép trên) và `#ticker` (mép dưới, chỉ khi không `hidden`) bằng `getBoundingClientRect().height` → `office.setInsets({top, bottom})`; gắn `ResizeObserver` cho hai phần tử, `onSidebarToggle(() => rAF(syncInsets))`, `window resize`, gọi ngay 1 lần | bong bóng/emote né vùng bị HUD/ticker che; bản đồ căn vào phần còn trống (mục 7.2). Đổi chiều cao HUD/ticker trong CSS **không** cần sửa JS |
| 6 | 81–85 | `store.on('products', pushProducts)` → `office.setProducts(store.products)` (guard `typeof`) | |
| 7 | 88–111 | `store.on('hello')`: `#company-name` = `shortCompanyName(store.companyName)`, `document.title = "Văn Phòng Ảo — <tên ngắn>"`; `office.setMap(msg.map, msg.companyName)`; `pushProducts()`; `setMap` trả `false` → thẻ lỗi "Không đọc được bản đồ văn phòng" trong `#loading` (sidebar vẫn chạy); thành công → `#loading.done` rồi `hidden` sau 450 ms; ẩn `#conn-banner`; `applyHash()` đúng một lần (`deepLinked`) | `hello` lặp lại mỗi lần kết nối lại — handler phải idempotent |
| 8 | 115–125 | `applyHash()`: `#tab=live\|staff\|products\|recap\|rumors`, `#filter=<key>` (bấm chip `#filters [data-filter]`), `#profile=<id>` (chỉ khi `store.agents.has(id)`); `hashchange` → `applyHash()` khi `store.ready` | `#dev=` đã bị `net.js` gỡ trước đó (mục 3.2) |
| 9 | 127–133 | `store.on('conn')`: `#stage.offline` khi `state !== 'open' && store.ready` (CSS làm xám canvas `style.css:96`); banner mất kết nối chỉ hiện khi đã có `hello`; trước đó đổi chữ `#loading-sub` | |
| 10 | 135–138 | `store.on('toast')` → `toast(icon, text, tone)`; tone `hot` nếu icon khớp `/📦\|🔥\|😱\|⚠️/`, `happy` nếu `/🎉\|💰\|🚀\|🎂\|💸/` | |
| 11 | 141–224 | tooltip dùng chung `#hover-tip` (mục 2.2) | |
| 12 | 227–229 | `#stage-hint` mờ sau 9000 ms hoặc `pointerdown` đầu tiên trên canvas | |
| 13 | 232–234 | `document.fonts.ready.then(() => office.refresh())` | font web tải xong → xoá cache ngắt dòng + vẽ lại layer tĩnh (nhãn phòng, bảng KPI dùng `FONT`) |
| 14 | **236** | **`connect()` — lệnh cuối cùng** | module UI mới **phải** `init` trước dòng này |

### 2.1 Hooks canvas → UI (`main.js:30-38`)

| Hook (canvas gọi) | Tham số | UI làm gì |
|---|---|---|
| `onPick(id)` | id agent | `openProfile(id)` (drawer hồ sơ) |
| `onHover(id, x, y)` | id hoặc `null`, toạ độ px CSS trong canvas | `showHoverTip` — tooltip tên · vai · hoạt động |
| `onProductHover(p, clientX, clientY)` | sản phẩm hoặc `null`, toạ độ **client** | `showProductTip` (`ui/products.js`) |
| `onProductClick(p)` | sản phẩm | `openProduct(p, 'showroom')` → `window.open('/go/<id>?src=showroom', '_blank', 'noopener')` |
| `onBoardHover(kind, clientX, clientY)` | `'kpi'` \| `'whiteboard'` \| `null` | `showBoardTip` — tooltip đọc được vì chữ trên bảng nhỏ |
| `onBoardClick(kind)` | | `'kpi'` → `tabs.activate('staff')`; `'whiteboard'` → `$('chip-project').click()` (mở popover dự án của HUD) |

### 2.2 Tooltip dùng chung (`main.js:141-224`)

Một phần tử `#hover-tip`, `tipKey ∈ 'agent:<id>' | 'board:kpi' | 'board:whiteboard'`. `placeTip(x, y)` đặt lệch +16/+16 px và lật sang trái/lên nếu tràn `#stage` (`:143-151`). `hideTip(prefix)` chỉ ẩn khi tooltip đang mở cùng loại (`:152-156`) — tránh hover sản phẩm tắt tooltip nhân vật và ngược lại. Nội dung: nhân vật = `str(name, 40) · str(roleLabel, 40)`, dòng `emote + activityText(a)`, "Bấm để xem hồ sơ"; bảng trắng = tên dự án ≤ 80, khách, `Tiến độ N% · hạn ngày D · còn/trễ N ngày`; bảng KPI = danh sách agent `active` với chấm màu áo (`safeColor(look.shirt)`), `%` tô màu theo `kpiPaceTone(ratio, store.clock.minute ?? 600, store.rules.kpiLowRatio)`, dòng doanh thu tháng. `refreshTip()` cập nhật nội dung sống theo `store.on('agents')` và `store.on('status')` (`:215-224`).

---

## 3. `net.js` — WebSocket, kết nối lại, mã admin

### 3.1 Kết nối và kết nối lại (`net.js:82-143`)

```
connect()
  ├─ clearTimeout(retryTimer); setConn(everOpened ? 'closed' : 'connecting')
  ├─ new WebSocket(wsUrl())        // lỗi đồng bộ → scheduleRetry()
  ├─ onopen   : attempt = 0; everOpened = true; setConn('open'); ping {t:'ping'} mỗi 25 000 ms
  ├─ onmessage: chỉ nhận string; JSON.parse lỗi → bỏ; handleMessage(msg)
  ├─ onclose  : ws = null; dừng ping; setConn(...); scheduleRetry()
  └─ onerror  : bỏ qua (onclose xử lý)
scheduleRetry(): delay = min(15 000, 800 · 1.7^attempt) · (0.8 + random·0.4); attempt++
```

- Guard `if (ws !== sock) return` trong mọi callback (`:94, 102, 108`) chặn socket cũ ghi đè trạng thái sau khi đã mở socket mới.
- `send(msg)` (`:124-132`) chỉ gửi khi `readyState === OPEN`, trả `true/false`; `ui/devbar.js` dùng để gửi `{t:'dev', action:'speed'|'event', …}` (`ClientMsg`, `src/types.ts:488-491`). Lưu ý: server **lặng lẽ bỏ** lệnh dev từ socket không có quyền (`src/server.ts:472`) và giới hạn `DEV_RATE` 10 lệnh / 5000 ms (`:27, :474-475`) — `send()` trả `true` không có nghĩa lệnh được thực hiện.
- `visibilitychange` (tab hiện lại và `!ws`) và `online` → `attempt = 0; connect()` (`:135-143`): máy ngủ dậy nối lại ngay thay vì chờ hết backoff.
- Phía server: `WebSocketServer({ path: '/ws', maxPayload: 16 KiB })` (`src/server.ts:449`); ngoài `maxPayload`, `parseClientMsg` còn một trần **riêng** cho từng thông điệp client→server: `MAX_MSG_BYTES = 2048` byte (`:23`, kiểm ở `:228`; gói nhị phân, rỗng hoặc quá trần → trả `null`, bị bỏ lặng lẽ, không đóng socket). `ClientMsg` hợp lệ chỉ vài chục byte nên không chạm trần, nhưng ai thêm lệnh dev mang payload lớn phải nhớ con số này. Server gửi `hello` ngay khi nối (`:460-463`); heartbeat ws-level `ping/pong` mỗi `HEARTBEAT_MS = 30 000` để đếm người xem (`:26, :486-495`) — **độc lập** với JSON `{t:'ping'}` của client (server bỏ qua nó, `:471`; gói này chỉ giữ kết nối sống qua proxy).

Trạng thái `store.conn`: `'connecting'` (chưa từng mở) → `'open'` → `'closed'` (đã từng mở, đang rớt). UI dùng để đổi chữ `#loading-sub` hay hiện banner (mục 2, bước 9).

### 3.2 Mã admin (DEV_TOKEN) trên trình duyệt (`net.js:13-80`)

```
mở trang 1 lần với ?dev=<mã> hoặc #dev=<mã>
  └─ devToken() (mỗi lần connect, qua wsUrl):
       có tham số (kể cả rỗng) ─▶ trim().slice(0,200) ─▶ writeStored(token) ─▶ gỡ `dev` khỏi query + hash,
                                   history.replaceState (giữ #tab/#profile)
       không có tham số       ─▶ readStored() (localStorage['vpa.dev'], di trú 1 lần từ sessionStorage cũ)
       CẢ HAI nhánh           ─▶ nếu token ≠ '' → syncCookie(token)   (net.js:72 — nằm ngoài if/else, nên mã đọc từ
                                   localStorage cũng được đồng bộ cookie ở mỗi lần tải trang, không chỉ khi mở link có mã)
  └─ wsUrl() = (https ? wss : ws)://<location.host>/ws[?dev=<encodeURIComponent(token)>]
syncCookie(token): 1 lần mỗi lần tải trang (cờ cookieSynced) → POST /api/dev/login {token} (credentials same-origin)
  └─ server (src/server.ts:100-121): đúng mã → Set-Cookie vpa_dev=…; Path=/; HttpOnly; SameSite=Lax[; Secure]; Max-Age=31536000
                                     sai mã → 403 + noteIgnoredDev(); DEV_TOKEN rỗng → 204 không đặt cookie; DEV_PANEL=false → 404
                                     phương thức ≠ POST (GET/HEAD/OPTIONS…) → 405 + header `Allow: POST` (:102), áp cho cả /login và /logout
```

- Hai lớp nhớ: `localStorage['vpa.dev']` (`DEV_KEY`, `:13`) để **gắn `?dev=` vào URL WS** và cookie HttpOnly `vpa_dev` để server vẫn nhận ra admin khi storage bị xoá. Server quyết định quyền **theo từng socket**: `?dev=` trước, không có thì cookie (`src/server.ts:68-75`); `DEV_PANEL=false` → không ai là dev; `DEV_TOKEN` rỗng → mọi người là dev.
- `forgetDevToken()` (`:40-45`): `writeStored('')` (xoá cả localStorage và sessionStorage) → `POST /api/dev/logout` (`keepalive: true`, server trả `Set-Cookie … Max-Age=0`) → `location.reload()`. Gọi từ nút 🚪 "Thoát admin" trong bảng dev (`ui/devbar.js:42`, có `window.confirm`).
- **Bẫy đã xác nhận:** chú thích `net.js:2-3` nói "mở trang với `#dev=` rỗng = quên mã", nhưng nhánh đó chỉ `writeStored('')` (`:59-60`) mà **không** gọi `/api/dev/logout` → cookie `vpa_dev` vẫn còn và socket kế tiếp vẫn là dev (vì `devAllowed` đọc cookie). Cách duy nhất chắc chắn thoát admin là nút 🚪. Sửa code hoặc sửa chú thích (xem Câu hỏi còn mở).
- Mã dev không bao giờ được log, vẽ, hay ghi vào tài liệu.

---

## 4. `store.js` — trạng thái client

### 4.1 Trường (`store.js:7-32`, `:151-156`)

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `ready` | boolean | đã nhận `hello`; `frame` bị bỏ khi chưa `ready` (`:389`) |
| `conn` | `'connecting'\|'open'\|'closed'` | do `setConn` (`:410-414`) |
| `map`, `companyName` (≤ 80, mặc định `'Văn Phòng Ảo'`), `dev` | | từ `hello` |
| `rules` | `{kpiLowRatio, kpiWarnDays, kpiFireDays}` | mặc định `0.7 / 2 / 3`; từ `hello.rules` với clamp `kpiLowRatio` 0.05..2, hai số ngày ≥ 1 làm tròn (`:348-352`) |
| `clock` | `ClockInfo` | cập nhật từ `hello` và **mỗi `frame`** (`:261`) |
| `status` | `StatusInfo` | từ `hello` và `status` |
| `agents` | `Map<id, PublicAgent>` | **thay toàn bộ** Map mỗi `agents` (`setAgents`, `:224-232`) |
| `lookCache`, `nameCache` | `Map<id, Look>`, `Map<id, name>` | giữ cả người đã nghỉ để feed cũ/avatar vẫn đúng (`rememberAgent`, `learnName`) |
| `scenes` | `Map<id, PublicScene>` | cảnh **đang diễn** |
| `sceneMeta` | `Map<id, PublicScene>` | mọi cảnh đã thấy (merge), tối đa 300 (`:238-241`) |
| `recaps`, `rumors` | mảng | `recaps` giữ 14 bản cuối (`:396`) |
| `products` | `ShowroomProduct[]` | đã qua `normProduct`, ≤ 60 (`:363`) |
| `news` | `NewsRef[]` | mới nhất **cuối**, ≤ 30 (`rememberNews`, `:125-134`) |
| `actors` | `Map<id, trạng thái vẽ>` | xem 4.6; **canvas tự xoá** actor đã biến mất sau 520 ms (`office.js:445`) |
| `bubbles` | mảng ≤ 5 | bong bóng thoại kênh `office` |
| `typing` | `Map<speakerId, {from, until}>` | "•••" người sắp nói |
| `pings` | `Map<speakerId, t>` | vừa nhắn nhóm chat → 📱 nhấp |
| `frameDt`, `lastFrameAt`, `helloAt` | số | `frameDt` = EMA khoảng cách giữa hai `frame` tới (0.8/0.2, chỉ khi `40 < dt < 1500`, `:256-259`); hiện **không có consumer** ngoài móc QA |
| `net` | `{tsBase, localBase, buffer, minSlack, window, lateFrames, frames}` | bộ đệm chống giật (4.6) |

Tiện ích: `roster()` (active → candidate → fired, rồi `ROLE_ORDER`, rồi `hiredDay`, `:47-53`), `name(id)` (agents → nameCache → viết hoa chữ đầu nếu id khớp `/^[a-z]{2,12}$/`, `:54-59`), `look(id)` (`:60-62`), `deskOwner(deskId)` (agent `active` có `deskId` đó, `:64-69`), `productById`, `productsByShelf()` (`{beauty, tech}` sắp theo `slot`, `:71-80`), `hiddenActors()`/`wcOccupied()` (`:82-88`) — hai hàm cuối **không có consumer**; `office.js` tự tính `wcBusy` trong `prepareActors` với điều kiện chặt hơn (cờ 8 **và** `activity ∈ toilet|wc`, `office.js:448-449`).

### 4.2 Sự kiện `store.emit` và ai nghe

| Sự kiện | Payload | Phát ở | Ai nghe (trong vùng này) |
|---|---|---|---|
| `hello` | thông điệp hello | `onHello` (phát **đầu tiên** trong chuỗi 7 sự kiện) | theo thứ tự đăng ký: `office.js:1206` (setProducts — đăng ký trong `createOffice`, chạy ở `main.js:29-38` nên **trước** handler của `main.js`), `main.js:88` (setMap, title), rồi `ui/devbar:53`, `feed:51`, `hud:23`, `news:56`, `profile:31`, `rumors:18`, `sidebar:63`, `staff:26` (theo thứ tự `init*`). `ui/products`, `ui/recaps`, `history`, `tabs`, `toasts`, `avatar` **không** nghe `hello`; `products`/`recaps` nhận dữ liệu hello qua sự kiện `products`/`recaps` phát ngay sau |
| `agents` | `store.agents` | `onHello`, thông điệp `agents` | `main.refreshTip`, `ui/staff|profile|rumors` |
| `status` | `StatusInfo` | `onHello`, thông điệp `status` | `main.refreshTip`, `ui/hud|devbar` |
| `recaps` / `recap` | mảng / bản mới | `onHello`, thông điệp `recap` | `ui/recaps` |
| `rumors` | mảng | `onHello`, thông điệp `rumors` | `ui/rumors` |
| `products` | `store.products` | `onHello` | `main.pushProducts` → `office.setProducts`, `ui/products` |
| `news` | `store.news` | `onHello`, `onLog` (scene_start có `news`), `onScene` | `ui/news` |
| `frame` | `clock` | `onFrame` | `ui/hud` (đồng hồ). Canvas **không** nghe — nó đọc `store.actors` trong rAF |
| `log` | `{entry, live: true}` | `onLog` | `ui/feed|sidebar` |
| `scene` | `PublicScene` | `onScene` | `ui/feed` |
| `toast` | `{icon ≤ 8 (mặc định 🔔), text ≤ 300}` | thông điệp `toast` | `main.js` → `ui/toasts` |
| `conn` | trạng thái | `setConn` | `main.js`, `ui/hud` |

Thứ tự emit trong `onHello` (`:374-380`): `hello → agents → status → recaps → rumors → products → news`. Mọi trường `store` đã được gán **trước** khi emit, nên handler `hello` có thể đọc `store.agents` ngay.

### 4.3 `handleMessage(msg)` (`store.js:384-408`)

Điểm vào duy nhất cho mọi `ServerMsg` (`src/types.ts:459-486`); bỏ qua nếu thiếu `t`; cả `switch` trong `try/catch` → `warnOnce`.

| `msg.t` | Xử lý |
|---|---|
| `hello` | `onHello` (4.4) |
| `frame` | `onFrame` chỉ khi `store.ready` (4.6) |
| `agents` | `setAgents(msg.agents)` + `emit('agents')` |
| `status` | nếu có `msg.status` → gán + `emit('status')` |
| `log` | `onLog` (4.5) |
| `scene` | `onScene`: `rememberScene`; `status === 'end'` → xoá khỏi `scenes`, xoá `typing` của participants; ngược lại set + `rememberNews(sc.news)`; `emit('scene')` (`:327-339`) |
| `recap` | thay bản cùng `day`, giữ 14 bản cuối, `emit('recaps')` rồi `emit('recap')` |
| `rumors` | thay mảng, `emit('rumors')` |
| `toast` | `emit('toast', {icon, text})` |
| khác | bỏ qua (server mới gửi loại lạ không làm client vỡ) |

### 4.4 `onHello` (`store.js:341-381`)

Gán `ready`, `helloAt`, `map`, `companyName`, `dev`, `rules`, `clock`, `status`; `setAgents` (+ cache look/name); `learnNames(msg)` học tên từ `log` kind `line` (`speaker`/`speakerName`), `recaps[].kpi[]`/`mvp`, `rumors[].aboutId` (`:209-216`); dựng lại `scenes` + `sceneMeta`; `recaps`, `rumors` (lọc object); `products = arr(msg.products).map(normProduct).filter(Boolean).slice(0, 60)`; `news` dựng lại theo thứ tự `log (scene_start.news)` → `scenes[].news` → `hello.news` (mới nhất cuối, đè thứ tự); **reset** `actors`, `bubbles`, `typing`, `pings`, `lastFrameAt = 0`. **Không reset `store.net`** (xem 4.6, bẫy).

### 4.5 `onLog` — bong bóng, "•••", 📱 (`store.js:293-325`)

- Chỉ nhận `entry.text` kiểu string. `kind === 'line'` có `speaker` → `learnName`; kênh mặc định `'office'`.
- Kênh `office` → bong bóng: `dur = clamp(num(bubble.durationMs, bubbleDuration(text)), 700, 15000)`; lọc bỏ bong bóng cũ **của cùng người** và bong bóng đã hết (`now − t0 ≥ dur + 400`); xoá `typing` của người nói; push `{key: e.id, speaker, name ≤ 40, text ≤ 400, icon ≤ 8, product, t0: now, dur}`; giữ ≤ 5 (`:301-309`).
- `bubble.nextSpeaker` (≠ speaker) → `typing.set(next, {from: now + max(dur·0.6, dur − 1100), until: now + dur + 2600})` (`:310-313`): "•••" hiện ở 60 % câu trước (hoặc 1,1 s trước khi hết), tắt 2,6 s sau khi câu trước hết nếu câu kế không tới.
- Kênh `group`/`company` → `pings.set(speaker, now)` (`:315`) → canvas vẽ 📱 với vòng xanh lan trong 1300 ms (`office.js:994`).
- `scene_end` → xoá `typing` của participants (từ `sceneMeta`). `scene_start` có `news` → `rememberNews` → `emit('news')`. Cuối cùng `emit('log', {entry, live: true})`.
- `bubbleDuration(text) = clamp(1600 + 55·len, 2200, 7500)` (`:136-138`) chỉ là **dự phòng**: Director luôn gửi `durationMs` (`src/sim/director.ts:1477`), World clamp 300..30 000 (`src/sim/world.ts:892-893`). Đừng chỉnh công thức client để đổi thời lượng thật — chỉnh phía server.

### 4.6 Actors, khung hình và bộ đệm chống giật (`store.js:140-291`)

**Vấn đề** (chú thích `:141-145`, sự cố 2026-11-02): server phát `frame` đều mỗi `FRAME_MS = 200` ms (`src/sim/world.ts:34, 2764-2767`) kèm `ts = Date.now()`; qua Cloudflare các gói tới trình duyệt **so le** (100 / 300 ms…) dù CPU server ~0 % và trình duyệt 60 fps. Nếu vẽ theo lúc gói *tới*, nhân vật đi–khựng–đi.

**Ý tưởng:** không vẽ "bây giờ", mà vẽ **trễ** `store.net.buffer` ms trên **trục thời gian của server** (được neo vào `performance.now()` lúc frame đầu tới). Mỗi actor giữ tối đa `KF_MAX = 10` khung hình `{t, x, y, jump}`; tại thời điểm vẽ, tìm hai khung kẹp mốc `now − buffer` và nội suy tuyến tính. Bộ đệm **nới ngay** khi gói tới muộn, **siết dần** khi mạng êm.

Hằng (`:146-149`): `NET_BUFFER_MIN = 260`, `NET_BUFFER_MAX = 700`, `NET_BUFFER_START = 340` (ms); `NET_SLACK_MIN = 60` ms; `KF_MAX = 10`; `TELEPORT_TILES = 3.2` ô.

**`frameTime(ts, now)`** (`:159-175`) — gán mốc `ft` cho frame vừa tới:

1. `ts` không hữu hạn (server cũ) → trả `now` (hành vi cũ: vẽ theo lúc gói tới).
2. Neo lại nếu chưa có neo hoặc `|(ts − tsBase) − (now − localBase)| > 60 000` (lệch > 60 s: server khởi động lại lâu, máy ngủ…). Neo = cặp `(tsBase, localBase)`.
3. `ft = localBase + (ts − tsBase)` — mốc của frame trên trục `performance.now()`.
4. Frame này sẽ được **cần** khi `now − buffer` chạm `ft`, tức tại `ft + buffer`. `slack = ft − (now − buffer)` = còn bao lâu nữa mới cần nó. `slack < 60` → gói tới "sát nút" hoặc đã muộn → `buffer = min(700, buffer + (60 − slack))`, `lateFrames++`.
5. Thống kê `minSlack` trong cửa sổ 40 frame; hết cửa sổ: nếu `minSlack > 140` (= `NET_SLACK_MIN + 80`) → `buffer = max(260, buffer − (minSlack − 100)/2)`; reset cửa sổ.

Ví dụ số: `buffer = 340`. Một frame tới với `ft = now − 290` → `slack = −290 + 340 = 50 < 60` → `buffer = 350` (nới 10 ms, đúng phần thiếu). Sau đó 40 frame liền đều tới sớm, `minSlack = 200` → `buffer = max(260, 350 − (200 − 100)/2) = 300`. Cứ thế bộ đệm hội tụ về mức "vừa đủ che jitter + 100 ms dự phòng", không bao giờ dưới 260 (≈ 1 frame + jitter thường gặp) hay trên 700.

**`pushKeyframe(a, ft, x, y)`** (`:178-185`): mốc ≤ khung cuối → ghi đè khung cuối (cùng mốc / ngược thời gian); `jump = hypot(Δx, Δy) > 3.2` (dịch chuyển tức thời: vào/ra WC, teleport của Director); cắt còn 10 khung.

**`actorPos(a, now)`** (`:188-202`) — vị trí để vẽ:

```
rt = now − store.net.buffer
rt ≥ kf[last].t  hoặc chỉ 1 khung  → đứng ở khung cuối (a.dur = 0)
rt ≤ kf[0].t                        → khung đầu
ngược lại: tìm p, q kẹp rt; a.t0 = p.t; a.dur = q.t − p.t
   q.jump → trả p (đứng yên tới đúng mốc rồi nhảy)
   không  → k = clamp((rt − p.t)/dur, 0, 1); x = p.x + (q.x − p.x)·k; y tương tự
```

`a.dur > 0` được `office.prepareActors` dùng làm tín hiệu "đang giữa một đoạn nội suy" để giữ animation đi bộ kể cả khi vị trí chưa đổi trong khung vẽ này (`office.js:460-462`).

**`onFrame(msg)`** (`:254-291`): cập nhật `frameDt`, `clock`, `ft = frameTime(num(msg.ts, NaN), now)`. Mỗi phần tử `FrameAgent = [id, x, y, dir, activity, emote, flags]` (`src/types.ts:438-439`; mảng < 7 phần tử hay x/y không hữu hạn → bỏ). Actor mới → `newActor(id, x, y, ft)` (`:244-252`, gọi ở `:271`: `dir 'down'`, `activity 'idle'`, `bornAt = t0 = seenAt = ft` — tham số thứ 4 tên `now` trong hàm nhưng giá trị truyền vào là **`ft`**, mốc frame trên trục `performance.now()`, không phải lúc gói tới; `seed` ngẫu nhiên 0..999). Vì `ft` có thể lớn hơn `now` (frame tới sớm so với neo), `office.prepareActors` kẹp `if (a.bornAt > now) a.bornAt = now` (`office.js:441`) trước khi tính alpha hiện dần — không có guard này alpha sẽ âm và nhân vật "chưa sinh" trong vài trăm ms. Actor cũ đang `goneAt` → hồi sinh (`goneAt = 0`, `bornAt = now − 400`, `kf = []`), rồi `pushKeyframe`. Emote đổi → `emoteAt = now`. `dir` chỉ nhận `up|left|right`, còn lại `'down'`. `flags = num(flags) | 0` (bit: `1` đang đi, `2` onPhone, `4` trong cảnh, `8` ẩn/WC — `src/sim/world.ts:2783`). `activity ∈ working|slacking|napping` → lưu `deskAct = {activity, emote}` để màn hình bàn giữ nội dung khi chủ bàn tạm sang cảnh khác. Actor không có trong frame → `goneAt = now`. Cuối cùng `emit('frame', clock)`.

**Bẫy:** `store.net` không reset khi `hello` (chỉ `lastFrameAt = 0`). Khi server khởi động lại `ts` vẫn tăng đơn điệu nên neo cũ vẫn dùng được; lệch lớn → tự neo lại nhờ ngưỡng 60 s; `buffer` đã học được giữ qua reconnect (có lợi). Đổi `FRAME_MS` phía server → phải cân lại `NET_BUFFER_*`/`NET_SLACK_MIN`.

### 4.7 Chuẩn hoá dữ liệu vào `store`

| Hàm | Dòng | Luật |
|---|---|---|
| `normProduct(p, i)` | 92–108 | cần `id`, `name` string; `category` chỉ `'lam-dep'` hoặc `'cong-nghe'`; `shelf` từ `shelf` hợp lệ hoặc suy từ category; `slot` mặc định = chỉ số `i`; cắt `id 60`, `name 120`, `emoji 8`, `priceHint 24`, `note 300`, `tags ≤ 12`; `url`, `image` giữ string thô (UI/canvas kiểm sau) |
| `normNewsRef(n)` | 111–122 | cần `title`; `url ≤ 1000`, `title ≤ 220`, `id = id \|\| url \|\| title (≤ 160)`, `source ≤ 40`, `category ≤ 20` |
| `rememberNews(raw)` | 125–134 | trùng `id` hoặc `url` → đưa lên mới nhất (đã là mới nhất → không đổi); cap 30; trả `true` nếu đổi |
| `rememberScene(sc)` | 234–242 | merge vào `sceneMeta`, cap 300 (xoá khoá cũ nhất) |
| `learnName` | 205–208 | chỉ ghi khi chưa có (tên có dấu đầu tiên thắng), ≤ 40 |

Lưu ý có **hai** bộ chuẩn hoá sản phẩm: `store.normProduct` và `showroom.sanitizeProducts` (mục 9.5) với giới hạn hơi khác; `office.setProducts` nhận `store.products` rồi sanitize **lần nữa** — vô hại nhưng phải sửa cả hai khi đổi schema `ShowroomProduct`.

---

## 5. `util.js` và `labels.js` — phần vùng render dùng

`util.js` (không phụ thuộc DOM ngoài `document`): `clamp`, `lerp`, `easeOutCubic`, `easeInOut`, `easeOutBack` (`:4-12`); `hashStr` (FNV-1a) và **`hash2(x, y, seed)` → [0,1)** (`:54-59`) — dùng khắp render để hoạ tiết (vân gỗ, cây, màn hình) **ổn định giữa các khung hình** thay vì `Math.random()`; `safeColor`, `safeProductUrl`, `safeImageUrl`; `str/num/arr`; `initial(name)` (chữ đầu của **từ cuối**, hỗ trợ tiếng Việt, `:90-96`) dùng cho chấm tên trên bảng KPI; `noAccent` (bỏ dấu để so khớp từ khoá, `:116-118`); `shortCompanyName` (`:194-198`); `warnOnce` (tối đa 20 cảnh báo/phiên, prefix `[văn phòng]`, `:207-210`). Bẫy: `str()` thêm `…` khi cắt nên độ dài thật = max + 1; `safeColor` chấp nhận tên màu chữ `[a-z]{3,24}` (vd `transparent`).

`labels.js` — các export render dùng: `ROLE_ORDER` (`:5`, phải giống server; `store.roster`), `slackScreenKind(label, emote)` (`:130-149`: so khớp nhãn hoạt động **không dấu** rồi emote → `tiktok|shopee|game|crypto|video|chat|news|football`, mặc định `tiktok`), `workScreenKind(role)` (`:151-160`: dev → `code`, `qa`, `designer → design`, `marketing → mkt`, `boss → chart`, còn lại `sheet`), `bossAwayLabel(note)` (`:206-212`: không dấu → `🏖️ Cuối tuần nghỉ | 🕗 Sếp chưa đến | 🏠 Sếp đã về | 🏌️ Sếp đi vắng`), `ROOM_ICONS` (`:162-164`, nhãn phòng trong `floor.js`). Bẫy: `workScreenKind('boss')` trả `'chart'` nhưng `screens.js` **không có painter `chart`** (rơi về màn hình tắt) — hiện không tới được vì `boss_desk` không vẽ màn hình động (mục 7.8); sẽ lộ ra nếu ai thêm.

Biến môi trường tới vùng này **gián tiếp** qua `hello` (frontend là file tĩnh, không đọc env; chi tiết ở [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md)): `DEV_TOKEN`/`DEV_PANEL` (→ `hello.dev`, cookie), `COMPANY_NAME` (→ `hello.companyName` → `document.title`, logo sàn qua `logoFrom`), `KPI_LOW_RATIO`/`KPI_WARN_DAYS`/`KPI_FIRE_DAYS` (→ `hello.rules` → màu cột bảng KPI), `TIME_MODE` (→ `clock.timeMode`; canvas chỉ dùng `clock.minute/day`), `PORT` (client dùng `location.host`, không cần biết).

---

## 6. `render/world.js` — từ `hello.map` tới cấu trúc vẽ

`prepareWorld(raw)` (`world.js:5-140`) trả `null` nếu map không dùng được (→ `office.setMap` trả `false` → `main.js` hiện thẻ lỗi nhưng sidebar vẫn chạy).

- Kiểm tra: `4 < W, H ≤ 200` và `walls.length === H`; mỗi hàng pad `'#'` tới `W` (`:9-13`). Ký tự lưới: `'#'` tường, `'D'` cửa, còn lại đi được (nguồn: `src/sim/map.ts`; bản đồ chuẩn `MAP_DATA = {w: 60, h: 34, walls, rooms, furniture, desks, spots}`, `:203`; client bỏ qua `spots`).
- `rooms` (id ≤ 30, label ≤ 40, floor ≤ 20), `furniture` (type, x, y, w, h, label ≤ 30, blocked, owner, idx) (`:14-19`).
- `roomIdx` (Int16Array): khi phòng chồng nhau, **phòng nhỏ hơn thắng** (giống `roomAt` server, `:25-39`). `glass`: ô tường kề phòng `meeting`/`boss`/`floor === 'boss'` (không tính tường ngoài, `:43-60`) → `floor.js` vẽ kính.
- `desks` từ `raw.desks` với `facing` suy từ vị trí ghế: ghế dưới bàn → `'up'`, trên → `'down'`, trái → `'right'`, phải → `'left'` (`:69-73`); `boss = id === 'd_boss'`. Bản đồ chuẩn: 10 bàn, ghế **dưới** bàn (nên nhân viên ngồi quay lưng về người xem), bàn sếp ghế **trên** (`src/sim/map.ts:34-43`).
- `chairs` quanh `meeting_table`/`table`: hàng trên/dưới mỗi 2 ô từ `f.x + 1` tới `f.x + f.w − 2`, hai đầu tại `my = f.y + floor(h/2)`; `style` `'office'` (bàn họp) / `'wood'` (bàn ăn); lọc ô hợp lệ, không tường, không nội thất `blocked` (`:78-92`) — cùng quy tắc `SPOTS` server.
- `seats: Map<"x,y", {kind: desk|chair|sofa|beanbag, facing, deskId?, boss?, style?}>`; `seatAt(x, y)` làm tròn toạ độ (`:94-105, 131`). Sofa: mọi ô hàng `f.y`, facing `'up'`; beanbag: 1 ô, facing `null`.
- `wcDoor`: các ô `'D'` quanh phòng `wc` → `{x: trung bình + 0.5, y: max y, tiles}` (`:108-117`). `entrance`: ô `'D'` trên viền ngoài (`:118-126`).
- Trả: `W, H, grid, rooms, furniture, desks, deskById, chairs, seats, at, isWall, roomAt, roomById, roomIdx, largest, glass, seatAt, find(type), entrance, serverRoom, bossRoom, workRoom (fallback largest), pantry, showroom, wcRoom, wcDoor` (`:128-139`).

---

## 7. `render/office.js` — bộ máy canvas

### 7.1 API trả về và trạng thái

`createOffice(canvas, hooks)` (`office.js:29`) trả (`:1212-1225`): `setMap(raw, companyName) → boolean`, `setProducts(list)`, `setCharacterScale(n)` (clamp 0.6..1.6; **không UI nào gọi**), `setInsets({top, bottom})`, `zoomIn()`/`zoomOut()` (hệ số 1.35 quanh tâm canvas), `fit()`, `focusAgent(id)`, `refresh()` (= `clearTextCache()` + `rebuildCaches()`), `isZoomed()` (`zoom > 1.01`), getter `hasMap`, `characterScale`. Hằng (`:23-27`): `MAX_CACHE_SCALE = 64`, `FEET_Y = 0.84` (điểm chân trong ô), `DESK_ACTS = {working, slacking, napping, boss_office}`, `FLAG_WALK = 1, FLAG_PHONE = 2, FLAG_SCENE = 4, FLAG_HIDDEN = 8`, `DEFAULT_CHAR_SCALE = 1`.

Ngoài API, `createOffice` tự đăng ký `store.on('hello', msg => setProducts(msg.products))` (`:1206`, chỉ chạy khi `Array.isArray(msg.products)`). Thứ tự đáng biết: vì `createOffice` chạy ở `main.js:29-38`, listener này đăng ký **trước** handler `hello` của `main.js:88` nên chạy trước; lúc đó `world === null` (chưa `setMap`) → `setProducts` chỉ lưu `products`, còn `rebuildProductHits()` thoát sớm (`:231`). Hit-rect kệ chỉ được dựng khi `setMap` gọi `rebuildProductHits()` (`:204`) rồi `pushProducts()` của `main.js` gọi `setProducts` lần nữa — listener `:1206` vì thế gần như dư (chú thích code cũng ghi "gọi hai lần vô hại") nhưng giữ để canvas không phụ thuộc `main.js` theo hợp đồng. `createOffice` còn gắn `canvas.__view = () => ({T, ox, oy, zoom, w, h, charScale, products, wcBusy, insets, bandTop, bandBottom})` (`:1210`, móc chỉ đọc cho test headless). Vòng rAF khởi động ngay (`:1208`) — khi chưa có `world`/`layer`, `draw()` chỉ clear rồi thoát (`:320`).

### 7.2 Kích thước, camera, vùng né HUD (`office.js:67-141, 291-300`)

- `resize()` (`:67-80`): đo `canvas.getBoundingClientRect()`, `dpr = clamp(devicePixelRatio, 1, 3)`, đặt `canvas.width/height = css × dpr`; có world → `computeFit()`, `defaultView()` (chỉ khi `!cam.userMoved`), `clampCam()`.
- `computeFit()` (`:82-88`): `t0 = max(3, min(cssW/(W + 0.6), cssH/(H + 1.3)))`; HUD/ticker được phép đè lên **lề + tường ngoài** (không có nội dung): `bandTop = max(0, insets.top − 1.2·t0)`, `bandBottom = max(0, insets.bottom − 1.0·t0)`; `fitT = max(3, min(cssW/(W + 0.6), bandH()/(H + 1.3)))` với `bandH() = max(40, cssH − bandTop − bandBottom)`; `bandCy()` = tâm dọc vùng còn trống.
- `maxZoom() = max(2.2, 40/fitT)` (`:92-94`) — tối đa ≈ 40 px/ô. `defaultView()` (`:96-107`): điện thoại (`cssW < 640`) phóng để ô ≥ 13 px (`zoom = clamp(max(tall, 13)/fitT, 1, maxZoom)`), nhìn `cx = W·0.32` (khu làm việc); desktop `zoom 1`, `cx = W/2`; `cy = (H + 0.25)/2`.
- `currentT() = max(2, floor(fitT·zoom·dpr)/dpr)` (`:109-111`) — bo `T` theo pixel thiết bị để sprite không nhoè. `clampCam()` (`:113-123`) kẹp `cx/cy` theo kích thước nhìn, tính gốc vẽ `ox, oy` (bo pixel thiết bị).
- `zoomAt(factor, sx, sy)` (`:125-137`) giữ điểm dưới con trỏ đứng yên, đặt `userMoved`, `lastInteract`, `scheduleCache()`.
- `setInsets(o)` (`:291-300`): đổi → `computeFit`, `defaultView` (nếu chưa kéo), `clampCam`, `scheduleCache`.

### 7.3 Cache: layer tĩnh, sprite nội thất, sprite động (`office.js:144-182`)

- `cacheScale() = min(T·dpr, MAX_CACHE_SCALE = 64)` px thiết bị/ô. `rebuildCaches()` (`:148-156`): `layer = renderFloorLayer(world, Tc, dpr, {logoText})`, `sprites = buildSprites(world, Tc, dpr)`, `dyn.clear()`, `cacheKey = s`. `scheduleCache()` debounce 180 ms (`:158-164`); `draw()` cũng tự lên lịch khi `cacheScale()` lệch `cacheKey` (`:323`).
- Khi `T·dpr > 64` (zoom sâu trên màn hình dpr cao) layer được **vẽ phóng to** (mờ nhẹ) — **chủ ý** để chặn bộ nhớ: canvas tĩnh tối đa ≈ (60+2)×(34+2) ô × 64² px ≈ 9,1 triệu px (~36 MB RGBA). Không phải lỗi.
- `dynSprite(name, key, x0, y0, w, h, paint)` (`:167-182`): sprite cho **bảng KPI** và **bảng trắng** — chỉ vẽ lại khi `key|scale` đổi (tái dùng canvas nếu cùng kích thước), còn lại `drawImage`. Lỗi painter chỉ `console.warn` một lần.

### 7.4 Vòng vẽ: `frame()` → `draw(now)` (`office.js:303-418`)

`frame()` tự gọi `requestAnimationFrame` và dùng **`performance.now()`** chứ không dùng timestamp của rAF (chú thích `:305-307`): mốc rAF có thể lệch `performance.now()` (Chrome headless `--virtual-time-budget`, tab vừa thức dậy) làm alpha "hiện dần" kẹt và bong bóng hiện sai lúc — `store` cũng đóng dấu bằng `performance.now()` nên phải cùng đồng hồ. Lỗi vẽ chỉ log một lần.

Thứ tự trong `draw(now)`:

1. `resize()`; `setTransform(dpr)`; clear; chưa có `world`/`layer` → dừng (`:317-320`).
2. `followCamera(now)`; `clampCam()`; kiểm cache (`:321-323`). Lấy `minute = store.clock?.minute ?? 600`, `incident = status.company.incident`, `bossAway` (`:326-329`).
3. **Hệ ô:** `drawImage(layer.canvas, −1, −1, W + 2, H + 2)` (`:334`); `drawWallClock(minute)` (kim giờ 0.5r, kim phút 0.72r từ `layer.clock`, `:787-797`); `drawEntrance(now)` (cửa kính trượt cột `x = 0`, mở khi có actor trong 2.4 ô ngang / 1.8 ô dọc, `lerp 0.12`, `:829-850`). Lưu ý `drawEntrance` duyệt **toàn bộ `store.actors`** (`:836-838`, chỉ loại `goneAt`) chứ không dùng `acts` của `prepareActors` — actor ẩn (`FLAG_HIDDEN`) hay chưa biết `look` đứng gần cửa vẫn làm cửa mở (hiện vô hại vì WC nằm xa lối vào).
4. **Px CSS, nằm dưới nhân vật:** `drawWcIndicator(now)` (`:800-827`) tại `(ox + wcDoor.x·T, oy + (wcDoor.y + 0.72)·T)`, cỡ `clamp(T·0.42, 8, 11)`, "Có người" `#dc2626` chấm nhấp / "Trống" `#15803d`.
5. `acts = prepareActors(now)` (7.6); `computeDeskInfo(acts)` (7.7).
6. **Danh sách vẽ theo y** (7.5), lọc theo khung nhìn `view` (lề 2 ô ngang, 3 ô dọc, `:349`), sắp, vẽ: `furn` → `drawImage` + `overlay(f, env)`; `chair` → `drawChairBase/Back` tại `(x + 0.5, y + 0.9 + dy)`; `actor` → `drawActor` (`:375-386`). Rồi `drawPingpongBall(acts, now)` (`:852-875`: ≥ 2 người `pingpong` đứng yên gần bàn; chu kỳ 1300 ms mỗi chiều).
7. **Hiệu ứng thế giới (hệ ô):** sếp vắng → `dimRoom(bossRoom, 0.3)`; `server_down` → `drawServerAlarm(serverRoom)`; `dark = darkness(minute)`; `drawTint(0, 0, W, H + 0.45)`; `dark > 0.05` → `drawLights(collectLights(acts, now), dark)`; `syncStageTint(minute)` đặt CSS var `--stage-tint` lên `#stage` (nền ngoài toà nhà đổi theo giờ, `style.css:84-85`; khoá làm tròn bội 3 để không set lại mỗi khung, `:427-434`).
8. **Lớp phủ px CSS** (`:398-417`): `server_down` → `drawAlarmVignette`, 🔥 tại 3 điểm mỗi tủ `rack` (`f.x + 0.9 + i·(f.w − 1.8)/2, f.y + 0.55`, cỡ `clamp(T·0.8, 12, 30)`), nhãn "🔥 SẬP SERVER!" dưới phòng server; `wifi_down` → nhãn "📶❌ Mất wifi — cả văn phòng đứng hình" lắc nhẹ tại `workRoom` (`wr.y + 3.2`); sếp vắng và có `bossDoor` → `drawSign` tại `(bossDoor.x·T, (bossDoor.y + 0.75)·T)` tiêu đề `"<icon> ĐI VẮNG"` (icon từ `bossAwayLabel(status.bossNote)`), phụ đề `awayReason(title, note)` (`:421-425`: ghi chú server bỏ chữ "Sếp", viết hoa chữ đầu, ≤ 120; trống → dùng nhãn trừ khi nhãn mặc định), `size clamp(T·0.62, 10.5, 13.5)`, `subMax clamp(T·9, 150, 220)`; cuối cùng `drawOverlays(acts, now)` (7.9).

`bossDoor` được tính trong `setMap` (`:190-203`): tâm cụm ô `'D'` quanh phòng sếp (`x + 0.5`, y trung bình) hoặc giữa mép dưới nếu không có cửa.

### 7.5 Sắp theo y — khoá của từng loại (`office.js:347-372`)

| Loại | `key` | Ghi chú |
|---|---|---|
| sprite nội thất (`furn`) | `spec.key(f)` nếu có, mặc định `f.y + f.h − 0.5` (`furniture.js:994`) | vd `plant: f.y + 0.5`, `sofa: f.y + 0.12`, `counter: f.y − 0.6`, `coffee_machine/water/sofa_back: f.y + f.h − 0.45` |
| ghế bàn làm việc — phần `base` | `seat.y + 0.45` | ghế trống đẩy sát bàn: `dy = −0.32` (facing up) / `+0.14` (down); có người ngồi → `facing = occ.viewDir`, `dy = 0` |
| ghế bàn làm việc — phần `back` | `seat.y + 0.56` | chỉ khi `facing === 'up'` (tựa ở phía nam, vẽ **sau** người ngồi để che lưng) |
| ghế bàn họp/bàn ăn | như trên (`c.y + 0.45` / `+ 0.56`) | `style` `office`/`wood` |
| actor | `a.y + 0.5` (+ 0.1 nếu `pose === 'beanbag'`) | |

Sắp `key` tăng; **bằng key thì actor sau nội thất** (`:372`). Vì sprite nội thất vươn lên trên footprint (`top`), một món có `key` lớn hơn actor sẽ che actor đứng "phía sau" nó — đúng mong muốn 3/4 view. Nếu thêm nội thất mà nhân vật bị che sai, chỉnh `key` trong `SPECS` (mục 9.3), không chỉnh vòng sắp.

### 7.6 Actor: `prepareActors`, `holdFor`, `drawActor` (`office.js:437-537`)

`prepareActors(now)` duyệt `store.actors`:

1. Alpha hiện dần 420 ms từ `bornAt`; đang `goneAt` → mờ dần 480 ms và **xoá khỏi `store.actors` sau 520 ms** (`:441-446`; store không tự dọn).
2. `FLAG_HIDDEN` → không vẽ (`alpha = 0`), và nếu `activity ∈ toilet|wc` → `wcBusy = true` (`:448-452`). `continue` ở đây xảy ra **trước** bước `actorPos`, nên `a.x/a.y` đứng yên ở vị trí vẽ cuối trong suốt lúc ở WC (keyframe vẫn được `store.onFrame` ghi vào `a.kf`); khi cờ tắt, `actorPos` nhảy thẳng tới vị trí hiện tại (thường là `jump` vì cách > 3.2 ô). Vị trí "đóng băng" này vẫn được `drawEntrance` nhìn thấy (duyệt `store.actors`, mục 7.4), còn `followCamera` tự lọc `FLAG_HIDDEN` (`:1032`) nên không bám theo người đang ở WC.
3. Chưa biết `look` (agent mới chưa có trong `store.agents` và `lookCache`) → `a.unknown = true`, bỏ qua; khi có → `bornAt = now` để hiện dần (`:453-456`).
4. `p = actorPos(a, now)`; `d` = quãng dịch giữa hai khung vẽ; `moveAmt = lerp(moveAmt, (d > 0.0008 || (FLAG_WALK && a.dur > 0)) ? 1 : 0, 0.35)`; `phase += d·9.5` khi dịch, còn khi `moveAmt < 0.3` kéo `phase` về bội của π (chân khép) (`:457-464`).
5. Ngồi: cách tâm ô < 0.14 và `moveAmt < 0.5` → `seat = world.seatAt(x, y)` → `pose = 'beanbag' | 'sit'`; sofa không trong cảnh và `dir down` → `up`; ghế bàn làm việc không trong cảnh và `DESK_ACTS` → `dir = seat.facing` (`:465-473`). Gán `a.pose, viewDir, seat, alpha, agent`.

`holdFor(a)` (`:485-495`): `coffee → cup`, `water → water`, `pingpong → paddle`, `printing → paper`, `showroom` + role **đúng bằng** `marketing` → `bag`, `window` + role **khớp regex** `/sales/` (`:492`, tức `saleslead` hoặc `salesnew` — `ROLE_ORDER` trong `labels.js:5` không có role `sales` trần) → `phone`, `FLAG_PHONE` hoặc `slacking` → `phone`, còn lại `null`. Thêm role mới có chữ "sales" sẽ tự rơi vào nhánh này.

`drawActor(a, now)` (`:497-537`): `look = a.agent?.look || store.look(id)` (không có → bỏ); vòng cam dưới chân khi `hoverId` (ellipse `0.5·charScale × 0.19·charScale`); `translate(a.x + 0.5, a.y + FEET_Y)`, `scale(charScale/U)`; `fired = status === 'fired' || emote === '📦'`; gọi `drawCharacter(ctx, look, {dir: viewDir, pose, moving: moveAmt > 0.5, phase, t: now, seed, mood: moodOf(emote, activity), talking (có bong bóng còn hạn), blink: (now + seed·997) % 4300 < 130, typing: working ∧ sit ∧ ghế bàn, napping: napping ∧ sit, hold: fired ? null : holdFor(a), carry: fired, blazer: role boss|saleslead, badge: '#f97316' nếu candidate, panic: server_fix ∨ (😰 trong 2600 ms)})`.

### 7.7 Bàn và màn hình (`office.js:540-569`)

`computeDeskInfo(acts)`: với mỗi bàn, `owner = store.deskOwner(d.id)`; `seated` nếu actor chủ bàn cách ô ghế < 0.2 cả hai trục và `moveAmt < 0.5`; không thì tìm người khác có `a.seat.deskId === d.id` (ngồi nhờ) → `{owner, actor, seated}`.

`deskScreenKind(d, info)` quyết định màn hình:

```
!owner || !owner.present || !actor      → 'off'
!seated || actor.id !== owner.id         → 'lock'
act = actor.activity; nếu act ∉ {working, slacking, napping} và có deskAct → dùng deskAct (giữ nội dung khi chủ bàn sang cảnh)
act === 'napping'  → 'sleep'
act === 'slacking' → slackScreenKind(owner.activityLabel, emote)
còn lại            → workScreenKind(owner.role)
```

### 7.8 Overlay nội thất động — `overlay(f, env)` (`office.js:572-634`)

Vẽ **mỗi khung** ngay sau sprite tĩnh của món đó (cùng vị trí trong thứ tự y):

| `f.type` | Vẽ gì |
|---|---|
| `desk` | `drawScreen(kind, deskGeom(f).screen, now, seed = (f.x·7 + f.y·13) % 97, {wifiDown})`; emoji đồ affiliate `owner.deskItem.emoji` (≤ 4 ký tự, `0.42px EMOJI_FONT`) tại `g.item` |
| `kpi_board` | `drawKpiBoard(f)` (`:638-714`): `dynSprite('kpi', key)` với `key = rev/target\|lowRatio\|(T ≥ 30 ? 'n' : 'i')\|id:pct:shirt…`; cột cho từng agent `active`, chiều cao theo `ratio` kẹp ở **1.25** và không quá `ch.h − 0.06` (`:657-658`, nên ai vượt 125 % KPI cột vẫn dừng), màu `≥ 1 → #22c55e`, `≥ lowRatio → #f59e0b`, còn lại `#ef4444`; `%` trên đầu cột (hoặc **trong** cột, chữ trắng, nếu `h > full·1.02`) — chữ `%` của cột vàng dùng `#b45309` thay vì `#f59e0b` để đọc được trên nền trắng (`:666`); chấm màu áo + `initial(name)`; tên đầy đủ khi `T ≥ 30 && slot ≥ 0.75`; dòng "💰 Doanh thu tháng x/y tr" + thanh. **Dùng ngưỡng tuyệt đối `lowRatio`**, không dùng `kpiPaceTone` |
| `whiteboard` | `drawWhiteboard(f)` (`:717-772`): `dynSprite('whiteboard', name\|client\|progress\|deadline\|day)` vào vùng `whiteboardGeom(f).dyn`: "DỰ ÁN ĐANG CHẠY", tên dự án và tên khách cắt **60** ký tự (`:720-722` — khác giới hạn 80 của tooltip ở 2.2; không có dự án → "Chưa có dự án"), `day = num(store.clock?.day, 1)` (mặc định 1 khi chưa có clock), tên tự co (0.34 → 0.16), "Khách: …", thanh % với mốc 25/50/75, màu `≥ 100 xanh \| trễ đỏ \| còn ≤ 1 ngày và < 85 % vàng \| còn lại xanh dương`, hạn: `TRỄ HẠN N NGÀY — hạn ngày D \| HẠN HÔM NAY (ngày D) \| Hạn: ngày D · còn N ngày` |
| `shelf_beauty` / `shelf_tech` | `drawShelfProducts(…, hoverProduct?.id, null, {labels: T ≥ 34})` — nhãn tên chỉ khi đủ to |
| `display_table` | `drawPodiumProduct(…, podiumTmp)` → cập nhật `podiumHit` mỗi khung (sản phẩm nổi bật đổi mỗi 25 s) |
| `tv` | `drawTvScreen(tvGeom(f).screen, now)` |
| `rack` | `drawRackLeds` (`:774-785`): LED xanh/vàng nhấp chậm; `server_down` → đỏ nhấp nhanh (chu kỳ 90) |
| `coffee_machine` | `steam(spout, now, ai đó coffee ? 1 : 0.45)` |
| `printer` | khi có actor `printing` trong 2.5 ô: tờ giấy trượt ra (chu kỳ 1400 ms) + LED xanh nhấp |
| `water` | khi có actor `water` trong 2.5 ô: 3 bọt khí nổi |
| `boss_desk` và các type khác | không có overlay (bàn sếp **không có màn hình động**) |

### 7.9 Lớp phủ chữ — `drawOverlays(acts, now)` (`office.js:916-1022`)

Tham số: `showNames = T ≥ 10.5`; `compact = cssW < 560`; `nameSize = clamp(T·0.48, 9, 11.5)`; `emoteSize = clamp(T·1.05·charScale, 17, 28)`; `unit = (charScale/U)·T` px CSS cho 1 đơn vị nhân vật; `halfW = 0.5·charScale·T`.

1. **Vị trí màn hình của từng actor** (sắp theo y rồi x): `_sx = ox + (x + 0.5)·T`, `_fy = oy + (y + FEET_Y)·T`, `_top = _fy + headTop(pose)·unit`, `_head = _fy + headCenter(pose)·unit`, `_hr = HEAD_RADIUS·unit` (`:931-934`). Ngoài khung nhìn → bỏ (bong bóng vẫn được kẹp vào mép). `alpha > 0.3` → `hits.push({id, x0: sx − halfW, x1: sx + halfW, y0: top − 0.08T, y1: fy + 0.15T})` — **vùng bấm** (`:937`).
2. **Bảng tên** (`:938-964`): bỏ nếu `alpha ≤ 0.02`, hoặc không `showNames` và không hover/không nói. Tag: `Ứng viên` (cam `#f97316`), `📦 Nghỉ việc` (xám, nền xám), sếp nền nâu `rgba(146,64,14,0.88)`. Vị trí mặc định **dưới chân** (`fy + 0.1T + 2`); người ngồi sau bàn quay mặt xuống (`behindDesk`: sit ∧ seat.facing down ∧ kind desk — tức sếp) → **trên đầu** để không che biển "GIÁM ĐỐC", và `_top` được đẩy lên trên bảng tên. Kẹp trong canvas; `spreadPills` đẩy bảng chồng nhau.
3. **Emote** (`:965-997`): bỏ nếu đang nói; `📱` khi `FLAG_PHONE` (pulse; `ping` từ `store.pings` trong 1300 ms); mặc định trên đầu (`_top − emoteSize/2 − 3`); người ngồi quay lưng (`pose ≠ stand ∧ viewDir up`) → cạnh đầu `+0.95·T·charScale` để không che màn hình/bảng tên người đối diện; đỉnh đầu sát `insets.top` → cạnh đầu về phía còn chỗ; nếu che bảng tên người khác (`coversPill`) → thử 5 vị trí thay thế.
4. **Bong bóng** (`:998-1021`): `store.bubbles` còn hạn → item `speech` (`ax = _sx, ay = _top − 2, hy = _head, hr = max(6, _hr), fy = _fy + nameSize·1.7`, màu áo, icon, cờ `product`); `store.typing` trong `[from, until]` và người đó không đang nói → item `typing` (quá `until` → xoá). `store.bubbles` lọc bỏ sau `dur + 500`. Gọi `drawBubbles(ctx, items, cssW, cssH, now, compact, insets)` (mục 9.6).

### 7.10 Ánh sáng ngày/đêm và sự cố (`office.js:390-395, 877-913`; `fx.js`)

`collectLights(acts, now)`: đèn bàn vàng ấm cho bàn có chủ **có mặt** (`r 2.4, a 0.3`), ánh màn hình theo `screenGlow(deskScreenKind)` (`r 1.9, a 0.36`), đèn bàn sếp (`r 3, a 0.38`), TV nhấp (`a 0.45·fl`), đèn rọi kệ showroom **luôn** sáng nhẹ, phòng có người (trừ `work`, `wc`) sáng ấm. Màu dạng `'rgba(r,g,b,ALPHA)'`, `drawLights` thay `ALPHA` bằng `a·dark` và cộng sáng `lighter` (`fx.js:52-66`). `darkness(minute) = clamp((1 − luma(tint))/0.42, 0, 1)` (`fx.js:34-38`) từ bảng `TINT_KEYS` (`fx.js:5-18`): đêm xanh `[104,116,188]` tới 05:00 → tím 06:40 → cam 07:20 → trắng 08:45–16:40 → vàng 17:30 → hồng 18:15 → tím 18:50 → đêm từ 19:35.

### 7.11 Nhập liệu: hover, bấm, kéo, chụm, cuộn (`office.js:1040-1163`)

- `pick(sx, sy)` (`:1040-1055`): duyệt `hits` **từ cuối** (người vẽ sau = gần hơn); không trúng → nếu trỏ vào bàn (`desk.y − 1.1 … y + h`) trả **chủ bàn** kể cả khi chủ bàn vắng (bấm bàn trống vẫn mở hồ sơ — có vẻ chủ ý).
- Pointer Events (`#office` có `touch-action: none`, `style.css:95`): `pointerdown` (`setPointerCapture`; 1 ngón → `drag`, 2 ngón → `pinch`); `pointermove`: chụm → `zoomAt(target/zoom, mx, my)`; kéo khi `zoom > 1.01` và dịch > 6 px (cursor `grabbing`); chuột rảnh → hover theo ưu tiên **sản phẩm > nhân vật > bảng** (`:1105-1120`), nhưng **chỉ khi `e.pointerType === 'mouse'`** (`:1105`) — trên cảm ứng/bút không có hover nên không có tooltip nhân vật/sản phẩm/bảng, chỉ có tap → `onPick/onProductClick/onBoardClick` qua `endPointer`; `pointerup/cancel` (`endPointer`): bấm khi không kéo → `onProductClick` / `onPick` / `onBoardClick`; `pointerleave` (chuột) xoá mọi hover.
- `wheel` (`passive: false`): `factor = exp(−clamp(deltaY, −120, 120) · (ctrlKey ? 0.01 : 0.0022))` (`:1152-1158`). `dblclick`: `zoom > 1.6` → `fit()`, ngược lại `zoomAt(2)` (`:1160-1163`).
- `updateCursor()` (`:286-288`): `pointer` khi hover bất kỳ; `grab` khi `zoom > 1.01`; `default`.

### 7.12 Camera tự theo người nói, `focusAgent`, `fit`

`followCamera(now)` (`:1025-1037`): chỉ khi `zoom > 1.05`, không kéo/chụm, ≥ 9000 ms sau tương tác cuối; theo người nói của bong bóng mới nhất (không `FLAG_HIDDEN`) với `lerp 0.025`. `focusAgent(id)` (`:1177-1187`): zoom lên `min(maxZoom, 1.8)` nếu `< 1.6`, căn vào actor, đặt `userMoved` (dùng bởi nút "📍 Xem trên bản đồ" ở hồ sơ qua `initProfile`). **Im lặng không làm gì** khi agent không có actor trong `store.actors` (đã nghỉ, đang vắng/`offsite`, hoặc chưa nhận `frame` nào) hoặc chưa có `world` (`:1178-1179` `if (!a || !world) return`) — nút trong hồ sơ người vắng vì thế không có phản hồi và UI không được báo (xem Câu hỏi còn mở). `fit()` (`:1166-1175`): `userMoved = false`, zoom 1, tâm bản đồ.

Theo dõi môi trường: `ResizeObserver(canvas)` → `resize` + `scheduleCache` (`:1194-1195`); đổi DPR qua `matchMedia('(resolution: Xdppx)')` → `resize + rebuildCaches` (`:1197-1203`).

---

## 8. `render/character.js` — nhân vật chibi vẽ thủ tục

### 8.1 Hệ toạ độ cục bộ và hằng (`character.js:3-15`)

`(0,0)` = điểm chân, `U = 24` đơn vị/ô, y âm hướng lên. `HEAD_R 10.4` (đường kính ≈ 0.87 ô), `HEAD_Y −34.0`, `TORSO_TOP −25.0` (vai), `TORSO_BOT −8.8` (cạp quần), `LEG_TOP −11.2`, `SIT 4.2` (hạ thân khi ngồi), `BEAN = SIT + 3.2 = 7.4`, `LINE_W 1.15`, `SIDE_W 10.2` (bề dày thân nhìn nghiêng, `:676`). Chiều cao tới đỉnh tóc `headTop('stand') = −47.9` ≈ 2 ô; chú thích đầu file ghi "cao ~1.95 ô, đầu ≈ 45 % chiều cao" (`:1-2`). `office.js` gọi với `ctx.translate(chân)` rồi `ctx.scale(charScale/U)` nên mọi số trong file là đơn vị cục bộ.

### 8.2 `look` → bảng màu `pal(look)` (`character.js:17-43`)

Cache ≤ 200 theo khoá `skin|hair|shirt|pants|hairStyle|accessory`. `safeColor` với mặc định `skin #f1c7a0`, `hair #2b2118`, `shirt #5b8def`, `pants #374151`. Dẫn xuất: `skinS/skinD` (tối 14 %/30 %), `hairS/hairL` (tóc tối thì sáng hơn 34 %), `shirtS/shirtL/shirtD`, `pantsS`, `shoe` (nâu nếu quần sáng, đen nếu tối), `line 'rgba(46,30,34,0.7)'`, `capColor` (xanh nếu áo sáng, không thì áo sáng 12 %), `bow` (vàng nếu áo đã hồng, không thì hồng), `cups` (đỏ). `look.hairStyle ∈ short|long|bun|ponytail|spiky|bald|curly|bob`, `look.accessory ∈ none|glasses|headphones|tie|cap|bow` (`src/types.ts:20-27`). Thiếu/rỗng → `'short'`/`'none'` (`character.js:34-35`: `look?.hairStyle || 'short'`, `look?.accessory || 'none'`); chuỗi lạ (vd `mohawk`) **không được chuẩn hoá** — giữ nguyên trong `p.style`/`p.acc` và rơi vào nhánh `else` cuối của từng painter tóc (`hairCapDown :178…`, `hairUp :309…`, `hairSide`) hoặc không khớp nhánh nào trong `accessoryFront` (`:450…`); hiệu quả nhìn ≈ tóc `short` / không phụ kiện, nhưng là do cấu trúc if/else chứ không do gán lại giá trị (khoá cache `pal` vẫn chứa chuỗi lạ).

### 8.3 Biểu cảm `moodOf(emote, act)` và mặt (`character.js:73-174`)

`act === 'napping'` → `sleep`; regex emote → `sleep (😴💤) | happy (😂🤣😆😄😁🥳🎉😍🥰😎🤩🏓😊😋🎂💰🍻🥂❤🛍🥤🧋) | shock (😰😱😨😳🔥😵🙀😬) | angry (😤😡🤬💢👿😠) | sad (😢😭😩😞😔🥲😫📦😓😥) | think (🤔🧐🤨) | neutral`. `eye`: nhắm khi `sleep`/`blink`, cung úp khi `happy`, trợn khi `shock`, mắt chibi tròng đen + ánh sáng; `brows` theo mood; `mouth`: đang nói → ellipse mở `0.5 + |sin(t/95)|·1.4` (có lưỡi khi mở > 1.0), còn lại cười/méo/tròn/ngủ/thẳng/trung tính; `sweat` giọt mồ hôi khi `shock` hoặc `panic`.

### 8.4 Bốn hướng, ba tư thế, thứ tự lớp (`drawCharacter`, `character.js:753-938`)

Tham số `o`: `dir (down|up|left|right)`, `pose (stand|sit|beanbag)`, `moving` (chỉ có hiệu lực khi `stand`), `phase`, `t`, `seed`, `mood`, `talking`, `blink`, `typing`, `napping`, `hold`, `carry`, `blazer`, `badge`, `panic`.

- Nhịp: đi → `bob = −|sin(phase)|·1.5`; đứng → thở `sin(t/820 + seed)·0.45`; `panic` → rung `sin(t/35)·0.6` ngang + `cos(t/47)·0.35` dọc (`:760-764`). Ngồi hạ thân `drop = SIT | BEAN`; ngủ gật đầu gục thêm 5.0 (nhìn sau) / 3.6.
- **Nhìn nghiêng vẽ cho hướng trái; hướng phải = `ctx.scale(−1, 1)`** (`:774`); chữ "z" khi ngủ được lật lại để không ngược (`:926-927`).
- Thứ tự lớp (từ sau ra trước): bóng (`:770-771`) → chân (`:787-806`: nghiêng = hai nét xoay quanh hông ngược chiều, chân xa trước; trước mặt = hai ống + giày với `lift` theo `sin(phase)`; ngồi quay mặt ra = đùi đưa trước + giày) → phần sau (tóc dài phía sau khi nhìn trước, đuôi tóc nghiêng, **thùng đồ khi quay lưng**, tay xa khi nghiêng nếu gõ phím/ôm thùng/đi bộ, `:808-821`) → thân `torso()` (`:555-624`: quần, áo bo tròn vai, bóng phải/sáng trái, vest `o.blazer` hai vạt sẫm + ve, cổ áo/cà vạt khi `acc === 'tie'`, huy hiệu `o.badge`; thân rung nhẹ khi gõ phím nhìn từ sau) → tay (`:831-859`: `down`: hai tay, tay phải cầm đồ `HOLD[o.hold]`, ôm thùng hoặc gõ phím; `up`: ngồi chỉ thấy bắp tay bè ra; nghiêng: tay gần xử lý riêng ở bước đầu) → **đầu** theo view: `up` = tai, gáy, `hairUp`, phụ kiện (trừ `tie`), điện thoại nếu ngồi và `hold phone`; `down` = tai, mặt (mắt/mày/má/miệng), tóc `hairCapDown` hoặc tóc lộ dưới mũ, búi/đuôi ngựa, `accessoryFront`, mồ hôi; nghiêng = **tay gần vẽ trước đầu** (không bao giờ đè mặt) trừ khi áp điện thoại lên tai (`phoneEar`, `:905`), rồi `headSide` (một mắt, mũi nhô, tai, tóc `hairSide`, phụ kiện nghiêng, nơ đuôi ngựa) (`:861-923`) → "z z z" khi `napping` (`:926-936`).

Đồ cầm `HOLD = {cup, water, phone, paddle, paper, bag}` (`:654-661`) vẽ trong hệ toạ độ đã xoay của cánh tay; `cardboard()` (`:663-673`) thùng giấy có chậu cây + cốc ló ra (người bị cho nghỉ). Tóc: `hairCapDown/hairBackDown` (nhìn trước), `hairUp` (sau lưng), `hairSide/hairSideBack` (nghiêng), `baldFringe` (`:178-447`). Phụ kiện `accessoryFront(ctx, p, hy, dir)` có nhánh riêng cho `down`/`left`/`up` với `glasses`, `headphones`, `cap`, `bow` (`:450-552`); `tie` vẽ trong `torso`.

### 8.5 Điểm neo cho lớp phủ và chân dung (`character.js:941-969`)

`headTop(pose) = HEAD_Y − HEAD_R − 3.5 + drop`, `headCenter(pose) = HEAD_Y + drop`, `HEAD_RADIUS = HEAD_R` — `office.js` dùng để đặt bảng tên/emote/bong bóng (7.9). `portrait(look, size, {full, blazer, carry, mood, t})` tạo canvas chân dung (`dpr ≤ 3`; `full` = cả người với `unitsTall 52`, mặc định đầu + vai `unitsTall 34`), dùng bởi `ui/avatar.js:38` cho thẻ nhân sự (46 px) và hero hồ sơ (104 px, full).

---

## 9. Các module vẽ còn lại

### 9.1 `render/draw.js` — hàm vẽ cơ bản

`parseColor(c)` chuẩn hoá qua canvas ẩn, cache ≤ 600 (`draw.js:8-33`); `rgba`, `shade(c, k)` (k < 0 pha đen, k > 0 pha trắng), `mix`, `alpha`, `luma` (`:35-64`). Hình: `rrPath` (bo góc theo số hoặc `[tl,tr,br,bl]`, tự kẹp ≤ min(w,h)/2), `fillRR`, `strokeRR`, `rect`, `ellipse`, `circle`, `line` (`:67-126`); `box(ctx, x, y, w, d, h, top, front, r)` khối 3/4: mặt trên = footprint dịch lên `h`, mặt trước từ `y + d − h` (`:128-135`); `topEdge`. `softShadow`/`softEllipseShadow` (`:146-174`) dùng mẹo `shadowBlur` với offset 20 000 px — **tốn kém, chỉ dùng trong layer tĩnh**. `vGrad/hGrad`; `fitText(ctx, text, cx, cy, maxW, size, weight, color, family)` co chữ tới 50 % cho vừa (`:189-201`); `FONT` (Be Vietnam Pro + fallback hệ thống), `EMOJI_FONT` (`:203-204`); `makeCanvas(w, h)` (ceil, ≥ 1).

### 9.2 `render/floor.js` — layer tĩnh

`renderFloorLayer(world, T, dpr, {logoText})` (`floor.js:722-833`) → `{canvas, T, dpr, x0: −1, y0: −1, w: W + 2, h: H + 2, clock}`; `MARGIN = 1` ô viền (bóng toà nhà, mặt tiền), `CAP = 0.2` (mép trên tường), `STRIP = 0.34` (tường dọc). Bảng màu: `WOOD.work/hall/boss`, `WALL_PAINT` theo `room.id` (work, toilet, wc, showroom, server, meeting, boss, hall, pantry, lounge), `CAP_COLOR/CAP_EDGE/OUTER_CAP/OUTER_EDGE` (`:13-34`).

Thứ tự vẽ (quyết định cái gì đè cái gì):

1. Bóng toà nhà (`softShadow`) → thềm đá + thảm lối vào bên ngoài cửa ở cột `x = 0` (`:733-745`).
2. Sàn: nền = phòng lớn nhất, rồi các phòng lớn → nhỏ (`:748-753`) qua `paintFloorType` (`:253-268`): `tile` (pantry → gạch bông Sài Gòn `paintGachBong`, còn lại ô bàn cờ 0.5), `dark` (server), `showroom`, `carpet`, `boss` (gỗ sẫm), `rug`/mặc định gỗ (`hall` dùng `WOOD.hall` dọc).
3. Thảm: `persianRug` phòng sếp, `loungeRug` góc chill, `roundRug` + `floorLogo(logoText)` trong khu làm việc với **offset cứng** `work.x + 3.6, work.y + 21.4` và `work.x + 16, work.y + 20.4` (`:756-764`).
4. Bóng nội thất `furnitureShadow` (bỏ `door_mat/sofa/sofa_back`, `:643-656`) → bóng chân tường (`:769-775`).
5. Tường từng ô (`:778-791`): `'D'` → `doorTile` (cửa ngang kề phòng `wc` → `closedDoorTile` cánh gỗ đóng, tay nắm quay vào giữa khi cửa đôi, `:476-528`); hàng 0 → `faceTile(outer)`; hàng `H − 1` → `bottomOuterTile` (mặt tiền); cột 0/`W − 1` → `sideOuterTile`; tường có sàn phía dưới → `glassFace` hoặc `faceTile`; còn lại `columnTile`. Cửa sổ hàng trên theo `windowPlan` (`:659-689`: đoạn ≥ 2 ô, chia khung 4 ô; cửa sổ bên không gần cửa, bỏ phòng toilet/server/wc/meeting).
6. Phòng kín WC: `paintClosedRoom` (mái kính mờ + biển 🚻 WC) và `wcDoorSign` trên cụm cửa (`:794-799`).
7. **Trang trí tường chỉ khi `W === 60 && H === 34`** (`:803-810`): băng rôn "CHÚNG TA LÀ MỘT GIA ĐÌNH ❤" trên đoạn tường trống dài nhất hàng `y = 7`, `x ∈ [1, 17]` (`bannerSpan`); đồng hồ treo tại `(16.5, 7.6)` r 0.38 nếu `isWall(16, 7)` → trả `clock` cho `office.drawWallClock`; bảng menu pantry `x 49.6–54.4, y = 22`; câu đối tại `x 56.15–57.85, y = 0`.
8. Thảm `door_mat` chữ "XIN CHÀO" xoay −90° (`:813-827`) → nhãn phòng `roomLabel` (bỏ `wc`; vị trí **cứng** `LABEL_POS` theo id, fallback `room.x + 0.25, room.y + 0.3`; cỡ chữ `max(0.36, 9.5/T)` ô → không nhỏ hơn ≈ 9.5 px; `:692-716`).

Bẫy: đổi vị trí phòng/tường trong `src/sim/map.ts` có thể làm `LABEL_POS`, thảm, logo lệch hoặc trang trí biến mất (đồng hồ treo tường chỉ tồn tại ở bản đồ chuẩn).

### 9.3 `render/furniture.js` — hình học, painter, registry, ghế

**Hình học dùng chung** (`furniture.js:9-112`, cũng được `office.js`/`showroom.js` dùng để đặt overlay và hit-test): `DESK_H = 0.42`; `deskGeom(f)` (`topY = y − 0.42`; màn hình rộng `min(1.56, w·0.52)` cao 0.9; `screen` lõm 0.07; `item` tại `x + w − 0.45, topY + 0.95`; `lamp`; `keyboard`); `bossDeskGeom`; `kpiGeom(f)` (panel rộng `max(f.w, 9.4)` cao 3.0; `chart`, `names`, `revenue`, `base`, `full = chart.h·0.8`); `whiteboardGeom(f)` (`board`, `inner`, `dyn` = 60 % trái cho nội dung động, `side` 37 % phải tĩnh); `shelfGeom(f)` (`n = clamp(round(w/0.8), 1, 5)` ô, `cardW = min(0.7, pitch·0.86)`, `cardH 0.7`, `slots[]`, `labelH 0.2`); `podiumGeom`; `tvGeom`; `rackGeom` (`n = round(w/2)` tủ, 6 hàng × 3 LED mỗi tủ, `seed`); `coffeeGeom` (`spout`).

**Painter theo type** (`:165-937`): `desk`, `boss_desk` (biển "GIÁM ĐỐC", màn hình quay về sếp, **không động**), `plant` (4 biến thể theo `hashStr`), `rack`, `lockers`, `whiteboard` (khung + burndown + giấy note tĩnh ở vùng `side`), `meeting_table`, `shelf`, `sofa_v`, `printer`, `pingpong`, `counter` (lò vi sóng khi `h ≥ 4`, bồn rửa `h ≥ 7`, rổ trái cây `h ≥ 9`), `coffee_machine`, `fridge`, `water`, `snack_shelf`, `table`, `tv`, `coffee_table`, `sofa`, `sofa_back`, `beanbag`, `kpi_board` (khung, tiêu đề `${f.label || 'BẢNG KPI'} HÔM NAY`, vạch 100 %/70 % **cố định** `:817-828`), `toilet`, `sink`, `shelf_beauty`/`shelf_tech` (`SHELF_THEME` `:864-867`), `display_table` (bục tròn, biển "MỚI VỀ"), `paintGeneric` cho type lạ (hộp + nhãn, `:928-937`).

**Registry `SPECS`** (`:941-970`): mỗi type có `paint`, `top` (sprite vươn lên trên footprint; mặc định `H_DEFAULT = 1.0`), tuỳ chọn `key(f)` (khoá sắp y; mặc định `f.y + f.h − 0.5`) và `padX` (`kpi_board 1.2`, `display_table 0.6`). `FLAT = {door_mat}` không tạo sprite (vẽ trong floor layer). `buildSprites(world, T, dpr)` (`:974-998`): bo toạ độ theo pixel thiết bị (`snap`), canvas riêng cho từng món với vùng `[x − padX, x + w + padX] × [y − top − 0.35, y + h + 0.3]` (`padX = 0.3 + spec.padX`); lỗi painter chỉ `console.warn`; trả `[{kind: 'furn', f, canvas, x0, y0, w, h, key}]`. **Phần vẽ ra ngoài vùng đó bị cắt** — painter cao phải khai `top` đủ.

**Ghế (vẽ động mỗi khung)**: palette `CHAIR.desk|boss|office|wood` (`:1001-1006`); `drawChairBase(ctx, cx, cy, style, facing)` (`:1009-1034`: chân sao 5 cánh + bánh xe cho ghế văn phòng, 4 chân cho gỗ; mặt ghế rộng 0.6 sếp / 0.5; tự vẽ tựa phía sau khi `facing` down/left/right); `drawChairBack(ctx, cx, cy, style, facing, behind)` (`:1037-1079`: tựa cao 1.45 sếp / 0.5 gỗ / 0.62; ghế sếp `facing down` = lưng cao bọc da đen nhô cao hơn đầu; `facing up && !behind` = tựa phía nam có nan lưới, vẽ **sau** người). `steam(ctx, x, y, t, strength)` (`:1083-1098`) hơi cà phê.

### 9.4 `render/screens.js` — màn hình động

`PAINT = {code, qa, design, sheet, mkt, tiktok, shopee, game, crypto, video, chat, news, football, lock, sleep, off}` (`screens.js:300`); mọi painter nhận `(ctx, r, t, seed)` và dùng `hash2` + `t` để hoạ tiết ổn định nhưng chuyển động. `drawScreen(ctx, kind, r, t, seed, {wifiDown})` (`:303-338`): clip vào `r`; `PAINT[kind] || offScreen`; `wifiDown` (trừ `off/sleep`) → khử màu bằng `globalCompositeOperation = 'saturation'` + phủ tối + biểu tượng wifi gạch đỏ; vệt kính phản chiếu. `screenGlow(kind)` (`:341-351`) màu ánh sáng hắt ra cho hiệu ứng đêm (`off → null`). `drawTvScreen(ctx, r, t)` (`:354-399`) đổi kênh `floor(t/30000) % 4` (bóng đá, MV, nấu ăn, thời sự) + nhiễu sáng.

### 9.5 `render/showroom.js` — phòng trưng bày

`MAX_PER_SHELF = 5` (`showroom.js:7`). `sanitizeProducts(list)` (`:10-36`): cần `id` string và xác định được `shelf` (từ `shelf` hoặc `category`), không thì bỏ; `url = safeProductUrl(p.url) || '/go/<encodeURIComponent(id)>?src=showroom'`; `image` chỉ `http(s)` ≤ 500; cắt `name 120`, `emoji 8`, `priceHint 30`, `note 400`, `tags 12`; `slot` mặc định 99; ≤ 60; sắp `slot` rồi `id`; giữ `raw`. `shelfProducts(products, shelf)` lấy ≤ 5 theo thứ tự đã sắp; `shelfOfType`: `shelf_beauty → beauty`, `shelf_tech → tech`. `imageFor(p)` (`:49-66`) tải ảnh nền (`new Image()`, `decoding = 'async'`), cache ≤ 80 URL — **không bao giờ chặn vẽ**: chưa có ảnh thì dùng emoji. `card()` thẻ trắng bo góc, dải màu theo kệ, ảnh clip hoặc emoji, viền cam khi `hot`; `label()` + `shortName()` (≤ 16 ký tự theo từ). `drawShelfProducts(ctx, f, products, hotId, out, {labels})` (`:112-134`) quầng sáng cho sản phẩm đang rê; `out` nhận rect hit-test (office.js truyền `null` và dùng `rebuildProductHits` riêng: rect theo `shelfGeom.slots` nới `−0.04/−0.06`, cao thêm `labelH + 0.3`, `office.js:229-242`). `featuredProduct(products, now)` đổi mỗi 25 000 ms; `drawPodiumProduct` (`:142-185`) emoji nổi `sin(now/900)·0.015`, thẻ giá, vòm kính vẽ **sau** sản phẩm, viền cam khi `hot`, đẩy rect vào `out`.

### 9.6 `render/bubbles.js` — thuật toán đặt bong bóng và lớp phủ chữ

- `wrap(ctx, text, maxW, font)` (`bubbles.js:13-45`): cache ≤ 400 theo `font|maxW|text`; tách từ, cắt ký tự nếu từ quá dài; tối đa 7 dòng (dòng cuối thêm `…`). `clearTextCache()` khi font web tải xong (qua `office.refresh`).
- `drawBubbles(ctx, items, vw, vh, now, compact, insets)` (`:60-154`). Cỡ chữ 12.5 (compact 12), `lineH 16.5/15.5`, tên 10.5/10, `baseW 220` (compact `min(190, vw·0.58)`), `wideW = max(baseW, min(320 | 250, vw·0.62))`, lề `m = 6`, vùng an toàn `mt = 6 + insets.top`, `mb = 6 + insets.bottom`. Kích thước: `w = max(độ rộng chữ, tên + 16 nếu có icon, 40) + 20`, `h = 14 + (tên ? 14 : 0) + dòng·lineH − 2`; typing `40 × 22`.
- **Ứng viên vị trí theo thứ tự ưu tiên** (speech): `above` (tâm trên đầu, `y = ay − 10 − h`) → `above-wide` (bản rộng hơn nếu ít dòng hơn) → `above-r`/`above-l` (lệch sang bên có nhiều chỗ, `dx = w/2 − 22`, đuôi vẫn chỉ xuống người nói) → `side` (cạnh đầu, đuôi ngang, phía có chỗ trước) → `side` bên kia → `below` (dưới chân, `y = fy + 20`). `it.sideFirst` đưa `side` lên đầu (**office.js hiện không đặt** — mã chưa nối). Typing: `above → above-r → above-l → side → side → below`.
- Chọn: `best` = ứng viên đầu tiên **vừa trong canvas** (`fits`) và **không chồng** bong bóng đã đặt (`free`, pad 4 speech / 2 typing). Nhớ `lastSlot` theo `key`: nếu vị trí cũ vẫn dùng được, chỉ "nâng hạng" lên `best` khi `best` trống rộng rãi (`pad + 14`) — tránh nhảy qua lại giữa các khung (`:120-124`). Kín chỗ → lấy ứng viên vừa canvas đầu tiên rồi **chồng lên trên** bong bóng vướng tối đa 4 lần (chỉ khi đuôi dưới và còn trên `mt`), cuối cùng chấp nhận đè (`:125-138`). `lastSlot` dọn khi > 60 khoá. Speech sắp trước typing (ưu tiên chỗ đẹp); **vẽ typing trước, speech sau**.
- `drawSpeech` (`:178-251`): bật ra từ đầu đuôi 240 ms (`easeOutBack`, scale 0.55 → 1, alpha ×1.6 nên đặc sau 150 ms), mờ dần 260 ms cuối; nền trắng, viền, vạch màu áo 3.5 px bên trái, tên màu áo (tối hơn 45 % nếu `luma > 0.62`), icon câu trong vòng tròn góc phải trên, 🛒 góc trái trên khi `product`. `drawTyping` (`:253-277`) 3 chấm nhấp, vào 200 ms / ra 250 ms. `drawEmote(ctx, x, y, emoji, since, now, {size, pulse, ping, alpha, bg})` (`:280-319`): bật 320 ms khi `since` đổi, `pulse` cho 📱, vòng xanh lan 1200 ms khi `ping`, mũi nhọn chỉ xuống.
- Bảng tên: `measureNamePill(ctx, name, {size, dot, tag})` → `{w, h = fs·1.7, tw, dot, tagW}`; `spreadPills(items)` đẩy bảng chồng nhau xuống (hoặc lên nếu `up`), tối đa 4 lần; `drawNamePill(ctx, x, y, name, {size, dot, tag, tagBg, bg, alpha, highlight})` (`:322-391`). `drawSign(ctx, x, y, title, sub, {size, subMax, hang, sway, t, bg, border, color, subColor})` (`:420-466`) biển treo có móc, phụ đề ≤ 2 dòng ưu tiên ngắt ở `" · "` (`wrapSub`).

### 9.7 `render/fx.js` — hiệu ứng

`tintAt(minute)` nội suy tuyến tính trong `TINT_KEYS` (`fx.js:5-31`); `darkness` (`:34-38`); `drawTint` phủ `multiply` (bỏ nếu gần trắng, `:41-49`); `drawLights` cộng sáng `lighter` với gradient tròn (`:52-66`); `drawServerAlarm(ctx, room, t)` đỏ nhấp clip trong phòng + đèn xoay hai cánh (`:69-100`); `drawAlarmVignette(ctx, w, h, t)` viền đỏ toàn canvas px CSS (`:103-110`); `drawFlames(ctx, pts, t, size)` emoji 🔥 nhún (`:113-127`); `drawFloatLabel(ctx, x, y, text, bg, fg, t, pulse)` nhãn viên thuốc 24 px (`:130-150`); `dimRoom(ctx, room, a = 0.3)` (`:153-159`).

---

## 10. Cách thêm / sửa những thứ hay gặp

### 10.1 Thêm một loại nội thất mới
1. Khai báo trong `src/sim/map.ts` (`FURNITURE`: `type, x, y, w, h, blocked, label?, owner?`) — phía server quyết định đi được hay không; xem [03](03-mo-phong-the-gioi.md).
2. `render/furniture.js`: viết `paintXxx(ctx, f)` trong **hệ ô** (dùng `box`, `fillRR`…; chi tiết ngẫu nhiên phải dùng `hash2`/`hashStr(f.x, f.y)`), thêm vào `SPECS` với `top` đủ cao (phần vươn lên trên footprint) và `key` nếu thứ tự che với nhân vật chưa đúng (7.5). Không khai báo → `paintGeneric` (hộp có nhãn) vẫn vẽ được, không vỡ.
3. Có phần động (màn hình, đèn, hơi…) → thêm `case` trong `office.overlay()` (7.8) và, nếu cần hình học, một `xxxGeom(f)` export từ `furniture.js`.
4. Cần bóng khác mặc định → `floor.js furnitureShadow`; là vật phẳng không muốn sprite → thêm vào `FLAT` và vẽ trong `renderFloorLayer`.
5. Muốn người ngồi được → `world.js seats` (mục 6) và cân `drawChairBase/Back` nếu là ghế kiểu mới.

### 10.2 Thêm phòng hoặc đổi bản đồ
`src/sim/map.ts ROOMS` (id, label, floor) → `floor.js`: `WALL_PAINT[id]` (màu tường), `paintFloorType` nếu `floor` mới, `LABEL_POS[id]` (vị trí nhãn; không có thì góc phòng), `labels.js ROOM_ICONS[id]`; `windowPlan okRoom` nếu không muốn cửa sổ. Phòng kính → `world.js glassRooms` (`:44`). Đổi kích thước khác 60×34 → trang trí tường và đồng hồ **tắt** (9.2); logo/thảm trong khu làm việc dùng offset cứng.

### 10.3 Thêm kiểu màn hình
`screens.js`: viết painter `(ctx, r, t, seed)`, thêm vào `PAINT` và (nếu cần) `screenGlow`; ánh xạ từ hoạt động trong `labels.js slackScreenKind` (từ khoá **không dấu** + emote) hoặc `workScreenKind` (theo role).

### 10.4 Thêm hoạt động (`Activity`)
`src/types.ts Activity` + server; client: `labels.js ACT` (nhãn/tone — bảng `const ACT` **không export**, `labels.js:78`, chỉ dùng nội bộ qua `statusBadge` `:110` và `activityText` `:126`; sửa ngay trong file, không import được), `office.holdFor` (đồ cầm → cần `HOLD` mới trong `character.js` nếu là đồ mới), `slackScreenKind` nếu là kiểu lười mới, `DESK_ACTS` nếu phải ngồi quay vào bàn, `overlay` printer/water nếu kích hoạt hiệu ứng nội thất.

### 10.5 Thêm thông điệp WebSocket hoặc trường mới
`src/types.ts ServerMsg` → `store.handleMessage` (thêm `case`, chuẩn hoá bằng `str/num/arr`, `emit`) → consumer (`office.js` đọc `store` trong rAF, hoặc `store.on` trong UI — nhớ `store.on` trả hàm huỷ đăng ký nếu consumer có vòng đời ngắn, mục 1.2). Loại lạ hiện bị bỏ qua nên có thể deploy server trước. Quy trình thêm trường an toàn: [02 §9.1](02-kien-truc-va-giao-thuc.md).

### 10.6 Thêm hook canvas → UI
Thêm `hooks.onXxx?.(…)` trong `office.js`, truyền hàm trong `createOffice(...)` ở `main.js:30-38`; canvas gọi hook khi **có** hoặc **đổi** (xem `setHoverProduct/setHoverBoard`), UI chịu trách nhiệm dựng DOM.

---

## 11. Hiệu năng và đo lường

### 11.1 Ngân sách mỗi khung vẽ
Mỗi rAF: 1 `drawImage` layer tĩnh + ~N sprite nội thất trong khung nhìn + ghế (vẽ thủ tục, rẻ) + ≤ 10–11 nhân vật (vài trăm lệnh path mỗi người) + overlay động (màn hình bàn mỗi khung; bảng KPI/bảng trắng chỉ `drawImage` nhờ `dynSprite`) + tint/lights (gradient, chỉ khi tối) + chữ (bong bóng dùng cache ngắt dòng). Những thứ tốn kém **không** nằm trong vòng khung: `softShadow` (layer tĩnh), `buildSprites`, `renderFloorLayer` — chỉ chạy khi `cacheScale()` đổi (debounce 180 ms) hoặc `refresh()`.

### 11.2 Cache và DPR
- `dpr = clamp(devicePixelRatio, 1, 3)`; `T` bo theo pixel thiết bị (`currentT`) để sprite khớp lưới pixel; `ox/oy` cũng bo.
- `MAX_CACHE_SCALE = 64`: trần px thiết bị/ô cho layer và sprite → bộ nhớ ổn định (~36 MB RGBA tối đa cho layer), đổi lại hơi mờ khi zoom sâu trên dpr 3.
- Cache chữ: `wrapCache` ≤ 400, `palCache` ≤ 200, `colorCache` ≤ 600, ảnh sản phẩm ≤ 80 — tất cả có trần để không rò bộ nhớ qua nhiều ngày chạy liên tục.
- Đổi DPR (kéo cửa sổ sang màn hình khác) → `matchMedia('(resolution: …dppx)')` kích `rebuildCaches` ngay (không debounce).

### 11.3 Đồng hồ
Toàn vùng dùng **một** đồng hồ `performance.now()`: `store` đóng dấu `t0/bornAt/emoteAt/pings/typing`, `office.frame()` lấy `now` cùng nguồn (không dùng timestamp rAF). Trục giờ **server** chỉ xuất hiện qua `frameTime` (neo `ts` ↔ `performance.now()`); UI đồng hồ trong game dùng `store.clock.minute` (phút trong ngày game), không phải giờ máy.

### 11.4 Móc QA headless
- `window.__vpa.store`, `window.__vpa.actorPos` (`main.js:3-4`); `document.getElementById('office').__view()` (`office.js:1210`). Repo **không có** script dùng chúng (`grep __vpa|__view` chỉ ra `public/js/main.js` và `public/js/render/office.js`; `scripts/` chỉ có script server-side chạy bằng `tsx` — `smoke.ts`, `smoke-story.ts`, `test-llm.ts`, `test-news.ts`, `test-router.ts`, `eyeball-hr.ts` và thư mục `fixtures/` — không có script trình duyệt) — script đo độ mượt do chủ dự án chạy ngoài repo (cần kiểm tra).
- Ví dụ đo nhanh trong DevTools (không sửa code):
  ```js
  const s = window.__vpa.store;
  ({ buffer: s.net.buffer, late: s.net.lateFrames, frames: s.net.frames, frameDt: s.frameDt, actors: s.actors.size,
     view: document.getElementById('office').__view() })
  ```
  `buffer` ổn định gần 260–350 và `late/frames` nhỏ là mạng êm; `buffer` dính 700 là jitter quá lớn hoặc server phát không đều.
- Không có test tự động cho `public/js` (`npm test` = `typecheck && smoke && smoke:story && test:news && test:llm && test:router`, `package.json:14`, đều server-side); kiểm render bằng mắt theo `docs/preview/` (ngày/chiều, mobile, sếp vắng + sập server, nhân vật nhìn ngang, showroom cận cảnh). Xem [11-kiem-thu-qa.md](11-kiem-thu-qa.md).

---

## 12. Chỗ tài liệu cũ lệch với code (đã đối chiếu 2026-11-02)

- `SPEC.md §8` (dòng 840–848) mô tả **thanh trên cùng v1** và chip "🤖 GPT…" — đã thay bằng HUD nổi trên canvas, chip AI chỉ admin ([v2-contract.md §6](v2-contract.md), [ui-polish-todo.md §1, §9](ui-polish-todo.md)). `SPEC.md:828` nói mã dev cất trong `sessionStorage['vpa.dev']` — thực tế `localStorage` (+ di trú một lần từ sessionStorage) **và** cookie HttpOnly `vpa_dev` (`net.js:13-37`).
- [v2-contract.md §5](v2-contract.md) ghi `office.setCharacterScale(n)` "default = the new bigger size" — code hiện `DEFAULT_CHAR_SCALE = 1` vì kích thước lớn đã được đưa thẳng vào `character.js` (`U = 24`); API tồn tại nhưng không UI nào gọi.
- `README.md` §13 (dòng 553) chỉ tả `public/` bằng một dòng; tài liệu này là nơi mô tả chi tiết.

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật | Kiểm tra |
|---|---|---|
| Thứ tự `init*`/`connect()` trong `main.js`, thêm module UI | mục 2 (bảng bước); [08](08-frontend-giao-dien.md) | mở trang mới: module nhận được `hello` lần đầu; tải lại khi server đang chạy |
| Hooks `createOffice` (thêm/đổi tham số) | mục 2.1, 10.6; [v2-contract.md §5](v2-contract.md) | hover/click nhân vật, kệ, bục, bảng KPI, bảng trắng trên desktop + chạm trên mobile |
| `net.js`: backoff, ping, cách lưu mã dev, `/api/dev/*`; `src/server.ts` `MAX_MSG_BYTES`/`parseClientMsg`, `handleDevCookie` | mục 3; [02 §5.1, §8](02-kien-truc-va-giao-thuc.md); [08](08-frontend-giao-dien.md) (bảng dev) | tắt server → banner → bật lại tự nối; mở `#dev=` sai mã không được bảng dev; nút 🚪 thoát hẳn (kiểm cookie trong DevTools); lệnh dev mới gửi qua `send()` vẫn < 2048 byte |
| `store.on`/`emit`, thứ tự `createOffice` ↔ `init*` | mục 1.2, 4.2 (cột "Ai nghe"), 7.1 | listener `hello` của canvas vẫn chạy trước `main.js`; `rebuildProductHits` được gọi sau `setMap` |
| `store.js`: trường mới, sự kiện mới, chuẩn hoá | mục 4.1–4.3, 4.7; [02 §5](02-kien-truc-va-giao-thuc.md) nếu thông điệp đổi | `npm run typecheck` (phía server), nạp trang, `window.__vpa.store` có trường mong đợi |
| `NET_BUFFER_*`, `NET_SLACK_MIN`, `KF_MAX`, `TELEPORT_TILES`, `frameTime/actorPos` | mục 4.6; [02 §10](02-kien-truc-va-giao-thuc.md) | quan sát `store.net.buffer/lateFrames` trên **site thật qua Cloudflare** 5–10 phút; nhân vật không đi–khựng–đi |
| `FRAME_MS`/`AGENTS_MS` phía server | mục 4.6 (cân lại hằng), [02 §3.3](02-kien-truc-va-giao-thuc.md) | như trên |
| `office.js` camera (`computeFit`, `defaultView`, `maxZoom`, insets) | mục 7.2 | desktop ≥ 1280, 900–1280, mobile < 640 và < 900; thu gọn sidebar (ticker); bong bóng không chui dưới HUD/ticker |
| `MAX_CACHE_SCALE`, `scheduleCache`, `dynSprite` | mục 7.3, 11.2 | zoom sâu trên dpr 2–3: bộ nhớ tab ổn định, không giật khi zoom |
| Thứ tự lớp trong `draw()` hoặc `key` sắp y | mục 7.4–7.5 | người đứng trước/sau bàn, sofa, kệ, cây; biển WC dưới người đứng trước cửa |
| `prepareActors`, `holdFor`, `drawActor`, `deskScreenKind` | mục 7.6–7.7 | ngồi/đứng/đi/beanbag; ngủ gật; chủ bàn vắng → màn hình `off`; người khác ngồi nhờ → `lock`; `deskAct` giữ khi sang cảnh |
| `overlay()` thêm/sửa case | mục 7.8, 10.1 | từng món trong `docs/preview/v2/*.png` |
| `drawOverlays` (bảng tên, emote, bong bóng) hoặc `bubbles.js` | mục 7.9, 9.6 | 3–4 người nói gần nhau; người ở mép canvas; sếp sau bàn; `insets` khác 0; mobile `compact` |
| `fx.js TINT_KEYS`, `collectLights` | mục 7.10, 9.7 | tua tốc độ x10 qua một ngày (bảng dev) — ảnh `preview-1-sang`/`preview-2-chieu` |
| `character.js` (hằng, palette, tư thế, phụ kiện, `HOLD`) | mục 8; `headTop/headCenter` ảnh hưởng vị trí bong bóng (7.9) | 8 kiểu tóc × 6 phụ kiện × 4 hướng × 3 tư thế; chân dung `ui/avatar.js` (thẻ nhân sự, hồ sơ); `docs/preview/v2/nhan-vat-*.png` |
| `furniture.js SPECS`/geom | mục 9.3, 10.1; `office.js` nếu geom dùng cho overlay/hit-test | sprite không bị cắt (tăng `top`/`padX`), hit-test kệ/bục/bảng vẫn đúng |
| `floor.js` (sàn, tường, trang trí, `LABEL_POS`) | mục 9.2, 10.2 | so với `docs/preview/v2/desktop.png`; WC cửa đóng + biển; nhãn phòng đọc được ở zoom mặc định |
| `screens.js PAINT`, `labels.js *ScreenKind` | mục 9.4, 10.3 | mỗi kind có painter (không rơi về `off` ngoài ý muốn); `wifi_down` khử màu |
| `showroom.js`/`store.normProduct` (schema `ShowroomProduct`) | mục 4.7, 9.5; [08](08-frontend-giao-dien.md) (tab Sản phẩm); `src/types.ts:172-179` | 2 kệ × ≤ 5 món, bục đổi 25 s, hover/click mở `/go/<id>?src=showroom` |
| `src/sim/map.ts` (phòng, bàn, nội thất) | mục 6, 9.2, 10.2; [03](03-mo-phong-the-gioi.md) | `prepareWorld` không trả `null`; trang trí/nhãn không lệch; ghế bàn họp khớp `SPOTS` server |
| `window.__vpa`/`canvas.__view` | mục 11.4; [11](11-kiem-thu-qa.md) | script QA (ngoài repo) vẫn chạy |

---

## Câu hỏi còn mở / cần kiểm tra

1. **`#dev=` rỗng không xoá cookie** (`net.js:59-60` chỉ `writeStored('')`, không gọi `/api/dev/logout`) → server vẫn coi socket là dev qua cookie `vpa_dev`. Nên sửa code (gọi logout khi token rỗng) hoặc sửa chú thích `net.js:2-3`.
2. `store.hiddenActors()`/`wcOccupied()` không có consumer; `office.prepareActors` tự tính `wcBusy` với điều kiện khác (cờ 8 **và** `toilet|wc`). Nên bỏ một để tránh hai nguồn sự thật.
3. `labels.workScreenKind('boss') → 'chart'` nhưng `screens.PAINT` không có `chart` (rơi về `off`); hiện không tới được vì `boss_desk` không có overlay. Thêm painter hoặc đổi về `sheet` trước khi ai đó vẽ màn hình cho bàn sếp.
4. `bubbles.drawBubbles` hỗ trợ `it.sideFirst` nhưng `office.js` không bao giờ đặt — mã chết hoặc tính năng chưa nối (ý định: người ngồi quay lưng ở bàn thì bong bóng sang bên để không che màn hình).
5. Trang trí tường, `LABEL_POS`, `roundRug/floorLogo` hard-code cho bản đồ 60×34; đổi `src/sim/map.ts` sẽ lệch/biến mất. Cân nhắc đưa vị trí vào `MAP_DATA` (vd `decor[]`) để client đọc.
6. `window.__vpa`/`canvas.__view` không có script nào trong repo dùng (đã `grep` toàn repo 2026-11-02: chỉ `main.js` và `office.js` nhắc tới) — script đo độ mượt của chủ dự án chạy ngoài repo (**cần kiểm tra**); nên commit script hoặc ghi cách dùng vào [11](11-kiem-thu-qa.md).
7. Hai bộ chuẩn hoá sản phẩm (`store.normProduct`: `priceHint 24`, `note 300`, `slot = i`; `showroom.sanitizeProducts`: `30`, `400`, `slot 99`, `image` chỉ http(s)) — nên gom về một.
8. Toast DOM (`#toasts`, `top: 48px`, z 7, `style.css:257-258`) đôi khi đè bong bóng thoại: canvas chỉ né HUD/ticker qua `setInsets`, không biết vùng toast. Gợi ý: cộng chiều cao toast đang hiện vào `insets.top`, hoặc đổi vị trí toast.
9. `store.net` không reset khi `hello`; hoạt động đúng nhờ ngưỡng neo lại 60 s, nhưng khung đầu sau reconnect có thể dùng neo cũ. Cân nhắc reset `tsBase` trong `onHello`.
10. `office.setCharacterScale(n)` tồn tại nhưng không UI/hook nào gọi; [v2-contract.md §5](v2-contract.md) mô tả mặc định không khớp (`DEFAULT_CHAR_SCALE = 1`). Bỏ API hoặc sửa tài liệu hợp đồng.
11. `office.pick()`: bấm bàn trống vẫn mở hồ sơ chủ bàn kể cả khi chủ bàn vắng (`store.deskOwner` không kiểm `present`) — có vẻ chủ ý (xem hồ sơ người vắng), cần xác nhận với chủ dự án.
12. `store.frameDt` được tính nhưng không consumer nào ngoài móc QA — giữ làm chỉ số hay bỏ?
13. `overlay('desk')` vẽ emoji `deskItem` bằng `EMOJI_FONT 0.42` ô — ở `T` nhỏ (< 12 px) thành vệt; cân nhắc ẩn dưới ngưỡng như đã làm cho nhãn kệ (`T ≥ 34`).
14. Font Google (`index.html:10-12`) là yêu cầu ra bên thứ ba duy nhất; offline/bị chặn → đo chữ khác, `office.refresh()` chỉ chạy khi `fonts.ready` resolve. Cân nhắc self-host font trong `public/` để hưởng cache `/v/<ver>/`.
15. Không có test tự động cho `public/js`; nên thêm smoke headless (Playwright/Chrome headless) dùng `__vpa`/`__view` đo `buffer`, số actor, `hits`, và chụp so ảnh `docs/preview/`.
16. `MAX_CACHE_SCALE = 64` làm layer tĩnh mờ nhẹ khi `T·dpr > 64` — là trade-off bộ nhớ có chủ ý, ghi ở đây để không bị coi là lỗi; nếu máy mạnh phổ biến có thể nâng lên 96 và đo bộ nhớ.
17. `office.focusAgent(id)` im lặng khi agent không có actor (vắng mặt, đã nghỉ, chưa có `frame`) hoặc chưa có `world` (`office.js:1178-1179`) — nút "📍 Xem trên bản đồ" trong hồ sơ người vắng không phản hồi gì. Nên trả `boolean` để `ui/profile.js` ẩn nút hoặc hiện toast "đang vắng mặt".
18. Listener `store.on('hello')` trong `office.js:1206` gần như trùng với `pushProducts()` của `main.js` (cả hai gọi `setProducts` với cùng dữ liệu; lần đầu còn chạy khi `world === null`). Giữ một đường (gợi ý: giữ `main.js` vì nó chạy sau `setMap`) hoặc ghi rõ trong [v2-contract.md §5](v2-contract.md) rằng canvas tự lấy `hello.products` để không phụ thuộc UI.
19. `drawEntrance` duyệt `store.actors` thay vì `acts` (`office.js:836-838`): actor ẩn/chưa biết `look` cũng mở cửa. Hiện vô hại vì cửa và WC cách xa nhau; nếu bản đồ đổi, cân nhắc dùng `acts`.
20. Mâu thuẫn giữa các tài liệu được rà ngày 2026-11-02 (số loại cảnh 23/24, số commit, tên model Groq, số đường đọc `process.env`, ai xử lý sự kiện dev `deal`/`release`, số chỗ sửa khi thêm `DevEventName`, phạm vi docs chưa commit) **không có mục nào thuộc tài liệu này** — tài liệu 07 không nhắc các con số đó; sửa ở 01/02/04/05/09/12/13/14.
