// 桌況圖「透明擴大命中區」（2026-11-27 C 包，walkthrough #20）。
// iPad 直向（820×1180）地圖欄只有約 360px 寬，桌子畫出來只有 24–35px（1F／2F），低於 44px 觸控下限；
// Barry 拍板「桌況圖全貌優先」（PR #181，不可強制放大到要捲動），所以視覺尺寸不動，改在桌子底下鋪一層
// 透明的命中層：手指落在桌外、但仍在「以桌為中心 44×44px」範圍內 → 算點到那張桌。
// 規則：
//   - 每張桌每個軸各自補到 minPx（已經 ≥ minPx 的那一軸不外擴）——所以 iPad 橫向 1F（49px）完全沒有變化；
//     平常兩側平分；一側與鄰桌接邊（同一島）就全部補到另一側（接邊那側本來就被鄰桌本體佔住）；
//   - 落點同時在兩張桌的擴大範圍內：取最近的那張；兩張距離差不到 ambiguityPx（夾在兩桌正中間）→ 不算點到任何桌
//     （寧可沒反應，也不猜錯桌；相鄰桌接邊的島，擴大範圍天然被鄰桌本體擋住，不會搶到鄰桌）。
//   - 桌子本體永遠在命中層上面：點在桌上一定是那張桌本身（擴大只補桌與桌之間的空白）。
// 純函式：座標一律用 SVG user unit；scale＝1 user unit 在螢幕上是幾 px（svg.getScreenCTM().a）。
export const MIN_TOUCH_PX = 44
export const AMBIGUITY_PX = 4

// 桌的外接矩形（含 rotation：與 TableShape 同樣繞中心轉）
export function tableAabb(t) {
  const x = Number(t.x) || 0, y = Number(t.y) || 0, w = Number(t.w) || 0, h = Number(t.h) || 0
  const rot = Number(t.rotation) || 0
  if (!rot) return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  const cx = x + w / 2, cy = y + h / 2
  const rad = (rot * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
  const hw = (w * cos + h * sin) / 2, hh = (w * sin + h * cos) / 2
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }
}

// 這張桌在這個縮放下，命中區（px）每軸有多大：max(畫出來的尺寸, minPx)
export function hitSizePx(t, scale, minPx = MIN_TOUCH_PX) {
  const r = tableAabb(t)
  return { w: Math.max((r.maxX - r.minX) * scale, minPx), h: Math.max((r.maxY - r.minY) * scale, minPx) }
}

// 某一側是否「接邊」：另一張桌的外框就貼在這一側（間距 ≤ eps unit）且在垂直方向上有重疊——
// 例：1F 107｜110、2F 201｜203 左右相接成一島。接邊那側本來就被鄰桌本體佔住，命中區改往另一側補足。
const ADJ_EPS = 1
function blockedSides(r, others) {
  const out = { left: false, right: false, top: false, bottom: false }
  for (const o of others) {
    const vOverlap = Math.min(r.maxY, o.maxY) - Math.max(r.minY, o.minY) > 0
    const hOverlap = Math.min(r.maxX, o.maxX) - Math.max(r.minX, o.minX) > 0
    if (vOverlap && Math.abs(o.maxX - r.minX) <= ADJ_EPS) out.left = true
    if (vOverlap && Math.abs(o.minX - r.maxX) <= ADJ_EPS) out.right = true
    if (hOverlap && Math.abs(o.maxY - r.minY) <= ADJ_EPS) out.top = true
    if (hOverlap && Math.abs(o.minY - r.maxY) <= ADJ_EPS) out.bottom = true
  }
  return out
}
// 一個軸上兩側各補多少：平分不足的量；一側接邊 → 全部補到另一側；兩側都接邊 → 不補
function sideReach(deficit, blockedA, blockedB) {
  if (deficit <= 0 || (blockedA && blockedB)) return [0, 0]
  if (blockedA) return [0, deficit]
  if (blockedB) return [deficit, 0]
  return [deficit / 2, deficit / 2]
}

// 落點 point（user unit）落在哪張桌的擴大命中區；沒有／夾在兩桌正中間 → null
export function pickTableAt(point, tables = [], scale = 1, { minPx = MIN_TOUCH_PX, ambiguityPx = AMBIGUITY_PX } = {}) {
  if (!point || !(scale > 0)) return null
  const need = minPx / scale
  const boxes = (tables || []).map(t => ({ t, r: tableAabb(t) }))
  const hits = []
  for (const { t, r } of boxes) {
    const b = blockedSides(r, boxes.filter(x => x.t !== t).map(x => x.r))
    const [reachL, reachR] = sideReach(need - (r.maxX - r.minX), b.left, b.right)
    const [reachT, reachB] = sideReach(need - (r.maxY - r.minY), b.top, b.bottom)
    const okX = point.x >= r.minX - reachL - 1e-9 && point.x <= r.maxX + reachR + 1e-9
    const okY = point.y >= r.minY - reachT - 1e-9 && point.y <= r.maxY + reachB + 1e-9
    if (!okX || !okY) continue
    const dx = Math.max(r.minX - point.x, 0, point.x - r.maxX)
    const dy = Math.max(r.minY - point.y, 0, point.y - r.maxY)
    hits.push({ number: String(t.number), d: Math.hypot(dx, dy) })
  }
  if (!hits.length) return null
  hits.sort((a, b) => a.d - b.d)
  if (hits.length > 1 && (hits[1].d - hits[0].d) * scale < ambiguityPx) return null
  return hits[0].number
}
