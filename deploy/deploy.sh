#!/usr/bin/env bash
# =====================================================================
#  Deploy Văn Phòng Ảo lên VPS (Ubuntu 24.04, nginx + certbot + pm2 có sẵn)
#  Dùng:  bash deploy/deploy.sh            # deploy / cập nhật code
#         bash deploy/deploy.sh --setup    # lần đầu: tạo thư mục, nginx site, SSL, pm2
#  Cần:   deploy/vps.env (VPS_HOST, VPS_PORT, VPS_USER, VPS_PASS, DOMAIN) — không commit
#         deploy/.env.production (file .env dùng trên VPS)
#  Không đụng tới app khác trên VPS: thư mục riêng /opt/vibecorp, cổng riêng, site nginx riêng.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f deploy/vps.env ] || { echo "Thiếu deploy/vps.env"; exit 1; }
set -a; . ./deploy/vps.env; set +a
export SSHPASS="$VPS_PASS"
SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -p $VPS_PORT $VPS_USER@$VPS_HOST"
APP_DIR=/opt/vibecorp
APP_PORT="${APP_PORT:-3200}"
APP_USER=deploy
SETUP=0; [ "${1:-}" = "--setup" ] && SETUP=1

echo "▶ Kiểm tra kết nối $VPS_HOST:$VPS_PORT"
$SSH 'echo "  OK: $(hostname) · $(. /etc/os-release && echo $PRETTY_NAME) · node $(node -v)"'

if [ $SETUP = 1 ]; then
  echo "▶ Lần đầu: tạo thư mục $APP_DIR (chủ: $APP_USER)"
  $SSH "mkdir -p $APP_DIR/data && chown -R $APP_USER:$APP_USER $APP_DIR"
fi

echo "▶ Đồng bộ code (rsync, bỏ node_modules / dữ liệu / bí mật)"
sshpass -e rsync -az --delete \
  --exclude node_modules --exclude .git --exclude data/state.json --exclude 'data/state.json.*' \
  --exclude data/history --exclude .env --exclude deploy/vps.env --exclude deploy/.env.production \
  --exclude docs/preview --exclude .claude --exclude '*.log' --exclude '*.tmp-*' \
  -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=accept-new" \
  ./ "$VPS_USER@$VPS_HOST:$APP_DIR/"

echo "▶ Đưa .env production lên"
[ -f deploy/.env.production ] || { echo "Thiếu deploy/.env.production (tạo từ .env, đổi PORT=$APP_PORT, PERSIST=true, DEV_PANEL=false hoặc DEV_PANEL=true + DEV_TOKEN=<bí mật>)"; exit 1; }
sshpass -e scp -P "$VPS_PORT" -o StrictHostKeyChecking=accept-new deploy/.env.production "$VPS_USER@$VPS_HOST:$APP_DIR/.env"

echo "▶ Cài thư viện + khởi động bằng pm2 (user $APP_USER)"
$SSH "chown -R $APP_USER:$APP_USER $APP_DIR && chmod 600 $APP_DIR/.env && su - $APP_USER -c '
  cd $APP_DIR && npm install --include=dev --no-audit --no-fund --loglevel=error &&
  (pm2 describe vibecorp >/dev/null 2>&1 && pm2 restart vibecorp --update-env || pm2 start npm --name vibecorp -- start) &&
  pm2 save >/dev/null && sleep 4 && pm2 ls | grep vibecorp'"

if [ $SETUP = 1 ]; then
  echo "▶ nginx: vùng giới hạn nhịp /api/ (conf.d, riêng cho app này) + site cho $DOMAIN → 127.0.0.1:$APP_PORT (có WebSocket, /ws không ghi log)"
  $SSH "cat > /etc/nginx/conf.d/vpa-limit.conf" < deploy/nginx.limit.conf
  sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$APP_PORT/g" deploy/nginx.site.conf | \
    $SSH "cat > /etc/nginx/sites-available/$DOMAIN && ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN && nginx -t && systemctl reload nginx"
  # Cloudflare chạy SSL "Full (strict)" (từ 2026-11-03): request https vào origin cổng 443 và Cloudflare KIỂM chứng chỉ →
  # site BẮT BUỘC có khối 443 với chứng chỉ hợp lệ (certbot thêm), thiếu / hết hạn = lỗi 526. Khối 80 → https của certbot vô hại.
  echo "▶ SSL Let's Encrypt (certbot --nginx)"
  $SSH "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || echo '⚠️ certbot lỗi — chưa có chứng chỉ: qua Cloudflare (SSL Full strict) tên miền này sẽ báo lỗi 526. Nếu lỗi xác minh: tạm tắt proxy (đám mây xám) cho tên miền rồi chạy lại: certbot --nginx -d $DOMAIN'"
  echo "▶ pm2 tự chạy khi reboot"
  $SSH "env PATH=\$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER >/dev/null 2>&1 || true"
fi

echo "▶ Kiểm tra"
$SSH "sleep 2; curl -s -m 5 http://127.0.0.1:$APP_PORT/api/health || echo 'app chưa trả lời'"; echo
curl -s -m 10 "https://$DOMAIN/api/health" || echo "(https chưa sẵn sàng — xem bước SSL)"; echo
echo "✅ Xong. Log: ssh -p $VPS_PORT $VPS_USER@$VPS_HOST 'su - $APP_USER -c \"pm2 logs vibecorp --lines 50\"'"
