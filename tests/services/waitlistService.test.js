// tests/services/waitlistService.test.js
// 測 src/services/waitlistService.js
// 後端為 localStorage（tests/setup.js 已 Map-backed mock 並每測試前後清空）
import {
  listAll,
  listActive,
  getById,
  create,
  update,
  remove,
  call,
  seat,
  leave,
  estimateWait,
  summary,
} from '../../src/services/waitlistService'

const STORAGE_KEY = 'chicken_waitlist_v1'

// 固定系統時間：2026-06-15 12:00（本機時間）
// 注意：source 內 nextNumber 與 today 比較都使用 toISOString()（UTC），
// 兩端一致，因此 queueNumber 的「當日」判定不受時區換算影響。
const FIXED_DATE = new Date(2026, 5, 15, 12, 0, 0) // 月份 0-based：5 = 六月

function rawList() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_DATE)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitlistService.create', () => {
  it('回傳含預設值的候位項目（status=waiting、各 *At 為 null）', () => {
    const item = create({})
    expect(item).toMatchObject({
      status: 'waiting',
      calledAt: null,
      seatedAt: null,
      leftAt: null,
      assignedTableNumber: null,
    })
    expect(typeof item.id).toBe('string')
    expect(item.id.startsWith('W')).toBe(true)
    expect(typeof item.takenAt).toBe('string')
  })

  it('name 為空字串時回傳 "訪客"', () => {
    expect(create({ name: '' }).name).toBe('訪客')
  })

  it('name 為純空白時 trim 後為空 → 回傳 "訪客"', () => {
    expect(create({ name: '   ' }).name).toBe('訪客')
  })

  it('未傳 name（undefined）時回傳 "訪客"', () => {
    expect(create({}).name).toBe('訪客')
  })

  it('有 name 時保留並 trim 前後空白', () => {
    expect(create({ name: '  小明  ' }).name).toBe('小明')
  })

  it('partySize 預設為 2（未傳）', () => {
    expect(create({}).partySize).toBe(2)
  })

  it('partySize 傳 0 / 非數字 → 退回預設 2（|| 的行為）', () => {
    expect(create({ partySize: 0 }).partySize).toBe(2)
    expect(create({ partySize: 'abc' }).partySize).toBe(2)
  })

  it('partySize 為有效數字時保留並轉為 Number', () => {
    expect(create({ partySize: 5 }).partySize).toBe(5)
    expect(create({ partySize: '4' }).partySize).toBe(4)
  })

  it('estimatedMin 預設為 20（未傳）', () => {
    expect(create({}).estimatedMin).toBe(20)
  })

  it('estimatedMin 傳 0 / 非數字 → 退回預設 20', () => {
    expect(create({ estimatedMin: 0 }).estimatedMin).toBe(20)
    expect(create({ estimatedMin: 'xx' }).estimatedMin).toBe(20)
  })

  it('estimatedMin 為有效數字時保留', () => {
    expect(create({ estimatedMin: 35 }).estimatedMin).toBe(35)
    expect(create({ estimatedMin: '15' }).estimatedMin).toBe(15)
  })

  it('phone 預設為空字串並 trim', () => {
    expect(create({}).phone).toBe('')
    expect(create({ phone: '  0912  ' }).phone).toBe('0912')
  })

  it('lineUserId 預設為 null，有值時保留', () => {
    expect(create({}).lineUserId).toBeNull()
    expect(create({ lineUserId: 'U123' }).lineUserId).toBe('U123')
  })

  it('notes 預設為空字串，有值時保留', () => {
    expect(create({}).notes).toBe('')
    expect(create({ notes: '靠窗' }).notes).toBe('靠窗')
  })

  it('takenAt 使用固定的系統時間', () => {
    const item = create({})
    expect(item.takenAt).toBe(FIXED_DATE.toISOString())
  })

  it('queueNumber 當日序號從 1 起遞增', () => {
    expect(create({}).queueNumber).toBe(1)
    expect(create({}).queueNumber).toBe(2)
    expect(create({}).queueNumber).toBe(3)
  })

  it('queueNumber 只計入「當日」既有候位記錄（昨日的不算）', () => {
    // 預先塞一筆昨日的記錄
    const yesterday = new Date(2026, 5, 14, 12, 0, 0).toISOString()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'Wold', takenAt: yesterday, status: 'left' }])
    )
    // 今日第一筆 → queueNumber 應為 1（昨日不計）
    expect(create({}).queueNumber).toBe(1)
    expect(create({}).queueNumber).toBe(2)
  })

  it('create 會持久化到 localStorage（listAll 可讀回）', () => {
    const item = create({ name: '阿華' })
    const all = listAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(item.id)
    expect(all[0].name).toBe('阿華')
  })

  it('每筆 id 唯一', () => {
    const ids = new Set()
    for (let i = 0; i < 20; i++) ids.add(create({}).id)
    expect(ids.size).toBe(20)
  })
})

describe('waitlistService.listAll', () => {
  it('初始為空陣列', () => {
    expect(listAll()).toEqual([])
  })

  it('回傳所有狀態的記錄（含 seated/left）', () => {
    const a = create({ name: 'A' })
    const b = create({ name: 'B' })
    seat(a.id, 5)
    leave(b.id)
    const all = listAll()
    expect(all).toHaveLength(2)
    expect(all.map((w) => w.name).sort()).toEqual(['A', 'B'])
  })

  it('localStorage 存壞掉的 JSON 時回傳 []（read 容錯）', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{')
    expect(listAll()).toEqual([])
  })
})

describe('waitlistService.listActive', () => {
  it('只回傳 waiting 或 called，排除 seated/left', () => {
    const w = create({ name: 'waiting' })
    const c = create({ name: 'called' })
    const s = create({ name: 'seated' })
    const l = create({ name: 'left' })
    call(c.id)
    seat(s.id, 1)
    leave(l.id)

    const active = listActive()
    const names = active.map((x) => x.name).sort()
    expect(names).toEqual(['called', 'waiting'])
    // 確認 w 與 c 在內、s 與 l 不在
    expect(active.find((x) => x.id === w.id)).toBeTruthy()
    expect(active.find((x) => x.id === l.id)).toBeFalsy()
    expect(active.find((x) => x.id === s.id)).toBeFalsy()
  })

  it('無 active 記錄時回傳空陣列', () => {
    const s = create({})
    seat(s.id, 2)
    expect(listActive()).toEqual([])
  })
})

describe('waitlistService.getById', () => {
  it('找得到時回傳該記錄', () => {
    const item = create({ name: '查得到' })
    expect(getById(item.id)).toMatchObject({ id: item.id, name: '查得到' })
  })

  it('找不到時回傳 null', () => {
    create({})
    expect(getById('不存在的id')).toBeNull()
  })

  it('空儲存時回傳 null', () => {
    expect(getById('whatever')).toBeNull()
  })
})

describe('waitlistService.update', () => {
  it('合併 patch 並持久化，回傳更新後物件', () => {
    const item = create({ name: '原' })
    const updated = update(item.id, { name: '新', notes: '加註' })
    expect(updated.name).toBe('新')
    expect(updated.notes).toBe('加註')
    // 持久化
    expect(getById(item.id).name).toBe('新')
  })

  it('找不到 id 時回傳 null 且不改變儲存', () => {
    const item = create({ name: '不動' })
    const before = rawList()
    expect(update('不存在', { name: 'x' })).toBeNull()
    expect(rawList()).toEqual(before)
    expect(getById(item.id).name).toBe('不動')
  })

  it('patch 不影響其他記錄', () => {
    const a = create({ name: 'A' })
    const b = create({ name: 'B' })
    update(a.id, { name: 'A2' })
    expect(getById(b.id).name).toBe('B')
  })
})

describe('waitlistService.remove', () => {
  it('刪除指定 id', () => {
    const a = create({ name: 'A' })
    const b = create({ name: 'B' })
    remove(a.id)
    const all = listAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(b.id)
  })

  it('刪除不存在的 id 不影響其他記錄', () => {
    const a = create({})
    remove('不存在')
    expect(listAll()).toHaveLength(1)
    expect(getById(a.id)).toBeTruthy()
  })
})

describe('waitlistService.call', () => {
  it('狀態轉為 called 並寫入 calledAt（固定時間）', () => {
    const item = create({})
    const called = call(item.id)
    expect(called.status).toBe('called')
    expect(called.calledAt).toBe(FIXED_DATE.toISOString())
    // 持久化
    expect(getById(item.id).status).toBe('called')
  })

  it('找不到 id 時回傳 null', () => {
    expect(call('不存在')).toBeNull()
  })
})

describe('waitlistService.seat', () => {
  it('狀態轉為 seated、寫入 seatedAt 與 assignedTableNumber', () => {
    const item = create({})
    const seated = seat(item.id, 12)
    expect(seated.status).toBe('seated')
    expect(seated.seatedAt).toBe(FIXED_DATE.toISOString())
    expect(seated.assignedTableNumber).toBe(12)
    expect(getById(item.id).assignedTableNumber).toBe(12)
  })

  it('tableNumber 可為字串桌號', () => {
    const item = create({})
    expect(seat(item.id, 'A3').assignedTableNumber).toBe('A3')
  })

  it('找不到 id 時回傳 null', () => {
    expect(seat('不存在', 1)).toBeNull()
  })
})

describe('waitlistService.leave', () => {
  it('狀態轉為 left 並寫入 leftAt（固定時間）', () => {
    const item = create({})
    const left = leave(item.id)
    expect(left.status).toBe('left')
    expect(left.leftAt).toBe(FIXED_DATE.toISOString())
    expect(getById(item.id).status).toBe('left')
  })

  it('找不到 id 時回傳 null', () => {
    expect(leave('不存在')).toBeNull()
  })
})

describe('狀態轉移流程', () => {
  it('waiting → called → seated 連續轉移保留各時間戳', () => {
    const item = create({})
    expect(getById(item.id).status).toBe('waiting')
    call(item.id)
    seat(item.id, 7)
    const final = getById(item.id)
    expect(final.status).toBe('seated')
    expect(final.calledAt).toBe(FIXED_DATE.toISOString())
    expect(final.seatedAt).toBe(FIXED_DATE.toISOString())
    expect(final.assignedTableNumber).toBe(7)
  })

  it('waiting → left（棄號）', () => {
    const item = create({})
    leave(item.id)
    expect(getById(item.id).status).toBe('left')
  })
})

describe('waitlistService.estimateWait', () => {
  it('預設 avgMin=8：activeCount × 8', () => {
    expect(estimateWait(0)).toBe(0)
    expect(estimateWait(1)).toBe(8)
    expect(estimateWait(3)).toBe(24)
  })

  it('可指定 avgMin', () => {
    expect(estimateWait(5, 10)).toBe(50)
    expect(estimateWait(2, 0)).toBe(0)
  })

  // 釐清：estimateWait 的預設 avgMin=8（每組約 8 分、依在線組數推估）與 create() 的
  // estimatedMin 預設 20（取號時保守固定值）是不同概念，兩者不需一致。
  it('estimateWait 預設 avgMin=8，與 create 的 estimatedMin 預設 20 為不同概念', () => {
    expect(estimateWait(1)).toBe(8)
  })
})

describe('waitlistService.summary', () => {
  it('空儲存時各計數為 0', () => {
    expect(summary()).toEqual({ waiting: 0, called: 0, seated: 0, active: 0 })
  })

  it('正確統計各狀態數量，active = waiting + called', () => {
    // 2 waiting
    create({})
    create({})
    // 1 called
    const c = create({})
    call(c.id)
    // 3 seated
    const s1 = create({})
    const s2 = create({})
    const s3 = create({})
    seat(s1.id, 1)
    seat(s2.id, 2)
    seat(s3.id, 3)
    // 1 left（不計入 active）
    const l = create({})
    leave(l.id)

    expect(summary()).toEqual({
      waiting: 2,
      called: 1,
      seated: 3,
      active: 3, // 2 + 1
    })
  })

  it('left 狀態不計入任何 summary 欄位（除了不在 active）', () => {
    const l = create({})
    leave(l.id)
    expect(summary()).toEqual({ waiting: 0, called: 0, seated: 0, active: 0 })
  })
})

describe('資料隔離', () => {
  it('每個測試從乾淨狀態開始（setup 自動清空）', () => {
    expect(listAll()).toEqual([])
  })

  it('不同 service 操作互不串改（同一 storage key 一致性）', () => {
    const a = create({ name: 'A' })
    const b = create({ name: 'B' })
    call(a.id)
    leave(b.id)
    // 直接讀 raw 確認與 API 一致
    const raw = rawList()
    expect(raw.find((w) => w.id === a.id).status).toBe('called')
    expect(raw.find((w) => w.id === b.id).status).toBe('left')
  })
})
