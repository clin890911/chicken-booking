import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import TimeSlotPicker from '../../src/components/booking/TimeSlotPicker'

// 店主回報：「在現場按了：今日訂位 > 新增今日訂位，還可以新增已經過了的時間段」。
// TimeSlotPicker 原本只看 s.full || s.closed，完全不管現在幾點——日期＝今天時，早就過去的
// 時段（例如現在 13:51 還能選 11:00）照樣列在清單裡讓人點。
//
// 修法：日期＝今天（本地日）時，開始時間早於 nowSlot() 的時段不顯示；nowSlot 向下取整到
// 30 分，目前這個時段本身仍要保留（店員現在還來得及排）。唯一例外是呼叫端目前已選的值——
// EditBookingModal 編輯一筆今天 11:00 的舊訂位時，就算 11:00 已經過了也不能讓它從清單消失，
// 否則畫面上看不出自己選的是哪個時段。非今天日期完全不受影響。
//
// 元件本身不吃任何 Context（純 props），不必掛 BookingProvider/AuthProvider 那一套，
// 用 react-dom/client + act 直接掛載即可（慣例見 tests/components/upcomingPanelPermissions.test.jsx）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 固定時鐘：2026-06-15 13:51 本地。todayStr()／預設 now 都吃這個假時鐘。
const NOW = new Date(2026, 5, 15, 13, 51, 0)
const TODAY = '2026-06-15'
const TOMORROW = '2026-06-16'

// 一張大容量桌，確保沒有任何時段因為「已滿」被過濾，隔離掉只測「已過時段」這件事。
const tables = [{ number: '101', capacity: 100 }]
const settings = { openTime: '11:00', closeTime: '19:00', slotInterval: 30 }

describe('TimeSlotPicker：今日已過時段不顯示', () => {
  let container, root

  const render = (props) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <TimeSlotPicker
          date={TODAY}
          value=""
          onChange={() => {}}
          settings={settings}
          tables={tables}
          bookings={[]}
          groupReservations={[]}
          guests={1}
          hideFull={false}
          {...props}
        />
      )
    })
    return container
  }
  const slotTimes = () => [...container.querySelectorAll('button')].map(b => b.querySelector('.text-base')?.textContent)

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('13:00 以前的時段不顯示，13:30（目前時段本身）顯示', () => {
    render({})
    const times = slotTimes()
    expect(times).not.toContain('11:00')
    expect(times).not.toContain('12:30')
    expect(times).not.toContain('13:00')
    expect(times).toContain('13:30')
    expect(times).toContain('19:00')
  })

  it('提示列寫出已隱藏的已過時段數量（11:00/11:30/12:00/12:30/13:00 共 5 個）', () => {
    render({})
    expect(container.textContent).toContain('已隱藏 5 個已過時段')
  })

  it('沒有已過時段被隱藏時不顯示提示列（明天全顯示，見下一個 describe）', () => {
    render({ date: TOMORROW })
    expect(container.textContent).not.toContain('已隱藏')
  })

  it('例外：呼叫端目前已選的值即使是已過時段仍要顯示並保持選取（EditBookingModal 編輯今天 11:00 舊訂位）', () => {
    render({ value: '11:00' })
    const times = slotTimes()
    expect(times).toContain('11:00')
    // 11:00 仍是「已選中」狀態（bg-chicken-red 是 active 的樣式）
    const btn11 = [...container.querySelectorAll('button')].find(b => b.querySelector('.text-base')?.textContent === '11:00')
    expect(btn11.className).toContain('bg-chicken-red')
    // 其餘已過時段仍照常隱藏，只有 11:00 破例
    expect(times).not.toContain('11:30')
    expect(times).not.toContain('12:30')
    // 隱藏數量因此少算 1（4 個，不含被保留的 11:00）
    expect(container.textContent).toContain('已隱藏 4 個已過時段')
  })

  it('now 可由外部注入（不依賴真實系統時間）：09:00 時 08:xx 以前的時段才算過時', () => {
    const earlyNow = new Date(2026, 5, 15, 9, 5, 0)
    render({ now: earlyNow })
    const times = slotTimes()
    // nowSlot(9:05) = 09:00，11:00 開店本來就晚於 09:00，全部時段都不算過時
    expect(times).toContain('11:00')
    expect(container.textContent).not.toContain('已隱藏')
  })
})

describe('TimeSlotPicker：非今天的日期完全不受影響', () => {
  let container, root

  const render = (props) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <TimeSlotPicker
          date={TOMORROW}
          value=""
          onChange={() => {}}
          settings={settings}
          tables={tables}
          bookings={[]}
          groupReservations={[]}
          guests={1}
          hideFull={false}
          {...props}
        />
      )
    })
    return container
  }
  const slotTimes = () => [...container.querySelectorAll('button')].map(b => b.querySelector('.text-base')?.textContent)

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('明天：11:00 到 19:00 全部時段都顯示，不受「現在 13:51」影響', () => {
    render({})
    const times = slotTimes()
    expect(times).toEqual(['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'])
    expect(container.textContent).not.toContain('已隱藏')
  })
  it('打烊後今天時段全過：顯示「今天的時段都已經過了」而不是「已滿」', () => {
    render({ date: TODAY, now: new Date(2026, 5, 15, 19, 40, 0) })
    expect(slotTimes()).toEqual([])
    expect(container.textContent).toContain('今天的時段都已經過了')
    expect(container.textContent).not.toContain('所有時段已滿')
  })

  it('isToday 吃注入的 now：系統時鐘在今天，但 now 注入成隔天 → 今天的日期不再算今天、全部顯示', () => {
    render({ date: TODAY, now: new Date(2026, 5, 16, 13, 51, 0) })
    expect(slotTimes()).toHaveLength(17)
  })
})
