// 桌務的「做了 → 一下倒回」共用純函式（換桌／離席／清桌／批次清桌／散客帶位）。
// 不碰 React：元件把 context 動作與 toast 注入進來，方便單測（tests/utils/tableUndo.test.js）。
//
// 復原鐵律一律在 service 層（seatingService.undoSeatedMove／undoCheckoutBooking／undoClearTable／
// undoClearGroupTable／undoWalkInSeat）：只在桌「仍是預期狀態」才倒回，被下一組用了就安全失敗、不覆蓋。
// 這裡只負責：動手前拍快照、toast 帶「復原○○」、失敗時把 service 的原因原樣講給店員。
//
// H6：復原鈕文案一律帶對象（復原取消／復原帶位 105／復原清桌 105…），兩則 toast 疊在一起時店員分得清。

export const undoLabel = {
  cancel: () => '↩ 復原取消',
  walkInSeat: (tables) => `復原帶位 ${[].concat(tables).join('+')}`,
  move: () => '↩ 復原換桌',
  checkout: () => '↩ 復原離席',
  clear: (tables) => (tables.length > 1 ? `↩ 復原清桌（${tables.length}）` : `↩ 復原清桌 ${tables[0]}`),
}

// 換桌復原失敗：依 service 回的 code 講實情（店員要知道是「原桌有人了」還是「這組又被換過」），沒 code 才用原文。
export function moveUndoFailText(u, name) {
  const who = name || '這組'
  if (u?.code === 'table-occupied' && u.tableNumber) return `原桌 ${u.tableNumber} 已有其他客人，未復原`
  if (u?.code === 'tables-changed') return `${who}之後又換過桌${u.currentTables?.length ? `（目前 ${u.currentTables.join(' + ')}）` : ''}，未復原`
  if (u?.code === 'new-table-changed' && u.tableNumber) return `${u.tableNumber} 已清桌或換了別組，未復原`
  return '復原失敗：' + (u?.error || '未知錯誤')
}

// 換桌成功後的 toast＋復原（D1）。r＝replaceSeatedBookingTables／moveTable 的結果（r.undo＝換桌前快照）。
// 沒有快照（未入座的改桌）就只出成功訊息，不給假的復原鈕。
export function toastMovedWithUndo(r, { message, name, toTables, undoSeatedMove, restoreOverriddenAssignment, restoreReleasedPreassigns, restoreNote, toast }) {
  if (!r?.undo) { toast.success(message); return }
  toast.action(message, {
    label: undoLabel.move(),
    onClick: () => {
      const u = undoSeatedMove(r.undo, toTables)
      if (!u?.ok) return toast.error(moveUndoFailText(u, name))
      const released = r.releasedPreassigns || []
      const note = released.length && restoreOverriddenAssignment && restoreReleasedPreassigns
        ? (restoreNote?.(restoreReleasedPreassigns(released, { restoreOverriddenAssignment })) || '')
        : ''
      toast.info(`已復原：${name || '這組'} 回到 ${u.tableNumbers.join(' + ')}${note}`)
    },
  }, { duration: 8000 })
}

// 離席後的 toast＋復原（D2）。r＝context.checkoutBooking 的結果（r.undo＝離席前快照）。
export function toastCheckoutWithUndo(r, { message, name, undoCheckoutBooking, toast }) {
  if (!r?.undo) { toast.success(message); return }
  toast.action(message, {
    label: undoLabel.checkout(),
    onClick: () => {
      const u = undoCheckoutBooking(r.undo)
      if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
      toast.info(`已復原：${name || '這組'} 回到用餐中（${u.tableNumbers.join(' + ')}）`)
    },
  }, { duration: 8000 })
}

// 待清桌一下清（D5）：清一張或多張，回傳每桌的復原快照。
// 散客桌走 clearTable（快照存 currentBookingId／currentRef——清桌會清掉兩者，事後查不回）；
// 團體桌走 clearGroupTable（清完本梯最後一桌會落 releasedAt／結團，快照由它回傳）。
// canGroup=false（角色不能寫團單）時團體桌略過，交給抽屜裡的說明處理。
export function clearCleaningTables(tables = [], { clearTable, clearGroupTable, canGroup = true }) {
  const cleared = []
  const skipped = []
  for (const t of tables) {
    if (!t || t.status !== 'cleaning') continue
    const n = String(t.number)
    if (t.currentRef?.type === 'group') {
      if (!canGroup || !clearGroupTable) { skipped.push(n); continue }
      const r = clearGroupTable(n)
      if (r?.ok) cleared.push({ kind: 'group', tableNumber: n, snapshot: r.snapshot })
      else skipped.push(n)
      continue
    }
    const snapshot = { bookingId: t.currentBookingId ?? null, ref: t.currentRef ?? null }
    clearTable(n)
    cleared.push({ kind: 'table', tableNumber: n, snapshot })
  }
  return { cleared, skipped }
}

// 批次復原：倒序（後清的先倒回——同一梯最後一張桌才落 releasedAt，要先把它倒回，前面那幾張才倒得回）。
// 每張各自走 service 守門：已被下一組用的那張安全失敗、不影響其他張。
export function undoClearedTables(cleared = [], { undoClearTable, undoClearGroupTable }) {
  const restored = []
  const failed = []
  for (const c of [...cleared].reverse()) {
    const u = c.kind === 'group'
      ? undoClearGroupTable(c.snapshot)
      : undoClearTable(c.tableNumber, c.snapshot)
    if (u?.ok) restored.unshift(c.tableNumber)
    else failed.unshift({ tableNumber: c.tableNumber, error: u?.error || `${c.tableNumber} 未復原` })
  }
  return { restored, failed }
}

// 清桌＋toast 帶「復原清桌」：抽屜的「清桌完成」、桌況圖快捷、待清清單（單桌／全部）共用。
export function clearTablesWithUndo(tables, deps) {
  const { toast } = deps
  const { cleared, skipped } = clearCleaningTables(tables, deps)
  if (!cleared.length) {
    if (skipped.length) toast.info(`${skipped.join('、')} 是團體桌，請點桌在抽屜裡處理`)
    return { cleared, skipped }
  }
  const nums = cleared.map(c => c.tableNumber)
  const skipMsg = skipped.length ? `（${skipped.join('、')} 未清，請點桌處理）` : ''
  toast.action(`${nums.join('、')} 已清桌完成${skipMsg}`, {
    label: undoLabel.clear(nums),
    onClick: () => {
      const { restored, failed } = undoClearedTables(cleared, deps)
      const failMsg = failed.map(f => f.error).join('；')
      if (!restored.length) return toast.error('復原失敗：' + (failMsg || '未知錯誤'))
      toast.success(`已復原 ${restored.join('、')} 為等待清桌${failMsg ? `；${failMsg}` : ''}`)
    },
  }, { duration: 8000 })
  return { cleared, skipped }
}
