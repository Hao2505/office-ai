# V2 — ghi chú content / drama / AI text (ĐÃ MERGE vào SPEC.md)

Toàn bộ nội dung của file này đã được gộp vào `SPEC.md` ở bước tích hợp v2 (01/11/2026):

- §1.1 — exports mới của `src/content/products.ts` (`SHELF_OF_CATEGORY`, `CATEGORY_OF_SHELF`, `SHELF_SLOTS`, `getShelfProducts`,
  `pickShelfProduct`, `getShowroomProducts`), chuẩn hoá `Product` sau khi đọc file, catalogue mẫu 16 món, desk item của roster.
- §2 — tên công ty "Cty TNHH VibeCorp" ở mọi nơi (`CONFIG`, `prompts.ts`, `COMPANY_INFO`, `COMPANY_CHAT_LABEL`, `.env.example`).
- §4 — hàng `showroom` và `toilet` (v2) trong bảng hoạt động.
- §5.1 — hàng `showroom_chat` + đoạn "showroom_chat situation" (`sitShowroom`).
- §5.2 — cảnh tự phát / theo lịch / cap riêng / người `hidden` / `COUNTED.showroom`.
- §5.5 — trường v2 trong `data/products.json`, cách chọn món, nguồn click.
- §6.3 — `SCENE_DIRECTION.showroom_chat`, đoạn SẢN PHẨM riêng, offline `bShowroom`.
- §7 — `/api/stats` (click theo sản phẩm × nguồn, chi tiết provider).

Nguồn sự thật: `SPEC.md` + `docs/v2-contract.md`. Không cần sửa file này nữa.
