import { useMemo, useState, useEffect } from 'react'
import TableShape from './TableShape'
import { FLOOR_VIEWBOX } from '../../../data/tables'

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
