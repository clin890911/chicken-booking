// 設定頁「有未儲存變更」的明細：把表單與已存 settings 的差異翻成店員看得懂的一行一行。
// 純函式，不碰 UI。另含 rebaseSettingsForm：已存 settings 從外部更新時（雲端拉取、桌位佈局編輯器
// 存檔），把表單「沒被使用者改過的欄位」跟上新值，只保留使用者真的改過的欄位。

const LABELS = {
  openTime: '營業開始時間',
  closeTime: '營業結束時間',
  slotInterval: '時段間隔',
  maxDaysAhead: '可預訂天數',
  diningDurationMin: '用餐時間',
  cleanupBufferMin: '清桌緩衝',
  autoReleaseEnabled: '超時自動釋桌',
  autoReleaseAfterMin: '視為忘記清桌的時數',
  dayRolloverEnabled: '換日掃除',
  autoNoshowOnRollover: '換日自動標記未到',
  onlineAutoCloseEnabled: '線上滿座自動關閉',
  onlineAutoClosePercent: '線上自動關閉門檻',
  onlineSessionCutoffMin: '場次前停止線上訂位',
  seatings: '場次設定',
  closures: '休店 / 關閉時段',
  heroBanners: '首頁廣告輪播',
  floorPlan: '桌位佈局（設施／分區／底圖）',
  lineOfficialUrl: 'LINE 官方帳號加入連結',
  lineOfficialName: 'LINE 顯示名稱',
  lineUseLiff: '使用 LIFF 自動綁定',
  lineLiffUrl: 'LIFF 訂位綁定連結',
  lineLiffId: 'LIFF ID',
  lineBindEndpoint: 'LINE 綁定後端端點',
  linePushEndpoint: 'LINE 推播後端端點',
  lineManageEndpoint: 'LINE 訂位讀取端點',
  lineMyBookingsEndpoint: 'LINE 我的訂位端點',
  lineLoginStartEndpoint: 'LINE Login 入口端點',
  lineLoginCallbackUrl: 'LINE Login 回呼網址',
  lineLoginChannelId: 'LINE Login Channel ID',
  publicSiteUrl: '訂位網站網址',
  lineNotifyOnAdminChange: '後台改動自動 LINE 通知客人',
  storeName: '店名',
  storePhone: '店家電話',
  storeAddress: '店家地址',
  storeMapUrl: 'Google Maps 導航連結',
  storeLatitude: '緯度',
  storeLongitude: '經度',
}

const MINUTE_FIELDS = new Set(['slotInterval', 'diningDurationMin', 'cleanupBufferMin'])

const same = (a, b) => (a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')
  ? JSON.stringify(a) === JSON.stringify(b)
  : a === b

// 與 SettingsView 的 dirty 判定同口徑：表單裡與已存值不同的欄位
export function dirtySettingsKeys(form, saved) {
  if (!form || !saved) return []
  return Object.keys(form).filter(k => !same(form[k], saved[k]))
}

const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function formatScalar(key, v) {
  if (v === undefined || v === null || v === '') return '（空白）'
  if (typeof v === 'boolean') return v ? '開啟' : '關閉'
  if (key === 'maxDaysAhead') return `${v} 天`
  if (MINUTE_FIELDS.has(key)) return `${v} 分`
  if (key === 'autoReleaseAfterMin') return `${Number(v) / 60} 小時`
  if (key === 'onlineAutoClosePercent') return `${v}%`
  if (key === 'onlineSessionCutoffMin') return Number(v) ? `${v} 分鐘前` : '不啟用'
  return clip(String(v))
}

const md = (ds) => `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`

// 某一天的關閉內容（整天公休 / 場次名 / 時段），回傳字串陣列
function dayClosureItems(c, ds, seatingName) {
  if ((c.closedDates || []).includes(ds)) return ['整天公休']
  return [
    ...(c.closedSeatings?.[ds] || []).map(id => `${seatingName(id)}（整場次）`),
    ...[...(c.closedSlots?.[ds] || [])].sort(),
  ]
}

function closureDetails(prev = {}, next = {}, seatings = []) {
  const seatingName = (id) => seatings.find(s => s.id === id)?.name || '已刪除的場次'
  const days = [...new Set([
    ...(prev.closedDates || []), ...(next.closedDates || []),
    ...Object.keys(prev.closedSeatings || {}), ...Object.keys(next.closedSeatings || {}),
    ...Object.keys(prev.closedSlots || {}), ...Object.keys(next.closedSlots || {}),
  ])].sort()
  const out = []
  for (const ds of days) {
    const before = dayClosureItems(prev, ds, seatingName)
    const after = dayClosureItems(next, ds, seatingName)
    const closed = after.filter(x => !before.includes(x))
    const reopened = before.filter(x => !after.includes(x))
    if (closed.length) out.push(`${md(ds)} 關閉：${closed.join('、')}`)
    if (reopened.length) out.push(`${md(ds)} 恢復開放：${reopened.join('、')}`)
  }
  return out
}

function seatingDetails(prev = [], next = []) {
  const out = []
  const byId = new Map(prev.map(s => [s.id, s]))
  for (const s of next) {
    const p = byId.get(s.id)
    if (!p) out.push(`新增「${s.name}」${s.start}–${s.end}`)
    else if (p.name !== s.name || p.start !== s.start || p.end !== s.end) {
      out.push(`「${p.name}」${p.start}–${p.end} → 「${s.name}」${s.start}–${s.end}`)
    }
  }
  const nextIds = new Set(next.map(s => s.id))
  for (const p of prev) if (!nextIds.has(p.id)) out.push(`刪除「${p.name}」`)
  return out
}

function bannerDetails(prev = [], next = []) {
  const out = []
  const prevIds = new Set(prev.map(b => b.id))
  const nextIds = new Set(next.map(b => b.id))
  const added = next.filter(b => !prevIds.has(b.id)).length
  const removed = prev.filter(b => !nextIds.has(b.id)).length
  if (added) out.push(`新增 ${added} 張`)
  if (removed) out.push(`刪除 ${removed} 張`)
  const byId = new Map(prev.map(b => [b.id, b]))
  if (next.some(b => byId.has(b.id) && (byId.get(b.id).title !== b.title || byId.get(b.id).subtitle !== b.subtitle))) {
    out.push('修改標題／副標')
  }
  const keptPrev = prev.filter(b => nextIds.has(b.id)).map(b => b.id).join()
  const keptNext = next.filter(b => prevIds.has(b.id)).map(b => b.id).join()
  if (keptPrev !== keptNext) out.push('調整輪播順序')
  return out.length ? out : ['內容已變更']
}

// 回傳 [{ key, label, from?, to?, details? }]：純量欄位給 from/to；物件欄位給 details（每行一句）。
export function describeSettingsChanges(saved = {}, form = {}) {
  return dirtySettingsKeys(form, saved).map(key => {
    const label = LABELS[key] || key
    const a = saved[key]
    const b = form[key]
    if (key === 'closures') {
      const details = closureDetails(a, b, form.seatings || saved.seatings || [])
      return { key, label, details: details.length ? details : ['內容已變更'] }
    }
    if (key === 'seatings') {
      const details = seatingDetails(a || [], b || [])
      return { key, label, details: details.length ? details : ['順序已調整'] }
    }
    if (key === 'heroBanners') return { key, label, details: bannerDetails(a || [], b || []) }
    if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) {
      return { key, label, details: ['內容已變更'] }
    }
    return { key, label, from: formatScalar(key, a), to: formatScalar(key, b) }
  })
}

// 已存 settings 從 prevSaved 變成 nextSaved（雲端拉取、其他裝置、桌位佈局編輯器存檔…）時，
// 表單要跟上：使用者改過的欄位（form 與 prevSaved 不同）保留使用者的值，其餘一律採 nextSaved。
// 否則表單會停在打開頁面時的舊值 → 冒出「有未儲存變更」，按儲存還會把別處的新值蓋回舊值。
export function rebaseSettingsForm(form, prevSaved, nextSaved) {
  if (!nextSaved) return form
  if (!form || !prevSaved) return nextSaved
  const edited = dirtySettingsKeys(form, prevSaved)
  if (!edited.length) return nextSaved
  const out = { ...nextSaved }
  for (const k of edited) out[k] = form[k]
  return out
}
