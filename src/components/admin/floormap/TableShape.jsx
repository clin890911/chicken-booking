// 單張桌位 SVG 元件 — 在 FloorMap 內被 render
// 用餐時長階段視覺：
//   0-(用餐時間-30) 分：正常
//   接近用餐時間：黃色光暈
//   超過用餐時間/清桌緩衝：加深與警示
// 配色原則「平靜 vs 需處理」：不需動作的桌（可入座/已預訂）用淡色低存在感，
// 需要動作的桌（用餐中/待清/超時/團保）才用實心色跳出。色相語義：
//   綠=可入座（淡）/ 藍=已預訂＋預配（淡；預配用虛線框表示桌實體仍空）/ 橙=用餐 /
//   黃=待清（與橙以飽和度區隔）/ 紅=超時 / 靛=團保 / 灰=不可用
// 每格 fill 各自帶 text 色，淡底用深字、實心用白字（對比 ≥4.5:1）。
//
// 旋轉與分區（2026-06 桌位佈局升級）：
//   - 桌可帶 rotation（度）：外層 <g> 套 rotate(rot 中心)，桌號/人數文字再反向 rotate(-rot 中心)
//     抵銷，永遠水平易讀（文字維持在桌中心、桌框繞中心轉）。
//   - zoneColor（由 FloorMap 依 zoneId 解析）：只在桌左上角畫小圓點，★ 絕不取代 status 填色，
//     確保「桌況圖色彩語義不可回退」。整桌填分區色只發生在 LayoutEditor 內。
//   - 字級啟發式改用 min(w,h)：自由縮放後 h 不再恆為 75。
import { diffMin, stageOf } from '../../../utils/diningStage'
import { STATUS_COLOR, GROUP_HOLD_COLOR, PREASSIGN_COLOR, DINING_STAGE_FILL } from './statusColors'

// 配色層級「可坐醒目 vs 佔用降噪」（2026-07 依店家反饋反轉 PR#52）：
//   可入座＝實心綠跳出（領檯第一眼要找的就是空桌）；用餐中/預訂/團保＝低彩度降噪；
//   需處理狀態（待清＝琥珀、超時＝紅，見 DINING_STAGE_FILL）仍保留醒目色。
// 2026-08：色值本身收斂進 ./statusColors.js（單一來源，圖例/pill/排程視圖同步引用），
// 這裡只留語義排版邏輯。

// 桌上顯示的訂位客人姓名截斷保護：桌寬有限（預設 80 unit），姓名用 JS 依 fontSize 與桌寬
// 動態算可容納字數，超過才截斷加「…」（不用 CSS，避免不同瀏覽器截斷行為不一致）。
function truncateGuestName(name, w, fontSize) {
  const s = String(name || '')
  if (!s) return ''
  const charWidth = fontSize * 1.05   // 中文全形字寬約等於 fontSize，留一點安全係數
  const maxChars = Math.max(1, Math.floor((w - 12) / charWidth))
  if (s.length <= maxChars) return s
  return s.slice(0, Math.max(1, maxChars - 1)) + '…'
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
  zoneColor = null,            // 分區色（依 zoneId 解析）：只在左上角畫小圓點，不蓋 status 填色
  onClick,
}) {
  const { x, y, w, h, capacity, status, isActive, number } = table

  // 旋轉：外層 <g> 繞桌中心轉 rot 度；文字群組再反轉抵銷，保持水平。
  const cx = x + w / 2
  const cy = y + h / 2
  const rot = Number(table.rotation) || 0
  const gTransform = rot ? `rotate(${rot} ${cx} ${cy})` : undefined
  const textTransform = rot ? `rotate(${-rot} ${cx} ${cy})` : undefined
  // 字級依較短邊判定（自由縮放後 h 不再恆為 75）
  const small = Math.min(w, h) <= 80

  // 分區角點（左上）：避開右上的「團」疊框標記與焦點環。
  const zoneDot = zoneColor ? (
    <circle cx={x + 9} cy={y + 9} r={4.5} fill={zoneColor} stroke="#ffffff" strokeWidth={1.2} pointerEvents="none" />
  ) : null

  // 永久停用或維修中：置灰虛線、不參與任何模式的狀態渲染。
  // 預設不可點（規劃圈桌等流程的安全防線）；只有現場即時圖傳 outClickable 讓店員點開結束維修。
  if (!isActive || outNote) {
    const clickable = isActive && outNote && outClickable
    return (
      <g style={{ opacity: 0.35, cursor: clickable ? 'pointer' : 'default' }} onClick={clickable ? onClick : undefined} transform={gTransform}>
        <rect x={x} y={y} width={w} height={h} rx={6}
              fill="#e5e0d8" stroke="#3a2e26" strokeWidth={1} strokeDasharray="3 3"/>
        {zoneDot}
        <g transform={textTransform}>
          <text x={cx} y={cy - (outNote ? 4 : -4)} fontSize={16} fontWeight={800} fill="#8a7e72" textAnchor="middle" pointerEvents="none">{number}</text>
          {outNote && (
            <text x={cx} y={cy + 12} fontSize={9} fontWeight={700} fill="#b45309" textAnchor="middle" pointerEvents="none">
              🛠 {outNote.length > 7 ? '維修中' : outNote}
            </text>
          )}
        </g>
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
      <g onClick={onClick} style={{ cursor: planState === 'blocked' ? 'not-allowed' : 'pointer' }} transform={gTransform}>
        <rect x={x} y={y} width={w} height={h} rx={8}
              fill={P.fill} stroke={stroke} strokeWidth={strokeWidth}
              strokeDasharray={planState === 'blocked' ? '4 3' : null} />
        {zoneDot}
        <g transform={textTransform}>
          <text x={cx} y={y + (small ? 25 : 28)}
                fontSize={small ? 20 : 22} fontWeight={900} fill={P.text} textAnchor="middle" pointerEvents="none">
            {number}
          </text>
          <text x={cx} y={y + (small ? 44 : 48)}
                fontSize={small ? 13 : 14} fontWeight={700} fill={P.text} opacity={0.95} textAnchor="middle" pointerEvents="none">
            {capacity} 人
          </text>
          <text x={cx} y={y + h - 8}
                fontSize={9} fontWeight={700} fill={P.text} opacity={0.9} textAnchor="middle" pointerEvents="none">
            {planState === 'selected' ? '✓ 已選' : P.label}
          </text>
        </g>
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
      <g onClick={onClick} style={{ cursor: 'pointer', opacity: occDimmed ? 0.5 : 1 }} className={occHighlight ? 'animate-pulse' : ''} transform={gTransform}>
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
        {zoneDot}
        <g transform={textTransform}>
          <text x={cx} y={y + (small ? 24 : 26)} fontSize={small ? 19 : 21} fontWeight={900} fill={O.text} textAnchor="middle" pointerEvents="none">{number}</text>
          <text x={cx} y={y + (small ? 40 : 41)} fontSize={small ? 12 : 13} fontWeight={700} fill={O.text} opacity={0.95} textAnchor="middle" pointerEvents="none">{capacity}人</text>
          {occLabel && (
            <text x={cx} y={y + h - 8} fontSize={8.5} fontWeight={700} fill={O.text} textAnchor="middle" pointerEvents="none">
              {occLabel.length > 5 ? occLabel.slice(0, 5) : occLabel}
            </text>
          )}
        </g>
      </g>
    )
  }

  // === 計算用餐時長階段（僅 dining）===
  const minutes = (status === 'dining' && table.seatedAt) ? diffMin(table.seatedAt) : 0
  const stage = status === 'dining' ? stageOf(minutes, settings) : null

  // 填色：vacant 被團 hold → 實心紫色；vacant 被預配 → 訂位藍（虛線框）；
  // dining 用 stage 對應顏色；其餘用基本 status color。
  // 預配改藍是為了讓「訂位卡寫已指派、地圖卻是綠色可入座」不再互相矛盾（見 statusColors.PREASSIGN_COLOR）；
  // 團保優先——實心紫已表達更強的保留語意，且 FloorMap 已保證兩個 label 不會同時傳進來。
  const isGroupHold = status === 'vacant' && !!groupHoldLabel
  const isPreassigned = status === 'vacant' && !isGroupHold && !!preassignLabel
  const palette = isGroupHold ? GROUP_HOLD_COLOR
    : isPreassigned ? PREASSIGN_COLOR
    : (STATUS_COLOR[status] || STATUS_COLOR.vacant)
  let fill = palette.fill
  let textColor = palette.text   // 淡底用深字、實心用白字
  if (status === 'dining' && stage) {
    fill = DINING_STAGE_FILL[stage]
    // normal/late 暖灰褐底→深字；overtime/buffer 紅底→白字
    textColor = (stage === 'overtime' || stage === 'buffer-overtime') ? '#ffffff' : palette.text
  }

  // 邊框：選中 / 高亮優先；超時也用紅邊。base 寬度依狀態各自帶（見 statusColors.js），
  // 讓淡底狀態的色框讀得出語義（已預訂加粗到 3px、團保 2.5px，與用餐中的 2px 拉開層次）。
  let stroke = palette.stroke
  let strokeWidth = palette.strokeWidth || 2
  let strokeDash = palette.strokeDash || null   // 目前只有預配帶虛線（桌實體仍空）
  let className = ''

  // 這幾個覆蓋分支的邊框表達的是「當下的模式」而非桌況，故一併清掉狀態帶來的虛線
  // （預配桌被選中時該讀成紅色實線選取框，不是紅色虛線的另一種狀態）。
  if (isSelected) { stroke = '#e60012'; strokeWidth = 3; strokeDash = null }
  else if (isPendingConfirm) { stroke = '#d97706'; strokeWidth = 4; strokeDash = null; className = 'animate-pulse' }
  else if (isAssignSuggestion) { stroke = '#9eb63a'; strokeWidth = 4; strokeDash = null; className = 'animate-pulse' }
  else if (isJustAssigned) { stroke = '#9eb63a'; strokeWidth = 4; strokeDash = null }
  else if (isHighlight) { stroke = '#9eb63a'; strokeWidth = 3; strokeDash = '4 2' }
  else if (stage === 'buffer-overtime') { stroke = '#7f1d1d'; strokeWidth = 3; className = 'animate-pulse' }
  else if (stage === 'overtime') { stroke = '#7f1d1d'; strokeWidth = 3 }
  else if (stage === 'late') { stroke = '#9a3412'; strokeWidth = 2 }

  const opacity = isDimmed ? 0.35 : 1

  return (
    <g onClick={onClick} style={{ cursor: 'pointer', opacity }} className={className} transform={gTransform}>
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
      {zoneDot}

      <g transform={textTransform}>
        {status === 'reserved' ? (
          // reserved 專用版面：讓出中段空間給訂位人姓名（店主反饋：到店只顯示時段、
          // 不顯示姓名，忙的時候要點開抽屜才知道是誰，兩下才入座不順手）。
          // 容量降權移到右上角、桌號字級略降，中段兩行改放「時段」＋「姓名」。
          // 只動 reserved 這個分支；其他狀態的文字版面維持原樣。
          <>
            {/* 桌號（略降字級，讓中段有空間） */}
            <text x={cx} y={y + (small ? 23 : 25)}
                  fontSize={small ? 18 : 20} fontWeight={900} fill={textColor} textAnchor="middle" pointerEvents="none">
              {number}
            </text>
            {/* 容量：右上角小字，降低視覺權重 */}
            <text x={x + w - 8} y={y + 13}
                  fontSize={10} fontWeight={700} fill={textColor} opacity={0.65} textAnchor="end" pointerEvents="none">
              {capacity}人
            </text>
            {booking && (
              <>
                {/* 訂位時段 */}
                <text x={cx} y={y + (small ? 43 : 46)}
                      fontSize={13} fontWeight={700} fill={textColor} textAnchor="middle"
                      className="tabular-nums" pointerEvents="none">
                  {booking.timeSlot || ''}
                </text>
                {/* 訂位人姓名（截斷保護：依桌寬/字級動態算可容納字數） */}
                <text x={cx} y={y + h - 8}
                      fontSize={13} fontWeight={800} fill={textColor} textAnchor="middle" pointerEvents="none">
                  {truncateGuestName(booking.name, w, 13)}
                </text>
              </>
            )}
          </>
        ) : (
          <>
            {/* 桌號 */}
            <text x={cx} y={y + (small ? 25 : 28)}
                  fontSize={small ? 20 : 22} fontWeight={900} fill={textColor} textAnchor="middle" pointerEvents="none">
              {number}
            </text>
            {/* 容量 */}
            <text x={cx} y={y + (small ? 44 : 48)}
                  fontSize={small ? 13 : 14} fontWeight={700} fill={textColor} textAnchor="middle" pointerEvents="none">
              {capacity} 人
            </text>

            {/* 時間/時長 */}
            {status === 'dining' && table.seatedAt && (
              <text x={cx} y={y + h - 8}
                    fontSize={stage === 'overtime' || stage === 'buffer-overtime' ? 11 : 10}
                    fill={textColor} fontWeight={700} textAnchor="middle" pointerEvents="none">
                {(stage === 'overtime' || stage === 'buffer-overtime') && '⚠ '}{minutes} 分
              </text>
            )}
            {status === 'cleaning' && (
              <text x={cx} y={y + h - 8}
                    fontSize={9} fontWeight={700} fill={textColor} textAnchor="middle" pointerEvents="none">
                待清桌
              </text>
            )}
            {status === 'vacant' && (
              <text x={cx} y={y + h - 8}
                    fontSize={9} fontWeight={groupHoldLabel || preassignLabel ? 800 : 600} fill={textColor} textAnchor="middle" pointerEvents="none">
                {groupHoldLabel || preassignLabel || '✓ 可入座'}
              </text>
            )}
          </>
        )}
      </g>
    </g>
  )
}

export { STATUS_COLOR }
