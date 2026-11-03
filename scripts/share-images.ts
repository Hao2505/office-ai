// Tạo ảnh dùng khi chia sẻ link (không dùng trong giao diện):
//   public/og-image.jpg (1200×630, ảnh xem trước Facebook / Zalo / Messenger / X) — chụp văn phòng đang chạy + băng tiêu đề
//   public/icon-512.png, public/icon-192.png, public/apple-touch-icon.png (180) — biểu tượng toà nhà vẽ bằng SVG
// Dùng Chrome / Chromium headless qua giao thức DevTools, chỉ cần `ws` (đã có) — không thêm dependency.
//
// Cách dùng (docs/10 §ảnh chia sẻ):
//   1) chạy server offline cho khỏi tốn quota:  PORT=3333 PERSIST=false AI_PROVIDERS=none NEWS_ENABLED=false npm start
//   2) npm run share-images -- --url http://localhost:3333/ --label corp.vibe-coder.fun
// Tuỳ chọn: --url (mặc định http://localhost:3000/), --label (chữ tên miền in trên ảnh; mặc định lấy từ SITE_URL),
//           --wait (ms chờ thêm sau khi đủ người, mặc định 6000), --min-staff (số người phải có mặt, mặc định 7),
//           --zoom (số nấc lăn chuột phóng to, mặc định 1 ≈ ×1,3 — vẫn thấy các phòng, nhân vật đủ to; 0 = toàn cảnh),
//           --out (thư mục, mặc định public), --skip-icons. Chrome: tự tìm ở đường dẫn thường gặp, hoặc đặt CHROME_PATH.
// Văn phòng còn vắng (sáng sớm / tối) thì script bấm tua x10 trên bảng dev (server local không đặt DEV_TOKEN) tới khi
// đủ người trong giờ làm, rồi trả về x1 và chờ có bong bóng thoại mới chụp.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (!k.startsWith('--')) continue;
  const v = process.argv[i + 1];
  if (v !== undefined && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1');
}
const url = args.get('url') || 'http://localhost:3000/';
const outDir = resolve(args.get('out') || 'public');
const waitMs = Math.max(0, Number(args.get('wait') || 6000));
const minStaff = Math.max(1, Number(args.get('min-staff') || 7));
const zoomNotches = Math.max(0, Math.min(6, Number(args.get('zoom') ?? 1)));
const label = args.get('label') ?? hostOf(process.env.SITE_URL);

function hostOf(v: string | undefined): string {
  try { return v ? new URL(v).host : ''; } catch { return ''; }
}

function findChrome(): string {
  const cands = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of cands) if (c && existsSync(c)) return c;
  throw new Error('Không tìm thấy Chrome / Chromium — đặt CHROME_PATH=<đường dẫn tới file chạy Chrome>');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type CdpReply = { id?: number; result?: unknown; error?: { message?: string } };

async function main(): Promise<void> {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'vpa-share-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1200,630', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let wsUrl = '';
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try {
        const list: unknown = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (Array.isArray(list)) {
          const page = list.find((t): t is { type: string; webSocketDebuggerUrl: string } =>
            !!t && typeof t === 'object' && (t as { type?: unknown }).type === 'page'
            && typeof (t as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl === 'string');
          if (page) wsUrl = page.webSocketDebuggerUrl;
        }
      } catch { /* Chrome chưa sẵn sàng */ }
      if (!wsUrl) await sleep(150);
    }
    if (!wsUrl) throw new Error('Chrome không mở được cổng DevTools');
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    let seq = 0;
    const pending = new Map<number, (m: CdpReply) => void>();
    ws.on('message', (raw) => {
      let m: CdpReply;
      try { m = JSON.parse(String(raw)) as CdpReply; } catch { return; }
      if (typeof m.id === 'number' && pending.has(m.id)) { pending.get(m.id)?.(m); pending.delete(m.id); }
    });
    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message ?? 'lỗi'}`)) : res(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string): Promise<unknown> => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      return (r as { result?: { value?: unknown } } | undefined)?.result?.value;
    };
    const shoot = async (file: string, format: 'jpeg' | 'png'): Promise<void> => {
      const r = await send('Page.captureScreenshot', format === 'jpeg' ? { format, quality: 88 } : { format });
      const data = (r as { data?: unknown } | undefined)?.data;
      if (typeof data !== 'string') throw new Error('Không chụp được màn hình');
      writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
      console.log('✅', join(outDir, file));
    };
    const viewport = (width: number, height: number) =>
      send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    await send('Page.enable');
    await send('Runtime.enable');

    // ---- ảnh xem trước 1200×630
    await viewport(1200, 630);
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(250);
      ready = (await evaluate('!!(window.__vpa && window.__vpa.store && window.__vpa.store.map && window.__vpa.store.agents && window.__vpa.store.agents.size)')) === true;
    }
    if (!ready) throw new Error(`Trang ${url} chưa sẵn sàng (server có đang chạy không?)`);
    // dọn khung: thu gọn bảng tin, ẩn mọi nút / chip / gợi ý — chỉ giữ bản đồ + nhãn "TRỰC TIẾP"
    await evaluate(`(() => {
      document.body.classList.add('sb-collapsed');
      const st = document.createElement('style');
      st.textContent = '.hud-right,.ai-dot,.hud-clock,.zoom,.devbar,.stage-hint,.toasts,.ticker,.conn-banner,.popover,.hover-tip,.prod-tip,.loading{display:none!important}';
      document.head.appendChild(st);
      window.dispatchEvent(new Event('resize'));
    })()`);
    // chờ đủ người trong giờ làm (9:30–16:30); vắng thì tua x10 nếu có bảng dev
    const PRESENT = `(() => { const st = window.__vpa.store; const m = st.clock ? st.clock.minute : 0;
      const n = [...st.actors.values()].filter((a) => !a.goneAt).length;
      return { n, m, ok: n >= ${minStaff} && m >= 570 && m <= 990 }; })()`;
    const clickSpeed = (v: number) => evaluate(`(() => { const b = document.querySelector('.dev-speed[data-speed="${v}"]'); if (b) b.click(); return !!b; })()`);
    let fast = false;
    for (let i = 0; i < 300; i++) {
      const st = (await evaluate(PRESENT)) as { n?: number; m?: number; ok?: boolean } | undefined;
      if (st?.ok) break;
      if (!fast) { fast = (await clickSpeed(10)) === true; if (fast) console.log('⏩ văn phòng còn vắng — tua x10 tới giờ làm'); }
      if (i === 299) console.warn(`⚠️  chưa đủ ${minStaff} người trong giờ làm — chụp luôn`);
      await sleep(1000);
    }
    if (fast) await clickSpeed(1);
    if (zoomNotches > 0) {
      // phóng to quanh khu làm việc; đứng yên ~9 giây thì camera tự đi theo người đang nói (office.js followCamera)
      const at = await evaluate(`(() => { const r = document.getElementById('office').getBoundingClientRect();
        return [Math.round(r.left + r.width * 0.42), Math.round(r.top + r.height * 0.45)]; })()`);
      const [zx, zy] = Array.isArray(at) ? at.map(Number) : [500, 300];
      for (let i = 0; i < zoomNotches; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zx, y: zy, deltaX: 0, deltaY: -120 });
        await sleep(60);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }); // chuột ra góc: không hiện tooltip
    }
    await sleep(Math.max(waitMs, zoomNotches > 0 ? 10500 : 0));
    for (let i = 0; i < 80; i++) { // chờ có bong bóng thoại đã hiện ≥ 2,5 giây (camera kịp lia tới) và còn ≥ 1,5 giây
      const ok = await evaluate('window.__vpa.store.bubbles.some((b) => { const t = performance.now() - b.t0; return t > 2500 && t < b.dur - 1500; })');
      if (ok === true) break;
      await sleep(500);
    }
    await evaluate(`(() => {
      const b = document.createElement('div');
      b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99;padding:56px 44px 28px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;'
        + 'background:linear-gradient(180deg,rgba(24,16,8,0) 0%,rgba(24,16,8,0.72) 42%,rgba(24,16,8,0.9) 100%);color:#fff;font-family:"Be Vietnam Pro",system-ui,sans-serif';
      const left = document.createElement('div');
      const t = document.createElement('div');
      t.textContent = 'Văn Phòng Ảo';
      t.style.cssText = 'font-size:50px;font-weight:800;line-height:1.05;letter-spacing:-0.01em;text-shadow:0 2px 12px rgba(0,0,0,0.35)';
      const s = document.createElement('div');
      s.textContent = '10 nhân viên AI làm việc, tám chuyện, trốn việc — phát trực tiếp 24/7';
      s.style.cssText = 'margin-top:8px;font-size:23px;font-weight:600;opacity:0.95';
      left.append(t, s);
      b.appendChild(left);
      const lb = ${JSON.stringify(label)};
      if (lb) {
        const d = document.createElement('div');
        d.textContent = lb;
        d.style.cssText = 'flex:none;padding:10px 18px;border-radius:999px;background:#ff7a45;font-size:21px;font-weight:800;box-shadow:0 6px 20px rgba(255,122,69,0.45)';
        b.appendChild(d);
      }
      document.body.appendChild(b);
    })()`);
    await sleep(400);
    await shoot('og-image.jpg', 'jpeg');

    // ---- biểu tượng: toà nhà trắng trên nền cam (mọi chi tiết nằm trong vòng an toàn 80 % cho icon "maskable")
    if (!args.has('skip-icons')) {
      const win = (x: number, y: number) => `<rect x="${x}" y="${y}" width="7" height="6" rx="1.2" fill="#ffb27a"/>`;
      let wins = '';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) wins += win(34 + c * 12, 28 + r * 10);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient></defs>
        <rect width="100" height="100" fill="url(#g)"/>
        <rect x="26" y="77" width="48" height="3.5" rx="1.75" fill="rgba(255,255,255,0.65)"/>
        <rect x="29" y="21" width="42" height="57" rx="3.5" fill="#ffffff"/>
        <rect x="29" y="21" width="42" height="4" rx="2" fill="#ffe2cc"/>
        ${wins}
        <rect x="44" y="66" width="12" height="12" rx="2" fill="#9a3412"/>
        <circle cx="66" cy="27" r="9" fill="#1f2937"/>
        <path d="M60 33 L58 39 L65 35 Z" fill="#1f2937"/>
        <circle cx="62.2" cy="27" r="1.6" fill="#ffffff"/><circle cx="66" cy="27" r="1.6" fill="#ffffff"/><circle cx="69.8" cy="27" r="1.6" fill="#ffffff"/>
      </svg>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#ff7a45}</style></head><body>${svg}</body></html>`;
      await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
      for (const [file, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]] as const) {
        await viewport(size, size);
        await sleep(300);
        await shoot(file, 'png');
      }
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
}

main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
