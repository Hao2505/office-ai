// =====================================================================
//  Ngân sách token cho prompt (gói miễn phí giới hạn token/ngày).
//  Đo thật trên Gemini với tiếng Việt có dấu: system + user gộp ≈ 2.8–3.0 ký tự/token, nhưng
//  riêng phần user động (id, số, dấu câu) chỉ ≈ 2.65 → dùng 2.7 cho phần này
//  (trần ở đây là chốt chặn, không phải số đo).
//  Prompt động của cảnh được dựng theo "bậc" (tier): bậc sau cắt gọn hơn bậc trước;
//  prompts.ts thử từ bậc đầu, vượt trần thì xuống bậc kế.
// =====================================================================

export const CHARS_PER_TOKEN = 2.7;

/** Ước lượng token (thiên về đếm dư một chút cho an toàn). */
export function estimateTokens(s: string): number {
  return Math.ceil(String(s ?? '').length / CHARS_PER_TOKEN);
}

/** Mục tiêu: system ≤ ~1300 token thật kèm schema (tĩnh, giống nhau mọi lần gọi). */
export const SYSTEM_TOKEN_TARGET = 1300;

/** Trần token cho prompt động của CẢNH theo số người nói: ≤ 3 người 1200, mỗi người thêm +200, tối đa 2000. */
export function sceneUserTokenBudget(people: number): number {
  const n = Number.isFinite(people) ? Math.max(1, Math.floor(people)) : 3;
  return Math.min(2000, 1200 + Math.max(0, n - 3) * 200);
}

/** Giới hạn độ dài từng mục trong prompt cảnh (ký tự / số mục). */
export interface SceneLimits {
  bio: number;          // tiểu sử mỗi người
  voice: number;        // "giọng" mỗi người
  feel: number;         // số quan hệ tối đa mỗi người
  mem: number;          // số ký ức mỗi người
  memChars: number;
  recent: number;       // số tóm tắt cảnh gần đây
  recentChars: number;
  extra: number;        // số dòng "bối cảnh thêm"
  extraChars: number;
  situation: number;    // tình huống (Director viết ≤ 690)
  /** v4: khối sản phẩm co theo bậc — "có thật" và "chuyện" (CẤM / luật giá KHÔNG bao giờ cắt) */
  prodFacts: number;
  prodAngle: number;
}

/** Bậc 0 = đầy đủ nhất; bậc sau gọn hơn. */
export const SCENE_TIERS: readonly SceneLimits[] = [
  { bio: 140, voice: 100, feel: 4, mem: 2, memChars: 60, recent: 4, recentChars: 80, extra: 5, extraChars: 130, situation: 700, prodFacts: 180, prodAngle: 220 },
  { bio: 120, voice: 100, feel: 3, mem: 2, memChars: 55, recent: 5, recentChars: 70, extra: 4, extraChars: 110, situation: 700, prodFacts: 160, prodAngle: 180 },
  { bio: 100, voice: 90, feel: 2, mem: 1, memChars: 50, recent: 4, recentChars: 70, extra: 3, extraChars: 100, situation: 600, prodFacts: 130, prodAngle: 150 },
  { bio: 80, voice: 80, feel: 2, mem: 1, memChars: 45, recent: 3, recentChars: 60, extra: 2, extraChars: 90, situation: 500, prodFacts: 100, prodAngle: 120 },
];

/** Bậc khởi điểm theo số người: cảnh đông thì bắt đầu gọn hơn. */
export function startTier(people: number): number {
  return people >= 4 ? 1 : 0;
}

/**
 * Dựng prompt theo bậc, trả về bản đầu tiên nằm trong ngân sách (hoặc bản gọn nhất).
 * render(lim) phải thuần (không tác dụng phụ) vì có thể được gọi vài lần.
 * allowance: phần cố định không co theo bậc được cộng thêm vào ngân sách (vd khối sản phẩm — prompts.ts PRODUCT_TOKEN_ALLOWANCE).
 */
export function fitSceneBudget(people: number, render: (lim: SceneLimits) => string, allowance = 0): string {
  const budget = sceneUserTokenBudget(people) + Math.max(0, allowance);
  let out = '';
  for (let t = startTier(people); t < SCENE_TIERS.length; t++) {
    out = render(SCENE_TIERS[t]);
    if (estimateTokens(out) <= budget) return out;
  }
  return out;
}
