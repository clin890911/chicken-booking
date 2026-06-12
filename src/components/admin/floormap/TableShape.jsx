// 單張桌位 SVG 元件 — 在 FloorMap 內被 render
// 用餐時長階段視覺：
//   0-(用餐時間-30) 分：正常
//   接近用餐時間：黃色光暈
//   超過用餐時間/清桌緩衝：加深與警示
// 配色原則「平靜 vs 需處理」：不需動作的桌（可入座/已預訂）用淡色低存在感，
// 需要動作的桌（用餐中/待清/超時/團保）才用實心色跳出。色相語義：
//   綠=可入座（淡）/ 藍=已預訂（淡）/ 橙=用餐 / 黃=待清（與橙以飽和度區隔）/ 紅=超時 / 靛=團保 / 灰=不可用
// 每格 fill 各自帶 text 色，淡底用深字、實心用白字（對比 ≥4.5:1）。
import { diffMin, stageOf } from '../../../utils/diningStage'

const STATUS_COLOR = {
  vacant:   { fill: '#ffffff', stroke: '#16a34a', text: '#15803d' },   // 可入座：淡色降噪（白底綠框綠字），不搶視覺
  reserved: { fill: '#e6f1fb', stroke: '#2f86d6', text: '#0c447c' },   // 已預訂：淡藍，尚不能入座
  dining:   { fill: '#f97316', stroke: '#c2410c', text: '#ffffff' },   // 用餐中：飽和橘實心
  cleaning: { fill: '#fde68a', stroke: '#d97706', text: '#92400e' },   // 待清桌：淡黃，與用餐中橘以飽和度一眼區隔
  blocked:  { fill: '#9ca3af', stroke: '#6b7280', text: '#ffffff' },   // 停用
}

// 團體保留（vacant 但今日被團 hold）：實心靛色，絕不與可入座綠混淆——忙碌時不會誤帶散客上保留桌
const GROUP_HOLD = { fill: '#6366f1', stroke: '#4338ca', text: '#ffffff' }

// dining 階段顏色：normal/late 為橘系（仍在用餐，警示但非超時），超時才轉紅
const DINING_STAGE_FILL = {
  normal:   '#f97316',  // 0 ~ (用餐時間-30)：橘
  late:     '#ea580c',  // 接近時限（還有時間）：深橘提醒，不用紅避免假性超時
  overtime: '#dc2626',  // 已達用餐時間：紅
  'buffer-overtime': '#b91c1c',  // 超過清桌緩衝：深紅
}

export default function TableShape({
  table,
  booking,                    // 對應的 reservation（reserved / dining 狀態才有）
  settings = {},
  isSelected = false,
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
  focusRing = false,           // 統一佔用視圖：時間軸點團 → 白圈脈動標示該團座位
  groupHoldLabel = null,       // 今日團體保留桌：vacant 桌面改顯示「HH:MM 團保」取代「可入座」
  preassignLabel = null,       // 今日預配桌：vacant 桌面改顯示「📌 HH:MM 預配」（預配不動桌況，僅視覺提示）
  outNote = '',                // 維修停用（地圖日期落在維修窗內）：與永久停用同樣置灰，顯示 🛠 標籤
  outClickable = false,        // 僅現場即時圖開啟：點維修桌可開抽屜「結束維修」；規劃/統一視圖維持不可點
  onClick,
}) {
  const { x, y, w, h, capacity, status, isActive, number } = table

  // 永久停用或維修中：置灰虛線、不參與任何模式的狀態渲染。
  // 預設不可點（規劃圈桌等流程的安全防線）；只有現場即時圖傳 outClickable 讓店員點開結束維修。
  if (!isActive || outNote) {
    const clickable = isActive && outNote && outClickable
    return (
      <g style={{ opacity: 0.35, cursor: clickable ? 'pointer' : 'default' }} onClick={clickable ? onClick : undefined}>
        <rect x={x} y={y} width={w} height={h} rx={6}
              fill="#e5e0d8" stroke="#3a2e26" strokeWidth={1} strokeDasharray="3 3"/>
        <text x={x + w / 2} y={y + h / 2 - (outNote ? 4 : -4)} fontSize={16} fontWeight={800} fill="#8a7e72" textAnchor="middle" pointerEvents="none">{number}</text>
        {outNote && (
          <text x={x + w / 2} y={y + h / 2 + 12} fontSize={9} fontWeight={700} fill="#b45309" textAnchor="middle" pointerEvents="none">
            🛠 {outNote.length > 7 ? '維修中' : outNote}
          </text>
        )}
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
        <text x={x + w / 2} y={y + (h <= 80 ? 25 : 28)}
              fontSize={h <= 80 ? 20 : 22} fontWeight={900} fill={P.text} textAnchor="middle" pointerEvents="none">
          {number}
        </text>
        <text x={x + w / 2} y={y + (h <= 80 ? 44 : 48)}
              fontSize={h <= 80 ? 13 : 14} fontWeight={700} fill={P.text} opacity={0.95} textAnchor="middle" pointerEvents="none">
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
        {/* 時間軸點團跳地圖：白圈脈動標示這團坐哪（深靛外暈撐在淺底/靛底都讀得出，白環在其上吸睛） */}
        {focusRing && (
          <>
            <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={13}
                  fill="none" stroke="#312e81" strokeWidth={6} opacity={0.5} className="animate-pulse" />
            <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={13}
                  fill="none" stroke="#ffffff" strokeWidth={3} className="animate-pulse" />
          </>
        )}
        <rect x={x} y={y} width={w} height={h} rx={8}
              fill={O.fill} stroke={stroke} strokeWidth={strokeWidth}
              strokeDasharray={occHighlight ? '4 2' : null} />
        <text x={x + w / 2} y={y + (h <= 80 ? 24 : 26)} fontSize={h <= 80 ? 19 : 21} fontWeight={900} fill={O.text} textAnchor="middle" pointerEvents="none">{number}</text>
        <text x={x + w / 2} y={y + (h <= 80 ? 40 : 41)} fontSize={h <= 80 ? 12 : 13} fontWeight={700} fill={O.text} opacity={0.95} textAnchor="middle" pointerEvents="none">{capacity}人</text>
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

  // 填色：vacant 被團 hold → 實心靛色；dining 用 stage 對應顏色；其餘用基本 status color
  const isGroupHold = status === 'vacant' && !!groupHoldLabel
  const palette = isGroupHold ? GROUP_HOLD : (STATUS_COLOR[status] || STATUS_COLOR.vacant)
  let fill = palette.fill
  if (status === 'dining' && stage) {
    fill = DINING_STAGE_FILL[stage]
  }
  const textColor = palette.text   // 淡底用深字、實心用白字

  // 邊框：選中 / 高亮優先；超時也用紅邊。base 2px 讓淡底狀態的色框讀得出語義
  let stroke = palette.stroke
  let strokeWidth = 2
  let strokeDash = null
  let className = ''

  if (isSelected) { stroke = '#e60012'; strokeWidth = 3 }
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
      <text x={x + w / 2} y={y + (h <= 80 ? 25 : 28)}
            fontSize={h <= 80 ? 20 : 22} fontWeight={900} fill={textColor} textAnchor="middle" pointerEvents="none">
        {number}
      </text>
      {/* 容量 */}
      <text x={x + w / 2} y={y + (h <= 80 ? 44 : 48)}
            fontSize={h <= 80 ? 13 : 14} fontWeight={700} fill={textColor} textAnchor="middle" pointerEvents="none">
        {capacity} 人
      </text>

      {/* 時間/時長 */}
      {status === 'reserved' && booking && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={10} fill={textColor} fontWeight={700} textAnchor="middle" pointerEvents="none">
          📋 {booking.timeSlot || ''}
        </text>
      )}
      {status === 'dining' && table.seatedAt && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={stage === 'overtime' || stage === 'buffer-overtime' ? 11 : 10}
              fill={textColor} fontWeight={700} textAnchor="middle" pointerEvents="none">
          {(stage === 'overtime' || stage === 'buffer-overtime') && '⚠ '}{minutes} 分
        </text>
      )}
      {status === 'cleaning' && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fontWeight={700} fill={textColor} textAnchor="middle" pointerEvents="none">
          待清桌
        </text>
      )}
      {status === 'vacant' && (
        <text x={x + w / 2} y={y + h - 8}
              fontSize={9} fontWeight={groupHoldLabel || preassignLabel ? 800 : 600} fill={textColor} textAnchor="middle" pointerEvents="none">
          {groupHoldLabel || preassignLabel || '✓ 可入座'}
        </text>
      )}
    </g>
  )
}

export { STATUS_COLOR }
