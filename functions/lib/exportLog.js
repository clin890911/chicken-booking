// 匯出稽核紀錄純邏輯（不碰 Firestore / auth），抽出供根目錄 Vitest 直接測試。
// 設計原則：actor（操作者）與 at（時間）一律由伺服器決定、不取自客戶端，確保稽核不可偽造；
// 其餘欄位做型別/長度夾限，避免前端塞入超長字串或髒資料。

const EXPORT_TYPES = ['bookings', 'groups']

export function sanitizeExportLog(body = {}, actor = '', nowIso = new Date().toISOString()) {
  const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
  const type = EXPORT_TYPES.includes(body.type) ? body.type : 'bookings'
  const count = Math.max(0, Math.min(10_000_000, Math.floor(Number(body.count) || 0)))
  return {
    actor: String(actor || '').toLowerCase().slice(0, 200),
    type,
    count,
    dateFrom: str(body.dateFrom, 10),
    dateTo: str(body.dateTo, 10),
    filters: str(body.filters, 300),
    at: nowIso,
  }
}
