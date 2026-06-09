// 跨 service 端到端流程整合測試
// 目標：以「真實業務劇本」串接 bookingService × tableService × seatingService ×
//       waitlistService × customerService × capacity 工具，逐步斷言狀態一致性。
// 後端：localStorage（tests/setup.js 每個測試前後自動清空）。
// 不 import 任何會碰網路 / Firebase 的模組。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as waitlistService from '../../src/services/waitlistService'
import * as customerService from '../../src/services/customerService'
import {
  calcSlotCapacity,
  occupancyMinutes,
  toMinutes,
  CAPACITY_EXCLUDED_STATUSES,
} from '../../src/utils/capacity'

// === 固定系統時間：2026-06-15 12:00（本地時間） ===
// 多數 service 內部會讀目前系統時間（walkin booking 的 today/timeSlot、
// actualArrivalTime、isGuestEditable 的 now…），固定後測試可重複。
const FIXED_NOW = new Date(2026, 5, 15, 12, 0, 0) // 月份 0-based → 5 = 六月

// === 已知桌位工廠（直接 bulkWrite，狀態完全可控，不依賴 INITIAL_TABLES）===
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

// 預設桌位：1F 兩張（4 人 / 6 人）、2F 兩張（4 人 / 6 人）；總座位 4+6+4+6 = 20
function seedTables() {
  tableService.bulkWrite([
    mkTable('101', 4, '1F'),
    mkTable('108', 6, '1F'),
    mkTable('201', 4, '2F'),
    mkTable('208', 6, '2F'),
  ])
}

// 一筆線上訂位（confirmed、未指派桌）
function mkOnlineBooking(overrides = {}) {
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

const DATE = '2026-06-15'

describe('跨 service 端到端流程', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
    seedTables()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===================================================================
  // 劇本 1：線上訂位 → 指派桌 → 入座 → 離席(checkout) → 清桌釋出
  // 每步驗 booking.status 與 table.status 一致；最終桌回 vacant 並解除綁定。
  // ===================================================================
  describe('劇本 1：完整訂位生命週期（含 cleaning 中繼）', () => {
    it('confirmed → reserved → dining → cleaning → vacant，每步狀態一致', () => {
      const booking = mkOnlineBooking({ guests: 4 })
      // 初始：訂位 confirmed、未指派桌；桌 101 vacant、無綁定
      expect(bookingService.getById(booking.id).status).toBe('confirmed')
      expect(bookingService.getById(booking.id).assignedTableId).toBeNull()
      expect(tableService.getByNumber('101').status).toBe('vacant')

      // 1) 指派桌 101
      const assign = seating.assignBookingToTable(booking.id, '101')
      expect(assign.ok).toBe(true)
      expect(bookingService.getById(booking.id).assignedTableId).toBe('101')
      // booking 仍為 confirmed（指派不改 booking 狀態）；桌轉 reserved 並綁 bookingId
      expect(bookingService.getById(booking.id).status).toBe('confirmed')
      let t = tableService.getByNumber('101')
      expect(t.status).toBe('reserved')
      expect(t.currentBookingId).toBe(booking.id)

      // 2) 客人到了 → 入座：booking arrived、桌 dining、記 actualArrivalTime
      const seat = seating.seatBooking(booking.id)
      expect(seat.ok).toBe(true)
      expect(seat.tableNumber).toBe('101')
      const arrived = bookingService.getById(booking.id)
      expect(arrived.status).toBe('arrived')
      expect(arrived.actualArrivalTime).toBe(FIXED_NOW.toISOString())
      t = tableService.getByNumber('101')
      expect(t.status).toBe('dining')
      expect(t.currentBookingId).toBe(booking.id)
      expect(t.seatedAt).toBe(FIXED_NOW.toISOString())

      // 3) 離席 checkout：booking completed、桌 dining → cleaning（仍佔位）
      const checkout = seating.checkoutBooking(booking.id)
      expect(checkout.ok).toBe(true)
      expect(bookingService.getById(booking.id).status).toBe('completed')
      t = tableService.getByNumber('101')
      expect(t.status).toBe('cleaning')
      // checkoutTable 只改 status/seatedAt；currentBookingId 仍保留直到清桌
      expect(t.currentBookingId).toBe(booking.id)
      expect(t.seatedAt).toBeNull()

      // 4) 清桌完成釋出：桌回 vacant 並解除所有綁定
      seating.clearTable('101')
      t = tableService.getByNumber('101')
      expect(t.status).toBe('vacant')
      expect(t.currentBookingId).toBeNull()
      expect(t.currentRef).toBeNull()
      expect(t.seatedAt).toBeNull()
      // booking 維持 completed（清桌不影響 booking）
      expect(bookingService.getById(booking.id).status).toBe('completed')
    })

    it('未指派桌就想入座 → 失敗且狀態不變', () => {
      const booking = mkOnlineBooking()
      const r = seating.seatBooking(booking.id)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/尚未指派/)
      expect(bookingService.getById(booking.id).status).toBe('confirmed')
    })
  })

  // ===================================================================
  // 劇本 2：線上訂位 → 指派 → 一鍵釋出(finalizeBooking)
  // 桌直接 vacant（跳過 cleaning），booking completed。
  // ===================================================================
  describe('劇本 2：finalizeBooking 一鍵釋出（跳過 cleaning）', () => {
    it('指派後直接 finalize：booking completed、桌直接 vacant 並解除綁定', () => {
      const booking = mkOnlineBooking({ guests: 6 })
      seating.assignBookingToTable(booking.id, '108')
      seating.seatBooking(booking.id)
      expect(tableService.getByNumber('108').status).toBe('dining')

      const r = seating.finalizeBooking(booking.id)
      expect(r.ok).toBe(true)
      expect(r.tableNumber).toBe('108')
      expect(bookingService.getById(booking.id).status).toBe('completed')
      const t = tableService.getByNumber('108')
      // 直接 vacant，不經 cleaning
      expect(t.status).toBe('vacant')
      expect(t.currentBookingId).toBeNull()
      expect(t.currentRef).toBeNull()
      expect(t.seatedAt).toBeNull()
    })

    it('finalize 一筆「已指派但尚未入座（reserved）」的訂位也能釋出桌', () => {
      const booking = mkOnlineBooking()
      seating.assignBookingToTable(booking.id, '101')
      expect(tableService.getByNumber('101').status).toBe('reserved')

      const r = seating.finalizeBooking(booking.id)
      expect(r.ok).toBe(true)
      expect(bookingService.getById(booking.id).status).toBe('completed')
      expect(tableService.getByNumber('101').status).toBe('vacant')
    })
  })

  // ===================================================================
  // 劇本 3：候位取號 → seatWaitlist 入座空桌
  // 自動產生 walkin/arrived booking、桌 dining、候位 seated、顧客檔 upsert。
  // ===================================================================
  describe('劇本 3：候位 → 入座空桌（自動建 walk-in booking）', () => {
    it('seatWaitlist：候位 seated、桌 dining、自動建 arrived walk-in booking、顧客檔 upsert', () => {
      const wait = waitlistService.create({
        name: '陳大文',
        phone: '0922333444',
        partySize: 4,
        notes: '靠窗',
      })
      expect(wait.status).toBe('waiting')
      // 入座前顧客檔尚無此電話（候位不 upsert，只有 booking.create 才 upsert）
      expect(customerService.getByPhone('0922333444')).toBeNull()

      const r = seating.seatWaitlist(wait.id, '101')
      expect(r.ok).toBe(true)
      expect(r.tableNumber).toBe('101')

      // 1) 自動建立的 walk-in booking
      const booking = r.booking
      expect(booking).toBeTruthy()
      expect(booking.source).toBe('walkin')
      expect(booking.status).toBe('arrived')
      expect(booking.guests).toBe(4)
      expect(booking.name).toBe('陳大文')
      expect(booking.phone).toBe('0922333444')
      expect(booking.assignedTableId).toBe('101')
      expect(booking.createdBy).toBe('waitlist')
      expect(booking.notes.text).toBe('靠窗')
      // walk-in 用「今天」+ 半小時對齊時段（依固定系統時間）
      expect(booking.date).toBe(new Date().toISOString().slice(0, 10))
      // booking 確實落地（可由 getById 取回）
      expect(bookingService.getById(booking.id)).toBeTruthy()

      // 2) 桌位 dining + 綁此 booking
      const t = tableService.getByNumber('101')
      expect(t.status).toBe('dining')
      expect(t.currentBookingId).toBe(booking.id)

      // 3) 候位記錄改 seated + 綁桌號
      const w = waitlistService.getById(wait.id)
      expect(w.status).toBe('seated')
      expect(w.assignedTableNumber).toBe('101')

      // 4) 顧客檔 upsert（由 booking.create 觸發）
      const cust = customerService.getByPhone('0922333444')
      expect(cust).toBeTruthy()
      expect(cust.name).toBe('陳大文')
      expect(cust.visits).toBe(1)
      expect(cust.totalGuests).toBe(4)
    })

    it('候位人數超過桌容量 → 拒絕，且不建 booking、不動桌、候位仍 waiting', () => {
      const wait = waitlistService.create({ name: '大團', phone: '0900111222', partySize: 5 })
      const before = bookingService.listAll().length
      const r = seating.seatWaitlist(wait.id, '101') // 101 容量 4 < 5
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/容量不足/)
      expect(bookingService.listAll().length).toBe(before)
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(waitlistService.getById(wait.id).status).toBe('waiting')
    })

    it('目標桌非空 → 拒絕入座', () => {
      const occupant = mkOnlineBooking()
      seating.assignBookingToTable(occupant.id, '101') // 101 → reserved
      const wait = waitlistService.create({ name: '路人', phone: '0911000111', partySize: 2 })
      const r = seating.seatWaitlist(wait.id, '101')
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/不是空桌/)
      expect(waitlistService.getById(wait.id).status).toBe('waiting')
    })
  })

  // ===================================================================
  // 劇本 4：訂位 No-show
  // setStatus('noshow') → getNoshowCount/noshowRisk 反映；容量計算不再計這筆。
  // ===================================================================
  describe('劇本 4：No-show 影響容量與風險統計', () => {
    it('標記 noshow：noshow 計數 / 風險上升，且 calcSlotCapacity 不再扣這筆', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      const tables = tableService.listAll()
      const totalSeats = tables.filter(t => t.isActive).reduce((s, t) => s + t.capacity, 0)
      expect(totalSeats).toBe(20)

      const phone = '0955666777'
      const booking = mkOnlineBooking({ phone, guests: 6, timeSlot: '18:00' })

      // 標記前：18:00 容量被扣 6
      const before = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings)
      expect(before).toBe(totalSeats - 6)
      expect(bookingService.getNoshowCount(phone)).toBe(0)
      expect(bookingService.noshowRisk(phone)).toBe(0)

      // 標記 noshow
      bookingService.setStatus(booking.id, 'noshow')
      expect(bookingService.getById(booking.id).status).toBe('noshow')

      // noshow 屬容量排除狀態
      expect(CAPACITY_EXCLUDED_STATUSES).toContain('noshow')
      const after = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings)
      expect(after).toBe(totalSeats) // 不再扣這筆 → 回到滿座位

      // noshow 計數與風險
      expect(bookingService.getNoshowCount(phone)).toBe(1)
      expect(bookingService.noshowRisk(phone)).toBe(1)
    })

    it('同一電話累積 3 次 noshow → 風險升到高(3)', () => {
      const phone = '0933222111'
      for (let i = 0; i < 3; i++) {
        const b = mkOnlineBooking({ phone, name: `客${i}` })
        bookingService.setStatus(b.id, 'noshow')
      }
      expect(bookingService.getNoshowCount(phone)).toBe(3)
      expect(bookingService.noshowRisk(phone)).toBe(3)
    })
  })

  // ===================================================================
  // 劇本 5：客人自行改時間(updateBookingByGuest 改 timeSlot) → 解除指派桌
  // ===================================================================
  describe('劇本 5：客人改時段 → assignedTableId 解除（需重新指派）', () => {
    it('改 timeSlot 後 booking.assignedTableId 變 null（資料層解除）', () => {
      // 固定 now=2026-06-15 12:00，用餐時間 18:00（>2h 前）→ 可由客人編輯
      const booking = mkOnlineBooking({ timeSlot: '18:00' })
      const withTok = bookingService.ensureManageToken(booking.id)
      const token = withTok.manageToken

      // 先由店長指派桌
      seating.assignBookingToTable(booking.id, '101')
      expect(bookingService.getById(booking.id).assignedTableId).toBe('101')

      // 客人改時段
      const r = bookingService.updateBookingByGuest(booking.id, token, { timeSlot: '17:00' })
      expect(r.ok).toBe(true)
      const updated = bookingService.getById(booking.id)
      expect(updated.timeSlot).toBe('17:00')
      // 結構性欄位（timeSlot）變動 → 解除桌位指派
      expect(updated.assignedTableId).toBeNull()
    })

    it('只改備註（非結構性欄位）不應解除指派桌', () => {
      const booking = mkOnlineBooking({ timeSlot: '18:00' })
      const token = bookingService.ensureManageToken(booking.id).manageToken
      seating.assignBookingToTable(booking.id, '101')

      const r = bookingService.updateBookingByGuest(booking.id, token, {
        notes: { text: '改備註而已' },
      })
      expect(r.ok).toBe(true)
      expect(bookingService.getById(booking.id).assignedTableId).toBe('101')
    })

    it('客人改時段解除指派時，應一併釋放原桌（不留孤兒 reserved 桌）', () => {
      // 回歸防護：bookingService.updateBookingByGuest 解除 assignedTableId 時，
      // 會呼叫 releaseTableIfHeldBy 把原桌釋放回 vacant，避免桌停在 reserved 卻指向已解除的綁定。
      const booking = mkOnlineBooking({ timeSlot: '18:00' })
      const token = bookingService.ensureManageToken(booking.id).manageToken
      seating.assignBookingToTable(booking.id, '101')
      expect(tableService.getByNumber('101').status).toBe('reserved')

      bookingService.updateBookingByGuest(booking.id, token, { timeSlot: '17:00' })

      // 理想：桌應被釋放回 vacant
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(tableService.getByNumber('101').currentBookingId).toBeNull()
    })
  })

  // ===================================================================
  // 劇本 6：取消訂位(cancelBooking) → 桌釋出、容量回補
  // ===================================================================
  describe('劇本 6：取消訂位釋放桌位並回補容量', () => {
    it('cancelBooking：booking cancelled + assignedTableId null、桌回 vacant、容量變多', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      const totalSeats = 20
      const booking = mkOnlineBooking({ guests: 4, timeSlot: '18:00' })
      seating.assignBookingToTable(booking.id, '101')

      const capWhenBooked = calcSlotCapacity(
        tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings,
      )
      expect(capWhenBooked).toBe(totalSeats - 4)
      expect(tableService.getByNumber('101').status).toBe('reserved')

      const r = seating.cancelBooking(booking.id)
      expect(r.ok).toBe(true)
      const after = bookingService.getById(booking.id)
      expect(after.status).toBe('cancelled')
      expect(after.assignedTableId).toBeNull()

      // 桌回 vacant 並解除綁定
      const t = tableService.getByNumber('101')
      expect(t.status).toBe('vacant')
      expect(t.currentBookingId).toBeNull()

      // 容量回補（cancelled 屬排除狀態）
      const capAfter = calcSlotCapacity(
        tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings,
      )
      expect(capAfter).toBe(totalSeats)
      expect(capAfter).toBeGreaterThan(capWhenBooked)
    })

    it('取消「未指派桌」的訂位也安全（不噴錯、容量回補）', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      const booking = mkOnlineBooking({ guests: 2, timeSlot: '18:00' })
      const r = seating.cancelBooking(booking.id)
      expect(r.ok).toBe(true)
      expect(bookingService.getById(booking.id).status).toBe('cancelled')
      const cap = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings)
      expect(cap).toBe(20)
    })
  })

  // ===================================================================
  // 劇本 7：容量把關 — 塞滿某時段 → 該時段 0、相鄰不重疊時段仍有空
  // ===================================================================
  describe('劇本 7：容量把關（塞滿時段 vs 相鄰不重疊時段）', () => {
    it('塞滿 18:00 → 該時段容量 0；不重疊的 20:00 仍滿', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      const totalSeats = 20
      // 佔位時長 = 90 + 10 = 100 分鐘
      expect(occupancyMinutes(settings)).toBe(100)
      // 18:00=1080、20:00=1200；窗 [1080,1180) 與 [1200,1300) 不重疊（邊界相接不算重疊）
      expect(toMinutes('18:00')).toBe(1080)
      expect(toMinutes('20:00')).toBe(1200)

      // 用 20 人填滿 18:00（4 筆 × 5 人 = 20）
      mkOnlineBooking({ phone: '0901', guests: 5, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0902', guests: 5, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0903', guests: 5, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0904', guests: 5, timeSlot: '18:00' })

      const at1800 = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings)
      expect(at1800).toBe(0)

      // 相鄰但不重疊的 20:00 仍是滿座位（這些 18:00 的窗到 1180 結束，不碰 1200）
      const at2000 = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '20:00', settings)
      expect(at2000).toBe(totalSeats)
    })

    it('重疊時段（19:00，落在 18:00 的佔位窗內）仍被同一批訂位佔用', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      // 19:00=1140 落在 [1080,1180) 內 → 與 18:00 的訂位重疊
      mkOnlineBooking({ phone: '0901', guests: 5, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0902', guests: 5, timeSlot: '18:00' })
      const at1900 = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '19:00', settings)
      // 18:00 的兩筆（共 10 人）窗 [1080,1180) 與 19:00 的窗 [1140,1240) 重疊 → 被扣
      expect(at1900).toBe(20 - 10)
    })

    it('超賣保護：容量不會變負數（Math.max(0, ...)）', () => {
      const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
      // 故意塞超過總座位（25 > 20）
      mkOnlineBooking({ phone: '0901', guests: 6, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0902', guests: 6, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0903', guests: 6, timeSlot: '18:00' })
      mkOnlineBooking({ phone: '0904', guests: 7, timeSlot: '18:00' })
      const cap = calcSlotCapacity(tableService.listAll(), bookingService.listAll(), DATE, '18:00', settings)
      expect(cap).toBe(0)
      expect(cap).toBeGreaterThanOrEqual(0)
    })
  })

  // ===================================================================
  // 額外：跨流程資料隔離與一致性
  // ===================================================================
  describe('資料隔離與一致性', () => {
    it('指派失敗（桌容量不足）不應污染 booking 與 table 狀態', () => {
      const booking = mkOnlineBooking({ guests: 6 })
      const r = seating.assignBookingToTable(booking.id, '101') // 101 容量 4 < 6
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/容量不足/)
      // booking 未被指派、桌仍 vacant
      expect(bookingService.getById(booking.id).assignedTableId).toBeNull()
      expect(tableService.getByNumber('101').status).toBe('vacant')
    })

    it('整段流程不會洩漏到其他桌（只有目標桌被動到）', () => {
      const booking = mkOnlineBooking({ guests: 4 })
      seating.assignBookingToTable(booking.id, '101')
      seating.seatBooking(booking.id)
      seating.finalizeBooking(booking.id)
      // 其他三張桌全程保持 vacant
      for (const n of ['108', '201', '208']) {
        expect(tableService.getByNumber(n).status).toBe('vacant')
        expect(tableService.getByNumber(n).currentBookingId).toBeNull()
      }
    })

    it('moveTable：已入座客人換桌 → 舊桌釋放、新桌 dining、指派同步', () => {
      const booking = mkOnlineBooking({ guests: 4 })
      seating.assignBookingToTable(booking.id, '101')
      seating.seatBooking(booking.id) // 101 dining
      const r = seating.moveTable(booking.id, '201')
      expect(r.ok).toBe(true)
      expect(tableService.getByNumber('101').status).toBe('vacant')
      expect(tableService.getByNumber('201').status).toBe('dining')
      expect(tableService.getByNumber('201').currentBookingId).toBe(booking.id)
      expect(bookingService.getById(booking.id).assignedTableId).toBe('201')
    })
  })
})
