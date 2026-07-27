import { useState, useEffect } from 'react'

// 後台散客人數輸入：1–8 快選 chips ＋「9+」展開自由數字輸入（預設上限 200，防手誤多按 0）。
// 線上訂位人數上限（12）不走此元件，維持前端 BookingPage 與後端 guestCreateBooking 把關。
// accent：chips 選中色，'red'（訂位/編輯/規劃）或 'amber'（現場帶位）。
// size：'md'（預設，所有既有呼叫點）或 'lg'（只有現場帶位面板傳）——iPad 站著單手點，
//       chips 放大到 60px 並改用 8 欄格線佔滿欄寬，「9+/自訂」移到標題列右側。
// ⚠️ chips 的 aria-label 必須維持「N 位」（既有可及性紅線），兩種尺寸都不可改成裸數字。
const QUICK = [1, 2, 3, 4, 5, 6, 7, 8]

// 夾住自訂人數：非數字或 < 1 回 null（不更新）；否則取整並套上限（防手誤多按 0）。
export function clampGuests(n, max = 200) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 1) return null
  return Math.min(max, Math.floor(v))
}

export default function GuestCountField({ value, onChange, max = 200, accent = 'red', label = '人數', hint, size = 'md' }) {
  // more：是否展開自訂輸入框。value>8 一律展開；點 chip 收回。
  const [more, setMore] = useState(value > 8)
  const [raw, setRaw] = useState(String(value > 8 ? value : 9))
  const [editing, setEditing] = useState(false) // 輸入框是否持有焦點

  // 父層把 value 重設回 ≤8（例如送出後 reset）時收回輸入框，回到 chips。
  // 輸入中（focus）不收：打「12」時鍵入「1」的瞬間 value=1 ≤ 8，若立即收合，
  // 輸入框會被卸載、焦點消失，第二位數就打不進去（畫面一直跳掉）。
  useEffect(() => { if (value <= 8 && !editing) setMore(false) }, [value, editing])

  const showInput = more || value > 8
  const chipActive = accent === 'amber'
    ? 'border-amber-500 bg-amber-500 text-white'
    : 'border-chicken-red bg-chicken-red text-white'
  const chipIdle = 'border-chicken-brown/15 bg-white text-chicken-brown'

  const commit = (s) => {
    setRaw(s)
    const v = clampGuests(s, max)
    if (v != null) onChange(v)
  }

  // 失焦才結算：無效（清空/亂字）還原目前值；有效則同步顯示（含夾上限），≤8 收回 chips
  const handleBlur = () => {
    setEditing(false)
    const v = clampGuests(raw, max)
    setRaw(String(v ?? value))
  }

  const lg = size === 'lg'

  // lg 的「9+/自訂」在標題列，是低頻控制項（≥9 位才用到）；壓成 h-9 是為了讓
  // 常態情境（一桌＋姓氏＋人數）整個左欄不捲——放大的是 chips 本身，不是這顆。
  const overflowControl = showInput ? (
    <input
      type="number"
      min={1}
      max={max}
      inputMode="numeric"
      value={raw}
      onChange={e => commit(e.target.value)}
      onFocus={e => { setEditing(true); e.target.select() }}
      onBlur={handleBlur}
      aria-label="自訂人數"
      className={`input w-24 font-bold ${lg ? '!h-9 !py-1' : '!py-2.5'}`}
    />
  ) : (
    <button
      type="button"
      onClick={() => { setMore(true); setRaw('9'); onChange(9) }}
      className={`px-3 rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70 ${lg ? 'h-9' : 'h-11'}`}
    >
      9+ ▾
    </button>
  )

  return (
    <div>
      {/* lg：標題與「9+/自訂」同一列，下面整排格線讓 chips 吃滿欄寬 */}
      <div className={lg ? 'flex items-center gap-2 mb-1' : ''}>
        {label && <label className={`label ${lg ? '!text-xs !mb-0' : ''}`}>{label}</label>}
        {lg && <><div className="flex-1" />{overflowControl}</>}
      </div>
      <div className={lg ? 'grid grid-cols-8 gap-1.5' : 'flex gap-1.5 flex-wrap items-center'}>
        {QUICK.map(n => (
          <button
            key={n}
            type="button"
            aria-label={`${n} 位`}
            // 這些是切換鈕，選中狀態原本只用顏色表達 → 補 aria-pressed，讀屏才讀得出來
            aria-pressed={value === n && !showInput}
            onClick={() => { setMore(false); onChange(n) }}
            className={`rounded-xl border-2 font-black tabular-nums transition-all ${
              lg ? 'h-[60px] text-[22px]' : 'w-11 h-11 text-base'} ${
              value === n && !showInput ? chipActive : chipIdle}`}
          >
            {n}
          </button>
        ))}
        {!lg && overflowControl}
      </div>
      {hint != null && <p className="text-xs text-chicken-brown/55 mt-1">{hint}</p>}
    </div>
  )
}
