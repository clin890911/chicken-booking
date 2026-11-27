// 選客入座 C 包（2026-11-27，docs/ux-review-seating-20261127）——左欄表單與按鈕：
//   #14 散客入座後人數回到「未選」：確認鈕寫「先選人數」且停用；「沿用上一組 N 位」一鍵帶回（只沿用 staffNotes）
//   #10 「我知道，仍要用這桌」收斂成同一個 RiskAck：帶位面板／選桌面板同一句、≥44px、勾了才解鎖（綁已選的桌）
//   #8  已選桌卡、「沿用上一組」都在釘底動作列，不插在姓氏／人數鍵上方
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ suggestTable: () => null, suggestTableCombo: () => ({ enough: false }) }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
const FastWalkInPanel = (await import('../../src/components/admin/ops/FastWalkInPanel')).default
const ModeBanner = (await import('../../src/components/admin/ops/ModeBanner')).default
const { default: RiskAck, RISK_ACK_TEXT } = await import('../../src/components/admin/ops/RiskAck')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, node
const mount = el => { node = document.createElement('div'); document.body.append(node); root = createRoot(node); act(() => root.render(el)) }
afterEach(() => { act(() => root?.unmount()); node?.remove(); root = null })
const click = el => act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
const btnByText = (t) => [...node.querySelectorAll('button')].find(b => b.textContent.includes(t))
const seatBtn = () => node.querySelector('[data-testid="walkin-seat"]')

const T103 = { number: '103', capacity: 6, floor: '1F' }

// 父層持有人數／已選桌（與 OperationsView 同一個形狀）
function Harness({ onSeat, warning = null, initialGuests = 3, initialTables = [T103], lastPartyInit = null }) {
  const [guests, setGuests] = useState(initialGuests)
  const [tables, setTables] = useState(initialTables)
  const [lastParty, setLastParty] = useState(lastPartyInit)
  return (
    <FastWalkInPanel
      guests={guests} onGuestsChange={setGuests} tables={tables} warning={warning} lastParty={lastParty}
      onRemoveTable={n => setTables(ts => ts.filter(t => t.number !== n))}
      onSeat={(p) => { onSeat?.(p); setTables([]); setLastParty({ guests: p.guests, children: p.children, notes: p.staffNotes }); return true }}
    />
  )
}

describe('#14 散客入座後人數回到「未選」', () => {
  it('入座後：沒有任何人數鍵被選中、確認鈕停用並寫「先選人數」；按「沿用上一組」才帶回 3 位', () => {
    const onSeat = vi.fn()
    mount(<Harness onSeat={onSeat} />)
    expect(seatBtn().disabled).toBe(false)
    click(seatBtn())
    expect(onSeat).toHaveBeenCalledTimes(1)
    expect(onSeat.mock.calls[0][0]).toMatchObject({ guests: 3, tableNumbers: ['103'] })
    // 1–8 位一顆都沒按下（不再預選 2）
    const pressed = [...node.querySelectorAll('button[aria-label$=" 位"]')].filter(b => b.getAttribute('aria-pressed') === 'true')
    expect(pressed.map(b => b.getAttribute("aria-label"))).toEqual([])
    expect(seatBtn().disabled).toBe(true)
    expect(seatBtn().textContent).toBe('先選人數')
    // 沿用上一組：在釘底動作列，按了人數回 3 位
    const reuse = btnByText('沿用上一組')
    expect(reuse.textContent).toContain('3 位')
    expect(reuse.closest('[data-rail-footer]')).toBeTruthy()
    click(reuse)
    expect(node.querySelector('button[aria-label="3 位"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('沿用上一組只沿用店員手打的備註（staffNotes），不沿用合成 notes 裡的過敏資訊', () => {
    mount(<Harness initialGuests={0} initialTables={[]} lastPartyInit={{ guests: 4, children: 0, notes: '靠窗' }} />)
    const reuse = btnByText('沿用上一組')
    expect(reuse.textContent).toContain('4 位 · 靠窗')
    expect(reuse.textContent).not.toContain('過敏')
    click(reuse)
    expect(node.querySelector('input[placeholder^="例：靠窗"]').value).toBe('靠窗')
  })

  it('有人數沒選桌 →「請先選桌」；都沒選 →「先選人數」（人數優先講）', () => {
    mount(<Harness initialGuests={2} initialTables={[]} />)
    expect(seatBtn().textContent).toBe('請先選桌')
    act(() => root.render(<Harness initialGuests={0} initialTables={[]} key="b" />))
    expect(seatBtn().textContent).toBe('先選人數')
  })
})

describe('#8 已選桌卡在釘底動作列（不插在鍵盤上方）', () => {
  it('選了桌：桌卡（詳情／移除）在 data-rail-footer 裡，可捲區第一個子元素仍是姓氏欄', () => {
    mount(<Harness />)
    const remove = node.querySelector('button[aria-label="移除桌 103"]')
    expect(remove.closest('[data-rail-footer]')).toBeTruthy()
    expect(node.querySelector('button[aria-label="桌 103 詳情"]').closest('[data-rail-footer]')).toBeTruthy()
    const scrollArea = node.querySelector('[data-rail-footer]').previousElementSibling
    expect(scrollArea.firstElementChild.textContent).toContain('貴姓・稱謂')
    expect(scrollArea.textContent).not.toContain('103')
  })
})

describe('#10 RiskAck：一種元件、一句話、≥44px，勾了才解鎖', () => {
  it('元件本身：字面固定、整個 label 是 44px 觸控目標、受控', () => {
    const onChange = vi.fn()
    mount(<RiskAck checked={false} onChange={onChange} />)
    const label = node.querySelector('[data-testid="risk-ack"]')
    expect(label.textContent).toBe(RISK_ACK_TEXT)
    expect(RISK_ACK_TEXT).toBe('我知道，仍要用這桌')
    expect(label.className).toContain('min-h-[44px]')
    act(() => label.querySelector('input').click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('帶位面板：有警示 → 確認鈕鎖住（請先勾選上方確認）；勾 RiskAck 才可入座；換一張桌勾選重置', () => {
    const onSeat = vi.fn()
    const warning = { text: '103 已預先配給 王先生', lines: ['103 已預先配給 王先生'] }
    mount(<Harness onSeat={onSeat} warning={warning} />)
    const ack = node.querySelector('[data-testid="risk-ack"]')
    expect(ack.textContent).toBe('我知道，仍要用這桌')
    expect(seatBtn().disabled).toBe(true)
    expect(seatBtn().textContent).toBe('請先勾選上方確認')
    act(() => ack.querySelector('input').click())
    expect(seatBtn().disabled).toBe(false)
    click(seatBtn())
    expect(onSeat).toHaveBeenCalledTimes(1)
  })

  it('選桌面板（ModeBanner 左欄）：同一個元件、同一句；未勾時確認鈕停用', () => {
    const multi = { type: 'assign-multi', kind: 'arrive', booking: { id: 'Y', name: '楊先生', guests: 4 }, need: 4, selected: ['107'], suitable: ['107'], suggestionTables: [] }
    const onConfirmWarning = vi.fn()
    mount(<ModeBanner layout="rail" mode={multi} multiSeats={4} multiMaxSeats={5} multiWarnings={['107 已排給 16:30 王先生']} multiWarningSevere multiWarningConfirmed={false}
      onConfirmWarning={onConfirmWarning} onCancel={() => {}} onConfirmMulti={() => {}} onClearSelection={() => {}} />)
    const acks = node.querySelectorAll('[data-testid="risk-ack"]')
    expect(acks).toHaveLength(1)
    expect(acks[0].textContent).toBe('我知道，仍要用這桌')
    expect(btnByText('確認入座').disabled).toBe(true)
    act(() => acks[0].querySelector('input').click())
    expect(onConfirmWarning).toHaveBeenCalledWith(true)
  })

  it('舊的三種字面都不在了', () => {
    const warning = { text: 'x', lines: ['x'] }
    mount(<Harness warning={warning} />)
    expect(node.textContent).not.toContain('仍要帶這桌')
    expect(node.textContent).not.toContain('知道了，仍用這桌')
  })
})

describe('#4／#17 選桌任務只有一顆取消、主次鈕樣式', () => {
  it('「到了・換桌入座」與「重新選桌」同一種標題列底色；左欄面板只有一顆「取消」', () => {
    const base = { type: 'assign-multi', need: 4, selected: [], suitable: ['105'], suggestionTables: [] }
    mount(<ModeBanner layout="rail" mode={{ ...base, kind: 'arrive', reseatFrom: ['106'], booking: { id: 'C', name: '陳小姐', guests: 4 } }} onCancel={() => {}} onConfirmMulti={() => {}} />)
    const headA = node.querySelector('header').className
    expect([...node.querySelectorAll('button')].filter(b => b.textContent.trim() === '取消')).toHaveLength(1)
    act(() => root.render(<ModeBanner layout="rail" mode={{ ...base, kind: 'booking', replacing: true, booking: { id: 'D', name: '王先生', guests: 4, assignedTableId: '103' } }} onCancel={() => {}} onConfirmMulti={() => {}} />))
    expect(node.querySelector('header').className).toBe(headA)
    expect([...node.querySelectorAll('button')].filter(b => b.textContent.trim() === '取消')).toHaveLength(1)
  })
})
