// seatingService 整合測試
// 管理端營運整合層：桌位 × 訂位 × 候位 × 團體 的協作流程與防呆。
// 後端為 localStorage（tests/setup.js 每個測試前後自動清空）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'
import * as waitlistService from '../../src/services/waitlistService'
import * as groupService from '../../src/services/groupReservationService'

// === 測試用桌位工廠 ===
// 直接組出已知 schema 的桌位，透過 tableService.bulkWrite 寫入，狀態完全可控。
function mkTable(number, capacity, floor = '1F', overrides = {}) {
  return {
    number,
    capacity,
    floor,
    x: 100,
    y: 100,
    w: 80,
    h: capacity === 6 ? 100 : 75,
    fuel: null,
    isActive: true,
    status: 'vacant',
    currentBookingId: null,
    currentRef: null,
    seatedAt: null,
    mergedWith: null,
    blockReason: null,
    updatedAt: null,
    ...overrides,
  }
}

// 預設一組已知桌位：兩張 1F、兩張 2F，不同容量
function seedDefaultTables() {
  tableService.bulkWrite([
    mkTable('101', 4, '1F'),
    mkTable('108', 6, '1F'),
    mkTable('201', 4, '2F'),
    mkTable('208', 6, '2F'),
  ])
}

// 建一筆已確認線上訂位（assignedTableId: null）
function mkBooking(overrides = {}) {
  return bookingService.create({
    name: '王小明',
    phone: '0912345678',
    guests: 2,
    date: '2026-06-15',
    timeSlot: '18:00',
    source: 'online',
    status: 'confirmed',
    ...overrides,
  })
}

describe('seatingService 整合層', () => {
  // ===========================================================
  // assignBookingToTable
  // ===========================================================
  describe('assignBookingToTable', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位不存在 → 擋', () => {
      const r = seating.assignBookingToTable('NOPE', '101')
      expect(r).toEqual({ ok: false, error: '訂位不存在' })
    })

    it('桌位不存在 → 擋', () => {
      const b = mkBooking()
      const r = seating.assignBookingToTable(b.id, '999')
      expect(r).toEqual({ ok: false, error: '桌位不存在' })
    })

    it('非空桌 → 擋（含目前狀態中文）', () => {
      const b = mkBooking()
      tableService.setStatus('101', 'reserved')
      const r = seating.assignBookingToTable(b.id, '101')
      expect(r.ok).toBe(false)
      expect(r.error).toContain('101')
      expect(r.error).toContain('已預訂')
    })

    it('容量不足 → 擋', () => {
      const b = mkBooking({ guests: 5 })
      const r = seating.assignBookingToTable(b.id, '101') // 101 容量 4 < 5
      expect(r.ok).toBe(false)
      expect(r.error).toContain('容量不足')
    })

    it('容量剛好相等 → 可指派（邊界）', () => {
      const b = mkBooking({ guests: 4 })
      const r = seating.assignBookingToTable(b.id, '101')
      expect(r.ok).toBe(true)
    })

    it('成功：桌 reserved + booking.assignedTableId 被設定', () => {
      const b = mkBooking({ guests: 2 })
      const r = seating.assignBookingToTable(b.id, '101')
      expect(r.ok).toBe(true)
      const table = tableService.getByNumber('101')
      expect(table.status).toBe('reserved')
      expect(table.currentBookingId).toBe(b.id)
      const updated = bookingService.getById(b.id)
      expect(updated.assignedTableId).toBe('101')
    })

    it('成功時回傳 booking 與 table 物件', () => {
      const b = mkBooking({ guests: 2 })
      const r = seating.assignBookingToTable(b.id, '101')
      expect(r.booking).toBeTruthy()
      expect(r.table).toBeTruthy()
      // 回傳的是指派前的快照（vacant），實際 store 已 reserved
      expect(r.booking.id).toBe(b.id)
      expect(r.table.number).toBe('101')
    })
  })

  // ===========================================================
  // seatBooking
  // ===========================================================
  describe('seatBooking', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位不存在 → 擋', () => {
      const r = seating.seatBooking('NOPE')
      expect(r).toEqual({ ok: false, error: '訂位不存在' })
    })

    it('尚未指派桌位 → 擋', () => {
      const b = mkBooking()
      const r = seating.seatBooking(b.id)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('尚未指派')
    })

    it('成功：booking → arrived、桌 → dining、回傳桌號', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      const r = seating.seatBooking(b.id)
      expect(r).toEqual({ ok: true, tableNumber: '101' })
      expect(bookingService.getById(b.id).status).toBe('arrived')
      const table = tableService.getByNumber('101')
      expect(table.status).toBe('dining')
      expect(table.currentBookingId).toBe(b.id)
    })

    it('成功入座會記錄 actualArrivalTime', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      seating.seatBooking(b.id)
      expect(bookingService.getById(b.id).actualArrivalTime).toBeTruthy()
    })
  })

  // ===========================================================
  // checkoutBooking
  // ===========================================================
  describe('checkoutBooking', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位不存在 → 擋', () => {
      const r = seating.checkoutBooking('NOPE')
      expect(r).toEqual({ ok: false, error: '訂位不存在' })
    })

    it('成功：booking → completed、桌 → cleaning', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      seating.seatBooking(b.id)
      const r = seating.checkoutBooking(b.id)
      expect(r).toEqual({ ok: true })
      expect(bookingService.getById(b.id).status).toBe('completed')
      expect(tableService.getByNumber('101').status).toBe('cleaning')
    })

    it('無指派桌時仍將 booking 設 completed（不碰桌）', () => {
      const b = mkBooking({ guests: 2 })
      const r = seating.checkoutBooking(b.id)
      expect(r.ok).toBe(true)
      expect(bookingService.getById(b.id).status).toBe('completed')
    })
  })

  // ===========================================================
  // finalizeBooking
  // ===========================================================
  describe('finalizeBooking', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位不存在 → 擋', () => {
      const r = seating.finalizeBooking('NOPE')
      expect(r).toEqual({ ok: false, error: '訂位不存在' })
    })

    it('成功：booking → completed、桌 → vacant（跳過 cleaning）', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      seating.seatBooking(b.id)
      const r = seating.finalizeBooking(b.id)
      expect(r.ok).toBe(true)
      expect(r.tableNumber).toBe('101')
      expect(bookingService.getById(b.id).status).toBe('completed')
      const table = tableService.getByNumber('101')
      expect(table.status).toBe('vacant')
      expect(table.currentBookingId).toBeNull()
    })

    it('無指派桌時 tableNumber 為 null', () => {
      const b = mkBooking({ guests: 2 })
      const r = seating.finalizeBooking(b.id)
      expect(r.ok).toBe(true)
      expect(r.tableNumber).toBeNull()
      expect(bookingService.getById(b.id).status).toBe('completed')
    })
  })

  // ===========================================================
  // clearTable（純委派）
  // ===========================================================
  describe('clearTable', () => {
    beforeEach(() => { seedDefaultTables() })

    it('把 cleaning 桌釋出為 vacant 並解除綁定', () => {
      tableService.seatTable('101', 'Bxxx')
      tableService.checkoutTable('101') // dining → cleaning
      const r = seating.clearTable('101')
      expect(r.status).toBe('vacant')
      expect(r.currentBookingId).toBeNull()
      expect(tableService.getByNumber('101').status).toBe('vacant')
    })

    it('桌不存在 → 回傳 null（委派 tableService）', () => {
      expect(seating.clearTable('999')).toBeNull()
    })
  })

  // ===========================================================
  // cancelBooking
  // ===========================================================
  describe('cancelBooking', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位不存在 → 擋', () => {
      const r = seating.cancelBooking('NOPE')
      expect(r).toEqual({ ok: false, error: '訂位不存在' })
    })

    it('成功：桌釋出 vacant + booking cancelled + 解除指派', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      const r = seating.cancelBooking(b.id)
      expect(r).toEqual({ ok: true })
      const updated = bookingService.getById(b.id)
      expect(updated.status).toBe('cancelled')
      expect(updated.assignedTableId).toBeNull()
      const table = tableService.getByNumber('101')
      expect(table.status).toBe('vacant')
      expect(table.currentBookingId).toBeNull()
    })

    it('無指派桌時仍可取消（不碰桌）', () => {
      const b = mkBooking({ guests: 2 })
      const r = seating.cancelBooking(b.id)
      expect(r.ok).toBe(true)
      expect(bookingService.getById(b.id).status).toBe('cancelled')
    })
  })

  // ===========================================================
  // 時間相依函式：固定到 2026-06-15 12:00
  // ===========================================================
  describe('時間相依：walkInSeat / seatWaitlist', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00'))
      seedDefaultTables()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    // ---------- walkInSeat ----------
    describe('walkInSeat', () => {
      it('桌不存在 → 擋', () => {
        const r = seating.walkInSeat('999', { guests: 2 })
        expect(r).toEqual({ ok: false, error: '桌位不存在' })
      })

      it('非空桌 → 擋', () => {
        tableService.setStatus('101', 'dining')
        const r = seating.walkInSeat('101', { guests: 2 })
        expect(r.ok).toBe(false)
        expect(r.error).toContain('101')
      })

      it('成功：建立 walk-in arrived booking 並讓桌 dining', () => {
        const r = seating.walkInSeat('101', { name: '散客A', phone: '0900000001', guests: 3 })
        expect(r.ok).toBe(true)
        expect(r.booking).toBeTruthy()
        expect(r.booking.source).toBe('walkin')
        expect(r.booking.status).toBe('arrived')
        expect(r.booking.guests).toBe(3)
        expect(r.booking.assignedTableId).toBe('101')
        expect(r.booking.createdBy).toBe('staff')
        // booking 確實落地
        const stored = bookingService.getById(r.booking.id)
        expect(stored).toBeTruthy()
        expect(stored.status).toBe('arrived')
        // 桌位 dining + 綁定該 booking
        const table = tableService.getByNumber('101')
        expect(table.status).toBe('dining')
        expect(table.currentBookingId).toBe(r.booking.id)
      })

      it('timeSlot 依固定系統時間（12:00）落在半小時格', () => {
        const r = seating.walkInSeat('101', { guests: 2 })
        expect(r.booking.timeSlot).toBe('12:00')
        expect(r.booking.date).toBe('2026-06-15')
      })

      it('未提供 guestData 欄位時帶入預設（散客 / 2 人）', () => {
        const r = seating.walkInSeat('101', {})
        expect(r.booking.name).toBe('散客')
        expect(r.booking.guests).toBe(2)
        expect(r.booking.phone).toBe('')
      })
    })

    // ---------- seatWaitlist ----------
    describe('seatWaitlist', () => {
      it('候位記錄不存在 → 擋', () => {
        const r = seating.seatWaitlist('NOPE', '101')
        expect(r).toEqual({ ok: false, error: '候位記錄不存在' })
      })

      it('桌位不存在 → 擋', () => {
        const w = waitlistService.create({ name: '候A', phone: '0911', partySize: 2 })
        const r = seating.seatWaitlist(w.id, '999')
        expect(r).toEqual({ ok: false, error: '桌位不存在' })
      })

      it('非空桌 → 擋', () => {
        const w = waitlistService.create({ name: '候A', phone: '0911', partySize: 2 })
        tableService.setStatus('101', 'cleaning')
        const r = seating.seatWaitlist(w.id, '101')
        expect(r.ok).toBe(false)
        expect(r.error).toContain('101')
      })

      it('容量不足 → 擋', () => {
        const w = waitlistService.create({ name: '候大團', phone: '0911', partySize: 5 })
        const r = seating.seatWaitlist(w.id, '101') // 101 容量 4 < 5
        expect(r.ok).toBe(false)
        expect(r.error).toContain('容量不足')
      })

      it('成功：建 walk-in booking + 桌 dining + 候位 seated', () => {
        const w = waitlistService.create({ name: '候A', phone: '0911222333', partySize: 3, notes: '靠窗' })
        const r = seating.seatWaitlist(w.id, '101')
        expect(r.ok).toBe(true)
        expect(r.tableNumber).toBe('101')
        // 1) booking
        expect(r.booking).toBeTruthy()
        expect(r.booking.source).toBe('walkin')
        expect(r.booking.status).toBe('arrived')
        expect(r.booking.guests).toBe(3)
        expect(r.booking.name).toBe('候A')
        expect(r.booking.assignedTableId).toBe('101')
        expect(r.booking.createdBy).toBe('waitlist')
        expect(r.booking.notes.text).toBe('靠窗')
        // 2) 桌 dining + 綁定
        const table = tableService.getByNumber('101')
        expect(table.status).toBe('dining')
        expect(table.currentBookingId).toBe(r.booking.id)
        // 3) 候位 seated + 綁桌號
        const wait = waitlistService.getById(w.id)
        expect(wait.status).toBe('seated')
        expect(wait.assignedTableNumber).toBe('101')
      })

      it('容量剛好相等 → 可入座（邊界）', () => {
        const w = waitlistService.create({ name: '候B', phone: '0911', partySize: 4 })
        const r = seating.seatWaitlist(w.id, '101') // 容量 4 == 4
        expect(r.ok).toBe(true)
      })
    })
  })

  // ===========================================================
  // moveTable
  // ===========================================================
  describe('moveTable', () => {
    beforeEach(() => { seedDefaultTables() })

    it('訂位無桌位資料（未指派）→ 擋', () => {
      const b = mkBooking()
      const r = seating.moveTable(b.id, '108')
      expect(r).toEqual({ ok: false, error: '訂位無桌位資料' })
    })

    it('訂位不存在 → 擋（無桌位資料）', () => {
      const r = seating.moveTable('NOPE', '108')
      expect(r).toEqual({ ok: false, error: '訂位無桌位資料' })
    })

    it('同桌無需換桌 → 擋', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      const r = seating.moveTable(b.id, '101')
      expect(r).toEqual({ ok: false, error: '同桌無需換桌' })
    })

    it('目標桌不存在 → 擋', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      const r = seating.moveTable(b.id, '999')
      expect(r).toEqual({ ok: false, error: '目標桌位不存在' })
    })

    it('目標桌非空 → 擋', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      tableService.setStatus('108', 'reserved')
      const r = seating.moveTable(b.id, '108')
      expect(r).toEqual({ ok: false, error: '目標桌位非空桌' })
    })

    it('目標桌容量不足 → 擋', () => {
      const b = mkBooking({ guests: 5 })
      // 用一張足夠大的桌先指派（108 容量 6），再嘗試換到容量 4 的 101
      seating.assignBookingToTable(b.id, '108')
      const r = seating.moveTable(b.id, '101')
      expect(r).toEqual({ ok: false, error: '目標桌容量不足' })
    })

    it('arrived（用餐中）換桌：新桌 dining、舊桌 vacant、booking 改綁新桌', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101')
      seating.seatBooking(b.id) // status arrived，101 dining
      const r = seating.moveTable(b.id, '108')
      expect(r).toEqual({ ok: true })
      const oldT = tableService.getByNumber('101')
      const newT = tableService.getByNumber('108')
      expect(oldT.status).toBe('vacant')
      expect(oldT.currentBookingId).toBeNull()
      expect(newT.status).toBe('dining')
      expect(newT.currentBookingId).toBe(b.id)
      expect(bookingService.getById(b.id).assignedTableId).toBe('108')
    })

    it('reserved（尚未入座）換桌：新桌 reserved、舊桌 vacant', () => {
      const b = mkBooking({ guests: 2 })
      seating.assignBookingToTable(b.id, '101') // reserved，未 seatBooking
      const r = seating.moveTable(b.id, '108')
      expect(r.ok).toBe(true)
      expect(tableService.getByNumber('101').status).toBe('vacant')
      const newT = tableService.getByNumber('108')
      expect(newT.status).toBe('reserved')
      expect(newT.currentBookingId).toBe(b.id)
      expect(bookingService.getById(b.id).assignedTableId).toBe('108')
    })
  })

  // ===========================================================
  // findSuitableTables / suggestTable
  // ===========================================================
  describe('findSuitableTables', () => {
    it('只回傳 active + vacant + 容量足夠的桌', () => {
      tableService.bulkWrite([
        mkTable('101', 4, '1F'),                              // ok
        mkTable('102', 2, '1F'),                              // 容量不足
        mkTable('103', 4, '1F', { status: 'dining' }),        // 非 vacant
        mkTable('104', 4, '1F', { isActive: false }),         // 停用
      ])
      const list = seating.findSuitableTables(4)
      expect(list.map(t => t.number)).toEqual(['101'])
    })

    it('容量過濾：partySize 等於容量也算符合（>=）', () => {
      tableService.bulkWrite([mkTable('101', 4, '1F')])
      expect(seating.findSuitableTables(4).map(t => t.number)).toEqual(['101'])
      expect(seating.findSuitableTables(5)).toEqual([])
    })

    it('最小浪費優先：浪費少的排前面', () => {
      tableService.bulkWrite([
        mkTable('big', 6, '2F'),   // 浪費 4
        mkTable('mid', 4, '2F'),   // 浪費 2
        mkTable('fit', 2, '2F'),   // 浪費 0
      ])
      const list = seating.findSuitableTables(2)
      expect(list.map(t => t.number)).toEqual(['fit', 'mid', 'big'])
    })

    it('同浪費時 1F 優先於 2F', () => {
      tableService.bulkWrite([
        mkTable('201', 4, '2F'),
        mkTable('101', 4, '1F'),
      ])
      const list = seating.findSuitableTables(4) // 兩者浪費皆 0
      expect(list[0].number).toBe('101')
      expect(list[0].floor).toBe('1F')
    })

    it('同浪費、同樓層時：tank 排在 natural-gas 之後', () => {
      tableService.bulkWrite([
        mkTable('tankT', 4, '1F', { fuel: 'tank' }),
        mkTable('gasT', 4, '1F', { fuel: 'natural-gas' }),
      ])
      const list = seating.findSuitableTables(4)
      expect(list.map(t => t.number)).toEqual(['gasT', 'tankT'])
    })

    it('同浪費、同樓層、同 fuel：依桌號字典序', () => {
      tableService.bulkWrite([
        mkTable('113', 4, '1F'),
        mkTable('101', 4, '1F'),
        mkTable('107', 4, '1F'),
      ])
      const list = seating.findSuitableTables(4)
      expect(list.map(t => t.number)).toEqual(['101', '107', '113'])
    })

    it('沒有符合的桌 → 回傳空陣列', () => {
      tableService.bulkWrite([mkTable('101', 2, '1F')])
      expect(seating.findSuitableTables(8)).toEqual([])
    })
  })

  describe('suggestTable', () => {
    it('回傳排序後第一張（最佳建議）', () => {
      tableService.bulkWrite([
        mkTable('big', 6, '2F'),
        mkTable('fit', 4, '1F'),
      ])
      const best = seating.suggestTable(4)
      expect(best.number).toBe('fit')
    })

    it('無可用桌 → 回傳 null', () => {
      tableService.bulkWrite([mkTable('101', 2, '1F', { status: 'dining' })])
      expect(seating.suggestTable(2)).toBeNull()
    })
  })

  // ===========================================================
  // 團體相關：基本防呆（深度流程非本檔重點）
  // ===========================================================
  describe('團體函式 — 基本防呆（團單不存在）', () => {
    beforeEach(() => { seedDefaultTables() })

    it('seatGroupBatch：團單不存在 → 擋', () => {
      expect(seating.seatGroupBatch('NOPE', 'BT1')).toEqual({ ok: false, error: '團單不存在' })
    })

    it('checkoutGroupBatch：團單不存在 → 擋', () => {
      expect(seating.checkoutGroupBatch('NOPE', 'BT1')).toEqual({ ok: false, error: '團單不存在' })
    })

    it('seatNextBatchOnTable：桌位不存在 → 擋', () => {
      expect(seating.seatNextBatchOnTable('999', 'G1', 'BT1')).toEqual({ ok: false, error: '桌位不存在' })
    })

    it('finalizeGroup：團單不存在 → 擋', () => {
      expect(seating.finalizeGroup('NOPE')).toEqual({ ok: false, error: '團單不存在' })
    })

    it('cancelGroup：團單不存在 → 擋', () => {
      expect(seating.cancelGroup('NOPE')).toEqual({ ok: false, error: '團單不存在' })
    })

    it('seatGroupBatch：梯次不存在 → 擋', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 10 } })
      const r = seating.seatGroupBatch(g.id, 'NO_BATCH')
      expect(r).toEqual({ ok: false, error: '梯次不存在' })
    })

    it('seatGroupBatch：梯次尚未圈桌 → 擋', () => {
      // create 預設帶入一個第一梯（tableNumbers 為空）
      const g = groupService.create({ date: '2026-06-15', counts: { total: 10 } })
      const batchId = g.batches[0].id
      const r = seating.seatGroupBatch(g.id, batchId)
      expect(r).toEqual({ ok: false, error: '此梯次尚未圈桌' })
    })

    it('seatGroupBatch：成功圈桌入座 → 桌 dining(group ref) + 團 arrived', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      const batchId = g.batches[0].id
      groupService.setBatchTables(g.id, batchId, ['101', '108'])
      const r = seating.seatGroupBatch(g.id, batchId)
      expect(r.ok).toBe(true)
      expect(r.tableNumbers).toEqual(['101', '108'])
      const t1 = tableService.getByNumber('101')
      expect(t1.status).toBe('dining')
      expect(t1.currentRef).toEqual({ type: 'group', groupId: g.id, batchId })
      expect(t1.currentBookingId).toBeNull()
      expect(groupService.getById(g.id).status).toBe('arrived')
    })

    it('finalizeGroup：清空所有指向此團的桌 + 團 completed', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      const batchId = g.batches[0].id
      groupService.setBatchTables(g.id, batchId, ['101', '108'])
      seating.seatGroupBatch(g.id, batchId)
      const r = seating.finalizeGroup(g.id)
      expect(r.ok).toBe(true)
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(tableService.getByNumber('108').status).toBe('vacant')
      expect(tableService.getByNumber('101').currentRef).toBeNull()
      expect(groupService.getById(g.id).status).toBe('completed')
    })

    it('cancelGroup：清空相關桌 + 團 cancelled', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      const batchId = g.batches[0].id
      groupService.setBatchTables(g.id, batchId, ['101'])
      seating.seatGroupBatch(g.id, batchId)
      const r = seating.cancelGroup(g.id)
      expect(r.ok).toBe(true)
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(groupService.getById(g.id).status).toBe('cancelled')
    })

    it('releaseGroupBatch：離席後整梯待清桌一次清為空桌、團仍 arrived（不結束整團）', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      const batchId = g.batches[0].id
      groupService.setBatchTables(g.id, batchId, ['101', '108'])
      seating.seatGroupBatch(g.id, batchId)
      seating.checkoutGroupBatch(g.id, batchId)          // dining → cleaning
      expect(tableService.getByNumber('101').status).toBe('cleaning')
      const r = seating.releaseGroupBatch(g.id, batchId)
      expect(r.ok).toBe(true)
      expect(r.cleared).toEqual(['101', '108'])
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(tableService.getByNumber('101').currentRef).toBeNull()
      expect(tableService.getByNumber('108').status).toBe('vacant')
      expect(groupService.getById(g.id).status).toBe('arrived')   // 只釋出桌、不結束整團
    })

    it('releaseGroupBatch：尚未離席（dining）→ 無待清桌可釋出、用餐中桌不被誤清', () => {
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      const batchId = g.batches[0].id
      groupService.setBatchTables(g.id, batchId, ['101', '108'])
      seating.seatGroupBatch(g.id, batchId)
      const r = seating.releaseGroupBatch(g.id, batchId)
      expect(r.ok).toBe(false)
      expect(r.error).toBe('此梯沒有待清桌可釋出')
      expect(tableService.getByNumber('101').status).toBe('dining')
    })

    it('releaseGroupBatch：團單 / 梯次不存在 → 擋', () => {
      expect(seating.releaseGroupBatch('NOPE', 'BT1')).toEqual({ ok: false, error: '團單不存在' })
      const g = groupService.create({ date: '2026-06-15', counts: { total: 8 } })
      expect(seating.releaseGroupBatch(g.id, 'NO_BATCH')).toEqual({ ok: false, error: '梯次不存在' })
    })
  })

  // ===========================================================
  // 狀態轉移 & 資料隔離：完整生命週期
  // ===========================================================
  describe('完整生命週期狀態轉移', () => {
    beforeEach(() => { seedDefaultTables() })

    it('指派 → 入座 → 結帳 → 清桌 的狀態鏈', () => {
      const b = mkBooking({ guests: 2 })

      seating.assignBookingToTable(b.id, '101')
      expect(tableService.getByNumber('101').status).toBe('reserved')
      expect(bookingService.getById(b.id).status).toBe('confirmed')

      seating.seatBooking(b.id)
      expect(tableService.getByNumber('101').status).toBe('dining')
      expect(bookingService.getById(b.id).status).toBe('arrived')

      seating.checkoutBooking(b.id)
      expect(tableService.getByNumber('101').status).toBe('cleaning')
      expect(bookingService.getById(b.id).status).toBe('completed')

      seating.clearTable('101')
      expect(tableService.getByNumber('101').status).toBe('vacant')
    })

    it('資料隔離：操作 A 桌不影響其他桌', () => {
      const a = mkBooking({ guests: 2 })
      const b = mkBooking({ guests: 2, phone: '0987654321' })
      seating.assignBookingToTable(a.id, '101')
      seating.assignBookingToTable(b.id, '201')
      seating.cancelBooking(a.id)
      // 101 被釋出，201 不受影響
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(tableService.getByNumber('201').status).toBe('reserved')
      expect(bookingService.getById(b.id).status).toBe('confirmed')
    })
  })
})

describe('seatGroupBatch — 已結束團體防線與 blocked 結構', () => {
  beforeEach(() => {
    tableService.bulkWrite([
      mkTable('101', 6), mkTable('102', 6), mkTable('103', 6), mkTable('108', 4),
    ])
  })

  const mkSeededGroup = (tables = ['101', '102']) => {
    const g = groupService.create({ date: '2026-06-15', counts: { total: 10 } })
    const batchId = g.batches[0].id
    groupService.setBatchTables(g.id, batchId, tables)
    return { g, batchId }
  }

  it('completed 團再入座 → 擋（根治側欄重複匯入）', () => {
    const { g, batchId } = mkSeededGroup()
    seating.seatGroupBatch(g.id, batchId)
    seating.finalizeGroup(g.id)
    const r = seating.seatGroupBatch(g.id, batchId)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已整團完成')
    // 團狀態不被翻回 arrived、桌仍空
    expect(groupService.getById(g.id).status).toBe('completed')
    expect(tableService.getByNumber('101').status).toBe('vacant')
  })

  it('cancelled 團入座 → 擋', () => {
    const { g, batchId } = mkSeededGroup()
    seating.cancelGroup(g.id)
    const r = seating.seatGroupBatch(g.id, batchId)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已取消')
  })

  it('seatNextBatchOnTable：completed 團 → 擋，不動桌況', () => {
    const { g, batchId } = mkSeededGroup()
    seating.seatGroupBatch(g.id, batchId)
    seating.finalizeGroup(g.id)
    const r = seating.seatNextBatchOnTable('101', g.id, batchId)
    expect(r.ok).toBe(false)
    expect(tableService.getByNumber('101').status).toBe('vacant')
  })

  it('桌被佔 → 回傳全部 blocked 桌與中文狀態錯誤', () => {
    const { g, batchId } = mkSeededGroup(['101', '102', '103'])
    tableService.setStatus('101', 'dining')
    tableService.setStatus('103', 'reserved')
    const r = seating.seatGroupBatch(g.id, batchId)
    expect(r.ok).toBe(false)
    expect(r.blocked).toEqual([
      { tableNumber: '101', status: 'dining' },
      { tableNumber: '103', status: 'reserved' },
    ])
    expect(r.error).toContain('101（用餐中）')
    expect(r.error).toContain('103（已預訂）')
    expect(r.error).not.toContain('dining')
    // 沒坐任何桌（all-or-nothing 不變）
    expect(tableService.getByNumber('102').status).toBe('vacant')
  })

  it('cleaning 的同團桌可接續，不算 blocked', () => {
    const { g, batchId } = mkSeededGroup(['101'])
    seating.seatGroupBatch(g.id, batchId)
    seating.checkoutGroupBatch(g.id, batchId) // 101 → cleaning，currentRef 保留
    const r = seating.seatGroupBatch(g.id, batchId)
    expect(r.ok).toBe(true)
  })
})

describe('reseatGroupBatchTable（改派桌位）', () => {
  beforeEach(() => {
    tableService.bulkWrite([
      mkTable('101', 6), mkTable('102', 6), mkTable('103', 6), mkTable('108', 4),
    ])
  })

  const mkSeededGroup = (tables = ['101', '102']) => {
    const g = groupService.create({ date: '2026-06-15', counts: { total: 10 } })
    const batchId = g.batches[0].id
    groupService.setBatchTables(g.id, batchId, tables)
    return { g, batchId }
  }

  it('成功：swap 圈桌 + 立即整梯入座', () => {
    const { g, batchId } = mkSeededGroup(['101', '102'])
    tableService.setStatus('101', 'dining') // 101 被散客佔走
    const r = seating.reseatGroupBatchTable(g.id, batchId, '101', '103')
    expect(r.ok).toBe(true)
    expect(r.seated).toBe(true)
    expect(r.tableNumbers).toEqual(['103', '102'])
    expect(groupService.getById(g.id).batches[0].tableNumbers).toEqual(['103', '102'])
    expect(tableService.getByNumber('103').status).toBe('dining')
    expect(tableService.getByNumber('103').currentRef).toEqual({ type: 'group', groupId: g.id, batchId })
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('swap 落地但其他桌仍被佔 → ok + seated:false + blocked', () => {
    const { g, batchId } = mkSeededGroup(['101', '102'])
    tableService.setStatus('101', 'dining')
    tableService.setStatus('102', 'reserved')
    const r = seating.reseatGroupBatchTable(g.id, batchId, '101', '103')
    expect(r.ok).toBe(true)
    expect(r.seated).toBe(false)
    expect(r.blocked).toEqual([{ tableNumber: '102', status: 'reserved' }])
    // swap 不回滾
    expect(groupService.getById(g.id).batches[0].tableNumbers).toEqual(['103', '102'])
  })

  it('目標非空桌 → 擋（中文狀態）', () => {
    const { g, batchId } = mkSeededGroup()
    tableService.setStatus('101', 'dining')
    tableService.setStatus('103', 'cleaning')
    const r = seating.reseatGroupBatchTable(g.id, batchId, '101', '103')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('清桌中')
  })

  it('目標被其他今日團體圈桌 → 擋', () => {
    const { g, batchId } = mkSeededGroup(['101'])
    const other = groupService.create({ date: '2026-06-15', counts: { total: 6 } })
    groupService.setBatchTables(other.id, other.batches[0].id, ['103'])
    tableService.setStatus('101', 'dining')
    const r = seating.reseatGroupBatchTable(g.id, batchId, '101', '103')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('其他團體保留')
  })

  it('fromTable 不在梯內 / toTable 已在梯內 / 已結束團 → 擋', () => {
    const { g, batchId } = mkSeededGroup(['101', '102'])
    expect(seating.reseatGroupBatchTable(g.id, batchId, '108', '103').ok).toBe(false)
    expect(seating.reseatGroupBatchTable(g.id, batchId, '101', '102').ok).toBe(false)
    seating.finalizeGroup(g.id)
    const r = seating.reseatGroupBatchTable(g.id, batchId, '101', '103')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已結束')
  })
})

describe('executeSweepActions（自動清檯執行層：前置重驗、冪等）', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable('101', 4), mkTable('102', 6), mkTable('103', 6)])
  })

  it('finalize-booking：前置成立 → 釋桌+booking completed；桌已被別人改 → 跳過', () => {
    const b = bookingService.create({ name: '散客', phone: '0911', guests: 2, date: '2026-06-10', timeSlot: '12:00', status: 'arrived', assignedTableId: '101' })
    tableService.seatTable('101', b.id)
    const acts = [
      { type: 'finalize-booking', bookingId: b.id, tableNumber: '101', minutes: 301 },
      { type: 'finalize-booking', bookingId: 'NOPE', tableNumber: '102', minutes: 301 }, // 102 不是 dining → 跳過
    ]
    const done = seating.executeSweepActions(acts)
    expect(done.length).toBe(1)
    expect(tableService.getByNumber('101').status).toBe('vacant')
    expect(bookingService.getById(b.id).status).toBe('completed')
  })

  it('checkout-group-table：dining→cleaning、currentRef 保留 → 第二梯仍可接', () => {
    const g = groupService.create({
      date: '2026-06-10', counts: { total: 16 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['102'], guests: 8 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['102'], guests: 8 },
      ],
    })
    const [b1, b2] = groupService.getById(g.id).batches
    seating.seatGroupBatch(g.id, b1.id)
    const done = seating.executeSweepActions([
      { type: 'checkout-group-table', tableNumber: '102', groupId: g.id, batchId: b1.id, minutes: 400 },
    ])
    expect(done.length).toBe(1)
    const t = tableService.getByNumber('102')
    expect(t.status).toBe('cleaning')
    expect(t.currentRef).toEqual({ type: 'group', groupId: g.id, batchId: b1.id }) // 保留 → 接梯靠它
    // 等同人工「此梯離席」：清桌完成＋接第二梯流程不受影響
    const r = seating.seatNextBatchOnTable('102', g.id, b2.id)
    expect(r.ok).toBe(true)
    expect(tableService.getByNumber('102').currentRef.batchId).toBe(b2.id)
  })

  it('mark-noshow-auto：標 noshow 但不累計顧客罰則（繞過 recordNoshow）', () => {
    const b = bookingService.create({ name: '王test', phone: '0912345678', guests: 2, date: '2026-06-09', timeSlot: '12:00', status: 'confirmed' })
    const before = bookingService.getNoshowCount('0912345678')
    const done = seating.executeSweepActions([{ type: 'mark-noshow-auto', bookingId: b.id }])
    expect(done.length).toBe(1)
    const after = bookingService.getById(b.id)
    expect(after.status).toBe('noshow')
    expect(after.autoFlag).toBe('rollover')
    expect(bookingService.getNoshowCount('0912345678')).toBe(before) // 不+1
  })

  it('complete-group：已 completed 的團跳過（冪等）', () => {
    const g = groupService.create({ date: '2026-06-09', counts: { total: 8 } })
    groupService.setStatus(g.id, 'completed')
    const done = seating.executeSweepActions([{ type: 'complete-group', groupId: g.id }])
    expect(done.length).toBe(0)
  })

  it('clear-table：vacant 桌跳過、cleaning 桌清為 vacant', () => {
    tableService.setStatus('103', 'cleaning')
    const done = seating.executeSweepActions([
      { type: 'clear-table', tableNumber: '103', reason: 'stale-day' },
      { type: 'clear-table', tableNumber: '101', reason: 'stale-day' }, // vacant → 跳過
    ])
    expect(done.map(a => a.tableNumber)).toEqual(['103'])
    expect(tableService.getByNumber('103').status).toBe('vacant')
  })
})

// ============================================================
// 停用/維修守門（service 層底線）：所有「放客人上桌」入口拒絕今日不可用的桌；
// 停用/設維修前的團體圈桌衝突檢查。
// ============================================================
describe('停用/維修守門（入座路徑）', () => {
  const TODAY = '2026-06-15'
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  })
  afterEach(() => vi.useRealTimers())

  const outToday = { outage: { from: TODAY, to: '', reason: '維修' } }

  it('assignBookingToTable：維修桌拒絕指派', () => {
    tableService.bulkWrite([mkTable('101', 4, '1F', outToday)])
    const b = mkBooking()
    const r = seating.assignBookingToTable(b.id, '101')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('停用/維修')
  })

  it('seatBooking：預配桌事後被設維修 → 到店入座被擋並提示改派', () => {
    tableService.bulkWrite([mkTable('101', 4, '1F')])
    const b = mkBooking()
    expect(seating.assignBookingToTable(b.id, '101').ok).toBe(true)
    // 直接改桌資料模擬「同步進來的維修窗」（繞過 setOutage 的佔用守門做出不一致狀態）
    tableService.bulkWrite([mkTable('101', 4, '1F', { ...outToday, status: 'vacant' })])
    const r = seating.seatBooking(b.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('改派')
  })

  it('walkInSeat / seatWaitlist / moveTable：維修桌一律拒絕', () => {
    tableService.bulkWrite([mkTable('101', 4, '1F', outToday), mkTable('108', 6, '1F')])
    expect(seating.walkInSeat('101', { name: '散客', guests: 2 }).ok).toBe(false)
    const w = waitlistService.create({ name: '排隊', phone: '0911111111', partySize: 2 })
    expect(seating.seatWaitlist(w.id, '101').ok).toBe(false)
    // moveTable：先在可用桌入座，再嘗試換到維修桌
    const r0 = seating.walkInSeat('108', { name: '散客', guests: 2 })
    expect(r0.ok).toBe(true)
    const r = seating.moveTable(r0.booking.id, '101')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('停用/維修')
  })

  it('seatGroupBatch：圈到的維修桌進 blocked（接改派桌位流程），錯誤訊息標示維修', () => {
    tableService.bulkWrite([mkTable('101', 4, '1F', outToday), mkTable('108', 6, '1F')])
    const g = groupService.create({
      date: TODAY, agencyName: '快樂旅行社',
      batches: [{ id: 'BT1', label: '第一梯', timeSlot: '12:00', tableNumbers: ['101', '108'], guests: 8 }],
      counts: { total: 8 }, status: 'confirmed',
    })
    const r = seating.seatGroupBatch(g.id, 'BT1')
    expect(r.ok).toBe(false)
    expect(r.blocked).toEqual([{ tableNumber: '101', status: 'outage' }])
    expect(r.error).toContain('停用/維修中')
  })
})

describe('停用/維修 × 團體圈桌衝突守門（toggleTableGuarded / setTableOutageGuarded）', () => {
  const TODAY = '2026-06-15'
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
    seedDefaultTables()
  })
  afterEach(() => vi.useRealTimers())

  const mkGroup = (over = {}) => groupService.create({
    date: '2026-06-20', agencyName: '快樂旅行社',
    batches: [{ id: 'BT1', label: '第一梯', timeSlot: '12:00', tableNumbers: ['101'], guests: 4 }],
    counts: { total: 4 }, status: 'confirmed',
    ...over,
  })

  it('永久停用：未來有效團圈到此桌 → 擋下並指名該團', () => {
    mkGroup()
    const r = seating.toggleTableGuarded('101')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('快樂旅行社')
    expect(tableService.getByNumber('101').isActive).toBe(true)
  })

  it('已取消/已完成的團不擋；無衝突的桌照常停用', () => {
    mkGroup({ status: 'cancelled' })
    expect(seating.toggleTableGuarded('101').ok).toBe(true)
    expect(seating.toggleTableGuarded('108').ok).toBe(true)
  })

  it('設維修：窗內有團圈桌 → 擋；窗外的團不擋', () => {
    mkGroup() // 2026-06-20
    const inWindow = seating.setTableOutageGuarded('101', { from: TODAY, to: '2026-06-25', reason: 'x' })
    expect(inWindow.ok).toBe(false)
    expect(inWindow.error).toContain('改桌')
    const outsideWindow = seating.setTableOutageGuarded('101', { from: TODAY, to: '2026-06-18', reason: 'x' })
    expect(outsideWindow.ok).toBe(true)
  })

  it('無限期維修（to 空）：任何未來團圈桌都擋', () => {
    mkGroup()
    const r = seating.setTableOutageGuarded('101', { from: TODAY, to: '', reason: 'x' })
    expect(r.ok).toBe(false)
  })
})
