import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import ArrivalStrip from '../../src/components/admin/floormap/ArrivalStrip'

// 報到列（二版設計，取代疊在桌況圖上的「到了」浮動鈕——一版在相鄰桌同時進窗時，鈕會互相
// 完全遮擋，document.elementFromPoint 命中蓋在上面那顆，真的點擊會誤觸入座錯的訂位，
// 已由獨立驗收抓到，店主拍板改設計）。報到列是地圖下方的 in-flow 橫向列，物理上不可能
// 疊到桌況圖或彼此，所以不需要測「碰撞」，改測：出現條件、排序、點擊行為、空清單零高度。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const table = (over = {}) => ({
  number: '101', capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 75,
  rotation: 0, zoneId: null, isActive: true, outage: null, status: 'reserved',
  currentBookingId: 'b1', currentRef: null, seatedAt: null, mergedWith: null,
  blockReason: null, updatedAt: null, ...over,
})

const NOW = new Date(2026, 6, 1, 18, 0, 0).getTime() // 2026-07-01 18:00

describe('ArrivalStrip', () => {
  let container, root
  const mount = (ui) => act(() => { root.render(ui) })
  const setup = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('沒有任何符合條件的訂位：完全不渲染（container 沒有子節點，零高度）', () => {
    setup()
    mount(
      <ArrivalStrip tables={[table({ status: 'vacant', currentBookingId: null })]} bookings={[]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('有符合條件的訂位：顯示 chip，含時段／姓名／桌號，鈕帶正確 aria-label', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table()]} bookings={[booking]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    expect(container.textContent).toContain('18:00')
    expect(container.textContent).toContain('王小明')
    expect(container.textContent).toContain('101')
    const btn = container.querySelector('button[aria-label="王小明 到了，入座 101"]')
    expect(btn).toBeTruthy()
  })

  it('點「✓ 到了」：呼叫 onArrive(table, booking)，不觸發 onSelectTable', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    const onArrive = vi.fn()
    const onSelectTable = vi.fn()
    mount(
      <ArrivalStrip tables={[table()]} bookings={[booking]}
        onSelectTable={onSelectTable} onArrive={onArrive} now={NOW} />
    )
    const btn = container.querySelector('button[aria-label*="王小明"]')
    act(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(onArrive).toHaveBeenCalledTimes(1)
    expect(onArrive.mock.calls[0][0].number).toBe('101')
    expect(onArrive.mock.calls[0][1]).toEqual(booking)
    expect(onSelectTable).not.toHaveBeenCalled()
  })

  it('點 chip 本體（不是按鈕）：呼叫 onSelectTable(桌號)，選取該桌', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    const onSelectTable = vi.fn()
    mount(
      <ArrivalStrip tables={[table()]} bookings={[booking]}
        onSelectTable={onSelectTable} onArrive={() => {}} now={NOW} />
    )
    const chip = container.querySelector('[role="listitem"]')
    act(() => chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(onSelectTable).toHaveBeenCalledWith('101')
  })

  it('按鈕實體高度樣式 = 44px', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table()]} bookings={[booking]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const btn = container.querySelector('button[aria-label*="王小明"]')
    expect(btn.style.height).toBe('44px')
  })

  it('遲到（已過訂位時間 >15 分）：帶「遲到」標記，且排在未遲到的前面', () => {
    setup()
    const bookings = [
      { id: 'b1', name: '準時客', timeSlot: '18:00' },       // now=18:00 → 剛好到，不算遲到
      { id: 'b2', name: '遲到客', timeSlot: '17:30' },       // 已過 30 分 > 15 分寬限 → 遲到
    ]
    const tables = [
      table({ number: '101', currentBookingId: 'b1' }),
      table({ number: '102', currentBookingId: 'b2' }),
    ]
    mount(
      <ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chips = [...container.querySelectorAll('[role="listitem"]')]
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toContain('遲到客') // 遲到的排最前面
    expect(chips[0].textContent).toContain('遲到')
    expect(chips[1].textContent).toContain('準時客')
    expect(chips[1].textContent).not.toContain('遲到')
  })

  it('都遲到時：越晚到的排越前面', () => {
    setup()
    const bookings = [
      { id: 'b1', name: 'A遲到20分', timeSlot: '17:40' }, // overdue 20 分
      { id: 'b2', name: 'B遲到40分', timeSlot: '17:20' }, // overdue 40 分（更晚）
    ]
    const tables = [
      table({ number: '101', currentBookingId: 'b1' }),
      table({ number: '102', currentBookingId: 'b2' }),
    ]
    mount(
      <ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chips = [...container.querySelectorAll('[role="listitem"]')]
    expect(chips[0].textContent).toContain('B遲到40分')
    expect(chips[1].textContent).toContain('A遲到20分')
  })

  it('都未遲到：依訂位時段由早到晚排序', () => {
    setup()
    const bookings = [
      { id: 'b1', name: '晚一點', timeSlot: '18:30' },
      { id: 'b2', name: '早一點', timeSlot: '18:00' },
    ]
    const tables = [
      table({ number: '101', currentBookingId: 'b1' }),
      table({ number: '102', currentBookingId: 'b2' }),
    ]
    mount(
      <ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chips = [...container.querySelectorAll('[role="listitem"]')]
    expect(chips[0].textContent).toContain('早一點')
    expect(chips[1].textContent).toContain('晚一點')
  })

  it('涵蓋所有樓層：2F 的符合桌也會出現在同一條報到列', () => {
    setup()
    const booking = { id: 'b1', name: '二樓客', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table({ number: '201', floor: '2F' })]} bookings={[booking]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    expect(container.textContent).toContain('二樓客')
    expect(container.textContent).toContain('201')
  })

  it('窗外的訂位不出現在報到列', () => {
    setup()
    const booking = { id: 'b1', name: '太早訂位', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table()]} bookings={[booking]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW - 90 * 60000} />
    )
    expect(container.firstChild).toBeNull()
  })

  // === 三版：總筆數標籤 + 左右緣捲動遮罩（純視覺，不動 isArriveEligible／排序）===

  // 建 n 筆都在窗內、都不遲到、時段依序遞增的訂位，方便測總數與捲動遮罩。
  function makeManyTargets(n) {
    const bookings = []
    const tables = []
    for (let i = 0; i < n; i++) {
      const id = `b${i}`
      bookings.push({ id, name: `客人${i}`, timeSlot: '18:00' })
      tables.push(table({ number: `10${i}`, currentBookingId: id }))
    }
    return { tables, bookings }
  }

  it('標籤顯示真實總筆數（等報到 N），即使畫面上只看得到一部分', () => {
    setup()
    const { tables, bookings } = makeManyTargets(6)
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    expect(container.textContent).toContain('等報到 6')
    // 6 筆全部都在 DOM 裡（不是漏渲染，只是可能被捲出可視範圍）
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(6)
  })

  it('標籤只有 1 筆時也顯示正確總數', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    mount(<ArrivalStrip tables={[table()]} bookings={[booking]} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    expect(container.textContent).toContain('等報到 1')
  })

  // jsdom 不做真實版面配置，scrollWidth/clientWidth 預設都是 0。用既有專案手法
  // （見 tests/components/slideToSeat.test.jsx 的 stubWidth）直接覆寫這兩個唯讀屬性，
  // 模擬「內容比容器寬」，再 dispatch scroll 事件觸發元件的量測邏輯，驗證純視覺提示的開關邏輯。
  function stubScrollMetrics(el, { scrollWidth, clientWidth, scrollLeft }) {
    Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
    Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true })
  }

  it('scrollWidth > clientWidth 且在最左邊：右緣提示出現、左緣不出現', () => {
    setup()
    const { tables, bookings } = makeManyTargets(6)
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    const scrollEl = container.querySelector('[role="list"]')
    stubScrollMetrics(scrollEl, { scrollWidth: 1411, clientWidth: 558, scrollLeft: 0 })
    act(() => scrollEl.dispatchEvent(new window.Event('scroll', { bubbles: true })))
    expect(container.querySelector('[data-edge="right"]')).toBeTruthy()
    expect(container.querySelector('[data-edge="left"]')).toBeNull()
  })

  it('往右捲動後：左緣提示出現', () => {
    setup()
    const { tables, bookings } = makeManyTargets(6)
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    const scrollEl = container.querySelector('[role="list"]')
    stubScrollMetrics(scrollEl, { scrollWidth: 1411, clientWidth: 558, scrollLeft: 200 })
    act(() => scrollEl.dispatchEvent(new window.Event('scroll', { bubbles: true })))
    expect(container.querySelector('[data-edge="left"]')).toBeTruthy()
    expect(container.querySelector('[data-edge="right"]')).toBeTruthy() // 中間位置：兩緣都還有內容
  })

  it('捲到底：右緣提示消失（左緣仍在，因為左邊還有被捲過去的內容）', () => {
    setup()
    const { tables, bookings } = makeManyTargets(6)
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    const scrollEl = container.querySelector('[role="list"]')
    // scrollLeft + clientWidth === scrollWidth → 捲到底
    stubScrollMetrics(scrollEl, { scrollWidth: 1411, clientWidth: 558, scrollLeft: 853 })
    act(() => scrollEl.dispatchEvent(new window.Event('scroll', { bubbles: true })))
    expect(container.querySelector('[data-edge="right"]')).toBeNull()
    expect(container.querySelector('[data-edge="left"]')).toBeTruthy()
  })

  it('內容裝得下（scrollWidth <= clientWidth）：兩緣提示都不出現', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    mount(<ArrivalStrip tables={[table()]} bookings={[booking]} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    const scrollEl = container.querySelector('[role="list"]')
    stubScrollMetrics(scrollEl, { scrollWidth: 300, clientWidth: 558, scrollLeft: 0 })
    act(() => scrollEl.dispatchEvent(new window.Event('scroll', { bubbles: true })))
    expect(container.querySelector('[data-edge="right"]')).toBeNull()
    expect(container.querySelector('[data-edge="left"]')).toBeNull()
  })

  it('提示是純視覺：不影響 chip 數量、順序或 aria-label（判定與排序邏輯未被觸碰）', () => {
    setup()
    const { tables, bookings } = makeManyTargets(3)
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={NOW} />)
    const scrollEl = container.querySelector('[role="list"]')
    const before = [...container.querySelectorAll('[role="listitem"]')].map(el => el.textContent)
    stubScrollMetrics(scrollEl, { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 })
    act(() => scrollEl.dispatchEvent(new window.Event('scroll', { bubbles: true })))
    const after = [...container.querySelectorAll('[role="listitem"]')].map(el => el.textContent)
    expect(after).toEqual(before)
  })

  // === 三版：跨樓層標記 ===

  it('currentFloor 與桌樓層相同：桌號不標樓層', () => {
    setup()
    const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table({ floor: '1F' })]} bookings={[booking]} currentFloor="1F"
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chip = container.querySelector('[role="listitem"]')
    expect(chip.textContent).toContain('101')
    expect(chip.textContent).not.toContain('1F')
  })

  it('currentFloor 與桌樓層不同：桌號前標樓層（跨樓層會自動切換，先讓店員知道）', () => {
    setup()
    const booking = { id: 'b1', name: '二樓客', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table({ number: '201', floor: '2F' })]} bookings={[booking]} currentFloor="1F"
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chip = container.querySelector('[role="listitem"]')
    expect(chip.textContent).toContain('2F')
    expect(chip.textContent).toContain('201')
  })

  it('未傳 currentFloor：不標任何樓層（向後相容，不誤標）', () => {
    setup()
    const booking = { id: 'b1', name: '二樓客', timeSlot: '18:00' }
    mount(
      <ArrivalStrip tables={[table({ number: '201', floor: '2F' })]} bookings={[booking]}
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chip = container.querySelector('[role="listitem"]')
    expect(chip.textContent).not.toContain('2F')
    expect(chip.textContent).toContain('201')
  })

  it('混合樓層：同樓層不標、跨樓層標，兩者互不影響', () => {
    setup()
    const bookings = [
      { id: 'b1', name: '一樓客', timeSlot: '18:00' },
      { id: 'b2', name: '二樓客', timeSlot: '18:01' },
    ]
    const tables = [
      table({ number: '101', floor: '1F', currentBookingId: 'b1' }),
      table({ number: '201', floor: '2F', currentBookingId: 'b2' }),
    ]
    mount(
      <ArrivalStrip tables={tables} bookings={bookings} currentFloor="1F"
        onSelectTable={() => {}} onArrive={() => {}} now={NOW} />
    )
    const chips = [...container.querySelectorAll('[role="listitem"]')]
    const sameFloorChip = chips.find(c => c.textContent.includes('一樓客'))
    const crossFloorChip = chips.find(c => c.textContent.includes('二樓客'))
    expect(sameFloorChip.textContent).not.toContain('2F')
    expect(crossFloorChip.textContent).toContain('2F')
  })
})
