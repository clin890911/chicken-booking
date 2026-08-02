import { describe, it, expect } from 'vitest'
import {
  notificationStateHash,
  shouldSkipDuplicatePush,
  isRetryableLineStatus,
  dayLabelServer,
  buildManageUrl,
  classifyAdminBookingChange,
  classifyAdminBookingBackupEvent,
  diffAdminBooking,
  resolveBackupChatId,
  isOnsiteWalkIn,
  compactBookingForBackup,
  bookingTableNumbers,
  dateWithWeekday,
  tgBookingMessage,
  LINE_PUSH_DEDUPE_WINDOW_MS,
} from '../../functions/lib/notify.js'

// 後端 LINE 通知純邏輯（functions/lib/notify.js）。
// 這層擋的是兩個生產事故型 bug：
// 1) 部署共存窗口（新後端＋舊前端）重複推播 → 防重指紋
// 2) 非好友/封鎖的 push 重試 6 次塞爆 dead-letter → 可重試性判斷

describe('notificationStateHash', () => {
  const base = { date: '2026-06-15', timeSlot: '18:00', guests: 4, status: 'confirmed' }

  it('相同關鍵欄位 → 相同指紋', () => {
    expect(notificationStateHash({ ...base })).toBe(notificationStateHash({ ...base, name: '別人', notes: { pet: true } }))
  })

  it.each([
    ['date', { date: '2026-06-16' }],
    ['timeSlot', { timeSlot: '18:30' }],
    ['guests', { guests: 5 }],
    ['status', { status: 'cancelled' }],
  ])('%s 改變 → 指紋改變', (_key, patch) => {
    expect(notificationStateHash({ ...base, ...patch })).not.toBe(notificationStateHash(base))
  })

  it('空 booking 不丟例外', () => {
    expect(notificationStateHash()).toBe('|||')
  })
})

describe('shouldSkipDuplicatePush', () => {
  const NOW = Date.parse('2026-06-15T10:00:00Z')
  const hash = 'd|t|4|confirmed'
  const recent = { updated: { at: new Date(NOW - 30_000).toISOString(), stateHash: hash } }

  it('同 event 同指紋且在窗口內 → 跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', hash, NOW)).toBe(true)
  })

  it('指紋不同（客人又改了內容）→ 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', 'other-hash', NOW)).toBe(false)
  })

  it('不同 event → 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'cancelled', hash, NOW)).toBe(false)
  })

  it('超過窗口 → 不跳過', () => {
    expect(shouldSkipDuplicatePush(recent, 'updated', hash, NOW + LINE_PUSH_DEDUPE_WINDOW_MS + 1)).toBe(false)
  })

  it('無紀錄 / 壞時間戳 → 不跳過', () => {
    expect(shouldSkipDuplicatePush(undefined, 'updated', hash, NOW)).toBe(false)
    expect(shouldSkipDuplicatePush({}, 'updated', hash, NOW)).toBe(false)
    expect(shouldSkipDuplicatePush({ updated: { at: 'not-a-date', stateHash: hash } }, 'updated', hash, NOW)).toBe(false)
  })
})

describe('isRetryableLineStatus', () => {
  it.each([400, 403, 404])('%i（封鎖/非好友/壞請求）→ 不重試', status => {
    expect(isRetryableLineStatus(status)).toBe(false)
  })

  it.each([429, 500, 502, 503])('%i（限流/伺服器錯）→ 重試', status => {
    expect(isRetryableLineStatus(status)).toBe(true)
  })

  it('無 HTTP 狀態（逾時/網路錯誤）→ 重試', () => {
    expect(isRetryableLineStatus(undefined)).toBe(true)
    expect(isRetryableLineStatus('timeout')).toBe(true)
  })
})

describe('dayLabelServer', () => {
  it('輸出與前端 dayLabel 同格式（2026-01-01 是週四）', () => {
    expect(dayLabelServer('2026-01-01')).toBe('1/1 (四)')
  })

  it('無效日期回傳原字串，不丟例外', () => {
    expect(dayLabelServer('not-a-date')).toBe('not-a-date')
    expect(dayLabelServer('')).toBe('')
  })
})

describe('buildManageUrl', () => {
  it('組出管理連結並編碼 token', () => {
    expect(buildManageUrl('https://example.com', 'B123', 'tok+/=')).toBe(
      'https://example.com/manage/B123?token=tok%2B%2F%3D',
    )
  })

  it('容忍結尾斜線', () => {
    expect(buildManageUrl('https://example.com/', 'B123', 'tok')).toBe('https://example.com/manage/B123?token=tok')
  })

  it('publicSiteUrl 未設定或非 http(s) → 回空字串（Flex 卡片直接略過按鈕）', () => {
    expect(buildManageUrl('', 'B123', 'tok')).toBe('')
    expect(buildManageUrl('javascript:alert(1)', 'B123', 'tok')).toBe('')
    expect(buildManageUrl('https://example.com', '', 'tok')).toBe('')
    expect(buildManageUrl('https://example.com', 'B123', '')).toBe('')
  })
})

describe('classifyAdminBookingChange（店員端變更分類：只通知客人在意的變更）', () => {
  const base = {
    id: 'B1', status: 'confirmed', date: '2026-06-20', timeSlot: '18:00', guests: 4,
    assignedTableId: null, notes: { text: '' },
  }

  it.each([
    ['confirmed → cancelled', { status: 'cancelled' }, 'cancelled'],
    ['arrived → cancelled', { status: 'cancelled' }, 'cancelled', { status: 'arrived' }],
    ['改日期', { date: '2026-06-21' }, 'updated'],
    ['改時段', { timeSlot: '18:30' }, 'updated'],
    ['改人數', { guests: 6 }, 'updated'],
  ])('%s → %s', (_label, patch, expected, beforePatch = {}) => {
    expect(classifyAdminBookingChange({ ...base, ...beforePatch }, { ...base, ...beforePatch, ...patch })).toBe(expected)
  })

  it.each([
    ['指派桌位', { assignedTableId: '102' }],
    ['改備註', { notes: { text: '靠窗' } }],
    ['入座', { status: 'arrived' }],
    ['結帳', { status: 'completed' }],
    ['標 no-show', { status: 'noshow' }],
    ['完全沒變', {}],
  ])('內務操作不通知：%s → null', (_label, patch) => {
    expect(classifyAdminBookingChange(base, { ...base, ...patch })).toBeNull()
  })

  it('已取消的再編輯不再通知（cancelled → cancelled）', () => {
    expect(classifyAdminBookingChange({ ...base, status: 'cancelled' }, { ...base, status: 'cancelled', guests: 2 })).toBeNull()
  })

  it('新文件（無 before）→ null', () => {
    expect(classifyAdminBookingChange(null, base)).toBeNull()
    expect(classifyAdminBookingChange(undefined, base)).toBeNull()
  })

  it('guests 數字/字串混型仍正確比對', () => {
    expect(classifyAdminBookingChange({ ...base, guests: 4 }, { ...base, guests: '4' })).toBeNull()
    expect(classifyAdminBookingChange({ ...base, guests: '4' }, { ...base, guests: 6 })).toBe('updated')
  })
})

describe('classifyAdminBookingBackupEvent（店員端 Telegram 備份分類：含新增，只發重要變更）', () => {
  const base = {
    id: 'B1', status: 'confirmed', date: '2026-06-20', timeSlot: '18:00', guests: 4,
    assignedTableId: null, notes: { text: '' },
  }

  it('無 before（店員新建）→ created', () => {
    expect(classifyAdminBookingBackupEvent(null, base)).toBe('created')
    expect(classifyAdminBookingBackupEvent(undefined, base)).toBe('created')
  })

  it.each([
    ['confirmed → cancelled', { status: 'cancelled' }, 'cancelled'],
    ['arrived → cancelled', { status: 'cancelled' }, 'cancelled', { status: 'arrived' }],
    ['改日期', { date: '2026-06-21' }, 'updated'],
    ['改時段', { timeSlot: '18:30' }, 'updated'],
    ['改人數', { guests: 6 }, 'updated'],
    // 放寬：已入座/已結帳客人臨時改人數/日期/時段也要備份
    ['已入座改人數', { guests: 6 }, 'updated', { status: 'arrived' }],
    ['已結帳改人數', { guests: 6 }, 'updated', { status: 'completed' }],
    ['已入座改時段', { timeSlot: '18:30' }, 'updated', { status: 'arrived' }],
  ])('%s → %s', (_label, patch, expected, beforePatch = {}) => {
    expect(classifyAdminBookingBackupEvent({ ...base, ...beforePatch }, { ...base, ...beforePatch, ...patch })).toBe(expected)
  })

  it.each([
    ['指派桌位', { assignedTableId: '102' }],
    ['改備註', { notes: { text: '靠窗' } }],
    ['入座', { status: 'arrived' }],
    ['結帳', { status: 'completed' }],
    ['標 no-show', { status: 'noshow' }],
    ['完全沒變', {}],
  ])('內務操作不發：%s → null', (_label, patch) => {
    expect(classifyAdminBookingBackupEvent(base, { ...base, ...patch })).toBeNull()
  })

  it('已取消的再編輯不再發（cancelled → cancelled）', () => {
    expect(classifyAdminBookingBackupEvent({ ...base, status: 'cancelled' }, { ...base, status: 'cancelled', guests: 2 })).toBeNull()
  })

  it('無 after → null（沒有資料可備份）', () => {
    expect(classifyAdminBookingBackupEvent(base, null)).toBeNull()
  })

  it('guests 數字/字串混型仍正確比對', () => {
    expect(classifyAdminBookingBackupEvent({ ...base, guests: 4 }, { ...base, guests: '4' })).toBeNull()
    expect(classifyAdminBookingBackupEvent({ ...base, guests: '4' }, { ...base, guests: 6 })).toBe('updated')
  })
})

// 現場帶位不通知（2026-08）：店長回報 Telegram 被「店員新增訂位」洗版——
// 那些其實是外場每開一檯就送一則的現場散客紀錄（source=walkin），
// 真正要看的線上/電話訂位異動反而被蓋掉。資料仍有每日 04:30 全量備份可還原。
describe('isOnsiteWalkIn（現場帶位濾網）', () => {
  it.each([
    ['現場快速帶位（已入座）', { source: 'walkin', status: 'arrived' }, true],
    ['現場帶位後離席', { source: 'walkin', status: 'completed' }, true],
    ['誤開檯取消（仍是現場紀錄）', { source: 'walkin', status: 'cancelled' }, true],
    ['線上訂位', { source: 'online', status: 'confirmed' }, false],
    ['電話訂位', { source: 'phone', status: 'confirmed' }, false],
    ['LINE 訂位', { source: 'line', status: 'confirmed' }, false],
    ['沒有 source', { status: 'confirmed' }, false],
  ])('%s → %s', (_label, booking, expected) => {
    expect(isOnsiteWalkIn(booking)).toBe(expected)
  })

  it('現場帶位的整段生命週期都不進 Telegram', () => {
    const walkin = { id: 'W1', source: 'walkin', status: 'arrived', date: '2026-08-02', timeSlot: '16:00', guests: 2 }
    expect(classifyAdminBookingBackupEvent(null, walkin)).toBeNull()                                   // 開檯
    expect(classifyAdminBookingBackupEvent(walkin, { ...walkin, guests: 4 })).toBeNull()               // 現場加人
    expect(classifyAdminBookingBackupEvent(walkin, { ...walkin, status: 'cancelled' })).toBeNull()     // 誤開檯復原
    expect(classifyAdminBookingBackupEvent(walkin, { ...walkin, status: 'completed' })).toBeNull()     // 離席
  })

  it('現場帶位的紀錄也不對客人發 LINE：候位入座會帶著候位者的 lineUserId，'
    + '外場按「復原」誤帶位時客人會收到「訂位已取消」，但他根本沒訂過位', () => {
    const walkin = { id: 'W2', source: 'walkin', status: 'arrived', date: '2026-08-02', timeSlot: '16:00', guests: 2 }
    expect(classifyAdminBookingChange(walkin, { ...walkin, status: 'cancelled' })).toBeNull()
    // 對照組：真的有訂位的客人，取消仍要通知
    const online = { ...walkin, id: 'O1', source: 'online', status: 'confirmed' }
    expect(classifyAdminBookingChange(online, { ...online, status: 'cancelled' })).toBe('cancelled')
  })

  it('電話/線上訂位不受影響（該通知的照常通知）', () => {
    const phone = { id: 'P1', source: 'phone', status: 'confirmed', date: '2026-08-02', timeSlot: '18:00', guests: 4 }
    expect(classifyAdminBookingBackupEvent(null, phone)).toBe('created')
    expect(classifyAdminBookingBackupEvent(phone, { ...phone, guests: 6 })).toBe('updated')
    expect(classifyAdminBookingBackupEvent(phone, { ...phone, status: 'cancelled' })).toBe('cancelled')
  })
})

describe('tgBookingMessage（通知格式）', () => {
  const booking = {
    id: 'B123', date: '2026-08-02', timeSlot: '16:00', name: '王小明', guests: 2,
    phone: '0912345678', status: 'arrived', source: 'phone', assignedTableId: '108',
    extraTableIds: [], notes: { pet: false, child: true, mobility: false, text: '靠窗' },
  }
  const head = (b = booking, extra = '') => tgBookingMessage('🆕 <b>新訂位</b>', b, { event: 'x', booking: b }, extra).split('\n\n')[0]

  it('標題帶訂位編號（回查時直接複製）', () => {
    expect(head()).toContain('🆕 <b>新訂位</b> · <code>B123</code>')
  })

  it('日期補星期、來源併在同一行', () => {
    expect(head()).toContain('📅 2026-08-02 (日) 16:00 · 📞 電話')
  })

  it('姓名／人數／狀態同一行——以前看不出這筆是待到還是已入座', () => {
    expect(head()).toContain('👤 王小明 · 2 位 · 用餐中')
  })

  it('併桌顯示所有桌號', () => {
    expect(head({ ...booking, extraTableIds: ['109'] })).toContain('🪑 桌 108＋109')
  })

  it('沒電話就不印空的 📱 行（現場散客常見）', () => {
    const noPhone = head({ ...booking, phone: '' })
    expect(noPhone).not.toContain('📱')
    expect(head()).toContain('📱 <code>0912345678</code>')
  })

  it('備註與旗標只印有值的', () => {
    expect(head()).toContain('📝 靠窗')
    expect(head()).toContain('👶 兒童')
    expect(head()).not.toContain('🐾 寵物')
  })

  it('補充段落（變動清單／取消原因）以空行隔開，接在摘要後', () => {
    const text = tgBookingMessage('✏️ <b>修改</b>', booking, { event: 'x', booking }, '變動：\n• 人數：2 → 4')
    expect(text).toContain('\n\n變動：\n• 人數：2 → 4\n\n<pre>')
  })

  it('JSON 備份仍在（還原用），但已瘦身：空值/衍生欄位不進訊息', () => {
    const fat = {
      ...booking,
      extraTableIds: [], lineUserId: null, lastGuestEditAt: null, cancellationReason: null,
      guestEditCount: 0, guestEditHistory: [], phoneDigits: '0912345678', manageToken: 'tok',
    }
    const text = tgBookingMessage('🆕 <b>新訂位</b>', fat, { event: 'admin_created', booking: fat })
    const json = JSON.parse(text.split('<pre>')[1].split('</pre>')[0])
    expect(json.event).toBe('admin_created')
    expect(json.booking.id).toBe('B123')
    expect(json.booking.manageToken).toBe('tok')       // 有值的照留（還原得回同一筆）
    expect(json.booking.notes).toEqual({ text: '靠窗', child: true })  // 全 false 的旗標不寫
    for (const k of ['lineUserId', 'lastGuestEditAt', 'cancellationReason', 'guestEditCount', 'guestEditHistory', 'extraTableIds', 'phoneDigits']) {
      expect(json.booking).not.toHaveProperty(k)
    }
  })

  it('HTML 特殊字元照樣跳脫（parse_mode=HTML 不可被姓名打壞）', () => {
    expect(head({ ...booking, name: '<b>駭客</b>' })).toContain('&lt;b&gt;駭客&lt;/b&gt;')
  })

  it('欄位殘缺也不炸（舊資料 / 部分文件）', () => {
    expect(() => tgBookingMessage('🆕', {}, { event: 'x' })).not.toThrow()
    expect(() => tgBookingMessage('🆕', null, null)).not.toThrow()
  })
})

describe('compactBookingForBackup / bookingTableNumbers / dateWithWeekday', () => {
  it('空值一律不寫，有值的原樣保留', () => {
    expect(compactBookingForBackup({ a: 1, b: null, c: '', d: [], e: {}, f: 0, g: false }))
      .toEqual({ a: 1, f: 0, g: false })
  })

  it('主桌 + 併桌額外桌去重去空', () => {
    expect(bookingTableNumbers({ assignedTableId: '108', extraTableIds: ['109', '108', '', null] })).toEqual(['108', '109'])
    expect(bookingTableNumbers({ assignedTableId: null })).toEqual([])
  })

  it('日期補星期；壞日期原樣回傳', () => {
    expect(dateWithWeekday('2026-08-02')).toBe('2026-08-02 (日)')
    expect(dateWithWeekday('not-a-date')).toBe('not-a-date')
  })
})

describe('resolveBackupChatId（每日全量備份的收件 chat 分流：PII 不可進主 chat 群組）', () => {
  it('backup chat 有值 → 用 backup chat', () => {
    expect(resolveBackupChatId('111222333', '999888777')).toBe('111222333')
  })

  it('backup chat 空字串 / 只有空白 → fallback 回主 chat', () => {
    expect(resolveBackupChatId('', '999888777')).toBe('999888777')
    expect(resolveBackupChatId('   ', '999888777')).toBe('999888777')
    expect(resolveBackupChatId(undefined, '999888777')).toBe('999888777')
  })

  it('兩者皆空 → 回空字串（呼叫端判定 telegram-not-configured）', () => {
    expect(resolveBackupChatId('', '')).toBe('')
    expect(resolveBackupChatId(undefined, undefined)).toBe('')
  })

  it('backup chat 前後有空白 → trim 後採用', () => {
    expect(resolveBackupChatId('  111222333  ', '999888777')).toBe('111222333')
  })
})

describe('diffAdminBooking（修改通知：從 X 變成 Y 的對照）', () => {
  const base = {
    status: 'confirmed', date: '2026-08-11', timeSlot: '11:00', guests: 4,
    name: '沈小姐', phone: '0972715257', assignedTableId: null, notes: { text: '' },
  }

  it('改人數 → 一筆 4 → 8 的變更', () => {
    expect(diffAdminBooking(base, { ...base, guests: 8 })).toEqual([
      { key: 'guests', label: '人數', from: '4', to: '8' },
    ])
  })

  it('多欄同時改 → 依欄位順序列出', () => {
    const changes = diffAdminBooking(base, { ...base, timeSlot: '18:00', guests: 6 })
    expect(changes).toEqual([
      { key: 'timeSlot', label: '時段', from: '11:00', to: '18:00' },
      { key: 'guests', label: '人數', from: '4', to: '6' },
    ])
  })

  it('status 顯示中文標籤', () => {
    expect(diffAdminBooking(base, { ...base, status: 'arrived' })).toEqual([
      { key: 'status', label: '狀態', from: '已確認', to: '已入座' },
    ])
  })

  it('桌位 null → 顯示（無）；指派後顯示桌號', () => {
    expect(diffAdminBooking(base, { ...base, assignedTableId: '102' })).toEqual([
      { key: 'assignedTableId', label: '桌位', from: '（無）', to: '102' },
    ])
  })

  it('備註只比對 text', () => {
    expect(diffAdminBooking(base, { ...base, notes: { text: '靠窗' } })).toEqual([
      { key: 'notes', label: '備註', from: '', to: '靠窗' },
    ])
    expect(diffAdminBooking(base, { ...base, notes: { text: '', pet: true } })).toEqual([])
  })

  it('沒變 → 空陣列', () => {
    expect(diffAdminBooking(base, { ...base })).toEqual([])
  })

  it('guests 數字/字串混型不算變更', () => {
    expect(diffAdminBooking({ ...base, guests: 4 }, { ...base, guests: 4 })).toEqual([])
  })
})
