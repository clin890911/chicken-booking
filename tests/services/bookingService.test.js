// bookingService 回歸測試
// 測試目標：src/services/bookingService.js
// 後端為 localStorage（tests/setup.js 已換成 Map-backed mock，每測試前後清空）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bookingService from '../../src/services/bookingService'
import * as customerService from '../../src/services/customerService'

const BOOKINGS_KEY = 'chicken_bookings_v1'
const NOSHOW_KEY = 'chicken_noshow_v1'

// 固定系統時間：2026-06-15 12:00（本地時間）
const FIXED_NOW = new Date(2026, 5, 15, 12, 0, 0, 0) // 月份 0-based → 5 = June

// 直接把已知 JSON 寫進 localStorage（前置資料）
function seedBookings(list) {
  localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list))
}
function rawBookings() {
  return JSON.parse(localStorage.getItem(BOOKINGS_KEY) || '[]')
}
function rawNoshow() {
  return JSON.parse(localStorage.getItem(NOSHOW_KEY) || '{}')
}

// 基本可用的 create 輸入
function baseInput(overrides = {}) {
  return {
    name: '小明',
    phone: '0912345678',
    guests: 4,
    date: '2026-06-20',
    timeSlot: '18:00',
    ...overrides,
  }
}

describe('phoneTail', () => {
  it('預設取末 3 碼', () => {
    expect(bookingService.phoneTail('0912345678')).toBe('678')
  })

  it('可指定長度取末 4 碼', () => {
    expect(bookingService.phoneTail('0912345678', 4)).toBe('5678')
  })

  it('會先去除非數字字元再取末碼', () => {
    expect(bookingService.phoneTail('0912-345-678', 4)).toBe('5678')
    expect(bookingService.phoneTail('+886 912 345 678', 3)).toBe('678')
  })

  it('空值或無數字回空字串', () => {
    expect(bookingService.phoneTail('')).toBe('')
    expect(bookingService.phoneTail(null)).toBe('')
    expect(bookingService.phoneTail(undefined)).toBe('')
    expect(bookingService.phoneTail('abc')).toBe('')
  })

  it('數字位數不足要求長度時回傳全部數字', () => {
    expect(bookingService.phoneTail('12', 4)).toBe('12')
  })
})

describe('createManageToken', () => {
  it('在有 crypto 的環境下回傳 48 字元 hex', () => {
    const tok = bookingService.createManageToken()
    expect(tok).toMatch(/^[0-9a-f]{48}$/)
  })

  it('每次產生的 token 不同', () => {
    const a = bookingService.createManageToken()
    const b = bookingService.createManageToken()
    expect(a).not.toBe(b)
  })
})

describe('create', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('套用預設值並寫入 localStorage', () => {
    const b = bookingService.create(baseInput())
    expect(b.id).toMatch(/^B/)
    expect(b.name).toBe('小明')
    expect(b.phone).toBe('0912345678')
    expect(b.guests).toBe(4)
    expect(b.date).toBe('2026-06-20')
    expect(b.timeSlot).toBe('18:00')
    expect(b.source).toBe('online')
    expect(b.status).toBe('confirmed')
    expect(b.assignedTableId).toBeNull()
    expect(b.extraTableIds).toEqual([])
    expect(b.lineUserId).toBeNull()
    expect(b.guestEditCount).toBe(0)
    expect(b.guestEditHistory).toEqual([])
    expect(b.cancellationReason).toBeNull()
    expect(b.createdBy).toBe('guest')
    expect(b.createdAt).toBe(FIXED_NOW.toISOString())
    expect(b.updatedAt).toBe(FIXED_NOW.toISOString())
    // 真的寫進 localStorage
    expect(rawBookings()).toHaveLength(1)
    expect(rawBookings()[0].id).toBe(b.id)
  })

  it('name/phone 會 trim、guests 至少為 1', () => {
    const b = bookingService.create(baseInput({ name: '  阿華  ', phone: '  0922000111  ', guests: 0 }))
    expect(b.name).toBe('阿華')
    expect(b.phone).toBe('0922000111')
    expect(b.guests).toBe(1) // Number(0)||1 → 1
  })

  it('extraTableIds：帶入時正規化為字串陣列；未帶時為 []', () => {
    const b = bookingService.create(baseInput({ assignedTableId: '101', extraTableIds: [102, '103'] }))
    expect(b.assignedTableId).toBe('101')
    expect(b.extraTableIds).toEqual(['102', '103'])
    const b2 = bookingService.create(baseInput())
    expect(b2.extraTableIds).toEqual([])
  })

  it('listAll：舊資料缺 extraTableIds → 補 []（向後相容）', () => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'BOLD', name: '舊', date: '2026-06-20', timeSlot: '18:00', assignedTableId: '101' }]))
    const [b] = bookingService.listAll()
    expect(b.extraTableIds).toEqual([])
  })

  it('guests 非數字時退回 1', () => {
    const b = bookingService.create(baseInput({ guests: 'abc' }))
    expect(b.guests).toBe(1)
  })

  it('notes 結構固定為 pet/child/mobility 布林 + text 字串', () => {
    const b = bookingService.create(baseInput({ notes: { pet: 1, child: true, mobility: 0, text: '靠窗' } }))
    expect(b.notes).toEqual({ pet: true, child: true, mobility: false, text: '靠窗' })
  })

  it('未提供 notes 時給安全預設', () => {
    const b = bookingService.create(baseInput())
    expect(b.notes).toEqual({ pet: false, child: false, mobility: false, text: '' })
  })

  it('產生 48 hex 的 manageToken（未指定時）', () => {
    const b = bookingService.create(baseInput())
    expect(b.manageToken).toMatch(/^[0-9a-f]{48}$/)
  })

  it('可帶入自訂 manageToken/source/status/createdBy', () => {
    const b = bookingService.create(baseInput({
      manageToken: 'custom-token',
      source: 'phone',
      status: 'arrived',
      createdBy: 'admin',
    }))
    expect(b.manageToken).toBe('custom-token')
    expect(b.source).toBe('phone')
    expect(b.status).toBe('arrived')
    expect(b.createdBy).toBe('admin')
  })

  it('會 upsert 顧客檔（visits=1、totalGuests=人數）', () => {
    bookingService.create(baseInput({ phone: '0912345678', name: '小明', guests: 4 }))
    const c = customerService.getByPhone('0912345678')
    expect(c).not.toBeNull()
    expect(c.name).toBe('小明')
    expect(c.visits).toBe(1)
    expect(c.totalGuests).toBe(4)
  })

  it('同電話再次 create 會累加 visits/totalGuests', () => {
    bookingService.create(baseInput({ phone: '0912345678', guests: 4 }))
    bookingService.create(baseInput({ phone: '0912345678', guests: 2 }))
    const c = customerService.getByPhone('0912345678')
    expect(c.visits).toBe(2)
    expect(c.totalGuests).toBe(6)
  })

  it('沒有電話時不建立顧客檔', () => {
    bookingService.create(baseInput({ phone: '' }))
    expect(customerService.listAll()).toHaveLength(0)
  })

  it('多筆 create 各有不同 id', () => {
    const a = bookingService.create(baseInput())
    const b = bookingService.create(baseInput())
    expect(a.id).not.toBe(b.id)
    expect(rawBookings()).toHaveLength(2)
  })
})

describe('讀取：listAll / listByDate / listByTable / getById', () => {
  it('listAll 對舊資料補上新欄位預設值（向後相容）', () => {
    seedBookings([{ id: 'B1', name: '舊資料', date: '2026-06-20', timeSlot: '18:00', status: 'confirmed' }])
    const [b] = bookingService.listAll()
    expect(b.assignedTableId).toBeNull()
    expect(b.lineUserId).toBeNull()
    expect(b.manageToken).toBeNull()
    expect(b.lastGuestEditAt).toBeNull()
    expect(b.guestEditCount).toBe(0)
    expect(b.guestEditHistory).toEqual([])
    expect(b.cancellationReason).toBeNull()
    // 原欄位保留
    expect(b.name).toBe('舊資料')
  })

  it('listAll 不覆蓋已存在的欄位值', () => {
    seedBookings([{ id: 'B1', assignedTableId: 'A5', guestEditCount: 3 }])
    const [b] = bookingService.listAll()
    expect(b.assignedTableId).toBe('A5')
    expect(b.guestEditCount).toBe(3)
  })

  it('localStorage 為空時 listAll 回空陣列', () => {
    expect(bookingService.listAll()).toEqual([])
  })

  it('listByDate 只回傳該日期的訂位', () => {
    seedBookings([
      { id: 'B1', date: '2026-06-20' },
      { id: 'B2', date: '2026-06-21' },
      { id: 'B3', date: '2026-06-20' },
    ])
    const r = bookingService.listByDate('2026-06-20')
    expect(r.map(b => b.id).sort()).toEqual(['B1', 'B3'])
  })

  it('listByTable 依 assignedTableId 過濾', () => {
    seedBookings([
      { id: 'B1', assignedTableId: 'A1' },
      { id: 'B2', assignedTableId: 'A2' },
      { id: 'B3', assignedTableId: 'A1' },
    ])
    expect(bookingService.listByTable('A1').map(b => b.id).sort()).toEqual(['B1', 'B3'])
    expect(bookingService.listByTable('A9')).toEqual([])
  })

  it('getById 找到回傳物件、找不到回 null', () => {
    seedBookings([{ id: 'B1', name: 'x' }])
    expect(bookingService.getById('B1').name).toBe('x')
    expect(bookingService.getById('NOPE')).toBeNull()
  })
})

describe('update', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('套用 patch 並更新 updatedAt', () => {
    seedBookings([{ id: 'B1', name: '舊', updatedAt: '2020-01-01T00:00:00.000Z' }])
    const r = bookingService.update('B1', { name: '新' })
    expect(r.name).toBe('新')
    expect(r.updatedAt).toBe(FIXED_NOW.toISOString())
    expect(rawBookings()[0].name).toBe('新')
  })

  it('找不到 id 回 null 且不寫入', () => {
    seedBookings([{ id: 'B1' }])
    expect(bookingService.update('NOPE', { name: 'x' })).toBeNull()
    expect(rawBookings()).toHaveLength(1)
  })
})

describe('setStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('改為 arrived 會記錄 actualArrivalTime', () => {
    seedBookings([{ id: 'B1', status: 'confirmed' }])
    const r = bookingService.setStatus('B1', 'arrived')
    expect(r.status).toBe('arrived')
    expect(r.actualArrivalTime).toBe(FIXED_NOW.toISOString())
  })

  it('已有 actualArrivalTime 時再 arrived 不覆蓋', () => {
    seedBookings([{ id: 'B1', status: 'confirmed', actualArrivalTime: '2026-06-15T03:00:00.000Z' }])
    const r = bookingService.setStatus('B1', 'arrived')
    expect(r.actualArrivalTime).toBe('2026-06-15T03:00:00.000Z')
  })

  it('改回 confirmed 會清掉 actualArrivalTime', () => {
    seedBookings([{ id: 'B1', status: 'arrived', actualArrivalTime: '2026-06-15T03:00:00.000Z' }])
    const r = bookingService.setStatus('B1', 'confirmed')
    expect(r.status).toBe('confirmed')
    expect(r.actualArrivalTime).toBeNull()
  })

  it('改為 noshow 會觸發 recordNoshow', () => {
    seedBookings([{ id: 'B1', status: 'confirmed', phone: '0911222333', date: '2026-06-20' }])
    bookingService.setStatus('B1', 'noshow')
    expect(bookingService.getNoshowCount('0911222333')).toBe(1)
    const rec = rawNoshow()['0911222333']
    expect(rec.dates).toEqual([{ date: '2026-06-20', bookingId: 'B1' }])
  })

  it('找不到的 id setStatus 回 null 且不記 noshow', () => {
    expect(bookingService.setStatus('NOPE', 'noshow')).toBeNull()
    expect(rawNoshow()).toEqual({})
  })
})

describe('cycleStatus（confirmed → arrived → completed 循環）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('confirmed → arrived', () => {
    seedBookings([{ id: 'B1', status: 'confirmed' }])
    expect(bookingService.cycleStatus('B1').status).toBe('arrived')
  })

  it('arrived → completed', () => {
    seedBookings([{ id: 'B1', status: 'arrived' }])
    expect(bookingService.cycleStatus('B1').status).toBe('completed')
  })

  it('completed → confirmed（繞回）', () => {
    seedBookings([{ id: 'B1', status: 'completed' }])
    expect(bookingService.cycleStatus('B1').status).toBe('confirmed')
  })

  it('未知狀態（indexOf=-1）會循到陣列首 confirmed', () => {
    // i=-1 → (i+1)%3 = 0 → 'confirmed'
    seedBookings([{ id: 'B1', status: 'cancelled' }])
    expect(bookingService.cycleStatus('B1').status).toBe('confirmed')
  })

  it('找不到 id 回 null', () => {
    expect(bookingService.cycleStatus('NOPE')).toBeNull()
  })
})

describe('assignTable / unassignTable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('assignTable 設定 assignedTableId', () => {
    seedBookings([{ id: 'B1' }])
    const r = bookingService.assignTable('B1', 'A7')
    expect(r.assignedTableId).toBe('A7')
  })

  it('unassignTable 清掉 assignedTableId', () => {
    seedBookings([{ id: 'B1', assignedTableId: 'A7' }])
    const r = bookingService.unassignTable('B1')
    expect(r.assignedTableId).toBeNull()
  })

  it('找不到的 id 回 null', () => {
    expect(bookingService.assignTable('NOPE', 'A1')).toBeNull()
    expect(bookingService.unassignTable('NOPE')).toBeNull()
  })
})

describe('No-show：recordNoshow / getNoshowCount / noshowRisk / searchNoshow', () => {
  it('recordNoshow 累加 count 並記錄 date/bookingId', () => {
    bookingService.recordNoshow({ phone: '0911', date: '2026-06-20', id: 'B1' })
    bookingService.recordNoshow({ phone: '0911', date: '2026-06-25', id: 'B2' })
    const rec = rawNoshow()['0911']
    expect(rec.count).toBe(2)
    expect(rec.dates).toEqual([
      { date: '2026-06-20', bookingId: 'B1' },
      { date: '2026-06-25', bookingId: 'B2' },
    ])
  })

  it('recordNoshow 沒有電話時不記錄', () => {
    bookingService.recordNoshow({ phone: '', date: '2026-06-20', id: 'B1' })
    expect(rawNoshow()).toEqual({})
  })

  it('getNoshowCount：無電話或無紀錄回 0', () => {
    expect(bookingService.getNoshowCount('')).toBe(0)
    expect(bookingService.getNoshowCount(null)).toBe(0)
    expect(bookingService.getNoshowCount('0000')).toBe(0)
  })

  it('getNoshowCount 回正確次數', () => {
    bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B1' })
    expect(bookingService.getNoshowCount('0911')).toBe(1)
  })

  it('noshowRisk 分級：0 次→0', () => {
    expect(bookingService.noshowRisk('0911')).toBe(0)
  })

  it('noshowRisk 分級：1 次→1（低）', () => {
    bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B1' })
    expect(bookingService.noshowRisk('0911')).toBe(1)
  })

  it('noshowRisk 分級：2 次→2（中）', () => {
    bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B1' })
    bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B2' })
    expect(bookingService.noshowRisk('0911')).toBe(2)
  })

  it('noshowRisk 分級：3 次→3（高）', () => {
    for (let i = 0; i < 3; i++) bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B' + i })
    expect(bookingService.noshowRisk('0911')).toBe(3)
  })

  it('noshowRisk 分級：4 次→仍為 3（≥3 封頂）', () => {
    for (let i = 0; i < 4; i++) bookingService.recordNoshow({ phone: '0911', date: 'd', id: 'B' + i })
    expect(bookingService.noshowRisk('0911')).toBe(3)
  })

  it('searchNoshow：以子字串比對電話', () => {
    bookingService.recordNoshow({ phone: '0912345678', date: 'd', id: 'B1' })
    bookingService.recordNoshow({ phone: '0922000111', date: 'd', id: 'B2' })
    const r = bookingService.searchNoshow('345')
    expect(r).toHaveLength(1)
    expect(r[0].phone).toBe('0912345678')
    expect(r[0].count).toBe(1)
  })

  it('searchNoshow：空查詢回空陣列', () => {
    bookingService.recordNoshow({ phone: '0912', date: 'd', id: 'B1' })
    expect(bookingService.searchNoshow('')).toEqual([])
    expect(bookingService.searchNoshow(null)).toEqual([])
  })

  it('searchNoshow：查無結果回空陣列', () => {
    bookingService.recordNoshow({ phone: '0912', date: 'd', id: 'B1' })
    expect(bookingService.searchNoshow('9999')).toEqual([])
  })
})

describe('isGuestEditable（固定時間 2026-06-15 12:00）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('沒有 booking 回 ok:false', () => {
    const r = bookingService.isGuestEditable(null)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('找不到')
  })

  it.each(['arrived', 'completed', 'cancelled', 'noshow'])('狀態 %s 擋下', (status) => {
    const r = bookingService.isGuestEditable({ status, date: '2026-06-20', timeSlot: '18:00' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('無法由客人自行修改')
  })

  it('缺 date 或 timeSlot → 資料不完整', () => {
    expect(bookingService.isGuestEditable({ status: 'confirmed', timeSlot: '18:00' }).ok).toBe(false)
    expect(bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-20' }).ok).toBe(false)
    expect(bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-20', timeSlot: '18:00' }).reason)
      .toBeUndefined()
  })

  it('用餐時間距現在超過 2 小時 → 可編輯', () => {
    // 用餐 2026-06-15 18:00，現在 12:00，距 6 小時，cutoff=16:00 → now<cutoff
    const r = bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-15', timeSlot: '18:00' })
    expect(r.ok).toBe(true)
  })

  it('用餐前 2 小時內 → 擋下（now >= cutoff）', () => {
    // 用餐 13:30，cutoff=11:30，現在 12:00 → now>=cutoff
    const r = bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-15', timeSlot: '13:30' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('用餐前 2 小時內')
  })

  it('恰好等於 cutoff（用餐 14:00）→ 擋下（>= 邊界）', () => {
    // 用餐 14:00，cutoff = 12:00 = now → now>=cutoff 為 true → 擋下
    const r = bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-15', timeSlot: '14:00' })
    expect(r.ok).toBe(false)
  })

  it('剛好超過 cutoff 一分鐘（用餐 14:01）→ 可編輯', () => {
    const r = bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-15', timeSlot: '14:01' })
    expect(r.ok).toBe(true)
  })

  it('可傳入自訂 now', () => {
    const customNow = new Date(2026, 5, 15, 17, 0, 0) // 17:00
    // 用餐 18:00，cutoff=16:00，now=17:00 → 擋下
    const r = bookingService.isGuestEditable({ status: 'confirmed', date: '2026-06-15', timeSlot: '18:00' }, customNow)
    expect(r.ok).toBe(false)
  })
})

describe('verifyGuestAccess', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('找不到訂位 → ok:false', () => {
    const r = bookingService.verifyGuestAccess('NOPE', 'tok', '678')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('找不到')
  })

  it('token 不符 → ok:false', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    const r = bookingService.verifyGuestAccess('B1', 'bad', '678')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('管理連結無效')
  })

  it('token 缺漏 → ok:false', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    const r = bookingService.verifyGuestAccess('B1', '', '678')
    expect(r.ok).toBe(false)
  })

  it('沒有 manageToken 的舊訂位會自動補發再驗證', () => {
    // listAll 補預設 manageToken:null → ensureManageToken 會發新 token 並回新物件
    seedBookings([{ id: 'B1', phone: '0912345678' }])
    const issued = bookingService.getById('B1') // 還沒補
    expect(issued.manageToken).toBeNull()
    // 用錯 token 驗證會失敗，但 booking 已被補上 token（寫回）
    const r = bookingService.verifyGuestAccess('B1', 'whatever', '678')
    expect(r.ok).toBe(false)
    const after = bookingService.getById('B1')
    expect(after.manageToken).toMatch(/^[0-9a-f]{48}$/)
  })

  it('末碼長度非 3/4 → ok:false', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    expect(bookingService.verifyGuestAccess('B1', 'good', '67').ok).toBe(false)
    expect(bookingService.verifyGuestAccess('B1', 'good', '67').reason).toContain('末 3 或 4 碼')
    expect(bookingService.verifyGuestAccess('B1', 'good', '12345').ok).toBe(false)
  })

  it('末 3 碼正確 → ok:true 並回 booking', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    const r = bookingService.verifyGuestAccess('B1', 'good', '678')
    expect(r.ok).toBe(true)
    expect(r.booking.id).toBe('B1')
  })

  it('末 4 碼正確 → ok:true', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    expect(bookingService.verifyGuestAccess('B1', 'good', '5678').ok).toBe(true)
  })

  it('末 3 碼錯誤 → ok:false', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    const r = bookingService.verifyGuestAccess('B1', 'good', '999')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('末碼不符')
  })

  it('末碼含符號會先標準化再比對', () => {
    seedBookings([{ id: 'B1', phone: '0912345678', manageToken: 'good' }])
    expect(bookingService.verifyGuestAccess('B1', 'good', '6-7-8').ok).toBe(true)
  })
})

describe('updateBookingByGuest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function seedEditable(overrides = {}) {
    seedBookings([{
      id: 'B1',
      name: '小明',
      phone: '0912345678',
      guests: 4,
      date: '2026-06-20', // 距現在很久 → 可編輯
      timeSlot: '18:00',
      notes: { pet: false, child: false, mobility: false, text: '' },
      status: 'confirmed',
      assignedTableId: 'A5',
      manageToken: 'good',
      guestEditCount: 0,
      guestEditHistory: [],
      ...overrides,
    }])
  }

  it('找不到訂位 → ok:false', () => {
    const r = bookingService.updateBookingByGuest('NOPE', 'good', { guests: 2 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('找不到')
  })

  it('token 不符 → ok:false', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'bad', { guests: 2 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('管理連結無效')
  })

  it('不可編輯狀態下回傳 isGuestEditable 的錯誤', () => {
    seedEditable({ status: 'arrived' })
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 2 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('無法由客人自行修改')
  })

  it('改 guests（結構性）會解除 assignedTableId', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 6 })
    expect(r.ok).toBe(true)
    expect(r.booking.guests).toBe(6)
    expect(r.booking.assignedTableId).toBeNull()
  })

  it('改 date（結構性）會解除 assignedTableId', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { date: '2026-06-21' })
    expect(r.booking.assignedTableId).toBeNull()
  })

  it('改 timeSlot（結構性）會解除 assignedTableId', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { timeSlot: '19:00' })
    expect(r.booking.assignedTableId).toBeNull()
  })

  it('只改 notes（非結構性）不解除桌位', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { notes: { pet: true, child: false, mobility: false, text: '改備註' } })
    expect(r.booking.assignedTableId).toBe('A5')
  })

  it('結構性欄位但值未變 → 不解除桌位', () => {
    seedEditable()
    // guests 仍是 4（值相同）→ shouldUnassign 為 false
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 4 })
    expect(r.booking.assignedTableId).toBe('A5')
  })

  it('寫入 history（type guest_update、含 changedKeys、before/after）並 guestEditCount++', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 6 })
    expect(r.booking.guestEditCount).toBe(1)
    expect(r.booking.guestEditHistory).toHaveLength(1)
    const h = r.booking.guestEditHistory[0]
    expect(h.type).toBe('guest_update')
    expect(h.at).toBe(FIXED_NOW.toISOString())
    expect(h.changedKeys).toContain('guests')
    expect(h.before.guests).toBe(4)
    expect(h.before.assignedTableId).toBe('A5')
    expect(h.after.guests).toBe(6)
    expect(h.after.assignedTableId).toBeNull() // 結構性改動 → after 反映解除
  })

  it('連續兩次編輯，history 累加、guestEditCount=2', () => {
    seedEditable()
    bookingService.updateBookingByGuest('B1', 'good', { guests: 6 })
    const r = bookingService.updateBookingByGuest('B1', 'good', { name: '阿明' })
    expect(r.booking.guestEditCount).toBe(2)
    expect(r.booking.guestEditHistory).toHaveLength(2)
  })

  it('設定 lastGuestEditAt 為現在', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 6 })
    expect(r.booking.lastGuestEditAt).toBe(FIXED_NOW.toISOString())
  })

  it('回傳 changes 內含 cleanPatch', () => {
    seedEditable()
    const r = bookingService.updateBookingByGuest('B1', 'good', { guests: 6 })
    expect(r.changes.assignedTableId).toBeNull()
    expect(r.changes.guestEditCount).toBe(1)
    expect(r.changes.guests).toBe(6)
  })
})

describe('cancelBookingByGuest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function seedEditable(overrides = {}) {
    seedBookings([{
      id: 'B1',
      name: '小明',
      phone: '0912345678',
      guests: 4,
      date: '2026-06-20',
      timeSlot: '18:00',
      status: 'confirmed',
      assignedTableId: 'A5',
      manageToken: 'good',
      guestEditCount: 0,
      guestEditHistory: [],
      ...overrides,
    }])
  }

  it('找不到 → ok:false', () => {
    expect(bookingService.cancelBookingByGuest('NOPE', 'good', '臨時有事').ok).toBe(false)
  })

  it('token 不符 → ok:false', () => {
    seedEditable()
    expect(bookingService.cancelBookingByGuest('B1', 'bad', '臨時有事').ok).toBe(false)
  })

  it('不可編輯狀態下擋下', () => {
    seedEditable({ status: 'completed' })
    const r = bookingService.cancelBookingByGuest('B1', 'good', '臨時有事')
    expect(r.ok).toBe(false)
  })

  it('成功取消：status=cancelled、解除桌位、記原因與 history', () => {
    seedEditable()
    const r = bookingService.cancelBookingByGuest('B1', 'good', '臨時有事')
    expect(r.ok).toBe(true)
    expect(r.booking.status).toBe('cancelled')
    expect(r.booking.assignedTableId).toBeNull()
    expect(r.booking.cancellationReason).toEqual({
      source: 'guest',
      reason: '臨時有事',
      at: FIXED_NOW.toISOString(),
    })
    expect(r.booking.guestEditCount).toBe(1)
    expect(r.booking.guestEditHistory).toHaveLength(1)
    expect(r.booking.guestEditHistory[0].type).toBe('guest_cancel')
    expect(r.booking.guestEditHistory[0].reason).toBe('臨時有事')
  })

  it('未提供原因 → 記為「未提供」', () => {
    seedEditable()
    const r = bookingService.cancelBookingByGuest('B1', 'good')
    expect(r.booking.cancellationReason.reason).toBe('未提供')
    expect(r.booking.guestEditHistory[0].reason).toBe('未提供')
  })

  it('原因僅空白 → 視為未提供', () => {
    seedEditable()
    const r = bookingService.cancelBookingByGuest('B1', 'good', '   ')
    expect(r.booking.cancellationReason.reason).toBe('未提供')
  })
})

describe('listUpcoming（固定時間 2026-06-15 12:00）', () => {
  const TODAY = '2026-06-15'
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('只取 confirmed 狀態的訂位', () => {
    seedBookings([
      { id: 'B1', date: TODAY, timeSlot: '12:30', status: 'confirmed' },
      { id: 'B2', date: TODAY, timeSlot: '12:30', status: 'arrived' },
      { id: 'B3', date: TODAY, timeSlot: '12:30', status: 'cancelled' },
    ])
    const r = bookingService.listUpcoming(TODAY)
    expect(r.map(b => b.id)).toEqual(['B1'])
  })

  it('時段在 -15 ~ +60 分內才納入（預設 withinMinutes=60）', () => {
    seedBookings([
      { id: 'before20', date: TODAY, timeSlot: '11:40', status: 'confirmed' }, // -20 → 排除
      { id: 'before15', date: TODAY, timeSlot: '11:45', status: 'confirmed' }, // -15 → 納入（邊界）
      { id: 'now', date: TODAY, timeSlot: '12:00', status: 'confirmed' },       // 0 → 納入
      { id: 'plus60', date: TODAY, timeSlot: '13:00', status: 'confirmed' },    // +60 → 納入（邊界）
      { id: 'plus61', date: TODAY, timeSlot: '13:01', status: 'confirmed' },    // +61 → 排除
    ])
    const ids = bookingService.listUpcoming(TODAY).map(b => b.id)
    expect(ids).toEqual(['before15', 'now', 'plus60'])
  })

  it('自訂 withinMinutes 可放寬上界', () => {
    seedBookings([
      { id: 'plus90', date: TODAY, timeSlot: '13:30', status: 'confirmed' },
    ])
    expect(bookingService.listUpcoming(TODAY, 120).map(b => b.id)).toEqual(['plus90'])
    expect(bookingService.listUpcoming(TODAY, 60)).toEqual([])
  })

  it('結果依 timeSlot 由小到大排序', () => {
    seedBookings([
      { id: 'late', date: TODAY, timeSlot: '12:50', status: 'confirmed' },
      { id: 'early', date: TODAY, timeSlot: '12:10', status: 'confirmed' },
      { id: 'mid', date: TODAY, timeSlot: '12:30', status: 'confirmed' },
    ])
    expect(bookingService.listUpcoming(TODAY).map(b => b.id)).toEqual(['early', 'mid', 'late'])
  })

  it('缺 timeSlot 的訂位排除', () => {
    seedBookings([
      { id: 'B1', date: TODAY, status: 'confirmed' },
      { id: 'B2', date: TODAY, timeSlot: '12:30', status: 'confirmed' },
    ])
    expect(bookingService.listUpcoming(TODAY).map(b => b.id)).toEqual(['B2'])
  })

  it('其他日期不納入（先以 date 過濾）', () => {
    seedBookings([
      { id: 'B1', date: '2026-06-16', timeSlot: '12:30', status: 'confirmed' },
    ])
    expect(bookingService.listUpcoming(TODAY)).toEqual([])
  })
})

describe('exportCSV', () => {
  it('以 BOM 開頭', () => {
    seedBookings([])
    const csv = bookingService.exportCSV()
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
  })

  it('包含表頭', () => {
    seedBookings([])
    const csv = bookingService.exportCSV()
    const headerLine = csv.slice(1).split('\n')[0]
    expect(headerLine).toBe('訂位編號,姓名,電話,人數,日期,時段,指派桌,寵物,兒童,行動不便,備註,來源,狀態,建立時間')
  })

  it('輸出資料列且 notes 布林轉 Y/空', () => {
    seedBookings([{
      id: 'B1', name: '小明', phone: '0912', guests: 4, date: '2026-06-20', timeSlot: '18:00',
      assignedTableId: 'A5', notes: { pet: true, child: false, mobility: true, text: '靠窗' },
      source: 'online', status: 'confirmed', createdAt: '2026-06-15T03:00:00.000Z',
    }])
    const csv = bookingService.exportCSV()
    const row = csv.slice(1).split('\n')[1]
    expect(row).toBe('B1,小明,0912,4,2026-06-20,18:00,A5,Y,,Y,靠窗,online,confirmed,2026-06-15T03:00:00.000Z')
  })

  it('含逗號的欄位會用雙引號包起來', () => {
    seedBookings([{
      id: 'B1', name: '王,小明', phone: '0912', guests: 2, date: '2026-06-20', timeSlot: '18:00',
      notes: { text: 'a, b, c' }, source: 'online', status: 'confirmed', createdAt: 't',
    }])
    const csv = bookingService.exportCSV()
    expect(csv).toContain('"王,小明"')
    expect(csv).toContain('"a, b, c"')
  })

  it('含雙引號的欄位會跳脫為兩個雙引號並整體加引號', () => {
    seedBookings([{
      id: 'B1', name: '他說"嗨"', phone: '0912', guests: 2, date: 'd', timeSlot: 't',
      notes: { text: '' }, source: 'online', status: 'confirmed', createdAt: 'c',
    }])
    const csv = bookingService.exportCSV()
    expect(csv).toContain('"他說""嗨"""')
  })

  it('含換行的欄位會用雙引號包起來', () => {
    seedBookings([{
      id: 'B1', name: '第一行\n第二行', phone: '0912', guests: 2, date: 'd', timeSlot: 't',
      notes: { text: '' }, source: 'online', status: 'confirmed', createdAt: 'c',
    }])
    const csv = bookingService.exportCSV()
    expect(csv).toContain('"第一行\n第二行"')
  })

  it('assignedTableId 為 null 時輸出空字串', () => {
    seedBookings([{
      id: 'B1', name: 'x', phone: '0912', guests: 1, date: 'd', timeSlot: 't',
      assignedTableId: null, notes: {}, source: 'online', status: 'confirmed', createdAt: 'c',
    }])
    const csv = bookingService.exportCSV()
    const row = csv.slice(1).split('\n')[1]
    // 指派桌欄位（第 7 欄）應為空
    expect(row.split(',')[6]).toBe('')
  })
})

describe('資料隔離（每測試從乾淨狀態開始）', () => {
  it('前一測試的 booking 不殘留', () => {
    expect(bookingService.listAll()).toEqual([])
    expect(rawNoshow()).toEqual({})
    expect(customerService.listAll()).toEqual([])
  })

  it('bookings 與 noshow 使用不同 storage key，互不污染', () => {
    bookingService.create(baseInput({ phone: '0912' }))
    expect(localStorage.getItem(BOOKINGS_KEY)).not.toBeNull()
    expect(localStorage.getItem(NOSHOW_KEY)).toBeNull()
  })
})

describe('upsertFromRemote：LINE 欄位 round-trip 保存（repo 已知坑型：固定欄位白名單剝欄位）', () => {
  it('lineUserId / lineDisplayName / linePushBlocked / lineLastNotify 經 upsert 後完整保留', () => {
    const remote = {
      id: 'B-LINE-1',
      name: '綁定客人',
      phone: '0911222333',
      guests: 2,
      date: '2026-06-20',
      timeSlot: '18:00',
      status: 'confirmed',
      manageToken: 'tok-1',
      lineUserId: 'U-abc',
      lineDisplayName: '小綠',
      linePushBlocked: true,
      lineLastNotify: { event: 'updated', status: 'failed', at: '2026-06-15T10:00:00.000Z', error: 'line-403' },
    }
    bookingService.upsertFromRemote(remote)
    const saved = bookingService.getById('B-LINE-1')
    expect(saved.lineUserId).toBe('U-abc')
    expect(saved.lineDisplayName).toBe('小綠')
    expect(saved.linePushBlocked).toBe(true)
    expect(saved.lineLastNotify).toEqual(remote.lineLastNotify)
  })

  it('二次 upsert（雲端更新送達狀態）覆蓋舊值而不丟其他欄位', () => {
    bookingService.upsertFromRemote({
      id: 'B-LINE-2', name: 'A', phone: '0911', guests: 2, date: '2026-06-21', timeSlot: '12:00',
      manageToken: 't', lineUserId: 'U-1', lineDisplayName: '阿綠', linePushBlocked: false,
      lineLastNotify: { event: 'created', status: 'pending', at: '2026-06-15T09:00:00.000Z' },
    })
    bookingService.upsertFromRemote({
      id: 'B-LINE-2', name: 'A', phone: '0911', guests: 2, date: '2026-06-21', timeSlot: '12:00',
      manageToken: 't', lineUserId: 'U-1', lineDisplayName: '阿綠', linePushBlocked: false,
      lineLastNotify: { event: 'created', status: 'sent', at: '2026-06-15T09:01:00.000Z' },
    })
    const saved = bookingService.getById('B-LINE-2')
    expect(saved.lineLastNotify.status).toBe('sent')
    expect(saved.lineDisplayName).toBe('阿綠')
  })
})
