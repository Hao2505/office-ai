# 🏢 Văn Phòng Ảo — nhân viên AI sống real-time

> ### 👉 Xem trực tiếp: **https://corp.vibe-coder.fun/**
> Văn phòng đang chạy thật 24/7 — mở link là xem được ngay, không cần cài gì. Mã nguồn: https://github.com/Hao2505/office-ai

Một trang web "sitcom văn phòng" chạy **trực tiếp 24/7**: công ty công nghệ ảo **Cty TNHH VibeCorp** với 10 nhân viên AI
tự đi làm, gõ code, lướt TikTok, tám chuyện ở pantry, nói xấu sau lưng, bị sếp bắt quả tang, bị HR gọi lên phòng họp…
người lười bị **đuổi việc**, HR **phỏng vấn người mới** thay vào. Tất cả diễn ra như một buổi livestream: ai mở trang web
cũng xem cùng một văn phòng, cùng một lúc.

- Lời thoại do **AI** viết — chạy **miễn phí** với Google Gemini (chính) + Groq (dự phòng), hoặc OpenAI nếu bạn muốn trả tiền.
  Mỗi lần gọi viết trọn một cảnh 4–10 câu, rồi phát từng câu như đang nói thật.
- Chưa có API key? Vẫn chạy được ở **chế độ OFFLINE** (câu thoại mẫu, miễn phí) để xem thử.
- Kiếm tiền: văn phòng có một **phòng trưng bày** với 2 kệ (làm đẹp / công nghệ) bày **đồ thật bạn đang dùng** kèm link
  Shopee tiếp thị liên kết của bạn; nhân viên ghé ngắm, **khoe và bàn về món đồ** (dựa trên nhận xét của bạn), người xem bấm
  vào kệ, vào tab 🛍️ hoặc vào **chip link dưới câu thoại** là ra Shopee. Xem mục 5.

---

## 1. Chạy thử trong 3 bước

Cần **Node.js 20 trở lên** (tải ở https://nodejs.org, chọn bản LTS).

```bash
npm install        # cài thư viện (chỉ cần làm 1 lần)
npm start          # bật server
```

Mở trình duyệt: **http://localhost:3000** 🎉

Màn hình trong terminal sẽ báo:

```
🏢 Văn Phòng Ảo — Cty TNHH VibeCorp
👉 Mở trình duyệt: http://localhost:3000
🧪 AI: OFFLINE (chưa có key — điền AI_PROVIDERS và AI_<TÊN>_API_KEY trong .env) — dùng câu thoại mẫu, không tốn tiền
⏱️  Thời gian: nén — 0.5 phút game / giây thật (tua nhanh bằng bảng dev)
🛍️  Phòng trưng bày: 16 sản phẩm (kệ làm đẹp 7 · kệ công nghệ 9) — chỉnh trong data/products.json
💾 Lưu trạng thái: data/state.json (mỗi 60 giây và khi tắt)
🗄️  Lưu trữ dài hạn: data/history (JSONL theo ngày, nén sau 7 ngày, giữ 180 ngày) — GET /api/history
📰 Thời sự: 10 nguồn RSS, tải sau 20 giây rồi mỗi 45 phút (có giải trí nhẹ) — GET /api/news
🛠️  Bảng dev: BẬT cho mọi người xem (đặt DEV_TOKEN hoặc DEV_PANEL=false khi lên production)
📅 Hiện tại: Thứ Hai, ngày 1 — 07:30
```

Khi đã có key AI (mục 3), dòng 🧪 đổi thành `🤖 AI: Gemini (gemini-3.5-flash-lite) → Groq (…) → câu mẫu offline · ngân sách $1/ngày …`.

Tắt server: bấm **Ctrl + C** (server tự lưu trạng thái rồi mới tắt; lần sau bật lại văn phòng chạy tiếp từ chỗ cũ).

> 💡 Mới mở lúc 07:30 sáng thì văn phòng còn vắng — khoảng 30 giây sau mọi người mới lục tục tới. Muốn xem nhanh,
> bấm **x5** / **x10** ở bảng dev góc dưới bên trái.

---

## 2. Bạn sẽ thấy gì trên trang?

| Khu vực | Nội dung |
|---|---|
| **Bản đồ văn phòng** | Nhân vật đi lại, ngồi làm việc, màn hình máy tính đổi theo việc đang làm (code / TikTok / Shopee / game), bong bóng thoại, 📱 khi đang nhắn nhóm chat. Bấm vào nhân vật để xem hồ sơ. Góc trên có đồng hồ + ngày, một chấm xanh/xám (AI đang viết thoại hay đang dùng câu mẫu) và các chip 🚀 dự án · 💰 doanh thu · 👀 người xem (+ 🔥/📶 khi có sự cố). Sếp đi vắng thì biển **ĐI VẮNG** hiện ngay trên phòng Giám đốc. Người xem thường không thấy gì về "hệ thống"; admin mở trang kèm mã dev (mục 8) mới có thêm chip 🤖 AI |
| **🛍️ Phòng trưng bày** (góc trên bên trái) | 2 kệ **LÀM ĐẸP** / **CÔNG NGHỆ** bày sản phẩm của bạn: rê chuột xem tên + giá, bấm là mở link Shopee. Nhân viên thỉnh thoảng ghé ngắm (🛍️) và khoe đồ với nhau. WC giờ chỉ là một cánh cửa đóng cạnh phòng server — ai vào là "biến mất", cửa hiện "Có người" |
| **💬 Trực tiếp** | Toàn bộ thoại + sự kiện, gom theo thẻ cảnh, lọc theo Văn phòng / Nhóm kín / Nhóm cty / Sự kiện. Chip 🛒 sản phẩm (ghi "Link tiếp thị liên kết") nằm dưới câu thoại có nhắc món đồ |
| **👥 Nhân sự** | Thẻ từng người: đang làm gì, KPI hôm nay, năng lượng / tâm trạng / stress, cảnh cáo, "🔥 nguy cơ bị đuổi" |
| **🛍️ Sản phẩm** | Toàn bộ sản phẩm trên 2 kệ, theo nhóm, kèm **nhận xét của bạn** và nút "Xem trên Shopee ↗" |
| **📰 Bản tin** | Cuối mỗi ngày có một "tờ báo văn phòng": tít giật gân, nhân viên của ngày, drama, bảng KPI |
| **🗣️ Tin đồn** | Tin đồn lan từ người này sang người khác, mỗi lần kể lại bị "tam sao thất bản" (chữ mới được tô vàng) |

Chuyện gì xảy ra là **không kịch bản** (mục 6): ai KPI thấp vài ngày có thể bị HR nhắc, bị đưa vào diện thử thách hay — nếu vẫn không
đổi — bị cho nghỉ việc, rồi HR phỏng vấn ứng viên (AI tự nghĩ ra người mới) và người mới được chào đón; ai làm tốt được khen, thưởng nóng,
thăng chức; có người xin tăng lương, có người chán việc đòi nghỉ… Người bị nhắc / cho nghỉ mỗi lần chạy mỗi khác, không ai bị "đánh dấu"
trước. Sếp Hùng hay đi "đánh golf với đối tác", sếp vừa đi là nhóm chat kín rôm rả, sếp về bất ngờ là cả phòng giả vờ làm việc 😰.
Thỉnh thoảng cả phòng còn tám về **tin thật trên báo** (mục 7).

---

## 3. Bật AI miễn phí (Gemini + Groq + Cloudflare) — thoại "thật", không lặp

Không cần nạp tiền. Bạn lấy 2–3 key miễn phí, dán vào `.env`, xong. App tự **giữ nhịp** quota ngày của từng nguồn và **xen kẽ** các nguồn
để không nguồn nào cạn sạch trong vài giờ đầu (mục 3.5).

### 3.1 Lấy key Gemini (chính)

1. Vào **https://aistudio.google.com/apikey**, đăng nhập Google, bấm **Create API key** (chọn/tạo một project bất kỳ).
2. Copy key, dán vào `.env` ở dòng `AI_GEMINI_API_KEY=`.

Model mặc định: **`gemini-3.5-flash-lite`** (nhanh, miễn phí, viết tiếng Việt tốt, nhận JSON schema). Gói miễn phí: **500 lượt/ngày
cho mỗi model** (đo thật ngày 2026-11-01 — lỗi 429 của Google ghi rõ `limit: 500`; Google có thể đổi) và khoảng 10–15 lượt/phút.
Quota ngày reset lúc **0h giờ Pacific = 14h (mùa hè) / 15h (mùa đông) giờ Việt Nam**, không phải 0h Việt Nam — app tính đúng mốc này.
Với nhịp gọi mặc định 30 giây/cảnh, một ngày có người xem liên tục tốn hơn 1.000 lượt, nên app chia tải sang Groq + Cloudflare
(mục 3.5) thay vì xài sạch Gemini rồi chờ tới chiều hôm sau.

### 3.2 Lấy key Groq (dự phòng)

1. Vào **https://console.groq.com/keys**, đăng ký (miễn phí), bấm **Create API Key**.
2. Dán vào `.env` ở dòng `AI_GROQ_API_KEY=`.

Model gợi ý cho tiếng Việt (đổi ở `AI_GROQ_MODEL`):

| Model | Ghi chú |
|---|---|
| `openai/gpt-oss-120b` (mặc định) | JSON ổn định nhất, tiếng Việt đúng nhưng hơi cứng; là model "suy luận" nên để `AI_GROQ_REASONING_EFFORT=low` |
| `qwen/qwen3.8-27b` | Tiếng Việt tự nhiên hơn, nhưng gói free chỉ cho **1.000 token ra/phút** và hay hỏng JSON ở cảnh dài → nếu dùng, đặt `AI_GROQ_REASONING=false`, `AI_GROQ_MAX_OUTPUT_TOKENS=900` |
| `openai/gpt-oss-20b` | Tiếng Việt lỗi nhiều, không nên |

Gói miễn phí của Groq tính **theo từng model** (đo 2026-11-01): **1.000 lượt/ngày**, **200.000 token/ngày**, **8.000 token/phút**
(tính cả phần token ra xin trước). Vì vậy `.env` mặc định để Groq tối đa **2 lượt/phút**, trần **1.500 token ra**, và **không gửi**
request nào quá 8.000 token (`AI_GROQ_MAX_REQUEST_TOKENS`) — tránh kiểu lỗi "Request too large" lặp đi lặp lại.

### 3.3 Lấy key Cloudflare Workers AI (nguồn thứ 3, 10.000 neuron/ngày miễn phí)

1. Đăng nhập **https://dash.cloudflare.com** (gói Free là đủ) → menu **AI → Workers AI** → **Use REST API**.
2. Mục **Get Account ID**: chép **Account ID** (32 ký tự hex) vào `AI_CLOUDFLARE_BASE_URL` (thay vào chỗ `<ACCOUNT_ID>`).
3. **Create a Workers AI API Token** → **Create API Token** → **Copy API Token** (chỉ hiện 1 lần) → dán vào `AI_CLOUDFLARE_API_KEY=`.
   Token mẫu chỉ có quyền Workers AI (đọc/sửa), không đụng được DNS hay domain.

Model dùng: **`@cf/google/gemma-4-26b-a4b-it`** — tiếng Việt tự nhiên nhất trong các model free đã thử (nói lóng "bay màu",
"ăn hành"…), khoảng 9 giây/cảnh. Bắt buộc gửi kèm tham số tắt chế độ "suy nghĩ" (`AI_CLOUDFLARE_EXTRA_JSON`, có sẵn trong
`.env.example`) — không tắt thì 30 giây/cảnh và tốn neuron gấp 4. 10.000 neuron/ngày ≈ 300 cảnh; đặt lại lúc 7h sáng giờ Việt Nam.
Các model khác trên Cloudflare: Qwen3-30B nhạt, gpt-oss tiếng Việt lỗi, GLM-5.3-flash không có ở gói Free.

### 3.4 Điền `.env`

Mở **`.env`** (chưa có thì copy từ `.env.example`). Phần AI trông thế này:

```env
AI_PROVIDERS=gemini,groq,cloudflare   # thứ tự ưu tiên (cho việc quan trọng và khi AI_ROUTING=priority)
AI_ROUTING=balanced                   # cảnh thường xen kẽ các nguồn, nghiêng về nguồn còn nhiều quota ngày

AI_GEMINI_API_KEY=...dán key Gemini...
AI_GEMINI_MODEL=gemini-3.5-flash-lite
AI_GEMINI_RPM=10
AI_GEMINI_RPD=500                     # đúng mức free của Google; app giữ nhịp để đủ cả ngày
AI_GEMINI_TIER=strong                 # phỏng vấn, xét nhân sự, bản tin… ưu tiên Gemini

AI_GROQ_API_KEY=...dán key Groq (để trống cũng được, chỉ mất một nguồn)...
AI_GROQ_MODEL=openai/gpt-oss-120b
AI_GROQ_RPM=2
AI_GROQ_RPD=1000
AI_GROQ_TPD=200000
AI_GROQ_REASONING_EFFORT=low
AI_GROQ_MAX_OUTPUT_TOKENS=1500
AI_GROQ_MAX_REQUEST_TOKENS=8000
AI_GROQ_WEIGHT=0.35                   # tiếng Việt cứng hơn → chỉ gánh ~1/3 phần cảnh thường

AI_CLOUDFLARE_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AI_CLOUDFLARE_API_KEY=...dán API token Workers AI...
AI_CLOUDFLARE_MODEL=@cf/google/gemma-4-26b-a4b-it
AI_CLOUDFLARE_RPM=30
AI_CLOUDFLARE_RPD=400
AI_CLOUDFLARE_TPD=900000
AI_CLOUDFLARE_JSON=object
AI_CLOUDFLARE_EXTRA_JSON={"chat_template_kwargs":{"enable_thinking":false}}
```

Tắt server (Ctrl + C) rồi `npm start` lại. Terminal sẽ liệt kê các nhà cung cấp:

```
[ai] Nhà cung cấp AI (cảnh thường xen kẽ, nghiêng về bên còn nhiều quota ngày)
[ai]   1. Gemini — gemini-3.5-flash-lite · 10 lượt/phút, 500 lượt/ngày · miễn phí · ưu tiên việc quan trọng, giữ nhịp quota ngày, quota ngày reset 0h Pacific (15:00 giờ VN)
[ai]   2. Groq — openai/gpt-oss-120b · 2 lượt/phút, 1000 lượt/ngày, 200.000 token/ngày · miễn phí · giữ nhịp quota ngày, ≤ 1500 token ra, ≤ 8000 token/request, trọng số 0.35
[ai]   3. Cloudflare — @cf/google/gemma-4-26b-a4b-it · 30 lượt/phút, 400 lượt/ngày, 900.000 token/ngày · miễn phí · json_object, giữ nhịp quota ngày
[ai]   → provider đầu hết lượt / lỗi thì tự chuyển sang provider sau; hết cả thì dùng câu thoại mẫu.
```

Provider nào **chưa có key** sẽ hiện `⚠️ bỏ qua: Groq (...): chưa có key (AI_GROQ_API_KEY)` — không sao, app vẫn chạy với
những provider còn lại.

### 3.5 Dự phòng, giữ nhịp và xen kẽ hoạt động thế nào?

- **Giữ nhịp quota ngày** (`AI_<TÊN>_PACE`, mặc định bật): mỗi nguồn được xài trước 25% quota ngày (tối thiểu 30 lượt / 30k token),
  phần còn lại mở dần theo giờ đã trôi của ngày quota (Gemini tính theo ngày Pacific). Nguồn đang "giữ nhịp" tạm coi như nghỉ,
  nguồn khác hoặc câu mẫu gánh, rồi tự mở lại — không còn cảnh Gemini cạn lúc 17h và chờ tới 15h hôm sau.
- **Xen kẽ** (`AI_ROUTING=balanced`): cảnh thường chọn nguồn ngẫu nhiên có trọng số = quota còn lại × `AI_<TÊN>_WEIGHT`
  (mặc định 1), nên 3 nguồn hao đều nhau; hoà thì theo thứ tự `AI_PROVIDERS`. Việc quan trọng (phỏng vấn, xét nhân sự, bản tin,
  ứng viên) vẫn ưu tiên nguồn `TIER=strong`. Đặt `AI_ROUTING=priority` nếu muốn đúng thứ tự như cũ.
- **Trần token**: `AI_<TÊN>_MAX_OUTPUT_TOKENS` (trần `max_completion_tokens`), `AI_<TÊN>_MAX_REQUEST_TOKENS` (prompt + token ra xin
  lớn hơn mức này thì không gửi tới nguồn đó), `AI_<TÊN>_REASONING=true|false` (ép coi là model suy luận hay không — model suy luận
  được cấp token ra gấp 3 và nhận `reasoning_effort`), `AI_<TÊN>_EXTRA_JSON` (trường bổ sung ghép thẳng vào body, vd tắt "suy nghĩ"
  của Gemma trên Cloudflare).
- Mỗi cảnh, app gọi provider **đầu tiên còn sẵn sàng** theo thứ tự đã chọn (ví dụ Gemini). Nếu Gemini trả lỗi (hết lượt 429, máy chủ lỗi, quá 20 giây…),
  app **chuyển ngay sang Groq trong cùng một cảnh** — người xem không thấy gì khác.
- Provider lỗi được cho **"nghỉ"** riêng: bị giới hạn (429) → nghỉ đúng theo thời gian máy chủ báo (Retry-After / "try again
  in 1m2s"; Groq báo chính xác cả với quota ngày), không báo thì 30 s, 60 s, 120 s… tối đa 15 phút; **hết quota ngày** mà máy
  chủ không báo giờ → Gemini nghỉ tới **0h giờ Pacific** (14–15h giờ Việt Nam, mốc reset thật của Google; gợi ý "retry in 27s"
  của Google lúc hết quota ngày là sai nên app bỏ qua), provider khác dò lại sau 1 giờ; sai key / sai model → tắt 1 giờ và báo
  rõ trên terminal (`API key sai hoặc hết hạn — kiểm tra AI_GEMINI_API_KEY trong .env`); máy chủ lỗi / mất mạng / quá 20 giây
  → nghỉ 20 s rồi tăng dần (nếu provider dự phòng chỉ được vài giây vì cảnh sắp hết hạn thì không bị tính lỗi).
- App cũng **tự đếm** lượt/ngày và token/ngày của từng provider (Gemini theo ngày Pacific, provider khác theo ngày Việt Nam —
  xấp xỉ; lưu lại khi khởi động lại) và dừng trước khi chạm `AI_*_RPD` / `AI_*_TPD`.
- Gói miễn phí của Groq còn giới hạn **token ra mỗi phút theo từng model** (vd `qwen/qwen3.8-27b`: 1.000 token/phút). Gặp lỗi
  "Request too large", app tự hạ `max_completion_tokens` của provider đó xuống dưới trần (nhớ 7 ngày) và **thử lại ngay** — không bị
  nghỉ 30 giây, không rơi về thoại offline một cách vô ích.
- Hết **tất cả** provider → cảnh dùng **câu thoại mẫu offline**, văn phòng vẫn chạy; provider nào hồi lại thì AI viết tiếp.
- Muốn một provider "xịn" (ví dụ OpenAI trả tiền) chỉ dành cho việc quan trọng (đuổi việc, phỏng vấn, bản tin cuối ngày,
  tạo ứng viên) thì đặt `AI_OPENAI_TIER=strong` — cảnh thường vẫn đi provider miễn phí.

### 3.6 Chip 🤖 AI — chỉ admin thấy

- Người xem thường chỉ thấy **một chấm** cạnh "TRỰC TIẾP": **xanh** = AI đang viết thoại, **xám** = đang dùng câu mẫu. Server
  lược bỏ mọi số liệu hệ thống (tên nguồn, model, lượt gọi, token, chi phí, lỗi, số bấm link) trước khi gửi xuống trình duyệt thường.
- Mở trang kèm **mã dev** (mục 8) thì góc trên có thêm chip **🤖 AI · Gemini · 12 lượt**: rê chuột / bấm để xem từng nguồn (sẵn sàng /
  giữ nhịp / nghỉ vì sao, mở lại lúc mấy giờ, đã dùng bao nhiêu lượt/token), lượt gọi (lỗi), token vào/ra, chi phí, cảnh bỏ qua,
  **lỗi gần nhất**. **🧪 Offline · câu thoại mẫu** = không nguồn nào gọi được lúc này; nguồn hồi lại thì chip tự đổi về 🤖.
- Cùng dữ liệu đó ở `http://localhost:3000/api/stats?dev=<mã dev>` (trường `ai.providers`); không có mã thì địa chỉ này trả 404.

### 3.7 Dùng OpenAI (trả tiền, tuỳ chọn)

Thêm `openai` vào `AI_PROVIDERS` (ví dụ `gemini,groq,openai`) và điền `AI_OPENAI_API_KEY=sk-...`, `AI_OPENAI_MODEL=gpt-4o-mini`
(key tạo ở https://platform.openai.com/api-keys, nạp ít tiền). Có sẵn bảng giá cho `gpt-4o-mini`, `gpt-4.1-mini`,
`gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`; model khác thì khai giá bằng `AI_OPENAI_PRICE_INPUT_PER_M` /
`AI_OPENAI_PRICE_CACHED_INPUT_PER_M` / `AI_OPENAI_PRICE_OUTPUT_PER_M` (USD / 1 triệu token). Model "suy luận"
(`gpt-5*`, `o*`) có thêm `AI_OPENAI_REASONING_EFFORT=minimal|low`. Cách cũ (`OPENAI_API_KEY`, `OPENAI_MODEL`,
`OPENAI_BASE_URL`) vẫn chạy nếu bạn để trống `AI_PROVIDERS`.

**An toàn:** key chỉ nằm trên server, không bao giờ gửi xuống trình duyệt hay in ra log (lỗi được che `***`). Đừng đưa file
`.env` lên GitHub (đã có sẵn trong `.gitignore`). Nếu AI lỗi, hết lượt hay chậm, cảnh đó tự chuyển sang thoại offline —
văn phòng không bao giờ "đứng hình".

---

## 4. Tiết kiệm token & chi phí dự kiến

Với Gemini + Groq miễn phí, **chi phí = 0 đồng** — thứ cần tiết kiệm là *số lượt gọi mỗi ngày*. Các nút dưới đây áp dụng cho mọi
provider; phần ước tính tiền chỉ liên quan khi bạn dùng OpenAI trả tiền.

AI chỉ được gọi ở "khoảnh khắc thú vị" và **mỗi lần gọi viết cả một cảnh**. Các nút điều chỉnh trong `.env`:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DAILY_BUDGET_USD` | `1` | Trần chi phí mỗi ngày (theo giờ Việt Nam, tính chung mọi provider; provider miễn phí = $0). Chạm trần: cảnh thường tạm nghỉ, cảnh quan trọng (HR, sếp bắt quả tang, sự cố) dùng thoại offline |
| `LLM_ONLY_WHEN_WATCHED` | `true` | Không ai mở trang thì **không gọi GPT** cho cảnh thường (văn phòng vẫn chạy, chỉ yên tĩnh hơn) |
| `MIN_SECONDS_BETWEEN_LLM` | `20` | Tối thiểu bao nhiêu giây giữa 2 lần gọi GPT cho cảnh thường (cảnh "vừa" là một nửa) |
| `MAX_CONCURRENT_LLM` | `2` | Tối đa bao nhiêu lời gọi GPT cùng lúc |
| `OFFLINE_MIN_SECONDS` | `8` | (Chế độ offline) tối thiểu bao nhiêu giây giữa 2 cảnh thường |
| `AI_<TÊN>_RPM` / `_RPD` / `_TPD` | theo provider | Mức app tự giữ cho từng provider: lượt/phút, lượt/ngày, token/ngày — chạm mức là chuyển provider khác, không đụng trần thật của nhà cung cấp |

Ngoài ra hệ thống tự: dùng **prompt hệ thống cố định** (~3.300 token) để OpenAI tự cache (rẻ một nửa), prompt cảnh gọn
(~700–1.300 token), tự "nghỉ" vài phút khi API lỗi liên tục, và đếm token/chi phí thật từ OpenAI.

**Ước tính với `gpt-4o-mini`:**

- Một cảnh ≈ **0,0007 USD** (~4.000 token vào, phần lớn được cache + ~400 token ra).
- Khi có người xem: khoảng 100–120 cảnh/giờ ≈ **0,08 USD/giờ** (khoảng 2.000 đồng).
- Với `DAILY_BUDGET_USD=1`: đủ khoảng **12 giờ có người xem mỗi ngày**; bản tin cuối ngày và hồ sơ ứng viên tốn không đáng kể.
- `gpt-4.1-mini` đắt gấp khoảng 2 lần.

Theo dõi chi phí: mở trang kèm mã dev (mục 8) rồi rê chuột / bấm vào chip **🤖 AI** ở góc trên bên phải bản đồ (lượt gọi, token
vào/ra, token được cache, chi phí hôm nay / tổng, số cảnh đã bỏ qua để tiết kiệm, lỗi gần nhất), hoặc mở
`http://localhost:3000/api/stats?dev=<mã dev>`.

Muốn xem GPT nhận prompt gì: chạy `DEBUG_PROMPTS=1 npm start` (in prompt + phản hồi ra terminal; chỉ dùng khi thử nghiệm).

---

## 5. Phòng trưng bày & link Shopee tiếp thị liên kết

Góc trên bên trái văn phòng là **phòng trưng bày** với 2 kệ: **LÀM ĐẸP** (trái) và **CÔNG NGHỆ** (phải). Đây là chỗ bạn
bày những món **bạn thật sự đang dùng và thấy tốt**, mỗi món gắn link affiliate của bạn. Sản phẩm xuất hiện ở 4 nơi:

1. **Trên kệ** (bản đồ): rê chuột → tên + giá + "Xem trên Shopee ↗"; bấm → mở link ở tab mới.
2. **Tab 🛍️ Sản phẩm**: liệt kê theo 2 nhóm, kèm nhận xét của bạn và nút mua.
3. **Cảnh "Khoe đồ ở phòng trưng bày" 🛍️**: nhân viên thỉnh thoảng ra ngắm kệ; khi có ≥ 2 người đứng đó (hoặc theo lịch,
   Trâm bên marketing rủ 1–2 người qua xem) thì một cảnh nổ ra: một người kể trải nghiệm thật với món đồ — **chất liệu là
   câu nhận xét của bạn** — người kia khịa "ăn hoa hồng hả", hỏi giá (không ai nói giá), "để tối săn sale"… Câu nhắc món đồ có
   **chip link** ngay dưới.
4. Như trước: món đồ được nhắc tự nhiên trong cảnh tám ở pantry / ăn trưa / nhóm chat / ăn mừng, và mỗi nhân vật có một
   "món đồ trên bàn" trong hồ sơ.

Mọi chip / nút đều ghi rõ "Link tiếp thị liên kết".

### 5.1 Thêm sản phẩm thật của bạn

Danh sách nằm ở **`data/products.json`** (có sẵn 16 món MẪU — 7 làm đẹp, 9 công nghệ — link đang là link *tìm kiếm* Shopee;
bạn thay bằng đồ của mình). Mỗi món:

```json
{
  "id": "tai-nghe-chong-on",
  "name": "Tai nghe chống ồn chụp tai",
  "emoji": "🎧",
  "category": "cong-nghe",
  "slot": 1,
  "note": "Mình xài ba tháng rồi, pin trâu, đeo cả ngày không đau tai, bật chống ồn là văn phòng im bặt.",
  "pitch": "đeo vô là cả văn phòng im bặt, tập trung code nguyên buổi",
  "priceHint": "~1,2tr",
  "tags": ["tai-nghe", "dev", "cong-nghe", "van-phong"],
  "url": "https://s.shopee.vn/LINK-AFFILIATE-CUA-BAN"
}
```

| Trường | Ý nghĩa |
|---|---|
| `id` | Mã duy nhất: chữ thường, không dấu, nối bằng `-`. **Đừng đổi id của món đang có** — thống kê click và "món đồ trên bàn" của nhân vật (`src/content/roster.ts`) dùng id này |
| `name`, `emoji` | Tên hiển thị + emoji vẽ trên kệ khi chưa có ảnh (nhân vật gọi kiểu đời thường, không đọc nguyên tên) |
| `category` | `lam-dep` → kệ LÀM ĐẸP, `cong-nghe` → kệ CÔNG NGHỆ. (`shelf` = `beauty` / `tech` tự suy ra, không cần ghi) |
| `slot` | Vị trí trên kệ, đếm từ **0**, không trùng trong cùng kệ. **Slot 0–4 được vẽ trên kệ**; từ 5 trở lên chỉ hiện trong tab 🛍️. Bỏ trống thì server tự xếp theo thứ tự trong file |
| `note` | **1 câu nhận xét thật của bạn**, xưng "mình" (nhân vật tự đổi thành em/anh/chị khi kể). Hiện nguyên văn trong tab 🛍️ và là chất liệu cho cảnh khoe đồ. Không giá, không link |
| `pitch` | Câu khen ngắn, viết thường, cho các cảnh khác lồng vào thoại. Không giá, không link |
| `priceHint` | Chỉ hiển thị trên chip / tooltip, AI không đọc |
| `url` | **Link tiếp thị liên kết của bạn** (lấy trong Shopee Affiliate). Chỉ server biết; trình duyệt luôn đi qua `/go/<id>` |
| `image` | Tuỳ chọn: URL ảnh `https://…`. Không có thì vẽ emoji |
| `tags` | Từ khoá để chọn món hợp ngữ cảnh trong các cảnh khác: `lam-dep`, `my-pham`, `thoi-trang`, `massage`, `suc-khoe`, `dev`, `ban-phim`, `chuot`, `tai-nghe`, `man-hinh`, `sac`, `dien-thoai`, `gaming`, `karaoke`, `livestream`, `du-lich`, `qua-tang`, `van-phong`… |

Thêm / bớt món thoải mái (mỗi kệ bao nhiêu món cũng được), sửa xong **khởi động lại server**. Món nào sai định dạng sẽ bị bỏ
qua (có cảnh báo trên terminal nói rõ sai gì), không làm sập web. Phần `_huong_dan` trong file cũng giải thích từng trường.

### 5.2 Khi nào nhân viên nhắc sản phẩm?

- **Cảnh khoe đồ ở phòng trưng bày**: tự nổ ra khi ≥ 2 người đang đứng ở phòng trưng bày, cộng thêm lịch ~2–3 giờ game một
  lần (Trâm rủ đồng nghiệp qua xem). Giới hạn **1 cảnh / 30 phút thật** — đổi bằng `SHOWROOM_SCENE_MIN_MINUTES` trong `.env`
  (đặt `0` để bỏ giới hạn). Cảnh luôn có **đúng 1 câu** nhắc món đồ (kèm chip), không bao giờ nói giá hay đọc link.
- **Các cảnh khác**: tối đa khoảng **8 phút một lần** (`PRODUCT_MENTION_MIN_MINUTES`), 50% cơ hội, chỉ trong cảnh hợp và chỉ hiện
  chip khi nhân vật **thật sự nhắc** tới món đồ.

### 5.3 Click được đếm ở đâu?

Mọi link trên trang đều đi qua server: **`/go/<id>?src=<nguồn>`** → server ghi nhận rồi chuyển (302) sang link Shopee của bạn
(chỉ chuyển tới link có trong `products.json`, không ai lợi dụng làm link chuyển hướng lung tung được). Nguồn `src`:

| `src` | Người xem bấm ở đâu |
|---|---|
| `showroom` | món đồ trên kệ ở bản đồ |
| `sidebar` | tab 🛍️ Sản phẩm |
| `scene` | chip dưới câu thoại trong tab 💬 |
| `desk` | "món đồ trên bàn" trong hồ sơ nhân vật |

- Mỗi click in ra terminal: `[click] tai-nghe-chong-on (nguồn: showroom) — tổng 12`
- Tổng số click: rê chuột vào chip **👀** trên trang (dòng này chỉ hiện cho admin có mã dev; người xem thường không thấy).
- Chi tiết: **`http://localhost:3000/api/stats?dev=<mã dev>`** → `clicks` (tổng), `clicksBy` theo từng sản phẩm, `clicksBySource` theo nguồn
  (`showroom` / `sidebar` / `scene` / `desk`) và `clicksByProductSource` theo từng sản phẩm × nguồn — để bạn biết kệ, tab hay thoại
  kéo click tốt hơn.
- Số liệu được lưu trong `data/state.json` (không mất khi khởi động lại). Hoa hồng thật thì xem trong trang Shopee Affiliate.

---

## 6. Câu chuyện tự phát triển (v3) — không kịch bản, AI quyết, vẫn hợp lý

Từ v3, văn phòng **không còn mạch cố định** kiểu "Tú lười → bị nhắc → bị đuổi ngày 5 → tuyển người mới". Chuyện gì xảy ra,
với ai, lúc nào là ngẫu nhiên nhưng luôn có lý — và bạn tinh chỉnh được bằng `.env`.

### 6.1 Không ai bị "đánh dấu" trước

- **Tính cách ngẫu nhiên lần đầu**: khi tạo văn phòng mới, mỗi nét tính cách = giá trị trong roster ± 0,15 (Tú không còn
  "lười 0,8" cố định). Giá trị gốc được lưu (`traitBase`) để tính cách chỉ **trôi quanh đó** (±0,25), không bay quá xa.
- **Ngày hên / xui**: mỗi người mỗi ngày có hệ số 0,55–1,2 nhân vào KPI, kèm **sự kiện cá nhân hiếm** có log để bạn hiểu vì sao
  (🤒 sốt vẫn đi làm, 🛵 kẹt xe gần tiếng, 💔 vừa chia tay, 🎟️ trúng vé số nhỏ bao trà sữa…).
- **Tính cách trôi theo chuyện xảy ra**: bị HR nhắc → chăm hơn một chút trong 3 ngày; được khen / thưởng → tham vọng hơn; sếp vắng
  cả buổi mà không bị bắt → lười hơn 0,01/ngày; bị bắt quả tang → bớt lười; bị khịa nhiều → nóng tính hơn.
  Tắt bằng `STORY_TRAIT_DRIFT=false`; tắt ngẫu nhiên hoá lần đầu bằng `STORY_RANDOMIZE_TRAITS=false`.

### 6.2 Nhân sự do AI quyết — code chỉ làm hàng rào

Thay cho luật cứng, cứ **`HR_REVIEW_EVERY_DAYS` ngày** (mặc định 3) vào ~10:30 có cảnh **⚖️ Họp xét nhân sự**: HR mang sổ vào phòng
Giám đốc. Họp **sớm hơn** khi có lý do: ai đó KPI thấp 2 ngày liền, đã bị nhắc mà vẫn thấp, tâm trạng tệ 3 ngày liền, doanh thu rơi
xuống dưới 50 % (hoặc vượt 120 %) nhịp mục tiêu tháng. Nút dev 📋 ép họp ngay.

AI nhận **hồ sơ từng người** (KPI 7 ngày, chuỗi ngày thấp, số lần bị nhắc, bị bắt lười, tâm trạng, ký ức gần đây) kèm danh sách
**hành động được phép** với người đó, rồi trả về các quyết định + lý do 1 câu. Code không tin AI mù quáng — mỗi quyết định phải
qua **hàng rào hợp lý** (quyết định không hợp lệ bị gác lại, có dòng hệ thống ⚖️ giải thích):

| Quyết định | Chỉ được phép khi |
|---|---|
| `warn` nhắc nhở | KPI thấp ≥ 1 ngày liền |
| `probation` thử thách 5 ngày | KPI thấp ≥ 1 ngày và chưa trong diện thử thách |
| `second_chance` cho cơ hội | đang thấp hoặc đã bị nhắc (chỉ ghi nhớ + tâm trạng, không phạt) |
| `fire` cho nghỉ | KPI thấp ≥ 2 ngày liền **và** (đã bị nhắc **hoặc** thấp ≥ `KPI_FIRE_DAYS` ngày) **và** vào làm ≥ 3 ngày **và** 2 ngày qua chưa ai bị cho nghỉ |
| `praise` khen trước sếp | KPI trung bình 7 ngày ≥ 100 %, chưa được khen 3 ngày |
| `bonus` thưởng nóng | KPI trung bình 7 ngày ≥ 100 %, chưa được thưởng 7 ngày |
| `promote` thăng chức | KPI trung bình ≥ 115 % trên ≥ 5 ngày, thâm niên ≥ 10 ngày, cả công ty ≤ 1 lần / 7 ngày |
| `layoff` cắt giảm | doanh thu < 50 % nhịp mục tiêu **2 kỳ xét liên tiếp**, cùng giới hạn "≤ 1 người nghỉ / 2 ngày" với `fire` |
| `open_position` tuyển thêm | doanh thu ≥ 80 % nhịp, dưới 12 người, chưa có vị trí trống, **còn bàn trống** (bản đồ hiện có 10 bàn → chỉ xảy ra khi thêm bàn) |
| `none` | luôn được phép |

Mỗi lần họp tối đa 4 quyết định, ≤ 1 cho nghỉ / cắt giảm, ≤ 1 thăng chức. Kết quả đi thành cảnh thật: nhắc nhở (⚠️), cho nghỉ (📦 ôm
thùng ra cửa → phỏng vấn → chào người mới), 🎖️ thăng chức (chức danh mới, chỉ tiêu +10 %), 💰 thưởng (ăn mừng ở góc chill), 📉 cắt giảm
(vai trò đóng băng vài ngày rồi mới tuyển lại). `KPI_WARN_DAYS` / `KPI_FIRE_DAYS` không còn là luật cứng mà là **mốc tối thiểu của hàng rào**.

**Không có key AI** thì sao? HR vẫn họp và quyết theo **xác suất có trọng số** trong các hành động được phép: càng vượt mốc
`KPI_WARN_DAYS` / `KPI_FIRE_DAYS` càng dễ bị nhắc / cho nghỉ, nhưng không bao giờ chắc chắn 100 % — ai bị, ngày nào bị là chuyện
ngẫu nhiên, có hạt giống mô phỏng 12 ngày không ai bị đuổi cả.

### 6.3 Những ngả rẽ khác

- 🚪 **Xin nghỉ**: tâm trạng dưới 25 ba ngày liền **và** ghét sếp (quan hệ ≤ −30) → HR mời nói chuyện riêng; AI quyết **ở lại** (được
  an ủi, quan hệ với HR ấm lên) hay **đi thật** (rời công ty ngay, cả nhóm chat xôn xao, vài ngày sau mới phỏng vấn người thay).
- 💵 **Xin tăng lương**: KPI trung bình 7 ngày ≥ 110 % và tham vọng cao → gõ cửa sếp; **đồng ý** (tâm trạng +20, có khi chỉ tiêu nhích 5 %)
  hay **từ chối khéo** (tâm trạng −10, quan hệ với sếp −10). Mỗi người hỏi lại sau ≥ 10 ngày.
- Mọi quyết định, mạch truyện, tin đã bàn đều được ghi vào **archive** (mục 8) để sau này làm trang "Lịch sử công ty".

### 6.4 AI biên kịch (showrunner)

Mỗi **`SHOWRUNNER_EVERY_GAME_MINUTES`** phút game (mặc định 120, chỉ trong giờ làm) AI nhận một bức tranh ngắn (KPI dẫn đầu / đuối,
quan hệ nổi bật, dự án, doanh thu, tin đồn, tin thời sự vừa bàn) và chọn **1–3 "biến"** từ thực đơn 17 loại:
`conflict` (bất đồng), `viral` (clip lên xu hướng), `big_bug`, `client_angry`, `secret_friendship`, `crush_rumor` (trong sáng),
`raise_request`, `resign_threat`, `boss_mood_swing`, `team_building`, `new_client_deal`, `overtime_week`, `office_prank`,
`lost_item`, `sick_day`, `karaoke_night`, `pitch_contest`. Mỗi biến thành một **mạch** 1–3 bước kéo dài vài giờ (ghé bàn căng → nhóm chat
bàn tán → làm hoà…), tối đa 2 mạch mở cùng lúc, mỗi bước có xác suất "không xảy ra" để không gượng; mạch kết để lại ký ức cho người
liên quan. Người xem chỉ thấy đời sống văn phòng; chỉ mạch đậm mới có một dòng 🎬 như tiêu đề chương (≤ 2 dòng/ngày).
Nút dev 🎬 ép lên biến ngay. Không có AI → biên kịch offline chọn ngẫu nhiên theo tình hình (deadline sát → tăng ca / bug lớn; ai đó
buồn → úp mở nghỉ việc; doanh thu tốt → team building…). Tắt bằng `SHOWRUNNER_ENABLED=false`.

### 6.5 Tinh chỉnh

| Biến `.env` | Mặc định | Ý nghĩa |
|---|---|---|
| `HR_REVIEW_EVERY_DAYS` | `3` | nhịp họp xét nhân sự định kỳ (ngày game) |
| `KPI_WARN_DAYS` / `KPI_FIRE_DAYS` | `2` / `3` | mốc tối thiểu của hàng rào + điểm neo cho chính sách offline |
| `STORY_RANDOMIZE_TRAITS` | `true` | tính cách lần đầu = roster ± 0,15 |
| `STORY_TRAIT_DRIFT` | `true` | tính cách trôi theo sự kiện |
| `SHOWRUNNER_ENABLED` | `true` | bật / tắt AI biên kịch |
| `SHOWRUNNER_EVERY_GAME_MINUTES` | `120` | nhịp lên biến (phút game) |

Muốn drama dày hơn: hạ `SHOWRUNNER_EVERY_GAME_MINUTES` xuống 60–90, `HR_REVIEW_EVERY_DAYS=2`. Muốn yên bình: tăng lên 180–240,
`HR_REVIEW_EVERY_DAYS=5`.

---

## 7. Thời sự (v3) — nhân vật bàn tin thật, an toàn pháp lý

Thỉnh thoảng (tối đa 1 lần mỗi **`NEWS_SCENE_MIN_MINUTES`** phút thật, mặc định 25) có cảnh **🗞️ Tám chuyện thời sự**: 2–4 người ở pantry /
góc chill (hoặc trong nhóm chat kín nếu văn phòng đang bận cảnh khác) bàn về **một tin thật** lấy từ RSS báo chính thống
(VnExpress, Tuổi Trẻ, Thanh Niên, GameK — thể thao, bóng đá, công nghệ, game, khoa học, giải trí nhẹ). Người được chọn hợp sở thích:
Phát mê bóng đá, Bảo & Tùng game / crypto, Khoa công nghệ, Trâm & Linh trend / showbiz, Vy khoa học… nhưng ai cũng có thể hóng.
Ngoài ra 1/3 số lần tám chuyện / ăn trưa có gợi ý "nghe nói…" từ một tiêu đề báo để thời sự len vào tự nhiên.

**An toàn**: thẻ cảnh luôn hiện **tin gốc** (tiêu đề · nguồn · "Đọc bài ↗") để người xem tự kiểm chứng; prompt bắt AI **chỉ bình luận
cảm nghĩ / ý kiến về đúng nội dung báo đăng**, không bịa chi tiết, con số, phát ngôn, không kết luận ai đúng / sai, không nói đời tư,
không công kích người thật; tin có từ khoá nhạy cảm (án, khởi tố, ma túy, tai nạn chết người, chính trị, tôn giáo, ly hôn, scandal…)
bị lọc ở kho tin **và** lọc lần hai trước khi dựng cảnh; mỗi tin chỉ bàn một lần; tin quá `NEWS_MAX_AGE_DAYS` ngày (3) bị bỏ.
Nhân vật AI chỉ nói cảm nghĩ về tin đã đăng — không phải phát ngôn hay sự thật. Nút dev 🗞️ ép một cảnh ngay.

| Biến `.env` | Mặc định | Ý nghĩa |
|---|---|---|
| `NEWS_ENABLED` | `true` | `false` = không tải tin, không có cảnh thời sự |
| `NEWS_FEEDS` | danh sách đã kiểm tra trong `docs/v3-news.md` | `nhom|url,nhom|url` (nhóm: `the_thao`, `cong_nghe`, `game`, `khoa_hoc`, `giai_tri`) |
| `NEWS_REFRESH_MINUTES` | `45` | nhịp tải lại RSS |
| `NEWS_SCENE_MIN_MINUTES` | `25` | tối thiểu phút THẬT giữa 2 cảnh thời sự (0 = không giới hạn) |
| `NEWS_ALLOW_SHOWBIZ` | `true` | `false` = bỏ hẳn nhóm giải trí |
| `NEWS_MAX_AGE_DAYS` | `3` | không bàn tin cũ hơn |
| `NEWS_BLOCKLIST` | (trống) | thêm từ / cụm từ chặn, phân cách bằng dấu phẩy |

---

## 8. Lưu trữ dài hạn & bảng dev trên production (v3)

- **Archive nối tiếp**: mọi dòng thoại, sự kiện, bản tin, KPI cuối ngày, **quyết định nhân sự**, **biến của AI biên kịch**, **tin đã bàn**
  được ghi vào `data/history/YYYY-MM-DD.jsonl` (một dòng JSON mỗi bản ghi, ~50 KB/ngày), gzip sau `HISTORY_GZIP_AFTER_DAYS` (7) và
  xoá sau `HISTORY_KEEP_DAYS` (180) — không bao giờ phình. Tắt bằng `HISTORY_ENABLED=false`, đổi chỗ bằng `HISTORY_DIR`.
  File trạng thái sống `data/state.json` vẫn nhỏ (có trần) như cũ.
- **Mã dev `DEV_TOKEN`**: đặt `DEV_TOKEN=mot-chuoi-bi-mat` trong `.env` → chỉ trình duyệt mở trang với **`#dev=mot-chuoi-bi-mat`**
  (khuyên dùng — phần sau `#` không bao giờ gửi lên máy chủ / Cloudflare nên không lọt vào access log; dạng `?dev=…` vẫn chạy) mới thấy
  bảng dev và bấm được nút; mã được cất lâu dài trong trình duyệt (cookie HttpOnly do server đặt + `localStorage`) nên **chỉ cần vào bằng link 1 lần**, các lần sau
  mở `corp.vibe-coder.fun` bình thường vẫn là admin cho tới khi bấm **🚪 Thoát admin** ở bảng dev (hoặc mở trang với `#dev=` rỗng);
  mã được gỡ khỏi thanh địa chỉ, không bao giờ in ra log. nginx của bản deploy
  tắt access log cho `/ws` và cho yêu cầu có `?dev=` (`deploy/nginx.site.conf`). Để trống = như cũ (`DEV_PANEL` quyết định cho mọi
  người); `DEV_PANEL=false` = tắt hẳn cho tất cả.
- **Admin thấy gì hơn người xem thường**: chip 🤖 AI (nguồn, model, lượt gọi, lỗi…), số lượt bấm link trong chip 👀, nhãn "AI chấp bút /
  Bản tin mẫu" ở tab Bản tin, bảng dev. Server chỉ gửi các số liệu này cho kết nối có mã dev; `/api/stats` cũng cần `?dev=<mã>`.

---

## 9. Bảng dev (góc dưới bên trái)

| Nút | Tác dụng |
|---|---|
| x1 x2 x5 x10 | Tua nhanh thời gian |
| 🏌️ / 🚶 | Sếp đi vắng / sếp về (cả phòng giả vờ làm việc) |
| 🔥 / 📶 | Sập server (team dev lao vào cứu) / mất wifi |
| 💸 / 🎂 / 💰 | Ngày lương / sinh nhật một người / chốt deal |
| 🤫 | Tạo drama (đối chất vì tin đồn hoặc nói xấu sau lưng) |
| 📋 | HR + sếp họp xét nhân sự ngay (AI quyết trong hàng rào — có thể nhắc, thử thách, khen, thưởng, thăng chức, cho nghỉ… hoặc không ai bị gì) |
| 🗞️ / 🎬 | Ép một cảnh tám chuyện thời sự / ép AI biên kịch lên biến mới (v3) |
| 🚀 / 🌙 | Release dự án / kết thúc ngày ngay (ra bản tin) |

⚠️ Khi đưa lên mạng cho người khác xem: đặt **`DEV_TOKEN`** (mục 8) để chỉ bạn bấm được, hoặc **`DEV_PANEL=false`** để tắt hẳn —
nếu không ai vào xem cũng bấm được các nút này.

---

## 10. Chế độ thời gian

- **`TIME_MODE=compressed`** (mặc định): thời gian nén. `GAME_MINUTES_PER_SECOND=0.5` nghĩa là 1 giây thật = 30 giây
  trong game → một ngày làm việc (07:30–18:30) mất khoảng **22 phút thật**; buổi tối không ai ở văn phòng thì tự nhảy sang
  sáng hôm sau. Ngày nào cũng là ngày làm việc (Thứ Hai → Thứ Sáu lặp lại).
- **`TIME_MODE=realtime`**: chạy theo **giờ thật Việt Nam** — 9 giờ sáng thật thì văn phòng cũng 9 giờ, Thứ Bảy / Chủ Nhật
  văn phòng đóng cửa, không tua nhanh được. Hợp để "livestream" lâu dài cho người xem ghé vào bất kỳ lúc nào.

Các chỉnh khác: `KPI_LOW_RATIO=0.7` (dưới 70% mục tiêu là KPI thấp), `KPI_WARN_DAYS=2` / `KPI_FIRE_DAYS=3` (từ v3 là mốc tối thiểu
của hàng rào nhân sự — xem mục 6.2; sếp và HR không bao giờ bị đuổi),
`COMPANY_NAME` (mặc định `Cty TNHH VibeCorp`; hiện ở sidebar, logo sàn và trong lời thoại), `SHOWROOM_SCENE_MIN_MINUTES=30`
(nhịp tối thiểu giữa 2 cảnh khoe đồ ở phòng trưng bày, phút thật), `PORT`, `PERSIST` / `STATE_FILE` (lưu trạng thái).

Muốn **làm lại văn phòng từ đầu**: tắt server, xoá file `data/state.json`, bật lại. Nếu file trạng thái bị hỏng, server
tự đổi tên nó thành `state.json.bad-<thời gian>` và mở văn phòng mới (không bao giờ kẹt vì file hỏng).

---

## 11. Đưa lên mạng (gợi ý)

- Máy chủ có Node 20+, chạy `npm install` rồi `npm start` (nên dùng `pm2` hoặc `systemd` để tự bật lại khi máy khởi động).
- Đặt sau Nginx / Caddy, nhớ bật chuyển tiếp **WebSocket** cho đường dẫn `/ws`.
- `.env` production: `DEV_TOKEN=<chuỗi bí mật>` (hoặc `DEV_PANEL=false`), `PERSIST=true`, `HISTORY_ENABLED=true`, đặt `DAILY_BUDGET_USD` theo túi tiền.
- Một server phục vụ bao nhiêu người xem cũng được: **chi phí GPT không tăng theo số người xem** (mọi người xem chung một văn phòng).
- Kiểm tra sống: `GET /api/health` → `{"ok":true,"mode":"llm","viewers":3,"day":5,"minute":612}` (`mode` = `llm` khi có ít nhất một provider có key).

---

## 12. Kiểm tra / test

```bash
npm run typecheck    # kiểm tra kiểu TypeScript
npm run smoke        # chạy văn phòng không cần trình duyệt ≥ 6 ngày game (offline, ~6 giây) và kiểm tra mọi thứ
npm run smoke:story  # v3: 6 hạt giống × 12 ngày game (offline, ~30 giây): họp xét nhân sự + hàng rào, thời sự, AI biên kịch, không ai bị "đánh dấu"
npm run test:news    # v3: đọc RSS mẫu, bộ lọc an toàn, kho tin (không mạng)
npm run test:llm     # test đường AI với một server OpenAI GIẢ LẬP (không tốn tiền, không cần key)
npm run test:router  # test chuyển đổi nhiều nhà cung cấp (Gemini → Groq → offline) với 2 server giả lập
npm test             # chạy cả 6
```

`npm run smoke` in ra bảng: số cảnh theo loại, câu thoại mẫu, KPI từng người từng ngày, ai bị đuổi / được tuyển, tin đồn…
Có thể chạy lại y hệt một lần chạy bằng `SMOKE_SEED=123 npm run smoke`. `npm run smoke:story` kiểm tra lại **từng quyết định nhân sự**
bằng bộ hàng rào viết độc lập (không tin Director), đòi mỗi hạt có ≥ 1 cảnh thời sự kèm thẻ tin, ≥ 3 biến của biên kịch, và qua các
hạt người bị nhắc / cho nghỉ phải khác nhau, có hạt không đuổi ai (`SMOKE_STORY_SEED=123 SMOKE_STORY_SEEDS=3 npm run smoke:story`).

---

## 13. Cấu trúc dự án

```
src/
  server.ts            web server: trang web, /go/:id (link affiliate), /api/health, /api/stats, WebSocket /ws (+ ?dev=TOKEN), lưu trạng thái
  config.ts            đọc cấu hình từ .env
  types.ts             "hợp đồng" dữ liệu dùng chung (SPEC.md giải thích chi tiết)
  sim/world.ts         "thân xác" văn phòng: đồng hồ, đi lại, lịch làm việc, KPI, sếp, dự án, doanh thu, lưu/khôi phục
  sim/behavior.ts      bảng hoạt động + cách mỗi người chọn việc (chăm / lười / nhiều chuyện…)
  sim/director.ts      "đạo diễn": lên lịch cảnh, thi hành quyết định nhân sự (hàng rào), thời sự, mạch truyện, sự kiện, tin đồn, sản phẩm, bản tin
  sim/scenes.ts        các loại cảnh + viết "tình huống" cho AI;   sim/rumors.ts: tin đồn tam sao thất bản
  sim/hr.ts            v3: hàng rào hợp lý cho quyết định nhân sự, hồ sơ xét duyệt, chính sách offline ngẫu nhiên, vị trí trống
  sim/story.ts         v3: AI biên kịch — yêu cầu lên biến, sổ mạch truyện, ánh xạ biến → cảnh / sự kiện, kế hoạch offline
  sim/archive.ts       v3: lưu trữ dài hạn data/history/YYYY-MM-DD.jsonl (xoay vòng, gzip, xoá cũ)
  news/                v3: tải RSS báo, lọc an toàn, kho tin cho cảnh thời sự
  sim/map.ts           bản đồ văn phòng 60×34 ô (phòng trưng bày + WC kín)
  sim/showroom.ts      dựng danh sách sản phẩm trên kệ cho trình duyệt (hello.products)
  ai/brain.ts          "bộ não": quyết định khi nào gọi AI, ngân sách, cầu dao, fallback offline
  ai/router.ts         nhiều nhà cung cấp: thứ tự ưu tiên, giới hạn RPM/RPD/TPD, nghỉ khi lỗi, chuyển provider trong cùng cảnh
  ai/llm.ts            1 client OpenAI-compatible cho mỗi provider (JSON schema, token/chi phí, che key)
  ai/prompts.ts        prompt tiếng Việt;  ai/schemas.ts: định dạng JSON;  ai/sanitize.ts: làm sạch kết quả GPT
  ai/offline.ts        bộ sinh thoại mẫu (khi chưa có key / GPT lỗi)
  content/roster.ts    10 nhân vật, quan hệ ban đầu, kho tên/ngoại hình cho ứng viên
  content/catalog.ts   thông tin công ty, dự án, chủ đề tám chuyện, lý do sếp vắng; v3: thực đơn biến, sự kiện cá nhân, sở thích theo nhóm tin
  content/products.ts  đọc data/products.json, danh sách cho phòng trưng bày (getShowroomProducts)
data/products.json     sản phẩm tiếp thị liên kết: 2 kệ phòng trưng bày + nhận xét của bạn (sửa link ở đây)
data/history/          v3: archive theo ngày (tự tạo, tự xoay vòng)
public/                giao diện (HTML + CSS + JavaScript thuần, vẽ bằng Canvas, không cần build)
scripts/               smoke.ts, smoke-story.ts (v3), test-news.ts (v3), test-llm.ts, test-router.ts
SPEC.md                tài liệu thiết kế chi tiết cho lập trình viên (docs/v3-news.md: thiết kế v3)
```

Muốn đổi tính cách nhân vật: sửa `src/content/roster.ts` (`bio`, `speechStyle`, `traits`…) — GPT đọc trực tiếp các mô tả này.

---

## 14. Hỏi nhanh

- **Thoại lặp lại?** Đang ở chế độ Offline (câu mẫu). Thêm key Gemini miễn phí vào `.env` (mục 3) để AI viết.
- **Chấm AI chuyển xám (admin: chip 🧪 Offline) giữa ngày?** Mọi nguồn đang "nghỉ" hoặc "giữ nhịp" (hết lượt miễn phí, hoặc đã xài quá phần cho phép tới giờ đó). Thêm nguồn (Groq, Cloudflare — mục 3), hoặc chờ: giữ nhịp mở lại dần theo giờ, Gemini reset 14–15h giờ Việt Nam. Terminal và `/api/stats?dev=<mã>` (`ai.providers[].cooldownReason`) nói rõ lý do và giờ mở lại.
- **Không ai mở web mà văn phòng vẫn chạy?** Đúng vậy — văn phòng sống liên tục; khi có GPT, lúc không ai xem chỉ cảnh quan trọng mới chạy (bằng thoại offline) để không tốn tiền.
- **Cổng 3000 bị chiếm?** Đổi `PORT=3001` trong `.env`.
- **Chip AI báo lỗi?** Mở trang kèm mã dev, rê chuột vào chip 🤖 xem "Lỗi gần nhất" (sai key, hết quota, model không tồn tại…) — lỗi ghi rõ provider nào và biến `.env` nào cần kiểm tra.
- **Không thấy cảnh thời sự?** Kho tin cần vài phút để tải RSS lần đầu; kiểm tra `NEWS_ENABLED=true`, mạng ra ngoài của máy chủ, và nhịp `NEWS_SCENE_MIN_MINUTES` (25 phút thật giữa 2 cảnh). Bấm 🗞️ trong bảng dev để ép một cảnh.
- **HR họp mà không ai bị gì?** Bình thường — hàng rào (mục 6.2) chỉ cho phép hành động khi có căn cứ; AI (hoặc chính sách offline) có quyền chọn "chưa động tới ai".

---

## 15. Ý tưởng phát triển tiếp

- **Kho cảnh viết sẵn**: lúc vắng người xem cho GPT viết trước vài cảnh "dự trữ" theo giờ rẻ, khi có người xem thì phát ngay — vừa rẻ vừa không phải chờ.
- **Khán giả bình chọn**: "Hôm nay ai bị sếp gọi lên phòng?", "Tuyển ứng viên A hay B?" — kết quả đưa vào kịch bản.
- **Đặt cược bằng xu ảo**: cược "Tú có bị đuổi trước thứ Sáu?", "Ai là nhân viên của ngày?" — tăng thời gian xem.
- **Clip highlight**: tự cắt đoạn drama (bắt quả tang, đối chất, đuổi việc) thành video ngắn / ảnh chat để đăng TikTok, Facebook.
- **Lưu trữ bằng database** (SQLite / Postgres): lịch sử nhiều tháng, "phim bộ" theo tuần, thống kê click theo ngày / theo cảnh.
- **Nhiều văn phòng / nhiều công ty** (agency quảng cáo, quán cà phê, bệnh viện…) với dàn nhân vật riêng.
- **Người xem "nhập vai"**: gửi lời nhắn ẩn danh vào nhóm chat, tặng trà sữa cho nhân vật yêu thích.
- **Bảng xếp hạng nhân viên**, trang hồ sơ công khai từng nhân vật, tóm tắt tuần bằng giọng đọc AI.
- **Đo hiệu quả affiliate**: so sánh tỉ lệ click theo loại cảnh / nhân vật / giờ để chọn sản phẩm hợp hơn.
