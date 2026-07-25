import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import SlideToSeat from '../../src/components/admin/ops/SlideToSeat'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom 沒有真實佈局：clientWidth/getBoundingClientRect 都是 0，且沒有 PointerEvent/setPointerCapture。
// 用 MouseEvent 帶 clientX 假裝 pointer 事件（type 設為 pointerdown/move/up，React 的合成事件系統
// 只認事件的 .type 字串，不要求真的是 PointerEvent 實例），並在拿到 track 節點後覆寫
// getBoundingClientRect 回傳固定寬度，讓行程（travel）計算可控、可斷言。
const TRACK_WIDTH = 300 // knob 74px → travel = 226px；60% 門檻 = 135.6px
const TRAVEL = TRACK_WIDTH - 74

const fakePointerEvent = (type, clientX, opts = {}) =>
  new window.MouseEvent(type, { clientX, bubbles: true, cancelable: true, ...opts })

describe('SlideToSeat 滑動帶位', () => {
  let container, root

  const mount = (ui) => act(() => { root.render(ui) })
  const setup = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  const getTrack = () => container.querySelector('[role="button"]')
  const getKnob = () => getTrack().querySelector('[data-slide-knob]')
  const stubWidth = () => { getTrack().getBoundingClientRect = () => ({ width: TRACK_WIDTH }) }

  const drag = (fromX, toX, { up = true, cancel = false } = {}) => {
    const knob = getKnob()
    act(() => knob.dispatchEvent(fakePointerEvent('pointerdown', fromX)))
    act(() => knob.dispatchEvent(fakePointerEvent('pointermove', toX)))
    if (cancel) act(() => knob.dispatchEvent(fakePointerEvent('pointercancel', toX)))
    else if (up) act(() => knob.dispatchEvent(fakePointerEvent('pointerup', toX)))
  }

  it('拖不到 60% 行程放手：不觸發 onConfirm，knob 彈回原位', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    drag(0, 100) // 100 < 60% * 226 = 135.6
    expect(onConfirm).not.toHaveBeenCalled()
    expect(getKnob().style.transform).toBe('translateX(0px)')
  })

  it('拖超過 60% 行程放手：觸發一次 onConfirm', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    drag(0, 200) // 200 > 135.6
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(getKnob().style.transform).toBe(`translateX(${TRAVEL}px)`)
  })

  it('disabled 時不觸發，且無法開始拖曳', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} disabled disabledLabel="尚未可帶位" />)
    stubWidth()

    drag(0, 250)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(getTrack().getAttribute('aria-disabled')).toBe('true')
    expect(container.textContent).toContain('尚未可帶位')
  })

  it('鍵盤 Enter 等同滑完，直接觸發 onConfirm', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    act(() => {
      getTrack().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('鍵盤空白鍵也觸發；disabled 時鍵盤不觸發', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} disabled />)
    stubWidth()
    act(() => {
      getTrack().dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('防重入：連續拖到底，onConfirm 只被呼叫一次', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    drag(0, 300) // 第一次拖到底 → 觸發並鎖住
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // 鎖住後再拖一次到底，不應該再觸發（handlePointerDown 因 locked/firedRef 直接短路）
    drag(0, 300)
    drag(0, 300)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // 鍵盤也一樣被鎖住
    act(() => {
      getTrack().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('拖到一半 pointercancel：視同取消，不觸發、彈回原位', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    drag(0, 250, { cancel: true, up: false })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(getKnob().style.transform).toBe('translateX(0px)')
  })

  // 迴歸：父層在拖曳途中重繪（OpsRail 有 30 秒 tick、BookingContext 會定期同步）會給出
  // 新的 onConfirm 函式 identity。若重置用的 useEffect 依賴了 onConfirm，dragX 會被歸零、
  // 手勢當場斷掉——領檯滑到一半突然彈回，且滑不出去。
  it('拖曳途中父層重繪（新的 onConfirm identity）：不可把拖曳進度歸零', () => {
    setup()
    const first = vi.fn()
    mount(<SlideToSeat onConfirm={first} />)
    stubWidth()

    const knob = getKnob()
    act(() => knob.dispatchEvent(fakePointerEvent('pointerdown', 0)))
    act(() => knob.dispatchEvent(fakePointerEvent('pointermove', 120)))
    expect(getKnob().style.transform).toBe('translateX(120px)')

    // 父層重繪：同樣的語意（disabled/label 都沒變），但 onConfirm 是新函式
    const second = vi.fn()
    mount(<SlideToSeat onConfirm={second} />)
    stubWidth()
    expect(getKnob().style.transform).toBe('translateX(120px)') // 進度必須保留

    // 接著拖完仍要能成立
    act(() => getKnob().dispatchEvent(fakePointerEvent('pointermove', 220)))
    act(() => getKnob().dispatchEvent(fakePointerEvent('pointerup', 220)))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  // 迴歸：入座失敗（桌被別台佔走／席數不足）時 onConfirm 回 false。若不解鎖，
  // 面板狀態沒變 → disabled 也沒變 → 滑桿永久卡死，店員只能亂改人數才解得開。
  it('onConfirm 回傳 false（入座失敗）：滑桿要解鎖並歸位，能立刻重試', () => {
    setup()
    const onConfirm = vi.fn(() => false)
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    drag(0, TRAVEL)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(getKnob().style.transform).toBe('translateX(0px)') // 歸位

    // 沒有改任何 props，直接再滑一次仍要能觸發
    drag(0, TRAVEL)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  // 空白鍵在瀏覽器是「往下捲一頁」。滑桿是 role="button"，若也收空白鍵，
  // 店員想捲畫面就會直接把客人帶位——防誤觸的設計會被繞過。
  it('空白鍵不可觸發入座（只收 Enter）', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()

    act(() => {
      getTrack().dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(onConfirm).not.toHaveBeenCalled()

    act(() => {
      getTrack().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disabled 由 true 轉 false（湊齊桌與人數）：解鎖並可再次滑動', () => {
    setup()
    const onConfirm = vi.fn()
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()
    drag(0, TRAVEL)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // 入座後面板重置 → disabled 轉 true，再湊齊 → 轉回 false，應解鎖
    mount(<SlideToSeat onConfirm={onConfirm} disabled />)
    mount(<SlideToSeat onConfirm={onConfirm} />)
    stubWidth()
    drag(0, TRAVEL)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
