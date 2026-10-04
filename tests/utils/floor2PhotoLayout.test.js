import { describe, it, expect } from 'vitest'
import { INITIAL_TABLES, FIXTURES } from '../../src/data/tables'

const tables = INITIAL_TABLES.filter(t => t.floor === '2F')
const table = n => tables.find(t => t.number === String(n))
const pairs = [[201,203],[202,205],[207,210],[208,211],[209,212],
  [255,258],[256,259],[257,260],[261,265],[262,266],[263,267]]
const rows = [[201,203,207,210,213],[202,205,208,211,215],[206,209,212],
  [251,255,258,261,265],[252,256,259,262,266],[253,257,260,263,267],
  [221,226,230],[222,227,231],[223,228,232],[225,229,233]]

describe('二樓照片預設：桌號、容量與實體左右接合', () => {
  it('照片40桌全數存在，容量沿用13六人及27四人、186席', () => {
    expect(tables.map(t => t.number).sort()).toEqual(rows.flat().map(String).sort())
    expect(tables.filter(t => t.capacity === 6).map(t => t.number).sort()).toEqual(
      [201,202,203,205,206,210,211,212,213,215,258,259,260].map(String).sort())
    expect(tables.filter(t => t.capacity === 4)).toHaveLength(27)
    expect(tables.reduce((sum,t) => sum+t.capacity,0)).toBe(186)
  })
  it('照片中的11組雙桌左右接邊，同行順序與走道正確且無桌位重疊', () => {
    for (const [a,b] of pairs) {
      expect(table(a).x + table(a).w).toBe(table(b).x)
      expect(table(a).y).toBe(table(b).y)
    }
    for (const row of rows) for (let i=1;i<row.length;i++) {
      expect(table(row[i-1]).x + table(row[i-1]).w).toBeLessThanOrEqual(table(row[i]).x)
    }
    for (let i=0;i<tables.length;i++) for (let j=i+1;j<tables.length;j++) {
      const a=tables[i], b=tables[j]
      expect(a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h).toBe(false)
    }
    expect(table(251).x + table(251).w).toBeLessThan(table(255).x)
    expect(table(258).x + table(258).w).toBeLessThan(table(261).x)
    for (const row of [[221,226,230],[222,227,231],[223,228,232],[225,229,233]]) {
      for (let i=1;i<row.length;i++) expect(table(row[i-1]).x+table(row[i-1]).w).toBeLessThan(table(row[i]).x)
    }
  })
  it('樓梯在上排左中縱向、醬料台在底端旁，牆面分隔下左與下右區', () => {
    const fixture = id => FIXTURES['2F'].find(f => f.id === id)
    const stairs = fixture('f2-stairs'), sauce = fixture('f2-sauce')
    expect(stairs.h).toBeGreaterThan(stairs.w)
    expect(stairs.x+stairs.w).toBeLessThan(table(201).x)
    expect(sauce.y).toBeGreaterThanOrEqual(stairs.y+stairs.h)
    expect(sauce.x).toBeGreaterThan(stairs.x+stairs.w)
    const leftWall=fixture('f2-wall-left-bottom'), rightWall=fixture('f2-wall-right-bottom')
    expect(leftWall.x+leftWall.w).toBeLessThan(table(251).x)
    expect(table(265).x+table(265).w).toBeLessThan(rightWall.x)
    expect(rightWall.x+rightWall.w).toBeLessThan(table(221).x)
    expect(fixture('f2-fridge').y+fixture('f2-fridge').h).toBeLessThan(table(201).y)
    expect(fixture('f2-wc').y+fixture('f2-wc').h).toBeLessThan(table(213).y)
  })
})
