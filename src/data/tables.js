// 雞王涮涮鍋桌位定義（依「雞王座號圖」PDF 配置，2026-06 更新）
// 1F：四人桌 6 張（101,102,103,111,112,113）+ 六人桌 6 張（105–110）＝ 12 桌，60 人
// 2F：四人桌 27 張（221–233 共 12 張 + 251–267 共 15 張）
//     + 六人桌 13 張（201–215 區）＝ 40 桌，186 人
// 全店合計 52 桌、246 人。
//
// 注意：PDF 桌號有跳號（無 104／2F 無 204,214,224,254,264），屬正常。
// 桌號的「四人/六人」分布：依 PDF 圖上「灰底＝六人桌、白底＝四人桌」逐桌判讀（像素取樣確認）：
//   1F 六人桌(6)：101,102,103,108,109,110
//   2F 六人桌(13)：201,202,203,205,206,210,211,212,213,215,258,259,260
//   其餘為四人桌。可於後台「桌位編輯器」逐桌調整。
//   ★ 2026-08 店主已在雲端調整過 207/208/209↔210/211/212 的容量（207-209 改 4P、
//   210-212 改 6P，與 PDF 原圖相反），下方 2F 排版以雲端「已存檔」容量為準。
//
// 座標系統：viewBox 1200x800，x/y/w/h 為左上角座標
//   4P: 80×75 ｜ 6P: 90×75（橫式，較寬；六人桌實體較寬不是較長）

const TABLE_4P_W = 80
const TABLE_4P_H = 75
const TABLE_6P_W = 90   // 六人桌橫式：寬＞高，且比四人桌寬
const TABLE_6P_H = 75

// 依人數回傳桌位寬高 — 僅供「新增桌位」與「重設預設佈局」帶入初始尺寸。
// ★ 既有桌位不再由容量回推尺寸：店家可在編輯器自由縮放（w/h 各自持久化），
//   改容量只改 capacity、不動 w/h；要套回標準尺寸由編輯器「套用標準尺寸」按需呼叫。
export function tableDims(capacity) {
  return Number(capacity) === 6
    ? { w: TABLE_6P_W, h: TABLE_6P_H }
    : { w: TABLE_4P_W, h: TABLE_4P_H }
}

// 小工具：依人數自動帶入寬高
const mk = (number, capacity, floor, x, y) => ({
  number, capacity, floor, x, y, ...tableDims(capacity),
})

// === 1F：依現場「雞王一樓座號圖」照片（2026-10）排列 ===
// 左壁 103/102/101；中央 107/110、106/109、105/108 左右接邊；右側 113/112/111。
// 容量沿用既有桌號：六人桌 101,102,103,108,109,110；其餘四人，共60席。
const FLOOR_1F = [
  // 左側直排（6P，橫式），貼左壁。
  mk('103', 6, '1F', 130, 140),
  mk('102', 6, '1F', 130, 300),
  mk('101', 6, '1F', 130, 460),
  // 中央三組雙桌：左4P與右6P同列接邊。
  mk('107', 4, '1F', 360, 300), mk('110', 6, '1F', 440, 300),
  mk('106', 4, '1F', 360, 460), mk('109', 6, '1F', 440, 460),
  mk('105', 4, '1F', 360, 620), mk('108', 6, '1F', 440, 620),
  // 右側直排（4P），與中央三組同列。
  mk('113', 4, '1F', 650, 300),
  mk('112', 4, '1F', 650, 460),
  mk('111', 4, '1F', 650, 620),
]

// === 2F：依現場「雞王二樓座號圖」照片（2026-10）排列 ===
// 左右相接者為同一島：上排 201/203、202/205、207/210、208/211、209/212；
// 下左 255/258、256/259、257/260、261/265、262/266、263/267。
// 206、213/215、251–253 與右下十二桌均獨立；容量沿用既有桌號定義。
// 樓梯在上排左側縱向，醬料台在樓梯底端旁；下右區有縱向隔牆。
const FLOOR_2F = [
  mk('201', 6, '2F', 430, 160), mk('203', 6, '2F', 520, 160),
  mk('202', 6, '2F', 430, 250), mk('205', 6, '2F', 520, 250),
                                 mk('206', 6, '2F', 520, 340),
  mk('207', 4, '2F', 700, 160), mk('210', 6, '2F', 780, 160),
  mk('208', 4, '2F', 700, 250), mk('211', 6, '2F', 780, 250),
  mk('209', 4, '2F', 700, 340), mk('212', 6, '2F', 780, 340),
  mk('213', 6, '2F', 1070, 180),
  mk('215', 6, '2F', 1070, 270),
  // 下左：單桌一列、兩組左右接合桌，中間保留走道。
  mk('251', 4, '2F', 270, 490), mk('255', 4, '2F', 430, 490), mk('258', 6, '2F', 510, 490), mk('261', 4, '2F', 650, 490), mk('265', 4, '2F', 730, 490),
  mk('252', 4, '2F', 270, 575), mk('256', 4, '2F', 430, 575), mk('259', 6, '2F', 510, 575), mk('262', 4, '2F', 650, 575), mk('266', 4, '2F', 730, 575),
  mk('253', 4, '2F', 270, 660), mk('257', 4, '2F', 430, 660), mk('260', 6, '2F', 510, 660), mk('263', 4, '2F', 650, 660), mk('267', 4, '2F', 730, 660),
  // 下右：隔牆右側三欄四列，每桌獨立。
  mk('221', 4, '2F', 860, 430), mk('226', 4, '2F', 970, 430), mk('230', 4, '2F', 1080, 430),
  mk('222', 4, '2F', 860, 520), mk('227', 4, '2F', 970, 520), mk('231', 4, '2F', 1080, 520),
  mk('223', 4, '2F', 860, 610), mk('228', 4, '2F', 970, 610), mk('232', 4, '2F', 1080, 610),
  mk('225', 4, '2F', 860, 700), mk('229', 4, '2F', 970, 700), mk('233', 4, '2F', 1080, 700),
]

// 非桌位設施（純標示，不可點選）。type: 'label' | 'rect' | 'stairs'；vtext=直書。
// ★ 每項帶穩定 id（編輯器以 id 為 key，拖移/刪除不會錯位）。此為「預設設施」，
//   實際以 settings.floorPlan.fixtures 為準（後台可編輯），未設定時 fallback 回這裡。
export const FIXTURES = {
  '1F': [
    { id: 'f1-sauce', type: 'rect', x: 285, y: 100, w: 110, h: 24, text: '醬料台', vtext: false },
    { id: 'f1-serve', type: 'label', x: 440, y: 130, w: 0, h: 0, text: '出菜口', vtext: false },
    { id: 'f1-cashier', type: 'label', x: 650, y: 130, w: 0, h: 0, text: '結帳口', vtext: false },
    { id: 'f1-fridge', type: 'rect', x: 750, y: 235, w: 42, h: 330, text: '自選冰箱', vtext: true },
    { id: 'f1-stairs', type: 'stairs', x: 800, y: 100, w: 85, h: 465, text: '樓梯', vtext: true },
    { id: 'f1-stairs-up', type: 'label', x: 810, y: 610, w: 0, h: 0, text: '↑ 上樓', vtext: false },
    // 照片劃掉的錢櫃台不設領位台；111下方手寫「飲料」作飲料台。
    { id: 'f1-drinks', type: 'rect', x: 650, y: 725, w: 95, h: 30, text: '飲料台', vtext: false },
    { id: 'f1-door', type: 'rect', x: 127, y: 650, w: 24, h: 110, text: '玻璃門入口', vtext: true },
    // 左壁入口處留空；牆面沿用既有rect，不增加設施型別。
    { id: 'f1-wall-top', type: 'rect', x: 127, y: 97, w: 761, h: 3, text: '', vtext: false },
    { id: 'f1-wall-left', type: 'rect', x: 127, y: 97, w: 3, h: 553, text: '', vtext: false },
    { id: 'f1-wall-right', type: 'rect', x: 885, y: 97, w: 3, h: 686, text: '', vtext: false },
    { id: 'f1-wall-bottom', type: 'rect', x: 127, y: 780, w: 761, h: 3, text: '', vtext: false },
  ],
  '2F': [
    { id: 'f2-fridge', type: 'rect', x: 250, y: 70, w: 350, h: 28, text: '冷藏自選冰箱', vtext: false },
    { id: 'f2-wc', type: 'rect', x: 600, y: 70, w: 560, h: 65, text: '洗手間', vtext: false },
    { id: 'f2-serve', type: 'rect', x: 130, y: 110, w: 28, h: 150, text: '結帳口／出菜口', vtext: true },
    { id: 'f2-stairs', type: 'stairs', x: 330, y: 210, w: 60, h: 220, text: '下樓 ↓', vtext: false },
    { id: 'f2-sauce', type: 'rect', x: 500, y: 430, w: 100, h: 20, text: '醬料台', vtext: false },
    // 牆面用既有 rect 型別描線，設定頁與雲端正常保留，無新 schema。
    { id: 'f2-wall-left-top', type: 'rect', x: 130, y: 270, w: 123, h: 3, text: '', vtext: false },
    { id: 'f2-wall-left-bottom', type: 'rect', x: 250, y: 270, w: 3, h: 510, text: '', vtext: false },
    { id: 'f2-wall-right-bottom', type: 'rect', x: 847, y: 430, w: 3, h: 350, text: '', vtext: false },
    { id: 'f2-wall-top', type: 'rect', x: 130, y: 67, w: 1033, h: 3, text: '', vtext: false },
    { id: 'f2-wall-left', type: 'rect', x: 127, y: 67, w: 3, h: 713, text: '', vtext: false },
    { id: 'f2-wall-right', type: 'rect', x: 1160, y: 67, w: 3, h: 713, text: '', vtext: false },
    { id: 'f2-wall-bottom', type: 'rect', x: 127, y: 780, w: 1036, h: 3, text: '', vtext: false },
  ],
}

// 桌位分區（zone）色盤：編輯器新增分區時取色。分區定義存 settings.floorPlan.zones，
// 桌位以 zoneId 引用；運營地圖只在角落畫小圓點（不蓋 status 填色），編輯器內可整桌填色。
export const ZONE_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]
export const DEFAULT_ZONES = []
// 各樓層底圖（描繪用半透明參考圖）：{ url(data URL), opacity, x, y, w, h } | null。
export const DEFAULT_BACKGROUND_IMAGES = { '1F': null, '2F': null }

// 合併 + 預設運營狀態欄位
export const INITIAL_TABLES = [...FLOOR_1F, ...FLOOR_2F].map(t => ({
  ...t,
  // 旋轉角度（度）與所屬分區 id；★ 同 outage：必須顯式帶值，merge-upsert 刪不掉缺席鍵。
  rotation: 0,
  zoneId: null,
  isActive: true,
  // 維修停用窗 { from, to, reason }；★ 必須顯式帶 null：Firestore merge-upsert
  // 無法刪除「缺席」欄位，少了這個鍵，重設佈局後雲端殘留的 outage 會在下次拉取時復活。
  outage: null,
  // 即時運營狀態（外場操作時更新；不影響 booking schema）
  status: 'vacant',         // vacant | reserved | dining | cleaning | blocked
  currentBookingId: null,   // 關聯到當前 reservation
  currentRef: null,         // 團體梯次入座時 = { type:'group', groupId, batchId }
  seatedAt: null,
  mergedWith: null,         // 併桌：對方 table number
  blockReason: null,
  updatedAt: null,
}))

export const TOTAL_CAPACITY = INITIAL_TABLES.reduce((sum, t) => sum + t.capacity, 0)
// 1F: 6*4 + 6*6 = 60 ｜ 2F: 27*4 + 13*6 = 186 ｜ 合計 246

export const FLOOR_VIEWBOX = { width: 1200, height: 800 }

// 樓層摘要 helper
export function summarizeByFloor(tables) {
  const byFloor = { '1F': [], '2F': [] }
  tables.forEach(t => {
    if (byFloor[t.floor]) byFloor[t.floor].push(t)
  })
  return byFloor
}
