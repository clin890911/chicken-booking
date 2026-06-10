import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generateTimeSlots,
  formatDate,
  todayStr,
  addDays,
  isPast,
  dayLabel,
  bookingDayKind,
} from '../../src/utils/timeSlots'

// Per instructions: fix system time to 2026-06-15 12:00 local for any
// function that internally reads the current system time.
const FIXED_NOW = new Date(2026, 5, 15, 12, 0, 0) // 2026-06-15 12:00 local

describe('generateTimeSlots', () => {
  it('uses default args (11:00-19:00, 30 min) when called with no arguments', () => {
    const slots = generateTimeSlots()
    expect(slots[0]).toBe('11:00')
    expect(slots[slots.length - 1]).toBe('19:00')
    // 11:00 .. 19:00 inclusive at 30 min steps => 17 slots
    expect(slots).toHaveLength(17)
    expect(slots).toContain('11:30')
    expect(slots).toContain('12:00')
    expect(slots).toContain('18:30')
  })

  it('includes closeTime when it falls exactly on an interval boundary', () => {
    const slots = generateTimeSlots('09:00', '10:00', 30)
    expect(slots).toEqual(['09:00', '09:30', '10:00'])
  })

  it('does NOT include closeTime when it does not fall on an interval boundary', () => {
    // open 09:00, close 10:10, interval 30 => 09:00, 09:30, 10:00 (10:30 > end)
    const slots = generateTimeSlots('09:00', '10:10', 30)
    expect(slots).toEqual(['09:00', '09:30', '10:00'])
    expect(slots).not.toContain('10:10')
    expect(slots).not.toContain('10:30')
  })

  it('stops at the last interval <= closeTime when interval overshoots', () => {
    // open 09:00, close 09:59, interval 30 => 09:00, 09:30 (10:00 > 09:59)
    const slots = generateTimeSlots('09:00', '09:59', 30)
    expect(slots).toEqual(['09:00', '09:30'])
  })

  it('crosses the top of the hour correctly (minutes wrap)', () => {
    // open 11:45, close 12:30, interval 15 => 11:45, 12:00, 12:15, 12:30
    const slots = generateTimeSlots('11:45', '12:30', 15)
    expect(slots).toEqual(['11:45', '12:00', '12:15', '12:30'])
  })

  it('zero-pads hours and minutes to two digits', () => {
    const slots = generateTimeSlots('09:05', '09:05', 30)
    expect(slots).toEqual(['09:05'])
    // single-digit hour padded
    expect(slots[0]).toMatch(/^\d{2}:\d{2}$/)
  })

  it('returns a single slot when open and close are equal', () => {
    const slots = generateTimeSlots('11:00', '11:00', 30)
    expect(slots).toEqual(['11:00'])
  })

  it('returns an empty array when closeTime is before openTime', () => {
    const slots = generateTimeSlots('19:00', '11:00', 30)
    expect(slots).toEqual([])
  })

  it('supports custom interval such as 60 minutes (whole hours)', () => {
    const slots = generateTimeSlots('11:00', '14:00', 60)
    expect(slots).toEqual(['11:00', '12:00', '13:00', '14:00'])
  })

  it('supports an arbitrary interval like 45 minutes', () => {
    const slots = generateTimeSlots('10:00', '11:30', 45)
    expect(slots).toEqual(['10:00', '10:45', '11:30'])
  })

  it('handles a long full-day range spanning many hours', () => {
    const slots = generateTimeSlots('00:00', '23:30', 30)
    expect(slots[0]).toBe('00:00')
    expect(slots[slots.length - 1]).toBe('23:30')
    // 00:00 .. 23:30 inclusive at 30 min => 48 slots
    expect(slots).toHaveLength(48)
    expect(slots).toContain('00:30')
    expect(slots).toContain('23:00')
  })
})

describe('formatDate', () => {
  it('returns the string unchanged when given a string', () => {
    expect(formatDate('2026-06-15')).toBe('2026-06-15')
    expect(formatDate('anything')).toBe('anything')
    expect(formatDate('')).toBe('')
  })

  it('formats a Date into YYYY-MM-DD using local date parts', () => {
    const d = new Date(2026, 5, 15) // June 15, 2026 local
    expect(formatDate(d)).toBe('2026-06-15')
  })

  it('zero-pads single-digit month and day', () => {
    const d = new Date(2026, 0, 3) // Jan 3, 2026
    expect(formatDate(d)).toBe('2026-01-03')
  })

  it('handles December (month index 11 => 12)', () => {
    const d = new Date(2026, 11, 31)
    expect(formatDate(d)).toBe('2026-12-31')
  })

  it('uses local time parts, not UTC (a Date constructed with local parts round-trips)', () => {
    const d = new Date(2026, 1, 1) // Feb 1, 2026 local
    expect(formatDate(d)).toBe('2026-02-01')
  })
})

describe('todayStr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the current local date formatted as YYYY-MM-DD', () => {
    expect(todayStr()).toBe('2026-06-15')
  })

  it('reflects a changed system time', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0))
    expect(todayStr()).toBe('2026-01-01')
  })
})

describe('addDays', () => {
  it('adds a positive number of days within the same month', () => {
    const base = new Date(2026, 5, 15)
    const r = addDays(base, 3)
    expect(formatDate(r)).toBe('2026-06-18')
  })

  it('subtracts days with a negative input', () => {
    const base = new Date(2026, 5, 15)
    const r = addDays(base, -5)
    expect(formatDate(r)).toBe('2026-06-10')
  })

  it('returns an equivalent date when adding 0 days', () => {
    const base = new Date(2026, 5, 15)
    const r = addDays(base, 0)
    expect(formatDate(r)).toBe('2026-06-15')
  })

  it('rolls over to the next month (June has 30 days)', () => {
    const base = new Date(2026, 5, 28) // 2026-06-28
    const r = addDays(base, 5)
    expect(formatDate(r)).toBe('2026-07-03')
  })

  it('rolls over to the next year across December', () => {
    const base = new Date(2026, 11, 30) // 2026-12-30
    const r = addDays(base, 3)
    expect(formatDate(r)).toBe('2027-01-02')
  })

  it('rolls backward across a month boundary', () => {
    const base = new Date(2026, 6, 2) // 2026-07-02
    const r = addDays(base, -4)
    expect(formatDate(r)).toBe('2026-06-28')
  })

  it('does not mutate the original Date', () => {
    const base = new Date(2026, 5, 15)
    addDays(base, 10)
    expect(formatDate(base)).toBe('2026-06-15')
  })

  it('returns a new Date instance', () => {
    const base = new Date(2026, 5, 15)
    const r = addDays(base, 1)
    expect(r).toBeInstanceOf(Date)
    expect(r).not.toBe(base)
  })

  it('accepts a date string as input (Date is constructed from it)', () => {
    const r = addDays('2026-06-15T00:00:00', 1)
    expect(formatDate(r)).toBe('2026-06-16')
  })

  it('handles a large day offset spanning multiple months', () => {
    const base = new Date(2026, 0, 1) // 2026-01-01
    const r = addDays(base, 90)
    expect(formatDate(r)).toBe('2026-04-01')
  })
})

describe('isPast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW) // today = 2026-06-15
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for a date string strictly before today', () => {
    expect(isPast('2026-06-14')).toBe(true)
  })

  it('returns false for today (boundary - not in the past)', () => {
    expect(isPast('2026-06-15')).toBe(false)
  })

  it('returns false for a future date string', () => {
    expect(isPast('2026-06-16')).toBe(false)
  })

  it('returns true for a date in a previous month', () => {
    expect(isPast('2026-05-31')).toBe(true)
  })

  it('returns true for a date in a previous year', () => {
    expect(isPast('2025-12-31')).toBe(true)
  })

  it('returns false for a date in a future year', () => {
    expect(isPast('2027-01-01')).toBe(false)
  })

  it('compares via lexicographic string ordering of YYYY-MM-DD', () => {
    // relies on zero-padded YYYY-MM-DD ordering matching chronological order
    expect(isPast('2026-06-09')).toBe(true) // 09 < 15 lexicographically and chronologically
    expect(isPast('2026-06-20')).toBe(false)
  })
})

describe('dayLabel', () => {
  it('formats month/day with the correct Chinese weekday for a Monday', () => {
    // 2026-06-15 is a Monday
    expect(dayLabel('2026-06-15')).toBe('6/15 (一)')
  })

  it('maps Sunday to 日', () => {
    // 2026-06-14 is a Sunday
    expect(dayLabel('2026-06-14')).toBe('6/14 (日)')
  })

  it('maps Saturday to 六', () => {
    // 2026-06-20 is a Saturday
    expect(dayLabel('2026-06-20')).toBe('6/20 (六)')
  })

  it('covers all weekday labels across a contiguous week', () => {
    // Sun 6/14 .. Sat 6/20 2026
    expect(dayLabel('2026-06-14')).toBe('6/14 (日)')
    expect(dayLabel('2026-06-15')).toBe('6/15 (一)')
    expect(dayLabel('2026-06-16')).toBe('6/16 (二)')
    expect(dayLabel('2026-06-17')).toBe('6/17 (三)')
    expect(dayLabel('2026-06-18')).toBe('6/18 (四)')
    expect(dayLabel('2026-06-19')).toBe('6/19 (五)')
    expect(dayLabel('2026-06-20')).toBe('6/20 (六)')
  })

  it('does not zero-pad month or day in the label', () => {
    // January 5, 2026 -> "1/5" not "01/05"
    expect(dayLabel('2026-01-05')).toMatch(/^1\/5 \(.\)$/)
  })

  it('parses the date at local midnight (T00:00:00) so the day does not shift', () => {
    // 2026-12-31 is a Thursday
    expect(dayLabel('2026-12-31')).toBe('12/31 (四)')
  })

  it('handles the first day of a month', () => {
    // 2026-06-01 is a Monday
    expect(dayLabel('2026-06-01')).toBe('6/1 (一)')
  })
})

describe('bookingDayKind', () => {
  const TODAY = '2026-06-15'

  it('過去 / 今天 / 未來 三態', () => {
    expect(bookingDayKind('2026-06-14', TODAY)).toBe('past')
    expect(bookingDayKind('2026-06-15', TODAY)).toBe('today')
    expect(bookingDayKind('2026-06-16', TODAY)).toBe('future')
  })

  it('跨月/跨年比較正確（字典序即日期序）', () => {
    expect(bookingDayKind('2026-05-31', TODAY)).toBe('past')
    expect(bookingDayKind('2026-07-01', TODAY)).toBe('future')
    expect(bookingDayKind('2025-12-31', TODAY)).toBe('past')
    expect(bookingDayKind('2027-01-01', TODAY)).toBe('future')
  })

  it('無 date 視為今天（舊資料防呆）', () => {
    expect(bookingDayKind(undefined, TODAY)).toBe('today')
    expect(bookingDayKind('', TODAY)).toBe('today')
    expect(bookingDayKind(null, TODAY)).toBe('today')
  })
})
