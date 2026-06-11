// LINE 綁定 record 組裝純邏輯（不碰 Firestore / FieldValue），供根目錄 Vitest 直接測試。
// lineBind 端點與 guestCreateBooking 的「訂位即綁定」共用同一份形狀，杜絕兩處分岔。
import { notificationStateHash } from './notify.js'

// 同一使用者 10 分鐘內重複綁定不重發首推（防連點/重整洗版）。
export const LINE_BIND_PUSH_DEDUPE_MS = 10 * 60 * 1000

// 輸入皆為純資料；server timestamp（updatedAt/createdAt 的 FieldValue）由呼叫端疊加。
// 回傳：
// - record：lineBookingBindings 文件內容（不含 FieldValue 時戳）
// - bookingPatch：bookings 鏡像欄位（adminPull 同步給店員端、guestGet 給顧客端顯示用）
// - needFriend：未加好友 → pushBlocked 標記、跳過首推（follow 事件會自動補發）
// - skipPush / recentlyPushed：防重結果
export function buildLineBindingRecord({ authBooking, manageUrl = '', store, line, existing = null, now, nowMs }) {
  const lastPushAt = existing?.lastBindPushAt || existing?.lastPushedAt || ''
  const lastPushMs = lastPushAt ? new Date(lastPushAt).getTime() : 0
  const recentlyPushed = existing?.lineUserId === line.userId
    && Number.isFinite(lastPushMs)
    && nowMs - lastPushMs < LINE_BIND_PUSH_DEDUPE_MS
  const needFriend = line.friendFlag === false
  const skipPush = recentlyPushed || needFriend

  const record = {
    bookingId: authBooking.id,
    manageToken: authBooking.manageToken,
    lineUserId: line.userId,
    lineDisplayName: line.displayName || '',
    linePictureUrl: line.pictureUrl || '',
    booking: manageUrl ? { ...authBooking, manageUrl } : authBooking,
    store,
    lastBindAttemptAt: now,
    ...(needFriend
      ? { pushBlocked: true, pushBlockedReason: 'not-friend', pushBlockedAt: now }
      : { pushBlocked: false, pushBlockedReason: null, pushBlockedAt: null }),
    ...(skipPush ? {} : {
      lastBindPushAt: now,
      lastPushByEvent: {
        ...(existing?.lastPushByEvent || {}),
        confirmed: { at: now, stateHash: notificationStateHash(authBooking) },
      },
    }),
  }

  const bookingPatch = {
    lineUserId: line.userId,
    lineDisplayName: line.displayName || '',
    linePictureUrl: line.pictureUrl || '',
    linePushBlocked: needFriend,
    updatedAt: now,
  }

  return { record, bookingPatch, needFriend, skipPush, recentlyPushed }
}
