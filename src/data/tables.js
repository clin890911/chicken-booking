// 雞王刷刷鍋桌位定義
// 33 張四人桌 (A1-A33) + 19 張六人桌 (B1-B19) = 52 張，總座位 246 (+ 134 預留)
// 平面圖按鹿芝谷主場館 1F / 2F 配置：
//   1F = 7 張 6P (B1-B7) + 10 張 4P (A1-A10) = 17 桌
//   2F = 12 張 6P (B8-B19) + 23 張 4P (A11-A33) = 35 桌
//
// 座標系統：viewBox 1200x800，每張桌的 x/y/w/h 為左上角座標
//   4P: 80×75（約對應實體 120×100 cm）
//   6P: 80×100（約對應實體 180×100 cm）
//
// fuel: 'natural-gas' | 'tank' | null（1F 無管線設備區別、2F 北區+南左為天然氣、南右為瓦斯桶）

const TABLE_4P_W = 80
const TABLE_4P_H = 75
const TABLE_6P_W = 80
const TABLE_6P_H = 100

// === 1F：西側靠牆 4 張 6P + 中間混合 + 東側散桌 ===
const FLOOR_1F = [
  // 西側 6P 直排（B1-B4）
  { number: 'B1', capacity: 6, floor: '1F', x: 140, y: 140, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  { number: 'B2', capacity: 6, floor: '1F', x: 140, y: 280, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  { number: 'B3', capacity: 6, floor: '1F', x: 140, y: 420, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  { number: 'B4', capacity: 6, floor: '1F', x: 140, y: 560, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  // 中央左欄 4P（A1-A4）
  { number: 'A1', capacity: 4, floor: '1F', x: 260, y: 150, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A2', capacity: 4, floor: '1F', x: 260, y: 290, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A3', capacity: 4, floor: '1F', x: 260, y: 430, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A4', capacity: 4, floor: '1F', x: 260, y: 580, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  // 中央右欄 6P（B5-B7）
  { number: 'B5', capacity: 6, floor: '1F', x: 380, y: 140, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  { number: 'B6', capacity: 6, floor: '1F', x: 380, y: 280, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  { number: 'B7', capacity: 6, floor: '1F', x: 380, y: 420, w: TABLE_6P_W, h: TABLE_6P_H, fuel: null },
  // 中右 + 東側 4P（A5-A10）
  { number: 'A5', capacity: 4, floor: '1F', x: 380, y: 580, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A6', capacity: 4, floor: '1F', x: 500, y: 150, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A7', capacity: 4, floor: '1F', x: 500, y: 290, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A8', capacity: 4, floor: '1F', x: 500, y: 430, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A9', capacity: 4, floor: '1F', x: 500, y: 580, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
  { number: 'A10', capacity: 4, floor: '1F', x: 620, y: 580, w: TABLE_4P_W, h: TABLE_4P_H, fuel: null },
]

// === 2F：北區 14 桌（天然氣）+ 南左 10 桌（天然氣）+ 南右 11 桌（瓦斯桶）===
const FLOOR_2F = [
  // --- 北區第 1 排 6P × 5（B8-B12）天然氣 ---
  { number: 'B8',  capacity: 6, floor: '2F', x: 200, y: 110, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B9',  capacity: 6, floor: '2F', x: 320, y: 110, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B10', capacity: 6, floor: '2F', x: 440, y: 110, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B11', capacity: 6, floor: '2F', x: 600, y: 110, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B12', capacity: 6, floor: '2F', x: 720, y: 110, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  // --- 北區第 2 排 4P × 6（A11-A16）天然氣 ---
  { number: 'A11', capacity: 4, floor: '2F', x: 200, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A12', capacity: 4, floor: '2F', x: 320, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A13', capacity: 4, floor: '2F', x: 440, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A14', capacity: 4, floor: '2F', x: 600, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A15', capacity: 4, floor: '2F', x: 720, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A16', capacity: 4, floor: '2F', x: 840, y: 240, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  // --- 北區第 3 排 6P × 3（B13-B15）天然氣 ---
  { number: 'B13', capacity: 6, floor: '2F', x: 200, y: 350, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B14', capacity: 6, floor: '2F', x: 320, y: 350, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  { number: 'B15', capacity: 6, floor: '2F', x: 440, y: 350, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'natural-gas' },
  // --- 南左區 4P × 10（A17-A26）天然氣 ---
  { number: 'A17', capacity: 4, floor: '2F', x: 120, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A18', capacity: 4, floor: '2F', x: 240, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A19', capacity: 4, floor: '2F', x: 360, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A20', capacity: 4, floor: '2F', x: 480, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A21', capacity: 4, floor: '2F', x: 600, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A22', capacity: 4, floor: '2F', x: 120, y: 660, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A23', capacity: 4, floor: '2F', x: 240, y: 660, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A24', capacity: 4, floor: '2F', x: 360, y: 660, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A25', capacity: 4, floor: '2F', x: 480, y: 660, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  { number: 'A26', capacity: 4, floor: '2F', x: 600, y: 660, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'natural-gas' },
  // --- 南右區（瓦斯桶）4P × 7 + 6P × 4 = 11 桌 ---
  { number: 'A27', capacity: 4, floor: '2F', x: 800, y: 420, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'A28', capacity: 4, floor: '2F', x: 920, y: 420, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'A29', capacity: 4, floor: '2F', x: 1040, y: 420, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'B16', capacity: 6, floor: '2F', x: 800, y: 540, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'tank' },
  { number: 'A30', capacity: 4, floor: '2F', x: 920, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'A31', capacity: 4, floor: '2F', x: 1040, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'B17', capacity: 6, floor: '2F', x: 800, y: 670, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'tank' },
  { number: 'B18', capacity: 6, floor: '2F', x: 920, y: 670, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'tank' },
  { number: 'B19', capacity: 6, floor: '2F', x: 1040, y: 670, w: TABLE_6P_W, h: TABLE_6P_H, fuel: 'tank' },
  { number: 'A32', capacity: 4, floor: '2F', x: 720, y: 420, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
  { number: 'A33', capacity: 4, floor: '2F', x: 720, y: 540, w: TABLE_4P_W, h: TABLE_4P_H, fuel: 'tank' },
]

// 合併 + 預設運營狀態欄位
export const INITIAL_TABLES = [...FLOOR_1F, ...FLOOR_2F].map(t => ({
  ...t,
  isActive: true,
  // 即時運營狀態（外場操作時更新；不影響 booking schema）
  status: 'vacant',         // vacant | reserved | dining | cleaning | blocked
  currentBookingId: null,   // 關聯到當前 reservation
  seatedAt: null,
  mergedWith: null,         // 併桌：對方 table number
  blockReason: null,
  updatedAt: null,
}))

export const TOTAL_CAPACITY = INITIAL_TABLES.reduce((sum, t) => sum + t.capacity, 0)
// 33*4 + 19*6 = 132 + 114 = 246

export const FLOOR_VIEWBOX = { width: 1200, height: 800 }

// 樓層摘要 helper
export function summarizeByFloor(tables) {
  const byFloor = { '1F': [], '2F': [] }
  tables.forEach(t => {
    if (byFloor[t.floor]) byFloor[t.floor].push(t)
  })
  return byFloor
}
