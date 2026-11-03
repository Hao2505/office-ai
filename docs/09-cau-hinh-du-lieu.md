# Cấu hình & dữ liệu trên đĩa

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: `src/config.ts`, `.env.example` (và vai trò của `.env`, `deploy/.env.production`, `deploy/vps.env`), `data/products.json` (`src/content/products.ts`, `src/sim/showroom.ts`), `data/state.json` (`src/sim/persist.ts`, phần lưu/khôi phục của `src/sim/world.ts`, `Director.serialize/restore`, `Brain`/`Router.serialize/restore`, `NewsStore.serialize/restore`), `data/history/` (`src/sim/archive.ts`), `docs/real-products.json`, các chỗ đọc `process.env` ngoài `config.ts` (`src/sim/director.ts:66`, `src/ai/llm.ts:279`, `scripts/*.ts`, `deploy/deploy.sh`) · Đọc khi: thêm/đổi một biến môi trường; cần biết **giá trị mặc định thật trong code** (không phải con số trong README); sửa shape file trạng thái hay archive; thêm/sửa sản phẩm affiliate; cần trả lời "khởi động lại thì mất gì, còn gì"; chuẩn bị `.env` cho production.

Tài liệu này trả lời bốn câu hỏi: (1) **mọi biến môi trường** của dự án — tên, mặc định, kiểu, kẹp, nơi đọc và ảnh hưởng — nằm ở một bảng duy nhất; (2) **ba file env** khác nhau ở vai trò gì (không bàn nội dung, vì chúng chứa bí mật); (3) **từng file dữ liệu trên đĩa** (`data/products.json`, `data/state.json`, `data/history/`, `docs/real-products.json`) có cấu trúc gì, ai ghi, ai đọc, trần ở đâu, hỏng thì sao; (4) khi sửa code thì phải chạm vào đâu để tài liệu và test không lệch. Đây là bản mô tả **code hiện tại**; chỗ nào README/SPEC lệch sẽ ghi rõ. Hướng dẫn "lấy key, điền `.env`" cho chủ dự án vẫn ở [`../README.md`](../README.md) §3–§4, §5.1, §8, §10 — ở đây chỉ trỏ tới. Bảng cấu hình v3 gốc ở [`../SPEC.md`](../SPEC.md) §10.1; hợp đồng kiểu `Product`/`ShowroomProduct`/`LogEntry`/`NewsItem` ở [`../src/types.ts`](../src/types.ts). Vùng tiêu thụ từng biến được mô tả sâu hơn ở [03-mo-phong-the-gioi.md](./03-mo-phong-the-gioi.md) (World), [04-dao-dien-cau-chuyen-nhan-su.md](./04-dao-dien-cau-chuyen-nhan-su.md) (Director/HR), [05-lop-ai.md](./05-lop-ai.md) (AI), [06-tin-tuc-thoi-su.md](./06-tin-tuc-thoi-su.md) (thời sự), [02-kien-truc-va-giao-thuc.md](./02-kien-truc-va-giao-thuc.md) (server), [10-van-hanh-deploy.md](./10-van-hanh-deploy.md) (VPS), [11-kiem-thu-qa.md](./11-kiem-thu-qa.md) (test). Mục lục bộ tài liệu: [README.md](./README.md); lộ trình đọc theo vai trò cũng có ở [01-tong-quan.md](./01-tong-quan.md) §10.

Quy ước: tham chiếu `file:dòng` là số dòng lúc viết (file có thể dịch dòng — tìm theo tên hàm nếu lệch). **Không có API key, token, mật khẩu nào trong tài liệu này**; chỉ nhắc **tên** biến lấy từ `src/config.ts` và `.env.example`. Các file `.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json` **không được đọc** khi viết tài liệu; chỉ xác nhận chúng có/không tồn tại.

---

## 1. Bức tranh chung

### 1.1 Cấu hình đi đâu, dữ liệu nằm đâu

```
.env (ở process.cwd())
  │ dotenv: loadEnv({ quiet: true }) chạy NGAY LÚC IMPORT src/config.ts (config.ts:1-2)
  ▼
process.env ─────────────────────────────────────────────────────────────────────────────┐
  │                                                                                     │
  ├─▶ src/config.ts → CONFIG  (tính MỘT LẦN khi nạp module, config.ts:252-329)          ├─▶ src/sim/director.ts:65-69
  │     ├ buildProviders(env)   → CONFIG.providers / providerNotes / providersLegacy      │   showroomMinMs(): đọc thẳng
  │     ├ parseNewsFeeds(raw)   → CONFIG.newsFeeds / newsFeedNotes                        │   SHOWROOM_SCENE_MIN_MINUTES
  │     └ num/bool/str/limit/list cho các trường còn lại                                   └─▶ src/ai/llm.ts:279
  │                                                                                         DEBUG_PROMPTS === '1'
  ├─▶ src/server.ts        port · devPanel/devToken · persist/stateFile · history* · newsEnabled
  ├─▶ src/sim/world.ts     timeMode · gameMinutesPerSecond · kpi* · story* · persist/stateFile · companyName
  ├─▶ src/sim/director.ts  cfgNum/cfgBool(CONFIG → env → mặc định) · kpiLowRatio · productMentionMinMinutes …
  ├─▶ src/ai/brain|router|llm   providers (AI_<TÊN>_*) · dailyBudgetUsd · minSecondsBetweenLlm · aiRouting …
  ├─▶ src/news/store.ts    getNews() singleton: newsEnabled/newsFeeds/newsRefreshMinutes/newsMaxAgeDays/…
  └─▶ scripts/*.ts         { ...CONFIG, ghi đè vài trường } — vẫn nạp .env thật của máy

Dữ liệu trên đĩa
  data/products.json ──readFileSync 1 lần (products.ts:13,129)──▶ getProducts()/getProduct() ──▶ hello.products, chip thoại, /go/:id
  data/state.json    ◀──World.save() mỗi 60 s + khi tắt (server.ts:25,498,507); World.load() lúc khởi động (server.ts:252)
  data/history/YYYY-MM-DD.jsonl(.gz) + index.json ◀──Archive (ghi lô mỗi 2 s; xoay vòng sau 5 s khởi động và khi sang ngày VN)
  docs/real-products.json ── chỉ người đọc; không module nào import
```

### 1.2 Mọi thứ nằm trên đĩa

| Đường dẫn | Ai ghi / đọc | Trong git? | rsync lên VPS? | Khi nào đổi | Ghi chú |
|---|---|---|---|---|---|
| `.env` | dotenv đọc 1 lần lúc import `config.ts` | **không** (`.gitignore:2`) | **không** (`deploy.sh:33` exclude) | sửa tay → phải khởi động lại | Trên VPS, `/opt/vibecorp/.env` là **bản chép** của `deploy/.env.production` (`deploy.sh:40`), bị ghi đè mỗi lần deploy |
| `.env.example` | chỉ người đọc; code **không** đọc | có | có | khi thêm/đổi biến | mẫu tên biến + chú thích; một số giá trị gợi ý **khác** mặc định code (xem §4.2) |
| `deploy/vps.env` | `deploy.sh:14` `source` | **không** (`.gitignore:9`) | **không** | hiếm | cung cấp `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_PASS`, `DOMAIN` (chỉ tên) |
| `deploy/.env.production` | `deploy.sh:40` `scp` → `$APP_DIR/.env` | **không** (`.gitignore:10`) | **không** qua rsync, nhưng được `scp` riêng | khi đổi cấu hình production | `chmod 600` trên VPS (`deploy.sh:43`) |
| `data/products.json` | `src/content/products.ts` đọc **một lần mỗi tiến trình** | có | có (không bị exclude) | sửa tay → khởi động lại | danh mục affiliate, 18 món lúc viết |
| `data/state.json` | `World.save()` / `World.load()` | **không** (`.gitignore:4`) | **không** (`deploy.sh:32`) | mỗi 60 s + khi tắt | snapshot sống; ghi nguyên tử |
| `data/state.json.tmp-<pid>` | `writeJsonAtomic` (`persist.ts:19`) | không (`.gitignore:5-6`) | không | thoáng qua khi ghi | còn sót = tiến trình chết giữa lúc ghi; xoá được |
| `data/state.json.bad-<ISO>` | `quarantineFile` (`persist.ts:45-56`) | không (`.gitignore:5`) | không | khi file hỏng / sai version | giữ để cứu tay; không tự xoá |
| `data/history/YYYY-MM-DD.jsonl` | `Archive` nối thêm | **không** (`.gitignore:13`) | **không** (`deploy.sh:33`) | ghi lô mỗi 2 s | ngày theo giờ Việt Nam |
| `data/history/YYYY-MM-DD.jsonl.gz` | `Archive.rotate()` | không | không | sau `HISTORY_GZIP_AFTER_DAYS` | gzip level 6; có thể nhiều thành viên gzip |
| `data/history/index.json` | **chỉ** `Archive.listDays()` (`archive.ts:340`), tức khi có `GET /api/history` không kèm `date` — `rotate()` không ghi | không | không | khi `listDays()` vừa đếm dòng một ngày `.gz` | `{ "YYYY-MM-DD": { mtimeMs, size, count } }`; xem §7.4 |
| `docs/real-products.json` | chỉ người | có | có (`docs/` không bị exclude, chỉ `docs/preview`) | khi chủ dự án gửi sản phẩm thật | 2 món đã có tên, 4 chỗ trống |
| Trình duyệt: `localStorage['vpa.dev']`, cookie `vpa_dev` | `public/js/net.js:13`, `src/server.ts:78` | — | — | khi mở trang kèm `#dev=`/`?dev=` | mã admin phía client (xem §9.3) |

Lúc viết (máy dev): `.env`, `deploy/vps.env`, `deploy/.env.production` **tồn tại** (không đọc); `data/state.json` **không tồn tại** dù `data/history/` có dữ liệu tới 2026-11-02 11:21 (xem câu hỏi mở); chưa có file `.gz` hay `index.json` (chưa đủ 7 ngày).

---

## 2. Cách cấu hình được đọc

### 2.1 Thứ tự nạp, tính một lần, không hot-reload

- `src/config.ts:1-2`: `import { config as loadEnv } from 'dotenv'; loadEnv({ quiet: true });` — chạy **ngay khi module được import**. Mọi module `import { CONFIG }` (server, world, director, brain, news store, offline, **cả scripts test**) đều kéo theo việc đọc `.env` ở **thư mục làm việc hiện tại** (`process.cwd()`). Trên VPS, pm2 chạy `npm start` sau `cd /opt/vibecorp` (`deploy.sh:44`) nên đọc `/opt/vibecorp/.env`.
- `CONFIG` là **object literal tính một lần** (`config.ts:252-329`). Đổi `.env` → phải khởi động lại tiến trình (`npm run dev` dùng `tsx watch` chỉ theo dõi file `src/` được import, không theo dõi `.env` — cần kiểm tra).
- dotenv theo mặc định **không ghi đè** biến đã có sẵn trong môi trường tiến trình; trên VPS, biến do pm2 giữ lại (`pm2 restart --update-env`, `deploy.sh:45`) có thể thắng `.env` — xem câu hỏi mở.
- Đường dẫn tương đối trong cấu hình (`STATE_FILE`, `HISTORY_DIR`) được `resolve()` theo cwd (`persist.ts:17`, `archive.ts:79`). Riêng `data/products.json` được tìm **theo vị trí file module** (`products.ts:13`: `new URL('../../data/products.json', import.meta.url)`), không theo cwd và **không cấu hình được**.

### 2.2 Hàm chuyển kiểu — ý nghĩa thật của từng kiểu giá trị

| Hàm (`config.ts`) | Dòng | Rỗng / thiếu | Giá trị nhận | Bẫy |
|---|---|---|---|---|
| `num(v, d)` | 4-5 | → `d` | `Number(v)` nếu không NaN | **không** làm tròn, **không** kẹp (trừ chỗ gọi tự `Math.max`); `PORT=abc` → 3000 |
| `bool(v, d)` | 6-7 | → `d` | `false` **chỉ khi** là `false`/`0`/`no`/`off` (sau trim, không phân biệt hoa thường); **mọi chuỗi khác → `true`** | `PERSIST=yes`, `PERSIST=1`, `PERSIST=sai` đều là `true` |
| `str(v)` | 8 | `''` | trim | |
| `limit(v)` | 10-13 | `undefined` = **không giới hạn** | số dương → `Math.floor` | **`0` và số âm cũng là "không giới hạn"**, không phải "cấm" — `AI_X_RPD=0` nghĩa là không trần |
| `list(v)` | 244 | `[]` | tách `,`, trim, bỏ rỗng | dùng cho `NEWS_BLOCKLIST` |
| `parseExtraBody(raw, label)` | 74-87 | `undefined` | JSON **object**; xoá 6 khoá `model`, `messages`, `response_format`, `max_tokens`, `max_completion_tokens`, `stream` | sai cú pháp hoặc là mảng → `console.warn` + bỏ qua, app vẫn chạy; **không** xoá `temperature`/`reasoning_effort`/`prompt_cache_key` → có thể ghi đè tham số router tự đặt (`llm.ts:351` `Object.assign`) |
| `parseNewsFeeds(raw)` | 221-241 | — | tách theo `,` **hoặc xuống dòng**; mỗi mục `nhom\|url`; nhóm ∈ `NEWS_GROUPS`, url khớp `^https?://\S+$`; url trùng bị bỏ | mục sai → đẩy vào `notes` (`CONFIG.newsFeedNotes`), in cảnh báo lúc khởi động (`server.ts:561`) |
| `TIME_MODE` (không qua helper) | 279 | `compressed` | **đúng chuỗi** `realtime` (sau trim, **phân biệt hoa thường**) | `Realtime`/`REALTIME` → `compressed` lặng lẽ |
| `STATE_FILE`, `COMPANY_NAME` | 293-294 | mặc định | `?.trim() \|\| mặc định` | chuỗi toàn khoảng trắng → mặc định |
| `siteUrlOf(v)` (2026-11-03) | 253-263 | `''` | `new URL(v)`: chỉ `http:`/`https:`, trả `origin + pathname` bỏ `/` cuối | sai cú pháp / giao thức khác (`ftp:`, `javascript:`) → `''` (= suy từ request) |

### 2.3 Ba đường đọc env **ngoài** `CONFIG` (cần nhớ khi thêm biến)

1. **Director đọc phòng thủ** `cfgNum(cfg, keys, env, d)` / `cfgBool(...)` (`director.ts:75-92`): thử các khoá camelCase trong `CONFIG` (chỉ nhận đúng kiểu `number`/`boolean`), **rồi** `process.env[env]`, **rồi** mặc định. Dùng cho `newsEnabled`, `newsSceneMinMinutes`, `newsAllowShowbiz`, `newsMaxAgeDays`, `showrunnerEnabled`, `storyTraitDrift`, `hrReviewEveryDays`, `showrunnerEveryGameMinutes` (`director.ts:420-427`). Hệ quả: test ghi đè trường `CONFIG` là đủ; nhánh env chỉ chạy khi `CONFIG` thiếu khoá (lịch sử: Director viết trước khi sim engineer thêm trường).
2. **`SHOWROOM_SCENE_MIN_MINUTES`** — `director.ts:65-69` `showroomMinMs()` đọc **thẳng `process.env`**, mặc định `30`, nhận mọi số `≥ 0` (`0` = không giới hạn), nhân `60_000`. **Không có trong `CONFIG`** → không ghi đè được bằng `{ ...CONFIG, ... }` trong smoke; là ngoại lệ so với quy ước "mọi cấu hình qua `CONFIG`".
3. **`DEBUG_PROMPTS`** — `src/ai/llm.ts:279` `process.env.DEBUG_PROMPTS === '1'` (chỉ nhận đúng `'1'`): in system prompt (1 lần/mã băm), user prompt và phản hồi AI ra terminal.

Hai cách đếm, cùng một sự thật: đếm theo **biến** thì chỉ có **2** biến thật sự nằm ngoài `CONFIG` (`SHOWROOM_SCENE_MIN_MINUTES`, `DEBUG_PROMPTS`) — đây là cách [14-quy-uoc-dong-gop.md](./14-quy-uoc-dong-gop.md) nói "hai ngoại lệ"; đếm theo **đường code đọc `process.env`** thì có **3** (thêm nhánh dự phòng `process.env[env]` của `cfgNum/cfgBool`, `director.ts:81,88`, chỉ chạy khi `CONFIG` thiếu khoá, nên với `CONFIG` hiện tại không bao giờ tới). Khi thêm biến mới, mục tiêu là **không** làm tăng con số nào trong hai con số này.

Ngoài ra `scripts/*.ts` và `deploy/deploy.sh` có bộ biến riêng (§3.12, §3.13) — không phải cấu hình của app.

### 2.4 Các "gương" tương thích cũ và công tắc tắt AI

`CONFIG` giữ các trường cũ làm **gương của provider đầu** (`config.ts:261-268`): `openaiKey` (= `providers[0].apiKey`, rỗng nếu không có provider), `openaiBaseUrl`, `model` (fallback `OPENAI_MODEL` hoặc `gpt-4o-mini`), `reasoningEffort`, `isReasoningModel`, `price`. Quan trọng: **`openaiKey === ''` là công tắc TẮT AI hoàn toàn** — `router.resolveProviders()` (`src/ai/router.ts:307-320`) trả `[]` ngay khi `config.openaiKey` rỗng **dù `providers` có phần tử**; `scripts/smoke.ts:93` dùng đúng cơ chế này (`{ ...CONFIG, openaiKey: '' }`). `CONFIG.providersLegacy = true` khi dựng từ `OPENAI_*` (`config.ts:260`).

### 2.5 Dựng config cho test / script

- `makeProvider({ name, apiKey, model, ...})` (`config.ts:334-346`): điền mặc định `label`, `price: FREE`, `reasoningEffort: ''`, `isReasoningModel` theo `REASONING_MODEL_RE`, `tier 'normal'`, `json 'schema'`, `pace true`, `weight 1`.
- `withProviders(base, providers)` (`config.ts:352-366`): thay danh sách provider **và đồng bộ các gương** (`openaiKey` = key provider đầu). Dùng trong `test-llm.ts`/`test-router.ts`.
- Smoke ghi đè trực tiếp (`scripts/smoke.ts:91-107`): `openaiKey: ''`, `persist: false`, `kpiWarnDays: 1`, `kpiFireDays: 2`, `timeMode: 'compressed'`, `devPanel: true`, `offlineMinSeconds: SMOKE_SCENE_GAP ?? CONFIG.offlineMinSeconds`, `historyEnabled: true`, `historyDir: <tạm>`, `newsEnabled: false`, `storyRandomizeTraits: true`, `storyTraitDrift: true`. **Các trường không ghi đè vẫn lấy từ `.env` thật của máy** (`kpiLowRatio`, `productMentionMinMinutes`, `hrReviewEveryDays`, `SHOWROOM_SCENE_MIN_MINUTES`…) → kết quả smoke có thể phụ thuộc `.env` cục bộ.

---

## 3. Bảng biến môi trường

Cột "Mặc định" là **mặc định trong code** (khi biến trống/thiếu), không phải giá trị gợi ý trong `.env.example` (khác biệt ghi ở §4.2). Cột `CONFIG.` là tên trường tương ứng; "—" = không có trong `CONFIG`.

### 3.1 Nhà cung cấp AI — biến chung

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `AI_PROVIDERS` | rỗng | chuỗi phẩy → tên chữ thường, trim, **dedup**, giữ thứ tự (`config.ts:135`); tên phải khớp `^[a-z0-9_]+$` (`:161`) | `providers`, `providerNotes`, `providersLegacy` | Danh sách provider theo **thứ tự ưu tiên**: thứ tự thử khi `AI_ROUTING=priority` và thứ tự hoà khi `balanced`. Mỗi tên `X` mở ra bộ `AI_X_*` (prefix `AI_${NAME.toUpperCase()}_`, `:165`). **Rỗng → dùng cấu hình kiểu cũ `OPENAI_*`** (`:137-156`). Tên sai / thiếu key / thiếu model → bị bỏ qua, lý do vào `providerNotes` → in `⚠️` lúc khởi động (`server.ts:550`) |
| `AI_ROUTING` | `priority` | `'balanced'` (sau lowercase) → `balanced`; **mọi giá trị khác** → `priority` (`:273`) | `aiRouting` | `balanced`: thứ tự thử = xáo theo `(headroom + 0.05) × weight × (0.5 + rand())`, headroom = phần quota ngày (RPD/TPD) còn lại (`router.ts:463-475`); áp cho **mọi** task (`:480`), riêng việc quan trọng (priority `high`, candidate, recap) vẫn đưa tier `strong` lên trước (`:478-483`). `priority`: đúng thứ tự `AI_PROVIDERS` |

### 3.2 Nhà cung cấp AI — theo từng provider `AI_<TÊN>_*`

`<TÊN>` = tên trong `AI_PROVIDERS` viết hoa (ví dụ `gemini` → `AI_GEMINI_API_KEY`). Trường đích là `ProviderConfig` (`config.ts:40-68`), được đọc ở `buildProviders` (`:159-195`).

| Biến | Mặc định | Kiểu / kẹp | `ProviderConfig.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `AI_<TÊN>_API_KEY` | **bắt buộc** | chuỗi | `apiKey` | Rỗng → provider bị **bỏ qua** với lý do `chưa có key (AI_X_API_KEY)` (`:170`). Không bao giờ in ra log; `redactSecrets` che trong mọi thông điệp lỗi (`llm.ts`, `router.ts`) |
| `AI_<TÊN>_MODEL` | **bắt buộc** | chuỗi | `model` | Rỗng → bỏ qua (`:171`). Tên model còn dùng để **đoán model suy luận** qua `REASONING_MODEL_RE = /^(o\d\|gpt-5\|(openai\/)?gpt-oss\|deepseek-r\|(qwen\/)?qwen3)/i` (`:102`) và để tra bảng giá khi endpoint là OpenAI (`:181`) |
| `AI_<TÊN>_BASE_URL` | `KNOWN_BASE_URLS[tên]` cho `gemini`/`groq` (`:89-92`); provider khác → `undefined` = `api.openai.com` | URL | `baseUrl` | Endpoint OpenAI-compatible. **Cloudflare phải khai** (`.env.example:148`). Ảnh hưởng phụ: (a) giá mặc định chỉ lấy bảng khi `isOpenAiEndpoint` (`:104,181`); (b) `prompt_cache_key` chỉ gửi khi endpoint là api.openai.com (`llm.ts:348`); (c) múi giờ reset quota ngày: tên `gemini` hoặc base URL chứa `generativelanguage.googleapis.com` → 0h Pacific, còn lại 0h giờ VN (`router.ts:57-62`, `inferProviderName` `config.ts:107-112`) |
| `AI_<TÊN>_RPM` | không giới hạn | `limit()` (số dương → floor; 0/âm = không giới hạn) | `rpm` | Lượt/phút **tự áp** theo cửa sổ trượt 60 s (`router.ts:420-423`). Ghi nhận **trước** khi gửi: `recordAttempt()` (`router.ts:525-530`, gọi ở `:672` ngay trước `r.client.attempt` `:674`) cộng đồng thời `calls++`, `rpdUsed++`, `rpmTimes.push(t)` → lượt 429/5xx vẫn tiêu RPM **và RPD** |
| `AI_<TÊN>_RPD` | không giới hạn | `limit()` | `rpd` | Lượt/ngày tự áp (`router.ts:414-416`); "ngày" theo múi giờ reset của provider (Gemini: Pacific). Cộng **trước** khi gửi (cùng `recordAttempt`, xem hàng RPM) → lượt lỗi vẫn tiêu RPD. Là đầu vào của **giữ nhịp** (`PACE`) và `headroom` (balanced) |
| `AI_<TÊN>_TPD` | không giới hạn | `limit()` | `tpd` | Token (vào + ra)/ngày tự áp (`router.ts:417-419`). Khác RPM/RPD: chỉ cộng **sau** khi có `usage` — `account()` (`router.ts:540` `tpdUsed += promptTokens + completionTokens`) chạy khi gọi thành công, hoặc khi lỗi là `LlmError` **kèm** `usage` (`:680`); lượt 429/5xx không có usage **không** tiêu TPD (và không tính chi phí) |
| `AI_<TÊN>_PRICE_INPUT_PER_M` / `_PRICE_CACHED_INPUT_PER_M` / `_PRICE_OUTPUT_PER_M` | `0` (FREE), **trừ** endpoint OpenAI chính chủ + model có trong `PRICE_TABLE` (5 model `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, khớp tiền tố dài nhất, `:16-28`) | `num` USD / 1M token | `price.{input,cached,output}` | Chi phí cộng vào `costTodayUsd` → so với `DAILY_BUDGET_USD`. Bẫy: endpoint trả tiền không phải OpenAI (OpenRouter…) mà quên khai giá → chi phí luôn 0, ngân sách không bao giờ chạm |
| `AI_<TÊN>_REASONING_EFFORT` | rỗng | chuỗi | `reasoningEffort` | Gửi làm `reasoning_effort` nếu thuộc `REASONING_EFFORTS`; model suy luận không khai → `'low'`; model thường → không gửi (`llm.ts:320-322`). **Bẫy: chỉ cần đặt biến này là model bị coi là suy luận** (`:179`) → xin token ra ×3 và không gửi `temperature` |
| `AI_<TÊN>_REASONING` | tự đoán | `true`/`1` → suy luận; `false`/`0` → không; khác → `REASONING_MODEL_RE.test(model) \|\| reasoningEffort !== ''` (`:176-179`) | `isReasoningModel` | Model suy luận: `max_completion_tokens = maxTokens × 3` (`llm.ts:265-269` `outputBudget`), gửi `reasoning_effort` thay `temperature: 1` (`llm.ts:343-347`), cửa sổ tối thiểu để mở lượt gọi 6 s thay 2,5 s (`router.ts:31-32`) |
| `AI_<TÊN>_TIER` | `normal` | `'strong'` (sau lowercase), khác → `normal` (`:173`) | `tier` | `strong` được xếp trước cho priority `high`, sinh ứng viên, bản tin (`router.ts:478-483`) |
| `AI_<TÊN>_JSON` | `schema` | `'object'` → `object`, khác → `schema` (`:174`) | `json` | `object`: dùng thẳng `response_format: json_object` (`jsonObjectUntil = +∞`, `router.ts:352`); `schema`: thử `json_schema` strict, tự hạ xuống `json_object` khi bị 400 rõ ràng, nhớ 24 h (`ROUTER_POLICY.jsonObjectRememberMs`) |
| `AI_<TÊN>_LABEL` | `DEFAULT_LABEL[tên]` (`openai, gemini, groq, openrouter, mistral, deepseek, together, cerebras, ollama, local, cloudflare`, `:94-97`) hoặc viết hoa chữ đầu | chuỗi | `label` | Tên hiển thị trên chip AI (admin), log `[ai]`, thông điệp cảnh báo |
| `AI_<TÊN>_EXTRA_JSON` | không gửi gì thêm | JSON object (`parseExtraBody`, `:74-87`) | `extraBody` | Ghép thẳng vào body `chat/completions` bằng `Object.assign` (`llm.ts:351`), ví dụ tắt thinking của Gemma trên Cloudflare (`.env.example:156`). Xem bẫy ở §2.2 |
| `AI_<TÊN>_MAX_OUTPUT_TOKENS` | không trần | `limit()` | `maxOutputTokens` | Trần cố định cho `max_completion_tokens` của provider (`:190`), kết hợp với trần router **học được** từ lỗi "Request too large" (nhớ 7 ngày trong snapshot) |
| `AI_<TÊN>_MAX_REQUEST_TOKENS` | không giới hạn | `limit()` | `maxRequestTokens` | Request ước lượng (`estimateTokens(system) + estimateTokens(user) + outputBudget`, hệ số ~3,5 ký tự/token: `Math.ceil(len / 3.5)`, `src/ai/llm.ts:163-165`) lớn hơn → **không gửi** tới provider này trong request đó (`fits()`, `router.ts:486-491`; lý do vào `notes` "request ~N token vượt trần", `:667`) |
| `AI_<TÊN>_PACE` | `true` | `bool` (`:192`, viết vòng `!bool(...) ? false : true`) | `pace` | Giữ nhịp quota NGÀY: cho dùng tối đa `min(limit, burst + limit × phần ngày đã trôi)` với `burst = max(25 % limit, 30 lượt / 30 000 token)`; vượt → tạm coi như nghỉ, xem lại sau ≥ 60 s (`router.ts:437-458`, hằng `paceBurst 0.25`, `paceMinBurstReq 30`, `paceMinBurstTok 30_000`, `paceRecheckMs 60_000` ở `:49-53`). Chỉ có tác dụng khi khai `RPD`/`TPD`. `false` = dùng thoải mái tới hết |
| `AI_<TÊN>_WEIGHT` | `1` | `num` kẹp `0.05..5` (`:193`) | `weight` | Trọng số khi `AI_ROUTING=balanced` (`router.ts:472`); `< 1` = ít được chọn cho cảnh thường nhưng vẫn gánh khi bên khác hết quota |

### 3.3 Cấu hình AI kiểu cũ (chỉ có tác dụng khi `AI_PROVIDERS` trống)

| Biến | Mặc định | Nơi đọc | Ghi chú |
|---|---|---|---|
| `OPENAI_API_KEY` | rỗng → **không có provider** (offline) | `config.ts:138-139` | `providersLegacy: true` |
| `OPENAI_MODEL` | `gpt-4o-mini` | `:141`; còn là fallback của `CONFIG.model` (`:250,265`) | |
| `OPENAI_BASE_URL` | rỗng = api.openai.com | `:140`; fallback `CONFIG.openaiBaseUrl` (`:264`) | tên provider suy ra bằng `inferProviderName` (`gemini`/`groq`/`openai`) |
| `OPENAI_REASONING_EFFORT` | rỗng | `:144`; fallback `CONFIG.reasoningEffort` (`:266`) | |
| `OPENAI_RPM` / `OPENAI_RPD` / `OPENAI_TPD` | không giới hạn | `:150` | **không có trong `.env.example`** |
| `PRICE_INPUT_PER_M` / `PRICE_CACHED_INPUT_PER_M` / `PRICE_OUTPUT_PER_M` | bảng giá theo model (`tablePrice`), không có → giá `gpt-4o-mini` khi là OpenAI, FREE khi là Gemini/Groq | `:143,151`; fallback `CONFIG.price` (`:268`) | prefix rỗng của `priceFromEnv` |

### 3.4 Nhịp & ngân sách AI (chung mọi provider)

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `DAILY_BUDGET_USD` | `1` | `num` | `dailyBudgetUsd` | Trần chi phí/ngày (ngày VN) tính chung mọi provider: `underBudget = costToday < dailyBudgetUsd` (`brain.ts:133`). Chạm trần: cảnh thường bị bỏ (`skipped++`), cảnh `high` dùng offline (`brain.ts:245-249`); Director `llmGated()` cũng so `costTodayUsd ≥ budgetUsd` để khỏi dựng cảnh (`director.ts:641-650`). In ở log khởi động (`server.ts:538`); World dùng làm `budgetUsd` dự phòng khi `brain.usage()` lỗi |
| `MIN_SECONDS_BETWEEN_LLM` | `20` | `num` | `minSecondsBetweenLlm` | Khoảng cách tối thiểu (giây thật) giữa 2 lần cấp `'llm'`: priority `low` cần đủ, `normal` cần **một nửa**, `high` không chờ (`brain.ts:255-257`) |
| `MAX_CONCURRENT_LLM` | `2` | `num`; router dùng `max(1, floor)` | `maxConcurrentLlm` | Hàng đợi lời gọi AI đồng thời chung mọi provider (`router.ts` `acquire/release`); `reserve()` từ chối cảnh thường khi `inflight ≥ max`, cảnh `high` vẫn xếp hàng (`brain.ts:250-254`) |
| `LLM_ONLY_WHEN_WATCHED` | `true` | `bool` | `llmOnlyWhenWatched` | Không ai xem (`viewers === 0`, World báo qua `brain.setAudience`) → không gọi AI cho cảnh thường và beats (`brain.ts:245,344`); Director `llmGated()` đọc cùng cờ (`director.ts:644`) |
| `OFFLINE_MIN_SECONDS` | `8` | `num` | `offlineMinSeconds` | Khi không gọi được AI (không key / mọi provider nghỉ / cầu dao mở): nhịp tối thiểu giữa 2 cảnh thường (`brain.ts:239`). Smoke ghi đè bằng `SMOKE_SCENE_GAP` |
| `DEBUG_PROMPTS` | tắt | chỉ `'1'` | — | `llm.ts:279`: in prompt + phản hồi AI ra terminal. **Chỉ bật khi thử nghiệm** (prompt chứa tên nhân vật, tin thật; không chứa key) |

### 3.5 Thời gian

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `TIME_MODE` | `compressed` | đúng chuỗi `realtime` (phân biệt hoa thường, `:279`) | `timeMode` | `compressed`: ngày 1 bắt đầu 07:30 (`DAY_START`), tua được x1/2/5/10; `realtime`: theo giờ thật VN (UTC+7 cố định), T7/CN đóng cửa, `setSpeed` bị từ chối. World đọc ở constructor (`world.ts:470`); Director: `pace() = 2.5` ở realtime (mọi khoảng nghỉ/cooldown nhân 2,5) và `realSecToGameMin` đổi 60 s = 1 phút (`director.ts:621,633`); server in ở log (`server.ts:543-545`). **Đổi chế độ giữa 2 lần chạy** → khôi phục sang ngày mới `savedDay + 1` (xem §6.6) |
| `GAME_MINUTES_PER_SECOND` | `0.5` | `num`; World kẹp `(0, 60]`, sai → `0.5` (`world.ts:471-472`) | `gameMinutesPerSecond` | Phút game mỗi giây thật ở x1 (chế độ nén; 1 ngày làm ≈ 22 phút thật). Director dùng khi đổi cửa sổ chờ thật → phút game lúc tua (`director.ts:622`) |

### 3.6 KPI / nhân sự

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `KPI_LOW_RATIO` | `0.7` | `num` | `kpiLowRatio` | Dưới tỉ lệ `kpiToday / target` này là "KPI thấp" khi chấm cuối ngày (`world.ts` `computeResults`, tăng `lowStreak`). Gửi client qua `hello.rules` (`world.ts:919`; client kẹp `0.05..2`, `public/js/store.js:349`) để tô màu cột KPI. Director đưa vào tình huống gossip/boss_catch/boss_call/hr_warning/firing và `resolveProbations` (`director.ts:1907,2082,2135,2152,2173,3825`); `src/ai/offline.ts:2653,4683` (không có `src/sim/offline.ts`) dùng để nói "% thấp" trong thoại mẫu |
| `KPI_WARN_DAYS` | `2` | `num` | `kpiWarnDays` | **Không còn là luật cứng** (v3: nhân sự do AI quyết trong `hr_review`). Còn dùng: mốc neo của chính sách offline `offlineDecisions` (`src/sim/hr.ts:379`), `hello.rules` (client hiện huy hiệu "nguy cơ" khi `lowStreak ≥ kpiWarnDays`, `public/js/ui/staff.js:112`, `profile.js:139`, `recaps.js:63`). Smoke ghi đè `1` |
| `KPI_FIRE_DAYS` | `3` | `num` | `kpiFireDays` | Hàng rào `fire` trong `allowedActions`: cần `lowStreak ≥ 2 && (warnings ≥ 1 \|\| lowStreak ≥ kpiFireDays)` + thâm niên ≥ 3 ngày + cách lần đuổi trước ≥ 2 ngày (`hr.ts:209`); neo offline (`hr.ts:380`); Director đưa vào hồ sơ (`director.ts:3308`); `hello.rules` (client lưu nhưng chưa module UI nào dùng). Smoke ghi đè `2` |
| `HR_REVIEW_EVERY_DAYS` | `3` | `Math.max(1, Math.round(num))` (`:318`) | `hrReviewEveryDays` | Họp xét nhân sự `hr_review` định kỳ mỗi N ngày game (Director `:426`, lại `Math.max(1, Math.floor(...))`); cũng là khoảng cách tối thiểu giữa 2 "kỳ" đếm doanh thu thấp |

### 3.7 Sản phẩm / affiliate

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `PRODUCT_MENTION_MIN_MINUTES` | `8` | `num`; Director `max(0, …) × 60_000` | `productMentionMinMinutes` | Tối thiểu phút **thật** giữa 2 lần nhắc sản phẩm trong cảnh thường (`director.ts:636-638` `productMinMs`, dùng ở `offerProduct`); cảnh `showroom_chat` không chịu nhịp này |
| `SHOWROOM_SCENE_MIN_MINUTES` | `30` | số `≥ 0`; `0` = không giới hạn | **—** (đọc thẳng `process.env`, `director.ts:65-69`) | Tối thiểu phút thật giữa 2 cảnh `showroom_chat` (luôn có chip sản phẩm). Có trong `.env.example:93`. Ngoại lệ quy ước — xem §2.3 |

### 3.8 Thời sự (v3)

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `NEWS_ENABLED` | `true` | `bool` | `newsEnabled` | Bật kho tin: server gọi `getNews().start()` (`server.ts:256`); Director lên lịch `news_chat` và cho tin len vào pantry/lunch (`director.ts:420`). `false` → không tải RSS, nút dev 🗞️ chỉ toast |
| `NEWS_FEEDS` | `DEFAULT_NEWS_FEEDS` = 10 feed (3 `the_thao`, 2 `cong_nghe`, 1 `game`, 1 `khoa_hoc`, 3 `giai_tri`; VnExpress / Tuổi Trẻ / Thanh Niên / GameK, `:207-218`) | `parseNewsFeeds` (§2.2) | `newsFeeds: {group,url}[]`, `newsFeedNotes` | Nhóm hợp lệ `NEWS_GROUPS = the_thao, cong_nghe, game, khoa_hoc, giai_tri` (`:202`); **`bong_da` không cấu hình được** — là nhãn phụ tự gắn cho tin thể thao có từ khoá bóng đá (`src/news/feeds.ts`). Rỗng → mặc định (`:246`) |
| `NEWS_REFRESH_MINUTES` | `45` | `Math.max(5, num)` (`:302`); store còn kẹp sàn 1 phút (`store.ts:139`) | `newsRefreshMinutes` | Chu kỳ tải lại RSS; lần đầu sau `firstFetchMs = 20_000` ms (`store.ts:120,136-147`), không chặn khởi động |
| `NEWS_SCENE_MIN_MINUTES` | `25` | `Math.max(0, num)` (`:304`); `0` = không giới hạn | `newsSceneMinMinutes` | Director: tối thiểu phút thật giữa 2 cảnh `news_chat` (`director.ts:421`); tin len vào pantry/lunch cần ≥ **nửa** nhịp kể từ `news_chat` trước và ≥ **một** nhịp kể từ lần len trước (`director.ts:1223-1224`) |
| `NEWS_ALLOW_SHOWBIZ` | `true` | `bool` | `newsAllowShowbiz` | Cho nhóm `giai_tri` (chỉ chủ đề nhẹ theo `SHOWBIZ_ALLOW` ở tiêu đề, `src/news/filter.ts`); `false` → filter trả `showbiz_off`, Director bỏ nhóm (`director.ts:422`) |
| `NEWS_MAX_AGE_DAYS` | `3` | `Math.max(0.5, num)` (`:306`) | `newsMaxAgeDays` | Không bàn tin cũ hơn N ngày theo `publishedAt`: filter (`old`), `prune()` của store (`store.ts:252-258`), `validNews` của Director (`director.ts:423`) |
| `NEWS_BLOCKLIST` | rỗng | `list()` (`:308`) | `newsBlocklist: string[]` | Từ/cụm chặn **thêm**, đi vào `FilterOptions.blocklist` với cùng quy tắc có dấu / không dấu / tiền tố `=` của `matchKeyword` — chi tiết ở [06-tin-tuc-thoi-su.md](./06-tin-tuc-thoi-su.md) |

### 3.9 Câu chuyện tự phát triển (v3)

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `SHOWRUNNER_ENABLED` | `true` | `bool` | `showrunnerEnabled` | AI biên kịch (`storyTick` / `generateBeats`); `false` → nút dev 🎬 chỉ toast (`director.ts:424`) |
| `SHOWRUNNER_EVERY_GAME_MINUTES` | `120` | `Math.max(30, num)` (`:312`); Director lại `Math.max(20, …)` (`:427`, `:4228`) → thực tế ≥ 30 | `showrunnerEveryGameMinutes` | Nhịp lên "biến" (× 0.85–1.2 ngẫu nhiên) |
| `STORY_RANDOMIZE_TRAITS` | `true` | `bool` (`:314`); World kiểm `!== false` | `storyRandomizeTraits` | **Lần khởi tạo đầu** (`freshInit`, `world.ts:2981`): nhân viên (không sếp/HR) có `diligence ← U(0.45, 0.7)`, `laziness ← U(0.35, 0.6)` **thay thẳng** giá trị roster, rồi **mọi** trait ± U(−0.15, 0.15), kẹp 0.05..0.95 (`randomizeOpeningTraits`, `world.ts:216-224`). Không ảnh hưởng file đã lưu. Là tiền đề nguyên tắc "không ai bị đánh dấu nạn nhân" |
| `STORY_TRAIT_DRIFT` | `true` | `bool` (`:316`); World kiểm `=== false` | `storyTraitDrift` | Cho `World.driftTrait()` đổi tính cách: mỗi lần ≤ ±0.2, kẹp `traitBase (+tempTraits) ± 0.25` và 0.05..0.95 (`world.ts:748-760`); `false` → không đổi. Director đọc cùng cờ để bỏ `driftPlans` (`director.ts:425`) |

### 3.10 Lưu trữ

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `PERSIST` | `true` | `bool` | `persist` | `World.save()`/`load()` bỏ qua khi `false` (`world.ts:1008,1023`); server chỉ đặt timer lưu 60 s và `load()` khi `true` (`server.ts:252,498,507`). Smoke đặt `false` |
| `STATE_FILE` | `data/state.json` | `?.trim() \|\| mặc định` (`:293`) | `stateFile` | Đường dẫn snapshot (tương đối theo cwd). Chỉ in ra log khi lưu lúc tắt và lúc khởi động (`server.ts:508,553`) |
| `HISTORY_ENABLED` | `true` | `bool` | `historyEnabled` | Archive JSONL; server `configure({ enabled })` **trước** khi dựng World (`server.ts:245-247`); `/api/history` trả `enabled` |
| `HISTORY_DIR` | `data/history` | `str() \|\| mặc định` (`:322`) | `historyDir` | Thư mục archive; đổi → `countCache`/`index` làm mới (`archive.ts:93-105`) |
| `HISTORY_KEEP_DAYS` | `180` | `Math.max(1, num)` (`:323`) | `historyKeepDays` | Xoá file có `age > keepDays` khi xoay vòng (`archive.ts:277`) |
| `HISTORY_GZIP_AFTER_DAYS` | `7` | `Math.max(1, num)` (`:324`) | `historyGzipAfterDays` | Gzip file `.jsonl` có `age ≥ gzipAfterDays` (không đụng file hôm nay, `archive.ts:274,281`); ngày đã nén được `/api/history` cho cache 1 ngày (`server.ts:320`) |

### 3.11 Server, công ty, bảng dev

| Biến | Mặc định | Kiểu / kẹp | `CONFIG.` | Ý nghĩa, ảnh hưởng, nơi đọc |
|---|---|---|---|---|
| `PORT` | `3000` | `num` (không floor/kẹp) | `port` | Cổng HTTP + WebSocket (`server.ts:533`); `EADDRINUSE` → thông báo đổi `PORT` rồi `exit(1)` (`server.ts:525-531`). Production dùng **3200** qua `deploy/.env.production`, **phải bằng** `APP_PORT` của `deploy.sh` (nginx proxy tới `127.0.0.1:__PORT__`) |
| `COMPANY_NAME` | `Cty TNHH VibeCorp` | `?.trim() \|\| mặc định` (`:294`) | `companyName` | `hello.companyName` (`world.ts:910`), `CompanyState.name` (kể cả khi **khôi phục**: `reviveCompany(raw.company, this.config.companyName)` lấy tên từ config, không từ file — `world.ts:3087`), **nướng vào system prompt lúc `createBrain`** (`brain.ts:113-115`) → đổi phải khởi động lại; `PromptContext.companyName` (`director.ts:4002`); log khởi động (`server.ts:547`) |
| `SITE_URL` (2026-11-03) | rỗng | `siteUrlOf` (bảng §2.2) | `siteUrl` | Gốc URL công khai cho thẻ chia sẻ trong `index.html` (`og:url`, `og:image`, `twitter:image`, `canonical`, JSON-LD). **Tuỳ chọn**: rỗng → server suy ra theo từng request từ `Host` (lọc ký tự, lạ → localhost) + https nếu `X-Forwarded-Proto`/`CF-Visitor`/TLS báo https — đúng cả sau Cloudflare + nginx ([02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md) §7.1). Đặt cứng khi muốn chắc chắn tuyệt đối (vd site có nhiều tên miền). Không phải bí mật |
| `DEV_PANEL` | `true` | `bool` | `devPanel` | `false` → `devAllowed()` luôn `false` cho mọi socket, `/api/dev/login\|logout` và `/api/stats` trả 404 (`server.ts:69,101,419`). World đặt `hello.dev = !!devPanel` (`world.ts:918`) rồi **server ghi đè theo từng socket** (`server.ts:461`) |
| `DEV_TOKEN` | rỗng | `str()` (`:328`); so khớp ≤ 200 ký tự, băm SHA-256 + `timingSafeEqual` (`server.ts:58-62,74`) | `devToken` | Rỗng = `DEV_PANEL` quyết định cho **mọi người xem**. Có giá trị = chỉ socket nối `/ws?dev=<token>` **hoặc** mang cookie `vpa_dev` đúng (chỉ xét cookie khi query rỗng, `server.ts:73`) mới có `hello.dev = true`, `status.ai` đầy đủ, `/api/stats`. **Không bao giờ in ra log** (`server.ts:563-567`). Trên production bắt buộc đặt (hoặc `DEV_PANEL=false`) — `deploy.sh:39` nhắc |

### 3.12 Biến của script kiểm thử (không phải của app)

| Biến | Mặc định | Script | Ý nghĩa |
|---|---|---|---|
| `SMOKE_DAYS` | `6` (≥ 1) | `scripts/smoke.ts:45` | số ngày game tối thiểu |
| `SMOKE_MAX_DAYS` | `10` (≥ `SMOKE_DAYS`) | `smoke.ts:46` | chạy thêm tới ngày này nếu vòng HR nhắc → đuổi → phỏng vấn → tuyển chưa xong |
| `SMOKE_SEED` | `Date.now() % 1_000_000_007` | `smoke.ts:42` | hạt giống RNG (`mulberry32` thay `Math.random` **trước** khi nạp module); in ra để chạy lại y hệt |
| `SMOKE_SPEED` | `1` | `smoke.ts:47` | tốc độ tua 1\|2\|5\|10, giá trị khác → 1 |
| `SMOKE_DEV` | bật | `smoke.ts:47` | `0` → bỏ phần bấm thử các nút dev |
| `SMOKE_VERBOSE` | tắt | `smoke.ts:48` | `1` → in toàn bộ log văn phòng |
| `SMOKE_SCENE_GAP` | `CONFIG.offlineMinSeconds` | `smoke.ts:98` | giây ảo tối thiểu giữa 2 cảnh thường (ghi đè `offlineMinSeconds`); ~25 để giả lập nhịp thưa |
| `SMOKE_HISTORY_DIR` | `mkdtemp('vpa-smoke-history-')` | `smoke.ts:89` | thư mục archive tạm; **đặt thì không bị xoá** cuối chạy (`smoke.ts:887`) |
| `SMOKE_KEEP_HISTORY` | tắt | `smoke.ts:873,887` | `1` → giữ thư mục archive tạm |
| `SMOKE_STORY_SEEDS` | `6` (≥ 1) | `scripts/smoke-story.ts:42` | số hạt giống chạy tuần tự |
| `SMOKE_STORY_DAYS` | `12` (≥ 3) | `smoke-story.ts:43` | số ngày game mỗi hạt |
| `SMOKE_STORY_SPEED` | `1` | `smoke-story.ts:44` | 1\|2\|5\|10 |
| `SMOKE_STORY_SEED` | theo giờ | `smoke-story.ts:41` | hạt đầu; các hạt sau +1, +2…; kịch bản doanh thu 0 dùng `SEED0 + 1000` |
| `SMOKE_STORY_VERBOSE` | tắt | `smoke-story.ts:45` | `1` → in log hạt đầu |
| `EYEBALL_DAYS` | `6` (≥ 2) | `scripts/eyeball-hr.ts:25` | số ngày game mô phỏng offline trước khi gọi AI **thật** |
| `EYEBALL_SCENES` | `1` (1..3) | `eyeball-hr.ts:26` | số cảnh `hr_review` gọi AI thật (tốn quota thật) |
| `TEST_VERBOSE` | tắt | `scripts/test-llm.ts:42`, `test-router.ts:41` | `1` → in `console.warn` thật ra terminal |

`scripts/test-news.ts` không đọc biến nào; dùng `NOW` cố định `2026-11-01T17:00:00+07:00` (`test-news.ts:20`). Mọi script vẫn nạp `.env` thật qua `CONFIG` (§2.1).

### 3.13 Biến của deploy (không phải của app)

| Biến | Nguồn | Nơi dùng | Ghi chú |
|---|---|---|---|
| `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_PASS`, `DOMAIN` | `deploy/vps.env` (`deploy.sh:6,13-16`) | ssh/rsync/scp, nginx `__DOMAIN__`, certbot, kiểm tra `https://$DOMAIN/api/health` | `VPS_PASS` đi vào `SSHPASS` cho `sshpass -e` (`deploy.sh:15`); **không bao giờ ghi vào tài liệu** |
| `APP_PORT` | môi trường shell hoặc `vps.env`; mặc định `3200` (`deploy.sh:18`) | thay `__PORT__` trong `nginx.site.conf` (`deploy.sh:51`), `curl http://127.0.0.1:$APP_PORT/api/health` (`:62`) | `PORT` trong `deploy/.env.production` **phải bằng** giá trị này, không thì nginx 502 |

Hằng cố định trong `deploy.sh`: `APP_DIR=/opt/vibecorp`, `APP_USER=deploy` (`:17,19`), pm2 process `vibecorp` chạy `npm start` (`:45`). Chi tiết vận hành ở [10-van-hanh-deploy.md](./10-van-hanh-deploy.md).

---

## 4. `.env.example` · `.env` · `deploy/.env.production` · `deploy/vps.env`

### 4.1 Vai trò (không bàn nội dung)

| File | Vai trò | Ai tạo / sửa | Code đọc? |
|---|---|---|---|
| `.env.example` | **Mẫu**: tên biến + chú thích + giá trị gợi ý (159 dòng, chia 12 khối: AI `:1-59`, tiết kiệm token `:61-75`, thời gian `:77-81`, KPI/HR `:83-87`, affiliate `:89-93`, khác `:95-102`, v3 thời sự `:104-119`, v3 câu chuyện `:121-131`, v3 lưu trữ `:133-139`, v3 bảng dev `:141-145`, Cloudflare (toàn bộ comment) `:147-156`, ghi chú biến bổ sung `:158-159`) | dev khi thêm/đổi biến; **không bao giờ** điền key thật | **không** — chỉ để copy thành `.env` |
| `.env` | Cấu hình **máy dev** của chủ dự án | copy từ `.env.example` rồi điền key | dotenv lúc import `config.ts` |
| `deploy/.env.production` | Cấu hình **VPS** — được `scp` thành `/opt/vibecorp/.env` mỗi lần deploy (`deploy.sh:38-40`), `chmod 600` | chủ dự án; theo `deploy.sh:39` cần đổi `PORT=3200`, `PERSIST=true`, `DEV_PANEL=false` hoặc `DEV_PANEL=true` + `DEV_TOKEN` | gián tiếp (thành `.env` trên VPS) |
| `deploy/vps.env` | Thông tin SSH + domain cho `deploy.sh` | chủ dự án | `deploy.sh:14` `source` (không phải app) |

Luồng: sửa `deploy/.env.production` ở máy dev → `bash deploy/deploy.sh` → file đè lên `/opt/vibecorp/.env` → `pm2 restart vibecorp --update-env`. **Sửa tay `.env` trên VPS sẽ mất ở lần deploy sau.** Cả ba file đều gitignored (`.gitignore:2,9-10`) và bị rsync exclude (`deploy.sh:33`).

### 4.2 Chỗ `.env.example` lệch mặc định code (đọc bảng §3 cho mặc định thật)

| Biến | `.env.example` gợi ý | Mặc định code | Ghi chú |
|---|---|---|---|
| `AI_PROVIDERS` | `gemini,groq` (`:5`) | rỗng (= kiểu cũ) | README §3.4 minh hoạ `gemini,groq,cloudflare`; khối Cloudflare trong file mẫu đang **comment** (`:147-156`) |
| `AI_ROUTING` | `balanced` (`:7`) | `priority` | để trống `.env` → `priority` |
| `AI_GEMINI_MODEL` / `AI_GROQ_MODEL` | `gemini-3.5-flash-lite` (`:22`) / `openai/gpt-oss-120b` (`:34`) | **không có mặc định** — biến bắt buộc, trống → provider bị bỏ qua (§3.2) | ai copy mẫu sẽ chạy đúng hai model này; `openai/gpt-oss-120b` khớp `REASONING_MODEL_RE` → được coi là model suy luận (token ra ×3, không gửi `temperature`) |
| `AI_GEMINI_RPD`/`RPM`/`TIER` | `500` / `10` / `strong` | không giới hạn / `normal` | số đo thật 2026-11-01 (bối cảnh chủ dự án) |
| `AI_GROQ_RPD`/`TPD`/`RPM`/`REASONING_EFFORT`/`MAX_OUTPUT_TOKENS`/`MAX_REQUEST_TOKENS`/`WEIGHT` | `1000` / `200000` / `2` / `low` / `1500` / `8000` / `0.35` | không giới hạn / rỗng / `1` | |
| `OPENAI_RPM` / `OPENAI_RPD` / `OPENAI_TPD` | **không có** trong file mẫu | không giới hạn | `config.ts:150` vẫn đọc |
| `AI_<TÊN>_PACE`, `_WEIGHT`, `_REASONING`, `_MAX_OUTPUT_TOKENS`, `_MAX_REQUEST_TOKENS`, `_EXTRA_JSON` | chỉ nhắc ở ghi chú cuối (`:158-159`), không có dòng riêng | xem §3.2 | |
| `DEBUG_PROMPTS` | comment (`:59`) | tắt | |
| Các biến còn lại (`DAILY_BUDGET_USD=1`, `MIN_SECONDS_BETWEEN_LLM=20`, `MAX_CONCURRENT_LLM=2`, `LLM_ONLY_WHEN_WATCHED=true`, `OFFLINE_MIN_SECONDS=8`, `TIME_MODE=compressed`, `GAME_MINUTES_PER_SECOND=0.5`, `KPI_*`, `PRODUCT_MENTION_MIN_MINUTES=8`, `SHOWROOM_SCENE_MIN_MINUTES=30`, `COMPANY_NAME`, `SITE_URL=` (trống, 2026-11-03), `DEV_PANEL=true`, `PERSIST=true`, `STATE_FILE`, `PORT=3000`, `NEWS_*`, `SHOWRUNNER_*`, `STORY_*`, `HR_REVIEW_EVERY_DAYS=3`, `HISTORY_*`, `DEV_TOKEN=`) | = mặc định code | | |

---

## 5. `data/products.json` — danh mục affiliate & phòng trưng bày

### 5.1 Cấu trúc file

```jsonc
{
  "_note": "…",                 // ghi chú cho chủ dự án (code bỏ qua)
  "_huong_dan": { "id": "…", "name": "…", … , "them_san_pham": "…" },   // tài liệu nội tuyến từng trường (code bỏ qua)
  "products": [ { /* Product */ }, … ]   // products.ts chỉ đọc mảng này
}
```

`load()` (`products.ts:129-156`) chấp nhận **mảng thuần** hoặc object có `products` là mảng; dạng khác → cảnh báo `cần dạng { "products": [...] }` và danh mục rỗng. File thiếu/hỏng JSON → `console.warn` + danh mục rỗng, **không bao giờ throw** (phòng trưng bày trống, web vẫn chạy). Đọc **đồng bộ đúng một lần** rồi cache (`cache`, `byId`) → **sửa file xong phải khởi động lại server**; World còn cache thêm `hello.products` một lần mỗi tiến trình (`world.ts:2809-2819` `showroomCache`) và `deskItemCache` theo id.

### 5.2 Từng trường (luật kiểm tra ở `normalize`, `products.ts:54-118`)

| Trường | Bắt buộc | Luật | Hậu quả khi sai |
|---|---|---|---|
| `id` | **có** | khớp `ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` (kebab-case, chữ thường, không dấu); không trùng | mục bị **bỏ qua** + `[products] bỏ qua …`. **Đừng đổi id món đang có**: `clicksBy` trong `state.json`, `deskItemProductId` của 10 nhân vật trong `src/content/roster.ts`, sổ "ai đã có món gì" của Director (`shopping.owned`, `productUses`) đều bám id. Đổi / xoá id thì World tự đổi món đồ trên bàn (`fixDeskItems`, [03](03-mo-phong-the-gioi.md) §15.4) và Director tự bỏ id lạ khi khôi phục. (`scripts/smoke.ts:524-527` vẫn ghi click cho id mẫu cũ `son-kem-li`, `ban-phim-co` — `recordClick` không kiểm id nên test vẫn đúng ý: chỉ kiểm bộ đếm) |
| `name` | **có** | cắt 120 ký tự | thiếu → bỏ qua |
| `url` | **có** | `http:`/`https:` hợp lệ (`validUrl`) | thiếu/sai → bỏ qua. Là link affiliate Shopee thật — **chỉ server biết**; client luôn nhận `/go/<id>?src=…` (`toPublic`, `products.ts:211-219`); `/go/:id` chỉ chuyển tới đúng `url` trong danh mục (không open redirect) |
| `tags` | **có** (mảng) | chuỗi → lowercase, bỏ trùng/rỗng | không phải mảng → bỏ qua mục. Là **từ khoá ngữ cảnh** để món xuất hiện đúng lúc: `contextScore` (`products.ts:298`, bỏ tag chung `van-phong`, `lam-dep`, `cong-nghe`) khớp với tag Director suy từ cảnh (mệt → `ca-phe, tra…`, ăn trưa → `nau-an…`, ngủ trưa → `ngu-trua, chan-goi`, nắng chiều → `nang, mo-hoi, rem`…) và với `tags` của các "vụ mua sắm" (`src/content/shopping.ts`, [04](04-dao-dien-cau-chuyen-nhan-su.md) §11); `pickProduct(tags)` (điểm = số tag trùng, `:186-199`) chọn món đồ trên bàn theo `DESK_ITEM_TAGS` (`src/content/roster.ts`); suy `category` khi thiếu |
| `pitch` | nên có | cắt 200 | thiếu → warn "AI sẽ khó lồng vào thoại"; mô tả ngắn, viết thường "món này là gì" — không giá, không link. Prompt AI chỉ đưa pitch (cắt 130) khi món **không có** `facts`. Câu mẫu offline không dán nguyên pitch mà lấy `spoken` (nếu có) hoặc **mệnh đề đầu tiên dùng được** của pitch, bỏ từ trùng tên gọi `short`, ≤ 40 ký tự (`spokenPitch`, [05](05-lop-ai.md) §9.3) → nên viết pitch dạng "<tên loại> <đặc điểm chính>, <đặc điểm phụ>…" để mệnh đề đầu đọc lên tự nhiên |
| `spoken` | không (vòng 3) | gọn khoảng trắng, cắt 60, bỏ dấu câu cuối | mệnh đề **nói được** cho câu thoại mẫu khi không có AI ("mặt vải, đế cao su chống trượt") — chỉ cần khi mệnh đề đầu của pitch **lặp lại tên gọi** (vd "lót chuột hình mèo" → "vải in hình mèo") hoặc quá cụt / quá kỹ thuật. Phải đúng với `facts`, không giá. Hiện 9/26 món có (2 lắc tay, váy lệch vai, máy hút bụi nệm, màn hình 2K, lót chuột mèo, máy làm sữa hạt, nồi điện hai tầng, gối kiêm chăn); AI không đọc trường này (đã có `facts`) |
| `short` | nên có (v4) | gọn khoảng trắng, cắt 40 | **tên gọi đời thường** nhân vật dùng khi nói ("chuột gaming không dây"); thiếu → `shortNameOf` tự bỏ phần thông số / mã model sau từ đầu tiên (`:263-273`). Sanitize cũng chấm điểm câu nhắc theo tên này |
| `facts` | nên có (v4) | cắt 300 | điều **có thật** nhân vật được nói (lấy từ trang bán); prompt cắt theo bậc ngân sách prompt (`prodFacts` 180 → 100 ký tự, [05](05-lop-ai.md) §6.8) và dặn "chỉ nói trong phạm vi này" — điều quan trọng nhất nên đứng đầu |
| `avoid` | nên có (v4) | cắt 240 | điều **cấm nói** (tuyên bố chưa kiểm chứng, thông số lệch, chủ đề nhạy cảm); prompt cắt 150, đứng sau chữ `CẤM:` |
| `hooks` | nên có (v4) | mảng ≤ 5 chuỗi, mỗi chuỗi cắt 100, bỏ dấu câu cuối, bỏ trùng | thiếu → warn "thiếu hooks". 2–5 **cớ đời thường** dạng mệnh đề không chủ ngữ ("ngủ trưa gục bàn dậy là ê cổ") — Director bốc 1 cớ cho câu nhắc; câu mẫu offline lồng cớ vào khuôn đúng ngữ pháp với mọi mệnh đề ("Vụ <cớ> á, …", "Nói tới chuyện <cớ> mới nhớ, …" — [05](05-lop-ai.md) §9.3) |
| `emoji` | không | ≤ 16 ký tự | khác → `🛒` |
| `priceHint` | không | cắt 30 | hiển thị chip / tooltip / tab 🛍️ (giá tham khảo, đổi theo voucher). **AI không bao giờ nhận con số**: `priceFeelOf` (`:288-292`) đổi thành cảm nhận — ≤ 250k `re` (rẻ) · ≤ 800k `vua` (vừa túi tiền) · còn lại `cao` (hơi đắt, cấm gọi là rẻ); đọc được "~390k", "~1,05tr", "35.000–40.000đ" (`parsePriceHint`, `:275-285`); trống / không đọc được → AI được dặn "không nhắc giá" |
| `category` | nên có | `lam-dep` \| `cong-nghe` (`PRODUCT_CATEGORIES`, `:19`) | thiếu/sai → suy từ tag: có tag trong `BEAUTY_TAGS = {lam-dep, my-pham, thoi-trang, massage, skincare, son, toc, spa}` (`:27`) → `lam-dep`, không thì `cong-nghe` + warn |
| `shelf` | không (suy ra) | luôn = `SHELF_OF_CATEGORY[category]` (`beauty`/`tech`, `:22`) | ghi lệch → warn và sửa theo `category` |
| `slot` | không | số nguyên `0..999` (`MAX_SLOT`), chấp nhận chuỗi số (`parseSlot`, `:47-50`) | sai → `-1` + warn → tự xếp; trùng trong cùng kệ → mục sau tự xếp lại (`assignSlots`, `:107-127`: số nhỏ nhất còn trống, theo thứ tự trong file) |
| `note` | nên có | gọn khoảng trắng, cắt 200 | thiếu → warn; 1 câu giới thiệu **thông tin thật** (không phải lời chứng thực "mình dùng rồi") hiển thị nguyên văn ở tab 🛍️. v4: cảnh `showroom_chat` không dùng `note` làm chất liệu nữa (dùng `pitch` + `facts` + kiểu chuyện) |
| `image` | không | URL `http(s)` | sai → bỏ ảnh + warn; không có → vẽ emoji. Lúc viết **không món nào có `image`** |

Kiểu đích: `Product` (`src/types.ts:147-166`, v4 thêm `short?`, `facts?`, `avoid?`, `hooks?`; vòng 3 thêm `spoken?` — chỉ server / AI / thoại offline đọc, **không gửi client**; Director chép `spoken` sang `SceneRequest.product.spoken`), bản gửi client `ProductPublic` / `ShowroomProduct` (`types.ts:174-185`). Khoá `_huong_dan` trong file giải thích từng trường bằng tiếng Việt cho chủ dự án.

### 5.3 Kệ, slot và lớp phòng thủ `showroom.ts`

- Hai kệ: `beauty` (**làm đẹp & thời trang**, bên trái) và `tech` (**công nghệ & nhà cửa**, bên phải). v4: mỗi kệ **2 tầng × 7 ô** — `SHELF_PER_TIER = 7`, `SHELF_SLOTS = 14` (`products.ts:24-26`): slot `0..6` tầng trên, `7..13` tầng dưới được **vẽ trên kệ** ở canvas (client dùng cùng quy ước, [07](07-frontend-ve-canvas.md)); slot `≥ 14` chỉ hiện ở tab 🛍️. `pickShelfProduct(shelf, exclude)` (`:210-222`) ưu tiên nhẹ (trọng số 1.5) món đang được vẽ.
- `hello.products` do `src/sim/showroom.ts` dựng (`buildShowroomProducts`, `:87-118`): (1) ưu tiên `products.getShowroomProducts()` (`products.ts:225-243`: kệ beauty trước, rồi slot, rồi tên theo `localeCompare('vi')`); (2) rỗng/lỗi → `getProducts()` qua `toShowroom()` (`:40-65`) với bộ ánh xạ **rộng hơn**: id khớp `^[A-Za-z0-9_-]{1,80}$`, category suy từ `category`/`shelf`/tag (`BEAUTY_TAGS` 4 tag, `TECH_TAGS = {cong-nghe, gadget}`; không xếp được kệ → **không lên kệ**), `note` thiếu → dùng `pitch` (cả hai cắt 200), `tags` qua `tagsOf()` (`showroom.ts:19-28`): tối đa **12** tag, mỗi tag cắt **40** ký tự, lowercase, bỏ trùng/rỗng; `image` cắt **500** ký tự và phải khớp `^(https?://|/)` (`:62-63`, nhận cả đường dẫn `/…`), `url` **ép lại** `/go/<id>?src=showroom`; trần `MAX_ITEMS = 40`, loại trùng id. Client cắt ≤ 60 và đổi `src=showroom` → `sidebar` cho tab 🛍️.
- Nguồn click (`src`) hợp lệ `^[A-Za-z0-9_-]{1,32}$`, giá trị dùng: `showroom`, `sidebar`, `scene`, `desk`; lạ → `khac` (`world.ts:990`). Thống kê vào `state.json` (§6.3) và `/api/stats` (cần mã dev).

### 5.4 Hiện trạng (2026-11-03)

**26 món chính thức** của chủ dự án (thay toàn bộ 18 món mẫu cũ ngày 2026-11-03), link affiliate Shopee rút gọn `s.shopee.vn/…?share_channel_code=8`; nguồn thông tin từng món: [`danh-sach-26-san-pham.md`](danh-sach-26-san-pham.md) (diễn giải từ trang bán, không phải kết quả kiểm nghiệm). Mọi mục có `id, name, short, emoji, category, shelf, slot, tags, pitch, facts, avoid, hooks (3), note, priceHint, url`; không mục nào có `image`.

| Kệ | Slot → id (giá tham khảo · cảm nhận giá AI nhận) |
|---|---|
| `lam-dep` / `beauty` (12, tầng dưới còn 2 ô trống) | 0 `bang-phan-mat-cheeryep` (~390k · vừa), 1 `serum-khu-mui-blanica` (~158k · rẻ), 2 `feelex-care-men` (~109k · rẻ), 3 `nen-thom-heny-garden` (~303k · vừa), 4 `hop-trang-suc-eleanor` (~128k · rẻ), 5 `hop-trang-suc-du-lich-eleanor` (~58k · rẻ), 6 `lac-tay-bac-hanada-charm` (~406k · vừa), 7 `lac-tay-bac-hanada-co-bon-la` (~448k · vừa), 8 `phap-phuc-truc-tam` (~297k · vừa), 9 `dam-ren-adora-zenmia` (~369k · vừa), 10 `vay-du-tiec-lech-vai` (— · không giá), 11 `bo-ngu-zenme` (~239k · rẻ) |
| `cong-nghe` / `tech` (14, đủ 2 tầng) | 0 `may-hut-bui-giuong-nem` (~1,05tr · đắt), 1 `may-chieu-mini` (~1,7tr · đắt), 2 `man-hinh-aoc` (~5,69tr · đắt), 3 `ssd-di-dong-ssk` (~4,59tr · đắt), 4 `chuot-attack-shark-x11` (~488k · vừa), 5 `lot-chuot-hinh-meo` (~35k · rẻ), 6 `gia-treo-pc-unlimi` (— · không giá), 7 `may-lam-sua-hat-lazychef` (~1,77tr · đắt), 8 `am-dun-nuoc-bluestone` (~565k · vừa), 9 `noi-dien-bluestone` (~562k · vừa), 10 `chan-goi-van-phong-cecila` (~200k · rẻ), 11 `tui-giat-luoi` (— · không giá), 12 `rem-voan-dui` (— · không giá), 13 `thanh-treo-rem` (~28k · rẻ) |

4 món chưa có `priceHint` (`vay-du-tiec-lech-vai`, `gia-treo-pc-unlimi`, `tui-giat-luoi`, `rem-voan-dui`) → AI được dặn không nhắc giá. Hai id cũ được giữ: `bang-phan-mat-cheeryep`, `may-hut-bui-giuong-nem`. Món đồ trên bàn 10 nhân vật gốc (`roster.ts`): sếp `am-dun-nuoc-bluestone`, HR `nen-thom-heny-garden`, techlead `ssd-di-dong-ssk`, senior `man-hinh-aoc`, junior `chan-goi-van-phong-cecila`, QA `lot-chuot-hinh-meo`, designer `hop-trang-suc-eleanor`, saleslead `may-chieu-mini`, sale mới `chuot-attack-shark-x11`, marketing `bang-phan-mat-cheeryep`. `state.json` cũ có món đồ trên bàn không còn trong danh mục → `fixDeskItems` đổi sang món preset / món hợp vai khi khởi động. **Lệch tài liệu**: `docs/v2-contract.md` ghi "5 beauty + 5 tech placeholder" (thiết kế gốc, lỗi thời).

### 5.5 Thêm / thay một sản phẩm

1. Copy một mục trong `products`, đổi `id` mới (kebab-case), `name`, `short` (tên gọi đời thường), `emoji`, `category`, `slot` (trống trong kệ; 0–13 nếu muốn vẽ trên kệ), `tags` (từ khoá ngữ cảnh — dùng lại tag đang có để món hợp các "vụ mua sắm" và cảnh ăn trưa / ngủ trưa / nắng chiều…), `pitch` (món này là gì, không giá / link), `facts` (điều có thật từ trang bán), `avoid` (điều cấm nói), `hooks` (2–5 cớ đời thường), `note` (1 câu thông tin thật cho tab 🛍️), `priceHint` (giá tham khảo, vd `~390k`), `url` (link affiliate), tuỳ chọn `image`.
2. Lưu, khởi động lại server; đọc terminal xem có `[products] …` cảnh báo không (mục sai bị bỏ, không sập).
3. Kiểm: log khởi động in `🛍️ Phòng trưng bày: N sản phẩm (kệ làm đẹp a · kệ công nghệ b)` (`server.ts:552`); `npm run smoke` kiểm `hello.products` (url `^/go/[A-Za-z0-9_-]+\?src=showroom$`, kệ, slot, note, tags).
4. Nếu **thay** món đang có: giữ `id` cũ (click thống kê, `deskItemProductId`, sổ "ai đã có món gì" của Director) — chỉ đổi nội dung.
5. Câu chuyện quanh món (vụ mua sắm, kiểu chuyện, hàng về / khui hộp) tự áp dụng cho món mới, không cần sửa code; muốn thêm "vụ" hợp món mới thì sửa `SHOPPING_THEMES` ([04](04-dao-dien-cau-chuyen-nhan-su.md) §11.9).

---

## 6. `data/state.json` — snapshot trạng thái sống

### 6.1 Khi nào ghi / đọc, ghi nguyên tử, cách ly

- **Ghi**: `World.save()` mỗi `SAVE_EVERY_MS = 60_000` ms (`server.ts:25,498`) và khi `SIGINT`/`SIGTERM` (`server.ts:501-515`: `world.stop()` → `news.stop()` → `world.save()` → `archive.stop()` → đóng WS 1001 → `server.close`, dự phòng `exit(0)` sau 1,5 s). Chỉ khi `PERSIST=true`.
- **Nguyên tử** (`persist.ts:16-34`): `mkdir -p` thư mục; ghi `<file>.tmp-<pid>`; `fsync` (lỗi bỏ qua); `rename` đè. Lỗi → xoá tmp, throw (World bắt và `reportError('save')`, không sập). Không bao giờ để lại file nửa vời.
- **Đọc** (`World.load()`, `world.ts:1022-1070`, gọi ở `server.ts:252` **sau** `attachDirector`, **trước** `world.start()`): thứ tự
  1. `readJsonFile` lỗi đọc/parse → `loadFailed(…, quarantine = true)`;
  2. không có file → `Chưa có file trạng thái … — bắt đầu văn phòng mới` (không cách ly);
  3. không phải object hoặc `version !== STATE_VERSION (1)` → cách ly;
  4. **`brain.restore(data.brain)` trước** — giữ chi phí/quota đã tiêu trong ngày kể cả khi phần world hỏng (lỗi chỉ warn);
  5. `restoreWorld(data.world)` trả `false`/throw → cách ly + `freshInit()`;
  6. `director.restore(data.director)` (lỗi chỉ warn, Director dùng trạng thái mới);
  7. `dayStartNotified = true` → **`director.onDayStart` KHÔNG được gọi sau khôi phục**; Director phải tự dựng lịch ngày từ `restore()`.
- **Cách ly** (`quarantineFile`, `persist.ts:45-56`): đổi tên thành `state.json.bad-<ISO với : và . thay bằng ->` (ví dụ `state.json.bad-2026-11-02T04-12-33-123Z`), warn `⚠️ Không khôi phục được trạng thái (…) — bắt đầu văn phòng mới. File cũ được giữ lại tại: …`. File `.bad-*` **không tự xoá**.
- **Bẫy khởi động** (đã xác nhận bằng code): constructor `World` gọi `freshInit()` ngay (`world.ts:473`) → `planDay(this.curDay)` (`:3006`) → `this.log({ kind: 'system', icon: '🌅', text: '… ngày 1 — văn phòng mở cửa' })` **không điều kiện** (`:2537`; realtime cuối tuần thì là dòng 🏖️ `:2534`), cộng thêm log của `rollPersonalEvent()`/`noteDayFactors()` (`:2538-2539`) → `World.log()` gọi `archiveRecord('log', entry)` (`:891`). Vì server đã `getArchive().configure(...).start()` **trước** `new World` (`server.ts:245-250`, cố ý để dòng "mở cửa" đầu tiên được lưu), mỗi lần khởi động lại có `state.json` hợp lệ vẫn đẩy **ít nhất 1 dòng `day: 1` giả** vào `data/history/<hôm nay>.jsonl`, rồi `load()` mới thay thế giờ/ngày thật. Cách sửa gợi ý ở câu hỏi mở #2.
- **Hằng cứng cùng khối** `server.ts:23-27`: ngoài `SAVE_EVERY_MS` còn `MAX_MSG_BYTES = 2048` (tin WS client dài hơn bị bỏ), `MAX_BUFFERED = 1 MiB` (socket nghẽn bị bỏ qua khi broadcast), `HEARTBEAT_MS = 30_000`, `DEV_RATE = { windowMs: 5000, max: 10 }` (nhịp bấm nút dev). Chúng thuộc giao thức WS, không phải cấu hình đĩa — mô tả ở [02-kien-truc-va-giao-thuc.md](./02-kien-truc-va-giao-thuc.md) (bảng giới hạn WS và luật xử lý thông điệp client); không có biến môi trường nào đổi được.
- **Làm lại văn phòng từ đầu**: tắt server, xoá `data/state.json` (README §10). Trên VPS file này được bảo toàn qua deploy nhờ rsync exclude.

### 6.2 Cấp 1 (`StateFile`, `persist.ts:7-13`; dựng ở `world.ts:1010-1016`)

| Khoá | Kiểu | Nguồn | Ghi chú |
|---|---|---|---|
| `version` | `1` (`STATE_VERSION`) | hằng | **Đổi shape mà không tăng** → file cũ vẫn được nhận, trường mới lấy mặc định (cách v2/v3 đã làm, cố ý để không mất dữ liệu). **Tăng** → mọi file cũ bị cách ly, văn phòng làm lại từ đầu |
| `savedAt` | ISO string | `new Date().toISOString()` | chỉ để người đọc |
| `world` | object | `serializeWorld()` (§6.3) | bắt buộc hợp lệ, không thì cách ly cả file |
| `director` | object \| `null` | `jsonSafe(director.serialize())` (§6.4) | `jsonSafe` (`world.ts:2926-2934`) ép qua `JSON.parse(JSON.stringify())`, lỗi → `null` (một module hỏng không làm hỏng cả file) |
| `brain` | object \| `null` | `jsonSafe(brain.serialize())` (§6.5) | **không bao giờ chứa API key** (test-router mục 12 kiểm) |

### 6.3 `world` (`serializeWorld`, `world.ts:3013-3038`; khôi phục `restoreWorld`, `:3078-3192`)

| Khoá | Nội dung | Luật khôi phục / trần |
|---|---|---|
| `mode` | `'compressed'` \| `'realtime'` | khác chế độ hiện tại → **sang ngày mới** `savedDay + 1`, xoá người không `active`, `planDay`, realtime thì `placeForCurrentTime` (`:3172-3186`) |
| `time`, `day` | phút game tuyệt đối (float), ngày hiện tại | bắt buộc hữu hạn, `day ≥ 1` (`:3088-3090`); nén: `time` phải nằm trong ngày, không thì về 07:30 (`:3134`); realtime: kẹp trong ngày, rồi nhảy tới giờ VN hiện tại nếu cùng ngày (`:3164-3170`) |
| `realStartEpochDay` | ngày epoch (VN) của ngày 1 ở realtime | thiếu → suy từ hôm nay (`:3136`) |
| `closedToday` | cuối tuần (realtime) | tính lại (`:3139`) |
| `logSeq`, `log[]` | bộ đếm id và ≤ `LOG_KEEP = 200` `LogEntry` gần nhất (feed khi vào trang) | lọc `isLogEntry`; `logSeq = max(saved, max id trong log)` (`:3108-3109`) |
| `clicks`, `clicksBy`, `clicksBySource`, `clicksByProductSource` | tổng click `/go/`, theo sản phẩm, theo nguồn, sản phẩm × nguồn | trần **500 sản phẩm × 16 nguồn** cả lúc ghi (`recordClick`, `:991-1000`) và lúc đọc (`reviveCounts`, `:3110-3119`) |
| `company` | `CompanyState { name, project{ name, client, desc, progress, startedDay, deadlineDay }, projectsDone, revenueMonth, revenueTarget, incident }` | `reviveCompany` (`:351-366`): `project.name` bắt buộc; **`incident` luôn `null`** (Director không còn hẹn giờ gỡ); **`name` lấy từ `CONFIG.companyName`**, không từ file |
| `recentProjects[]` | tên dự án gần đây (tránh lặp) | ≤ 6 (`strArr(…, 6, 100)`) |
| `agents[]` | **toàn bộ `AgentState`** (persona + runtime, kể cả `path`, `hidden`, `sceneId`, `relationships`, `memories`, `kpiHistory`, v3 `traitBase`, `dayFactor`, `probationUntilDay`, `bonuses`, `promotions`) | `reviveAgent` (`:298-349`): bỏ người thiếu `id`/`name`/`role` hợp lệ; **`status` chỉ nhận `'candidate'`/`'fired'`, mọi giá trị khác (kể cả thiếu hay sai chính tả) → `'active'`** (`:304`) — file sửa tay có thể "hồi sinh" người đã nghỉ thành nhân viên đang làm; cần **≥ 1 người và có sếp `active`** (`:3085-3086`), không thì toàn bộ file bị coi là hỏng; toạ độ ngoài bản đồ → ghế; `kpiHistory` ≤ `KPI_HISTORY_KEEP = 14`; `memories` ≤ `MEMORY_KEEP = 8` (text ≤ 160); `relationships.score` −100..100; `traitBase` thiếu → = `traits`; `dayFactor` 0.5..1.5; `probationUntilDay > 0` mới giữ. Quan hệ được **vá**: bỏ người không còn, thêm cặp thiếu `{ score: 0, note: 'đồng nghiệp' }` (`:3093-3097`) |
| `rt` | `Record<id, Rt>` — trạng thái chạy nội bộ (`world.ts:126-154`: `cd`, `arrived`, `left`, `arrivedAt`, `lunch`, `pendingDur`, `rate`, `exit`, `outUntil`, `partner`, `panic`, `waypoints`, `waitUntil`, `removeBy`, `idleSince`, `hiredAt`, `justHired`, `waiting`, `sceneSeen`, `sceneSince`, `speedLoss`, v3 `personal`, `tempTraits`, `dayNote`, `leaveReason`) | `reviveRt` (`:3040-3065`): `cd` chỉ nhận key trong `ACTIONS`; `speedLoss` 0..510; `tempTraits` ±0.5; `lunch` qua `reviveLunch` (`:381-390`); thiếu → `rebuildRt` suy từ giờ (`:3068-3076`) |
| `boss` | `BossPlan { trips[], state, reason, dur, returnAt, forced }` | `reviveBossPlan` (`:392-406`): ≤ 4 chuyến; mâu thuẫn với `present` của sếp được sửa (`:3162-3163`) |
| `spotted`, `lastSpotAny` | ai vừa bị bắt quả tang / lần cuối | `reviveCounts` |
| `obsWork` | phút giờ hành chính đã mô phỏng hôm nay (chấm KPI công bằng) | thiếu (file cũ) → `workOverlap(0, phút hiện tại)` |
| `flags` | `DayFlags` | `firstArrivalLogged` mặc định **`true`** khi thiếu (khác 3 cờ còn lại) |
| `news` | `NewsStore.serialize()` → `{ v: 1, used ≤ 500, recent ≤ 20, items ≤ 12/nhóm, lastRefreshAt }` (`store.ts:351-355`) | `getNews().restore()` (`:357-378`): `used` FIFO 500; `recent` qua `sanitizeRef`; `items` qua `ingest` (≤ 6 × 40 mục, **tin quá hạn bị `filterNews` loại ngay**); file cũ không có → bỏ qua. Lưu ý: bộ nhớ giữ ≤ 40 tin/nhóm nhưng **chỉ 12/nhóm được lưu** (`PERSIST_PER_CATEGORY`) → sau khởi động lại kho mỏng cho tới lần tải RSS đầu (~20 s) |

Sau khi commit, `normalizeRestored` (`:3195-3232`) chạy cho từng người: `path = []`, **`hidden = false`**, **`sceneId = null`**, `onPhone = false`, `spotKey = null`, gỡ `partner`/`pendingDur`/`rate`/`waypoints`/`panic`/`sceneSeen`; người không `active` và không có mặt → **xoá**; đang `leaving` → đi tiếp ra cửa; `arriving` → đi về bàn; còn lại → `idle` (tick sau tự chọn việc). Không lưu `reservations` (chỗ đứng) — dựng lại khi chọn việc.

### 6.4 `director` (`Director.serialize`, `restore` — `director.ts` ≈ dòng 4629 và 4732 ngày 2026-11-03)

`{ v: 2, seq, plannedDay, lastRecapDay, recaps, rumors, queue, timers, story: { showrunner, ledger, newsUsed, discussedNews, newsCatIdx, bossStrictUntil, overtime, lateTomorrow, driftPlans, counters }, summaries, recentTopics, dayEvents, notable, firedToday, hiredToday, lateToday, lateDays, vacancies, usedNames, birthdays, birthdayToday, lastBirthdayDay, boost, productBoostUntil, recentProducts, shopping, companyToday, actCounts, daySawPresence, counters }`. `serialize()` lỗi → `{ v: 1 }`.

- `shopping` (v4, "chuyện mua sắm" — [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) §11.8) = `{ theme: { key, until, startedAt, announce } | null, recentThemes, lastThemeDay, recentAngles, productUses: { <id món>: số lần nhắc }, owned: { <id người>: [{ id món, day }] }, deliveriesToday }`. Khôi phục qua `restoreShopping`: `theme` chỉ nhận khi `key` có trong `SHOPPING_THEMES` và có đủ `until`/`startedAt`; `recentThemes ≤ 6`, `recentAngles ≤ 8`; `productUses` và `owned` **chỉ giữ món còn trong danh mục hiện tại** (đổi `data/products.json` thì sổ tự dọn), `owned` ≤ 6 món/người; `deliveriesToday` kẹp 0–10.

Điểm cần biết:
- **Cảnh đang diễn không được lưu** (`office = online = null` khi restore, `:4175-4176`); agent "mồ côi" (còn `sceneId`) được World `normalizeRestored` và Director sweep dọn. Riêng cảnh HR dở (`firing`, `hr_warning`, các `HR_SCENE_TYPES`, `hr_review`) được **đẩy lại vào `queue`** với `prio 'high'` để diễn lại sau khởi động (`:4112-4122`). Ứng viên trong `queue` bị xoá (`delete data.candidate`, `:4108`) — sinh lại sau.
- Timer giao hàng (`timers[]` với `kind: 'delivery'`) có `agentId`, `productId`, `tries` 0–5 và (vòng 3) `since` = lúc đặt hàng (phút game; bản lưu cũ chưa có thì lấy `at`) — đơn quá 5 ngày thì bỏ ([04](04-dao-dien-cau-chuyen-nhan-su.md) §11.5).
- Trần khi khôi phục: `recaps ≤ KEEP_RECAPS 14`, `queue ≤ QUEUE_MAX 40`, `timers ≤ 20`, `summaries ≤ KEEP_SUMMARIES 12`, `recentTopics ≤ 14`, `dayEvents ≤ KEEP_DAY_EVENTS 40`, `notable ≤ 25`, `firedToday`/`hiredToday ≤ 10`, `lateDays ≤ 7`/người, `usedNames ≤ 100`, `recentProducts ≤ 8`, `newsUsed ≤ NEWS_USED_KEEP 60`, `discussedNews ≤ NEWS_DISCUSSED_KEEP 20`, `driftPlans ≤ 30`, `overtime.ids ≤ 12` (`:4178-4249`, hằng `:144-147`, `:120-121`).
- `rumors` = `RumorBook.serialize()` → `{ seq, list, leaked }` (`src/sim/rumors.ts:172-174`), restore cắt `MAX_RUMORS`/`MAX_VERSIONS`.
- `story.showrunner` = `Showrunner.serialize()` → `{ v: 1, seq, nextPlanAt, recentBeats, counters, arcs ≤ MAX_ARCS_KEPT }` (`src/sim/story.ts`); mỗi mạch ghi qua `canonArc` (**thứ tự khoá cố định**: `id, kind, a, b, intensity, note, status, createdDay, createdAt, step, total, nextAt, source, resolvedDay, productId` + v5 `plan, planBy, pep, sideA, sideB, waited, outcome` — tình huống công ty, [04-dao-dien-cau-chuyen-nhan-su.md](04-dao-dien-cau-chuyen-nhan-su.md) §16.7). Restore lọc `kind ∉ BEAT_KINDS`, id trùng; `total` kẹp 1..4 (`MAX_ARC_STEPS`); `plan` chỉ nhận `plan_a..plan_d`, `planBy` `llm`/`offline`, `pep` `inspired`/`unmoved`, `outcome` `good`/`bad`, `sideA/sideB` ≤ 6 id chuỗi, `waited` 0–10000; không bao giờ giữ quá 2 mạch mở.
- `story.ledger` = `HrLedger` (`src/sim/hr.ts:47-79`), đủ 20 trường: mốc toàn công ty `lastReviewDay`, `lastRevenueCheckDay`, `lastFireDay`, `lastPromotionDay`, `lastBonusAnyDay`, `lowRevenuePeriods`, `layoffDays[]` (≤ 10 khi khôi phục); các bản đồ theo người `lastBonusDay`, `lastPraiseDay`, `lastWarnDay`, `lastRaiseAskDay`, `raiseDeniedDay`, `lastResignTalkDay`, `lowMoodDays` (mỗi bản đồ ≤ 60 khoá, `numRecord`); và 6 trường còn lại (`hr.ts:70-78`): `frozenRoles` (vai trò bị **đóng băng tuyển dụng** tới ngày N sau cắt giảm — Director đặt `day + 6` ở `director.ts:2751`, `detectVacancies` đọc `:4089`; chỉ giữ khoá thuộc `ROLE_ORDER`), `lastRevenueZone` (`low`/`ok`/`high`; `revenueTrigger` chỉ họp sớm khi **vùng đổi**, `hr.ts:253-262`), `idleReviews` (số kỳ họp liên tiếp không chốt gì, kẹp 0..99; `offlineDecisions` nhân trọng số hành động với `pressure = 1 + min(idle, 3)`, `hr.ts:382-383,407` — họp mãi không làm gì thì HR offline "sốt ruột" dần; reset về 0 khi có quyết định, `director.ts:3268`), và 3 bộ đếm `reviews`, `decisions`, `rejected`. Khôi phục qua `restoreLedger` (`hr.ts:96-120`): trường thiếu → mặc định của `newLedger()`. Đây là **sổ hàng rào** (cách lần đuổi ≥ 2 ngày, thưởng ≥ 7 ngày…), mất nó là hàng rào "mềm" đi một nhịp.
- Showrunner được dựng lại với `cfgNum(... 'SHOWRUNNER_EVERY_GAME_MINUTES', 120)` lúc restore (`:4228`) — đổi nhịp trong `.env` có hiệu lực sau khởi động lại.

Chi tiết ngữ nghĩa từng trường ở [04-dao-dien-cau-chuyen-nhan-su.md](./04-dao-dien-cau-chuyen-nhan-su.md).

### 6.5 `brain` (`brain.ts:386-400`; router `router.ts:790-808`, `:829-876`)

`{ v: 2, router: RouterSnapshot, failures, skipped }`; v1 (số liệu ở gốc) vẫn đọc được. `RouterSnapshot` (`router.ts:236-251`): `{ v: 2, date: 'YYYY-MM-DD' (giờ VN), carry: { date, calls, failures, inputTokens, cachedTokens, outputTokens, costTotalUsd, costTodayUsd }, providers: Record<tên, ProviderSnapshot> }`; mỗi `ProviderSnapshot`: `calls, failures, inputTokens, cachedTokens, outputTokens, costTodayUsd, costTotalUsd, rpdUsed, tpdUsed, day (ngày theo múi giờ reset của provider), cooldownUntil, cooldownReason, jsonObjectUntil, backoffRate, backoffServer, lastError?, maxOutputTokens?, maxOutputUntil?`.

Luật lúc `serialize`: chỉ ghi `cooldownUntil`/`jsonObjectUntil`/`maxOutputTokens` **còn hiệu lực** (`> now`); `jsonObjectUntil = +∞` (cấu hình `JSON=object`) → ghi `0` (dựng lại từ cấu hình khi khởi động). Luật lúc `restore`: provider **không còn trong cấu hình** → gộp vào `carry` (`foldIntoCarry`) để tổng không tụt; `rpdUsed`/`tpdUsed`/`costToday` chỉ giữ khi `raw.day` trùng ngày hiện tại của provider (bản cũ: so ngày VN chung), khác ngày → 0; `cooldownUntil` chỉ nhận khi còn ≤ 36 h (`cooldownRestoreMaxMs`); `jsonObjectUntil` chỉ khi `cfg.json !== 'object'` và ≤ 24 h; `maxOutputTokens ≥ 256` và hạn ≤ 7 ngày; `backoff*` ≤ 20; `lastError` qua `describeError` (che key lần nữa). Trạng thái **không** được lưu: tham số bị provider từ chối (`dropped`), `useMaxTokensParam` của `ProviderClient` (`llm.ts:325-326`) → sau khởi động lại có thể 400 một lần rồi tự thích nghi.

### 6.6 Cái gì **không** sống sót qua khởi động lại (cố ý)

Cảnh đang diễn, bong bóng thoại, `onPhone`, trạng thái **ẩn trong WC**, chỗ đứng đã giữ, bạn bóng bàn, `panic`, sự cố `incident`, ứng viên/người bị đuổi đã ra khỏi văn phòng, tốc độ tua (`spd = 1`), tin trong kho ngoài 12/nhóm, tham số AI đã học ở tầng client. Đổi `TIME_MODE` → sang ngày mới. Đổi `COMPANY_NAME` → tên công ty trong snapshot đổi theo.

---

## 7. `data/history/` — lưu trữ dài hạn (archive JSONL)

### 7.1 Tên file, định dạng dòng

- Một file mỗi **ngày theo giờ Việt Nam** (`vnDate`, `archive.ts:43-46`: UTC+7 cố định, không phụ thuộc múi giờ VPS): `HISTORY_DIR/YYYY-MM-DD.jsonl`, sau xoay vòng `YYYY-MM-DD.jsonl.gz` (`FILE_RE`, `:18`). Ngày lấy theo `ts` lúc `record()`, không theo ngày game.
- Mỗi dòng: `{"ts":<ms epoch>,"kind":"<≤32 ký tự>","data":<JSON bất kỳ>}` (`:144`); `kind` rỗng → `'misc'`; `data` `undefined` → `null`. Dòng dài hơn `maxLineBytes = 64 KiB` → thay bằng `{"truncated":true,"text":"<2000 ký tự đầu>"}` (`:145-147`).

### 7.2 Ai ghi gì

| `kind` | Ai ghi | `data` | Ghi chú |
|---|---|---|---|
| `log` | `World.log()` (`world.ts:891`) — **mọi** `LogEntry` | nguyên `LogEntry` (`types.ts:342-357`): `id, day, minute, kind ∈ line\|event\|hr\|scene_start\|scene_end\|system, channel?, sceneId?, speaker?, speakerName?, text, icon?, product?, news?` | ~96 % số dòng; `data.kind === 'hr'` ở đây là **dòng feed HR**, khác với kind `hr` cấp ngoài bên dưới |
| `kpi` | `World.endDay()` (`world.ts:2417`) | `{ day, weekday, results: KpiResult[] }` — `KpiResult { id, name, roleLabel, kpi, target, ratio, lowStreak }` cho **mọi** người active kể cả sếp/HR | 1 dòng mỗi ngày game có mở cửa |
| `hr` | `Director.archive('hr', …)` | `{ day, minute, text (≤300), ...extra }` với `extra` tuỳ chỗ: `{ id, action }` (warn/fire/layoff/probation/second_chance/bonus/promote…), `{ action: 'open_position', role }`, `{ decisions, source }` (chốt họp), `{ id, verdict }` (tăng lương), `{ id, action: 'probation', passed, avg }`, `{ id, action, cancelled, why }`, `{ id, deferred, why }` (`director.ts:790,798,2674,2738,2758,3257,3272,3361,3368,3389,3412,3561,3569,3593,3843,3852`) | mọi quyết định nhân sự đã **thi hành/hoãn/huỷ** |
| `resign` | `Director.archive('resign', …)` (`:2777,3536`) | `{ day, minute, text, id, verdict? }` | nghỉ hẳn / định nghỉ nhưng ở lại |
| `news` | `Director` khi kết cảnh có tin (`:3096`) | `{ day, minute, text, id, title, source, url, category, participants[] }` (NewsRef + người tham gia) | người đọc tự kiểm chứng tin |
| `beat` | `Director` (`:3671,3705,3815`) | `{ day, minute, text, id, kind, a?, b?, intensity?, source? }` khi lên biến; `{ id, kind, steps }` khi kết mạch; `{ id, kind }` khi mạch tự rơi | AI biên kịch |
| `recap` | **không có code nào ghi** (grep `director.ts`: chỉ `emit({ t: 'recap' })`) | — | chú thích đầu `archive.ts:4` và `SPEC.md` §10.3 nhắc `recap` là **lỗi thời** |

Hàm bọc của Director (`director.ts:2964-2975`): `record(kind, { day, minute, text: cut(text, 300), ...extra })`, no-op khi archive tắt; không lưu lại tóm tắt cảnh vì World đã lưu `log`.

### 7.3 Hàng đợi, ghi lô, trần (`Archive`, `archive.ts:58-242`)

- Mặc định (`defaults()`, `:84-90`): `dir 'data/history'`, **`enabled: false`**, `keepDays 180`, `gzipAfterDays 7`, `flushMs 2000`, `maxQueue 5000`, `maxLineBytes 64 KiB`, `now = Date.now`. Singleton `getArchive()` (`:477-480`) **tắt cho tới khi** server/smoke gọi `configure({ enabled: true, … }).start()` → test không vô tình ghi file.
- `record()` (`:138-162`) chỉ xếp hàng — không bao giờ chặn tick; vượt `maxQueue` → **bỏ dòng cũ nhất**, đếm `dropped`, cảnh báo (≤ 1 lần/10 phút, `warnOnce`).
- `start()` (`:113-122`): `setInterval(tickFlush, max(250, flushMs))` + `rotate()` sau 5 s; cả hai `unref()`. `tickFlush` flush rồi chỉ xoay vòng khi **ngày VN đổi** và đã có lần xoay đầu (`:164-168`).
- `doFlush()` (`:178-213`): gom theo ngày, `appendFile`; `ENOENT` (thư mục bị xoá) → xếp lại lô **đúng một lần** rồi tạo lại thư mục ở lần sau; lỗi khác → bỏ lô + `dropped += n`. `flushSync()` (`:216-242`) dùng khi tắt server (`archive.stop()`, `server.ts:510`).

### 7.4 Xoay vòng (`rotate`, `:246-309`)

Không đụng file **hôm nay**. Với mỗi file khớp `FILE_RE`: `age = hôm nay − ngày file`; `age > keepDays` → **xoá**; `.jsonl` có `age ≥ gzipAfterDays` → **gzip** (`level 6`) vào `YYYY-MM-DD.jsonl.gz` rồi xoá gốc; nếu `.gz` đã tồn tại (ngày từng ghi thêm sau khi nén) → **nối thêm một thành viên gzip** (gunzip đọc được nhiều thành viên). Log `🗄️ Lưu trữ: nén X file, xoá Y file cũ` khi có việc. **`index.json`** (`:344-378`): `{ "YYYY-MM-DD": { mtimeMs, size, count } }` chỉ cho ngày `.gz` — để khỏi giải nén đếm dòng lại sau mỗi khởi động; ghi nguyên tử tmp + rename; hỏng → đếm lại rồi ghi mới. **Bẫy: `rotate()` không ghi index.** `saveIndex()` chỉ được gọi **bên trong `listDays()`** (`:340`) và chỉ khi `indexDirty` (vừa đếm dòng một ngày `.gz`, `:335`); `loadIndex()` cũng chỉ chạy lần đầu `listDays()` (`:316`). `listDays()` chỉ được gọi từ `GET /api/history` **không kèm `date`** (`server.ts:296`, tab Lịch sử). Hệ quả: trên production nếu chưa ai mở tab Lịch sử thì `index.json` **không bao giờ xuất hiện** dù `.gz` đã có — không phải lỗi, chỉ là chưa có gì để nhớ; nhưng khi kiểm "luồng `.gz` đã chạy chưa" (câu hỏi mở #15) phải nhìn file `.gz`, không nhìn `index.json`.

### 7.5 Đọc

- `listDays()` (`:313-342`) → `{ date, count, bytes, gz }[]` tăng dần; ngày có cả `.jsonl` và `.gz` ưu tiên `.jsonl`; đếm dòng nhớ theo `mtime`/`size`.
- `readDay(date, { offset, limit })` (`:381-421`): `limit` kẹp `1..HISTORY_READ_MAX = 5000`; đọc `.gz` **trước** rồi `.jsonl`; bỏ dòng hỏng; giữ tham chiếu stream gốc để `destroy()` không rò fd.
- HTTP `GET /api/history` (`server.ts:292-327`, **công khai**): không `date` → `{ enabled, days, stats{ queued, written, dropped, errors, lastFlushAt, lastRotateAt } }`; `?date=YYYY-MM-DD[&offset&limit]` → `{ date, offset, limit, count, entries }`; 400 sai định dạng, 404 không có ngày, **429 + `Retry-After: 3`** khi > `HISTORY_MAX_INFLIGHT = 3` lượt đọc song song; `Cache-Control: public, max-age=86400` khi ngày đã **đóng băng** (`isFrozenDay`: chỉ còn `.gz`), còn lại `no-store`. Client: tab Lịch sử `public/js/ui/history.js:12`. nginx giới hạn `/api/` 2 r/s burst 5 (`deploy/nginx.site.conf:29-31`).

### 7.6 Số liệu thực tế trên máy dev (2026-11-02)

`2026-11-01.jsonl`: 854 897 B, 3 336 dòng — `log` 3 214 (trong đó `data.kind`: `line` 2 151, `scene_start` 414, `scene_end` 411, `event` 196, `system` 24, `hr` 18), `beat` 89, `hr` 12, `news` 11, `kpi` 9, `resign` 1. `2026-11-02.jsonl`: 123 176 B, 520 dòng (tới 11:21). Chế độ nén chạy nhiều ngày game mỗi ngày thật nên ≈ **0,85 MB/ngày thật** (SPEC §10.3 ước 5–6 MB/ngày thật trước nén nếu chạy liên tục; README §8 ghi "~50 KB/ngày" là **sai**). Chưa có `.gz`/`index.json`.

---

## 8. `docs/real-products.json` — sản phẩm thật chờ ghép

Cấu trúc `{ _note, products: [6] }`; mỗi mục có đúng các khoá của `Product` (`id, name, emoji, category, shelf, slot, tags, pitch, priceHint, note, url`) **cộng** `_info` (link trang sản phẩm gốc, không phải affiliate). Trạng thái:

| id | Tên | Kệ / slot | Trạng thái |
|---|---|---|---|
| `may-hut-bui-giuong-nem` | Máy hút bụi giường nệm | tech / 0 | đã ghép vào `data/products.json` (ở đó `note` đã điền; trong file này `note: ""`) |
| `bang-phan-mat-cheeryep` | Bảng phấn mắt CHEERYEP | beauty / 0 | đã ghép (như trên) |
| `san-pham-3`, `san-pham-5`, `san-pham-6`, `san-pham-6b` | `"???"` | tech / 1, 2, 3, 4 | **chỗ trống**: `tags: []`, `pitch: ""`, `note: ""`; chỉ có `url` affiliate + `_info` — chờ chủ dự án gửi tên/nhận xét |

Không module nào import file này; nó là **kho chờ** cho §5.5. Khi ghép: đặt `id` kebab-case có nghĩa (không giữ `san-pham-3`), điền `name`/`tags`/`pitch`/`note`, xoá `_info`, chọn `slot` trống trên kệ (các slot tech 1–4 hiện là hàng mẫu `ban-phim-co`, `tai-nghe-chong-on`, `chuot-khong-day`, `sac-du-phong` — thay thì nhớ `deskItemProductId` của roster đang trỏ `ban-phim-co`, `tai-nghe-chong-on`, `chuot-khong-day`). Nguồn sự thật đang chạy là `data/products.json`; file này chỉ là ghi chú.

---

## 9. Bí mật, `.gitignore`, rsync và dữ liệu phía trình duyệt

### 9.1 Những gì không bao giờ vào git (`.gitignore`, 18 dòng)

`node_modules`, `.env`, `data/state.json`, `data/state.json.*` (bản `.bad-*`, `.tmp-*`), `*.tmp-*` (cả file tạm của archive/index), `deploy/vps.env`, `deploy/.env.production`, `data/history/`, `.DS_Store`, `*.log`, `.claude/settings.local.json`. Thư mục đã là repo git (bối cảnh "chưa git init" đã lỗi thời) và `git ls-files` **không** chứa file bí mật nào (`.env`, `deploy/vps.env`, `deploy/.env.production`, `data/state.json`, `data/history/` đều vắng). Hiện trạng git (số commit, hash, file chưa theo dõi) **chỉ ghi ở một nơi** để không lỗi thời lệch nhau: [14-quy-uoc-dong-gop.md](./14-quy-uoc-dong-gop.md) §7.1.

### 9.2 Những gì không lên VPS qua rsync (`deploy.sh:31-36`)

`node_modules`, `.git`, `data/state.json`, `data/state.json.*`, `data/history`, `.env`, `deploy/vps.env`, `deploy/.env.production`, `docs/preview`, `.claude`, `*.log`, `*.tmp-*`. Có `--delete` nhưng **không** `--delete-excluded` → `state.json`, `history/`, `.env` trên VPS được **bảo toàn**; file khác không còn ở local sẽ bị xoá trên VPS. `.DS_Store` **không** bị exclude (lệch với `.gitignore`).

### 9.3 Dữ liệu phía trình duyệt

- `localStorage['vpa.dev']` (`public/js/net.js:13`, `DEV_KEY`): mã dev lấy từ `?dev=`/`#dev=` trên URL, cất lâu dài (bản cũ `sessionStorage` được chuyển sang một lần), gỡ khỏi thanh địa chỉ, gắn vào URL WebSocket `?dev=` và gửi `POST /api/dev/login` mỗi lần mở trang.
- Cookie **`vpa_dev`** do server đặt (`server.ts:78,104-118`): `Path=/; HttpOnly; SameSite=Lax` (+ `Secure` khi `x-forwarded-proto: https` hoặc TLS trực tiếp), `Max-Age=31536000` (1 năm); `POST /api/dev/logout` xoá. `DEV_TOKEN` rỗng → login trả 204 **không đặt cookie**. Nút 🚪 "Thoát admin" xoá cả localStorage và cookie rồi tải lại (`net.js:40-45`).
- Hai tên **cố ý khác nhau** (`vpa.dev` vs `vpa_dev`); đổi phải sửa cả `net.js` và `server.ts`.

### 9.4 Quy tắc viết tài liệu / log

Không chép giá trị của `.env*`, `data/state.json` vào tài liệu, issue, log. Code đã tuân: `DEV_TOKEN` không in (`server.ts:563-567`), key AI bị `redactSecrets` che trong mọi `lastError`/log/snapshot, nginx tắt access log cho `/ws` và URL có `?dev=` (`deploy/nginx.site.conf:12-13,42`).

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … | chạy test |
|---|---|---|
| **Thêm biến môi trường mới** | `src/config.ts` (dùng `num/bool/str/limit`, kẹp sàn/trần ngay tại đây; đừng đọc thẳng `process.env` ở module khác — Director thì qua `cfgNum/cfgBool` với khoá camelCase); `.env.example` (tên + chú thích + giá trị gợi ý **không bí mật**, đúng khối); bảng §3 tương ứng của tài liệu này (+ §4.2 nếu gợi ý khác mặc định); tài liệu vùng tiêu thụ ([03](./03-mo-phong-the-gioi.md)/[04](./04-dao-dien-cau-chuyen-nhan-su.md)/[05](./05-lop-ai.md)/[06](./06-tin-tuc-thoi-su.md)); `SPEC.md` §10.1 nếu là v3; `README.md` nếu chủ dự án cần biết | `npm run typecheck`; `npm run test:router` nếu là `AI_<TÊN>_*` (mục 13 có test `buildProviders`) |
| **Đổi mặc định** một biến | bảng §3; `.env.example`; `README.md` chỗ ghi con số (§3.4, §4, §8…); `SPEC.md` §10.1 | `npm test` |
| Biến `AI_<TÊN>_*` mới / đổi semantics | `ProviderConfig` (`config.ts:40-68`), `buildProviders`, `makeProvider` mặc định; bảng §3.2; `05-lop-ai.md`; `README.md` §3.5 | `npm run test:router` (mục 13), `test:llm` |
| Shape `serializeWorld()` / `Rt` / `AgentState` | `reviveAgent`/`reviveRt`/`restoreWorld` (file cũ phải còn đọc được hoặc **tăng `STATE_VERSION`** có chủ ý); §6.3/§6.6 ở đây; `03-mo-phong-the-gioi.md` | `npm run smoke` (restore rác + `hello()` JSON), `smoke:story` (round-trip) |
| Shape `Director.serialize()` / `Showrunner` / `RumorBook` / `HrLedger` | `restore()` tương ứng + trần; §6.4; `04-dao-dien-cau-chuyen-nhan-su.md`; trường mới của `Arc` phải thêm cả vào `canonArc` **cùng thứ tự** với `restore()` (không thì round-trip lệch) | `npm run smoke:story` (so sánh JSON trước/sau restore, restore rác) |
| `SITE_URL` / `siteUrlOf` | bảng §2.2 và §3.11; `.env.example`; [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md) §7.1; [10-van-hanh-deploy.md](10-van-hanh-deploy.md) §2.4 | `npm run typecheck`, `curl` thẻ `og:url` như 02 §7.1 |
| `RouterSnapshot` / `ProviderSnapshot` | `serialize`/`restore`/`foldIntoCarry` (`router.ts`), bản v1 vẫn đọc được; §6.5; `05-lop-ai.md` | `npm run test:router` (mục 2b, 3, 4, 7, 10, 12 — key không lọt snapshot) |
| `NewsStore.serialize()` (`v: 1`) hoặc `PERSIST_PER_CATEGORY` | `restore()`; §6.3 dòng `news`; `06-tin-tuc-thoi-su.md` §6.5; `docs/v3-news.md` nếu đổi thiết kế | `npm run test:news` (mục 5), `smoke` |
| Thêm/đổi **trường** của sản phẩm | `normalize()` (`products.ts`), `toShowroom()` (`showroom.ts`), `Product`/`ShowroomProduct` (`types.ts`), `_huong_dan` trong `data/products.json`, §5.2; client render (`public/js/render/office.js`, `ui/products.js`); `docs/v2-contract.md` §2 | `npm run smoke` (`hello.products`), `typecheck` |
| Đổi/xoá **id** sản phẩm | `src/content/roster.ts` (`deskItemProductId`), `scripts/smoke.ts:525-529`, `DESK_TAGS` nếu đổi tag (`brain.ts`); thống kê `clicksBy` cũ sẽ lệch | `npm run smoke` |
| Thêm `kind` archive mới hoặc đổi `data` của một kind | §7.2; chú thích đầu `archive.ts`; `public/js/ui/history.js` (hiển thị); `SPEC.md` §10.3 | `npm run smoke` (5e: đủ dòng, đọc lại), `smoke:story` (kind `hr`/`beat`/`news`) |
| Đổi tên/đường dẫn file dữ liệu, thư mục | `.gitignore`, `deploy/deploy.sh` exclude, mặc định `STATE_FILE`/`HISTORY_DIR`, `PRODUCTS_FILE` (`products.ts:13`), §1.2 | deploy thử lên VPS + kiểm `state.json`/`history` còn nguyên |
| Đổi cổng production | `deploy/.env.production` (`PORT`) **và** `APP_PORT` (`deploy.sh`/`vps.env`) cùng lúc; nginx `__PORT__` được thay khi `--setup`; §3.11/§3.13; `10-van-hanh-deploy.md` | `curl /api/health` sau deploy |
| Thêm biến cho script test | chú thích đầu script; §3.12; `11-kiem-thu-qa.md` | chạy script đó |
| Đổi `DEV_COOKIE` / `DEV_KEY` / thuộc tính cookie | `server.ts:78`, `public/js/net.js:13`; §9.3; `02-kien-truc-va-giao-thuc.md`; `README.md` §8 | mở trang kèm `#dev=`, thoát admin, mở lại |
| Nhịp lưu `SAVE_EVERY_MS` | `server.ts:25`; §6.1; `README.md` §8 ("mỗi 60 giây"); log khởi động `server.ts:553` (chuỗi "mỗi 60 giây và khi tắt" viết cứng, không lấy từ hằng) | — |
| Thứ tự `archive.start()` / `new World` / `world.load()` (`server.ts:245-252`) | §6.1 "Bẫy khởi động", câu hỏi mở #2; `01-tong-quan.md` §5.5 (thứ tự khởi động) | `npm run smoke` (5e), rồi `grep '"day":1' data/history/<hôm nay>.jsonl` sau một lần restart có `state.json` |

---

## Câu hỏi còn mở / cần kiểm tra

1. **`data/state.json` không có trên máy dev** dù `data/history/` có dữ liệu tới 2026-11-02 11:21 — `PERSIST=false` hay `STATE_FILE` trỏ chỗ khác trong `.env` cục bộ? (Không đọc `.env` khi viết; chủ dự án xác nhận.)
2. **Dòng "ngày 1" giả trong archive sau mỗi khởi động lại** — **đã xác nhận bằng code** (chuỗi gọi ở §6.1), không còn là nghi vấn. Việc còn mở là **chọn cách sửa**: (a) dời `getArchive().configure(...).start()` xuống sau `world.load()` — nhưng chú thích `server.ts:244` nói archive được bật sớm **cố ý** để dòng "mở cửa" đầu tiên của văn phòng mới được lưu, nên cần giữ hành vi đó cho lần chạy đầu (chưa có `state.json`); (b) cho World tạm hoãn `archiveRecord` cho tới `start()`/sau `load()` rồi xả các dòng còn hợp lệ; (c) chấp nhận và để `history.js` lọc. Đo thực tế một lần: `grep -c '"day":1' data/history/<hôm nay>.jsonl` ngay sau restart có `state.json` (số dòng ≥ 1 theo code; con số thật tuỳ `rollPersonalEvent`).
3. **`SHOWROOM_SCENE_MIN_MINUTES` đọc thẳng `process.env`** (`director.ts:66`) — nên đưa vào `CONFIG` (`showroomSceneMinMinutes`) để smoke ghi đè được và thống nhất quy ước.
4. `.env.example` **thiếu** `OPENAI_RPM`/`OPENAI_RPD`/`OPENAI_TPD`; các biến `AI_<TÊN>_PACE/WEIGHT/REASONING/MAX_*/EXTRA_JSON` chỉ nằm ở ghi chú cuối; khối Cloudflare đang comment trong khi README §3.4 minh hoạ `gemini,groq,cloudflare` — nên thống nhất.
5. `.env.example` đặt `AI_ROUTING=balanced` nhưng mặc định code là `priority` — chủ ý (để ai copy mẫu thì có balanced) hay nên đổi mặc định code?
6. **Kind `recap` không được ghi** vào archive (§7.2) dù `archive.ts:4` và `SPEC.md` §10.3 nhắc — sửa chú thích/SPEC, hoặc thêm `archive('recap', …)` khi phát bản tin (`director.ts:3960`) nếu muốn lịch sử có bản tin.
7. `reviveCompany` lấy `name` từ `CONFIG.companyName` thay vì file (`world.ts:3087`) → đổi `COMPANY_NAME` đổi tên công ty trong snapshot đang chạy; chủ ý (hợp lý) nhưng chưa ghi ở đâu ngoài đây.
8. Trùng tên gây nhầm khi đếm: kind cấp ngoài `hr` (Director, quyết định đã thi hành) và `log` có `data.kind === 'hr'` (World, dòng feed). Cân nhắc đổi kind ngoài thành `hr_decision` (phải sửa `history.js`, SPEC, smoke-story).
9. **dotenv vs pm2 `--update-env`**: dotenv không ghi đè biến đã có trong `process.env`; nếu pm2 từng giữ một biến (ví dụ `PORT`) thì `.env` mới có thể không thắng — cần kiểm tra trên VPS (`pm2 env <id>`), và ghi vào `10-van-hanh-deploy.md`.
10. `tsx watch` (`npm run dev`) có khởi động lại khi `.env` đổi không? (Cần kiểm tra; giả định là **không**.)
11. `docs/v3-news.md` nói "lưu ~40 tin mỗi nhóm + persist" nhưng `PERSIST_PER_CATEGORY = 12` (`store.ts:18`) — sửa tài liệu thiết kế hoặc nâng số lưu.
12. `README.md:272` "16 món MẪU — 7 làm đẹp, 9 công nghệ" và `README.md:446` "~50 KB/ngày" lỗi thời (thực tế 18 món 8/10 với 2 món thật; ~0,85 MB/ngày thật) — sửa README.
13. `docs/real-products.json`: `note` rỗng cho 2 món đã ghép trong khi `data/products.json` đã có `note` — nên ghi rõ file nào là nguồn sự thật (đề xuất: chỉ `data/products.json`) hoặc đồng bộ lại; 4 chỗ trống là việc mở của chủ dự án.
14. Kích cỡ thực tế của `data/state.json` trên production chưa đo (mọi mảng đều có trần nên bị chặn, `smoke-story` cảnh báo khi > 200 KB) — đo một lần trên VPS để ghi vào đây.
15. `index.json` và luồng `.gz` chưa từng chạy trên production (chưa đủ 7 ngày từ 2026-11-01) — kiểm sau 2026-11-08: file `.gz` xuất hiện, `index.json` có `count`, `/api/history?date=` ngày đó trả `Cache-Control: public, max-age=86400`.
16. `TIME_MODE` so khớp **phân biệt hoa thường** (`config.ts:279`): `Realtime` → `compressed` lặng lẽ; cân nhắc `toLowerCase()` + cảnh báo giá trị lạ. Tương tự `PORT` không được floor/kẹp.
17. `parseExtraBody` không chặn `temperature`/`reasoning_effort`/`prompt_cache_key` — là tính năng (ép tham số cho endpoint lạ) hay bẫy? Nếu là tính năng, ghi vào `.env.example`.
18. ~~`docs/README.md` (mục lục bộ tài liệu) chưa tồn tại~~ — đã tạo 2026-11-02 ([README.md](./README.md)); đoạn mở đầu của tài liệu này và của 08/10 đã trỏ tới mục lục thật. Không còn liên kết gãy liên quan.
19. **Cách đếm "đường đọc `process.env` ngoài `CONFIG`" lệch giữa các tài liệu**: 02 nói 1 ngoại lệ (`SHOWROOM_SCENE_MIN_MINUTES`), 14 nói 2 (thêm `DEBUG_PROMPTS`), 09 §2.3 mô tả 3 đường code (thêm nhánh dự phòng `cfgNum/cfgBool`, `director.ts:81,88`). Code ủng hộ cả "2 biến" và "3 đường" (đã ghi rõ ở §2.3); 02 nên bổ sung `DEBUG_PROMPTS`.
20. `.env.example:32` (chú thích model Groq gợi ý) ghi `qwen/qwen3-32b` trong khi vài tài liệu khác và bối cảnh chủ dự án nhắc một tên model khác cho Groq fallback — tài liệu này chỉ trích tên hai model **bắt buộc** ở §4.2 (`:22`, `:34`) và không khẳng định model dự phòng nào đang chạy trên production (`deploy/.env.production` không được đọc). — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
