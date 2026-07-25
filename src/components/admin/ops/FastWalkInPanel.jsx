import { useState, useEffect } from 'react'
import { Input } from '../../ui'
import { useToast } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import GuestCountField from '../GuestCountField'
import NumericKeypad from './NumericKeypad'
import ReturningGuestBadges, { useMatchedCustomer } from '../ReturningGuestBadges'
import SlideToSeat from './SlideToSeat'
import HonorificNameField, { composeName } from './HonorificNameField'

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
}) {
  const toast = useToast()
  const { suggestTable, suggestTableCombo } = useBooking()
  const [title, setTitle] = useState(null)
  const [surname, setSurname] = useState(null)
  const [customName, setCustomName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [showPhone, setShowPhone] = useState(false)
  const [override, setOverride] = useState(false)   // 有警示時，店員要先明確解鎖才滑得動
  const matched = useMatchedCustomer(phone)

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

  const reset = () => {
    onGuestsChange(2); setTitle(null); setSurname(null); setCustomName('')
    setPhone(''); setNotes(''); setShowPhone(false); setOverride(false)
  }

  const seat = () => {
    if (!tables.length) return toast.error('請先點桌況圖選一張桌')
    if (!(g > 0)) return toast.error('請選人數')
    if (seats < g) return toast.error(`${g} 位坐不下 ${seats} 席`)
    const nm = composeName(title, surname, customName.trim()) || matched?.name || ''
    const allergyNote = matched?.allergies ? `過敏：${matched.allergies}` : ''
    const noteText = [notes.trim(), allergyNote].filter(Boolean).join('；')
    const ok = onSeat?.({
      name: nm, phone: phone.trim(), guests: g, notes: noteText,
      tableNumbers: tables.map(t => t.number),
    })
    if (ok !== false) reset()
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 可捲區：欄位再多也不會把底部動作推走 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <div className="text-sm font-black text-chicken-brown flex items-center gap-1.5">🪑 帶位</div>

        {/* 桌位：已選→卡片（可多桌）；未選→提示點桌況圖 */}
        {tables.length > 0 ? (
          <div className="space-y-1.5">
            {tables.map(t => (
              <div key={t.number} className="flex items-center gap-3 rounded-xl border-2 border-chicken-green/60 bg-chicken-green/10 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xl font-black leading-none text-chicken-brown tabular-nums">{t.number}</div>
                  <div className="text-[11px] font-bold text-chicken-brown/60">{t.capacity} 人桌</div>
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

        <GuestCountField value={guests} onChange={onGuestsChange} accent="amber" />

        {/* 電話收進次級區：大鍵盤佔 210pt，常態用不到就別佔版面 */}
        {showPhone ? (
          <div>
            <label className="label !mb-1">電話（自動帶顧客檔）</label>
            <Input
              type="tel" inputMode="numeric" value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="0912345678" className="text-lg font-bold tracking-wide"
            />
            <ReturningGuestBadges phone={phone} matched={matched} />
            <div className="mt-2"><NumericKeypad value={phone} onChange={setPhone} /></div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPhone(true)}
            className="w-full min-h-[44px] rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70"
          >
            ＋ 電話（帶顧客檔 · 過敏註記）
          </button>
        )}

        <Input label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)} placeholder="例：靠窗、慶生、過敏" />
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
    </div>
  )
}
