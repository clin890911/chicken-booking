import { describe, it, expect } from 'vitest'
import { executeWaitlistCommand } from '../../functions/lib/waitlistCommands.js'
import { waitlistCallOutboxId } from '../../functions/lib/smsPhone.js'

// 與 waitlistReadBoundary 同款 fakeDb：交易內寫入後再讀會直接 throw（守住「所有讀在寫之前」）。
const fakeDb = () => {
  const records = new Map()
  let txReads = 0
  const ref = path => ({ path, id: path.split('/').at(-1), collection: n => ({ doc: id => ref(path + '/' + n + '/' + id) }) })
  const db = { collection: n => ({ doc: id => ref(n + '/' + id), where: (key, op, value) => ({ collection: n, key, value }) }), runTransaction: async fn => {
    const writes = []; let writing = false
    const result = await fn({ get: async r => { txReads++; if (writing) throw Error('read-after-write'); if (typeof r.collection === 'string') return { docs: [...records].filter(([p, v]) => p.startsWith(r.collection + '/') && p.split('/').length === 2 && v[r.key] === r.value).map(([p, v]) => ({ id: p.split('/').at(-1), data: () => structuredClone(v) })) }; return { exists: records.has(r.path), data: () => structuredClone(records.get(r.path)) } }, set: (r, d) => { writing = true; writes.push([r.path, d]) }, delete: r => { writing = true; writes.push([r.path, null]) } })
    for (const [p, v] of writes) { if (v) records.set(p, structuredClone(v)); else records.delete(p) }
    return result
  } }
  return { db, records, reads: () => txReads }
}
const now = '2026-10-18T04:00:00.000Z', day = '2026-10-18', staff = { uid: 'A', role: 'floor' }
const outboxes = records => [...records].filter(([p]) => p.startsWith('smsOutbox/'))
const seed = (records, phone, extra = {}) => records.set('waitlist/W1', { id: 'W1', takenAt: now, status: 'waiting', queueVersion: 1, queueNumber: 12, name: '王先生', phone, partySize: 2, children: 0, adults: 2, serverManaged: true, ...extra })
const cmd = (action, commandId, expectedVersion, payload = {}) => ({ id: 'W1', date: day, commandId, expectedVersion, action, payload })

describe('叫號交易只多寫一筆 smsOutbox（不加讀取、不改狀態/版本）', () => {
  it('有手機：寫一筆 pending outbox；waitlist 狀態與 queueVersion 與原本完全相同；交易讀取次數不變', async () => {
    const a = fakeDb(), b = fakeDb()
    seed(a.records, '0912345678'); seed(b.records, '')
    const ra = await executeWaitlistCommand({ db: a.db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    const rb = await executeWaitlistCommand({ db: b.db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    expect(a.reads()).toBe(b.reads()) // 有沒有手機，交易讀取數一樣（outbox 不增加任何讀）
    const { phone: _pa, ...itemA } = ra.item, { phone: _pb, ...itemB } = rb.item
    expect(itemA).toEqual(itemB)
    expect(ra.item).toMatchObject({ status: 'called', calledAt: now, queueVersion: 2 })
    const list = outboxes(a.records)
    expect(list).toHaveLength(1)
    expect(list[0][0]).toBe('smsOutbox/' + waitlistCallOutboxId('W1', 'call_cmd_0001'))
    expect(list[0][1]).toMatchObject({ kind: 'waitlist-call', waitlistId: 'W1', commandId: 'call_cmd_0001', queueNumber: 12, calledAt: now, to: '0912345678', status: 'pending' })
    expect(JSON.stringify(ra)).not.toMatch(/smsOutbox/) // 回應形狀不變
  })
  it('重放同一命令（ACK 遺失）：不重寫 outbox（就算 outbox 已被送出端改成 sent 也不會被蓋回 pending）', async () => {
    const { db, records } = fakeDb(); seed(records, '0912345678')
    const command = cmd('call', 'call_cmd_0001', 1)
    await executeWaitlistCommand({ db, staff, command, now })
    const id = 'smsOutbox/' + waitlistCallOutboxId('W1', 'call_cmd_0001')
    records.set(id, { ...records.get(id), status: 'sent' })
    const replay = await executeWaitlistCommand({ db, staff, command, now: '2026-10-18T04:00:05.000Z' })
    expect(replay.replayed).toBe(true)
    expect(outboxes(records)).toHaveLength(1)
    expect(records.get(id).status).toBe('sent')
  })
  it.each([['0492753377', '市話'], ['', '空'], ['091234', '不完整']])('電話 %s（%s）→ 照常叫號、不寫 outbox', async phone => {
    const { db, records } = fakeDb(); seed(records, phone)
    const r = await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    expect(r.item.status).toBe('called')
    expect(outboxes(records)).toHaveLength(0)
  })
  it('+886 格式的手機也寫，to 正規化成 09 開頭', async () => {
    const { db, records } = fakeDb(); seed(records, '+886 912-345-678')
    await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    expect(outboxes(records)[0][1].to).toBe('0912345678')
    expect(records.get('waitlist/W1').phone).toBe('+886 912-345-678') // 候位 phone 原樣保留，不改既有驗證/資料
  })
  it('create／skip／leave／seat 都不寫 outbox', async () => {
    const { db, records } = fakeDb()
    records.set('waitlistCounters/' + day, { lastNumber: 0 })
    await executeWaitlistCommand({ db, staff, command: { ...cmd('create', 'create_cmd_0001', 0, { name: '王', phone: '0912345678', partySize: 2, children: 0 }) }, now })
    await executeWaitlistCommand({ db, staff, command: cmd('skip', 'skip_cmd_0001', 1), now })
    records.set('waitlist/W2', { id: 'W2', takenAt: now, status: 'waiting', queueVersion: 1, queueNumber: 2, name: 'B', phone: '0912345678', partySize: 2, children: 0 })
    await executeWaitlistCommand({ db, staff, command: { ...cmd('leave', 'leave_cmd_0001', 1), id: 'W2' }, now })
    records.set('waitlist/W3', { id: 'W3', takenAt: now, status: 'waiting', queueVersion: 1, queueNumber: 3, name: 'C', phone: '0912345678', partySize: 2, children: 0 })
    records.set('tables/T1', { number: 'T1', floor: '1F', capacity: 4, status: 'vacant' })
    await executeWaitlistCommand({ db, staff, command: { ...cmd('seat', 'seat_cmd_0001', 1, { tableNumbers: ['T1'] }), id: 'W3' }, now })
    expect(records.get('waitlist/W3').status).toBe('seated')
    expect(outboxes(records)).toHaveLength(0)
  })
  it('已叫號再叫被拒（waitlist-already-called）→ 不寫第二封', async () => {
    const { db, records } = fakeDb(); seed(records, '0912345678')
    await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    await expect(executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0002', 2), now })).rejects.toThrow('waitlist-already-called')
    expect(outboxes(records)).toHaveLength(1)
  })
  it('暫過號 → 回來了 → 再叫號：新命令產生第二筆 outbox（不同 id、新的 calledAt）', async () => {
    const { db, records } = fakeDb(); seed(records, '0912345678')
    await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    await executeWaitlistCommand({ db, staff, command: cmd('skip', 'skip_cmd_0001', 2), now })
    await executeWaitlistCommand({ db, staff, command: cmd('return', 'return_cmd_0001', 3), now })
    const later = '2026-10-18T04:05:00.000Z'
    await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0002', 4), now: later })
    const list = outboxes(records)
    expect(list).toHaveLength(2)
    expect(records.get('smsOutbox/' + waitlistCallOutboxId('W1', 'call_cmd_0002')).calledAt).toBe(later)
  })
  it('叫號後 smsStatus 由送出端回寫：之後的命令以 {...current} 展開會保留它，不影響 queueVersion 檢查', async () => {
    const { db, records } = fakeDb(); seed(records, '0912345678')
    await executeWaitlistCommand({ db, staff, command: cmd('call', 'call_cmd_0001', 1), now })
    records.set('waitlist/W1', { ...records.get('waitlist/W1'), smsStatus: { state: 'sent' } })
    const r = await executeWaitlistCommand({ db, staff, command: cmd('leave', 'leave_cmd_0001', 2), now })
    expect(r.item).toMatchObject({ status: 'left', queueVersion: 3, smsStatus: { state: 'sent' } })
  })
})

describe('smsStatus 進讀取投影（卡片顯示用），不含門號', () => {
  it('所有角色都看得到 smsStatus；kitchen 照舊看不到 phone', async () => {
    const { projectForRead } = await import('../../functions/lib/dataProjection.js')
    const doc = { id: 'W1', status: 'called', phone: '0912345678', smsStatus: { state: 'sent', outboxId: 'x', calledAt: now, at: now } }
    for (const role of ['manager', 'floor', 'host', 'kitchen']) expect(projectForRead('waitlist', doc, role).smsStatus).toEqual(doc.smsStatus)
    expect(projectForRead('waitlist', doc, 'kitchen')).not.toHaveProperty('phone')
  })
})
