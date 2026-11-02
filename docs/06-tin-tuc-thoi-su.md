# Thời sự từ RSS & an toàn pháp lý

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `src/news/{feeds,filter,store,index}.ts`, phần tin trong `src/config.ts`, `src/content/catalog.ts`, `src/sim/director.ts`, `src/sim/scenes.ts`, `src/sim/story.ts` (`StoryContext.latestNews`), `src/ai/prompts.ts`, `src/ai/sanitize.ts`, `src/ai/offline.ts`, `src/server.ts` (`/api/news`), `public/js/ui/news.js` + `feed.js` + `store.js`, `scripts/test-news.ts` + `scripts/fixtures/news/` · Đọc khi: thêm/bỏ nguồn RSS, chỉnh bộ lọc từ khoá, đổi nhịp cảnh thời sự, sửa thẻ tin trên giao diện, hoặc khi có tin "không nên bàn" lọt ra màn hình.

Tài liệu này trả lời: tin thật đi từ RSS báo tới câu thoại của nhân vật qua những lớp nào, mỗi lớp chặn cái gì và vì sao, cấu hình ở đâu, kiểm thử thế nào, và **đâu là ranh giới pháp lý không được vượt** khi thêm nguồn hay nới bộ lọc. Thiết kế gốc (yêu cầu + nguyên tắc ban đầu) nằm ở [`v3-news.md`](v3-news.md) — tài liệu này mô tả **code hiện tại** và chỉ ra chỗ lệch với thiết kế/README/SPEC. Luồng cảnh nói chung xem [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md); lớp AI/prompt/sanitize nói chung xem [`05-lop-ai.md`](05-lop-ai.md); server/giao thức xem [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md); biến môi trường tổng hợp xem [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md); cách chạy test xem [`11-kiem-thu-qa.md`](11-kiem-thu-qa.md).

Quy ước trong tài liệu: "tin" = `NewsItem` (`src/types.ts:200-208`), "thẻ tin" = `NewsRef` (`types.ts:211`, chỉ `id/title/source/url/category`, không có `summary`), "nhóm tin" = `NewsCategory` (`types.ts:198`): `the_thao | bong_da | cong_nghe | game | khoa_hoc | giai_tri`.

---

## 1. Bức tranh tổng thể và RANH GIỚI PHÁP LÝ

### 1.1 Nguyên tắc của chủ dự án (nguyên tắc số 5)
Mọi nội dung thời sự phải **an toàn pháp lý**: nhân vật chỉ **bình luận cảm nghĩ về tin đã đăng** trên báo chính thống, **lọc bỏ tin nhạy cảm**, **không bịa thêm sự thật**, **không gán tội**, không bàn đời tư, không công kích người thật. Người xem luôn thấy **tin gốc** (tiêu đề · nguồn · link) để tự kiểm chứng, kèm **dòng miễn trừ** "Nhân vật AI chỉ bình luận cảm nghĩ về tin đã đăng trên báo; không phải phát ngôn hay sự thật được xác nhận."

Nói theo ngôn ngữ rủi ro (đây là thiết kế an toàn sản phẩm, **không phải tư vấn pháp lý** — khi nghi ngờ, hỏi chủ dự án):

| Rủi ro | Ví dụ điều KHÔNG được xảy ra | Lớp nào chặn |
|---|---|---|
| Gán tội / suy đoán có tội (người thật đang bị điều tra, tố cáo, kiện) | "Ông X chắc là lừa đảo thật" | §5 `BLOCKLIST`, `BLOCK_PATTERNS` ("tố", "kiện"), `PERSON_CONDUCT`; §7 `newsBlocked`; §9 `NEWS_BLOCK_RE`, `judgesNamedPerson` |
| Xâm phạm đời tư / hình thể | hẹn hò, ly hôn, mang thai, vóc dáng, bikini… | §5 `PRIVATE_LIFE` (mọi nhóm), `PRIVATE_PATTERNS` (vợ/chồng/con của người nổi tiếng) |
| Vu khống / xúc phạm người có tên | "ca sĩ Y làm màu", "cầu thủ Z ngu" | §5 `PERSON_CONDUCT` + `namesPerson`; §9 `JUDGEMENT_RE` + tên riêng trong tin |
| Bịa đặt phát ngôn / con số | "báo nói ông ấy thừa nhận…" (báo không nói) | §8 `NEWS_RULES` ("chi tiết nhắc lại chép đúng chữ báo, giữ mức dè dặt"), ký ức theo mẫu cố định (§9) |
| Chính trị, tôn giáo, xung đột, tang sự, tai nạn | Trump, Putin, Gaza, giáo hoàng, qua đời, tai nạn… | §5 `BLOCKLIST`; §7 `NEWS_BLOCK_PHRASES` |
| Người xem hiểu nhầm thoại là sự thật | — | §10 thẻ tin gốc luôn hiện + `NEWS_CAPTION` |

### 1.2 Phòng thủ nhiều lớp (defense in depth)
Không lớp nào được coi là đủ một mình; **không được bỏ một lớp vì "lớp kia đã lọc rồi"**.

```
RSS báo (NEWS_FEEDS / DEFAULT_NEWS_FEEDS, chỉ mục thể thao/công nghệ/game/khoa học/giải trí)   ← lớp 0: chọn nguồn & mục
  │  fetchText()  (src/news/feeds.ts)        timeout 10 s · ≤ 2 MB · 1 redirect · gzip/deflate/br · charset
  ▼
parseRss() → NewsItem (chưa lọc)              <item>/<entry>, CDATA, entity, bỏ HTML, ngày, id = sha1(url)[0..12], nhãn phụ bong_da
  ▼
sanitizeNewsItem() + filterNews()/judge()     ← lớp 1 (src/news/filter.ts): invalid · old · blocked · conduct · showbiz_off · showbiz
  ▼
NewsStore.byCat (≤ 40 tin/nhóm, mới nhất trước) → persist ≤ 12 tin/nhóm trong data/state.json (world.news)
  ▼
Director.peekNews() → store.pick([1 nhóm], Set(newsUsed)) → validNews()   ← lớp 2 (catalog.newsBlocked = NEWS_BLOCK_PHRASES ∪ blockedTopic)
  ▼
Draft.news → SceneRequest.news (+ sitNewsChat: NEWS_SAFETY_RULES, hạt giống phản ứng)
  │   └─ markNewsUsed → discussedNews[cuối] → storyCtx().latestNews → prompt lên beat của AI biên kịch (chỉ title ≤ 80, §7.8)
  ▼
Prompt: khối TIN + NEWS_RULES (user) · NEWS_RULES_SHORT (system)          ← lớp 3 (src/ai/prompts.ts)
  ▼
Brain → model (hoặc offline bNews: chỉ dùng tiêu đề + tên báo nguyên văn)
  ▼
sanitizeScene(): NEWS_BLOCK_RE · judgesNamedPerson · looksForeign · ký ức mẫu "Bàn tin … (nguồn)"   ← lớp 4 (src/ai/sanitize.ts)
  ▼
LogEntry.news (scene_start) · PublicScene.news · hello.news = recent(5)  →  client: thẻ 🗞️ + "Đọc bài ↗" + NEWS_CAPTION   ← lớp 5 (minh bạch)
  ▼
archive kind 'news' (data/history/*.jsonl) — truy vết tin nào đã bàn, ai bàn
```

Mỗi tin chỉ được bàn **một lần** (`markUsed` ở kho + `newsUsed` ở Director), không bàn tin cũ hơn `NEWS_MAX_AGE_DAYS` (3) ngày — vừa để đa dạng, vừa giảm rủi ro bàn tin đã bị báo gỡ/sửa.

---

## 2. Cấu hình và nguồn RSS mặc định

### 2.1 Biến môi trường (`src/config.ts:296-308`, mẫu ở `.env.example:104-119`)

| Biến | Mặc định | Kẹp | Trường `CONFIG` | Ai đọc | Ý nghĩa |
|---|---|---|---|---|---|
| `NEWS_ENABLED` | `true` | — | `newsEnabled` | `server.ts:256` (`news.start()`), Director (`director.ts:420`) | `false` → không tải RSS, không lên lịch `news_chat`, nút dev 🗞️ chỉ toast "Thời sự đang tắt" (`director.ts:2579-2581`) |
| `NEWS_FEEDS` | rỗng → `DEFAULT_NEWS_FEEDS` | — | `newsFeeds: {group,url}[]`, `newsFeedNotes: string[]` | `getNews()` (`store.ts:388`) | danh sách `nhom\|url` cách nhau bằng dấu phẩy **hoặc xuống dòng** (`config.ts:225`) |
| `NEWS_REFRESH_MINUTES` | `45` | `≥ 5` (config) và `≥ 1` phút (store `:139`) | `newsRefreshMinutes` | store | nhịp tải lại; lần đầu sau `firstFetchMs` = 20 s |
| `NEWS_SCENE_MIN_MINUTES` | `25` | `≥ 0` (0 = không giới hạn) | `newsSceneMinMinutes` | Director (`:421`) | phút **THẬT** tối thiểu giữa 2 cảnh `news_chat`, tính từ lúc **dựng** cảnh |
| `NEWS_ALLOW_SHOWBIZ` | `true` | — | `newsAllowShowbiz` | store (filter), Director (`newsCats`, `validNews`) | `false` → tin `giai_tri` bị `showbiz_off` ở kho **và** Director bỏ nhóm `giai_tri` khỏi vòng xoay |
| `NEWS_MAX_AGE_DAYS` | `3` | `≥ 0.5` | `newsMaxAgeDays` | filter (`old`), store `prune()`, Director `validNews` | tuổi tin tối đa theo `publishedAt` |
| `NEWS_BLOCKLIST` | rỗng | — | `newsBlocklist: string[]` (tách phẩy, `config.ts:244`) | filter qua `FilterOptions.blocklist` | từ/cụm chặn **thêm**, cùng quy tắc so khớp (§5.1), kể cả tiền tố `=` |

Mọi giá trị đọc **một lần lúc nạp module** `config.ts` → đổi `.env` phải khởi động lại tiến trình.

### 2.2 `parseNewsFeeds(raw)` (`config.ts:221-241`) — hàm thuần
- Tách theo `,` hoặc `\n`; mỗi mục `nhom|url`; `nhom` hạ chữ thường; mục **không có `|`** → nhóm rỗng → bị bỏ với ghi chú `NEWS_FEEDS: nhóm "?" không hợp lệ`.
- Nhóm phải thuộc `NEWS_GROUPS = ['the_thao','cong_nghe','game','khoa_hoc','giai_tri']` (`config.ts:202`). **`bong_da` không cấu hình được** — nó là nhãn phụ tự gắn cho tin `the_thao` (§4.4).
- URL phải khớp `/^https?:\/\/\S+$/i`; URL trùng bị bỏ lặng lẽ (`seen`).
- Mục sai → `notes[]` → `CONFIG.newsFeedNotes` → in `⚠️` lúc khởi động (`server.ts:561`). App **không chết** vì cấu hình sai; chỉ còn ít feed hơn.
- **Bẫy 0 feed**: `config.ts:246` (`parseNewsFeeds(str(process.env.NEWS_FEEDS) || DEFAULT_NEWS_FEEDS)`) chỉ rơi về `DEFAULT_NEWS_FEEDS` khi `NEWS_FEEDS` **rỗng**. Nếu biến có giá trị mà **mọi mục** đều bị loại thì `newsFeeds = []` — **không** tự quay về mặc định — và `NewsStore.start()` lặng lẽ không chạy (`store.ts:137`: `!this.opts.feeds.length → return`) dù `NEWS_ENABLED=true`. Dấu hiệu duy nhất: log khởi động `📰 Thời sự: 0 nguồn RSS, tải sau 20 giây…` (`server.ts:557-559`) kèm các dòng `⚠️`. Director vẫn lên lịch `news_chat`; kho chỉ có tin khôi phục từ `data/state.json` (nếu có, §6.5) và không bao giờ được làm mới.

### 2.3 `DEFAULT_NEWS_FEEDS` (`config.ts:207-218`, "đã kiểm tra 2026-11-01, không cần key") — 10 feed

| Nhóm | Nguồn | URL |
|---|---|---|
| `the_thao` | VnExpress | `https://vnexpress.net/rss/the-thao.rss` |
| `the_thao` | Tuổi Trẻ | `https://tuoitre.vn/rss/the-thao.rss` |
| `the_thao` | Thanh Niên | `https://thanhnien.vn/rss/the-thao.rss` |
| `cong_nghe` | VnExpress | `https://vnexpress.net/rss/so-hoa.rss` |
| `cong_nghe` | Tuổi Trẻ | `https://tuoitre.vn/rss/nhip-song-so.rss` |
| `game` | GameK | `https://gamek.vn/home.rss` |
| `khoa_hoc` | VnExpress | `https://vnexpress.net/rss/khoa-hoc.rss` |
| `giai_tri` | VnExpress | `https://vnexpress.net/rss/giai-tri.rss` |
| `giai_tri` | Tuổi Trẻ | `https://tuoitre.vn/rss/giai-tri.rss` |
| `giai_tri` | Thanh Niên | `https://thanhnien.vn/rss/giai-tri.rss` |

Vì sao chỉ các mục này: đây là **lớp 0** của an toàn — không có mục Pháp luật, Thời sự/Xã hội, Thế giới, Kinh doanh. `BLOCKLIST` được tinh chỉnh trên tiêu đề của chính các mục này; nạp một feed "Pháp luật" sẽ làm bộ lọc lọt rất nhiều (xem §13).

Cân bằng nhóm: `the_thao` và `giai_tri` có 3 feed, `game`/`khoa_hoc` chỉ 1 — nhưng `store.pick()` chọn **nhóm** ngẫu nhiên đều rồi mới chọn tin (§6.4), và Director còn **xoay vòng nhóm** (§7.3), nên số feed không làm lệch tần suất nhóm.

---

## 3. Tải feed — `fetchText()` (`src/news/feeds.ts:47-114`)

Không dùng thư viện: `node:https` / `node:http` + `node:zlib`.

| Khía cạnh | Giá trị / hành vi | Dòng |
|---|---|---|
| `timeoutMs` | mặc định 10 000, sàn 1 000; hết giờ → lỗi `hết thời gian chờ N ms` + `req.destroy()` | `:48, :110` |
| `maxBytes` | mặc định 2 000 000 (sau giải nén), sàn 10 000; vượt → lỗi `nội dung quá lớn (> N byte)` + destroy | `:49, :100` |
| `maxRedirects` | mặc định 1; 3xx có `Location` → gọi đệ quy với `maxRedirects − 1`; hết lượt → `quá nhiều chuyển hướng (HTTP 3xx)` | `:50, :76-86` |
| Giao thức | chỉ `http:`/`https:`; khác → `chỉ hỗ trợ http/https`; URL hỏng → `url không hợp lệ` | `:54-55` |
| Header gửi | `User-Agent: VanPhongAo/3.0 (+van phong ao; doc RSS cong khai)` (`USER_AGENT :15`), `Accept: application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5`, `Accept-Encoding: gzip, deflate, br, identity`, `Accept-Language: vi,en;q=0.8` | `:67-72` |
| Mã trạng thái | ngoài 2xx (và không phải 3xx có Location) → lỗi `HTTP <status>` | `:87` |
| Giải nén | theo `content-encoding`: `gzip` → `createGunzip`, `deflate` → `createInflate`, `br` → `createBrotliDecompress` | `:88-93` |
| Ngắt giữa chừng | bộ giải nén không tự báo khi máy chủ cắt kết nối → nghe `res.on('aborted'|'close')`, kiểm `res.complete` → lỗi `kết nối bị ngắt giữa chừng` | `:105-108` |
| Giải mã chữ | `decodeBody(buf, contentType)` (`:31-44`): ưu tiên `charset=` trong Content-Type → `<?xml encoding="…"?>` trong 300 byte đầu → utf-8; bộ mã lạ/lỗi `TextDecoder` → utf-8 | `:31-44` |

Mọi lỗi là `Error` với thông điệp tiếng Việt ngắn; `NewsStore` ghép thành `"<Nguồn> · <group>: <msg>"` (§6.2). `fetchFeed(feed, opts)` (`:398-401`) = `fetchText` + `parseRss`; đây là hàm tiện ích, **kho tin không dùng nó** mà tự gọi `fetcher` + `parseRss` để tách lượt event loop (§6.2).

---

## 4. Đọc RSS 2.0 / Atom — `parseRss()` (`feeds.ts:369-395`)

### 4.1 Cắt khối tuyến tính
`splitBlocks(text, 'item' | 'entry', maxBlocks = MAX_ITEMS_PER_FEED = 500, maxChars = MAX_ITEM_CHARS = 64 000)` (`:264-265, :276-297`) quét bằng `indexOf` trên bản chữ thường (O(n)): bỏ `<items>`/`<item/>`, lấy phần giữa `>` và `</item`, cắt theo `maxChars`. Một `<item` thiếu `</item` chỉ làm mất đúng khối đó (không như regex lười quét tới cuối file). Không có `<item` → thử `<entry` (Atom).

### 4.2 Đọc từng trường (ưu tiên trái → phải)
| Trường | Nguồn | Ghi chú |
|---|---|---|
| `title` | `cleanText(<title>)` | phải **≥ 8 ký tự**, không chứa U+FFFD (`hasReplacementChar :173`, giải mã sai bộ mã) — không thì bỏ tin (`:379`); cắt 200 |
| `url` | `itemLink()` (`:353-361`): `<link>` → `<link href>` (Atom) → `<guid>`; chỉ nhận chuỗi khớp `/^https?:\/\/\S+$/i` | không có → bỏ tin |
| `id` | `newsId(url)` = 12 hex đầu của SHA-1(`normalizeUrl(url)`) (`:238-240`) | trùng trong cùng feed → bỏ (`seen`) |
| `summary` | `description` → `content:encoded` → `summary` → `content` (`:383`) → `cleanText` → bỏ U+FFFD → `summarize(…, 200)`; bằng tiêu đề → `''` | `SUMMARY_MAX = 200` (`:16`) |
| `publishedAt` | `pubDate` → `dc:date` → `published` → `updated` (`:384`) → `parseDate(cleanText(dateRaw), now)` | không đọc được → **`now`** (xem bẫy §4.6) |
| `source` | `sourceLabel(url || feedUrl)` | §4.5 |
| `category` | `group === 'the_thao' && isFootball(title + categories) ? 'bong_da' : group` (`:386`) | §4.4 |

`tagRaw` hỗ trợ tiền tố namespace (`content:encoded`, `dc:date`), tag rỗng `<x/>` → `''`; `tagRaws` lấy tối đa 20 tag cùng tên (`:325`); `tagAttr` đọc thuộc tính (`<link href="…">`).

### 4.3 Làm sạch văn bản
- `NAMED_ENTITIES` (`:117-134`): entity tên cơ bản + **toàn bộ Latin-1** (U+00A0..U+00FF, vì Thanh Niên mã hoá "cách nào" thành `c&aacute;ch n&agrave;o`) + vài entity HTML5 tiếng Việt (`abreve`, `ohorn`, `uhorn`, `dstrok`…). `nbsp` → khoảng trắng thường.
- `decodeEntities` (`:137-147`): entity số (dec/hex) ngoài Unicode, surrogate, U+FFFD, ký tự điều khiển → **bỏ hẳn** (không chép nguyên văn vào tiêu đề); entity tên phân biệt hoa/thường rồi mới thử thường; tên lạ → bỏ.
- `cleanText` (`:167-170`): CDATA → entity → bỏ HTML → entity lần 2 → bỏ HTML lần 2 (xử lý mã hoá hai lớp `&amp;lt;b&amp;gt;`) → bỏ ký tự điều khiển → gọn khoảng trắng. `stripHtml` (`:153-161`) bỏ cả `<script>/<style>`, comment.
- `summarize(text, max=200)` (`:176-182`): cắt tại ranh giới từ nếu khoảng trắng cuối nằm sau 60 % độ dài, bỏ dấu câu cuối, thêm "…".

### 4.4 Nhãn phụ bóng đá — `isFootball()` (`:256-260`)
`FOOTBALL_KEYWORDS` (`:243-252`, **80 mục**: giải đấu, CLB, cầu thủ, thuật ngữ "ghi bàn", "phạt đền", "việt vị"…) so khớp bằng `matchKeyword(normText(text), k)` của `filter.ts` (ranh giới từ, quy tắc có/không dấu ở §5.1). Tin `the_thao` khớp → `category = 'bong_da'`; mọi nhóm khác không bao giờ thành `bong_da`.

**Bẫy đã gặp** (comment `:254-255`): "Thái Bình Dương" từng bị gắn bóng đá vì khớp "Bình Dương" → giờ chỉ dùng tên CLB đủ dài (`becamex bình dương`, `bình dương fc`, `thanh hóa fc`). Khi thêm tên CLB/cầu thủ: tránh từ trùng địa danh, tên thường ("nam định" đang có trong danh sách — địa danh Nam Định cũng khớp, chấp nhận vì chỉ ảnh hưởng nhãn phụ trong nhóm thể thao, không ảnh hưởng an toàn).

### 4.5 Nguồn & định danh
- `SOURCE_LABELS` (`:203-209`): **21 tên miền** → nhãn báo (vnexpress.net → VnExpress, tuoitre.vn → Tuổi Trẻ, thanhnien.vn → Thanh Niên, gamek.vn → GameK, genk.vn, kenh14.vn, dantri.com.vn, znews.vn/zingnews.vn → Znews, laodong.vn, vietnamnet.vn, nld.com.vn, bongdaplus.vn, thethao247.vn, vtv.vn, vov.vn, tinhte.vn, cafef.vn, baomoi.com, plo.vn, kinhtedothi.vn). `sourceLabel(url)` (`:212-222`) khớp hậu tố dài nhất trước (`thethao.vnexpress.net` → VnExpress), bỏ `www.`; không biết → tên miền cấp 2 viết hoa chữ đầu (`baola.vn` → "Baola"); URL hỏng → "Báo".
- `normalizeUrl` (`:225-235`): bỏ `#fragment`, hạ chữ hostname, xoá tham số `utm_*`, `fbclid`, `gclid`, `ref`, `source` → cùng một bài luôn ra cùng `id` dù link kèm tracking.

### 4.6 Ngày đăng — `parseDate(raw, fallback)` (`:188-200`)
Chuẩn hoá `GMT+7` → `GMT+0700`; nếu **không có múi giờ**: dạng ISO `YYYY-MM-DDTHH:MM` thêm `+07:00`, dạng khác thêm ` GMT+0700` (coi là giờ Việt Nam); `Date.parse`; thất bại thử `Date.parse(raw)`; vẫn thất bại **hoặc trước 2000-01-01** (năm 2 chữ số bị hiểu thành 19xx) → `fallback`. Hiểu được: RFC 822 `Sun, 01 Nov 2026 13:53:00 +0700`, `GMT+7` (GameK), năm 2 chữ số (Thanh Niên `01 Nov 26`), `11/1/2026 2:20:00 PM` (Tuổi Trẻ), ISO.

**Bẫy**: tin không có ngày lấy `now` → luôn "mới nhất" → được ưu tiên trong `TOP_N = 5` của `pick()` (§6.4). Test `test-news` mục 1 kiểm "không có tin nào lấy bây giờ làm ngày" trên 3 fixture; khi thêm nguồn mới hãy kiểm tra feed có `pubDate` không.

---

## 5. Bộ lọc an toàn — `src/news/filter.ts` (thuần logic, không mạng)

### 5.1 Quy tắc so khớp (đọc trước khi thêm bất kỳ từ nào)
- `normText(...parts)` (`:27-30`) → `{ exact, loose }`: `exact` = NFC + chữ thường + gọn khoảng trắng; `loose` = như trên **+ bỏ dấu** (`stripDiacritics :16`, `đ → d`).
- `wordRe(needle)` (`:35-43`): regex Unicode `(?<![\p{L}\p{N}])needle(?![\p{L}\p{N}])`, khoảng trắng trong cụm → `\s+`; cache ≤ 4000 regex.
- `matchKeyword(text, keyword)` (`:50-62`) — **ba chế độ**:
  1. Tiền tố `=` → **luôn so khớp có dấu** (ví dụ `=tự tử` vì "tu tu" ≈ "từ từ"; `=hàng giả` vì "hang gia" ≈ "hàng gia dụng"; `=kỳ thị` ≈ "kỳ thi"; `=nhà trắng` ≈ "Nha Trang"; `=dương tính` ≈ "đường tính"; `=bị thương` ≈ "bi thương").
  2. Cụm ≥ 2 từ mà **mọi** tiếng (sau bỏ dấu và bỏ ký tự không chữ/số) **≥ 3 chữ cái** → so khớp **không dấu** trên `text.loose` (bắt "khoi kien", "bat giu", "tron thue").
  3. Còn lại (từ đơn; cụm có tiếng ngắn như "bản án" → "ban an" ≈ "bàn ăn", "đi tù" → "di tu") → so khớp **có dấu** trên `text.exact`.
  Hệ quả: "khởi tố", "ly hôn", "bị bắt", "bị tố" có tiếng 2 chữ nên **không** tự bắt bản không dấu → danh sách có biến thể tường minh `'khoi to', 'ly hon', 'bi bat', 'bi to'` (`:126`). Khi thêm cụm có tiếng ≤ 2 chữ mà muốn bắt cả không dấu, phải thêm biến thể tương tự.
- `findKeyword` (`:65`) trả từ khoá đầu tiên khớp; `findBlocked` (`:71-79`) như trên nhưng bỏ qua từ chặn nếu một ngoại lệ trong `BLOCK_EXCEPTIONS[từ]` cũng khớp; `findPattern` (`:82-85`) chạy regex có dấu trên `exact`, trả `label`.
- `blockedTopic(text, extra?)` (`:88-91`) — thứ tự: `findBlocked(BLOCKLIST)` → `findKeyword(PRIVATE_LIFE)` → `findPattern(BLOCK_PATTERNS)` → `findPattern(PRIVATE_PATTERNS)` → `findBlocked(extra)` (= `NEWS_BLOCKLIST`). Hàm này được `catalog.newsBlocked()` import để lớp 2 của Director luôn đồng bộ (§7.4).

### 5.2 Các danh sách (đếm bằng script trên file hiện tại)

| Danh sách | Dòng | Số mục | Áp cho | Nội dung |
|---|---|---|---|---|
| `BLOCKLIST` | `:98-139` | 290 (289 duy nhất — `'bị tố'` lặp ở `:102` và `:121`) | mọi nhóm, tiêu đề + tóm tắt | pháp lý/tội phạm; bạo lực/tai nạn/tang sự/sức khoẻ; chính trị/tôn giáo/xã hội; đời tư/bê bối/18+; bổ sung sau đợt rà soát 30 tiêu đề thật (bắt khẩn cấp, cáo buộc, quỵt, chủ nợ, thắng/thua kiện, sa thải, từ chức, chất cấm, nguy kịch, vĩnh biệt…); tên chính trị gia/cơ quan quốc tế (trump, putin, zelensky, netanyahu, tập cận bình, kim jong-un, `=nhà trắng`, lầu năm góc, kremlin, nato, gaza, hamas, thượng/hạ viện, `=nội các`, `=bí thư`, bộ chính trị, giáo hoàng, vatican); cơ thể/người lớn (vòng 1 khủng, `=lộ hàng`, thả rông, nội y, xuyên thấu, nude…); lời nói nhắm vào người khác (phát ngôn gây tranh cãi/sốc, trêu chọc, chế giễu, mỉa mai, xúc phạm, vu khống, bôi nhọ) |
| `BLOCK_EXCEPTIONS` | `:145-150` | 4 khoá | vô hiệu **đúng từ đó**, từ chặn khác vẫn hiệu lực | `công an` ↔ CLB (`công an hà nội`, `công an tp.hcm`, `clb công an`, `cahn`…); `bị bắt` ↔ `bị bắt bài/gọn/dính/việt vị/lỗi/kịp/chẹt/thóp/nhịp`; `đình chỉ` ↔ `đình chỉ thi đấu/trận/giải`; `nude` ↔ `nude look`, `tông/màu/son/tone nude` |
| `BLOCK_PATTERNS` | `:157-160` | 2 regex | mọi nhóm | "tố" (cáo buộc) trừ yếu/nhân/sắc/nguyên/độc/kháng/màu/men/hồng tố và trừ "tố chất/tụng/hữu/như/nga/uyên/loan/quyên/tâm" phía sau; "kiện" trừ sự/điều/linh/phụ/bưu/dữ/chứng kiện và "kiện hàng/tướng" |
| `PRIVATE_LIFE` (alias `SHOWBIZ_PRIVATE :173`) | `:166-172` | 54 | **mọi nhóm** (trang game đăng "hot girl", thể thao bàn vóc dáng) | hẹn hò, tình cũ/mới, bạn trai/gái, chia tay, mang thai, đám cưới, sức khoẻ, giảm/tăng cân, vóc dáng, sắc vóc, vòng eo, số đo, nhan sắc, phẫu thuật, bikini, gợi cảm, sexy, hot girl/boy… |
| `PRIVATE_PATTERNS` | `:179-185` | 2 regex | mọi nhóm | "vợ/chồng/con/… (của) (cựu/nam/nữ) tỷ phú/ca sĩ/cầu thủ/hlv/streamer/ceo…" và "vợ/chồng + Tên Riêng Viết Hoa" → nhãn `đời tư gia đình` ("vợ chồng A Phủ" là tên phim nên không có mẫu "vợ chồng") |
| `PERSON_CONDUCT` | `:192-201` | 78 | tin **về một con người** (§5.3) | bị chỉ trích, ném đá, bị đồn, rộ tin, nghi vấn, gây tranh cãi, tranh cãi, khẩu chiến, đáp trả, cà khịa, `=làm màu`, sống ảo, nói dối, thị phi, lùm xùm, phát ngôn sốc, vạ miệng, tình yêu, cặp kè, trà xanh, body, vòng 3, mua nhà/xe, biệt thự, siêu xe, `=tài sản`, nợ nần, cát-xê, nằm viện, chấn thương nặng, nghi ngờ, bị loại vì, bị phạt vì… — vô hại khi nói về sản phẩm/trận đấu ("tranh cãi về luật việt vị" được, "cầu thủ X gây tranh cãi" thì không) |
| `SHOWBIZ_ALLOW` | `:218-227` | 75 | chỉ `giai_tri`, **chỉ xét tiêu đề** | phim, điện ảnh, rạp, trailer, series, anime, netflix, nhạc, album, mv, concert, k-pop, bảng xếp hạng, show, gameshow, sân khấu, lễ trao giải, oscar, grammy, thời trang, người mẫu, son, làm đẹp, mỹ phẩm, outfit, trend, xu hướng, triệu view… |

Nhận diện "tin về con người" — `namesPerson(title, summary, { names })` (`:209-215`): `PERSON_ROLE_RE` (`:207`, vai nghề: ca sĩ, diễn viên, streamer, idol, hoa hậu, cầu thủ, hlv, trọng tài, tay đua, game thủ, caster, tỷ phú, ceo, kỹ sư, nhà khoa học, giáo sư, bác sĩ…) trên chữ thường; **hoặc**, khi `names !== false`, `PERSON_NAME_RE` (`:208`) = ≥ 2 tiếng viết hoa liền nhau ("Trúc Nhân", "Bruno Fernandes"). `NAME_IS_PERSON = {giai_tri, the_thao, bong_da}` (`:251`): tin công nghệ/game/khoa học đầy tên sản phẩm viết hoa ("Pro Max", "Black Myth Wukong") nên chỉ tin vai nghề.

### 5.3 `judge(item, opts)` (`:254-274`) — thứ tự phán xét

| # | `reason` | Điều kiện | Ghi chú |
|---|---|---|---|
| 1 | `invalid` | thiếu/ngắn tiêu đề (< 8 sau trim), url không `http(s)://` | |
| 2 | `old` | `isTooOld(publishedAt, now, maxAgeDays ?? 3)` (`:241-243`) — `publishedAt` không hữu hạn cũng là cũ | `now` lấy từ `opts.now` hoặc `Date.now()` |
| 3 | `blocked` (+`keyword`) | `blockedTopic(normText(title, summary), opts.blocklist)` | xét **cả tóm tắt** |
| 4 | `conduct` (+`keyword`) | `category === 'giai_tri'` **hoặc** `namesPerson(…)` → `findKeyword(text, PERSON_CONDUCT)` | tin về người thật |
| 5 | `showbiz_off` | `giai_tri` mà `allowShowbiz === false` | công tắc `NEWS_ALLOW_SHOWBIZ` |
| 6 | `showbiz` | `giai_tri` mà **tiêu đề** không khớp `SHOWBIZ_ALLOW` (`isLightShowbiz(normText(item.title)) :246-248`) | tóm tắt có "phim" **không cứu được** |
| 7 | `{ ok: true }` | | |

`DropReason = 'invalid' | 'blocked' | 'old' | 'showbiz_off' | 'showbiz' | 'conduct'` (`:230`). `filterNews(items, opts)` (`:279-288`) → `{ kept, dropped: [{ item, reason, keyword }] }` — `dropped` dùng cho test/debug (kho không lưu).

### 5.4 Bẫy / ràng buộc
- `mỉa mai`, `phát ngôn sốc` có trong cả `BLOCKLIST` và `PERSON_CONDUCT`; `sắc vóc` có trong cả `PRIVATE_LIFE` và `PERSON_CONDUCT` → mục ở `PERSON_CONDUCT` không bao giờ tới lượt (lớp trước đã bắt). Không sai, chỉ thừa; ảnh hưởng duy nhất là `reason` ghi `blocked` thay vì `conduct`.
- `PERSON_NAME_RE` coi địa danh 2 tiếng viết hoa ("Hà Nội", "Ngoại Hạng Anh") là "người" ở nhóm thể thao/giải trí → chỉ **bật** `PERSON_CONDUCT`, không chặn trực tiếp; có thể làm rơi tin thể thao có chữ "tranh cãi", "nghi ngờ" — chấp nhận (an toàn hơn), theo dõi tỉ lệ `conduct` qua test.
- `NEWS_BLOCKLIST` chỉ **thêm**, không bỏ được từ có sẵn. Muốn "nới" phải sửa code + test (§13).
- GameK trang chủ ~1/3 là cosplay/"hot girl"/vóc dáng → bị `PRIVATE_LIFE` bỏ **theo thiết kế**; test chỉ đòi giữ ≥ 60 % cho game, ≥ 70 % cho thể thao.

---

## 6. Kho tin — `src/news/store.ts`

### 6.1 Hằng số & cấu trúc
`ALL_CATEGORIES` (`:12`) 6 nhóm; `USED_KEEP = 500` id đã dùng; `RECENT_KEEP = 20` thẻ tin gần đây; `PERSIST_PER_CATEGORY = 12`; `FEED_WARN_EVERY_MS = 1 giờ`; `TOP_N = 5` (`:16-20`). `byCat: Map<NewsCategory, NewsItem[]>` mỗi nhóm **mới nhất trước**; `usedIds[]` + `usedSet` (FIFO 500); `recentRefs: NewsRef[]` (≤ 20, mới nhất **cuối**).

`NewsStoreOptions` (`:22-35`) và `defaults()` (`:117-123`): `enabled true, feeds [], refreshMinutes 45, maxAgeDays 3, allowShowbiz true, blocklist [], perCategory 40, firstFetchMs 20 000, fetcher = fetchText, now = Date.now, log = console.log, warn = console.warn`. `perCategory` bị `maxPerCategory()` kẹp cứng vào `1..40` (`:240-242`) dù cấu hình lớn hơn. `configure(opts)` (`:126-130`) không xoá tin; đang chạy thì `stop()+start()`.

`sanitizeNewsItem(raw)` (`:63-76`): id ≤ 40, title ≤ 200 (≥ 8), url ≤ 600 http(s), category hợp lệ, summary ≤ 200, source ≤ 40 (thiếu → `sourceLabel(url)`), publishedAt số hữu hạn hoặc 0 — áp cho mọi mục đi vào kho (từ parse, từ file state, từ `inject`). `toNewsRef(it)` (`:78`). `expandCategories(cats)` (`:89-95`): rỗng/không truyền → mọi nhóm; có `the_thao` → thêm `bong_da`.

### 6.2 Lịch tải
- `start()` (`:136-148`): bỏ qua nếu đã chạy / `enabled=false` / không có feed. `setTimeout(firstFetchMs)` → `refresh()` rồi `setInterval(max(60_000, refreshMinutes × 60_000))`; cả hai timer `unref()` (không giữ tiến trình sống). `stop()` (`:150-154`) xoá timer. Server gọi `news.start()` **sau** `world.start()` (`server.ts:255-256`) và `news.stop()` khi tắt (`:506`).
- `refresh()` (`:157-161`) chống gọi chồng (trả cùng Promise). `doRefresh()` (`:163-205`): `Promise.allSettled` mọi feed **song song**; mỗi feed sau khi tải xong `await setImmediate` rồi mới `parseRss` (nhường event loop cho tick mô phỏng, `:170-172`); feed ok → `ingest()`, xoá cờ cảnh báo; feed lỗi → `errors.push("<Nguồn> · <group>: <msg>")`, `warn` tối đa **1 lần/giờ/feed** (`feedWarnedAt`) với chữ "giữ tin cũ", **không xoá tin đang có**; sau đó `prune()` (bỏ tin quá `maxAgeDays`, `:252-258`); `lastOkAt` nếu ≥ 1 feed ok; `lastError` = lỗi cuối; log 1 dòng `📰 Thời sự: N tin (…)` khi có tin mới hoặc lần đầu.
- `refresh()` trả **`RefreshReport`** (`store.ts:37-44`): `{ ok, failed, added, dropped, total, errors: string[] }` — `ok/failed` = số feed tải được/lỗi; `added` = số id mới vào kho (cộng dồn từ `ingest`); `dropped` = số tin `filterNews` bỏ (cộng dồn `dropped.length` của `ingest`, `:179-181`); `total = size()` **sau** `prune()` (`:195-196`); `errors` = các chuỗi `"<Nguồn> · <group>: <msg>"`. Test mục 5 (`test-news.ts:284-285`) khẳng định thẳng `r1.ok === 1 && r1.failed === 1 && r1.added >= 30 && r1.total === r1.added && r2.added === 0 && r3.total === r1.total` và in `r1.errors` — đổi tên/ý nghĩa trường nào thì sửa test đó và dòng log `📰 Thời sự:` (`:199-202`) cùng lúc. `index.ts:13` re-export `type RefreshReport`.

### 6.3 Nạp tin — `ingest(items)` (`:213-238`)
`sanitizeNewsItem` từng mục → `filterNews(clean, { now, maxAgeDays, allowShowbiz, blocklist })` → với mỗi tin giữ: bỏ nếu id đã có trong nhóm; nếu nhóm đã đầy (40) và tin **không mới hơn** tin cũ nhất đang giữ → bỏ (tránh nạp rồi cắt mỗi lần làm mới, `:229-230`); thêm → `trim(c)` (sắp `publishedAt` giảm, cắt ≤ 40). `added` = số id mới xuất hiện trong kho. `inject(items)` (`:209`) = `ingest` công khai cho test/smoke.

### 6.4 API cho Director
- `pick(categories?, exclude?)` (`:266-277`): `prune()` → với mỗi nhóm trong `expandCategories(categories)` lọc tin chưa `markUsed` và không trong `exclude`; nhóm còn tin thành một "pool"; **chọn ngẫu nhiên đều một pool** (không theo số tin) → trong **5 tin mới nhất** của pool chọn ngẫu nhiên → trả **bản sao**; không còn → `null`.
- `markUsed(id)` (`:280-296`): thêm vào `usedSet/usedIds` (FIFO 500); nếu tin còn trong kho → cập nhật `recentRefs` (xoá trùng, đẩy cuối, ≤ 20).
- `recent(n = 5)` (`:301-304`): n thẻ tin đã bàn gần nhất, **cũ → mới (mới nhất cuối)**, kẹp ≤ 20. Dùng cho `hello.news` (`world.ts:926-933`, `recent(5)`) và `/api/news` (`recent(20)`).
- `isUsed`, `find`, `items(category?)` (**mới nhất trước**, bản sao — ngược chiều với `recent()`, cố ý), `size`, `counts`, `status()` (`:334-340`: `{ enabled, feeds, refreshMinutes, lastRefreshAt, lastOkAt, lastError, refreshes, counts, total, used }`), `clear()`.

### 6.5 Lưu / khôi phục (World gọi; nằm trong `data/state.json` dưới `world.news`)
- `serialize()` (`:351-355`): `{ v: 1, used: ≤ 500 id, recent: ≤ 20 NewsRef, items: ≤ 12 tin/nhóm (mới nhất), lastRefreshAt }`. World ghi ở `world.ts:3036` (`jsonSafe('news.serialize', …)`).
- `restore(data)` (`:357-378`): nạp `used` (giữ FIFO 500), `recent` qua `sanitizeRef`, `items` qua `ingest` (tối đa 6 × 40 mục; tin quá hạn bị `filterNews` loại ngay), `lastRefreshAt`. World gọi ở `world.ts:3126-3127` trong `load()` — **trước** `world.start()` và `news.start()`, nên singleton đã tồn tại và có tin cũ ngay khi lên, cho tới lần tải đầu ~20 s sau.
- Hệ quả: sau khởi động lại, kho chỉ còn ≤ 12 tin/nhóm (không phải ~40 như `v3-news.md:33-34` viết) cho tới lần tải đầu.

### 6.6 Singleton
`getNews()` (`:385-393`) tạo từ `CONFIG.newsEnabled / newsFeeds / newsRefreshMinutes / newsMaxAgeDays / newsAllowShowbiz / newsBlocklist`; **không tải gì** cho tới `start()`. `configureNews(partial)` (`:396-398`) cho test/smoke: `smoke.ts:146` và `smoke-story.ts:92` đặt `enabled: false, feeds: []` rồi `inject` fixture (`smoke.ts:153`, `smoke-story.ts:204`); `eyeball-hr.ts:36` chỉ **tắt** kho tin (`enabled: false, feeds: []`, kèm `newsEnabled: false` trong `simConfig` ở `:38`), **không** inject tin. `src/news/index.ts` re-export phần lớn API công khai (`index.ts:2-14`) nhưng **không** có `blockedTopic`, `findPattern`, `namesPerson`, `PERSON_CONDUCT`, `BLOCK_PATTERNS`, `PRIVATE_PATTERNS` (filter.ts) và `decodeBody`, `hasReplacementChar`, `splitBlocks`, `MAX_ITEMS_PER_FEED`, `MAX_ITEM_CHARS` (feeds.ts) — cần những thứ này thì import thẳng `./news/filter.js` / `./news/feeds.js` (như `catalog.ts:6` import `blockedTopic, normText` từ `../news/filter.js`). `server.ts:16`, `world.ts:10`, `director.ts:41` import thẳng `./news/store.js`.

---

## 7. Director: nhịp cảnh `news_chat` và tin len vào tám chuyện

Phần này mô tả đúng những gì liên quan tin; vòng đời cảnh nói chung xem [`04-dao-dien-cau-chuyen-nhan-su.md`](04-dao-dien-cau-chuyen-nhan-su.md).

### 7.1 Định nghĩa cảnh & hằng số
- `SCENE_DEFS.news_chat` (`src/sim/scenes.ts:181-185`): title "Tám chuyện thời sự", icon 🗞️, `channel: 'office'`, `priority: 'normal'`, 4–8 câu, `effects: ['mood','relationship','memory']`, `product: false` (**không bao giờ** chèn sản phẩm vào cảnh thời sự), label "đang bàn chuyện thời sự". Director có thể đổi kênh sang `group` (§7.3).
- `director.ts:118-121`: `NEWS_MIN_MINUTES_DEFAULT = 25`, `NEWS_USED_KEEP = 60`, `NEWS_DISCUSSED_KEEP = 20`. Constructor (`:420-423`) đọc `newsEnabled`, `newsSceneMinMinutes` (→ `newsMinMsVal` ms), `newsAllowShowbiz`, `newsMaxAgeDays` qua `cfgBool/cfgNum` (CONFIG → env → mặc định). `:428`: `lastNewsAt = −newsMinMsVal + PRODUCT_WARMUP_MS` (= 2 phút, `:57`) → sau khởi động, cảnh thời sự đầu tiên chỉ chờ **2 phút thật** thay vì 25.
- Trạng thái (`:386-393`): `lastNewsAt`, `lastNewsHintAt`, `newsUsed: string[]` (≤ 60, kể cả tin bị lọc lần hai), `discussedNews: NewsRef[]` (≤ 20), `newsCatIdx`. Ba trường sau được **lưu** trong `serialize().story` (`:4135-4137`) và khôi phục (`:4241-4243`); `lastNewsAt/lastNewsHintAt` **không lưu** (tính lại từ warm-up).
- **Đường cũ, hiện là mã chết — không dùng cho tin thật**: `GroupReason` còn giá trị `'news'` (`scenes.ts:905`, có trong `GROUP_REASONS :910`, câu tình huống `:957` "Có người ném vào nhóm một tin đang hot…"). Director **không bao giờ** `enqueue('group_chat', …, { reason: 'news' })` (grep `reason: 'news'` toàn `src/` = 0; mọi `enqueue('group_chat'` ở `director.ts` dùng reason khác). Nếu ai dùng lại: cảnh sẽ **không có `req.news`** → không thẻ tin cho người xem, prompt mời model **tự bịa** tin, và `sanitizeScene` không coi là newsy (`sanitize.ts:447` chỉ xét `req.type === 'news_chat'`, `req.news`, `^nghe nói`) → vi phạm nguyên tắc số 5. Muốn tin thật trong nhóm Zalo thì đi đường `dNews` kênh `group` (§7.3). Đề xuất xoá giá trị này (câu hỏi mở 13).

### 7.2 Lịch trong ngày — `planDay` (`:722-726`)
Khi `newsEnabled`: từ phút game ngẫu nhiên `randInt(545, 600)` (≈ 09:05–10:00), bước `randInt(75, 110)` phút, tới trước 1020 (17:00), **bỏ** mốc trong 715–790 (≈ 11:55–13:10, giờ trưa); mỗi mốc `add('news_chat', t, 40, 'normal', {})` = cửa sổ 40 phút game, ưu tiên normal. Thực tế ≈ 4–6 cửa sổ/ngày, nhưng cap phút thật (§7.3) mới quyết số cảnh diễn ra.

### 7.3 Khi tới lượt — `processQueue` (`:856-862`) → `dNews(q)` (`:3044-3092`)
1. Chọn kênh theo slot: slot văn phòng (`this.office`) rảnh → `office`; không thì slot online rảnh → `group` (nhóm Zalo kín, `GROUP_CHAT_LABEL = 'Nhóm Zalo "Anh em văn phòng 🍻"'`, `scenes.ts:85`); cả hai bận → chờ lượt sau. Ghi `q.data.channel`.
2. `dNews`: `newsEnabled` false → `drop`; không `force` và `clockMs − lastNewsAt < newsMinMsVal` → `null` (chờ; hết cửa sổ 40 phút thì mục tự rơi); không có kho (`newsApi()` null) → `drop`.
3. **Xoay vòng nhóm**: `cats = newsCats()` (`:2991-2993`: `NEWS_CATEGORIES` trừ `giai_tri` khi `!newsAllowShowbiz`); thử lần lượt từ `newsCatIdx`: `peekNews([cat])` → `pickNewsGroup(w, free, item.category, { online })`; thành công → `newsCatIdx = idx + 1`. Vì mỗi lần chỉ truyền **1 nhóm** cho `pick()`, việc `pick()` chọn nhóm đều (§6.4) không ảnh hưởng.
4. Draft: office → `joint: { ids, groups: shuffle(['pantry_table','lounge','window']) }` (giữ chỗ cả nhóm ở một trong 3 khu, nhãn `SPOT_LABELS.pantry_table = 'Bàn ăn pantry'` đổi theo khu thật), `sit: sitNewsChat(kit, ps, item, label, false)`; group → `channel: 'group'`, `locationLabel: GROUP_CHAT_LABEL`, `sitNewsChat(…, true)`. Cả hai: `news: item`, `meta: { newsId }`, `minPeople: 2`, `topicCats: []`.
5. Không tìm được tin/người ở mọi nhóm: `force` → toast "Chưa có tin mới hợp lệ (đã bàn hết hoặc bị lọc), thử lại sau nhé" + `drop`; không force → `null`.

`peekNews(cats)` (`:3010-3030`): tối đa **3 lần** `api.pick(cats, new Set(newsUsed))`; tin qua `validNews` → trả bản đã cắt (`title ≤ 160`, `summary ≤ 200`, `source ≤ 40`); tin **không hợp lệ** → id bị đẩy vào `newsUsed` (coi như đã dùng để kho không trả lại nữa).

`validNews(n)` (`:2996-3007`) — **lớp lọc thứ hai**: đủ `id/title/url http(s)/category ∈ NEWS_CATEGORIES`; `giai_tri` cần `newsAllowShowbiz`; chưa có trong `newsUsed`; tuổi ≤ `newsMaxAgeDays` tính bằng **`Date.now()` thật** (khác kho dùng `opts.now`) — nhưng **chỉ kiểm khi** `publishedAt` là số hữu hạn `> 0` **và** `newsMaxAgeDays > 0` (`:3003-3004`): tin có `publishedAt` 0/âm/không hữu hạn **bỏ qua** kiểm tuổi ở lớp này (ngược với kho: `isTooOld` `filter.ts:241-243` coi `publishedAt` không hữu hạn là cũ; `sanitizeNewsItem` cho phép `publishedAt = 0`, §6.1 — nên một tin `publishedAt = 0` lọt kho sẽ không bao giờ "hết hạn" ở lớp 2); `newsBlocked(title + ' ' + summary)` (§7.4) phải `false`. Vì sao cần lớp này dù kho đã lọc: tin có thể đến từ **state cũ** (file `data/state.json` lưu trước khi bộ lọc được siết) hoặc từ World bọc `getNews()` khác (`WorldV3.getNews?` `:102-103`); hai lớp độc lập là chủ ý.

### 7.4 `catalog.newsBlocked(text)` (`src/content/catalog.ts:460-468`)
`true` nếu chữ thường chứa **chuỗi con** bất kỳ cụm trong `NEWS_BLOCK_PHRASES` (`:448-454`, **50 cụm** ít nhầm: khởi tố, bắt giữ, lãnh án, phạt tù, truy nã, ma túy/tuý, giết người, hiếp dâm, lừa đảo, tự tử, tử vong, thiệt mạng, tai nạn, thi thể, bạo hành, xâm hại, đánh bạc, cá độ, tham nhũng, hối lộ, chính trị, bộ trưởng, thủ tướng, chủ tịch nước, quốc hội, tôn giáo, biểu tình, chiến tranh, khủng bố, ly hôn, ngoại tình, khởi kiện, bị kiện, tòa/toà án, tố cáo, bóc phốt, scandal, tình dục, lộ clip, ung thư, qua đời, đột tử, hành hung, cháy nhà, lũ quét, động đất — **cố ý không có** "án"/"kiện" đơn vì trùng "dự án"/"sự kiện") **hoặc** `blockedTopic(normText(text)) !== null` (import từ `../news/filter.js`, `catalog.ts:6`). Nhờ import này, mọi từ thêm vào `BLOCKLIST/PRIVATE_LIFE/BLOCK_PATTERNS/PRIVATE_PATTERNS` tự có hiệu lực ở lớp 2 (nhưng `PERSON_CONDUCT` và `NEWS_BLOCKLIST` từ `.env` thì **không** — lớp 2 không nhận `extra`).

### 7.5 Chọn người — `pickNewsGroup` (`scenes.ts:1494-1519`) và `newsInterest` (`:1480-1488`)
- Pool: agent active, `free(a)` (prio `high` nếu `force`, không thì `normal`), không `server_fix`, **sếp chỉ lọt 15 %**. Cần ≥ 2 người.
- Trọng số mỗi người: `0.35 + newsInterest(a, cat) + 0.4 × gossip` (+ `0.6` nếu đang đứng ở khu tám chuyện `areaOf(a)` và cảnh văn phòng) + Σ `max(0, rel(a→đã chọn)) / 40`. Chọn `randInt(2, 4)` người (kẹp theo pool).
- `newsInterest(a, cat)` = `NEWS_INTEREST[cat].ids[a.id]` + `roles[a.role]` + `0.5 × số keyword` xuất hiện trong `likes + quirks + bio` chữ thường (`text.includes(k)` — **chuỗi con**, xem bẫy). `NEWS_INTEREST` (`catalog.ts:380-405`): ví dụ `bong_da.ids.phat = 2.0`, `cong_nghe.ids.khoa = 1.8`, `game.ids = { bao 1.8, tung 1.6, tu 1.2 }`, `giai_tri.ids = { tram 1.8, linh 1.6, ngoc 0.5, tu 0.5 }`, `khoa_hoc.ids.vy = 1.6`; roles như `bong_da.saleslead 1.4`, `cong_nghe.techlead 1.4`, `game.junior 1.4`, `giai_tri.marketing 1.5`.
- Bẫy: `cong_nghe.keywords` có `'ai'`, `bong_da.keywords` có `'mu'`, `'real'`, `'tuyển'` — vì so khớp chuỗi con, `'ai'` khớp gần như mọi văn bản tiếng Việt ("hai", "lại"), `'mu'` khớp "mua" → cộng +0.5 bừa cho nhiều người, làm nhoè sở thích. Nên đổi sang `matchKeyword` ranh giới từ hoặc bỏ từ khoá ngắn (ý tưởng mở).

### 7.6 Tình huống cho prompt — `sitNewsChat` (`scenes.ts:1522-1539`)
Ghép (`joinSit`, cắt 690 ký tự): `timeFlavor` + cách mở (`online` → "<A> ném link bài báo vào nhóm chat kín"; không → "<A> vừa đọc báo trên điện thoại, kể cho <B, C> nghe ở <nơi>") · `Tin thật (<nhãn nhóm>, báo <source ≤ 30>): "<title ≤ 150>" — tóm tắt báo: <summary ≤ 200>` · ai "mê chủ đề này" (`newsInterest ≥ 1`) hoặc "Không ai rành lắm nên chỉ nói cảm nghĩ…" · `Nguyên tắc: ${NEWS_SAFETY_RULES}` · `Mục tiêu: <1 hạt giống trong NEWS_REACTION_SEEDS[category]>; cuối cùng quay về chuyện công ty một câu`; `extra = commonExtra(k, people, { recent: 1, quirk: false })`.
- `NEWS_SAFETY_RULES` (`catalog.ts:471-474`): "Chỉ bình luận cảm nghĩ/ý kiến cá nhân về tiêu đề + tóm tắt đã đăng trên báo ("nghe báo đăng…", "theo mình thì…"); KHÔNG bịa thêm chi tiết, con số, phát ngôn; không kết luận ai đúng/sai, không gán tội, không nói đời tư, không công kích người thật; được đùa về tình huống và về chính mình".
- `NEWS_REACTION_SEEDS` (`catalog.ts:411-442`): 3 hạt giống **cảm nghĩ** mỗi nhóm (ví dụ bóng đá: "fan hai đội khịa nhau, người không xem bóng đá đứng giữa ngáp dài"); không hạt nào thêm sự thật. Offline cũng tham chiếu tinh thần này nhưng có template riêng (§8.4).
- `NEWS_CATEGORY_LABEL` (`catalog.ts:370-372`) → "thể thao/bóng đá/công nghệ/game/khoa học/giải trí".

### 7.7 Tin len vào `pantry_chat` / `lunch` — `launch()` (`director.ts:1221-1231`)
Khi dựng cảnh `pantry_chat` hoặc `lunch` chưa có `d.news`, nếu `newsEnabled && chance(1/3) && clockMs − lastNewsAt ≥ newsMinMsVal / 2 && clockMs − lastNewsHintAt ≥ newsMinMsVal` → `peekNews(newsCats())` → `d.news = n`, `lastNewsHintAt = clockMs`, `v3.newsHints++`. Khi đó **không** sinh `topicHint` (`:1232`). Tin đi **đúng đường thẻ tin**: `req.news` (`:1249`), `scene.news = newsRefOf(d.news)` (`:1265`), prompt render khối TIN với cờ `incidental` (§8.2), sanitize lưới an toàn, client thấy thẻ tin, `afterNews` archive (`:2609`). README §7 (`README.md:423`) còn viết "gợi ý 'nghe nói…'" — **lỗi thời**, đường `topicHint` dạng chữ không còn dùng cho tin thật (comment `:1327`).

### 7.8 Đánh dấu đã dùng, cap, archive, lưu
- Ngay lúc **dựng** cảnh (`:1296-1302`): `markNewsUsed(d.news)` (`:3032-3041`: `newsUsed` ≤ 60, `discussedNews` ≤ 20, gọi `api.markUsed(id)` của kho); với `news_chat` đặt `lastNewsAt = clockMs`, `v3.newsScenes++`. Vì cap tính từ lúc dựng (kể cả cảnh bị huỷ), tin không bị "dồn" khi cảnh thất bại.
- Kết cảnh (`onEndHook :2609, :2630`) → `afterNews(s)` (`:3094-3097`): `archive('news', "🗞️ <title> (<source>)", { ...NewsRef, participants })` — áp cho cả tin len vào pantry/lunch.
- `stats()` (`:586-587`) lộ `newsUsed`, `newsDiscussed`; `v3.newsScenes`, `v3.newsHints` (`:407`) — chỉ cho smoke/log, không gửi người xem.
- `recentNews(n)` (`:597-599`) là dự phòng cho World khi module tin không có `recent()`; World hiện dùng thẳng `getNews().recent(5)`.
- **`discussedNews` còn chảy sang AI biên kịch (Showrunner)** — người tiêu thụ không có trong 5 lớp ở §1.2: `storyCtx()` (`director.ts:3603-3612`) đặt `latestNews: this.discussedNews[this.discussedNews.length - 1]` (`:3608`); `StoryContext.latestNews?: NewsRef` (`src/sim/story.ts:62`); `buildRequest(c)` (`story.ts:147`) ghép câu `tin thời sự vừa bàn: "<title ≤ 80>"` (`:178`) vào `situation = cut(parts.join('. ') + '.', 900)` (`:180`) của prompt lên beat. `storyCtx()` được gọi ở `planBeats` (`:3626-3660`: `:3629`, `:3652`, `:3657`) và `runArcStep` (`:3678`). Chỉ dùng **tiêu đề** (không summary, không url) và chỉ khi đã có ít nhất 1 tin được bàn; `offlinePlan` không đọc `latestNews` (grep toàn `src/` = 3 chỗ trên). Ai đổi shape `NewsRef`/`discussedNews` phải nhớ đường này; nếu tin đã bàn bị phát hiện "không nên bàn", nó vẫn còn trong `discussedNews` (≤ 20) và có thể xuất hiện trong prompt beat cho tới khi bị đẩy ra.

### 7.9 Nút dev 🗞️ — `evNews()` (`:2577-2591`)
`ClientMsg {t:'dev', action:'event', name:'news'}` → server (cần quyền dev) → `world.handleClient` → `director.onEvent('news')` (`:516`). `newsEnabled` false → toast "Thời sự đang tắt (NEWS_ENABLED=false)"; không có kho → toast "Chưa có nguồn tin…"; còn lại: **xoá mọi `news_chat` đang chờ** trong hàng đợi, `enqueue('news_chat', now, now + 40, 'high', { force: '1' })`, log 🗞️ "Có tin nóng trên báo, văn phòng sắp bàn tán". `force` bỏ cap `lastNewsAt` (`:3048`) và dùng `free(a, 'high')`.

**Đường thứ hai tới `evNews()` — timer khôi phục từ `data/state.json`**: `'news'` nằm trong `TIMER_EVENTS` (`director.ts:4267`, cùng `server_down`, `wifi_down`, `payday`, `birthday`, `deal`, `drama`, `release`, `hr_review`, `showrunner`) — danh sách `DevEventName` mà `parseTimer` (`:4352-4366`, kiểm ở `:4362`) chấp nhận khi `restore` nạp `data.timers` (`:4186`, ≤ 20 timer; `serialize` ghi `timers: this.timers` ở `:4131`). Timer `kind: 'event'` tới hạn được `runTimers` (`:816-834`) bắn qua `handleEvent(event, …, auto = true)` nếu trễ < 60 phút game và ≥ 2 agent active → `case 'news': this.evNews()` (`:516`) — **không qua** kiểm tra quyền dev của server. Hiện code **không tự tạo** timer `news`: `planDay` chỉ `ev(…)` cho `server_down`, `wifi_down`, `birthday`, `payday` (`:706-716`); `deal`, `drama`, `release`, `hr_review`, `news`, `showrunner` có trong `TIMER_EVENTS` nhưng không có `addTimer`/`ev(` nào tạo chúng (grep toàn `director.ts`). Nên đường này chỉ xảy ra khi `state.json` đã có sẵn một timer `event: 'news'` (bản cũ ghi, hoặc file bị sửa tay). Biết để không ngạc nhiên khi thấy cảnh thời sự `force` ngay sau khởi động mà không ai bấm nút.

Vấn đề chủ dự án báo "nút dev news bắn 2 cảnh news_chat liền nhau" — giả thuyết từ code (chưa xác minh): (a) mục `force` được dựng nhưng đồng thời tin len vào pantry/lunch ngay sau đó vẫn qua (cap nửa nhịp tính từ `lastNewsAt` vừa đặt → không, phải chờ 12,5 phút; nhưng `lastNewsHintAt` độc lập); (b) `planDay` xếp lại `news_chat` thường khi `ensureDayPlanned` chạy sau đó; (c) client gửi 2 lệnh (DEV_RATE cho 10 lệnh/5 s). Cần tái hiện bằng `npm run smoke:story` (mục probe `'news'`).

---

## 8. Prompt và thoại: luật tin thật

### 8.1 Hai bản luật (`src/ai/prompts.ts`)
- `NEWS_RULES_SHORT` (`:72-73`) nằm **trong system prompt tĩnh** (`:100`) để model nào cũng thấy dù user prompt bị cắt bậc: "TIN THẬT (khi có mục TIN): chỉ cảm nghĩ về tin đúng như báo đăng; không bịa thêm sự thật, số liệu, phát ngôn; không gán tội, không bàn đời tư hay chế giễu người thật; dẫn "theo báo X đăng"."
- `NEWS_RULES` (`:74-79`) nằm trong **user prompt** ngay dưới khối TIN: "LUẬT TIN THẬT (bắt buộc): chỉ nói cảm nghĩ, ý kiến, cảm xúc về tin ĐÚNG NHƯ báo đăng ở trên; không thêm sự thật, con số, phát ngôn, tên người hay chi tiết ngoài tiêu đề/tóm tắt — chi tiết nhắc lại chép đúng chữ báo, giữ mức dè dặt ("nén khóc" ≠ "khóc", "có thể" ≠ "là"); không đoán động cơ, nguyên nhân, cảm xúc người thật ("làm màu", "chắc là bị…"), không kết luận ai đúng sai, không gán tội, không bàn tính cách hay đời tư, không chế giễu người thật có tên (khịa tình huống thì được); dẫn nguồn: "theo báo X đăng", "nghe nói trên báo", "tui chưa đọc kỹ"; 4–8 câu tám chuyện văn phòng, mỗi người phản ứng theo tính cách, sở thích và liên hệ sang chuyện mình (đội bóng mình mê, game mình chơi); không chính trị, tôn giáo."
- `SCENE_DIRECTION.news_chat` (`:129`): "tám chuyện thời sự về đúng 1 tin trong mục TIN, theo LUẬT TIN THẬT: mở kiểu "ê thấy tin… chưa", "báo X đăng đó"; chốt bằng câu đùa hoặc quay về việc."

### 8.2 Khối TIN — `newsLines(news, people, incidental)` (`:531-547`, gọi ở `:443` khi `req.news`)
Dòng 1: `TIN (thật, theo báo <source ≤ 30 | 'báo'> <publishedAgo> , mục <nhãn nhóm>): "<title ≤ 160>" — tóm tắt của báo: "<summary ≤ 200>"` (bỏ tóm tắt nếu rỗng/bằng tiêu đề). `publishedAgo` (`:167-172`): "đăng hôm nay / đăng hôm qua / đăng N ngày trước" theo giờ thật; không có ngày → "mới đăng". Nếu `incidental` (cảnh không phải `news_chat`): thêm "Tin này chỉ là một chuyện xen vào lúc tám ("nghe nói trên báo…"): bàn 2–3 câu theo LUẬT TIN THẬT rồi quay về chuyện của mình." Rồi `NEWS_RULES` nguyên văn, rồi `Có thể liên hệ sang chuyện của mình: <Tên> (<≤ 2 likes>) · …`.
- `NEWS_CATEGORY_LABEL` ở `prompts.ts:162-164` là **bản chép riêng** của `catalog.NEWS_CATEGORY_LABEL` (prompts.ts cố ý không import module nội dung). Thêm nhóm tin phải sửa cả hai.
- Với `news_chat`: **không render** `topicHint` (`:438`), thẻ nhân vật thêm `thích: <≤ 3 likes>` (`:368-371`, `likesNote :313-316`).

### 8.3 Kích cỡ
Theo SPEC §6 (`SPEC.md:765`), `news_chat` 2–3 người ≈ 2,7–2,85k token tổng (system ≈ 1,6k); khối TIN + luật ≈ 150–200 token. Ngân sách user prompt theo bậc ở `src/ai/prompt-budget.ts` (xem [`05-lop-ai.md`](05-lop-ai.md)).

### 8.4 Thoại mẫu offline — mục news_chat `src/ai/offline.ts:3869-3992` (template `:3871-3967`, hàm `bNews` `:3968-3992`)
Nguyên tắc ghi ở `:3870`: **chỉ dùng TIÊU ĐỀ + TÊN BÁO nguyên văn**; mọi câu còn lại là cảm nghĩ/liên hệ bản thân, không thêm chi tiết. Template: `NEWS_OPEN` (12 câu mở, mọi câu đều dẫn nguồn `${c.src}`), `NEWS_OPEN_CAT` (3/nhóm), `NEWS_REACT` (14, kiểu "mới đọc tiêu đề thôi", "nghe sao thấy vậy thôi, mình đâu ở trong cuộc"), `NEWS_REACT_CAT` (4/nhóm), `NEWS_RELATE` (liên hệ theo vai, không đụng nội dung tin), `NEWS_CLOSE` (7). Người mở chuyện ưu tiên "fan" theo `NEWS_LIKE_RE[cat]` trên `likes`. Hiệu ứng: mood +1..3 mỗi người, quan hệ +1..2 từng cặp, ký ức `Bàn tin "<title ≤ 60>" (<source>) với …`. `SC.nTitle` cắt 90 và bỏ dấu ngoặc kép, `nSource` ≤ 30 (`:4685-4687`). Cảnh `pantry_chat/lunch` có `req.news` cũng dùng `bNews` (`:5029`); `news_chat` thiếu thẻ tin → rơi về `bPantry` (`:3970-3973`).

---

## 9. Sanitizer cho tin — `src/ai/sanitize.ts` (lớp 4)

Chỉ áp khi cảnh "newsy": `req.type === 'news_chat' || !!req.news || /^nghe nói/i.test(req.topicHint)` (`:447`; nhánh "nghe nói" là dây an toàn cho đường cũ, Director không còn sinh).

| Bước | Hàm / regex | Dòng | Hành vi |
|---|---|---|---|
| Bỏ câu lẫn chữ ngoại | `looksForeign` (`FOREIGN_SCRIPT_RE` Hán/Hangul/Hiragana/Katakana/Kirin/Thái/Ả Rập/Hebrew/Devanagari; hoặc ≥ 5 từ không dấu tiếng Việt + ≥ 2 từ nối tiếng Anh) | `:82-93, :441-444` | áp cho **mọi** cảnh, đếm `foreignDropped` |
| Bỏ câu gán tội / đời tư | `NEWS_BLOCK_RE` = `bị bắt(?!\s+(?:lười\|quả tang\|gặp\|phải\|làm\|đi\|đứng\|ngồi\|trực\|viết\|học\|cài\|tay\|nạt\|bẻ\|OT))\|bắt giữ\|tạm giam\|khởi tố\|truy tố\|lừa đảo\|ngoại tình\|ma túy\|giết người\|hiếp dâm\|tự tử\|đánh bạc` (flag `iu`); `isNewsSafe = !test` | `:75-76, :453` | kể cả khi model "chỉ đùa"; ngoại lệ là thành ngữ văn phòng "bị bắt lười/quả tang/gặp…" |
| Bỏ câu phán xét người có tên trong tin | `newsProperNames(req.news)` (`:95-112`: từ viết hoa không đứng đầu câu trong title/summary, bỏ `Việt\|Nam\|Anh\|Em\|Chị\|Ông\|Bà\|Tôi`, hạ chữ thường) + `JUDGEMENT_RE` (`:114`: chắc (là), đáng (đời), dở, tệ, ngu, ghét, kém, làm màu, câu view/like, sống ảo, giả tạo, diễn sâu, hám fame, lừa, bịp, thằng, mụ, lão, cố tình, mục đích, âm mưu, dàn dựng, chiêu trò, bẩn, đểu, hết thời, flop, cùi, phế, trash, noob, xấu tính, đáng khinh, vô dụng, bất tài…) → `judgesNamedPerson(text, names, castNames)` (`:119-124`) | `:450-453` | tên **nhân vật trong truyện** (`castNames`) không tính; chỉ bỏ câu vừa nhắc tên người trong tin **vừa** có lời phán xét |
| Còn < 2 câu | `fail("Chỉ còn N câu sau khi bỏ M câu vi phạm luật tin thật")` | `:456-460` | Brain ghi `lastError`, dùng thoại **offline** (`bNews`) — người xem không bao giờ thấy câu vi phạm |
| Ký ức | cảnh có `req.news` → **mọi** ký ức thay bằng mẫu cố định `Bàn tin "<title ≤ 60>" (<source ≤ 20>)` (≤ 120 ký tự); ký ức vẫn qua `isNewsSafe`/`looksForeign` | `:519-535` | không giữ "sự thật" model viết ra, nên ký ức không thể mang thông tin bịa sang cảnh sau |
| Tóm tắt cảnh | `summary` vi phạm `isNewsSafe` hoặc `looksForeign` → `''` → `deriveSummary` (`:313-315`: "<A, B> bàn tin trên <source ≤ 20>: <title ≤ 70>") | `:563` | tóm tắt hiện trên thẻ cảnh khi kết |

Lưu ý: `NEWS_BLOCK_RE` **ngắn hơn nhiều** `BLOCKLIST` — cố ý, vì ở bước này tin đã qua 2 lớp lọc; regex chỉ bắt những chữ model có thể tự thêm vào (kết tội, đời tư). Khi thêm nhóm chủ đề mới vào `BLOCKLIST` nên cân nhắc thêm "động từ kết tội" tương ứng vào `NEWS_BLOCK_RE`.

---

## 10. Giao diện: thẻ TIN gốc và dòng miễn trừ (lớp 5)

### 10.1 Dữ liệu từ server
- `LogEntry.news?: NewsRef` chỉ ở dòng `scene_start` (`types.ts:354`; Director đặt ở `startPlaying`, `director.ts:1436`), `PublicScene.news?: NewsRef` (`types.ts:451`, `director.ts:1588`), `hello.news?: NewsRef[]` = `getNews().recent(5)` (`types.ts:477`, `world.ts:921, 926-933`). Thẻ tin **không có `summary`** — người xem chỉ thấy tiêu đề/nguồn/link, phần tóm tắt chỉ phục vụ prompt.
- Mọi thông điệp này gửi **giống nhau** cho người xem thường và admin (không phải thông tin hệ thống).

### 10.2 Client
- `public/js/store.js`: `store.news` (`:25`, ≤ 30, mới nhất **cuối**); `normNewsRef(n)` (`:111-122`: cần `title`, cắt title 220, source 40, url 1000, category 20; `id` rơi về url/title); `rememberNews` (`:125-134`: trùng id/url → đưa lên mới nhất); cập nhật từ `log` (`:323`), `scene` (`:336`), `hello` (`:365-368`: học từ log cũ, cảnh đang diễn, rồi `hello.news` đè thứ tự) → phát `store.emit('news')`.
- `public/js/ui/news.js`:
  - `NEWS_CAPTION` (`:8`) = "Nhân vật AI chỉ bình luận cảm nghĩ về tin đã đăng trên báo; không phải phát ngôn hay sự thật được xác nhận." — **dòng miễn trừ**, in dưới mỗi thẻ tin (trừ khi `caption: false`) và một dòng chung dưới dải "Tin đang bàn".
  - `safeNewsUrl(url)` (`:13-19`): chỉ nhận `http(s):` tuyệt đối, ≤ 1000 ký tự, không khoảng trắng/`"'<>\\`; sai → thẻ hiện **không có link**.
  - `categoryChip(category)` (`:22-26`) dùng `NEWS_CATEGORIES` ở `public/js/labels.js:242-249`: ⚽ Bóng đá · 🏅 Thể thao · 💻 Công nghệ · 🎮 Game · 🔬 Khoa học · 🎬 Giải trí (nhóm lạ → không chip).
  - `newsCard(news, { compact, caption })` (`:32-47`): `🗞️` + tiêu đề (tối đa 2 dòng, `title` attr) + `Nguồn: <source>` + chip + `<a class="nc-link" target="_blank" rel="noopener">Đọc bài ↗</a>`; `role="note"`, `aria-label="Tin đang bàn: …"`.
  - Dải "🗞️ Tin đang bàn" (`initNewsStrip :52-58`, `render :60-75`; file dài 75 dòng): `#news-strip` nằm đầu tab 📰 Bản tin (`public/index.html:102`), `STRIP_MAX = 5` (`:49`) tin mới nhất, ẩn khi rỗng, một `NEWS_CAPTION` chung.
- `public/js/ui/feed.js`: thẻ cảnh có khối `.sc-news` (`:288-294`, nằm ngoài `<button>` đầu thẻ để link bấm được), nạp từ `PublicScene.news` hoặc `LogEntry.news` (`:320-327`, class `has-news`); khi thu gọn, dòng tóm tắt hiện `🗞️ <title>` nếu chưa có summary (`:209`); sự kiện kèm tin → `ev-wrap` + `newsCard(…, { caption: false })` (`:492-494`). CSS `tone-news` (màu `#0284c7`), `.sc-news`, `.news-strip` ở `public/style.css:1029-1074`.

Ràng buộc nguyên tắc 3 (giao diện cẩn thận): thẻ tin phải **luôn** hiện khi cảnh có tin — `smoke-story` kiểm "news_chat không có thẻ tin hợp lệ" là lỗi (`scripts/smoke-story.ts:238-240`).

---

## 11. `GET /api/news` (`src/server.ts:281-286`, route `:434`)

- Tham số `limit` = `intParam('limit', 120, 1, 240)`.
- Trả `{ ...news.status(), recent: news.recent(20), items: news.items().slice(0, limit).map(it => ({ ...toNewsRef(it), publishedAt })) }` — `items` chỉ mang trường `NewsRef` + `publishedAt`, không có `summary`. `Cache-Control: no-store`.
- Chỉ GET/HEAD (router chặn method khác `:407-410`); **công khai, không cần mã dev**. Mục đích: kiểm tra feed/bộ lọc trên máy chủ thật (`curl https://corp.vibe-coder.fun/api/news | jq .counts`).
- nginx giới hạn `/api/` 2 r/s, burst 5 → 429 (`deploy/nginx.limit.conf:3`, `deploy/nginx.site.conf:29-31`).
- Lúc khởi động server in `📰 Thời sự: N nguồn RSS, tải sau 20 giây rồi mỗi M phút (có giải trí nhẹ|không giải trí) — GET /api/news` + các `newsFeedNotes` (`server.ts:557-561`).

**Vấn đề mở (nguyên tắc 4)**: `status()` gồm `lastError` (ví dụ `"Tuổi Trẻ · cong_nghe: HTTP 503"`), `lastRefreshAt`, `refreshes`, `feeds` — là thông tin hệ thống nhưng ai cũng đọc được. Cân nhắc chặn bằng `devAllowed(req)` như `/api/stats` hoặc lược các trường trạng thái cho người thường.

---

## 12. Kiểm thử — `scripts/test-news.ts` và fixture

### 12.1 Fixture (`scripts/fixtures/news/`, tải 2026-11-01, không mạng)
| File | Kích cỡ | `<item>` | Đặc điểm được test |
|---|---|---|---|
| `tuoitre-the-thao.xml` | 40 022 byte | 50 | CDATA, ngày US `11/1/2026 2:20:00 PM`, `lastBuildDate … GMT+7`, tin bóng đá → `bong_da` |
| `gamek-home.xml` | 39 134 byte | 50 | ngày `GMT+7`, ~1/3 cosplay/"hot girl" bị `PRIVATE_LIFE` bỏ theo thiết kế |
| `vnexpress-giai-tri.xml` | 54 767 byte | 53 | `description` có `<a><img></br>`, pubDate RFC 822 `+0700`, giải trí nhẹ vs đời tư |

`NOW` ghim `2026-11-01T17:00:00+07:00` nên test **không lệ thuộc ngày chạy**. Ngược lại, `smoke.ts:148-152` và `smoke-story.ts:91` nạp fixture nhưng **ghi đè `publishedAt = Date.now() − (i+1) phút`** để tin "luôn mới" (Director `validNews` dùng giờ thật).

### 12.2 Năm mục của `npm run test:news`
1. Đọc RSS: mỗi mẫu ≥ 40 tin; id 12 hex không trùng; tiêu đề ≥ 8, url https; summary ≤ 200 không còn HTML/entity; ≥ 80 % tin VnExpress có summary; nhãn nguồn theo tên miền; 3 định dạng ngày đọc được và nằm trong tuần tải; **không tin nào lấy `now` làm ngày**; ≥ 5 tin `bong_da` trong Tuổi Trẻ thể thao; XML rác → `[]`; Atom tối giản đọc được.
2. Văn bản/ngày/id: `cleanText`, `decodeEntities` (số, hex, tên, Latin-1 kiểu Thanh Niên), `summarize`, `parseDate` 6 dạng, `newsId` bỏ utm/#, `sourceLabel`, `isFootball`.
3. Bộ lọc — danh sách chặn: 14 tiêu đề `mustBlock` phải bị chặn **đúng từ khoá mong đợi** (khớp sai từ cũng là thất bại); **42 tiêu đề thật** (`realBlock`, `test-news.ts:116-140`; nhãn check in `${realBlock.length}`) từng lọt (bắt bớ, cáo buộc, kiện, sa thải, chất cấm, tai nạn, tang sự, chính trị, đời tư, cơ thể, hạnh kiểm) đều bị bỏ với `blocked ≥ 25` và `conduct ≥ 2` (`:146`); 24 tiêu đề `mustKeep` phải được giữ (dự án/an toàn/sự kiện/đang/to; "vòng 1 V-League", "Ronaldo ra đi", "bắt gọn", "nén khóc", linh kiện/yếu tố/điều kiện/phụ kiện/kiện tướng, "vụ nổ siêu tân tinh", "trà xanh", "tranh cãi về luật việt vị", "đình chỉ thi đấu", "Kỳ thi", "Nha Trang", "Hàng gia dụng"); `NEWS_BLOCKLIST` thêm (từ đơn có dấu / cụm không dấu); `matchKeyword` ranh giới từ; `invalid`.
4. Tin cũ (> 3 ngày `old`, 2 ngày giữ); giải trí nhẹ giữ (5 tiêu đề); giải trí nặng bỏ đúng lý do (`blocked`/`showbiz`/`conduct`, "son nude" giữ); chủ đề nhẹ chỉ tính ở tiêu đề; đời tư/cơ thể bị chặn ở game/thể thao; `allowShowbiz=false` → `showbiz_off`; tỉ lệ giữ trên fixture (giải trí giữ ≥ 8/bỏ ≥ 8; thể thao ≥ 70 %, game ≥ 60 %); không tin nào bị bỏ vì từ "cắn" chữ vô hại (`vòng một`, `dương tính`).
5. Kho tin: inject lọc rồi nạp, ≤ 40/nhóm, nhồi 100 tin game → đúng 40 mới nhất; `pick` bản sao/theo nhóm/trong 5 tin mới nhất; exclude/nhóm rỗng → null; `markUsed` không chọn lại, `recent` mới nhất cuối; trần 500 used, ≤ 20 recent; serialize → restore (≤ 12/nhóm, rác bỏ qua); `expandCategories`; `refresh` với `fetcher` giả (1 ok, 1 lỗi HTTP 503; cảnh báo 1 lần/giờ; giữ tin cũ); `status()`; `start()` không gọi mạng ngay; nhảy 4 ngày → `pick()` null.

Số khẳng định: file có **58 lời gọi `check(`** tĩnh (không tính dòng định nghĩa `const check = …` ở `:24`), 4 trong vòng lặp (`:112` `mustBlock` ×14, `:170` `mustKeep` ×24, `:187` `light` ×5, `:201` `heavy` ×8) → 58 − 4 + 51 = **105 khẳng định** khi chạy (tính từ mã, chưa chạy để xác nhận; SPEC §10.2 ghi "76" là số cũ). `npm test` gồm `test:news` (`package.json:14,16`).

### 12.3 Test khác chạm vùng này
- `scripts/smoke-story.ts` (6 hạt × 12 ngày, offline): mỗi hạt ≥ 1 `news_chat` kèm thẻ tin (`scene.news` + `log.news` đủ `id/title/url`), tin đã bàn nằm trong `news.recent()`, `newsUsedMax/newsDiscussedMax` không vượt trần, nút dev `news` có phản hồi (probe `:334-339`).
- `scripts/smoke.ts:692-701`: `pick` theo nhóm/exclude/`markUsed`/`hello.news ≤ 5` mới nhất cuối; `NEWS_ENABLED=false` nên Director không lên lịch thời sự.
- `scripts/eyeball-hr.ts:23,107`: dùng `isNewsSafe` để đếm câu không an toàn trong cảnh AI thật (thủ công, cần key).
- Không có test cho `/api/news` qua HTTP, thẻ tin trên trình duyệt, hay `sanitizeScene` với tin (test-llm mục "v3 news_chat lưới an toàn" nằm ở `scripts/test-llm.ts` — xem [`11-kiem-thu-qa.md`](11-kiem-thu-qa.md)).

---

## 13. Quy trình khi THÊM NGUỒN hoặc NỚI BỘ LỌC (bắt buộc đọc)

### 13.1 Thêm/đổi nguồn RSS
1. Chỉ chọn **mục chuyên đề nhẹ** của báo chính thống Việt Nam: thể thao, công nghệ/số hoá, game, khoa học, giải trí. **Không** thêm mục Pháp luật, Thời sự, Xã hội, Thế giới, Kinh doanh, Sức khoẻ, Đời sống — `BLOCKLIST` không được thiết kế để "lọc sạch" các mục đó và chắc chắn lọt.
2. Nhóm phải ∈ `NEWS_GROUPS`; nếu báo mới, thêm tên miền vào `SOURCE_LABELS` (`feeds.ts:203-209`) để nhãn nguồn đẹp (không bắt buộc).
3. Tải feed về làm fixture mới (`curl -sL <url> > scripts/fixtures/news/<ten>.xml`, ≤ ~55 KB), kiểm `parseRss` đọc ≥ 40 tin, **có `pubDate`** (không thì mọi tin thành "mới nhất" — §4.6), ngày đúng múi giờ, `summary` sạch HTML.
4. Chạy `filterNews` trên fixture và **đọc toàn bộ `dropped` lẫn `kept`** bằng mắt: mọi tin `kept` phải là tin bạn sẵn sàng để nhân vật bình luận công khai. Thêm các tiêu đề đáng ngờ vào `realBlock`/`mustKeep` của `test-news.ts`.
5. Cập nhật `DEFAULT_NEWS_FEEDS` (nếu là mặc định), bảng §2.3 ở đây, bảng trong `v3-news.md`, README §7, SPEC §10.1; chạy `npm run test:news` và `npm run smoke:story`.
6. Trên máy chủ thật, sau deploy xem `GET /api/news` (`counts`, `lastError`) và log `📰 Thời sự:`.

### 13.2 Nới / sửa bộ lọc
- **Không bao giờ** xoá cả một nhóm chủ đề khỏi `BLOCKLIST` (pháp lý, bạo lực/tang sự, chính trị/tôn giáo, đời tư/18+). Những nhóm này là ranh giới pháp lý, không phải tinh chỉnh chất lượng.
- Từ chặn "cắn" chữ vô hại (ví dụ "công an" trong tên CLB) → thêm **ngoại lệ** vào `BLOCK_EXCEPTIONS` (chỉ vô hiệu đúng từ đó) hoặc **regex loại trừ** trong `BLOCK_PATTERNS`, **không** xoá từ. Nếu bản không dấu trùng cụm vô hại → thêm tiền tố `=` (so khớp có dấu) thay vì bỏ.
- Mỗi thay đổi phải đi kèm **một dòng test**: tiêu đề phải chặn → `mustBlock`/`realBlock`; tiêu đề phải giữ → `mustKeep`/`light`/`heavy`. Chạy `npm run test:news` và nhìn tỉ lệ `kept` trên fixture không tụt dưới ngưỡng.
- Nhớ **ba lớp từ khoá độc lập**: `filter.ts` (`BLOCKLIST`…), `catalog.NEWS_BLOCK_PHRASES` (lớp 2, chuỗi con) và `sanitize.NEWS_BLOCK_RE` (lớp 4, thoại). Nới lớp 1 mà lớp 2 còn giữ cụm đó thì tin vẫn bị Director bỏ (và bị đánh dấu đã dùng) — đồng bộ cả ba và ghi lý do trong commit.
- `PERSON_CONDUCT` chỉ áp cho tin "về con người"; nếu thấy nó làm rơi quá nhiều tin thể thao, sửa `PERSON_NAME_RE`/`NAME_IS_PERSON` chứ không xoá từ hạnh kiểm.
- Người vận hành có thể **siết** ngay không cần deploy code bằng `NEWS_BLOCKLIST` trong `.env` (khởi động lại); không có cách "nới" từ `.env` — đó là chủ ý.

### 13.3 Dấu hiệu cần hành động ngay (vận hành)
Thấy trên site một thẻ tin/câu thoại về bắt bớ, kiện tụng, tang sự, chính trị, đời tư, hoặc câu chê bai người thật có tên → (1) bấm "Đọc bài ↗" lấy tiêu đề; (2) thêm từ khoá vào `NEWS_BLOCKLIST` (siết nóng) hoặc `BLOCKLIST` + test; (3) tin đã `markUsed` nên không lặp lại, nhưng `data/history/*.jsonl` (kind `news`) cho biết tin đã bàn lúc nào/với ai; (4) nếu lỗi ở câu thoại (tin hợp lệ nhưng AI phán xét) → bổ sung `JUDGEMENT_RE`/`NEWS_BLOCK_RE` và thêm ca vào `scripts/test-llm.ts`.

---

## 14. Lệch giữa code hiện tại và tài liệu cũ (để người đọc không bị lừa)

| Tài liệu | Ghi | Thực tế |
|---|---|---|
| `docs/v3-news.md:33-34` | "lưu ~40 tin mỗi nhóm trong bộ nhớ + persist" | bộ nhớ ≤ 40, persist chỉ **12/nhóm** (`PERSIST_PER_CATEGORY`) |
| `docs/v3-news.md:32` | "cập nhật mỗi 30–60 phút" | mặc định 45, sàn 5 phút (config) |
| `docs/v3-news.md:48` | "Tab 📰 Bản tin có mục nhỏ … (5 tin gần nhất) — tuỳ chọn" | đã làm: dải "🗞️ Tin đang bàn", `STRIP_MAX = 5` |
| `README.md:423` | tin len vào tám chuyện qua "gợi ý 'nghe nói…'" | đi đường `d.news`/`req.news` (thẻ TIN + luật + lưới an toàn), không qua `topicHint` |
| `SPEC.md` §10.2 (`:954-956`, `SHOWBIZ_PRIVATE` ở `:955`) | `DropReason` không có `conduct`; `SHOWBIZ_PRIVATE` "chỉ nhóm giai_tri" | có `conduct` (`filter.ts:230`); `PRIVATE_LIFE` áp **mọi nhóm** (`judge :261`) |
| `SPEC.md:971` | `test:news` "76 khẳng định" | 105 theo mã (58 `check(`, 4 trong vòng lặp) — chưa chạy để xác nhận |
| Báo cáo khảo sát nội bộ | `NEWS_BLOCK_PHRASES` "~60 cụm" | đếm được **50** |

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … | chạy |
|---|---|---|
| Thêm/bớt feed trong `DEFAULT_NEWS_FEEDS` hoặc `NEWS_GROUPS` (`config.ts:202-218`) | §2.3 tài liệu này; bảng nguồn `v3-news.md`; README §7; SPEC §10.1; `.env.example` dòng 107-109; thêm fixture + mục 1 `test-news.ts` | `npm run test:news`, `npm run smoke:story` |
| Thêm **nhóm tin** mới (`types.NewsCategory`) | `config.NEWS_GROUPS`, `store.ALL_CATEGORIES`, `catalog.NEWS_CATEGORIES/NEWS_CATEGORY_LABEL/NEWS_INTEREST/NEWS_REACTION_SEEDS`, `prompts.NEWS_CATEGORY_LABEL` (bản chép), `offline.NEWS_CATS/NEWS_OPEN_CAT/NEWS_REACT_CAT/NEWS_LIKE_RE`, client `labels.NEWS_CATEGORIES` (chip), §1 quy ước + §7.5 ở đây, SPEC §10.2 | `npm run typecheck`, `test:news`, `smoke:story` |
| `BLOCKLIST` / `BLOCK_EXCEPTIONS` / `BLOCK_PATTERNS` / `PRIVATE_LIFE` / `PRIVATE_PATTERNS` / `PERSON_CONDUCT` / `SHOWBIZ_ALLOW` | §5.2 (số mục), §13.2; thêm ca `mustBlock`/`realBlock`/`mustKeep`/`heavy`; cân nhắc `NEWS_BLOCK_PHRASES` (lớp 2) và `NEWS_BLOCK_RE` (lớp 4) | `npm run test:news` |
| Quy tắc `matchKeyword` (`=`, ngưỡng 3 chữ, ranh giới từ) | §5.1; mục "matchKeyword" trong test; **kiểm lại toàn bộ** biến thể không dấu tường minh (`filter.ts:126`) và `FOOTBALL_KEYWORDS` (dùng chung hàm) | `test:news` |
| Thứ tự trong `judge()` hoặc thêm `DropReason` | §5.3; SPEC §10.2; ca test đọc `reason` | `test:news` |
| `fetchText` (timeout, maxBytes, redirect, header) | §3; SPEC §10.2 | `test:news` (mục 5 dùng `fetcher` giả — cần test thủ công với feed thật) |
| `parseRss`/`parseDate`/`summarize`/`newsId`/`sourceLabel` | §4; mục 1–2 test | `test:news` |
| `FOOTBALL_KEYWORDS` | §4.4; ca `isFootball`; kiểm địa danh trùng | `test:news` |
| Hằng số kho (`USED_KEEP`, `RECENT_KEEP`, `PERSIST_PER_CATEGORY`, `TOP_N`, trần 40) | §6.1, §6.4, §6.5; mục 5 test; SPEC §10.2; `v3-news.md` | `test:news`, `npm run smoke` |
| Shape `serialize()` của kho (`v: 1`) | §6.5; `restore()` phải đọc được bản cũ trong `data/state.json`; [`09-cau-hinh-du-lieu.md`](09-cau-hinh-du-lieu.md) | `test:news` mục 5, `smoke` |
| `NewsItem`/`NewsRef` (`types.ts:200-211`) | `sanitizeNewsItem`, `sanitizeRef`, `toNewsRef`, `newsRefOf`, client `normNewsRef`, `/api/news`, `StoryContext.latestNews` (`story.ts:62`, `:178`) + §7.8, SPEC (quy tắc `types.ts:3`) | `typecheck`, toàn bộ `npm test` |
| `discussedNews` (trần 20, thứ tự, nội dung) | §7.1, §7.8 (đường sang `storyCtx().latestNews` — `director.ts:3608`), `serialize().story` | `smoke:story` |
| Shape `RefreshReport` (`store.ts:37-44`) hoặc cách tính `added/dropped/total` trong `doRefresh` | §6.2; mục 5 `test-news.ts:284-285`; dòng log `📰 Thời sự:` (`store.ts:199-202`) | `test:news` |
| Xoá/đổi `GroupReason 'news'` (`scenes.ts:905`, `:910`, `:957`) | §7.1 (bỏ đoạn "mã chết"); SPEC §5.1 nếu có liệt kê reason | `npm run typecheck`, `smoke:story` |
| Lịch `news_chat` trong `planDay` (545–600, bước 75–110, né 715–790, cửa sổ 40) hoặc cap `NEWS_SCENE_MIN_MINUTES`/warm-up | §7.2–7.3; SPEC §5.1 dòng news_chat; README §7 | `smoke:story` |
| Xác suất/nhịp tin len vào pantry/lunch (1/3, nửa nhịp, trọn nhịp) | §7.7; SPEC §5.9; README §7 (sửa luôn câu "nghe nói" lỗi thời) | `smoke:story` |
| `validNews`, `peekNews` (3 lần), `newsBlocked`, `NEWS_BLOCK_PHRASES` | §7.3–7.4; SPEC §5.9 | `smoke:story` |
| `pickNewsGroup`/`newsInterest`/`NEWS_INTEREST` | §7.5; SPEC §5.1 | `smoke:story` |
| `sitNewsChat`, `NEWS_SAFETY_RULES`, `NEWS_REACTION_SEEDS` | §7.6; SPEC §5.1 "Situation writers v3" | `smoke:story`, `eyeball` thủ công |
| `NEWS_RULES`, `NEWS_RULES_SHORT`, `newsLines`, `SCENE_DIRECTION.news_chat` | §8.1–8.2; SPEC §6 (`:752-760`); đo lại kích cỡ prompt (`test-llm` mục kích cỡ ≤ 2,5k) | `npm run test:llm` |
| `NEWS_BLOCK_RE`, `JUDGEMENT_RE`, `newsProperNames`, mẫu ký ức | §9; SPEC §6 (`:780-782`); ca "v3 news_chat lưới an toàn" trong `test-llm.ts` | `test:llm` |
| Template offline `bNews` | §8.4; giữ nguyên tắc "chỉ tiêu đề + tên báo" | `smoke`, `smoke:story` |
| `/api/news` (shape, quyền) | §11; SPEC §10.5; [`02-kien-truc-va-giao-thuc.md`](02-kien-truc-va-giao-thuc.md) | thủ công `curl` |
| `news.js` / `feed.js` / `store.js` / `labels.js` (thẻ tin, `NEWS_CAPTION`, dải Tin đang bàn) | §10; [`08-frontend-giao-dien.md`](08-frontend-giao-dien.md); SPEC §7 ghi chú thẻ news; **khởi động lại server** để đổi `ASSET_VERSION` | mở trang kiểm tra bằng mắt |
| Đổi câu `NEWS_CAPTION` | §1.1, §10.2, `v3-news.md` "Giao diện" — chỉ sửa sau khi chủ dự án đồng ý (câu miễn trừ) | — |
| Thêm `DevEventName` liên quan tin | `types.ts:457`, `server.ts:48-51`, `world.ts:105-108`, `director.handleEvent` (`:503`), và `TIMER_EVENTS` (`director.ts:4267`) nếu muốn timer khôi phục được; §7.9 | `smoke:story` probe |

## Câu hỏi còn mở / cần kiểm tra

1. **Nút dev 🗞️ bắn 2 cảnh liền nhau** (chủ dự án báo): chưa tái hiện; giả thuyết ở §7.9. Cần chạy `smoke:story` có log verbose quanh probe `'news'` hoặc thêm khẳng định "sau `evNews` chỉ có 1 `news_chat` trong 10 phút game".
2. **`/api/news` công khai `lastError`/`refreshes`** — vi phạm tinh thần nguyên tắc 4; quyết định: chặn bằng `devAllowed` hay lược trường? (§11)
3. **`NEWS_INTEREST.keywords` so khớp chuỗi con** (`'ai'`, `'mu'`, `'real'`) làm nhoè sở thích (§7.5) — nên dùng `matchKeyword`; chưa đo tác động.
4. Số khẳng định thực tế của `npm run test:news` (tính từ mã: 58 lời gọi `check(`, 4 trong vòng lặp → 105) và thời gian chạy — chưa chạy trong lần viết tài liệu này.
5. `validNews` dùng `Date.now()` còn kho dùng `opts.now` → test đồng hồ ảo chỉ đúng khi fixture được ghim `publishedAt` gần hiện tại (smoke đã làm). Có nên cho Director nhận `now()` tiêm được?
6. `PERSON_NAME_RE` coi địa danh 2 tiếng viết hoa là người ở nhóm thể thao/giải trí → tỉ lệ `conduct` thật trên feed sống là bao nhiêu? Cần thống kê `dropped` theo `reason` trên máy chủ (ý tưởng: endpoint dev-only xem `dropped` gần nhất).
7. Tin không có `pubDate` lấy `now` → luôn lọt `TOP_N` (§4.6). Có nên gắn cờ/hạ ưu tiên tin không có ngày?
8. `store.pick()` chọn nhóm đều nhau; Director đã xoay vòng nên không ảnh hưởng cảnh `news_chat`, nhưng **tin len vào pantry/lunch** gọi `peekNews(newsCats())` với mọi nhóm → nhóm 1 feed (`khoa_hoc`) xuất hiện nhiều như nhóm 3 feed. Chủ ý hay không?
9. `'bị tố'` lặp trong `BLOCKLIST` (`:102`, `:121`); `mỉa mai`/`phát ngôn sốc`/`sắc vóc` trùng giữa danh sách — dọn hay giữ (vô hại)?
10. `NEWS_BLOCK_PHRASES` (50) lệch với `NEWS_BLOCK_RE` (12 mẫu) và `BLOCKLIST` (290): có nên sinh `NEWS_BLOCK_PHRASES` từ một tập con có đánh dấu của `BLOCKLIST` để khỏi chép tay?
11. Các báo trong `SOURCE_LABELS` ngoài 4 báo mặc định (Dân Trí, Znews, Kenh14, Lao Động…) chưa được kiểm tra RSS thật — nếu dùng phải làm theo §13.1.
12. `docs/v3-news.md` và SPEC §10.2 còn các điểm lỗi thời ở §14 — ai sửa, khi nào?
13. `GroupReason 'news'` (`scenes.ts:905/910/957`) là mã chết và nguy hiểm nếu dùng lại (không thẻ tin, không sanitize newsy — §7.1). Đề xuất xoá hẳn; cần chủ dự án quyết.
14. `validNews` bỏ qua kiểm tuổi khi `publishedAt ≤ 0`/không hữu hạn, trong khi kho (`isTooOld`) coi là cũ (§7.3). Có nên đồng bộ: lớp 2 cũng coi `publishedAt` không hợp lệ là không bàn?
15. `TIMER_EVENTS` (`director.ts:4267`) chấp nhận 10 tên nhưng code chỉ tạo timer cho 4 (`server_down`, `wifi_down`, `birthday`, `payday` — `:710-716`); `deal`, `drama`, `release`, `hr_review`, `news`, `showrunner` chỉ có thể tới từ `data/state.json` (§7.9) — thu hẹp danh sách, hay giữ để tương thích `state.json` cũ?
16. `NEWS_FEEDS` có giá trị nhưng toàn mục sai → 0 feed, kho không bao giờ tải (§2.2) — nên rơi về `DEFAULT_NEWS_FEEDS` kèm cảnh báo, hay fail-fast lúc khởi động?
17. §7.8: tin đã bàn nằm trong `discussedNews` tới 20 lượt và được đưa vào prompt beat qua `latestNews` — nếu sau đó phát hiện tin "không nên bàn", chưa có cách rút nó khỏi `discussedNews`/`recentRefs` ngoài sửa `data/state.json` tay (cần kiểm tra có đáng làm nút dev không).
