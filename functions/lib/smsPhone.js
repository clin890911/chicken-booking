import crypto from 'node:crypto'

// 叫號簡訊專用的「嚴格台灣手機」判斷。只用來決定要不要建 smsOutbox，
// 刻意不回頭改候位 phone 的既有驗證（那是寬鬆的 ≤30 字串；改嚴會讓舊前端取號被 400 擋下）。
// 接受：0912345678、0912-345-678、+886 912 345 678、886912345678、+8860912345678。
// 市話（049…）、位數不對、空值 → null。
export function normalizeTwMobile(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  let d = String(value).replace(/\D/g, '')
  if (d.startsWith('886')) d = d.slice(3).replace(/^0?/, '0')
  return /^09\d{8}$/.test(d) ? d : null
}

// smsOutbox 文件 id 由 waitlistId＋commandId 決定：同一命令重放（receipt 已存在）在寫入前就 return，
// 不會再寫；就算真的再寫一次，也是同一份 id，不會多出第二封。
export function waitlistCallOutboxId(waitlistId, commandId) {
  return 'wl_call_' + crypto.createHash('sha256').update(JSON.stringify([waitlistId, commandId])).digest('hex').slice(0, 40)
}

// 叫號交易內要多寫的那一筆（純資料，不讀任何東西）。沒有可用手機 → null（不寫）。
// 總開關、上限、範本都在送出端判斷，叫號交易完全不讀 system/smsConfig。
export function buildWaitlistCallOutbox({ item, commandId, now }) {
  const to = normalizeTwMobile(item?.phone)
  if (!to || !item?.id || !commandId) return null
  return {
    id: waitlistCallOutboxId(item.id, commandId),
    data: {
      kind: 'waitlist-call',
      waitlistId: item.id,
      commandId,
      queueNumber: item.queueNumber ?? null,
      calledAt: item.calledAt || now,
      to,
      template: 'waitlist-call',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}
