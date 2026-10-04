import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import FloorMap from '../../src/components/admin/floormap/FloorMap'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
const tables = [
  { number: '201', floor: '2F', capacity: 6, x: 0, y: 0, w: 40, h: 35, isActive: true, status: 'vacant' },
  { number: '202', floor: '2F', capacity: 4, x: 60, y: 0, w: 40, h: 35, isActive: true, status: 'blocked' },
]
const render = (props = {}) => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  act(() => root.render(<FloorMap floor="2F" tables={tables} fixtures={{ '2F': [] }} {...props} />))
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('D6 地圖清楚桌位與鍵盤操作', () => {
  it('同一桌只有一個操作目標，桌號／人數／共同狀態都有名稱，Enter與Space沿用選桌契約', () => {
    const onSelectTable = vi.fn()
    render({ onSelectTable, tablePresentation: { '201': { statusLabel: '可入座', availabilityLabel: '下組17:00' }, '202': { statusLabel: '臨時不可用', unavailableReason: '設備維修' } } })
    const targets = container.querySelectorAll('g[role="button"]')
    expect(targets).toHaveLength(2)
    expect(targets[0].getAttribute('aria-label')).toBe('201桌，6人，可入座，下組17:00')
    expect(targets[1].getAttribute('aria-label')).toContain('設備維修')
    expect(targets[0].getAttribute('tabindex')).toBe('0')
    targets[0].focus(); expect(document.activeElement).toBe(targets[0])
    act(() => targets[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => targets[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(onSelectTable.mock.calls).toEqual([['201'], ['201']])
    expect(targets[1].textContent).toContain('臨時不可用')
  })

  it('縮放整張布局保持座標，最短桌邊至少44px，放大視圖可關閉', () => {
    render({ onSelectTable: vi.fn() })
    const svg = container.querySelector('svg')
    const viewWidth = Number(svg.getAttribute('viewBox').split(' ')[2])
    const minWidth = Number(svg.style.width.match(/([\d.]+)px/)[1])
    expect(35 * minWidth / viewWidth).toBeGreaterThanOrEqual(44)
    const originalX = container.querySelector('g[role="button"] > rect').getAttribute('x')
    act(() => container.querySelector('[aria-label="放大地圖"]').click())
    expect(Number(svg.style.width.match(/([\d.]+)px/)[1])).toBeGreaterThan(minWidth)
    expect(container.querySelector('g[role="button"] > rect').getAttribute('x')).toBe(originalX)
    act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '放大視圖').click())
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('放大視圖限制Tab焦點，Escape只關地圖並回到入口', () => {
    render({ onSelectTable: vi.fn() })
    const opener = [...container.querySelectorAll('button')].find(b => b.textContent === '放大視圖')
    opener.focus()
    act(() => opener.click())
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const targets = dialog.querySelectorAll('g[tabindex="0"]')
    targets[targets.length - 1].focus()
    act(() => targets[targets.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(dialog.querySelector('button:not(:disabled)'))
    const bubbleEscape = vi.fn()
    document.addEventListener('keydown', bubbleEscape)
    act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(bubbleEscape).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
    document.removeEventListener('keydown', bubbleEscape)
  })

  it('定位推薦桌可重複，僅捲地圖與焦點，不選桌；衝突用文字提示', () => {
    const onSelectTable = vi.fn()
    const scrollTo = vi.fn()
    const original = HTMLElement.prototype.scrollTo
    HTMLElement.prototype.scrollTo = scrollTo
    render({ onSelectTable, locateTableNumber: '202', locateRequestId: 1, tablePresentation: { '201': { statusLabel: '空桌', hasTimeConflict: true } } })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(document.activeElement.dataset.tableNumber).toBe('202')
    expect(onSelectTable).not.toHaveBeenCalled()
    expect(container.querySelector('[data-table-number="201"]').textContent).toContain('時段衝突')
    act(() => root.render(<FloorMap floor="2F" tables={tables} fixtures={{ '2F': [] }} onSelectTable={onSelectTable} locateTableNumber="202" locateRequestId={2} />))
    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(onSelectTable).not.toHaveBeenCalled()
    HTMLElement.prototype.scrollTo = original
  })

  it('停用桌提供狀態但不進Tab或鍵盤選取', () => {
    const onSelectTable = vi.fn()
    render({ tables: [{ ...tables[0], isActive: false }], onSelectTable })
    const target = container.querySelector('g[role="button"]')
    expect(target.getAttribute('tabindex')).toBe('-1')
    expect(target.getAttribute('aria-label')).toContain('已停用')
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onSelectTable).not.toHaveBeenCalled()
  })
})
