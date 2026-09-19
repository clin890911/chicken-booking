import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useState } from 'react'

// 現場「今日訂位 → ＋新增今日訂位」內嵌面板（2026-09 店主選「留在現場頁新增」）。
// 面板本身：預設（人數 2、下一個還沒開始的時段、建議桌）、欄位不齊停用並寫「還差」、
// 存檔 payload、失敗留在面板、返回（有填姓名／電話先確認「放棄這筆新增？」，ESC 等同返回）。
// 人數／時段／選的桌由父層（OperationsView）持有，這裡用小 harness 模擬。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const settings = { openTime: '11:00', closeTime: '19:00', slotInterval: 30, diningDurationMin: 90, cleanupBufferMin: 10 }
const mkT = (number, capacity = 4) => ({ number, capacity, floor: '1F', isActive: true, status: 'vacant' })
const ctx = { settings, tables: [mkT('105'), mkT('106'), mkT('101', 6)], bookings: [], groupReservations: [] }
const confirmMock = vi.fn(async () => true)

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useConfirm: () => confirmMock, useToast: () => ({}) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))

const { default: QuickReservePanel, nextBookableSlot, pastSlotFix } = await import('../../src/components/admin/ops/QuickReservePanel')

const NOW = new Date(2026, 8, 19, 13, 10)
const TODAY = '2026-09-19'

describe('nextBookableSlot（預設時段＝下一個還沒開始、可訂的時段）', () => {
  const base = { settings, tables: ctx.tables, bookings: [], groupReservations: [], date: TODAY, guests: 2 }
  it('13:10 → 13:30；剛好 13:30 → 14:00（已開始的不算）', () => {
    expect(nextBookableSlot({ ...base, now: NOW })).toBe('13:30')
    expect(nextBookableSlot({ ...base, now: new Date(2026, 8, 19, 13, 30) })).toBe('14:00')
  })
  it('跳過已關閉與已滿的時段；今天都過了 → 空字串', () => {
    const closed = { ...settings, closures: { closedSlots: { [TODAY]: ['13:30'] } } }
    expect(nextBookableSlot({ ...base, settings: closed, now: NOW })).toBe('14:00')
    expect(nextBookableSlot({ ...base, guests: 15, now: NOW })).toBe('')       // 全店 14 席
    expect(nextBookableSlot({ ...base, now: new Date(2026, 8, 19, 19, 5) })).toBe('')
  })
})

describe('pastSlotFix（面板開著跨過時段）', () => {
  const env = (over = {}) => ({ settings, tables: ctx.tables, bookings: [], groupReservations: [], date: TODAY, guests: 2, ...over })
  it('所選時段早於目前時段 → 改選目前時段＋說明；目前時段本身／之後 → null', () => {
    expect(pastSlotFix('17:00', new Date(2026, 8, 19, 17, 31), env()))
      .toEqual({ slot: '17:30', notice: '17:00 已經過了，已改選目前時段 17:30' })
    expect(pastSlotFix('17:30', new Date(2026, 8, 19, 17, 31), env())).toBeNull()
    expect(pastSlotFix('18:00', new Date(2026, 8, 19, 17, 31), env())).toBeNull()
  })
  it('間隔 60 分（17:30 不是時段）：選 17:00、17:31 → 改選 18:00，不可清空', () => {
    const hourly = { ...settings, slotInterval: 60 }
    expect(pastSlotFix('17:00', new Date(2026, 8, 19, 17, 31), env({ settings: hourly })))
      .toEqual({ slot: '18:00', notice: '17:00 已經過了，已改選下一個可訂時段 18:00' })
  })
  it('開店非整／半點（11:15 起每 30 分）：選 16:45、17:31 → 改選 17:45', () => {
    const odd = { ...settings, openTime: '11:15', closeTime: '19:15' }
    expect(pastSlotFix('16:45', new Date(2026, 8, 19, 17, 31), env({ settings: odd })).slot).toBe('17:45')
  })
  it('跳過已關閉／已滿：17:30 關閉 → 改選 18:00；全都滿 → 清空並說明', () => {
    const closed = { ...settings, closures: { closedSlots: { [TODAY]: ['17:30'] } } }
    expect(pastSlotFix('17:00', new Date(2026, 8, 19, 17, 31), env({ settings: closed })).slot).toBe('18:00')
    expect(pastSlotFix('17:00', new Date(2026, 8, 19, 17, 31), env({ guests: 15 })))
      .toEqual({ slot: '', notice: '17:00 已經過了，今天已沒有可訂的時段' })
  })
  it('打烊後（沒有 ≥ 目前時段的時段）→ 清空並說明', () => {
    expect(pastSlotFix('19:00', new Date(2026, 8, 19, 19, 40), env()))
      .toEqual({ slot: '', notice: '19:00 已經過了，今天已沒有可訂的時段' })
  })
})

describe('QuickReservePanel', () => {
  let container, root, onSave, onBack, onPick
  // harness：模擬 OperationsView 持有人數／時段／選桌，並依 kind 給出 table
  function Harness({ kind = 'preassign', needsCombo = false, initialSlot = '14:00', saveResult = true, onOpenFullForm }) {
    const [guests, setGuests] = useState(2)
    const [slot, setSlot] = useState(initialSlot)
    const [pick, setPick] = useState('auto')
    const table = pick === 'none' || !slot || needsCombo ? null : ctx.tables[0]
    return (
      <QuickReservePanel
        guests={guests} onGuestsChange={setGuests}
        timeSlot={slot} onTimeSlotChange={setSlot}
        lockKind={slot ? kind : null} table={table}
        tablePick={pick} onTablePickChange={(v) => { onPick(v); setPick(v) }}
        suggestedNumber="105" needsCombo={needsCombo}
        onSave={(p) => { onSave(p); return saveResult }} onBack={onBack}
        onOpenFullForm={onOpenFullForm}
        now={NOW}
      />
    )
  }
  const render = (props = {}) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<Harness {...props} />) })
  }
  const btns = () => [...container.querySelectorAll('button')]
  const byLabel = (l) => container.querySelector(`button[aria-label="${l}"]`)
  const byText = (t) => btns().find(b => b.textContent.trim() === t)
  const mainBtn = () => btns().at(-1)
  const click = (el) => act(() => { el.click() })

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    onSave = vi.fn(); onBack = vi.fn(); onPick = vi.fn()
    confirmMock.mockReset(); confirmMock.mockResolvedValue(true)
  })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('渲染：返回鈕＋標題；預設人數 2、時段（父層預設）選中、建議桌「預配 105 · 建議」；已過時段不列', () => {
    render()
    expect(container.textContent).toContain('返回今日訂位')
    expect(container.textContent).toContain('新增今日訂位')
    expect(byLabel('2 位').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('14:00').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('12:30')).toBeNull()                 // 13:10 時 12:30 已過
    const t = container.querySelector('[data-testid="reserve-table"]')
    expect(t.textContent).toContain('預配 105')
    expect(t.textContent).toContain('建議')
    expect(container.textContent).toContain('預配：桌子先不鎖、現在仍可帶位')
  })

  it('鎖桌型（離用餐 30 分內）→「桌 105」＋「存檔後立刻鎖桌」', () => {
    render({ kind: 'hold', initialSlot: '13:30' })
    expect(container.querySelector('[data-testid="reserve-table"]').textContent).toContain('桌 105')
    expect(container.textContent).toContain('存檔後立刻鎖桌')
  })

  it('欄位不齊 → 主按鈕停用並寫「還差：姓名／電話」；來源現場時電話選填 → 可按，標籤帶時段／人數／桌', () => {
    render()
    expect(mainBtn().disabled).toBe(true)
    expect(mainBtn().textContent).toBe('還差：姓名／電話')
    click(byLabel('王'))
    expect(mainBtn().textContent).toBe('還差：電話')
    click(byLabel('來源：現場'))
    expect(mainBtn().disabled).toBe(false)
    expect(mainBtn().textContent).toBe('確認新增 · 14:00 · 2 位 · 預配 105')
  })

  it('存檔：payload 帶組好的稱呼、來源、人數、時段、特殊需求；「先不指派」改標籤', () => {
    render()
    click(byLabel('王'))
    click(container.querySelector('button[aria-label^="稱謂："]'))         // 先生 → 小姐
    click(byLabel('來源：現場'))
    click(byLabel('3 位'))
    click(byText('兒童'))
    expect(byText('先不指派').className).toContain('min-h-[44px]')     // 觸控尺寸 ≥44px
    click(byText('先不指派'))
    expect(onPick).toHaveBeenCalledWith('none')
    expect(byText('用建議桌 105').className).toContain('min-h-[44px]')
    expect(mainBtn().textContent).toBe('確認新增 · 14:00 · 3 位 · 先不指派')
    click(mainBtn())
    expect(onSave).toHaveBeenCalledWith({
      name: '王小姐', phone: '', source: 'walkin', guests: 3, timeSlot: '14:00',
      notes: { child: true, pet: false, mobility: false, text: '' },
    })
  })

  it('存檔失敗（onSave 回 false）→ 留在面板、欄位不丟、按鈕可再按', () => {
    render({ saveResult: false })
    click(byLabel('林'))
    click(byLabel('來源：現場'))
    click(mainBtn())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(byLabel('林').getAttribute('aria-pressed')).toBe('true')
    expect(mainBtn().disabled).toBe(false)
    click(mainBtn())
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('大組（沒有單桌坐得下）→ 桌位列說明併桌、按鈕標「大組待併桌」', () => {
    render({ needsCombo: true })
    expect(container.textContent).toContain('店裡沒有單桌坐得下 2 位')
    click(byLabel('陳')); click(byLabel('來源：現場'))
    expect(mainBtn().textContent).toBe('確認新增 · 14:00 · 2 位 · 大組待併桌')
  })

  it('返回：沒填姓名／電話 → 直接返回；有填 → 先確認「放棄這筆新增？」，按繼續填不返回、按放棄才返回', async () => {
    render()
    click(byText('返回今日訂位'))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onBack).toHaveBeenCalledTimes(1)

    click(byLabel('張'))
    confirmMock.mockResolvedValueOnce(false)
    await act(async () => { byText('返回今日訂位').click() })
    expect(confirmMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: '放棄這筆新增？' }))
    expect(onBack).toHaveBeenCalledTimes(1)

    await act(async () => { byText('返回今日訂位').click() })
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('「其他日期」→ 完整表單，帶上已填的姓名／電話／來源（完整表單 prefill 支援的欄位）；沒給入口就不顯示', () => {
    render()
    expect(byText('其他日期')).toBeUndefined()
    act(() => root.unmount()); container.remove()
    const onOpenFullForm = vi.fn()
    render({ onOpenFullForm })
    click(byLabel('蔡'))
    click(byLabel('來源：現場'))
    click(byText('其他日期'))
    expect(onOpenFullForm).toHaveBeenCalledWith({ name: '蔡先生', phone: '', source: 'walkin' })
  })

  it('ESC 等同返回（有填先確認）', async () => {
    render()
    click(byLabel('李'))
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
