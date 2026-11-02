# Quy ước đóng góp & bảo trì tài liệu

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: quy trình làm việc trên toàn dự án — `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/`, `public/`, `scripts/`, `deploy/`, `data/`, `docs/`, `README.md`, `SPEC.md`, `CHANGELOG.md`, `CLAUDE.md`/`AGENTS.md`, `docs/README.md` — không mô tả riêng một module nào · Đọc khi: sắp sửa / thêm / xoá bất kỳ chức năng nào; trước khi commit hoặc chạy `bash deploy/deploy.sh`; khi là agent AI vừa nhận một việc trong dự án này; khi không biết "sửa file này thì phải cập nhật tài liệu nào".

Tài liệu này trả lời ba câu hỏi: (1) viết code trong dự án này phải theo quy ước gì và vì sao; (2) một thay đổi đi từ ý tưởng tới site thật qua những bước nào, kèm công thức từng bước cho 8 việc hay gặp (thêm provider AI, loại cảnh, sản phẩm, phòng/nội thất, biến env, route API, tab sidebar, đổi roster); (3) **tài liệu phải được cập nhật thế nào mỗi khi code đổi** — đây là yêu cầu bắt buộc của chủ dự án, không phải khuyến nghị. Nó không chép lại nội dung kỹ thuật của các tài liệu khác mà trỏ tới: [`01-tong-quan.md`](01-tong-quan.md) (bức tranh chung, nguyên tắc, lịch sử), [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md) (giao thức, `src/types.ts`), [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) (biến môi trường, dữ liệu trên đĩa), [`10-van-hanh-deploy.md`](10-van-hanh-deploy.md) (deploy, nginx, admin), [`11-kiem-thu-qa.md`](11-kiem-thu-qa.md) (test, QA hình), [`12-quyet-dinh-thiet-ke.md`](12-quyet-dinh-thiet-ke.md) (ADR), [`13-viec-con-lai-va-y-tuong.md`](13-viec-con-lai-va-y-tuong.md) (sổ việc đang mở §1, lỗi đã biết §2, ý tưởng §3). Mọi số dòng dưới đây đúng tại thời điểm 2026-11-02; khi sửa file hãy coi tên hàm/biến là mốc chính, số dòng chỉ để tìm nhanh.

---

## 1. Quy ước mã nguồn

### 1.1 Server — TypeScript trong `src/` và `scripts/`

| Quy ước | Vì sao / ràng buộc | Kiểm chứng ở |
|---|---|---|
| TypeScript **strict**, `target ES2022`, `module` + `moduleResolution` = `NodeNext`, `noEmit`; **không có bước build**, chạy thẳng bằng `tsx` | `npm start` = `tsx src/server.ts`, `npm run dev` = `tsx watch src/server.ts`; pm2 trên VPS cũng chạy `npm start` nên `tsx` (devDependency) **bắt buộc có ở production** — `deploy.sh:44` dùng `npm install --include=dev` | `tsconfig.json`, `package.json`, `deploy/deploy.sh:44` |
| Import tương đối **phải có đuôi `.js`** dù file nguồn là `.ts`; kiểu dùng `import type` | Gốc: `package.json` có `"type": "module"` (`:6`) → Node chạy ESM thật, và `moduleResolution: NodeNext` đòi đường dẫn đầy đủ, không tự thêm đuôi; SPEC §0.7 quy định. Hiện 0 import nào trong `src/` và `scripts/` thiếu `.js` | `package.json:6`, `src/server.ts:9-16`, `SPEC.md:31-32` |
| `tsconfig.include = ["src", "scripts"]` → script test cũng được typecheck | Lỗi kiểu trong `scripts/*.ts` làm `npm run typecheck` đỏ và `npm test` dừng ngay bước 1 dù `src/` sạch | `tsconfig.json`, `package.json` (`test`) |
| **Không thêm npm dependency**: chỉ `dotenv`, `openai`, `ws` (+ dev `tsx`, `typescript`, `@types/node`, `@types/ws`) | SPEC §0.6; VPS 1 vCPU/2 GB dùng chung, càng ít thư viện càng ít rủi ro | `package.json`, `SPEC.md:29-30` |
| Node ≥ 20 (README §1); `package.json` **không** có trường `engines`; máy dev đang dùng v20.18.2 | Nếu cần chặn Node cũ thì thêm `engines` — nhớ `deploy.sh:23` chỉ *in* `node -v` của VPS, không kiểm tra | `README.md:22` |
| Định dạng theo mã hiện có: thụt 2 khoảng trắng, nháy đơn, có dấu chấm phẩy, dấu phẩy cuối trong object/mảng nhiều dòng, dòng dài ~120–140 ký tự được chấp nhận; **chưa có ESLint/Prettier** | Không có công cụ ép → người sửa phải tự giữ đồng nhất với file đang mở | `package.json` (không có eslint/prettier trong devDependencies) |
| **Không bao giờ để một lỗi lẻ làm sập livestream**: mã ở ranh giới (đọc file, JSON từ mạng, snapshot, dữ liệu client) nhận `unknown`, kiểm tra rồi mới dùng, luôn có đường lui | `process.on('uncaughtException' / 'unhandledRejection')` chỉ ghi log (`src/server.ts:520-521`; file 570 dòng, sau hai handler còn `server.listen` + khối log khởi động); `Brain` "không bao giờ throw" (`src/types.ts`, interface `Brain`); `offlineScene()` nuốt lỗi và dùng `emergencyScene` (`src/ai/offline.ts:5065`); `products.ts` bỏ mục hỏng + `console.warn`, file hỏng → danh sách rỗng (`src/content/products.ts:129`); `sanitizePersona()` kẹp mọi trường của roster (`src/sim/world.ts:239`); `prepareWorld()` phía client trả `null` nếu bản đồ sai (`public/js/render/world.js:5`) | các vị trí nêu bên |
| Cấu hình đọc qua `CONFIG` (`src/config.ts:252`) với 4 hàm `num/bool/str/limit` (`config.ts:4-13`); **không** đọc `process.env` rải rác | Ba đường đọc `process.env` ngoài `CONFIG` đang tồn tại (ghi nhận, **không nhân rộng**; cùng cách đếm với [`09`](09-cau-hinh-du-lieu.md) §2.3): (1) `SHOWROOM_SCENE_MIN_MINUTES` đọc **thẳng** ở `src/sim/director.ts:65` (`showroomMinMs()`); (2) `DEBUG_PROMPTS` đọc thẳng ở `src/ai/llm.ts:279`; (3) nhánh **dự phòng** của `cfgNum/cfgBool` (`director.ts:75-91`: thử khoá camelCase trong `CONFIG` → `process.env[env]` ở `:81`/`:88` → mặc định) — chỉ chạy khi `CONFIG` thiếu khoá, nên thêm khoá vào `CONFIG` là đủ | `src/config.ts`, `src/sim/director.ts:65-91`, `src/ai/llm.ts:279` |
| Hợp đồng kiểu dùng chung nằm ở `src/types.ts`; đầu file ghi "Không đổi shape nếu không cập nhật SPEC.md" — nay hiểu là **cập nhật `docs/02` §9 và SPEC** | Thêm trường → ưu tiên **tuỳ chọn / additive** để snapshot `data/state.json` cũ và client cũ còn đọc được (mẫu: các trường v3 `traitBase?`, `probationUntilDay?` trong `PublicAgent`) | `src/types.ts:1-4`, `docs/02` §9 |
| Bảng tra theo `RoleKey` / `SceneType` khai báo là `Record<…, …>` **đầy đủ** để TypeScript báo thiếu khi thêm khoá; chỉ dùng `Partial<Record>` khi cố ý thưa | Nhờ vậy "thêm loại cảnh" hay "thêm vai" không bị sót chỗ (xem §3.2, §3.8) | `SCENE_DEFS` (`scenes.ts:88`), `SCENE_DIRECTION` (`prompts.ts:109`), `BUILDERS` (`offline.ts:4558`), `ROLE_INFO` (`roster.ts:12`), `DESK_TAGS` (`brain.ts:47`) |
| **Chuỗi người đọc = tiếng Việt có dấu** (log console, toast, thoại mẫu, nhãn, thông điệp lỗi HTTP như `'Không tìm thấy sản phẩm'`); định danh, tên file, khoá JSON = tiếng Anh; log có tiền tố vùng trong ngoặc vuông | Người xem và chủ dự án là người Việt; tiền tố giúp lọc log pm2 — hiện có 12: `[world]`, `[products]`, `[archive]`, `[ai]`, `[ws]`, `[http]`, `[showroom]`, `[server]`, `[news]`, `[director]`, `[config]`, `[click]` (đếm bằng `grep -rhoE "'\[[a-z]+\]" src`; vùng mới dùng tiền tố mới thì thêm vào danh sách này) | `src/server.ts`, `src/ai/router.ts`, `src/content/products.ts`, `src/sim/archive.ts` |
| Mỗi file mở đầu bằng khối comment nói vai trò + trỏ tài liệu liên quan (`docs/v2-contract.md §2`, `SPEC §4`…) | Agent AI đọc file lẻ vẫn định vị được | ví dụ `src/content/products.ts:1-7`, `src/sim/behavior.ts:1-2` |
| Hai đồng hồ: chính sách AI/nhịp cảnh dùng `now()` tiêm được (test chạy giờ ảo), hạn chót HTTP dùng `Date.now()` thật | Sửa Router/Brain/Director đừng thay `clock()` bằng `Date.now()` — smoke/test-llm/test-router sẽ sai nhịp | `docs/05` §1, `docs/11` §3 |

### 1.2 Trình duyệt — JavaScript thuần trong `public/`

| Quy ước | Vì sao / ràng buộc | Kiểm chứng ở |
|---|---|---|
| ES module thuần, **không framework, không build, không ảnh ngoài** (SPEC §0.6). Phụ thuộc ngoài duy nhất: Google Fonts "Be Vietnam Pro" | Không có typecheck cho `public/` → sai cú pháp chỉ lộ khi chạy thật (xem §2 bước 4) | `public/index.html:10-12`, `SPEC.md:30` |
| **Mọi chuỗi từ server/AI chỉ vào DOM qua `textContent`/`createTextNode`**: dùng `el()` (`props.text`) và `setText()`; không `innerHTML` | Thoại do AI viết là dữ liệu không tin cậy | `public/js/util.js:2, 125, 162` |
| Màu chỉ qua `safeColor()` (`util.js:72`), link sản phẩm chỉ qua `safeProductUrl()` (`util.js:79`, phải bắt đầu `/go/`), ảnh qua `safeImageUrl()` | `/go/<id>` để server đếm click và không mở open-redirect | `public/js/util.js`, `public/js/ui/products.js` |
| Ranh giới module: `render/**` (canvas) **chỉ đọc `store`** qua getter; `ui/**` + `main.js`, `store.js`, `net.js`, `labels.js`, `util.js` lo DOM; dữ liệu chảy một chiều `net.js` → `store.handleMessage()` → `store.emit()` → render/ui | Hai người có thể sửa song song; canvas không nhận dữ liệu qua tham số | `docs/v2-contract.md:86-96`, `docs/07` §1 |
| `index.html` giữ `href`/`src` **tương đối** cho `.css`/`.js` (`style.css`, `js/main.js`); server tự viết lại thành `/v/<ASSET_VERSION>/…`; **không** hard-code `/v/...` | Regex ở `src/server.ts:150-153` chỉ bắt đường dẫn tương đối; thêm/sửa bất kỳ file nào trong `public/` rồi khởi động lại là `ASSET_VERSION` đổi (sha1 của đường dẫn + kích thước + mtime mọi file **trừ file/thư mục bắt đầu bằng `.`** — `server.ts:134` `if (n.startsWith('.')) continue`; toàn hàm `computeAssetVersion()` `server.ts:129-146`) → người xem không bị cache cũ | `src/server.ts:129-160`, `docs/02` §7 |
| Module UI mới cần dữ liệu `hello` phải gọi `init*()` **trước** `connect()` (dòng cuối `main.js`) và đăng ký `store.on(...)` trong `init` | `hello` chỉ phát một lần; đăng ký muộn là mất | `public/js/main.js:43-55, 236`, `docs/07` §2 |
| Người xem thường **không thấy gì về hệ thống**: server lược bằng `publicStatus()` (`src/server.ts:184`), `/api/stats` trả 404 khi không có quyền dev (`server.ts:417-419`); client chỉ dựng chi tiết khi `store.dev` (`public/js/ui/hud.js:113`) | Mọi số liệu hệ thống **mới** (provider, lượt gọi, lỗi, click, người xem chi tiết…) phải đi qua đúng hai chốt này; "không có thông tin" tốt hơn "có nhưng ẩn bằng CSS" | `docs/02` §8, `docs/12` §6 |
| Hằng số hiển thị, nhãn tiếng Việt, thứ tự vai tập trung ở `public/js/labels.js` (`ROLE_ORDER` dòng 5 phải giống server `roster.ts:65`) | Tránh rải chuỗi khắp `ui/*.js` | `public/js/labels.js` |

### 1.3 Bí mật và che giấu (áp dụng cho cả code lẫn tài liệu)

1. **Bốn file không bao giờ mở, trích, chép hay commit**: `.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json`. Cả bốn đã nằm trong `.gitignore` và trong danh sách `--exclude` của rsync (`deploy/deploy.sh:31-35`). Tài liệu chỉ được nhắc **tên biến** lấy từ `src/config.ts` và `.env.example`.
2. Không in `DEV_TOKEN` ra bất kỳ đâu (`src/server.ts:562` ghi rõ "không bao giờ in DEV_TOKEN"); mở trang admin bằng `#dev=<token>` (phần sau `#` không lên máy chủ), không dùng `?dev=`; nginx đã `access_log off` cho `location = /ws` vì URL WebSocket có thể mang `?dev=` (`deploy/nginx.site.conf:12-13`); `location /` cũng tắt access_log khi URL có `?dev=` kiểu cũ (`if ($arg_dev) { access_log off; }`, `:42`).
3. Key AI không được lọt vào log, `lastError`, snapshot, `usage()`: mọi chuỗi lỗi đi qua `redactSecrets()` (`src/ai/llm.ts:68-84`) — che nguyên văn mọi key cấu hình ≥ 6 ký tự rồi các mẫu `sk-…`, `gsk_…`, `AIza…`, `AQ.…`, `cfut_…`, `Bearer …`, `api_key=…`, `?key=…`, `x-goog-api-key`. **Thêm provider có tiền tố key lạ → thêm mẫu vào đây và thêm khẳng định vào `scripts/test-router.ts`** mục 12 "Key không bao giờ xuất hiện trong stats / lỗi / log / snapshot" (`section()` ở `:751`; các check `leaks()` ở `:468`, `:682`, `:758-759`; hàm `leaks()` dòng 37 dò hai key giả của test và chuỗi `SECRETKEY`).
4. Khi thêm trường vào `serialize()` của Router/Brain/Director/World: không đưa key, URL có key, token. Snapshot được đọc lại bằng `restore()` chặt kiểu (dữ liệu rác bị bỏ, không throw).
5. Ảnh chụp màn hình đưa vào `docs/preview/` không được chứa thanh địa chỉ có `#dev=`/`?dev=` hay bảng dev đang mở với số liệu thật.
6. Script QA / test chỉ dùng mã dev giả trên máy dev (ví dụ `DEV_TOKEN=qa-local` như `docs/11` §10.1), không bao giờ mã thật.

### 1.4 Năm nguyên tắc nội dung — kiểm tra trước khi thêm chức năng

Chủ dự án đặt 5 nguyên tắc; chúng sống trong code ở các chỗ dưới (chi tiết: [`01-tong-quan.md`](01-tong-quan.md) §4, [`12-quyet-dinh-thiet-ke.md`](12-quyet-dinh-thiet-ke.md)). Một thay đổi phải tự trả lời "tôi có vi phạm nguyên tắc nào không" và ghi vào mô tả commit nếu có đụng tới.

| # | Nguyên tắc | Câu hỏi phải trả lời | Nơi hiện thực |
|---|---|---|---|
| 1 | Tốn ít token nhất, chỉ AI miễn phí | Có thêm lời gọi AI mới không? Có qua `brain.reserve()`? Có tôn trọng `LLM_ONLY_WHEN_WATCHED`, `DAILY_BUDGET_USD`, pace/quota? | `src/ai/brain.ts` (`reserve`, `DEADLINE_MS`, `MAX_TOKENS`), `src/ai/router.ts` (`paceBlock`, RPM/RPD/TPD), `src/ai/prompt-budget.ts` |
| 2 | Câu chuyện tự phát, AI quyết, **không ai bị đánh dấu làm nạn nhân** | Có luật cứng "N ngày thì đuổi" không? Có trọng số 100% cho một người không? Có bám id nhân vật cụ thể không? | `src/sim/hr.ts` (`allowedActions` = hàng rào, `offlineDecisions` = trọng số), `src/sim/world.ts:216` `randomizeOpeningTraits`, `scripts/smoke-story.ts` ("không ai bị đánh dấu") |
| 3 | Giao diện đẹp, rõ, cẩn thận; nhân vật đủ bộ phận | Đã chụp desktop + mobile, so với `docs/preview/`? Chữ có dấu, không tràn? | `docs/11` §11, `docs/ui-polish-todo.md` |
| 4 | Người xem thường không thấy gì về hệ thống | Số liệu mới có qua `publicStatus()` và `store.dev`? | `src/server.ts:184-194, 417-419`, `public/js/ui/hud.js:113` |
| 5 | Thời sự an toàn pháp lý | Có bịa sự thật, gán tội, bàn đời tư không? Có qua bộ lọc + lưới sanitize? | `src/news/filter.ts`, `src/ai/prompts.ts` (`NEWS_RULES`), `src/ai/sanitize.ts` (`isNewsSafe`, `judgesNamedPerson`), `docs/06` §1 và §13 |

---

## 2. Quy trình làm một thay đổi (từ ý tưởng tới site thật)

**Bước 0 — Định vị và đọc.** Xác định vùng sẽ đụng (bảng §5), đọc tài liệu vùng đó + mục "Khi sửa code vùng này" của nó, đọc ADR liên quan trong `docs/12`, đọc mục SPEC tương ứng để biết hợp đồng gốc (lưu ý SPEC có chỗ lỗi thời — xem §4.4). Nếu định sửa một cơ chế "không hiểu sao làm thế", đọc `docs/12` trước khi gỡ.

**Bước 1 — Dựng môi trường.** `npm install`; copy `.env.example` → `.env` (không commit); để trống **cả** `AI_PROVIDERS` **và** `OPENAI_API_KEY` là chạy **offline** hoàn toàn (thoại mẫu, 0 đồng, không mạng) — đủ cho phần lớn việc sửa code. Bẫy: `buildProviders()` (`config.ts:137-141`) khi `AI_PROVIDERS` rỗng vẫn dựng 1 provider kiểu cũ từ `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` nếu `OPENAI_API_KEY` có giá trị, và gọi mạng thật (`.env.example:4` ghi đúng điều này; lệnh QA ở bước 4 vì thế phải đặt cả hai biến rỗng). `npm run dev` (tự khởi động lại khi sửa `src/`); mở `http://localhost:3000`. Muốn bảng dev trên máy dev: `DEV_TOKEN=` trống + `DEV_PANEL=true` (mặc định) → mọi người xem là dev.

**Bước 2 — Sửa code** theo §1 và công thức ở §3. Thay đổi `data/products.json`, `src/content/roster.ts`, `.env` cần **khởi động lại** tiến trình (đọc một lần lúc nạp module); văn phòng đang chạy với `data/state.json` sẽ **khôi phục** roster cũ (xem §3.8).

**Bước 3 — Kiểm thử** (chi tiết từng script: [`11-kiem-thu-qa.md`](11-kiem-thu-qa.md)). Luôn `npm run typecheck`; sau đó theo bảng dưới; **trước khi deploy chạy trọn `npm test`** (= typecheck → smoke → smoke:story → test:news → test:llm → test:router, dừng ở lỗi đầu tiên). Hai bẫy: (a) mọi script nạp `.env` thật của máy qua `dotenv` rồi mới ghi đè vài trường — giá trị đặt trên dòng lệnh thắng `.env`; (b) `smoke:story` có khẳng định thống kê, đỏ thì chạy lại với `SMOKE_STORY_SEED=<số in ra>` trước khi kết luận.

| Sửa vùng | Test tối thiểu | Thêm |
|---|---|---|
| `src/config.ts`, `.env.example` | `typecheck`, `test:router` (có `buildProviders`), `smoke` | khởi động `npm start` đọc bảng provider và dòng `⚠️ bỏ qua` |
| `src/ai/*` | `test:llm`, `test:router` | `npm run eyeball:hr` nếu đổi prompt hr_review (gọi AI thật, tốn quota) |
| `src/sim/world.ts`, `behavior.ts`, `map.ts`, `showroom.ts`, `archive.ts`, `persist.ts` | `smoke` | `smoke:story` nếu đụng HR/World API v3 |
| `src/sim/director.ts`, `scenes.ts`, `hr.ts`, `story.ts`, `rumors.ts` | `smoke`, `smoke:story` | `test:llm` nếu đổi `SceneRequest`/prompt |
| `src/news/*` | `test:news`, `smoke:story` | `curl /api/news` khi chạy thật |
| `src/content/roster.ts`, `catalog.ts`, `products.ts`, `data/products.json` | `smoke`, `test:llm` | `npm start` xem log `[products]` |
| `src/server.ts`, `deploy/*` | `typecheck` + thử tay bằng `curl` (không có test HTTP trong `npm test`) | `/api/health`, `/api/stats` (có và không có mã dev) |
| `public/**` | **không có test tự động** → QA hình bước 4 | đo độ mượt nếu đụng `store.js`/`office.js` (`docs/11` §10.4) |
| `scripts/*` | `npm test` | giữ thời gian chạy (~6 s smoke, ~30 s smoke:story theo README §12 — chưa đo lại) |

**Bước 4 — QA hình (bắt buộc khi đụng `public/`).** Làm theo checklist `docs/11` §11: chạy server QA không ghi đĩa (`PORT=3999 PERSIST=false HISTORY_ENABLED=false NEWS_ENABLED=false AI_PROVIDERS= OPENAI_API_KEY= DEV_TOKEN=qa-local npm start`), chụp desktop 1600×900 và mobile 390×844 ở **hai trạng thái** (người xem thường và `#dev=qa-local`), so với `docs/preview/v2/*.png`, kiểm console không lỗi, `#chip-ai` và `#devbar` ẩn với người thường. Repo chưa có script chụp; `docs/11` §10 mô tả cách dựng bằng Chrome headless + CDP không cần thêm dependency.

**Bước 5 — Cập nhật tài liệu** theo §4 (bắt buộc) và bảng ánh xạ §5: tài liệu vùng, `CHANGELOG.md`, dòng "Cập nhật lần cuối", mục "Câu hỏi còn mở"; sửa hoặc đánh dấu lỗi thời ở `README.md`/`SPEC.md` nếu chúng mô tả hành vi vừa đổi.

**Bước 6 — Commit** theo §7 (một thay đổi logic một commit; `git status` không được có file bí mật hay rác).

**Bước 7 — Deploy** (chi tiết: [`10-van-hanh-deploy.md`](10-van-hanh-deploy.md)). Điều kiện tiên quyết trên máy dev: có `sshpass`, `rsync`, `ssh` (`deploy/deploy.sh:15-16`, `:31`, `:40`) và file `deploy/vps.env` (`:13-14`, không commit); script chạy `set -euo pipefail` (`:10`) nên lệnh nào lỗi là dừng ngay tại đó (trừ hai lệnh `curl` health có `|| echo`); `APP_PORT` mặc định 3200 nhưng ghi đè được qua biến env lúc gọi (`:18`); trên VPS `.env` được `chmod 600` (`:43`). Quy trình: nếu đổi biến env thì sửa `deploy/.env.production` trước (file này được `scp` ghi đè `.env` trên VPS mỗi lần deploy — `deploy.sh:40`; `PORT` phải bằng `APP_PORT` 3200 vì nginx proxy tới `127.0.0.1:__PORT__`); `bash deploy/deploy.sh` (rsync `--delete` nhưng giữ `data/state.json`, `data/history`, `.env` nhờ exclude; `npm install --include=dev`; `pm2 restart vibecorp --update-env`); script tự `curl /api/health` ở hai đầu (`127.0.0.1:$APP_PORT` `:62`, rồi `https://$DOMAIN` `:63`) nhưng **lỗi health không làm script fail** — phải tự đọc output: route trả `{ ok, mode, viewers, day, minute }` (`src/server.ts:411-415`); khoẻ = `ok: true` **và** `mode` đúng mong đợi (`'llm'` khi có provider dùng được, `'offline'` khi không — giá trị của `brain.mode()`, `src/types.ts:512`); `mode: 'offline'` trên site thật thường là `deploy/.env.production` thiếu key hoặc provider bị bỏ qua (xem log `⚠️` lúc khởi động); sau đó tải cứng trang và kiểm `index.html` trỏ `/v/<ASSET_VERSION>/` mới; xem `pm2 logs vibecorp --lines 50`. `--setup` chỉ dùng lần đầu dựng VPS (ghi đè file nginx kể cả phần 443 certbot đã thêm).

**Bước 8 — Sau deploy.** `curl -s <site>/api/health` lần nữa và đọc `ok`/`mode` như bước 7; theo dõi log `[ai]` vài phút (quota, cooldown), mở trang với tư cách người xem thường xác nhận không lộ hệ thống, ghi dòng "Vận hành" vào `CHANGELOG.md` kèm hash commit.

---

## 3. Công thức từng bước (RECIPES)

Mỗi công thức liệt kê **file phải sửa theo thứ tự**, bẫy, test và tài liệu phải cập nhật. Nếu TypeScript báo lỗi "thiếu khoá trong `Record<…>`" thì đó là cơ chế bắt sót có chủ ý — đừng đổi sang `Partial`.

### 3.1 Thêm một provider AI

Phần lớn trường hợp **không cần sửa code**: mọi endpoint tương thích OpenAI (`/chat/completions`) đều cấu hình được qua env (`buildProviders()`, `src/config.ts:134-197`). Công thức đầy đủ và cách thử model: [`05-lop-ai.md`](05-lop-ai.md) §12–§13.

1. `.env` (và `deploy/.env.production` cho site thật): thêm tên vào `AI_PROVIDERS` (chữ thường, chỉ `[a-z0-9_]`, `config.ts:161`), rồi bộ `AI_<TÊN>_API_KEY`, `AI_<TÊN>_MODEL`, `AI_<TÊN>_BASE_URL` — **luôn khai báo** cho endpoint tương thích OpenAI: nếu bỏ trống và tên không có trong `KNOWN_BASE_URLS` (`config.ts:89-92`, chỉ `gemini`/`groq`) thì provider **vẫn được tạo** với `baseUrl = undefined` (`config.ts:167`) và SDK gọi tới `api.openai.com` (comment `config.ts:43`, `isOpenAiEndpoint` `:104`) — không báo gì lúc khởi động, chỉ lộ khi gọi thật (401). Tuỳ chọn: `_RPM/_RPD/_TPD` (0 = không giới hạn, `limit()`), `_TIER=strong`, `_JSON=object`, `_LABEL`, `_REASONING`, `_REASONING_EFFORT`, `_MAX_OUTPUT_TOKENS`, `_MAX_REQUEST_TOKENS`, `_PACE`, `_WEIGHT`, `_EXTRA_JSON`, `_PRICE_*`. Chỉ thiếu **key** (`config.ts:169`) hoặc **model** (`:170`) mới làm provider bị **bỏ qua** có cảnh báo lúc khởi động (`skipped` → `CONFIG.providerNotes` `:259`, in ra ở `server.ts:550`).
2. Quota ngày reset theo múi giờ khác Việt Nam? Thêm vào `QUOTA_RESET_TZ` (`src/ai/router.ts:57`, hiện chỉ `gemini` → Pacific). `quotaResetTz()` (`:60-62`) tra theo `cfg.name` **rồi** theo tên suy từ `baseUrl` qua `inferProviderName()` (`config.ts:107`) — provider Gemini đặt tên khác (ví dụ `gemini2`) nhưng `BASE_URL` chứa `generativelanguage.googleapis.com` vẫn reset theo Pacific; chỉ provider không khớp cả tên lẫn URL mới về giờ VN và dò lại sau 1 giờ khi hết quota ngày (`dailyProbeMs`, `router.ts:40`).
3. Muốn tên hiển thị đẹp trên chip 🤖 mà không đặt `_LABEL`: thêm vào `DEFAULT_LABEL` (`config.ts:94-97`). Muốn base URL mặc định: `KNOWN_BASE_URLS`; muốn cấu hình kiểu cũ `OPENAI_BASE_URL` nhận ra tên: `inferProviderName()` (`config.ts:107`).
4. Model suy luận không khớp `REASONING_MODEL_RE` (`config.ts:102`): đặt `AI_<TÊN>_REASONING=true` thay vì sửa regex. **Bẫy**: chỉ cần đặt `_REASONING_EFFORT` là model bị coi là suy luận (×3 `max_completion_tokens`, không gửi `temperature`) — đừng đặt cho model thường.
5. Model trả JSON kém → `AI_<TÊN>_JSON=object`; cần tắt "thinking" (Gemma trên Cloudflare) → `_EXTRA_JSON` (6 khoá `model`, `messages`, `response_format`, `max_tokens`, `max_completion_tokens`, `stream` bị xoá — `parseExtraBody` `config.ts:74-87`; `temperature`/`reasoning_effort` **không** bị xoá nên có thể ghi đè router — cố ý, ghi rõ khi dùng).
6. Key có tiền tố lạ → thêm mẫu vào `redactSecrets()` (`src/ai/llm.ts:68-84`) + khẳng định không rò rỉ trong `scripts/test-router.ts` (mục 12, `section()` ở `:751`; `leaks()` `:37` — xem §1.3 mục 3).
7. Thử trước khi tin: cách probe không tốn tiền trừ bước gọi thật ở `docs/05` §13; `npm run eyeball:hr` để đọc 1 cảnh hr_review bằng AI thật. Ghi nhận model đã thử/loại vào `docs/05` và `docs/13` (danh sách đã thử: gpt-oss-20b, Qwen3-30B Cloudflare, GLM, OpenRouter free, SambaNova, GitHub Models, Cerebras — theo chủ dự án).
8. Test: `npm run test:router` (bắt buộc nếu sửa `config.ts`/`router.ts`), `npm run test:llm`. Thêm case nếu thêm chính sách (mẫu: mục 13 của test-router, `section()` ở `:774`, cho pace/balanced/weight/trần token/`_EXTRA_JSON`).
9. Tài liệu: `.env.example` (thêm khối ví dụ như khối Cloudflare `:147-156`, giá trị bí mật để trống), `README.md` §3 (3.1–3.5), `docs/05` §2 + §12, `docs/09` §3, `docs/12` §3 nếu đổi chính sách, `CHANGELOG.md`. Trên VPS: sửa `deploy/.env.production` rồi deploy (`--update-env`).

### 3.2 Thêm một loại cảnh (`SceneType`)

Công thức dài hơn ở [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md) §14; dưới đây là danh sách file theo thứ tự biên dịch.

1. `src/types.ts:182` — thêm vào union `SceneType` (kèm comment một dòng). Nếu cảnh có kết quả do AI quyết: thêm giá trị vào `Verdict` (`types.ts`, hiện `hired/rejected/stay/leave/approved/denied`).
2. `src/sim/scenes.ts:88` `SCENE_DEFS` — `title, icon, channel, priority, minLines, maxLines, effects, product, label, emote, topics`; viết hàm `sit<Ten>()` dựng `situation`/`extra` tiếng Việt từ `SitKit` (`situation` bị cắt ở 690 ký tự bởi `joinSit`). Cảnh có verdict → thêm vào `VERDICT_SCENES` (`scenes.ts:214`).
3. `src/ai/prompts.ts:109` `SCENE_DIRECTION` (định hướng 1 câu, `{A}`/`{B}` = tên); verdict → `VERDICT_RULES` (`prompts.ts:138`) **và** `src/ai/sanitize.ts:36` `VERDICT_BY_TYPE` (giá trị tốt/xấu + mặc định) **và** `VERDICT_SYNONYMS` nếu có từ đồng nghĩa mới.
4. `src/ai/offline.ts:4558` `BUILDERS` — viết `b<Ten>(b, sc, fx)` theo mẫu 24 builder hiện có (24 = số thành viên `SceneType` `types.ts:182-193`; `BUILDERS` là `Record<SceneType, …>` đầy đủ nên thiếu là lỗi biên dịch; tiêu đề `docs/04` §3 ghi cùng con số — thêm loại thì sửa cả đó, đừng để hai tài liệu lệch nhau) (mục 10 của file, mở → thân → phản ứng → chốt, câu là hàm nhận ngữ cảnh để xưng hô đúng); `TYPE_CATS` (`:4566`) nếu cần chủ đề; thêm vào danh sách `formal` trong `applyTics()` (`:4975`) nếu cảnh trang trọng (ít tật nói).
5. `src/ai/sanitize.ts:280` `deriveSummary()` — thêm `case` (có `default` nhưng tóm tắt dự phòng nên cụ thể).
6. `src/sim/director.ts` — hàm `d<Ten>()` trả `Draft` (`participants`, `place`/`joint`, `sit`, `prio`, `product*`…); nối vào `draftFromQueue()` (`:893`) nếu đi qua hàng đợi, hoặc `spontaneous()` (`:1060`) nếu tự phát; `planDay()` nếu có giờ cố định; `onEndHook()` (`:2608`) / `onAbortHook()` (`:2640`) nếu có hậu quả; cảnh HR phải cân nhắc `RETRY_TYPES`, `DEFERRABLE_TYPES`, `HR_SCENE_TYPES` (`:123-128`). Hiệu ứng mới (ngoài `relationship/mood/memory/kpi/rumor/verdict/decisions`) → `SceneEffectKind` + `applyEffects()` (Director) + `finalizeFx()` (offline) + `sanitizeScene()`.
7. Client `public/js/labels.js`: tông màu qua `HOT_SCENES`/`HAPPY_SCENES`/`SHOP_SCENES` (`:215-217`) hoặc `SCENE_TONE` (`:223`); icon/tiêu đề dự phòng `SCENE_DEFAULTS` (`:232`); `public/js/ui/feed.js:260` `ICON_TYPE` (đoán loại cảnh từ icon cho log cũ trước khi mở trang). Tone mới cần CSS tương ứng trong `public/style.css` (xem `docs/08` §7).
8. Test: `scripts/smoke.ts` đếm câu theo loại và đòi ≥ 12 loại có thoại; `scripts/smoke-story.ts:494` kiểm 6 loại v3 có trong `SCENE_DEFS`; `scripts/test-llm.ts` bám **chuỗi văn bản** trong prompt (`speaker chỉ dùng:`, `TRẦN 1 LẦN HỌP`, `LUẬT TIN THẬT`) — đổi prompt là phải sửa test. Chạy `smoke`, `smoke:story`, `test:llm`.
9. Tài liệu: `docs/04` §3 (bảng registry) + §14, `docs/05` §6/§9 nếu đụng prompt/offline, `docs/08` §7/§16 nếu đụng feed/nhãn, `SPEC.md` §5.1 (`:321`, thêm dòng hoặc đánh dấu), `CHANGELOG.md`.

Bẫy: `SCENE_DEFS[type].product` không phải nguồn sự thật duy nhất (desk_visit có ngoại lệ marketing trong `offerProduct()` của Director); kênh `news_chat` bị Director đổi `office` → `group` khi slot bận; `Draft.minPeople` mặc định 3 cho `group`, 2 còn lại; `GATHER_TELEPORT_MS` 45 s và `RESULT_TIMEOUT_MS` 35 s áp cho mọi cảnh.

### 3.3 Thêm / sửa sản phẩm affiliate

Hướng dẫn cho chủ dự án: `README.md` §5.1 (`:270`) và khối `_huong_dan` ngay trong `data/products.json`; chi tiết kỹ thuật: [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) §5.

1. Sửa `data/products.json` → mảng `products`. Server kiểm từng mục trong `normalize()` (`src/content/products.ts:53-103`): `id` kebab-case theo `ID_RE` (`:15`), không trùng; `name` bắt buộc; `url` http(s) hợp lệ; `tags` là mảng; `category` `lam-dep` hoặc `cong-nghe` (thiếu → suy từ tags); `shelf` suy từ category (ghi lệch bị sửa); `slot` số nguyên ≥ 0, **0–4 được vẽ trên kệ** (`SHELF_SLOTS = 5`, `:25`), ≥ 5 chỉ hiện tab 🛍️; `note` cắt 200 ký tự, `pitch` cắt 200, `priceHint` cắt 30, `image` phải là URL http(s). Mục sai bị **bỏ qua + `console.warn('[products] …')`**, không sập.
2. File được đọc **một lần** lúc nạp module (`load()` `:129`, có cache) → khởi động lại server (trên VPS: deploy đã rsync file và `pm2 restart`).
3. **Không đổi `id` đang có.** Id được dùng ở: `src/content/roster.ts` (`deskItemProductId` của 10 nhân vật: `dong-ho-thong-minh`, `may-massage-co-vai-gay`, `ban-phim-co`, `tai-nghe-chong-on`, `gia-do-laptop`, `chuot-khong-day`, `man-hinh-27-inch`, `micro-karaoke`, `quat-tan-nhiet-dien-thoai`, `den-ring-light`), `scripts/smoke.ts:524-527` (`son-kem-li`, `ban-phim-co` trong test đếm click — đổi là smoke đỏ), và thống kê click trong `data/state.json` (`clicksBy` theo id).
4. Tag mới nên khớp với nơi chọn sản phẩm theo ngữ cảnh: `DESK_TAGS` (**hai bản khác nhau**: `src/ai/brain.ts:47` cho người mới do AI tạo, `src/ai/offline.ts:5130` cho ứng viên offline) và `productTags` trong `offerProduct()` của `src/sim/director.ts`; không khớp tag nào thì `pickProduct()` chọn ngẫu nhiên — vẫn chạy.
5. Sản phẩm thật chờ ghép nằm ở `docs/real-products.json` (còn 4 mục `name: "???"`). Hiện catalogue có **18 món (8 làm đẹp, 10 công nghệ)**; `README.md:272` vẫn ghi "16 món — 7 + 9" → sửa README khi đụng tới.
6. Test: `npm run smoke` (shape `hello.products`, url `^/go/<id>?src=showroom$`, ≥ 1 `showroom_chat` có chip, đếm click); `npm start` đọc log `[products]` và dòng `🛍️ Phòng trưng bày: N sản phẩm (kệ làm đẹp a · kệ công nghệ b)`.
7. QA: tab 🛍️ hiển thị `note` nguyên văn; kệ trên canvas chỉ vẽ slot 0–4; tooltip `#prod-tip`; bấm thử `/go/<id>?src=showroom` **chỉ trên máy dev** (click trên site thật bị đếm vào thống kê).
8. Tài liệu: `README.md` §5.1 (số món), `docs/09` §5, `docs/01` §3, `CHANGELOG.md` (mục "Thêm: sản phẩm …" — không cần ghi link).

### 3.4 Thêm phòng / nội thất / chỗ đứng (bản đồ)

Bản đồ là lưới 60×34 ô do server giữ (`src/sim/map.ts`) và gửi xuống client trong `hello.map` (`MAP_DATA` `:203`). Kiến thức nền: [`03-mo-phong-the-gioi.md`](03-mo-phong-the-gioi.md) §3, [`07-frontend-ve-canvas.md`](07-frontend-ve-canvas.md) §6, §9–§10, `docs/v2-contract.md` §1, `SPEC.md` §1.2.

**Phía server (`src/sim/map.ts`)**
1. Phòng: `ROOMS` (`:16`) — `id`, `label` (hiện trên bản đồ), `floor` (client biết: `wood`, `showroom`, `dark`, `tile`, `carpet`, `boss`, `rug`; loại lạ vẽ như gỗ). Tường/cửa dựng bằng `wall()`/`door()` (`map.ts:132-148`, ngay sau `FURNITURE` và trước `WALLS` `:152` / `isWalkable` `:163` / `roomAt` `:195` / `MAP_DATA` `:203`); `roomAt()` ưu tiên **phòng nhỏ hơn** khi chồng.
2. Nội thất: `FURNITURE` (`:72`) — `type`, `x,y,w,h`, `blocked` (`false` = đứng lên được: `sofa`, `beanbag`, `door_mat`), `label`, `owner` (bàn). Bàn làm việc sinh tự động từ `DESKS` (`:33`); **mỗi vai cần đúng một `deskId`** trong `ROLE_INFO` (`src/content/roster.ts:12`). Hiện 10 bàn = 10 người nên `freeDesk=false` lúc đầu; `open_position` chỉ mở khi có bàn trống — ai đó rời công ty (`firing`/`layoff`/`resign` làm bàn không còn bị agent `active`/`candidate` hay `vacancies` chiếm, `freeDesks()` `src/sim/hr.ts:283-288`) **hoặc** thêm bàn — **và** đồng thời doanh thu ≥ 80 % nhịp, `headcount < 12`, chưa có vị trí trống (`hr.ts:217`: `revenueRatio >= 0.8 && headcount < 12 && !hasOpenPosition && freeDesk`).
3. Chỗ đứng: `SPOTS` (`:46`) — nhóm → danh sách ô. World giữ chỗ theo khoá `"<nhóm>:<i>"` (`reserveIn()` `src/sim/world.ts:1292`); hoạt động chọn nhóm qua `ACTIONS[...].spots` (`src/sim/behavior.ts:51-67`, ví dụ `coffee → ['coffee']`, `snack → ['snack','fridge']`, `showroom → ['showroom_beauty','showroom_tech']`); Director đặt người vào cảnh bằng `Placement.spot`/`joint` theo nhóm; nhãn tiếng Việt cho prompt ở `SPOT_LABELS` (`src/sim/scenes.ts:375`); `areaOf()` (`:389`) quyết định chỗ nào "tám chuyện được" (pantry, lounge, window, kpi_board, printer). Nhóm mới không có nhãn → prompt thiếu địa điểm; không có trong `areaOf` → không bao giờ nổ cảnh tự phát ở đó.

**Phía client (`public/js/render/`)**
4. `furniture.js:941` `SPECS` — thêm `type: { paint, top, key?, padX? }`; không khai báo thì `paintGeneric` vẽ hộp + nhãn; `top` phải đủ cao vì sprite bị cắt ngoài `[y − top − 0.35, y + h + 0.3]`; `key` quyết định thứ tự chồng với nhân vật. Phần động mỗi khung (màn hình, LED, hơi nước) → thêm `case` trong `office.js:572` `overlay()`; ánh sáng đêm → `collectLights()` (`:877`); bóng đổ đặc thù → `floor.js` `furnitureShadow`.
5. Phòng mới: `floor.js:19` `WALL_PAINT` (màu tường theo `room.id`), `LABEL_POS` (`:692`, vị trí nhãn **cứng theo id**, thiếu thì dùng góc phòng), `public/js/labels.js:162` `ROOM_ICONS`; trang trí tường (băng rôn, đồng hồ, bảng menu, câu đối) **chỉ vẽ khi `W === 60 && H === 34`** (`floor.js:803-810`) — đổi kích thước bản đồ là mất hết, đổi tường ở hàng y=7 có thể làm lệch băng rôn/đồng hồ.
6. `world.js` `prepareWorld()` (`:5`) giới hạn: `4 < W,H ≤ 200`, `walls.length === H`, `id ≤ 30`, `label ≤ 40`, `floor ≤ 20` ký tự; ghế quanh `meeting_table`/`table` sinh tự động; phòng `wc` được nhận ra theo **id** (cửa đóng, biển "Có người").

**Test & tài liệu**
7. `scripts/smoke.ts:108-138` kiểm tra tĩnh **rất cụ thể**: mọi `SPOTS` đi được và tới được từ `SPOTS.entrance[0]`, mọi ghế `DESKS` tới được, có phòng `showroom` (`floor: 'showroom'`) và `wc` (không còn `toilet`), có `shelf_beauty`/`shelf_tech`/`display_table`/`lockers`, `SPOTS.toilet` = (20,8),(21,8), `showroom_beauty` = (2,3),(3,3),(1,3), `showroom_tech` = (6,3),(7,3),(8,3), `WALLS[7][20]`/`[21]` = `'D'`, không ô đi được nào bị cô lập. Thêm phòng mới phải giữ các khẳng định này (hoặc sửa test có chủ ý và ghi lý do).
8. Chụp lại ảnh desktop/mobile (`docs/11` §11); cập nhật `docs/03` §3, `docs/07` §9–§10, `SPEC.md` §1.2 + `docs/v2-contract.md` §1 (đánh dấu nếu lệch), `CHANGELOG.md`.

### 3.5 Thêm một biến môi trường

1. `src/config.ts:252` — thêm trường vào `CONFIG` với `num/bool/str/limit` (`:4-13`) + comment một dòng nói ý nghĩa và mặc định; kẹp sàn/trần ngay tại đây nếu cần (mẫu: `newsRefreshMinutes: Math.max(5, …)`). Ngữ nghĩa cần nhớ: `bool()` chỉ coi `false/0/no/off` là sai; `limit()` coi `0`/âm/trống là **không giới hạn**; `num()` rỗng/NaN → mặc định.
2. Biến dạng `AI_<TÊN>_X`: đọc trong vòng lặp `buildProviders()` với tiền tố `P` (`config.ts:159-195`, `P` ở `:165`), thêm trường vào `ProviderConfig` (`:40-68`) và mặc định trong `makeProvider()` (`:334`); ghi vào ghi chú cuối `.env.example` (`:158-159`).
3. Nơi dùng đọc `CONFIG.x` (Director: thêm khoá camelCase vào lời gọi `cfgNum/cfgBool` tương ứng), **không** `process.env` trực tiếp (hai ngoại lệ đọc thẳng + nhánh dự phòng `cfgNum/cfgBool` ở §1.1 là nợ kỹ thuật).
4. `.env.example` — thêm dòng ở đúng khối (AI / Tiết kiệm token / Thời gian / KPI-HR / Affiliate / Khác / v3 Thời sự / v3 Câu chuyện / v3 Lưu trữ / v3 Bảng dev), kèm comment tiếng Việt và giá trị mặc định **an toàn**; biến bí mật để trống.
5. Test: `scripts/smoke.ts:91` ghi đè `{ ...CONFIG, … }` — nếu test cần giá trị cố định, thêm vào đây (nhớ `CONFIG` đã nạp `.env` thật của máy); `scripts/test-llm.ts`/`test-router.ts` dựng config bằng `withProviders({ ...CONFIG, … }, providers)` (`config.ts:352`). Nếu biến đổi hành vi được test, thêm khẳng định (mẫu: `AI_<TÊN>_PACE`/`_WEIGHT` ở mục 13 test-router).
6. Production: thêm vào `deploy/.env.production` (không commit) → deploy; `pm2 restart --update-env` do script lo.
7. Tài liệu: `docs/09` §3 (bảng biến: tên, mặc định **trong code**, nơi đọc), `README.md` mục liên quan (nếu chủ dự án cần chỉnh), `SPEC.md` §10.1 nếu thuộc nhóm v3, tài liệu vùng dùng biến, `CHANGELOG.md`.

### 3.6 Thêm một route HTTP

1. `src/server.ts:401` — handler của `createServer`. Thứ tự hiện tại: `POST /api/dev/login|logout` (`handleDevCookie` `:100`) → **405 cho mọi method khác GET/HEAD** (`:407`) → `/api/health` (`:411`) → `/api/stats` (chỉ dev, `:417`) → `/api/news` → `/api/history` → `/go/` → `/v/<ver>/…` → file tĩnh (`handleStatic` `:352`). Chèn route mới **trước** nhánh file tĩnh; route cần POST phải đặt trước nhánh 405 và đọc body qua `readBody(req, max)`.
2. Dùng helper `send()` / `sendJson()` (tự đặt `Cache-Control: no-cache`/`no-store`, `X-Content-Type-Options: nosniff`); tham số số qua `intParam(url, name, def, min, max)`; tham số chuỗi kiểm bằng regex chặt (mẫu `/go/`: id `^[A-Za-z0-9_-]{1,80}$`, `src` `^[A-Za-z0-9_-]{1,32}$` ngược lại `khac`).
3. Dữ liệu "hệ thống" (AI, click, lỗi, người xem chi tiết…) → `if (!devAllowed(req)) { send(res, 404, 'Not found'); return; }` (`devAllowed` `:68`: `DEV_PANEL`, `?dev=` hoặc cookie `vpa_dev`); trả **404, không phải 403** — "như không tồn tại". Route nặng (giải nén, đọc đĩa) → giới hạn song song kiểu `HISTORY_MAX_INFLIGHT` + 429 kèm `Retry-After`.
4. nginx: mọi đường `/api/…` rơi vào `location /api/` có `limit_req zone=vpa_api burst=5 nodelay` (2 r/s mỗi IP — `deploy/nginx.site.conf:29-38`, `nginx.limit.conf`); đường khác vào `location /` (có header WebSocket). Đổi nginx = sửa file trong `deploy/` **và** áp lên VPS bằng tay hoặc `--setup` (ghi đè site kể cả khối 443 của certbot) — xem `docs/10`. Lưu ý mở: `limit_req` khoá theo IP mà site đứng sau Cloudflare chưa cấu hình real IP (`docs/10`, `docs/13`).
5. Client gọi theo mẫu `fetchJson()` của `public/js/ui/history.js:56-67` (AbortController + `TIMEOUT_MS = 15000` `:14`, `Accept: application/json`, `cache: 'no-store'`; chỉ tách riêng `404` (`:61`), mã lỗi khác — kể cả `429` từ nginx hoặc `HISTORY_MAX_INFLIGHT` — rơi vào `if (!res.ok)` (`:63`) và caller chỉ hiện "Không tải được … (lỗi N)" + nút thử lại (`:275`, `:312`), **không** đọc `Retry-After` — route mới muốn tự lùi theo `Retry-After` thì phải viết thêm). Dữ liệu chỉ cho admin không được render khi `store.dev === false`.
6. Shape trả về dùng chung với client → khai báo trong `src/types.ts`.
7. Test: `npm test` **không** có test HTTP (smoke gọi thẳng `world.handleClient`/`world.advance`) → kiểm tay bằng `curl -s http://localhost:3000/<route>` ở cả hai trạng thái có/không mã dev; nếu route quan trọng, viết test kiểu `scripts/test-*.ts` theo `docs/11` §12.
8. Tài liệu: `docs/02` §6 (bảng HTTP API), `docs/10` nếu đụng nginx/limit, `SPEC.md` §7 (`:787`, đánh dấu bổ sung), `README.md` §8/§14 nếu chủ dự án dùng, `CHANGELOG.md`.

### 3.7 Thêm một tab sidebar

Hiện có 5 tab `live | staff | products | recap | rumors`. Kiến thức nền: [`08-frontend-giao-dien.md`](08-frontend-giao-dien.md) §6 (tabs) và §19 (muốn đổi X → sửa file nào).

1. `public/index.html:83` `<nav class="tabs" role="tablist">` — thêm `<button type="button" role="tab" data-tab="<id>" title="…"><i class="tab-ic" aria-hidden="true">…</i><span>Tên</span><i class="tab-dot"></i></button>`; thêm `<section class="panel" data-panel="<id>" role="tabpanel"><div class="<ten> scroll" id="<ten>"></div></section>` cạnh các panel khác (`:129`).
2. `public/style.css:518` `.tabs { grid-template-columns: repeat(5, 1fr) }` → đổi số cột; kiểm 2 điểm gãy: container query sidebar ≤ 299 px (chỉ còn icon, `:543-547`) và `@media (max-width: 420px)` (`:1173-1174`).
3. `public/js/main.js:23` `TABS` — thêm id để liên kết sâu `#tab=<id>` hoạt động (`applyHash()` `:116`).
4. Viết `public/js/ui/<ten>.js` export `init<Ten>()`: lấy phần tử, `store.on('<sự kiện>', render)`, render bằng `el()`/`setKids()`; import và gọi trong `main.js` **trước** `connect()`; chấm "có tin mới" bằng `markUnread('<id>')` (`public/js/ui/tabs.js:43`; mẫu `recaps.js:21`, `rumors.js:21`); việc cần làm khi tab được mở → `onTab((name) => …)` (mẫu `feed.js:48`). Điều hướng từ nơi khác: `tabs.activate('<id>')` (mẫu bấm bảng KPI trên canvas → `staff`, `main.js:37`).
5. Cần dữ liệu mới từ server → `src/types.ts` (`ServerMsg` `:459`, trường trong `hello`), World/Director phát, `store.handleMessage()` nhận và `emit` — xem `docs/02` §5; giữ quy tắc lọc cho người xem thường.
6. a11y và bàn phím (`aria-selected`, mũi tên trái/phải) do `tabs.js` lo tự động cho mọi `[data-tab]`; không cần code thêm.
7. QA: desktop, mobile, sidebar kéo 260–520 px và thu gọn (ticker), chấm unread; `docs/11` §11.
8. Tài liệu: `docs/08` §1, §6, §19; `docs/01` §2 (trải nghiệm người xem); `README.md` §2; `docs/v2-contract.md` §6 liệt kê 5 tab (đánh dấu lịch sử); `CHANGELOG.md`.

### 3.8 Đổi roster (sửa nhân vật, đổi vai, thêm người / thêm vai)

**Sửa tính cách, lời nói, ngoại hình (hay gặp nhất)** — `src/content/roster.ts:70` `INITIAL_ROSTER`. Giữ `bio ≤ 200`, `speechStyle ≤ 160` ký tự (prompts cắt đúng mốc này — ghi ở đầu file); không viết câu thoại cố định; `deskItemProductId` phải là id có trong `data/products.json`. Server kẹp lại qua `sanitizePersona()` (`src/sim/world.ts:239-279`: `bio ≤ 600`, `speechStyle ≤ 400`, `quirks ≤ 8 × 160`, `likes/dislikes ≤ 8 × 100`, tuổi 18–70, `kpiTarget` 30–5000, `deskId` phải tồn tại trong `DESKS` nếu không về bàn của vai, `hairStyle`/`accessory` phải thuộc enum). **Traits trong roster chỉ là gốc**: lần khởi tạo đầu `randomizeOpeningTraits()` (`world.ts:216`) ngẫu nhiên hoá (trait lời nói ±0,15, trait công việc kéo về dải chung) rồi trôi ±0,25 quanh `traitBase` — không thể "đánh dấu" ai bằng trait.

**Quan hệ ban đầu** — `REL` (`roster.ts:216`) phải đủ **90 cặp có hướng** (10 × 9); thêm người thì thêm cả hàng lẫn cột. Chuỗi đọc: `REL` → trải phẳng thành `INITIAL_RELATIONSHIPS` (`roster.ts:329-331`, mảng `{ from, to, score, note }`) → `World.freshInit()` (`src/sim/world.ts:2948`; vòng đọc `:2989-2995`) đặt mọi cặp về `{ score: 0, note: 'đồng nghiệp' }` trước rồi ghi đè theo mảng; cặp thiếu, id lạ hoặc `from === to` bị bỏ qua im lặng (`score` kẹp −100..100, `note` ≤ 120 ký tự).

**Id nhân vật bị tham chiếu ở nơi khác** (đổi/xoá id là phải sửa theo): `src/ai/offline.ts:4962` `TICS` (tật nói riêng: `hung, ngoc, khoa, vy, linh, phat, tu, tram`); `src/content/catalog.ts:380` `NEWS_INTEREST.ids` (`phat, tung, hung, khoa, vy, bao, tu, tram, linh, ngoc`); `scripts/test-llm.ts` dùng **cả 10 id** của `INITIAL_ROSTER` (`hung, ngoc, khoa, tung, bao, vy, linh, phat, tu, tram` — `tu` 38 lần, `phat` 27, `khoa` 16…) trong request mẫu; `scripts/smoke.ts` so `INITIAL_ROSTER` với trait sau khởi tạo. Snapshot `data/state.json` khôi phục theo id → đổi id = người cũ biến mất, người mới xuất hiện ở lần khởi tạo mới.

**Thêm vai (`RoleKey`) hoặc đổi vai của một người** — `src/types.ts:9`; TypeScript sẽ báo thiếu ở mọi `Record<RoleKey, …>` đầy đủ: `roster.ts` `ROLE_INFO` (`:12`, kèm `deskId` → cần bàn mới trong `src/sim/map.ts` `DESKS`) và `ROLE_ORDER` (`:65`); `public/js/labels.js` `ROLE_ORDER` (`:5`, không có typecheck — **sửa tay**) và `workScreenKind()`; `src/ai/brain.ts:47` `DESK_TAGS`; `src/ai/offline.ts` `TASKS` (`:194`), `TEAM_OF`, `ROLE_GENERIC`, `ROLE_GRIPES` (`:888`), `AGE_RANGE` (`:5076`), `PREV_JOBS`, `CAND_QUIRKS`, `DESK_TAGS` (`:5130`); `src/ai/prompts.ts` `SHORT_ROLE` (`:175`), `ROLE_AGE` (`:634`), `ROLE_SKILL`. Các tập vai thưa cần cân nhắc: `src/sim/scenes.ts:221-227` (`STANDUP_ROLES`, `DEV_ROLES`, `TECH_ROLES`, `BIZ_ROLES`), `src/sim/behavior.ts:19-25` (`ROLE_KEYS`, `PROJECT_ROLES`, `SALES_ROLES`, `DEV_ROLES`), `src/sim/hr.ts:36` `NEVER_FIRED` (`boss`, `hr` không bao giờ bị loại), `extraVacancy()` và `interviewPanel()` (`hr.ts`), `src/sim/story.ts:82` `BEAT_CAST` (trọng số theo vai), `catalog.ts` `NEWS_INTEREST.roles`.

**Giả định về sĩ số**: 10 bàn (`DESKS`), hàng rào `open_position` đầy đủ ở `hr.ts:217` = `revenueRatio >= 0.8 && headcount < 12 && !hasOpenPosition && freeDesk` (xem §3.4 mục 2), smoke so sánh ≥ 8 người với roster, checklist QA đòi `store.agents.size === 10` đầu ngày, README nói "10 nhân viên" — thêm người là phải rà các chỗ này.

**Áp dụng lên văn phòng đang chạy**: `World.load()` khôi phục agent từ `data/state.json` nên roster mới **không** tự áp; muốn làm lại từ đầu: tắt server, xoá `data/state.json` (trên VPS file này được rsync giữ nguyên — phải xoá tay, mất toàn bộ lịch sử quan hệ/KPI; `data/history/` vẫn còn).

Test: `npm run typecheck` (bắt thiếu khoá), `npm run smoke` (5a: trait ngẫu nhiên hoá so với roster), `npm run smoke:story`, `npm run test:llm`. Tài liệu: `docs/03` §10, `docs/04` (nếu đụng vai trong HR/story), `docs/05` §6 nếu đụng prompt, `SPEC.md` §2 (bảng nhân vật — còn dòng cũ về Tú "first firing arc", đã lỗi thời), `README.md` §13 dòng cuối, `CHANGELOG.md`.

### 3.9 Các việc khác — đi đường nào

| Việc | Chuỗi file | Tài liệu |
|---|---|---|
| Thêm hoạt động (`Activity`) | `src/types.ts:60` → `src/sim/behavior.ts` (`ALL_ACTIVITIES`, `ACTIONS`, `PER_MINUTE`, nhãn) → `public/js/labels.js:78` `ACT` → `public/js/render/office.js` `holdFor()` (`:485`) nếu có đồ cầm; `public/js/labels.js` `slackScreenKind()` (`:130`) / `workScreenKind()` (`:151`) nếu có loại màn hình mới (`office.js:19` import, `:567-568` gọi) | `docs/03` §7, `docs/07` §10 |
| Thêm nút dev / sự kiện | `src/types.ts:454` `DevEventName` → `src/server.ts:48` `DEV_EVENTS` → `src/sim/world.ts:2688` `devEvent()` (World xử lý trực tiếp `boss_leave`, `boss_return`, `end_day`; `deal`/`release` World cũng tự làm rồi **vẫn** gọi `director.onEvent('deal'|'release', data)` ở `world.ts:1795`/`:1782`/`:2759`; tên còn lại chuyển thẳng `director.onEvent()`) → `src/sim/director.ts:497` `onEvent()` → `:503` `handleEvent()` → `public/js/labels.js:36` `DEV_EVENTS` → `scripts/smoke.ts` "phần 2: bấm thử nút dev" (`:454`): `devEvent()` (`:457`) được gọi ở `:475-486` cho `boss_return`, `boss_leave`, `wifi_down`, `payday`, `birthday`, `deal`, `drama`, `server_down`, `hr_review`, `release`, kèm đổi `speed` và `end_day` kiểm số ngày tăng (`:487-493`); **chưa** bấm `news`/`showrunner` — thêm nút mới thì thêm một dòng `await devEvent('<name>', /<regex log>/, 20)` | `docs/03` §18, `docs/04` §5, `docs/08` §13 |
| Thêm nguồn RSS / nới bộ lọc tin | `docs/06` §13 (bắt buộc đọc — ranh giới pháp lý) | `docs/06` |
| Thêm loại "biến" cho AI biên kịch | `src/content/catalog.ts` `BEAT_MENU` → `src/sim/story.ts` `BEAT_CAST` + `actionsFor()` → `scripts/smoke-story.ts:505` đang khẳng định `BEAT_KINDS.length === 17` (phải sửa) | `docs/04` §10 |
| Thêm thông điệp / trường WebSocket | `src/types.ts` `ServerMsg`/`ClientMsg` → World/Director phát → `src/server.ts` (lọc `publicStatus`, `parseClientMsg`) → `public/js/store.js` `handleMessage()` | `docs/02` §5, §9 |
| Thêm kind archive | `src/sim/archive.ts` → nơi `record()` → `public/js/ui/history.js` hiển thị | `docs/03` §17, `docs/08` §11 |

---

## 4. QUY TẮC BẢO TRÌ TÀI LIỆU — BẮT BUỘC

> **Không có thay đổi chức năng nào được coi là xong nếu tài liệu chưa đổi theo.** Chủ dự án yêu cầu rõ: "phải sửa docs khi sửa/thêm/xoá chức năng khi làm tiếp sau này". Người review (hoặc chính agent AI tự kiểm) từ chối một thay đổi thiếu phần tài liệu y như từ chối code không qua typecheck.

### 4.1 Mười quy tắc

| # | Quy tắc | Giải thích |
|---|---|---|
| R1 | **Cùng một commit/PR**: code + tài liệu vùng (bảng §5) + `CHANGELOG.md` + dòng `> Cập nhật lần cuối: YYYY-MM-DD` của mọi tài liệu đã sửa | Tách ra "làm sau" là cách tài liệu chết; lịch sử git cho thấy code và docs đổi cùng lúc |
| R2 | "Thay đổi chức năng" gồm: thêm/bỏ/đổi tên biến env, route, thông điệp hay trường WebSocket, loại cảnh, nút dev, hoạt động, trường sản phẩm, phòng/nội thất/chỗ đứng, luật hoặc ngưỡng HR, hằng số chính sách AI (cooldown, pace, trần token, hạn chót), ngưỡng khẳng định trong test, bước deploy hay chỉ thị nginx, bất kỳ thứ gì người xem nhìn thấy | Sửa lỗi chính tả, refactor không đổi hành vi, đổi comment: chỉ cần CHANGELOG nếu đáng nhớ |
| R3 | **Không chép, chỉ trỏ.** Một sự thật sống ở một chỗ; nơi khác liên kết tương đối tới mục đó (`[05-lop-ai.md](05-lop-ai.md) §4`) | Hai bản chép sẽ lệch nhau sau vài lần sửa (ví dụ `DESK_TAGS` có hai bản trong code) |
| R4 | **Thứ tự nguồn sự thật**: code → `src/types.ts` → `docs/NN-*.md` → `SPEC.md` (hợp đồng thiết kế gốc, có phần lỗi thời) → `README.md` (hướng dẫn chủ dự án). Khi SPEC/README lệch với code: sửa nếu nhỏ, hoặc thêm dòng "*(lỗi thời — xem `docs/NN` §M)*" ngay tại mục đó; **không** để lệch im lặng | Người mới đọc SPEC trước sẽ bị dẫn sai (ví dụ SPEC §8 còn mô tả thanh trên cùng v1) |
| R5 | **Tham chiếu dòng**: khi sửa một file, `grep -rn "<tên file>" docs/ README.md SPEC.md` và làm mới các `file:dòng` trỏ vào vùng vừa đổi; văn bản mới ưu tiên **tên hàm/biến** hơn số dòng | Số dòng trôi sau mỗi lần chèn; tên hàm ổn định hơn |
| R6 | Mọi con số trong tài liệu phải lấy từ code hoặc đo thật, ghi nguồn; số ước lượng ghi "(ước lượng)" hoặc "(cần kiểm tra)"; không đoán | README từng ghi "~50 KB/ngày" cho archive trong khi thực tế 855 KB — sai số kiểu này làm mất niềm tin |
| R7 | **Không bí mật** trong tài liệu: không nội dung `.env`, không key/token/mật khẩu/địa chỉ VPS, không ảnh có `#dev=`; chỉ tên biến | Repo đã công khai trên GitHub theo README |
| R8 | Mục **"Câu hỏi còn mở / cần kiểm tra"** là sổ nợ: giải quyết xong thì xoá khỏi đó và ghi vào CHANGELOG; phát hiện điều chưa chắc thì thêm vào; không để câu hỏi đã có lời giải nằm lại | Tránh người sau điều tra lại việc đã xong |
| R9 | Quyết định thiết kế (chọn A thay vì B, đặt ngưỡng X vì Y) ghi thành ADR theo mẫu `docs/12` §8, trỏ tới file/hàm; không chôn trong comment code hay tin nhắn chat | Để người sau không "sửa cho đúng" một thứ cố ý |
| R10 | **Agent AI**: trước khi báo "xong" phải chạy checklist §6 và liệt kê trong báo cáo cuối: file code đã đổi, tài liệu đã đổi, test đã chạy và kết quả, câu hỏi mở mới. Không được tạo file báo cáo `.md` rải rác ngoài `docs/`; không sửa lịch sử trong `docs/01` §8, chỉ nối thêm | Báo cáo là bằng chứng R1–R9 đã được làm |

### 4.2 Cấu trúc một tài liệu `docs/NN-ten.md` (khuôn mẫu đang dùng)

```
# <Tiêu đề>
> Cập nhật lần cuối: YYYY-MM-DD · Phạm vi: <file/thư mục> · Đọc khi: <tình huống>
<3–6 dòng: trả lời câu hỏi gì, liên quan tài liệu nào (liên kết tương đối)>
## 1. … ## 2. …   (bảng cho danh sách; sơ đồ ASCII/mermaid khi giúp hiểu; ưu tiên "vì sao" và "bẫy")
## Khi sửa code vùng này   (bảng: Nếu đổi … → cập nhật … , chạy test …)
## Câu hỏi còn mở / cần kiểm tra
```

Thêm một tài liệu mới: bộ hiện có là `docs/01…14` (đủ 14 file, kiểm bằng `ls docs/` ngày 2026-11-02); đặt số thứ tự tiếp theo (`15-…`), thêm vào mục lục [README.md](README.md) (bảng §2 một hàng: trả lời gì, phạm vi, đọc khi; §4 nếu thuộc lộ trình của vai trò nào; §5 nếu mô tả vùng code mới) và vào lộ trình đọc `docs/01` §10 (`:469`); thêm hàng tương ứng vào bảng §5 của tài liệu này; chạy lệnh kiểm liên kết ở `docs/README.md` §6. Đổi tên tài liệu: `grep -rn "<tên cũ>" docs/ README.md SPEC.md` và sửa mọi liên kết.

### 4.3 `CHANGELOG.md` — định dạng bắt buộc

File đã được tạo ngày 2026-11-02 ở gốc dự án ([`../CHANGELOG.md`](../CHANGELOG.md)), khởi tạo bằng lịch sử ở `docs/01` §8 (v1 sáng 01/11: lõi mô phỏng + AI + giao diện; v2 chiều 01/11: phòng trưng bày, HUD, sidebar co giãn, nhân vật to/nhìn nghiêng; v3 tối 01/11: thời sự RSS, nhân sự do AI quyết + hàng rào, AI biên kịch, lưu trữ dài hạn, `DEV_TOKEN`; 02/11: bộ đệm chống giật, `/v/<ASSET_VERSION>/`, cookie admin, giữ nhịp quota + xen kẽ nguồn, Cloudflare Workers AI). Mới nhất ở trên; nhóm theo **ngày** (dự án chưa đánh số phiên bản — `package.json` vẫn `0.1.0`); trong mỗi ngày chia 5 nhóm: **Thêm / Sửa / Xoá / Vận hành / Tài liệu**.

```
# Changelog — Văn Phòng Ảo
Mọi thay đổi chức năng ghi ở đây, mới nhất trên cùng. Một dòng = một thay đổi:
`- [vùng] mô tả ngắn — file chính · docs đã sửa · test đã chạy · commit`

## [Chưa phát hành]
### Thêm
- [ai] …
### Sửa
### Xoá
### Vận hành
- deploy 2026-11-02 15:40 (commit abc1234): …
### Tài liệu

## 2026-11-02
### Thêm
- [canvas] bộ đệm chống giật theo ts server (`public/js/store.js` `frameTime`) — docs/07 §4, docs/02 §10 · QA đo stall
…
```

Quy ước: vùng trong ngoặc vuông dùng cùng bộ từ với tiền tố commit (§7.2); không ghi link affiliate, không ghi bí mật; mục "Vận hành" ghi mỗi lần deploy lên `corp.vibe-coder.fun` kèm hash commit để truy ngược sự cố.

### 4.4 Số phận của `README.md` và `SPEC.md`

- `README.md` là hướng dẫn **cho chủ dự án** (tiếng Việt, thao tác): giữ gọn, cập nhật khi thao tác đổi (lệnh, biến env phải điền, cách thêm sản phẩm, cách vào admin); không biến nó thành tài liệu kỹ thuật — trỏ sang `docs/`. Các chỗ đã biết lỗi thời (ghi ở `docs/13` và mục "Câu hỏi còn mở" của 09/10/11): §5.1 số sản phẩm, §8 dung lượng archive, §11 chưa nói tới `deploy/deploy.sh`, §13 thiếu vài file, §4 số token.
- `SPEC.md` là hợp đồng thiết kế v1 + bổ sung v2/v3 — **lịch sử có giá trị**, không viết lại toàn bộ. Khi một mục lệch với code: sửa tại chỗ nếu là một dòng, hoặc thêm ghi chú "*(2026-11-02: lỗi thời, xem `docs/NN` §M)*" ở đầu mục. Những mục đã biết lệch: §2 bảng nhân vật (Tú "first firing arc"), §3 "21:00 force everyone out" (code `T_NIGHT_SKIP`/`T_FAILSAFE`), §5.1 tin thật qua `topicHint`, §6.2 thiếu pace/balanced/weight/Cloudflare, §7 `/api/stats` và `/v/<ver>/`, §8 thanh trên cùng v1 + `sessionStorage`, §10.5 cookie `vpa_dev`.
- `docs/v2-contract.md`, `docs/v3-news.md`, `docs/v2-spec-notes.md`, `docs/ui-polish-todo.md`: tài liệu thiết kế theo phiên bản — giữ nguyên, chỉ thêm dòng trạng thái (✅ / lỗi thời) chứ không sửa nội dung gốc.

---

## 5. Bảng ánh xạ: sửa file nào → cập nhật tài liệu nào, chạy test nào

| Thư mục / file | Tài liệu chính (bắt buộc) | Cũng rà | Test |
|---|---|---|---|
| `src/types.ts` | [`02`](02-kien-truc-va-giao-thuc.md) §9 + tài liệu của vùng dùng kiểu đó | `SPEC.md` §1.1 | `typecheck` |
| `src/config.ts`, `.env.example` | [`09`](09-cau-hinh-du-lieu.md) §2–§4 | [`05`](05-lop-ai.md) §2 (phần AI), `README.md` §3–§4, `SPEC.md` §10.1 | `test:router`, `smoke` |
| `src/server.ts` | [`02`](02-kien-truc-va-giao-thuc.md) §2, §5–§8 | [`10`](10-van-hanh-deploy.md), [`08`](08-frontend-giao-dien.md) §4 (HUD/chip), `SPEC.md` §7, §10.5 | `curl` tay; `typecheck` |
| `src/sim/world.ts`, `behavior.ts`, `clock.ts`, `persist.ts` | [`03`](03-mo-phong-the-gioi.md) | [`02`](02-kien-truc-va-giao-thuc.md) §3, §11; `SPEC.md` §3–§4, §10.4 | `smoke` |
| `src/sim/map.ts` | [`03`](03-mo-phong-the-gioi.md) §3 | [`07`](07-frontend-ve-canvas.md) §6, §9; `docs/v2-contract.md` §1; `SPEC.md` §1.2 | `smoke` (kiểm tra tĩnh bản đồ) |
| `src/sim/showroom.ts`, `src/content/products.ts`, `data/products.json` | [`09`](09-cau-hinh-du-lieu.md) §5 | [`01`](01-tong-quan.md) §3, `README.md` §5, [`07`](07-frontend-ve-canvas.md) §9 (showroom.js) | `smoke` |
| `src/sim/director.ts`, `scenes.ts`, `rumors.ts` | [`04`](04-dao-dien-cau-chuyen-nhan-su.md) | [`02`](02-kien-truc-va-giao-thuc.md) §4, `SPEC.md` §5 | `smoke`, `smoke:story` |
| `src/sim/hr.ts`, `story.ts` | [`04`](04-dao-dien-cau-chuyen-nhan-su.md) §9–§10 | `README.md` §6, `SPEC.md` §5.6/§5.8, [`12`](12-quyet-dinh-thiet-ke.md) §4 | `smoke:story` (`guardOk`) |
| `src/sim/archive.ts`, `data/history/` | [`03`](03-mo-phong-the-gioi.md) §17, [`09`](09-cau-hinh-du-lieu.md) §7 | [`02`](02-kien-truc-va-giao-thuc.md) §6 (`/api/history`), [`08`](08-frontend-giao-dien.md) §11 | `smoke` (5e) |
| `src/ai/*` | [`05`](05-lop-ai.md) | [`12`](12-quyet-dinh-thiet-ke.md) §3, `README.md` §3–§4, `SPEC.md` §6 | `test:llm`, `test:router` |
| `src/content/roster.ts`, `catalog.ts` | [`03`](03-mo-phong-the-gioi.md) §10, [`04`](04-dao-dien-cau-chuyen-nhan-su.md) (beat, sở thích tin), [`05`](05-lop-ai.md) §6 | `SPEC.md` §2, `README.md` §13 (dòng cuối) | `smoke`, `test:llm` |
| `src/news/*`, `scripts/fixtures/news/` | [`06`](06-tin-tuc-thoi-su.md) | [`09`](09-cau-hinh-du-lieu.md) §3 (`NEWS_*`), `README.md` §7, `docs/v3-news.md` | `test:news` |
| `public/js/render/*`, `store.js`, `net.js`, `main.js` | [`07`](07-frontend-ve-canvas.md) | [`02`](02-kien-truc-va-giao-thuc.md) §10, [`10`](10-van-hanh-deploy.md) (mã dev), [`11`](11-kiem-thu-qa.md) §10–§11 | QA hình, đo độ mượt |
| `public/index.html`, `style.css`, `public/js/ui/*`, `labels.js`, `util.js` | [`08`](08-frontend-giao-dien.md) | [`07`](07-frontend-ve-canvas.md) §5, [`11`](11-kiem-thu-qa.md) §11 | QA hình |
| `scripts/*.ts`, `package.json`, `tsconfig.json` | [`11`](11-kiem-thu-qa.md) | `README.md` §12, `SPEC.md` §9 | `npm test` |
| `deploy/*` (script, nginx) | [`10`](10-van-hanh-deploy.md) | [`12`](12-quyet-dinh-thiet-ke.md) §6, `README.md` §11, `docs/ui-polish-todo.md` §8 | deploy + `/api/health` |
| `.gitignore`, bí mật, quyền admin | [`09`](09-cau-hinh-du-lieu.md) §9, tài liệu này §1.3, §7 | [`10`](10-van-hanh-deploy.md), [`12`](12-quyet-dinh-thiet-ke.md) §6 | `git check-ignore` |
| Một quyết định thiết kế mới | [`12`](12-quyet-dinh-thiet-ke.md) §8 (ADR) | tài liệu vùng | — |
| Việc còn mở / lỗi đã biết / ý tưởng | [`13`](13-viec-con-lai-va-y-tuong.md) §1 (việc đang mở), §2 (lỗi / giới hạn đã biết), §3 (ý tưởng) + mục "Câu hỏi còn mở" của tài liệu vùng | `README.md` §15 | — |
| Thêm/đổi tên tài liệu | [README.md](README.md) (mục lục: §2–§5), [`01`](01-tong-quan.md) §7, §10, bảng này | `CLAUDE.md`/`AGENTS.md` nếu đổi bản đồ tài liệu | lệnh kiểm liên kết (`docs/README.md` §6) |

---

## 6. Checklist trước khi kết thúc một việc (người và agent AI)

Chép vào báo cáo cuối và tích từng dòng; dòng nào không áp dụng ghi "n/a".

- [ ] Đã đọc tài liệu vùng + mục "Khi sửa code vùng này" + ADR liên quan **trước** khi sửa.
- [ ] Không mở/trích/commit `.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json`; không in token/key; tài liệu chỉ nhắc tên biến.
- [ ] `npm run typecheck` sạch; test theo bảng §2 xanh; `npm test` trọn bộ nếu đụng nhiều vùng hoặc sắp deploy; nếu `smoke:story` đỏ, đã chạy lại với `SMOKE_STORY_SEED` in ra và ghi kết luận.
- [ ] Đụng `public/`: đã QA hình desktop + mobile ở hai trạng thái (người xem thường / `#dev=`), console không lỗi, so với `docs/preview/`.
- [ ] Số liệu hệ thống mới (nếu có) đi qua `publicStatus()` và chỉ render khi `store.dev`.
- [ ] Đụng HR / câu chuyện: không có luật cứng theo id hay trọng số 100 %; `smoke:story` vẫn chứng minh "không ai bị đánh dấu".
- [ ] Đụng thời sự / thoại: không bịa sự thật, không gán tội, bộ lọc và lưới sanitize còn nguyên (`docs/06` §13).
- [ ] Đụng AI: không thêm lời gọi ngoài `reserve()`/ngân sách; số liệu quota ghi "(đo ngày …)" nếu đo thật.
- [ ] Tài liệu vùng đã cập nhật (§5), dòng "Cập nhật lần cuối" đã đổi, "Câu hỏi còn mở" đã dọn, `CHANGELOG.md` có dòng mới, README/SPEC đã sửa hoặc đánh dấu lỗi thời; đã `grep` tên file vừa sửa trong `docs/` để làm mới số dòng.
- [ ] `git status` sạch: không `data/state.json.*`, `*.tmp-*`, `.DS_Store`, `*.log`; commit theo §7, thông điệp **bằng tiếng Anh** (yêu cầu chủ dự án 2026-11-02) nêu vì sao + docs + test.
- [ ] Nếu deploy: `deploy/.env.production` đã cập nhật (không commit); `bash deploy/deploy.sh` xong, `/api/health` trả `ok: true` + `mode` mong đợi, tải cứng thấy `/v/<ASSET_VERSION>/` mới, `pm2 logs vibecorp` không lỗi; CHANGELOG mục "Vận hành" có hash.
- [ ] Báo cáo cuối liệt kê: file code đã đổi, tài liệu đã đổi, test đã chạy + kết quả, câu hỏi mở mới, điều **chưa** làm.

Riêng agent AI: chỉ chạy test được yêu cầu hoặc cần thiết (smoke-story ~30 s, test-llm/test-router có chỗ chờ thật vài giây); không chạy `npm run eyeball:hr` hay gọi API thật nếu không được bảo (tốn quota của chủ dự án); không dùng `--setup` của deploy.sh; không bấm link `/go/` trên site thật; khi không chắc một khẳng định, ghi "(cần kiểm tra)" thay vì đoán.

---

## 7. Git: hiện trạng và quy ước

### 7.1 Hiện trạng (kiểm tra 2026-11-02)

Bối cảnh ban đầu nói "dự án chưa `git init`" đã **cũ**: thư mục đã là repo git, nhánh `main`, đã có lịch sử commit (đẩy lên github.com/Hao2505/office-ai) — `9d1d455` (2026-11-02 11:55 +07, "Khởi tạo: Văn Phòng Ảo — văn phòng công ty AI 'sống' theo thời gian thực (bản 3)") và `0e9e925` (12:00 +07, "README: thêm link xem trực tiếp corp.vibe-coder.fun"); 104 file được theo dõi; `git ls-files` **không** chứa file bí mật nào; 18 ảnh `docs/preview/` (9,7 MB) **có** trong git (rsync bỏ qua thư mục này). Tại 2026-11-02, **toàn bộ** 14 tài liệu `docs/01…14` (kể cả tài liệu này) đang **chưa được theo dõi** (`git status --short` → `??`) → cần `git add docs/*.md` và commit. Đây là câu ghi nhận duy nhất về việc này — các tài liệu khác (ví dụ `docs/13` §1, hàng về `docs/preview`) chỉ nên trỏ về đây; sau khi commit xong thì xoá ghi chú tạm này (R8). Remote: `git remote -v` → `origin git@github.com:Hao2505/office-ai.git` (fetch/push, SSH) — khớp địa chỉ `https://github.com/Hao2505/office-ai` ở `README.md:4`; chưa `git fetch` nên chưa biết `origin/main` có khác `main` cục bộ không.

`.gitignore` hiện có: `node_modules`, `.env`, `data/state.json`, `data/state.json.*`, `*.tmp-*`, `deploy/vps.env`, `deploy/.env.production`, `data/history/`, `.DS_Store`, `*.log`, `.claude/settings.local.json`. So với rsync: rsync bỏ thêm `.git`, `docs/preview`, `.claude` nhưng **không** bỏ `.DS_Store`.

### 7.2 Quy ước commit

- Thông điệp tiếng Việt, dạng `<vùng>: <mô tả ở thì hiện tại>` — khớp hai commit đã có. Vùng dùng một trong: `ai`, `sim`, `drama`, `hr`, `news`, `canvas`, `ui`, `server`, `config`, `content`, `data`, `deploy`, `test`, `docs`, `README`, `SPEC`. Ví dụ: `ai: giữ nhịp quota ngày (AI_<TÊN>_PACE), test-router mục 13`, `docs: thêm 14-quy-uoc-dong-gop`.
- Thân commit (khi không hiển nhiên): **vì sao** (không phải cái gì), nguyên tắc nào bị ảnh hưởng (§1.4), tài liệu đã cập nhật, test đã chạy. Commit do agent AI tạo ghi rõ điều đó trong thân (dòng `Co-Authored-By:` theo cấu hình của công cụ) và không được gộp thay đổi ngoài phạm vi được giao.
- Một thay đổi logic = một commit; docs đi cùng commit code (R1). Không commit "WIP" lên `main`.
- Trước mỗi commit: `git status --short` không có file bí mật/rác; `git check-ignore -v .env deploy/vps.env deploy/.env.production data/state.json` phải in ra 4 dòng (đang bị bỏ qua); `git diff --stat` khớp phạm vi việc.
- Nhánh: dự án một người, commit thẳng `main` được; việc rủi ro (đổi giao thức, đổi bản đồ, đổi hàng rào HR) làm trên nhánh `feat/<ten>` hoặc `fix/<ten>` rồi gộp sau khi `npm test` xanh. Sau mỗi lần deploy thành công, gắn tag nhẹ `deploy-YYYYMMDD-HHMM` (tuỳ chọn) hoặc ít nhất ghi hash vào CHANGELOG — để biết site thật đang chạy commit nào.
- Không rewrite lịch sử đã đẩy lên remote; không `git add -A` mù — thêm theo đường dẫn.
- `docs/preview/` 9,7 MB: cân nhắc Git LFS hoặc giữ ảnh mốc ít thôi; không thêm ảnh mới nếu không phải mốc đã duyệt (quyết định của chủ dự án).

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … | chạy |
|---|---|---|
| `package.json` (script, dependency), `tsconfig.json` | §1.1 (bảng quy ước), §2 bảng test; [`11`](11-kiem-thu-qa.md) §1–§2; `README.md` §12 | `npm test` |
| `.gitignore`, danh sách `--exclude` trong `deploy/deploy.sh` | §1.3, §7.1; [`09`](09-cau-hinh-du-lieu.md) §9; [`10`](10-van-hanh-deploy.md) | `git check-ignore`, deploy thử |
| Quy ước code (ví dụ thêm ESLint/Prettier, `engines`) | §1.1–§1.2; `SPEC.md` §0.6–0.7 (ghi chú) | `npm run typecheck` |
| `src/ai/llm.ts` `redactSecrets()` | §1.3 mục 3 | `test:router` (mục 12) |
| `src/server.ts` thứ tự route, `publicStatus()`, `devAllowed()` | §1.2 (chốt lọc), §3.6; [`02`](02-kien-truc-va-giao-thuc.md) §6, §8 | `curl` hai trạng thái |
| Thêm/đổi hằng số được các recipe trích (`SHELF_SLOTS`, `ID_RE`, `KNOWN_BASE_URLS`, `DEFAULT_LABEL`, `QUOTA_RESET_TZ`, `RETRY_TYPES`, `LABEL_POS`, `TABS`…) | mục recipe tương ứng ở §3 (số dòng + giá trị) | test của vùng |
| `scripts/smoke.ts` phần 2 (danh sách `devEvent()`), `scripts/test-router.ts` (vị trí các `section()`), `scripts/test-llm.ts` (id nhân vật trong request mẫu) | §1.3 mục 3, §3.1 mục 6/8, §3.8, §3.9 (số dòng và danh sách nút đã bấm thử) | `npm test` |
| `deploy/deploy.sh` (điều kiện tiên quyết, `APP_PORT`, lệnh health), `/api/health` (`src/server.ts:411-415`) | §2 bước 7–8, checklist §6; [`10`](10-van-hanh-deploy.md) | deploy thử, `curl /api/health` |
| Thêm / đổi tên / xoá một tài liệu trong `docs/` | §4.2, bảng §5; [README.md](README.md) (§2–§5); [`01`](01-tong-quan.md) §7, §10; `CLAUDE.md`/`AGENTS.md` nếu đổi bản đồ tài liệu | `grep -rn` tên cũ; lệnh kiểm liên kết ở `docs/README.md` §6 |
| Quy trình deploy (`deploy/deploy.sh`, nginx) | §2 bước 7–8, §3.6 mục 4; [`10`](10-van-hanh-deploy.md) | deploy thử + `/api/health` |
| Đổi định dạng `CHANGELOG.md`, cấu trúc `docs/README.md`, nội dung `CLAUDE.md`/`AGENTS.md` | §4.2–§4.3, §7.1; `docs/README.md` §3; `AGENTS.md` phải giống `CLAUDE.md` trừ dòng ghi chú đầu | `diff CLAUDE.md AGENTS.md` |
| Git: thêm remote, LFS, hook, nhánh bảo vệ | §7 | `git remote -v`, `git lfs ls-files` |

## Câu hỏi còn mở / cần kiểm tra

- ~~`CHANGELOG.md` và `docs/README.md` chưa tồn tại~~ — cả hai đã được tạo 2026-11-02 cùng `CLAUDE.md`/`AGENTS.md`; các ghi chú "chưa tồn tại" ở §4.2, §4.3 và bảng §5 đã bỏ. Việc còn lại: commit chúng cùng bộ `docs/01…14` (§7.1).
- Bộ `docs/01…14` chưa commit/đẩy lên `origin` (§7.1). Sau khi commit: xoá ghi chú tạm ở §7.1 và câu tương ứng ở `docs/13` §1 (hàng `docs/preview`, hiện còn ghi "`docs/01…08` mới viết chưa commit" — đã lỗi thời, nên trỏ về §7.1 của tài liệu này); chưa `git fetch` để biết `origin/main` có khác `main` cục bộ không.
- Tại lần kiểm 2026-11-02, `docs/04` §3 và các dòng 31/50 đã ghi "24 loại" khớp `SceneType`; nếu một bản phản biện cũ còn nói `docs/04` ghi "23" thì đó là trạng thái trước khi `docs/04` được sửa — không cần làm gì thêm ngoài giữ hai tài liệu cùng số khi thêm loại cảnh (§3.2 mục 4).
- `docs/preview/` 9,7 MB nằm trong git: chủ dự án quyết định giữ, chuyển Git LFS hay bỏ theo dõi.
- Chưa có ESLint/Prettier/`engines`/pre-commit hook; quy ước định dạng chỉ dựa trên mã hiện có. Có nên thêm một hook chặn commit file bí mật (không cần dependency: script shell + `git config core.hooksPath`)? — chờ ý chủ dự án.
- Hai bản `DESK_TAGS` khác nội dung (`src/ai/brain.ts:47`, `src/ai/offline.ts:5130`) và ba đường đọc `process.env` ngoài `CONFIG` (`director.ts:65`, `llm.ts:279`, nhánh dự phòng `cfgNum/cfgBool` `director.ts:81`/`:88`) là nợ kỹ thuật đã ghi nhận; khi gom về một chỗ nhớ sửa §1.1, §3.3, §3.5 và `docs/09` §2.3.
- `.env.example` chưa liệt kê `OPENAI_RPM/RPD/TPD` (code đọc ở `config.ts:150`) — bổ sung khi chạm `.env.example`.
- `public/` không có test tự động; `docs/11` §10 mô tả cách dựng QA headless nhưng script chưa có trong repo — nếu thêm (`scripts/qa/`), cập nhật §2 bước 4 và bảng §5.
- Chính sách cho `SPEC.md`: đóng băng làm tài liệu lịch sử (chỉ đánh dấu lỗi thời) hay tiếp tục cập nhật song song với `docs/`? Tài liệu này giả định phương án đầu (§4.4) — cần chủ dự án xác nhận.
- Thời gian chạy test ghi ở README §12 (~6 s smoke, ~30 s smoke:story) chưa đo lại trong lần khảo sát này.
