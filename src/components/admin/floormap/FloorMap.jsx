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
// 功能：點選、選取狀態、併桌模式、指派模式
// 自動每 30 秒重繪一次（更新 dining 計時）
export default function FloorMap({
  floor,
  tables,
  bookings = [],
  settings = {},
  selectedTableNumber,
  onSelectTable,
  mergeMode = false,
  mergeFirst = null,
  highlightTables = [],   // 指派模式：要 highlight 的桌號陣列
  assignMode = false,
  suggestionTable = null, // 指派模式：被推薦的最佳桌（強閃）
  justAssignedTable = null, // 剛指派完，閃 2 秒提醒
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
        const booking = t.currentBookingId ? bookingMap[t.currentBookingId] : null
        const isSelected = selectedTableNumber === t.number
        const isMergeFirst = mergeFirst === t.number
        const isHighlight = assignMode && highlightTables.includes(t.number)
        const isAssignSuggestion = assignMode && suggestionTable === t.number
        const isJustAssigned = justAssignedTable === t.number
        return (
          <TableShape
            key={t.number}
            table={t}
            booking={booking}
            settings={settings}
            isSelected={isSelected}
            isMergeCandidate={isMergeFirst}
            isHighlight={isHighlight}
            isAssignSuggestion={isAssignSuggestion}
            isJustAssigned={isJustAssigned}
            isDimmed={assignMode && !highlightTables.includes(t.number)}
            onClick={() => onSelectTable(t.number)}
          />
        )
      })}
    </svg>
  )
}
