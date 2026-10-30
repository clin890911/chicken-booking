// 併桌建議套用擠一擠後，UI 要講明「這是擠一擠建議」（FastWalkInPanel 建議文字、選桌模式橫幅 ModeBanner）。
import { it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
const mocks = vi.hoisted(() => ({ combo: null }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ suggestTable: () => null, suggestTableCombo: () => mocks.combo }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn() }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
const FastWalkInPanel = (await import('../../src/components/admin/ops/FastWalkInPanel')).default
const ModeBanner = (await import('../../src/components/admin/ops/ModeBanner')).default
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, node
const mount = el => { node = document.createElement('div'); document.body.append(node); root = createRoot(node); act(() => root.render(el)) }
afterEach(() => { act(() => root?.unmount()); node?.remove() })

it('FastWalkInPanel：13 位只有兩張 6 人桌 → 建議文字標「擠一擠」', () => {
  mocks.combo = { enough: true, squeezed: true, tableNumbers: ['101', '102'], seats: 12, maxSeats: 14, floor: '1F' }
  mount(<FastWalkInPanel guests={13} tables={[]} onGuestsChange={vi.fn()} />)
  expect(node.textContent).toContain('建議 1F・101 + 102（擠一擠：12 席坐 13 位）')
})

it('FastWalkInPanel：原席就夠的組合不標擠一擠', () => {
  mocks.combo = { enough: true, squeezed: false, tableNumbers: ['101', '103'], seats: 10, maxSeats: 12, floor: '1F' }
  mount(<FastWalkInPanel guests={9} tables={[]} onGuestsChange={vi.fn()} />)
  expect(node.textContent).toContain('建議 1F・101 + 103')
  expect(node.textContent).not.toContain('擠一擠')
})

const tables = [{ number: '101', floor: '1F', capacity: 6 }, { number: '102', floor: '1F', capacity: 6 }]
const multiMode = (extra) => ({ type: 'assign-multi', kind: 'waitlist', wait: { name: '王', queueNumber: 3 }, need: 13, selected: [], suggestion: '101', suggestionTables: ['101', '102'], ...extra })

it('ModeBanner：擠一擠併桌建議 → 「建議 1F・101 + 102（擠一擠）」', () => {
  mount(<ModeBanner tables={tables} mode={multiMode({ suggestionSqueezed: true })} onApplySuggestion={vi.fn()} />)
  expect(node.textContent).toContain('建議 1F・101 + 102（擠一擠）（自行選桌）')
})

it('ModeBanner：一般併桌建議不標擠一擠', () => {
  mount(<ModeBanner tables={tables} mode={multiMode({ need: 12 })} onApplySuggestion={vi.fn()} />)
  expect(node.textContent).toContain('建議 1F・101 + 102（自行選桌）')
})
