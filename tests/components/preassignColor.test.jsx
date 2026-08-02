import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TableShape from '../../src/components/admin/floormap/TableShape'
import FloorMap from '../../src/components/admin/floormap/FloorMap'
import { STATUS_COLOR, GROUP_HOLD_COLOR, PREASSIGN_COLOR } from '../../src/components/admin/floormap/statusColors'

// 預配桌的桌況圖著色（2026-08）。
// 店主回報：同時段兩筆訂位在訂位卡上都寫「已指派」，桌況圖上卻一藍一綠。
// 差別是指派路徑——現場頁 assignBookingToTable 會 reserveTable() 把桌鎖成 reserved（藍），
// 規劃頁預配只寫 booking.assignedTableId、桌況不動（桌仍 vacant → 綠色可入座）。
// 修法：預配桌改用同一支訂位藍，以虛線框保留「這桌實體還是空的、別人坐得進去」的資訊。

const baseTable = (over = {}) => ({
  number: '112', capacity: 4, floor: '1F', x: 100, y: 100, w: 90, h: 75,
  rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null,
  blockReason: null, updatedAt: null, ...over,
})

const wrapSvg = (node) => renderToStaticMarkup(<svg>{node}</svg>)

describe('TableShape：預配桌著色', () => {
  it('空桌被預配 → 訂位藍底 + 虛線藍框（不再是「可入座」的綠）', () => {
    const html = wrapSvg(<TableShape table={baseTable()} preassignLabel="📌 11:30 預配" onClick={() => {}} />)
    expect(html).toContain(`fill="${PREASSIGN_COLOR.fill}"`)
    expect(html).toContain(`stroke-dasharray="${PREASSIGN_COLOR.strokeDash}"`)
    expect(html).not.toContain(`fill="${STATUS_COLOR.vacant.fill}"`)
    expect(html).toContain('📌 11:30 預配')
  })

  it('預配藍與已預訂藍同一支（「藍＝有人要來」語意一致），只差線型', () => {
    expect(PREASSIGN_COLOR.fill).toBe(STATUS_COLOR.reserved.fill)
    expect(PREASSIGN_COLOR.stroke).toBe(STATUS_COLOR.reserved.stroke)
    // reserved 沒有虛線（桌已鎖）、預配才有（桌實體仍空）
    expect(STATUS_COLOR.reserved.strokeDash).toBeUndefined()
    expect(PREASSIGN_COLOR.strokeDash).toBeTruthy()
  })

  it('沒被預配的空桌維持醒目綠、無虛線（領檯找空桌的第一眼不受影響）', () => {
    const html = wrapSvg(<TableShape table={baseTable()} onClick={() => {}} />)
    expect(html).toContain(`fill="${STATUS_COLOR.vacant.fill}"`)
    expect(html).toContain('✓ 可入座')
    expect(html).not.toContain('stroke-dasharray')
  })

  it('團體保留優先於預配（實心紫的保留語意更強）', () => {
    const html = wrapSvg(
      <TableShape table={baseTable()} groupHoldLabel="11:30 團保" preassignLabel="📌 11:30 預配" onClick={() => {}} />
    )
    expect(html).toContain(`fill="${GROUP_HOLD_COLOR.fill}"`)
    expect(html).not.toContain(`fill="${PREASSIGN_COLOR.fill}"`)
  })

  it('非空桌（已是 reserved）不吃預配色：桌況本身才是真相', () => {
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'reserved' })} preassignLabel="📌 11:30 預配" onClick={() => {}} />
    )
    expect(html).toContain(`fill="${STATUS_COLOR.reserved.fill}"`)
    expect(html).not.toContain('stroke-dasharray')
  })

  it('預配桌被選中 → 紅色實線選取框（虛線讓位給模式邊框，不會讀成另一種狀態）', () => {
    const html = wrapSvg(<TableShape table={baseTable()} preassignLabel="📌 11:30 預配" isSelected onClick={() => {}} />)
    expect(html).toContain('stroke="#e60012"')
    expect(html).not.toContain('stroke-dasharray')
  })
})

describe('FloorMap：預配與已預訂在同一張圖上可分辨', () => {
  // 重現截圖情境：111 現場指派（桌況 reserved）、112 規劃頁預配（桌況仍 vacant），兩筆同為 11:30。
  const tables = [
    baseTable({ number: '111', x: 100, y: 100, status: 'reserved', currentBookingId: 'b-zhou' }),
    baseTable({ number: '112', x: 300, y: 100 }),
  ]
  const bookings = [{ id: 'b-zhou', name: '周晴茹', guests: 4, timeSlot: '11:30' }]
  const render = () => renderToStaticMarkup(
    <FloorMap
      floor="1F"
      tables={tables}
      bookings={bookings}
      fixtures={{ '1F': [], '2F': [] }}
      preassignTables={{ 112: { timeSlot: '11:30' } }}
      onSelectTable={() => {}}
    />
  )

  it('兩桌都是藍的（都有人要來），不再一藍一綠', () => {
    const html = render()
    expect(html).toContain(`fill="${STATUS_COLOR.reserved.fill}"`)
    expect(html).toContain(`fill="${PREASSIGN_COLOR.fill}"`)
    expect(html).not.toContain(`fill="${STATUS_COLOR.vacant.fill}"`)
  })

  it('仍分得出差別：111 顯示訂位人姓名（桌已鎖）、112 顯示「預配」＋虛線（桌還是空的）', () => {
    const html = render()
    expect(html).toContain('周晴茹')
    expect(html).toContain('📌 11:30 預配')
    expect(html).toContain('stroke-dasharray')
  })
})
