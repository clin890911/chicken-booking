import { useMemo, useState, useEffect } from 'react'
import TableShape from './TableShape'
import { FLOOR_VIEWBOX, FIXTURES } from '../../../data/tables'

// 渲染樓層設施（醬料台/出菜口/結帳口/冰箱/樓梯/洗手間…）— 純標示、不可點選
function FixtureLayer({ floor }) {
  const items = FIXTURES?.[floor] || []
  return (
    <g pointerEvents="none">
      {items.map((f, i) => {
        if (f.type === 'label') {
          return (
            <text key={i} x={f.x} y={f.y} fontSize={15} fontWeight={700} fill="#6b5b4d">
              {f.text}
            </text>
          )
        }
        const cx = f.x + f.w / 2
        const cy = f.y + f.h / 2
        const isStairs = f.type === 'stairs'
        return (
          <g key={i}>
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
  scopedMode = false,       // 統一佔用視圖（日期+場次）：散客暖色 / 團客冷色 / 空桌淺色
  scopedByTable = {},       // 統一佔用視圖：{ 桌號: { kind:'walkin'|'group', booking?|group?+batch? } }
  scopedClosed = false,     // 統一佔用視圖：此日期/場次已關閉 → 整圖淡化
  scopedHighlightTables = [], // 統一佔用視圖：預先配桌模式中、可選的空桌（高亮）
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

  const bookingMap = useMemo(() => {
    const m = {}
    bookings.forEach(b => { if (b.id) m[b.id] = b })
    return m
  }, [bookings])

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
      <FixtureLayer floor={floor} />

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
              onClick={() => onSelectTable(t.number)}
            />
          )
        }
        const booking = t.currentBookingId ? bookingMap[t.currentBookingId] : null
        const isSelected = selectedTableNumber === t.number
        const isHighlight = assignMode && highlightTables.includes(t.number)
        const isAssignSuggestion = assignMode && suggestionTable === t.number
        const isPendingConfirm = assignMode && pendingConfirmTable === t.number
        const isJustAssigned = justAssignedTable === t.number
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
            onClick={() => onSelectTable(t.number)}
          />
        )
      })}

      {/* 今日團體 hold 唯讀疊加：今日已預排、尚未入座的團，於其桌位畫靛色虛線框 + 🚌 */}
      {!planningMode && floorTables.map(t => {
        const hold = groupHoldTables[t.number]
        if (!hold) return null
        return (
          <g key={`hold-${t.number}`} pointerEvents="none">
            <rect x={t.x - 3} y={t.y - 3} width={t.w + 6} height={t.h + 6} rx={11}
                  fill="none" stroke="#6366f1" strokeWidth={2.5} strokeDasharray="5 3" opacity={0.9} />
            <text x={t.x + t.w - 6} y={t.y + 14} fontSize={13} textAnchor="end" pointerEvents="none">🚌</text>
          </g>
        )
      })}
    </svg>
  )
}
