// 現場自動清檯「純計算層」：吃目前狀態 + now，回傳 action 清單；不碰 localStorage。
// 執行層在 seatingService.executeSweepActions（每個 action 執行前重驗前置條件 → 冪等）。
//
// 規則 1（超時釋桌）：dining 且 seatedAt 逾 autoReleaseAfterMin（預設 300 分 = 5 小時）
//   → 高概率是忘記按清桌。散客桌等同「直接釋出」；團體桌只做「此梯離席」
//     （dining→cleaning、currentRef 保留），不破壞第二梯接續邏輯。
// 規則 2（換日掃除）：昨日殘留的 dining/cleaning/reserved 桌清為空桌；
//   昨日已到店（arrived）團體自動結案；planned/confirmed 的過期團不動（留給人判斷）。
//   過期 confirmed 訂位預設不自動標 noshow（會污染顧客罰則與報表口徑），開關另計。

export function computeOvertimeActions({ tables = [], settings = {}, now = Date.now() }) {
  if (settings.autoReleaseEnabled === false) return []
  const limit = Number(settings.autoReleaseAfterMin) || 300
  const actions = []
  for (const t of tables) {
    if (!t.isActive || t.status !== 'dining' || !t.seatedAt) continue
    const min = Math.floor((now - Date.parse(t.seatedAt)) / 60000)
    if (!(min >= limit)) continue
    if (t.currentBookingId) {
      actions.push({ type: 'finalize-booking', bookingId: t.currentBookingId, tableNumber: t.number, minutes: min })
    } else if (t.currentRef?.type === 'group') {
      actions.push({
        type: 'checkout-group-table', tableNumber: t.number,
        groupId: t.currentRef.groupId, batchId: t.currentRef.batchId, minutes: min,
      })
    } else {
      actions.push({ type: 'clear-table', tableNumber: t.number, minutes: min, reason: 'orphan-dining' })
    }
  }
  return actions
}

export function computeDayRolloverActions({ tables = [], bookings = [], groupReservations = [], settings = {}, today }) {
  if (settings.dayRolloverEnabled === false) return []
  const actions = []
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  const groupById = {}
  groupReservations.forEach(g => { if (g.id) groupById[g.id] = g })

  for (const t of tables) {
    if (!t.isActive || !['dining', 'cleaning', 'reserved'].includes(t.status)) continue
    const linkedDate = t.currentBookingId
      ? bookingById[t.currentBookingId]?.date
      : t.currentRef?.type === 'group'
        ? groupById[t.currentRef.groupId]?.date
        : String(t.seatedAt || t.updatedAt || '').slice(0, 10)
    if (linkedDate && linkedDate < today) {
      const b = t.currentBookingId ? bookingById[t.currentBookingId] : null
      if (b && b.status === 'arrived') {
        actions.push({ type: 'complete-booking', bookingId: b.id, tableNumber: t.number })
      }
      actions.push({ type: 'clear-table', tableNumber: t.number, reason: 'stale-day' })
    }
  }

  for (const g of groupReservations) {
    if (g.date && g.date < today && g.status === 'arrived') {
      actions.push({ type: 'complete-group', groupId: g.id })
    }
  }

  if (settings.autoNoshowOnRollover === true) {
    for (const b of bookings) {
      if (b.date && b.date < today && b.status === 'confirmed') {
        actions.push({ type: 'mark-noshow-auto', bookingId: b.id })
      }
    }
  }
  return actions
}
