// 桌位「當日排程」純函式：把今天每張桌的多批用餐（turns）整理出來，
// 供現場頁「排程視圖」用——一眼看出「這桌今天要翻幾次、下一批幾點到」。
//
// turn 來源有二：
//   1) 散客／個人訂位：booking.assignedTableId === 桌號 且 booking.date === 今天
//      （含「預先配桌」記在 booking 上的未來梯次；結帳後 assignedTableId 仍保留，故已離席也掛得回該桌）
//   2) 旅行社團體：batch.tableNumbers 含此桌（團體不建 booking，靠桌的 currentRef 對應入座）
//
// 狀態口徑與現場圖一致：done(已離席) / seated(用餐中) / upcoming(待到店或保留)
import { sortedBatches } from './groupLive'

// 散客 turn 不顯示的狀態：取消、未到（noshow）——避免排程圖被作廢的訂位灌爆
const SOLO_EXCLUDE = ['cancelled', 'noshow']

// 個人訂位 → 這張桌上的 turn 狀態
function soloTurnStatus(booking, table) {
  if (booking.status === 'completed') return 'done'
  // 正在這張桌用餐中（桌況 dining 且 currentBookingId 指向此 booking）
  if (table && table.status === 'dining' && table.currentBookingId === booking.id) return 'seated'
  if (['arrived', 'seated'].includes(booking.status)) return 'seated'
  return 'upcoming' // confirmed / pending：已指派或預先配桌、尚未到店
}

// 團體梯次 → 這張桌上的 turn 狀態
function groupTurnStatus(group, batch, table) {
  if (batch.releasedAt) return 'done' // 整梯清桌釋出：桌位痕跡已清空，靠 releasedAt 判定消化完
  const refMatch = table?.currentRef?.groupId === group.id && table?.currentRef?.batchId === batch.id
  if (refMatch && table.status === 'dining') return 'seated'
  if (refMatch && table.status === 'cleaning') return 'done' // 此梯已離席、待清（currentRef 保留供接下梯）
  if (group.status === 'completed') return 'done'
  return 'upcoming' // 已圈桌、尚未入座（團保）
}

// 回傳 { [tableNumber]: [turn, ...] }，每桌依時段排序（缺時段者排最後）。
// turn 形狀：{ kind:'solo'|'group', status, time, guests, label, ...(來源 id) }
export function buildTableTurns(tables, bookings, groupReservations, today) {
  const byNumber = {}
  ;(tables || []).forEach(t => { byNumber[t.number] = t })
  const map = {}
  const push = (n, turn) => {
    if (!byNumber[n]) return // 此桌已移除 → 跳過（不畫孤兒 turn）
    if (!map[n]) map[n] = []
    map[n].push(turn)
  }

  // 1) 散客／個人訂位
  ;(bookings || []).forEach(b => {
    if (b.date !== today || !b.assignedTableId) return
    if (SOLO_EXCLUDE.includes(b.status)) return
    push(b.assignedTableId, {
      kind: 'solo',
      status: soloTurnStatus(b, byNumber[b.assignedTableId]),
      time: b.timeSlot || '',
      guests: Number(b.guests) || 0,
      label: b.name || '訂位',
      bookingId: b.id,
      source: b.source || null,
    })
    // 大組併桌的額外桌：放一個輕量 turn 標示「併入主桌」，排程視圖才不會看起來空。
    // guests:0 → 人數只算在主桌，不重複；isExtra 供統計（翻台次數）排除。
    ;(b.extraTableIds || []).forEach(n => {
      push(String(n), {
        kind: 'solo',
        status: soloTurnStatus(b, byNumber[String(n)]),
        time: b.timeSlot || '',
        guests: 0,
        label: `${b.name || '訂位'}（併${b.assignedTableId}）`,
        bookingId: b.id,
        source: b.source || null,
        isExtra: true,
      })
    })
  })

  // 2) 旅行社團體梯次（含已完成團 → 仍以「已離席」呈現當日歷程）
  ;(groupReservations || []).forEach(g => {
    if (g.date !== today || g.status === 'cancelled') return
    sortedBatches(g).forEach(batch => {
      ;(batch.tableNumbers || []).forEach(n => {
        push(n, {
          kind: 'group',
          status: groupTurnStatus(g, batch, byNumber[n]),
          time: batch.timeSlot || '',
          guests: Number(batch.guests) || 0, // 整梯人數（跨多桌），非單桌
          label: g.agencyName || '團體',
          groupId: g.id,
          batchId: batch.id,
          batchLabel: batch.label || '',
        })
      })
    })
  })

  Object.values(map).forEach(list =>
    list.sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99'))))
  return map
}

// 時段篩選：'all' | 'lunch'(開始 < 16:00) | 'dinner'(開始 >= 16:00)
export function turnInPeriod(turn, period) {
  if (period === 'all') return true
  const h = parseInt(String(turn.time).slice(0, 2), 10)
  if (Number.isNaN(h)) return false // 無時段者只在「全天」出現
  return period === 'lunch' ? h < 16 : h >= 16
}
