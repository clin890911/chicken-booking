import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 叫號簡訊設定區塊：直接打 adminSmsConfig（不經 settings 同步）；預設顯示關閉；測試簡訊結果可讀。
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const confirmFn = vi.fn(async () => true)
const adminSmsConfig = vi.fn()
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ usingFirebase: true, can: () => true }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }), useConfirm: () => confirmFn }))
vi.mock('../../src/services/cloudDataService', () => ({ adminSmsConfig: (...a) => adminSmsConfig(...a) }))
const SmsSettingsSection = (await import('../../src/components/admin/SmsSettingsSection')).default

const view = (config = {}) => ({
  ok: true, exists: false, storeName: '雞王涮涮鍋', credentialsConfigured: false, counters: { day: '2026-10-18', live: 0, dry: 0 },
  config: { enabled: false, dryRun: false, dailyLimit: 300, perWaitlistLimit: 3, template: '【{店名}】您的候位 #{號碼} 已可入座，請於 10 分鐘內至櫃台報到。', senderName: '', apiHost: 'new.e8d.tw', ...config },
})

describe('SmsSettingsSection', () => {
  let container, root
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
  const btn = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const checkbox = text => [...container.querySelectorAll('label')].find(l => l.textContent.includes(text)).querySelector('input')
  beforeEach(async () => {
    vi.clearAllMocks()
    adminSmsConfig.mockImplementation(async p => (p.action === 'get' ? view() : p.action === 'set' ? view(p.patch) : { ok: true, result: { status: 'dry-run', dryRunMessage: '【雞王涮涮鍋】您的候位 #0 已可入座' } }))
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await act(async () => root.render(<SmsSettingsSection />))
    await flush()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('載入即讀 get；預設顯示關閉、帳密未設定；未修改時儲存鈕停用', () => {
    expect(adminSmsConfig).toHaveBeenCalledWith({ action: 'get' })
    expect(container.textContent).toContain('關閉（不發簡訊）')
    expect(container.textContent).toContain('尚未設定（UNSET）')
    expect(container.textContent).toContain('預覽：【雞王涮涮鍋】您的候位 #12 已可入座')
    expect(btn('儲存簡訊設定').disabled).toBe(true)
  })
  it('開啟實送會先確認，確認後送 set patch', async () => {
    await act(async () => { checkbox('總開關').click() })
    await act(async () => { btn('儲存簡訊設定').click() })
    await flush()
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(adminSmsConfig).toHaveBeenCalledWith({ action: 'set', patch: expect.objectContaining({ enabled: true, dryRun: false, dailyLimit: 300 }) })
    expect(container.textContent).toContain('開啟（實際發送）')
  })
  it('開啟乾跑不需確認（不會實送）', async () => {
    await act(async () => { checkbox('總開關').click(); })
    await act(async () => { checkbox('乾跑模式').click() })
    await act(async () => { btn('儲存簡訊設定').click() })
    await flush()
    expect(confirmFn).not.toHaveBeenCalled()
    expect(container.textContent).toContain('乾跑（只記錄、不實送）')
  })
  it('測試簡訊：非手機不送出；手機送 test 動作並顯示結果', async () => {
    const input = [...container.querySelectorAll('input')].find(i => i.getAttribute('placeholder') === '0912345678')
    await act(async () => { btn('發測試簡訊').click() })
    expect(adminSmsConfig).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'test' }))
    expect(container.textContent).toContain('請輸入 09 開頭的 10 碼手機')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, '0912345678'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { btn('發測試簡訊').click() })
    await flush()
    expect(adminSmsConfig).toHaveBeenCalledWith({ action: 'test', phone: '0912345678' })
    expect(container.textContent).toContain('乾跑完成（未實際發送）')
  })
})
