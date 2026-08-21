import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// BookingsView：日曆「＋ 新增訂位」與名冊「➕ 新增訂位」共用同一套「新增」子分頁預填管道。
// 兩條路都要能各自正確把值送進 AddBookingView：
//   - 日曆路徑：只帶 { date, seq } → 切到「新增」子分頁
//   - 名冊路徑（既有）：openAdd prop 的 seq 變更 → 切到「新增」子分頁，原樣照舊
// 子元件（CalendarView / AddBookingView）本身的呈現邏輯已各自有測試覆蓋，這裡只驗證
// BookingsView 自己的路由／預填狀態管理不出錯，換成無依賴的樁減少 mock 面積。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../src/components/admin/TodayView', () => ({ default: () => <div>TodayStub</div> }))
vi.mock('../../src/components/admin/SearchBookingsView', () => ({ default: () => <div>SearchStub</div> }))
vi.mock('../../src/components/admin/CalendarView', () => ({
  default: ({ onAddBooking }) => (
    <button onClick={() => onAddBooking('2026-09-05')}>CalAddBtn</button>
  ),
}))
vi.mock('../../src/components/admin/AddBookingView', () => ({
  default: ({ initial }) => <div data-testid="add-initial">{JSON.stringify(initial ?? null)}</div>,
}))

const BookingsView = (await import('../../src/components/admin/BookingsView')).default

describe('BookingsView：日曆／名冊兩條「新增訂位」預填路徑', () => {
  let container, root

  const render = (props = {}) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<BookingsView {...props} />) })
    return container
  }

  const rerender = (props) => act(() => { root.render(<BookingsView {...props} />) })

  const clickTab = (label) => {
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes(label))
    act(() => btn.click())
  }

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('日曆按「＋ 新增訂位」→ 切到「新增」子分頁，且 initial.date 是選定日期', () => {
    render()
    clickTab('日曆')
    expect(container.textContent).toContain('CalAddBtn')
    clickTab('CalAddBtn')
    expect(container.querySelector('[data-testid="add-initial"]')).toBeTruthy()
    const initial = JSON.parse(container.querySelector('[data-testid="add-initial"]').textContent)
    expect(initial.date).toBe('2026-09-05')
    expect(initial.seq).toEqual(expect.any(Number))
  })

  it('名冊路徑（openAdd prop）原樣照舊：seq 變更即跳「新增」分頁、帶入 phone/name/source', () => {
    render({ openAdd: null })
    // 名冊帶入預填（AdminPage 的 openAddBooking 組出的 shape）
    rerender({ openAdd: { phone: '0911222333', name: '陳先生', source: 'phone', seq: 1000 } })
    const initial = JSON.parse(container.querySelector('[data-testid="add-initial"]').textContent)
    expect(initial).toEqual({ phone: '0911222333', name: '陳先生', source: 'phone', seq: 1000 })
  })

  it('先走日曆路徑、之後名冊路徑 seq 更新 → 以較新觸發的名冊預填為準（互不干擾）', () => {
    render()
    clickTab('日曆')
    clickTab('CalAddBtn')
    let initial = JSON.parse(container.querySelector('[data-testid="add-initial"]').textContent)
    expect(initial.date).toBe('2026-09-05')

    rerender({ openAdd: { phone: '0922333444', name: '林小姐', source: 'walkin', seq: 999999999999 } })
    initial = JSON.parse(container.querySelector('[data-testid="add-initial"]').textContent)
    expect(initial).toEqual({ phone: '0922333444', name: '林小姐', source: 'walkin', seq: 999999999999 })
  })

  it('掛載時 openAdd 已有值：初始就直接落在「新增」子分頁（既有行為不變）', () => {
    render({ openAdd: { phone: '', name: '', source: 'phone', seq: 42 } })
    expect(container.querySelector('[data-testid="add-initial"]')).toBeTruthy()
    const initial = JSON.parse(container.querySelector('[data-testid="add-initial"]').textContent)
    expect(initial.seq).toBe(42)
  })
})
