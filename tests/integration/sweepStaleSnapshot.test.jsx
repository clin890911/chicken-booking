import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { INITIAL_TABLES } from '../../src/data/tables'

// R4：iPad 喚醒／離線開機時，自動掃除不可基於舊的本機快照清桌。
// Firebase 模式下距上次「拉取成功」超過 10 秒就整輪不跑；20 秒離線 fallback 也不得清桌。
// 雲端呼叫整個 mock 掉（不打任何網路）；掛真正的 BookingProvider 走真實的 runSweeps 編排。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  auth: null,
  pullFails: true,
  pulls: 0,
  toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {}, action: () => {} },
}))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => h.toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/services/cloudDataService', () => ({
  setAuthTokenProvider: () => {},
  pullCloudData: async () => { h.pulls += 1; if (h.pullFails) throw new TypeError('Failed to fetch'); return {} },
  applyCloudSnapshot: () => {},
  hasPulledCloud: () => true,
  pushChangedData: async () => ({ ok: true, skipped: true }),
  isSyncPersistDegraded: () => false,
  operationalRequest: async () => ({ items: [] }),
  discardRejectedChanges: () => {},
  markLocalAsSynced: () => {},
  pushCloudData: async () => ({ ok: true }),
  localDataset: () => ({}),
}))

const NOW = new Date(2026, 9, 9, 18, 0, 0)
const TODAY = '2026-10-09'

function seedOvertimeTable() {
  // 本機快照：101 用餐 6 小時（超過預設 5 小時）→ 超時掃除會 finalize 釋桌。
  const tables = JSON.parse(JSON.stringify(INITIAL_TABLES))
  Object.assign(tables[0], { status: 'dining', currentBookingId: 'b-old', currentRef: null,
    seatedAt: new Date(NOW.getTime() - 6 * 3600_000).toISOString() })
  localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'b-old', name: '林先生', phone: '0911000111',
    guests: 2, date: TODAY, timeSlot: '12:00', status: 'arrived', assignedTableId: tables[0].number, source: 'walkin' }]))
  return tables[0].number
}

const tableStatus = (n) => JSON.parse(localStorage.getItem('chicken_tables_v3')).find(t => t.number === n).status

describe('R4 掃除快照新鮮度閘門（Firebase 模式）', { timeout: 30_000 }, () => {
  let root
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    h.pullFails = true
    h.pulls = 0
  })
  afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = null
    vi.useRealTimers()
  })

  async function mount(usingFirebase) {
    h.auth = { user: { email: 'm@example.invalid', role: 'manager' }, getToken: async () => 't', usingFirebase, can: () => true }
    const { BookingProvider } = await import('../../src/contexts/BookingContext')
    root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<BookingProvider><div /></BookingProvider>) })
  }

  it('離線開機：20 秒 fallback 不清桌；拉取成功後那一輪才照常釋桌', async () => {
    const n = seedOvertimeTable()
    await mount(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000) })
    expect(h.pulls).toBeGreaterThan(0)
    expect(tableStatus(n)).toBe('dining')          // ★ 舊快照不得清桌

    h.pullFails = false
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })   // 下一次 5 秒輪詢拉取成功
    expect(tableStatus(n)).toBe('vacant')          // 新鮮快照 → 超時釋桌照常
  })

  it('非 Firebase（本機模式）行為不變：開機即掃', async () => {
    const n = seedOvertimeTable()
    await mount(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(tableStatus(n)).toBe('vacant')
  })
})
