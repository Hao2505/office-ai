// =====================================================================
//  v4 — "Chuyện mua sắm": cho món đồ trên kệ phòng trưng bày xuất hiện CÓ LÝ DO, không chèn ngang (docs/04 §11).
//
//  1) SHOPPING_THEMES — "vụ" do sếp / HR / chính nhân viên phát động trong vài giờ game (bốc thăm quà bí mật, thi góc
//     làm việc đẹp, tuần lễ sống khoẻ, tổng vệ sinh, tiệc công ty có dress code, đi chùa ngày rằm…). Trong lúc có vụ,
//     các món hợp vụ được ưu tiên và lời thoại lấy vụ làm cớ; vài vụ có "kết" (khui quà bí mật, công bố người thắng).
//  2) PRODUCT_ANGLES — kiểu chuyện xoay vòng cho từng lần nhắc (đã mua thấy ổn bất ngờ nên rủ nhau xài, săn sale được
//     giá mềm, mua chung cho được freeship, người nhà mượn luôn không trả, mua tặng rồi giữ luôn…). Director chọn ngẫu
//     nhiên có trọng số, né các kiểu vừa dùng; AI được dặn tự nghĩ chi tiết cụ thể mới dựa trên kiểu chuyện đó.
//
//  Chỉ là "chất liệu"; lời thoại vẫn do AI viết (hoặc câu mẫu offline). Không giá cụ thể, không link, không bịa công dụng:
//  luật nằm ở prompt (src/ai/prompts.ts) và lưới an toàn ở sanitize.
// =====================================================================
import type { PriceFeel } from '../types.js';

export type ThemeBy = 'boss' | 'hr' | 'marketing';
/** cách kết thúc vụ */
export type ThemePayoff = 'gift_exchange' | 'contest_winner';

export interface ShoppingTheme {
  key: string;
  icon: string;
  /** ai phát động (lấy tên người đang làm vai này; không có thì bỏ qua vụ) */
  by: ThemeBy;
  /** câu thông báo (log + nhóm công ty): {boss} {hr} {mkt} = tên người */
  announce: string;
  /** cớ ngắn dạng mệnh đề (câu mẫu offline + prompt): "sếp phát động thi góc làm việc đẹp nhất" */
  hook: string;
  /** tiền đề cho AI viết thoại hài, có chuyện */
  angle: string;
  /** tag sản phẩm hợp vụ ([] = mọi món) */
  tags: string[];
  /** độ dài vụ (phút game) */
  minutes: [number, number];
  /** trọng số khi bốc vụ ngẫu nhiên (0 = chỉ bật khi có sự kiện kích hoạt) */
  weight: number;
  /** điều kiện giờ: afternoon = bắt đầu sau 13:00; friday = chỉ thứ Sáu */
  when?: 'afternoon' | 'friday';
  payoff?: ThemePayoff;
}

export const SHOPPING_THEMES: ShoppingTheme[] = [
  {
    key: 'secret_santa', icon: '🎁', by: 'hr',
    announce: '{hr} phát động bốc thăm tặng quà bí mật: mỗi người mua một món cho người mình bốc được, cuối buổi khui quà',
    hook: 'HR bắt bốc thăm mua quà bí mật cho đồng nghiệp',
    angle: 'ai cũng bí không biết mua quà gì cho người mình bốc được, giấu kín tên, dò hỏi khéo sở thích của nhau, sợ mua trúng đồ người ta ghét',
    tags: ['qua-tang', 'trang-suc', 'decor', 'sinh-nhat', 'thu-gian'], minutes: [300, 420], weight: 1.2, payoff: 'gift_exchange',
  },
  {
    key: 'desk_contest', icon: '🏆', by: 'boss',
    announce: '{boss} phát động thi "góc làm việc đẹp nhất", ai thắng được sếp bao trà sữa cả tuần',
    hook: 'sếp phát động thi góc làm việc đẹp nhất',
    angle: 'cả phòng lo sửa sang bàn làm việc để ăn trà sữa, khoe nhau món mới, chê bàn người khác bừa, có người chơi xấu lén mượn đồ',
    tags: ['ban-lam-viec', 'chuot', 'man-hinh', 'gon-gang', 'decor', 'design'], minutes: [300, 480], weight: 1.1, payoff: 'contest_winner',
  },
  {
    key: 'healthy_week', icon: '🥗', by: 'hr',
    announce: '{hr} phát động "tuần lễ sống khoẻ": hạn chế trà sữa, khuyến khích tự nấu ăn sáng, ăn trưa',
    hook: 'HR phát động tuần lễ sống khoẻ, cấm trà sữa',
    angle: 'cả đám than thèm trà sữa, bàn cách tự nấu ăn sáng ăn trưa, ai cũng giả vờ healthy rồi lén ăn vặt',
    tags: ['nau-an', 'bep', 'an-trua', 'an-sang', 'do-uong', 'suc-khoe'], minutes: [360, 540], weight: 1,
  },
  {
    key: 'cleanup', icon: '🧽', by: 'boss',
    announce: '{boss} ra lệnh chiều nay tổng vệ sinh văn phòng, ai bàn bừa nhất phải trực nhật cả tuần',
    hook: 'sếp bắt tổng vệ sinh văn phòng',
    angle: 'ai cũng than mệt, kể chuyện nhà cửa bừa bộn, đổ lỗi cho nhau, lén trốn dọn, khoe mẹo dọn nhanh',
    tags: ['ve-sinh', 'don-dep', 'giat-giu', 'nha-cua', 'rem', 'gon-gang'], minutes: [180, 300], weight: 0.9, when: 'afternoon',
  },
  {
    key: 'meeting_projector', icon: '📽️', by: 'boss',
    announce: 'TV phòng họp chập chờn đúng lúc sắp demo cho khách, {boss} giao cả team tìm cách chiếu slide',
    hook: 'TV phòng họp chập chờn đúng lúc demo cho khách',
    angle: 'cả team cuống vì buổi demo, bàn cách chiếu slide, đổ thừa nhau làm hỏng TV, có người lo sao lưu file cho chắc',
    tags: ['trinh-chieu', 'phong-hop', 'man-hinh', 'sao-luu'], minutes: [180, 300], weight: 0.8,
  },
  {
    key: 'company_party', icon: '🥂', by: 'hr',
    announce: '{hr} thông báo cuối tuần có tiệc công ty, dress code "thanh lịch", có chụp ảnh tập thể',
    hook: 'cuối tuần có tiệc công ty, dress code thanh lịch',
    angle: 'ai cũng lo không có gì để mặc, chị em bàn váy áo trang sức, anh em giả vờ không quan tâm nhưng cũng lo, có người sợ bị chụp ảnh xấu',
    tags: ['tiec', 'thoi-trang', 'trang-diem', 'trang-suc', 'chup-anh', 'cuoi'], minutes: [360, 540], weight: 1,
  },
  {
    key: 'ram_day', icon: '🙏', by: 'hr',
    announce: 'Mai là rằm, {hr} rủ mọi người tan làm cùng đi chùa',
    hook: 'mai là rằm, rủ nhau đi chùa sau giờ làm',
    angle: 'bàn chuyện đi lễ, mặc gì cho trang nghiêm, có người lo không dậy sớm nổi; giữ lời lẽ tôn trọng, tuyệt đối không đùa về tôn giáo',
    tags: ['di-chua', 'ram', 'le'], minutes: [240, 360], weight: 0.5,
  },
  {
    key: 'sale_quota', icon: '🛒', by: 'marketing',
    announce: '{boss} giao {mkt} chỉ tiêu: tuần này phải giới thiệu được đồ trên kệ trưng bày cho cả văn phòng',
    hook: 'bị sếp giao chỉ tiêu giới thiệu kệ trưng bày',
    angle: '{mkt} bị ép chỉ tiêu nên giới thiệu hơi lố, mọi người né như né nhân viên bán bảo hiểm, {mkt} đành tự giễu rồi kể thật lòng món nào đáng',
    tags: [], minutes: [240, 420], weight: 0.9,
  },
  {
    key: 'backup_scare', icon: '💾', by: 'boss',
    announce: 'Sau vụ sập server, {boss} bắt mọi người tự sao lưu dữ liệu quan trọng',
    hook: 'vừa sập server, ai cũng sợ mất dữ liệu',
    angle: 'ai cũng giật mình nhớ ra chưa sao lưu gì, dev khịa nhau, sale lo mất file hợp đồng, có người khoe đã sao lưu từ lâu',
    tags: ['sao-luu', 'du-lieu', 'backup'], minutes: [180, 300], weight: 0,
  },
  {
    key: 'nap_policy', icon: '😴', by: 'hr',
    announce: '{hr} thông báo từ tuần này được ngủ trưa 20 phút, nhưng ai cũng phải tự lo gối chăn',
    hook: 'công ty cho ngủ trưa nhưng phải tự lo gối chăn',
    angle: 'mừng vì được ngủ trưa, than máy lạnh lạnh, tranh nhau chỗ ngủ, kể chuyện ngủ gục bàn ê cổ, chê chăn gối của nhau',
    tags: ['ngu-trua', 'chan-goi', 'may-lanh', 'thu-gian', 've-sinh'], minutes: [300, 480], weight: 0.9,
  },
  {
    key: 'heat_wave', icon: '☀️', by: 'boss',
    announce: 'Nắng chiều rọi thẳng vào khu làm việc, màn hình loá hết, {boss} hứa "để anh tính"',
    hook: 'nắng chiều rọi thẳng màn hình chói mắt',
    angle: 'than nóng, than chói, mồ hôi ướt lưng, chờ sếp lắp rèm mãi không thấy nên tự bàn chuyện mua rèm, chuyện giữ người thơm tho (chỉ tự giễu, không chê ai)',
    tags: ['nang', 'rem', 'mo-hoi', 'may-lanh', 'ca-nhan'], minutes: [150, 240], weight: 0.8, when: 'afternoon',
  },
  {
    key: 'business_trip', icon: '🧳', by: 'boss',
    announce: '{boss} báo tuần sau vài người đi công tác gặp khách ở Đà Nẵng',
    hook: 'sắp đi công tác gặp khách',
    angle: 'lo soạn đồ đi công tác cho gọn, kể chuyện từng quên đồ, rủ nhau mua quà mang theo, người ở nhà ganh tị',
    tags: ['du-lich', 'cong-tac', 'trang-suc', 'ca-nhan'], minutes: [240, 420], weight: 0.7,
  },
];

export function themeByKey(key: string | undefined | null): ShoppingTheme | undefined {
  return key ? SHOPPING_THEMES.find((t) => t.key === key) : undefined;
}

// ---------------------------------------------------------------- kiểu chuyện cho mỗi lần nhắc
export interface ProductAngle {
  key: string;
  /** mô tả kiểu chuyện cho AI: {owner} = người đã có món, {speaker} = người nhắc, {other} = người nghe */
  text: string;
  /** owner = cần một người trong cảnh đã có món (đã mua / được tặng / để trên bàn); new = người nhắc chưa có */
  need: 'owner' | 'new' | 'any';
  /** chỉ hợp mức giá (bỏ trống = mọi mức) */
  feel?: PriceFeel[];
  weight: number;
  /** sau cảnh này người nhắc có chốt đơn không (lên lịch "hàng về, khui hộp"): xác suất */
  buys?: number;
}

export const PRODUCT_ANGLES: ProductAngle[] = [
  { key: 'surprised_good', need: 'owner', weight: 1.4,
    text: '{owner} mua dùng thử chẳng kỳ vọng gì, ai ngờ ổn bất ngờ, giờ quay sang rủ {other} xài; {other} nghi ngờ rồi bắt đầu xiêu lòng' },
  { key: 'great_value', need: 'owner', feel: ['re', 'vua'], weight: 1.2,
    text: '{owner} khoe mua được giá mềm hơn tưởng (chỉ nói cảm nhận, tuyệt đối không nói con số), {other} nghi "rẻ vậy chắc dỏm", {owner} cãi bằng trải nghiệm' },
  { key: 'worth_it', need: 'owner', feel: ['cao'], weight: 1,
    text: '{owner} xót ví lúc chốt đơn nhưng dùng rồi thấy đáng tiền, {other} trêu "nhịn trà sữa mấy tháng"; không nói con số' },
  { key: 'desk_spotted', need: 'owner', weight: 1,
    text: '{other} để ý món mới của {owner}, hỏi mua ở đâu; {owner} làm bộ bí mật rồi cũng khai, còn dặn "đừng mua giống tui"' },
  { key: 'convert_skeptic', need: 'owner', weight: 0.8,
    text: '{owner} hồi trước chê món này, bị người khác dụ mua, giờ quay ra dụ lại {other} y chang, bị bắt bài' },
  { key: 'borrowed_forever', need: 'owner', weight: 0.8,
    text: '{owner} mua về thì người nhà hoặc bạn cùng phòng mượn luôn không trả, giờ tính mua thêm cái nữa, than với {other}' },
  { key: 'gift_kept', need: 'owner', weight: 0.7,
    text: '{owner} định mua làm quà cho người khác, mở ra dùng thử rồi… giữ luôn, giờ phải mua cái khác để tặng, nhờ {other} giữ bí mật' },
  { key: 'family_fan', need: 'owner', weight: 0.6,
    text: '{owner} mua cho bố mẹ, được khen nên giờ tự phong "chuyên gia tư vấn", tư vấn nhiệt tình cho {other}' },
  { key: 'wrong_variant', need: 'owner', weight: 0.5,
    text: '{owner} lỡ chọn nhầm màu hoặc mẫu lúc đặt, ai ngờ lại hợp, cả phòng trêu "nhầm mà hên"' },
  { key: 'need_first', need: 'any', weight: 1.4, buys: 0.25,
    text: 'một người than đúng cái rắc rối mà món này giải quyết, {speaker} chợt nhớ ra món này và gợi ý, {other} vừa muốn vừa tiếc tiền' },
  { key: 'midnight_sale', need: 'new', weight: 0.9, buys: 0.9,
    text: '{speaker} kể thức tới nửa đêm canh sale, tay nhanh hơn não nên vừa chốt món này, giờ đang ngóng hàng về; {other} hỏi han, trêu' },
  { key: 'group_buy', need: 'new', weight: 0.9, buys: 0.8,
    text: '{speaker} rủ mua chung cho được freeship, cãi nhau chuyện ai ứng tiền trước, ai giữ hộ, chốt bằng một câu hài' },
  { key: 'review_binge', need: 'new', weight: 0.8, buys: 0.5,
    text: '{speaker} xem review cả tuần mà chưa dám chốt món này, {other} thúc "mua đi chờ gì nữa", {speaker} đổ cho ví mỏng' },
  { key: 'impulse_stress', need: 'new', weight: 0.7, buys: 0.85,
    text: '{speaker} vừa chốt đơn món này trong lúc stress deadline để "tự thưởng", sợ bị cả phòng chê hoang, {other} vừa trêu vừa xin xem' },
  { key: 'comparison', need: 'any', weight: 0.7, buys: 0.2,
    text: 'hai người so món này với đồ cũ đang dùng ở nhà, cãi nhẹ xem cái nào hơn, chốt bằng một câu hài' },
  { key: 'hide_purchase', need: 'new', feel: ['vua', 'cao'], weight: 0.5, buys: 0.9,
    text: '{speaker} lén đặt món này, nhờ {other} nhận hàng hộ ở văn phòng cho người nhà khỏi biết, {other} đòi phí bịt miệng bằng trà sữa' },
];

/** Thay {owner} {speaker} {other} trong mô tả kiểu chuyện */
export function fillAngle(text: string, names: { owner?: string; speaker?: string; other?: string }): string {
  return text
    .replace(/\{owner\}/g, names.owner || names.speaker || 'một người')
    .replace(/\{speaker\}/g, names.speaker || names.owner || 'một người')
    .replace(/\{other\}/g, names.other || 'người kia');
}

/** cảm nhận giá → lời dặn cho AI (không con số) */
export const PRICE_FEEL_TEXT: Record<PriceFeel, string> = {
  re: 'giá rẻ, ai cũng mua được (chỉ nói kiểu "rẻ bất ngờ", "đáng đồng tiền")',
  vua: 'giá vừa túi tiền dân văn phòng (chỉ nói kiểu "giá mềm", "hợp lý")',
  cao: 'món hơi đắt (KHÔNG được gọi là rẻ; chỉ nói kiểu "xót ví mà đáng", "để dành mới mua")',
};
