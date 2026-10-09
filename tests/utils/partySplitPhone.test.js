import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeSplit, guestSplit, splitSuffix, splitFields } from '../../src/utils/partySplit'
import { formatPhone, telHref } from '../../src/utils/phoneFormat'
import * as bookingService from '../../src/services/bookingService'
import * as waitlistService from '../../src/services/waitlistService'

describe('partySplit 大人／小孩', () => {
  it('normalizeSplit：大人＝總數−小孩，至少 1 位大人，小孩不為負', () => {
    expect(normalizeSplit(5, 2)).toEqual({ adults: 3, children: 2 })
    expect(normalizeSplit(5, 0)).toEqual({ adults: 5, children: 0 })
    expect(normalizeSplit(3, 9)).toEqual({ adults: 1, children: 2 })
    expect(normalizeSplit(4, -1)).toEqual({ adults: 4, children: 0 })
    expect(normalizeSplit(0, 0)).toEqual({ adults: 1, children: 0 })
  })

  it('guestSplit：舊單（無拆分）視為全大人；訂位讀 guests、候位讀 partySize', () => {
    expect(guestSplit({ guests: 4 })).toEqual({ adults: 4, children: 0 })
    expect(guestSplit({ guests: 5, adults: 3, children: 2 })).toEqual({ adults: 3, children: 2 })
    expect(guestSplit({ partySize: 6, children: 1 })).toEqual({ adults: 5, children: 1 })
    // 只改了總數（例如客人線上改人數）而拆分舊了 → 以總數為準、用小孩回推大人
    expect(guestSplit({ guests: 6, adults: 3, children: 2 })).toEqual({ adults: 4, children: 2 })
  })

  it('splitSuffix：有小孩才附「（大3・小2）」', () => {
    expect(splitSuffix({ guests: 5, adults: 3, children: 2 })).toBe('（大3・小2）')
    expect(splitSuffix({ guests: 4 })).toBe('')
    expect(splitSuffix({ guests: 4, adults: 4, children: 0 })).toBe('')
  })

  it('splitFields：無小孩不寫欄位；force（原單有拆分）可寫回 0', () => {
    expect(splitFields(4, 0)).toEqual({})
    expect(splitFields(4, 1)).toEqual({ adults: 3, children: 1 })
    expect(splitFields(4, 0, { force: true })).toEqual({ adults: 4, children: 0 })
  })
})

describe('service 寫入保持 guests/partySize = adults + children', () => {
  beforeEach(() => localStorage.clear())

  it('bookingService.create：帶 children 寫入拆分，guests 為總數', () => {
    const b = bookingService.create({ name: '王', phone: '', guests: 5, children: 2, date: '2026-10-09', timeSlot: '18:00' })
    expect(b).toMatchObject({ guests: 5, adults: 3, children: 2 })
    const plain = bookingService.create({ name: '李', phone: '', guests: 4, date: '2026-10-09', timeSlot: '18:00' })
    expect(plain.guests).toBe(4)
    expect('children' in plain).toBe(false)
    expect('adults' in plain).toBe(false)
  })

  it('waitlistService.create：帶 children 寫入拆分，partySize 為總數', () => {
    const w = waitlistService.create({ name: '陳', partySize: 4, children: 1 })
    expect(w).toMatchObject({ partySize: 4, adults: 3, children: 1 })
    expect('children' in waitlistService.create({ name: '林', partySize: 2 })).toBe(false)
  })
})

describe('formatPhone 電話格式化', () => {
  it('手機 4-3-3', () => {
    expect(formatPhone('0912345678')).toBe('0912-345-678')
    expect(formatPhone('0912-345-678')).toBe('0912-345-678')
    expect(formatPhone(' 0912 345 678 ')).toBe('0912-345-678')
  })
  it('市話：02/04 為 2-4-4，3 碼區碼 3-3-4，9 碼 2-3-4', () => {
    expect(formatPhone('0223456789')).toBe('02-2345-6789')
    expect(formatPhone('0423456789')).toBe('04-2345-6789')
    expect(formatPhone('0492775678')).toBe('049-277-5678')
    expect(formatPhone('031234567')).toBe('03-123-4567')
    expect(formatPhone('037123456')).toBe('037-123-456')
  })
  it('無法辨識的長度／國際號碼原樣；空值回空字串', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('+886912345678')).toBe('+886912345678')
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
  })
  it('telHref 只留數字與 +', () => {
    expect(telHref('0912-345-678')).toBe('tel:0912345678')
    expect(telHref('+886 912')).toBe('tel:+886912')
    expect(telHref('')).toBe('')
  })
})
