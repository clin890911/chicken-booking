import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ArrivalStrip, { mergeSeatedGhosts, ARRIVE_GUARD_MS, GHOST_UNDO_GUARD_MS, SPACER_IDLE_MS } from '../../src/components/admin/floormap/ArrivalStrip'
import { SEATED_UNDO_MS } from '../../src/utils/arriveSeat'

// A3（2026-11-27，Barry：「到了」維持按一下就入座，只加防連點和原位確認）：
//   入座後 chip 原位變「✓ 林先生 → 101 已入座・復原」，復原時效內位置不變；時效過後變同寬透明佔位，
//   下一位的「到了」不會滑到剛才按的位置；600ms 內重按無效；確認卡的復原 800ms 內不吃點擊。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 6, 1, 18, 0, 0)
const table = (number, bookingId) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'reserved', currentBookingId: bookingId })
const LIN = { id: 'b1', name: '林先生', status: 'confirmed', timeSlot: '18:00', guests: 3 }
const CHEN = { id: 'b2', name: '陳小姐', status: 'confirmed', timeSlot: '18:10', guests: 2 }

let container, root
const mount = (ui) => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container); act(() => root.render(ui))
}
const items = () => [...container.querySelectorAll('[role="listitem"]')]
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

describe('ArrivalStrip A3：到了後原位確認＋防連點', () => {
  const setup = () => {
    const undoSeat = vi.fn(() => ({ ok: true }))
    let bookings = [LIN, CHEN]
    const tables = [table('101', 'b1'), table('102', 'b2')]
    const onArrive = vi.fn((t, b) => {
      // 模擬入座：這筆離開待到（報到列名單會少一筆）
      bookings = bookings.map(x => (x.id === b.id ? { ...x, status: 'arrived' } : x))
      return { ok: true, undoSeat, seatedLabel: t.number }
    })
    const render = () => act(() => root.render(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={onArrive} now={NOW.getTime()} />))
    mount(<ArrivalStrip tables={tables} bookings={bookings} onSelectTable={() => {}} onArrive={onArrive} now={NOW.getTime()} />)
    return { onArrive, undoSeat, render }
  }

  it('按「到了」→ 原位變確認卡，下一位的「到了」不左移（仍在第 2 格）', () => {
    const { onArrive, render } = setup()
    const linBtn = container.querySelector('button[aria-label="林先生 到了，入座 101"]')
    click(linBtn); render()
    expect(onArrive).toHaveBeenCalledTimes(1)
    const list = items()
    expect(list[0].dataset.seatedGhost).toBe('b1')
    expect(list[0].textContent).toContain('林先生 → 101 已入座')
    expect(list[0].querySelector('button[aria-label="復原 林先生 入座"]')).toBeTruthy()
    expect(list[1].querySelector('button[aria-label="陳小姐 到了，入座 102"]')).toBeTruthy()
    // 報到總數只算真的待到
    expect(container.textContent).toContain('等報到 1')
  })

  it('800ms 內連點兩次只入座一組；第二下落在確認卡的「復原」也不會復原', () => {
    const { onArrive, undoSeat, render } = setup()
    const linBtn = container.querySelector('button[aria-label="林先生 到了，入座 101"]')
    click(linBtn); click(linBtn)   // 同一 tick 兩次 click
    render()
    act(() => { vi.advanceTimersByTime(300) })
    click(items()[0].querySelector('button[aria-label="復原 林先生 入座"]'))   // 300ms：落在確認卡上
    act(() => { vi.advanceTimersByTime(ARRIVE_GUARD_MS - 400) })
    // 600ms 內點下一位也無效
    click(container.querySelector('button[aria-label="陳小姐 到了，入座 102"]'))
    expect(onArrive).toHaveBeenCalledTimes(1)
    expect(undoSeat).not.toHaveBeenCalled()
    // 過了防連點時間：復原正常，確認卡收掉
    act(() => { vi.advanceTimersByTime(GHOST_UNDO_GUARD_MS) })
    click(items()[0].querySelector('button[aria-label="復原 林先生 入座"]'))
    expect(undoSeat).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-seated-ghost="b1"]')).toBeNull()
  })

  it('復原時效過後變同寬透明佔位（不收合），閒置一段時間才收；下一位仍在原位', () => {
    const { render } = setup()
    click(container.querySelector('button[aria-label="林先生 到了，入座 101"]')); render()
    act(() => { vi.advanceTimersByTime(SEATED_UNDO_MS + 10) })
    let list = items()
    expect(list[0].dataset.phase).toBe('spacer')
    expect(list[0].getAttribute('aria-hidden')).toBe('true')
    expect(list[0].querySelector('button')).toBeNull()
    expect(list[1].textContent).toContain('陳小姐')
    act(() => { vi.advanceTimersByTime(SPACER_IDLE_MS + 10) })
    list = items()
    expect(list.length).toBe(1)
    expect(list[0].textContent).toContain('陳小姐')
  })

  it('disabled（選桌模式中）：列照樣顯示（不改地圖尺寸），但按「到了」無效', () => {
    const onArrive = vi.fn()
    mount(<ArrivalStrip disabled tables={[table('101', 'b1')]} bookings={[LIN]} onSelectTable={() => {}} onArrive={onArrive} now={NOW.getTime()} />)
    expect(container.querySelector('[data-testid="arrival-strip"]').dataset.disabled).toBe('true')
    click(container.querySelector('button[aria-label="林先生 到了，入座 101"]'))
    expect(onArrive).not.toHaveBeenCalled()
  })
})

describe('mergeSeatedGhosts：插回原位、尾端佔位直接拿掉', () => {
  const tg = (id) => ({ booking: { id } })
  it('插在當時右邊那顆之前；右邊那顆不在了就接在左邊那顆之後', () => {
    const ghost = { id: 'x', at: 1, phase: 'done', prevKey: 'a', nextKey: 'b', index: 1 }
    expect(mergeSeatedGhosts([tg('a'), tg('b')], [ghost]).map(i => i.key)).toEqual(['a', 'ghost-x', 'b'])
    expect(mergeSeatedGhosts([tg('a'), tg('c')], [ghost]).map(i => i.key)).toEqual(['a', 'ghost-x', 'c'])
  })
  it('佔位在尾端（後面沒有真的 chip）→ 拿掉不影響任何按鈕位置', () => {
    const spacer = { id: 'x', at: 1, phase: 'spacer', prevKey: 'a', nextKey: null, index: 1 }
    expect(mergeSeatedGhosts([tg('a')], [spacer]).map(i => i.key)).toEqual(['a'])
  })
})
