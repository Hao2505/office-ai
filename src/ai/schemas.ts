// =====================================================================
//  JSON schema TĨNH cho OpenAI Structured Outputs (strict: true).
//  Quy tắc strict: mọi object có additionalProperties:false, mọi key đều nằm trong
//  required; giá trị tuỳ chọn = nullable (type ['x','null'] hoặc anyOf với null).
//  QUAN TRỌNG: OpenAI đặt schema TRƯỚC system prompt trong prefix được cache →
//  không bao giờ nhét dữ liệu động (vd enum id nhân vật) vào đây, nếu không mọi
//  lần gọi đều trượt cache. Ràng buộc độ dài/khoảng số nằm trong description và
//  được brain kiểm tra lại (sanitize.ts), không dùng minItems/maxLength... để
//  tương thích cả model/proxy cũ.
// =====================================================================
import type { HrAction, Look, Verdict } from '../types.js';

export type JsonSchema = Record<string, unknown>;

const str = (description?: string): JsonSchema =>
  description ? { type: 'string', description } : { type: 'string' };
const int = (description?: string): JsonSchema =>
  description ? { type: 'integer', description } : { type: 'integer' };
const num = (description?: string): JsonSchema =>
  description ? { type: 'number', description } : { type: 'number' };
const arr = (items: JsonSchema, description?: string): JsonSchema =>
  description ? { type: 'array', description, items } : { type: 'array', items };
const obj = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] });

export const HAIR_STYLES: Look['hairStyle'][] = ['short', 'long', 'bun', 'ponytail', 'spiky', 'bald', 'curly', 'bob'];
export const ACCESSORIES: Look['accessory'][] = ['none', 'glasses', 'headphones', 'tie', 'cap', 'bow'];
/** Mọi kết quả cảnh có thể có (interview: hired/rejected · resign_talk: stay/leave · raise_request: approved/denied) */
/** Record đầy đủ theo union `Verdict` — thêm giá trị mới mà quên ở đây thì typecheck báo (schema enum không bị thiếu) */
const VERDICT_ENUM: Record<Verdict, true> = {
  hired: true, rejected: true, stay: true, leave: true, approved: true, denied: true,
  plan_a: true, plan_b: true, plan_c: true, plan_d: true, inspired: true, unmoved: true,
};
export const VERDICTS = Object.keys(VERDICT_ENUM) as Verdict[];
/** Quyết định nhân sự AI được chọn trong hr_review (code lọc lại theo `allowed` của từng người) */
export const HR_ACTIONS: HrAction[] = [
  'warn', 'fire', 'second_chance', 'probation', 'praise', 'bonus', 'promote', 'open_position', 'layoff', 'none',
];

// ---------------------------------------------------------------- cảnh hội thoại
// Thứ tự key = thứ tự model viết: thoại trước, rồi tóm tắt/hiệu ứng (khớp với thoại).
export const SCENE_SCHEMA_NAME = 'canh_hoi_thoai';
export const SCENE_SCHEMA: JsonSchema = obj({
  lines: arr(obj({
    speaker: str('id nhân vật nói (chuỗi ascii trong [ ]), không phải tên'),
    text: str('chỉ lời nói, tiếng Việt có dấu, tối đa 25 chữ'),
    emote: { type: ['string', 'null'], description: '1 emoji biểu cảm của người nói hoặc null' },
    product: { type: 'boolean', description: 'true duy nhất ở câu nhắc tới SẢN PHẨM' },
  }), 'các câu thoại theo thứ tự'),
  summary: str('1 câu tóm tắt ≤ 120 ký tự, ngôi thứ ba, có tên nhân vật'),
  relationshipChanges: arr(obj({
    from: str('id'),
    to: str('id'),
    delta: int('-15..15'),
    reason: str('≤ 60 ký tự'),
  })),
  moodChanges: arr(obj({ id: str('id'), delta: int('-15..15') })),
  memories: arr(obj({ id: str('id'), text: str('≤ 100 ký tự') })),
  kpiChanges: arr(obj({ id: str('id'), delta: int('-25..25') })),
  rumor: nullable(obj({
    aboutId: str('id người bị đồn'),
    text: str('phiên bản tin đồn vừa được kể, 1 câu ≤ 140 ký tự'),
  })),
  verdict: {
    anyOf: [{ type: 'string', enum: VERDICTS }, { type: 'null' }],
    description: 'interview: hired|rejected · resign_talk: stay|leave · raise_request: approved|denied · crisis_meeting: mã phương án đã chốt · pep_talk: inspired|unmoved · cảnh khác: null',
  },
  // v3: chỉ hr_review mới điền; cảnh khác null. Mỗi người trong HỒ SƠ tối đa 1 mục, action phải nằm trong "được phép" của người đó.
  hrDecisions: nullable(arr(obj({
    id: str('id người trong HỒ SƠ'),
    action: { type: 'string', enum: HR_ACTIONS },
    reason: str('1 câu tiếng Việt ≤ 80 ký tự'),
  }), 'quyết định nhân sự (chỉ hr_review)')),
});

// ---------------------------------------------------------------- v3: AI biên kịch (showrunner) — kế hoạch "biến"
export const BEATS_SCHEMA_NAME = 'ke_hoach_bien';
export const BEATS_SCHEMA: JsonSchema = obj({
  beats: arr(obj({
    kind: str('loại biến, phải là một kind trong MENU'),
    a: { type: ['string', 'null'], description: 'id nhân vật chính (trong NHÂN SỰ) hoặc null' },
    b: { type: ['string', 'null'], description: 'id nhân vật phụ hoặc null' },
    intensity: int('1 nhẹ · 2 vừa · 3 lớn'),
    note: str('1 câu tiếng Việt ≤ 120 ký tự: chuyện gì xảy ra'),
  }), '1–3 biến cho vài giờ tới'),
});

// ---------------------------------------------------------------- hồ sơ ứng viên
export const CANDIDATE_SCHEMA_NAME = 'ho_so_ung_vien';
export const CANDIDATE_SCHEMA: JsonSchema = obj({
  name: str('tên gọi ngắn, có dấu'),
  fullName: str('họ tên đầy đủ có dấu'),
  gender: { type: 'string', enum: ['nam', 'nữ'] },
  age: int(),
  bio: str('1-3 câu, ≤ 200 ký tự'),
  speechStyle: str('≤ 160 ký tự'),
  quirks: arr(str(), '2-4 cụm ngắn'),
  likes: arr(str(), '2-4 cụm ngắn'),
  dislikes: arr(str(), '2-4 cụm ngắn'),
  traits: obj({
    diligence: num('0..1'),
    laziness: num('0..1'),
    gossip: num('0..1'),
    temper: num('0..1'),
    humor: num('0..1'),
    ambition: num('0..1'),
  }),
  look: obj({
    skin: str('#rrggbb'),
    hair: str('#rrggbb'),
    hairStyle: { type: 'string', enum: HAIR_STYLES },
    shirt: str('#rrggbb'),
    pants: str('#rrggbb'),
    accessory: { type: 'string', enum: ACCESSORIES },
  }),
});

// ---------------------------------------------------------------- bản tin cuối ngày
export const RECAP_SCHEMA_NAME = 'ban_tin_ngay';
export const RECAP_SCHEMA: JsonSchema = obj({
  headline: str('≤ 90 ký tự'),
  bullets: arr(str('≤ 140 ký tự'), '3-5 ý'),
  mvp: nullable(obj({ id: str('id nhân viên'), reason: str('≤ 100 ký tự') })),
  drama: str('1-2 câu ≤ 200 ký tự'),
});
