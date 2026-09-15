import { describe, it, expect } from 'vitest'
import {
  BUS_SEPARATOR,
  SPECIAL_FIELDS,
  TOTAL_PRESETS,
  composeBusInfo,
  parseBusInfo,
  overSpecialCounts,
  specialOverMessage,
} from '../../src/components/admin/planning/groupEditorFields'

describe('composeBusInfo 三格 → busInfo 字串', () => {
  it('三格齊全依固定順序合成', () => {
    expect(composeBusInfo({ plate: 'KAA-1234', phone: '0912345678', eta: '10:45' }))
      .toBe(`車號 KAA-1234${BUS_SEPARATOR}司機 0912345678${BUS_SEPARATOR}抵達 10:45`)
  })
  it('空項省略、不留孤兒分隔符', () => {
    expect(composeBusInfo({ plate: 'KAA-1234', phone: '', eta: '' })).toBe('車號 KAA-1234')
    expect(composeBusInfo({ plate: '', phone: '', eta: '11:00' })).toBe('抵達 11:00')
    expect(composeBusInfo({ plate: '', phone: '0912', eta: '11:00' })).toBe(`司機 0912${BUS_SEPARATOR}抵達 11:00`)
  })
  it('三格全空 → 空字串（存回 busInfo 就是「沒填」）', () => {
    expect(composeBusInfo({})).toBe('')
    expect(composeBusInfo({ plate: '  ', phone: '', eta: '' })).toBe('')
    expect(composeBusInfo()).toBe('')
  })
})

describe('parseBusInfo busInfo 字串 → 三格', () => {
  it('合成過的字串可完整拆回（round-trip）', () => {
    const bus = { plate: 'KAA-1234', phone: '0912345678', eta: '10:45' }
    expect(parseBusInfo(composeBusInfo(bus))).toEqual(bus)
  })
  it('只有部分欄位也拆得回', () => {
    expect(parseBusInfo('車號 KAA-1234')).toEqual({ plate: 'KAA-1234', phone: '', eta: '' })
    expect(parseBusInfo(`司機 0912345678${BUS_SEPARATOR}抵達 09:05`))
      .toEqual({ plate: '', phone: '0912345678', eta: '09:05' })
  })
  it('空值 → 三格皆空', () => {
    expect(parseBusInfo('')).toEqual({ plate: '', phone: '', eta: '' })
    expect(parseBusInfo(null)).toEqual({ plate: '', phone: '', eta: '' })
    expect(parseBusInfo(undefined)).toEqual({ plate: '', phone: '', eta: '' })
  })
  it('🔴 舊資料相容：拆不回的自由字串整段進車號格，絕不丟資料', () => {
    expect(parseBusInfo('2 台')).toEqual({ plate: '2 台', phone: '', eta: '' })
    expect(parseBusInfo('阿明的車，中午前到')).toEqual({ plate: '阿明的車，中午前到', phone: '', eta: '' })
    // 舊手寫格式：有「車號」關鍵字就拆得出來
    expect(parseBusInfo('車號 AB-123')).toEqual({ plate: 'AB-123', phone: '', eta: '' })
  })
  it('抵達時間格式不合（餵不進 <input type="time">）→ 整段退回車號格', () => {
    expect(parseBusInfo('車號 AB-1｜抵達 中午前')).toEqual({ plate: '車號 AB-1｜抵達 中午前', phone: '', eta: '' })
  })
  it('容忍其他分隔符與「司機電話 / 預計抵達時間」等寫法', () => {
    expect(parseBusInfo('車號 AB-1、司機電話 0911222333、預計抵達時間 9:05'))
      .toEqual({ plate: 'AB-1', phone: '0911222333', eta: '09:05' })
  })
  it('🔴 值裡含全形逗號也不會被腰斬（舊備註搬進車號格後再補司機電話存檔）', () => {
    const legacy = '2 台，阿明的車中午前到'
    expect(parseBusInfo(legacy)).toEqual({ plate: legacy, phone: '', eta: '' })
    // 店員接著補了司機電話 → 合成 → 再打開，車號整段要完好回來
    const saved = composeBusInfo({ plate: legacy, phone: '0912345678', eta: '' })
    expect(parseBusInfo(saved)).toEqual({ plate: legacy, phone: '0912345678', eta: '' })
  })
  it('認不得的殘段 → 整段退回車號格，不會只留拆得出來的那半', () => {
    expect(parseBusInfo('AB-123｜司機 0912')).toEqual({ plate: 'AB-123｜司機 0912', phone: '', eta: '' })
  })
  it('值裡被打進 ｜ 會換成 ／（不讓分隔符混進值裡毀掉下次拆解）', () => {
    expect(composeBusInfo({ plate: 'A｜B' })).toBe('車號 A／B')
    expect(parseBusInfo(composeBusInfo({ plate: 'A｜B', phone: '0912' })))
      .toEqual({ plate: 'A／B', phone: '0912', eta: '' })
  })
  it('時間補零成 HH:MM（<input type="time"> 只吃這個格式）', () => {
    expect(parseBusInfo('抵達 9:30').eta).toBe('09:30')
  })
})

describe('overSpecialCounts / specialOverMessage 特殊需求不得超過總人數', () => {
  const base = { total: 20, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 }

  it('都不超過 → 無錯誤', () => {
    expect(overSpecialCounts({ ...base, vegetarian: 20, child: 20 })).toEqual([])
    expect(specialOverMessage({ ...base, vegetarian: 20 })).toBeNull()
  })
  it('單項超過總人數 → 指出是哪一項（Barry 截圖的「素食 44 / 總人數 20」）', () => {
    const counts = { ...base, vegetarian: 44 }
    expect(overSpecialCounts(counts)).toEqual([{ key: 'vegetarian', label: '素食', value: 44, total: 20 }])
    expect(specialOverMessage(counts)).toBe('素食 44 人超過總人數 20，先改總人數或減少這項')
  })
  it('🔴 四項可重疊（素食兒童同一人）→ 只擋單項超過、不擋合計', () => {
    const counts = { ...base, vegetarian: 15, child: 12 } // 合計 27 > 20，但各自都沒超過
    expect(overSpecialCounts(counts)).toEqual([])
    expect(specialOverMessage(counts)).toBeNull()
  })
  it('總人數 0 時任何特殊項 > 0 都算超過（先填總人數）', () => {
    expect(specialOverMessage({ ...base, total: 0, wheelchair: 1 }))
      .toBe('輪椅 1 人超過總人數 0，先改總人數或減少這項')
  })
  it('多項同時超過時回報第一項（欄位順序）', () => {
    const counts = { ...base, total: 5, child: 9, mobility: 8 }
    expect(overSpecialCounts(counts).map(o => o.key)).toEqual(['child', 'mobility'])
    expect(specialOverMessage(counts)).toContain('兒童 9')
  })
})

describe('常數與 schema 對齊', () => {
  it('特殊需求 key 必須與 counts schema 一致（存檔欄位名不可改）', () => {
    expect(SPECIAL_FIELDS.map(f => f.key)).toEqual(['vegetarian', 'child', 'mobility', 'wheelchair'])
  })
  it('總人數快速鍵＝店主口語的車型', () => {
    expect(TOTAL_PRESETS.map(p => p.total)).toEqual([20, 43, 86])
  })
})
