// 一筆訂位佔用的桌（顯示／比對用的唯一口徑）。
// 大組散客併桌：主桌 assignedTableId＋副桌 extraTableIds（兩者存的都是「桌號」字串，不是內部 id）。
// 顯示層不可只讀 assignedTableId——8 位配 101＋107 時只寫「桌 101」會讓店員以為只有一張桌。
export function bookingTableNumbers(booking) {
  return [...new Set(
    [booking?.assignedTableId, ...(Array.isArray(booking?.extraTableIds) ? booking.extraTableIds : [])]
      .filter(n => n != null && n !== '').map(String),
  )]
}

// 顯示字串：「101 + 107」；單桌就是「105」；未配桌回空字串。
export function formatBookingTables(booking) {
  return bookingTableNumbers(booking).join(' + ')
}
