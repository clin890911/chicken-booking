import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { guestBackendHarness } from '../helpers/guestBackendHarness'
import { sanitizeAttribution } from '../../functions/lib/attribution'

const input = (patch = {}) => ({ submissionKey: crypto.randomBytes(32).toString('hex'), name: '假資料', phone: '0900000000', date: '2026-10-05', timeSlot: '13:00', guests: 2, notes: {}, ...patch })
let h
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 5, 10)); h = guestBackendHarness() })
afterEach(() => vi.useRealTimers())
const books = () => [...h.records].filter(([key]) => key.startsWith('bookings/')).map(([, b]) => b)

describe('sanitizeAttribution', () => {
  it('白名單四欄、轉字串、限長 100、空值不寫、全空回 null', () => {
    expect(sanitizeAttribution({ source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'IwAR1', medium: 'x', __proto__x: 1 }))
      .toEqual({ source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'IwAR1' })
    expect(sanitizeAttribution({ campaign: 'a'.repeat(500) }).campaign).toHaveLength(100)
    expect(sanitizeAttribution({ campaign: 42, content: false })).toEqual({ campaign: '42', content: 'false' })
    expect(sanitizeAttribution({ campaign: { $gt: '' }, content: ['x'], source: '  ' })).toBeNull()
    expect(sanitizeAttribution('fb')).toBeNull()
    expect(sanitizeAttribution(undefined)).toBeNull()
  })
})

describe('guestCreateBooking 記錄 attribution', () => {
  it('帶追蹤碼 → record.attribution 清洗後寫入，source 仍是 online', async () => {
    const r = await h.call('guestCreateBooking', input({ attribution: { source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'x'.repeat(300), evil: 'drop' } }))
    expect(r.code).toBe(200)
    const [b] = books()
    expect(b.source).toBe('online')
    expect(b.attribution).toEqual({ source: 'fb', campaign: 'shanyou', content: 'B-shanxia', fbclid: 'x'.repeat(100) })
  })
  it('沒帶或全空／型別錯 → 不寫 attribution 欄位，也不擋訂位', async () => {
    for (const attribution of [undefined, {}, 'fb', { campaign: { nested: 1 } }]) {
      const r = await h.call('guestCreateBooking', input({ phone: '09' + crypto.randomInt(1e7, 1e8 - 1), attribution }))
      expect(r.code).toBe(200)
    }
    for (const b of books()) expect(b).not.toHaveProperty('attribution')
  })
  it('attribution 不進防重複雜湊：同 key 重送（追蹤碼不同或消失）仍取回原單，不 409', async () => {
    const body = input({ attribution: { source: 'fb', campaign: 'shanyou', content: 'B-shanxia' } })
    const first = await h.call('guestCreateBooking', body)
    const { attribution, ...withoutAttribution } = body
    const retry = await h.call('guestCreateBooking', withoutAttribution)
    const retry2 = await h.call('guestCreateBooking', { ...body, attribution: { content: 'D-shanxia' } })
    expect(attribution).toBeTruthy()
    expect(first.code).toBe(200); expect(retry.code).toBe(200); expect(retry2.code).toBe(200)
    expect(retry.body.recovered).toBe(true)
    expect(books()).toHaveLength(1)
    expect(books()[0].attribution.content).toBe('B-shanxia')
  })
})

describe('後台推送不可改寫 attribution', () => {
  it('attribution 列為 server-owned 欄位', async () => {
    const { BOOKING_SERVER_OWNED_FIELDS, stripServerOwnedBookingFields } = await import('../../functions/lib/dataProjection')
    expect(BOOKING_SERVER_OWNED_FIELDS).toContain('attribution')
    const pushed = stripServerOwnedBookingFields({ id: 'B1', status: 'arrived', attribution: { campaign: 'forged' } })
    expect(pushed).not.toHaveProperty('attribution')
    expect(pushed.status).toBe('arrived')
  })
})
