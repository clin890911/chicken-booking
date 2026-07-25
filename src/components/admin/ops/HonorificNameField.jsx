import { useState } from 'react'

// 稱謂＋姓氏快選：領檯免切輸入法。順序刻意「稱謂在上、姓氏在下」——
// 領檯看到人先知道先生/小姐，才問貴姓（店主指定的認知順序）。
// 12 大姓依內政部戶政司 2023 全國姓名統計前 12 大姓，涵蓋約 57% 客人，免切注音就能完成登記。
const TITLES = ['先生', '小姐', '太太']
const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭']

// 合成最終稱呼字串：custom（店員手打的罕見姓/複姓）優先於 surname 快選；兩者皆空回傳 ''。
export function composeName(title, surname, custom) {
  const base = custom || surname || ''
  if (!base) return ''
  return `${base}${title || ''}`
}

export default function HonorificNameField({ title, surname, onChange, custom, onCustomChange }) {
  // 只用 state 記「店員手動展開過」；實際是否顯示還要 or 上 custom 有值。
  // 否則電話帶顧客檔在掛載**之後**才填入姓名時，輸入框不會打開 → 名字會被送出卻看不見。
  const [manualOpen, setManualOpen] = useState(false)
  const showCustom = manualOpen || !!custom

  const pickTitle = (t) => onChange({ title: title === t ? null : t, surname })
  const pickSurname = (s) => onChange({ title, surname: surname === s ? null : s })

  return (
    <div>
      <label className="label">稱謂</label>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {TITLES.map(t => (
          <button
            key={t}
            type="button"
            aria-label={t}
            aria-pressed={title === t}
            onClick={() => pickTitle(t)}
            className={`h-11 rounded-xl border-2 font-bold transition-all ${
              title === t ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="label">貴姓</label>
      <div className="grid grid-cols-6 gap-1.5">
        {SURNAMES.map(s => (
          <button
            key={s}
            type="button"
            aria-label={s}
            aria-pressed={surname === s}
            onClick={() => pickSurname(s)}
            className={`h-10 rounded-xl border-2 font-bold transition-all ${
              surname === s ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="其他"
        aria-pressed={showCustom}
        onClick={() => { if (showCustom) onCustomChange?.(''); setManualOpen(v => !v) }}
        className={`w-full h-10 mt-1.5 rounded-xl border-2 font-bold transition-all ${
          showCustom ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}
      >
        其他…
      </button>

      {showCustom && (
        <input
          type="text"
          value={custom || ''}
          onChange={e => onCustomChange && onCustomChange(e.target.value)}
          placeholder="輸入姓氏（如：歐陽、諸葛）"
          aria-label="自訂姓氏"
          className="input mt-2"
        />
      )}
    </div>
  )
}
