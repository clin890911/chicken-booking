// 桌位狀態中文對照：錯誤訊息與 UI 顯示共用，避免英文狀態（dining…）直接噴給店員。
export const STATUS_ZH = {
  vacant: '空桌',
  reserved: '已預訂',
  dining: '用餐中',
  cleaning: '清桌中',
  blocked: '不可用',
}

export function statusZh(status) {
  return STATUS_ZH[status] || status
}

// 「已指派」在系統裡其實有兩種，寫入的東西不一樣，桌況圖也因此不同色：
//   'held'      現場頁「指派桌位」（seatingService.assignBookingToTable）→ 除了寫 booking.assignedTableId，
//               還會 tableService.reserveTable() 把桌況鎖成 reserved，這桌不再是空桌。
//   'preassign' 規劃頁「預配」（BookingContext.preassignBookingTable → bookingService.assignTable）
//               只寫 booking.assignedTableId、不動桌況：桌仍 vacant，別人坐得進去、也仍計入可入座數。
//   null        沒指派任何桌。
// 兩種在訂位卡上原本都只寫「已指派 NNN」，地圖卻一藍一綠 —— 店員無從理解為何同樣已指派卻不同色
// （2026-08 店主回報）。這裡是唯一判定：訂位卡徽章（UpcomingPanel）與桌況圖著色（FloorMap→TableShape）
// 共用同一口徑，不再各自從 assignedTableId／table.status 推。
export function assignmentKind(booking, table) {
  if (!booking?.assignedTableId) return null
  if (!table) return 'preassign'
  // 必須是「這桌鎖給這筆訂位」才算 held。currentBookingId 指向別人時代表這筆的預配已被覆蓋
  // （預配不鎖桌，現場可照常把桌指派給別人），仍當預配看待 —— 否則卡片宣稱桌位到手、
  // 地圖上那桌卻寫著別人的名字。
  const bookingId = booking.id == null ? '' : String(booking.id)
  const holder = table.currentBookingId == null ? '' : String(table.currentBookingId)
  const heldByThis = bookingId !== '' && holder === bookingId
  return heldByThis && ['reserved', 'dining'].includes(table.status) ? 'held' : 'preassign'
}

// 唯讀兼容舊資料：整組已到店但附桌仍 reserved，顯示為用餐且繼承既有起點。
// 必須仍由本訂位持有並在其桌組內；不改儲存、不遮蓋他人／團體／清潔狀態。
export function diningTablePresentation(table, booking, tables = []) {
  const numbers = [booking?.assignedTableId, ...(booking?.extraTableIds || [])].filter(Boolean).map(String)
  if (!table || booking?.status !== 'arrived' || !['reserved', 'dining'].includes(table.status)
      || table.currentRef || booking.id == null || table.currentBookingId == null
      || String(table.currentBookingId) !== String(booking.id) || !numbers.includes(String(table.number))) return table
  const main = tables.find(t => String(t.number) === String(booking.assignedTableId)
    && String(t.currentBookingId) === String(booking.id) && !t.currentRef && ['reserved', 'dining'].includes(t.status))
  const seatedAt = table.seatedAt || main?.seatedAt || booking.actualArrivalTime || null
  return table.status === 'dining' && table.seatedAt === seatedAt ? table : { ...table, status: 'dining', seatedAt }
}
