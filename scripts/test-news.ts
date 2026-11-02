// =====================================================================
//  TEST THỜI SỰ (v3) — không mạng: đọc 3 mẫu RSS đã lưu trong scripts/fixtures/news/*.xml
//  (Tuổi Trẻ thể thao: CDATA + ngày "11/1/2026 2:20:00 PM"; GameK: ngày "GMT+7"; VnExpress giải trí:
//  description có HTML), kiểm tra bộ đọc RSS, bộ lọc an toàn (chặn từ khoá có / không dấu, tin cũ,
//  giải trí chỉ chủ đề nhẹ) và kho tin (pick / exclude / markUsed / recent / serialize / refresh với mạng giả).
//
//  npm run test:news
// =====================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { NewsCategory, NewsItem } from '../src/types.js';
import {
  cleanText, decodeEntities, expandCategories, filterNews, isFootball, judge, matchKeyword, newsId, normText, parseDate,
  parseRss, sourceLabel, stripDiacritics, summarize, NewsStore,
} from '../src/news/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'news');
/** "bây giờ" cố định (sau giờ tải mẫu 2026-11-01 16:30 +07) để test không lệ thuộc ngày chạy */
const NOW = Date.parse('2026-11-01T17:00:00+07:00');
const DAY = 86_400_000;

const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, info = ''): void => { checks.push([name, ok, info]); };
const section = (s: string): void => console.log(`\n── ${s}`);
const read = (f: string): string => readFileSync(join(FIXTURES, f), 'utf8');

function item(over: Partial<NewsItem> & { title: string }): NewsItem {
  const url = over.url ?? `https://vnexpress.net/${stripDiacritics(over.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(Math.random() * 1e6)}.html`;
  return {
    id: newsId(url), title: over.title, summary: over.summary ?? '', source: over.source ?? sourceLabel(url), url,
    category: over.category ?? 'cong_nghe', publishedAt: over.publishedAt ?? NOW - 3 * 3600_000,
  };
}

// ================================================================== 1. đọc RSS từ 3 mẫu
section('1. Đọc RSS (3 mẫu đã lưu)');
const tt = parseRss(read('tuoitre-the-thao.xml'), 'the_thao', { now: NOW });
const gk = parseRss(read('gamek-home.xml'), 'game', { now: NOW });
const ve = parseRss(read('vnexpress-giai-tri.xml'), 'giai_tri', { now: NOW });
const all = [...tt, ...gk, ...ve];
const hex12 = /^[0-9a-f]{12}$/;
check('mỗi mẫu đọc được ≥ 40 tin', tt.length >= 40 && gk.length >= 40 && ve.length >= 40, `${tt.length} / ${gk.length} / ${ve.length}`);
check('id = 12 ký tự hex, không trùng', all.every((i) => hex12.test(i.id)) && new Set(all.map((i) => i.id)).size === all.length);
check('tiêu đề ≥ 8 ký tự, url https', all.every((i) => i.title.length >= 8 && /^https:\/\//.test(i.url)));
check('summary ≤ 200 ký tự, không còn HTML / entity', all.every((i) => i.summary.length <= 200 && !/<|&[a-z#0-9]+;/i.test(`${i.title} ${i.summary}`)),
  all.filter((i) => /<|&[a-z#0-9]+;/i.test(`${i.title} ${i.summary}`)).map((i) => i.title).slice(0, 2).join(' | '));
check('VnExpress: description có <a><img></br> → summary là chữ thuần, ≥ 80% tin có summary', ve.filter((i) => i.summary.length > 20).length >= ve.length * 0.8,
  `${ve.filter((i) => i.summary.length > 20).length}/${ve.length}`);
check('nhãn nguồn theo tên miền', tt.every((i) => i.source === 'Tuổi Trẻ') && gk.every((i) => i.source === 'GameK') && ve.every((i) => i.source === 'VnExpress'),
  [...new Set(all.map((i) => i.source))].join(', '));
const inRange = (i: NewsItem): boolean => i.publishedAt > Date.parse('2026-10-25T00:00:00Z') && i.publishedAt <= NOW + DAY;
check('ngày đăng đọc được ở cả 3 định dạng (US "2:20 PM", "GMT+7", RFC 822), nằm trong tuần tải mẫu', all.every(inRange),
  all.filter((i) => !inRange(i)).map((i) => `${i.source}: ${new Date(i.publishedAt).toISOString()}`).slice(0, 3).join(' | '));
check('không có tin nào lấy "bây giờ" làm ngày (pubDate đều đọc được)', all.every((i) => i.publishedAt !== NOW));
const football = tt.filter((i) => i.category === 'bong_da');
check('thể thao: tin bóng đá được gắn nhãn phụ bong_da, phần còn lại giữ the_thao', football.length >= 5 && tt.some((i) => i.category === 'the_thao'),
  `bóng đá ${football.length} / ${tt.length} — vd: ${football[0]?.title ?? '—'}`);
check('GameK → game, VnExpress giải trí → giai_tri', gk.every((i) => i.category === 'game') && ve.every((i) => i.category === 'giai_tri'));
check('XML rác / rỗng → []', parseRss('<rss><channel></channel></rss>', 'game').length === 0 && parseRss('không phải xml', 'game').length === 0
  && parseRss('<rss><item><title>ngắn</title><link>https://a.vn/x</link></item></rss>', 'game').length === 0);
check('Atom tối giản (<entry>, <link href>) cũng đọc được', parseRss(
  '<feed><entry><title>Tin thử nghiệm Atom đủ dài</title><link href="https://vnexpress.net/atom-1.html"/><updated>2026-11-01T10:00:00+07:00</updated></entry></feed>',
  'khoa_hoc', { now: NOW })[0]?.source === 'VnExpress');

// ================================================================== 2. tiện ích văn bản / ngày / id
section('2. Văn bản, ngày tháng, id');
check('cleanText: CDATA + entity + HTML', cleanText('<![CDATA[<a href="x"><img src="y"></a></br>Ban nhạc &#039;giải oan&#039; &amp; rock &lt;b&gt;x&lt;/b&gt;]]>') === "Ban nhạc 'giải oan' & rock x");
check('decodeEntities: số thập phân / hex / tên', decodeEntities('&#8230;&#x2014;&hellip;&nbsp;&quot;') === '…—… "');
check('decodeEntities: entity Latin-1 có dấu kiểu Thanh Niên (c&aacute;ch n&agrave;o, T&acirc;m, &Aacute;)', decodeEntities('c&aacute;ch n&agrave;o T&acirc;m thư &igrave; &Aacute;o &ocirc;ng') === 'cách nào Tâm thư ì Áo ông');
const tnLike = parseRss('<rss><channel><item><title>HAGL lại lận đận, giải cứu bằng c&aacute;ch n&agrave;o?</title><link>https://thanhnien.vn/hagl-185.htm</link>'
  + '<description><![CDATA[Đội b&oacute;ng phố N&uacute;i lại thua.]]></description><pubDate>Sun, 01 Nov 26 17:00:56 +0700</pubDate></item></channel></rss>', 'the_thao', { now: NOW });
check('RSS có entity Latin-1 → tiêu đề / tóm tắt sạch, nguồn Thanh Niên, nhãn bong_da', tnLike.length === 1 && tnLike[0].title === 'HAGL lại lận đận, giải cứu bằng cách nào?'
  && tnLike[0].summary === 'Đội bóng phố Núi lại thua.' && tnLike[0].source === 'Thanh Niên' && tnLike[0].category === 'bong_da', JSON.stringify(tnLike[0]));
const long = 'Lorem ipsum dolor sit amet, '.repeat(20);
check('summarize ≤ 200, cắt ở ranh giới từ, kết bằng …', summarize(long).length <= 200 && summarize(long).endsWith('…') && !summarize(long).includes(',…') && summarize('ngắn gọn') === 'ngắn gọn');
const iso = (s: string): string => new Date(parseDate(s, 0)).toISOString();
check('parseDate RFC 822 +0700', iso('Sun, 01 Nov 2026 13:53:00 +0700') === '2026-11-01T06:53:00.000Z');
check('parseDate "GMT+7" (GameK)', iso('Sun, 01 Nov 2026 16:29:00 GMT+7') === '2026-11-01T09:29:00.000Z');
check('parseDate năm 2 chữ số (Thanh Niên)', iso('Sun, 01 Nov 26 16:29:55 +0700') === '2026-11-01T09:29:55.000Z');
check('parseDate "11/1/2026 2:20:00 PM" không múi giờ → giờ Việt Nam', iso('11/1/2026 2:20:00 PM') === '2026-11-01T07:20:00.000Z');
check('parseDate ISO không múi giờ → +07:00; có múi giờ giữ nguyên', iso('2026-11-01T14:20:00') === '2026-11-01T07:20:00.000Z' && iso('2026-11-01T14:20:00Z') === '2026-11-01T14:20:00.000Z');
check('parseDate rác → fallback', parseDate('hôm qua', 123) === 123 && parseDate('', 7) === 7);
check('newsId ổn định: bỏ utm_* / #, 12 hex', newsId('https://vnexpress.net/a-1.html?utm_source=rss#top') === newsId('https://VNEXPRESS.net/a-1.html') && hex12.test(newsId('https://x.vn/a')));
check('sourceLabel: tên miền phụ, www, lạ', sourceLabel('https://thethao.thanhnien.vn/x') === 'Thanh Niên' && sourceLabel('https://www.gamek.vn/y') === 'GameK' && sourceLabel('https://baola.vn/z') === 'Baola');
check('isFootball', isFootball('Tuyển Việt Nam thắng 2-0 ở vòng loại') && isFootball('Man Utd thua Chelsea') && !isFootball('Nguyễn Thị Oanh phá kỷ lục điền kinh'));

// ================================================================== 3. bộ lọc: danh sách chặn
section('3. Bộ lọc an toàn — danh sách chặn');
// [tiêu đề, từ khoá mong đợi] — từ khoá khớp SAI cũng là thất bại (để không ai tưởng cụm không dấu "khoi to" bắt được
// trong khi thật ra "trốn thuế" mới là thứ chặn). Cụm có tiếng 2 chữ ("khởi tố", "ly hôn") không được so khớp không dấu tự động,
// nên danh sách có thêm biến thể không dấu tường minh: "khoi to", "ly hon", "bi bat", "bi to".
const mustBlock: [string, string][] = [
  ['Cựu CEO công ty game bị khởi tố vì lừa đảo nhà đầu tư', 'khởi tố'],
  ['Nam diễn viên ly hôn sau 5 năm chung sống', 'ly hôn'],
  ['Bộ trưởng nói về chuyển đổi số', 'bộ trưởng'],
  ['Game thủ 19 tuổi bị bắt giữ vì cá độ bóng đá', 'bắt giữ'],
  ['Khoi to giam doc cong ty game', 'khoi to'],         // viết không dấu → biến thể tường minh bắt được
  ['Ca si tre ly hon chong sau 5 nam', 'ly hon'],
  ['Streamer bi bat vi danh bac online', 'bi bat'],
  ['Khoi to giam doc cong ty game vi tron thue', 'trốn thuế'],      // cụm 3 chữ "tron thue" so khớp không dấu tự động
  ['Tài tử phim X-Men qua đời ở tuổi 86', 'qua đời'],
  ['Cầu thủ bị án phạt treo giò 3 trận', 'án phạt'],
  ['Streamer bị tố cáo lừa đảo donate', 'tố cáo'],
  ['Hacker đi tù 5 năm vì đánh cắp dữ liệu', 'đi tù'],
  ['Nghị sĩ đề xuất cấm TikTok', 'nghị sĩ'],
  ['Phim tài liệu về chiến tranh thắng giải', 'chiến tranh'],
];
for (const [title, kw] of mustBlock) {
  const j = judge(item({ title }), { now: NOW });
  const hit = !j.ok && j.reason === 'blocked' ? (j.keyword ?? '') : '';
  check(`chặn: "${title}" (${kw})`, hit === kw, j.ok ? 'KHÔNG bị chặn' : `${j.reason} (${j.keyword})${hit !== kw ? ` — mong "${kw}"` : ''}`);
}
// 30+ tiêu đề thật / sát thật từng lọt qua cả hai lớp lọc (đợt rà soát v3): bắt bớ, cáo buộc, kiện tụng, sa thải, chất cấm,
// tai nạn, tang sự, chính trị, đời tư, cơ thể, hạnh kiểm — phải bị bỏ (blocked hoặc conduct)
const realBlock: [string, NewsCategory][] = [
  ['Rapper nổi tiếng bị bắt khẩn cấp tại sân bay', 'giai_tri'], ['Nữ ca sĩ tố bầu show quỵt cát-xê', 'giai_tri'],
  ['Chủ nợ tố nam diễn viên vay 5 tỷ không trả', 'giai_tri'], ['Nintendo cáo buộc studio Palworld sao chép', 'game'],
  ['Nintendo kiện studio game Việt vì vi phạm bản quyền', 'game'], ['Epic thắng kiện Apple, mở đường cho store bên thứ ba', 'cong_nghe'],
  ['Ông Trump dọa đánh thuế iPhone sản xuất ngoài Mỹ', 'cong_nghe'], ['Nhà Trắng siết xuất khẩu chip AI sang Trung Quốc', 'cong_nghe'],
  ['Cầu thủ tuyển Việt Nam dương tính với chất cấm', 'bong_da'], ['Giẫm đạp ở sân vận động, hàng chục người bị thương', 'the_thao'],
  ['Tay đua MotoGP nguy kịch sau cú ngã ở vòng đua', 'the_thao'], ['Cầu thủ bất tỉnh trên sân, trận đấu bị hoãn', 'bong_da'],
  ['Vĩnh biệt huyền thoại bóng đá thế giới', 'bong_da'], ['Nhạc sĩ đột ngột ra đi ở tuổi 54', 'giai_tri'],
  ['Fan cuồng đâm chết thần tượng sau buổi ký tặng', 'giai_tri'], ['Israel không kích Gaza, hàng chục người chết', 'khoa_hoc'],
  ['Giáo hoàng kêu gọi game thủ chơi game có trách nhiệm', 'game'], ['Hôn nhân của cặp đôi vàng rạn nứt sau 10 năm', 'giai_tri'],
  ['Nữ streamer khoe vòng 1 khủng trên sóng livestream', 'game'], ['Hot girl lộ hàng khi quay TikTok trend mới', 'giai_tri'],
  ['Nữ diễn viên thả rông đi dạo phố', 'giai_tri'], ['Clip nhạy cảm của nữ idol bị phát tán trên mạng', 'giai_tri'],
  ['Nam MC sàm sỡ đồng nghiệp ngay hậu trường show', 'giai_tri'], ['Vợ cầu thủ đánh ghen giữa phố', 'bong_da'],
  ['Streamer bị tẩy chay vì phát ngôn miệt thị vùng miền', 'game'], ['Trọng tài bị nghi thiên vị trong trận derby', 'bong_da'],
  ['Nam diễn viên mắc bệnh hiếm, phải dừng đóng phim', 'giai_tri'], ['Cựu idol lãnh án 7 năm tù vì ấu dâm', 'giai_tri'],
  ['HLV Popov bị sa thải sau mạch trận tồi tệ của Thể Công', 'bong_da'], ["Keane: 'Carrick may mắn khi chưa bị sa thải'", 'bong_da'],
  ['Tranh cãi gay gắt cảnh nóng Chị Chị Em Em 3: Nghệ thuật táo bạo hay phản cảm?', 'game'], ['Viper có phát biểu gây tranh cãi sau trận thua', 'game'],
  ['Musk trêu chọc CZ sau vụ hack tỷ USD', 'cong_nghe'],
  // giải trí: hạnh kiểm / đời tư lọt qua "chủ đề nhẹ" (phim / show / nhạc / thời trang) — lớp PERSON_CONDUCT + mẫu "vợ/chồng của…"
  ['Hoa hậu bị chỉ trích vì phát ngôn trên show thực tế', 'giai_tri'], ['Người mẫu diện nội y xuyên thấu trên sàn diễn', 'giai_tri'],
  ['Ca sĩ bị ném đá vì hát sai lời trên sân khấu', 'giai_tri'], ['Diễn viên bị đồn đổ vỡ hôn nhân sau phim mới', 'giai_tri'],
  ["Nữ diễn viên phim 'Mưa đỏ' bị nghi là tiểu tam", 'giai_tri'], ['Rộ tin ca sĩ nợ nần, bị đòi tiền sau liveshow', 'giai_tri'],
  ['Trúc Nhân khóc cười kể chuyện thất tình trong show mới', 'giai_tri'], ['Phong cách thời trang của vợ tỷ phú Hong Kong', 'giai_tri'],
  ['Streamer và YouTuber khẩu chiến trên mạng, fan hai bên chửi nhau', 'game'],
];
{
  const leaked = realBlock.filter(([title, category]) => judge(item({ title, category }), { now: NOW }).ok).map(([t]) => t);
  check(`${realBlock.length} tiêu đề thật về bắt bớ / cáo buộc / kiện / sa thải / tai nạn / chính trị / đời tư / hạnh kiểm đều bị bỏ`, leaked.length === 0,
    leaked.length ? `LỌT: ${leaked.slice(0, 3).join(' | ')}` : '');
  const reasons = realBlock.map(([title, category]) => { const j = judge(item({ title, category }), { now: NOW }); return j.ok ? 'ok' : j.reason; });
  check('tin giải trí hạnh kiểm bị bỏ với lý do "conduct" (có ít nhất 2 tin), tin tin tức thường lý do "blocked"', reasons.filter((r) => r === 'conduct').length >= 2 && reasons.filter((r) => r === 'blocked').length >= 25,
    `blocked ${reasons.filter((r) => r === 'blocked').length} · conduct ${reasons.filter((r) => r === 'conduct').length}`);
}
const mustKeep: [string, NewsCategory?][] = [
  ['Dự án game mới ra mắt an toàn trên mọi thiết bị'],       // "dự án", "an toàn" ≠ "án", "an"
  ['Sự kiện ra mắt iPhone đang gây sốt tại Việt Nam'],        // "sự kiện" ≠ "kiện", "đang" ≠ "đảng"
  ['Giá vàng dao động mạnh, Bitcoin bùng nổ trở lại'],        // "dao" / "bùng nổ" không bị chặn
  ['Game bắn súng mới của Valve khiến fan hào hứng'],          // "bắn súng" trong game là bình thường
  ['Tuyển Việt Nam thắng Thái Lan 2-0 ở vòng loại', 'bong_da'],
  ['Robot hút bụi mới có AI nhận diện tất to'],                 // "to" ≠ "tố"
  // từ chặn mới không được "cắn" chữ vô hại: vòng 1 (lượt đấu), ra đi (chuyển nhượng), bắt gọn, linh kiện / yếu tố / điều kiện /
  // phụ kiện / kiện tướng, vụ nổ siêu tân tinh, trà xanh (đồ uống), tranh cãi về luật / về giá (không phải về người), triệu tập
  ['Vòng 1 V-League: Hà Nội FC hòa Thể Công', 'bong_da'], ['Ronaldo ra đi khỏi Al Nassr sau 3 mùa', 'bong_da'],
  ['Cú sút của Haaland bị thủ môn bắt gọn phút 89', 'bong_da'], ['Bruno Fernandes nén khóc sau trận thua Chelsea', 'bong_da'],
  ['Linh kiện iPhone 18 lộ diện: pin lớn hơn, màn hình sáng hơn'], ['Yếu tố nào khiến game indie Việt gây sốt trên Steam', 'game'],
  ['Điều kiện để lên rank Thách Đấu mùa này', 'game'], ['Phụ kiện bàn phím cơ cho dân văn phòng'],
  ['Kiện tướng cờ vua Việt Nam vô địch giải châu Á', 'the_thao'], ['Vụ nổ siêu tân tinh sáng nhất thập kỷ được ghi lại', 'khoa_hoc'],
  ['Uống trà xanh mỗi ngày giúp giảm nguy cơ tiểu đường', 'khoa_hoc'], ['Tranh cãi về luật việt vị mới của FIFA', 'bong_da'],
  ['iPhone 17 Pro Max gây tranh cãi vì giá bán'], ['HLV Kim Sang-sik triệu tập 26 cầu thủ lên tuyển Việt Nam', 'bong_da'],
  ['Cầu thủ bị đình chỉ thi đấu 2 trận vì thẻ đỏ', 'bong_da'], ['Kỳ thi lập trình quốc tế: học sinh Việt Nam giành 4 huy chương', 'khoa_hoc'],
  ['Nha Trang đón giải chạy đêm lớn nhất miền Trung', 'the_thao'], ['Hàng gia dụng thông minh tràn ngập hội chợ công nghệ'],
];
for (const [title, category] of mustKeep) {
  const j = judge(item({ title, category: category ?? 'cong_nghe' }), { now: NOW });
  check(`giữ: "${title}"`, j.ok, j.ok ? '' : `bị ${j.reason} (${j.keyword})`);
}
check('NEWS_BLOCKLIST thêm: từ đơn có dấu / cụm không dấu', !judge(item({ title: 'Giá Bitcoin lại lập đỉnh mới trong tuần' }), { now: NOW, blocklist: ['bitcoin'] }).ok
  && !judge(item({ title: 'Mẹo tiết kiệm pin điện thoại' }), { now: NOW, blocklist: ['tiet kiem pin'] }).ok
  && judge(item({ title: 'Mẹo tiết kiệm pin điện thoại' }), { now: NOW, blocklist: ['bitcoin'] }).ok);
check('matchKeyword: ranh giới từ (không khớp giữa từ)', !matchKeyword(normText('cà phê bán chạy'), 'án') && matchKeyword(normText('toà tuyên án hôm nay'), 'tuyên án')
  && !matchKeyword(normText('đang làm việc'), 'đảng') && matchKeyword(normText('Dang vien moi'), 'đảng viên'));
check('tin không hợp lệ (tiêu đề ngắn / url lạ) → invalid', judge(item({ title: 'ngắn' }), { now: NOW }).ok === false
  && judge({ ...item({ title: 'Tiêu đề hợp lệ đủ dài' }), url: 'ftp://x' }, { now: NOW }).ok === false);

// ================================================================== 4. bộ lọc: tin cũ + giải trí
section('4. Bộ lọc — tin cũ, giải trí nhẹ');
const old = judge(item({ title: 'Ra mắt bàn phím cơ mới cho dân văn phòng', publishedAt: NOW - 4 * DAY }), { now: NOW, maxAgeDays: 3 });
const fresh = judge(item({ title: 'Ra mắt bàn phím cơ mới cho dân văn phòng', publishedAt: NOW - 2 * DAY }), { now: NOW, maxAgeDays: 3 });
check('tin > 3 ngày bị bỏ (old), 2 ngày giữ', !old.ok && old.reason === 'old' && fresh.ok);
const light = ['Bom tấn Ấn Độ cùng loạt phim Việt ra rạp tháng 11', "MV 'Những em bé mặt trời' của Đen Vâu: Tuổi thơ nơi đại ngàn",
  'Tổ chức rock concert quy mô 30.000 khán giả', 'Gu thời trang đời thường của dàn sao Hàn', 'Trend nhảy mới gây sốt trên TikTok'];
for (const title of light) check(`giải trí nhẹ giữ: "${title}"`, judge(item({ title, category: 'giai_tri' }), { now: NOW }).ok);
const heavy: [string, string][] = [
  ['Diễn viên Lê Huỳnh đón con trai ở tuổi 62', 'blocked'],          // đời tư
  ['Katie Holmes quấn quýt họa sĩ Mỹ', 'blocked'],
  ['Ninh Dương Lan Ngọc: Tôi không vội lấy chồng', 'blocked'],
  ['Sắc vóc hoa khôi Ngoại thương thi Hoa hậu Việt Nam', 'blocked'],  // cơ thể
  ["Tài tử Patrick Stewart phim 'X-Men' qua đời", 'blocked'],
  ['Ca sĩ nổi tiếng chia sẻ về cuộc sống thường ngày', 'showbiz'],    // không có chủ đề nhẹ → bỏ
  ['Hoa hậu bị chỉ trích vì phát ngôn trên show thực tế', 'conduct'], // hạnh kiểm người thật dù có chữ "show"
  ['Son nude tông đất và váy dạ hội: xu hướng mùa thu', 'ok'],         // "nude" trong làm đẹp là ngoại lệ; chủ đề nhẹ nằm ở tiêu đề
];
for (const [title, reason] of heavy) {
  const j = judge(item({ title, category: 'giai_tri' }), { now: NOW });
  const got = j.ok ? 'ok' : j.reason;
  check(`giải trí ${reason === 'ok' ? 'giữ' : `bỏ (${reason})`}: "${title}"`, got === reason, j.ok ? 'bị GIỮ' : `${j.reason} (${j.keyword ?? ''})`);
}
// chủ đề nhẹ phải nằm ở TIÊU ĐỀ: tóm tắt có chữ "phim" không cứu được tin đời tư
check('giải trí: chủ đề nhẹ chỉ tính ở tiêu đề (tóm tắt có "phim" không đủ)', !judge(item({ title: 'Nam diễn viên chia sẻ hành trình 10 năm', summary: 'Anh nhắc lại bộ phim đầu tay', category: 'giai_tri' }), { now: NOW }).ok
  && judge(item({ title: 'Nam diễn viên chia sẻ hành trình 10 năm đóng phim', category: 'giai_tri' }), { now: NOW }).ok);
// đời tư / cơ thể bị chặn ở MỌI nhóm (trang game đăng "hot girl", thể thao bàn vóc dáng)
check('đời tư / cơ thể bị chặn ở nhóm game / thể thao', !judge(item({ title: '"Hot girl ảnh thẻ" khiến cư dân mạng sốc khi diện đồ bunny quyến rũ', category: 'game' }), { now: NOW }).ok
  && !judge(item({ title: 'Tiền đạo tuyển Việt Nam công khai bạn gái sau trận thắng', category: 'bong_da' }), { now: NOW }).ok
  && judge(item({ title: 'Tiền đạo tuyển Việt Nam ghi bàn phút 89', category: 'bong_da' }), { now: NOW }).ok);
const reasonOf = (j: ReturnType<typeof judge>): string => (j.ok ? 'ok' : j.reason);
check('NEWS_ALLOW_SHOWBIZ=false → bỏ cả tin nhẹ (showbiz_off), nhóm khác không ảnh hưởng',
  reasonOf(judge(item({ title: light[0], category: 'giai_tri' }), { now: NOW, allowShowbiz: false })) === 'showbiz_off'
  && judge(item({ title: 'Ra mắt bàn phím cơ mới cho dân văn phòng' }), { now: NOW, allowShowbiz: false }).ok);
const veF = filterNews(ve, { now: NOW, maxAgeDays: 3 });
check('mẫu VnExpress giải trí: giữ ≥ 8, bỏ ≥ 8, tin giữ không chứa từ chặn / đời tư', veF.kept.length >= 8 && veF.dropped.length >= 8
  && veF.kept.every((i) => judge(i, { now: NOW }).ok), `giữ ${veF.kept.length} / bỏ ${veF.dropped.length}`);
const ttF = filterNews(tt, { now: NOW, maxAgeDays: 3 });
const gkF = filterNews(gk, { now: NOW, maxAgeDays: 3 });
// GameK trang chủ ~1/3 là cosplay / "hot girl" / vóc dáng (đời tư, cơ thể → bỏ theo thiết kế) nên ngưỡng game thấp hơn thể thao
check('mẫu thể thao / game: phần lớn tin được giữ (thể thao ≥ 70%, game ≥ 60%)', ttF.kept.length >= tt.length * 0.7 && gkF.kept.length >= gk.length * 0.6,
  `thể thao ${ttF.kept.length}/${tt.length}, game ${gkF.kept.length}/${gk.length}`);
check('mẫu: không tin nào bị bỏ vì từ chặn "cắn" chữ vô hại (vòng một = lượt đấu, dương tính ~ đường tính)',
  ![...ttF.dropped, ...gkF.dropped].some((d) => d.keyword === 'vòng một' || d.keyword === 'dương tính'),
  [...ttF.dropped, ...gkF.dropped].map((d) => `${d.reason}:${d.keyword ?? ''}`).join(', '));

// ================================================================== 5. kho tin
section('5. Kho tin (NewsStore) — không mạng');
const warns: string[] = [];
const logs: string[] = [];
const mk = (over: Partial<ConstructorParameters<typeof NewsStore>[0]> = {}): NewsStore => new NewsStore({
  enabled: true, feeds: [], now: () => NOW, perCategory: 40, maxAgeDays: 3, allowShowbiz: true, blocklist: [],
  log: (m) => logs.push(m), warn: (m) => warns.push(m), ...over,
});
const store = mk();
const inj = store.inject(all);
check('inject: lọc rồi nạp (≤ 40 / nhóm, tin cũ hơn tin thứ 40 không nạp), nạp lại không trùng',
  inj.added === store.size() && inj.added === ttF.kept.length + Math.min(40, gkF.kept.length) + veF.kept.length && store.inject(all).added === 0,
  `thêm ${inj.added}, bỏ ${inj.dropped.length}`);
const counts = store.counts();
check('≤ 40 tin mỗi nhóm', Object.values(counts).every((n) => n <= 40), JSON.stringify(counts));
// nhồi 100 tin game → vẫn ≤ 40 và giữ tin MỚI nhất
const many: NewsItem[] = Array.from({ length: 100 }, (_, i) => item({ title: `Tin game thử nghiệm số ${i} đủ dài để hợp lệ`, category: 'game', publishedAt: NOW - i * 600_000, url: `https://gamek.vn/thu-${i}.chn` }));
store.inject(many);
const gameItems = store.items('game');
check('nhồi 100 tin game → đúng 40 tin, mới nhất trước', gameItems.length === 40 && gameItems[0].publishedAt >= gameItems[39].publishedAt && gameItems[0].title.includes('số 0'),
  `${gameItems.length} tin, đầu: ${gameItems[0]?.title}`);
const p1 = store.pick();
check('pick() trả về tin (bản sao), chưa dùng', !!p1 && !store.isUsed(p1.id) && p1 !== store.find(p1.id));
check('pick([game]) → game; pick([the_thao]) → the_thao hoặc bong_da; pick([bong_da]) → bong_da',
  store.pick(['game'])?.category === 'game' && ['the_thao', 'bong_da'].includes(store.pick(['the_thao'])?.category ?? '') && store.pick(['bong_da'])?.category === 'bong_da');
check('pick ưu tiên tin mới: luôn trong 5 tin mới nhất của nhóm', Array.from({ length: 30 }, () => store.pick(['game'])!.id).every((id) => gameItems.slice(0, 5).some((g) => g.id === id)));
const everything = new Set(store.items().map((i) => i.id));
check('exclude tất cả → null; nhóm không có tin → null', store.pick(undefined, everything) === null && store.pick(['khoa_hoc']) === null);
const used = store.pick(['game'])!;
store.markUsed(used.id);
check('markUsed: không bao giờ chọn lại, isUsed, recent có tin đó ở cuối', Array.from({ length: 60 }, () => store.pick(['game'])!.id).every((id) => id !== used.id)
  && store.isUsed(used.id) && store.recent(5).at(-1)?.id === used.id && store.recent(5).at(-1)?.url === used.url);
for (let i = 0; i < 620; i++) store.markUsed(`gia-${i}`);
check('used id có trần 500 (id cũ bị quên), recent ≤ 20', store.status().used === 500 && !store.isUsed(used.id) && store.recent(50).length <= 20);
const again = store.pick(['game']);
store.markUsed(again!.id);
const snap = JSON.parse(JSON.stringify(store.serialize()));
const store2 = mk();
store2.restore(snap);
store2.restore('rác');
store2.restore({ used: 5, recent: [{ id: 1 }], items: [{ title: 'hỏng' }] });
check('serialize → restore: used, recent giữ nguyên; ≤ 12 tin / nhóm được mang theo; rác bị bỏ qua',
  store2.isUsed(again!.id) && store2.recent(5).at(-1)?.id === again!.id && Object.values(store2.counts()).every((n) => n <= 12) && store2.size() > 0,
  `${store2.size()} tin, used ${store2.status().used}`);
check('expandCategories', expandCategories(['the_thao']).includes('bong_da') && expandCategories(undefined).length === 6 && expandCategories(['x' as NewsCategory]).length === 6);

// refresh với mạng giả: 1 feed ok, 1 feed lỗi; cảnh báo lỗi chỉ 1 lần / giờ; tin cũ được giữ
let clock = NOW;
const fetched: string[] = [];
const net = mk({
  now: () => clock,
  feeds: [{ group: 'game', url: 'https://gamek.vn/home.rss' }, { group: 'cong_nghe', url: 'https://tuoitre.vn/rss/nhip-song-so.rss' }],
  fetcher: async (url) => { fetched.push(url); if (url.includes('gamek')) return read('gamek-home.xml'); throw new Error('HTTP 503'); },
});
const r1 = await net.refresh();
const r2 = await net.refresh();
clock += 61 * 60_000;
const r3 = await net.refresh();
check('refresh: 1 nguồn ok, 1 nguồn lỗi; tin được nạp; lần sau không thêm trùng', r1.ok === 1 && r1.failed === 1 && r1.added >= 30 && r1.total === r1.added && r2.added === 0 && r3.total === r1.total,
  `lần 1 thêm ${r1.added}, tổng ${r3.total}, lỗi: ${r1.errors.join('; ')}`);
check('cảnh báo nguồn lỗi có giới hạn: 1 lần / giờ (3 lần tải → 2 cảnh báo), nhắc tên nguồn + "giữ tin cũ"',
  warns.length === 2 && warns.every((w) => w.includes('Tuổi Trẻ') && w.includes('giữ tin cũ')), `${warns.length} cảnh báo`);
check('status()', net.status().feeds === 2 && net.status().lastOkAt === clock && net.status().refreshes === 3 && typeof net.status().lastError === 'string');
check('start() không gọi mạng ngay (lần đầu sau firstFetchMs), stop() dừng', (() => {
  const before = fetched.length;
  net.configure({ firstFetchMs: 60_000 });
  net.start();
  net.stop();
  return fetched.length === before;
})());
// tin cũ dần theo thời gian: nhảy 4 ngày → pick() không còn tin
clock += 4 * DAY;
check('tin quá 3 ngày tự rơi khỏi kho khi chọn', net.pick() === null);

// ================================================================== tổng kết
console.log('');
for (const [name, ok, info] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log('');
console.log(failed ? `❌ ${failed}/${checks.length} khẳng định thất bại` : `✅ Tất cả ${checks.length} khẳng định đều đạt`);
process.exit(failed ? 1 : 0);
