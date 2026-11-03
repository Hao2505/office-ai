# Mô phỏng thế giới (World) — lõi "thân xác" 0 token

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: `src/sim/world.ts`, `src/sim/behavior.ts`, `src/sim/map.ts`, `src/sim/clock.ts`, `src/sim/persist.ts`, `src/sim/showroom.ts`, `src/sim/archive.ts` và phần liên quan của `src/types.ts` · Đọc khi: cần hiểu/sửa đồng hồ game, di chuyển, lịch trong ngày, hoạt động & nhãn, KPI, tính cách, sếp, sự cố, dự án/doanh thu, lưu/khôi phục `data/state.json`, lưu trữ JSONL dài hạn, gói tin gửi client, hoặc khi Director/HR/AI cần gọi vào World.

Tài liệu này trả lời: "World làm gì mỗi tick, giữ trạng thái gì, ra quyết định theo công thức nào, và thứ gì sống/chết qua một lần khởi động lại?". World là lớp **không tốn token**: mọi thứ ở đây là số học + bảng trọng số; lớp "kịch bản" (Director, HR, AI biên kịch) nằm ở [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) và chỉ nói chuyện với World qua `WorldApi`/`DirectorApi`. Giao thức WebSocket và cách server bọc World xem [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md); biến môi trường đầy đủ xem [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md); test xem [11-kiem-thu-qa.md](11-kiem-thu-qa.md). Hợp đồng gốc vẫn là `SPEC.md` §3 (time model), §4 (body layer), §10.3 (archive), §10.4 (World v3) và `src/types.ts`; `docs/v2-contract.md` §1/§3 (bản đồ v2, hoạt động/frame), `docs/v3-news.md` ("Câu chuyện tự phát triển", "Lưu trữ dài hạn") là thiết kế gốc — tài liệu này mô tả **code hiện tại**, chỗ nào SPEC lệch code sẽ ghi rõ.

---

## 1. Bức tranh chung và cách nối dây

| File | Dòng | Vai trò một câu |
|---|---|---|
| `src/sim/world.ts` | 3233 | Lớp `World implements WorldApi`: đồng hồ, nhân viên, di chuyển, lịch ngày, KPI, sếp, công ty, xuất gói tin, lưu/khôi phục |
| `src/sim/behavior.ts` | 515 | Dữ liệu + hàm thuần: bảng hoạt động, hiệu ứng/phút, công thức KPI, trọng số utility, nhãn/emote, hướng nhìn, lộ trình tuần |
| `src/sim/map.ts` | 203 | Bản đồ lưới 60×34 tĩnh: phòng, bàn, chỗ đứng, tường/cửa, BFS `findPath` |
| `src/sim/clock.ts` | 48 | Hằng số thời gian + chuyển đổi (giờ VN UTC+7, thứ, ban đêm) — không giữ trạng thái |
| `src/sim/persist.ts` | 82 | Ghi JSON nguyên tử, đọc, cách ly file hỏng, validators khi khôi phục |
| `src/sim/showroom.ts` | 118 | Dựng `hello.products` (sản phẩm trên 2 kệ) từ `src/content/products.ts` |
| `src/sim/archive.ts` | 480 | Lưu trữ dài hạn JSONL theo ngày VN, hàng đợi không chặn tick, gzip/xoá, đọc lại |

Thứ tự nối dây thật trong `src/server.ts:244-253` (bắt buộc giữ nguyên thứ tự):

1. `getArchive().configure({ enabled: CONFIG.historyEnabled, dir, keepDays, gzipAfterDays }).start()` — archive bật **trước** khi dựng World để dòng log đầu tiên cũng được lưu.
2. `createBrain(CONFIG)`.
3. `new World({ config: CONFIG, brain, emit: broadcast })` — constructor gọi `freshInit()` ngay (`world.ts:473`): văn phòng mới (đội hình, dự án, `planDay(1)`) luôn được dựng trước, kể cả khi ngay sau đó sẽ khôi phục từ file.
4. `new Director(world, brain)` rồi `world.attachDirector(director)`.
5. `if (CONFIG.persist) world.load()` — thay văn phòng mới bằng bản khôi phục.
6. `world.start()` — `setInterval(tick, TICK_MS = 100)`.
7. `getNews().start()` nếu `NEWS_ENABLED`.
8. `setInterval(() => world.save(), SAVE_EVERY_MS = 60_000)`; khi SIGINT/SIGTERM: `world.stop()` → `news.stop()` → `world.save()` → `archive.stop()` (ghi nốt hàng đợi đồng bộ).

```
            ┌────────────── src/server.ts ──────────────┐
            │ HTTP /go/:id → world.recordClick           │
            │ /api/health, /api/stats, /api/history      │
            │ WS: hello (ghi đè dev/publicStatus)        │
            └───────▲───────────────────┬────────────────┘
          emit(msg) │                   │ handleClient / setViewers
   ┌────────────────┴───────────────────▼─────────────┐
   │ World (src/sim/world.ts)                          │
   │  map.ts  behavior.ts  clock.ts  showroom.ts       │
   │  persist.ts (save/load)   archive.ts (singleton)  │
   │  ../news/store.ts getNews() (recent/serialize)    │
   └───▲───────────────────────────────┬───────────────┘
       │ DirectorApi (tick, onDayStart… bọc try/catch)
       │                               │ WorldApi (+ v3 duck-typing)
   ┌───┴───────────────────────────────▼───────────────┐
   │ Director (director.ts) → Brain (ai/brain.ts)      │
   └───────────────────────────────────────────────────┘
```

Mọi lời gọi từ World sang Director đi qua `callDirector()`/`askDirector()` (`world.ts:2903-2923`) — bọc try/catch và ghi lỗi có giới hạn tần suất (`reportError`, 1 dòng/10 s mỗi loại, `world.ts:2937-2944`). Director hỏng không làm World dừng.

---

## 2. Thời gian: `clock.ts` và đồng hồ trong World

### 2.1 Hằng số và tiện ích (`src/sim/clock.ts`)

| Tên | Giá trị | Ý nghĩa |
|---|---|---|
| `MIN_PER_DAY` | 1440 | phút game một ngày |
| `DAY_START` | 450 (07:30) | giờ "mở cửa" mỗi ngày ở chế độ nén |
| `ALLOWED_SPEEDS` | `[1, 2, 5, 10]` | hệ số tua cho phép |
| `WEEKDAYS_5` | Thứ Hai…Thứ Sáu | chế độ nén không có cuối tuần |
| `WEEKDAYS_7` | Chủ Nhật…Thứ Bảy | theo `Date.getUTCDay()` (0 = Chủ Nhật) |
| `VN_OFFSET_MS` | 7 h | UTC+7 cố định, không giờ mùa hè |

- `hm(h, m)` → phút trong ngày; `fmtClock(minute)` → `'HH:MM'` (chịu được float/âm) (`clock.ts:18-24`).
- `vnWall(ms)` → `{ epochDay, minute, dow }` theo giờ VN; `dow = (epochDay + 4) % 7` vì 1970-01-01 là Thứ Năm (`clock.ts:27-33`).
- `compressedWeekday(day)` = `WEEKDAYS_5[(day−1) % 5]`; `realWeekday(epochDay)`; `isWeekendEpochDay(epochDay)`; `isNightMinute(m)` = trước 07:00 hoặc từ 19:00 → `ClockInfo.isNight` (`clock.ts:36-48`).

**Bẫy:** trong World, mọi chỗ "ngày theo giờ VN" (`vnWall` ở `clock.ts:27-33`, `archive.vnDate` ở `archive.ts:43-46`) đều tự cộng 7 h cố định, không dùng `Intl`/múi giờ hệ thống — VPS đặt UTC hay giờ nào cũng cho cùng kết quả. Lớp AI dùng lịch **khác**: mốc reset ngân sách ngày (`DAILY_BUDGET_USD`) là ngày VN nhưng tính qua `Intl.DateTimeFormat` có dự phòng lệch cố định (`localDateKey` → `dateKeyIn(VN_TZ)`, `src/ai/llm.ts:86-109, 134-136`); riêng quota ngày của Gemini được đếm theo 0h giờ Pacific (14h PDT / 15h PST giờ VN — `QUOTA_RESET_TZ`, `src/ai/router.ts:56-63`; `dayKey` `:337-339`), **không** phải giờ VN. Đối chiếu log World với số liệu AI theo ngày phải nhớ hai lịch này có thể lệch nhau.

### 2.2 Đồng hồ trong World (`world.ts:415-422, 502-524`)

- `t` = phút game tuyệt đối (float); `curDay` là **trường riêng**, không suy từ `t`. `minuteOfDay()` = `clamp(t − (curDay−1)·1440, 0, 1439.999)`. `abs(m)` = time tuyệt đối của phút `m` trong ngày hiện tại. `SPEC.md:216` viết `day = floor(time/1440)+1` — đó là mô tả, không phải cách code làm; ở realtime ngày có thể nhảy (`endDay('rollover', realDay)`).
- `mode` = `config.timeMode === 'realtime' ? 'realtime' : 'compressed'`; `gmps` = `config.gameMinutesPerSecond` kẹp (0, 60], sai → 0.5 (`world.ts:470-472`).
- `speed()` realtime luôn 1; nén trả `spd` (đổi qua dev panel). `weekday()` realtime = `realWeekday(realStartEpochDay + curDay − 1)`, nén = `compressedWeekday(curDay)`.
- `clock(): ClockInfo` = `{ time (2 chữ số), day, minute (floor), weekday, speed, isNight, timeMode }` (`types.ts:399-407`).

**Tiến thời gian mỗi tick** (`step`, `world.ts:1118-1135`):

| Chế độ | Cách tiến | Sang ngày |
|---|---|---|
| compressed | `t += gmps · spd · dtReal/1000` | `endDay('night')` khi `m ≥ 18:30` và không ai có mặt; `endDay('failsafe')` khi `m ≥ 23:00` |
| realtime | `t = max(t, dayStart + vnWall().minute)` | khi `realDay > curDay` → `endDay('rollover', realDay)` rồi `placeForCurrentTime(true)` |

`dtGame = min(max(t − before, 0), 10)` — trần 10 phút game/tick để một lần treo tiến trình không làm hiệu ứng nhảy vọt.

**Bẫy realtime — ngày bị bỏ qua khi server tắt lâu:** `freshInit` đặt ngày 1 = hôm nay theo giờ VN (`realStartEpochDay = vnWall().epochDay`, `curDay = 1`, `t = vnWall().minute`, `world.ts:2964-2968`), nên `realDay = epochDay − realStartEpochDay + 1` là số ngày **lịch** kể từ ngày đầu. Khi server tắt qua nhiều ngày, tick đầu sau khi bật thấy `realDay > curDay` → gọi **một** lần `endDay('rollover', realDay)` → `curDay = max(day + 1, realDay)` (`:1123-1124, 2426`). Các ngày ở giữa **không được mô phỏng**: không `planDay`, không `computeResults`, không bản ghi archive `kpi`, không `onDayEnd`/`onDayStart` cho chúng; chỉ ngày cuối trước khi tắt được chấm (với `coverage` theo phần đã mô phỏng, §9.9) và ngày hiện tại được `planDay`. Hệ quả: `curDay` luôn khớp lịch thật nhưng `kpiHistory`/archive có "lỗ" ngày; `MONTH_DAYS` (§8.4) vẫn đếm theo `curDay` nên tháng không bị kéo dài. Smoke không bao phủ nhánh này (chỉ chạy `compressed`, `scripts/smoke.ts:97`).

### 2.3 Tua nhanh và "mất oan" KPI

- Đi bộ: `WALK_TILES_PER_SEC = 3.2` ô/giây thật × `min(speed, 4)` (`world.ts:37, 1193`) — ở x10 nhân vật chỉ đi nhanh gấp 4 để client còn nội suy mượt.
- Cảnh hội thoại của Director chạy theo giờ thật (÷ `min(speed, 3)`), nên ở x5/x10 một cảnh "ăn" nhiều phút game hơn. `trackSpeedLoss()` (`world.ts:1179-1189`) chỉ chạy khi `speed > 3`: cộng phần giờ hành chính bị mất (`f = 1 − min(s,4)/s` khi đang đi; `1 − min(s,3)/s` khi `activity === 'scene'`) vào `rt.speedLoss` để `computeResults()` co mục tiêu lại (§9.9). Ở x2 không bù vì ×2 < ×4, không có méo.

---

## 3. Bản đồ lưới (`src/sim/map.ts`)

Bản đồ 60×34 ô (`MAP_W`, `MAP_H`, `map.ts:13-14`), server giữ bản gốc và gửi nguyên khối qua `hello.map = MAP_DATA = { w, h, walls, rooms, furniture, desks, spots }` (`map.ts:203`).

### 3.1 Phòng (`ROOMS`, `map.ts:16-26`)

| id | Nhãn | Rect (x, y, w, h) | Ghi chú |
|---|---|---|---|
| `work` | Khu làm việc | 1, 8, 43, 25 | 9 bàn nhân viên + bảng KPI |
| `showroom` | Phòng trưng bày | 1, 1, 8, 6 | v2 — thay WC cũ; 2 kệ `shelf_beauty` (x1..4) / `shelf_tech` (x5..8) ở y=1 |
| `server` | Phòng server | 10, 1, 8, 6 | rack 6×2 |
| `wc` | WC | 19, 1, 4, 6 | **không đi vào được**, xem §14 |
| `meeting` | Phòng họp | 24, 1, 20, 9 | 12 chỗ `SPOTS.meeting` |
| `boss` | Phòng Giám đốc | 45, 1, 14, 10 | bàn sếp 6×2, ghế (51,3) |
| `hall` | Sảnh | 45, 12, 14, 10 | bóng bàn, máy in |
| `pantry` | Pantry | 45, 23, 14, 10 | cà phê, tủ lạnh, nước, snack, bàn ăn |
| `lounge` | Góc chill | 24, 26, 19, 7 | TV, sofa, beanbag |

`roomAt(x, y)` ưu tiên phòng **nhỏ hơn** (sort theo diện tích, `map.ts:195-200`). Ai dùng: World chỉ ở `bossPressure` (sếp đứng yên trong phòng `boss` → 0.75, `world.ts:1749`); `src/sim/scenes.ts` dùng để phân loại khu tụ tập (`areaOf`: đang trong phòng `pantry`/`lounge`, `scenes.ts:395-397`) và suy kệ khi một người ở trong phòng `showroom` nhưng không đứng sát chỗ nào (`shelfAt`: nửa trái = làm đẹp, nửa phải = công nghệ, `scenes.ts:1360-1368`). `director.ts` **không** gọi `roomAt` — Director xác định "cùng kệ"/chỗ đang giữ qua `spotKey` nhóm `showroom_*` (`spotPos(spotKey, group)`, `director.ts:4316-4320`, dùng ở `:1181`).

### 3.2 Bàn và ghế (`DESKS`, `map.ts:33-44`)

10 bàn `d_tl, d_senior, d_junior, d_qa, d_design, d_saleslead, d_salesnew, d_mkt, d_hr, d_boss`, mỗi bàn `{ desk: Rect 3×2 (sếp 6×2), seat: Pt }`. Ghế nằm ngay dưới bàn (sếp: ghế trên bàn). Bàn được tự thêm vào `FURNITURE` với `owner = deskId`, type `desk`/`boss_desk` (`map.ts:120-122`). `ROLE_INFO[role].deskId` (`src/content/roster.ts:12-62`) ánh xạ vai → bàn; `roleDesk()` trong World dự phòng `'d_junior'` nếu bàn không tồn tại (`world.ts:200-203`).

### 3.3 Chỗ đứng (`SPOTS`, `map.ts:46-70`)

Số ô mỗi nhóm = số người tối đa cùng lúc; World giữ chỗ bằng khoá `group:idx` (§6.3).

| Nhóm | Số ô | Dùng cho |
|---|---|---|
| `entrance` | 2 | (1,16),(1,17) — `ENTRANCE = entrance[0]` là ô dự phòng cuối cùng của `walkableNear` |
| `coffee`, `water`, `snack` | 2, 2, 2 | hành động pantry |
| `fridge` | 1 | dự phòng cho `snack` |
| `pantry_table` | 6 | ăn trưa ở pantry (hết → `lounge` → tại bàn) |
| `lounge` | 5 | `chill`, dự phòng ăn trưa |
| `toilet` | 2 | (20,8),(21,8) đứng trước cửa WC rồi "vào" (ẩn) |
| `showroom_beauty` / `showroom_tech` | 3 / 3 | hàng y=3 trước kệ (y=2 để trống cho sprite cao) |
| `pingpong` | 2 | hai đầu bàn |
| `printer` | 1 | `printing` |
| `window` | 3 | gọi điện (sales) / hóng gió |
| `meeting` | 12 | Director dùng cho họp/phỏng vấn |
| `boss_visit` | 3 | Director: gọi lên phòng sếp |
| `server` | 3 | `server_fix` |
| `kpi_board` | 3 | `KPI_BOARD_STOP = kpi_board[1]` (31,21) — sếp dừng xem khi đi tuần |

### 3.4 Tường, cửa, chặn, tìm đường

- Lưới ký tự (`map.ts:125-152`): `'#'` tường, `'D'` cửa, `'.'` sàn; viền ngoài là tường; cửa chính (0,16),(0,17) — chính là `DOORS` của World (`world.ts:41`). `WALLS: string[]` gửi client.
- `blocked` = tường + mọi `FURNITURE.blocked === true` + toàn bộ `WC_RECT` + 2 ô `WC_DOORS` (20,7),(21,7) (`map.ts:154-161`). Sofa, beanbag, door_mat `blocked: false` (đứng/ngồi được). `isWalkable(x, y)` kiểm biên + `!blocked`.
- `findPath(from, to)` (`map.ts:167-193`): BFS 4 hướng, `from` được `Math.round`; trả `[]` nếu đã ở đích, đích không đi được, hoặc không có đường. Đường trả về **không chứa ô xuất phát, có chứa ô đích**. Lưới nhỏ nên BFS mỗi lần đủ nhanh, không cache.

**Ràng buộc/bẫy:** (1) đích phải là ô nguyên đi được — World luôn qua `walkableNear()` trước. (2) Mọi ô trong `SPOTS`/`DESKS.seat` phải tới được từ cửa — `scripts/smoke.ts` kiểm ("bản đồ v2: … mọi chỗ / ghế tới được từ cửa", `smoke.ts:855`). (3) Đổi bản đồ phải sửa đồng bộ `PATROL_ROUTES` (`behavior.ts:470-479`), `CANDIDATE_WAIT` (`world.ts:44`), `KPI_BOARD_STOP`, và client vẽ ([07-frontend-ve-canvas.md](07-frontend-ve-canvas.md)).

---

## 4. Trạng thái nhân viên: `AgentState` công khai và `Rt` nội bộ

### 4.1 `AgentState extends Persona` (`src/types.ts:91-125`)

Trường runtime quan trọng và ai sở hữu:

| Trường | Ý nghĩa | Ai ghi |
|---|---|---|
| `status` | `'active' \| 'candidate' \| 'fired'` — không có giá trị riêng cho nghỉ việc/cắt giảm (dùng `'fired'` + nhãn) | World |
| `present`, `hidden?` | có mặt (được vẽ); đang trong WC (không vẽ, flag 8) | World |
| `x, y, dir, path` | toạ độ float, hướng, các ô còn phải đi | World |
| `activity`, `activityUntil`, `activityLabel`, `emote` | hoạt động hiện tại, hạn (time tuyệt đối), nhãn, emoji | World; Director qua `setActivity` |
| `spotKey` | chỗ đang giữ, vd `'coffee:0'` | World |
| `sceneId` | `≠ null` ⇒ Director điều khiển, World **không** tự chọn hoạt động/cho về/cho ăn trưa | Director gán/thả trực tiếp (`director.ts:1276, 1050, 1566`) |
| `onPhone` | đang chat nhóm (📱) ⇒ KPI ×0.6 | Director |
| `energy, mood, stress` | 0..100 | World (`applyEffects`), Director (`adjust`) |
| `kpiToday`, `kpiHistory` (≤ 14), `lowStreak`, `warnings` | KPI; `warnings` do Director/HR tăng | World chấm; Director tăng `warnings` |
| `relationships`, `memories` (≤ 8) | quan hệ một chiều −100..100, ký ức ≤ 120 ký tự | cả hai |
| `arriveAt`, `leaveAt` | phút trong ngày dự kiến đến/về | World (`planSchedule`) |
| `hiredDay`, `lastSceneAt`, `caughtToday` | `caughtToday` World chỉ reset mỗi ngày, Director tăng | |
| v3 `traitBase?`, `dayFactor?`, `probationUntilDay?`, `bonuses?`, `promotions?` | tính cách gốc, hệ số ngày, thử thách, thưởng, thăng chức | World |

`Activity` (`types.ts:60-80`) có 23 giá trị; `'idle'` = chờ chọn việc tick sau; `'scene'` = Director điều khiển; `'away'` chỉ sếp đi vắng; `'offsite'` không vẽ. Danh sách đầy đủ ở `ALL_ACTIVITIES` + `isActivity()` (`behavior.ts:27-33`).

### 4.2 `Rt` — trạng thái chạy nội bộ (`world.ts:126-154`)

Không gửi client nhưng **có lưu file** (`serializeWorld().rt`).

| Trường | Ý nghĩa |
|---|---|
| `cd: Partial<Record<ActionKey, number>>` | thời điểm game được chọn lại từng hành động (cooldown) |
| `arrived`, `left`, `arrivedAt` | đã vào/đã về hôm nay; time vào |
| `lunch: LunchPlan \| null` | `{ start, end, mode: 'pantry'\|'desk'\|'out', napUntil, state: 'pending'\|'going'\|'eating'\|'out'\|'done' }` |
| `pendingDur` | thời lượng sẽ bắt đầu tính khi **tới nơi** (null = đã tới) |
| `rate: StatDelta \| null` | hiệu ứng "khi xong" rải theo phút |
| `exit: 'home'\|'lunch'\|'trip'\|'remove'\|null` | đang đi ra cửa để làm gì |
| `outUntil` | ăn trưa ngoài: lúc quay lại |
| `partner` | bạn bóng bàn |
| `panic` | đang "giả vờ làm việc" (KPI ×0.5) |
| `waypoints`, `waitUntil` | điểm đi tuần còn lại, dừng tới khi |
| `removeBy`, `idleSince`, `waiting` | hạn xoá người ra về; ứng viên: lần cuối trong cảnh, đã tới chỗ chờ |
| `hiredAt`, `justHired` | phút được tuyển (chấm KPI ngày đầu), vừa được tuyển (về bàn 🥳) |
| `sceneSeen`, `sceneSince` | watchdog cảnh (giờ thật ms) |
| `speedLoss` | phút giờ hành chính mất oan do tua nhanh |
| v3 `personal`, `tempTraits`, `dayNote`, `leaveReason` | sự kiện cá nhân hôm nay; độ lệch trait trong ngày; lý do hệ số ngày; vì sao rời công ty |

Các kiểu khác: `BossPlan { trips: Trip[], state: 'none'\|'leaving'\|'away', reason, dur, returnAt, forced }`, `Trip { start, dur, reason, done }` (`world.ts:156-164`); `DayFlags { lunchOutLogged, lastLeaverLogged, forceOutLogged, firstArrivalLogged }` (`:166`); `LeaveReason = 'fired'\|'resigned'\|'laid_off'`, `PersonalKind = 'sick'\|'traffic'\|'heartbreak'\|'angry_client'\|'lottery'` (`:119-121`).

### 4.3 Khởi tạo một người

- `sanitizePersona(p, fallbackId)` (`world.ts:239-279`) — chuẩn hoá persona từ content hoặc AI, không throw: role lạ → `'junior'`; `name` ≤ 40 (`'Người mới'`); traits mặc định diligence 0.5 / laziness 0.4 / gossip 0.5 / temper 0.4 / humor 0.5 / ambition 0.5; look mặc định (`HAIR_STYLES`, `ACCESSORIES` `world.ts:110-111`); `deskId` không có trong `DESKS` → `roleDesk(role)`; gender `'nữ'` (so NFC) hoặc `'nam'`; age 18..70; bio ≤ 600, speechStyle ≤ 400; quirks/likes/dislikes ≤ 8 mục; `kpiTarget` 30..5000, mặc định `ROLE_INFO[role].kpiTarget` hoặc 260.
- `newAgentState(p, status, at, day, minute)` (`:281-295`): energy U(75,95), mood U(55,75), stress U(15,35), `traitBase = { ...traits }`, `dayFactor 1`, `bonuses 0`, `promotions 0`, `leaveAt = T_WORK_END`, `hidden false`.
- `reviveAgent(raw)` (`:298-349`) khi khôi phục: null nếu thiếu `id`/`name`/`role` hợp lệ; toạ độ ngoài bản đồ → ghế; `kpiHistory.ratio` kẹp 0..100 giữ 14; memories giữ 8 (text ≤ 160); relationships score −100..100; `traitBase` thiếu → = traits hiện tại; `dayFactor` 0.5..1.5; `probationUntilDay` > 0 mới giữ.

---

## 5. Vòng tick

```
tick() mỗi 100 ms  →  dtReal = clamp(now − lastTickAt, 0, 1000)
  runTick(dtReal, now):
    step(dtReal)          ← try/catch riêng
    director.tick(dtReal) ← try/catch riêng
    output(now)           ← try/catch riêng
```

`advance(dtRealMs)` (`world.ts:1111-1116`) chạy đúng 1 tick không cần đồng hồ thật (test headless), có gọi `notifyDayStartOnce()`.

**`step()`** (`world.ts:1118-1156`) theo thứ tự:

1. Tiến thời gian (§2.2), tính `dtGame`.
2. `obsWork += workOverlap(m − dtGame, m)` — số phút giờ hành chính (08:00–17:30 trừ 12:00–13:00) thực sự đã mô phỏng hôm nay (`workOverlap`, `world.ts:181-185`; `WORK_MINUTES = 510`).
3. Chỉ nén: `m ≥ T_FAILSAFE (23:00)` → `endDay('failsafe')` return; `m ≥ T_NIGHT_SKIP (18:30) && !anyonePresent()` → `endDay('night')` return.
4. `m ≥ T_FORCE_OUT (21:00)` → `forceOut()`; `checkIncident()`.
5. `processArrivals()` → `processPersonal()` → `processBoss()` → `processSchedules()` → `updateAgent()` cho từng người (bỏ người đã bị xoá trong tick) → `detectSlackers()` → `applyProjectProgress()`.

**`updateAgent(a, dtReal, dtGame)`** (`world.ts:1158-1172`): `sanitize(a)` → `watchScene(a, rt)` → không có mặt: return → ứng viên trong cảnh cập nhật `idleSince` → `exit === 'remove'` quá `removeBy` và không trong cảnh → `deleteAgent` → `trackSpeedLoss` (active) → có `path`: `move()` rồi `onReached()` khi hết đường → không đang đi: `applyEffects()` → `sceneId === null` → `updateActivity()`.

Hệ quả quan trọng: người **trong cảnh vẫn được di chuyển và nhận hiệu ứng mỗi phút**, nhưng World không chọn hoạt động mới, không cho về, không cho ăn trưa cho tới khi Director thả (`sceneId = null`).

---

## 6. Di chuyển, đường đi, chỗ đứng

### 6.1 Đi bộ (`world.ts:1192-1261`)

- `move(a, dtReal)`: quãng = `3.2 · min(speed, 4) · dtReal/1000` ô; đi theo `path`, đổi `dir` bằng `dirOf`.
- `walkTo(a, target)`: `tgt = walkableNear(target)`; đang ở giữa 2 ô → chèn tâm ô gần nhất vào đầu `path` (luôn đi trên lưới, không cắt góc tường); **không có đường → dịch chuyển tức thời tới đích** (`world.ts:1219-1223`). Không bao giờ kẹt, nhưng nếu bản đồ bị sửa sai nhân vật sẽ "nhảy".
- `walkableNear(p)` (`:1230-1243`): làm tròn, kẹp biên, tìm vành r = 1..6, cuối cùng trả `ENTRANCE`.
- `nearestDoor(a)`, `nextDoor()` (luân phiên 2 ô cửa để người đến không chồng nhau), `atDoor(a)` (eps 0.05).
- `lineOfSight(a, b)` (`:1280-1289`): lấy mẫu 4 điểm/ô, **chỉ tường `'#'` chặn** (đồ đạc không chặn tầm nhìn) — dùng cho bắt quả tang.

### 6.2 Chỗ cho khách tới bàn (`visitorSpot`, `world.ts:589-616`)

Ô đi được cạnh ghế của `targetId` (hoặc cạnh đích đang đi tới nếu cách ghế > 1 ô), không nằm trong `usedTiles()` (ghế mọi bàn, 2 cửa, vị trí/đích của mọi người có mặt, mọi chỗ đã giữ — `:1264-1278`); thử 16 offset gần rồi vành r = 3..7; cuối cùng `walkableNear(base)`.

### 6.3 Giữ chỗ (`reserveIn`, `world.ts:1292-1330`)

- `reserveIn(a, groups, 'first'|'random')`: nếu `a.spotKey` đang giữ chỗ cùng nhóm thì trả chính chỗ đó; chọn chỗ trống theo thứ tự nhóm; `spotFreeFor()` tự dọn giữ chỗ "ma" (người đã đi/bị xoá, hoặc `spotKey` của người giữ đã đổi); `releaseSpot(a.id)` trước khi gán khoá mới `group:idx`.
- `reserveSpot(id, group)` (WorldApi) = `reserveIn(a, [group], 'first')`; `releaseSpot(id)` xoá mọi giữ chỗ của id.
- `freeSpotCount(group, forId)` dùng trong `available()` của utility.
- Mọi giữ chỗ bị xoá sạch ở `planDay` (`reservations.clear()`, `:2497`). `cleanupActivity(a, rt, nextTarget)` (`:1379-1383`) giữ chỗ cũ theo **một** trong hai điều kiện tuỳ có đích mới hay không: có `nextTarget` → chỉ giữ nếu chỗ **trùng đúng** đích mới (đang đứng ngay trên chỗ nhưng đích khác vẫn bị trả); `nextTarget === null` → giữ nếu đang đứng cách chỗ ≤ 0.5 ô; còn lại `releaseSpot(a.id)`. Trường hợp `null` chỉ xảy ra khi `begin()` không có `o.target` (`:1354-1355`); `startLeaving` cũng truyền `null` nhưng gọi `releaseSpot` ngay sau đó (`:1840-1841`) nên người đi ra cửa luôn trả chỗ.

---

## 7. Hoạt động, cách chọn việc và nhãn

### 7.1 Vòng đời một hoạt động (`world.ts:1353-1493`)

- `begin(a, rt, activity, dur, o)` (`:1353-1374`): `cleanupActivity` → nhãn/emote lấy từ `flavorFor` nếu thiếu → `panic = !!o.panic` → có `o.until` thì `activityUntil = until` (`pendingDur = null`), không thì `activityUntil = t + dur` **tạm** và `pendingDur = dur` (tính lại khi tới nơi) → `rate = onCompleteRate()` → `walkTo(target)` hoặc `path = []` → không có đường thì `onReached` ngay.
- `cleanupActivity` (`:1377-1391`): `hidden = false` (mọi hoạt động mới đều ra khỏi WC), trả chỗ (trừ ngoại lệ §6.3), gỡ partner, reset panic/waypoints/rate/pendingDur/waiting; `exit` chỉ giữ `'remove'`.
- `unlinkPartner` (`:1393-1407`): bạn bóng bàn mất đối thủ → `activityUntil = min(…, t)`, tick sau chọn việc khác.
- `onReached` (`:1410-1428`): `pendingDur` → `activityUntil = t + pendingDur`; `patrol` → đợi U(0.4, 1.2) phút, tại `KPI_BOARD_STOP` đợi 2 phút với nhãn `kpiBoard` 📊 quay `'up'`; `faceForPlace`; **`toilet` tới ô `toilet:i` → `hidden = true`**.
- `updateActivity` (`:1441-1493`): fired/`exit === 'remove'` → `updateExiting`; candidate → `updateCandidate`; máy trạng thái: `'leaving'` đi ra cửa → `reachExit`; `'patrol'` đi qua `waypoints` (đổi lại nhãn tuần sau bảng KPI), hết → `next`; `'server_fix'` hết khi `incident !== 'server_down'`; `'pingpong'` mất bạn → kết thúc; `'scene'`/`'offsite'`/`'away'` còn sót (Director thả quên đổi) → kết thúc ngay; rồi nếu `idle` hoặc `t ≥ activityUntil` → `next()` → `choose()`.

### 7.2 `choose()` — thứ tự ưu tiên (`world.ts:1501-1547`)

1. `shouldLeave()` → `goHome()`.
2. Lịch ăn trưa: `L.state` chưa `done`/`out`: quá `L.end` → `done`; tới `L.start` → `startLunch()`.
3. Ngủ trưa sau ăn (`L.state === 'done' && L.napUntil > m && m ≥ L.start`) → `'napping'` tại bàn, nhãn `lunchNap` 😴, `until = abs(napUntil)`.
4. `rt.justHired` → về bàn `'working'` 20–40 phút nhãn `newDesk` 🥳.
5. Dựng `UtilityCtx` (`behavior.ts:162-178`): `bossPresent = !bossAway()`, `bossPressure(a)`, `wifiDown`, `deadlineDays`, `kpiBehind(a, m)`, `sinceArrival = t − arrivedAt`, `breakTime` (ăn trưa xong, 11:45 ≤ m < 13:00), `overtime` (m ≥ 17:30), `available(key)` = chưa hết cooldown + (`pingpong`: có bạn từ `findPingpongPartner` và ≥ 2 chỗ trống) + nhóm chỗ còn trống.
6. `pickWeighted(isBoss ? bossWeights(ctx) : staffWeights(ctx))`; null → sếp `'boss_office'`, nhân viên `'work'` → `startAction()`.

### 7.3 Bảng hành động tự chọn (`ACTIONS`, `behavior.ts:51-67`)

`spots: null` = ghế tại bàn; `[]` = đặc biệt (đi tuần). `dur` là phút game **tính từ lúc tới nơi**; `cooldown` tính từ lúc bắt đầu.

| key | activity | spots | dur | cooldown |
|---|---|---|---|---|
| `work` | working | ghế | 25–70 | 0 |
| `slack` | slacking | ghế | 8–30 | 0 |
| `nap` | napping | ghế | 10–25 | 60 |
| `coffee` | coffee | `coffee` | 5–10 | 60 |
| `water` | water | `water` | 3–5 | 40 |
| `snack` | snack | `snack`, `fridge` | 4–8 | 90 |
| `toilet` | toilet | `toilet` | 4–10 | 60 |
| `pingpong` | pingpong | `pingpong` | 12–25 | 120 |
| `chill` | chill | `lounge` | 10–25 | 45 |
| `window` | window | `window` | 6–14 | 15 |
| `showroom` | showroom | `showroom_beauty`, `showroom_tech` (thứ tự do `showroomLean`) | 6–12 | 120 |
| `printing` | printing | `printer` | 3–6 | 40 |
| `boss_office` | boss_office | ghế sếp | 20–60 | 0 |
| `patrol` | patrol | `[]` | 8–20 | 60 |

`personalDuration(key, a, base)` (`behavior.ts:291-297`): `work` × (0.4 + 0.8·diligence); `slack`/`chill` × (0.6 + 0.6·laziness); còn lại giữ nguyên.

### 7.4 Trọng số utility

`staffWeights(c)` (`behavior.ts:181-244`), với `dil`, `laz` kẹp 0..1 và `p = bossPresent ? bossPressure : 0`:

| Hành động | Công thức |
|---|---|
| work | `1.2·dil + 0.6·p + (kpiBehind ? 0.5·dil : 0) + (project && deadlineDays ≤ 1 ? 0.4 : 0)`; cộng `heat · 2.5 · dil²` với `heat = (lowStreak ≥ 1 ? 0.3) + (warnings > 0 ? 0.2)` — người chăm bị nhắc gỡ lại được, người lười gần như không đổi (`:208-211`) |
| slack | `laz·(2.2 − 1.6p) + (stress > 70 ? 0.3) + (energy < 30 ? 0.2)`; wifi_down ×2 |
| nap | `energy < 25 ? 0.3 + 0.8·laz : (13:00 ≤ m < 14:30 ? 0.15·laz : 0.02)` |
| coffee | `energy < 55 ? (55 − energy)/40 : 0.05`; +0.35 nếu `sinceArrival < 25` và `energy < 92` |
| water | 0.12 |
| snack | `0.1 + (mood < 40 ? 0.2)` |
| toilet | `0.08 + 0.1·laz` |
| pingpong | `laz·(0.9 − 0.75p)` |
| chill | `laz·(0.6 − 0.5p) + (stress > 70 ? 0.2)` |
| window | sales 0.5 / khác 0.05 |
| printing | hr hoặc sales 0.08, khác 0 |
| showroom | `(marketing ? 0.25 : 0.08) + (mood < 40 ? 0.1)` |
| breakTime | work ×0.35; slack = slack·1.3 + 0.35; chill +0.2; pingpong +0.1·laz; nap +0.1·laz |
| overtime | pingpong ×0.3; chill ×0.5 |
| wifiDown | window +0.1; chill ×1.5 |

`bossWeights(c)` (`:272-285`): `boss_office` 1.0; `patrol` 0.35 (0 nếu `sinceArrival < 10`); coffee `(energy < 55 ? (55−energy)/40 : 0.04) + (sinceArrival < 20 ? 0.25)`; water 0.06; toilet 0.05; window 0.04; snack 0.02. Sếp **không** có showroom/slack/nap/pingpong/chill.

`pickWeighted(items)` (`:299-309`) chọn theo trọng số; `null` nếu tổng ≤ 0. Mọi RNG dùng `Math.random` (`rand/randInt/chance/pick`, `:10-16`) nên smoke test gài hạt giống bằng cách thay `Math.random` **trước** khi import (`scripts/smoke.ts:29-42`).

### 7.5 Chi tiết khi bắt đầu (`startAction`, `world.ts:1549-1595`)

- Đặt cooldown nếu `def.cooldown > 0`.
- `work` → nhãn `workFlavor(a)` (ROLE_INFO.workLabels/workEmote); từ 17:30 thêm tiền tố `"tăng ca: "`.
- `slack`/`nap`/`boss_office` → ghế mình.
- `patrol` → `startPatrol` (`:1597-1605`): `patrolRoute()` (`behavior.ts:482-489`: 1 trong 4 `PATROL_ROUTES`, lọc ô đi được; 50% bỏ ngẫu nhiên một điểm giữa **chỉ khi lộ trình còn > 4 điểm** (`:486`); lọc hết → dự phòng `[(30,17)]` (`:487`) — rút `PATROL_ROUTES` xuống ≤ 4 điểm sẽ không còn hành vi 50% này), thời lượng **tính cả lúc đi** (`pendingDur = null`).
- `pingpong` → `startPingpong` (`:1607-1621`): giữ 2 chỗ, nhãn `"<flavor> với <tên>"`, đặt cooldown cho cả bạn.
- `showroom` → `reserveIn(a, showroomLean(a), 'random')` (`behavior.ts:262-269`: pBeauty = 0.5, nữ +0.3 / nam −0.2, dev/designer/qa −0.25, marketing +0.05, kẹp 0.15..0.85) + `showroomFlavor(a, shelf)` + `maybeInvite`.
- Mặc định (coffee/water/snack/toilet/window/printing/chill): `toilet` với `laziness ≥ 0.6` và 60% → `dur × 2`, nhãn `toiletHide` 🚽 "trốn vào WC lướt điện thoại"; coffee/snack/water → `maybeInvite`.
- Hết chỗ → dự phòng về bàn: sếp `'boss_office'` 20–40, nhân viên `'working'` 20–40 (`:1593-1594`).

### 7.6 Rủ nhau — cơ chế tạo "co-location" cho `pantry_chat`/`showroom_chat`

- `isFreeForInvite(b, m)` (`:1624-1632`): có mặt, active, không trong cảnh, không đang đi, không `left`/`exit`/`panic`/`pendingDur`, chưa tới giờ về, không sắp ăn trưa (`m ≥ lunch.start − 10`), đang `working`/`slacking`/`idle`/`chill` hoặc `window` (không phải sales).
- `findPingpongPartner(a)` (`:1634-1649`): bỏ sếp, `laziness < 0.4`, đang cooldown pingpong, quan hệ `a→b < −30`; xác suất nhận = `clamp(0.3 + 0.7·laz_b + (sếp vắng ? 0.2 : −0.15) − (kpiBehind_b ? 0.2 : 0), 0.05, 0.95)`; trọng số `1 + max(0, rel)/30`.
- `maybeInvite(a, key, dur)` (`:1652-1685`): sếp không rủ; p = showroom: `(0.2 + 0.4·gossip)·(sếp vắng ? 1 : 0.7)`; khác: `(0.15 + 0.35·gossip)·(vắng ? 1 : 0.5)·(coffee ? 1 : 0.6)`; người được rủ cần **`a→b ≥ 20` và `b→a ≥ 0`**, trọng số `1 + ab/25`; nhận = `clamp(0.35 + 0.5·laz_b + (vắng ? 0.15) − (kpiBehind_b ? 0.2), 0.1, 0.95)`; showroom ưu tiên cùng kệ với người rủ; nhãn `"<flavor> cùng <tên>"`.

**Bẫy:** quan hệ khởi đầu mặc định là 0 `'đồng nghiệp'` (`freshInit`, `world.ts:2986`), nên vài ngày đầu chỉ các cặp trong `INITIAL_RELATIONSHIPS` có điểm ≥ 20 mới rủ nhau được (ví dụ `tram→linh 45`, `tu→bao 25`, `phat→ngoc 20` trong bảng `REL` của `src/content/roster.ts`). Có vẻ là ý đồ (tình bạn phải xây), nhưng nếu thấy pantry quá vắng thì đây là chỗ chỉnh.

### 7.7 Nhãn và emote (`behavior.ts:311-433, 492-515`)

- `flavorFor(activity, a)`: `working` → `workFlavor` (ROLE_INFO); `slacking` → `slackFlavor` (`SLACK_ACTIVITIES` của `src/content/catalog.ts`, trọng số `affinity()` theo likes/quirks/bio — từ ≥ 4 ký tự trùng → ×(1 + 2.5·hits), tối đa 2 hits); `window` → `windowFlavor` (sếp 📞 "gọi điện cho đối tác"; sales chỉ lấy nhãn có 📞; người khác lọc bỏ 📞); `showroom` → `showroomFlavor(a, shelf)` lọc `ACTIVITY_FLAVOR.showroom` theo `SHELF_WORDS` rồi dự phòng `SHOWROOM_SHELF_FLAVOR`; còn lại `ACTIVITY_FLAVOR[activity]` → `DEFAULT_FLAVOR`. Mọi hàm phòng thủ: content thiếu/hỏng → dự phòng, không throw.
- `LABELS` (nhãn đặc biệt World dùng xuyên suốt): `panic` 😰 "giả vờ làm việc", `toiletHide` 🚽, `deskLunch`/`bossLunch` 🍱, `lunchNap` 😴, `arrive` 👋, `arriveLate` 😅 "đến trễ, lén lút vào chỗ", `arriveBoss` 👔, `backFromLunch` 😋, `bossBack` 🚗, `newDesk` 🥳, `goHome` 👋, `goHomeSharp` ⏰ "canh đúng giờ là về", `goHomeOT` 🌙, `goHomeForced` 🔦, `lunchOut` 🍜, `fired` 📦, `resigned` 👋, `laidOff` 📦, `dismissed` 🙇, `waitInterview` 🙂, `kpiBoard` 📊.
- Hướng nhìn: `FACING_OVERRIDE` theo nhóm chỗ (lounge/boss_visit/server/showroom_*/toilet `'up'`, window `'down'`, coffee/water/fridge/entrance `'right'`); `facingAt(p, group)` quay về đồ vật kề (thứ tự up, left, right, down), mặc định `'down'`; `seatFacing(deskId)`.

---

## 8. Hiệu ứng mỗi phút, KPI và công ty

### 8.1 `applyEffects(a, rt, dt)` (`world.ts:1688-1724`)

Bỏ qua nếu `dt ≤ 0`, không có mặt, hoặc `pendingDur !== null` (chưa tới nơi — đang đi không có hiệu ứng).

1. `perMinute(activity, role)` (`behavior.ts:73-90`):

| activity | energy | mood | stress |
|---|---|---|---|
| working | −0.06 | | +0.03 |
| slacking | +0.01 | +0.04 | −0.08 |
| napping | +0.5 | | |
| pingpong | −0.1 | +0.4 | −0.6 |
| chill | +0.2 | | −0.4 |
| showroom | −0.02 | +0.12 | −0.08 |
| lunch | +0.3 | +0.2 | |
| boss_office / patrol | −0.03 | | |
| server_fix | −0.08 | | +0.06 |
| window | (không phải sales/sếp) | | −0.1 |

   Thêm: `working` & vai dự án & `deadlineDays ≤ 1` → stress +0.05.

2. **Cân bằng nội môi** (chỉ `active`): `dM += (moodBase − mood)·HOMEOSTASIS_MOOD (0.006)`, `dS += (stressBase − stress)·HOMEOSTASIS_STRESS (0.004)` — nửa đời ≈ 4 giờ game. Lý do (chú thích `:1694-1696`): SPEC chỉ có lực đẩy nên sau 1–2 ngày cả phòng mood 95–100, stress 5–10, prompt AI ai cũng "rất vui".
   - `moodBase(a)` = `75 + 12·(humor − 0.5) − 8·(temper − 0.5)` (≈ 67–83) (`:1730-1732`).
   - `stressBase(a)` = `18 + 10·temper` + 15 (vai dự án & deadline ≤ 1) + 10 (`lowStreak > 0` hoặc `warnings > 0`) + 6 (không phải sếp & `kpiBehind`) + 12 (`server_down` & vai dự án) (`:1735-1742`).
3. `rt.rate` (hiệu ứng "khi xong" rải đều) khi còn trong thời lượng. `ON_COMPLETE` (`behavior.ts:93-98`): coffee energy +22, water +3, snack mood +4 energy +5, toilet stress −6; `onCompleteRate(activity, durMin)` chia cho `max(1, dur)` → bị ngắt giữa chừng chỉ nhận một phần.
4. KPI: `f = kpiFactor(activity, role)` (`behavior.ts:112-122`: working 1; window 0.8 chỉ sales; **showroom 0.8 chỉ marketing** (2026-11-03 — giới thiệu sản phẩm ở phòng trưng bày là việc của marketing, như sales gọi khách bên cửa sổ; người khác ra đó là đi ngắm đồ); boss_office 1 chỉ sếp; server_fix 0.5 chỉ dev; còn lại 0). `mult = f × (panic ? 0.5) × (onPhone ? 0.6)`. `k = kpiRate(a, wifiDown) · mult · dt` → `kpiToday += k`; `working` & vai dự án → `progressPending += 0.016·k`.
5. Sales đang `working`/`window` và không panic: xác suất chốt deal mỗi phút `rate = 0.004·(0.5 + diligence)`, Poisson `Math.random() < 1 − exp(−rate·dt)` → `closeDeal(a)`.

### 8.2 Công thức KPI (`behavior.ts:122-143`)

```
kpiRate = (0.55 + 0.9·diligence) · (0.5 + 0.6·energy/100) · (0.75 + 0.35·mood/100)
          · dayFactorOf(a) · roleKpiFactor(role) · (wifiDown ? 0.3 : 1)
```

- `dayFactorOf(a)`: `dayFactor` kẹp 0.5..1.5, thiếu/hỏng → 1.
- `roleKpiFactor(role)` = `ROLE_INFO[role].kpiTarget / KPI_TARGET_REF (260)` kẹp 0.7..1.4 — dùng chỉ tiêu **gốc của vai**, không dùng `kpiTarget` hiện tại, để % KPI không phụ thuộc vai (Tú chỉ tiêu 300 không mãi thấp hơn Bảo 250) nhưng thăng chức (+chỉ tiêu) vẫn phải cố hơn.

Chỉ tiêu gốc theo `src/content/roster.ts:12-62`:

| Vai | kpiTarget | roleKpiFactor |
|---|---|---|
| boss | 240 | 0.92 |
| hr | 250 | 0.96 |
| techlead | 290 | 1.12 |
| senior | 260 | 1.00 |
| junior | 250 | 0.96 |
| qa | 270 | 1.04 |
| designer | 260 | 1.00 |
| saleslead | 290 | 1.12 |
| salesnew | 300 | 1.15 |
| marketing | 260 | 1.00 |

- `kpiBehind(a, m)` (`world.ts:1757-1763`): kỳ vọng = `kpiTarget_hiện_tại · worked / 510` với `worked` = phút giờ hành chính đã trôi (trừ trưa); chậm nếu `kpiToday < 0.85·expected`. Dùng `kpiTarget` **hiện tại** (sau thăng chức) — khác với `roleKpiFactor`.

### 8.3 Bắt quả tang — hoạt động nào bị bắt (`behavior.ts:146-157`)

`CATCHABLE = {slacking, pingpong, chill, napping}`; `isCatchable(activity, m)`: không bắt trong `LUNCH_FROM 12:00`–`LUNCH_TO 13:00`; `napping` được tới `NAP_SAFE_TO 13:15`. Việc phát hiện và hậu quả xem §11.4.

### 8.4 Dự án và doanh thu

- `applyProjectProgress()` (`:1765-1771`) cộng `progressPending` vào `project.progress` (trần 100) → `release()`.
- `release()` (`:1773-1783`): `projectsDone++`; log 🚀 `Release xong dự án "<tên>" cho <khách>` (+ "— trễ hạn mất rồi 😅" nếu `curDay > deadlineDay`); dự án mới qua `newProject(curDay, false)`; log 📁; `director.onEvent('release', { note })`.
- `newProject(day, initial)` (`:1798-1818`): rút từ `PROJECT_POOL` (`src/content/catalog.ts:30`, 15 mục) tránh tên trong `recentProjects` (giữ `max(1, min(4, pool − 1))` = 4); `progress` = U(15,35) nếu initial, 0 nếu không; `deadlineDay = day + U{4..6}`.
- `closeDeal(a)` (`:1785-1796`): doanh thu +U{10..80} triệu, `kpiToday += 40`, log 💰 `<tên> chốt hợp đồng N triệu (doanh thu tháng: x/1500 triệu)`, `director.onEvent('deal', { agentId, note })`.
- `addRevenue(millionVnd)` (WorldApi, `:860-864`) ≥ 0, làm tròn 0.1. `REVENUE_TARGET = 1500` triệu; `MONTH_DAYS = 20`: ở `planDay`, `day > 1 && (day−1) % 20 === 0` → log 📅 "Sang tháng mới! Doanh thu tháng trước…" rồi `revenueMonth = 0` (`:2500-2507`).

### 8.5 Sự cố (`incident`)

`setIncident(kind)` (`:852-858`) chỉ nhận `'server_down' | 'wifi_down' | null`, ghi `incidentSince`. Ảnh hưởng: `wifi_down` → KPI ×0.3, slack ×2, window +0.1, chill ×1.5; `server_down` → stressBase +12 cho vai dự án, `server_fix` kết thúc khi hết sự cố. `checkIncident()` tự gỡ sau `INCIDENT_MAX = 150` phút game (phòng Director quên); `planDay` cũng gỡ; `reviveCompany` luôn đặt `incident = null` khi khôi phục (`:364`) vì Director không còn hẹn giờ gỡ.

---

## 9. Lịch sinh hoạt trong ngày

### 9.1 Mốc giờ (`world.ts:57-65`)

| Hằng | Giờ | Dùng ở |
|---|---|---|
| `T_WORK_START` | 08:00 | `workOverlap`, `kpiBehind` |
| `T_LATE` | 08:30 | `arrive`: `late = !isBoss && m > 08:30` |
| `LUNCH_FROM`/`LUNCH_TO` | 12:00/13:00 | `isCatchable`, `breakTime`, `workOverlap` |
| `T_WORK_END` | 17:30 | `overtime`, tiền tố "tăng ca", `leaveAt` mặc định |
| `T_BOSS_HOME_EARLIEST` | 17:00 | `maybeLogLastLeaver` chỉ sau giờ này |
| `T_NIGHT_SKIP` | 18:30 | nén: kết thúc ngày khi không ai còn; sếp về thẳng nếu quá giờ này |
| `T_FORCE_OUT` | 21:00 | `forceOut`; không ai đến sau giờ này |
| `T_FAILSAFE` | 23:00 | nén: buộc kết thúc ngày (console.warn) |
| `T_TRIP_FROM`/`T_TRIP_TO` | 09:30/15:30 | khung chuyến đi của sếp |

### 9.2 `planDay(day)` — lên lịch ngày mới (`world.ts:2490-2546`)

1. `closedToday = realtime && isWeekendEpochDay(...)`; reset `flags`, `spotted`, `lastSpotAny`, `progressPending`, `obsWork`, `reservations`; gỡ sự cố.
2. Sang tháng (§8.4).
3. Mỗi người: `revertTempTraits`, `kpiToday = 0`, `caughtToday = 0`, `energy = U(75,95)`, `stress = max(10, stress − 25)`, `mood += (60 − mood)·0.3`, `present = false`, `'offsite'`, `spotKey = null`, `hidden = false`, `dayFactor = U(0.75, 1.2)`, **`Rt` mới** (mất mọi cooldown), active → `planSchedule(a)`.
4. `planLunches()`; `bossPlan = { trips: closedToday ? [] : planBossTrips(), state 'none' }`.
5. Cuối tuần → log 🏖️ "<thứ>, ngày N — cuối tuần, văn phòng đóng cửa" và **return** (không có sự kiện cá nhân).
6. Log 🌅 "<thứ>, ngày N — văn phòng mở cửa"; `rollPersonalEvent()`; `noteDayFactors()`; log ⏰ trễ hạn / hôm nay hạn chót dự án.

### 9.3 Giờ đến / về theo vai và tính cách (`planSchedule`, `world.ts:2549-2578`)

| Ai | Đến | Về |
|---|---|---|
| boss | U(08:40, 09:20) | U(17:00, 18:30) |
| hr | U(07:50, 08:05) | U(17:30, 17:45) |
| chăm (`diligence ≥ 0.7 && laziness < 0.45`) | U(07:40, 08:00) | theo `otChance` |
| lười (`laziness ≥ 0.6`), `k = clamp((laz − 0.6)/0.2, 0, 1.5)` | U(08:00 + 10k, 08:30 + 20k) | không gần hạn: U(17:30, 17:35); gần hạn: theo `otChance` |
| khác | U(07:55, 08:20) | theo `otChance` |

- Nhân viên (không sếp/HR) thêm "kẹt xe/ngủ quên" với xác suất `0.06 + 0.08·laziness` → +10–35 phút.
- `otChance = clamp(0.1 + 0.55·dil − 0.3·laz + (gần hạn ? 0.35 : 0), 0, 0.95)` → tăng ca `17:30 + U(15,120)·(0.4 + 0.6·dil)` hoặc về U(17:30, 17:50).
- Kẹp: `arriveAt` 07:30–10:00; `leaveAt` ≥ `arriveAt + 60` và ≤ 20:30.

### 9.4 Ăn trưa (`planLunches`/`makeLunch`, `world.ts:2581-2618`)

- ≥ 4 nhân viên (không sếp) và 70%: chọn hạt giống (trọng số `0.5 + gossip + 0.5·laziness`) + 1–2 bạn (quan hệ ≥ 15, thân nhất trước) → nhóm `out` ra ngoài ăn (chỉ khi nhóm ≥ 2).
- `makeLunch(a, goOut)`: `start = clamp(12:00 + U(−5, 8) − 4 (lười) + 3 (diligence ≥ 0.7), 11:50, 12:10)`; `end = U(12:40, 12:55) + U(3,10) (lười)`; `mode`: out / sếp 70% desk / khác desk với xác suất `0.06 + 0.12·dil + 0.15 (gần hạn)` ngược lại pantry; ngủ trưa (không sếp): `napChance = out ? 0.05 + 0.2·laz : 0.12 + 0.5·laz` → `napUntil = U(13:00, 13:15)`.
- `startLunch` (`:2133-2152`): `out` → `state 'going'`, `outUntil = abs(end) + U(0,10)`, `startLeaving('lunch', lunchOut 🍜)`, `logLunchOut()` (🍜 "A, B rủ nhau ra ngoài ăn trưa" nếu ≥ 2 người, 1 lần/ngày); `pantry` → `reserveIn(['pantry_table','lounge'],'first')`, hết chỗ → ăn tại bàn; `desk` → `deskLunch`/sếp `bossLunch` 🍱; `until = abs(end)`.
- Về từ ngoài: `processArrivals` thấy `lunch.state === 'out'` và `t ≥ outUntil` → `comeBackFromLunch` (vào cửa, nhãn `backFromLunch` 😋, `state 'done'`).

### 9.5 Đến công ty (`processArrivals`/`arrive`, `world.ts:1923-1965`)

- Điều kiện: không `closedToday`; active, không có mặt, không trong cảnh; chưa `arrived`/`left`; sếp không trong kế hoạch đi vắng; `arriveAt ≤ m < leaveAt` và `m < 21:00`.
- `arrive`: vào ở `nextDoor()`, `dir 'right'`; người đầu tiên → log 🔑 "<tên> là người đến sớm nhất, mở cửa văn phòng lúc HH:MM" (`firstArrivalLogged`); `begin('arriving', 0, target = ghế, nhãn arrive/arriveLate 😅/arriveBoss 👔)`; sếp → log 👔 "Sếp đã đến công ty" + `panicSwitch(0.5)`; `announceArrival` (v3, §10.5) rồi `director.onAgentArrived(id, late)`.

### 9.6 Các mốc ngắt hoạt động (`processSchedules`, `world.ts:2113-2131`)

Với người có mặt, active, không trong cảnh, không `'leaving'`, không `exit`, sếp không trong kế hoạch: tới giờ về → `goHome` (trừ đang `'arriving'`); lunch `pending` và `m ≥ start` → quá `end` thì `done`; đang `arriving`/`server_fix`/`lunch` thì chờ; không thì `startLunch`. Đây là chỗ **ngắt** hoạt động đang làm (`choose` chỉ chạy khi hết hoạt động).

### 9.7 Về nhà (`shouldLeave`/`goHome`/`startLeaving`/`reachExit`, `world.ts:1826-1914`)

- `shouldLeave`: `!left && m ≥ leaveAt` và sếp không đang trong `bossPlan` khác `'none'`.
- `goHome`: `m ≥ 18:15` → `goHomeOT` 🌙; lười (≥ 0.6) về trước 17:40 → `goHomeSharp` ⏰; khác `goHome` 👋.
- `startLeaving(a, kind, fl)`: cleanup, trả chỗ, `exit = kind`, `'leaving'`, `activityUntil = t + 600`, đi tới `nearestDoor`.
- `reachExit`: `present = false`, `hidden = false`; `'remove'` → `deleteAgent`; `'lunch'` → `'offsite'` "ra ngoài ăn trưa" 🍜; `'trip'` (sếp) → `bossPlan.state = 'away'`, `returnAt = t + dur`, `'away'`, emote `tripEmote(reason)` (golf 🏌️; ăn/nhậu/cà phê 🍽️; họp/gặp/ký 💼; bay ✈️; khác 🚗), `relaxWave()`, `director.onBossLeft(reason)`; `'home'` → `'offsite'` "đã về", `left = true`; sếp về → log 👋 "Sếp đã về. Cả phòng thở phào…" (nếu còn người) + `relaxWave`; `maybeLogLastLeaver` (🔒 "<tên> là người cuối cùng tắt đèn ra về lúc HH:MM", chỉ sau 17:00).

### 9.8 Cuối ngày (`forceOut`/`endDay`, `world.ts:2374-2434`)

- `forceOut()` lúc 21:00: ai có mặt, không trong cảnh, không `'leaving'` → `startLeaving` (`'remove'` nếu không active/đang bị đuổi, `'home'` với `goHomeForced` 🔦); sếp đang `'away'` → coi như đã về; log 🔦 "21:00 rồi, bảo vệ đi một vòng nhắc mọi người về nhà" 1 lần/ngày.
- `endDay(reason ∈ night|failsafe|dev|rollover, newDay?)`:
  1. Xoá **mọi người không active hoặc `exit === 'remove'`** (kể cả ứng viên đang chờ phỏng vấn); người còn lại `present = false`, `'offsite'`, trả chỗ; `bossPlan.state = 'none'`; `failsafe` → `console.warn("Ngày N: quá 23:00 vẫn còn người…")` (smoke coi là lỗi).
  2. Nếu `!closedToday`: `computeResults(day)` → `logDaySummary` → `archiveRecord('kpi', { day, weekday, results })` → `director.onDayEnd(day, results)`.
  3. Nén: `curDay = day + 1`, `t = dayStart + DAY_START`; realtime: `curDay = max(day+1, newDay)`, `t = max(t, dayStart)` — `newDay` có thể nhảy nhiều ngày sau khi server tắt lâu; các ngày ở giữa không có bước 2 (xem bẫy ở §2.2).
  4. `planDay(curDay)` → `director.onDayStart(curDay)`; dirty + `forceFrame`.

### 9.9 Chấm KPI (`computeResults`, `world.ts:2441-2469`)

- `coverage = clamp(obsWork / 510, 0, 1)`; `complete = coverage ≥ 0.3` — ngày chỉ mô phỏng một phần (bấm kết thúc sớm, khởi động giữa ngày, server tắt qua đêm realtime) thì mục tiêu co theo phần đã mô phỏng; dưới 30% không tính chuỗi thấp/lịch sử.
- Mỗi active: `lossShare = clamp(speedLoss / 510, 0, 0.8)`; `target = kpiTarget · max(coverage·(1 − lossShare), 0.15)`; người mới trong ngày (`hiredDay === day && hiredAt !== null`) → `target = min(target, kpiTarget · remain)` với `remain = clamp(workOverlap(hiredAt, 17:30)/510, 0.15, 1)`.
- `ratio = kpiToday / target`. Sếp/HR **miễn**: `lowStreak = 0`. Người khác chỉ cập nhật `lowStreak` khi `complete && !newHire && rt.arrived`: `ratio < config.kpiLowRatio ? +1 : 0`. `kpiHistory.push({ day, ratio })` chỉ khi `complete`, giữ 14.
- Trả `KpiResult { id, name, roleLabel, kpi, target, ratio, lowStreak }` (`types.ts:305`) cho **mọi** active, kể cả sếp/HR — Director/recap/HR phải tự lọc; `logDaySummary` (`:2471-2482`) đã lọc sếp/HR: 🌙 "Hết <thứ>, ngày N. KPI cao nhất: … · thấp nhất: …"; nếu không còn nhân viên nào ngoài sếp/HR (công ty bị cắt giảm hết người) → dòng rút gọn 🌙 "Hết ngày N." (`:2476-2478`) — vẫn là log hợp lệ, không throw.
- Luật cảnh cáo/đuổi (`KPI_WARN_DAYS`, `KPI_FIRE_DAYS`) **không** áp ở World; World chỉ gửi trong `hello.rules` và tính `lowStreak`.

### 9.10 Realtime: khởi động giữa ngày (`placeForCurrentTime`, `world.ts:2624-2653`)

Ai có `arriveAt + 5 ≤ m < leaveAt` (và `m < 21:00`) ngồi sẵn ở ghế (`'idle'`, `arrivedAt = t − 60`, không báo đi trễ, `firstArrivalLogged = true`); `m ≥ leaveAt` → coi như đã về; chuyến sếp đã qua giờ → `done`. `onlyAbsent = true` khi gọi từ `step` (rollover) và `restoreWorld` để không đụng người đang có mặt.

---

## 10. Tính cách (v3): gốc, nhiễu, trôi, hệ số ngày, sự kiện cá nhân

### 10.1 Hằng số (`world.ts:68-103`)

| Hằng | Giá trị | Ý nghĩa |
|---|---|---|
| `TRAIT_KEYS` | diligence, laziness, gossip, temper, humor, ambition | 6 trait |
| `TRAIT_JITTER` | 0.15 | nhiễu ± lần khởi tạo đầu |
| `TRAIT_MIN` / `TRAIT_MAX` | 0.05 / 0.95 | kẹp mọi trait |
| `DRIFT_BOUND` | 0.25 | `driftTrait` chỉ trôi trong `traitBase ± 0.25` |
| `OPENING_DILIGENCE_BAND` | [0.45, 0.7] | dải chung diligence cho nhân viên |
| `OPENING_LAZINESS_BAND` | [0.35, 0.6] | dải chung laziness cho nhân viên |
| `DAY_FACTOR_MIN` / `MAX` | 0.75 / 1.2 | hệ số ngày hên/xui |
| `DAY_FACTOR_LOW` / `HIGH` | 0.82 / 1.13 | ngưỡng "kể lý do" |
| `DAY_NOTES_MAX` | 2 | tối đa người được kể lý do mỗi ngày |
| `PERSONAL_EVENT_P` | 1/3 | xác suất có 1 sự kiện cá nhân mỗi ngày cho cả văn phòng |
| `LOW_DAY_NOTES` / `HIGH_DAY_NOTES` | 4 + 4 câu mẫu có `{name}` | log 😪 / ✨ |

### 10.2 Lần khởi tạo đầu (`randomizeOpeningTraits`, `world.ts:216-224`)

Áp trong `freshInit` khi `config.storyRandomizeTraits !== false` (`STORY_RANDOMIZE_TRAITS`, `:2981`). Nhân viên (không sếp/HR): **thay thẳng** `diligence ← U(0.45, 0.7)` và `laziness ← U(0.35, 0.6)` bất kể giá trị roster; rồi **mọi** trait ± U(−0.15, 0.15), kẹp 0.05..0.95, làm tròn 2 chữ số. Sếp/HR chỉ ± nhiễu. `traitBase` = bản sao kết quả (`newAgentState`). Người do AI sinh (`addAgent`) không bị áp — `traitBase = traits`.

**Lệch tài liệu:** `SPEC.md` §2 (~dòng 205-207) và §10.4 (~992) mô tả "kéo trait cực đoan về vùng bình thường: diligence < 0.45 → U(0.45, 0.55), laziness > 0.6 → U(0.5, 0.6)". Code hiện tại thay thẳng toàn bộ nhân viên về dải chung (lý do ở chú thích `world.ts:76-81`: chỉ kéo người cực đoan vẫn để 3 người chiếm 94% số lần bị đuổi qua 36 hạt). Tài liệu này theo code; SPEC cần sửa.

### 10.3 Trôi theo sự kiện (`driftTrait`, `world.ts:748-761`)

`driftTrait(id, key, delta)`: mỗi lần `delta` kẹp ±0.2; kết quả kẹp trong `[base − 0.25, base + 0.25]` với `base = (traitBase ?? traits)[key] + tempTraits[key]`, rồi 0.05..0.95; `config.storyTraitDrift === false` (`STORY_TRAIT_DRIFT`) → trả giá trị cũ, không đổi; trả NaN nếu không có người. Director gọi qua duck-typing (§12.4).

### 10.4 Độ lệch trong ngày (`applyTempTrait`/`revertTempTraits`, `world.ts:2085-2098`)

`applyTempTrait(a, rt, key, delta)` ghi độ lệch thực vào `rt.tempTraits[key]` (sau kẹp); `revertTempTraits` ở `planDay` hôm sau trừ lại. Hiện chỉ `heartbreak` dùng (diligence −0.15). `reviveRt` kẹp `tempTraits` ±0.5.

### 10.5 Hệ số ngày và sự kiện cá nhân

- `dayFactor = U(0.75, 1.2)` mỗi người mỗi ngày ở `planDay` (`:2525`); nhân vào `kpiRate`.
- `noteDayFactors()` (`:2070-2082`): tối đa 2 người/ngày (không sếp, không có `personal`) có `dayFactor < 0.82` → câu `LOW_DAY_NOTES`, `> 1.13` → `HIGH_DAY_NOTES`, lưu `rt.dayNote`.
- `rollPersonalEvent()` (`:2032-2067`, gọi **sau** `planSchedule` vì có thể dời giờ đến): xác suất 1/3; chọn 1 nhân viên (không sếp); `angry_client` chỉ khi có sales và nạn nhân là sales.

| Kind | Trọng số | Hiệu ứng khi rút | Công bố |
|---|---|---|---|
| `sick` | 1 | `arriveAt += U{30..60}` (kẹp 07:30–10:30); `dayFactor = min(cũ, U(0.6, 0.8))` | lúc tới (`announceArrival`): energy −15, stress +5, log 🤒 + ký ức |
| `traffic` | 1.2 | `arriveAt += U{20..45}` (kẹp 07:30–10:30 như `sick`, `:2052`); `at = max(07:45, arriveAt − U{15..30})` | `processPersonal` 📱 "nhắn vào nhóm: kẹt xe quá, tới trễ chút nha" + ký ức (chỉ khi chưa `present`/chưa `arrived`; đã tới trước giờ `at` → đánh `done` im lặng, `:2002-2004`) |
| `heartbreak` | 0.6 | mood −20; `applyTempTrait(diligence, −0.15)`; `dayFactor ×0.9` | lúc tới: log 💔 + ký ức |
| `angry_client` | 1 (có sales) | `at = U{09:30..16:00}` | `processPersonal` khi có mặt, không trong cảnh: stress +15, mood −8, log 😤 + ký ức; nạn nhân không còn là sales (đổi vai sau khi rút) → tự đánh `done` để không treo sự kiện (`:2009`) |
| `lottery` | 0.5 | `at = U{09:30..16:00}` | `processPersonal`: mood +20, log 🎉 + ký ức |

Sau khi rút: `leaveAt = max(leaveAt, arriveAt + 60)` kẹp ≤ 20:30; `dayNote = null`. `announceArrival` (`:1969-1991`) ưu tiên sick/heartbreak, không thì `dayNote` → log 😪/✨ + ký ức tương ứng. Đây là nguồn "lý do hợp lý" cho Director/AI đọc qua `memories`.

---

## 11. Sếp

### 11.1 Kế hoạch đi vắng (`planBossTrips`, `world.ts:2317-2332`)

`n` = 0 (40%) / 1 (45%) / 2 (15%); `start` trong 09:30–15:30 (chuyến 1 của 2 phải ≤ 12:00); `dur = U{60..150}`; chuyến sau cách `start + dur + U{30..75}`; lý do rút không lặp từ `BOSS_AWAY_REASONS` (`src/content/catalog.ts:161`, 17 câu) qua `pickReasons()` (có dự phòng 4 câu nếu catalog rỗng). Cuối tuần (realtime) không có chuyến.

### 11.2 Máy trạng thái (`processBoss`, `world.ts:2166-2210`)

- `'away'`: `t ≥ returnAt` và không trong cảnh → nếu `m ≥ leaveAt − 15` hoặc `m ≥ 18:30` → "Sếp đi thẳng về nhà luôn…" 🏠 (`left = true`), không thì `bossReturn()`.
- `'leaving'` bị cảnh cắt (`activity !== 'leaving' || exit !== 'trip'`) → đi tiếp nếu `m < 16:00` và chưa `left`, không thì huỷ (`state 'none'`).
- `'none'`: sếp có mặt, không trong cảnh, không `left`/`exit`; sếp đang `'arriving'`/`'leaving'` và không có `forced` → **hoãn** (return ngay, tick sau xét lại — `world.ts:2199`; chuyến theo lịch chưa bị đánh `done`); chuyến tới hạn (`!done && m ≥ start`) hoặc `forced` → `done = true`, `forced = null`; lỡ giờ (`m > start + 90` hoặc `m ≥ leaveAt − 45`) → bỏ chuyến (trừ `forced`, `:2204`); `startLeaving('trip', "ra ngoài: <lý do>" 🚗)`. Hệ quả: sếp đến 09:20 còn đang đi vào bàn khi chuyến 09:30 tới hạn → chuyến chờ tới khi sếp ngồi xuống, vẫn đi nếu lúc đó chưa quá `start + 90`.

### 11.3 Về văn phòng và hiệu ứng lan toả

- `bossReturn()` (`:2212-2238`): vào cửa, nhãn `bossBack` 🚗, `panicSwitch(1)`; log "Sếp đã về tới văn phòng! N người vội vàng giả vờ…" **chỉ khi không có Director** (Director tự log 🚪 "Sếp đã về! Cả văn phòng giả vờ làm việc 😰" ở `director.ts:536` — tránh trùng); `director.onBossReturned()`.
- `panicSwitch(prob)` (`:2241-2254`): nhân viên có mặt, không trong cảnh, không `exit`, đang làm việc "bắt được" (`isCatchable`) → với xác suất `prob` chuyển `'working'` 10–20 phút nhãn `panic` 😰, `rt.panic = true` (KPI ×0.5). Sếp đến sáng: 0.5; sếp về từ chuyến đi: 1.
- `relaxWave()` (`:2257-2266`): sếp đi → người lười đang `'working'` (không trong cảnh, không đang đi) bỏ dở trong 0–3 phút với xác suất `clamp((laziness − 0.3)·1.6, 0, 0.9)`.
- `bossPressure(a)` (`:1745-1750`): 0 nếu không có sếp/sếp vắng/chính là sếp; 1 nếu sếp cách ≤ 10 ô; 0.75 nếu sếp đứng yên trong phòng `boss`; còn lại 1.
- `bossNote()` (`:547-562`) cho `StatusInfo`: "Cuối tuần — văn phòng đóng cửa" · "Công ty đang không có sếp" · đang vắng: "Sếp <lý do> · dự kiến về khoảng HH:MM" · "Sếp đã về nhà"/"Sếp chưa đến công ty" · "Sếp đang ra ngoài: …" · theo `activityLabel` (nếu sếp trong cảnh và nhãn có chữ "sếp" → "Sếp đang bận nói chuyện với nhân viên", tránh gán ngược nhãn cảnh).

### 11.4 Bắt quả tang (`detectSlackers`, `world.ts:2268-2291`)

Điều kiện: sếp có mặt, không trong cảnh, **đang đi** (`path.length > 0`) hoặc `'patrol'`; nhịp toàn cục `SPOT_GLOBAL_CD = 30` phút game; nạn nhân gần nhất trong `SPOT_RADIUS = 4.5` ô, `isCatchable`, không đang đi, không trong cảnh, chưa bị bắt trong `SPOT_VICTIM_CD = 90` phút, có `lineOfSight`. World **không tự phạt** — gọi `director.onSlackerSpotted(bossId, victimId)`; Director dựng cảnh `boss_catch` hoặc log + phạt nhẹ và tăng `caughtToday`.

---

## 12. Vòng đời nhân sự và API cho Director

### 12.1 Bảng method (`world.ts:673-819, 2354-2365, 2656-2673`)

| Method | Hành vi |
|---|---|
| `addAgent(p, status, at)` | `sanitizePersona` (fallback id `nv_<day>_<rand>`), id duy nhất (thêm hậu tố nếu trùng), `present = true` tại `walkableNear(at)`, quan hệ 0 `'người mới'` hai chiều, energy U(75,90), mood U(60,75), stress U(25,45); `candidate` → nhãn `waitInterview`; `active` → `setupHire`; `fired` → `exit 'remove'` |
| `fireAgent(id)` | = `removeAgent(id, 'fired')` |
| `removeAgent(id, reason)` (v3) | sếp/HR **không bao giờ** bị loại (`console.warn "Bỏ qua removeAgent"`); `status = 'fired'`, nhãn `leaveFlavor(reason)` (fired 📦 / resigned 👋 / laid_off 📦), `exit 'remove'`, `removeBy = t + REMOVE_TIMEOUT (45)`; không có mặt → xoá ngay; đang trong cảnh → chờ Director thả, `updateExiting` lo sau |
| `hireAgent(id)` | candidate → `exit null`, reset `kpiToday`/`lowStreak`, `setupHire` |
| `dismissCandidate(id)` | candidate → đi ra với `dismissed` 🙇 |
| `setupHire(a, rt)` | `status 'active'`, `hiredDay = curDay`, `hiredAt = m`, `leaveAt = clamp(max(17:30 + U(0,20), m + 60), …, 20:30)`, lunch chỉ khi `m < 12:20`, nếu có mặt và không trong cảnh → về bàn `'working'` 20–40 nhãn `newDesk` 🥳, không thì `justHired = true` |
| `deleteAgent(id)` (private) | xoá khỏi `map`/`rts`, gỡ partner, trả chỗ, xoá quan hệ người khác trỏ tới, xoá `spotted` |

### 12.2 Ứng viên (`updateCandidate`, `world.ts:2335-2351`)

Vừa được thả khỏi cảnh (`'scene'`/`'meeting'`) → `'idle'`; chờ quá `CANDIDATE_MAX_WAIT = 120` phút game kể từ lần cuối trong cảnh → `dismissCandidate`; đi tới ô `CANDIDATE_WAIT` (5 ô y=11 trước cửa phòng họp, `world.ts:44`) trống đầu tiên, quay `'up'`, nhãn `waitInterview` 🙂. Lưu ý `endDay` xoá ứng viên còn chờ — Director không nên lên lịch phỏng vấn sát 18:00.

### 12.3 Hiệu ứng từ Director (`world.ts:822-864`)

`adjust(id, { energy, mood, stress, kpi })` kẹp 0..100, kpi ≥ 0 · `changeRelationship(from, to, delta, note)` **một chiều**, score −100..100 làm tròn, note ≤ 120 · `addMemory(id, text)` ≤ 120 ký tự, bỏ nếu trùng ký ức cuối, giữ 8 · `setIncident(kind)` · `addRevenue(millionVnd)` · v4 `setDeskItem(id, productId)` (`world.ts:842-850`, §15.4).

### 12.4 API v3 ngoài `WorldApi` — duck-typing

`driftTrait`, `setRole(id, roleLabel ≤ 60, kpiTarget 30..5000)` (→ `promotions++`), `setProbation(id, untilDay|null)`, `grantBonus(id)` (→ `bonuses++`), `headcount()` (số `status 'active'`, kể cả chưa tới/đã về), `removeAgent`, `getArchive()` **không có** trong `interface WorldApi` (`types.ts:531-582`). **Bẫy status:** `setRole` là no-op nếu `a.status !== 'active'` (`world.ts:766`), trong khi `setProbation`/`grantBonus`/`driftTrait` áp cho **mọi** status, kể cả ứng viên (`:775-788`, `:748-750`) — Director "thăng chức" người chưa active sẽ im lặng không có hiệu lực, còn thử thách/thưởng/trôi trait lên ứng viên thì có. Director truy cập qua `interface WorldV3` (`director.ts:94-104`) với `typeof w.x === 'function'` (`director.ts:2861-2982`). Director còn kiểm `w.getNews` nhưng World không có method này → luôn rơi về singleton `getNews()` (vô hại). Nên bổ sung vào `WorldApi` hoặc ghi rõ là mở rộng tuỳ chọn — xem [13-viec-con-lai-va-y-tuong.md](13-viec-con-lai-va-y-tuong.md).

---

## 13. Hiệu ứng cảnh áp lên thế giới (hợp đồng với Director)

- Director đưa người vào cảnh bằng cách gán **trực tiếp** `a.sceneId = sid` rồi `world.setActivity(id, 'scene', 600, { target, label, emote })` cho cảnh tại văn phòng, hoặc `a.onPhone = true` cho kênh chat (`director.ts:1275-1288`); thả bằng `sceneId = null; onPhone = false`.
- `setActivity(id, activity, durationMin, opts)` (`world.ts:625-643`): bỏ qua nếu không có mặt, activity lạ, đang ôm đồ ra về (`exit 'remove'`/`status 'fired'`); `dur` kẹp 0..1440; `label` ≤ 120, `emote` ≤ 16; `'leaving'` → `startLeaving(a, 'home')`; còn lại → `begin()`. `isArrived(id)` = present && path rỗng; `teleport(id, p)` → `walkableNear(p)` + `onReached`; `faceToward`; `distance` (Infinity nếu ai không có mặt).
- Khi `sceneId !== null`: World vẫn `move`/`applyEffects` nhưng không `updateActivity`; `processSchedules`/`processArrivals`/`processBoss` bỏ qua người trong cảnh; `panicSwitch`/`relaxWave`/`detectSlackers`/`forceOut`/`isFreeForInvite` đều loại người trong cảnh.
- **Watchdog** `watchScene(a, rt)` (`world.ts:2877-2901`): `sceneId` giữ > `SCENE_WATCHDOG_MS = 5` phút **thật** (`realNow`, test truyền đồng hồ ảo) → hỏi `director.publicScenes()` còn cảnh đó (`status !== 'end'`) không; còn → kiểm lại sau 2.5 phút; không → `console.warn "kẹt trong cảnh … tự gỡ"`, `sceneId = null`, `onPhone = false`, kết thúc `'scene'`/`'meeting'`. Smoke coi warn này là lỗi (`smoke.ts:66`).
- `sanitize(a)` mỗi tick (`:2855-2874`): NaN energy/mood/stress → 70/60/30, kẹp 0..100; `kpiToday ≥ 0`; `path` là mảng; toạ độ NaN → ghế, ngoài biên → kẹp; `activityUntil` hữu hạn; **`hidden` chỉ giữ khi `present && activity === 'toilet' && sceneId === null && path.length === 0`**.
- `activeAgents()` trả cả người đang ẩn trong WC — Director đã lọc `a.hidden` (`director.ts:1115, 1373, 3860`); mọi code mới chọn người vào cảnh phải nhớ lọc.

Callback World gọi Director (`DirectorApi`, `types.ts:585-602`):

| Callback | Khi nào |
|---|---|
| `tick(dtReal)` | mỗi tick sau `step` |
| `onDayStart(day)` | `start()` lần đầu cho văn phòng mới (`notifyDayStartOnce`), và cuối `endDay`. **Không** gọi sau `load()` thành công (`dayStartNotified = true`, `world.ts:1066`) — Director phải tự khôi phục lịch ngày từ `restore()` |
| `onDayEnd(day, results)` | `endDay` khi `!closedToday` |
| `onEvent(name, data?)` | `release`, `deal`, các dev event không thuộc World |
| `onBossLeft(reason)` / `onBossReturned()` | `reachExit('trip')` / `bossReturn()` |
| `onSlackerSpotted(bossId, victimId)` | `detectSlackers` |
| `onAgentArrived(id, late)` | `arrive` |
| `publicScenes()`, `recaps()`, `rumors()` | `hello()` và watchdog |
| `serialize()` / `restore(data)` | `save()` / `load()` |

---

## 14. WC ẩn (v2)

```
choose → startAction('toilet') → reserveIn(['toilet']) → begin(target = (20|21, 8))
  → đi tới → onReached: spotKey 'toilet:i' ⇒ hidden = true   (frame flag 8, client không vẽ)
  → hết thời lượng → next → begin(hoạt động mới) → cleanupActivity: hidden = false
```

- Bên trong WC và 2 ô cửa không đi được (`map.ts:159-161`); nhân vật chỉ đứng ở `SPOTS.toilet` rồi "vào".
- `sanitize` tự lộ ra nếu bất kỳ điều kiện nào sai (bị Director kéo vào cảnh, có `path`, không còn `'toilet'`) → không bao giờ "kẹt ẩn".
- Không sống sót qua khởi động lại: `normalizeRestored` đặt `hidden = false` (`:3197`); `endDay`/`planDay`/`reachExit` cũng đặt false.
- Smoke kiểm: ẩn khi vào, flag 8 khớp, ≤ 30 phút game, không kẹt (`smoke.ts:857-858`); người lười `toiletHide` nhân đôi thời lượng (4–10 → 8–20 phút).

---

## 15. Đầu ra, giao thức và sản phẩm

### 15.1 Phát tin (`world.ts:867-1003, 2763-2852`)

- `emit(msg)` bọc try/catch. `log(e, bubble?)`: `text` ≤ 1000; quy ước **emoji ở `icon`, `text` chữ thuần** — nếu `kind !== 'line'` và `text` bắt đầu bằng `icon` thì cắt bỏ; gán `id = ++logSeq`, `day`, `minute`; đẩy `history` (giữ `LOG_KEEP = 200`); `archiveRecord('log', entry)`; phát `{ t:'log', entry, bubble? }` với `bubble.durationMs` kẹp 300..30000. `toast(icon ≤ 16, text ≤ 300)`.
- `hello()` (`:906-923`): `map: MAP_DATA`, `companyName`, `clock`, `status: statusInfo()`, `agents: publicAgents()`, `log` (≤ 200), `recaps/rumors/scenes` hỏi Director (mặc định `[]`), `dev: !!config.devPanel`, `rules: { kpiLowRatio, kpiWarnDays, kpiFireDays }`, `products: showroomProducts()`, `news: getNews().recent(5)`.
- `output(nowMs)` (`:2763-2777`): `frame` khi `forceFrame` hoặc ≥ `FRAME_MS = 200` ms: `{ t:'frame', clock, a: frameAgents(), ts: Date.now() }` — `ts` là dấu giờ server để client nội suy theo trục giờ server (chống giật qua Cloudflare; client vẽ trễ bộ đệm thích ứng `store.net.buffer`, `NET_BUFFER_MIN/MAX/START = 260/700/340` ms, `public/js/store.js:146`). `agents` + `status`: mỗi `AGENTS_MS = 2000` ms (due) **hoặc** khi dirty và đã ≥ 300 ms; `status` luôn kèm, `agents` chỉ khi due hoặc `agentsDirty`.
- `frameAgents()` (`:2779-2787`): chỉ người `present` (kể cả ẩn, `:2782`): `[id, x (2 chữ số), y, dir, activity, emote, flags]`, flags bit 1 đang đi, 2 `onPhone`, 4 trong cảnh, 8 ẩn (`FrameAgent`, `types.ts:438-439`).
- `publicAgents()` (`:2789-2791`) gửi **mọi** agent trong `map` — kể cả `offsite` (chưa tới/đã về), ứng viên `candidate`, người `fired` đang ôm thùng ra cửa — khác với `frame` chỉ có người `present`. Client/Director đọc gói `agents` (và `hello.agents`) phải tự lọc theo `present`/`status`; một id có trong `agents` nhưng không có trong `frame` là bình thường (người đó không ở văn phòng).
- `toPublicAgent` (`:2821-2835`) → `PublicAgent` (`types.ts:440-457`) gồm cả relationships/memories/traitBase/probation/bonuses/promotions; `deskItem` qua `getProduct(deskItemProductId)` → `toPublic(p, 'desk')`, cache theo id (`deskItemCache`). Món đồ trên bàn đổi được lúc đang chạy (v4, §15.4).
- `statusInfo()` (`:2837-2852`): `{ bossAway, bossNote, viewers, ai: brain.usage() (lỗi → bản offline rỗng dùng config.model/dailyBudgetUsd), company, clicks, speed }`. **World phát `StatusInfo` đầy đủ**; `src/server.ts:184-210` thay bằng `publicStatus()` (clicks 0, `ai` rỗng trừ `mode`) cho socket không có quyền dev và ghi đè `hello.dev`/`hello.status` theo từng socket (`server.ts:455-462`). Nguyên tắc "người xem không thấy hệ thống" nằm ở **server**, không ở World — đường phát mới nào tái dùng `hello()`/`statusInfo()` phải lọc lại.

### 15.2 Vào từ client

- `handleClient(msg)` (`:949-957`): chỉ nhận `t:'dev'`; `action:'speed'` → `setSpeed`; `action:'event'` với tên trong `DEV_EVENTS` → `devEvent`. Server đã lọc quyền dev + rate-limit (10 lệnh/5 s) trước khi gọi (`server.ts:470-478`).
- `setViewers(n)` (`:959-968`): đặt `viewerCount`, `statusDirty`, gọi `brain.setAudience(v)` — đường duy nhất `LLM_ONLY_WHEN_WATCHED` biết "có ai xem" (brain từ chối LLM cho cảnh thường khi `viewers === 0`, `src/ai/brain.ts:245, 344`; Director đọc `world.viewers()` ở `director.ts:644`). Server gọi khi nối, đóng và mỗi heartbeat 30 s.
- `recordClick(productId, src)` (`:987-1003`): nguồn hợp lệ `/^[A-Za-z0-9_-]{1,32}$/` (showroom/sidebar/scene/desk), lạ → `'khac'`; trần 500 sản phẩm × 16 nguồn; `console.log('[click] …')` **mỗi lượt**. `clickStats()` cho `/api/stats` (cần mã dev). Server gọi từ `/go/:id?src=` (`server.ts:345`).

### 15.3 Sản phẩm lên kệ (`src/sim/showroom.ts`)

`buildShowroomProducts()` (`showroom.ts:87-118`): ưu tiên `products.getShowroomProducts()` (có thật ở `src/content/products.ts:225`, truy cập qua namespace để biên dịch được dù content chưa có); rỗng/lỗi → `getProducts()`. Mỗi mục qua `toShowroom()`: `id` khớp `ID_RE = /^[A-Za-z0-9_-]{1,80}$/`, có `name` (≤ 120), `category` từ `category`/`shelf`/tag (`BEAUTY_TAGS` = lam-dep, my-pham, skincare, son; `TECH_TAGS` = cong-nghe, gadget) — không thuộc kệ nào thì không lên kệ; `url` **luôn** `/go/<id>?src=showroom`; `emoji` mặc định 🛒; `note` thiếu → `pitch` (≤ 200); `image` chỉ nhận http(s) hoặc đường dẫn tuyệt đối. `assignSlots()`: slot thiếu (−1) → số trống nhỏ nhất của kệ; sắp kệ làm đẹp trước → slot → tên (`localeCompare 'vi'`). Trần `MAX_ITEMS = 40`, loại trùng id, không bao giờ throw. World cache 1 lần/tiến trình (`showroomCache`, `world.ts:2809-2819`) → **đổi `data/products.json` phải khởi động lại**.

### 15.4 Món đồ trên bàn (v4)

Mỗi nhân viên có một `deskItemProductId` = id món trong `data/products.json`: vẽ emoji trên bàn (canvas) và hiện trong hồ sơ kèm link `/go/<id>?src=desk`.

- **Preset 10 nhân vật gốc** (`src/content/roster.ts`): sếp `am-dun-nuoc-bluestone`, HR `nen-thom-heny-garden`, techlead `ssd-di-dong-ssk`, senior `man-hinh-aoc`, junior `chan-goi-van-phong-cecila`, QA `lot-chuot-hinh-meo`, designer `hop-trang-suc-eleanor`, saleslead `may-chieu-mini`, sale mới `chuot-attack-shark-x11`, marketing `bang-phan-mat-cheeryep`.
- **`DESK_ITEM_TAGS: Record<RoleKey, string[]>`** (`roster.ts:74-85`): tag gợi ý theo vai (vd junior `chuot, gaming, ngu-trua, ban-lam-viec`; marketing `trang-diem, livestream, thoi-trang, lam-dep`), khớp `tags` của danh mục. Dùng ở hai chỗ: ứng viên / người mới do AI sinh (`DESK_TAGS` trong `src/ai/brain.ts` chính là bảng này) và `fixDeskItems` bên dưới. Bảng là `Record` đầy đủ — thêm vai mới thì TypeScript báo thiếu.
- **`setDeskItem(id, productId)`** (`world.ts:842-850`, thuộc `WorldApi`): đặt món đồ trên bàn; bỏ qua nếu không có người / id không có trong danh mục / trùng món đang có; đánh dấu `agentsDirty`. Director gọi khi **hàng về** (shipper giao), khi **được tặng quà bí mật** và khi AI biên kịch cho ai đó "săn được" một món (`StoryAction 'own'`) — chi tiết [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) §11.5–11.6.
- **`fixDeskItems()`** (`world.ts:856-890`, private): chạy cuối `freshInit` và ngay sau `restoreWorld` trong `load()` (`:1109`). Ai (chưa nghỉ) có món không còn trong danh mục → đổi sang preset của roster nếu còn và chưa ai giữ, không thì `pickProduct(DESK_ITEM_TAGS[vai], các món đã có người giữ)`; xoá `deskItemCache`, log `[world] Đổi "món đồ trên bàn" cho N nhân viên theo danh mục sản phẩm mới.` Nhờ vậy đổi bộ sản phẩm (v4: 18 món mẫu → 26 món chính thức) **không cần xoá `data/state.json`**.

---

## 16. Snapshot: lưu / khôi phục `data/state.json`

### 16.1 `persist.ts`

- `STATE_VERSION = 1`; `StateFile = { version, savedAt, world, director, brain }` (`persist.ts:5-13`).
- `writeJsonAtomic(file, data)` (`:16-34`): mkdir, ghi `<file>.tmp-<pid>`, `fsync` (không bắt buộc), `rename` đè → không bao giờ để lại file hỏng; lỗi → xoá tmp rồi throw.
- `readJsonFile(file)`: `undefined` nếu không có file; throw nếu đọc/parse lỗi. `quarantineFile(file)`: đổi tên thành `<file>.bad-<ISO không có : .>`.
- Validators khi khôi phục: `isObj`, `num(v, def, min, max)` (sai kiểu/NaN → def, kẹp), `str(v, def, maxLen = 2000)`, `strArr(v, maxItems = 20, maxLen = 200)`, `bool`.

**Bẫy:** đổi shape file lưu mà **không** tăng `STATE_VERSION` → file cũ vẫn được nhận, trường mới nhận mặc định (cách v2/v3 đã làm, cố ý để không mất dữ liệu). Tăng `STATE_VERSION` → file cũ bị cách ly và văn phòng làm lại từ đầu (`world.ts:1036-1039`).

### 16.2 `save()` / `load()` (`world.ts:1006-1077`)

- `save()`: bỏ qua nếu `!config.persist`; `{ version: 1, savedAt, world: serializeWorld(), director: jsonSafe(director.serialize), brain: jsonSafe(brain.serialize) }` → `writeJsonAtomic(config.stateFile)`. `jsonSafe` (`:2926-2934`) ép qua `JSON.parse(JSON.stringify())`, lỗi → null (một module hỏng không làm hỏng cả file).
- `load()` thứ tự: đọc file (lỗi → `loadFailed(…, quarantine)`); không có file → văn phòng mới (không cách ly); sai `version` → cách ly; **`brain.restore` trước** (giữ chi phí đã tiêu kể cả khi world hỏng); `restoreWorld(data.world)` (false/throw → cách ly + `freshInit()`); v4 `fixDeskItems()` (món đồ trên bàn không còn trong danh mục → đổi, §15.4); rồi `director.restore`. Thành công → `dayStartNotified = true`.
- `loadFailed(why, quarantine)`: `quarantineFile` → `*.bad-<stamp>`, `console.warn`, `freshInit()`. README §10 hướng dẫn "làm lại văn phòng": tắt server, xoá `data/state.json`.

### 16.3 Shape `serializeWorld()` (`world.ts:3013-3038`)

`mode, time, day, realStartEpochDay, closedToday, logSeq, log, clicks, clicksBy, clicksBySource, clicksByProductSource, company, recentProjects, agents (toàn bộ AgentState kể cả path/hidden), rt (Object.fromEntries(rts)), boss (bossPlan), spotted, lastSpotAny, obsWork, flags, news: getNews().serialize()` — kho tin thời sự lưu **chung** trong `state.json`.

### 16.4 `restoreWorld(raw)` (`world.ts:3078-3192`)

- Từ chối (→ làm mới + cách ly) nếu: `agents` không phải mảng hoặc không có người hợp lệ; **không có sếp `active`** (`:3086`); `company` hỏng; `day`/`time` không hữu hạn.
- Vá quan hệ: bỏ người không còn, thêm cặp thiếu `'đồng nghiệp'`. Commit: `map`/`rts`/`comp`/`history` (giữ 200)/`logSeq = max(saved, max id)`/clicks (trần 500/16)/`recentProjects` (≤ 6)/`news.restore`.
- Nếu `savedMode === mode`: giữ `curDay`, `t` (nén: time ngoài ngày → 07:30; realtime: kẹp trong ngày, `realStartEpochDay` thiếu → suy từ hôm nay), `closedToday`, `bossPlan` (`reviveBossPlan`, ≤ 4 chuyến), `flags` (**`firstArrivalLogged` mặc định `true`** khác các cờ khác), `spotted`, `lastSpotAny`, `obsWork` (thiếu → `workOverlap(0, m)`), `Rt` từng người (`reviveRt` hoặc `rebuildRt` suy từ giờ: `arrived = present || m > arriveAt`, `left = !present && m ≥ leaveAt`, lunch mới), `normalizeRestored`; sửa `bossPlan` mâu thuẫn (`away` nhưng sếp có mặt → `none`; `leaving` nhưng sếp vắng → `none`); realtime cùng ngày → nhảy tới giờ hiện tại + `placeForCurrentTime(true)`.
- Đổi chế độ thời gian giữa 2 lần chạy → sang ngày mới (`savedDay + 1`), xoá người không active, `planDay`, realtime → `placeForCurrentTime()`.
- `reviveRt` (`:3040-3065`): `cd` chỉ nhận key trong `ACTIONS`; `hiredAt` 0..1439; `speedLoss` 0..510; `tempTraits` ±0.5; `exit` chỉ 4 giá trị hợp lệ.

### 16.5 Thứ **không** sống sót qua khởi động lại (`normalizeRestored`, `world.ts:3195-3232`)

`path = []`, `hidden = false`, `sceneId = null`, `onPhone = false`, `spotKey = null`, gỡ partner/panic/waypoints/rate/pendingDur → **cảnh và WC không sống sót**; `incident` cũng bị xoá (`reviveCompany`); `spd` về 1. Người không active không có mặt → xoá; có mặt → `exit 'remove'`. `'leaving'` → đi tiếp ra cửa; `'arriving'` → đi về bàn; còn lại → `'idle'` (tick sau tự chọn việc). Hành vi cố ý.

### 16.6 Bẫy khởi động: dòng "ngày 1 giả" trong archive

Constructor gọi `freshInit()` → `planDay(1)` → **đúng 1 dòng** `log` 🌅 "<thứ>, ngày 1 — văn phòng mở cửa" (realtime vào cuối tuần: 🏖️ "… cuối tuần, văn phòng đóng cửa") **trước** khi `load()` (`world.ts:2534-2538`). Ngày 1 không thể có dòng nào khác: ⏰ hạn chót cần `day ≥ deadlineDay` mà `newProject(1, true)` đặt `deadlineDay = 1 + U{4..6} ≥ 5` (`:1816`); 📅 sang tháng cần `day > 1`; `rollPersonalEvent()`/`noteDayFactors()` chỉ dời giờ và ghi `rt.personal`/`rt.dayNote`, không `log` (`:2032-2082`) — sự kiện cá nhân chỉ được log lúc nhân viên tới (`announceArrival`) hoặc trong `processPersonal`, đều không chạy trước `load()`. Vì server bật archive trước khi dựng World và `log()` → `archiveRecord('log')` vô điều kiện (`:891, 941-947`), mỗi lần khởi động lại có `state.json` archive JSONL nhận thêm **một** dòng "ngày 1" giả trước khi `history` được thay bằng bản khôi phục. Hành vi suy ra từ code; chưa đối chiếu file `data/history/<hôm nay>.jsonl` thật (xem Câu hỏi còn mở #4).

---

## 17. Lưu trữ dài hạn (`src/sim/archive.ts`)

Mỗi ngày (theo giờ VN) một file `HISTORY_DIR/YYYY-MM-DD.jsonl`, chỉ nối thêm; dòng `{"ts":<ms>,"kind":"log|kpi|recap|hr|beat|news|…","data":{…}}`. Không bao giờ chặn tick.

### 17.1 Vòng đời và mặc định

- Singleton `getArchive()` (`archive.ts:477-480`) mặc định **tắt** (`enabled: false`) cho tới khi `configure({ enabled: true, … }).start()` — test không vô tình ghi file. `World.getArchive()` trả singleton này (`world.ts:936-938`).
- `Archive.defaults()` (`:84-90`): `dir 'data/history'`, `keepDays 180`, `gzipAfterDays 7`, `flushMs 2000`, `maxQueue 5000`, `maxLineBytes 64 KiB`, `now = Date.now` (smoke truyền đồng hồ ảo), `warn`/`info` = console.
- `start()` (`:113-122`): interval `max(250, flushMs)` + `rotate()` sau 5 s (cả hai `unref()`). `stop()` = clear timer + `flushSync()`.
- `configure(opts)` (`:93-105`): đang chạy → `stop()` (flush đồng bộ) → trộn cấu hình → `start()` lại; **luôn** xoá `countCache`, đặt `dirReady = false`, `indexLoaded = false`, `indexDirty = false` (bộ đệm đếm dòng và trạng thái `index.json` làm lại từ đầu). Gọi giữa chừng (smoke đổi thư mục tạm) an toàn nhưng tốn một lần đếm lại.
- `record()` trả `boolean` (`:138-162`): `false` khi archive tắt (`enabled: false`) hoặc bản ghi không `JSON.stringify` được (đếm vào `stats().dropped` + `warnOnce`); `true` nghĩa là **đã xếp hàng**, chưa chắc đã ghi đĩa. Test kiểm `stats()` nên dựa vào `written`/`dropped`, không chỉ vào giá trị trả về.

### 17.2 Ghi

- `record(kind, data)` (`:138-162`): `kind` cắt 32 ký tự (rỗng → `'misc'`); serialize ngay; dòng > 64 KiB → thay bằng `{ truncated: true, text: 2000 ký tự đầu }`; xếp hàng đợi gắn `date = vnDate(ts)`; vượt `maxQueue` → bỏ dòng **cũ nhất** (đếm `dropped`).
- `tickFlush()` (`:164-168`): flush; chỉ xoay vòng khi ngày VN đổi **và** đã có lần xoay đầu (`lastRotateDate !== ''`).
- `doFlush()` (`:178-213`): gom theo ngày, `appendFile`; lỗi `ENOENT` (thư mục bị xoá) → xếp lại lô đúng 1 lần (`requeued`), lỗi khác → bỏ lô; `warnOnce` 1 lần/10 phút (`:465-470`). `flushSync()` dùng khi tắt server.

### 17.3 Xoay vòng (`doRotate`, `:252-296`)

Không đụng file hôm nay; `age > keepDays` → xoá; `.jsonl` có `age ≥ gzipAfterDays` → gzip (level 6) rồi xoá gốc; `.gz` đã tồn tại → **nối thêm một thành viên gzip** (gunzip đọc được nhiều thành viên) (`gzipFile`, `:299-309`). Log 🗄️ khi có nén/xoá.

### 17.4 Đọc

- `listDays()` (`:313-342`) → `{ date, count, bytes, gz }[]` tăng dần; ngày có cả `.jsonl` và `.gz` ưu tiên `.jsonl`; đếm dòng 1 lần nhớ theo mtime/size; ngày đã nén ghi vào `HISTORY_DIR/index.json` (`loadIndex`/`saveIndex`, `:345-378`) để không giải nén lại sau khởi động.
- `readDay(date, { offset, limit })` (`:381-421`): `limit` kẹp 1..`HISTORY_READ_MAX = 5000`; đọc `.gz` trước rồi `.jsonl`; bỏ dòng hỏng; giữ tham chiếu stream gốc để `destroy()` không rò fd khi dừng sớm (`:392`).
- `hasDay(date)` (có `.jsonl` hoặc `.gz`); `isFrozenDay(date)` (`:431-435`: **chỉ còn** `.gz`, không còn `.jsonl` → đã xoay vòng, không ghi thêm → nội dung bất biến) — server **đang dùng** trong `handleHistory()` để đặt `Cache-Control: public, max-age=86400` cho `GET /api/history?date=` khi ngày đã đóng băng, ngược lại `no-store` (`src/server.ts:320-321`); `stats()`.

### 17.5 Ai ghi gì

| kind | Ai | Khi |
|---|---|---|
| `log` | World `log()` (`world.ts:891`) | mọi `LogEntry` |
| `kpi` | World `endDay` (`:2417`) | `{ day, weekday, results }` cuối ngày |
| `recap`, `hr`, `beat`, `news` | Director qua `world.getArchive().record()` (`director.ts:2967`) | xem [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) |

HTTP `GET /api/history` (`server.ts:289-290, 435`) đọc qua singleton này — xem [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md).

---

## 18. Dev events (`world.ts:2676-2760`)

`DEV_EVENTS` (`:105-108`) = 13 tên của `DevEventName` (`types.ts:454-457`).

| Tên | World xử lý | Ghi chú |
|---|---|---|
| `speed` (action riêng) | `setSpeed(v)`: realtime → toast ⏱️ từ chối; nén: `v ∈ ALLOWED_SPEEDS` và khác hiện tại → `spd = v`, toast ▶️/⏩, `forceFrame` | |
| `boss_leave` | `devBossLeave`: đặt `plan.forced = { start: m, dur: U{60..150}, reason }` rồi `processBoss()`; đang trong cảnh → toast "sẽ ra ngoài ngay khi nói chuyện xong"; các trạng thái khác toast lý do | |
| `boss_return` | `devBossReturn`: `away` → `bossReturn`; `leaving` → đổi ý 🔙 quay lại phòng; có mặt → toast; chưa đến/đã về → gọi tới ngay, `leaveAt = max(leaveAt, min(m + 90, 22:00))`, đánh `done` các chuyến đã qua | |
| `end_day` | `devEndDay`: **realtime → chỉ đặt `leaveAt = m` cho mọi người, không kết thúc ngày** (ngày mới lúc 0:00); nén → `endDay('dev')` | nút ở production realtime không làm điều người bấm mong đợi |
| `deal` | `devDeal`: chọn sales đang có mặt (hoặc bất kỳ sales) → `closeDeal`; không có sales → `director.onEvent('deal')` | |
| `release` | `release()` | |
| `server_down`, `wifi_down`, `payday`, `birthday`, `drama`, `hr_review`, `news`, `showrunner` | `director.onEvent(name)`; không có Director → toast ⚠️ | logic ở Director |

---

## 19. Bảng hằng số và ngưỡng (tổng hợp, giá trị hiện tại)

| Hằng | Giá trị | Vị trí | Ý nghĩa |
|---|---|---|---|
| `TICK_MS` / `FRAME_MS` / `AGENTS_MS` | 100 / 200 / 2000 ms | `world.ts:33-35` | nhịp tick / frame / agents+status |
| `WALK_TILES_PER_SEC` | 3.2 (× `min(speed, 4)`) | `:37` | tốc độ đi bộ |
| `LOG_KEEP` / `MEMORY_KEEP` / `KPI_HISTORY_KEEP` | 200 / 8 / 14 | `:38-40` | trần bộ nhớ |
| `DOORS` | (0,16), (0,17) | `:41` | cửa chính |
| `CANDIDATE_WAIT` | 5 ô y=11 (x 32,35,31,36,30) | `:44` | chỗ ứng viên chờ |
| `SPOT_RADIUS` / `SPOT_VICTIM_CD` / `SPOT_GLOBAL_CD` | 4.5 ô / 90 / 30 phút game | `:45-47` | bắt quả tang |
| `SCENE_WATCHDOG_MS` | 5 phút thật | `:48` | tự gỡ cảnh treo |
| `CANDIDATE_MAX_WAIT` / `REMOVE_TIMEOUT` / `INCIDENT_MAX` | 120 / 45 / 150 phút game | `:49-51` | |
| `MONTH_DAYS` / `REVENUE_TARGET` | 20 ngày / 1500 triệu | `:52, 56` | tháng doanh thu |
| `HOMEOSTASIS_MOOD` / `HOMEOSTASIS_STRESS` | 0.006 / 0.004 mỗi phút | `:54-55` | kéo về mức nền |
| `T_*` | xem §9.1 | `:57-65` | mốc giờ |
| `WORK_MINUTES` | 510 | `:185` | 08:00–17:30 trừ 60' trưa |
| `TRAIT_*`, `DRIFT_BOUND`, `OPENING_*_BAND`, `DAY_FACTOR_*`, `DAY_NOTES_MAX`, `PERSONAL_EVENT_P` | xem §10.1 | `:68-91` | v3 |
| Giữ chỗ `visitorSpot` | 16 offset + vành 3..7 | `:598-614` | |
| `walkableNear` | vành 1..6 → `ENTRANCE` | `:1234` | |
| `lineOfSight` | 4 mẫu/ô | `:1282` | |
| `panicSwitch` | 0.5 khi sếp đến, 1 khi sếp về | `:1961, 2228` | |
| `relaxWave` | `clamp((laz − 0.3)·1.6, 0, 0.9)`, trễ 0–3' | `:2262-2264` | |
| `bossPressure` | ≤ 10 ô → 1; phòng sếp đứng yên → 0.75 | `:1748-1749` | |
| `kpiBehind` | `< 0.85 × kỳ vọng` | `:1762` | |
| Project | `progressPending += 0.016·k`; deadline `+U{4..6}`; progress đầu U(15,35) | `:1718, 1814-1816` | |
| Deal | `0.004·(0.5 + dil)`/phút; +U{10..80} triệu; KPI +40 | `:1721, 1786-1788` | |
| `computeResults` | coverage ≥ 0.3; lossShare ≤ 0.8; sàn target 0.15 | `:2443-2453` | |
| `planDay` reset | energy U(75,95); stress −25 (sàn 10); mood +30% về 60 | `:2514-2516` | |
| `planBossTrips` | 0/1/2 chuyến 40/45/15%; dur U{60..150}; cách U{30..75} | `:2319-2329` | |
| `planLunches` | ≥ 4 nhân viên & 70%; bạn ≥ 15; nhóm 2–3 | `:2585-2592` | |
| `maybeInvite` ngưỡng | `a→b ≥ 20`, `b→a ≥ 0` | `:1671` | |
| `findPingpongPartner` | bỏ `laz < 0.4`, `rel < −30` | `:1639, 1643` | |
| `recordClick` trần | 500 sản phẩm × 16 nguồn | `:993-998` | |
| `MAP_W × MAP_H` | 60 × 34 | `map.ts:13-14` | |
| `ACTIONS` dur/cooldown | xem §7.3 | `behavior.ts:51-67` | |
| `KPI_TARGET_REF` | 260; `roleKpiFactor` kẹp 0.7..1.4 | `behavior.ts:129-136` | |
| `LUNCH_FROM/TO`, `NAP_SAFE_TO` | 12:00 / 13:00 / 13:15 | `behavior.ts:146-148` | |
| `STATE_VERSION` | 1 | `persist.ts:5` | |
| Archive | keepDays 180; gzipAfterDays 7; flushMs 2000; maxQueue 5000; maxLineBytes 64 KiB; `HISTORY_READ_MAX` 5000; rotate sau 5 s; warnOnce 10 phút | `archive.ts:20, 84-90, 118, 467` | |
| Showroom | `MAX_ITEMS` 40; id ≤ 80; name ≤ 120; note ≤ 200; image ≤ 500 | `showroom.ts:9-10, 40-65` | |
| Server (liên quan) | `SAVE_EVERY_MS` 60 000; `HEARTBEAT_MS` 30 000; `DEV_RATE` 10/5 s | `server.ts` hằng số đầu file | |
| Client | `NET_BUFFER_MIN/MAX/START` 260/700/340 ms | `public/js/store.js:146` | |

---

## 20. Biến môi trường World đọc (tên lấy từ `src/config.ts` và `.env.example`; không ghi giá trị bí mật)

| Biến | Mặc định | World dùng ở |
|---|---|---|
| `TIME_MODE` | `compressed` | `config.timeMode` → `mode` (`world.ts:470`); `realtime` theo giờ VN, cuối tuần đóng cửa, không tua |
| `GAME_MINUTES_PER_SECOND` | 0.5 | `gmps`, kẹp (0, 60] (`:471-472`) |
| `PERSIST` | true | `save()`/`load()` bỏ qua khi false (`:1007, 1023`) |
| `STATE_FILE` | `data/state.json` | `config.stateFile` |
| `COMPANY_NAME` | `Cty TNHH VibeCorp` | `hello.companyName`, `CompanyState.name` |
| `KPI_LOW_RATIO` | 0.7 | `computeResults` (`:2458`); `hello.rules` |
| `KPI_WARN_DAYS` / `KPI_FIRE_DAYS` | 2 / 3 | chỉ gửi trong `hello.rules`; luật áp ở Director/HR |
| `DEV_PANEL` | true | giá trị mặc định `hello.dev` (`:918`); server ghi đè theo socket |
| `DEV_TOKEN` | rỗng | server đọc, không phải World; rỗng = `DEV_PANEL` quyết cho mọi người; có giá trị = chỉ socket có mã mới có quyền dev (admin mở trang kèm `#dev=<mã>` một lần, lưu localStorage + cookie HttpOnly qua `POST /api/dev/login`) |
| `STORY_RANDOMIZE_TRAITS` | true | `freshInit` → `randomizeOpeningTraits` (`:2981`) |
| `STORY_TRAIT_DRIFT` | true | `driftTrait` (`:751`) |
| `HISTORY_ENABLED` / `HISTORY_DIR` / `HISTORY_KEEP_DAYS` / `HISTORY_GZIP_AFTER_DAYS` | true / `data/history` / 180 / 7 | server `getArchive().configure()` trước khi dựng World; `config.ts` ép tối thiểu 1 ngày |
| `LLM_ONLY_WHEN_WATCHED` | true | brain/Director đọc; World chỉ cấp `viewers` qua `setViewers` |
| `DAILY_BUDGET_USD`, `AI_<TÊN>_MODEL`/`OPENAI_MODEL` | — | World chỉ dùng `config.dailyBudgetUsd`/`config.model` cho `StatusInfo` dự phòng khi `brain.usage()` lỗi (`:2844-2845`) |

---

## 21. Test liên quan (chỉ đọc)

- `npm run smoke` (`scripts/smoke.ts`): World + Director + Brain offline ≥ 6 ngày game, `new World({ config: { ...CONFIG, persist: false, … }, brain, emit, now })`, Director bọc "spy" `DirectorApi` (`smoke.ts:296-307`), bước `world.advance(100)`, archive ghi thư mục tạm. Khẳng định lõi (`smoke.ts:822-868`): không lỗi/warn nguy hiểm; mỗi ngày có người đến/về, không ai kẹt; KPI chấm mỗi ngày; không NaN/ngoài bản đồ/trong tường; không giữ `sceneId` > 4 phút; log ≤ 200, ký ức ≤ 8, KPI history ≤ 14; quan hệ chỉ trỏ người tồn tại; bản đồ v2 mọi chỗ tới được; showroom đúng kệ; WC ẩn; `hello.products` đúng url; đếm click; nút dev có phản hồi. v3 (`:573-697`): tính cách ngẫu nhiên hoá trong dải; `driftTrait` kẹp ±0.25 & id lạ → NaN; `dayFactor` 0.55..1.2 đổi theo ngày; log lý do tiếng Việt có dấu; `setRole/setProbation/grantBonus/headcount/removeAgent('resigned')` 👋; sếp/HR không bị loại; archive đủ dòng/đọc lại/xoay vòng/.gz/không rò fd/index.json; `hello.news` ≤ 5. Biến: `SMOKE_DAYS, SMOKE_MAX_DAYS, SMOKE_SEED, SMOKE_SPEED, SMOKE_DEV, SMOKE_VERBOSE`.
- `npm run smoke:story` (`scripts/smoke-story.ts`): 6 hạt × 12 ngày; `console.warn` chứa "lỗi|quá 23:00|kẹt trong cảnh|failsafe" là lỗi, trừ "Bỏ qua removeAgent" (`smoke-story.ts:66`).
- `scripts/eyeball-hr.ts`, `test-router.ts`, `test-llm.ts` dựng World offline làm "seed" lấy `PromptContext`. Không có framework test; `npm test` = typecheck + các script (`package.json`). Chi tiết ở [11-kiem-thu-qa.md](11-kiem-thu-qa.md).

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật | → chạy |
|---|---|---|
| Hằng số thời gian/mốc giờ (`T_*`, `DAY_START`, `ALLOWED_SPEEDS`) | §2, §9.1, §19 tài liệu này; README §10; `SPEC.md` §3 | `npm run smoke` (kiểm "mỗi ngày có người đến và về", "không quá 23:00") |
| Realtime (`step` nhánh `realDay > curDay`, `endDay('rollover')`, `placeForCurrentTime`, `freshInit` realtime) | §2.2 (bẫy ngày bị bỏ qua), §9.8, §9.10, §16.4 | smoke chỉ chạy `compressed` (`scripts/smoke.ts:97`) — thử tay `TIME_MODE=realtime` với **bản sao** `data/state.json` có `savedAt` cũ vài ngày, xem log 🌙/🌅 và `/api/history` |
| Bản đồ (`ROOMS`, `DESKS`, `SPOTS`, tường/cửa) | §3; `PATROL_ROUTES`, `CANDIDATE_WAIT`, `KPI_BOARD_STOP`; [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md); `docs/v2-contract.md` §1 | `npm run smoke` ("mọi chỗ / ghế tới được từ cửa", "không trong tường") |
| `ACTIONS`, `PER_MINUTE`, `ON_COMPLETE`, trọng số utility | §7.3–7.5, §8.1, §19; `SPEC.md` §4 | `npm run smoke` + `npm run smoke:story` (cân bằng KPI/đuổi việc) |
| Công thức KPI (`kpiRate`, `roleKpiFactor`, `kpiBehind`, `computeResults`) | §8.2, §9.9; README §10 (KPI); [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) nếu `KpiResult` đổi | `npm run smoke:story` (không ai bị "đánh dấu") |
| `ROLE_INFO.kpiTarget` trong roster | bảng §8.2 | `npm run smoke` |
| `Activity`, `AgentState`, `FrameAgent` flags, `PublicAgent`, `StatusInfo` | `src/types.ts` trước; §4, §15; [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md); client `public/js/*` | `npm run typecheck`, `npm run smoke` |
| Shape `serializeWorld()`/`Rt`/`restoreWorld` | §16; cân nhắc `STATE_VERSION`; `reviveRt`/`reviveAgent` phải nhận file cũ | `npm run smoke`; thử khởi động lại với `data/state.json` thật (bản sao) |
| `normalizeRestored` (thứ sống qua restart) | §16.5, §14 | thử restart giữa cảnh/giữa WC |
| Tính cách v3 (`randomizeOpeningTraits`, `driftTrait`, `dayFactor`, sự kiện cá nhân) | §10; `SPEC.md` §2/§10.4 (hiện lệch); README §6 | `npm run smoke` (v3 checks), `npm run smoke:story` |
| Sếp (`planBossTrips`, `processBoss`, `detectSlackers`, `panicSwitch`) | §11; Director `onBossReturned` log (tránh trùng với `bossReturn`, `world.ts:2229`) | `npm run smoke` (bossLeft/bossBack/slackerSpots) |
| `WorldApi`/`DirectorApi` (thêm method) | `src/types.ts`; §12.4, §13; [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md); nếu bỏ duck-typing `WorldV3` sửa `director.ts:94` | `npm run typecheck` |
| `hello()`, `output()`, `statusInfo()` | §15; **nhớ `publicStatus()`/`hello.dev` ở server** — đường phát mới phải lọc hệ thống cho người xem thường; [02](02-kien-truc-va-giao-thuc.md), [08](08-frontend-giao-dien.md) | `npm run smoke`; mở trang không có mã dev kiểm bằng mắt |
| `recordClick`/`clickStats` | §15.2; README §5.3; `/api/stats` ở server | `npm run smoke` ("đếm click theo sản phẩm × nguồn") |
| `showroom.ts` (kệ, url, slot) | §15.3; `docs/v2-contract.md` §2; README §5.1 | `npm run smoke` ("hello.products…") |
| `setDeskItem`, `fixDeskItems`, preset `deskItemProductId` / `DESK_ITEM_TAGS` trong roster | §15.4; [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) §11.5; [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md) §5.4 (danh sách preset) | `npm run smoke` |
| `archive.ts` (format dòng, xoay vòng, đọc, `isFrozenDay`) | §17; `SPEC.md` §10.3; README §8; `/api/history` ở server (`Cache-Control` theo `isFrozenDay`, `server.ts:320`) | `npm run smoke` (v3 archive checks) |
| `DEV_EVENTS`/`DevEventName` | §18; `src/types.ts`; bảng dev client; README §9 | `npm run smoke` với `SMOKE_DEV=1` |
| Biến môi trường mới cho World | §20; `.env.example`; `src/config.ts`; [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md) | `npm run typecheck` |

---

## Câu hỏi còn mở / cần kiểm tra

1. **SPEC lệch code về tính cách lần đầu**: `SPEC.md` §2 (~205-207) và §10.4 (~992) nói "kéo trait cực đoan về vùng bình thường"; code `randomizeOpeningTraits` (`world.ts:216-224`) thay thẳng diligence/laziness của mọi nhân viên bằng U(0.45, 0.7)/U(0.35, 0.6). Cần sửa SPEC theo code.
2. **SPEC §3** `day = floor(time/1440)+1` không phải cách code làm (`curDay` riêng, `world.ts:419`). Nên sửa thành "`curDay` là trường riêng, `t` luôn trong `[(curDay−1)·1440, curDay·1440)`".
3. **`WorldApi` thiếu method v3** (`driftTrait`, `setRole`, `setProbation`, `grantBonus`, `headcount`, `removeAgent`, `getArchive`) — Director dùng duck-typing `WorldV3`; Director còn kiểm `w.getNews` mà World không có. Nên đưa vào interface hoặc ghi rõ "mở rộng tuỳ chọn".
4. **Dòng "ngày 1 giả" trong archive mỗi lần restart** (§16.6): đúng 1 dòng 🌅 (hoặc 🏖️), suy ra từ thứ tự `freshInit()` → `load()`; cần xác nhận bằng cách xem `data/history/<hôm nay>.jsonl` sau một lần restart (chưa kiểm tra file thật). Cách tránh nếu muốn: hoãn `planDay(1)`/dòng log mở cửa tới sau khi `load()` thất bại, hoặc cho `freshInit` nhận cờ "im lặng".
5. **`onDayStart` không gọi sau khôi phục** (`world.ts:1066`) — Director phải tự khôi phục lịch ngày từ `restore()`; cần kiểm tra Director hiện có xử lý đủ (ví dụ lịch `hr_review`, beat đã lên) khi server restart giữa ngày.
6. **`MONTH_DAYS = 20`** đếm ngày game kể cả Thứ Bảy/Chủ Nhật ở realtime (`closedToday`) → "tháng" ≈ 20 ngày lịch (~14 ngày làm việc), không nhất quán với chế độ nén (20 ngày làm việc). Cần xác nhận ý định.
7. **`end_day` ở realtime** chỉ cho mọi người về sớm, không kết thúc ngày (`world.ts:2744-2749`) — nút dev trên production (realtime) không làm điều người bấm mong đợi; cân nhắc đổi nhãn nút hoặc hành vi.
8. **`endDay` xoá ứng viên đang chờ** (`:2400`) — nếu Director lên lịch phỏng vấn sát 18:00 (night skip) ứng viên biến mất không có cảnh. Cần kiểm tra Director có tránh giờ này.
9. **`restoreWorld` từ chối file không có sếp active** (`:3086`) → làm mới toàn bộ và cách ly file. Nếu tương lai cho phép "công ty không sếp" phải nới điều kiện.
10. **`recordClick` `console.log` mỗi lượt** (`:1002`) — traffic lớn sẽ ồn log pm2; cân nhắc gom.
11. **`deskItemCache`/`showroomCache`** chỉ tính 1 lần/tiến trình → đổi `data/products.json` phải restart. (2026-11-03: danh mục đã thay bằng 26 món chính thức; `docs/real-products.json` chỉ còn giá trị lịch sử.)
12. **`walkTo` dịch chuyển tức thời khi không có đường** (`:1219-1223`) — smoke chỉ kiểm "mọi chỗ tới được từ cửa", không kiểm mọi cặp (chỗ ↔ ghế); nếu bản đồ sửa sai, nhân vật "nhảy" mà không có cảnh báo. Cân nhắc `console.warn` có giới hạn tần suất ở nhánh này.
13. **`maybeInvite` cần `a→b ≥ 20`** — vài ngày đầu gần như không ai rủ ai ngoài các cặp `INITIAL_RELATIONSHIPS`; có vẻ là ý đồ, cần xác nhận với chủ dự án.
14. **`trackSpeedLoss` chỉ bù khi speed > 3** — nếu đổi `WALK_TILES_PER_SEC` hoặc `min(speed, 4)` phải xem lại ngưỡng `s <= 3` (`:1181`) và `min(s, 3)` của cảnh.
15. **Archive xoay vòng khi server khởi động đúng lúc đổi ngày VN trong 5 s đầu**: lần xoay đầu dùng ngày mới — chấp nhận được, chưa có test.
16. **Ý tưởng trong chú thích code chưa làm**: `docs/v3-news.md` gợi lưu `state.json` mỗi 15 s thay 60 s; `world.ts:2229` World chỉ log "Sếp đã về" khi không có Director — nếu Director đổi hành vi phải sửa cả hai chỗ.
17. **Realtime bỏ qua ngày khi server tắt lâu** (§2.2): hệ quả của `endDay('rollover', realDay)` chạy một lần; code không có chú thích nói đây là cố ý. Nếu muốn lịch sử liền mạch phải thêm vòng lặp "ngày trống" (ghi `kpi` rỗng hoặc đánh dấu `skipped`) — cần hỏi chủ dự án.
18. **Liên kết chéo tới `13-viec-con-lai-va-y-tuong.md`** (§12.4): từng bị báo "gãy" khi file 13 chưa được tạo; hiện file đã có và dòng 78 của nó theo dõi đúng món nợ `WorldApi` thiếu method v3 — nếu đổi tên/xoá file 13 phải sửa lại §12.4.
