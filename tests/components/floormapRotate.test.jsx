import { describe, it, expect } from 'vitest'
import { rotateFloor180, computeFloorContentBBox } from '../../src/components/admin/floormap/FloorMap'
import { FIXTURES, INITIAL_TABLES } from '../../src/data/tables'

// 顯示方向轉 180°：只換畫的位置、不改存檔資料；1F 的領位台要轉到左上
const t1F = (INITIAL_TABLES || []).filter(t => t.floor === '1F')

describe('rotateFloor180', () => {
  it('領位台（111 下方、原本右下）轉到左上；轉兩次回到原位；不改原陣列', () => {
    const before = JSON.stringify(FIXTURES['1F'])
    const { tables, fixtures } = rotateFloor180(t1F, FIXTURES['1F'])
    const host = fixtures.find(f => f.id === 'f1-drinks')
    const bb = computeFloorContentBBox(tables, fixtures)
    expect(host.x - bb.minX).toBeLessThan((bb.maxX - bb.minX) / 2)
    expect(host.y - bb.minY).toBeLessThan((bb.maxY - bb.minY) / 2)
    const back = rotateFloor180(tables, fixtures)
    expect(back.tables.map(t => [t.number, t.x, t.y])).toEqual(t1F.map(t => [t.number, t.x, t.y]))
    expect(JSON.stringify(FIXTURES['1F'])).toBe(before)
  })

  it('內容範圍不變（不會被裁切）；「↑ 上樓」箭頭跟著反向', () => {
    const { tables, fixtures } = rotateFloor180(t1F, FIXTURES['1F'].filter(f => f.type !== 'label'))
    expect(computeFloorContentBBox(tables, fixtures)).toEqual(computeFloorContentBBox(t1F, FIXTURES['1F'].filter(f => f.type !== 'label')))
    const up = rotateFloor180(t1F, FIXTURES['1F']).fixtures.find(f => f.id === 'f1-stairs-up')
    expect(up.text).toBe('↓ 上樓')
  })
})
