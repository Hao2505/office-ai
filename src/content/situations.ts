// =====================================================================
//  v5 — "Tình huống công ty": khủng hoảng & chuyện quản lý như ở công ty thật
//  (kẹt tiền, thị trường khó, bị bóc phốt, tin vui, chuyện nhà ảnh hưởng công việc, chia phe, chống đối,
//   sếp làm công tác tư tưởng, đối thủ câu người, nhà đầu tư ghé thăm).
//
//  Mỗi tình huống là một mạch 4 bước do AI biên kịch chọn (hoặc kế hoạch offline): bùng phát → HỌP XỬ LÝ
//  (cảnh crisis_meeting: sếp / lead / HR bàn, AI CHỐT 1 phương án trong danh sách) → triển khai theo phương án
//  (thông báo, truyền lửa, hoà giải, giao việc, tăng ca…) → kết cục (code tung xác suất theo phương án + tình hình,
//  AI viết thoại). Thuần dữ liệu — story.ts ánh xạ thành hành động, director.ts thi hành. Xem docs/04 §16.
//  Văn bản dùng {a} {b} (người trung tâm / người thứ hai), {boss}; không nêu tên người thật, tổ chức thật.
//  KPI trong hiệu ứng giữ NHỎ (≤ 8, chỉ người trung tâm): cộng KPI cho cả nhóm sales/dev làm lệch "% KPI theo người"
//  (smoke:story kiểm không ai được ưu ái hệ thống — nguyên tắc 2).
// =====================================================================
import type { AgentState, RoleKey } from '../types.js';

export type PlanCode = 'plan_a' | 'plan_b' | 'plan_c' | 'plan_d';
export const PLAN_CODES: PlanCode[] = ['plan_a', 'plan_b', 'plan_c', 'plan_d'];

/** việc làm ngay sau khi chốt phương án (bước 3 của mạch) */
export type FollowKind =
  | 'announce'   // sếp đăng nhóm công ty + nhóm kín bàn tán quyết định
  | 'pep_all'    // sếp họp cả phòng "truyền lửa" (pep_talk — AI quyết có thuyết phục được không)
  | 'pep_one'    // sếp / lead nói chuyện riêng với người trung tâm (pep_talk 1:1)
  | 'mediate'    // HR (hoặc sếp) ngồi giữa hai phe (pep_talk biến thể hoà giải)
  | 'support'    // lead / HR ghé bàn người trung tâm, nói chuyện ấm áp
  | 'sales_push' // sếp giao việc gấp cho sales + sales tăng ca
  | 'overtime'   // team dev tăng ca
  | 'strict'     // sếp siết kỷ luật: đi tuần, gọi người trung tâm lên
  | 'party'      // khao / gắn kết ở góc chill
  | 'quiet';     // xử lý lặng lẽ: không thông báo, nhóm kín đoán già đoán non

/** hiệu ứng (đơn vị như World.adjust; revenue: triệu, ngẫu nhiên trong khoảng) */
export interface SitFx {
  all?: { mood?: number; stress?: number };              // mọi nhân viên đang làm (trừ sếp)
  // group chỉ có người khi phương án là sales_push / overtime, hoặc tình huống có người trong cuộc / hai phe (story.ts groupOf)
  center?: { mood?: number; stress?: number; kpi?: number };
  group?: { mood?: number; stress?: number; kpi?: number }; // nhóm bị ảnh hưởng: sales (sales_push), dev (overtime), hai phe (mediate)…
  boss?: { mood?: number; stress?: number };
  bossRel?: number;                                      // nhân viên → sếp
  revenue?: [number, number];
}

export interface PlanDef {
  code: PlanCode;
  /** ≤ 90 ký tự — vào prompt cuộc họp, nhật ký "chốt phương án" */
  label: string;
  follow: FollowKind;
  now?: SitFx;
  /** xác suất kết cục tốt trước khi chỉnh theo truyền lửa / mức độ */
  odds: number;
  good: { text: string; fx?: SitFx };
  bad: { text: string; fx?: SitFx; resign?: boolean; hrReview?: boolean };
  /** chỉ đưa ra bàn khi đúng tình hình */
  when?: (s: SitWorld) => boolean;
}

/** ảnh chụp tình hình để chọn phương án / trọng số (story.ts dựng) */
export interface SitWorld {
  revenuePct: number;      // doanh thu tháng / mục tiêu, %
  moodAvg: number;         // tâm trạng trung bình nhân viên
  staff: number;           // số nhân viên (trừ sếp)
  hasRole: (r: RoleKey) => boolean;
  negPair: boolean;        // có cặp "kỳ phùng" (mutual ≤ −15)
  star: boolean;           // có người KPI tuần ≥ 110 %
}

export interface SituationDef {
  kind: string;
  icon: string;
  title: string;
  /** mô tả trong thực đơn AI biên kịch (ngắn, nói rõ khi nào hợp) */
  menu: string;
  cast: 'none' | 'a' | 'ab';
  castA?: (x: AgentState) => number;
  castB?: (x: AgentState, a: AgentState) => number;
  /** câu mở màn (offline / AI bỏ trống note); {a} {b} */
  notes: string[];
  /** bước 1: dòng nhật ký + hiệu ứng + chuyện nhóm kín bàn */
  outbreak: { fx?: SitFx; whisper: string };
  /** bước 2: ai họp (ngoài người chủ trì — sếp, vắng thì HR), chủ đề, có gọi người trung tâm vào không */
  meeting: { roles: RoleKey[]; topic: string; withCenter?: boolean };
  plans: PlanDef[];
  /** trọng số offline / có lên thực đơn AI không (0 = không hợp lúc này) */
  weight: (s: SitWorld) => number;
}

const TECH: RoleKey[] = ['techlead', 'senior', 'junior', 'qa', 'designer'];
const BIZ: RoleKey[] = ['saleslead', 'salesnew', 'marketing'];
const isTechRole = (r: RoleKey): boolean => TECH.includes(r);
const isBizRole = (r: RoleKey): boolean => BIZ.includes(r);

export const SITUATIONS: SituationDef[] = [
  {
    kind: 'cash_crunch', icon: '💸', title: 'Kẹt tiền xoay vòng vốn',
    menu: 'công ty kẹt dòng tiền (khách chậm trả, quỹ lương căng): xì xào lương trễ → sếp họp xoay xở → hậu quả',
    cast: 'none',
    notes: [
      'Khách lớn chậm thanh toán hai đợt, quỹ lương tháng này căng như dây đàn',
      'Kế toán báo tài khoản công ty chỉ đủ chi thêm hai tuần',
      'Một hợp đồng lớn bị khách giữ tiền nghiệm thu, công ty hụt tiền trả lương',
    ],
    outbreak: { fx: { all: { stress: 4, mood: -2 } }, whisper: 'Có tin công ty đang kẹt tiền: cả nhóm đoán lương có về đúng ngày không, có người tính đường lui, có người trấn an' },
    meeting: { roles: ['hr', 'saleslead', 'techlead'], topic: 'xoay tiền trả lương và chi phí tháng này' },
    plans: [
      { code: 'plan_a', label: 'thắt lưng buộc bụng: tạm dừng trà sữa thứ Sáu, team building, tắt điều hoà sớm', follow: 'announce',
        now: { all: { mood: -3 } }, odds: 0.6,
        good: { text: 'Nhờ thắt lưng buộc bụng, tháng này qua được mà không ai bị trễ lương', fx: { all: { mood: 4, stress: -4 } } },
        bad: { text: 'Tiết kiệm từng đồng mà vẫn hụt, cả phòng vừa nóng vừa lo', fx: { all: { mood: -4, stress: 4 } } } },
      { code: 'plan_b', label: 'dồn sức đòi công nợ và chốt gấp hợp đồng mới: sales chạy hết công suất', follow: 'sales_push',
        now: { group: { stress: 8 } }, odds: 0.5,
        good: { text: 'Khách chuyển khoản rồi! Sales được cả công ty tung hô', fx: { group: { mood: 8, stress: -6 }, revenue: [20, 50] } },
        bad: { text: 'Đòi mãi chưa được, khách cứ hẹn "tuần sau", sales mệt rã rời', fx: { group: { mood: -6, stress: 5 } } },
        when: (s) => s.hasRole('saleslead') || s.hasRole('salesnew') },
      { code: 'plan_c', label: 'nói thẳng với anh em: lương trễ vài ngày, hứa trả đủ kèm chút bù', follow: 'pep_all',
        now: { all: { mood: -6 }, bossRel: -2 }, odds: 0.6,
        good: { text: 'Lương về trễ ba ngày nhưng đủ, kèm hộp bánh xin lỗi của sếp', fx: { all: { mood: 5 }, bossRel: 3 } },
        bad: { text: 'Lương trễ thêm, vài người bắt đầu lặng lẽ cập nhật CV', fx: { all: { mood: -6, stress: 5 }, bossRel: -3 }, resign: true } },
      { code: 'plan_d', label: 'sếp bỏ tiền túi / vay nóng trả lương đúng hạn, giữ kín chuyện', follow: 'quiet',
        now: { boss: { stress: 15 } }, odds: 0.75,
        good: { text: 'Lương về đúng hạn, không ai biết sếp vừa xoay cả đêm', fx: { all: { mood: 3 } } },
        bad: { text: 'Khoản vay nóng lãi cao, sếp mất ngủ cả tuần, khó ở ra mặt', fx: { boss: { stress: 10, mood: -8 } } } },
    ],
    weight: (s) => 0.2 + (s.revenuePct < 60 ? 0.5 : s.revenuePct < 85 ? 0.2 : 0),
  },
  {
    kind: 'market_slump', icon: '📉', title: 'Thị trường khó, khách cắt ngân sách',
    menu: 'kinh tế khó: khách cắt ngân sách, đối thủ phá giá; ban lãnh đạo họp tìm hướng, có thể tính chuyện cắt giảm (khi doanh thu thấp)',
    cast: 'none',
    notes: [
      'Hai khách quen cùng báo cắt ngân sách quý này vì kinh tế khó',
      'Đối thủ tung gói rẻ hơn 30%, khách mới hỏi rồi im luôn',
      'Thị trường chững lại, tháng này gần như không có khách mới gõ cửa',
    ],
    outbreak: { fx: { all: { stress: 3 } }, whisper: 'Cả nhóm bàn chuyện kinh tế khó, khách cắt ngân sách: lo bị cắt thưởng, đoán công ty có cắt người không, có người đùa đi bán trà sữa' },
    meeting: { roles: ['saleslead', 'techlead', 'hr'], topic: 'giữ doanh thu khi khách cắt ngân sách' },
    plans: [
      { code: 'plan_a', label: 'làm gói giá mềm cho khách nhỏ, mở thị trường mới', follow: 'announce',
        now: { all: { stress: 3 } }, odds: 0.5,
        good: { text: 'Gói giá mềm bán chạy bất ngờ, khách nhỏ gõ cửa liên tục', fx: { revenue: [15, 40], all: { mood: 4 } } },
        bad: { text: 'Gói rẻ bán chậm, làm thì nhiều mà tiền thì ít', fx: { all: { mood: -3, stress: 3 } } } },
      { code: 'plan_b', label: 'đóng băng tuyển dụng, cắt mọi chi phí không cần thiết', follow: 'announce',
        now: { all: { mood: -3 } }, odds: 0.65,
        good: { text: 'Gồng qua quý khó an toàn, không ai phải nghỉ', fx: { all: { mood: 3, stress: -3 } } },
        bad: { text: 'Cắt chi phí rồi mà doanh thu vẫn trôi, không khí nặng nề', fx: { all: { mood: -4 } } } },
      { code: 'plan_c', label: 'team dev tăng ca làm nhanh dự án để nhận tiền nghiệm thu sớm', follow: 'overtime',
        now: { group: { stress: 6 } }, odds: 0.55,
        good: { text: 'Bàn giao sớm, khách trả tiền nghiệm thu ngay, cả team thở phào', fx: { revenue: [20, 45], group: { mood: 6, stress: -4 } } },
        bad: { text: 'Tăng ca mệt nghỉ mà khách vẫn đòi sửa thêm, tiền chưa về', fx: { group: { mood: -6, stress: 6 } } },
        when: (s) => s.hasRole('techlead') || s.hasRole('senior') },
      { code: 'plan_d', label: 'chuẩn bị phương án cắt giảm nhân sự nếu tháng sau vẫn lỗ (HR xét lại)', follow: 'announce',
        now: { all: { mood: -6, stress: 6 } }, odds: 0.4,
        good: { text: 'Doanh thu nhích lên kịp, phương án cắt giảm được cất vào ngăn kéo', fx: { all: { mood: 6, stress: -6 } } },
        bad: { text: 'Doanh thu vẫn không lên, HR bắt đầu xem lại danh sách nhân sự', fx: { all: { stress: 5 } }, hrReview: true },
        when: (s) => s.revenuePct < 50 },
    ],
    weight: (s) => (s.revenuePct < 80 ? 0.2 + (s.revenuePct < 50 ? 0.5 : 0.15) : 0.05),
  },
  {
    kind: 'pr_crisis', icon: '📢', title: 'Khủng hoảng truyền thông',
    menu: 'công ty bị bóc phốt trên mạng (khách tố app lỗi / review 1 sao / ảnh chat nội bộ bị lộ); marketing (a) đứng mũi chịu sào',
    cast: 'a', castA: (x) => (x.role === 'marketing' ? 4 : x.role === 'saleslead' ? 1 : isBizRole(x.role) ? 0.6 : 0.15),
    notes: [
      'Một khách đăng bài tố app của công ty lỗi, hai nghìn lượt chia sẻ, {a} trực fanpage không kịp',
      'Fanpage công ty dính review 1 sao "tư vấn thái độ", {a} phải trả lời từng bình luận',
      'Ảnh chụp nhóm chat nội bộ bị lộ lên mạng, cư dân mạng vào bình luận, {a} toát mồ hôi',
      'Nhân viên cũ đăng bài kể khổ về công ty, {a} phát hiện đầu tiên',
    ],
    outbreak: { fx: { all: { stress: 4 }, center: { stress: 12, mood: -6 } }, whisper: 'Cả nhóm soi bài bóc phốt công ty trên mạng: đọc bình luận, đoán ai lộ, khuyên {a} bình tĩnh, có người lỡ thả haha' },
    meeting: { roles: ['hr', 'saleslead'], topic: 'xử lý bài bóc phốt đang lan', withCenter: true },
    plans: [
      { code: 'plan_a', label: 'xin lỗi công khai, nhận lỗi, sửa ngay và tặng bù cho khách', follow: 'announce',
        odds: 0.7,
        good: { text: 'Bài xin lỗi được khen "có tâm", phốt hoá thành quảng cáo', fx: { all: { mood: 4 }, center: { mood: 8, kpi: 5 }, revenue: [5, 20] } },
        bad: { text: 'Xin lỗi rồi mà vẫn bị cà khịa thêm vài hôm', fx: { center: { mood: -5, stress: 5 } } } },
      { code: 'plan_b', label: 'im lặng, chờ dư luận tự nguội', follow: 'quiet',
        odds: 0.4,
        good: { text: 'Hai hôm sau mạng xã hội có drama khác, chuyện chìm luôn', fx: { all: { stress: -3 } } },
        bad: { text: 'Im lặng bị coi là coi thường khách, bài bóc phốt lan tiếp', fx: { all: { mood: -5 }, center: { stress: 8 } } } },
      { code: 'plan_c', label: '{a} làm clip hài tự giễu, biến phốt thành trend', follow: 'pep_one',
        now: { center: { stress: 5 } }, odds: 0.5,
        good: { text: 'Clip tự giễu của {a} viral, khách mới còn nhắn hỏi mua', fx: { center: { mood: 12, kpi: 8 }, all: { mood: 3 }, revenue: [10, 30] } },
        bad: { text: 'Clip tự giễu bị chê vô duyên, càng thêm bị ném đá', fx: { center: { mood: -8, stress: 6 } } } },
      { code: 'plan_d', label: 'phản pháo đanh thép, yêu cầu người đăng gỡ bài', follow: 'announce',
        odds: 0.25,
        good: { text: 'Người đăng gỡ bài, nhắn xin lỗi riêng', fx: { all: { mood: 3 } } },
        bad: { text: 'Càng phản pháo càng bị ném đá, lên cả các trang hóng biến', fx: { all: { mood: -7, stress: 5 }, center: { mood: -6 } } } },
    ],
    weight: (s) => (s.hasRole('marketing') ? 0.3 : 0.15),
  },
  {
    kind: 'good_press', icon: '🌟', title: 'Tin vui về công ty',
    menu: 'tin tốt về công ty: báo khen sản phẩm / khách đăng bài cảm ơn / lọt top startup; sếp bàn cách tận dụng, nhân viên phấn chấn',
    cast: 'none',
    notes: [
      'Một trang công nghệ viết bài khen app của công ty "nhỏ mà có võ"',
      'Khách hàng đăng bài cảm ơn đội hỗ trợ của công ty, cả nghìn lượt thích',
      'Công ty lọt danh sách startup đáng chú ý của một diễn đàn công nghệ',
    ],
    outbreak: { fx: { all: { mood: 5, stress: -2 } }, whisper: 'Cả nhóm khoe bài báo khen công ty: chia sẻ lên trang cá nhân, đòi sếp khao, có người khịa "giờ mới thấy mình giỏi"' },
    meeting: { roles: ['saleslead', 'hr', 'techlead'], topic: 'tận dụng tin vui cho công ty' },
    plans: [
      { code: 'plan_a', label: 'khao cả công ty một bữa, thưởng nóng người có công', follow: 'party',
        now: { all: { mood: 6 } }, odds: 0.8,
        good: { text: 'Cả công ty phấn chấn, làm việc hăng hẳn', fx: { all: { mood: 4, stress: -3 } } },
        bad: { text: 'Khao xong ai cũng lâng lâng, việc trễ một nhịp', fx: { all: { stress: 3 } } } },
      { code: 'plan_b', label: 'tranh thủ chạy quảng cáo, sales gọi khách mới ngay khi đang nóng', follow: 'sales_push',
        now: { group: { stress: 5 } }, odds: 0.6,
        good: { text: 'Khách mới gõ cửa liên tục, sales chốt được hợp đồng', fx: { revenue: [20, 50], group: { mood: 6 } } },
        bad: { text: 'Khách hỏi nhiều mà chốt ít, sales hơi hụt hơi', fx: { group: { mood: -3, stress: 4 } } },
        when: (s) => s.hasRole('saleslead') || s.hasRole('salesnew') },
      { code: 'plan_c', label: 'khiêm tốn, nhắc anh em đừng ngủ quên trên chiến thắng', follow: 'pep_all',
        odds: 0.55,
        good: { text: 'Cả team giữ được lửa, KPI tuần này đẹp hẳn', fx: { all: { mood: 3, stress: -2 } } },
        bad: { text: 'Bị khịa sếp "khen mà không khao", không khí hơi chưng hửng', fx: { all: { mood: -3 }, bossRel: -2 } } },
    ],
    weight: (s) => 0.25 + (s.revenuePct >= 90 ? 0.2 : 0),
  },
  {
    kind: 'personal_trouble', icon: '🏠', title: 'Chuyện nhà ảnh hưởng công việc',
    menu: 'a gặp chuyện riêng (người nhà ốm, chia tay, bị đòi nhà, con ốm…) làm việc sa sút; lead/HR phát hiện và quyết cách xử lý',
    cast: 'a', castA: (x) => 0.5 + (Number.isFinite(x.stress) && x.stress > 60 ? 0.6 : 0) + (Number.isFinite(x.mood) && x.mood < 45 ? 0.5 : 0),
    notes: [
      'Ba của {a} nằm viện, {a} vừa làm vừa canh điện thoại',
      '{a} vừa chia tay, cả buổi nhìn màn hình mà không gõ được chữ nào',
      'Chủ nhà đòi lại phòng gấp, {a} vừa làm vừa đi tìm trọ',
      'Con nhỏ của {a} ốm mấy hôm, {a} thiếu ngủ trầm trọng',
      'Xe của {a} hỏng giữa đường, sửa hết nửa tháng lương, tinh thần đi xuống',
    ],
    outbreak: { fx: { center: { mood: -10, stress: 10, kpi: -10 } }, whisper: 'Cả nhóm (không có {a}) để ý dạo này {a} khác lạ: hỏi nhau chuyện gì, bàn cách giúp mà không làm {a} ngại' },
    meeting: { roles: ['hr', 'techlead', 'saleslead'], topic: 'giúp {a} vượt qua chuyện riêng mà công việc vẫn chạy' },
    plans: [
      { code: 'plan_a', label: 'cho {a} nghỉ phép vài hôm, team chia nhau gánh việc', follow: 'support',
        now: { center: { mood: 6 }, all: { stress: 2 } }, odds: 0.75,
        good: { text: '{a} quay lại tươi tỉnh hơn, cảm ơn cả team', fx: { center: { mood: 10, stress: -10 }, bossRel: 2 } },
        bad: { text: 'Team gánh việc mệt, có người lầm bầm "sao lần trước tui không được vậy"', fx: { all: { mood: -2, stress: 3 } } } },
      { code: 'plan_b', label: 'cho {a} linh hoạt giờ giấc, giảm việc tạm thời nhưng giữ deadline', follow: 'support',
        now: { center: { stress: -4 } }, odds: 0.65,
        good: { text: '{a} dần lấy lại nhịp, việc vẫn kịp hạn', fx: { center: { mood: 8, kpi: 6 } } },
        bad: { text: '{a} vẫn chưa ổn, việc dồn lại cuối tuần', fx: { center: { stress: 6 }, all: { stress: 2 } } } },
      { code: 'plan_c', label: 'nhắc nhẹ {a}: chuyện nhà để ở nhà, KPI vẫn phải đạt', follow: 'pep_one',
        odds: 0.35,
        good: { text: '{a} gồng lên được, KPI nhích lại', fx: { center: { kpi: 6 } } },
        bad: { text: '{a} tủi thân, bắt đầu nghĩ chuyện nghỉ việc', fx: { center: { mood: -8 }, bossRel: -3 }, resign: true } },
      { code: 'plan_d', label: 'công ty ứng trước lương / quyên góp giúp {a}', follow: 'announce',
        now: { center: { mood: 10 } }, odds: 0.8,
        good: { text: '{a} cảm động, hứa sẽ làm gấp đôi', fx: { center: { mood: 10, stress: -8 }, all: { mood: 3 }, bossRel: 3 } },
        bad: { text: 'Có người xì xào "sao lần trước tui khó không ai hỏi"', fx: { all: { mood: -2 } } } },
    ],
    weight: (s) => 0.35 + (s.moodAvg < 50 ? 0.2 : 0),
  },
  {
    kind: 'faction_split', icon: '⚔️', title: 'Chia bè kết phái',
    menu: 'văn phòng chia hai phe quanh a và b (ăn trưa riêng, nhóm chat riêng, nói xấu nhau); HR/sếp phát hiện và tìm cách giải quyết',
    cast: 'ab', castA: (x) => 0.5 + (Number.isFinite(x.traits?.gossip) ? x.traits.gossip : 0.5),
    castB: (x, a) => (isTechRole(x.role) === isTechRole(a.role) ? 0.6 : 1.3),
    notes: [
      'Phe {a} và phe {b} bắt đầu ăn trưa riêng, lập nhóm chat riêng, nói bóng gió nhau',
      'Dân kỹ thuật và dân kinh doanh chia phe, {a} và {b} đứng đầu hai bên, đổ lỗi qua lại',
      'Người cũ và người mới chia phe: {a} chê người mới "chưa hiểu văn hoá", {b} chê người cũ "bảo thủ"',
      'Phe trà sữa của {a} và phe cà phê đen của {b} căng thẳng từ chuyện đặt đồ uống chung',
    ],
    outbreak: { fx: { all: { stress: 3 } }, whisper: 'Nhóm kín của phe {a} nói bóng gió phe {b}: kể tội, khịa, rủ ăn trưa riêng; có người muốn đứng giữa mà sợ bị coi là phản bội' },
    meeting: { roles: ['hr', 'techlead', 'saleslead'], topic: 'chuyện văn phòng chia hai phe quanh {a} và {b}' },
    plans: [
      { code: 'plan_a', label: 'mời {a} và {b} ngồi lại nói thẳng, HR làm trọng tài', follow: 'mediate',
        odds: 0.55,
        good: { text: '{a} và {b} bắt tay làm lành, hai phe giải tán trong vui vẻ', fx: { all: { mood: 4, stress: -4 } } },
        bad: { text: 'Ngồi lại mà càng nói càng to tiếng, hai phe căng hơn', fx: { group: { mood: -5, stress: 5 } } } },
      { code: 'plan_b', label: 'team building bắt buộc, xếp lại chỗ ngồi xen kẽ hai phe', follow: 'party',
        odds: 0.5,
        good: { text: 'Chơi chung một buổi, hai phe cười với nhau trở lại', fx: { all: { mood: 4 } } },
        bad: { text: 'Team building mà hai phe chơi hai góc, ai cũng ngại', fx: { all: { mood: -2 } } } },
      { code: 'plan_c', label: 'cứng rắn: nhắc nhở người cầm đầu, ai còn nói xấu thì xét KPI', follow: 'strict',
        now: { group: { stress: 6 } }, odds: 0.45,
        good: { text: 'Bề ngoài êm hẳn, ai cũng lo làm việc', fx: { all: { stress: -2 } } },
        bad: { text: 'Bề ngoài êm nhưng ấm ức ngầm, có người bắt đầu chống đối', fx: { group: { mood: -5 }, bossRel: -3 } } },
      { code: 'plan_d', label: 'kệ, người lớn tự giải quyết', follow: 'quiet',
        odds: 0.3,
        good: { text: 'Hai phe tự làm lành sau một bữa nhậu tình cờ', fx: { all: { mood: 3 } } },
        bad: { text: 'Không ai can, chuyện chia phe ngày càng căng', fx: { group: { mood: -6, stress: 6 } } } },
    ],
    weight: (s) => (s.staff >= 5 ? 0.25 + (s.negPair ? 0.4 : 0) : 0),
  },
  {
    kind: 'pushback', icon: '✊', title: 'Nhân viên chống đối',
    menu: 'a công khai phản đối (từ chối tăng ca vô lý, phản đối chính sách mới như chấm công vân tay, cãi sếp trong họp); sếp/HR xử lý',
    cast: 'a', castA: (x) => 0.4 + (Number.isFinite(x.mood) && x.mood < 45 ? 0.6 : 0) + (Number.isFinite(x.traits?.ambition) ? x.traits.ambition * 0.5 : 0),
    notes: [
      '{a} công khai từ chối tăng ca cuối tuần: "em có cuộc sống riêng"',
      'Sếp ra quy định chấm công vân tay, đi trễ một phút trừ tiền; {a} đứng lên phản đối giữa buổi họp',
      '{a} cãi tay đôi với sếp về deadline "trên trời", cả phòng nín thở',
      '{a} rủ cả phòng ký kiến nghị bỏ họp sáng thứ Bảy',
    ],
    outbreak: { fx: { center: { stress: 8 }, boss: { stress: 6 } }, whisper: 'Cả nhóm bàn vụ {a} phản đối: người phục {a} dám nói, người sợ vạ lây, có người âm thầm ủng hộ' },
    meeting: { roles: ['hr'], topic: 'chuyện {a} phản đối', withCenter: true },
    plans: [
      { code: 'plan_a', label: 'lắng nghe, điều chỉnh chính sách cho hợp lý hơn', follow: 'announce',
        odds: 0.7,
        good: { text: 'Chính sách được sửa, {a} hả dạ, cả phòng nể sếp hơn', fx: { all: { mood: 4 }, center: { mood: 6 }, bossRel: 3 } },
        bad: { text: 'Sếp nhượng bộ xong, vài người được đà đòi thêm', fx: { boss: { stress: 6 } } } },
      { code: 'plan_b', label: 'thương lượng: {a} được như ý nhưng nhận thêm việc khác bù lại', follow: 'support',
        odds: 0.6,
        good: { text: '{a} gật đầu, hai bên cùng có lợi', fx: { center: { mood: 5, kpi: 5 } } },
        bad: { text: '{a} nhận việc bù mà trong bụng vẫn ấm ức', fx: { center: { mood: -4, stress: 4 } } } },
      { code: 'plan_c', label: 'kỷ luật: nhắc nhở chính thức, chống đối nữa thì xét KPI', follow: 'strict',
        now: { center: { mood: -6 }, all: { stress: 3 } }, odds: 0.4,
        good: { text: '{a} im lặng làm việc, không ai dám phản đối nữa', fx: { all: { stress: 2 } } },
        bad: { text: '{a} ấm ức, bắt đầu tính chuyện nghỉ việc', fx: { center: { mood: -8 }, bossRel: -4 }, resign: true } },
      { code: 'plan_d', label: 'sếp làm công tác tư tưởng riêng với {a}', follow: 'pep_one',
        odds: 0.55,
        good: { text: '{a} xuôi, còn hứa "em sẽ góp ý đúng kênh"', fx: { center: { mood: 6 }, bossRel: 2 } },
        bad: { text: '{a} nghe xong càng thấy mình đúng', fx: { center: { mood: -4 }, bossRel: -2 } } },
    ],
    weight: (s) => 0.3 + (s.moodAvg < 50 ? 0.3 : 0),
  },
  {
    kind: 'morale_talk', icon: '📣', title: 'Sếp làm công tác tư tưởng',
    menu: 'tinh thần anh em đi xuống (sau chuyện buồn, KPI căng, tin đồn); sếp và HR bàn cách "truyền lửa" lại cho công ty',
    cast: 'none',
    notes: [
      'Tinh thần anh em đi xuống rõ: ai cũng ỉu xìu, họp không ai nói',
      'Sau chuỗi ngày căng thẳng, văn phòng im như tờ, sếp quyết định phải "truyền lửa"',
      'HR báo cáo: mood cả phòng xuống thấp nhất từ đầu tháng',
    ],
    outbreak: { whisper: 'Cả nhóm than mệt, chán, không có động lực; có người gửi meme "thứ Hai lại tới", có người rủ nghỉ phép tập thể' },
    meeting: { roles: ['hr', 'techlead'], topic: 'vực lại tinh thần anh em' },
    plans: [
      { code: 'plan_a', label: 'họp toàn công ty, sếp truyền lửa bằng chuyện khởi nghiệp', follow: 'pep_all',
        odds: 0.55,
        good: { text: 'Bài nói của sếp chạm đúng chỗ, cả phòng có lửa trở lại', fx: { all: { mood: 6, stress: -3 } } },
        bad: { text: 'Bài nói dài quá, nửa phòng ngủ gật, nhóm kín chế meme', fx: { all: { mood: -2 }, bossRel: -2 } } },
      { code: 'plan_b', label: 'sếp nói chuyện riêng với người đang buồn nhất', follow: 'pep_one',
        odds: 0.6,
        good: { text: 'Người được sếp hỏi han cảm động, kể lại cho cả nhóm', fx: { center: { mood: 10 }, all: { mood: 2 } } },
        bad: { text: 'Nói chuyện riêng mà như lên lớp, về chỗ càng buồn', fx: { center: { mood: -5 } } } },
      { code: 'plan_c', label: 'khao trà sữa, cho về sớm chiều thứ Sáu', follow: 'party',
        now: { all: { mood: 5 } }, odds: 0.8,
        good: { text: 'Trà sữa + về sớm: cách truyền lửa hiệu quả nhất lịch sử', fx: { all: { mood: 5, stress: -4 } } },
        bad: { text: 'Vui được một buổi, hôm sau lại đâu vào đấy', fx: { all: { mood: -1 } } } },
      { code: 'plan_d', label: 'nhắc nhẹ: "lương là động lực, KPI là danh dự"', follow: 'announce',
        odds: 0.3,
        good: { text: 'Câu khẩu hiệu thành meme nội bộ, ai cũng cười, không khí dịu lại', fx: { all: { mood: 3 } } },
        bad: { text: 'Câu khẩu hiệu làm cả phòng thêm ngán', fx: { all: { mood: -4 }, bossRel: -3 } } },
    ],
    weight: (s) => (s.moodAvg < 55 ? 0.3 + (s.moodAvg < 45 ? 0.5 : 0.2) : 0.08),
  },
  {
    kind: 'poaching', icon: '🎣', title: 'Đối thủ câu người',
    menu: 'đối thủ nhắn a (người đang làm tốt) offer lương cao hơn hẳn; tin lan ra, sếp/HR bàn cách giữ người',
    cast: 'a', castA: (x) => 0.3 + (Number.isFinite(x.traits?.ambition) ? x.traits.ambition : 0.5) + (x.role === 'senior' || x.role === 'techlead' || x.role === 'saleslead' ? 0.6 : 0),
    notes: [
      'Công ty đối thủ nhắn {a}: lương cao hơn 30%, làm từ xa thoải mái',
      'Một headhunter gọi cho {a} ba lần trong tuần, tin lọt tới tai sếp',
      '{a} được bạn cũ rủ về công ty đối thủ, offer kèm chức trưởng nhóm',
    ],
    outbreak: { fx: { center: { mood: 3 }, boss: { stress: 6 } }, whisper: 'Cả nhóm (không có {a}) hóng chuyện {a} được đối thủ câu: đoán mức lương, khuyên đi hay ở, lo việc dồn sang mình' },
    meeting: { roles: ['hr', 'techlead', 'saleslead'], topic: 'giữ chân {a} trước lời mời của đối thủ' },
    plans: [
      { code: 'plan_a', label: 'tăng lương cho {a} để giữ người', follow: 'pep_one',
        now: { center: { mood: 6 } }, odds: 0.8,
        good: { text: '{a} ở lại, còn đùa "em ở vì team chứ không vì tiền đâu"', fx: { center: { mood: 6 }, all: { mood: -1 } } },
        bad: { text: '{a} cảm ơn nhưng vẫn muốn thử sức ở chỗ mới', fx: { center: { mood: 2 } }, resign: true } },
      { code: 'plan_b', label: 'hứa thăng chức và giao dự án lớn cho {a}', follow: 'pep_one',
        odds: 0.6,
        good: { text: '{a} ở lại, hào hứng với dự án mới', fx: { center: { mood: 8, kpi: 6 } } },
        bad: { text: '{a} thấy lời hứa mơ hồ quá', fx: { center: { mood: -3 } }, resign: true } },
      { code: 'plan_c', label: 'tôn trọng lựa chọn của {a}, âm thầm chuẩn bị người thay', follow: 'quiet',
        odds: 0.35,
        good: { text: '{a} quyết ở lại vì "ở đây vui hơn"', fx: { center: { mood: 6 }, bossRel: 2 } },
        bad: { text: '{a} biết chuyện tìm người thay, chạnh lòng', fx: { center: { mood: -6 } }, resign: true } },
      { code: 'plan_d', label: 'sếp làm công tác tư tưởng: nhắc chuyện gắn bó, "chúng ta là một gia đình"', follow: 'pep_one',
        odds: 0.45,
        good: { text: '{a} xúc động, xé luôn lời mời của đối thủ', fx: { center: { mood: 6 }, bossRel: 3 } },
        bad: { text: '{a} nghe "gia đình" xong càng muốn đi', fx: { center: { mood: -3 }, bossRel: -2 }, resign: true } },
    ],
    weight: (s) => (s.star ? 0.4 : 0.12),
  },
  {
    kind: 'investor_visit', icon: '🤵', title: 'Nhà đầu tư ghé thăm',
    menu: 'nhà đầu tư sắp ghé văn phòng: sếp bắt cả công ty chuẩn bị (dọn bàn, mặc đẹp, demo); kết quả có thể là rót vốn hoặc "sẽ cân nhắc"',
    cast: 'none',
    notes: [
      'Sếp báo chiều mai nhà đầu tư ghé văn phòng, cả công ty phải chuẩn bị',
      'Một quỹ đầu tư hẹn tới xem văn phòng, sếp mất ngủ cả đêm',
      'Nhà đầu tư thiên thần muốn tận mắt xem team làm việc trước khi rót vốn',
    ],
    outbreak: { fx: { all: { stress: 3 }, boss: { stress: 8 } }, whisper: 'Cả nhóm bàn vụ nhà đầu tư sắp tới: dọn bàn, mượn áo sơ mi, cá xem sếp sẽ "diễn" thế nào, có người lo bị hỏi khó' },
    meeting: { roles: ['saleslead', 'techlead', 'hr'], topic: 'chuẩn bị đón nhà đầu tư' },
    plans: [
      { code: 'plan_a', label: 'trình bày thật: số liệu thật, demo bản đang chạy ổn định', follow: 'announce',
        odds: 0.55,
        good: { text: 'Nhà đầu tư thích sự thẳng thắn, đồng ý rót vốn', fx: { revenue: [40, 90], all: { mood: 8, stress: -5 } } },
        bad: { text: 'Nhà đầu tư nói "sẽ cân nhắc thêm", sếp cười gượng', fx: { boss: { mood: -6 }, all: { mood: -2 } } } },
      { code: 'plan_b', label: 'dàn dựng cho đẹp: dọn bàn, ai cũng tỏ ra bận rộn', follow: 'strict',
        now: { all: { stress: 4 } }, odds: 0.45,
        good: { text: 'Màn "diễn" trót lọt, nhà đầu tư khen văn phòng năng động', fx: { revenue: [30, 70], all: { mood: 4 } } },
        bad: { text: 'Đang diễn thì có người lỡ mở game, nhà đầu tư nhìn thấy hết', fx: { boss: { mood: -8 }, all: { mood: -3 } } } },
      { code: 'plan_c', label: 'cho dev demo tính năng mới dù chưa xong hẳn', follow: 'overtime',
        now: { group: { stress: 8 } }, odds: 0.4,
        good: { text: 'Demo chạy mượt bất ngờ, nhà đầu tư gật gù rót vốn', fx: { revenue: [40, 90], group: { mood: 8 } } },
        bad: { text: 'Demo báo lỗi đúng lúc nhà đầu tư nhìn vào, cả phòng đứng hình', fx: { group: { mood: -8, stress: 6 }, boss: { mood: -6 } } },
        when: (s) => s.hasRole('techlead') || s.hasRole('senior') },
    ],
    weight: () => 0.15,
  },
];

export const SITUATION_KINDS: string[] = SITUATIONS.map((s) => s.kind);
const BY_KIND = new Map(SITUATIONS.map((s) => [s.kind, s] as const));
export const situationDef = (kind: string): SituationDef | undefined => BY_KIND.get(kind);
export const isSituation = (kind: string): boolean => BY_KIND.has(kind);

/** điền tên vào {a} {b} {boss} */
export function fillSit(text: string, names: { a?: string; b?: string; boss?: string }): string {
  return text.replace(/\{a\}/g, names.a || 'một người').replace(/\{b\}/g, names.b || 'người kia').replace(/\{boss\}/g, names.boss || 'sếp');
}

/** phương án được đưa ra bàn lúc này (lọc `when`), luôn ≥ 2 */
export function plansFor(def: SituationDef, s: SitWorld): PlanDef[] {
  const ok = def.plans.filter((p) => !p.when || p.when(s));
  return ok.length >= 2 ? ok : def.plans.slice(0, 2);
}

export { isTechRole, isBizRole };
