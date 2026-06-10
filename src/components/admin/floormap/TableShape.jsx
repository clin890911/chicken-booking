// 單張桌位 SVG 元件 — 在 FloorMap 內被 render
// 用餐時長階段視覺：
//   0-(用餐時間-30) 分：正常
//   接近用餐時間：黃色光暈
//   超過用餐時間/清桌緩衝：加深與警示
// 填色加深以確保白字可讀（對比 ≥3:1）；色相語義維持：綠=可入座 / 藍=已預訂 / 橙=用餐 / 琥珀=清桌 / 灰=不可用
const STATUS_COLOR = {
  vacant:   { fill: '#059669', stroke: '#047857' },   // 加深綠：白字可讀、可入座最顯眼
  reserved: { fill: '#0284c7', stroke: '#075985' },   // 沉穩鋼藍：尚不能入座，不與可入座綠爭視覺
  dining:   { fill: '#f97316', stroke: '#c2410c' },
  cleaning: { fill: '#d97706', stroke: '#b45309' },   // 加深琥珀：白字可讀
  blocked:  { fill: '#6b7280', stroke: '#4b5563' },   // 加深灰
}

// dining 階段顏色：normal/late 為橘系（仍在用餐，警示但非超時），超時才轉紅
const DINING_STAGE_FILL = {
  normal:   '#f97316',  // 0 ~ (用餐時間-30)：橘
  late:     '#ea580c',  // 接近時限（還有時間）：深橘提醒，不用紅避免假性超時
  overtime: '#dc2626',  // 已達用餐時間：紅
  'buffer-overtime': '#b91c1c',  // 超過清桌緩衝：深紅
}

function diffMin(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000)
}

function stageOf(minutes, settings = {}) {
  const diningDuration = Number(settings.diningDurationMin) || 90
  const buffer = Number(settings.cleanupBufferMin) || 10
  const lateThreshold = Math.max(0, diningDuration - 30)
  if (minutes >= diningDuration + buffer) return 'buffer-overtime'
  if (minutes >= diningDuration) return 'overtime'
  if (minutes >= lateThreshold) return 'late'
  return 'normal'
}

export default function TableShape({
  table,
  booking,                    // 對應的 reservation（reserved / dining 狀態才有）
  settings = {},
  isSelected = false,
  isMergeCandidate = false,
  isHighlight = false,
  isDimmed = false,
  isAssignSuggestion = false,  // 指派模式：被推薦的最佳桌（綠閃）
  isPendingConfirm = false,    // 二步確認：待確認的桌（醒目高亮）
  isJustAssigned = false,      // 剛指派完的桌（綠閃後熄）
  planState = null,            // 規劃模式：'selected' | 'blocked' | 'available'（藍紫色系，與今日即時圖區隔）
  occState = null,             // 統一佔用視圖（日期+場次）：'walkin'(暖) | 'group'(冷) | 'free'(淺)
  occLabel = '',               // 統一佔用視圖：佔用者顯示名（散客姓名 / 團客旅行社）
  occSub = '',                 // 統一佔用視圖：次要說明（人數·時段 / 梯次·時段）
  occHighlight = false,        // 統一佔用視圖：預先配桌模式中、可選的空桌高亮
  occDimmed = false,           // 統一佔用視圖：場次已關閉時整體淡化
  onClick,
}) {
  const { x, y, w, h, capacity, status, mergedWith, isActive, number } = table

  if (!isActive) {
    return (
      <g style={{ opacity: 0.25 }}>
        <rect x={x} y={y} width={w} height={h} rx={6}
              fill="#e5e0d8" stroke="#3a2e26" strokeWidth={1} strokeDasharray="3 3"/>
        <text x={x + w / 2} y={y + h / 2 + 4} fontSize={11} fill="#8a7e72" textAnchor="middle" pointerEvents="none">{number}</text>
      </g>
    )
  }

  // === 規劃模式（日期維度預排）===
  // 完全不吃今日即時狀態（status/seatedAt/booking），改用藍紫色系，與今日即時圖明確區隔。
  if (planState) {
    const P = {
      selected:  { fill: '#4f46e5', stroke: '#3730a3', text: '#ffffff', label: '已選' },
      blocked:   { fill: '#94a3b8', stroke: '#64748b', text: '#ffffff', label: '已被佔' },
      available: { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155', label: '可選' },
    }[planState] || { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155', label: '可選' }
    const stroke = isSelected ? '#4f46e5' : P.stroke
    const strokeWidth = isSelected ? 3 : 1.5
    return (
      <g onClick={onClick} style={{ cursor: planState === 'blocked' ? 'not-allowed' : 'pointer' }}>
        <rect x={x} y={y} width={w} height={h} rx={8}
              fill={P.fill} stroke={stroke} strokeWidth={strokeWidth}
              strokeDasharray={planState === 'blocked' ? '4 3' : null} />
        <text x={x + w / 2} y={y + (h <= 80 ? 24 : 28)}
              fontSize={h <= 80 ? 14 : 16} fontWeight={800} fill={P.text} textAnchor="middle" pointerEvents="none">
          {number}
        </text>
        <text x={x + w / 2} y={y + (h <= 80 ? 42 : 48)}
              fontSize={10} fontWeight={600} fill={P.text} opacity={0.95} textAnchor="middle" pointerEvents="none">
          {capacity} 人
        </text>
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fontWeight={700} fill={P.text} opacity={0.9} textAnchor="middle" pointerEvents="none">
          {planState === 'selected' ? '✓ 已選' : P.label}
        </text>
      </g>
    )
  }

  // === 統一佔用視圖（日期 + 場次）===
  // 散客暖色、團客冷色、空桌淺色；與今日即時圖（status 驅動）、規劃圖（planState）皆區隔。
  if (occState) {
    const O = {
      walkin: { fill: '#ea580c', stroke: '#c2410c', text: '#ffffff' },
      group:  { fill: '#4f46e5', stroke: '#3730a3', text: '#ffffff' },
      free:   { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155' },
    }[occState] || { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155' }
    const stroke = isSelected ? '#e60012' : occHighlight ? '#9eb63a' : O.stroke
    const strokeWidth = isSelected ? 3 : occHighlight ? 3 : 1.5
    return (
      <g onClick={onClick} style={{ cursor: 'pointer', opacity: occDimmed ? 0.5 : 1 }} className={occHighlight ? 'animate-pulse' : ''}>
        <rect x={x} y={y} width={w} height={h} rx={8}
              fill={O.fill} stroke={stroke} strokeWidth={strokeWidth}
              strokeDasharray={occHighlight ? '4 2' : null} />
        <text x={x + w / 2} y={y + (h <= 80 ? 22 : 26)} fontSize={h <= 80 ? 14 : 16} fontWeight={800} fill={O.text} textAnchor="middle" pointerEvents="none">{number}</text>
        <text x={x + w / 2} y={y + (h <= 80 ? 36 : 41)} fontSize={9} fontWeight={600} fill={O.text} opacity={0.9} textAnchor="middle" pointerEvents="none">{capacity}人</text>
        {occLabel && (
          <text x={x + w / 2} y={y + h - 8} fontSize={8.5} fontWeight={700} fill={O.text} textAnchor="middle" pointerEvents="none">
            {occLabel.length > 5 ? occLabel.slice(0, 5) : occLabel}
          </text>
        )}
      </g>
    )
  }

  // === 計算用餐時長階段（僅 dining）===
  const minutes = (status === 'dining' && table.seatedAt) ? diffMin(table.seatedAt) : 0
  const stage = status === 'dining' ? stageOf(minutes, settings) : null

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
  else if (isPendingConfirm) { stroke = '#d97706'; strokeWidth = 4; className = 'animate-pulse' }
  else if (isAssignSuggestion) { stroke = '#9eb63a'; strokeWidth = 4; className = 'animate-pulse' }
  else if (isJustAssigned) { stroke = '#9eb63a'; strokeWidth = 4 }
  else if (isHighlight) { stroke = '#9eb63a'; strokeWidth = 3; strokeDash = '4 2' }
  else if (stage === 'buffer-overtime') { stroke = '#7f1d1d'; strokeWidth = 3; className = 'animate-pulse' }
  else if (stage === 'overtime') { stroke = '#7f1d1d'; strokeWidth = 3 }
  else if (stage === 'late') { stroke = '#9a3412'; strokeWidth = 2 }

  const opacity = isDimmed ? 0.35 : 1

  return (
    <g onClick={onClick} style={{ cursor: 'pointer', opacity }} className={className}>
      {/* 即將結束：橘色光暈（還有時間，提醒留意） */}
      {stage === 'late' && (
        <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={10}
              fill="none" stroke="#fb923c" strokeWidth={2} opacity={0.7} />
      )}
      {/* 已超時：紅色光暈（需立即處理） */}
      {(stage === 'overtime' || stage === 'buffer-overtime') && (
        <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={11}
              fill="none" stroke="#dc2626" strokeWidth={3} opacity={0.85} />
      )}
      {/* 二步確認：待確認桌的醒目琥珀光暈 */}
      {isPendingConfirm && (
        <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={12}
              fill="none" stroke="#d97706" strokeWidth={3} opacity={0.85} />
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
            fontSize={10} fontWeight={600} fill="white" opacity={0.95} textAnchor="middle" pointerEvents="none">
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
              fontSize={stage === 'overtime' || stage === 'buffer-overtime' ? 11 : 10}
              fill="white" fontWeight={700} textAnchor="middle" pointerEvents="none">
          {(stage === 'overtime' || stage === 'buffer-overtime') && '⚠ '}{minutes} 分
        </text>
      )}
      {status === 'cleaning' && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fontWeight={600} fill="white" textAnchor="middle" pointerEvents="none">
          清桌中
        </text>
      )}
      {status === 'vacant' && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fontWeight={600} fill="white" textAnchor="middle" pointerEvents="none">
          可入座
        </text>
      )}

      {/* 併桌標示 */}
      {mergedWith && (
        <text x={x + 8} y={y + 14} fontSize={10} fill="white" pointerEvents="none">⇆</text>
      )}
    </g>
  )
}

export { STATUS_COLOR }
