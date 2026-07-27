import { useState } from 'react'

// 稱謂＋姓氏快選：領檯免切輸入法。
// 版面（iPad v2）：稱謂不再獨佔一排 chips，而是併進姓氏格——7×2 的格子裡，
// 前 12 格是 12 大姓，最後一顆佔兩欄的深色鈕就是稱謂（點一下循環 先生→小姐→太太）。
// 少一排、格子更大（64px），領檯單手也點得準。
// 12 大姓依內政部戶政司 2023 全國姓名統計前 12 大姓，涵蓋約 57% 客人，免切注音就能完成登記。
// 🔴 12 大姓一顆都不能少（少一顆就得切注音，這是這個元件存在的理由）。
const TITLES = ['先生', '小姐', '太太']
const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭']

// 預設稱謂：領檯多數情況直接用「先生」，不必先點一下才有稱謂。
export const DEFAULT_TITLE = TITLES[0]

// 下一個稱謂（循環）。稱謂鈕**不是 toggle-off**：點不出「沒有稱謂」。
export function nextTitle(t) {
  const i = TITLES.indexOf(t)
  return TITLES[(i + 1) % TITLES.length]
}

// 稱謂只接在「單姓」後面。判準刻意只看字數、不看來源旗標——不論字是從 chips 選的、
// 電話帶出顧客檔的、還是店員手打的，同一個字串永遠得到同一個結果（可預測、好解釋）。
// ⚠️ 代價：兩字複姓（歐陽、諸葛）也會被當成全名而不接稱謂。
// 空字串（什麼都還沒選）算「會生效」：初始狀態的稱謂鈕本來就該是亮的、可用的。
// composeName 對空 base 另有 early return，所以這裡放寬不影響合成結果。
export function honorificApplies(base) {
  return [...String(base || '')].length <= 1
}

// 合成最終稱呼字串：custom（店員手打的姓／全名）優先於 surname 快選；兩者皆空回傳 ''。
// 單姓 → 接稱謂（陳＋先生＝陳先生）；全名 → 原樣使用（王小明就是王小明，不會變成王小明先生）。
export function composeName(title, surname, custom) {
  const base = custom || surname || ''
  if (!base) return ''
  return honorificApplies(base) ? `${base}${title || ''}` : base
}

export default function HonorificNameField({ title, surname, onChange, custom, onCustomChange }) {
  // 只用 state 記「店員手動展開過」；實際是否顯示還要 or 上 custom 有值。
  // 否則電話帶顧客檔在掛載**之後**才填入姓名時，輸入框不會打開 → 名字會被送出卻看不見。
  const [manualOpen, setManualOpen] = useState(false)
  const showCustom = manualOpen || !!custom

  // 父層理應以 DEFAULT_TITLE 起手；萬一傳進 null（舊呼叫點）也要顯示得出東西，
  // 且點一下就會把真正的稱謂寫回父層，不會停在「畫面有字、資料是空」的狀態。
  const activeTitle = TITLES.includes(title) ? title : DEFAULT_TITLE
  const upcoming = nextTitle(activeTitle)
  // 目前的姓名會不會接稱謂（全名不接）。此刻不生效就降透明度告知，
  // 但**仍然可點**——店員可能先切好稱謂再把全名改成單姓。
  const applies = honorificApplies(custom || surname || '')

  const pickSurname = (s) => onChange({ title, surname: surname === s ? null : s })
  const cycleTitle = () => onChange({ title: title === activeTitle ? upcoming : activeTitle, surname })

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="label !text-xs !mb-0">貴姓・稱謂</label>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="其他"
          aria-pressed={showCustom}
          onClick={() => { if (showCustom) onCustomChange?.(''); setManualOpen(v => !v) }}
          className={`rounded-lg border-2 px-2.5 py-1 text-xs font-bold transition-all ${
            showCustom ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}
        >
          其他姓氏…
        </button>
      </div>

      {/* 7 欄 × 2 排＝14 格：12 大姓佔前 12 格，稱謂鈕佔最後兩格 */}
      <div className="grid grid-cols-7 gap-1.5">
        {SURNAMES.map(s => (
          <button
            key={s}
            type="button"
            aria-label={s}
            aria-pressed={surname === s}
            onClick={() => pickSurname(s)}
            className={`h-16 rounded-xl border-2 text-[23px] font-bold transition-all ${
              surname === s ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          aria-label={`稱謂：${activeTitle}（點一下換${upcoming}）`}
          data-honorific-applies={applies ? 'true' : 'false'}
          onClick={cycleTitle}
          className={`col-span-2 h-16 rounded-xl border-2 border-chicken-brown bg-chicken-brown text-white flex flex-col items-center justify-center gap-0.5 transition-all ${
            applies ? '' : 'opacity-40'}`}
        >
          <span className="text-[22px] font-black leading-none">{activeTitle}</span>
          <span className="text-[10px] font-bold opacity-70 leading-none">
            {applies ? `⇄ 點一下換${upcoming}` : '全名不接稱謂'}
          </span>
        </button>
      </div>

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
