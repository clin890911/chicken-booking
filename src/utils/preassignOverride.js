// 覆蓋預配的共用口徑：警示文字、實際解除、復原還原。
// 呼叫端：現場指派／候位入座／改桌（OperationsView executeAssign）、現場帶位（handleWalkinSeat）、
// 桌況抽屜散客直接入座（TableDrawer）、抽屜候選名單的指派／入座（TableCandidatePanel）。
//
// 規則（2026-09 驗收後定案）：只有「被覆蓋那筆的用餐區間」與「新佔用區間」重疊才解除；
// 不重疊就保留（例：12:20 帶位不影響 20:30 的預配）。重疊判定見 capacity.preassignConflicts／assignmentWindow。
// 警示一律講實際會發生的事：「11:00 余先生的預配將解除」vs「20:30 余先生的預配會保留」。
// 純函式（注入 context 動作與 toast），方便單測。

// 單筆預配衝突的警示句。verb＝動作名（帶位／確認／入座），用在「○○後 … 將解除」。
export function conflictLine(tableNumber, { booking: b, overlaps, willRelease }, verb = '確認') {
  const when = b.timeSlot ? `${b.timeSlot} ` : ''
  const head = `${tableNumber} 已於排位規劃預留給 ${b.name}（${b.guests} 位${b.timeSlot ? ` · ${b.timeSlot}` : ''}）。`
  if (willRelease) return `${head}用餐時段重疊：${verb}後 ${when}${b.name} 的預配將解除，需重新指派。`
  return `${head}${overlaps ? '' : '用餐時段不重疊：'}${when}${b.name} 的預配會保留。`
}

// 解除「會被解除」的那幾筆（willRelease），同一筆只處理一次；回傳復原用快照。
// 每解除一筆就 toast 告知店員要重新指派。
export function releaseOverlappingPreassigns(conflicts, { releaseOverriddenAssignment, toast }) {
  const seen = new Set()
  const snapshots = []
  ;(conflicts || []).forEach(c => {
    const b = c?.booking
    if (!b?.id || !c.willRelease || seen.has(b.id)) return
    seen.add(b.id)
    const r = releaseOverriddenAssignment(b.id)
    if (!r?.ok) return
    const nums = (r.tableNumbers || []).join(' + ')
    toast.info(`${b.name}原本的預配 ${nums} 已解除，請重新指派`, { duration: 8000 })
    snapshots.push({ bookingId: b.id, name: b.name, tableNumbers: r.tableNumbers || [], released: r.released || [] })
  })
  return snapshots
}

// 復原時把被解除的預配寫回（context.restoreOverriddenAssignment 只在那筆仍未配桌時才寫）。
// 回傳 { restored, failed }（各為快照陣列），由呼叫端決定怎麼跟店員講。
export function restoreReleasedPreassigns(snapshots, { restoreOverriddenAssignment }) {
  const restored = []
  const failed = []
  ;(snapshots || []).forEach(s => {
    const r = restoreOverriddenAssignment(s)
    if (r?.ok) restored.push(s)
    else failed.push(s)
  })
  return { restored, failed }
}

// 復原結果的附註句（空字串＝沒有要還原的預配）
export function restoreNote({ restored = [], failed = [] } = {}) {
  const parts = []
  if (restored.length) parts.push(`${restored.map(s => `${s.name} 的預配 ${s.tableNumbers.join(' + ')}`).join('、')} 已還原`)
  if (failed.length) parts.push(`${failed.map(s => s.name).join('、')} 已重新配桌或狀態已變，預配未還原`)
  return parts.length ? `（${parts.join('；')}）` : ''
}
