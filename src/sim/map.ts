// Bản đồ văn phòng dạng lưới ô (tile). Server giữ bản gốc, gửi xuống client để vẽ.
//
// v2 (docs/v2-contract.md §1): phòng WC cũ (x1..8, y1..6) thành PHÒNG TRƯNG BÀY (kệ làm đẹp / kệ công nghệ,
// sản phẩm affiliate của chủ dự án); WC mới là phòng kín trong hõm giữa phòng server và phòng họp
// (x19..22, y1..6), chỉ có cửa đóng ở (20,7),(21,7) — bên trong KHÔNG đi được, nhân viên đứng trước cửa rồi
// "vào" (ẩn, FrameAgent flag 8). Tủ locker dời xuống tường trên khu làm việc (x10..13, y8).

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Room extends Rect { id: string; label: string; floor: string }
export interface Furniture extends Rect { type: string; label?: string; blocked: boolean; owner?: string }

export const MAP_W = 60;
export const MAP_H = 34;

export const ROOMS: Room[] = [
  { id: 'work', label: 'Khu làm việc', x: 1, y: 8, w: 43, h: 25, floor: 'wood' },
  { id: 'showroom', label: 'Phòng trưng bày', x: 1, y: 1, w: 8, h: 6, floor: 'showroom' },
  { id: 'server', label: 'Phòng server', x: 10, y: 1, w: 8, h: 6, floor: 'dark' },
  { id: 'wc', label: 'WC', x: 19, y: 1, w: 4, h: 6, floor: 'tile' },
  { id: 'meeting', label: 'Phòng họp', x: 24, y: 1, w: 20, h: 9, floor: 'carpet' },
  { id: 'boss', label: 'Phòng Giám đốc', x: 45, y: 1, w: 14, h: 10, floor: 'boss' },
  { id: 'hall', label: 'Sảnh', x: 45, y: 12, w: 14, h: 10, floor: 'wood' },
  { id: 'pantry', label: 'Pantry', x: 45, y: 23, w: 14, h: 10, floor: 'tile' },
  { id: 'lounge', label: 'Góc chill', x: 24, y: 26, w: 19, h: 7, floor: 'rug' },
];

/** Phòng WC: bên trong (x19..22, y1..6) + 2 ô cửa (20,7),(21,7) đều không đi được (cửa vẽ đóng) */
export const WC_RECT: Rect = { x: 19, y: 1, w: 4, h: 6 };
export const WC_DOORS: readonly Pt[] = [{ x: 20, y: 7 }, { x: 21, y: 7 }];

// Bàn làm việc của từng nhân viên: desk (khối 3x2) + seat (ô ngồi ngay dưới bàn)
export const DESKS: Record<string, { desk: Rect; seat: Pt }> = {
  d_tl: { desk: { x: 12, y: 13, w: 3, h: 2 }, seat: { x: 13, y: 15 } },
  d_senior: { desk: { x: 17, y: 13, w: 3, h: 2 }, seat: { x: 18, y: 15 } },
  d_junior: { desk: { x: 22, y: 13, w: 3, h: 2 }, seat: { x: 23, y: 15 } },
  d_qa: { desk: { x: 27, y: 13, w: 3, h: 2 }, seat: { x: 28, y: 15 } },
  d_design: { desk: { x: 32, y: 13, w: 3, h: 2 }, seat: { x: 33, y: 15 } },
  d_saleslead: { desk: { x: 12, y: 19, w: 3, h: 2 }, seat: { x: 13, y: 21 } },
  d_salesnew: { desk: { x: 17, y: 19, w: 3, h: 2 }, seat: { x: 18, y: 21 } },
  d_mkt: { desk: { x: 22, y: 19, w: 3, h: 2 }, seat: { x: 23, y: 21 } },
  d_hr: { desk: { x: 3, y: 11, w: 3, h: 2 }, seat: { x: 4, y: 13 } },
  d_boss: { desk: { x: 49, y: 4, w: 6, h: 2 }, seat: { x: 51, y: 3 } },
};

export const SPOTS: Record<string, Pt[]> = {
  entrance: [{ x: 1, y: 16 }, { x: 1, y: 17 }],
  coffee: [{ x: 56, y: 24 }, { x: 55, y: 24 }],
  fridge: [{ x: 56, y: 28 }],
  water: [{ x: 56, y: 31 }, { x: 55, y: 31 }],
  snack: [{ x: 46, y: 24 }, { x: 47, y: 24 }],
  pantry_table: [{ x: 47, y: 28 }, { x: 53, y: 28 }, { x: 49, y: 26 }, { x: 51, y: 26 }, { x: 49, y: 30 }, { x: 51, y: 30 }],
  lounge: [{ x: 28, y: 31 }, { x: 30, y: 31 }, { x: 32, y: 31 }, { x: 37, y: 30 }, { x: 39, y: 30 }],
  /** ô đứng trước cửa WC; tới nơi thì "vào trong" (hidden = true, không vẽ) */
  toilet: [{ x: 20, y: 8 }, { x: 21, y: 8 }],
  /** phòng trưng bày: đứng trước kệ LÀM ĐẸP (x1..4) / kệ CÔNG NGHỆ (x5..8), hàng y=3 (y=2 để trống cho sprite cao) */
  showroom_beauty: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
  showroom_tech: [{ x: 6, y: 3 }, { x: 7, y: 3 }, { x: 8, y: 3 }],
  pingpong: [{ x: 49, y: 17 }, { x: 56, y: 17 }],
  printer: [{ x: 46, y: 14 }],
  window: [{ x: 2, y: 30 }, { x: 6, y: 30 }, { x: 4, y: 28 }],
  meeting: [
    { x: 29, y: 3 }, { x: 31, y: 3 }, { x: 33, y: 3 }, { x: 35, y: 3 }, { x: 37, y: 3 },
    { x: 29, y: 7 }, { x: 31, y: 7 }, { x: 33, y: 7 }, { x: 35, y: 7 }, { x: 37, y: 7 },
    { x: 27, y: 5 }, { x: 40, y: 5 },
  ],
  boss_visit: [{ x: 50, y: 7 }, { x: 52, y: 7 }, { x: 54, y: 7 }],
  server: [{ x: 13, y: 4 }, { x: 15, y: 4 }, { x: 11, y: 4 }],
  kpi_board: [{ x: 29, y: 21 }, { x: 31, y: 21 }, { x: 33, y: 21 }],
};

export const FURNITURE: Furniture[] = [
  // Phòng trưng bày (v2; v4: mỗi kệ 2 tầng × 7 món): 2 kệ sát tường trên, bục trưng bày nhỏ ở giữa, cây cảnh góc phải
  { type: 'shelf_beauty', x: 1, y: 1, w: 4, h: 1, blocked: true, label: 'LÀM ĐẸP & THỜI TRANG' },
  { type: 'shelf_tech', x: 5, y: 1, w: 4, h: 1, blocked: true, label: 'CÔNG NGHỆ & NHÀ CỬA' },
  { type: 'display_table', x: 4, y: 4, w: 2, h: 1, blocked: true },
  { type: 'plant', x: 8, y: 5, w: 1, h: 1, blocked: true },
  // Phòng server
  { type: 'rack', x: 11, y: 1, w: 6, h: 2, blocked: true, label: 'SERVER' },
  // Phòng họp
  { type: 'whiteboard', x: 29, y: 1, w: 9, h: 1, blocked: true },
  { type: 'meeting_table', x: 28, y: 4, w: 12, h: 3, blocked: true },
  { type: 'plant', x: 42, y: 1, w: 1, h: 1, blocked: true },
  // Phòng sếp
  { type: 'shelf', x: 45, y: 1, w: 3, h: 1, blocked: true },
  { type: 'sofa_v', x: 57, y: 6, w: 1, h: 4, blocked: true },
  { type: 'plant', x: 58, y: 1, w: 1, h: 1, blocked: true },
  // Sảnh
  { type: 'printer', x: 45, y: 13, w: 2, h: 1, blocked: true },
  { type: 'pingpong', x: 50, y: 16, w: 6, h: 3, blocked: true },
  { type: 'plant', x: 58, y: 12, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 45, y: 21, w: 1, h: 1, blocked: true },
  // Pantry
  { type: 'counter', x: 57, y: 23, w: 2, h: 10, blocked: true },
  { type: 'coffee_machine', x: 57, y: 24, w: 1, h: 1, blocked: true },
  { type: 'fridge', x: 57, y: 27, w: 2, h: 2, blocked: true },
  { type: 'water', x: 57, y: 31, w: 1, h: 1, blocked: true },
  { type: 'snack_shelf', x: 45, y: 23, w: 3, h: 1, blocked: true },
  { type: 'table', x: 48, y: 27, w: 5, h: 3, blocked: true },
  // Góc chill
  { type: 'tv', x: 28, y: 27, w: 5, h: 1, blocked: true },
  { type: 'coffee_table', x: 29, y: 29, w: 3, h: 1, blocked: true },
  { type: 'sofa', x: 27, y: 31, w: 7, h: 2, blocked: false },
  { type: 'sofa_back', x: 27, y: 32, w: 7, h: 1, blocked: true },
  { type: 'beanbag', x: 37, y: 30, w: 1, h: 1, blocked: false },
  { type: 'beanbag', x: 39, y: 30, w: 1, h: 1, blocked: false },
  // Khu làm việc
  { type: 'kpi_board', x: 28, y: 19, w: 7, h: 2, blocked: true, label: 'BẢNG KPI' },
  { type: 'plant', x: 10, y: 12, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 42, y: 12, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 42, y: 24, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 10, y: 24, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 1, y: 32, w: 1, h: 1, blocked: true },
  { type: 'plant', x: 8, y: 32, w: 1, h: 1, blocked: true },
  // tủ locker (v2): sát tường trên khu làm việc, bên trái cửa phòng server (14,7)
  { type: 'lockers', x: 10, y: 8, w: 4, h: 1, blocked: true },
  { type: 'door_mat', x: 1, y: 16, w: 1, h: 2, blocked: false },
];

for (const [id, d] of Object.entries(DESKS)) {
  FURNITURE.push({ type: id === 'd_boss' ? 'boss_desk' : 'desk', ...d.desk, blocked: true, owner: id });
}

// ---- Lưới tường ----
const grid: string[][] = [];
for (let y = 0; y < MAP_H; y++) {
  grid.push([]);
  for (let x = 0; x < MAP_W; x++) {
    grid[y].push(x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1 ? '#' : '.');
  }
}
const wall = (x1: number, y1: number, x2: number, y2: number) => {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x] = '#';
};
const door = (x: number, y: number) => { grid[y][x] = 'D'; };

// cửa ra vào chính bên trái
door(0, 16); door(0, 17);
// Phòng trưng bày (tường + cửa giữ y như WC cũ)
wall(9, 1, 9, 7); wall(1, 7, 9, 7); door(4, 7); door(5, 7);
// Phòng server
wall(18, 1, 18, 7); wall(10, 7, 18, 7); door(14, 7);
// WC (v2): tường dưới x19..22 ở y=7, cửa đóng ở (20,7),(21,7); tường trái/phải dùng chung với server (x=18) và phòng họp (x=23)
wall(19, 7, 22, 7); for (const d of WC_DOORS) door(d.x, d.y);
// Phòng họp
wall(23, 1, 23, 10); wall(23, 10, 44, 10); door(33, 10); door(34, 10);
// Phòng sếp
wall(44, 1, 44, 11); wall(44, 11, 58, 11); door(50, 11); door(51, 11);
// Pantry
wall(44, 22, 58, 22); wall(44, 22, 44, 32); door(44, 26); door(44, 27);

export const WALLS: string[] = grid.map((r) => r.join(''));

const blocked: boolean[][] = grid.map((r) => r.map((c) => c === '#'));
for (const f of FURNITURE) {
  if (!f.blocked) continue;
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) blocked[y][x] = true;
}
// WC: bên trong không có đồ đạc nhưng không đi được; 2 ô cửa cũng không đứng lên (cửa vẽ đóng, biển "WC")
for (let y = WC_RECT.y; y < WC_RECT.y + WC_RECT.h; y++) for (let x = WC_RECT.x; x < WC_RECT.x + WC_RECT.w; x++) blocked[y][x] = true;
for (const d of WC_DOORS) blocked[d.y][d.x] = true;

export const isWalkable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !blocked[y][x];

// BFS: lưới nhỏ (60x34) nên BFS đủ nhanh và luôn ra đường ngắn nhất
export function findPath(from: Pt, to: Pt): Pt[] {
  const sx = Math.round(from.x), sy = Math.round(from.y);
  if (sx === to.x && sy === to.y) return [];
  if (!isWalkable(to.x, to.y)) return [];
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const start = sy * MAP_W + sx;
  const goal = to.y * MAP_W + to.x;
  prev[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur === goal) break;
    const cx = cur % MAP_W, cy = (cur - cx) / MAP_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return [];
  const path: Pt[] = [];
  for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % MAP_W, y: Math.floor(c / MAP_W) });
  return path.reverse();
}

export function roomAt(x: number, y: number): Room | undefined {
  const rx = Math.round(x), ry = Math.round(y);
  // phòng nhỏ ưu tiên hơn khu làm việc chung
  return [...ROOMS].sort((a, b) => a.w * a.h - b.w * b.h)
    .find((r) => rx >= r.x && rx < r.x + r.w && ry >= r.y && ry < r.y + r.h);
}

/** Gửi xuống client trong hello.map. v2 thêm `spots` (client có thể vẽ biển "Có người" ở cửa WC, vùng hover kệ...) */
export const MAP_DATA = { w: MAP_W, h: MAP_H, walls: WALLS, rooms: ROOMS, furniture: FURNITURE, desks: DESKS, spots: SPOTS };
