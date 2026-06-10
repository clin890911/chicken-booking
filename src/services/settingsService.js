const STORAGE_KEY = 'chicken_settings_v1'

const DEFAULT = {
  openTime: '11:00',
  closeTime: '19:00',
  slotInterval: 30,
  maxDaysAhead: 30,
  diningDurationMin: 90,
  cleanupBufferMin: 10,
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
  lineUseLiff: true,
  lineLiffUrl: 'https://liff.line.me/2009996489-f1SCb75q',
  lineLiffId: '2009996489-f1SCb75q',
  lineBindEndpoint: 'https://linebind-reaor76eyq-uc.a.run.app',
  linePushEndpoint: 'https://linepushbooking-reaor76eyq-uc.a.run.app',
  lineManageEndpoint: 'https://linegetbooking-reaor76eyq-uc.a.run.app',
  // 前端正式站網址：後端組 LINE 訊息「管理 / 修改訂位」按鈕連結用（空字串 = 按鈕不顯示）。
  // ★ 與 functions 的 normalizeStoreSettings 白名單成對，兩邊都要有，否則同步時被靜默剝除。
  publicSiteUrl: '',
  storeName: '雞王涮涮鍋',
  storePhone: '049-2753377',
  storeAddress: '南投縣鹿谷鄉中正路二段377號',
  storeMapUrl: 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E6%8A%95%E7%B8%A3%E9%B9%BF%E8%B0%B7%E9%84%89%E4%B8%AD%E6%AD%A3%E8%B7%AF%E4%BA%8C%E6%AE%B5377%E8%99%9F',
  storeLatitude: '23.7523874',
  storeLongitude: '120.746746'
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

function withDefaults(value = {}) {
  const merged = { ...DEFAULT, ...value }
  return {
    ...merged,
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
    lineOfficialUrl: merged.lineOfficialUrl || DEFAULT.lineOfficialUrl,
    lineOfficialName: merged.lineOfficialName || DEFAULT.lineOfficialName,
    lineUseLiff: !!merged.lineUseLiff,
    lineLiffUrl: merged.lineLiffUrl || DEFAULT.lineLiffUrl,
    lineLiffId: merged.lineLiffId || DEFAULT.lineLiffId,
    lineBindEndpoint: merged.lineBindEndpoint || DEFAULT.lineBindEndpoint,
    linePushEndpoint: merged.linePushEndpoint || DEFAULT.linePushEndpoint,
    lineManageEndpoint: merged.lineManageEndpoint || DEFAULT.lineManageEndpoint,
    publicSiteUrl: String(merged.publicSiteUrl || '').trim(),
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
