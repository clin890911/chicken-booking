import { describe, it, expect } from 'vitest'
import { normalizeBookingId, bookingIdEquals, searchBookings } from '../../src/utils/bookingId'

describe('normalizeBookingId', () => {
  it('uppercases lowercase input (frontend fallback uid vs backend uppercase)', () => {
    expect(normalizeBookingId('bmq60m3900491')).toBe('BMQ60M3900491')
  })

  it('keeps an already-normalized code unchanged', () => {
    expect(normalizeBookingId('BMQ60M3900491')).toBe('BMQ60M3900491')
  })

  it('strips leading/trailing whitespace', () => {
    expect(normalizeBookingId('  BMQ60M3900491 ')).toBe('BMQ60M3900491')
  })

  it('strips internal whitespace (pasted with spaces)', () => {
    expect(normalizeBookingId('BMQ60M39 00491')).toBe('BMQ60M3900491')
  })

  it('strips full-width space (U+3000)', () => {
    expect(normalizeBookingId('BMQ60M39　00491')).toBe('BMQ60M3900491')
  })

  it('strips newlines and tabs', () => {
    expect(normalizeBookingId('BMQ60M39\n\t00491')).toBe('BMQ60M3900491')
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(normalizeBookingId(null)).toBe('')
    expect(normalizeBookingId(undefined)).toBe('')
    expect(normalizeBookingId('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeBookingId('   　 ')).toBe('')
  })

  it('coerces a number to a string', () => {
    expect(normalizeBookingId(123)).toBe('123')
  })
})

describe('bookingIdEquals', () => {
  it('matches identical codes', () => {
    expect(bookingIdEquals('BMQ60M3900491', 'BMQ60M3900491')).toBe(true)
  })

  it('matches case-insensitively (frontend mixed-case vs backend uppercase)', () => {
    expect(bookingIdEquals('Bmov3k9XY2', 'BMOV3K9XY2')).toBe(true)
  })

  it('matches after stripping whitespace on either side', () => {
    expect(bookingIdEquals(' bmq60m3900491 ', 'BMQ60M39　00491')).toBe(true)
  })

  it('returns false when codes differ', () => {
    expect(bookingIdEquals('BMQ60M3900491', 'BMQ60M3900492')).toBe(false)
  })

  it('returns false when either side is empty', () => {
    expect(bookingIdEquals('', 'BMQ60M3900491')).toBe(false)
    expect(bookingIdEquals('BMQ60M3900491', '')).toBe(false)
    expect(bookingIdEquals('', '')).toBe(false)
    expect(bookingIdEquals(null, undefined)).toBe(false)
  })
})

describe('searchBookings', () => {
  const today = '2026-06-09'
  const future = '2026-06-20'
  const past = '2026-05-01'
  const bookings = [
    { id: 'BMQ60M3900491', name: '林小明', phone: '0939328314', date: future, timeSlot: '18:00', status: 'confirmed' },
    { id: 'BPAST0001AAAA', name: '林小華', phone: '0911222333', date: past, timeSlot: '12:00', status: 'completed' },
    { id: 'BCANCEL01ZZZZ', name: '王取消', phone: '0922000111', date: today, timeSlot: '19:00', status: 'cancelled' },
    { id: 'BTODAYXX1111A', name: '陳今日', phone: '0933444555', date: today, timeSlot: '11:00', status: 'confirmed' },
    { id: 'BTODAYXX2222B', name: '陳今日', phone: '0966777888', date: today, timeSlot: '13:00', status: 'arrived' },
  ]

  it('returns [] for empty/whitespace query', () => {
    expect(searchBookings(bookings, '')).toEqual([])
    expect(searchBookings(bookings, '   ')).toEqual([])
    expect(searchBookings(bookings, null)).toEqual([])
  })

  it('returns [] when given a non-array bookings argument', () => {
    expect(searchBookings(null, 'BMQ60M3900491')).toEqual([])
    expect(searchBookings(undefined, 'BMQ60M3900491')).toEqual([])
  })

  it('finds a booking by exact code', () => {
    const r = searchBookings(bookings, 'BMQ60M3900491')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('BMQ60M3900491')
  })

  it('finds a booking by code case-insensitively', () => {
    const r = searchBookings(bookings, 'bmq60m3900491')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('BMQ60M3900491')
  })

  it('finds a booking when the code is pasted with surrounding/internal spaces', () => {
    const r = searchBookings(bookings, '  bmq60m39 00491 ')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('BMQ60M3900491')
  })

  it('finds a booking by partial code prefix', () => {
    const r = searchBookings(bookings, 'BTODAY')
    expect(r.map(b => b.id).sort()).toEqual(['BTODAYXX1111A', 'BTODAYXX2222B'])
  })

  it('does not match every code on a single letter (b)', () => {
    // 'b' alone must not pull in all B-prefixed ids (would also match no name → empty)
    expect(searchBookings(bookings, 'b')).toEqual([])
  })

  it('finds bookings by name (may return multiple same-name with distinct ids)', () => {
    const r = searchBookings(bookings, '陳今日')
    expect(r).toHaveLength(2)
    expect(r.map(b => b.id).sort()).toEqual(['BTODAYXX1111A', 'BTODAYXX2222B'])
  })

  it('finds a booking by phone digits, ignoring non-digits in the query', () => {
    const r = searchBookings(bookings, '0939-328-314')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('BMQ60M3900491')
  })

  it('does not match phone on fewer than 3 digits', () => {
    expect(searchBookings(bookings, '09')).toEqual([])
  })

  it('includes cancelled bookings by default (staff checking if it was cancelled)', () => {
    const r = searchBookings(bookings, 'BCANCEL01ZZZZ')
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe('cancelled')
  })

  it('includes completed/historical bookings (not filtered by status)', () => {
    const r = searchBookings(bookings, 'BPAST0001AAAA')
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe('completed')
  })

  it('excludes cancelled when includeCancelled=false', () => {
    const r = searchBookings(bookings, 'BCANCEL01ZZZZ', { includeCancelled: false })
    expect(r).toEqual([])
  })

  it('sorts results by date newest-first, then timeSlot ascending', () => {
    // 陳今日 (two same-day) + 林 names share nothing; query a substring matching multiple dates
    const r = searchBookings(bookings, '林')
    // 林小明 future (2026-06-20) should come before 林小華 past (2026-05-01)
    expect(r.map(b => b.id)).toEqual(['BMQ60M3900491', 'BPAST0001AAAA'])
  })

  it('orders same-day matches by timeSlot ascending', () => {
    const r = searchBookings(bookings, '陳今日')
    expect(r.map(b => b.timeSlot)).toEqual(['11:00', '13:00'])
  })
})
