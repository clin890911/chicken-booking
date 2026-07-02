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
