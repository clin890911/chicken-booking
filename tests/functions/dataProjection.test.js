import { describe, it, expect } from 'vitest'
import {
  projectBookingForRead,
  projectWaitlistForRead,
  projectForRead,
  stripServerOwnedBookingFields,
  stripServerOwnedCustomerFields,
  buildBookingUpsertData,
  BOOKING_SERVER_OWNED_FIELDS,
} from '../../functions/lib/dataProjection.js'

// 欄位級把關（functions/lib/dataProjection.js）。
// 這層擋的是：manageToken（客人改單/取消密鑰）與 PII 過度下發到店員裝置（讀取投影，item 1）、
// 以及繞過 UI 直接打 adminPushData 覆寫 server-owned 欄位的越權（寫入白名單，item 2）。

const ROLES = ['manager', 'floor', 'host', 'kitchen']

const FULL_BOOKING = {
  id: 'B1', name: '林小明', phone: '0912345678', phoneDigits: '0912345678',
  guests: 4, date: '2026-07-05', timeSlot: '18:00', status: 'confirmed',
  assignedTableId: 'A3', extraTableIds: ['A4'], notes: { text: '' }, source: 'online',
  manageToken: 'SECRET-TOKEN', token: 'LEGACY-TOKEN', lineUserId: 'U123',
  guestEditHistory: [{ at: 1 }], cancellationReason: null, createdAt: '2026-01-01', createdBy: 'guest',
}

describe('projectBookingForRead（讀取投影）', () => {
  it('所有角色（含 manager）一律剝除 manageToken / token', () => {
    for (const role of ROLES) {
      const out = projectBookingForRead(FULL_BOOKING, role)
      expect('manageToken' in out).toBe(false)
      expect('token' in out).toBe(false)
    }
  })

  it('kitchen 另剝除 phone / phoneDigits / lineUserId；floor/host/manager 保留這些聯絡欄位', () => {
    const k = projectBookingForRead(FULL_BOOKING, 'kitchen')
    expect('phone' in k).toBe(false)
    expect('phoneDigits' in k).toBe(false)
    expect('lineUserId' in k).toBe(false)
    // kitchen 仍需渲染的欄位保留
    expect(k.guests).toBe(4)
    expect(k.date).toBe('2026-07-05')
    expect(k.status).toBe('confirmed')
    for (const role of ['manager', 'floor', 'host']) {
      const out = projectBookingForRead(FULL_BOOKING, role)
      expect(out.phone).toBe('0912345678')
      expect(out.phoneDigits).toBe('0912345678')
      expect(out.lineUserId).toBe('U123')
    }
  })

  it('不改動原始文件（純函式、回傳新物件）', () => {
    projectBookingForRead(FULL_BOOKING, 'kitchen')
    expect(FULL_BOOKING.manageToken).toBe('SECRET-TOKEN')
    expect(FULL_BOOKING.phone).toBe('0912345678')
  })
})

describe('projectWaitlistForRead', () => {
  const W = { id: 'W1', name: '王', phone: '0922333444', phoneDigits: '0922333444', lineUserId: 'U9', partySize: 2 }
  it('kitchen 剝除 PII、其餘保留', () => {
    const k = projectWaitlistForRead(W, 'kitchen')
    expect('phone' in k).toBe(false)
    expect('phoneDigits' in k).toBe(false)
    expect('lineUserId' in k).toBe(false)
    expect(k.name).toBe('王')
    expect(k.partySize).toBe(2)
  })
  it('非 kitchen 原樣回傳', () => {
    for (const role of ['manager', 'floor', 'host']) {
      expect(projectWaitlistForRead(W, role)).toBe(W)
    }
  })
})

describe('projectForRead（集合分派）', () => {
  it('groupReservations 僅 kitchen 剝除 guidePhone', () => {
    const g = { id: 'G1', agencyName: '旅行社', guideName: '陳導', guidePhone: '0933000111' }
    const k = projectForRead('groupReservations', g, 'kitchen')
    expect('guidePhone' in k).toBe(false)
    expect(k.guideName).toBe('陳導')
    expect(projectForRead('groupReservations', g, 'floor').guidePhone).toBe('0933000111')
  })
  it('bookings / waitlist 走各自投影', () => {
    expect('manageToken' in projectForRead('bookings', FULL_BOOKING, 'floor')).toBe(false)
    expect('phone' in projectForRead('waitlist', { phone: '09', name: 'x' }, 'kitchen')).toBe(false)
  })
  it('未知集合（如 tables）原樣回傳', () => {
    const t = { number: 'A1', seats: 4 }
    expect(projectForRead('tables', t, 'kitchen')).toBe(t)
  })
})

describe('stripServerOwnedBookingFields（寫入白名單 denylist）', () => {
  it('剝除所有 server-owned 欄位、保留合法客戶端欄位', () => {
    const adversarial = {
      id: 'B1', name: '攻擊者', status: 'confirmed', guests: 2,
      manageToken: 'evil', token: 'evil2', guestEditHistory: [{ hacked: true }],
      guestEditCount: 999, lastGuestEditAt: 'x', cancellationReason: { reason: 'x' },
      lineUserId: 'evil', linePushBlocked: true, lineLastNotify: 'x',
      phoneDigits: 'evil', createdAt: 'evil', createdBy: 'evil',
    }
    const out = stripServerOwnedBookingFields(adversarial)
    for (const f of BOOKING_SERVER_OWNED_FIELDS) expect(f in out).toBe(false)
    // 合法欄位存活
    expect(out.id).toBe('B1')
    expect(out.name).toBe('攻擊者')
    expect(out.status).toBe('confirmed')
    expect(out.guests).toBe(2)
  })
})

describe('stripServerOwnedCustomerFields', () => {
  it('剝除 phoneDigits、保留 phone / name', () => {
    const out = stripServerOwnedCustomerFields({ phone: '0912', phoneDigits: 'evil', name: '林' })
    expect('phoneDigits' in out).toBe(false)
    expect(out.phone).toBe('0912')
    expect(out.name).toBe('林')
  })
})

describe('buildBookingUpsertData（merge-upsert 組裝）', () => {
  const now = () => '2026-07-02T00:00:00.000Z'
  const mintToken = () => 'SERVER-MINTED'

  it('新單：伺服器鑄 token（忽略客戶端 token）、初始化 server 欄位、套預設、重算衍生欄位', () => {
    const client = {
      id: 'BNEW', name: '林', phone: '0912-345-678', guests: '5', extraTableIds: [7, 8],
      manageToken: 'CLIENT-HACK', token: 'CLIENT-HACK2', guestEditHistory: [{ x: 1 }],
    }
    const out = buildBookingUpsertData(client, undefined, { now, mintToken })
    expect(out.manageToken).toBe('SERVER-MINTED')
    expect('token' in out).toBe(false) // 舊 token 欄位被剝、不再重建
    expect(out.guestEditHistory).toEqual([]) // 重置、非客戶端帶入
    expect(out.guestEditCount).toBe(0)
    expect(out.createdBy).toBe('staff') // 客戶端未帶 → 預設 staff
    expect(out.createdAt).toBe('2026-07-02T00:00:00.000Z')
    expect(out.status).toBe('confirmed') // 新單預設
    expect(out.phoneDigits).toBe('0912345678') // 由 phone 重算
    expect(out.guests).toBe(5) // Number 化
    expect(out.extraTableIds).toEqual(['7', '8']) // 字串化
    expect(out.updatedAt).toBe('2026-07-02T00:00:00.000Z')
  })

  it('新單：保留客戶端 createdBy / createdAt 提示（離線建立 provenance）', () => {
    const out = buildBookingUpsertData(
      { id: 'B', phone: '0900000000', createdBy: 'guest', createdAt: '2026-06-30T10:00:00.000Z' },
      undefined, { now, mintToken },
    )
    expect(out.createdBy).toBe('guest')
    expect(out.createdAt).toBe('2026-06-30T10:00:00.000Z')
  })

  it('既有單：省略所有 server-owned 欄位（靠 merge 保留既存），套用客戶端合法編輯', () => {
    const stored = { id: 'B1', manageToken: 'REAL-TOKEN', guestEditHistory: [{ a: 1 }], createdAt: '2026-01-01', name: '林' }
    const client = {
      id: 'B1', name: '林小明', phone: '0912345678', guests: 6, status: 'cancelled',
      manageToken: 'HACK', guestEditHistory: [], cancellationReason: { reason: 'evil' }, createdAt: 'evil',
    }
    const out = buildBookingUpsertData(client, stored, { now, mintToken })
    // server-owned 欄位不得出現在 payload → merge:true 保留 Firestore 既存值
    expect('manageToken' in out).toBe(false)
    expect('guestEditHistory' in out).toBe(false)
    expect('cancellationReason' in out).toBe(false)
    expect('createdAt' in out).toBe(false)
    expect('createdBy' in out).toBe(false)
    // 客戶端合法編輯生效
    expect(out.name).toBe('林小明')
    expect(out.guests).toBe(6)
    expect(out.status).toBe('cancelled') // status 為 client-allowed
    expect(out.phoneDigits).toBe('0912345678')
    expect(out.updatedAt).toBe('2026-07-02T00:00:00.000Z')
    expect(out.id).toBe('B1')
  })
})
