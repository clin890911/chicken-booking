import { describe, it, expect } from 'vitest'
import { INITIAL_TABLES, FIXTURES } from '../../src/data/tables'

const tables = INITIAL_TABLES.filter(t => t.floor === '1F')
const table = n => tables.find(t => t.number === String(n))
const fixtures = FIXTURES['1F']
const fixture = id => fixtures.find(f => f.id === id)
const overlaps = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h

describe('一樓照片預設：桌號、容量與現場設施', () => {
  it('12桌維持6張四人、6張六人、60席，跳號104保持不存在', () => {
    expect(tables.map(t => t.number).sort()).toEqual(
      [101,102,103,105,106,107,108,109,110,111,112,113].map(String))
    expect(tables.filter(t => t.capacity === 6).map(t => t.number).sort()).toEqual(
      [101,102,103,108,109,110].map(String))
    expect(tables.filter(t => t.capacity === 4)).toHaveLength(6)
    expect(tables.reduce((sum,t) => sum+t.capacity,0)).toBe(60)
  })

  it('左右壁桌由上至下正確，中央三組左右接邊且與右側桌同行', () => {
    for (const column of [[103,102,101],[107,106,105],[110,109,108],[113,112,111]]) {
      for (let i=1;i<column.length;i++) {
        expect(table(column[i]).x).toBe(table(column[0]).x)
        expect(table(column[i-1]).y+table(column[i-1]).h).toBeLessThan(table(column[i]).y)
      }
    }
    for (const [left,right,single] of [[107,110,113],[106,109,112],[105,108,111]]) {
      expect(table(left).x+table(left).w).toBe(table(right).x)
      expect(table(left).y).toBe(table(right).y)
      expect(table(right).y).toBe(table(single).y)
      expect(table(right).x+table(right).w).toBeLessThan(table(single).x)
    }
    for (const n of [103,102,101]) expect(table(n).x).toBe(fixture('f1-wall-left').x+fixture('f1-wall-left').w)
    for (let i=0;i<tables.length;i++) for (let j=i+1;j<tables.length;j++) {
      expect(overlaps(tables[i],tables[j])).toBe(false)
    }
  })

  it('頂部醬料台、出菜口、結帳口依序，右壁縱樓梯及左側縱冰箱留出走道', () => {
    const sauce=fixture('f1-sauce'), serve=fixture('f1-serve'), cashier=fixture('f1-cashier')
    expect(sauce.x+sauce.w).toBeLessThan(serve.x)
    expect(serve.x).toBeLessThan(cashier.x)
    for (const f of [sauce,serve,cashier]) expect(f.y+f.h).toBeLessThan(table(103).y)
    const stairs=fixture('f1-stairs'), fridge=fixture('f1-fridge'), up=fixture('f1-stairs-up')
    expect(stairs.h).toBeGreaterThan(stairs.w)
    expect(fridge.h).toBeGreaterThan(fridge.w)
    expect(table(113).x+table(113).w).toBeLessThan(fridge.x)
    expect(fridge.x+fridge.w).toBeLessThan(stairs.x)
    expect(stairs.x+stairs.w).toBe(fixture('f1-wall-right').x)
    expect(up.y).toBeGreaterThan(stairs.y+stairs.h)
    expect(up.x).toBeGreaterThanOrEqual(stairs.x)
    expect(up.text).toContain('↑')
    expect(up.text).toContain('上樓')
  })

  it('玻璃門位於左下、飲料台在111下方，劃掉的錢櫃台不預設成領位台', () => {
    const door=fixture('f1-door'), drinks=fixture('f1-drinks')
    expect(door.y).toBeGreaterThan(table(101).y+table(101).h)
    expect(door.x).toBe(fixture('f1-wall-left').x)
    expect(door.text).toBe('玻璃門入口')
    expect(drinks.x).toBe(table(111).x)
    expect(drinks.y).toBeGreaterThan(table(111).y+table(111).h)
    expect(drinks.text).toBe('飲料台')
    expect(fixtures.some(f => f.id === 'f1-host' || /領位|錢櫃/.test(f.text))).toBe(false)
    expect(new Set(fixtures.map(f => f.id)).size).toBe(fixtures.length)
    for (const t of tables) for (const f of fixtures) expect(overlaps(t,f)).toBe(false)
  })
})
