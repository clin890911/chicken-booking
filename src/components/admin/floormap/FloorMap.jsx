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
  const fixtureItems = (fixtures && fixtures[floor]) || FIXTURES?.[floor] || []
  // 分區色解析：zoneId → color（無分區回 null）
  const zoneColorOf = useMemo(() => {
    const m = {}
    ;(zones || []).forEach(z => { if (z?.id) m[z.id] = z.color })
    return (zoneId) => (zoneId && m[zoneId]) || null
  }, [zones])

  return (
    <svg
      viewBox={`0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      {/* 樓層標籤 */}
      <text x={20} y={36} fontSize={28} fontWeight={800} fill="#3a2e26" opacity={0.15}>
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
