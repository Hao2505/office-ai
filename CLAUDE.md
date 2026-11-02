# CLAUDE.md — hướng dẫn cho Claude Code (và mọi agent AI) làm việc trong repo này

> Claude Code đọc file này **tự động** mỗi khi mở dự án. Bản sao cho công cụ AI khác: [AGENTS.md](AGENTS.md) — **nội dung giống nhau, sửa cả hai**. Cập nhật lần cuối: 2026-11-02.

## 1. Dự án là gì (5 dòng)

- **Văn Phòng Ảo** — web giải trí kiểu "sitcom văn phòng phát trực tiếp 24/7": công ty công nghệ Việt Nam ảo **Cty TNHH VibeCorp** với 10 nhân viên AI làm việc / trốn việc / tám chuyện / bị HR xử lý; chạy liên tục trên **một** thế giới chung, mọi trình duyệt là khán giả qua WebSocket. Site thật: https://corp.vibe-coder.fun.
- Hai lớp: **World** ("thân xác", `src/sim/`, 0 token) mô phỏng di chuyển, lịch, KPI; **Director** (`src/sim/director.ts`) quyết cảnh gì xảy ra; **Brain** (`src/ai/`) chỉ gọi AI miễn phí (Gemini + Groq + Cloudflare Workers AI) để viết **cả cảnh** trong một JSON, luôn có đường lui thoại mẫu offline.
- Kiếm tiền bằng link Shopee tiếp thị liên kết: phòng trưng bày 2 kệ, chip link dưới câu thoại, món đồ trên bàn trong hồ sơ; mọi link đi qua `GET /go/:id?src=` để server đếm click.
- Stack: Node ≥ 20, TypeScript strict ESM chạy thẳng bằng `tsx` (không build); `openai` + `ws` + `dotenv` là ba dependency duy nhất; frontend vanilla ES module + Canvas 2D, không framework, không ảnh.
- Mọi chữ người xem thấy là tiếng Việt có dấu; định danh / tên file / hàm / biến tiếng Anh.

## 2. Lệnh thường dùng

| Lệnh | Ghi chú |
|---|---|
| `npm install` → `npm start` | chạy server (`http://localhost:3000`); không có key AI = chế độ OFFLINE thoại mẫu, 0 đồng |
| `npm run dev` | `tsx watch src/server.ts`; sửa `public/` phải khởi động lại server để `ASSET_VERSION` đổi (watch không theo dõi `public/` — cần kiểm tra) |
| `npm run typecheck` | `tsc --noEmit` cho cả `src/` và `scripts/` |
| `npm test` | = typecheck → smoke → smoke:story → test:news → test:llm → test:router; dừng ở bước đầu lỗi; không ra Internet; ước ~1 phút (chưa đo lại) |
| `npm run smoke` · `smoke:story` · `test:news` · `test:llm` · `test:router` | chạy riêng từng bước; `smoke:story` đỏ → chạy lại với `SMOKE_STORY_SEED=<số in ra>` trước khi kết luận |
| `npm run eyeball:hr` | gọi AI **thật** (tốn quota của chủ dự án) — chỉ chạy khi được yêu cầu |
| `bash deploy/deploy.sh` | đưa lên VPS (lần đầu `--setup`); chỉ chạy khi chủ dự án yêu cầu; chi tiết `docs/10` |

## 3. Bản đồ tài liệu — đọc trước khi sửa

- **Mục lục, đọc theo vai trò, bản đồ "sửa file nào → cập nhật tài liệu nào"**: [docs/README.md](docs/README.md).
- Tổng quan & 5 nguyên tắc: `docs/01` · kiến trúc / giao thức: `docs/02` · World: `docs/03` · Director / HR / biên kịch: `docs/04` · lớp AI: `docs/05` · thời sự: `docs/06` · frontend canvas: `docs/07` · frontend DOM: `docs/08` · cấu hình & dữ liệu: `docs/09` · vận hành / deploy: `docs/10` · test / QA: `docs/11` · ADR: `docs/12` · việc mở / lỗi đã biết: `docs/13` · **quy ước & quy tắc bảo trì docs**: [docs/14-quy-uoc-dong-gop.md](docs/14-quy-uoc-dong-gop.md).
- Hợp đồng kiểu dữ liệu: [src/types.ts](src/types.ts) — mở trước khi đổi bất kỳ shape. `SPEC.md` = hợp đồng thiết kế gốc, một phần lỗi thời (xem khung ghi chú đầu file): khi lệch, **code thắng**. `README.md` = hướng dẫn cho chủ dự án.
- Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md).

## 4. Năm nguyên tắc sản phẩm (chủ dự án đặt ra — không vi phạm)

1. **Tốn ít token nhất, chỉ dùng AI miễn phí** (Gemini, Groq, Cloudflare; không trả tiền): mọi lời gọi AI đi qua `brain.reserve()`, ngân sách `DAILY_BUDGET_USD`, `LLM_ONLY_WHEN_WATCHED`, giữ nhịp quota; không thêm lời gọi AI mới ngoài cổng đó.
2. **Câu chuyện tự phát, AI quyết, hợp lý**: không kịch bản cố định, không luật cứng theo id nhân vật, không ai bị "đánh dấu" làm nạn nhân (`randomizeOpeningTraits`, hàng rào HR `allowedActions`; `smoke:story` kiểm "không ai bị đánh dấu").
3. **Giao diện đẹp, rõ, cẩn thận; nhân vật đủ bộ phận**: sửa `public/` phải QA hình desktop + mobile, so với `docs/preview/`.
4. **Người xem thường không thấy gì về hệ thống** (nguồn AI, lượt gọi, lỗi, số bấm link): lọc ở server (`publicStatus()` trong `src/server.ts`), client chỉ hiện khi `store.dev`; chỉ admin có `DEV_TOKEN` mới thấy.
5. **Thời sự an toàn pháp lý**: chỉ bình luận tin đã đăng, lọc tin nhạy cảm, không bịa, không gán tội — không nới bộ lọc (`src/news/filter.ts`, `NEWS_RULES`, sanitize) nếu chưa đọc `docs/06` §13.

## 5. Quy ước code (tóm tắt — đầy đủ ở `docs/14` §1)

- Import tương đối **phải có đuôi `.js`**; không thêm npm dependency; không đọc `process.env` rải rác — cấu hình qua `CONFIG` (`src/config.ts`).
- Không để một lỗi lẻ làm sập livestream: dữ liệu từ mạng / file / AI nhận `unknown`, kiểm rồi mới dùng, luôn có đường lui; `Brain` không bao giờ throw.
- Client: chuỗi từ server chỉ vào DOM qua `textContent` (`el()` / `setText()`), không `innerHTML`; màu qua `safeColor`, link sản phẩm qua `safeProductUrl` (phải là `/go/...`); `public/js/render/**` chỉ đọc `store`, không nhận dữ liệu qua tham số.
- Bảng tra theo `SceneType` / `RoleKey` là `Record<…>` đầy đủ để TypeScript báo thiếu khi thêm khoá — đừng đổi sang `Partial`.
- Nhịp: chính sách AI / cảnh dùng `now()` tiêm được (test chạy đồng hồ ảo); đừng thay bằng `Date.now()`.
- Commit **bằng tiếng Anh** (yêu cầu chủ dự án 2026-11-02) dạng `<area>: <description>` (vùng: `ai`, `sim`, `drama`, `hr`, `news`, `canvas`, `ui`, `server`, `config`, `content`, `data`, `deploy`, `test`, `docs`); code và docs **cùng một commit**.

## 6. QUY TẮC BẮT BUỘC — sửa code là sửa tài liệu

**Mọi lần thêm / sửa / xoá chức năng đều phải cập nhật, trong cùng commit: (a) tài liệu vùng tương ứng trong `docs/` — tra bảng ở [docs/README.md](docs/README.md) §5 và mục "Khi sửa code vùng này" cuối tài liệu đó; (b) [CHANGELOG.md](CHANGELOG.md) — một dòng dưới `[Unreleased]`, đúng nhóm Thêm / Sửa / Xoá / Vận hành / Tài liệu; (c) dòng `> Cập nhật lần cuối: YYYY-MM-DD` ở đầu mọi tài liệu đã sửa. Thay đổi thiếu phần tài liệu được coi là CHƯA XONG — y như code không qua typecheck.** Quy tắc đầy đủ R1–R10: `docs/14` §4.

Checklist 5 dòng trước khi báo "xong":

- [ ] Đã đọc tài liệu vùng + mục "Khi sửa code vùng này" + ADR liên quan (`docs/12`) **trước** khi sửa.
- [ ] `npm run typecheck` sạch; test của vùng xanh (bảng `docs/14` §2); `npm test` trọn bộ nếu đụng nhiều vùng hoặc sắp deploy.
- [ ] Docs vùng đã cập nhật, `CHANGELOG.md` có dòng mới, dòng "Cập nhật lần cuối" đã đổi, "Câu hỏi còn mở" đã dọn; `README.md` / `SPEC.md` đã sửa hoặc đánh dấu lỗi thời nếu chúng mô tả hành vi vừa đổi.
- [ ] Không vi phạm 5 nguyên tắc ở mục 4; số liệu hệ thống mới (nếu có) đi qua `publicStatus()` và chỉ render khi `store.dev`.
- [ ] Báo cáo cuối liệt kê: file code đã đổi, tài liệu đã đổi, test đã chạy + kết quả, câu hỏi mở mới, điều **chưa** làm.

## 7. Điều cấm

- **Không mở, trích, chép, commit** `.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json`. Tài liệu / log / commit chỉ nhắc **tên** biến (ví dụ `AI_GEMINI_API_KEY`, `DEV_TOKEN`), không bao giờ ghi key, token, mật khẩu, địa chỉ VPS.
- **Không đụng app khác trên VPS dùng chung**: không dùng cổng 3000 (đã bận), không sửa site nginx hay tiến trình pm2 nào ngoài `vibecorp`, không chạy lại `deploy.sh --setup` (ghi đè nginx) nếu không được yêu cầu.
- Không gọi AI thật / API ngoài / bấm link `/go/` trên site thật khi không được bảo; không bật `DEBUG_PROMPTS=1` trên production.
- Không tạo file báo cáo `.md` rải rác ngoài `docs/`; không viết lại `SPEC.md` hay tài liệu cũ (chỉ thêm ghi chú lỗi thời); không sửa lịch sử ở `docs/01` §8, chỉ nối thêm.
- Không `git add -A` mù; không commit / push nếu không được yêu cầu.
