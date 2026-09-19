import { useMemo } from 'react'
import { generateTimeSlots, formatDate, nowSlot } from '../../utils/timeSlots'
import { calcSlotCapacity, isSlotClosed } from '../../utils/capacity'
import Icon from '../ui/Icon'

// now：目前時間，預設 new Date()——呼叫端／測試可注入固定值，讓「今天」的已過時段判斷可測。
// variant：'cards'（預設，所有既有呼叫點）｜'compact'（現場內嵌新增面板：左欄只有 470px 寬、
//          可視高約 506pt，大卡片一天 17 個時段會吃掉整欄 → 改成 4 欄小晶片，仍標示已滿／已關閉）。
export default function TimeSlotPicker({ date, value, onChange, settings, tables, bookings, groupReservations = [], guests = 1, hideFull = true, now = new Date(), variant = 'cards' }) {
  // 只在日期＝今天（本地日）才套用「已過時段」判斷；非今天完全不受影響。
  const isToday = date === formatDate(now)
  // nowSlot 向下取整到 30 分＝目前這個時段本身仍算「還來得及」，要保留顯示；早於它的才算過時。
  const pastThreshold = isToday ? nowSlot(now) : null

  const slots = useMemo(() => {
    const list = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    return list.map(t => {
      const closed = isSlotClosed(settings, date, t)
      const remaining = calcSlotCapacity(tables, bookings, date, t, settings, groupReservations)
      const past = pastThreshold !== null && t < pastThreshold
      return { time: t, remaining, closed, full: remaining < guests, past }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, settings, tables, bookings, groupReservations, guests, pastThreshold])

  // 已過時段一律不顯示——唯一例外是呼叫端目前已選的值（例如編輯一筆今天 11:00 的舊訂位，
  // 就算 11:00 已經過了也不能讓它從清單消失，否則畫面上看不出自己選的是哪個時段）。
  const notPast = slots.filter(s => !s.past || s.time === value)
  const hiddenPastCount = slots.length - notPast.length

  // 已關閉的時段不隱藏，改顯示為「已關閉」禁用態（與「已滿」區隔，讓店員一眼看懂）。
  const visible = hideFull ? notPast.filter(s => !s.full || s.closed) : notPast

  if (visible.length === 0 && variant === 'compact') {
    return (
      <p className="rounded-xl bg-chicken-brown/5 px-3 py-2.5 text-sm font-bold text-chicken-brown/60">
        今天已沒有可訂的時段{hiddenPastCount > 0 ? `（${hiddenPastCount} 個時段已過）` : ''}
      </p>
    )
  }

  if (visible.length === 0) {
    // 今天的時段全部已過（打烊後）≠ 全部額滿，文案要分開，不然店員會以為是客滿。
    const allPast = notPast.length === 0 && hiddenPastCount > 0
    return (
      <div className="empty-panel">
        <div className="mb-2 flex justify-center text-chicken-brown/30"><Icon name="hourglass" size={30} strokeWidth={1.5} /></div>
        <p className="font-bold text-chicken-brown">{allPast ? '今天的時段都已經過了' : '該日所有時段已滿'}</p>
        <p className="text-sm text-chicken-brown/60 mt-1">{allPast ? '請改選明天或其他日期。' : '請返回選擇其他日期，或來電詢問現場座位。'}</p>
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div>
        <div className="grid grid-cols-4 gap-1.5">
          {visible.map(s => {
            const active = value === s.time
            const disabled = s.full || s.closed
            const low = !disabled && s.remaining <= Math.max(guests * 2, 12)
            return (
              <button
                key={s.time}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`${s.time}${s.closed ? ' 已關閉' : s.full ? ' 已滿' : ''}`}
                onClick={() => onChange(s.time)}
                className={`h-[52px] rounded-xl border-2 px-1 flex flex-col items-center justify-center transition-all ${
                  active
                    ? 'border-chicken-red bg-chicken-red text-white'
                    : s.closed
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : s.full
                        ? 'border-chicken-brown/10 bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed'
                        : 'border-chicken-brown/15 bg-white text-chicken-brown'
                }`}
              >
                <span className="text-[17px] font-bold leading-none tabular-nums">{s.time}</span>
                {(disabled || low) && (
                  <span className={`mt-1 text-[10px] font-bold leading-none ${active ? 'text-white/85' : low ? 'text-chicken-yellow' : ''}`}>
                    {s.closed ? '已關閉' : s.full ? '已滿' : '少量'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {hiddenPastCount > 0 && (
          <p className="mt-1 text-[11px] text-chicken-brown/40">已隱藏 {hiddenPastCount} 個已過時段</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map(s => {
          const active = value === s.time
          const disabled = s.full || s.closed
          const tone = s.closed ? '已關閉' : s.full ? '已滿' : s.remaining <= Math.max(guests * 2, 12) ? '少量名額' : '可訂位'
          return (
            <button
              key={s.time}
              disabled={disabled}
              onClick={() => onChange(s.time)}
              className={`min-h-[72px] rounded-xl border-2 px-3 py-3 text-left transition-all ${
                active
                  ? 'border-chicken-red bg-chicken-red text-white'
                  : s.closed
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : s.full
                      ? 'border-chicken-brown/10 bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/50'
              }`}
            >
              <div className="text-base font-bold leading-tight">{s.time}</div>
              <div className={`mt-1 text-[11px] font-bold ${active ? 'text-white/90' : s.closed ? 'text-slate-400' : s.remaining <= Math.max(guests * 2, 12) ? 'text-chicken-yellow' : 'text-chicken-green'}`}>
                {s.closed ? '已關閉' : tone}
              </div>
              <div className={`mt-0.5 text-[10px] ${active ? 'text-white/70' : 'text-chicken-brown/45'}`}>
                {s.closed ? '店家暫停此時段訂位' : s.full ? '請改選其他時段' : `符合 ${guests} 位用餐`}
              </div>
            </button>
          )
        })}
      </div>
      {hiddenPastCount > 0 && (
        <p className="mt-2 text-[11px] text-chicken-brown/40">已隱藏 {hiddenPastCount} 個已過時段</p>
      )}
    </div>
  )
}
