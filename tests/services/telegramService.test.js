import { describe, it, expect } from 'vitest'
import * as tg from '../../src/services/telegramService'

// 現場帶位不推 Telegram（2026-08）。
// 店長回報通知群被「店員新增訂位」洗版——那是外場每開一檯就送一則的現場散客紀錄。
// 前端這條規則要與後端 functions/lib/notify.js 的 isOnsiteWalkIn 同口徑：
// source='walkin' 的整段生命週期都不推播（前端 service 只在 dev 有 token，
// 但兩邊分岔會讓本機測到的行為與正式站不一致，所以一起擋）。
//
// 註：測試環境沒有 bot token → 真的有送的路徑會回 { ok:false, reason:'no-token' }，
// 與「被現場濾網擋下」的 { ok:false, reason:'onsite-walkin' } 可明確區分。

const walkin = {
  id: 'W1', source: 'walkin', status: 'arrived', date: '2026-08-02', timeSlot: '16:00',
  name: '散客', guests: 2, phone: '', assignedTableId: '108', notes: { text: '' },
}
const phoneBooking = { ...walkin, id: 'P1', source: 'phone', status: 'confirmed', name: '林小姐', phone: '0912345678' }

describe('telegramService：現場帶位濾網', () => {
  it.each([
    ['新增', (b) => tg.notifyBookingCreated(b)],
    ['修改', (b) => tg.notifyBookingUpdated(b, { guests: 4 })],
    ['取消', (b) => tg.notifyBookingCancelled(b)],
    ['指派桌位', (b) => tg.notifyBookingAssigned(b, '108')],
    ['客人到了', (b) => tg.notifyBookingArrived(b)],
    ['離席', (b) => tg.notifyBookingCompleted(b, 75)],
    ['No-show', (b) => tg.notifyBookingNoShow(b)],
    ['換桌', (b) => tg.notifyTableMoved(b, '108', '109')],
  ])('現場散客的「%s」不推播', (_label, call) => {
    expect(call(walkin)).toEqual({ ok: false, reason: 'onsite-walkin' })
  })

  it('電話/線上訂位照常走送出流程（此環境無 token → no-token，而非被濾掉）', async () => {
    await expect(tg.notifyBookingCreated(phoneBooking)).resolves.toEqual({ ok: false, reason: 'no-token' })
    await expect(tg.notifyBookingCancelled(phoneBooking)).resolves.toEqual({ ok: false, reason: 'no-token' })
  })

  it('候位「取號」仍會推（門口排隊的即時訊號，不是排位動作）', async () => {
    await expect(tg.notifyWaitlistCreated({ queueNumber: 12, name: '王', partySize: 4, phone: '' }))
      .resolves.toEqual({ ok: false, reason: 'no-token' })
  })

  it('現場排位的專用推播函式已移除（散客直接入座 / 候位入座）', () => {
    expect(tg.notifyWalkInSeated).toBeUndefined()
    expect(tg.notifyWaitlistSeated).toBeUndefined()
  })
})
