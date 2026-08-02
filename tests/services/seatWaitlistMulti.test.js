import { describe, it, expect, beforeEach } from 'vitest'
import * as seatingService from '../../src/services/seatingService'
import * as waitlistService from '../../src/services/waitlistService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'

// 候位併桌入座（2026-08 店主回報）。
// 症狀：候位 9 位、現場只剩幾張 4 人桌時，按「入座」只回「目前無符合容量的空桌」——
// 明明併兩三張小桌就坐得下。訂位指派早就有併桌路徑（assignBookingTablesMulti），候位沒有。
// 這裡鎖住 service 層：與 walkInSeatMulti 同口徑（空桌／今日可用／同樓層／合計席數足夠）。

const TABLES = [
  { number: '105', capacity: 4, floor: '1F', status: 'vacant' },
  { number: '106', capacity: 4, floor: '1F', status: 'vacant' },
  { number: '109', capacity: 4, floor: '1F', status: 'vacant' },
  { number: '201', capacity: 4, floor: '2F', status: 'vacant' },
  { number: '110', capacity: 6, floor: '1F', status: 'dining' },
]

const seedTables = (over = {}) => {
  const list = TABLES.map(t => ({
    x: 0, y: 0, w: 90, h: 75, rotation: 0, zoneId: null, isActive: true, outage: null,
    currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null,
    blockReason: null, updatedAt: null,
    ...t,
    ...(over[t.number] || {}),
  }))
  // 桌位的 storage key 是 v3（tableService.STORAGE_KEY）；寫錯 key 會靜默 fallback 到
  // INITIAL_TABLES，測試就變成在測真實佈局而不是這裡的情境。
  localStorage.setItem('chicken_tables_v3', JSON.stringify(list))
}

const seedWait = (over = {}) => {
  const w = {
    id: 'W1', queueNumber: 3, name: '訪客', phone: '0900000000', partySize: 9,
    status: 'waiting', createdAt: new Date().toISOString(), notes: '', ...over,
  }
  localStorage.setItem('chicken_waitlist_v1', JSON.stringify([w]))
  return w
}

beforeEach(() => {
  localStorage.clear()
  seedTables()
  seedWait()
})

describe('seatWaitlistMulti（候位併桌入座）', () => {
  it('9 位併三張 4 人桌 → 成功：booking 佔主桌+額外桌、三桌都 dining、候位轉 seated', () => {
    const r = seatingService.seatWaitlistMulti('W1', ['105', '106', '109'])
    expect(r.ok).toBe(true)
    expect(r.tableNumbers).toEqual(['105', '106', '109'])

    const b = bookingService.getById(r.booking.id)
    expect(b.guests).toBe(9)
    expect(b.status).toBe('arrived')
    expect(b.source).toBe('walkin')
    expect(b.assignedTableId).toBe('105')
    expect(b.extraTableIds).toEqual(['106', '109'])

    for (const n of ['105', '106', '109']) {
      const t = tableService.getByNumber(n)
      expect(t.status).toBe('dining')
      expect(t.currentBookingId).toBe(r.booking.id)
    }

    const w = waitlistService.getById('W1')
    expect(w.status).toBe('seated')
    // 候位欄位是單數，只記主桌；完整桌組在 booking 上
    expect(w.assignedTableNumber).toBe('105')
  })

  it('合計席數不足 → 拒絕，且不留下半套狀態（桌位與候位都不動）', () => {
    const r = seatingService.seatWaitlistMulti('W1', ['105', '106'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不足 9 位')
    expect(tableService.getByNumber('105').status).toBe('vacant')
    expect(tableService.getByNumber('106').status).toBe('vacant')
    expect(waitlistService.getById('W1').status).toBe('waiting')
    expect(bookingService.listAll()).toHaveLength(0)
  })

  it('跨樓層 → 拒絕（一組客人不可能分坐兩層）', () => {
    const r = seatingService.seatWaitlistMulti('W1', ['105', '106', '201'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('同一樓層')
    expect(bookingService.listAll()).toHaveLength(0)
  })

  it('含非空桌 → 拒絕，其他桌不被動到', () => {
    const r = seatingService.seatWaitlistMulti('W1', ['105', '106', '110'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不是空桌')
    expect(tableService.getByNumber('105').status).toBe('vacant')
  })

  it('含今日維修停用桌 → 拒絕', () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTables({ 109: { outage: { from: today, to: today, reason: '桌椅維修' } } })
    const r = seatingService.seatWaitlistMulti('W1', ['105', '106', '109'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('109')
    expect(bookingService.listAll()).toHaveLength(0)
  })

  it('只給一張桌 → 退回單桌路徑 seatWaitlist（維持單一實作）', () => {
    seedWait({ partySize: 3 })
    const r = seatingService.seatWaitlistMulti('W1', ['105'])
    expect(r.ok).toBe(true)
    const b = bookingService.getById(r.booking.id)
    expect(b.assignedTableId).toBe('105')
    // 單桌路徑不會塞 extraTableIds
    expect(b.extraTableIds || []).toEqual([])
    expect(tableService.getByNumber('105').status).toBe('dining')
  })

  it('重複桌號會去重（點兩次同一張桌不該灌水席數）', () => {
    seedWait({ partySize: 9 })
    const r = seatingService.seatWaitlistMulti('W1', ['105', '105', '106'])
    // 去重後只剩 105+106 = 8 席 < 9 → 應拒絕，而不是誤算成 12 席放行
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不足 9 位')
  })

  it('沒選桌 / 候位不存在 → 明確錯誤', () => {
    expect(seatingService.seatWaitlistMulti('W1', []).ok).toBe(false)
    const r = seatingService.seatWaitlistMulti('NOPE', ['105', '106', '109'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('候位記錄不存在')
  })
})
