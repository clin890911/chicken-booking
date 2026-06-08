// 前台共用驗證規則。集中一處，避免「訂位頁能過、改資料頁過不了」這類不一致卡關。
// 台灣電話：09 開頭手機（10 碼）或市話（8–10 碼），與後端 validateNewBooking 對齊。
export function isValidTwPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  return /^09\d{8}$/.test(d) || /^\d{8,10}$/.test(d)
}
