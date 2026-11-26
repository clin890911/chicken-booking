// 入座／換桌的「成功回饋＋復原」單一來源（2026-11 現場走查 B1）。
//
// 為什麼存在：同一件事（入座）過去在 8 個入口有三種成功句、5／6／8 秒與「沒有復原」四種，
// 店員按下去無法預期會怎樣（Barry：「入座有很多不安全感」）。現在所有入口都走這裡：
//   文字：「✓ 林先生 3 位 → 105 已入座」（多桌用「＋」連接）；換桌：「✓ 林先生 改到 103」
//   復原：統一 8 秒（SEAT_UNDO_MS）。唯一例外是候位入座——復原是雲端指令，後端只給 5 秒
//         （functions/lib/waitlistCommands.js 的 undoUntil），前端不能比後端長，見 waitlistSeatToast。
//   位置：placement:'seat'——現場頁把這類 toast 放在桌況圖底部、報到列正上方（手指附近），
//         不蓋左欄作業面板的確認鈕、也不蓋報到列的「到了」；沒有落點（手機、其他頁）時退回頂部。
// 純函式：toast 由呼叫端注入（方便單測）。復原本身的守門一律在 service 層（只倒仍由本筆持有或已空的桌）。

export const SEAT_UNDO_MS = 8000
export const SEAT_TOAST_PLACEMENT = 'seat'

// 桌號清單 → 「105＋106」（去重、去空；單桌就是桌號本身）
export function joinTables(tables) {
  return [...new Set([].concat(tables ?? []).filter(n => n != null && n !== '').map(String))].join('＋')
}

// 入座結果實際坐的桌：service 回 tableNumbers（大組）優先；沒有就用訂位的主桌＋副桌，再退回單桌號。
export function seatedTablesOf(r, booking, fallback) {
  if (r?.tableNumbers?.length) return r.tableNumbers
  const nums = [booking?.assignedTableId, ...(booking?.extraTableIds || [])].filter(n => n != null && n !== '').map(String)
  if (nums.length) return nums
  return [r?.tableNumber ?? fallback].filter(n => n != null && n !== '')
}

// 「✓ 林先生 3 位 → 105 已入座」；人數不明（0／空）就不寫人數，姓名空白用「這組」
export function seatedText({ name, guests, tables } = {}) {
  const g = Math.floor(Number(guests) || 0)
  return `✓ ${String(name || '').trim() || '這組'}${g > 0 ? ` ${g} 位` : ''} → ${joinTables(tables)} 已入座`
}

// 「✓ 林先生 改到 103」；freed＝入座未滿 5 分鐘、直接回空桌的原桌（B6），講清楚不必清
export function movedText({ name, tables, freed = [] } = {}) {
  const tail = freed?.length ? `（${joinTables(freed)} 剛坐不久，已直接回空桌）` : ''
  return `✓ ${String(name || '').trim() || '這組'} 改到 ${joinTables(tables)}${tail}`
}

// 成功＋復原：一律 8 秒、placement:'seat'。label 依入口（復原／復原帶位 105／↩ 復原換桌，H6 帶對象）。
export function toastSeatUndo(toast, message, { label = '復原', onUndo, duration = SEAT_UNDO_MS } = {}) {
  return toast.action(message, { label, onClick: () => { onUndo?.() } }, { duration, placement: SEAT_TOAST_PLACEMENT })
}

// 沒有復原的成功（例：未入座的改桌、接走前梯待清桌的團體入座）：同樣的位置與停留時間，不給假的復原鈕。
export function toastSeatDone(toast, message, { duration = SEAT_UNDO_MS } = {}) {
  return toast.success(message, { duration, placement: SEAT_TOAST_PLACEMENT })
}

// 團體整梯入座（GroupTodayCard／今日時間清單團體列／團保桌抽屜共用）：
// r.undo 只有「整梯原本都是空桌」時才有（seatingService.seatGroupBatch）→ 給 8 秒復原；
// 接走前梯待清桌的那種入座沒有快照 → 同樣的文字與位置、不給假的復原鈕。
export function toastGroupSeated(r, { group, batch, undoSeatGroupBatch, toast }) {
  const name = `${group?.agencyName || '團體'} ${batch?.label || ''}`.trim()
  const message = seatedText({ name, guests: batch?.guests, tables: r?.tableNumbers || batch?.tableNumbers })
  if (!r?.undo || !undoSeatGroupBatch) return toastSeatDone(toast, message)
  let undone = false
  return toastSeatUndo(toast, message, {
    label: '復原',
    onUndo: () => {
      if (undone) return
      const u = undoSeatGroupBatch(r.undo)
      if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
      undone = true
      toast.info(`已復原：${name} 回到未入座（${joinTables(u.tableNumbers)} 回空桌）`)
    },
  })
}
