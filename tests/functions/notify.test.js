import { describe, it, expect } from 'vitest'
import {
  notificationStateHash,
  shouldSkipDuplicatePush,
  isRetryableLineStatus,
  dayLabelServer,
  buildManageUrl,
  LINE_PUSH_DEDUPE_WINDOW_MS,
} from '../../functions/lib/notify.js'

// 後端 LINE 通知純邏輯（functions/lib/notify.js）。
// 這層擋的是兩個生產事故型 bug：
// 1) 部署共存窗口（新後端＋舊前端）重複推播 → 防重指紋
// 2) 非好友/封鎖的 push 重試 6 次塞爆 dead-letter → 可重試性判斷

describe('notificationStateHash', () => {
  const base = { date: '2026-06-15', timeSlot: '18:00', guests: 4, status: 'confirmed' }

  it('相同關鍵欄位 → 相同指紋', () => {
    expect(notificationStateHash({ ...base })).toBe(notificationStateHash({ ...base, name: '別人', notes: { pet: true } }))
  })

  it.each([
    ['date', { date: '2026-06-16' }],
    ['timeSlot', { timeSlot: '18:30' }],
    ['guests', { guests: 5 }],
    ['status', { status: 'cancelled' }],
  ])('%s 改變 → 指紋改變', (_key, patch) => {
    expect(notificationStateHash({ ...base, ...patch })).not.toBe(notificationStateHash(base))
  })

  it('空 booking 不丟例外', () => {
    expect(notificationStateHash()).toBe('|||')
  })
})

describe('shouldSkipDuplicatePush', () => {
  const NOW = Date.parse('2026-06-15T10:00:00Z')
  const hash = 'd|t|4|confirmed'
  const recent = { updated: { at: new Date(NOW - 30_000).toISOString(), stateHash: hash } }

  it('同 event 同指紋且在窗口內 → 跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', hash, NOW)).toBe(true)
  })

  it('指紋不同（客人又改了內容）→ 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', 'other-hash', NOW)).toBe(false)
  })

  it('不同 event → 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'cancelled', hash, NOW)).toBe(false)
  })

  it('超過窗口 → 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', hash, NOW + LINE_PUSH_DEDUPE_WINDOW_MS + 1)).toBe(false)
  })

  it('無紀錄 / 壞時間戳 → 不跳過', () => {
    expect(shouldSkipDuplicatePush(undefined, 'updated', hash, NOW)).toBe(false)
    expect(shouldSkipDuplicatePush({}, 'updated', hash, NOW)).toBe(false)
    expect(shouldSkipDuplicatePush({ updated: { at: 'not-a-date', stateHash: hash } }, 'updated', hash, NOW)).toBe(false)
  })
})

describe('isRetryableLineStatus', () => {
  it.each([400, 403, 404])('%i（封鎖/非好友/壞請求）→ 不重試', status => {
    expect(isRetryableLineStatus(status)).toBe(false)
  })

  it.each([429, 500, 502, 503])('%i（限流/伺服器錯）→ 重試', status => {
    expect(isRetryableLineStatus(status)).toBe(true)
  })

  it('無 HTTP 狀態（逾時/網路錯誤）→ 重試', () => {
    expect(isRetryableLineStatus(undefined)).toBe(true)
    expect(isRetryableLineStatus('timeout')).toBe(true)
  })
})

describe('dayLabelServer', () => {
  it('輸出與前端 dayLabel 同格式（2026-01-01 是週四）', () => {
    expect(dayLabelServer('2026-01-01')).toBe('1/1 (四)')
  })

  it('無效日期回傳原字串，不丟例外', () => {
    expect(dayLabelServer('not-a-date')).toBe('not-a-date')
    expect(dayLabelServer('')).toBe('')
  })
})

describe('buildManageUrl', () => {
  it('組出管理連結並編碼 token', () => {
    expect(buildManageUrl('https://example.com', 'B123', 'tok+/=')).toBe(
      'https://example.com/manage/B123?token=tok%2B%2F%3D',
    )
  })

  it('容忍結尾斜線', () => {
    expect(buildManageUrl('https://example.com/', 'B123', 'tok')).toBe('https://example.com/manage/B123?token=tok')
  })

  it('publicSiteUrl 未設定或非 http(s) → 回空字串（Flex 卡片直接略過按鈕）', () => {
    expect(buildManageUrl('', 'B123', 'tok')).toBe('')
    expect(buildManageUrl('javascript:alert(1)', 'B123', 'tok')).toBe('')
    expect(buildManageUrl('https://example.com', '', 'tok')).toBe('')
    expect(buildManageUrl('https://example.com', 'B123', '')).toBe('')
  })
})
