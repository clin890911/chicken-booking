import { normalize } from '../services/customerService'

// 依電話（正規化為純數字）過濾出某顧客的歷史訂位，最新在前（日期 desc、同日時段 desc）。
// 純函式，供 CustomerDetailModal 呈現來訪記錄時間軸 + 單元測試。
export function customerBookings(bookings, phone) {
  const key = normalize(phone)
  if (!key) return []
  return (bookings || [])
    .filter(b => normalize(b.phone) === key)
    .sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') ||
      (b.timeSlot || '').localeCompare(a.timeSlot || '')
    )
}
