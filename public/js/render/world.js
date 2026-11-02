// Chuẩn bị dữ liệu bản đồ (MAP_DATA của server) thành cấu trúc tiện vẽ.
import { num, str, arr } from '../util.js';

/** Kiểm tra + chuẩn hoá map; trả về null nếu không dùng được */
export function prepareWorld(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const W = num(raw.w), H = num(raw.h);
  const walls = arr(raw.walls);
  if (!(W > 4 && H > 4 && W <= 200 && H <= 200) || walls.length !== H) return null;
  const grid = walls.map((r) => {
    const s = typeof r === 'string' ? r : '';
    return (s + '#'.repeat(W)).slice(0, W);
  });
  const rooms = arr(raw.rooms)
    .filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0)
    .map((r) => ({ id: str(r.id, 30), label: str(r.label, 40), floor: str(r.floor, 20), x: r.x, y: r.y, w: r.w, h: r.h }));
  const furniture = arr(raw.furniture)
    .filter((f) => f && typeof f.type === 'string' && Number.isFinite(f.x) && Number.isFinite(f.y) && f.w > 0 && f.h > 0)
    .map((f, i) => ({ type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, label: typeof f.label === 'string' ? f.label.slice(0, 30) : '', blocked: !!f.blocked, owner: typeof f.owner === 'string' ? f.owner : '', idx: i }));
  const desksRaw = raw.desks && typeof raw.desks === 'object' ? raw.desks : {};

  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : grid[y][x]);
  const isWall = (x, y) => at(x, y) === '#';

  // phòng nhỏ ưu tiên (giống roomAt của server)
  const roomsBySize = [...rooms].sort((a, b) => a.w * a.h - b.w * b.h);
  const roomIdx = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = roomsBySize.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      if (r) roomIdx[y * W + x] = rooms.indexOf(r);
    }
  }
  const roomAt = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const i = roomIdx[yi * W + xi];
    return i >= 0 ? rooms[i] : null;
  };
  const roomById = (id) => rooms.find((r) => r.id === id) || null;
  const largest = [...rooms].sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;

  // tường kính: tường bao quanh phòng họp / phòng giám đốc (không phải tường ngoài)
  const glassRooms = rooms.filter((r) => r.id === 'meeting' || r.id === 'boss' || r.floor === 'boss');
  const glass = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!isWall(x, y)) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx, ny = y + dy;
          if (isWall(nx, ny)) continue;
          const r = roomAt(nx, ny);
          if (r && glassRooms.includes(r)) hit = true;
        }
      }
      if (hit) glass[y * W + x] = 1;
    }
  }

  // bàn làm việc
  const desks = [];
  for (const id of Object.keys(desksRaw)) {
    const d = desksRaw[id];
    if (!d || !d.desk || !d.seat) continue;
    const desk = { x: num(d.desk.x), y: num(d.desk.y), w: num(d.desk.w, 3), h: num(d.desk.h, 2) };
    const seat = { x: num(d.seat.x), y: num(d.seat.y) };
    let facing = 'up';
    if (seat.y >= desk.y + desk.h) facing = 'up';
    else if (seat.y < desk.y) facing = 'down';
    else if (seat.x < desk.x) facing = 'right';
    else facing = 'left';
    desks.push({ id, desk, seat, facing, boss: id === 'd_boss' });
  }
  const deskById = new Map(desks.map((d) => [d.id, d]));

  // ghế quanh bàn họp / bàn ăn (cùng quy tắc với SPOTS của server)
  const chairs = [];
  for (const f of furniture) {
    if (f.type !== 'meeting_table' && f.type !== 'table') continue;
    const style = f.type === 'meeting_table' ? 'office' : 'wood';
    for (let x = f.x + 1; x <= f.x + f.w - 2; x += 2) {
      chairs.push({ x, y: f.y - 1, facing: 'down', style });
      chairs.push({ x, y: f.y + f.h, facing: 'up', style });
    }
    const my = f.y + Math.floor(f.h / 2);
    chairs.push({ x: f.x - 1, y: my, facing: 'right', style });
    chairs.push({ x: f.x + f.w, y: my, facing: 'left', style });
  }
  const validChairs = chairs.filter((c) => c.x > 0 && c.y > 0 && c.x < W - 1 && c.y < H - 1 && !isWall(c.x, c.y)
    && !furniture.some((f) => f.blocked && c.x >= f.x && c.x < f.x + f.w && c.y >= f.y && c.y < f.y + f.h));

  // ô ngồi (để vẽ tư thế ngồi)
  const seats = new Map();
  const key = (x, y) => `${x},${y}`;
  for (const d of desks) seats.set(key(d.seat.x, d.seat.y), { kind: 'desk', facing: d.facing, deskId: d.id, boss: d.boss });
  for (const c of validChairs) seats.set(key(c.x, c.y), { kind: 'chair', facing: c.facing, style: c.style });
  for (const f of furniture) {
    if (f.type === 'sofa') {
      for (let x = f.x; x < f.x + f.w; x++) seats.set(key(x, f.y), { kind: 'sofa', facing: 'up' });
    } else if (f.type === 'beanbag') {
      seats.set(key(f.x, f.y), { kind: 'beanbag', facing: null });
    }
  }

  const find = (type) => furniture.filter((f) => f.type === type);
  // cửa WC (v2): các ô 'D' kề phòng wc -> tâm cụm cửa (x = giữa, y = hàng cửa)
  const wcRoom = roomById('wc');
  let wcDoor = null;
  if (wcRoom) {
    const ds = [];
    for (let y = wcRoom.y - 1; y <= wcRoom.y + wcRoom.h; y++) {
      for (let x = wcRoom.x - 1; x <= wcRoom.x + wcRoom.w; x++) if (at(x, y) === 'D') ds.push({ x, y });
    }
    if (ds.length) wcDoor = { x: ds.reduce((s, d) => s + d.x, 0) / ds.length + 0.5, y: Math.max(...ds.map((d) => d.y)), tiles: ds };
  }
  const entrance = [];
  for (let y = 0; y < H; y++) {
    if (at(0, y) === 'D') entrance.push({ x: 0, y });
    if (at(W - 1, y) === 'D') entrance.push({ x: W - 1, y });
  }
  for (let x = 0; x < W; x++) {
    if (at(x, 0) === 'D') entrance.push({ x, y: 0 });
    if (at(x, H - 1) === 'D') entrance.push({ x, y: H - 1 });
  }

  return {
    W, H, grid, rooms, furniture, desks, deskById, chairs: validChairs, seats,
    at, isWall, roomAt, roomById, roomIdx, largest, glass,
    seatAt: (x, y) => seats.get(key(Math.round(x), Math.round(y))) || null,
    find, entrance,
    serverRoom: roomById('server'),
    bossRoom: roomById('boss'),
    workRoom: roomById('work') || largest,
    pantry: roomById('pantry'),
    showroom: roomById('showroom'),
    wcRoom, wcDoor,
  };
}
