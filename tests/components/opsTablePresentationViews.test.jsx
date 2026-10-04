import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import TableSummaryView from '../../src/components/admin/ops/TableSummaryView'
import TableScheduleView from '../../src/components/admin/ops/TableScheduleView'
import { buildOpsTablePresentation } from '../../src/utils/opsTablePresentation'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const date = '2026-10-04', now = new Date('2026-10-04T12:00:00+08:00').getTime()
const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
const tables = [{ number: '102', capacity: 4, status: 'vacant' }, { number: '103', capacity: 6, status: 'vacant' }, { number: '107', capacity: 4, status: 'blocked', blockReason: '測試維修' }, { number: '108', capacity: 6, status: 'reserved' }, { number: '109', capacity: 6, status: 'dining', seatedAt: '2026-10-04T11:30:00+08:00' }, { number: '110', capacity: 6, status: 'cleaning' }]
const bookings = ['13:00', '17:00'].map((timeSlot, i) => ({ date, timeSlot, guests: 4, status: 'confirmed', assignedTableId: i ? '103' : '102' }))
let root, container
const render = View => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<View tables={tables} bookings={bookings} date={date} now={now} settings={settings} turnsByTable={{}} />)); return container.textContent }
afterEach(() => { act(() => root?.unmount()); container?.remove() })
for (const View of [TableSummaryView, TableScheduleView]) describe(`${View.name} 共用桌況`, () => {
  it('13:00衝突、17:00可用與107原因同時可見；正常狀態保留', () => {
    const text = render(View)
    for (const label of ['下組 13:00', '13:40：時段衝突', '下組 17:00', '可用至 17:00', '測試維修', '已預訂', '用餐中', '清桌']) expect(text).toContain(label)
    expect(text).not.toContain('本時段可排')
    expect(text).not.toContain('＋ 可再排')
  })
  it('父層傳入的共同字典為呈現正本，不自行另算時間', () => {
    const tablePresentation = buildOpsTablePresentation({ tables, bookings, date, now, settings })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<View tables={tables} turnsByTable={{}} tablePresentation={tablePresentation} now={now} />))
    expect(container.textContent).toContain('下組 17:00')
    expect(container.textContent).toContain('測試維修')
  })
})
