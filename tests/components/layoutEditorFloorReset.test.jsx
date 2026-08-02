import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { INITIAL_TABLES, FIXTURES } from '../../src/data/tables'

// 🔴 「↺ 重設本樓層預設」只能重設編輯器當前顯示的樓層——舊版 handleReset 一次把
// INITIAL_TABLES 全部 52 桌（含兩層）＋兩層設施/底圖都蓋掉，在 2F 按重設會連使用者
// 剛編好、還沒存的 1F 也整個抹掉。這裡鎖住：在 2F 按重設 → 2F 桌位/設施回到預設、
// 1F 桌位/設施完全不變（逐一比對，不是「數量不變」這種弱斷言）。
//
// 用 react-dom/client + act 手動掛載（專案未安裝 @testing-library/react，慣例同
// tests/components/layoutEditorSave.test.jsx）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let bookingCtx
let toastMock

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => toastMock,
  useConfirm: () => vi.fn(async () => true),
}))

const LayoutEditor = (await import('../../src/components/admin/LayoutEditor')).default

describe('LayoutEditor：「重設本樓層預設」只影響當前樓層', () => {
  let container, root, onClose

  const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0))

  // 用真實 INITIAL_TABLES 當基礎，但把 1F 與 2F 各挑一張桌「動過」（x 偏移 999），
  // 模擬店家還沒存檔的手動調整——這樣才能區分「回到預設值」跟「本來就沒變」。
  const custom1F = { ...INITIAL_TABLES.find(t => t.floor === '1F'), x: 999 }
  const custom2F = { ...INITIAL_TABLES.find(t => t.floor === '2F'), x: 999 }
  const customTables = () => INITIAL_TABLES.map(t => {
    if (t.floor === '1F' && t.number === custom1F.number) return { ...t, x: 999 }
    if (t.floor === '2F' && t.number === custom2F.number) return { ...t, x: 999 }
    return { ...t }
  })

  const customFixtures = () => ({
    '1F': FIXTURES['1F'].map(f => ({ ...f, x: (Number(f.x) || 0) + 500 })),
    '2F': FIXTURES['2F'].map(f => ({ ...f, x: (Number(f.x) || 0) + 500 })),
  })

  const render = () => {
    onClose = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<LayoutEditor open onClose={onClose} />) })
  }

  const allButtons = () => [...container.querySelectorAll('button')]
  const findButton = (text) => allButtons().find(b => b.textContent.includes(text))

  beforeEach(() => {
    bookingCtx = {
      tables: customTables(),
      settings: { floorPlan: { fixtures: customFixtures(), zones: [], backgroundImages: {} } },
      saveFloorPlan: vi.fn(() => ({ ok: true })),
      flushCloudNow: vi.fn(async () => ({ ok: true })),
    }
    toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('在 2F 按重設：2F 桌位回到 INITIAL_TABLES 預設、1F 桌位維持使用者剛才的修改完全不變', async () => {
    render()
    // 切到 2F
    await act(async () => { findButton('2F（').click() })
    // 按重設
    await act(async () => { findButton('重設本樓層預設').click(); await flushMicrotasks() })

    // toast 要講清楚範圍是「2F」，不是籠統的「預設佈局」
    expect(toastMock.info).toHaveBeenCalledWith(expect.stringContaining('2F'))

    // 切回 1F，檢查 1F 那張被動過的桌完全沒被重設按鈕動到
    await act(async () => { findButton('1F（').click() })
    // 用畫面上的桌號/座標無法直接讀 state，改用「儲存並返回」把 localTables 交給
    // saveFloorPlan 觀察實際傳出去的資料（比對 DOM 屬性更可靠、不依賴渲染細節）。
    await act(async () => { findButton('儲存並返回').click(); await flushMicrotasks() })

    expect(bookingCtx.saveFloorPlan).toHaveBeenCalledTimes(1)
    const saved = bookingCtx.saveFloorPlan.mock.calls[0][0]
    const savedTables = saved.tables
    const saved1F = savedTables.find(t => t.floor === '1F' && t.number === custom1F.number)
    const saved2F = savedTables.find(t => t.floor === '2F' && t.number === custom2F.number)

    // 1F 那張桌：使用者的修改（x=999）原封不動保留，沒被「本樓層重設」波及
    expect(saved1F.x).toBe(999)
    // 2F 那張桌：確實回到 INITIAL_TABLES 的預設座標，不是 999
    const default2F = INITIAL_TABLES.find(t => t.floor === '2F' && t.number === custom2F.number)
    expect(saved2F.x).toBe(default2F.x)
    expect(saved2F.x).not.toBe(999)

    // 其餘 1F 桌位（未被特別動過的）也要逐一比對完全等於原本傳入的值——不是只挑一張看
    const original1F = customTables().filter(t => t.floor === '1F')
    const savedOnly1F = savedTables.filter(t => t.floor === '1F')
    expect(savedOnly1F).toEqual(original1F)

    // 2F 桌位整層都要等於 INITIAL_TABLES 的預設（逐張比對）
    const default2FAll = INITIAL_TABLES.filter(t => t.floor === '2F')
    const savedOnly2F = savedTables.filter(t => t.floor === '2F')
    expect(savedOnly2F).toEqual(default2FAll)

    // 設施：2F 設施回到預設 FIXTURES['2F']（x 不再是 +500），1F 設施維持使用者的 +500 修改
    const savedFixtures = saved.fixtures
    expect(savedFixtures['1F']).toEqual(customFixtures()['1F'])
    expect(savedFixtures['2F'].map(f => f.x)).toEqual(FIXTURES['2F'].map(f => f.x))
  })

  it('在 1F 按重設：1F 回預設，2F 使用者的修改不受影響（對稱驗證，不是只測單一方向）', async () => {
    render()
    // 預設就在 1F，直接按重設
    await act(async () => { findButton('重設本樓層預設').click(); await flushMicrotasks() })
    expect(toastMock.info).toHaveBeenCalledWith(expect.stringContaining('1F'))

    await act(async () => { findButton('2F（').click() })
    await act(async () => { findButton('儲存並返回').click(); await flushMicrotasks() })

    const saved = bookingCtx.saveFloorPlan.mock.calls[0][0]
    const savedTables = saved.tables
    const saved1F = savedTables.find(t => t.floor === '1F' && t.number === custom1F.number)
    const saved2F = savedTables.find(t => t.floor === '2F' && t.number === custom2F.number)

    const default1F = INITIAL_TABLES.find(t => t.floor === '1F' && t.number === custom1F.number)
    expect(saved1F.x).toBe(default1F.x)
    expect(saved2F.x).toBe(999) // 2F 的手動修改保留
  })
})
