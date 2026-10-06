// 現場動作的前端權限門：「按鈕可不可按」要看它「實際會寫哪些集合」，不是只看 table.update。
//
// 背景：TableDrawer 過去整個動作區只用 can('table.update') 把關，但入座／取消訂位／離席會同時寫
// bookings、候位入座寫 waitlist、團體入座寫 groupReservations。後端 adminPushData 以集合為單位檢查
// （functions/lib/staffAccess.js COLLECTION_WRITE_PERM），被拒的集合在部分推送機制下只標 rejected、
// 其餘照寫 → 前端按得下去、本機看似成功，雲端的訂位／團單卻沒寫進去（靜默不一致）。
// 以現行角色表（manager／floor／host 三者同時具備 table.update、booking.update、waitlist.update、
// group.update）這道缺口只會在「無 table.update 卻仍看得到按鈕」的元件（TableCandidatePanel）與
// 未來新增的角色上發作，所以修法是「對齊實際寫入集合」，不改任何角色政策。
//
// 集合 → 權限字串：必須與後端 COLLECTION_WRITE_PERM 一致（tests/utils/seatingPerms.test.js
// 以真實的 canWriteCollection 逐角色驗證，後端改了這裡不改測試會紅）。
export const COLLECTION_PERM = {
  tables: 'table.update',
  bookings: 'booking.update',
  waitlist: 'waitlist.update',
  groupReservations: 'group.update',
}

// 動作 → 實際寫入的集合（以 seatingService／bookingService／waitlistService／groupReservationService 為準）。
// customers 刻意不列入閘門：bookingService.create 只在有電話時順手 upsert 顧客檔，
// 後端 customers 被拒時整筆訂位仍會寫進去（部分推送），且 manager／floor／host 都具 customer.update；
// 若硬要求它會讓「沒填電話的散客入座」也被擋，過度收緊。
export const ACTION_WRITES = {
  clearTable: ['tables'],               // 清桌完成／強制釋出孤兒桌／團體只清桌／團體梯次離席（checkoutGroupBatch 只動桌）
  seatBooking: ['bookings', 'tables'],  // 客人到了入座、預配入座、預訂（指派）、改桌、離席、一鍵釋出、取消訂位、復原
  walkIn: ['bookings', 'tables'],       // 散客直接入座（bookingService.create + seatTable）
  seatWaitlist: ['waitlist', 'bookings', 'tables'], // 候位入座（建 walk-in booking + seatTable + waitlist.seat）
  groupWrite: ['groupReservations', 'tables'],      // 團體梯次入座／整梯釋出／整團完成／接下一梯（寫團 status／releasedAt）
}

// can: useAuth().can。回傳每個動作群組的「前端是否放行」。
// block 另加 table.block（維修停用／設不可用的店內分工：host 不給），後端只看 table.update，前端更嚴屬刻意。
export function seatingPerms(can) {
  const has = (perm) => !!can?.(perm)
  const all = (action) => ACTION_WRITES[action].every(col => has(COLLECTION_PERM[col]))
  return {
    table: all('clearTable'),
    block: all('clearTable') && has('table.block'),
    seat: all('seatBooking'),
    walkIn: all('walkIn'),
    waitlistSeat: all('seatWaitlist'),
    group: all('groupWrite'),
  }
}
