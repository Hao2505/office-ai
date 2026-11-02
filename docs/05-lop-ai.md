# Lớp AI: router, brain, prompt, sanitizer, offline

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `src/ai/*` (`llm.ts`, `router.ts`, `brain.ts`, `prompts.ts`, `prompt-budget.ts`, `schemas.ts`, `sanitize.ts`, `offline.ts`), phần AI của `src/config.ts`, các kiểu `Brain` / `UsageStats` / `ProviderStats` / `PromptContext` / `SceneRequest` trong `src/types.ts` · Đọc khi: thêm hoặc đổi nhà cung cấp AI, sửa prompt / schema / luật làm sạch, điều tra vì sao cảnh rơi về thoại mẫu, tối ưu token, hoặc đọc log `[ai] …`.

Tài liệu này trả lời: AI được gọi **khi nào**, **gọi ai** (provider nào, theo luật gì), **gửi gì** (prompt, schema, tham số), **nhận về rồi kiểm tra ra sao**, và **khi không gọi được thì thoại ở đâu ra**. Nó là bản mô tả theo mã nguồn hiện tại; hợp đồng gốc nằm ở [`../SPEC.md`](../SPEC.md) §6 (một phần đã lỗi thời, xem mục 15) và [`../src/types.ts`](../src/types.ts). Hướng dẫn lấy key / điền `.env` cho chủ dự án ở [`../README.md`](../README.md) §3–4 — tài liệu này không chép lại mà chỉ trỏ tới. Phía gọi vào lớp AI (Director, World) xem [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md) và [`03-mo-phong-the-gioi.md`](03-mo-phong-the-gioi.md); nguồn tin thật cho `req.news` xem [`06-tin-tuc-thoi-su.md`](06-tin-tuc-thoi-su.md); bảng biến môi trường toàn dự án xem [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md).

**Không có bí mật nào trong tài liệu này.** Chỉ nhắc TÊN biến môi trường (`AI_GEMINI_API_KEY`…); giá trị thật nằm trong `.env` (gitignored) và không bao giờ được chép vào tài liệu.

---

## 1. Bức tranh tổng thể

### 1.1 Các file và vai trò

| File | Dòng | Vai trò một câu |
|---|---|---|
| `src/config.ts` | 366 | Đọc `.env` (dotenv) → `CONFIG`; dựng `ProviderConfig[]` từ `AI_PROVIDERS` + `AI_<NAME>_*` (hoặc `OPENAI_*` kiểu cũ) — hàm thuần `buildProviders(env)` |
| `src/ai/llm.ts` | 441 | Tầng thấp nhất: 1 provider = 1 client OpenAI-compatible; `attempt()` = đúng 1 lần HTTP; che key, múi giờ, mô tả lỗi tiếng Việt, đo token / chi phí, học tham số bị 400 |
| `src/ai/router.ts` | 891 | Chính sách nhiều provider: thứ tự / tier strong / balanced, RPM-RPD-TPD, giữ nhịp quota ngày, cooldown theo loại lỗi, failover trong cùng request, thống kê, lưu / khôi phục |
| `src/ai/brain.ts` | 402 | "Bộ não": `reserve()` quyết khi nào được gọi AI, hạn chót từng nhiệm vụ, cầu dao, ngân sách, gọi router, kiểm tra kết quả, LUÔN có đường lui offline; **không bao giờ throw** |
| `src/ai/prompts.ts` | 742 | System prompt TĨNH + user prompt động (cảnh / ứng viên / bản tin / biến), xưng hô, thẻ nhân vật, luật tin thật, hồ sơ nhân sự |
| `src/ai/prompt-budget.ts` | 65 | Ước lượng token (2,7 ký tự/token), ngân sách prompt cảnh theo số người, 4 bậc rút gọn |
| `src/ai/schemas.ts` | 126 | 4 JSON schema strict TĨNH (cảnh, biến, ứng viên, bản tin) |
| `src/ai/sanitize.ts` | 904 | Làm sạch / kiểm tra JSON model trả → `Outcome<T>`; lưới an toàn tin thật; hàng rào `hrDecisions`; các hàm "cấp cứu" |
| `src/ai/offline.ts` | 5342 | Bộ sinh thoại mẫu (template) cho 24 loại cảnh + ứng viên + bản tin + biến; không mạng |

### 1.2 Kiến trúc 4 tầng

```
Director (src/sim/director.ts)
  │ reserve(priority) → 'llm' | 'offline' | null
  │ generateScene(req, ctx, via) / generateCandidate / generateRecap / generateBeats
  ▼
Brain (brain.ts) ── prompts.ts (dựng system/user) ── schemas.ts (JSON schema)
  │ withDeadline(DEADLINE_MS[task]) → router.complete(LlmRequest)
  ▼                                            ╲ lỗi / JSON hỏng / sanitize thất bại
Router (router.ts): acquire() hàng đợi → order() → blocked()/fits() → attempt → account/penalize
  │                                            ╲→ offline.ts (offlineScene…) → sanitize.ts emergency*
  ▼
ProviderClient (llm.ts): OpenAI SDK, maxRetries 0, fetch bọc unwrapArrayErrorFetch → HTTP
```

Kết quả thành công đi ngược lên qua `sanitize.ts` (`sanitizeScene` / `sanitizeCandidate` / `sanitizeRecap` / `sanitizeBeats`) trước khi trả cho Director. Director chỉ thấy `source: 'llm' | 'offline'`, **không biết provider nào đã trả lời** (`brain.ts:5-6`).

### 1.3 Thứ tự khởi động và hai đồng hồ

1. `import './config.js'` → `loadEnv({ quiet: true })` chạy ngay lúc import (`config.ts:1-2`); `CONFIG` được tính **một lần** khi nạp module (`config.ts:248-329`). Đổi `.env` phải khởi động lại tiến trình, không có hot-reload.
2. `src/server.ts:248` gọi `createBrain(CONFIG)` → bên trong `createRouter()` tạo client cho từng provider và **in bảng provider** ra console (`router.ts:363-388`).
3. `World.load()` gọi `brain.restore(data.brain)` **trước** khi khôi phục world (`src/sim/world.ts:1040-1046`): giữ số lượt / chi phí đã tiêu kể cả khi phần world hỏng.
4. `createBrain` dựng **system prompt một lần** (`brain.ts:113-115`) → đổi `COMPANY_NAME` hay `COMPANY_INFO` (`src/content/catalog.ts:9`) cũng cần khởi động lại.

Hai đồng hồ: Router và Brain nhận `now()` tiêm được (`BrainOptions.now`, `RouterOptions.now`) cho **mọi chính sách** (cooldown, RPM, "ngày", nhịp `reserve()`, cầu dao) — test headless chạy đồng hồ ảo nhanh mà nhịp vẫn đúng. Riêng **hạn chót HTTP** dùng `Date.now()` thật (`brain.ts:282`, `router.ts:647`).

### 1.4 Nguyên tắc chủ dự án → chỗ hiện thực trong vùng này

| Nguyên tắc | Hiện thực |
|---|---|
| Tốn ít token nhất, chỉ dùng AI miễn phí | `reserve()` + `LLM_ONLY_WHEN_WATCHED`; system prompt tĩnh (cache); prompt cảnh theo bậc (`prompt-budget.ts`); giữ nhịp quota ngày + xen kẽ nguồn (`router.ts`); trần token ra / token mỗi request; giá mặc định 0 |
| Câu chuyện tự phát, không ai bị "đánh dấu" | `generateBeats` (AI biên kịch) và `hrDecisions` do AI quyết; code chỉ làm hàng rào (`sanitizeHrDecisions` theo `allowed` do `src/sim/hr.ts` tính); offline cũng ngẫu nhiên có trọng số |
| Người xem không thấy gì về hệ thống | `publicStatus()` ở `src/server.ts:184-193` xoá mọi số liệu, chỉ giữ `ai.mode`; `/api/stats` trả 404 khi không có mã dev |
| Thời sự an toàn pháp lý | `NEWS_RULES` / `NEWS_RULES_SHORT` trong prompt; `NEWS_BLOCK_RE`, `judgesNamedPerson`, ký ức tin theo mẫu cố định trong `sanitize.ts` |

---

## 2. Cấu hình provider (`src/config.ts`)

### 2.1 Cách đọc

`buildProviders(env)` (`config.ts:134-197`) là hàm thuần, test gọi trực tiếp với env giả:

- `names` = `AI_PROVIDERS` tách phẩy, trim, **chữ thường**, bỏ trùng, giữ thứ tự.
- **`AI_PROVIDERS` rỗng → đường cũ** (`:137-156`): cần `OPENAI_API_KEY` (không có → `providers: []`, `legacy: true`); `model` = `OPENAI_MODEL` hoặc `gpt-4o-mini`; tên provider suy từ `OPENAI_BASE_URL` bằng `inferProviderName()` (`:107-112`: chứa `generativelanguage.googleapis.com` → `gemini`, `api.groq.com` → `groq`, còn lại `openai`); giá = bảng theo model, không có thì giá `gpt-4o-mini` nếu là OpenAI, `FREE` nếu không; đọc thêm `OPENAI_RPM/RPD/TPD` (không có trong `.env.example`) và `PRICE_*_PER_M`.
- **Có tên** → vòng lặp `:159-195`, kiểm tra theo thứ tự: tên khớp `/^[a-z0-9_]+$/` → có `_API_KEY` → có `_MODEL`. Thiếu bước nào thì provider bị **bỏ qua** và lý do vào `skipped[]` → `CONFIG.providerNotes` (`:259`) → in **hai lần** lúc khởi động với hai định dạng khác nhau: `[ai]   ⚠️  bỏ qua: …` trong bảng provider (`router.ts:386`) và `   ⚠️  …` (không có chữ "bỏ qua") ở khối giới thiệu server (`server.ts:550`). App vẫn chạy với các provider còn lại.

Tiện ích đọc env (`config.ts:4-13`): `num(v, d)` rỗng / NaN → mặc định; `bool(v, d)` rỗng → mặc định, `'false' | '0' | 'no' | 'off'` → false, còn lại true; `limit(v)` số dương → `Math.floor`, còn lại `undefined` = **không giới hạn** (đặt `0` là bỏ giới hạn, không phải chặn hết).

### 2.2 Bảng `AI_<NAME>_*` (NAME = tên trong `AI_PROVIDERS` viết hoa)

| Biến | Trường `ProviderConfig` | Mặc định | Ý nghĩa / ràng buộc |
|---|---|---|---|
| `AI_<N>_API_KEY` | `apiKey` | — | Thiếu → provider bị bỏ qua (`:170`). Mọi key được che `***` trong log / lỗi / snapshot (`llm.ts:redactSecrets`) |
| `AI_<N>_MODEL` | `model` | — | Thiếu → bỏ qua (`:171`) |
| `AI_<N>_BASE_URL` | `baseUrl` | `KNOWN_BASE_URLS[name]` chỉ có cho `gemini`, `groq` (`:89-92`); còn lại `undefined` = api.openai.com | Endpoint OpenAI-compatible. Cloudflare Workers AI **bắt buộc** khai (dạng `…/accounts/<ACCOUNT_ID>/ai/v1`, xem README §3.3) |
| `AI_<N>_LABEL` | `label` | `DEFAULT_LABEL[name]` (OpenAI / Gemini / Groq / OpenRouter / Mistral / DeepSeek / Together / Cerebras / Ollama / Local / Cloudflare) hoặc viết hoa chữ đầu (`:94-99`) | Tên hiển thị trên chip AI (admin) và log |
| `AI_<N>_RPM` | `rpm` | không giới hạn | Lượt / phút **tự áp**, cửa sổ trượt 60 s (`router.ts:420-423`) |
| `AI_<N>_RPD` | `rpd` | không giới hạn | Lượt / ngày tự áp; "ngày" theo múi giờ reset của provider (mục 4.3) |
| `AI_<N>_TPD` | `tpd` | không giới hạn | Token (vào + ra) / ngày tự áp (`router.ts:536`) |
| `AI_<N>_PRICE_INPUT_PER_M`, `_PRICE_CACHED_INPUT_PER_M`, `_PRICE_OUTPUT_PER_M` | `price` | `FREE` (0/0/0) — **trừ** endpoint OpenAI chính chủ + model có trong `PRICE_TABLE` (`gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, khớp tiền tố dài nhất, `:16-28`, `:181`) | USD / 1M token. Endpoint không phải OpenAI mà trả tiền (OpenRouter…) **phải khai**, nếu không `DAILY_BUDGET_USD` không bao giờ chạm |
| `AI_<N>_REASONING_EFFORT` | `reasoningEffort` | `''` | Gửi làm `reasoning_effort` nếu thuộc `none/minimal/low/medium/high/xhigh/max/default` (`llm.ts:243`). **Bẫy:** chỉ cần đặt biến này là model bị coi là suy luận (`:179`) |
| `AI_<N>_REASONING` | `isReasoningModel` | `REASONING_MODEL_RE.test(model) \|\| reasoningEffort !== ''` với `REASONING_MODEL_RE = /^(o\d\|gpt-5\|(openai\/)?gpt-oss\|deepseek-r\|(qwen\/)?qwen3)/i` (`:102`) | `true/1` hoặc `false/0` ép. Model suy luận: `max_completion_tokens` × 3, gửi `reasoning_effort` (mặc định `low`), **không** gửi `temperature` |
| `AI_<N>_TIER` | `tier` | `normal` | `strong` = ưu tiên cho `priority: 'high'`, mọi `candidate` và `recap` (mục 4.2) |
| `AI_<N>_JSON` | `json` | `schema` | `object` = dùng thẳng `json_object` (không thử `json_schema`); `schema` = thử strict, tự hạ khi bị 400 rõ ràng (nhớ 24 giờ) |
| `AI_<N>_EXTRA_JSON` | `extraBody` | không gửi gì thêm | JSON object ghép thẳng vào body (`Object.assign`, `llm.ts:351`), vd `{"chat_template_kwargs":{"enable_thinking":false}}` tắt "suy nghĩ" của Gemma trên Cloudflare. `parseExtraBody` (`:74-87`) xoá 6 khoá `model, messages, response_format, max_tokens, max_completion_tokens, stream`; sai cú pháp → `console.warn`, bỏ qua, app không chết. **Không xoá** `temperature` / `reasoning_effort` / `prompt_cache_key` → có thể ghi đè tham số router tự đặt (tính năng lẫn bẫy) |
| `AI_<N>_MAX_OUTPUT_TOKENS` | `maxOutputTokens` | không trần | Trần cố định cho `max_completion_tokens` của provider (Groq free có OTPM theo model) |
| `AI_<N>_MAX_REQUEST_TOKENS` | `maxRequestTokens` | không giới hạn | Request ước lượng (system + user @2,7 ký tự/token + token ra xin) lớn hơn → **không gửi** tới provider này, sang provider khác (`router.ts:486-491`) |
| `AI_<N>_PACE` | `pace` | `true` | Giữ nhịp quota ngày (mục 4.4). `false` = dùng thoải mái tới hết |
| `AI_<N>_WEIGHT` | `weight` | `1`, kẹp `0.05–5` (`:193`) | Chỉ dùng khi `AI_ROUTING=balanced` |

### 2.3 Biến chung của lớp AI

| Biến | `CONFIG.*` | Mặc định | Ý nghĩa |
|---|---|---|---|
| `AI_PROVIDERS` | `providers` | rỗng → kiểu cũ | Danh sách tên theo thứ tự ưu tiên |
| `AI_ROUTING` | `aiRouting` | `priority` | `balanced` (đúng chữ, thường hoá) = xen kẽ theo quota còn lại × trọng số; mọi giá trị khác = `priority` (`:273`) |
| `DAILY_BUDGET_USD` | `dailyBudgetUsd` | `1` | Trần chi phí / ngày giờ VN, cộng mọi provider. Chạm trần: cảnh thường bị bỏ (`skipped++`), cảnh `high` dùng offline (`brain.ts:245-249`) |
| `MIN_SECONDS_BETWEEN_LLM` | `minSecondsBetweenLlm` | `20` | Khoảng cách tối thiểu (giây thật) giữa 2 lần cấp `'llm'` cho cảnh `low`; `normal` = một nửa; `high` không chờ |
| `MAX_CONCURRENT_LLM` | `maxConcurrentLlm` | `2` | Số lời gọi AI đồng thời (hàng đợi chung mọi provider, `router.ts:496`); `reserve()` từ chối cảnh thường khi đầy, `high` vẫn xếp hàng |
| `LLM_ONLY_WHEN_WATCHED` | `llmOnlyWhenWatched` | `true` | `viewers === 0` → **mọi** cảnh không gọi AI (`reserve()`: `high` → `'offline'`, còn lại `skipped++` / `null`, `brain.ts:245-249`) và `generateBeats` → offline (`brain.ts:344`); **riêng `generateCandidate` / `generateRecap` vẫn gọi AI** vì chỉ kiểm `canUseLlm()` = `llmReady() && underBudget()`, không xét `viewers` (`brain.ts:134, 316, 328`) |
| `OFFLINE_MIN_SECONDS` | `offlineMinSeconds` | `8` | Nhịp tối thiểu giữa 2 cảnh thường khi không gọi được AI |
| `COMPANY_NAME` | `companyName` | `Cty TNHH VibeCorp` | Nướng vào system prompt lúc `createBrain` |
| `DEBUG_PROMPTS` | (không qua CONFIG, đọc `process.env` trực tiếp `llm.ts:279`) | tắt | `1` → in system prompt (1 lần mỗi mã FNV-1a), user prompt và phản hồi ra terminal |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_REASONING_EFFORT`, `OPENAI_RPM/RPD/TPD`, `PRICE_*_PER_M` | gương cũ | — | Chỉ có tác dụng khi `AI_PROVIDERS` rỗng |

### 2.4 Gương tương thích cũ và công tắc tắt AI

`CONFIG.openaiKey`, `openaiBaseUrl`, `model`, `reasoningEffort`, `isReasoningModel`, `price` là **gương của provider đầu** (`config.ts:263-268`) để code / script cũ còn chạy. Quy ước quan trọng: **`openaiKey === ''` = TẮT AI hoàn toàn** — `resolveProviders()` (`router.ts:307-320`) trả `[]` khi `config.openaiKey` rỗng **dù `providers` có phần tử**. `scripts/smoke.ts:93` và `scripts/eyeball-hr.ts:38` dùng đúng cơ chế này để chạy offline không ra mạng. Chiều ngược lại: `openaiKey` có nhưng `config.providers` rỗng hoặc toàn phần tử thiếu `apiKey` / `model` → `resolveProviders()` **dựng 1 provider dự phòng** từ các gương `openaiBaseUrl` / `model` / `price` / `reasoningEffort` / `isReasoningModel` (`router.ts:314-319`; `tier: 'normal'`, `json: 'schema'`, `pace: true`, `weight: 1`, không RPM / RPD / TPD); tên suy từ `inferProviderName(openaiBaseUrl)`, nhãn qua `defaultLabel` (`router.ts:297-300`) chỉ biết `openai` / `gemini` / `groq`, tên khác viết hoa chữ đầu. Config dựng tay trong test thường đi đường này. Khi dựng config tay cho test, dùng `withProviders(base, providers)` (`:352-366`) để các gương đồng bộ; `makeProvider()` (`:334-346`) cho mặc định.

### 2.5 Bẫy cấu hình

- `pace: !bool(env[...], true) ? false : true` (`:192`) tương đương `bool(...)` — viết vòng, vô hại.
- Đặt nhầm `AI_<N>_REASONING_EFFORT` cho model thường → xin token ra gấp 3 (tốn TPD / OTPM) và mất `temperature`. Dùng `AI_<N>_REASONING=false` để ép lại.
- `.env.example` mặc định `AI_PROVIDERS=gemini,groq` và khối Cloudflare đang comment; README §3.4 minh hoạ `gemini,groq,cloudflare`. Site thật dùng 3 nguồn (theo chủ dự án).

---

## 3. Client một provider (`src/ai/llm.ts`)

### 3.1 Giao thức nội bộ

- `LlmTask = 'scene' | 'candidate' | 'recap' | 'beats'`; `JsonFormat = 'json_schema' | 'json_object'` (`:14-15`).
- `LlmRequest` (`:17-27`): `task, system (TĨNH), user (động), schemaName (^[a-zA-Z0-9_-]{1,64}$), schema, maxTokens, signal?, priority?, deadlineAt? (ms epoch giờ thật)`.
- `LlmResponse` (`:37-45`): `data` (JSON đã parse, chưa kiểm tra), `format`, `usage {promptTokens, cachedTokens, completionTokens, costUsd, estimated}`, `finishReason`, `ms`, `provider` (tên), `attempts`.
- `LlmErrorCode` (`:47-51`): `disabled` (không provider nào có key) · `unavailable` (tất cả đang nghỉ / hết lượt) · `exhausted` (thử hết trong hạn mà đều lỗi) · `aborted` · `timeout` · `empty` · `refusal` · `parse`. `LlmError.usage` mang token đã tiêu dù nội dung hỏng → router vẫn tính tiền (`:53-63`).

### 3.2 Body gửi đi — `params()` (`:328-353`)

| Trường | Giá trị | Điều kiện |
|---|---|---|
| `model` | `cfg.model` | luôn |
| `messages` | `[{role:'system', content: req.system}, {role:'user', content: req.user}]` | luôn |
| `response_format` | `{type:'json_schema', json_schema:{name: req.schemaName, strict: true, schema}}` hoặc `{type:'json_object'}` | theo `format` router chọn |
| `max_completion_tokens` (hoặc `max_tokens`) | `outputBudget(req, cfg, cap)` = `max(64, round(maxTokens × (isReasoningModel ? 3 : 1)))`, kẹp dưới `cap` nếu `cap < maxTok` (`:265-269`) | `max_tokens` chỉ khi proxy đã từ chối `max_completion_tokens` (`useMaxTokensParam`) |
| `reasoning_effort` | `cfg.reasoningEffort` hợp lệ, không thì `'low'` | chỉ model suy luận, chưa bị drop |
| `temperature` | `1` | chỉ model thường, chưa bị drop |
| `prompt_cache_key` | `vpa-<task>` | **chỉ** khi endpoint là api.openai.com (`:348`) |
| … `extraBody` | `Object.assign(p, cfg.extraBody)` | cuối cùng, ghi đè được mọi trường trừ 6 khoá đã bị `parseExtraBody` xoá |

SDK: `new OpenAI({ apiKey, baseURL, timeout, maxRetries: 0, fetch: unwrapArrayErrorFetch })` (`:316`). **`maxRetries: 0`** vì router tự failover thay vì SDK ngủ chờ. SDK không khởi tạo được → `createProviderClient` trả `null`, router cảnh báo và bỏ provider (`router.ts:360-362`).

### 3.3 `attempt()` (`:368-410`) — đúng 1 lần HTTP

1. Dựng body; nếu `DEBUG_PROMPTS=1` in system (1 lần) + user prompt.
2. `client.chat.completions.create(body, { signal, timeout: max(1 s, perCallTimeoutMs) })` bọc `raceAbort(req.signal)`.
3. Có `completion`: `measureUsage()` (`:224-241`) — không có `usage` hoặc cả prompt / completion = 0 → **ước lượng theo ký tự** (`estimateTokens` 3,5 ký tự/token, `:163-165`), `estimated: true`; `cached = min(cached, prompt)`; chi phí = `((prompt − cached) × input + cached × cached + completion × output) / 1e6`.
4. `msg.refusal` → `LlmError('refusal')`; content rỗng → `'empty'` (kèm gợi ý "Hết max_completion_tokens…" nếu `finish_reason === 'length'`); `parseJsonLoose()` (`:197-209`: bỏ BOM, bỏ fence ```json, thử `JSON.parse`, không được thì cắt từ `{` đầu tới `}` cuối) hỏng → `'parse'` ("JSON bị cắt ngang" nếu `length`). Mọi `LlmError` đều kèm `usage`.

### 3.4 Học từ lỗi 400 — `adaptTo400(e, format)` (`:412-434`), thứ tự quyết định

1. `MODEL_JSON_FAIL_RE` (`json_validate_failed|failed_generation|failed to generate json`) → `'content'` (lỗi của 1 lần sinh, không phải của provider).
2. `e.param` ∈ `{temperature, reasoning_effort, prompt_cache_key}` → bỏ tham số đó (`dropped`), `'retry'`.
3. Message nhắc tên tham số tuỳ chọn + từ `unsupported|not supported|unknown|invalid|unrecognized|không` → drop + `'retry'`.
4. Nhắc `max_completion_tokens` → `useMaxTokensParam = true`, `'retry'`.
5. Chữ `api key|api_key|apikey|unauthorized|authentication` → `null` (router phạt như sai key).
6. Đang `json_schema` và (`param === 'response_format'` hoặc `SCHEMA_REJECT_RE` = `response_format|json_schema|json schema|\bschema\b|strict|structured output`) → `'json_object'`.
7. Còn lại `null` → router phạt "request bị từ chối", giữ định dạng.

**Trạng thái học (`dropped`, `useMaxTokensParam`) chỉ nằm trong bộ nhớ tiến trình (`:325-326`), không vào snapshot** — khác `jsonObjectUntil` / `maxOutputTokens` của router. Sau khởi động lại, lần gọi đầu có thể 400 một lần rồi tự thích nghi.

### 3.5 Tiện ích dùng chung

- `unwrapArrayErrorFetch` (`:294-309`): endpoint OpenAI-compatible của Gemini trả lỗi dạng **mảng** `[{"error":{…}}]`; SDK chỉ đọc `body.error` nên mất message. Hàm bọc `fetch`: status ≥ 400 → parse body, nếu là mảng có phần tử đầu chứa `error` → thay body bằng phần tử đó, xoá `content-length` / `content-encoding`. Nhờ vậy router nhận ra "API key not valid" / "quota exceeded" của Gemini.
- `redactSecrets(s, keys)` (`:68-84`): thay nguyên văn mọi key ≥ 6 ký tự bằng `***`, rồi mẫu chung `sk-…`, `gsk_…`, `AIza…`, `AQ.…`, `cfut_…`, `Bearer …`, `api_key=…`, `?key=…`, `x-goog-api-key`. Router truyền `keys` = mọi apiKey (`router.ts:334`). Thêm provider có tiền tố key mới → thêm mẫu ở đây.
- Múi giờ (`:86-160`): `VN_TZ = 'Asia/Ho_Chi_Minh'`, `PACIFIC_TZ = 'America/Los_Angeles'`, `FIXED_OFFSET_MIN` dự phòng (+420 / −480 phút) khi `Intl` không hỗ trợ; `dateKeyIn(tz)` → `YYYY-MM-DD`; `nextMidnightIn(tz, nowMs)` lặp 1 lần để đúng ngày đổi DST; `localTimeLabel()` → `HH:MM` giờ VN (đóng dấu `lastError`, mốc hết cooldown).
- `describeError(e, keys)` (`:168-194`): tiếng Việt theo loại lỗi SDK, gợi ý theo status (401 / 403 / 404 / 429 / 400 / 5xx), che key, cắt 220 ký tự.

**Hai hàm `estimateTokens` khác hệ số:** `llm.ts:163` (3,5 ký tự/token — cho `measureUsage` khi server không trả usage và log debug) và `prompt-budget.ts:13` (2,7 — cho `fits()` của router và ngân sách prompt). Đừng nhầm khi sửa.

---

## 4. Router (`src/ai/router.ts`)

### 4.1 Hằng số chính sách `ROUTER_POLICY` (`:30-54`)

| Khoá | Giá trị | Ý nghĩa |
|---|---|---|
| `providerTimeoutMs` | 20 000 | 1 lượt HTTP tối đa (test rút ngắn qua `RouterOptions.providerTimeoutMs`) |
| `minAttemptMs` / `minAttemptReasoningMs` | 2 500 / 6 000 | Còn ít hơn tới hạn chót → không mở lượt mới (model suy luận cần cửa sổ rộng hơn) |
| `maxAttempts` | 3 | Số lượt HTTP tối đa / request (kể cả thử lại cùng provider) |
| `defaultDeadlineMs` | 25 000 | Khi request không ghi `deadlineAt` |
| `rateBackoffBaseMs` | 30 000 | 429 không Retry-After: 30 s → 60 → 120 … |
| `serverBackoffBaseMs` | 20 000 | 5xx / mạng / timeout / 400 khác: 20 s → 40 → 80 … |
| `backoffMaxMs` | 15 phút | Trần lùi dần |
| `retryAfterMaxMs` | 6 giờ | Kẹp Retry-After vớ vẩn; cũng là nhịp dò tối đa khi chờ 0h Pacific |
| `dailyProbeMs` | 1 giờ | Hết quota ngày, không biết giờ reset, không gợi ý → dò lại |
| `dailyHintTrustMs` | 10 phút | Gemini kèm "retry in 27s" dù hết quota NGÀY → gợi ý < 10 phút không tin |
| `authDisableMs` | 1 giờ | 401 / 403 / 404 |
| `jsonObjectRememberMs` | 24 giờ | Nhớ `json_object` |
| `cooldownRestoreMaxMs` | 36 giờ | Khôi phục cooldown xa hơn → coi là rác |
| `outputCapRememberMs` | 7 ngày | Nhớ trần `max_completion_tokens` học từ "Request too large" |
| `outputCapMargin` | 0.9 | Trần = 90 % Limit máy chủ báo |
| `minOutputTokens` | 256 | Trần nhỏ hơn → bỏ provider cho request này |
| `maxCapRetries` | 2 | Hạ trần rồi thử lại tối đa 2 lần / provider / request |
| `paceBurst` / `paceMinBurstReq` / `paceMinBurstTok` | 0.25 / 30 / 30 000 | Phần "bung" đầu ngày quota |
| `paceRecheckMs` | 60 000 | Đang giữ nhịp → xem lại sau ≥ 1 phút |

`QUOTA_RESET_TZ = { gemini: PACIFIC_TZ }` (`:57`); `quotaResetTz(cfg)` theo `name`, rồi theo `inferProviderName(baseUrl)`, còn lại `VN_TZ` (`:60-62`) → provider đặt tên khác nhưng `BASE_URL` Google vẫn được coi là Gemini. `hasKnownQuotaReset(cfg)` = tz ≠ VN.

### 4.2 Thứ tự thử — `order(task, priority)` (`:478-483`)

```
strongFirst = priority === 'high' || (task !== 'scene' && task !== 'beats')
base        = aiRouting === 'balanced' ? balancedOrder(runtimes) : runtimes   // thứ tự cấu hình
kết quả     = strongFirst && có provider strong ? [strong theo base…, còn lại theo base…] : base
```

- `candidate` và `recap` **luôn** đi tier strong trước (Brain gọi với priority `'high'`); `scene` chỉ khi `priority === 'high'`; `beats` **không bao giờ** ưu tiên strong.
- **Balanced** (`:463-475`): `headroom(r) = max(0, min(1 − rpdUsed/rpd, 1 − tpdUsed/tpd))` (không khai = 1); điểm = `(headroom + 0.05) × weight × (0.5 + rand())`, sort giảm dần, **hoà theo thứ tự cấu hình**. `balancedOrder` áp cho **mọi task** (kể cả candidate / recap / beats), chỉ khác là nhóm strong vẫn được đưa lên đầu — README §3.5 nói "cảnh thường" là nói gọn.
- `complete()` lấy phần tử đầu của `order()` chưa `tried` và `available` (`:645`).

### 4.3 Vì sao provider chưa gọi được — `blocked(r, t)` (`:410-429`), thứ tự kiểm tra

1. `client === null` → "không khởi tạo được client".
2. `rollDay(r, t)` (`:391-400`): `dayKey` theo **múi giờ reset của provider** đổi → reset `rpdUsed, tpdUsed, costToday, rpmTimes`. Gemini đếm theo ngày Pacific (reset 0h Pacific = 14h PDT / 15h PST giờ VN), còn lại ngày VN.
3. `t < cooldownUntil` → lý do cooldown.
4. `rpdUsed ≥ rpd` → "hết lượt gọi hôm nay (a/b RPD)", `until = nextReset`.
5. `tpdUsed ≥ tpd` → "hết token hôm nay", `until = nextReset`.
6. `rpm`: `pruneRpm` cửa sổ trượt 60 s; `rpmTimes.length ≥ rpm` → "đủ N lượt/phút, chờ nhịp", `until = rpmTimes[0] + 60 s`.
7. `cfg.pace` → `paceBlock()` (mục 4.4).

`available(r) = blocked(r) === null`. **Lưu ý:** `blocked()` được gọi rất nhiều (`stats()` mỗi status, `anyAvailable()` mỗi `reserve`) và **có tác dụng phụ** `rollDay` — an toàn nhưng cần nhớ khi refactor.

### 4.4 Giữ nhịp quota ngày — `paceBlock(r, t)` (`:437-458`)

Vì sao: trước đây Gemini (500 lượt/ngày) bị xài sạch trong vài giờ đầu rồi chờ tới 0h Pacific. Công thức, áp cho RPD trước rồi TPD:

```
end   = nextReset(cfg, t)            start = end − 24h            frac = clamp((t − start) / 24h, 0, 1)
burst = max(minBurst, limit × 0.25)  // minBurst = 30 lượt hoặc 30 000 token
allowance = min(limit, burst + limit × frac)
used ≥ allowance → chặn với until = clamp(start + (used + 1 − burst) / limit × 24h, t + 60 s, end)
lý do: "giữ nhịp cho đủ cả ngày (đã dùng a/b …), mở lại dần"
```

Ví dụ Gemini `RPD=500`: bung 125 lượt đầu ngày quota, sau đó mở ≈ 20,8 lượt / giờ. Groq `TPD=200000`: bung 50 000 token rồi ≈ 8 333 token / giờ (≈ 2 cảnh / giờ) — hệ quả tính từ công thức, chưa đo thật; cộng `AI_GROQ_WEIGHT=0.35` nên Groq chủ yếu gánh khi Gemini đang giữ nhịp. Provider đang giữ nhịp hiện trên chip AI như "nghỉ" với `cooldownReason` chứa "giữ nhịp"; test `scripts/test-router.ts` mục 13 kiểm: 01:00 nhận ~35 lượt (100 RPD) rồi chặn, 13:00 mở lại (≈ 84).

Bẫy: `start = end − 24h` → ngày Pacific đổi giờ DST dài 23 / 25 giờ lệch 1 giờ (chấp nhận).

### 4.5 Phân loại lỗi và hình phạt — `classifyError` (`:159-189`) + `penalize` (`:548-599`)

| Lỗi | `ErrKind` | Hình phạt (cooldown riêng provider) |
|---|---|---|
| 429 có `tooLarge` ("Request too large…", `TOO_LARGE_RE` `:88`) | `rate` | **Không phạt**; `complete()` hạ trần token ra (mục 4.6) |
| 429 quota **ngày** (`isDailyQuota` `:150-157`: có `per day|daily|RPD|TPD|…` mà không có `per minute|RPM|TPM|…`; hoặc `quota exceeded|resource_exhausted|insufficient_quota|billing|…` chung chung mà gợi ý chờ ≥ 10 phút / không có) | `rate`, `daily` | Có gợi ý (header `retry-after-ms` / `retry-after` giây hoặc HTTP-date, hoặc "retry in 32s" / "try again in 1m2s" / `retryDelay` trong message, `:129-144`) và không phải (provider biết giờ reset && gợi ý < 10 phút) → nghỉ theo gợi ý kẹp [1 s, 6 h] (Groq báo chính xác). Biết giờ reset (Gemini) → nghỉ `min(reset − t, 6 h)`, lý do "reset lúc 0h giờ Pacific (HH:MM giờ VN)". Còn lại → 1 giờ rồi dò |
| 429 thường | `rate` | Có gợi ý → nghỉ theo gợi ý, `backoffRate++`; không → `min(30 s × 2^backoffRate, 15 phút)`, `backoffRate++` |
| 401 | `auth` | 1 giờ, lý do "API key sai hoặc hết hạn — kiểm tra `AI_<NAME>_API_KEY` trong .env" |
| 403 | `forbidden` | 1 giờ, "kiểm tra key hoặc `AI_<NAME>_MODEL`" |
| 404 | `notfound` | 1 giờ, "kiểm tra `AI_<NAME>_MODEL` / `AI_<NAME>_BASE_URL`" |
| 400 / 422 khớp `KEY_INVALID_RE` (`valid api key|incorrect api key|invalid_api_key|api_key_invalid|…`, Gemini trả 400 cho sai key) | `auth` | như 401 |
| 400 / 422 khác | `bad_request` | 400 → qua `adaptTo400` trước (mục 3.4); 422 **bỏ qua bước học** (`llm.ts:413` chỉ nhận `status === 400`) → phạt thẳng. Không học được gì → `min(20 s × 2^backoffServer, 15 phút)`, `backoffServer++` |
| ≥ 500 | `server` | 20 s lùi dần như trên |
| `APIConnectionError`, `fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network` | `network` | 20 s lùi dần |
| `APIConnectionTimeoutError`, `LlmError('timeout')` | `timeout` | 20 s lùi dần — **trừ** khi cửa sổ lượt gọi bị hạn chót của Brain cắt ngắn (`truncated`) → chỉ ghi note, không phạt |
| `LlmError('aborted')`, `APIUserAbortError` | `aborted` | Không phạt; `complete()` **throw ngay** (Brain đã hết hạn) |
| `LlmError` khác (`empty`, `refusal`, `parse`) | `content` | Không phạt (lỗi nội dung 1 lần sinh) |

`cool(r, ms, reason, t)` (`:539-544`) chỉ **kéo dài** cooldown (không rút ngắn, `:541`) nhưng **luôn ghi đè `cooldownReason`** (`:542`) → lý do hiện trên chip AI / `stats()` có thể là của lỗi SAU (nghỉ ngắn hơn) trong khi mốc hết nghỉ vẫn là của lỗi TRƯỚC (vd 401 nghỉ 1 giờ rồi 500 → chip ghi lý do 500 nhưng vẫn nghỉ tới hết 1 giờ). Log `[ai] <label> (<model>): <reason> → tạm nghỉ <N giây|phút|giờ> (tới HH:MM)`. `onSuccess` reset cả hai backoff và đặt `lastOk`.

### 4.6 Request quá lớn, trần token ra, trần token mỗi request

- **Trần token ra gửi đi** cho lượt gọi: `cap = min(learned, fixed)` với `learned = r.maxOutputTokens` (còn hạn `maxOutputUntil`) và `fixed = AI_<N>_MAX_OUTPUT_TOKENS` (`:660-663`) → `outputBudget(req, cfg, cap)`.
- **"Request too large"** (Groq: `… on output tokens per minute (OTPM): Limit 1000, Requested 1436 …` hoặc `… tokens per minute (TPM): Limit 6000, Requested 6373 …`): `parseTooLarge` (`:97-105`) đọc `Limit L, (Used U,) Requested R` và `output` = khớp `output tokens|OTPM|max_tokens|expected output|completion tokens`. `shrinkOutputCap(used, tl)` (`:607-614`): OTPM → `L × 0.9`; TPM với `R > L` → `used − (R − L) − L × 0.1`; không đọc được → `used / 2`; nếu vẫn ≥ used → `used × 0.75`; floor ≥ 0. Nếu `cap ≥ 256 && cap < used && số lần hạ < 2` → lưu `r.maxOutputTokens/maxOutputUntil (+7 ngày)`, cảnh báo "máy chủ giới hạn token ra mỗi phút (OTPM L) → từ nay max_completion_tokens ≤ cap…", **thử lại ngay cùng provider** (tốn thêm 1 `attempts` và 1 lượt RPD tự áp vì `recordAttempt` chạy trước HTTP). Không đủ chỗ → ghi note, sang provider khác, **không phạt**.
- **`fits(r, req, cap)`** (`:486-491`): `est = estimateTokens(system) + estimateTokens(user) + outputBudget(...)` (hệ số 2,7) so với `maxRequestTokens`; không vừa → note "request ~N token vượt trần …, không gửi", sang provider khác (test-router mục 13 kiểm request 4 000 ký tự không tới Alpha `MAX_REQUEST_TOKENS=200`).

### 4.7 `json_schema` → `json_object`, `extraBody`

`formatFor(r, t) = t < r.jsonObjectUntil ? 'json_object' : 'json_schema'` (`:493`). `AI_<N>_JSON=object` → `jsonObjectUntil = +∞` từ lúc khởi tạo (`:352`). Khi `adaptTo400` trả `'json_object'` → `jsonObjectUntil = t + 24 h`, cảnh báo "không nhận json_schema → dùng json_object (nhớ 24 giờ)", thử lại ngay cùng provider (`:711-716`). **Mọi lần thử lại cùng provider** (`'retry'` bỏ tham số `:707-710`, `'json_object'`, hạ trần token mục 4.6) đều là một vòng `continue` quay về đầu `while` nên tốn thêm 1 `attempts` (trần `maxAttempts = 3`) và 1 `recordAttempt` (RPD / RPM tự áp) vì `attempts++` / `recordAttempt` nằm ở đầu mỗi vòng, trước HTTP (`:671-672`) — một request có thể hết 3 lượt trên cùng một provider mà chưa sang provider khác. Với `json_object`, model chỉ được bảo "trả JSON" — vì vậy system prompt phải chứa mẫu `SCENE_JSON` và chữ "JSON" (Groq yêu cầu), còn `sanitize.ts` phải chịu được JSON sai shape. `extraBody` đi thẳng vào body ở `llm.ts:351` (test-router mục 13 kiểm `chat_template_kwargs.enable_thinking=false` xuất hiện trong body).

### 4.8 `complete(req)` (`:629-742`) — vòng lặp failover

1. Không runtime → `LlmError('disabled')`; `signal` đã huỷ → `'aborted'`; `await acquire(signal)` (hàng đợi đồng thời, mục 4.9).
2. `deadlineAt = req.deadlineAt` hoặc `Date.now() + 25 s`; `tried: Set`, `capRetries: Map`, `notes[]`, `attempts = 0`.
3. `while (attempts < 3)`: chọn `r` đầu tiên của `order()` chưa `tried` và `available`; không có → thoát. `remaining = deadlineAt − Date.now()`; `< minAttempt` (2,5 s / 6 s model suy luận) → `outOfTime`, `tried.add`, **tiếp tục** (provider nhẹ khác có thể kịp). `perCall = min(providerTimeoutMs, remaining − 300)`, `truncated = perCall < providerTimeoutMs`. Tính `cap`, `fits()` sai → note, `tried.add`, continue. `attempts++`, `recordAttempt` (`:525-530`: `calls++`, `rpdUsed++`, đẩy `rpmTimes` — **trước khi gửi**, lượt lỗi vẫn tính RPD / RPM tự áp, SPEC §6.2), gọi `r.client.attempt(req, format, perCall, limits)`.
4. Thành công → `account()` (`:531-538`: cộng token, `tpdUsed += prompt + completion`, chi phí chỉ khi > 0), `onSuccess`, trả `{...res, provider: r.cfg.name, attempts}`.
5. Lỗi → `account(e.usage)` nếu có, `r.failures++`, `classifyError`: `aborted` → throw ngay; `rate + tooLarge` → mục 4.6; `bad_request` → `adaptTo400` (chỉ 400; 422 → `null`): `'retry'` (bỏ tham số, cùng provider), `'json_object'` (cùng provider) — hai nhánh này `continue` nên tốn `attempts` + `recordAttempt` như mục 4.6 / 4.7 —, `'content'` (đổi `shown` thành `LlmError('parse', 'Model trả JSON không khớp schema…')`, không phạt); còn lại: `timeout && truncated` → chỉ note "(cửa sổ chỉ còn N s, không phạt)"; khác → `penalize`. `r.lastError = "[HH:MM] <lỗi ≤ 110 ký tự>"`, `tried.add(r)`.
6. Hết vòng: `attempts === 0` → `outOfTime ? LlmError('timeout', 'Hết thời gian trước khi gọi AI (…)') : LlmError('unavailable', 'Không có nhà cung cấp AI nào sẵn sàng — <label: lý do (tới HH:MM)>; …')`; còn lại `LlmError('exhausted', notes.join(' · '))`. `finally release()`.

### 4.9 Hàng đợi đồng thời (`:496-522`)

`maxConc = max(1, floor(config.maxConcurrentLlm))`, chung mọi provider. `acquire(signal)` chờ được huỷ qua `signal` → `LlmError('aborted', 'Quá thời gian khi đang xếp hàng chờ gọi AI')`. `inflight() = running + waiters.length` — Brain dùng trong `reserve()`.

### 4.10 Thống kê, lưu, khôi phục

- `stats()` (`:759-787`): mỗi provider → `ProviderStats` (`types.ts:359-377`) với `enabled = blocked === null`, `cooldownUntil = blocked.until` và `cooldownReason` — **bao gồm cả lý do RPD / TPD / RPM / giữ nhịp**, không chỉ cooldown lỗi; `format`, `lastError`. `active` = `lastOk` nếu còn available, không thì provider available đầu tiên, không thì `lastOk`, không thì `runtimes[0]`; `activeModel` fallback `config.model`; `anyAvailable`.
- `serialize()` (`:790-808`) → `RouterSnapshot { v: 2, date (ngày VN), carry, providers: { <name>: ProviderSnapshot } }`. Mỗi `ProviderSnapshot`: `calls, failures, inputTokens, cachedTokens, outputTokens, costTodayUsd, costTotalUsd, rpdUsed, tpdUsed, day (ngày theo múi giờ reset của provider), cooldownUntil/Reason (chỉ khi còn hiệu lực), jsonObjectUntil (∞ → 0; dựng lại từ cfg.json khi khởi động), backoffRate, backoffServer, lastError?, maxOutputTokens/maxOutputUntil? (chỉ khi còn hạn)`.
- `restore(data)` (`:829-876`): provider không còn trong cấu hình hoặc bản v1 → `foldIntoCarry` (gộp vào tổng để số không tụt); `providerSameDay = raw.day === r.day` (bản mới) hoặc ngày VN chung (bản cũ) → khôi phục `rpdUsed/tpdUsed/costToday`, khác ngày → 0; cooldown chỉ nhận khi `≤ 36 h`; `jsonObjectUntil` chỉ khi `cfg.json !== 'object'` và `≤ 24 h`; `maxOutputTokens ≥ 256 && còn hạn ≤ 7 ngày`; backoff kẹp ≤ 20; `lastError` qua `describeError` (che key lần nữa).

### 4.11 Log

Mọi dòng có tiền tố `[ai]`, tiếng Việt, đã che key: bảng provider lúc khởi động (giới hạn, giá, tier, `json_object`, "giữ nhịp quota ngày", `≤ N token ra`, `≤ N token/request`, `trọng số w` khi balanced và w ≠ 1, "quota ngày reset 0h Pacific (HH:MM giờ VN)"), cảnh báo cooldown / trần token / `json_object` / bỏ tham số, `[ai:debug]` khi `DEBUG_PROMPTS=1`. Brain gộp cảnh báo lỗi tối đa 1 lần / 30 s với "(+N lỗi tương tự đã ẩn)" (`brain.ts:136-145`).

---

## 5. Brain (`src/ai/brain.ts`)

### 5.1 Hằng số (`:32-58`)

| Hằng | Giá trị | Ghi chú |
|---|---|---|
| `DEADLINE_MS` | `scene 27 000 · candidate 30 000 · recap 45 000 · beats 20 000` | Hạn chót **toàn phần** (xếp hàng + HTTP + failover). Director huỷ cảnh chờ thoại quá `RESULT_TIMEOUT_MS = 35 000` (`director.ts:51`) → biên 8 s; ứng viên có `CANDIDATE_TIMEOUT_MS = 40 000` (`director.ts:52`). **Đổi một bên phải đổi bên kia** |
| `MAX_TOKENS` | `scene 1300 · candidate 700 · recap 800 · beats 450` | Là TRẦN `max_completion_tokens` cho model thường (× 3 với model suy luận), không phải chi phí; cảnh 10 câu + hiệu ứng khi model viết JSON xuống dòng tốn ~1 000 token |
| `BREAKER_AFTER / BASE / MAX` | 3 / 60 000 / 600 000 | Cầu dao: sau 3 **request** thất bại liên tiếp (mọi provider đều lỗi) nghỉ `min(60 s × 2^(n−3), 10 phút)` |
| `DESK_TAGS` | `Record<RoleKey, string[]>` | Tag sản phẩm cho món đồ trên bàn người mới; **ghép cứng** với `tags` trong `data/products.json`. `pickProduct()` chọn món khớp nhiều tag nhất, không khớp tag nào thì random (`src/content/products.ts:172-185`) — tag không tồn tại (hiện `so-tay`, `ke-hoach`, `ca-phe`, `den`, `sach`, `hoc`, `trang-tri`, `cay-xanh` không có trong 18 sản phẩm của products.json) chỉ là **no-op** khi chấm điểm, không lỗi; mỗi vai vẫn còn 2–3 tag thật nên món vẫn chọn theo tag, chỉ kém đa dạng hơn ý định ban đầu (mục Câu hỏi còn mở) |

### 5.2 Vị từ (`:129-134`) — hai nghĩa của "llm"

- `mode()` = `router.enabled` (có ít nhất 1 client) → `'llm' | 'offline'`. Director dùng trong `llmGated()` (`director.ts:641-650`) cùng `usage().costTodayUsd ≥ budgetUsd`.
- `llmReady()` = `enabled && !breakerOpen() && router.anyAvailable()` — gọi được **ngay bây giờ**.
- `underBudget()` = `router.costToday() < dailyBudgetUsd`; `canUseLlm()` = `llmReady() && underBudget()`.
- `usage().mode = llmReady() ? 'llm' : 'offline'` (`:358`) — **khác `mode()`**: chip AI / chấm xanh-xám phản ánh "gọi được ngay".

### 5.3 `reserve(priority)` (`:235-260`) — thứ tự quyết định

1. `!llmReady()` → nhịp offline: `high` hoặc đã ≥ `offlineMinSeconds` từ `lastOfflineAt` → `'offline'`, không thì `null`.
2. `!underBudget()` hoặc (`llmOnlyWhenWatched && viewers === 0`) → `high` → `'offline'`; khác → `skipped++`, `null`.
3. `router.inflight() ≥ max(1, maxConcurrentLlm)` → `high` → `'llm'` (xếp hàng, vẫn ghi `lastLlmAt`); khác → `null`.
4. `low` cần ≥ `minSecondsBetweenLlm` (20 s) từ `lastLlmAt`; `normal` cần ≥ nửa (10 s); `high` luôn qua. Cấp → `lastLlmAt = now`, `'llm'`.

Chặn vì nhịp **không** tính `skipped` (chỉ bước 2 tính). Ngân sách ngày chỉ được kiểm ở bước 2 (và trong `canUseLlm()` của candidate / recap / beats); sau `reserve()`, `generateScene` (`:304`) **chỉ kiểm lại `llmReady()`, không kiểm lại `underBudget()`** → cảnh `high` được cấp `'llm'` ở bước 3 khi hàng đợi đầy (`:250-253`) có thể gọi AI dù ngân sách vừa chạm trần trong lúc chờ slot (router không chặn theo chi phí — `blocked()` mục 4.3 không xét `costToday`). Lỗ hổng nhỏ, chỉ có nghĩa với provider trả tiền. Priority của từng loại cảnh do `SCENE_DEFS` quy định (`src/sim/scenes.ts:88-211`): `low` = pantry_chat, desk_visit, gossip, group_chat, company_chat, pingpong_match, showroom_chat; `normal` = standup, lunch, boss_call, celebration, confront, welcome, news_chat, raise_request; `high` = boss_catch, hr_warning, firing, interview, incident, hr_review, resign_talk, promotion, layoff.

### 5.4 `runLlm()` và các `generate*` (`:263-352`)

`runLlm(task, priority, buildUser, schemaName, schema, accept, systemText = system)`: dựng user prompt (lỗi → `noteFailure(false)`, null) → `deadlineAt = Date.now() + deadline(task)` → `withDeadline(ms, label, signal => router.complete({ task, system, user, schemaName, schema, maxTokens: MAX_TOKENS[task], signal, priority, deadlineAt }))` → thành công `noteApiOk()`; lỗi → `noteFailure(task, e, apiLevel = true)`, null → `accept(data)`; `!ok` → `noteFailure("Kết quả AI không dùng được: <reason>", false)`, null.

`withDeadline` (`:61-83`): `AbortController` + `setTimeout(unref)`; quá hạn → `ac.abort()` và reject `LlmError('timeout', 'Quá N giây chưa có kết quả (label)')`; luôn gắn handler để promise bị bỏ rơi không thành unhandled rejection.

| Hàm | Cổng vào AI | Priority | Sanitizer | Đường lui |
|---|---|---|---|---|
| `generateScene(req, ctx, via)` | `via === 'llm' && llmReady()` (`:304` — kiểm lại vì provider có thể vừa hết lượt sau `reserve`; **không** kiểm lại `underBudget()`, xem 5.3) | `req.priority ?? 'normal'` | `sanitizeScene` | `offlineSceneSafe` → `emergencyScene` |
| `generateCandidate` | `canUseLlm()` | `'high'` (→ tier strong) | `sanitizeCandidate(d, req, ctx, depsFor(ctx))` | `offlineCandidateSafe` (ép `role/roleLabel/deskId/kpiTarget` từ request) → `emergencyCandidate` |
| `generateRecap` | `canUseLlm()` | `'high'` | `sanitizeRecap` | `offlineRecapSafe` → `emergencyRecap` |
| `generateBeats` | `canUseLlm() && !(llmOnlyWhenWatched && viewers === 0)` | `'normal'`, system riêng `beatsSystem` | `sanitizeBeats` | `offlineBeatsSafe` → `emergencyBeats()` (không biến) |

`generateBeats` **không qua `reserve()`** — Director gọi mỗi ~2 giờ game (`director.ts:3626-3659`) nhưng vẫn tôn trọng ngân sách và "không ai xem". `depsFor(ctx)` (`:182-192`) cấp `LOOK_POOL` và `pickDeskItem(role)` tránh trùng `deskItemProductId` đang dùng. Mọi `generate*` bọc `try/catch` ngoài cùng → `emergency*`; **Brain không bao giờ throw** (hợp đồng `types.ts:518`).

### 5.5 Ghi nhận lỗi, cầu dao

`noteFailure(task, err, apiLevel)` (`:153-167`): `failures++`; `lastError = "[HH:MM] <Cảnh|Ứng viên|Bản tin|Biên kịch>: <describeError>"`; chỉ `apiLevel = true` (cả request thất bại: `unavailable`, `exhausted`, `timeout`…) mới `consecutive++` và mở cầu dao khi ≥ 3. Lỗi dựng prompt / sanitize → `apiLevel = false`, không mở cầu dao. **Một provider hỏng không bao giờ làm cả hệ dừng** (test-router mục 8). `failures` đếm cả lỗi nội dung; `skipped` chỉ đếm bỏ vì ngân sách / không ai xem. (`:155` có ternary thừa — hai nhánh giống nhau.)

### 5.6 `usage()`, `serialize()`, `restore()`

`usage()` (`:354-373`) → `UsageStats` (`types.ts:379-396`): `mode` (gọi được ngay), `model = activeModel || config.model`, tổng `calls/inputTokens/cachedTokens/outputTokens/costTodayUsd/costTotalUsd` từ router, `failures/skipped` của Brain, `budgetUsd`, `lastError?`, `activeProvider?` (label), `providers?`. `serialize() = { v: 2, router: router.serialize(), failures, skipped }`; `restore()` nhận cả v2 (`data.router`) và v1 (số liệu ở gốc), dữ liệu rác → bỏ qua.

---

## 6. Prompts (`src/ai/prompts.ts`, `src/ai/prompt-budget.ts`)

### 6.1 Nguyên tắc và kích cỡ đo được

- `buildSystemPrompt(companyName, info)` **tĩnh cho cả tiến trình** → prompt cache (OpenAI đặt schema + system vào prefix cache; Gemini / Groq / Cloudflare có cache hay không — cần kiểm tra). Chỉ chứa luật chung của CẢNH + mẫu JSON cảnh; luật theo tình huống (kênh, tin đồn, sản phẩm, verdict, hồ sơ HR, mẫu JSON ứng viên / bản tin) nằm ở user prompt, **không lặp**.
- Đo ngày 2026-11-02 bằng script offline (import `prompts.ts`, `schemas.ts`, `prompt-budget.ts` với `COMPANY_INFO` hiện tại): system **4 359 ký tự, 13 dòng ≈ 1 615 token @2,7 / 1 246 @3,5**; chú thích `prompts.ts:4` và `scripts/test-llm.ts:748-749` ghi đo thật trên Gemini ≈ 1 300 token — **số đo cũ**: hệ số 0,85 ở `test-llm.ts:750` được tính lúc ước lượng system ≈ 1 530 token (1 300 / 1 530 ≈ 0,85); system hiện tại ước lượng 1 615 @2,7 → nếu số đo thật vẫn là 1 300 thì hệ số phải ≈ 0,80, còn nếu system đã dài theo thì "≈ 1 300" cũng không còn đúng. Cần đo lại trên provider thật rồi cập nhật cả hai chú thích (mục Câu hỏi còn mở). `buildBeatsSystemPrompt` 740 ký tự ≈ 275 @2,7. `SCENE_SCHEMA` stringify 2 830 ký tự (≈ 809–1 049 token), `CANDIDATE_SCHEMA` 1 695, `BEATS_SCHEMA` 666, `RECAP_SCHEMA` 560.
- File **thuần**: không import module nội dung; Brain truyền `COMPANY_INFO` qua `CompanyInfoLike` (`:16-21`), thiếu thì `FALLBACK_COMPANY` (`:56-61`). Dòng CÔNG TY bỏ "<tên> là " ở đầu mô tả bằng `/^[^.]{0,40}?\blà\s+/u` (`:85`) — đã kiểm với `COMPANY_INFO` hiện tại cho ra "… — công ty công nghệ khoảng 10 người…"; lưu ý nó cũng cắt mọi chữ trước chữ "là" đầu tiên trong 40 ký tự đầu.

### 6.2 System prompt cảnh — 13 dòng (`:89-103`)

1. Vai: biên kịch "Văn Phòng Ảo", sitcom văn phòng phát trực tiếp về nhân viên `<name>`; nhân vật không biết mình là AI.
2. `CÔNG TY: <name ≤60> — "<tagline ≤80>" — <description ≤300 cắt cuối câu>. Văn hoá: <culture ≤110>.`
3. Quy ước nhiệm vụ "NHIỆM VỤ: CẢNH / ỨNG VIÊN / BẢN TIN"; trả đúng MỘT object JSON; tiếng Việt có dấu (trừ teencode cố ý trong nhóm chat). *(Không liệt kê "BIẾN" vì beats dùng system riêng.)*
4. (trống) 5. `LUẬT CẢNH`.
6. Giọng: văn nói Sài Gòn (nha, nè, hen, hông…), câu ≤ 25 chữ, 1–2 câu / lượt, câu cửa miệng ≤ 1 lần / cảnh, đừng câu nào cũng "Ê", "Ủa".
7. Xưng hô: theo mục XƯNG HÔ, cấm "tôi – bạn", sếp gọi "em", nhân viên "dạ"; slang Gen Z chỉ ≤ 25 tuổi.
8. Hài sitcom + cấm: tình dục, miệt thị, chính trị, người nổi tiếng thật, bôi xấu thương hiệu thật (nhắc Zalo / TikTok / Shopee / Grab bình thường), giảng đạo lý, câu sáo.
9. Dựng cảnh: móc → căng → chốt; không lời dẫn, không "(cười)", không "Tên:"; chỉ nhắc đồng nghiệp có tên trong yêu cầu; ≥ 2 người thì ai cũng nói ≥ 1 câu.
10. Hiệu ứng + biên số: `relationshipChanges −15..15`, `moodChanges −15..15`, `memories ≤ 100 ký tự`, `kpiChanges −25..25`.
11. `NEWS_RULES_SHORT` (`:72-73`, 189 ký tự).
12. `JSON CẢNH (viết gọn trên 1 dòng…): ${SCENE_JSON}` (`:64-66`, có chữ "JSON" vì Groq `json_object` cần).
13. `speaker` = id trong `[ ]`; `emote` ≈ 1/3 số câu; `summary` ≤ 120 ký tự ngôi thứ ba.

### 6.3 User prompt CẢNH — `buildSceneUserPrompt(req, ctx)` (`:401-525`)

`n = participants.length` → `fitSceneBudget(n, lim => renderScene(req, ctx, lim))` (mục 6.8). Thứ tự dòng của `renderScene`:

| # | Dòng | Nguồn / điều kiện |
|---|---|---|
| 1 | `NHIỆM VỤ: CẢNH` | |
| 2 | `Loại: <type> — <SCENE_DIRECTION[type]>` | `{A}`/`{B}` thay bằng tên: desk_visit A ghé bàn B; confront A bị đồn, B tung tin; `SUBJECT_IS_EMPLOYEE` (resign_talk, raise_request, promotion, layoff) A = nhân viên (`aboutId` hoặc người đầu không phải sếp / HR) (`:417-426`). 24 định hướng ở `:109-135` |
| 3 | `Kênh: <CHANNEL_STYLE[channel]> · Nơi: <locationLabel ≤60>` | Chỉ gửi kênh đang dùng: office / group (Zalo kín không sếp, viết tắt, "=)))") / company (có sếp, "Dạ", nịnh) (`:145-149`) |
| 4 | `Lúc: HH:MM <weekday>, ngày N (<partOfDay>) · Sếp: VẮNG\|có mặt — <bossNote ≤60 \| "đang trong cảnh này">` | `partOfDay` mốc 510 / 690 / 795 / 900 / 1020 / 1110 phút (`:180-188`) |
| 5 | `Công ty: <projectLine>` | dự án (tên ≤50, khách ≤36, mô tả ≤60, % xong, hạn: còn N ngày / ngày mai / HÔM NAY / TRỄ HẠN), doanh thu tháng, số dự án đã giao, SỰ CỐ server / wifi (`:381-397`) |
| 6 | `Tình huống: <cutSentence(situation, lim.situation)>` | Director viết ≤ 690 ký tự |
| 7 | `Gợi ý chủ đề (nếu hợp): <topicHint ≤100>` | **bỏ** với news_chat |
| 8 | `Thêm:` + ≤ `lim.extra` dòng ≤ `lim.extraChars` | `req.extra` |
| 9 | Khối TIN (`newsLines`, mục 6.4) | khi `req.news`; `incidental = type !== 'news_chat'` |
| 10 | Khối HỒ SƠ (`dossierLines`, mục 6.5) | chỉ hr_review |
| 11 | `NHÂN VẬT (chỉ những người này được nói):` + `personCard` từng người | |
| 12 | `NGƯỜI ĐƯỢC NHẮC (vắng mặt, không nói): [id] Tên · vai · giới tuổi · bio ≤ min(lim.bio,120) · lúc này: <hoạt động \| không có ở văn phòng>` | khi `aboutId` không thuộc participants |
| 13 | `XƯNG HÔ (gọi/xưng): …` | `addressLines` (mục 6.3.2); ≤ 2 người gộp 1 dòng |
| 14 | `NGƯỜI KHÁC trong công ty (chỉ để nhắc tên; ngoài họ không còn ai): Tên (vai)…` | kèm `[id]` chỉ khi hiệu ứng rumor được phép và chưa có `req.rumor`; hr_review bỏ người đã có trong hồ sơ |
| 15 | TIN ĐỒN | confront: "đang lan … đến hỏi tội"; `isNew`: "TIN ĐỒN MỚI … giật gân mà vô hại (lén đi phỏng vấn, được sếp ưu ái, crush…), không tình dục, bệnh tật, phạm pháp, ngoại hình"; lan truyền: "thêm mắm dặm muối… 1–2 chi tiết". `rumor bắt buộc khác null` chỉ khi hiệu ứng rumor được phép (`:480`). Không có `req.rumor` nhưng cho phép → câu hướng dẫn `rumor = {aboutId, text ≤ 140} \| null`. `tellerId` đọc qua ép kiểu `(r as { tellerId?: unknown })` (`:473`) — **trường không có trong `types.ts`** và Director hiện **không gửi** (`director.ts:1248` chỉ chép `id / aboutId / currentText / isNew`; `tellerId` chỉ nằm ở kiểu nội bộ `Draft` / `Scene` của Director, `director.ts:200, 244, 1263`, dùng để lọc ở `:1208`) → nhánh này là **mã chết**, người kể luôn = `participants[0]`. Director bảo đảm người kể đứng đầu ở gossip (`director.ts:1903`) và group_chat (`:2049-2050` sort `tellerId` lên đầu); confront xếp `[subject, teller]` (`:2292`) nhưng nhánh confront của prompt (`:482-483`) dùng `subjectId` / `otherId`, không dùng `teller` |
| 16 | SẢN PHẨM | tên **bỏ thông số** (từ chứa số hoặc `inch\|ml\|mah\|cm\|kg\|gb\|hz\|w`, `:496-498`); showroom_chat: `SẢN PHẨM trên kệ: <tên ≤70> — người đã xài nhận xét: "<pitch ≤160>" … câu đó product=true`; cảnh khác: `SẢN PHẨM: <tên ≤70> — <pitch ≤140>. <who> nhắc món này trong đúng 1 câu…`; cấm giá / link / mã giảm / giọng quảng cáo; `who` = `preferSpeaker` nếu trong cảnh, không thì "một người" |
| 17 | `ĐÃ DIỄN GẦN ĐÂY (đừng lặp chủ đề, câu đùa):` ≤ `lim.recent` tóm tắt ≤ `lim.recentChars` | hr_review bỏ |
| 18 | `YÊU CẦU: <min>–<max> câu · speaker chỉ dùng: id1, id2 · hiệu ứng được phép: … · verdict: … · hrDecisions: … · đúng 1 câu product=true \| mọi câu product=false` | `VERDICT_RULES` (`:138-142`): interview `hired\|rejected` (fallback hired), resign_talk `stay\|leave` (stay), raise_request `approved\|denied` (denied) + `hint`; loại khác `verdict: null` |

#### 6.3.1 Thẻ nhân vật `personCard()` (`:354-379`)

Dòng 1: `[id] Tên · <roleText: "ỨNG VIÊN vị trí X" | "X (người mới, vào làm hôm nay/hôm qua/2 ngày trước)" | roleLabel> · giới tuổi · bio ≤ lim.bio · Giọng: ≤ lim.voice · đang <hoạt động ≤40> ("vừa nhắn vừa …" khi online) · năng lượng E (kiệt sức <25 / mệt <40 / sung >88), tâm trạng M (rất tệ <30 / không vui <50 / rất vui >88), stress S (sắp nổ >80 / căng >65 / thảnh thơi <15) · kpiNote · tenureNote (chỉ `TENURE_SCENES` = resign_talk, raise_request, promotion, layoff, firing) · thích: … (chỉ news_chat)`.
Dòng 2 (thụt lề): thiện cảm `A→B ±n (ghi chú ≤36)` chỉ |score| ≥ 5, ưu tiên `aboutId`, mạnh nhất trước, ≤ `lim.feel` · `nhớ: …` ≤ `lim.mem` ký ức, mỗi cái ≤ `lim.memChars`, tiền tố "hôm qua:" / "N ngày trước:".

`kpiNote()` (`:274-298`): bỏ boss / hr / không active; `expected = clamp((minute − 480) / 570, 0, 1)` (08:00 → 17:30); chỉ xét khi `kpiTarget > 0 && (expected ≥ 0.1 || always)` (`:281`) → trước ≈ 08:57 cảnh thường **không ghi KPI** dù pace lệch (bỏ nhiễu đầu ngày); cảnh thường chỉ nói khi `pace < 0.85` hoặc `≥ 1.3`; `KPI_SCENES` (standup, boss_call, hr_warning, firing, boss_catch, resign_talk, raise_request, promotion, layoff) luôn ghi; `KPI_HISTORY_SCENES` thêm 3 ngày gần nhất; thêm `KPI thấp N ngày liền`, `HR đã nhắc N lần`, `hôm nay bị sếp bắt lười N lần`.

#### 6.3.2 Xưng hô (`:192-246`)

`addressTerm(a, b, channel)` trả "gọi/xưng" khi a nói với b: a là boss → `em/anh`; b là boss → `sếp/em`; `formal` khi kênh company hoặc có ứng viên; `mutual = min(thiện cảm 2 chiều)` (đối xứng); `close` = không formal, cả hai không thuộc `MANAGER_ROLES` (boss, hr, techlead, saleslead), `mutual ≥ 25`; chênh tuổi `diff = b.age − a.age` (`:201`): b lớn hơn ≥ 2 → `anh|chị/em` (a gọi b anh/chị, xưng em); a lớn hơn ≥ 2 → `em/anh|chị` (a gọi b em, xưng anh/chị); cả hai chiều đổi thành `ông|bà/tui` khi close và |diff| ≤ 4 (`:205-206`); chênh 0–1 tuổi: ứng viên → anh/chị–em; kênh company → `tên/mình`; cùng tuổi hoặc `mutual ≥ 15` → `ông|bà/tui`; còn lại anh/chị–em. `thirdPerson(speaker, about)` → `sếp/ổng`, `anh X/ảnh/ổng`, `chị X/chỉ/bả`, `X/nó` (nhỏ hơn ≥ 2 tuổi), `X/ổng|bả`.

### 6.4 Tin thật — `newsLines()` (`:531-547`)

`TIN (thật, theo báo <source ≤30> <đăng hôm nay|hôm qua|N ngày trước>, mục <thể thao|bóng đá|công nghệ|game|khoa học|giải trí>): "<title ≤160>" — tóm tắt của báo: "<summary ≤200>"`; nếu `incidental` (tin len vào pantry_chat / lunch — Director gắn 1/3 số lần, `director.ts:1221-1231`): "chỉ là một chuyện xen vào… bàn 2–3 câu… rồi quay về"; rồi `NEWS_RULES` nguyên văn (`:74-79`, 721 ký tự: chỉ cảm nghĩ về tin đúng như báo đăng, không thêm sự thật / con số / phát ngôn / tên, giữ mức dè dặt, không đoán động cơ, không kết luận đúng sai, không gán tội, không bàn đời tư, không chế giễu người thật có tên, dẫn nguồn "theo báo X đăng", 4–8 câu, không chính trị / tôn giáo); `Có thể liên hệ sang chuyện của mình: Tên (likes ≤2)…`. Thiết kế gốc và lớp lọc nguồn tin: [`v3-news.md`](v3-news.md), [`06-tin-tuc-thoi-su.md`](06-tin-tuc-thoi-su.md).

### 6.5 Hồ sơ nhân sự — `dossierLines()` (`:550-578`, chỉ hr_review)

Rỗng → `HỒ SƠ: không có ai cần xét đặc biệt — … hrDecisions để [] hoặc toàn "none".` Có → tối đa 12 dòng `- [id] Tên ≤20 · vai · KPI a→b→c% (≤ 5 ngày gần nhất) · thấp N ngày liền, đã nhắc N lần, bị bắt lười N lần hôm nay, đang thử thách tới ngày N, tâm trạng M, stress S (chỉ khi mood < 45 || stress > 60 || mood > 85), vào làm ngày N · <attitude ≤80> · được phép: a, b | none`; chú giải action (`warn=nhắc, second_chance=thêm cơ hội, probation=thử thách vài ngày, praise=khen, bonus=thưởng nóng, promote=thăng chức, fire=cho nghỉ, layoff=cắt giảm vì lỗ, open_position=tuyển thêm, none=không`); **TRẦN 1 LẦN HỌP**: ≤ 4 quyết định khác none, ≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise+bonus — khớp `MAX_DECISIONS = 4` và `validateDecisions` ở `src/sim/hr.ts:297-341` (hàng rào lần hai phía Director). `allowed` do `allowedActions()` (`hr.ts:195`) tính — sanitize **tin** danh sách này.

### 6.6 Biên kịch (beats) (`:582-630`)

System riêng (`buildBeatsSystemPrompt`, 3 dòng: vai showrunner chọn 1–3 "biến"; luật kind ∈ MENU, a/b ∈ NHÂN SỰ hoặc null, không nhân vật mới / người thật / chính trị / tình dục / bệnh nặng / phạm pháp, crush nhẹ, ưu tiên nối MẠCH ĐANG MỞ, không lặp BIẾN GẦN ĐÂY, đa số intensity 1–2; mẫu `BEATS_JSON`). User prompt `renderBeats`: `NHIỆM VỤ: BIẾN`, `Lúc`, `Công ty`, `TÌNH HÌNH ≤ lim.situation`, `NHÂN SỰ (id Tên, vai)`, `MENU (kind — ý nghĩa ≤ lim.desc)`, `MẠCH ĐANG MỞ` ≤ lim.arcs, `BIẾN GẦN ĐÂY (đừng lặp)` ≤ lim.recent, câu chốt. Ngân sách `BEATS_USER_TOKEN_BUDGET = 410` với 4 bậc `BEAT_TIERS` `{situation 520/400/280/200, desc 55/40/28/22, arcs 5/4/3/2, recent 5/4/3/2, roleLabel 16/0/0/0}` → tổng beats ≤ ~700 token (test-llm mục 13–14).

### 6.7 Ứng viên và bản tin (`:634-742`)

- `buildCandidateUserPrompt(req, ctx, rng)`: `ROLE_AGE` (export, sanitize dùng lại; vd junior 21–24, boss 38–50), `ROLE_SKILL`, 1 trong 24 `CANDIDATE_ARCHETYPES` + giới tính gợi ý ngẫu nhiên, `Không dùng các tên gọi: <usedNames>`, `Thay cho <replacingName>…`, mô tả trường (bio 1–3 câu ≤ 200, speechStyle ≤ 160, quirks/likes/dislikes 2–4 cụm, traits 0..1, look `#rrggbb`, enum hairStyle / accessory), mẫu `CANDIDATE_JSON`.
- `buildRecapUserPrompt`: `RECAP_EVENT_MAX = 30` (lấy mẫu đều giữ đầu / cuối), mỗi sự kiện ≤ 110; `KPI CUỐI NGÀY` (boss / hr "(không xét KPI)", `thấp N ngày liền`); `Bị cho nghỉ hôm nay`, `Mới nhận vào hôm nay`; giọng "báo lá cải nội bộ", mvp không chọn Giám đốc; mẫu `RECAP_JSON`.

### 6.8 Ngân sách token prompt — `prompt-budget.ts`

- `CHARS_PER_TOKEN = 2.7` (đo thật Gemini tiếng Việt: system + user ≈ 2,8–3,0; phần user động ≈ 2,65 → lấy 2,7, thiên về đếm dư). `SYSTEM_TOKEN_TARGET = 1300` **không nơi nào dùng** (chỉ ghi chú).
- `sceneUserTokenBudget(n) = min(2000, 1200 + max(0, n − 3) × 200)` (`:21-24`).
- `SCENE_TIERS` 4 bậc (`:41-46`), bậc 0 `{bio 140, voice 100, feel 4, mem 2, memChars 60, recent 4, recentChars 80, extra 5, extraChars 130, situation 700}` → bậc 3 `{80, 80, 2, 1, 45, 3, 60, 2, 90, 500}`. `startTier(n) = n ≥ 4 ? 1 : 0`. `fitSceneBudget` thử từ bậc khởi điểm, trả bản đầu tiên ≤ ngân sách, không thì bản gọn nhất. **`render` phải thuần** (được gọi nhiều lần).

---

## 7. Schemas (`src/ai/schemas.ts`)

Quy tắc strict (`:2-9`): mọi object `additionalProperties: false`, mọi key trong `required` (helper `obj()` tự sinh), tuỳ chọn = nullable (`anyOf [x, null]` hoặc `type: ['string','null']`). **Không nhét dữ liệu động** (vd enum id nhân vật) — OpenAI cache prefix = schema + system, động là trượt cache mọi lần. Ràng buộc độ dài / khoảng số chỉ ghi trong `description`, `sanitize.ts` kiểm lại (không dùng `minItems` / `maxLength` để tương thích proxy cũ).

| Tên (`schemaName`) | Hằng | Shape |
|---|---|---|
| `canh_hoi_thoai` | `SCENE_SCHEMA` (`:43-75`) | `lines[{speaker, text, emote: string\|null, product: boolean}], summary, relationshipChanges[{from, to, delta int, reason}], moodChanges[{id, delta}], memories[{id, text}], kpiChanges[{id, delta}], rumor: {aboutId, text}\|null, verdict: enum VERDICTS\|null, hrDecisions: [{id, action enum HR_ACTIONS, reason}]\|null`. Thứ tự key = thứ tự model viết (thoại trước) |
| `ke_hoach_bien` | `BEATS_SCHEMA` (`:78-87`) | `beats[{kind, a: string\|null, b: string\|null, intensity int, note}]` |
| `ho_so_ung_vien` | `CANDIDATE_SCHEMA` (`:90-117`) | `name, fullName, gender enum nam\|nữ, age int, bio, speechStyle, quirks[], likes[], dislikes[], traits{diligence, laziness, gossip, temper, humor, ambition}, look{skin, hair, hairStyle enum HAIR_STYLES, shirt, pants, accessory enum ACCESSORIES}` |
| `ban_tin_ngay` | `RECAP_SCHEMA` (`:120-126`) | `headline, bullets[], mvp: {id, reason}\|null, drama` |

Hằng dùng chung: `HAIR_STYLES` (8), `ACCESSORIES` (6), `VERDICTS` (`hired, rejected, stay, leave, approved, denied`), `HR_ACTIONS` (`warn, fire, second_chance, probation, praise, bonus, promote, open_position, layoff, none`). Thêm trường vào schema = thêm vào `types.ts` + `sanitize.ts` + mẫu `SCENE_JSON` trong `prompts.ts` + `SPEC.md` §6.3.

---

## 8. Sanitize (`src/ai/sanitize.ts`)

Hàm thuần, nhận `unknown` (JSON có thể sai shape khi chạy `json_object`), trả `Outcome<T> = {ok: true, value} | {ok: false, reason}` (`:14-16`). Import `fillBeatDesc` từ `src/content/catalog.ts` nên không hoàn toàn độc lập nội dung.

### 8.1 `LIMITS` (`:18-31`)

| Khoá | Giá trị | Khoá | Giá trị |
|---|---|---|---|
| `lineChars` | 220 | `relDelta` | ±15 |
| `summaryChars` | 160 | `moodDelta` | ±15 |
| `reasonChars` | 80 | `kpiDelta` | ±25 |
| `memoryChars` | 120 | `decisionReasonChars` | 100 |
| `rumorChars` | 160 | `maxDecisions` | 6 |
| `beatNoteChars` | 140 | `maxBeats` | 3 |

### 8.2 `sanitizeScene(raw, req, ctx)` (`:413-578`) — thứ tự xử lý

1. Root phải là object. Dựng `resolveSpeaker` (participants) và `resolveAny` (mọi agent) bằng `makeIdResolver` (`:151-189`: map id / tên / họ tên / 2 từ cuối / "anh Tùng" / "Tùng (Senior Dev)" / "[tung]" → id; nhập nhằng → null; id luôn thắng tên; thử bỏ `HONORIFIC` `anh|chị|em|sếp|ông|bà|cô|chú|bạn|dì|mr|ms…`). `isNamePrefix` nhận thêm `sếp|giám đốc|hr|chị hr|nhân sự|ứng viên`.
2. **Thoại**: mỗi `lines[]` → speaker (`speaker|id|name`) phải thuộc participants (không thì bỏ câu); `text` (`text|line|content`) qua `cleanSpokenText` (`:211-228`: 1 dòng, bỏ gạch đầu dòng, bỏ tối đa 2 tiền tố "Tên:", bỏ `*…*`, `STAGE_INLINE` "(cười)…", ngoặc đầu / cuối, link `http/www/shopee.vn`, ngoặc kép bao ngoài, chuẩn dấu câu, cắt 220) rồi `idsToNames` (`[id]` và `cand_role_day_xxxx` → tên); cần chữ / số / emoji (nhóm chat cho phép "=)))"); bỏ câu trùng liền kề cùng người; `emote` = đúng 1 grapheme emoji (`cleanEmote`, `Intl.Segmenter`); `flagged = product === true || 'true'`.
3. Bỏ câu `looksForeign` (`:85-92`: có chữ Hán / Hangul / Hiragana / Katakana / Kirin / Thái / Ả Rập / Hebrew / Devanagari → true; hoặc ≥ 5 từ, không dấu tiếng Việt, ≥ 2 từ nối tiếng Anh `ENGLISH_WORDS`) — đếm `foreignDropped`.
4. `newsy = type === 'news_chat' || !!req.news || topicHint bắt đầu "nghe nói"` (dây an toàn thứ hai cho đường cũ) → bỏ câu `!isNewsSafe` (`NEWS_BLOCK_RE` `:75`: `bị bắt` trừ `bị bắt lười|quả tang|gặp|phải|làm|đi|đứng|ngồi|trực|viết|học|cài|tay|nạt|bẻ|OT`; `bắt giữ, tạm giam, khởi tố, truy tố, lừa đảo, ngoại tình, ma túy, giết người, hiếp dâm, tự tử, đánh bạc`) hoặc `judgesNamedPerson` (`:119-124`: câu nhắc tên riêng trong tin — `newsProperNames` lấy chữ viết hoa không đứng đầu câu, bỏ `Việt|Nam|Anh|Em|Chị|Ông|Bà|Tôi` — mà không phải tên nhân vật, kèm `JUDGEMENT_RE` "chắc là", "làm màu", "câu view", "đáng đời", "ngu", "dàn dựng"…) — đếm `newsDropped`.
5. Cắt còn `max(2, maxLines + 2)`; `< 2` câu → fail với lý do ưu tiên: tin thật → tiếng Việt → "Chỉ có N câu thoại hợp lệ". ≥ 2 participants mà 1 người nói → fail "Chỉ có 1 người nói".
6. **Sản phẩm** (`:465-481`): chỉ khi `req.product.name`; đúng 1 câu `flagged` → lấy; nhiều → `mentionScore` cao nhất (`:251-265`: bigram tên = 2, token thương hiệu Latin có số / chữ hoa = 3); không câu nào → tự đánh dấu câu có `mentionScore ≥ 3`. Kết quả: **tối đa 1 câu `product: true`**, không có `req.product` → không câu nào.
7. **Hiệu ứng** (chỉ loại trong `allowedEffects`, chỉ id hợp lệ, kẹp biên): `relationshipChanges` from ∈ participants, to ∈ participants ∪ `aboutId`, from ≠ to, cộng dồn cặp, kẹp ±15, reason ≤ 80 hoặc "sau một lần nói chuyện"; `moodChanges` / `kpiChanges` cộng dồn theo id, kẹp ±15 / ±25, bỏ 0; `memories` ≤ 1 / người, ≤ 120, **cảnh có tin → ký ức theo mẫu cố định** `Bàn tin "<title ≤60>" (<source ≤20>)` thay cho chữ model viết, lọc news-safe / foreign.
8. **Tin đồn**: có `req.rumor` → chủ thể do Director quyết, model quên text → giữ `currentText` để chuỗi lan truyền không đứt; không có → `aboutId` phải là người **ngoài cảnh**, không phải ứng viên (hoặc `req.aboutId`).
9. `verdict = normalizeVerdict(type, raw)` (`:52-64`): loại không có rule → `null`; rỗng → fallback; khớp đúng → giữ; thử đồng nghĩa "xấu" trước ("khongnhan" không bị bắt bởi "nhan") rồi "tốt" qua `VERDICT_SYNONYMS` trên chuỗi `foldKey`; không khớp → fallback (`VERDICT_BY_TYPE` `:36-40`: interview → hired, resign_talk → stay, raise_request → denied).
10. `hrDecisions` chỉ hr_review (`hrDecisions|decisions`) qua `sanitizeHrDecisions`; loại khác `null`.
11. `summary` ≤ 160, loại nếu vi phạm news / foreign, rỗng → `deriveSummary` (`:280-332`: theo 24 loại cảnh, kèm verdict "— đậu/trượt", "— quyết định nghỉ/được giữ lại", "— được duyệt/bị từ chối khéo", câu đầu ≤ 70). Trả `source: 'llm'`.

### 8.3 `sanitizeHrDecisions(raw, req, agents)` (`:364-407`) — hàng rào mềm

Hồ sơ rỗng → `[]`. `allowedOf` theo từng id; resolver trên id hồ sơ (bổ sung tên cho người không có trong `ctx.agents`). Mỗi mục: `normalizeHrAction(action|decision|type)` (alias Việt / Anh `:338-349`: "canhcao", "sathai", "thuthach", "khen", "thuong", "thangchuc", "tuyen", "catgiam"…); id từ `id|agentId|name|who`; id không resolve → chỉ giữ nếu là `open_position` chung (id rỗng) và có ai được phép; ≤ 1 quyết định / người (giữ mục đầu); **action ngoài `allowed` → `none` nhưng `reason = "ngoài hàng rào (<action>): …"`** — Director đọc regex này (`director.ts:3239`) để kể "sếp đổi ý" vì thoại đã hứa; reason mặc định; ≤ 6.

### 8.4 Beats, ứng viên, bản tin, cấp cứu

- `sanitizeBeats` (`:604-641`): menu rỗng → fail; `kind` so khớp `foldKey` với menu; `a|who|agent`, `b|with|target` qua resolver roster (b = a → bỏ b); `intensity|level` kẹp 1..3 (mặc định 2); `note|desc|text` ≤ 140 hoặc `fillBeatDesc(desc, tênA, tênB)`; bỏ trùng `kind|a|b`; ≤ 3; không biến hợp lệ → fail. `emergencyBeats = {beats: [], source: 'offline'}`.
- `sanitizeCandidate` (`:750-796`): `fullName` ≤ 5 từ, ≥ 2 từ (viết hoa chữ đầu theo `vi`); `name` ≤ 2 từ hoặc từ cuối; trùng tên đã dùng (`usedNames` + mọi agent) → thử 2 từ cuối, vẫn trùng → fail; gender chuẩn hoá hoặc ngẫu nhiên; `age` kẹp `[max(18, lo − 2), hi + 6]` theo `ROLE_AGE`; `bio` ≤ 240 bắt buộc; `speechStyle` ≤ 200 có mặc định; `quirks/likes/dislikes` ≤ 4 mục ≤ 60; `buildTraits` tự quy đổi thang 0..10 / 0..100 nếu ≥ 3 giá trị > 1; `buildLook` kiểm `#rgb/#rrggbb` và enum, lấy từ `lookPool` khi sai; `id = cand_<role>_<day>_<4 ký tự base36>`; `deskItemProductId` qua `pickDeskItem`. `emergencyCandidate` (`:804-833`): 4 tên / giới `EMERGENCY_NAMES`, tránh trùng.
- `sanitizeRecap` (`:846-889`): `headline` ≤ 120 bắt buộc; `bullets` ≤ 5, ≥ 2 (thiếu → fail), đệm từ `req.events` tới 3; `mvp` resolve id / tên, không chọn boss, thiếu → `deriveMvp` (KPI cao nhất, bỏ boss / hr); `drama` ≤ 240 có mặc định; `kpi = req.kpi`. `emergencyRecap`: 4 sự kiện cuối.
- `emergencyScene` (`:581-596`): 2 câu cố định, `verdict` mặc định, `hrDecisions = []` cho hr_review, `source: 'offline'` — chỉ dùng khi cả LLM lẫn `offline.ts` đều hỏng.

---

## 9. Thoại mẫu offline (`src/ai/offline.ts`)

### 9.1 Tổ chức file (14 mục)

| Mục | Dòng | Nội dung |
|---|---|---|
| 1 Tiện ích | 26–86 | `R = Math.random`, `pick/shuffle/ri/chance`, `cut`, `finish()` (viết hoa, thêm dấu chấm), **bộ nhớ chống lặp cấp module** `RECENT_MAX = 2500` câu (`remember`, `recentS`) |
| 2 Nhân vật & xưng hô | 88–163 | `P` (bản rút gọn `AgentState`), `toP/personOf`, `kinOf(s, l)` → `{you, me, yn}`, `refOf`, `pronOf` (ảnh / chỉ / ẻm / ổng / bả) |
| 3 Kho chi tiết | 165–222 | `FOODS, DRINKS, SNACKS, BUGS, FEATURES, EXCUSES, ERRORS, ITEMS, SCREENS, TASKS…`, `E` (emoji) |
| 4 Ngữ cảnh | 224–377 | `Draft` (câu nháp: `sp, text, emote, product, opt, to, grp, dep`), `Tpl = (c: C) => string \| null \| undefined \| false` (`:235`; giá trị falsy = bỏ mẫu — nhiều mẫu dùng `&&`, `TICS` trả `null`), `SC` (ngữ cảnh cảnh), lớp `C` (ngữ cảnh câu: `you/me/yn/da/…`) |
| 5 Builder | 379–485 | `mix()`, lớp `B`: `next()` (ưu tiên người nói ít, 75 %), `isRepeat`, `make()` (ưu tiên template chưa dùng `usedT`, né câu lặp trong cảnh và trong `recentS`, fallback), `pair()` (cặp hỏi–đáp cùng `grp`), `sayPref`, `say` |
| 6 Hiệu ứng | 488–545 | lớp `FX`; `VERDICT_DEFAULT`; `finalizeFx` lọc theo `allowedEffects`, kẹp **±8** quan hệ, **±10** mood / KPI, ký ức ≤ 100, rumor ≤ 140, verdict theo loại, `hrDecisions` chỉ hr_review |
| 7 Văn chat | 548–569 | `chatify()` viết tắt / emoji cho kênh group |
| 8 Tin đồn | 571–725 | `makeRumor`, `twistRumor` (tam sao thất bản) |
| 9 Kho chung | 727–959 | mở / phản ứng / chi tiết / đùa theo `TopicCategory`, than việc theo vai, chốt cảnh |
| 10 Các loại cảnh | 961–4555 | 24 builder `b*` (pantry 963, desk_visit 1126, gossip 1873, group_chat 1993, company_chat 2300, standup 2451, lunch 2578, boss_catch 2662, boss_call 2811, hr_warning 2980, firing 3054, interview 3127, incident 3315, celebration 3403, confront 3527, pingpong 3601, welcome 3663, showroom 3724, news 3869, hr_review 3994, resign 4173, raise 4285, promotion 4389, layoff 4469) |
| 11 Lắp ráp | 4556–5072 | `BUILDERS: Record<SceneType, fn>`, `TYPE_CATS`, `buildSC()`, `insertProduct()`, `fitLines()`, `mergeAdjacent()`, `applyTics()`, `generate()`, `offlineScene()` |
| 12 Ứng viên | 5074–5207 | `offlineCandidate()` |
| 13 Bản tin | 5208–5298 | `EV_RULES`, `offlineRecap()` |
| 14 Biên kịch | 5299–5342 | `offlineBeats()` |

Import: `CONFIG` (chỉ `kpiLowRatio`, `:2653`, `:4683`), `LOOK_POOL`, `NAME_POOL` (roster), `ACTIVITY_FLAVOR`, `PROJECT_POOL`, `SLACK_ACTIVITIES`, `fillBeatDesc`, `pickTopic`, `topicCategoryOf` (catalog), `getProduct`, `pickProduct` (products). Không mạng, không đụng state World (chỉ đọc `PromptContext`).

### 9.2 Đường đi của một cảnh offline — `generate()` (`:5021-5062`)

1. `buildSC(req, ctx)` (`:4634-4693`): cast từ participants; tách tình huống chính khỏi dòng nền (`BACKGROUND_LINE` "Chuyện mới trong ngày…", "Có thể lồng thói quen…" không kích hoạt từ khoá); nhận dạng dự án vừa release (`RELEASED_RE`); `type` lạ → `pantry_chat` (`:4653`); chủ đề = `topicHint` (bỏ chỉ dẫn trong ngoặc cuối) hoặc `pickTopic(topicCatsFor(type, cast), recentSummaries)` (`:4658`) — `topicCatsFor` (`:4577-4582`) = `TYPE_CATS[type]`, riêng desk_visit thêm `cong_viec_dev` khi dev / QA mở lời (`cast[0]`) hay `cong_viec_sales` khi sales mở lời; chọn ngẫu nhiên món ăn / bug / lỗi / màn hình…; `nTitle/nSource/nCat` từ `req.news`; `lowPct` từ `CONFIG.kpiLowRatio`.
2. Builder: `nTitle && (pantry_chat | lunch)` → `bNews` (tin len vào tám chuyện chỉ nói tiêu đề + tên báo), không thì `BUILDERS[type]`. Builder lỗi khi < 2 câu → throw sớm → cấp cứu.
3. Hậu kỳ, **mỗi bước độc lập** (`safe()`): `insertProduct` → `fitLines` → `mergeAdjacent` → `applyTics`.
4. Kênh group → `chatify` từng câu (giữ nguyên tên sản phẩm); cắt text 200; `summary` ≤ 120; `remember()` mọi câu; `finalizeFx`; `source: 'offline'`.

`offlineScene()` (`:5065-5071`) bọc `generate` → lỗi → `emergencyScene` nội bộ (`:5005-5019`) → `emptyResult`; không bao giờ throw (Brain còn kiểm `lines.length > 0`). `emergencyScene` nội bộ **khác** bản `sanitize.ts:581-596` (mục 8.4): 2 câu cố định khác ("Ủa, tới giờ rồi hả?" / "Ừ, làm cho xong việc rồi tính tiếp."), summary "<A> và <B> nói chuyện vài câu.", và **có chèn 1 câu `product: true`** khi `req.product.name` (`:5014-5017`, người nói = `preferSpeaker` nếu có trong cảnh, không thì `participants[0]`); bản sanitize không có câu sản phẩm và dựng `summary` / `verdict` qua `deriveSummary` / `defaultVerdict`. Hai bản độc lập — sửa một nhớ nhìn bản kia.

### 9.3 Các bước hậu kỳ

- `insertProduct` (`:4743-4783`): chỉ khi `req.product.name` và chưa có câu product; người nói = `preferSpeaker` → marketing → không phải boss → cast[0]; chấm điểm vị trí chèn (không tách cặp hỏi–đáp −5, không ngay sau câu hỏi −3, không kề câu của chính người nói −2/−1, trước câu chốt +2, từ vị trí 2 trở đi +1); mẫu `PRODUCT_OFFICE` / `PRODUCT_CHAT` / `PRODUCT_PARTY`; 75 % (hoặc bắt buộc nếu câu kế là của người nói) thêm câu phản ứng.
- `fitLines` (`:4867-4922`): mục tiêu ngẫu nhiên trong `[minLines, maxLines]`; cắt "đơn vị" (câu + cặp `grp` + câu phụ thuộc `dep`) ưu tiên câu `opt`, không cắt câu product, phạt làm ai đó mất tiếng; ai trong cảnh cũng nói ≥ 1 câu (`padLine`); đệm tới `min`.
- `mergeAdjacent` (`:4924-4957`): văn nói gộp 2 câu liền của cùng người (office tối đa 1 lượt liên tiếp, chat 2), tổng ≤ 170 ký tự, giữ cờ product.
- `applyTics` (`:4973-4998`): tật nói của 8 nhân vật gốc (`hung` "Chúng ta là một gia đình mà.", `ngoc` "ghi lại rồi đó", `khoa` "Haizz,", `vy` 🙂 với dev, `linh`/`tram` "Trời ơi,", `phat` "Chuyện nhỏ!", `tu` "Hehe."), bỏ qua kênh company, cảnh trang trọng 95 % bỏ, còn lại 80 % bỏ, ≤ 1 lần / cảnh.

### 9.4 Xưng hô offline — `kinOf(s, l)` (`:124-145`)

Boss nói → `em/anh`; nói với boss → `sếp/em` (ứng viên: `anh/em`); ứng viên luôn lễ `anh|chị/em`; thiện cảm ≥ 20 và chênh ≤ 3 tuổi → `ông|bà/tui`; chênh ≥ 2 → `anh|chị/em` nhưng bực (thiện cảm ≤ −15, chênh ≤ 6) thì xưng `tui`; nhỏ hơn ≥ 2 → `em / anh|chị`; ngang → `tên/tui`. **Ngưỡng khác `prompts.ts`** (25 / 15 / chênh ≤ 4) — hai bộ luật song song, chỉnh một nơi nên nhìn nơi kia.

### 9.5 Quyết định offline cho cảnh có kết quả

- `bHrReview` (`:3994-4172`): mỗi người bốc 1 hành động **chỉ trong `allowed`** theo trọng số `none 50, warn 20, probation 10, praise 10, second_chance 5, bonus 5, fire 3, promote 1, open_position 1, layoff 1` (`:3997`); giữ ≤ 6 quyết định, ưu tiên khác none; chỉ bàn được `min(2, max(1, floor((maxLines − 3) / 2)))` người trong cảnh (`:4143`; sàn `max(1, …)` → luôn ≥ 1 người, `maxLines` 4 vẫn bàn 1) — quyết định khác none mà không kịp bàn → `none` với reason "Chưa bàn tới kỳ này, để kỳ sau xem lại." (`:4147-4148`) để **thoại và quyết định khớp nhau**.
- `bInterview` → `fx.verdict = hired ? 'hired' : 'rejected'` (`:3302`); `bResign` → `pLeave` cộng dồn theo dữ liệu, từ khoá trong tình huống ép 0 / 1 ("bắt buộc ở lại", "chắc chắn nghỉ"), còn lại kẹp 0,1–0,85 (`:4258-4271`); `bRaise` → `pYes` theo KPI trung bình, lowStreak, thiện cảm sếp, doanh thu, ép 0 / 1 bằng từ khoá, kẹp 0,05–0,75 (`:4362-4377`). Director còn lớp xác suất riêng khi `verdict` null (xem tài liệu 04).

### 9.6 Ứng viên, bản tin, biến offline

- `offlineCandidate` (`:5146`): tên từ `NAME_POOL[gender]` tránh trùng (hết tên đơn → "đệm + tên", cuối cùng thêm số); `diligence` 0,45–0,85, `laziness` nghịch; bio = việc cũ (`PREV_JOBS[role]`) + nét tính cách trội + hook; xưng hô theo tuổi.
- `offlineRecap` (`:5232`): `EV_RULES` chấm điểm sự kiện theo regex (cho nghỉ 10, sự cố 8, tin đồn 7, tuyển 7, cảnh cáo 6, bắt quả tang 6, deal 6, release 6, tiệc 5, wifi 4, đi trễ 3, sếp vắng 2); boss / hr không vào top / MVP.
- `offlineBeats` (`:5316-5342`): 1 biến (55 %) hoặc 2; trọng số 3 (chưa dùng) / 1 (vừa diễn trong `recentBeats`) / 0 (đã chọn); `a` 85 % là nhân viên có mặt, `b` 60 %; intensity 1 (50 %) / 2 (35 %) / 3 (15 %); `note = fillBeatDesc(desc, tênA, tênB)` ≤ 120.

### 9.7 Bẫy offline

- Cache chống lặp (`recentQ/recentS`) là biến cấp module → nhiều Brain trong cùng tiến trình (test) dùng chung; production chỉ có 1 Brain.
- Biên kẹp hiệu ứng offline (±8 / ±10) **chặt hơn** sanitize LLM (±15 / ±25) — cố ý hay không chưa xác nhận (mục Câu hỏi còn mở).
- Builder dùng nhiều từ khoá tiếng Việt trong `situation` (`has(sc, …)`) → đổi câu chữ trong `src/sim/scenes.ts` có thể làm offline mất nhánh (vd "bắt buộc nhận", "vừa release").

---

## 10. Chi phí / token mỗi lần gọi (ước lượng)

Số đo (2026-11-02, ước lượng 2,7 ký tự/token trừ khi ghi khác):

| Thành phần | Kích cỡ | Ghi chú |
|---|---|---|
| System cảnh (tĩnh) | 4 359 ký tự ≈ 1 615 token (@2,7) / ≈ 1 246 (@3,5); "đo thật Gemini ≈ 1 300" (chú thích `test-llm.ts:748-749`) là **số cũ** đo khi ước lượng ≈ 1 530 — hệ số 0,85 không còn khớp (1 300 / 1 615 ≈ 0,80), cần đo lại | cache được ở OpenAI (`prompt_cache_key`); provider khác chưa rõ |
| `SCENE_SCHEMA` (khi `json_schema`) | 2 830 ký tự ≈ 0,8–1 k token | OpenAI tính vào prefix cache; Gemini / Groq có tính vào `prompt_tokens` không — cần kiểm tra |
| User prompt cảnh | ngân sách 1 200 (≤ 3 người) → 2 000 (≥ 7 người) token, tự cắt bậc | `sceneUserTokenBudget` |
| Token ra cảnh | trần 1 300 (× 3 model suy luận), thực tế ~400–1 000 | `MAX_TOKENS.scene`, chú thích `brain.ts:34-37` |
| Tổng một cảnh | ≈ 2,5–3,5 k token vào + ≤ 1,3 k ra | test-llm mục 14 kiểm `0,85 × system + user ≤ 2 500` cho news_chat / resign / raise / promotion 3 người / layoff 3 người, ≤ 2 560 hr_review 3 hồ sơ, ≤ 2 900 hr_review 8 hồ sơ |
| Ứng viên | system 1,6 k + user ngắn; ra ≤ 700 | priority high → tier strong |
| Bản tin | system 1,6 k + ≤ 30 sự kiện × 110 ký tự + KPI; ra ≤ 800 | 1 lần / ngày game |
| Biến (beats) | system 275 + user ≤ 410 ≈ 0,7 k; ra ≤ 450 | mỗi ~2 giờ game |

Hệ quả với quota miễn phí (ghi nhận chủ dự án 2026-11-01, không suy ra từ code): Gemini `gemini-3.5-flash-lite` 500 lượt/ngày/model → tối đa ~500 cảnh/ngày, pace bung 125 rồi ~21/giờ; Groq free 200 000 token/ngày → chỉ ≈ 50–60 cảnh/ngày (mỗi cảnh ~3,5–4 k token) và 8 000 token/phút → `AI_GROQ_RPM=2`, `MAX_REQUEST_TOKENS=8000`; Cloudflare 10 000 neuron/ngày ≈ 300 cảnh (README §3.3). README §3.1 ước nhịp mặc định ~30 giây/cảnh khi có người xem → > 1 000 lượt/ngày nếu xem liên tục — vì vậy cần cả 3 nguồn + giữ nhịp + `LLM_ONLY_WHEN_WATCHED`.

Chi phí tiền chỉ phát sinh với OpenAI (bảng `PRICE_TABLE`) hoặc provider trả tiền có khai `PRICE_*`; `measureUsage` dùng `cached_tokens` nếu server trả (test-llm mục 2 kiểm công thức `(400 × 0.15 + 600 × 0.075 + 200 × 0.6) / 1e6` với gpt-4o-mini).

---

## 11. Thống kê đi đâu, ai thấy

```
router.stats() → brain.usage() → World.statusInfo() (world.ts:2837) → StatusInfo.ai → {t:'status'} / hello
                                   │
                                   ├─ người xem thường: publicStatus() (server.ts:184-193) chỉ giữ ai.mode, mọi số = 0, model '', clicks 0
                                   └─ admin có mã dev: bản đầy đủ + providers[]; GET /api/stats (server.ts:417-433) — 404 khi không có mã
/api/health (server.ts:411-415): { ok, mode: brain.mode(), viewers, day, minute }
```

Snapshot vào `data.brain` của `STATE_FILE` qua `World.save()` (`world.ts:1014`): `{ v: 2, router: { v: 2, date, carry: {date, calls, failures, inputTokens, cachedTokens, outputTokens, costTodayUsd, costTotalUsd}, providers: { <name>: ProviderSnapshot } }, failures, skipped }`. Khán giả: `World.setViewers()` → `brain.setAudience(v)` (`world.ts:959-968`) → ảnh hưởng `reserve()` và `generateBeats()`. Giao thức đầy đủ xem [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md).

**Bẫy khi tìm số token:** `GET /api/stats` (`server.ts:421-431`) **không trả** tổng `inputTokens` / `cachedTokens` / `outputTokens` — chỉ `mode, model, activeProvider, calls, failures, costTodayUsd, costTotalUsd, budgetUsd, skipped, lastError, providers[]` (cộng `clickStats()` và `day`); token chỉ có theo từng provider trong `providers[].inputTokens / outputTokens`. `ProviderStats` (`types.ts:359-377`, dựng ở `router.ts:761-774`) **không có `cachedTokens`** dù router đếm `r.cachedTokens` (`router.ts:534`) và lưu vào snapshot (`:797`); tổng `cachedTokens` chỉ xuất hiện trong `UsageStats` (`types.ts:385`) → `StatusInfo.ai` cho admin qua WebSocket. Muốn xem token qua HTTP phải cộng tay từ `providers[]` hoặc thêm trường vào `ProviderStats` + `/api/stats` (đừng quên `publicStatus()` ở `server.ts:184-193` phải giữ 0 cho người xem thường).

---

## 12. Recipe: thêm một provider mới

1. **Chọn tên** chữ thường `[a-z0-9_]+` (vd `openrouter`), thêm vào `AI_PROVIDERS` đúng vị trí ưu tiên.
2. **Khai `.env`**: `AI_<N>_API_KEY`, `AI_<N>_MODEL`, `AI_<N>_BASE_URL` (bắt buộc nếu không phải `gemini` / `groq` / OpenAI chính chủ). Khai giới hạn gói theo tài liệu nhà cung cấp: `_RPM`, `_RPD`, `_TPD`; nếu trả tiền thì `_PRICE_*_PER_M` (không khai = 0, ngân sách không chạm).
3. **Định dạng JSON**: model không nhận `response_format: json_schema` → `AI_<N>_JSON=object` ngay (router cũng tự học sau một lần 400 nhưng tốn lượt). Model "suy nghĩ" (thinking) → `AI_<N>_REASONING=true` (+ `_REASONING_EFFORT`) hoặc tắt thinking qua `AI_<N>_EXTRA_JSON` (Cloudflare Gemma: `{"chat_template_kwargs":{"enable_thinking":false}}`).
4. **Trần**: endpoint có OTPM / TPM nhỏ → `AI_<N>_MAX_OUTPUT_TOKENS`, `AI_<N>_MAX_REQUEST_TOKENS`. Vai: `AI_<N>_TIER=strong` nếu muốn dành cho việc quan trọng; `AI_<N>_WEIGHT` < 1 nếu tiếng Việt kém hơn nhưng vẫn muốn gánh phụ khi `AI_ROUTING=balanced`; `AI_<N>_PACE=false` nếu quota không theo ngày.
5. **Sửa code chỉ khi cần**: quota ngày reset theo múi giờ khác VN → thêm vào `QUOTA_RESET_TZ` (`router.ts:57`) và `FIXED_OFFSET_MIN` nếu múi giờ mới (`llm.ts:90`); tiền tố key mới → thêm mẫu `redactSecrets` (`llm.ts:74-82`); tên model mới thuộc họ suy luận → `REASONING_MODEL_RE` (`config.ts:102`); nhãn mặc định → `DEFAULT_LABEL` (`config.ts:94-97`); base URL mặc định → `KNOWN_BASE_URLS` (`config.ts:89-92`). Mẫu 429 lạ (chữ "Limit/Requested", "per day") → kiểm `parseTooLarge` / `isDailyQuota` / `messageRetryAfterMs` (`router.ts:88-157`) bằng test mục 0 của `scripts/test-router.ts`.
6. **Khởi động lại**, đọc bảng `[ai]` lúc khởi động (có dòng provider, không có `⚠️ bỏ qua`). Thử thật bằng mục 13.
7. **Cập nhật tài liệu**: `.env.example` (khối mẫu + ghi chú giới hạn đo được và ngày đo), `README.md` §3 (cách lấy key), tài liệu này (bảng 2.2 nếu có biến mới, mục 10 nếu quota khác), `SPEC.md` §6.2.

## 13. Thử model mới (probe) — không tốn tiền trừ bước gọi thật

1. **Mock trước, thật sau**: `npm run test:router` và `npm run test:llm` dùng server giả lập OpenAI-compatible trên 127.0.0.1 (`scripts/test-router.ts:1-16`, `scripts/test-llm.ts:1-15`) — chạy sau mọi thay đổi router / llm / sanitize, không cần key.
2. **Probe HTTP tay** với endpoint thật (thay bằng biến môi trường, không dán key vào lệnh): `curl -s "$AI_X_BASE_URL/chat/completions" -H "Authorization: Bearer $AI_X_API_KEY" -H "Content-Type: application/json" -d '{"model":"<model>","messages":[{"role":"system","content":"Trả về JSON."},{"role":"user","content":"Trả về {\"ok\":true} dạng JSON."}],"response_format":{"type":"json_object"},"max_completion_tokens":64}'`. Kiểm: (a) có trả `usage.prompt_tokens / completion_tokens` không (không có → app ước lượng theo ký tự, `estimated: true`); (b) có `prompt_tokens_details.cached_tokens` không; (c) thử `response_format: json_schema` strict xem có 400 không; (d) gửi `max_completion_tokens` xem có bị đòi `max_tokens`; (e) đọc body lỗi 429 / 400 thật để so với regex ở `router.ts:88-111`.
3. **Xem thoại thật**: đặt provider muốn thử lên đầu `AI_PROVIDERS` với `AI_ROUTING=priority` (hoặc chỉ để một provider), rồi `DEBUG_PROMPTS=1 npm run eyeball:hr` (`scripts/eyeball-hr.ts`: mô phỏng offline vài ngày, gọi AI thật đúng 1 cảnh hr_review, in thoại + `hrDecisions` + nguồn; `EYEBALL_DAYS`, `EYEBALL_SCENES` ≤ 3; không ghi `data/state.json`, không in key). Hoặc `DEBUG_PROMPTS=1 npm start` và mở trang có người xem.
4. **Đánh giá**: tiếng Việt có dấu tự nhiên không (câu lẫn chữ Hán / tiếng Anh sẽ bị `looksForeign` bỏ → hay rơi offline), JSON có bị cắt (`finish_reason: length` → tăng trần hoặc giảm `maxLines`), thời gian trả lời (hạn chót cảnh 27 s), `lastError` trên chip AI / `/api/stats`.

Ghi nhận của chủ dự án về các model đã thử (2026-11-01, không suy ra từ code): dùng `gemini-3.5-flash-lite` (chính, tier strong), Groq `openai/gpt-oss-120b` (JSON ổn, tiếng Việt hơi cứng; `qwen/qwen3.8-27b` tự nhiên hơn nhưng OTPM 1 000 và hay hỏng JSON), Cloudflare `@cf/google/gemma-4-26b-a4b-it` (tiếng Việt tự nhiên nhất, phải tắt thinking). Đã loại: `gpt-oss-20b` (tiếng Việt lỗi), Qwen3-30B trên Cloudflare (nhạt), GLM-5.3-flash (không có ở gói Free), Z.ai GLM-4.7 / 4.5-flash (429 "overloaded", 8–29 s, tiếng Việt lủng củng), OpenRouter `:free` (50 lượt/ngày), SambaNova (20/ngày), GitHub Models (đóng 7/2026), Cerebras (cần thẻ).

## 14. Test liên quan

- `npm run test:router` (`scripts/test-router.ts`): 2 server giả lập Alpha / Beta, đồng hồ ảo; 14 mục: 0 phân loại 429 · 1 Alpha ok · 2 429 Retry-After failover trong request + lùi dần · 2b "Request too large" hạ trần ≤ 900, nhớ qua snapshot · 3 quota ngày (Gemini 0h Pacific, body mảng, gợi ý 27 s bị bỏ, Groq tin máy chủ) · 4 TPD / RPM / RPD · 5 401 tắt 1 giờ, 404 · 6 500 failover + lùi dần · 7 json_schema → json_object + restore · 8 cả hai chết → offline + cầu dao · 9 tier strong · 10 gộp thống kê + serialize/restore · 11 cấu hình OPENAI_* cũ · 12 key không lộ · 13 pace, balanced, WEIGHT, MAX_OUTPUT_TOKENS, EXTRA_JSON, MAX_REQUEST_TOKENS, REASONING=false, PACE=false, EXTRA_JSON sai cú pháp.
- `npm run test:llm` (`scripts/test-llm.ts`): 1 server giả lập; 15 mục: reserve() · cảnh "bẩn" → sanitize + tính tiền (kiểm `max_completion_tokens 1300`, `temperature 1`, không `prompt_cache_key` khi có BASE_URL, map tên → id, bỏ "Tên:" / "(cười)" / link, 1 câu product, kẹp ±15) · JSON hỏng → offline · 500 → nghỉ 20 s · 400 → json_object · 401 + cầu dao · ứng viên + bản tin · server treo → hết hạn · trần ngân sách · news_chat lưới an toàn · hr_review hàng rào · verdict theo loại · generateBeats · **kích cỡ prompt** · World + Director chế độ GPT.
- `npm run smoke` / `smoke:story`: Brain offline (`openaiKey: ''`), kiểm `usage.mode === 'offline' && calls === 0`, ≥ 3 beat offline mỗi hạt… `npm run eyeball:hr`: AI thật, **không** trong `npm test`. Chi tiết: [`11-kiem-thu-qa.md`](11-kiem-thu-qa.md).

## 15. Đối chiếu tài liệu cũ (chỗ lệch cần sửa khi có dịp)

- `README.md` §4 ghi system prompt "~3.300 token" và prompt cảnh "~700–1.300 token", ước tính "~4.000 token vào/cảnh" cho gpt-4o-mini — số v1; đo thật system ≈ 1 246–1 615 (tuỳ hệ số), user có ngân sách tới 2 000 (mục 10).
- `SPEC.md` §6.2 chưa có các bổ sung 2026-11-02: `AI_<N>_PACE`, `AI_ROUTING=balanced` + `AI_<N>_WEIGHT`, `AI_<N>_MAX_OUTPUT_TOKENS` cố định, `AI_<N>_MAX_REQUEST_TOKENS` + `fits()`, `AI_<N>_EXTRA_JSON`, `AI_<N>_REASONING`, Cloudflare Workers AI; khối "Scene JSON" đầu §6.3 thiếu `hrDecisions` (chỉ ghi ở bullet v3). SPEC §6.1 và phần router / client §6.2 còn khớp code.
- `.env.example` mặc định `AI_PROVIDERS=gemini,groq` (Cloudflare comment) ≠ README §3.4 `gemini,groq,cloudflare`.
- `docs/ui-polish-todo.md:32` còn ghi việc "Chip AI ghi GPT…" như việc chưa làm; `docs/v2-contract.md` §4 đã mô tả chip theo `activeProvider` — kiểm phía frontend ([`08-frontend-giao-dien.md`](08-frontend-giao-dien.md)).
- Chú thích trong mã lệch hành vi thật: `config.ts:47` ghi `rpd` "theo ngày giờ VN" nhưng router đếm RPD theo **múi giờ reset của provider** (`rollDay`, mục 4.3; Gemini = Pacific) — chỉ `carry` / ngân sách theo giờ VN; `offline.ts:4959` ghi "tật nói riêng của 10 nhân vật gốc" nhưng `TICS` (`:4962-4971`) chỉ có 8 người (`hung, ngoc, khoa, vy, linh, phat, tu, tram`); `prompts.ts:4` và `scripts/test-llm.ts:748-749` ghi system "≈ 1 300 token đo thật" — số cũ (mục 6.1).

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật | chạy |
|---|---|---|
| Thêm / đổi biến `AI_<N>_*` hoặc biến chung (`config.ts`) | bảng 2.2 / 2.3 ở đây; `.env.example`; `README.md` §3–4; `SPEC.md` §6.2; [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) | `npm run test:router` (mục 13 có test `buildProviders`), `npm run typecheck` |
| `ROUTER_POLICY`, `penalize`, `classifyError`, regex 429 | mục 4.1 / 4.5 / 4.6; dòng mô tả ở `README.md` §3.5 | `npm run test:router` (mục 0, 2, 2b, 3, 5, 6) |
| `paceBlock`, `balancedOrder`, `order()` | mục 4.2 / 4.4; `README.md` §3.5 | `npm run test:router` mục 9, 13 |
| Shape `RouterSnapshot` / `ProviderSnapshot` | mục 4.10 / 11; giữ `restore()` đọc được bản cũ (v1, v2) | `npm run test:router` mục 10, `npm run smoke` (round-trip) |
| `DEADLINE_MS`, `MAX_TOKENS`, cầu dao (`brain.ts`) | mục 5.1; đồng bộ `RESULT_TIMEOUT_MS` / `CANDIDATE_TIMEOUT_MS` ở `director.ts` và tài liệu 04 | `npm run test:llm` mục 8, 6 |
| `reserve()` | mục 5.3; `SPEC.md` §6.1 | `npm run test:llm` mục 1, `smoke` |
| `UsageStats` / `ProviderStats` (`types.ts`) | mục 5.6 / 11; `publicStatus()` ở `server.ts` (đừng lộ trường mới cho người xem thường); frontend chip AI | `npm run typecheck`, test:router mục 10 |
| System prompt, `SCENE_JSON`, luật tiếng Việt | mục 6.1–6.2 (đo lại kích cỡ bằng script offline, ghi số mới vào mục 10); `SPEC.md` §6.3 | `npm run test:llm` mục 14 (kích cỡ), `eyeball:hr` để đọc thoại |
| Thứ tự / nội dung user prompt cảnh, `SCENE_DIRECTION`, `VERDICT_RULES`, `CHANNEL_STYLE` | mục 6.3; giữ các mốc test (`speaker chỉ dùng:`, `N–M câu`, chữ "SẢN PHẨM") | `npm run test:llm` mục 2, 10–12, 14 |
| `NEWS_RULES`, `NEWS_BLOCK_RE`, `judgesNamedPerson` | mục 6.4 / 8.2; [`v3-news.md`](v3-news.md); tài liệu 06 | `npm run test:llm` mục 10, `npm run test:news` |
| `dossierLines`, `sanitizeHrDecisions`, `HR_ACTIONS` | mục 6.5 / 8.3; đồng bộ `allowedActions` / `validateDecisions` ở `hr.ts` và tài liệu 04; `SPEC.md` §5.6, §6.4 | `npm run test:llm` mục 11, `npm run smoke:story`, `eyeball:hr` |
| Schema (`schemas.ts`) | mục 7; `types.ts` (`SceneResult`…); `sanitize.ts`; `SCENE_JSON`; `SPEC.md` §6.3 | `npm run test:llm` mục 2, 5 |
| `LIMITS`, luật `sanitizeScene` | mục 8.1–8.2; `SPEC.md` §6.4 | `npm run test:llm` mục 2, 3, 10 |
| `prompt-budget.ts` (hệ số, tiers, ngân sách) | mục 6.8 / 10 | `npm run test:llm` mục 14 |
| `offline.ts` (builder mới, `finalizeFx`, `kinOf`) | mục 9; thêm builder cho `SceneType` mới vào `BUILDERS` (thiếu → rơi về `pantry_chat`) | `npm run smoke`, `npm run smoke:story` |
| Thêm `SceneType` | `types.ts`, `SCENE_DEFS` (scenes.ts), `SCENE_DIRECTION`, `deriveSummary`, `BUILDERS`, `KPI_SCENES`/`TENURE_SCENES` nếu cần; tài liệu 04 và mục 6.3 / 9 ở đây | toàn bộ `npm test` |
| `DESK_TAGS` hoặc `tags` trong `data/products.json` | mục 5.1 | `npm run smoke` |
| `emergencyScene` (hai bản: `sanitize.ts:581` và `offline.ts:5005`) | mục 8.4 / 9.2 — sửa một bản nhớ nhìn bản kia | `npm run test:llm` mục 3, `npm run smoke` |
| `/api/stats`, `publicStatus()` (`server.ts`) | mục 11 (danh sách trường trả về) | `npm run typecheck`, thử `curl` với mã dev |
| Thêm provider / model mới | mục 12–13, bảng 2.2, mục 10 (quota), `README.md` §3, `.env.example` | test:router + `eyeball:hr` |

## Câu hỏi còn mở / cần kiểm tra

- Gemini / Groq / Cloudflare có trả `usage.prompt_tokens_details.cached_tokens` không, và có tính `json_schema` vào `prompt_tokens` không — ảnh hưởng số `cachedTokens` trên chip AI và ước lượng mục 10 (cần kiểm tra thật với `DEBUG_PROMPTS=1`).
- Biên kẹp hiệu ứng offline (±8 quan hệ, ±10 mood / KPI, `offline.ts:528-534`) chặt hơn sanitize LLM (±15 / ±25): cố ý hay không — cần chủ dự án xác nhận; nếu cố ý nên ghi lý do vào code.
- `generateBeats` không qua `reserve()` nên không bị `MIN_SECONDS_BETWEEN_LLM` chặn nhưng vẫn xếp hàng `MAX_CONCURRENT_LLM`; chưa có số đo beats chiếm bao nhiêu % lượt gọi mỗi ngày.
- Hai hàm `estimateTokens` (3,5 ở `llm.ts`, 2,7 ở `prompt-budget.ts`) — nên hợp nhất hoặc đổi tên để khỏi nhầm; `SYSTEM_TOKEN_TARGET` không dùng.
- `AI_<N>_EXTRA_JSON` có thể ghi đè `temperature` / `reasoning_effort` / `prompt_cache_key` (chỉ 6 khoá bị xoá) — giữ làm tính năng hay chặn thêm?
- Trạng thái học của `ProviderClient` (`dropped`, `useMaxTokensParam`) không vào snapshot → sau khởi động lại tốn 1 lượt 400 để học lại; có đáng lưu không?
- `brain.ts:155` ternary thừa; `config.ts:192` biểu thức `pace` viết vòng — dọn khi tiện.
- `prompts.ts:473-474` đọc `rumor.tellerId` ngoài hợp đồng kiểu `SceneRequest` (`types.ts:239`) nhưng Director **không gửi** (`director.ts:1248`) → mã chết. Việc cụ thể, chọn một: (a) bỏ nhánh `tellerId` ở `prompts.ts:473` và giữ quy ước "người kể = `participants[0]`" (đã đúng với gossip / group_chat); hoặc (b) thêm `tellerId?: string` vào `SceneRequest.rumor` (`types.ts:239`), chép ở `director.ts:1248` và ghi vào `SPEC.md` §6.3.
- `paceBlock` coi ngày quota = 24 h → ngày đổi DST của Pacific lệch 1 giờ (chấp nhận, chưa có test).
- `balancedOrder` áp cho mọi task kể cả candidate / recap / beats (hệ quả nhỏ vì strong vẫn lên đầu) — README §3.5 nói "cảnh thường"; chọn một cách diễn đạt và ghi nhất quán.
- `DESK_TAGS` (`brain.ts:47-57`) có 8 tag không tồn tại trong `data/products.json` hiện tại (`so-tay`, `ke-hoach`, `ca-phe`, `den`, `sach`, `hoc`, `trang-tri`, `cay-xanh`) — chỉ là no-op: mỗi vai vẫn còn 2–3 tag thật (hr `van-phong`, `thu-gian`; junior `dev`, `chuot`, `gaming`; designer `design`, `man-hinh`, `chuot`), `pickProduct()` (`products.ts:172-185`) vẫn chấm điểm theo các tag đó, không vai nào rơi vào random hoàn toàn; chỉ kém đa dạng hơn ý định ban đầu → nên thêm sản phẩm có tag đó hoặc dọn `DESK_TAGS`.
- Hệ số 0,85 và mốc "system ≈ 1 300 token đo thật" (`prompts.ts:4`, `scripts/test-llm.ts:748-750`) là số cũ (mục 6.1, 10): cần đo lại `prompt_tokens` thật với `DEBUG_PROMPTS=1` trên Gemini / Groq / Cloudflare, rồi sửa hai chú thích và mốc `0,85 × system + user ≤ 2 500` của test-llm mục 14.
- `generateScene` (`brain.ts:304`) không kiểm lại `underBudget()` sau `reserve()` (mục 5.3): thêm kiểm tra, hay chấp nhận vì chỉ ảnh hưởng provider trả tiền và cảnh `high` khi hàng đợi đầy?
- `cool()` (`router.ts:542`) ghi đè `cooldownReason` dù không kéo dài cooldown (mục 4.5): nên chỉ đổi lý do khi `until` thật sự dời xa hơn, hoặc ghép hai lý do?
- `ProviderStats` / `GET /api/stats` không có `cachedTokens` và tổng token (mục 11): bổ sung nếu cần theo dõi tỷ lệ cache hit theo provider.
- `.env.example:32` gợi ý model Groq `qwen/qwen3-32b`, trong khi `README.md:101` và mục 13 (ghi nhận của chủ dự án) ghi `qwen/qwen3.8-27b` — cần chủ dự án xác nhận tên model đúng trên Groq rồi sửa về một tên (tài liệu 01 cũng đang lệch). — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
- `emergencyScene` tồn tại hai bản khác nhau (`offline.ts:5005-5019` có câu sản phẩm; `sanitize.ts:581-596` không) — gộp về một hay giữ cố ý?
- Dự án đã có `.git` đã có lịch sử commit (đẩy lên github.com/Hao2505/office-ai) dù bối cảnh chủ dự án ghi "chưa git init" — các tài liệu `docs/NN-*.md` mới cần được commit.
- README §4 và SPEC §6.2 / §6.3 lệch code như mục 15 — chưa sửa trong lần viết tài liệu này (giữ nguyên tài liệu cũ theo yêu cầu).
