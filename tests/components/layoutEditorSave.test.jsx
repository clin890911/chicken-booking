import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// LayoutEditor 存檔「已儲存」不可以是騙人的。
//
// 背景：saveFloorPlan 只確保寫進本機 localStorage，雲端推送是背景 fire-and-forget（250ms
// 防抖）。舊版 handleSave 存完本機立刻 toast.success + onClose，店主一看到「已儲存」就會
// 離開／整頁重新整理／切走 App，推送可能根本沒送達（iPad Safari 背景分頁尤其容易被系統
// 回收）。改成 await flushCloudNow()（BookingContext 立即推送、回報後端真實結果）：
// 真的推上雲端才顯示成功並關閉；失敗則顯示警告、不自動關閉；推送中按鈕要顯示 loading。
//
// 用 react-dom/client + act 手動掛載（專案未安裝 @testing-library/react，慣例見
// tests/components/upcomingPanelPermissions.test.jsx）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let bookingCtx
let toastMock

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => toastMock,
  useConfirm: () => vi.fn(async () => true),
}))

const LayoutEditor = (await import('../../src/components/admin/LayoutEditor')).default

const baseTable = (over = {}) => ({
  number: 'A1', capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 100,
  rotation: 0, zoneId: null, isActive: true, outage: null, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null,
  blockReason: null, updatedAt: null, ...over,
})

describe('LayoutEditor：儲存要 await 雲端推送結果', () => {
  let container, root, onClose

  const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))

  const render = () => {
    onClose = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<LayoutEditor open onClose={onClose} />) })
  }

  const headerButtons = () => [...container.querySelectorAll('header button')]
  const findButton = (text) => headerButtons().find(b => b.textContent.includes(text))

  // 「返回」按鈕文字固定叫「返回」，「重設」按鈕會觸發 confirmDialog（已 mock 為必定同意）
  // 讓 isDirty 變 true，不必真的模擬拖拉桌位的 pointer 事件幾何運算。
  const makeDirty = async () => {
    const resetBtn = findButton('重設本樓層預設')
    await act(async () => { resetBtn.click(); await flushMicrotasks() })
  }

  beforeEach(() => {
    bookingCtx = {
      tables: [baseTable()],
      settings: { floorPlan: {} },
      saveFloorPlan: vi.fn(() => ({ ok: true })),
      flushCloudNow: vi.fn(async () => ({ ok: true })),
    }
    toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('本機存檔的 guard 就失敗（例如佔用/團圈守門）：不呼叫 flushCloudNow，顯示錯誤，不關閉', async () => {
    bookingCtx.saveFloorPlan = vi.fn(() => ({ ok: false, error: '101 已被團圈桌，無法刪除' }))
    render()
    await makeDirty()
    const saveBtn = findButton('儲存並返回')
    await act(async () => { saveBtn.click(); await flushMicrotasks() })

    expect(bookingCtx.flushCloudNow).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('101 已被團圈桌，無法刪除')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('推送成功：await 完成後才顯示成功並關閉編輯器', async () => {
    let resolveFlush
    bookingCtx.flushCloudNow = vi.fn(() => new Promise(resolve => { resolveFlush = resolve }))
    render()
    await makeDirty()
    const saveBtn = findButton('儲存並返回')

    // 點下存檔：flushCloudNow 尚未 resolve，這時不該已經顯示成功或關閉
    await act(async () => { saveBtn.click(); await flushMicrotasks() })
    expect(bookingCtx.flushCloudNow).toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // 推送進行中：按鈕要顯示可見的 loading 狀態且被 disable，避免店主在這時離開
    const savingBtn = findButton('同步中')
    expect(savingBtn).toBeTruthy()
    expect(savingBtn.disabled).toBe(true)
    expect(findButton('返回').disabled).toBe(true) // 推送中連「返回」也不可離開

    // 雲端真的推送成功
    await act(async () => { resolveFlush({ ok: true }); await flushMicrotasks() })
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.warning).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('推送失敗：顯示警告（不是成功），且不自動關閉編輯器', async () => {
    bookingCtx.flushCloudNow = vi.fn(async () => ({ ok: false, error: '雲端同步逾時' }))
    render()
    await makeDirty()
    const saveBtn = findButton('儲存並返回')
    await act(async () => { saveBtn.click(); await flushMicrotasks() })

    expect(bookingCtx.saveFloorPlan).toHaveBeenCalledTimes(1) // 本機仍然已存
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    expect(toastMock.warning.mock.calls[0][0]).toContain('雲端同步逾時')
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled() // 🔴 失敗不可自動關閉，店主才知道還沒真的存到雲端

    // 按鈕應恢復可再次按下重試（isSaving 已重置）
    const saveBtnAgain = findButton('儲存並返回')
    expect(saveBtnAgain).toBeTruthy()
    expect(saveBtnAgain.disabled).toBe(false)
  })

  it('🔴 flushCloudNow 用 Promise reject（不是回傳 {ok:false}）失敗：顯示錯誤 toast、不自動關閉，不是 unhandled rejection 悄悄過去', async () => {
    bookingCtx.flushCloudNow = vi.fn(async () => { throw new Error('網路中斷') })
    render()
    await makeDirty()
    const saveBtn = findButton('儲存並返回')
    await act(async () => { saveBtn.click(); await flushMicrotasks() })

    expect(bookingCtx.saveFloorPlan).toHaveBeenCalledTimes(1) // 本機仍然已存
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error.mock.calls[0][0]).toContain('網路中斷')
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.warning).not.toHaveBeenCalled() // 三種 toast 不可全空，這裡明確走 error
    expect(onClose).not.toHaveBeenCalled()

    // 按鈕應恢復可再次按下重試（isSaving 已在 finally 重置，不會卡死在 loading）
    const saveBtnAgain = findButton('儲存並返回')
    expect(saveBtnAgain).toBeTruthy()
    expect(saveBtnAgain.disabled).toBe(false)
  })

  it('reject 與 {ok:false} 的警示文案可以區分（不是同一句話）', async () => {
    bookingCtx.flushCloudNow = vi.fn(async () => ({ ok: false, error: '權限不足' }))
    render()
    await makeDirty()
    await act(async () => { findButton('儲存並返回').click(); await flushMicrotasks() })
    const rejectedMessage = toastMock.warning.mock.calls[0][0]

    // 換一輪：這次用 throw 模擬同步出錯
    bookingCtx.flushCloudNow = vi.fn(async () => { throw new Error('逾時') })
    act(() => root.unmount())
    container.remove()
    render()
    await makeDirty()
    await act(async () => { findButton('儲存並返回').click(); await flushMicrotasks() })
    const erroredMessage = toastMock.error.mock.calls[0][0]

    expect(rejectedMessage).not.toBe(erroredMessage)
    expect(rejectedMessage).toContain('被拒')
    expect(erroredMessage).toContain('發生錯誤')
  })

  it('推送中無法按 ESC 或「返回」逃離（避免看不到失敗警告就走掉）', async () => {
    let resolveFlush
    bookingCtx.flushCloudNow = vi.fn(() => new Promise(resolve => { resolveFlush = resolve }))
    render()
    await makeDirty()
    const saveBtn = findButton('儲存並返回')
    await act(async () => { saveBtn.click(); await flushMicrotasks() })

    // 推送中點「返回」不應觸發 onClose
    await act(async () => { findButton('返回').click(); await flushMicrotasks() })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => { resolveFlush({ ok: true }); await flushMicrotasks() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
