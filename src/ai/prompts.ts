// =====================================================================
//  Prompt tiếng Việt cho LLM (OpenAI / Gemini / Groq — mọi endpoint tương thích).
//  - buildSystemPrompt(): TĨNH cho cả tiến trình (brain build 1 lần) → prompt cache.
//    Chỉ chứa luật chung của CẢNH; gọn (~1300 token đo thật, kèm schema) vì gói miễn phí giới hạn token/ngày.
//  - build*UserPrompt(): động, gọn, chỉ dữ liệu cảnh cần; luật theo tình huống (kênh,
//    tin đồn, sản phẩm, verdict, mẫu JSON ứng viên/bản tin) nằm ở đây — không lặp với system.
//  - Prompt cảnh dựng theo bậc (prompt-budget.ts): vượt trần token thì tự cắt gọn hơn.
//  File thuần (không import module nội dung) để test độc lập; brain truyền COMPANY_INFO vào.
// =====================================================================
import type {
  AgentState, BeatRequest, CandidateRequest, Channel, PromptContext, RecapRequest, RoleKey, SceneRequest, SceneType,
} from '../types.js';
import { estimateTokens, fitSceneBudget, type SceneLimits } from './prompt-budget.js';

/** Cùng shape với COMPANY_INFO (src/content/catalog.ts) */
export interface CompanyInfoLike {
  tagline: string;
  description: string;
  products: string[];
  culture: string;
}

// ---------------------------------------------------------------- tiện ích chuỗi

/** Gọn khoảng trắng + cắt ở ranh giới từ, thêm "…" nếu bị cắt. */
export function cut(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let slice = t.slice(0, max - 1);
  const sp = slice.lastIndexOf(' ');
  if (sp > max * 0.6) slice = slice.slice(0, sp);
  else if (/[\uD800-\uDBFF]$/.test(slice)) slice = slice.slice(0, -1); // không cắt đôi emoji
  return slice.replace(/[\s,.;:–-]+$/, '') + '…';
}

/** Như cut() nhưng ưu tiên dừng ở cuối câu (đỡ bị cụt giữa ý). */
export function cutSentence(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const end = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('; '));
  return end >= max * 0.4 ? slice.slice(0, end + 1).replace(/;$/, '.') : cut(t, max);
}

export function hhmm(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- SYSTEM PROMPT (tĩnh)

const FALLBACK_COMPANY: CompanyInfoLike = {
  tagline: 'Code nhanh, bán nhanh, deadline còn nhanh hơn',
  description: 'Công ty phần mềm khoảng 10 người ở TP.HCM: nhận làm app, website theo đơn đặt hàng của khách và tự bán phần mềm bán hàng BánNhanh POS.',
  products: ['Làm app, website theo yêu cầu', 'BánNhanh POS — phần mềm bán hàng cho shop nhỏ'],
  culture: 'Sếp hay nói "chúng ta là một gia đình"; deadline dí liên tục; bảng KPI treo giữa văn phòng.',
};

/** Mẫu JSON của cảnh (có trong system vì cảnh là nhiệm vụ thường xuyên nhất; Groq json_object cần chữ "JSON"). */
/** v4: cảm nhận giá cho AI (khớp src/content/shopping.ts PRICE_FEEL_TEXT) */
const PRICE_FEEL: Record<'re' | 'vua' | 'cao', string> = {
  re: 'rẻ (kiểu "rẻ bất ngờ")',
  vua: 'vừa túi (kiểu "giá mềm")',
  cao: 'hơi đắt, cấm gọi rẻ (kiểu "xót ví mà đáng")',
};

const SCENE_JSON = '{"lines":[{"speaker":"id","text":"lời thoại","emote":null,"product":false}],"summary":"",'
  + '"relationshipChanges":[{"from":"id","to":"id","delta":-3,"reason":""}],"moodChanges":[{"id":"id","delta":4}],'
  + '"memories":[{"id":"id","text":""}],"kpiChanges":[{"id":"id","delta":-5}],"rumor":null,"verdict":null,"hrDecisions":null}';

/**
 * Luật an toàn khi bàn TIN THẬT (docs/v3-news.md). Bản đầy đủ nằm trong prompt cảnh news_chat (NEWS_RULES),
 * bản gọn nằm trong system (NEWS_RULES_SHORT) để model nào cũng thấy dù prompt bị cắt bậc.
 */
export const NEWS_RULES_SHORT = 'TIN THẬT (khi có mục TIN): chỉ cảm nghĩ về tin đúng như báo đăng; không bịa thêm sự thật, số liệu, phát ngôn; '
  + 'không gán tội, không bàn đời tư hay chế giễu người thật; dẫn "theo báo X đăng".';
export const NEWS_RULES = 'LUẬT TIN THẬT (bắt buộc): chỉ nói cảm nghĩ, ý kiến, cảm xúc về tin ĐÚNG NHƯ báo đăng ở trên; '
  + 'không thêm sự thật, con số, phát ngôn, tên người hay chi tiết ngoài tiêu đề/tóm tắt — chi tiết nhắc lại chép đúng chữ báo, giữ mức dè dặt '
  + '("nén khóc" ≠ "khóc", "có thể" ≠ "là"); không đoán động cơ, nguyên nhân, cảm xúc người thật ("làm màu", "chắc là bị…"), không kết luận ai đúng sai, '
  + 'không gán tội, không bàn tính cách hay đời tư, không chế giễu người thật có tên (khịa tình huống thì được); '
  + 'dẫn nguồn: "theo báo X đăng", "nghe nói trên báo", "tui chưa đọc kỹ"; 4–8 câu tám chuyện văn phòng, mỗi người phản ứng theo tính cách, '
  + 'sở thích và liên hệ sang chuyện mình (đội bóng mình mê, game mình chơi); không chính trị, tôn giáo.';

export function buildSystemPrompt(companyName: string, info?: Partial<CompanyInfoLike> | null): string {
  const name = cut(companyName || 'Cty TNHH VibeCorp', 60);
  const tagline = cut(info?.tagline || FALLBACK_COMPANY.tagline, 80);
  const description = cutSentence(info?.description || FALLBACK_COMPANY.description, 300)
    .replace(/^[^.]{0,40}?\blà\s+/u, '') // "Cty X là công ty…" → "công ty…" (tên đã ghi ngay trước)
    .replace(/\.$/, '');
  const culture = cutSentence(info?.culture || FALLBACK_COMPANY.culture, 110).replace(/\.$/, '');

  return [
    `Bạn là biên kịch của "Văn Phòng Ảo" — sitcom văn phòng phát trực tiếp về nhân viên ${name}: làm việc, trốn việc, tám chuyện, drama theo thời gian thực. Thoại tự nhiên như nghe lén ngoài đời, có duyên. Nhân vật là người thật trong truyện, không biết mình là AI, không nói với khán giả.`,
    `CÔNG TY: ${name} — "${tagline}" — ${description}. Văn hoá: ${culture}.`,
    'Mỗi yêu cầu mở đầu bằng "NHIỆM VỤ: CẢNH" / "NHIỆM VỤ: ỨNG VIÊN" / "NHIỆM VỤ: BẢN TIN"; chỉ trả lời bằng đúng MỘT object JSON theo mẫu của nhiệm vụ (CẢNH: mẫu bên dưới; hai loại kia: mẫu ghi trong yêu cầu), không markdown, không chữ ngoài JSON. Mọi chữ hiển thị là tiếng Việt có dấu đầy đủ (trừ teencode cố ý trong nhóm chat).',
    '',
    'LUẬT CẢNH',
    'Giọng: văn nói dân văn phòng Sài Gòn — đời, gọn, có duyên; không văn viết, không câu dịch từ tiếng Anh. Từ Nam Bộ rải vừa phải: nha (thay "nhé"), nè, hen, hông, á, thiệt, trời đất, ly, trái, chạy xe, nhậu; người vắng mặt gọi ảnh/chỉ/ổng/bả/nó. Câu ≤ 25 chữ, mỗi lượt 1–2 câu. Mỗi người một giọng riêng theo mục "giọng"; câu cửa miệng tối đa 1 lần/cảnh; đừng gọi tên nhau mỗi câu; đa dạng câu mở, đừng câu nào cũng "Ê", "Ủa".',
    'Xưng hô: theo mục XƯNG HÔ, nhất quán cả cảnh — "A: anh/em (B)" = A gọi B là "anh", tự xưng "em"; "giọng" ghi cách xưng riêng (vd "với bạn thân thì tui/ông", bực thì "tui") thì ưu tiên, nhưng chỉ với đúng người/lúc đó. Không tự chế mày/tao/bạn, cấm "tôi – bạn" giữa đồng nghiệp. Sếp gọi "em/các em"; nhân viên gọi "anh"/"sếp" và có "dạ". Slang Gen Z (khum, xỉu, u là trời…) chỉ cho người ≤ 25 tuổi hoặc khi "giọng" ghi.',
    'Hài sitcom: khịa, đá xéo, than thở, chống chế, giả ngu, nịnh sếp lộ liễu, hiểu lầm — từ tính cách và tình huống, không từ lời thô; được cãi, giận, ganh đua, đừng ai cũng hiền lành đồng ý hết. Chỉ chửi nhẹ ("trời ơi", "má ơi"); không tình dục, miệt thị (vùng miền, giới, ngoại hình, tôn giáo), chính trị, người nổi tiếng thật, bôi xấu thương hiệu thật (nhắc Zalo, TikTok, Shopee, Grab bình thường); không giảng đạo lý, không câu sáo ("thật tuyệt vời", "cùng cố gắng nhé").',
    'Dựng cảnh: vào thẳng giữa chuyện, câu đầu có móc (hỏi, than, khịa, tin sốc); câu sau đáp câu trước và đẩy chuyện đi, không lặp ý, không kể lại Tình huống mà thể hiện qua thoại; mở → căng → chốt bằng punchline, twist hoặc hệ quả, không kết bằng câu tóm tắt. Chi tiết đời: tên dự án, hạn chót, bug cụ thể, số KPI, món ăn, kẹt xe, giá vàng. Diễn đúng dữ liệu: việc đang làm, thể trạng 0–100 (mệt thì ngáp, stress cao thì cáu, KPI chậm thì lo bị gọi lên), thiện cảm −100..100 (ghét thì đá xéo, thân thì bênh), ký ức. Không lời dẫn, không mô tả hành động, không "(cười)", không "Tên:" trong text. Chỉ nhắc đồng nghiệp có tên trong yêu cầu. Từ 2 người thì ai cũng nói ≥ 1 câu.',
    'Hiệu ứng: chỉ loại YÊU CẦU cho phép, loại khác để [] (rumor, verdict, hrDecisions: null); khớp thoại, tám nhẹ thì ít và nhỏ. relationshipChanges from→to delta nguyên −15..15 (tám vui +1..3, bênh +4..8, khịa nhẹ −1..−3, cãi hay bị chê −4..−8, phản bội lộ ra −9..−15), reason ≤ 60 ký tự, chỉ giữa người trong cảnh và người được nhắc. moodChanges −15..15 (vui ±2..6, bị mắng hay bị đuổi −8..−15). memories 0–1 điều/người khi đáng nhớ, ≤ 100 ký tự, như ghi chú riêng. kpiChanges −25..25 (bị phạt −5..−15, được khen +5..10).',
    NEWS_RULES_SHORT,
    `JSON CẢNH (viết gọn trên 1 dòng, không xuống dòng, không thụt lề): ${SCENE_JSON}`,
    'speaker = id trong [ ], không phải tên; text chỉ là lời nói; emote: 1 emoji hoặc null (khoảng 1/3 số câu); summary: 1 câu ≤ 120 ký tự, ngôi thứ ba, có tên, nêu điểm đáng nhớ nhất.',
  ].join('\n');
}

// ---------------------------------------------------------------- định hướng theo loại cảnh

/** {A}/{B} được thay bằng tên (desk_visit: A ghé bàn B; confront: A là người bị đồn, B là người tung tin) */
export const SCENE_DIRECTION: Record<SceneType, string> = {
  pantry_chat: 'tám chuyện lúc nghỉ tay: nhẹ, đời, than việc hoặc kể chuyện ngoài công ty.',
  desk_visit: '{A} ghé bàn {B} vì một mục đích cụ thể; {B} đang bận hoặc đang lười nên phản ứng theo đó; chốt bằng kết quả của lời nhờ/khịa.',
  gossip: 'hai người nói xấu người vắng mặt: hạ giọng, rào trước cho khỏi bị nghe (mỗi lần mở đầu một cách khác), thêm thắt, đoán già đoán non.',
  group_chat: 'nhắn trong nhóm kín không có sếp: than thở, cập nhật drama, thả reaction, rủ rê.',
  company_chat: 'nhắn trong nhóm công ty có sếp đọc: thông báo hoặc chúc mừng; nhân viên "Dạ", nịnh, ai cũng giữ hình ảnh.',
  standup: 'Tech Lead điều phối; mỗi người báo hôm qua làm gì, hôm nay làm gì, vướng gì; có người chống chế, có người khịa; sếp (nếu có) chen ngang lạc đề.',
  lunch: 'ăn trưa: đồ ăn, giá cả, chuyện nhà, chuyện công ty; lan man nhưng có một chuyện chính.',
  boss_catch: 'sếp bắt quả tang người đang lười: nạn nhân chống chế vụng về, sếp mắng đúng kiểu của sếp (lần này một kiểu mới), hứa hoặc doạ mơ hồ; nạn nhân quê độ.',
  boss_call: 'sếp gọi lên phòng: khen, chê KPI hoặc giao việc trời ơi; nhân viên dạ vâng nhưng trong bụng nghĩ khác, lộ ra qua câu chữ.',
  hr_warning: 'HR nhắc KPI thấp: giọng ngọt mà thép, có số liệu, ghi chép cẩn thận; nhân viên viện cớ; kết bằng lời cảnh cáo rõ ràng.',
  firing: 'cho nghỉ việc: căng mà vẫn có duyên, không tàn nhẫn; nhắc bàn giao laptop, thẻ từ; người bị cho nghỉ có câu chốt đáng nhớ.',
  interview: 'phỏng vấn: HR hỏi, Tech Lead hỏi chuyên môn (nếu có), sếp hỏi câu trời ơi (nếu có); ứng viên trả lời đúng tính cách; câu cuối hé lộ kết quả.',
  incident: 'sự cố: hoảng loạn, đổ lỗi, thuật ngữ thật (log, rollback, hotfix, database, deploy); Tech Lead chỉ huy; chốt bằng hướng xử lý hoặc lộ thủ phạm.',
  celebration: 'ăn mừng: hò reo, chúc tụng, trêu nhau; sếp (nếu có) hứa thưởng mơ hồ.',
  confront: '{A} (người bị đồn) đến hỏi tội {B} (người tung tin): {B} chối, đổ cho người khác hoặc chữa cháy; căng rồi chốt.',
  pingpong_match: 'vừa đánh bóng bàn vừa trash talk: đếm điểm, cá cược trà sữa, ăn mừng lố.',
  welcome: 'chào người mới: giới thiệu, dặn "luật ngầm" (sếp, KPI, đừng deploy thứ Sáu), trêu người mới; người mới bỡ ngỡ đúng tính cách.',
  showroom_chat: 'đứng ngắm kệ ở phòng trưng bày, nói về món ở khối MÓN TRÊN KỆ / MÓN ĐỒ … ĐÃ CÓ theo "Chuyện quanh món này" trong Tình huống: chỉ người của khối "ĐÃ CÓ" mới kể đã dùng, còn lại là xem review, săn sale, mua chung…; người kia khịa hoặc nghi ("ăn hoa hồng hả"), hỏi giá mà không ai nói giá; chốt bằng câu đùa hoặc rủ mua chung.',
  // --- v3 (docs/v3-news.md)
  news_chat: 'tám chuyện thời sự về đúng 1 tin trong mục TIN, theo LUẬT TIN THẬT: mở kiểu "ê thấy tin… chưa", "báo X đăng đó"; chốt bằng câu đùa hoặc quay về việc.',
  hr_review: 'HR và sếp họp kín xét nhân sự theo HỒ SƠ: HR nêu ai đáng lo, ai đáng khen như nói chuyện (không đọc số như máy), sếp hỏi lại, chen golf hay "gia đình", rồi chốt từng quyết định có tình có lý; hrDecisions khớp thoại và TRẦN; thoại nói tiếng Việt (thưởng nóng, khen, cho cơ hội, nhắc nhở, cho nghỉ), không đọc mã action.',
  resign_talk: '{A} chán việc, xin gặp HR để trút bầu tâm sự và dọa nghỉ: {A} kể lý do thật theo dữ liệu (tâm trạng, sếp, lương, đồng nghiệp, việc quá tải); HR lắng nghe, hỏi khéo, thuyết phục ở lại hoặc tôn trọng quyết định; kết quả do cảnh quyết (verdict) và lộ rõ ở câu cuối.',
  raise_request: '{A} xin tăng lương với sếp: đưa bằng chứng cụ thể (KPI, dự án đã giao, thời gian làm, việc gánh thêm); sếp trả lời đúng kiểu của sếp (ví von, "chúng ta là một gia đình", hứa mơ hồ, hoặc đồng ý có điều kiện); có qua có lại, {A} dám cãi nhẹ; chốt bằng verdict rõ ở câu cuối.',
  promotion: 'công bố thăng chức hoặc thưởng cho {A} trước đồng nghiệp: sếp tuyên bố hoành tráng, {A} cảm ơn đúng tính cách, đồng nghiệp phản ứng thật (mừng, ganh tị nhẹ, khịa, đòi khao); chốt bằng câu đùa hoặc lời hứa khao.',
  layoff: 'cắt giảm nhân sự vì công ty lỗ: sếp và HR báo tin xấu cho {A} nhẹ nhàng, nhận lỗi về tình hình công ty, không chê năng lực; {A} phản ứng đúng tính cách (sốc, hiểu, hỏi chế độ, nói câu để đời); đồng nghiệp (nếu có) buồn, hứa giữ liên lạc; nhắc bàn giao; không tàn nhẫn.',
  // --- v5: tình huống công ty (docs/04 §16)
  crisis_meeting: 'họp kín xử lý TÌNH HUỐNG CÔNG TY như công ty thật: {A} (chủ trì) nêu chuyện bằng chi tiết cụ thể; mỗi người đề xuất đúng vai (HR lo con người, sales lo khách và tiền, tech lo tiến độ, marketing lo hình ảnh), có phản biện, cân nhắc cái giá của từng hướng; người trong cuộc (nếu có mặt) tự bảo vệ; {A} chốt đúng 1 phương án trong PHƯƠNG ÁN ở câu cuối và nói lý do bằng lời đời thường (không đọc mã plan_x); không nói tục, không bịa số tiền cụ thể.',
  pep_talk: '"công tác tư tưởng": {A} nói chuyện để vực tinh thần / thuyết phục (cả phòng, nói riêng, hoặc ngồi giữa hai người đang căng); {A} nói đúng chất mình, có ví von, kể chuyện, hứa có điều kiện; người nghe phản ứng THẬT theo tâm trạng và tính cách (cảm động, gật gù cho qua, hỏi xoáy, im lặng); kết quả (verdict) lộ rõ ở câu cuối.',
};

/** Cảnh có kết quả (verdict) do AI quyết, với giá trị mặc định khi model không trả / trả sai */
export const VERDICT_RULES: Partial<Record<SceneType, { values: string[]; fallback: string; hint: string }>> = {
  interview: { values: ['hired', 'rejected'], fallback: 'hired', hint: 'câu cuối hé lộ kết quả ("Thứ Hai em đi làm luôn nha" / "Chị sẽ liên hệ lại sau nha em"); có điểm trừ rõ thì loại, Tình huống bắt buộc nhận thì "hired"' },
  resign_talk: { values: ['stay', 'leave'], fallback: 'stay', hint: 'quyết theo tâm trạng, thiện cảm với sếp/HR và lý do trong dữ liệu: còn cứu được thì "stay" (HR thuyết phục được), đã quá chán hoặc có chỗ mới thì "leave"; câu cuối phải lộ rõ' },
  raise_request: { values: ['approved', 'denied'], fallback: 'denied', hint: 'quyết theo KPI, doanh thu công ty và thiện cảm của sếp: bằng chứng mạnh và công ty đang ổn thì "approved" (có thể kèm điều kiện), còn lại "denied" kiểu hứa mơ hồ; câu cuối phải lộ rõ' },
  // v5: mã phương án lấy từ req.crisis.options (prompt in khối PHƯƠNG ÁN); fallback = pick dự phòng
  crisis_meeting: { values: ['plan_a', 'plan_b', 'plan_c', 'plan_d'], fallback: 'plan_a', hint: 'mã của phương án được chốt (chỉ các mã có trong PHƯƠNG ÁN), khớp câu chốt; chọn theo tình hình, tính cách người chủ trì và tranh luận trong cảnh — không mặc định chọn cái an toàn nhất' },
  pep_talk: { values: ['inspired', 'unmoved'], fallback: 'inspired', hint: '"inspired" nếu đa số người nghe được thuyết phục / hai bên làm lành, "unmoved" nếu không — theo tâm trạng, quan hệ với người nói và chất lượng lời nói; câu cuối phải lộ rõ' },
};

/** dòng "verdict" trong YÊU CẦU: cảnh 2 kết quả "a" hoặc "b"; crisis_meeting chỉ liệt kê mã có trong PHƯƠNG ÁN */
function verdictReq(req: SceneRequest, vr: { values: string[]; hint: string }): string {
  const codes = req.type === 'crisis_meeting' && req.crisis?.options?.length
    ? req.crisis.options.map((o) => o.code).filter((x) => vr.values.includes(x))
    : vr.values;
  const list = codes.length === 2 ? `"${codes[0]}" hoặc "${codes[1]}"` : `một trong ${codes.map((x) => `"${x}"`).join(' | ')}`;
  return `verdict: ${list} — khớp với thoại; ${vr.hint}`;
}

/** Văn phong theo kênh — chỉ gửi kênh đang dùng (không nằm trong system). */
const CHANNEL_STYLE: Record<Channel, string> = {
  office: 'office — nói trực tiếp, có cảm thán, ngắt lời',
  group: 'group — nhóm Zalo kín KHÔNG có sếp, văn chat: viết tắt (k, ko, đc, j, r, ae), emoji thật (không gõ mã :sob:), "=)))", "kkk", tin cụt lủn, có thể nhắn liền 2 tin; dám than sếp, HR, KPI, rủ rê',
  company: 'company — nhóm Zalo công ty CÓ sếp đọc: lịch sự "Dạ", "Vâng ạ", 👍 🔥 💪, nịnh sếp; sếp thông báo hoặc đăng câu truyền cảm hứng, nhân viên trả lời rập khuôn hoặc mỉa mai thật khéo, không ai dám than thẳng',
};

const EFFECT_LABEL: Record<string, string> = {
  relationship: 'relationshipChanges',
  mood: 'moodChanges',
  memory: 'memories',
  kpi: 'kpiChanges',
  rumor: 'rumor',
  verdict: 'verdict',
  decisions: 'hrDecisions',
};

/** Nhóm tin (NewsCategory) → tên tiếng Việt trong prompt */
const NEWS_CATEGORY_LABEL: Record<string, string> = {
  the_thao: 'thể thao', bong_da: 'bóng đá', cong_nghe: 'công nghệ', game: 'game', khoa_hoc: 'khoa học', giai_tri: 'giải trí',
};

/** "hôm nay" / "hôm qua" / "N ngày trước" theo giờ thật (tin RSS có publishedAt thật) */
export function publishedAgo(publishedAt: unknown, nowMs: number = Date.now()): string {
  const t = typeof publishedAt === 'number' && Number.isFinite(publishedAt) ? publishedAt : NaN;
  if (!Number.isFinite(t)) return 'mới đăng';
  const days = Math.floor(Math.max(0, nowMs - t) / 86_400_000);
  return days <= 0 ? 'đăng hôm nay' : days === 1 ? 'đăng hôm qua' : `đăng ${days} ngày trước`;
}

/** Vai trò ngắn cho danh sách "người khác" (tiết kiệm chữ; nhân vật chính vẫn dùng roleLabel đầy đủ). */
const SHORT_ROLE: Record<RoleKey, string> = {
  boss: 'Giám đốc', hr: 'HR', techlead: 'Tech Lead', senior: 'Senior Dev', junior: 'Fresher Dev',
  qa: 'QA', designer: 'Designer', saleslead: 'Sales Lead', salesnew: 'Sales', marketing: 'Marketing',
};

function partOfDay(minute: number): string {
  if (minute < 510) return 'đầu giờ sáng';
  if (minute < 690) return 'buổi sáng';
  if (minute < 795) return 'giờ nghỉ trưa';
  if (minute < 900) return 'đầu giờ chiều, dễ buồn ngủ';
  if (minute < 1020) return 'buổi chiều';
  if (minute < 1110) return 'sắp tan làm';
  return 'ngoài giờ, đang OT';
}

// ---------------------------------------------------------------- xưng hô

const MANAGER_ROLES = new Set<RoleKey>(['boss', 'hr', 'techlead', 'saleslead']);
const kinOf = (p: AgentState) => (p.gender === 'nữ' ? 'chị' : 'anh');
const peerOf = (p: AgentState) => (p.gender === 'nữ' ? 'bà' : 'ông');

/** "gọi/xưng" khi a nói với b, vd "anh/em" = a gọi b là anh, tự xưng em. */
export function addressTerm(a: AgentState, b: AgentState, channel: Channel): string {
  if (a.role === 'boss') return 'em/anh';
  if (b.role === 'boss') return 'sếp/em';
  const formal = channel === 'company' || a.status === 'candidate' || b.status === 'candidate';
  const diff = num(b.age, 28) - num(a.age, 28);
  // dùng thiện cảm của CẢ HAI chiều → cặp xưng hô luôn đối xứng
  const mutual = Math.min(num(a.relationships?.[b.id]?.score), num(b.relationships?.[a.id]?.score));
  const close = !formal && !MANAGER_ROLES.has(a.role) && !MANAGER_ROLES.has(b.role) && mutual >= 25;
  if (diff >= 2) return close && diff <= 4 ? `${peerOf(b)}/tui` : `${kinOf(b)}/em`;
  if (diff <= -2) return close && diff >= -4 ? `${peerOf(b)}/tui` : `em/${kinOf(a)}`;
  // chênh nhau 0–1 tuổi
  if (a.status === 'candidate') return `${kinOf(b)}/em`;
  if (b.status === 'candidate') return `em/${kinOf(a)}`;
  if (channel === 'company') return 'tên/mình';
  if (diff === 0 || mutual >= 15) return `${peerOf(b)}/tui`;
  return diff > 0 ? `${kinOf(b)}/em` : `em/${kinOf(a)}`; // hơn 1 tuổi mà chưa thân vẫn anh/chị – em
}

/** Cách gọi người vắng mặt (ngôi thứ ba) theo góc nhìn của speaker. */
export function thirdPerson(speaker: AgentState, about: AgentState): string {
  if (about.role === 'boss') return 'sếp/ổng';
  const diff = num(about.age, 28) - num(speaker.age, 28);
  if (diff >= 2) return about.gender === 'nữ' ? `chị ${about.name}/chỉ/bả` : `anh ${about.name}/ảnh/ổng`;
  if (diff <= -2) return `${about.name}/nó`;
  return about.gender === 'nữ' ? `${about.name}/bả` : `${about.name}/ổng`;
}

/** Mỗi người 1 dòng: "Vy: em/chị (Bảo, Tú) · chị/em (Linh)"; 2 người thì gộp 1 dòng. */
function addressLines(people: AgentState[], channel: Channel, about: AgentState | null): string[] {
  const out: string[] = [];
  if (people.length >= 2) {
    for (const a of people) {
      const groups = new Map<string, string[]>();
      for (const b of people) {
        if (b.id === a.id) continue;
        const t = addressTerm(a, b, channel);
        groups.set(t, [...(groups.get(t) ?? []), b.name]);
      }
      out.push(`${a.name}: ${[...groups].map(([t, names]) => `${t} (${names.join(', ')})`).join(' · ')}`);
    }
  }
  if (about && people.length) {
    // ngôi thứ ba theo từng người nói (tuổi/giới khác nhau → cách gọi khác nhau); gộp khi ai cũng gọi giống nhau
    const g = new Map<string, string[]>();
    for (const p of people) { const t = thirdPerson(p, about); g.set(t, [...(g.get(t) ?? []), p.name]); }
    out.push(`nhắc ${about.name} (vắng, ${about.gender}): ${g.size === 1 ? [...g.keys()][0] : [...g].map(([t, ns]) => `${ns.join(', ')} gọi ${t}`).join(' · ')}`);
  }
  if (!out.length) return [];
  return people.length <= 2 ? [`XƯNG HÔ (gọi/xưng): ${out.join(' · ')}`] : ['XƯNG HÔ (gọi/xưng):', ...out.map((s) => `- ${s}`)];
}

// ---------------------------------------------------------------- mô tả nhân vật

function roleText(a: AgentState, ctx: PromptContext): string {
  if (a.status === 'candidate') return `ỨNG VIÊN vị trí ${a.roleLabel}`;
  const daysIn = ctx.day - num(a.hiredDay, 0);
  if (num(a.hiredDay, 0) > 1 && daysIn <= 2) {
    return `${a.roleLabel} (người mới, vào làm ${daysIn <= 0 ? 'hôm nay' : daysIn === 1 ? 'hôm qua' : '2 ngày trước'})`;
  }
  return a.roleLabel;
}

function bodyNote(a: AgentState): string {
  const e = Math.round(num(a.energy, 70)), m = Math.round(num(a.mood, 60)), s = Math.round(num(a.stress, 30));
  const eTag = e < 25 ? ' (kiệt sức)' : e < 40 ? ' (mệt)' : e > 88 ? ' (sung)' : '';
  // văn phòng "bình thường" vui vẻ ~70–85 (World kéo mood về mức nền) → chỉ gắn nhãn khi lệch rõ
  const mTag = m < 30 ? ' (rất tệ)' : m < 50 ? ' (không vui)' : m > 88 ? ' (rất vui)' : '';
  const sTag = s > 80 ? ' (sắp nổ)' : s > 65 ? ' (căng)' : s < 15 ? ' (thảnh thơi)' : '';
  return `năng lượng ${e}${eTag}, tâm trạng ${m}${mTag}, stress ${s}${sTag}`;
}

/** Cảnh mà KPI chính là chủ đề → luôn ghi KPI (và lịch sử với cảnh HR/sếp) */
const KPI_SCENES = new Set<SceneType>(['standup', 'boss_call', 'hr_warning', 'firing', 'boss_catch', 'resign_talk', 'raise_request', 'promotion', 'layoff']);
const KPI_HISTORY_SCENES = new Set<SceneType>(['boss_call', 'hr_warning', 'firing', 'resign_talk', 'raise_request', 'layoff']);
/** Cảnh trang trọng (HR/sếp) — thêm thông tin ngày vào làm, số lần thưởng/thăng chức (v3) */
const TENURE_SCENES = new Set<SceneType>(['resign_talk', 'raise_request', 'promotion', 'layoff', 'firing']);

function kpiNote(a: AgentState, minuteOfDay: number, type: SceneType): string {
  if (a.role === 'boss' || a.role === 'hr' || a.status !== 'active') return '';
  const parts: string[] = [];
  const target = num(a.kpiTarget, 0);
  const always = KPI_SCENES.has(type);
  // tiến độ so với kỳ vọng theo giờ (08:00 → 17:30); sáng sớm thì bỏ qua cho đỡ nhiễu
  const expected = clamp((minuteOfDay - 480) / 570, 0, 1);
  if (target > 0 && (expected >= 0.1 || always)) {
    const ratio = num(a.kpiToday) / target;
    const pace = expected > 0 ? ratio / expected : 1;
    // cảnh thường: chỉ nói khi đáng chú ý (đúng tiến độ thì im cho đỡ tốn token, đỡ nhiễu)
    if (always || pace < 0.85 || pace >= 1.3) {
      const label = expected < 0.1 ? 'mới đầu ngày' : pace >= 1.3 ? 'vượt tiến độ' : pace >= 0.85 ? 'đúng tiến độ' : pace >= 0.6 ? 'hơi chậm' : 'chậm nhiều';
      parts.push(`KPI ${Math.round(ratio * 100)}% (${label})`);
    }
  }
  if (KPI_HISTORY_SCENES.has(type) && Array.isArray(a.kpiHistory) && a.kpiHistory.length) {
    const h = a.kpiHistory.slice(-3).filter((x) => x && Number.isFinite(x.ratio));
    if (h.length) parts.push(`KPI trước: ${h.map((x) => `ngày ${x.day} ${Math.round(x.ratio * 100)}%`).join(', ')}`);
  }
  if (num(a.lowStreak) > 0) parts.push(`KPI thấp ${a.lowStreak} ngày liền`);
  if (num(a.warnings) > 0) parts.push(`HR đã nhắc ${a.warnings} lần`);
  if (num(a.caughtToday) > 0) parts.push(`hôm nay bị sếp bắt lười ${a.caughtToday} lần`);
  return parts.join(', ');
}

/** v3: thâm niên, thưởng/thăng chức, thử thách — chỉ cho cảnh nhân sự trang trọng */
function tenureNote(a: AgentState, ctx: PromptContext): string {
  if (a.role === 'boss' || a.role === 'hr' || a.status !== 'active') return '';
  const parts: string[] = [];
  const daysIn = ctx.day - num(a.hiredDay, 1);
  if (daysIn >= 3) parts.push(`làm ở công ty ${daysIn} ngày`);
  if (num(a.bonuses) > 0) parts.push(`đã được thưởng ${a.bonuses} lần`);
  if (num(a.promotions) > 0) parts.push(`đã thăng chức ${a.promotions} lần`);
  if (typeof a.probationUntilDay === 'number' && a.probationUntilDay >= ctx.day) parts.push(`đang trong thời gian thử thách tới ngày ${a.probationUntilDay}`);
  return parts.join(', ');
}

/** v3: sở thích (để nhân vật liên hệ tin thời sự sang đời mình) — bỏ món liên quan sản phẩm/đồng nghiệp */
function likesNote(a: AgentState, max = 3): string {
  const ls = (Array.isArray(a.likes) ? a.likes : []).filter((l) => typeof l === 'string' && l.trim() && !/anh |chị |với /iu.test(l));
  return ls.slice(0, max).map((l) => cut(l, 28)).join(', ');
}

/** "Tùng→Vy −23 (lý do)" chỉ với người trong cảnh / người được nhắc; mạnh nhất trước. */
function feelingsNote(a: AgentState, targets: AgentState[], max: number, mustInclude?: string): string {
  const items: { score: number; text: string; must: boolean }[] = [];
  for (const o of targets) {
    if (o.id === a.id) continue;
    const r = a.relationships?.[o.id];
    if (!r) continue;
    const score = num(r.score);
    if (Math.abs(score) < 5) continue;
    const note = r.note && r.note !== 'người mới' ? ` (${cut(r.note, 36)})` : '';
    items.push({ score, text: `${a.name}→${o.name} ${signed(score)}${note}`, must: o.id === mustInclude });
  }
  items.sort((x, y) => Number(y.must) - Number(x.must) || Math.abs(y.score) - Math.abs(x.score));
  return items.slice(0, max).map((x) => x.text).join(' · ');
}

function memoryNote(a: AgentState, day: number, max: number, maxChars: number): string {
  const ms = Array.isArray(a.memories) ? a.memories.slice(-max) : [];
  return ms
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const ago = day - num(m.day, day);
      const prefix = ago <= 0 ? '' : ago === 1 ? 'hôm qua: ' : `${ago} ngày trước: `;
      return prefix + cut(m.text, maxChars);
    })
    .join('; ');
}

function activityNote(a: AgentState): string {
  if (!a.present) return 'không có ở văn phòng';
  if (a.activity === 'scene' || !a.activityLabel) return '';
  // nhãn hoạt động có thể đã mang chữ "đang" ("đang code") → bỏ để không thành "đang đang code"
  return `${cut(a.activityLabel.replace(/^\s*đang\s+/iu, ''), 40)}${a.emote ? ' ' + a.emote : ''}`;
}

/** Thẻ 1 dòng (+ 1 dòng quan hệ/ký ức nếu có). */
function personCard(a: AgentState, ctx: PromptContext, feelTargets: AgentState[], online: boolean, lim: SceneLimits, type: SceneType, aboutId?: string): string {
  const head: string[] = [`[${a.id}] ${a.name} · ${roleText(a, ctx)} · ${a.gender} ${num(a.age, 28)}`];
  if (a.bio) head.push(cutSentence(a.bio, lim.bio));
  if (a.speechStyle) head.push(`Giọng: ${cut(a.speechStyle, lim.voice)}`);
  if (a.status !== 'candidate') {
    const act = activityNote(a);
    if (act) head.push(online ? `vừa nhắn vừa ${act}` : `đang ${act}`);
    head.push(bodyNote(a));
    const kpi = kpiNote(a, ctx.minuteOfDay, type);
    if (kpi) head.push(kpi);
    if (TENURE_SCENES.has(type)) {
      const tenure = tenureNote(a, ctx);
      if (tenure) head.push(tenure);
    }
    if (type === 'news_chat') {
      const likes = likesNote(a);
      if (likes) head.push(`thích: ${likes}`);
    }
  }
  const tail: string[] = [];
  const feel = feelingsNote(a, feelTargets, lim.feel, aboutId);
  if (feel) tail.push(feel);
  const mem = memoryNote(a, ctx.day, lim.mem, lim.memChars);
  if (mem) tail.push(`nhớ: ${mem}`);
  return head.join(' · ') + (tail.length ? `\n  ${tail.join(' · ')}` : '');
}

function projectLine(ctx: PromptContext): string {
  const c = ctx.company;
  const p = c?.project;
  const parts: string[] = [];
  if (p) {
    const left = num(p.deadlineDay, ctx.day) - ctx.day;
    const due = left > 1 ? `còn ${left} ngày` : left === 1 ? 'hạn là ngày mai' : left === 0 ? 'hạn là HÔM NAY' : `TRỄ HẠN ${-left} ngày`;
    parts.push(`dự án "${cut(p.name, 50)}" cho ${cut(p.client, 36)}${p.desc ? ` (${cut(p.desc, 60)})` : ''} — xong ${Math.round(num(p.progress))}%, ${due}`);
  }
  if (c) {
    parts.push(`doanh thu tháng ${Math.round(num(c.revenueMonth))}/${Math.round(num(c.revenueTarget))} triệu`);
    if (num(c.projectsDone) > 0) parts.push(`đã giao ${c.projectsDone} dự án`);
    if (c.incident === 'server_down') parts.push('SỰ CỐ: server đang sập');
    if (c.incident === 'wifi_down') parts.push('SỰ CỐ: mất wifi cả văn phòng');
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------- USER PROMPT: CẢNH

/**
 * Phần cố định của khối sản phẩm (CẤM, luật giá, ai nói / gọi món ra sao) không co theo bậc → cảnh có sản phẩm được thêm
 * ngân sách cố định này, để bậc gọn không phải cắt tiểu sử / ký ức nhân vật chỉ vì khối món đồ (đo 2026-11-03: không có
 * khoản này thì ~3/4 cảnh có sản phẩm bị ép về bậc gọn nhất).
 */
export const PRODUCT_TOKEN_ALLOWANCE = 150;

export function buildSceneUserPrompt(req: SceneRequest, ctx: PromptContext): string {
  const n = Array.isArray(req.participants) ? req.participants.length : 3;
  return fitSceneBudget(n, (lim) => renderScene(req, ctx, lim), req.product ? PRODUCT_TOKEN_ALLOWANCE : 0);
}

/** cắt "chuyện" theo bậc nhưng giữ nguyên các ngoặc ngắn (cớ, lưu ý an toàn như "(chỉ tự giễu, không chê ai)") — chỉ cắt phần kể */
function cutAngle(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const parens = t.match(/\([^()]{1,120}\)/g) ?? [];
  if (!parens.length) return cut(t, max);
  const keep = parens.join(' ');
  const base = t.replace(/\s*\([^()]{1,120}\)/g, '').replace(/\s+/g, ' ').trim();
  return `${cut(base, Math.max(40, max - keep.length - 1))} ${keep}`;
}

function renderScene(req: SceneRequest, ctx: PromptContext, lim: SceneLimits): string {
  const agents = ctx.agents ?? {};
  const people = req.participants.map((id) => agents[id]).filter((a): a is AgentState => !!a);
  const about = req.aboutId && !req.participants.includes(req.aboutId) ? agents[req.aboutId] ?? null : null;
  const feelTargets = about ? [...people, about] : people;
  const online = req.channel !== 'office';
  const allowed = new Set(req.allowedEffects ?? []);
  const nameOf = (id: string | undefined) => (id && agents[id]?.name) || id || '?';

  // A/B cho định hướng: desk_visit = người ghé/người bị ghé; confront = người bị đồn/người tung tin;
  // cảnh nhân sự v3 (xin nghỉ, xin tăng lương, thăng chức, cắt giảm) = nhân viên là nhân vật chính (aboutId hoặc người đầu không phải sếp/HR)
  const subjectId = req.type === 'confront'
    ? [req.rumor?.aboutId, req.aboutId].find((x) => !!x && req.participants.includes(x)) ?? req.participants[0]
    : SUBJECT_IS_EMPLOYEE.has(req.type)
      ? (req.aboutId && req.participants.includes(req.aboutId) ? req.aboutId
        : req.participants.find((id) => agents[id] && agents[id].role !== 'boss' && agents[id].role !== 'hr') ?? req.participants[0])
      : req.participants[0];
  const otherId = req.participants.find((id) => id !== subjectId);
  const direction = (SCENE_DIRECTION[req.type] ?? '')
    .replace(/\{A\}/g, nameOf(subjectId))
    .replace(/\{B\}/g, otherId ? nameOf(otherId) : 'người kia');
  const bossInScene = people.some((a) => a.role === 'boss');
  const bossNote = bossInScene ? 'đang trong cảnh này' : cut(String(ctx.bossNote ?? '').replace(/^sếp\s+/i, ''), 60);

  const L: string[] = [];
  L.push('NHIỆM VỤ: CẢNH');
  L.push(`Loại: ${req.type} — ${direction}`);
  L.push(`Kênh: ${CHANNEL_STYLE[req.channel] ?? req.channel} · Nơi: ${cut(req.locationLabel, 60)}`);
  L.push(`Lúc: ${ctx.timeLabel || hhmm(ctx.minuteOfDay)} ${ctx.weekday}, ngày ${ctx.day} (${partOfDay(ctx.minuteOfDay)}) · Sếp: ${ctx.bossAway ? 'VẮNG' : 'có mặt'}${bossNote ? ` — ${bossNote}` : ''}`);
  const proj = projectLine(ctx);
  if (proj) L.push(`Công ty: ${proj}`);
  L.push(`Tình huống: ${cutSentence(req.situation, lim.situation)}`);
  if (req.topicHint && req.type !== 'news_chat') L.push(`Gợi ý chủ đề (nếu hợp): ${cut(req.topicHint, 100)}`);
  const extra = (req.extra ?? []).filter((x) => typeof x === 'string' && x.trim()).slice(0, lim.extra);
  if (extra.length) L.push('Thêm:', ...extra.map((x) => `- ${cut(x, lim.extraChars)}`));

  // v3: tin thật đang bàn (news_chat, hoặc Director gắn tin làm chủ đề cho cảnh tám chuyện)
  if (req.news && typeof req.news === 'object') L.push(...newsLines(req.news, people, req.type !== 'news_chat'));
  // v3: hồ sơ nhân sự để AI quyết (hr_review)
  if (req.type === 'hr_review') L.push(...dossierLines(req, agents, ctx));

  L.push('NHÂN VẬT (chỉ những người này được nói):');
  for (const a of people) L.push(personCard(a, ctx, feelTargets, online, lim, req.type, about?.id));
  if (about) {
    const where = about.present ? (activityNote(about) || 'đang ở văn phòng') : 'không có ở văn phòng';
    L.push(`NGƯỜI ĐƯỢC NHẮC (vắng mặt, không nói): [${about.id}] ${about.name} · ${about.roleLabel} · ${about.gender} ${num(about.age, 28)} · ${cutSentence(about.bio, Math.min(lim.bio, 120))} · lúc này: ${where}`);
  }

  L.push(...addressLines(people, req.channel, about));

  // người còn lại: chỉ để nhắc tên; kèm id khi model có thể phải tự chọn aboutId cho tin đồn mới
  // (hr_review: HỒ SƠ đã liệt kê mọi người → bỏ danh sách này cho gọn)
  const needIds = allowed.has('rumor') && !req.rumor;
  const described = new Set([...req.participants, ...(about ? [about.id] : []), ...(req.type === 'hr_review' ? (req.hrDossier ?? []).map((d) => d.id) : [])]);
  const roster = (ctx.roster ?? [])
    .filter((r) => !described.has(r.id))
    .map((r) => {
      const role = agents[r.id]?.role;
      const label = (role && SHORT_ROLE[role]) || cut(r.roleLabel, 20);
      return needIds ? `${r.name}[${r.id}] ${label}` : `${r.name} (${label})`;
    });
  if (roster.length) L.push(`NGƯỜI KHÁC trong công ty (chỉ để nhắc tên; ngoài họ không còn ai): ${roster.join(', ')}`);

  if (req.rumor) {
    const r = req.rumor;
    const subject = nameOf(r.aboutId);
    // người kể: tellerId nếu Director có gửi kèm (ngoài types.ts), không thì người khởi xướng [0]
    const rawTeller = (r as { tellerId?: unknown }).tellerId;
    const tellerId = typeof rawTeller === 'string' && req.participants.includes(rawTeller) ? rawTeller : req.participants[0];
    const listenerId = req.participants.find((id) => id !== tellerId && id !== r.aboutId);
    const teller = nameOf(tellerId);
    const listener = listenerId ? nameOf(listenerId) : 'người nghe';
    const text = cut(r.currentText, 180);
    // chỉ đòi rumor khi hiệu ứng rumor được phép (confront: Director không cho → tránh mâu thuẫn với YÊU CẦU)
    const must = allowed.has('rumor') ? ` rumor bắt buộc khác null: aboutId "${r.aboutId}", text = phiên bản vừa kể (1 câu ≤ 140 ký tự, ngôi thứ ba).` : '';
    if (req.type === 'confront') {
      L.push(`TIN ĐỒN đang lan về ${subject}: "${text}". ${nameOf(subjectId)} đã nghe phong thanh và đến hỏi tội ${otherId ? nameOf(otherId) : 'người tung tin'}.${must}`);
    } else if (r.isNew) {
      L.push(`TIN ĐỒN MỚI về ${subject}${text ? ` — mầm chuyện: "${text}"` : ''}. ${teller} tung tin cho ${listener}: giật gân mà vô hại (kiểu lén đi phỏng vấn, được sếp ưu ái, crush đồng nghiệp, đào coin bằng máy công ty), không tình dục, bệnh tật, phạm pháp, ngoại hình.${must}`);
    } else {
      L.push(`TIN ĐỒN đang lan về ${subject}, bản ${teller} nghe được: "${text}". ${teller} kể lại cho ${listener} nhưng thêm mắm dặm muối: phóng đại hoặc sai lệch 1–2 chi tiết (số, nơi, lý do, người), vẫn nhận ra cùng chuyện, vẫn vô hại (không tình dục, bệnh tật, phạm pháp).${must}`);
    }
  } else if (allowed.has('rumor')) {
    L.push('Tin đồn: nếu trong cảnh có người tung tin về đồng nghiệp vắng mặt thì rumor = {aboutId, text ≤ 140 ký tự}; không thì rumor = null.');
  }

  // v5: tình huống công ty — phương án để AI chốt (crisis_meeting) / điều cần thuyết phục (pep_talk)
  if (req.crisis) {
    const c = req.crisis;
    if (req.type === 'crisis_meeting') {
      const opts = (c.options ?? []).filter((o) => o && typeof o.code === 'string' && typeof o.label === 'string').slice(0, 4);
      if (opts.length) L.push(`PHƯƠNG ÁN (chốt đúng 1, ghi mã vào verdict): ${opts.map((o) => `${o.code} = ${cut(o.label, 100)}`).join(' · ')}`);
    } else if (req.type === 'pep_talk') {
      // note / topic đã có trong Tình huống (sitPepTalk) → chỉ nhắc tên tình huống
      L.push(`BỐI CẢNH: ${cut(c.title, 40)}`);
    }
  }

  if (req.product) {
    const p = req.product;
    const who = p.preferSpeaker && req.participants.includes(p.preferSpeaker) ? nameOf(p.preferSpeaker) : 'một người';
    // model hay chép nguyên tên catalogue → chỉ đưa tên đã bỏ thông số (27 inch, 750ml, 20.000mAh...) và cấm chép
    const shown = String(p.name ?? '').split(/\s+/)
      .filter((w, i) => i === 0 || !(/\d/.test(w) || /^(inch|ml|mah|cm|kg|gb|hz|w)$/i.test(w)))
      .join(' ');
    // có "facts" thì chỉ đưa tên (pitch lặp lại thông số đã có trong facts) — tiết kiệm token
    const head = p.facts ? `${cut(shown || p.name, 60)}.` : `${cut(shown || p.name, 60)} — ${cut(p.pitch, 130)}.`;
    // v4 (docs/04 §11): món đồ phải có "chuyện" — sự thật được nói, điều cấm, cảm nhận giá (không số), kiểu chuyện / cớ.
    // "Có thật" và "Chuyện" co theo bậc prompt (lim); CẤM và luật giá không bao giờ cắt.
    const mode = p.mode ?? (req.type === 'showroom_chat' ? 'showroom' : 'mention');
    const facts = p.facts ? ` Có thật (chỉ nói trong phạm vi này): ${cut(p.facts, lim.prodFacts)}.` : '';
    const avoid = p.avoid ? ` CẤM: ${cut(p.avoid, 150)}.` : '';
    const feel = p.priceFeel ? ` Giá: ${PRICE_FEEL[p.priceFeel]}, không nói số.` : ' Không nhắc giá.';
    // showroom_chat (mọi chế độ): "Chuyện quanh món này" đã nằm trong Tình huống (sitShowroom) → không lặp
    const story = req.type === 'showroom_chat' ? '' : p.angle ? ` Chuyện: ${cutAngle(p.angle, lim.prodAngle)}.` : p.hook ? ` Cớ: ${cut(p.hook, 90)}.` : '';
    const call = p.short ? `"${cut(p.short, 40)}" hoặc gọi trống (cái này, con này)` : 'kiểu đời thường (cái/con + loại đồ)';
    const rules = `${who} nói đúng 1 câu product=true, gọi là ${call}, không chép tên trên; không link, mã giảm, "mua ngay", giọng quảng cáo, không bịa ngoài phần có thật; chi tiết đời thường mới, hài, đúng tính cách.`;
    if (mode === 'unboxing') {
      L.push(`MÓN VỪA GIAO TỚI: ${head}${facts}${avoid}${feel}${story} Cảnh khui hộp: ${who} mở hộp, thử ngay, khoe; ${rules} Người khác trêu "lại tiêu tiền", xin dùng thử.`);
    } else if (mode === 'gift') {
      L.push(`QUÀ TẶNG: ${head}${facts}${avoid}${feel}${story} ${rules} Người nhận bất ngờ, cảm ơn vụng về, trêu lại.`);
    } else if (mode === 'owner') {
      L.push(`MÓN ĐỒ ${who.toUpperCase()} ĐÃ CÓ: ${head}${facts}${avoid}${feel}${story} ${who} kể lại như người đã dùng thật (ấn tượng, bất ngờ, chuyện vui khi dùng), chỉ trong phạm vi có thật; ${rules} Người nghe nghi ngờ rồi xiêu lòng hoặc trêu.`);
    } else if (mode === 'showroom') {
      L.push(`MÓN TRÊN KỆ: ${head}${facts}${avoid}${feel}${story} ${rules} Người khác khịa, nghi ngờ hoặc tiếc tiền rồi xuôi dần.`);
    } else {
      L.push(`MÓN ĐỒ CÓ THỂ LEN VÀO: ${head}${facts}${avoid}${feel}${story} Dẫn tự nhiên: chuyện đang nói chạm đúng nhu cầu hoặc rắc rối đó trước, rồi mới tới câu nhắc món; ${rules} Người khác phản ứng ngắn rồi quay lại chuyện chính.`);
    }
  }

  // hr_review họp kín theo hồ sơ → không cần chống lặp chủ đề (tiết kiệm token)
  const recent = req.type === 'hr_review' ? [] : (ctx.recentSummaries ?? []).filter((s) => typeof s === 'string' && s.trim()).slice(-lim.recent);
  if (recent.length) L.push('ĐÃ DIỄN GẦN ĐÂY (đừng lặp chủ đề, câu đùa):', ...recent.map((s) => `- ${cut(s, lim.recentChars)}`));

  const effects = [...allowed].filter((k) => k !== 'verdict' && k !== 'decisions').map((k) => EFFECT_LABEL[k] ?? k);
  const vr = VERDICT_RULES[req.type];
  const reqs: string[] = [
    `${req.minLines}–${req.maxLines} câu`,
    `speaker chỉ dùng: ${req.participants.join(', ')}`,
    `hiệu ứng được phép: ${effects.length ? effects.join(', ') : 'không có'}`,
    vr ? verdictReq(req, vr) : 'verdict: null',
    req.type === 'hr_review'
      ? 'hrDecisions: mỗi người trong HỒ SƠ đúng 1 mục {id, action, reason ≤ 80 ký tự}; action ∈ "được phép" của người đó (không thì "none"), khớp thoại'
      : 'hrDecisions: null',
    req.product ? 'đúng 1 câu product=true' : 'mọi câu product=false',
  ];
  L.push(`YÊU CẦU: ${reqs.join(' · ')}`);
  return L.join('\n');
}

/** Cảnh nhân sự v3 mà nhân vật chính là nhân viên (không phải sếp/HR) */
const SUBJECT_IS_EMPLOYEE = new Set<SceneType>(['resign_talk', 'raise_request', 'promotion', 'layoff']);

/** Khối TIN THẬT: thẻ tin (chỉ tiêu đề + tóm tắt + nguồn + lúc đăng) + luật an toàn + gợi ý liên hệ sở thích */
function newsLines(news: NonNullable<SceneRequest['news']>, people: AgentState[], incidental = false): string[] {
  const title = cut(news.title, 160);
  if (!title) return [];
  const summary = cut(news.summary, 200);
  const source = cut(news.source, 30) || 'báo';
  const cat = NEWS_CATEGORY_LABEL[String(news.category)] ?? '';
  const out: string[] = [];
  out.push(`TIN (thật, theo báo ${source} ${publishedAgo(news.publishedAt)}${cat ? `, mục ${cat}` : ''}): "${title}"${summary && summary !== title ? ` — tóm tắt của báo: "${summary}"` : ''}`);
  if (incidental) out.push('Tin này chỉ là một chuyện xen vào lúc tám ("nghe nói trên báo…"): bàn 2–3 câu theo LUẬT TIN THẬT rồi quay về chuyện của mình.');
  out.push(NEWS_RULES);
  const relate = people
    .map((a) => ({ name: a.name, likes: likesNote(a, 2) }))
    .filter((x) => x.likes)
    .map((x) => `${x.name} (${x.likes})`);
  if (relate.length) out.push(`Có thể liên hệ sang chuyện của mình: ${relate.join(' · ')}.`);
  return out;
}

/** Khối HỒ SƠ (hr_review): 1 dòng/người, gồm hành động được phép (hàng rào do Director tính) */
function dossierLines(req: SceneRequest, agents: Record<string, AgentState | undefined>, ctx: PromptContext): string[] {
  const rows = Array.isArray(req.hrDossier) ? req.hrDossier.filter((d) => d && typeof d.id === 'string' && d.id) : [];
  if (!rows.length) return ['HỒ SƠ: không có ai cần xét đặc biệt — hai người điểm qua tình hình chung, hrDecisions để [] hoặc toàn "none".'];
  const out: string[] = ['HỒ SƠ NHÂN SỰ (id · tên · vai · KPI gần nhất, % mục tiêu · tình trạng · thái độ · được phép):'];
  for (const d of rows.slice(0, 12)) {
    const name = cut(d.name || agents[d.id]?.name || d.id, 20);
    const role = agents[d.id]?.role;
    const roleText = (role && SHORT_ROLE[role]) || cut(d.roleLabel || agents[d.id]?.roleLabel || '', 20);
    const ratios = (Array.isArray(d.kpiRatios) ? d.kpiRatios : []).filter((r) => typeof r === 'number' && Number.isFinite(r)).slice(-5);
    const kpi = ratios.length ? `KPI ${ratios.map((r) => Math.round(r * 100)).join('→')}%` : 'KPI: chưa có số';
    const state: string[] = [];
    if (num(d.lowStreak) > 0) state.push(`thấp ${d.lowStreak} ngày liền`);
    if (num(d.warnings) > 0) state.push(`đã nhắc ${d.warnings} lần`);
    if (num(d.caughtToday) > 0) state.push(`bị bắt lười ${d.caughtToday} lần hôm nay`);
    const a = agents[d.id];
    if (a && typeof a.probationUntilDay === 'number' && a.probationUntilDay >= ctx.day) state.push(`đang thử thách tới ngày ${a.probationUntilDay}`);
    const mood = Math.round(num(d.mood, 60)), stress = Math.round(num(d.stress, 30));
    // chỉ ghi thể trạng khi đáng chú ý (bình thường thì im cho gọn)
    if (mood < 45 || stress > 60 || mood > 85) state.push(`tâm trạng ${mood}, stress ${stress}`);
    if (num(d.hiredDay, 0) > 1) state.push(`vào làm ngày ${d.hiredDay}`);
    const attitude = cut(d.attitude, 80);
    const allowed = (Array.isArray(d.allowed) ? d.allowed : []).filter((x) => typeof x === 'string' && x);
    const allowedText = allowed.length ? allowed.join(', ') : 'none';
    out.push(`- [${d.id}] ${name} · ${roleText} · ${kpi}${state.length ? ` · ${state.join(', ')}` : ''}${attitude ? ` · ${attitude}` : ''} · được phép: ${allowedText}`);
  }
  out.push('Action: warn=nhắc, second_chance=thêm cơ hội, probation=thử thách vài ngày, praise=khen, bonus=thưởng nóng, promote=thăng chức, fire=cho nghỉ, layoff=cắt giảm vì lỗ, open_position=tuyển thêm, none=không. Đừng phạt người mới/vượt KPI; fire chỉ khi hết cách. '
    + 'TRẦN 1 LẦN HỌP (quá trần bị gác lại — đừng hứa trong thoại): ≤ 4 quyết định khác none, ≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise+bonus; thường chỉ động tới 1–2 người.');
  return out;
}

// ---------------------------------------------------------------- v3: AI BIÊN KỊCH (showrunner) — system riêng, gọn, tĩnh

const BEATS_JSON = '{"beats":[{"kind":"conflict","a":"khoa","b":"phat","intensity":2,"note":"Khoa cự Phát vì hứa khách tính năng chưa có"}]}';

/** System prompt riêng cho nhiệm vụ BIẾN: tĩnh (cache), gọn (≈ 280 token ước lượng) để tổng ≤ 700. */
export function buildBeatsSystemPrompt(companyName: string): string {
  const name = cut(companyName || 'Cty TNHH VibeCorp', 60);
  return [
    `Bạn là biên kịch trưởng (showrunner) của sitcom văn phòng "Văn Phòng Ảo" về nhân viên ${name}: mỗi vài giờ chọn 1–3 "biến" (beat) cho vài giờ tới để chuyện tự nhiên mà có kịch tính; đạo diễn dựng thành cảnh.`,
    'Luật: kind lấy từ MENU; a/b là id trong NHÂN SỰ hoặc null; không nhân vật mới, không người thật, không chính trị, tình dục, bệnh nặng, phạm pháp; tin đồn tình cảm chỉ mức crush nhẹ. Hợp lý với TÌNH HÌNH, ưu tiên nối MẠCH ĐANG MỞ, không lặp BIẾN GẦN ĐÂY; đa số intensity 1–2, mức 3 hiếm và có lý do. note: 1 câu tiếng Việt có dấu ≤ 120 ký tự, cụ thể, có tên.',
    `Chỉ trả về MỘT object JSON, không markdown: ${BEATS_JSON}`,
  ].join('\n');
}

/** Trần token cho prompt động BIẾN (system riêng ≈ 280 → tổng ≤ 700) */
export const BEATS_USER_TOKEN_BUDGET = 410;
interface BeatLimits { situation: number; desc: number; arcs: number; recent: number; roleLabel: number }
const BEAT_TIERS: readonly BeatLimits[] = [
  { situation: 520, desc: 55, arcs: 5, recent: 5, roleLabel: 16 },
  { situation: 400, desc: 40, arcs: 4, recent: 4, roleLabel: 0 },
  { situation: 280, desc: 28, arcs: 3, recent: 3, roleLabel: 0 },
  { situation: 200, desc: 22, arcs: 2, recent: 2, roleLabel: 0 },
];

export function buildBeatsUserPrompt(req: BeatRequest, ctx: PromptContext): string {
  let out = '';
  for (const lim of BEAT_TIERS) {
    out = renderBeats(req, ctx, lim);
    if (estimateTokens(out) <= BEATS_USER_TOKEN_BUDGET) return out;
  }
  return out;
}

function renderBeats(req: BeatRequest, ctx: PromptContext, lim: BeatLimits): string {
  const L: string[] = [];
  L.push('NHIỆM VỤ: BIẾN');
  L.push(`Lúc: ${ctx.timeLabel || hhmm(ctx.minuteOfDay)} ${ctx.weekday}, ngày ${ctx.day} (${partOfDay(ctx.minuteOfDay)}) · Sếp: ${ctx.bossAway ? 'VẮNG' : 'có mặt'}`);
  const proj = projectLine(ctx);
  if (proj) L.push(`Công ty: ${proj}`);
  L.push(`TÌNH HÌNH: ${cutSentence(req.situation, lim.situation) || 'một ngày bình thường, chưa có gì nổi bật'}`);
  const roster = (Array.isArray(req.roster) ? req.roster : ctx.roster ?? []).filter((r) => r && typeof r.id === 'string' && r.id);
  L.push(`NHÂN SỰ (id Tên, vai): ${roster.map((r) => `${r.id} ${r.name}${lim.roleLabel ? `, ${cut(r.roleLabel, lim.roleLabel)}` : ''}`).join(' · ') || '(không có)'}`);
  const menu = (Array.isArray(req.menu) ? req.menu : []).filter((m) => m && typeof m.kind === 'string' && m.kind);
  L.push('MENU (kind — ý nghĩa):', ...menu.map((m) => `- ${m.kind} — ${cut(m.desc, lim.desc)}`));
  const arcs = (Array.isArray(req.openArcs) ? req.openArcs : []).filter((s) => typeof s === 'string' && s.trim()).slice(-lim.arcs);
  if (arcs.length) L.push('MẠCH ĐANG MỞ:', ...arcs.map((s) => `- ${cut(s, 110)}`));
  const recent = (Array.isArray(req.recentBeats) ? req.recentBeats : []).filter((s) => typeof s === 'string' && s.trim()).slice(-lim.recent);
  if (recent.length) L.push('BIẾN GẦN ĐÂY (đừng lặp):', ...recent.map((s) => `- ${cut(s, 80)}`));
  L.push('Trả về 1–3 biến hợp tình hình, không lặp: kind (trong MENU), a, b (id hoặc null), intensity 1–3, note tiếng Việt.');
  return L.join('\n');
}

// ---------------------------------------------------------------- USER PROMPT: ỨNG VIÊN

export const ROLE_AGE: Record<RoleKey, [number, number]> = {
  boss: [38, 50], hr: [27, 38], techlead: [29, 38], senior: [26, 33], junior: [21, 24],
  qa: [22, 30], designer: [22, 30], saleslead: [29, 40], salesnew: [21, 26], marketing: [22, 28],
};

const ROLE_SKILL: Record<RoleKey, string> = {
  boss: 'điều hành, đối ngoại, gặp nhà đầu tư',
  hr: 'tuyển dụng, chấm công, đánh giá KPI, tổ chức team building',
  techlead: 'kiến trúc hệ thống, review code, chịu trách nhiệm deploy',
  senior: 'backend/frontend vững, xử lý bug khó, hướng dẫn junior',
  junior: 'mới ra trường, biết React/Node cơ bản, hay hỏi ChatGPT',
  qa: 'test thủ công và tự động, soi bug, viết test case',
  designer: 'UI/UX, Figma, làm banner, cãi nhau vì 2px',
  saleslead: 'chốt hợp đồng phần mềm, chăm khách lớn, nhậu tiếp khách',
  salesnew: 'gọi điện tìm khách, demo phần mềm bán hàng, chạy KPI doanh số',
  marketing: 'content TikTok/Facebook, chạy quảng cáo, livestream',
};

export const CANDIDATE_ARCHETYPES: string[] = [
  'dân chuyển ngành từ ngân hàng, nói chuyện như đang tư vấn mở thẻ',
  'Gen Z thẳng như ruột ngựa, hỏi lương ngay câu đầu',
  'cựu streamer game, nói nhanh như bình luận viên',
  'người cầu toàn, cái gì cũng ghi vào sổ tay nhiều màu',
  'hay chêm tiếng Anh kiểu "basically", "actually"',
  'từng khởi nghiệp thất bại 2 lần, mở miệng là "mindset"',
  'fan cuồng K-pop, laptop dán đầy sticker thần tượng',
  'dân gym, hộp ức gà không rời tay',
  'mê tử vi, xem ngày đẹp trước khi làm việc lớn',
  'cực kỳ tự tin, CV dài 5 trang',
  'nhút nhát, nói nhỏ nhưng làm việc cực kỳ chắc tay',
  'ông bố/bà mẹ bỉm sữa quay lại đi làm, chuyện gì cũng liên hệ tới con',
  'freelancer lâu năm, quen làm việc lúc 2 giờ sáng',
  'dân phượt, cuối tuần nào cũng chạy xe đi Đà Lạt',
  'nghiện cà phê muối, review quán khắp Sài Gòn',
  'mê chứng khoán, 15 phút lại liếc bảng điện một lần',
  'từng làm công ty lớn, câu nào cũng "bên công ty cũ em..."',
  'thích quay TikTok, cái gì cũng muốn làm content',
  'trùm tiết kiệm, mang cơm nhà và săn mã freeship',
  'nói chuyện như đọc slide thuyết trình',
  'mê board game và câu đố mẹo, hay đố người khác',
  'hay lo xa, túi lúc nào cũng có dù, sạc dự phòng, dầu gió',
  'giọng hát karaoke "nhức nách", mơ làm ca sĩ công ty',
  'thánh đúng giờ, ghét ai trễ hẹn dù 1 phút',
];

const CANDIDATE_JSON = '{"name":"","fullName":"","gender":"nữ","age":24,"bio":"","speechStyle":"","quirks":[],"likes":[],"dislikes":[],'
  + '"traits":{"diligence":0.5,"laziness":0.5,"gossip":0.5,"temper":0.5,"humor":0.5,"ambition":0.5},'
  + '"look":{"skin":"#f1c27d","hair":"#1b1b1b","hairStyle":"bob","shirt":"#4f86f7","pants":"#2d3748","accessory":"none"}}';

export function buildCandidateUserPrompt(req: CandidateRequest, ctx: PromptContext, rng: () => number = Math.random): string {
  const [lo, hi] = ROLE_AGE[req.role] ?? [22, 35];
  const archetype = CANDIDATE_ARCHETYPES[Math.floor(rng() * CANDIDATE_ARCHETYPES.length) % CANDIDATE_ARCHETYPES.length];
  const gender = rng() < 0.5 ? 'nam' : 'nữ';
  const used = [...new Set((req.usedNames ?? []).filter((n) => typeof n === 'string' && n.trim()))];
  const L: string[] = [];
  L.push('NHIỆM VỤ: ỨNG VIÊN');
  L.push(`Vị trí: ${req.roleLabel} (${req.role}) · tuổi hợp lý ${lo}–${hi} · việc chính: ${ROLE_SKILL[req.role] ?? req.roleLabel}`);
  if (req.replacingName) L.push(`Thay cho ${req.replacingName} vừa bị cho nghỉ — ứng viên phải khác hẳn kiểu người cũ.`);
  L.push(`Gợi ý cá tính (biến tấu thoải mái): ${archetype} · giới tính gợi ý: ${gender}`);
  if (used.length) L.push(`Không dùng các tên gọi: ${used.join(', ')}`);
  const proj = projectLine(ctx);
  L.push(`Công ty lúc này: ngày ${ctx.day}${proj ? ' · ' + proj : ''}`);
  L.push('Hồ sơ một người Việt có cá tính rõ để thành nhân vật sitcom lâu dài: 1 điểm mạnh nổi bật + 1 tật buồn cười. '
    + 'name: tên gọi ngắn có dấu (vd "Hân"); fullName: họ tên đầy đủ (vd "Trịnh Gia Hân"); gender: "nam" | "nữ"; age: số nguyên. '
    + 'bio: 1–3 câu ≤ 200 ký tự (tính cách, hoàn cảnh, chỗ làm cũ), vẫn đúng sau khi được nhận, không nhắc buổi phỏng vấn. '
    + 'speechStyle ≤ 160 ký tự: cách nói, xưng hô (vd "xưng em với người lớn hơn"), câu cửa miệng. quirks, likes, dislikes: mỗi mảng 2–4 cụm ngắn. '
    + 'traits 0..1 (2 chữ số thập phân): diligence, laziness, gossip, temper, humor, ambition — có mạnh có yếu, diligence và laziness thường ngược nhau. '
    + 'look: skin, hair, shirt, pants là "#rrggbb" (da người Việt; tóc đen hoặc nâu, người trẻ có thể nhuộm); hairStyle: short|long|bun|ponytail|spiky|bald|curly|bob; accessory: none|glasses|headphones|tie|cap|bow.');
  L.push(`JSON (viết gọn trên 1 dòng, không xuống dòng, không thụt lề): ${CANDIDATE_JSON}`);
  return L.join('\n');
}

// ---------------------------------------------------------------- USER PROMPT: BẢN TIN

const RECAP_EVENT_MAX = 30;
const RECAP_JSON = '{"headline":"","bullets":[""],"mvp":{"id":"id","reason":""},"drama":""}';

export function buildRecapUserPrompt(req: RecapRequest, ctx: PromptContext): string {
  const agents = ctx.agents ?? {};
  let events = (req.events ?? []).filter((e) => typeof e === 'string' && e.trim()).map((e) => cut(e, 110));
  if (events.length > RECAP_EVENT_MAX) {
    // lấy mẫu đều, giữ sự kiện đầu và cuối ngày
    const step = (events.length - 1) / (RECAP_EVENT_MAX - 1);
    events = Array.from({ length: RECAP_EVENT_MAX }, (_, i) => events[Math.round(i * step)]);
  }
  const L: string[] = [];
  L.push('NHIỆM VỤ: BẢN TIN');
  L.push(`Bản tin cuối ngày ${req.day} (${req.weekday}) của ${ctx.companyName}.`);
  const proj = projectLine(ctx);
  if (proj) L.push(`Công ty: ${proj}`);
  L.push('SỰ KIỆN TRONG NGÀY (theo thứ tự):');
  L.push(...(events.length ? events.map((e) => `- ${e}`) : ['- (một ngày yên ả, không có gì đặc biệt)']));
  const kpi = (req.kpi ?? []).filter((k) => k && typeof k.id === 'string');
  if (kpi.length) {
    L.push('KPI CUỐI NGÀY (id — tên, vai: % mục tiêu):');
    for (const k of kpi) {
      const role = agents[k.id]?.role;
      const tag = role === 'boss' || role === 'hr' ? ' (không xét KPI)' : '';
      const streak = num(k.lowStreak) > 0 ? `; thấp ${k.lowStreak} ngày liền` : '';
      L.push(`- ${k.id} — ${k.name}, ${k.roleLabel}${tag}: ${Math.round(num(k.ratio) * 100)}%${streak}`);
    }
  }
  if (req.firedToday?.length) L.push(`Bị cho nghỉ hôm nay: ${req.firedToday.join(', ')}`);
  if (req.hiredToday?.length) L.push(`Mới nhận vào hôm nay: ${req.hiredToday.join(', ')}`);
  L.push('Giọng báo lá cải nội bộ: dí dỏm, hóng hớt, có tên người và con số; CHỈ dựa trên sự kiện và KPI ở trên, không bịa chuyện mới. '
    + 'headline: tít giật gân ≤ 90 ký tự. bullets: 3–5 ý, mỗi ý ≤ 140 ký tự. mvp: {id, reason ≤ 100 ký tự} người nổi bật nhất ngày (KPI cao hoặc màn để đời; không chọn Giám đốc), null nếu không ai xứng. drama: drama đáng nhớ nhất, 1–2 câu ≤ 200 ký tự.');
  L.push(`JSON (viết gọn trên 1 dòng, không xuống dòng, không thụt lề): ${RECAP_JSON}`);
  return L.join('\n');
}
