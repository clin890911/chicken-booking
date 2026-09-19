import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 設定頁「儲存」在這台裝置還沒取得雲端資料時（flushCloudNow 回 deferred）的文案要誠實：
// 取得雲端資料後，設定會以雲端版本為準、這次的修改不會補送——不可叫店員「按重試同步」
// （重試解決不了），也不可說成雲端拒絕。重量級子元件與路由比照 settingsPersistWarning.test.jsx mock 掉。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))
vi.mock('../../src/components/admin/TableGrid', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/admin/TelegramSettings', () => ({ default: () => null }))
vi.mock('../../src/components/admin/StaffAdminSection', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ExportCenter', () => ({ default: () => null }))

let bookingCtx
let toastMock
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, signOut: vi.fn(), can: () => true, usingFirebase: true }),
}))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => toastMock,
  useConfirm: () => vi.fn(async () => true),
}))

const SettingsView = (await import('../../src/components/admin/SettingsView')).default
const { getSettings } = await import('../../src/services/settingsService')

describe('SettingsView：這台還沒取得雲端資料時儲存設定，文案要講清楚會以雲端為準', () => {
  let container, root
  const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))
  const findButton = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

  beforeEach(() => {
    toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
    const base = getSettings()
    bookingCtx = {
      settings: base,
      bookings: [],
      updateSettings: vi.fn((form) => form),
      flushCloudNow: vi.fn(async () => ({ ok: false, deferred: true, error: '尚未從雲端取得資料，請稍候再試' })),
      cloudStatus: { state: 'offline', lastSyncAt: null, error: 'Failed to fetch' },
      migrateLocalToCloud: vi.fn(),
      pullCloud: vi.fn(),
      discardRejectedChanges: vi.fn(),
      localPersistDegraded: false,
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<SettingsView />) })
    // 表單以掛載時的 settings 為初值；換一份 settings 重繪 → 表單與已存值不同 ＝ 有未儲存變更
    bookingCtx = { ...bookingCtx, settings: { ...base, storeName: '別的店名' } }
    act(() => { root.render(<SettingsView />) })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('儲存 → 顯示「設定尚未存到雲端、會以雲端版本為準、請等同步完成後再改一次」，不叫人按重試', async () => {
    const saveBtn = findButton('儲存全部變更')
    expect(saveBtn).toBeTruthy()
    await act(async () => { saveBtn.click(); await flushMicrotasks() })

    expect(bookingCtx.flushCloudNow).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    const msg = toastMock.error.mock.calls[0][0]
    expect(msg).toContain('設定尚未存到雲端')
    expect(msg).toContain('以雲端版本為準')
    expect(msg).toContain('請等同步完成後再改一次')
    expect(msg).not.toContain('重試')
    expect(msg).not.toContain('拒絕')
  })
})
