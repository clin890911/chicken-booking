import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 訂位專員（host，settings.closures）可在設定頁儲存「休店／關閉時段」，其他設定仍存不了。
// 權限一律取真實 AuthContext.PERMISSIONS（不在測試裡抄一份角色表）。

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
let currentRole = 'host'
const ROLE_LABELS = { manager: '店長', host: '訂位專員', floor: '外場', kitchen: '廚房' }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/contexts/AuthContext', async () => {
  const real = await vi.importActual('../../src/contexts/AuthContext')
  return {
    ...real,
    useAuth: () => ({
      user: { email: 'staff@example.com', role: currentRole, roleLabel: ROLE_LABELS[currentRole] },
      signOut: vi.fn(),
      can: (p) => real.PERMISSIONS[currentRole].has(p),
      usingFirebase: true,
    }),
  }
})
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => toastMock,
  useConfirm: () => vi.fn(async () => true),
}))

const SettingsView = (await import('../../src/components/admin/SettingsView')).default
const { getSettings } = await import('../../src/services/settingsService')

describe('SettingsView：訂位專員只能儲存休店／關閉設定', () => {
  let container, root
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))
  const findButton = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const setOpenTime = (value) => {
    const input = container.querySelector('input[type="time"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const mount = (role) => {
    currentRole = role
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<SettingsView />) })
  }

  beforeEach(() => {
    toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
    bookingCtx = {
      settings: getSettings(),
      bookings: [],
      updateSettings: vi.fn((patch) => ({ ...bookingCtx.settings, ...patch })),
      flushCloudNow: vi.fn(async () => ({ ok: true })),
      cloudStatus: { state: 'synced', lastSyncAt: null },
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

  it('host 關閉整天 → 出現「儲存休店／關閉設定」；儲存只寫 closures、並同步雲端', async () => {
    mount('host')
    expect(container.textContent).toContain('訂位專員只能儲存「休店 / 關閉時段管理」')
    act(() => { findButton('設為整天公休').click() })
    expect(findButton('儲存全部變更')).toBeUndefined()
    const save = findButton('儲存休店／關閉設定')
    expect(save).toBeTruthy()
    expect(save.disabled).toBe(false)
    expect(container.textContent).toContain('訂位專員只能儲存休店／關閉設定，其他設定請用店長帳號')
    await act(async () => { save.click(); await flush() })
    expect(bookingCtx.updateSettings).toHaveBeenCalledTimes(1)
    const patch = bookingCtx.updateSettings.mock.calls[0][0]
    expect(Object.keys(patch)).toEqual(['closures'])
    expect(patch.closures.closedDates.length).toBe(1)
    expect(bookingCtx.flushCloudNow).toHaveBeenCalledTimes(1)
    expect(toastMock.success).toHaveBeenCalledWith('已儲存並同步雲端')
  })

  it('同日被他人同時修改（後端回報 closureConflicts）→ 儲存成功但改用警告提示「已以你的為準」', async () => {
    bookingCtx.flushCloudNow = vi.fn(async () => ({ ok: true, closureConflicts: [{ field: 'closedSeatings', key: '2026-10-12' }] }))
    mount('host')
    act(() => { findButton('設為整天公休').click() })
    await act(async () => { findButton('儲存休店／關閉設定').click(); await flush() })
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.warning).toHaveBeenCalledWith('已儲存並同步雲端。10/12 的休店／關閉設定被他人同時修改，已以你的為準')
  })

  it('host 同時改了營業時間：儲存鈕 disabled、提示其他不會被儲存；按「還原其他設定」後才可存（營業時間不會被送出）', async () => {
    mount('host')
    act(() => { findButton('設為整天公休').click() })
    setOpenTime('09:00')
    expect(findButton('儲存休店／關閉設定').disabled).toBe(true)
    expect(container.textContent).toContain('另有 1 項其他設定不會被儲存')
    act(() => { findButton('還原其他設定').click() })
    expect(container.querySelector('input[type="time"]').value).toBe(bookingCtx.settings.openTime)
    const save = findButton('儲存休店／關閉設定')
    expect(save.disabled).toBe(false)
    await act(async () => { save.click(); await flush() })
    expect(Object.keys(bookingCtx.updateSettings.mock.calls[0][0])).toEqual(['closures'])
  })

  it('host 只改了營業時間：沒有任何儲存鈕，顯示「這些變更不會被儲存」', () => {
    mount('host')
    setOpenTime('09:00')
    expect(findButton('儲存休店／關閉設定')).toBeUndefined()
    expect(findButton('儲存全部變更')).toBeUndefined()
    expect(container.textContent).toContain('這些變更不會被儲存（1 項）')
  })

  it('floor 行為不變：關閉整天也沒有儲存鈕、整頁唯讀提示', () => {
    mount('floor')
    act(() => { findButton('設為整天公休').click() })
    expect(findButton('儲存休店／關閉設定')).toBeUndefined()
    expect(findButton('儲存全部變更')).toBeUndefined()
    expect(container.textContent).toContain('這些變更不會被儲存')
    expect(container.textContent).toContain('唯讀：你的角色無法變更店家設定')
  })

  it('manager 行為不變：「儲存全部變更」送整份表單（含營業時間）', async () => {
    mount('manager')
    act(() => { findButton('設為整天公休').click() })
    setOpenTime('09:00')
    expect(findButton('儲存休店／關閉設定')).toBeUndefined()
    await act(async () => { findButton('儲存全部變更').click(); await flush() })
    const form = bookingCtx.updateSettings.mock.calls[0][0]
    expect(form.openTime).toBe('09:00')
    expect(form.closures.closedDates.length).toBe(1)
    expect(Object.keys(form).length).toBeGreaterThan(5)
  })
})
