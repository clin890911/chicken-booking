import { FIXTURES, DEFAULT_ZONES, DEFAULT_BACKGROUND_IMAGES } from '../data/tables'

const STORAGE_KEY = 'chicken_settings_v1'

const DEFAULT = {
  openTime: '11:00',
  // 桌位佈局（設施 / 分區 / 底圖）。★ 與 functions normalizeFloorPlanServer 白名單成對，
  // 未設定時 fallback 程式內預設 FIXTURES。
  floorPlan: {
    fixtures: FIXTURES,
    zones: DEFAULT_ZONES,
    backgroundImages: DEFAULT_BACKGROUND_IMAGES,
  },
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  diningDurationMin: 90,
  cleanupBufferMin: 10,
  // 現場自動化（自動清檯）：超時自動釋桌 + 換日掃除；保守可關。
  autoReleaseEnabled: true,
  autoReleaseAfterMin: 300,     // 用餐超過 5 小時視為忘記清桌（clamp 120–720）
  dayRolloverEnabled: true,
  autoNoshowOnRollover: false,  // 預設關：自動標 noshow 會影響顧客罰則與報表口徑
  // 線上訂位防線（只擋線上客人端，店員後台/現場不受影響；★ 與 functions 白名單成對）：
  onlineAutoCloseEnabled: false,   // 滿座門檻自動關閉（預設關，後台開啟後生效）
  onlineAutoClosePercent: 80,      // 已訂達總容量 N% 即關閉該時段線上訂位（clamp 50–100）
  onlineSessionCutoffMin: 0,       // 場次開始前 X 分鐘停止線上訂位（0 = 不啟用，clamp 0–720）
  // 固定場次（批次）：地圖時間軸與「關閉整場次」依此；店家可在後台增刪。
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
    { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
  ],
  // 關閉訂位：整天公休 / 特定日特定時段 / 特定日特定場次。
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
  heroBanners: [],
  lineOfficialUrl: 'https://lin.ee/8lECi4S',
  lineOfficialName: '雞王涮涮鍋 LINE 官方帳號',
  // LIFF 自動綁定（舊）預設關：改走 LINE Login 網頁授權，避免 LIFF 多段重導卡載入。
  lineUseLiff: false,
  lineLiffUrl: 'https://liff.line.me/2009996489-f1SCb75q',
  lineLiffId: '2009996489-f1SCb75q',
  lineBindEndpoint: 'https://linebind-reaor76eyq-uc.a.run.app',
  linePushEndpoint: 'https://linepushbooking-reaor76eyq-uc.a.run.app',
  lineManageEndpoint: 'https://linegetbooking-reaor76eyq-uc.a.run.app',
  lineMyBookingsEndpoint: 'https://linemybookings-reaor76eyq-uc.a.run.app',
  // LINE Login 網頁授權綁定（新）：入口端點 + OAuth 回呼網址。空字串 = 前端用預設 / 後端視為未設定。
  // ★ 與 functions normalizeStoreSettings 白名單成對，兩邊都要有，否則同步時被靜默剝除。
  lineLoginStartEndpoint: '',
  lineLoginCallbackUrl: '',
  // LINE Login channel ID（Login / LIFF 所屬 channel）：LINE Login 綁定與「我的訂位」驗 ID token 共用；
  // 空字串 = 功能未啟用。★ 白名單成對。
  lineLoginChannelId: '',
  // 前端正式站網址：後端組 LINE 訊息「管理 / 修改訂位」按鈕連結用（空字串 = 按鈕不顯示）。
  // ★ 與 functions 的 normalizeStoreSettings 白名單成對，兩邊都要有，否則同步時被靜默剝除。
  publicSiteUrl: '',
  // 店員後台改期/取消時自動 LINE 通知客人（預設關；★ 同上，白名單成對）。
  lineNotifyOnAdminChange: false,
  storeName: '雞王涮涮鍋',
  storePhone: '049-2753377',
  storeAddress: '南投縣鹿谷鄉中正路二段377號',
  storeMapUrl: 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E6%8A%95%E7%B8%A3%E9%B9%BF%E8%B0%B7%E9%84%89%E4%B8%AD%E6%AD%A3%E8%B7%AF%E4%BA%8C%E6%AE%B5377%E8%99%9F',
  storeLatitude: '23.7523874',
  storeLongitude: '120.746746'
}

// 與 functions/lib/onlineGuards.js 的 clampInt 同邏輯（非法值回 fallback，再夾進範圍）。
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// 正規化「關閉設定」並深拷貝（避免與 DEFAULT.closures 共用參考被 mutate 污染）。
function normalizeClosures(c = {}) {
  const out = { closedDates: [], closedSlots: {}, closedSeatings: {} }
  if (!c || typeof c !== 'object') return out
  if (Array.isArray(c.closedDates)) {
    out.closedDates = c.closedDates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(String)
  }
  const cleanMap = (m, valRe) => {
    const o = {}
    if (m && typeof m === 'object') {
      for (const [d, arr] of Object.entries(m)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(arr)) {
          const v = arr.filter(x => (valRe ? valRe.test(x) : !!x)).map(String)
          if (v.length) o[d] = v
        }
      }
    }
    return o
  }
  out.closedSlots = cleanMap(c.closedSlots, /^\d{1,2}:\d{2}$/)
  out.closedSeatings = cleanMap(c.closedSeatings, null)
  return out
}

// 桌位佈局深正規化（深拷貝避免與 DEFAULT 共用參考；與 functions normalizeFloorPlanServer 同口徑）。
const FP_FLOORS = ['1F', '2F']
const FP_FIXTURE_TYPES = ['label', 'rect', 'stairs']
function normalizeFloorPlan(fp) {
  const out = { fixtures: { '1F': [], '2F': [] }, zones: [], backgroundImages: { '1F': null, '2F': null } }
  const src = (fp && typeof fp === 'object') ? fp : {}
  for (const floor of FP_FLOORS) {
    const items = src.fixtures?.[floor]
    out.fixtures[floor] = Array.isArray(items)
      ? items.filter(f => f && FP_FIXTURE_TYPES.includes(f.type)).map(f => ({
          id: String(f.id || ''),
          type: String(f.type),
          x: Number(f.x) || 0,
          y: Number(f.y) || 0,
          w: Number(f.w) || 0,
          h: Number(f.h) || 0,
          text: String(f.text || ''),
          vtext: f.vtext === true,
        }))
      // 未設定該樓層 → fallback 預設設施（深拷貝）
      : (FIXTURES[floor] || []).map(f => ({ ...f }))
  }
  out.zones = Array.isArray(src.zones)
    ? src.zones.filter(z => z?.id).map(z => ({ id: String(z.id), name: String(z.name || ''), color: String(z.color || '#cccccc') }))
    : []
  for (const floor of FP_FLOORS) {
    const bg = src.backgroundImages?.[floor]
    out.backgroundImages[floor] = (bg && typeof bg === 'object' && typeof bg.url === 'string' && bg.url.startsWith('data:image/'))
      ? { url: bg.url, opacity: Math.min(1, Math.max(0.05, Number(bg.opacity) || 0.4)), x: Number(bg.x) || 0, y: Number(bg.y) || 0, w: Number(bg.w) || 0, h: Number(bg.h) || 0 }
      : null
  }
  return out
}

function withDefaults(value = {}) {
  const merged = { ...DEFAULT, ...value }
  return {
    ...merged,
    floorPlan: normalizeFloorPlan(merged.floorPlan),
    // heroBanners 複製一份新陣列，避免回傳值與 DEFAULT.heroBanners 共用同一參考、
    // 被呼叫端 mutate 後污染後續 getSettings()。
    heroBanners: Array.isArray(merged.heroBanners) ? merged.heroBanners.slice() : [],
    // seatings / closures 同理深拷貝（避免共用 DEFAULT 參考），並正規化欄位。
    seatings: Array.isArray(merged.seatings)
      ? merged.seatings
          .filter(s => s && s.id && /^\d{1,2}:\d{2}$/.test(s.start || '') && /^\d{1,2}:\d{2}$/.test(s.end || ''))
          .map(s => ({ id: String(s.id), name: String(s.name || ''), start: String(s.start), end: String(s.end) }))
      : [],
    closures: normalizeClosures(merged.closures),
    diningDurationMin: Number(merged.diningDurationMin) || DEFAULT.diningDurationMin,
    cleanupBufferMin: Number(merged.cleanupBufferMin) || DEFAULT.cleanupBufferMin,
    autoReleaseEnabled: merged.autoReleaseEnabled !== false,
    autoReleaseAfterMin: Math.min(720, Math.max(120, Number(merged.autoReleaseAfterMin) || DEFAULT.autoReleaseAfterMin)),
    dayRolloverEnabled: merged.dayRolloverEnabled !== false,
    autoNoshowOnRollover: merged.autoNoshowOnRollover === true,
    // 線上訂位防線：與 functions normalizeOnlineGuardSettings 同口徑（0 / false 有意義，不能用 ||）。
    onlineAutoCloseEnabled: merged.onlineAutoCloseEnabled === true,
    onlineAutoClosePercent: clampInt(merged.onlineAutoClosePercent, 50, 100, DEFAULT.onlineAutoClosePercent),
    onlineSessionCutoffMin: clampInt(merged.onlineSessionCutoffMin, 0, 720, 0),
    lineOfficialUrl: merged.lineOfficialUrl || DEFAULT.lineOfficialUrl,
    lineOfficialName: merged.lineOfficialName || DEFAULT.lineOfficialName,
    lineUseLiff: !!merged.lineUseLiff,
    lineLiffUrl: merged.lineLiffUrl || DEFAULT.lineLiffUrl,
    lineLiffId: merged.lineLiffId || DEFAULT.lineLiffId,
    lineBindEndpoint: merged.lineBindEndpoint || DEFAULT.lineBindEndpoint,
    linePushEndpoint: merged.linePushEndpoint || DEFAULT.linePushEndpoint,
    lineManageEndpoint: merged.lineManageEndpoint || DEFAULT.lineManageEndpoint,
    lineMyBookingsEndpoint: merged.lineMyBookingsEndpoint || DEFAULT.lineMyBookingsEndpoint,
    lineLoginStartEndpoint: String(merged.lineLoginStartEndpoint || '').trim(),
    lineLoginCallbackUrl: String(merged.lineLoginCallbackUrl || '').trim(),
    lineLoginChannelId: String(merged.lineLoginChannelId || '').trim(),
    publicSiteUrl: String(merged.publicSiteUrl || '').trim(),
    lineNotifyOnAdminChange: merged.lineNotifyOnAdminChange === true,
    storeName: merged.storeName || DEFAULT.storeName,
    storePhone: merged.storePhone || DEFAULT.storePhone,
    storeAddress: merged.storeAddress || DEFAULT.storeAddress,
    storeMapUrl: merged.storeMapUrl || DEFAULT.storeMapUrl,
    storeLatitude: merged.storeLatitude || DEFAULT.storeLatitude,
    storeLongitude: merged.storeLongitude || DEFAULT.storeLongitude
  }
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return withDefaults()
    return withDefaults(JSON.parse(raw))
  } catch {
    return withDefaults()
  }
}

export function saveSettings(patch) {
  const next = withDefaults({ ...getSettings(), ...patch })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
