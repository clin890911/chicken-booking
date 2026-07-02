import { describe, it, expect } from 'vitest'
import { sanitizeExportLog } from '../../functions/lib/exportLog.js'

// 匯出稽核紀錄純邏輯（functions/lib/exportLog.js）。
// 重點：actor / at 由伺服器決定（不取自客戶端）、其餘欄位型別與長度夾限。

const NOW = '2026-07-02T00:00:00.000Z'

describe('sanitizeExportLog', () => {
  it('actor 與 at 一律由伺服器帶入，忽略客戶端塞的值', () => {
    const out = sanitizeExportLog({ actor: 'attacker@evil.com', at: '1999-01-01' }, 'Boss@Example.com', NOW)
    expect(out.actor).toBe('boss@example.com') // 小寫化、來自參數而非 body
    expect(out.at).toBe(NOW)
  })

  it('type 僅允許 bookings / groups，其他一律 bookings', () => {
    expect(sanitizeExportLog({ type: 'groups' }, 'a@b.co', NOW).type).toBe('groups')
    expect(sanitizeExportLog({ type: 'bookings' }, 'a@b.co', NOW).type).toBe('bookings')
    expect(sanitizeExportLog({ type: 'evil' }, 'a@b.co', NOW).type).toBe('bookings')
    expect(sanitizeExportLog({}, 'a@b.co', NOW).type).toBe('bookings')
  })

  it('count 取整、夾限在 0..1e7', () => {
    expect(sanitizeExportLog({ count: 12.9 }, 'a@b.co', NOW).count).toBe(12)
    expect(sanitizeExportLog({ count: -5 }, 'a@b.co', NOW).count).toBe(0)
    expect(sanitizeExportLog({ count: 99999999 }, 'a@b.co', NOW).count).toBe(10000000)
    expect(sanitizeExportLog({ count: 'abc' }, 'a@b.co', NOW).count).toBe(0)
  })

  it('日期 / filters 去除多餘空白並截斷長度', () => {
    const out = sanitizeExportLog(
      { dateFrom: '2026-07-01', dateTo: '2026-07-31', filters: '  來源=線上   狀態=已確認  ' },
      'a@b.co', NOW
    )
    expect(out.dateFrom).toBe('2026-07-01')
    expect(out.dateTo).toBe('2026-07-31')
    expect(out.filters).toBe('來源=線上 狀態=已確認')
    // filters 長度上限 300
    const long = sanitizeExportLog({ filters: 'x'.repeat(500) }, 'a@b.co', NOW)
    expect(long.filters.length).toBe(300)
  })
})
