import { describe, it, expect } from 'vitest'
import { normalizeTwMobile, waitlistCallOutboxId, buildWaitlistCallOutbox } from '../../functions/lib/smsPhone.js'

describe('normalizeTwMobile：叫號簡訊只認台灣手機', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['0912-345-678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['+886912345678', '0912345678'],
    ['+886 912 345 678', '0912345678'],
    ['886912345678', '0912345678'],
    ['+886-0912-345-678', '0912345678'],
    ['(0912)345678', '0912345678'],
  ])('%s → %s', (input, out) => expect(normalizeTwMobile(input)).toBe(out))

  it.each([
    ['', '空字串'], ['   ', '空白'], [null, 'null'], [undefined, 'undefined'],
    ['0492753377', '南投市話'], ['049-2753377', '市話含分隔'], ['0227123456', '台北市話'],
    ['091234567', '少一碼'], ['09123456789', '多一碼'], ['0812345678', '非 09'],
    ['+85291234567', '香港門號'], ['abc', '非數字'], [{}, '物件'],
  ])('%s（%s）→ null', input => expect(normalizeTwMobile(input)).toBeNull())
})

describe('buildWaitlistCallOutbox', () => {
  const item = { id: 'W1', queueNumber: 12, phone: '0912-345-678', calledAt: '2026-10-18T04:00:00.000Z' }
  it('id 由 waitlistId＋commandId 決定（重放同 id、不同命令不同 id）', () => {
    expect(waitlistCallOutboxId('W1', 'c1')).toBe(waitlistCallOutboxId('W1', 'c1'))
    expect(waitlistCallOutboxId('W1', 'c1')).not.toBe(waitlistCallOutboxId('W1', 'c2'))
    expect(waitlistCallOutboxId('W1', 'c1')).toMatch(/^wl_call_[0-9a-f]{40}$/)
  })
  it('有手機才產生；內容只含送出端需要的欄位、狀態 pending', () => {
    const r = buildWaitlistCallOutbox({ item, commandId: 'c1', now: item.calledAt })
    expect(r.id).toBe(waitlistCallOutboxId('W1', 'c1'))
    expect(r.data).toMatchObject({ kind: 'waitlist-call', waitlistId: 'W1', commandId: 'c1', queueNumber: 12, calledAt: item.calledAt, to: '0912345678', status: 'pending', attempts: 0 })
    expect(buildWaitlistCallOutbox({ item: { ...item, phone: '049-2753377' }, commandId: 'c1', now: item.calledAt })).toBeNull()
    expect(buildWaitlistCallOutbox({ item: { ...item, phone: '' }, commandId: 'c1', now: item.calledAt })).toBeNull()
  })
})
