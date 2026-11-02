// =====================================================================
//  Lọc an toàn cho tin thời sự (docs/v3-news.md — "Nguyên tắc an toàn").
//  Thuần logic, không mạng: chặn theo từ khoá (án, khởi tố, chính trị, ly hôn…), bỏ tin cũ,
//  giải trí chỉ giữ chủ đề nhẹ (phim, nhạc, show, gameshow, thời trang, trend, concert, MV).
//
//  So khớp theo RANH GIỚI TỪ, không phân biệt hoa/thường:
//   - từ đơn (không có khoảng trắng) so khớp CÓ dấu — tránh "án" ↔ "an toàn", "đảng" ↔ "đang", "tố" ↔ "to";
//   - cụm ≥ 2 từ so khớp KHÔNG dấu — bắt được tiêu đề viết không dấu ("khoi to", "ly hon").
// =====================================================================
import type { NewsItem } from '../types.js';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- chuẩn hoá chữ
/** Bỏ dấu tiếng Việt (đ → d) */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** chữ thường, NFC, gọn khoảng trắng — so khớp có dấu */
export const normExact = (s: string): string => squash(String(s ?? '').normalize('NFC').toLowerCase());
/** như normExact nhưng bỏ dấu — so khớp không dấu */
export const normLoose = (s: string): string => squash(stripDiacritics(String(s ?? '')).toLowerCase());

export interface NormText { exact: string; loose: string }
/** Chuẩn hoá một lần, dùng cho nhiều từ khoá */
export function normText(...parts: (string | undefined)[]): NormText {
  const raw = parts.filter((p): p is string => typeof p === 'string').join(' ');
  return { exact: normExact(raw), loose: normLoose(raw) };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map<string, RegExp>();
/** Regex khớp `needle` ở ranh giới từ (chữ/số Unicode hai bên không được dính liền) */
function wordRe(needle: string): RegExp {
  let re = reCache.get(needle);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u');
    if (reCache.size > 4000) reCache.clear();
    reCache.set(needle, re);
  }
  return re;
}

/**
 * Khớp 1 từ khoá theo ranh giới từ. Từ đơn so khớp CÓ dấu (tránh "án" ↔ "an", "đảng" ↔ "đang", "tố" ↔ "to").
 * Cụm ≥ 2 từ mà mọi tiếng đều ≥ 3 chữ cái so khớp KHÔNG dấu (bắt được tiêu đề viết không dấu: "khoi kien", "bat giu",
 * "tron thue"); cụm có tiếng ngắn ("bản án" → "ban an" trùng "bàn ăn", "đi tù" → "di tu") vẫn so khớp có dấu.
 */
export function matchKeyword(text: NormText, keyword: string): boolean {
  let kw = squash(String(keyword ?? ''));
  if (!kw) return false;
  // tiền tố '=' = LUÔN so khớp có dấu (cụm mà bản không dấu trùng cụm vô hại: "tự tử" ~ "từ từ", "hàng giả" ~ "hàng gia dụng",
  // "kỳ thị" ~ "kỳ thi", "nhà trắng" ~ "Nha Trang", "dương tính" ~ "đường tính", "bị thương" ~ "bi thương"…)
  const forceExact = kw.startsWith('=');
  if (forceExact) kw = kw.slice(1).trim();
  if (!kw) return false;
  const words = kw.split(' ');
  const loose = !forceExact && words.length >= 2 && words.every((w) => stripDiacritics(w).replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
  if (loose) return wordRe(normLoose(kw)).test(text.loose);
  return wordRe(normExact(kw)).test(text.exact);
}

/** Từ khoá đầu tiên khớp, hoặc null */
export function findKeyword(text: NormText, keywords: readonly string[]): string | null {
  for (const k of keywords) if (matchKeyword(text, k)) return k;
  return null;
}

/** Như findKeyword nhưng bỏ qua từ chặn nằm trong tên riêng / thành ngữ vô hại (BLOCK_EXCEPTIONS) */
export function findBlocked(text: NormText, keywords: readonly string[]): string | null {
  for (const k of keywords) {
    if (!matchKeyword(text, k)) continue;
    const exceptions = BLOCK_EXCEPTIONS[normExact(k.replace(/^=/, ''))];
    if (exceptions && exceptions.some((e) => matchKeyword(text, e))) continue;
    return k;
  }
  return null;
}

/** Mẫu regex (có dấu) đầu tiên khớp → nhãn ngắn để ghi lý do, hoặc null */
export function findPattern(text: NormText, patterns: readonly { re: RegExp; label: string }[]): string | null {
  for (const p of patterns) if (p.re.test(text.exact)) return p.label;
  return null;
}

/** Tin có đụng chủ đề cấm (BLOCKLIST + PRIVATE_LIFE + mẫu "X tố Y" / "kiện") không — dùng chung cho lớp lọc thứ hai của Director */
export function blockedTopic(text: NormText, extra?: readonly string[]): string | null {
  return findBlocked(text, BLOCKLIST) ?? findKeyword(text, PRIVATE_LIFE) ?? findPattern(text, BLOCK_PATTERNS)
    ?? findPattern(text, PRIVATE_PATTERNS) ?? (extra?.length ? findBlocked(text, extra) : null);
}

// ---------------------------------------------------------------- danh sách chặn
/**
 * Chủ đề không bao giờ bàn (pháp lý / chính trị / bạo lực / đời tư / sức khoẻ / tang sự).
 * Từ đơn so khớp có dấu, cụm từ so khớp không dấu — xem đầu file. Có thể thêm bằng NEWS_BLOCKLIST.
 */
export const BLOCKLIST: readonly string[] = [
  // pháp lý, tội phạm
  'vụ án', 'bản án', 'án tù', 'án mạng', 'trọng án', 'kết án', 'tuyên án', 'án phạt', 'khởi tố', 'bị can', 'bị cáo',
  'bắt giữ', 'bắt tạm giam', 'tạm giam', 'truy nã', 'truy tố', 'điều tra', 'ngồi tù', 'đi tù', 'phạt tù', 'tù giam',
  'tù nhân', 'tù chung thân', 'tù', 'khởi kiện', 'vụ kiện', 'bị kiện', 'kiện tụng', 'đơn kiện', 'tố cáo', 'tố giác', 'bị tố',
  'công an', 'cảnh sát', 'tòa án', 'toà án', 'ra tòa', 'ra toà', 'hầu tòa', 'hầu toà', 'lừa đảo', 'chiếm đoạt', 'ma túy',
  'ma tuý', 'buôn người', 'bắt cóc', 'cướp giật', 'vụ cướp', 'cướp ngân hàng', 'cướp tài sản', 'trộm cắp', 'vụ trộm', 'kẻ trộm',
  'cờ bạc', 'cá độ', 'bán độ', 'dàn xếp tỉ số', 'dàn xếp tỷ số', 'doping', 'trốn thuế', 'tham nhũng', 'hối lộ', 'rửa tiền',
  'gian lận', '=hàng giả', 'hàng cấm', 'con nghiện', 'nghiện ngập',
  // bạo lực, tai nạn, tang sự, sức khoẻ
  'giết', 'giết người', 'sát hại', 'hiếp', 'hiếp dâm', 'xâm hại', 'quấy rối', 'lạm dụng', 'bạo hành', 'bạo lực', 'hành hung',
  'đánh nhau', 'ẩu đả', 'đâm chém', 'nổ súng', 'xả súng', 'khủng bố', 'đánh bom', '=tự tử', '=tự sát', 'tai nạn', 'tử vong',
  'thiệt mạng', 'chết người', 'cái chết', 'qua đời', 'đột tử', 'tang lễ', 'thi thể', 'chết đuối', 'hỏa hoạn', 'hoả hoạn',
  'cháy nhà', 'thiên tai', 'lũ quét', 'động đất', 'ung thư', 'nhập viện', 'cấp cứu', 'bệnh viện', 'trầm cảm', 'đột quỵ',
  // chính trị, tôn giáo, xã hội nhạy cảm
  'chính trị', 'đảng', 'bộ trưởng', 'thủ tướng', 'tổng thống', 'chủ tịch nước', 'tổng bí thư', 'quốc hội', 'nghị sĩ',
  'bầu cử', 'tranh cử', 'tôn giáo', 'biểu tình', 'bạo loạn', 'chiến tranh', 'xung đột', 'quân sự', 'tên lửa', 'cấm vận',
  'trừng phạt', 'thuế quan', 'phân biệt chủng tộc', '=kỳ thị', 'đình công', 'phá sản', 'vỡ nợ',
  // đời tư, bê bối, nội dung người lớn
  'ly hôn', 'ly thân', 'ngoại tình', 'bóc phốt', 'phốt', 'scandal', 'bê bối', 'tình dục', 'mại dâm', 'khiêu dâm',
  'phim nóng', 'lộ clip', 'clip nóng', 'ảnh nóng', 'tố nhau', 'đấu tố',
  // --- bổ sung sau đợt rà soát 30 tiêu đề thật (bắt bớ, cáo buộc, kiện tụng, sa thải, chất cấm, tai nạn, tang sự…)
  'bị bắt', 'bắt khẩn cấp', 'bị tạm giữ', 'tạm giữ hình sự', 'bị khám xét', 'lệnh bắt', 'cáo buộc', 'bị nghi', 'nghi án', 'tình nghi',
  'nghi phạm', 'bị tố', 'lên tiếng tố', 'đứng ra tố', 'đăng đàn tố', 'quỵt', 'chủ nợ', 'đòi nợ', 'vay nợ', 'thắng kiện',
  'thua kiện', 'đâm đơn', 'nộp đơn kiện', 'bị khởi kiện', 'đệ đơn', 'lãnh án', 'ấu dâm', 'sa thải', 'từ chức', 'cách chức', 'đình chỉ',
  'chất cấm', '=dương tính', '=bị thương', 'thương vong', 'nguy kịch', 'bất tỉnh', 'hôn mê', 'giẫm đạp', 'vĩnh biệt', 'từ trần',
  '=tiếc thương', 'tiễn biệt', 'đột ngột ra đi', 'ra đi đột ngột', 'ra đi mãi mãi', 'vĩnh viễn ra đi', 'ra đi vĩnh viễn', 'ra đi ở tuổi',
  'đâm chết', 'người chết', '=không kích', 'pháo kích', 'tấn công khủng bố', 'bắn chết', 'nổ bom', 'bị phát tán', 'phát tán clip',
  'khoi to', 'ly hon', 'bi bat', 'bi to', // tiêu đề viết không dấu (cụm có tiếng 2 chữ không được so khớp không dấu tự động)
  // chính trị / xung đột quốc tế (tên người và cơ quan hay xuất hiện trong tin công nghệ, game)
  'trump', 'putin', 'zelensky', 'netanyahu', 'tập cận bình', 'kim jong-un', 'kim jong un', '=nhà trắng', 'lầu năm góc', 'điện kremlin',
  'kremlin', 'nato', 'gaza', 'hamas', 'thượng viện', 'hạ viện', 'nghị viện', '=nội các', '=bí thư', 'bộ chính trị', 'đánh thuế', 'lệnh cấm',
  'giáo hoàng', 'vatican',
  // cơ thể / nội dung người lớn / xung đột cá nhân
  'hôn nhân', 'rạn nứt', 'tiểu tam', 'đánh ghen', '=thất tình', 'khoe vòng 1', 'vòng 1 khủng', 'vòng 1 đẫy', 'vòng 1 căng', 'lộ vòng 1',
  'vòng 1 đồ sộ', 'vòng 1 ngoại cỡ', 'vòng 1 phồn thực', '=lộ hàng', 'thả rông', '=thiếu vải', 'clip nhạy cảm', 'ảnh nhạy cảm',
  'hình ảnh nhạy cảm', 'video nhạy cảm', 'cảnh nhạy cảm', '=cảnh nóng', 'nội y', 'xuyên thấu', 'khỏa thân', 'khoả thân', 'bán nude',
  'nude', 'sàm sỡ', 'tẩy chay', 'miệt thị', 'giang hồ', 'khoe súng', 'bệnh hiếm', 'bệnh nặng', 'bạo bệnh',
  // lời nói / hành vi nhắm vào người khác (chỉ con người mới "phát ngôn", "trêu chọc", "chế giễu" nhau)
  'phát biểu gây tranh cãi', 'phát ngôn gây tranh cãi', 'phát ngôn gây sốc', 'phát ngôn sốc', 'phát biểu sốc', 'phát ngôn lệch chuẩn',
  'phát ngôn miệt thị', 'trêu chọc', 'chế giễu', 'chế nhạo', 'giễu cợt', 'mỉa mai', 'xúc phạm', 'lăng mạ', 'vu khống', 'bôi nhọ',
];

/**
 * Ngoại lệ: từ chặn xuất hiện trong một tên riêng / thành ngữ vô hại (câu lạc bộ "Công An Hà Nội"; thủ môn "bắt gọn" cú sút;
 * đội bóng "bị bắt bài"). Chỉ vô hiệu đúng từ khoá đó; các từ chặn khác trong tin vẫn có hiệu lực.
 */
export const BLOCK_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  'công an': ['công an hà nội', 'công an tp.hcm', 'công an tp hcm', 'công an thành phố', 'clb công an', 'câu lạc bộ công an', 'cahn'],
  'bị bắt': ['bị bắt bài', 'bị bắt gọn', 'bị bắt dính', 'bị bắt việt vị', 'bị bắt lỗi', 'bị bắt kịp', 'bị bắt chẹt', 'bị bắt thóp', 'bị bắt nhịp'],
  'đình chỉ': ['đình chỉ thi đấu', 'đình chỉ trận', 'đình chỉ giải'],
  'nude': ['nude look', 'tông nude', 'màu nude', 'son nude', 'tone nude'],
};

/**
 * Mẫu regex (so khớp có dấu, chữ thường) cho những chữ không thể liệt kê hết bằng cụm từ:
 *  - "X tố Y" (tố = cáo buộc) nhưng không phải yếu tố / nhân tố / sắc tố / nguyên tố / độc tố / tố chất / tố tụng;
 *  - "kiện" (kiện tụng) nhưng không phải sự kiện / điều kiện / linh kiện / phụ kiện / bưu kiện / dữ kiện / kiện hàng / kiện tướng.
 */
export const BLOCK_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /(?<![\p{L}\p{N}])(?<!(?:yếu|nhân|sắc|nguyên|độc|kháng|màu|men|hồng)\s)tố(?!\s+(?:chất|tụng|hữu|như|nga|uyên|loan|quyên|tâm)(?![\p{L}\p{N}]))(?![\p{L}\p{N}])/u, label: 'tố' },
  { re: /(?<![\p{L}\p{N}])(?<!(?:sự|điều|linh|phụ|bưu|dữ|chứng)\s)kiện(?!\s+(?:hàng|tướng)(?![\p{L}\p{N}]))(?![\p{L}\p{N}])/u, label: 'kiện' },
];

/**
 * Đời tư / cơ thể của người thật — không bàn, ở MỌI nhóm tin (trang game cũng đăng "hot girl", trang thể thao bàn vóc dáng cầu thủ).
 * Tên cũ SHOWBIZ_PRIVATE giữ để tương thích.
 */
export const PRIVATE_LIFE: readonly string[] = [
  'hẹn hò', 'quấn quýt', 'tình cũ', 'tình mới', 'bạn trai', 'bạn gái', 'người yêu', 'chia tay', 'tái hợp', 'tình ái',
  'tình tin đồn', 'đời tư', 'mang thai', 'sinh con', 'đón con', 'đám cưới', 'kết hôn', 'lễ cưới', 'sắp cưới', 'lấy chồng',
  'lấy vợ', 'đón tuổi', 'ở tuổi', 'sức khỏe', 'sức khoẻ', 'giảm cân', 'tăng cân', 'giữ dáng', 'vóc dáng', 'sắc vóc',
  'thân hình', 'vòng eo', 'khoe vòng một', 'vòng một khủng', 'vòng một đẫy', 'lộ vòng một', 'vòng một căng', 'vòng một đồ sộ', 'số đo', 'nhan sắc', 'phẫu thuật', 'dao kéo', 'bikini', 'nóng bỏng', 'bỏng mắt', 'hở bạo',
  'gợi cảm', 'quyến rũ', 'sexy', 'khoe thân', 'khoe dáng', 'hot girl', 'hot boy', 'hotgirl',
];
export const SHOWBIZ_PRIVATE: readonly string[] = PRIVATE_LIFE;

/**
 * Chủ thể là vợ / chồng / con của người nổi tiếng ("vợ tỷ phú Hong Kong", "con gái của ca sĩ X") → đời tư, không bàn
 * (so khớp có dấu, chữ thường; "vợ chồng A Phủ" là tên phim nên không tính mẫu "vợ chồng").
 */
export const PRIVATE_PATTERNS: readonly { re: RegExp; label: string }[] = [
  {
    re: /(?<![\p{L}\p{N}])(?:vợ|chồng|ông xã|bà xã|con gái|con trai|con|bạn đời|người tình|vợ cũ|chồng cũ|vợ sắp cưới|chồng sắp cưới)\s+(?:của\s+)?(?:cựu\s+|nam\s+|nữ\s+)?(?:tỷ phú|tỉ phú|đại gia|doanh nhân|cầu thủ|thủ môn|hlv|huấn luyện viên|ca sĩ|diễn viên|hoa hậu|á hậu|người mẫu|nghệ sĩ|danh hài|đạo diễn|nhạc sĩ|rapper|streamer|youtuber|tiktoker|idol|sao|ngôi sao|tài tử|minh tinh|tuyển thủ|vđv|võ sĩ|mc|nhà văn|hoàng tử|công nương|công chúa|tổng giám đốc|ceo)(?![\p{L}\p{N}])/u,
    label: 'đời tư gia đình',
  },
  { re: /(?<![\p{L}\p{N}])(?:vợ|chồng)\s+(?:của\s+)?[\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)*/u, label: 'đời tư gia đình' },
];

/**
 * Hạnh kiểm / xung đột / cơ thể / tình cảm của người thật — áp cho MỌI tin giải trí và cho tin thể thao / game / công nghệ /
 * khoa học có nhắc tới một con người (vai nghề hoặc tên riêng). Khác BLOCKLIST: những chữ này vô hại khi nói về sản phẩm,
 * trận đấu hay nghiên cứu ("tranh cãi về luật việt vị" được, "cầu thủ X gây tranh cãi" thì không).
 */
export const PERSON_CONDUCT: readonly string[] = [
  'bị chỉ trích', 'chỉ trích', 'bị ném đá', 'ném đá', 'bị đồn', 'rộ tin', 'nghi vấn', 'gây tranh cãi', 'tranh cãi', 'khẩu chiến',
  'đáp trả', 'phản pháo', 'đốp chát', 'cà khịa', 'đá xéo', 'mỉa mai', 'dằn mặt', 'cạch mặt', 'nghỉ chơi', 'cắt đứt', 'trở mặt',
  'phản bội', 'vô ơn', '=làm màu', 'sống ảo', 'phông bạt', 'nói dối', 'dối trá', 'tai tiếng', 'thị phi', 'ồn ào', 'lùm xùm',
  'bị đào lại', 'quá khứ', 'bị chê', 'bị chửi', 'chửi nhau', 'bị la ó', 'la ó', 'bị phản ứng', 'bị tẩy chay', 'bị bóc', 'lật mặt',
  'phát ngôn gây', 'phát ngôn sốc', 'vạ miệng', 'tổn thương', 'khi yêu', 'chuyện yêu', 'tình yêu', 'yêu đương', 'cặp kè', 'bên nhau',
  'cuộc sống riêng', 'đời sống riêng', 'trà xanh', 'sắc vóc', 'body', 'cơ bụng', 'vòng ba', 'vòng 3', 'khoe body',
  'mua nhà', 'mua xe', 'biệt thự', 'siêu xe', '=tài sản', 'khối tài sản', 'nợ nần', 'giàu có', 'thu nhập', 'cát-xê', 'cát xê',
  'nằm viện', 'chấn thương nặng', 'nghi ngờ', 'bị loại vì', 'bị phạt vì',
];

/**
 * Tin có nhắc tới một CON NGƯỜI cụ thể không (vai nghề như "ca sĩ", "streamer", "cầu thủ"… hoặc tên riêng 2 tiếng viết hoa
 * như "Trúc Nhân", "Bruno Fernandes"). Dùng để bật PERSON_CONDUCT cho tin thể thao / game / công nghệ / khoa học.
 */
const PERSON_ROLE_RE = /(?<![\p{L}\p{N}])(?:ca sĩ|diễn viên|nghệ sĩ|danh hài|đạo diễn|nhạc sĩ|rapper|streamer|youtuber|tiktoker|idol|hoa hậu|á hậu|người mẫu|mc|tài tử|minh tinh|ngôi sao|sao việt|sao hàn|cầu thủ|thủ môn|tiền đạo|tiền vệ|hậu vệ|hlv|huấn luyện viên|trọng tài|tay đua|tay vợt|vđv|vận động viên|võ sĩ|tuyển thủ|game thủ|caster|bình luận viên|streamer|tỷ phú|tỉ phú|doanh nhân|ceo|nhà sáng lập|kỹ sư|nhà khoa học|giáo sư|tiến sĩ|bác sĩ|nhà văn|hoàng tử|công nương)(?![\p{L}\p{N}])/u;
const PERSON_NAME_RE = /(?:^|[\s"“'(—–-])[\p{Lu}][\p{Ll}]+(?:\s+[\p{Lu}][\p{Ll}]+)+/u;
export function namesPerson(title: string, summary = '', opts: { names?: boolean } = {}): boolean {
  const t = `${title} ${summary}`.normalize('NFC');
  if (PERSON_ROLE_RE.test(t.toLowerCase())) return true;
  // tên riêng ≥ 2 tiếng viết hoa ("Trúc Nhân", "Bruno Fernandes") — chỉ dùng cho thể thao / giải trí; tin công nghệ / game
  // đầy tên sản phẩm viết hoa ("Pro Max", "Black Myth Wukong") nên chỉ tin vai nghề
  return opts.names !== false && PERSON_NAME_RE.test(t);
}

/** Giải trí nhẹ được phép (tác phẩm / sự kiện, không phải con người): phải khớp ít nhất 1 từ */
export const SHOWBIZ_ALLOW: readonly string[] = [
  'phim', 'điện ảnh', 'rạp', 'phòng vé', 'bom tấn', 'trailer', 'series', 'tập phim', 'vai diễn', 'diễn xuất', 'hậu trường',
  'đạo diễn', 'phim trường', 'hoạt hình', 'anime', 'netflix', 'remake', 'poster', 'ost',
  'nhạc', 'âm nhạc', 'album', 'ca khúc', 'bài hát', 'mv', 'concert', 'liveshow', 'live show', 'hòa nhạc', 'hoà nhạc',
  'bảng xếp hạng', 'billboard', 'rock', 'rap', 'ballad', 'k-pop', 'kpop', 'tour diễn', 'biểu diễn', 'fan meeting',
  'show', 'gameshow', 'game show', 'chương trình', 'sân khấu', 'kịch', 'nhạc kịch', 'xiếc', 'lễ trao giải', 'giải thưởng',
  'oscar', 'grammy', 'liên hoan phim', 'thời trang', 'gu mặc', 'gu thời trang', 'làng mốt', 'sàn diễn', 'người mẫu',
  'son', 'làm đẹp', 'trang điểm', 'mỹ phẩm', 'nước hoa', 'váy', 'đầm', 'outfit', 'street style', 'phối đồ', 'mặc đẹp',
  'trend', 'xu hướng', 'triệu view', 'lượt xem', 'top trending',
];

// ---------------------------------------------------------------- phán xét từng tin
export type DropReason = 'invalid' | 'blocked' | 'old' | 'showbiz_off' | 'showbiz' | 'conduct';

export interface FilterOptions {
  now?: number;                  // ms epoch (mặc định Date.now())
  maxAgeDays?: number;           // mặc định 3
  allowShowbiz?: boolean;        // mặc định true
  blocklist?: readonly string[]; // từ chặn THÊM (NEWS_BLOCKLIST)
}

export type Judgement = { ok: true } | { ok: false; reason: DropReason; keyword?: string };

export function isTooOld(publishedAt: number, now: number, maxAgeDays: number): boolean {
  return !Number.isFinite(publishedAt) || now - publishedAt > Math.max(0, maxAgeDays) * DAY_MS;
}

/** Tin giải trí có thuộc loại nhẹ (phim / nhạc / show / thời trang / trend) không — xét TIÊU ĐỀ (tóm tắt hay lạc đề) */
export function isLightShowbiz(text: NormText): boolean {
  return findKeyword(text, SHOWBIZ_ALLOW) !== null;
}

/** Nhóm tin mà tên riêng 2 tiếng viết hoa được coi là tên người (tin công nghệ / game / khoa học đầy tên sản phẩm viết hoa) */
const NAME_IS_PERSON: ReadonlySet<string> = new Set(['giai_tri', 'the_thao', 'bong_da']);

/** Tin này có được dùng không, và vì sao không */
export function judge(item: NewsItem, opts: FilterOptions = {}): Judgement {
  if (!item || typeof item.title !== 'string' || item.title.trim().length < 8 || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) {
    return { ok: false, reason: 'invalid' };
  }
  const now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();
  if (isTooOld(item.publishedAt, now, opts.maxAgeDays ?? 3)) return { ok: false, reason: 'old' };
  const text = normText(item.title, item.summary);
  const hit = blockedTopic(text, opts.blocklist);
  if (hit) return { ok: false, reason: 'blocked', keyword: hit };
  // hạnh kiểm / đời tư của người thật: mọi tin giải trí; tin nhóm khác khi có nhắc tới một con người
  const aboutPerson = item.category === 'giai_tri' || namesPerson(item.title, item.summary, { names: NAME_IS_PERSON.has(item.category) });
  if (aboutPerson) {
    const c = findKeyword(text, PERSON_CONDUCT);
    if (c) return { ok: false, reason: 'conduct', keyword: c };
  }
  if (item.category === 'giai_tri') {
    if (opts.allowShowbiz === false) return { ok: false, reason: 'showbiz_off' };
    if (!isLightShowbiz(normText(item.title))) return { ok: false, reason: 'showbiz' };
  }
  return { ok: true };
}

export interface Dropped { item: NewsItem; reason: DropReason; keyword?: string }

/** Lọc một danh sách tin: giữ tin an toàn, trả về cả lý do bỏ (để test / debug) */
export function filterNews(items: readonly NewsItem[], opts: FilterOptions = {}): { kept: NewsItem[]; dropped: Dropped[] } {
  const kept: NewsItem[] = [];
  const dropped: Dropped[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const j = judge(item, opts);
    if (j.ok) kept.push(item);
    else dropped.push({ item, reason: j.reason, keyword: j.keyword });
  }
  return { kept, dropped };
}
