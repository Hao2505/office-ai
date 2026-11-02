# Vòng làm đẹp giao diện — yêu cầu của chủ dự án

Tiêu chuẩn chung: **cẩn thận, trực quan, rõ ràng, đẹp — không làm cho có.** Nhân vật phải đầy đủ bộ phận,
nhìn ra ai là ai ngay. Chụp màn hình để tự duyệt trước khi báo xong.

## 1. Bỏ thanh trên cùng (top bar), đưa thông tin vào thẳng khung văn phòng
Thanh trên hiện chiếm quá nhiều chỗ. Thay bằng:
- **HUD mỏng nổi trên canvas** (trong suốt mờ, cao ~30px, góc trên trái/phải của khung văn phòng):
  - Góc trái: đồng hồ `10:00 · Thứ Sáu · Ngày 5` + tốc độ `x10` + thanh tiến độ ngày mảnh.
  - Góc phải: các icon nhỏ, rê chuột/bấm mới xổ chi tiết: 👔 sếp (có mặt / đi vắng + lý do), 🚀 dự án (% + hạn),
    💰 doanh thu tháng, 👀 số người xem, 🤖 AI (nguồn đang dùng, số lượt, chi phí, dự phòng). Khi có sự cố (sập server,
    mất wifi) hiện badge đỏ.
- **Thông tin "trong thế giới" (diegetic)** để không cần chữ ngoài khung:
  - Đồng hồ treo tường trong văn phòng chạy theo giờ game.
  - Bảng trắng phòng họp ghi tên dự án + % tiến độ + hạn.
  - Bảng doanh thu/KPI trên tường (đã có bảng KPI) thêm dòng doanh thu tháng.
  - Cửa phòng giám đốc: biển "ĐANG HỌP/ĐI VẮNG: lý do" khi sếp vắng (đã có dạng dim + sign, làm rõ hơn).
- Tên công ty + tagline chuyển xuống đầu sidebar (nhỏ) hoặc thành logo mờ ở góc canvas.
- Mobile: HUD gọn thành 1 hàng icon.

## 2. Nhân vật
- Hiện quá nhỏ (~1 ô ≈ 19px ở màn 1600px). Cần to rõ: cao ~1.8–2 ô, đầu to kiểu chibi, mắt/miệng/tóc/phụ kiện nhìn thấy
  ở mức zoom mặc định. Có thể tăng kích thước ô mặc định (map 60×34 vẫn vừa khung) hoặc vẽ nhân vật lớn hơn ô.
- Khi ngồi quay lưng (nhìn màn hình) vẫn phải nhận ra ai: màu tóc/kiểu tóc/áo/phụ kiện đặc trưng, tên dưới chân rõ.
- Bug: có lúc nhân vật và tên bị mờ nửa trong suốt (ảnh docs/preview/preview-2-chieu.png lúc 14:07 cả văn phòng nhạt).
  Tìm nguyên nhân (fade khi đi? tint ban ngày? alpha khi không có ai xem?) và sửa.

## 3. Khác
- Chữ trên bảng KPI quá bé, không đọc được.
- Feed "Trực tiếp": 2 cảnh chạy song song (1 văn phòng + 1 chat nhóm) bị xen kẽ dòng, khó theo dõi → gom theo cảnh
  (thẻ cảnh có các dòng bên trong) hoặc tách cột/màu nền rõ.
- Chip AI ghi "GPT …" dù đang dùng Gemini/Groq → ghi "AI · gemini-3.5-flash-lite" và hiện nguồn dự phòng
  (UsageStats.activeProvider / providers — xem src/types.ts sau khi router xong).
- Ảnh tham chiếu hiện trạng: docs/preview/preview-1-sang.png, docs/preview/preview-2-chieu.png.

## 4. Sidebar bên phải (khung chat) gọn lại nhưng đủ thông tin
- Hẹp lại (~320px thay vì ~400px), có **tay kéo đổi độ rộng** (nhớ trong localStorage) và nút **thu gọn hẳn**
  (ẩn sidebar → khung văn phòng tràn màn hình; khi ẩn, hiện 1 dải "ticker" mỏng ở đáy canvas chạy 2–3 dòng thoại mới nhất).
- Dòng chat dày hơn: avatar 22–24px, tên + vai trò + giờ trên 1 dòng nhỏ, nội dung ngay dưới, padding nhỏ, bớt viền/bóng.
- Gom theo cảnh: 1 thẻ cảnh (icon + tiêu đề + nơi + người tham gia) chứa các dòng thoại bên trong, không lặp header.
  Thẻ cảnh cũ tự thu gọn còn 1 dòng tóm tắt (bấm để mở).
- Sự kiện (sếp về, chốt deal, HR…) thành pill 1 dòng, nhỏ.
- Tab: icon + nhãn ngắn, thanh lọc kênh thành dropdown hoặc chip nhỏ 1 hàng.
- Chip sản phẩm affiliate nhỏ gọn 1 dòng (emoji + tên + "Xem Shopee ↗"), vẫn ghi "Link tiếp thị liên kết".
- Giữ nguyên lượng thông tin: tên, vai trò, kênh (văn phòng / nhóm kín / nhóm cty), giờ, emoji, sản phẩm, sự kiện.

## 5. Đổi tên công ty: "Cty TNHH VibeCorp"
- Đã đổi: .env (COMPANY_NAME), src/content/*, src/sim/scenes.ts, src/ai/offline.ts.
- Còn phải đổi chuỗi mặc định/fallback khi các workflow đang chạy xong: src/config.ts, src/ai/prompts.ts, README.md,
  SPEC.md, .env.example, public/js/render/office.js + floor.js (logo sàn mặc định 'CODE & BÁN' → 'VIBECORP').

## 6. Thay phòng WC bằng PHÒNG TRƯNG BÀY SẢN PHẨM (showroom affiliate)
Chủ dự án sẽ đưa sản phẩm thật mình đã mua và đang dùng (thấy tốt) vào đây; mỗi sản phẩm có link Shopee affiliate.
- **Bản đồ** (src/sim/map.ts): phòng WC hiện tại (x1..8, y1..6, cửa (4,7),(5,7)) → phòng `showroom` "Phòng trưng bày".
  Hai kệ dọc tường trên: **kệ Làm đẹp** (x1..4, y1) và **kệ Công nghệ** (x5..8, y1), mỗi kệ 4–6 ô sản phẩm.
  Điểm đứng ngắm hàng: `showroom_beauty: (2,3),(3,3)`, `showroom_tech: (6,3),(7,3)`; thêm bàn trưng bày nhỏ giữa phòng nếu đẹp.
  Bỏ toilet/sink khỏi FURNITURE.
- **WC chỉ còn 1 cánh cửa** ở chỗ hợp lý: hốc giữa phòng server và phòng họp (x19..22, y1..7) → tường kín, cửa ở (20,7)/(21,7)
  có biển "WC"; SPOTS.toilet = ô đứng trước cửa (20,8),(21,8). Khi tới nơi, nhân vật "vào trong": ẩn khỏi canvas
  (FrameAgent flag bit 8 = hidden) + cửa hiện "Có người", hết giờ thì xuất hiện lại trước cửa. Tủ locker dời chỗ khác.
- **Dữ liệu sản phẩm** (data/products.json): thêm `category: 'lam-dep' | 'cong-nghe'`, `shelf: 'beauty' | 'tech'`,
  `slot` (vị trí trên kệ), `note` (1 câu chủ dự án nhận xét: "mình đang xài, pin trâu…"), `image?` (URL ảnh tuỳ chọn),
  giữ emoji/priceHint/url. Trước mắt 2 nhóm × 4–5 sản phẩm placeholder, chủ dự án sẽ thay bằng đồ thật + link aff.
- **Giao diện**: vẽ 2 kệ có sản phẩm (emoji/icon, có nhãn nhỏ), rê chuột → tooltip tên + giá + "Xem trên Shopee ↗",
  **click sản phẩm trên kệ → mở `/go/<id>?src=showroom` tab mới** (rel="noopener sponsored"). Thêm tab sidebar
  **🛍️ Sản phẩm** liệt kê theo 2 nhóm với note của chủ dự án + nút mua; ghi rõ "Link tiếp thị liên kết".
  Sản phẩm gửi xuống client trong `hello.products` (ProductPublic + category + shelf + note + emoji + priceHint).
- **Mô phỏng**: hoạt động mới `showroom` (đi ngắm đồ): trọng số nhỏ (0.08; marketing 0.25; mood < 40 thêm 0.1), 6–12 phút,
  emote 🛍️, đứng ở ô kệ tương ứng (nữ hay ghé kệ làm đẹp hơn, dev hay ghé kệ công nghệ hơn nhưng không tuyệt đối).
- **Đạo diễn**: cảnh mới `showroom_chat` (2–3 người đang ở showroom): một người giới thiệu món mình đang xài, người kia
  hỏi/khịa/so sánh, **đúng 1 câu product=true** gắn chip sản phẩm trong feed; tần suất tối đa 1 lần/30–45 phút thật,
  ưu tiên khi có ≥ 2 người cùng ở showroom; dùng `note` của chủ dự án làm chất liệu để lời giới thiệu thật và cụ thể.
  Các cảnh khác (pantry, lunch, group chat) vẫn có thể nhắc sản phẩm như hiện tại.
- Thống kê click theo sản phẩm đã có ở GET /api/stats (src=showroom / scene / desk / sidebar).

## 7. ✅ ĐÃ XONG (2026-11-01, chủ dự án duyệt) — Nhân vật nhìn ngang (trái/phải) vẽ lại: profile 1 mắt + mũi + tai, tóc 8 kiểu, thân hẹp, tay gần vẽ TRƯỚC đầu (không đè mặt), chân xoay quanh hông, ngồi đùi đưa trước. Ảnh: docs/preview/v2/nhan-vat-nhin-ngang.png

### (ghi chú gốc)
## 7. NHÂN VẬT NHÌN NGANG (trái/phải) ĐANG LỖI — chủ dự án yêu cầu "làm lại thật đẹp, mượt"
Ảnh lỗi do chủ dự án chụp: docs/preview/bug-nhan-vat-nhin-ngang.png (Ngọc đứng, Trâm ngồi quay ngang).
Lỗi thấy được: khi quay ngang, mặt vẫn vẽ như nhìn thẳng (2 mắt, miệng giữa) → cổ như bị vặn; tóc/nơ lệch khỏi đầu;
thân, tay, chân không ra dáng nhìn ngang; đầu lệch so với thân; tư thế ngồi ngang xấu.
Yêu cầu:
- Góc nhìn ngang đúng kiểu chibi: đầu nhìn nghiêng (profile hoặc 3/4): 1 mắt lớn phía trước (mắt xa ẩn hoặc chỉ ló 1 phần),
  gò má/mũi nhỏ nhô ra phía trước, miệng lệch về phía mặt; tóc có mái phía trước và khối tóc phía sau đúng kiểu tóc
  (dài/bob/búi/đuôi ngựa/xù/ngắn/hói/dựng); phụ kiện đặt đúng chỗ khi nghiêng: kính (gọng ngang + càng), tai nghe (vành qua đỉnh đầu + 1 củ loa),
  nơ/cà vạt/nón đều theo góc nghiêng.
- Thân nhìn ngang hẹp hơn thân nhìn thẳng (khoảng 70–75%), tay gần vẽ trước thân, tay xa vẽ sau thân (tối màu nhẹ), chân so le khi đi,
  giày hướng về phía đang nhìn. Ngồi ngang: đùi đưa ra phía trước, cẳng chân gập xuống, lưng hơi dựa ghế, ghế vẽ nhìn ngang.
- Vẽ hướng phải bằng cách lật gương hướng trái (một bộ code) để hai bên luôn giống nhau.
- Đồng nhất tỉ lệ 4 hướng (xuống/lên/trái/phải): cùng bán kính đầu, cùng chiều cao, cùng vị trí chân → khi xoay người không "nhảy" kích thước.
- MƯỢT: đổi hướng không giật (có 1 khung chuyển/ease ngắn ~120ms hoặc ít nhất không nháy vị trí); nhịp đi đều, thân nhún nhẹ theo bước,
  tay vung đối xứng với chân; nội suy vị trí giữa các frame mượt; khi ngồi xuống/đứng lên không nhảy ảnh.
- Tự kiểm tra bằng ảnh phóng to 2× cho cả 4 hướng × đứng/đi/ngồi của ≥ 4 nhân vật khác kiểu tóc/phụ kiện, so với ảnh lỗi ở trên.

## 8. ✅ ĐÃ DEPLOY 2026-11-01 20:15 — https://corp.vibe-coder.fun (VPS riêng — địa chỉ trong deploy/vps.env, /opt/vibecorp, pm2 "vibecorp" user deploy, cổng 3200, nginx + Let's Encrypt hết hạn 2027-01-30, Cloudflare proxy). Cập nhật: `bash deploy/deploy.sh`. Admin: mở trang kèm `#dev=<DEV_TOKEN trong deploy/.env.production>`.

### (ghi chú gốc)
## 8. Deploy (sau khi xong hết) — xem deploy/deploy.sh
VPS dùng chung (Ubuntu 24.04, 1 CPU, 2 GB, nginx + certbot + pm2 user `deploy`, cổng 3000 đã bận). App chạy ở /opt/vibecorp,
cổng 3200, pm2 "vibecorp", nginx site corp.vibe-coder.fun (Cloudflare proxy phía trước → SSL mode Full). Lần đầu: `bash deploy/deploy.sh --setup`.
Cần thêm cho production: DEV_PANEL tắt ngoài, nhưng chủ dự án vẫn cần điều khiển → thêm `DEV_TOKEN` (bảng dev chỉ hiện khi mở ?dev=<token>).

## 9. ✅ Thanh HUD: bỏ thông tin hệ thống (2026-11-01, theo yêu cầu chủ dự án)
- Bỏ chip "👔 Sếp có mặt / Vắng" (biển ĐI VẮNG trên phòng Giám đốc vẫn còn), bỏ chip 🤖 AI (nguồn, lượt gọi, token, chi phí, lỗi),
  bỏ nhãn "AI chấp bút / Bản tin mẫu" ở tab Bản tin, bỏ 2 dòng "lượt bấm link tiếp thị liên kết" và "Càng đông người xem…" trong popover 👀.
- Thêm 1 chấm nhỏ cạnh TRỰC TIẾP: xanh = AI đang viết thoại (status.ai.mode === 'llm'), xám = câu thoại mẫu. Chỉ chủ dự án cần biết, không lộ chi tiết.
- Thống kê hệ thống chỉ còn ở GET /api/stats và bảng dev (DEV_TOKEN).
- Tựa ghế khi ngồi quay lưng: màu xám sáng hơn quần + nan lưới (render/furniture.js) để không nhìn nhầm thành chân đang đứng.
