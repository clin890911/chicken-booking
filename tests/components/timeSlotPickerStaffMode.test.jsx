import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import TimeSlotPicker from '../../src/components/booking/TimeSlotPicker'
import { calcSlotCapacity } from '../../src/utils/capacity'

// 2026-10 店主：「我們關掉的時段（closedSlots／closedSeatings），員工新增的散客訂位要可以選。只擋線上客人。」
// TimeSlotPicker 新增 ignoreOnlineClosure（員工呼叫點才傳 true）：
//   - 僅線上關閉的時段可選、標小字「線上已關」，剩餘席數照實際佔用算；
//   - 公休日（closedDates）仍「已關閉」禁用；
//   - 「已滿」行為不變；
//   - 不傳（預設 false）＝舊行為：三種關閉都禁用。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATE = '2026-11-21'
const NOW = new Date(2026, 9, 6, 10, 0) // 遠早於 DATE，排除「已過時段」干擾
const SEATINGS = [
  { id: 'lunch', name: '午餐', start: '11:00', end: '12:00' },
  { id: 'dinner', name: '晚餐', start: '17:00', end: '18:00' },
]
const base = { openTime: '11:00', closeTime: '12:00', slotInterval: 30, seatings: SEATINGS, diningDurationMin: 90, cleanupBufferMin: 10 }
const withClosures = (closures) => ({ ...base, closures: { closedDates: [], closedSlots: {}, closedSeatings: {}, ...closures } })
const tables = [{ number: '101', capacity: 10, isActive: true }]

let container, root
const render = (props) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <TimeSlotPicker
        date={DATE}
        value=""
        onChange={() => {}}
        settings={base}
        tables={tables}
        bookings={[]}
        groupReservations={[]}
        guests={2}
        hideFull={false}
        now={NOW}
        {...props}
      />
    )
  })
  return container
}
const btn = (time) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(time))

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe.each(['cards', 'compact'])('TimeSlotPicker 員工模式（variant=%s）', (variant) => {
  it('closedSlots 關掉的時段：可選、標「線上已關」；其他時段不標', () => {
    render({ variant, ignoreOnlineClosure: true, settings: withClosures({ closedSlots: { [DATE]: ['11:00'] } }) })
    expect(btn('11:00').disabled).toBe(false)
    expect(btn('11:00').textContent).toContain('線上已關')
    expect(btn('11:00').textContent).not.toContain('已關閉')
    expect(btn('11:30').textContent).not.toContain('線上已關')
  })
  it('closedSeatings 關掉整個場次：該場次時段都可選且標「線上已關」', () => {
    render({ variant, ignoreOnlineClosure: true, settings: withClosures({ closedSeatings: { [DATE]: ['lunch'] } }) })
    for (const t of ['11:00', '11:30']) {
      expect(btn(t).disabled).toBe(false)
      expect(btn(t).textContent).toContain('線上已關')
    }
  })
  it('公休日（closedDates）仍「已關閉」不可選', () => {
    render({ variant, ignoreOnlineClosure: true, settings: withClosures({ closedDates: [DATE] }) })
    for (const t of ['11:00', '11:30']) {
      expect(btn(t).disabled).toBe(true)
      expect(btn(t).textContent).toContain('已關閉')
      expect(btn(t).textContent).not.toContain('線上已關')
    }
  })
  it('線上已關但實際客滿 → 照舊「已滿」禁用（不放寬超收）', () => {
    const bookings = [{ id: 'b1', date: DATE, timeSlot: '11:00', guests: 10, status: 'confirmed' }]
    render({ variant, ignoreOnlineClosure: true, bookings, settings: withClosures({ closedSlots: { [DATE]: ['11:00'] } }) })
    expect(btn('11:00').disabled).toBe(true)
    expect(btn('11:00').textContent).toContain('已滿')
  })
  it('點選線上已關的時段 → onChange 收到該時段', () => {
    const picked = []
    render({ variant, ignoreOnlineClosure: true, onChange: (t) => picked.push(t), settings: withClosures({ closedSlots: { [DATE]: ['11:00'] } }) })
    act(() => { btn('11:00').click() })
    expect(picked).toEqual(['11:00'])
  })
  it('不傳 ignoreOnlineClosure（預設）→ 舊行為：關閉時段「已關閉」禁用、不標線上已關', () => {
    render({ variant, settings: withClosures({ closedSlots: { [DATE]: ['11:00'] }, closedSeatings: {} }) })
    expect(btn('11:00').disabled).toBe(true)
    expect(btn('11:00').textContent).toContain('已關閉')
    expect(btn('11:00').textContent).not.toContain('線上已關')
  })
})

describe('calcSlotCapacity ignoreOnlineClosure', () => {
  const bookings = [{ id: 'b1', date: DATE, timeSlot: '11:00', guests: 4, status: 'confirmed' }]
  it('預設（線上口徑）：關閉場次/時段/公休都回 0', () => {
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedSlots: { [DATE]: ['11:00'] } }))).toBe(0)
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedSeatings: { [DATE]: ['lunch'] } }))).toBe(0)
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedDates: [DATE] }))).toBe(0)
  })
  it('員工口徑：僅線上關閉 → 實際剩餘；公休日仍 0', () => {
    const opt = { ignoreOnlineClosure: true }
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedSlots: { [DATE]: ['11:00'] } }), [], opt)).toBe(6)
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedSeatings: { [DATE]: ['lunch'] } }), [], opt)).toBe(6)
    expect(calcSlotCapacity(tables, bookings, DATE, '11:00', withClosures({ closedDates: [DATE] }), [], opt)).toBe(0)
  })
})
