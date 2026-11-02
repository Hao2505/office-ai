// =====================================================================
//  Thông tin công ty, kho dự án, kho chủ đề tám chuyện, lý do sếp vắng,
//  nhãn hoạt động (lười / pantry / ...) cho World + offline + prompt.
// =====================================================================
import type { Activity, NewsCategory, RoleKey } from '../types.js';
import { blockedTopic, normText } from '../news/filter.js';

// ---------------------------------------------------------------- công ty
export const COMPANY_INFO: { tagline: string; description: string; products: string[]; culture: string } = {
  tagline: 'Code chất – Bán nhanh – Deadline không lùi',
  description:
    'Cty TNHH VibeCorp là công ty công nghệ khoảng 10 người, văn phòng thuê một sàn nhỏ trong tòa nhà cũ ở '
    + 'TP.HCM. Công ty nhận làm phần mềm theo yêu cầu (app, website, hệ thống quản lý) cho các chủ quán, cửa hàng, '
    + 'doanh nghiệp vừa và nhỏ, đồng thời bán phần mềm riêng "BánNhanh POS" thu phí theo tháng. Có một giám đốc '
    + 'mê golf, một phòng nhân sự biết hết mọi chuyện, team dev 4 người + 1 designer, và team sales – marketing.',
  products: [
    'BánNhanh POS – phần mềm bán hàng, quản lý kho, in hóa đơn cho quán cà phê, tiệm trà sữa, shop nhỏ (thu phí theo tháng)',
    'Gia công app mobile và website theo yêu cầu cho khách hàng',
    'Hệ thống quản lý nội bộ (CRM, chấm công, kho) cho doanh nghiệp vừa và nhỏ',
    'Dịch vụ bảo trì, vận hành server cho khách đang dùng phần mềm',
  ],
  culture:
    'Sếp hay nói "chúng ta là một gia đình"; bảng KPI to đùng treo giữa văn phòng, ai đỏ là cả phòng thấy; deadline '
    + 'dí liên tục, sales hứa trước – dev khóc sau; chốt được deal thì chiều thứ Sáu có trà sữa; pantry là nơi mọi '
    + 'tin đồn bắt đầu; có nhóm Zalo kín "Anh em văn phòng 🍻" không có sếp và nhóm "VibeCorp – Official" '
    + 'ai cũng nói chuyện rất lịch sự.',
};

// ---------------------------------------------------------------- dự án khách hàng
export const PROJECT_POOL: { name: string; client: string; desc: string }[] = [
  { name: 'App đặt lịch Spa Hương Sen', client: 'Chuỗi spa Hương Sen',
    desc: 'App đặt lịch, tích điểm, nhắc lịch hẹn cho 5 chi nhánh spa' },
  { name: 'Website nông sản Đà Lạt Xanh', client: 'HTX Nông sản Đà Lạt Xanh',
    desc: 'Website bán rau củ sạch, thanh toán QR, giao trong ngày' },
  { name: 'App gọi món quán Ba Khía', client: 'Quán nhậu Ba Khía Bé Tư',
    desc: 'Quét QR tại bàn gọi món, in phiếu xuống bếp, chia bill' },
  { name: 'Phần mềm quản lý nhà trọ', client: 'Anh Sáu chủ 3 dãy trọ',
    desc: 'Quản lý 60 phòng: tiền điện nước, hợp đồng, nhắc đóng tiền tự động' },
  { name: 'App luyện phát âm Little Star', client: 'Trung tâm Anh ngữ Little Star',
    desc: 'App luyện phát âm có chấm điểm, bảng xếp hạng cho học viên nhí' },
  { name: 'CRM đại lý bảo hiểm An Tâm', client: 'Đại lý bảo hiểm An Tâm',
    desc: 'Quản lý khách hàng, nhắc tái tục hợp đồng, báo cáo doanh số tuần' },
  { name: 'Cổng tuyển dụng Mây Mây Tea', client: 'Chuỗi trà sữa Mây Mây',
    desc: 'Tuyển nhân viên part-time cho 20 cửa hàng, duyệt CV nhanh' },
  { name: 'App đặt gas Phú Quý', client: 'Đại lý gas Phú Quý',
    desc: 'Đặt gas, theo dõi shipper, nhắc khách đổi bình định kỳ' },
  { name: 'Quản lý phòng khám Nụ Cười', client: 'Nha khoa Nụ Cười',
    desc: 'Đặt lịch, hồ sơ bệnh án điện tử, nhắc lịch tái khám' },
  { name: 'BánNhanh POS 3.0', client: 'Dự án nội bộ',
    desc: 'Nâng cấp bản SaaS: bán online, đồng bộ kho nhiều chi nhánh' },
  { name: 'App mầm non Hoa Mai', client: 'Trường mầm non Hoa Mai',
    desc: 'Phụ huynh xem điểm danh, thực đơn, hình ảnh của bé mỗi ngày' },
  { name: 'Web đặt sân pickleball Sân Xanh', client: 'Cụm sân pickleball Sân Xanh',
    desc: 'Đặt sân theo giờ, ghép trận, thanh toán QR' },
  { name: 'Hệ thống bán vé xe Hồng Phúc', client: 'Nhà xe Hồng Phúc',
    desc: 'Đặt vé online, chọn ghế, quản lý chuyến tuyến Sài Gòn – Đà Lạt' },
  { name: 'App tích điểm cà phê Góc Phố', client: 'Chuỗi cà phê Góc Phố',
    desc: 'Thẻ thành viên, tích điểm đổi ly, đồng bộ với BánNhanh POS' },
];

// ---------------------------------------------------------------- chủ đề tám chuyện
export type TopicCategory = 'doi_song' | 'cong_viec_dev' | 'cong_viec_sales' | 'van_phong' | 'drama'
  | 'giai_tri' | 'tien_bac' | 'tinh_cam' | 'cong_nghe' | 'an_uong';

export const TOPIC_CATEGORIES: TopicCategory[] = [
  'doi_song', 'cong_viec_dev', 'cong_viec_sales', 'van_phong', 'drama',
  'giai_tri', 'tien_bac', 'tinh_cam', 'cong_nghe', 'an_uong',
];

export const TOPIC_SEEDS: Record<TopicCategory, string[]> = {
  doi_song: [
    'kẹt xe ở vòng xoay sáng nay', 'tiền thuê trọ lại tăng', 'mưa ngập phải lội nước đi làm',
    'kế hoạch đi Vũng Tàu cuối tuần', 'mẹ ở quê hối cưới', 'nuôi mèo mà mèo phá nát nhà',
    'tập pickleball cho giảm cân', 'xe xẹp lốp giữa đường', 'chung cư cúp nước cả buổi sáng',
    'đi khám răng tốn nửa tháng lương', 'hàng xóm hát karaoke tới khuya', 'kế hoạch về quê ăn Tết',
    'chạy bộ buổi sáng được ba hôm thì bỏ', 'đăng ký học lái ô tô', 'skincare buổi tối lười làm',
    'son mới mua đánh đi làm có lố không',
  ],
  cong_viec_dev: [
    'ai đó push thẳng lên main', 'bug chỉ xảy ra trên máy khách', 'merge conflict 300 dòng',
    'deploy chiều thứ Sáu', 'đống code cũ không ai dám đụng', 'khách đổi yêu cầu lần thứ năm',
    'test case không ai chịu viết', 'database chạy chậm như rùa', 'nhờ AI viết code xong không ai hiểu',
    'quên đổi biến môi trường production', 'ước lượng hai ngày mà làm hai tuần', 'PR dài 50 file chờ review',
    'API bên thứ ba trả lỗi 500', 'log lỗi dài như sớ',
  ],
  cong_viec_sales: [
    'khách đòi giảm giá 30%', 'khách hẹn mai ký rồi biến mất', 'demo BánNhanh POS bị đứng giữa chừng',
    'chỉ tiêu doanh số tháng này', 'khách hỏi phần mềm có AI không', 'gọi 50 cuộc được một người nghe',
    'khách nhắn tin lúc 11 giờ đêm', 'gửi nhầm báo giá cho khách khác', 'lỡ hứa tính năng chưa có',
    'chủ quán trà sữa đòi dùng thử thêm tháng nữa', 'tiền hoa hồng chưa về', 'đối thủ phá giá phần mềm',
    'đi gặp khách dưới trời 37 độ',
  ],
  van_phong: [
    'máy lạnh văn phòng lạnh như tủ đông', 'máy in kẹt giấy', 'ai lấy hộp sữa chua trong tủ lạnh',
    'thang máy tòa nhà lại hỏng', 'wifi chập chờn', 'ghế ngồi lâu đau lưng',
    'họp xong không ai nhớ kết luận', 'chấm công bằng khuôn mặt mới lắp', 'mùi mì gói ở pantry',
    'team building năm nay đi đâu', 'tiệc cuối năm', 'phòng nhân sự phát phiếu khảo sát',
    'chậu cây trong văn phòng sắp chết khô', 'bàn ai bừa nhất văn phòng',
  ],
  drama: [
    'ai đó được tăng lương bí mật', 'có người sắp nộp đơn nghỉ việc', 'hai người hay đi cà phê riêng',
    'ai đó bị gọi lên phòng sếp', 'tin đồn công ty sắp cắt giảm', 'ai đó đăng story than mệt rồi xóa',
    'có người lén đi phỏng vấn chỗ khác', 'ai ăn vụng bánh sinh nhật', 'ai mách sếp chuyện đi trễ',
    'thưởng Tết năm nay', 'người mới được ưu ái', 'ai đổi hình nền điện thoại thành hình cặp đôi',
  ],
  giai_tri: [
    'phim bộ Hàn mới ra', 'trend TikTok tuần này', 'concert cuối tuần', 'trận bóng đá tối qua',
    'game mobile mới ra', 'bài hát đang viral', 'phim chiếu rạp cuối tuần', 'phiên livestream bán hàng xuyên đêm',
    'meme mới trên mạng', 'show hẹn hò trên tivi', 'clip hài văn phòng đang hot', 'vlog du lịch Đà Lạt săn mây',
  ],
  tien_bac: [
    'giá vàng lại tăng', 'lương về là hết', 'đầu tư crypto bị lỗ', 'chứng khoán xanh đỏ thất thường',
    'mua nhà ở Sài Gòn', 'tiết kiệm theo kiểu 6 hũ', 'trả góp điện thoại mới', 'thưởng tháng 13',
    'tiền điện tháng này', 'đi chợ hết 500 nghìn', 'lãi suất gửi tiết kiệm', 'làm thêm freelance cuối tuần',
    'mùa cưới tốn tiền mừng', 'giỏ hàng online chờ ngày sale', 'mã freeship cuối tháng',
  ],
  tinh_cam: [
    'đi xem mắt do mẹ sắp xếp', 'crush seen mà không rep', 'người yêu cũ có người mới', 'mùa cưới của bạn bè',
    'thử app hẹn hò', 'bị hỏi bao giờ cưới', 'chọn quà kỷ niệm', 'yêu xa', 'ế lâu năm',
    'người yêu giận vì trả lời tin nhắn chậm', 'crush làm cùng tòa nhà', 'đi đám cưới một mình',
  ],
  cong_nghe: [
    'điện thoại mới ra mắt', 'AI làm thay việc văn phòng', 'đổi laptop mới', 'bàn phím cơ switch mới',
    'tin nhắn lừa đảo giả ngân hàng', 'xe máy điện', 'đồng hồ thông minh đếm bước chân', 'tai nghe chống ồn',
    'tiền thuê cloud tăng', 'mật khẩu wifi mới', 'app ngân hàng bảo trì đúng ngày lương', 'kính thực tế ảo',
    'review sạc dự phòng mua trên mạng', 'món đồ công nghệ mới trên kệ phòng trưng bày', 'chuột không dây hết pin giữa buổi',
  ],
  an_uong: [
    'cơm tấm đầu hẻm', 'trà sữa size L', 'quán bún bò mới mở', 'ăn kiêng low-carb', 'đặt đồ ăn trưa có freeship',
    'bánh mì chảo', 'lẩu Thái tối thứ Sáu', 'cà phê muối', 'quán ốc vỉa hè', 'hộp cơm mẹ nấu', 'mì cay cấp 7',
    'chè Thái', 'bánh tráng trộn',
  ],
};

const SEED_CATEGORY = new Map<string, TopicCategory>();
for (const cat of TOPIC_CATEGORIES) for (const s of TOPIC_SEEDS[cat]) SEED_CATEGORY.set(s.toLowerCase(), cat);

/** Seed thuộc nhóm nào (undefined nếu không phải seed có sẵn) */
export function topicCategoryOf(seed: string): TopicCategory | undefined {
  return SEED_CATEGORY.get(seed.trim().toLowerCase());
}

/**
 * Chọn ngẫu nhiên 1 chủ đề. `exclude` có thể là các seed vừa dùng hoặc cả các câu tóm tắt gần đây:
 * seed bị loại nếu trùng hoặc nằm trong một chuỗi exclude. Hết chủ đề thì bỏ qua exclude.
 */
export function pickTopic(categories?: TopicCategory[], exclude?: string[]): string {
  const cats = (categories && categories.length ? categories : TOPIC_CATEGORIES).filter((c) => TOPIC_SEEDS[c]);
  let pool = cats.flatMap((c) => TOPIC_SEEDS[c]);
  if (!pool.length) pool = TOPIC_CATEGORIES.flatMap((c) => TOPIC_SEEDS[c]);
  const ex = (exclude ?? []).filter((e) => typeof e === 'string' && e).map((e) => e.toLowerCase());
  const fresh = ex.length ? pool.filter((s) => {
    const k = s.toLowerCase();
    return !ex.some((e) => e === k || e.includes(k));
  }) : pool;
  const src = fresh.length ? fresh : pool;
  return src[Math.floor(Math.random() * src.length)];
}

// ---------------------------------------------------------------- sếp đi vắng
export const BOSS_AWAY_REASONS: string[] = [
  'đi đánh golf với đối tác',
  'họp với nhà đầu tư',
  'đi gặp đối tác ở quán cà phê sân vườn',
  'đi khám sức khỏe định kỳ (lần thứ ba trong tháng)',
  'đi dự hội thảo chuyển đổi số',
  'ra ngân hàng ký giấy tờ',
  'đi đón con tan học',
  'ra sân tập golf "thư giãn đầu óc"',
  'đi ăn trưa với khách VIP',
  'đi xem đất ở ngoại thành',
  'mang xe đi rửa',
  'đi cà phê "networking" với hội doanh nhân',
  'đi chụp hình cho tạp chí doanh nhân',
  'đi đám cưới con của đối tác',
  'đi họp phụ huynh cho con',
  'đi mua quà kỷ niệm cho vợ',
  'đi gặp khách mà không nói khách nào',
];

// ---------------------------------------------------------------- nhãn hoạt động
/** Hoạt động "lười tại bàn" (sếp bắt được). Mỗi cái một emoji đơn. 😴 dành cho ngủ gật, không dùng ở đây. */
export const SLACK_ACTIVITIES: { label: string; emote: string }[] = [
  { label: 'lướt TikTok', emote: '📱' },
  { label: 'săn sale Shopee', emote: '🛒' },
  { label: 'chơi game', emote: '🎮' },
  { label: 'chat với crush', emote: '💬' },
  { label: 'xem phim', emote: '📺' },
  { label: 'đọc báo', emote: '📰' },
  { label: 'xem bóng đá', emote: '⚽' },
  { label: 'xem chứng khoán', emote: '📈' },
  { label: 'xem livestream bán hàng', emote: '🛍️' },
  { label: 'xem giá vàng', emote: '💰' },
  { label: 'xem video mèo', emote: '🐱' },
  { label: 'đặt trà sữa', emote: '🧋' },
  { label: 'xem giá coin', emote: '🪙' },
  { label: 'chỉnh ảnh sống ảo', emote: '🤳' },
];

/** Nhãn + emoji gợi ý cho từng Activity (World chọn ngẫu nhiên 1 biến thể). */
export const ACTIVITY_FLAVOR: Partial<Record<Activity, { label: string; emote: string }[]>> = {
  offsite: [{ label: 'không ở văn phòng', emote: '🏠' }],
  arriving: [
    { label: 'vừa tới văn phòng', emote: '👋' },
    { label: 'vừa gửi xe xong', emote: '🛵' },
    { label: 'cầm ly cà phê đi vào', emote: '☕' },
  ],
  leaving: [
    { label: 'xách balo ra về', emote: '🎒' },
    { label: 'tan làm', emote: '👋' },
    { label: 'chạy về cho kịp giờ kẹt xe', emote: '🏃' },
  ],
  working: [
    { label: 'đang làm việc', emote: '💻' },
    { label: 'tập trung cao độ', emote: '🎯' },
    { label: 'chạy deadline', emote: '⏰' },
  ],
  slacking: SLACK_ACTIVITIES,
  napping: [
    { label: 'ngủ gật', emote: '😴' },
    { label: 'gục mặt xuống bàn', emote: '😴' },
    { label: 'chợp mắt "5 phút"', emote: '😴' },
  ],
  coffee: [
    { label: 'pha cà phê', emote: '☕' },
    { label: 'làm ly bạc xỉu', emote: '☕' },
    { label: 'pha cà phê sữa đá', emote: '☕' },
    { label: 'chờ máy pha cà phê', emote: '☕' },
  ],
  water: [
    { label: 'đi lấy nước', emote: '🥤' },
    { label: 'rót nước lọc', emote: '🥤' },
    { label: 'uống nước cho đủ 2 lít', emote: '💧' },
  ],
  snack: [
    { label: 'lục tủ lạnh', emote: '🍪' },
    { label: 'ăn vặt', emote: '🍪' },
    { label: 'bóc bịch bánh tráng trộn', emote: '🍪' },
    { label: 'ăn ké bánh trên kệ', emote: '🍪' },
  ],
  toilet: [
    { label: 'đi vệ sinh', emote: '🚽' },
    { label: 'đi rửa mặt cho tỉnh', emote: '🚽' },
  ],
  pingpong: [
    { label: 'đánh bóng bàn', emote: '🏓' },
    { label: 'luyện cú giật bóng', emote: '🏓' },
  ],
  chill: [
    { label: 'nằm sofa', emote: '🛋️' },
    { label: 'ngồi bean bag', emote: '🛋️' },
    { label: 'xem TV ké', emote: '📺' },
  ],
  window: [
    { label: 'gọi điện cho khách', emote: '📞' },
    { label: 'nghe điện thoại', emote: '📞' },
    { label: 'hóng gió bên cửa sổ', emote: '🌬️' },
    { label: 'ngắm phố cho đỡ mỏi mắt', emote: '🌬️' },
  ],
  showroom: [
    { label: 'ngắm đồ ở phòng trưng bày', emote: '🛍️' },
    { label: 'săm soi kệ công nghệ', emote: '🛍️' },
    { label: 'ngó kệ làm đẹp', emote: '🛍️' },
    { label: 'đọc nhận xét trên kệ trưng bày', emote: '🛍️' },
    { label: 'cân nhắc có nên chốt đơn', emote: '🛍️' },
    { label: 'cầm lên bỏ xuống món trên kệ', emote: '🛍️' },
  ],
  printing: [
    { label: 'in tài liệu', emote: '🖨️' },
    { label: 'chờ máy in', emote: '🖨️' },
    { label: 'gỡ giấy kẹt máy in', emote: '🖨️' },
  ],
  lunch: [
    { label: 'ăn trưa', emote: '🍜' },
    { label: 'ăn cơm hộp', emote: '🍱' },
    { label: 'ăn bún bò', emote: '🍜' },
    { label: 'ăn cơm tấm', emote: '🍛' },
  ],
  meeting: [
    { label: 'đang họp', emote: '📝' },
    { label: 'họp online với khách', emote: '🎥' },
  ],
  scene: [{ label: 'đang nói chuyện', emote: '💬' }],
  boss_office: [
    { label: 'ngồi phòng riêng', emote: '📊' },
    { label: 'xem báo cáo', emote: '📊' },
    { label: 'tập putt golf trong phòng', emote: '⛳' },
    { label: 'gọi điện cho đối tác', emote: '📞' },
  ],
  patrol: [
    { label: 'đi tuần một vòng', emote: '👀' },
    { label: 'đi dạo "kiểm tra tinh thần"', emote: '👀' },
  ],
  away: [{ label: 'đi vắng', emote: '🏌️' }],
  server_fix: [
    { label: 'cứu server', emote: '🔥' },
    { label: 'rollback khẩn cấp', emote: '🔥' },
  ],
  idle: [{ label: 'vươn vai', emote: '🙆' }],
};

// =====================================================================
//  V3 — câu chuyện tự phát triển (docs/v3-news.md)
// =====================================================================

// ---------------------------------------------------------------- thực đơn "biến" cho AI biên kịch (showrunner)
/** Mỗi loại biến = 1 dòng mô tả ngắn để AI chọn; Director ánh xạ sang cảnh/sự kiện cụ thể (src/sim/story.ts). */
export const BEAT_MENU: { kind: string; desc: string }[] = [
  { kind: 'conflict', desc: 'hai người bất đồng về công việc (a ↔ b), căng dần rồi làm hoà hoặc giữ khoảng cách' },
  { kind: 'viral', desc: 'clip/bài đăng của a bất ngờ lên xu hướng, cả công ty xôn xao, sếp khen' },
  { kind: 'big_bug', desc: 'QA (a) phát hiện bug lớn của dev (b) ngay trước deadline, cả team cuống' },
  { kind: 'client_angry', desc: 'khách hàng nổi giận với sales (a), sếp gọi lên hỏi, áp lực lan sang dev' },
  { kind: 'secret_friendship', desc: 'a và b bỗng thân nhau bất ngờ (cùng sở thích), đồng nghiệp bắt đầu để ý' },
  { kind: 'crush_rumor', desc: 'tin đồn nhẹ nhàng rằng a thích b (trong sáng, không bao giờ nói chuyện thân mật quá mức)' },
  { kind: 'raise_request', desc: 'a đang làm tốt và muốn xin tăng lương với sếp (chỉ khi KPI thật sự cao)' },
  { kind: 'resign_threat', desc: 'a chán việc, úp mở chuyện nghỉ; HR để ý và mời nói chuyện (chỉ khi a đang buồn thật)' },
  { kind: 'boss_mood_swing', desc: 'sếp hôm nay khó ở: đi tuần nhiều, mắng gắt hơn, cả phòng nín thở ~2 giờ' },
  { kind: 'team_building', desc: 'công ty tổ chức hoạt động gắn kết nhỏ (trà sữa, trò chơi) ở góc chill' },
  { kind: 'new_client_deal', desc: 'sales (a) chốt hợp đồng mới, doanh thu tăng, mọi người đòi khao' },
  { kind: 'overtime_week', desc: 'team dev phải tăng ca 3 ngày vì tiến độ, than thở nhưng vẫn làm' },
  { kind: 'office_prank', desc: 'a chơi khăm b (vô hại: đổi hình nền, dán giấy, giấu chuột), cả phòng cười' },
  { kind: 'lost_item', desc: 'a làm mất một món đồ (sạc, thẻ từ, cốc), đi hỏi khắp văn phòng rồi tìm thấy chỗ bất ngờ' },
  { kind: 'sick_day', desc: 'a ốm bất chợt, xin về sớm hoặc nghỉ, đồng nghiệp gánh việc' },
  { kind: 'karaoke_night', desc: 'cả nhóm rủ đi karaoke tối nay, mai vài người tới trễ mắt thâm quầng' },
  { kind: 'pitch_contest', desc: 'sếp bất ngờ tổ chức buổi "pitch ý tưởng": mỗi người trình bày 1 ý tưởng trời ơi' },
];

export const BEAT_KINDS: string[] = BEAT_MENU.map((b) => b.kind);

/**
 * Điền tên người vào mô tả thực đơn biến: `a` / `b` đứng một mình (kể cả "(a)", "a ↔ b") → tên; không có tên → "ai đó" / "người kia".
 * Ranh giới từ theo Unicode để không đụng "bà", "bài", "Bảo"… Dùng cho ghi chú offline / khi AI bỏ trống `note`.
 */
export function fillBeatDesc(desc: string, aName?: string, bName?: string): string {
  return String(desc ?? '')
    .replace(/(?<![\p{L}\p{N}_])a(?![\p{L}\p{N}_])/gu, aName?.trim() || 'ai đó')
    .replace(/(?<![\p{L}\p{N}_])b(?![\p{L}\p{N}_])/gu, bName?.trim() || 'người kia');
}

// ---------------------------------------------------------------- sự kiện cá nhân ngẫu nhiên (hiếm, có log để người xem hiểu)
export interface PersonalEvent {
  icon: string;
  /** {name} = tên người */
  text: string;
  mood: number;
  kpi: number;
  stress: number;
  memory: string;
  weight: number;
  /** chỉ xảy ra với vai trò này (mặc định: ai cũng được) */
  roles?: RoleKey[];
}

export const PERSONAL_EVENTS: PersonalEvent[] = [
  { icon: '🤒', text: '{name} sáng nay hơi sốt, uống thuốc rồi vẫn cố đi làm', mood: -8, kpi: -20, stress: 8, memory: 'Hôm nay bị sốt mà vẫn đi làm', weight: 1.2 },
  { icon: '🛵', text: '{name} kẹt xe gần một tiếng, tới văn phòng mặt mũi phờ phạc', mood: -6, kpi: -10, stress: 6, memory: 'Sáng nay kẹt xe gần một tiếng', weight: 1.4 },
  { icon: '💔', text: 'Nghe đâu {name} vừa chia tay người yêu, cả ngày lặng lẽ khác thường', mood: -14, kpi: -15, stress: 10, memory: 'Vừa chia tay, chẳng muốn nói chuyện với ai', weight: 0.7 },
  { icon: '😡', text: '{name} vừa bị một khách hàng mắng oan qua điện thoại', mood: -9, kpi: -5, stress: 12, memory: 'Bị khách mắng oan qua điện thoại', weight: 1.0, roles: ['saleslead', 'salesnew', 'marketing', 'hr'] },
  { icon: '🎟️', text: '{name} trúng vé số nhỏ, bao cả phòng trà sữa', mood: 14, kpi: 5, stress: -8, memory: 'Trúng vé số nhỏ, bao trà sữa cả phòng', weight: 0.5 },
  { icon: '☕', text: '{name} ngủ không đủ vì cày phim tới 3 giờ sáng, mắt như gấu trúc', mood: -4, kpi: -12, stress: 4, memory: 'Cày phim tới 3 giờ sáng, hôm nay đuối', weight: 1.3 },
  { icon: '🏠', text: 'Nhà {name} cúp nước từ sáng, tới công ty mới được rửa mặt', mood: -5, kpi: -6, stress: 5, memory: 'Nhà cúp nước cả buổi sáng', weight: 0.9 },
  { icon: '🎉', text: '{name} vừa được bạn thân rủ đi đám cưới, vui cả ngày', mood: 10, kpi: 4, stress: -5, memory: 'Sắp được đi đám cưới bạn thân', weight: 0.8 },
  { icon: '📱', text: '{name} làm rơi điện thoại nứt màn hình, buồn thiu', mood: -8, kpi: -8, stress: 6, memory: 'Làm rơi điện thoại, nứt màn hình', weight: 0.9 },
  { icon: '🐱', text: 'Mèo nhà {name} ốm, sáng nay phải chở đi bác sĩ thú y', mood: -6, kpi: -10, stress: 7, memory: 'Mèo ốm, phải đưa đi bác sĩ thú y', weight: 0.8 },
  { icon: '💪', text: '{name} hôm nay ngủ đủ, tập thể dục xong, năng lượng tràn trề', mood: 8, kpi: 15, stress: -6, memory: 'Hôm nay tỉnh táo lạ thường', weight: 1.1 },
  { icon: '🍜', text: '{name} ăn sáng trúng gì đó, đau bụng chạy toilet mấy lần', mood: -7, kpi: -14, stress: 6, memory: 'Đau bụng từ sáng, chắc tại quán bún', weight: 0.9 },
];

// ---------------------------------------------------------------- thời sự: nhãn nhóm, sở thích, hạt giống phản ứng
export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  the_thao: 'thể thao', bong_da: 'bóng đá', cong_nghe: 'công nghệ', game: 'game', khoa_hoc: 'khoa học', giai_tri: 'giải trí',
};

export const NEWS_CATEGORIES: NewsCategory[] = ['the_thao', 'bong_da', 'cong_nghe', 'game', 'khoa_hoc', 'giai_tri'];

/**
 * Ai hợp bàn tin nhóm nào: từ khoá trong likes/quirks/bio + vai trò + id gốc trong roster.
 * Người không khớp gì vẫn có thể được chọn ngẫu nhiên (trọng số nền).
 */
export const NEWS_INTEREST: Record<NewsCategory, { keywords: string[]; roles: Partial<Record<RoleKey, number>>; ids: Record<string, number> }> = {
  the_thao: {
    keywords: ['bóng', 'thể thao', 'pickleball', 'chạy bộ', 'gym', 'tennis', 'bơi', 'đá banh'],
    roles: { saleslead: 1.2, senior: 0.6, boss: 0.6 }, ids: { phat: 1.6, tung: 0.6, hung: 0.6 },
  },
  bong_da: {
    keywords: ['bóng đá', 'đá banh', 'ngoại hạng', 'champions', 'world cup', 'v-league', 'tuyển', 'mu', 'real', 'barca'],
    roles: { saleslead: 1.4, boss: 0.7, senior: 0.5, junior: 0.4 }, ids: { phat: 2.0, hung: 0.7, tung: 0.5 },
  },
  cong_nghe: {
    keywords: ['bàn phím', 'code', 'laptop', 'điện thoại', 'ai', 'công nghệ', 'máy tính', 'crypto', 'gadget', 'tai nghe'],
    roles: { techlead: 1.4, senior: 1.0, junior: 0.8, qa: 0.9, designer: 0.5 }, ids: { khoa: 1.8, vy: 1.0, tung: 0.9, bao: 0.6 },
  },
  game: {
    keywords: ['game', 'rank', 'anime', 'esport', 'liên quân', 'valorant', 'steam', 'crypto', 'coin'],
    roles: { junior: 1.4, salesnew: 1.2, senior: 1.0, qa: 0.4 }, ids: { bao: 1.8, tung: 1.6, tu: 1.2 },
  },
  khoa_hoc: {
    keywords: ['khoa học', 'vũ trụ', 'trinh thám', 'sách', 'thiên văn', 'sinh học', 'y học', 'sen đá', 'cây'],
    roles: { qa: 1.2, techlead: 0.8, designer: 0.4, hr: 0.3 }, ids: { vy: 1.6, khoa: 0.8 },
  },
  giai_tri: {
    keywords: ['phim', 'nhạc', 'trend', 'tiktok', 'show', 'concert', 'thời trang', 'son', 'idol', 'kpop', 'drama'],
    roles: { marketing: 1.5, designer: 1.2, hr: 0.6, salesnew: 0.6 }, ids: { tram: 1.8, linh: 1.6, ngoc: 0.5, tu: 0.5 },
  },
};

/**
 * Hạt giống phản ứng theo nhóm tin (cảm nghĩ/ý kiến, KHÔNG thêm sự thật): Director gắn 1 câu vào tình huống để
 * thoại đa dạng mà vẫn an toàn. Dùng cả cho offline.
 */
export const NEWS_REACTION_SEEDS: Record<NewsCategory, string[]> = {
  the_thao: [
    'một người hào hứng kể như mình vừa xem trực tiếp, người kia chỉ hỏi "rồi ai thắng"',
    'so sánh với hồi đi đá banh phủi, rồi rủ nhau tập lại cho đỡ bụng bia',
    'cá cược trà sữa về kết quả sắp tới (chỉ đoán, không chắc gì)',
  ],
  bong_da: [
    'fan hai đội khịa nhau, người không xem bóng đá đứng giữa ngáp dài',
    'bàn chuyện thức đêm xem bóng rồi sáng đi làm gật gù',
    'rủ nhau tối nay ra quán xem chung, bàn ai trả tiền nước',
  ],
  cong_nghe: [
    'dev chê "lại ra mắt cái cũ dán nhãn mới", người ngoài ngành lại thấy xịn',
    'bàn xem có nên lên đời đồ không, kết luận "đợi sale rồi tính"',
    'liên hệ sang chuyện công ty mình: "giá mà server mình xịn được vậy"',
  ],
  game: [
    'hai người bàn như chuyên gia, người thứ ba tưởng đang nói về phim',
    'than đời game thủ lúa non: tiền đâu mà nạp, rồi vẫn nạp',
    'rủ nhau tối lập team, ai cũng hứa rồi không ai online',
  ],
  khoa_hoc: [
    'một người thú nhận đọc tiêu đề mà không hiểu gì, người kia cũng không hơn, cả hai cười trừ rồi quay về việc',
    'liên tưởng sang chuyện trần tục: giá điện, thời tiết, bữa trưa',
    'cảm thán "con người giỏi thật" rồi quay lại than việc của mình',
  ],
  giai_tri: [
    'người mê thì kể say sưa, người không quan tâm chỉ hỏi "ai vậy"',
    'bàn gu phim/nhạc của nhau, khịa nhẹ, không nói xấu người thật',
    'rủ cuối tuần đi xem/đi nghe, rồi tính tiền vé mà chùn bước',
  ],
};

/**
 * Lọc chặn dự phòng (module tin của sim engineer đã lọc kỹ; đây là lớp bảo hiểm thứ hai, chỉ dùng cụm từ
 * ít khi gây nhầm lẫn — vd không dùng "án" vì trùng "dự án", không dùng "kiện" vì trùng "sự kiện").
 */
export const NEWS_BLOCK_PHRASES: string[] = [
  'khởi tố', 'bắt giữ', 'bắt tạm giam', 'lãnh án', 'phạt tù', 'truy nã', 'ma túy', 'ma tuý', 'giết người', 'hiếp dâm', 'lừa đảo',
  'tự tử', 'tự sát', 'tử vong', 'thiệt mạng', 'tai nạn', 'thi thể', 'bạo hành', 'xâm hại', 'đánh bạc', 'cá độ', 'tham nhũng',
  'hối lộ', 'chính trị', 'bộ trưởng', 'thủ tướng', 'chủ tịch nước', 'quốc hội', 'tôn giáo', 'biểu tình', 'chiến tranh', 'khủng bố',
  'ly hôn', 'ngoại tình', 'khởi kiện', 'bị kiện', 'tòa án', 'toà án', 'tố cáo', 'bóc phốt', 'scandal', 'tình dục', 'lộ clip',
  'ung thư', 'qua đời', 'đột tử', 'hành hung', 'cháy nhà', 'lũ quét', 'động đất',
];

/**
 * Lớp bảo hiểm thứ hai của Director (tin lấy từ kho / state cũ): cụm từ riêng ở trên + toàn bộ danh sách chặn, đời tư và
 * mẫu "X tố Y" / "kiện" của src/news/filter.ts — hai lớp luôn đồng bộ, không cần chép tay.
 */
export function newsBlocked(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  if (NEWS_BLOCK_PHRASES.some((p) => t.includes(p))) return true;
  try {
    return blockedTopic(normText(text ?? '')) !== null;
  } catch {
    return false;
  }
}

/** Nguyên tắc an toàn khi bàn tin thật — lặp lại trong tình huống của cảnh news_chat (ngắn, để prompt không phình). */
export const NEWS_SAFETY_RULES =
  'Chỉ bình luận cảm nghĩ/ý kiến cá nhân về tiêu đề + tóm tắt đã đăng trên báo ("nghe báo đăng…", "theo mình thì…"); '
  + 'KHÔNG bịa thêm chi tiết, con số, phát ngôn; không kết luận ai đúng/sai, không gán tội, không nói đời tư, '
  + 'không công kích người thật; được đùa về tình huống và về chính mình';
