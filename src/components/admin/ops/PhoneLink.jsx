import { formatPhone, telHref } from '../../../utils/phoneFormat'

// 現場卡片上的完整電話（今日訂位／候位／團體導遊共用）：格式化＋可直接點撥。
// 無電話（現場散客常見、或 kitchen 角色被後端剝除）→ 不渲染任何東西，不放佔位符。
// 電話永不截斷（whitespace-nowrap + flex-shrink-0），要讓位的是姓名。
// stopPropagation：卡片本身點了會開詳情，點電話只撥號。
export default function PhoneLink({ phone, className = '', testId = 'phone-full' }) {
  const text = formatPhone(phone)
  const href = telHref(phone)
  if (!text || !href) return null
  return (
    <a
      href={href}
      data-testid={testId}
      onClick={e => e.stopPropagation()}
      className={`tabular-nums whitespace-nowrap flex-shrink-0 font-bold text-chicken-brown underline decoration-chicken-brown/25 underline-offset-2 ${className}`}
    >
      {text}
    </a>
  )
}
