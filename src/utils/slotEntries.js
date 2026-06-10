// slotEntries：把某日的散客訂位 + 團體梯次攤平成依時段排序的混合清單（訂位頁今日/日曆用）。
// bookings 的狀態過濾由呼叫端負責（今日/日曆各有自己的 filter 口徑）；
// 團體在此排除 cancelled（已完成的團仍可見——當天回顧用餐狀況需要）。
export function mergeDayEntries(bookings = [], groupReservations = [], date) {
  const map = new Map() // slot -> { slot, bookings, groupBatches }
  const bucket = (slot) => {
    const key = slot || ''
    if (!map.has(key)) map.set(key, { slot: key, bookings: [], groupBatches: [] })
    return map.get(key)
  }

  ;(bookings || []).forEach(b => {
    if (b.date !== date) return
    bucket(b.timeSlot).bookings.push(b)
  })
  ;(groupReservations || []).forEach(g => {
    if (g.date !== date || g.status === 'cancelled') return
    ;(g.batches || []).forEach(batch => {
      bucket(batch.timeSlot).groupBatches.push({ group: g, batch })
    })
  })

  return [...map.values()].sort((a, b) => String(a.slot).localeCompare(String(b.slot)))
}

// 某日團體摘要（標題 chips 用）：{ groupCount, guests }（排除 cancelled、跨梯次同團只計一次）
export function summarizeDayGroups(groupReservations = [], date) {
  let groupCount = 0
  let guests = 0
  ;(groupReservations || []).forEach(g => {
    if (g.date !== date || g.status === 'cancelled') return
    groupCount += 1
    guests += Number(g.counts?.total) || 0
  })
  return { groupCount, guests }
}
