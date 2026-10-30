import { describe, it, expect } from 'vitest'
import {
  isTrackedPath, sanitizePath, sanitizeSearch, sanitizeLocation, sanitizeReferrer,
  bookingParams, classifyBookingError, daysAhead,
} from '../../src/utils/analyticsSanitize'

// GA4 清洗：送進 Google 的網址與參數不可帶 manageToken、bookingId、姓名電話。

const ORIGIN = 'https://booking.example.tw'

describe('sanitizePath', () => {
  it('bookingId 換成佔位符', () => {
    expect(sanitizePath('/confirm/B123abc')).toBe('/confirm/:id')
    expect(sanitizePath('/manage/B123abc')).toBe('/manage/:id')
  })
  it('已知客人頁原樣保留', () => {
    expect(sanitizePath('/')).toBe('/')
    expect(sanitizePath('/book')).toBe('/book')
    expect(sanitizePath('/line/bind')).toBe('/line/bind')
  })
  it('未知路徑一律 /(other)，不把路徑內容帶出去', () => {
    expect(sanitizePath('/confirm/B1/extra')).toBe('/(other)')
    expect(sanitizePath('/token-abc123')).toBe('/(other)')
  })
})

describe('isTrackedPath', () => {
  it('後台、登入、demo 不追蹤', () => {
    expect(isTrackedPath('/admin')).toBe(false)
    expect(isTrackedPath('/admin.html')).toBe(false)
    expect(isTrackedPath('/login')).toBe(false)
    expect(isTrackedPath('/demo/slot-map')).toBe(false)
  })
  it('客人頁追蹤', () => {
    expect(isTrackedPath('/book')).toBe(true)
    expect(isTrackedPath('/administrator-like')).toBe(true)
  })
})

describe('sanitizeSearch / sanitizeLocation', () => {
  it('【token 外洩回歸】丟掉 token、payload、bookingId', () => {
    expect(sanitizeSearch('?token=SECRET&payload=xyz&bookingId=B1')).toBe('')
    const loc = sanitizeLocation(ORIGIN, '/confirm/B1', '?token=SECRET')
    expect(loc).toBe(`${ORIGIN}/confirm/:id`)
    expect(loc).not.toContain('SECRET')
    expect(loc).not.toContain('B1')
  })
  it('保留 utm 與 gclid 供來源歸因', () => {
    expect(sanitizeSearch('?utm_source=line&utm_medium=richmenu&token=X&gclid=G1'))
      .toBe('?utm_source=line&utm_medium=richmenu&gclid=G1')
  })
})

describe('sanitizeReferrer', () => {
  it('站外來源只留網域', () => {
    expect(sanitizeReferrer('https://www.google.com/search?q=雞王', ORIGIN)).toBe('https://www.google.com/')
  })
  it('站內來源清洗路徑與 query', () => {
    expect(sanitizeReferrer(`${ORIGIN}/manage/B1?token=SECRET`, ORIGIN)).toBe(`${ORIGIN}/manage/:id`)
  })
  it('空值或壞值回空字串', () => {
    expect(sanitizeReferrer('', ORIGIN)).toBe('')
    expect(sanitizeReferrer('not a url', ORIGIN)).toBe('')
  })
})

describe('bookingParams', () => {
  it('只產生人數、提前天數、星期、時段、午晚餐', () => {
    const p = bookingParams({ guests: 4, date: '2026-11-07', timeSlot: '18:00', name: '王小明', phone: '0912345678' }, '2026-10-31')
    expect(p).toEqual({ party_size: 4, days_ahead: 7, weekday: '週六', time_slot: '18:00', meal_period: 'dinner' })
  })
  it('午餐判定以 15 點為界', () => {
    expect(bookingParams({ timeSlot: '11:30' }, '2026-10-31').meal_period).toBe('lunch')
  })
  it('daysAhead 壞日期回 undefined', () => {
    expect(daysAhead('bad', '2026-10-31')).toBeUndefined()
  })
})

describe('classifyBookingError', () => {
  const e = (status, message = '', extra = {}) => Object.assign(new Error(message), { status, ...extra })
  it('依 status / reasonCode / 訊息分類', () => {
    expect(classifyBookingError(Object.assign(new Error('x'), { code: 'timeout' }))).toBe('timeout')
    expect(classifyBookingError(e(429))).toBe('rate_limited')
    expect(classifyBookingError(e(400, '', { reasonCode: 'booking-deadline-passed' }))).toBe('slot_deadline')
    expect(classifyBookingError(e(409, '您已有相同時段的訂位，無需重複預訂'))).toBe('duplicate')
    expect(classifyBookingError(e(409, '此時段線上訂位已截止（接近滿座），歡迎來電洽詢'))).toBe('auto_closed')
    expect(classifyBookingError(e(409, '此時段目前已無足夠座位，請改選其他時段'))).toBe('full')
    expect(classifyBookingError(e(400, '此時段已關閉訂位，請改選其他時段'))).toBe('slot_closed')
    expect(classifyBookingError(e(503))).toBe('server')
    expect(classifyBookingError(e(undefined, 'Failed to fetch'))).toBe('network')
  })
})
