# Kiểm thử & QA

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `package.json` (các script `test*`/`smoke*`/`eyeball:hr`), `tsconfig.json`, `scripts/*.ts`, `scripts/fixtures/news/`, móc QA `window.__vpa` (`public/js/main.js:3-4`), `DEBUG_PROMPTS` (`src/ai/llm.ts:279`) · Đọc khi: sắp chạy `npm test`, test đỏ không hiểu vì sao, muốn thêm kiểm tra cho router/Director, muốn thử một model AI thật, hoặc vừa sửa giao diện và cần tự duyệt bằng ảnh chụp.

Tài liệu này trả lời: **`npm test` gồm những gì và mỗi bước kiểm cái gì**, server giả lập OpenAI hoạt động ra sao, hạt giống (seed) và đồng hồ ảo được gài ở đâu, chạy riêng từng script và bật log chi tiết thế nào; cách **thử model AI thật** mà không lộ key; cách **QA hình ảnh** bằng Chrome headless qua CDP (chưa có script trong repo — mô tả cách dựng lại), đo độ mượt qua `window.__vpa`; checklist khi đổi giao diện; và khuôn mẫu để **viết test mới** cho router / Director.

Liên quan: [`01-tong-quan.md`](01-tong-quan.md) (bức tranh chung, "không có framework test"), [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md) §2.3 (cách dựng World/Director headless), [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md) (Director, hàng rào HR mà `smoke-story` kiểm lại), [`05-lop-ai.md`](05-lop-ai.md) (Brain/Router mà `test-llm`/`test-router` nhắm tới), [`06-tin-tuc-thoi-su.md`](06-tin-tuc-thoi-su.md) (bộ lọc tin mà `test-news` kiểm), [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) (mọi biến môi trường), [`10-van-hanh-deploy.md`](10-van-hanh-deploy.md) (chạy test trước khi deploy), [`07-frontend-ve-canvas.md`](07-frontend-ve-canvas.md) / [`08-frontend-giao-dien.md`](08-frontend-giao-dien.md) (phần giao diện cần QA). Hợp đồng gốc: `SPEC.md` §9 "Testing expectations" và §10.6; `README.md` §12 "Kiểm tra / test". Tài liệu này **không chép lại** các mục đó mà mô tả code test hiện tại và chỉ ra chỗ lệch.

---

## 1. Bức tranh chung

### 1.1 Không có framework test

Toàn bộ kiểm thử là **script TypeScript chạy thẳng bằng `tsx`**, không Jest/Vitest/Mocha, không trình duyệt, không ra Internet. Mỗi script:

- tự gom khẳng định vào một mảng (`check(name, ok, info)`), cuối cùng in bảng `✅/❌` và `process.exit(1)` nếu có khẳng định thất bại (`smoke.ts:889-890`, `smoke-story.ts:551-552`, `test-news.ts:305-306`, `test-llm.ts:839-841`, `test-router.ts:845-847`);
- bắt lỗi/cảnh báo của mã nguồn theo **hai kiểu khác nhau**: smoke/smoke-story bọc `console.error` + `console.warn` và nghe `unhandledRejection`/`uncaughtException` → mảng `problems` (tính là lỗi; `smoke.ts:63-71`, `smoke-story.ts:63-72`); test-llm/test-router **chỉ bọc `console.warn`** → mảng `warned` để soi bằng `leaks()` (`test-llm.ts:42`, `test-router.ts:41`), còn `unhandledRejection` được đẩy thẳng vào `failures` (tính là khẳng định đỏ → `exit 1`; `test-llm.ts:43`, `test-router.ts:42`); `console.error` và `uncaughtException` **không** bị bắt ở hai script này;
- dùng **đồng hồ ảo** (`vt`) tiêm vào `createBrain(cfg, { now })` / `new World({ …, now })` để chạy nhiều ngày game trong vài giây mà mọi nhịp (cooldown, RPM, cầu dao, reserve) vẫn đúng. Ngoại lệ là hạn chót HTTP trong Brain/Router dùng `Date.now()` thật → vài mục của `test-llm`/`test-router` phải **chờ thật** ≈ 1,5–5,5 s (test-llm mục 8 ≈ 3,5 s; test-router mục 6 ≈ 5,5 s — xem §6, §7). Ngưỡng quyết định "sau một lượt treo còn thử provider kế không" là `ROUTER_POLICY.minAttemptMs` 2 500 ms (`minAttemptReasoningMs` 6 000 ms cho model suy luận; `src/ai/router.ts:32-33`): phần giờ còn lại tới hạn chót nhỏ hơn ngưỡng → không mở lượt mới, về offline.

`npm test` (`package.json:14`) nối 6 bước bằng `&&`, **dừng ở bước đầu tiên lỗi**:

```
npm run typecheck && npm run smoke && npm run smoke:story && npm run test:news && npm run test:llm && npm run test:router
```

| Lệnh | File | Kiểm cái gì (một câu) | Mạng? | Thời gian (ước, README §12 / SPEC §9 — chưa đo lại 2026-11-02) |
|---|---|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | Kiểu TypeScript của **cả `src/` và `scripts/`** (`tsconfig.json` `include: ["src", "scripts"]`) | không | vài giây |
| `npm run smoke` | `scripts/smoke.ts` (890 dòng) | World + Director + Brain **offline** ≥ 6 ngày game: bản đồ v2, vòng ngày, cảnh/thoại, KPI, WC ẩn, phòng trưng bày, click affiliate, nút dev, serialize/restore, tính cách v3, archive, kho tin | không | ~6 s |
| `npm run smoke:story` | `scripts/smoke-story.ts` (552 dòng) | 6 hạt giống × 12 ngày: quyết định HR qua **hàng rào kiểm lại độc lập**, thời sự kèm thẻ tin, AI biên kịch, "không ai bị đánh dấu", kịch bản doanh thu 0 | không | ~30 s |
| `npm run test:news` | `scripts/test-news.ts` (306 dòng) | Bộ đọc RSS, tiện ích văn bản/ngày, danh sách chặn, lọc tin cũ/giải trí, `NewsStore` với `fetcher` giả | không | vài giây |
| `npm run test:llm` | `scripts/test-llm.ts` (841 dòng) | Đường AI với **1 server OpenAI giả lập**: `reserve()`, sanitize, tính tiền, lỗi HTTP, cầu dao, ngân sách, v3 (news/hr/verdict/beats), kích cỡ prompt, World+Director chế độ "GPT" | không (localhost) | vài chục giây (chờ thật ≈ 3,5 s ở mục 8 + `sleep(1)` thật mỗi 4 bước ở mục 15) |
| `npm run test:router` | `scripts/test-router.ts` (847 dòng) | Router nhiều provider với **2 server giả lập** Alpha/Beta: failover, 429/quota ngày, RPM/RPD/TPD, 401/404, 500, json_schema→json_object, cầu dao, tier strong, thống kê/snapshot, cấu hình cũ, không lộ key, pace/balanced/trần token | không (localhost) | vài giây (chờ thật ≈ 5,5 s ở mục 6: 1,5 s ca Alpha treo + ~4 s ca cửa sổ bị hạn chót cắt ngắn) |
| `npm run eyeball:hr` | `scripts/eyeball-hr.ts` (112 dòng) | **Không trong `npm test`.** Gọi AI **thật** đúng 1–3 cảnh `hr_review` để người đọc tự đánh giá thoại + `hrDecisions` | **có** (tốn quota thật) | 10–60 s tuỳ provider; thoát `0` trừ khi World mất HR/sếp (`exit 1`, §8) |

### 1.2 Bẫy chung cho mọi script

| Bẫy | Chi tiết | Hệ quả |
|---|---|---|
| `tsconfig.include` có `scripts/` | Một lỗi kiểu trong bất kỳ file test nào làm `npm run typecheck` đỏ | `npm test` dừng ở bước 1 dù `src/` sạch |
| `CONFIG` đọc `.env` thật của máy | `src/config.ts:1-2` gọi `loadEnv({ quiet: true })` ngay khi import; mọi script đều `import CONFIG` rồi mới ghi đè vài trường | Các trường **không** ghi đè (vd `kpiLowRatio`, `productMentionMinMinutes`, `hrReviewEveryDays`, `newsSceneMinMinutes` ở smoke) phụ thuộc `.env` cục bộ → cùng seed, hai máy có thể ra kết quả khác |
| `SHOWROOM_SCENE_MIN_MINUTES` không qua `CONFIG` | Director đọc thẳng `process.env` trong `showroomMinMs()` (`src/sim/director.ts:65-69`) | Test không ghi đè được qua object config; muốn đổi phải đặt biến môi trường khi chạy |
| Hạt giống phải gài **trước** khi `import` module | smoke/smoke-story thay `Math.random` bằng `mulberry32(seed)` rồi mới `await import()` (`smoke.ts:28-42` — `SEED` :41, `Math.random = mulberry32(SEED)` :42 — rồi `await import()` ở `:74-86`; `smoke-story.ts:28-52` — `SEED0` :41, `rng`/`Math.random` :51-52 — rồi import `:75-83`) | Đảo thứ tự → roster/tính cách ngẫu nhiên lúc nạp module không theo seed, không tái hiện được |
| `offline.ts` có cache chống lặp cấp module | `RECENT_MAX = 2500` câu, dùng chung cho mọi Brain trong cùng tiến trình | Trong test-llm/test-router nhiều Brain cùng chia một cache — không ảnh hưởng kết quả nhưng câu thoại offline giữa các mục không độc lập |
| Id sản phẩm ghi cứng | `smoke.ts:525-529` dùng `son-kem-li` và `ban-phim-co` để test `recordClick` | Đổi/xoá 2 id này trong `data/products.json` làm smoke đỏ |
| Cổng cố định cho mock | test-llm dò `4500–4599`; test-router dò `4600–4699` (Alpha từ 4600, Beta từ 4601) | Hai script chạy song song vẫn ổn (tự dò cổng trống), nhưng cổng bị chiếm hết → ném lỗi "không tìm được cổng trống" |

### 1.3 Chạy riêng và bật log chi tiết

```bash
npm run smoke                                   # mặc định: seed theo giờ, in seed ở dòng đầu "🧪 Smoke test — seed N"
SMOKE_SEED=123 npm run smoke                    # chạy lại y hệt một lần đã đỏ
SMOKE_VERBOSE=1 SMOKE_SEED=123 npm run smoke    # in toàn bộ log văn phòng + cảnh báo thật
SMOKE_STORY_SEED=123 SMOKE_STORY_SEEDS=1 SMOKE_STORY_VERBOSE=1 npm run smoke:story
TEST_VERBOSE=1 npm run test:llm                 # test-llm / test-router: in console.warn thật thay vì chỉ gom vào mảng `warned`
TEST_VERBOSE=1 npm run test:router
npx tsx scripts/smoke.ts                        # tương đương npm run smoke (không cần qua npm)
```

`TEST_VERBOSE` chỉ có ý nghĩa với `test-llm.ts:42` và `test-router.ts:41` (bọc `console.warn`). smoke/smoke-story dùng biến riêng `SMOKE_VERBOSE` / `SMOKE_STORY_VERBOSE`. Khi một khẳng định đỏ, dòng cuối luôn in lại seed (`❌ N khẳng định thất bại (seed S)`) — **copy seed đó** vào biến môi trường để tái hiện trước khi sửa.

---

## 2. `npm run typecheck`

`tsc --noEmit` với `strict`, `module NodeNext`, `target ES2022`, `types: ["node"]` (`tsconfig.json`). Vì là ESM, import nội bộ phải có đuôi `.js` kể cả trong `scripts/`. Các script dùng `await import()` ở top-level (smoke, smoke-story, test-llm mục 15) nên cần ES2022.

TypeScript đang là `^7.0.2` (`package.json`) — bản major mới; khi nâng cấp phải chạy lại typecheck vì `tsc` có thể đổi hành vi (cần kiểm tra).

---

## 3. `npm run smoke` — `scripts/smoke.ts`

### 3.1 Mục đích

Chạy nguyên bộ mô phỏng **offline** (không mạng, không ghi `data/state.json`) tối thiểu 6 ngày game bằng đồng hồ ảo, bắt mọi lỗi/cảnh báo, rồi kiểm ~35 khẳng định về World, bản đồ v2, phòng trưng bày, WC ẩn, click affiliate, nút dev, serialize/restore và phần v3 (tính cách ngẫu nhiên, archive, kho tin). Các khẳng định về **câu chuyện** (hàng rào HR, beats, news_chat) **không** nằm ở đây mà ở `smoke-story.ts` (ghi chú `smoke.ts:548, 702, 839`).

### 3.2 Biến môi trường

| Biến | Mặc định | Ý nghĩa | Nguồn |
|---|---|---|---|
| `SMOKE_DAYS` | `6` (≥ 1) | số ngày game tối thiểu | `smoke.ts:44` (hằng `MIN_DAYS`) |
| `SMOKE_MAX_DAYS` | `10` (≥ `SMOKE_DAYS`) | chạy thêm tới ngày này nếu vòng HR (nhắc → đuổi → phỏng vấn → tuyển) chưa xong | `:45` (`MAX_DAYS`) |
| `SMOKE_SEED` | `Date.now() % 1_000_000_007` | hạt giống `mulberry32`, in ra để chạy lại | `:41-42` (`SEED`) |
| `SMOKE_SPEED` | `1` (chỉ nhận 1\|2\|5\|10) | tốc độ tua qua nút dev; sai → 1 | `:46` (`SPEED`) |
| `SMOKE_DEV` | `1` | `0` = bỏ phần 2 (bấm nút dev) | `:47` (`RUN_DEV`) |
| `SMOKE_VERBOSE` | `0` | `1` = in toàn bộ log văn phòng và cảnh báo thật | `:48` (`VERBOSE`) |
| `SMOKE_SCENE_GAP` | `CONFIG.offlineMinSeconds` (8) | giây ảo tối thiểu giữa 2 cảnh thường; ~25 để giả lập nhịp thưa của chế độ AI | `:99` (trường `offlineMinSeconds` của `config`) |
| `SMOKE_HISTORY_DIR` | `mkdtemp('vpa-smoke-history-')` | thư mục archive; đặt thì **không bị xoá** cuối chạy | `:89` (`HISTORY_DIR`), `:887` |
| `SMOKE_KEEP_HISTORY` | `0` | `1` = giữ thư mục archive tạm | `:873, 887` |

### 3.3 Thứ tự khởi động (bắt buộc giữ)

1. Gài RNG: `Math.random = mulberry32(SEED)` (`:42`; `SEED` đọc từ `SMOKE_SEED` ở `:41`).
2. Bọc `console.error` → `problems`; `console.warn` khớp `/lỗi|quá 23:00|kẹt trong cảnh|failsafe/i` → `problems`, còn lại → `notes` chỉ để in (`:63-69`); `unhandledRejection`/`uncaughtException` → `problems` (`:70-71`).
3. `await import()` lần lượt `config`, `ai/brain`, `sim/world`, `sim/director`, `sim/map`, `sim/scenes`, `sim/archive`, `news/index`, `content/roster` (`:74-86`: `config` ở `:74` … `roster` ở `:86`; `hasShowroomChat` `:80-82` chỉ dùng để in thông tin — xem §3.5 phần 1).
4. Cấu hình ghi đè (`:91-106`): `{ ...CONFIG, openaiKey: '' (tắt AI — công tắc tương thích cũ, xem 05-lop-ai §config), persist: false, kpiWarnDays: 1, kpiFireDays: 2, timeMode: 'compressed', devPanel: true, offlineMinSeconds, historyEnabled: true, historyDir: HISTORY_DIR, newsEnabled: false, storyRandomizeTraits: true, storyTraitDrift: true }`. `kpiWarnDays/kpiFireDays` hạ xuống 1/2 để vòng HR xảy ra trong vài ngày (khác `smoke-story` giữ mặc định 2/3).
5. Kiểm tra **tĩnh** bản đồ v2 (`:108-138`), trước khi dựng World.
6. Archive: `getArchive().configure({ enabled: true, dir: HISTORY_DIR, keepDays: 180, gzipAfterDays: 7, flushMs: 300, now: realNow }).start()` (`:145`). Kho tin: `configureNews({ enabled: false, feeds: [] })`, `clear()`, rồi `inject()` tin từ 2 fixture `gamek-home.xml` (nhóm `game`) và `tuoitre-the-thao.xml` (`the_thao`) với `publishedAt` dời về "vừa rồi" (`:146-153`) — fixture tải 2026-11-01, không dời sẽ bị lọc "tin cũ".
7. `createBrain(config, { now: realNow })` → `new World({ config, brain, emit, now: realNow })` → `new Director(world, brain)` → `world.attachDirector(spy)` (`:262-308`). `spy` là `DirectorApi` bọc Director để đếm `onDayEnd` (lưu KPI từng ngày, kiểm không ai còn `hidden` lúc hết ngày), `onEvent`, `onBossLeft/Returned`, `onSlackerSpotted`, `onAgentArrived(late)`.

Vòng chạy: `step()` tăng `vt += 100`, `world.advance(100)`, `checkStep()`, rồi `await setImmediate` để promise thoại offline kịp về (`:406-415`) — y như server thật chạy `setInterval` 100 ms.

### 3.4 Bộ ghi `emit()` kiểm gì (`:204-259`)

| Thông điệp | Kiểm |
|---|---|
| `frame` | mỗi `[id, x, y, dir, act, emote, flags]`: toạ độ hữu hạn, trong `MAP_W × MAP_H`, ô làm tròn `isWalkable`, `flags` nguyên; **bit 8 (ẩn WC) phải khớp `agent.hidden`** và chỉ đi với `activity === 'toilet'` |
| `agents` | học tên theo id |
| `log` | đếm câu `line`, lưu 4 câu mẫu/loại cảnh, chip sản phẩm phải khớp `^\/go\/[a-z0-9-]+\?src=[a-z0-9_-]+$` |
| `scene` | `start` tạo bản ghi; `end` có `summary` chứa "bị gián đoạn" = `aborted`; `end` không có `start` → problem |
| `recap`, `rumors`, `toast` | gom; tin đồn ≥ 2 phiên bản khác chữ → "tam sao thất bản" |

`checkStep()` (`:332-405`) mỗi bước: `energy/mood/stress ∈ [0,100]`, `kpiToday ≥ 0`; đếm đến/rời; phút trong cảnh giờ hành chính (08:00–17:30 trừ 12:00–13:00); thời gian giữ `sceneId` dài nhất; lượt ghé phòng trưng bày + đứng đúng kệ (`spotKey` `showroom_*` và `roomAt().id === 'showroom'`); WC: `hidden` chỉ khi `present && activity === 'toilet'`, ≤ 30 phút game.

### 3.5 Năm phần và khẳng định chính

| Phần | Dòng | Nội dung | Khẳng định đáng nhớ |
|---|---|---|---|
| 1. Vòng chính | `:430-449` | chạy tới `day > MIN_DAYS && (hrDone() \|\| day > MAX_DAYS)`; `hrDone()` = có `hr_warning` xong + `firing` xong kèm log `hr` "bị cho nghỉ việc" + `interview` xong + log "chính thức gia nhập"; > 2 000 000 bước → "đồng hồ không chạy?" | mỗi ngày ≥ 8 người đến và ≥ 8 rời; hết ngày không ai kẹt lại; câu thoại `≥ 150 × daysRun / 2` và ≥ 12 loại cảnh có thoại; KPI chấm ≥ 5 người/ngày (v3 cho phép < 10); **"cho nghỉ ⇒ phỏng vấn ⇒ tuyển" chỉ kiểm nhất quán, không ép ai bị đuổi**; bản tin ≥ `daysRun − 1` số; có tin đồn biến dạng; ≥ 3 câu có chip; không NaN/ngoài bản đồ; không ai giữ `sceneId` > 4 phút; `hello.log ≤ 200`, `rumors ≤ 12`, `recaps ≤ 14`; `memories ≤ 8`, `kpiHistory ≤ 14`; `director.stats()`: `queue ≤ 40`, `summaries ≤ 12`, `dayEvents ≤ 40`; `brain.usage()`: `mode 'offline'`, `calls 0`; "có hoạt động nhân sự" = có cảnh `hr_warning` **hoặc** ≥ 1 log kind `hr` (`:835`); `relationships` của mọi người chỉ trỏ tới id còn tồn tại (`:851`); phòng trưng bày ≥ 3 lượt ghé đứng đúng kệ và WC `hiddenToggles ≥ 1`, lâu nhất ≤ 30 phút (`:856-857`); `hello.products` ≥ 1 và đúng shape — `url` khớp `^/go/[A-Za-z0-9_-]+\?src=showroom$`, `shelf` ∈ `beauty\|tech`, `slot` nguyên ≥ 0, `note` string, `tags` mảng (`:859-863`); `showroom_chat` **bắt buộc** ≥ 1 cảnh **và** ≥ 1 chip, không còn điều kiện (`:865` — `hasShowroomChat` false chỉ đổi thông điệp lỗi) |
| 2. Nút dev | `:452-499` (bỏ nếu `SMOKE_DEV=0`) | về x1, chạy tới 10:30 rồi `world.handleClient({ t: 'dev', action: 'event', name })` và chờ log/toast khớp regex trong N giây ảo | `boss_return` /Sếp/ 30 s · `boss_leave` 60 s · `wifi_down` 20 s · `payday` /Lương về/ · `birthday` · `deal` /chốt hợp đồng/ · `drama` /drama\|Có biến/i · `server_down` · `hr_review` /rà soát\|xét nhân sự\|nhân sự\|hr_review/i 30 s · `release`; tua x10 300 bước; `end_day` phải tăng `day` đúng 1; rác (`name: 'khong_co'`, `speed: 7`, `null`) không làm sập |
| 3. Serialize/restore | `:501-514` | `director.serialize()` → JSON → `new Director(world, brain).restore()`; `restore('rác')`; `restore({ v: 1, queue: [{ type: 'firing', at: 'x' }], rumors: { list: [{ id: 5 }] } })` không throw; `world.hello()` JSON hoá được | |
| 4. Click affiliate | `:516-545` | `recordClick('son-kem-li','showroom')`, `(…,'sidebar')`, `('ban-phim-co','showroom')`, `('ban-phim-co','nguồn lạ!')` → nguồn `khac`, `('', 'showroom')` bị bỏ | tổng +4; `clicksBy`, `clicksBySource`, `clicksByProductSource` đúng từng ô |
| 5. v3 | `:547-703` | 5a tính cách lần đầu ≠ roster: trait lời nói (`gossip/temper/humor/ambition`) lệch ≤ 0,15; trait công việc của nhân viên trong dải chung `diligence 0.45–0.7 ± 0.15`, `laziness 0.35–0.6 ± 0.15`; mọi trait 0,05..0,95; `traitBase` = bản sao · 5b `driftTrait` kẹp `traitBase ± 0.25`, id lạ → `NaN` · 5c `dayFactor ∈ [0.55, 1.2]` cho ≥ 3 người mỗi ngày và phải **đổi** ít nhất `(số ngày − 1) × 5` lần giữa hai ngày liên tiếp (`:600-605`), có log lý do icon `😪 ✨ 🤒 💔 📱 😤 🎉` tiếng Việt có dấu · 5d (chờ tới 3 000 bước để có nhân viên hiện diện `:612`, rồi tới 4 000 bước để người đó rời hẳn `:629` — phần tốn thời gian nhất của 5) `setRole/setProbation/grantBonus/removeAgent(id,'resigned')` → `status 'fired'`, emote `👋`, `headcount −1`; `removeAgent(hrId,'laid_off')` vô hiệu (sếp/HR không bao giờ bị loại) · 5e archive: tổng dòng ≥ `msgCount.log + daysRun`, có kind `log` + `kpi`, `dropped/errors/queued = 0`, tên file `^\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$`; file giả 10 ngày trước (1 dòng hỏng) + 700 ngày trước → `rotate()` nén 1, xoá 1, đọc `.gz` được 2 dòng · 5e' file giả **riêng** 3 000 dòng ở ngày `vt − 20 ngày` (`:672`, không phải file 10 ngày của 5e) → `rotate()` nén; đọc dở `.gz` đó 60 lần: fd tăng ≤ 2, `index.json[date].count === 3000`, `configure()` mới liệt kê lại < 150 ms · 5f kho tin: `injectedNews ≥ 60`, `pick(['game'])`, `pick(['the_thao'], exclude)` ra `the_thao\|bong_da`, `markUsed/isUsed`, `hello.news ≤ 5` tin vừa dùng ở cuối, `status().enabled === false`, `refreshes === 0` | |

Dọn dẹp (`:871-890`): `archive.stop()`; xoá thư mục tạm trừ khi `SMOKE_KEEP_HISTORY=1` hoặc có `SMOKE_HISTORY_DIR`; `exit(failed ? 1 : 0)`.

### 3.6 Đọc kết quả

Bảng in ra (`:706-815`) gồm: thông điệp theo loại, từng ngày (đến/trễ/rời/xoá/đông nhất/còn lại), cảnh theo loại (bắt đầu · xong · gián đoạn · câu · có sản phẩm), `director.stats()`, câu thoại mẫu, chip sản phẩm, phòng trưng bày/WC, **KPI từng người từng ngày** (`!` = dưới `kpiLowRatio`), phút trong cảnh TB/ngày, dòng `hr`, bản tin, tin đồn, sếp, AI, serialize, nút dev, ghi chú (cảnh báo không nghiêm trọng). Khi đỏ: xem mục "Vấn đề" (tối đa 20 dòng, mỗi dòng cắt 600 ký tự) rồi chạy lại với `SMOKE_VERBOSE=1` và cùng seed.

---

## 4. `npm run smoke:story` — `scripts/smoke-story.ts`

### 4.1 Mục đích

Chứng minh bằng nhiều hạt giống rằng **nhân sự do AI (ở đây là chính sách offline) quyết nhưng không bao giờ vượt hàng rào**, có cảnh thời sự kèm thẻ tin, biên kịch lên beat, và **không ai bị "đánh dấu" làm nạn nhân** (nguyên tắc chủ dự án; `docs/v3-news.md` → phần "V3 — Câu chuyện tự phát triển" → "## Thiết kế", mục 1 "không ai bị đánh dấu trước" và mục 7 "smoke test không ép Tú" — file đó không đánh số §; chú thích "§7" trong `smoke.ts:837` / `smoke-story.ts:12` là chỉ mục 7 của danh sách này). Khác với smoke, ở đây **không tin Director**: mỗi quyết định được kiểm lại bằng `guardOk()` viết độc lập trong file test.

### 4.2 Biến môi trường

| Biến | Mặc định | Ý nghĩa | Nguồn |
|---|---|---|---|
| `SMOKE_STORY_SEEDS` | `6` (≥ 1) | số hạt chạy tuần tự, mỗi hạt một văn phòng mới | `smoke-story.ts:42` |
| `SMOKE_STORY_DAYS` | `12` (≥ 3) | số ngày game mỗi hạt | `:43` |
| `SMOKE_STORY_SPEED` | `1` (1\|2\|5\|10) | tốc độ tua | `:44` |
| `SMOKE_STORY_SEED` | theo giờ | hạt đầu; các hạt sau +1, +2…; kịch bản doanh thu 0 dùng `SEED0 + 1000` | `:41, 434` |
| `SMOKE_STORY_VERBOSE` | `0` | `1` = in log văn phòng **và** `console.error`/`console.warn` thật của **hạt đầu** thôi: cờ `verboseRun` (`:62`) bật ở đầu `runOnce` theo tham số `verbose` (`:202`) và tắt ở cuối lượt (`:415`); các hạt sau và kịch bản doanh thu 0 im lặng | `:45` |

### 4.3 Khác với `smoke.ts`

- `console.log` của mã nguồn bị **tắt hoàn toàn** trừ khi `verboseRun` (`:70`); cảnh báo `/Bỏ qua removeAgent/` không tính là lỗi (`:66`).
- Cấu hình (`:95-109`): giữ `KPI_WARN_DAYS/KPI_FIRE_DAYS` mặc định (2/3 — hàng rào thật), `newsEnabled: true` + `newsSceneMinMinutes: 25`, `showrunnerEnabled: true`, archive vào `mkdtemp('vpa-smoke-story-')` (xoá cuối, **không** có tuỳ chọn giữ).
- Kho tin nạp **cả 3 fixture** (thêm `vnexpress-giai-tri.xml` nhóm `giai_tri`, `:87-91`), `news.clear()` + `inject()` lại ở đầu mỗi hạt; nạp được < 10 tin → problem.
- Mỗi hạt dựng World/Director mới trong `runOnce(seed, verbose, { slump?, days? })` (`:199-417`); `rng = mulberry32(seed)` được gán lại ở đầu mỗi lượt (`:201`).

### 4.4 Hàng rào độc lập `guardOk(d: DecisionInfo)` (`:112-152`)

`DecisionInfo` do Director cung cấp qua `director.hooks.decision` (`src/sim/director.ts:130-142, 411`): `{ day, decision, allowed, source, env, ledger, agent }`. `guardOk` là bản kiểm lại **độc lập nhưng lỏng hơn** `allowedActions()` (`src/sim/hr.ts:195-222`; xem [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md)): nó bỏ qua cooldown `praise` (2 ngày sau thưởng, 3 ngày sau khen — `hr.ts:211-212`) và hai cờ `env.firePending` (khoá `fire`/`layoff`, `:205`) / `env.promotionPending` (khoá `promote`, `:216`). Những điều kiện thiếu chỉ được bắt **gián tiếp** qua `allowed.includes(action)` (`smoke-story.ts:115`) — tức vẫn tin danh sách `allowed` mà Director đưa. Sửa luật ở `hr.ts` thì cập nhật `guardOk` tương ứng (và cân nhắc thu hẹp khoảng cách này):

| Hành động | Điều kiện phải đúng |
|---|---|
| mọi hành động ≠ `none` | `allowed.includes(action)` |
| `open_position` | `env.revenueRatio ≥ 0.8 && env.headcount < 12 && !env.hasOpenPosition && env.freeDesk` |
| `warn` | `lowStreak ≥ 1` |
| `probation` | `lowStreak ≥ 1 && !onProbation` |
| `second_chance` | `lowStreak ≥ 1 \|\| warnings ≥ 1` |
| `fire` | `lowStreak ≥ 2`; `warnings ≥ 1 \|\| lowStreak ≥ kpiFireDays`; thâm niên `day − hiredDay ≥ 3`; `day − ledger.lastFireDay ≥ 2` (không kiểm `!env.firePending` — chỉ qua `allowed`) |
| `praise` | `avg7 ≥ 1.0` với `ratios.length ≥ 2` — **không** kiểm cooldown `day − lastBonusDay[a.id] ≥ 2` và `day − lastPraiseDay[a.id] ≥ 3` của `hr.ts:211-212` (chỉ qua `allowed`) |
| `bonus` | như praise; `day − ledger.lastBonusDay ≥ 7`; `day − ledger.lastBonusAnyDay ≥ 7` (toàn công ty) |
| `promote` | `avg7 ≥ 1.15` với ≥ 5 ngày; thâm niên ≥ 10; `day − lastPromotionDay ≥ 7` (không kiểm `!env.promotionPending`) |
| `layoff` | `lowRevenuePeriods ≥ 2`; thâm niên ≥ 10; `day − lastFireDay ≥ 2`; `layoffsInMonth < 2` (không kiểm `!env.firePending`) |

Ngoài ra (`:413-416`) hai lần `fire`/`layoff` trong cùng hạt phải cách nhau ≥ 2 ngày.

### 4.5 Bên trong `runOnce`

- Gắn `director.hooks.decision` (`:258-262`) — Director gọi móc **sau khi `executeDecision` trả `true`**, nhưng `ledger`/`agent`/`allowed` trong `DecisionInfo` là ảnh chụp **trước** khi thi hành (sổ chưa đổi; `src/sim/director.ts:3297-3310`, chú thích "ảnh chụp TRƯỚC khi thi hành", móc gọi ở `:3311-3317`). Nhờ vậy `day − ledger.lastFireDay ≥ 2` trong `guardOk` mới kiểm được — nếu chụp sau, `lastFireDay` đã bằng `day`. **Đừng đổi thứ tự này trong Director.**
- `slump` ép `world.addRevenue(-revenueMonth)` mỗi bước (`:292-295`) → doanh thu tháng luôn 0.
- Mỗi 50 bước lấy `director.stats()` để theo dõi trần `queue`, `newsUsed`, `newsDiscussed`, `story_arcsOpen/arcsKept/recentBeats` (`:303-310`; khoá `story_*` là `Showrunner.stats()` đổ vào với tiền tố — `director.ts:572-590`).
- Cap 3 000 000 bước (`:325`).
- Nút dev chỉ bấm khi `!opts.slump && (verbose || seed === SEED0)` — tức hạt đầu (hoặc lượt verbose), **không** ở kịch bản doanh thu 0 — và chỉ sau khi về tốc độ x1 rồi chờ tới `minuteOfDay ≥ 600` (10:00) (`:331-333`); 2 nút (`:334-347`): `news` chờ 30 s ảo, khớp `/tin nóng|Tám chuyện thời sự|Chưa có tin|Chưa có nguồn tin|Thời sự đang tắt/` **hoặc** log `scene_start` có `news`; `showrunner` 10 s, `/Biên kịch|mạch truyện|biên kịch/`.
- Round-trip (`:351-370`): so JSON của `story.showrunner.arcs/recentBeats`, `story.ledger`, `newsUsed`, `discussedNews`, `overtime`, `lateTomorrow`, `driftPlans` trước/sau `restore`; restore rác `{ v: 2, story: { showrunner: { arcs: [kind lạ, kind hợp lệ step 99/total 7] }, ledger: { lastFireDay: 'x' }, … } }` phải lọc còn **đúng 1 mạch**; state > 200 000 B bị ghi chú.
- Kết quả gom thành `RunResult` (`:155-196`): tên người bị `fired`/`laidOff`/`resigned`/`warned` lấy từ log kind `hr` theo regex (`/đã bị cho nghỉ việc/`, `/đợt cắt giảm/`, `/xin nghỉ việc và rời/`, `/bị HR nhắc nhở KPI/`, `:395-398`) — **đổi câu chữ log HR là test đếm sai**.

### 4.6 Khẳng định (`:492-538`)

| # | Khẳng định | Ghi chú |
|---|---|---|
| 1 | không lỗi/exception/cảnh báo "lỗi" | |
| 2 | mỗi hạt đủ `DAYS` ngày | |
| 3 | `SCENE_DEFS` có đủ 6 loại v3: `news_chat, hr_review, resign_talk, raise_request, promotion, layoff` | |
| 4 | mỗi hạt ≥ 1 `hr_review` xong + ≥ 1 quyết định thi hành | |
| 5 | **0 vi phạm hàng rào** (từng quyết định) · ≤ 1 đuổi/cắt giảm mỗi 2 ngày | |
| 6 | ≥ 3 loại hành động khác nhau qua các hạt | |
| 7 | mỗi hạt ≥ 1 `news_chat` và **mọi** news_chat có thẻ tin hợp lệ (`scene.news.id/title/url http(s)`) + ≥ 1 log `scene_start` có `news` | |
| 8 | tin đã bàn nằm trong `news.recent()` hoặc `isUsed` | |
| 9 | mỗi hạt ≥ 3 beat và ≥ 1 mạch kết | |
| 10 | `arcsOpen ≤ 2`, `arcsKept ≤ 8`, `recentBeats ≤ 10`, `BEAT_KINDS.length === 17` | |
| 11 | tập người bị nhắc/cho nghỉ **khác nhau giữa các hạt** | thống kê |
| 12 | phổ nạn nhân: ≥ 3 người khi ≥ 4 lượt; không ai > 60 % khi ≥ 5 lượt | thống kê |
| 13 | KPI trung bình theo tên (đội hình gốc): thấp nhất ≥ 70 % cao nhất | thống kê |
| 14 | có hạt xảy ra `resign_talk` | thống kê |
| 15 | kịch bản doanh thu 0 (14 ngày): 1–2 đợt cắt giảm, không ai bị cắt khi thâm niên < 10, **không** phỏng vấn/tuyển, 0 vi phạm | |
| 16 | có hạt **không** đuổi/cắt ai (chỉ khi World đã ngẫu nhiên hoá tính cách) | thống kê |
| 17 | không ai kẹt cảnh > 4 phút thật | |
| 18 | trần `queue ≤ 40`, `newsUsed ≤ 60`, `newsDiscussed ≤ 20` | |
| 19 | round-trip OK mọi hạt | |
| 20 | 2 nút dev có phản hồi | |
| 21 | archive có kind `hr`, `beat`, `news` | |

**Bẫy flaky**: các mục đánh "thống kê" phụ thuộc seed. Với seed theo giờ, một lần đỏ lẻ chưa chắc là bug — chạy lại với `SMOKE_STORY_SEED=<số in ra>`; nếu tái hiện được thì mới là bug (hoặc ngưỡng quá chặt). Không "sửa" bằng cách hạ ngưỡng nếu chưa hiểu nguyên nhân.

---

## 5. `npm run test:news` — `scripts/test-news.ts`

Kiểm `src/news/*` thuần hàm với **"bây giờ" cố định** `NOW = Date.parse('2026-11-01T17:00:00+07:00')` (`:20`) để không lệ thuộc ngày chạy; không mạng. 5 mục (`section(` tại `:37, :67, :89, :181, :227`):

| Mục | Kiểm |
|---|---|
| 1. Đọc RSS (3 mẫu) | mỗi mẫu ≥ 40 tin; `id` 12 hex không trùng; tiêu đề ≥ 8 ký tự, url https; `summary ≤ 200` không còn HTML/entity; VnExpress ≥ 80 % tin có summary; nhãn nguồn theo tên miền (`Tuổi Trẻ`/`GameK`/`VnExpress`); 3 định dạng ngày (US `2:20:00 PM`, `GMT+7`, RFC 822) đều đọc được và trong khoảng 2026-10-25 → NOW+1 ngày; không tin nào rơi về `now`; thể thao ≥ 5 tin `bong_da`; XML rác/rỗng → `[]`; Atom tối giản đọc được |
| 2. Văn bản, ngày, id | `cleanText`; `decodeEntities` (số/hex/tên **và** entity Latin-1 có dấu kiểu Thanh Niên `&aacute;`/`&agrave;`/`&acirc;`/`&Aacute;`… `:70`); một RSS giả kiểu Thanh Niên (`thanhnien.vn`, entity trong tiêu đề + CDATA, `pubDate` năm 2 chữ số) → tiêu đề/tóm tắt sạch, `source 'Thanh Niên'`, nhãn `bong_da` (`:71-74`) — nguồn thứ 4 **không có fixture** nhưng có test; `summarize` (≤ 200, cắt ranh giới từ, `…`), `parseDate` (RFC 822, `GMT+7`, năm 2 chữ số, US không múi giờ → giờ VN, ISO không múi giờ → +07:00, rác → fallback), `newsId` bỏ `utm_*`/`#`, `sourceLabel`, `isFootball` |
| 3. Danh sách chặn | `mustBlock`: tiêu đề phải bị chặn **đúng từ khoá mong đợi** (khớp sai = thất bại), có biến thể không dấu (`khoi to`, `ly hon`, `bi bat`); `realBlock`: hàng chục tiêu đề thật về bắt bớ/cáo buộc/kiện/sa thải/tai nạn/chính trị/đời tư/hạnh kiểm đều bị bỏ, lý do `conduct` ≥ 2; `mustKeep`: tiêu đề vô hại không bị "cắn" (dự án ≠ án, sự kiện ≠ kiện, vòng 1 = lượt đấu, Công An Hà Nội là tên CLB…); `NEWS_BLOCKLIST` thêm từ có dấu/cụm không dấu; `matchKeyword` theo ranh giới từ; tin không hợp lệ → `invalid` |
| 4. Tin cũ, giải trí | > 3 ngày → `old`; giải trí nhẹ giữ; đời tư/cơ thể chặn ở mọi nhóm; chủ đề nhẹ chỉ tính ở **tiêu đề**; `allowShowbiz: false` → `showbiz_off`; tỉ lệ giữ trên fixture: VnExpress giữ ≥ 8 / bỏ ≥ 8, thể thao ≥ 70 %, game ≥ 60 %; không tin nào bị bỏ vì "vòng một"/"dương tính" |
| 5. `NewsStore` | `inject` lọc rồi nạp ≤ 40/nhóm, nạp lại không trùng; nhồi 100 tin game → đúng 40; `pick()` bản sao, luôn trong **5 tin mới nhất**; `pick(['the_thao'])` gồm `bong_da`; exclude hết → `null`; `markUsed` không chọn lại, `recent` có tin ở cuối; trần `used = 500`, `recent ≤ 20`; `serialize → restore` giữ `used/recent`, ≤ 12 tin/nhóm, rác bỏ; `expandCategories(undefined).length === 6`; `refresh()` với `fetcher` giả (1 feed ok, 1 feed ném `HTTP 503`): cảnh báo nguồn lỗi **1 lần/giờ**; `start()` không gọi mạng ngay, `stop()` dừng; nhảy +4 ngày → `pick()` null |

Fixture: `scripts/fixtures/news/gamek-home.xml` (39 134 B), `tuoitre-the-thao.xml` (40 022 B), `vnexpress-giai-tri.xml` (54 767 B) — tải 2026-11-01. Thanh Niên (nguồn RSS thứ 4 trong `src/news/feeds.ts`) **không có fixture**, chỉ được kiểm bằng một RSS giả 1 tin ở mục 2 (`:71-74`). **Quy ước khi thêm fixture**: ngày trong file là cố định, nên nơi dùng phải hoặc cố định `NOW` (test-news) hoặc dời `publishedAt` về hiện tại (smoke/smoke-story). `SPEC.md:971` ghi "76 khẳng định" — số thật phụ thuộc vòng lặp trong script, chưa đếm lại (xem mục cuối).

---

## 6. `npm run test:llm` — `scripts/test-llm.ts` (1 server giả lập)

### 6.1 Server giả lập OpenAI hoạt động thế nào

- `startMock()` (`:119-142`) dựng `node:http` server nghe `127.0.0.1` ở cổng trống đầu tiên trong `4500–4599`, chỉ nhận `POST */chat/completions`, còn lại 404.
- Mỗi request được đẩy vào `requests: Req[]` (`{ path, auth, body }`) để test soi body gửi lên (schema, `max_completion_tokens`, header `Bearer`…).
- **Kịch bản** = hàng đợi `script: Handler[]` dùng một lần: `script.push(handler)` → request kế tiếp dùng handler đó; hết hàng đợi thì rơi về `smart` (`:73-118`) — handler "thông minh" trả lời **hợp lệ theo nhiệm vụ** đọc từ user prompt: `NHIỆM VỤ: ỨNG VIÊN` → persona mẫu; `NHIỆM VỤ: BẢN TIN` → recap mẫu; `NHIỆM VỤ: BIẾN` → beat đầu trong MENU; còn lại là cảnh: lấy id từ `speaker chỉ dùng: …`, số câu từ `N–M câu`, `hrDecisions` `none` cho mọi `- [id]` trong `HỒ SƠ NHÂN SỰ`, verdict theo chuỗi `verdict: "…"` có trong prompt. Vì vậy **sửa câu chữ prompt (`src/ai/prompts.ts`) có thể làm mock không hiểu nhiệm vụ** → mục 15 đỏ.
- `completion(content, usage?)` dựng body chuẩn OpenAI; usage mặc định `prompt 1200 / completion 250 / cached 1024`.
- Provider giả: `makeProvider({ name: 'mock', label: 'Mock', apiKey: SECRET, baseUrl: 'http://127.0.0.1:<port>/v1', model: 'gpt-4o-mini', price: { input: 0.15, cached: 0.075, output: 0.6 } })` (`:171-174`); `SECRET = 'sk-test-SECRETKEY-…'` (`:39`) để dò lộ key.
- Cấu hình: `withProviders({ ...CONFIG, dailyBudgetUsd: 1, minSecondsBetweenLlm: 20, maxConcurrentLlm: 2, llmOnlyWhenWatched: true, persist: false, timeMode: 'compressed' }, [MOCK])` (`:175-183`); `offCfg = withProviders(baseCfg, [])` (`:184`) = offline.
- Agent thật lấy từ một `World` offline (`seedWorld`, `:188`) để prompt/sanitize chạy trên dữ liệu thật; `makeCtx()` (`:144`) dựng `PromptContext` cố định (ngày 2, 10:15, dự án "App đặt lịch Spa Hương Sen").
- Đồng hồ ảo `vt` tiêm qua `createBrain(cfg, { now, deadlineMs, providerTimeoutMs, quiet })`; **hạn chót và treo dùng giờ thật**. `brain` dùng chung cho mục 2–8 được tạo **một lần** ở `:223` với `deadlineMs 4000` **và** `providerTimeoutMs 3500` (chú thích `:222`: timeout riêng nhỏ hơn hạn chót để lượt treo "hết trọn cửa sổ riêng" và bị phạt, thay vì bị hạn chót cắt ngắn → không phạt).

### 6.2 Mười lăm mục

| # | Dòng | Mục | Khẳng định tiêu biểu (đã đối chiếu) |
|---|---|---|---|
| 1 | `:193` | `reserve()`: nhịp + không ai xem | `setAudience(0)`: `low/normal` → `null` (đếm `skipped`), `high` → `'offline'`; có người xem: `low` cần ≥ 20 s, `normal` ≥ 10 s, `high` luôn; chặn vì nhịp **không** tính `skipped`; `via='offline'` không gọi HTTP |
| 2 | `:221` | cảnh "bẩn" → sanitize + tiền | gửi `json_schema` strict, `max_completion_tokens 1300`, `temperature 1`, **không** `prompt_cache_key` khi có base URL, header `Bearer`; bỏ speaker ngoài cảnh, map "Vy"/"anh Tùng" → id, bỏ "Tên:"/ngoặc kép/"(cười)"/link, emote 1 emoji, đúng 1 câu `product`, quan hệ/mood kẹp ±15, KPI không được phép → bỏ, rumor/verdict không hợp lệ → null; chi phí `(400×0.15 + 600×0.075 + 200×0.6)/1e6` với `cached_tokens 600` |
| 3 | `:271` | JSON hỏng → offline | `failures 1`, `lastError` nói về JSON, vẫn tính `calls` |
| 4 | `:282` | HTTP 500 | đúng 1 request (SDK `maxRetries 0`), provider nghỉ 20 s `/máy chủ lỗi \(500\)/`, `usage().mode 'offline'` nhưng `mode() 'llm'`, `reserve('high') → 'offline'` |
| 5 | `:304` | 400 không nhận json_schema | thử lại `json_object` trong cùng request, nhớ cho lần sau |
| 6 | `:323` | 401 + cầu dao | `lastError` không chứa key, tắt 1 giờ, lý do nêu `AI_MOCK_API_KEY`; 3 lỗi liên tiếp → cầu dao 60 s |
| 7 | `:351` | ứng viên + bản tin | id `^cand_salesnew_2_[a-z0-9]{4}$`, tên trùng → đổi, traits 0..10 → 0..1, màu/kiểu tóc sai → sửa; recap mvp theo tên → id, bù đủ ≥ 3 ý |
| 8 | `:375` | server treo | trả về sau ≈ 3,5 s (`providerTimeoutMs 3500` < `deadlineMs 4000`, cùng `brain` tạo ở `:223`; phần giờ còn lại 0,5 s < `minAttemptMs` 2 500 nên không mở lượt mới); test chấp nhận `3000 ≤ ms < 8000` — **chờ thật**; provider nghỉ 20 s `/quá thời gian/` vì treo trọn cửa sổ riêng (khác ca "cửa sổ bị hạn chót cắt ngắn → không phạt" ở test-router mục 6) |
| 9 | `:387` | trần ngân sách | `dailyBudgetUsd 0.0003`: vượt → `low` null, `high` offline; snapshot giữ chi phí, không chứa key |
| 10 | `:428` | v3 `news_chat` | prompt có thẻ `TIN`, `LUẬT TIN THẬT`, gợi ý sở thích; lưới an toàn bỏ "bị bắt"/"ngoại tình", giữ "bị bắt lười"; tóm tắt vi phạm → tóm tắt an toàn có nguồn; ký ức theo mẫu `Bàn tin "…" (nguồn)`; bỏ câu lẫn chữ Hán/Hàn/tiếng Anh nguyên câu; toàn câu ngoại ngữ → offline "không phải tiếng Việt"; `topicHint "nghe nói…"` vẫn bật lưới; offline news_chat ≥ 4 câu, nhắc tiêu đề, ≥ 30 câu khác nhau sau 12 cảnh |
| 11 | `:546` | v3 `hr_review` | prompt có `TRẦN 1 LẦN HỌP`; hồ sơ 1 dòng/người; 8 quyết định bẩn → 5 hợp lệ; `fire`/`promote` ngoài allowed → `none` nhưng `reason` giữ dấu vết; alias "cảnh cáo" → `warn`; offline: mọi quyết định ∈ allowed, ≤ 1/người, ≤ 6; hồ sơ rỗng → `[]`; cảnh khác → `null` |
| 12 | `:624` | v3 verdict | `resign_talk` null/lạ → `stay`; `raise_request` lạ → `denied`; `promotion` → verdict/hrDecisions null; offline promotion/layoff đúng người mở lời |
| 13 | `:668` | v3 `generateBeats` | schema `ke_hoach_bien`, `max_completion_tokens 450`, system riêng, user bắt đầu `NHIỆM VỤ: BIẾN`, ≤ 700 token; lọc kind/tên/intensity/trùng; JSON hỏng → offline 1–2 beat; không ai xem → không gọi; menu rỗng → `[]`; hết ngân sách → offline |
| 14 | `:735` | kích cỡ prompt | ước lượng `estimateTokens` (2,7 ký tự/token, `src/ai/prompt-budget.ts`), hệ số 0,85 cho system: news_chat 2 người ≤ 2500; news_chat 3 người ≤ `pantry3 + 450` (thẻ tin + luật; `:759`); hr_review 3 hồ sơ ≤ 2560; 8 hồ sơ ≤ 2900; resign/raise/promotion 3/layoff 3 ≤ 2500; promotion 5 ≤ standup5 + 150; layoff 4 ≤ lunch4 + 150; **mọi user prompt ≤ 2000**; beats (menu 12) ≤ 700 |
| 15 | `:785` | World + Director chế độ "GPT" | Director nạp động (lỗi nạp → báo rõ); cấu hình ghi đè thêm `kpiWarnDays: 2, kpiFireDays: 3` (`:793`); người xem đặt qua `world.setViewers(n)` (World đẩy xuống Brain), **không** gọi `brain.setAudience` trực tiếp; 07:30 → 10:00 có ≥ 4 câu "giả lập", `calls > 0`, số request ≤ `floor(elapsed/10) + 5`; `setViewers(0)` → ≤ 1 request trong ~60 phút game; `end_day` → recap `source 'llm'`; có `status.ai.mode 'llm'`. Dùng `sleep(1)` thật mỗi 4 bước (`:805`) |

Kết: `server.close()`, in `passed/total` và số request mock nhận (`:837-841`).

---

## 7. `npm run test:router` — `scripts/test-router.ts` (2 server giả lập)

### 7.1 Khung

- Hai mock OpenAI-compatible **Alpha** (`startMock('Alpha', 4600)`, `:189`) và **Beta** (`startMock('Beta', 4601)`, `:190`), mỗi mock có `requests[]`, `script[]` riêng và handler `smart` nhận diện nhiệm vụ qua `response_format.json_schema.name` (`ho_so_ung_vien`/`ban_tin_ngay`/`canh_hoi_thoai`) hoặc tiền tố `NHIỆM VỤ:` (`taskOf`, `:69-78`). Không nhận ra (vd đã hạ xuống `json_object` nên không còn tên schema, và prompt không có tiền tố) thì **rơi về biến toàn cục `currentTask`** (khai báo `:68`, `return currentTask` `:77`), được đặt tay ở mục 9: `currentTask = 'candidate'` trước `generateCandidate`, `'recap'` trước `generateRecap`, rồi trả về `'scene'` (`:653-660`). Thêm mục mới gọi ứng viên/bản tin qua router → phải đặt `currentTask` tương ứng, kẻo `smart` trả JSON cảnh và test đỏ khó hiểu.
- Key giả `KEY_A = 'sk-A-SECRETKEY-…'`, `KEY_B = 'gsk_B_SECRETKEY_…'`; `leaks(s)` = chuỗi chứa key hoặc `SECRETKEY` (`:35-37`) — dùng ở mục 12 để chắc key không lọt vào stats/lỗi/log/snapshot.
- Thư viện handler lỗi "nhái định dạng thật" (`:136-162`): `err500`, `err401` (nhại OpenAI, có chứa key trong message để kiểm che), `err429RetryAfter(sec)`, `err429Daily` (Groq RPD "try again in 2h13m4.5s"), `err429GeminiMinute`, `err429GeminiDaily`, `err429GroqTpd` (+ header `retry-after: 862`), **`err429GeminiDailyArray`** (body dạng **mảng** thật của Gemini, `quotaId …PerDay…`, `retryDelay: '27s'`), `err400GeminiKeyArray`, `err400GroqJsonValidate`, `err400Schema`, `badJson`, `hang`.
- `cfgWith(providers, over)` = `withProviders({ ...CONFIG, dailyBudgetUsd: 5, minSecondsBetweenLlm: 20, maxConcurrentLlm: 2, llmOnlyWhenWatched: false, offlineMinSeconds: 8, persist: false, timeMode: 'compressed', aiRouting: 'priority', ...over }, providers)` (`:202-205`).
- `mkBrain(providers, over, deadline = 3000, providerTimeoutMs?)` → `createBrain(cfgWith(...), { now, quiet: true, log, deadlineMs: {scene/candidate/recap = deadline}, providerTimeoutMs })` + `setAudience(1)` (`:207-213`); `log` gom vào `infos`/`warned`.
- `provGemini` là provider **tên `gemini`** trỏ vào mock Alpha (`:200`) để kích hoạt chính sách reset 0h Pacific (`quotaResetTz`).
- `createRouter(cfg, { now, quiet, rand })` dùng trực tiếp ở mục 13 để cố định `rand: () => 0.5` khi kiểm `balanced`.

### 7.2 Mười bốn mục (0–13)

| # | Dòng | Mục | Khẳng định tiêu biểu |
|---|---|---|---|
| 0 | `:225` | hàm thuần | `parseDurationMs('14m22.5s') = 862500`, `'1h 2m' = 3720000`; `messageRetryAfterMs` hiểu "retry in 32.5s", "try again in 14m22.5s"; `isDailyQuota`, `classifyError`, `parseTooLarge`, `quotaResetTz` |
| 1 | `:243` | Alpha ổn | Beta 0 request; `usage.activeProvider 'Alpha'`; `providers[].calls/rpdUsed/tpdUsed`; `pick('scene','low')` = alpha |
| 2 | `:260` | 429 + `Retry-After: 2` | Beta trả lời **trong cùng request**, Alpha `cooldownUntil = vt + 2000`; 429 không Retry-After → 30 s rồi 60 s, thành công reset |
| 2b | `:295` | "Request too large" (OTPM Limit 1000, Requested 1436) | 3 ca hàm thuần `parseTooLarge` (`:306-310`): OTPM "Limit 1000, Requested 1436" → `{ limit, requested, output: true }`; TPM "reduce your message size" → `output: false`; "Rate limit reached … Used 30, Requested 1" (hết lượt tạm) → `null` — mẫu để thêm định dạng lỗi provider mới (§12.1); rồi ca tích hợp: không nghỉ, hạ `max_completion_tokens ≤ 900` và thử lại **cùng provider**; nhớ qua snapshot; TPM quá xa → bỏ Alpha cho request này |
| 3 | `:340` | quota NGÀY | `nextLocalMidnight` 0h VN; `nextMidnightIn(Pacific)` ≤ 25 h kể cả ngày đổi giờ; Groq RPD → nghỉ đúng "2h13m4.5s"; Gemini phút → 20,5 s; Gemini ngày không gợi ý → tới 0h Pacific **kẹp tối đa 6 giờ/lần dò** (`geminiWait = min(midnightLA − vt, 6 × ONE_HOUR)`, `:355`; = `ROUTER_POLICY.retryAfterMaxMs`, `router.ts:38`); **body mảng** được bóc, gợi ý 27 s bị bỏ, `lastError` không còn "(no body)"; Groq TPD + `Retry-After 862` → 862 s; gợi ý ≥ 10 phút được tin |
| 4 | `:396` | TPD/RPM/RPD | `tpd 2000` → sau 2400 token hết; `rpm 2` → request 3 sang Beta, 60 s sau dùng lại; `rpd 1` → tới 0h VN; **RPD đếm cả request lỗi 500**; Gemini `rpd 1` → tới 0h Pacific, snapshot `day` theo Pacific, restore sau 0h Pacific → `rpdUsed 0` |
| 5 | `:457` | 401 / sai key / 404 | tắt 60 phút, lý do nêu `AI_ALPHA_API_KEY`; Gemini 400 "API key not valid" và body mảng "Please pass a valid API key" cũng là sai key (nhắc `AI_GEMINI_API_KEY`), **không** nhầm thành không nhận json_schema (giữ `format 'json_schema'`, đúng 1 request, snapshot `jsonObjectUntil === 0` — `:483-486`); 404 model → 1 giờ, nêu `AI_ALPHA_MODEL` |
| 6 | `:496` | 500 / mạng / treo | 500 → Beta trả lời ngay, Alpha 20 s → 40 s, reset khi thành công; cổng không ai nghe → "không kết nối"; treo trọn cửa sổ 1,5 s (`mkBrain(…, {}, 3000, 1500)`) → offline, Beta không được gọi vì phần giờ còn lại < `minAttemptMs` 2,5 s, Alpha phạt 20 s — **chờ thật ~1,5 s** (`:523-530`); cửa sổ bị hạn chót cắt ngắn (`b4 = mkBrain(…, {}, 4000)` không có `providerTimeoutMs`: A trả JSON hỏng sau `setTimeout 500`, B `hang` được thử trong phần giờ còn lại và chỉ về offline khi chạm hạn chót 4 s — `:532-540`) → B **không** bị phạt, `lastError` ghi "không phạt", `backoffServer 0`, request kế tiếp B vẫn trả lời ngay — **chờ thật thêm ~4 s** (tổng mục 6 ≈ 5,5 s) |
| 7 | `:549` | 400 json_schema | → json_object trong cùng request, nhớ, lưu qua restore; `json: 'object'` gửi thẳng; 400 vì `temperature` → bỏ tham số; Groq `json_validate_failed` → lỗi nội dung (không nghỉ, sang Beta); 400 lạ → giữ json_schema, nghỉ 20 s "request bị từ chối (400)", snapshot **không** nhớ `json_object` (`jsonObjectUntil === 0`, `:594-595`) — cùng với mục 5 là hai ca phân biệt "sai key"/"400 lạ" với "không nhận json_schema" |
| 8 | `:599` | cả hai lỗi | offline, `failures 1`, `lastError` nêu cả Alpha và Beta; `reserve('high') → 'offline'`, `low` theo nhịp offline 8 s; **cầu dao chỉ mở khi mọi provider cùng hỏng 3 request liên tiếp** (60 s); Alpha hỏng 4 lần nhưng Beta ổn → không cầu dao |
| 9 | `:640` | tier strong | Beta strong nhận `high`, ứng viên, bản tin; `low/normal` → Alpha; Beta lỗi → `high` rơi về Alpha trong cùng request |
| 10 | `:670` | thống kê + snapshot | tổng `calls 3` (Alpha 2 kể cả lỗi + Beta 1), token 2000/400, chi phí Beta `$0.0014` (giá 1/0.5/2); restore giữ tổng/counters/cooldown; snapshot v1 đọc được; gỡ provider → tổng không tụt (carry); sang ngày mới → chi phí hôm nay 0, RPD 0 |
| 11 | `:714` | cấu hình cũ / `buildProviders` | `OPENAI_*` → 1 provider `openai` giá gpt-4o-mini; base URL Gemini/Groq → tên tương ứng; `AI_PROVIDERS: 'gemini, groq,openai'` với Groq thiếu key → `skipped`; `{ ...cfg, openaiKey: '' }` → không provider (công tắc của smoke) |
| 12 | `:751` | không lộ key | `usage()`, `serialize()`, mọi log info/warn, startup log (`quiet=false`) không chứa key; `redactSecrets` che `sk-`/`gsk_`/`AIza`/`Bearer`/`key=` |
| 13 | `:774` | pace / balanced / trần token / `EXTRA_JSON` | `rpd 100` lúc 01:00 VN → nhận 34–36 lượt rồi "giữ nhịp" (mở lại ≤ 1 giờ), 13:00 → sẵn sàng (≈ 84); `pace: false` → 50/100 không chặn; `balanced` với `rand 0.5`: hoà → theo thứ tự cấu hình rồi luân phiên theo quota còn lại; strong vẫn ưu tiên; `weight 0.3`; `maxOutputTokens 300` → `max_completion_tokens 300`; `extraBody` ghép `chat_template_kwargs`; `maxRequestTokens 200` → request lớn sang Beta; `buildProviders` đọc `REASONING=false`, `PACE=false`, `MAX_OUTPUT_TOKENS`, `MAX_REQUEST_TOKENS`, `EXTRA_JSON` (bỏ khoá `model`, JSON sai → bỏ qua), mặc định `pace true` |

Kết: đóng 2 server, in `passed/total` và số request từng mock (`:842-847`).

---

## 8. `npm run eyeball:hr` — `scripts/eyeball-hr.ts` (AI thật, ngoài `npm test`)

Mục đích: xem **bằng mắt** một cảnh `hr_review` do AI thật viết — thoại có hứa thứ vượt TRẦN không, có đọc mã action (`praise|bonus|warn|…`) không, quyết định có nằm trong "được phép" không. **Không có khẳng định**; `exit 0` ở cả hai đường bình thường (`:31` không có provider, `:112` kết thúc); chỉ `exit 1` khi mô phỏng xong mà World không còn HR hoặc sếp (`:67` — thực tế không xảy ra vì `removeAgent` bỏ qua sếp/HR, nhưng vẫn là mã lỗi nếu ai đó đổi luật đó).

| Bước | Dòng | Chi tiết |
|---|---|---|
| Điều kiện | `:29-32` | `CONFIG.providers.length === 0` → in cảnh báo, `exit 0` |
| Biến | `:25-26` | `EYEBALL_DAYS=6` (≥ 2), `EYEBALL_SCENES=1` (1..3) |
| 1. Mô phỏng offline | `:35-66` | `configureNews({ enabled: false })`, archive vào `mkdtemp('vpa-eyeball-')`; `simConfig = { ...CONFIG, openaiKey: '', providers: [], persist: false, timeMode: 'compressed', devPanel: true, newsEnabled: false, historyEnabled: true }`; `console.log` tắt; tua x10 tới `day > DAYS` rồi kéo tới 10:15 (`minuteOfDay 615`); `!hr \|\| !boss` → in cảnh báo và `exit 1` (`:67`) |
| 2. Hồ sơ y như Director | `:70-86` | `newLedger()`, `env = { day, headcount, hasOpenPosition: false, freeDesk: false, revenueRatio: revenueRatio(world) }`, `buildDossier(world, CONFIG, ledger, env)`, `sitHrReview(kit, hr, boss, dossier, [])`, `SceneRequest { type: 'hr_review', priority: 'high', participants: [hr, boss], hrDossier }`; in bảng hồ sơ (KPI, thấp, nhắc, được phép) |
| 3. Gọi AI thật | `:93-109` | `createBrain(CONFIG)` thật, `setAudience(1)`, `generateScene(req, ctx, 'llm')` N lần; in nguồn / số câu / giây / model / `lastError`, từng câu, tóm tắt, `hrDecisions`, kết quả `validateDecisions` (thi hành / gác lại), kiểm nhanh: số câu đọc mã action, số câu `!isNewsSafe`, mọi quyết định có trong allowed không |

Bẫy: tốn vài lượt quota thật (Gemini 500 lượt/ngày/model theo đo của chủ dự án); `revenueRatio`/`dossier` là ảnh chụp một thời điểm; không in API key (chỉ `u.model`, `u.lastError` đã qua `redactSecrets`).

---

## 9. Thử model AI thật (ngoài test tự động)

### 9.1 `DEBUG_PROMPTS=1` — xem prompt và phản hồi thật

`src/ai/llm.ts:279` `debugOn = () => process.env.DEBUG_PROMPTS === '1'` (đọc thẳng `process.env`, không qua `CONFIG`). Trong `attempt()` (`:371-392`):

- System prompt in **1 lần cho mỗi mã FNV-1a** của nội dung (`printedSystems`), kèm số ký tự và ước lượng token.
- Mỗi lượt: `[ai:debug] <task> → <label>/<model> (<format>, max <N> tok) USER (<ký tự> ≈ <token>):` + nguyên văn user prompt.
- Phản hồi: `[ai:debug] <task> ← <label> <ms>ms finish=<reason> prompt=<n> (cached <n>) out=<n> $<cost>` + nguyên văn JSON model trả.

Cách dùng: `DEBUG_PROMPTS=1 npm start` (README §4), mở trang để có người xem (nếu `LLM_ONLY_WHEN_WATCHED=true`), bấm nút dev để ép loại cảnh muốn xem (🗞️ news, 📋 hr_review, 🤫 drama…). Chỉ bật khi thử nghiệm: log rất dài và chứa toàn bộ prompt (không có key — key chỉ nằm trong header SDK). Kết hợp với chip 🤖 AI của admin (`#dev=<DEV_TOKEN>`) để xem `lastError` và trạng thái từng provider.

### 9.2 Probe một endpoint bằng Node `fetch`

Khi cân nhắc model/provider mới, **không** sửa code trước; viết một script probe nhỏ trong scratchpad (không commit) gọi thẳng endpoint OpenAI-compatible với key lấy từ môi trường:

```bash
# Node ≥ 20.6 đọc .env mà không cần dotenv; script đặt ngoài repo hoặc trong scratchpad
node --env-file=.env /path/scratchpad/probe.mjs
```

```js
// probe.mjs — khung tối giản (không in key, không giả mạo User-Agent)
const base = process.env.AI_GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'; // KNOWN_BASE_URLS: src/config.ts:89-92
const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.AI_GROQ_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.AI_GROQ_MODEL, messages: [{ role: 'user', content: 'Trả về JSON {"ok":true}' }],
    response_format: { type: 'json_object' }, max_completion_tokens: 200 }),
});
console.log(res.status, Object.fromEntries([...res.headers].filter(([k]) => /retry-after|ratelimit/i.test(k))));
console.log((await res.text()).slice(0, 2000));
```

Những gì cần nhìn (đây là các điểm router phụ thuộc, xem [`05-lop-ai.md`](05-lop-ai.md)): (1) **mã lỗi và body khi 429/400/401** — body có dạng mảng (Gemini) hay object, có `Retry-After`/"try again in …" không, có chữ `per day`/`RPD`/`TPD` không — vì `classifyError`/`isDailyQuota`/`messageRetryAfterMs` đọc đúng những chuỗi này; nếu provider mới dùng định dạng khác, thêm handler nhái vào `test-router.ts` trước khi sửa router; (2) model có nhận `response_format: json_schema` strict không (không thì router tự hạ `json_object`); (3) có trả `usage.prompt_tokens_details.cached_tokens` không (ảnh hưởng số liệu chip AI); (4) độ trễ so với `providerTimeoutMs` 20 s và hạn chót cảnh 27 s; (5) **chất lượng tiếng Việt** và độ dài JSON ở cảnh 8–9 câu (model suy luận cần `max_completion_tokens` ×3 — `AI_<TÊN>_REASONING`).

Quy tắc **User-Agent**: không bao giờ giả mạo trình duyệt hay dịch vụ khác. Probe dùng UA mặc định của Node/`openai` SDK; bộ đọc RSS của app tự khai `USER_AGENT = 'VanPhongAo/3.0 (+van phong ao; doc RSS cong khai)'` (`src/news/feeds.ts:15`, header `:67-72`). Chỉ gọi **API chính thức** (endpoint OpenAI-compatible), không cào web UI.

Danh sách model đã thử và loại do chủ dự án cung cấp (2026-11-01/02, không suy ra từ code): dùng Gemini `gemini-3.5-flash-lite` (500 lượt/ngày/model, reset 15:00 VN), Groq `openai/gpt-oss-120b` (vì `qwen/qwen3.8-27b` có trần 1 000 token ra/phút), Cloudflare `@cf/google/gemma-4-26b-a4b-it` (phải tắt thinking qua `AI_CLOUDFLARE_EXTRA_JSON`); đã loại gpt-oss-20b (tiếng Việt lỗi), Qwen3-30B trên Cloudflare (nhạt), GLM-5.3-flash (không có gói Free), Z.ai GLM-4.7/4.5-flash (429 "overloaded", 8–29 s), OpenRouter `:free` (50 lượt/ngày), SambaNova (20/ngày), GitHub Models (đã đóng), Cerebras (cần thẻ). Chi tiết số liệu quota: README §3.

---

## 10. QA hình ảnh bằng Chrome headless qua CDP

> **Trạng thái**: repo **chưa có** script QA trình duyệt. Móc đo đã có sẵn trong client: `window.__vpa = { store, actorPos }` (`public/js/main.js:3-4`, `enumerable: false`, "không chứa gì ngoài dữ liệu server đã gửi"). Phần dưới mô tả cách dựng lại bộ chụp + đo (phiên 2026-11-02 từng dùng script tạm trong scratchpad, không giữ lại). Nếu đưa vào repo, đề xuất `scripts/qa/` và **không** thêm npm dependency (SPEC §0.6): dùng `ws` (đã có) để nói chuyện CDP và `node:http` để gọi `/json/*`.

### 10.1 Dựng server để QA (không tốn token, không ghi đĩa)

```bash
PORT=3999 PERSIST=false HISTORY_ENABLED=false NEWS_ENABLED=false AI_PROVIDERS= OPENAI_API_KEY= DEV_TOKEN=qa-local npm start
```

- `dotenv` **không** ghi đè biến đã có trong môi trường → giá trị trên dòng lệnh thắng `.env` (`src/config.ts:1-2`). `AI_PROVIDERS=` rỗng + `OPENAI_API_KEY=` rỗng → không provider → thoại offline (xem `buildProviders`, `config.ts:134-156`).
- `DEV_TOKEN=qa-local` là mã **chỉ cho máy dev**; mở trang `http://127.0.0.1:3999/#dev=qa-local` để có bảng dev (ép cảnh, tua x10). Không bao giờ dùng `DEV_TOKEN` thật trong script/log.
- Kiểm sống: `curl -s http://127.0.0.1:3999/api/health` → `{ ok, mode, viewers, day, minute }` (`src/server.ts:411-415`).

### 10.2 Chụp màn hình qua CDP

1. Chrome trên máy dev: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (có trên máy khảo sát; đường dẫn khác trên Linux/VPS — không chạy trên VPS production).
2. Khởi động: `"<chrome>" --headless=new --remote-debugging-port=9222 --window-size=1600,900 --hide-scrollbars --user-data-dir=<scratchpad>/chrome-profile about:blank`.
3. Lấy WebSocket CDP: `GET http://127.0.0.1:9222/json/version` → `webSocketDebuggerUrl` (browser) hoặc tạo tab mới rồi lấy `webSocketDebuggerUrl` của tab; nối bằng `new WebSocket(url)` từ gói `ws`.
4. Gửi lệnh JSON `{ id, method, params }`: `Page.enable`, `Runtime.enable`, `Log.enable` (bắt lỗi console), `Page.navigate { url }`, chờ `Page.loadEventFired`.
5. **Chờ app sẵn sàng** bằng `Runtime.evaluate { expression: 'window.__vpa?.store.ready === true && window.__vpa.store.agents.size >= 10', returnByValue: true }` lặp tới khi `true` (`store.ready` bật khi nhận `hello` — `public/js/store.js:8`). Muốn ép một cảnh/sự kiện (chỉ khi mở trang kèm `#dev=`): nút dev là `button.dev-ev` với `aria-label` = nhãn tiếng Việt trong `DEV_EVENTS` (`public/js/labels.js:36-50`: `Sếp đi vắng`, `Sếp về`, `Sập server`, `Mất wifi`, `Ngày lương`, `Sinh nhật`, `Chốt deal`, `Tạo drama`, `HR xét KPI`, `Release`, `Kết thúc ngày`, `Thời sự`, `Biên kịch`; dựng ở `public/js/ui/devbar.js:28-37`; **bẫy**: nút 🚪 "Thoát admin" cũng mang class `dev-ev` — `class: 'dev-ev dev-logout'`, `aria-label 'Thoát admin'`, `devbar.js:38` — nên `querySelectorAll('button.dev-ev')` trả **14** nút chứ không phải 13; lọc theo `aria-label` hoặc `:not(.dev-logout)`, kẻo script QA bấm nhầm nút thoát và mất quyền admin giữa phiên) → `Runtime.evaluate('document.querySelector(\'#devbar .dev-ev[aria-label="Ngày lương"]\')?.click()')`; tốc độ: `button.dev-speed[data-speed="10"]`.
6. Mobile: `Emulation.setDeviceMetricsOverride { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }` rồi reload.
7. `Page.captureScreenshot { format: 'png' }` → base64 → ghi vào scratchpad (ảnh so sánh gốc nằm ở `docs/preview/v2/desktop.png`, `mobile.png`, `nhan-vat-can-canh.png`, `showroom-can-canh.png`…). Không ghi ảnh mới vào `docs/preview/` trừ khi chủ dự án muốn lưu mốc (thư mục này đã 9,7 MB và nằm trong git).

Bẫy đã gặp (ghi ở `public/js/render/office.js:305-307`): mốc thời gian của `requestAnimationFrame` có thể lệch `performance.now()` khi chạy headless với `--virtual-time-budget` hoặc tab vừa thức → code vẽ cố ý dùng `performance.now()`; **đừng dùng `--virtual-time-budget` khi đo độ mượt**, chỉ dùng (nếu cần) để chụp nhanh một ảnh tĩnh.

### 10.3 Harness giả lập mạng (tái hiện giật qua Cloudflare)

Vấn đề gốc (2026-11-02): server CPU ~0 %, trình duyệt 60 fps, nhưng gói `frame` (server phát mỗi `FRAME_MS = 200` ms, `src/sim/world.ts:34, 2767`, kèm `ts: Date.now()`) đến trình duyệt so le ~100/300 ms qua Cloudflare → nếu nội suy theo lúc gói **tới** thì nhân vật đi–khựng–đi. Sửa phía client: giữ khung hình theo trục giờ server và vẽ trễ `store.net.buffer` ms (`public/js/store.js:140-202`; sàn `NET_BUFFER_MIN 260`, khởi đầu `340`, trần `700`, nới khi `slack < NET_SLACK_MIN 60`, siết dần sau cửa sổ 40 frame).

Để tái hiện trên máy dev mà không cần production, dựng **proxy WebSocket+HTTP có jitter** bằng `node:http` + `ws`: nghe cổng khác (vd 4000), chuyển tiếp HTTP sang `127.0.0.1:3999` nguyên vẹn, nâng cấp `/ws` thành 2 socket nối nhau; chiều server → client, với thông điệp `t === 'frame'` thì `setTimeout` xen kẽ +0/+200 ms (hoặc ngẫu nhiên 0–250 ms) trước khi `send`; chiều client → server chuyển ngay. Trình duyệt trỏ vào proxy (client dùng `location.host` cho WS, `wsUrl()` `public/js/net.js:76-79`, nên proxy phải phục vụ cả HTTP). Cách khác (nặng hơn, ít cần): server giả phát `hello` + `frame` tổng hợp — phải nhái đúng `hello` (`map`, `agents`, `products`…), không khuyến nghị.

### 10.4 Đo độ mượt qua `window.__vpa`

Các trường đọc được (chỉ dữ liệu client đã nhận):

| Trường | Ý nghĩa | Nguồn |
|---|---|---|
| `store.net.buffer` | ms vẽ trễ hiện tại; mạng êm → tiến về 260; ~700 = jitter nặng | `store.js:151-156` |
| `store.net.frames`, `store.net.lateFrames` | số frame đã nhận / số frame tới muộn (slack < 60 ms) | `store.js:166-167` |
| `store.frameDt` | EMA khoảng cách **lúc tới** của frame (ms), kỳ vọng ≈ 200 | `store.js:30, 256-260` |
| `store.actors` | `Map id → actor` có `kf[]` (khung hình `{t,x,y,jump}` ≤ 10), `x,y`, `activity`, `t0`, `dur` | `store.js:178-186` (`pushKeyframe`), `:254-290` (`onFrame`) |
| `actorPos(a, now)` | vị trí nội suy tại `now` (trục `performance.now()`); sau khi gọi, `a.dur > 0` nghĩa là đang ở giữa 2 khung hình (đang di chuyển) | `store.js:188-202` |

Cách đo (eval một hàm trả Promise, `Runtime.evaluate` với `awaitPromise: true`): trong ~10 s, mỗi rAF gọi `actorPos(a, performance.now())` cho mọi actor có `kf.length ≥ 2`; với actor "đang đi" (`a.dur > 0`), tính độ dịch chuyển giữa hai rAF liên tiếp: **stall ratio** = tỉ lệ rAF có dịch chuyển ≈ 0 khi đang đi; **step CV** = độ lệch chuẩn / trung bình của các bước dịch chuyển > 0. Ghi thêm `buffer`, `lateFrames/frames`, `frameDt` cuối kỳ. Số đo tham chiếu 2026-11-02 (ghi chú phiên làm việc, không có script trong repo): production sau sửa stall ≈ 3 %, CV ≈ 0,16; local stall ≈ 0,4 %, CV ≈ 0,10; **trước sửa** với buffer 0 stall ≈ 85 %. Khi đổi gì ở `store.js` phần nội suy hoặc nhịp frame server, đo lại cả local và qua proxy jitter (§10.3), và trên site thật nếu có thể.

### 10.5 Đo rAF

Trong cùng eval: ghi `performance.now()` mỗi rAF trong 3–5 s → mảng delta; kỳ vọng ≈ 16,7 ms (60 Hz), đếm "hitch" > 50 ms. Nếu rAF đều mà nhân vật vẫn giật → vấn đề ở dữ liệu/nội suy (xem `store.net`), không phải vẽ. Nếu rAF không đều → soi `draw()` (`office.js:316+`: cache layer tĩnh, `scheduleCache()`), số bong bóng, kích cỡ canvas × `dpr`. Vòng vẽ: `frame()` → `requestAnimationFrame(frame)` → `draw(performance.now())` (`office.js:303-314`).

---

## 11. Checklist QA cho thay đổi giao diện

Tiêu chuẩn chủ dự án (`docs/ui-polish-todo.md` đầu file; ghi nhớ phản hồi): **cẩn thận, trực quan, rõ, đẹp — không làm cho có**; nhân vật đủ bộ phận, nhìn ra ai là ai; **người xem thường không thấy gì về hệ thống**. Trước khi báo "xong":

1. `npm run typecheck` sạch (không có test tự động cho `public/`, nên bước này không bắt lỗi JS trình duyệt — phải chạy thật).
2. Khởi động server QA (§10.1), mở **không** có `#dev=` và **có** `#dev=qa-local`; mỗi trạng thái chụp desktop 1600×900 và mobile 390×844.
3. Console trình duyệt không có lỗi (`Log.entryAdded` level error / `Runtime.exceptionThrown`); `store.ready === true`; `store.agents.size === 10` **ngay sau khi khởi động server QA mới** (`PERSIST=false`; đội hình gốc `INITIAL_ROSTER` 10 người gồm sếp Hùng + HR Ngọc — `src/content/roster.ts:70`); về sau có thể dao động 8–12 do nhân sự v3 (`removeAgent` khi fire/layoff/resigned, `open_position` tới `headcount < 12`) nên không dùng con số 10 làm điều kiện cứng sau ngày 1; canvas `#office` có nội dung (không trắng/đen).
4. **Người xem thường**: `store.dev === false`; `store.status.ai` chỉ có `mode` còn mọi số = 0 và `model: ''`, `clicks: 0` (server lược bằng `publicStatus`, `src/server.ts:184-194, 462`); `#chip-ai` phải `hidden` (`public/js/ui/hud.js:184-191`); chỉ còn chấm `#ai-dot` cạnh "TRỰC TIẾP"; `#devbar.hidden === true` (`devbar.js:54`); không nhãn "AI chấp bút / template", không số bấm link, không chip "Sếp có mặt".
5. **Admin**: `#devbar` hiện, `#chip-ai` hiện kèm popover nguồn/model/lỗi; bấm 🚪 thoát → tải lại thành người xem thường.
6. Nhân vật: đủ tóc/mắt/mày/miệng/tay/chân/giày/phụ kiện ở zoom mặc định; nhìn nghiêng không lỗi (so với `docs/preview/bug-nhan-vat-nhin-ngang.png` và bản đã duyệt `docs/preview/v2/nhan-vat-nhin-ngang.png`); ngồi quay lưng vẫn nhận ra (`v2/ngoi-ban-quay-lung.png`); không ai nửa trong suốt (bug cũ `preview-2-chieu.png`).
7. Bong bóng thoại vs toast: ép một toast (nút 💸 payday → "Lương về") trong lúc có cảnh đang phát, kiểm `#toasts` (giữ ≤ 3 toast, TTL 3,8–7 s — `public/js/ui/toasts.js`) không đè bong bóng — **đây là việc còn mở** (chủ dự án báo toast đôi khi đè thoại).
8. Phòng trưng bày: 2 kệ có sản phẩm, rê chuột ra `#prod-tip`, bấm mở `/go/<id>?src=showroom` (chỉ thử trên server QA — click được đếm vào `clickStats`; tuyệt đối không bấm thử trên production).
9. Sidebar: tay kéo `#sb-handle` (260–520 px, nhớ localStorage), `#sb-collapse` → `#ticker` hiện khi thu gọn (`sidebar.js:1-2, 87-88`), `#sb-expand` mở lại; tab Lịch sử `#history` tải `/api/history` (server QA có `HISTORY_ENABLED=false` → phải thấy trạng thái "tắt" gọn, không lỗi).
10. Chữ tiếng Việt có dấu đầy đủ, không tràn/khuất ở mobile; HUD `#hud` không che nhân vật (`office.setInsets`).
11. Độ mượt không thoái lui: chạy đo §10.4 trước/sau nếu đụng `store.js`/`office.js`/nhịp frame.
12. Sau deploy: tải cứng (bỏ cache) và kiểm `index.html` trỏ `/v/<ASSET_VERSION>/…` mới (`src/server.ts:149-153`); xem [`10-van-hanh-deploy.md`](10-van-hanh-deploy.md).
13. Ảnh chụp tự duyệt theo tiêu chuẩn trên; cập nhật [`07-frontend-ve-canvas.md`](07-frontend-ve-canvas.md) / [`08-frontend-giao-dien.md`](08-frontend-giao-dien.md) nếu đổi hành vi.

---

## 12. Viết test mới

### 12.1 Cho router / Brain (`scripts/test-router.ts`, `scripts/test-llm.ts`)

Khuôn mẫu một mục mới trong `test-router.ts`:

```ts
section('14. <tên mục>');
{
  const b = mkBrain([provA({ rpd: 50 }), provB()], { aiRouting: 'balanced' }, 3000);   // cấu hình + hạn chót 3 s
  A.script.push(err429RetryAfter(2));          // request kế tiếp của Alpha trả 429 + Retry-After: 2
  const a0 = countA(), b0 = countB();
  const r = await b.generateScene(sceneReq(), ctx, 'llm');
  const u = b.usage();
  check('Beta trả lời trong cùng request', r.source === 'llm' && countA() === a0 + 1 && countB() === b0 + 1);
  check('Alpha nghỉ đúng 2 s', statsOf(u, 'alpha')?.cooldownUntil === vt + 2000, statsOf(u, 'alpha')?.cooldownReason);
  vt += 2_001;                                 // tiến đồng hồ ảo — KHÔNG dùng setTimeout cho chính sách
  check('không lộ key', !leaks(JSON.stringify(u)) && !leaks(warned.join('\n')));
}
```

Quy tắc:

- **Đồng hồ**: mọi chính sách (cooldown, RPM/RPD/TPD, pace, cầu dao, nhịp `reserve`) đi theo `now()` → chỉ cần `vt += …`. Chỉ hạn chót/treo dùng giờ thật → mục cần `hang` phải rút `deadline`/`providerTimeoutMs` xuống 1–3 s (`mkBrain(…, 3000, 1500)`) để không kéo dài test. Nhớ ngưỡng `ROUTER_POLICY.minAttemptMs` 2 500 ms / `minAttemptReasoningMs` 6 000 ms (`src/ai/router.ts:32-33`): sau một lượt treo, router chỉ mở lượt kế nếu phần giờ còn lại tới hạn chót ≥ ngưỡng. Muốn kiểm "provider kế **không** được gọi" → chọn `deadline − providerTimeoutMs < 2 500` (mục 6: 3000 − 1500); muốn kiểm "provider kế được thử trong phần giờ còn lại" → để `deadline − (thời gian provider đầu trả lời) ≥ 2 500` (ca `b4` mục 6: 4000 − 500). Mỗi ca như vậy là thời gian chờ thật cộng vào `npm test` — ghi vào §1.1.
- **Lỗi mới của provider thật** → trước hết thêm một `Handler` nhái **đúng body/header thật** (như `err429GeminiDailyArray`), rồi mới sửa `classifyError`/`isDailyQuota`/`messageRetryAfterMs` trong `src/ai/router.ts`. Khẳng định phải soi cả `cooldownReason` tiếng Việt (có nêu đúng tên biến `AI_<TÊN>_API_KEY`/`_MODEL`).
- Dùng `createRouter(cfgWith(...), { now, quiet: true, rand })` khi cần loại bỏ ngẫu nhiên (`balanced`).
- Mục mới trong `test-router.ts` gọi `generateCandidate`/`generateRecap`: đặt `currentTask = 'candidate' | 'recap'` trước và trả về `'scene'` sau (như mục 9, `:653-660`) — `taskOf()` chỉ nhận ra qua tên schema hoặc tiền tố `NHIỆM VỤ:`, mọi ca khác (vd đã hạ `json_object`) rơi về biến này (§7.1).
- Kiểm **hai mặt** của mỗi chính sách: provider bị phạt đúng và provider kia **không** bị gọi oan (`countB() === b0`).
- Snapshot: `JSON.parse(JSON.stringify(b.serialize()))` rồi `b2.restore(...)` — kiểm cả trường hợp sang ngày mới và dữ liệu rác.
- `test-llm.ts` dành cho hành vi **Brain + sanitize + prompt** với 1 provider: đẩy `script.push(...)` một handler trả JSON "bẩn", gọi `generateScene/generateCandidate/generateRecap/generateBeats`, soi `requests[i].body` và kết quả đã làm sạch. Sửa chuỗi trong `src/ai/prompts.ts` thì cập nhật `smart` (`:73-118`) và các regex `speaker chỉ dùng:`, `(\d+)–(\d+) câu`, `^- \[id\]`, `verdict: "…"`.
- Luôn kiểm `leaks()`/`SECRET` không xuất hiện trong `usage()`, `serialize()`, `warned`, `infos`.

### 12.2 Cho Director / World (`scripts/smoke.ts`, `scripts/smoke-story.ts`)

Chọn nơi đặt: **bất biến của World/bản đồ/giao thức/serialize** → `smoke.ts` (một hạt, nhiều phần); **hành vi câu chuyện/HR/thời sự/beats, cần nhiều hạt và khẳng định thống kê** → `smoke-story.ts`.

Khung một lượt chạy (rút từ `smoke-story.ts:199-326`):

```ts
Math.random = mulberry32(seed);                        // TRƯỚC await import()
const { CONFIG } = await import('../src/config.js'); // … rồi brain, world, director
const config = { ...CONFIG, openaiKey: '', persist: false, timeMode: 'compressed' as const, devPanel: true, historyEnabled: true, historyDir: tmp, newsEnabled: false };
let vt = Date.now(); const now = () => vt;
const msgs: ServerMsg[] = [];
const brain = createBrain(config, { now, quiet: true });
const world = new World({ config, brain, emit: (m) => msgs.push(m), now });
const director = new Director(world, brain);
director.hooks.decision = (info) => { /* kiểm hàng rào */ };
world.attachDirector(spy /* DirectorApi bọc director để đếm móc */);
const step = async (n = 1) => { for (let i = 0; i < n; i++) { vt += 100; world.advance(100); await new Promise((r) => setImmediate(r)); } };
world.handleClient({ t: 'dev', action: 'event', name: 'hr_review' });   // ép cảnh như nút dev
```

Những móc có sẵn để khẳng định:

| Móc | Dùng để |
|---|---|
| `emit(msg)` | đếm `frame/log/scene/recap/rumors/toast`; `scene.status 'end'` + summary "bị gián đoạn" = cảnh bị huỷ |
| `DirectorApi` bọc (`spy`) | đếm `onDayEnd(day, results)` (KPI), `onSlackerSpotted`, `onBossLeft/Returned`, `onAgentArrived(id, late)`, `onEvent` |
| `director.hooks.decision(info: DecisionInfo)` | kiểm hàng rào từng quyết định HR đã thi hành |
| `director.stats()` | `queue, timers, vacancies, summaries, dayEvents, rumors, recaps`, bộ đếm `counters`, khoá v3, `story_*`, `hrReviewsLedger`, `newsUsed`, `newsDiscussed`, `driftPlans` (`director.ts:572-590`) |
| `director.recentNews(n)` | tin đã bàn (so với `news.recent()`/`isUsed`) |
| `world.agents()`, `world.agent(id)`, `world.hello()`, `world.clickStats()`, `world.headcount()`, `world.company()` | trạng thái World |
| `director.serialize()/restore()` | round-trip: so JSON phần quan tâm trước/sau; thử restore rác |
| `brain.usage()` | `mode 'offline'`, `calls 0` để chắc không gọi mạng |

Quy tắc:

- Thêm loại cảnh mới → cập nhật danh sách khẳng định `SCENE_DEFS có đủ … loại` (`smoke-story.ts:494`) và `RETRY_TYPES`/ngưỡng liên quan trong tài liệu [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md).
- Đổi luật `hr.ts` → đổi `guardOk()` **cùng commit**; đổi câu chữ log HR (`"đã bị cho nghỉ việc"`, `"đợt cắt giảm"`, `"xin nghỉ việc và rời"`, `"bị HR nhắc nhở KPI"`, `"chính thức gia nhập"`) → đổi regex ở `smoke-story.ts:395-398` và `smoke.ts hrState()` (`:419-428`).
- Khẳng định thống kê phải có **ngưỡng có lý do** (ghi trong tên khẳng định) và được thử trên ≥ 3 seed cố định trước khi merge; không ép kịch bản (không "đánh dấu" ai).
- Mọi khẳng định tiếng Việt có dấu, kèm `info` đủ để debug mà không cần chạy lại (seed, ngày, tên người).
- Không ghi ra ngoài thư mục tạm; không mạng; giữ tổng thời gian `npm test` trong tầm 1 phút.

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật |
|---|---|
| `package.json` scripts (`test`, `smoke*`, `test:*`, `eyeball:hr`) | §1.1 bảng lệnh của tài liệu này; `README.md` §12; `SPEC.md` §9 dòng "`npm test` = …"; [`01-tong-quan.md`](01-tong-quan.md) hàng "Test" |
| `tsconfig.json` (`include`, `target`, `module`) | §1.2, §2 |
| Biến môi trường của script (`SMOKE_*`, `SMOKE_STORY_*`, `EYEBALL_*`, `TEST_VERBOSE`) | §3.2, §4.2, §8, §1.3; [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) nếu tài liệu đó liệt kê biến test |
| Luật hàng rào trong `src/sim/hr.ts` (`allowedActions`) | `guardOk()` trong `smoke-story.ts:112-152` **cùng commit**; §4.4 bảng; [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md); chạy `npm run smoke:story` với ≥ 3 seed cố định |
| Câu chữ log HR / toast / log sếp (regex trong smoke, smoke-story) | §3.5 phần 2, §4.5; chạy `npm run smoke` và `smoke:story` |
| `SCENE_DEFS` (thêm/bỏ loại cảnh), `BEAT_KINDS` (hiện 17) | khẳng định #3, #10 ở §4.6; `smoke-story.ts:494, 505`; chạy `smoke:story` |
| Bản đồ `src/sim/map.ts` (SPOTS/ROOMS/FURNITURE/WALLS) | kiểm tra tĩnh `smoke.ts:108-138` (toạ độ WC (20,8),(21,8); showroom (2,3),(3,3),(1,3) / (6,3),(7,3),(8,3); cửa `WALLS[7][20|21] === 'D'`); §3.3 mục 5; `docs/v2-contract.md` §1 |
| `data/products.json` id `son-kem-li`, `ban-phim-co` | `smoke.ts:525-529`; §1.2 |
| Prompt (`src/ai/prompts.ts`) — chuỗi `NHIỆM VỤ:`, `speaker chỉ dùng:`, `N–M câu`, `HỒ SƠ NHÂN SỰ`, `TRẦN 1 LẦN HỌP`, `LUẬT TIN THẬT`, `verdict: "…"` | handler `smart` và các check trong `test-llm.ts` (§6.1, §6.2 mục 10–14), `taskOf/smart` trong `test-router.ts`; §12.1; chạy `npm run test:llm && npm run test:router` |
| Schema (`src/ai/schemas.ts`: tên `canh_hoi_thoai`, `ke_hoach_bien`, `ho_so_ung_vien`, `ban_tin_ngay`) | `test-router.ts taskOf()`; `test-llm.ts` mục 13; §6.2/§7.1 |
| `MAX_TOKENS`/`DEADLINE_MS` trong `src/ai/brain.ts` (1300/450; 27 s…) | `test-llm.ts` mục 2 (`max_completion_tokens 1300`), mục 13 (450); §6.2 |
| `ROUTER_POLICY` (`src/ai/router.ts`: `minAttemptMs` 2,5 s, `minAttemptReasoningMs` 6 s, 20 s/30 s/60 s/15 phút/1 giờ/`retryAfterMaxMs` 6 h/0.9/256/pace 25 %…) | `test-router.ts` mục 2, 2b, 3, 5, 6, 8, 13; `test-llm.ts` mục 8 (thời gian về offline); §1.1, §6.2, §7.2, §12.1 |
| Thứ tự chụp `DecisionInfo` rồi `executeDecision` trong `src/sim/director.ts:3297-3317` | giữ ảnh chụp **trước** thi hành — nếu đổi, `guardOk` (`day − ledger.lastFireDay ≥ 2`) sẽ báo vi phạm sai; §4.5 |
| Định dạng lỗi provider mới (429/400 body) | thêm `Handler` nhái vào `test-router.ts:136-162` trước khi sửa `classifyError`; §7.1, §12.1 |
| `src/news/*` (bộ lọc, `NewsStore` trần 40/500/20, `expandCategories` 6 nhóm) hoặc thêm fixture | `test-news.ts`; §5 (quy ước ngày fixture); [`06-tin-tuc-thoi-su.md`](06-tin-tuc-thoi-su.md) |
| `src/sim/archive.ts` (tên file, `index.json`, gzip 7/giữ 180, `HISTORY_READ_MAX` 5000) | `smoke.ts` phần 5e/5e'; §3.5 |
| Giao thức `frame` (`FRAME_MS`, `ts`, thứ tự `[id,x,y,dir,act,emote,flags]`, bit 8) | `smoke.ts emit()` (§3.4); `store.js` phần nội suy; đo lại §10.4; [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md) |
| `public/js/store.js` nội suy/`store.net` hoặc `public/js/main.js` móc `__vpa` | §10.4 bảng trường; đo lại local + proxy jitter; [`07-frontend-ve-canvas.md`](07-frontend-ve-canvas.md) |
| `publicStatus()` / quyền dev (`src/server.ts`), id phần tử HUD/devbar/sidebar, class/`aria-label` nút dev (`devbar.js:29, 38`) | §10.2 bước 5, §11 checklist (mục 4–5, 9); [`08-frontend-giao-dien.md`](08-frontend-giao-dien.md) |
| Thêm script QA trình duyệt vào repo | §10 (bỏ ghi chú "chưa có trong repo"), §1.1 bảng, `package.json` |
| Số đo thời gian chạy / số khẳng định | §1.1, §5 (SPEC "76 khẳng định"), mục mở bên dưới |

## Câu hỏi còn mở / cần kiểm tra

- **Thời gian chạy** `npm test` chưa đo lại ngày 2026-11-02 (README ước smoke ~6 s, smoke:story ~30 s; test-llm có chờ thật ở mục 8 ≈ 3,5 s và mục 15 `sleep(1)` mỗi 4 bước; test-router ≈ 5,5 s ở mục 6 (1,5 s ca Alpha treo + ~4 s ca `b4`)). Nên đo và ghi vào §1.1.
- **Số khẳng định** từng script chưa đếm (SPEC §10.2 ghi test-news "76 khẳng định"; smoke in `checks.length`, smoke-story `checks.length`, test-llm/test-router `passed/total`). Chạy một lần và ghi lại để phát hiện khi test bị vô tình bỏ bớt.
- **Flaky**: các khẳng định thống kê của `smoke-story` (#11–#14, #16) với seed theo giờ — chưa có số liệu tỉ lệ đỏ oan. Cân nhắc cố định seed trong `npm test` (vd `SMOKE_STORY_SEED` mặc định cố định) và chỉ chạy seed theo giờ khi dev chủ động.
- **Môi trường cô lập**: smoke/smoke-story nạp `.env` thật của máy (§1.2). Cân nhắc một cờ hoặc `--env-file` rỗng để test không phụ thuộc cấu hình cục bộ (`KPI_LOW_RATIO`, `HR_REVIEW_EVERY_DAYS`, `SHOWROOM_SCENE_MIN_MINUTES`…).
- **Không có test tự động cho `public/` và lớp HTTP/WS** (`/api/*`, `/go/:id`, `/v/<ver>/`, cookie `vpa_dev`, `publicStatus`). Script QA Chrome/CDP (§10) chưa nằm trong repo; cần quyết định có đưa vào `scripts/qa/` không và chạy ở đâu (chỉ máy dev có Chrome).
- Nút dev trong `#devbar` không có thuộc tính `data-event` theo tên nội bộ (`payday`, `news`…), chỉ có `aria-label` tiếng Việt (§10.2 bước 5) — nếu nhãn trong `public/js/labels.js` đổi, script QA bấm nút sẽ hỏng; cân nhắc thêm `data-event="<name>"` khi dựng nút (`devbar.js:29`).
- **Toast đè bong bóng thoại**, **nút dev `news` bắn 2 cảnh `news_chat` liền nhau** (chủ dự án báo) — chưa có khẳng định nào bắt; nên thêm vào `smoke-story` (đếm `news_chat` bắt đầu trong 60 s sau nút `news` phải = 1) và vào checklist §11 mục 7.
- `SHOWROOM_SCENE_MIN_MINUTES` đọc thẳng `process.env` (`director.ts:65-69`) nên test không ghi đè được qua config — nên đưa qua `CONFIG` để smoke kiểm được nhịp showroom.
- `eyeball-hr.ts` chỉ in, không lưu kết quả; cân nhắc tuỳ chọn ghi JSON ra scratchpad để so các model với nhau (vẫn không in key).
- Chưa kiểm chứng Cloudflare Workers AI / Gemini có trả `prompt_tokens_details.cached_tokens` không (ảnh hưởng số liệu `cachedTokens`); dùng probe §9.2 để xác nhận.
- **Tên model Groq bị loại** lệch giữa các nguồn: tài liệu này (§9.2), `README.md:101` và chủ dự án ghi `qwen/qwen3.8-27b` (`test-router.ts:301` cũng nhái lỗi OTPM với tên này), nhưng `.env.example:32` gợi ý `qwen/qwen3-32b` và `01-tong-quan.md` chép theo `.env.example`. Giữ theo README/chủ dự án ở đây; cần đối chiếu danh mục model thật của Groq rồi thống nhất một tên trong `.env.example`/README/01. — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
- `guardOk` lỏng hơn `allowedActions` (§4.4): cân nhắc đưa `firePending`/`promotionPending` và `lastPraiseDay[a.id]` vào `DecisionInfo` rồi kiểm trong `guardOk`, để hàng rào test thật sự độc lập với danh sách `allowed` của Director.
- Số dòng tham chiếu trong tài liệu này đã đối chiếu `cat -n` ngày 2026-11-02; file test đổi là lệch ngay. Khi tra, ưu tiên tìm theo tên hằng/hàm (`SEED`, `MIN_DAYS`, `HISTORY_DIR`, `guardOk`, `taskOf`, `section('6.…')`) thay vì số dòng.
