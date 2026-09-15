// 現場自動清檯「純計算層」：吃目前狀態 + now，回傳 action 清單；不碰 localStorage。
// 執行層在 seatingService.executeSweepActions（每個 action 執行前重驗前置條件 → 冪等）。
//
// 規則 1（超時釋桌）：dining 且 seatedAt 逾 autoReleaseAfterMin（預設 300 分 = 5 小時）
//   → 高概率是忘記按清桌。散客桌等同「直接釋出」；團體桌只做「此梯離席」
//     （dining→cleaning、currentRef 保留），不破壞第二梯接續邏輯。
// 規則 2（換日掃除）：昨日殘留的 dining/cleaning/reserved 桌清為空桌；
//   昨日已到店（arrived）團體自動結案；planned/confirmed 的過期團不動（留給人判斷）。
//   過期 confirmed 訂位預設不自動標 noshow（會污染顧客罰則與報表口徑），開關另計。
// 規則 3（換日結候位）：取號日（本地日，非 UTC）早於今天、狀態仍是 waiting/called 的候位，
//   自動結為 left——店主反映沒結掉的候位籤會一直顯示「已等 4502 分」。絕不發任何通知
//   （走 waitlistService.leave 純寫入，不經會發通知的 Context wrapper）；缺 takenAt 或無法
//   解析的候位無從判斷年齡，不動。

import { formatDate } from './timeSlots'

// === 掃除的權限政策（純函式，供 BookingContext.runSweeps 使用）===
// 掃除是**自動**跑的，使用者毫無所覺。而後端 adminPushData 採「任一集合越權即整包 403」，
// 所以只要讓一個無權的 action 改到本機資料，該裝置之後的每一次推送都會被整包拒絕，
// 連帶把帶位、訂位等合法變更一起鎖死，且不會自癒（僅重新整理可解，代價是丟掉未推送的變更）。
// 政策集中在這裡，新增 sweep action 種類時一併登記它要寫哪個集合的權限。

// 掃除本體會改寫 tables 與 bookings，這是跑掃除的最低門檻。
export const SWEEP_BASE_PERMISSIONS = ['booking.update', 'table.update']

// 所有掃除 action 的完整清單。新增 action 種類時**必須**登記在這裡，
// 並在 SWEEP_ACTION_PERMISSION 標明它有沒有寫到 tables/bookings 以外的集合。
// tests/utils/opsSweep.test.js 會斷言兩個 compute 函式吐得出來的種類與此清單完全一致，
// 漏登記會直接讓測試變紅——避免註冊表靜默過期、再度出現「自動跑的動作毒殺整台同步」。
export const KNOWN_SWEEP_ACTIONS = [
  'finalize-booking',     // bookings + tables
  'checkout-group-table', // tables
  'clear-table',          // tables
  'complete-booking',     // bookings
  'complete-group',       // tables + groupReservations
  'mark-noshow-auto',     // bookings（刻意繞過 recordNoshow，不寫 noshow store）
  'leave-waitlist-auto',  // waitlist
]

// 個別 action 額外需要的權限（會寫到 tables/bookings 以外的集合）。
export const SWEEP_ACTION_PERMISSION = {
  'complete-group': 'group.update',       // → groupReservations
  'leave-waitlist-auto': 'waitlist.update', // → waitlist
}

// permit 不是函式時（無 AuthProvider 的測試/本機模式）一律放行，維持既有行為。
export function canRunSweeps(permit) {
  if (typeof permit !== 'function') return true
  return SWEEP_BASE_PERMISSIONS.every(p => permit(p))
}

export function filterSweepActionsByPermission(actions = [], permit) {
  if (typeof permit !== 'function') return actions
  return actions.filter(a => {
    const need = SWEEP_ACTION_PERMISSION[a?.type]
    return !need || permit(need)
  })
}

// 需要「本 session 已成功從雲端拉過一次」才可以執行的 action。
// leave-waitlist-auto：離線開機（20 秒 fallback）時本機候位快照可能停在昨天——另一台早已把該號入座，
// 這台仍看到 waiting；結成 left 後整份文件推上雲，會把 seated／seatedAt／桌號蓋掉（同步是整份覆寫、無時間戳仲裁）。
// 被延後的 action 讓呼叫端不寫「今日已掃」marker，等拉雲成功後的下一輪再補做。
export const CLOUD_FRESH_REQUIRED_ACTIONS = new Set(['leave-waitlist-auto'])

export function deferUntilCloudPulled(actions = [], cloudPulled) {
  if (cloudPulled) return actions
  return actions.filter(a => !CLOUD_FRESH_REQUIRED_ACTIONS.has(a?.type))
}

export function computeOvertimeActions({ tables = [], settings = {}, now = Date.now() }) {
  if (settings.autoReleaseEnabled === false) return []
  const limit = Number(settings.autoReleaseAfterMin) || 300
  const actions = []
  for (const t of tables) {
    // 刻意不看 isActive/outage：停用或維修中但仍有人用餐的桌（同步進來的不一致狀態）
    // 更需要被掃到，否則變成永遠不會釋出的殭屍桌。
    if (t.status !== 'dining' || !t.seatedAt) continue
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

// takenAt 是 UTC ISO 字串，必須換成本地日期再比對——直接 slice(0, 10) 取到的是 UTC 日，
// 本地早上 8 點前會誤判成前一天。無法解析（缺 takenAt／格式壞掉）回傳空字串，呼叫端視為「不動」。
function localDateOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatDate(d)
}

export function computeDayRolloverActions({
  tables = [], bookings = [], groupReservations = [], waitlist = [], settings = {}, today,
}) {
  if (settings.dayRolloverEnabled === false) return []
  const actions = []
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  const groupById = {}
  groupReservations.forEach(g => { if (g.id) groupById[g.id] = g })

  for (const t of tables) {
    // 同上：換日掃除也涵蓋停用/維修中的佔用桌，避免昨日殘留卡死。
    if (!['dining', 'cleaning', 'reserved'].includes(t.status)) continue
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

  for (const w of waitlist) {
    if (w.status !== 'waiting' && w.status !== 'called') continue
    const localDate = localDateOf(w.takenAt)
    if (!localDate) continue // 缺 takenAt 或無法解析：無從判斷年齡，不動
    if (localDate < today) {
      actions.push({ type: 'leave-waitlist-auto', waitlistId: w.id, queueNumber: w.queueNumber, name: w.name })
    }
  }

  return actions
}
