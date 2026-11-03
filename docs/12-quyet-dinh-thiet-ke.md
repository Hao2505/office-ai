# Nhật ký quyết định thiết kế (ADR)

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: toàn dự án — mỗi quyết định trỏ tới file/hàm cụ thể trong `src/`, `public/js/`, `deploy/`, `.env.example` · Đọc khi: định sửa một cơ chế mà "không hiểu sao người trước lại làm thế"; định thêm provider AI, đổi cách phát cảnh, nới hàng rào HR/tin tức, đụng vào lớp bảo mật admin, cache tĩnh, bộ đệm chống giật; hoặc khi cần đưa ra một quyết định mới cùng loại.

Tài liệu này trả lời câu hỏi **"vì sao code lại như vậy"** — mỗi mục là một quyết định đã chốt: bối cảnh lúc đó → lựa chọn → lý do → hệ quả / ràng buộc cho người sửa sau → ngày → bằng chứng trong code. Nó không mô tả cơ chế hoạt động chi tiết (việc đó thuộc [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md), [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md), [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md), [05-lop-ai.md](05-lop-ai.md), [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md), [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md), [10-van-hanh-deploy.md](10-van-hanh-deploy.md)) và không chép lại hợp đồng gốc [`../SPEC.md`](../SPEC.md) / [`../src/types.ts`](../src/types.ts). Nguyên tắc của chủ dự án được tóm ở [01-tong-quan.md](01-tong-quan.md); việc còn mở và ý tưởng ở [13-viec-con-lai-va-y-tuong.md](13-viec-con-lai-va-y-tuong.md); quy ước khi ghi thêm ADR ở [14-quy-uoc-dong-gop.md](14-quy-uoc-dong-gop.md). Mục lục toàn bộ tài liệu: [README.md](README.md); bản đồ thư mục mã nguồn: [`../README.md`](../README.md) §13 "Cấu trúc dự án".

Quy ước: tham chiếu `file:dòng` là số dòng lúc viết (tìm theo tên hàm nếu lệch). Không có API key, token hay mật khẩu nào ở đây — chỉ **tên** biến môi trường (ví dụ `AI_GEMINI_API_KEY`). Ngày của các ADR lấy theo mốc lịch sử do chủ dự án cung cấp (v1 sáng 2026-11-01, v2 chiều, v3 tối, các sửa đổi 2026-11-02) và theo ghi chú "đo 2026-11-01" trong code/README; git của dự án chỉ đã có lịch sử commit (đẩy lên github.com/Hao2505/office-ai) đều ngày 2026-11-02 (`git log`), nên không dùng được để tra ngày của từng quyết định.

---

## 1. Bảng tóm tắt

| Mã | Quyết định | Ngày | Trạng thái | Vùng code chính |
|---|---|---|---|---|
| ADR-01 | Một thế giới chung trên server, trình duyệt chỉ là khán giả | 2026-11-01 (v1) | Đang áp dụng | `src/server.ts` `broadcast`, `src/sim/world.ts` |
| ADR-02 | Tách lớp "thân xác" (0 token) / "bộ não" (AI); AI viết **cả cảnh trong 1 JSON**, Director phát **từng dòng** | 2026-11-01 (v1) | Đang áp dụng | `src/sim/world.ts`, `src/sim/director.ts`, `src/ai/brain.ts` |
| ADR-03 | Không thêm thư viện; frontend vanilla ES module + Canvas, không build | 2026-11-01 (v1) | Đang áp dụng | `package.json`, `public/js/` |
| ADR-04 | Brain không bao giờ throw; luôn có đường lui thoại mẫu offline + "cấp cứu" | 2026-11-01 (v1) | Đang áp dụng | `src/ai/brain.ts`, `src/ai/offline.ts`, `src/ai/sanitize.ts` |
| ADR-05 | Trạng thái sống = 1 file JSON có trần, ghi nguyên tử; `STATE_VERSION` không tăng khi chỉ thêm trường | 2026-11-01 (v1→v3) | Đang áp dụng | `src/sim/persist.ts`, `src/sim/world.ts` `save/load` |
| ADR-06 | Chỉ AI **miễn phí**, nhiều provider qua API OpenAI-compatible, failover **trong cùng request**, SDK `maxRetries: 0` | 2026-11-01 (v1) → mở rộng 2026-11-02 | Đang áp dụng | `src/config.ts` `buildProviders`, `src/ai/router.ts` `complete`, `src/ai/llm.ts` |
| ADR-07 | Tiết kiệm token: `reserve()`, chỉ gọi khi có người xem, trần ngân sách, system prompt + schema **tĩnh**, prompt theo bậc | 2026-11-01 (v1) | Đang áp dụng | `src/ai/brain.ts`, `src/ai/prompt-budget.ts`, `src/ai/schemas.ts` |
| ADR-08 | Giữ nhịp quota ngày (`PACE`) + xen kẽ nguồn (`AI_ROUTING=balanced`) | 2026-11-01 (tối) – 2026-11-02 | Đang áp dụng | `src/ai/router.ts` `paceBlock`, `balancedOrder` |
| ADR-09 | Gemini: ngày quota theo giờ Pacific, bỏ gợi ý "retry in 27s" khi hết quota ngày, bóc lỗi dạng mảng | 2026-11-01 | Đang áp dụng | `src/ai/router.ts` `QUOTA_RESET_TZ`, `penalize`; `src/ai/llm.ts` `unwrapArrayErrorFetch` |
| ADR-10 | Groq dùng `openai/gpt-oss-120b` thay `qwen/qwen3.8-27b`; học trần OTPM/TPM từ lỗi "Request too large" | 2026-11-01 (tối) | Đang áp dụng | `.env.example`, `src/ai/router.ts` `shrinkOutputCap`, `src/ai/llm.ts` `MODEL_JSON_FAIL_RE` |
| ADR-11 | Cloudflare Workers AI `@cf/google/gemma-4-26b-a4b-it` với `enable_thinking:false` qua `AI_<N>_EXTRA_JSON` | 2026-11-01 (tối) – 2026-11-02 | Đang áp dụng | `src/config.ts` `parseExtraBody`, `src/ai/llm.ts:351` |
| ADR-12 | Các nguồn AI đã thử và **loại** (và vì sao) | 2026-11-01 – 02 | Ghi nhận | `README.md` §3.2–3.3, memo chủ dự án |
| ADR-13 | JSON schema strict **tĩnh**; tự hạ xuống `json_object` khi server từ chối rõ; ràng buộc độ dài do sanitize kiểm | 2026-11-01 (v1) | Đang áp dụng | `src/ai/schemas.ts`, `src/ai/llm.ts` `adaptTo400`, `src/ai/sanitize.ts` |
| ADR-14 | Không kịch bản, không nạn nhân định trước: ngẫu nhiên hoá trait, `roleKpiFactor`, hệ số ngày, trait trôi | 2026-11-01 (v3) | Đang áp dụng (thay v1) | `src/sim/world.ts` `randomizeOpeningTraits`, `src/sim/behavior.ts` `roleKpiFactor` |
| ADR-15 | Nhân sự do AI quyết, code chỉ làm **hàng rào** (`allowed`), kiểm 3 lớp | 2026-11-01 (v3) | Đang áp dụng (thay luật cứng v1/v2) | `src/sim/hr.ts`, `src/ai/sanitize.ts` `sanitizeHrDecisions`, `src/sim/director.ts` `afterHrReview`/`applyDecision` |
| ADR-16 | AI biên kịch (showrunner) chọn "biến" từ **thực đơn cố định**, code ánh xạ thành cảnh thật | 2026-11-01 (v3) | Đang áp dụng | `src/sim/story.ts`, `src/content/catalog.ts` `BEAT_MENU` |
| ADR-17 | Tin thời sự: chỉ **bình luận** tin đã đăng; lọc nhiều lớp (từ khoá, hạnh kiểm, prompt, sanitize) | 2026-11-01 (v3) | Đang áp dụng | `src/news/filter.ts`, `src/content/catalog.ts`, `src/ai/prompts.ts`, `src/ai/sanitize.ts` |
| ADR-18 | Người xem thường **không thấy gì về hệ thống**; lược bỏ (redaction) ở **server** | 2026-11-01 (v2/v3) | Đang áp dụng | `src/server.ts` `publicStatus`, `broadcast`, `/api/stats` |
| ADR-19 | Quyền admin bằng `DEV_TOKEN`: `#dev=` → `localStorage` + cookie HttpOnly `vpa_dev`; so khớp timing-safe; nginx tắt log | 2026-11-01 (v3) → cookie 2026-11-02 | Đang áp dụng | `src/server.ts` `devAllowed`, `handleDevCookie`; `public/js/net.js`; `deploy/nginx.site.conf` |
| ADR-20 | Chống giật: server đóng dấu `ts` lên `frame`, client vẽ trễ theo bộ đệm thích ứng trên **trục giờ server** | 2026-11-02 | Đang áp dụng | `src/sim/world.ts:2767`, `public/js/store.js:146-202` |
| ADR-21 | Tài nguyên tĩnh có phiên bản `/v/<ASSET_VERSION>/…` cache mãi; `index.html` no-cache (vì Cloudflare ép max-age 4 giờ) | 2026-11-02 | Đang áp dụng | `src/server.ts` `computeAssetVersion`, `sendIndexHtml` |
| ADR-22 | nginx `limit_req` 2 r/s cho `/api/` + trần đọc lịch sử song song ở app | 2026-11-01 (v3) | Đang áp dụng | `deploy/nginx.limit.conf`, `deploy/nginx.site.conf`, `src/server.ts:271` |
| ADR-23 | Lưu trữ dài hạn = JSONL theo ngày (giờ VN), nối thêm, **mọi thứ có trần**, gzip/xoá tự động | 2026-11-01 (v3) | Đang áp dụng | `src/sim/archive.ts` |
| ADR-24 | Deploy lên VPS dùng chung: thư mục/cổng/site nginx riêng, pm2 user `deploy`, chứng chỉ Let's Encrypt cho khối 443 (Cloudflare SSL Full (strict)) | 2026-11-01 | Đang áp dụng | `deploy/deploy.sh` |
| ADR-25 | Nhân vật chibi **vẽ thủ tục** từ `look`, 4 hướng (nghiêng = lật gương), cao ~1,95 ô | 2026-11-01 (v1→v2) | Đang áp dụng | `public/js/render/character.js`, `src/types.ts` `Look` |
| ADR-26 | WC thành **cửa đóng** (người vào = ẩn, flag 8); phòng WC cũ thành **phòng trưng bày** 2 kệ; mọi link qua `/go/:id?src=` | 2026-11-01 (v2) | Đang áp dụng | `src/sim/map.ts`, `src/sim/world.ts`, `src/content/products.ts`, `src/server.ts` `handleGo` |
| ADR-27 | Bỏ thanh trên cùng, dùng HUD nổi + thông tin "trong thế giới" (đồng hồ treo tường, bảng trắng, biển cửa sếp) | 2026-11-01 (v2) | Đang áp dụng (SPEC §8 lỗi thời) | `public/js/ui/hud.js`, `public/js/render/office.js` |
| ADR-28 | Ảnh chia sẻ link (Open Graph) + icon PNG là **ngoại lệ duy nhất** của "giao diện không ảnh"; URL tuyệt đối do server điền `%SITE_URL%` theo request | 2026-11-03 | Đang áp dụng | `public/index.html` `<head>`, `src/server.ts` `sendIndexHtml`/`siteOrigin`, `scripts/share-images.ts` |
| ADR-29 | Chữ / bong bóng / biển trên bản đồ co theo **cỡ bản đồ** (`uiScale`), HUD co theo **chỗ trống thật** (`fitHud`) thay vì breakpoint bề rộng cửa sổ; nhãn phòng vẽ mỗi khung theo px màn hình | 2026-11-03 | Đang áp dụng | `public/js/render/office.js` `uiScale`, `floor.js` `drawRoomLabels`, `public/js/ui/hud.js` `fitHud` |
| ADR-31 | Tình huống công ty (khủng hoảng, chia phe, chống đối, truyền lửa…): **AI chốt cách xử lý** trong cảnh họp (chọn 1 trong 3–4 phương án code đưa ra), **code quyết hậu quả** bằng xác suất theo phương án + tình hình; mỗi lúc 1 tình huống | 2026-11-03 | Đang áp dụng | `src/content/situations.ts`, `src/sim/story.ts` `situationActions`, `src/sim/director.ts` `dCrisisMeeting`/`afterCrisisMeeting`/`dPepTalk` |
| ADR-30 | Sản phẩm chỉ len vào thoại khi **có cớ trong câu chuyện** (nhu cầu, chủ đề mua sắm, đã sở hữu, vừa giao hàng, quà); giá chỉ nói bằng **cảm nhận** (rẻ/vừa/đáng tiền), cấm con số; danh mục = 26 món chính thức | 2026-11-03 | Đang áp dụng | `src/content/shopping.ts`, `src/sim/director.ts` `offerProduct`, `src/ai/prompts.ts`, `src/ai/sanitize.ts` `PRICE_RE`, `data/products.json` |

---

## 2. Kiến trúc lõi

### ADR-01 — Một thế giới chung trên server; trình duyệt là khán giả

- **Bối cảnh**: sản phẩm là "livestream" một văn phòng; nếu mỗi người xem có một thế giới riêng thì chi phí AI nhân theo số người xem.
- **Lựa chọn**: server mô phỏng đúng **một** World; mọi socket nhận cùng luồng `frame`/`agents`/`log`/`scene` qua `broadcast()`; client không gửi gì ngoài `{t:'ping'}` và lệnh dev (`src/server.ts:196-211`, `ClientMsg` ở `src/types.ts:488-491`).
- **Lý do**: SPEC §0.1 "Token cost does not grow with users"; số người xem chỉ ảnh hưởng **có gọi AI hay không** (`World.setViewers → brain.setAudience`, `src/sim/world.ts:959-968`), không ảnh hưởng số thế giới.
- **Hệ quả / ràng buộc**: không có "tương tác cá nhân" với nhân vật (không chat, không vote) — mọi thứ thêm vào sau phải là **toàn cục**. Socket nghẽn (> `MAX_BUFFERED` = 1 MiB, `src/server.ts:24`) bị bỏ gói, không gửi lại; client chậm có thể mất `log`. Chiều ngược lại cũng có trần: tin client gửi lên bị bỏ nếu rỗng hoặc > `MAX_MSG_BYTES = 2048` byte (`:23`, `:228`) và `WebSocketServer` đặt `maxPayload: 16 KiB` (`:449`) — lệnh dev mới không được gửi payload lớn. Heartbeat 30 s (`HEARTBEAT_MS`) để đếm người xem đúng — số này quyết định `LLM_ONLY_WHEN_WATCHED`.
- **Ngày**: 2026-11-01 (v1).

### ADR-02 — Hai lớp: "thân xác" 0 token và "bộ não" AI; AI viết cả cảnh trong 1 JSON, phát từng dòng

- **Bối cảnh**: cần cảm giác "real-time" (nhân vật nói từng câu, cách nhau vài giây) nhưng gọi AI theo từng câu thì tốn gấp 5–10 lần và chậm.
- **Lựa chọn**:
  - World (`src/sim/world.ts`, chú thích đầu file: *"thân xác" của văn phòng (0 token)*) lo di chuyển, hoạt động, KPI, lịch, sếp — thuần số học + bảng trọng số (`src/sim/behavior.ts`).
  - Director dựng `SceneRequest`, gọi `brain.generateScene()` **song song với lúc nhân vật đi bộ tới chỗ** (`src/sim/director.ts:1305-1322`), chờ cả hai điều kiện "đã tới" + "có thoại" rồi `startPlaying` (`:1394-1424`); người chưa tới chỗ sau `GATHER_TELEPORT_MS = 45_000` ms bị `world.teleport()` thẳng tới vị trí cảnh (`:50`, `:1406-1415`) để cảnh không chờ mãi — đây là nguồn gốc của ngưỡng "dịch chuyển tức thời" `TELEPORT_TILES` phía client (ADR-20); `playLine` phát **một dòng mỗi lần**, thời lượng bong bóng `clamp(1600 + 55·len, 2200, 7500) / min(speed,3)` và gửi `bubble.durationMs` + `nextSpeaker` để client vẽ "đang gõ" (`:1441-1480`).
  - Brain chỉ trả về `source: 'llm' | 'offline'`; Director không biết provider nào trả lời (`src/ai/brain.ts:1-7`).
- **Lý do**: SPEC §0.2 (`SPEC.md:21-22`, trích bỏ nhấn mạnh và đổi dấu nháy): *"The 'brain' (GPT) is called only to write a whole scene (4–10 lines in one JSON response), which is then played back line by line with realistic delays, so it looks real-time."* — chữ "GPT" là cách gọi của SPEC v1; nay bộ não là bất kỳ provider nào (ADR-06). Một lần gọi cho 4–10 câu + hiệu ứng (quan hệ, tâm trạng, ký ức, KPI, tin đồn, verdict, quyết định HR) rẻ hơn nhiều lần gọi, và cho phép sanitize **cả cảnh** trước khi phát câu đầu.
- **Hệ quả / ràng buộc**:
  - Hạn chót phải khớp hai bên: Brain `DEADLINE_MS.scene = 27_000` (`src/ai/brain.ts:33`) < Director `RESULT_TIMEOUT_MS = 35_000` (`src/sim/director.ts:52`); đổi một bên phải đổi bên kia. `MAX_PLAY_MS = 180_000` (`:54`) phải nhỏ hơn watchdog của World `SCENE_WATCHDOG_MS = 5 phút` (`src/sim/world.ts:48`).
  - Người trong cảnh (`a.sceneId !== null`) vẫn được World di chuyển và nhận hiệu ứng mỗi phút nhưng **không tự chọn hoạt động mới / về nhà / ăn trưa** (`src/sim/world.ts:1158-1172`) — Director phải thả người (`release`) hoặc watchdog gỡ.
  - `MAX_TOKENS.scene = 1300` là **trần** `max_completion_tokens` chứ không phải chi phí (`src/ai/brain.ts:34-38`); model suy luận được ×3 (`src/ai/llm.ts:265-269`).
  - Thoại không thể "streaming" từng token — nếu muốn phải thiết kế lại cả `SceneResult`/sanitize.
- **Ngày**: 2026-11-01 (v1).

### ADR-03 — Không thêm thư viện; frontend vanilla, không bước build

- **Bối cảnh**: một người vận hành, VPS 1 vCPU/2 GB dùng chung, muốn deploy bằng `rsync` + `npm install` và sửa UI không cần toolchain.
- **Lựa chọn**: `dependencies` chỉ `dotenv`, `openai`, `ws` (`package.json`); frontend là ES module thuần nạp từ `index.html`, vẽ bằng Canvas 2D, không hình ảnh ngoài (font Google là phụ thuộc ngoài duy nhất). SPEC §0.6–0.7.
- **Lý do**: giảm bề mặt bảo trì và thời gian deploy; `tsx` chạy thẳng TypeScript.
- **Hệ quả / ràng buộc**: không có test cho `public/js` (`npm test` chỉ typecheck `src/` + các script headless); mọi chuỗi từ server chỉ vào DOM qua `textContent` (SPEC §8). Vì module import tương đối, cơ chế phiên bản tài nguyên (ADR-21) chỉ cần viết lại 2 tham chiếu trong `index.html` là toàn bộ cây module đi theo. Thêm thư viện mới = vi phạm SPEC §0.6, cần ghi ADR mới.
- **Ngày**: 2026-11-01 (v1).

### ADR-04 — Brain không bao giờ throw; luôn có đường lui offline

- **Bối cảnh**: AI miễn phí lỗi thường xuyên (429, 5xx, JSON hỏng); một livestream không được "đứng hình" vì một request lỗi.
- **Lựa chọn**: hợp đồng `Brain.generateScene` ghi rõ *"Không bao giờ throw. Lỗi/JSON hỏng => tự fallback offline"* (`src/types.ts:519`). Mỗi `generate*` bọc `try/catch` ba tầng: AI → `offline*Safe` (bộ sinh thoại mẫu `src/ai/offline.ts`, 5342 dòng, chú thích đầu file: *"dùng khi không có API key hoặc GPT lỗi/hết ngân sách… phải tự nhiên, đúng giọng từng người và ít lặp"*) → `emergency*` của `sanitize.ts` (2 câu cố định). Cầu dao: 3 lỗi request liên tiếp (mọi provider đều thất bại) → nghỉ 60 s ×2ⁿ, tối đa 10 phút (`src/ai/brain.ts:41-43`).
- **Lý do**: SPEC §0.4 "Never crash the sim"; thoại mẫu cũng là thứ chủ dự án thấy đầu tiên khi chưa có key nên được đầu tư như một sản phẩm, không phải placeholder.
- **Hệ quả / ràng buộc**: mỗi loại cảnh mới **bắt buộc** có builder offline (`BUILDERS: Record<SceneType, fn>` trong `offline.ts`), không thì rơi về `pantry_chat`. Biên kẹp hiệu ứng offline (±8 quan hệ, ±10 mood/KPI) chặt hơn sanitize LLM (±15/±25) — chưa rõ cố ý (xem câu hỏi mở). `brain.mode()` (có key) khác `usage().mode` (gọi được ngay) — chip AI dùng cái sau.
- **Ngày**: 2026-11-01 (v1).

### ADR-05 — Trạng thái sống trong một file JSON có trần, ghi nguyên tử; thêm trường không tăng `STATE_VERSION`

- **Bối cảnh**: cần khởi động lại (deploy, crash) mà không mất văn phòng đang chạy; chưa có DB.
- **Lựa chọn**: `data/state.json` = `{ version, savedAt, world, director, brain }` (`src/sim/persist.ts:5-13`), ghi `tmp + fsync + rename` (`writeJsonAtomic`), lưu mỗi 60 s và khi tắt (`src/server.ts:25,498`). Khi khôi phục: **`brain.restore` trước** (giữ chi phí/bộ đếm quota đã tiêu kể cả khi phần world hỏng), rồi `restoreWorld`, rồi `director.restore` (`src/sim/world.ts:1040-1062`); file hỏng/sai version → đổi tên `*.bad-<stamp>` và làm văn phòng mới. `STATE_VERSION = 1` giữ nguyên qua v2/v3: trường mới nhận giá trị mặc định khi thiếu (mọi `revive*` đều có fallback).
- **Lý do**: tăng version = cách ly file cũ = mất toàn bộ lịch sử công ty của người xem. Thiết kế "additive" cho phép deploy liên tục.
- **Hệ quả / ràng buộc**: cảnh đang diễn, trạng thái WC (`hidden`), `onPhone`, sự cố **không sống qua khởi động lại** (`normalizeRestored`, `reviveCompany`) — cố ý. Sau `load()` thành công, `dayStartNotified = true` → `director.onDayStart` **không** được gọi (`:1066`); Director phải tự khôi phục lịch trong ngày. Mọi mảng lưu đều có trần (`LOG_KEEP 200`, `MEMORY_KEEP 8`, `KPI_HISTORY_KEEP 14`, click 500 sản phẩm × 16 nguồn) để file không phình. Lưu trữ dài hạn tách sang JSONL (ADR-23).
- **Ngày**: 2026-11-01 (v1; thứ tự brain-trước và các trần v3 cùng ngày).

---

## 3. Lớp AI

### ADR-06 — Chỉ AI miễn phí; nhiều provider qua API OpenAI-compatible; failover trong cùng request; không để SDK retry

- **Bối cảnh**: nguyên tắc (1) của chủ dự án: tốn ít token nhất, **không trả tiền**. Mỗi nguồn free đều có trần ngày thấp và hay 429/5xx.
- **Lựa chọn**:
  - Một client OpenAI SDK cho mỗi provider, chỉ cần `baseURL` (`KNOWN_BASE_URLS` cho gemini/groq, `src/config.ts:89-92`; Cloudflare phải khai `AI_CLOUDFLARE_BASE_URL`). Cấu hình theo mẫu `AI_PROVIDERS=a,b,c` + `AI_<NAME>_*` (`buildProviders`, `src/config.ts:134-197`); thiếu key/model → provider bị **bỏ qua kèm cảnh báo**, app không chết.
  - `new OpenAI({ …, maxRetries: 0 })` (`src/ai/llm.ts:316`): *"router tự failover sang provider khác thay vì SDK ngủ chờ retry"*.
  - `router.complete()` (`src/ai/router.ts:629-742`): tối đa `maxAttempts = 3` lượt HTTP/request, chọn provider theo `order()` (tier `strong` trước cho `high`/candidate/recap), bỏ provider đang nghỉ/hết lượt, phạt theo **loại lỗi** (`penalize`, `:548-599`): 429 có Retry-After → nghỉ đúng số đó; 5xx/mạng → 20 s ×2ⁿ (≤ 15 phút); 401/403/404 → tắt 1 giờ kèm tên biến `.env` cần kiểm; lỗi nội dung (`content`) và `aborted` → **không phạt**; 429 **không** có Retry-After → 30 s ×2ⁿ (`rateBackoffBaseMs`, `:569`). Các nút cùng tầm trong `ROUTER_POLICY` (`src/ai/router.ts:31-56`): `providerTimeoutMs` 20 s; `minAttemptMs` 2,5 s / `minAttemptReasoningMs` 6 s — còn ít hơn thế tới hạn chót thì **không mở** lượt gọi mới (`:648`); `defaultDeadlineMs` 25 s cho request không ghi `deadlineAt`; `retryAfterMaxMs` 6 giờ (kẹp Retry-After vớ vẩn, cũng là nhịp dò tối đa khi chờ 0h Pacific); `dailyProbeMs` 1 giờ (hết quota ngày mà không biết giờ reset → dò lại); `authDisableMs` 1 giờ; `cooldownRestoreMaxMs` 36 giờ (cooldown khôi phục từ file xa hơn thế coi là rác); `minOutputTokens` 256 (dưới mức này bỏ provider cho request đó).
  - Công tắc tắt AI = `openaiKey` rỗng (`resolveProviders`, `:307-320`) để test/smoke chạy offline không ra mạng.
- **Lý do**: README §3.5 mô tả đúng ý đồ: *"Nếu Gemini trả lỗi… app chuyển ngay sang Groq trong cùng một cảnh — người xem không thấy gì khác."* Giá mặc định 0 cho endpoint không phải OpenAI (`:181`), nên `DAILY_BUDGET_USD` chỉ có tác dụng khi dùng OpenAI trả tiền.
- **Hệ quả / ràng buộc**: `recordAttempt` tăng RPD/RPM **trước** khi gửi → provider chết liên tục vẫn tốn quota tự áp (chủ ý). Mọi provider mới phải là OpenAI-compatible `chat/completions` có `response_format`; nếu không nhận `json_schema` sẽ tự hạ `json_object` (ADR-13). Bẫy: chỉ cần đặt `AI_<N>_REASONING_EFFORT` là model bị coi là "suy luận" → xin token ra ×3 (`src/config.ts:176-179`).
- **Ngày**: 2026-11-01 (v1: Gemini → Groq); mở rộng Cloudflare + các nút `PACE/WEIGHT/MAX_*_TOKENS/EXTRA_JSON/REASONING` 2026-11-01 (tối) – 2026-11-02.

### ADR-07 — Tiết kiệm token bằng cổng `reserve()`, "không ai xem thì không gọi", trần ngân sách, prompt tĩnh + prompt theo bậc

- **Bối cảnh**: quota free tính theo **lượt/ngày** (Gemini 500) và **token/ngày** (Groq 200k) — thứ cần tiết kiệm là số lần gọi và kích cỡ mỗi lần.
- **Lựa chọn** (SPEC §0.3 "Hard token guards"):
  - Director phải hỏi `brain.reserve(priority)` trước mỗi cảnh (`src/ai/brain.ts:235-260`): không provider sẵn → nhịp offline (`OFFLINE_MIN_SECONDS`); hết ngân sách hoặc `LLM_ONLY_WHEN_WATCHED && viewers === 0` → cảnh thường bị **bỏ** (`skipped++`), chỉ `high` được offline; đầy `MAX_CONCURRENT_LLM` → chỉ `high` xếp hàng; `low` cần cách `MIN_SECONDS_BETWEEN_LLM` (20 s), `normal` một nửa.
  - System prompt dựng **một lần** khi `createBrain` (`:113-115`) và JSON schema **tĩnh** (`src/ai/schemas.ts:1-10`: *"OpenAI đặt schema TRƯỚC system prompt trong prefix được cache → không bao giờ nhét dữ liệu động"*) để tận dụng prompt cache.
  - User prompt cảnh dựng theo 4 bậc rút gọn (`SCENE_TIERS`, `src/ai/prompt-budget.ts:41-46`), ngân sách `min(2000, 1200 + 200·(n−3))` token (`:21-24`), ước lượng **2,7 ký tự/token** đo thật trên Gemini tiếng Việt (`:1-10`).
- **Lý do**: README §4: *"AI chỉ được gọi ở 'khoảnh khắc thú vị' và mỗi lần gọi viết cả một cảnh."* Hệ số 2,7 cố ý **đếm dư** để không bị cắt ngang JSON.
- **Hệ quả / ràng buộc**: đổi `COMPANY_NAME`/`COMPANY_INFO` phải **khởi động lại** (system prompt nướng sẵn). Có **hai** hàm `estimateTokens` khác hệ số: `src/ai/llm.ts:163` (3,5 — chỉ cho đo usage khi server không trả) và `prompt-budget.ts:13` (2,7 — cho `fits()` và ngân sách) — dễ nhầm, xem câu hỏi mở. Thêm trường vào prompt cảnh phải chạy `npm run test:llm` (mục "kích cỡ prompt ≤ 2,5k token"). `generateBeats` **không** qua `reserve()` nhưng vẫn tôn trọng ngân sách và "không ai xem" (`:342-352`).
- **Ngày**: 2026-11-01 (v1); prompt theo bậc và 2,7 ký tự/token cùng ngày (ghi chú "đo thật").

### ADR-08 — Giữ nhịp quota ngày (`AI_<N>_PACE`) và xen kẽ nguồn (`AI_ROUTING=balanced`)

- **Bối cảnh**: Gemini free 500 lượt/ngày/model, reset 0h Pacific = 14–15h giờ VN. Chạy theo thứ tự ưu tiên, Gemini **cạn trong vài giờ đầu** rồi cả buổi chiều chỉ còn Groq (tiếng Việt cứng) hoặc thoại mẫu — chủ dự án phàn nàn trực tiếp.
- **Lựa chọn**:
  - `paceBlock()` (`src/ai/router.ts:437-458`): mỗi provider được dùng **bung** `max(25% limit, 30 lượt / 30k token)` rồi mở dần theo **phần ngày quota đã trôi** (`allowance = burst + limit × frac`); vượt → coi như đang nghỉ với lý do *"giữ nhịp cho đủ cả ngày… mở lại dần"*, kiểm lại sau ≥ 1 phút. Mặc định bật (`pace: true`), tắt bằng `AI_<N>_PACE=false`.
  - `balancedOrder()` (`:461-475`): xáo thứ tự theo `(quota còn lại + 0.05) × AI_<N>_WEIGHT × (0.5 + random)`; hoà theo thứ tự cấu hình. Tier `strong` vẫn được đưa lên trước cho việc quan trọng (`order`, `:478-483`). `.env.example` mặc định `AI_ROUTING=balanced`.
- **Lý do**: chú thích trong code: *"trước đây Gemini (500 lượt/ngày) bị xài sạch trong vài giờ đầu rồi phải chờ tới 0h Pacific"*; README §3.5: *"không còn cảnh Gemini cạn lúc 17h và chờ tới 15h hôm sau"*. Xen kẽ còn giúp Gemini (tiếng Việt tốt nhất) gánh phần lớn mà không độc chiếm.
- **Hệ quả / ràng buộc**: giữ nhịp dựa trên `AI_<N>_RPD/_TPD` **tự khai** — khai sai thì nhịp sai; không khai = không giữ nhịp. `paceBlock` coi ngày quota = đúng 24 h (`start = end − 86_400_000`) → ngày đổi DST của Pacific lệch 1 giờ (chấp nhận). `balancedOrder` áp cho **mọi** task kể cả candidate/recap (README nói "cảnh thường" là chưa chính xác; hệ quả nhỏ vì `strong` vẫn ưu tiên). Test: `npm run test:router` mục 13.
- **Ngày**: 2026-11-01 (tối) – 2026-11-02 (giới hạn đo ngày 2026-11-01; chủ dự án xếp vào mốc 02/11).

### ADR-09 — Gemini: đếm ngày theo giờ Pacific, không tin gợi ý "retry in 27s" khi hết quota ngày, bóc lỗi dạng mảng

- **Bối cảnh**: khi hết 500 lượt/ngày, Gemini vẫn trả 429 kèm *"retry in 27s"*; làm theo thì router gọi lại liên tục cả buổi và đốt lượt tự áp. Endpoint OpenAI-compatible của Gemini còn trả body lỗi dạng **mảng** `[{"error":{…}}]` mà SDK không đọc được ("400 status code (no body)") → không nhận ra sai key / hết quota.
- **Lựa chọn**: `QUOTA_RESET_TZ = { gemini: PACIFIC_TZ }` (`src/ai/router.ts:57`) — provider tên `gemini` hoặc có `BASE_URL` Google đếm RPD/TPD theo ngày Pacific; `dailyHintTrustMs = 10 phút` (`:40`): gợi ý chờ ngắn hơn 10 phút khi lỗi là **quota ngày** và provider **biết giờ reset** thì bỏ qua, nghỉ tới 0h Pacific (`penalize`, `:553-563`). `unwrapArrayErrorFetch` bọc `fetch` của SDK để bóc phần tử đầu của mảng (`src/ai/llm.ts:294-309`). Phân loại "quota ngày" bằng `isDailyQuota` (`:150-157`): có `DAILY_RE` (`per day|daily|RPD|TPD…`) mà không có `MINUTE_RE` → ngày; có `per minute` → không; còn lỗi "quota exceeded / resource_exhausted / insufficient_quota / billing…" **chung chung** (`QUOTA_RE`, `:109`) cũng bị coi là quota ngày **trừ khi** server gợi ý chờ < 10 phút (khi đó coi là tạm thời).
- **Lý do**: README §3.5: *"gợi ý 'retry in 27s' của Google lúc hết quota ngày là sai nên app bỏ qua"*. Groq thì báo chính xác (*"tokens per day … try again in 1m2s"*) nên **tin máy chủ**.
- **Hệ quả / ràng buộc**: thêm provider có mốc reset khác giờ VN → thêm vào `QUOTA_RESET_TZ`; nếu không, "ngày" tính theo giờ VN (xấp xỉ). Log cooldown in rõ *"reset lúc 0h giờ Pacific (HH:MM giờ VN)"*. Test: `test-router.ts` mục quota ngày (body mảng, gợi ý 27 s bị bỏ).
- **Ngày**: 2026-11-01.

### ADR-10 — Groq: `openai/gpt-oss-120b` thay `qwen/qwen3.8-27b`; học trần token ra từ lỗi "Request too large"

- **Bối cảnh**: Groq free đo ngày 2026-11-01: 8.000 token/phút, 200.000 token/ngày, 1.000 lượt/ngày **theo từng model**; riêng `qwen/qwen3.8-27b` còn trần **1.000 token ra/phút (OTPM)** và **hay hỏng JSON** ở cảnh dài (Groq trả 400 `json_validate_failed`). Với `max_completion_tokens` 1300 (×3 nếu coi là suy luận), mỗi request đều bị *"Request too large … OTPM Limit 1000"* → nghỉ 30 s vô ích rồi rơi về thoại mẫu.
- **Lựa chọn**:
  - Model mặc định `AI_GROQ_MODEL=openai/gpt-oss-120b`, `AI_GROQ_REASONING_EFFORT=low`, `AI_GROQ_RPM=2`, `AI_GROQ_MAX_OUTPUT_TOKENS=1500`, `AI_GROQ_MAX_REQUEST_TOKENS=8000`, `AI_GROQ_WEIGHT=0.35` (`.env.example`; README §3.2: *"JSON ổn định nhất, tiếng Việt đúng nhưng hơi cứng"*; qwen: *"nếu dùng, đặt `AI_GROQ_REASONING=false`, `AI_GROQ_MAX_OUTPUT_TOKENS=900`"*). **Tên model lệch giữa hai nguồn hướng dẫn**: README §3.2 (`README.md:101`) và memo chủ dự án ghi `qwen/qwen3.8-27b`, nhưng chú thích `.env.example:32` lại gợi ý `llama-3.3-70b-versatile · qwen/qwen3-32b`; tài liệu này dùng tên của README, model id thật trên Groq cần kiểm tra (câu hỏi mở 17). — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
  - Router đọc lỗi OTPM/TPM (`TOO_LARGE_RE`, `parseTooLarge`, `src/ai/router.ts:88-105`) → **không phạt**, hạ `max_completion_tokens` còn 90% Limit (`shrinkOutputCap`, `:607-614`), **nhớ 7 ngày** (`outputCapRememberMs`), thử lại ngay trên cùng provider tối đa 2 lần/request (`:683-703`). `fits()` (`:486-491`) không gửi request ước lượng vượt `AI_<N>_MAX_REQUEST_TOKENS`.
  - `json_validate_failed|failed_generation` → `Adapt400 = 'content'`: lỗi của **một lần sinh**, không phải lỗi provider (`MODEL_JSON_FAIL_RE`, `src/ai/llm.ts:285`, `adaptTo400:417`).
- **Lý do**: README §3.5: *"Gặp lỗi 'Request too large', app tự hạ max_completion_tokens… và thử lại ngay — không bị nghỉ 30 giây, không rơi về thoại offline một cách vô ích."* Trọng số 0,35 vì tiếng Việt của gpt-oss cứng → chỉ gánh ~1/3 cảnh thường khi nguồn khác còn quota.
- **Hệ quả / ràng buộc**: trần học được lưu trong snapshot (`maxOutputTokens/Until`) nhưng trạng thái "bỏ tham số" của client (`dropped`, `useMaxTokensParam`) **chỉ trong bộ nhớ** → sau restart có thể 400 một lần rồi tự thích nghi. Đổi model Groq phải đo lại OTPM và chỉnh `MAX_OUTPUT_TOKENS`. Cấu hình thật trên VPS là của chủ dự án (không chép vào tài liệu).
- **Ngày**: 2026-11-01 (tối, đợt sửa v3).

### ADR-11 — Cloudflare Workers AI với Gemma 4, bắt buộc tắt "thinking" qua `AI_CLOUDFLARE_EXTRA_JSON`

- **Bối cảnh**: cần nguồn free thứ ba để xen kẽ; Cloudflare Workers AI cho 10.000 neuron/ngày. Trong các model free thử được, `@cf/google/gemma-4-26b-a4b-it` tiếng Việt tự nhiên nhất ("bay màu", "ăn hành") nhưng mặc định bật chế độ suy nghĩ → ~30 s/cảnh và tốn neuron gấp 4.
- **Lựa chọn**: cho phép ghép trường lạ vào body qua `AI_<N>_EXTRA_JSON` (`parseExtraBody`, `src/config.ts:74-87`: phải là JSON object; xoá 6 khoá `model/messages/response_format/max_tokens/max_completion_tokens/stream`; sai cú pháp → cảnh báo, bỏ qua) rồi `Object.assign(p, cfg.extraBody)` ngay trước khi gửi (`src/ai/llm.ts:351`). `.env.example` khối Cloudflare: `AI_CLOUDFLARE_EXTRA_JSON={"chat_template_kwargs":{"enable_thinking":false}}`, `AI_CLOUDFLARE_JSON=object`, `RPM 30 / RPD 400 / TPD 900000`.
- **Lý do**: README §3.3: *"Bắt buộc gửi kèm tham số tắt chế độ 'suy nghĩ'… không tắt thì 30 giây/cảnh và tốn neuron gấp 4. 10.000 neuron/ngày ≈ 300 cảnh; đặt lại lúc 7h sáng giờ Việt Nam."* Cách làm chung (`EXTRA_JSON`) thay vì hard-code cho Cloudflare để provider sau cũng dùng được.
- **Hệ quả / ràng buộc**: `parseExtraBody` **không** xoá `temperature`/`reasoning_effort`/`prompt_cache_key` → `EXTRA_JSON` có thể ghi đè tham số router tự đặt (tính năng kiêm bẫy). Cloudflare phải khai `BASE_URL` chứa Account ID (không có trong `KNOWN_BASE_URLS`). Giờ reset neuron (7h VN) **không** được mô hình hoá trong `QUOTA_RESET_TZ` → ngày quota tính theo giờ VN (xấp xỉ, cần kiểm tra).
- **Ngày**: 2026-11-01 (tối) – 2026-11-02.

### ADR-12 — Các nguồn AI đã thử và loại

- **Bối cảnh**: tìm thêm nguồn free để xen kẽ (ADR-08) với điều kiện: tiếng Việt tự nhiên, JSON ổn, < 20 s/cảnh (`providerTimeoutMs`), quota đủ cho ~300–500 cảnh/ngày.
- **Lựa chọn**: giữ bộ ba Gemini + Groq (gpt-oss-120b) + Cloudflare (Gemma 4). Loại:

| Nguồn / model | Lý do loại | Bằng chứng |
|---|---|---|
| Groq `openai/gpt-oss-20b` | tiếng Việt lỗi nhiều | `README.md:102` |
| Groq `qwen/qwen3.8-27b` (`.env.example:32` ghi `qwen/qwen3-32b` — tên lệch, xem ADR-10) | OTPM 1.000 token/phút, hỏng JSON cảnh dài (giữ như tuỳ chọn có hướng dẫn) | `README.md:101`, ADR-10 | — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
| Groq `llama-3.3-70b-versatile` | chỉ nằm trong chú thích gợi ý của `.env.example:32`; **không có** đánh giá/kết luận nào trong README hay memo — chưa rõ đã thử hay chưa | `.env.example:32` |
| Cloudflare Qwen3-30B | thoại nhạt | `README.md:118` |
| Cloudflare gpt-oss | tiếng Việt lỗi | `README.md:118` |
| Cloudflare GLM-5.3-flash | không có ở gói Free | `README.md:118` |
| Z.ai `glm-4.7-flash` / `glm-4.5-flash` | 4.7: hay 429 "overloaded", tiếng Việt lủng củng; 4.5: chạy được nhưng 8–29 s/cảnh (vượt timeout 20 s), tiếng Việt tầm tầm | theo chủ dự án (thử 2026-11-02); **không có dấu vết trong repo** |
| OpenRouter `:free` | 50 lượt/ngày — quá ít | theo chủ dự án |
| SambaNova | 20 lượt/ngày | theo chủ dự án |
| GitHub Models | đã đóng (7/2026) | theo chủ dự án |
| Cerebras | cần thẻ | theo chủ dự án |

- **Hệ quả / ràng buộc**: `DEFAULT_LABEL` trong `src/config.ts:94-97` vẫn có nhãn `openrouter`, `cerebras`, `together`, `mistral`, `deepseek`… — chỉ là nhãn hiển thị sẵn, **không** phải đã tích hợp/kiểm thử. Thêm nguồn mới: đo RPM/RPD/TPD thật, đo thời gian/cảnh, chạy `DEBUG_PROMPTS=1` vài cảnh để tự đánh giá tiếng Việt, rồi ghi ADR mới vào bảng này. Không spoof User-Agent khi dò API (quy tắc chủ dự án).
- **Ngày**: 2026-11-01 – 2026-11-02.

### ADR-13 — JSON schema strict tĩnh, tự hạ xuống `json_object`, ràng buộc độ dài do sanitize kiểm

- **Bối cảnh**: cần đầu ra có cấu trúc chắc chắn từ nhiều model/proxy có mức hỗ trợ `response_format` khác nhau (OpenAI strict, Gemini, Groq, Cloudflare chỉ `json_object`).
- **Lựa chọn**: 4 schema tĩnh (`canh_hoi_thoai`, `ke_hoach_bien`, `ho_so_ung_vien`, `ban_tin_ngay`) theo quy tắc strict (`additionalProperties:false`, mọi key `required`, tuỳ chọn = nullable), **không** dùng `minItems/maxLength` (`src/ai/schemas.ts:1-10`). Khi server trả 400 nói rõ về `response_format`/`json_schema` → nhớ `json_object` 24 giờ cho provider đó (`SCHEMA_REJECT_RE`, `src/ai/llm.ts:283`; `jsonObjectRememberMs`), hoặc đặt sẵn `AI_<N>_JSON=object`. Mọi ràng buộc nội dung (độ dài câu ≤ 220, delta ±15/±25, speaker ∈ participants…) do `sanitize.ts` kiểm lại và có `deriveSummary`/mặc định cho trường thiếu.
- **Lý do**: schema nằm trong prefix cache của OpenAI → tĩnh để không trượt cache; proxy cũ không hiểu `maxLength` → đẩy kiểm tra về code; `json_object` cần chữ "JSON" trong prompt nên mẫu `SCENE_JSON` nằm trong system prompt (`src/ai/prompts.ts:64-66`).
- **Hệ quả / ràng buộc**: thêm trường vào `SceneResult` = sửa `schemas.ts` + `prompts.ts` (mẫu JSON) + `sanitize.ts` + `offline.ts` + `types.ts` + SPEC §6.3. Không bao giờ nhét id nhân vật vào `enum` của schema.
- **Ngày**: 2026-11-01 (v1).

---

## 4. Câu chuyện, nhân sự

### ADR-14 — Không kịch bản, không ai bị "đánh dấu" nạn nhân

- **Bối cảnh**: v1 đặt Tú `diligence 0.3 / laziness 0.8` và SPEC §2 ghi thẳng *"at risk of being fired — the first firing arc"*; HR theo luật cứng → Tú **luôn** bị đuổi ngày 4–5 (mạch "Tú bị đuổi ngày 4–5" của v1, `SPEC.md:207`). Chủ dự án gọi đó là "có sẵn" (2026-11-01) và yêu cầu chuyện phải ngẫu nhiên-nhưng-hợp-lý, AI quyết.
- **Lựa chọn** (v3):
  - `randomizeOpeningTraits()` (`src/sim/world.ts:216-224`): lần khởi tạo đầu, nhân viên (không sếp/HR) được **thay** `diligence ← U(0.45, 0.7)`, `laziness ← U(0.35, 0.6)` (dải chung, bỏ hẳn giá trị roster), rồi mọi trait ± 0,15, kẹp 0,05..0,95; lưu `traitBase`. Công tắc `STORY_RANDOMIZE_TRAITS`.
  - `roleKpiFactor()` (`src/sim/behavior.ts:129-137`): KPI/phút nhân `kpiTarget gốc của vai / 260` (kẹp 0,7..1,4) để % KPI **không phụ thuộc vai** — trước đó Tú (chỉ tiêu 300) luôn thấp hơn Bảo (250) dù chăm bằng nhau.
  - Hệ số ngày `dayFactor ∈ [0.75, 1.2]` + sự kiện cá nhân hiếm (ốm, kẹt xe, thất tình…) có log để người xem hiểu; trait **trôi** quanh `traitBase ± 0.25`, mỗi lần ≤ 0,2 (`driftTrait`), công tắc `STORY_TRAIT_DRIFT`.
  - Roster **vẫn tả** Tú lười trong `bio/speechStyle` làm chất liệu thoại (`src/content/roster.ts:185-197`), nhưng không còn quyết định số phận.
- **Lý do**: chú thích `src/sim/world.ts:76-83` ghi số liệu thật: *"với roster v1 (Tú 0.3 / Khoa 0.9) chỉ kéo người cực đoan về sàn vẫn để Tú / Tùng / Trâm chiếm 94% số lần bị đuổi qua 36 hạt"* → phải đưa **mọi** nhân viên về một dải chung. Memo chủ dự án: *"a predictable arc kills rewatch value"*.
- **Hệ quả / ràng buộc**: SPEC §2 và §10.4 còn mô tả cách cũ ("diligence < 0.45 → U(0.45, 0.55)") — **lệch code**, code thắng. `README.md:344` (§6.1) ghi hệ số ngày **"0,55–1,2"** trong khi code là `DAY_FACTOR_MIN = 0.75`, `DAY_FACTOR_MAX = 1.2` (`src/sim/world.ts:85-86`, khớp SPEC §10.4 U(0.75, 1.2)) — README cũng lệch, cần sửa về 0,75–1,2. Test không được khẳng định "Tú bị đuổi"; `scripts/smoke-story.ts` kiểm *"qua các hạt, tập người bị nhắc / cho nghỉ khác nhau ít nhất một lần; có hạt KHÔNG đuổi ai"*. Người do AI sinh sau không bị ngẫu nhiên hoá (họ vào sau, chuyện kể tự nhiên).
- **Ngày**: 2026-11-01 (v3), thay thế thiết kế v1 cùng ngày.

### ADR-15 — Nhân sự do AI quyết; code chỉ làm hàng rào; AI chỉ chọn trong `allowed`

- **Bối cảnh**: bỏ luật cứng "N ngày thấp thì đuổi" nhưng không thể tin AI mù quáng (có thể đuổi người mới, thưởng cả phòng, hứa trong thoại rồi không làm).
- **Lựa chọn**: cảnh `hr_review` (HR + sếp) định kỳ `HR_REVIEW_EVERY_DAYS` hoặc khi có lý do. Prompt đưa **hồ sơ từng người** kèm danh sách `allowed` do code tính (`allowedActions`, `src/sim/hr.ts:195-219`: `warn` cần `lowStreak ≥ 1`; `fire` cần `lowStreak ≥ 2 && (warnings ≥ 1 || lowStreak ≥ KPI_FIRE_DAYS) && tenure ≥ 3 && cách lần đuổi trước ≥ 2 ngày`; `bonus` toàn công ty ≤ 1/7 ngày; `promote` avg7 ≥ 1,15 trên ≥ 5 ngày **và** thâm niên ≥ 10 ngày, cách lần thăng chức trước ≥ 7 ngày, không có cảnh thăng chức đang chờ (`!env.promotionPending`, `:215`); `layoff` chỉ khi 2 kỳ doanh thu kém, thâm niên ≥ `LAYOFF_MIN_TENURE = 10` (`:176`), cùng cap 2 ngày với fire, ≤ `MAX_LAYOFFS_PER_MONTH = 2` đợt/tháng (`:216`)…) và trần một lần họp (`dossierLines`, `src/ai/prompts.ts:576-577`). Kết quả qua **ba lớp** kiểm:
  1. `sanitizeHrDecisions` (`src/ai/sanitize.ts:364-407`): giữ tối đa `LIMITS.maxDecisions = 6` quyết định (`:28`); action ngoài `allowed` → `none` nhưng ghi `reason = "ngoài hàng rào (<action>): …"` để Director **kể lại** ("sếp đổi ý…") vì thoại đã hứa;
  2. `validateDecisions` (`src/sim/hr.ts:303-341`): chỉ xét 12 mục đầu (`raw.slice(0, 12)`, `:311`), thi hành ≤ `MAX_DECISIONS = 4` (`:297`), ≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise/bonus, mỗi người 1 quyết định, trả `rejected[].why` tiếng Việt;
  3. `applyDecision` (`src/sim/director.ts:3277-3300`): **hàng rào lần hai** với số liệu lúc thi hành ("tình hình đã đổi, chưa đủ căn cứ").
  Khi cảnh do AI viết, quyết định là của AI — rỗng nghĩa là "chưa động tới ai", **không** rơi về chính sách offline (`afterHrReview`, `:3225-3232`). Không có AI → `offlineDecisions` ngẫu nhiên có trọng số leo thang quanh `KPI_WARN_DAYS/KPI_FIRE_DAYS`, *"không bao giờ chắc chắn 100%"* (`src/sim/hr.ts:377-417`).
- **Lý do**: đầu `src/sim/hr.ts:1-7`: *"Không có luật cứng 'N ngày thấp thì đuổi' nữa: KPI_WARN_DAYS / KPI_FIRE_DAYS chỉ còn là mốc tối thiểu của hàng rào + điểm neo cho chính sách offline."* README §6.2: *"Code không tin AI mù quáng — mỗi quyết định phải qua hàng rào hợp lý."*
- **Hệ quả / ràng buộc**: sếp/HR không bao giờ bị loại (`NEVER_FIRED`). `open_position` thực tế **chưa bao giờ** được phép: `freeDesks` (`:283-289`) coi bàn của mọi người `active/candidate` **và của mọi vị trí trống đang mở** là đã giữ; mà `detectVacancies` (`:503-518`, gọi ở `src/sim/director.ts:4089` mỗi lượt sweep khi không suy thoái) tự mở vị trí **thay thế** cho vai không còn ai → bàn của người vừa nghỉ lập tức bị giữ lại; cộng với bản đồ đúng 10 bàn cho 10 vai nên `freeDesk = false` luôn. Muốn `open_position` xảy ra phải vừa thêm bàn trong `map.ts` vừa xét lại logic này (câu hỏi mở 15). Cảnh fire/layoff/promotion không diễn được → **hoãn sang sáng mai**, không bỏ lặng lẽ; cap `lastFireDay` chỉ ghi khi cảnh diễn xong. Nới hàng rào = sửa `allowedActions` **và** chạy `npm run smoke:story` (kiểm hàng rào độc lập qua `hooks.decision`), cập nhật bảng README §6.2 + SPEC §5.6.
- **Ngày**: 2026-11-01 (v3).

### ADR-16 — AI biên kịch chọn "biến" từ thực đơn cố định; code ánh xạ thành cảnh thật

- **Bối cảnh**: muốn có mạch truyện nhiều giờ (xung đột → leo thang → làm hoà) mà không viết kịch bản tay và không cho AI "điều khiển World" trực tiếp.
- **Lựa chọn**: `Showrunner` (`src/sim/story.ts:1-10`) mỗi `SHOWRUNNER_EVERY_GAME_MINUTES` (120) gọi `brain.generateBeats` với tình hình ≤ 900 ký tự và **menu 17 loại** (`BEAT_MENU`, `src/content/catalog.ts:308-326`); AI chỉ chọn `kind + a + b + intensity + note`; code giữ sổ mạch (`MAX_OPEN_ARCS = 2`, `MAX_ARCS_KEPT = 8`, `MAX_RECENT_BEATS = 10`, `story.ts:69-73`), ánh xạ từng bước thành `StoryAction` (xếp cảnh vào hàng đợi thường, sự kiện, chỉnh mood…) → vẫn qua slot/cooldown/`reserve()`. Bước giữa chỉ **thi hành** với xác suất 0,88 (`chance(0.88)`, `src/sim/director.ts:3692`) — 12% bị bỏ qua (chỉ `story.advance`) cho khỏi gượng; bước kết luôn chạy. Director chỉ dùng AI khi `brain.mode() === 'llm'` và không `llmGated()`, nếu không `offlinePlan` (`src/sim/director.ts:3626-3659`).
- **Lý do**: *"người xem chỉ thấy đời sống văn phòng, không thấy 'AI lên beat'"* (story.ts header); menu cố định = hàng rào nội dung (vd `crush_rumor` "trong sáng, không bao giờ nói chuyện thân mật quá mức").
- **Hệ quả / ràng buộc**: thêm beat mới = thêm `BEAT_MENU` + `BEAT_CAST` + `actionsFor` + offline weights + test smoke:story (≥ 3 beat, ≥ 1 mạch kết). Sàn nhịp không khớp: `config.ts` ≥ 30, `director.ts` ≥ 20 (config thắng). `comeback`/`headhunt_rumor` trong `docs/v3-news.md` là **ý tưởng chưa làm**.
- **Ngày**: 2026-11-01 (v3).

---

## 5. Thời sự

### ADR-17 — Chỉ bình luận tin đã đăng; lọc an toàn pháp lý nhiều lớp

- **Bối cảnh**: nguyên tắc (5) của chủ dự án — nhân vật được bàn tin thật cho đa dạng nhưng **không vu khống, không bịa, không gán tội**, không đụng chính trị/đời tư.
- **Lựa chọn** (từ RSS tới màn hình, mỗi lớp độc lập):
  1. **Kho tin** chỉ nhận RSS báo chính thống (10 feed mặc định), mỗi tin dùng **1 lần**, không cũ hơn `NEWS_MAX_AGE_DAYS` (3).
  2. **`filter.judge()`** (`src/news/filter.ts:254-274`): `invalid → old → blocked` (BLOCKLIST ~290 mục + `PRIVATE_LIFE` + mẫu regex "tố"/"kiện" + `NEWS_BLOCKLIST` thêm) → `conduct` (`PERSON_CONDUCT` khi tin về một con người) → giải trí chỉ chủ đề nhẹ **theo tiêu đề** (`SHOWBIZ_ALLOW`). So khớp theo ranh giới từ: từ đơn **có dấu** ("án" ≠ "an toàn"), cụm ≥ 2 từ **không dấu**, tiền tố `=` ép có dấu (`matchKeyword`, `:50-62`); ngoại lệ CLB "Công An Hà Nội", "bị bắt bài" (`BLOCK_EXCEPTIONS`, `:145`).
  3. **Director** lọc lần hai với `newsBlocked()` (cụm riêng + gọi lại `blockedTopic` của filter để hai lớp đồng bộ, `src/content/catalog.ts:460-468`; `validNews`, `src/sim/director.ts:2996-3008`).
  4. **Prompt**: `NEWS_RULES` trong user prompt và `NEWS_RULES_SHORT` trong system (`src/ai/prompts.ts:72-79`): *"không thêm sự thật, con số, phát ngôn… giữ mức dè dặt ('nén khóc' ≠ 'khóc')… không đoán động cơ"*; `NEWS_SAFETY_RULES` lặp trong tình huống cảnh (`catalog.ts:471-474`).
  5. **Sanitize**: bỏ câu dính `NEWS_BLOCK_RE` (bắt giữ, khởi tố, lừa đảo, ngoại tình… trừ thành ngữ "bị bắt lười/quả tang", `src/ai/sanitize.ts:75`), bỏ câu **phán xét người có tên trong tin** (`judgesNamedPerson` + `JUDGEMENT_RE`, `:114-124`), bỏ câu lẫn chữ Hán/Hàn/tiếng Anh nguyên câu (`looksForeign`); ký ức của cảnh thời sự theo **mẫu cố định** `Bàn tin "<title>" (<source>)` (`:524`) — không giữ "sự thật" model viết.
  6. **Giao diện**: thẻ tin gốc (tiêu đề · nguồn · "Đọc bài ↗") đi kèm cảnh để người xem tự kiểm chứng (`LogEntry.news`/`PublicScene.news` chỉ là `NewsRef`, không có `summary`).
- **Lý do**: `docs/v3-news.md` "Nguyên tắc an toàn" 1–4; chú thích `filter.ts:1-8`. Lớp 3 tồn tại vì tin có thể đến từ state cũ (khôi phục) được lọc bằng danh sách cũ.
- **Hệ quả / ràng buộc**: thêm từ chặn → `npm run test:news` (30+ tiêu đề thật từng lọt phải bị chặn); đổi nhóm tin phải sửa 5 chỗ phía **server** (`NewsCategory` ở `src/types.ts:198`; `NEWS_GROUPS` ở `src/config.ts:202`; `ALL_CATEGORIES` ở `src/news/store.ts:12` — export qua `src/news/index.ts`, **không** phải `public/js/store.js`; `NEWS_CATEGORY_LABEL`/`NEWS_CATEGORIES` ở `src/content/catalog.ts:370-374`; `NEWS_CATEGORY_LABEL` ở `src/ai/prompts.ts:162`). Bộ gắn nhãn bóng đá từng dính địa danh ("Thái Bình Dương" ↔ "Bình Dương") → giờ chỉ dùng tên CLB đủ dài (`isFootball`, `src/news/feeds.ts:254-260`). `/api/news` công khai và trả `lastError` (xem câu hỏi mở).
- **Ngày**: 2026-11-01 (v3).

---

## 6. Bảo mật, quyền admin, vận hành

### ADR-18 — Người xem thường không thấy gì về hệ thống; lược bỏ ở server

- **Bối cảnh**: 2026-11-01 chủ dự án yêu cầu bỏ chip "👔 Sếp có mặt", chip AI "🤖 GPT…", số lượt bấm link, dòng "càng đông người xem…" khỏi giao diện công khai — khán giả không cần biết thứ gì chạy phía sau hay cách kiếm tiền (nguyên tắc 4).
- **Lựa chọn**: làm ở **server**, không tin client: `publicStatus()` (`src/server.ts:184-193`) giữ `bossAway/bossNote/viewers/company/speed`, đặt `clicks = 0`, `ai` chỉ còn `mode` (để vẽ chấm xanh/xám), mọi bộ đếm = 0, **không chép** `activeProvider/providers/lastError`; `broadcast()` serialize **hai bản** cho tin `status`, socket không dev nhận bản công khai (`:196-211`); `hello.dev` ghi đè theo từng socket và `hello.status` cũng lược (`:460-463`); `/api/stats` trả **404** (không phải 401/403) khi thiếu quyền (`:417-419`). Client chỉ bật chip AI, nhãn "AI chấp bút", số click khi `store.dev` (`public/js/ui/hud.js:186,270`).
- **Lý do**: memo chủ dự án *feedback-no-system-info*; README §3.6: *"Server lược bỏ mọi số liệu hệ thống… trước khi gửi xuống trình duyệt thường."* Sếp có mặt hay không đã thấy trong thế giới (biển "ĐI VẮNG" trên cửa phòng sếp).
- **Hệ quả / ràng buộc**: `World.hello()`/`statusInfo()` phát **đầy đủ** (`src/sim/world.ts:906-923`, `dev: !!config.devPanel` chỉ là mặc định) — **mọi đường phát mới** (SSE, API khác) tái dùng chúng phải lọc lại. Không bao giờ thêm nhãn "AI/template", provider, quota, lỗi, click vào HUD/feed/recap/profile công khai. `/api/health` công khai nhưng chỉ có `mode/viewers/day/minute`. **Nhưng** `/api/history` (không `date`) cũng công khai (`src/server.ts:435`, không qua `devAllowed`) và trả `enabled` + `stats {queued, written, dropped, errors, lastFlushAt, lastRotateAt}` (`:296-300`) — cùng loại "thông tin hệ thống" như `lastError` của `/api/news` (câu hỏi mở 8).
- **Ngày**: 2026-11-01 (v2/v3).

### ADR-19 — Quyền admin bằng `DEV_TOKEN`: `#dev=` → `localStorage` + cookie HttpOnly `vpa_dev`

- **Bối cảnh**: production cần bảng dev cho chủ dự án nhưng không cho ai khác; `DEV_PANEL=false` thì chủ dự án cũng mất. Token trong URL dễ lọt access log của nginx/Cloudflare; chỉ lưu `sessionStorage` thì mở tab mới là mất.
- **Lựa chọn**:
  - Server: `devAllowed(req)` (`src/server.ts:68-75`): `DEV_PANEL=false` → không ai; `DEV_TOKEN` rỗng → mọi người (như v1/v2); có token → so **timing-safe qua SHA-256** (`safeEqual`, `:58-62`) với `?dev=` của URL WebSocket, **chỉ khi query rỗng** mới đọc cookie `vpa_dev`. `POST /api/dev/login {token}` đặt cookie `HttpOnly; SameSite=Lax; Secure (khi https); Max-Age=31536000`, sai mã → 403 + đếm; `POST /api/dev/logout` xoá (`handleDevCookie`, `:100-121`); `DEV_PANEL=false` → cả hai route trả 404.
  - Client (`public/js/net.js:13-74`): đọc `?dev=` rồi `#dev=`, cất `localStorage['vpa.dev']` (di trú từ `sessionStorage` cũ), **gỡ khỏi thanh địa chỉ** bằng `replaceState`, gọi `/api/dev/login` một lần mỗi lần mở trang, nối WS với `?dev=`; nút 🚪 trong bảng dev gọi `forgetDevToken()` (xoá storage + logout + reload, `public/js/ui/devbar.js:39-42`).
  - nginx: `location = /ws { access_log off; }` và `if ($arg_dev) { access_log off; }` (`deploy/nginx.site.conf:12-13,42`); README §8 khuyên dùng `#dev=` vì fragment không bao giờ gửi lên máy chủ/Cloudflare.
- **Lý do**: vào bằng link **một lần** là nhớ mãi, kể cả tắt trình duyệt (cookie) hay xoá bộ nhớ JS (cookie HttpOnly vẫn còn); JS không đọc được cookie → XSS không lấy được mã.
- **Hệ quả / ràng buộc**: không bao giờ in token ra log/console/tài liệu. Hai tên cố ý khác nhau: cookie `vpa_dev` (gạch dưới) / localStorage `vpa.dev` (chấm). Mở trang với `#dev=` **rỗng** chỉ xoá `localStorage`, **không** gọi logout → cookie vẫn còn và server vẫn coi là dev (chú thích `net.js:2-3` chưa chính xác; chỉ nút 🚪 thoát hẳn). URL có `?dev=<sai>` làm cookie đúng không được xét. Mọi lệnh dev bị giới hạn `DEV_RATE` 10 lệnh/5 s/socket. Cờ `Secure` của cookie chỉ bật khi `x-forwarded-proto === 'https'` hoặc socket TLS (`src/server.ts:103`); nginx đặt `X-Forwarded-Proto $scheme` (`deploy/nginx.site.conf:21,37,51`) nên nếu Cloudflare ở chế độ **Flexible** nối origin bằng HTTP (ADR-24, `deploy.sh:53-54`) thì cookie trên production **không có** `Secure` dù người xem vào bằng HTTPS — chấp nhận được (HttpOnly vẫn còn; đoạn Cloudflare→trình duyệt vẫn HTTPS) nhưng cần biết: đổi Cloudflare sang Full thì `Secure` tự bật (câu hỏi mở 18).
- **Ngày**: `DEV_TOKEN` + `?dev=` 2026-11-01 (v3); `#dev=`, `localStorage`, cookie HttpOnly 2026-11-02.

### ADR-20 — Chống giật bằng dấu thời gian server trên `frame` và bộ đệm thích ứng phía client

- **Bối cảnh**: 2026-11-02 nhân vật trên site thật đi–khựng–đi. Đo: CPU server ~0%, trình duyệt 60 fps, nhưng gói `frame` qua Cloudflare đến **so le ~100/~300 ms** thay vì đều 200 ms (local đều 202 ms). Client cũ nội suy theo **lúc gói tới** → giữ-rồi-nhảy (tỉ lệ khựng ~85% khi đo với buffer 0).
- **Lựa chọn**: server gắn `ts: Date.now()` vào mỗi `frame` (`src/sim/world.ts:2767`; `ServerMsg.frame.ts` trong `types.ts`). Client (`public/js/store.js:140-202`): neo `ts` của frame đầu với `performance.now()` (không phụ thuộc lệch đồng hồ), giữ ≤ 10 khung hình/actor, vẽ **trễ** `store.net.buffer` ms (`NET_BUFFER_START 340`, sàn `NET_BUFFER_MIN 260`, trần 700): frame tới với `slack < 60 ms` → **nới ngay**, 40 frame liên tiếp dư nhiều → **siết dần**; nhảy > 3,2 ô = dịch chuyển tức thời (vào/ra WC). Server cũ không có `ts` → dùng lúc gói tới như trước. Canvas dùng `performance.now()` thay timestamp của rAF để cùng trục giờ với store (`public/js/render/office.js:303-308`).
- **Lý do**: nguyên nhân là **jitter mạng**, không phải CPU — thêm CPU hay giảm `FRAME_MS` không giúp. Kết quả đo trên prod sau sửa: tỉ lệ khựng ~3%, CV bước ~0,16 (memo *perf-jitter-buffer*).
- **Hệ quả / ràng buộc**: giữ nhịp `FRAME_MS = 200` (`src/sim/world.ts:34`) — các ngưỡng 260/340/700/60 được cân theo 200 ms; đổi nhịp phải cân lại. Ngưỡng `TELEPORT_TILES = 3.2` ô/khung (`public/js/store.js:149`, dùng ở `:182`) ràng với tốc độ đi bộ server: `WALK_TILES_PER_SEC = 3.2` × `min(speed, 4)` (`src/sim/world.ts:37`, `:1193`) → tối đa 12,8 ô/s × 0,2 s = **2,56 ô/khung < 3,2**, nên đi nhanh nhất vẫn không bị coi là dịch chuyển tức thời; đổi tốc độ đi, trần ×4 hay `FRAME_MS` phải cân lại ngưỡng này (dịch chuyển thật phát sinh từ `GATHER_TELEPORT_MS` của Director — ADR-02 — và vào/ra WC — ADR-26). **Không quay lại** nội suy theo lúc gói tới. Độ trễ hình ảnh tăng ~0,3 s so với server (chấp nhận; bong bóng thoại dùng `durationMs` nên không lệch nhìn thấy). `store.net` không reset khi `hello` — dựa vào ngưỡng lệch 60 s để neo lại. Đo lại bằng móc `window.__vpa` (`public/js/main.js:3-4`), script đo nằm ngoài repo.
- **Ngày**: 2026-11-02.

### ADR-21 — Tài nguyên tĩnh có phiên bản `/v/<ASSET_VERSION>/…`, `index.html` no-cache

- **Bối cảnh**: origin gửi `Cache-Control: no-cache` cho `.js/.css` nhưng Cloudflare **ép `max-age=14400`** (4 giờ) → sau deploy người xem chạy code cũ hàng giờ, khớp sai với server mới.
- **Lựa chọn**: `ASSET_VERSION` = 12 hex SHA-1 của `(đường dẫn|size|mtime)` mọi file trong `public/` tính **một lần lúc khởi động** (`computeAssetVersion`, `src/server.ts:129-146`); `sendIndexHtml` viết lại mọi `href|src="…css|js"` tương đối thành `/v/<ver>/…` và trả `no-cache` (`:150-162`); `/v/<ver>/<path>` → `handleStatic` với `immutable: ver === ASSET_VERSION` → `public, max-age=31536000, immutable`; phiên bản cũ vẫn phục vụ nhưng `no-cache` (`:437-439, 371`). Vì `main.js` import tương đối, cả cây module tự đi theo tiền tố (ADR-03).
- **Lý do**: chú thích `src/server.ts:123-127`; không cần bước build/hash tên file.
- **Hệ quả / ràng buộc**: sửa file trong `public/` **mà không khởi động lại** → URL không đổi nhưng nội dung đổi → cache immutable giữ bản cũ (nguy hiểm trong dev với `tsx watch`, vì watch không theo dõi `public/`); `rsync -a` giữ mtime nên deploy không đổi file thì phiên bản không đổi (đúng ý). Sau deploy đổi client, chủ dự án nên hard-refresh một lần (tab cũ có thể còn `index.html` cũ). Font Google là ngoại lệ chưa đi qua `/v/`.
- **Ngày**: 2026-11-02.

### ADR-22 — nginx `limit_req` cho `/api/` + trần đọc lịch sử song song trong app

- **Bối cảnh**: `/api/history?date=` có thể trả tới ~1,4 MB (giải nén gzip + parse 5000 dòng); VPS 1 vCPU/2 GB **dùng chung với app khác** — một người kéo liên tục có thể làm phình RSS và ảnh hưởng app khác.
- **Lựa chọn**: hai lớp. nginx: `limit_req_zone $binary_remote_addr zone=vpa_api:10m rate=2r/s` (`deploy/nginx.limit.conf`, chép vào `/etc/nginx/conf.d/` khi `--setup`) và `location /api/ { limit_req zone=vpa_api burst=5 nodelay; limit_req_status 429; }` (`deploy/nginx.site.conf:29-31`). App: `HISTORY_MAX_INFLIGHT = 3` → 429 + `Retry-After: 3` (`src/server.ts:271,306-309`); ngày đã nén (bất biến) trả `public, max-age=86400` để nginx/Cloudflare cache (`:320`).
- **Lý do**: chú thích `nginx.site.conf:27-28`: *"giới hạn nhịp để không ai kéo sập VPS dùng chung"*. Zone nằm ở `conf.d` riêng cho app này để không đụng site khác.
- **Hệ quả / ràng buộc**: 2 r/s áp cho **mọi** `/api/*` kể cả `/api/health`, `/api/dev/login`, phân trang tab Lịch sử — lật trang nhanh có thể nhận 429 từ nginx (khác 429 của app). Thêm API nặng mới → xem lại rate/burst. Không đụng file nginx của app khác.
- **Ngày**: 2026-11-01 (v3, cùng lúc có `/api/history`).

### ADR-23 — Lưu trữ dài hạn bằng JSONL theo ngày, mọi thứ có trần

- **Bối cảnh**: `state.json` phải nhỏ (ADR-05) nhưng chủ dự án muốn "Lịch sử công ty" nhiều tháng; chưa muốn thêm DB.
- **Lựa chọn**: `src/sim/archive.ts` — mỗi ngày (giờ VN cố định UTC+7, `VN_OFFSET_MS`, `:16`) một file `HISTORY_DIR/YYYY-MM-DD.jsonl` chỉ nối thêm, dòng `{ts, kind, data}`; hàng đợi **có trần** `maxQueue 5000` (vượt → bỏ dòng cũ nhất, đếm `dropped`), dòng > 64 KiB → cắt, flush theo lô 2 s, không bao giờ chặn tick; gzip sau `HISTORY_GZIP_AFTER_DAYS` (7), xoá sau `HISTORY_KEEP_DAYS` (180) (`defaults`, `:84-90`); đọc tối đa `HISTORY_READ_MAX = 5000` dòng/lần (`:20`); singleton **tắt** cho tới `configure({enabled:true}).start()` để test không vô tình ghi file; server bật archive **trước** khi dựng World để dòng log đầu cũng được lưu (`src/server.ts:244-247`).
- **Lý do**: `docs/v3-news.md` "Lưu trữ dài hạn": *"~50 KB/ngày… Khi có tài khoản người xem / vote / cược: chuyển sang SQLite… hoặc Postgres."* Dùng offset +7h cố định thay `Intl` để VPS đặt UTC hay múi nào cũng cho cùng kết quả (cùng cách với `src/sim/clock.ts:14`).
- **Hệ quả / ràng buộc**: archive là "best effort" — mất dòng khi quá tải là chấp nhận được, không dùng làm sổ cái. Mỗi lần khởi động lại **có state**, archive nhận vài dòng "ngày 1" giả trước khi khôi phục — đã xác nhận bằng code: `src/server.ts:244-252` gọi `getArchive().configure({enabled…}).start()` → `new World(…)` (constructor `src/sim/world.ts:473` gọi `freshInit()`) → rồi mới `world.load()`; `freshInit()` gọi `planDay(curDay)` (`:3006`) → `this.log({… '🌅 … ngày 1 — văn phòng mở cửa'})` (`:2537`; cuối tuần là dòng 🏖️ `:2534`) → `archiveRecord('log', …)` (`:891`). Cách sửa gợi ý: trì hoãn `archive.start()` tới sau `load()` (giữ `configure` trước; cần kiểm `record()` khi chưa `start()` có xếp hàng không), hoặc để `freshInit()` không ghi archive khi `PERSIST=true` và file trạng thái tồn tại. Đổi `HISTORY_DIR` → `index.json` đếm dòng được làm mới.
- **Ngày**: 2026-11-01 (v3).

### ADR-24 — Deploy lên VPS dùng chung bằng một script, không đụng app khác

- **Bối cảnh**: VPS Ubuntu 24.04 (1 vCPU, 2 GB) đã có nginx/certbot/pm2/MySQL và app khác trên các cổng 3000/3999/3100/3101; Cloudflare proxy phía trước.
- **Lựa chọn**: `deploy/deploy.sh` (`--setup` lần đầu): thư mục riêng `/opt/vibecorp`, cổng `APP_PORT` mặc định **3200**, pm2 tên `vibecorp` dưới user `deploy`, site nginx riêng `sites-available/<DOMAIN>`, `rsync -az --delete` bỏ `node_modules`, `.git`, `data/state.json` (+ `data/state.json.*`), `data/history`, `.env`, `deploy/vps.env`, `deploy/.env.production`, `docs/preview`, `.claude`, `*.log`, `*.tmp-*` (`deploy.sh:31-34`) — **không** bỏ cả thư mục `data/`: `data/products.json` vẫn được đưa lên (bắt buộc cho phòng trưng bày, ADR-26); `.env` production được `scp` riêng từ `deploy/.env.production` rồi `chmod 600` (`:38-43`). Bí mật chỉ nằm ở `deploy/vps.env` và `deploy/.env.production` (gitignored, `.gitignore`). Chứng chỉ Let's Encrypt qua `certbot --nginx` (lệnh `:56`): Cloudflare chạy SSL **Full (strict)** (Full xác nhận 2026-11-03, chủ dự án chuyển strict cùng ngày) nên request https vào origin cổng 443 và bị kiểm chứng chỉ — khối 443 với chứng chỉ hợp lệ là bắt buộc; khối cổng 80 → https mà certbot thêm là vô hại (chú thích `deploy.sh:53-54`; ghi chú cũ "Flexible, không `--redirect`" là sai). Kiểm tra bằng `/api/health` từ trong VPS và qua domain (`deploy.sh:62-63`).
- **Lý do**: memo *vps-deploy*: *"never use port 3000 or edit other nginx sites/pm2 apps"*.
- **Hệ quả / ràng buộc**: `deploy.sh` cần `sshpass`; đổi cổng phải đổi cả `.env.production` (`PORT`) và `APP_PORT`. Sau deploy đổi client → ADR-21 (hard-refresh). Vì Cloudflare chạy Full (strict), cookie `vpa_dev` có cờ `Secure` (ADR-19); site trên VPS này thiếu chứng chỉ hoặc chứng chỉ hết hạn → lỗi 526, nên certbot phải tự gia hạn được. Chi tiết vận hành: [10-van-hanh-deploy.md](10-van-hanh-deploy.md).
- **Ngày**: 2026-11-01.

---

## 7. Giao diện

### ADR-25 — Nhân vật chibi vẽ thủ tục từ `look`, 4 hướng, nhìn nghiêng bằng lật gương

- **Bối cảnh**: SPEC §0.6 cấm hình ảnh ngoài; chủ dự án đòi *"cẩn thận, trực quan, rõ ràng, đẹp — không làm cho có. Nhân vật phải đầy đủ bộ phận, nhìn ra ai là ai ngay"* (`docs/ui-polish-todo.md:3-4`); §2 (dòng 22-23) nói rõ: bản v1 chỉ ~1 ô ≈ 19 px, cần cao ~1,8–2 ô, đầu to kiểu chibi, *"mắt/miệng/tóc/phụ kiện nhìn thấy ở mức zoom mặc định"*, quay lưng vẫn nhận ra nhờ tóc/áo/phụ kiện.
- **Lựa chọn**: `public/js/render/character.js` vẽ hoàn toàn bằng Canvas từ `Look = { skin, hair, hairStyle (8 kiểu), shirt, pants, accessory (6 loại) }` (`src/types.ts:20-27`); hệ toạ độ cục bộ `U = 24` đơn vị/ô, cao ~1,95 ô, đầu ≈ 45% chiều cao (`character.js:1-15`); 3 bộ vẽ **down / up / side**, hướng phải = `ctx.scale(-1, 1)` của hướng trái (`:774`); nhận ra từ sau lưng nhờ kiểu tóc + áo + phụ kiện; `portrait()` tái dùng cùng hàm cho avatar thẻ nhân sự (`:954-969`). Bảng màu cache theo khoá `look` (≤ 200).
- **Lý do**: không tài nguyên ảnh → mọi ứng viên AI sinh ra (màu/kiểu từ `LOOK_POOL`) đều vẽ được ngay; lật gương giảm nửa khối lượng vẽ nghiêng. Memo *feedback-ui-quality*: "the visual is the product".
- **Hệ quả / ràng buộc**: thêm `hairStyle`/`accessory` = sửa union trong `types.ts` **và** painter cho cả 3 hướng trong `character.js` **và** `HAIR_STYLES/ACCESSORIES` trong `schemas.ts` + `LOOK_POOL`. Chữ "z" khi ngủ và phụ kiện lệch tâm phải xử lý riêng khi lật gương (`:938` bỏ lật cho chữ). Không có test tự động — kiểm bằng ảnh `docs/preview/`.
- **Ngày**: 2026-11-01 (v1 vẽ thủ tục; v2 to lên ~1,95 ô + nhìn nghiêng).

### ADR-26 — WC thành cửa đóng (người vào = ẩn); phòng cũ thành phòng trưng bày; mọi link qua `/go/:id?src=`

- **Bối cảnh**: v1 có phòng WC vẽ bồn cầu/bồn rửa chiếm góc đẹp nhất bản đồ; chủ dự án cần chỗ **bày sản phẩm Shopee** (nguồn thu) và thấy WC lộ liễu không hợp sitcom.
- **Lựa chọn** (`docs/v2-contract.md` §1–2, hiện thực ở `src/sim/map.ts:1-6,29-30,159-161`): phòng WC cũ (x1..8, y1..6) → `showroom` với `shelf_beauty`/`shelf_tech` + `display_table`; WC mới (x19..22, y1..6) là phòng **kín**: bên trong + 2 ô cửa (20,7),(21,7) **không đi được**; nhân viên đứng ở `SPOTS.toilet` rồi `hidden = true` (`onReached`, `src/sim/world.ts:1427`) → `FrameAgent` flag 8, client không vẽ, cửa hiện "Có người"/"Trống" (`drawWcIndicator`, `public/js/render/office.js:800-813`); `sanitize()` tự lộ người ra khi không còn đúng điều kiện (`:2874`) nên không bao giờ "kẹt ẩn". Sản phẩm: `data/products.json` → `products.ts` chuẩn hoá (`category → shelf`, `slot`), `toPublic()` **luôn** trả `url = /go/<id>?src=<src>` (`src/content/products.ts:211-219`) — client không bao giờ thấy link Shopee thật; `GET /go/:id` chỉ chuyển tới url trong danh mục (không open redirect), HEAD không tính click, `X-Robots-Tag: noindex` (`src/server.ts:329-349`); `recordClick` đếm theo sản phẩm × nguồn (`showroom/sidebar/scene/desk`) với trần 500 × 16 (`src/sim/world.ts:987-1003`).
- **Lý do**: showroom tạo cảnh `showroom_chat` tự nhiên ("khoe đồ") và chip sản phẩm có ngữ cảnh; WC "cửa đóng" vừa kín đáo vừa là chi tiết hài ("trốn vào WC lướt điện thoại", `LABELS.toiletHide`). Đếm click ở server để `/api/stats` (chỉ admin) đo hiệu quả từng chỗ đặt link.
- **Hệ quả / ràng buộc**: `hello.products` và `deskItem` cache **một lần/tiến trình** (`showroomProducts`, `src/sim/world.ts:2809-2819`) → đổi `data/products.json` phải khởi động lại. Không đổi `id` sản phẩm đã có (thống kê click + `deskItemProductId` của roster). Chỗ đứng `toilet` chỉ 2 ô → tối đa 2 người "trong WC". Trang trí sàn/tường phía client hard-code cho bản đồ 60×34 — đổi `map.ts` phải sửa `floor.js`.
- **Ngày**: 2026-11-01 (v2).

### ADR-27 — Bỏ thanh trên cùng; HUD mỏng nổi trên canvas + thông tin "trong thế giới"

- **Bối cảnh**: thanh trên v1 (SPEC §8) chiếm chỗ, chứa cả chip AI/sếp/doanh thu; chủ dự án muốn khung văn phòng lớn, thông tin **diegetic** (`docs/ui-polish-todo.md` §1).
- **Lựa chọn**: HUD mỏng ở góc canvas (đồng hồ + tiến độ ngày; icon xổ chi tiết), đồng hồ treo tường chạy theo giờ game, bảng trắng phòng họp ghi dự án/%/hạn, bảng KPI + doanh thu trên tường, biển "ĐI VẮNG" trên cửa phòng sếp, tên công ty thành logo mờ trên sàn (`public/js/ui/hud.js`, `public/js/render/office.js`, `floor.js`); chip AI chỉ còn cho admin (ADR-18); sidebar co giãn.
- **Lý do**: *"Thanh trên hiện chiếm quá nhiều chỗ"*; thông tin trong thế giới không cần chữ ngoài khung.
- **Hệ quả / ràng buộc**: canvas phải né vùng HUD/ticker (`office.setInsets`) khi đặt bong bóng — toast ở DOM **không** nằm trong insets nên đôi khi đè bong bóng (việc mở). SPEC §8 (dòng ~840–848) còn mô tả thanh trên + chip "🤖 GPT" — **lỗi thời**. `docs/v2-contract.md` §6 (dòng 98-100) đã ghi "No top bar" (khớp ADR này); §4 (dòng 72-84) tả chip AI (`UsageStats`, *"never 'GPT' unless the provider is OpenAI"*) như UI **công khai** — nay chip đó chỉ admin thấy (ADR-18).
- **Ngày**: 2026-11-01 (v2).

### ADR-28 — Ảnh chia sẻ link là ngoại lệ duy nhất của "không ảnh"; URL tuyệt đối do server điền

- **Bối cảnh**: dán link site lên Facebook / Zalo chỉ ra link trơn vì trang không có thẻ Open Graph; chủ dự án sắp quảng bá trên Facebook và yêu cầu "thêm các meta data vào thật đầy đủ" (2026-11-03). Thẻ `og:image` / `og:url` / canonical **bắt buộc là URL tuyệt đối**, nhưng repo công khai và ai cũng có thể chạy ở tên miền khác.
- **Lựa chọn**: (1) đủ bộ SEO + Open Graph + Twitter + JSON-LD + icon PNG + `site.webmanifest` + `robots.txt` (chặn `/go/` để bot không làm phồng số bấm link, chặn `/api/`); (2) URL tuyệt đối viết bằng `%SITE_URL%`, server điền theo từng request: `SITE_URL` nếu đặt, không thì `Host` (lọc `[a-z0-9.-:]`, lạ → localhost) + https nếu `X-Forwarded-Proto` / `CF-Visitor` / socket TLS báo https; (3) `og:image?v=%OG_VERSION%` = băm nội dung ảnh; (4) ảnh + icon tạo bằng script CDP trong repo, icon vẽ bằng SVG tự viết (không dùng emoji hệ điều hành).
- **Lý do**: giữ một `index.html` chạy đúng ở mọi tên miền mà không bắt người deploy sửa tay; Host bị lọc nên không chèn được HTML; băm ảnh giúp mạng xã hội chỉ tải lại khi ảnh thật sự đổi; ảnh chỉ phục vụ chia sẻ nên không phá nguyên tắc "giao diện vẽ bằng canvas, 0 ảnh" (ADR-03, [07](07-frontend-ve-canvas.md)).
- **Hệ quả / ràng buộc**: chữ trong thẻ là chuỗi cứng (không theo `COMPANY_NAME`); mở `index.html` không qua server thấy nguyên `%SITE_URL%`; đổi giao diện nhiều thì nên chạy lại `npm run share-images` và "Scrape Again" trên Facebook Sharing Debugger ([10](10-van-hanh-deploy.md) §7.6); `public/` có 4 file ảnh (~250 KB) đi theo rsync.
- **Ngày**: 2026-11-03.
- **Bằng chứng**: `public/index.html` (`<head>`), `src/server.ts` `requestIsHttps`, `siteOrigin`, `OG_VERSION`, `sendIndexHtml`; `src/config.ts` `siteUrlOf`; `scripts/share-images.ts`; `public/robots.txt`, `public/site.webmanifest`.

### ADR-29 — Lớp phủ trên bản đồ co theo cỡ bản đồ; HUD co theo chỗ trống thật

- **Bối cảnh**: chủ dự án báo (2026-11-03) "icon tên phòng bị mất" và "trên mobile và 1 số màn hình khi zoom, chữ bị quá to so với screen, bố cục không hợp lý". Đo bằng ảnh chụp giả lập: bong bóng, emote, biển "ĐI VẮNG", nhãn phòng giữ cỡ px của màn lớn trong khi bản đồ chỉ còn 5–13 px/ô (điện thoại xoay ngang, tablet, desktop phóng to 150–200 %) → che kín bản đồ; HUD tràn khỏi màn 360–430 px; nhãn phòng nướng vào layer theo đơn vị ô nên phình khi phóng to; emoji cỡ chữ < ~0,4 trong hệ ô không hiện trên Chrome.
- **Lựa chọn**: một hệ số `uiK = uiScale()` (1 khi ≥ 17 px/ô; co tới sàn 0,68–0,82 tuỳ `dpr` / cảm ứng; điện thoại = 1 vì bản đồ đã phóng sẵn) áp cho bong bóng (vẽ qua `ctx.scale`), emote, biển, nhãn phòng; nhãn phòng chuyển ra vẽ mỗi khung theo px màn hình (≤ 13 px, ẩn khi < 7 px/ô); khung thấp (`fitT < 10`) mặc định phóng tới ~12,5 px/ô; điện thoại xoay ngang đưa bảng tin sang phải; HUD co 6 nấc theo đo tràn thật (`fitHud`) thay cho media query theo bề rộng cửa sổ; mọi emoji theo đơn vị ô qua `drawEmoji` (font 16 px + scale).
- **Lý do**: breakpoint theo bề rộng **cửa sổ** không biết bản đồ đang bị thu nhỏ bao nhiêu (sidebar, tỉ lệ khung, phóng to trình duyệt); đo trực tiếp `T` và độ tràn cho kết quả đúng ở mọi tổ hợp; một hệ số chung giữ tỉ lệ giữa các lớp phủ.
- **Hệ quả / ràng buộc**: ngưỡng mới chỉnh trên ảnh giả lập — cần kiểm trên máy thật ([07](07-frontend-ve-canvas.md) Câu hỏi còn mở 21); thêm chip HUD mới phải xếp vào thứ tự co ([08](08-frontend-giao-dien.md) §4.6); thêm emoji theo đơn vị ô phải dùng `drawEmoji`.
- **Ngày**: 2026-11-03.
- **Bằng chứng**: `public/js/render/office.js` `uiScale`, `defaultView`, `drawOverlays`; `floor.js` `drawRoomLabels`; `bubbles.js` `drawBubbles(…, scale)`; `draw.js` `drawEmoji`; `public/js/ui/hud.js` `fitHud`; `public/style.css` `.hud-fit-*`, media query xoay ngang.

### ADR-30 — Sản phẩm chỉ vào thoại khi có cớ trong câu chuyện; giá chỉ nói bằng cảm nhận

- **Bối cảnh**: chủ dự án đưa danh mục **chính thức 26 món** (bỏ 18 món demo) và yêu cầu (2026-11-03): nói về sản phẩm "đừng gắt quá, phải tự nhiên, hài hước, có câu chuyện", có thể "bắt buộc nhân viên mua hoặc giới thiệu", có cớ "đã mua và giới thiệu cho nhau vì bất ngờ quá tốt, giá hợp lý / rẻ / bất ngờ", nhiều tình huống do AI tạo để đỡ lặp.
- **Lựa chọn**: Director chỉ gắn sản phẩm khi có **lý do** (trùng ngữ cảnh/tag, đang có "vụ mua sắm" — chủ đề công ty như Secret Santa, thi bàn đẹp, tuần sống khoẻ…, hoặc người nói đã sở hữu món đó); mỗi lần gắn kèm **một góc chuyện** (đã mua thấy ngon bất ngờ, mua chung, mượn luôn không trả, giấu vợ mua…) xoay vòng chống lặp; sau câu nhắc có thể có shipper giao hàng → cảnh khui hàng, cuối chủ đề có trao quà; AI biên kịch có beat `shopping_story`. Giá: prompt chỉ đưa **cảm nhận** (rẻ / vừa / đáng tiền) từ `priceHint`, sanitize bỏ câu có con số giá (`PRICE_RE`); cấm link, "mua ngay", giọng quảng cáo, công dụng bịa (`avoid` của từng món).
- **Lý do**: quảng cáo lộ liễu làm hỏng chất sitcom và mất lòng tin người xem; con số giá đổi theo voucher nên dễ sai; cớ + góc chuyện cho AI chất liệu mới mỗi lần thay vì một câu mẫu lặp lại; vẫn ≤ 1 câu nhắc sản phẩm / cảnh và chip link dưới câu thoại như cũ.
- **Hệ quả / ràng buộc**: tần suất (xác suất gắn, ≤ 3 lần giao hàng/ngày, trọng số góc chuyện) mới chỉnh bằng mô phỏng offline — cần xem lại khi có thoại AI thật; thêm sản phẩm phải điền `short`/`facts`/`avoid`/`hooks` cho AI có chất liệu ([09](09-cau-hinh-du-lieu.md) §5); chi tiết cơ chế ở [04](04-dao-dien-cau-chuyen-nhan-su.md) §11 và [05](05-lop-ai.md). **Lời nói phải khớp sổ đồ** (rà soát vòng 3): chỉ người đã có món (chế độ `owner`, quà, khui hộp) mới kể đã dùng; còn lại chỉ "đang tính / để ý / nghe kể" vì sau cảnh người đó có thể chốt đơn thật. **Ngân sách token**: khối món cần ~290 token nên cảnh có món được cộng 150 token ngân sách (`PRODUCT_TOKEN_ALLOWANCE`) — **không** dời luật sản phẩm vào system prompt, vì như vậy mọi cảnh (đa số không có món) đều tốn thêm mỗi lần gọi.
- **Ngày**: 2026-11-03.
- **Bằng chứng**: `src/content/shopping.ts` (`SHOPPING_THEMES`, `PRODUCT_ANGLES`), `src/sim/director.ts` (`offerProduct`, `chooseProduct`, `makeOffer`, `deliver`, `startTheme`, `endTheme`), `src/sim/story.ts` (`shopping_story`), `src/ai/prompts.ts` (khối sản phẩm theo `mode`), `src/ai/sanitize.ts` (`PRICE_RE`), `data/products.json`.

### ADR-31 — Tình huống công ty: AI chốt cách xử lý, code quyết hậu quả

- **Bối cảnh**: chủ dự án hỏi (2026-11-03) vì sao chưa có "tình huống thực tế của 1 công ty": thiếu tiền / kẹt dòng tiền, khủng hoảng kinh tế, khủng hoảng truyền thông, drama xấu và tốt về công ty, chuyện cá nhân ảnh hưởng công việc, nhân viên chia bè kết phái, chống đối, sếp làm công tác tư tưởng, cách lead và sếp xử lý — và muốn "cho AI quản lí và dàn xếp… giống 1 sếp AI quản lí 1 đám AI khác", nhưng vẫn chú ý hạn mức (đang dùng bản miễn phí).
- **Lựa chọn**: 10 tình huống dạng dữ liệu (`SITUATIONS`), mỗi cái là một mạch 4 bước của AI biên kịch: bùng phát → cảnh `crisis_meeting` (sếp, vắng thì HR, + lead theo vai; người trong cuộc chỉ vào khi tình huống cần) — **AI chọn 1 trong 3–4 phương án** code đưa ra (mã `plan_a..d` vào `verdict`) → triển khai theo kiểu của phương án (thông báo nhóm công ty, `pep_talk` truyền lửa / nói riêng / hoà giải — AI quyết `inspired | unmoved`, giao việc sales, tăng ca, siết kỷ luật, khao, xử lý lặng lẽ) → kết cục do **code tung xác suất** (`plan.odds` ± truyền lửa ± mức độ) rồi AI viết thoại. AI trả mã sai / không có AI → phương án dự phòng chọn sẵn theo trọng số (offline viết thoại khớp đúng nó); không chốt được → "chốt nhanh qua điện thoại" — nhưng chỉ **sau khi** cuộc họp của mạch đã xong / hết cửa sổ (Director giữ mạch suốt lúc cuộc họp còn chờ hoặc đang diễn, rồi chờ thêm 30 phút; rà soát vòng 3 — trước đó là ngưỡng 180 phút tính cả lúc họp).
- **Lý do**: giữ nguyên tắc 2 (AI quyết chuyện, code làm hàng rào — giống HR ở ADR-15): AI có quyền chọn hướng xử lý thật sự khác nhau, nhưng không thể tự cho mọi thứ "kết thúc có hậu" (model hay chọn kết cục đẹp) và không thể tạo hiệu ứng ngoài danh sách; tình huống mới chỉ là dữ liệu nên thêm dễ; quota: không thêm lời gọi AI ngoài `reserve()` — cảnh họp / truyền lửa thay chỗ cảnh thường trong cùng nhịp gọi, thực đơn AI biên kịch chỉ kèm ≤ 3 loại tình huống hợp tình hình mỗi lần (đỡ ~300 token/lần gọi so với đưa cả 10), mỗi lúc chỉ một tình huống mở.
- **Hệ quả / ràng buộc**: KPI trong hiệu ứng phải nhỏ và chỉ cho người trong cuộc (cộng KPI cả nhóm sales từng làm `smoke:story` báo lệch "% KPI theo người"); kết cục xấu có thể dẫn tới `resign_check` hoặc `hr_review` — vẫn đi qua hàng rào nhân sự cũ; tần suất (≈ 0,6 tình huống / ngày game trong mô phỏng offline) và tỉ lệ thành công mới chỉnh bằng mô phỏng, cần xem lại với thoại AI thật ([04](04-dao-dien-cau-chuyen-nhan-su.md) §16).
- **Ngày**: 2026-11-03.
- **Bằng chứng**: `src/content/situations.ts`; `src/sim/story.ts` (`situationActions`, `situationMenu`, `pickPlan`, `postpone`, `canonArc`); `src/sim/director.ts` (`dCrisisMeeting`, `dPepTalk`, `afterCrisisMeeting`, `afterPepTalk`); `src/ai/prompts.ts` (khối PHƯƠNG ÁN, `verdictReq`); `src/ai/sanitize.ts` (`VERDICT_BY_TYPE`); `scripts/smoke-story.ts`, `scripts/test-llm.ts` §12b.

---

## 8. Cách ghi một ADR mới

Khi đưa ra quyết định cùng tầm (đổi provider, đổi cách phát cảnh, nới hàng rào, đổi cơ chế cache/bảo mật, đổi định dạng lưu), thêm một mục `ADR-NN` vào bảng tóm tắt và phần tương ứng với đủ 6 trường: **Bối cảnh → Lựa chọn → Lý do → Hệ quả / ràng buộc → Ngày → Bằng chứng (file:dòng)**. Quyết định bị thay thế **không xoá**, đổi trạng thái thành "Đã thay thế bởi ADR-MM" (ví dụ luật HR cứng v1 → ADR-15). Quy ước chung xem [14-quy-uoc-dong-gop.md](14-quy-uoc-dong-gop.md).

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … | chạy test |
|---|---|---|
| Thêm/bớt provider, đổi model mặc định, đổi `RPM/RPD/TPD/MAX_*_TOKENS/WEIGHT` trong `.env.example` | ADR-06/08/10/11/12 (bảng nguồn đã thử), [05-lop-ai.md](05-lop-ai.md), [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md), `README.md` §3 | `npm run test:router`, `npm run test:llm` |
| `paceBlock`/`balancedOrder`/`order` hoặc `ROUTER_POLICY` (`src/ai/router.ts`) | ADR-08/09, `README.md` §3.5, SPEC §6.2 | `npm run test:router` (mục pace/balanced) |
| `parseExtraBody`, `params()` của `llm.ts`, `adaptTo400` | ADR-11/13 | `npm run test:router` (EXTRA_JSON, 400 → json_object) |
| `DEADLINE_MS`/`MAX_TOKENS` (`brain.ts`) hoặc `RESULT_TIMEOUT_MS`/`MAX_PLAY_MS` (`director.ts`) hoặc `SCENE_WATCHDOG_MS` (`world.ts`) | ADR-02 (giữ bất đẳng thức 27 s < 35 s, 180 s < 5 phút) | `npm run smoke`, `npm run test:llm` |
| Cách phát dòng thoại (`playLine`, `bubble.durationMs`) hoặc nhịp `FRAME_MS`/`ts` | ADR-02, ADR-20 (cân lại `NET_BUFFER_*`), [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md), [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md) | đo lại độ mượt trên prod qua `window.__vpa` |
| `randomizeOpeningTraits`, `OPENING_*_BAND`, `roleKpiFactor`, `driftTrait` | ADR-14, SPEC §2/§10.4 (đang lệch), `README.md` §6.1 (hệ số ngày đang lệch: 0,55 ↔ 0,75) | `npm run smoke:story` (không ai bị "đánh dấu") |
| `allowedActions`, `validateDecisions`, `MAX_DECISIONS`, `sanitizeHrDecisions`, `applyDecision` | ADR-15, bảng `README.md` §6.2, SPEC §5.6, [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) | `npm run smoke:story` (hàng rào độc lập), `npm run test:llm` (hr_review) |
| `BEAT_MENU`/`BEAT_CAST`/`actionsFor` | ADR-16 | `npm run smoke:story` (≥ 3 beat, ≥ 1 mạch kết) |
| `BLOCKLIST`/`PERSON_CONDUCT`/`SHOWBIZ_ALLOW`/`matchKeyword`, `NEWS_BLOCK_PHRASES`, `NEWS_RULES*`, `NEWS_BLOCK_RE`, `JUDGEMENT_RE` | ADR-17, [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md), `docs/v3-news.md` | `npm run test:news`, `npm run test:llm` (news_chat) |
| `publicStatus`, `broadcast`, `hello.dev`, route `/api/*` mới | ADR-18 (mọi đường phát mới phải lọc), [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md) | hiện **chưa có test HTTP/WS** — kiểm tay bằng 1 socket thường + 1 socket dev |
| `devAllowed`, `handleDevCookie`, `net.js` (`DEV_KEY`, `syncCookie`, `forgetDevToken`), tên cookie/localStorage | ADR-19, `README.md` §8, `deploy/nginx.site.conf` | kiểm tay: vào bằng `#dev=`, tắt trình duyệt, mở lại; bấm 🚪 |
| `computeAssetVersion`, `sendIndexHtml`, `ASSET_PREFIX_RE`, `handleStatic` cache headers | ADR-21, [10-van-hanh-deploy.md](10-van-hanh-deploy.md) | `curl -I` `/` và `/v/<ver>/js/main.js` sau deploy |
| `deploy/nginx.*`, `deploy.sh`, cổng/pm2/user | ADR-22/24, [10-van-hanh-deploy.md](10-van-hanh-deploy.md) | `bash deploy/deploy.sh` rồi `/api/health` |
| `Archive.defaults()`, định dạng dòng JSONL, `HISTORY_READ_MAX`, `HISTORY_MAX_INFLIGHT` | ADR-22/23, [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md) | `npm run smoke` (archive ghi/đọc/xoay) |
| `STATE_VERSION`, shape `StateFile`, thứ tự `load()` | ADR-05 (cân nhắc kỹ trước khi tăng version) | `npm run smoke` (serialize → restore) |
| `Look` union, `character.js` painter, `LOOK_POOL`, `HAIR_STYLES/ACCESSORIES` | ADR-25, [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md) | chụp lại `docs/preview/` |
| `map.ts` (WC, showroom, bàn), `products.ts`, `/go/`, `recordClick` | ADR-26, `docs/v2-contract.md`, [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md) | `npm run smoke` (mọi chỗ tới được, `hello.products`, click) |
| Bất kỳ quyết định mới cùng tầm | thêm `ADR-NN` theo mục 8 của tài liệu này; cập nhật bảng tóm tắt | — |

## Câu hỏi còn mở / cần kiểm tra

1. **Ngày của ADR-08/11**: memo kỹ thuật ghi pace/balanced/Cloudflare làm ngày 2026-11-01 (tối), chủ dự án xếp vào mốc 2026-11-02 — tài liệu ghi cả hai; không có commit để phân xử (git chỉ đã có lịch sử commit (đẩy lên github.com/Hao2505/office-ai) ngày 2026-11-02).
2. **Z.ai / OpenRouter / SambaNova / GitHub Models / Cerebras** (ADR-12) chỉ có trong memo chủ dự án, **không có dấu vết trong repo** — nên ghi vào `README.md` §3 một dòng "đã thử và loại" để người sau không thử lại.
3. **Giờ reset neuron của Cloudflare (7h VN)** chưa được mô hình hoá trong `QUOTA_RESET_TZ` → bộ đếm ngày của Cloudflare theo giờ VN (0h) lệch 7 giờ với mốc thật; cần đo xem có gây "giữ nhịp" sai không.
4. **Biên kẹp hiệu ứng offline (±8/±10) chặt hơn sanitize LLM (±15/±25)** — cố ý hay vô tình? (ADR-04).
5. **Hai `estimateTokens` khác hệ số** (3,5 ở `llm.ts`, 2,7 ở `prompt-budget.ts`) — cân nhắc hợp nhất hoặc đổi tên (ADR-07). `SYSTEM_TOKEN_TARGET` không được dùng ở đâu.
6. **SPEC §2/§10.4 mô tả `randomizeOpeningTraits` cũ** (chỉ kéo người cực đoan) khác code (dải chung cho mọi nhân viên) — cần sửa SPEC theo ADR-14.
7. **`#dev=` rỗng không xoá cookie** (ADR-19) — sửa code (gọi `/api/dev/logout` khi token rỗng) hay chỉ sửa chú thích `net.js:2-3`?
8. **`/api/news` công khai trả `lastError`, `refreshes`, số feed; `/api/history` (không `date`) công khai trả `enabled` + `stats` (`src/server.ts:296-300`)** — đều là "thông tin hệ thống" theo nguyên tắc (4); cân nhắc chặn bằng `devAllowed()` hoặc bỏ các trường trạng thái khỏi bản công khai (ADR-18).
9. **Archive nhận vài dòng "ngày 1" giả mỗi lần khởi động lại có state** — đã xác nhận bằng đường gọi trong code (ADR-23: `server.ts:244-252` → `World` constructor → `freshInit()` → `planDay()` → `log()` → `archiveRecord()`); chưa quyết cách sửa: trì hoãn `archive.start()` tới sau `load()` hay để `freshInit()` im lặng khi `PERSIST=true` và `data/state.json` tồn tại. Có thể đối chứng thêm bằng `data/history/<hôm nay>.jsonl` sau một lần restart (chỉ xem, không chép nội dung).
10. **`balancedOrder` áp cho mọi task** (kể cả candidate/recap) trong khi README §3.5 nói "cảnh thường" — thống nhất mô tả hoặc giới hạn trong code (ADR-08).
11. **Không có test tự động cho HTTP/WebSocket** (redaction, cookie, `/v/`, `/go/`, rate limit dev) và cho `public/js` — ADR-18/19/20/21 chỉ được kiểm tay; đề xuất một script khởi động server trên cổng ngẫu nhiên + 1 socket thường/1 socket dev.
12. **Toast đè bong bóng thoại** (ADR-27): canvas chỉ né HUD/ticker qua `setInsets`, chưa biết vùng toast.
13. **Nút dev 🗞️ bắn 2 cảnh `news_chat` liền nhau** (báo cáo chủ dự án) — chưa xác định đường gây lặp (mục force + mục thường tới lượt cùng lúc, hay tin len vào pantry/lunch ngay sau).
14. **4 sản phẩm thật còn là chỗ trống** trong `docs/real-products.json`; `README.md` §5.1 và `docs/v2-contract.md` còn ghi số món cũ (16 / 5+5) trong khi `data/products.json` có 18 món.
15. **`open_position` chưa bao giờ xảy ra** — không chỉ vì bản đồ đúng 10 bàn: `detectVacancies` (`src/sim/hr.ts:503-518`, gọi ở `director.ts:4089`) tự mở vị trí thay thế cho vai trống nên `freeDesks` luôn rỗng (ADR-15). Muốn có "mở vị trí mới" phải thêm bàn **và** quyết định vị trí mới là vai gì (`extra`) — có định làm không?
16. **`tsx watch` có theo dõi `public/` không** (ảnh hưởng ADR-21 khi dev) — cần kiểm tra thực tế.
17. **Tên model Groq dự phòng không khớp giữa hai nguồn hướng dẫn** (ADR-10/12): README §3.2 (`README.md:101`) và memo chủ dự án ghi `qwen/qwen3.8-27b`, `.env.example:32` ghi `llama-3.3-70b-versatile · qwen/qwen3-32b` — cần tra model id thật trên console Groq rồi thống nhất hai file; `llama-3.3-70b-versatile` chưa có đánh giá nào trong repo. — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
18. ~~Chế độ SSL của Cloudflare hiện tại (Flexible hay Full)~~ — **đã rõ 2026-11-03: Full**, sau đó chủ dự án chuyển **Full (strict)**; cookie `vpa_dev` có `Secure` (ADR-19/24 đã sửa).
