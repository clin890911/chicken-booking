// adminPushData 寫入 settings/main 前的守門（純函式，無 Firestore 相依）。
//
// 事故背景：adminPushData 把客戶端整份 settings 經 normalizeStoreSettings 後覆寫雲端，
// 舊版前端／新裝置首登會帶「空的」LINE Login 欄位，已三次把雲端的 LINE 綁定設定洗空
// （lineLoginReady=false、客人綁定全失敗且無人察覺）。
//
// 規則：受保護欄位「客戶端送空值、雲端現有非空值」→ 保留雲端值；送非空值照寫（店主合法修改仍生效）。
// 代價：受保護欄位無法經由同步「清成空白」，要停用請改填其他值或由後端人工處理。
import crypto from 'node:crypto'
import { validateLineReadiness } from './lineReadiness.js'

// 選擇理由：只收「文字型、空白永遠不是店主的有意設定」的 LINE 就緒相關欄位。
// - 前 4 欄：實際被洗過、且 readiness 必填（空白 = 綁定全掛）。
// - lineOfficialUrl：readiness 必填；normalize 雖會補預設，但空白會把店主自訂值洗回預設。
// - lineLiffId / lineLiffUrl：lineUseLiff=true 時 readiness 必填，同上會被洗回預設。
// 刻意不收：lineUseLiff（布林，false 是合法的「關閉」選擇，無法分辨洗掉還是店主關掉）、
//   lineNotifyOnAdminChange 等布林開關（同理）、line*Endpoint 舊端點（normalize 有預設且不影響 readiness）。
export const PROTECTED_SETTINGS_FIELDS = Object.freeze([
  'lineLoginChannelId',
  'lineLoginStartEndpoint',
  'lineLoginCallbackUrl',
  'publicSiteUrl',
  'lineOfficialUrl',
  'lineLiffId',
  'lineLiffUrl',
])

const FIELD_LABELS = {
  lineLoginChannelId: 'LINE Login Channel ID',
  lineLoginStartEndpoint: 'LINE Login 綁定入口',
  lineLoginCallbackUrl: 'LINE Login 回呼網址',
  publicSiteUrl: '訂位網站網址',
  lineOfficialUrl: '官方帳號加入連結',
  lineLiffId: 'LIFF ID',
  lineLiffUrl: 'LIFF 綁定連結',
}
export const fieldLabel = field => FIELD_LABELS[field] || field

const isBlank = value => value == null || String(value).trim() === ''
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
    : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex')

// 受保護欄位：客戶端空值（含缺 key）且雲端非空 → 沿用雲端原值。其他欄位原封不動。
export function preserveProtectedSettings(incoming = {}, existing = {}) {
  const settings = { ...(incoming || {}) }
  const preserved = []
  for (const field of PROTECTED_SETTINGS_FIELDS) {
    if (isBlank(settings[field]) && !isBlank(existing?.[field])) {
      settings[field] = existing[field]
      preserved.push(field)
    }
  }
  return { settings, preserved }
}

// 兩份「已正規化」設定之間變動的頂層 key（只回 key，不回值）。
export function changedSettingKeys(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  return keys.filter(k => !same(before?.[k], after?.[k])).sort()
}

// normalize 由呼叫端注入（normalizeStoreSettings 在 functions/index.js），保持本檔可單測。
export function evaluateSettingsPush({ existingRaw = {}, incomingRaw = {}, normalize }) {
  const before = normalize(existingRaw || {})
  const { settings: guardedRaw, preserved } = preserveProtectedSettings(incomingRaw, existingRaw || {})
  const next = normalize(guardedRaw)
  const changedKeys = changedSettingKeys(before, next)
  const protectedChanged = changedKeys.filter(k => PROTECTED_SETTINGS_FIELDS.includes(k))
  const readinessBefore = validateLineReadiness(before)
  const readinessAfter = validateLineReadiness(next)
  const readinessDropped = readinessBefore.ready && !readinessAfter.ready
  return {
    guardedRaw,
    next,
    preserved,
    changedKeys,
    protectedChanged,
    lineReadyBefore: readinessBefore.ready,
    lineReadyAfter: readinessAfter.ready,
    readinessDropped,
    brokenFields: readinessDropped ? readinessAfter.issues.map(i => i.field) : [],
  }
}

// UA 摘要：只留裝置類型＋瀏覽器主版本，夠辨認「是哪台舊裝置」又不留完整指紋。
export function summarizeUserAgent(ua = '') {
  const s = String(ua || '')
  if (!s.trim()) return '未知裝置'
  const device = /iPad/.test(s) ? 'iPad'
    : /iPhone/.test(s) ? 'iPhone'
      : /Android/.test(s) ? 'Android'
        : /Macintosh/.test(s) ? 'Mac/iPad'
          : /Windows/.test(s) ? 'Windows'
            : /Linux/.test(s) ? 'Linux' : '其他'
  let m
  const browser = /\bLine\//i.test(s) ? 'LINE'
    : (m = s.match(/Edg(?:A|iOS)?\/(\d+)/)) ? `Edge ${m[1]}`
      : (m = s.match(/(?:CriOS|Chrome)\/(\d+)/)) ? `Chrome ${m[1]}`
        : (m = s.match(/(?:FxiOS|Firefox)\/(\d+)/)) ? `Firefox ${m[1]}`
          : (m = s.match(/Version\/(\d+)[\d.]*.*Safari/)) ? `Safari ${m[1]}`
            : /node|undici|curl|axios|python/i.test(s) ? '非瀏覽器' : '其他'
  return `${device} · ${browser}`
}

export const staffEmailHash = email => (email ? sha(String(email).trim().toLowerCase()).slice(0, 12) : null)

// 結構化稽核紀錄（給 Cloud Logging）：只有 key 名、角色、雜湊、UA 摘要，不含任何設定值或 email 明文。
export function buildSettingsAuditEntry(result, { staff = {}, uaSummary = '', at = new Date().toISOString() } = {}) {
  return {
    event: 'settings_push_audit',
    at,
    role: staff.role || null,
    staffSource: staff.source || null,
    staffEmailHash: staffEmailHash(staff.email),
    ua: uaSummary,
    changedKeys: result.changedKeys,
    preservedFields: result.preserved,
    protectedChanged: result.protectedChanged,
    lineReadyBefore: result.lineReadyBefore,
    lineReadyAfter: result.lineReadyAfter,
  }
}

// Telegram 告警（null = 不需告警）。version 供 durable 通知 intent 去重：
// - 只有「攔截空值」：同一天同一組欄位只告警一次（舊裝置每次同步都會送空值，不可洗版）。
// - 欄位被改／readiness 掉落：同一天同一組新值只告警一次（不同的改動各告警一次）。
export function buildSettingsGuardAlert(result, { uaSummary = '', role = '', day = '' } = {}) {
  const { preserved = [], protectedChanged = [], readinessDropped = false, brokenFields = [], next = {} } = result || {}
  if (!readinessDropped && !protectedChanged.length && !preserved.length) return null
  const names = fields => fields.map(f => escapeHtml(fieldLabel(f))).join('、')
  const lines = []
  if (readinessDropped) {
    lines.push('🚨 <b>LINE 綁定設定失效</b>：後台同步寫入後由「就緒」變「未就緒」，客人將無法綁定 LINE。')
    if (brokenFields.length) lines.push(`未通過欄位：${names(brokenFields)}`)
  }
  if (protectedChanged.length) lines.push(`⚠️ <b>LINE 設定被修改</b>：${names(protectedChanged)}`)
  if (preserved.length) lines.push(`🛡️ 已攔截空值覆蓋（保留雲端原值）：${names(preserved)}`)
  lines.push(`裝置：${escapeHtml(uaSummary || '未知裝置')}｜角色：${escapeHtml(role || '未知')}`)
  if (preserved.length && !readinessDropped && !protectedChanged.length) lines.push('可能是舊版前端或新裝置，請該裝置重新整理。')
  const changedValues = Object.fromEntries(protectedChanged.map(f => [f, next[f] ?? '']))
  const version = 'settings-guard:' + sha(JSON.stringify([day, [...preserved].sort(), changedValues, readinessDropped])).slice(0, 32)
  return { version, text: lines.join('\n') }
}

// 台北日期（YYYY-MM-DD），告警去重用。
export function taipeiDay(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10)
}

// adminPushData 單一入口：回傳要寫進 settings/main 的資料＋稽核＋告警。
export function guardSettingsPush({ existingRaw, incomingRaw, normalize, staff = {}, userAgent = '', nowMs = Date.now() }) {
  const result = evaluateSettingsPush({ existingRaw, incomingRaw, normalize })
  const uaSummary = summarizeUserAgent(userAgent)
  return {
    ...result,
    audit: buildSettingsAuditEntry(result, { staff, uaSummary, at: new Date(nowMs).toISOString() }),
    alert: buildSettingsGuardAlert(result, { uaSummary, role: staff.role, day: taipeiDay(nowMs) }),
  }
}

// settings/main 的寫入選項：「本次寫入的頂層 key 整欄替換」，不是 merge:true 的深層合併。
// 事故背景：merge:true 對巢狀 map 是逐 key 深層合併——店長在「休店/關閉時段」恢復某天開放，
// 前端從 closures.closedSeatings／closedSlots 刪掉該日期 key，雲端該 key 卻不會被刪，下次拉取又「復活」。
// 改用 mergeFields：列出的頂層欄位整個替換；沒列出的頂層欄位（後端專用欄位）保持不動。
// 頂層 key 必須是單純識別字：mergeFields 以「.」解析巢狀路徑，含點的 key 會被誤當成子欄位。
export function settingsReplaceOptions(data = {}) {
  const fields = Object.keys(data || {})
  if (!fields.length) throw new Error('settings-write-empty')
  const bad = fields.filter(k => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
  if (bad.length) throw new Error('settings-write-invalid-key:' + bad.join(','))
  return { mergeFields: fields }
}

// 訂位專員（settings.closures）closures-only 寫入的稽核（與 guardSettingsPush 回傳同形 { audit, alert }，
// 讓 adminPushData 兩條路徑共用 reportSettingsGuard）。
// - 不走 LINE 守門：closures 路徑只寫 CLOSURE_SETTING_KEYS（lib/settingsScope.js），LINE 欄位連碰都不碰。
// - alert 永遠為 null：host 推送不可觸發 LINE 告警（就算客戶端夾帶 LINE 空值，那些 key 早已被拒、不會寫入）。
// - 稽核同樣只記 key 名／角色／雜湊／UA 摘要，不含設定值或 email 明文；scope 標明 closures-only。
export function buildClosuresSettingsReport({ scoped = {}, cloudRaw = {}, normalize = v => v, staff = {}, userAgent = '', nowMs = Date.now() }) {
  const before = normalize(cloudRaw || {})
  const changedKeys = changedSettingKeys(before, scoped.next || before)
  return {
    audit: {
      event: 'settings_push_audit',
      scope: 'closures-only',
      at: new Date(nowMs).toISOString(),
      role: staff.role || null,
      staffSource: staff.source || null,
      staffEmailHash: staffEmailHash(staff.email),
      ua: summarizeUserAgent(userAgent),
      appliedKeys: [...(scoped.appliedKeys || [])],
      changedKeys,
      written: scoped.changed === true,
      preservedFields: [],
      protectedChanged: changedKeys.filter(k => PROTECTED_SETTINGS_FIELDS.includes(k)),
    },
    alert: null,
  }
}
