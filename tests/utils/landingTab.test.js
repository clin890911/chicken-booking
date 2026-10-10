import { describe, it, expect } from 'vitest'
import { resolveAdminTab } from '../../src/utils/landingTab'

// 外場（floor）、領位（host）登入後預設落在「現場」；網址有明確 ?tab= 照網址；其他角色維持「訂位」。
const TABS = ['ops', 'planning', 'bookings', 'roster', 'settings']

describe('resolveAdminTab', () => {
  it.each(['floor', 'host'])('%s：沒有 ?tab= → 現場', (role) => {
    expect(resolveAdminTab(null, role, TABS)).toBe('ops')
    expect(resolveAdminTab('nonsense', role, TABS)).toBe('ops')
  })
  it.each(['manager', 'kitchen', undefined])('%s：沒有 ?tab= → 訂位（維持現狀）', (role) => {
    expect(resolveAdminTab(null, role, TABS)).toBe('bookings')
  })
  it('網址有明確有效 ?tab= → 一律照網址（含外場／領位）', () => {
    expect(resolveAdminTab('bookings', 'floor', TABS)).toBe('bookings')
    expect(resolveAdminTab('settings', 'host', TABS)).toBe('settings')
    expect(resolveAdminTab('ops', 'manager', TABS)).toBe('ops')
  })
})
