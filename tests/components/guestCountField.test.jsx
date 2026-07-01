import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import GuestCountField, { clampGuests } from '../../src/components/admin/GuestCountField'

describe('clampGuests 人數夾住（上限 200）', () => {
  it('超過上限夾到 200（防手誤多按 0）', () => {
    expect(clampGuests(201, 200)).toBe(200)
    expect(clampGuests(2000, 200)).toBe(200)
  })
  it('正常值原樣（含大團）', () => {
    expect(clampGuests(5)).toBe(5)
    expect(clampGuests(60)).toBe(60)
    expect(clampGuests(200)).toBe(200)
  })
  it('小數取整、字串可解析', () => {
    expect(clampGuests(3.9)).toBe(3)
    expect(clampGuests('12')).toBe(12)
  })
  it('非數字 / < 1 → null（不更新）', () => {
    expect(clampGuests(0)).toBeNull()
    expect(clampGuests('')).toBeNull()
    expect(clampGuests('abc')).toBeNull()
    expect(clampGuests(-3)).toBeNull()
  })
})

describe('GuestCountField 渲染', () => {
  it('value>8 顯示自訂數字輸入框且 max=200', () => {
    const html = renderToStaticMarkup(<GuestCountField value={60} onChange={() => {}} />)
    expect(html).toContain('type="number"')
    expect(html).toContain('max="200"')
    expect(html).toContain('value="60"')
  })
  it('value<=8 顯示 chips 與 9+ 展開鈕、無自訂輸入框', () => {
    const html = renderToStaticMarkup(<GuestCountField value={4} onChange={() => {}} />)
    expect(html).toContain('9+ ▾')
    expect(html).not.toContain('type="number"')
  })
})
