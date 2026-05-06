// 單張桌位 SVG 元件 — 在 FloorMap 內被 render
// 用餐時長階段視覺：
//   0-60 分：正常紅色
//   60-90 分：紅色 + 黃色光暈（即將結束）
//   90+ 分：深紅 + 紅色邊框閃動 + ⚠️ 警示
const STATUS_COLOR = {
  vacant:   { fill: '#22c55e', stroke: '#16a34a' },
  reserved: { fill: '#eab308', stroke: '#ca8a04' },
  dining:   { fill: '#ef4444', stroke: '#dc2626' },
  cleaning: { fill: '#f97316', stroke: '#ea580c' },
  blocked:  { fill: '#94a3b8', stroke: '#64748b' },
}

// dining 階段顏色（依時長變深）
const DINING_STAGE_FILL = {
  normal:   '#ef4444',  // 0-60
  late:     '#dc2626',  // 60-90
  overtime: '#991b1b',  // 90+ 深紅
}

function diffMin(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000)
}

function stageOf(minutes) {
  if (minutes >= 90) return 'overtime'
  if (minutes >= 60) return 'late'
  return 'normal'
}

export default function TableShape({
  table,
  booking,                    // 對應的 reservation（reserved / dining 狀態才有）
  isSelected = false,
  isMergeCandidate = false,
  isHighlight = false,
  isDimmed = false,
  isAssignSuggestion = false,  // 指派模式：被推薦的最佳桌（綠閃）
  isJustAssigned = false,      // 剛指派完的桌（綠閃 2 秒後熄）
  onClick,
}) {
  const { x, y, w, h, capacity, status, mergedWith, isActive, fuel, number } = table

  if (!isActive) {
    return (
      <g style={{ opacity: 0.25 }}>
        <rect x={x} y={y} width={w} height={h} rx={6}
              fill="#e5e0d8" stroke="#3a2e26" strokeWidth={1} strokeDasharray="3 3"/>
        <text x={x + w / 2} y={y + h / 2 + 4} fontSize={11} fill="#8a7e72" textAnchor="middle" pointerEvents="none">{number}</text>
      </g>
    )
  }

  // === 計算用餐時長階段（僅 dining）===
  const minutes = (status === 'dining' && table.seatedAt) ? diffMin(table.seatedAt) : 0
  const stage = status === 'dining' ? stageOf(minutes) : null

  // 填色：dining 用 stage 對應顏色，其他用基本 status color
  let fill = STATUS_COLOR[status]?.fill || STATUS_COLOR.vacant.fill
  if (status === 'dining' && stage) {
    fill = DINING_STAGE_FILL[stage]
  }

  // 邊框：選中 / 併桌 / 高亮優先；超時也用紅邊
  let stroke = STATUS_COLOR[status]?.stroke || '#16a34a'
  let strokeWidth = 1
  let strokeDash = null
  let className = ''

  if (isSelected) { stroke = '#e60012'; strokeWidth = 3 }
  else if (isMergeCandidate) { stroke = '#f29100'; strokeWidth = 3; strokeDash = '5 3' }
  else if (isAssignSuggestion) { stroke = '#9eb63a'; strokeWidth = 4; className = 'animate-pulse' }
  else if (isJustAssigned) { stroke = '#9eb63a'; strokeWidth = 4 }
  else if (isHighlight) { stroke = '#9eb63a'; strokeWidth = 3; strokeDash = '4 2' }
  else if (stage === 'overtime') { stroke = '#fef08a'; strokeWidth = 3; className = 'animate-pulse' }
  else if (stage === 'late') { stroke = '#fef08a'; strokeWidth = 2 }

  const opacity = isDimmed ? 0.35 : 1

  return (
    <g onClick={onClick} style={{ cursor: 'pointer', opacity }} className={className}>
      {/* 即將結束：黃色光暈 */}
      {stage === 'late' && (
        <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={10}
              fill="none" stroke="#fde047" strokeWidth={2} opacity={0.6} />
      )}
      {stage === 'overtime' && (
        <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={11}
              fill="none" stroke="#fef08a" strokeWidth={3} opacity={0.85} />
      )}
      {isJustAssigned && (
        <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={12}
              fill="none" stroke="#9eb63a" strokeWidth={3} opacity={0.7} />
      )}

      <rect x={x} y={y} width={w} height={h} rx={8}
            fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDash} />

      {/* 桌號 */}
      <text x={x + w / 2} y={y + (h <= 80 ? 24 : 28)}
            fontSize={h <= 80 ? 14 : 16} fontWeight={800} fill="white" textAnchor="middle" pointerEvents="none">
        {number}
      </text>
      {/* 容量 */}
      <text x={x + w / 2} y={y + (h <= 80 ? 42 : 48)}
            fontSize={10} fill="white" opacity={0.9} textAnchor="middle" pointerEvents="none">
        {capacity} 人
      </text>

      {/* 時間/時長 */}
      {status === 'reserved' && booking && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={10} fill="white" fontWeight={600} textAnchor="middle" pointerEvents="none">
          📋 {booking.timeSlot || ''}
        </text>
      )}
      {status === 'dining' && table.seatedAt && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={stage === 'overtime' ? 11 : 10}
              fill="white" fontWeight={700} textAnchor="middle" pointerEvents="none">
          {stage === 'overtime' && '⚠ '}{minutes} 分
        </text>
      )}
      {status === 'cleaning' && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fill="white" textAnchor="middle" pointerEvents="none">
          清桌中
        </text>
      )}

      {/* 燃料標示（瓦斯桶 = 橘色小點） */}
      {fuel === 'tank' && (
        <circle cx={x + w - 8} cy={y + 8} r={4} fill="#f29100" stroke="white" strokeWidth={1} pointerEvents="none" />
      )}
      {/* 併桌標示 */}
      {mergedWith && (
        <text x={x + 8} y={y + 14} fontSize={10} fill="white" pointerEvents="none">⇆</text>
      )}
    </g>
  )
}

export { STATUS_COLOR }
