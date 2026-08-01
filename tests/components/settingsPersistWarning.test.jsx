import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 驗收回饋缺口 2：cloudDataService.persistSyncState 寫入 localStorage 失敗（裝置空間不足、
// 無痕/私密瀏覽模式拒寫）時，程式會靜默退化回修復前的行為——同步基準線只在本分頁存活，
// 整頁重新整理可能重演佈局被雲端覆蓋，但故障當下沒有任何畫面提示。
// 這支測試鎖住 BookingContext.localPersistDegraded → SettingsView 警示列這條「看得到」的路徑。
//
// 重量級依賴（TableGrid/LayoutEditor/TelegramSettings/StaffAdminSection/ExportCenter、
// react-router-dom 的 useSearchParams）全部 mock 掉，只驗證警示列本身的條件渲染，
// 不测試 SettingsView 其餘的龐大功能（那些已經在各自的 service 測試裡覆蓋）。

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
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, signOut: vi.fn(), can: () => true, usingFirebase: true }),
}))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  useConfirm: () => vi.fn(async () => true),
}))

const SettingsView = (await import('../../src/components/admin/SettingsView')).default
const { getSettings } = await import('../../src/services/settingsService')

describe('SettingsView：本機同步狀態落地失敗要有畫面警示（不只 console.error）', () => {
  let container, root

  const render = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<SettingsView />) })
  }

  beforeEach(() => {
    bookingCtx = {
      settings: getSettings(),
      bookings: [],
      updateSettings: vi.fn(),
      flushCloudNow: vi.fn(async () => ({ ok: true })),
      cloudStatus: { state: 'synced', lastSyncAt: null, error: '' },
      migrateLocalToCloud: vi.fn(),
      pullCloud: vi.fn(),
      discardRejectedChanges: vi.fn(),
      localPersistDegraded: false,
    }
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('localPersistDegraded=false：不顯示警示列', () => {
    render()
    expect(container.textContent).not.toContain('本機儲存空間不足')
  })

  it('localPersistDegraded=true：顯示明確警示（不是只有 console，畫面上看得到）', () => {
    bookingCtx.localPersistDegraded = true
    render()
    expect(container.textContent).toContain('本機儲存空間不足或瀏覽器處於無痕/私密瀏覽模式')
    expect(container.textContent).toContain('佈局變更可能在重新整理後遺失')
  })
})
