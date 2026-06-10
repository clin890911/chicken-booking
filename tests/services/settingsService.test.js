import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSettings, saveSettings } from '../../src/services/settingsService'

// 與原始碼一致的儲存鍵與預設值（用來驗證合併/回退行為）
const STORAGE_KEY = 'chicken_settings_v1'

const DEFAULT = {
  openTime: '11:00',
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  diningDurationMin: 90,
  cleanupBufferMin: 10,
  autoReleaseEnabled: true,
  autoReleaseAfterMin: 300,
  dayRolloverEnabled: true,
  autoNoshowOnRollover: false,
  onlineAutoCloseEnabled: false,
  onlineAutoClosePercent: 80,
  onlineSessionCutoffMin: 0,
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
    { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
  ],
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
  heroBanners: [],
  lineOfficialUrl: 'https://lin.ee/8lECi4S',
  lineOfficialName: '雞王涮涮鍋 LINE 官方帳號',
  lineUseLiff: true,
  lineLiffUrl: 'https://liff.line.me/2009996489-f1SCb75q',
  lineLiffId: '2009996489-f1SCb75q',
  lineBindEndpoint: 'https://linebind-reaor76eyq-uc.a.run.app',
  linePushEndpoint: 'https://linepushbooking-reaor76eyq-uc.a.run.app',
  lineManageEndpoint: 'https://linegetbooking-reaor76eyq-uc.a.run.app',
  publicSiteUrl: '',
  lineNotifyOnAdminChange: false,
  storeName: '雞王涮涮鍋',
  storePhone: '049-2753377',
  storeAddress: '南投縣鹿谷鄉中正路二段377號',
  storeMapUrl: 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E6%8A%95%E7%B8%A3%E9%B9%BF%E8%B0%B7%E9%84%89%E4%B8%AD%E6%AD%A3%E8%B7%AF%E4%BA%8C%E6%AE%B5377%E8%99%9F',
  storeLatitude: '23.7523874',
  storeLongitude: '120.746746'
}

// 直接寫入 localStorage 已知 JSON 的小工具（前置資料）
function seed(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
}
function seedRaw(raw) {
  localStorage.setItem(STORAGE_KEY, raw)
}

// 此 service 不讀系統時間，但依鐵則固定時鐘以確保可重複
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('settingsService', () => {
  describe('getSettings', () => {
    it('無資料時回傳完整預設值', () => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      const s = getSettings()
      expect(s).toEqual(DEFAULT)
    })

    it('無資料時回傳的物件每個欄位都等於對應預設值', () => {
      const s = getSettings()
      for (const key of Object.keys(DEFAULT)) {
        expect(s[key]).toEqual(DEFAULT[key])
      }
    })

    it('heroBanners 預設為空陣列', () => {
      const s = getSettings()
      expect(Array.isArray(s.heroBanners)).toBe(true)
      expect(s.heroBanners).toEqual([])
    })

    it('有資料時：自訂欄位覆蓋預設、缺漏欄位補預設（合併）', () => {
      seed({ openTime: '10:00', storeName: '測試店' })
      const s = getSettings()
      // 被覆蓋的欄位
      expect(s.openTime).toBe('10:00')
      expect(s.storeName).toBe('測試店')
      // 未提供的欄位回退預設
      expect(s.closeTime).toBe(DEFAULT.closeTime)
      expect(s.slotInterval).toBe(DEFAULT.slotInterval)
      expect(s.lineOfficialUrl).toBe(DEFAULT.lineOfficialUrl)
    })

    it('有資料時：保留 DEFAULT 以外的額外欄位（spread 合併）', () => {
      seed({ customExtra: 'hello' })
      const s = getSettings()
      expect(s.customExtra).toBe('hello')
      // 同時仍補齊預設
      expect(s.openTime).toBe(DEFAULT.openTime)
    })

    it('有資料時：合法數字字串會被正規化為數字', () => {
      seed({ diningDurationMin: '120', cleanupBufferMin: '15' })
      const s = getSettings()
      expect(s.diningDurationMin).toBe(120)
      expect(s.cleanupBufferMin).toBe(15)
    })

    it('壞 JSON 時回傳完整預設值（不丟例外）', () => {
      seedRaw('{ this is : not valid json ]')
      let s
      expect(() => { s = getSettings() }).not.toThrow()
      expect(s).toEqual(DEFAULT)
    })

    it('空字串（非合法 JSON 但 falsy raw）時回傳預設值', () => {
      // raw = '' 為 falsy → 走 !raw 分支回預設
      seedRaw('')
      const s = getSettings()
      expect(s).toEqual(DEFAULT)
    })

    it('JSON 為 null 字面值時不丟例外並回退預設', () => {
      // JSON.parse('null') === null；withDefaults(null) 會以 null 預設參數覆蓋
      // 注意：withDefaults(value=...) 的預設參數只在 undefined 時生效，傳 null 不會套用
      seedRaw('null')
      let s
      expect(() => { s = getSettings() }).not.toThrow()
      // { ...DEFAULT, ...null } => DEFAULT（spread null 為 no-op）
      expect(s).toEqual(DEFAULT)
    })

    it('每次呼叫互不影響：修改回傳物件不會污染後續呼叫', () => {
      const a = getSettings()
      a.openTime = 'MUTATED'
      a.heroBanners.push('x')
      const b = getSettings()
      expect(b.openTime).toBe(DEFAULT.openTime)
      // heroBanners 來自共享的 DEFAULT 參考；記錄此資料隔離風險於 SUSPECT 測試
      expect(b.openTime).not.toBe('MUTATED')
    })
  })

  describe('saveSettings', () => {
    it('部分 patch 合併：只更新指定欄位，其餘維持預設', () => {
      const result = saveSettings({ openTime: '09:30' })
      expect(result.openTime).toBe('09:30')
      expect(result.closeTime).toBe(DEFAULT.closeTime)
      expect(result.storeName).toBe(DEFAULT.storeName)
    })

    it('回傳完整含預設的設定物件（所有 DEFAULT 欄位皆存在）', () => {
      const result = saveSettings({ storePhone: '02-12345678' })
      for (const key of Object.keys(DEFAULT)) {
        expect(result).toHaveProperty(key)
      }
      expect(result.storePhone).toBe('02-12345678')
    })

    it('會把結果持久化到 localStorage，下次 getSettings 讀得到', () => {
      saveSettings({ storeName: '新名字', closeTime: '20:00' })
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY))
      expect(persisted.storeName).toBe('新名字')
      expect(persisted.closeTime).toBe('20:00')
      const reread = getSettings()
      expect(reread.storeName).toBe('新名字')
      expect(reread.closeTime).toBe('20:00')
    })

    it('連續多次 saveSettings 會累積合併（以既有設定為基底）', () => {
      saveSettings({ openTime: '08:00' })
      const result = saveSettings({ closeTime: '22:00' })
      // 第二次 patch 之外，第一次設定仍保留
      expect(result.openTime).toBe('08:00')
      expect(result.closeTime).toBe('22:00')
    })

    it('diningDurationMin 為合法正數時保留該值', () => {
      const result = saveSettings({ diningDurationMin: 120 })
      expect(result.diningDurationMin).toBe(120)
    })

    it('diningDurationMin 為非數字字串時回退預設', () => {
      const result = saveSettings({ diningDurationMin: 'abc' })
      expect(result.diningDurationMin).toBe(DEFAULT.diningDurationMin)
    })

    it('cleanupBufferMin 為非數字字串時回退預設', () => {
      const result = saveSettings({ cleanupBufferMin: 'xyz' })
      expect(result.cleanupBufferMin).toBe(DEFAULT.cleanupBufferMin)
    })

    it('diningDurationMin 為 null 時回退預設', () => {
      const result = saveSettings({ diningDurationMin: null })
      expect(result.diningDurationMin).toBe(DEFAULT.diningDurationMin)
    })

    it('cleanupBufferMin 為 undefined 時回退預設', () => {
      const result = saveSettings({ cleanupBufferMin: undefined })
      expect(result.cleanupBufferMin).toBe(DEFAULT.cleanupBufferMin)
    })

    it('diningDurationMin 合法數字字串被正規化為 number 型別', () => {
      const result = saveSettings({ diningDurationMin: '75' })
      expect(result.diningDurationMin).toBe(75)
      expect(typeof result.diningDurationMin).toBe('number')
    })

    it('lineUseLiff 會被布林化：truthy → true', () => {
      const result = saveSettings({ lineUseLiff: 'yes' })
      expect(result.lineUseLiff).toBe(true)
      expect(typeof result.lineUseLiff).toBe('boolean')
    })

    it('lineUseLiff 會被布林化：1 → true', () => {
      const result = saveSettings({ lineUseLiff: 1 })
      expect(result.lineUseLiff).toBe(true)
    })

    it('lineUseLiff 會被布林化：false → false', () => {
      const result = saveSettings({ lineUseLiff: false })
      expect(result.lineUseLiff).toBe(false)
      expect(typeof result.lineUseLiff).toBe('boolean')
    })

    it('lineUseLiff 會被布林化：0 → false', () => {
      const result = saveSettings({ lineUseLiff: 0 })
      expect(result.lineUseLiff).toBe(false)
    })

    it('lineUseLiff 會被布林化：空字串 → false', () => {
      const result = saveSettings({ lineUseLiff: '' })
      expect(result.lineUseLiff).toBe(false)
    })

    it('字串欄位為空字串時回退預設：lineOfficialUrl', () => {
      const result = saveSettings({ lineOfficialUrl: '' })
      expect(result.lineOfficialUrl).toBe(DEFAULT.lineOfficialUrl)
    })

    it('字串欄位為空字串時回退預設：storeName / storePhone / storeAddress', () => {
      const result = saveSettings({ storeName: '', storePhone: '', storeAddress: '' })
      expect(result.storeName).toBe(DEFAULT.storeName)
      expect(result.storePhone).toBe(DEFAULT.storePhone)
      expect(result.storeAddress).toBe(DEFAULT.storeAddress)
    })

    it('字串欄位為空字串時回退預設：所有受保護的字串欄位', () => {
      const protectedStringFields = [
        'lineOfficialUrl', 'lineOfficialName', 'lineLiffUrl', 'lineLiffId',
        'lineBindEndpoint', 'linePushEndpoint', 'lineManageEndpoint',
        'storeName', 'storePhone', 'storeAddress', 'storeMapUrl',
        'storeLatitude', 'storeLongitude'
      ]
      const patch = {}
      for (const f of protectedStringFields) patch[f] = ''
      const result = saveSettings(patch)
      for (const f of protectedStringFields) {
        expect(result[f]).toBe(DEFAULT[f])
      }
    })

    it('publicSiteUrl：預設空字串、儲存時去前後空白（與 functions 白名單成對）', () => {
      expect(getSettings().publicSiteUrl).toBe('')
      const result = saveSettings({ publicSiteUrl: '  https://booking.example.com  ' })
      expect(result.publicSiteUrl).toBe('https://booking.example.com')
    })

    it('字串欄位提供有效值時保留覆蓋值（非空）', () => {
      const result = saveSettings({
        lineOfficialName: '自訂官方帳號',
        storeLatitude: '24.0',
        storeLongitude: '121.0'
      })
      expect(result.lineOfficialName).toBe('自訂官方帳號')
      expect(result.storeLatitude).toBe('24.0')
      expect(result.storeLongitude).toBe('121.0')
    })

    it('空 patch（undefined）：以既有設定 + 預設回傳，不丟例外', () => {
      expect(() => saveSettings(undefined)).not.toThrow()
      const result = saveSettings(undefined)
      expect(result).toEqual(DEFAULT)
    })

    it('空 patch（{}）：回傳等於預設值（在乾淨狀態下）', () => {
      const result = saveSettings({})
      expect(result).toEqual(DEFAULT)
    })

    it('狀態轉移：先 seed 既有設定，patch 只改一欄，其餘既有值保留', () => {
      seed({ openTime: '07:00', storeName: '舊店名', closeTime: '23:00' })
      const result = saveSettings({ storeName: '新店名' })
      expect(result.storeName).toBe('新店名')
      // 既有的非預設值需保留
      expect(result.openTime).toBe('07:00')
      expect(result.closeTime).toBe('23:00')
    })

    it('saveSettings 回傳值與重新讀取（getSettings）結果一致', () => {
      const returned = saveSettings({ openTime: '12:34', diningDurationMin: 100, lineUseLiff: 'on' })
      const reread = getSettings()
      expect(reread).toEqual(returned)
    })

    // ---- 邊界/可疑行為 ----

    it('diningDurationMin 為 0（falsy）回退預設 90（刻意防呆：0 分用餐時間無營運意義）', () => {
      const result = saveSettings({ diningDurationMin: 0 })
      expect(result.diningDurationMin).toBe(90)
    })

    it('cleanupBufferMin 為 0（falsy）回退預設 10（已知限制：目前無法設 0 緩衝，見 TESTING 待辦）', () => {
      const result = saveSettings({ cleanupBufferMin: 0 })
      expect(result.cleanupBufferMin).toBe(10)
    })

    it('回歸防護：getSettings 不共享 DEFAULT.heroBanners 參考，mutate 不污染後續呼叫', () => {
      // withDefaults 已對 heroBanners 做 slice() 複製；修改第一次取得的陣列不應影響後續。
      const a = getSettings()
      a.heroBanners.push('contaminated')
      const b = getSettings()
      expect(b.heroBanners).toEqual([])
    })

    it('行為記錄：負數 diningDurationMin 為 truthy，會被保留（非預設回退）', () => {
      // Number(-5) || DEFAULT → -5（truthy）。記錄此邊界，避免誤判為 bug。
      const result = saveSettings({ diningDurationMin: -5 })
      expect(result.diningDurationMin).toBe(-5)
    })

    it('行為記錄：NaN 數字輸入回退預設（Number(NaN) falsy）', () => {
      const result = saveSettings({ diningDurationMin: NaN })
      expect(result.diningDurationMin).toBe(DEFAULT.diningDurationMin)
    })
  })
})

describe('現場自動化（自動清檯）設定欄位', () => {
  it('預設值：開啟釋桌 300 分、開啟換日掃除、關閉自動 noshow', () => {
    localStorage.removeItem('chicken_settings_v1')
    const s = getSettings()
    expect(s.autoReleaseEnabled).toBe(true)
    expect(s.autoReleaseAfterMin).toBe(300)
    expect(s.dayRolloverEnabled).toBe(true)
    expect(s.autoNoshowOnRollover).toBe(false)
  })
  it('clamp：30 → 120、9999 → 720；布林正規化', () => {
    saveSettings({ autoReleaseAfterMin: 30 })
    expect(getSettings().autoReleaseAfterMin).toBe(120)
    saveSettings({ autoReleaseAfterMin: 9999 })
    expect(getSettings().autoReleaseAfterMin).toBe(720)
    saveSettings({ autoReleaseEnabled: false, autoNoshowOnRollover: true })
    const s = getSettings()
    expect(s.autoReleaseEnabled).toBe(false)
    expect(s.autoNoshowOnRollover).toBe(true)
  })
})

describe('線上訂位防線設定欄位', () => {
  it('預設值：關閉、80%、0 分鐘（不啟用場次截止）', () => {
    localStorage.removeItem('chicken_settings_v1')
    const s = getSettings()
    expect(s.onlineAutoCloseEnabled).toBe(false)
    expect(s.onlineAutoClosePercent).toBe(80)
    expect(s.onlineSessionCutoffMin).toBe(0)
  })
  it('enabled 只認布林 true；percent clamp 50–100；cutoff clamp 0–720', () => {
    expect(saveSettings({ onlineAutoCloseEnabled: 'true' }).onlineAutoCloseEnabled).toBe(false)
    expect(saveSettings({ onlineAutoCloseEnabled: true }).onlineAutoCloseEnabled).toBe(true)
    expect(saveSettings({ onlineAutoClosePercent: 30 }).onlineAutoClosePercent).toBe(50)
    expect(saveSettings({ onlineAutoClosePercent: 200 }).onlineAutoClosePercent).toBe(100)
    expect(saveSettings({ onlineAutoClosePercent: 'abc' }).onlineAutoClosePercent).toBe(80)
    expect(saveSettings({ onlineSessionCutoffMin: -5 }).onlineSessionCutoffMin).toBe(0)
    expect(saveSettings({ onlineSessionCutoffMin: 9999 }).onlineSessionCutoffMin).toBe(720)
    expect(saveSettings({ onlineSessionCutoffMin: 120 }).onlineSessionCutoffMin).toBe(120)
  })
})

describe('lineNotifyOnAdminChange（店員端通知開關）', () => {
  it('預設關閉；只有布林 true 會開啟（truthy 字串不算）', () => {
    expect(getSettings().lineNotifyOnAdminChange).toBe(false)
    expect(saveSettings({ lineNotifyOnAdminChange: true }).lineNotifyOnAdminChange).toBe(true)
    expect(saveSettings({ lineNotifyOnAdminChange: 'true' }).lineNotifyOnAdminChange).toBe(false)
    expect(saveSettings({ lineNotifyOnAdminChange: 1 }).lineNotifyOnAdminChange).toBe(false)
  })
})
