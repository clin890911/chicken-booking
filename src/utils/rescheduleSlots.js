// 客人「我的訂位 → 改期」可選時段：與訂位頁同一來源（後端 guestGetAvailability），純函式供測試。
// - 同一天的原時段：把本訂位自己佔的座位加回（自己改自己，不該被自己擋住）。
// - 後端標 closed（店家關閉／抵達前提前量不足／滿座門檻）的時段不能改期過去，
//   與後端 guestUpdateBooking 同口徑；原時段保留可選（只改姓名電話備註不算換時段）。
export function rescheduleSlotOptions(serverSlots, booking, form) {
  return (Array.isArray(serverSlots) ? serverSlots : [])
    .filter(s => s && typeof s.time === 'string' && /^\d{2}:\d{2}/.test(s.time))
    .map(({ time, remaining, closed }) => {
      let rem = Number(remaining) || 0
      const ownSlot = !!booking && form?.date === booking.date && time === booking.timeSlot
      if (ownSlot) rem += Number(booking.guests) || 0
      const blocked = !!closed && !ownSlot
      return {
        time,
        remaining: rem,
        closed: blocked,
        full: blocked || rem < Number(form?.guests || 1),
        period: Number(time.slice(0, 2)) < 15 ? '午餐' : '晚餐',
      }
    })
}
