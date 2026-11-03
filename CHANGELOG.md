# Changelog — Văn Phòng Ảo

Mọi thay đổi chức năng của dự án ghi ở đây, **mới nhất trên cùng**, theo định dạng [Keep a Changelog](https://keepachangelog.com/) (tiếng Việt). Dự án chưa đánh số phiên bản (`package.json` vẫn `0.1.0`) nên nhóm theo **ngày**; "v1 / v2 / v3" chỉ là tên gọi các mốc trong ngày 2026-11-01.

## Cách ghi thêm (đọc trước khi sửa file này)

- Mỗi thay đổi **một dòng** dưới `## [Unreleased]`, đúng nhóm: **Thêm** / **Sửa** / **Xoá** / **Vận hành** / **Tài liệu** (ba nhóm đầu tương ứng Added / Changed / Removed của Keep a Changelog; hai nhóm sau là của dự án). Khi deploy lên `corp.vibe-coder.fun`, chuyển các dòng [Unreleased] xuống mục ngày `## [YYYY-MM-DD]` và thêm dòng **Vận hành** kèm hash commit để truy ngược sự cố.
- Khuôn một dòng: `- [vùng] mô tả ngắn — file chính · docs đã sửa · test đã chạy · commit`. Vùng dùng cùng bộ từ với tiền tố commit (`docs/14` §7.2): `ai`, `sim`, `drama`, `hr`, `news`, `canvas`, `ui`, `server`, `config`, `content`, `data`, `deploy`, `test`, `docs`.
- "Thay đổi chức năng" gồm cả: biến môi trường, route, thông điệp WebSocket, loại cảnh, nút dev, hoạt động, trường sản phẩm, phòng/nội thất, luật hoặc ngưỡng HR, hằng số chính sách AI, ngưỡng khẳng định trong test, bước deploy hay chỉ thị nginx, bất kỳ thứ gì người xem nhìn thấy (`docs/14` §4.1 R2). Sửa chính tả / refactor không đổi hành vi: chỉ ghi nếu đáng nhớ.
- **Không ghi bí mật** (key, token, mật khẩu, địa chỉ VPS), không ghi link affiliate. Dòng CHANGELOG đi **cùng commit** với code và với tài liệu vùng trong `docs/` (quy tắc bắt buộc ở `CLAUDE.md` mục 6).

## [Unreleased]

### Vận hành
- [deploy] Chú thích `deploy.sh` và câu báo lỗi certbot sửa theo thực tế: Cloudflare không phải Flexible mà là SSL **Full**, chủ dự án chuyển **Full (strict)** cùng ngày (Cloudflare kiểm chứng chỉ origin; sau khi chuyển corp + cinema vẫn trả 200). Mọi site trên VPS bắt buộc có khối 443 với chứng chỉ hợp lệ, thiếu / hết hạn = lỗi 526; certbot lỗi thì cảnh báo đúng điều đó kèm cách xử lý — `deploy/deploy.sh` · docs/10 §3.5, §5.1.

### Tài liệu
- [docs] Đóng câu hỏi "Cloudflare Flexible hay Full" (đã rõ: Full, nay là Full (strict); cookie admin có `Secure`) và "certbot có tự gia hạn không" (có: timer chạy 2 lần/ngày, chứng chỉ hạn 2027-01-30) — docs/01, 10, 12, 13.

## [2026-11-03]

### Thêm
- [drama] [sim] **Tình huống công ty (v5)** — 10 tình huống như ở công ty thật: kẹt tiền xoay vòng vốn, thị trường khó / khách cắt ngân sách, khủng hoảng truyền thông (bị bóc phốt), tin vui về công ty, chuyện nhà ảnh hưởng công việc, chia bè kết phái, nhân viên chống đối, sếp làm công tác tư tưởng, đối thủ câu người, nhà đầu tư ghé thăm. Mỗi cái là mạch 4 bước của AI biên kịch: bùng phát → cảnh 🧯 `crisis_meeting` (sếp / HR / lead họp, **AI chốt 1 trong 3–4 phương án**) → triển khai theo phương án (thông báo, 📣 `pep_talk` truyền lửa / nói riêng / hoà giải hai phe với kết quả `inspired | unmoved` do AI quyết, giao việc sales, tăng ca, siết kỷ luật, khao…) → kết cục theo xác suất của phương án; mỗi lúc 1 tình huống, thực đơn AI chỉ kèm ≤ 3 loại hợp tình hình (tiết kiệm token) — `src/content/situations.ts`, `src/sim/story.ts`, `src/sim/director.ts`, `src/sim/scenes.ts`, `src/ai/prompts.ts`, `src/ai/sanitize.ts`, `src/ai/offline.ts`, `src/types.ts` · docs/04 §16, docs/05, docs/02 §9, docs/12 ADR-31 · `npm test` xanh (smoke:story 23/23, test:llm 162/162).
- [ui] Thẻ cảnh 🧯 "Họp xử lý tình huống" (tông `crisis` cam đất) và 📣 "Sếp truyền lửa" (tông nhân sự) — `public/js/labels.js`, `public/js/ui/feed.js`, `public/style.css` · docs/08 §7.8.
- [content] **26 sản phẩm chính thức** thay 18 món mẫu; kệ phòng trưng bày 2 tầng × 7 ô; `products.json` thêm `short` / `facts` / `avoid` / `hooks` — `data/products.json`, `src/content/products.ts`, `public/js/render/furniture.js`, `showroom.js` · docs/09 §5, docs/07 §9.3–§9.5.
- [drama] "Chuyện mua sắm": 12 "vụ" do sếp / HR phát động (Secret Santa, thi bàn đẹp, tuần sống khoẻ…), 16 kiểu chuyện xoay vòng chống lặp (đã mua thấy ngon bất ngờ, mua chung, mượn luôn không trả…), hàng về → khui hộp, trao quà, beat `shopping_story` cho AI biên kịch; món chỉ được nhắc khi có cớ — `src/content/shopping.ts`, `src/sim/director.ts`, `src/sim/story.ts` · docs/04 §11, ADR-30.
- [ui] Thẻ chia sẻ link đầy đủ: SEO (`description`, `keywords`, `robots`, `canonical`), Open Graph, Twitter/X `summary_large_image`, JSON-LD `WebSite`, icon PNG + `apple-touch-icon` + `site.webmanifest`, `robots.txt` (chặn bot đi `/go/`, `/api/`); ảnh xem trước 1200×630 chụp văn phòng thật — `public/index.html`, `public/og-image.jpg`, `public/icon-*.png` · docs/08 §2, ADR-28.
- [config] [server] `SITE_URL` (tuỳ chọn): gốc URL cho thẻ chia sẻ; trống thì server suy từ `Host` + https (`X-Forwarded-Proto` / `CF-Visitor`), lọc Host lạ; `%OG_VERSION%` = băm ảnh xem trước — `src/config.ts` `siteUrlOf`, `src/server.ts` `sendIndexHtml`/`siteOrigin`/`requestIsHttps` · docs/09, docs/02 §2, docs/10 §7.6.
- [content] Trường tuỳ chọn `spoken` trong `data/products.json`: mệnh đề nói được cho câu thoại mẫu khi không có AI (9 món mà pitch lặp lại tên gọi, vd "lót chuột hình mèo, vải in hình mèo" → "mặt vải, đế cao su chống trượt") — `data/products.json`, `src/content/products.ts`, `src/types.ts`, `src/sim/director.ts`, `src/ai/offline.ts` · docs/09 §5, docs/05 §9.3 · test:llm 12c.
- [test] `npm run share-images` — tạo lại ảnh xem trước + icon bằng Chrome headless (chỉ dùng `ws`, tự tua tới giờ làm, chờ có thoại rồi chụp) — `scripts/share-images.ts` · docs/11 §8b.

### Sửa
- [config] `.env.example`: chú thích model Groq gợi ý đổi từ `llama-3.3-70b-versatile · qwen/qwen3-32b` (không có ở gói free) thành `openai/gpt-oss-120b` / `qwen/qwen3.8-27b` kèm điều kiện dùng Qwen — docs/05 §2, docs/09 §2.
- [canvas] Biểu tượng nhãn phòng, bảng tên kệ, biển 🚻 WC biến mất / lệch: Chrome không vẽ emoji màu khi cỡ chữ danh nghĩa < ~0,4 (dù đã phóng to bằng transform) → mọi emoji vẽ theo đơn vị ô đi qua `drawEmoji` (font 16 px + scale) — `public/js/render/draw.js`, `floor.js`, `furniture.js`, `showroom.js`, `office.js` · docs/07 §9.1.
- [canvas] Chữ quá to so với màn hình ở điện thoại xoay ngang, tablet, trình duyệt phóng to 150–200 %: bong bóng / emote / biển "ĐI VẮNG" / nhãn phòng co theo cỡ bản đồ (`uiScale`); nhãn phòng vẽ mỗi khung theo px màn hình (không phình khi phóng to, ẩn khi bản đồ < 7 px/ô); khung thấp mặc định phóng tới ~12,5 px/ô — `public/js/render/office.js`, `floor.js`, `bubbles.js` · docs/07 §7.2, §9.2, ADR-29.
- [ui] HUD tự co 6 nấc theo chỗ trống thật (`fitHud`) thay vì cắt chip ở mép / tràn sang bảng tin; điện thoại xoay ngang đưa bảng tin sang phải; bỏ ẩn chữ phụ chip / số người xem theo bề rộng cửa sổ — `public/js/ui/hud.js`, `public/style.css` · docs/08 §3.5, §4.6, §18.
- [ai] Giá sản phẩm chỉ nói bằng cảm nhận (rẻ / vừa / đáng tiền), câu nhắc món có con số giá bị lọc (`PRICE_RE`); khối sản phẩm trong prompt theo `mode` (len vào, trên kệ, khui hộp, quà, người đã có) — `src/ai/prompts.ts`, `src/ai/sanitize.ts`, `src/ai/offline.ts` · docs/05.
- [sim] Món đồ trên bàn tự đổi khi danh mục đổi (`fixDeskItems`), thêm `WorldApi.setDeskItem` — `src/sim/world.ts`, `src/content/roster.ts` · docs/03 §15.4.
- [ui] Tab Sản phẩm: bỏ câu "đang dùng thật" (không khẳng định điều chưa kiểm chứng), ghi chú không còn ngoặc kép — `public/js/ui/products.js` · docs/08 §10.
- [sim] Mạch truyện lưu với thứ tự khoá cố định (`canonArc` trong `Showrunner.serialize`) — trường gán dần lúc chạy (`plan`, `waited`, `a`…) không làm lệch bản lưu / phép thử lưu → khôi phục — `src/sim/story.ts` · docs/09 §6.4, docs/04 §14.
- [test] `test:llm`: server giả lập nhận "đúng 1 câu product=true" (prompt v4 không còn chữ "SẢN PHẨM") nên lối sản phẩm được thử lại; thêm mục 12b (crisis_meeting / pep_talk); `smoke:story` kiểm 28 beat + tình huống được chốt phương án — `scripts/test-llm.ts`, `scripts/smoke-story.ts` · docs/11.
- [drama] [ai] [canvas] [ui] [test] **Rà soát đợt v4 (sản phẩm) + v5 (tình huống công ty) + giao diện** (review nhiều agent, 2026-11-03): 24 phát hiện đã xác nhận, 22 lỗi khác nhau — sửa hết, chi tiết ở các dòng ngay dưới · smoke 35, smoke:story 25, test:news 105, test:llm 168, test:router 171 đều xanh.
- [drama] Director gạt mọi phương án (`plan_a`…`plan_d`) và kết quả truyền lửa (`inspired` / `unmoved`) do AI chốt vì danh sách verdict hợp lệ chưa mở rộng cho v5 → luôn dùng lựa chọn dự phòng: nay là `VERDICT_OK: Record<Verdict, true>` (TypeScript báo thiếu khi thêm giá trị) — `src/sim/director.ts` · docs/04 §16.4 · smoke:story `llmVerdictCheck` (thử đột biến: bỏ giá trị v5 → đỏ).
- [ai] Kết quả AI viết dạng phủ định ("chưa xuôi", "không cảm động", "not moved", "unconvinced", "không ở lại") bị hiểu thành kết quả tốt → `NEG_BEFORE`; cuộc họp trả số thứ tự ("2", "PA2") nay là phương án thứ n **trong danh sách đã đưa** (a, c, d → "2" = `plan_c`) — `src/ai/sanitize.ts` · docs/05 §8.2, docs/04 §16.4–16.5 · test:llm 12b.
- [drama] Tình huống công ty: ghé bàn hỏi han / nói rõ hướng xử lý dùng giọng mới `support` (trước là `warm` = cảnh "bạn thân bí mật"), có thoại mẫu offline riêng (`dvSupport`); `TIME_MODE=realtime` không còn xoá tình huống mở qua cuối tuần (`holdAges`); `market_slump` phương án a áp hiệu ứng cho cả công ty (nhóm cũ luôn rỗng); cuộc họp / buổi truyền lửa đang diễn lúc lưu được xếp lại sau khởi động lại; hoà giải cần đủ 3 người; người trong cuộc không bị gọi vào họp như thành viên — `src/sim/director.ts`, `story.ts`, `scenes.ts`, `src/content/situations.ts`, `src/ai/offline.ts` · docs/04 §10.4, §14, §16.
- [drama] Chuyện mua sắm: vụ mua sắm kết trước 16:40 (bắt đầu quá trễ thì thôi, vụ cũ sót qua đêm bị bỏ); hàng chưa kịp giao lúc hết ngày dời sang 09:30–11:00 sáng mai (trước mất ≈ 1/7 đơn); `shopping_story` không lấy món đã có trên bàn từ ngày đầu; Secret Santa không tặng món người nhận đã có / đã được tặng; thay món trên bàn vẫn giữ quyền sở hữu món cũ; phòng trưng bày dùng giọng "người đã có" khi người khoe sở hữu món — `src/sim/director.ts`, `src/sim/story.ts` · docs/04 §11.
- [ai] Prompt cảnh có sản phẩm: định hướng `showroom_chat` nhường cho khối món (hết bịa "đã xài" khi chưa có món); khối món co theo bậc ngân sách (`prodFacts` / `prodAngle`), bỏ pitch khi đã có `facts`, bỏ "Chuyện" lặp ở showroom, luật rút một câu (khối cũ ~2,2 lần làm gần mọi cảnh có sản phẩm vượt ngân sách); `pep_talk` chỉ còn `BỐI CẢNH: <tên>` (−70–110 token) — `src/ai/prompts.ts`, `prompt-budget.ts`, `src/sim/scenes.ts` · docs/05 §6.3, §6.8 · test:llm 14 (trần khối sản phẩm).
- [ai] Lọc giá trong câu nhắc món: `hasPrice` bắt thêm "5tr7", "1tr2", "199.000₫", "₫199.000", "1.290.000" và không bắt nhầm cụm đếm ("20k view", "10k bước", "1 đồng nghiệp") — `src/ai/sanitize.ts` · docs/05 §8.2 · test:llm 12b.
- [ai] Thoại mẫu offline: câu có cớ đúng ngữ pháp với mọi cớ (cả câu thông báo vụ mua sắm), pitch nói ngắn bằng `spokenPitch` thay vì dán nguyên văn; người đã có món không còn "để trong giỏ hàng hai tuần" (`SR_OPEN_CART`); họp xử lý / truyền lửa không chen câu tám chuyện ngoài lề, bỏ "Dạ, dạ", tối đa 4 người nghe phản ứng — `src/ai/offline.ts` · docs/05 §9.3, §9.5.
- [canvas] [ui] Món trên kệ trên điện thoại / tablet / cửa sổ ≤ 899 px: chạm lần 1 hiện thẻ tên · giá, chạm lần 2 mới mở Shopee (trước: không bao giờ thấy tên / giá, chạm là mở link) — `public/js/render/office.js`, `public/js/ui/products.js`, `public/style.css` · docs/07 §7.11, §9.5, docs/08 §10, §18.
- [canvas] Nhãn phòng không còn đè nhau / bị biển WC đè ở 7–9,4 px/ô (nhãn va chạm thì bỏ, biển WC tính chung qua `wcPill`); HUD đổi cao (chip sự cố hiện / ẩn) không còn kéo camera điện thoại về góc mặc định (`setInsets` bỏ `defaultView`) — `public/js/render/floor.js`, `office.js` · docs/07 §7.2, §7.4, §9.2.
- [ui] Popover đang ghim tự đóng khi `fitHud` ẩn chip của nó (nấc 5 / 6) thay vì nhảy lên đè HUD — `public/js/ui/hud.js` · docs/08 §4.4, §4.6.
- [test] `smoke:story` đếm "chốt" chỉ từ dòng chốt sau cuộc họp (bản cũ đếm cả dòng 🧯 mở cảnh nên xanh oan), thêm kết cục mạch, nhóm hiệu ứng rỗng, `llmVerdictCheck`; `test:llm` thêm phủ định, số thứ tự phương án, `hasPrice`, trần khối sản phẩm — `scripts/smoke-story.ts`, `scripts/test-llm.ts` · docs/11 §4.5–4.6, §6.2.

- [drama] [ai] [canvas] [ui] [test] **Rà soát vòng 3 — kiểm chứng lại chính các bản sửa ở trên** (mỗi bản sửa được một agent thử phá lại, 2026-11-03): 7 bản sửa chưa kín + ~60 lỗi nhỏ, sửa hết (các dòng ngay dưới) · smoke 35, smoke:story 26, test:news 105, test:llm 183, test:router 171 đều xanh; thử đột biến xác nhận test mới bắt được lỗi cũ.
- [ai] Thoại mẫu offline: người **chưa có** món không còn nói "mới mua / xài rồi / xài thấy được thì nói / mai mang cái ở nhà lên" (cảnh thường, nhóm chat, tiệc; phòng trưng bày tách câu nghi ngờ / bênh theo việc người khoe đã có món hay chưa); bỏ câu cụt "Nói chứ từ hồi có…"; câu dự phòng khi không rút được pitch theo chế độ; giữ nguyên tên gọi `short` khi đổi sang văn chat ("không dây" không thành "ko dây") — `src/ai/offline.ts` · docs/05 §9.2–9.3 · test:llm 12c.
- [ai] [drama] Thoại mẫu tình huống: hỏi han nói hướng đã chốt với chính người đó (trước viết thường tên và gọi tên ngôi thứ ba), lời thương lượng riêng cho phương án "thương lượng" của chống đối, mục tiêu cảnh hỏi han khi công ty chưa có hướng không hứa gì; câu đệm họp xử lý / truyền lửa đúng vai, không "triển khai liền" trước câu chốt, câu trả lời không bị cắt khi có người hỏi, câu kết không dính vào câu hỏi — `src/ai/offline.ts`, `src/sim/scenes.ts` (`supportGoal`) · docs/05 §9.3, §9.5, docs/04 §16.3 · test:llm 12c.
- [ai] Verdict: phủ định theo từ ("chưa đủ thuyết phục", "not really convinced" → `unmoved`; "không nghỉ việc nữa" → `stay`), số phương án vượt danh sách đọc như chữ cái; schema dùng `VERDICT_ENUM: Record<Verdict, true>`; Director chỉ tin kết quả truyền lửa khi do AI viết — `src/ai/sanitize.ts`, `src/ai/schemas.ts`, `src/sim/director.ts` · docs/05 §7, §8.2, docs/04 §16.5 · test:llm 10, 12b.
- [ai] Lọc giá: thêm "2 trăm nghìn", số trần ≥ 6 chữ số, "199.000"; cụm đếm có ranh giới từ ("1tr7 view", "300 likes", "3 người xem", "1600 dpi" không phải giá; "390k like new" vẫn là giá), chuẩn NFC; note của AI biên kịch có giá → dùng mô tả thực đơn — `src/ai/sanitize.ts` · docs/05 §8.2, §8.4 · test:llm 12b.
- [ai] Prompt cảnh có sản phẩm: cộng 150 token ngân sách (`PRODUCT_TOKEN_ALLOWANCE`, không dời luật vào system để cảnh không có món khỏi tốn thêm), "Chuyện" không lặp ở mọi chế độ phòng trưng bày, cắt "Chuyện" giữ nguyên ngoặc (cớ, lưu ý an toàn), định hướng phòng trưng bày trỏ đúng "Chuyện quanh món này" — `src/ai/prompts.ts`, `src/ai/prompt-budget.ts` · docs/05 §6.3, §6.8 · test:llm 14.
- [drama] Mạch tình huống chờ cuộc họp / buổi truyền lửa của chính nó (đang chờ hoặc đang diễn, kể cả bản xếp lại sau khởi động) rồi mới đi bước kế — hết "chốt nhanh qua điện thoại" giữa cuộc họp và công bố kết cục trước bài nói; ngày nghỉ lùi cả giờ bước kế (tối đa 5 ngày); karaoke tối thứ Sáu → thứ Hai đi trễ (không "tiêu" vào thứ Bảy) — `src/sim/director.ts`, `src/sim/story.ts`, `src/sim/world.ts` (`officeClosed`), `src/types.ts` · docs/04 §10.4, §10.6, §16.3 · smoke:story 14b, 14f.
- [drama] Chuyện mua sắm: món "vừa săn được" không trùng món người đó đã có (kể cả món được giao / tặng; note AI nêu món đã có → bỏ mạch); bước "vừa mua" không bị bỏ qua; đơn hàng không hụt vào ngày văn phòng đóng cửa, bỏ sau 5 ngày; Secret Santa không tặng món đang chờ giao, hết món thì thử người khác rồi bỏ lọc "vừa nhắc", có dòng khép vụ; vụ mua sắm kết sau 17:30 thì kết lặng lẽ; phòng trưng bày: người có món luôn là người kể — `src/sim/director.ts`, `src/sim/story.ts` · docs/04 §5.8, §7.2, §11.
- [canvas] [ui] Chạm món trên kệ: chạm lần 2 lệch ≤ 24 px vẫn nhận, chạm đúp nhanh không mở link, thẻ tự ẩn sau 8 s hoặc khi camera đổi, chạm vào thẻ cũng mở link, gợi ý theo thiết bị vừa dùng; nhãn phòng sát nhau thu nhỏ trước khi ẩn và không nhấp nháy theo biển WC; thu gọn / mở sidebar không còn làm lệch khung mặc định — `public/js/render/office.js`, `floor.js`, `public/js/ui/products.js`, `public/js/main.js`, `public/style.css` · docs/07 §7.2, §7.11, §9.2, docs/08 §10, §15.
- [canvas] Điện thoại dọc: khung mặc định neo góc trên-trái nên **hai kệ sản phẩm hiện trọn ngay dưới HUD** (trước nằm dưới HUD, phải kéo bản đồ mới chạm được món); camera tự theo người nói thành "camera lười" — đứng ở góc đó, chỉ dịch khi người đang nói sắp ra khỏi khung, nói xong quay về (người xem đã tự kéo / phóng thì theo kiểu cũ) — `public/js/render/office.js` (`homeCam`, `defaultView`, `followCamera`, `setInsets`) · docs/07 §7.2, §7.12 · QA Chrome headless 390×844.
- [sim] Marketing đứng giới thiệu ở phòng trưng bày được tính KPI 0,8 (như sales gọi khách bên cửa sổ) — trước đây tính 0 nên Trâm luôn chịu thiệt vì hay dẫn đoàn đi khoe đồ; giảm một phần lệch KPI theo vai đo được ở `smoke:story` — `src/sim/behavior.ts` (`kpiFactor`) · docs/03 §8.1, docs/11 (khẳng định KPI theo tên: lệch có sẵn từ v3, chi tiết ở câu hỏi mở).
- [test] `test:llm` mục 12c (quét thoại offline sản phẩm 26 món × mọi cớ × 3 loại cảnh, phòng trưng bày, hỏi han / thương lượng, câu đệm họp / truyền lửa) + ca phủ định, số phương án, giá, schema v5, trần prompt nhóm chat / phòng trưng bày; `smoke:story` đếm chốt không giới hạn, từng hạt chốt ≥ số cuộc họp, hiệu ứng `group`/`center` rỗng, lỗi phát sinh trong `llmVerdictCheck` làm đỏ, kiểm `holdAges` — `scripts/test-llm.ts`, `scripts/smoke-story.ts` · docs/11 §4.6, §6.2.

### Xoá
- [content] 18 sản phẩm mẫu (bản lưu tạm ngoài repo).

### Vận hành
- [deploy] Đưa lên corp.vibe-coder.fun từ commit `fd8dbf1` (2026-11-03, `bash deploy/deploy.sh`, không `--setup`): khôi phục đúng trạng thái (ngày 94), tự đổi "món đồ trên bàn" của 10 nhân viên theo danh mục 26 món, nạp đủ Gemini → Groq → Cloudflare, không lỗi khởi động; trang chủ có đủ thẻ Open Graph, `og-image.jpg` trả 200. Bài đã đăng Facebook trước đó cần bấm "Scrape Again" ở Sharing Debugger để lấy ảnh xem trước mới.

### Tài liệu
- [docs] Quy ước thông điệp commit đổi sang **tiếng Anh** theo yêu cầu chủ dự án (CLAUDE.md §5, AGENTS.md, docs/14 §7); các ghi chú "tên model Groq lệch giữa `.env.example` và README" trong docs/01/05/09/10/11/12/13 đánh dấu đã thống nhất; bỏ các câu đếm số commit (mau lỗi thời).
- [docs] Đẩy bộ tài liệu lên GitHub công khai `github.com/Hao2505/office-ai`.
- [docs] docs/04 §11 (chuyện mua sắm, đánh số lại §12–§15) và §16 (tình huống công ty); ADR-28 (ảnh chia sẻ), ADR-29 (co chữ theo cỡ bản đồ, HUD co theo chỗ trống), ADR-30 (sản phẩm có cớ, giá bằng cảm nhận), ADR-31 (AI chốt cách xử lý tình huống); cập nhật 01, 02, 03, 05, 07, 08, 09, 10 §7.6, 11, 13, 14 (công thức §3.10 "thêm một tình huống công ty"), docs/README.md (bảng ánh xạ), README §5 / §6.6, ghi chú lỗi thời SPEC.md.
- [docs] Tài liệu cho các bản sửa rà soát 2026-11-03: docs/04 (§10.4, §11, §14, §16; câu hỏi mở đánh số lại — bỏ câu 20 đã xong, 21–27 → 20–26, thêm 27–29), 05, 07, 08, 09 §5, 11, 13 (#1c; tham chiếu câu hỏi của docs/04 đã sửa theo số mới).
- [docs] Tài liệu cho rà soát vòng 3: docs/02 (dòng verdict), 04 (§5.8, §7.2, §10.4, §10.6, §11.2–11.8, §16.3–16.8; câu hỏi 27–28 sửa, thêm 30), 05 (§6.3, §6.8, §7, §8.2, §8.4, §9.2–9.5, câu hỏi `spoken`), 07 (§7.2, §7.11, §9.2, câu hỏi 22), 08 (§10, §15, QA 5b), 09 (§5 trường `spoken`, timer giao hàng `since`), 11 (§4.6 14b/14d/14e/14f, §6.2 12b/12c/14, số khẳng định), 13 (#1d, §2.2).

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
