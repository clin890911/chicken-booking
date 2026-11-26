// 入座／換桌的「成功回饋＋復原」單一來源（2026-11 現場走查 B1）。
//
// 為什麼存在：同一件事（入座）過去在 8 個入口有三種成功句、5／6／8 秒與「沒有復原」四種，
// 店員按下去無法預期會怎樣（Barry：「入座有很多不安全感」）。現在所有入口都走這裡：
//   文字：「✓ 林先生 3 位 → 105 已入座」（多桌用「＋」連接）；換桌：「✓ 林先生 3 位 改到 103」
//   復原鈕：看得到的字一律「復原」；對象（復原帶位 105／復原入座 林先生／復原換桌 103）放 aria-label。
//   復原：統一 8 秒（SEAT_UNDO_MS）。唯一例外是候位入座——復原是雲端指令，後端只給 5 秒
//         （functions/lib/waitlistCommands.js 的 undoUntil），前端不能比後端長，見 waitlistSeatToast。
//   位置（2026-11-27 驗收 P1 第三輪）：現場頁的入座提示是「不可互動」的浮動提示（pointer-events:none、
//         不帶任何按鈕、約 4 秒），「復原」只出現在版面內固定保留的復原欄（ops/SeatUndoBar，地圖工具列右端）。
//         前兩輪把帶「復原」的 toast 放在地圖底部（蓋桌）、頁面頂部（蓋待清／1F／同步燈）都失敗——
//         任何浮在內容上的「復原」都會在入座後幾秒內被手指誤觸（與「到了鈕不可放回桌上」同一個道理）。
//         placement:'seat' 是給 ToastProvider 的路由標記：有復原欄時改走上述行為；沒有（非現場頁）照舊。
//   報到列「到了」：只用原位確認卡（ArrivalStrip），不另發 toast——同一件事不可同時出現兩顆「復原」。
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

// 「✓ 林先生 3 位 改到 103」：與入座同一個格式（人數不明就不寫）。原桌回空桌或轉待清，
// 換桌面板確認前就講清楚（ModeBanner 的 moveSourceNote，B6 五分鐘規則），提示不再多掛一段括號。
export function movedText({ name, guests, tables } = {}) {
  const g = Math.floor(Number(guests) || 0)
  return `✓ ${String(name || '').trim() || '這組'}${g > 0 ? ` ${g} 位` : ''} 改到 ${joinTables(tables)}`
}

// 「✓ 王先生 3 位 → 101 已入座」→「王先生 3 位 → 101」（現場頁復原欄的對象文字；換桌句「改到 103」原樣保留）
export function seatUndoTextOf(message) {
  return String(message || '').replace(/^\s*✓\s*/, '').replace(/\s*已入座\s*$/, '').trim()
}

// 成功＋復原：一律 8 秒、placement:'seat'。看得到的字一律「復原」；ariaLabel 帶對象（H6：兩則疊在一起時讀屏分得清）。
export function toastSeatUndo(toast, message, { ariaLabel, onUndo, duration = SEAT_UNDO_MS } = {}) {
  return toast.action(message, { label: '復原', ariaLabel, onClick: () => { onUndo?.() } }, { duration, placement: SEAT_TOAST_PLACEMENT })
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
    ariaLabel: `復原入座 ${name}`,
    onUndo: () => {
      if (undone) return
      const u = undoSeatGroupBatch(r.undo)
      if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
      undone = true
      toast.info(`已復原：${name} 回到未入座（${joinTables(u.tableNumbers)} 回空桌）`)
    },
  })
}
