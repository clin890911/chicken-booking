import { readFileSync } from 'node:fs'
import {
  PROTECTED_SETTINGS_FIELDS,
  preserveProtectedSettings,
  evaluateSettingsPush,
  guardSettingsPush,
  buildSettingsGuardAlert,
  summarizeUserAgent,
  taipeiDay,
} from '../../functions/lib/settingsGuard'
import { validateLineReadiness, DEFAULT_LINE_LOGIN_START_ENDPOINT } from '../../functions/lib/lineReadiness'
import { normalizeOnlineGuardSettings } from '../../functions/lib/onlineGuards'
import { guestPolicy } from '../../functions/lib/guestReliability'
import { guestBackendHarness } from '../helpers/guestBackendHarness'

// 取 functions/index.js 真正的 normalizeStoreSettings 原始碼（不初始化 Firebase）。
// floorPlan/seatings/closures 子正規化以恆等函式替身——本測只關心 LINE 欄位與「其他欄位行為不變」。
const source = readFileSync('functions/index.js', 'utf8')
const extract = name => {
  let start = source.indexOf('function ' + name + '(')
  if (start < 0) throw Error('missing ' + name)
  if (source.slice(start - 6, start) === 'async ') start -= 6
  return source.slice(start, source.indexOf('\n}', start) + 2)
}
const normalizeStoreSettings = new Function(
  'normalizeFloorPlanServer', 'normalizeSeatingsServer', 'normalizeClosuresServer', 'normalizeOnlineGuardSettings', 'guestPolicy',
  'DEFAULT_DINING_DURATION_MIN', 'DEFAULT_CLEANUP_BUFFER_MIN', 'DEFAULT_LINE_LOGIN_START_ENDPOINT',
  'DEFAULT_STORE_PHONE', 'DEFAULT_STORE_ADDRESS', 'DEFAULT_STORE_MAP_URL', 'DEFAULT_STORE_LATITUDE', 'DEFAULT_STORE_LONGITUDE',
  extract('normalizeStoreSettings') + '\nreturn normalizeStoreSettings',
)(x => x ?? null, x => x ?? [], x => x ?? null, normalizeOnlineGuardSettings, guestPolicy,
  90, 10, DEFAULT_LINE_LOGIN_START_ENDPOINT, '0000', 'addr', 'map', 1, 2)

const LINE = {
  lineLoginChannelId: '1234567890',
  lineLoginStartEndpoint: 'https://lineloginstart-reaor76eyq-uc.a.run.app',
  lineLoginCallbackUrl: 'https://linelogincallback-reaor76eyq-uc.a.run.app',
  publicSiteUrl: 'https://chicken-booking.zeabur.app/',
}
const cloud = { openTime: '11:00', closeTime: '19:00', storeName: '雞王', lineOfficialUrl: 'https://lin.ee/abc', ...LINE, updatedAt: '2026-10-08T00:00:00Z' }
// 舊版前端：LINE 欄位全空（或根本沒有這些 key），其他欄位照常帶
const oldDevice = { ...cloud, openTime: '10:30', lineLoginChannelId: '', lineLoginCallbackUrl: '', publicSiteUrl: '', lineLoginStartEndpoint: undefined }
const staff = { uid: 'uid-1', email: 'manager@example.com', role: 'manager', source: 'env' }
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

describe('settings 守門：受保護 LINE 欄位空值不洗掉雲端值', () => {
  it('舊裝置送空 LINE 欄位 → 保留雲端值，readiness 維持就緒，其他欄位照寫', () => {
    expect(validateLineReadiness(normalizeStoreSettings(cloud)).ready).toBe(true)
    const r = evaluateSettingsPush({ existingRaw: cloud, incomingRaw: oldDevice, normalize: normalizeStoreSettings })
    for (const [k, v] of Object.entries(LINE)) expect(r.next[k]).toBe(v)
    expect(r.preserved.sort()).toEqual(Object.keys(LINE).sort())
    expect(r.next.openTime).toBe('10:30')
    expect(r.lineReadyAfter).toBe(true)
    expect(r.readinessDropped).toBe(false)
    expect(r.protectedChanged).toEqual([])
    expect(r.changedKeys).toEqual(['openTime'])
  })

  it('送新的非空值 → 照寫（店主在後台合法修改仍生效）', () => {
    const incoming = { ...cloud, lineLoginChannelId: '9876543210', publicSiteUrl: 'https://chicken-booking.zeabur.app' }
    const r = evaluateSettingsPush({ existingRaw: cloud, incomingRaw: incoming, normalize: normalizeStoreSettings })
    expect(r.next.lineLoginChannelId).toBe('9876543210')
    expect(r.next.publicSiteUrl).toBe('https://chicken-booking.zeabur.app')
    expect(r.preserved).toEqual([])
    expect(r.protectedChanged).toEqual(['lineLoginChannelId', 'publicSiteUrl'])
    expect(r.lineReadyAfter).toBe(true)
  })

  it('其他欄位行為不變：輸出與「直接 normalize 客戶端資料」逐 key 相同（受保護欄位除外）', () => {
    const incoming = { ...oldDevice, storeName: '', autoReleaseEnabled: false, maxDaysAhead: 0, heroBanners: 'x', lineUseLiff: false, lineNotifyOnAdminChange: true }
    const r = evaluateSettingsPush({ existingRaw: { ...cloud, storeName: '舊名', lineUseLiff: true }, incomingRaw: incoming, normalize: normalizeStoreSettings })
    const plain = normalizeStoreSettings(incoming)
    for (const key of Object.keys(plain)) {
      if (PROTECTED_SETTINGS_FIELDS.includes(key)) continue
      expect(r.next[key], key).toEqual(plain[key])
    }
    expect(Object.keys(r.next)).toEqual(Object.keys(plain))
    // 布林開關不受保護：false 是合法選擇，照寫
    expect(r.next.lineUseLiff).toBe(false)
  })

  it('受保護欄位全帶非空值時，輸出與舊行為完全一致', () => {
    const incoming = { ...cloud, lineOfficialUrl: 'https://lin.ee/new', lineLiffId: '1-a', lineLiffUrl: 'https://liff.line.me/1-a' }
    const r = evaluateSettingsPush({ existingRaw: cloud, incomingRaw: incoming, normalize: normalizeStoreSettings })
    expect(r.next).toEqual(normalizeStoreSettings(incoming))
  })

  it('雲端本來就沒有值（首次設定）→ 不保留、不告警', () => {
    const r = guardSettingsPush({ existingRaw: {}, incomingRaw: { openTime: '11:00' }, normalize: normalizeStoreSettings, staff })
    expect(r.preserved).toEqual([])
    expect(r.alert).toBeNull()
  })

  it('缺 key 與空白字串都視為空值', () => {
    const { settings, preserved } = preserveProtectedSettings({ publicSiteUrl: '   ' }, cloud)
    expect(settings.publicSiteUrl).toBe(cloud.publicSiteUrl)
    expect(settings.lineLoginChannelId).toBe(cloud.lineLoginChannelId)
    expect(preserved).toContain('lineLoginCallbackUrl')
  })
})

describe('lineLoginStartEndpoint 預設', () => {
  it('雲端與客戶端都沒有綁定入口時 normalize 補上已部署端點，readiness 仍可為 true', () => {
    const { lineLoginStartEndpoint, ...rest } = LINE
    const s = normalizeStoreSettings({ ...rest, lineOfficialUrl: 'https://lin.ee/abc' })
    expect(s.lineLoginStartEndpoint).toBe(DEFAULT_LINE_LOGIN_START_ENDPOINT)
    expect(validateLineReadiness(s).ready).toBe(true)
    expect(normalizeStoreSettings({ lineLoginStartEndpoint: '' }).lineLoginStartEndpoint).toBe(DEFAULT_LINE_LOGIN_START_ENDPOINT)
  })
  it('有自訂值時照用；回呼網址不給預設（必須與 LINE Console 一致）', () => {
    const alias = 'https://us-central1-chicken-booking-tw.cloudfunctions.net/lineLoginStart'
    expect(normalizeStoreSettings({ lineLoginStartEndpoint: alias }).lineLoginStartEndpoint).toBe(alias)
    expect(normalizeStoreSettings({}).lineLoginCallbackUrl).toBe('')
  })
})

describe('告警：readiness 掉落／欄位被改／攔截空值，且不洗版', () => {
  const nowMs = Date.parse('2026-10-08T03:00:00Z')
  const run = (incomingRaw, ua = UA_IPAD, at = nowMs) => guardSettingsPush({ existingRaw: cloud, incomingRaw, normalize: normalizeStoreSettings, staff, userAgent: ua, nowMs: at })

  it('readiness 由就緒變未就緒 → 🚨 告警並點名欄位與裝置', () => {
    const r = run({ ...cloud, lineLoginCallbackUrl: 'https://evil.example/cb' })
    expect(r.readinessDropped).toBe(true)
    expect(r.brokenFields).toEqual(['lineLoginCallbackUrl'])
    expect(r.alert.text).toContain('LINE 綁定設定失效')
    expect(r.alert.text).toContain('LINE Login 回呼網址')
    expect(r.alert.text).toContain('iPad · Safari 16')
    expect(r.alert.text).toContain('manager')
  })

  it('攔截空值 → 只記「已攔截空值覆蓋」，不發失效告警', () => {
    const r = run(oldDevice)
    expect(r.alert.text).toContain('已攔截空值覆蓋')
    expect(r.alert.text).not.toContain('🚨')
  })

  it('同一天同欄位攔截只產生同一個去重 version（不同裝置也一樣）；隔天重新告警', () => {
    const a = run(oldDevice, UA_IPAD)
    const b = run({ ...oldDevice, openTime: '12:00' }, UA_WIN, nowMs + 3600_000)
    const nextDay = run(oldDevice, UA_IPAD, nowMs + 24 * 3600_000)
    expect(a.alert.version).toBe(b.alert.version)
    expect(nextDay.alert.version).not.toBe(a.alert.version)
  })

  it('不同的修改內容各自告警；無受保護變動則不告警', () => {
    const x = run({ ...cloud, lineLoginChannelId: '1111111111' })
    const y = run({ ...cloud, lineLoginChannelId: '2222222222' })
    expect(x.alert.text).toContain('LINE 設定被修改')
    expect(x.alert.version).not.toBe(y.alert.version)
    expect(run({ ...cloud, openTime: '12:00' }).alert).toBeNull()
  })

  it('同 version 經既有 durable outbox 只送一次（mock Telegram，不實際送出）', async () => {
    const h = guestBackendHarness()
    const alert = run(oldDevice).alert
    const doc = { channel: 'telegram', event: 'settings_guard', version: alert.version, payload: { text: alert.text } }
    await h.api.enqueueAndTrySend(doc)
    await h.api.enqueueAndTrySend({ ...doc })
    await h.api.enqueueAndTrySend({ ...doc, version: run(oldDevice, UA_IPAD, nowMs + 86400_000).alert.version })
    expect(h.deliveries.filter(d => d.event === 'settings_guard')).toHaveLength(2)
  })

  it('HTML 跳脫：UA 內的 < > 不會破壞 Telegram HTML', () => {
    expect(buildSettingsGuardAlert({ preserved: ['publicSiteUrl'] }, { uaSummary: '<b>x', role: 'm', day: 'd' }).text).toContain('&lt;b&gt;x')
  })
})

describe('稽核 log 不含 PII／設定值', () => {
  it('只有 key 名、角色、email 雜湊、UA 摘要', () => {
    const r = guardSettingsPush({ existingRaw: cloud, incomingRaw: { ...oldDevice, storePhone: '0912345678', lineLoginChannelId: '5555555555' }, normalize: normalizeStoreSettings, staff, userAgent: UA_WIN })
    const json = JSON.stringify(r.audit)
    expect(r.audit.event).toBe('settings_push_audit')
    expect(r.audit.changedKeys).toEqual(expect.arrayContaining(['openTime', 'storePhone', 'lineLoginChannelId']))
    expect(r.audit.ua).toBe('Windows · Chrome 129')
    expect(r.audit.staffEmailHash).toMatch(/^[0-9a-f]{12}$/)
    for (const secret of ['manager@example.com', '0912345678', '5555555555', 'uid-1', 'zeabur', 'reaor76eyq', '10:30']) expect(json).not.toContain(secret)
  })

  it('reportSettingsGuard（index.js）只 log 稽核 JSON，並以 version 入 durable 通知', async () => {
    const logs = []
    const sent = []
    const report = new Function('console', 'enqueueAndTrySend', extract('reportSettingsGuard') + '\nreturn reportSettingsGuard')(
      { log: s => logs.push(s), error: () => {} }, async doc => sent.push(doc))
    const g = guardSettingsPush({ existingRaw: cloud, incomingRaw: oldDevice, normalize: normalizeStoreSettings, staff, userAgent: UA_IPAD })
    await report(g)
    expect(JSON.parse(logs[0]).event).toBe('settings_push_audit')
    expect(logs[0]).not.toContain('manager@example.com')
    expect(sent).toEqual([{ channel: 'telegram', event: 'settings_guard', version: g.alert.version, payload: { text: g.alert.text } }])
  })
})

describe('adminPushData 接線', () => {
  it('settings 寫入改走 guardSettingsPush 的輸出，不再直接 normalize 客戶端資料', () => {
    const start = source.indexOf('export const adminPushData')
    const body = source.slice(start, source.indexOf('\n})', start))
    expect(body).toContain('guardSettingsPush(')
    expect(body).toContain('...settingsGuard.next')
    expect(body).not.toContain('...normalizeStoreSettings(writable.settings)')
    expect(body).toContain('reportSettingsGuard(settingsGuard)')
  })
})

describe('summarizeUserAgent / taipeiDay', () => {
  it('摘要裝置與瀏覽器主版本', () => {
    expect(summarizeUserAgent(UA_IPAD)).toBe('iPad · Safari 16')
    expect(summarizeUserAgent('')).toBe('未知裝置')
    expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Line/14.1')).toBe('Android · LINE')
  })
  it('台北換日', () => {
    expect(taipeiDay(Date.parse('2026-10-07T16:30:00Z'))).toBe('2026-10-08')
  })
})
