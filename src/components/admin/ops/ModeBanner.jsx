import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import GlyphText from '../../ui/GlyphText'
import { conflictLine } from '../../../utils/preassignOverride'
import { formatBookingTables, bookingTableNumbers } from '../../../utils/bookingTables'
import { isQuickFixMove } from '../../../services/seatingService'
// 現場營運的「模式 banner」：指派 / 候位入座 / 立即帶位 / 換桌 / 團體改派桌位
// 依模式不同底色 + 圖示避免誤判；指派類模式帶二步確認列與預配衝突警告
// 2026-10 對比 AA：底色各加深一階（sky/emerald 600→800、indigo/violet 600→700）——banner 內有 bg-white/15 確認列
// 與 opacity-90 說明字，600 階疊上去白字只剩 3.4–3.9:1；加深後 ≥4.8:1。色相＝模式語義不變。
// 2026-10 Liquid Glass：.lg-mode＝有色材質（實心模式色＋鏡面高光邊＋陰影，styles/glass.css）。
// 模式色刻意不透明：實測 94% 不透明度時，白字疊在 bg-white/15–20 的確認列上會掉到 4.3–4.4:1（不過 AA）。
// 按鈕標籤的 ✓ 經 GlyphText 換成線條圖示，無障礙名稱＝純文字（例「確認入座」）。
// 手機條件（phone:）：橫幅釘在桌況圖上方（OperationsView 選桌模式），只留任務＋確認／取消，
// 說明小字與次要鈕收掉（原桌、目標桌在地圖下方的任務卡；點已選的桌＝移除）；警示一定留著，內容過高在橫幅內捲。
// 手機橫向（short）橫幅改放地圖左邊一欄（OperationsView），不限高。
const PHONE_BANNER = 'phone:px-3 phone:py-2 phone:space-y-1 phone:max-h-[45dvh] phone:overflow-y-auto short:max-h-none'
const BANNER_STYLE = {
  assign:         { bg: 'bg-sky-800',    btn: 'text-sky-700',     icon: 'bookings' },
  'seat-waitlist':{ bg: 'bg-emerald-800',btn: 'text-emerald-700', icon: 'traffic' },
  move:           { bg: 'bg-indigo-700', btn: 'text-indigo-700',  icon: 'move' },
  'group-reseat': { bg: 'bg-violet-700', btn: 'text-violet-700',  icon: 'bus' },
  // 團體已入座換桌／臨時加桌（從團體桌抽屜進來）：同團體語義的紫
  'group-move':   { bg: 'bg-violet-700', btn: 'text-violet-700',  icon: 'move' },
  'group-add':    { bg: 'bg-violet-700', btn: 'text-violet-700',  icon: 'bus' },
}

const CONFIRMABLE = ['assign', 'seat-waitlist', 'move', 'group-reseat', 'group-move', 'group-add']

// 已入座換桌：撤出的原桌會怎樣，確認前就講清楚（與 seatingService.replaceSeatedBookingTables 同一支 isQuickFixMove，B6）。
//   原桌入座未滿 5 分鐘 → 直接變回空桌；滿 5 分鐘（或無入座時間／他台時鐘偏差）→ 轉待清。
//   只看本筆持有的原桌；一部分剛坐、一部分已久就逐桌講。純函式匯出（OperationsView 手機面板共用、方便單測）。
export function moveSourceNote(booking, tables = [], now = new Date()) {
  const nums = bookingTableNumbers(booking)
  const own = nums.map(n => (tables || []).find(t => String(t.number) === n && String(t.currentBookingId ?? '') === String(booking?.id)))
    .filter(Boolean)
  const quick = own.filter(t => isQuickFixMove(t, now)).map(t => String(t.number))
  const rest = nums.filter(n => !quick.includes(n))
  const head = '保留原入座時間；'
  if (quick.length && !rest.length) return `${head}原桌剛坐不到 5 分鐘，會直接變回空桌。`
  if (!quick.length) return `${head}原桌會轉為待清。`
  return `${head}原桌 ${quick.join('、')} 剛坐不到 5 分鐘會直接變回空桌，${rest.join('、')} 會轉為待清。`
}

// pendingConflicts：待確認桌上他筆的預配 [{ booking, overlaps, willRelease }]（capacity.preassignConflicts），
//   逐筆據實寫「將解除」或「會保留」——只有與新佔用區間重疊的才會被解除。
// layout：'top'＝頂端橫幅（手機條件，照舊釘在桌況圖上方，高度 <180）；
//         'rail'＝左欄作業面板（iPad／桌面，2026-11-27 A1）：橫幅的資訊與動作全部收進左欄，
//         地圖尺寸在模式內外一樣；確認鈕釘在左欄底部（手指好按）。左欄用 flex＋min-h-0 串接、內容自己捲，不加固定高、不加 transform。
// multi／autoMulti／onToggleMulti／excess（A2）：點桌語意——單選（預設，點別張＝改選）／多選（＋再加一桌，或大組自動）；
//   excess＝「一張就夠卻選了多張」的黃字提醒（utils/tablePick.excessTablesHint），不硬擋。
export default function ModeBanner({ layout = 'top', tables = [], onLocateSuggestion, onApplySuggestion, mode, pendingConfirm, pendingConflicts, pendingGroupHold, multiSeats = 0, multiMaxSeats, multiWarnings = [], multiWarningSevere = true, multiWarningConfirmed = true, onConfirmWarning, onChangeNeed, onClearSelection, onCancel, onConfirm, onConfirmMulti, onClearPending, multi = true, autoMulti = false, onToggleMulti = null, excess = null }) {
  // 手機（phone:）選桌入座：到店人數 stepper 預設收起（整列 44px 會把橫幅撐高、壓掉桌況圖），
  // 點標題列的「N 位」才展開；桌面／iPad 一律常駐（phone:hidden 只在手機條件成立）。
  const [phoneNeedOpen, setPhoneNeedOpen] = useState(false)
  // 換一組／換模式就收回（橫幅元件常駐不卸載，否則上一組展開的狀態會帶到下一組）
  useEffect(() => { setPhoneNeedOpen(false) }, [mode?.type, mode?.booking?.id])
  if (!mode) return null
  const suggested = tables.find(t => String(t.number) === String(mode.suggestion))
  const suggestionLabel = suggested ? `${suggested.floor}・${suggested.number}` : mode.suggestion
  // 併桌建議（assign-multi 無單桌可容時）：整組桌號，例「2F・201 + 202」
  const comboNums = (mode.suggestionTables || []).length > 1 ? mode.suggestionTables : null
  const comboLabel = comboNums ? `${suggested?.floor ? `${suggested.floor}・` : ''}${comboNums.join(' + ')}` : suggestionLabel

  // 多桌指派／候位入座（大組併桌）：累加式選桌，不走二步確認；席數夠才能確認。
  // mode.kind 區分兩條路徑——'waitlist' 是客人已在現場、確認即入座（沿用候位模式的綠）；
  // 其餘為訂位指派，是先把桌佔起來、客人到了再入座（沿用指派模式的藍）。
  if (mode.type === 'assign-multi') {
    const isWaitlist = mode.kind === 'waitlist'
    // 'arrive'＝未配桌訂位的客人已在現場：選好桌確認即「指派＋入座」（同候位入座用綠色）
    const isArrive = mode.kind === 'arrive'
    const seatsNow = isWaitlist || isArrive
    const need = mode.need || 0
    const selected = mode.selected || []
    // 擠一擠：每桌可多坐 1 位（multiMaxSeats 由 capacity.squeezeSeats 算；沒傳就照原席數）
    const maxSeats = multiMaxSeats ?? multiSeats
    const enough = selected.length > 0 && maxSeats >= need
    const squeezed = enough && multiSeats < need
    const ready = enough && multiWarningConfirmed
    const name = isWaitlist
      ? `${mode.wait?.name || '候位'}${mode.wait?.queueNumber ? ` #${mode.wait.queueNumber}` : ''}`
      : (mode.booking?.name || '訂位')
    const bg = seatsNow ? 'bg-emerald-800' : 'bg-sky-800'
    const cancelBtn = seatsNow ? 'text-emerald-700' : 'text-sky-700'
    const title = isWaitlist ? '候位入座' : isArrive ? (mode.reseatFrom?.length ? '到了 · 換桌入座' : '到了 · 選桌入座') : mode.replacing ? '重新選桌' : '指派桌位'
    const confirmLabel = `✓ ${mode.replacing ? '確認改桌' : seatsNow ? (selected.length > 1 ? '確認併桌入座' : '確認入座') : mode.lockKind === 'preassign' ? (selected.length > 1 ? '確認併桌預配' : '確認預配') : (selected.length > 1 ? '確認併桌指派' : '確認指派')}`
    // 點桌語意切換（A2）：大組自動多選只給說明；其餘一顆「＋再加一桌（併桌）」切換鈕
    const multiControl = autoMulti ? (
      <p data-testid="mode-auto-multi" className="text-sm font-bold text-amber-800 bg-amber-100 rounded-lg px-3 py-2">大組・可選多桌（沒有單桌坐得下 {need} 位）· 點桌加／減</p>
    ) : onToggleMulti ? (
      <button type="button" data-testid="mode-multi-toggle" aria-pressed={!!multi} onClick={onToggleMulti}
        className={`tap min-h-[44px] px-3 rounded-lg border-2 text-sm font-bold ${multi ? 'border-chicken-brown bg-chicken-brown text-white' : 'border-dashed border-chicken-brown/40 text-chicken-brown bg-white'}`}>
        {multi ? '併桌中・點桌加／減（改回單桌）' : '＋再加一桌（併桌）'}
      </button>
    ) : null
    // 還差幾位：一張桌都還沒選時不講（4 位一張 6 人桌就夠，「還差 4 位」會誤導成要併桌）
    const short = selected.length > 0 && !enough && need > maxSeats ? need - maxSeats : 0
    const shortLine = short > 0 ? <p data-testid="mode-short" className="text-sm text-chicken-brown/70">擠一擠也還差 {short} 位{multi ? '' : '，可按「＋再加一桌」併桌'}</p> : null
    const excessLine = excess ? <p data-testid="mode-excess" className="text-sm font-bold text-amber-900 bg-amber-100 rounded-lg px-3 py-2">{excess.text}</p> : null

    if (layout === 'rail') {
      const accent = seatsNow ? 'border-emerald-700' : 'border-sky-700'
      return (
        <section data-testid="mode-banner" data-layout="rail" role="region" aria-label="目前選桌任務"
          className={`flex-1 min-h-0 flex flex-col bg-white rounded-xl border-2 ${accent} overflow-hidden`}>
          <header className={`flex-none ${bg} text-white px-4 py-3`}>
            <div className="flex items-center gap-2 text-base font-bold">
              <Icon name={isWaitlist ? 'traffic' : 'bookings'} size={18} />
              <span>{title}：{name} {need} 位</span>
            </div>
            <div className="mt-1 text-xs opacity-90">
              {seatsNow ? '確認即入座 · 只能選此刻空桌' : mode.lockKind === 'preassign' ? '預配 · 桌子先不鎖' : '指派即鎖桌'}
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {isArrive && mode.reseatFrom?.length > 0 && <p data-testid="arrive-reseat-from" className="text-sm font-bold bg-amber-100 text-amber-900 px-3 py-2 rounded-lg">原預配 {mode.reseatFrom.join(' + ')} 被佔 · 換一張空桌</p>}
            {mode.replacing && <p className="text-sm text-chicken-brown/80">原配桌 {formatBookingTables(mode.booking)} · 確認成功前保留</p>}
            {mode.booking?.status === 'arrived' && <p data-testid="move-source-note" className="text-sm text-chicken-brown/60">{moveSourceNote(mode.booking, tables)}</p>}
            {/* 選桌入座：到店人數跟訂位不同 → 這裡直接改（確認入座時才寫回訂位） */}
            {isArrive && onChangeNeed && (
              <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="到店人數">
                <span className="text-sm font-bold">到店人數</span>
                <button type="button" aria-label="人數減一" disabled={need <= 1} onClick={() => onChangeNeed(need - 1)}
                  className="min-h-[44px] min-w-[44px] rounded-lg border-2 border-emerald-700 text-emerald-800 text-lg font-bold disabled:opacity-40">−</button>
                <span data-testid="arrive-need" className="min-w-[3.5rem] text-center text-lg font-bold tabular-nums">{need} 位</span>
                <button type="button" aria-label="人數加一" disabled={need >= 200} onClick={() => onChangeNeed(need + 1)}
                  className="min-h-[44px] min-w-[44px] rounded-lg border-2 border-emerald-700 text-emerald-800 text-lg font-bold disabled:opacity-40">＋</button>
                {Number(mode.booking?.guests) !== need && <span className="text-xs text-chicken-brown/70">訂位 {mode.booking?.guests} 位 · 入座時一併改</span>}
              </div>
            )}
            <div className={`rounded-xl border-2 px-3 py-2 ${enough ? 'border-emerald-600 bg-emerald-50' : 'border-chicken-brown/15 bg-chicken-brown/[0.03]'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {/* 兩態都有 1px 邊框：夠／不夠切換時高度不變（「＋再加一桌」不跟著跳 2px） */}
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg font-bold text-sm border ${enough ? 'bg-emerald-700 border-emerald-700 text-white' : 'bg-white text-chicken-brown'}`}>
                  已選 {multiSeats}/{need} 席 · {selected.length} 桌
                </span>
                {squeezed && <span data-testid="squeeze-badge" className="text-xs font-bold bg-amber-300 text-amber-900 px-2 py-1 rounded">擠一擠 · 超坐 {need - multiSeats} 位</span>}
              </div>
              <div className="mt-1.5 text-base font-bold text-chicken-brown">
                {selected.length ? `已選：${selected.join(' + ')}` : (multi ? '尚未選桌（點空桌加入）' : '尚未選桌（點一張空桌）')}
              </div>
              <div className="mt-1 text-xs text-chicken-brown/55">{multi ? '點桌加／減 · 可選多桌' : '點別張＝改選 · 點同一張＝取消'}</div>
            </div>
            {/* 「＋再加一桌」固定在這個位置：上面的卡片高度不隨選桌改變；選桌後才出現的提示（還差幾位／選太多桌）
                都放在它下面（2026-11-27 驗收：選第一桌時這一行消失，「＋再加一桌」上移 31px，手指按空） */}
            {multiControl}
            {shortLine}
            {excessLine}
            {mode.suggestion && <p className="text-sm text-chicken-brown/75">建議 {comboLabel}{comboNums && mode.suggestionSqueezed ? '（擠一擠）' : ''}（自行選桌）</p>}
            {mode.suggestion && (
              <div className="flex items-center gap-3 flex-wrap">
                {onApplySuggestion && (
                  <button type="button" data-testid="mode-apply-suggestion" onClick={onApplySuggestion}
                    className="tap min-h-[44px] px-3 rounded-lg border-2 border-emerald-700 text-emerald-800 text-sm font-bold">
                    用建議桌 {comboLabel}{comboNums && mode.suggestionSqueezed ? '（擠一擠）' : ''}
                  </button>
                )}
                <button type="button" onClick={() => onLocateSuggestion?.(mode.suggestion)} className="underline min-h-[44px] text-sm">定位建議桌 {suggestionLabel}</button>
              </div>
            )}
            {!!selected.length && <button type="button" onClick={onClearSelection} className="text-sm underline min-h-[44px]">清空已選桌</button>}
            {/* 紅＝會解除別組排位或佔團體桌；黃＝只是提醒（時間不衝突、對方保留）。都要勾一下才放行（防呆綁在已選的桌，不變） */}
            {!!multiWarnings.length && <div className={`rounded-lg px-3 py-2 text-sm space-y-1 ${multiWarningSevere ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900'}`}>
              {multiWarnings.map(line => <div key={line} className="font-bold">{line}</div>)}
              <label className="flex items-center gap-2 min-h-[44px] font-bold"><input type="checkbox" className="w-5 h-5" checked={multiWarningConfirmed} onChange={e => onConfirmWarning?.(e.target.checked)} />知道了，仍用這桌</label>
            </div>}
          </div>
          {/* 釘底：取消＋確認（手指在下半部，好按）；確認文字跟著已選桌數變 */}
          <footer className="flex-none border-t border-chicken-brown/10 p-3 flex items-stretch gap-2">
            <button type="button" onClick={onCancel} className="tap min-h-[56px] px-4 rounded-xl border-2 border-chicken-brown/20 text-chicken-brown font-bold whitespace-nowrap">取消</button>
            <button type="button" onClick={onConfirmMulti} disabled={!ready}
              className={`tap flex-1 min-h-[56px] rounded-xl text-lg font-bold whitespace-nowrap ${ready ? `${bg} text-white` : 'bg-chicken-brown/10 text-chicken-brown/45 cursor-not-allowed'}`}
            ><GlyphText>{confirmLabel}</GlyphText></button>
          </footer>
        </section>
      )
    }
    return (
      <div data-testid="mode-banner" className={`lg-mode ${bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2 ${PHONE_BANNER}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
            <Icon name={isWaitlist ? 'traffic' : 'bookings'} size={18} />
            <span>{title}：{name} {need} 位</span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-sm shadow-sm ${enough ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
              已選 {multiSeats}/{need} 席 · {selected.length} 桌
            </span>
            {squeezed && <span data-testid="squeeze-badge" className="text-xs font-bold bg-amber-300 text-amber-900 px-2 py-1 rounded">擠一擠 · 超坐 {need - multiSeats} 位</span>}
            <span className="text-xs opacity-90 phone:hidden">{multi ? '點桌加 / 減 · 可選多桌' : '點別張＝改選 · 點同一張＝取消'}</span>
            {mode.replacing && <span className="text-xs bg-white/20 px-2 py-1 rounded phone:hidden">原配桌 {formatBookingTables(mode.booking)} · 確認成功前保留</span>}
            {mode.suggestion && <span className="text-xs bg-white/20 px-2 py-1 rounded phone:hidden">建議 {comboLabel}{comboNums && mode.suggestionSqueezed ? '（擠一擠）' : ''}（自行選桌）</span>}
            {!seatsNow && <span className="text-xs opacity-90 phone:hidden">{mode.lockKind === 'preassign' ? '預配 · 桌子先不鎖' : '指派即鎖桌'}</span>}
            {isArrive && <span className="text-xs opacity-90 phone:hidden">確認即入座 · 只能選此刻空桌</span>}
            {isArrive && onChangeNeed && (
              <button type="button" data-testid="arrive-need-toggle" aria-expanded={phoneNeedOpen} aria-label={`改到店人數（${need} 位）`}
                onClick={() => setPhoneNeedOpen(v => !v)}
                className="hidden phone:inline-flex items-center min-h-[44px] -my-2">
                {/* 觸控區 44px（按鈕本身），看得到的白底小鈕 28px＝跟「已選」同高、不把這一行撐高；-my-2 只吃掉行距 */}
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white text-emerald-700 text-sm font-bold shadow-sm">
                  <Icon name="users" size={14} />{need} 位
                </span>
              </button>
            )}
            {isArrive && mode.reseatFrom?.length > 0 && <span data-testid="arrive-reseat-from" className="text-xs font-bold bg-amber-300 text-amber-900 px-2 py-1 rounded">原預配 {mode.reseatFrom.join(' + ')} 被佔 · 換一張空桌</span>}
          </div>
          <button onClick={onCancel} className={`text-xs px-3 py-2 min-h-[44px] bg-white ${cancelBtn} rounded-lg font-bold whitespace-nowrap phone:hidden`}>取消</button>
        </div>
        {/* 選桌入座：到店人數跟訂位不同 → 這裡直接改（確認入座時才寫回訂位），不必繞今日籤改人數 */}
        {isArrive && onChangeNeed && (
          <div className={`flex items-center gap-2 ${phoneNeedOpen ? '' : 'phone:hidden'}`} role="group" aria-label="到店人數">
            <span className="text-sm phone:text-xs font-bold">到店人數</span>
            <button type="button" aria-label="人數減一" disabled={need <= 1} onClick={() => onChangeNeed(need - 1)}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-white text-emerald-700 text-lg font-bold shadow-sm disabled:opacity-40">−</button>
            <span data-testid="arrive-need" className="min-w-[3.5rem] text-center text-base font-bold tabular-nums">{need} 位</span>
            <button type="button" aria-label="人數加一" disabled={need >= 200} onClick={() => onChangeNeed(need + 1)}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-white text-emerald-700 text-lg font-bold shadow-sm disabled:opacity-40">＋</button>
            {Number(mode.booking?.guests) !== need && <span className="text-xs opacity-90">訂位 {mode.booking?.guests} 位 · 入座時一併改</span>}
          </div>
        )}
        <div className="bg-white/15 rounded-lg px-3 py-2 phone:px-2 phone:py-1 flex items-center justify-between gap-2 flex-wrap phone:flex-nowrap">
          <div className="text-sm phone:text-xs font-bold phone:min-w-0 phone:flex-1">
            {selected.length ? `已選：${selected.join(' + ')}` : '尚未選桌（點空桌加入）'}
            {short > 0 && <span className="ml-2 opacity-90">— 擠一擠也還差 {short} 位</span>}
          </div>
          <button onClick={onCancel} className={`hidden phone:inline-flex items-center flex-none text-xs px-3 min-h-[44px] bg-white ${cancelBtn} rounded-lg font-bold whitespace-nowrap`}>取消</button>
          <button
            onClick={onConfirmMulti}
            disabled={!ready}
            className={`text-xs px-4 phone:px-3 py-2 min-h-[44px] flex-none rounded-lg font-bold whitespace-nowrap shadow-sm ${
              ready ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
          ><GlyphText>{confirmLabel}</GlyphText></button>
        </div>
        {/* 手機：選了桌才出現（進模式當下橫幅高度不變，<180 的不變量） */}
        {(excessLine || (selected.length > 0 && multiControl)) && <div className="flex items-center gap-2 flex-wrap text-chicken-brown text-xs">{excessLine}{selected.length > 0 ? multiControl : null}</div>}
        {mode.suggestion && onApplySuggestion && (
          <button type="button" data-testid="mode-apply-suggestion" onClick={onApplySuggestion}
            className={`mr-3 min-h-[44px] px-3 rounded-lg bg-white text-emerald-700 text-xs font-bold shadow-sm ${selected.length ? 'phone:hidden' : ''}`}>
            用建議桌 {comboLabel}
          </button>
        )}
        {mode.suggestion && <button type="button" onClick={() => onLocateSuggestion?.(mode.suggestion)} className="underline min-h-[44px] text-xs phone:hidden">定位建議桌 {suggestionLabel}</button>}
        {!!selected.length && <button onClick={onClearSelection} className="text-xs underline min-h-[44px] phone:hidden">清空已選桌</button>}
        {/* 紅＝會解除別組排位或佔團體桌；黃＝只是提醒（時間不衝突、對方保留）。都要勾一下才放行（防呆不變） */}
        {!!multiWarnings.length && <div className={`rounded-lg px-3 py-2 text-sm space-y-1 ${multiWarningSevere ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900'}`}>
          {multiWarnings.map(line => <div key={line} className="font-bold">{line}</div>)}
          <label className="flex items-center gap-2 min-h-[44px] font-bold"><input type="checkbox" className="w-5 h-5" checked={multiWarningConfirmed} onChange={e => onConfirmWarning?.(e.target.checked)} />知道了，仍用這桌</label>
        </div>}
      </div>
    )
  }

  const style = BANNER_STYLE[mode.type]
  if (!style) return null

  const bannerText = (() => {
    if (mode.type === 'assign') return `指派桌位：${mode.booking.name} ${mode.booking.guests} 位`
    if (mode.type === 'seat-waitlist') return `候位入座：${mode.wait.name} #${mode.wait.queueNumber}（${mode.wait.partySize} 位）`
    if (mode.type === 'move') return `換桌：${mode.booking.name} 從 ${formatBookingTables(mode.booking)} → 選新桌`
    if (mode.type === 'group-reseat') {
      const remain = (mode.queue || []).length
      return `改派桌位：${mode.group?.agencyName || '團體'} ${mode.batch?.label || ''} — ${mode.current} 被佔，請點選替代桌${remain > 1 ? `（還有 ${remain - 1} 桌待處理）` : ''}`
    }
    if (mode.type === 'group-move') return `團體換桌：${mode.group?.agencyName || '團體'} ${mode.batch?.label || ''} 從 ${mode.from} → 選新桌`
    if (mode.type === 'group-add') return `團體加桌：${mode.group?.agencyName || '團體'} ${mode.batch?.label || ''} → 選要加的空桌`
    return null
  })()

  // 待確認的對象名稱（用於確認列文案）
  const pendingTargetName = mode.type === 'assign' ? mode.booking?.name
    : mode.type === 'seat-waitlist' ? mode.wait?.name
    : mode.type === 'move' ? mode.booking?.name
    : ['group-reseat', 'group-move', 'group-add'].includes(mode.type) ? (mode.group?.agencyName || '團體')
    : ''

  // 單桌指派的寫入語意（mode.lockKind，見 capacity.lockKindFor）：'preassign'＝只預配、桌況不鎖。
  // 舊呼叫點沒帶 lockKind → 視為鎖桌（原行為）。
  const assignPreassign = mode.type === 'assign' && mode.lockKind === 'preassign'

  const hasConflict = !!pendingConflicts?.length
  const willRelease = !!pendingConflicts?.some(c => c.willRelease)

  const confirmText = mode.type === 'group-reseat'
    ? `把 ${mode.current} 改派為 ${pendingConfirm} 並整梯入座？（將更新該梯圈桌）`
    : mode.type === 'group-move'
      ? `確認把 ${pendingTargetName} ${mode.batch?.label || ''} 從 ${mode.from} 換到 ${pendingConfirm}？（用餐時間照舊，${mode.from} 清為空桌）`
    : mode.type === 'group-add'
      ? `確認幫 ${pendingTargetName} ${mode.batch?.label || ''} 加桌 ${pendingConfirm}？（立即入座、併入此梯）`
    : mode.type === 'move'
      ? `確認把 ${pendingTargetName} 從 ${formatBookingTables(mode.booking)} 改到桌 ${pendingConfirm}？`
      : mode.type === 'assign'
        ? (assignPreassign
          ? `確認預配 ${pendingTargetName} 到 ${pendingConfirm}？（桌子現在仍可帶位）`
          : `確認指派 ${pendingTargetName} 至桌 ${pendingConfirm} 並鎖桌？`)
        : `確認指派 ${pendingTargetName} 至桌 ${pendingConfirm}？`

  const confirmBtnLabel = (willRelease || pendingGroupHold) ? (assignPreassign ? '仍要覆蓋預配' : '仍要覆蓋指派')
    : hasConflict ? (assignPreassign ? '仍要預配（他筆預配保留）' : '仍要指派（預配保留）')
    : mode.type === 'group-reseat' ? '✓ 確認改派' : mode.type === 'group-move' ? '✓ 確認換桌' : mode.type === 'group-add' ? '✓ 確認加桌' : mode.type === 'move' ? '✓ 確認改桌'
    : assignPreassign ? '✓ 確認預配' : '✓ 確認指派'
  const conflictBlocks = pendingConfirm && CONFIRMABLE.includes(mode.type) ? (
    <>
      {/* 防呆：此桌已被別筆 booking 預先配走 → 紅底示警（逐筆寫明預配將解除或會保留） */}
      {pendingConflicts?.length > 0 && (
        <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
          <Icon name="warning" size={16} className="shrink-0 mt-px" />
          <span className="space-y-0.5">
            {pendingConflicts.map(c => (
              <span key={c.booking.id} className="block">{conflictLine(pendingConfirm, c, '確認')}</span>
            ))}
          </span>
        </div>
      )}
      {/* 防呆：此桌為今日團體圈桌未入座 → 紅底示警（桌況雖空，散客坐下去團體就沒桌了） */}
      {pendingGroupHold && (
        <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
          <Icon name="bus" size={16} className="shrink-0 mt-px" />
          <span>
            此桌為今日團體 <span className="underline">{pendingGroupHold.agencyName || '旅行社'}</span> 預留
            {pendingGroupHold.holds?.[0]?.batch ? (
              `（${pendingGroupHold.holds[0].batch.label} ${pendingGroupHold.holds[0].batch.timeSlot}）`
            ) : ''}。確認後散客將佔用團體桌。
          </span>
        </div>
      )}
    </>
  ) : null

  // 左欄作業面板（A1）：同一套資訊，確認鈕釘在左欄底部；地圖不因模式縮小
  if (layout === 'rail') {
    const canConfirm = !!pendingConfirm && CONFIRMABLE.includes(mode.type)
    return (
      <section data-testid="mode-banner" data-layout="rail" role="region" aria-label="目前選桌任務"
        className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border-2 border-chicken-brown/20 overflow-hidden">
        <header className={`flex-none ${style.bg} text-white px-4 py-3`}>
          <div className="flex items-start gap-2 text-base font-bold">
            <Icon name={style.icon} size={18} className="mt-0.5 shrink-0" />
            <span>{bannerText}</span>
          </div>
          {mode.type === 'assign' && (
            <div className="mt-1 text-xs opacity-90">{assignPreassign ? `${mode.booking?.timeSlot || ''} 預配 · 桌子先不鎖`.trim() : '指派即鎖桌'}</div>
          )}
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-chicken-brown/55">點一張可選的桌 → 下方確認</p>
          {CONFIRMABLE.includes(mode.type) && (
            mode.suggestion ? (
              <div className="flex items-center gap-3 flex-wrap">
                {onApplySuggestion && (
                  <button type="button" data-testid="mode-apply-suggestion" onClick={onApplySuggestion}
                    className="tap min-h-[44px] px-3 rounded-lg border-2 border-chicken-brown/30 text-chicken-brown text-sm font-bold">
                    用建議桌 {suggestionLabel}
                  </button>
                )}
                <button type="button" onClick={() => onLocateSuggestion?.(mode.suggestion)} className="underline min-h-[44px] text-sm">定位建議桌 {suggestionLabel}</button>
              </div>
            ) : <p className="text-sm text-chicken-brown/60">無建議桌</p>
          )}
          <div className="rounded-xl border-2 border-chicken-brown/15 px-3 py-2">
            <div className="text-sm font-bold text-chicken-brown">{canConfirm ? confirmText : '尚未選桌'}</div>
            {canConfirm && <button type="button" onClick={onClearPending} className="mt-1 text-sm underline min-h-[44px]">重選</button>}
          </div>
          {conflictBlocks}
        </div>
        <footer className="flex-none border-t border-chicken-brown/10 p-3 flex items-stretch gap-2">
          <button type="button" onClick={onCancel} className="tap min-h-[56px] px-4 rounded-xl border-2 border-chicken-brown/20 text-chicken-brown font-bold whitespace-nowrap">取消</button>
          <button type="button" onClick={onConfirm} disabled={!canConfirm}
            className={`tap flex-1 min-h-[56px] rounded-xl text-lg font-bold whitespace-nowrap ${!canConfirm ? 'bg-chicken-brown/10 text-chicken-brown/45 cursor-not-allowed' : (hasConflict || pendingGroupHold) ? 'bg-rose-600 text-white' : `${style.bg} text-white`}`}
          ><GlyphText>{confirmBtnLabel}</GlyphText></button>
        </footer>
      </section>
    )
  }

  return (
    <div data-testid="mode-banner" className={`lg-mode ${style.bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2 ${PHONE_BANNER}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
          <Icon name={style.icon} size={18} />
          <span>{bannerText}</span>
          {/* 單桌指派：講清楚這次是「鎖桌」還是「預配」（離用餐 30 分內才鎖） */}
          {mode.type === 'assign' && (
            <span className="inline-flex items-center bg-white/20 px-2 py-0.5 rounded-lg text-xs font-bold phone:hidden">
              {assignPreassign ? `${mode.booking?.timeSlot || ''} 預配 · 桌子先不鎖`.trim() : '指派即鎖桌'}
            </span>
          )}
          {/* C5：建議桌以白色底色塊突出 */}
          {CONFIRMABLE.includes(mode.type) && (
            mode.suggestion ? (
              <span className="inline-flex phone:hidden items-center gap-1 bg-white/95 text-chicken-brown px-2.5 py-1 rounded-lg font-bold text-sm shadow-sm">
                建議 {suggestionLabel}
              </span>
            ) : (
              <span className="inline-flex phone:hidden items-center gap-1 bg-white/20 px-2 py-0.5 rounded-lg text-xs font-bold">
                無建議桌
              </span>
            )
          )}
        </div>
        <button onClick={onCancel} className={`text-xs px-3 py-2 min-h-[44px] bg-white ${style.btn} rounded-lg font-bold whitespace-nowrap`}>取消</button>
      </div>

      {mode.suggestion && CONFIRMABLE.includes(mode.type) && onApplySuggestion && (
        <button type="button" data-testid="mode-apply-suggestion" onClick={onApplySuggestion}
          className={`mr-3 min-h-[44px] px-3 rounded-lg bg-white ${style.btn} text-xs font-bold shadow-sm ${pendingConfirm ? 'phone:hidden' : ''}`}>
          用建議桌 {suggestionLabel}
        </button>
      )}
      {mode.suggestion && <button type="button" onClick={() => onLocateSuggestion?.(mode.suggestion)} className="underline min-h-[44px] text-xs phone:hidden">定位建議桌 {suggestionLabel}</button>}
      {/* A6：二步確認 — 待確認列 */}
      {pendingConfirm && CONFIRMABLE.includes(mode.type) && (
        <div className="bg-white/15 rounded-lg px-3 py-2 phone:px-2 phone:py-1 space-y-2 phone:space-y-1">
          {/* 防呆：此桌已被別筆 booking 預先配走 → 紅底示警（逐筆寫明預配將解除或會保留） */}
          {pendingConflicts?.length > 0 && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <Icon name="warning" size={16} className="shrink-0 mt-px" />
              <span className="space-y-0.5">
                {pendingConflicts.map(c => (
                  <span key={c.booking.id} className="block">{conflictLine(pendingConfirm, c, '確認')}</span>
                ))}
              </span>
            </div>
          )}
          {/* 防呆：此桌為今日團體圈桌未入座 → 紅底示警（桌況雖空，散客坐下去團體就沒桌了） */}
          {pendingGroupHold && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <Icon name="bus" size={16} className="shrink-0 mt-px" />
              <span>
                此桌為今日團體 <span className="underline">{pendingGroupHold.agencyName || '旅行社'}</span> 預留
                {pendingGroupHold.holds?.[0]?.batch ? (
                  `（${pendingGroupHold.holds[0].batch.label} ${pendingGroupHold.holds[0].batch.timeSlot}）`
                ) : ''}。確認後散客將佔用團體桌。
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 phone:gap-1 flex-wrap">
            <div className="text-sm phone:text-xs font-bold">
              {confirmText}
            </div>
            <div className="flex items-center gap-2 phone:ml-auto">
              <button
                onClick={onClearPending}
                className={`text-xs px-3 py-2 min-h-[44px] bg-white/90 ${style.btn} rounded-lg font-bold whitespace-nowrap`}
              >取消</button>
              <button
                onClick={onConfirm}
                className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-bold whitespace-nowrap shadow-sm ${
                  (hasConflict || pendingGroupHold) ? 'bg-rose-600 text-white' : 'bg-white text-emerald-700'}`}
              ><GlyphText>{(willRelease || pendingGroupHold) ? (assignPreassign ? '仍要覆蓋預配' : '仍要覆蓋指派')
                : hasConflict ? (assignPreassign ? '仍要預配（他筆預配保留）' : '仍要指派（預配保留）')
                : mode.type === 'group-reseat' ? '✓ 確認改派' : mode.type === 'group-move' ? '✓ 確認換桌' : mode.type === 'group-add' ? '✓ 確認加桌' : mode.type === 'move' ? '✓ 確認改桌'
                : assignPreassign ? '✓ 確認預配' : '✓ 確認指派'}</GlyphText></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
