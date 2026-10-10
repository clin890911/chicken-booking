// 員工（後台）訂位的時段預設／保留規則：現場內嵌新增面板、後台新增訂位、編輯訂位共用同一口徑。
// 「可訂」＝非公休日（closedDates）、剩餘席數夠（照實際佔用算），且（今天）還沒過。
// 「關閉場次 / 時段」只停線上客人（2026-10 店主）：員工不跳過它們（ignoreOnlineClosure）。
// 純函式，now 可注入（測試固定時間）。
import { generateTimeSlots, formatDate, nowSlot } from './timeSlots'
import { calcSlotCapacity, isDayClosedForClosures } from './capacity'

export const staffSlotOk = ({ settings = {}, tables = [], bookings = [], groupReservations = [], date, guests = 1 }, t) =>
  !isDayClosedForClosures(settings, date)
  && calcSlotCapacity(tables, bookings, date, t, settings, groupReservations, { ignoreOnlineClosure: true }) >= guests

// 預設時段＝「下一個還沒開始」且可訂的時段；今天都過了回 ''。
// 店主要的是「接電話 → 大多訂接下來的場」，70–90% 店員不必改。
export function nextBookableSlot({ settings = {}, tables = [], bookings = [], groupReservations = [], date, guests = 1, now = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    .find(t => t > nowHHMM && staffSlotOk({ settings, tables, bookings, groupReservations, date, guests }, t)) || ''
}

// 換日期時的時段：原時段在新日期仍「可訂」就保留（店員常是「同一個時間，改成明天」），
// 否則：新日期是今天 → 預選下一個可訂時段；其他日 → 清空讓店員重選。
// 「仍可訂」＝新日期的時段表裡有它、非公休、剩餘席數夠、（今天）不早於目前這個時段（與 TimeSlotPicker 的「已過」同口徑）。
export function slotForDateChange(prevSlot, { settings = {}, tables = [], bookings = [], groupReservations = [], date, guests = 1, now = new Date() } = {}) {
  const ctx = { settings, tables, bookings, groupReservations, date, guests }
  const isToday = date === formatDate(now)
  if (prevSlot) {
    const exists = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval).includes(prevSlot)
    const notPast = !isToday || prevSlot >= nowSlot(now)
    if (exists && notPast && staffSlotOk(ctx, prevSlot)) return prevSlot
  }
  return isToday ? nextBookableSlot({ ...ctx, now }) : ''
}
