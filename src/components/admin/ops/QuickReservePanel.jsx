import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBooking } from '../../../contexts/BookingContext'
import { useConfirm } from '../../ui/Toast'
import GuestCountField from '../GuestCountField'
import NumericKeypad from './NumericKeypad'
import ReturningGuestBadges, { useMatchedCustomer } from '../ReturningGuestBadges'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'
import TimeSlotPicker from '../../booking/TimeSlotPicker'
import Icon from '../../ui/Icon'
import { generateTimeSlots, todayStr, nowSlot } from '../../../utils/timeSlots'
import { calcSlotCapacity, isSlotClosed, HOLD_LEAD_MIN } from '../../../utils/capacity'

const KEYPAD_WIDTH = 392
const KEYPAD_GAP = 12

const SOURCES = [
  { value: 'phone', label: '電話' },
  { value: 'walkin', label: '現場' },
]
const NOTE_OPTIONS = [
  { key: 'child', label: '兒童', icon: 'child' },
  { key: 'pet', label: '寵物', icon: 'paw' },
  { key: 'mobility', label: '行動不便', icon: 'wheelchair' },
]

// 預設時段＝「下一個還沒開始」且可訂（未關閉、剩餘席數夠）的時段；今天都過了回 ''。
// 店主要的是「接電話 → 大多訂接下來的場」，70–90% 店員不必改。純函式，now 可注入（測試固定時間）。
export function nextBookableSlot({ settings = {}, tables = [], bookings = [], groupReservations = [], date, guests = 1, now = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    .find(t => t > nowHHMM
      && !isSlotClosed(settings, date, t)
      && calcSlotCapacity(tables, bookings, date, t, settings, groupReservations) >= guests) || ''
}

// 面板開著跨過時段：所選時段已早於目前這個 30 分時段（nowSlot）→ 改選目前時段（在營業時段內才選得到，
// 否則清空）並給一行說明；沒過回 null。目前時段本身不算過（與 TimeSlotPicker 同口徑）。純函式，now 可注入。
export function pastSlotFix(slot, now = new Date(), settings = {}) {
  const cur = nowSlot(now)
  if (!slot || slot >= cur) return null
  const next = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval).includes(cur) ? cur : ''
  return {
    slot: next,
    notice: next ? `${slot} 已經過了，已改選目前時段 ${next}` : `${slot} 已經過了，今天已沒有可訂的時段`,
  }
}

// 現場「今日訂位 → ＋新增今日訂位」的內嵌面板（2026-09 店主選「留在現場頁新增」）：
// 過去這顆鈕把整個後台切到「訂位 → 新增」長表單——離開現場、看不到桌況圖、姓名要用系統鍵盤打、
// 存完停在訂位清單。現在左欄原地換成這個面板：姓氏／人數／電話跟帶位一樣是大按鈕，時段只列還沒過的，
// 桌子直接點右邊桌況圖選（可不選），存完回「今日訂位」籤、新的那筆閃一下。
//
// 桌的真相（人數／時段／選的桌）放 OperationsView：桌況圖點桌與面板共用同一份，與帶位面板同一套做法。
// 面板只管姓名、電話、來源、備註。
//
// 版面：與帶位面板同骨架——上半可捲、主要動作釘底（iPad 10 橫向左欄可視高約 506pt，一定會捲）。
// 根節點 flex-1 min-h-0 flex-col 接住一面式的 min-h-0 鏈，不可加固定高。
//
// props
//   guests / onGuestsChange       人數（父層持有）
//   timeSlot / onTimeSlotChange   時段（父層持有，開面板時已預設下一個時段）
//   lockKind                      'hold' | 'preassign' | null（所選時段的鎖桌時機，capacity.lockKindFor）
//   table                         目前會用的桌（物件）或 null
//   tablePick / onTablePickChange 'auto' | 'none' | 桌號
//   suggestedNumber               建議桌號（候選第一張）
//   notice                        已選桌因人數／時段變動而改回建議時的說明
//   needsCombo                    沒有任何單桌坐得下（大組）→ 不選桌，存檔後再指派併桌
//   canAssign                     有沒有指派桌位的權限（沒有就不顯示桌位列）
//   onSave(payload)               回傳 false＝失敗（留在面板、不丟資料）
//   onBack()                      返回今日訂位（面板已處理「放棄這筆新增？」確認）
//   slotNotice                    所選時段已過、已自動改選目前時段的說明（父層 pastSlotFix 算）
//   onOpenFullForm({ name, phone, source })（可選）其他日期 → 完整新增表單（只帶完整表單 prefill 支援的欄位）
//   now                           （可選）目前時間，測試注入
export default function QuickReservePanel({
  guests, onGuestsChange, timeSlot, onTimeSlotChange, slotNotice,
  lockKind, table, tablePick, onTablePickChange, suggestedNumber, notice, needsCombo, canAssign = true,
  onSave, onBack, onOpenFullForm, now,
}) {
  const { settings, tables, bookings, groupReservations } = useBooking()
  const confirm = useConfirm()
  const [source, setSource] = useState('phone')
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState({ child: false, pet: false, mobility: false, text: '' })
  const [showNoteText, setShowNoteText] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const [keypadPos, setKeypadPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const matched = useMatchedCustomer(phone)
  const rootRef = useRef(null)
  const phoneRef = useRef(null)
  const confirmingRef = useRef(false)

  // 電話帶到顧客 → 自動帶姓名（不覆蓋店員已點的姓氏或已手打的）
  useEffect(() => {
    if (matched && !surname && !customName) setCustomName(matched.name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched?.phone])

  // 漂浮數字鍵盤定位：與帶位面板同一套（portal + fixed，不在一面式版面鏈上加 relative/transform）
  const placeKeypad = () => {
    const f = phoneRef.current?.getBoundingClientRect()
    const r = rootRef.current?.getBoundingClientRect()
    if (!f || !r) return
    const width = Math.min(KEYPAD_WIDTH, window.innerWidth - KEYPAD_GAP * 2)
    const left = Math.max(KEYPAD_GAP, Math.min(f.right + KEYPAD_GAP, window.innerWidth - width - KEYPAD_GAP))
    const bottom = Math.max(KEYPAD_GAP, window.innerHeight - r.bottom)
    setKeypadPos({ left, bottom, width })
  }
  useLayoutEffect(() => {
    if (!keypadOpen) return
    placeKeypad()
    const onResize = () => placeKeypad()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypadOpen])

  const displayName = composeName(title, surname, customName.trim()) || ''
  const phoneRequired = source === 'phone'   // 現場客可不留電話（沿用新增表單 U4：空電話不建/不併顧客檔）
  const missing = [
    !displayName && '姓名',
    phoneRequired && !phone.trim() && '電話',
    !timeSlot && '時段',
  ].filter(Boolean)
  const valid = missing.length === 0 && Number(guests) > 0
  const dirty = !!displayName || !!phone.trim()

  // 桌位語意據實：鎖桌型＝「桌 105」、預配型＝「預配 105」
  const tableLabel = !canAssign ? ''
    : needsCombo ? '大組待併桌'
    : table ? (lockKind === 'preassign' ? `預配 ${table.number}` : `桌 ${table.number}`)
    : timeSlot ? '先不指派' : ''
  const confirmLabel = ['確認新增', timeSlot, `${guests} 位`, tableLabel].filter(Boolean).join(' · ')

  const back = async () => {
    if (confirmingRef.current) return
    if (dirty) {
      confirmingRef.current = true
      const ok = await confirm('剛剛填的姓名／電話不會留下。', {
        title: '放棄這筆新增？', confirmLabel: '放棄', cancelLabel: '繼續填', danger: true,
      })
      confirmingRef.current = false
      if (!ok) return
    }
    onBack?.()
  }

  // ESC：鍵盤開著先收鍵盤，否則等同「返回」（確認框開著時不重複觸發）
  const escRef = useRef(null)
  escRef.current = () => {
    if (confirmingRef.current) return
    if (keypadOpen) { setKeypadOpen(false); return }
    back()
  }
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') escRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = () => {
    if (!valid || busy) return
    setBusy(true)
    const ok = onSave?.({
      name: displayName,
      phone: phone.trim(),
      source,
      guests: Number(guests),
      timeSlot,
      notes: { ...notes, text: notes.text.trim() },
    })
    // 成功時父層會把面板收起（元件卸載＝清空）；失敗則留著全部欄位讓店員重試
    if (ok === false) setBusy(false)
  }

  const chipCls = (active) => `min-h-[44px] px-3.5 rounded-xl border-2 text-sm font-bold transition-all ${
    active ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`

  // 桌位列（釘底）：選桌靠右邊桌況圖，這裡只顯示「現在會用哪張」與「先不指派」切換
  const tableRow = (() => {
    if (!canAssign) return null
    if (!timeSlot) {
      return <p className="text-xs font-bold text-chicken-brown/55">選好時段後，右邊桌況圖會標出可用的桌</p>
    }
    if (needsCombo) {
      return (
        <p className="text-xs font-bold text-amber-700">
          店裡沒有單桌坐得下 {guests} 位：先存檔，接近時段再到今日訂位按「指派桌位」併桌
        </p>
      )
    }
    // 釘底空間有限（iPad 左欄可視高約 506pt）→ 一行講完；門檻說明放 title
    const kindHint = lockKind === 'preassign' ? '預配：桌子先不鎖、現在仍可帶位' : '存檔後立刻鎖桌'
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-chicken-brown/60 flex-none">桌位</span>
          {table ? (
            <span data-testid="reserve-table" className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-bold ${
              lockKind === 'preassign' ? 'bg-blue-100 text-blue-800' : 'bg-chicken-green/15 text-chicken-green'}`}>
              {lockKind === 'preassign' ? `預配 ${table.number}` : `桌 ${table.number}`}
              <span className="text-[11px] font-semibold opacity-75">· {table.capacity} 人桌{table.number === suggestedNumber ? ' · 建議' : ''}</span>
            </span>
          ) : (
            <span data-testid="reserve-table" className="text-sm font-bold text-chicken-brown/60">
              {tablePick === 'none' ? '先不指派' : '這個時段沒有不撞桌的桌 · 先不指派'}
            </span>
          )}
          <div className="flex-1" />
          {tablePick === 'none' && suggestedNumber ? (
            <button type="button" onClick={() => onTablePickChange?.('auto')}
              className="min-h-[44px] px-3 rounded-lg border border-chicken-brown/15 bg-white text-xs font-bold text-chicken-brown/70">
              用建議桌 {suggestedNumber}
            </button>
          ) : table ? (
            <button type="button" onClick={() => onTablePickChange?.('none')}
              className="min-h-[44px] px-3 rounded-lg border border-chicken-brown/15 bg-white text-xs font-bold text-chicken-brown/70">
              先不指派
            </button>
          ) : null}
        </div>
        {notice && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800">{notice}</div>
        )}
        <p className="text-[11px] font-bold text-chicken-brown/50"
          title={`離用餐 ${HOLD_LEAD_MIN} 分內新增才會直接鎖桌；更早只預配，現場帶位用到這張桌會提醒`}>
          {table ? `${kindHint} · 點右邊桌況圖可換桌` : '點右邊桌況圖可選桌'}
        </p>
      </div>
    )
  })()

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col" data-testid="quick-reserve-panel">
      {/* 頂端：返回＋標題（取代分頁籤列，避免填到一半誤切籤丟資料） */}
      <div className="flex-none flex items-center gap-2 border-b border-chicken-brown/10 px-2 py-1">
        <button type="button" onClick={back}
          className="min-h-[44px] px-2.5 rounded-lg text-sm font-bold text-chicken-brown/70 hover:bg-chicken-brown/5 inline-flex items-center gap-1">
          <Icon name="chevronLeft" size={16} />返回今日訂位
        </button>
        <div className="flex-1 text-right text-sm font-bold text-chicken-red">新增今日訂位</div>
        {onOpenFullForm && (
          // 已填的姓名／電話／來源一起帶過去（完整表單 prefill 支援的欄位；key 存在就覆蓋，空字串＝清空）。
          // 人數、特殊需求完整表單的 prefill 不支援，不帶。
          <button type="button" onClick={() => onOpenFullForm({ name: displayName, phone: phone.trim(), source })}
            title="訂明天以後、或需要 LINE／線上代訂等其他來源時用完整表單"
            className="min-h-[44px] px-2 text-xs font-bold text-chicken-brown/55 underline underline-offset-2">
            其他日期
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {/* 來源：電話（預設、電話必填）｜現場（電話選填） */}
        <div className="flex items-center gap-1.5">
          <span className="label !text-xs !mb-0 mr-1">來源</span>
          {SOURCES.map(o => (
            <button key={o.value} type="button" aria-pressed={source === o.value} aria-label={`來源：${o.label}`}
              onClick={() => setSource(o.value)} className={chipCls(source === o.value)}>
              {o.label}
            </button>
          ))}
        </div>

        <HonorificNameField
          title={title}
          surname={surname}
          onChange={({ title: t, surname: s }) => { setTitle(t); setSurname(s) }}
          custom={customName}
          onCustomChange={setCustomName}
        />

        <GuestCountField value={guests} onChange={onGuestsChange} size="lg" />

        <div>
          <label className="label !text-xs !mb-1">時段（今天 · 已過的不列）</label>
          {slotNotice && (
            <p role="status" data-testid="slot-notice" className="mb-1 text-xs font-bold text-amber-700">{slotNotice}</p>
          )}
          <TimeSlotPicker
            variant="compact"
            date={todayStr()}
            value={timeSlot}
            onChange={onTimeSlotChange}
            settings={settings}
            tables={tables}
            bookings={bookings}
            groupReservations={groupReservations}
            guests={Number(guests) || 1}
            hideFull={false}
            {...(now ? { now } : {})}
          />
        </div>

        {/* 電話：點欄位浮出大數字鍵盤（inputMode none：不叫出 iOS 軟鍵盤，左欄才不會被推走） */}
        <div>
          <label className="label !text-xs !mb-1">
            電話{phoneRequired ? '' : '（選填 · 現場客可不填）'}
            <span className="ml-1.5 text-[11px] font-semibold text-chicken-brown/50">帶顧客檔 · 過敏註記</span>
          </label>
          <input
            ref={phoneRef}
            type="tel"
            inputMode="none"
            aria-label="電話"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onClick={() => setKeypadOpen(true)}
            onFocus={() => setKeypadOpen(true)}
            placeholder={phoneRequired ? '0912345678' : '現場客可不填'}
            className={`w-full h-[60px] rounded-xl border-2 px-3 text-[22px] font-bold tracking-wider tabular-nums outline-none transition-all bg-white ${
              keypadOpen ? 'border-chicken-red ring-4 ring-chicken-red/20' : 'border-chicken-brown/15'}`}
          />
          <ReturningGuestBadges phone={phone} matched={matched} />
        </div>

        {/* 特殊需求：chips 一下點選；備註收合（多數訂位不需要） */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {NOTE_OPTIONS.map(n => (
              <button key={n.key} type="button" aria-pressed={!!notes[n.key]}
                onClick={() => setNotes(p => ({ ...p, [n.key]: !p[n.key] }))}
                className={`${chipCls(!!notes[n.key])} inline-flex items-center gap-1`}>
                <Icon name={n.icon} size={14} />{n.label}
              </button>
            ))}
            <button type="button" aria-expanded={showNoteText || !!notes.text}
              onClick={() => setShowNoteText(v => !v)}
              className="min-h-[44px] px-2 text-xs font-bold text-chicken-brown/60 underline underline-offset-2">
              {showNoteText || notes.text ? '備註 ▴' : '＋ 備註'}
            </button>
          </div>
          {(showNoteText || notes.text) && (
            <input type="text" value={notes.text} aria-label="備註"
              onChange={e => setNotes(p => ({ ...p, text: e.target.value }))}
              placeholder="例：靠窗、慶生、長輩需軟食"
              className="input mt-1.5 !h-[48px]" />
          )}
        </div>
      </div>

      {/* 釘底：桌位列＋主按鈕。欄位不齊時按鈕停用並直接寫「還差：…」 */}
      <div className="flex-none border-t border-chicken-brown/10 bg-white p-3 space-y-2">
        {tableRow}
        <button
          type="button"
          onClick={save}
          disabled={!valid || busy}
          className={`w-full min-h-[52px] rounded-xl px-3 text-base font-bold transition-all ${
            valid ? 'bg-chicken-red text-white shadow-sm active:scale-[.99]' : 'bg-chicken-brown/10 text-chicken-brown/50 cursor-not-allowed'}`}
        >
          {valid ? confirmLabel : `還差：${missing.join('／')}`}
        </button>
      </div>

      {keypadOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[70] bg-black/20" onClick={() => setKeypadOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="電話數字鍵盤"
            className="fixed z-[71] rounded-xl bg-[#2b2320] p-3 shadow-2xl"
            style={keypadPos
              ? { left: keypadPos.left, bottom: keypadPos.bottom, width: keypadPos.width }
              : { left: KEYPAD_GAP, bottom: KEYPAD_GAP, width: KEYPAD_WIDTH, visibility: 'hidden' }}
          >
            <div className="flex items-start gap-2.5 px-1.5 pb-3 pt-1">
              <div className="min-w-0">
                <div className="text-3xl font-bold tracking-widest tabular-nums text-white">
                  {phone || <span className="text-white/30">輸入電話</span>}
                </div>
                <div className="mt-1 text-[11px] font-bold text-white/60">
                  {matched ? (
                    <>
                      常客・{matched.name || '（未留名）'}
                      {matched.lastVisit ? `・上次 ${new Date(matched.lastVisit).toLocaleDateString('zh-TW')}` : ''}
                      {matched.allergies && <b className="text-red-300">・忌{matched.allergies}</b>}
                    </>
                  ) : phone.length >= 4 ? '查無顧客檔（新客）' : '輸入 4 碼以上自動比對常客'}
                </div>
              </div>
              <button type="button" aria-label="收起鍵盤" onClick={() => setKeypadOpen(false)}
                className="ml-auto flex-none h-8 w-8 rounded-full bg-white/15 text-sm font-bold text-white">
                ✕
              </button>
            </div>
            <NumericKeypad value={phone} onChange={setPhone} tone="dark" onDone={() => setKeypadOpen(false)} />
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
