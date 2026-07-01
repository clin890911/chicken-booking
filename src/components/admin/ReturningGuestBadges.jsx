import { useMemo } from 'react'
import * as customerService from '../../services/customerService'
import { getNoshowCount } from '../../services/bookingService'

// 電話帶顧客檔：以電話（先導鍵）比對顧客檔。完全命中或唯一模糊命中才回傳。
// 供 AddBookingView / FastWalkInPanel 共用，避免各自複製一份查詢邏輯。
export function useMatchedCustomer(phone) {
  return useMemo(() => {
    if (!phone || phone.length < 4) return null
    const c = customerService.getByPhone(phone)
    if (c) return c
    const matches = customerService.search(phone)
    return matches.length === 1 ? matches[0] : null
  }, [phone])
}

// 回頭客徽章列：第幾次來訪 / VIP / 過敏 / no-show / 黑名單。
// matched 可由父層傳入（避免重算）；未傳則自行以 phone 查。
export default function ReturningGuestBadges({ phone, matched }) {
  const auto = useMatchedCustomer(phone)
  const c = matched !== undefined ? matched : auto
  const noshow = phone ? getNoshowCount(phone) : 0
  if (!c && !noshow) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      {c && (
        <span className="px-2.5 py-1 bg-chicken-green/15 text-chicken-green rounded-full font-bold">
          🔄 第 {(c.visits || 0) + 1} 次{c.lastVisit ? ` · 上次 ${new Date(c.lastVisit).toLocaleDateString('zh-TW')}` : ''}
        </span>
      )}
      {c?.vipTier && c.vipTier !== 'none' && (
        <span className="px-2.5 py-1 bg-chicken-yellow/20 text-chicken-yellow rounded-full font-bold">⭐ {c.vipTier.toUpperCase()}</span>
      )}
      {c?.allergies && (
        <span className="px-2.5 py-1 bg-chicken-red/10 text-chicken-red rounded-full font-bold">⚠️ 過敏：{c.allergies}</span>
      )}
      {noshow > 0 && (
        <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">⚠️ no-show ×{noshow}</span>
      )}
      {c?.blacklisted && (
        <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">🚫 黑名單{c.blacklistReason ? `：${c.blacklistReason}` : ''}</span>
      )}
    </div>
  )
}
