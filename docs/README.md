# Bộ tài liệu kỹ thuật — Văn Phòng Ảo (Cty TNHH VibeCorp)

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: thư mục `docs/` (14 tài liệu `01…14`, các tài liệu thiết kế cũ, `real-products.json`, `preview/`) và các tài liệu ở gốc dự án (`README.md`, `SPEC.md`, `src/types.ts`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`) · Đọc khi: lần đầu vào dự án và chưa biết đọc gì trước; cần tìm tài liệu mô tả vùng code sắp sửa; sắp thêm / đổi tên / xoá một tài liệu; cần biết tài liệu nào còn hiện hành, tài liệu nào chỉ là lịch sử.

Tài liệu này là **mục lục** của bộ tài liệu kỹ thuật: mỗi tài liệu trả lời câu hỏi gì, đọc khi nào, đọc theo thứ tự nào tuỳ vai trò, và **sửa file nào trong mã nguồn thì phải cập nhật tài liệu nào**. Nó không chép lại nội dung — chi tiết nằm ở tài liệu được trỏ tới. Người đọc: lập trình viên mới và agent AI tiếp tục phát triển dự án. Quy tắc bắt buộc "sửa code phải sửa docs" nằm ở [`../CLAUDE.md`](../CLAUDE.md) (bản cho công cụ khác: [`../AGENTS.md`](../AGENTS.md)) và chi tiết ở [14-quy-uoc-dong-gop.md](14-quy-uoc-dong-gop.md) §4; lịch sử thay đổi ở [`../CHANGELOG.md`](../CHANGELOG.md).

**Không có bí mật nào trong bộ tài liệu**: chỉ nhắc *tên* biến môi trường (lấy từ `src/config.ts` và `.env.example`); không bao giờ chép nội dung `.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json`.

---

## 1. Cách bộ tài liệu được tổ chức

| Điều cần biết | Nội dung |
|---|---|
| **Thứ tự nguồn sự thật** khi hai nơi lệch nhau | code → `src/types.ts` (hợp đồng kiểu) → `docs/NN-*.md` (tài liệu hiện hành, đối chiếu code ngày 2026-11-02) → `SPEC.md` (hợp đồng thiết kế gốc, một phần lỗi thời) → `README.md` (hướng dẫn chủ dự án). Quy tắc R4 ở [14](14-quy-uoc-dong-gop.md) §4.1 |
| **Khuôn mẫu một tài liệu** `docs/NN-ten.md` | tiêu đề → dòng `> Cập nhật lần cuối · Phạm vi · Đọc khi` → mở đầu 3–6 dòng → thân bài đánh số → **hai mục bắt buộc cuối**: "Khi sửa code vùng này" (bảng: đổi gì → cập nhật gì → chạy test gì) và "Câu hỏi còn mở / cần kiểm tra" (sổ nợ). Mẫu đầy đủ: [14](14-quy-uoc-dong-gop.md) §4.2 |
| **Tham chiếu code** | dạng `src/sim/world.ts:1118` = số dòng tại thời điểm viết (2026-11-02); code đổi là số trôi — tìm theo **tên hàm/biến** nếu lệch. Tên file/hàm/biến giữ tiếng Anh, văn bản tiếng Việt. Riêng `SPEC.md:NNN` và `README.md:NNN` trong `docs/01…14` lệch **+2** / **+10** dòng kể từ 2026-11-02 (khung ghi chú chèn đầu `SPEC.md`; mục "Tài liệu kỹ thuật" chèn trước mục 1 của `README.md`) — tìm theo tiêu đề mục |
| **Số liệu** | mọi con số lấy từ code hoặc đo thật và ghi nguồn; chỗ chưa chắc ghi "(cần kiểm tra)" |
| **Đối chiếu tài liệu cũ** | mỗi tài liệu vùng có mục liệt kê chỗ `SPEC.md`/`README.md`/docs cũ lệch code (ví dụ [05](05-lop-ai.md) §15, [06](06-tin-tuc-thoi-su.md) §14, [07](07-frontend-ve-canvas.md) §12, [08](08-frontend-giao-dien.md) §21); danh sách gom ở [13](13-viec-con-lai-va-y-tuong.md) §1.2 |

---

## 2. Mục lục 14 tài liệu

| # | Tài liệu | Trả lời câu hỏi gì | Phạm vi code | Đọc khi |
|---|---|---|---|---|
| 01 | [Tổng quan dự án](01-tong-quan.md) | Sản phẩm là gì, người xem thấy gì, tiền từ đâu (link Shopee qua `/go/:id?src=`), 5 nguyên tắc của chủ dự án nằm ở dòng code nào, kiến trúc "thân xác 0 token / bộ não AI viết cả cảnh". Kèm bản đồ thư mục, lịch sử v1→v3→2026-11-02, bảng thuật ngữ và lộ trình đọc theo vai trò. | toàn dự án | lần đầu vào; cần định vị một tính năng; cần hiểu "vì sao" trước khi sửa |
| 02 | [Kiến trúc & giao thức](02-kien-truc-va-giao-thuc.md) | Dữ liệu chạy từ đâu tới đâu theo nhịp nào: khởi động/tắt, tick 100 ms, luồng một cảnh Director → Brain → Router → sanitize → client, bảng `ServerMsg`/`ClientMsg`, HTTP API, `/v/<ASSET_VERSION>/`, quyền admin `DEV_TOKEN`, bộ đệm chống giật. `src/types.ts` là nguồn sự thật và cách thêm trường an toàn. | `src/server.ts`, `src/types.ts`, vòng lặp `world.ts`, vòng đời cảnh `director.ts`, `net.js`/`store.js` | thêm/sửa thông điệp WS hay route HTTP; thêm trường vào `types.ts`; debug giật / mất kết nối / không thấy bảng dev / lộ số liệu hệ thống |
| 03 | [Mô phỏng thế giới (World)](03-mo-phong-the-gioi.md) | World làm gì mỗi tick và giữ trạng thái gì: hai chế độ thời gian, bản đồ 60×34, `AgentState`/`Rt`, di chuyển BFS, chọn việc theo trọng số, công thức KPI, lịch ngày, tính cách v3, sếp & bắt quả tang, WC ẩn. Thứ gì sống/chết qua một lần khởi động lại (`state.json`, archive JSONL). | `src/sim/world.ts`, `behavior.ts`, `map.ts`, `clock.ts`, `persist.ts`, `showroom.ts`, `archive.ts` | sửa đồng hồ / di chuyển / lịch / KPI / tính cách / sếp / sự cố / dự án; sửa lưu–khôi phục; Director/HR/AI cần gọi vào World |
| 04 | [Đạo diễn, cảnh, câu chuyện & nhân sự](04-dao-dien-cau-chuyen-nhan-su.md) | Director quyết chuyện gì xảy ra lúc nào với ai: registry 24 loại cảnh, nhịp `reserve`/`llmGated`, lịch ngày – hàng đợi – cảnh tự phát, vòng đời cảnh, nhắc sản phẩm, `news_chat`, HR v3 (AI quyết, code làm 3 lớp hàng rào), AI biên kịch, tin đồn, bản tin. Kèm công thức thêm một loại cảnh. | `src/sim/director.ts`, `scenes.ts`, `hr.ts`, `story.ts`, `rumors.ts`, phần kịch bản của `catalog.ts` | vì sao một cảnh xuất hiện/không; thêm loại cảnh; sửa luật HR / biên kịch / tin đồn / bản tin; debug kẹt cảnh, quyết định HR biến mất, `news_chat` bắn 2 lần |
| 05 | [Lớp AI](05-lop-ai.md) | AI được gọi khi nào, gọi provider nào theo luật gì (pace, balanced, cooldown, failover trong cùng request), gửi gì (system prompt tĩnh, prompt theo bậc, 4 schema), nhận về kiểm thế nào (sanitize), không gọi được thì thoại ở đâu ra (offline/emergency). Kèm chi phí/token, recipe thêm provider và cách probe model. | `src/ai/*`, phần AI của `src/config.ts` | thêm/đổi provider; sửa prompt/schema/sanitize; cảnh rơi về thoại mẫu; tối ưu token; đọc log `[ai]` |
| 06 | [Thời sự từ RSS & an toàn pháp lý](06-tin-tuc-thoi-su.md) | Tin thật đi từ RSS tới câu thoại qua 5 lớp nào, mỗi lớp chặn gì và vì sao (ranh giới pháp lý không được vượt), cấu hình `NEWS_*`, kho tin, nhịp `news_chat`, luật tin thật trong prompt và sanitizer, thẻ tin + dòng miễn trừ. Kèm quy trình bắt buộc khi thêm nguồn hay nới bộ lọc. | `src/news/*`, phần tin của `catalog.ts`/`director.ts`/`scenes.ts`/`prompts.ts`/`sanitize.ts`/`offline.ts`, `public/js/ui/news.js` | thêm/bỏ feed; chỉnh từ khoá chặn; đổi nhịp thời sự; sửa thẻ tin; có tin "không nên bàn" lọt ra màn hình |
| 07 | [Frontend: canvas, nhân vật, store, mạng](07-frontend-ve-canvas.md) | Trình duyệt khởi động theo thứ tự nào, `net.js` nối/nối lại/mã admin, `store.js` và bộ đệm chống giật, `render/office.js` vẽ từng lớp theo thứ tự gì, nhân vật chibi dựng từ `look`, các module vẽ còn lại. Kèm cách thêm nội thất/phòng/màn hình/hoạt động, hiệu năng và móc QA. | `public/js/main.js`, `net.js`, `store.js`, `util.js`, `labels.js`, `public/js/render/*` | sửa thứ người xem thấy trên bản đồ; debug giật / không hiện / sai chỗ; sửa kết nối; thêm nội thất/phòng/màn hình/hoạt động; hiểu `store` trước khi viết UI |
| 08 | [Frontend: HUD, sidebar, tab, bảng dev](08-frontend-giao-dien.md) | Trang dựng từ gì: khung DOM `index.html`, `style.css` (biến, z-index, breakpoint), 14 module `ui/*` (HUD, sidebar + ticker, tabs, feed gom theo thẻ cảnh, nhân sự, hồ sơ, sản phẩm, bản tin/lịch sử/tờ báo, tin đồn, bảng dev, toast, avatar), `labels.js`, a11y, mobile. Hai lớp ẩn thông tin hệ thống và bảng "muốn đổi X → sửa file nào". | `public/index.html`, `style.css`, `public/js/ui/*`, `labels.js`, `util.js` | sửa thứ người xem thấy ngoài canvas; thêm loại cảnh / nhãn / nhóm tin phía client; hiểu vì sao người xem thường không thấy số liệu hệ thống |
| 09 | [Cấu hình & dữ liệu trên đĩa](09-cau-hinh-du-lieu.md) | Bảng **mọi biến môi trường** (tên, mặc định thật trong code, kẹp, nơi đọc, ảnh hưởng) và vai trò của 4 file env. Từng file dữ liệu: `data/products.json` (18 món), `data/state.json` (shape, khôi phục, cách ly, cái gì không sống qua restart), `data/history/` (JSONL), `docs/real-products.json`; bí mật / `.gitignore` / rsync. | `src/config.ts`, `.env.example`, `data/*`, `persist.ts`, `archive.ts`, phần serialize của World/Director/Brain/NewsStore | thêm/đổi biến env; cần mặc định thật (không phải số trong README); sửa shape file trạng thái/archive; thêm sản phẩm; chuẩn bị `.env` production |
| 10 | [Vận hành & deploy](10-van-hanh-deploy.md) | Production chạy ở đâu bằng gì (Cloudflare → nginx → pm2 `vibecorp` cổng 3200, `/opt/vibecorp`), `deploy/deploy.sh` từng bước và bẫy, từng chỉ thị nginx, Cloudflare (SSL mode, cache 4 giờ, gói WS so le), lệnh vận hành, cập nhật & rollback, admin `DEV_TOKEN`, đọc chip 🤖/quota AI miễn phí. Kèm bảng sự cố thường gặp và checklist deploy. | `deploy/*`, phần vận hành của `src/server.ts`, `net.js`, `hud.js`, `devbar.js` | đưa bản mới lên site thật; site lỗi (502, giật, giao diện cũ, AI offline, hết quota); vào/thoát admin; đổi `.env` production; thêm route/nginx; dựng lại VPS |
| 11 | [Kiểm thử & QA](11-kiem-thu-qa.md) | `npm test` gồm 6 bước nào và mỗi script kiểm gì (smoke, smoke:story với hàng rào độc lập `guardOk`, test:news, test:llm với 1 mock, test:router với 2 mock), `eyeball:hr` (AI thật), `DEBUG_PROMPTS`, probe model. Kèm QA hình bằng Chrome headless/CDP, đo độ mượt qua `window.__vpa`, checklist QA giao diện, cách viết test mới. | `package.json`, `tsconfig.json`, `scripts/*.ts`, `scripts/fixtures/news/` | sắp chạy `npm test`; test đỏ; thêm test; thử model thật; vừa sửa giao diện |
| 12 | [Nhật ký quyết định thiết kế (ADR)](12-quyet-dinh-thiet-ke.md) | Vì sao code lại như vậy: 27 quyết định đã chốt (ADR-01…27) theo mẫu bối cảnh → lựa chọn → lý do → hệ quả/ràng buộc → ngày → bằng chứng `file:dòng`, gồm các nguồn AI đã thử và loại. Kèm cách ghi ADR mới. | toàn dự án | định sửa một cơ chế "không hiểu sao người trước làm thế"; định thêm provider, đổi cách phát cảnh, nới hàng rào, đụng bảo mật admin / cache tĩnh / bộ đệm |
| 13 | [Việc còn lại, lỗi đã biết & ý tưởng](13-viec-con-lai-va-y-tuong.md) | Sổ theo dõi: việc đang mở theo ưu tiên P1–P3 (4 sản phẩm thật, nút news bắn 2 cảnh, toast đè bong bóng, nhãn bóng đá, SPEC §8…), tài liệu cũ lệch code, nợ kỹ thuật theo vùng, hành vi **cố ý** dễ bị coi là lỗi. Ý tưởng phát triển kèm độ khó và nguyên tắc phải giữ. | toàn dự án | bắt đầu đợt làm việc mới; trước khi nhận yêu cầu sửa/thêm; thấy hành vi "lạ" và muốn biết đã được ghi nhận chưa |
| 14 | [Quy ước đóng góp & bảo trì tài liệu](14-quy-uoc-dong-gop.md) | Quy ước code server/client, bí mật, 5 nguyên tắc nội dung; quy trình 8 bước từ ý tưởng tới site thật; 8 recipe (thêm provider, loại cảnh, sản phẩm, phòng/nội thất, biến env, route, tab, roster). **Quy tắc bảo trì tài liệu bắt buộc** (R1–R10), định dạng `CHANGELOG.md`, bảng ánh xạ file → tài liệu → test, checklist kết thúc việc, git. | quy trình toàn dự án | sắp sửa/thêm/xoá chức năng; trước commit/deploy; agent AI vừa nhận việc; không biết "sửa file này thì cập nhật tài liệu nào" |

---

## 3. Tài liệu ở gốc dự án và tài liệu cũ — cái nào hiện hành, cái nào lịch sử

| File | Trạng thái | Dùng để làm gì / lưu ý |
|---|---|---|
| [`../README.md`](../README.md) | **Hiện hành** — hướng dẫn cho **chủ dự án** (tiếng Việt, 15 mục); một số con số lỗi thời | Chạy thử, lấy key miễn phí, tiết kiệm token, showroom, v3, bảng dev, test. Chỗ đã biết lệch code (xem [13](13-viec-con-lai-va-y-tuong.md) §1.2): §4 số token, §5.1 "16 món" (nay 18), §8 "~50 KB/ngày" (nay ≈ 0,85 MB/ngày thật), §11 deploy chung chung (quy trình thật ở [10](10-van-hanh-deploy.md)), §13 thiếu vài file. Không biến README thành tài liệu kỹ thuật — trỏ sang `docs/` |
| [`../SPEC.md`](../SPEC.md) | **Hợp đồng thiết kế gốc** v1 + bổ sung v2/v3 — lịch sử có giá trị, **một phần lỗi thời** | Đọc để biết ý đồ ban đầu (§0 nguyên tắc, §3–§6 luật). Khi lệch code thì code thắng; phần lệch liệt kê trong khung ghi chú đầu `SPEC.md` và ở [13](13-viec-con-lai-va-y-tuong.md) §1.2 — đáng chú ý nhất là §8 còn mô tả thanh trên cùng v1 (nay HUD nổi, chip AI chỉ admin — [08](08-frontend-giao-dien.md) §21, [12](12-quyet-dinh-thiet-ke.md) ADR-27). Không viết lại; chỉ thêm ghi chú lỗi thời theo [14](14-quy-uoc-dong-gop.md) §4.4 |
| [`../src/types.ts`](../src/types.ts) | **Hiện hành** — hợp đồng kiểu dữ liệu dùng chung bốn vùng (sim, drama, ai, server) | Mở trước khi đổi bất kỳ shape dữ liệu; quy trình thêm trường an toàn ở [02](02-kien-truc-va-giao-thuc.md) §9.1 |
| [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) | **Hiện hành** — hướng dẫn ngắn cho agent AI; Claude Code đọc `CLAUDE.md` tự động, `AGENTS.md` là bản sao cho công cụ khác (**sửa cả hai**) | Lệnh thường dùng, bản đồ tài liệu, 5 nguyên tắc, quy ước code, **quy tắc bắt buộc sửa code phải sửa docs + CHANGELOG**, điều cấm |
| [`../CHANGELOG.md`](../CHANGELOG.md) | **Hiện hành** — lịch sử thay đổi theo ngày, mới nhất trên cùng | Mỗi thay đổi chức năng một dòng, chia Thêm / Sửa / Xoá / Vận hành / Tài liệu; định dạng ở [14](14-quy-uoc-dong-gop.md) §4.3 |
| [v2-contract.md](v2-contract.md) | **Lịch sử** — hợp đồng v2 frontend ⇄ backend (2026-11-01, tiếng Anh) | Vẫn đúng: §1 bản đồ v2, §2 shape `ShowroomProduct`, §3 `showroom_chat`, §5 ranh giới module canvas/ui. Lỗi thời: §2 "5 beauty + 5 tech" (nay 8 + 10), §4 và §6 chip 🤖 / 👔 cho mọi người (nay 🤖 chỉ admin, 👔 đã bỏ), §5 mặc định `setCharacterScale`. Tài liệu hiện hành: [07](07-frontend-ve-canvas.md), [08](08-frontend-giao-dien.md), [09](09-cau-hinh-du-lieu.md) §5 |
| [v3-news.md](v3-news.md) | **Lịch sử** — thiết kế gốc v3 (thời sự an toàn, câu chuyện tự phát triển, lưu trữ dài hạn) | Nguyên tắc an toàn 1–4 vẫn là kim chỉ nam. Lỗi thời: "~40 tin/nhóm + persist" (persist chỉ 12/nhóm), "30–60 phút" (mặc định 45), ngưỡng xin nghỉ `mood < 25` (nay `lowMoodDays`), `comeback`/`headhunt_rumor` (chưa làm), "~50 KB/ngày", phần "Hiện trạng v1/v2" là lịch sử. Tài liệu hiện hành: [06](06-tin-tuc-thoi-su.md), [04](04-dao-dien-cau-chuyen-nhan-su.md) §9–§10, [09](09-cau-hinh-du-lieu.md) §7 |
| [ui-polish-todo.md](ui-polish-todo.md) | **Lịch sử + tiêu chuẩn** — yêu cầu làm đẹp UI của chủ dự án kèm trạng thái | Tiêu chuẩn thẩm mỹ ("cẩn thận, trực quan, rõ, đẹp — nhân vật đủ bộ phận") vẫn **hiện hành** và là checklist của [11](11-kiem-thu-qa.md) §11. §7 (nhân vật nhìn ngang), §8 (deploy), §9 (HUD bỏ thông tin hệ thống) đã ✅; §1–§6 đã làm ở v2 nhưng chưa đánh ✅ ([13](13-viec-con-lai-va-y-tuong.md) §1.2). Ghi chú gốc §8 nói SSL "Full" trong khi `deploy/deploy.sh` nói "Flexible" — mâu thuẫn còn mở ([10](10-van-hanh-deploy.md) §5.1) |
| [v2-spec-notes.md](v2-spec-notes.md) | **Lịch sử** — stub: nội dung đã gộp vào `SPEC.md` ngày 2026-11-01 | Chỉ còn là con trỏ; có thể xoá (khi xoá phải sửa chỗ trỏ tới nó: tài liệu này, [01](01-tong-quan.md) §7) |
| [real-products.json](real-products.json) | **Dữ liệu chờ** (không phải tài liệu) — 6 sản phẩm thật, 4 còn `name: "???"` | Kho chờ ghép vào `data/products.json` ([09](09-cau-hinh-du-lieu.md) §8, [13](13-viec-con-lai-va-y-tuong.md) §1.1 #1). Chứa link affiliate — không chép vào tài liệu |
| `preview/` (18 ảnh PNG, ≈ 9,7 MB) | **Tham chiếu thị giác** — `v2/` (11 ảnh) hiện hành; `v1-*.png`, `preview-*.png`, `bug-nhan-vat-nhin-ngang.png` là lịch sử | So ảnh khi QA giao diện ([11](11-kiem-thu-qa.md) §11, [08](08-frontend-giao-dien.md) §20). Nằm trong git nhưng rsync không đưa lên VPS; không thêm ảnh nếu không phải mốc đã duyệt |

---

## 4. Đọc theo vai trò

Mỗi hàng là thứ tự đọc gợi ý ("→" đọc tiếp, "+" mở song song để đối chiếu). Lộ trình gốc ở [01](01-tong-quan.md) §10.

| Bạn là… | Đọc theo thứ tự | Để làm gì |
|---|---|---|
| **Bất kỳ ai mới vào** (30 phút đầu) | [01](01-tong-quan.md) §1–§5 → [02](02-kien-truc-va-giao-thuc.md) §1–§4 → [12](12-quyet-dinh-thiet-ke.md) §1 (bảng tóm tắt ADR) → [14](14-quy-uoc-dong-gop.md) §4 → [13](13-viec-con-lai-va-y-tuong.md) §1 | hiểu sản phẩm, luồng dữ liệu, vì sao code như vậy, luật chơi khi sửa, việc đang mở |
| **Dev backend / mô phỏng** | [02](02-kien-truc-va-giao-thuc.md) → [03](03-mo-phong-the-gioi.md) → [04](04-dao-dien-cau-chuyen-nhan-su.md) → [09](09-cau-hinh-du-lieu.md) → [11](11-kiem-thu-qa.md) §3–§4 + `src/types.ts` + `SPEC.md` §3–§5 | sửa World / Director / HR / story mà không phá bất biến; biết `smoke` và `smoke:story` phải xanh |
| **Dev frontend** | [02](02-kien-truc-va-giao-thuc.md) §5, §7, §8, §10 → [07](07-frontend-ve-canvas.md) → [08](08-frontend-giao-dien.md) → [v2-contract.md](v2-contract.md) §5–§6 + [ui-polish-todo.md](ui-polish-todo.md) + ảnh `preview/v2/` → [11](11-kiem-thu-qa.md) §10–§11 | nắm `store` và thứ tự khởi động; ranh giới canvas/ui; nguyên tắc "không lộ hệ thống"; QA hình vì `public/` không có test tự động |
| **Dev AI / prompt** | [05](05-lop-ai.md) → [04](04-dao-dien-cau-chuyen-nhan-su.md) §3, §4, §9, §10 → [06](06-tin-tuc-thoi-su.md) §8–§9, §13 → [11](11-kiem-thu-qa.md) §6–§9 → [12](12-quyet-dinh-thiet-ke.md) §3 + `README.md` §3–§4 | thêm provider, sửa prompt / schema / sanitize đúng chỗ; không thêm lời gọi AI ngoài `reserve()` và ngân sách; biết test-llm / test-router bám chuỗi prompt |
| **Vận hành / deploy** | [10](10-van-hanh-deploy.md) → [09](09-cau-hinh-du-lieu.md) §3–§4, §6–§7 → [05](05-lop-ai.md) §4, §11 → [02](02-kien-truc-va-giao-thuc.md) §6–§8 + `README.md` §8–§11 | deploy, đọc log và chip 🤖, xử lý 502 / giật / giao diện cũ / hết quota, vào–thoát admin, rollback |
| **Nội dung / nhân vật / sản phẩm** | [09](09-cau-hinh-du-lieu.md) §5, §8 → [04](04-dao-dien-cau-chuyen-nhan-su.md) §3, §7 → [14](14-quy-uoc-dong-gop.md) §3.3, §3.8 → `src/content/roster.ts`, `catalog.ts` + `README.md` §5 | thêm sản phẩm affiliate, sửa nhân vật / quan hệ / catalog đúng ràng buộc (`id`, tag, `deskItemProductId`) |
| **Agent AI tiếp tục phát triển** | [`../CLAUDE.md`](../CLAUDE.md) → [01](01-tong-quan.md) → [14](14-quy-uoc-dong-gop.md) (toàn bộ, nhất là §4–§6) → tài liệu của vùng sắp sửa (bảng §5) → [13](13-viec-con-lai-va-y-tuong.md) → [11](11-kiem-thu-qa.md) | đọc "Khi sửa code vùng này" **trước** khi sửa; cập nhật docs + `CHANGELOG.md` cùng commit; chạy checklist [14](14-quy-uoc-dong-gop.md) §6; **không** đọc/chép file bí mật |

---

## 5. Bản đồ "sửa file ở đâu → cập nhật tài liệu nào → chạy test gì"

Bản rút gọn; **bảng đầy đủ và là nguồn sự thật** ở [14](14-quy-uoc-dong-gop.md) §5 (sửa bảng đó thì sửa cả bảng này). Mỗi tài liệu còn có mục "Khi sửa code vùng này" chi tiết hơn ở cuối.

| Sửa ở | Tài liệu chính | Cũng rà | Test tối thiểu |
|---|---|---|---|
| `src/types.ts` | [02](02-kien-truc-va-giao-thuc.md) §9 + tài liệu vùng dùng kiểu đó | `SPEC.md` §1.1 | `npm run typecheck` |
| `src/config.ts`, `.env.example` | [09](09-cau-hinh-du-lieu.md) §2–§4 | [05](05-lop-ai.md) §2, `README.md` §3–§4, `SPEC.md` §10.1 | `test:router`, `smoke` |
| `src/server.ts` | [02](02-kien-truc-va-giao-thuc.md) §2, §5–§8 | [10](10-van-hanh-deploy.md), [08](08-frontend-giao-dien.md) §4, `SPEC.md` §7, §10.5 | `typecheck` + `curl` tay (chưa có test HTTP/WS) |
| `src/sim/world.ts`, `behavior.ts`, `clock.ts`, `persist.ts` | [03](03-mo-phong-the-gioi.md) | [02](02-kien-truc-va-giao-thuc.md) §3, §11; `SPEC.md` §3–§4, §10.4 | `smoke` |
| `src/sim/map.ts` | [03](03-mo-phong-the-gioi.md) §3 | [07](07-frontend-ve-canvas.md) §6, §9; [v2-contract.md](v2-contract.md) §1 | `smoke` (kiểm tra tĩnh bản đồ) |
| `src/sim/director.ts`, `scenes.ts`, `rumors.ts` | [04](04-dao-dien-cau-chuyen-nhan-su.md) | [02](02-kien-truc-va-giao-thuc.md) §4, `SPEC.md` §5 | `smoke`, `smoke:story` |
| `src/sim/hr.ts`, `story.ts` | [04](04-dao-dien-cau-chuyen-nhan-su.md) §9–§10 | `README.md` §6, `SPEC.md` §5.6/§5.8, [12](12-quyet-dinh-thiet-ke.md) §4; `guardOk()` trong `scripts/smoke-story.ts` sửa **cùng commit** | `smoke:story` |
| `src/content/shopping.ts`, `src/content/situations.ts` | [04](04-dao-dien-cau-chuyen-nhan-su.md) §11 (mua sắm), §16 (tình huống công ty) | `README.md` §5.2 / §6.6, [12](12-quyet-dinh-thiet-ke.md) ADR-30 / ADR-31 | `smoke:story`, `test:llm` |
| `src/sim/archive.ts`, `data/history/` | [03](03-mo-phong-the-gioi.md) §17, [09](09-cau-hinh-du-lieu.md) §7 | [02](02-kien-truc-va-giao-thuc.md) §6, [08](08-frontend-giao-dien.md) §11 | `smoke` (phần 5e) |
| `src/sim/showroom.ts`, `src/content/products.ts`, `data/products.json` | [09](09-cau-hinh-du-lieu.md) §5 | [01](01-tong-quan.md) §3, `README.md` §5, [07](07-frontend-ve-canvas.md) §9 | `smoke`; khởi động lại server |
| `src/ai/*` | [05](05-lop-ai.md) | [12](12-quyet-dinh-thiet-ke.md) §3, `README.md` §3–§4, `SPEC.md` §6 | `test:llm`, `test:router` |
| `src/content/roster.ts`, `catalog.ts` | [03](03-mo-phong-the-gioi.md) §10, [04](04-dao-dien-cau-chuyen-nhan-su.md), [05](05-lop-ai.md) §6 | `SPEC.md` §2, `README.md` §13 | `smoke`, `test:llm` |
| `src/news/*`, `scripts/fixtures/news/` | [06](06-tin-tuc-thoi-su.md) | [09](09-cau-hinh-du-lieu.md) §3, `README.md` §7, [v3-news.md](v3-news.md) | `test:news` |
| `public/js/render/*`, `store.js`, `net.js`, `main.js` | [07](07-frontend-ve-canvas.md) | [02](02-kien-truc-va-giao-thuc.md) §10, [10](10-van-hanh-deploy.md), [11](11-kiem-thu-qa.md) §10–§11 | QA hình + đo độ mượt; khởi động lại server (`ASSET_VERSION`) |
| `public/index.html`, `style.css`, `public/js/ui/*`, `labels.js`, `util.js` | [08](08-frontend-giao-dien.md) | [07](07-frontend-ve-canvas.md) §5, [11](11-kiem-thu-qa.md) §11 | QA hình (desktop + mobile, có / không admin) |
| `scripts/*.ts`, `package.json`, `tsconfig.json` | [11](11-kiem-thu-qa.md) | `README.md` §12, `SPEC.md` §9, [14](14-quy-uoc-dong-gop.md) §1–§2 | `npm test` |
| `deploy/*` | [10](10-van-hanh-deploy.md) | [12](12-quyet-dinh-thiet-ke.md) §6, `README.md` §11, [ui-polish-todo.md](ui-polish-todo.md) §8 | deploy thử + `/api/health` |
| `.gitignore`, bí mật, quyền admin | [09](09-cau-hinh-du-lieu.md) §9, [14](14-quy-uoc-dong-gop.md) §1.3, §7 | [10](10-van-hanh-deploy.md), [12](12-quyet-dinh-thiet-ke.md) §6 | `git check-ignore` |
| Một quyết định thiết kế mới | [12](12-quyet-dinh-thiet-ke.md) §8 (ADR) | tài liệu vùng | — |
| Việc mở / lỗi đã biết / ý tưởng | [13](13-viec-con-lai-va-y-tuong.md) + "Câu hỏi còn mở" của tài liệu vùng | — | — |
| Thêm / đổi tên / xoá tài liệu trong `docs/` | tài liệu này (§2, §3, §5), [01](01-tong-quan.md) §7 và §10, [14](14-quy-uoc-dong-gop.md) §4.2 và §5 | `CLAUDE.md`/`AGENTS.md` nếu đổi bản đồ tài liệu | lệnh kiểm liên kết ở §6 |

**Mọi thay đổi chức năng** đều kèm: dòng mới trong [`../CHANGELOG.md`](../CHANGELOG.md), dòng `> Cập nhật lần cuối` của tài liệu đã sửa, dọn "Câu hỏi còn mở" nếu đã giải quyết, và sửa hoặc đánh dấu lỗi thời ở `README.md`/`SPEC.md` nếu chúng mô tả hành vi vừa đổi ([14](14-quy-uoc-dong-gop.md) §4.1 R1–R10).

---

## 6. Kiểm liên kết tương đối (chạy sau mỗi lần sửa tài liệu)

Mọi liên kết Markdown trong `docs/*.md`, `README.md`, `SPEC.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md` phải trỏ tới file tồn tại. Lệnh kiểm (không cần dependency, chạy ở gốc dự án):

```bash
for f in docs/*.md README.md SPEC.md CLAUDE.md AGENTS.md CHANGELOG.md; do
  d=$(dirname "$f")
  grep -oE '\]\([^)#[:space:]]+' "$f" | cut -c3- | grep -vE '^(https?:|mailto:)' | sort -u \
    | while read -r t; do [ -e "$d/$t" ] || echo "GÃY: $f → $t"; done
done
```

Không in gì = mọi liên kết tốt. Liên kết trong `docs/` viết tương đối so với `docs/` (`01-tong-quan.md`, `../README.md`); liên kết ở gốc viết tương đối so với gốc (`docs/README.md`). Ví dụ lệnh `grep` nằm trong inline code của một tài liệu có thể bị bắt nhầm — đọc kết quả trước khi sửa.

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … | chạy |
|---|---|---|
| Thêm tài liệu `docs/15-….md` | §2 (một hàng: trả lời gì, phạm vi, đọc khi); §4 nếu thuộc lộ trình của vai trò nào; §5 nếu mô tả vùng code mới; [01](01-tong-quan.md) §7 và §10; [14](14-quy-uoc-dong-gop.md) §5; `CLAUDE.md`/`AGENTS.md` (mục bản đồ tài liệu) | lệnh §6 |
| Đổi tên / xoá tài liệu | mọi liên kết tới nó (`grep -rn "<tên cũ>" docs/ README.md SPEC.md CLAUDE.md AGENTS.md CHANGELOG.md`); §2–§5 | lệnh §6 |
| Tài liệu cũ (`v2-contract.md`, `v3-news.md`, `ui-polish-todo.md`, `v2-spec-notes.md`) được đánh ✅ / đánh dấu lỗi thời thêm, hoặc bị xoá | §3 (cột Trạng thái); [01](01-tong-quan.md) §7 nếu xoá | — |
| `SPEC.md` / `README.md` được sửa khớp code | §3 (bỏ mục lệch tương ứng); khung ghi chú đầu `SPEC.md`; [13](13-viec-con-lai-va-y-tuong.md) §1.2 | — |
| Bảng ánh xạ [14](14-quy-uoc-dong-gop.md) §5 đổi | §5 ở đây (bản rút gọn phải khớp) | — |
| `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md` đổi cấu trúc | §3; `AGENTS.md` phải giống `CLAUDE.md` trừ dòng ghi chú đầu | `diff CLAUDE.md AGENTS.md` |
| Thêm ảnh vào `preview/` | §3 hàng `preview/` (số ảnh, dung lượng); [11](11-kiem-thu-qa.md) §11 nếu là ảnh chuẩn mới | — |

## Câu hỏi còn mở / cần kiểm tra

1. Lệnh kiểm liên kết ở §6 hiện chạy tay; có nên thêm `scripts/check-docs.sh` (không dependency) và đưa vào checklist [14](14-quy-uoc-dong-gop.md) §6? Cần chủ dự án đồng ý vì thêm file vào `scripts/`.
2. Số dòng `file:dòng` trong 14 tài liệu đúng tại 2026-11-02; chưa có cơ chế phát hiện số dòng trôi ngoài quy tắc R5 (`grep -rn "<tên file>" docs/` khi sửa file đó).
3. `docs/preview/` ≈ 9,7 MB nằm trong git — giữ, chuyển Git LFS hay bỏ theo dõi là quyết định của chủ dự án ([14](14-quy-uoc-dong-gop.md) §7).
4. `v2-spec-notes.md` chỉ còn là stub — xoá hay giữ? Nếu xoá phải sửa [01](01-tong-quan.md) §7 và §3 ở đây.
5. Bộ `docs/01…14`, tài liệu này, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md` **chưa được commit** (`git status` → `??` tại 2026-11-02) — xem [14](14-quy-uoc-dong-gop.md) §7.1.
