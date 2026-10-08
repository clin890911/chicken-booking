import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// F4：推送失敗（弱網／逾時）後，連線恢復（下一次拉取成功）要主動補推，燈號不可先被拉取洗成 synced。
// 雲端呼叫整個 mock 掉（不打任何網路）；掛真正的 BookingProvider 走真實的 pullCloud／syncCloudSoon。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  auth: null,
  pushes: 0,
  pushFailsLeft: 0,
  pushTimes: [],
  failWith: null,
  hangMs: 0,
  active: 0,
  maxActive: 0,
  applyResult: undefined,
  toastErrors: [],
  toast: { success: () => {}, error: (m) => h.toastErrors.push(m), warning: () => {}, info: () => {}, action: () => {} },
}))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => h.toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/services/cloudDataService', () => ({
  setAuthTokenProvider: () => {},
  pullCloudData: async () => ({}),
  applyCloudSnapshot: () => h.applyResult,
  hasPulledCloud: () => true,
  pushChangedData: async () => {
    h.pushes += 1
    h.pushTimes.push(Date.now())
    h.active += 1
    h.maxActive = Math.max(h.maxActive, h.active)
    try {
      if (h.hangMs) await new Promise(r => setTimeout(r, h.hangMs))   // 模擬弱網：掛住到逾時
    } finally { h.active -= 1 }
    if (h.failWith) throw h.failWith()
    if (h.pushFailsLeft > 0) { h.pushFailsLeft -= 1; throw new Error('連線逾時，請檢查網路後重試') }
    return { ok: true }
  },
  isSyncPersistDegraded: () => false,
  operationalRequest: async () => ({ items: [] }),
  discardRejectedChanges: () => {},
  markLocalAsSynced: () => {},
  pushCloudData: async () => ({ ok: true }),
  localDataset: () => ({}),
}))

describe('F4 推送失敗後的補推與燈號', () => {
  let root
  const ref = { ctx: null }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date(2026, 9, 9, 12, 0, 0))
    localStorage.clear()
    h.pushes = 0
    h.pushFailsLeft = 0
    h.pushTimes = []
    h.failWith = null
    h.hangMs = 0
    h.active = 0
    h.maxActive = 0
    h.applyResult = undefined
    h.toastErrors = []
  })
  afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = null
    vi.useRealTimers()
  })

  async function mount() {
    h.auth = { user: { email: 'm@example.invalid', role: 'manager' }, getToken: async () => 't', usingFirebase: true, can: () => true }
    const { BookingProvider, useBooking } = await import('../../src/contexts/BookingContext')
    function Probe() { ref.ctx = useBooking(); return null }
    root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<BookingProvider><Probe /></BookingProvider>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  }

  it('推送失敗 → 拉取成功時燈號仍非 synced → 自動補推成功才 synced', async () => {
    await mount()
    expect(ref.ctx.cloudStatus.state).toBe('synced')
    const n = ref.ctx.tables[0].number
    h.pushFailsLeft = 1
    await act(async () => { ref.ctx.blockTable(n, '測試') })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })   // 250ms 節流推送 → 失敗
    expect(h.pushes).toBe(1)
    expect(ref.ctx.cloudStatus.state).toBe('offline')

    await act(async () => { await vi.advanceTimersByTimeAsync(4_750) })   // t≈5.06s：輪詢拉取成功
    expect(ref.ctx.cloudStatus.state).not.toBe('synced')                 // ★ 不可被拉取洗成 synced
    expect(h.pushes).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })   // 拉取後主動補推
    expect(h.pushes).toBe(2)
    expect(ref.ctx.cloudStatus.state).toBe('synced')
  })

  const httpError = (status, code) => () => Object.assign(new Error(code), { status, code })
  const failOnce = async () => {
    const n = ref.ctx.tables[0].number
    await act(async () => { ref.ctx.blockTable(n, '測試') })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  }

  it('持續 500：補推間隔遞增（5→10→30→60 秒、上限 60），錯誤 toast 只跳一次', async () => {
    await mount()
    h.failWith = httpError(500, 'admin-push-failed')
    await failOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000) })
    const gaps = h.pushTimes.slice(1).map((t, i) => t - h.pushTimes[i])
    expect(gaps.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1])
    expect(gaps[0]).toBeLessThanOrEqual(6_000)                     // 第一次約 5 秒
    expect(gaps[2]).toBeGreaterThanOrEqual(29_000)                 // 第三次 ≥30 秒
    expect(Math.max(...gaps)).toBeLessThanOrEqual(61_000)          // 上限 60 秒（＋拉取顆粒度）
    expect(h.toastErrors).toHaveLength(1)                          // ★ 自動補推同一種錯誤不重跳
  })

  it('413（其他 4xx）：拉取成功後不自動補推，等店員下一個動作', async () => {
    await mount()
    h.failWith = httpError(413, 'operational-sync-too-large')
    await failOnce()
    expect(h.pushes).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(h.pushes).toBe(1)
    expect(ref.ctx.cloudStatus.state).toBe('offline')              // 燈號仍誠實顯示沒上雲
  })

  it('成功一次後退避歸零：之後再失敗，又從 5 秒開始', async () => {
    await mount()
    h.failWith = httpError(503, 'unavailable')
    await failOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000) })   // 已退避到 30 秒那一級
    const before = h.pushes
    expect(before).toBeGreaterThanOrEqual(3)
    h.failWith = null
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000) })   // 下一次補推（≤60 秒）成功
    expect(ref.ctx.cloudStatus.state).toBe('synced')
    h.failWith = httpError(503, 'unavailable')
    const t0 = Date.now()
    await failOnce()
    const failedAt = h.pushTimes[h.pushTimes.length - 1]
    expect(failedAt).toBeGreaterThanOrEqual(t0)
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(h.pushTimes[h.pushTimes.length - 1] - failedAt).toBeLessThanOrEqual(6_000)   // ★ 回到 5 秒級
    expect(h.pushTimes.length).toBeGreaterThan(before + 2)
  })

  it('M1 補推掛住 20 秒期間連續 3 次拉取成功：只有 1 個推送請求，不疊推送', async () => {
    await mount()
    h.failWith = httpError(500, 'admin-push-failed')
    await failOnce()                                   // 推送 #1 失敗 → 進入補推
    expect(h.pushes).toBe(1)
    h.failWith = () => Object.assign(new Error('連線逾時，請檢查網路後重試'), { code: 'timeout' })
    h.hangMs = 20_000
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })   // t≈5.3：拉取 → 補推 #2 開始、掛住
    expect(h.pushes).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })  // 期間 3 次拉取成功
    expect(h.pushes).toBe(2)                           // ★ 沒有再開新推送
    // 店員此時又動了一下：不重疊，排隊等 #2 有結果
    await act(async () => { ref.ctx.blockTable(ref.ctx.tables[1].number, '測試') })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(h.pushes).toBe(2)
    expect(h.maxActive).toBe(1)
    h.hangMs = 0
    h.failWith = null
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })   // #2 逾時失敗 → 排隊的那次送出
    expect(h.pushes).toBe(3)
    expect(h.maxActive).toBe(1)
  })

  it('M2 連續 3 次候位 409 後，下一次拉取解掉衝突 → 立刻補推，不等退避', async () => {
    await mount()
    h.failWith = () => Object.assign(new Error('waitlist-changed'), { status: 409, code: 'waitlist-changed', waitlistConflict: true })
    for (let i = 0; i < 3; i++) {
      await act(async () => { ref.ctx.blockTable(ref.ctx.tables[i].number, '測試') })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    }
    expect(h.pushes).toBe(3)                           // 3 次 409，退避被推到 30 秒級
    h.failWith = null
    h.applyResult = { waitlistConflictsResolved: 1 }
    await act(async () => { await vi.advanceTimersByTimeAsync(4_100 + 300) })  // t≈5.3：拉取解掉衝突＋250ms 節流
    expect(h.pushes).toBe(4)                           // ★ 馬上補推
    expect(ref.ctx.cloudStatus.state).toBe('synced')
  })

  it('沒有推送失敗時，拉取不額外觸發推送（不每 5 秒打 adminPushData）', async () => {
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_500) })
    expect(h.pushes).toBe(0)
  })
})
