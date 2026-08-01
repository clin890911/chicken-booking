import { useMemo, useState, useEffect } from 'react'
import TableShape from './TableShape'
import { FLOOR_VIEWBOX, FIXTURES } from '../../../data/tables'
import { isTableOutOnDate, outageLabel } from '../../../utils/tableAvailability'
import { todayStr } from '../../../utils/timeSlots'
import { overdueMinOf } from '../../../utils/bookingPulse'
import { GROUP_HOLD_COLOR } from './statusColors'

// 「到了」一鍵入座的出現窗：訂位時間前 30 分 ~ 後 60 分。寫成具名常數方便日後調整。
// ★ 2026-08 二版：鈕本身已從桌況圖搬到地圖下方的「報到列」（見 ArrivalStrip.jsx）——
//   地圖容器只有數百 px 寬、一張桌換算下來常常 <40px，任何 ≥40px 實體熱區都會壓到鄰桌
//   甚至壓住「另一顆到了鈕」讓它整個點不到（獨立驗收在相鄰兩桌同時進窗時實測踩到，會
//   誤觸把不相干的訂位標記入座）。這個判定純函式留在這裡，ArrivalStrip 引用同一份。
export const ARRIVE_WINDOW_BEFORE_MIN = 30
export const ARRIVE_WINDOW_AFTER_MIN = 60

// 純函式抽出方便單測：桌是否該顯示「到了」入口。
export function isArriveEligible(table, booking, now = Date.now()) {
  if (!table || table.status !== 'reserved') return false
  if (!booking || !booking.timeSlot) return false
  const overdue = overdueMinOf(booking.timeSlot, now)
  return overdue >= -ARRIVE_WINDOW_BEFORE_MIN && overdue <= ARRIVE_WINDOW_AFTER_MIN
}

// === 桌況圖自動裁切（2026-08）===
// 店主反饋「桌況圖看起來有點小，自動就好、不要手動調」：1F 只用了畫布 41% 的面積
// （右側大片空白），iPad 上一張六人桌只畫成 ~42×35 CSS px、桌號字實測僅 13.5px。
// 解法：viewBox 不再寫死 1200x800，改依「當前樓層」桌位＋設施的實際 bounding box
// 動態裁切，每個樓層各自算（不能用聯集——2F 本來就佔滿畫布，聯集會讓 1F 拿不到
// 放大效果）。★ 只用在 FloorMap（現場/規劃/統一佔用圖），LayoutEditor 仍固定用
// FLOOR_VIEWBOX——編輯器需要看到完整 1200×800 空間才能往空白處新增桌位/設施，
// 若編輯器也裁切，拖桌子時裁切框會即時跳動，體感很差，見該檔案內註解。
const AUTOFIT_PADDING = 60 // 四周留白（user unit）：label 型設施是 0 寬高錨點，實際文字
  // 寬度不在資料裡（fontSize 15 依字數往右畫），沒有留白會被裁掉；此值已依現有設施文字
  // （「玻璃門入口」「冷藏自選冰箱」直書、「結帳口」等）實測夠用。

// 依「單一樓層」的桌位＋設施算內容 bounding box（含桌位旋轉，避免斜擺的桌被裁到）。
// 無桌無設施（floor 不存在任何內容）時回傳 null，由呼叫端 fallback 回 FLOOR_VIEWBOX。
// 純函式抽出方便單測。
export function computeFloorContentBBox(floorTables, fixtureItems) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const expand = (px, py) => {
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  ;(floorTables || []).forEach(t => {
    const x = Number(t.x) || 0
    const y = Number(t.y) || 0
    const w = Number(t.w) || 0
    const h = Number(t.h) || 0
    const rot = Number(t.rotation) || 0
    if (!rot) {
      expand(x, y)
      expand(x + w, y + h)
      return
    }
    // 旋轉桌：算旋轉後四角的 AABB（與 TableShape 同一套「繞中心轉」公式），
    // 避免斜擺的桌被算漏、實際渲染時超出裁切框。
    const cx = x + w / 2
    const cy = y + h / 2
    const rad = (rot * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    ;[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([px, py]) => {
      const dx = px - cx
      const dy = py - cy
      expand(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
    })
  })
  ;(fixtureItems || []).forEach(f => {
    const x = Number(f.x) || 0
    const y = Number(f.y) || 0
    const w = Number(f.w) || 0
    const h = Number(f.h) || 0
    expand(x, y)
    expand(x + w, y + h)
  })
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

// 2026-08 二版：夾限下界——viewBox 不得比「今天線上」的原始畫布更差。
// 店主拍板：1F 內容遠小於畫布，裁切生效、照放大；但 2F 原本內容就已經佔畫布 91–93%，
// bbox＋固定留白會讓總尺寸（1212×862）「超過」原畫布 1200×800，preserveAspectRatio
// 反而把 2F 整體再縮小約 1%——不是本來要的「放大」，等於比今天更差。解法：把 bbox＋留白
// 的四個邊界，各自朝「原始畫布」BASE_CANVAS（0,0,1200,800）收攏，但收攏的優先序低於
// 「不裁掉真實內容」——也就是說,BASE_CANVAS 只是收攏的下界目標,不是絕對上限。
// 為什麼不能無條件夾死在 0/0/1200/800：桌位佈局編輯器的「拖曳移動」雖然會把 x/y 夾在
// 0~1200/0~800 內（LayoutEditor.jsx:285-286），但「旋轉」只改 rotation、不重新夾 x/y
// （LayoutEditor.jsx:343），所以貼著畫布邊緣的桌轉個角度，AABB 四角完全可能超出 1200×800
// ——這不是理論上的極端值，是現有編輯器功能就能做到的真實狀態。若無條件夾死在畫布邊界，
// 這張桌會被裁掉、比不裁切還糟。因此規則是：
//   最終邊界 = 「盡量收攏到 BASE_CANVAS」，但絕不收得比實際內容（bbox）更緊。
const BASE_CANVAS = { minX: 0, minY: 0, maxX: FLOOR_VIEWBOX.width, maxY: FLOOR_VIEWBOX.height }

function clampPaddedToBaseCanvas(padded, bbox) {
  return {
    // 左/上緣：往 BASE_CANVAS 的 0 收攏，但不得收到比內容本身（bbox.minX/minY）更靠右/下
    minX: Math.min(bbox.minX, Math.max(padded.minX, BASE_CANVAS.minX)),
    minY: Math.min(bbox.minY, Math.max(padded.minY, BASE_CANVAS.minY)),
    // 右/下緣：往 BASE_CANVAS 的 1200/800 收攏，但不得收到比內容本身（bbox.maxX/maxY）更靠左/上
    maxX: Math.max(bbox.maxX, Math.min(padded.maxX, BASE_CANVAS.maxX)),
    maxY: Math.max(bbox.maxY, Math.min(padded.maxY, BASE_CANVAS.maxY)),
  }
}

// 依 bbox 加固定留白算出 viewBox，並夾限不得比原始 FLOOR_VIEWBOX 更差（見上方 BASE_CANVAS
// 說明）。該樓層完全無內容（bbox 算不出來）時退回原本的 FLOOR_VIEWBOX，避免 NaN／0 寬高。
export function computeFloorViewBox(floorTables, fixtureItems) {
  const bbox = computeFloorContentBBox(floorTables, fixtureItems)
  if (!bbox) {
    return { x: 0, y: 0, width: FLOOR_VIEWBOX.width, height: FLOOR_VIEWBOX.height }
  }
  const padded = {
    minX: bbox.minX - AUTOFIT_PADDING,
    minY: bbox.minY - AUTOFIT_PADDING,
    maxX: bbox.maxX + AUTOFIT_PADDING,
    maxY: bbox.maxY + AUTOFIT_PADDING,
  }
  const c = clampPaddedToBaseCanvas(padded, bbox)
  return {
    x: c.minX,
    y: c.minY,
    width: c.maxX - c.minX,
    height: c.maxY - c.minY,
  }
}

// 渲染樓層設施（醬料台/出菜口/結帳口/冰箱/樓梯/洗手間…）— 純標示、不可點選。
// items 由 FloorMap 解析（settings.floorPlan.fixtures 優先，fallback 預設 FIXTURES）。
function FixtureLayer({ items = [] }) {
  return (
    <g pointerEvents="none">
      {items.map((f, i) => {
        if (f.type === 'label') {
          return (
            <text key={f.id || i} x={f.x} y={f.y} fontSize={15} fontWeight={700} fill="#6b5b4d">
              {f.text}
            </text>
          )
        }
        const cx = f.x + f.w / 2
        const cy = f.y + f.h / 2
        const isStairs = f.type === 'stairs'
        return (
          <g key={f.id || i}>
            <rect
              x={f.x} y={f.y} width={f.w} height={f.h} rx={4}
              fill={isStairs ? '#f1ede8' : '#ece7e1'}
              stroke="#bcae9f"
            />
            <text
              x={cx} y={cy} fontSize={12} fontWeight={700} fill="#6b5b4d"
              textAnchor="middle" dominantBaseline="central"
              transform={f.vtext ? `rotate(90 ${cx} ${cy})` : undefined}
            >
              {f.text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// FloorMap：渲染指定樓層的所有桌位（SVG）
// 功能：點選、選取狀態、指派模式
// 自動每 30 秒重繪一次（更新 dining 計時）
export default function FloorMap({
  floor,
  tables,
  bookings = [],
  settings = {},
  selectedTableNumber,
  selectedTableNumbers = [], // 現場帶位：已選進帶位面板的桌（可多桌＝併桌），沿用「選中」樣式
  onSelectTable,
  highlightTables = [],   // 指派模式：要 highlight 的桌號陣列
  assignMode = false,
  suggestionTable = null, // 指派模式：被推薦的最佳桌（強閃）
  pendingConfirmTable = null, // 二步確認：待確認的桌（醒目高亮）
  justAssignedTable = null, // 剛指派完，閃提醒
  planningMode = false,     // 規劃模式（日期維度預排）：不吃今日即時狀態、改藍紫色系
  selectedTables = [],      // 規劃模式：本梯次已選桌號
  blockedTables = [],       // 規劃模式：他團佔用/已被指派、不可選的桌號
  groupHoldTables = {},     // 今日即時圖疊加：{ 桌號: { agencyName } } 唯讀標示今日團體 hold
  preassignTables = {},     // 今日即時圖疊加：{ 桌號: { timeSlot } } 空桌已被今日訂位預先配走（📌 標籤）
  scopedMode = false,       // 統一佔用視圖（日期+場次）：散客暖色 / 團客冷色 / 空桌淺色
  scopedByTable = {},       // 統一佔用視圖：{ 桌號: { kind:'walkin'|'group', booking?|group?+batch? } }
  scopedClosed = false,     // 統一佔用視圖：此日期/場次已關閉 → 整圖淡化
  scopedHighlightTables = [], // 統一佔用視圖：預先配桌模式中、可選的空桌（高亮）
  scopedFocusTables = [],   // 統一佔用視圖：時間軸點團 → 白圈脈動標示該團座位
  mapDate = '',             // 地圖對應日期（規劃/統一視圖傳入；今日即時圖不傳 = 今天）：維修窗判定用
  fixtures = null,          // 設施來源（{ '1F':[], '2F':[] }）；未傳則 fallback 預設 FIXTURES
  zones = [],               // 分區定義 [{id,name,color}]：解析 zoneId→色，桌角畫小圓點
}) {
  const [, setTick] = useState(0)
  // 每 5 秒重繪，讓桌位用餐計時即時跳動
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const floorTables = useMemo(
    () => tables.filter(t => t.floor === floor),
    [tables, floor]
  )

  // 維修窗判定：規劃/統一視圖看該日期；今日即時圖看今天。
  const effectiveDate = mapDate || todayStr()
  const outNoteFor = (t) => isTableOutOnDate(t, effectiveDate) ? outageLabel(t, effectiveDate) : ''
  // 即時圖：桌上有客人（跨午夜進維修窗、或同步進來的不一致狀態）時，真實桌況優先於維修置灰，
  // 否則用餐計時/超時警示會從地圖上消失。空桌才整塊置灰。
  const isOccupied = (t) => ['dining', 'reserved', 'cleaning'].includes(t.status) || !!t.currentBookingId || !!t.currentRef

  const bookingMap = useMemo(() => {
    const m = {}
    bookings.forEach(b => { if (b.id) m[b.id] = b })
    return m
  }, [bookings])

  // 設施：settings.floorPlan.fixtures 優先，未設定 fallback 程式內預設 FIXTURES。
  const fixtureItems = useMemo(
    () => (fixtures && fixtures[floor]) || FIXTURES?.[floor] || [],
    [fixtures, floor]
  )
  // 分區色解析：zoneId → color（無分區回 null）
  const zoneColorOf = useMemo(() => {
    const m = {}
    ;(zones || []).forEach(z => { if (z?.id) m[z.id] = z.color })
    return (zoneId) => (zoneId && m[zoneId]) || null
  }, [zones])

  // 自動裁切 viewBox：每個樓層各自依當前內容算，切樓層/改佈局都會重算。
  const viewBox = useMemo(
    () => computeFloorViewBox(floorTables, fixtureItems),
    [floorTables, fixtureItems]
  )

  return (
    <svg
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      {/* 樓層標籤：座標跟著 viewBox 原點走（裁切後 viewBox 原點不再固定是 0,0） */}
      <text x={viewBox.x + 20} y={viewBox.y + 36} fontSize={28} fontWeight={800} fill="#3a2e26" opacity={0.15}>
        {floor === '1F' ? '1F · 主用餐區' : '2F · 用餐區'}
      </text>

      {/* 設施標示（桌位底下） */}
      <FixtureLayer items={fixtureItems} />

      {floorTables.map(t => {
        // 統一佔用視圖（日期+場次）：散客暖色 / 團客冷色 / 空桌淺色；不吃今日即時狀態。
        if (scopedMode) {
          const occ = scopedByTable[t.number]
          const occState = occ ? occ.kind : 'free'
          const occLabel = occ?.kind === 'walkin' ? (occ.booking?.name || '散客')
            : occ?.kind === 'group' ? (occ.group?.agencyName || '團體')
            : ''
          return (
            <TableShape
              key={t.number}
              table={t}
              settings={settings}
              isSelected={selectedTableNumber === t.number}
              occState={occState}
              occLabel={occLabel}
              occHighlight={scopedHighlightTables.includes(t.number)}
              occDimmed={scopedClosed}
              focusRing={scopedFocusTables.includes(t.number)}
              outNote={outNoteFor(t)}
              zoneColor={zoneColorOf(t.zoneId)}
              onClick={() => onSelectTable(t.number)}
            />
          )
        }
        // 規劃模式：完全略過今日即時狀態（booking/指派），只看 plan 狀態
        if (planningMode) {
          const planState = selectedTables.includes(t.number)
            ? 'selected'
            : blockedTables.includes(t.number)
              ? 'blocked'
              : 'available'
          return (
            <TableShape
              key={t.number}
              table={t}
              settings={settings}
              isSelected={selectedTableNumber === t.number}
              planState={planState}
              outNote={outNoteFor(t)}
              zoneColor={zoneColorOf(t.zoneId)}
              onClick={() => onSelectTable(t.number)}
            />
          )
        }
        const booking = t.currentBookingId ? bookingMap[t.currentBookingId] : null
        const isSelected = selectedTableNumber === t.number || selectedTableNumbers.includes(t.number)
        const isHighlight = assignMode && highlightTables.includes(t.number)
        const isAssignSuggestion = assignMode && suggestionTable === t.number
        const isPendingConfirm = assignMode && pendingConfirmTable === t.number
        const isJustAssigned = justAssignedTable === t.number
        // 團保桌桌面顯示「HH:MM 團保」取代「可入座」：忙碌時不必點開抽屜就知道別帶散客。
        // 司領桌（司機+領隊）改顯示「司領桌」，與旅客團保桌一眼區隔。
        const hold = groupHoldTables[t.number]
        const holdBatch = hold?.holds?.[0]?.batch
        const holdLabel = t.status === 'vacant' && hold?.holds?.length
          ? (holdBatch?.isEscort ? '司領桌' : `${holdBatch?.timeSlot || ''} 團保`.trim())
          : null
        // 預配標記：空桌但已被今日訂位預先配走（預配不動桌況、桌仍綠色可入座）。
        // 團保優先（實心紫色已表達更強的保留語意）；桌面下緣以「📌 時段 預配」提示。
        const pre = preassignTables[t.number]
        const preassignLabel = t.status === 'vacant' && !holdLabel && pre
          ? `📌 ${pre.timeSlot} 預配`.trim()
          : null
        return (
          <TableShape
            key={t.number}
            table={t}
            booking={booking}
            settings={settings}
            isSelected={isSelected}
            isHighlight={isHighlight}
            isAssignSuggestion={isAssignSuggestion}
            isPendingConfirm={isPendingConfirm}
            isJustAssigned={isJustAssigned}
            isDimmed={assignMode && !highlightTables.includes(t.number)}
            groupHoldLabel={holdLabel}
            preassignLabel={preassignLabel}
            outNote={isOccupied(t) ? '' : outNoteFor(t)}
            outClickable={!assignMode}
            zoneColor={zoneColorOf(t.zoneId)}
            onClick={() => onSelectTable(t.number)}
          />
        )
      })}

      {/* 今日團體 hold 唯讀疊加：空桌團保已由 TableShape 以實心紫色桌面表示，不再疊框；
          只有「非空桌但被 hold」（如待清桌接下一梯）才畫紫色虛線提示 + 「團」標記。
          色相跟著 GROUP_HOLD_COLOR 走（2026-08 團保從靛藍改紫，避免跟新的訂位藍混淆），
          文字色沿用同色相加深版本，維持與 TableShape 的團保視覺一致。 */}
      {!planningMode && floorTables.map(t => {
        const hold = groupHoldTables[t.number]
        if (!hold || t.status === 'vacant') return null
        const rot = Number(t.rotation) || 0
        const holdTransform = rot ? `rotate(${rot} ${t.x + t.w / 2} ${t.y + t.h / 2})` : undefined
        return (
          <g key={`hold-${t.number}`} pointerEvents="none" transform={holdTransform}>
            <rect x={t.x - 3} y={t.y - 3} width={t.w + 6} height={t.h + 6} rx={11}
                  fill="none" stroke={GROUP_HOLD_COLOR.stroke} strokeWidth={2.5} strokeDasharray="5 3" opacity={0.9} />
            <text x={t.x + t.w - 7} y={t.y + 15} fontSize={11} fontWeight={800} fill={GROUP_HOLD_COLOR.text} textAnchor="end" pointerEvents="none">團</text>
          </g>
        )
      })}
    </svg>
  )
}
