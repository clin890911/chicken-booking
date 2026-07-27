import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '../../ui'
import { useToast } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import GuestCountField from '../GuestCountField'
import NumericKeypad from './NumericKeypad'
import ReturningGuestBadges, { useMatchedCustomer } from '../ReturningGuestBadges'
import SlideToSeat from './SlideToSeat'
import HonorificNameField, { composeName, DEFAULT_TITLE } from './HonorificNameField'

const KEYPAD_WIDTH = 392
const KEYPAD_GAP = 12

// 現場常駐「帶位」面板（v3）：順序不拘的狀態機——系統只需要「桌」和「幾位」，
// 先點桌或先選人數都行，兩者到齊底部的滑桿才亮；滑動＝入座（唯一語意，不再二次確認）。
//
// 併桌統一在同一條路徑：selected 是桌陣列，一桌走 walkInSeat、多桌走 walkInSeatMulti，
// 同一個手勢靠陣列長度分派（舊版另開 walkin-multi mode，且漏了預配/團保兩道防呆）。
//
// 版面：上半可捲、主要動作釘在底部。iPad 10 橫向左欄可視高只有 506pt，欄位全展開一定超過，
// 釘底才能保證「滑動帶位」永遠按得到（舊版主按鈕會被捲到視線外）。
//
// props:
//   guests / onGuestsChange — 人數提到父層，桌況圖才能同步標建議桌
//   tables                  — 已選桌物件陣列（父層持有，與桌況圖同一份真相）
//   onRemoveTable / onClearTables
//   warning                 — { text } 預配衝突或團體保留桌的警示；有警示時滑桿要先解鎖
//   onSeat(payload)         — 真正入座，回傳 false 代表失敗（維持欄位，方便改人數或改候位）
export default function FastWalkInPanel({
  guests, onGuestsChange, tables = [], onRemoveTable, onClearTables, warning, onSeat, onOpenTable,
  lastParty,
}) {
  const toast = useToast()
  const { suggestTable, suggestTableCombo } = useBooking()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [keypadOpen, setKeypadOpen] = useState(false) // 漂浮數字鍵盤（點電話欄才跳）
  const [keypadPos, setKeypadPos] = useState(null)
  const [override, setOverride] = useState(false)   // 有警示時，店員要先明確解鎖才滑得動
  const matched = useMatchedCustomer(phone)
  const rootRef = useRef(null)
  const phoneRef = useRef(null)

  // 漂浮鍵盤定位：錨在電話欄右側、貼齊帶位欄底部（＝主區底部）。
  // 用 portal + position:fixed 到 body，刻意**不靠**祖先當定位脈絡——現場頁是
  // h-[100dvh] 串接的一面式版面，在祖先加 transform/relative 會把高度鏈打斷。
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

  // 電話帶到顧客 → 自動帶姓名（不覆蓋店員已點的稱謂/姓氏，也不覆蓋已手打的）
  useEffect(() => {
    if (matched && !surname && !customName) setCustomName(matched.name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched?.phone])

  // 換了桌或換了警示 → 解鎖狀態重置，避免上一次的「仍要覆蓋」被沿用到下一桌
  useEffect(() => { setOverride(false) }, [warning?.text, tables.map(t => t.number).join(',')])

  const g = Number(guests) || 0
  const seats = tables.reduce((sum, t) => sum + (t.capacity || 0), 0)
  const enough = tables.length > 0 && g > 0 && seats >= g

  // 即時可坐判定（不估時間）。已選桌看合計席數；沒選桌才給建議。
  let verdict = null
  if (tables.length > 0) {
    const label = tables.map(t => t.number).join(' + ')
    verdict = g <= 0
      ? { tone: 'idle', icon: '🪑', text: `已選 ${label}（${seats} 席）· 再選人數` }
      : enough
        ? { tone: 'ok', icon: '✅', text: `${g} 位 → ${label}（${seats} 席）` }
        : { tone: 'none', icon: '⚠️', text: `${g} 位坐不下 ${seats} 席 → 再加一桌或換桌` }
  } else if (g > 0) {
    const single = suggestTable(g)
    if (single) verdict = { tone: 'ok', icon: '👉', text: `${g} 位 · 點桌況圖選位，建議 ${single.number}` }
    else {
      const combo = suggestTableCombo(g)
      verdict = combo.enough
        ? { tone: 'multi', icon: '🪑', text: `無單桌可容 → 點桌況圖選 ${combo.tableNumbers?.length || 2} 張同層空桌併桌` }
        : { tone: 'none', icon: '⏳', text: '目前座位不足 → 建議改候位取號' }
    }
  }
  const V = {
    ok: 'bg-chicken-green/15 text-chicken-green border-chicken-green/40',
    idle: 'bg-chicken-brown/5 text-chicken-brown/70 border-chicken-brown/20',
    multi: 'bg-amber-500/10 text-amber-700 border-amber-500/40',
    none: 'bg-chicken-red/10 text-chicken-red border-chicken-red/40',
  }

  const blockedByWarning = !!warning && !override
  const ready = enough && !blockedByWarning
  const slideLabel = enough
    ? (blockedByWarning ? '請先確認上方警示' : '滑動帶位 →')
    : tables.length === 0 && g <= 0 ? '先選桌與人數'
      : tables.length === 0 ? '還差桌位'
        : g <= 0 ? '還差人數' : '席數不足 · 再加一桌'

  // 目前組好的稱呼（已選桌卡片與入座共用同一份，卡片上看到什麼就是會存進去的什麼）
  const displayName = composeName(title, surname, customName.trim()) || matched?.name || ''

  const reset = () => {
    onGuestsChange(2); setTitle(DEFAULT_TITLE); setSurname(null); setCustomName('')
    setPhone(''); setNotes(''); setKeypadOpen(false); setOverride(false)
  }

  const seat = () => {
    if (!tables.length) return toast.error('請先點桌況圖選一張桌')
    if (!(g > 0)) return toast.error('請選人數')
    if (seats < g) return toast.error(`${g} 位坐不下 ${seats} 席`)
    const nm = displayName
    const allergyNote = matched?.allergies ? `過敏：${matched.allergies}` : ''
    const noteText = [notes.trim(), allergyNote].filter(Boolean).join('；')
    const ok = onSeat?.({
      name: nm, phone: phone.trim(), guests: g, notes: noteText,
      // 🔴 staffNotes＝店員手打的那段，**不含**由電話帶出的「過敏：xxx」。
      // M6「沿用上一組」只能沿用這個；用 noteText 會把上一位客人的過敏資訊
      // 帶到下一組的訂位上（個資外洩＋出餐安全）。
      staffNotes: notes.trim(),
      tableNumbers: tables.map(t => t.number),
    })
    if (ok !== false) reset()
  }

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col">
      {/* 可捲區：欄位再多也不會把底部動作推走 */}
      {/* p-3 space-y-1.5（原 p-4 space-y-3）：常態情境（一桌＋姓氏＋人數）要能一面式不捲。
          省的是留白，不是按鈕——姓氏 h-16 / 人數・電話 60px / 滑桿 66px 一格都不縮。
          「🪑 帶位」標題刻意不放：上方分頁籤已經寫著「帶位」。 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        {/* 桌位：已選→卡片（可多桌）；未選→提示點桌況圖 */}
        {tables.length > 0 ? (
          <div className="space-y-1.5">
            {tables.map(t => (
              <div key={t.number} className="flex items-center gap-3 rounded-xl border-2 border-chicken-green/60 bg-chicken-green/10 px-3 py-1.5">
                <div className="min-w-0">
                  <div className="text-xl font-black leading-none text-chicken-brown tabular-nums">{t.number}</div>
                  <div className="text-[11px] font-bold text-chicken-brown/60">
                    {[`${t.capacity} 人桌`, [displayName, g > 0 ? `${g} 位` : ''].filter(Boolean).join(' ')]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {/* 帶位籤上點空桌＝選位，抽屜點不到了 → 這裡補一個入口（維修/停用等仍在抽屜裡） */}
                <button
                  type="button"
                  aria-label={`桌 ${t.number} 詳情`}
                  onClick={() => onOpenTable?.(t.number)}
                  className="ml-auto text-xs font-bold text-chicken-brown/60 bg-white border border-chicken-brown/15 rounded-lg px-2.5 py-1.5"
                >
                  詳情
                </button>
                <button
                  type="button"
                  aria-label={`移除桌 ${t.number}`}
                  onClick={() => onRemoveTable?.(t.number)}
                  className="text-xs font-bold text-chicken-brown/60 bg-white border border-chicken-brown/15 rounded-lg px-2.5 py-1.5"
                >
                  移除
                </button>
              </div>
            ))}
            {tables.length > 1 && (
              <button
                type="button"
                onClick={onClearTables}
                className="w-full text-xs font-bold text-chicken-brown/55 py-1"
              >
                清除全部（{tables.length} 桌 · {seats} 席）
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-chicken-brown/25 bg-chicken-brown/5 px-3 py-2.5 text-sm font-bold text-chicken-brown/60 text-center">
            👉 點右邊桌況圖選一張桌
          </div>
        )}

        <HonorificNameField
          title={title}
          surname={surname}
          onChange={({ title: t, surname: s }) => { setTitle(t); setSurname(s) }}
          custom={customName}
          onCustomChange={setCustomName}
        />

        <GuestCountField value={guests} onChange={onGuestsChange} accent="amber" size="lg" />

        {/* M6 沿用上一組：連續同型客人（一直來 2 位）省掉重選。
            只有在「真的會改變什麼」時才出現——人數與註記都已相同就別佔版面、也別讓人白按一下。 */}
        {lastParty && (g !== lastParty.guests || notes.trim() !== (lastParty.notes || '')) && (
          <button
            type="button"
            onClick={() => { onGuestsChange(lastParty.guests); setNotes(lastParty.notes || '') }}
            className="w-full min-h-[44px] rounded-xl border-2 border-dashed border-chicken-brown/25 bg-chicken-cream/60 text-sm font-bold text-chicken-brown/70"
          >
            ↩︎ 沿用上一組（{lastParty.guests} 位{lastParty.notes ? ` · ${lastParty.notes}` : ''}）
          </button>
        )}

        {/* 電話常駐（不再是收合鈕）：欄位只負責顯示，點它才浮出漂浮數字鍵盤。
            inputMode="none" 是為了不要叫出 iOS 軟鍵盤——鍵盤一跳，左欄就整個被推走。 */}
        <div>
          <label className="label !text-xs !mb-1">
            電話
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
            placeholder="0912345678"
            className={`w-full h-[60px] rounded-xl border-2 px-3 text-[22px] font-bold tracking-wider tabular-nums outline-none transition-all ${
              keypadOpen
                ? 'bg-white border-chicken-red ring-4 ring-chicken-red/20'
                : 'bg-white border-chicken-brown/15'}`}
          />
          <ReturningGuestBadges phone={phone} matched={matched} />
        </div>

        <Input
          label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="例：靠窗、慶生、過敏" className="!h-[52px]" labelClassName="!text-xs !mb-1"
        />
      </div>

      {/* 釘底：警示 + 可坐判定 + 滑動帶位。永遠可見，不隨上方欄位捲走 */}
      <div className="flex-none border-t border-chicken-brown/10 bg-white p-3 space-y-2">
        {warning && (
          <div className="rounded-xl border border-chicken-red/40 bg-chicken-red/10 px-3 py-2">
            {/* 併桌時可能不只一張桌有問題 → 逐條列，勾同意前看得到全部 */}
            {(warning.lines || [warning.text]).map((line, i) => (
              <div key={i} className="text-sm font-bold text-chicken-red">⚠️ {line}</div>
            ))}
            <label className="mt-1.5 flex items-center gap-2 text-xs font-bold text-chicken-red cursor-pointer">
              <input
                type="checkbox"
                checked={override}
                onChange={e => setOverride(e.target.checked)}
                className="w-4 h-4 accent-current"
              />
              我知道，仍要帶這桌
            </label>
          </div>
        )}
        {verdict && (
          <div className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${V[verdict.tone]}`}>
            {verdict.icon} {verdict.text}
          </div>
        )}
        <SlideToSeat onConfirm={seat} disabled={!ready} label="滑動帶位 →" disabledLabel={slideLabel} />
      </div>

      {/* 漂浮數字鍵盤：遮罩刻意只用 bg-black/20——桌況圖必須全程看得見，
          領檯是「一邊看桌一邊問電話」，深色遮罩會逼他先收鍵盤才能判斷帶哪桌。
          portal 到 body：不需要在版面鏈上任何一層加 relative/transform。 */}
      {keypadOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[70] bg-black/20"
            onClick={() => setKeypadOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="電話數字鍵盤"
            className="fixed z-[71] rounded-2xl bg-[#2b2320] p-3 shadow-2xl"
            style={keypadPos
              ? { left: keypadPos.left, bottom: keypadPos.bottom, width: keypadPos.width }
              : { left: KEYPAD_GAP, bottom: KEYPAD_GAP, width: KEYPAD_WIDTH, visibility: 'hidden' }}
          >
            <div className="flex items-start gap-2.5 px-1.5 pb-3 pt-1">
              <div className="min-w-0">
                <div className="text-3xl font-black tracking-widest tabular-nums text-white">
                  {phone || <span className="text-white/30">輸入電話</span>}
                </div>
                <div className="mt-1 text-[11px] font-bold text-white/60">
                  {matched ? (
                    <>
                      🔁 常客・{matched.name || '（未留名）'}
                      {matched.lastVisit ? `・上次 ${new Date(matched.lastVisit).toLocaleDateString('zh-TW')}` : ''}
                      {matched.allergies && <b className="text-red-300">・⚠ 忌{matched.allergies}</b>}
                    </>
                  ) : phone.length >= 4 ? '查無顧客檔（新客）' : '輸入 4 碼以上自動比對常客'}
                </div>
              </div>
              <button
                type="button"
                aria-label="收起鍵盤"
                onClick={() => setKeypadOpen(false)}
                className="ml-auto flex-none h-8 w-8 rounded-full bg-white/15 text-sm font-black text-white"
              >
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
