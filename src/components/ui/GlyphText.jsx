import { Check, X, Undo2, ArrowLeftRight, ArrowRight } from 'lucide-react'

// 控制層（toast、模式橫幅、桌抽屜、浮動鍵盤）按鈕標籤裡的字元圖示 → lucide 線條圖示。
// emoji／字元圖示在不同裝置字型不一、無法跟隨文字色；線條圖示跟著 currentColor、粗細一致。
// 只換「開頭」的 ✓ ✕ × ↩ ↔ ⇄ 與「結尾」的 →；圖示 aria-hidden，按鈕的無障礙名稱＝去掉符號的純文字
// （例：「✓ 確認改桌」→ 名稱「確認改桌」；呼叫端的資料字串如 toast 的 label: '↩ 復原' 不必改）。
// 全站去 emoji（2026-10）：原本寫死在字串裡的彩色 emoji（📅 🚌 ⚠️ ⛔ 🔁…）改傳 icon={lucide 元件}，
// 例：<GlyphText icon={Ban} size={14}>整天公休</GlyphText>——同一個外框、同樣 aria-hidden、跟隨文字色。
const LEAD = [
  [/^✓\s*/, Check],
  [/^[✕×]\s*/, X],
  [/^↩\uFE0F?\s*/, Undo2],
  [/^[↔⇄]\uFE0F?\s*/, ArrowLeftRight],
]
const TRAIL = [[/\s*→$/, ArrowRight]]

export default function GlyphText({ children, icon: ExplicitIcon = null, size = 18, strokeWidth = 2.4, className = '' }) {
  if (ExplicitIcon) {
    return (
      <span className={`inline-flex items-center justify-center gap-1.5 ${className}`}>
        <ExplicitIcon size={size} strokeWidth={strokeWidth} aria-hidden="true" className="shrink-0" />
        {children != null && children !== '' && children !== false && <span>{children}</span>}
      </span>
    )
  }
  if (typeof children !== 'string') return children ?? null
  let text = children
  let Lead = null
  let Trail = null
  for (const [re, I] of LEAD) if (re.test(text)) { Lead = I; text = text.replace(re, ''); break }
  for (const [re, I] of TRAIL) if (re.test(text)) { Trail = I; text = text.replace(re, ''); break }
  if (!Lead && !Trail) return children
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 ${className}`}>
      {Lead && <Lead size={size} strokeWidth={strokeWidth} aria-hidden="true" className="shrink-0" />}
      {text && <span>{text}</span>}
      {Trail && <Trail size={size} strokeWidth={strokeWidth} aria-hidden="true" className="shrink-0" />}
    </span>
  )
}
