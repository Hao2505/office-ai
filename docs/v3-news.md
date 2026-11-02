# V3 — Nhân vật bàn chuyện thời sự (tin thật từ báo, an toàn pháp lý)

Yêu cầu của chủ dự án: lâu lâu nhân vật bàn về tin hot thế giới/ngành game, công nghệ, thể thao, bóng đá, drama giải trí…
cho đa dạng. **Chỉ bàn tán, không vu khống, không bịa đặt.**

## Nguyên tắc an toàn
1. **Chỉ bàn tin thật**: tin lấy từ RSS báo chính thống; feed luôn hiện **thẻ tin gốc** (tiêu đề, nguồn, link bài) để người xem tự kiểm chứng.
2. **AI không được thêm "sự thật" mới**: prompt quy định rõ — chỉ bình luận cảm nghĩ/ý kiến cá nhân về nội dung tiêu đề + mô tả;
   không bịa chi tiết, con số, phát ngôn; không kết luận ai đúng/sai, không gán tội, không nói về đời tư; dùng "nghe báo X đăng…",
   "theo mình thì…"; được khịa nhẹ, đùa về *tình huống*, không công kích cá nhân thật.
3. **Lọc chủ đề**: danh sách chặn theo từ khóa (án, khởi tố, bắt giữ, bị bắt, cáo buộc, tù, ma túy, giết, hiếp, lừa đảo, tự tử, tai nạn chết,
   chất cấm, nguy kịch, tang sự, chính trị (Trump, Nhà Trắng, Putin, Giáo hoàng…), đảng, bộ trưởng, chủ tịch nước, quốc hội, tôn giáo, biểu tình,
   chiến tranh, không kích, khủng bố, ly hôn, hôn nhân, ngoại tình, tiểu tam, kiện (mẫu "kiện" trừ sự kiện / điều kiện / linh kiện…), tố (mẫu "tố"
   trừ yếu tố / nguyên tố…), sa thải, từ chức, bóc phốt, scandal, cơ thể / nội y / lộ hàng / cảnh nóng, sàm sỡ, tẩy chay, miệt thị…) → bỏ tin.
   Thêm lớp **hạnh kiểm người thật** (bị chỉ trích, bị ném đá, bị đồn, rộ tin, nghi vấn, gây tranh cãi, khẩu chiến, thất tình, nợ nần, sắc vóc…)
   cho mọi tin giải trí và cho tin thể thao / game / công nghệ / khoa học có nhắc tới một con người; tin về vợ / chồng / con của người nổi tiếng
   = đời tư. Drama giải trí chỉ cho phép loại nhẹ (phim, nhạc, show, gameshow, thời trang, làm đẹp, trend — từ khoá phải nằm ở **tiêu đề**) và có
   công tắc `NEWS_ALLOW_SHOWBIZ` (mặc định bật, lọc chặn vẫn áp dụng). Sau lớp lọc: prompt cấm đoán động cơ / nâng mức dè dặt của báo; sanitize
   bỏ câu phán xét người có tên trong tin, câu lẫn chữ Hán / Hàn / tiếng Anh nguyên câu; ký ức cảnh thời sự theo mẫu "Bàn tin … (nguồn)".
4. Mỗi tin chỉ dùng 1 lần; không bàn tin cũ hơn 3 ngày.

## Nguồn RSS (đã kiểm tra 2026-11-01, không cần key)
| Nhóm | URL |
|---|---|
| the_thao | https://vnexpress.net/rss/the-thao.rss, https://tuoitre.vn/rss/the-thao.rss, https://thanhnien.vn/rss/the-thao.rss |
| cong_nghe | https://vnexpress.net/rss/so-hoa.rss, https://tuoitre.vn/rss/nhip-song-so.rss |
| game | https://gamek.vn/home.rss |
| khoa_hoc | https://vnexpress.net/rss/khoa-hoc.rss |
| giai_tri | https://vnexpress.net/rss/giai-tri.rss, https://tuoitre.vn/rss/giai-tri.rss, https://thanhnien.vn/rss/giai-tri.rss |

Bóng đá nằm trong the_thao (lọc tiêu đề có từ khóa: bóng đá, V-League, Ngoại hạng, Champions League, World Cup, tuyển Việt Nam…)
→ gắn nhãn phụ `bong_da`. Cấu hình `NEWS_FEEDS` (danh sách `nhom|url`), `NEWS_ENABLED=true`, cập nhật mỗi 30–60 phút
(`NEWS_REFRESH_MINUTES`), parse RSS 2.0 bằng regex/XML tối giản (không thêm thư viện), bỏ HTML trong description, lưu ~40 tin
mỗi nhóm trong bộ nhớ + persist; lỗi mạng → giữ tin cũ, không chết.

## Mô phỏng & đạo diễn
- Cảnh mới `news_chat` (🗞️ "Tám chuyện thời sự"): 2–4 người ở pantry / góc chill / nhóm chat kín; **tần suất** tối đa 1 lần mỗi
  `NEWS_SCENE_MIN_MINUTES` (mặc định 25 phút thật), xen kẽ nhóm tin, ưu tiên nhóm hợp sở thích người tham gia
  (roster `likes`: Tùng crypto/game, Bảo game, Phát bóng đá, Trâm trend/showbiz, Khoa công nghệ, Linh phim/thời trang…).
- `SceneRequest.news = { id, title, summary (≤ 200 ký tự), source, url, category, publishedAt }`; prompt direction riêng cho news_chat
  (nguyên tắc an toàn ở trên); 4–8 câu; hiệu ứng: mood, relationship nhỏ, memory.
- Tin cũng len vào pantry_chat/lunch (1/3 số lần, theo nhịp `NEWS_SCENE_MIN_MINUTES`) — đi đúng đường `SceneRequest.news` (thẻ TIN + luật
  trong prompt, lưới an toàn của sanitize, thẻ tin + nguồn trên giao diện, `markUsed`), không qua `topicHint` dạng chữ.
- Offline (không AI): template "Ê thấy tin X chưa?" / "Báo Y đăng đó" / phản ứng theo nhóm tin, không thêm chi tiết.

## Giao diện
- Thẻ cảnh news_chat có **thẻ tin**: 🗞️ tiêu đề · Nguồn (VnExpress) · "Đọc bài ↗" (link gốc, rel="noopener"). Dòng thoại như thường.
- Tab 📰 Bản tin có mục nhỏ "Tin văn phòng đang bàn" (5 tin gần nhất) — tuỳ chọn.
- Ghi chú chân trang: "Nhân vật AI chỉ bình luận cảm nghĩ về tin đã đăng trên báo; không phải phát ngôn hay sự thật được xác nhận."

---

# V3 — Câu chuyện tự phát triển (không kịch bản, AI quyết định, vẫn hợp lý)

Yêu cầu: tình huống phải **ngẫu nhiên tự nhiên**, AI tự xử lý và đi theo nhiều hướng, không có mạch "cảnh cáo → đuổi Tú → tuyển mới" cố định.

## Hiện trạng (v1/v2)
- HR theo luật cứng: lowStreak ≥ KPI_WARN_DAYS → cảnh cáo; ≥ KPI_FIRE_DAYS (đã cảnh cáo) → đuổi (src/sim/hr.ts, director.ts).
- Tú được đặt diligence 0.3 / laziness 0.8 → luôn là người bị đuổi đầu tiên (ngày 4–7). Phải bỏ.

## Thiết kế
1. **Không ai bị đánh dấu trước**: lần khởi tạo đầu, mỗi trait = giá trị roster ± ngẫu nhiên 0.15 (Tú về mức bình thường ~0.5/0.5),
   lưu lại (persist). Mỗi ngày mỗi người có "hệ số ngày" ngẫu nhiên (0.75–1.2) + sự kiện cá nhân ngẫu nhiên hiếm
   (bệnh, kẹt xe, thất tình, khách chửi, trúng số nhỏ…) ảnh hưởng KPI/mood, có log để người xem hiểu.
2. **Tính cách trôi** (bounded, ±0.02–0.05/ngày): bị nhắc nhở → diligence +; sếp vắng nhiều & không bị bắt → laziness +;
   được khen/thưởng → ambition +, mood baseline +; bị khịa nhiều → temper +. Persist.
3. **AI quyết định nhân sự** (thay luật cứng): cảnh `hr_review` (HR + sếp, phòng sếp) định kỳ mỗi 3 ngày game hoặc khi có người
   lowStreak ≥ 2 / warnings ≥ 1 / mood < 25 nhiều ngày / doanh thu lệch mạnh. Prompt đưa: lịch sử KPI 7 ngày, số lần bị bắt lười,
   thái độ (memories), quan hệ với sếp/HR, doanh thu, số người. AI trả `decisions[]` mỗi quyết định ∈
   {warn, fire, second_chance, probation, praise, bonus, promote, open_position, layoff, none} + lý do 1 câu.
   **Hàng rào hợp lý** (code): không fire người lowStreak < 2 hoặc hiredDay < 3 ngày; không promote/bonus 2 người cùng tuần
   (`lastPromotionDay` / `lastBonusAnyDay` toàn công ty ≥ 7 ngày); layoff chỉ khi doanh thu < 50% mục tiêu 2 kỳ, không cắt người vào
   chưa đủ 10 ngày, ≤ 2 đợt / tháng game, không tuyển thay / tuyển lại chừng nào còn kỳ kém; tối đa 1 fire / 2 ngày (tính từ lúc cảnh
   cho nghỉ diễn xong; cảnh không diễn được thì hoãn sang sáng mai, không bỏ lặng lẽ). Quyết định hợp lệ mới thi hành → cảnh tương ứng.
4. **Nhiều hướng kết thúc / phát triển**: `resign` (nhân viên xin nghỉ khi mood < 25 & ghét sếp ≥ 3 ngày — AI quyết "ở lại/đi" trong cảnh
   nói chuyện với HR), `raise_request`, `promotion` (đổi roleLabel/kpiTarget), `open_position` khi lãi (tuyển thêm người thứ 11, bàn trống),
   `layoff` khi lỗ, `comeback` (người cũ quay lại làm khách hàng/đối thủ trong cốt truyện), `headhunt_rumor`.
5. **AI biên kịch (showrunner)**: mỗi ~2 giờ game 1 call rẻ: input = tình hình (KPI, quan hệ nổi bật, mạch đang mở, tin đồn, dự án, doanh thu,
   tin thời sự nếu có), output = 1–3 "beat" cho vài giờ tới chọn từ menu + tham số (ai, với ai, mức độ), vd `conflict(khoa, phat, 'khách đòi tính năng')`,
   `viral(tram)`, `big_bug(vy→tung)`, `client_angry(bao)`, `secret_friendship(linh, vy)`. Director thi hành thành cảnh/sự kiện. Sổ mạch
   (`arcs[]`: id, trạng thái started→escalated→resolved, người liên quan, ngày) để kéo dài nhiều ngày, tránh lặp; mỗi beat có xác suất,
   không bắt buộc thực hiện (nếu điều kiện không còn hợp lý thì bỏ).
6. Offline (không AI): giữ luật cũ như fallback nhưng có ngẫu nhiên (xác suất thay vì ngưỡng cứng).
7. Smoke test không ép Tú; chỉ kiểm tra "trong 10 ngày có ≥ 1 quyết định nhân sự hợp lệ" và không vi phạm hàng rào.

# V3 — Lưu trữ dài hạn
- Giữ snapshot JSON (nhỏ, có trần) cho trạng thái sống; lưu mỗi 60 s (cân nhắc 15 s) + khi tắt.
- Thêm **archive nối tiếp** `data/history/YYYY-MM-DD.jsonl` (mọi dòng thoại, sự kiện, bản tin, quyết định nhân sự, beat); xoay theo ngày,
  gzip sau 7 ngày, tự xóa sau `HISTORY_KEEP_DAYS` (mặc định 180). ~50 KB/ngày. Dùng cho trang "Lịch sử công ty", highlight, thống kê.
- Khi có tài khoản người xem / vote / cược: chuyển sang SQLite (node:sqlite ở Node 22+) hoặc Postgres.
