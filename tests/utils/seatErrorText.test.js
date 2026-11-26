import { describe, it, expect } from 'vitest'
import {
  seatErrorText, friendlyResult, withFriendlyErrors,
  SEAT_ERROR_DEFAULT, SYNC_ERROR_OFFLINE, SYNC_ERROR_REJECTED,
} from '../../src/utils/seatErrorText'

// 每個對照一條：raw（後端／service 原文）→ 店員句（含下一步）
const CASES = [
  ['此組已入座，請使用換桌', '這組已經入座了，要換桌請點桌子後按「換桌」'],
  ['尚未指派桌位（請先指派）', '這組還沒配桌，請先點一張空桌'],
  ['未知錯誤', SEAT_ERROR_DEFAULT],
  ['雲端拒收', SYNC_ERROR_REJECTED],
  ['部分變更因權限不足未能上雲', SYNC_ERROR_REJECTED],
  ['table-occupied-elsewhere', '這張桌剛被另一台帶位了，請換一張桌（畫面會自動更新成最新桌況）'],
  ['106 已被另一台帶位，王先生請重新帶位', '106 剛被另一台坐走了，請換一張桌'],
  ['這筆訂位不是待到狀態，無法入座', '這組不是「等待到店」的狀態，可能已入座或取消，請重新整理看最新狀態'],
  ['這筆訂位已有桌，請改用「客人到了」或改桌', '這組已經有桌了，請按「客人到了」，或改桌'],
  ['請至少選一張桌', '請先點選至少一張空桌'],
  ['106 目前不是空桌（用餐中）', '106 現在是「用餐中」，不是空桌，請換一張桌'],
  ['106 目前不是空桌', '106 現在不是空桌，請換一張桌'],
  ['106 目前由 王先生 使用，請先改桌', '106 現在是 王先生 在用，請換一張桌'],
  ['106 待清桌（上一組已用畢），請先清桌或改桌', '106 上一組剛用完還沒清桌，請先清桌或換一張'],
  ['106 停用/維修中，請先改派其他桌再入座', '106 停用或維修中，請換一張桌'],
  ['106 停用／維修中', '106 停用或維修中，請換一張桌'],
  ['106 已被佔用，無法復原', '106 已經有人坐了，沒辦法復原'],
  ['106、107 已被別組使用，無法復原', '106、107 已經有別組坐了，沒辦法復原'],
  ['106 已被下一組使用（待清桌），未復原', '106 已經換下一組了，沒辦法復原'],
  ['106 容量不足（4 人桌最多擠 5 位，此組 8 位）', '106 坐不下：4 人桌最多擠 5 位，這組有 8 位，請加桌或換大一點的桌'],
  ['106 容量不足（最多擠 5 位）', '106 坐不下，最多擠 5 位，請加桌或換大一點的桌'],
  ['所選桌合計 8 席（最多擠 10 位），不足 12 位', '座位不夠：選的桌最多擠 10 位，這組有 12 位，請再加一張桌'],
  ['併桌必須在同一樓層，請改選同層的桌', '併桌的桌子要在同一層，請改選同一層的桌'],
  ['訂位不存在', '找不到這筆訂位，可能已被取消或刪除，請重新整理'],
  ['候位記錄不存在', '找不到這組候位，可能已被處理過，請看候位清單'],
  ['桌位 106 不存在', '找不到這張桌，請重新整理桌況圖'],
  ['桌位不存在', '找不到這張桌，請重新整理桌況圖'],
  ['這筆訂位的狀態已被更動，無法復原', '這筆訂位剛被別人改過，沒辦法復原，請看一下最新狀態'],
  ['這筆訂位或桌位已被更動，無法復原', '這筆訂位剛被別人改過，沒辦法復原，請看一下最新狀態'],
  ['裝置儲存異常，請重新整理確認桌況後再操作', '這台 iPad 存檔出問題，請重新整理確認桌況後再操作'],
  ['Failed to fetch', SYNC_ERROR_OFFLINE],
  ['cloud-push-failed', SYNC_ERROR_OFFLINE],
  ['cloud-sync-failed', SYNC_ERROR_OFFLINE],
  ['連線逾時，請檢查網路後重試', SYNC_ERROR_OFFLINE],
  ['request-failed-503', SYNC_ERROR_OFFLINE],
  ['request-failed-403', SYNC_ERROR_REJECTED],
]

describe('seatErrorText 對照表', () => {
  it.each(CASES)('%s → 店員句', (raw, expected) => {
    expect(seatErrorText(raw)).toBe(expected)
  })

  it('空值／undefined／空白都走預設句', () => {
    for (const v of [undefined, null, '', '   ']) expect(seatErrorText(v)).toBe(SEAT_ERROR_DEFAULT)
  })

  it('未知的英文代碼走預設句（不把系統代碼丟給店員）', () => {
    expect(seatErrorText('operational-sync-changed')).toBe(SEAT_ERROR_DEFAULT)
    expect(seatErrorText('invalid-command-response')).toBe(SEAT_ERROR_DEFAULT)
  })

  it('已經是店員中文的句子原樣放行', () => {
    expect(seatErrorText('另一台已變更桌位或訂位；後續本機操作未套用，請確認最新桌況'))
      .toBe('另一台已變更桌位或訂位；後續本機操作未套用，請確認最新桌況')
  })

  it('每句店員話都不含內部術語殘留', () => {
    for (const [raw] of CASES) {
      const t = seatErrorText(raw)
      expect(t).not.toMatch(/請使用換桌|請先指派|未知錯誤|雲端拒收|occupied|409/)
    }
  })
})

describe('friendlyResult／withFriendlyErrors', () => {
  it('失敗結果：error 換成店員句、原文放 rawError、其他欄位（code）不動', () => {
    const r = friendlyResult({ ok: false, code: 'table-occupied', error: '此組已入座，請使用換桌' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('table-occupied')
    expect(r.rawError).toBe('此組已入座，請使用換桌')
    expect(r.error).toBe('這組已經入座了，要換桌請點桌子後按「換桌」')
  })

  it('成功結果與非物件原樣回傳（同一個參考）', () => {
    const ok = { ok: true, booking: { id: 1 } }
    expect(friendlyResult(ok)).toBe(ok)
    expect(friendlyResult(undefined)).toBeUndefined()
    expect(friendlyResult('x')).toBe('x')
  })

  it('不重複轉換', () => {
    const once = friendlyResult({ ok: false, error: '訂位不存在' })
    expect(friendlyResult(once)).toBe(once)
  })

  it('withFriendlyErrors：包住動作、參數原樣傳入、Promise 不碰', async () => {
    const calls = []
    const acts = withFriendlyErrors({
      seat: (...a) => { calls.push(a); return { ok: false, error: '尚未指派桌位（請先指派）' } },
      later: () => Promise.resolve({ ok: false, error: '未知錯誤' }),
      notFn: 42,
    })
    expect(acts.seat('b1', '106').error).toBe('這組還沒配桌，請先點一張空桌')
    expect(calls).toEqual([['b1', '106']])
    const p = acts.later()
    expect(p).toBeInstanceOf(Promise)
    expect((await p).error).toBe('未知錯誤')   // 非同步結果不轉（呼叫端自己處理）
    expect(acts.notFn).toBe(42)
  })
})
