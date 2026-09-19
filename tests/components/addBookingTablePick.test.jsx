import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// AddBookingView × 選桌（2026-09 店主回報：余先生現場訂位，輸入完資料後沒辦法選桌）。
// S5：今日訂位的指派一律走 BookingContext.assignBookingToTable（含 refresh／同步／Telegram），
//     不可直接呼叫 seatingService（存檔後卡片會有幾秒停在「建議桌 106／指派桌位」的舊畫面）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mkT = (number, capacity = 4, floor = '1F') => ({ number, capacity, floor, isActive: true, status: 'vacant' })
const T105 = mkT('105'), T106 = mkT('106'), T201 = mkT('201', 6, '2F')

const ctx = {}
function resetCtx() {
  Object.assign(ctx, {
    bookings: [], tables: [T105, T106, T201], groupReservations: [],
    settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
    addBooking: vi.fn(d => ({ id: 'BNEW', ...d })),
    suggestTable: vi.fn(() => T105),
    findSuitableTables: vi.fn(() => [T105, T106, T201]),
    assignBookingToTable: vi.fn(() => ({ ok: true })),
  })
}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test' } }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast }))

const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default

describe('AddBookingView：今日訂位選桌', () => {
  let container, root
  const onAssignTable = vi.fn()
  const onMoveTable = vi.fn()

  const render = (props = {}) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<AddBookingView onAssignTable={onAssignTable} onMoveTable={onMoveTable} {...props} />) })
  }
  const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const buttons = () => [...container.querySelectorAll('button')]
  const btn = (pred) => buttons().find(pred)
  const click = (el) => act(() => { el.click() })
  const fillBasics = ({ phone = '0933111222', name = '余先生', slot = '11:00' } = {}) => {
    if (phone != null) typeInto(container.querySelector('input[type="tel"]'), phone)
    typeInto(container.querySelector('input[placeholder="王小姐"]'), name)
    click(btn(b => b.textContent.trim().startsWith(slot)))
  }
  const confirmBtn = () => btn(b => b.textContent.includes('確認新增'))

  beforeEach(() => { resetCtx(); vi.clearAllMocks() })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('S5：存檔後的指派走 Context 的 assignBookingToTable（帶建議桌），不直接戳 service', () => {
    render()
    fillBasics()
    click(confirmBtn())
    expect(ctx.addBooking).toHaveBeenCalledTimes(1)
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('BNEW', '105')
  })

  // ---- U1：表單內可選桌 ----
  const chip = (num) => btn(b => b.textContent.trim().startsWith(`${num} · `))
  const pickArea = () => container.querySelector('[data-testid="table-pick"]')

  it('U1：選完時段出現「桌位」區，第一張預選並標「建議」，確認列帶出桌號；舊 checkbox 已移除', () => {
    render()
    expect(container.textContent).toContain('選好時段後')          // 沒選時段：只給提示
    fillBasics()
    expect(pickArea()).toBeTruthy()
    expect(chip('105').getAttribute('aria-pressed')).toBe('true')
    expect(chip('105').textContent).toContain('建議')
    expect(chip('106').getAttribute('aria-pressed')).toBe('false')
    expect(pickArea().textContent).toContain('1F')
    expect(pickArea().textContent).toContain('2F')
    expect(confirmBtn().textContent).toMatch(/確認新增 · .* 11:00 · 2 位 · 桌 105/)
    // 候選依所選時段查（S3 口徑）
    // 候選依「存檔即鎖桌」的佔用區間查（mode 'hold'：[min(現在, 時段), 時段+佔位)，驗收問題 1）
    expect(ctx.findSuitableTables).toHaveBeenCalledWith(2, expect.objectContaining({ timeSlot: '11:00', mode: 'hold' }))
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(container.textContent).not.toContain('自動指派最佳桌')
  })

  it('U1：改選 106 → 確認列變「桌 106」，存檔指派到所選桌；toast 帶「改桌」', () => {
    render()
    fillBasics()
    click(chip('106'))
    expect(chip('106').getAttribute('aria-pressed')).toBe('true')
    expect(confirmBtn().textContent).toContain('桌 106')
    click(confirmBtn())
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('BNEW', '106')
    const [msg, action] = toast.action.mock.calls.at(-1)
    expect(msg).toContain('已指派 106')
    expect(action.label).toBe('改桌')
    action.onClick()
    expect(onMoveTable).toHaveBeenCalledWith(expect.objectContaining({ id: 'BNEW', assignedTableId: '106' }))
  })

  it('U1：選「先不指派」→ 存檔不指派任何桌', () => {
    render()
    fillBasics()
    click(btn(b => b.textContent.trim() === '先不指派'))
    expect(confirmBtn().textContent).toContain('先不指派')
    click(confirmBtn())
    expect(ctx.addBooking).toHaveBeenCalledTimes(1)
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(onAssignTable).not.toHaveBeenCalled()
  })

  it('U1：選「到桌況圖選（可併桌）」→ 存檔後走 onAssignTable（進現場指派模式），不直接指派', () => {
    render()
    fillBasics()
    click(btn(b => b.textContent.includes('到桌況圖選')))
    click(confirmBtn())
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(onAssignTable).toHaveBeenCalledWith(expect.objectContaining({ id: 'BNEW' }))
  })

  it('U1：人數改了、已選的 106 不再合格 → 回到新的建議並提示', () => {
    ctx.findSuitableTables = vi.fn((g) => (g <= 4 ? [T105, T106, T201] : [T201]))
    render()
    fillBasics()
    click(chip('106'))
    click(container.querySelector('button[aria-label="6 位"]'))
    expect(container.textContent).toContain('106 不適用目前的人數／時段，已改回建議桌 201')
    expect(chip('201').getAttribute('aria-pressed')).toBe('true')
    expect(confirmBtn().textContent).toContain('6 位 · 桌 201')
  })

  it('U1：有單桌坐得下、只是此刻沒空桌可鎖 → 預設「先不指派」並說明，存檔不跳頁', () => {
    ctx.findSuitableTables = vi.fn(() => [])
    render()
    fillBasics()
    expect(pickArea().textContent).toContain('此刻沒有空桌可鎖，先存檔、接近用餐時間再到現場頁指派')
    expect(btn(b => b.textContent.trim() === '先不指派').getAttribute('aria-pressed')).toBe('true')
    expect(confirmBtn().textContent).toContain('先不指派')
    click(confirmBtn())
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(onAssignTable).not.toHaveBeenCalled()
  })

  it('U1：店裡沒有任何單桌坐得下（需併桌）→ 預設「到桌況圖選（可併桌）」並據實說明', () => {
    ctx.tables = [T105, T106]                                     // 最大 4 人桌
    ctx.findSuitableTables = vi.fn(() => [])
    render()
    fillBasics()
    click(container.querySelector('button[aria-label="6 位"]'))
    expect(pickArea().textContent).toContain('店裡沒有單桌坐得下 6 位，需要併桌')
    expect(btn(b => b.textContent.includes('到桌況圖選')).getAttribute('aria-pressed')).toBe('true')
    expect(confirmBtn().textContent).toContain('到桌況圖選桌')
    click(confirmBtn())
    expect(onAssignTable).toHaveBeenCalledTimes(1)
  })

  it('U1：非今天不顯示桌位區，存檔後 toast 引導預配（維持現況）', () => {
    render()
    click(btn(b => b.textContent.trim().startsWith('明天')))
    fillBasics()
    expect(pickArea()).toBeNull()
    click(confirmBtn())
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(toast.action.mock.calls.at(-1)[1].label).toBe('預配桌位')
  })

  // ---- U4：來源＝現場時電話選填 ----
  it('U4：來源＝現場 → 電話選填（placeholder 提示），空電話可直接存檔', () => {
    render()
    click(btn(b => b.textContent.trim() === '現場'))
    expect(container.querySelector('input[type="tel"]').getAttribute('placeholder')).toBe('現場客可不填')
    fillBasics({ phone: null })
    expect(confirmBtn()).toBeTruthy()
    click(confirmBtn())
    expect(ctx.addBooking).toHaveBeenCalledWith(expect.objectContaining({ phone: '', source: 'walkin' }))
  })

  it('U4：其他來源電話仍必填（缺電話不出確認鈕、列在「還差」）', () => {
    render()
    fillBasics({ phone: null })
    expect(confirmBtn()).toBeUndefined()
    expect(btn(b => b.textContent.trim() === '電話')).toBeTruthy()
  })
})
