import Icon from './Icon'
import { useGlass } from '../../contexts/GlassContext'

// Liquid Glass 打樣：把標籤裡的字元圖示（✓ ✕ ↩ ⇄ 💡 →）在玻璃模式換成 lucide 線條圖示。
// 未開玻璃時原字串照印——DOM 文字、無障礙名稱、既有測試的選擇器（如「✓ 確認改桌」）全部不變。
// 玻璃模式下圖示 aria-hidden，按鈕名稱變成去掉符號的純文字（例：「確認改桌」）。
const LEAD = [
  [/^✓\s*/, 'check'], [/^✕\s*/, 'close'], [/^×\s*/, 'close'], [/^↩︎?\s*/, 'undo'], [/^⇄\s*/, 'swap'], [/^💡\s*/, 'idea'],
]
const TRAIL = [[/\s*→$/, 'arrowRight']]

export default function GlyphText({ children, size = 18, className = '' }) {
  const glass = useGlass()
  if (!glass || typeof children !== 'string') return children ?? null
  let text = children
  let lead = null
  let trail = null
  for (const [re, name] of LEAD) if (re.test(text)) { lead = name; text = text.replace(re, ''); break }
  for (const [re, name] of TRAIL) if (re.test(text)) { trail = name; text = text.replace(re, ''); break }
  if (!lead && !trail) return children
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 ${className}`}>
      {lead && <Icon name={lead} size={size} strokeWidth={2.4} />}
      {text && <span>{text}</span>}
      {trail && <Icon name={trail} size={size} strokeWidth={2.4} />}
    </span>
  )
}
