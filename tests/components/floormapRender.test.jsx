import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TableShape from '../../src/components/admin/floormap/TableShape'
import FloorMap from '../../src/components/admin/floormap/FloorMap'

// 桌位佈局升級的渲染煙霧測試：旋轉 / 分區角點 / 自由尺寸 / 資料驅動設施
// 不依賴 DOM 事件，只確認「會不會炸 + 關鍵輸出有出現」。

const baseTable = (over = {}) => ({
  number: '101', capacity: 6, floor: '1F', x: 100, y: 100, w: 90, h: 75,
  rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null,
  blockReason: null, updatedAt: null, ...over,
})

const wrapSvg = (node) => renderToStaticMarkup(<svg>{node}</svg>)

describe('TableShape 渲染', () => {
  it('旋轉桌：外層 g 帶 rotate transform、文字反旋保持水平', () => {
    const html = wrapSvg(<TableShape table={baseTable({ rotation: 45 })} onClick={() => {}} />)
    // 桌框繞中心 (145,137.5) 轉 45 度
    expect(html).toContain('rotate(45 145 137.5)')
    // 文字群組反旋 -45 抵銷
    expect(html).toContain('rotate(-45 145 137.5)')
  })

  it('未旋轉桌：不輸出 transform（rot=0 → undefined）', () => {
    const html = wrapSvg(<TableShape table={baseTable({ rotation: 0 })} onClick={() => {}} />)
    expect(html).not.toContain('rotate(')
  })

  it('分區色：畫左上角小圓點（不取代 status 填色）', () => {
    const html = wrapSvg(<TableShape table={baseTable()} zoneColor="#ff0000" onClick={() => {}} />)
    expect(html).toContain('<circle')
    expect(html).toContain('#ff0000')
    // status=vacant 現為醒目綠底（2026-07 配色反轉：可坐醒目、佔用降噪），分區色仍只在角點不取代填色
    expect(html).toContain('fill="#86efac"')
  })

  it('自由尺寸（高瘦桌）不丟例外，仍渲染桌號', () => {
    const html = wrapSvg(<TableShape table={baseTable({ w: 50, h: 200 })} onClick={() => {}} />)
    expect(html).toContain('101')
  })

  it('規劃 / 統一佔用 / 停用 三種分支皆能渲染旋轉桌', () => {
    expect(() => wrapSvg(<TableShape table={baseTable({ rotation: 90 })} planState="selected" onClick={() => {}} />)).not.toThrow()
    expect(() => wrapSvg(<TableShape table={baseTable({ rotation: 90 })} occState="walkin" occLabel="王" onClick={() => {}} />)).not.toThrow()
    expect(() => wrapSvg(<TableShape table={baseTable({ rotation: 90, isActive: false })} onClick={() => {}} />)).not.toThrow()
  })
})

describe('FloorMap 渲染', () => {
  const tables = [
    baseTable({ number: '101', rotation: 30, zoneId: 'z1' }),
    baseTable({ number: '102', x: 300, y: 100 }),
  ]
  const zones = [{ id: 'z1', name: '靠窗', color: '#22c55e' }]
  const fixtures = { '1F': [{ id: 'fx1', type: 'label', x: 50, y: 50, w: 0, h: 0, text: '測試設施', vtext: false }], '2F': [] }

  it('傳入自訂 fixtures/zones：設施文字出現、分區角點出現、不丟例外', () => {
    const html = renderToStaticMarkup(
      <FloorMap floor="1F" tables={tables} fixtures={fixtures} zones={zones} onSelectTable={() => {}} />
    )
    expect(html).toContain('測試設施')   // 資料驅動設施
    expect(html).toContain('#22c55e')     // z1 分區色角點
    expect(html).toContain('rotate(')      // 101 旋轉
    expect(html).toContain('101')
    expect(html).toContain('102')
  })

  it('未傳 fixtures 時 fallback 預設 FIXTURES（醬料台等）', () => {
    const html = renderToStaticMarkup(<FloorMap floor="1F" tables={tables} onSelectTable={() => {}} />)
    expect(html).toContain('醬料台')
  })
})

// 2026-08 桌況圖辨識度：已預訂／用餐中/團保三色收斂進 statusColors.js，
// 確認 TableShape 實際輸出的是新色值，且彼此可辨（不是換湯不換藥）。
describe('TableShape 新配色（已預訂／用餐中／團保）', () => {
  it('reserved：填色為新的淡藍 #d8eaff、邊框 3px 深藍，且與 dining 的暖灰褐不同色', () => {
    const html = wrapSvg(<TableShape table={baseTable({ status: 'reserved' })} onClick={() => {}} />)
    expect(html).toContain('fill="#d8eaff"')
    expect(html).toContain('stroke="#1d4ed8"')
    expect(html).toContain('stroke-width="3"')
  })

  it('dining（用餐正常階段）：填色為新的暖灰褐 #ded7cc，與 reserved 的淡藍不同色', () => {
    const html = wrapSvg(<TableShape table={baseTable({ status: 'dining', seatedAt: new Date().toISOString() })} onClick={() => {}} />)
    expect(html).toContain('fill="#ded7cc"')
    expect(html).not.toContain('#d8eaff')
  })

  it('團體保留（vacant + groupHoldLabel）：填色為新的淡紫 #e9e4fb，不是舊的靛藍 #e0e7ff', () => {
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'vacant' })} groupHoldLabel="18:00 團保" onClick={() => {}} />
    )
    expect(html).toContain('fill="#e9e4fb"')
    expect(html).not.toContain('#e0e7ff')
  })

  it('vacant 底色維持不動（店主已拍板、有既有測試鎖定，這裡重申不受本次改動影響）', () => {
    const html = wrapSvg(<TableShape table={baseTable({ status: 'vacant' })} onClick={() => {}} />)
    expect(html).toContain('fill="#86efac"')
  })

  it('不加任何紋理／斜線：SVG 輸出不含 pattern／hatch 相關標記', () => {
    const html = wrapSvg(<TableShape table={baseTable({ status: 'dining', seatedAt: new Date().toISOString() })} onClick={() => {}} />)
    expect(html).not.toContain('<pattern')
    expect(html).not.toContain('hatch')
  })
})

// reserved 桌新版面：時段＋姓名兩行、容量移到右上角、姓名截斷保護。
describe('TableShape reserved 版面（時段＋姓名）', () => {
  const bookingOf = (over = {}) => ({ id: 'b1', name: '王小明', timeSlot: '18:30', ...over })

  it('顯示訂位時段（不再帶 📋 emoji）與姓名', () => {
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'reserved' })} booking={bookingOf()} onClick={() => {}} />
    )
    expect(html).toContain('18:30')
    expect(html).not.toContain('📋')
    expect(html).toContain('王小明')
  })

  it('容量移到右上角小字（textAnchor=end），不再顯示於桌面中段', () => {
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'reserved', capacity: 6 })} booking={bookingOf()} onClick={() => {}} />
    )
    expect(html).toContain('6人')
    expect(html).toContain('text-anchor="end"')
  })

  it('姓名超過可容納字數會被截斷加「…」，不會整段溢出', () => {
    const longName = '王小明先生一家七口全部到齊'
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'reserved', w: 80 })} booking={bookingOf({ name: longName })} onClick={() => {}} />
    )
    expect(html).not.toContain(longName)
    expect(html).toContain('…')
  })

  it('短姓名不截斷，原樣顯示', () => {
    const html = wrapSvg(
      <TableShape table={baseTable({ status: 'reserved' })} booking={bookingOf({ name: '陳' })} onClick={() => {}} />
    )
    expect(html).toContain('>陳<')
    expect(html).not.toContain('…')
  })

  it('其他狀態（vacant）版面不受影響：容量仍是桌面置中「N 人」格式', () => {
    const html = wrapSvg(<TableShape table={baseTable({ status: 'vacant', capacity: 6 })} onClick={() => {}} />)
    expect(html).toContain('6 人')
  })
})
