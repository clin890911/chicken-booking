// tests/services/tableService.test.js
// tableService 全面回歸測試：CRUD + 即時運營狀態 + 併桌 + 統計
// - localStorage 由 tests/setup.js 提供 Map-backed mock，且每測試前後自動清空
// - 時間相依函式以 vi.useFakeTimers + setSystemTime 固定，確保可重複
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as tableService from '../../src/services/tableService'
import { INITIAL_TABLES, TOTAL_CAPACITY } from '../../src/data/tables'

const STORAGE_KEY = 'chicken_tables_v3'
const FIXED_NOW = new Date('2026-06-15T12:00:00')

// 受控的假桌位資料：以 bulkWrite 寫入，斷言不依賴 INITIAL_TABLES 確切座標
// 含 schema 完整欄位，避免 read() 補欄位造成混淆
function mkTable(over = {}) {
  return {
    number: 'T1',
    capacity: 4,
    floor: '1F',
    x: 100, y: 100, w: 80, h: 75,
    isActive: true,
    status: 'vacant',
    currentBookingId: null,
    currentRef: null,
    seatedAt: null,
    mergedWith: null,
    blockReason: null,
    updatedAt: null,
    ...over,
  }
}

// 兩張同樓層、中心距離很近（dx,dy 皆 < 200）→ 可併桌
function closePair() {
  return [
    mkTable({ number: 'A', floor: '1F', x: 100, y: 100, w: 80, h: 75, capacity: 4 }),
    mkTable({ number: 'B', floor: '1F', x: 150, y: 150, w: 80, h: 75, capacity: 6 }),
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// read() 種子行為（透過 listAll 觀察）
// ============================================================
describe('read() / 初始種子', () => {
  it('localStorage 空時，listAll 會種入 INITIAL_TABLES（數量與容量相符）', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    const all = tableService.listAll()
    expect(all).toHaveLength(INITIAL_TABLES.length)
    expect(all).toHaveLength(52)
    const cap = all.reduce((s, t) => s + t.capacity, 0)
    expect(cap).toBe(TOTAL_CAPACITY)
    expect(cap).toBe(246)
  })

  it('種子後 localStorage 已寫入 STORAGE_KEY（之後不再重新種子）', () => {
    tableService.listAll()
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(stored).toHaveLength(52)
  })

  it('種子會清掉 legacy 舊版 key', () => {
    localStorage.setItem('chicken_tables_v2', JSON.stringify([{ number: 'OLD' }]))
    localStorage.setItem('chicken_tables_v1', JSON.stringify([{ number: 'OLD' }]))
    tableService.listAll()
    expect(localStorage.getItem('chicken_tables_v2')).toBeNull()
    expect(localStorage.getItem('chicken_tables_v1')).toBeNull()
  })

  it('回傳的是副本：修改回傳陣列不影響後續 read', () => {
    const a = tableService.listAll()
    a.push({ number: 'HACK' })
    a[0] = { number: 'MUT' }
    const b = tableService.listAll()
    expect(b).toHaveLength(52)
    expect(b.find(t => t.number === 'HACK')).toBeUndefined()
    expect(b.find(t => t.number === 'MUT')).toBeUndefined()
  })

  it('讀取已存在資料時，缺欄位會補上預設值', () => {
    // 只存最小欄位，read() 應補齊 isActive/status/... 等
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ number: 'X1', capacity: 4, floor: '1F' }]))
    const [t] = tableService.listAll()
    expect(t.number).toBe('X1')
    expect(t.isActive).toBe(true)
    expect(t.status).toBe('vacant')
    expect(t.currentBookingId).toBeNull()
    expect(t.currentRef).toBeNull()
    expect(t.seatedAt).toBeNull()
    expect(t.mergedWith).toBeNull()
    expect(t.blockReason).toBeNull()
    expect(t.updatedAt).toBeNull()
  })

  it('已存在資料的既有欄位不會被預設值覆蓋', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { number: 'X1', capacity: 4, floor: '1F', isActive: false, status: 'dining', currentBookingId: 'bk-9' },
    ]))
    const [t] = tableService.listAll()
    expect(t.isActive).toBe(false)
    expect(t.status).toBe('dining')
    expect(t.currentBookingId).toBe('bk-9')
  })

  it('localStorage 內容為非法 JSON 時，回退為 INITIAL_TABLES 副本', () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json')
    const all = tableService.listAll()
    expect(all).toHaveLength(52)
  })
})

// ============================================================
// 讀取：getByNumber / listByFloor
// ============================================================
describe('getByNumber', () => {
  it('回傳指定桌號（種子資料）', () => {
    const t = tableService.getByNumber('101')
    expect(t).not.toBeNull()
    expect(t.number).toBe('101')
    expect(t.floor).toBe('1F')
  })

  it('不存在的桌號回傳 null', () => {
    expect(tableService.getByNumber('104')).toBeNull() // PDF 跳號，無 104
    expect(tableService.getByNumber('ZZZ')).toBeNull()
  })
})

describe('listByFloor', () => {
  it('只回傳該樓層桌位（種子資料）', () => {
    const f1 = tableService.listByFloor('1F')
    const f2 = tableService.listByFloor('2F')
    expect(f1).toHaveLength(12)
    expect(f2).toHaveLength(40)
    expect(f1.every(t => t.floor === '1F')).toBe(true)
    expect(f2.every(t => t.floor === '2F')).toBe(true)
  })

  it('不存在的樓層回傳空陣列', () => {
    expect(tableService.listByFloor('3F')).toEqual([])
  })
})

// ============================================================
// 啟用/停用：toggle / setActive
// ============================================================
describe('toggle / setActive（含佔用守門）', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A', isActive: true })])
  })

  it('toggle 反轉 isActive 並回傳 { ok, table }', () => {
    const r1 = tableService.toggle('A')
    expect(r1.ok).toBe(true)
    expect(r1.table.isActive).toBe(false)
    expect(tableService.getByNumber('A').isActive).toBe(false)
    const r2 = tableService.toggle('A')
    expect(r2.table.isActive).toBe(true)
    expect(tableService.getByNumber('A').isActive).toBe(true)
  })

  it('toggle 會更新 updatedAt 為目前時間', () => {
    const r = tableService.toggle('A')
    expect(r.table.updatedAt).toBe(FIXED_NOW.toISOString())
  })

  it('toggle 不存在的桌號回傳 ok:false', () => {
    expect(tableService.toggle('NOPE').ok).toBe(false)
  })

  it('setActive 直接設定 isActive', () => {
    expect(tableService.setActive('A', false).table.isActive).toBe(false)
    expect(tableService.setActive('A', true).table.isActive).toBe(true)
  })

  it('setActive 不存在的桌號回傳 ok:false', () => {
    expect(tableService.setActive('NOPE', false).ok).toBe(false)
  })

  it('佔用守門：用餐中 / 已預訂 / 待清桌 / 連著訂位的桌不准停用（啟用不受限）', () => {
    for (const status of ['dining', 'reserved', 'cleaning']) {
      tableService.bulkWrite([mkTable({ number: 'A', isActive: true, status })])
      const r = tableService.toggle('A')
      expect(r.ok).toBe(false)
      expect(tableService.getByNumber('A').isActive).toBe(true)
    }
    tableService.bulkWrite([mkTable({ number: 'A', isActive: true, status: 'vacant', currentBookingId: 'B1' })])
    expect(tableService.setActive('A', false).ok).toBe(false)
    // 已停用的桌可以照常重新啟用（守門只擋「停用」方向）
    tableService.bulkWrite([mkTable({ number: 'A', isActive: false, status: 'dining' })])
    expect(tableService.setActive('A', true).ok).toBe(true)
  })

  it('blocked（臨時保留）桌沒有客人 → 可以停用', () => {
    tableService.bulkWrite([mkTable({ number: 'A', isActive: true, status: 'blocked' })])
    expect(tableService.toggle('A').ok).toBe(true)
  })
})

// ============================================================
// 維修停用（按日期）：setOutage / clearOutage
// ============================================================
describe('setOutage / clearOutage', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A', isActive: true })])
  })
  const TODAY = FIXED_NOW.toISOString().slice(0, 10)

  it('設定合法維修窗並正規化；read 後欄位存在', () => {
    const r = tableService.setOutage('A', { from: TODAY, to: '', reason: ' 桌面破損 ' })
    expect(r.ok).toBe(true)
    expect(tableService.getByNumber('A').outage).toEqual({ from: TODAY, to: '', reason: '桌面破損' })
  })

  it('格式不正確回 ok:false 不寫入', () => {
    expect(tableService.setOutage('A', { from: 'bad' }).ok).toBe(false)
    expect(tableService.getByNumber('A').outage).toBe(null)
  })

  it('佔用守門：窗含今天且桌上有客人 → 拒絕；未來窗不受限', () => {
    tableService.bulkWrite([mkTable({ number: 'A', isActive: true, status: 'dining' })])
    expect(tableService.setOutage('A', { from: TODAY, to: '', reason: 'x' }).ok).toBe(false)
    const future = tableService.setOutage('A', { from: '2099-01-01', to: '2099-01-02', reason: 'x' })
    expect(future.ok).toBe(true)
  })

  it('clearOutage 清除維修窗', () => {
    tableService.setOutage('A', { from: TODAY, to: '', reason: 'x' })
    expect(tableService.clearOutage('A').ok).toBe(true)
    expect(tableService.getByNumber('A').outage).toBe(null)
  })

  it('舊資料缺 outage 欄位：read 自動補 null', () => {
    localStorage.setItem('chicken_tables_v3', JSON.stringify([{ number: 'Z', capacity: 4 }]))
    expect(tableService.getByNumber('Z').outage).toBe(null)
  })
})

// ============================================================
// 即時狀態：setStatus
// ============================================================
describe('setStatus', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A' })])
  })

  it('設定 status 並回傳', () => {
    const r = tableService.setStatus('A', 'cleaning')
    expect(r.status).toBe('cleaning')
    expect(tableService.getByNumber('A').status).toBe('cleaning')
  })

  it('extra 物件會一併寫入', () => {
    const r = tableService.setStatus('A', 'reserved', { currentBookingId: 'bk-1', seatedAt: null })
    expect(r.status).toBe('reserved')
    expect(r.currentBookingId).toBe('bk-1')
  })

  it('更新 updatedAt', () => {
    const r = tableService.setStatus('A', 'vacant')
    expect(r.updatedAt).toBe(FIXED_NOW.toISOString())
  })

  it('不存在的桌號回傳 null', () => {
    expect(tableService.setStatus('NOPE', 'vacant')).toBeNull()
  })
})

// ============================================================
// 狀態轉移：seatTable / reserveTable / checkoutTable / clearTable
// ============================================================
describe('狀態轉移 seat/reserve/checkout/clear', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A' })])
  })

  it('seatTable：設 dining、綁 bookingId、清 currentRef、記 seatedAt', () => {
    const r = tableService.seatTable('A', 'bk-100')
    expect(r.status).toBe('dining')
    expect(r.currentBookingId).toBe('bk-100')
    expect(r.currentRef).toBeNull()
    expect(r.seatedAt).toBe(FIXED_NOW.toISOString())
    expect(r.updatedAt).toBe(FIXED_NOW.toISOString())
  })

  it('seatTable 不存在的桌號回傳 null', () => {
    expect(tableService.seatTable('NOPE', 'bk-1')).toBeNull()
  })

  it('reserveTable：設 reserved、綁 bookingId、清 seatedAt 與 currentRef', () => {
    const r = tableService.reserveTable('A', 'bk-200')
    expect(r.status).toBe('reserved')
    expect(r.currentBookingId).toBe('bk-200')
    expect(r.currentRef).toBeNull()
    expect(r.seatedAt).toBeNull()
  })

  it('reserveTable 不存在的桌號回傳 null', () => {
    expect(tableService.reserveTable('NOPE', 'bk-1')).toBeNull()
  })

  it('checkoutTable：dining → cleaning，清 seatedAt（保留 currentBookingId）', () => {
    tableService.seatTable('A', 'bk-300')
    const r = tableService.checkoutTable('A')
    expect(r.status).toBe('cleaning')
    expect(r.seatedAt).toBeNull()
    // checkoutTable 不清 currentBookingId
    expect(r.currentBookingId).toBe('bk-300')
  })

  it('clearTable：cleaning → vacant，解除所有綁定', () => {
    tableService.seatTable('A', 'bk-400')
    tableService.checkoutTable('A')
    const r = tableService.clearTable('A')
    expect(r.status).toBe('vacant')
    expect(r.currentBookingId).toBeNull()
    expect(r.currentRef).toBeNull()
    expect(r.seatedAt).toBeNull()
  })

  it('完整生命週期 reserve → seat → checkout → clear', () => {
    tableService.reserveTable('A', 'bk-1')
    expect(tableService.getByNumber('A').status).toBe('reserved')
    tableService.seatTable('A', 'bk-1')
    expect(tableService.getByNumber('A').status).toBe('dining')
    expect(tableService.getByNumber('A').seatedAt).toBe(FIXED_NOW.toISOString())
    tableService.checkoutTable('A')
    expect(tableService.getByNumber('A').status).toBe('cleaning')
    tableService.clearTable('A')
    const final = tableService.getByNumber('A')
    expect(final.status).toBe('vacant')
    expect(final.currentBookingId).toBeNull()
  })

  it('seatTableForGroup：dining、清 currentBookingId、寫 currentRef', () => {
    const r = tableService.seatTableForGroup('A', 'g-7', 'b-3')
    expect(r.status).toBe('dining')
    expect(r.currentBookingId).toBeNull()
    expect(r.currentRef).toEqual({ type: 'group', groupId: 'g-7', batchId: 'b-3' })
    expect(r.seatedAt).toBe(FIXED_NOW.toISOString())
  })
})

// ============================================================
// 封鎖：blockTable / unblockTable
// ============================================================
describe('blockTable / unblockTable', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A' })])
  })

  it('blockTable：status=blocked，記錄原因（預設）', () => {
    const r = tableService.blockTable('A')
    expect(r.status).toBe('blocked')
    expect(r.blockReason).toBe('臨時保留')
  })

  it('blockTable：可帶自訂原因', () => {
    const r = tableService.blockTable('A', '機台維修')
    expect(r.status).toBe('blocked')
    expect(r.blockReason).toBe('機台維修')
  })

  it('unblockTable：blocked → vacant，清空原因', () => {
    tableService.blockTable('A', '維修')
    const r = tableService.unblockTable('A')
    expect(r.status).toBe('vacant')
    expect(r.blockReason).toBeNull()
  })

  it('block/unblock 不存在的桌號回傳 null', () => {
    expect(tableService.blockTable('NOPE')).toBeNull()
    expect(tableService.unblockTable('NOPE')).toBeNull()
  })
})

// ============================================================
// 併桌：mergeTables / unmergeTable
// ============================================================
describe('mergeTables', () => {
  it('成功併桌：雙向 mergedWith + 回傳 totalCapacity', () => {
    tableService.bulkWrite(closePair()) // A(4P) + B(6P)，同 1F，距離近
    const r = tableService.mergeTables('A', 'B')
    expect(r.ok).toBe(true)
    expect(r.totalCapacity).toBe(10) // 4 + 6
    expect(tableService.getByNumber('A').mergedWith).toBe('B')
    expect(tableService.getByNumber('B').mergedWith).toBe('A')
  })

  it('桌位不存在 → ok:false', () => {
    tableService.bulkWrite(closePair())
    expect(tableService.mergeTables('A', 'NOPE')).toEqual({ ok: false, error: '桌位不存在' })
    expect(tableService.mergeTables('NOPE', 'A')).toEqual({ ok: false, error: '桌位不存在' })
  })

  it('不同樓層 → 擋下', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A', floor: '1F', x: 100, y: 100 }),
      mkTable({ number: 'B', floor: '2F', x: 100, y: 100 }),
    ])
    const r = tableService.mergeTables('A', 'B')
    expect(r).toEqual({ ok: false, error: '不同樓層無法併桌' })
    // 失敗時不應寫入 mergedWith
    expect(tableService.getByNumber('A').mergedWith).toBeNull()
    expect(tableService.getByNumber('B').mergedWith).toBeNull()
  })

  it('距離過遠（dx 與 dy 皆 > 200）→ 擋下', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A', floor: '1F', x: 0, y: 0, w: 80, h: 75 }),
      mkTable({ number: 'B', floor: '1F', x: 400, y: 400, w: 80, h: 75 }),
    ])
    const r = tableService.mergeTables('A', 'B')
    expect(r).toEqual({ ok: false, error: '兩桌距離過遠' })
    expect(tableService.getByNumber('A').mergedWith).toBeNull()
  })

  it('只有單軸距離 > 200（dx 大、dy 小）仍允許併桌（&& 條件）', () => {
    // 同樓層，dx 大但 dy=0 → dx>200 為真、dy>200 為假 → 不擋
    tableService.bulkWrite([
      mkTable({ number: 'A', floor: '1F', x: 0, y: 100, w: 80, h: 75 }),
      mkTable({ number: 'B', floor: '1F', x: 500, y: 100, w: 80, h: 75 }),
    ])
    const r = tableService.mergeTables('A', 'B')
    expect(r.ok).toBe(true)
    expect(r.totalCapacity).toBe(8)
  })

  it('已知限制：距離檢查為「兩軸皆過遠才擋」(dx>200 && dy>200)，故同列水平排開(dy=0)仍可併', () => {
    // 記錄現況：mergeTables 用 && 而非 ||，水平距離很大但 y 對齊的兩桌仍允許併桌。
    // 嚴格度偏鬆但屬低風險（併桌為店員手動、有視覺確認）。若日後收緊改成 ||，再把此斷言改為 false。
    tableService.bulkWrite([
      mkTable({ number: 'A', floor: '1F', x: 0, y: 100, w: 80, h: 75 }),
      mkTable({ number: 'B', floor: '1F', x: 500, y: 100, w: 80, h: 75 }),
    ])
    const r = tableService.mergeTables('A', 'B')
    expect(r.ok).toBe(true)
  })

  it('種子資料：1F 103 與 111 距離過遠 → 擋下', () => {
    // 103: (160,200) ; 111: (680,659.5) → dx=520, dy=459.5（皆 > 200）
    const r = tableService.mergeTables('103', '111')
    expect(r).toEqual({ ok: false, error: '兩桌距離過遠' })
  })
})

describe('unmergeTable', () => {
  it('解除併桌：雙向清空 mergedWith，回傳原桌（解除前狀態）', () => {
    tableService.bulkWrite(closePair())
    tableService.mergeTables('A', 'B')
    const r = tableService.unmergeTable('A')
    expect(r).not.toBeNull()
    expect(r.number).toBe('A')
    expect(tableService.getByNumber('A').mergedWith).toBeNull()
    expect(tableService.getByNumber('B').mergedWith).toBeNull()
  })

  it('未併桌的桌位回傳 null', () => {
    tableService.bulkWrite([mkTable({ number: 'A', mergedWith: null })])
    expect(tableService.unmergeTable('A')).toBeNull()
  })

  it('不存在的桌號回傳 null', () => {
    expect(tableService.unmergeTable('NOPE')).toBeNull()
  })
})

// ============================================================
// 統計：summary
// ============================================================
describe('summary', () => {
  it('只統計 isActive 桌位；dining 累計座位數', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A', status: 'vacant', capacity: 4, isActive: true }),
      mkTable({ number: 'B', status: 'reserved', capacity: 4, isActive: true }),
      mkTable({ number: 'C', status: 'dining', capacity: 6, isActive: true }),
      mkTable({ number: 'D', status: 'dining', capacity: 4, isActive: true }),
      mkTable({ number: 'E', status: 'cleaning', capacity: 4, isActive: true }),
      mkTable({ number: 'F', status: 'blocked', capacity: 4, isActive: true }),
      // 停用桌位：完全不計（即使 dining）
      mkTable({ number: 'G', status: 'dining', capacity: 8, isActive: false }),
    ])
    const s = tableService.summary()
    expect(s.counts).toEqual({ vacant: 1, reserved: 1, dining: 2, cleaning: 1, blocked: 1 })
    expect(s.occupiedSeats).toBe(10) // 6 + 4，不含停用的 8
    expect(s.total).toBe(6) // 只算 isActive
  })

  it('全部停用時 total=0、occupiedSeats=0', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A', status: 'dining', capacity: 4, isActive: false }),
      mkTable({ number: 'B', status: 'vacant', capacity: 4, isActive: false }),
    ])
    const s = tableService.summary()
    expect(s.total).toBe(0)
    expect(s.occupiedSeats).toBe(0)
    expect(s.counts).toEqual({ vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 })
  })

  it('種子資料：全部 vacant、全 active', () => {
    const s = tableService.summary()
    expect(s.total).toBe(52)
    expect(s.counts.vacant).toBe(52)
    expect(s.occupiedSeats).toBe(0)
  })
})

// ============================================================
// 位置：updatePosition
// ============================================================
describe('updatePosition', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable({ number: 'A', x: 1, y: 2, w: 3, h: 4 })])
  })

  it('更新 x/y/w/h', () => {
    const r = tableService.updatePosition('A', { x: 10, y: 20, w: 30, h: 40 })
    expect(r.x).toBe(10)
    expect(r.y).toBe(20)
    expect(r.w).toBe(30)
    expect(r.h).toBe(40)
    expect(r.updatedAt).toBe(FIXED_NOW.toISOString())
  })

  it('不存在的桌號回傳 null', () => {
    expect(tableService.updatePosition('NOPE', { x: 1, y: 1, w: 1, h: 1 })).toBeNull()
  })
})

// ============================================================
// 批次寫入：bulkWrite
// ============================================================
describe('bulkWrite', () => {
  it('整批覆蓋 localStorage 內容', () => {
    tableService.bulkWrite([
      mkTable({ number: 'ONLY', capacity: 4, floor: '1F' }),
    ])
    const all = tableService.listAll()
    expect(all).toHaveLength(1)
    expect(all[0].number).toBe('ONLY')
  })

  it('空陣列會清空所有桌位', () => {
    tableService.bulkWrite([])
    expect(tableService.listAll()).toEqual([])
    expect(tableService.summary().total).toBe(0)
  })
})

// ============================================================
// 新增桌位：addTable（自動桌號）
// ============================================================
describe('addTable', () => {
  it('空店時第一張 4P → A1（prefix 依 capacity）', () => {
    tableService.bulkWrite([])
    const t = tableService.addTable({ capacity: 4, floor: '1F' })
    expect(t.number).toBe('A1')
    expect(t.capacity).toBe(4)
    expect(t.floor).toBe('1F')
    expect(t.w).toBe(80)
    expect(t.h).toBe(75) // 4P 高度
    expect(t.status).toBe('vacant')
    expect(t.isActive).toBe(true)
    expect(t.updatedAt).toBe(FIXED_NOW.toISOString())
  })

  it('空店時第一張 6P → B1（橫式 90×75，較寬不較長）', () => {
    tableService.bulkWrite([])
    const t = tableService.addTable({ capacity: 6 })
    expect(t.number).toBe('B1')
    expect(t.w).toBe(90) // 六人桌較寬
    expect(t.h).toBe(75) // 高度與四人桌同
    expect(t.floor).toBe('1F') // 預設
  })

  it('自動找下一個可用編號（跳過已用）', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A1', capacity: 4 }),
      mkTable({ number: 'A3', capacity: 4 }),
    ])
    const t = tableService.addTable({ capacity: 4 })
    expect(t.number).toBe('A2') // 填補空缺
    const t2 = tableService.addTable({ capacity: 4 })
    expect(t2.number).toBe('A4') // 接續最大
  })

  it('A/B 系列獨立編號', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A1', capacity: 4 }),
      mkTable({ number: 'A2', capacity: 4 }),
    ])
    const b = tableService.addTable({ capacity: 6 })
    expect(b.number).toBe('B1') // B 系列從 1 起
  })

  it('種子數字桌號（101…）不影響 A/B 系列計號', () => {
    // 種子桌號皆為數字字串，startsWith('A')/('B') 皆 false，故新增從 A1 起
    tableService.listAll() // 觸發種子
    const t = tableService.addTable({ capacity: 4 })
    expect(t.number).toBe('A1')
    expect(tableService.listAll()).toHaveLength(53)
  })

  it('帶入自訂座標', () => {
    tableService.bulkWrite([])
    const t = tableService.addTable({ capacity: 4, floor: '2F', x: 333, y: 444 })
    expect(t.x).toBe(333)
    expect(t.y).toBe(444)
    expect(t.floor).toBe('2F')
  })

  it('新增後可被 getByNumber 讀回', () => {
    tableService.bulkWrite([])
    tableService.addTable({ capacity: 4 })
    expect(tableService.getByNumber('A1')).not.toBeNull()
  })
})

// ============================================================
// 刪除桌位：removeTable（有 currentBookingId 擋刪）
// ============================================================
describe('removeTable', () => {
  it('刪除成功回 ok:true，並從清單移除', () => {
    tableService.bulkWrite([
      mkTable({ number: 'A' }),
      mkTable({ number: 'B' }),
    ])
    const r = tableService.removeTable('A')
    expect(r).toEqual({ ok: true })
    expect(tableService.getByNumber('A')).toBeNull()
    expect(tableService.listAll()).toHaveLength(1)
  })

  it('桌位不存在 → ok:false', () => {
    tableService.bulkWrite([mkTable({ number: 'A' })])
    expect(tableService.removeTable('NOPE')).toEqual({ ok: false, error: '桌位不存在' })
  })

  it('有 currentBookingId（用餐/訂位中）→ 擋刪', () => {
    tableService.bulkWrite([mkTable({ number: 'A', currentBookingId: 'bk-1', status: 'dining' })])
    const r = tableService.removeTable('A')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('此桌目前有訂位/用餐，無法刪除')
    // 仍存在
    expect(tableService.getByNumber('A')).not.toBeNull()
  })

  it('currentBookingId 為 null 時可刪（即使狀態非 vacant）', () => {
    tableService.bulkWrite([mkTable({ number: 'A', currentBookingId: null, status: 'cleaning' })])
    expect(tableService.removeTable('A')).toEqual({ ok: true })
  })
})

// ============================================================
// reset
// ============================================================
describe('reset', () => {
  it('將桌位還原為 INITIAL_TABLES', () => {
    tableService.bulkWrite([mkTable({ number: 'ONLY' })])
    expect(tableService.listAll()).toHaveLength(1)
    tableService.reset()
    const all = tableService.listAll()
    expect(all).toHaveLength(52)
    expect(all.reduce((s, t) => s + t.capacity, 0)).toBe(246)
  })
})

// ============================================================
// 資料隔離：每個測試從乾淨狀態開始（setup.js 保證）
// ============================================================
describe('資料隔離', () => {
  it('前一測試寫入的桌位不會殘留（A）', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    tableService.bulkWrite([mkTable({ number: 'LEAK' })])
    expect(tableService.getByNumber('LEAK')).not.toBeNull()
  })

  it('前一測試寫入的桌位不會殘留（B）', () => {
    // 若隔離失效，這裡會讀到上一個 it 的 LEAK
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(tableService.getByNumber('LEAK')).toBeNull()
  })
})
