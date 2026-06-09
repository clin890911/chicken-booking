// customerService 測試
// 覆蓋：upsert / getByPhone / search / update / setBlacklist / setVipTier
//        archive / unarchive / listAll / summary / remove
// 重點：phone 正規化、預設值、visits++ / totalGuests 累加、name 更新、資料隔離、排序、統計
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as customerService from '../../src/services/customerService'

const {
  listAll,
  getByPhone,
  search,
  upsert,
  update,
  remove,
  setBlacklist,
  setVipTier,
  archive,
  unarchive,
  summary,
} = customerService

const STORAGE_KEY = 'chicken_customers_v1'

// 固定系統時間到 2026-06-15 12:00（本地），確保時間相依函式可重複
const FIXED_TIME = new Date(2026, 5, 15, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_TIME)
})

afterEach(() => {
  vi.useRealTimers()
})

// 直接讀後端，驗證實際持久化內容
function rawStore() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
}

describe('customerService.upsert', () => {
  it('新建：套用所有預設值並回傳新紀錄', () => {
    const rec = upsert({ phone: '0912345678', name: '阿明', partySize: 4, source: 'line', notes: '靠窗' })
    expect(rec).not.toBeNull()
    expect(rec.phone).toBe('0912345678')
    expect(rec.name).toBe('阿明')
    expect(rec.visits).toBe(1)
    expect(rec.totalGuests).toBe(4)
    expect(rec.totalSpend).toBe(0)
    expect(rec.notes).toBe('靠窗')
    expect(rec.allergies).toBe('')
    expect(rec.blacklisted).toBe(false)
    expect(rec.vipTier).toBe('none')
    expect(rec.archived).toBe(false)
    expect(rec.source).toBe('line')
    expect(rec.lineUserId).toBe(null)
    expect(rec.lastVisit).toBe(FIXED_TIME.toISOString())
    expect(rec.createdAt).toBe(FIXED_TIME.toISOString())
    expect(rec.updatedAt).toBe(FIXED_TIME.toISOString())
  })

  it('新建：未給 source 預設 walk-in、未給 name 為空字串、未給 notes 為空字串', () => {
    const rec = upsert({ phone: '0900000001' })
    expect(rec.source).toBe('walk-in')
    expect(rec.name).toBe('')
    expect(rec.notes).toBe('')
    expect(rec.totalGuests).toBe(0) // partySize undefined → Number(undefined)||0 = 0
    expect(rec.visits).toBe(1)
  })

  it('新建：lineUserId 有給則保存', () => {
    const rec = upsert({ phone: '0900000002', lineUserId: 'U123' })
    expect(rec.lineUserId).toBe('U123')
  })

  it('phone 正規化：去除空白、連字號與加號後當主鍵', () => {
    const rec = upsert({ phone: ' 091-234 5678 ', name: 'A' })
    expect(rec.phone).toBe('0912345678')
    // 不同寫法應命中同一筆
    expect(getByPhone('+0912345678')).not.toBeNull()
    expect(getByPhone('0912345678').phone).toBe('0912345678')
    expect(Object.keys(rawStore())).toEqual(['0912345678'])
  })

  it('空 phone（或正規化後為空）回傳 null 且不寫入', () => {
    expect(upsert({ phone: '' })).toBeNull()
    expect(upsert({ phone: '   ' })).toBeNull()
    expect(upsert({ phone: '+++---' })).toBeNull()
    expect(upsert({})).toBeNull()
    expect(Object.keys(rawStore())).toHaveLength(0)
  })

  it('再次 upsert 同一人：visits++、totalGuests 累加、name 更新、lastVisit/updatedAt 刷新', () => {
    upsert({ phone: '0912000111', name: '舊名', partySize: 2 })

    // 推進時間到第二次造訪
    const t2 = new Date(2026, 5, 16, 18, 30, 0)
    vi.setSystemTime(t2)
    const rec = upsert({ phone: '0912000111', name: '新名', partySize: 3 })

    expect(rec.visits).toBe(2)
    expect(rec.totalGuests).toBe(5) // 2 + 3
    expect(rec.name).toBe('新名')
    expect(rec.lastVisit).toBe(t2.toISOString())
    expect(rec.updatedAt).toBe(t2.toISOString())
    // createdAt 不應被改動
    expect(rec.createdAt).toBe(FIXED_TIME.toISOString())
    // 仍只有一筆
    expect(Object.keys(rawStore())).toHaveLength(1)
  })

  it('再次 upsert 未給 name：保留既有 name（不覆蓋成空）', () => {
    upsert({ phone: '0912000222', name: '原本' })
    const rec = upsert({ phone: '0912000222', partySize: 1 })
    expect(rec.name).toBe('原本')
    expect(rec.visits).toBe(2)
  })

  it('再次 upsert 未給 lineUserId：保留既有 lineUserId', () => {
    upsert({ phone: '0912000333', lineUserId: 'Uabc' })
    const rec = upsert({ phone: '0912000333' })
    expect(rec.lineUserId).toBe('Uabc')
  })

  it('partySize 為非數字字串時以 0 計', () => {
    const rec = upsert({ phone: '0912000444', partySize: 'abc' })
    expect(rec.totalGuests).toBe(0)
    const rec2 = upsert({ phone: '0912000444', partySize: '6' }) // 數字字串可轉
    expect(rec2.totalGuests).toBe(6)
  })
})

describe('customerService.getByPhone', () => {
  it('正規化後命中', () => {
    upsert({ phone: '0912345678', name: 'A' })
    expect(getByPhone('091 234-5678').name).toBe('A')
  })

  it('查無此人回 null', () => {
    expect(getByPhone('0900000000')).toBeNull()
  })

  it('空值 / 正規化後為空回 null', () => {
    expect(getByPhone('')).toBeNull()
    expect(getByPhone('   ')).toBeNull()
    expect(getByPhone(null)).toBeNull()
    expect(getByPhone(undefined)).toBeNull()
  })
})

describe('customerService.search', () => {
  beforeEach(() => {
    upsert({ phone: '0911111111', name: '王小明' })
    upsert({ phone: '0922222222', name: 'Alice' })
    upsert({ phone: '0933333333', name: '李大華' })
  })

  it('依電話片段查詢', () => {
    const res = search('0922')
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('Alice')
  })

  it('依電話且查詢字串含空白/連字號（會被正規化）', () => {
    const res = search('091-11')
    expect(res.map(c => c.phone)).toContain('0911111111')
  })

  it('依姓名查詢（中文）', () => {
    const res = search('小明')
    expect(res).toHaveLength(1)
    expect(res[0].phone).toBe('0911111111')
  })

  it('依姓名查詢不分大小寫', () => {
    const res = search('alice')
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('Alice')
  })

  it('查詢字串前後空白會被 trim', () => {
    const res = search('  Alice  ')
    expect(res).toHaveLength(1)
  })

  it('空查詢 / 純空白 / null 回空陣列', () => {
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
    expect(search(null)).toEqual([])
    expect(search(undefined)).toEqual([])
  })

  it('查無結果回空陣列', () => {
    expect(search('找不到的人')).toEqual([])
  })
})

describe('customerService.update', () => {
  it('成功 patch 並刷新 updatedAt', () => {
    upsert({ phone: '0912345678', name: 'A' })
    const t2 = new Date(2026, 5, 20, 9, 0, 0)
    vi.setSystemTime(t2)
    const rec = update('0912345678', { notes: 'VIP 客', allergies: '海鮮' })
    expect(rec.notes).toBe('VIP 客')
    expect(rec.allergies).toBe('海鮮')
    expect(rec.updatedAt).toBe(t2.toISOString())
    // 持久化
    expect(rawStore()['0912345678'].notes).toBe('VIP 客')
  })

  it('phone 正規化後找人', () => {
    upsert({ phone: '0912345678', name: 'A' })
    const rec = update('091-234 5678', { name: 'B' })
    expect(rec.name).toBe('B')
  })

  it('找不到回 null 且不新增紀錄', () => {
    expect(update('0900000000', { name: 'X' })).toBeNull()
    expect(Object.keys(rawStore())).toHaveLength(0)
  })

  it('空 phone 回 null', () => {
    expect(update('', { name: 'X' })).toBeNull()
    expect(update('   ', { name: 'X' })).toBeNull()
  })
})

describe('customerService.setBlacklist', () => {
  it('設為黑名單並帶 reason', () => {
    upsert({ phone: '0912345678', name: 'A' })
    const rec = setBlacklist('0912345678', true, '多次 no-show')
    expect(rec.blacklisted).toBe(true)
    expect(rec.blacklistReason).toBe('多次 no-show')
  })

  it('解除黑名單，reason 預設空字串', () => {
    upsert({ phone: '0912345678', name: 'A' })
    setBlacklist('0912345678', true, '原因')
    const rec = setBlacklist('0912345678', false)
    expect(rec.blacklisted).toBe(false)
    expect(rec.blacklistReason).toBe('')
  })

  it('對不存在的人回 null', () => {
    expect(setBlacklist('0900000000', true)).toBeNull()
  })
})

describe('customerService.setVipTier', () => {
  beforeEach(() => {
    upsert({ phone: '0912345678', name: 'A' })
  })

  it('合法 tier：none/bronze/silver/gold 皆可設定', () => {
    for (const tier of ['none', 'bronze', 'silver', 'gold']) {
      const rec = setVipTier('0912345678', tier)
      expect(rec).not.toBeNull()
      expect(rec.vipTier).toBe(tier)
    }
  })

  it('非法 tier 回 null 且不變更既有資料', () => {
    setVipTier('0912345678', 'gold')
    expect(setVipTier('0912345678', 'platinum')).toBeNull()
    expect(setVipTier('0912345678', '')).toBeNull()
    expect(setVipTier('0912345678', 'GOLD')).toBeNull() // 大小寫敏感
    // 資料仍維持 gold
    expect(getByPhone('0912345678').vipTier).toBe('gold')
  })

  it('合法 tier 但顧客不存在仍回 null', () => {
    expect(setVipTier('0900000000', 'gold')).toBeNull()
  })
})

describe('customerService.archive / unarchive', () => {
  it('archive 設 archived=true，unarchive 設回 false', () => {
    upsert({ phone: '0912345678', name: 'A' })
    expect(archive('0912345678').archived).toBe(true)
    expect(unarchive('0912345678').archived).toBe(false)
  })

  it('對不存在的人 archive/unarchive 回 null', () => {
    expect(archive('0900000000')).toBeNull()
    expect(unarchive('0900000000')).toBeNull()
  })

  it('archived 紀錄仍會出現在 listAll（原始碼未過濾）', () => {
    upsert({ phone: '0912345678', name: 'A' })
    archive('0912345678')
    expect(listAll()).toHaveLength(1)
    expect(listAll()[0].archived).toBe(true)
  })
})

describe('customerService.listAll', () => {
  it('空後端回空陣列', () => {
    expect(listAll()).toEqual([])
  })

  it('依 lastVisit 由新到舊排序', () => {
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
    upsert({ phone: '0911111111', name: '最舊' })

    vi.setSystemTime(new Date(2026, 5, 12, 12, 0, 0))
    upsert({ phone: '0922222222', name: '中間' })

    vi.setSystemTime(new Date(2026, 5, 14, 12, 0, 0))
    upsert({ phone: '0933333333', name: '最新' })

    const names = listAll().map(c => c.name)
    expect(names).toEqual(['最新', '中間', '最舊'])
  })

  it('回傳所有紀錄（含黑名單與歸檔）', () => {
    upsert({ phone: '0911111111', name: 'A' })
    upsert({ phone: '0922222222', name: 'B' })
    setBlacklist('0911111111', true)
    archive('0922222222')
    expect(listAll()).toHaveLength(2)
  })
})

describe('customerService.summary', () => {
  it('空後端：全部為 0', () => {
    expect(summary()).toEqual({ total: 0, vip: 0, blacklisted: 0, repeatGuests: 0 })
  })

  it('正確統計 total / vip / blacklisted / repeatGuests', () => {
    // A: 一般、造訪 1 次
    upsert({ phone: '0911111111', name: 'A' })
    // B: VIP gold、造訪 1 次
    upsert({ phone: '0922222222', name: 'B' })
    setVipTier('0922222222', 'gold')
    // C: 黑名單、造訪 2 次（repeat）
    upsert({ phone: '0933333333', name: 'C' })
    upsert({ phone: '0933333333', name: 'C' })
    setBlacklist('0933333333', true)
    // D: VIP bronze + 造訪 3 次（同時算 vip 與 repeat）
    upsert({ phone: '0944444444', name: 'D' })
    upsert({ phone: '0944444444', name: 'D' })
    upsert({ phone: '0944444444', name: 'D' })
    setVipTier('0944444444', 'bronze')

    expect(summary()).toEqual({
      total: 4,
      vip: 2,        // B, D
      blacklisted: 1, // C
      repeatGuests: 2, // C(2), D(3)
    })
  })

  it('vipTier 設回 none 不計入 vip', () => {
    upsert({ phone: '0911111111', name: 'A' })
    setVipTier('0911111111', 'gold')
    expect(summary().vip).toBe(1)
    setVipTier('0911111111', 'none')
    expect(summary().vip).toBe(0)
  })
})

describe('customerService.remove', () => {
  it('刪除既有紀錄', () => {
    upsert({ phone: '0912345678', name: 'A' })
    expect(getByPhone('0912345678')).not.toBeNull()
    remove('0912345678')
    expect(getByPhone('0912345678')).toBeNull()
    expect(Object.keys(rawStore())).toHaveLength(0)
  })

  it('phone 正規化後刪除', () => {
    upsert({ phone: '0912345678', name: 'A' })
    remove('091-234 5678')
    expect(getByPhone('0912345678')).toBeNull()
  })

  it('刪除不存在的人不丟錯、回 undefined、不影響其他紀錄', () => {
    upsert({ phone: '0911111111', name: 'A' })
    expect(remove('0900000000')).toBeUndefined()
    expect(listAll()).toHaveLength(1)
  })
})

describe('資料隔離與持久化', () => {
  it('每個測試起始為乾淨狀態（setup 自動清空）', () => {
    expect(listAll()).toEqual([])
    expect(rawStore()).toEqual({})
  })

  it('upsert 後資料確實寫入 localStorage', () => {
    upsert({ phone: '0912345678', name: 'A' })
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(persisted['0912345678'].name).toBe('A')
  })

  it('損毀的 JSON 後端讀取時回退為空（不丟錯）', () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json')
    expect(listAll()).toEqual([])
    expect(getByPhone('0912345678')).toBeNull()
    // 仍可正常 upsert
    expect(upsert({ phone: '0912345678', name: 'A' })).not.toBeNull()
  })

  it('多筆顧客互不干擾', () => {
    upsert({ phone: '0911111111', name: 'A', partySize: 2 })
    upsert({ phone: '0922222222', name: 'B', partySize: 5 })
    expect(getByPhone('0911111111').totalGuests).toBe(2)
    expect(getByPhone('0922222222').totalGuests).toBe(5)
  })
})

describe('normalize 電話主鍵：去除所有非數字後去重', () => {
  // normalize 已改為 replace(/\D/g,'')，括號/點號/空白/連字號都會被去除，
  // 確保同一電話不論輸入格式都對應同一顧客檔。
  it('含括號的電話正規化為同一主鍵，命中同一筆', () => {
    upsert({ phone: '0912345678', name: 'A' })
    expect(getByPhone('(091)2345678')).not.toBeNull()
    expect(getByPhone('09-1234-5678')).not.toBeNull()
    expect(getByPhone('0912 345 678')).not.toBeNull()
  })
})
