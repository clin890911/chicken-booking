// 訂位卡／訂位詳情／桌位抽屜共用的「確認後動作」純函式。
// 這裡不碰 React：確認對話框（useConfirm）留在元件內，元件確認後才呼叫這些函式。
// 抽成純函式的理由見 tests/components/bookingCardNoshow.test.js 與 bookingCardCancelUndo.test.js
// ——不必掛載整個 BookingProvider/AuthProvider/ToastProvider 也能鎖住核心邏輯。
//
// ★ 2026-09 從 BookingCard.jsx 搬到這裡，讓新的 BookingDetailSheet 與 useBookingActions
//   共用同一份；BookingCard 仍 re-export 這三個名字，既有測試與 TableDrawer 的 import 不變。

// No-show 標記：文案與 UpcomingPanel.jsx 的過時未到清單同一套（講清楚累計第幾次）；
// 復原要把 recordNoshow 加上去的那一次扣回，否則店員按錯再復原，客人身上仍留著一次爽約紀錄。
export function markNoshow(booking, { setStatus, getNoshowCount, revokeNoshow, toast }) {
  setStatus(booking.id, 'noshow')
  const count = getNoshowCount(booking.phone)
  const countMsg = count > 0 ? `這支電話累計第 ${count} 次，之後訂位會提醒` : '已記錄這支電話的爽約次數'
  toast.action(`已標記 ${booking.name} No-show — ${countMsg}`,
    { label: '↩ 復原', onClick: () => {
        setStatus(booking.id, 'confirmed')
        revokeNoshow(booking.phone, booking.id)
        toast.success(`已復原 ${booking.name} 為待到，爽約次數已扣回`)
    } },
    { duration: 8000 })
}

// 卡片常駐的「↩ 恢復為待到」：No-show 復原的另一個入口（toast 的復原鈕幾秒後會消失）。
// 同樣要扣回爽約次數。
export function restoreFromNoshow(booking, { setStatus, revokeNoshow, toast }) {
  setStatus(booking.id, 'confirmed')
  revokeNoshow(booking.phone, booking.id)
  toast.success(`${booking.name} 已恢復為待到，爽約次數已扣回`)
}

// 取消訂位 + 可復原 toast。
// ★ 復原一定要把 cancelBooking 的回傳快照原封帶回 undoCancelBooking：取消時桌位已被 clearTable
//   釋出、booking 的 assignedTableId 也被清空，只呼叫 setStatus(id,'confirmed') 的話訂位會變回
//   「待到」但桌沒了，而且畫面上看不出來——這是 2026-08 修掉的既有 bug，不可回退。
//   桌位在復原前那幾秒被別組佔走時不硬搶，改在 toast 明講哪幾桌要重新指派。
export function cancelWithUndo(booking, { cancelBooking, undoCancelBooking, toast }) {
  const r = cancelBooking(booking.id)
  if (!r?.ok) return toast.error('取消失敗：' + (r?.error || '未知錯誤'))
  toast.action(`已取消 ${booking.name} 的訂位`,
    { label: '↩ 復原', onClick: () => {
        const u = undoCancelBooking(booking.id, { tableNumbers: r.releasedTables, status: r.previousStatus })
        if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
        const okMsg = u.restored?.length ? `，${u.restored.join('、')} 已改回保留` : ''
        const failMsg = u.failed?.length ? `（${u.failed.join('、')} 已被占用，桌位未搶回，請重新指派）` : ''
        toast.success(`已復原 ${booking.name} 的訂位${okMsg}${failMsg}`)
    } },
    { duration: 8000 })
}
