// 選客入座改版第二輪（2026-11-27 獨立驗收 verify-after.md 的修正）：
//   #2  報到列入口只用原位確認卡，不另發 toast（同一件事只有一顆「復原」）
//   #5  ConfirmProvider：開新 confirm 前先把舊的 resolve(false)（等它的呼叫端不會永遠卡住）
//   #11 換桌面板依 5 分鐘規則講原桌會怎樣（moveSourceNote）
//   #12 尚未選桌不顯示「擠一擠也還差 N 位」
//   #13 「＋再加一桌」上面的內容不隨選第一桌改變高度（提示都放在它下面）
//   #14 復原鈕看得到的字一律「復原」，對象在 aria-label
//   #15 toast 容器 role=status＋aria-live=polite
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { handleArriveNow } from '../../src/components/admin/OperationsView.jsx'
import ModeBanner, { moveSourceNote } from '../../src/components/admin/ops/ModeBanner'
import { ToastProvider, ConfirmProvider, useToast, useConfirm } from '../../src/components/ui/Toast'
import { toastSeatUndo } from '../../src/utils/seatFeedback'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root
const mount = (el) => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(el)) }
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null })

describe('#2 報到列入口（inline）：不發 toast，只回傳原位確認卡用的復原', () => {
  const table = { number: '105', status: 'reserved', currentBookingId: 'bk1' }
  const booking = { id: 'bk1', name: '林先生', guests: 3, assignedTableId: '105' }
  const deps = (over = {}) => ({
    seatBooking: vi.fn(() => ({ ok: true, undo: { bookingId: 'bk1' } })),
    undoSeatBooking: vi.fn(() => ({ ok: true })),
    toast: { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() },
    ...over,
  })
  it('inline:true → 不呼叫 toast.action／success；回傳 undoSeat 與桌號；按確認卡的復原照常倒回並出「已復原」', () => {
    const d = deps()
    const r = handleArriveNow(table, booking, { ...d, inline: true })
    expect(d.toast.action).not.toHaveBeenCalled()
    expect(d.toast.success).not.toHaveBeenCalled()
    expect(r).toMatchObject({ ok: true, seatedLabel: '105' })
    expect(r.undoSeat().ok).toBe(true)
    expect(d.undoSeatBooking).toHaveBeenCalledWith({ bookingId: 'bk1' })
    expect(d.toast.info).toHaveBeenCalledWith('已復原：林先生 回到待到')
  })
  it('預配那條（桌空著）inline 也不發 toast', () => {
    const d = deps()
    const r = handleArriveNow({ number: '105', status: 'vacant', currentBookingId: null }, booking, { ...d, inline: true })
    expect(r.ok).toBe(true)
    expect(d.toast.action).not.toHaveBeenCalled()
  })
  it('其他入口（不帶 inline）照舊發 toast：看得到「復原」、aria-label 帶對象', () => {
    const d = deps()
    handleArriveNow(table, booking, d)
    const [msg, action] = d.toast.action.mock.calls[0]
    expect(msg).toBe('✓ 林先生 3 位 → 105 已入座')
    expect(action).toMatchObject({ label: '復原', ariaLabel: '復原入座 林先生' })
  })
  it('入座失敗：inline 也照常報錯（錯誤不靠確認卡）', () => {
    const d = deps({ seatBooking: vi.fn(() => ({ ok: false, error: '105 停用' })) })
    handleArriveNow(table, booking, { ...d, inline: true })
    expect(d.toast.error).toHaveBeenCalled()
  })
})

describe('#5 ConfirmProvider：第二個 confirm 覆蓋時，第一個 resolve(false)', () => {
  it('開第二個 → 第一個 Promise 結束為 false；第二個照常由按鈕決定', async () => {
    let confirm
    function Grab() { confirm = useConfirm(); return null }
    mount(<ConfirmProvider><Grab /></ConfirmProvider>)
    let p1, p2
    act(() => { p1 = confirm('第一個？') })
    act(() => { p2 = confirm('第二個？') })
    await expect(p1).resolves.toBe(false)
    expect(document.body.textContent).toContain('第二個？')
    const ok = [...document.querySelectorAll('button')].find(b => b.textContent === '確認')
    act(() => ok.click())
    await expect(p2).resolves.toBe(true)
  })
})

describe('#14／#15 Toast：復原鈕 aria-label、容器 role=status', () => {
  it('入座 toast 看得到「復原」、讀屏名是對象；容器是 polite live region', () => {
    let api
    function Grab() { api = useToast(); return null }
    mount(<ToastProvider><Grab /></ToastProvider>)
    act(() => { toastSeatUndo(api, '✓ 散客 2 位 → 105 已入座', { ariaLabel: '復原帶位 105', onUndo: () => {} }) })
    const box = document.querySelector('[data-testid="toast-container"]')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.getAttribute('aria-live')).toBe('polite')
    const btn = box.querySelector('[data-testid="toast-action"]')
    expect(btn.textContent).toBe('復原')
    expect(btn.getAttribute('aria-label')).toBe('復原帶位 105')
    // 入座回饋也在頂部容器（不再有桌況圖底部的落點）
    expect(box.textContent).toContain('105 已入座')
    expect(box.querySelector('[data-placement="seat"]')).toBeTruthy()
  })
})

describe('#11 moveSourceNote：依 5 分鐘規則講原桌', () => {
  const NOW = new Date('2026-11-27T12:00:00')
  const b = { id: 'W', assignedTableId: '101', extraTableIds: [] }
  const tbl = (n, minAgo, over = {}) => ({ number: n, status: 'dining', currentBookingId: 'W', seatedAt: new Date(NOW.getTime() - minAgo * 60000).toISOString(), ...over })
  it('剛坐不到 5 分鐘 → 直接變回空桌', () => {
    expect(moveSourceNote(b, [tbl('101', 1)], NOW)).toBe('保留原入座時間；原桌剛坐不到 5 分鐘，會直接變回空桌。')
  })
  it('滿 5 分鐘 → 轉為待清', () => {
    expect(moveSourceNote(b, [tbl('101', 12)], NOW)).toBe('保留原入座時間；原桌會轉為待清。')
  })
  it('沒有入座時間（舊資料）／他台時鐘晚超過 1 分鐘 → 轉為待清（與 service 同口徑）', () => {
    expect(moveSourceNote(b, [tbl('101', 0, { seatedAt: null })], NOW)).toBe('保留原入座時間；原桌會轉為待清。')
    expect(moveSourceNote(b, [tbl('101', -3)], NOW)).toBe('保留原入座時間；原桌會轉為待清。')
  })
  it('大組一桌剛坐、一桌已久 → 逐桌講', () => {
    const combo = { ...b, extraTableIds: ['102'] }
    expect(moveSourceNote(combo, [tbl('101', 1), tbl('102', 20)], NOW)).toBe('保留原入座時間；原桌 101 剛坐不到 5 分鐘會直接變回空桌，102 會轉為待清。')
  })
})

describe('#12／#13 ModeBanner（左欄作業面板）：還差幾位只在選了桌之後講；「＋再加一桌」上方不隨選桌變高', () => {
  const mode = (selected, need = 4) => ({ type: 'assign-multi', kind: 'arrive', need, selected, booking: { id: 'L', name: '林先生', guests: need, status: 'confirmed' } })
  const render = (selected, { need = 4, seats = 0, multi = false } = {}) => (
    <ModeBanner layout="rail" mode={mode(selected, need)} tables={[]} multiSeats={seats} multiMaxSeats={seats + selected.length}
      multi={multi} onToggleMulti={() => {}} onCancel={() => {}} onConfirmMulti={() => {}} onChangeNeed={() => {}} />
  )
  const nodesBeforeToggle = () => {
    const toggle = container.querySelector('[data-testid="mode-multi-toggle"]')
    const kids = [...toggle.parentElement.children]
    return kids.slice(0, kids.indexOf(toggle)).map(el => el.outerHTML.replace(/>[^<]*</g, '><'))
  }
  it('一桌都沒選：不顯示「擠一擠也還差」（4 位一張 6 人桌就夠，不誤導成要併桌）', () => {
    mount(render([]))
    expect(container.textContent).not.toContain('擠一擠也還差')
    expect(container.querySelector('[data-testid="mode-short"]')).toBeNull()
  })
  it('選了一張不夠的桌：才出現「還差」，而且在「＋再加一桌」下面', () => {
    mount(render(['105'], { need: 10, seats: 4 }))
    const short = container.querySelector('[data-testid="mode-short"]')
    expect(short.textContent).toContain('還差 6 位')   // C 包：講離人數還差幾位（10−4），不再寫「擠一擠也還差 5 位」
    const toggle = container.querySelector('[data-testid="mode-multi-toggle"]')
    expect(toggle.compareDocumentPosition(short) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('選第一桌前後，「＋再加一桌」上方的元素結構不變（不位移）', () => {
    mount(render([], { need: 10, seats: 0 }))
    const before = nodesBeforeToggle()
    act(() => root.render(render(['105'], { need: 10, seats: 4 })))
    expect(nodesBeforeToggle()).toEqual(before)
  })
})
