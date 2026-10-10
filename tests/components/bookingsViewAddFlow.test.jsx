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
    onAddBooking ? <button onClick={() => onAddBooking('2026-09-05')}>CalAddBtn</button> : <span>CalReadOnly</span>
  ),
}))
vi.mock('../../src/components/admin/AddBookingView', () => ({
  default: ({ initial, continuous, onCreated }) => (
    <div>
      <div data-testid="add-initial">{JSON.stringify(initial ?? null)}</div>
      <div data-testid="add-continuous">{String(!!continuous)}</div>
      <button onClick={() => onCreated({ id: 'x' })}>FakeSave</button>
    </div>
  ),
}))

// BookingsView 現在依 booking.create 決定要不要給「新增」子分頁（kitchen 唯讀）；
// 本檔既有案例是 manager 視角，角色矩陣取自真實 PERMISSIONS。
let currentRole = 'manager'
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => actual.PERMISSIONS[currentRole].has(p) }) }
})

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
    currentRole = 'manager'
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

  it('「新增」存檔後留在新增分頁（continuous），不跳回今日', () => {
    const onCreated = vi.fn()
    render({ onCreated })
    clickTab('新增')
    expect(container.querySelector('[data-testid="add-continuous"]').textContent).toBe('true')
    clickTab('FakeSave')
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="add-initial"]')).toBeTruthy()
    expect(container.textContent).not.toContain('TodayStub')
  })

  // 2026-10 尖峰優化：所有新增入口都是連續新增（電話一通接一通，不被帶回「今日」再點回來）
  it('日曆帶預填進「新增」：也是連續模式，存檔後留在新增分頁', () => {
    render()
    clickTab('日曆')
    clickTab('CalAddBtn')
    expect(container.querySelector('[data-testid="add-continuous"]').textContent).toBe('true')
    clickTab('FakeSave')
    expect(container.textContent).not.toContain('TodayStub')
    expect(container.querySelector('[data-testid="add-initial"]')).toBeTruthy()
  })

  it('名冊 openAdd 預填進「新增」：也是連續模式，存檔後留在新增分頁', () => {
    render({ openAdd: { phone: '0912', name: '', source: 'phone', seq: 7 } })
    expect(container.querySelector('[data-testid="add-continuous"]').textContent).toBe('true')
    clickTab('FakeSave')
    expect(container.textContent).not.toContain('TodayStub')
    expect(container.querySelector('[data-testid="add-continuous"]').textContent).toBe('true')
  })

  it.each(['floor', 'host'])('%s：同樣有「新增」子分頁（能力不變）', (role) => {
    currentRole = role
    render()
    expect([...container.querySelectorAll('button')].some(b => b.textContent.includes('新增'))).toBe(true)
  })

  it('kitchen（唯讀）：沒有「新增」子分頁、日曆也拿不到新增入口、名冊預填不會把他送進新增表單', () => {
    currentRole = 'kitchen'
    render({ openAdd: { phone: '0911222333', name: '陳先生', source: 'phone', seq: 1 } })
    expect(container.querySelector('[data-testid="add-initial"]')).toBeNull()
    expect(container.textContent).toContain('TodayStub')
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === '新增')).toBe(false)
    rerender({ openAdd: { phone: '0922', name: 'x', source: 'phone', seq: 2 } })
    expect(container.querySelector('[data-testid="add-initial"]')).toBeNull()
    clickTab('日曆')
    expect(container.textContent).not.toContain('CalAddBtn')
  })
})
