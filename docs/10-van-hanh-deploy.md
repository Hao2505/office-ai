# Vận hành & deploy

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: `deploy/deploy.sh`, `deploy/nginx.site.conf`, `deploy/nginx.limit.conf`, hai file bí mật `deploy/vps.env` + `deploy/.env.production` (chỉ nhắc **tên biến**), phần "vận hành" của `src/server.ts` (`/api/health`, `/api/stats`, cookie admin, `/v/<ASSET_VERSION>/`, tắt êm), `public/js/net.js` (mã dev, nối lại), `public/js/store.js:140-202` (bộ đệm chống giật), `public/js/ui/hud.js` + `public/js/ui/devbar.js` (chip 🤖, nút 🚪) · Đọc khi: cần đưa bản mới lên site thật, site lỗi (502, giật, giao diện cũ, AI offline, hết quota), cần vào/thoát admin, cần đổi `.env` production, thêm route/nginx, hoặc lần đầu dựng lại VPS.

Tài liệu này trả lời: bản production đang chạy **ở đâu, bằng gì, qua những lớp nào** (Cloudflare → nginx → Node), `deploy/deploy.sh` làm **đúng từng bước gì** và bẫy ở đâu, từng chỉ thị nginx **vì sao** có mặt, Cloudflare ảnh hưởng thế nào (cache 4 giờ, gói WebSocket đến so le, chế độ SSL), **lệnh** xem log / health / pm2, cách **cập nhật & rollback**, cách vào **admin** bằng `DEV_TOKEN`, cách **đọc chip 🤖** để theo dõi quota AI miễn phí, và **sự cố thường gặp**. Nó không chép lại giao thức HTTP/WS (xem [02-kien-truc-va-giao-thuc.md](./02-kien-truc-va-giao-thuc.md) §6–§8, §10), cấu hình AI (xem [05-lop-ai.md](./05-lop-ai.md) §2, §4), snapshot/archive (xem [03-mo-phong-the-gioi.md](./03-mo-phong-the-gioi.md) §16–§17) hay hướng dẫn chủ dự án (`../README.md` §3, §8, §11). Mục lục và lộ trình đọc theo vai trò: [README.md](./README.md) (và [01-tong-quan.md §10](./01-tong-quan.md)).

**Quy tắc bí mật của tài liệu này**: không có IP, mật khẩu, API key hay `DEV_TOKEN` thật ở đây và ở mọi tài liệu khác. Giá trị thật nằm trong `deploy/vps.env` và `deploy/.env.production` (gitignored, `.gitignore:9-10`; rsync cũng loại trừ, `deploy/deploy.sh:33`). Khi tài liệu viết "xem `deploy/vps.env`" nghĩa là mở file đó trên máy dev, không hỏi ai.

---

## 1. Kiến trúc production

### 1.1 Sơ đồ

```
Người xem (trình duyệt)                                  Admin (trình duyệt đã mở link #dev=<DEV_TOKEN> một lần)
   │  https://corp.vibe-coder.fun   HTTP + WSS                 │  cùng đường, thêm ?dev=<token> trên URL WebSocket + cookie vpa_dev
   ▼                                                           ▼
┌──────────── Cloudflare: DNS + proxy (đám mây cam) + SSL + cache tĩnh + "Always Use HTTPS" ─────────────────────┐
│  • ép max-age 4 giờ cho .js/.css  → app né bằng /v/<ASSET_VERSION>/… (§5.2)                                   │
│  • gói WebSocket tới trình duyệt so le 100/300 ms → client vẽ trễ qua bộ đệm thích ứng (§5.3)                   │
└───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────┘
                                        │ tới origin bằng HTTP (80) hoặc HTTPS (443) — tuỳ SSL mode, xem §5.1
                                        ▼
┌──────────── VPS Ubuntu 24.04 DÙNG CHUNG với app khác (1 vCPU, 2 GB) ───────────────────────────────────────────┐
│  nginx  /etc/nginx/sites-available/<DOMAIN>  (+ /etc/nginx/conf.d/vpa-limit.conf)                              │
│    location = /ws   → proxy WebSocket, access_log off, timeout 3600 s                                           │
│    location /api/   → limit_req 2 r/s + burst 5 → 429                                                           │
│    location /       → proxy (kèm header WS), ?dev= không ghi log                                                │
│                     proxy_pass http://127.0.0.1:3200                                                            │
│                            ▼                                                                                    │
│  pm2 (user "deploy") ── tiến trình "vibecorp" = `npm start` = `tsx src/server.ts`, cwd /opt/vibecorp             │
│    /opt/vibecorp/.env (chmod 600) · data/state.json · data/history/YYYY-MM-DD.jsonl(.gz) · node_modules/        │
│  certbot (Let's Encrypt, chứng chỉ cho <DOMAIN>) · các app khác trên VPS (cổng 3000 đã bận — KHÔNG đụng)        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                        │ chỉ server gọi ra ngoài
                                        ▼
   Gemini · Groq · Cloudflare Workers AI (endpoint OpenAI-compatible)   ·   RSS báo (VnExpress, Tuổi Trẻ, Thanh Niên, GameK)
```

### 1.2 Bảng thành phần

| Thành phần | Giá trị | Nguồn kiểm chứng |
|---|---|---|
| Tên miền | `corp.vibe-coder.fun` (biến `DOMAIN` trong `deploy/vps.env`) | `README.md:3`, `docs/ui-polish-todo.md:96` |
| Máy chủ | VPS Ubuntu 24.04 dùng chung, 1 vCPU / 2 GB, có sẵn nginx + certbot + pm2; địa chỉ/cổng SSH/tài khoản trong `deploy/vps.env` | `deploy/deploy.sh:3,6`, `ui-polish-todo.md:100` |
| Thư mục app | `/opt/vibecorp` (`APP_DIR`, cố định trong script) | `deploy.sh:17` |
| Người chạy app | user `deploy` (`APP_USER`); file thuộc `deploy:deploy`, `.env` quyền 600 | `deploy.sh:19,43` |
| Tiến trình | pm2 tên **`vibecorp`**, lệnh `npm start` → `tsx src/server.ts` (không có bước build) | `deploy.sh:45`, `package.json:9` |
| Cổng app | **3200** (`APP_PORT` mặc định trong script; `PORT` trong `.env.production` phải bằng đúng số này) | `deploy.sh:18`, `nginx.site.conf:14,32,43` |
| Reverse proxy | nginx site riêng `/etc/nginx/sites-available/<DOMAIN>` + vùng `limit_req` ở `/etc/nginx/conf.d/vpa-limit.conf` | `deploy.sh:50-52` |
| TLS tại origin | Let's Encrypt qua `certbot --nginx`: khối `listen 443 ssl` + khối cổng 80 chuyển sang https; chứng chỉ corp hạn 2027-01-30, tự gia hạn bằng `snap.certbot.renew.timer` 2 lần/ngày (kiểm 2026-11-03) | `deploy.sh:55-56`, `ui-polish-todo.md:96` |
| Phía trước | Cloudflare proxy, SSL **Full (strict)** (Full xác nhận 2026-11-03, chủ dự án chuyển strict cùng ngày): request https vào origin cổng 443 và Cloudflare kiểm chứng chỉ → mọi site trên VPS phải có khối 443 với chứng chỉ hợp lệ | xem §5.1 |
| Deploy lần đầu | `bash deploy/deploy.sh --setup` (2026-11-01 20:15) | `ui-polish-todo.md:96` |
| Cập nhật | `bash deploy/deploy.sh` | `deploy.sh:4-5` |
| Mã nguồn | repo git cục bộ trên máy dev (commit `9d1d455` khởi tạo, `0e9e925` thêm link site); **VPS không có `.git`** (rsync loại trừ) — rollback = deploy lại bản cũ từ máy dev (§7.2) | `git log`, `deploy.sh:31` |

### 1.3 Thư mục và file trên VPS — cái gì bị ghi đè, cái gì được giữ

| Đường dẫn trên VPS | Từ đâu | Qua mỗi lần `deploy.sh` |
|---|---|---|
| `/opt/vibecorp/src`, `public/`, `scripts/`, `data/products.json`, `package*.json`, `docs/*.md`, `deploy/*.conf`, `deploy/deploy.sh`… | `rsync` toàn bộ thư mục dự án | **Ghi đè theo máy dev; file không còn ở máy dev bị xoá** (`--delete`) |
| `/opt/vibecorp/.env` | `scp deploy/.env.production` | **Ghi đè mỗi lần** → sửa tay `.env` trên VPS sẽ mất; luôn sửa `deploy/.env.production` rồi deploy lại |
| `/opt/vibecorp/data/state.json`, `state.json.bad-*`, `state.json.tmp-*` | app tự ghi (`World.save`, mỗi 60 s + khi tắt) | **Giữ nguyên** (exclude `data/state.json`, `data/state.json.*`) |
| `/opt/vibecorp/data/history/` | app tự ghi (archive JSONL theo ngày VN) | **Giữ nguyên** (exclude `data/history`) |
| `/opt/vibecorp/node_modules/` | `npm install --include=dev` trên VPS | Giữ nguyên rồi `npm install` cập nhật theo `package-lock.json` vừa rsync |
| `/opt/vibecorp/docs/preview/`, `.git/`, `.claude/` | — | **Không bao giờ lên VPS** (exclude) |
| `/etc/nginx/sites-available/<DOMAIN>`, `/etc/nginx/conf.d/vpa-limit.conf` | `deploy.sh --setup` | Chỉ đổi khi chạy `--setup` (ghi đè cả phần certbot đã thêm — §3.7) |
| `/home/deploy/.pm2/` (danh sách tiến trình đã `pm2 save`, log `vibecorp-out.log` / `vibecorp-error.log` theo mặc định pm2) | pm2 | `pm2 save` mỗi lần deploy |

Đường dẫn tương đối trong `.env` (`STATE_FILE=data/state.json`, `HISTORY_DIR=data/history`) được `resolve()` theo **cwd của tiến trình** (`src/sim/persist.ts:17`, `src/sim/archive.ts:98`), và cwd là `/opt/vibecorp` vì pm2 được start trong `cd $APP_DIR` (`deploy.sh:44`). Đổi cách start (ví dụ `pm2 start` từ thư mục khác) sẽ làm app tạo `data/` ở chỗ khác và "mất" trạng thái.

### 1.4 Vòng đời tiến trình dưới pm2

- **Khởi động** (`src/server.ts:243-256`, chi tiết ở [02 §2](./02-kien-truc-va-giao-thuc.md)): `getArchive().configure(...).start()` → `createBrain(CONFIG)` → `new World` → `new Director` → `world.load()` (nếu `PERSIST`) → `world.start()` → `getNews().start()` (lần tải RSS đầu sau ~20 s). Rồi `server.listen(CONFIG.port)` (`:533`) và in khối log khởi động (`:533-570`): URL, chuỗi provider AI (hoặc "🧪 AI: OFFLINE"), chế độ thời gian, số sản phẩm, lưu trạng thái, archive, thời sự, **bảng dev** ("tắt" / "chỉ cho trình duyệt mở trang kèm ?dev=<DEV_TOKEN>" / "BẬT cho mọi người xem"), ngày giờ game. **Token không bao giờ được in** (`:562-567`).
- **Lưu định kỳ**: `setInterval(() => world.save(), 60_000)` (`:498`), ghi nguyên tử `state.json.tmp-<pid>` → `fsync` → `rename` (`persist.ts:16-34`) nên không có file nửa vời.
- **Tắt êm** `shutdown()` (`:500-517`) khi nhận `SIGINT`/`SIGTERM`: `world.stop()` → `news.stop()` → `world.save()` → `archive.stop()` (ghi nốt hàng đợi, đồng bộ) → đóng mọi socket mã `1001 'server shutdown'` → `wss.close()` → `server.close(() => exit(0))`, dự phòng `exit(0)` sau **1,5 s**. `pm2 restart vibecorp` gửi tín hiệu dừng cho tiến trình (pm2 mặc định gửi SIGINT rồi mới SIGKILL sau một khoảng chờ — **cần kiểm tra giá trị `kill_timeout` của pm2 trên VPS** để chắc nó ≥ 1,5 s), nên **mỗi lần deploy trạng thái được lưu trước khi tắt**.
- **Lỗi lẻ không làm chết tiến trình**: `uncaughtException` / `unhandledRejection` chỉ ghi log (`:520-521`). pm2 chỉ phải khởi động lại khi tiến trình thật sự thoát (ví dụ `EADDRINUSE` → `exit(1)`, `:524-531`).
- **Người xem khi deploy**: socket bị đóng → `net.js` hiện "Mất kết nối…" (`hud.js:26-28`) và nối lại với backoff `min(15 s, 800 ms × 1.7^lần) × (0,8..1,2)` (`net.js:117-122`); khi mở lại nhận `hello` đầy đủ → không cần tải lại trang. Gián đoạn thực với người xem ≈ tắt êm (≤ 1,5 s, `server.ts:514`) + tsx/Node khởi động + `world.load()` cho tới `server.listen` (`server.ts:243-256`, `:533`). `npm install` (`deploy.sh:44`) chạy **trước** `pm2 restart` (`:45`) khi tiến trình cũ vẫn phục vụ, và `sleep 4` (`:46`) chạy **sau** restart chỉ để chờ kiểm tra — cả hai không kéo dài gián đoạn (xem §3.7).

---

## 2. Chuẩn bị: máy dev, VPS, hai file bí mật

### 2.1 Máy dev

| Cần | Vì sao |
|---|---|
| `bash`, `ssh`, `scp`, `rsync`, `curl` | script dùng cả bốn lệnh mạng: `ssh` (`deploy.sh:16`), `rsync` (`:31`), `scp` (`:40`), `curl` kiểm tra health qua Cloudflare từ máy dev (`:63`; thiếu `curl` chỉ in `(https chưa sẵn sàng — xem bước SSL)` vì có `\|\| echo`) |
| **`sshpass`** | script đăng nhập bằng mật khẩu qua `sshpass -e` (đọc biến `SSHPASS`, `deploy.sh:15`); nó bọc **cả ba** lệnh `ssh` (`:16`), `rsync` (`:31`) và `scp` (`:40`), không chỉ `ssh`. Chưa chuyển sang khoá SSH — xem Câu hỏi còn mở |
| `deploy/vps.env` | bắt buộc; thiếu → "Thiếu deploy/vps.env", `exit 1` (`:13`) |
| `deploy/.env.production` | bắt buộc; thiếu → thông điệp gợi ý + `exit 1` (`:39`) |
| Đã chạy `npm test` xanh | script **không** chạy test; xem §11 |

### 2.2 VPS

| Cần sẵn | Dùng ở bước |
|---|---|
| Node.js (README §1 yêu cầu ≥ 20; `package.json` không có `engines`; script chỉ **in** `node -v`, không kiểm tra — `deploy.sh:23`) | `npm install`, `tsx` |
| `npm`, `pm2` cài toàn cục và chạy được dưới user `deploy` | `:44-46` |
| `nginx`, `certbot` với plugin nginx | `--setup` `:48-56` |
| user `deploy` với `$HOME=/home/deploy` | `pm2 startup systemd -u deploy --hp /home/deploy` (`:58`) |
| Tài khoản SSH (`VPS_USER`) đủ quyền `chown`, ghi `/etc/nginx`, `systemctl reload nginx`, `certbot`, `su - deploy` | mọi bước ghi hệ thống |
| Cổng 3200 trống (3000 đã bận bởi app khác — `ui-polish-todo.md:100`) | `server.listen` |
| Ra được Internet tới Gemini/Groq/Cloudflare và các RSS | AI + thời sự |
| `curl` | bước kiểm tra trong VPS `sleep 2; curl -s -m 5 http://127.0.0.1:$APP_PORT/api/health` (`:62`) — thiếu thì chỉ in `app chưa trả lời` (có `\|\| echo`), script vẫn `✅` → dễ bỏ sót |

### 2.3 `deploy/vps.env` — chỉ tên biến

Được `source` với `set -a` (`deploy.sh:14`) nên mọi biến trong đó thành biến môi trường của script.

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `VPS_HOST` | `:16,22,36,40,64` | máy chủ SSH |
| `VPS_PORT` | `:16,22,35,40,64` | cổng SSH |
| `VPS_USER` | `:16,36,40,64` | tài khoản SSH (xem quyền ở §2.2) |
| `VPS_PASS` | `:15` → `SSHPASS` | mật khẩu, chỉ ở trong file này |
| `DOMAIN` | `:49,51-52,56,63` | tên miền cho nginx site, certbot, kiểm tra HTTPS |
| `APP_PORT` (tuỳ chọn) | `:18` | ghi đè cổng 3200; nếu đổi phải đổi cả `PORT` trong `.env.production` **và** chạy lại `--setup` để nginx trỏ đúng |

### 2.4 `deploy/.env.production` — những biến PHẢI khác `.env.example`

File này trở thành `/opt/vibecorp/.env` (`deploy.sh:40`); `dotenv` đọc nó lúc khởi động (`src/config.ts:1-2`). Toàn bộ danh sách biến xem [09-cau-hinh-du-lieu.md](./09-cau-hinh-du-lieu.md) và `.env.example`; dưới đây chỉ là những biến **quyết định production chạy được và an toàn**.

| Biến | Giá trị production | Vì sao / nơi đọc |
|---|---|---|
| `PORT` | **3200** (= `APP_PORT`) | `.env.example:102` ghi 3000 (đã bận trên VPS); nginx `proxy_pass http://127.0.0.1:__PORT__` được `sed` từ `APP_PORT` (`deploy.sh:51`). Lệch → nginx 502 |
| `PERSIST` | `true` | `CONFIG.persist` (`config.ts:292`): `world.load()` lúc khởi động, `save()` 60 s + khi tắt |
| `STATE_FILE` | để mặc định `data/state.json` | tương đối cwd `/opt/vibecorp` (§1.3) |
| `DEV_PANEL` + `DEV_TOKEN` | `DEV_PANEL=true` **và** `DEV_TOKEN=<chuỗi dài, ví dụ tạo bằng `openssl rand -hex 16`>`; hoặc `DEV_PANEL=false` để tắt hẳn | `devAllowed()` (`server.ts:68-75`): `DEV_TOKEN` trống + `DEV_PANEL=true` ⇒ **mọi người xem đều bấm được bảng dev và thấy số liệu hệ thống** — vi phạm nguyên tắc (4); log khởi động cảnh báo đúng tình huống này (`server.ts:567`) |
| `AI_PROVIDERS` + `AI_<TÊN>_API_KEY`, `AI_<TÊN>_MODEL`, trần `RPM/RPD/TPD`, `AI_ROUTING` | theo `README.md` §3 và `.env.example:1-59,147-159` | thiếu key → provider bị bỏ qua, có cảnh báo lúc khởi động (`config.ts:170`); không có provider nào → chạy offline hoàn toàn (vẫn sống) |
| `HISTORY_ENABLED`, `HISTORY_DIR`, `HISTORY_KEEP_DAYS`, `HISTORY_GZIP_AFTER_DAYS` | `true`, `data/history`, 180, 7 | archive JSONL; dung lượng xem §10 mục "đĩa" |
| `NEWS_ENABLED` | `true` | VPS phải ra được Internet tới feed; không ra được thì chỉ cảnh báo 1 lần/giờ/feed, không chết |
| `TIME_MODE` | `compressed` (mặc định) hoặc `realtime` | `realtime` = theo giờ VN, nghỉ T7/CN, không tua nhanh (README §10) |
| `DAILY_BUDGET_USD`, `MIN_SECONDS_BETWEEN_LLM`, `LLM_ONLY_WHEN_WATCHED` | 1 / 20 / `true` | provider miễn phí có giá 0 nên không chạm ngân sách; `LLM_ONLY_WHEN_WATCHED=true` tiết kiệm quota khi không ai xem |
| `COMPANY_NAME` | `Cty TNHH VibeCorp` | hiện trên giao diện |
| `SITE_URL` | **tuỳ chọn** — để trống vẫn đúng | gốc URL cho thẻ chia sẻ (Open Graph, canonical) trong `index.html`. Trống → server suy từ `Host` + https (nhận `X-Forwarded-Proto` của nginx **hoặc** `CF-Visitor` của Cloudflare, nên đúng cả khi Cloudflare ở chế độ Flexible). Đặt cứng (vd địa chỉ site thật) nếu muốn chắc chắn tuyệt đối — §7.6 |

Không đưa `DEBUG_PROMPTS=1` lên production (in prompt + phản hồi AI ra log; `src/ai/llm.ts:279`).

---

## 3. `deploy/deploy.sh` từng bước

Chạy từ bất kỳ thư mục nào: script tự `cd "$(dirname "$0")/.."` về gốc dự án (`:11`). `set -euo pipefail` (`:10`): lệnh nào trả mã ≠ 0 là **dừng ngay**, trừ chỗ có `|| echo` / `|| true`.

### 3.1 Bảng bước

| # | Dòng | Chỉ khi `--setup` | Việc | Khi lỗi |
|---|---|---|---|---|
| 1 | `:13-15` | | kiểm tra `deploy/vps.env`, `source` nó, `export SSHPASS="$VPS_PASS"` | thiếu file → `exit 1` |
| 2 | `:16-20` | | dựng `SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -p $VPS_PORT $VPS_USER@$VPS_HOST"`, `APP_DIR=/opt/vibecorp`, `APP_PORT=${APP_PORT:-3200}`, `APP_USER=deploy`, `SETUP` | |
| 3 | `:22-23` | | SSH in `hostname · PRETTY_NAME · node -v` để chắc kết nối được | SSH hỏng → dừng |
| 4 | `:25-28` | ✓ | `mkdir -p /opt/vibecorp/data && chown -R deploy:deploy /opt/vibecorp` | |
| 5 | `:30-36` | | `sshpass -e rsync -az --delete` mã nguồn `./` → `/opt/vibecorp/` với danh sách exclude (§3.2) | rsync lỗi → dừng |
| 6 | `:38-40` | | kiểm tra `deploy/.env.production` rồi `sshpass -e scp -P "$VPS_PORT"` thành `/opt/vibecorp/.env` | thiếu → in gợi ý (`PORT=$APP_PORT, PERSIST=true, DEV_PANEL=false hoặc DEV_PANEL=true + DEV_TOKEN=<bí mật>`) và `exit 1` — **code đã rsync xong nhưng tiến trình cũ vẫn chạy code cũ trong RAM** |
| 7 | `:42-46` | | `chown -R deploy:deploy`, `chmod 600 .env`, rồi dưới user `deploy`: `cd /opt/vibecorp && npm install --include=dev --no-audit --no-fund --loglevel=error && (pm2 describe vibecorp && pm2 restart vibecorp --update-env \|\| pm2 start npm --name vibecorp -- start) && pm2 save && sleep 4 && pm2 ls \| grep vibecorp` | `npm install` lỗi hoặc `pm2 ls` không có `vibecorp` → dừng |
| 8 | `:48-52` | ✓ | ghi `deploy/nginx.limit.conf` → `/etc/nginx/conf.d/vpa-limit.conf`; `sed` thay `__DOMAIN__`/`__PORT__` trong `nginx.site.conf` → `/etc/nginx/sites-available/$DOMAIN`; `ln -sf` vào `sites-enabled`; `nginx -t`; `systemctl reload nginx` | `nginx -t` lỗi → dừng (nginx cũ vẫn chạy, không reload) |
| 9 | `:55-56` | ✓ | `certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email` | **không dừng**: in `⚠️ certbot lỗi — chưa có chứng chỉ: qua Cloudflare (SSL Full strict) tên miền này sẽ báo lỗi 526…` |
| 10 | `:57-58` | ✓ | `pm2 startup systemd -u deploy --hp /home/deploy` (để pm2 tự chạy lại sau reboot) | `\|\| true`: lỗi bị **nuốt im lặng** → sau `--setup` nên tự kiểm tra (§6) |
| 11 | `:61-63` | | trên VPS: `sleep 2; curl -s -m 5 http://127.0.0.1:$APP_PORT/api/health` (`:62`); từ máy dev: `curl -s -m 10 https://$DOMAIN/api/health` (`:63`) | **không làm script fail** — chỉ in `app chưa trả lời` / `(https chưa sẵn sàng — xem bước SSL)`; phải tự đọc output |
| 12 | `:64` | | in lệnh xem log: `ssh -p $VPS_PORT $VPS_USER@$VPS_HOST 'su - deploy -c "pm2 logs vibecorp --lines 50"'` | |

### 3.2 rsync: loại trừ gì và `--delete` nghĩa là gì

Lệnh (`:31-36`; dòng `:32` = `node_modules`/`.git`/`state.json*`, `:33` = `data/history` + ba file bí mật, `:34` = `docs/preview`/`.claude`/`*.log`/`*.tmp-*`): `sshpass -e rsync -az --delete --exclude node_modules --exclude .git --exclude data/state.json --exclude 'data/state.json.*' --exclude data/history --exclude .env --exclude deploy/vps.env --exclude deploy/.env.production --exclude docs/preview --exclude .claude --exclude '*.log' --exclude '*.tmp-*' -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=accept-new" ./ "$VPS_USER@$VPS_HOST:$APP_DIR/"`.

| Nhóm exclude | Mục | Lý do |
|---|---|---|
| Thư viện | `node_modules` | cài trên VPS bằng `npm install` (khác kiến trúc máy dev) |
| Bí mật | `.env`, `deploy/vps.env`, `deploy/.env.production` | không bao giờ lên VPS dưới tên gốc; `.env` production đi riêng bằng `scp` |
| Dữ liệu sống | `data/state.json`, `data/state.json.*`, `data/history` | của VPS, không được ghi đè bằng bản máy dev |
| Rác / nặng | `.git`, `docs/preview` (18 ảnh PNG ~9,7 MB), `.claude`, `*.log`, `*.tmp-*` | tiết kiệm băng thông, không cần để chạy |

Ý nghĩa `--delete` **không** kèm `--delete-excluded`: rsync xoá trên VPS những file **không còn ở máy dev**, nhưng **không đụng** các mục nằm trong exclude → `state.json`, `history/`, `.env`, `node_modules` được bảo toàn qua mọi lần deploy. Hệ quả ngược: file bạn xoá ở máy dev (ví dụ một ảnh trong `public/`) sẽ biến mất trên VPS — đúng ý, nhưng nhớ rằng **VPS không giữ bản cũ**. `-a` giữ mtime nên file không đổi không làm đổi `ASSET_VERSION` (§5.2). `.DS_Store` không bị exclude (vô hại: server không phục vụ dotfile — `server.ts:358`; và `computeAssetVersion()` bỏ qua mọi tên bắt đầu bằng `.` — `server.ts:135` — nên `.DS_Store` lên VPS **không** làm đổi `ASSET_VERSION`, không làm mất cache).

### 3.3 `npm install --include=dev` — vì sao bắt buộc

`npm start` = `tsx src/server.ts` (`package.json:9`) mà `tsx` nằm trong `devDependencies` (`package.json:27`). Đổi sang `--omit=dev` hay `npm ci --production` là production **không khởi động được** (`pm2 ls` sẽ thấy `errored`). Không có bước build/`dist/`; TypeScript chạy thẳng. `typescript ^7.0.2` và `@types/*` cũng được cài trên VPS dù không dùng lúc chạy — chấp nhận để đơn giản.

### 3.4 pm2 start / restart

- Lần đầu: `pm2 start npm --name vibecorp -- start` → pm2 chạy `npm start` với cwd = `/opt/vibecorp`, ghi nhớ cwd/env đó.
- Các lần sau: `pm2 describe vibecorp` thấy → `pm2 restart vibecorp --update-env` (khởi động lại **cùng** cwd; `--update-env` để pm2 nhận env mới của shell — `.env` thì `dotenv` tự đọc lại khi tiến trình mới lên).
- `pm2 save` ghi danh sách tiến trình để `pm2 resurrect` (qua unit systemd tạo ở bước 10) khôi phục sau reboot.
- `sleep 4 && pm2 ls | grep vibecorp`: nếu app chết trong 4 s đầu (ví dụ `EADDRINUSE`), pm2 vẫn có thể liệt kê `vibecorp` (trạng thái `errored`/đang restart) → **bước này không đủ để kết luận app sống**; bước 11 (`/api/health`) mới là kiểm tra thật.
- Không có `ecosystem.config.*`, không giới hạn bộ nhớ (`max_memory_restart`) — pm2 dùng mặc định (đã tìm trong repo: không có file pm2/systemd/Docker nào).

### 3.5 `--setup`: nginx + vùng giới hạn + certbot + pm2 startup

1. `nginx.limit.conf` → `/etc/nginx/conf.d/vpa-limit.conf`: chỉ thị `limit_req_zone` **phải nằm trong `http{}`**, mà file site chỉ có `server{}`, nên tách riêng (`nginx.limit.conf:1-2`). Tên file có tiền tố `vpa-` để không trùng app khác.
2. `nginx.site.conf` → `/etc/nginx/sites-available/$DOMAIN` sau khi `sed s/__DOMAIN__/…/; s/__PORT__/…/`; symlink `sites-enabled/$DOMAIN`; `nginx -t` rồi `systemctl reload nginx`.
3. `certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email`: certbot sửa chính file site: chuyển cấu hình sang khối `listen 443 ssl` kèm đường dẫn chứng chỉ (dòng 1 của `nginx.site.conf` ghi rõ "certbot sẽ tự thêm phần SSL (443) vào file này") và thêm một khối cổng 80 trả 301 sang https (thấy trên VPS 2026-11-03). **Khối 443 với chứng chỉ hợp lệ là bắt buộc**: Cloudflare chạy SSL Full (strict) nên request https vào origin cổng 443 và bị kiểm chứng chỉ (§5.1); khối 80 → https vô hại. (Chú thích cũ "cố ý không `--redirect` vì Cloudflare Flexible" là sai.) `--register-unsafely-without-email` ⇒ Let's Encrypt **không gửi mail nhắc hết hạn**; trông vào timer tự gia hạn của certbot (§6).
4. `pm2 startup systemd -u deploy --hp /home/deploy` tạo unit systemd chạy `pm2 resurrect` lúc boot cho user `deploy`; `|| true` nên lỗi không hiện.

### 3.6 Kiểm tra cuối và mã thoát

Script kết thúc với `✅ Xong.` **kể cả khi** health thất bại (bước 11 có `|| echo`). Trong VPS script chỉ chờ `sleep 2` rồi `curl -m 5` (`:62`); app khởi động chậm hơn thế sẽ in `app chưa trả lời` dù vài giây sau lên bình thường — chạy lại `curl` tay (§6) trước khi kết luận. Đọc 2 dòng JSON trước `✅`: dòng 1 từ trong VPS (`{"ok":true,"mode":"llm"|"offline","viewers":N,"day":D,"minute":M}`), dòng 2 từ máy dev qua Cloudflare. `mode: "offline"` **không phải lỗi** — chỉ là lúc đó không provider AI nào sẵn sàng (§9).

### 3.7 Bẫy

| Bẫy | Hậu quả | Phòng |
|---|---|---|
| `PORT` trong `.env.production` ≠ `APP_PORT` | nginx 502 | kiểm tra trước khi deploy (§11); đổi cổng thì đổi cả hai + `--setup` |
| Sửa `.env` tay trên VPS | mất ở lần deploy sau | luôn sửa `deploy/.env.production` |
| Chạy lại `--setup` | ghi đè `/etc/nginx/sites-available/$DOMAIN` (mất phần 443 certbot đã thêm) rồi `certbot --nginx` thêm lại; certbot có thể lỗi (giới hạn cấp lại của Let's Encrypt) → origin tạm mất khối 443; Cloudflare chạy Full (strict) nên lúc đó tên miền báo lỗi 526 | chỉ `--setup` khi dựng VPS mới hoặc cố ý đổi nginx; sau đó kiểm `curl -I https://<DOMAIN>/api/health` |
| Bước 6 fail sau khi rsync | code mới trên đĩa, tiến trình cũ trong RAM → trạng thái "nửa deploy" | tạo `.env.production` rồi chạy lại script (idempotent) |
| `npm install` trên 1 vCPU | có thể chậm vài phút khi `package-lock.json` đổi; trong lúc đó app cũ vẫn chạy (chỉ dừng lúc `pm2 restart`) | deploy giờ ít người xem |
| Health `|| echo` | script xanh dù app chết | đọc output, hoặc chạy tay `curl` (§6) |
| `sshpass` + mật khẩu | mật khẩu nằm trong biến môi trường của tiến trình `ssh` trên máy dev | cân nhắc chuyển sang khoá SSH (Câu hỏi còn mở) |
| Script không chạy test | đẩy code đỏ lên site thật | §11 |

---

## 4. nginx — giải thích từng chỉ thị

### 4.1 `deploy/nginx.limit.conf`

```nginx
limit_req_zone $binary_remote_addr zone=vpa_api:10m rate=2r/s;
```

Khai báo vùng `vpa_api` 10 MB (≈ 160 nghìn IP theo chú thích `:2`) khoá theo **IP nguồn của kết nối tới nginx**, tốc độ 2 yêu cầu/giây. Chỉ khai báo; áp ở `location /api/` (§4.2). Phải nằm trong `http{}` → `/etc/nginx/conf.d/vpa-limit.conf`.

### 4.2 `deploy/nginx.site.conf`

| Dòng | Chỉ thị | Vì sao |
|---|---|---|
| `:2-5` | `server { listen 80; listen [::]:80; server_name __DOMAIN__; }` | chỉ cấu hình HTTP; certbot thêm 443 (§3.5). `__DOMAIN__` được `sed` lúc `--setup` |
| `:8` | `location /.well-known/acme-challenge/ { root /var/www/html; }` | certbot xác minh tên miền qua HTTP-01 mà không đi qua app |
| `:12` | `location = /ws { … }` | khớp **đúng** đường dẫn WebSocket của app (`server.ts:449`: `path: '/ws'`) |
| `:13` | `access_log off;` (trong `/ws`) | URL WebSocket mang `?dev=<DEV_TOKEN>` (`net.js:79`) → không để token lọt vào access log (chú thích `:10-11`) |
| `:14` | `proxy_pass http://127.0.0.1:__PORT__;` | app chỉ nghe loopback; `__PORT__` = `APP_PORT` |
| `:15-17` | `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` | ba điều kiện bắt buộc để nginx chuyển tiếp nâng cấp WebSocket |
| `:18-21` | `Host $host`, `X-Real-IP $remote_addr`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Proto $scheme` | app chỉ dùng **`X-Forwarded-Proto`** (`server.ts:103`) để quyết định cờ `Secure` của cookie admin; các header còn lại để log/tương lai. Chú ý `$scheme` là scheme **giữa Cloudflare và nginx**, không phải giữa người xem và Cloudflare (§5.1) |
| `:22-23` | `proxy_read_timeout 3600s; proxy_send_timeout 3600s;` | mặc định nginx 60 s sẽ cắt socket im lặng; WebSocket sống hàng giờ. App còn ping WS mỗi 30 s (`server.ts:486-495`) và client gửi `{t:'ping'}` 25 s (`net.js:99`) nên thực tế không bao giờ im quá 60 s — 3600 s là lớp dự phòng |
| `:24` | `proxy_buffering off;` | gói `frame` 200 ms phải đi ngay, không gom |
| `:29` | `location /api/ { … }` | mọi API JSON: `/api/health`, `/api/stats`, `/api/news`, `/api/history`, **và `/api/dev/login|logout`** |
| `:30-31` | `limit_req zone=vpa_api burst=5 nodelay; limit_req_status 429;` | `/api/history` có thể trả tới 5 000 dòng (≈ 1,4 MB với ngày đã nén — chú thích `:27`) và phải giải nén gzip trên 1 vCPU dùng chung → mỗi IP 2 r/s, dồn tối đa 5, quá thì 429 ngay (`nodelay`). App còn có trần riêng `HISTORY_MAX_INFLIGHT = 3` (`server.ts:271`) trả 429 + `Retry-After: 3` — hai 429 khác nguồn |
| `:32-37` | `proxy_pass` + header như trên, **không** có `Upgrade`, timeout mặc định 60 s | API thường, không WebSocket |
| `:40` | `location / { … }` | trang, file tĩnh, `/go/:id`, `/v/<ver>/…` |
| `:42` | `if ($arg_dev) { access_log off; }` | cách mở trang cũ `?dev=<token>` cũng không bị ghi log (dạng `#dev=` thì trình duyệt không gửi lên nên không cần) |
| `:43-54` | proxy đầy đủ header WebSocket + timeout 3600 s + `proxy_buffering off` | phòng khi có WS ở đường dẫn khác; với file tĩnh thì vô hại. `index.html` và `/v/…` được app tự đặt `Cache-Control` (no-cache / immutable) nên nginx không cần `expires` |

Không có `client_max_body_size` riêng: body duy nhất app nhận là `POST /api/dev/login` ≤ 2048 byte (`server.ts:110`), mặc định 1 MB của nginx là đủ.

### 4.3 `limit_req` đứng sau Cloudflare — bẫy cần biết

`$binary_remote_addr` là IP **của Cloudflare edge** (nginx không cấu hình `set_real_ip_from`/`real_ip_header CF-Connecting-IP` — không có trong `deploy/`). Nhiều người xem đi qua cùng một IP edge sẽ **chia nhau** 2 r/s + burst 5 cho mọi `/api/*`. Triệu chứng: tab Lịch sử trả 429 khi lật trang (client gọi `GET /api/history?date=…` với timeout 15 s, `public/js/ui/history.js:12-14`), `POST /api/dev/login` thất bại lẻ tẻ lúc mở trang, `/api/news` 429 khi debug. Dấu hiệu trong error log nginx: dòng `limiting requests`. Hướng sửa (chưa làm, xem Câu hỏi còn mở): bật `ngx_http_realip_module` với dải IP Cloudflare + `real_ip_header CF-Connecting-IP`, hoặc nới `rate`/`burst`, hoặc chỉ giới hạn `location /api/history`.

---

## 5. Cloudflare

### 5.1 Proxy và chế độ SSL

- Tên miền được proxy qua Cloudflare (đám mây cam) — `ui-polish-todo.md:96,101`. Mọi kết nối người xem → Cloudflare là HTTPS/WSS do Cloudflare cấp; Cloudflare → origin (nginx) theo **SSL mode**:
  - **Đang dùng: Full (strict)** — chủ dự án chuyển trên dashboard 2026-11-03 (trước đó là Full; xác nhận nhờ phiên dựng VibeCinema thấy request https vào thẳng cổng 443 của VPS). Cloudflare dùng cùng giao thức với người xem: request https → origin cổng **443**, và ở chế độ strict Cloudflare **kiểm chứng chỉ origin** (đúng tên miền, còn hạn, CA tin được — Let's Encrypt đạt). Sau khi chuyển: `corp` và `cinema` vẫn trả 200. Hệ quả: nginx `$scheme` = `https` → `X-Forwarded-Proto: https` → cookie admin **có** cờ `Secure` (`server.ts:103-104`); chứng chỉ thiếu / sai tên / hết hạn → người xem thấy **lỗi 526** của Cloudflare.
  - **Bẫy khi thêm site mới trên VPS này:** thiếu khối 443 hoặc chưa có chứng chỉ cho tên miền đó → lỗi 526 (ở chế độ Full thường thì còn tệ hơn: rơi vào khối 443 của `tokivietnam.com`, hiện site của app khác). Cấp chứng chỉ (certbot) trước khi chia sẻ link. Nếu certbot báo lỗi xác minh do Cloudflare chuyển request sang https: tạm tắt proxy (đám mây xám) cho tên miền đó rồi chạy lại, hoặc dùng Cloudflare Origin Certificate.
  - Lịch sử: chú thích cũ của `deploy.sh` ghi "Flexible, không `--redirect`" — sai, đã sửa 2026-11-03.
  - Full (strict) đổi lại một rủi ro: chứng chỉ hết hạn là site sập 526 ngay → phải giữ certbot tự gia hạn chạy (hiện timer chạy 2 lần/ngày, §6).
- Ép HTTPS cho người xem: "Always Use HTTPS" trên Cloudflare; khối cổng 80 → https ở origin cũng vô hại (request http lọt tới cổng 80 được chuyển sang https, request https đi thẳng 443).
- Cloudflare che IP thật của người xem khỏi nginx (§4.3) và cũng che IP origin khỏi người xem.

### 5.2 Cache 4 giờ cho `.js/.css` → phiên bản tài nguyên tĩnh `/v/<ASSET_VERSION>/…`

Vấn đề đo ngày 2026-11-02: Cloudflare ép `max-age` 4 giờ cho `.js/.css` → sau deploy người xem chạy JS cũ hàng giờ trong khi `index.html`/hợp đồng dữ liệu đã mới (chú thích `server.ts:123-128`). Cách app né (chi tiết [02 §7](./02-kien-truc-va-giao-thuc.md)):

1. Lúc khởi động `computeAssetVersion()` băm SHA-1 chuỗi `"<đường dẫn>|<size>|<mtime>"` của mọi file trong `public/` → 12 hex = `ASSET_VERSION` (`server.ts:129-146`). File/thư mục có tên bắt đầu bằng `.` bị bỏ qua (`:135`) → `.DS_Store` mà rsync đưa lên VPS **không** làm đổi phiên bản, không làm mất cache. Tiền tố chỉ được nhận khi khớp `ASSET_PREFIX_RE = /^\/v\/([A-Za-z0-9]{4,40})(\/.*)$/` (`:147`): 4–40 ký tự chữ-số, nên `/v/dev/…` (giá trị `'dev'` khi không có `public/`) không khớp.
2. `index.html` luôn `Cache-Control: no-cache` và được viết lại: `href="style.css"` → `/v/<ver>/style.css`, `src="js/main.js"` → `/v/<ver>/js/main.js` (`server.ts:150-162`; `public/index.html:13-14`). Mọi `import` tương đối trong `js/` tự đi theo tiền tố đó.
3. `/v/<ver>/<path>` được phục vụ với `public, max-age=31536000, immutable` **chỉ khi** `<ver> === ASSET_VERSION`; phiên bản cũ vẫn trả file nhưng `no-cache` (`server.ts:438-439, 369`).

Hệ quả vận hành:

- **Đổi bất kỳ file trong `public/` ⇒ phải khởi động lại tiến trình** để `ASSET_VERSION` đổi; `deploy.sh` luôn `pm2 restart` nên deploy bình thường là đủ. Sửa tay trên VPS mà không restart → Cloudflare/trình duyệt giữ bản cũ "mãi mãi" dưới cùng URL.
- `rsync -a` giữ mtime → chỉ file thật sự đổi mới đổi phiên bản; file không đổi vẫn được cache tiếp (tốt).
- Kiểm tra sau deploy: `curl -s https://corp.vibe-coder.fun/ | grep -o '/v/[a-f0-9]*/' | head -1` phải ra phiên bản mới (khác lần trước); `curl -sI https://corp.vibe-coder.fun/v/<ver>/js/main.js | grep -i cache-control` phải thấy `immutable`.
- Người xem đang mở tab cũ vẫn chạy JS cũ tới khi tải lại trang (index.html no-cache → tải lại là nhận bản mới). Nếu đổi **hợp đồng dữ liệu** (`src/types.ts`) theo cách không tương thích, hãy chấp nhận tab cũ lỗi tới khi F5, hoặc giữ tương thích lùi phía client.
- "Purge Everything" trên Cloudflare chỉ cần khi nghi Cloudflare cache **nhầm** `index.html` (app đã đặt no-cache nên bình thường không cần).

### 5.3 Gói WebSocket đến so le → bộ đệm phía client

Hiện tượng (2026-11-02): trên site thật nhân vật đi–khựng–đi; server CPU ~0 %, trình duyệt 60 fps; nguyên nhân là gói `frame` (server gửi mỗi 200 ms) đi qua Cloudflare tới trình duyệt cách nhau 100 / 300 ms. Cách sửa (chi tiết [02 §10](./02-kien-truc-va-giao-thuc.md)):

- Server đóng dấu `ts: Date.now()` lên mỗi `frame` (`src/sim/world.ts:2767`, kiểu `types.ts:479`).
- Client (`public/js/store.js:140-202`) quy `ts` về trục `performance.now()` (neo ở frame đầu, nên không phụ thuộc lệch đồng hồ), giữ `KF_MAX = 10` khung hình/actor, và vẽ **trễ** `store.net.buffer` ms: khởi đầu `NET_BUFFER_START = 340`, sàn `NET_BUFFER_MIN = 260`, trần `NET_BUFFER_MAX = 700`. Frame tới mà "slack" < `NET_SLACK_MIN = 60` ms → nới bộ đệm ngay; cứ 40 frame đều tới sớm → siết dần về sàn.
- Debug trên site thật: mở DevTools console, `window.__vpa.store.net` (móc đo chỉ đọc, `public/js/main.js:3-4`) cho `{ buffer, lateFrames, frames, tsBase, localBase, minSlack, window }`. `lateFrames/frames` cao và `buffer` kẹt ở 700 → đường mạng/Cloudflare rất xấu; `buffer` ≈ 260–340 là bình thường. Tab Network → WS → xem khoảng cách giữa các khung `frame`.
- Server **không** cần làm gì thêm; không cần giảm nhịp frame. Nếu một ngày cần đổi `FRAME_MS`, phải cân lại các hằng `NET_*` (bảng "Khi sửa" của 02).

### 5.4 Giữ kết nối WebSocket

- Server `ping` khung WS mỗi `HEARTBEAT_MS = 30 s`, socket không `pong` từ lần trước bị `terminate()` (`server.ts:486-495`) → số người xem (`viewers`) luôn đúng.
- Client gửi JSON `{t:'ping'}` mỗi 25 s (`net.js:99`) — độc lập với ping khung của server; mục đích giữ đường qua proxy có timeout idle.
- Mất mạng / máy ngủ: `visibilitychange` và `online` → nối lại ngay (`net.js:135-143`).
- Socket nghẽn (`bufferedAmount > 1 MB`) bị bỏ qua khi broadcast (`server.ts:208`; `MAX_BUFFERED = 1024 * 1024`, `:24`) — người xem đường rất chậm có thể mất vài `log`/`scene`; chấp nhận.

---

## 6. Lệnh vận hành thường dùng

Mọi lệnh dưới đây chạy **sau khi SSH vào VPS** (`ssh -p <VPS_PORT> <VPS_USER>@<VPS_HOST>` — giá trị trong `deploy/vps.env`). Lệnh pm2 phải chạy dưới user `deploy`: `su - deploy -c '<lệnh>'` hoặc `su - deploy` rồi gõ.

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Trạng thái tiến trình | `su - deploy -c 'pm2 ls'` · `pm2 describe vibecorp` | cột `status` phải `online`; `↺` (restarts) tăng liên tục = app crash-loop |
| Xem log | `su - deploy -c 'pm2 logs vibecorp --lines 50'` (lệnh `deploy.sh:64` in sẵn) · `pm2 logs vibecorp --err` | log app = `console.log/warn/error` của `server.ts`; file log theo mặc định pm2 ở `/home/deploy/.pm2/logs/vibecorp-out.log` và `vibecorp-error.log` (cần kiểm tra đường dẫn thật nếu pm2 cấu hình khác) |
| Dòng đáng xem trong log | `[world]` (khôi phục/kết thúc ngày), `[ai]` (provider, nghỉ vì sao), `[ws]` (lệnh dev bị bỏ qua — kể cả `POST /api/dev/login` sai mã, §10), `⚠️` (provider/feed bị bỏ qua lúc khởi động — in 2 dạng, §10), `[http]`, `[server] Lỗi không bắt được`, `🗄️ Lưu trữ: nén…` | `grep -i 'lỗi\|⚠️' ~/.pm2/logs/vibecorp-error.log \| tail` |
| Khởi động lại / dừng / chạy | `pm2 restart vibecorp --update-env` · `pm2 stop vibecorp` · `pm2 start vibecorp` | restart = tắt êm (lưu state, flush archive) rồi lên lại; người xem tự nối lại |
| Health trong VPS | `curl -s http://127.0.0.1:3200/api/health` | `{ ok, mode, viewers, day, minute }` (`server.ts:411-416`); `mode: offline` chỉ nói AI đang không gọi được |
| Health qua Cloudflare | `curl -s https://corp.vibe-coder.fun/api/health` | lệch với trong VPS → lỗi ở nginx/Cloudflare, không phải app |
| Thống kê admin | `curl -s -c jar -X POST -H 'content-type: application/json' -d '{"token":"<DEV_TOKEN>"}' https://corp.vibe-coder.fun/api/dev/login && curl -s -b jar https://corp.vibe-coder.fun/api/stats \| jq .ai` | dùng **cookie** thay cho `?dev=` trên URL: `location /api/` **không** tắt access log, nên `GET /api/stats?dev=<token>` (cách README §3.6 gợi ý) sẽ để token trong access log nginx — xem Câu hỏi còn mở. Không có quyền → 404 |
| Kho tin | `curl -s https://corp.vibe-coder.fun/api/news \| jq '{counts,total,lastError,lastOkAt}'` | công khai (xem [06 §11](./06-tin-tuc-thoi-su.md)) |
| Archive | `curl -s https://corp.vibe-coder.fun/api/history \| jq '.days[0:3], .stats'` · `ls -la /opt/vibecorp/data/history/` · `du -sh /opt/vibecorp/data/history` | ngày theo giờ VN (`archive.ts:43-46`); `.gz` sau 7 ngày; `index.json` xuất hiện khi đã có ngày nén |
| Trạng thái sống | `ls -la /opt/vibecorp/data/` · `jq '.savedAt, .world.day' /opt/vibecorp/data/state.json` | **không** chép nội dung file này vào tài liệu/chat (có thể chứa lastError đã che key, số liệu click) |
| nginx | `nginx -t` · `systemctl reload nginx` · `systemctl status nginx` · `tail -f /var/log/nginx/error.log` | đường dẫn log theo cấu hình mặc định của nginx trên VPS (cần kiểm tra `nginx.conf`); access log **không** có `/ws` và request `?dev=` |
| Chứng chỉ | `certbot certificates` · `certbot renew --dry-run` · `systemctl list-timers \| grep certbot` | không có mail nhắc (§3.5); hạn ghi chú 2027-01-30 |
| pm2 sau reboot | `systemctl status pm2-deploy` (tên unit do `pm2 startup` tạo — cần kiểm tra) · `su - deploy -c 'pm2 resurrect'` | vì bước 10 của `--setup` nuốt lỗi |
| Cổng | `ss -ltnp \| grep 3200` | ai đang nghe 3200; app khác chiếm → `EADDRINUSE` trong log |
| Tài nguyên | `top` / `htop`, `free -m`, `df -h`, `pm2 monit` | VPS 1 vCPU/2 GB dùng chung; app bình thường CPU ~0 % |
| Phiên bản tài nguyên đang chạy | `curl -s https://corp.vibe-coder.fun/ \| grep -o '/v/[a-f0-9]*/' \| head -1` | đổi sau mỗi deploy có sửa `public/` |

---

## 7. Cập nhật & rollback

### 7.1 Quy trình cập nhật thường

1. Trên máy dev: sửa code → `npm test` (6 bước, `package.json:14`; thời gian theo `README.md:511-512` ~6 s smoke + ~30 s smoke:story + test-llm/test-router có vài chỗ chờ thật 1,5–4 s — chưa đo lại tổng) → cập nhật tài liệu theo bảng "Khi sửa code vùng này" của vùng liên quan → commit (`git` cục bộ).
2. `bash deploy/deploy.sh` → đọc kỹ 2 dòng health + `✅`.
3. Mở site; mở `#dev=…` nếu cần xem chip 🤖; `pm2 logs vibecorp --lines 50` không có lỗi đỏ mới; console trình duyệt không lỗi.
4. Ghi mốc vào lịch sử ở [01-tong-quan.md](./01-tong-quan.md) §8 nếu là thay đổi đáng nhớ.

### 7.6 Ảnh xem trước khi chia sẻ link (Open Graph) — 2026-11-03

- Trang có đủ thẻ Open Graph / Twitter / canonical / JSON-LD ([08](./08-frontend-giao-dien.md) §2); ảnh `public/og-image.jpg` (1200×630) + `icon-192/512.png`, `apple-touch-icon.png`, `site.webmanifest`, `robots.txt` đi theo rsync như mọi file `public/`.
- **Tạo lại ảnh** (khi giao diện đổi nhiều): chạy server offline trên máy dev (`PORT=3333 PERSIST=false AI_PROVIDERS=none NEWS_ENABLED=false npm start`) rồi `npm run share-images -- --url http://localhost:3333/ --label <tên miền in trên ảnh>` — cần Chrome/Chromium (`CHROME_PATH` nếu không ở chỗ thường gặp). Script tự tua x10 tới giờ làm khi văn phòng còn vắng, phóng nhẹ, chờ có bong bóng thoại rồi chụp ([11](./11-kiem-thu-qa.md)). Không chạy trên VPS (không cần, và VPS không có Chrome).
- **Sau deploy**: dán `https://<tên miền>/` vào Facebook Sharing Debugger (developers.facebook.com/tools/debug) → "Scrape Again" để Facebook lấy thẻ mới; Zalo tự lấy lại sau một thời gian. `og:image` mang `?v=<băm 10 ký tự của ảnh>` (`OG_VERSION`, tính lúc server khởi động) nên đổi ảnh = đổi URL, mạng xã hội không giữ ảnh cũ.
- Kiểm nhanh không cần Facebook: `curl -s https://<tên miền>/ | grep -E 'og:(url|image)"'` phải ra URL `https://<tên miền>/…` (không phải `http://`, không phải `localhost`) và `curl -sI https://<tên miền>/og-image.jpg` trả `200 image/jpeg`.

### 7.2 Rollback

VPS không có git và không giữ bản cũ (rsync `--delete`). Rollback = **deploy lại bản cũ từ máy dev**:

```bash
git stash            # hoặc commit dở
git checkout <commit-cũ>     # ví dụ 0e9e925
bash deploy/deploy.sh
git checkout -        # quay lại nhánh làm việc
```

Trạng thái trên đĩa khi rollback:

- `data/state.json` được ghi bởi code mới. Code cũ đọc lại với `STATE_VERSION = 1` (`persist.ts:5`): nếu cùng version, các trường lạ bị validator `revive*` bỏ qua (restore phòng thủ, xem [03 §16](./03-mo-phong-the-gioi.md)); nếu code mới đã **tăng** `STATE_VERSION`, code cũ thấy sai version → `quarantineFile` đổi tên thành `state.json.bad-<ISO>` và **mở văn phòng mới** (`world.ts:1036-1038, 1072-1077`). Không mất file, nhưng câu chuyện bắt đầu lại.
- `data/history/*.jsonl` chỉ nối thêm, không bị ảnh hưởng.
- Nếu rollback vì `.env` sai: sửa `deploy/.env.production` rồi deploy lại (không cần đổi code).

### 7.3 Đổi `.env` production (key AI, `DEV_TOKEN`, nhịp…)

Sửa `deploy/.env.production` → `bash deploy/deploy.sh` (rsync không đổi gì nhưng `scp` + `pm2 restart` áp `.env` mới). Không có cách "reload env nóng": `CONFIG` đọc một lần lúc khởi động (`config.ts:1-2`).

### 7.4 Làm lại văn phòng từ đầu / cứu `state.json`

- Làm lại: `su - deploy -c 'pm2 stop vibecorp'` → `mv /opt/vibecorp/data/state.json /opt/vibecorp/data/state.json.bak-$(date +%F)` → `pm2 start vibecorp`. (`README.md:491-493`.) **Lưu ý**: snapshot `brain` nằm trong cùng file → bộ đếm quota hôm nay (`rpdUsed`, `tpdUsed`, cooldown) **và** tổng cộng dồn (`calls`, token, `costTotalUsd` — §9.1) cũng về 0 → app có thể gọi vượt `AI_*_RPD` thật trong ngày đó.
- File hỏng: app tự cách ly thành `state.json.bad-<stamp>` và chạy tiếp; xem log `[world] ⚠️ Không khôi phục được trạng thái (…) — bắt đầu văn phòng mới. File cũ được giữ lại tại: …` (`world.ts:1074-1075`). Thứ tự khôi phục: **brain trước** (giữ chi phí/quota trong ngày dù world hỏng), rồi world, rồi director (`world.ts:1041-1067`).

### 7.5 Sao lưu

Chưa có gì tự động. Thứ cần giữ chỉ là `/opt/vibecorp/data/` (state.json vài trăm KB có trần; history ≈ 0,85 MB/ngày thật đo ngày 2026-11-01 với chế độ nén, gzip sau 7 ngày). Gợi ý: định kỳ kéo về máy dev `rsync -az -e "ssh -p <VPS_PORT>" <VPS_USER>@<VPS_HOST>:/opt/vibecorp/data/ ./backup/data/` (không commit vào git — `data/history/` và `state.json` đã gitignored).

---

## 8. `DEV_TOKEN` & admin

### 8.1 Luồng vào admin

```
Chủ dự án mở  https://corp.vibe-coder.fun/#dev=<DEV_TOKEN>   (một lần, trên trình duyệt đó)
   │  net.js devToken() (:51-74): đọc ?dev= (ưu tiên) hoặc #dev= → cất localStorage['vpa.dev'] → xoá khỏi thanh địa chỉ (history.replaceState)
   ├─► POST /api/dev/login {token}  (syncCookie, :32-37; mỗi lần tải trang 1 lần)
   │        server.ts:100-121: đúng → 204 + Set-Cookie vpa_dev=<token>; Path=/; HttpOnly; SameSite=Lax[; Secure]; Max-Age=31536000
   │                            sai → 403 "Sai mã" (+ cảnh báo log ≤ 1 lần/phút) · DEV_TOKEN trống → 204 không cookie · DEV_PANEL=false → 404
   └─► WebSocket  wss://…/ws?dev=<token>  (wsUrl, :76-80)
            server.ts:453-463: isDev = devAllowed(req) (query trước, cookie chỉ khi query rỗng) → hello.dev = true, status đầy đủ
Các lần sau: mở corp.vibe-coder.fun bình thường → localStorage còn token → ?dev= vẫn được gắn; nếu localStorage bị xoá → cookie vẫn còn → vẫn admin.
```

- `#dev=` tốt hơn `?dev=` vì fragment **không bao giờ gửi lên máy chủ hay Cloudflare** (chú thích `nginx.site.conf:11`, `README.md:449-450`). Dạng `?dev=` vẫn chạy và không bị nginx ghi log (`$arg_dev`), nhưng Cloudflare có thể ghi.
- Token tối đa 200 ký tự, so bằng SHA-256 + `timingSafeEqual` (`server.ts:58-62`); tạo bằng `openssl rand -hex 16` (`.env.example:142`).
- Quyền dev quyết định **lúc nối socket**; đổi token xong người đang mở vẫn là admin tới khi socket đó đóng.

### 8.2 Admin thấy gì thêm (và người thường bị che gì)

| Nơi | Người xem thường | Admin |
|---|---|---|
| `hello.status.ai`, tin `status` mỗi 2 s | `publicStatus()` (`server.ts:184-193`): chỉ còn `ai.mode`, mọi số = 0, `model = ''`, **không** có `activeProvider/providers/lastError`, `clicks = 0` | bản đầy đủ `UsageStats` + `providers[]` |
| HUD | một chấm cạnh "TRỰC TIẾP": xanh = `ai.mode === 'llm'`, xám = offline (`hud.js:209-218`) | thêm chip **🤖** (§9), số lượt bấm link trong popover 👀 (`hud.js:270`) |
| Tab Bản tin | không nhãn nguồn | nhãn "🤖 AI chấp bút" / "🧪 Bản tin mẫu" (`recaps.js:44`) |
| Bảng dev (`#devbar`) | ẩn | tua x1/x2/x5/x10, 13 sự kiện (`DEV_EVENTS`, `server.ts:48-51`), nút **🚪** (`devbar.js:40-43`); giới hạn 10 lệnh / 5 s mỗi socket (`server.ts:27`) |
| `GET /api/stats` | **404** | JSON `clicks*` + `ai` (`server.ts:417-433`) |
| Lệnh dev từ socket thường | bị bỏ, log `[ws] Bỏ qua lệnh dev từ client không có quyền (tổng N lần)` ≤ 1 lần/phút (`server.ts:164-172`) | thực thi qua `world.handleClient` |

Đây là nơi thực thi nguyên tắc (4) của chủ dự án; mọi số liệu hệ thống mới thêm vào `StatusInfo` phải được cân nhắc che trong `publicStatus()` ([02 §8](./02-kien-truc-va-giao-thuc.md)).

### 8.3 Thoát và đổi mã

- **Thoát trên trình duyệt này**: nút 🚪 trong bảng dev → `confirm` → `forgetDevToken()` (`net.js:40-45`): xoá `localStorage['vpa.dev']`, `POST /api/dev/logout` (xoá cookie `Max-Age=0`), `location.reload()`.
- **Đổi `DEV_TOKEN`** (nghi lộ): sửa `deploy/.env.production` → deploy. Mọi trình duyệt cũ: lần tải trang sau `POST /api/dev/login` với token cũ → 403 **và** server gọi `noteIgnoredDev()` (`server.ts:117`) → log `[ws] Bỏ qua lệnh dev từ client không có quyền (tổng N lần)` tăng dù không ai bấm gì (client tự POST token còn trong `localStorage` mỗi lần mở trang — `syncCookie`, `net.js:32-37`); socket `?dev=<cũ>` → không dev. Chủ dự án mở lại link `#dev=<mới>`. **Bẫy**: trình duyệt cũ còn `localStorage['vpa.dev']` = token cũ → `net.js` vẫn gắn `?dev=<cũ>` vào URL WS; vì `devAllowed()` **không xét cookie khi query có giá trị** (`server.ts:72-74`), nên dù cookie mới được đặt sau khi mở link mới, token trong localStorage mới là thứ quyết định — mở link `#dev=<mới>` sẽ ghi đè localStorage nên vẫn vào được.
- **Tắt hẳn cho mọi người**: `DEV_PANEL=false` → `devAllowed()` luôn false, `/api/dev/*` và `/api/stats` trả 404.

### 8.4 Bẫy đã biết

| Bẫy | Chi tiết | Tài liệu/mã |
|---|---|---|
| `#dev=` rỗng không xoá cookie | chỉ xoá localStorage (`net.js:60-62`), không gọi logout → socket vẫn dev nhờ cookie. Chỉ 🚪 mới thoát hẳn | [02 §8](./02-kien-truc-va-giao-thuc.md) |
| Link `?dev=<sai>` ghi đè token đúng | `devToken()` ghi mọi giá trị đọc được vào localStorage; query sai → `devAllowed` không xét cookie → mất quyền tới khi mở lại link đúng | `server.ts:72-74`, `net.js:56-60` |
| `GET /api/stats?dev=<token>` để token trong access log nginx | `location /api/` không có `access_log off`; chỉ `/ws` và `location /` có | §6 (dùng cookie thay thế) |
| ~~Cloudflare Flexible → cookie không `Secure`~~ | không xảy ra: Cloudflare chạy Full → `X-Forwarded-Proto: https`, cookie có `Secure` (§5.1, kiểm 2026-11-03) | `server.ts:103-104` |
| `DEV_TOKEN` trống trên production | ai cũng là admin (hành vi v1/v2) — log khởi động nhắc | `server.ts:567` |

---

## 9. Theo dõi quota AI qua chip 🤖

### 9.1 Chip trên HUD (chỉ admin — `hud.js:183-206`)

| Hiển thị | Điều kiện | Lớp CSS / màu (`public/style.css:187-191`) | Ý nghĩa vận hành |
|---|---|---|---|
| `🤖 <Nguồn> · N lượt` | `ai.mode === 'llm'`; `<Nguồn>` = `activeProvider` (hoặc đoán từ tên model: Gemini/OpenAI/Claude/Groq — `labels.js:173-183`) | mặc định | AI đang viết thoại; N = `ai.calls` = **tổng** lượt gọi (mọi provider, kể cả lỗi) **cộng dồn từ khi có bộ đếm**, lưu/khôi phục qua `state.json` (phần `brain`, `router.ts:840`) và **không reset theo ngày** (`r.calls++` ở `router.ts:527`; `rollDay()` `:391-400` chỉ reset `rpdUsed/tpdUsed/costToday/rpmTimes`; `totals()` `:745-757` = `carry.calls` + Σ `r.calls`). Số theo ngày để so với trần là `rpdUsed/rpdLimit` trong popover (§9.2) |
| … nền vàng | `providers[0].label !== activeProvider` | `.backup` | nguồn ưu tiên (đầu `AI_PROVIDERS`) đang nghỉ (giữ nhịp / hết quota / lỗi) — nguồn dự phòng gánh. **Bình thường** với `AI_ROUTING=balanced` lúc router vừa chọn nguồn khác |
| … nền đỏ | `budgetUsd > 0 && costTodayUsd >= budgetUsd` | `.over` | chạm `DAILY_BUDGET_USD` → cảnh thường bỏ, cảnh quan trọng offline. Với provider miễn phí (giá 0) gần như không xảy ra |
| `🧪 Offline · câu thoại mẫu` | `ai.mode !== 'llm'` | `.offline` (tím) | **không provider nào gọi được lúc này**: không có key, tất cả đang nghỉ, hoặc cầu dao mở (§9.4). Văn phòng vẫn chạy bằng thoại mẫu; chip tự đổi về 🤖 khi có nguồn |

Người xem thường chỉ thấy chấm xanh/xám (`#ai-dot`), không thấy chip.

### 9.2 Popover (rê chuột / bấm chip — `hud.js:275-331`)

Dòng đầu: `🤖 AI · <Nguồn> · <model> · N lượt · $chi phí hôm nay`. Rồi **danh sách nguồn theo thứ tự ưu tiên** (tối đa 6), mỗi dòng: tên · vai (`đang dùng` / `ưu tiên · đang nghỉ` / `dự phòng`) · `model · rpdUsed/rpdLimit lượt [· tpdUsed/tpdLimit token]` · trạng thái (`sẵn sàng` / `nghỉ tới HH:MM (lý do)` / `chưa sẵn sàng` — `labels.js:193-204`). Rồi bảng: "Lượt gọi hôm nay (lỗi)" · Token vào (cache) · Token ra · Chi phí hôm nay / ngân sách · Tổng chi phí · Cảnh bỏ qua (tiết kiệm). **Bẫy nhãn**: hàng "Lượt gọi hôm nay" (`hud.js:319`) hiển thị `ai.calls`/`ai.failures` là **tổng cộng dồn** (§9.1), không phải số trong ngày; "Token vào/ra" (`inputTokens/outputTokens`) cũng cộng dồn vì không nằm trong `rollDay()`; chỉ "Chi phí hôm nay" (`costTodayUsd`) và `rpdUsed/tpdUsed` của từng nguồn là theo ngày. Đừng dùng `calls` để so với `AI_<TÊN>_RPD` — xem Câu hỏi còn mở 17. Cuối: cảnh báo chạm trần ngân sách (nếu có) và **Lỗi gần nhất** (đã che key bởi `redactSecrets`, `src/ai/llm.ts:68-76`).

Cách đọc nhanh: `rpdUsed/rpdLimit` của Gemini sát 500 trước 15:00 giờ VN → hôm nay đã cạn, chờ reset; `nghỉ tới 15:00 (hết quota ngày (429) — Gemini reset lúc 0h giờ Pacific …)` là trạng thái đúng, không phải lỗi.

### 9.3 Lý do nghỉ (`cooldownReason`) và thời gian nghỉ — nguồn `src/ai/router.ts`

| Lý do hiển thị | Khi nào | Nghỉ bao lâu | Dòng |
|---|---|---|---|
| `giữ nhịp cho đủ cả ngày (đã dùng X/Y lượt\|token), mở lại dần` | `AI_<TÊN>_PACE` (mặc định bật) và đã dùng quá mức cho phép = bung 25 % quota (tối thiểu 30 lượt / 30k token) + quota × phần ngày đã trôi | tới lúc mức cho phép vượt số đã dùng, xem lại ≥ 60 s | `:433-450`, hằng `:51-53` |
| `đủ N lượt/phút, chờ nhịp` | chạm `AI_<TÊN>_RPM` (cửa sổ trượt 60 s) | tới khi lượt cũ nhất ra khỏi cửa sổ | `:422` |
| `hết lượt gọi hôm nay (X/Y RPD)` | **bộ đếm nội bộ** `rpdUsed` chạm `AI_<TÊN>_RPD` — app tự dừng **trước** khi máy chủ trả 429 (thường gặp nhất trong vận hành; popover hiện `nghỉ tới HH:MM (hết lượt gọi hôm nay …)`) | tới `nextReset`: 0h Pacific với Gemini, 0h giờ VN với nguồn khác (`dayKey`/`nextReset`, chú thích `:337`, `QUOTA_RESET_TZ :57`) | `:414-415` |
| `hết token hôm nay (X/Y TPD)` | `tpdUsed` chạm `AI_<TÊN>_TPD` (cùng cơ chế, cùng mốc reset) | như trên | `:417-418` |
| `hết quota ngày (429) — Gemini reset lúc 0h giờ Pacific (HH:MM giờ VN)` | Gemini 429 quota ngày (gợi ý "retry in 27s" của Google bị bỏ vì < 10 phút không đáng tin) | tới 0h Pacific (14:00 PDT / 15:00 PST giờ VN), kẹp ≤ 6 h rồi dò lại | `:554-561`, `:39,41`, `QUOTA_RESET_TZ :57` |
| `hết quota ngày (429), chờ theo thời gian máy chủ báo` | provider báo `Retry-After`/"try again in …" đáng tin (Groq báo chính xác cả quota ngày) | đúng thời gian báo (kẹp ≤ 6 h) | `:558` |
| `hết quota ngày (429) — dò lại sau 1 giờ` | quota ngày, không biết múi giờ reset, không gợi ý | 1 giờ | `:563`, `:40` |
| `bị giới hạn tốc độ (429), chờ theo Retry-After` | 429 không phải quota ngày, máy chủ có gợi ý `Retry-After`/"try again in …" | đúng thời gian báo, kẹp 1 s – 6 h | `:567` |
| `bị giới hạn tốc độ (429)` | 429 không quota ngày, không gợi ý — giới hạn phút | 30 s → 60 → 120… tối đa 15 phút; thành công reset về 30 s | `:571`, `:36,38` |
| `API key sai hoặc hết hạn (401) — kiểm tra AI_<TÊN>_API_KEY trong .env` | 401 (`:176`); hoặc 400/422 mà nội dung khớp `KEY_INVALID_RE` (`:111`: "valid api key", "api_key_invalid", "unauthorized"… — Gemini báo "API key not valid" bằng 400) (`:179-180`). Số trong ngoặc là status thật (`c.status ?? 401`) | 1 giờ (`authDisableMs`) | `:576`, `:42` |
| `không có quyền dùng model/tài khoản (403) — kiểm tra key hoặc AI_<TÊN>_MODEL` | 403 (`:177`) — key hợp lệ nhưng tài khoản/model không được phép; **không** đi vào nhánh 401 | 1 giờ | `:579` |
| `không tìm thấy model "…" (404) — kiểm tra AI_<TÊN>_MODEL / AI_<TÊN>_BASE_URL` | 404 | 1 giờ | `:582` |
| `máy chủ lỗi (5xx)` / `không kết nối được` / `quá thời gian chờ` / `request bị từ chối (400)` / `lỗi không rõ` | lỗi server / mạng / > 20 s (`providerTimeoutMs`) / 400–422 lạ / status khác (kind `other`, `:183`) | 20 s → 40 → 80… tối đa 15 phút | `:585-588`, `:31,37` |
| `đang nghỉ (từ lần chạy trước)` | cooldown khôi phục từ `state.json` mà không có lý do | theo `cooldownUntil` đã lưu (bỏ nếu > 36 h) | `:860-861`, `:44` |
| `không khởi tạo được client` | client của provider không dựng được (BASE_URL/key không hợp lệ). Log khởi động: `[ai] <Label>: không khởi tạo được client (BASE_URL/key không hợp lệ?) → bỏ qua` (`:361`, prefix `[ai]` từ `warn` `:335`); popover hiện đúng chuỗi ngắn này ở trạng thái "chưa sẵn sàng" (`enabled: false`, `until: 0` → `public/js/labels.js:201`) | vô hạn, tới khi restart với cấu hình đúng | `:411`, `:361` |

Hai trường hợp **không** gây nghỉ: Groq "Request too large" (OTPM/TPM) → hạ `max_completion_tokens` xuống 90 % trần máy chủ báo và thử lại ngay trên cùng provider, nhớ 7 ngày (`:45-48`); 400 vì không nhận `json_schema` → đổi `json_object` trong cùng request và nhớ 24 h (`:43`). Chi tiết router: [05 §4](./05-lop-ai.md).

### 9.4 Cầu dao của Brain (`src/ai/brain.ts:41-44, 152-162`)

Khi **mọi** provider đều thất bại trong một request và điều đó lặp ≥ 3 lần liên tiếp (`BREAKER_AFTER = 3`) → brain tạm dùng thoại offline 60 s, rồi 120 s, 240 s… tối đa 10 phút (`BREAKER_BASE_MS = 60_000`, `BREAKER_MAX_MS = 600_000`); log `… → lỗi N lần liên tiếp, tạm dùng thoại offline X giây`. Một lần gọi thành công reset. Trong lúc cầu dao mở, chip hiện 🧪 Offline dù từng provider có thể "sẵn sàng". `mode` của `/api/health` = `router.enabled` (có ít nhất một client provider), **không** phản ánh cầu dao; `status.ai.mode` = `llmReady()` (có provider sẵn sàng **và** cầu dao đóng) — vì vậy `/api/health` có thể nói `llm` trong khi chip nói Offline.

### 9.5 Giới hạn miễn phí đã đo (2026-11-01) và nhịp một ngày

| Nguồn | Giới hạn thật | Cấu hình gợi ý (`.env.example`) | Reset |
|---|---|---|---|
| Gemini `gemini-3.5-flash-lite` | 500 lượt/ngày/model | `AI_GEMINI_RPD=500`, `AI_GEMINI_RPM=10`, `AI_GEMINI_TIER=strong` | 0h Pacific = **14:00 (PDT) / 15:00 (PST) giờ VN**; app tính theo `America/Los_Angeles` (`llm.ts:88`, `nextMidnightIn :124`) nên tự đúng qua đổi giờ |
| Groq free (theo model) | 8 000 token/phút, 200 000 token/ngày, 1 000 lượt/ngày; `qwen/qwen3.8-27b` còn trần 1 000 token ra/phút → dùng `openai/gpt-oss-120b` | `AI_GROQ_RPD=1000`, `AI_GROQ_TPD=200000`, `AI_GROQ_RPM=2`, `AI_GROQ_MAX_OUTPUT_TOKENS=1500`, `AI_GROQ_MAX_REQUEST_TOKENS=8000`, `AI_GROQ_WEIGHT=0.35`, `AI_GROQ_REASONING_EFFORT=low` | ngày VN (app đếm), hoặc theo Retry-After Groq báo |
| Cloudflare Workers AI `@cf/google/gemma-4-26b-a4b-it` | 10 000 neuron/ngày | khối comment `.env.example:147-156`: `AI_CLOUDFLARE_BASE_URL`, `_API_KEY`, `_MODEL`, `_RPM=30`, `_RPD=400`, `_TPD=900000`, `_JSON=object`, `_EXTRA_JSON={"chat_template_kwargs":{"enable_thinking":false}}` (bắt buộc tắt thinking) | ngày VN (app đếm) |

Những nguồn đã thử và loại (không cấu hình lại): gpt-oss-20b (tiếng Việt lỗi), Qwen3-30B trên Cloudflare (nhạt), GLM-5.3-flash (không có ở gói Free), Z.ai GLM-4.7/4.5-flash (429 "overloaded", 8–29 s, tiếng Việt lủng củng), OpenRouter `:free` (50 lượt/ngày), SambaNova (20/ngày), GitHub Models (đóng 7/2026), Cerebras (cần thẻ). Nguồn: `README.md` §3 chỉ nói về gpt-oss-20b, `qwen/qwen3.8-27b`, Qwen3-30B và GLM-5.3-flash (`README.md:101-102,118`); Z.ai, OpenRouter, SambaNova, GitHub Models, Cerebras lấy từ bảng model đã thử ở [12-quyet-dinh-thiet-ke.md](./12-quyet-dinh-thiet-ke.md) (`:170-174`, ghi "theo chủ dự án" — **không suy ra từ code**).

Nhịp một ngày VN bình thường với pace bật: sáng Gemini "giữ nhịp" sớm (chip vàng, Groq/Cloudflare gánh), quota mở dần tới 15:00 là reset → chiều Gemini dồi dào. Bộ đếm `rpdUsed`/`tpdUsed` theo ngày Pacific (Gemini) hoặc ngày VN (khác) và **được lưu trong `state.json` (phần `brain`)**, nên restart không làm app quên đã dùng bao nhiêu — trừ khi xoá `state.json` (§7.4). `LLM_ONLY_WHEN_WATCHED=true`: không ai xem → cảnh thường không gọi AI (`skipped` tăng) → quota được để dành.

### 9.6 Cùng dữ liệu qua API

`GET /api/stats` (cần cookie/`?dev=`): `ai.providers[]` là `ProviderStats` (`types.ts:359-377`): `name, label, model, enabled, calls, failures, inputTokens, outputTokens, costTodayUsd, rpdUsed, rpdLimit?, tpdUsed, tpdLimit?, cooldownUntil?, cooldownReason?, format, lastError?`. Dùng được cho một script theo dõi (ví dụ cron curl mỗi giờ và cảnh báo khi `providers[].cooldownReason` chứa "API key" hoặc `ai.mode === 'offline'` quá lâu) — chưa có, xem Câu hỏi còn mở.

---

## 10. Sự cố thường gặp & cách xử lý

| Triệu chứng | Nguyên nhân có thể | Kiểm tra | Xử lý |
|---|---|---|---|
| Site **502 Bad Gateway** | app không chạy / đang khởi động lại / `PORT` ≠ 3200 | `su - deploy -c 'pm2 ls'`; `curl -s http://127.0.0.1:3200/api/health`; `pm2 logs vibecorp --lines 50` | `pm2 restart vibecorp`; đối chiếu `PORT` trong `deploy/.env.production` với `APP_PORT`; xem log lỗi khởi động |
| Log `❌ Cổng 3200 đang bị chương trình khác dùng` (`EADDRINUSE`) và pm2 restart liên tục | app khác trên VPS chiếm cổng, hoặc tiến trình cũ chưa chết | `ss -ltnp \| grep 3200` | dừng tiến trình chiếm cổng, hoặc đổi `APP_PORT` + `PORT` + chạy lại `--setup` (cẩn thận §3.7) |
| Chip **🧪 Offline** / chấm xám kéo dài | mọi provider nghỉ (quota, key sai, model sai) hoặc cầu dao mở | popover chip 🤖 → từng nguồn "nghỉ tới … (lý do)"; `curl -b jar …/api/stats \| jq '.ai.lastError, [.ai.providers[] \| {label, cooldownReason, rpdUsed, tpdUsed}]'`; log `[ai]` | key sai/model sai → sửa `deploy/.env.production` → deploy; hết quota → không cần làm gì (thoại mẫu giữ văn phòng sống), hoặc thêm nguồn (Cloudflare); mạng → kiểm tra VPS ra Internet |
| AI **hết quota giữa ngày** quá sớm | pace tắt (`AI_<TÊN>_PACE=false`), `MIN_SECONDS_BETWEEN_LLM` quá nhỏ, `LLM_ONLY_WHEN_WATCHED=false`, quá nhiều cảnh `high` | popover: `rpdUsed` tăng nhanh; `skipped` thấp | bật pace; tăng `MIN_SECONDS_BETWEEN_LLM`; `AI_ROUTING=balanced` + `WEIGHT`; thêm nguồn |
| Nhân vật **giật / khựng** | gói WS đến so le (Cloudflare) — bộ đệm đang nới; hiếm khi CPU server | `window.__vpa.store.net` trên site thật (§5.3); `top` trên VPS | thường tự ổn sau vài giây (buffer tới 700 ms). Nếu `buffer` kẹt trần và `lateFrames` tăng liên tục → đường mạng người xem; nếu CPU VPS cao → app khác trên VPS, không phải mô phỏng (đo ~0 %) |
| **Giao diện cũ** sau deploy (nút/tab mới không thấy, lỗi console "undefined") | `ASSET_VERSION` không đổi (chưa restart sau khi đổi `public/`), hoặc tab mở từ trước | `curl -s https://…/ \| grep -o '/v/[a-f0-9]*/'` so với lần trước; `curl -sI https://…/v/<ver>/js/main.js` | `pm2 restart vibecorp` nếu phiên bản không đổi; người xem F5 (index.html no-cache). Cuối cùng mới "Purge Everything" Cloudflare |
| **429** ở tab Lịch sử, `/api/news`, hoặc `POST /api/dev/login` thất bại lẻ tẻ | nginx `limit_req` 2 r/s theo IP Cloudflare edge (§4.3); hoặc `HISTORY_MAX_INFLIGHT` (có `Retry-After: 3`) | nginx error log `limiting requests`; header `Retry-After` có → từ app | thử lại sau vài giây; lâu dài: real IP Cloudflare hoặc nới `rate`/`burst` |
| **Không vào được admin** (không thấy bảng dev) | token sai / đã đổi; `DEV_PANEL=false`; mở link `?dev=<sai>` ghi đè; `#dev=` chưa mở lần nào trên trình duyệt này | log khởi động dòng `🛠️ Bảng dev: …`; `pm2 logs \| grep '\[ws\] Bỏ qua lệnh dev'`; Network tab: `POST /api/dev/login` → 403? | mở lại `https://…/#dev=<DEV_TOKEN>`; nếu 403 → token trong `.env.production` khác token đang dùng; `DEV_PANEL=false` → sửa `.env.production` |
| Log `[world] ⚠️ Không khôi phục được trạng thái … File cũ được giữ lại tại: …state.json.bad-…` | `state.json` hỏng / sai `STATE_VERSION` (sau rollback) | `ls /opt/vibecorp/data/` | văn phòng đã tự bắt đầu lại; giữ file `.bad-*` để xem, xoá khi không cần |
| Văn phòng **"đứng hình" ban đêm** / không sang ngày | không — thiết kế, **chỉ ở `TIME_MODE=compressed`** (`world.ts:1139`): từ 18:30 không ai ở văn phòng thì nhảy ngày (`T_NIGHT_SKIP`, `world.ts:61,1141`); failsafe 23:00 (`T_FAILSAFE :63`, cảnh báo `:2411`). Ở `realtime` không có nhảy đêm/failsafe: ngày game bám giờ thật VN và sang ngày khi lịch VN đổi ngày (`endDay('rollover')`, `world.ts:1120-1128`); `T_FORCE_OUT` 21:00 (`:1143`) áp cho cả hai chế độ | log `[world] Ngày N: quá 23:00 vẫn còn người — buộc kết thúc ngày.` | nếu cảnh báo failsafe lặp mỗi ngày → có người kẹt trong cảnh — xem [04](./04-dao-dien-cau-chuyen-nhan-su.md) |
| **Đĩa** đầy dần | `data/history/` (~0,85 MB/ngày thật đo 2026-11-01: `2026-11-01.jsonl` 854 897 B) | `du -sh /opt/vibecorp/data/history`; `ls` có `.gz` sau 7 ngày? `index.json` có? | bình thường gzip sau `HISTORY_GZIP_AFTER_DAYS=7`, xoá sau 180 ngày (`rotate()` lúc khởi động + sang ngày, `archive.ts:118,166-167,246`); nếu không thấy `.gz` → xem log `🗄️ Lưu trữ:` / `stats.errors` qua `/api/history` |
| **Chứng chỉ hết hạn** | timer certbot không chạy (hiện chạy 2 lần/ngày — kiểm 2026-11-03); không có mail nhắc. Cloudflare đang ở **Full (strict)** nên hết hạn = người xem thấy **lỗi 526** ngay | `certbot certificates`; `systemctl list-timers \| grep certbot` | `certbot renew`; nếu xác minh lỗi do Cloudflare thì tạm tắt proxy (đám mây xám) rồi gia hạn |
| **Không có tin thời sự** (không cảnh 🗞️, nút dev news báo "Chưa có tin") | VPS không ra được feed; `NEWS_ENABLED=false`; feed đổi URL | `curl -s https://…/api/news \| jq '.lastError, .counts, .lastOkAt'`; log cảnh báo nguồn (1 lần/giờ/feed) | kiểm tra DNS/egress VPS; sửa `NEWS_FEEDS`; xem [06 §13](./06-tin-tuc-thoi-su.md) |
| Sau **reboot VPS** app không lên | `pm2 startup` ở `--setup` đã lỗi im lặng (`\|\| true`) | `systemctl status pm2-deploy` (tên cần kiểm tra); `su - deploy -c 'pm2 ls'` | `su - deploy -c 'pm2 resurrect'`; chạy lại tay `pm2 startup systemd -u deploy --hp /home/deploy` theo hướng dẫn nó in ra |
| Log `[ws] Bỏ qua lệnh dev từ client không có quyền (tổng N lần)` (≤ 1 dòng/phút, `DEV_IGNORED_WARN_MS` `server.ts:54`) | (a) socket không dev gửi lệnh (`server.ts:472`); (b) **`POST /api/dev/login` sai mã cũng đếm** (`server.ts:117`) — rất thường gặp sau khi đổi `DEV_TOKEN`: trình duyệt cũ còn `localStorage['vpa.dev']` = mã cũ tự POST mỗi lần mở trang (`net.js:32-37`), không phải ai dò | so mốc thời gian log với lần đổi token; trên trình duyệt admin cũ: Network → `POST /api/dev/login` → 403? | vô hại; mở lại `#dev=<mới>` trên các trình duyệt cũ để hết log; chỉ nghi dò khi N tăng nhanh mà không đổi token |
| Log `⚠️ bỏ qua: <Nguồn> (…): chưa có key (AI_<TÊN>_API_KEY)` lúc khởi động | thiếu key trong `.env.production` cho provider có trong `AI_PROVIDERS` (`config.ts:170`; định dạng ghi chú `config.ts:259`). Ghi chú này được in **hai lần, hai dạng**: `   ⚠️  <Nguồn> (<model>): chưa có key …` (`server.ts:550`) và `[ai]   ⚠️  bỏ qua: <Nguồn> (<model>): …` (`router.ts:386`) — `grep 'bỏ qua:'` chỉ bắt dòng thứ hai | `pm2 logs vibecorp --lines 50 \| grep -E 'bỏ qua:\|chưa có key'` | thêm key hoặc bỏ tên khỏi `AI_PROVIDERS` |

---

## 11. Checklist trước khi deploy

- [ ] `npm test` xanh trên máy dev (typecheck → smoke → smoke:story → test:news → test:llm → test:router). Nếu `smoke:story` đỏ vì thống kê, chạy lại với `SMOKE_STORY_SEED=<số in ra>` để phân biệt flaky và lỗi thật ([11-kiem-thu-qa.md](./11-kiem-thu-qa.md)).
- [ ] Đã cập nhật tài liệu theo bảng "Khi sửa code vùng này" của mọi vùng vừa đụng; nếu đổi route/nginx/env → cập nhật tài liệu này.
- [ ] `deploy/.env.production` còn đúng: `PORT=3200`, `PERSIST=true`, `DEV_PANEL=true` + `DEV_TOKEN` dài (hoặc `DEV_PANEL=false`), `HISTORY_ENABLED=true`, key AI đủ, không có `DEBUG_PROMPTS`. Biến mới thêm vào `src/config.ts` đã có trong `.env.example` **và** (nếu cần giá trị khác mặc định) trong `.env.production`.
- [ ] Không thêm file bí mật mới ngoài danh sách exclude của rsync (`deploy.sh:32-34`) và `.gitignore`; nếu có → thêm vào cả hai trước khi deploy.
- [ ] Nếu đổi `data/products.json`: JSON hợp lệ, `id` kebab-case, không đổi `id` cũ (click stats + `deskItemProductId`); log khởi động sẽ in số món trên kệ.
- [ ] Nếu đổi `public/`: biết rằng `pm2 restart` trong script sẽ đổi `ASSET_VERSION`; đường dẫn `<link>/<script>` mới trong `index.html` phải **tương đối** để được viết lại.
- [ ] Nếu đổi `src/types.ts` theo cách không tương thích: chấp nhận tab cũ lỗi tới khi F5, hoặc giữ tương thích phía client.
- [ ] Nếu đổi `STATE_VERSION` hay shape snapshot: hiểu rằng rollback sẽ mở văn phòng mới (§7.2).
- [ ] Giờ deploy: tránh giờ đông người xem và tránh 14:00–15:00 giờ VN nếu muốn quan sát Gemini reset ngay sau đó.
- [ ] Sau deploy: 2 dòng health OK; mở site (ẩn danh) — không thấy chip 🤖/bảng dev; mở `#dev=` — thấy chip 🤖 và bảng dev; `pm2 logs vibecorp --lines 50` sạch; console trình duyệt sạch; `grep -o '/v/[a-f0-9]*/'` ra phiên bản mới nếu đổi `public/`.
- [ ] Ghi mốc vào [01-tong-quan.md](./01-tong-quan.md) §8 nếu đáng nhớ; commit.

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật … |
|---|---|
| `APP_DIR`, `APP_USER`, tên pm2 `vibecorp`, hay cách start trong `deploy/deploy.sh` | §1.2–§1.4, §3.1, §6 (mọi lệnh có `vibecorp`/`/opt/vibecorp`/`deploy`); `README.md` §8 (nhắc deploy); `docs/ui-polish-todo.md` §8 là lịch sử — không sửa, chỉ ghi thêm |
| `APP_PORT` / `PORT` | §1.2, §2.4, §3.7, §10 (502/EADDRINUSE); phải đổi đồng thời `deploy/.env.production` và chạy `--setup` để `sed __PORT__` |
| Danh sách exclude của rsync | §3.2 và §1.3; `.gitignore` nếu là bí mật; §11 checklist |
| Thêm/bớt bước trong `deploy.sh` (ví dụ chạy `npm test`, dùng khoá SSH, `npm ci`) | §3.1 bảng bước, §2.1–§2.2, §3.7; Câu hỏi còn mở (gạch mục đã làm); **mọi số dòng `deploy.sh:NN`** ở §1.2, §2.3, §3.1–§3.2, §11 trôi theo — dò lại bằng `grep -n` |
| `deploy/nginx.site.conf` (location mới, timeout, access_log, real IP) | §4.2 bảng chỉ thị, §4.3; nếu route mới lộ hệ thống → [02 §6](./02-kien-truc-va-giao-thuc.md) và `devAllowed`; §10 dòng 429 |
| `deploy/nginx.limit.conf` (`rate`, `burst`, khoá) | §4.1, §4.3, §10; chú thích trong file |
| Thêm route HTTP trong `src/server.ts` | bảng [02 §6](./02-kien-truc-va-giao-thuc.md); nếu dưới `/api/` → nhớ bị `limit_req` (§4.2); nếu cần quyền → `devAllowed`; §6 nếu là lệnh vận hành |
| `/api/health` (trường mới, ý nghĩa `mode`) | §3.6, §6, §9.4; `deploy.sh:62-63` chỉ in nguyên văn |
| `publicStatus()`, `StatusInfo`/`UsageStats`, cách chip 🤖 vẽ (`hud.js`, `labels.js`) | §8.2, §9.1–§9.2; [02 §5](./02-kien-truc-va-giao-thuc.md), [05 §11](./05-lop-ai.md); nguyên tắc (4) của chủ dự án |
| Ý nghĩa `ai.calls` (đổi nhãn "Lượt gọi hôm nay" ở `hud.js:319`, hoặc cho `calls` reset theo ngày trong `rollDay()` `router.ts:391-400`) | §9.1–§9.2, §7.4; Câu hỏi còn mở 17; snapshot `brain` trong `state.json` (restore `router.ts:840`) và `scripts/test-router.ts` |
| `T_NIGHT_SKIP`/`T_FAILSAFE`/`T_FORCE_OUT`, nhánh `mode === 'compressed'` trong `World.step()` (`world.ts:1139-1143`), `TIME_MODE` | §2.4, §10 hàng "đứng hình ban đêm"; [03](./03-mo-phong-the-gioi.md) |
| Chuỗi `cooldownReason` / hằng `P` trong `src/ai/router.ts`, `BREAKER_*` trong `brain.ts` | §9.3, §9.4; [05 §4–§5](./05-lop-ai.md); `scripts/test-router.ts` (bám chuỗi tiếng Việt) |
| Cơ chế `ASSET_VERSION` / `sendIndexHtml` / `/v/` | §5.2, §10 "giao diện cũ", §11; [02 §7](./02-kien-truc-va-giao-thuc.md) |
| Hằng `NET_*`, `KF_MAX` trong `store.js`, `FRAME_MS` phía server, `ts` của `frame` | §5.3; [02 §10](./02-kien-truc-va-giao-thuc.md); đo lại trên site thật qua Cloudflare |
| Cookie `vpa_dev`, `localStorage['vpa.dev']`, `/api/dev/*`, `devAllowed()`, nút 🚪 | §8 toàn bộ; [02 §8](./02-kien-truc-va-giao-thuc.md); `README.md` §8; `nginx.site.conf:10-13,41-42` (tên tham số `dev`) |
| `SAVE_EVERY_MS`, `shutdown()`, thứ tự khởi động/tắt | §1.4, §7.2–§7.4; [02 §2](./02-kien-truc-va-giao-thuc.md), [03 §16](./03-mo-phong-the-gioi.md) |
| `STATE_VERSION`, `quarantineFile`, `STATE_FILE`/`HISTORY_DIR` tương đối cwd | §1.3, §7.2, §7.4, §10 |
| Archive (`HISTORY_*`, `rotate`, gzip) | §6 dòng archive, §7.5, §10 "đĩa"; [03 §17](./03-mo-phong-the-gioi.md) |
| Biến môi trường mới trong `src/config.ts` | `.env.example` **và** `deploy/.env.production` (nếu cần giá trị khác mặc định); §2.4 nếu ảnh hưởng production; [09-cau-hinh-du-lieu.md](./09-cau-hinh-du-lieu.md) |
| Quota/nguồn AI miễn phí (đo lại, thêm/loại nguồn) | §9.5; `.env.example`; `README.md` §3; [05 §2, §12](./05-lop-ai.md); ghi ngày đo |
| Cấu hình Cloudflare (SSL mode, cache rule, Always Use HTTPS) | §5.1–§5.2, §8.4 (cờ `Secure`); chú thích `deploy.sh:53-54`; xoá mâu thuẫn ở Câu hỏi còn mở |

Không có test tự động cho vùng này (deploy, nginx, Cloudflare). Kiểm tra bằng tay theo §11 và §6.

## Câu hỏi còn mở / cần kiểm tra

1. ~~Chế độ SSL Cloudflare thật là gì~~ — **đã rõ 2026-11-03: Full**, chủ dự án chuyển **Full (strict)** cùng ngày; chú thích `deploy.sh` đã sửa (§5.1).
2. **`limit_req` khoá theo IP Cloudflare edge** (§4.3): chưa có `set_real_ip_from`/`real_ip_header CF-Connecting-IP`. Cần đo trên VPS (`grep 'limiting requests' /var/log/nginx/error.log`) và quyết định: real IP, nới `rate`, hay chỉ giới hạn `/api/history`.
3. **`GET /api/stats?dev=<token>` để token trong access log nginx** vì `location /api/` không có `access_log off` (chỉ `/ws` và `$arg_dev` ở `location /`). Nên thêm `if ($arg_dev) { access_log off; }` vào `location /api/` hoặc sửa README §3.6 sang cách dùng cookie (§6).
4. **`kill_timeout` của pm2 trên VPS** so với dự phòng `exit(0)` sau 1,5 s của `shutdown()`: cần xem `pm2 describe vibecorp` để chắc pm2 không SIGKILL trước khi `world.save()` + `archive.stop()` xong (nhất là khi hàng đợi archive dài).
5. **`pm2 startup systemd` có thành công không** (`|| true` nuốt lỗi): kiểm tra tên unit (`systemctl list-units | grep pm2`) và thử nghiệm reboot ngoài giờ.
6. **Phiên bản Node trên VPS** (script chỉ in): README yêu cầu ≥ 20; `package.json` nên có `engines.node` để `npm install` cảnh báo.
7. **`sshpass` + mật khẩu** trong `deploy/vps.env`: chuyển sang khoá SSH (`ssh-copy-id`, bỏ `sshpass`) an toàn hơn và không cần cài `sshpass` trên máy dev mới.
8. **Chạy lại `--setup` ghi đè file nginx đã có phần 443 của certbot**: nên tách bước nginx/certbot khỏi `--setup` hoặc kiểm tra file tồn tại trước khi ghi.
9. **Health check không làm script fail**: cân nhắc `exit 1` khi `/api/health` trong VPS không trả `ok:true` sau N lần thử, để CI/người chạy không bỏ sót. Liên quan: trong VPS chỉ chờ `sleep 2` rồi `curl -m 5` (`deploy.sh:62`) — app khởi động chậm hơn (state lớn, VPS bận) sẽ in `app chưa trả lời` dù vài giây sau lên bình thường.
10. **Không có giám sát uptime / cảnh báo** (AI offline kéo dài, 502, đĩa): có thể cron trên VPS gọi `/api/health` + `/api/stats` (cookie) và gửi thông báo; hoặc dịch vụ ngoài gọi `/api/health`.
11. **Không có sao lưu `data/`** (§7.5) — việc mở của chủ dự án.
12. **`tsx watch` (`npm run dev`) có theo dõi `public/` không** — ảnh hưởng bẫy `ASSET_VERSION` khi phát triển cục bộ; chưa kiểm tra.
13. **Tiêu thụ băng thông/CPU thật của VPS theo số người xem** chưa đo (`agents` + `status` mỗi 2 s cho mọi socket — xem [02 Câu hỏi 1](./02-kien-truc-va-giao-thuc.md)); 1 vCPU dùng chung với app khác.
14. **Cổng 3000 "đã bận"** là của app nào trên VPS — ghi chú để người sau không vô tình đổi `APP_PORT` về 3000.
15. **`README.md` §11 "Đưa lên mạng"** chỉ là gợi ý chung và `.env.example:102` ghi `PORT=3000`: nên trỏ README §11 sang tài liệu này và ghi rõ production dùng 3200 qua `deploy/.env.production`.
16. ~~Chứng chỉ Let's Encrypt có tự gia hạn không~~ — **có** (kiểm 2026-11-03): `snap.certbot.renew.timer` chạy 2 lần/ngày, cấu hình gia hạn dùng plugin nginx, chứng chỉ corp hạn 2027-01-30. Vẫn không có mail nhắc.
17. **Nhãn "Lượt gọi hôm nay" (`hud.js:319`) hiển thị tổng cộng dồn `ai.calls`** (§9.1–§9.2), không phải số trong ngày. Chọn một: đổi nhãn thành "Tổng lượt gọi" (và "Token vào/ra" tương tự), hoặc thêm bộ đếm theo ngày được `rollDay()` reset và đưa vào `UsageStats`/`ProviderStats` (`types.ts:359-377`) — khi đó phải cập nhật snapshot `brain` trong `state.json`, `scripts/test-router.ts` và [05](./05-lop-ai.md).
18. **Tên model Groq tuỳ chọn lệch giữa hai nguồn**: `.env.example:32` gợi ý `qwen/qwen3-32b`, còn `README.md:101,189` và §9.5 ghi `qwen/qwen3.8-27b` (theo chủ dự án). Cần kiểm tra tên model thật trên Groq rồi sửa một bên; tài liệu này theo README. — **đã thống nhất 2026-11-02**: `.env.example` được sửa, giờ ghi `qwen/qwen3.8-27b`.
19. ~~Chưa có `docs/README.md`~~ — mục lục [README.md](./README.md) đã được tạo 2026-11-02; đoạn mở đầu đã cập nhật.
