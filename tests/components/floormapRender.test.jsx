import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TableShape from '../../src/components/admin/floormap/TableShape'
import FloorMap, { computeFloorContentBBox, computeFloorViewBox } from '../../src/components/admin/floormap/FloorMap'
import { FLOOR_VIEWBOX, INITIAL_TABLES, FIXTURES } from '../../src/data/tables'

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

// 桌況圖自動裁切（2026-08）：viewBox 不再寫死 1200x800，改依當前樓層桌位＋設施的
// 實際 bounding box 動態裁切（各樓層各自算，四周留白 60）。純函式 + 元件渲染兩層驗證。
describe('computeFloorContentBBox / computeFloorViewBox（自動裁切純函式）', () => {
  it('無桌無設施：bbox 回 null，viewBox 退回原本的 FLOOR_VIEWBOX（不產生 NaN／0 寬高）', () => {
    expect(computeFloorContentBBox([], [])).toBeNull()
    const vb = computeFloorViewBox([], [])
    expect(vb).toEqual({ x: 0, y: 0, width: FLOOR_VIEWBOX.width, height: FLOOR_VIEWBOX.height })
    expect(Number.isFinite(vb.x)).toBe(true)
    expect(Number.isFinite(vb.y)).toBe(true)
    expect(Number.isFinite(vb.width)).toBe(true)
    expect(Number.isFinite(vb.height)).toBe(true)
    expect(vb.width).toBeGreaterThan(0)
    expect(vb.height).toBeGreaterThan(0)
  })

  it('只有一張桌：能算出合理的 viewBox（桌尺寸 + 60 留白四周）', () => {
    const t = { x: 100, y: 200, w: 90, h: 75, rotation: 0 }
    const bbox = computeFloorContentBBox([t], [])
    expect(bbox).toEqual({ minX: 100, minY: 200, maxX: 190, maxY: 275 })
    const vb = computeFloorViewBox([t], [])
    expect(vb).toEqual({ x: 40, y: 140, width: 210, height: 195 })
  })

  it('旋轉桌：bbox 用旋轉後四角的 AABB，比未旋轉時更大（不會把斜擺的桌算漏）', () => {
    const flat = { x: 100, y: 100, w: 90, h: 75, rotation: 0 }
    const rotated = { x: 100, y: 100, w: 90, h: 75, rotation: 45 }
    const bboxFlat = computeFloorContentBBox([flat], [])
    const bboxRot = computeFloorContentBBox([rotated], [])
    const flatArea = (bboxFlat.maxX - bboxFlat.minX) * (bboxFlat.maxY - bboxFlat.minY)
    const rotArea = (bboxRot.maxX - bboxRot.minX) * (bboxRot.maxY - bboxRot.minY)
    expect(rotArea).toBeGreaterThan(flatArea)
  })

  it('設施（含 0 寬高的 label 錨點）也納入 bbox 計算', () => {
    const label = { x: 500, y: 500, w: 0, h: 0 }
    const bbox = computeFloorContentBBox([], [label])
    expect(bbox).toEqual({ minX: 500, minY: 500, maxX: 500, maxY: 500 })
  })

  it('多桌：bbox 取所有桌位＋設施的聯集邊界', () => {
    const tables = [
      { x: 120, y: 150, w: 90, h: 75, rotation: 0 },
      { x: 640, y: 622, w: 80, h: 75, rotation: 0 },
    ]
    const fixtures = [{ x: 735, y: 300, w: 24, h: 230 }]
    const bbox = computeFloorContentBBox(tables, fixtures)
    expect(bbox).toEqual({ minX: 120, minY: 150, maxX: 759, maxY: 697 })
  })
})

// 2026-08 二版：viewBox 不得比原始 FLOOR_VIEWBOX（0,0,1200,800）更差。用真實 1F/2F 資料
// （data/tables.js 的 INITIAL_TABLES/FIXTURES）鎖住兩種情境，再用合成資料鎖住「內容真的
// 超出原畫布」時夾限不能反過來裁掉內容（見 FloorMap.jsx 內 BASE_CANVAS 註解的完整理由）。
describe('computeFloorViewBox：夾限下界（不得比原始 FLOOR_VIEWBOX 更差，但不裁掉真實內容）', () => {
  const floorTablesOf = (floor) => INITIAL_TABLES.filter(t => t.floor === floor)

  it('1F 型（內容遠小於畫布）：夾限不生效，裁切正常放大，viewBox 明顯小於 1200×800', () => {
    const vb = computeFloorViewBox(floorTablesOf('1F'), FIXTURES['1F'])
    expect(vb).toEqual({ x: 60, y: 90, width: 795, height: 705 })
    expect(vb.width).toBeLessThan(FLOOR_VIEWBOX.width)
    expect(vb.height).toBeLessThan(FLOOR_VIEWBOX.height)
    // 完全落在原始畫布內
    expect(vb.x).toBeGreaterThanOrEqual(0)
    expect(vb.y).toBeGreaterThanOrEqual(0)
    expect(vb.x + vb.width).toBeLessThanOrEqual(FLOOR_VIEWBOX.width)
    expect(vb.y + vb.height).toBeLessThanOrEqual(FLOOR_VIEWBOX.height)
  })

  it('2F 型（內容＋留白超出畫布）：被夾回原始畫布邊界內，不得比今天線上的畫面更差', () => {
    const vb = computeFloorViewBox(floorTablesOf('2F'), FIXTURES['2F'])
    // 右緣/下緣被夾到畫布邊界（1200/800）；左緣本來就在畫布內（28≥0）不需要夾，
    // 所以不是整組歸零回 0,0,1200,800，而是逐邊各自收攏——比今天（1200×800）稍微更緊，
    // 這仍然符合「不比原始更差」（更差＝比今天更小），只是沒有到剛好等於今天。
    expect(vb).toEqual({ x: 28, y: 0, width: 1172, height: 800 })
    // 硬底線：整個結果必須落在原始畫布邊界內（這才是「不比今天差」的可驗證定義）
    expect(vb.x).toBeGreaterThanOrEqual(0)
    expect(vb.y).toBeGreaterThanOrEqual(0)
    expect(vb.x + vb.width).toBeLessThanOrEqual(FLOOR_VIEWBOX.width)
    expect(vb.y + vb.height).toBeLessThanOrEqual(FLOOR_VIEWBOX.height)
  })

  it('極端情況：桌位旋轉後 AABB 超出原畫布右緣（editor 的拖曳移動會夾住 x/y，但旋轉不會重新夾——見 LayoutEditor.jsx:285-286,343），夾限不得把桌子切掉', () => {
    // 貼著畫布右邊緣的桌（x/y 仍在 0~1200/0~800 內，是拖曳移動夾限後合法的落點），
    // 轉 45 度後 AABB 右緣會超出 1200。
    const edgeTable = { x: 1150, y: 400, w: 80, h: 75, rotation: 45 }
    const bbox = computeFloorContentBBox([edgeTable], [])
    expect(bbox.maxX).toBeGreaterThan(FLOOR_VIEWBOX.width) // 前提成立：內容真的超出畫布
    const vb = computeFloorViewBox([edgeTable], [])
    // 硬底線：viewBox 必須完整包住這張桌（不能為了夾回畫布而裁掉它）
    expect(vb.x).toBeLessThanOrEqual(bbox.minX)
    expect(vb.y).toBeLessThanOrEqual(bbox.minY)
    expect(vb.x + vb.width).toBeGreaterThanOrEqual(bbox.maxX)
    expect(vb.y + vb.height).toBeGreaterThanOrEqual(bbox.maxY)
  })

  it('極端情況：桌位座標整個落在原畫布外（如資料匯入/舊資料座標未經編輯器夾限），夾限不得讓桌子從畫面上消失', () => {
    const farTable = { x: 1500, y: 300, w: 80, h: 75, rotation: 0 }
    const vb = computeFloorViewBox([farTable], [])
    // 桌子完整落在算出的 viewBox 內：右緣可見（不是被裁到 1200 外看不到）
    expect(vb.x).toBeLessThanOrEqual(1500)
    expect(vb.x + vb.width).toBeGreaterThanOrEqual(1500 + 80)
    expect(vb.y).toBeLessThanOrEqual(300)
    expect(vb.y + vb.height).toBeGreaterThanOrEqual(300 + 75)
  })
})

describe('FloorMap 元件：自動裁切邊界情況（無桌無設施 fallback）', () => {
  it('該樓層完全沒有桌也沒有設施 → viewBox 退回 FLOOR_VIEWBOX，不丟例外、不產生 NaN', () => {
    const html = renderToStaticMarkup(
      <FloorMap floor="1F" tables={[]} fixtures={{ '1F': [], '2F': [] }} onSelectTable={() => {}} />
    )
    expect(html).toContain(`viewBox="0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}"`)
    expect(html).not.toContain('NaN')
  })

  it('其中一樓層有桌、另一樓層沒有：查詢空樓層仍 fallback（不會誤用另一樓層的 bbox）', () => {
    const tables = [{ number: '201', capacity: 6, floor: '2F', x: 360, y: 162, w: 90, h: 75, rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null }]
    const html = renderToStaticMarkup(
      <FloorMap floor="1F" tables={tables} fixtures={{ '1F': [], '2F': [] }} onSelectTable={() => {}} />
    )
    expect(html).toContain(`viewBox="0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}"`)
  })

  it('有內容時 viewBox 不是寫死的 0 0 1200 800（真的有依內容裁切）', () => {
    const tables = [{ number: '101', capacity: 4, floor: '1F', x: 120, y: 150, w: 80, h: 75, rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null }]
    const html = renderToStaticMarkup(
      <FloorMap floor="1F" tables={tables} fixtures={{ '1F': [], '2F': [] }} onSelectTable={() => {}} />
    )
    expect(html).not.toContain(`viewBox="0 0 ${FLOOR_VIEWBOX.width} ${FLOOR_VIEWBOX.height}"`)
    // 單桌 80x75 + 60 留白：x=60 y=90 width=200 height=195
    expect(html).toContain('viewBox="60 90 200 195"')
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
