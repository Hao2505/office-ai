# Changelog — Văn Phòng Ảo

Mọi thay đổi chức năng của dự án ghi ở đây, **mới nhất trên cùng**, theo định dạng [Keep a Changelog](https://keepachangelog.com/) (tiếng Việt). Dự án chưa đánh số phiên bản (`package.json` vẫn `0.1.0`) nên nhóm theo **ngày**; "v1 / v2 / v3" chỉ là tên gọi các mốc trong ngày 2026-11-01.

## Cách ghi thêm (đọc trước khi sửa file này)

- Mỗi thay đổi **một dòng** dưới `## [Unreleased]`, đúng nhóm: **Thêm** / **Sửa** / **Xoá** / **Vận hành** / **Tài liệu** (ba nhóm đầu tương ứng Added / Changed / Removed của Keep a Changelog; hai nhóm sau là của dự án). Khi deploy lên `corp.vibe-coder.fun`, chuyển các dòng [Unreleased] xuống mục ngày `## [YYYY-MM-DD]` và thêm dòng **Vận hành** kèm hash commit để truy ngược sự cố.
- Khuôn một dòng: `- [vùng] mô tả ngắn — file chính · docs đã sửa · test đã chạy · commit`. Vùng dùng cùng bộ từ với tiền tố commit (`docs/14` §7.2): `ai`, `sim`, `drama`, `hr`, `news`, `canvas`, `ui`, `server`, `config`, `content`, `data`, `deploy`, `test`, `docs`.
- "Thay đổi chức năng" gồm cả: biến môi trường, route, thông điệp WebSocket, loại cảnh, nút dev, hoạt động, trường sản phẩm, phòng/nội thất, luật hoặc ngưỡng HR, hằng số chính sách AI, ngưỡng khẳng định trong test, bước deploy hay chỉ thị nginx, bất kỳ thứ gì người xem nhìn thấy (`docs/14` §4.1 R2). Sửa chính tả / refactor không đổi hành vi: chỉ ghi nếu đáng nhớ.
- **Không ghi bí mật** (key, token, mật khẩu, địa chỉ VPS), không ghi link affiliate. Dòng CHANGELOG đi **cùng commit** với code và với tài liệu vùng trong `docs/` (quy tắc bắt buộc ở `CLAUDE.md` mục 6).

## [Unreleased]

### Sửa
- [config] `.env.example`: chú thích model Groq gợi ý đổi từ `llama-3.3-70b-versatile · qwen/qwen3-32b` (không có ở gói free) thành `openai/gpt-oss-120b` / `qwen/qwen3.8-27b` kèm điều kiện dùng Qwen — docs/05 §2, docs/09 §2.

### Tài liệu
- [docs] Quy ước thông điệp commit đổi sang **tiếng Anh** theo yêu cầu chủ dự án (CLAUDE.md §5, AGENTS.md, docs/14 §7); các ghi chú "tên model Groq lệch giữa `.env.example` và README" trong docs/01/05/09/10/11/12/13 đánh dấu đã thống nhất; bỏ các câu đếm số commit (mau lỗi thời).
- [docs] Đẩy bộ tài liệu lên GitHub công khai `github.com/Hao2505/office-ai`.

### Thêm

### Sửa

### Xoá

### Vận hành

### Tài liệu

## [2026-11-02]

### Thêm

- [canvas] Bộ đệm chống giật theo trục giờ server: server đóng dấu `ts` lên mỗi gói `frame` (`World.output`, `src/sim/world.ts`); client neo `ts` vào `performance.now()`, giữ ≤ 10 khung hình mỗi nhân vật và vẽ trễ `store.net.buffer` ms thích ứng (sàn 260, khởi điểm 340, trần 700 — `frameTime`/`actorPos` trong `public/js/store.js`). Nguyên nhân: gói WS qua Cloudflare tới so le 100/300 ms dù CPU server ~0 %, trình duyệt 60 fps — docs/02 §10, docs/07 §4.6, docs/12 ADR-20.
- [server] Phiên bản tài nguyên tĩnh `/v/<ASSET_VERSION>/…` cache `immutable` 1 năm; `index.html` luôn `no-cache` và được viết lại để trỏ `href`/`src` qua tiền tố phiên bản (`computeAssetVersion`, `sendIndexHtml` trong `src/server.ts`) vì Cloudflare ép `max-age` 4 giờ cho `.js/.css` — docs/02 §7, docs/10 §5.2, ADR-21.
- [server] [ui] Cookie admin HttpOnly `vpa_dev` qua `POST /api/dev/login|logout`; mã dev phía client chuyển từ `sessionStorage` sang `localStorage['vpa.dev']` (di trú một lần), gỡ `#dev=`/`?dev=` khỏi thanh địa chỉ; nút 🚪 "Thoát admin" trong bảng dev (`public/js/net.js`, `public/js/ui/devbar.js`) — docs/02 §8, docs/10 §8, ADR-19.
- [ai] Giữ nhịp quota ngày `AI_<TÊN>_PACE` (`paceBlock`: bung 25 % rồi mở dần theo phần ngày quota đã trôi) và xen kẽ nguồn `AI_ROUTING=balanced` + `AI_<TÊN>_WEIGHT`; thêm `AI_<TÊN>_MAX_OUTPUT_TOKENS`, `AI_<TÊN>_MAX_REQUEST_TOKENS`, `AI_<TÊN>_EXTRA_JSON`, `AI_<TÊN>_REASONING` (`src/ai/router.ts`, `src/config.ts`) — docs/05 §2, §4; ADR-08 · `npm run test:router` mục 13. (Memo kỹ thuật xếp một phần việc này vào tối 2026-11-01; chủ dự án xếp vào mốc 2026-11-02.)
- [ai] Cloudflare Workers AI làm nguồn miễn phí thứ ba (`@cf/google/gemma-4-26b-a4b-it`, bắt buộc tắt thinking qua `AI_CLOUDFLARE_EXTRA_JSON`), khối mẫu trong `.env.example` — docs/05 §2, ADR-11, ADR-12 (danh sách nguồn đã thử và loại).

### Vận hành

- Khởi tạo git lúc 11:55 (`9d1d455` "Khởi tạo: Văn Phòng Ảo … (bản 3)", 104 file, không chứa file bí mật); `0e9e925` 12:00 thêm link site vào `README.md`. Remote `origin` trỏ GitHub `Hao2505/office-ai`; chưa kiểm `origin/main` so với `main`.
- Các sửa đổi trên đã được đưa lên https://corp.vibe-coder.fun và đo lại trên site thật (tỉ lệ khựng ≈ 85 % → ≈ 3 %, theo memo *perf-jitter-buffer*); không có hash commit tương ứng vì git được khởi tạo sau — từ nay mỗi lần deploy ghi hash.
- Số đo quota AI miễn phí (chủ dự án đo 2026-11-01): Gemini `gemini-3.5-flash-lite` 500 lượt/ngày/model, reset 0h Pacific = 15:00 giờ VN; Groq free 8.000 token/phút, 200.000 token/ngày, 1.000 lượt/ngày (riêng Qwen trần 1.000 token ra/phút → dùng `openai/gpt-oss-120b`); Cloudflare 10.000 neuron/ngày → cấu hình gợi ý trong `.env.example` — docs/10 §9.5.

### Tài liệu

- Viết bộ tài liệu kỹ thuật `docs/01-tong-quan.md` … `docs/14-quy-uoc-dong-gop.md` (đối chiếu code từng dòng, mỗi tài liệu có "Khi sửa code vùng này" và "Câu hỏi còn mở"), mục lục `docs/README.md`, `CLAUDE.md` + `AGENTS.md` (quy tắc bắt buộc: sửa code phải sửa docs + CHANGELOG), tạo `CHANGELOG.md` này; `README.md` thêm mục "Tài liệu kỹ thuật"; `SPEC.md` thêm khung ghi chú trạng thái và danh sách phần lỗi thời.

## [2026-11-01]

### v3 (tối) — thời sự, nhân sự do AI quyết, AI biên kịch, lưu trữ dài hạn

#### Thêm

- [news] Thời sự từ RSS 10 nguồn báo Việt Nam (`src/news/*`: tải và đọc RSS/Atom tối giản không thư viện, bộ lọc an toàn `judge()` nhiều lớp — từ khoá chặn, đời tư, hạnh kiểm người thật, giải trí chỉ chủ đề nhẹ — kho ≤ 40 tin/nhóm); cảnh `news_chat` với thẻ tin gốc + dòng miễn trừ; tin len vào `pantry_chat`/`lunch`; `GET /api/news`; biến `NEWS_*` — docs/06, ADR-17.
- [hr] Nhân sự do AI quyết trong cảnh `hr_review` (10 hành động `HrAction`), code làm hàng rào ba lớp (`allowedActions` → `sanitizeHrDecisions` → `validateDecisions`/`applyDecision`) và sổ `HrLedger`; cảnh mới `resign_talk`, `raise_request`, `promotion`, `layoff`; quyết định không diễn được thì hoãn sang sáng mai thay vì bỏ (`src/sim/hr.ts`, `director.ts`) — docs/04 §9, ADR-15.
- [drama] AI biên kịch `Showrunner` chọn 1–3 "biến" từ `BEAT_MENU` 17 loại mỗi ~2 giờ game, sổ mạch truyện `Arc` (≤ 2 mở), ánh xạ thành cảnh/sự kiện thường (`src/sim/story.ts`, `src/content/catalog.ts`) — docs/04 §10, ADR-16.
- [sim] Tính cách ngẫu nhiên hoá lần khởi tạo đầu (`randomizeOpeningTraits`: mọi nhân viên về một dải chung), trôi có kẹp (`driftTrait` ±0,25 quanh `traitBase`), hệ số ngày `dayFactor` U(0,75; 1,2), sự kiện cá nhân (ốm, kẹt xe, thất tình, khách chửi, trúng số), `roleKpiFactor` — docs/03 §10, ADR-14.
- [sim] Lưu trữ dài hạn JSONL theo ngày VN (`src/sim/archive.ts`: nối thêm, gzip sau 7 ngày, xoá sau 180), `GET /api/history`, mục 🗂️ Lịch sử trong tab Bản tin; biến `HISTORY_*` — docs/03 §17, docs/09 §7, ADR-23.
- [server] `DEV_TOKEN`: quyền dev theo từng socket (`?dev=` trên URL WebSocket), `/api/stats` trả 404 khi không có mã; nginx tắt access log cho `/ws` và URL có `?dev=` — ADR-18, ADR-19.

#### Sửa

- [ui] HUD bỏ mọi thông tin hệ thống với người xem thường (chip 👔 sếp, chip 🤖 AI, nhãn "AI chấp bút / Bản tin mẫu", số bấm link); thêm chấm xanh/xám cạnh "TRỰC TIẾP"; server lược số liệu bằng `publicStatus()` trước khi phát — `docs/ui-polish-todo.md` §9, ADR-18.
- [ai] Groq dùng `openai/gpt-oss-120b` thay model Qwen (trần 1.000 token ra/phút, hay hỏng JSON cảnh dài); router học trần token ra từ lỗi "Request too large", bóc lỗi dạng mảng của Gemini, bỏ gợi ý "retry in 27s" khi hết quota ngày và chờ tới 0h Pacific — ADR-09, ADR-10.
- [hr] Bỏ luật cứng v1/v2 "N ngày KPI thấp thì cảnh cáo / đuổi"; `KPI_WARN_DAYS`/`KPI_FIRE_DAYS` chỉ còn là mốc tối thiểu của hàng rào và điểm neo cho chính sách offline.

#### Vận hành

- Deploy lần đầu lúc 20:15 lên https://corp.vibe-coder.fun bằng `bash deploy/deploy.sh --setup`: VPS Ubuntu 24.04 dùng chung (1 vCPU, 2 GB), `/opt/vibecorp`, pm2 `vibecorp` dưới user `deploy`, cổng 3200, nginx site riêng + Let's Encrypt (certbot), Cloudflare proxy; nginx `limit_req` 2 r/s cho `/api/` — docs/10, ADR-22, ADR-24.

#### Tài liệu

- `docs/v3-news.md` (thiết kế gốc v3), `SPEC.md` §5.6–§5.9 và §10.

### v2 (chiều) — phòng trưng bày, HUD, sidebar co giãn, nhân vật to

#### Thêm

- [sim] [canvas] Phòng WC cũ thành **phòng trưng bày** 2 kệ (LÀM ĐẸP / CÔNG NGHỆ) + bục; WC mới là phòng kín, người vào = ẩn (`FrameAgent` flag 8, cửa hiện "Có người/Trống"); hoạt động `showroom`; cảnh `showroom_chat` bắt buộc đúng 1 câu `product: true` — ADR-26, `docs/v2-contract.md` §1, §3.
- [data] `data/products.json` thêm `category`/`shelf`/`slot`/`note`/`image`; `hello.products`; tab 🛍️ Sản phẩm; `/api/stats` đếm click theo sản phẩm × nguồn (`showroom`/`sidebar`/`scene`/`desk`).
- [ui] HUD mỏng nổi trên canvas thay thanh trên cùng; thông tin "trong thế giới" (đồng hồ treo tường, bảng trắng dự án, bảng KPI + doanh thu, biển ĐI VẮNG trên cửa phòng sếp); sidebar mặc định 320 px kéo 260–520, thu gọn + ticker; feed gom theo thẻ cảnh — ADR-27.
- [canvas] Nhân vật chibi cao ≈ 1,95 ô, nhìn nghiêng vẽ lại (profile một mắt, hướng phải = lật gương hướng trái), nhận ra từ sau lưng — ADR-25, `docs/ui-polish-todo.md` §7 ✅.

#### Sửa

- [content] Tên công ty đổi thành "Cty TNHH VibeCorp" ở mọi nơi (`COMPANY_NAME`, prompts, catalog, logo sàn).

#### Tài liệu

- `docs/v2-contract.md` (hợp đồng frontend ⇄ backend), `docs/ui-polish-todo.md` (yêu cầu làm đẹp UI), `docs/v2-spec-notes.md` (đã gộp vào `SPEC.md`).

### v1 (sáng) — lõi mô phỏng, AI, giao diện

#### Thêm

- [sim] World: tick 100 ms, bản đồ lưới 60×34 với 9 phòng / 10 bàn, di chuyển BFS, chọn việc theo trọng số utility, lịch ngày (đến – ăn trưa – về, night skip 18:30, buộc về 21:00), KPI, sếp đi vắng / đi tuần / bắt quả tang, dự án – doanh thu – sự cố, hai chế độ thời gian (`compressed` / `realtime`), snapshot `data/state.json` ghi nguyên tử — ADR-01, ADR-02, ADR-05.
- [drama] Director với 2 slot cảnh (office / online), hàng đợi lịch ngày + cảnh tự phát, 17 loại cảnh (v2 thêm `showroom_chat`, v3 thêm 6 → 24), tin đồn "tam sao thất bản", bản tin cuối ngày.
- [ai] Brain + Router nhiều provider qua API OpenAI-compatible (Gemini → Groq → thoại mẫu offline; OpenAI tuỳ chọn), cổng `reserve()` tiết kiệm token, system prompt tĩnh để cache, 4 JSON schema strict, sanitize, bộ thoại mẫu `offline.ts` — ADR-04, ADR-06, ADR-07, ADR-13.
- [canvas] [ui] Giao diện canvas + sidebar (tab Trực tiếp / Nhân sự / Bản tin / Tin đồn), hồ sơ nhân viên, bảng dev tua x1/x2/x5/x10 và nút sự kiện.
- [test] `scripts/smoke.ts`, `scripts/test-llm.ts`, `scripts/test-router.ts`; `SPEC.md` làm hợp đồng cho mọi người triển khai; không thêm npm dependency ngoài `openai`, `ws`, `dotenv` — ADR-03.
