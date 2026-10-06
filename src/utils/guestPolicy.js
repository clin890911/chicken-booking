// 線上客人新訂位／改期的最短提前量（以客人選的抵達時段往前算）——前端文案用。
// 權威判斷在後端 functions/lib/guestReliability.js 的 MIN_GUEST_LEAD_MINUTES；兩邊數值由
// tests/functions/guestReliability.test.js 鎖成一致，改這裡必須同步改後端（反之亦然）。
// 既有訂位的取消／改人數是另一條「用餐前 2 小時」規則（bookingService.isGuestEditable / 後端 guestEditable）。
export const ONLINE_MIN_LEAD_MINUTES = 120

export function onlineLeadLabel(min = ONLINE_MIN_LEAD_MINUTES) {
  return min % 60 === 0 ? `${min / 60} 小時` : `${min} 分鐘`
}
