// 大人／小孩拆分（像 inline 一樣讓店員直接點大人、小孩人數）。
// 🔴 不變量：bookings.guests／waitlist.partySize 永遠 = adults + children，且仍是所有容量／配桌／通知
//    邏輯唯一讀的欄位。adults/children 只是附加資訊，舊單沒有拆分 → 視為 adults=總人數、children=0。
//    其他路徑（客人線上改人數等）可能只改總數不改拆分 → 讀取一律以總數為準、用 children 回推 adults。

// 由總人數＋小孩數得出合法拆分：總數至少 1；小孩 0..總數−1（至少一位大人，全是小孩不合理）。
export function normalizeSplit(total, kids = 0) {
  const t = Math.max(1, Math.floor(Number(total) || 1))
  const c = Math.min(t - 1, Math.max(0, Math.floor(Number(kids) || 0)))
  return { adults: t - c, children: c }
}

// 讀一筆訂位（guests）或候位（partySize）的拆分；沒有拆分的舊資料回 adults=總數、children=0。
export function guestSplit(record) {
  if (!record) return { adults: 0, children: 0 }
  const total = record.guests ?? record.partySize
  return normalizeSplit(total, record.children)
}

// 卡片人數後綴：有小孩才顯示「（大3・小2）」，沒小孩回空字串（不增加雜訊）。
export function splitSuffix(record) {
  const { adults, children } = guestSplit(record)
  return children > 0 ? `（大${adults}・小${children}）` : ''
}

// 寫入用欄位：有小孩、或原紀錄本來就有拆分（force，要能改回 0）才寫 adults/children；
// 否則回空物件，舊單／只有大人的單維持原本形狀（不平白多出欄位）。
export function splitFields(total, kids, { force = false } = {}) {
  const s = normalizeSplit(total, kids)
  return (s.children > 0 || force) ? s : {}
}
