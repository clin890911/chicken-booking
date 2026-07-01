import { useState, useEffect } from 'react'

// 後台散客人數輸入：1–8 快選 chips ＋「9+」展開自由數字輸入（預設上限 200，防手誤多按 0）。
// 線上訂位人數上限（12）不走此元件，維持前端 BookingPage 與後端 guestCreateBooking 把關。
// accent：chips 選中色，'red'（訂位/編輯/規劃）或 'amber'（現場帶位）。
const QUICK = [1, 2, 3, 4, 5, 6, 7, 8]

export default function GuestCountField({ value, onChange, max = 200, accent = 'red', label = '人數', hint }) {
  // more：是否展開自訂輸入框。value>8 一律展開；點 chip 收回。
  const [more, setMore] = useState(value > 8)
  const [raw, setRaw] = useState(String(value > 8 ? value : 9))

  // 父層把 value 重設回 ≤8（例如送出後 reset）時收回輸入框，回到 chips。
  useEffect(() => { if (value <= 8) setMore(false) }, [value])

  const showInput = more || value > 8
  const chipActive = accent === 'amber'
    ? 'border-amber-500 bg-amber-500 text-white'
    : 'border-chicken-red bg-chicken-red text-white'
  const chipIdle = 'border-chicken-brown/15 bg-white text-chicken-brown'

  const commit = (s) => {
    setRaw(s)
    const n = Number(s)
    if (Number.isFinite(n) && n >= 1) onChange(Math.min(max, Math.floor(n)))
  }

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex gap-1.5 flex-wrap items-center">
        {QUICK.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => { setMore(false); onChange(n) }}
            className={`w-11 h-11 rounded-xl border-2 text-base font-black tabular-nums transition-all ${
              value === n && !showInput ? chipActive : chipIdle}`}
          >
            {n}
          </button>
        ))}
        {showInput ? (
          <input
            type="number"
            min={1}
            max={max}
            inputMode="numeric"
            value={raw}
            onChange={e => commit(e.target.value)}
            onFocus={e => e.target.select()}
            aria-label="自訂人數"
            className="input w-24 !py-2.5 font-bold"
          />
        ) : (
          <button
            type="button"
            onClick={() => { setMore(true); setRaw('9'); onChange(9) }}
            className="px-3 h-11 rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70"
          >
            9+ ▾
          </button>
        )}
      </div>
      {hint != null && <p className="text-xs text-chicken-brown/55 mt-1">{hint}</p>}
    </div>
  )
}
