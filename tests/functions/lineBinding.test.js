import { describe, it, expect } from 'vitest'
import { buildLineBindingRecord, LINE_BIND_PUSH_DEDUPE_MS } from '../../functions/lib/lineBinding.js'
import { notificationStateHash } from '../../functions/lib/notify.js'

// LINE 綁定 record 組裝（functions/lib/lineBinding.js）。
// lineBind 端點與 guestCreateBooking「訂位即綁定」共用此形狀——這層測試鎖住雙路一致性。

const NOW_MS = Date.parse('2026-06-15T12:00:00+08:00')
const NOW = new Date(NOW_MS).toISOString()

const BOOKING = {
  id: 'B1', manageToken: 'tok-1', name: '王小明', phone: '0912345678',
  guests: 4, date: '2026-06-20', timeSlot: '18:00', status: 'confirmed',
}
const LINE_USER = { userId: 'U-1', displayName: '小綠', pictureUrl: 'https://p.example/x.jpg' }

function build(overrides = {}) {
  return buildLineBindingRecord({
    authBooking: BOOKING,
    manageUrl: 'https://site.example/manage/B1?token=tok-1',
    store: { name: '雞王涮涮鍋' },
    line: LINE_USER,
    existing: null,
    now: NOW,
    nowMs: NOW_MS,
    ...overrides,
  })
}

describe('buildLineBindingRecord', () => {
  it('一般綁定：寫好友旗標清空、首推欄位齊備、stateHash 正確', () => {
    const { record, bookingPatch, needFriend, skipPush } = build()
    expect(needFriend).toBe(false)
    expect(skipPush).toBe(false)
    expect(record.pushBlocked).toBe(false)
    expect(record.lastBindPushAt).toBe(NOW)
    expect(record.lastPushByEvent.confirmed).toEqual({ at: NOW, stateHash: notificationStateHash(BOOKING) })
    expect(record.booking.manageUrl).toBe('https://site.example/manage/B1?token=tok-1')
    expect(bookingPatch).toEqual({
      lineUserId: 'U-1', lineDisplayName: '小綠', linePictureUrl: 'https://p.example/x.jpg',
      linePushBlocked: false, updatedAt: NOW,
    })
  })

  it('needFriend（friendFlag=false）：pushBlocked=not-friend、跳過首推、鏡像 linePushBlocked=true', () => {
    const { record, bookingPatch, needFriend, skipPush } = build({ line: { ...LINE_USER, friendFlag: false } })
    expect(needFriend).toBe(true)
    expect(skipPush).toBe(true)
    expect(record.pushBlocked).toBe(true)
    expect(record.pushBlockedReason).toBe('not-friend')
    expect(record.lastBindPushAt).toBeUndefined()
    expect(record.lastPushByEvent).toBeUndefined()
    expect(bookingPatch.linePushBlocked).toBe(true)
  })

  it('friendFlag 未知（undefined/null）視為可推', () => {
    expect(build({ line: { ...LINE_USER, friendFlag: null } }).skipPush).toBe(false)
    expect(build().skipPush).toBe(false)
  })

  it('10 分鐘內同使用者重複綁定 → recentlyPushed、跳過首推', () => {
    const existing = { lineUserId: 'U-1', lastBindPushAt: new Date(NOW_MS - 5 * 60 * 1000).toISOString() }
    const { recentlyPushed, skipPush, record } = build({ existing })
    expect(recentlyPushed).toBe(true)
    expect(skipPush).toBe(true)
    expect(record.lastBindPushAt).toBeUndefined()
  })

  it('超過防重窗（>10 分鐘）或不同使用者 → 照常推', () => {
    const old = { lineUserId: 'U-1', lastBindPushAt: new Date(NOW_MS - LINE_BIND_PUSH_DEDUPE_MS - 1000).toISOString() }
    expect(build({ existing: old }).recentlyPushed).toBe(false)
    const other = { lineUserId: 'U-other', lastBindPushAt: NOW }
    expect(build({ existing: other }).recentlyPushed).toBe(false)
  })

  it('existing 的 lastPushByEvent 其他事件被保留（merge 不覆蓋）', () => {
    const existing = { lineUserId: 'U-other', lastPushByEvent: { updated: { at: 'x', stateHash: 'h' } } }
    const { record } = build({ existing })
    expect(record.lastPushByEvent.updated).toEqual({ at: 'x', stateHash: 'h' })
    expect(record.lastPushByEvent.confirmed.at).toBe(NOW)
  })

  it('無 manageUrl 時 booking 快照不夾帶空欄位', () => {
    const { record } = build({ manageUrl: '' })
    expect(record.booking.manageUrl).toBeUndefined()
  })
})
